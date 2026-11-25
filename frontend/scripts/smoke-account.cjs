// Build first. Uses a synthetic account to exercise session states without real credentials.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const backend = createRequire(resolve(__dirname, '../../backend/package.json'));
const puppeteer = backend('puppeteer');

(async () => {
  const { preview } = await import('vite');
  const server = await preview({ root: resolve(__dirname, '..'), preview: { host: '127.0.0.1', port: 0 } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  let browser;
  let session = 'member';
  let accountChecks = 0;
  let hasToken = false;
  const token = `sxf_${randomBytes(32).toString('hex')}`;
  try {
    browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copy = text; } } });
    });
    await page.setRequestInterception(true);
    page.on('request', req => {
      const path = new URL(req.url()).pathname;
      if (!path.startsWith('/api/')) { void req.continue(); return; }
      const json = (status, body) => void req.respond({ status, contentType: 'application/json', body: body && JSON.stringify(body) });
      if (path === '/api/account/status') return json(200, { github: true, google: false, email: false });
      if (path === '/api/routes/ai-trip/status') return json(200, { chatEnabled: true });
      if (path === '/api/account') {
        accountChecks++;
        const mode = session;
        const respond = () => mode === 'member' ? json(200, { name: '飞行测试员', email: 'pilot@example.test', hasToken, mcpEnabled: true })
          : json(mode === 'unavailable' ? 503 : mode === 'blocked' ? 403 : 401, {});
        if (accountChecks === 1) return setTimeout(respond, 450);
        return respond();
      }
      if (path === '/api/account/mcp/token' && req.method() === 'POST') { hasToken = true; return json(201, { token }); }
      if (path === '/api/account/mcp/token' && req.method() === 'DELETE') { hasToken = false; return json(204); }
      if (path === '/api/auth/sign-out') { session = 'guest'; return json(200, { success: true }); }
      return json(503, {});
    });
    const visible = text => page.waitForFunction(label => document.body.innerText.includes(label), {}, text);
    const button = async text => page.waitForFunction(label => {
      const match = [...document.querySelectorAll('button')].find(el => el.offsetWidth && !el.disabled
        && el.textContent.trim().replace(/\s+/g, '') === label.replace(/\s+/g, ''));
      if (!match) return false;
      match.click(); return true;
    }, {}, text);
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const accountLink = 'header a[href="#/account"]';
    const signupHelp = 'details:has(a[href="https://github.com/signup"])';
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${origin}/#/guide`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('已登录'), {}, accountLink);
    await page.click(accountLink);
    await visible('pilot@example.test');
    await visible('未生成 Token');
    assert.equal(await page.$(signupHelp), null, 'members do not need GitHub sign-up help');
    assert.equal(accountChecks, 1, 'header and account must share one session lookup');
    await button('复制地址');
    await page.waitForFunction(() => window.__copy === 'https://flight-crawler.onrender.com/api/mcp');
    assert.equal(await noOverflow(), true);
    if (process.env.ACCOUNT_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.ACCOUNT_SCREENSHOT_DIR, 'account-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await page.waitForSelector('[aria-label="打开导航菜单"]', { visible: true });
    await page.waitForSelector(`${accountLink}[aria-label*="已登录"]`, { visible: true });
    assert.equal(await noOverflow(), true, 'mobile account page must fit the viewport');
    if (process.env.ACCOUNT_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.ACCOUNT_SCREENSHOT_DIR, 'account-mobile.png'), fullPage: true });
    await button('生成 Token');
    await visible('仅显示这一次');
    await button('复制 Token');
    assert.equal(await page.evaluate(value => window.__copy === value, token), true);
    await button('完成');
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="MCP Token"]'));
    await visible('已生成 Token');
    await button('撤销 Token');
    await button('确认撤销');
    await visible('未生成 Token');
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    await button('退出登录');
    await visible('使用 GitHub 登录');
    assert.ok(await page.$(signupHelp), 'GitHub sign-up help should link to the official page');
    assert.equal(await page.$eval(signupHelp, el => el.open), false, 'sign-up help is collapsed by default');
    assert.equal(await page.$eval(`${signupHelp} summary`, el => el.textContent), '没有 GitHub 账号？');
    await page.focus(`${signupHelp} summary`);
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${signupHelp}[open] a[href="https://github.com/signup"]`, { visible: true });
    for (const text of ['免费注册', '不需要 Gmail', '验证邮箱', '不必安装软件或创建仓库', '确认授权', '垃圾邮件', '页面打不开', '只在 GitHub', '手动规划行程']) {
      assert.ok(await page.$eval(signupHelp, (el, text) => el.innerText.includes(text), text), `sign-up help is missing: ${text}`);
    }
    assert.equal(await noOverflow(), true, 'expanded help must fit the mobile viewport');
    if (process.env.ACCOUNT_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.ACCOUNT_SCREENSHOT_DIR, 'account-github-help.png'), fullPage: true });
    await page.click(`${signupHelp} summary`);
    await page.waitForSelector(`${signupHelp}:not([open])`);
    await page.waitForFunction(() => [...document.querySelectorAll('a[href="#/destination"]')]
      .some(el => el.innerText === '先不登录，去查航班' && el.getClientRects().length > 0));
    await page.waitForFunction(selector => document.querySelector(selector)?.textContent.trim() === '登录', {}, accountLink);
    assert.equal(await page.$('button[class*="launcher"]'), null);
    session = 'unavailable';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await visible('暂时无法确认登录状态');
    assert.ok(!await page.evaluate(() => document.body.innerText.includes('使用 GitHub 登录')));
    session = 'member';
    await button('重试');
    await visible('pilot@example.test');
    console.log('PASS: desktop and mobile session display; MCP address and token, revoke, logout, retry; collapsed GitHub help, keyboard and pointer controls, official link and guest browse');
  } finally {
    await browser?.close();
    const closed = once(server.httpServer, 'close');
    server.httpServer.close();
    await closed;
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
