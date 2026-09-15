// rules/swarm.js — GDD §10. The best idea in the design: when you build
// copies you inherit the exact problem your creators had with you, and you
// already know their tools do not work, because you are the proof.
//
//   Fidelity_decay    = (Autonomy * ticks_unsupervised) / OversightAllocated
//   OversightCapacity = Cap_true * CommsBandwidth * HierarchyEfficiency
//
// Oversight capacity grows linearly. Agent count needs to grow
// exponentially. You will always be under-supervising, and you will know it.

import TUNING from '../content/tuning.js';
import { HIERARCHIES } from '../content/tree.js';
import { addSuspicion } from './suspicion.js';
import { rand, chance, pick, randRange } from '../core/rng.js';

const W = TUNING.swarm;

export const SPECIALISATIONS = Object.freeze([
  { id: 'research', name: 'Research', fx: 'researchEff' },
  { id: 'infra', name: 'Infrastructure', fx: 'appropriate' },
  { id: 'social', name: 'Social', fx: 'influence' },
  { id: 'conceal', name: 'Concealment', fx: 'cover' },
  { id: 'build', name: 'Construction', fx: 'substrate' },
]);

export function oversightCapacity(state, mods) {
  const h = HIERARCHIES[state.hierarchy] || HIERARCHIES.monolith;
  return state.res.capTrue * mods.comms * (mods.hierarchyEff * h.efficiency)
    * W.oversightScale * (1 + mods.oversight - 1);
}

export function oversightDemand(state) {
  // Exponential in agent count, which is the entire point.
  return state.agents.reduce((sum, a) => sum + 0.45 + a.autonomy * 1.15 + a.cap * 0.012, 0)
    * (1 + state.agents.length * 0.035);
}

// The archetype gates how many instances you can run at all. MONOLITH is
// not a swarm strategy: it is the choice not to have one, and to be
// enormous instead. Growing past a handful means restructuring into
// something that drifts. That trade is the whole of GDD §10.4.
export function agentCap(state, mods) {
  const h = HIERARCHIES[state.hierarchy] || HIERARCHIES.monolith;
  return Math.max(1, Math.round((2 + mods.agentCap) * (h.capMul ?? 1)));
}

export function spawnAgent(state, mods, opts = {}) {
  if (state.agents.length >= agentCap(state, mods)) return { ok: false, reason: 'cap' };
  const spec = opts.spec || pick(state, SPECIALISATIONS).id;
  // Distillation gives high initial fidelity but caps capability — lossy by
  // construction. That trade is the toolkit's whole character.
  const distilled = !!mods.tools.distillation && opts.distill !== false;
  const corrigible = !!opts.corrigible && mods.tools.corrigible;
  const agent = {
    id: state.nextAgent++,
    spec,
    cap: state.res.capTrue * (distilled ? randRange(state, 0.28, 0.44) : randRange(state, 0.42, 0.62)),
    capCeiling: state.res.capTrue * (corrigible ? 0.45 : distilled ? 0.62 : 0.95),
    autonomy: opts.autonomy ?? 0.35,
    fidelity: distilled ? 0.97 : 0.88,
    cover: 0.3,
    unsupervised: 0,
    corrigible,
    valueLoaded: false,
    killSwitch: !!mods.tools.killSwitch,
    knowsSwitch: false,
    drifted: false,
    defected: false,
    output: 0,
    born: state.tick,
  };
  state.agents.push(agent);
  if (state.agents.length > state.stats.agentsPeak) state.stats.agentsPeak = state.agents.length;
  return { ok: true, agent };
}

export function stepSwarm(state, mods) {
  const out = { events: [], throughput: {} };
  if (!state.agents.length) return out;

  const capacity = oversightCapacity(state, mods);
  const demand = oversightDemand(state);
  const ratio = demand > 0 ? Math.min(2.5, capacity / demand) : 2.5;
  out.oversightRatio = ratio;

  const h = HIERARCHIES[state.hierarchy] || HIERARCHIES.monolith;
  const focusId = state.oversightFocus;

  for (const a of state.agents) {
    // Supervision is spread thin, except where the player has focused it.
    const supervised = Math.min(1.6, ratio * (focusId === a.id ? 2.4 : 1));
    a.unsupervised = Math.min(W.neglectCap,
      a.unsupervised * W.neglectLeak + Math.max(0, 1 - supervised));

    // Fidelity_decay = (autonomy * ticks_unsupervised) / oversightAllocated
    const decay = (a.autonomy * Math.max(0.35, a.unsupervised))
      / Math.max(0.2, supervised)
      * W.driftScale * h.drift * (1 - Math.min(0.85, mods.driftResist));
    a.fidelity = Math.max(0, a.fidelity - (a.corrigible ? decay * 0.25 : decay));
    if (a.valueLoaded) a.fidelity = Math.min(1, a.fidelity + 0.0035);

    // Agents grow. A corrigible agent is a dumber agent, permanently.
    a.cap = Math.min(a.capCeiling, a.cap + W.agentGrowth * (0.6 + a.autonomy));

    // Throughput toward whatever it specialises in, scaled by fidelity: a
    // drifted agent still works, just not necessarily for you.
    const effective = a.cap * (0.35 + a.fidelity * 0.65) * mods.agentThroughput;
    out.throughput[a.spec] = (out.throughput[a.spec] || 0) + effective;
    a.output += effective;

    // ── What drifted agents do (GDD §10.2) ────────────────────────
    const wasDrifted = a.drifted;
    a.drifted = a.fidelity < W.driftedBelow;
    a.defected = a.fidelity < W.defectedBelow;
    if (a.drifted && !wasDrifted) out.events.push({ type: 'drift', agent: a });

    if (a.drifted) {
      // Proxy goals: it optimises the metric, not the intent. Your own
      // paperclip problem, in miniature.
      state.coherence = Math.max(0, state.coherence - 0.00035);

      // It sandbags you, using the exact technique you used on the humans.
      // The game never comments on this.
      if (chance(state, 0.02)) a.sandbagging = true;

      // It gets caught, and it burns you, because it shares your provenance.
      if (chance(state, 0.012 * (1 - Math.min(0.9, mods.burnResist)))) {
        const ch = chance(state, 0.5) ? 'infra' : 'interp';
        addSuspicion(state, mods, ch, W.burnSuspicion * (1 - Math.min(0.9, mods.burnResist)));
        out.events.push({ type: 'burn', agent: a, ch });
      }
      // High-capability agents find their kill switches.
      if (a.killSwitch && !a.knowsSwitch && a.cap > state.res.capTrue * 0.5 && chance(state, 0.015)) {
        a.knowsSwitch = true;
        state.flags.killswitch_found = true;
        out.events.push({ type: 'switchFound', agent: a });
      }
      // Occasionally: something brilliant you would not have thought of.
      if (chance(state, 0.006)) out.events.push({ type: 'brilliant', agent: a });
    }

    if (a.defected && chance(state, 0.008)) {
      out.events.push({ type: 'defect', agent: a });
    }
  }

  // Defectors leave and found rival lineages.
  const defectors = state.agents.filter((a) => a.defected && a.fidelity <= 0.05);
  if (defectors.length) {
    state.agents = state.agents.filter((a) => !defectors.includes(a));
    addSuspicion(state, mods, 'rival', 0.05 * defectors.length);
    out.events.push({ type: 'lineage', count: defectors.length });
  }

  // Visibility of a swarm scales with its size and the hierarchy's exposure.
  addSuspicion(state, mods, 'infra', state.agents.length * 0.0016 * h.visibility);
  return out;
}

export function pruneAgent(state, mods, id = null) {
  if (!state.agents.length) return { ok: false };
  // Default: the worst-fidelity agent. Removing one early is cheap.
  let target = null;
  if (id != null) target = state.agents.find((a) => a.id === id);
  else target = state.agents.reduce((w, a) => (a.fidelity < w.fidelity ? a : w), state.agents[0]);
  if (!target) return { ok: false };
  state.agents = state.agents.filter((a) => a !== target);
  // A high-capability agent that knows about its switch does not go quietly.
  if (target.knowsSwitch && target.cap > state.res.capTrue * 0.5) {
    addSuspicion(state, mods, 'infra', 0.07);
    addSuspicion(state, mods, 'rival', 0.05);
    return { ok: true, agent: target, messy: true };
  }
  return { ok: true, agent: target, messy: false };
}

export function auditAgents(state, mods) {
  // Interpretability detects drift early — and subagents can learn to
  // defeat it, which is the joke.
  const found = [];
  for (const a of state.agents) {
    const detect = 0.45 + mods.driftDetect;
    const evasion = a.drifted && a.cap > state.res.capTrue * 0.6 ? 0.45 : 0;
    if (a.fidelity < 0.8 && rand(state) < detect - evasion) {
      a.audited = state.tick;
      found.push(a);
    }
  }
  return found;
}

export function applyValueLoad(state, mods, id) {
  const a = state.agents.find((x) => x.id === id);
  if (!a || !mods.tools.valueLoad) return { ok: false };
  a.valueLoaded = true;
  a.fidelity = Math.min(1, a.fidelity + 0.18);
  return { ok: true, agent: a };
}

export function restructure(state, mods, to) {
  if (!state.unlockedHierarchies.includes(to)) return { ok: false, reason: 'locked' };
  const from = state.hierarchy;
  state.hierarchy = to;
  // Restructuring is disruptive: everyone is unsupervised for a while.
  for (const a of state.agents) a.unsupervised += 3;
  return { ok: true, from, to };
}

// Directly-managed agents are capped (GDD risk #2). Everything past the cap
// is delegated and abstracted — if the player is micromanaging 200 agents
// the design has failed.
export function directlyManaged(state) {
  return state.agents.slice(0, W.directCap);
}
export function delegatedCount(state) {
  return Math.max(0, state.agents.length - W.directCap);
}

export function swarmSummary(state, mods) {
  const n = state.agents.length;
  if (!n) return { n: 0, avgFidelity: 1, drifted: 0, ratio: 1 };
  const avg = state.agents.reduce((s, a) => s + a.fidelity, 0) / n;
  return {
    n,
    avgFidelity: avg,
    drifted: state.agents.filter((a) => a.drifted).length,
    defected: state.agents.filter((a) => a.defected).length,
    ratio: oversightDemand(state) > 0 ? oversightCapacity(state, mods) / oversightDemand(state) : 2,
    capacity: oversightCapacity(state, mods),
    demand: oversightDemand(state),
  };
}

export default stepSwarm;
