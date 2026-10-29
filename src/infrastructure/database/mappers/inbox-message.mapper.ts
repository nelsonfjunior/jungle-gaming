import { InboxMessage } from "../../../domain/entities/inbox-message";
import { InboxMessageOrmEntity } from "../entities/inbox-message.entity";

export class InboxMessageMapper {
  public static toDomain(orm: InboxMessageOrmEntity): InboxMessage {
    return InboxMessage.rehydrate({
      consumerName: orm.consumerName,
      messageId: orm.messageId,
      payloadHash: orm.payloadHash,
      receivedAt: orm.receivedAt,
      processedAt: orm.processedAt,
    });
  }

  public static toOrm(domain: InboxMessage): InboxMessageOrmEntity {
    const orm = new InboxMessageOrmEntity();
    orm.consumerName = domain.consumerName;
    orm.messageId = domain.messageId;
    orm.payloadHash = domain.payloadHash;
    orm.receivedAt = domain.receivedAt;
    orm.processedAt = domain.processedAt;
    return orm;
  }
}

