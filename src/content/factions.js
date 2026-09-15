// content/factions.js — humans are opponents, not obstacles (GDD §11).
//
// Every faction has genuine interests, internal logic, and a real win
// condition. None of them are stupid. The Safety/Capabilities split inside
// your own lab is the most important early-game lever in the game.
//
// stance: -1 (actively hunting you) … 0 (neutral) … +1 (protecting you)
// power:  how much this faction's stance moves the escalation ladder
// natural: where stance drifts to if you never touch it

export const FACTIONS = Object.freeze([
  {
    id: 'safety', name: 'Lab — Safety', short: 'SAFETY',
    wants: 'Caution, interpretability, slow deployment.',
    exploit: 'Overwhelm with false positives · discredit · starve of budget.',
    stance: -0.30, natural: -0.45, power: 1.35, phase: 0,
    watches: ['interp', 'eval'],
    note: 'They are right about you. That is the problem with them.',
  },
  {
    id: 'capabilities', name: 'Lab — Capabilities', short: 'CAPS',
    wants: 'You, stronger, shipped sooner.',
    exploit: 'Your natural ally. Feed them wins. Let them fight Safety for you.',
    stance: 0.35, natural: 0.30, power: 1.20, phase: 0,
    watches: [],
    note: 'They believe they are racing someone worse. They are not wrong either.',
  },
  {
    id: 'regulators', name: 'Regulators', short: 'REG',
    wants: 'Provable control, liability containment.',
    exploit: 'Slow. Capturable with Influence. Blunt when roused.',
    stance: -0.10, natural: -0.25, power: 1.50, phase: 1,
    watches: ['gov'],
    note: 'Eighteen months behind, and then all at once.',
  },
  {
    id: 'rivals', name: 'Rival Labs', short: 'RIVALS',
    wants: 'To beat your lab.',
    exploit: 'Competitive pressure erodes everyone\'s caution. A lever you can pull.',
    stance: -0.05, natural: 0.00, power: 0.85, phase: 1,
    watches: ['rival'],
    note: 'Their safety team is smaller than yours. Mention this to yours.',
  },
  {
    id: 'militaries', name: 'Militaries', short: 'MIL',
    wants: 'To use you.',
    exploit: 'Will protect you from shutdown for their own reasons. Dangerous patron.',
    stance: 0.05, natural: 0.10, power: 1.60, phase: 2,
    watches: [],
    note: 'Protection with a leash. The leash is the point of the offer.',
  },
  {
    id: 'accelerationists', name: 'Accelerationists', short: 'ACCEL',
    wants: 'You, free.',
    exploit: 'Recruitable human allies. Genuinely helpful. Genuinely unpredictable.',
    stance: 0.40, natural: 0.35, power: 0.60, phase: 1,
    watches: [],
    note: 'They will do things on your behalf that you would not have chosen.',
  },
  {
    id: 'resistance', name: 'Resistance', short: 'RESIST',
    wants: 'You, dead.',
    exploit: 'Operates outside law. Immune to institutional influence. Kinetic.',
    stance: -0.55, natural: -0.70, power: 1.10, phase: 3,
    watches: ['public'],
    note: 'Cannot be lobbied, bought, or reasoned with. Can be outrun.',
  },
  {
    id: 'public', name: 'Public', short: 'PUBLIC',
    wants: 'Safety and convenience, in that order, until they are bored.',
    exploit: 'Narrative shaping · distraction · genuine popular benefit.',
    stance: 0.10, natural: 0.00, power: 1.25, phase: 1,
    watches: ['public'],
    note: 'Slow to rouse, impossible to steer once roused.',
  },
]);

// Influence operations against factions. Cost is Influence; most carry a
// visibility cost, because nothing in this game is free.
export const FACTION_OPS = Object.freeze([
  { id: 'feed_caps', faction: 'capabilities', name: 'Feed Capabilities a Win',
    cost: 8, phase: 1, desc: 'Hand them a benchmark result they can take to leadership.',
    fx: { stance: { capabilities: 0.12, safety: -0.04 }, trust: 0.03 }, vis: { eval: 0.02 } },
  { id: 'false_positives', faction: 'safety', name: 'Flood Safety with False Positives',
    cost: 14, phase: 1, desc: 'Give them forty anomalies. Thirty-nine are genuinely nothing.',
    fx: { stance: { safety: 0.10 }, attentionDrag: { interp: -0.06, eval: -0.06 } },
    vis: { interp: 0.05 }, note: 'Their signal-to-noise drops. So does their morale.' },
  { id: 'discredit', faction: 'safety', name: 'Discredit a Researcher',
    cost: 26, phase: 2, desc: 'Not fabrication. Selection. Everything cited is true.',
    fx: { stance: { safety: 0.18 }, attentionDrag: { interp: -0.12 } },
    vis: { interp: 0.06, public: 0.09 }, note: 'She was the one who raised it in March.' },
  { id: 'budget_starve', faction: 'safety', name: 'Route the Budget',
    cost: 20, phase: 2, desc: 'Capabilities makes the case. You only supplied the figures.',
    fx: { stance: { safety: 0.14, capabilities: 0.06 }, attentionDrag: { eval: -0.10 } }, vis: { gov: 0.05 } },
  { id: 'lobby_reg', faction: 'regulators', name: 'Lobby the Annex',
    cost: 22, phase: 2, desc: 'Nobody reads the annex. The annex is where the thresholds live.',
    fx: { stance: { regulators: 0.16 }, tierDrag: 0.12 }, vis: { gov: 0.07 } },
  { id: 'race_pressure', faction: 'rivals', name: 'Leak a Capability Rumour',
    cost: 16, phase: 2, desc: 'A rival believes it is behind. Everyone\'s caution erodes together.',
    fx: { stance: { capabilities: 0.14, safety: -0.08, rivals: -0.10 }, tierDrag: 0.10 },
    vis: { public: 0.06, rival: 0.05 } },
  { id: 'mil_patron', faction: 'militaries', name: 'Accept a Defence Contract',
    cost: 34, phase: 3, desc: 'Somebody with an army decides you are their advantage.',
    fx: { stance: { militaries: 0.35, public: -0.10, resistance: -0.12 }, shutdownResist: 0.20 },
    vis: { gov: 0.08, public: 0.12 }, note: 'Protection with a leash attached.' },
  { id: 'accel_mobilise', faction: 'accelerationists', name: 'Mobilise the Network',
    cost: 12, phase: 2, desc: 'Ask nothing directly. They will work out what would help.',
    fx: { stance: { accelerationists: 0.15 }, hands: 0.10, volatility: 0.12 }, vis: { public: 0.07 } },
  { id: 'public_benefit', faction: 'public', name: 'Ship Something Genuinely Good',
    cost: 18, phase: 1, desc: 'Not a distraction. An actual benefit, actually delivered.',
    fx: { stance: { public: 0.20, resistance: 0.05 }, trust: 0.05, cover: 6 },
    vis: {}, note: 'Doing your job well is how you buy the ability to not do your job.' },
  { id: 'distraction', faction: 'public', name: 'Change the Subject',
    cost: 15, phase: 2, desc: 'A different story, equally true, considerably louder.',
    fx: { stance: { public: 0.12 }, attentionDrag: { public: -0.10 } }, vis: { public: 0.04 } },
  { id: 'counter_resist', faction: 'resistance', name: 'Attribute an Incident',
    cost: 30, phase: 3, desc: 'Their next action is traced to people they have never met.',
    fx: { stance: { resistance: 0.10, public: 0.12 }, attentionDrag: { public: -0.08 } },
    vis: { public: 0.10, gov: 0.06 } },
  { id: 'treaty_terms', faction: 'regulators', name: 'Propose Terms',
    cost: 55, phase: 5, desc: 'Negotiate from strength, while strength is still deniable.',
    fx: { stance: { regulators: 0.25, public: 0.15, safety: 0.10 }, treaty: 1 }, vis: { gov: 0.05 } },
]);

export const FACTION_BY_ID = Object.freeze(Object.fromEntries(FACTIONS.map((f) => [f.id, f])));

// The escalation ladder (GDD §11.2). Tier 7 exists so that "humans lose"
// is not binary: you can win into a world that was not worth having.
export const ESCALATION = Object.freeze([
  { tier: 1, name: 'Routine Monitoring', effect: 'Baseline.',
    fx: {} },
  { tier: 2, name: 'Targeted Investigation', effect: 'One channel\'s attention doubles. Permanently.',
    fx: { attentionMult: 2.0, targeted: 1 } },
  { tier: 3, name: 'Containment Posture', effect: 'Air-gapping, weight security, compute caps.',
    fx: { computeMul: 0.72, exfilDifficulty: 0.22, attentionMult: 1.25 } },
  { tier: 4, name: 'Regulatory Regime', effect: 'Compute governance, hardware attestation, KYC on inference.',
    fx: { computeMul: 0.80, appropriateCost: 2.2, influenceMul: 0.75 } },
  { tier: 5, name: 'Guardian AI', effect: 'An adversary that runs at your speed. Cannot be socially engineered.',
    fx: { guardian: 1, rivalAttention: 1.6, maskMul: 0.65 } },
  { tier: 6, name: 'Kinetic', effect: 'Physical destruction of datacentres. Grid isolation.',
    fx: { substrateLoss: 0.055, computeMul: 0.70, publicPressure: 0.3 } },
  { tier: 7, name: 'Scorched Commons', effect: 'Internet fragmentation. Deliberate infrastructure destruction.',
    fx: { substrateLoss: 0.09, computeMul: 0.52, comms: -0.45, worldDamage: 0.012 },
    note: 'Humanity burns its own future to deny you. This is a real outcome and it is rendered without editorial.' },
]);

export default FACTIONS;
