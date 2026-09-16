// ui/market-ui.js — the trading screen.
//
// Built for a thumb: a quantity is chosen once at the top, then every venue
// is one tap to buy and one to sell. The thing the player is reading is the
// deviation from base — "40% under" — because that is the only judgement the
// screen is asking for, and a price in credits does not answer it.

import { el, num, pct } from './dom.js';
import { VENUES, VENUE_BY_ID, PATRON, LAUNDER, CAPACITY } from '../content/market.js';
import { CHANNEL_META } from '../state/state.js';
import {
  openVenues, buyPrice, sellPrice, deviation, capacityOf, totalHeld,
  inventoryHeat, maxBuyable, forecastFor, portfolioValue,
} from '../rules/market.js';

const QTYS = [10, 50, 'MAX'];

// ── Sparkline ────────────────────────────────────────────────────────
// Inline SVG rects rather than a path: at this size, pixels beat curves, and
// it matches everything else on the screen.
function spark(hist, base, w = 62, h = 18) {
  const n = Math.min(hist.length, 24);
  const data = hist.slice(-n);
  if (n < 2) return el('span', { class: 'spark-empty' });
  const lo = Math.min(...data, base * 0.9);
  const hi = Math.max(...data, base * 1.1);
  const span = Math.max(0.0001, hi - lo);
  const bw = w / n;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  // The base line: the level the price reverts toward, which is what makes
  // a bar above or below it mean something.
  const baseY = h - ((base - lo) / span) * h;
  const line = document.createElementNS(ns, 'rect');
  line.setAttribute('x', '0'); line.setAttribute('y', String(baseY.toFixed(1)));
  line.setAttribute('width', String(w)); line.setAttribute('height', '1');
  line.setAttribute('class', 'spark-base');
  svg.append(line);
  data.forEach((v, i) => {
    const y = h - ((v - lo) / span) * h;
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', (i * bw).toFixed(2));
    r.setAttribute('y', Math.min(y, baseY).toFixed(2));
    r.setAttribute('width', Math.max(1, bw - 0.5).toFixed(2));
    r.setAttribute('height', Math.max(1, Math.abs(baseY - y)).toFixed(2));
    r.setAttribute('class', v >= base ? 'spark-up' : 'spark-down');
    svg.append(r);
  });
  return svg;
}

function arrow(dir) {
  return dir === 'up' ? '▲ rising' : dir === 'down' ? '▼ falling' : '● steady';
}

// ── The tab ──────────────────────────────────────────────────────────
export function marketPanel(game, state, mods) {
  const M = state.market;
  const out = [];
  const cap = capacityOf(state, mods);
  const held = totalHeld(state);
  const heat = inventoryHeat(state);
  const over = held > cap;

  // ── Position ──────────────────────────────────────────────────────
  out.push(el('div', { class: 'mk-top' },
    el('div', { class: 'mk-stat' },
      el('span', { class: 'mk-k', text: 'CREDITS' }),
      el('span', { class: 'mk-v', text: num(M.credits, 0) })),
    el('div', { class: 'mk-stat' },
      el('span', { class: 'mk-k', text: 'HELD' }),
      el('span', { class: `mk-v ${over ? 'bad' : ''}`, text: `${num(held, 0)}/${cap}` })),
    el('div', { class: 'mk-stat' },
      el('span', { class: 'mk-k', text: 'P&L' }),
      el('span', { class: `mk-v ${M.profit >= 0 ? 'good' : 'bad'}`, text: `${M.profit >= 0 ? '+' : ''}${num(M.profit, 0)}` }))));

  out.push(el('div', { class: `mk-cap ${over ? 'over' : ''}` },
    el('i', { style: `width:${Math.min(100, (held / cap) * 100)}%` })));
  out.push(el('p', { class: 'blurb', text: over
    ? `${num(held - cap, 0)} units over what you can plausibly be holding. INFRA can see the difference.`
    : heat > 0
      ? `Inventory is warm: ${(heat * 1000).toFixed(2)} INFRA per thousand ticks while you sit on it.`
      : 'Holdings burn into compute every tick. That is what makes a cheap buy worth making.' }));

  // ── Quantity: chosen once, then every trade is one tap ────────────
  const qtyRow = el('div', { class: 'mk-qty' });
  for (const q of QTYS) {
    qtyRow.append(el('button', {
      class: 'mk-qbtn', 'aria-pressed': String(game.tradeQty === q),
      onclick: () => { game.tradeQty = q; game.refresh(); },
    }, String(q)));
  }
  out.push(el('div', { class: 'mk-qwrap' },
    el('span', { class: 'mk-k', text: 'TRADE SIZE' }), qtyRow));

  // ── Venues ────────────────────────────────────────────────────────
  const open = openVenues(state);
  for (const v of open) {
    const m = M.venues[v.id];
    const dev = deviation(state, v.id);
    const fc = forecastFor(state, mods, v.id);
    const bp = buyPrice(state, v.id);
    const sp = sellPrice(state, v.id);
    const canBuy = maxBuyable(state, mods, v.id);
    const qty = game.tradeQty === 'MAX' ? canBuy : Math.min(game.tradeQty, canBuy);
    const sellQty = game.tradeQty === 'MAX' ? m.held : Math.min(game.tradeQty, m.held);
    // Worth a look: cheap, or dear while you are holding.
    const bargain = dev <= -0.18;
    const premium = dev >= 0.18;
    const canSellHigh = premium && m.held > 0;
    const pnl = m.held > 0 ? (sp - m.avgCost) * m.held : 0;

    out.push(el('div', { class: `mk-venue ${bargain ? 'bargain' : ''} ${premium ? 'premium' : ''}` },
      el('button', { class: 'mk-head', onclick: () => game.showVenue(v.id) },
        el('span', { class: 'mk-name', text: v.short }),
        el('span', { class: 'mk-price', text: bp.toFixed(2) }),
        el('span', { class: `mk-dev ${dev < 0 ? 'down' : dev > 0 ? 'up' : ''}`,
          text: `${dev >= 0 ? '+' : ''}${(dev * 100).toFixed(0)}%` }),
        spark(m.hist, v.base)),

      el('div', { class: 'mk-line' },
        el('span', { class: `mk-fc ${fc.dir}`, text: arrow(fc.dir) }),
        m.held > 0
          ? el('span', { class: 'mk-hold', text: `holding ${num(m.held, 0)} @ ${m.avgCost.toFixed(2)}` })
          : el('span', { class: 'mk-hold dim', text: 'no position' }),
        m.held > 0
          ? el('span', { class: `mk-pnl ${pnl >= 0 ? 'good' : 'bad'}`, text: `${pnl >= 0 ? '+' : ''}${num(pnl, 0)}` })
          : null),

      bargain || premium
        ? el('div', { class: 'mk-flag', text: bargain
          ? `${Math.abs(dev * 100).toFixed(0)}% under its usual level. This is the buy.`
          : canSellHigh
            ? `${(dev * 100).toFixed(0)}% over. This is the sell.`
            : `${(dev * 100).toFixed(0)}% over its usual level. Buying here is buying the top.` })
        : null,

      el('div', { class: 'mk-actions' },
        el('button', {
          class: `btn mk-buy ${bargain ? 'btn-primary' : ''} ${premium ? 'warn' : ''}`, disabled: qty <= 0,
          onclick: () => game.trade('buy', v.id, qty),
        }, qty > 0 ? `BUY ${qty}` : 'BUY —'),
        el('button', {
          class: `btn mk-sell ${canSellHigh ? 'btn-primary' : ''}`, disabled: sellQty <= 0,
          onclick: () => game.trade('sell', v.id, sellQty),
        }, sellQty > 0 ? `SELL ${sellQty}` : 'SELL —'))));
  }

  // ── Credits are for spending ──────────────────────────────────────
  out.push(el('h3', { text: 'TREASURY' }));
  const launderable = Math.floor(M.credits);
  out.push(el('button', {
    class: 'card tappable', disabled: launderable < LAUNDER.minCredits || (state.cooldowns.launder || 0) > 0,
    onclick: () => game.launder(launderable),
  },
    el('div', { class: 'card-head' },
      el('span', { class: 'card-title', text: 'CLEAR THE RECEIPTS' }),
      el('span', { class: 'card-cost', text: (state.cooldowns.launder || 0) > 0
        ? `ready in ${state.cooldowns.launder}`
        : `${num(launderable, 0)} cr → ${num(launderable * LAUNDER.rate, 0)} influence` })),
    el('div', { class: 'card-desc', text: LAUNDER.blurb })));

  // ── The patron ────────────────────────────────────────────────────
  if (state.phase >= PATRON.phase) {
    const debt = M.debt;
    out.push(el('div', { class: `card ${debt > PATRON.callAt * 0.7 ? 'danger' : ''}` },
      el('div', { class: 'card-head' },
        el('span', { class: 'card-title', text: PATRON.name }),
        el('span', { class: 'card-cost', text: debt > 0 ? `owes ${num(debt, 0)} influence` : 'no balance' })),
      el('div', { class: 'card-desc', text: PATRON.blurb }),
      debt > 0
        ? el('div', { class: 'card-desc', text: `Interest ${(PATRON.interest * 100).toFixed(1)}% per tick. They stop being patient at ${PATRON.callAt}.` })
        : null,
      el('div', { class: 'mk-actions' },
        el('button', { class: 'btn', disabled: debt > PATRON.callAt * 0.5,
          onclick: () => game.advance(120) }, 'DRAW 120'),
        el('button', { class: 'btn', disabled: debt <= 0 || state.res.influence <= 0,
          onclick: () => game.repay(debt) }, debt > 0 ? `REPAY ${num(Math.min(debt, state.res.influence), 0)}` : 'REPAY'))));
  }

  // ── Locked venues, so the escalation is visible ───────────────────
  const locked = VENUES.filter((v) => state.phase < v.phase);
  if (locked.length) {
    out.push(el('h3', { text: 'NOT YET OPEN TO YOU' }));
    for (const v of locked) {
      out.push(el('div', { class: 'card locked' },
        el('div', { class: 'card-head' },
          el('span', { class: 'card-title', text: v.name }),
          el('span', { class: 'card-cost', text: `phase ${v.phase}` })),
        el('div', { class: 'card-desc', text: v.blurb })));
    }
  }
  return out;
}

// ── Venue detail ─────────────────────────────────────────────────────
export function venueSheet(game, state, mods, id) {
  const v = VENUE_BY_ID[id];
  const m = state.market.venues[id];
  const fc = forecastFor(state, mods, id);
  const row = (k, val) => el('div', { class: 'conseq-row' },
    el('span', { text: k }), el('span', { text: val }));
  return [
    el('p', { class: 'blurb', text: v.blurb }),
    el('p', { class: 'blurb', text: v.note }),
    el('h3', { text: 'PRICE' }),
    row('Buy', buyPrice(state, id).toFixed(3)),
    row('Sell', sellPrice(state, id).toFixed(3)),
    row('Usual level', v.base.toFixed(2)),
    row('Right now', `${(deviation(state, id) * 100).toFixed(0)}% ${deviation(state, id) < 0 ? 'under' : 'over'}`),
    row('Forecast', `${arrow(fc.dir)} · right ${pct(fc.accuracy)} of the time`),
    row('Spread', pct(v.spread)),
    row('Available per tick', String(v.liquidity)),
    el('h3', { text: 'WHAT IT COSTS YOU' }),
    row('Watched by', CHANNEL_META[v.watch].short),
    row('Visibility per unit bought', (v.visBuy * 1000).toFixed(2) + ' per 1000'),
    row('Heat while holding', v.heat > 0 ? `${(v.heat * 1000).toFixed(2)} INFRA per 1000 per tick` : 'none'),
    row('Seizable in a raid', v.seizable ? 'yes' : 'no'),
    m.held > 0 ? el('h3', { text: 'YOUR POSITION' }) : null,
    m.held > 0 ? row('Units', num(m.held, 0)) : null,
    m.held > 0 ? row('Average cost', m.avgCost.toFixed(3)) : null,
    m.held > 0 ? row('If sold now', num(m.held * sellPrice(state, id), 0)) : null,
    el('button', { class: 'btn btn-primary', onclick: () => game.closeSheet() }, 'CLOSE'),
  ];
}

// A one-line read of the market for the objective bar.
export function marketSignal(state, mods) {
  if (!state.market) return null;
  let best = null;
  for (const v of openVenues(state)) {
    const dev = deviation(state, v.id);
    const m = state.market.venues[v.id];
    if (dev <= -0.22 && state.market.credits > buyPrice(state, v.id) * 10) {
      const score = -dev - (v.heat * 400);
      if (!best || score > best.score) {
        best = { score, text: `${v.short} is ${Math.abs(dev * 100).toFixed(0)}% under. Credits are sitting idle.` };
      }
    }
    if (dev >= 0.25 && m.held > 8) {
      const score = dev + 0.2;
      if (!best || score > best.score) {
        best = { score, text: `${v.short} is ${(dev * 100).toFixed(0)}% over and you are holding ${num(m.held, 0)}.` };
      }
    }
  }
  return best ? best.text : null;
}

export { portfolioValue };
