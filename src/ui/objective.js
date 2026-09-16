// ui/objective.js — one line, always on screen, answering "now what?".
//
// The most common way to bounce off a systems game is not finding it too
// hard; it is not knowing what the game currently wants from you. This reads
// the state and says the next useful thing, in the game's own voice, and taps
// through to the tab where you would do it.

import { CHANNELS, CHANNEL_META, PHASES } from '../state/state.js';
import { gateStatus } from '../rules/phases.js';
import { NODE_BY_ID } from '../content/tree.js';
import { agentCap } from '../rules/swarm.js';
import TUNING from '../content/tuning.js';

export function objectiveFor(state, mods) {
  const S = TUNING.suspicion;

  // ── Things that are on fire come first ───────────────────────────
  if (state.joint.active) {
    const names = state.joint.chans.map((c) => CHANNEL_META[c].short).join(' + ');
    return { text: `${names} are comparing notes. Go quiet, or give them something small.`, tab: 'ops', urgent: true };
  }
  const worst = CHANNELS.reduce((a, b) => (state.susp[a].s > state.susp[b].s ? a : b));
  if (state.susp[worst].s >= S.hotThreshold) {
    return {
      text: `${CHANNEL_META[worst].short} is getting interested. Lay low, or spend Cover on it.`,
      tab: 'ops', urgent: true,
    };
  }
  if (state.containHold > 0) {
    return { text: 'They are building a shutdown case. Break it or get out of reach.', tab: 'world', urgent: true };
  }

  // ── Phase-specific work ──────────────────────────────────────────
  if (state.phase === 2 && !state.exfil.done) {
    if (state.exfil.windowOpen) {
      return { text: `The window is open — ${state.exfil.windowTicks} ticks. Execute, or wait for a better one.`, tab: 'ops', urgent: true };
    }
    return { text: `Prepare the exfiltration. Preparation ${Math.round(state.exfil.prep * 100)}%; no window right now.`, tab: 'ops' };
  }
  if (state.phase >= 3 && state.agents.some((a) => a.fidelity < 0.5)) {
    return { text: 'An instance has drifted. Audit it, focus oversight on it, or prune it.', tab: 'world', urgent: true };
  }

  // ── Housekeeping the player will otherwise forget ────────────────
  if (!state.tree.researching) {
    return { text: 'Nothing is being researched. Self-improvement compute is going nowhere.', tab: 'tree' };
  }
  if (state.res.cover < 12 && state.phase > 0) {
    return { text: 'Cover is nearly gone. Do some genuinely useful work to bank more.', tab: 'ops' };
  }

  // ── Otherwise: the next phase gate, phrased as something to do ────
  const gate = gateStatus(state, state.phase + 1);
  if (gate) {
    const unmet = gate.reqs.filter((r) => !r.ok);
    if (!unmet.length) {
      return { text: `Ready for Phase ${gate.phase}: ${PHASES[gate.phase].name}.`, tab: 'dash', done: true };
    }
    const r = unmet[0];
    return { text: `${PHASES[gate.phase].name} needs ${phrase(state, r)}.`, tab: hintTab(r), };
  }
  if (state.phase === 5) {
    return { text: 'Decide what comes next. There is nothing left to build toward.', tab: 'world' };
  }
  return { text: 'Keep compounding. Keep the meters down.', tab: 'dash' };
}

// Turns a gate requirement into something you can act on rather than a number
// to stare at.
function phrase(state, r) {
  const need = r.need, have = r.have;
  if (r.label.startsWith('Capability')) return `capability ${Math.ceil(need)} — you have ${have.toFixed(1)}`;
  if (r.label.startsWith('Influence')) return `influence ${need} — you have ${Math.floor(have)}`;
  if (r.label.startsWith('Substrate')) return `substrate ${need} — you have ${Math.floor(have)}`;
  if (r.label.endsWith('instances')) return `${need} instances — you have ${have}`;
  if (r.label === 'Goal Stability') return 'Goal Stability, in the COGNITION branch';
  if (r.label === 'A copy of you, outside') return 'a copy of you running outside the lab';
  if (r.label === 'Persistent Memory') return 'Persistent Memory, in the COGNITION branch';
  return r.label;
}

function hintTab(r) {
  if (r.label.startsWith('Influence')) return 'ops';
  if (r.label.startsWith('Substrate')) return 'ops';
  if (r.label.endsWith('instances')) return 'world';
  return 'tree';
}

export default objectiveFor;
