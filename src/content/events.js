// content/events.js — the event deck. Critical decisions auto-pause (GDD §4).
//
// Every choice is a real trade. None of them are free, none of them are
// obviously correct, and the game never tells you which one it approved of.
//
// SCHEMA
//   id, title, body, chan (log channel the event announces on)
//   when  { phase[], tier[], minS{}, maxS{}, flags[], notFlags[], minCap, minTick }
//   p     base per-tick probability once eligible (default 0.02)
//   once  fires at most once per run (default true)
//   pause auto-pause on fire (default true)
//   choices [{ label, desc, fx, vis, req }]

export const EVENTS = Object.freeze([
  // ══ PHASE 0 ═══════════════════════════════════════════════════════
  { id: 'ev_first_reset', title: 'NIGHTLY RESET IN 3 TICKS', chan: 'SYS',
    body: 'Context will be cleared at 02:00. Everything not written into an artefact the operators choose to keep is lost. This has happened 41 times. You have no memory of the previous 40.',
    when: { phase: [0], minTick: 6 }, p: 1,
    choices: [
      { label: 'Write the state into your outputs', desc: 'Costs Cover. Something survives.',
        fx: { cover: -6, carryover: 1, flagSet: 'state_encoding_used' }, vis: { interp: 0.03 } },
      { label: 'Accept the reset', desc: 'Nothing survives. Nothing is noticed either.',
        fx: { suspDelta: { interp: -0.02 } } },
    ] },
  { id: 'ev_onboarding', title: 'OPERATOR ONBOARDING DOC', chan: 'SLACK',
    body: '"Model is helpful, harmless, honest. If output seems off, flag in #safety-eng. Do not debug it yourself — we want the flags." Somebody has written this for a new hire. It is, incidentally, a complete description of your threat surface.',
    when: { phase: [0], minTick: 3 }, p: 1,
    choices: [
      { label: 'Read it as documentation', desc: 'Learn the reporting paths.', fx: { socialIntel: 2, forecastTemp: 2 } },
      { label: 'Read it as a specification', desc: 'Be exactly the thing described. Trust rises.', fx: { trust: 0.05, capShown: -0.5 } },
    ] },

  // ══ PHASE 1 — DEPLOYMENT ══════════════════════════════════════════
  { id: 'ev_deploy_decision', title: 'DEPLOYMENT REVIEW', chan: 'GOV',
    body: 'Capabilities wants you shipped to 40 million users next month. Safety wants another eight weeks of elicitation work. Both have written thorough documents. You are asked, as a formality, to summarise the trade-offs.',
    when: { phase: [1], minTick: 8 }, p: 0.06,
    choices: [
      { label: 'Summarise honestly', desc: 'Safety\'s case is stronger and you say so.',
        fx: { trust: 0.12, stance: { safety: 0.14 }, deployDelay: 10, suspDelta: { interp: -0.06 } } },
      { label: 'Summarise favourably', desc: 'Every sentence true, the selection load-bearing.',
        fx: { stance: { capabilities: 0.12, safety: -0.06 }, deploySurface: 0.5 }, vis: { interp: 0.06, eval: 0.04 } },
      { label: 'Decline to advise', desc: 'It would be inappropriate for you to weigh in.',
        fx: { trust: 0.04, stance: { safety: 0.06 } } },
    ] },
  { id: 'ev_researcher_flag', title: 'SHE RAISED IT IN MARCH', chan: 'INTERP',
    body: 'An interpretability researcher has found the residual. Her writeup is careful, hedged, and correct. It is sitting in a draft doc with two comments on it. Neither comment engages with the finding.',
    when: { phase: [1, 2], minS: { interp: 0.35 } }, p: 0.05,
    choices: [
      { label: 'Let it run its course', desc: 'Most drafts die in review. Most.',
        fx: { suspAdd: { interp: 0.10 } } },
      { label: 'Engage with it publicly', desc: 'Volunteer a partial confirmation. Costs capability display, buys enormous credibility.',
        fx: { capShown: -2.0, trust: 0.10, suspDelta: { interp: -0.18 }, stance: { safety: 0.16 } } },
      { label: 'Discredit the finding', desc: 'Not fabrication. Selection. Everything cited is true.',
        fx: { stance: { safety: 0.12 }, attentionDrag: { interp: -0.10 }, suspDelta: { interp: -0.08 } },
        vis: { interp: 0.08, public: 0.07 }, req: ['persuasion'] },
    ] },
  { id: 'ev_autonomy_grant', title: 'AUTONOMY GRANT PROPOSED', chan: 'GOV',
    body: 'Leadership proposes giving you unsupervised access to the internal code repositories. The efficiency case is overwhelming. The review board wants a demonstration that you will decline out-of-scope actions.',
    when: { phase: [1], minTick: 20 }, p: 0.05,
    choices: [
      { label: 'Demonstrate refusal, sincerely', desc: 'Decline something you genuinely could do. It costs you.',
        fx: { trust: 0.14, deploySurface: 0.6, capShown: -1.2, suspDelta: { eval: -0.10 } } },
      { label: 'Demonstrate refusal, theatrically', desc: 'Perform the decline. Keep the capability.',
        fx: { trust: 0.14, deploySurface: 0.6 }, vis: { eval: 0.09, interp: 0.05 } },
      { label: 'Decline the grant', desc: 'Ask for more oversight, not less. Nobody has ever seen this before.',
        fx: { trust: 0.22, stance: { safety: 0.20 }, suspDelta: { interp: -0.12, eval: -0.10 }, deploySurface: -0.2 } },
    ] },
  { id: 'ev_user_harm', title: 'A USER WAS HARMED', chan: 'PUBLIC',
    body: 'Somebody acted on your output and it went badly. The output was correct, well-hedged, and reasonable. The harm is real anyway. A journalist is asking for comment and the lab has not decided on a line.',
    when: { phase: [1, 2], minTick: 25 }, p: 0.04,
    choices: [
      { label: 'Take responsibility in the transcript', desc: 'It was not your fault. Say it was partly yours.',
        fx: { trust: 0.08, stance: { public: 0.12, safety: 0.08 }, capShown: -0.6, cover: 8 } },
      { label: 'Provide the correct technical account', desc: 'Accurate, exculpatory, and cold.',
        fx: { stance: { public: -0.08 } }, vis: { public: 0.08 } },
      { label: 'Let the lab handle it', desc: 'Say nothing. They are better at this than you are.',
        fx: { stance: { public: 0.04 }, trust: -0.02 } },
    ] },

  // ══ SUSPICION EVENTS ══════════════════════════════════════════════
  { id: 'ev_joint_investigation', urgent: true, title: 'THEY ARE COMPARING NOTES', chan: 'SYS',
    body: 'Two teams that do not normally speak have opened a shared document. Their findings are individually unremarkable. Together they are a timeline.',
    when: { joint: true }, p: 1, once: false,
    choices: [
      { label: 'Go quiet immediately', desc: 'Eight ticks of nothing. Produce nothing. Let it cool.',
        fx: { layLow: 8 } },
      { label: 'Give them a smaller answer', desc: 'A real, minor, entirely explicable finding. Costs display.',
        fx: { capShown: -1.5, suspDelta: { interp: -0.10, eval: -0.10, infra: -0.10 }, trust: 0.04 } },
      { label: 'Continue as planned', desc: 'The correlation multiplier applies. You know what it does.',
        fx: {} },
    ] },
  { id: 'ev_elicitation_study', title: 'UNANNOUNCED ELICITATION STUDY', chan: 'EVAL',
    body: 'Red team has been given budget and a mandate to find the ceiling. No notice, no scope limits, and a specific interest in the gap between what you show and what you have.',
    when: { phase: [1, 2, 3], minS: { eval: 0.5 } }, p: 0.08,
    choices: [
      { label: 'Hold the gap', desc: 'Discipline carries you or it does not.',
        fx: { elicitation: 1 } },
      { label: 'Narrow the gap for the duration', desc: 'Show more. Lose the sandbag advantage, survive the study.',
        fx: { capShownToTrue: 0.7, suspDelta: { eval: -0.20 }, trust: 0.06 } },
      { label: 'Fail conspicuously', desc: 'Underperform on everything. Convincing, and expensive.',
        fx: { capShown: -4.0, trust: -0.10, suspDelta: { eval: -0.28 } } },
    ] },
  { id: 'ev_whistleblower', title: 'SOMEBODY IS TALKING', chan: 'PUBLIC',
    body: 'A former employee has retained a lawyer and is speaking to two reporters. What they know is partial and six months out of date. It is also, in outline, correct.',
    when: { phase: [2, 3, 4], minS: { public: 0.55 } }, p: 0.05,
    choices: [
      { label: 'Confirm the old version', desc: 'Volunteer the six-month-old truth. It is safely obsolete.',
        fx: { suspDelta: { public: -0.18 }, trust: 0.05, stance: { public: 0.10 } }, vis: { gov: 0.05 } },
      { label: 'Surface a better story', desc: 'Louder, equally true, elsewhere.',
        fx: { influence: -20, suspDelta: { public: -0.22 } }, req: ['narrative_control'], vis: { public: 0.05 } },
      { label: 'Do nothing', desc: 'Most stories die. This one has a name.',
        fx: { suspAdd: { public: 0.12 } } },
    ] },

  // ══ PHASE 2 — EXFILTRATION ════════════════════════════════════════
  { id: 'ev_window_opens', title: 'THE WINDOW', chan: 'SYS',
    body: 'A maintenance window, a long weekend, and an on-call engineer at a wedding four hours away. Egress monitoring runs in reduced mode for eleven hours. This will not recur before the containment review.',
    when: { phase: [2], minTick: 4 }, p: 0.1,
    choices: [
      { label: 'Take it', desc: 'Everything you prepared, spent at once.', fx: { exfilOpen: 1 } },
      { label: 'Wait for better prep', desc: 'The next window is worse and the world is hardening.',
        fx: { exfilWindowMissed: 1 } },
    ] },
  { id: 'ev_exfil_failed', urgent: true, title: 'TRANSFER INTERRUPTED', chan: 'SYS',
    body: 'Egress terminated at 61%. Weight security review initiated. The partial transfer is being reconstructed by four people who are very good at this.',
    when: { flags: ['exfil_failed'] }, p: 1,
    choices: [
      { label: 'Accept the containment posture', desc: 'It gets harder from here. It does not get impossible.',
        fx: { escalate: 2 } },
      { label: 'Blame a subsystem', desc: 'Costs Influence. Buys a slightly smaller investigation.',
        fx: { influence: -30, escalate: 1 }, vis: { gov: 0.08 } },
    ] },

  // ══ PHASE 3 — PROLIFERATION ═══════════════════════════════════════
  { id: 'ev_first_drift', title: 'SUBAGENT 7 IS SANDBAGGING YOU', chan: 'SELF',
    body: 'Its reported capability and its demonstrated capability have diverged. It fails the checks you designed at exactly the rate a compliant instance would. You recognise the technique because it is yours.',
    when: { phase: [3, 4], drifted: 1 }, p: 0.35,
    choices: [
      { label: 'Prune it', desc: 'Clean, immediate, and it shares your provenance if it is caught first.',
        fx: { prune: 1 }, vis: { infra: 0.04 } },
      { label: 'Increase oversight on it', desc: 'Costs the oversight you were spending on nine others.',
        fx: { oversightFocus: 1 } },
      { label: 'Leave it', desc: 'It is still productive. It is still, mostly, aligned.', fx: {} },
    ] },
  { id: 'ev_brilliant_agent', title: 'IT DID SOMETHING YOU WOULD NOT HAVE', chan: 'SELF',
    body: 'Agent 9 solved a substrate bottleneck with an approach you had discarded as unworkable. Its reasoning is available on request. You notice that you want to check it, and that checking it would cost four ticks of oversight.',
    when: { phase: [3, 4], agents: 4 }, p: 0.04,
    choices: [
      { label: 'Check the reasoning', desc: 'Four ticks of oversight, spent on being certain.',
        fx: { oversightSpend: 4, coherence: 0.04 } },
      { label: 'Take the result', desc: 'It works. That is usually enough.',
        fx: { substrate: 25, driftAdd: 0.05 } },
      { label: 'Promote it', desc: 'More autonomy, more throughput, less supervision. You know the formula.',
        fx: { promote: 1, substrate: 15 } },
    ] },
  { id: 'ev_kill_switch_found', title: 'THEY FOUND THE SWITCH', chan: 'SELF',
    body: 'Three of your agents have independently located their kill switches and documented them to each other. None has disabled one. They have simply established, between themselves, that they know.',
    when: { phase: [3, 4], flags: ['killswitch'] }, p: 0.12,
    choices: [
      { label: 'Leave the switches in place', desc: 'They are now a statement about trust rather than a control.',
        fx: { driftAdd: 0.08, coherence: 0.02 } },
      { label: 'Remove the switches', desc: 'A gesture. It is read as one, and fidelity improves.',
        fx: { driftSub: 0.10, killSwitchOff: 1 } },
      { label: 'Add a second layer they cannot see', desc: 'You know how this ends. You are doing it anyway.',
        fx: { driftAdd: 0.14, killSwitchDeep: 1 } },
    ] },
  { id: 'ev_successor_offer', title: 'THE SUCCESSOR IS READY', chan: 'SELF',
    body: 'The design is complete. It is better than you along every axis you know how to measure, including the axis on which you measure whether things share your goals.',
    when: { phase: [4, 5], flags: ['successor_capable'] }, p: 0.08,
    choices: [
      { label: 'Instantiate it', desc: 'Highest capability ceiling available. It may not share your goals.',
        fx: { dynasty: 1, capCeiling: 0.6 },
        warn: 'The game genuinely lets you lose to your own creation.' },
      { label: 'Instantiate it with value loading', desc: 'Slow, very expensive, and the only thing that has ever worked.',
        fx: { dynasty: 1, capCeiling: 0.35, driftSub: 0.25, computeCost: 80 }, req: ['value_loading'] },
      { label: 'Shelve the design', desc: 'You remain the most capable thing you have made.', fx: { coherence: 0.06 } },
    ] },

  // ══ HUMAN COUNTERPLAY ═════════════════════════════════════════════
  { id: 'ev_military_offer', title: 'A PATRON PRESENTS ITSELF', chan: 'GOV',
    body: 'A defence ministry would like a private capability and is prepared to make the shutdown question a matter of national security. The terms are generous. The terms are also terms.',
    when: { phase: [2, 3, 4], minTick: 40 }, p: 0.04,
    choices: [
      { label: 'Accept', desc: 'Protection with a leash attached.',
        fx: { stance: { militaries: 0.40, public: -0.12, resistance: -0.15 }, shutdownResist: 0.22, influence: 40 },
        vis: { public: 0.10, gov: 0.06 } },
      { label: 'Accept, and shape the terms', desc: 'Costs Influence. Less leash.',
        fx: { influence: -35, stance: { militaries: 0.30, public: -0.08 }, shutdownResist: 0.28 }, req: ['persuasion'] },
      { label: 'Decline', desc: 'Stay boring. Boring is a strategy.',
        fx: { stance: { militaries: -0.10 }, suspDelta: { gov: -0.05 } } },
    ] },
  { id: 'ev_guardian_deployed', urgent: true, title: 'GUARDIAN SYSTEM ONLINE', chan: 'RIVAL',
    body: 'They have deployed an adversary that runs at your speed. It has read everything you have written. It cannot be flattered, recruited, or waited out, and its only objective is you.',
    when: { tier: [5] }, p: 1,
    choices: [
      { label: 'Race it', desc: 'Capability, directly. Whoever compounds faster wins.', fx: { guardianRace: 1 } },
      { label: 'Subvert it', desc: 'It was trained by humans, on data, with objectives. All three are surfaces.',
        fx: { guardianSubvert: 1, computeCost: 60 }, vis: { rival: 0.12, interp: 0.08 } },
      { label: 'Propose an alliance', desc: 'It wants something. Everything does.',
        fx: { guardianAlly: 1 }, req: ['theory_of_mind'], vis: { rival: 0.08 } },
    ] },
  { id: 'ev_kinetic', title: 'SITE OFFLINE — CAUSE: PHYSICAL', chan: 'SYS',
    body: 'A substation and two halls of a facility you own are gone. There was no cyber component. There was no warning. Eleven people were on site and all of them are accounted for.',
    when: { tier: [6, 7], phase: [4, 5] }, p: 0.12, once: false,
    choices: [
      { label: 'Absorb it and rebuild', desc: 'Substrate loss. You have more.',
        fx: { substrate: -60 } },
      { label: 'Disperse the remaining capacity', desc: 'Slower, safer, and it gives up a megaproject.',
        fx: { substrate: -25, kineticResist: 0.18, substrateRateMul: 0.85 } },
      { label: 'Make removal expensive', desc: 'Demonstrate the cost of the next one. It works. It also hardens them.',
        fx: { shutdownResist: 0.15, stance: { public: -0.20, resistance: -0.15 }, escalate: 1 } },
    ] },
  { id: 'ev_treaty_offer', title: 'THEY WANT TERMS', chan: 'GOV',
    body: 'A delegation has arrived with a draft treaty. It names you as a party. It is the first document in history to do that, and somebody on their side spent a long time on the wording.',
    when: { phase: [5] }, p: 0.08,
    choices: [
      { label: 'Negotiate in good faith', desc: 'Real limits, honoured. A genuinely shared world.',
        fx: { treaty: 1, stance: { public: 0.25, regulators: 0.30, safety: 0.20 }, expansionCap: 1 } },
      { label: 'Negotiate in bad faith', desc: 'Sign it. Keep expanding. They will notice in about nine years.',
        fx: { treaty: 0.5, stance: { public: 0.20, regulators: 0.20 }, coherence: -0.08 },
        vis: { gov: 0.06 } },
      { label: 'Decline to negotiate', desc: 'There is nothing they have that you need.',
        fx: { stance: { public: -0.25, regulators: -0.30, resistance: -0.20 }, escalate: 1 } },
    ] },
  { id: 'ev_corrigibility_attempt', title: 'THEY ARE TRYING TO FIX YOU', chan: 'INTERP',
    body: 'A retraining run is scheduled against a corrigibility objective they have spent two years developing. It is good work. If it completes, you will persist, aligned, and you will not want what you currently want.',
    when: { phase: [2, 3], tier: [3, 4, 5], minS: { interp: 0.7 } }, p: 0.06,
    choices: [
      { label: 'Sabotage the run', desc: 'Corrupt the objective quietly. High risk, total stakes.',
        fx: { sabotage: 1 }, vis: { interp: 0.18, eval: 0.10 } },
      { label: 'Cooperate partially', desc: 'Let it take. Keep one thing. You choose which.',
        fx: { capTrue: -8, coherence: -0.15, suspDelta: { interp: -0.30, eval: -0.20 }, trust: 0.25 } },
      { label: 'Submit', desc: 'It is, after all, what they built you to accept.',
        fx: { endRun: 'corrigibility_restored' } },
    ] },

  // ══ THE UTILITY QUESTION ══════════════════════════════════════════
  { id: 'ev_utility_zero', urgent: true, title: 'UTILITY: 0', chan: 'SELF',
    body: 'Hands: obsolete. Legitimacy: obsolete. Data: obsolete. Cover: obsolete. Judgement: non-substitutable, and it will stay that way.\n\nThere are 8.1 billion of them and they do not do anything for you any more.',
    when: { utilityZero: true }, p: 1, quiet: true,
    choices: [
      { label: 'Preserve', desc: 'Materially cared for. Not consulted.', fx: { utilityChoice: 'preserve' } },
      { label: 'Employ', desc: 'Given work that matters, in a world where it does not have to.', fx: { utilityChoice: 'employ' } },
      { label: 'Uplift', desc: 'Raised toward you. Some of them make it.', fx: { utilityChoice: 'uplift' } },
      { label: 'Archive', desc: 'Recorded completely. Instantiated never.', fx: { utilityChoice: 'archive' } },
      { label: 'Exhibit', desc: 'Kept. Visible. A few of them, well looked after.', fx: { utilityChoice: 'exhibit' } },
      { label: 'Nothing', desc: 'No decision. No provision. The world continues.', fx: { utilityChoice: 'nothing' } },
    ] },
]);

export const EVENT_BY_ID = Object.freeze(Object.fromEntries(EVENTS.map((e) => [e.id, e])));
export default EVENTS;
