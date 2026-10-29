import { EntityManager } from "@mikro-orm/postgresql";
import { WalletOrmEntity } from "../../infrastructure/database/entities/wallet.entity";
import { WalletLedgerEntryOrmEntity } from "../../infrastructure/database/entities/wallet-ledger-entry.entity";
import { Money, MoneyProps } from "../../domain/value-objects/money";
import { WalletNotFoundError } from "../errors/application.error";

export interface ReconciliationOutput {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

export class ReconciliationUseCase {
  constructor(private readonly em: EntityManager) {}

  public async execute(walletId: string): Promise<ReconciliationOutput> {
    const forkEm = this.em.fork();

    const wallet = await forkEm.findOne(WalletOrmEntity, { id: walletId });
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    const entries = await forkEm.find(
      WalletLedgerEntryOrmEntity,
      { wallet: walletId },
      { orderBy: { createdAt: "ASC" } },
    );

    let calculated = Money.zero(wallet.currency);

    for (const entry of entries) {
      const entryMoney = Money.from({
        amount: entry.amount,
        currency: entry.currency,
      });

      if (entry.direction === "CREDIT") {
        calculated = calculated.add(entryMoney);
      } else if (entry.direction === "DEBIT") {
        calculated = calculated.subtract(entryMoney);
      }
    }

    const stored = Money.from({
      amount: wallet.balance,
      currency: wallet.currency,
    });

    const diff = stored.subtract(calculated);
    const consistent = diff.isZero();

    if (!consistent) {
      console.warn(
        `[AUDIT_ALERT] Reconciliation mismatch for wallet ${walletId}: stored ${stored.toString()} != calculated ${calculated.toString()}`,
      );
    }

    return {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: diff.toJSON(),
      consistent,
      checkedEntries: entries.length,
    };
  }
}

