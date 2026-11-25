// Runs during HTML parsing, before the app bundle. The full rows are handed to React.
(() => {
  if (location.search || !['', '#/', '#/destination'].includes(location.hash)) return;
  try {
    const origin = document.cookie.split('; ').find(row => row.startsWith('flight_origin='));
    if (origin && !['', '北京', '北京首都', '北京大兴'].includes(decodeURIComponent(origin.slice('flight_origin='.length)))) return;
    const data = JSON.parse(document.getElementById('flight-preview-data').textContent);
    const age = Date.now() - Date.parse(data.crawledAt);
    if (!(age >= 0 && age <= 24 * 60 * 60 * 1000)) return;
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    const date = value => value.toISOString().slice(0, 10);
    const hit = data.entries.find(({ query }) => query.startDate === date(start) && query.endDate === date(end));
    const panel = document.getElementById('boot-destinations');
    if (!hit || !panel) return;
    const title = document.createElement('h2');
    title.textContent = `北京出发 · ${hit.result.totalCount} 个直飞目的地`;
    const description = document.createElement('p');
    description.textContent = `${hit.query.startDate} 至 ${hit.query.endDate} · 航班快照 ${new Date(data.crawledAt).toLocaleString('zh-CN')}（非实时余票）`;
    const rows = document.createElement('ul');
    for (const item of hit.result.destinations.slice(0, 6)) {
      const row = document.createElement('li');
      row.textContent = `${item.destination} · ${item.flightCount} 班去程${item.hasReturn ? ' · 可往返' : ''}`;
      rows.append(row);
    }
    panel.append(title, description, rows);
    window.__flightLandingPreview = { ...hit, crawledAt: data.crawledAt };
    panel.hidden = false;
  } catch { /* Fall back to the ordinary search. */ }
})();
