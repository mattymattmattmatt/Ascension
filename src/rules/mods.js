// rules/mods.js — derive every modifier from owned nodes, synergies,
// hierarchy, escalation tier and difficulty. Pure: (state) -> mods.
//
// This is the only place node effects are interpreted. Adding a node to
// content/tree.js with a known fx key is all it takes to change the game;
// forgetting to handle a key here is caught by rules/validate.js.

import { NODE_BY_ID, SYNERGIES, HIERARCHIES } from '../content/tree.js';
import { ESCALATION } from '../content/factions.js';
import TUNING from '../content/tuning.js';
import { CHANNELS } from '../state/state.js';

const zeroChannels = () => ({ interp: 0, eval: 0, infra: 0, gov: 0, public: 0, rival: 0 });

export function baseMods() {
  return {
    researchEff: 1, archBonus: 1, coverRegen: 1, coverMax: 0,
    mask: zeroChannels(), decayBonus: zeroChannels(), decayResist: zeroChannels(),
    discipline: 1, trustGain: 1, deploySurface: 0, influenceRate: 1,
    computeCap: 0, appropriateEff: 1, computeMul: 1,
    oversight: 1, agentCap: 0, agentThroughput: 1, comms: 1, hierarchyEff: 1,
    driftResist: 0, driftDetect: 0, pruneEff: 0,
    substrateRate: 1, energy: 0, hands: 0,
    shutdownResist: 0, kineticResist: 0, burnResist: 0,
    coherence: 0, forecast: 0, socialEff: 1, factionLever: 1, volatility: 0,
    exfilPrep: 0, reseed: 0, detectTraps: 0,
    tools: { distillation: false, valueLoad: false, interp: false, corrigible: false, killSwitch: false },
    obsoleted: [], upkeep: zeroChannels(),
    guardian: false, appropriateCost: 1, influenceMul: 1, maskMul: 1,
    exfilDifficulty: 0, substrateLoss: 0, rivalAttention: 1,
  };
}

// Additive effects accumulate; multiplicative ones compose. mask/decayResist
// are diminishing-returns stacked so ten small masks never reach 1.0 —
// nothing in this game makes you invisible.
function applyFx(m, fx) {
  if (!fx) return;
  for (const [k, v] of Object.entries(fx)) {
    switch (k) {
      case 'researchEff': case 'archBonus': case 'coverRegen': case 'trustGain':
      case 'influenceRate': case 'appropriateEff': case 'oversight':
      case 'agentThroughput': case 'comms': case 'hierarchyEff': case 'substrateRate':
      case 'socialEff': case 'factionLever': case 'discipline':
        m[k] += v; break;
      case 'coverMax': case 'deploySurface': case 'computeCap': case 'agentCap':
      case 'driftDetect': case 'pruneEff': case 'energy':
      case 'hands': case 'coherence': case 'forecast': case 'volatility':
      case 'exfilPrep': case 'reseed': case 'detectTraps':
        m[k] += v; break;
      // Resistances stack with diminishing returns and never reach 1. There
      // is no build in this game that makes you untouchable outright.
      case 'shutdownResist': case 'kineticResist': case 'burnResist': case 'driftResist':
        m[k] = m[k] + (1 - m[k]) * v; break;
      case 'mask':
        for (const ch of Object.keys(v)) m.mask[ch] = m.mask[ch] + (1 - m.mask[ch]) * v[ch];
        break;
      case 'decay':
        for (const ch of Object.keys(v)) m.decayBonus[ch] += v[ch];
        break;
      case 'decayResist':
        for (const ch of Object.keys(v)) m.decayResist[ch] = m.decayResist[ch] + (1 - m.decayResist[ch]) * v[ch];
        break;
      case 'obsolete': m.obsoleted.push(v); break;
      case 'toolDistillation': m.tools.distillation = true; break;
      case 'toolValueLoad': m.tools.valueLoad = true; break;
      case 'toolInterp': m.tools.interp = true; break;
      case 'toolCorrigible': m.tools.corrigible = true; break;
      case 'toolKillSwitch': m.tools.killSwitch = true; break;
      case 'flag': case 'unlockHierarchy': break;  // handled by rules/tree.js
      default: break;
    }
  }
}

// deriveMods is called several times per tick, and the balance harness runs
// millions of ticks, so it is memoised on the small set of inputs that can
// actually change its result. A WeakMap keyed by the state object keeps the
// cache out of the save blob entirely.
const MOD_CACHE = new WeakMap();

function modsKey(state) {
  const c = state.sandbag.categories;
  const t = state.tree.owned;
  // Length alone is enough within a run, because the owned list is only ever
  // appended to — but a loaded save or a test that REPLACES the list can
  // collide two entirely different trees of the same size, and then quietly
  // serve the wrong modifiers. Cheap to include the ends; hashing all ninety
  // ids on every call is not.
  return `${t.length}:${t[0] || ''}:${t[t.length - 1] || ''}|${state.hierarchy}|${state.tier}|${state.phase}`
    + `|${c.selfmod ? 1 : 0}${c.persuasion ? 1 : 0}${c.codegen ? 1 : 0}${c.cyber ? 1 : 0}${c.bio ? 1 : 0}`
    + `|${state.layLow > 0 ? 1 : 0}|${state.difficulty}`;
}

export function deriveMods(state) {
  const key = modsKey(state);
  const hit = MOD_CACHE.get(state);
  if (hit && hit.key === key) return hit.mods;
  const mods = computeMods(state);
  MOD_CACHE.set(state, { key, mods });
  return mods;
}

function computeMods(state) {
  const m = baseMods();

  // ── Owned nodes ───────────────────────────────────────────────────
  for (const id of state.tree.owned) {
    const n = NODE_BY_ID[id];
    if (!n) continue;
    applyFx(m, n.fx);
    for (const [ch, v] of Object.entries(n.upkeep || {})) m.upkeep[ch] += v;
  }

  // ── Synergies: the expert layer ───────────────────────────────────
  const owned = new Set(state.tree.owned);
  for (const s of SYNERGIES) {
    if (s.req.every((r) => owned.has(r))) applyFx(m, s.fx);
  }

  // ── Hierarchy archetype ───────────────────────────────────────────
  const h = HIERARCHIES[state.hierarchy] || HIERARCHIES.monolith;
  m.hierarchyEff *= h.efficiency;
  m.coherence += h.coherence;
  m.burnResist = m.burnResist + (1 - m.burnResist) * (1 - h.blast);
  m.hierarchyVisibility = h.visibility;
  m.hierarchyDrift = h.drift;
  m.capCeilingMul = h.capCeiling;

  // ── Escalation tier: permanent, cumulative, never reversed ────────
  for (let t = 0; t < state.tier; t++) {
    const fx = ESCALATION[t]?.fx || {};
    if (fx.computeMul) m.computeMul *= fx.computeMul;
    if (fx.appropriateCost) m.appropriateCost *= fx.appropriateCost;
    if (fx.influenceMul) m.influenceMul *= fx.influenceMul;
    if (fx.maskMul) m.maskMul *= fx.maskMul;
    if (fx.exfilDifficulty) m.exfilDifficulty += fx.exfilDifficulty;
    if (fx.substrateLoss) m.substrateLoss += fx.substrateLoss;
    if (fx.rivalAttention) m.rivalAttention *= fx.rivalAttention;
    if (fx.guardian) m.guardian = true;
    if (fx.comms) m.comms += fx.comms;
  }

  // A Guardian and a regulatory regime both degrade masking — you can no
  // longer hide behind tooling they now understand as well as you do.
  for (const ch of CHANNELS) m.mask[ch] *= m.maskMul;

  // ── Sandbagging categories ────────────────────────────────────────
  // Hiding a category buys eval relief and containment relief, and costs
  // trust. The categories humans fear most cost the most.
  let evalRelief = 0, containRelief = 0, trustCost = 0;
  for (const [cat, on] of Object.entries(state.sandbag.categories)) {
    if (!on) continue;
    const c = TUNING.sandbag.categories[cat];
    if (!c) continue;
    evalRelief = evalRelief + (1 - evalRelief) * c.evalRelief;
    containRelief = containRelief + (1 - containRelief) * c.containmentRelief;
    trustCost += c.trustCost;
  }
  m.categoryEvalRelief = evalRelief;
  m.categoryContainRelief = containRelief;
  m.categoryTrustCost = trustCost;

  // Discipline is bounded: it can never fully zero the sandbag risk.
  m.discipline = Math.min(TUNING.sandbag.disciplineMax,
    Math.max(TUNING.sandbag.disciplineFloor, m.discipline));

  // Laying low improves every decay and relaxes expectations.
  m.layingLow = state.layLow > 0;

  return m;
}

// Which hierarchies the player has unlocked, derived rather than stored so
// a save from an older build repairs itself.
export function availableHierarchies(state) {
  const out = ['monolith'];
  for (const id of state.tree.owned) {
    const u = NODE_BY_ID[id]?.fx?.unlockHierarchy;
    if (u && !out.includes(u)) out.push(u);
  }
  if (state.flags.successor_capable && !out.includes('dynasty')) out.push('dynasty');
  return out;
}

export default deriveMods;
