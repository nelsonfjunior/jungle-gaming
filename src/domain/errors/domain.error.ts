export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidMoneyError extends DomainError {
  constructor(message: string) {
    super(`Invalid money: ${message}`);
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(baseCurrency: string, targetCurrency: string) {
    super(
      `Currency mismatch: cannot operate between '${baseCurrency}' and '${targetCurrency}'`,
    );
  }
}

export class UnbalancedLedgerEntryError extends DomainError {
  constructor(message: string) {
    super(`Unbalanced ledger entry: ${message}`);
  }
}

export class InsufficientBalanceError extends DomainError {
  constructor(walletId: string, currentBalance: string, requestedAmount: string) {
    super(
      `Insufficient balance for wallet '${walletId}': current ${currentBalance}, requested ${requestedAmount}`,
    );
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(message: string) {
    super(`Invalid transaction state transition: ${message}`);
  }
}

export class InvalidTransactionPayloadError extends DomainError {
  constructor(message: string) {
    super(`Invalid transaction payload: ${message}`);
  }
}

export class InvalidReferenceError extends DomainError {
  constructor(message: string) {
    super(`Invalid reference: ${message}`);
  }
}

export class OperationDoesNotAffectBalanceError extends DomainError {
  constructor(kind: string) {
    super(`Operation of kind '${kind}' does not produce balance or ledger movements`);
  }
}


