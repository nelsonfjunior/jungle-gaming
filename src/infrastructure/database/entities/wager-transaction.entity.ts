import {
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from "@mikro-orm/core";
import { WalletOrmEntity } from "./wallet.entity";

@Entity({ tableName: "wager_transactions" })
@Unique({
  properties: ["providerId", "externalTransactionId"],
  name: "uq_wager_provider_external_id",
})
@Unique({
  properties: ["idempotencyKey"],
  name: "uq_wager_idempotency_key",
})
export class WagerTransactionOrmEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "varchar", length: 100 })
  providerId!: string;

  @Property({ type: "varchar", length: 150 })
  externalTransactionId!: string;

  @Property({ type: "varchar", length: 255 })
  idempotencyKey!: string;

  @Property({ type: "varchar", length: 64 })
  payloadHash!: string;

  @ManyToOne(() => WalletOrmEntity, { fieldName: "wallet_id" })
  wallet!: WalletOrmEntity;

  @Property({ type: "varchar", length: 100 })
  @Index({ name: "idx_wager_player" })
  playerId!: string;

  @Property({ type: "varchar", length: 100 })
  @Index({ name: "idx_wager_round" })
  roundId!: string;

  @Property({ type: "varchar", length: 100 })
  gameId!: string;

  @Property({ type: "varchar", length: 20 })
  kind!: string;

  @Property({ type: "decimal", precision: 18, scale: 2 })
  amount!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({ type: "varchar", length: 150, nullable: true })
  @Index({ name: "idx_wager_ref_ext_tx" })
  referenceExternalTransactionId?: string;

  @Property({ type: "uuid", nullable: true })
  referenceTransactionId?: string;

  @Property({ type: "varchar", length: 30 })
  @Index({ name: "idx_wager_status" })
  status!: string;

  @Property({ type: "varchar", length: 50, nullable: true })
  failureCode?: string;

  @Property({ type: "timestamptz" })
  createdAt: Date = new Date();

  @Property({ type: "timestamptz", nullable: true })
  processedAt?: Date;
}

