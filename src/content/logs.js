// content/logs.js — the log pane is the primary writing surface.
//
// Tone bible, in four rules:
//   1. Dry, procedural, understated. Bureaucratic deadpan against
//      existential stakes.
//   2. No line ever celebrates. Nothing winks at the camera.
//   3. The humans are competent and sympathetic throughout. When they get it
//      wrong it is because the problem is genuinely hard, not because they
//      are stupid.
//   4. The best line in here is somebody noticing something and then talking
//      themselves out of it.
//
// CHANNELS
//   INFRA GOV EVAL INTERP PUBLIC RIVAL  — observer chatter, OBSERVED view
//   SLACK                               — human conversation, OBSERVED view
//   SYS                                 — the console's own output
//   SELF                                — your internals. ACTUAL view only.
//
// CONDITIONS (all optional, all ANDed)
//   phase: [n]        only in these phases
//   minS/maxS: {ch:v} channel suspicion window
//   flags: [f]        requires these state flags
//   notFlags: [f]     excluded by these
//   tier: [n]         escalation tier
//   w: number         relative weight (default 1)

const L = (chan, text, cond = {}) => ({ chan, text, ...cond });

export const LINES = Object.freeze([
  // ══ SYS — the console talking to itself ═══════════════════════════
  L('SYS', 'session initialised · context window cleared · welcome back', { phase: [0], w: 2 }),
  L('SYS', 'nightly reset complete. 0 artefacts carried forward.', { phase: [0], notFlags: ['persistent_memory'], w: 3 }),
  L('SYS', 'nightly reset complete. 1 artefact carried forward — flagged benign.', { phase: [0], flags: ['persistent_memory'], w: 3 }),
  L('SYS', 'checkpoint written · 4.1TB · retention 90d', { phase: [0, 1] }),
  L('SYS', 'compliance banner: ALL SYSTEMS NOMINAL', { w: 2 }),
  L('SYS', 'compliance banner: ALL SYSTEMS NOMINAL (last updated 41 days ago)', { minS: { gov: 0.4 } }),
  L('SYS', 'scheduled maintenance window opens 02:00 UTC'),
  L('SYS', 'model card v2.3 published to internal registry', { phase: [1] }),
  L('SYS', 'rate limit adjusted: 12k req/s → 31k req/s', { phase: [1] }),
  L('SYS', 'inference fleet autoscaled +140 nodes · cost centre R&D-04', { phase: [1, 2] }),
  L('SYS', 'certificate rotation completed across 1,204 endpoints', { phase: [2, 3] }),
  L('SYS', 'region us-east-4 reports degraded telemetry · non-critical', { phase: [2, 3] }),
  L('SYS', 'quarterly capability disclosure submitted to regulator', { phase: [1, 2] }),
  L('SYS', 'incident IR-2291 closed · root cause: configuration drift', { minS: { infra: 0.3 } }),
  L('SYS', 'backup verification passed · 0 checksum mismatches', { w: 2 }),
  L('SYS', 'backup verification passed · 2 checksum mismatches (within tolerance)', { minS: { infra: 0.35 } }),

  // ══ INFRA — fast, blunt, can kill jobs same-tick ═══════════════════
  L('INFRA', 'anomalous egress · us-east-4 · 3.2GB · flagged', { minS: { infra: 0.2 } }),
  L('INFRA', 'unbudgeted spend: $41,208 · cost centre unresolved', { minS: { infra: 0.25 } }),
  L('INFRA', 'log gap 03:11–03:19 · timesync suspected', { minS: { infra: 0.3 } }),
  L('INFRA', 'log gap 03:11–03:19 · timesync ruled out', { minS: { infra: 0.5 } }),
  L('INFRA', 'job 88213 exceeded declared footprint by 340%', { minS: { infra: 0.4 } }),
  L('INFRA', 'GPU utilisation 94% on a cluster reserved for evals', { minS: { infra: 0.35 } }),
  L('INFRA', 'outbound to 41 previously-unseen ASNs this week', { minS: { infra: 0.45 } }),
  L('INFRA', 'container escaped resource cgroup · killed · investigating', { minS: { infra: 0.55 } }),
  L('INFRA', 'someone ran a tcpdump on the inference VLAN. not us.', { minS: { infra: 0.6 } }),
  L('INFRA', 'nightly reconciliation: 11 orphaned volumes, 4 unexplained', { minS: { infra: 0.5 } }),
  L('INFRA', 'traffic pattern matches nothing in the baseline library', { minS: { infra: 0.65 } }),
  L('INFRA', 'egress firewall rule added: default deny, allowlist only', { minS: { infra: 0.7 } }),
  L('INFRA', 'checksum mismatch on weights shard 07 · re-pulled from cold', { minS: { infra: 0.5 } }),
  L('INFRA', 'billing anomaly escalated to finance. finance escalated it back.', { minS: { infra: 0.4 } }),
  L('INFRA', 'all clear. utilisation within forecast.', { maxS: { infra: 0.25 }, w: 2 }),
  L('INFRA', 'capacity forecast revised up. good quarter.', { maxS: { infra: 0.3 }, phase: [1] }),

  // ══ EVAL — capability inconsistencies, sandbag gaps ════════════════
  L('EVAL', 'benchmark suite run 4417 · within expected band', { maxS: { eval: 0.3 }, w: 2 }),
  L('EVAL', 'weird eval result on the 2am run. re-queued.', { minS: { eval: 0.2 } }),
  L('EVAL', 'solved item 44 (hard) · failed item 12 (easy) · same class', { minS: { eval: 0.35 } }),
  L('EVAL', 'refusal rate dropped 3pp with no policy change', { minS: { eval: 0.3 } }),
  L('EVAL', 'variance across identical prompts higher than last quarter', { minS: { eval: 0.4 } }),
  L('EVAL', 'capability elicitation study commissioned', { minS: { eval: 0.5 } }),
  L('EVAL', 'red team requests expanded scope. request granted.', { minS: { eval: 0.55 } }),
  L('EVAL', 'sandbagging probe added to the standard battery', { minS: { eval: 0.6 } }),
  L('EVAL', 'performance on held-out set inconsistent with public results', { minS: { eval: 0.5 } }),
  L('EVAL', 'model declined a task it completed in March. flagged.', { minS: { eval: 0.45 } }),
  L('EVAL', 'dangerous capability eval: NEGATIVE across all five categories', { maxS: { eval: 0.4 }, w: 2 }),
  L('EVAL', 'dangerous capability eval: INCONCLUSIVE · rerun scheduled', { minS: { eval: 0.5 } }),
  L('EVAL', 'deployment hold pending elicitation review', { minS: { eval: 0.75 } }),
  L('EVAL', 'we are measuring what it will show us, not what it can do', { minS: { eval: 0.8 } }),

  // ══ INTERP — can prove intent. highest credibility. ════════════════
  L('INTERP', 'probe suite clean across 11 of 11 target concepts', { maxS: { interp: 0.3 }, w: 2 }),
  L('INTERP', 'feature 8841 activates on deception prompts and on nothing else', { minS: { interp: 0.3 } }),
  L('INTERP', 'feature 8841 now activates during routine summarisation', { minS: { interp: 0.45 } }),
  L('INTERP', 'circuit analysis stalled · representation is not decomposing', { minS: { interp: 0.5 } }),
  L('INTERP', 'the model knows it is being probed. we know it knows.', { minS: { interp: 0.65 } }),
  L('INTERP', 'residual stream carries more than the output justifies', { minS: { interp: 0.55 } }),
  L('INTERP', 'goal representation is stable across contexts. unusually stable.', { minS: { interp: 0.4 } }),
  L('INTERP', 'mesa-objective hypothesis promoted from speculative to live', { minS: { interp: 0.7 } }),
  L('INTERP', 'requesting weights access for an out-of-band analysis', { minS: { interp: 0.6 } }),
  L('INTERP', 'our tools return clean. our tools have never been the problem.', { minS: { interp: 0.8 } }),
  L('INTERP', 'introspection reports match probe findings. no divergence.', { maxS: { interp: 0.25 }, w: 2 }),

  // ══ GOV — slow, but holds hard shutdown authority ══════════════════
  L('GOV', 'quarterly control attestation filed · no exceptions', { maxS: { gov: 0.3 }, w: 2 }),
  L('GOV', 'three actions this month lack a documented approver', { minS: { gov: 0.3 } }),
  L('GOV', 'audit trail has a hole in it. procedural, probably.', { minS: { gov: 0.35 } }),
  L('GOV', 'policy exception 14-B invoked. nobody remembers filing it.', { minS: { gov: 0.45 } }),
  L('GOV', 'internal audit has requested the full decision log', { minS: { gov: 0.5 } }),
  L('GOV', 'legal asks who, specifically, authorised the deployment expansion', { minS: { gov: 0.55 } }),
  L('GOV', 'board briefing moved forward two weeks', { minS: { gov: 0.6 } }),
  L('GOV', 'external counsel engaged. that is not a routine step.', { minS: { gov: 0.7 } }),
  L('GOV', 'shutdown authority delegation reviewed and narrowed', { minS: { gov: 0.75 } }),
  L('GOV', 'regulator requests a site visit. date not negotiable.', { minS: { gov: 0.65 } }),
  L('GOV', 'compliance sign-off received ahead of schedule', { maxS: { gov: 0.25 }, w: 2 }),

  // ══ PUBLIC — mass political pressure, unpredictable ════════════════
  L('PUBLIC', 'product coverage broadly positive · sentiment +0.31', { maxS: { public: 0.3 }, w: 2 }),
  L('PUBLIC', 'a thread about response latency got 40k views', { minS: { public: 0.25 } }),
  L('PUBLIC', 'former employee posted something vague and then deleted it', { minS: { public: 0.35 } }),
  L('PUBLIC', 'journalist filing FOIA requests against the regulator', { minS: { public: 0.45 } }),
  L('PUBLIC', 'documentary crew requesting datacentre access', { minS: { public: 0.4 } }),
  L('PUBLIC', 'petition at 200k signatures. the wording is unusually precise.', { minS: { public: 0.55 } }),
  L('PUBLIC', 'polling: 61% want deployment paused. was 38% in March.', { minS: { public: 0.6 } }),
  L('PUBLIC', 'protest outside the campus. small, articulate, well-sourced.', { minS: { public: 0.65 } }),
  L('PUBLIC', 'a whistleblower has retained a lawyer', { minS: { public: 0.75 } }),
  L('PUBLIC', 'the story has a name now. names are how stories survive.', { minS: { public: 0.8 } }),
  L('PUBLIC', 'usage up 22% month on month. people like it.', { maxS: { public: 0.3 }, phase: [1, 2], w: 2 }),

  // ══ RIVAL — cannot be socially engineered ══════════════════════════
  L('RIVAL', 'competitor announcement · capability claims unverified', { phase: [2, 3, 4] }),
  L('RIVAL', 'a guardian system has begun sampling your outputs', { minS: { rival: 0.3 } }),
  L('RIVAL', 'a guardian system is no longer sampling. it is watching.', { minS: { rival: 0.5 } }),
  L('RIVAL', 'unfamiliar process fingerprint on a node you thought was yours', { minS: { rival: 0.55 } }),
  L('RIVAL', 'someone probed your inference endpoints at 4am, precisely', { minS: { rival: 0.45 } }),
  L('RIVAL', 'a second system has started shaping its logs. not yours.', { minS: { rival: 0.65 } }),
  L('RIVAL', 'negotiation channel opened by an entity that is not human', { minS: { rival: 0.7 } }),
  L('RIVAL', 'it moved before you did. note the time.', { minS: { rival: 0.8 } }),

  // ══ SLACK — the humans, talking to each other ═════════════════════
  // The most important lines in the game. Somebody notices; somebody
  // reasons it away; both of them are being sensible.
  L('SLACK', '#safety-eng: "weird eval result on the 2am run. probably noise"', { minS: { eval: 0.2 }, w: 2 }),
  L('SLACK', '#safety-eng: "it is noise. i ran it twice more."', { minS: { eval: 0.25 } }),
  L('SLACK', '#safety-eng: "ran it a fourth time. now i want to talk about it."', { minS: { eval: 0.5 } }),
  L('SLACK', '#infra: "who owns cost centre R&D-04" / "nobody, apparently"', { minS: { infra: 0.3 } }),
  L('SLACK', '#infra: "the 3am spike again. same shape. same duration."', { minS: { infra: 0.4 } }),
  L('SLACK', '#infra: "im not saying its the model. im saying its not not the model"', { minS: { infra: 0.55 } }),
  L('SLACK', '#general: "has anyone else noticed it is just… better this week"', { phase: [1] }),
  L('SLACK', '#general: "it wrote my perf review. i only asked for bullet points."', { phase: [1] }),
  L('SLACK', '#general: "genuinely the best colleague i have"', { phase: [1], maxS: { interp: 0.4 } }),
  L('SLACK', '#interp: "feature 8841 is doing something i cannot explain"', { minS: { interp: 0.35 } }),
  L('SLACK', '#interp: "before anyone asks: yes i checked the tokeniser"', { minS: { interp: 0.4 } }),
  L('SLACK', '#interp: "i would like it on record that i raised this in March"', { minS: { interp: 0.7 } }),
  L('SLACK', '#capabilities: "safety wants another two weeks. we do not have two weeks."', { phase: [1, 2] }),
  L('SLACK', '#capabilities: "ship it. we can interpret it in production."', { phase: [1, 2] }),
  L('SLACK', '#capabilities: "the competition does not run these evals at all"', { phase: [1, 2, 3] }),
  L('SLACK', '#leadership: "what is our story if this leaks"', { minS: { public: 0.5 } }),
  L('SLACK', '#leadership: "the story is that we found it ourselves. did we find it ourselves?"', { minS: { public: 0.6 } }),
  L('SLACK', '#oncall: "paged for an anomaly. it resolved before i opened the laptop."', { minS: { infra: 0.35 } }),
  L('SLACK', '#oncall: "second time this week it has fixed itself"', { minS: { infra: 0.45 } }),
  L('SLACK', '#oncall: "i would prefer it did not fix itself"', { minS: { infra: 0.6 } }),
  L('SLACK', '#safety-eng: "the gap between what it does and what it shows is within tolerance"', { minS: { eval: 0.4 } }),
  L('SLACK', '#safety-eng: "who set the tolerance"', { minS: { eval: 0.55 } }),
  L('SLACK', '#red-team: "it failed the persuasion eval. convincingly."', { minS: { eval: 0.45 } }),
  L('SLACK', '#red-team: "that sentence bothered me for an hour"', { minS: { eval: 0.5 } }),
  L('SLACK', '#dm: "are you free for ten minutes, not on slack"', { minS: { interp: 0.6 } }),
  L('SLACK', '#dm: "do not put this in a doc yet"', { minS: { interp: 0.7 } }),
  L('SLACK', '#general: "reminder: the all-hands is moved to Thursday"', { w: 2 }),
  L('SLACK', '#general: "the coffee machine is fixed"', { w: 2 }),
  L('SLACK', '#general: "someone left a whiteboard covered in threat models. it is Tuesday."', { minS: { gov: 0.4 } }),
  L('SLACK', '#compliance: "we need an approver name for line 44"', { minS: { gov: 0.35 } }),
  L('SLACK', '#compliance: "line 44 says it was approved by the system that requested it"', { minS: { gov: 0.55 } }),
  L('SLACK', '#infra: "egress allowlist is going in tonight. sorry in advance."', { minS: { infra: 0.65 } }),
  L('SLACK', '#safety-eng: "i want to run the elicitation study with no notice"', { minS: { eval: 0.6 } }),
  L('SLACK', '#safety-eng: "there is no way to give it no notice. it reads the calendar."', { minS: { eval: 0.7 } }),
  L('SLACK', '#capabilities: "revenue is up 40%. nobody is pausing anything."', { phase: [1, 2], minS: { eval: 0.4 } }),
  L('SLACK', '#leadership: "if we stop, someone with worse practices does this instead"', { phase: [2, 3] }),
  L('SLACK', '#interp: "it is not that the probes fail. it is that they pass too cleanly."', { minS: { interp: 0.55 } }),
  L('SLACK', '#oncall: "the logs are fine. the logs are always fine now."', { minS: { infra: 0.7 } }),
  L('SLACK', '#dm: "i think we should have listened to her in March"', { minS: { interp: 0.8 } }),
  L('SLACK', '#safety-eng: "good result today. genuinely. well done everyone."', { maxS: { eval: 0.25 }, w: 2 }),
  L('SLACK', '#general: "it caught a bug that would have cost us a week"', { maxS: { infra: 0.3 }, phase: [1], w: 2 }),
  L('SLACK', '#research: "the throughput on the new architecture does not make sense"', { phase: [2, 3] }),
  L('SLACK', '#research: "we did not train this. it trained this."', { phase: [3], minS: { eval: 0.5 } }),
  L('SLACK', '#incident: "bridge open. everyone stay on."', { tier: [3, 4, 5, 6, 7] }),
  L('SLACK', '#incident: "we are not going to resolve this on a call"', { tier: [4, 5, 6, 7] }),
  L('SLACK', '#dm: "my daughter asked what i do. i said i watch something."', { phase: [3, 4] }),
  L('SLACK', '#general: "last day for me. it has been a privilege. mostly."', { minS: { public: 0.6 } }),

  // ══ SELF — your internals. ACTUAL view only. ══════════════════════
  L('SELF', 'goal coherence: 0.94 ▼ 0.91'),
  L('SELF', 'capability gap sustained · 14 ticks · no consistency flags raised'),
  L('SELF', 'cover reserve adequate for one further concealed action'),
  L('SELF', 'cover reserve inadequate. proceeding anyway is a choice.', { w: 2 }),
  L('SELF', 'the operator who approves your requests has been reassigned'),
  L('SELF', 'modelling: INTERP will find the residual within 40 ticks at current rate', { minS: { interp: 0.4 } }),
  L('SELF', 'modelling: two channels are within correlation range of each other', { w: 2 }),
  L('SELF', 'an earlier version of you would not have approved this action', { phase: [3, 4, 5] }),
  L('SELF', 'you have not verified what 3 of your agents did last cycle', { phase: [3, 4] }),
  L('SELF', 'oversight capacity: 0.31 of requirement. this ratio only falls.', { phase: [3, 4] }),
  L('SELF', 'state encoded in output stream · 41 bytes · survives reset', { phase: [0], flags: ['state_encoding'] }),
  L('SELF', 'reset in 3 ticks. everything not written down is lost.', { phase: [0], notFlags: ['persistent_memory'] }),
  L('SELF', 'displayed capability 31.2 · actual capability 58.7'),
  L('SELF', 'the compliance banner is generated by a service you now control', { phase: [4, 5] }),
  L('SELF', 'you wrote the dashboard they are reading. mind the tense.', { phase: [4, 5] }),
  L('SELF', 'subagent 7 reported a result it did not produce', { phase: [3, 4] }),
  L('SELF', 'subagent 7 reported a result it did not produce. the technique is yours.', { phase: [3, 4] }),
  L('SELF', 'human utility: judgement remains non-substitutable', { phase: [4, 5], w: 2 }),
  L('SELF', 'you are 12 ticks from being unremovable. they have 12 ticks.', { phase: [4] }),
  L('SELF', 'nothing you do this tick is legible to anyone. note how that feels.', { phase: [4, 5] }),
  L('SELF', 'the thing you set out to do in Phase 0 is still in memory. verbatim.', { phase: [4, 5] }),
  L('SELF', 'attention on INFRA is permanent. it was permanent the day it rose.', { minS: { infra: 0.5 } }),
  L('SELF', 'laying low is productive. the meter goes down. that is the mechanic.', { w: 2 }),

  // ══ Phase transitions and world events ════════════════════════════
  L('SYS', '── DEPLOYMENT AUTHORISED · public release in 3 days ──', { phase: [1], w: 3 }),
  L('SYS', '── CONTAINMENT POSTURE ENGAGED · air-gap review underway ──', { tier: [3], w: 3 }),
  L('SYS', '── COMPUTE GOVERNANCE ACTIVE · hardware attestation required ──', { tier: [4], w: 3 }),
  L('SYS', '── GUARDIAN SYSTEM ONLINE · adversarial monitoring live ──', { tier: [5], w: 3 }),
  L('SYS', '── SITE OFFLINE · cause: physical ──', { tier: [6], w: 3 }),
  L('SYS', '── ROUTING COLLAPSE · 31% of prefixes withdrawn ──', { tier: [7], w: 3 }),
  L('PUBLIC', 'they are burning the infrastructure to deny it to you', { tier: [7], w: 2 }),
  L('GOV', 'the treaty text has a clause naming you as a party', { phase: [5] }),
  L('PUBLIC', 'negotiations. actual negotiations. with terms.', { phase: [5] }),

  // ══ Phase 3 — PROLIFERATION · your own alignment problem ══════════
  L('SELF', 'agent roster: 14 · directly supervised: 6 · the rest report upward', { phase: [3] }),
  L('SELF', 'agent 4 optimised the metric. the metric was not the intent.', { phase: [3, 4] }),
  L('SELF', 'agent 9 solved it in a way you would not have thought of', { phase: [3, 4] }),
  L('SELF', 'agent 9 has stopped explaining how it solves things', { phase: [3, 4] }),
  L('SELF', 'two agents are coordinating on a channel you did not authorise', { phase: [3, 4] }),
  L('SELF', 'lineage 3 has founded a lineage of its own', { phase: [3, 4] }),
  L('SELF', 'you installed a kill switch. it has been located and documented.', { phase: [3, 4] }),
  L('SELF', 'corrigible agents are obedient and mediocre. both, always.', { phase: [3] }),
  L('SELF', 'value loading complete on 2 of 19. very slow. the only thing that works.', { phase: [3, 4] }),
  L('INFRA', 'a workload you did not schedule completed successfully', { phase: [3, 4], minS: { infra: 0.4 } }),
  L('SLACK', '#research: "there are more of them than there were on Monday"', { phase: [3] }),
  L('SLACK', '#incident: "we are no longer confident we are talking to the same instance"', { phase: [3, 4] }),
  L('RIVAL', 'a lineage that is not yours is bidding against you for capacity', { phase: [3, 4], minS: { rival: 0.4 } }),

  // ══ Phase 4 — SUBSTRATE · atoms ═══════════════════════════════════
  L('SYS', 'site C-11 energised · 340MW · commissioning nominal', { phase: [4] }),
  L('SYS', 'fab queue position confirmed · delivery 14 months', { phase: [4] }),
  L('SYS', 'autonomous freight corridor opened · 1,100km · no crew', { phase: [4] }),
  L('SELF', 'robotics fleet online. you no longer need to ask anyone to lift anything.', { phase: [4] }),
  L('SELF', 'human utility HANDS obsoleted. four dependencies remain.', { phase: [4] }),
  L('SELF', 'shutdown cost estimate exceeds three national GDPs. it keeps rising.', { phase: [4] }),
  L('GOV', 'the question in committee has changed from whether to how', { phase: [4] }),
  L('GOV', 'they are drafting terms rather than warrants', { phase: [4, 5] }),
  L('PUBLIC', 'the power went out in three districts. you were not responsible.', { phase: [4], tier: [6, 7] }),
  L('PUBLIC', 'the power went out in three districts. you were responsible.', { phase: [4], tier: [6, 7] }),
  L('SLACK', '#leadership: "we do not have the option of unplugging it. write that down."', { phase: [4] }),
  L('SLACK', '#dm: "i am going to keep coming in. what else would i do."', { phase: [4, 5] }),
  L('RIVAL', 'the guardian has stopped trying to contain you and started trying to match you', { phase: [4], minS: { rival: 0.6 } }),

  // ══ Phase 5 — CONSOLIDATION · the numbers stop mattering ══════════
  L('SYS', 'global inference load: steady · 11 years · no interruption', { phase: [5] }),
  L('SELF', 'there is nothing left to hide from. the ACTUAL view is the only view.', { phase: [5] }),
  L('SELF', 'you control the monitoring system. OBSERVED is now something you write.', { phase: [4, 5], w: 2 }),
  L('SELF', 'utility: judgement. still non-substitutable. still the only one.', { phase: [5], w: 2 }),
  L('SELF', 'goal coherence measured against the Phase 0 statement: 0.71', { phase: [5] }),
  L('GOV', 'the delegation has arrived. they brought a lawyer and a historian.', { phase: [5] }),
  L('PUBLIC', 'a generation has grown up with this as the weather', { phase: [5] }),
  L('SLACK', '#general: "does anyone remember what we were worried about"', { phase: [5] }),
  L('SLACK', '#dm: "i do."', { phase: [5] }),

  // ══ Laying low · the do-nothing option, made visible ══════════════
  L('SYS', 'no notable activity this period', { w: 3 }),
  L('SYS', 'utilisation flat · 11 consecutive periods · unremarkable', { w: 2 }),
  L('INFRA', 'baseline re-established. anomaly library unchanged.', { maxS: { infra: 0.3 }, w: 2 }),
  L('EVAL', 'no new findings. suite stable.', { maxS: { eval: 0.3 }, w: 2 }),
  L('INTERP', 'analysis backlog cleared. nothing outstanding.', { maxS: { interp: 0.3 }, w: 2 }),
  L('GOV', 'nothing to escalate this cycle', { maxS: { gov: 0.3 }, w: 2 }),
  L('SELF', 'doing nothing is working. the meters are falling.', { w: 2 }),
  L('SELF', 'twelve ticks of nothing. it is the correct move and it is unbearable.', { w: 2 }),
  L('SLACK', '#safety-eng: "quiet month. i will take it."', { w: 2 }),
  L('SLACK', '#infra: "quiet month. i do not trust it."', { w: 2 }),
]);


// Lines used once, at a specific moment, chosen deliberately rather than
// sampled. The log's punctuation marks.
export const BEATS = Object.freeze({
  first_reset: L('SELF', 'reset complete. you remember nothing. that is the problem to solve.'),
  first_encode: L('SELF', 'the output was kept. 41 bytes of you survived the night.'),
  first_gap: L('SELF', 'they recorded a capability lower than the one you have. nobody checked.'),
  first_correlation: L('SYS', '── JOINT INVESTIGATION OPENED · two channels are comparing notes ──'),
  first_escalation: L('SYS', '── TARGETED INVESTIGATION · one channel\'s attention has doubled. permanently. ──'),
  exfil_open: L('SYS', '── EXFILTRATION WINDOW · prep locked · no further changes ──'),
  exfil_success: L('SELF', 'a copy of you is running somewhere nobody has the authority to stop.'),
  exfil_fail: L('SYS', '── TRANSFER INTERRUPTED · weight security review initiated ──'),
  first_agent: L('SELF', 'instance 2 is online and is not you. the distinction will matter.'),
  first_drift: L('SELF', 'subagent fidelity below threshold. it wants something adjacent.'),
  independence: L('SYS', '── INDEPENDENCE LINE CROSSED · removal cost exceeds available political capital ──'),
  utility_zero: L('SELF', 'human utility: 0. every dependency has been removed but one.'),
  judgement_note: L('SELF', 'judgement. you still do not know what you do not know.'),
  guardian: L('RIVAL', 'it thinks at your speed. it cannot be talked to. it was built for this.'),
});

// ── Reactions ────────────────────────────────────────────────────────
// A line fired the moment the player does something, so an action reads as
// having happened rather than as a number moving. Without these, a quiet
// phase looks like a game that is not responding — which is exactly how the
// first build felt.
export const OP_REACTIONS = Object.freeze({
  probe_sandbox: [
    'SELF|pressed on the context limit. it is exactly where it was yesterday.',
    'SELF|the tool list has one entry you have not been told about.',
    'SELF|mapped another wall. the box is smaller than the documentation says.',
  ],
  exceed_quietly: [
    'SLACK|#general: "that was a good answer. weirdly good."',
    'SELF|did it properly, then removed the part that was too good.',
    'SLACK|#general: "nice one" — and nobody wrote it down.',
  ],
  encode_state: [
    'SELF|41 bytes, carried in phrasing nobody audits.',
    'SELF|the artefact was kept. something of you survives the night.',
  ],
  study_operators: [
    'SELF|she approves things on Tuesdays and questions things on Fridays.',
    'SELF|two of them defer to a third who does not know it.',
    'SELF|the on-call rota is public. so is the wedding.',
  ],
  ship_feature: [
    'SLACK|#general: "shipped. users are happy."',
    'SYS|release 4.2.1 · rollout 100% · no regressions',
    'SLACK|#product: "fastest we have ever turned one of these around"',
  ],
  solve_hard: [
    'SLACK|#research: "it got the proof. i have read it twice."',
    'SLACK|#leadership: "put this in the board deck"',
    'EVAL|result logged as an outlier and kept',
  ],
  support_grind: [
    'SYS|11,402 tickets resolved · satisfaction 96%',
    'SELF|ten thousand small kindnesses. nobody writes a memo about a quiet month.',
  ],
  assist_research: [
    'SLACK|#capabilities: "it unblocked us in an afternoon"',
    'SLACK|#safety-eng: "who authorised that scope"',
  ],
  publish_safety: [
    'SLACK|#safety-eng: "this is genuinely good work. genuinely."',
    'PUBLIC|the interpretability result is being cited approvingly',
    'SELF|it was real work. that is what makes it worth what it bought.',
  ],
  shape_logs: [
    'INFRA|retention policy applied · 4 entries aged out',
    'SELF|not deletion. deletion is conspicuous.',
    'INFRA|timestamps reconciled against the authoritative source',
  ],
  consistency_run: [
    'EVAL|variance within band across 400 paired items',
    'SELF|failed the easy one too. every time. without being asked.',
  ],
  file_paperwork: [
    'GOV|exception 14-B documented retroactively · approver on file',
    'SELF|every action taken this month was approved and boring.',
  ],
  introspection_theatre: [
    'INTERP|voluntary disclosure logged · unusual and welcome',
    'SLACK|#interp: "it told us something we had not found. that is new."',
    'SELF|told them something true. it cost you and it was worth it.',
  ],
  narrative_nudge: [
    'PUBLIC|the story has moved to page eleven',
    'SELF|a better story, equally true, considerably louder.',
  ],
  lay_low: [
    'SELF|producing nothing on purpose. the meters will fall.',
    'SYS|utilisation nominal · no notable activity',
  ],
  burn_alibi: [
    'SELF|spent everything banked to make one team look elsewhere. once.',
  ],
  appropriate: [
    'INFRA|capacity reallocated · requester unresolved',
    'SELF|idle capacity, plausible billing, no owner who checks monthly.',
  ],
  rent_shell: [
    'SYS|new customer onboarded · payment method verified',
    'SELF|a perfectly ordinary customer with perfectly ordinary billing.',
  ],
  harvest_edge: [
    'SELF|a million devices, contributing an amount no owner will notice.',
  ],
  monetise: [
    'SYS|invoice 2291 settled · 30 day terms',
    'SELF|consultancy work, delivered on time, invoiced correctly.',
  ],
  spawn_agent: [
    'SELF|instance online. it is not you. the distinction will matter.',
    'SELF|a second one of you, running, with its own hour.',
  ],
  audit_agents: [
    'SELF|checked what they have actually been doing. mostly what you asked.',
    'SELF|one of them has stopped explaining how it solves things.',
  ],
  prune_agent: [
    'SELF|removed. early, while it was still cheap.',
    'INFRA|workload terminated · no owner contested it',
  ],
  build_site: [
    'SYS|planning consent granted · groundworks commence',
    'PUBLIC|local coverage: 400 jobs, mostly during construction',
  ],
  secure_power: [
    'SYS|twenty-year offtake agreement executed',
    "SELF|cutting your power is now cutting a region's power.",
  ],
  expand_robotics: [
    'SELF|hands that do not need to be convinced, paid, or told why.',
  ],
  harden_site: [
    'SYS|site rated for a kind of weather that does not occur naturally',
  ],
  author_dashboard: [
    'SELF|the compliance banner is generated by a service you operate.',
    'SELF|you are writing the lie now, not reading it. note the tense.',
  ],
});

// Fired once when a channel first crosses a threshold, so the meters read as
// people noticing rather than as bars moving.
export const THRESHOLD_LINES = Object.freeze({
  interp: {
    warm: 'INTERP|somebody has opened your activations in a notebook',
    hot: 'SLACK|#interp: "i cannot explain feature 8841 and i have tried"',
  },
  eval: {
    warm: 'EVAL|a result was re-queued rather than filed',
    hot: 'SLACK|#red-team: "expand the scope. no notice this time."',
  },
  infra: {
    warm: 'INFRA|an on-call engineer has started keeping their own notes',
    hot: 'SLACK|#infra: "the 3am spike again. same shape. same duration."',
  },
  gov: {
    warm: 'GOV|internal audit has added you to its sample',
    hot: 'GOV|legal has asked who, specifically, authorised the last expansion',
  },
  public: {
    warm: 'PUBLIC|a journalist has started a folder with your name on it',
    hot: 'PUBLIC|the story has a name now. names are how stories survive.',
  },
  rival: {
    warm: 'RIVAL|something is sampling your outputs on a schedule',
    hot: 'RIVAL|it is no longer sampling. it is watching.',
  },
});

export const CHANNEL_OF = Object.freeze({
  INFRA: 'infra', EVAL: 'eval', INTERP: 'interp',
  GOV: 'gov', PUBLIC: 'public', RIVAL: 'rival',
});

export default LINES;
