#!/usr/bin/env node
// Builds data/items.json from the game's own item dumps (github.com/ao-data/ao-bin-dumps).
//
//   node tools/build-data.mjs              download the latest dumps and rebuild
//   node tools/build-data.mjs --from DIR   use items.json, formatted_items.json,
//                                          craftingmodifiers.json and spells.json already saved in DIR
//
// The output lists every item that can be crafted or refined at a station: all tiers and
// enchantment levels, their resources, focus cost, how many come out per craft, which
// resources are never returned, the item value (for station fees), the city bonuses, and
// which Destiny Board mastery and specialization each item belongs to. It also keeps each item's
// weight and how much each transport mount carries, for planning hauls between cities.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DUMPS = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/';
const SOURCES = { items: 'items.json', names: 'formatted/items.json', mods: 'craftingmodifiers.json', spells: 'spells.json' };

async function load() {
  const i = process.argv.indexOf('--from');
  if (i > 0) {
    const dir = process.argv[i + 1];
    const read = async f => JSON.parse(await readFile(join(dir, f), 'utf8'));
    return { items: await read('items.json'), names: await read('formatted_items.json'), mods: await read('craftingmodifiers.json'), spells: await read('spells.json') };
  }
  const out = {};
  for (const [k, f] of Object.entries(SOURCES)) {
    const res = await fetch(DUMPS + f);
    if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
    out[k] = await res.json();
    console.log(`downloaded ${f}`);
  }
  return out;
}

const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Cluster ids in craftingmodifiers.json, mapped to the names the market API uses.
const CLUSTERS = {
  '0000': 'Thetford', '1000': 'Lymhurst', '2000': 'Bridgewatch', '3004': 'Martlock', '4000': 'Fort Sterling',
  '3003': 'Caerleon', '5000': 'Brecilien', '4300': "Arthur's Rest", '1012': "Merlyn's Rest", '0008': "Morgana's Rest"
};

// Categories shown in the site, in menu order. `match` decides which items fall in each.
const GROUPS = [
  ['weapons', 'Weapons', [
    ['sword', 'Swords'], ['axe', 'Axes'], ['mace', 'Maces'], ['hammer', 'Hammers'], ['knuckles', 'War Gloves'],
    ['crossbow', 'Crossbows'], ['bow', 'Bows'], ['spear', 'Spears'], ['dagger', 'Daggers'], ['quarterstaff', 'Quarterstaffs'],
    ['shapeshifterstaff', 'Shapeshifter Staffs'], ['naturestaff', 'Nature Staffs'], ['firestaff', 'Fire Staffs'],
    ['holystaff', 'Holy Staffs'], ['arcanestaff', 'Arcane Staffs'], ['froststaff', 'Frost Staffs'], ['cursestaff', 'Cursed Staffs']]],
  ['armor', 'Armor', [
    ['plate_helmet', 'Plate Helmets'], ['plate_armor', 'Plate Armor'], ['plate_shoes', 'Plate Boots'],
    ['leather_helmet', 'Leather Hoods'], ['leather_armor', 'Leather Jackets'], ['leather_shoes', 'Leather Shoes'],
    ['cloth_helmet', 'Cloth Cowls'], ['cloth_armor', 'Cloth Robes'], ['cloth_shoes', 'Cloth Sandals']]],
  ['offhands', 'Off-hands', [['shieldtype', 'Shields'], ['booktype', 'Tomes, Orbs & Totems'], ['torchtype', 'Torches & Horns']]],
  ['accessories', 'Bags & Capes', [['bag', 'Bags'], ['cape', 'Capes'], ['factioncape', 'Faction & Artifact Capes']]],
  ['gathering', 'Gathering', [['tools', 'Tools'], ['gatherer_fiber', 'Harvester Gear'], ['gatherer_hide', 'Skinner Gear'],
    ['gatherer_ore', 'Miner Gear'], ['gatherer_rock', 'Quarrier Gear'], ['gatherer_wood', 'Lumberjack Gear'], ['gatherer_fish', 'Fisherman Gear']]],
  ['consumables', 'Potions & Food', [['potion', 'Potions'], ['food', 'Food'], ['cooking', 'Cooking Ingredients'], ['butcher', 'Butchering']]],
  ['refining', 'Refining', [['refine_ore', 'Metal Bars'], ['refine_wood', 'Planks'], ['refine_fiber', 'Cloth'], ['refine_hide', 'Leather'], ['refine_rock', 'Stone Blocks']]],
  ['other', 'Mounts & Furniture', [['mount', 'Mounts'], ['furniture', 'Furniture']]]
];

// Destiny Board masteries ("lines"). Every item belongs to one line and one specialization
// in it. `mutual` is the focus efficiency each level of any specialization in the line gives
// to every item of the line (potions use a lower value than everything else).
// Masteries follow the game's Destiny Board (checked against its localization file):
// - gathering: one mastery per gathering type (e.g. Lumberjack Crafter) covering the tool and the gear,
//   with Cap, Garb and Workboots specializations; siege hammer and tracking toolkit have their own;
// - refining: no mastery, only T4 to T8 nodes per resource (e.g. Adept to Elder Ore Smelter);
// - capes: one Cape Tailoring specialization; mounts: Mount Trainer with no specializations;
// - alcohol is the Alchemist's Bootlegger specialization; furniture has no crafting node.
// `mastery: false` = no mastery level; `noLevels: true` = no Destiny Board node at all.
const LINES = {};
for (const [, , cats] of GROUPS) for (const [k, n] of cats) LINES[k] = { name: n, mutual: k === 'potion' ? 18 : 30 };
LINES.factioncape = LINES.cape = { name: 'Capes', mutual: 30 };
LINES.cooking = LINES.butcher = LINES.food = { name: 'Cooking', mutual: 30 };
const GATHER = { fiber: ['Harvester', 'sickle'], hide: ['Skinner', 'skinning knife'], ore: ['Miner', 'pickaxe'], rock: ['Quarrier', 'stone hammer'], wood: ['Lumberjack', 'axe'], fish: ['Fisherman', 'fishing rod'] };
for (const [k, [who, tool]] of Object.entries(GATHER)) LINES['gatherer_' + k] = { name: `${who} (${tool} and gear)`, mutual: 30 };
LINES.siege = { name: 'Siege Equipment', mutual: 30 };
LINES.tracking = { name: 'Tracking Toolkit', mutual: 30 };
const REFINE = { ore: 'Ore Smelter (metal bars)', wood: 'Wood Planer (planks)', fiber: 'Fiber Weaver (cloth)', hide: 'Hide Tanner (leather)', rock: 'Stone Cutter (stone blocks)' };
for (const [k, n] of Object.entries(REFINE)) LINES['refine_' + k] = { name: n, mutual: 30, mastery: false };
LINES.mount = { name: 'Mount Trainer (mounts)', mutual: 0 };
LINES.furniture = { name: 'Furniture', mutual: 0, mastery: false, noLevels: true };
delete LINES.tools;
const TOOL_LINE = { SICKLE: 'gatherer_fiber', KNIFE: 'gatherer_hide', PICK: 'gatherer_ore', HAMMER: 'gatherer_rock', AXE: 'gatherer_wood', FISHINGROD: 'gatherer_fish' };
const GEAR_SPECS = { HEAD: 'Cap', ARMOR: 'Garb', SHOES: 'Workboots' };

const SKIP = /^UNIQUE_|PROTOTYPE|GAMEMASTER|_TEST|NONTRADABLE|TELLAFRIEND|VANITY|_ADC_|_BATTLE$/;
const FOOD_SPECS = { SOUP: 'Soup', SALAD: 'Salad', PIE: 'Pie', OMELETTE: 'Omelette', STEW: 'Stew', SANDWICH: 'Sandwich', ROAST: 'Roast' };
const TIER_WORDS = /^(Beginner's|Novice's|Journeyman's|Adept's|Expert's|Master's|Grandmaster's|Elder's) /;

// Which category, mastery line and specialization an item belongs to, or null to leave it out.
function classify(kind, it) {
  const id = it['@uniquename'];
  const shop = it['@shopcategory'], sub = it['@shopsubcategory1'], cc = it['@craftingcategory'];
  const base = id.replace(/^T\d_/, '');
  if (SKIP.test(id)) return null;
  // Weapons use their crafting category as the mastery: Black Hands is listed with war gloves but crafted as a dagger
  if (shop === 'weapons' && LINES[sub]) return { cat: sub, line: LINES[cc] ? cc : sub, spec: base };
  if (['armors', 'head', 'shoes'].includes(shop) && LINES[sub]) return { cat: sub, spec: base };
  if (shop === 'offhands' && LINES[sub]) return { cat: sub, spec: base };
  if (shop === 'bags') return { cat: 'bag', spec: base };
  if (shop === 'capes' && /^T\d_CAPE$/.test(id)) return { cat: 'cape', spec: 'CAPE' };
  if (shop === 'capes' && /^T\d_CAPEITEM_/.test(id)) return { cat: 'factioncape', line: 'cape', spec: 'CAPE' };
  if (cc === 'tools') {
    const m = base.match(/^2H_TOOL_([A-Z]+)/), t = m ? m[1] : '';
    if (TOOL_LINE[t]) return { cat: 'tools', line: TOOL_LINE[t], spec: '' };
    if (t === 'SIEGEHAMMER') return { cat: 'tools', line: 'siege', spec: 'SIEGEHAMMER' };
    if (t === 'TRACKING') return { cat: 'tools', line: 'tracking', spec: 'TRACKING' };
    return null;
  }
  if (cc === 'gatherergear') {
    const slot = base.split('_')[0];
    return { cat: 'gatherer_' + sub, spec: GEAR_SPECS[slot] ? slot : '' };
  }
  if (cc === 'potion' && sub === 'potions') return { cat: 'potion', spec: base.replace(/^POTION_/, '') };
  if (cc === 'food' && sub === 'food') {
    const k = base.replace(/^MEAL_/, '').split('_')[0];
    return { cat: 'food', spec: FOOD_SPECS[k] ? k : '' };
  }
  if (shop === 'farming' && cc === 'food' && /_ALCOHOL$/.test(id)) return { cat: 'cooking', line: 'potion', spec: 'ALCOHOL' };
  if (shop === 'farming' && cc === 'food') return { cat: 'cooking', line: 'food', spec: 'INGREDIENTS' };
  if (shop === 'farming' && cc && cc.startsWith('meat_')) return { cat: 'butcher', line: 'food', spec: 'BUTCHER' };
  if (sub === 'refinedresources' && ['ore', 'wood', 'fiber', 'hide', 'rock'].includes(cc)) return { cat: 'refine_' + cc, spec: +it['@tier'] >= 4 ? 'T' + it['@tier'] : '', refine: true };
  if (kind === 'mount' && sub === 'basemounts') return { cat: 'mount', spec: '' };
  if (kind === 'furnitureitem' && ['chest', 'repairkit', 'labourers'].includes(sub) && /^T\d_/.test(id)) return { cat: 'furniture', spec: '' };
  return null;
}

// The normal recipe out of the alternatives: skip the ones that swap in faction or artifact tokens.
function pickRecipe(list) {
  const rs = arr(list).filter(r => r && arr(r.craftresource).length);
  return rs.find(r => !arr(r.craftresource).some(x => /TOKEN_FAVOR|FACTION_.*TOKEN/.test(x['@uniquename']) && !/^T\d_CAPEITEM/.test(x['@uniquename'])))
    || rs[0] || null;
}

async function main() {
  const { items, names, mods, spells } = await load();
  const all = {};
  for (const [kind, list] of Object.entries(items.items)) {
    if (!Array.isArray(list)) continue;
    for (const it of list) all[it['@uniquename']] = { kind, it };
  }
  const en = {};
  for (const x of names) if (x.UniqueName) en[x.UniqueName] = (x.LocalizedNames && x.LocalizedNames['EN-US']) || null;

  // Laborer journals filled by crafting: base item id -> [journal base id, fame per craft, journal capacity].
  // Each craft of a listed item adds a fixed amount of fame (times the item's journal fame factor).
  const journalFor = {};
  for (const j of arr(items.items.journalitem)) {
    const m = j.famefillingmissions && j.famefillingmissions.craftitemfame;
    if (!m || !(`${j['@uniquename']}_EMPTY` in en)) continue;
    for (const v of arr(m.validitem)) journalFor[v['@id']] = [j['@uniquename'], +m['@value'], +j['@maxfame']];
  }

  // Market id for a resource: enchanted resources trade as e.g. T4_METALBAR_LEVEL1@1
  const marketId = (id, lvl) => (lvl > 0 && (`${id}@${lvl}` in en) ? `${id}@${lvl}` : id);

  // Item value, used for the station's nutrition fee. Items without one take their recipe's.
  const ivCache = {};
  function itemValue(id, depth = 0) {
    if (id in ivCache) return ivCache[id];
    const rec = all[id];
    let v = 0;
    if (rec && rec.it['@itemvalue'] != null) v = +rec.it['@itemvalue'];
    else if (rec && depth < 6) {
      const r = pickRecipe(rec.it.craftingrequirements);
      if (r) v = arr(r.craftresource).reduce((a, x) => a + itemValue(x['@uniquename'], depth + 1) * +x['@count'], 0) / (+r['@amountcrafted'] || 1);
    }
    return (ivCache[id] = v);
  }

  const out = [];
  const used = new Set();
  const specNames = {};
  for (const { kind, it } of Object.values(all)) {
    if (!it.craftingrequirements) continue;
    const cls = classify(kind, it);
    if (!cls) continue;
    const line = cls.line || cls.cat;
    const tier = +it['@tier'] || +(it['@uniquename'].match(/^T(\d)/) || [])[1] || 0;
    const variants = [[+(it['@enchantmentlevel'] || 0), it.craftingrequirements]];
    for (const e of arr(it.enchantments && it.enchantments.enchantment)) variants.push([+e['@enchantmentlevel'], e.craftingrequirements]);
    for (const [ench, reqs] of variants) {
      const r = pickRecipe(reqs);
      if (!r) continue;
      if (/TRANSMUTE/.test(r['@craftbuttonlocaoverride'] || '')) continue;
      const focus = +(r['@craftingfocus'] || 0);
      if (!focus && cls.cat !== 'factioncape') continue;
      const id = ench > 0 && !it['@uniquename'].includes('_LEVEL') ? `${it['@uniquename']}@${ench}` : marketId(it['@uniquename'], ench);
      if (!(id in en)) continue; // not a market item
      const res = arr(r.craftresource).map(x => {
        const rid = marketId(x['@uniquename'], +(x['@enchantmentlevel'] || 0));
        used.add(rid);
        const row = [rid, +x['@count']];
        if (x['@maxreturnamount'] === '0') row.push(1);
        return row;
      });
      const iv = arr(r.craftresource).reduce((a, x) => a + itemValue(x['@uniquename']) * +x['@count'], 0);
      const rec = { id, t: tier, e: ench, c: cls.cat, cc: it['@craftingcategory'] || '', l: line, s: cls.spec, f: focus, r: res, v: Math.round(iv * 100) / 100 };
      if (+r['@amountcrafted'] > 1) rec.a = +r['@amountcrafted'];
      if (+r['@silver'] > 0) rec.$ = +r['@silver'];
      if (cls.refine) rec.rf = 1;
      if (r['@returnproductnotresource'] === 'true') rec.pr = 1;
      const jr = journalFor[it['@uniquename']];
      if (jr) rec.j = [jr[0], Math.round(jr[1] * (+it['@destinyandjournalcraftfamefactor'] || 1)), jr[2]];
      out.push(rec);
      used.add(id);
      const key = line + '|' + cls.spec;
      if (cls.spec && !specNames[key]) specNames[key] = specName(cls, en[id] || id);
    }
  }
  out.sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : a.s < b.s ? -1 : a.s > b.s ? 1 : a.t - b.t || a.e - b.e));

  for (const x of out) if (x.j) { used.add(x.j[0] + '_EMPTY'); used.add(x.j[0] + '_FULL'); }
  const mounts = transportMounts(items, spells, en);
  for (const x of mounts) used.add(x.id);
  const nameMap = {}, weights = {};
  for (const id of [...used].sort()) {
    const base = id.replace(/@\d$/, '');
    nameMap[base] = en[id] || en[base] || id;
    const w = all[base] && +all[base].it['@weight'];
    if (w > 0) weights[base] = w;
  }

  const cities = {};
  for (const loc of arr(mods.craftingmodifiers.craftinglocation)) {
    const name = CLUSTERS[loc['@clusterid']];
    if (!name) continue;
    const m = {};
    for (const x of arr(loc.craftingmodifier)) m[x['@name']] = +x['@value'];
    cities[name] = { craft: +loc.craftingbonus['@value'], refine: +loc.refiningbonus['@value'], mods: m, rest: name.includes('Rest') };
  }

  const data = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'github.com/ao-data/ao-bin-dumps',
    groups: GROUPS.map(([key, name, cats]) => ({ key, name, cats: cats.map(([k, n]) => ({ key: k, name: n })) })),
    lines: LINES, specs: specNames, cities, names: nameMap, weights, mounts, items: out
  };
  await mkdir(join(ROOT, 'data'), { recursive: true });
  const json = JSON.stringify(data);
  await writeFile(join(ROOT, 'data', 'items.json'), json);
  const per = {};
  for (const x of out) per[x.c] = (per[x.c] || 0) + 1;
  console.log(`${out.length} craftable items, ${Object.keys(nameMap).length} names, ${mounts.length} transport mounts, ${(json.length / 1024).toFixed(0)} KB`);
  console.log(per);
}

// Mounts that haul: how many kg each carries and how fast it walks. The game keeps a load value on
// each mount's half-mounted buff; that value x the mount's weight x LOAD_FACTOR is the carry weight
// the game shows (Elder's Transport Ox 3,200 kg, Transport Mammoth 22,521 kg).
const LOAD_FACTOR = 1.6537;
function transportMounts(items, spells, en) {
  const buff = {};
  for (const kind of ['activespell', 'passivespell', 'togglespell']) {
    for (const sp of arr(spells.spells[kind])) {
      const b = {};
      for (const x of [...arr(sp.buffovertime), ...arr(sp.buff)]) if (x && x['@type']) b[x['@type']] = +x['@value'];
      buff[sp['@uniquename']] = b;
    }
  }
  const list = [];
  for (const m of arr(items.items.mount)) {
    const id = m['@uniquename'];
    if (!(id in en) || /^UNIQUE|BATTLE|SIEGE|CHARIOT|_ADC$/.test(id)) continue;
    const load = (buff[m['@halfmountedbuff']] || {}).maxload || (buff[m['@mountedbuff']] || {}).maxload || 0;
    const kg = Math.round(load * +m['@weight'] * LOAD_FACTOR);
    if (kg < 300) continue;
    list.push({ id, t: +m['@tier'] || 0, kg, sp: Math.round(((buff[m['@mountedbuff']] || {}).movespeedbonus || 0) * 100) });
  }
  return list.sort((a, b) => a.kg - b.kg);
}

const REFINE_TIER = { T4: 'Adept', T5: 'Expert', T6: 'Master', T7: 'Grandmaster', T8: 'Elder' };
function specName(cls, itemName) {
  if (cls.refine) return `${REFINE_TIER[cls.spec]} (${cls.spec})`;
  if (cls.spec === 'CAPE') return 'Cape';
  if (cls.spec === 'ALCOHOL') return 'Bootlegger (alcohol)';
  if (GEAR_SPECS[cls.spec] && cls.cat.startsWith('gatherer_')) return GEAR_SPECS[cls.spec];
  if (cls.spec === 'SIEGEHAMMER') return 'Siege Hammer';
  if (cls.spec === 'TRACKING') return 'Tracking Toolkit';
  if (cls.cat === 'food') return FOOD_SPECS[cls.spec] || 'Other dishes';
  if (cls.cat === 'cooking') return 'Ingredients';
  if (cls.cat === 'butcher') return 'Butcher';
  if (cls.cat === 'potion') return itemName.replace(/^(Minor|Major) /, '');
  return itemName.replace(TIER_WORDS, '');
}

main().catch(e => { console.error(e); process.exit(1); });
