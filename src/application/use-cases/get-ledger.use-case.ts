import { EntityManager } from "@mikro-orm/postgresql";
import { WalletLedgerEntryOrmEntity } from "../../infrastructure/database/entities/wallet-ledger-entry.entity";
import { WalletNotFoundError } from "../errors/application.error";
import { WalletOrmEntity } from "../../infrastructure/database/entities/wallet.entity";

export interface GetLedgerInput {
  walletId: string;
  limit?: number;
  cursor?: string;
}

export interface LedgerItemDto {
  id: string;
  transactionId: string;
  direction: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  createdAt: string;
}

export interface GetLedgerOutput {
  items: LedgerItemDto[];
  nextCursor?: string;
  hasMore: boolean;
}

export class GetLedgerUseCase {
  constructor(private readonly em: EntityManager) {}

  public async execute(input: GetLedgerInput): Promise<GetLedgerOutput> {
    const forkEm = this.em.fork();
    const limit = Math.min(Math.max(input.limit || 50, 1), 100);

    const wallet = await forkEm.findOne(WalletOrmEntity, { id: input.walletId });
    if (!wallet) {
      throw new WalletNotFoundError(input.walletId);
    }

    const qb = forkEm.createQueryBuilder(WalletLedgerEntryOrmEntity, "e");
    qb.where({ wallet: input.walletId });

    if (input.cursor) {
      try {
        const decoded = Buffer.from(input.cursor, "base64").toString("utf-8");
        const { createdAt, id } = JSON.parse(decoded);

        qb.andWhere(
          '(e.created_at < ? OR (e.created_at = ? AND e.id < ?))',
          [new Date(createdAt), new Date(createdAt), id],
        );
      } catch (err) {
        // Se o cursor for inválido, ignora ou lança erro
      }
    }

    qb.orderBy({ createdAt: "DESC", id: "DESC" });
    qb.limit(limit + 1); // Pede 1 a mais para saber se tem próxima página

    const results = await qb.getResult();
    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    let nextCursor: string | undefined;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      const payload = JSON.stringify({
        createdAt: lastItem.createdAt.toISOString(),
        id: lastItem.id,
      });
      nextCursor = Buffer.from(payload, "utf-8").toString("base64");
    }

    return {
      items: items.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        direction: e.direction,
        amount: e.amount,
        currency: e.currency,
        balanceBefore: e.balanceBefore,
        balanceAfter: e.balanceAfter,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor,
      hasMore,
    };
  }
}

