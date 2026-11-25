import { isWorkday } from 'chinese-days';
import { z } from 'zod';

export const BUDGET_MODEL = 'deepseek-flash';
export const MAX_OUTPUT_TOKENS = 4096;
// Round the provider's published “1M” context up to a binary million.
const CONTEXT_TOKENS = 1_048_576;
const NANO_CNY_PER_YUAN = 1_000_000_000;
export const DAILY_LIMIT_NANO_CNY = 5 * NANO_CNY_PER_YUAN;

export function dailyLimitNanoCny(raw: string | undefined): number {
  if (raw === undefined) return DAILY_LIMIT_NANO_CNY;
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) throw new Error('Invalid TRIP_AI_DAILY_LIMIT_CNY');
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  const limit = cents * (NANO_CNY_PER_YUAN / 100);
  if (!Number.isSafeInteger(limit)) throw new Error('Invalid TRIP_AI_DAILY_LIMIT_CNY');
  return limit;
}

// https://api-docs.deepseek.com/zh-cn/quick_start/pricing (checked 2026-11-25).
// 元/百万 token × 1000 = nano-CNY/token. Store the tariff version for reconciliation.
export const TARIFF_VERSION = 'deepseek-flash-cny-2026-11-25';
const tariffs = {
  peak: { hit: 40, miss: 2000, output: 8000 },
  off_peak: { hit: 20, miss: 1000, output: 4000 },
};
// We have no provider-side preflight token count. Use the documented context and
// output limits, no cache hits and peak rates; never guess from character count.
export const MAX_ATTEMPT_NANO_CNY = CONTEXT_TOKENS * tariffs.peak.miss + MAX_OUTPUT_TOKENS * tariffs.peak.output;

const tokens = z.number().int().nonnegative();
const usageSchema = z.object({
  prompt_tokens: tokens.max(CONTEXT_TOKENS),
  prompt_cache_hit_tokens: tokens.max(CONTEXT_TOKENS),
  prompt_cache_miss_tokens: tokens.max(CONTEXT_TOKENS),
  completion_tokens: tokens.max(MAX_OUTPUT_TOKENS),
  completion_tokens_details: z.object({ reasoning_tokens: tokens.nullish() }).nullish(),
});

function rateAt(startedAt: Date): keyof typeof tariffs {
  const china = new Date(startedAt.getTime() + 8 * 3_600_000);
  const weekday = china.getUTCDay();
  const hour = china.getUTCHours();
  return weekday >= 1 && weekday <= 5 && isWorkday(china.toISOString().slice(0, 10))
    && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)) ? 'peak' : 'off_peak';
}

export function quoteUsage(raw: unknown, startedAt: Date) {
  const parsed = usageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { prompt_tokens, prompt_cache_hit_tokens: cacheHitTokens, prompt_cache_miss_tokens: cacheMissTokens,
    completion_tokens: outputTokens, completion_tokens_details } = parsed.data;
  const reasoningTokens = completion_tokens_details?.reasoning_tokens ?? null;
  if (prompt_tokens !== cacheHitTokens + cacheMissTokens || (reasoningTokens ?? 0) > outputTokens) return null;
  const rate = rateAt(startedAt);
  const cost = (t: typeof tariffs.peak) => cacheHitTokens * t.hit + cacheMissTokens * t.miss + outputTokens * t.output;
  // The published price schedule does not say how calls spanning a rate change
  // are billed. Use peak for enforcement even if the receipt estimates off-peak.
  return { cacheHitTokens, cacheMissTokens, outputTokens, reasoningTokens, rate,
    estimatedNanoCny: cost(tariffs[rate]), upperNanoCny: cost(tariffs.peak) };
}

export type UsageQuote = NonNullable<ReturnType<typeof quoteUsage>>;
