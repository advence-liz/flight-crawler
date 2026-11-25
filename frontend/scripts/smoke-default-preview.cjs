// Exercises the actual HTML build, initial paint, and React handoff before the API returns.
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { createRequire } = require('node:module');
const root = resolve(__dirname, '..');
const puppeteer = createRequire(resolve(root, '../backend/package.json'))('puppeteer');
const date = d => d.toISOString().slice(0, 10);
const city = name => ({ destination: name, flightCount: 3, availableDates: [date(new Date())], cardTypes: [], hasReturn: true, returnFlightCount: 2, returnAvailableDates: [] });
const today = new Date(), end = new Date(today);
end.setMonth(end.getMonth() + 1);
const query = { origin: '北京', startDate: date(today), endDate: date(end), flightType: '2666权益卡航班', includeReturn: true };
const result = (...cities) => ({ destinations: cities.map(city), totalCount: cities.length, dateRange: { start: query.startDate, end: query.endDate } });

(async () => {
  const temp = await mkdtemp(join(tmpdir(), 'flight-preview-smoke-'));
  const previewPath = join(temp, 'preview.json');
  process.env.FLIGHT_PREVIEW_FILE = previewPath;
  let browser;
  const servers = [];
  try {
    const { build, preview } = await import('vite');
    const builds = [];
    for (const [name, age] of [['fresh', 1000], ['expired', 25 * 3600_000]]) {
      await writeFile(previewPath, JSON.stringify({ version: 1, crawledAt: new Date(Date.now() - age).toISOString(), entries: [{ query, result: result('海口', '三亚') }] }));
      const outDir = join(temp, name);
      await build({ root, build: { outDir }, logLevel: 'error' });
      const serve = await preview({ root, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
      servers.push(serve.httpServer);
      builds.push(`http://127.0.0.1:${serve.httpServer.address().port}`);
    }
    browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
    for (const [name, base, path, width, expected, cookie] of [
      ['desktop', builds[0], '/', 1280, true],
      ['mobile', builds[0], '/#/destination', 390, true],
      ['expired', builds[1], '/', 1280, false],
      ['different origin', builds[0], '/', 1280, false, '上海'],
      ['different dates', builds[0], '/#/destination?origin=北京&departureDate=2026-12-01&returnDate=2026-12-02', 1280, false],
      ['different route', builds[0], '/#/guide', 1280, false],
    ]) {
      const context = await browser.createIncognitoBrowserContext();
      try {
        const page = await context.newPage();
        if (cookie) await page.setCookie({ url: base, name: 'flight_origin', value: encodeURIComponent(cookie) });
        await page.setViewport({ width, height: 900 });
        let heldEntry, heldQuery;
        const json = (req, body) => req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        await page.setRequestInterception(true);
        page.on('request', req => {
          const u = new URL(req.url());
          if (u.origin !== base) { void req.abort().catch(() => {}); return; }
          if (u.pathname.startsWith('/assets/index-') && u.pathname.endsWith('.js')) { heldEntry = req; return; }
          if (u.pathname === '/api/flights/destinations') { heldQuery = req; return; }
          if (u.pathname.startsWith('/api/')) { void json(req, {}); return; }
          void req.continue();
        });
        const loaded = page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(e => e);
        await page.waitForSelector('.boot-wrap', { timeout: 2500 });
        await page.waitForFunction(() => document.querySelector('script[type="module"][src]'));
        assert.equal(await page.evaluate(() => Boolean(document.querySelector('#boot-destinations:not([hidden]) li'))), expected, `${name}: default snapshot must only show on an exact match`);
        if (expected) {
          assert.ok(await page.evaluate(() => document.querySelector('#boot-destinations').textContent.includes('海口')));
          assert.ok(heldEntry, `${name}: main module is still held`);
        }
        await heldEntry?.continue();
        const navigationError = await loaded;
        if (navigationError instanceof Error) throw navigationError;
        if (!expected) continue;
        await page.waitForFunction(() => document.querySelector('form') && document.body.innerText.includes('海口') && !document.querySelector('#boot-destinations'));
        assert.ok(heldQuery, `${name}: the authoritative query must still run`);
        await json(heldQuery, result('成都'));
        await page.waitForFunction(() => document.body.innerText.includes('成都') && !document.body.innerText.includes('海口'));
      } finally { await context.close(); }
    }
    console.log('PASS: desktop/mobile early real rows, no empty handoff, authoritative replacement, and 4 fallback paths');
  } finally {
    await browser?.close();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await rm(temp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
