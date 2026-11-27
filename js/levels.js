// Quick fill for Destiny Board levels: set a whole mastery, or every mastery in a group, at once.
// Works on a settings object with `levels` ({ line: { m, s: { spec: level } } }) and `fce` (in-game calibrations).

const clamp = v => Math.min(100, Math.max(0, Math.floor(+v || 0)));

export const specsOf = (data, line) => Object.keys(data.specs).filter(k => k.startsWith(line + '|')).map(k => k.split('|')[1]);

export const groupOf = (data, cat) => data.groups.find(g => g.cats.some(c => c.key === cat)) || null;

// Mastery lines in a group that use focus (the only ones levels matter for).
export function linesInGroup(data, group) {
  const cats = new Set(group.cats.map(c => c.key));
  return [...new Set(data.items.filter(i => cats.has(i.c) && i.f && !(data.lines[i.l] || {}).noLevels).map(i => i.l))];
}

// Set the mastery and every specialization of each line to `value`. A calibration typed from the
// game would override the levels, so those are dropped for the lines being filled.
export function fillLines(s, data, lines, value) {
  const v = clamp(value);
  for (const line of lines) {
    dropCalibrations(s, line);
    if (!v) { delete s.levels[line]; continue; }
    const lv = { m: (data.lines[line] || {}).mastery === false ? 0 : v, s: {} };
    for (const spec of specsOf(data, line)) lv.s[spec] = v;
    s.levels[line] = lv;
  }
  return v;
}

export function clearLines(s, lines) {
  for (const line of lines) { delete s.levels[line]; dropCalibrations(s, line); }
}

// A link can carry levels: #char=Name&set=refine_ore.T4:100,potion.m:100,potion.HEAL:38
// (`m` is the mastery). Entries that aren't a real mastery or specialization are skipped.
export function parseLevelHash(data, hash) {
  const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const set = h.get('set');
  if (!set) return null;
  const levels = {};
  let count = 0;
  for (const part of set.split(',')) {
    const m = /^([a-z_]+)\.([A-Za-z0-9_]+):(\d{1,3})$/.exec(part.trim());
    if (!m) continue;
    const [, line, spec, raw] = m, info = data.lines[line];
    if (!info || info.noLevels) continue;
    if (spec === 'm' ? info.mastery === false : !data.specs[line + '|' + spec]) continue;
    const lv = levels[line] || (levels[line] = { m: 0, s: {} }), v = clamp(raw);
    if (spec === 'm') lv.m = v; else if (v) lv.s[spec] = v; else delete lv.s[spec];
    count++;
  }
  return count ? { name: (h.get('char') || '').trim(), levels, count } : null;
}

export function levelHash(name, levels) {
  const parts = [];
  for (const [line, lv] of Object.entries(levels)) {
    if (lv.m) parts.push(`${line}.m:${lv.m}`);
    for (const [spec, v] of Object.entries(lv.s || {})) if (v) parts.push(`${line}.${spec}:${v}`);
  }
  return `#${name ? 'char=' + encodeURIComponent(name) + '&' : ''}set=${parts.join(',')}`;
}

// Put a link's levels in. Each mastery it names is replaced as a whole; the others stay as they are.
export function applyLevels(s, levels) {
  for (const [line, lv] of Object.entries(levels)) {
    dropCalibrations(s, line);
    if (lv.m || Object.keys(lv.s).length) s.levels[line] = { m: lv.m, s: { ...lv.s } };
    else delete s.levels[line];
  }
}

function dropCalibrations(s, line) {
  for (const k of Object.keys(s.fce || {})) if (k.startsWith(line + '|')) delete s.fce[k];
}
