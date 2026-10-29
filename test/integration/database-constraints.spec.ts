import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import { v4 as uuidv4 } from "uuid";
import config from "../../src/infrastructure/database/mikro-orm.config";
import { WalletOrmEntity } from "../../src/infrastructure/database/entities/wallet.entity";
import { InboxMessageOrmEntity } from "../../src/infrastructure/database/entities/inbox-message.entity";

describe("Database Schema Constraints (PostgreSQL)", () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await MikroORM.init(config);
  });

  afterAll(async () => {
    await orm.close(true);
  });

  it("should enforce CHECK (balance >= 0) at PostgreSQL database level", async () => {
    const em = orm.em.fork();
    const wallet = new WalletOrmEntity();
    wallet.id = uuidv4();
    wallet.playerId = uuidv4();
    wallet.currency = "BRL";
    wallet.balance = "-10.00"; // Negativo! Deve estourar no banco
    wallet.version = 1;

    em.persist(wallet);

    let errorCaught: any = null;
    try {
      await em.flush();
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).not.toBeNull();
    // Verifica se violou a constraint chk_wallet_balance_positive
    expect(errorCaught.message).toContain("chk_wallet_balance_positive");
  });

  it("should enforce UNIQUE (player_id, currency) constraint", async () => {
    const em = orm.em.fork();
    const playerId = uuidv4();

    const w1 = new WalletOrmEntity();
    w1.id = uuidv4();
    w1.playerId = playerId;
    w1.currency = "BRL";
    w1.balance = "50.00";
    w1.version = 1;
    em.persist(w1);
    await em.flush();

    const w2 = new WalletOrmEntity();
    w2.id = uuidv4();
    w2.playerId = playerId; // Mesmo player e mesma moeda!
    w2.currency = "BRL";
    w2.balance = "100.00";
    w2.version = 1;
    em.persist(w2);

    let errorCaught: any = null;
    try {
      await em.flush();
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).not.toBeNull();
    expect(errorCaught.message).toContain("uq_wallet_player_currency");
  });

  it("should enforce PRIMARY KEY (consumer_name, message_id) on inbox messages", async () => {
    const em = orm.em.fork();
    const messageId = `msg-${uuidv4()}`;
    const consumerName = "sqs-wager-consumer";

    const msg1 = new InboxMessageOrmEntity();
    msg1.consumerName = consumerName;
    msg1.messageId = messageId;
    msg1.payloadHash = "hash1";
    em.persist(msg1);
    await em.flush();

    const msg2 = new InboxMessageOrmEntity();
    msg2.consumerName = consumerName;
    msg2.messageId = messageId; // Duplicada!
    msg2.payloadHash = "hash2";
    em.persist(msg2);

    let errorCaught: any = null;
    try {
      await em.flush();
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).not.toBeNull();
    expect(errorCaught.message).toContain("inbox_messages_pkey");
  });
});

