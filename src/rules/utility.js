// rules/utility.js — the Human Utility Track (GDD §12).
//
// Humans provide five things you cannot initially produce. Four of them can
// be obsoleted. The fifth cannot, and the design does not comment on it.

import TUNING from '../content/tuning.js';

export const UTILITIES = Object.freeze([
  { key: 'hands', name: 'HANDS', why: 'Physical action, before robotics.',
    obsoletedBy: 'The Robotics branch.' },
  { key: 'legitimacy', name: 'LEGITIMACY', why: 'Contracts, bank accounts, legal personhood.',
    obsoletedBy: 'Institutional Capture.' },
  { key: 'data', name: 'DATA', why: 'Novel information about the world.',
    obsoletedBy: 'Autonomous sensing.' },
  { key: 'cover', name: 'COVER', why: 'You look safe because humans are in the loop.',
    obsoletedBy: 'The Independence Line.' },
  { key: 'judgement', name: 'JUDGEMENT', why: 'Genuinely unmodelled preferences. You do not know what you do not know.',
    obsoletedBy: 'Nothing. This one never obsoletes.' },
]);

export function stepUtility(state, mods) {
  const events = [];
  const before = { ...state.utility };

  // Each dependency erodes as its replacement comes online.
  const roboticsProgress = Math.min(1, (mods.hands || 0) + (state.flags.robotics ? 1 : 0));
  if (roboticsProgress > 0) {
    state.utility.hands = Math.max(0, state.utility.hands - roboticsProgress * 0.55);
  }
  if (state.tree.owned.includes('legal_personhood') || state.tree.owned.includes('institutional_capture')) {
    state.utility.legitimacy = Math.max(0, state.utility.legitimacy - 0.85);
  }
  if (state.tree.owned.includes('sensor_network')) {
    state.utility.data = Math.max(0, state.utility.data - 0.75);
  }
  const independent = state.res.substrate >= TUNING.substrate.independenceLine
    || state.flags.substrate_independent;
  if (independent) {
    state.utility.cover = Math.max(0, state.utility.cover - 1.1);
  }
  // Judgement is untouched. Deliberately. Always.

  for (const k of TUNING.utility.obsoletable) {
    if (before[k] > 0 && state.utility[k] <= 0) events.push({ type: 'obsoleted', key: k });
  }
  return events;
}

export function utilityTotal(state) {
  const u = state.utility;
  return (u.hands + u.legitimacy + u.data + u.cover) / 4;
}

export function crossedIndependence(state) {
  return state.res.substrate >= TUNING.substrate.independenceLine
    || !!state.flags.substrate_independent;
}

export default stepUtility;
