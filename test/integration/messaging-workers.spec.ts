import { describe, expect, it, beforeAll, afterAll, beforeEach } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import { SendMessageCommand, SQSClient, PurgeQueueCommand } from "@aws-sdk/client-sqs";
import { v4 as uuidv4 } from "uuid";
import config from "../../src/infrastructure/database/mikro-orm.config";
import { createSqsClient } from "../../src/infrastructure/messaging/sqs-client";
import { OutboxDispatcherService } from "../../src/infrastructure/messaging/outbox-dispatcher.service";
import { SqsWagerConsumerService } from "../../src/infrastructure/messaging/sqs-wager-consumer.service";
import { PendingReferenceResolverService } from "../../src/infrastructure/messaging/pending-reference-resolver.service";
import { OpenWalletUseCase } from "../../src/application/use-cases/open-wallet.use-case";
import { ProcessWagerTransactionUseCase } from "../../src/application/use-cases/process-wager-transaction.use-case";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/entities/wager-transaction";
import { OutboxMessage } from "../../src/domain/entities/outbox-message";
import { WalletBalanceChanged } from "../../src/domain/events/events";
import { LedgerDirection } from "../../src/domain/entities/wallet-ledger-entry";
import { OutboxMessageMapper } from "../../src/infrastructure/database/mappers/outbox-message.mapper";
import { OutboxMessageOrmEntity } from "../../src/infrastructure/database/entities/outbox-message.entity";
import { WalletOrmEntity } from "../../src/infrastructure/database/entities/wallet.entity";
import { WagerTransactionOrmEntity } from "../../src/infrastructure/database/entities/wager-transaction.entity";

describe("Messaging Workers & Resiliency (Integration with LocalStack SQS & PostgreSQL)", () => {
  let orm: MikroORM;
  let sqsClient: SQSClient;
  const queueUrl =
    process.env.SQS_MAIN_QUEUE_URL ||
    "http://localhost:4566/000000000000/wager-transactions.fifo";

  beforeAll(async () => {
    orm = await MikroORM.init(config);
    sqsClient = createSqsClient();
  });

  afterAll(async () => {
    await orm.close(true);
    sqsClient.destroy();
  });

  beforeEach(async () => {
    const em = orm.em.fork();
    const knex = em.getKnex();
    // Limpa a outbox e o inbox antes de cada teste para isolamento limpo
    await knex("outbox_messages").delete();
    await knex("inbox_messages").delete();
  });

  it("should dispatch pending outbox messages without duplication under concurrent publishers (SKIP LOCKED)", async () => {
    const em = orm.em.fork();
    const eventIds: string[] = [];

    // Cria 10 eventos na Outbox
    for (let i = 0; i < 10; i++) {
      const eventId = uuidv4();
      eventIds.push(eventId);
      const event = WalletBalanceChanged.create({
        eventId,
        aggregateId: `wallet-outbox-${i}`,
        correlationId: uuidv4(),
        data: {
          walletId: `wallet-outbox-${i}`,
          transactionId: `tx-${i}`,
          direction: LedgerDirection.Credit,
          money: { amount: "10.00", currency: "BRL" },
          balanceBefore: { amount: "0.00", currency: "BRL" },
          balanceAfter: { amount: "10.00", currency: "BRL" },
          walletVersion: 1,
        },
      });
      em.persist(OutboxMessageMapper.toOrm(OutboxMessage.enqueue(event)));
    }
    await em.flush();

    // Cria duas instâncias concorrentes de dispatcher simulando múltiplos nós
    const dispatcher1 = new OutboxDispatcherService(orm, sqsClient, queueUrl);
    const dispatcher2 = new OutboxDispatcherService(orm, sqsClient, queueUrl);

    // Executa ambas simultaneamente com SKIP LOCKED
    const [dispatched1, dispatched2] = await Promise.all([
      dispatcher1.dispatchPendingMessages(10),
      dispatcher2.dispatchPendingMessages(10),
    ]);

    // O total deve ser exatamente 10 e nenhuma mensagem duplicada
    expect(dispatched1 + dispatched2).toBe(10);

    const checkEm = orm.em.fork();
    const publishedList = await checkEm.find(OutboxMessageOrmEntity, {
      id: { $in: eventIds },
    });
    expect(publishedList).toHaveLength(10);
    for (const msg of publishedList) {
      expect(msg.publishedAt).not.toBeNull();
      expect(msg.attempts).toBe(0);
    }
  });

  it("should consume SQS message, process wager, and prevent duplicate debit on redelivery via Inbox", async () => {
    const openWalletUseCase = new OpenWalletUseCase(orm.em.fork());
    const playerId = uuidv4();

    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const consumer = new SqsWagerConsumerService(sqsClient, orm, queueUrl);

    const messageId = `msg-sqs-${uuidv4()}`;
    const externalTxId = `ext-sqs-${uuidv4()}`;
    const idempotencyKey = `key-sqs-${uuidv4()}`;

    const sqsMessagePayload = {
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "provider-sqs",
        externalTransactionId: externalTxId,
        idempotencyKey,
        playerId,
        walletId: wallet.id,
        roundId: "round-sqs-1",
        gameId: "mega-spin",
        kind: "BET",
        money: { amount: "35.00", currency: "BRL" },
      },
    };

    // 1. Processa a mensagem diretamente pelo consumidor (simulando polling ou via SQS)
    await consumer.processMessage(JSON.stringify(sqsMessagePayload), messageId);

    // Saldo deve ter caído de 100.00 para 65.00
    const checkEm = orm.em.fork();
    const updatedWallet = await checkEm.findOneOrFail(WalletOrmEntity, {
      id: wallet.id,
    });
    expect(updatedWallet.balance).toBe("65.00");

    // 2. Simula REDELIVERY da AWS (a mesma mensagem chega de novo com o mesmo messageId)
    // O consumidor detecta no Inbox persistente e NÃO duplica o débito
    await consumer.processMessage(JSON.stringify(sqsMessagePayload), messageId);

    const checkAgainEm = orm.em.fork();
    const finalWallet = await checkAgainEm.findOneOrFail(WalletOrmEntity, {
      id: wallet.id,
    });
    expect(finalWallet.balance).toBe("65.00"); // Permanece 65.00, sem débito duplicado!
  });

  it("should resolve PENDING_REFERENCE when BET arrives later", async () => {
    const openWalletUseCase = new OpenWalletUseCase(orm.em.fork());
    const processWagerUseCase = new ProcessWagerTransactionUseCase(orm.em.fork());
    const resolver = new PendingReferenceResolverService(orm);

    const playerId = uuidv4();
    const wallet = await openWalletUseCase.execute({
      playerId,
      initialBalance: { amount: "100.00", currency: "BRL" },
    });

    const betExtId = `bet-late-${uuidv4()}`;
    const refundExtId = `refund-early-${uuidv4()}`;

    // 1. O REFUND chega ANTES da BET
    const refundOutput = await processWagerUseCase.execute({
      providerId: "provider-late",
      externalTransactionId: refundExtId,
      idempotencyKey: `idemp-ref-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-late",
      gameId: "chimp",
      kind: WagerTransactionKind.Refund,
      money: { amount: "30.00", currency: "BRL" },
      referenceExternalTransactionId: betExtId,
    });

    expect(refundOutput.status).toBe(WagerTransactionStatus.PendingReference);

    // 2. Agora a BET finalmente chega e é processada (debita 30.00 -> saldo 70.00)
    await processWagerUseCase.execute({
      providerId: "provider-late",
      externalTransactionId: betExtId,
      idempotencyKey: `idemp-bet-${uuidv4()}`,
      playerId,
      walletId: wallet.id,
      roundId: "round-late",
      gameId: "chimp",
      kind: WagerTransactionKind.Bet,
      money: { amount: "30.00", currency: "BRL" },
    });

    // 3. O PendingReferenceResolverService roda para resolver transações pendentes
    const resolved = await resolver.resolvePendingReferences();
    expect(resolved).toBeGreaterThanOrEqual(1);

    // Confere se o REFUND foi aplicado e o saldo foi restaurado para 100.00
    const checkEm = orm.em.fork();
    const finalWallet = await checkEm.findOneOrFail(WalletOrmEntity, {
      id: wallet.id,
    });
    expect(finalWallet.balance).toBe("100.00");

    const refundTx = await checkEm.findOneOrFail(WagerTransactionOrmEntity, {
      externalTransactionId: refundExtId,
    });
    expect(refundTx.status).toBe(WagerTransactionStatus.Processed);
  });
});
