import { MikroORM } from "@mikro-orm/postgresql";
import { v4 as uuidv4 } from "uuid";
import config from "../../src/infrastructure/database/mikro-orm.config";
import { OpenWalletUseCase } from "../../src/application/use-cases/open-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "../../src/application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionKind } from "../../src/domain/entities/wager-transaction";

interface MetricRecord {
  durationMs: number;
  success: boolean;
  status: string;
  isReplay: boolean;
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function runLoadTest() {
  console.log("================================================================================");
  console.log(" 🚀 DISTRIBUTED WAGERING PROCESSOR — LOAD & STRESS TEST");
  console.log("================================================================================");
  console.log(`Node/Bun Version : ${process.version}`);
  console.log(`Environment      : ${process.env.NODE_ENV || "development"}`);
  console.log(`Database         : PostgreSQL 16 (wagering_db)`);
  console.log(`Timestamp        : ${new Date().toISOString()}`);
  console.log("--------------------------------------------------------------------------------\n");

  const orm = await MikroORM.init(config);
  const openWallet = new OpenWalletUseCase(orm.em.fork());

  const TOTAL_TRANSACTIONS = 100;
  const CONCURRENT_WALLETS = 10;

  console.log(`[1/3] Preparing ${CONCURRENT_WALLETS} benchmark wallets...`);
  const wallets = await Promise.all(
    Array.from({ length: CONCURRENT_WALLETS }).map(async (_, idx) => {
      return openWallet.execute({
        playerId: `player-load-${idx}-${uuidv4()}`,
        initialBalance: { amount: "10000.00", currency: "BRL" },
      });
    }),
  );
  console.log(`✓ ${CONCURRENT_WALLETS} wallets initialized with 10,000.00 BRL each.\n`);

  console.log(`[2/3] Executing ${TOTAL_TRANSACTIONS} concurrent wager transactions...`);
  const metrics: MetricRecord[] = [];
  const testStartTime = Date.now();

  const tasks = Array.from({ length: TOTAL_TRANSACTIONS }).map(async (_, i) => {
    const wallet = wallets[i % CONCURRENT_WALLETS];
    const useCase = new ProcessWagerTransactionUseCase(orm.em.fork());

    const isReplayBatch = i % 5 === 0; // 20% das requisições simulam replay proposital
    const extId = isReplayBatch ? `shared-ext-${i % 10}` : `ext-load-${i}-${uuidv4()}`;
    const idempKey = isReplayBatch ? `shared-key-${i % 10}` : `key-load-${i}-${uuidv4()}`;

    const kind = i % 3 === 0 ? WagerTransactionKind.Win : WagerTransactionKind.Bet;
    const amount = (10 + (i % 20)).toFixed(2);

    const start = performance.now();
    try {
      const output = await useCase.execute({
        providerId: "load-provider",
        externalTransactionId: extId,
        idempotencyKey: idempKey,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: `round-load-${Math.floor(i / 10)}`,
        gameId: "benchmark-game",
        kind,
        money: { amount, currency: "BRL" },
      });

      const durationMs = performance.now() - start;
      metrics.push({
        durationMs,
        success: true,
        status: output.status,
        isReplay: output.idempotentReplay,
      });
    } catch (err: any) {
      const durationMs = performance.now() - start;
      metrics.push({
        durationMs,
        success: false,
        status: "ERROR",
        isReplay: false,
      });
    }
  });

  await Promise.all(tasks);
  const totalElapsedMs = Date.now() - testStartTime;
  console.log(`✓ All ${TOTAL_TRANSACTIONS} transactions finished in ${(totalElapsedMs / 1000).toFixed(2)}s.\n`);

  console.log(`[3/3] Analyzing performance metrics and Outbox lag...`);

  // Análise da Outbox
  const em = orm.em.fork();
  const knex = em.getKnex();
  const pendingOutbox = await knex("outbox_messages")
    .whereNull("published_at")
    .count("id as count")
    .first();
  const outboxLag = Number(pendingOutbox?.count || 0);

  // Análise Estatística de Latência
  const durations = metrics.map((m) => m.durationMs);
  const successful = metrics.filter((m) => m.success).length;
  const failed = metrics.filter((m) => !m.success).length;
  const replays = metrics.filter((m) => m.isReplay).length;

  const minLat = Math.min(...durations);
  const maxLat = Math.max(...durations);
  const avgLat = durations.reduce((a, b) => a + b, 0) / durations.length;
  const p50 = calculatePercentile(durations, 50);
  const p95 = calculatePercentile(durations, 95);
  const p99 = calculatePercentile(durations, 99);
  const throughputRps = (TOTAL_TRANSACTIONS / (totalElapsedMs / 1000)).toFixed(1);

  console.log("================================================================================");
  console.log(" 📊 BENCHMARK RESULTS & PERFORMANCE SUMMARY");
  console.log("================================================================================");
  console.table({
    "Total Requests": TOTAL_TRANSACTIONS,
    "Throughput (RPS)": `${throughputRps} req/s`,
    "Total Duration": `${(totalElapsedMs / 1000).toFixed(2)}s`,
    "Successful Operations": successful,
    "Failed Operations": failed,
    "Idempotent Replays": replays,
    "Error Rate": `${((failed / TOTAL_TRANSACTIONS) * 100).toFixed(2)}%`,
    "Outbox Lag (Pending Events)": outboxLag,
    "Min Latency": `${minLat.toFixed(2)} ms`,
    "Avg Latency": `${avgLat.toFixed(2)} ms`,
    "p50 Latency (Median)": `${p50.toFixed(2)} ms`,
    "p95 Latency": `${p95.toFixed(2)} ms`,
    "p99 Latency": `${p99.toFixed(2)} ms`,
    "Max Latency": `${maxLat.toFixed(2)} ms`,
  });
  console.log("================================================================================\n");

  await orm.close(true);
}

runLoadTest().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
