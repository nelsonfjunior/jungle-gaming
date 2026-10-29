import { FailureCode, WagerTransactionKind } from "../entities/wager-transaction";
import { LedgerDirection } from "../entities/wallet-ledger-entry";
import { MoneyProps } from "../value-objects/money";
import { IntegrationEvent, IntegrationEventProps } from "./integration-event";

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  public readonly eventType = "WalletBalanceChanged";
  public readonly version = 1;

  public static create(
    props: IntegrationEventProps<WalletBalanceChangedData>,
  ): WalletBalanceChanged {
    return new WalletBalanceChanged(props);
  }
}

export interface WagerTransactionProcessedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceTransactionId?: string;
  processedAt: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  public readonly eventType = "WagerTransactionProcessed";
  public readonly version = 1;

  public static create(
    props: IntegrationEventProps<WagerTransactionProcessedData>,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed(props);
  }
}

export interface WagerTransactionRejectedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  failureCode: FailureCode;
  rejectedAt: string;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  public readonly eventType = "WagerTransactionRejected";
  public readonly version = 1;

  public static create(
    props: IntegrationEventProps<WagerTransactionRejectedData>,
  ): WagerTransactionRejected {
    return new WagerTransactionRejected(props);
  }
}

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  referenceExternalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  queuedAt: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  public readonly eventType = "WagerTransactionPendingReference";
  public readonly version = 1;

  public static create(
    props: IntegrationEventProps<WagerTransactionPendingReferenceData>,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference(props);
  }
}

