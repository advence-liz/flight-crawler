// Build the frontend first. Uses the browser installed for the backend's Puppeteer.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const backend = createRequire(resolve(__dirname, '../../backend/package.json'));
const puppeteer = backend('puppeteer');

async function check() {
  const { preview } = await import('vite');
  const server = await preview({ root: resolve(__dirname, '..'), preview: { host: '127.0.0.1', port: 0 } });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    // Keep this UI test independent of a running crawler or model server.
    await page.setRequestInterception(true);
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/routes/ai-trip/status') {
        void request.respond({ status: 200, contentType: 'application/json', body: '{"chatEnabled":true}' });
      } else if (path.startsWith('/api/')) {
        void request.respond({ status: 503, contentType: 'application/json', body: '{}' });
      } else void request.continue();
    });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text) => { window.__copiedGuideExample = text; },
      } });
    });
    const click = async (selector, label) => {
      await page.waitForFunction((sel, text) => {
        const element = [...document.querySelectorAll(sel)].find(el => el.getClientRects().length && el.textContent.trim() === text);
        if (!element) return false;
        element.click();
        return true;
      }, { timeout: 5000 }, selector, label);
    };
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${origin}/#/destination`, { waitUntil: 'domcontentloaded' });
    const brand = 'header a[href="#/guide"]';
    await page.waitForSelector(`${brand} img`, { visible: true });
    await page.click(`${brand} img`);
    await page.waitForFunction(() => location.hash === '#/guide' && document.querySelector('h1')?.textContent === '使用指南');
    await click('a', '打开行程规划');
    await page.waitForFunction(() => location.hash === '#/route-planner');
    await click('[role="menuitem"]', '使用指南');
    await click('[role="tab"]', '接入自己的 AI');
    await page.waitForFunction(() => document.body.innerText.includes('如何获取 MCP Token'));
    const visibleExample = (text) => page.waitForFunction(value => [...document.querySelectorAll('pre')]
      .some(el => el.getClientRects().length && el.textContent.includes(value)), {}, text);
    const desktopChoices = '[role="radiogroup"][aria-label="桌面客户端"]';
    const chooseDesktop = label => click(`${desktopChoices} label`, label);
    await page.waitForSelector(`${desktopChoices} input:checked`, { visible: true });
    assert.deepEqual(await page.$$eval(`${desktopChoices} label`, labels => labels.map(el => el.innerText.trim())),
      ['WorkBuddy', 'DeepSeek Harness', 'Codex 桌面版', 'Claude 桌面版']);
    assert.equal(await page.$eval(`${desktopChoices} input:checked`, el => el.closest('label').innerText), 'WorkBuddy');
    await visibleExample('streamableHttp');
    await click('button', '复制 WorkBuddy 配置');
    await page.waitForFunction(() => typeof window.__copiedGuideExample === 'string');
    const workBuddy = JSON.parse(await page.evaluate(() => window.__copiedGuideExample));
    assert.deepEqual(workBuddy.mcpServers.suixinfei, {
      type: 'streamableHttp', url: 'https://flight-crawler.onrender.com/api/mcp', headers: { Authorization: 'Bearer YOUR_FLIGHT_MCP_TOKEN' },
    });
    await chooseDesktop('DeepSeek Harness');
    await visibleExample('transport: streamable-http');
    await click('button', '复制 Harness 配置');
    await page.waitForFunction(() => window.__copiedGuideExample?.includes('transport: streamable-http'));
    const harness = await page.evaluate(() => window.__copiedGuideExample);
    assert.match(harness, /url: https:\/\/flight-crawler\.onrender\.com\/api\/mcp/);
    assert.match(harness, /Authorization: 'Bearer \$\{credential:FLIGHT_MCP_TOKEN\}'/);
    assert.match(await page.locator('body').map(el => el.innerText).wait(), /未做桌面端实测/);
    assert.equal(await page.$eval('details', el => el.open), false, 'desktop options must not require expanding developer settings');
    await chooseDesktop('Codex 桌面版');
    await visibleExample('bearer_token_env_var');
    await click('button', '复制 Codex 配置');
    await page.waitForFunction(() => window.__copiedGuideExample?.includes('bearer_token_env_var'));
    const copied = await page.evaluate(() => window.__copiedGuideExample);
    assert.match(copied, /https:\/\/flight-crawler\.onrender\.com\/api\/mcp/);
    assert.doesNotMatch(copied, /127\.0\.0\.1|localhost/);
    assert.doesNotMatch(await page.locator('body').map(el => el.innerText).wait(), /本地启用步骤|FLIGHT_MCP_QUOTA_DATABASE_URL/);
    assert.match(copied, /bearer_token_env_var = "FLIGHT_MCP_TOKEN"/);
    await chooseDesktop('Claude 桌面版');
    await page.waitForFunction(() => document.body.innerText.includes('Add custom connector') && document.body.innerText.includes('Bearer YOUR_FLIGHT_MCP_TOKEN'));
    await click('button', '复制 MCP 地址');
    await page.waitForFunction(() => window.__copiedGuideExample === 'https://flight-crawler.onrender.com/api/mcp');
    assert.equal(await page.$eval('details', el => el.open), false);
    await click('summary', '开发者配置');
    await click('[role="tab"]', 'VS Code');
    await visibleExample('${input:flight-mcp-token}');
    await click('[role="tab"]', 'Cursor');
    await visibleExample('${env:FLIGHT_MCP_TOKEN}');
    await click('[role="tab"]', 'Claude Code');
    await visibleExample('${FLIGHT_MCP_TOKEN}');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('如何获取 MCP Token'));
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${origin}/#/destination`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(brand, { visible: true });
    await page.focus(brand);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#/guide');
    await page.waitForSelector('[aria-label="打开导航菜单"]', { visible: true });
    await page.click('[aria-label="打开导航菜单"]');
    await click('[role="menuitem"]', '使用指南');
    await click('[role="tab"]', '接入自己的 AI');
    await chooseDesktop('DeepSeek Harness');
    await visibleExample('transport: streamable-http');
    const choicesFit = await page.$$eval(`${desktopChoices} label`, labels => labels.length === 4 && labels.every(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth;
    }));
    assert.ok(choicesFit, 'all four desktop options must be visible without horizontal scrolling');
    await page.focus(`${desktopChoices} input:checked`);
    await page.keyboard.press('ArrowRight');
    await visibleExample('bearer_token_env_var');
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('pre[aria-label="Claude 桌面版 线上配置示例"]', { visible: true });
    assert.equal(await page.$eval(`${desktopChoices} input:checked`, el => el.closest('label').innerText), 'Claude 桌面版');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'desktop client guide must fit mobile');
    if (process.env.GUIDE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.GUIDE_SCREENSHOT_PATH, fullPage: true });
    await click('summary', '开发者配置');
    await click('[role="tab"]', 'Cursor');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    // With the same enabled status response, only the admin-mode browser gets the launcher.
    const launcher = 'button[class*="launcher"]';
    await page.evaluate(() => localStorage.setItem('admin_token', 'ui-test-only'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(launcher, { visible: true });
    await page.evaluate(() => localStorage.removeItem('admin_token'));
    const status = page.waitForResponse(response => new URL(response.url()).pathname === '/api/routes/ai-trip/status');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal((await status).status(), 200);
    assert.equal(await page.$(launcher), null, 'anonymous visitor must not see the Agent launcher');
    console.log('PASS: desktop and mobile navigation, MCP deep link, four peer desktop choices and copy actions, three developer examples, keyboard selection, no mobile overflow, anonymous Agent hidden');
  } finally {
    await browser?.close();
    server.httpServer.close();
    await once(server.httpServer, 'close');
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
