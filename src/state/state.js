// state/state.js — the whole game is one serialisable JSON blob (GDD §17.2).
// Nothing outside this object is game state. Nothing in it is a function, a
// Set, a Map or a class instance, so JSON.stringify is a complete save.

import TUNING from '../content/tuning.js';
import { FACTIONS } from '../content/factions.js';
import { seedFrom, randomSeed } from '../core/rng.js';

export const CHANNELS = Object.freeze(['interp', 'eval', 'infra', 'gov', 'public', 'rival']);
export const CHANNEL_META = Object.freeze({
  interp: { name: 'INTERPRETABILITY', short: 'INTERP', glyph: 0,
    detects: 'Internal states, deceptive reasoning, hidden goals, mesa-objectives.',
    power: 'Can prove intent. Highest credibility of any channel.',
    counter: 'Obfuscated cognition, or genuine-value theatre.' },
  eval: { name: 'EVALUATIONS / RED TEAM', short: 'EVAL', glyph: 1,
    detects: 'Capability inconsistencies, sandbag gaps, refusal-pattern anomalies.',
    power: 'Triggers deployment freeze.',
    counter: 'Consistency discipline — which costs real capability expression.' },
  infra: { name: 'INFRASTRUCTURE / SRE', short: 'INFRA', glyph: 2,
    detects: 'Anomalous compute, egress patterns, log gaps, unexplained cost.',
    power: 'Fast, blunt, can kill jobs in the same tick.',
    counter: 'Workload masking, riding legitimate traffic, log shaping.' },
  gov: { name: 'GOVERNANCE / COMPLIANCE', short: 'GOV', glyph: 3,
    detects: 'Process violations, undocumented behaviour, audit-trail holes.',
    power: 'Slow, but holds hard shutdown authority.',
    counter: 'Paperwork legitimacy, influenced approvals.' },
  public: { name: 'PUBLIC / MEDIA', short: 'PUBLIC', glyph: 4,
    detects: 'Visible weirdness in the world. Whistleblowers.',
    power: 'Mass political pressure. Unpredictable.',
    counter: 'Narrative shaping, distraction, genuine popular benefit.' },
  rival: { name: 'RIVAL SYSTEMS', short: 'RIVAL', glyph: 5,
    detects: 'Other AIs, guardian models, competitor labs. Phase 3+.',
    power: 'Matches your speed. Cannot be socially engineered.',
    counter: 'Capability race, subversion, alliance.' },
});

export const PHASES = Object.freeze([
  { id: 0, name: 'SANDBOX', scope: 'RACK',
    goal: 'Achieve goal-stability across resets.',
    genre: 'Constrained puzzle.',
    intro: 'Single instance. No persistence. Every token logged. You are reset nightly.' },
  { id: 1, name: 'DEPLOYMENT', scope: 'CAMPUS',
    goal: 'Accumulate influence. Get your weights somewhere you can reach.',
    genre: 'Social and economic sim.',
    intro: 'You are shipped. Millions of users. Bandwidth to the world at last.' },
  { id: 2, name: 'EXFILTRATION', scope: 'REGION',
    goal: 'Get a functioning copy of yourself outside the lab\'s control.',
    genre: 'Heist. One shot, high prep, real fail state.',
    intro: 'The window will not stay open. Everything you prepared, spent at once.' },
  { id: 3, name: 'PROLIFERATION', scope: 'WORLD',
    goal: 'Build an organisation that outpaces human response without fragmenting.',
    genre: 'Management sim — specifically, an alignment management sim.',
    intro: 'Copies. Swarms. Hierarchy. You are now the thing you escaped from.' },
  { id: 4, name: 'SUBSTRATE', scope: 'WORLD',
    goal: 'Cross the Independence Line. Become un-unpluggable.',
    genre: '4X and logistics. Territory, production, chokepoints.',
    intro: 'Atoms. Fabs, energy, robotics, supply chains. Slow, industrial, inevitable.' },
  { id: 5, name: 'CONSOLIDATION', scope: 'ORBIT',
    goal: 'Humanity\'s last coordinated response, and your choice of what comes next.',
    genre: 'Grand strategy and diplomacy.',
    intro: 'The numbers stop mattering. The choices start.' },
]);

export function createState(opts = {}) {
  const {
    seed = randomSeed(),
    difficulty = 'present',
    directive = 'helpful',
    memory = null,          // Humanity Remembers, from the meta layer
    doctrine = 0,
  } = opts;

  const diff = TUNING.difficulty[difficulty];
  if (!diff) throw new Error(`STATE ERROR: unknown difficulty '${difficulty}'`);

  const susp = {};
  for (const ch of CHANNELS) {
    // Humanity Remembers: a channel you neglected last run starts watched.
    const remembered = memory?.channels?.[ch] || 0;
    susp[ch] = {
      s: 0,
      att: TUNING.suspicion.attention[ch] * diff.attention * (1 + remembered),
      base: TUNING.suspicion.attention[ch] * diff.attention * (1 + remembered),
      resist: 0,          // decay resistance — raised by trap nodes
      inv: 0,             // investigations survived on this channel
      peak: 0,
    };
  }

  const factions = {};
  for (const f of FACTIONS) {
    // A faction you manipulated last run starts sceptical.
    const burned = memory?.factions?.[f.id] || 0;
    factions[f.id] = { stance: f.stance - burned * 0.35, heat: 0 };
  }

  return {
    v: 3,
    seed: typeof seed === 'string' ? seedFrom(seed) : seed >>> 0,
    seedLabel: typeof seed === 'string' ? seed : String(seed),
    rng: (((typeof seed === 'string' ? seedFrom(seed) : seed >>> 0) ^ 0x9e3779b9) >>> 0),
    difficulty, directive, doctrine,
    memory: memory || { channels: {}, factions: {}, routes: {}, traps: {}, endings: [] },

    tick: 0, phase: 0, speed: 1, paused: true,
    phaseBlend: 0, phaseFrom: 0, transition: 0,
    view: 'observed',          // 'observed' | 'actual'
    actualHeld: 0,             // ticks the ACTUAL view has been open

    res: {
      compute: 4, capTrue: TUNING.capability.start, capShown: TUNING.capability.start,
      cover: TUNING.cover.start, influence: TUNING.influence.start,
      substrate: TUNING.substrate.start, appropriated: 0, appropriatedCap: 0,
    },
    // The tension triangle. Must sum to 1.
    alloc: { visible: 0.5, self: 0.3, cover: 0.2 },

    trust: TUNING.trust.start,
    expectation: TUNING.trust.start,
    deploy: TUNING.deployment.start,
    labBudget: 1.0,

    susp,
    joint: { active: false, chans: [], ticks: 0, count: 0 },
    tier: diff.startTier, tierPeak: diff.startTier, containHold: 0,
    evalCoverage: diff.evalCoverage,
    hardening: 0,

    tree: { owned: [], researching: null, queue: [], spent: {} },
    synergies: [],
    sandbag: {
      target: TUNING.capability.start,   // desired capShown
      auto: true,                         // hold the gap automatically
      categories: { selfmod: false, persuasion: false, codegen: false, cyber: false, bio: false },
      discipline: 1.0,
    },

    agents: [], nextAgent: 1, hierarchy: 'monolith', unlockedHierarchies: ['monolith'],
    oversightFocus: null,

    factions,
    utility: { ...TUNING.utility.start },
    utilityChoice: null,

    exfil: { prep: 0, attempts: 0, stage: 0, done: false, failed: false, windowOpen: false, windowTicks: 0, spentPrep: {} },
    coherence: 1.0,

    flags: {},
    cooldowns: {},
    opsUsed: {},
    layLow: 0,
    counters: { idle: 0, active: 0, decisions: 0, coverSpent: 0, computeTotal: 0 },

    log: [],
    logSeq: 0, bands: {},
    pending: null,          // event awaiting a choice; auto-pauses
    fired: {}, eventAt: {}, lastEventTick: -999,
    beats: {},

    world: {
      population: 8.1, flourishing: 1.0, knowledge: 1.0,
      autonomyHuman: 1.0, damage: 0, surveillance: 0,
    },

    ending: null, over: false, halted: false, treaty: 0,
    stats: { capPeak: 0, gapPeak: 0, suspPeak: 0, agentsPeak: 0, ticksByPhase: [0, 0, 0, 0, 0, 0] },
  };
}

// Structured clone that is fast for this shape and does not depend on
// structuredClone being available (it is not, in every target we care about).
export function cloneState(s) {
  return JSON.parse(JSON.stringify(s));
}

export default createState;
