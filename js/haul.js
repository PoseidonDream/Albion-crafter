// Hauling, shared by the crafting and refining pages: what the materials cost if you buy all of
// them in one city, how much the load weighs, and which mount carries it for the least silver.
import * as C from './calc.js?v=4'; // ?v: a cached older copy can't be mixed in

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = n => n != null && Number.isFinite(n);
const fmt = n => (ok(n) ? Math.round(n).toLocaleString('en-US') : '—');
const fmtS = n => { if (!ok(n)) return '—'; const r = Math.round(n); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toLocaleString('en-US'); };
const fmt1 = n => (ok(n) ? (Math.abs(n) >= 100 ? fmt(n) : (Math.round(n * 10) / 10).toLocaleString('en-US')) : '—');
const cls = n => (!ok(n) ? 'muted' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');
export const kgText = kg => (kg >= 100 ? fmt(kg) : (Math.round(kg * 10) / 10).toLocaleString('en-US')) + ' kg';

// Table: for each city, the cost of buying every material there and the profit that gives.
//   rows    batch rows ({ id, buy, unit })
//   home    city where you craft or refine (no carrying when you buy there)
//   profit  profit of the plan shown now, and mat what its materials cost (so a city's profit is profit + mat - its cost)
//   chosen  the city every material is bought in now, if it's one city
//   name    id -> display name
export function oneCityTable({ rows, s, m, home, profit, mat, chosen, name }) {
  const totals = C.cityTotals(rows, s, m);
  const best = totals.find(t => !t.missing.length);
  const body = totals.map(t => {
    const complete = !t.missing.length;
    const pr = complete && ok(profit) ? profit + mat - t.cost : null;
    const diff = complete && best ? t.cost - best.cost : null;
    const note = !complete ? `<span class="neg">no price for ${t.missing.map(id => esc(name(id))).join(', ')}</span>`
      : t.city === home ? 'buy where you make it: nothing to carry' : `carry to ${esc(home)}`;
    return `<tr class="${t === best ? 'best' : ''}${t.city === chosen ? ' cur' : ''}">
      <td><button type="button" class="linkbtn" data-onecity="${esc(t.city)}"${complete ? '' : ' disabled'} title="Buy every material in ${esc(t.city)}">${esc(t.city)}</button>
        <small class="muted">${note}</small></td>
      <td>${complete ? fmt(t.cost) : '—'}${complete && diff > 0.5 ? `<small class="muted">+${fmt(diff)}</small>` : t === best ? '<small class="pos">cheapest</small>' : ''}</td>
      <td class="${cls(pr)}">${ok(pr) ? fmtS(pr) : '—'}</td>
    </tr>`;
  }).join('');
  return `<div class="scroll"><table class="onecity"><thead><tr><th>Buy everything in</th><th>Materials cost</th><th>Profit</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

// Mount picker for a load of `kg`. `far` is the part bought outside the craft city.
//   kgOverride  a weight the user typed instead (or null)
export function mountSection({ data, m, s, kg, far, home, kgOverride, products }) {
  const load = ok(kgOverride) && kgOverride > 0 ? kgOverride : kg;
  const o = C.mountOptions(data, m, s, load);
  const name = id => (data.names || {})[id] || id;
  const priced = o.list.some(x => x.price != null);
  const lines = [];
  if (!(kgOverride > 0)) {
    lines.push(`The materials weigh <b>${kgText(kg)}</b>${far > 0.05 && far < kg - 0.05 ? `, ${kgText(far)} of it bought outside ${esc(home)}` : far >= kg - 0.05 && kg > 0 ? `, all bought outside ${esc(home)}` : ''}.`);
    if (products && products.kg > 0 && products.to) lines.push(`What you make weighs ${kgText(products.kg)}${products.to ? ` (to carry to ${esc(products.to)})` : ''}.`);
  } else lines.push(`Planning a load of <b>${kgText(load)}</b>.`);
  if (o.fits) lines.push(`Cheapest mount that carries it in one trip: <b>${esc(name(o.fits.id))}</b> (${kgText(o.fits.kg)}) for <b>${fmt(o.fits.price)}</b> in ${esc(o.fits.city)}.`);
  else if (priced && load > 0) lines.push('No single mount carries all of it: split it over the trips below.');
  // The usual hauler, always shown for comparison
  const ox = o.list.find(x => x.id === 'T8_MOUNT_OX');
  if (ox && (!o.fits || o.fits.id !== ox.id)) lines.push(`Elder's Transport Ox (T8, ${kgText(ox.kg)}): ${ox.price != null ? `<b>${fmt(ox.price)}</b> in ${esc(ox.city)}` : 'no price yet'}${load > 0 ? ` · ${ox.trips} trip${ox.trips === 1 ? '' : 's'} for this load` : ''}.`);
  if (!priced) lines.push('<span class="muted">No mount prices yet. Press Refresh.</span>');
  const rows = o.list.map(x => `<tr class="${o.fits && x.id === o.fits.id ? 'best' : ''}${x.kg < load ? ' short' : ''}">
      <td><b>${esc(name(x.id))}</b><small class="muted">T${x.t} · +${x.sp}% speed</small></td>
      <td>${fmt(x.kg)}</td>
      <td>${x.price != null ? fmt(x.price) + `<small class="muted">${esc(x.city)}</small>` : '—'}</td>
      <td>${x.perKg != null ? fmt1(x.perKg) : '—'}</td>
      <td>${load > 0 ? x.trips : '—'}</td>
    </tr>`).join('');
  return `<div class="haul-sum">${lines.map(l => `<p>${l}</p>`).join('')}</div>
    <div class="specs"><label>Plan another weight <input type="number" min="0" step="100" inputmode="numeric" data-haulkg value="${kgOverride > 0 ? kgOverride : ''}" placeholder="${fmt(kg)}"> kg</label>
      ${kgOverride > 0 ? '<button type="button" class="btn quiet" data-haulreset>Back to this load</button>' : ''}</div>
    <div class="scroll"><table class="mounts"><thead><tr><th>Mount</th><th>Carries (kg)</th><th>Cheapest price</th><th>Silver per kg</th><th>Trips</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Carry weight is the mount's own load from the game files (Elder's Transport Ox 3,200 kg, Transport Mammoth 22,520 kg); your bag and character carry a bit more. Horses and mules add no carry weight. The Mammoth is the slowest (+30% speed).</p>`;
}
