import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { TripAiLedger, TripAiLedgerError } from './trip-ai-ledger';
import { quoteUsage } from './trip-ai-pricing';

@Injectable()
export class TripAiBudget {
  private readonly logger = new Logger(TripAiBudget.name);

  constructor(private readonly ledger: TripAiLedger) {}

  async run<T>(databaseUrl: string, channel: 'chat' | 'interpret', send: () => PromiseLike<T>,
    getUsage: (response: T) => unknown, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const ticket = await this.access(() => this.ledger.reserve(databaseUrl, channel));
    if (!ticket) throw new HttpException({ statusCode: 429, code: 'TRIP_AI_DAILY_BUDGET',
      message: '今日 AI 额度不足，按北京时间零点恢复；你仍可手动查询航班。' }, HttpStatus.TOO_MANY_REQUESTS);

    let response: T;
    try {
      signal?.throwIfAborted();
      response = await send();
    } catch (error) {
      await this.recordOutcome(() => this.ledger.markUnknown(databaseUrl, ticket.id));
      throw error;
    }
    const quote = quoteUsage(getUsage(response), ticket.startedAt);
    await this.recordOutcome(() => quote
      ? this.ledger.settle(databaseUrl, ticket.id, quote)
      : this.ledger.markUnknown(databaseUrl, ticket.id));
    return response;
  }

  summary(databaseUrl: string) {
    return this.access(() => this.ledger.summary(databaseUrl));
  }

  async probe(databaseUrl: string) {
    const start = performance.now();
    try {
      await this.ledger.summary(databaseUrl);
      this.logger.log(`AI budget ledger ready elapsedMs=${Math.round(performance.now() - start)}`);
    } catch (error) {
      this.warn('startup check failed', error);
    }
  }

  private warn(reason: string, error: unknown) {
    // A database error can embed credentials, hostnames or connection parameters.
    const detail = error instanceof TripAiLedgerError ? ` ${error.message}` : '';
    this.logger.warn(`AI budget ledger ${reason}${detail}`);
  }

  private async access<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      this.warn('unavailable', error);
      throw new ServiceUnavailableException('AI 额度暂不可用，请稍后重试或手动查询航班');
    }
  }

  private async recordOutcome(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      // Keep the durable reservation if writing the receipt fails; do not retry
      // or discard the already paid-for user response.
      this.warn('outcome not recorded; reservation retained unless already settled', error);
    }
  }
}
