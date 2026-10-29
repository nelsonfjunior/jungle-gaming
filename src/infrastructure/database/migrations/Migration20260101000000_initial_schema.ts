import { Migration } from "@mikro-orm/migrations";

export class Migration20260101000000_initial_schema extends Migration {
  public async up(): Promise<void> {
    // 1. Wallets Table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wallets" (
        "id" UUID PRIMARY KEY,
        "player_id" VARCHAR(100) NOT NULL,
        "currency" VARCHAR(3) NOT NULL,
        "balance" NUMERIC(18, 2) NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "chk_wallet_balance_positive" CHECK ("balance" >= 0),
        CONSTRAINT "uq_wallet_player_currency" UNIQUE ("player_id", "currency")
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_wallet_player" ON "wallets" ("player_id");
    `);

    // 2. Wallet Ledger Entries Table (Immutable Audit Log)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wallet_ledger_entries" (
        "id" UUID PRIMARY KEY,
        "wallet_id" UUID NOT NULL REFERENCES "wallets" ("id") ON DELETE RESTRICT,
        "transaction_id" VARCHAR(150) NOT NULL,
        "direction" VARCHAR(10) NOT NULL,
        "amount" NUMERIC(18, 2) NOT NULL,
        "currency" VARCHAR(3) NOT NULL,
        "balance_before" NUMERIC(18, 2) NOT NULL,
        "balance_after" NUMERIC(18, 2) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "chk_ledger_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "chk_ledger_balance_before" CHECK ("balance_before" >= 0),
        CONSTRAINT "chk_ledger_balance_after" CHECK ("balance_after" >= 0),
        CONSTRAINT "chk_ledger_direction" CHECK ("direction" IN ('DEBIT', 'CREDIT'))
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_ledger_wallet_created" ON "wallet_ledger_entries" ("wallet_id", "created_at" DESC);
      CREATE INDEX IF NOT EXISTS "idx_ledger_transaction" ON "wallet_ledger_entries" ("transaction_id");
    `);

    // 3. Wager Transactions Table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wager_transactions" (
        "id" UUID PRIMARY KEY,
        "provider_id" VARCHAR(100) NOT NULL,
        "external_transaction_id" VARCHAR(150) NOT NULL,
        "idempotency_key" VARCHAR(255) NOT NULL,
        "payload_hash" VARCHAR(64) NOT NULL,
        "wallet_id" UUID NOT NULL REFERENCES "wallets" ("id") ON DELETE RESTRICT,
        "player_id" VARCHAR(100) NOT NULL,
        "round_id" VARCHAR(100) NOT NULL,
        "game_id" VARCHAR(100) NOT NULL,
        "kind" VARCHAR(20) NOT NULL,
        "amount" NUMERIC(18, 2) NOT NULL,
        "currency" VARCHAR(3) NOT NULL,
        "reference_external_transaction_id" VARCHAR(150),
        "reference_transaction_id" UUID,
        "status" VARCHAR(30) NOT NULL,
        "failure_code" VARCHAR(50),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "processed_at" TIMESTAMPTZ,
        CONSTRAINT "chk_wager_amount_positive" CHECK ("amount" >= 0),
        CONSTRAINT "uq_wager_provider_external_id" UNIQUE ("provider_id", "external_transaction_id"),
        CONSTRAINT "uq_wager_idempotency_key" UNIQUE ("idempotency_key")
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_wager_player" ON "wager_transactions" ("player_id");
      CREATE INDEX IF NOT EXISTS "idx_wager_round" ON "wager_transactions" ("round_id");
      CREATE INDEX IF NOT EXISTS "idx_wager_ref_ext_tx" ON "wager_transactions" ("provider_id", "reference_external_transaction_id");
      CREATE INDEX IF NOT EXISTS "idx_wager_status" ON "wager_transactions" ("status");
    `);

    // 4. Inbox Messages Table (Transactional Deduplication)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "inbox_messages" (
        "consumer_name" VARCHAR(100) NOT NULL,
        "message_id" VARCHAR(150) NOT NULL,
        "payload_hash" VARCHAR(64) NOT NULL,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "processed_at" TIMESTAMPTZ,
        PRIMARY KEY ("consumer_name", "message_id")
      );
    `);

    // 5. Outbox Messages Table (Transactional Outbox Pattern)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "outbox_messages" (
        "id" UUID PRIMARY KEY,
        "aggregate_id" VARCHAR(100) NOT NULL,
        "event_type" VARCHAR(100) NOT NULL,
        "payload" JSONB NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ,
        "published_at" TIMESTAMPTZ
      );
    `);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_pending_dispatch" 
      ON "outbox_messages" ("next_attempt_at") 
      WHERE "published_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_outbox_aggregate" ON "outbox_messages" ("aggregate_id");
    `);
  }

  public async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "outbox_messages" CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS "inbox_messages" CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS "wager_transactions" CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS "wallet_ledger_entries" CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS "wallets" CASCADE;`);
  }
}

