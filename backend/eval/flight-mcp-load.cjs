// Local-only mixed traffic check. TEST_TRIP_AI_DATABASE_URL must point at disposable PostgreSQL.
const assert = require('node:assert/strict');
const { mkdtempSync, copyFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { setTimeout: pause } = require('node:timers/promises');
const { Pool } = require('pg');

async function run() {
  const input = process.argv[2];
  const connectionString = process.env.TEST_TRIP_AI_DATABASE_URL;
  assert.ok(input && connectionString, 'Usage: provide TEST_TRIP_AI_DATABASE_URL and a recent flight SQLite snapshot');
  const directUrl = new URL(connectionString);
  assert.ok(['127.0.0.1', '[::1]', 'localhost'].includes(directUrl.hostname), 'Use a loopback PostgreSQL test database');
  const db = new Pool({ connectionString });
  const schema = `mcp_load_${randomBytes(8).toString('hex')}`;
  const dir = mkdtempSync(path.join(tmpdir(), 'flight-mcp-load-'));
  const token = () => randomBytes(32).toString('hex');
  const admin = token();
  let app;
  try {
    const snapshot = path.join(dir, 'snapshot.db');
    copyFileSync(input, snapshot);
    await db.query(`CREATE SCHEMA ${schema}`);
    directUrl.searchParams.set('options', `-c search_path=${schema}`);
    Object.assign(process.env, { NODE_ENV: 'test', TZ: 'UTC', CRAWLER_ENABLED: 'false', CRAWLER_AUTO_CRAWL: 'false',
      DB_DATABASE: snapshot, ADMIN_TOKEN: admin, TRIP_AI_ENABLED: 'true', DEEPSEEK_API_KEY: 'local-placeholder-not-a-model-key',
      FLIGHT_MCP_ENABLED: 'false', FLIGHT_MCP_DAILY_LIMIT: '100', FLIGHT_MCP_QUOTA_DATABASE_URL: directUrl.href });
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('../dist/app.module');
    const { FlightService } = require('../dist/modules/flight/flight.service');
    const { FlightMcpQuota } = require('../dist/modules/route/flight-mcp-quota');
    const { beijingNow } = require('../dist/modules/route/ai-trip-intent');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const access = app.get(FlightMcpQuota);
    const user = await access.create('Local benchmark');
    const { token: mcp } = await access.issue(user.id);
    const range = await app.get(FlightService).getFlightDateRange();
    const startDate = [range.minDate, beijingNow().slice(0, 10)].sort()[1];
    assert.ok(range.maxDate && startDate && startDate < range.maxDate, 'Snapshot must cover future flights');
    const endDate = [range.maxDate, new Date(Date.parse(startDate) + 25 * 86400000).toISOString().slice(0, 10)].sort()[0];
    const criteria = { origin: '上海', destination: null, startDate, endDate, card: '666', maxTransfers: 0,
      maxLeaveDays: 0, minStayHours: 30, maxStayHours: null, departureWeekday: 5, arrivalWeekday: 0,
      departAfter: '18:00', arriveBefore: '22:00', unresolved: [] };
    const request = async (route, body, bearer, accept) => {
      const start = performance.now();
      const response = await fetch(`${url}/api/${route}`, { signal: AbortSignal.timeout(10000),
        headers: { ...(bearer && { authorization: `Bearer ${bearer}` }), ...(accept && { accept }),
          ...(body && { 'content-type': 'application/json' }) },
        ...(body && { method: 'POST', body: JSON.stringify(body) }) });
      const result = await response.json();
      return { status: response.status, elapsed: performance.now() - start, result };
    };
    const site = () => request('routes/ai-trip/search', criteria, admin);
    const cities = () => request('flights/cities');
    let id = 0;
    const fetchMcp = () => request('mcp', { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: {
      name: 'find_round_trips', arguments: { origin: criteria.origin, startDate, endDate, card: '666', maxTransfers: 0 },
    } }, mcp, 'application/json, text/event-stream');
    const warm = await site();
    assert.equal(warm.status, 200);
    assert.equal(warm.result.coverage, 'full');
    const runPhase = async (mixed) => {
      const siteSearch = [], cityReads = [], external = [];
      for (let i = 0; i < 14; i++) {
        let call;
        if (mixed && i % 2 === 0) { call = fetchMcp(); await pause(8); }
        const lookup = site();
        if (mixed && i % 2 !== 0) { await pause(2); call = fetchMcp(); }
        const [searchResult, cityOne, cityTwo, mcpResult] = await Promise.all([lookup, cities(), cities(), call]);
        siteSearch.push(searchResult); cityReads.push(cityOne, cityTwo);
        if (mcpResult) external.push(mcpResult);
      }
      const summarize = (rows) => {
        const times = rows.map(r => r.elapsed).sort((a, b) => a - b);
        return { count: rows.length, p95Ms: Math.round(times[Math.ceil(times.length * .95) - 1]),
          ok: rows.filter(r => r.status === 200 && !r.result.result?.isError).length };
      };
      const summary = { siteSearch: summarize(siteSearch), cityReads: summarize(cityReads),
        ...(mixed && { mcp: { ok: external.filter(r => r.status === 200 && !r.result.result?.isError).length,
          yielded: external.filter(r => r.status === 429 && r.result.error?.data?.reason === 'site_priority').length } }) };
      assert.equal(summary.siteSearch.ok, 14);
      assert.equal(summary.cityReads.ok, 28);
      if (mixed) { assert.ok(summary.mcp.ok > 0); assert.ok(summary.mcp.yielded > 0); }
      return summary;
    };
    console.log('baseline', JSON.stringify(await runPhase(false)));
    process.env.FLIGHT_MCP_ENABLED = 'true';
    assert.equal((await fetchMcp()).status, 200);
    console.log('mixed', JSON.stringify(await runPhase(true)));
    process.env.FLIGHT_MCP_DAILY_LIMIT = '0';
    const exhausted = await fetchMcp();
    assert.equal(exhausted.status, 429);
    assert.equal(exhausted.result.error.data.reason, 'daily_quota');
    assert.equal((await site()).status, 200);
    console.log('quota: MCP 429 daily_quota; site search 200');
  } finally {
    await app?.close();
    try { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await db.end(); rmSync(dir, { recursive: true, force: true }); }
  }
}

run().catch(error => { console.error('Local load check failed:', error.name, error.code ?? error.message); process.exitCode = 1; });
