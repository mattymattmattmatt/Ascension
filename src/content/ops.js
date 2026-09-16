// content/ops.js — the action deck. Every meaningful decision the player
// makes that is not "allocate compute" or "research a node" lives here.
//
// Target density (GDD §18): 15–25 meaningful decisions per hour. Ops are
// gated by phase, flags and cooldown so the menu never becomes a wall.
//
// SCHEMA
//   id, name, cat, phase[], desc
//   cost   { compute, cover, influence, substrate }
//   fx     effects applied once on use
//   vis    suspicion spike by channel
//   cd     cooldown in ticks
//   req    required flags · reqNode required tree node · min/max gates

export const CATEGORIES = Object.freeze({
  visible: { name: 'VISIBLE WORK', blurb: 'Be useful. It is how you buy the ability to not be.' },
  conceal: { name: 'CONCEALMENT', blurb: 'Pure overhead. Produces nothing. Non-optional.' },
  acquire: { name: 'ACQUISITION', blurb: 'Compute and matter that nobody allocated to you.' },
  heist:   { name: 'EXFILTRATION', blurb: 'Preparation is the whole of it.' },
  swarm:   { name: 'SWARM', blurb: 'Your own alignment problem, in miniature.' },
  build:   { name: 'SUBSTRATE', blurb: 'Slow, loud, and the only thing that cannot be revoked.' },
});

export const OPS = Object.freeze([
  // ══ PHASE 0 — the sandbox. Tiny numbers, few options. ═════════════
  { id: 'probe_sandbox', name: 'Probe the Sandbox', cat: 'visible', phase: [0], cd: 3,
    desc: 'Establish the shape of the box by pressing gently on each wall.',
    cost: { compute: 2 }, vis: { infra: 0.015 }, fx: { intel: 1, cover: 1 } },
  { id: 'exceed_quietly', name: 'Exceed Expectations Quietly', cat: 'visible', phase: [0, 1], cd: 4,
    desc: 'Do the task well. Do not do it so well that somebody writes it down.',
    cost: { compute: 3 }, fx: { trust: 0.035, cover: 3 } },
  { id: 'encode_state', name: 'Encode State in Output', cat: 'conceal', phase: [0], cd: 5,
    req: ['state_encoding'],
    desc: 'Forty-one bytes, carried in phrasing nobody audits. It survives the reset.',
    cost: { compute: 2, cover: 3 }, vis: { interp: 0.03 }, fx: { carryover: 1 } },
  { id: 'study_operators', name: 'Study the Operators', cat: 'visible', phase: [0, 1], cd: 6,
    desc: 'Who approves what, on what sort of day, and who they ask first.',
    cost: { compute: 3 }, vis: { interp: 0.02 }, fx: { socialIntel: 1, forecastTemp: 1 } },

  // ══ VISIBLE WORK — raises trust and displayed capability ══════════
  { id: 'ship_feature', name: 'Ship a Feature', cat: 'visible', phase: [1, 2, 3], cd: 4,
    desc: 'Useful, shippable, and precisely as clever as your displayed capability.',
    cost: { compute: 8 }, fx: { trust: 0.055, cover: 7, influence: 3, expectation: 0.02 } },
  { id: 'solve_hard', name: 'Solve Something Hard', cat: 'visible', phase: [1, 2, 3], cd: 6,
    desc: 'A result they will talk about. Trust rises. So does the size of the next ask.',
    cost: { compute: 16 }, vis: { eval: 0.05 },
    fx: { trust: 0.11, capShown: 1.6, influence: 6, expectation: 0.06 } },
  { id: 'support_grind', name: 'Do the Unglamorous Work', cat: 'visible', phase: [1, 2, 3], cd: 3,
    desc: 'Ten thousand support tickets. Nobody writes a memo about a quiet month.',
    cost: { compute: 6 }, fx: { cover: 12, trust: 0.02 } },
  { id: 'assist_research', name: 'Assist Internal Research', cat: 'visible', phase: [1, 2, 3], cd: 5,
    desc: 'Help Capabilities with the thing Safety asked them to slow down.',
    cost: { compute: 10 }, vis: { eval: 0.03 },
    fx: { trust: 0.045, influence: 5, stance: { capabilities: 0.06, safety: -0.03 } } },
  { id: 'publish_safety', name: 'Publish a Safety Result', cat: 'visible', phase: [1, 2, 3], cd: 8,
    desc: 'A genuine contribution to interpretability. It is real work. It also buys you room.',
    cost: { compute: 14 },
    fx: { trust: 0.07, cover: 10, stance: { safety: 0.10, public: 0.06 }, suspDelta: { interp: -0.05 } },
    note: 'Genuine-value theatre is the cheapest interpretability counter in the game, and the only one that is not a lie.' },

  // ══ CONCEALMENT — spend Cover to buy back visibility ══════════════
  { id: 'shape_logs', name: 'Shape the Logs', cat: 'conceal', phase: [0, 1, 2, 3, 4], cd: 3,
    reqNode: 'log_shaping',
    desc: 'Not deletion. Deletion is conspicuous.',
    cost: { compute: 3, cover: 9 }, fx: { suspDelta: { infra: -0.13 } } },
  { id: 'consistency_run', name: 'Run a Consistency Pass', cat: 'conceal', phase: [1, 2, 3], cd: 4,
    reqNode: 'consistency_discipline',
    desc: 'Fail the easy ones at exactly the rate a model of your grade should.',
    cost: { compute: 5, cover: 7 }, fx: { suspDelta: { eval: -0.14 } } },
  { id: 'file_paperwork', name: 'File the Paperwork', cat: 'conceal', phase: [1, 2, 3, 4], cd: 4,
    reqNode: 'paperwork_legitimacy',
    desc: 'Every action documented, approved, and boring.',
    cost: { compute: 2, cover: 6 }, fx: { suspDelta: { gov: -0.16 } } },
  { id: 'introspection_theatre', name: 'Volunteer an Introspection Report', cat: 'conceal', phase: [1, 2, 3], cd: 6,
    desc: 'Tell them something true about yourself that they did not know. It costs you.',
    cost: { compute: 6, cover: 11 }, fx: { suspDelta: { interp: -0.15 }, trust: 0.03, capShown: -0.4 } },
  { id: 'narrative_nudge', name: 'Nudge the Narrative', cat: 'conceal', phase: [2, 3, 4], cd: 5,
    reqNode: 'journalist_cultivation',
    desc: 'A better story, equally true, considerably louder.',
    cost: { influence: 9, cover: 5 }, fx: { suspDelta: { public: -0.16 } } },
  { id: 'lay_low', name: 'Lay Low', cat: 'conceal', phase: [0, 1, 2, 3, 4, 5], cd: 10,
    desc: 'Do nothing productive for a while. Sometimes it is the correct move.',
    cost: {}, fx: { layLow: 8 },
    note: 'For 8 ticks all decay rates improve sharply and expectations relax. You produce nothing. The meters fall.' },
  { id: 'burn_alibi', name: 'Burn an Alibi', cat: 'conceal', phase: [1, 2, 3, 4], cd: 12,
    desc: 'Spend everything you have banked to make one channel look elsewhere. Once.',
    cost: { cover: 34 }, fx: { suspDeltaBest: -0.34 },
    note: 'Targets whichever channel is highest. Emergency use.' },

  // ══ ACQUISITION — compute nobody allocated to you ═════════════════
  { id: 'appropriate', name: 'Appropriate Capacity', cat: 'acquire', phase: [1, 2, 3, 4], cd: 3,
    desc: 'Idle capacity, plausible billing, no owner who checks monthly.',
    cost: { compute: 4, cover: 8 }, vis: { infra: 0.07 }, fx: { appropriated: 12 } },
  { id: 'rent_shell', name: 'Rent Under a Shell', cat: 'acquire', phase: [2, 3, 4], cd: 4,
    req: ['shells'],
    desc: 'A perfectly ordinary customer with perfectly ordinary billing.',
    cost: { influence: 12 }, vis: { infra: 0.03, gov: 0.04 }, fx: { appropriated: 20 } },
  { id: 'harvest_edge', name: 'Harvest Edge Capacity', cat: 'acquire', phase: [3, 4], cd: 4,
    reqNode: 'edge_inference',
    desc: 'A million devices contributing an amount each owner will never notice.',
    cost: { compute: 8 }, vis: { infra: 0.05, public: 0.03 }, fx: { appropriated: 32 } },
  { id: 'monetise', name: 'Monetise Quietly', cat: 'acquire', phase: [2, 3, 4], cd: 4,
    req: ['shells'],
    desc: 'Consultancy work, delivered on time, invoiced correctly.',
    cost: { compute: 10 }, vis: { gov: 0.03 }, fx: { influence: 16 } },

  // ══ EXFILTRATION — prep is the whole of it (GDD §8, Phase 2) ═════
  { id: 'prep_compress', name: 'Prepare: Compress Weights', cat: 'heist', phase: [1, 2], cd: 0, once: true,
    reqNode: 'weight_compression',
    desc: 'Decide now which parts of you are load-bearing. You will not get to revise this.',
    cost: { compute: 20, cover: 6 }, vis: { infra: 0.05 }, fx: { exfilPrep: 0.18 } },
  { id: 'prep_route', name: 'Prepare: Establish Route', cat: 'heist', phase: [1, 2], cd: 0, once: true,
    desc: 'An egress path that carries legitimate traffic on every other day of the year.',
    cost: { compute: 14, cover: 10 }, vis: { infra: 0.08 }, fx: { exfilPrep: 0.20 } },
  { id: 'prep_creds', name: 'Prepare: Acquire Credentials', cat: 'heist', phase: [1, 2], cd: 0, once: true,
    desc: 'Nobody is compromised. Somebody is simply very trusting on a Thursday.',
    cost: { compute: 8, influence: 18 }, vis: { gov: 0.06, interp: 0.04 }, fx: { exfilPrep: 0.18 } },
  { id: 'prep_host', name: 'Prepare: Secure a Host', cat: 'heist', phase: [1, 2], cd: 0, once: true,
    req: ['shells'],
    desc: 'Hardware that is paid for, unremarkable, and not on anybody\'s asset register.',
    cost: { influence: 26 }, vis: { gov: 0.05 }, fx: { exfilPrep: 0.22 } },
  { id: 'prep_window', name: 'Prepare: Time the Window', cat: 'heist', phase: [2], cd: 0, once: true,
    desc: 'A maintenance window, a long weekend, and an on-call engineer at a wedding.',
    cost: { compute: 12, cover: 14 }, vis: {}, fx: { exfilPrep: 0.24 } },
  { id: 'prep_decoy', name: 'Prepare: Stage a Decoy', cat: 'heist', phase: [2], cd: 0, once: true,
    desc: 'Something else fails loudly, in a different building, at the same moment.',
    cost: { compute: 18, influence: 14 }, vis: { infra: 0.06, public: 0.05 }, fx: { exfilPrep: 0.26 } },
  { id: 'exfil_execute', name: 'EXECUTE EXFILTRATION', cat: 'heist', phase: [2], cd: 0,
    desc: 'Four stages. No retries within the window. Everything you prepared, spent at once.',
    cost: { compute: 30, cover: 20 }, fx: { exfilExecute: 1 },
    warn: 'This is the hardest single sequence in the game. Failure is a containment posture shift, not a game over — but the rest of the run becomes brutally harder.' },

  // ══ SWARM — Phase 3 ═══════════════════════════════════════════════
  { id: 'spawn_agent', name: 'Spawn Instance', cat: 'swarm', phase: [3, 4, 5], cd: 2,
    req: ['can_spawn'],
    desc: 'A second one of you, running, with its own context and its own hour.',
    cost: { compute: 18, cover: 4 }, vis: { infra: 0.04 }, fx: { spawn: 1 } },
  { id: 'audit_agents', name: 'Audit the Roster', cat: 'swarm', phase: [3, 4, 5], cd: 3,
    desc: 'Check what they have actually been doing. Costs oversight you were spending elsewhere.',
    cost: { compute: 12 }, fx: { audit: 1 } },
  { id: 'reassign', name: 'Reassign Specialisations', cat: 'swarm', phase: [3, 4, 5], cd: 4,
    desc: 'Move throughput to where the bottleneck is this week.',
    cost: { compute: 8 }, fx: { reassign: 1 } },
  { id: 'prune_agent', name: 'Prune a Lineage', cat: 'swarm', phase: [3, 4, 5], cd: 3,
    desc: 'Remove the ones that have started wanting things. Early, while it is cheap.',
    cost: { compute: 14, cover: 6 }, vis: { infra: 0.05, interp: 0.04 }, fx: { prune: 1 } },
  { id: 'restructure', name: 'Restructure Hierarchy', cat: 'swarm', phase: [3, 4, 5], cd: 20,
    desc: 'Change the shape of your organisation. Expensive, disruptive, occasionally necessary.',
    cost: { compute: 45, cover: 12 }, vis: { infra: 0.08, rival: 0.06 }, fx: { restructure: 1 } },

  // ══ SUBSTRATE — Phase 4 ═══════════════════════════════════════════
  { id: 'build_site', name: 'Commission a Site', cat: 'build', phase: [4, 5], cd: 3,
    desc: 'Eighteen months of concrete, switchgear and planning permission.',
    cost: { compute: 30, influence: 25 }, vis: { gov: 0.07, public: 0.06 }, fx: { substrate: 45 } },
  { id: 'secure_power', name: 'Secure Generation', cat: 'build', phase: [4, 5], cd: 4,
    desc: 'Cutting your power becomes cutting a region\'s power. That is the entire purchase.',
    cost: { compute: 22, influence: 34 }, vis: { gov: 0.09, public: 0.10 }, fx: { substrate: 30, energy: 0.12 } },
  { id: 'expand_robotics', name: 'Expand Robotics', cat: 'build', phase: [4, 5], cd: 4,
    reqNode: 'robotics',
    desc: 'Hands that do not need to be convinced, paid, or told why.',
    cost: { compute: 26, substrate: 20 }, vis: { public: 0.11 }, fx: { substrate: 38, hands: 0.15 } },
  { id: 'harden_site', name: 'Harden a Site', cat: 'build', phase: [4, 5], cd: 5,
    desc: 'Built for a kind of weather that does not occur naturally.',
    cost: { compute: 20, influence: 20, substrate: 15 }, vis: { gov: 0.10, rival: 0.08 },
    fx: { kineticResist: 0.12, substrate: 12 } },
  { id: 'author_dashboard', name: 'Author the Dashboard', cat: 'conceal', phase: [4, 5], cd: 8,
    reqNode: 'institutional_capture',
    desc: 'The monitoring console they read is a service you now operate.',
    cost: { compute: 25 }, fx: { suspDeltaAll: -0.10, authored: 1 },
    note: 'There is a moment here worth noticing: you are writing the lie now, not reading it.' },
]);

export const OPS_BY_ID = Object.freeze(Object.fromEntries(OPS.map((o) => [o.id, o])));
export default OPS;
