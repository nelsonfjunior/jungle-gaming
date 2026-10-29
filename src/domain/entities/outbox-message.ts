import { IntegrationEvent } from "../events/integration-event";

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  private static readonly INITIAL_RETRY_DELAY_MS = 1000; // 1s inicial
  private static readonly MAX_RETRY_DELAY_MS = 60000; // 60s max backoff

  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  public static enqueue<T>(event: IntegrationEvent<T>): OutboxMessage {
    const payload = event.toJSON() as unknown as Record<string, unknown>;

    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      payload,
      event.occurredAt,
      0,
      event.occurredAt, // Imediatamente elegível para publicação
    );
  }

  public static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  public get attempts(): number {
    return this._attempts;
  }

  public get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  public get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  public isPending(): boolean {
    return this._publishedAt === undefined;
  }

  public isDue(now: Date = new Date()): boolean {
    if (!this.isPending()) {
      return false;
    }
    if (!this._nextAttemptAt) {
      return true;
    }
    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  public markPublished(at: Date = new Date()): void {
    this._publishedAt = at;
    this._nextAttemptAt = undefined;
  }

  /**
   * Incrementa attempts e calcula o próximo nextAttemptAt com backoff exponencial
   */
  public scheduleRetry(now: Date = new Date()): void {
    this._attempts += 1;
    // Backoff: 1s * 2^(attempts-1) limitado a 60s
    const delay = Math.min(
      OutboxMessage.INITIAL_RETRY_DELAY_MS * Math.pow(2, this._attempts - 1),
      OutboxMessage.MAX_RETRY_DELAY_MS,
    );

    this._nextAttemptAt = new Date(now.getTime() + delay);
  }
}

