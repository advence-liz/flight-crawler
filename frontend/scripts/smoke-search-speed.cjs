// Build first. Uses delayed local API fixtures to detect accidental serial waits.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const puppeteer = createRequire(resolve(__dirname, '../../backend/package.json'))('puppeteer');

(async () => {
  const { preview } = await import('vite');
  const server = await preview({ root: resolve(__dirname, '..'), preview: { host: '127.0.0.1', port: 0 } });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    const calls = [];
    let failFull = false;
    let noRoute = false;
    let holdPlan = false;
    let holdMetadata = false;
    let heldPlan;
    const requests = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return void request.continue();
      calls.push({ path: url.pathname, params: url.searchParams, body: request.postData() });
      const json = (body, status = 200) => void request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
      switch (url.pathname) {
        case '/api/flights/cities':
          if (holdMetadata) { requests.push(request); return; }
          return json({ origins: ['上海'], destinations: ['北京'], cityList: ['上海', '北京'], minDate: '2026-12-01', maxDate: '2026-12-31' });
        case '/api/flights/destinations': {
          const full = url.searchParams.get('includeReturn') === 'true';
          if (full && failFull) return json({}, 503);
          return json({ destinations: [{ destination: full ? '广州' : '成都', availableDates: ['2026-12-01'],
            flightCount: 1, hasReturn: full, returnFlightCount: Number(full), cardTypes: [] }], totalCount: 1 });
        }
        case '/api/routes/discover-transfer':
          requests.push(request); // Slow enrichment must not block the direct results.
          return;
        case '/api/routes/date-window':
          return json({ outbound: { dates: ['2026-12-08'], first: '2026-12-08', last: '2026-12-08' }, return: { dates: [] }, hasReturn: false });
        case '/api/routes/plan': {
          if (holdPlan) { heldPlan = request; return; }
          const departureDate = JSON.parse(request.postData()).departureDate;
          return json({ routes: noRoute && departureDate === '2026-12-01' ? [] : [{
            segments: [{ origin: '上海', destination: '北京', flightNo: 'HU7701',
              departureTime: `${departureDate}T10:00:00Z`, arrivalTime: `${departureDate}T12:00:00Z`, duration: 120 }],
            totalDuration: 120, transferCount: 0, layovers: [], score: 95,
          }] });
        }
        default: return json({});
      }
    });
    const waitText = text => page.waitForFunction(t => document.body.innerText.includes(t), { timeout: 2500 }, text);
    const relevant = () => calls.filter(c => c.path === '/api/flights/destinations');
    await page.goto(`${origin}/#/destination?origin=上海&departureDate=2026-12-01&returnDate=2026-12-02`);
    await waitText('广州');
    const picks = () => relevant().map(c => c.params.get('includeReturn'));
    assert.deepEqual(picks(), ['true'], 'normal destination search should only make one foreground request');
    assert.ok(await page.$('.ant-table-row'), 'direct rows render while transfer information is pending');
    await page.evaluate(() => localStorage.clear());
    calls.length = 0;
    failFull = true;
    await page.reload();
    await waitText('成都');
    assert.deepEqual(picks(), ['true', 'false'], 'one-way results remain available if full lookup fails');
    for (const request of requests.splice(0)) if (!request.isInterceptResolutionHandled()) void request.abort().catch(() => {});
    calls.length = 0;
    holdMetadata = true;
    const deepLink = `${origin}/#/route-planner?origin=上海&destination=北京&departureDate=2026-12-01&departureDateEnd=2026-12-02&maxTransfers=0`;
    await page.goto(deepLink, { waitUntil: 'domcontentloaded' });
    await waitText('找到 1 个单程方案');
    const plans = () => calls.filter(c => c.path === '/api/routes/plan').map(c => JSON.parse(c.body).departureDate);
    assert.deepEqual(plans(), ['2026-12-01']);
    assert.ok(!calls.some(c => c.path === '/api/routes/date-window'), 'a successful explicit date search does not wait on alignment');
    calls.length = 0;
    holdPlan = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitText('HU7701');
    await waitText('的缓存数据');
    assert.deepEqual(plans(), ['2026-12-01'], 'a cached route is visible before the refresh finishes');
    await heldPlan.respond({ status: 503, contentType: 'application/json', body: '{}' });
    await waitText('最新数据暂时没取到，先显示上次的结果');
    await waitText('HU7701');
    await page.evaluate(() => localStorage.clear());
    holdPlan = false;
    calls.length = 0;
    noRoute = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitText('找到 1 个单程方案');
    assert.deepEqual(plans(), ['2026-12-01', '2026-12-08']);
    assert.equal(calls.filter(c => c.path === '/api/routes/date-window').length, 1);
    console.log('PASS: direct results do not wait for transfer; one-way fallback; explicit planner dates skip metadata; empty route aligns and retries once');
  } finally {
    await browser?.close();
    const closed = once(server.httpServer, 'close');
    server.httpServer.close();
    await closed;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
