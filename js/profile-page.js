// "Your levels": every mastery and specialization on one page, saved in the browser.
import * as C from './calc.js';
import * as P from './profile.js';
import * as L from './levels.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = v => Math.min(100, Math.max(0, Math.floor(+v || 0)));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const STORE = 'aoc.settings.v1', ONBOARD = 'aoc.onboarded';
const read = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } };

let D = null, S = null;
const groups = [];   // [{ key, name, lines: [{ line, name, specs: [{ spec, name }] }] }]
const open = new Set(); // groups the user opened

function load() {
  const all = read();
  S = { levels: { ...(all.levels || {}) }, fce: { ...(all.fce || {}) }, focus: all.focus ?? C.DEFAULTS.focus, premium: all.premium ?? C.DEFAULTS.premium,
    server: all.server || 'europe', stationFee: all.stationFee ?? 0 };
}
const store = debounce(() => {
  const all = read();
  for (const k of P.KEYS) all[k] = S[k];
  let ok = true;
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { ok = false; }
  P.syncActive(all);
  P.flashSaved(ok);
}, 250);

async function boot() {
  try {
    const res = await fetch('data/items.json');
    if (!res.ok) throw new Error();
    D = await res.json();
  } catch {
    $('groups').innerHTML = '<p class="empty">Couldn’t load the item data. Serve the folder over http.</p>';
    return;
  }
  for (const g of D.groups) {
    const lines = L.linesInGroup(D, g);
    // keep the menu order of the group's categories
    const order = g.cats.map(c => c.key);
    lines.sort((a, b) => order.indexOf(firstCat(a)) - order.indexOf(firstCat(b)));
    groups.push({ key: g.key, name: g.name, lines: lines.map(line => ({
      line, name: (D.lines[line] || { name: line }).name,
      specs: L.specsOf(D, line).map(spec => ({ spec, name: D.specs[line + '|' + spec] }))
        .sort((a, b) => (/^T\d$/.test(a.spec) ? a.spec.localeCompare(b.spec) : a.name.localeCompare(b.name)))
    })) });
  }
  load();
  const welcome = new URLSearchParams(location.search).has('welcome');
  $('welcome').hidden = !welcome;
  try { localStorage.setItem(ONBOARD, '1'); } catch { /* ignore */ }
  if (welcome) open.add(groups[0].key);
  wire();
  render();
}
function firstCat(line) { const it = D.items.find(i => i.l === line); return it ? it.c : ''; }

function wire() {
  $('char').innerHTML = P.charOptions();
  $('char').addEventListener('change', e => {
    const changed = P.onCharPick(e.target.value, S);
    $('char').innerHTML = P.charOptions();
    if (changed) { store(); render(); }
  });
  $('focus').addEventListener('input', debounce(e => { S.focus = Math.max(0, +e.target.value || 0); store(); }, 300));
  $('premium').addEventListener('change', e => { S.premium = e.target.checked; store(); });
  $('q').addEventListener('input', debounce(render, 200));
  $('fillAllBtn').addEventListener('click', () => {
    const v = clamp($('fillAll').value), lines = groups.flatMap(g => g.lines.map(l => l.line));
    if (!confirm(`Set all ${lines.length} masteries and every specialization to ${v}?`)) return;
    L.fillLines(S, D, lines, v); store(); render();
  });
  $('clearAllBtn').addEventListener('click', () => {
    if (!confirm('Clear every level you entered for this character?')) return;
    L.clearLines(S, groups.flatMap(g => g.lines.map(l => l.line))); store(); render();
  });
  const g = $('groups');
  g.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.line == null || el.dataset.spec == null) return;
    const line = el.dataset.line, lv = S.levels[line] || (S.levels[line] = { m: 0, s: {} });
    lv.s = lv.s || {};
    const v = clamp(el.value);
    if (el.dataset.spec === 'm') lv.m = v; else if (v) lv.s[el.dataset.spec] = v; else delete lv.s[el.dataset.spec];
    if (!lv.m && !Object.keys(lv.s).length) delete S.levels[line];
    for (const k of Object.keys(S.fce)) if (k.startsWith(line + '|')) delete S.fce[k];
    store();
    updateLine(line);
  });
  g.addEventListener('click', e => {
    const b = e.target.closest('[data-fill]');
    if (!b) return;
    const v = clamp(b.closest('[data-fillbox]').querySelector('input').value);
    if (b.dataset.fill === 'line') L.fillLines(S, D, [b.dataset.target], v);
    else if (b.dataset.fill === 'clear') L.clearLines(S, [b.dataset.target]);
    else {
      const grp = groups.find(x => x.key === b.dataset.target);
      if (!confirm(`Set every ${grp.name} mastery (${grp.lines.length}) to ${v}?`)) return;
      L.fillLines(S, D, grp.lines.map(l => l.line), v);
    }
    store(); render();
  });
  g.addEventListener('toggle', e => {
    const d = e.target;
    if (d.matches && d.matches('details[data-group]')) { if (d.open) open.add(d.dataset.group); else open.delete(d.dataset.group); }
  }, true);
  document.querySelectorAll('[data-done]').forEach(a => a.addEventListener('click', () => { try { localStorage.setItem(ONBOARD, '1'); } catch { /* ignore */ } }));
}

/* ---------- focus effect ---------- */
function reduction(line, spec) {
  const key = line + '|' + spec;
  const lv = S.levels[line] || {}, specs = lv.s || {};
  const fce = S.fce[key] != null ? +S.fce[key]
    : C.FCE_MASTERY * clamp(lv.m) + C.FCE_SPEC * clamp(specs[spec]) + ((D.lines[line] || {}).mutual || 0) * Object.values(specs).reduce((a, v) => a + clamp(v), 0);
  return 1 - Math.pow(0.5, fce / 10000);
}
const isSet = line => { const lv = S.levels[line]; return !!(lv && (lv.m || Object.keys(lv.s || {}).length)) || Object.keys(S.fce).some(k => k.startsWith(line + '|')); };
const effectText = (line, spec) => { const r = reduction(line, spec); return r > 0.0005 ? `−${Math.round(r * 100)}% focus` : 'no reduction'; };

/* ---------- render ---------- */
function render() {
  if (!D) return;
  $('focus').value = S.focus; $('premium').checked = !!S.premium;
  const q = $('q').value.trim().toLowerCase();
  let total = 0, set = 0;
  const html = groups.map(g => {
    const lines = g.lines.filter(l => !q || l.name.toLowerCase().includes(q) || l.specs.some(s => s.name.toLowerCase().includes(q)) || g.name.toLowerCase().includes(q));
    total += g.lines.length; set += g.lines.filter(l => isSet(l.line)).length;
    if (!lines.length) return '';
    const done = g.lines.filter(l => isSet(l.line)).length;
    return `<details class="panel grp" data-group="${g.key}"${open.has(g.key) || q ? ' open' : ''}>
      <summary><span class="grp-name">${esc(g.name)}</span><span class="grp-count" data-count="${g.key}">${done} of ${g.lines.length} masteries set</span></summary>
      <div class="grp-body">
        <div class="specs fillrow" data-fillbox>
          <span class="lbl">Quick fill</span>
          <label>Level <input type="number" min="0" max="100" value="100" aria-label="Level for ${esc(g.name)}"></label>
          <button type="button" class="btn quiet" data-fill="group" data-target="${g.key}">Every ${esc(g.name)} mastery</button>
        </div>
        ${lines.map(l => lineCard(l, q)).join('')}
      </div>
    </details>`;
  }).join('');
  $('groups').innerHTML = html || '<p class="empty panel">Nothing matches that search.</p>';
  $('progress').textContent = `${set} of ${total} masteries have levels for ${P.loadChars().active || 'this browser'}. Everything saves as you type.`;
}

function lineCard(l, q) {
  const lv = S.levels[l.line] || {}, specs = lv.s || {};
  const calibrated = Object.keys(S.fce).filter(k => k.startsWith(l.line + '|')).length;
  return `<div class="line-card" data-card="${l.line}">
    <div class="line-head">
      <h3>${esc(l.name)}</h3>
      <div class="specs" data-fillbox>
        <label>Level <input type="number" min="0" max="100" value="100" aria-label="Level for ${esc(l.name)}"></label>
        <button type="button" class="btn quiet" data-fill="line" data-target="${l.line}">Fill ${esc(l.name)}</button>
        <button type="button" class="btn quiet" data-fill="clear" data-target="${l.line}">Clear</button>
      </div>
    </div>
    ${calibrated ? `<p class="note">${calibrated} item${calibrated > 1 ? 's use' : ' uses'} the focus cost you typed from the game. Changing a level here replaces it.</p>` : ''}
    <div class="spec-grid2">
      <label class="spec-cell mastery"><span>Mastery</span><input type="number" min="0" max="100" inputmode="numeric" data-line="${l.line}" data-spec="m" value="${lv.m || ''}" placeholder="0"><small>all items</small></label>
      ${l.specs.map(s => `<label class="spec-cell${q && s.name.toLowerCase().includes(q) ? ' hit' : ''}"><span>${esc(s.name)}</span><input type="number" min="0" max="100" inputmode="numeric" data-line="${l.line}" data-spec="${esc(s.spec)}" value="${specs[s.spec] || ''}" placeholder="0"><small data-eff="${esc(s.spec)}">${effectText(l.line, s.spec)}</small></label>`).join('')}
    </div>
  </div>`;
}

// After typing, refresh only the effect texts and counts (so the cursor stays put).
function updateLine(line) {
  const card = document.querySelector(`[data-card="${line}"]`);
  if (card) card.querySelectorAll('[data-eff]').forEach(el => { el.textContent = effectText(line, el.dataset.eff); });
  for (const g of groups) {
    const el = document.querySelector(`[data-count="${g.key}"]`);
    if (el) el.textContent = `${g.lines.filter(l => isSet(l.line)).length} of ${g.lines.length} masteries set`;
  }
  const total = groups.reduce((a, g) => a + g.lines.length, 0), set = groups.reduce((a, g) => a + g.lines.filter(l => isSet(l.line)).length, 0);
  $('progress').textContent = `${set} of ${total} masteries have levels for ${P.loadChars().active || 'this browser'}. Everything saves as you type.`;
}

boot();
