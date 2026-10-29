import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../domain/entities/wager-transaction";
import { Money } from "../../../domain/value-objects/money";
import { WagerTransactionOrmEntity } from "../entities/wager-transaction.entity";
import { WalletOrmEntity } from "../entities/wallet.entity";

export class WagerTransactionMapper {
  public static toDomain(orm: WagerTransactionOrmEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: orm.id,
      providerId: orm.providerId,
      externalTransactionId: orm.externalTransactionId,
      idempotencyKey: orm.idempotencyKey,
      payloadHash: orm.payloadHash,
      walletId: orm.wallet.id,
      playerId: orm.playerId,
      roundId: orm.roundId,
      gameId: orm.gameId,
      kind: orm.kind as WagerTransactionKind,
      money: Money.from({ amount: orm.amount, currency: orm.currency }),
      referenceExternalTransactionId: orm.referenceExternalTransactionId,
      createdAt: orm.createdAt,
      status: orm.status as WagerTransactionStatus,
      referenceTransactionId: orm.referenceTransactionId,
      failureCode: orm.failureCode as FailureCode | undefined,
      processedAt: orm.processedAt,
    });
  }

  public static toOrm(
    domain: WagerTransaction,
    walletOrmRef: WalletOrmEntity,
  ): WagerTransactionOrmEntity {
    const orm = new WagerTransactionOrmEntity();
    orm.id = domain.id;
    orm.providerId = domain.providerId;
    orm.externalTransactionId = domain.externalTransactionId;
    orm.idempotencyKey = domain.idempotencyKey;
    orm.payloadHash = domain.payloadHash;
    orm.wallet = walletOrmRef;
    orm.playerId = domain.playerId;
    orm.roundId = domain.roundId;
    orm.gameId = domain.gameId;
    orm.kind = domain.kind;
    orm.amount = domain.money.toString();
    orm.currency = domain.money.currency;
    orm.referenceExternalTransactionId = domain.referenceExternalTransactionId;
    orm.referenceTransactionId = domain.referenceTransactionId;
    orm.status = domain.status;
    orm.failureCode = domain.failureCode;
    orm.createdAt = domain.createdAt;
    orm.processedAt = domain.processedAt;
    return orm;
  }
}

