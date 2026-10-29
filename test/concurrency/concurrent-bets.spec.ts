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

describe("Mandatory Concurrency Scenario (Section 8 of Technical Challenge)", () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(config);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("should correctly handle two concurrent 80.00 BRL bets on a 100.00 BRL wallet: exactly 1 processed, 1 rejected, final balance 20.00", async () => {
    const openWalletUseCase = new OpenWalletUseCase(orm.em.fork());
    const playerId = uuidv4();

    // 1. Cria carteira com 100.00 BRL
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    // Criamos dois use cases com fork() independente simulando duas instâncias/threads simultâneas
    const useCase1 = new ProcessWagerTransactionUseCase(orm.em.fork());
    const useCase2 = new ProcessWagerTransactionUseCase(orm.em.fork());

    const bet1Payload = {
      providerId: "provider-evolution",
      externalTransactionId: `bet-concur-1-${uuidv4()}`,
      idempotencyKey: `idemp-1-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-concur-1",
      gameId: "lightning-roulette",
      kind: WagerTransactionKind.Bet,
      money: { amount: "80.00", currency: "BRL" },
    };

    const bet2Payload = {
      providerId: "provider-evolution",
      externalTransactionId: `bet-concur-2-${uuidv4()}`,
      idempotencyKey: `idemp-2-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-concur-1",
      gameId: "lightning-roulette",
      kind: WagerTransactionKind.Bet,
      money: { amount: "80.00", currency: "BRL" },
    };

    // 2. Dispara as duas apostas de 80.00 em PARALELO REAL
    const [result1, result2] = await Promise.all([
      useCase1.execute(bet1Payload),
      useCase2.execute(bet2Payload),
    ]);

    const statuses = [result1.status, result2.status];

    // Exatamente uma aposta PROCESSED e a outra REJECTED
    expect(statuses).toContain(WagerTransactionStatus.Processed);
    expect(statuses).toContain(WagerTransactionStatus.Rejected);

    const rejectedResult = result1.status === WagerTransactionStatus.Rejected ? result1 : result2;
    expect(rejectedResult.failureCode).toBe("INSUFFICIENT_FUNDS");

    // 3. Verifica saldo final no banco: deve ser EXATAMENTE 20.00 BRL
    const verifyEm = orm.em.fork();
    const finalWallet = await verifyEm.findOneOrFail(WalletOrmEntity, {
      id: wallet.id,
    });
    expect(finalWallet.balance).toBe("20.00");

    // 4. Verifica o ledger: deve haver exatamente 1 débito de 80.00 (+ 1 crédito de opening 100.00)
    const ledgers = await verifyEm.find(
      WalletLedgerEntryOrmEntity,
      { wallet: wallet.id },
      { orderBy: { createdAt: "ASC" } },
    );

    expect(ledgers).toHaveLength(2);
    expect(ledgers[0].direction).toBe("CREDIT");
    expect(ledgers[0].amount).toBe("100.00");

    expect(ledgers[1].direction).toBe("DEBIT");
    expect(ledgers[1].amount).toBe("80.00");
    expect(ledgers[1].balanceBefore).toBe("100.00");
    expect(ledgers[1].balanceAfter).toBe("20.00");

    // Invariante de ouro: saldo da carteira == saldo reconstruído pelo ledger
    const reconstructedBalance = Number(ledgers[0].amount) - Number(ledgers[1].amount);
    expect(reconstructedBalance.toFixed(2)).toBe(finalWallet.balance);
  });
});

