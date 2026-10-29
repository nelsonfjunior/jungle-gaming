import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { OutboxMessageOrmEntity } from "../database/entities/outbox-message.entity";
import { OutboxMessageMapper } from "../database/mappers/outbox-message.mapper";

export interface OutboxDispatcherOptions {
  batchSize?: number;
  queueUrl?: string;
}

export class OutboxDispatcherService {
  private isRunning = false;
  private timer?: Timer;

  constructor(
    private readonly orm: MikroORM,
    private readonly sqsClient: SQSClient,
    private readonly queueUrl: string = process.env.SQS_MAIN_QUEUE_URL || "",
  ) {}

  public async start(intervalMs: number = 1000): Promise<void> {
    this.isRunning = true;
    this.timer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await this.dispatchPendingMessages();
      } catch (err) {
        console.error("[OutboxDispatcher] Error dispatching batch:", err);
      }
    }, intervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /**
   * Processa um lote de mensagens pendentes utilizando FOR UPDATE SKIP LOCKED
   * permitindo concorrência segura entre múltiplos publishers simultâneos.
   */
  public async dispatchPendingMessages(batchSize: number = 20): Promise<number> {
    const em = this.orm.em.fork();

    return em.transactional(async (txEm) => {
      const now = new Date();

      // Busca mensagens prontas para publicação com SKIP LOCKED via SQL nativo dentro da transação
      const rawRows = await txEm.execute(
        `SELECT id FROM "outbox_messages" 
         WHERE "published_at" IS NULL 
           AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ?)
         ORDER BY "occurred_at" ASC 
         LIMIT ? 
         FOR UPDATE SKIP LOCKED`,
        [now, batchSize],
      );

      if (!rawRows || rawRows.length === 0) {
        return 0;
      }

      const ids = rawRows.map((r: any) => r.id);
      const ormEntities = await txEm.find(OutboxMessageOrmEntity, { id: { $in: ids } });

      for (const ormEntity of ormEntities) {
        const domainOutbox = OutboxMessageMapper.toDomain(ormEntity);

        try {
          if (this.queueUrl) {
            const command = new SendMessageCommand({
              QueueUrl: this.queueUrl,
              MessageBody: JSON.stringify(domainOutbox.payload),
              MessageGroupId: domainOutbox.aggregateId, // Mantém ordem estrita por aggregateId (walletId/txId)
              MessageDeduplicationId: domainOutbox.id,   // Deduplicação pelo ID do evento
            });
            await this.sqsClient.send(command);
          }

          domainOutbox.markPublished(new Date());
        } catch (publishErr) {
          console.error(
            `[OutboxDispatcher] Failed to publish message ${domainOutbox.id}. Scheduling retry...`,
            publishErr,
          );
          domainOutbox.scheduleRetry(new Date());
        }

        // Atualiza a entidade ORM
        ormEntity.publishedAt = domainOutbox.publishedAt;
        ormEntity.nextAttemptAt = domainOutbox.nextAttemptAt;
        ormEntity.attempts = domainOutbox.attempts;
      }

      await txEm.flush();
      return ormEntities.length;
    });
  }
}
