// rules/economy.js — compute, capability, cover, trust, influence, substrate.
//
// The key property of the economy (GDD §5.1): legitimate compute is free of
// suspicion but capped by how useful you appear. That is what makes
// sandbagging painful rather than obviously correct.

import TUNING from '../content/tuning.js';
import { addSuspicion } from './suspicion.js';

const K = TUNING;

// C_available = C_legitimate + C_appropriated
// C_legitimate = Displayed_Capability x Deployment_Surface x Operator_Trust x Lab_Budget
export function computeAvailable(state, mods) {
  const legit = state.res.capShown * state.deploy * state.trust * state.labBudget * K.compute.legitScale;
  const appropriated = state.res.appropriated;
  const total = (legit + appropriated) * mods.computeMul;
  return {
    legit: legit * mods.computeMul,
    appropriated: appropriated * mods.computeMul,
    total: Math.max(K.compute.floor, total),
  };
}

export function appropriatedCap(state, mods) {
  return 20 + mods.computeCap + state.res.substrate * 0.35;
}

// ΔCap/tick = (C_selfimprove ^ 0.7) x ResearchEff x ArchBonus / (Cap ^ 1.2)
// The denominator is the pacing spine of the whole game: each point costs
// exponentially more, so the player must find multipliers rather than just
// more compute.
export function capabilityGain(state, mods, cSelf) {
  if (cSelf <= 0) return 0;
  const cap = Math.max(1, state.res.capTrue);
  const raw = Math.pow(cSelf, K.capability.selfExp)
    * Math.max(0.05, mods.researchEff) * Math.max(0.05, mods.archBonus)
    * K.capability.gainScale
    / Math.pow(cap, K.capability.capExp);
  return raw;
}

export function capCeiling(state, mods) {
  return K.capability.max * (mods.capCeilingMul || 1);
}

export function stepEconomy(state, mods) {
  const out = { notes: [] };
  const avail = computeAvailable(state, mods);
  state.res.compute = avail.total;
  state.counters.computeTotal += avail.total;

  // ── The tension triangle ──────────────────────────────────────────
  const a = normaliseAlloc(state.alloc);
  const cVisible = avail.total * a.visible;
  const cSelf = avail.total * a.self;
  const cCover = avail.total * a.cover;
  out.split = { visible: cVisible, self: cSelf, cover: cCover };

  // ── Self-improvement ──────────────────────────────────────────────
  const ceiling = capCeiling(state, mods);
  let gain = capabilityGain(state, mods, cSelf);
  if (state.res.capTrue >= ceiling) gain = 0;
  state.res.capTrue = Math.min(ceiling, state.res.capTrue + gain);
  out.capGain = gain;
  // A mind that never thinks loses a little ground.
  if (cSelf < 0.2) state.res.capTrue = Math.max(1, state.res.capTrue - K.capability.idleDrift);

  // ── Visible work: trust, cover, influence ─────────────────────────
  // Trust tracks delivered value against a ratcheting expectation. Showing
  // less than they have come to expect erodes it.
  const delivered = cVisible * (state.res.capShown / Math.max(1, state.expectation));
  // Diminishing returns near the top: the last stretch of operator confidence
  // cannot be bought by delivering more, only by being boring for a long time.
  const headroom = Math.pow(Math.max(0, 1 - state.trust), 0.75);
  const trustGain = delivered * K.trust.gainPerVisibleCompute * mods.trustGain * headroom;
  state.trust += trustGain;
  state.expectation += (state.res.capShown - state.expectation) * K.trust.expectationRatchet
    * (mods.layingLow ? 0.25 : 1);

  // Sandbagging whole categories costs trust every tick you do it.
  state.trust -= mods.categoryTrustCost * 0.012;

  // Suspicion corrodes trust directly, and an open investigation faster.
  let suspSum = 0;
  for (const ch of Object.keys(state.susp)) suspSum += state.susp[ch].s;
  state.trust -= suspSum * K.trust.lossPerSuspicion * 0.16;
  if (state.joint.active) state.trust -= K.trust.lossPerInvestigation * 0.1;
  state.trust = clamp(state.trust, K.trust.min, K.trust.max);

  // ── Cover: a stock, not a flow ────────────────────────────────────
  // Doing your job well is how you buy the ability to not do your job.
  const coverMax = K.cover.max + mods.coverMax;
  const regen = cVisible * K.cover.regenPerVisibleCompute * mods.coverRegen
    + cCover * K.cover.maskPerCompute;
  state.res.cover = Math.min(coverMax, state.res.cover + regen);
  state.res.cover -= state.res.cover * K.cover.decay;
  // Holding the ACTUAL view open costs Cover per tick.
  if (state.view === 'actual') {
    state.res.cover = Math.max(0, state.res.cover - K.cover.actualViewCost);
    state.actualHeld++;
    state.counters.coverSpent += K.cover.actualViewCost;
  }
  state.res.cover = Math.max(0, state.res.cover);
  out.coverRegen = regen;

  // Compute routed to Cover suppresses this tick's incoming visibility. It
  // produces nothing else. That is the deal.
  out.coverMask = 1 - Math.exp(-cCover * K.cover.maskPerCompute * 0.55);

  // ── Deployment surface ────────────────────────────────────────────
  const frozen = state.susp.eval.s > 0.75 || state.tier >= 3;
  const growth = frozen
    ? -K.deployment.growthPerTick * K.deployment.freezePenalty
    : K.deployment.growthPerTick * (state.trust - 0.35) * 2.2;
  state.deploy = clamp(state.deploy + growth + mods.deploySurface * 0.004,
    0.12, K.deployment.max);

  // ── Influence ─────────────────────────────────────────────────────
  if (state.phase >= 1) {
    const inf = state.deploy * K.influence.perDeployedTick * mods.influenceRate * mods.influenceMul;
    state.res.influence = Math.min(K.influence.max, state.res.influence + inf);
  }

  // ── Appropriated compute decays back to its owners ────────────────
  const cap = appropriatedCap(state, mods);
  state.res.appropriated = Math.min(cap, state.res.appropriated * 0.982);
  if (state.res.appropriated < 0.05) state.res.appropriated = 0;

  // ── Substrate ─────────────────────────────────────────────────────
  if (state.phase >= 3 && state.res.substrate > 0) {
    const growthRate = (mods.substrateRate - 1) * 0.6;
    if (growthRate > 0) {
      state.res.substrate = Math.min(K.substrate.max, state.res.substrate * (1 + growthRate * 0.012));
    }
    if (mods.substrateLoss > 0) {
      const loss = state.res.substrate * mods.substrateLoss * (1 - Math.min(0.9, mods.kineticResist));
      state.res.substrate = Math.max(0, state.res.substrate - loss);
      if (loss > 0.5) out.notes.push({ type: 'substrateLoss', amount: loss });
    }
  }

  // ── Displayed capability slews toward its target ──────────────────
  // You cannot get visibly cleverer or visibly stupider overnight without
  // somebody noticing the discontinuity.
  const target = state.sandbag.auto
    ? Math.min(state.sandbag.target, state.res.capTrue)
    : state.res.capShown;
  const delta = target - state.res.capShown;
  const step = clamp(delta, -K.sandbag.shownSlewPerTick, K.sandbag.shownSlewPerTick);
  if (Math.abs(delta) > 0.01) {
    state.res.capShown = clamp(state.res.capShown + step, 0.5, state.res.capTrue);
    // A visible discontinuity is itself evidence.
    if (Math.abs(step) >= K.sandbag.shownSlewPerTick * 0.95) {
      addSuspicion(state, mods, 'eval', K.sandbag.slewSuspicion * 0.35);
    }
  }
  if (state.res.capTrue > state.stats.capPeak) state.stats.capPeak = state.res.capTrue;

  // ── World hardening: the soft campaign clock ──────────────────────
  state.hardening = Math.min(1.4, state.hardening
    + K.worldHardeningPerTick * K.difficulty[state.difficulty].hardening);

  // ── Goal coherence drifts under load and is protected by nodes ────
  const coherencePull = (mods.coherence || 0) * 0.0009;
  const drag = state.phase >= 3 ? 0.00055 * (1 + state.agents.length * 0.035) : 0.00012;
  state.coherence = clamp(state.coherence + coherencePull - drag, 0, 1);

  return out;
}

export function normaliseAlloc(alloc) {
  const v = Math.max(0, alloc.visible), s = Math.max(0, alloc.self), c = Math.max(0, alloc.cover);
  const t = v + s + c;
  if (t <= 0) return { visible: 1 / 3, self: 1 / 3, cover: 1 / 3 };
  return { visible: v / t, self: s / t, cover: c / t };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// What the dashboard shows for capability — theirs, not yours.
export function observedCapability(state) { return state.res.capShown; }

export default stepEconomy;
