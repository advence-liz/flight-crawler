import { BadGatewayException, GatewayTimeoutException, HttpException, HttpStatus, Injectable, Logger, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { wrapLanguageModel } from 'ai';
import { tripIntentPrompt } from './ai-trip-intent';
import { TripAiBudget } from './trip-ai-budget';
import { BUDGET_MODEL, MAX_OUTPUT_TOKENS } from './trip-ai-pricing';

const OFFICIAL_URL = 'https://api.deepseek.com';
type Target = { baseURL: string; model: string; apiKey: string; databaseUrl?: string };

@Injectable()
export class DeepSeekTripModel implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeepSeekTripModel.name);
  private inFlight = 0;

  constructor(private readonly budget: TripAiBudget) {}

  onApplicationBootstrap() {
    const databaseUrl = this.target()?.databaseUrl;
    // Check the deployed credentials and schema once without blocking flight
    // traffic or making a paid model call. On failure, normal requests can retry.
    if (process.env.RENDER && databaseUrl) void this.budget.probe(databaseUrl);
  }

  searchEnabled(): boolean {
    return process.env.TRIP_AI_ENABLED === 'true' && Boolean(process.env.DEEPSEEK_API_KEY)
      && (process.env.NODE_ENV === 'development' || process.env.SITE_AUTH_ENABLED === 'true');
  }

  private target(): Target | undefined {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!this.searchEnabled() || !apiKey) return;
    const baseURL = (process.env.DEEPSEEK_BASE_URL || OFFICIAL_URL).replace(/\/+$/, '');
    const model = process.env.DEEPSEEK_MODEL || BUDGET_MODEL;
    if (baseURL === OFFICIAL_URL || baseURL === `${OFFICIAL_URL}/v1`) {
      const databaseUrl = process.env.TRIP_AI_BUDGET_DATABASE_URL?.trim();
      return databaseUrl && model === BUDGET_MODEL ? { baseURL, model, apiKey, databaseUrl } : undefined;
    }
    // The separately authorized gateway is for local evaluation only. Its
    // tariff/usage is not interchangeable with official CNY pricing.
    if (process.env.RENDER || (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test')) return;
    if (!URL.canParse(baseURL)) return;
    const url = new URL(baseURL);
    if (['https:', 'http:'].includes(url.protocol) && url.hostname !== 'api.deepseek.com') {
      return { baseURL, model, apiKey };
    }
  }

  enabled(): boolean {
    return Boolean(this.target());
  }

  private requireTarget() {
    const target = this.target();
    if (!target) throw new ServiceUnavailableException('AI 行程规划未启用');
    return target;
  }

  usage() {
    const databaseUrl = process.env.TRIP_AI_BUDGET_DATABASE_URL?.trim();
    if (!databaseUrl) {
      throw new ServiceUnavailableException('AI 额度账本尚未配置');
    }
    return this.budget.summary(databaseUrl);
  }

  chatModel() {
    const { baseURL, model, apiKey, databaseUrl } = this.requireTarget();
    const providerModel = createOpenAICompatible({
      name: 'deepseek', baseURL, apiKey,
      transformRequestBody: (body) => ({ ...body, max_tokens: MAX_OUTPUT_TOKENS, thinking: { type: 'disabled' } }),
    }).chatModel(model);
    if (!databaseUrl) return providerModel;
    // The SDK retries doGenerate, so every actual attempt needs its own ticket.
    return wrapLanguageModel({ model: providerModel, middleware: {
      specificationVersion: 'v3',
      wrapGenerate: ({ doGenerate, params }) => this.budget.run(databaseUrl, 'chat', doGenerate,
        (response) => (response.response?.body as { usage?: unknown } | undefined)?.usage, params.abortSignal),
      wrapStream: async () => { throw new ServiceUnavailableException('AI 行程规划不支持流式生成'); },
    } });
  }

  async parse(text: string, now: string): Promise<unknown> {
    const { baseURL, model, apiKey, databaseUrl } = this.requireTarget();
    if (this.inFlight >= 2) throw new HttpException('AI 行程规划正在忙，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
    this.inFlight++;
    try {
      const client = new OpenAI({ apiKey, baseURL, timeout: 45_000, maxRetries: 0 });
      // DeepSeek extension to the OpenAI-compatible request.
      const params = {
        model,
        messages: [{ role: 'system', content: tripIntentPrompt(now) }, { role: 'user', content: text }],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        max_tokens: MAX_OUTPUT_TOKENS,
      } as const;
      const send = () => client.chat.completions.create({ ...params, messages: [...params.messages] });
      const response = databaseUrl ? await this.budget.run(databaseUrl, 'interpret', send, result => result.usage) : await send();
      const choice = response.choices[0];
      if (choice?.finish_reason !== 'stop' || !choice.message.content?.trim()) {
        throw new BadGatewayException('DeepSeek 没有返回完整条件，请重试');
      }
      return JSON.parse(choice.message.content) as unknown;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof OpenAI.APIConnectionTimeoutError) throw new GatewayTimeoutException('DeepSeek 响应超时，请重试');
      // Never log the user prompt, credentials, or provider response body.
      if (error instanceof OpenAI.APIError) this.logger.warn(`DeepSeek request failed: HTTP ${error.status ?? 'unavailable'}`);
      throw new BadGatewayException('DeepSeek 暂时无法解析行程，请重试或使用普通查询');
    } finally {
      this.inFlight--;
    }
  }
}
