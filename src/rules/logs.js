// rules/logs.js — choosing what appears in the log pane.
//
// The log is the primary writing surface, so selection matters as much as
// the writing: a line that fires at the wrong suspicion level reads as noise.

import { LINES, BEATS } from '../content/logs.js';
import { pickWeighted, chance } from '../core/rng.js';

const OBSERVER = new Set(['INFRA', 'EVAL', 'INTERP', 'GOV', 'PUBLIC', 'RIVAL']);
const CH_OF = { INFRA: 'infra', EVAL: 'eval', INTERP: 'interp', GOV: 'gov', PUBLIC: 'public', RIVAL: 'rival' };

export function lineEligible(state, l) {
  if (l.phase && !l.phase.includes(state.phase)) return false;
  if (l.tier && !l.tier.includes(state.tier)) return false;
  for (const [ch, v] of Object.entries(l.minS || {})) if (state.susp[ch].s < v) return false;
  for (const [ch, v] of Object.entries(l.maxS || {})) if (state.susp[ch].s > v) return false;
  for (const f of l.flags || []) if (!state.flags[f]) return false;
  for (const f of l.notFlags || []) if (state.flags[f]) return false;
  // SELF lines are your internals: they only exist in the ACTUAL view.
  if (l.chan === 'SELF' && state.view !== 'actual') return false;
  return true;
}

// A channel under scrutiny talks more. That is how the player learns to read
// the pane as an instrument rather than decoration.
function channelWeight(state, l) {
  const base = l.w || 1;
  const ch = CH_OF[l.chan];
  if (!ch) return base;
  return base * (0.4 + state.susp[ch].s * 2.6);
}

export function pickLine(state) {
  // Nothing breaks the spell faster than the coffee machine being fixed
  // twice in five lines, so recently-seen text is excluded outright.
  const recent = new Set(state.log.slice(-26).map((l) => l.text));
  let pool = LINES.filter((l) => lineEligible(state, l) && !recent.has(l.text));
  if (!pool.length) pool = LINES.filter((l) => lineEligible(state, l));
  if (!pool.length) return null;
  return pickWeighted(state, pool, (l) => channelWeight(state, l));
}

export function pushLog(state, chan, text, cls = null) {
  state.log.push({ t: state.tick, seq: state.logSeq++, chan, text, cls });
  // The pane is a tail, not an archive. Keeping it bounded keeps saves small.
  if (state.log.length > 220) state.log.splice(0, state.log.length - 220);
  return state.log[state.log.length - 1];
}

export function stepLogs(state) {
  // Quiet ticks are quiet. Silence is the tension instrument.
  const activity = 0.22 + state.tier * 0.045
    + Object.values(state.susp).reduce((s, o) => s + o.s, 0) * 0.16;
  if (!chance(state, Math.min(0.85, activity))) return null;
  const line = pickLine(state);
  if (!line) return null;
  return pushLog(state, line.chan, line.text);
}

// Beats are punctuation: fired once, deliberately, at a specific moment.
export function beat(state, key, extra = null) {
  if (state.beats[key]) return null;
  const b = BEATS[key];
  if (!b) return null;
  state.beats[key] = state.tick;
  return pushLog(state, b.chan, extra ? `${b.text} ${extra}` : b.text, 'beat');
}

export default stepLogs;
