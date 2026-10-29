import { describe, expect, it } from "bun:test";
import { UnbalancedLedgerEntryError } from "../errors/domain.error";
import { Money } from "../value-objects/money";
import { LedgerDirection, WalletLedgerEntry } from "./wallet-ledger-entry";

describe("WalletLedgerEntry", () => {
  const currency = "BRL";

  it("should create a balanced credit ledger entry", () => {
    const entry = WalletLedgerEntry.create({
      id: "ledger-1",
      walletId: "wallet-1",
      transactionId: "tx-1",
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "50.00", currency }),
      balanceBefore: Money.from({ amount: "100.00", currency }),
      balanceAfter: Money.from({ amount: "150.00", currency }),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.balanceAfter.toString()).toBe("150.00");
  });

  it("should create a balanced debit ledger entry", () => {
    const entry = WalletLedgerEntry.create({
      id: "ledger-2",
      walletId: "wallet-1",
      transactionId: "tx-2",
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: "30.00", currency }),
      balanceBefore: Money.from({ amount: "100.00", currency }),
      balanceAfter: Money.from({ amount: "70.00", currency }),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceAfter.toString()).toBe("70.00");
  });

  it("should throw UnbalancedLedgerEntryError when credit math does not match", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "ledger-3",
        walletId: "wallet-1",
        transactionId: "tx-3",
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "50.00", currency }),
        balanceBefore: Money.from({ amount: "100.00", currency }),
        balanceAfter: Money.from({ amount: "160.00", currency }), // Errado: 100 + 50 != 160
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it("should throw UnbalancedLedgerEntryError when debit math does not match", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "ledger-4",
        walletId: "wallet-1",
        transactionId: "tx-4",
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: "50.00", currency }),
        balanceBefore: Money.from({ amount: "100.00", currency }),
        balanceAfter: Money.from({ amount: "40.00", currency }), // Errado: 100 - 50 != 40
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it("should rehydrate without revalidating mathematical rules", () => {
    const state = {
      id: "ledger-5",
      walletId: "wallet-1",
      transactionId: "tx-5",
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "10.00", currency }),
      balanceBefore: Money.from({ amount: "0.00", currency }),
      balanceAfter: Money.from({ amount: "10.00", currency }),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const rehydrated = WalletLedgerEntry.rehydrate(state);
    expect(rehydrated.id).toBe("ledger-5");
    expect(rehydrated.createdAt).toEqual(state.createdAt);
  });
});

