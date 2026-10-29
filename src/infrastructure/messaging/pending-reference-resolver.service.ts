import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { v4 as uuidv4 } from "uuid";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain/entities/wager-transaction";
import { WagerTransactionRejected } from "../../domain/events/events";
import { OutboxMessage } from "../../domain/entities/outbox-message";
import { WagerTransactionOrmEntity } from "../database/entities/wager-transaction.entity";
import { OutboxMessageMapper } from "../database/mappers/outbox-message.mapper";
import { ProcessWagerTransactionUseCase } from "../../application/use-cases/process-wager-transaction.use-case";

export class PendingReferenceResolverService {
  private isRunning = false;
  private timer?: Timer;
  private readonly ttlMs = 10 * 60 * 1000; // 10 minutos de TTL para referências pendentes

  constructor(private readonly orm: MikroORM) {}

  public async start(intervalMs: number = 5000): Promise<void> {
    this.isRunning = true;
    this.timer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await this.resolvePendingReferences();
      } catch (err) {
        console.error("[PendingReferenceResolver] Error resolving references:", err);
      }
    }, intervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  public async resolvePendingReferences(): Promise<number> {
    const em = this.orm.em.fork();
    const now = new Date();

    const pendingTxs = await em.find(
      WagerTransactionOrmEntity,
      { status: WagerTransactionStatus.PendingReference },
      { populate: ["wallet"], limit: 20 },
    );

    let resolvedCount = 0;

    for (const tx of pendingTxs) {
      if (!tx.referenceExternalTransactionId) continue;

      // 1. Verifica se excedeu o TTL (10 minutos)
      const ageMs = now.getTime() - tx.createdAt.getTime();
      if (ageMs > this.ttlMs) {
        // Esgotou o TTL: Rejeita com REFERENCE_NOT_FOUND e emite evento
        await em.transactional(async (txEm) => {
          tx.status = WagerTransactionStatus.Rejected;
          tx.failureCode = "REFERENCE_NOT_FOUND";
          tx.processedAt = now;

          const event = WagerTransactionRejected.create({
            eventId: uuidv4(),
            aggregateId: tx.id,
            correlationId: uuidv4(),
            data: {
              transactionId: tx.id,
              providerId: tx.providerId,
              externalTransactionId: tx.externalTransactionId,
              walletId: tx.wallet.id,
              playerId: tx.playerId,
              roundId: tx.roundId,
              gameId: tx.gameId,
              kind: tx.kind as WagerTransactionKind,
              money: { amount: tx.amount, currency: tx.currency },
              failureCode: "REFERENCE_NOT_FOUND",
              rejectedAt: now.toISOString(),
            },
          });

          txEm.persist(OutboxMessageMapper.toOrm(OutboxMessage.enqueue(event)));
          await txEm.flush();
        });

        resolvedCount++;
        continue;
      }

      // 2. Tenta encontrar a transação referenciada no banco
      const refTx = await em.findOne(WagerTransactionOrmEntity, {
        providerId: tx.providerId,
        externalTransactionId: tx.referenceExternalTransactionId,
      });

      if (refTx && refTx.status === WagerTransactionStatus.Processed) {
        // A referência chegou! Reprocessa pelo caso de uso principal
        const useCase = new ProcessWagerTransactionUseCase(em);
        await useCase.execute({
          providerId: tx.providerId,
          externalTransactionId: tx.externalTransactionId,
          idempotencyKey: tx.idempotencyKey,
          playerId: tx.playerId,
          walletId: tx.wallet.id,
          roundId: tx.roundId,
          gameId: tx.gameId,
          kind: tx.kind as WagerTransactionKind,
          money: { amount: tx.amount, currency: tx.currency },
          referenceExternalTransactionId: tx.referenceExternalTransactionId,
        });

        resolvedCount++;
      }
    }

    return resolvedCount;
  }
}

