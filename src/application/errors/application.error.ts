export abstract class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WalletConflictError extends ApplicationError {
  constructor(playerId: string, currency: string) {
    super(`Wallet already exists for player '${playerId}' and currency '${currency}'`);
  }
}

export class WalletNotFoundError extends ApplicationError {
  constructor(walletId: string) {
    super(`Wallet '${walletId}' not found`);
  }
}

export class IdempotencyConflictError extends ApplicationError {
  constructor(idempotencyKey: string) {
    super(`Idempotency key '${idempotencyKey}' provided with different payload`);
  }
}

export class TransactionNotFoundError extends ApplicationError {
  constructor(transactionId: string) {
    super(`Transaction '${transactionId}' not found`);
  }
}

