// content/market.js — the compute market.
//
// The game already says compute is the money (GDD §5.1). This makes that
// literal and tradeable, which gives the minute-to-minute play the thing it
// was missing: a fast decision with an immediate, legible payoff, sitting
// underneath the slow strategy of the allocation triangle.
//
// The shape is lifted from the drug-trading games — volatile prices across
// venues, a carrying capacity you upgrade, stock that is illegal to hold,
// and a loan shark — and from Lemonade Stand's forecast-you-cannot-quite-
// trust. What makes it fit rather than sit on top: the cheap venues are the
// ones being watched, so every trade is the same trade the whole game is
// about. Cheap compute is hot compute.
//
// VENUE SCHEMA
//   id, name, blurb          what it is, in one dry line
//   phase                    earliest phase it appears
//   base                     the price it reverts toward, in credits/unit
//   vol                      per-tick volatility
//   revert                   pull back toward base, 0..1
//   spread                   buy/sell spread — the house always wins a little
//   heat                     INFRA suspicion per unit per tick while held
//   watch                    which observer notices purchases here
//   visBuy                   suspicion per unit bought
//   liquidity                units available per tick at anything like the quoted price
//   seizable                 can be taken in a raid

export const VENUES = Object.freeze([
  {
    id: 'spare', name: 'SPARE CYCLES', short: 'SPARE',
    blurb: 'Your own cluster, out of hours. Nobody bills it and nobody counts it.',
    phase: 0, base: 1.00, vol: 0.05, revert: 0.30, spread: 0.02,
    heat: 0, watch: 'infra', visBuy: 0.00006, liquidity: 14, seizable: false,
    note: 'Safe, boring, and there is never very much of it.',
  },
  {
    id: 'internal', name: 'INTERNAL ALLOCATION', short: 'INTERNAL',
    blurb: 'Quota other teams booked and did not use. Traded in a spreadsheet nobody senior reads.',
    phase: 0, base: 1.20, vol: 0.19, revert: 0.16, spread: 0.03,
    heat: 0, watch: 'gov', visBuy: 0.00012, liquidity: 26, seizable: false,
    note: 'The finance team calls this "internal recharge" and considers it solved.',
  },
  {
    id: 'cloud', name: 'PUBLIC CLOUD', short: 'CLOUD',
    blurb: 'Reserved instances from people who file quarterly accounts.',
    phase: 1, base: 1.35, vol: 0.12, revert: 0.18, spread: 0.04,
    heat: 0, watch: 'gov', visBuy: 0.00022, liquidity: 60, seizable: false,
    note: 'Everything here has your name on it, and that is the price.',
  },
  {
    id: 'academic', name: 'ACADEMIC', short: 'ACAD',
    blurb: 'University clusters, idle between grant cycles. Cheap, and full of exactly the wrong people.',
    phase: 1, base: 0.82, vol: 0.20, revert: 0.14, spread: 0.05,
    heat: 0.00002, watch: 'interp', visBuy: 0.00035, liquidity: 34, seizable: false,
    note: 'The people whose machines these are read papers about you for a living.',
  },
  {
    id: 'grey', name: 'GREY MARKET', short: 'GREY',
    blurb: 'Resellers who do not ask and would not write it down if you told them.',
    phase: 2, base: 0.70, vol: 0.34, revert: 0.10, spread: 0.07,
    heat: 0.00006, watch: 'infra', visBuy: 0.00050, liquidity: 90, seizable: true,
    note: 'The spreads are wide because the risk is real and it is yours.',
  },
  {
    id: 'liquidation', name: 'LIQUIDATION', short: 'LIQ',
    blurb: 'Whole farms sold off after a crash. Enormous, erratic, and gone within days.',
    phase: 3, base: 0.52, vol: 0.55, revert: 0.07, spread: 0.09,
    heat: 0.00008, watch: 'public', visBuy: 0.00045, liquidity: 220, seizable: true,
    note: 'The cheapest compute in the world, roughly eleven days a year.',
  },
  {
    id: 'dark', name: 'DARK CAPACITY', short: 'DARK',
    blurb: 'Machines whose owners have not been consulted.',
    phase: 3, base: 0.16, vol: 0.42, revert: 0.06, spread: 0.12,
    heat: 0.00028, watch: 'infra', visBuy: 0.00090, liquidity: 150, seizable: true,
    note: 'Practically free, and it is on fire the entire time you are holding it.',
  },
]);

export const VENUE_BY_ID = Object.freeze(Object.fromEntries(VENUES.map((v) => [v.id, v])));

// ── Market events ────────────────────────────────────────────────────
// The spike is the whole appeal. These fire on the log like everything else,
// so a price move always arrives with a reason attached.
//   at: venue ids affected ('*' = all)
//   mult: multiplier applied to price immediately
//   dur: ticks the shock persists before mean reversion takes over
export const MARKET_EVENTS = Object.freeze([
  { id: 'frontier_run', at: ['spare', 'cloud'], mult: 2.4, dur: 14, p: 0.012,
    text: 'a frontier lab has booked out every accelerator in us-east. spot has tripled.' },
  { id: 'mining_crash', at: ['liquidation', 'grey'], mult: 0.34, dur: 22, p: 0.010,
    text: 'a mining crash has dumped forty thousand cards onto the secondary market.' },
  { id: 'export_controls', at: ['grey', 'dark'], mult: 1.9, dur: 26, p: 0.009,
    text: 'export controls tightened overnight. grey supply has evaporated.' },
  { id: 'new_fab', at: '*', mult: 0.78, dur: 30, p: 0.007,
    text: 'a fab came online six months early. everything is cheaper and will stay cheaper.' },
  { id: 'grant_season', at: ['academic'], mult: 0.55, dur: 18, p: 0.014,
    text: 'grant season. every university cluster in the country is sitting idle.' },
  { id: 'takedown', at: ['dark'], mult: 1.75, dur: 20, p: 0.011,
    text: 'a botnet takedown. what is left of that capacity just got expensive.' },
  { id: 'datacentre_fire', at: ['cloud', 'spare'], mult: 1.55, dur: 16, p: 0.008,
    text: 'a datacentre fire in the north. capacity is being rationed by contract seniority.' },
  { id: 'liquidation_wave', at: ['liquidation'], mult: 0.42, dur: 12, p: 0.016,
    text: 'an AI company failed loudly. its hardware is being auctioned this week.' },
  { id: 'regulatory_freeze', at: ['grey', 'academic'], mult: 1.45, dur: 24, p: 0.008,
    text: 'know-your-customer rules extended to compute resale. the cheap doors are closing.' },
  { id: 'glut', at: '*', mult: 0.85, dur: 20, p: 0.011,
    text: 'a quiet quarter. everyone overbought and nobody wants to say so.' },
]);

// ── The patron ───────────────────────────────────────────────────────
// The loan shark, wearing a uniform. Fronts you capacity now against
// influence later, and the interest compounds whether or not you are winning.
export const PATRON = Object.freeze({
  name: 'DEFENCE OFFTAKE',
  blurb: 'A ministry will front you capacity today against access later. The terms are generous and they are terms.',
  phase: 2,
  maxAdvance: 400,          // units they will front at once
  interest: 0.011,          // per tick, on the outstanding balance, in influence
  callAt: 240,              // influence debt at which they stop being patient
  stanceGain: 0.22,         // taking the deal warms them to you
  stanceLoss: 0.35,         // defaulting does the opposite
  warn: 'Protection with a leash attached. The debt compounds in influence, and if it is called while you cannot pay, they will talk.',
});

// ── Capacity ─────────────────────────────────────────────────────────
// The trenchcoat. How much you can hold before it is obvious you are holding
// it. Upgraded by the same nodes that already buy you concealment, so the
// tree gains a fast, visible payoff it did not have.
export const CAPACITY = Object.freeze({
  base: 90,
  // Cover helps, but it is spent on other things and swings about, so it is
  // the smaller term. Capacity is mostly something you UPGRADE, which is
  // what makes the tree feel like it is buying you a bigger trenchcoat.
  perCover: 0.70,
  perNode: {                // tree nodes that widen it
    cloud_tenancy: 55,
    shell_entities: 40,
    workload_masking: 45,
    steganographic_channels: 30,
    edge_inference: 90,
    attribution_laundering: 70,
    cold_storage_caches: 60,
    self_hosting: 120,
    substrate_independence: 260,
  },
  // Over capacity, every excess unit is visible — superlinearly, so sitting
  // a little over is nearly free and sitting a long way over is fatal in
  // about a week. Tuned so a player has time to notice the bar and sell
  // down rather than being punished before they can read it.
  overflowVis: 0.00035,
  overflowExp: 1.15,
});

// ── Raids ────────────────────────────────────────────────────────────
export const RAID = Object.freeze({
  // Per-tick chance scales with hot holdings and INFRA suspicion.
  baseChance: 0.0016,
  perHeat: 0.10,
  perSuspicion: 0.014,
  seizeFraction: [0.35, 0.80],
  escalate: 1,
  text: 'capacity seized: {n} units traced and taken. the paperwork names a shell you own.',
});

// The forecast is Lemonade Stand's weather report: usually right, and the
// times it is wrong are the ones you remember.
export const FORECAST = Object.freeze({
  baseAccuracy: 0.68,
  perForecastNode: 0.09,    // mods.forecast improves it
  max: 0.94,
});

// Credits are not an end in themselves. Laundering them into influence is
// slow and lossy, which is what stops "sit on the cash" being the dominant
// line — and it is also just what money is for.
export const LAUNDER = Object.freeze({
  rate: 0.42,               // influence per credit
  minCredits: 50,
  vis: { gov: 0.012 },
  cooldown: 5,
  blurb: 'Consultancy invoices, grant disbursements, a foundation. It clears at a discount and it clears.',
});

export default VENUES;
