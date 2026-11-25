import { BadGatewayException, GatewayTimeoutException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { tripIntentPrompt } from './ai-trip-intent';

@Injectable()
export class DeepSeekTripModel {
  private readonly logger = new Logger(DeepSeekTripModel.name);
  private inFlight = 0;

  enabled(): boolean {
    return process.env.TRIP_AI_ENABLED === 'true' && Boolean(process.env.DEEPSEEK_API_KEY)
      && (process.env.NODE_ENV === 'development' || Boolean(process.env.ADMIN_TOKEN));
  }

  chatModel() {
    return createOpenAICompatible({
      name: 'deepseek',
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY,
      transformRequestBody: (body) => ({ ...body, thinking: { type: 'disabled' } }),
    }).chatModel(process.env.DEEPSEEK_MODEL || 'deepseek-flash');
  }

  async parse(text: string, now: string): Promise<unknown> {
    if (!this.enabled()) throw new ServiceUnavailableException('AI 行程规划未启用');
    if (this.inFlight >= 2) throw new HttpException('AI 行程规划正在忙，请稍后重试', HttpStatus.TOO_MANY_REQUESTS);
    this.inFlight++;
    try {
      const client = new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
        timeout: 45_000,
        maxRetries: 0,
      });
      // DeepSeek extension to the OpenAI-compatible request.
      const params = {
        model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        messages: [{ role: 'system', content: tripIntentPrompt(now) }, { role: 'user', content: text }],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        // Some compatible gateways count reasoning even with thinking disabled.
        max_tokens: 4096,
      } as const;
      const response = await client.chat.completions.create({ ...params, messages: [...params.messages] });
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
