// Character profiles and moving them between devices. Everything stays in the browser:
// profiles live in localStorage, and a profile link carries one after the # (never sent to a server).

export const KEYS = ['levels', 'fce', 'focus', 'premium', 'server', 'stationFee'];
const CHARS = 'aoc.chars.v1';
const TAG = '#levels=';

const toB64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const clone = v => JSON.parse(JSON.stringify(v ?? null));
const pick = s => { const o = {}; for (const k of KEYS) if (s[k] != null) o[k] = clone(s[k]); return o; };

/* ---------- characters ---------- */

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

/* ---------- links ---------- */

export function profileLink(s) {
  const data = { v: 1, ...pick(s) };
  const c = loadChars();
  if (c.active) data.char = c.active;
  const page = location.pathname.replace(/[^/]*$/, '') + 'index.html';
  return location.origin + page + TAG + toB64(JSON.stringify(data));
}

// Settings carried by the current URL, or null. Removes them from the address bar.
export function takeProfileFromUrl() {
  if (!location.hash.startsWith(TAG)) return null;
  let data = null;
  try { data = JSON.parse(fromB64(location.hash.slice(TAG.length))); } catch { data = null; }
  history.replaceState(null, '', location.pathname + location.search);
  if (!data || data.v !== 1) return null;
  const out = {};
  for (const k of KEYS) if (k in data) out[k] = data[k];
  if (out.levels && typeof out.levels !== 'object') delete out.levels;
  if (out.fce && typeof out.fce !== 'object') delete out.fce;
  if (validName(data.char)) out.char = data.char;
  return out;
}

// Apply a profile from a link: becomes that character (added if new) or the current settings.
export function applyLinkedProfile(incoming, s) {
  const { char, ...rest } = incoming;
  const c = loadChars();
  if (c.active) c.chars[c.active] = pick(s);  // keep the character you had
  Object.assign(s, { levels: {}, fce: {} }, rest);
  if (char) c.active = char;
  if (c.active) c.chars[c.active] = pick(s);
  storeChars(c);
}

// Would applying this link overwrite levels already saved here?
export function linkWouldReplace(incoming, s) {
  const c = loadChars();
  if (incoming.char) return !!c.chars[incoming.char] && hasLevels(c.chars[incoming.char]);
  return hasLevels(s);
}

export const hasLevels = s => Object.keys(s.levels || {}).length > 0 || Object.keys(s.fce || {}).length > 0;

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
