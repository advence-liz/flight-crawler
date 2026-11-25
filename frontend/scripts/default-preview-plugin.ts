import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';

const repo = 'advence-liz/flight-crawler';
const maxSize = 128 * 1024; // Only a few public destination result sets, not the database.
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

async function loadPublishedPreview() {
  // Pin the raw URL to the data commit; the mutable branch URL can lag after a crawl.
  const { stdout } = await promisify(execFile)('git', ['ls-remote', '--exit-code', `https://github.com/${repo}.git`, 'refs/heads/data'], { timeout: 5000 });
  const sha = stdout.match(/^([0-9a-f]{40})\trefs\/heads\/data\s*$/)?.[1];
  if (!sha) throw Error('Missing data revision');
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/default-destinations.v1.json`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok || Number(response.headers.get('content-length')) > maxSize) throw Error('Preview not available');
  return response.text();
}

export function defaultPreview(): Plugin {
  return {
    name: 'default-destination-preview',
    apply: 'build',
    async transformIndexHtml() {
      const file = process.env.FLIGHT_PREVIEW_FILE;
      if (!file && process.env.RENDER !== 'true') return;
      try {
        const raw = file ? await readFile(file, 'utf8') : await loadPublishedPreview();
        if (Buffer.byteLength(raw) > maxSize) return;
        const data = JSON.parse(raw);
        if (data?.version !== 1 || !Number.isFinite(Date.parse(data.crawledAt)) || !Array.isArray(data.entries) || data.entries.length > 2) return;
        const entries = data.entries.filter(({ query, result }) =>
          query?.origin === '北京' && query?.flightType === '2666权益卡航班' && query?.includeReturn === true &&
          isoDay.test(query?.startDate) && isoDay.test(query?.endDate) &&
          result?.dateRange?.start === query.startDate && result?.dateRange?.end === query.endDate &&
          Array.isArray(result?.destinations) && result.destinations.length > 0 && result.totalCount === result.destinations.length &&
          result.destinations.every(row => typeof row?.destination === 'string' && Number.isInteger(row?.flightCount) &&
            typeof row.hasReturn === 'boolean' && Array.isArray(row.availableDates) && Array.isArray(row.cardTypes)));
        if (entries.length === 0) return;
        const json = JSON.stringify({ crawledAt: data.crawledAt, entries }).replace(/</g, '\\u003c');
        const boot = await readFile(new URL('./default-preview-boot.js', import.meta.url), 'utf8');
        return [
          { tag: 'script', attrs: { id: 'flight-preview-data', type: 'application/json' }, children: json, injectTo: 'body' },
          { tag: 'script', children: boot, injectTo: 'body' },
        ];
      } catch {
        // Missing, invalid, or unreachable preview never blocks a frontend release.
        console.warn('[default-preview] no usable snapshot; building the live-search fallback');
      }
    },
  };
}
