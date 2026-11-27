// Quick fill for Destiny Board levels: set a whole mastery, or every mastery in a group, at once.
// Works on a settings object with `levels` ({ line: { m, s: { spec: level } } }) and `fce` (in-game calibrations).

const clamp = v => Math.min(100, Math.max(0, Math.floor(+v || 0)));

export const specsOf = (data, line) => Object.keys(data.specs).filter(k => k.startsWith(line + '|')).map(k => k.split('|')[1]);

export const groupOf = (data, cat) => data.groups.find(g => g.cats.some(c => c.key === cat)) || null;

// Mastery lines in a group that use focus (the only ones levels matter for).
export function linesInGroup(data, group) {
  const cats = new Set(group.cats.map(c => c.key));
  return [...new Set(data.items.filter(i => cats.has(i.c) && i.f).map(i => i.l))];
}

// Set the mastery and every specialization of each line to `value`. A calibration typed from the
// game would override the levels, so those are dropped for the lines being filled.
export function fillLines(s, data, lines, value) {
  const v = clamp(value);
  for (const line of lines) {
    dropCalibrations(s, line);
    if (!v) { delete s.levels[line]; continue; }
    const lv = { m: v, s: {} };
    for (const spec of specsOf(data, line)) lv.s[spec] = v;
    s.levels[line] = lv;
  }
  return v;
}

export function clearLines(s, lines) {
  for (const line of lines) { delete s.levels[line]; dropCalibrations(s, line); }
}

function dropCalibrations(s, line) {
  for (const k of Object.keys(s.fce || {})) if (k.startsWith(line + '|')) delete s.fce[k];
}
