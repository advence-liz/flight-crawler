import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DataSource } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { Flight } from '../flight/entities/flight.entity';
import { Airport } from '../flight/entities/airport.entity';
import { beijingNow, DAY_MS } from './ai-trip-intent';
import { FlightService } from '../flight/flight.service';
import { AiTripService } from './ai-trip.service';
import { RoundTripService } from './round-trip.service';
import { FlightMcpQuota, secondsUntilBeijingMidnight } from './flight-mcp-quota';
import { Pool } from 'pg';
import { SiteAuthService } from './site-auth.service';

let mcpKey = `sxf_${randomBytes(32).toString('hex')}`;
const adminKey = randomBytes(32).toString('hex');
const date = (days: number) => new Date(Date.parse(beijingNow()) + days * DAY_MS).toISOString().slice(0, 10);

const quotaDb = process.env.TEST_TRIP_AI_DATABASE_URL;

describe('MCP daily quota clock', () => {
  it('resets at Beijing midnight rather than UTC midnight', () => {
    expect(secondsUntilBeijingMidnight(Date.parse('2026-11-25T15:59:59Z'))).toBe(1);
    expect(secondsUntilBeijingMidnight(Date.parse('2026-11-25T16:00:00Z'))).toBe(86400);
  });
});

describe('flight MCP over Streamable HTTP', () => {
  const savedEnv = process.env;
  let app: INestApplication;
  let endpoint: URL;
  let client: Client;
  let pool: Pool | undefined;
  const quotaSchema = `mcp_test_${randomBytes(8).toString('hex')}`;
  const startDate = date(2);
  const endDate = date(4);

  beforeAll(async () => {
    process.env = { ...savedEnv, NODE_ENV: 'test', DB_DATABASE: ':memory:', CRAWLER_ENABLED: 'false',
      TRIP_AI_ENABLED: 'false', ADMIN_TOKEN: adminKey, FLIGHT_MCP_ENABLED: 'true',
      FLIGHT_MCP_DAILY_LIMIT: '100', FLIGHT_MCP_QUOTA_DATABASE_URL: quotaDb || 'test-only' };
    const { AppModule } = await import('../../app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    endpoint = new URL('/api/mcp', await app.getUrl());
    const db = app.get(DataSource);
    if (quotaDb) {
      pool = new Pool({ connectionString: quotaDb });
      await pool.query(`CREATE SCHEMA ${quotaSchema}`);
      const url = new URL(quotaDb);
      url.searchParams.set('options', `-c search_path=${quotaSchema}`);
      process.env.FLIGHT_MCP_QUOTA_DATABASE_URL = url.href;
      process.env.SITE_ADMIN_EMAIL = 'admin@example.test';
      const auth = app.get(SiteAuthService);
      Reflect.set(auth, 'config', { origin: endpoint.origin });
      Reflect.set(auth, 'runtime', { session: async (headers: { cookie?: string }) => headers.cookie === 'verified=admin'
        ? { id: 'admin-test-site', name: 'Site Admin', email: 'admin@example.test' } : null, close: async () => {} });
      const store = app.get(FlightMcpQuota);
      const user = await store.create('SDK test user');
      mcpKey = (await store.issue(user!.id))!.token;
    } else {
      let used = 0;
      const store = app.get(FlightMcpQuota);
      jest.spyOn(store, 'authorize').mockImplementation(async token => token === mcpKey);
      jest.spyOn(store, 'take').mockImplementation(async (token, limit) => token !== mcpKey
        ? 'unauthorized' : used < limit && ++used > 0 ? 'admitted' : 'daily_quota');
    }
    await db.getRepository(Airport).save([
      { name: '上海浦东', city: '上海', enableCrawl: true }, { name: '北京首都', city: '北京', enableCrawl: true },
    ]);
    const flight = (flightNo: string, origin: string, destination: string, day: string, has666Card: boolean) => ({
      flightNo, origin, destination, departureTime: new Date(`${day}T18:00:00Z`), arrivalTime: new Date(`${day}T20:00:00Z`),
      cardType: has666Card ? '666权益卡航班' : '2666权益卡航班', has666Card, has2666Card: !has666Card, crawledAt: new Date(),
    });
    await db.getRepository(Flight).save([
      flight('HU101', '上海浦东', '北京首都', startDate, true),
      flight('HU102', '北京首都', '上海浦东', endDate, true),
      flight('HU201', '上海浦东', '北京首都', startDate, false),
    ]);
    client = new Client({ name: 'flight-mcp-test', version: '1.0.0' });
  });

  afterAll(async () => {
    await client?.close();
    await app?.close();
    if (pool) {
      try { await pool.query(`DROP SCHEMA IF EXISTS ${quotaSchema} CASCADE`); } finally { await pool.end(); }
    }
    process.env = savedEnv;
  });

  it('does not let anonymous users issue personal MCP credentials', async () => {
    const response = await fetch(new URL('/api/account/mcp/token', endpoint), { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it('protects the user roster without exposing a registration endpoint', async () => {
    const roster = new URL('/api/admin/mcp-users', endpoint);
    expect((await fetch(roster)).status).toBe(401);
    expect((await fetch(roster, { headers: { authorization: `Bearer ${mcpKey}` } })).status).toBe(401);
    expect((await fetch(roster, { headers: { authorization: `Bearer ${adminKey}` } })).status).toBe(401);
    expect((await fetch(new URL('/api/register', endpoint), { method: 'POST' })).status).toBe(404);
  });

  (quotaDb ? it : it.skip)('manages individual keys, stores only a hash, and keeps usage across key rotations', async () => {
    const roster = new URL('/api/admin/mcp-users', endpoint);
    const adminRequest = (suffix = '', method = 'GET', body?: object) => fetch(`${roster}${suffix}`, {
      method, headers: { cookie: 'verified=admin', origin: endpoint.origin, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    expect((await adminRequest('', 'POST', { name: '  ' })).status).toBe(400);
    const created = await adminRequest('', 'POST', { name: '邀请测试用户' });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const issued = await adminRequest(`/${id}/token`, 'POST');
    expect(issued.status).toBe(201);
    expect(issued.headers.get('cache-control')).toBe('no-store');
    const { token } = await issued.json();
    const send = (key: string, method: string) => fetch(endpoint, { method: 'POST', headers: {
      authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 11, method, ...(method === 'tools/call' && { params: {
      name: 'search_flights', arguments: { origin: '上海', destination: '北京', startDate, endDate },
    } }) }) });
    expect((await send(token, 'tools/list')).status).toBe(200);
    expect((await send(token, 'tools/call')).status).toBe(200);
    const persisted = await pool!.query(`SELECT token_hash FROM ${quotaSchema}.flight_mcp_users WHERE id = $1`, [id]);
    expect(persisted.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted.rows[0].token_hash).not.toBe(token);
    const next = (await (await adminRequest(`/${id}/token`, 'POST')).json()).token;
    expect(next).not.toBe(token);
    expect((await send(token, 'tools/call')).status).toBe(401);
    expect((await send(next, 'tools/call')).status).toBe(200);
    const rosterBody = await (await adminRequest()).json();
    expect(rosterBody.users).toEqual(expect.arrayContaining([expect.objectContaining({ id, todayCalls: 2, hasToken: true })]));
    expect(JSON.stringify(rosterBody)).not.toMatch(/token_hash|sxf_/);
    expect((await adminRequest(`/${id}/token`, 'DELETE')).status).toBe(204);
    expect((await send(next, 'tools/list')).status).toBe(401);
    const third = (await (await adminRequest(`/${id}/token`, 'POST')).json()).token;
    expect((await adminRequest(`/${id}`, 'PATCH', { active: false })).status).toBe(204);
    expect((await send(third, 'tools/list')).status).toBe(401);
    expect((await adminRequest(`/${id}/token`, 'POST')).status).toBe(409);
    expect((await adminRequest(`/${id}`, 'PATCH', { active: true })).status).toBe(204);
    expect((await send(third, 'tools/list')).status).toBe(401);
  });

  it('requires its own token, not the admin token, and rejects untrusted browser origins', async () => {
    const post = (headers: HeadersInit = {}) => fetch(endpoint, { method: 'POST', headers });
    expect((await post()).status).toBe(401);
    expect((await post({ authorization: `Bearer ${adminKey}` })).status).toBe(401);
    expect((await post({ authorization: `Bearer ${mcpKey}`, origin: 'https://example.test' })).status).toBe(403);
  });

  it('discovers only two read tools and queries the real SQLite snapshot without an AI key', async () => {
    await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { authorization: `Bearer ${mcpKey}` } } }));
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['find_round_trips', 'search_flights']);
    expect(tools.every(t => t.annotations?.readOnlyHint)).toBe(true);
    const query = { origin: '上海', destination: '北京', startDate, endDate, card: '666' };
    const direct = await client.callTool({ name: 'search_flights', arguments: query });
    expect(direct.structuredContent).toMatchObject({ coverage: 'full', flights: [{ flightNo: 'HU101',
      departureTime: `${startDate}T18:00:00.000+08:00`, cards: ['666'] }] });
    const paired = await client.callTool({ name: 'find_round_trips', arguments: query });
    expect(paired.structuredContent).toMatchObject({ coverage: 'full', trips: [{ city: '北京',
      outbound: [{ flightNo: 'HU101' }], inbound: [{ flightNo: 'HU102' }] }] });
    const transfers = await client.callTool({ name: 'find_round_trips', arguments: { ...query, maxTransfers: 1 } });
    expect(transfers.isError).toBe(true);
    const noMatch = await client.callTool({ name: 'search_flights', arguments: { ...query, origin: '北京', destination: '上海', card: '2666' } });
    expect(noMatch.structuredContent).toMatchObject({ coverage: 'full', flights: [] });
    const noCoverage = await client.callTool({ name: 'search_flights', arguments: { ...query, startDate: date(8), endDate: date(10) } });
    expect(noCoverage.structuredContent).toMatchObject({ coverage: 'none', flights: [] });
    const partial = await client.callTool({ name: 'search_flights', arguments: { ...query, endDate: date(5), limit: 1, card: undefined } });
    expect(partial.structuredContent).toMatchObject({ coverage: 'partial', truncated: true, flights: [{ flightNo: 'HU101' }] });
    const invalid = await client.callTool({ name: 'search_flights', arguments: { ...query, endDate: date(91) } });
    expect(invalid.isError).toBe(true);
  });

  it('blocks further tool calls when the daily quota is lower than use, without blocking tool discovery', async () => {
    process.env.FLIGHT_MCP_DAILY_LIMIT = '1';
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: {
        authorization: `Bearer ${mcpKey}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      }, body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 4,
        params: { name: 'search_flights', arguments: { origin: '上海', destination: '北京', startDate, endDate } } }) });
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ error: { data: { reason: 'daily_quota' } } });
      expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await client.listTools()).toHaveProperty('tools');
      expect((await fetch(new URL('/api/flights/cities', endpoint))).status).toBe(200);
    } finally { delete process.env.FLIGHT_MCP_DAILY_LIMIT; }
  });

  it('rejects MCP before quota or flight I/O while a website lookup is active', async () => {
    const flightService = app.get(FlightService);
    const quota = app.get(FlightMcpQuota);
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const actualCities = flightService.getAvailableCities.bind(flightService);
    const cities = jest.spyOn(flightService, 'getAvailableCities').mockImplementationOnce(async () => {
      started();
      await hold;
      return await actualCities();
    });
    const quotaCall = jest.spyOn(quota, 'take');
    const previousCount = quotaCall.mock.calls.length;
    const website = fetch(new URL('/api/flights/cities', endpoint));
    try {
      await entered;
      const busy = await fetch(endpoint, { method: 'POST', headers: {
        authorization: `Bearer ${mcpKey}`, 'content-type': 'application/json',
      }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call' }) });
      expect(busy.status).toBe(429);
      expect(await busy.json()).toMatchObject({ error: { data: { reason: 'site_priority' } } });
      expect(quotaCall.mock.calls).toHaveLength(previousCount);
    } finally {
      release();
      expect((await website).status).toBe(200);
      cities.mockRestore();
      if (quotaDb) quotaCall.mockRestore();
    }
  });

  it('lets an arriving site search take the slot after the one running MCP search', async () => {
    const routes = app.get(RoundTripService);
    const explore = routes.exploreDestinations.bind(routes);
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const spy = jest.spyOn(routes, 'exploreDestinations').mockImplementationOnce(async (...args) => {
      started();
      await hold;
      return explore(...args);
    });
    const query = { origin: '上海', destination: '北京', startDate, endDate, card: '666' };
    const external = client.callTool({ name: 'find_round_trips', arguments: query });
    await entered;
    const site = app.get(AiTripService).search({ ...query, maxTransfers: 0, maxLeaveDays: null, minStayHours: null,
      maxStayHours: null, departureWeekday: null, arrivalWeekday: null, departAfter: null, arriveBefore: null, unresolved: [] });
    const websiteAssertion = expect(site).resolves.toMatchObject({ coverage: 'full' });
    release();
    try {
      await websiteAssertion;
      expect((await external).structuredContent).toMatchObject({ coverage: 'full' });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally { spy.mockRestore(); }
  });

  (quotaDb ? it : it.skip)('keeps the daily count when new processes connect and atomically rejects parallel allocations', async () => {
    const existing = await pool!.query(`SELECT calls FROM ${quotaSchema}.flight_mcp_daily_quota`);
    const limit = Number(existing.rows[0].calls) + 1;
    const other = new FlightMcpQuota();
    const third = new FlightMcpQuota();
    try {
      const user = await third.create('Second quota test user');
      const second = (await third.issue(user!.id))!.token;
      expect((await Promise.all([other.take(mcpKey, limit), third.take(second, limit)])).sort()).toEqual(['admitted', 'daily_quota']);
      const global = await pool!.query(`SELECT calls FROM ${quotaSchema}.flight_mcp_daily_quota`);
      const individual = await pool!.query(`SELECT sum(calls)::integer AS calls FROM ${quotaSchema}.flight_mcp_user_daily_usage`);
      expect(global.rows[0].calls).toBe(limit);
      expect(individual.rows[0].calls).toBe(limit);
    } finally { await Promise.all([other.onModuleDestroy(), third.onModuleDestroy()]); }
  });

  it('caps authorized traffic with Retry-After and resets the quota next minute', async () => {
    let minute = Math.floor(Date.now() / 60000) + 1;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => minute * 60000);
    try {
      const post = () => fetch(endpoint, { method: 'POST', headers: {
        authorization: `Bearer ${mcpKey}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      }, body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }) });
      for (let i = 0; i < 30; i++) expect((await post()).status).not.toBe(429);
      const denied = await post();
      expect(denied.status).toBe(429);
      expect(denied.headers.get('retry-after')).toBe('60');
      minute++;
      expect((await post()).status).not.toBe(429);
    } finally {
      clock.mockRestore();
    }
  });

  it('can be turned off separately without affecting the flight API', async () => {
    process.env.FLIGHT_MCP_ENABLED = 'false';
    expect((await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${mcpKey}` } })).status).toBe(404);
    expect((await fetch(new URL('/api/flights/cities', endpoint))).status).toBe(200);
  });
});
