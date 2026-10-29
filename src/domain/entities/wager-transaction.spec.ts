import { describe, expect, it } from "bun:test";
import {
  InvalidReferenceError,
  InvalidTransactionStateError,
} from "../errors/domain.error";
import { Money } from "../value-objects/money";
import { LedgerDirection } from "./wallet-ledger-entry";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "./wager-transaction";

describe("WagerTransaction Entity", () => {
  const currency = "BRL";
  const money = Money.from({ amount: "50.00", currency });

  const defaultProps = {
    id: "tx-1",
    providerId: "provider-a",
    externalTransactionId: "ext-1",
    idempotencyKey: "provider-a:ext-1",
    payloadHash: "hash-123",
    walletId: "wallet-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "game-1",
    kind: WagerTransactionKind.Bet,
    money,
  };

  it("should create transaction in PENDING state", () => {
    const tx = WagerTransaction.create(defaultProps);
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.isTerminal()).toBe(false);
  });

  it("should require referenceExternalTransactionId for REFUND and ROLLBACK", () => {
    expect(() =>
      WagerTransaction.create({
        ...defaultProps,
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: undefined,
      }),
    ).toThrow(InvalidReferenceError);

    expect(() =>
      WagerTransaction.create({
        ...defaultProps,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "   ",
      }),
    ).toThrow(InvalidReferenceError);
  });

  it("should transition to PROCESSED and become terminal", () => {
    const tx = WagerTransaction.create(defaultProps);
    const now = new Date();
    tx.markProcessed("ref-tx-99", now);

    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);
    expect(tx.referenceTransactionId).toBe("ref-tx-99");
    expect(tx.processedAt).toEqual(now);
  });

  it("should transition to REJECTED and become terminal", () => {
    const tx = WagerTransaction.create(defaultProps);
    tx.reject("INSUFFICIENT_FUNDS");

    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(tx.isTerminal()).toBe(true);
  });

  it("should transition to FAILED and become terminal", () => {
    const tx = WagerTransaction.create(defaultProps);
    tx.fail("INFRASTRUCTURE_FAILURE");

    expect(tx.status).toBe(WagerTransactionStatus.Failed);
    expect(tx.failureCode).toBe("INFRASTRUCTURE_FAILURE");
    expect(tx.isTerminal()).toBe(true);
  });

  it("should reject any transition from terminal states", () => {
    const tx = WagerTransaction.create(defaultProps);
    tx.markProcessed(undefined);

    expect(() => tx.markProcessed(undefined)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => tx.reject("INSUFFICIENT_FUNDS")).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => tx.fail("INFRASTRUCTURE_FAILURE")).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => tx.markPendingReference()).toThrow(
      InvalidTransactionStateError,
    );
  });

  it("should determine if it affects balance", () => {
    const bet = WagerTransaction.create(defaultProps);
    expect(bet.affectsBalance()).toBe(true);

    const loss = WagerTransaction.create({
      ...defaultProps,
      kind: WagerTransactionKind.Loss,
      money: Money.zero(currency),
    });
    expect(loss.affectsBalance()).toBe(false);
  });

  it("should return correct ledger directions", () => {
    const bet = WagerTransaction.create(defaultProps);
    expect(bet.ledgerDirectionFor()).toBe(LedgerDirection.Debit);

    const win = WagerTransaction.create({
      ...defaultProps,
      kind: WagerTransactionKind.Win,
    });
    expect(win.ledgerDirectionFor()).toBe(LedgerDirection.Credit);

    const refund = WagerTransaction.create({
      ...defaultProps,
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: "ext-bet-1",
    });
    expect(refund.ledgerDirectionFor()).toBe(LedgerDirection.Credit);

    // Rollback de BET (Debit) -> Credit
    const rollbackOfBet = WagerTransaction.create({
      ...defaultProps,
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: "ext-bet-1",
    });
    expect(rollbackOfBet.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);

    // Rollback de WIN (Credit) -> Debit
    const rollbackOfWin = WagerTransaction.create({
      ...defaultProps,
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: "ext-win-1",
    });
    expect(rollbackOfWin.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
  });
});

