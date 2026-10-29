import { EntityManager, LockMode } from "@mikro-orm/postgresql";
import { v4 as uuidv4 } from "uuid";
import {
  FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain/entities/wager-transaction";
import { LedgerDirection, WalletLedgerEntry } from "../../domain/entities/wallet-ledger-entry";
import { OutboxMessage } from "../../domain/entities/outbox-message";
import { InboxMessage } from "../../domain/entities/inbox-message";
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from "../../domain/events/events";
import { Money, MoneyProps } from "../../domain/value-objects/money";
import { WalletOrmEntity } from "../../infrastructure/database/entities/wallet.entity";
import { WagerTransactionOrmEntity } from "../../infrastructure/database/entities/wager-transaction.entity";
import { InboxMessageOrmEntity } from "../../infrastructure/database/entities/inbox-message.entity";
import { WalletMapper } from "../../infrastructure/database/mappers/wallet.mapper";
import { WalletLedgerEntryMapper } from "../../infrastructure/database/mappers/wallet-ledger-entry.mapper";
import { WagerTransactionMapper } from "../../infrastructure/database/mappers/wager-transaction.mapper";
import { OutboxMessageMapper } from "../../infrastructure/database/mappers/outbox-message.mapper";
import { InboxMessageMapper } from "../../infrastructure/database/mappers/inbox-message.mapper";
import {
  IdempotencyConflictError,
  WalletNotFoundError,
} from "../errors/application.error";
import { CanonicalJsonHasher } from "../services/canonical-json-hasher";

export interface ProcessWagerTransactionInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  messageId?: string;
  consumerName?: string;
  correlationId?: string;
}

export interface ProcessWagerTransactionOutput {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

export class ProcessWagerTransactionUseCase {
  constructor(private readonly em: EntityManager) {}

  public async execute(
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionOutput> {
    const correlationId = input.correlationId ?? uuidv4();
    const money = Money.from(input.money);

    // 1. Calcula hash canônico dos dados de negócio
    const payloadHash = CanonicalJsonHasher.hash({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: {
        amount: money.toString(),
        currency: money.currency,
      },
      referenceExternalTransactionId: input.referenceExternalTransactionId ?? null,
    });

    return this.em.transactional(async (txEm) => {
      // 2. Tratamento de Inbox (quando originado por fila SQS)
      let inboxMessage: InboxMessage | undefined;
      if (input.messageId && input.consumerName) {
        const existingInbox = await txEm.findOne(InboxMessageOrmEntity, {
          consumerName: input.consumerName,
          messageId: input.messageId,
        });

        if (existingInbox && existingInbox.processedAt) {
          // Mensagem já processada anteriormente no SQS: busca resultado da transação
          const existingTx = await txEm.findOne(WagerTransactionOrmEntity, {
            idempotencyKey: input.idempotencyKey,
          }, { populate: ["wallet"] });

          if (existingTx) {
            return {
              transactionId: existingTx.id,
              status: existingTx.status as WagerTransactionStatus,
              balance: {
                amount: existingTx.wallet.balance,
                currency: existingTx.wallet.currency,
              },
              idempotentReplay: true,
              failureCode: existingTx.failureCode as FailureCode | undefined,
            };
          }
        }

        if (!existingInbox) {
          inboxMessage = InboxMessage.receive({
            consumerName: input.consumerName,
            messageId: input.messageId,
            payloadHash,
          });
          txEm.persist(InboxMessageMapper.toOrm(inboxMessage));
        }
      }

      // 3. Verificação de Idempotência
      const existingTxOrm = await txEm.findOne(
        WagerTransactionOrmEntity,
        {
          $or: [
            { idempotencyKey: input.idempotencyKey },
            {
              providerId: input.providerId,
              externalTransactionId: input.externalTransactionId,
            },
          ],
        },
        { populate: ["wallet"] },
      );

      if (existingTxOrm) {
        // Se a mesma chave tem payload diferente: CONFLITO!
        if (existingTxOrm.payloadHash !== payloadHash) {
          throw new IdempotencyConflictError(input.idempotencyKey);
        }

        // Se o status for TERMINAL (PROCESSED, REJECTED, FAILED): REPLAY IDEMPOTENTE!
        if (
          existingTxOrm.status === WagerTransactionStatus.Processed ||
          existingTxOrm.status === WagerTransactionStatus.Rejected ||
          existingTxOrm.status === WagerTransactionStatus.Failed
        ) {
          return {
            transactionId: existingTxOrm.id,
            status: existingTxOrm.status as WagerTransactionStatus,
            balance: {
              amount: existingTxOrm.wallet.balance,
              currency: existingTxOrm.wallet.currency,
            },
            idempotentReplay: true,
            failureCode: existingTxOrm.failureCode as FailureCode | undefined,
          };
        }
        // Se for PENDING_REFERENCE, continua a execução para tentar processar agora que a referência pode ter chegado!
      }

      // 4. Pessimistic Lock na Wallet (SELECT ... FOR UPDATE)
      const walletOrm = await txEm.findOne(
        WalletOrmEntity,
        { id: input.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      if (!walletOrm) {
        throw new WalletNotFoundError(input.walletId);
      }

      const wallet = WalletMapper.toDomain(walletOrm);

      // 5. Criação ou Reutilização da WagerTransaction no Domínio
      const transactionId = existingTxOrm ? existingTxOrm.id : uuidv4();
      const now = new Date();

      if (input.kind === WagerTransactionKind.Opening) {
        // OPENING é apenas para inicialização interna do sistema
        const rejectedTx = WagerTransaction.create({
          id: transactionId,
          providerId: input.providerId,
          externalTransactionId: input.externalTransactionId,
          idempotencyKey: input.idempotencyKey,
          payloadHash,
          walletId: wallet.id,
          playerId: input.playerId,
          roundId: input.roundId,
          gameId: input.gameId,
          kind: input.kind,
          money,
          createdAt: now,
        });
        rejectedTx.reject("INVALID_OPERATION_TYPE");
        txEm.persist(WagerTransactionMapper.toOrm(rejectedTx, walletOrm));
        await txEm.flush();

        return {
          transactionId,
          status: WagerTransactionStatus.Rejected,
          balance: wallet.balance.toJSON(),
          idempotentReplay: false,
          failureCode: "INVALID_OPERATION_TYPE",
        };
      }

      const wagerTx = WagerTransaction.create({
        id: transactionId,
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: wallet.id,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
        createdAt: now,
      });

      // Validação de moeda e jogador
      if (wallet.currency !== money.currency) {
        return this.rejectTransaction(
          txEm,
          walletOrm,
          wallet,
          wagerTx,
          "CURRENCY_MISMATCH",
          correlationId,
        );
      }

      if (wallet.playerId !== input.playerId) {
        return this.rejectTransaction(
          txEm,
          walletOrm,
          wallet,
          wagerTx,
          "PLAYER_MISMATCH",
          correlationId,
        );
      }

      // 6. Execução da Operação de Acordo com o Kind
      switch (input.kind) {
        case WagerTransactionKind.Bet: {
          if (wallet.balance.isLessThan(money)) {
            return this.rejectTransaction(
              txEm,
              walletOrm,
              wallet,
              wagerTx,
              "INSUFFICIENT_FUNDS",
              correlationId,
            );
          }

          const debitResult = wallet.debit(wagerTx.id, money, uuidv4(), now);
          wagerTx.markProcessed(undefined, now);

          this.updateWalletOrm(walletOrm, wallet);
          this.saveOrUpdateWagerTx(txEm, wagerTx, walletOrm, existingTxOrm);
          txEm.persist(WalletLedgerEntryMapper.toOrm(debitResult.ledgerEntry, walletOrm));

          this.enqueueBalanceAndProcessedEvents(
            txEm,
            wallet,
            wagerTx,
            debitResult.ledgerEntry,
            correlationId,
          );
          break;
        }

        case WagerTransactionKind.Win: {
          let refTxOrm: WagerTransactionOrmEntity | null = null;
          if (input.referenceExternalTransactionId) {
            refTxOrm = await txEm.findOne(WagerTransactionOrmEntity, {
              providerId: input.providerId,
              externalTransactionId: input.referenceExternalTransactionId,
            });

            if (refTxOrm && (refTxOrm.roundId !== input.roundId || refTxOrm.playerId !== input.playerId)) {
              return this.rejectTransaction(
                txEm,
                walletOrm,
                wallet,
                wagerTx,
                "ROUND_MISMATCH",
                correlationId,
              );
            }
          }

          const creditResult = wallet.credit(wagerTx.id, money, uuidv4(), now);
          wagerTx.markProcessed(refTxOrm?.id, now);

          this.updateWalletOrm(walletOrm, wallet);
          this.saveOrUpdateWagerTx(txEm, wagerTx, walletOrm, existingTxOrm);
          txEm.persist(WalletLedgerEntryMapper.toOrm(creditResult.ledgerEntry, walletOrm));

          this.enqueueBalanceAndProcessedEvents(
            txEm,
            wallet,
            wagerTx,
            creditResult.ledgerEntry,
            correlationId,
          );
          break;
        }

        case WagerTransactionKind.Loss: {
          wagerTx.markProcessed(undefined, now);
          this.saveOrUpdateWagerTx(txEm, wagerTx, walletOrm, existingTxOrm);

          const event = WagerTransactionProcessed.create({
            eventId: uuidv4(),
            aggregateId: wagerTx.id,
            correlationId,
            data: {
              transactionId: wagerTx.id,
              providerId: wagerTx.providerId,
              externalTransactionId: wagerTx.externalTransactionId,
              walletId: wallet.id,
              playerId: wallet.playerId,
              roundId: wagerTx.roundId,
              gameId: wagerTx.gameId,
              kind: wagerTx.kind,
              money: wagerTx.money.toJSON(),
              processedAt: now.toISOString(),
            },
          });
          txEm.persist(OutboxMessageMapper.toOrm(OutboxMessage.enqueue(event)));
          break;
        }

        case WagerTransactionKind.Refund: {
          const refTxOrm = await txEm.findOne(WagerTransactionOrmEntity, {
            providerId: input.providerId,
            externalTransactionId: input.referenceExternalTransactionId!,
          });

          // Se a referência ainda não chegou: marca como PENDING_REFERENCE
          if (!refTxOrm) {
            wagerTx.markPendingReference();
            this.saveOrUpdateWagerTx(txEm, wagerTx, walletOrm, existingTxOrm);

            const pendingEvent = WagerTransactionPendingReference.create({
              eventId: uuidv4(),
              aggregateId: wagerTx.id,
              correlationId,
              data: {
                transactionId: wagerTx.id,
                providerId: wagerTx.providerId,
                externalTransactionId: wagerTx.externalTransactionId,
                referenceExternalTransactionId: input.referenceExternalTransactionId!,
                walletId: wallet.id,
                playerId: wallet.playerId,
                roundId: wagerTx.roundId,
                gameId: wagerTx.gameId,
                kind: wagerTx.kind,
                money: wagerTx.money.toJSON(),
                queuedAt: now.toISOString(),
              },
            });
            txEm.persist(OutboxMessageMapper.toOrm(OutboxMessage.enqueue(pendingEvent)));
            break;
          }

          // Validações da referência encontrada
          if (refTxOrm.status !== WagerTransactionStatus.Processed) {
            return this.rejectTransaction(
              txEm,
              walletOrm,
              wallet,
              wagerTx,
              "INVALID_REFERENCE",
              correlationId,
            );
          }

          if (refTxOrm.kind !== WagerTransactionKind.Bet) {
            return this.rejectTransaction(
              txEm,
              walletOrm,
              wallet,
              wagerTx,
              "INVALID_OPERATION_TYPE",
              correlationId,
            );
          }

          if (refTxOrm.roundId !== input.roundId) {
            return this.rejectTransaction(
              txEm,
              walletOrm,
              wallet,
              wagerTx,
              "ROUND_MISMATCH",
              correlationId,
            );
          }

          if (refTxOrm.amount !== money.toString()) {
            return this.rejectTransaction(
              txEm,
              walletOrm,
              wallet,
              wagerTx,
              "AMOUNT_MISMATCH",
              correlationId,
            );
          }

          // Checa se já não foi estornada
          const alreadyReverted = await txEm.findOne(WagerTransactionOrmEntity, {
            referenceTransactionId: refTxOrm.id,
            status: WagerTransactionStatus.Processed,
            kind: { $in: [WagerTransactionKind.Refund, WagerTransactionKind.Rollback] },
          });

          if (alreadyReverted) {
            return this.rejectTransaction(
              txEm,
              walletOrm,
              wallet,
              wagerTx,
              "REFERENCE_ALREADY_REVERTED",
              correlationId,
            );
          }

          const creditResult = wallet.credit(wagerTx.id, money, uuidv4(), now);
          wagerTx.markProcessed(refTxOrm.id, now);

          this.updateWalletOrm(walletOrm, wallet);
          this.saveOrUpdateWagerTx(txEm, wagerTx, walletOrm, existingTxOrm);
          txEm.persist(WalletLedgerEntryMapper.toOrm(creditResult.ledgerEntry, walletOrm));

          this.enqueueBalanceAndProcessedEvents(
            txEm,
            wallet,
            wagerTx,
            creditResult.ledgerEntry,
            correlationId,
            refTxOrm.id,
          );
          break;
        }

        case WagerTransactionKind.Rollback: {
          const refTxOrm = await txEm.findOne(WagerTransactionOrmEntity, {
            providerId: input.providerId,
            externalTransactionId: input.referenceExternalTransactionId!,
          });

          if (!refTxOrm) {
            wagerTx.markPendingReference();
            this.saveOrUpdateWagerTx(txEm, wagerTx, walletOrm, existingTxOrm);

            const pendingEvent = WagerTransactionPendingReference.create({
              eventId: uuidv4(),
              aggregateId: wagerTx.id,
              correlationId,
              data: {
                transactionId: wagerTx.id,
                providerId: wagerTx.providerId,
                externalTransactionId: wagerTx.externalTransactionId,
                referenceExternalTransactionId: input.referenceExternalTransactionId!,
                walletId: wallet.id,
                playerId: wallet.playerId,
                roundId: wagerTx.roundId,
                gameId: wagerTx.gameId,
                kind: wagerTx.kind,
                money: wagerTx.money.toJSON(),
                queuedAt: now.toISOString(),
              },
            });
            txEm.persist(OutboxMessageMapper.toOrm(OutboxMessage.enqueue(pendingEvent)));
            break;
          }

          if (refTxOrm.status !== WagerTransactionStatus.Processed) {
            return this.rejectTransaction(
              txEm,
              walletOrm,
              wallet,
              wagerTx,
              "INVALID_REFERENCE",
              correlationId,
            );
          }

          if (
            refTxOrm.kind !== WagerTransactionKind.Bet &&
            refTxOrm.kind !== WagerTransactionKind.Win &&
            refTxOrm.kind !== WagerTransactionKind.Refund
          ) {
            return this.rejectTransaction(
              txEm,
              walletOrm,
              wallet,
              wagerTx,
              "INVALID_OPERATION_TYPE",
              correlationId,
            );
          }

          if (refTxOrm.amount !== money.toString()) {
            return this.rejectTransaction(
              txEm,
              walletOrm,
              wallet,
              wagerTx,
              "AMOUNT_MISMATCH",
              correlationId,
            );
          }

          // Checa se já foi revertida
          const alreadyReverted = await txEm.findOne(WagerTransactionOrmEntity, {
            referenceTransactionId: refTxOrm.id,
            status: WagerTransactionStatus.Processed,
            kind: WagerTransactionKind.Rollback,
          });

          if (alreadyReverted) {
            return this.rejectTransaction(
              txEm,
              walletOrm,
              wallet,
              wagerTx,
              "REFERENCE_ALREADY_REVERTED",
              correlationId,
            );
          }

          // Determina a direção invertida do Rollback
          if (refTxOrm.kind === WagerTransactionKind.Bet) {
            // Reverter uma BET é dar CRÉDITO
            const creditResult = wallet.credit(wagerTx.id, money, uuidv4(), now);
            wagerTx.markProcessed(refTxOrm.id, now);

            this.updateWalletOrm(walletOrm, wallet);
            this.saveOrUpdateWagerTx(txEm, wagerTx, walletOrm, existingTxOrm);
            txEm.persist(WalletLedgerEntryMapper.toOrm(creditResult.ledgerEntry, walletOrm));

            this.enqueueBalanceAndProcessedEvents(
              txEm,
              wallet,
              wagerTx,
              creditResult.ledgerEntry,
              correlationId,
              refTxOrm.id,
            );
          } else {
            // Reverter um WIN ou REFUND é dar DÉBITO
            // REGRA 7.9: Reversão que produziria saldo negativo é rejeitada explicitamente com REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE
            if (wallet.balance.isLessThan(money)) {
              return this.rejectTransaction(
                txEm,
                walletOrm,
                wallet,
                wagerTx,
                "REVERSAL_WOULD_PRODUCE_NEGATIVE_BALANCE",
                correlationId,
              );
            }

            const debitResult = wallet.debit(wagerTx.id, money, uuidv4(), now);
            wagerTx.markProcessed(refTxOrm.id, now);

            this.updateWalletOrm(walletOrm, wallet);
            txEm.persist(WagerTransactionMapper.toOrm(wagerTx, walletOrm));
            txEm.persist(WalletLedgerEntryMapper.toOrm(debitResult.ledgerEntry, walletOrm));

            this.enqueueBalanceAndProcessedEvents(
              txEm,
              wallet,
              wagerTx,
              debitResult.ledgerEntry,
              correlationId,
              refTxOrm.id,
            );
          }
          break;
        }
      }

      if (inboxMessage) {
        inboxMessage.markProcessed(now);
      }

      await txEm.flush();

      return {
        transactionId: wagerTx.id,
        status: wagerTx.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
        failureCode: wagerTx.failureCode,
      };
    });
  }

  private updateWalletOrm(orm: WalletOrmEntity, domain: any): void {
    orm.balance = domain.balance.toString();
    orm.version = domain.version;
    orm.updatedAt = domain.updatedAt;
  }

  private saveOrUpdateWagerTx(
    txEm: EntityManager,
    domain: WagerTransaction,
    walletOrm: WalletOrmEntity,
    existingOrm?: WagerTransactionOrmEntity | null,
  ): void {
    if (existingOrm) {
      existingOrm.status = domain.status;
      existingOrm.referenceTransactionId = domain.referenceTransactionId;
      existingOrm.failureCode = domain.failureCode;
      existingOrm.processedAt = domain.processedAt;
    } else {
      txEm.persist(WagerTransactionMapper.toOrm(domain, walletOrm));
    }
  }

  private async rejectTransaction(
    txEm: EntityManager,
    walletOrm: WalletOrmEntity,
    wallet: any,
    wagerTx: WagerTransaction,
    failureCode: FailureCode,
    correlationId: string,
    existingTxOrm?: WagerTransactionOrmEntity | null,
  ): Promise<ProcessWagerTransactionOutput> {
    wagerTx.reject(failureCode);
    this.saveOrUpdateWagerTx(txEm, wagerTx, walletOrm, existingTxOrm);

    const event = WagerTransactionRejected.create({
      eventId: uuidv4(),
      aggregateId: wagerTx.id,
      correlationId,
      data: {
        transactionId: wagerTx.id,
        providerId: wagerTx.providerId,
        externalTransactionId: wagerTx.externalTransactionId,
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: wagerTx.roundId,
        gameId: wagerTx.gameId,
        kind: wagerTx.kind,
        money: wagerTx.money.toJSON(),
        failureCode,
        rejectedAt: new Date().toISOString(),
      },
    });

    txEm.persist(OutboxMessageMapper.toOrm(OutboxMessage.enqueue(event)));
    await txEm.flush();

    return {
      transactionId: wagerTx.id,
      status: WagerTransactionStatus.Rejected,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
      failureCode,
    };
  }

  private enqueueBalanceAndProcessedEvents(
    txEm: EntityManager,
    wallet: any,
    wagerTx: WagerTransaction,
    ledgerEntry: WalletLedgerEntry,
    correlationId: string,
    refTxId?: string,
  ): void {
    const balanceEvent = WalletBalanceChanged.create({
      eventId: uuidv4(),
      aggregateId: wallet.id,
      correlationId,
      data: {
        walletId: wallet.id,
        transactionId: wagerTx.id,
        direction: ledgerEntry.direction,
        money: wagerTx.money.toJSON(),
        balanceBefore: ledgerEntry.balanceBefore.toJSON(),
        balanceAfter: ledgerEntry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });

    const processedEvent = WagerTransactionProcessed.create({
      eventId: uuidv4(),
      aggregateId: wagerTx.id,
      correlationId,
      data: {
        transactionId: wagerTx.id,
        providerId: wagerTx.providerId,
        externalTransactionId: wagerTx.externalTransactionId,
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: wagerTx.roundId,
        gameId: wagerTx.gameId,
        kind: wagerTx.kind,
        money: wagerTx.money.toJSON(),
        referenceTransactionId: refTxId,
        processedAt: new Date().toISOString(),
      },
    });

    txEm.persist(OutboxMessageMapper.toOrm(OutboxMessage.enqueue(balanceEvent)));
    txEm.persist(OutboxMessageMapper.toOrm(OutboxMessage.enqueue(processedEvent)));
  }
}

