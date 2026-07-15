/* Static snapshot adapter for accuweather GitHub Pages dashboard. */
(function () {
  if (!window.SNAPSHOT_MODE) return;
  const nativeFetch = window.fetch.bind(window);
  const cache = new Map();

  function jsonResponse(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Snapshot-Mode': 'true' }
    });
  }
  async function loadJson(path, fallback) {
    if (cache.has(path)) return cache.get(path);
    try {
      const res = await nativeFetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      cache.set(path, data);
      return data;
    } catch (e) {
      console.warn('[snapshot] fallback for', path, e);
      cache.set(path, fallback);
      return fallback;
    }
  }
  function getPath(input) {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    try { return new URL(raw, window.location.origin).pathname; }
    catch (e) { return raw.split('?')[0]; }
  }
  function getUrl(input) {
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    return new URL(raw, window.location.origin);
  }
  function isApi(path) { return path.startsWith('/api/') || path === '/health'; }
  function limitRows(rows, url) {
    const limit = parseInt(url.searchParams.get('limit') || '0', 10);
    return limit > 0 ? rows.slice(0, limit) : rows;
  }
  function targetField(type) {
    if (type === 'hourly') return 'target_at';
    if (type === 'kma_hourly') return 'observed_at';
    if (type === 'kma_daily') return 'observed_date';
    return 'target_date';
  }
  function sameValue(rowValue, queryValue) {
    if (!queryValue) return true;
    if (rowValue === undefined || rowValue === null) return false;
    const a = String(rowValue);
    const b = String(queryValue);
    return a === b || a.startsWith(b) || b.startsWith(a.substring(0, 10));
  }
  async function handleData(type, url) {
    let rows = await loadJson(`snapshot/api/data/${type}.json`, []);
    const tf = targetField(type);
    const target = url.searchParams.get(tf);
    const collected = url.searchParams.get('collected_at');
    if (target) rows = rows.filter(r => sameValue(r[tf], target));
    if (collected) rows = rows.filter(r => sameValue(r.collected_at, collected));
    return limitRows(rows, url);
  }
  async function handlePreview(type, url) {
    const tf = targetField(type);
    const target = url.searchParams.get(tf) || url.searchParams.get('target_at') || url.searchParams.get('target_date');
    let rows = await loadJson(`snapshot/api/data/${type}.json`, []);
    if (target) rows = rows.filter(r => sameValue(r[tf], target));
    return rows.slice(0, 20);
  }
  async function route(input) {
    const path = getPath(input);
    const url = getUrl(input);
    if (path === '/health') return { status: 'ok', mode: 'static_snapshot' };
    if (path === '/api/summary') return loadJson('snapshot/api/summary.json', {});
    if (path === '/api/logs') return loadJson('snapshot/api/logs.json', []);
    if (path === '/api/crawl-timeline') return loadJson('snapshot/api/crawl-timeline.json', {});
    if (path === '/api/progress') return loadJson('snapshot/api/progress.json', []);
    if (path === '/api/system-health') return loadJson('snapshot/api/system-health.json', {});
    if (path === '/api/alerts') return loadJson('snapshot/api/alerts.json', []);
    if (path === '/api/system-logs') {
      let rows = await loadJson('snapshot/api/system-logs.json', []);
      const job = url.searchParams.get('job_name');
      const status = url.searchParams.get('status');
      if (job) rows = rows.filter(r => r.job_name === job);
      if (status) rows = rows.filter(r => r.status === status);
      return limitRows(rows, url);
    }
    if (path === '/api/realtime-logs/sources' || path === '/api/log-files') return loadJson('snapshot/api/realtime-logs/sources.json', []);
    if (path === '/api/realtime-logs/read' || path === '/api/log-content') return loadJson('snapshot/api/realtime-logs/read.json', { file: '', lines: [], total_lines: 0 });

    let m = path.match(/^\/api\/data\/([^/]+)$/);
    if (m) return handleData(m[1], url);
    m = path.match(/^\/api\/preview\/([^/]+)$/);
    if (m) return handlePreview(m[1], url);
    m = path.match(/^\/api\/date-range\/([^/]+)$/);
    if (m) return loadJson(`snapshot/api/date-range/${m[1]}.json`, {});
    if (path === '/api/temperature-trends') {
      const series = url.searchParams.get('series') || 'all';
      const range = url.searchParams.get('range') || (series === 'hourly' ? '7d' : series === 'daily' ? '1m' : series === 'monthly' ? '3m' : '1m');
      return loadJson(`snapshot/api/temperature-trends/${series}_${range}.json`, {});
    }
    return { error: 'Static snapshot endpoint is not available', path };
  }

  window.fetch = async function (input, init) {
    const method = (init && init.method) || (input && input.method) || 'GET';
    const path = getPath(input);
    if (method.toUpperCase() === 'GET' && isApi(path)) return jsonResponse(await route(input));
    return nativeFetch(input, init);
  };

  document.addEventListener('DOMContentLoaded', function () {
    const el = document.getElementById('autoRefreshBtn');
    if (el) el.title = '정적 스냅샷 페이지입니다. 새 스냅샷은 GitHub Pages 배포 후 반영됩니다.';
  });
})();
