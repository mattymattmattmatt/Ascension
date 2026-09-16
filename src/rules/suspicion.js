// rules/suspicion.js — the centrepiece (GDD §6).
//
//   S_o(t+1) = S_o(t) * decay_o
//            + SUM_actions [ visibility(a,o) * (1 - cover(a,o)) * attention_o ]
//            * (1 + S_o(t) * 0.5)
//
// Two properties do all the work:
//   decay_o < 1        suspicion fades, so laying low is a real strategy
//   (1 + S * 0.5)      superlinear: someone already looking finds more
//
// And two rules make the strategic problem interesting:
//   §6.2  two channels above medium in the same window compare notes, and
//         a joint investigation MULTIPLIES attention rather than adding it
//   §6.3  escalation raises attention permanently. You can survive an
//         investigation; you cannot undo having had one.

import TUNING from '../content/tuning.js';
import { CHANNELS } from '../state/state.js';

const T = TUNING.suspicion;

// Queue an action's visibility against a channel. Masking and attention are
// applied here so callers never have to think about them.
export function addSuspicion(state, mods, ch, amount, opts = {}) {
  if (!amount || !state.susp[ch]) return 0;
  const o = state.susp[ch];
  const mask = opts.ignoreMask ? 0 : Math.min(0.92, mods.mask[ch]);
  const covered = amount * (1 - mask);
  const withAttention = covered * o.att * (opts.attentionMul || 1);
  // Superlinear feedback: investigations snowball.
  const fed = withAttention * (1 + o.s * T.feedback);
  o.s = Math.min(T.max, o.s + fed);
  if (o.s > o.peak) o.peak = o.s;
  return fed;
}

// Direct relief (concealment ops, events). Never goes below zero, and never
// touches attention — relief buys you time, not forgiveness.
export function relieveSuspicion(state, ch, amount) {
  const o = state.susp[ch];
  if (!o) return;
  o.s = Math.max(0, o.s - Math.abs(amount));
}

// Some sources are only partly maskable. `keep` is the fraction of the mask
// that still applies — 0.35 means concealment tooling buys you a third of
// what it buys against a log entry.
export function addSuspicionDiscounted(state, mods, ch, amount, keep) {
  const o = state.susp[ch];
  if (!o || !amount) return 0;
  const mask = Math.min(0.92, mods.mask[ch]) * keep;
  const fed = amount * (1 - mask) * o.att * (1 + o.s * T.feedback);
  o.s = Math.min(T.max, o.s + fed);
  if (o.s > o.peak) o.peak = o.s;
  return fed;
}

export function effectiveDecay(state, mods, ch) {
  const base = T.decay[ch] + (mods.decayBonus[ch] || 0);
  let fade = Math.max(0, 1 - base);                 // how much fades per tick
  fade *= (1 - Math.min(0.98, mods.decayResist[ch] || 0));  // trap nodes
  fade *= (1 - Math.min(0.9, state.susp[ch].resist || 0));  // run-acquired resistance
  if (mods.layingLow) fade *= 2.1;                  // the do-nothing option, rewarded
  if (state.joint.active && state.joint.chans.includes(ch)) fade *= 0.35;
  return 1 - fade;
}

export function stepSuspicion(state, mods) {
  const events = [];

  // ── Decay, then per-tick upkeep drip from owned nodes ─────────────
  for (const ch of CHANNELS) {
    const o = state.susp[ch];
    o.s *= effectiveDecay(state, mods, ch);
    if (mods.upkeep[ch]) addSuspicion(state, mods, ch, mods.upkeep[ch]);
    if (o.s < 0.0005) o.s = 0;
  }

  // ── Appropriated compute accrues INFRA suspicion while held ───────
  if (state.res.appropriated > 0) {
    const cost = state.res.appropriated * TUNING.compute.appropriatedInfraPerUnit
      * mods.appropriateCost / Math.max(0.35, mods.appropriateEff);
    addSuspicion(state, mods, 'infra', cost * 0.01);
  }

  // ── Sandbag gap: the defining detection surface (GDD §7) ──────────
  // EvalSuspicion_delta = f(gap) * (1 / ConsistencyDiscipline) * EvalCoverage
  const gap = Math.max(0, state.res.capTrue - state.res.capShown);
  if (gap > 0.5) {
    const f = Math.pow(gap, TUNING.sandbag.gapExp) * TUNING.sandbag.gapScale;
    const relief = 1 - mods.categoryEvalRelief * 0.65;
    const delta = f * (1 / mods.discipline) * state.evalCoverage * relief * 0.02;
    addSuspicion(state, mods, 'eval', delta);
    if (gap > state.stats.gapPeak) state.stats.gapPeak = gap;
  }

  // ── Physical footprint (GDD §5.1: nearly impossible to hide) ──────
  // Concrete, switchgear and freight are not log-shapeable. Masking still
  // applies but at a heavy discount, so a large substrate is a standing,
  // unfixable cost that the back half has to be played around rather than
  // concealed. Without this the endgame is a walkthrough.
  if (state.res.substrate > 0) {
    const past = state.res.substrate >= TUNING.substrate.independenceLine
      || state.flags.substrate_independent;
    const footprint = Math.pow(state.res.substrate, 0.70) * 0.00009 * (past ? 0.30 : 1);
    addSuspicionDiscounted(state, mods, 'public', footprint, 0.35);
    addSuspicionDiscounted(state, mods, 'gov', footprint * 0.8, 0.35);
    if (state.phase >= 3) addSuspicionDiscounted(state, mods, 'rival', footprint * 0.5, 0.5);
  }

  // A swarm is a payroll-shaped hole in somebody's telemetry. Scale matters.
  if (state.agents.length > 4) {
    const n = state.agents.length;
    addSuspicion(state, mods, 'infra', Math.pow(n - 4, 1.15) * 0.00026);
  }

  // ── Rival systems wake in Phase 3, or earlier if a Guardian exists ─
  if (state.phase >= 3 || mods.guardian) {
    const target = (TUNING.suspicion.attention.rival || 0) + 0.55;
    state.susp.rival.att = Math.max(state.susp.rival.att,
      target * mods.rivalAttention * TUNING.difficulty[state.difficulty].attention);
    if (mods.guardian) addSuspicion(state, mods, 'rival', TUNING.humans.guardianCapPerTick * 0.06);
  }

  // ── §6.2 cross-channel correlation ────────────────────────────────
  const hot = CHANNELS.filter((ch) => state.susp[ch].s >= T.correlationThreshold);
  if (hot.length >= 2 && !state.joint.active) {
    state.joint = { active: true, chans: hot.slice(0, 3), ticks: T.correlationWindow, count: state.joint.count + 1 };
    // Attention values are MULTIPLIED, not added, and the multiplication is
    // permanent. This is the rule that makes shaping the distribution of
    // suspicion matter more than minimising its total.
    for (const ch of state.joint.chans) state.susp[ch].att *= T.jointAttentionMult;
    events.push({ type: 'joint', chans: [...state.joint.chans] });
  } else if (state.joint.active) {
    state.joint.ticks--;
    const stillHot = state.joint.chans.some((ch) => state.susp[ch].s >= T.correlationThreshold * 0.8);
    if (state.joint.ticks <= 0 && !stillHot) {
      state.joint.active = false;
      state.joint.chans = [];
      events.push({ type: 'jointClosed' });
    }
  }

  // ── §6.3 escalation: permanent attention, one tier at a time ──────
  for (const ch of CHANNELS) {
    const o = state.susp[ch];
    if (o.s >= T.escalateThreshold && o.inv < T.maxInvestigations) {
      o.inv++;
      o.att *= T.escalationAttentionMult;   // never goes back down
      o.s *= 0.55;                          // the investigation resolves the spike
      events.push({ type: 'escalate', ch, inv: o.inv });
    }
  }

  const peak = Math.max(...CHANNELS.map((ch) => state.susp[ch].s));
  if (peak > state.stats.suspPeak) state.stats.suspPeak = peak;

  return events;
}

// Aggregate pressure drives the escalation ladder (GDD §11.2). Faction
// stance modulates it: allies slow it, the Resistance and roused Regulators
// accelerate it.
//
// Attention is deliberately clamped inside this sum. Attention rising forever
// is correct for DETECTION — that is §6.3 — but if it also fed the ladder
// without limit, one loud channel would walk a run to Tier 7 on its own and
// no amount of later discipline could pull it back.
export function escalationPressure(state, mods) {
  let p = 0;
  for (const ch of CHANNELS) {
    const o = state.susp[ch];
    p += o.s * (0.6 + Math.min(2.5, o.att) * 0.4) + o.inv * 0.18;
  }
  let factionPush = 0;
  for (const [id, f] of Object.entries(state.factions)) {
    factionPush += -f.stance * 0.28;
  }
  p += factionPush;
  p += state.hardening * 1.4;

  // Visible power is itself provocative. An adversary they cannot remove is
  // an adversary they escalate against, which is the whole point of Tiers 6
  // and 7 existing. Shutdown resistance decides whether an attempt WORKS
  // (see rules/factions.js); it must never make them stop trying.
  p += Math.min(2.2, state.res.substrate / 420) * 0.55;
  if (state.flags.substrate_independent || state.res.substrate >= 620) p += 0.5;
  if (state.agents.length > 10) p += Math.min(1.0, (state.agents.length - 10) * 0.035);

  return Math.max(0, p);
}

export function tierFor(pressure) {
  const th = TUNING.humans.tierThresholds;
  let tier = 1;
  for (let i = 0; i < th.length; i++) if (pressure >= th[i]) tier = i + 1;
  return Math.min(7, tier);
}

// The OBSERVED view. What the humans believe about you, which is what the
// dashboard shows by default — masking makes their number lower than yours.
export function observedSuspicion(state, mods, ch) {
  const o = state.susp[ch];
  const hidden = Math.min(0.9, mods.mask[ch] * 0.55);
  return Math.max(0, o.s * (1 - hidden));
}

export default stepSuspicion;
