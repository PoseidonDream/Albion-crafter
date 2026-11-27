// Run with: node --test tools/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../js/calc.js';
import * as L from '../js/levels.js';

const data = JSON.parse(readFileSync(new URL('../data/items.json', import.meta.url), 'utf8'));
const item = id => data.items.find(x => x.id === id);
const S = (o = {}) => ({ ...C.DEFAULTS, ...o });
const near = (a, b, eps = 0.001) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const T = Date.parse('2026-11-27T12:00:00Z');
const at = T - 3600e3;

test('return rates match the game', () => {
  const sword = item('T4_MAIN_SWORD'), bar = item('T5_METALBAR');
  let r = C.rates(sword, 'Caerleon', S(), data);          // no sword bonus in Caerleon
  near(r.rN, 0.1525); near(r.rF, 0.4350);
  r = C.rates(sword, 'Lymhurst', S(), data);              // Lymhurst: swords +15%
  near(r.rN, 0.2481); near(r.rF, 0.4792);
  r = C.rates(bar, 'Thetford', S(), data);                // Thetford: ore refining +40%
  near(r.rN, 0.3671); near(r.rF, 0.5392);
  r = C.rates(bar, 'Thetford', S({ daily: 10 }), data);
  near(r.rN, 1 - 1 / 1.68);
});

test('auto picks the bonus city', () => {
  assert.equal(C.craftCityFor(item('T4_MAIN_SWORD'), S(), data), 'Lymhurst');
  assert.equal(C.craftCityFor(item('T5_METALBAR'), S(), data), 'Thetford');
  assert.equal(C.craftCityFor(item('T5_PLANKS'), S(), data), 'Fort Sterling');
  assert.equal(C.craftCityFor(item('T4_POTION_HEAL'), S(), data), 'Brecilien');
  assert.equal(C.craftCityFor(item('T8_MEAL_STEW'), S(), data), 'Caerleon');
  assert.equal(C.craftCityFor(item('T4_MAIN_SWORD'), S({ craftCity: 'Martlock' }), data), 'Martlock');
});

test('focus cost follows Destiny Board levels', () => {
  const sword = item('T4_MAIN_SWORD');
  assert.equal(C.focusCost(sword, S(), data), 1286);
  const s = S({ levels: { sword: { m: 100, s: { MAIN_SWORD: 100 } } } });
  assert.equal(C.fceFor(sword, s, data), 3000 + 25000 + 3000);
  assert.equal(C.focusCost(sword, s, data), Math.round(1286 * Math.pow(0.5, 3.1)));
  // Calibrating from the in-game number reproduces it for the other tiers and enchants
  const fce = C.fceFromGame(sword, 400);
  const cal = S({ fce: { 'sword|MAIN_SWORD': fce } });
  assert.ok(Math.abs(C.focusCost(sword, cal, data) - 400) <= 1);
  const t6 = item('T6_MAIN_SWORD@2');
  assert.equal(C.focusCost(t6, cal, data), Math.round(t6.f * Math.pow(0.5, fce / 10000)));
});

test('profit with and without focus', () => {
  const sword = item('T4_MAIN_SWORD'); // 16 bars + 8 leather
  const m = { prices: {
    T4_METALBAR: { Lymhurst: { s: 100, sd: at, b: 90, bd: at } },
    T4_LEATHER: { Lymhurst: { s: 200, sd: at } },
    T4_MAIN_SWORD: { Lymhurst: { s: 4000, sd: at, b: 3500, bd: at } }
  } };
  const e = C.evaluate(sword, S(), m, data, T);
  assert.equal(e.craftCity, 'Lymhurst');
  const raw = 16 * 100 + 8 * 200;
  near(e.costN, raw * (1 - e.rN));
  near(e.costF, raw * (1 - e.rF));
  near(e.revenueN, 4000 * (1 - 0.04 - 0.025));
  near(e.profitN, e.revenueN - e.costN);
  assert.equal(e.status, e.profitN > 0 ? 'profit' : 'focus');
  near(e.spf, e.profitF / 1286);

  // Instant sell to buy orders: tax only, no setup fee. No premium: 8%.
  const e2 = C.evaluate(sword, S({ sellBasis: 'buyorder', premium: false }), m, data, T);
  near(e2.revenueN, 3500 * 0.92);

  // Buying with buy orders adds the setup fee; leather has no buy order so its listing is used.
  const e3 = C.evaluate(sword, S({ buyMode: 'order' }), m, data, T);
  near(e3.costN, (16 * 90 * 1.025 + 8 * 200) * (1 - e3.rN));

  // Station fee: item value 384 x 0.1125 nutrition x 500 silver per 100 nutrition
  const e4 = C.evaluate(sword, S({ stationFee: 500 }), m, data, T);
  near(e4.fee, 384 * 0.1125 * 5);
  near(e4.profitN, e.profitN - e4.fee);
});

test('missing and stale prices', () => {
  const sword = item('T4_MAIN_SWORD');
  const old = T - 72 * 3600e3;
  const m = { prices: { T4_METALBAR: { Lymhurst: { s: 100, sd: at } }, T4_LEATHER: { Lymhurst: { s: 200, sd: old } },
    T4_MAIN_SWORD: { Lymhurst: { s: 4000, sd: at } } } };
  const e = C.evaluate(sword, S(), m, data, T);
  assert.equal(e.status, 'nodata');
  assert.deepEqual(e.missing, ['T4_LEATHER']);
  const e2 = C.evaluate(sword, S({ maxAge: 0 }), m, data, T);
  assert.equal(e2.priced, true);
  const e3 = C.evaluate(sword, S({ overrides: { T4_LEATHER: 210 } }), m, data, T);
  assert.equal(e3.priced, true);
});

test('artifacts are never returned', () => {
  const it = item('T4_MAIN_SCIMITAR_MORGANA');
  const m = { prices: {
    T4_METALBAR: { Lymhurst: { s: 100, sd: at } }, T4_LEATHER: { Lymhurst: { s: 200, sd: at } },
    T4_ARTEFACT_MAIN_SCIMITAR_MORGANA: { Lymhurst: { s: 10000, sd: at } }, T4_MAIN_SCIMITAR_MORGANA: { Lymhurst: { s: 20000, sd: at } }
  } };
  const e = C.evaluate(it, S(), m, data, T);
  near(e.costN, 3200 * (1 - e.rN) + 10000);
  near(e.costF, 3200 * (1 - e.rF) + 10000);
});

test('best market and cheapest resources', () => {
  const sword = item('T4_MAIN_SWORD');
  const m = { prices: {
    T4_METALBAR: { Lymhurst: { s: 100, sd: at }, Martlock: { s: 80, sd: at } },
    T4_LEATHER: { Lymhurst: { s: 200, sd: at }, Caerleon: { s: 150, sd: at } },
    T4_MAIN_SWORD: { Lymhurst: { s: 4000, sd: at }, 'Black Market': { s: 9000, sd: at, b: 5000, bd: at } }
  } };
  const e = C.evaluate(sword, S({ buyCity: 'cheapest', sellCity: 'best' }), m, data, T);
  assert.equal(e.rows[0].unit.city, 'Martlock');
  assert.equal(e.rows[1].unit.city, 'Caerleon');
  assert.equal(e.sale.city, 'Black Market');   // Black Market sells to buy orders
  assert.equal(e.sale.p, 5000);
});

test('potions make several per craft; butchering returns product', () => {
  const pot = item('T4_POTION_HEAL');
  const m = { prices: { T4_BURDOCK: { Brecilien: { s: 50, sd: at } }, T3_EGG: { Brecilien: { s: 20, sd: at } },
    T4_POTION_HEAL: { Brecilien: { s: 300, sd: at } } } };
  const e = C.evaluate(pot, S(), m, data, T);
  assert.equal(e.amount, 5);
  near(e.revenueN, 5 * 300 * 0.935);

  const meat = item('T6_MEAT');
  const m2 = { prices: { T6_FARM_SHEEP_GROWN: { Caerleon: { s: 5000, sd: at } }, T6_MEAT: { Caerleon: { s: 400, sd: at } } } };
  const e2 = C.evaluate(meat, S({ craftCity: 'Caerleon' }), m2, data, T);
  near(e2.costN, 5000);
  near(e2.outN, 18 * 1.18);
  near(e2.outF, 18 * 1.77);
});

test('batch uses focus first, then normal crafts', () => {
  const sword = item('T4_MAIN_SWORD');
  const m = { prices: { T4_METALBAR: { Lymhurst: { s: 100, sd: at } }, T4_LEATHER: { Lymhurst: { s: 200, sd: at } },
    T4_MAIN_SWORD: { Lymhurst: { s: 4000, sd: at } } } };
  const s = S({ focus: 3000 });
  const e = C.evaluate(sword, s, m, data, T);
  const b = C.batch(e, s, 10, true);
  assert.equal(b.Nf, 2); assert.equal(b.Nn, 8);
  assert.equal(b.focusUsed, 2 * 1286);
  assert.equal(b.rows[0].buy, Math.ceil(16 * (2 * (1 - e.rF) + 8 * (1 - e.rN))));
  near(b.revenue, 10 * e.sale.net);
});

test('journal profit is added per craft', () => {
  const sword = item('T4_MAIN_SWORD');
  assert.deepEqual(sword.j, ['T4_JOURNAL_WARRIOR', 1200, 3600]);
  const m = { prices: {
    T4_METALBAR: { Lymhurst: { s: 100, sd: at } }, T4_LEATHER: { Lymhurst: { s: 200, sd: at } },
    T4_MAIN_SWORD: { Lymhurst: { s: 4000, sd: at } },
    T4_JOURNAL_WARRIOR_EMPTY: { Lymhurst: { s: 1000, sd: at } }, T4_JOURNAL_WARRIOR_FULL: { Lymhurst: { s: 7000, sd: at } }
  } };
  const off = C.evaluate(sword, S({ journals: false }), m, data, T);
  const on = C.evaluate(sword, S(), m, data, T);
  const per = (7000 * 0.935 - 1000) / 3;
  near(on.jv, per);
  near(on.profitN, off.profitN + per);
  near(on.profitF, off.profitF + per);
  const b = C.batch(on, S(), 9, false);
  near(b.journalCount, 3);
  near(b.profit, b.revenue + 9 * per - b.cost);
  // No journal prices: no journal profit, the craft is still priced
  const m2 = { prices: { ...m.prices, T4_JOURNAL_WARRIOR_FULL: undefined } };
  const e2 = C.evaluate(sword, S(), m2, data, T);
  assert.equal(e2.jv, 0); assert.equal(e2.priced, true);
  // Potions and refining fill no journal
  assert.equal(item('T4_POTION_HEAL').j, undefined);
  assert.equal(item('T5_METALBAR').j, undefined);
});

test('route plan picks the cheapest cities within the stop limit', () => {
  const sword = item('T4_MAIN_SWORD'); // crafted in Lymhurst
  const m = { prices: {
    T4_METALBAR: { Lymhurst: { s: 100, sd: at }, Thetford: { s: 70, sd: at }, Martlock: { s: 90, sd: at } },
    T4_LEATHER: { Lymhurst: { s: 200, sd: at }, Martlock: { s: 150, sd: at }, Thetford: { s: 190, sd: at } },
    T4_MAIN_SWORD: { Lymhurst: { s: 4000, sd: at } }
  } };
  const r0 = C.routePlan(sword, S(), data, m, 0, T);
  assert.deepEqual(r0.plan, { T4_METALBAR: 'Lymhurst', T4_LEATHER: 'Lymhurst' });
  assert.deepEqual(r0.cities, []);
  // One extra city: Martlock (16 bars x 90 + 8 leather x 150) and Thetford (16 x 70 + 8 x 190) both cost 2,640
  const r1 = C.routePlan(sword, S(), data, m, 1, T);
  assert.equal(r1.cities.length, 1);
  assert.ok(Math.abs(r1.cost - 2640 * (1 - 0.2481)) < 1, String(r1.cost));
  const r2 = C.routePlan(sword, S(), data, m, 2, T);
  assert.deepEqual(r2.plan, { T4_METALBAR: 'Thetford', T4_LEATHER: 'Martlock' });
  assert.deepEqual(r2.cities.sort(), ['Martlock', 'Thetford']);
  // The plan feeds evaluate
  const e = C.evaluate(sword, S({ buyPlan: r2.plan }), m, data, T);
  assert.equal(e.rows[0].unit.city, 'Thetford'); assert.equal(e.rows[1].unit.city, 'Martlock');
  // Your own price needs no city
  const r3 = C.routePlan(sword, S({ overrides: { T4_LEATHER: 1 } }), data, m, 1, T);
  assert.deepEqual(r3.plan, { T4_METALBAR: 'Thetford' });
});

test('quick fill sets whole masteries', () => {
  const s = S({ levels: {}, fce: { 'sword|MAIN_SWORD': 9999 } });
  L.fillLines(s, data, ['sword'], 100);
  assert.equal(s.levels.sword.m, 100);
  assert.equal(Object.keys(s.levels.sword.s).length, L.specsOf(data, 'sword').length);
  assert.ok(Object.values(s.levels.sword.s).every(v => v === 100));
  assert.equal(s.fce['sword|MAIN_SWORD'], undefined); // filling replaces an in-game calibration
  const armor = L.linesInGroup(data, L.groupOf(data, 'plate_armor'));
  assert.deepEqual(armor.sort(), ['cloth_armor', 'cloth_helmet', 'cloth_shoes', 'leather_armor', 'leather_helmet', 'leather_shoes', 'plate_armor', 'plate_helmet', 'plate_shoes']);
  L.fillLines(s, data, armor, 250);  // clamps to 100
  assert.equal(s.levels.plate_helmet.m, 100);
  // focus cost with every Swords spec at 100: 30*100 + 250*100 + 30*(8 specs * 100)
  assert.equal(C.fceFor(item('T4_MAIN_SWORD'), s, data), 3000 + 25000 + 30 * 100 * L.specsOf(data, 'sword').length);
  L.clearLines(s, ['sword']);
  assert.equal(s.levels.sword, undefined);
  L.fillLines(s, data, ['plate_armor'], 0);
  assert.equal(s.levels.plate_armor, undefined);
});

test('every item in the data is well formed', () => {
  assert.ok(data.items.length > 5000);
  for (const it of data.items) {
    assert.ok(it.id && it.t >= 1 && it.t <= 8, it.id);
    assert.ok(it.r.length > 0, it.id);
    for (const [rid, q] of it.r) assert.ok(rid && q > 0, it.id);
    assert.ok(data.lines[it.l], 'line ' + it.l);
  }
});
