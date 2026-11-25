const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const net = require('node:net');
const { performance } = require('node:perf_hooks');

const frozenDate = '2026-11-25';
const protocol = 'v1';
const casesPath = path.join(__dirname, 'trip-agent.cases.json');
const backend = path.resolve(__dirname, '..');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const percentile = (xs, p) => xs.length ? [...xs].sort((a,b) => a-b)[Math.ceil(p*xs.length)-1] : null;
const passed = row => row.samples.filter(sample => sample.pass).length;

function compareReports(base, candidate) {
  for (const key of ['protocol', 'suiteHash', 'snapshotHash', 'frozenDate', 'repeats']) {
    assert.equal(candidate[key], base[key], `不可比较：${key} 不同`);
  }
  assert.deepEqual(candidate.cases.map(c=>c.id), base.cases.map(c=>c.id), '不可比较：题集不一致');
  assert.ok([...base.cases,...candidate.cases].every(c => c.samples.length === base.repeats), '样本数量不一致');
  const improved = [], regressed = [], unchanged = [];
  const rows = candidate.cases.map((next, i) => {
    const prior = base.cases[i];
    const delta = passed(next) - passed(prior);
    (delta > 0 ? improved : delta < 0 ? regressed : unchanged).push(next.id);
    return { id: next.id, baseline: passed(prior), candidate: passed(next), samples: next.samples.length };
  });
  const verdict = regressed.length ? (improved.length ? 'mixed' : 'regression') : improved.length ? 'improvement' : 'no_detected_change';
  const p95 = report => percentile(report.cases.flatMap(c=>c.samples).map(s=>s.latencyMs), .95);
  return { verdict, improved, regressed, unchanged, rows, p95Ms: { baseline: p95(base), candidate: p95(candidate) } };
}

function boot() {
  // Only the isolated eval child uses a frozen application clock, never production.
  const intent = require('../dist/modules/route/ai-trip-intent');
  intent.beijingNow = () => `${frozenDate}T12:00:00.000Z`;
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (_port, ...args) {
    this.once('listening', () => process.send({ port: this.address().port }));
    return listen.call(this, { host: '127.0.0.1', port: 0 }, ...args);
  };
  process.once('disconnect', () => process.exit(0));
  require('../dist/main');
}

function sql(db, query, params = []) {
  return new Promise((resolve, reject) => db.get(query, params, (error, row) => error ? reject(error) : resolve(row)));
}

async function grade(db, expected, reply) {
  assert.ok(reply.text?.trim(), 'empty-answer');
  if (expected.clarify) {
    assert.match(reply.text, new RegExp(expected.clarify), 'did-not-clarify');
    assert.ok(!reply.results && !reply.criteria, 'searched-despite-missing-or-unsupported-constraint');
    return;
  }
  for (const [key,value] of Object.entries(expected.criteria)) assert.deepEqual(reply.criteria?.[key], value, `criteria.${key}`);
  assert.equal(reply.results?.coverage, expected.coverage, 'coverage');
  const results = reply.results.destinations;
  assert.ok(results.length >= (expected.minResults ?? 0) && results.length <= (expected.maxResults ?? 3), 'result-count');
  assert.equal(new Set(results.map(result=>result.city)).size, results.length, 'duplicate-city');
  const c = reply.criteria;
  for (const result of results) {
    assert.ok(!c.destination || result.city === c.destination || c.destination === result.bestOutbound.segments.at(-1).destination, 'wrong-destination');
    assert.ok(!c.excludeDestinations?.includes(result.city), 'excluded-destination');
    assert.ok(c.maxLeaveDays == null || result.leaveDays <= c.maxLeaveDays, 'leave-limit');
    const out = result.bestOutbound.segments, back = result.bestReturn.segments;
    const start = out[0].departureTime, end = back.at(-1).arrivalTime;
    assert.ok(out.length <= c.maxTransfers+1 && back.length <= c.maxTransfers+1, 'transfer-limit');
    assert.ok(start.slice(0,10) >= c.startDate && end.slice(0,10) <= c.endDate, 'dates');
    assert.ok(!c.departAfter || start.slice(11,16) >= c.departAfter, 'departure-time');
    assert.ok(!c.arriveBefore || end.slice(11,16) <= c.arriveBefore, 'arrival-time');
    assert.ok(c.departureWeekday == null || new Date(start).getUTCDay() === c.departureWeekday, 'departure-weekday');
    assert.ok(c.arrivalWeekday == null || new Date(end).getUTCDay() === c.arrivalWeekday, 'arrival-weekday');
    const stay = (Date.parse(back[0].departureTime)-Date.parse(out.at(-1).arrivalTime))/60000;
    assert.equal(result.stayMinutes, Math.round(stay), 'stay-calculation');
    assert.ok(stay >= (c.minStayHours ?? 0)*60, 'minimum-stay');
    for (const leg of [...out,...back]) {
      const card = c.card === '666' ? ' AND has666Card=1' : c.card === '2666' ? ' AND has2666Card=1' : '';
      const toSql = time => time.replace('T',' ').replace(/Z$/,'');
      const row = await sql(db, `SELECT id FROM flights WHERE flightNo=? AND origin=? AND destination=? AND departureTime=? AND arrivalTime=?${card}`,
        [leg.flightNo,leg.origin,leg.destination,toSql(leg.departureTime),toSql(leg.arrivalTime)]);
      assert.ok(row, 'flight-not-in-snapshot-or-card-mismatch');
    }
  }
}

async function record(snapshot, output, repeats) {
  assert.ok(process.env.DEEPSEEK_API_KEY, 'Set DEEPSEEK_API_KEY in the shell; never include it in the command or report.');
  assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10, 'repeats must be 1–10');
  const { Database, OPEN_READONLY } = require('sqlite3');
  const original = path.resolve(snapshot);
  const cases = readJSON(casesPath);
  const report = { protocol, suiteHash: hash(casesPath), snapshotHash: hash(original), frozenDate, repeats,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    provider: !process.env.DEEPSEEK_BASE_URL || new URL(process.env.DEEPSEEK_BASE_URL).hostname === 'api.deepseek.com'
      ? 'deepseek-official' : 'compatible-gateway',
    recordedAt: new Date().toISOString(), cases: cases.map(({id}) => ({id,samples:[]})) };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'trip-agent-eval-'));
  const copy = path.join(dir,'flight.db');
  const token = randomUUID();
  const db = new Database(original, OPEN_READONLY);
  let child;
  try {
    fs.copyFileSync(original, copy);
    child = fork(__filename, ['__boot'], { cwd: backend, stdio: ['ignore','ignore','inherit','ipc'],
      env: { ...process.env, PORT:'0', TZ:'UTC', NODE_ENV:'test', DB_DATABASE:copy, ADMIN_TOKEN:token,
        TRIP_AI_ENABLED:'true', CRAWLER_ENABLED:'false', CRAWLER_AUTO_CRAWL:'false' } });
    const [{ port }] = await Promise.race([
      once(child,'message',{signal:AbortSignal.timeout(20_000)}),
      once(child,'exit').then(([code])=>{throw Error(`Eval backend exited: ${code}`);}),
    ]);
    for (let round=0; round<repeats; round++) {
      for (const [i,item] of cases.entries()) {
        const started = performance.now();
        let previous, turnIndex=0, failure;
        const messages = [];
        try {
          for (const turn of item.turns) {
            turnIndex++;
            messages.push({role:'user',content:turn.prompt});
            const response = await fetch(`http://127.0.0.1:${port}/api/routes/ai-trip/chat`, {
              method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${token}` },
              body:JSON.stringify({messages,previous}), signal:AbortSignal.timeout(55_000),
            });
            assert.equal(response.status,200,`http-${response.status}`);
            const reply = await response.json();
            await grade(db,turn,reply);
            messages.push({role:'assistant',content:reply.text});
            previous = reply.criteria ?? previous;
          }
        } catch (error) {
          failure = { turn:turnIndex, reason:error.message.split('\n')[0].slice(0,160) };
        }
        const sample = { pass: !failure, latencyMs: Math.round(performance.now()-started), ...(failure && { failure }) };
        report.cases[i].samples.push(sample);
        console.log(`${sample.pass?'PASS':'FAIL'} ${item.id} #${round+1} ${sample.latencyMs}ms${failure ? ` ${failure.reason}` : ''}`);
      }
    }
    fs.writeFileSync(output, JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    return report.cases.every(row => passed(row) === repeats);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await once(child,'exit'); }
    await new Promise(resolve=>db.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
}

module.exports = { compareReports };
if (require.main === module) {
  const [mode,a,b,c] = process.argv.slice(2);
  if (mode === '__boot') boot();
  else if (mode === 'record' && a && b) record(a,b,Number(c ?? 2)).then(ok=>{if(!ok)process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});
  else if (mode === 'compare' && a && b) {
    try {
      const result = compareReports(readJSON(a),readJSON(b));
      console.log(JSON.stringify(result,null,2));
      if (result.regressed.length) process.exitCode=1;
    } catch (error) { console.error(error.message);process.exitCode=1; }
  } else {
    console.log('Usage: node eval/trip-agent.js record <snapshot.db> <output.json> [repeats=2]\n       node eval/trip-agent.js compare <baseline.json> <candidate.json>');
  }
}
