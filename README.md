# Albion Crafting Profits

**▶ Open the site: [poseidondream.github.io/Albion-crafter](https://poseidondream.github.io/Albion-crafter/)**
· [Refining planner](https://poseidondream.github.io/Albion-crafter/refining.html)

A crafting profit calculator for Albion Online that covers everything you can craft or refine:
weapons, armor, off-hands, bags, capes, tools, gatherer gear, potions, food, cooking ingredients,
butchering, refining, mounts and furniture. Every tier (T1–T8) and enchantment (.0–.4) is included,
about 7,500 recipes in total.

For each item it shows whether it's **profitable without focus**, **profitable only with focus**, or a **loss**,
with profit per craft, margin, silver per focus point, and how many sell per day.

Prices load **live from the [Albion Online Data Project](https://www.albion-online-data.com/)** in your browser,
for the Americas, Europe or Asia server. You don't need to paste anything.

## Using it

The crafting page has two halves.

**Left: best crafts for this trip.** Pick a category, tiers and enchantments, then say how far you'll go:
*Cities to buy in, besides where you craft*: none, 1, 2 or anywhere. Every item is ranked by profit for the number of
crafts you set, with its route (for example *Thetford → Martlock → Lymhurst*), whether it pays with or only with focus,
and how many sell a day. Each item is crafted in its bonus city unless you pick another under *More settings*.

**Right: the item you clicked.**

- **Every tier and enchantment** of that item with its profit per craft, so you can see which version pays best.
- **Your trip** as numbered stops: what to buy (or which buy orders to place) in each city, where to craft, where to sell,
  empty and full journals, what you spend and get, and how much buying on the way earns compared with buying everything
  in the craft city. Below it, the same trip with fewer or more stops.
- **Where to buy and sell**: every city's price for each resource and for the item. The cheapest is green; click any
  price to buy or sell there instead, and the trip and profit update. Type a price in *Your price* for resources you
  gathered yourself.
- **Your levels**: mastery and specialization levels for focus cost, or the focus cost the game shows, to match it exactly.

*More settings* has the craft city, buy orders vs instant buy, sell order vs instant sell vs 7-day average, the daily bonus,
station fee, your focus, the maximum price age and Premium. Everything is saved in your browser.

**Prices not loading?** at the bottom gives the direct API links and a box to paste their output, in case your network
blocks the API.

## Saved in your browser

Everything you enter (levels, focus, settings, your own prices) is saved in your browser as you type, so it's
still there next time you open the site. A small **✓ Saved** appears at the top when it's stored. Nothing is sent
to a server and there's no login.

Pick or add your character at the top (next to the server) and your levels and focus are kept per character, so
alts with different specs each keep their own.

## Refining planner

`refining.html` (the **Refining** link at the top) is a page just for refining:

- One tab per resource, each refined in its +40% city (Thetford bars, Fort Sterling planks, Lymhurst cloth,
  Martlock leather, Bridgewatch stone).
- A tier × enchantment grid with what to do with each one today: **No focus** (profitable as is),
  **+10% / +20% day** (only on a daily bonus day, so stockpile it), **Focus** (only with focus) or **Skip**.
- **Best use of your focus** ranks every refine across all five resources by silver per focus point.
- For the selected tier: every city's price for the raw resource, the previous tier's refined resource and the product,
  profit with and without focus and on bonus days, and a batch plan that says which buy orders to place in which city.
- Defaults follow the usual refining routine: buy with buy orders, station fee 400 per 100 nutrition.

## Laborer journals

Crafting gear fills Blacksmith's, Fletcher's, Imbuer's and Tinker's journals. Each craft adds a fixed amount of fame
(from the game files; artifact and crystal items fill faster), so the crafting page adds
share of a journal × (full journal price after tax − empty journal price) to the profit. Turn it off under
*Count laborer journals*. Refining, potions and food don't fill any journal in the game files, so they get none.

## How it's worked out

| | |
|---|---|
| Return rate | 1 − 1 ÷ (1 + production bonus) |
| Production bonus | city 18% (refining in rests 15%) + city specialty (+15% crafting, +40% refining) + focus 59% + daily bonus 10/20% |
| Focus cost | base focus × 0.5^(efficiency ÷ 10,000) |
| Focus efficiency | 30 × mastery + 250 × the item's own specialization + 30 (potions: 18) × every specialization level in the same mastery |
| Station fee | item value × 0.1125 nutrition × fee per 100 nutrition ÷ 100 |
| Market tax | 4% with Premium, 8% without; placing an order adds 2.5% |
| Profit per craft | items × price after tax − resources used after returns − station fee |

Artifacts, hearts, Avalonian energy, capes, crests, rare potion ingredients and farm animals are never returned,
as marked in the game data. Butchering returns extra meat instead of resources. Faction points needed for faction
capes are counted as free.

The city bonuses and recipes come straight from the game's data files
([ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps)). The focus efficiency values per level aren't in those files;
if your in-game focus cost differs, use the "Focus per craft shown in game" box in the item view.

## For developers

The site is plain HTML, CSS and JavaScript with no build step. To run it locally, serve the folder
(opening `index.html` directly won't load the data):

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

### Files

```
index.html            crafting page
refining.html         refining page
css/v2.css            styles for both pages
js/calc.js            all the crafting math (return rates, focus, taxes, journals, routes), no browser code
js/market.js          Albion Online Data Project client, cache, paste fallback
js/app.js             crafting page interface
js/refining.js        refining page interface
js/profile.js         characters saved in the browser
data/items.json       recipes, names and city bonuses, generated
tools/build-data.mjs  rebuilds data/items.json from the game's data files
tools/test-calc.mjs   tests for the math
```

### After a game patch

Recipes and city bonuses come from the game files. To pick up new items, run:

```bash
node tools/build-data.mjs
```

Or on GitHub, run the **Update recipe data** workflow from the **Actions** tab. It rebuilds `data/items.json` and commits it if anything changed.

Tests (Node 18 or newer):

```bash
npm test
```

Market data © the Albion Online Data Project contributors. Albion Online is a trademark of Sandbox Interactive GmbH;
this is a fan-made tool and isn't affiliated with them.
