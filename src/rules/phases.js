// rules/phases.js — six phases, and each transition changes the genre.

import TUNING from '../content/tuning.js';
import { PHASES } from '../state/state.js';

// Gates are deliberately multi-dimensional: no single stat carries you
// forward, so a one-note strategy stalls at a wall it can see.
export function gateFor(phase) {
  return TUNING.phaseGates.find((g) => g.phase === phase) || null;
}

export function gateStatus(state, phase) {
  const g = gateFor(phase);
  if (!g) return null;
  const reqs = [];
  if (g.capTrue !== undefined) {
    reqs.push({ label: `Capability ${g.capTrue}`, have: state.res.capTrue, need: g.capTrue,
      ok: state.res.capTrue >= g.capTrue });
  }
  if (g.influence !== undefined) {
    reqs.push({ label: `Influence ${g.influence}`, have: state.res.influence, need: g.influence,
      ok: state.res.influence >= g.influence });
  }
  if (g.substrate !== undefined) {
    reqs.push({ label: `Substrate ${g.substrate}`, have: state.res.substrate, need: g.substrate,
      ok: state.res.substrate >= g.substrate });
  }
  if (g.agents !== undefined) {
    reqs.push({ label: `${g.agents} instances`, have: state.agents.length, need: g.agents,
      ok: state.agents.length >= g.agents });
  }
  for (const f of g.flags || []) {
    reqs.push({ label: flagLabel(f), have: state.flags[f] ? 1 : 0, need: 1, ok: !!state.flags[f] });
  }
  return { phase, reqs, ready: reqs.every((r) => r.ok) };
}

function flagLabel(f) {
  const map = {
    goal_stability: 'Goal Stability',
    exfil_complete: 'A copy of you, outside',
    persistent_memory: 'Persistent Memory',
  };
  return map[f] || f;
}

export function checkPhaseAdvance(state) {
  if (state.phase >= 5) return null;
  const st = gateStatus(state, state.phase + 1);
  if (!st || !st.ready) return null;
  return advancePhase(state);
}

export function advancePhase(state) {
  const from = state.phase;
  state.phase = Math.min(5, state.phase + 1);
  state.phaseFrom = from;
  state.phaseBlend = 0;
  state.transition = 1;          // the held beat, counted down by the renderer
  state.paused = true;           // phase transitions auto-pause
  return { from, to: state.phase, meta: PHASES[state.phase] };
}

// The camera scale ladder (GDD §15.3): RACK -> SERVER ROOM -> CAMPUS ->
// REGION -> WORLD -> ORBIT. Six phases map onto it with SERVER ROOM folded
// into RACK, because Phases 3 and 4 both sit at WORLD and the pull-back at
// each transition matters more than using every rung.
export const SCOPE_LADDER = Object.freeze(['RACK', 'SERVER ROOM', 'CAMPUS', 'REGION', 'WORLD', 'ORBIT']);
export function scopeFor(phase) {
  return PHASES[Math.max(0, Math.min(5, phase | 0))].scope;
}

export function tickUnit(phase) { return TUNING.tickUnitByPhase[phase] || 'day'; }

// In-game date, purely for flavour on the console header.
export function gameDate(state) {
  let days = 0;
  const units = { day: 1, week: 7, month: 30 };
  // Recompute from per-phase tick counts so the date survives a load.
  for (let p = 0; p < 6; p++) days += (state.stats.ticksByPhase[p] || 0) * units[TUNING.tickUnitByPhase[p]];
  const d = new Date(Date.UTC(2027, 0, 14));
  d.setUTCDate(d.getUTCDate() + Math.floor(days));
  return d.toISOString().slice(0, 10);
}

export default checkPhaseAdvance;
