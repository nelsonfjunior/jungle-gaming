import {
  Check,
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from "@mikro-orm/core";
import { WalletOrmEntity } from "./wallet.entity";

@Entity({ tableName: "wallet_ledger_entries" })
@Index({ properties: ["wallet", "createdAt"], name: "idx_ledger_wallet_created" })
@Check({ expression: "amount > 0", name: "chk_ledger_amount_positive" })
@Check({ expression: "balance_before >= 0", name: "chk_ledger_balance_before" })
@Check({ expression: "balance_after >= 0", name: "chk_ledger_balance_after" })
@Check({ expression: "direction IN ('DEBIT', 'CREDIT')", name: "chk_ledger_direction" })
export class WalletLedgerEntryOrmEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @ManyToOne(() => WalletOrmEntity, { fieldName: "wallet_id" })
  wallet!: WalletOrmEntity;

  @Property({ type: "varchar", length: 150 })
  @Index({ name: "idx_ledger_transaction" })
  transactionId!: string;

  @Property({ type: "varchar", length: 10 })
  direction!: string;

  @Property({ type: "decimal", precision: 18, scale: 2 })
  amount!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({ type: "decimal", precision: 18, scale: 2 })
  balanceBefore!: string;

  @Property({ type: "decimal", precision: 18, scale: 2 })
  balanceAfter!: string;

  @Property({ type: "timestamptz" })
  createdAt: Date = new Date();
}

