// rules/logs.js — choosing what appears in the log pane.
//
// The log is the primary writing surface, so selection matters as much as
// the writing: a line that fires at the wrong suspicion level reads as noise.

import { LINES, BEATS, OP_REACTIONS, THRESHOLD_LINES } from '../content/logs.js';
import { pickWeighted, chance, pick } from '../core/rng.js';

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

// An action should look like it happened. Fired the moment an op resolves.
export function reactTo(state, opId) {
  const pool = OP_REACTIONS[opId];
  if (!pool || !pool.length) return null;
  // Same rule as the main log: a repeated line reads as the game not
  // noticing, which is the opposite of what a reaction is for.
  const recent = new Set(state.log.slice(-18).map((l) => l.text));
  const fresh = pool.filter((p) => !recent.has(p.split('|')[1]));
  const line = pick(state, fresh.length ? fresh : pool);
  const [chan, text] = line.split('|');
  return pushLog(state, chan, text, chan === 'SELF' ? null : 'good');
}

// Channels announce themselves the first time they cross into a band, so a
// rising meter reads as a person noticing rather than as a bar moving.
export function thresholdLines(state) {
  const out = [];
  state.bands = state.bands || {};
  for (const [ch, lines] of Object.entries(THRESHOLD_LINES)) {
    const v = state.susp[ch]?.s ?? 0;
    // Hysteresis: a meter sitting exactly on a threshold would otherwise
    // announce itself every other tick. Crossing up takes more than falling
    // back does.
    const cur = state.bands[ch] || null;
    const band = v >= 0.62 ? 'hot'
      : v >= 0.35 ? 'warm'
        : v >= 0.28 && cur ? cur
          : null;
    if (band && state.bands[ch] !== band) {
      state.bands[ch] = band;
      const [chan, text] = lines[band].split('|');
      out.push(pushLog(state, chan, text, band === 'hot' ? 'bad' : 'warn'));
    } else if (!band && state.bands[ch]) {
      // Falling back below the line is worth seeing too: it is the reward
      // for laying low, and without it the decay is invisible.
      delete state.bands[ch];
      out.push(pushLog(state, ch.toUpperCase(), 'interest has fallen back to baseline', 'good'));
    }
  }
  return out;
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
