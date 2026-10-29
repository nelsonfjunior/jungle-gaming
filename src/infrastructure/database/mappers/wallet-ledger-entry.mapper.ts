import {
  LedgerDirection,
  WalletLedgerEntry,
} from "../../../domain/entities/wallet-ledger-entry";
import { Money } from "../../../domain/value-objects/money";
import { WalletLedgerEntryOrmEntity } from "../entities/wallet-ledger-entry.entity";
import { WalletOrmEntity } from "../entities/wallet.entity";

export class WalletLedgerEntryMapper {
  public static toDomain(orm: WalletLedgerEntryOrmEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: orm.id,
      walletId: orm.wallet.id,
      transactionId: orm.transactionId,
      direction: orm.direction as LedgerDirection,
      money: Money.from({ amount: orm.amount, currency: orm.currency }),
      balanceBefore: Money.from({
        amount: orm.balanceBefore,
        currency: orm.currency,
      }),
      balanceAfter: Money.from({
        amount: orm.balanceAfter,
        currency: orm.currency,
      }),
      createdAt: orm.createdAt,
    });
  }

  public static toOrm(
    domain: WalletLedgerEntry,
    walletOrmRef: WalletOrmEntity,
  ): WalletLedgerEntryOrmEntity {
    const orm = new WalletLedgerEntryOrmEntity();
    orm.id = domain.id;
    orm.wallet = walletOrmRef;
    orm.transactionId = domain.transactionId;
    orm.direction = domain.direction;
    orm.amount = domain.money.toString();
    orm.currency = domain.money.currency;
    orm.balanceBefore = domain.balanceBefore.toString();
    orm.balanceAfter = domain.balanceAfter.toString();
    orm.createdAt = domain.createdAt;
    return orm;
  }
}

