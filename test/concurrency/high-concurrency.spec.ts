import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import { v4 as uuidv4 } from "uuid";
import config from "../../src/infrastructure/database/mikro-orm.config";
import { OpenWalletUseCase } from "../../src/application/use-cases/open-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "../../src/application/use-cases/process-wager-transaction.use-case";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/entities/wager-transaction";
import { WalletLedgerEntryOrmEntity } from "../../src/infrastructure/database/entities/wallet-ledger-entry.entity";
import { WalletOrmEntity } from "../../src/infrastructure/database/entities/wallet.entity";

describe("Advanced Concurrency & Race Conditions Suite (Section 13)", () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(config);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("should process the identical bet sent 50 times in parallel with EXACTLY ONE debit and 49 replays", async () => {
    const openWalletUseCase = new OpenWalletUseCase(orm.em.fork());
    const playerId = uuidv4();

    // Carteira inicial com 100.00 BRL
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const idempotencyKey = `fifty-idemp-${uuidv4()}`;
    const externalTxId = `fifty-ext-${uuidv4()}`;

    const betPayload = {
      providerId: "provider-stress",
      externalTransactionId: externalTxId,
      idempotencyKey,
      playerId,
      walletId: wallet.id,
      roundId: "round-stress-50",
      gameId: "roulette",
      kind: WagerTransactionKind.Bet,
      money: { amount: "20.00", currency: "BRL" },
    };

    // Dispara 50 chamadas em PARALELO ABSOLUTO
    const promises = Array.from({ length: 50 }).map(() => {
      const useCase = new ProcessWagerTransactionUseCase(orm.em.fork());
      return useCase.execute(betPayload);
    });

    const results = await Promise.all(promises);

    expect(results).toHaveLength(50);

    // Todas devem ter retornado status PROCESSED
    for (const r of results) {
      expect(r.status).toBe(WagerTransactionStatus.Processed);
      expect(r.balance.amount).toBe("80.00"); // 100.00 - 20.00
    }

    // Exatamente UMA requisição deve ser a primeira (idempotentReplay: false)
    // E exatamente 49 devem ser idênticas reconhecidas como replays (idempotentReplay: true)
    const initialCalls = results.filter((r) => r.idempotentReplay === false);
    const replayCalls = results.filter((r) => r.idempotentReplay === true);

    expect(initialCalls).toHaveLength(1);
    expect(replayCalls).toHaveLength(49);

    // Confere integridade final da carteira no PostgreSQL
    const em = orm.em.fork();
    const finalWallet = await em.findOneOrFail(WalletOrmEntity, {
      id: wallet.id,
    });
    expect(finalWallet.balance).toBe("80.00");

    // Confere ledger: deve haver exatamente 1 crédito de opening (100.00) e 1 débito de bet (20.00)
    const ledgers = await em.find(WalletLedgerEntryOrmEntity, {
      wallet: wallet.id,
    });
    expect(ledgers).toHaveLength(2);

    const debits = ledgers.filter((l) => l.direction === "DEBIT");
    expect(debits).toHaveLength(1);
    expect(debits[0].amount).toBe("20.00");
  });

  it("should process multiple distinct wallets in parallel without blocking each other", async () => {
    const numWallets = 10;
    const openWalletUseCase = new OpenWalletUseCase(orm.em.fork());

    // Cria 10 carteiras
    const wallets = await Promise.all(
      Array.from({ length: numWallets }).map(async (_, idx) => {
        return openWalletUseCase.execute({
          playerId: uuidv4(),
          initialBalance: { amount: "100.00", currency: "BRL" },
        });
      }),
    );

    // Executa apostas em todas as 10 carteiras simultaneamente
    const betPromises = wallets.map((w, idx) => {
      const useCase = new ProcessWagerTransactionUseCase(orm.em.fork());
      return useCase.execute({
        providerId: "provider-multi",
        externalTransactionId: `multi-tx-${idx}-${uuidv4()}`,
        idempotencyKey: `multi-key-${idx}-${uuidv4()}`,
        playerId: w.playerId,
        walletId: w.id,
        roundId: `multi-round-${idx}`,
        gameId: "slots",
        kind: WagerTransactionKind.Bet,
        money: { amount: "15.00", currency: "BRL" },
      });
    });

    const results = await Promise.all(betPromises);

    expect(results).toHaveLength(numWallets);
    for (const res of results) {
      expect(res.status).toBe(WagerTransactionStatus.Processed);
      expect(res.balance.amount).toBe("85.00");
    }
  });

  it("should maintain ledger consistency with >= 3 concurrent workers touching the same wallet", async () => {
    const openWalletUseCase = new OpenWalletUseCase(orm.em.fork());
    const playerId = uuidv4();

    // Saldo inicial 50.00
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "50.00", currency: "BRL" },
    });

    // 3 instâncias tentando debitar 20.00 cada em paralelo
    // Apenas 2 devem conseguir (20 + 20 = 40.00, sobram 10.00)
    // A 3ª tentativa deve ser rejeitada por saldo insuficiente (10.00 < 20.00)
    const instances = [
      new ProcessWagerTransactionUseCase(orm.em.fork()),
      new ProcessWagerTransactionUseCase(orm.em.fork()),
      new ProcessWagerTransactionUseCase(orm.em.fork()),
    ];

    const results = await Promise.all(
      instances.map((useCase, idx) => {
        return useCase.execute({
          providerId: "provider-tri",
          externalTransactionId: `tri-tx-${idx}-${uuidv4()}`,
          idempotencyKey: `tri-key-${idx}-${uuidv4()}`,
          playerId,
          walletId: wallet.id,
          roundId: "tri-round",
          gameId: "craps",
          kind: WagerTransactionKind.Bet,
          money: { amount: "20.00", currency: "BRL" },
        });
      }),
    );

    const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
    const rejected = results.filter((r) => r.status === WagerTransactionStatus.Rejected);

    expect(processed).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].failureCode).toBe("INSUFFICIENT_FUNDS");

    // Saldo final deve ser exatamente 10.00
    const em = orm.em.fork();
    const finalWallet = await em.findOneOrFail(WalletOrmEntity, {
      id: wallet.id,
    });
    expect(finalWallet.balance).toBe("10.00");

    // Invariante de ouro: saldo reconstruído pelo ledger == saldo materializado
    const ledgers = await em.find(WalletLedgerEntryOrmEntity, {
      wallet: wallet.id,
    });
    // 1 de opening (50.00) + 2 débitos de 20.00 = 3 lançamentos
    expect(ledgers).toHaveLength(3);

    let calculated = 0;
    for (const l of ledgers) {
      if (l.direction === "CREDIT") calculated += Number(l.amount);
      if (l.direction === "DEBIT") calculated -= Number(l.amount);
    }
    expect(calculated.toFixed(2)).toBe(finalWallet.balance);
  });
});

