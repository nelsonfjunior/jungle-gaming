import { describe, expect, it } from "bun:test";
import { CurrencyMismatchError, InsufficientBalanceError } from "../errors/domain.error";
import { Money } from "../value-objects/money";
import { LedgerDirection } from "./wallet-ledger-entry";
import { Wallet } from "./wallet";

describe("Wallet Aggregate Root", () => {
  const currency = "BRL";

  it("should open a wallet with initial balance and version 1", () => {
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: Money.from({ amount: "100.00", currency }),
    });

    expect(wallet.id).toBe("w-1");
    expect(wallet.playerId).toBe("p-1");
    expect(wallet.currency).toBe(currency);
    expect(wallet.balance.toString()).toBe("100.00");
    expect(wallet.version).toBe(1);
  });

  it("should debit wallet and produce a consistent ledger entry", () => {
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: Money.from({ amount: "100.00", currency }),
    });

    const result = wallet.debit(
      "tx-1",
      Money.from({ amount: "30.00", currency }),
      "ledger-1",
    );

    expect(wallet.balance.toString()).toBe("70.00");
    expect(wallet.version).toBe(2);
    expect(result.ledgerEntry.direction).toBe(LedgerDirection.Debit);
    expect(result.ledgerEntry.balanceBefore.toString()).toBe("100.00");
    expect(result.ledgerEntry.balanceAfter.toString()).toBe("70.00");
    expect(result.ledgerEntry.isBalanced()).toBe(true);
  });

  it("should credit wallet and produce a consistent ledger entry", () => {
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: Money.from({ amount: "100.00", currency }),
    });

    const result = wallet.credit(
      "tx-2",
      Money.from({ amount: "50.00", currency }),
      "ledger-2",
    );

    expect(wallet.balance.toString()).toBe("150.00");
    expect(wallet.version).toBe(2);
    expect(result.ledgerEntry.direction).toBe(LedgerDirection.Credit);
    expect(result.ledgerEntry.balanceBefore.toString()).toBe("100.00");
    expect(result.ledgerEntry.balanceAfter.toString()).toBe("150.00");
    expect(result.ledgerEntry.isBalanced()).toBe(true);
  });

  it("should throw InsufficientBalanceError and not mutate state when balance is too low", () => {
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: Money.from({ amount: "50.00", currency }),
    });

    expect(() =>
      wallet.debit("tx-3", Money.from({ amount: "80.00", currency }), "ledger-3"),
    ).toThrow(InsufficientBalanceError);

    // Estado inalterado
    expect(wallet.balance.toString()).toBe("50.00");
    expect(wallet.version).toBe(1);
  });

  it("should throw CurrencyMismatchError when operating with different currency", () => {
    const wallet = Wallet.open({
      id: "w-1",
      playerId: "p-1",
      initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
    });

    const usd = Money.from({ amount: "10.00", currency: "USD" });

    expect(() => wallet.debit("tx-4", usd, "ledger-4")).toThrow(
      CurrencyMismatchError,
    );
    expect(() => wallet.credit("tx-5", usd, "ledger-5")).toThrow(
      CurrencyMismatchError,
    );
  });
});

