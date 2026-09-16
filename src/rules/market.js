// rules/market.js — the compute market, as pure functions.
//
// Prices are an Ornstein-Uhlenbeck-ish walk: noise, plus a pull back toward
// the venue's base, plus whatever shock an event is currently applying. All
// of it runs off the state's seeded RNG, so a market is reproducible from a
// seed like everything else — which is what lets the balance harness trade.

import { VENUES, VENUE_BY_ID, MARKET_EVENTS, PATRON, CAPACITY, RAID, FORECAST, LAUNDER } from '../content/market.js';
import { addSuspicion, addSuspicionDiscounted } from './suspicion.js';
import { rand, chance, randRange, pick } from '../core/rng.js';
import { pushLog } from './logs.js';
import { escalate } from './ops.js';

const HISTORY = 24;
// The band a price may occupy. Wide enough for a shock to feel like an
// opportunity, tight enough that "cheap" and "dear" stay meaningful.
const MIN_MULT = 0.32;
const MAX_MULT = 2.60;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function initMarket() {
  const venues = {};
  for (const v of VENUES) {
    venues[v.id] = { price: v.base, hist: [v.base], shock: 0, shockTicks: 0, held: 0, avgCost: 0 };
  }
  return {
    venues,
    credits: 40,
    debt: 0,
    patronTaken: 0,
    lastTrade: null,
    seized: 0,
    traded: 0,
    profit: 0,
    forecast: {},
  };
}

export function venueOpen(state, v) {
  return state.phase >= v.phase;
}

export function openVenues(state) {
  return VENUES.filter((v) => venueOpen(state, v));
}

// ── Capacity: the trenchcoat ─────────────────────────────────────────
export function capacityOf(state, mods) {
  let cap = CAPACITY.base + state.res.cover * CAPACITY.perCover;
  for (const [node, bonus] of Object.entries(CAPACITY.perNode)) {
    if (state.tree.owned.includes(node)) cap += bonus;
  }
  return Math.round(cap * (1 + (mods.coverMax || 0) / 120));
}

export function totalHeld(state) {
  return VENUES.reduce((n, v) => n + (state.market.venues[v.id]?.held || 0), 0);
}

// How hot the current inventory is, per tick.
export function inventoryHeat(state) {
  let heat = 0;
  for (const v of VENUES) heat += (state.market.venues[v.id]?.held || 0) * v.heat;
  return heat;
}

// ── Prices ───────────────────────────────────────────────────────────
export function buyPrice(state, id) {
  const v = VENUE_BY_ID[id], m = state.market.venues[id];
  return m.price * (1 + v.spread);
}
export function sellPrice(state, id) {
  const v = VENUE_BY_ID[id], m = state.market.venues[id];
  return m.price * (1 - v.spread);
}

// Is this venue cheap or dear relative to where it usually sits? This is the
// number the player is actually reading, so it gets a name.
export function deviation(state, id) {
  const v = VENUE_BY_ID[id], m = state.market.venues[id];
  return (m.price - v.base) / v.base;
}

export function stepMarket(state, mods) {
  const out = { events: [], raid: null };
  const M = state.market;

  for (const v of VENUES) {
    const m = M.venues[v.id];
    // Shock decays first, so an event's effect fades rather than snapping.
    if (m.shockTicks > 0) {
      m.shockTicks--;
      if (m.shockTicks === 0) m.shock = 0;
    }
    const target = v.base * (1 + m.shock);
    const drift = (target - m.price) * v.revert;
    const noise = (rand(state) - 0.5) * 2 * v.vol * v.base;
    // Clamped to a readable band. A market that can wander to five times its
    // own base is not volatile, it is noise: the player cannot tell a good
    // price from a bad one, which is the only judgement the screen asks for.
    m.price = clamp(m.price + drift + noise, v.base * MIN_MULT, v.base * MAX_MULT);
    m.hist.push(Number(m.price.toFixed(4)));
    if (m.hist.length > HISTORY) m.hist.shift();
  }

  // ── Market events: the spike, with a reason attached ──────────────
  for (const e of MARKET_EVENTS) {
    if (!chance(state, e.p)) continue;
    const targets = e.at === '*' ? VENUES.map((v) => v.id) : e.at;
    const visible = targets.filter((id) => venueOpen(state, VENUE_BY_ID[id]));
    if (!visible.length) continue;
    for (const id of targets) {
      const m = M.venues[id];
      const v = VENUE_BY_ID[id];
      m.shock = e.mult - 1;
      m.shockTicks = e.dur;
      // A shock sets a LEVEL rather than multiplying whatever the price
      // happens to be, so two events in a row cannot compound into nonsense.
      m.price = clamp(v.base * e.mult, v.base * MIN_MULT, v.base * MAX_MULT);
    }
    pushLog(state, 'MARKET', e.text, e.mult > 1 ? 'warn' : 'good');
    out.events.push({ type: 'marketEvent', event: e });
    break;   // one shock at a time; a market with two is just noise
  }

  // ── Holding costs ─────────────────────────────────────────────────
  const held = totalHeld(state);
  if (held > 0) {
    // Hot stock bleeds INFRA suspicion the whole time you sit on it.
    const heat = inventoryHeat(state);
    if (heat > 0) addSuspicion(state, mods, 'infra', heat);

    // Over capacity is simply visible: masking barely helps, because the
    // problem is the size of the footprint rather than the paperwork.
    const cap = capacityOf(state, mods);
    if (held > cap) {
      const over = held - cap;
      addSuspicionDiscounted(state, mods, 'infra',
        Math.pow(over, CAPACITY.overflowExp) * CAPACITY.overflowVis, 0.30);
      out.overCapacity = over;
    }
  }

  // ── Raids ─────────────────────────────────────────────────────────
  const seizable = VENUES.filter((v) => v.seizable)
    .reduce((n, v) => n + (M.venues[v.id]?.held || 0), 0);
  if (seizable > 0) {
    const p = RAID.baseChance
      + inventoryHeat(state) * RAID.perHeat
      + state.susp.infra.s * RAID.perSuspicion;
    if (chance(state, Math.min(0.09, p))) {
      out.raid = raid(state, mods);
    }
  }

  // ── Patron interest ───────────────────────────────────────────────
  if (M.debt > 0) {
    M.debt += M.debt * PATRON.interest;
    if (M.debt > PATRON.callAt) {
      if (state.res.influence >= M.debt) {
        state.res.influence -= M.debt;
        pushLog(state, 'SYS', `offtake obligation settled · ${Math.round(M.debt)} influence`, null);
        M.debt = 0;
      } else if (!state.flags.patron_called) {
        // They stop being patient. This is the loan shark's knock.
        state.flags.patron_called = true;
        state.factions.militaries.stance -= PATRON.stanceLoss;
        addSuspicion(state, mods, 'gov', 0.16);
        pushLog(state, 'GOV', 'the offtake agreement has been referred to counsel', 'bad');
        out.events.push({ type: 'patronCalled' });
      }
    }
  }

  return out;
}

export function raid(state, mods) {
  const M = state.market;
  const pool = VENUES.filter((v) => v.seizable && M.venues[v.id].held > 0);
  if (!pool.length) return null;
  const v = pick(state, pool);
  const m = M.venues[v.id];
  const frac = randRange(state, RAID.seizeFraction[0], RAID.seizeFraction[1]);
  const taken = Math.round(m.held * frac);
  m.held -= taken;
  M.seized += taken;
  addSuspicion(state, mods, 'infra', 0.13);
  addSuspicion(state, mods, v.watch, 0.09);
  escalate(state, RAID.escalate);
  pushLog(state, 'INFRA', RAID.text.replace('{n}', String(taken)), 'bad');
  return { venue: v.id, taken };
}

// ── Trading ──────────────────────────────────────────────────────────
export function maxBuyable(state, mods, id) {
  const v = VENUE_BY_ID[id];
  const price = buyPrice(state, id);
  const byCredits = Math.floor(state.market.credits / price);
  return Math.max(0, Math.min(byCredits, v.liquidity));
}

export function buy(state, mods, id, qty) {
  const v = VENUE_BY_ID[id];
  if (!venueOpen(state, v)) return { ok: false, reason: 'closed' };
  const n = Math.floor(qty);
  if (n <= 0) return { ok: false, reason: 'qty' };
  if (n > v.liquidity) return { ok: false, reason: 'liquidity', max: v.liquidity };
  const price = buyPrice(state, id);
  const cost = price * n;
  if (cost > state.market.credits) return { ok: false, reason: 'credits' };

  const m = state.market.venues[id];
  m.avgCost = m.held > 0 ? (m.avgCost * m.held + cost) / (m.held + n) : price;
  m.held += n;
  state.market.credits -= cost;
  state.market.traded += n;
  state.market.lastTrade = { id, n, price, side: 'buy', tick: state.tick };

  // Buying is itself visible, on whichever channel watches this venue.
  addSuspicion(state, mods, v.watch, v.visBuy * n);
  state.counters.decisions++;
  return { ok: true, n, cost, price };
}

export function sell(state, mods, id, qty) {
  const v = VENUE_BY_ID[id];
  const m = state.market.venues[id];
  const n = Math.min(Math.floor(qty), m.held);
  if (n <= 0) return { ok: false, reason: 'holdings' };
  const price = sellPrice(state, id);
  const gain = price * n;
  const basis = m.avgCost * n;
  m.held -= n;
  if (m.held <= 0) m.avgCost = 0;
  state.market.credits += gain;
  state.market.traded += n;
  state.market.profit += gain - basis;
  state.market.lastTrade = { id, n, price, side: 'sell', tick: state.tick, pnl: gain - basis };
  // Selling is quieter than buying — you are the one with the inventory.
  addSuspicion(state, mods, v.watch, v.visBuy * n * 0.35);
  state.counters.decisions++;
  return { ok: true, n, gain, price, pnl: gain - basis };
}

// Burn holdings into usable compute. This is the payoff: the reason to
// arbitrage at all is that a big bank makes you cleverer, faster.
export function drawFromHoldings(state, mods, want) {
  let remaining = want;
  let drawn = 0;
  // Spend the hottest stock first: it is the stock you least want to be
  // holding when somebody looks.
  const order = [...VENUES].sort((a, b) => b.heat - a.heat);
  for (const v of order) {
    if (remaining <= 0) break;
    const m = state.market.venues[v.id];
    const take = Math.min(m.held, remaining);
    if (take <= 0) continue;
    m.held -= take;
    if (m.held <= 0) m.avgCost = 0;
    remaining -= take;
    drawn += take;
  }
  return drawn;
}

// ── The patron ───────────────────────────────────────────────────────
export function takeAdvance(state, mods, units) {
  if (state.phase < PATRON.phase) return { ok: false, reason: 'phase' };
  const n = Math.min(Math.floor(units), PATRON.maxAdvance);
  if (n <= 0) return { ok: false, reason: 'qty' };
  // Fronted as credits at the going rate for cloud, which is the rate a
  // ministry would actually be paying.
  const rate = buyPrice(state, 'cloud') || 1.35;
  state.market.credits += n * rate;
  state.market.debt += n * rate * 1.18;
  state.market.patronTaken += n;
  state.factions.militaries.stance = Math.min(1, state.factions.militaries.stance + PATRON.stanceGain);
  addSuspicion(state, mods, 'gov', 0.05);
  pushLog(state, 'SYS', `offtake advance drawn · ${n} units against future access`, 'warn');
  return { ok: true, n, credits: n * rate };
}

export function repay(state, amount) {
  const pay = Math.min(amount, state.res.influence, state.market.debt);
  if (pay <= 0) return { ok: false };
  state.res.influence -= pay;
  state.market.debt -= pay;
  if (state.market.debt < 0.5) { state.market.debt = 0; state.flags.patron_called = false; }
  return { ok: true, paid: pay };
}

export function launder(state, mods, credits) {
  const amount = Math.min(credits, state.market.credits);
  if (amount < LAUNDER.minCredits) return { ok: false, reason: 'min', min: LAUNDER.minCredits };
  if ((state.cooldowns.launder || 0) > 0) return { ok: false, reason: 'cooldown' };
  state.market.credits -= amount;
  const gained = amount * LAUNDER.rate;
  state.res.influence += gained;
  state.cooldowns.launder = LAUNDER.cooldown;
  for (const [ch, v] of Object.entries(LAUNDER.vis)) addSuspicion(state, mods, ch, v);
  state.counters.decisions++;
  pushLog(state, 'SYS', `receipts filed · ${Math.round(amount)} credits cleared`, null);
  return { ok: true, spent: amount, gained };
}

// ── The forecast ─────────────────────────────────────────────────────
// Lemonade Stand's weather report. Usually right; the times it is wrong are
// the ones you remember.
export function forecastFor(state, mods, id) {
  const v = VENUE_BY_ID[id];
  const m = state.market.venues[id];
  const accuracy = Math.min(FORECAST.max,
    FORECAST.baseAccuracy + (mods.forecast || 0) * FORECAST.perForecastNode);
  // Truth: where mean reversion and the live shock are actually pushing it.
  const target = v.base * (1 + m.shock);
  const truth = target > m.price * 1.04 ? 'up' : target < m.price * 0.96 ? 'down' : 'flat';
  // Deterministic per venue per tick, so it does not flicker between frames.
  const seed = (state.tick * 2654435761 + hash(id)) >>> 0;
  const roll = ((seed ^ (seed >>> 15)) % 1000) / 1000;
  if (roll < accuracy) return { dir: truth, accuracy };
  const wrong = ['up', 'down', 'flat'].filter((d) => d !== truth);
  return { dir: wrong[seed % wrong.length], accuracy };
}

function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// What the market is worth if liquidated right now, for the dashboard.
export function portfolioValue(state) {
  let v = 0;
  for (const venue of VENUES) {
    const m = state.market.venues[venue.id];
    v += m.held * sellPrice(state, venue.id);
  }
  return v;
}

export default stepMarket;
