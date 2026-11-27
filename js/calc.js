// Crafting math. Pure functions only, so they can be tested in Node (see tools/test-calc.mjs).
//
// Settings object `s` (all optional, see DEFAULTS):
//   craftCity  'auto' | a city name | 'custom'     where you craft
//   customBonus  production bonus in % when craftCity is 'custom' (hideout, island)
//   buyCity    'craft' | 'cheapest' | a market     where you buy resources
//   sellCity   'craft' | 'best' | a market         where you sell
//   sellBasis  'listing' | 'buyorder' | 'average'  which price you sell at
//   buyMode    'instant' | 'order'                 how you buy resources
//   premium, daily (0/10/20), stationFee (silver per 100 nutrition), maxAge (hours, 0 = any)
//   levels { line: { m: mastery, s: { spec: level } } }, fce { 'line|spec': efficiency }
//   overrides { marketId: price }                  prices you typed in yourself
//   journals   true to add laborer journal profit (crafting gear fills Blacksmith, Fletcher, Imbuer, Tinker journals)
//   buyPlan    { resourceId: city } to buy given resources in given cities (see routePlan)
// Market object `m`: { prices: { id: { city: { s, sd, b, bd } } }, hist: { id: { city: { avg, n } } } }
//   s = lowest sell listing, b = highest buy order, sd/bd = when seen (ms), avg/n = 7-day average and sold per day.

export const MARKETS = ['Caerleon', 'Bridgewatch', 'Fort Sterling', 'Lymhurst', 'Martlock', 'Thetford', 'Brecilien'];
export const SELL_MARKETS = [...MARKETS, 'Black Market'];
export const FOCUS_BONUS = 0.59;          // production bonus from using focus
export const SETUP_FEE = 0.025;           // placing a sell or buy order
export const NUTRITION_PER_VALUE = 0.1125; // station nutrition used per point of item value
export const FCE_MASTERY = 30, FCE_SPEC = 250;

export const DEFAULTS = {
  craftCity: 'auto', customBonus: 25, buyCity: 'craft', sellCity: 'craft', sellBasis: 'listing', buyMode: 'instant',
  premium: true, daily: 0, stationFee: 0, maxAge: 48, focus: 10000, levels: {}, fce: {}, overrides: {}, journals: true
};

export const returnRate = pb => (pb > -1 ? 1 - 1 / (1 + pb) : 0);
export const tax = s => (s.premium ? 0.04 : 0.08);
const lvl = v => Math.min(100, Math.max(0, Math.floor(+v || 0)));
const FREE = /^T\d_FACTION_.+_TOKEN_\d$/; // faction points: earned, not traded

/* ---------- cities and return rates ---------- */

// Bonus a city gives this item: refining uses the refining base, everything else the crafting base.
export function cityBonus(item, city, data) {
  const c = data.cities[city];
  if (!c) return 0;
  return (item.rf ? c.refine : c.craft) + (c.mods[item.cc] || 0);
}

// 'auto' picks the market city with the biggest bonus for the item (ties keep MARKETS order).
export function craftCityFor(item, s, data) {
  if (s.craftCity !== 'auto') return s.craftCity;
  let best = null, bestV = -1;
  for (const c of MARKETS) {
    const v = cityBonus(item, c, data);
    if (v > bestV + 1e-9) { best = c; bestV = v; }
  }
  return best || 'Caerleon';
}

export function productionBonus(item, city, s, data) {
  const base = city === 'custom' ? (+s.customBonus || 0) / 100 : cityBonus(item, city, data);
  return base + (+s.daily || 0) / 100;
}

export function rates(item, city, s, data) {
  const pb = productionBonus(item, city, s, data);
  return { pb, pbF: pb + FOCUS_BONUS, rN: returnRate(pb), rF: returnRate(pb + FOCUS_BONUS) };
}

/* ---------- focus ---------- */

// Focus cost efficiency: 30 per mastery level, 250 per level of the item's own specialization,
// plus the line's shared bonus for every specialization level you have in the line (own included).
export function fceFor(item, s, data) {
  const key = item.l + '|' + item.s;
  if (s.fce && s.fce[key] != null) return +s.fce[key];
  const lv = (s.levels || {})[item.l] || {};
  const specs = lv.s || {};
  const total = Object.values(specs).reduce((a, v) => a + lvl(v), 0);
  const mutual = (data.lines[item.l] || {}).mutual || 0;
  const line = data.lines[item.l] || {};
  if (line.noLevels) return 0;
  // Refining has no mastery level on the Destiny Board, only its T4 to T8 nodes
  const mastery = line.mastery === false ? 0 : FCE_MASTERY * lvl(lv.m);
  return mastery + (item.s ? FCE_SPEC * lvl(specs[item.s]) : 0) + mutual * total;
}

export function focusCost(item, s, data) {
  if (!item.f) return 0;
  return Math.max(1, Math.round(item.f * Math.pow(0.5, fceFor(item, s, data) / 10000)));
}

// Efficiency that turns the item's base focus into the cost you see in game.
export function fceFromGame(item, seenCost) {
  if (!item.f || !(seenCost > 0)) return null;
  return Math.max(0, Math.round(10000 * Math.log2(item.f / seenCost)));
}

/* ---------- prices ---------- */

function fresh(at, s, now) {
  if (!s.maxAge) return true;
  return at && now - at <= s.maxAge * 3600e3;
}

// One market price. basis: 'listing' (lowest sell order), 'buyorder' (highest buy order), 'average' (7-day).
export function marketPrice(m, id, city, basis, s, now = Date.now()) {
  if (basis === 'average') {
    const h = ((m.hist || {})[id] || {})[city];
    return h && h.avg > 0 ? { p: h.avg, at: null, n: h.n } : null;
  }
  const q = ((m.prices || {})[id] || {})[city];
  if (!q) return null;
  const p = basis === 'buyorder' ? q.b : q.s, at = basis === 'buyorder' ? q.bd : q.sd;
  return p > 0 && fresh(at, s, now) ? { p, at } : null;
}

// Cost of one unit of a resource bought in `city`. Buy orders add the setup fee; with no buy
// order up, the lowest listing is used.
function unitIn(m, id, city, s, now) {
  if (s.buyMode === 'order') {
    const b = marketPrice(m, id, city, 'buyorder', s, now);
    if (b) return { u: b.p * (1 + SETUP_FEE), at: b.at, city, how: 'order' };
  }
  const l = marketPrice(m, id, city, 'listing', s, now);
  return l ? { u: l.p, at: l.at, city, how: 'listing' } : null;
}

export function resourceUnit(m, id, buyCity, s, now = Date.now()) {
  const o = (s.overrides || {})[id];
  if (o > 0) return { u: +o, city: 'your price', how: 'manual' };
  if (FREE.test(id)) return { u: 0, city: '—', how: 'free' };
  if (buyCity === 'cheapest') {
    let best = null;
    for (const c of MARKETS) {
      const x = unitIn(m, id, c, s, now);
      if (x && (!best || x.u < best.u)) best = x;
    }
    return best;
  }
  return unitIn(m, id, buyCity, s, now);
}

// What one item sells for in `city`, before and after tax and fees.
function saleIn(m, id, city, s, now) {
  const basis = city === 'Black Market' && s.sellBasis === 'listing' ? 'buyorder' : s.sellBasis;
  const x = marketPrice(m, id, city, basis, s, now);
  if (!x) return null;
  const net = x.p * (1 - tax(s) - (basis === 'buyorder' ? 0 : SETUP_FEE));
  return { p: x.p, net, at: x.at, city, basis };
}

export function salePrice(m, id, sellCity, s, now = Date.now()) {
  const o = (s.overrides || {})[id];
  if (o > 0) {
    const basis = s.sellBasis;
    return { p: +o, net: o * (1 - tax(s) - (basis === 'buyorder' ? 0 : SETUP_FEE)), city: 'your price', basis: 'manual' };
  }
  if (sellCity === 'best') {
    let best = null;
    for (const c of SELL_MARKETS) {
      const x = saleIn(m, id, c, s, now);
      if (x && (!best || x.net > best.net)) best = x;
    }
    return best;
  }
  return saleIn(m, id, sellCity, s, now);
}

/* ---------- laborer journals ---------- */

// Each craft of a listed item adds a fixed amount of fame to the matching journal, so a craft is
// worth share x (what a full journal sells for after tax - what an empty one costs).
export function journalValue(item, s, m, buyCity, sellCity, now = Date.now()) {
  if (!item.j) return null;
  const [id, fame, max] = item.j;
  const share = Math.min(1, fame / max);
  const empty = resourceUnit(m, id + '_EMPTY', buyCity, s, now);
  const full = salePrice(m, id + '_FULL', sellCity === 'Black Market' ? buyCity : sellCity, s, now);
  return { id, fame, max, share, perJournal: Math.round(1 / share * 100) / 100, empty, full,
    value: empty && full ? share * (full.net - empty.u) : null };
}

/* ---------- one craft ---------- */

export function evaluate(item, s, m, data, now = Date.now()) {
  const craftCity = craftCityFor(item, s, data);
  const buyCity = s.buyCity === 'craft' ? (craftCity === 'custom' ? 'Caerleon' : craftCity) : s.buyCity;
  const sellCity = s.sellCity === 'craft' ? (craftCity === 'custom' ? 'Caerleon' : craftCity) : s.sellCity;
  const r = rates(item, craftCity, s, data);
  const missing = [];
  let costN = 0, costF = 0;
  const rows = item.r.map(([id, qty, noReturn]) => {
    const unit = resourceUnit(m, id, (s.buyPlan && s.buyPlan[id]) || buyCity, s, now);
    if (!unit) missing.push(id);
    const u = unit ? unit.u : 0;
    // With product return (butchering) the resources stay consumed and you get extra product instead.
    const keepsAll = noReturn || item.pr;
    const useN = keepsAll ? qty : qty * (1 - r.rN), useF = keepsAll ? qty : qty * (1 - r.rF);
    costN += useN * u; costF += useF * u;
    return { id, qty, noReturn: !!noReturn, unit, useN, useF };
  });
  const amount = item.a || 1;
  const outN = item.pr ? amount * (1 + r.pb) : amount;
  const outF = item.pr ? amount * (1 + r.pbF) : amount;
  const sale = salePrice(m, item.id, sellCity, s, now);
  const net = sale ? sale.net : 0;
  const fee = (item.v || 0) * NUTRITION_PER_VALUE * (+s.stationFee || 0) / 100;
  const extra = fee + (item.$ || 0);
  const fc = focusCost(item, s, data);
  const journal = journalValue(item, s, m, buyCity, sellCity, now);
  const jv = s.journals && journal && journal.value != null ? journal.value : 0;
  const profitN = outN * net - costN - extra + jv;
  const profitF = fc ? outF * net - costF - extra + jv : null;
  const priced = !missing.length && !!sale;
  const hist = ((m.hist || {})[item.id] || {})[sale && SELL_MARKETS.includes(sale.city) ? sale.city : sellCity] || null;
  let status = 'nodata';
  if (priced) status = profitN > 0 ? 'profit' : profitF > 0 ? 'focus' : 'loss';
  return {
    item, craftCity, buyCity, sellCity: sale && SELL_MARKETS.includes(sale.city) ? sale.city : sellCity,
    ...r, rows, missing, sale, amount, outN, outF, fee, silver: item.$ || 0, journal, jv,
    costN: costN + extra, costF: costF + extra, revenueN: outN * net, revenueF: outF * net,
    profitN, profitF, fc, spf: fc && priced ? profitF / fc : null,
    marginN: costN + extra > 0 ? profitN / (costN + extra) : 0,
    marginF: fc && costF + extra > 0 ? profitF / (costF + extra) : 0,
    perDay: hist ? hist.n : null, avg: hist ? hist.avg : null, priced, status
  };
}

/* ---------- buying on a route ---------- */

// Cheapest way to buy a recipe when you shop in the craft city plus at most `extra` other markets
// (extra >= 6 means anywhere). Returns { plan: { resourceId: city }, home, cities: [other cities used] }.
// Ties go to fewer cities. Resources you priced yourself, or that aren't traded, need no city.
export function routePlan(item, s, data, m, extra = 0, now = Date.now()) {
  const craft = craftCityFor(item, s, data);
  const home = MARKETS.includes(craft) ? craft : (MARKETS.includes(s.buyCity) ? s.buyCity : 'Caerleon');
  const r = rates(item, craft, s, data);
  const res = item.r.filter(([id]) => !((s.overrides || {})[id] > 0) && !FREE.test(id)).map(([id, qty, noReturn]) => {
    const prices = {};
    for (const c of MARKETS) { const u = unitIn(m, id, c, s, now); if (u) prices[c] = u.u; }
    return { id, w: qty * (noReturn || item.pr ? 1 : 1 - r.rN), prices };
  });
  const others = MARKETS.filter(c => c !== home);
  const k = Math.min(Math.max(0, extra | 0), others.length);
  const sets = [[]];
  (function grow(start, cur) {
    for (let i = start; i < others.length; i++) {
      const next = [...cur, others[i]];
      sets.push(next);
      if (next.length < k) grow(i + 1, next);
    }
  })(0, []);
  if (!k) sets.length = 1;
  let best = null;
  for (const set of sets) {
    const allowed = [home, ...set], plan = {}, used = new Set();
    let cost = 0, missing = 0;
    for (const x of res) {
      let pick = null;
      for (const c of allowed) if (x.prices[c] != null && (pick == null || x.prices[c] < x.prices[pick])) pick = c;
      if (pick == null) { missing++; continue; }
      plan[x.id] = pick; cost += x.w * x.prices[pick];
      if (pick !== home) used.add(pick);
    }
    const better = !best || missing < best.missing || (missing === best.missing && (cost < best.cost - 1e-6 ||
      (Math.abs(cost - best.cost) <= 1e-6 && used.size < best.cities.length)));
    if (better) best = { plan, home, cities: [...used], cost, missing };
  }
  return best;
}

/* ---------- a batch of crafts ---------- */

// N crafts, the first ones with focus while it lasts. Returns the shopping list and totals.
export function batch(e, s, N, useFocus) {
  N = Math.max(0, Math.floor(+N || 0));
  const focusCrafts = useFocus && e.fc ? Math.floor(Math.max(0, +s.focus || 0) / e.fc) : 0;
  const Nf = Math.min(N, focusCrafts), Nn = N - Nf;
  const keepsAll = r => r.noReturn || e.item.pr;
  let mat = 0;
  const rows = e.rows.map(r => {
    const need = keepsAll(r) ? r.qty * N : r.qty * (Nf * (1 - e.rF) + Nn * (1 - e.rN));
    const buy = Math.ceil(need - 1e-9);
    const u = r.unit ? r.unit.u : 0;
    mat += buy * u;
    return { ...r, buy, total: buy * u };
  });
  const extra = N * (e.fee + e.silver);
  const items = Nf * e.outF + Nn * e.outN;
  const net = e.sale ? e.sale.net : 0;
  const cost = mat + extra, revenue = items * net, journals = N * (e.jv || 0);
  return { N, Nf, Nn, rows, mat, extra, cost, items, revenue, journals, journalCount: e.journal ? N * e.journal.share : 0,
    profit: revenue + journals - cost, focusUsed: Nf * e.fc,
    breakEven: items && e.sale ? cost / items / (net / e.sale.p) : 0 };
}

// How many crafts your focus covers.
export const focusCrafts = (e, s) => (e.fc ? Math.floor(Math.max(0, +s.focus || 0) / e.fc) : 0);
