import { Wallet } from "../../../domain/entities/wallet";
import { Money } from "../../../domain/value-objects/money";
import { WalletOrmEntity } from "../entities/wallet.entity";

export class WalletMapper {
  public static toDomain(orm: WalletOrmEntity): Wallet {
    return Wallet.rehydrate({
      id: orm.id,
      playerId: orm.playerId,
      currency: orm.currency,
      balance: Money.from({ amount: orm.balance, currency: orm.currency }),
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  public static toOrm(domain: Wallet): WalletOrmEntity {
    const orm = new WalletOrmEntity();
    orm.id = domain.id;
    orm.playerId = domain.playerId;
    orm.currency = domain.currency;
    orm.balance = domain.balance.toString();
    orm.version = domain.version;
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.updatedAt;
    return orm;
  }
}

