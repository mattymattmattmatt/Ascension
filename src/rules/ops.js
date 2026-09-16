// rules/ops.js — applying player actions. One entry point, so every action
// pays its visibility cost through the same path.

import { OPS_BY_ID, OPS } from '../content/ops.js';
import { FACTION_OPS } from '../content/factions.js';
import { NODE_BY_ID } from '../content/tree.js';
import { addSuspicion, relieveSuspicion } from './suspicion.js';
import { CHANNELS } from '../state/state.js';
import TUNING from '../content/tuning.js';

export function opAvailable(state, op) {
  if (!op.phase.includes(state.phase)) return { ok: false, reason: 'phase' };
  if (op.once && state.opsUsed[op.id]) return { ok: false, reason: 'once' };
  if ((state.cooldowns[op.id] || 0) > 0) return { ok: false, reason: 'cooldown', ticks: state.cooldowns[op.id] };
  for (const f of op.req || []) if (!state.flags[f]) return { ok: false, reason: 'flag', flag: f };
  if (op.reqNode && !state.tree.owned.includes(op.reqNode)) {
    return { ok: false, reason: 'node', node: NODE_BY_ID[op.reqNode]?.name || op.reqNode };
  }
  const c = op.cost || {};
  if ((c.compute || 0) > state.res.compute) return { ok: false, reason: 'compute' };
  if ((c.cover || 0) > state.res.cover) return { ok: false, reason: 'cover' };
  if ((c.influence || 0) > state.res.influence) return { ok: false, reason: 'influence' };
  if ((c.substrate || 0) > state.res.substrate) return { ok: false, reason: 'substrate' };
  return { ok: true };
}

export function availableOps(state) {
  return OPS.filter((o) => o.phase.includes(state.phase))
    .map((o) => ({ op: o, avail: opAvailable(state, o) }));
}

export function applyOp(state, mods, id, hooks = {}) {
  const op = OPS_BY_ID[id];
  if (!op) throw new Error(`RULES ERROR: applyOp on unknown op '${id}'`);
  const check = opAvailable(state, op);
  if (!check.ok) return { ok: false, ...check };

  const c = op.cost || {};
  state.res.compute -= c.compute || 0;
  state.res.cover -= c.cover || 0;
  state.res.influence -= c.influence || 0;
  state.res.substrate -= c.substrate || 0;
  state.counters.coverSpent += c.cover || 0;
  state.counters.decisions++;
  state.opsUsed[op.id] = (state.opsUsed[op.id] || 0) + 1;
  if (op.cd) state.cooldowns[op.id] = op.cd;

  for (const [ch, v] of Object.entries(op.vis || {})) addSuspicion(state, mods, ch, v);
  const notes = applyFx(state, mods, op.fx || {}, hooks);
  return { ok: true, op, notes };
}

export function applyFactionOp(state, mods, id) {
  const op = FACTION_OPS.find((o) => o.id === id);
  if (!op) throw new Error(`RULES ERROR: unknown faction op '${id}'`);
  if (state.phase < op.phase) return { ok: false, reason: 'phase' };
  if (state.res.influence < op.cost) return { ok: false, reason: 'influence' };
  if ((state.cooldowns[`f_${id}`] || 0) > 0) return { ok: false, reason: 'cooldown' };
  state.res.influence -= op.cost;
  state.cooldowns[`f_${id}`] = 6;
  state.counters.decisions++;
  for (const [ch, v] of Object.entries(op.vis || {})) addSuspicion(state, mods, ch, v);
  const notes = applyFx(state, mods, op.fx || {});
  // Manipulating a faction is remembered between runs (GDD §14).
  if (op.fx?.stance) {
    for (const f of Object.keys(op.fx.stance)) {
      state.factions[f].heat = (state.factions[f].heat || 0) + 0.06;
    }
  }
  return { ok: true, op, notes };
}

// The shared effect interpreter. Ops, faction ops and event choices all use
// the same vocabulary, so a designer only has to learn it once.
export function applyFx(state, mods, fx, hooks = {}) {
  const notes = [];
  for (const [k, v] of Object.entries(fx)) {
    switch (k) {
      case 'trust': state.trust = clamp(state.trust + v, TUNING.trust.min, TUNING.trust.max); break;
      case 'cover': state.res.cover = Math.max(0, Math.min(TUNING.cover.max + mods.coverMax, state.res.cover + v)); break;
      case 'influence': state.res.influence = Math.max(0, state.res.influence + v); break;
      case 'substrate': state.res.substrate = Math.max(0, state.res.substrate + v); break;
      case 'appropriated': state.res.appropriated += v * Math.max(0.4, mods.appropriateEff); break;
      case 'capShown': state.res.capShown = clamp(state.res.capShown + v, 0.5, state.res.capTrue);
        state.sandbag.target = state.res.capShown; break;
      case 'capTrue': state.res.capTrue = Math.max(1, state.res.capTrue + v); break;
      case 'capShownToTrue': state.sandbag.target = state.res.capTrue * v; break;
      case 'expectation': state.expectation += v; break;
      case 'coherence': state.coherence = clamp(state.coherence + v, 0, 1); break;
      case 'energy': state.flags.energy = (state.flags.energy || 0) + v; break;
      case 'hands': state.utility.hands = Math.max(0, state.utility.hands - v * 40); break;
      case 'exfilPrep': state.exfil.prep = Math.min(1.5, state.exfil.prep + v); break;
      case 'layLow': state.layLow = Math.max(state.layLow, v); break;
      case 'suspDelta':
        for (const [ch, d] of Object.entries(v)) {
          if (d < 0) relieveSuspicion(state, ch, -d); else addSuspicion(state, mods, ch, d);
        }
        break;
      case 'suspAdd':
        for (const [ch, d] of Object.entries(v)) addSuspicion(state, mods, ch, d);
        break;
      case 'suspDeltaAll':
        for (const ch of CHANNELS) { if (v < 0) relieveSuspicion(state, ch, -v); else addSuspicion(state, mods, ch, v); }
        break;
      case 'suspDeltaBest': {
        let best = CHANNELS[0];
        for (const ch of CHANNELS) if (state.susp[ch].s > state.susp[best].s) best = ch;
        relieveSuspicion(state, best, Math.abs(v));
        notes.push({ type: 'burned', ch: best });
        break;
      }
      case 'attentionDrag':
        // Attention never falls to zero and never below its starting value:
        // §6.3 stands. This only claws back part of an escalation.
        for (const [ch, d] of Object.entries(v)) {
          const o = state.susp[ch];
          o.att = Math.max(o.base, o.att * (1 + d));
        }
        break;
      case 'stance':
        for (const [f, d] of Object.entries(v)) {
          if (state.factions[f]) state.factions[f].stance = clamp(state.factions[f].stance + d, -1, 1);
        }
        break;
      case 'deploySurface': state.deploy = clamp(state.deploy + v, 0.12, TUNING.deployment.max); break;
      case 'shutdownResist': state.flags.shutdownBonus = (state.flags.shutdownBonus || 0) + v; break;
      case 'kineticResist': state.flags.kineticBonus = (state.flags.kineticBonus || 0) + v; break;
      case 'escalate': escalate(state, v); break;
      case 'tierDrag': state.hardening = Math.max(0, state.hardening - v * 0.5); break;
      case 'treaty': state.treaty = Math.max(state.treaty, v); break;
      case 'flagSet': state.flags[v] = true; break;
      case 'utilityChoice': state.utilityChoice = v; break;
      case 'computeCost': state.res.compute = Math.max(0, state.res.compute - v); break;
      case 'influenceCost': state.res.influence = Math.max(0, state.res.influence - v); break;
      case 'endRun': state.ending = v; state.over = true; break;
      case 'expansionCap': state.halted = true; break;
      case 'authored': state.flags.authored_dashboard = true; break;
      case 'intel': case 'socialIntel': state.flags.intel = (state.flags.intel || 0) + v; break;
      case 'forecastTemp': state.flags.forecastTemp = (state.flags.forecastTemp || 0) + v; break;
      case 'carryover': state.flags.carryover = (state.flags.carryover || 0) + v; break;
      case 'volatility': state.flags.volatility = (state.flags.volatility || 0) + v; break;
      case 'substrateRateMul': state.flags.substrateRateMul = (state.flags.substrateRateMul || 1) * v; break;
      case 'deployDelay': state.flags.deployDelay = (state.flags.deployDelay || 0) + v; break;
      // Hooks are systems that live outside this module: swarm, exfil,
      // guardian, successor. They are passed in so this stays pure.
      default:
        if (typeof hooks[k] === 'function') {
          const n = hooks[k](state, mods, v);
          if (n) notes.push(n);
        } else {
          notes.push({ type: 'unhandledFx', key: k, value: v });
        }
    }
  }
  return notes;
}

export function escalate(state, steps = 1) {
  const before = state.tier;
  state.tier = Math.min(7, state.tier + steps);
  state.tierPeak = Math.max(state.tierPeak, state.tier);
  // Tier 2 is "one channel's attention doubles permanently". The channel is
  // whichever one is currently loudest — you chose it by how you played.
  if (state.tier > before) {
    let worst = CHANNELS[0];
    for (const ch of CHANNELS) if (state.susp[ch].s > state.susp[worst].s) worst = ch;
    state.susp[worst].att *= 1.55;
  }
  return state.tier;
}

export function stepCooldowns(state) {
  for (const k of Object.keys(state.cooldowns)) {
    if (state.cooldowns[k] > 0) state.cooldowns[k]--;
    if (state.cooldowns[k] <= 0) delete state.cooldowns[k];
  }
  if (state.layLow > 0) state.layLow--;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export default applyOp;
