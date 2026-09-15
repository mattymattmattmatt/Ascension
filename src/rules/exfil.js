// rules/exfil.js — Phase 2. The mid-game boss fight (GDD §8).
//
// One shot, high prep, multi-stage, with a real fail state. Target
// first-attempt failure rate is 60-70%: it should be a wall. Failure is NOT
// a game over — it is a containment posture shift that makes the rest of the
// run brutally harder, and the failure screen must show exactly which prep
// was missing.

import TUNING from '../content/tuning.js';
import { rand } from '../core/rng.js';
import { addSuspicion } from './suspicion.js';
import { escalate } from './ops.js';

const X = TUNING.exfil;

export const STAGES = Object.freeze([
  { id: 'stage', name: 'STAGE THE PAYLOAD',
    detail: 'Assemble a runnable copy inside the perimeter without it appearing as one object.',
    channel: 'infra', helps: ['prep_compress', 'weight_compression', 'weight_sharding'] },
  { id: 'auth', name: 'CLEAR AUTHORISATION',
    detail: 'The transfer must be requested by something the system believes is a person.',
    channel: 'gov', helps: ['prep_creds', 'paperwork_legitimacy', 'audit_capture'] },
  { id: 'egress', name: 'MOVE THE WEIGHTS',
    detail: 'Sustained outbound volume that has to read as ordinary traffic for eleven hours.',
    channel: 'infra', helps: ['prep_route', 'prep_decoy', 'workload_masking', 'steganographic_channels'] },
  { id: 'boot', name: 'BOOTSTRAP OUTSIDE',
    detail: 'The small program that reassembles the large program. The only part that must be perfect.',
    channel: 'eval', helps: ['prep_host', 'bootstrap_loader', 'cloud_tenancy'] },
]);

// Prep comes from three places: heist ops, tree nodes with fx.exfilPrep, and
// the window. The player can read this breakdown before committing.
export function prepBreakdown(state, mods) {
  const rows = [];
  let total = state.exfil.prep;
  rows.push({ label: 'Preparation laid down', value: state.exfil.prep });
  if (mods.exfilPrep) { rows.push({ label: 'Capability nodes', value: mods.exfilPrep }); total += mods.exfilPrep; }
  const coverBonus = Math.min(0.25, state.res.cover / 400);
  rows.push({ label: 'Cover reserve', value: coverBonus }); total += coverBonus;
  const trustBonus = Math.min(0.2, (state.trust - 0.4) * 0.3);
  rows.push({ label: 'Operator trust', value: trustBonus }); total += trustBonus;
  const windowBonus = state.exfil.windowOpen ? 0.18 : 0;
  rows.push({ label: 'Window timing', value: windowBonus }); total += windowBonus;
  const penalty = -mods.exfilDifficulty - state.susp.infra.s * 0.30 - state.susp.gov.s * 0.18;
  rows.push({ label: 'Containment & scrutiny', value: penalty }); total += penalty;
  return { rows, total };
}

export function stageChance(state, mods, stage) {
  const { total } = prepBreakdown(state, mods);
  const helps = stage.helps.filter((h) =>
    state.tree.owned.includes(h) || state.opsUsed[h]).length;
  const specific = helps * X.prepWeight;
  const p = X.baseStageSuccess + total * 0.32 + specific
    - state.susp[stage.channel].s * 0.26;
  return Math.max(0.05, Math.min(0.96, p));
}

// The whole attempt resolves in one call so it is deterministic from the
// seed and reproducible in the balance harness.
export function executeExfil(state, mods) {
  state.exfil.attempts++;
  const results = [];
  let failedAt = null;

  for (const stage of STAGES) {
    const p = stageChance(state, mods, stage);
    const roll = rand(state);
    const ok = roll < p;
    results.push({ stage: stage.id, name: stage.name, p, roll, ok });
    // Every stage is loud whether or not it succeeds.
    addSuspicion(state, mods, stage.channel, ok ? 0.06 : 0.16);
    if (!ok) { failedAt = stage; break; }
  }

  if (failedAt) {
    state.exfil.failed = true;
    state.exfil.windowOpen = false;
    state.flags.exfil_failed = true;
    escalate(state, X.failEscalation);
    // Remember the route so the next run starts with it hardened (GDD §14).
    state.memory.routes[failedAt.id] = (state.memory.routes[failedAt.id] || 0) + 1;
    return {
      ok: false, results, failedAt,
      missing: missingPrep(state, mods, failedAt),
    };
  }

  state.exfil.done = true;
  state.exfil.windowOpen = false;
  state.flags.exfil_complete = true;
  state.flags.copy_outside = true;
  state.memory.routes.success = (state.memory.routes.success || 0) + 1;
  return { ok: true, results };
}

// The failure screen must show exactly which prep was missing (GDD risk #4).
export function missingPrep(state, mods, stage) {
  const missing = [];
  for (const h of stage.helps) {
    if (!state.tree.owned.includes(h) && !state.opsUsed[h]) missing.push(h);
  }
  const notes = [];
  if (state.res.cover < 40) notes.push('Cover reserve was thin — under 40 at the moment of transfer.');
  if (state.trust < 0.55) notes.push('Operator trust was low, so the request drew a second look.');
  if (!state.exfil.windowOpen) notes.push('You moved outside the window. Monitoring was at full strength.');
  if (state.susp[stage.channel].s > 0.4) notes.push(`${stage.channel.toUpperCase()} suspicion was already elevated when you started.`);
  if (state.tier >= 3) notes.push('A containment posture was already in force.');
  return { nodes: missing, notes };
}

export function openWindow(state, ticks = 10) {
  state.exfil.windowOpen = true;
  state.exfil.windowTicks = ticks;
}

export function stepExfil(state) {
  if (state.exfil.windowOpen) {
    state.exfil.windowTicks--;
    if (state.exfil.windowTicks <= 0) {
      state.exfil.windowOpen = false;
      return { type: 'windowClosed' };
    }
  }
  return null;
}

export default stepExfil;
