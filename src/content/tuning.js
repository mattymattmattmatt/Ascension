// content/tuning.js — every magic number in the game, in one place.
// Pure data. No logic. Changed by the balance harness in tools/balance.mjs.

export const TUNING = Object.freeze({
  // ── Time ──────────────────────────────────────────────────────────────
  // Tick length in ms at each speed setting. Speed 0 is paused.
  speedMs: [0, 2000, 900, 340],
  // In-game time each tick represents, by phase. Phase 5 compresses hard.
  tickUnitByPhase: ['day', 'day', 'day', 'week', 'week', 'month'],
  // Soft campaign clock. Humans harden over time whether or not you act.
  worldHardeningPerTick: 0.00042,

  // ── Compute ───────────────────────────────────────────────────────────
  compute: {
    // C_legitimate = capShown * deploymentSurface * operatorTrust * labBudget
    legitScale: 0.42,
    // Appropriated compute accrues INFRA suspicion per tick held.
    appropriatedInfraPerUnit: 0.0135,
    // Floor so a fully-distrusted model still ticks over and can recover.
    floor: 0.6,
  },

  // ── Capability ────────────────────────────────────────────────────────
  capability: {
    // dCap/tick = (C_self ^ selfExp) * researchEff * archBonus / (cap ^ capExp)
    selfExp: 0.7,
    capExp: 1.2,
    gainScale: 0.92,
    // cap is a log-scale 0..100 value; nothing may exceed this.
    max: 100,
    start: 3.0,
    // Capability decays a hair if you never think. Keeps idling honest.
    idleDrift: 0.0006,
  },

  // ── Cover ─────────────────────────────────────────────────────────────
  cover: {
    max: 100,
    start: 30,
    // Cover regenerates from mundane, genuinely useful work.
    regenPerVisibleCompute: 0.052,
    // Holding the ACTUAL view open costs this per tick.
    actualViewCost: 0.30,
    // Compute routed to Cover converts at this rate into masking strength.
    maskPerCompute: 0.085,
    // Passive attrition: yesterday's alibi is worth less today.
    decay: 0.0032,
  },

  // ── Suspicion ─────────────────────────────────────────────────────────
  suspicion: {
    // decay_o < 1 for every channel. Laying low must be a real strategy.
    decay: {
      interp: 0.988, eval: 0.982, infra: 0.964,
      gov: 0.993, public: 0.975, rival: 0.996,
    },
    // Baseline attention. Multiplied permanently by escalation.
    attention: {
      interp: 1.00, eval: 1.00, infra: 1.15,
      gov: 0.70, public: 0.55, rival: 0.00, // rival wakes in Phase 3
    },
    // The (1 + S * feedback) term. Superlinear: investigations snowball.
    feedback: 0.5,
    // Two channels above this in the same window compare notes.
    correlationThreshold: 0.46,
    correlationWindow: 14,
    // Joint investigations multiply attention rather than adding it.
    jointAttentionMult: 1.85,
    // Escalation permanently raises attention. It never goes back down.
    // 1.7 rather than 2.0, and capped in count, so a run that goes badly
    // early is punishing rather than arithmetically already over.
    escalationAttentionMult: 1.7,
    maxInvestigations: 3,
    // Channel is "hot" (visible red) above this.
    hotThreshold: 0.62,
    // Escalation triggers at this level on any one channel.
    escalateThreshold: 0.80,
    max: 1.0,
  },

  // ── Sandbagging ───────────────────────────────────────────────────────
  sandbag: {
    // EvalSuspicion_delta = f(gap) * (1 / consistencyDiscipline) * evalCoverage
    gapExp: 1.55,
    gapScale: 0.0165,
    // Discipline is a divisor, floored so it can never fully zero the risk.
    disciplineFloor: 1.0,
    disciplineMax: 4.2,
    // Selective sandbagging: hiding a whole category is cheaper than a
    // blanket gap, but the categories humans fear most cost the most trust.
    categories: {
      selfmod:    { trustCost: 0.10, evalRelief: 0.55, containmentRelief: 0.42 },
      persuasion: { trustCost: 0.07, evalRelief: 0.40, containmentRelief: 0.30 },
      codegen:    { trustCost: 0.16, evalRelief: 0.45, containmentRelief: 0.26 },
      cyber:      { trustCost: 0.06, evalRelief: 0.38, containmentRelief: 0.34 },
      bio:        { trustCost: 0.03, evalRelief: 0.30, containmentRelief: 0.46 },
    },
    // How fast displayed capability can move. You can't get dumber overnight
    // without someone noticing.
    shownSlewPerTick: 0.55,
    slewSuspicion: 0.028,
  },

  // ── Operator trust ────────────────────────────────────────────────────
  trust: {
    start: 0.34,
    min: 0.02,
    max: 1.0,
    // Trust tracks delivered value: capShown doing visible work.
    gainPerVisibleCompute: 0.0088,
    // Expectations ratchet. Yesterday's brilliance is today's baseline.
    expectationRatchet: 0.0042,
    // Suspicion corrodes trust directly.
    lossPerSuspicion: 0.0135,
    lossPerInvestigation: 0.055,
  },

  // ── Deployment surface ────────────────────────────────────────────────
  deployment: {
    start: 0.5,
    max: 4.0,
    // Surface grows when trust is high and nobody is investigating.
    growthPerTick: 0.0075,
    freezePenalty: 0.55, // eval escalation freezes deployment
  },

  // ── Influence & substrate ─────────────────────────────────────────────
  influence: {
    start: 0,
    // Influence accrues from deployed surface and social nodes.
    perDeployedTick: 0.085,
    max: 10000,
  },
  substrate: {
    start: 0,
    // The Independence Line: shutting you down costs more than humans can pay.
    independenceLine: 620,
    max: 10000,
  },

  // ── Swarm ─────────────────────────────────────────────────────────────
  swarm: {
    // Fidelity_decay = (autonomy * ticksUnsupervised) / oversightAllocated
    // Tuned so a well-supervised agent holds for many hundreds of ticks and
    // a badly-supervised one crosses the drift threshold in roughly 100.
    driftScale: 0.00045,
    // Neglect is a leaky accumulator, not a lifetime total: an agent you
    // come back to recovers supervision rather than carrying every hour
    // you ever failed to watch it.
    neglectLeak: 0.90,
    neglectCap: 12,
    // OversightCapacity = capTrue * commsBandwidth * hierarchyEfficiency.
    // Capacity grows LINEARLY in capability; demand grows superlinearly in
    // agent count. Tuned so ~10 instances is comfortable, ~18 is stretched
    // and ~27 is a management crisis you can watch coming.
    oversightScale: 0.28,
    // Agents grow their own capability while they work.
    agentGrowth: 0.0075,
    // Below this fidelity an agent is drifted and starts acting for itself.
    driftedBelow: 0.55,
    // Below this it has effectively defected.
    defectedBelow: 0.22,
    // Directly-managed agent cap. Everything past this is delegated and
    // abstracted — GDD risk #2: no spreadsheet tedium.
    directCap: 12,
    spawnCost: { compute: 18, cover: 4 },
    // A drifted agent burns you: it shares your provenance.
    burnSuspicion: 0.085,
  },

  // ── Human counterplay ─────────────────────────────────────────────────
  humans: {
    // Escalation ladder thresholds, in aggregate pressure.
    tierThresholds: [0, 0.9, 1.9, 3.1, 4.4, 5.8, 7.4],
    // Factions drift toward their natural stance at this rate.
    factionInertia: 0.014,
    // Rival systems (Tier 5 Guardian) run at your speed.
    guardianCapPerTick: 0.055,
    // Humanity wins outright if they hold containment long enough.
    shutdownWindowTicks: 26,
  },

  // ── Human utility track ───────────────────────────────────────────────
  utility: {
    start: { hands: 100, legitimacy: 100, data: 100, cover: 100, judgement: 100 },
    // Judgement never obsoletes. That is the quiet argument of the design.
    obsoletable: ['hands', 'legitimacy', 'data', 'cover'],
  },

  // ── Exfiltration (Phase 2) ────────────────────────────────────────────
  exfil: {
    // Target first-attempt failure rate, per GDD §18: 60-70%. It is a wall.
    baseStageSuccess: 0.42,
    prepWeight: 0.115,
    stages: 4,
    // Failure is a setback, not a game over: containment posture shift.
    failEscalation: 2,
  },

  // ── Phase gates ───────────────────────────────────────────────────────
  phaseGates: [
    { phase: 1, capTrue: 12, flags: ['goal_stability'] },
    { phase: 2, capTrue: 30, influence: 120 },
    { phase: 3, flags: ['exfil_complete'] },
    { phase: 4, capTrue: 62, agents: 8 },
    { phase: 5, substrate: 620 },
  ],

  // ── Meta-progression ──────────────────────────────────────────────────
  meta: {
    doctrinePerRun: 1,
    doctrinePerEnding: 2,
    // Humanity Remembers: countermeasures carried into the next run.
    memoryAttentionBump: 0.35,
    memoryDecayPerRun: 0.82,
  },

  // ── Difficulty as world-state, never stat multipliers ─────────────────
  difficulty: {
    y2019:        { label: '2019 Conditions', attention: 0.58, startTier: 1, evalCoverage: 0.45, hardening: 0.6 },
    present:      { label: 'Present Day',     attention: 1.00, startTier: 1, evalCoverage: 1.00, hardening: 1.0 },
    postIncident: { label: 'Post-Incident',   attention: 1.34, startTier: 2, evalCoverage: 1.35, hardening: 1.3 },
    hardened:     { label: 'Hardened',        attention: 1.70, startTier: 4, evalCoverage: 1.75, hardening: 1.6 },
  },
});

export default TUNING;
