// Run after building frontend and backend. Uses disposable loopback PostgreSQL and Chrome.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const backend = createRequire(resolve(__dirname, '../../backend/package.json'));
const { Pool } = backend('pg');
const puppeteer = backend('puppeteer');

async function check() {
  const connection = new URL(process.env.TEST_TRIP_AI_DATABASE_URL);
  assert.ok(['127.0.0.1', '[::1]', 'localhost'].includes(connection.hostname), 'Use a loopback test database');
  const pool = new Pool({ connectionString: connection.href });
  const schema = `roster_browser_${randomBytes(6).toString('hex')}`;
  const admin = 'admin@example.test', member = 'member@example.test';
  const delivered = new Map();
  let app, previewServer, browser;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    connection.searchParams.set('options', `-c search_path=${schema}`);
    Object.assign(process.env, { NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: ':memory:', CRAWLER_ENABLED: 'false',
      FLIGHT_MCP_QUOTA_DATABASE_URL: connection.href, SITE_ADMIN_EMAIL: admin, SITE_AUTH_ENABLED: 'true',
      SITE_AUTH_SECRET: randomBytes(32).toString('hex'), SITE_AUTH_EMAIL_DAILY_LIMIT: '5', FLIGHT_MCP_ENABLED: 'true',
      FLIGHT_MCP_DAILY_LIMIT: '100', TRIP_AI_ENABLED: 'false' });
    const { NestFactory } = backend('@nestjs/core');
    const { AppModule } = backend('./dist/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    const { SiteAuthService } = backend('./dist/modules/route/site-auth.service');
    const { FlightMcpQuota } = backend('./dist/modules/route/flight-mcp-quota');
    const auth = app.get(SiteAuthService);
    app.use(auth.middleware);
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const api = await app.getUrl();
    const { preview } = await import('vite');
    previewServer = await preview({ root: resolve(__dirname, '..'), preview: { host: '127.0.0.1', port: 0, proxy: { '/api': api } } });
    const origin = `http://127.0.0.1:${previewServer.httpServer.address().port}`;
    process.env.SITE_AUTH_ORIGIN = origin;
    auth.initialize(async (email, code) => { delivered.set(email, code); });
    const store = app.get(FlightMcpQuota);
    await store.create('Fixture admin', admin);
    await store.create('Fixture member', member);
    browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    await page.setViewport({ width: 1280, height: 900 });
    const button = async (text) => {
      const click = (label) => {
        const normalize = (value) => value.replace(/\s+/g, '');
        const element = [...document.querySelectorAll('button')].find(e => e.offsetWidth && !e.disabled
          && normalize(e.textContent) === normalize(label));
        if (!element) return false;
        element.click();
        return true;
      };
      try { await page.waitForFunction(click, {}, text); }
      catch { throw new Error(`Expected button: ${text}`); }
    };
    const visible = (text) => page.waitForFunction(label => document.body.innerText.includes(label), {}, text);
    const post = (path, body) => page.evaluate(async (url, data) => (await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    })).status, path, body);
    const signIn = async email => {
      assert.equal(await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' }), 200);
      const otp = delivered.get(email);
      assert.ok(otp, 'A code should be delivered in the isolated test mailer');
      assert.equal(await post('/api/auth/sign-in/email-otp', { email, otp }), 200);
    };
    const roster = () => page.evaluate(async () => (await fetch('/api/admin/mcp-users')).status);
    await page.goto(`${origin}/#/user-management`, { waitUntil: 'networkidle0' });
    assert.equal(new URL(page.url()).hash, '#/account');
    assert.equal(await roster(), 401);
    await signIn(member);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.goto(`${origin}/#/user-management`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => location.hash === '#/destination');
    assert.equal(new URL(page.url()).hash, '#/destination');
    assert.equal(await roster(), 403);
    assert.equal(await post('/api/admin/mcp-users', { name: 'must not be created' }), 403);
    assert.equal(await post('/api/auth/sign-out', {}), 200);
    await signIn(admin);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.goto(`${origin}/#/user-management`, { waitUntil: 'networkidle0' });
    assert.equal(await roster(), 200);
    await button('新建用户');
    await page.type('input[placeholder="识别受邀者用的名称"]', '本地浏览器试用');
    await button('创建');
    await visible('本地浏览器试用');
    await button('发放 Token');
    const secret = 'textarea[aria-label="一次性显示的 MCP Token"]';
    await page.waitForSelector(secret, { visible: true });
    const token = await page.$eval(secret, el => el.value);
    assert.ok(/^sxf_[a-f0-9]{64}$/.test(token), 'Token is malformed');
    await button('完成');
    await page.waitForFunction(selector => !document.querySelector(selector), {}, secret);
    const call = () => fetch(`${api}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json',
      authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' }, body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_flights', arguments: {
        origin: '上海', destination: '北京', startDate: '2099-01-01', endDate: '2099-01-02',
      } },
    }) });
    const result = await call();
    assert.equal(result.status, 200);
    assert.equal((await result.json()).result.structuredContent.coverage, 'none');
    await page.reload({ waitUntil: 'networkidle0' });
    await visible('1 次');
    await page.setViewport({ width: 390, height: 844 });
    await page.waitForSelector('header button[aria-label="打开导航菜单"]', { visible: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.ROSTER_SCREENSHOT_PATH) await page.screenshot({ path: process.env.ROSTER_SCREENSHOT_PATH, fullPage: true });
    await button('撤销 Token');
    const revoked = page.waitForResponse(response => response.request().method() === 'DELETE' && /^\/api\/admin\/mcp-users\/[^/]+\/token$/.test(new URL(response.url()).pathname));
    await button('确认');
    assert.equal((await revoked).status(), 204);
    await visible('未发放 Token');
    await visible('1 次');
    assert.equal((await call()).status, 401);
    assert.equal(await post('/api/auth/sign-out', {}), 200);
    assert.equal(await roster(), 401);
    console.log('PASS: verified regular session blocked; verified admin creates user, issues and revokes an MCP key, and loses access at logout; mobile fits');
  } finally {
    await browser?.close();
    if (previewServer) {
      const closed = once(previewServer.httpServer, 'close');
      previewServer.httpServer.close();
      await closed;
    }
    await app?.close();
    try { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await pool.end(); }
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
