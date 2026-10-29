import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { MikroORM } from "@mikro-orm/postgresql";
import {
  ProcessWagerTransactionInput,
  ProcessWagerTransactionUseCase,
} from "../../application/use-cases/process-wager-transaction.use-case";

export class SqsWagerConsumerService {
  private isRunning = false;
  private readonly consumerName = "sqs-wager-consumer";

  constructor(
    private readonly sqsClient: SQSClient,
    private readonly orm: MikroORM,
    private readonly queueUrl: string = process.env.SQS_MAIN_QUEUE_URL || "",
  ) {}

  public async start(): Promise<void> {
    this.isRunning = true;
    this.pollLoop();
  }

  public stop(): void {
    this.isRunning = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.pollMessages();
      } catch (err) {
        console.error("[SqsWagerConsumer] Polling error:", err);
        // Pequena pausa em caso de erro de conexão com o broker
        await new Promise((res) => setTimeout(res, 2000));
      }
    }
  }

  public async pollMessages(maxMessages: number = 5): Promise<number> {
    if (!this.queueUrl) return 0;

    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: 2, // Long polling
      VisibilityTimeout: 30,
    });

    const response = await this.sqsClient.send(command);
    const messages = response.Messages || [];

    for (const msg of messages) {
      if (!msg.Body || !msg.ReceiptHandle) continue;

      try {
        await this.processMessage(msg.Body, msg.MessageId || "unknown");

        // ACK: Deleta mensagem SOMENTE após o commit da transação SQL
        await this.sqsClient.send(
          new DeleteMessageCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: msg.ReceiptHandle,
          }),
        );
      } catch (error: any) {
        console.error(
          `[SqsWagerConsumer] Error processing message ${msg.MessageId}:`,
          error.message,
        );

        // Se for erro de infraestrutura temporário, devolve visibilidade para retry rápido
        try {
          await this.sqsClient.send(
            new ChangeMessageVisibilityCommand({
              QueueUrl: this.queueUrl,
              ReceiptHandle: msg.ReceiptHandle,
              VisibilityTimeout: 5,
            }),
          );
        } catch (visErr) {
          console.error("[SqsWagerConsumer] Failed to change visibility:", visErr);
        }
      }
    }

    return messages.length;
  }

  public async processMessage(bodyString: string, sqsMessageId: string): Promise<void> {
    let parsed: any;
    try {
      parsed = JSON.parse(bodyString);
    } catch (parseErr) {
      throw new Error(`Invalid JSON payload: ${bodyString}`);
    }

    // Se o tipo for especificado e não for WagerTransactionRequested, ignora (ex.: eventos de integração)
    if (parsed.type && parsed.type !== "WagerTransactionRequested" && parsed.eventType) {
      return;
    }

    const data = parsed.data || parsed;
    if (!data.kind || !data.money) {
      return;
    }

    const messageId = parsed.messageId || sqsMessageId;

    const input: ProcessWagerTransactionInput = {
      providerId: data.providerId,
      externalTransactionId: data.externalTransactionId,
      idempotencyKey: data.idempotencyKey || `${data.providerId}:${data.externalTransactionId}`,
      playerId: data.playerId,
      walletId: data.walletId,
      roundId: data.roundId,
      gameId: data.gameId,
      kind: data.kind,
      money: data.money,
      referenceExternalTransactionId: data.referenceExternalTransactionId,
      messageId,
      consumerName: this.consumerName,
      correlationId: parsed.correlationId || messageId,
    };

    const em = this.orm.em.fork();
    const useCase = new ProcessWagerTransactionUseCase(em);
    await useCase.execute(input);
  }
}
