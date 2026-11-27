// Character profiles, saved in this browser (localStorage). Nothing is sent anywhere.

export const KEYS = ['levels', 'fce', 'focus', 'premium', 'server', 'stationFee'];
const CHARS = 'aoc.chars.v1';

const clone = v => JSON.parse(JSON.stringify(v ?? null));
const pick = s => { const o = {}; for (const k of KEYS) if (s[k] != null) o[k] = clone(s[k]); return o; };

export function loadChars() {
  try {
    const c = JSON.parse(localStorage.getItem(CHARS) || 'null');
    if (c && c.chars && typeof c.chars === 'object') return { active: c.active && c.chars[c.active] ? c.active : null, chars: c.chars };
  } catch { /* ignore */ }
  return { active: null, chars: {} };
}
function storeChars(c) { try { localStorage.setItem(CHARS, JSON.stringify(c)); } catch { /* ignore */ } }

// Albion names: letters and digits, 3 to 16 characters.
export const validName = n => /^[A-Za-z0-9]{3,16}$/.test(String(n || '').trim());

// Keep the active character's saved copy up to date with the settings being used.
export function syncActive(s) {
  const c = loadChars();
  if (!c.active) return;
  c.chars[c.active] = pick(s);
  storeChars(c);
}

// Add a character. The first one keeps the levels already entered in this browser.
export function addChar(name, s) {
  const c = loadChars();
  name = name.trim();
  if (c.active) c.chars[c.active] = pick(s);
  if (!c.chars[name]) c.chars[name] = Object.keys(c.chars).length ? { ...pick(s), levels: {}, fce: {} } : pick(s);
  c.active = name;
  storeChars(c);
  Object.assign(s, clone(c.chars[name]));
  return name;
}

// Switch to another character: save the current one, load the other into the settings object.
export function switchChar(name, s) {
  const c = loadChars();
  if (!c.chars[name]) return false;
  if (c.active) c.chars[c.active] = pick(s);
  c.active = name;
  storeChars(c);
  Object.assign(s, { levels: {}, fce: {} }, clone(c.chars[name]));
  return true;
}

export function removeChar(name) {
  const c = loadChars();
  delete c.chars[name];
  if (c.active === name) c.active = Object.keys(c.chars)[0] || null;
  storeChars(c);
  return c.active;
}

// <option>s for a character picker
export function charOptions() {
  const c = loadChars(), names = Object.keys(c.chars).sort((a, b) => a.localeCompare(b));
  const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  let html = names.length ? '' : '<option value="" selected>No character yet</option>';
  html += names.map(n => `<option value="${esc(n)}"${n === c.active ? ' selected' : ''}>${esc(n)}</option>`).join('');
  html += '<option value="__add">+ Add a character…</option>';
  if (c.active) html += `<option value="__remove">Remove ${esc(c.active)}…</option>`;
  return html;
}

// Handle a change on a character picker. Returns true when the settings changed.
export function onCharPick(value, s) {
  if (value === '__add') {
    const name = prompt('Your Albion character name');
    if (name == null) return false;
    if (!validName(name)) { alert('Albion names are 3 to 16 letters or digits.'); return false; }
    addChar(name, s);
    return true;
  }
  if (value === '__remove') {
    const c = loadChars();
    if (!c.active || !confirm(`Remove ${c.active} and the levels saved for it in this browser?`)) return false;
    const next = removeChar(c.active);
    Object.assign(s, { levels: {}, fce: {} }, next ? clone(loadChars().chars[next]) : {});
    return true;
  }
  return value ? switchChar(value, s) : false;
}

// Show "Saved" briefly next to the character picker.
let flashTimer = null;
export function flashSaved(ok = true) {
  const el = document.getElementById('saved');
  if (!el) return;
  el.textContent = ok ? '✓ Saved' : 'Not saved: browser storage is off';
  el.className = 'saved on' + (ok ? '' : ' err');
  clearTimeout(flashTimer);
  if (ok) flashTimer = setTimeout(() => { el.className = 'saved'; }, 1800);
}
