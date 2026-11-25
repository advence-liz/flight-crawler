import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServer, Socket } from 'node:net';
import { Pool } from 'pg';

// OpenAI 4 uses its own fetch by default. Point it at the same test transport
// as the AI SDK without replacing either SDK’s serialization or retry logic.
jest.mock('openai', () => {
  const { default: OpenAI } = jest.requireActual<typeof import('openai')>('openai');
  return { __esModule: true, default: class extends OpenAI {
    constructor(options: ConstructorParameters<typeof OpenAI>[0]) {
      super({ ...options, fetch: (url, init) => globalThis.fetch(String(url), init as RequestInit) });
    }
  } };
});
import { TripAiLedger } from './trip-ai-ledger';
import { DAILY_LIMIT_NANO_CNY, MAX_ATTEMPT_NANO_CNY, quoteUsage } from './trip-ai-pricing';

const nativeFetch = globalThis.fetch;
const usage = { prompt_tokens: 1500, prompt_cache_hit_tokens: 500, prompt_cache_miss_tokens: 1000,
  completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 100 } };

describe('DeepSeek official pricing', () => {
  it('uses integer nano-yuan and does not double bill reasoning', () => {
    expect(quoteUsage(usage, new Date('2026-11-25T02:00:00Z'))).toMatchObject({
      estimatedNanoCny: 4_420_000, upperNanoCny: 4_420_000, rate: 'peak', reasoningTokens: 100,
    });
    expect(quoteUsage(usage, new Date('2026-11-25T05:00:00Z'))).toMatchObject({
      estimatedNanoCny: 2_210_000, upperNanoCny: 4_420_000, rate: 'off_peak',
    });
    expect(quoteUsage(usage, new Date('2026-10-01T02:00:00Z'))?.rate).toBe('off_peak');
    expect(quoteUsage(usage, new Date('2026-11-28T02:00:00Z'))?.rate).toBe('off_peak');
  });

  it('does not treat missing, inconsistent or out-of-bounds provider counts as zero-cost', () => {
    expect(quoteUsage(undefined, new Date())).toBeNull();
    expect(quoteUsage({ ...usage, prompt_cache_hit_tokens: undefined }, new Date())).toBeNull();
    expect(quoteUsage({ ...usage, prompt_tokens: 1 }, new Date())).toBeNull();
    expect(quoteUsage({ ...usage, completion_tokens: 4097 }, new Date())).toBeNull();
  });
});

// Explicitly point at a throwaway Postgres database; this suite truncates its ledger.
const connectionString = process.env.TEST_TRIP_AI_DATABASE_URL;
(connectionString ? describe : describe.skip)('daily ledger on PostgreSQL', () => {
  let pool: Pool;
  let first: TripAiLedger;
  let second: TripAiLedger;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    first = new TripAiLedger();
    second = new TripAiLedger();
    await Promise.all([first.summary(connectionString!), second.summary(connectionString!)]);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE trip_ai_attempts, trip_ai_days');
  });
  afterAll(async () => {
    await Promise.all([pool.end(), first.onModuleDestroy(), second.onModuleDestroy()]);
  });

  it('waits for a slow cold connection before reserving, without duplicating the attempt', async () => {
    const upstream = new URL(connectionString!);
    const upstreamPort = Number(upstream.port || 5432);
    const sockets = new Set<Socket>();
    const track = (socket: Socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
      return socket;
    };
    const proxy = createServer((client) => {
      track(client);
      const remote = track(new Socket());
      const timer = setTimeout(() => {
        remote.connect(upstreamPort, upstream.hostname);
        client.pipe(remote).pipe(client);
      }, 3300);
      client.once('close', () => { clearTimeout(timer); remote.destroy(); });
      remote.once('close', () => client.destroy());
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const addr = proxy.address();
    if (!addr || typeof addr === 'string') throw new Error('Test proxy did not bind');
    upstream.port = String(addr.port);
    const cold = new TripAiLedger();
    try {
      expect(await cold.reserve(upstream.href, 'chat')).not.toBeNull();
      expect(await first.summary(connectionString!)).toMatchObject({ pendingAttempts: 1 });
    } finally {
      await cold.onModuleDestroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => proxy.close(() => resolve()));
    }
  }, 8000);

  it('reports a PostgreSQL reservation lock timeout without writing a partial attempt', async () => {
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE trip_ai_days IN ACCESS EXCLUSIVE MODE');
      await expect(first.reserve(connectionString!, 'chat')).rejects.toThrow(/operation=reserve phase=query code=55P03 elapsedMs=\d+/);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect(await first.summary(connectionString!)).toMatchObject({ accountedNanoCny: 0, pendingAttempts: 0 });
  });

  it('atomically admits just two worst-case calls across independent pools', async () => {
    const reservations = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      (i % 2 ? first : second).reserve(connectionString!, i % 2 ? 'chat' : 'interpret')));
    expect(reservations.filter(Boolean)).toHaveLength(2);
    expect(await second.summary(connectionString!)).toMatchObject({
      limitNanoCny: DAILY_LIMIT_NANO_CNY, accountedNanoCny: 2 * MAX_ATTEMPT_NANO_CNY, pendingAttempts: 2,
    });
  });

  it('releases only known usage once, keeps failed reservations, and persists across instance restart', async () => {
    const a = (await first.reserve(connectionString!, 'interpret'))!;
    const b = (await second.reserve(connectionString!, 'chat'))!;
    const quote = quoteUsage(usage, a.startedAt)!;
    await Promise.all([first.settle(connectionString!, a.id, quote), second.settle(connectionString!, a.id, quote)]);
    await second.markUnknown(connectionString!, b.id);
    const restarted = new TripAiLedger();
    try {
      expect(await restarted.summary(connectionString!)).toMatchObject({
        accountedNanoCny: quote.upperNanoCny + MAX_ATTEMPT_NANO_CNY, estimatedNanoCny: quote.estimatedNanoCny,
        pendingAttempts: 0, unknownAttempts: 1, settledAttempts: 1,
      });
      expect(await restarted.reserve(connectionString!, 'chat')).not.toBeNull();
    } finally {
      await restarted.onModuleDestroy();
    }
  });

  it('settles against the reservation day, without touching the new day’s budget', async () => {
    const a = (await first.reserve(connectionString!, 'chat'))!;
    const quote = quoteUsage(usage, a.startedAt)!;
    // Simulate an in-flight ticket from the prior day without changing the server clock.
    await pool.query('INSERT INTO trip_ai_days SELECT day - 1, accounted_nano_cny FROM trip_ai_days');
    await pool.query('UPDATE trip_ai_attempts SET budget_day = budget_day - 1 WHERE id = $1', [a.id]);
    await first.settle(connectionString!, a.id, quote);
    expect(await second.summary(connectionString!)).toMatchObject({
      accountedNanoCny: MAX_ATTEMPT_NANO_CNY, estimatedNanoCny: 0, settledAttempts: 0,
    });
    const oldDay = await pool.query('SELECT accounted_nano_cny FROM trip_ai_days ORDER BY day LIMIT 1');
    expect(Number(oldDay.rows[0].accounted_nano_cny)).toBe(quote.upperNanoCny);
  });
});

(connectionString ? describe : describe.skip)('AI budget through Nest HTTP routes', () => {
  let app: INestApplication;
  let http: string;
  let pool: Pool;
  const adminHeader = { authorization: 'Bearer budget-test-only', 'content-type': 'application/json' };
  const chat = { messages: [{ role: 'user', content: '周末想出去玩' }] };
  const interpret = { text: '周末想出去玩' };
  const originalEnv = process.env;
  const request = (path: string, body?: object) => nativeFetch(`${http}/api/routes/ai-trip/${path}`, {
    headers: adminHeader, ...(body && { method: 'POST', body: JSON.stringify(body) }),
  });
  const completion = (text: string, counts?: typeof usage) => Response.json({
    id: 'fixture', model: 'deepseek-flash', created: 1,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: counts,
  });

  beforeAll(async () => {
    process.env = { ...originalEnv, NODE_ENV: 'test', TRIP_AI_ENABLED: 'true', DEEPSEEK_API_KEY: 'fake-provider-key',
      ADMIN_TOKEN: 'budget-test-only', TRIP_AI_BUDGET_DATABASE_URL: connectionString, DEEPSEEK_MODEL: 'deepseek-flash',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com', DB_DATABASE: ':memory:', CRAWLER_ENABLED: 'false' };
    pool = new Pool({ connectionString });
    const { AppModule } = await import('../../app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    http = await app.getUrl();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE trip_ai_attempts, trip_ai_days');
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider call'));
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    process.env = originalEnv;
    await Promise.all([app?.close(), pool?.end()]);
  });

  it('charges each chat retry and the legacy interpreter against the same persisted day', async () => {
    const intent = { origin: null, destination: null, startDate: null, endDate: null, card: null,
      maxTransfers: 0, maxLeaveDays: null, minStayHours: null, maxStayHours: null, departureWeekday: null,
      arrivalWeekday: null, departAfter: null, arriveBefore: null, unresolved: [] };
    const provider = jest.mocked(globalThis.fetch)
      .mockResolvedValueOnce(Response.json({ error: { message: 'upstream unavailable' } }, { status: 503 }))
      .mockResolvedValueOnce(completion('请问你从哪里出发？', usage))
      .mockResolvedValueOnce(completion(JSON.stringify(intent), usage));
    expect(await (await request('chat', chat)).json()).toEqual({ text: '请问你从哪里出发？' });
    expect((await request('interpret', interpret)).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(3);
    for (const [url, options] of provider.mock.calls) {
      expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
      expect(JSON.parse(String(options?.body))).toMatchObject({ model: 'deepseek-flash', max_tokens: 4096 });
    }
    const { rows } = await pool.query(`SELECT channel, state, cache_hit_tokens, reasoning_tokens
      FROM trip_ai_attempts ORDER BY started_at`);
    expect(rows).toEqual([
      { channel: 'chat', state: 'unknown', cache_hit_tokens: null, reasoning_tokens: null },
      { channel: 'chat', state: 'settled', cache_hit_tokens: 500, reasoning_tokens: 100 },
      { channel: 'interpret', state: 'settled', cache_hit_tokens: 500, reasoning_tokens: 100 },
    ]);
  });

  it('stops both paid routes with a clear 429 while manual flight queries still work', async () => {
    const provider = jest.mocked(globalThis.fetch).mockImplementation(async () => completion('请问你从哪里出发？'));
    expect((await request('chat', chat)).status).toBe(200);
    expect((await request('chat', chat)).status).toBe(200);
    for (const [path, body] of [['chat', chat], ['interpret', interpret]] as const) {
      const response = await request(path, body);
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ code: 'TRIP_AI_DAILY_BUDGET' });
    }
    expect(provider).toHaveBeenCalledTimes(2);
    expect(await (await request('usage')).json()).toMatchObject({ unknownAttempts: 2, settledAttempts: 0 });
    expect((await nativeFetch(`${http}/api/routes/ai-trip/usage`)).status).toBe(401);
    expect((await nativeFetch(`${http}/api/flights/cities`)).status).toBe(200);
  });

  it('reports and enforces the configured CNY limit instead of the default', async () => {
    process.env.TRIP_AI_DAILY_LIMIT_CNY = '3.25';
    try {
      const provider = jest.mocked(globalThis.fetch).mockResolvedValueOnce(completion('请补充日期。'));
      expect(await (await request('usage')).json()).toMatchObject({ limitNanoCny: 3_250_000_000 });
      expect((await request('chat', chat)).status).toBe(200);
      expect((await request('interpret', interpret)).status).toBe(429);
      expect(provider).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env.TRIP_AI_DAILY_LIMIT_CNY;
    }
  });

  it.each([['0', 429], ['not-money', 503]])('rejects outgoing calls with limit %s', async (limit, status) => {
    process.env.TRIP_AI_DAILY_LIMIT_CNY = limit;
    try {
      expect((await request('chat', chat)).status).toBe(status);
      expect((await request('interpret', interpret)).status).toBe(status);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect((await nativeFetch(`${http}/api/flights/cities`)).status).toBe(200);
    } finally {
      delete process.env.TRIP_AI_DAILY_LIMIT_CNY;
    }
  });

  it('blocks a retry before outbound I/O if the first attempt consumes the remaining allowance', async () => {
    const provider = jest.mocked(globalThis.fetch)
      .mockResolvedValueOnce(completion('请补充日期。'))
      .mockResolvedValueOnce(Response.json({ error: { message: 'upstream unavailable' } }, { status: 503 }));
    expect((await request('chat', chat)).status).toBe(200);
    const response = await request('chat', chat);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'TRIP_AI_DAILY_BUDGET' });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(await (await request('usage')).json()).toMatchObject({ unknownAttempts: 2 });
  });

  it('fails closed when the ledger cannot allocate, without disabling manual queries', async () => {
    jest.spyOn(TripAiLedger.prototype, 'reserve').mockRejectedValue(new Error('test DB failure'));
    for (const [path, body] of [['chat', chat], ['interpret', interpret]] as const) {
      expect((await request(path, body)).status).toBe(503);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect((await nativeFetch(`${http}/api/flights/cities`)).status).toBe(200);
  });

  it('never sends an official request without a budget DB or with a production gateway', async () => {
    process.env.TRIP_AI_BUDGET_DATABASE_URL = '';
    try {
      expect(await (await request('status')).json()).toEqual({ enabled: false, chatEnabled: false });
      expect((await request('chat', chat)).status).toBe(503);
      expect((await request('interpret', interpret)).status).toBe(503);
      process.env.NODE_ENV = 'production';
      process.env.DEEPSEEK_BASE_URL = 'https://example.invalid';
      expect((await request('chat', chat)).status).toBe(503);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = 'test';
      process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
      process.env.TRIP_AI_BUDGET_DATABASE_URL = connectionString;
    }
  });
});
