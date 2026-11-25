// Usage: LANG=C node scripts/generate-default-preview.cjs <finished sqlite snapshot> <new output file>
process.env.TZ = 'UTC'; // SQLite stores UTC timestamps without an offset.
const { access, writeFile } = require('node:fs/promises');
const { constants } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { DataSource } = require('typeorm');
const { OPEN_READONLY, OPEN_URI } = require('sqlite3');
const { FlightService } = require('../dist/modules/flight/flight.service');
const { Flight } = require('../dist/modules/flight/entities/flight.entity');
const { Airport } = require('../dist/modules/flight/entities/airport.entity');
const { QueryCache } = require('../dist/modules/route/entities/query-cache.entity');

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('Expected a finalized SQLite snapshot and a new output path');
  const file = resolve(input);
  for (const sidecar of ['-wal', '-shm', '-journal']) {
    const exists = await access(file + sidecar, constants.F_OK).then(() => true, error => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    });
    if (exists) throw Error('SQLite snapshot has a sidecar; stop writers and checkpoint before generating');
  }
  const db = await new DataSource({ type: 'sqlite', database: `${pathToFileURL(file).href}?immutable=1`,
    flags: OPEN_READONLY | OPEN_URI, entities: [Flight, Airport, QueryCache] }).initialize();
  try {
    const service = new FlightService(db.getRepository(Flight), db.getRepository(Airport), db.getRepository(QueryCache));
    const { crawledAt, total } = await service.getDataFreshness();
    const age = Date.now() - Date.parse(crawledAt);
    if (!total || !(age >= 0 && age <= 86400_000)) throw Error('No fresh flight data to preview');
    const entries = [];
    const day = d => d.toISOString().slice(0, 10);
    const anchor = new Date(`${crawledAt.slice(0, 10)}T12:00:00Z`);
    for (let offset = 0; offset < 2; offset++) {
      const start = new Date(anchor);
      start.setUTCDate(start.getUTCDate() + offset);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const query = { origin: '北京', startDate: day(start), endDate: day(end), flightType: '2666权益卡航班', includeReturn: true };
      const result = await service.queryDestinations(query, { useCache: false });
      if (result.totalCount > 0) entries.push({ query, result });
    }
    if (entries.length === 0) throw Error('The default search has no results');
    const payload = JSON.stringify({ version: 1, crawledAt, entries });
    if (Buffer.byteLength(payload) > 128 * 1024) throw Error('Preview exceeds the HTML size budget');
    await writeFile(output, payload, { flag: 'wx' });
    console.log(`Default preview: ${entries.length} date windows; ${Buffer.byteLength(payload)} bytes; ${crawledAt}`);
  } finally { await db.destroy(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
