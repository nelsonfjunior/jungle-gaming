import { OutboxMessage } from "../../../domain/entities/outbox-message";
import { OutboxMessageOrmEntity } from "../entities/outbox-message.entity";

export class OutboxMessageMapper {
  public static toDomain(orm: OutboxMessageOrmEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: orm.id,
      aggregateId: orm.aggregateId,
      eventType: orm.eventType,
      payload: orm.payload,
      occurredAt: orm.occurredAt,
      attempts: orm.attempts,
      nextAttemptAt: orm.nextAttemptAt,
      publishedAt: orm.publishedAt,
    });
  }

  public static toOrm(domain: OutboxMessage): OutboxMessageOrmEntity {
    const orm = new OutboxMessageOrmEntity();
    orm.id = domain.id;
    orm.aggregateId = domain.aggregateId;
    orm.eventType = domain.eventType;
    orm.payload = domain.payload as Record<string, unknown>;
    orm.occurredAt = domain.occurredAt;
    orm.attempts = domain.attempts;
    orm.nextAttemptAt = domain.nextAttemptAt;
    orm.publishedAt = domain.publishedAt;
    return orm;
  }
}

