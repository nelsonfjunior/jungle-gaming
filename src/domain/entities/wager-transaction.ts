import {
  InvalidReferenceError,
  InvalidTransactionPayloadError,
  InvalidTransactionStateError,
  OperationDoesNotAffectBalanceError,
} from "../errors/domain.error";
import { Money } from "../value-objects/money";
import { LedgerDirection } from "./wallet-ledger-entry";

export enum WagerTransactionKind {
  Opening = "OPENING", // interno: crédito de abertura da wallet
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending = "PENDING", // aceita, ainda não aplicada
  PendingReference = "PENDING_REFERENCE", // aguardando a transação referenciada
  Processed = "PROCESSED", // aplicada (terminal)
  Rejected = "REJECTED", // violação de regra de negócio (terminal)
  Failed = "FAILED", // erro permanente de infraestrutura (terminal, auditável)
}

export type FailureCode =
  | "INSUFFICIENT_FUNDS"
  | "INVALID_REFERENCE"
  | "REFERENCE_NOT_FOUND"
  | "REFERENCE_ALREADY_REVERTED"
  | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "ROUND_MISMATCH"
  | "PLAYER_MISMATCH"
  | "INVALID_OPERATION_TYPE"
  | "REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE"
  | "IDEMPOTENCY_CONFLICT"
  | "EXTERNAL_REFERENCE_REQUIRED"
  | "INTERNAL_OPERATION_CANNOT_BE_EXTERNAL"
  | "INFRASTRUCTURE_FAILURE";

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  public static create(props: CreateWagerTransactionProps): WagerTransaction {
    const createdAt = props.createdAt ?? new Date();

    // Validação da exigência de referência por kind
    if (
      (props.kind === WagerTransactionKind.Refund ||
        props.kind === WagerTransactionKind.Rollback) &&
      (!props.referenceExternalTransactionId ||
        props.referenceExternalTransactionId.trim() === "")
    ) {
      throw new InvalidReferenceError(
        `Operation kind '${props.kind}' requires a referenceExternalTransactionId`,
      );
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      createdAt,
      WagerTransactionStatus.Pending,
    );
  }

  public static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  public get status(): WagerTransactionStatus {
    return this._status;
  }

  public get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  public get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }

  public markProcessed(
    referenceTransactionId: string | undefined,
    at: Date = new Date(),
  ): void {
    this.assertNonTerminal();
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  public markPendingReference(): void {
    this.assertNonTerminal();
    this._status = WagerTransactionStatus.PendingReference;
  }

  public reject(code: FailureCode): void {
    this.assertNonTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  public fail(code: FailureCode): void {
    this.assertNonTerminal();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  public isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  public affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  public requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  public matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  public ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;

      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Opening:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new InvalidReferenceError(
            "Rollback requires the referenced transaction to determine ledger direction",
          );
        }
        // Inverte a direção original da referência
        const refDirection = reference.ledgerDirectionFor();
        return refDirection === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      }

      case WagerTransactionKind.Loss:
        throw new OperationDoesNotAffectBalanceError(this.kind);
    }
  }

  private assertNonTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `Transaction '${this.id}' is already in terminal state '${this._status}' and cannot transition`,
      );
    }
  }
}

