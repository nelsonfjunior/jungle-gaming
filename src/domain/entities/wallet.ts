import { CurrencyMismatchError, InsufficientBalanceError } from "../errors/domain.error";
import { Money } from "../value-objects/money";
import { LedgerDirection, WalletLedgerEntry } from "./wallet-ledger-entry";

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  createdAt?: Date;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletMovementResult {
  ledgerEntry: WalletLedgerEntry;
  previousBalance: Money;
  newBalance: Money;
  newVersion: number;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  public static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
    createdAt?: Date;
  }): Wallet {
    const now = props.createdAt ?? new Date();

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1, // version inicia em 1
      now,
      now,
    );
  }

  public static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  public get balance(): Money {
    return this._balance;
  }

  public get version(): number {
    return this._version;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Realiza débito na carteira gerando a entrada correspondente no ledger.
   * Lança InsufficientBalanceError se o saldo for insuficiente.
   * Incrementa version e atualiza updatedAt.
   */
  public debit(
    transactionId: string,
    amount: Money,
    ledgerEntryId: string,
    at: Date = new Date(),
  ): WalletMovementResult {
    this.assertSameCurrency(amount);

    if (this._balance.isLessThan(amount)) {
      throw new InsufficientBalanceError(
        this.id,
        this._balance.toString(),
        amount.toString(),
      );
    }

    const previousBalance = this._balance;
    const newBalance = this._balance.subtract(amount);

    const ledgerEntry = WalletLedgerEntry.create({
      id: ledgerEntryId,
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Debit,
      money: amount,
      balanceBefore: previousBalance,
      balanceAfter: newBalance,
      createdAt: at,
    });

    this._balance = newBalance;
    this._version += 1;
    this._updatedAt = at;

    return {
      ledgerEntry,
      previousBalance,
      newBalance,
      newVersion: this._version,
    };
  }

  /**
   * Realiza crédito na carteira gerando a entrada correspondente no ledger.
   * Incrementa version e atualiza updatedAt.
   */
  public credit(
    transactionId: string,
    amount: Money,
    ledgerEntryId: string,
    at: Date = new Date(),
  ): WalletMovementResult {
    this.assertSameCurrency(amount);

    const previousBalance = this._balance;
    const newBalance = this._balance.add(amount);

    const ledgerEntry = WalletLedgerEntry.create({
      id: ledgerEntryId,
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Credit,
      money: amount,
      balanceBefore: previousBalance,
      balanceAfter: newBalance,
      createdAt: at,
    });

    this._balance = newBalance;
    this._version += 1;
    this._updatedAt = at;

    return {
      ledgerEntry,
      previousBalance,
      newBalance,
      newVersion: this._version,
    };
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}

