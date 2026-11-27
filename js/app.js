import * as C from './calc.js';
import * as M from './market.js';

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = n => n != null && Number.isFinite(n);
const fmt = n => (ok(n) ? Math.round(n).toLocaleString('en-US') : '—');
const fmtS = n => (ok(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('en-US') : '—');
const fmt1 = n => (ok(n) ? (Math.abs(n) >= 100 ? fmt(n) : n.toFixed(1)) : '—');
const pct = x => (ok(x) ? (x * 100).toFixed(1) + '%' : '—');
const cls = n => (!ok(n) ? 'dim' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function ago(t) {
  if (!t) return '';
  const m = Math.max(0, (Date.now() - t) / 60e3);
  if (m < 1) return 'just now';
  if (m < 60) return Math.round(m) + 'm ago';
  if (m < 48 * 60) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}
const isStale = t => t && Date.now() - t > 24 * 3600e3;
const iconUrl = id => `https://render.albiononline.com/v1/item/${encodeURIComponent(id)}.png?size=80&quality=1`;
const icon = (id, sm) => `<img class="ic${sm ? ' sm' : ''}" src="${iconUrl(id)}" alt="" loading="lazy" decoding="async" width="${sm ? 28 : 40}" height="${sm ? 28 : 40}" onerror="this.style.visibility='hidden'">`;

/* ---------- state ---------- */
const STORE = 'aoc.settings.v1';
const VIEW = { server: 'europe', cat: 'all', q: '', tiers: [4, 5, 6, 7, 8], enchants: [0], show: 'all', unpriced: false, sort: 'profitN', dir: -1 };
const PAGE = 100;
const STATUS_TEXT = { profit: 'Profitable', focus: 'Focus only', loss: 'Loss', nodata: 'No price' };
const SORT_TEXT = { profitN: 'profit without focus', profitF: 'profit with focus', spf: 'silver per focus', marginN: 'margin without focus', marginF: 'margin with focus', perDay: 'sold per day', price: 'sell price', name: 'name' };

let D = null, S = null, MK = null, evals = [], view = [], shown = PAGE, loading = null, lastError = null;
const byId = new Map();
const lineSpecs = {};          // line -> [{ spec, name }]
let detail = null;             // { id, N, useFocus }

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { /* ignore */ }
  const s = { ...C.DEFAULTS, ...VIEW, ...saved };
  for (const k of ['levels', 'fce', 'overrides']) s[k] = { ...(s[k] || {}) };
  if (!M.SERVERS[s.server]) s.server = 'europe';
  return s;
}
const saveSettings = debounce(() => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* ignore */ } }, 300);
const nameOf = it => D.names[it.id.replace(/@\d$/, '')] || it.id;
const resName = id => D.names[id.replace(/@\d$/, '')] || id;
const tierTag = it => `<span class="tier">${it.t}.${it.e}</span>`;
const catName = {};

/* ---------- boot ---------- */
async function boot() {
  try {
    const res = await fetch('data/items.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    D = await res.json();
  } catch (e) {
    setStatus('Couldn’t load the item data (data/items.json). If you opened the file directly, serve the folder over http instead.', 'err');
    return;
  }
  for (const it of D.items) {
    it.name = nameOf(it);
    it.lc = it.name.toLowerCase();
    byId.set(it.id, it);
  }
  for (const [key, name] of Object.entries(D.specs)) {
    const [line, spec] = key.split('|');
    (lineSpecs[line] || (lineSpecs[line] = [])).push({ spec, name });
  }
  for (const g of D.groups) for (const c of g.cats) catName[c.key] = c.name;
  $('dataInfo').textContent = `${D.items.length.toLocaleString('en-US')} recipes, game data from ${D.generated}.`;
  S = loadSettings();
  if (matchMedia('(max-width: 699px)').matches) document.querySelectorAll('.settings details').forEach(d => { d.open = false; });
  MK = M.loadMarket(S.server);
  buildControls();
  writeControls();
  recompute();
  fetchPrices(false);
}

/* ---------- controls ---------- */
function option(v, t, sel) { return `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`; }

function buildControls() {
  $('server').innerHTML = Object.entries(M.SERVERS).map(([k, v]) => option(k, v.name)).join('');
  let cat = option('all', 'All categories');
  for (const g of D.groups) {
    cat += `<optgroup label="${esc(g.name)}">` + option('g:' + g.key, 'All ' + g.name.toLowerCase()) + g.cats.map(c => option(c.key, c.name)).join('') + '</optgroup>';
  }
  $('cat').innerHTML = cat;
  const markets = C.MARKETS.map(c => option(c, c)).join('');
  const rests = Object.keys(D.cities).filter(c => D.cities[c].rest).map(c => option(c, c)).join('');
  $('craftCity').innerHTML = option('auto', 'Best bonus city for each item') + `<optgroup label="Cities">${markets}</optgroup><optgroup label="Rests">${rests}</optgroup>` + option('custom', 'Hideout or island (your bonus)');
  $('buyCity').innerHTML = option('craft', 'Same city I craft in') + option('cheapest', 'Cheapest city for each resource') + `<optgroup label="Cities">${markets}</optgroup>`;
  $('sellCity').innerHTML = option('craft', 'Same city I craft in') + option('best', 'Best price for each item') + `<optgroup label="Markets">${markets}${option('Black Market', 'Black Market')}</optgroup>`;
  $('tiers').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map(t => `<button type="button" class="chip" data-tier="${t}" aria-pressed="false">T${t}</button>`).join('');
  $('enchants').innerHTML = [0, 1, 2, 3, 4].map(e => `<button type="button" class="chip" data-ench="${e}" aria-pressed="false">.${e}</button>`).join('');

  $('server').addEventListener('change', e => {
    if (loading) loading.abort();
    S.server = e.target.value; saveSettings();
    MK = M.loadMarket(S.server);
    recompute(); fetchPrices(false);
  });
  $('refresh').addEventListener('click', () => fetchPrices(true));
  $('cat').addEventListener('change', e => { S.cat = e.target.value; viewChanged(); });
  $('q').addEventListener('input', debounce(e => { S.q = e.target.value; viewChanged(); }, 250));
  $('tiers').addEventListener('click', e => toggleChip(e, 'tier', 'tiers'));
  $('enchants').addEventListener('click', e => toggleChip(e, 'ench', 'enchants'));
  document.querySelectorAll('input[name="show"]').forEach(r => r.addEventListener('change', () => { S.show = r.value; shown = PAGE; saveSettings(); renderList(); }));
  $('unpriced').addEventListener('change', e => { S.unpriced = e.target.checked; shown = PAGE; saveSettings(); renderList(); });
  $('sort').addEventListener('change', e => { S.sort = e.target.value; S.dir = S.sort === 'name' ? 1 : -1; saveSettings(); renderList(); });
  $('more').addEventListener('click', () => { shown += PAGE; renderList(); });

  // Settings with data-set="key"
  const onSet = el => {
    const k = el.dataset.set;
    if (el.type === 'radio' && !el.checked) return;
    S[k] = el.type === 'checkbox' ? el.checked : el.dataset.num != null ? Math.max(0, +el.value || 0) : el.value;
    saveSettings();
    if (k === 'craftCity') $('f-custom').hidden = S.craftCity !== 'custom';
    recompute();
  };
  document.querySelectorAll('[data-set]').forEach(el => {
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'radio' || el.type === 'checkbox' ? 'change' : 'input', debounce(() => onSet(el), el.type === 'number' ? 250 : 0));
  });

  $('list').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort] button');
    if (th) {
      const k = th.parentElement.dataset.sort;
      if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = k === 'name' ? 1 : -1; }
      $('sort').value = S.sort; saveSettings(); renderList(); return;
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDetail(tr.dataset.id);
  });
  $('list').addEventListener('keydown', e => {
    const tr = e.target.closest('tr[data-id]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(tr.dataset.id); }
  });
  $('tiles').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openDetail(b.dataset.open); });
  $('clearLevels').addEventListener('click', () => {
    if (!confirm('Clear all the mastery and specialization levels you entered?')) return;
    S.levels = {}; S.fce = {}; saveSettings(); recompute();
  });

  $('loadPaste').addEventListener('click', () => {
    const st = $('pasteStatus');
    try {
      const r = M.importPasted($('paste').value.trim(), MK);
      M.saveMarket(S.server, MK);
      st.textContent = `Loaded ${r.kind} for ${r.count} items.`; st.className = 'status ok';
      $('paste').value = '';
      recompute();
    } catch {
      st.textContent = 'That doesn’t look like data from one of the links above. Copy the whole page and try again.'; st.className = 'status err';
    }
  });
  $('clearCache').addEventListener('click', () => {
    M.clearMarket(S.server); MK = M.emptyMarket(); recompute(); setStatus('Saved prices cleared.', '');
  });

  const dlg = $('detail');
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { detail = null; });
  $('detailBody').addEventListener('input', debounce(onDetailInput, 200));
  $('detailBody').addEventListener('change', onDetailInput);
  $('detailBody').addEventListener('click', onDetailClick);
}

function toggleChip(e, attr, key) {
  const b = e.target.closest(`[data-${attr}]`);
  if (!b) return;
  const v = +b.dataset[attr];
  const set = new Set(S[key]);
  if (e.shiftKey || e.metaKey || e.ctrlKey) { set.clear(); set.add(v); }
  else if (set.has(v)) { if (set.size > 1) set.delete(v); } else set.add(v);
  S[key] = [...set].sort((a, b) => a - b);
  viewChanged();
}

function writeControls() {
  $('server').value = S.server;
  $('cat').value = S.cat;
  if ($('cat').value !== S.cat) { S.cat = 'all'; $('cat').value = 'all'; }
  $('q').value = S.q;
  document.querySelectorAll('[data-tier]').forEach(b => b.setAttribute('aria-pressed', S.tiers.includes(+b.dataset.tier)));
  document.querySelectorAll('[data-ench]').forEach(b => b.setAttribute('aria-pressed', S.enchants.includes(+b.dataset.ench)));
  document.querySelectorAll('[data-set]').forEach(el => {
    const v = S[el.dataset.set];
    if (el.type === 'radio') el.checked = el.value === String(v);
    else if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  });
  document.querySelectorAll('input[name="show"]').forEach(r => { r.checked = r.value === S.show; });
  $('unpriced').checked = S.unpriced;
  $('sort').value = S.sort;
  $('f-custom').hidden = S.craftCity !== 'custom';
}

function viewChanged() {
  shown = PAGE; saveSettings();
  document.querySelectorAll('[data-tier]').forEach(b => b.setAttribute('aria-pressed', S.tiers.includes(+b.dataset.tier)));
  document.querySelectorAll('[data-ench]').forEach(b => b.setAttribute('aria-pressed', S.enchants.includes(+b.dataset.ench)));
  recompute();
  fetchSoon();
}

/* ---------- which items are in view ---------- */
function catSet() {
  if (S.cat === 'all') return null;
  if (S.cat.startsWith('g:')) {
    const g = D.groups.find(x => x.key === S.cat.slice(2));
    return new Set(g ? g.cats.map(c => c.key) : []);
  }
  return new Set([S.cat]);
}
function viewItems() {
  const cats = catSet(), q = S.q.trim().toLowerCase();
  const tiers = new Set(S.tiers), ench = new Set(S.enchants);
  return D.items.filter(it => (!cats || cats.has(it.c)) && tiers.has(it.t) && ench.has(it.e) && (!q || it.lc.includes(q) || it.id.toLowerCase().includes(q)));
}

/* ---------- prices ---------- */
function setStatus(text, kind) { const el = $('status'); el.textContent = text; el.className = 'status' + (kind ? ' ' + kind : ''); }
const fetchSoon = debounce(() => fetchPrices(false), 600);

async function fetchPrices(force) {
  if (!D) return;
  if (loading) loading.abort();
  const ctl = new AbortController();
  loading = ctl;
  const items = viewItems();
  const products = items.map(it => it.id);
  const res = new Set();
  for (const it of items) {
    for (const [id] of it.r) res.add(id);
    if (it.j) { res.add(it.j[0] + '_EMPTY'); res.add(it.j[0] + '_FULL'); }
  }
  const priceIds = [...products, ...res];
  const server = S.server;
  renderLinks(priceIds, products);
  const bar = $('progress'), fill = $('progressBar');
  $('refresh').disabled = true;
  lastError = null;
  try {
    const r = await M.update(server, MK, {
      priceIds, histIds: products, force, signal: ctl.signal,
      onProgress: (done, total) => {
        if (!total) return;
        bar.hidden = false; fill.style.width = (100 * done / total) + '%';
        setStatus(`Loading ${M.SERVERS[server].name} prices… ${done} of ${total}`, '');
        if (done && done % 4 === 0) recompute();
      }
    });
    if (ctl.signal.aborted) return;
    M.saveMarket(server, MK);
    setStatus(r.requests ? `${M.SERVERS[server].name} prices updated just now · ${priceIds.length.toLocaleString('en-US')} items` : statusLine(priceIds), r.requests ? 'ok' : '');
  } catch (e) {
    if (ctl.signal.aborted) return;
    M.saveMarket(server, MK);
    lastError = e;
    const why = e.kind === 'network'
      ? 'Couldn’t reach the Albion Online Data Project from your browser.'
      : `The Albion Online Data Project answered with an error (${esc(e.message)}).`;
    setStatus(why + ' Showing saved prices. See “Prices not loading?” below.', 'err');
  } finally {
    if (loading === ctl) { loading = null; bar.hidden = true; $('refresh').disabled = false; recompute(); }
  }
}

function statusLine(ids) {
  let newest = 0;
  for (const id of ids) if (MK.pAt[id] > newest) newest = MK.pAt[id];
  return `${M.SERVERS[S.server].name} prices from ${newest ? ago(newest) : 'nowhere yet'} · press Update prices to refresh`;
}

function renderLinks(priceIds, products) {
  const reqs = [...M.priceRequests(S.server, priceIds).map((r, i) => [r.url, `Prices ${i + 1}`]),
    ...M.historyRequests(S.server, products).map((r, i) => [r.url, `Sales history ${i + 1}`])];
  $('links').innerHTML = reqs.length
    ? reqs.map(([u, t]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} (${esc(M.SERVERS[S.server].name)})</a>`).join('')
    : '<span class="hint">Nothing to load for this view.</span>';
}

/* ---------- compute + render ---------- */
function recompute() {
  if (!D) return;
  const now = Date.now();
  view = viewItems();
  evals = view.map(it => C.evaluate(it, S, MK, D, now));
  renderSetupHints();
  renderTiles();
  renderList();
  if (detail && $('detail').open) renderDetailOut();
}

function renderSetupHints() {
  const lines = Object.keys(S.levels).filter(l => S.levels[l] && (S.levels[l].m || Object.values(S.levels[l].s || {}).some(Boolean))).length + Object.keys(S.fce).length;
  $('levelsNote').textContent = lines
    ? `Your levels are saved for ${lines} mastery line${lines > 1 ? 's' : ''}. Open an item to change them.`
    : 'Focus costs assume no Destiny Board levels. Open any item to enter your mastery and specialization levels.';
  $('clearLevels').hidden = !lines;
  $('craftHint').textContent = S.craftCity === 'auto'
    ? 'Each item is crafted where it gets a city bonus, e.g. swords in Lymhurst, bars in Thetford, potions in Brecilien.'
    : S.craftCity === 'custom' ? '' : bonusSummary(S.craftCity);
}

function bonusSummary(city) {
  const c = D.cities[city];
  if (!c) return '';
  const names = Object.entries(c.mods).map(([k, v]) => `${modName(k)} +${Math.round(v * 100)}%`);
  return names.length ? `${city} bonus: ${names.join(', ')}.` : '';
}
function modName(k) {
  const refine = { ore: 'metal bars', wood: 'planks', fiber: 'cloth', hide: 'leather', rock: 'stone' };
  if (refine[k]) return refine[k];
  if (k.startsWith('meat_')) return k.slice(5) + ' butchering';
  return (catName[k] || k.replace(/_/g, ' ')).toLowerCase();
}

function sortVal(e) {
  switch (S.sort) {
    case 'profitF': return e.fc ? e.profitF : e.profitN;
    case 'spf': return e.spf;
    case 'marginN': return e.marginN;
    case 'marginF': return e.fc ? e.marginF : e.marginN;
    case 'perDay': return e.perDay;
    case 'price': return e.sale ? e.sale.p : null;
    default: return e.profitN;
  }
}

function filtered() {
  let list = evals;
  if (!S.unpriced) list = list.filter(e => e.priced);
  if (S.show === 'profit') list = list.filter(e => e.status === 'profit');
  else if (S.show === 'focus') list = list.filter(e => e.status === 'focus');
  else if (S.show === 'loss') list = list.filter(e => e.status === 'loss');
  const dir = S.dir;
  if (S.sort === 'name') return list.slice().sort((a, b) => dir * a.item.name.localeCompare(b.item.name) || a.item.t - b.item.t || a.item.e - b.item.e);
  return list.slice().sort((a, b) => {
    if (a.priced !== b.priced) return a.priced ? -1 : 1;
    const x = sortVal(a), y = sortVal(b);
    if (!ok(x) && !ok(y)) return 0;
    if (!ok(x)) return 1;
    if (!ok(y)) return -1;
    return dir * (x - y);
  });
}

function renderTiles() {
  const priced = evals.filter(e => e.priced);
  const nProfit = priced.filter(e => e.status === 'profit').length;
  const nFocus = priced.filter(e => e.status === 'focus').length;
  let bestF = null, bestN = null;
  for (const e of priced) {
    if (ok(e.spf) && e.spf > 0 && (!bestF || e.spf > bestF.spf)) bestF = e;
    if (e.profitN > 0 && (!bestN || e.profitN > bestN.profitN)) bestN = e;
  }
  const pick = (e, k, v, s) => e
    ? `<button type="button" class="tile good" data-open="${esc(e.item.id)}"><span class="k">${k}</span><span class="n">${esc(e.item.name)} ${tierTag(e.item)}</span><span class="v">${v}</span><span class="s">${s}</span></button>`
    : `<div class="tile"><span class="k">${k}</span><span class="n dim">Nothing profitable here yet</span></div>`;
  $('tiles').innerHTML =
    `<div class="tile${nProfit ? ' good' : ''}"><span class="k">Profitable without focus</span><span class="v">${nProfit.toLocaleString('en-US')}</span><span class="s">of ${priced.length.toLocaleString('en-US')} items with prices</span></div>` +
    `<div class="tile${nFocus ? ' warn' : ''}"><span class="k">Profitable only with focus</span><span class="v">${nFocus.toLocaleString('en-US')}</span><span class="s">${(evals.length - priced.length).toLocaleString('en-US')} more have missing prices</span></div>` +
    pick(bestF, 'Best use of focus', bestF ? fmt1(bestF.spf) + ' silver / focus' : '', bestF ? `${fmtS(bestF.profitF)} per craft · ${fmt(bestF.fc)} focus` : '') +
    pick(bestN, 'Best profit without focus', bestN ? fmtS(bestN.profitN) : '', bestN ? `per craft · ${pct(bestN.marginN)} margin` : '');
}

function th(key, label, title) {
  const sorted = S.sort === key ? (S.dir < 0 ? 'descending' : 'ascending') : 'none';
  return `<th scope="col" data-sort="${key}" aria-sort="${sorted}"${title ? ` title="${esc(title)}"` : ''}><button type="button">${label}</button></th>`;
}

function renderList() {
  const list = filtered();
  const total = list.length;
  const rows = list.slice(0, shown);
  const where = S.craftCity === 'auto' ? 'each item in its bonus city' : S.craftCity === 'custom' ? 'your hideout' : S.craftCity;
  $('listSub').textContent = `${total.toLocaleString('en-US')} of ${evals.length.toLocaleString('en-US')} items · crafting in ${where} · sorted by ${SORT_TEXT[S.sort] || S.sort}`;
  if (!rows.length) {
    const why = !evals.length ? 'Nothing matches these filters. Try another category or more tiers.'
      : !evals.some(e => e.priced) && !S.unpriced ? (loading ? 'Loading prices…' : 'No prices yet for these items. Press Update prices, or tick “Show items with missing prices”.')
        : 'No items in this group. Try “All”.';
    $('list').innerHTML = `<p class="empty">${why}</p>`;
    $('more').hidden = true;
    return;
  }
  const body = rows.map(e => {
    const it = e.item;
    const sale = e.sale;
    const priceCell = sale
      ? `${fmt(sale.p)}<small${isStale(sale.at) ? ' class="stale"' : ''}>${esc(sale.city)}${sale.basis === 'average' ? ' · 7-day avg' : sale.at ? ' · ' + ago(sale.at) : ''}</small>`
      : '<span class="dim">no price</span>';
    const miss = e.missing.length ? `<small class="neg">${e.missing.length} resource price${e.missing.length > 1 ? 's' : ''} missing</small>` : '';
    const per = e.amount > 1 ? `<small>${e.amount} per craft</small>` : '';
    return `<tr data-id="${esc(it.id)}" tabindex="0" class="${e.priced ? '' : 'nodata'}">
      <td class="c-item"><div class="it">${icon(it.id)}<div class="it-main"><span class="it-name">${esc(it.name)}${tierTag(it)}</span><span class="it-sub" title="Return rate ${pct(e.rN)}${e.fc ? ', with focus ' + pct(e.rF) : ''}"><span class="pill ${e.status}">${STATUS_TEXT[e.status]}</span> ${esc(catName[it.c] || '')} · ${esc(e.craftCity === 'custom' ? 'hideout' : e.craftCity)}</span></div></div></td>
      <td class="num" data-l="Sells for">${priceCell}${per}</td>
      <td class="num" data-l="Cost / craft">${e.priced || !e.missing.length ? fmt(e.costN) : '—'}${miss}</td>
      <td class="num ${cls(e.priced ? e.profitN : null)}" data-l="Profit, no focus">${e.priced ? fmtS(e.profitN) : '—'}<small>${e.priced ? pct(e.marginN) : ''}</small></td>
      <td class="num ${cls(e.priced && e.fc ? e.profitF : null)}" data-l="Profit, focus">${e.fc ? (e.priced ? fmtS(e.profitF) : '—') : '<span class="dim" title="This recipe can’t use focus">n/a</span>'}<small>${e.priced && e.fc ? pct(e.marginF) : ''}</small></td>
      <td class="num" data-l="Silver / focus">${e.priced && e.fc ? fmt1(e.spf) : '—'}<small>${e.fc ? fmt(e.fc) + ' focus' : ''}</small></td>
      <td class="num" data-l="Sold / day">${ok(e.perDay) ? fmt1(e.perDay) : '—'}</td>
    </tr>`;
  }).join('');
  $('list').innerHTML = `<table><thead><tr>${th('name', 'Item')}${th('price', 'Sells for')}<th scope="col">Cost / craft</th>${th('profitN', 'Profit, no focus', 'Profit per craft without focus')}${th('profitF', 'Profit, focus', 'Profit per craft using focus')}${th('spf', 'Silver / focus')}${th('perDay', 'Sold / day', 'Average sold per day in the last 7 days')}</tr></thead><tbody>${body}</tbody></table>`;
  $('more').hidden = total <= shown;
  $('more').textContent = `Show more (${(total - shown).toLocaleString('en-US')} left)`;
}

/* ---------- item detail ---------- */
function openDetail(id) {
  const it = byId.get(id);
  if (!it) return;
  const e = C.evaluate(it, S, MK, D);
  detail = { id, N: detail && detail.id === id ? detail.N : 10, useFocus: !!e.fc };
  renderDetail();
  const dlg = $('detail');
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
  // Make sure we have prices for this item even if it's outside the current view
  if (!MK.pAt[id]) {
    M.update(S.server, MK, { priceIds: [id, ...it.r.map(r => r[0]), ...(it.j ? [it.j[0] + '_EMPTY', it.j[0] + '_FULL'] : [])], histIds: [id] })
      .then(() => { M.saveMarket(S.server, MK); recompute(); }).catch(() => {});
  }
}

function renderDetail() {
  const it = byId.get(detail.id);
  const e = C.evaluate(it, S, MK, D);
  const line = D.lines[it.l] || { name: it.l, mutual: 0 };
  const lv = S.levels[it.l] || {};
  const specs = (lineSpecs[it.l] || []).slice().sort((a, b) => (b.spec === it.s) - (a.spec === it.s) || a.name.localeCompare(b.name));
  const calKey = it.l + '|' + it.s;
  const ov = S.overrides[it.id];

  const recipeRows = e.rows.map((r, i) => `<tr data-row="${i}">
      <td><div class="it">${icon(r.id, true)}<div class="it-main"><span>${esc(resName(r.id))}${/@\d$/.test(r.id) ? ` <span class="tier">.${r.id.slice(-1)}</span>` : ''}${r.noReturn ? '<span class="tag">never returned</span>' : ''}</span></div></div></td>
      <td>${fmt(r.qty)}</td>
      <td><input type="number" min="0" step="1" inputmode="numeric" data-ov="${esc(r.id)}" value="${S.overrides[r.id] || ''}" placeholder="${r.unit && r.unit.how !== 'manual' ? Math.round(r.unit.u) : 'price'}" aria-label="Your price for ${esc(resName(r.id))}"></td>
      <td data-out="src"></td><td data-out="cN"></td><td data-out="cF"></td>
    </tr>`).join('');

  $('detailBody').innerHTML = `
    <div class="d-head">
      <div class="it">${icon(it.id)}<div class="it-main"><h2 id="d-title">${esc(it.name)}${tierTag(it)}</h2><span class="it-sub">${esc(catName[it.c] || '')} · ${esc(it.id)}</span></div></div>
      <button type="button" class="close" data-close aria-label="Close">×</button>
    </div>
    <div class="facts" id="d-facts"></div>
    <div class="cmp" id="d-cmp"></div>

    <section class="sec">
      <h3>Recipe, per craft</h3>
      <div class="tbl"><table>
        <thead><tr><th scope="col">Resource</th><th scope="col">Needs</th><th scope="col">Your price</th><th scope="col">Price used</th><th scope="col">Cost, no focus</th><th scope="col">Cost, focus</th></tr></thead>
        <tbody>${recipeRows}</tbody><tfoot id="d-recipe-foot"></tfoot>
      </table></div>
      <p class="hint">Type a price to use it instead of the market's, for example for resources you gathered yourself. Leave it empty to use market prices.</p>
    </section>

    <section class="sec">
      <h3>Selling</h3>
      <div class="row2">
        <div class="field"><label for="d-sell">Your sell price per item</label>
          <input type="number" id="d-sell" min="0" step="1" inputmode="numeric" data-ov="${esc(it.id)}" value="${ov || ''}" placeholder="${e.sale && e.sale.basis !== 'manual' ? Math.round(e.sale.p) : 'price'}"></div>
        <p class="hint">Market prices for this item. The highlighted row is the one used.</p>
      </div>
      <div class="tbl" id="d-cities"></div>
    </section>

    <section class="sec levels">
      <h3>Your levels: ${esc(line.name)}</h3>
      ${it.f ? `<div class="row2">
        <div class="field"><label for="d-mastery">${esc(line.name)} mastery</label><input type="number" id="d-mastery" min="0" max="100" step="1" inputmode="numeric" data-lv="m" value="${lv.m || ''}" placeholder="0"></div>
        <div class="field"><label for="d-cal">Focus per craft shown in game (optional)</label><input type="number" id="d-cal" min="1" step="1" inputmode="numeric" data-cal value="${S.fce[calKey] != null ? C.focusCost(it, S, D) : ''}" placeholder="${C.focusCost(it, S, D)}"></div>
      </div>
      <span class="lbl">Specializations in this mastery</span>
      <div class="spec-grid">${specs.map(sp => `<div class="field${sp.spec === it.s ? ' own' : ''}"><label for="sp-${esc(sp.spec)}">${esc(sp.name)}</label><input type="number" id="sp-${esc(sp.spec)}" min="0" max="100" step="1" inputmode="numeric" data-lv="${esc(sp.spec)}" value="${(lv.s || {})[sp.spec] || ''}" placeholder="0"></div>`).join('')}</div>
      <div class="callout" id="d-focus"></div>` : '<p class="hint">This recipe doesn’t use focus.</p>'}
    </section>

    <section class="sec">
      <h3>Plan a batch</h3>
      <div class="row2">
        <div class="field"><label for="d-n">Number of crafts</label><input type="number" id="d-n" min="0" step="1" inputmode="numeric" data-batch="N" value="${detail.N}"></div>
        ${it.f ? `<label class="check"><input type="checkbox" data-batch="useFocus"${detail.useFocus ? ' checked' : ''}><span>Use my focus<small>Focused crafts first, the rest at the normal return rate.</small></span></label>
        <button type="button" class="btn ghost" data-maxfocus>As many as my focus allows</button>` : ''}
      </div>
      <div id="d-batch"></div>
    </section>`;
  renderDetailOut();
}

function renderDetailOut() {
  const it = byId.get(detail.id);
  const e = C.evaluate(it, S, MK, D);
  const fc = C.focusCrafts(e, S);
  const craftAt = e.craftCity === 'custom' ? 'your hideout' : e.craftCity;
  $('d-facts').innerHTML = [
    `Craft in ${esc(craftAt)}`,
    `Production bonus ${Math.round(e.pb * 100)}%`,
    `Return ${pct(e.rN)}${it.f ? ' · with focus ' + pct(e.rF) : ''}`,
    `Buy in ${esc(S.buyCity === 'cheapest' ? 'the cheapest city' : e.buyCity)}`,
    `Sell in ${esc(e.sale ? e.sale.city : e.sellCity)}`,
    e.journal ? `Fills ${esc(resName(e.journal.id + '_EMPTY').replace(/ \(Empty\)$/, ''))}: ${fmt1(e.journal.perJournal)} crafts each` : '',
    e.amount > 1 ? `${e.amount} items per craft` : '',
    it.v ? `Item value ${fmt(it.v)}` : ''
  ].filter(Boolean).map(t => `<span class="fact">${t}</span>`).join('');

  const col = (title, focus) => {
    const cost = focus ? e.costF : e.costN, rev = focus ? e.revenueF : e.revenueN, pr = focus ? e.profitF : e.profitN;
    const m = focus ? e.marginF : e.marginN;
    const good = e.priced && pr > 0;
    return `<div class="cmp-col"><h3>${title}<span class="pill ${e.priced ? (good ? 'profit' : 'loss') : 'nodata'}">${e.priced ? (good ? 'Profitable' : 'Loss') : 'Missing prices'}</span></h3>
      <div class="kv"><span>Resources after returns</span><span>${fmt(cost - e.fee - e.silver)}</span></div>
      ${e.fee ? `<div class="kv"><span>Station fee</span><span>${fmt(e.fee)}</span></div>` : ''}
      ${e.silver ? `<div class="kv"><span>Silver cost</span><span>${fmt(e.silver)}</span></div>` : ''}
      ${e.journal ? `<div class="kv"><span>Journal, ${fmt1(e.journal.share * 100)}% of one per craft${S.journals ? '' : ' (off)'}</span><span class="${S.journals && e.journal.value != null ? cls(e.journal.value) : 'dim'}">${e.journal.value != null ? fmtS(e.journal.value) : 'no price'}</span></div>` : ''}
      <div class="kv"><span>You get after tax${(focus ? e.outF : e.outN) !== 1 ? ` (${fmt1(focus ? e.outF : e.outN)} items)` : ''}</span><span>${e.sale ? fmt(rev) : '—'}</span></div>
      <div class="kv big"><span>Profit per craft</span><span class="${cls(e.priced ? pr : null)}">${e.priced ? fmtS(pr) : '—'}</span></div>
      <div class="kv"><span>Margin</span><span>${e.priced ? pct(m) : '—'}</span></div>
      ${focus ? `<div class="kv"><span>Focus per craft</span><span>${fmt(e.fc)}</span></div>
        <div class="kv"><span>Silver per focus point</span><span>${e.priced ? fmt1(e.spf) : '—'}</span></div>
        <div class="kv"><span>Crafts your ${fmt(S.focus)} focus covers</span><span>${fmt(fc)}${e.priced ? ' · ' + fmtS(fc * e.profitF) : ''}</span></div>` : ''}
    </div>`;
  };
  $('d-cmp').innerHTML = col('Without focus', false) + (it.f ? col('With focus', true) : '');

  // recipe outputs
  e.rows.forEach((r, i) => {
    const tr = document.querySelector(`#detailBody tr[data-row="${i}"]`);
    if (!tr) return;
    const u = r.unit;
    const src = !u ? '<span class="neg">no price</span>'
      : u.how === 'free' ? '<span class="tag free">not traded, counted free</span>'
        : `${fmt(u.u)}<small${isStale(u.at) ? ' class="stale"' : ''}>${esc(u.city)}${u.how === 'order' ? ' · buy order' : ''}${u.at ? ' · ' + ago(u.at) : ''}</small>`;
    tr.querySelector('[data-out="src"]').innerHTML = `<span class="num">${src}</span>`;
    tr.querySelector('[data-out="cN"]').textContent = u ? fmt(r.useN * u.u) : '—';
    tr.querySelector('[data-out="cF"]').textContent = u && it.f ? fmt(r.useF * u.u) : '—';
    const inp = tr.querySelector('input[data-ov]');
    if (inp && u && u.how !== 'manual') inp.placeholder = Math.round(u.u);
  });
  $('d-recipe-foot').innerHTML = `<tr><td colspan="4">Total${e.missing.length ? ' (some prices missing)' : ''}</td><td>${fmt(e.costN - e.fee - e.silver)}</td><td>${it.f ? fmt(e.costF - e.fee - e.silver) : '—'}</td></tr>`;

  // markets for the product
  const P = MK.prices[it.id] || {}, H = MK.hist[it.id] || {};
  const used = e.sale ? e.sale.city : null;
  $('d-cities').innerHTML = `<table><thead><tr><th scope="col">Market</th><th scope="col">Lowest listing</th><th scope="col">Top buy order</th><th scope="col">7-day avg</th><th scope="col">Sold / day</th></tr></thead><tbody>${
    C.SELL_MARKETS.map(c => {
      const p = P[c] || {}, h = H[c] || {};
      const cell = (v, at) => (v ? `${fmt(v)}<small${isStale(at) ? ' class="stale"' : ''}>${ago(at)}</small>` : '<span class="dim">—</span>');
      return `<tr class="${c === used ? 'used' : ''}"><td>${esc(c)}</td><td class="num">${cell(p.s, p.sd)}</td><td class="num">${cell(p.b, p.bd)}</td><td class="num">${h.avg ? fmt(h.avg) : '<span class="dim">—</span>'}</td><td class="num">${ok(h.n) ? fmt1(h.n) : '—'}</td></tr>`;
    }).join('')}</tbody></table>`;
  const sellIn = $('d-sell');
  if (sellIn && e.sale && e.sale.basis !== 'manual') sellIn.placeholder = Math.round(e.sale.p);

  // focus
  const fBox = $('d-focus');
  if (fBox) {
    const calKey = it.l + '|' + it.s;
    const fce = C.fceFor(it, S, D);
    const cal = $('d-cal');
    if (cal && S.fce[calKey] == null) cal.placeholder = e.fc;
    fBox.innerHTML = S.fce[calKey] != null
      ? `Matched to the game: <b>${fmt(e.fc)}</b> focus per craft (efficiency ${fmt(fce)}), used for every tier and enchantment of ${esc(D.specs[calKey] || it.name)}. Clear the in-game box to go back to your levels.`
      : `Focus efficiency <b>${fmt(fce)}</b> → <b>${fmt(e.fc)}</b> focus per craft, down from ${fmt(it.f)}. Each mastery level gives 30, each level of this item's specialization 250, and every specialization level in ${esc((D.lines[it.l] || {}).name || '')} adds ${(D.lines[it.l] || {}).mutual || 0} to all of them.`;
  }

  // batch
  const b = C.batch(e, S, detail.N, detail.useFocus);
  const shop = b.rows.map(r => `<tr><td>${esc(resName(r.id))}${/@\d$/.test(r.id) ? ` <span class="tier">.${r.id.slice(-1)}</span>` : ''}</td><td>${fmt(r.buy)}</td><td>${r.unit ? fmt(r.unit.u) : '—'}</td><td>${r.unit ? fmt(r.total) : '—'}</td></tr>`).join('');
  $('d-batch').innerHTML = `
    <div class="batch-tiles">
      <div class="tile"><span class="k">You make</span><span class="v">${fmt(b.items)}</span><span class="s">${fmt(b.N)} craft${b.N === 1 ? '' : 's'}${b.Nf ? ` · ${fmt(b.Nf)} with focus` : ''}</span></div>
      ${e.journal ? `<div class="tile"><span class="k">Journals filled</span><span class="v">${fmt1(b.journalCount)}</span><span class="s">${S.journals && e.journal.value != null ? fmtS(b.journals) + ' after buying empties' : e.journal.value == null ? 'no journal prices' : 'not counted'}</span></div>` : ''}
      <div class="tile"><span class="k">Total cost</span><span class="v">${fmt(b.cost)}</span><span class="s">${b.extra ? fmt(b.extra) + ' in fees' : 'resources only'}</span></div>
      <div class="tile"><span class="k">You get after tax</span><span class="v">${e.sale ? fmt(b.revenue) : '—'}</span><span class="s">${e.sale ? fmt(e.sale.net) + ' each' : 'no sell price'}</span></div>
      <div class="tile ${e.priced ? (b.profit > 0 ? 'good' : '') : ''}"><span class="k">Profit</span><span class="v ${cls(e.priced ? b.profit : null)}">${e.priced ? fmtS(b.profit) : '—'}</span><span class="s">${b.focusUsed ? fmt(b.focusUsed) + ' focus used' : 'no focus used'}</span></div>
    </div>
    <div class="tbl"><table><thead><tr><th scope="col">Shopping list</th><th scope="col">Buy</th><th scope="col">Unit</th><th scope="col">Total</th></tr></thead><tbody>${shop}</tbody>
      <tfoot><tr><td colspan="3">Resources</td><td>${fmt(b.mat)}</td></tr></tfoot></table></div>
    <p class="hint">${e.priced && b.items ? `Break-even sell price ${fmt(b.breakEven)} per item. ` : ''}${ok(e.perDay) ? `About ${fmt1(e.perDay)} sell per day in ${esc(e.sellCity)}${b.items > e.perDay * 3 ? ', so this batch may take a while to sell.' : '.'}` : ''} Buy counts round up and assume returns land as expected; real returns vary a little craft to craft.</p>`;
}

function onDetailInput(ev) {
  const el = ev.target;
  if (!detail || !el.matches('input')) return;
  const it = byId.get(detail.id);
  if (el.dataset.ov != null) {
    const v = +el.value;
    if (v > 0) S.overrides[el.dataset.ov] = v; else delete S.overrides[el.dataset.ov];
  } else if (el.dataset.lv != null) {
    const lv = S.levels[it.l] || (S.levels[it.l] = { m: 0, s: {} });
    lv.s = lv.s || {};
    const v = Math.min(100, Math.max(0, Math.floor(+el.value || 0)));
    if (el.dataset.lv === 'm') lv.m = v; else if (v) lv.s[el.dataset.lv] = v; else delete lv.s[el.dataset.lv];
  } else if (el.dataset.cal != null) {
    const key = it.l + '|' + it.s;
    const v = +el.value;
    if (v > 0) S.fce[key] = C.fceFromGame(it, v); else delete S.fce[key];
  } else if (el.dataset.batch === 'N') {
    detail.N = Math.max(0, Math.floor(+el.value || 0));
  } else if (el.dataset.batch === 'useFocus') {
    detail.useFocus = el.checked;
  } else return;
  saveSettings();
  recompute();
}

function onDetailClick(ev) {
  if (ev.target.closest('[data-close]')) { $('detail').close(); return; }
  if (ev.target.closest('[data-maxfocus]')) {
    const e = C.evaluate(byId.get(detail.id), S, MK, D);
    detail.N = C.focusCrafts(e, S); detail.useFocus = true;
    $('d-n').value = detail.N;
    const cb = document.querySelector('#detailBody [data-batch="useFocus"]');
    if (cb) cb.checked = true;
    renderDetailOut();
  }
}

boot();
