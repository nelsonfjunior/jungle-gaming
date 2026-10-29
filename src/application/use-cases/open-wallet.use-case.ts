import { EntityManager } from "@mikro-orm/postgresql";
import { v4 as uuidv4 } from "uuid";
import { Wallet } from "../../domain/entities/wallet";
import {
  LedgerDirection,
  WalletLedgerEntry,
} from "../../domain/entities/wallet-ledger-entry";
import {
  WagerTransaction,
  WagerTransactionKind,
} from "../../domain/entities/wager-transaction";
import { WalletBalanceChanged } from "../../domain/events/events";
import { OutboxMessage } from "../../domain/entities/outbox-message";
import { Money, MoneyProps } from "../../domain/value-objects/money";
import { WalletOrmEntity } from "../../infrastructure/database/entities/wallet.entity";
import { WalletMapper } from "../../infrastructure/database/mappers/wallet.mapper";
import { WalletLedgerEntryMapper } from "../../infrastructure/database/mappers/wallet-ledger-entry.mapper";
import { WagerTransactionMapper } from "../../infrastructure/database/mappers/wager-transaction.mapper";
import { OutboxMessageMapper } from "../../infrastructure/database/mappers/outbox-message.mapper";
import { WalletConflictError } from "../errors/application.error";

export interface OpenWalletInput {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface OpenWalletOutput {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export class OpenWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  public async execute(input: OpenWalletInput): Promise<OpenWalletOutput> {
    const initialMoney = Money.from(input.initialBalance);

    return this.em.transactional(async (txEm) => {
      // 1. Checa unicidade (player_id, currency)
      const existing = await txEm.findOne(WalletOrmEntity, {
        playerId: input.playerId,
        currency: initialMoney.currency,
      });

      if (existing) {
        throw new WalletConflictError(input.playerId, initialMoney.currency);
      }

      const walletId = uuidv4();
      const wallet = Wallet.open({
        id: walletId,
        playerId: input.playerId,
        initialBalance: initialMoney,
      });

      const walletOrm = WalletMapper.toOrm(wallet);
      txEm.persist(walletOrm);

      // 2. Se saldo inicial for > 0, cria transação OPENING e ledger CREDIT na mesma transação SQL
      if (initialMoney.isPositive()) {
        const txId = uuidv4();
        const ledgerId = uuidv4();
        const now = new Date();

        const openingTx = WagerTransaction.create({
          id: txId,
          providerId: "system",
          externalTransactionId: `opening-${walletId}`,
          idempotencyKey: `system:opening:${walletId}`,
          payloadHash: "internal-opening-hash",
          walletId,
          playerId: input.playerId,
          roundId: "opening-round",
          gameId: "system",
          kind: WagerTransactionKind.Opening,
          money: initialMoney,
          createdAt: now,
        });
        openingTx.markProcessed(undefined, now);

        const ledgerEntry = WalletLedgerEntry.create({
          id: ledgerId,
          walletId,
          transactionId: txId,
          direction: LedgerDirection.Credit,
          money: initialMoney,
          balanceBefore: Money.zero(initialMoney.currency),
          balanceAfter: initialMoney,
          createdAt: now,
        });

        const event = WalletBalanceChanged.create({
          eventId: uuidv4(),
          aggregateId: walletId,
          correlationId: txId,
          data: {
            walletId,
            transactionId: txId,
            direction: LedgerDirection.Credit,
            money: initialMoney.toJSON(),
            balanceBefore: Money.zero(initialMoney.currency).toJSON(),
            balanceAfter: initialMoney.toJSON(),
            walletVersion: wallet.version,
          },
        });

        const outbox = OutboxMessage.enqueue(event);

        txEm.persist(WagerTransactionMapper.toOrm(openingTx, walletOrm));
        txEm.persist(WalletLedgerEntryMapper.toOrm(ledgerEntry, walletOrm));
        txEm.persist(OutboxMessageMapper.toOrm(outbox));
      }

      await txEm.flush();

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}

