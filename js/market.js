// Live prices from the Albion Online Data Project (albion-online-data.com).
// Prices come from players running the data client, so some are minutes old and some hours.

import { SELL_MARKETS } from './calc.js';

export const SERVERS = {
  europe: { name: 'Europe', host: 'https://europe.albion-online-data.com' },
  americas: { name: 'Americas', host: 'https://west.albion-online-data.com' },
  asia: { name: 'Asia', host: 'https://east.albion-online-data.com' }
};
const LOCATIONS = SELL_MARKETS; // all cities plus the Black Market, fetched together
const MAX_URL = 3900;           // the API rejects URLs over 4096 characters
const PARALLEL = 2;             // the API allows 180 requests a minute
const REUSE_MIN = 30;           // prices younger than this are not fetched again unless asked
const HIST_DAYS = 7;

const parseDate = v => {
  if (!v || v.startsWith('0001')) return 0;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z');
  return Number.isFinite(t) ? t : 0;
};
const mdy = d => `${d.getUTCMonth() + 1}-${d.getUTCDate()}-${d.getUTCFullYear()}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function locationQuery() { return LOCATIONS.map(encodeURIComponent).join(','); }

// Split ids so each request URL stays under the API's length limit.
export function chunk(ids, fixedLen) {
  const out = [];
  let cur = [], len = fixedLen;
  for (const id of ids) {
    if (cur.length && len + id.length + 1 > MAX_URL) { out.push(cur); cur = []; len = fixedLen; }
    cur.push(id); len += id.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

// One request per chunk of ids: [{ url, ids }]
export function priceRequests(server, ids) {
  const base = `${SERVERS[server].host}/api/v2/stats/prices/`;
  const q = `.json?locations=${locationQuery()}&qualities=1`;
  return chunk(ids, base.length + q.length).map(c => ({ url: base + c.join(',') + q, ids: c }));
}

export function historyRequests(server, ids, now = new Date()) {
  const from = new Date(now.getTime() - (HIST_DAYS + 1) * 864e5);
  const base = `${SERVERS[server].host}/api/v2/stats/history/`;
  const q = `.json?locations=${locationQuery()}&qualities=1&time-scale=24&date=${mdy(from)}&end_date=${mdy(now)}`;
  return chunk(ids, base.length + q.length).map(c => ({ url: base + c.join(',') + q, ids: c }));
}

// Rows from /prices -> { id: { city: { s, sd, b, bd } } }
export function parsePrices(rows, into = {}) {
  for (const r of rows || []) {
    if (!r || !r.item_id || !r.city || (r.quality && r.quality !== 1)) continue;
    const id = r.item_id, city = normCity(r.city);
    const s = +r.sell_price_min || 0, b = +r.buy_price_max || 0;
    (into[id] || (into[id] = {}))[city] = { s, sd: s ? parseDate(r.sell_price_min_date) : 0, b, bd: b ? parseDate(r.buy_price_max_date) : 0 };
  }
  return into;
}

// Rows from /history -> { id: { city: { avg, n } } }: average sale price and sold per day, last 7 days.
export function parseHistory(rows, into = {}, now = Date.now()) {
  const since = now - HIST_DAYS * 864e5 - 12 * 3600e3;
  for (const r of rows || []) {
    if (!r || !r.item_id || !Array.isArray(r.data) || (r.quality && r.quality !== 1)) continue;
    const city = normCity(r.location || r.city || '');
    let count = 0, silver = 0;
    for (const p of r.data) {
      if (parseDate(p.timestamp) < since) continue;
      count += +p.item_count || 0;
      silver += (+p.avg_price || 0) * (+p.item_count || 0);
    }
    (into[r.item_id] || (into[r.item_id] = {}))[city] = { avg: count ? Math.round(silver / count) : 0, n: count / HIST_DAYS };
  }
  return into;
}

function normCity(c) {
  const k = String(c).trim();
  const hit = LOCATIONS.find(x => x.toLowerCase() === k.toLowerCase());
  if (hit) return hit;
  if (/black ?market/i.test(k)) return 'Black Market';
  if (/^fort ?sterling$/i.test(k)) return 'Fort Sterling';
  return k;
}

async function getJson(url, signal) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    } catch (e) {
      if (signal && signal.aborted) throw e;
      if (attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
      const err = new Error('network'); err.kind = 'network'; throw err;
    }
    if (res.status === 429 && attempt < 5) { await sleep(10000 * (attempt + 1)); continue; }
    if (res.status >= 500 && attempt < 2) { await sleep(3000); continue; }
    if (!res.ok) { const err = new Error('HTTP ' + res.status); err.kind = 'http'; err.status = res.status; throw err; }
    return res.json();
  }
}

/* ---------- cache ---------- */

const KEY = server => 'aoc.market.v1.' + server;

export function emptyMarket() { return { prices: {}, hist: {}, pAt: {}, hAt: {} }; }

export function loadMarket(server) {
  try {
    const raw = localStorage.getItem(KEY(server));
    if (raw) {
      const m = JSON.parse(raw);
      if (m && m.prices && m.hist) return { pAt: {}, hAt: {}, ...m };
    }
  } catch { /* storage blocked or corrupt */ }
  return emptyMarket();
}

export function saveMarket(server, m) {
  try { localStorage.setItem(KEY(server), JSON.stringify(m)); return true; }
  catch {
    // Over the storage quota: keep prices, drop history, try once more.
    try { localStorage.setItem(KEY(server), JSON.stringify({ ...m, hist: {}, hAt: {} })); } catch { /* memory only */ }
    return false;
  }
}

export function clearMarket(server) { try { localStorage.removeItem(KEY(server)); } catch { /* ignore */ } }

/* ---------- loading ---------- */

// Fetch prices (and sales history for `histIds`) into `m`. Only ids not fetched in the last
// REUSE_MIN minutes are requested, unless `force`. onProgress(done, total) after each request.
export async function update(server, m, { priceIds, histIds = [], force = false, onProgress, signal, now = Date.now() }) {
  const due = (ids, at) => ids.filter(id => force || !at[id] || now - at[id] > REUSE_MIN * 60e3);
  const pIds = due([...new Set(priceIds)], m.pAt), hIds = due([...new Set(histIds)], m.hAt);
  const jobs = [
    ...priceRequests(server, pIds).map(r => ({ ...r, kind: 'p' })),
    ...historyRequests(server, hIds, new Date(now)).map(r => ({ ...r, kind: 'h' }))
  ];
  let done = 0, failed = null;
  if (onProgress) onProgress(0, jobs.length);
  const queue = jobs.slice();
  async function worker() {
    while (queue.length && !failed) {
      const job = queue.shift();
      try {
        const rows = await getJson(job.url, signal);
        const ids = job.ids;
        if (job.kind === 'p') {
          for (const id of ids) { delete m.prices[id]; m.pAt[id] = now; }
          parsePrices(rows, m.prices);
        } else {
          for (const id of ids) { delete m.hist[id]; m.hAt[id] = now; }
          parseHistory(rows, m.hist, now);
        }
      } catch (e) {
        if (signal && signal.aborted) return;
        failed = e;
      }
      done++;
      if (onProgress) onProgress(done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
  if (failed) throw failed;
  return { requests: jobs.length, prices: pIds.length, history: hIds.length };
}

// Data pasted by hand (from opening an API link): works for both /prices and /history output.
export function importPasted(text, m, now = Date.now()) {
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || !rows.length) throw new Error('empty');
  if (Array.isArray(rows[0].data)) {
    parseHistory(rows, m.hist, now);
    for (const r of rows) m.hAt[r.item_id] = now;
    return { kind: 'history', count: new Set(rows.map(r => r.item_id)).size };
  }
  if (!('sell_price_min' in rows[0])) throw new Error('format');
  parsePrices(rows, m.prices);
  for (const r of rows) m.pAt[r.item_id] = now;
  return { kind: 'prices', count: new Set(rows.map(r => r.item_id)).size };
}
