import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { CreateWalletDto } from "../dto/create-wallet.dto";
import { OpenWalletUseCase } from "../../../application/use-cases/open-wallet.use-case";
import { ReconciliationUseCase } from "../../../application/use-cases/reconciliation.use-case";
import { GetLedgerUseCase } from "../../../application/use-cases/get-ledger.use-case";
import { WalletOrmEntity } from "../../../infrastructure/database/entities/wallet.entity";
import { WalletNotFoundError } from "../../../application/errors/application.error";

@Controller("wallets")
export class WalletController {
  constructor(private readonly em: EntityManager) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async createWallet(@Body() dto: CreateWalletDto) {
    const useCase = new OpenWalletUseCase(this.em);
    return useCase.execute({
      playerId: dto.playerId,
      initialBalance: dto.initialBalance,
    });
  }

  @Get(":walletId")
  public async getWallet(@Param("walletId") walletId: string) {
    const forkEm = this.em.fork();
    const wallet = await forkEm.findOne(WalletOrmEntity, { id: walletId });

    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: {
        amount: wallet.balance,
        currency: wallet.currency,
      },
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  @Get(":walletId/ledger")
  public async getLedger(
    @Param("walletId") walletId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const useCase = new GetLedgerUseCase(this.em);
    return useCase.execute({
      walletId,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post(":walletId/reconciliation")
  @HttpCode(HttpStatus.OK)
  public async reconcile(@Param("walletId") walletId: string) {
    const useCase = new ReconciliationUseCase(this.em);
    return useCase.execute(walletId);
  }
}

