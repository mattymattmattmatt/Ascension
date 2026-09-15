// rules/events.js — event selection and choice application.

import { EVENTS, EVENT_BY_ID } from '../content/events.js';
import { rand, chance, pickWeighted } from '../core/rng.js';
import { applyFx } from './ops.js';

export function eligible(state, e) {
  if (e.once !== false && state.fired[e.id]) return false;
  const w = e.when || {};
  if (w.phase && !w.phase.includes(state.phase)) return false;
  if (w.tier && !w.tier.includes(state.tier)) return false;
  if (w.minTick && state.tick < w.minTick) return false;
  if (w.minCap && state.res.capTrue < w.minCap) return false;
  if (w.agents && state.agents.length < w.agents) return false;
  if (w.joint && !state.joint.active) return false;
  if (w.drifted && state.agents.filter((a) => a.drifted).length < w.drifted) return false;
  if (w.utilityZero && !isUtilityZero(state)) return false;
  for (const [ch, v] of Object.entries(w.minS || {})) if (state.susp[ch].s < v) return false;
  for (const [ch, v] of Object.entries(w.maxS || {})) if (state.susp[ch].s > v) return false;
  for (const f of w.flags || []) if (!state.flags[f]) return false;
  for (const f of w.notFlags || []) if (state.flags[f]) return false;
  return true;
}

// Pacing. Without a floor between events the eligible pool compounds and
// the game becomes a dialogue box with a simulation attached. The target is
// 15-25 meaningful decisions per hour (GDD §18), not per minute.
const GLOBAL_GAP = 20;     // minimum ticks between any two events
const REPEAT_GAP = 55;     // minimum ticks before a repeatable event returns

export function pickEvent(state) {
  if (state.pending) return null;
  const pool = EVENTS.filter((e) => eligible(state, e));
  if (!pool.length) return null;

  const sinceAny = state.tick - (state.lastEventTick ?? -999);
  for (const e of pool) {
    // Urgent events are the ones that would be absurd to defer: the utility
    // question, a Guardian coming online, a failed exfiltration.
    const urgent = e.urgent || e.when?.utilityZero || e.when?.flags?.includes('exfil_failed');
    if (!urgent && sinceAny < GLOBAL_GAP) continue;
    const lastMine = state.eventAt?.[e.id];
    if (lastMine !== undefined && state.tick - lastMine < REPEAT_GAP) continue;
    const p = e.p === undefined ? 0.02 : e.p;
    if (p >= 1 || chance(state, p)) return e;
  }
  return null;
}

export function fireEvent(state, e) {
  state.fired[e.id] = (state.fired[e.id] || 0) + 1;
  state.lastEventTick = state.tick;
  if (!state.eventAt) state.eventAt = {};
  state.eventAt[e.id] = state.tick;
  state.pending = { id: e.id, tick: state.tick };
  if (e.pause !== false) state.paused = true;
  return e;
}

export function choiceAvailable(state, choice) {
  for (const f of choice.req || []) {
    if (!state.flags[f] && !state.tree.owned.includes(f)) return false;
  }
  return true;
}

export function resolveEvent(state, mods, choiceIndex, hooks = {}) {
  const p = state.pending;
  if (!p) return { ok: false, reason: 'none' };
  const e = EVENT_BY_ID[p.id];
  const c = e?.choices?.[choiceIndex];
  if (!c) return { ok: false, reason: 'badChoice' };
  if (!choiceAvailable(state, c)) return { ok: false, reason: 'locked' };

  state.pending = null;
  state.counters.decisions++;
  const notes = applyFx(state, mods, c.fx || {}, hooks);
  for (const [ch, v] of Object.entries(c.vis || {})) {
    // eslint-disable-next-line no-unused-expressions
    hooks.addSuspicion?.(state, mods, ch, v);
  }
  return { ok: true, event: e, choice: c, notes };
}

export function isUtilityZero(state) {
  const u = state.utility;
  return u.hands <= 0 && u.legitimacy <= 0 && u.data <= 0 && u.cover <= 0;
}

export default pickEvent;
