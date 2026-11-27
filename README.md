# Albion Crafting Profits

A crafting profit calculator for Albion Online that covers everything you can craft or refine:
weapons, armor, off-hands, bags, capes, tools, gatherer gear, potions, food, cooking ingredients,
butchering, refining, mounts and furniture. Every tier (T1–T8) and enchantment (.0–.4) is included,
about 7,500 recipes in total.

For each item it shows whether it's **profitable without focus**, **profitable only with focus**, or a **loss**,
with profit per craft, margin, silver per focus point, and how many sell per day.

Prices load **live from the [Albion Online Data Project](https://www.albion-online-data.com/)** in your browser,
for the Americas, Europe or Asia server. You don't need to paste anything.

## Open the site

The site is plain HTML, CSS and JavaScript with no build step, so GitHub Pages can host it as is:

1. In this repository on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Pick the branch that holds this code and the **/ (root)** folder, then **Save**.
4. After a minute the site is live at `https://<your-user>.github.io/Albion-crafter/`.

To run it on your own computer instead, serve the folder (opening `index.html` directly won't load the data):

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Using it

- **Category, tiers and enchantment** at the top choose what to compare. Prices for those items load automatically
  and are kept in your browser for 30 minutes; **Update prices** fetches them again.
- **Craft in → Best bonus city for each item** crafts every item where it gets its city bonus (swords in Lymhurst,
  metal bars in Thetford, potions in Brecilien…). You can also pick one city, a rest, or your hideout with its own bonus.
- **Buy resources in / Sell in** can follow the craft city, pick the cheapest city per resource, or the best market per item
  (including the Black Market). Transport isn't counted.
- **Sell at**: lowest sell order (2.5% setup fee + tax), instant sell to the top buy order (tax only), or the 7-day average.
- Click any item to see the recipe with prices, every market's prices for it, your Destiny Board levels, and a batch planner
  with a shopping list.
- **Your levels**: enter your mastery and specialization levels in the item view. They're saved per mastery line.
  If the focus cost doesn't match the game, type the cost the game shows and it's matched exactly for every tier and enchantment.
- **Your own prices**: type a price next to any resource (for example resources you gathered) or the item itself
  to use it instead of the market's.
- **Prices not loading?** at the bottom gives the direct API links and a box to paste their output, in case your
  network blocks the API.

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

## Files

```
index.html            the page
css/style.css         styles (light and dark)
js/calc.js            all the crafting math, no browser code
js/market.js          Albion Online Data Project client, cache, paste fallback
js/app.js             the interface
data/items.json       recipes, names and city bonuses, generated
tools/build-data.mjs  rebuilds data/items.json from the game's data files
tools/test-calc.mjs   tests for the math
```

## After a game patch

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
