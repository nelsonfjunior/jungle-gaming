import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { EntityManager } from "@mikro-orm/postgresql";
import { SubmitTransactionDto } from "../dto/submit-transaction.dto";
import { ProcessWagerTransactionUseCase } from "../../../application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionOrmEntity } from "../../../infrastructure/database/entities/wager-transaction.entity";
import { TransactionNotFoundError } from "../../../application/errors/application.error";
import { WagerTransactionStatus } from "../../../domain/entities/wager-transaction";

@Controller()
export class WageringController {
  constructor(private readonly em: EntityManager) {}

  @Post("wagering/transactions")
  public async submitTransaction(
    @Headers("idempotency-key") idempotencyKey: string,
    @Headers("x-correlation-id") correlationId: string,
    @Body() dto: SubmitTransactionDto,
    @Res() res: Response,
  ) {
    if (!idempotencyKey || idempotencyKey.trim() === "") {
      throw new BadRequestException("Header 'Idempotency-Key' is required");
    }

    const useCase = new ProcessWagerTransactionUseCase(this.em);
    const output = await useCase.execute({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      idempotencyKey,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money: dto.money,
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
      correlationId,
    });

    // Mapeamento semântico dos códigos HTTP conforme exigido na seção 9 do edital:
    // - REJECTED: 422 Unprocessable Entity
    // - PENDING_REFERENCE: 202 Accepted
    // - PROCESSED: 200 OK
    let httpStatus = HttpStatus.OK;
    if (output.status === WagerTransactionStatus.Rejected) {
      httpStatus = HttpStatus.UNPROCESSABLE_ENTITY;
    } else if (output.status === WagerTransactionStatus.PendingReference) {
      httpStatus = HttpStatus.ACCEPTED;
    }

    return res.status(httpStatus).json(output);
  }

  @Get("wagering/transactions/:transactionId")
  public async getTransactionById(@Param("transactionId") transactionId: string) {
    const forkEm = this.em.fork();
    const tx = await forkEm.findOne(
      WagerTransactionOrmEntity,
      { id: transactionId },
      { populate: ["wallet"] },
    );

    if (!tx) {
      throw new TransactionNotFoundError(transactionId);
    }

    return {
      transactionId: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.wallet.id,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      status: tx.status,
      money: { amount: tx.amount, currency: tx.currency },
      balance: { amount: tx.wallet.balance, currency: tx.wallet.currency },
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      referenceTransactionId: tx.referenceTransactionId,
      failureCode: tx.failureCode,
      createdAt: tx.createdAt.toISOString(),
      processedAt: tx.processedAt?.toISOString(),
    };
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  public async getTransactionByProviderAndExternalId(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ) {
    const forkEm = this.em.fork();
    const tx = await forkEm.findOne(
      WagerTransactionOrmEntity,
      { providerId, externalTransactionId },
      { populate: ["wallet"] },
    );

    if (!tx) {
      throw new TransactionNotFoundError(
        `provider '${providerId}' / external '${externalTransactionId}'`,
      );
    }

    return {
      transactionId: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.wallet.id,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      status: tx.status,
      money: { amount: tx.amount, currency: tx.currency },
      balance: { amount: tx.wallet.balance, currency: tx.wallet.currency },
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      referenceTransactionId: tx.referenceTransactionId,
      failureCode: tx.failureCode,
      createdAt: tx.createdAt.toISOString(),
      processedAt: tx.processedAt?.toISOString(),
    };
  }
}
