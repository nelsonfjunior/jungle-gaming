import {
  MiddlewareConsumer,
  Module,
  NestModule,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { SQSClient } from "@aws-sdk/client-sqs";
import config from "./infrastructure/database/mikro-orm.config";
import { createSqsClient } from "./infrastructure/messaging/sqs-client";
import { OutboxDispatcherService } from "./infrastructure/messaging/outbox-dispatcher.service";
import { SqsWagerConsumerService } from "./infrastructure/messaging/sqs-wager-consumer.service";
import { PendingReferenceResolverService } from "./infrastructure/messaging/pending-reference-resolver.service";
import { WalletController } from "./interfaces/http/controllers/wallet.controller";
import { WageringController } from "./interfaces/http/controllers/wagering.controller";
import { HealthController } from "./interfaces/http/controllers/health.controller";
import { CorrelationIdMiddleware } from "./interfaces/http/middlewares/correlation-id.middleware";
import { MikroORM } from "@mikro-orm/postgresql";

@Module({
  imports: [MikroOrmModule.forRoot(config)],
  controllers: [WalletController, WageringController, HealthController],
  providers: [
    {
      provide: SQSClient,
      useFactory: () => createSqsClient(),
    },
    {
      provide: OutboxDispatcherService,
      useFactory: (orm: MikroORM, sqs: SQSClient) => {
        return new OutboxDispatcherService(orm, sqs);
      },
      inject: [MikroORM, SQSClient],
    },
    {
      provide: SqsWagerConsumerService,
      useFactory: (sqs: SQSClient, orm: MikroORM) => {
        return new SqsWagerConsumerService(sqs, orm);
      },
      inject: [SQSClient, MikroORM],
    },
    {
      provide: PendingReferenceResolverService,
      useFactory: (orm: MikroORM) => {
        return new PendingReferenceResolverService(orm);
      },
      inject: [MikroORM],
    },
  ],
})
export class AppModule
  implements NestModule, OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    private readonly outboxDispatcher: OutboxDispatcherService,
    private readonly sqsConsumer: SqsWagerConsumerService,
    private readonly pendingResolver: PendingReferenceResolverService,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }

  async onApplicationBootstrap(): Promise<void> {
    // Inicia os workers em segundo plano somente se não estiver em ambiente de teste automatizado puro
    if (process.env.NODE_ENV !== "test") {
      console.log("[AppModule] Starting background workers...");
      await this.outboxDispatcher.start(2000);
      await this.pendingResolver.start(5000);
      this.sqsConsumer.start();
      console.log("[AppModule] Background workers started successfully.");
    }
  }

  onApplicationShutdown(signal?: string): void {
    console.log(`[AppModule] Shutting down workers gracefully on signal ${signal}...`);
    this.outboxDispatcher.stop();
    this.sqsConsumer.stop();
    this.pendingResolver.stop();
  }
}

