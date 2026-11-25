// Local auth smoke: actual Nest/Better Auth/PostgreSQL with a mail capture and a stub Agent.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { NestFactory } = require('@nestjs/core');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

async function run() {
  const url = new URL(process.env.TEST_TRIP_AI_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const root = new Pool({ connectionString: url.href });
  const schema = `login_smoke_${randomBytes(8).toString('hex')}`;
  let origin = 'http://127.0.0.1:8899';
  const chrome = process.env.PUPPETEER_EXECUTABLE_PATH;
  const admin = randomBytes(32).toString('hex');
  let app, ui, browser;
  try {
    await root.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    Object.assign(process.env, { NODE_ENV: 'test', CRAWLER_ENABLED: 'false', DB_DATABASE: ':memory:',
      SITE_AUTH_ENABLED: 'true', SITE_AUTH_ORIGIN: origin, SITE_AUTH_SECRET: randomBytes(32).toString('hex'),
      SITE_AUTH_GITHUB_CLIENT_ID: 'stub-github', SITE_AUTH_GITHUB_CLIENT_SECRET: 'test-only',
      SITE_AUTH_GOOGLE_CLIENT_ID: 'stub-google', SITE_AUTH_GOOGLE_CLIENT_SECRET: 'test-only',
      SITE_AUTH_EMAIL_DAILY_LIMIT: '1', FLIGHT_MCP_QUOTA_DATABASE_URL: url.href, ADMIN_TOKEN: admin,
      FLIGHT_MCP_ENABLED: 'true', TRIP_AI_ENABLED: 'false' });
    const { AppModule } = require('../dist/app.module');
    const { SiteAuthService } = require('../dist/modules/route/site-auth.service');
    const { TripAgentService } = require('../dist/modules/route/trip-agent.service');
    const { DeepSeekTripModel } = require('../dist/modules/route/deepseek-trip-model');
    const { FlightMcpQuota } = require('../dist/modules/route/flight-mcp-quota');
    app = await NestFactory.create(AppModule, { logger: false });
    const auth = app.get(SiteAuthService);
    let deliveries = 0, code, agentCalls = 0;
    app.use(auth.middleware);
    app.get(DeepSeekTripModel).enabled = () => true;
    app.get(TripAgentService).chat = async () => { agentCalls++; return { text: '行程助手测试' }; };
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    if (chrome) {
      const frontend = resolve(__dirname, '../../frontend');
      const { preview } = await import(pathToFileURL(resolve(frontend, 'node_modules/vite/dist/node/index.js')).href);
      ui = await preview({ mode: 'production', root: frontend, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': base } } });
      origin = `http://127.0.0.1:${ui.httpServer.address().port}`;
      process.env.SITE_AUTH_ORIGIN = origin;
    }
    auth.initialize(async (_email, otp) => { deliveries++; code = otp; });
    const req = (path, body, headers = {}, method = body === undefined ? 'GET' : 'POST') => fetch(`${base}/api${path}`, {
      method, headers: { origin, ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
    });
    const send = (email) => req('/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
    const member = 'member@example.test';
    const invited = (name, email) => req('/admin/mcp-users', { name, email }, { authorization: `Bearer ${admin}` });
    const signin = otp => req('/auth/sign-in/email-otp', { email: member, otp });
    assert.equal((await req('/routes/ai-trip/chat', {})).status, 401);
    assert.equal((await req('/account/mcp/token', {})).status, 401);
    assert.equal((await send(member)).status, 200);
    assert.equal(deliveries, 0);
    assert.equal((await invited('受邀账号', member)).status, 201);
    const sent = await send(member);
    assert.equal(sent.status, 200, await sent.text());
    assert.equal(deliveries, 1);
    assert.ok(/^\d{6}$/.test(code));
    assert.equal((await send(member)).status, 429, 'resend is throttled without invalidating the first code');
    assert.equal(deliveries, 1);
    const invalid = code === '000000' ? '000001' : '000000';
    assert.equal((await signin(invalid)).ok, false);
    const entered = await signin(code);
    assert.equal(entered.status, 200, `login HTTP ${entered.status}`);
    assert.deepEqual(await entered.json(), { ok: true });
    const rawCookie = entered.headers.getSetCookie().find(value => value.includes('flight-site.session_token='));
    assert.ok(rawCookie?.includes('HttpOnly'));
    const cookie = rawCookie.split(';')[0];
    const session = { cookie };
    assert.equal((await (await req('/account', undefined, session)).json()).email, member);
    assert.equal((await signin(code)).ok, false);
    assert.equal((await req('/admin/mcp-users', undefined, session)).status, 401);
    assert.equal((await req('/account/mcp/token', {}, { ...session, origin: 'https://untrusted.example' })).status, 403);
    const issued = await req('/account/mcp/token', {}, session);
    assert.equal(issued.status, 201);
    const { token } = await issued.json();
    assert.ok(/^sxf_[0-9a-f]{64}$/.test(token));
    const discover = () => fetch(`${base}/api/mcp`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream',
    }, body: JSON.stringify({ jsonrpc:'2.0', method:'tools/list', id: 1 }) });
    assert.equal((await discover()).status, 200);
    for (let i = 0; i < 10; i++) assert.equal((await req('/routes/ai-trip/chat', {}, session)).status, 200);
    assert.equal((await req('/routes/ai-trip/chat', {}, session)).status, 429);
    assert.equal(agentCalls, 10);
    assert.equal((await req('/account/mcp/token', undefined, session, 'DELETE')).status, 204);
    assert.equal((await discover()).status, 401);
    assert.equal((await invited('次要账号', 'another@example.test')).status, 201);
    assert.equal((await send('another@example.test')).status, 429);
    assert.equal(deliveries, 1);
    for (const [provider, target] of [['github','https://github.com'], ['google','https://accounts.google.com']]) {
      const started = await req('/auth/sign-in/social', { provider, callbackURL: `${origin}/#/account` });
      assert.equal(started.status, 200);
      const authorization = new URL((await started.json()).url);
      assert.equal(authorization.origin, target);
      assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/api/auth/callback/${provider}`);
      assert.ok(authorization.searchParams.get('state'));
    }
    const serviceFetch = globalThis.fetch;
    const githubStart = () => req('/auth/sign-in/social', { provider: 'github', callbackURL: `${origin}/#/account` });
    const github = async (verified) => {
      const start = await githubStart();
      const authorization = new URL((await start.json()).url);
      const state = authorization.searchParams.get('state');
      const stateCookie = start.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const githubEmail = verified ? 'oauth@example.test' : 'unverified@example.test';
      globalThis.fetch = (input, init) => {
        const path = typeof input === 'string' ? input : input.url ?? input.href;
        if (path === 'https://github.com/login/oauth/access_token') {
          return Promise.resolve(Response.json({ access_token: 'test-only', token_type: 'bearer', scope: 'read:user,user:email' }));
        }
        if (path === 'https://api.github.com/user') return Promise.resolve(Response.json({ id: verified ? 200 : 201, name: 'OAuth Test', email: githubEmail }));
        if (path === 'https://api.github.com/user/emails') return Promise.resolve(Response.json([{ email: githubEmail, primary: true, verified }]));
        if (!path.startsWith(base + '/')) throw new Error('Test does not contact external hosts');
        return serviceFetch(input, init);
      };
      try {
        const callback = await req(`/auth/callback/github?code=local-test&state=${encodeURIComponent(state)}`, undefined, { cookie: stateCookie });
        assert.equal(callback.status, 302);
        const cookie = callback.headers.getSetCookie().find(value => value.includes('flight-site.session_token='));
        if (!verified) { assert.equal(cookie, undefined); return; }
        assert.ok(cookie, 'GitHub verified sign-up issues a session');
        assert.equal((await (await req('/account', undefined, { cookie: cookie.split(';')[0] })).json()).email, githubEmail);
        assert.equal(await app.get(FlightMcpQuota).isEmailInvited(githubEmail), false);
        assert.equal(deliveries, 1, 'OAuth registration does not grant an email-code invitation');
        return cookie.split(';')[0];
      } finally { globalThis.fetch = serviceFetch; }
    };
    const oauthCookie = await github(true);
    await github(false);
    if (ui) {
      const puppeteer = require('puppeteer');
      browser = await puppeteer.launch({ headless: 'new', executablePath: chrome });
      const page = await browser.newPage();
      page.setDefaultTimeout(8000);
      await page.setViewport({ width: 390, height: 850 });
      await page.goto(`${origin}/#/account`, { waitUntil: 'networkidle0' });
      const heading = text => page.waitForFunction(value => document.querySelector('h1')?.textContent === value, {}, text);
      await heading('登录随心飞');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const [name, value] = oauthCookie.split(/=(.*)/s);
      await page.setCookie({ name, value, url: origin, httpOnly: true });
      await page.reload({ waitUntil: 'networkidle0' });
      await heading('我的账号');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.waitForSelector('button[class*="launcher"]', { visible: true });
      await page.click('button[class*="launcher"]');
      await page.waitForSelector('button[class*="starters"] , [class*="starters"] button', { visible: true });
      await page.click('[class*="starters"] button');
      await page.waitForFunction(() => document.body.innerText.includes('行程助手测试'));
      console.log('PASS: mobile account page uses a real HttpOnly session and opens the Agent for a regular user');
    }
    assert.equal((await req('/auth/sign-out', {}, session)).status, 200);
    assert.equal((await req('/account', undefined, session)).status, 401);
    console.log('PASS: invite-only OTP + durable mail cap, HttpOnly session, OAuth redirects, member/admin isolation, MCP issue/revoke, Agent quota');
  } finally {
    await browser?.close();
    if (ui) await new Promise((res) => ui.httpServer.close(res));
    await app?.close();
    try { await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await root.end(); }
  }
}
run().catch(e => { console.error(e.name, e.message); process.exitCode = 1; });
