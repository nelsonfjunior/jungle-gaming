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
import {
  IdempotencyConflictError,
  WalletConflictError,
} from "../../src/application/errors/application.error";
import { WalletLedgerEntryOrmEntity } from "../../src/infrastructure/database/entities/wallet-ledger-entry.entity";

describe("Wager Use Cases & Business Rules (Integration with PostgreSQL)", () => {
  let orm: MikroORM;
  let openWalletUseCase: OpenWalletUseCase;
  let processWagerUseCase: ProcessWagerTransactionUseCase;

  beforeAll(async () => {
    orm = await MikroORM.init(config);
    openWalletUseCase = new OpenWalletUseCase(orm.em);
    processWagerUseCase = new ProcessWagerTransactionUseCase(orm.em);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("should open a wallet and automatically create OPENING transaction and CREDIT ledger entry", async () => {
    const playerId = uuidv4();
    const result = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    expect(result.id).toBeDefined();
    expect(result.playerId).toBe(playerId);
    expect(result.balance.amount).toBe("100.00");
    expect(result.version).toBe(1);

    // Confere se o ledger foi gravado
    const em = orm.em.fork();
    const ledgers = await em.find(WalletLedgerEntryOrmEntity, {
      wallet: result.id,
    });
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].direction).toBe("CREDIT");
    expect(ledgers[0].amount).toBe("100.00");
    expect(ledgers[0].balanceBefore).toBe("0.00");
    expect(ledgers[0].balanceAfter).toBe("100.00");
  });

  it("should fail when creating a duplicate wallet for the same player and currency", async () => {
    const playerId = uuidv4();
    await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "50.00", currency: "BRL" },
    });

    expect(
      openWalletUseCase.execute({
        playerId,
        initialBalance: { amount: "100.00", currency: "BRL" },
      }),
    ).rejects.toThrow(WalletConflictError);
  });

  it("should process BET with sufficient balance and update balance + ledger", async () => {
    const playerId = uuidv4();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const output = await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: `tx-${uuidv4()}`,
      idempotencyKey: `key-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "slots",
      kind: WagerTransactionKind.Bet,
      money: { amount: "30.00", currency: "BRL" },
    });

    expect(output.status).toBe(WagerTransactionStatus.Processed);
    expect(output.balance.amount).toBe("70.00");
    expect(output.idempotentReplay).toBe(false);

    const em = orm.em.fork();
    const ledgers = await em.find(WalletLedgerEntryOrmEntity, {
      wallet: wallet.id,
    });
    // 1 de opening + 1 de bet = 2
    expect(ledgers).toHaveLength(2);
  });

  it("should REJECT a BET when balance is insufficient (no ledger entry created)", async () => {
    const playerId = uuidv4();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "50.00", currency: "BRL" },
    });

    const output = await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: `tx-${uuidv4()}`,
      idempotencyKey: `key-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-2",
      gameId: "slots",
      kind: WagerTransactionKind.Bet,
      money: { amount: "80.00", currency: "BRL" },
    });

    expect(output.status).toBe(WagerTransactionStatus.Rejected);
    expect(output.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(output.balance.amount).toBe("50.00"); // Saldo inalterado

    const em = orm.em.fork();
    const ledgers = await em.find(WalletLedgerEntryOrmEntity, {
      wallet: wallet.id,
    });
    // Somente o opening
    expect(ledgers).toHaveLength(1);
  });

  it("should support idempotent replay and reject payload conflict with same key", async () => {
    const playerId = uuidv4();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const idempotencyKey = `idemp-${uuidv4()}`;
    const externalTxId = `ext-${uuidv4()}`;

    // 1ª execução
    const firstCall = await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: externalTxId,
      idempotencyKey,
      playerId,
      walletId: wallet.id,
      roundId: "round-3",
      gameId: "slots",
      kind: WagerTransactionKind.Bet,
      money: { amount: "20.00", currency: "BRL" },
    });

    expect(firstCall.status).toBe(WagerTransactionStatus.Processed);
    expect(firstCall.idempotentReplay).toBe(false);
    expect(firstCall.balance.amount).toBe("80.00");

    // 2ª execução com dados idênticos (Idempotent Replay)
    const replayCall = await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: externalTxId,
      idempotencyKey,
      playerId,
      walletId: wallet.id,
      roundId: "round-3",
      gameId: "slots",
      kind: WagerTransactionKind.Bet,
      money: { amount: "20.00", currency: "BRL" },
    });

    expect(replayCall.transactionId).toBe(firstCall.transactionId);
    expect(replayCall.idempotentReplay).toBe(true);
    expect(replayCall.balance.amount).toBe("80.00");

    // 3ª execução com a MESMA chave mas valor alterado (Conflito de Payload)
    expect(
      processWagerUseCase.execute({
        providerId: "provider-x",
        externalTransactionId: externalTxId,
        idempotencyKey,
        playerId,
        walletId: wallet.id,
        roundId: "round-3",
        gameId: "slots",
        kind: WagerTransactionKind.Bet,
        money: { amount: "25.00", currency: "BRL" }, // Modificado!
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("should mark REFUND as PENDING_REFERENCE if BET has not arrived yet", async () => {
    const playerId = uuidv4();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const output = await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: `refund-${uuidv4()}`,
      idempotencyKey: `ref-key-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-4",
      gameId: "slots",
      kind: WagerTransactionKind.Refund,
      money: { amount: "20.00", currency: "BRL" },
      referenceExternalTransactionId: "non-existent-bet-yet",
    });

    expect(output.status).toBe(WagerTransactionStatus.PendingReference);
    expect(output.balance.amount).toBe("100.00"); // Saldo intacto enquanto espera
  });

  it("should process REFUND for an existing BET and block double refund", async () => {
    const playerId = uuidv4();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const betExtId = `bet-${uuidv4()}`;

    // 1. Faz a aposta de 40.00
    await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: betExtId,
      idempotencyKey: `key-bet-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-5",
      gameId: "slots",
      kind: WagerTransactionKind.Bet,
      money: { amount: "40.00", currency: "BRL" },
    });

    // 2. Estorna a aposta via REFUND
    const refundOutput = await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: `refund-${uuidv4()}`,
      idempotencyKey: `key-ref-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-5",
      gameId: "slots",
      kind: WagerTransactionKind.Refund,
      money: { amount: "40.00", currency: "BRL" },
      referenceExternalTransactionId: betExtId,
    });

    expect(refundOutput.status).toBe(WagerTransactionStatus.Processed);
    expect(refundOutput.balance.amount).toBe("100.00"); // Estornado para 100.00

    // 3. Tenta estornar uma segunda vez a mesma aposta: deve rejeitar REFERENCE_ALREADY_REVERTED
    const doubleRefund = await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: `refund-2-${uuidv4()}`,
      idempotencyKey: `key-ref-2-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-5",
      gameId: "slots",
      kind: WagerTransactionKind.Refund,
      money: { amount: "40.00", currency: "BRL" },
      referenceExternalTransactionId: betExtId,
    });

    expect(doubleRefund.status).toBe(WagerTransactionStatus.Rejected);
    expect(doubleRefund.failureCode).toBe("REFERENCE_ALREADY_REVERTED");
  });

  it("should reject ROLLBACK if reversal would produce negative balance (Rule 7.9)", async () => {
    const playerId = uuidv4();
    // Carteira com 0.00 inicial
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "0.00", currency: "BRL" },
    });

    const winExtId = `win-${uuidv4()}`;

    // 1. Jogador ganha 50.00 via WIN
    await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: winExtId,
      idempotencyKey: `key-win-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-6",
      gameId: "roulette",
      kind: WagerTransactionKind.Win,
      money: { amount: "50.00", currency: "BRL" },
    });

    // 2. Jogador gasta 40.00 via BET
    await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: `bet-${uuidv4()}`,
      idempotencyKey: `key-bet-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-6",
      gameId: "roulette",
      kind: WagerTransactionKind.Bet,
      money: { amount: "40.00", currency: "BRL" },
    });

    // Saldo atual é 10.00. Agora o provedor tenta dar ROLLBACK no prêmio de 50.00.
    // Se tirasse 50.00 de 10.00, ficaria -40.00!
    // A Regra 7.9 exige rejeição com REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE
    const rollbackOutput = await processWagerUseCase.execute({
      providerId: "provider-x",
      externalTransactionId: `rollback-${uuidv4()}`,
      idempotencyKey: `key-roll-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-6",
      gameId: "roulette",
      kind: WagerTransactionKind.Rollback,
      money: { amount: "50.00", currency: "BRL" },
      referenceExternalTransactionId: winExtId,
    });

    expect(rollbackOutput.status).toBe(WagerTransactionStatus.Rejected);
    expect(rollbackOutput.failureCode).toBe(
      "REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE",
    );
    expect(rollbackOutput.balance.amount).toBe("10.00"); // Saldo intacto
  });
});
