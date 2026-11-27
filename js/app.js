// Crafting page: rank crafts for the trip you're willing to make (left), work out one item in detail (right).
import * as C from './calc.js?v=4'; // ?v: a cached older copy can't be mixed in
import * as M from './market.js';
import * as P from './profile.js';
import * as L from './levels.js';
import * as H from './haul.js?v=4';

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = n => n != null && Number.isFinite(n);
const fmt = n => (ok(n) ? Math.round(n).toLocaleString('en-US') : '—');
const fmtS = n => { if (!ok(n)) return '—'; const r = Math.round(n); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toLocaleString('en-US'); };
const fmt1 = n => (ok(n) ? (Math.abs(n) >= 100 ? fmt(n) : n.toFixed(1)) : '—');
const pct = x => (ok(x) ? (x * 100).toFixed(1) + '%' : '—');
const cls = n => (!ok(n) ? 'muted' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function ago(t) {
  if (!t) return '';
  const m = Math.max(0, (Date.now() - t) / 60e3);
  if (m < 1) return 'just now';
  if (m < 60) return Math.round(m) + 'm ago';
  if (m < 48 * 60) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}
const iconUrl = id => `https://render.albiononline.com/v1/item/${encodeURIComponent(id)}.png?size=80&quality=1`;
const icon = (id, size = '') => `<img class="ic ${size}" src="${iconUrl(id)}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">`;
const tierTag = it => `<span class="tier">${it.t}.${it.e}</span>`;
const STATUS = { profit: ['profit', 'Profitable'], focus: ['focus', 'Only with focus'], loss: ['loss', 'Loss'], nodata: ['nodata', 'No price'] };
const STATUS_HELP = { profit: 'Makes money even without focus', focus: 'Only makes money if you spend focus', loss: 'Loses money at these prices', nodata: 'Some prices are missing' };

/* ---------- state ---------- */
const STORE = 'aoc.settings.v1';
const DEFAULTS = {
  server: 'europe', cat: 'all', q: '', tiers: [4, 5, 6, 7, 8], enchants: [0], extra: 1, sellWhere: 'craft', crafts: 10,
  useFocus: false, journals: true, show: 'all', sort: 'profit', sel: null,
  craftCity: 'auto', customBonus: 25, buyMode: 'instant', sellBasis: 'listing', daily: 0, stationFee: 0, focus: 10000,
  maxAge: 48, premium: true, levels: {}, fce: {}, overrides: {}
};
const PAGE = 60;
let D = null, S = null, MK = null, loading = null;
let ranked = [], shown = PAGE;
const byId = new Map(), byBase = new Map(), catName = {};
let bench = { id: null, picks: {}, sellPin: null, haulKg: null };
let autoSel = false;
let fillValue = 100; // last quick-fill level // true while the selection is ours, not the user's: it follows the top of the list

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { /* ignore */ }
  const s = { ...DEFAULTS, ...saved };
  for (const k of ['levels', 'fce', 'overrides']) s[k] = { ...(s[k] || {}) };
  if (!M.SERVERS[s.server]) s.server = 'europe';
  if (!['profit', 'spf', 'margin', 'perDay'].includes(s.sort)) s.sort = 'profit';
  if (!['all', 'profit', 'focus'].includes(s.show)) s.show = 'all';
  if (![0, 1, 2, 6].includes(+s.extra)) s.extra = 1;
  if (!['craft', 'best'].includes(s.sellWhere)) s.sellWhere = 'craft';
  if (!Array.isArray(s.tiers) || !s.tiers.length) s.tiers = DEFAULTS.tiers;
  if (!Array.isArray(s.enchants) || !s.enchants.length) s.enchants = DEFAULTS.enchants;
  return s;
}
const save = debounce(() => {
  let ok = true;
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { ok = false; }
  P.syncActive(S);
  P.flashSaved(ok);
}, 300);

// Settings in the shape calc.js expects
function calcS(extra = {}) {
  return {
    ...C.DEFAULTS, premium: S.premium, focus: S.focus, levels: S.levels, fce: S.fce, overrides: S.overrides, journals: S.journals,
    daily: +S.daily || 0, stationFee: +S.stationFee || 0, maxAge: +S.maxAge, buyMode: S.buyMode, sellBasis: S.sellBasis,
    craftCity: S.craftCity, customBonus: S.customBonus, buyCity: 'craft', sellCity: S.sellWhere === 'best' ? 'best' : 'craft', ...extra
  };
}

// One item on a trip: buy each resource in the cheapest allowed city, then price it.
function trip(it, extra = +S.extra, picks = null, sellPin = null) {
  const s = calcS(sellPin ? { sellCity: sellPin } : {});
  const route = C.routePlan(it, s, D, MK, extra);
  const plan = { ...(route ? route.plan : {}), ...(picks || {}) };
  const ss = { ...s, buyPlan: plan };
  const e = C.evaluate(it, ss, MK, D);
  e.route = route; e.ss = ss; e.plan = plan;
  e.b = C.batch(e, ss, Math.max(1, +S.crafts || 1), S.useFocus);
  return e;
}
const perCraft = e => (S.useFocus && e.fc ? e.profitF : e.profitN);
const homeOf = e => (e.route ? e.route.home : e.craftCity);
function routeText(e) {
  const stops = [];
  for (const r of e.rows) { const c = r.unit && r.unit.city; if (c && C.MARKETS.includes(c) && c !== homeOf(e) && !stops.includes(c)) stops.push(c); }
  stops.push(e.craftCity === 'custom' ? 'hideout' : e.craftCity);
  const sell = e.sale && e.sale.city;
  if (sell && sell !== e.craftCity && C.SELL_MARKETS.includes(sell)) stops.push('sell ' + sell);
  return stops.join(' → ');
}

/* ---------- boot ---------- */
// First visit with no levels anywhere: start on the Your levels page, once.
function firstVisit() {
  try {
    if (localStorage.getItem('aoc.onboarded')) return false;
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    if (Object.keys(saved.levels || {}).length || Object.keys(saved.fce || {}).length) { localStorage.setItem('aoc.onboarded', '1'); return false; }
    return true;
  } catch { return false; }
}

async function boot() {
  if (firstVisit()) { location.replace('profile.html?welcome=1'); return; }
  try {
    const res = await fetch('data/items.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    D = await res.json();
  } catch {
    setStatus('Couldn’t load data/items.json. Serve the folder over http.', 'err');
    return;
  }
  for (const it of D.items) {
    it.name = D.names[it.id.replace(/@\d$/, '')] || it.id;
    it.lc = it.name.toLowerCase();
    it.base = it.id.replace(/^T\d_/, '').replace(/@\d$/, '');
    byId.set(it.id, it);
    if (!byBase.has(it.base)) byBase.set(it.base, []);
    byBase.get(it.base).push(it);
  }
  for (const g of D.groups) for (const c of g.cats) catName[c.key] = c.name;
  $('dataInfo').textContent = `${D.items.length.toLocaleString('en-US')} recipes, ${D.generated}`;
  S = loadSettings();
  MK = M.loadMarket(S.server);
  wire();
  writeControls();
  recompute();
  fetchPrices(false);
}

function setStatus(text, kind) { const el = $('status'); el.textContent = text; el.className = 'status' + (kind ? ' ' + kind : ''); }

/* ---------- controls ---------- */
const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
function wire() {
  $('server').innerHTML = Object.entries(M.SERVERS).map(([k, v]) => opt(k, v.name)).join('');
  $('char').innerHTML = P.charOptions();
  $('char').addEventListener('change', e => {
    const changed = P.onCharPick(e.target.value, S);
    $('char').innerHTML = P.charOptions();
    if (!changed) return;
    try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* ignore */ }
    if (loading) loading.abort();
    MK = M.loadMarket(S.server);
    writeControls(); recompute(); fetchPrices(false);
  });
  let cat = opt('all', 'All categories');
  for (const g of D.groups) cat += `<optgroup label="${esc(g.name)}">${opt('g:' + g.key, 'All ' + g.name.toLowerCase())}${g.cats.map(c => opt(c.key, c.name)).join('')}</optgroup>`;
  $('cat').innerHTML = cat;
  const rests = Object.keys(D.cities).filter(c => D.cities[c].rest);
  $('craftCity').innerHTML = opt('auto', 'Bonus city for each item') + `<optgroup label="Cities">${C.MARKETS.map(c => opt(c, c)).join('')}</optgroup><optgroup label="Rests">${rests.map(c => opt(c, c)).join('')}</optgroup>` + opt('custom', 'Hideout or island');
  $('tiers').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(t => `<button type="button" class="chip" data-tier="${t}">T${t}</button>`).join('');
  $('enchants').innerHTML = [0, 1, 2, 3, 4].map(e => `<button type="button" class="chip" data-ench="${e}">.${e}</button>`).join('');

  $('server').addEventListener('change', e => { if (loading) loading.abort(); S.server = e.target.value; save(); MK = M.loadMarket(S.server); recompute(); fetchPrices(false); });
  $('refresh').addEventListener('click', () => fetchPrices(true));
  $('cat').addEventListener('change', e => { S.cat = e.target.value; viewChanged(); });
  $('q').addEventListener('input', debounce(e => { S.q = e.target.value; viewChanged(); }, 250));
  $('sort').addEventListener('change', e => { S.sort = e.target.value; save(); shown = PAGE; renderList(); });
  $('more').addEventListener('click', () => { shown += PAGE; renderList(); });
  const num = (id, key, min = 0) => $(id).addEventListener('input', debounce(e => { S[key] = Math.max(min, +e.target.value || min); save(); recompute(); }, 300));
  num('crafts', 'crafts', 1); num('stationFee', 'stationFee'); num('focus', 'focus'); num('customBonus', 'customBonus');
  $('maxAge').addEventListener('change', e => { S.maxAge = +e.target.value; save(); recompute(); });
  $('craftCity').addEventListener('change', e => { S.craftCity = e.target.value; $('f-custom').hidden = S.craftCity !== 'custom'; save(); recompute(); });
  for (const k of ['useFocus', 'journals', 'premium']) $(k).addEventListener('change', e => { S[k] = e.target.checked; save(); recompute(); });

  document.addEventListener('click', e => {
    const seg = e.target.closest('.seg[data-key] button[data-v]');
    if (seg && !seg.closest('#bench')) {
      const k = seg.parentElement.dataset.key, v = seg.dataset.v;
      S[k] = ['extra', 'daily'].includes(k) ? +v : v;
      save(); writeSegs(); shown = PAGE; recompute(); return;
    }
    const tier = e.target.closest('[data-tier]'), ench = e.target.closest('[data-ench]');
    if (tier || ench) {
      const key = tier ? 'tiers' : 'enchants', v = +(tier ? tier.dataset.tier : ench.dataset.ench);
      const set = new Set(S[key]);
      if (e.shiftKey || e.ctrlKey || e.metaKey) { set.clear(); set.add(v); } else if (set.has(v)) { if (set.size > 1) set.delete(v); } else set.add(v);
      S[key] = [...set].sort((a, b) => a - b);
      viewChanged(); return;
    }
    const row = e.target.closest('[data-sel]');
    if (row) {
      select(row.dataset.sel);
      if (row.closest('#list') && matchMedia('(max-width: 1179px)').matches) $('bench').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  $('bench').addEventListener('click', onBenchClick);
  $('bench').addEventListener('input', debounce(onBenchInput, 500));
  $('bench').addEventListener('change', onBenchInput);

  $('loadPaste').addEventListener('click', () => {
    const st = $('pasteStatus');
    try {
      const r = M.importPasted($('paste').value.trim(), MK);
      M.saveMarket(S.server, MK);
      st.textContent = `Loaded ${r.kind} for ${r.count} items.`; $('paste').value = '';
      recompute();
    } catch { st.textContent = 'That doesn’t look like data from one of the links. Copy the whole page and try again.'; }
  });
  $('clearCache').addEventListener('click', () => { M.clearMarket(S.server); MK = M.emptyMarket(); recompute(); setStatus('Saved prices cleared.', ''); });
}

function writeSegs() {
  document.querySelectorAll('.seg[data-key]').forEach(seg => {
    if (seg.closest('#bench')) return;
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(S[seg.dataset.key]) === b.dataset.v));
  });
  document.querySelectorAll('[data-tier]').forEach(b => b.setAttribute('aria-pressed', S.tiers.includes(+b.dataset.tier)));
  document.querySelectorAll('[data-ench]').forEach(b => b.setAttribute('aria-pressed', S.enchants.includes(+b.dataset.ench)));
}
function writeControls() {
  $('server').value = S.server;
  $('cat').value = S.cat;
  if ($('cat').value !== S.cat) { S.cat = 'all'; $('cat').value = 'all'; }
  $('q').value = S.q; $('sort').value = S.sort;
  $('crafts').value = S.crafts; $('stationFee').value = S.stationFee; $('focus').value = S.focus; $('customBonus').value = S.customBonus;
  $('maxAge').value = String(S.maxAge); $('craftCity').value = S.craftCity; $('f-custom').hidden = S.craftCity !== 'custom';
  for (const k of ['useFocus', 'journals', 'premium']) $(k).checked = !!S[k];
  writeSegs();
}
function viewChanged() { shown = PAGE; save(); writeSegs(); recompute(); fetchSoon(); }

/* ---------- items in view ---------- */
function catSet() {
  if (S.cat === 'all') return null;
  if (S.cat.startsWith('g:')) { const g = D.groups.find(x => x.key === S.cat.slice(2)); return new Set(g ? g.cats.map(c => c.key) : []); }
  return new Set([S.cat]);
}
function viewItems() {
  const cats = catSet(), q = S.q.trim().toLowerCase(), tiers = new Set(S.tiers), ench = new Set(S.enchants);
  return D.items.filter(it => (!cats || cats.has(it.c)) && tiers.has(it.t) && ench.has(it.e) && (!q || it.lc.includes(q) || it.id.toLowerCase().includes(q)));
}
function idsFor(items) {
  const price = new Set(), hist = new Set();
  for (const it of items) {
    price.add(it.id); hist.add(it.id);
    for (const [id] of it.r) { price.add(id); hist.add(id); }
    if (it.j) { price.add(it.j[0] + '_EMPTY'); price.add(it.j[0] + '_FULL'); }
  }
  if (items.length) for (const x of D.mounts || []) price.add(x.id); // for the mount picker
  return { priceIds: [...price], histIds: [...hist] };
}

/* ---------- prices ---------- */
const fetchSoon = debounce(() => fetchPrices(false), 600);
async function fetchPrices(force) {
  if (!D) return;
  if (loading) loading.abort();
  const ctl = new AbortController();
  loading = ctl;
  const items = viewItems();
  const sel = byId.get(S.sel);
  if (sel) items.push(...(byBase.get(sel.base) || []));
  const { priceIds, histIds } = idsFor(items);
  const server = S.server;
  renderLinks(priceIds, histIds);
  $('refresh').disabled = true;
  try {
    const r = await M.update(server, MK, {
      priceIds, histIds, force, signal: ctl.signal,
      onProgress: (done, total) => {
        if (!total) return;
        $('progress').hidden = false; $('progressBar').style.width = (100 * done / total) + '%';
        setStatus(`Loading ${M.SERVERS[server].name} prices ${done}/${total}`, '');
        if (done && done % 4 === 0) recompute();
      }
    });
    if (ctl.signal.aborted) return;
    M.saveMarket(server, MK);
    let newest = 0;
    for (const id of priceIds) if (MK.pAt[id] > newest) newest = MK.pAt[id];
    setStatus(`${M.SERVERS[server].name} · prices ${r.requests ? 'just updated' : 'from ' + ago(newest)}`, r.requests ? 'ok' : '');
  } catch (e) {
    if (ctl.signal.aborted) return;
    M.saveMarket(server, MK);
    setStatus(e.kind === 'network' ? 'Couldn’t reach the Albion Online Data Project. Showing saved prices; see “Prices not loading?” below.' : 'Price service error: ' + e.message, 'err');
  } finally {
    if (loading === ctl) { loading = null; $('progress').hidden = true; $('refresh').disabled = false; recompute(); }
  }
}
function renderLinks(priceIds, histIds) {
  const reqs = [...M.priceRequests(S.server, priceIds).map((r, i) => [r.url, `Prices ${i + 1}`]), ...M.historyRequests(S.server, histIds).map((r, i) => [r.url, `Sales history ${i + 1}`])];
  $('links').innerHTML = reqs.map(([u, t]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join('') || '<span class="note">Nothing to load.</span>';
}

/* ---------- ranked list ---------- */
function recompute() {
  if (!D) return;
  const items = viewItems();
  ranked = items.map(it => trip(it));
  if (!S.sel || !byId.has(S.sel) || autoSel) {
    const top = sortList(ranked.filter(e => e.priced))[0];
    S.sel = top ? top.item.id : (items[0] && items[0].id) || null;
    autoSel = !top;
  }
  renderList();
  renderBench();
}
function sortList(list) {
  const key = { profit: e => e.b.profit, spf: e => e.spf, margin: e => (S.useFocus && e.fc ? e.marginF : e.marginN), perDay: e => e.perDay }[S.sort];
  return list.slice().sort((a, b) => {
    if (a.priced !== b.priced) return a.priced ? -1 : 1;
    const x = key(a), y = key(b);
    if (!ok(x) && !ok(y)) return 0;
    if (!ok(x)) return 1;
    if (!ok(y)) return -1;
    return y - x;
  });
}
function renderList() {
  let list = ranked.filter(e => e.priced);
  if (S.show === 'profit') list = list.filter(e => e.status === 'profit');
  else if (S.show === 'focus') list = list.filter(e => e.status === 'focus');
  list = sortList(list);
  const total = list.length, missing = ranked.length - ranked.filter(e => e.priced).length;
  $('listSub').textContent = `${total.toLocaleString('en-US')} items · ${fmt(S.crafts)} crafts each`;
  if (!list.length) {
    $('list').innerHTML = `<p class="empty">${!ranked.length ? 'Nothing matches. Pick another category or more tiers.' : loading ? 'Loading prices…' : missing ? 'No prices yet for these items. Press Refresh prices.' : 'Nothing in this group. Try All.'}</p>`;
    $('more').hidden = true;
    return;
  }
  $('list').innerHTML = list.slice(0, shown).map(e => {
    const it = e.item, st = STATUS[e.status];
    return `<button type="button" class="rank" data-sel="${esc(it.id)}" aria-current="${it.id === S.sel}">
      ${icon(it.id)}
      <span class="main"><span class="name">${esc(it.name)} ${tierTag(it)} <span class="tag ${st[0]}" title="${STATUS_HELP[e.status]}">${st[1]}</span></span>
        <span class="sub">${esc(routeText(e))}${ok(e.perDay) ? ' · ' + fmt1(e.perDay) + '/day' : ''}</span></span>
      <span class="right"><span class="p ${cls(e.b.profit)}">${fmtS(e.b.profit)}</span><span class="pp">${fmtS(perCraft(e))} / craft</span></span>
    </button>`;
  }).join('') + (missing ? `<p class="note" style="padding:8px 14px">${missing.toLocaleString('en-US')} more have missing prices.</p>` : '');
  $('more').hidden = total <= shown;
  $('more').textContent = `Show more (${(total - shown).toLocaleString('en-US')} left)`;
}

/* ---------- workbench ---------- */
function select(id) {
  if (!byId.has(id)) return;
  autoSel = false;
  if (bench.id !== id) bench = { id, picks: {}, sellPin: null, haulKg: null };
  S.sel = id; save();
  renderList(); renderBench();
  const it = byId.get(id), need = idsFor(byBase.get(it.base) || [it]);
  if (need.priceIds.some(x => !MK.pAt[x])) {
    M.update(S.server, MK, need).then(() => { M.saveMarket(S.server, MK); recompute(); }).catch(() => {});
  }
}
const nm = id => D.names[id.replace(/@\d$/, '')] || id;
const journalName = id => nm(id + '_EMPTY').replace(/ \(Empty\)$/, '');

function renderBench() {
  const it = byId.get(S.sel);
  if (!it) { $('bench').innerHTML = '<p class="empty">Pick an item on the left.</p>'; return; }
  if (bench.id !== it.id) bench = { id: it.id, picks: {}, sellPin: null, haulKg: null };
  const e = trip(it, +S.extra, bench.picks, bench.sellPin), b = e.b, s = e.ss;
  const N = Math.max(1, +S.crafts || 1);
  const craftAt = e.craftCity === 'custom' ? 'your hideout' : e.craftCity, home = homeOf(e);
  const st = STATUS[e.status];
  const bonus = Math.round((e.pb - (+S.daily || 0) / 100) * 100);
  const j = e.journal, jOn = !!(S.journals && j && j.value != null);
  const sellCity = e.sale ? e.sale.city : e.sellCity;

  // Tier x enchantment grid for this item
  const variants = byBase.get(it.base) || [it];
  const tiers = [...new Set(variants.map(v => v.t))].sort((a, c) => a - c);
  let mx = '<span></span>' + [0, 1, 2, 3, 4].map(x => `<span class="h">.${x}</span>`).join('');
  for (const t of tiers) {
    mx += `<span class="t">T${t}</span>`;
    for (let x = 0; x <= 4; x++) {
      const v = variants.find(y => y.t === t && y.e === x);
      if (!v) { mx += '<span class="cell none" aria-hidden="true">·</span>'; continue; }
      const ev = v.id === it.id ? e : trip(v);
      const p = ev.priced ? perCraft(ev) : null;
      mx += `<button type="button" class="cell ${ok(p) ? (p > 0 ? 'up' : 'down') : ''}" data-sel="${esc(v.id)}" aria-pressed="${v.id === it.id}" aria-label="${esc(v.name)} ${t}.${x}: ${ok(p) ? fmtS(p) : 'no price'} per craft">
        <span class="v ${cls(p)}">${ok(p) ? fmtS(p) : '—'}</span><span class="m">${ok(p) ? pct(S.useFocus && ev.fc ? ev.marginF : ev.marginN) : ''}</span></button>`;
    }
  }

  // Stops on the trip, grouped by city
  const groups = new Map();
  const add = (city, text, silver, kind) => { if (!groups.has(city)) groups.set(city, []); groups.get(city).push({ text, silver, kind }); };
  for (const r of b.rows) {
    const u = r.unit;
    if (!u) { add('No price yet', `${fmt(r.buy)} × ${nm(r.id)}`, null, 'buy'); continue; }
    if (u.how === 'free') continue;
    const how = u.how === 'manual' ? 'Use your own' : u.how === 'order' ? 'Buy order' : 'Buy now';
    const at = u.how === 'manual' ? '' : ` at ${fmt(u.how === 'order' ? u.u / 1.025 : u.u)}`;
    add(u.how === 'manual' ? 'Your own stock' : u.city, `${how}: ${fmt(r.buy)} × ${nm(r.id)}${at}`, r.total, 'buy');
  }
  const jCount = Math.floor(b.journalCount + 1e-9);
  const craftKey = e.craftCity === 'custom' ? 'Your hideout' : e.craftCity;
  if (jOn && jCount > 0) add(home, `Buy ${jCount} empty ${journalName(j.id)}${jCount > 1 ? 's' : ''}`, jCount * j.empty.u, 'buy');
  add(craftKey, `Craft ${fmt(N)} × ${it.name}${b.Nf ? ` (${fmt(b.Nf)} with focus)` : ''}`, null, 'craft');
  const sellHow = !e.sale ? 'Sell' : e.sale.basis === 'buyorder' ? 'Sell now' : e.sale.basis === 'listing' ? 'Sell order' : 'Sell';
  add(sellCity, `${sellHow}: ${fmt(b.items)}${e.sale ? ' at ' + fmt(e.sale.p) : ''}`, e.sale ? b.revenue : null, 'sell');
  if (jOn && jCount > 0) add(sellCity === 'Black Market' ? home : sellCity, `Sell ${jCount} full journal${jCount > 1 ? 's' : ''}`, jCount * j.full.net, 'sell');
  const order = (c) => (c === 'Your own stock' ? 0 : c === 'No price yet' ? 1 : c === craftKey ? 3 : groups.get(c).every(l => l.kind === 'sell') ? 4 : 2);
  const stops = [...groups.keys()].sort((a, c) => order(a) - order(c)).map((c, i) => {
    const lines = groups.get(c), kinds = new Set(lines.map(l => l.kind));
    const role = kinds.has('craft') ? (kinds.has('sell') ? 'Craft and sell' : 'Craft') : kinds.has('sell') && !kinds.has('buy') ? 'Sell' : c === 'Your own stock' ? 'Already have' : 'Buy materials';
    return `<li class="stop${kinds.has('craft') ? ' home' : ''}"><div class="stop-h"><span class="dot">${i + 1}</span><span><b>${esc(c)}</b><small>${role}${kinds.has('craft') ? ` · +${bonus}% bonus` : ''}</small></span></div>
      ${lines.map(l => `<div class="ln"><span>${esc(l.text)}</span><span class="${l.kind === 'sell' ? 'pos' : 'muted'}">${l.silver != null ? fmt(l.silver) : l.kind === 'buy' ? '<span class="neg">no price</span>' : ''}</span></div>`).join('')}</li>`;
  }).join('');

  const spend = b.cost + (jOn ? jCount * j.empty.u : 0);
  const get = b.revenue + (jOn ? jCount * j.full.net : 0);
  const anyPick = Object.keys(bench.picks).length > 0 || !!bench.sellPin;
  const local = trip(it, 0, null, bench.sellPin);
  const gain = b.profit - local.b.profit;
  const cmp = [[0, `Buy everything in ${home}`], [1, 'Shop in 1 more city'], [2, 'Shop in 2 more cities'], [6, 'Shop in any city']].map(([k, label]) => {
    const ev = k === +S.extra && !anyPick ? e : trip(it, k, null, bench.sellPin);
    return `<button type="button" class="cmp-row${k === +S.extra ? ' cur' : ''}" data-extra="${k}" style="width:100%;border:none;border-top:1px solid var(--line2);background:transparent;text-align:left;cursor:pointer;min-height:40px">
      <span>${label}</span><span class="muted">${esc(routeText(ev))}</span><span class="${cls(ev.priced ? ev.b.profit : null)}" style="text-align:right">${ev.priced ? fmtS(ev.b.profit) : '<span class="muted">prices missing</span>'}</span></button>`;
  }).join('');

  // Market prices: every city and every kind of price, labeled. Click a price to use it.
  const plain = { ...s, overrides: {} };
  const ageOf = at => (at ? ', ' + ago(at) : '');
  const mktHead = `<span class="h">Material</span><span class="h">Price</span>` + C.SELL_MARKETS.map(c => `<span class="h">${esc(c)}</span>`).join('');
  const usingBuy = S.buyMode === 'order' ? 'buyorder' : 'listing';
  const priceRow = (kind, label, cities, opts) => {
    const vals = cities.map(c => ({ c, x: C.SELL_MARKETS.includes(c) && (opts.sell || c !== 'Black Market') ? C.marketPrice(MK, opts.id, c, kind, plain) : null }));
    const have = vals.filter(v => v.x).map(v => v.x.p);
    const best = have.length ? (opts.sell ? Math.max(...have) : Math.min(...have)) : 0;
    return `<span class="rl${opts.used ? ' used' : ''}" title="${esc(opts.help)}">${label}${opts.used ? ' ✓' : ''}</span>` + vals.map(v => v.x
      ? `<button type="button" class="pcb${v.x.p === best ? ' best' : ''}" ${opts.attr(v.c)} data-mode="${kind}" aria-pressed="${!!opts.used && v.c === opts.chosen}" title="${esc(v.c)}${ageOf(v.x.at)}" aria-label="${label} in ${esc(v.c)}: ${fmt(v.x.p)}">${fmt(v.x.p)}</button>`
      : '<span class="pcb empty" aria-hidden="true">—</span>').join('');
  };
  // Sold per day in each city (7-day average), from the sales history
  const volRow = (id, sell) => {
    const vals = C.SELL_MARKETS.map(c => (sell || c !== 'Black Market' ? ((MK.hist[id] || {})[c] || null) : null));
    const top = Math.max(0, ...vals.map(h => (h ? h.n : 0)));
    return `<span class="rl" title="How many sold a day on average over the last 7 days">Sold / day</span>` +
      vals.map((h, i) => h ? `<span class="pcb vol${h.n === top && top > 0 ? ' best' : ''}" title="${esc(C.SELL_MARKETS[i])}: ${fmt1(h.n)} sold a day${h.avg ? ' at about ' + fmt(h.avg) : ''}">${fmt1(h.n)}</span>`
        : '<span class="pcb vol empty" aria-hidden="true">—</span>').join('');
  };
  const matRows = it.r.map(([id, qty, noReturn], i) => {
    const chosen = e.rows[i].unit && e.rows[i].unit.city;
    const o = { id, chosen, attr: c => `data-pick="${esc(id)}" data-city="${esc(c)}"` };
    return `<div class="nm" style="grid-row:span 3"><b>${esc(nm(id))}${/@\d$/.test(id) ? ' <span class="tier">.' + id.slice(-1) + '</span>' : ''}</b>
        <small>${qty} per craft · you need ${fmt(b.rows[i].buy)}${noReturn ? ' · never returned' : ''}</small>
        <input type="number" min="0" step="1" inputmode="numeric" data-ov="${esc(id)}" value="${S.overrides[id] || ''}" placeholder="your own price" aria-label="Your own price for ${esc(nm(id))}"></div>` +
      priceRow('listing', 'Buy now', C.SELL_MARKETS, { ...o, used: usingBuy === 'listing', help: 'Cheapest seller: you get it instantly' }) +
      priceRow('buyorder', 'Buy order', C.SELL_MARKETS, { ...o, used: usingBuy === 'buyorder', help: 'Highest buy order: post yours at this price and wait' }) +
      volRow(id, false);
  }).join('<span class="sep thin"></span>');
  const saleKind = e.sale ? (e.sale.basis === 'manual' ? null : e.sale.basis) : null;
  const so = { id: it.id, sell: true, chosen: e.sale && e.sale.city, attr: c => `data-sellpin="${esc(c)}"` };
  const sellRows = `<div class="nm" style="grid-row:span 4"><b>Sell ${esc(it.name)}</b><small>${fmt(b.items)} to sell</small>
      <input type="number" min="0" step="1" inputmode="numeric" data-ov="${esc(it.id)}" value="${S.overrides[it.id] || ''}" placeholder="your own price" aria-label="Your own sell price"></div>` +
    priceRow('listing', 'Sell order', C.SELL_MARKETS, { ...so, used: saleKind === 'listing', help: 'List at the cheapest current price and wait for a buyer' }) +
    priceRow('buyorder', 'Sell now', C.SELL_MARKETS, { ...so, used: saleKind === 'buyorder', help: 'Sell instantly to the highest buy order' }) +
    priceRow('average', 'Sold for', C.SELL_MARKETS, { ...so, used: saleKind === 'average', help: 'Average price it actually sold for over 7 days' }) +
    volRow(it.id, true);
  const hist = (MK.hist[it.id] || {})[sellCity];
  const modeSeg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button type="button" data-benchset="${key}" data-v="${v}" aria-pressed="${S[key] === v}">${t}</button>`).join('')}</div>`;

  // Buying everything in one city, and carrying it
  const buyCitySet = new Set(b.rows.filter(r => r.unit && C.MARKETS.includes(r.unit.city)).map(r => r.unit.city));
  const oneCity = H.oneCityTable({ rows: b.rows, s, m: MK, home: e.craftCity === 'custom' ? craftAt : e.craftCity,
    profit: e.priced ? b.profit : null, mat: b.mat, chosen: buyCitySet.size === 1 ? [...buyCitySet][0] : null, name: nm });
  const matKg = C.loadKg(D, b.rows.map(r => [r.id, r.buy]));
  const farKg = C.loadKg(D, b.rows.filter(r => r.unit && C.MARKETS.includes(r.unit.city) && r.unit.city !== e.craftCity).map(r => [r.id, r.buy]));
  const haul = H.mountSection({ data: D, m: MK, s, kg: matKg, far: farKg, home: craftAt, kgOverride: bench.haulKg,
    products: { kg: C.weightOf(D, it.id) * b.items, to: sellCity !== e.craftCity ? sellCity : null } });

  // One plain sentence for the whole plan
  const buyCities = [...new Set(e.rows.filter(r => r.unit && C.MARKETS.includes(r.unit.city)).map(r => r.unit.city))];
  const summary = e.priced
    ? `Buy materials in ${buyCities.length ? buyCities.map(esc).join(' and ') : 'your own stock'}, craft ${fmt(N)} in ${esc(craftAt)}${sellCity === e.craftCity ? ' and sell there' : `, sell in ${esc(sellCity)}`}. <b class="${cls(b.profit)}">${b.profit >= 0 ? 'Profit' : 'Loss'} ${fmtS(b.profit)}</b> (${fmtS(b.profit / N)} each).`
    : 'Some prices are missing, so the profit can’t be worked out yet. Press Refresh prices, or type your own price in the table below.';

  // Levels
  const lv = S.levels[it.l] || {}, line = D.lines[it.l] || { name: it.l }, calKey = it.l + '|' + it.s;
  const group = L.groupOf(D, it.c);
  const specs = Object.keys(D.specs).filter(k => k.startsWith(it.l + '|')).map(k => ({ spec: k.split('|')[1], name: D.specs[k] }))
    .sort((a, c) => (c.spec === it.s) - (a.spec === it.s) || a.name.localeCompare(c.name));

  // Keep the cursor in the input being typed in across the re-render
  const act = document.activeElement;
  const keep = act && act.closest && act.closest('#bench') && act.matches('input')
    ? (act.dataset.ov != null ? `[data-ov="${act.dataset.ov}"]` : act.dataset.lv != null ? `[data-lv="${act.dataset.lv}"]` : act.dataset.cal != null ? '[data-cal]' : act.dataset.haulkg != null ? '[data-haulkg]' : null) : null;
  const levelsOpen = $('bench').querySelector('details.levels') ? $('bench').querySelector('details.levels').open : (lv.m || Object.keys(lv.s || {}).length || S.fce[calKey] != null);

  $('bench').innerHTML = `
    <div class="bench-head">
      <div style="display:flex;gap:12px;align-items:center;min-width:0">${icon(it.id, 'lg')}
        <div style="display:grid;gap:2px;min-width:0"><h2>${esc(it.name)} ${tierTag(it)}</h2>
          <span class="muted">${esc(catName[it.c] || '')} · craft in ${esc(craftAt)} (+${bonus}%) · return ${pct(e.rN)}${e.fc ? `, with focus ${pct(e.rF)} · ${fmt(e.fc)} focus per craft` : ''}</span></div></div>
      <span class="tag ${st[0]}" style="font-size:13px;padding:3px 10px">${st[1]}</span>
    </div>
    <p class="summary">${summary}</p>

    <section class="sec">
      <div class="sec-head"><h3>Every tier and enchantment</h3><span class="note">Profit per craft ${S.useFocus ? 'with' : 'without'} focus on this trip. Click one to switch.</span></div>
      <div class="scroll"><div class="matrix">${mx}</div></div>
    </section>

    <section class="sec">
      <div class="sec-head"><h3>Your trip: ${fmt(N)} crafts</h3><span class="note">${esc(routeText(e))}</span></div>
      <ol class="stops">${stops}</ol>
      <div class="totals">
        <div class="tot"><span>You spend</span><b>${fmt(spend)}</b></div>
        <div class="tot"><span>You get after tax</span><b>${e.sale ? fmt(get) : '—'}</b></div>
        ${j ? `<div class="tot"><span>Journals</span><b class="${jOn ? cls(b.journals) : 'muted'}">${jOn ? fmtS(b.journals) : j.value == null ? 'no price' : 'off'}</b></div>` : ''}
        <div class="tot"><span>Profit</span><b class="${cls(e.priced ? b.profit : null)}">${e.priced ? fmtS(b.profit) : '—'}</b></div>
        <div class="tot"><span>Focus used</span><b>${b.focusUsed ? fmt(b.focusUsed) : 'none'}</b>${S.useFocus && e.fc && !b.Nf ? `<span>one craft needs ${fmt(e.fc)}, you have ${fmt(S.focus)}</span>` : ''}</div>
      </div>
      ${e.priced && gain > 0.5 ? `<p class="callout">Buying on the way earns <b>${fmtS(gain)}</b> more than buying everything in ${esc(home)}.</p>` : ''}
      ${j ? `<p class="note">Each craft fills ${fmt1(j.share * 100)}% of ${/^[AEIOU]/.test(journalName(j.id)) ? 'an' : 'a'} ${esc(journalName(j.id))} (${fmt1(j.perJournal)} crafts per journal)${j.empty && j.full ? `: empty ${fmt(j.empty.u)}, full sells for ${fmt(j.full.p)}` : ''}.</p>` : ''}
      <div>${cmp}</div>
    </section>

    <section class="sec">
      <div class="sec-head"><h3>Buy everything in one city</h3><span class="note">All materials for ${fmt(N)} crafts from one market, then carry them to ${esc(craftAt)}. Click a city to plan with it.</span></div>
      ${oneCity}
    </section>

    <section class="sec">
      <div class="sec-head"><h3>Carry it: which mount</h3><span class="note">Mount prices are the cheapest in any city.</span></div>
      ${haul}
    </section>

    <section class="sec">
      <div class="sec-head"><h3>Prices in every city</h3>
        <span class="ctl">${anyPick ? '<button type="button" class="btn quiet" data-reset>Back to the best route</button>' : ''}<span class="note">Green is the best price in each row. Click a price to buy or sell there.</span></span></div>
      <div class="ctl" style="flex-wrap:wrap;gap:8px 18px">
        <span class="ctl"><span class="lbl">How you buy materials</span>${modeSeg('buyMode', [['instant', 'Buy now (instant)'], ['order', 'Buy order (wait, cheaper)']])}</span>
        <span class="ctl"><span class="lbl">How you sell</span>${modeSeg('sellBasis', [['listing', 'Sell order (wait)'], ['buyorder', 'Sell now (instant)'], ['average', '7-day average']])}</span>
      </div>
      <div class="scroll"><div class="mkt">${mktHead}${matRows}<span class="sep"></span>${sellRows}</div></div>
      <details class="help"><summary>What do these prices mean?</summary>
        <dl>
          <dt>Buy now</dt><dd>The cheapest price someone is selling for. You get the items instantly.</dd>
          <dt>Buy order</dt><dd>The highest price someone is offering. Post your own order at about this price and wait for sellers. Usually cheaper; adds a 2.5% fee.</dd>
          <dt>Sell order</dt><dd>List your items at about the cheapest current price and wait for buyers. 2.5% fee plus tax.</dd>
          <dt>Sell now</dt><dd>Sell instantly to the highest buy order. Tax only, usually less money.</dd>
          <dt>Sold for</dt><dd>What it actually sold for on average over the last 7 days.</dd>
          <dt>Sold / day</dt><dd>How many sold a day in that city, on average over the last 7 days. Selling more than this takes longer; for materials it shows where they're traded most.</dd>
          <dt>✓</dt><dd>The kind of price the calculator is using. Switch it with the buttons above the table.</dd>
        </dl>
      </details>
      <p class="note">${hist && hist.avg ? `About ${fmt1(hist.n)} sell a day in ${esc(sellCity)}. ` : ''}${e.fee ? `Station fee ${fmt(e.fee)} per craft. ` : ''}Tax ${S.premium ? '4% with Premium' : '8% without Premium'}.</p>
    </section>

    ${it.f && !line.noLevels ? `<details class="sec levels"${levelsOpen ? ' open' : ''}>
      <summary style="cursor:pointer;min-height:40px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3>Your levels: ${esc(line.name)}</h3><span class="note">${fmt(e.fc)} focus per craft, base ${fmt(it.f)}</span></summary>
      <div class="specs" style="margin-top:10px;padding:10px 12px;background:var(--panel2);border-radius:8px">
        <span class="lbl">Quick fill</span>
        <label>Level <input type="number" min="0" max="100" data-fillval value="${fillValue}" aria-label="Level to fill"></label>
        <button type="button" class="btn" data-fill="line">All of ${esc(line.name)}</button>
        ${group ? `<button type="button" class="btn quiet" data-fill="group">Every ${esc(group.name)} mastery</button>` : ''}
        <button type="button" class="btn quiet" data-fill="clear">Clear ${esc(line.name)}</button>
      </div>
      <div class="specs" style="margin-top:10px">
        ${line.mastery === false ? '' : `<label>Mastery <input type="number" min="0" max="100" data-lv="m" value="${lv.m || ''}" placeholder="0"></label>`}
        ${specs.map(sp => `<label${sp.spec === it.s ? ' style="color:var(--accent);font-weight:600"' : ''}>${esc(sp.name)} <input type="number" min="0" max="100" data-lv="${esc(sp.spec)}" value="${(lv.s || {})[sp.spec] || ''}" placeholder="0"></label>`).join('')}
      </div>
      <div class="specs" style="margin-top:8px"><label>Focus per craft shown in game <input type="number" min="1" data-cal value="${S.fce[calKey] != null ? e.fc : ''}" placeholder="${e.fc}"></label>
        <span class="note">Type it to match the game exactly for every tier and enchantment of ${esc(D.specs[calKey] || it.name)}.</span></div>
      <p class="note" style="margin-top:8px"><a href="profile.html">Enter all your levels on one page →</a></p>
    </details>` : ''}`;
  if (keep) { const el = $('bench').querySelector(keep); if (el) el.focus({ preventScroll: true }); }
}

function onBenchClick(ev) {
  const t = ev.target;
  const setMode = (key, v) => { if (S[key] !== v) { S[key] = v; save(); writeSegs(); recompute(); return true; } return false; };
  const pick = t.closest('[data-pick]');
  if (pick) {
    bench.picks = { ...bench.picks, [pick.dataset.pick]: pick.dataset.city };
    if (!setMode('buyMode', pick.dataset.mode === 'buyorder' ? 'order' : 'instant')) renderBench();
    return;
  }
  const pin = t.closest('[data-sellpin]');
  if (pin) { bench.sellPin = pin.dataset.sellpin; if (!setMode('sellBasis', pin.dataset.mode)) renderBench(); return; }
  const bs = t.closest('[data-benchset]');
  if (bs) { setMode(bs.dataset.benchset, bs.dataset.v); return; }
  if (t.closest('[data-reset]')) { bench.picks = {}; bench.sellPin = null; renderBench(); return; }
  const one = t.closest('[data-onecity]');
  if (one) { const it = byId.get(S.sel); bench.picks = Object.fromEntries(it.r.map(([id]) => [id, one.dataset.onecity])); renderBench(); return; }
  if (t.closest('[data-haulreset]')) { bench.haulKg = null; renderBench(); return; }
  const ex = t.closest('[data-extra]');
  if (ex) { S.extra = +ex.dataset.extra; bench.picks = {}; save(); writeSegs(); recompute(); return; }
  const fill = t.closest('[data-fill]');
  if (fill) quickFill(fill.dataset.fill);
}

function quickFill(kind) {
  const it = byId.get(S.sel);
  if (!it) return;
  const box = $('bench').querySelector('[data-fillval]');
  fillValue = Math.min(100, Math.max(0, Math.floor(+(box && box.value) || 0)));
  if (kind === 'clear') L.clearLines(S, [it.l]);
  else if (kind === 'line') L.fillLines(S, D, [it.l], fillValue);
  else {
    const group = L.groupOf(D, it.c);
    if (!group) return;
    const lines = L.linesInGroup(D, group);
    if (!confirm(`Set every mastery and specialization in ${group.name} (${lines.length} masteries) to ${fillValue}?`)) return;
    L.fillLines(S, D, lines, fillValue);
  }
  save();
  recompute();
}

function onBenchInput(ev) {
  const el = ev.target, it = byId.get(S.sel);
  if (!it || !el.matches('input')) return;
  if (el.dataset.haulkg != null) { const v = +el.value; bench.haulKg = v > 0 ? v : null; renderBench(); return; }
  if (el.dataset.ov != null) {
    const v = +el.value;
    if (v > 0) S.overrides[el.dataset.ov] = v; else delete S.overrides[el.dataset.ov];
  } else if (el.dataset.lv != null) {
    const lv = S.levels[it.l] || (S.levels[it.l] = { m: 0, s: {} });
    lv.s = lv.s || {};
    const v = Math.min(100, Math.max(0, Math.floor(+el.value || 0)));
    if (el.dataset.lv === 'm') lv.m = v; else if (v) lv.s[el.dataset.lv] = v; else delete lv.s[el.dataset.lv];
  } else if (el.dataset.cal != null) {
    const v = +el.value, key = it.l + '|' + it.s;
    if (v > 0) S.fce[key] = C.fceFromGame(it, v); else delete S.fce[key];
  } else return;
  save();
  recompute();
}

boot();
