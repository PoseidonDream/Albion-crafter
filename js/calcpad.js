// A small calculator kept on the right of every page. Type or tap a sum: + − × ÷ ( ), k and m for
// thousands and millions (1.5m), and % after a number ("48000 - 6.5%" takes 6.5% off).
// Remembers whether it's open and the last few results in this browser.

const KEY = 'aoc.calc.v1';
const WIDE = '(min-width: 1500px)';

/* ---------- the maths (no eval) ---------- */
export function evaluate(text) {
  const src = String(text || '')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')        // 12,345 -> 12345
    .replace(/[×xX]/g, '*').replace(/[÷:]/g, '/').replace(/[−–]/g, '-').replace(/\s+/g, '');
  if (!src) return null;
  let i = 0;
  const peek = () => src[i];
  function expr() {
    let left = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = term();
      const v = r.pct ? left.v * r.v : r.v;          // a - 5% takes 5% of a
      left = { v: op === '+' ? left.v + v : left.v - v };
    }
    return left;
  }
  function term() {
    let left = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = factor();
      left = { v: op === '*' ? left.v * r.v : left.v / r.v };
    }
    return left;
  }
  function factor() {
    if (peek() === '-') { i++; const f = factor(); return { v: -f.v, pct: f.pct }; }
    if (peek() === '+') { i++; return factor(); }
    let v;
    if (peek() === '(') {
      i++;
      v = expr().v;
      if (peek() !== ')') throw new Error('missing )');
      i++;
    } else {
      const m = /^(\d+\.?\d*|\.\d+)([kmb])?/i.exec(src.slice(i));
      if (!m) throw new Error('number expected');
      i += m[0].length;
      v = parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1);
    }
    if (peek() === '%') { i++; return { v: v / 100, pct: true }; }
    return { v };
  }
  const out = expr();
  if (i < src.length) throw new Error('unexpected ' + src[i]);
  return Number.isFinite(out.v) ? out.v : null;
}

export function format(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  return v.toLocaleString('en-US', { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 4 : 6 });
}

/* ---------- the panel ---------- */
function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function store(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }

function mount() {
  if (document.getElementById('calcpad')) return;
  const st = { open: true, hist: [], ...load() };
  const keys = ['C', '(', ')', '⌫', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '%', '+', 'k', 'm', '='];
  document.body.insertAdjacentHTML('beforeend', `
    <aside class="calcpad" id="calcpad" aria-label="Calculator" hidden>
      <div class="cp-head"><b>Calculator</b><button type="button" class="cp-x" data-cp="close" aria-label="Hide the calculator" title="Hide">×</button></div>
      <input class="cp-in" type="text" autocomplete="off" spellcheck="false" aria-label="Sum to work out" placeholder="1250 × 48 − 6.5%">
      <div class="cp-out" aria-live="polite"><span class="cp-val">0</span><button type="button" class="cp-copy" data-cp="copy" title="Copy the result">Copy</button></div>
      <div class="cp-chips" title="Take off the market tax and fees">
        <button type="button" data-cp-add="-4%" title="Sell now with Premium: 4% tax">−4%</button>
        <button type="button" data-cp-add="-6.5%" title="Sell order with Premium: 4% tax + 2.5% setup fee">−6.5%</button>
        <button type="button" data-cp-add="-10.5%" title="Sell order without Premium: 8% tax + 2.5% setup fee">−10.5%</button>
      </div>
      <div class="cp-keys">${keys.map(k => `<button type="button" data-cp-key="${k}"${k === '=' ? ' class="eq"' : /[0-9.]/.test(k) ? ' class="n"' : ''}>${k}</button>`).join('')}</div>
      <ol class="cp-hist" aria-label="Earlier results"></ol>
    </aside>
    <button type="button" class="cp-open" id="calcOpen" data-cp="open" aria-controls="calcpad" title="Calculator">Calculator</button>`);
  const box = document.getElementById('calcpad'), input = box.querySelector('.cp-in'), out = box.querySelector('.cp-val');
  const opener = document.getElementById('calcOpen');
  const wide = matchMedia(WIDE), finePointer = matchMedia('(pointer: fine)');
  let floatingOpen = false;

  function layout() {
    const open = wide.matches ? st.open : floatingOpen;
    box.hidden = !open;
    opener.hidden = open;
    document.body.classList.toggle('cp-docked', wide.matches && st.open);
  }
  function show() {
    const r = safe(input.value);
    out.textContent = r.err ? r.err : format(r.v ?? 0);
    out.classList.toggle('err', !!r.err);
  }
  function safe(t) { try { return { v: evaluate(t) }; } catch (e) { return { err: t.trim() ? 'Check the sum' : '' }; } }
  function renderHist() {
    box.querySelector('.cp-hist').innerHTML = st.hist.map((h, i) => `<li><button type="button" data-cp-hist="${i}" title="Use this result"><span>${escape(h.t)}</span><b>${format(h.v)}</b></button></li>`).join('');
  }
  function commit() {
    const r = safe(input.value);
    if (r.err || r.v == null) { show(); return; }
    if (input.value.trim() !== String(r.v)) {
      st.hist = [{ t: input.value.trim(), v: r.v }, ...st.hist].slice(0, 8);
      store(st);
      renderHist();
    }
    input.value = String(Math.round(r.v * 1e6) / 1e6);
    show();
  }
  function insert(text) {
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, a) + text + input.value.slice(b);
    const at = a + text.length;
    if (finePointer.matches) { input.focus(); input.setSelectionRange(at, at); }
    show();
  }

  box.addEventListener('click', e => {
    const k = e.target.closest('[data-cp-key]'), add = e.target.closest('[data-cp-add]'), h = e.target.closest('[data-cp-hist]'), act = e.target.closest('[data-cp]');
    if (k) {
      const key = k.dataset.cpKey;
      if (key === 'C') { input.value = ''; show(); }
      else if (key === '⌫') { input.value = input.value.slice(0, -1); show(); }
      else if (key === '=') commit();
      else insert(key);
    } else if (add) { input.value = (input.value.trim() || '0') + ' ' + add.dataset.cpAdd.replace('-', '− '); commit(); }
    else if (h) { const x = st.hist[+h.dataset.cpHist]; if (x) insert(String(Math.round(x.v * 1e6) / 1e6)); }
    else if (act && act.dataset.cp === 'close') { if (wide.matches) { st.open = false; store(st); } else floatingOpen = false; layout(); opener.focus(); }
    else if (act && act.dataset.cp === 'copy') {
      const r = safe(input.value);
      if (r.v != null && navigator.clipboard) navigator.clipboard.writeText(String(Math.round(r.v))).then(() => { act.textContent = 'Copied'; setTimeout(() => { act.textContent = 'Copy'; }, 1200); }, () => {});
    }
  });
  opener.addEventListener('click', () => { if (wide.matches) { st.open = true; store(st); } else floatingOpen = true; layout(); if (finePointer.matches) input.focus(); });
  input.addEventListener('input', show);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { input.value = ''; show(); }
  });
  wide.addEventListener('change', layout);
  renderHist();
  layout();
  show();
}
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
}
