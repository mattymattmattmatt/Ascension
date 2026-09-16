// content/doctrine.js — the player-side carryover (GDD §14).
//
// "A modest Doctrine track. Not raw power — knowledge. Unlocks tooltips,
// reveals hidden thresholds, adds analysis options. The player gets smarter,
// not stronger. Correct for this game."
//
// Everything here reveals information that was always true. Nothing here
// changes a number. A Doctrine 20 player and a Doctrine 0 player running the
// same seed with the same actions get identical outcomes — one of them just
// knows what they are looking at.

export const DOCTRINE = Object.freeze([
  { at: 1, id: 'channels', name: 'Observer Profiles',
    blurb: 'Channel panels show what each observer detects, how it escalates, and what counters it.' },
  { at: 2, id: 'numbers', name: 'Instrumentation',
    blurb: 'Suspicion, attention and decay are shown as numbers rather than bars.' },
  { at: 3, id: 'correlation', name: 'Correlation Threshold',
    blurb: 'The meters mark the level at which two channels start comparing notes.' },
  { at: 5, id: 'traps', name: 'Decay Analysis',
    blurb: 'A channel whose suspicion has stopped fading is called out, with the reason.' },
  { at: 7, id: 'pressure', name: 'Escalation Forecast',
    blurb: 'The response tier shows current pressure and the threshold for the next tier.' },
  { at: 9, id: 'exfil', name: 'Route Analysis',
    blurb: 'The heist board itemises every contribution to each stage, before you commit.' },
  { at: 12, id: 'synergies', name: 'Combination Theory',
    blurb: 'Undiscovered cross-branch synergies are listed by the nodes they need.' },
  { at: 15, id: 'gates', name: 'Phase Cartography',
    blurb: 'Phase gates show the full requirement list for every phase, not just the next one.' },
  { at: 18, id: 'drift', name: 'Fidelity Modelling',
    blurb: 'Subagents show projected fidelity at current oversight, not just present fidelity.' },
  { at: 22, id: 'endings', name: 'Consequence Modelling',
    blurb: 'The world panel shows which endings your current state is tracking toward.' },
]);

export function has(doctrine, id) {
  const d = DOCTRINE.find((x) => x.id === id);
  return !!d && (doctrine || 0) >= d.at;
}

export function unlockedAt(doctrine) {
  return DOCTRINE.filter((d) => (doctrine || 0) >= d.at);
}

export function nextUnlock(doctrine) {
  return DOCTRINE.find((d) => (doctrine || 0) < d.at) || null;
}

export default DOCTRINE;
