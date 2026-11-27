// Refining planner: one resource at a time, every tier and enchantment, with live prices.
import * as C from './calc.js';
import * as M from './market.js';
import * as P from './profile.js';
import * as L from './levels.js';

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = n => n != null && Number.isFinite(n);
const fmt = n => (ok(n) ? Math.round(n).toLocaleString('en-US') : '—');
const fmtS = n => (ok(n) ? (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('en-US') : '—');
const fmt1 = n => (ok(n) ? (Math.abs(n) >= 100 ? fmt(n) : n.toFixed(1)) : '—');
const fmtS1 = n => (ok(n) ? (Math.abs(n) >= 100 ? fmtS(n) : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1)) : '—');
const pct = x => (ok(x) ? (x * 100).toFixed(1) + '%' : '—');
const cls = n => (!ok(n) ? 'muted' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function ago(t) {
  if (!t) return '';
  const m = Math.max(0, (Date.now() - t) / 60e3);
  if (m < 1) return 'now';
  if (m < 60) return Math.round(m) + 'm';
  if (m < 48 * 60) return Math.round(m / 60) + 'h';
  return Math.round(m / 1440) + 'd';
}

/* ---------- state ---------- */
const SHARED = 'aoc.settings.v1', OWN = 'aoc.refine.v1';
const OWN_DEFAULTS = { res: 'ore', buyMode: 'order', buyWhere: 'craft', sellBasis: 'listing', sellWhere: 'craft', daily: 0, fee: 400, view: 'n', sel: null, N: 1000, useFocus: false };
const RESOURCES = [
  { key: 'ore', name: 'Metal bars', raw: 'ore' }, { key: 'wood', name: 'Planks', raw: 'logs' }, { key: 'fiber', name: 'Cloth', raw: 'fiber' },
  { key: 'hide', name: 'Leather', raw: 'hide' }, { key: 'rock', name: 'Stone blocks', raw: 'stone' }
];
const read = k => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch { return {}; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

let D = null, shared = null, own = null, MK = null, loading = null;
let fillValue = 100; // last quick-fill level
let items = [];
const byId = new Map();
const resCity = {};

function saveShared() {
  const all = read(SHARED);
  for (const k of ['server', 'premium', 'focus', 'levels', 'fce', 'overrides']) all[k] = shared[k];
  write(SHARED, all);
  P.syncActive(shared);
  P.flashSaved(true);
}
const saveOwn = debounce(() => { write(OWN, own); P.flashSaved(true); }, 200);

// Settings for calc.js built from the shared and refining-only settings.
function settings(extra = {}) {
  return {
    ...C.DEFAULTS, maxAge: shared.maxAge ?? C.DEFAULTS.maxAge, premium: shared.premium, focus: shared.focus,
    levels: shared.levels, fce: shared.fce, overrides: shared.overrides,
    craftCity: 'auto', buyCity: own.buyWhere === 'cheapest' ? 'cheapest' : 'craft', sellCity: own.sellWhere === 'best' ? 'best' : 'craft',
    sellBasis: own.sellBasis, buyMode: own.buyMode, daily: +own.daily || 0, stationFee: +own.fee || 0, journals: false, ...extra
  };
}
const nameOf = id => D.names[id.replace(/@\d$/, '')] || id;
const resOf = it => it.c.replace('refine_', '');
const tag = it => `<span class="tag skip mono">${it.t}.${it.e}</span>`;

/* ---------- boot ---------- */
async function boot() {
  try {
    const res = await fetch('data/items.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    D = await res.json();
  } catch {
    setStatus('Couldn’t load data/items.json. Serve the folder over http.', 'err');
    return;
  }
  items = D.items.filter(i => i.rf);
  for (const it of items) byId.set(it.id, it);
  for (const r of RESOURCES) resCity[r.key] = Object.keys(D.cities).find(c => (D.cities[c].mods[r.key] || 0) >= 0.4) || 'Caerleon';
  shared = { ...C.DEFAULTS, server: 'europe', ...read(SHARED) };
  for (const k of ['levels', 'fce', 'overrides']) shared[k] = { ...(shared[k] || {}) };
  if (!M.SERVERS[shared.server]) shared.server = 'europe';
  own = { ...OWN_DEFAULTS, ...read(OWN) };
  MK = M.loadMarket(shared.server);
  wire();
  render();
  fetchPrices(false);
}

function setStatus(text, kind) { const el = $('status'); el.textContent = text; el.className = 'status' + (kind ? ' ' + kind : ''); }

async function fetchPrices(force) {
  if (loading) loading.abort();
  const ctl = new AbortController();
  loading = ctl;
  const ids = new Set();
  for (const it of items) { ids.add(it.id); for (const [r] of it.r) ids.add(r); }
  const server = shared.server;
  $('refresh').disabled = true;
  try {
    const r = await M.update(server, MK, {
      priceIds: [...ids], histIds: items.map(i => i.id), force, signal: ctl.signal,
      onProgress: (done, total) => {
        if (!total) return;
        $('progress').hidden = false; $('progressBar').style.width = (100 * done / total) + '%';
        setStatus(`Loading ${M.SERVERS[server].name} prices ${done}/${total}`, '');
      }
    });
    if (ctl.signal.aborted) return;
    M.saveMarket(server, MK);
    let newest = 0;
    for (const id of ids) if (MK.pAt[id] > newest) newest = MK.pAt[id];
    setStatus(`${M.SERVERS[server].name} · prices ${r.requests ? 'just updated' : ago(newest) + ' old'}`, r.requests ? 'ok' : '');
  } catch (e) {
    if (ctl.signal.aborted) return;
    setStatus(e.kind === 'network' ? 'Couldn’t reach the Albion Online Data Project. Showing saved prices.' : 'Price service error: ' + e.message, 'err');
  } finally {
    if (loading === ctl) { loading = null; $('progress').hidden = true; $('refresh').disabled = false; render(); }
  }
}

/* ---------- events ---------- */
function wire() {
  $('server').innerHTML = Object.entries(M.SERVERS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
  $('char').innerHTML = P.charOptions();
  $('char').addEventListener('change', e => {
    const changed = P.onCharPick(e.target.value, shared);
    $('char').innerHTML = P.charOptions();
    if (!changed) return;
    saveShared();
    if (loading) loading.abort();
    MK = M.loadMarket(shared.server); render(); fetchPrices(false);
  });
  $('server').addEventListener('change', e => {
    shared.server = e.target.value; saveShared();
    MK = M.loadMarket(shared.server); render(); fetchPrices(false);
  });
  $('refresh').addEventListener('click', () => fetchPrices(true));
  document.addEventListener('click', e => {
    const segBtn = e.target.closest('.seg[data-key] button[data-v]');
    if (segBtn) { own[segBtn.parentElement.dataset.key] = segBtn.dataset.v; saveOwn(); render(); return; }
    const fill = e.target.closest('[data-fill]');
    if (fill) { quickFill(fill.dataset.fill); return; }
    const tab = e.target.closest('[data-res]');
    if (tab) { own.res = tab.dataset.res; own.sel = null; saveOwn(); render(); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const it = byId.get(pick.dataset.pick);
      own.res = resOf(it); own.sel = it.id; saveOwn(); render();
      if (pick.closest('#focusPlan')) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (e.target.closest('[data-maxfocus]')) {
      const it = byId.get(own.sel), ev = C.evaluate(it, settings(), MK, D);
      own.N = C.focusCrafts(ev, settings()); own.useFocus = true; saveOwn(); render();
    }
  });
  $('fee').addEventListener('input', debounce(e => { own.fee = Math.max(0, +e.target.value || 0); saveOwn(); render(); }, 250));
  $('focus').addEventListener('input', debounce(e => { shared.focus = Math.max(0, +e.target.value || 0); saveShared(); render(); }, 250));
  $('premium').addEventListener('change', e => { shared.premium = e.target.checked; saveShared(); render(); });
  $('detail').addEventListener('input', debounce(onDetailInput, 500));
  $('detail').addEventListener('change', onDetailInput);
}

function quickFill(kind) {
  const it = byId.get(own.sel);
  if (!it) return;
  const box = $('detail').querySelector('[data-fillval]');
  fillValue = Math.min(100, Math.max(0, Math.floor(+(box && box.value) || 0)));
  if (kind === 'clear') L.clearLines(shared, [it.l]);
  else if (kind === 'line') L.fillLines(shared, D, [it.l], fillValue);
  else {
    const lines = L.linesInGroup(D, L.groupOf(D, it.c));
    if (!confirm(`Set the mastery and every tier for all ${lines.length} refining resources to ${fillValue}?`)) return;
    L.fillLines(shared, D, lines, fillValue);
  }
  saveShared();
  render();
}

function onDetailInput(ev) {
  const el = ev.target, it = byId.get(own.sel);
  if (!it || !el.matches('input')) return;
  if (el.dataset.ov != null) {
    const v = +el.value;
    if (v > 0) shared.overrides[el.dataset.ov] = v; else delete shared.overrides[el.dataset.ov];
    saveShared();
  } else if (el.dataset.lv != null) {
    const lv = shared.levels[it.l] || (shared.levels[it.l] = { m: 0, s: {} });
    lv.s = lv.s || {};
    const v = Math.min(100, Math.max(0, Math.floor(+el.value || 0)));
    if (el.dataset.lv === 'm') lv.m = v; else if (v) lv.s[el.dataset.lv] = v; else delete lv.s[el.dataset.lv];
    saveShared();
  } else if (el.dataset.cal != null) {
    const v = +el.value, key = it.l + '|' + it.s;
    if (v > 0) shared.fce[key] = C.fceFromGame(it, v); else delete shared.fce[key];
    saveShared();
  } else if (el.id === 'd-n') { own.N = Math.max(0, Math.floor(+el.value || 0)); saveOwn(); }
  else if (el.id === 'd-focus') { own.useFocus = el.checked; saveOwn(); }
  else return;
  render(true);
}

/* ---------- verdicts ---------- */
// What to do with this tier today, following the usual refining routine:
// profitable without focus -> refine it; only on a daily bonus day -> wait for the bonus;
// only with focus -> spend focus; otherwise skip.
function verdict(it, s) {
  const e = C.evaluate(it, s, MK, D);
  if (!e.priced) return { e, k: 'nodata', t: 'No price' };
  if (e.profitN > 0) return { e, k: 'go', t: 'No focus' };
  for (const add of [10, 20]) {
    if ((+own.daily || 0) >= add) continue;
    if (C.evaluate(it, { ...s, daily: add }, MK, D).profitN > 0) return { e, k: 'bonus', t: `+${add}% day` };
  }
  if (e.fc && e.profitF > 0) return { e, k: 'focus', t: 'Focus' };
  return { e, k: 'skip', t: 'Skip' };
}

/* ---------- render ---------- */
function render(detailOnly) {
  if (!D) return;
  const s = settings();
  const resItems = items.filter(i => resOf(i) === own.res);
  if (!own.sel || !byId.has(own.sel) || resOf(byId.get(own.sel)) !== own.res) {
    const best = resItems.map(i => C.evaluate(i, s, MK, D)).filter(e => e.priced).sort((a, b) => b.profitN - a.profitN)[0];
    own.sel = best ? best.item.id : (resItems.find(i => i.t === 4 && i.e === 0) || resItems[0]).id;
  }
  if (!detailOnly) {
    renderControls();
    renderMatrix(resItems, s);
    renderFocusPlan(s);
  }
  renderDetail(byId.get(own.sel), s);
}

function renderControls() {
  $('server').value = shared.server;
  $('tabs').innerHTML = RESOURCES.map(r => `<button type="button" class="tab" role="tab" data-res="${r.key}" aria-selected="${own.res === r.key}"><b>${r.name}</b><small>${esc(resCity[r.key])} +40%</small></button>`).join('');
  document.querySelectorAll('.seg[data-key]').forEach(seg => {
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(own[seg.dataset.key]) === b.dataset.v));
  });
  if (document.activeElement !== $('fee')) $('fee').value = own.fee;
  if (document.activeElement !== $('focus')) $('focus').value = shared.focus;
  $('premium').checked = !!shared.premium;
}

function renderMatrix(resItems, s) {
  const r = RESOURCES.find(x => x.key === own.res), city = resCity[own.res];
  const sample = resItems.find(i => i.t === 4) || resItems[0];
  const rt = C.rates(sample, city, s, D);
  $('mx-h').innerHTML = `${esc(r.name)} <span class="muted">· refined in ${esc(city)} · return ${pct(rt.rN)}, with focus ${pct(rt.rF)}</span>`;
  const tiers = [...new Set(resItems.map(i => i.t))].sort((a, b) => a - b);
  let html = '<span></span>' + [0, 1, 2, 3, 4].map(e => `<span class="h">.${e}</span>`).join('');
  for (const t of tiers) {
    html += `<span class="t">T${t}</span>`;
    for (let e = 0; e <= 4; e++) {
      const it = resItems.find(i => i.t === t && i.e === e);
      if (!it) { html += '<span class="cell none" aria-hidden="true">·</span>'; continue; }
      const v = verdict(it, s), ev = v.e;
      const main = own.view === 'f' ? (ev.priced && ev.fc ? fmtS1(ev.profitF) : '—')
        : own.view === 'spf' ? (ev.priced && ev.fc ? fmt1(ev.spf) : '—') : (ev.priced ? fmtS1(ev.profitN) : '—');
      const sub = own.view === 'spf' ? (ev.fc ? fmt(ev.fc) + ' focus' : '') : ev.priced ? pct(own.view === 'f' ? ev.marginF : ev.marginN) : '';
      const color = own.view === 'spf' ? '' : cls(ev.priced ? (own.view === 'f' ? ev.profitF : ev.profitN) : null);
      const pv = ev.priced ? (own.view === 'f' ? ev.profitF : ev.profitN) : null;
      html += `<button type="button" class="cell ${ok(pv) && own.view !== 'spf' ? (pv > 0 ? 'up' : 'down') : ''}" data-pick="${esc(it.id)}" aria-pressed="${it.id === own.sel}" aria-label="${esc(nameOf(it.id))} ${t}.${e}: ${v.t}, ${main}">
        <span class="tag ${v.k}">${v.t}</span><span class="v ${color}">${main}</span><span class="m">${sub}</span></button>`;
    }
  }
  $('matrix').innerHTML = html;
  const unit = own.res === 'rock' ? 'block' : own.res === 'ore' ? 'bar' : own.res === 'wood' ? 'plank' : 'unit';
  $('legend').innerHTML = `<span>Per ${unit}, ${own.buyMode === 'order' ? 'buying with buy orders' : 'buying instantly'}, ${own.sellBasis === 'listing' ? 'selling with a sell order' : 'selling instantly'}, station fee ${fmt(+own.fee)}.</span>
    <span><span class="tag go">No focus</span> profitable as is</span><span><span class="tag bonus">+20% day</span> only on a daily bonus day</span>
    <span><span class="tag focus">Focus</span> only with focus</span><span><span class="tag skip">Skip</span> loses silver</span>`;
}

function renderFocusPlan(s) {
  const focus = +shared.focus || 0;
  const list = items.map(i => C.evaluate(i, s, MK, D)).filter(e => e.priced && e.fc && e.profitF > 0).sort((a, b) => b.spf - a.spf).slice(0, 8);
  $('fpSub').textContent = `${fmt(focus)} focus · all resources`;
  $('focusPlan').innerHTML = list.length ? list.map(e => {
    const n = Math.floor(focus / e.fc), it = e.item;
    const slow = ok(e.perDay) && n > e.perDay * 3;
    return `<button type="button" class="focus-row rowline" data-pick="${esc(it.id)}">
      <span style="display:grid;gap:1px;min-width:0"><span><b>${esc(nameOf(it.id))}</b> ${tag(it)}</span>
        <span class="muted">${esc(resCity[resOf(it)])} · ${fmt(e.fc)} focus each · ${fmt(n)} with your focus${slow ? ' · <span class="neg">sells ~' + fmt1(e.perDay) + '/day</span>' : ''}</span></span>
      <span style="display:grid;justify-items:end"><span class="mono big">${fmt1(e.spf)}</span><span class="muted mono">${fmtS(n * e.profitF)}</span></span>
    </button>`;
  }).join('') + '<p class="note" style="padding-top:8px">Silver per focus point. Spend focus from the top; flat T4–T6 usually pay without it.</p>'
    : '<p class="note">No refine pays with focus at these prices yet.</p>';
}

function renderDetail(it, s) {
  const e = C.evaluate(it, s, MK, D);
  const city = resCity[resOf(it)];
  const name = nameOf(it.id);
  const recipe = it.r.map(([id, q]) => `${q} × ${esc(nameOf(id))}`).join(' + ');
  const P = MK.prices, H = MK.hist[it.id] || {};

  // Price table: every kind of price in every city, labeled
  const usingBuy = own.buyMode === 'order' ? 'buyorder' : 'listing';
  const plainS = { ...s, overrides: {} };
  const head = `<span class="h">Item</span><span class="h">Price</span>` + C.MARKETS.map(c => `<span class="h">${esc(c)}</span>`).join('');
  const row = (id, kind, label, used, sell) => {
    const vals = C.MARKETS.map(c => ({ c, x: C.marketPrice(MK, id, c, kind, plainS) }));
    const have = vals.filter(v => v.x).map(v => v.x.p), best = have.length ? (sell ? Math.max(...have) : Math.min(...have)) : 0;
    return `<span class="rl${used ? ' used' : ''}">${label}${used ? ' \u2713' : ''}</span>` +
      vals.map(v => `<span class="pc${v.x && v.x.p === best ? ' best' : ''}${v.c === city ? ' home' : ''}" title="${esc(v.c)}${v.x && v.x.at ? ', ' + ago(v.x.at) + ' old' : ''}">${v.x ? fmt(v.x.p) : '\u2014'}</span>`).join('');
  };
  const nmCell = (id, sub) => `<div class="nm" style="grid-row:span 2"><b>${esc(nameOf(id))}</b><small>${sub}</small>
    <input type="number" min="0" step="1" inputmode="numeric" data-ov="${esc(id)}" value="${shared.overrides[id] || ''}" placeholder="your own price" aria-label="Your own price for ${esc(nameOf(id))}"></div>`;
  const gridHtml = head + it.r.map(([id, q]) => nmCell(id, `${q} per refine`) + row(id, 'listing', 'Buy now', usingBuy === 'listing') + row(id, 'buyorder', 'Buy order', usingBuy === 'buyorder')).join('<span class="sep thin"></span>') +
    '<span class="sep"></span>' + nmCell(it.id, 'what you make') + row(it.id, 'listing', 'Sell order', own.sellBasis === 'listing', true) + row(it.id, 'buyorder', 'Sell now', own.sellBasis === 'buyorder', true);
  let local = 0, cheap = 0;
  for (const [id, q] of it.r) {
    const l = C.resourceUnit(MK, id, city, s), c = C.resourceUnit(MK, id, 'cheapest', s);
    if (l && c) { local += q * l.u; cheap += q * c.u; }
  }
  const saving = (local - cheap) * (1 - e.rN) * 1000;

  // Scenarios
  const scen = [['Your settings', {}, false], ['Your settings, with focus', {}, true]];
  if ((+own.daily || 0) < 10) scen.push(['Daily bonus +10%', { daily: 10 }, false]);
  if ((+own.daily || 0) < 20) scen.push(['Daily bonus +20%', { daily: 20 }, false], ['Daily bonus +20%, with focus', { daily: 20 }, true]);
  const scenRows = scen.map(([label, extra, focus], i) => {
    const x = Object.keys(extra).length ? C.evaluate(it, settings(extra), MK, D) : e;
    const cost = focus ? x.costF : x.costN, pr = focus ? x.profitF : x.profitN, m = focus ? x.marginF : x.marginN;
    if (focus && !x.fc) return '';
    return `<tr class="${i === 0 ? 'cur' : ''}"><td>${label}</td><td>${pct(focus ? x.rF : x.rN)}</td><td>${fmt1(cost)}</td><td class="${cls(x.priced ? pr : null)}">${x.priced ? fmtS1(pr) : '—'}</td><td>${x.priced ? pct(m) : '—'}</td><td class="${cls(x.priced ? pr : null)}">${x.priced ? fmtS(pr * 1000) : '—'}</td></tr>`;
  }).join('');

  // Batch
  const b = C.batch(e, s, own.N, own.useFocus);
  const byCity = {};
  b.rows.forEach(r => {
    const c = r.unit ? r.unit.city : '—';
    (byCity[c] || (byCity[c] = [])).push(`${fmt(r.buy)} × ${esc(nameOf(r.id))} <span class="muted mono">${r.unit ? '@ ' + fmt(r.unit.u) : 'no price'}</span>`);
  });
  const stops = Object.entries(byCity).map(([c, lines]) => `<div class="stop${c === city ? ' home' : ''}"><b>${esc(c)}${c === city ? ' · refine here' : ''}</b>
    <span class="muted">${own.buyMode === 'order' ? 'Place buy orders' : 'Buy'}</span>${lines.map(l => `<span>${l}</span>`).join('')}</div>`).join('');
  const sellAt = e.sale ? e.sale.city : city;
  const days = ok(e.perDay) && e.perDay > 0 ? b.items / e.perDay : null;

  // Levels
  const lv = shared.levels[it.l] || {}, calKey = it.l + '|' + it.s;
  const tiers = L.specsOf(D, it.l).sort();

  // Keep the cursor in the input being typed in across the re-render
  const act = document.activeElement;
  const keep = act && act.closest && act.closest('#detail') && act.matches('input')
    ? (act.id ? '#' + act.id : act.dataset.ov != null ? `[data-ov="${act.dataset.ov}"]` : act.dataset.lv != null ? `[data-lv="${act.dataset.lv}"]` : act.dataset.cal != null ? '[data-cal]' : null) : null;
  $('detail').innerHTML = `
    <div class="card-head">
      <h2 id="d-h">${esc(name)} ${tag(it)}</h2>
      <span class="muted">${recipe} · refine in ${esc(city)} · ${fmt(e.fc)} focus each · station fee ${fmt1(e.fee)} each</span>
    </div>

    <div class="scroll"><div class="mkt mkt7">${gridHtml}</div></div>
    <p class="note">Green is the best price in each row. Outlined is ${esc(city)}, where you refine. \u2713 marks the price the calculator uses; change it with <b>How you buy</b> and <b>How you sell</b> above.
      ${saving > 1 ? `Buying in the cheapest cities instead of ${esc(city)} saves about <b class="pos">${fmt(saving)}</b> per 1,000.` : ''}</p>
    <details class="help"><summary>What do these prices mean?</summary>
      <dl>
        <dt>Buy now</dt><dd>The cheapest price someone is selling for. You get it instantly.</dd>
        <dt>Buy order</dt><dd>The highest price someone is offering. Post your own order at about this price and wait for sellers. Usually cheaper; adds a 2.5% fee.</dd>
        <dt>Sell order</dt><dd>List at about the cheapest current price and wait for buyers. 2.5% fee plus tax.</dd>
        <dt>Sell now</dt><dd>Sell instantly to the highest buy order. Tax only, usually less money.</dd>
      </dl>
    </details>

    <div class="split" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div class="card" style="padding:0">
        <h3 style="font-size:13px">Profit per unit</h3>
        <div class="scroll"><table><thead><tr><th>Scenario</th><th>Return</th><th>Cost</th><th>Profit</th><th>Margin</th><th>Per 1,000</th></tr></thead><tbody>${scenRows}</tbody></table></div>
        <p class="note">Sells in ${esc(sellAt)} for ${e.sale ? fmt(e.sale.p) : '—'}${ok(e.perDay) ? ` · about ${fmt1(e.perDay)} sold a day` : ''}. Refining doesn’t fill laborer journals: in the game files they fill from gathering or from crafting gear, so there is no journal profit here.</p>
      </div>
      <div class="card" style="padding:0">
        <h3 style="font-size:13px">Plan a batch</h3>
        <div class="specs">
          <label><span class="muted">Units</span><input type="number" id="d-n" min="0" step="100" inputmode="numeric" value="${own.N}"></label>
          ${e.fc ? `<label><input type="checkbox" id="d-focus"${own.useFocus ? ' checked' : ''}><span>Use focus</span></label>
          <button type="button" class="btn" data-maxfocus>As many as my focus allows</button>` : ''}
        </div>
        <div class="stops">${stops}</div>
        <div class="kv"><span>Total cost (resources ${fmt(b.mat)} + station ${fmt(b.extra)})</span><span class="mono">${fmt(b.cost)}</span></div>
        <div class="kv"><span>Sell ${fmt(b.items)} in ${esc(sellAt)}, after tax</span><span class="mono">${e.sale ? fmt(b.revenue) : '—'}</span></div>
        <div class="kv big"><span>Profit</span><span class="mono ${cls(e.priced ? b.profit : null)}">${e.priced ? fmtS(b.profit) : '—'}</span></div>
        <div class="kv"><span>Focus used</span><span class="mono">${b.focusUsed ? fmt(b.focusUsed) + ' of ' + fmt(shared.focus) : 'none'}</span></div>
        ${days ? `<div class="kv"><span>Days to sell at the current pace</span><span class="mono${days > 3 ? ' neg' : ''}">${fmt1(days)}</span></div>` : ''}
      </div>
    </div>

    ${it.f ? `<div class="specs" style="padding:10px 12px;background:var(--panel2);border-radius:8px">
      <span class="lbl">Quick fill</span>
      <label>Level <input type="number" min="0" max="100" data-fillval value="${fillValue}" aria-label="Level to fill"></label>
      <button type="button" class="btn" data-fill="line">All ${esc(D.lines[it.l].name)} tiers</button>
      <button type="button" class="btn quiet" data-fill="group">All five resources</button>
      <button type="button" class="btn quiet" data-fill="clear">Clear ${esc(D.lines[it.l].name)}</button>
    </div>
    <div class="specs" aria-label="Refining levels">
      <span class="muted">${esc(D.lines[it.l].name)} levels</span>
      ${tiers.map(t => `<label${t === it.s ? ' style="color:var(--accent)"' : ''}>${t} <input type="number" min="0" max="100" data-lv="${t}" value="${(lv.s || {})[t] || ''}" placeholder="0"></label>`).join('')}
      ${it.s ? '' : `<span class="note">T${it.t} has no Destiny Board node; only T4 to T8 do.</span>`}
      <label>Focus per T${it.t} refine in game <input type="number" min="1" data-cal value="${shared.fce[calKey] != null ? e.fc : ''}" placeholder="${e.fc}"></label>
      <a href="profile.html">All your levels →</a>
    </div>` : ''}`;
  if (keep) { const el = $('detail').querySelector(keep); if (el) el.focus({ preventScroll: true }); }
}

boot();
