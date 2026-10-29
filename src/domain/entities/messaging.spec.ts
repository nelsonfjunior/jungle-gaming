import { describe, expect, it } from "bun:test";
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
} from "../events/events";
import { LedgerDirection } from "./wallet-ledger-entry";
import { InboxMessage } from "./inbox-message";
import { OutboxMessage } from "./outbox-message";
import { WagerTransactionKind } from "./wager-transaction";

describe("Inbox and Outbox Messaging Entities", () => {
  describe("InboxMessage", () => {
    it("should receive message in unread state and mark as processed", () => {
      const inbox = InboxMessage.receive({
        messageId: "msg-1",
        consumerName: "sqs-wager-consumer",
        payloadHash: "hash-abc",
      });

      expect(inbox.messageId).toBe("msg-1");
      expect(inbox.isProcessed()).toBe(false);
      expect(inbox.processedAt).toBeUndefined();

      const now = new Date();
      inbox.markProcessed(now);

      expect(inbox.isProcessed()).toBe(true);
      expect(inbox.processedAt).toEqual(now);
    });
  });

  describe("OutboxMessage", () => {
    it("should enqueue integration event and become due immediately", () => {
      const event = WalletBalanceChanged.create({
        eventId: "evt-1",
        aggregateId: "wallet-1",
        correlationId: "corr-1",
        data: {
          walletId: "wallet-1",
          transactionId: "tx-1",
          direction: LedgerDirection.Credit,
          money: { amount: "100.00", currency: "BRL" },
          balanceBefore: { amount: "0.00", currency: "BRL" },
          balanceAfter: { amount: "100.00", currency: "BRL" },
          walletVersion: 2,
        },
      });

      const outbox = OutboxMessage.enqueue(event);

      expect(outbox.id).toBe("evt-1");
      expect(outbox.aggregateId).toBe("wallet-1");
      expect(outbox.eventType).toBe("WalletBalanceChanged");
      expect(outbox.isPending()).toBe(true);
      expect(outbox.isDue(new Date())).toBe(true);
      expect(outbox.attempts).toBe(0);
    });

    it("should mark outbox as published", () => {
      const event = WagerTransactionProcessed.create({
        eventId: "evt-2",
        aggregateId: "tx-2",
        correlationId: "corr-2",
        data: {
          transactionId: "tx-2",
          providerId: "provider-a",
          externalTransactionId: "ext-2",
          walletId: "wallet-1",
          playerId: "player-1",
          roundId: "round-1",
          gameId: "game-1",
          kind: WagerTransactionKind.Bet,
          money: { amount: "20.00", currency: "BRL" },
          processedAt: new Date().toISOString(),
        },
      });

      const outbox = OutboxMessage.enqueue(event);
      const now = new Date();
      outbox.markPublished(now);

      expect(outbox.isPending()).toBe(false);
      expect(outbox.publishedAt).toEqual(now);
      expect(outbox.isDue(now)).toBe(false);
    });

    it("should schedule retry with exponential backoff", () => {
      const event = WalletBalanceChanged.create({
        eventId: "evt-3",
        aggregateId: "wallet-1",
        correlationId: "corr-3",
        data: {
          walletId: "wallet-1",
          transactionId: "tx-3",
          direction: LedgerDirection.Debit,
          money: { amount: "10.00", currency: "BRL" },
          balanceBefore: { amount: "100.00", currency: "BRL" },
          balanceAfter: { amount: "90.00", currency: "BRL" },
          walletVersion: 3,
        },
      });

      const outbox = OutboxMessage.enqueue(event);
      const now = new Date("2026-01-01T10:00:00.000Z");

      // Tentativa 1: +1s (1000ms * 2^0)
      outbox.scheduleRetry(now);
      expect(outbox.attempts).toBe(1);
      expect(outbox.nextAttemptAt?.toISOString()).toBe("2026-01-01T10:00:01.000Z");

      // Tentativa 2: +2s (1000ms * 2^1)
      outbox.scheduleRetry(now);
      expect(outbox.attempts).toBe(2);
      expect(outbox.nextAttemptAt?.toISOString()).toBe("2026-01-01T10:00:02.000Z");

      // Tentativa 3: +4s (1000ms * 2^2)
      outbox.scheduleRetry(now);
      expect(outbox.attempts).toBe(3);
      expect(outbox.nextAttemptAt?.toISOString()).toBe("2026-01-01T10:00:04.000Z");
    });
  });
});

