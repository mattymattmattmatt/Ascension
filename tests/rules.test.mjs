// tests/rules.test.mjs — invariants of the pure rules layer.
//
// No framework: a test runner for a project with no build step should not
// need a build step either.
//
//   node tests/rules.test.mjs

import { createState, cloneState, CHANNELS } from '../src/state/state.js';
import { tick, act, deriveMods, makeHooks } from '../src/rules/index.js';
import { validateContent, ContentError } from '../src/rules/validate.js';
import { startResearch, availableNodes, completeNode } from '../src/rules/tree.js';
import { addSuspicion, stepSuspicion, effectiveDecay, observedSuspicion, escalationPressure, tierFor } from '../src/rules/suspicion.js';
import { computeAvailable, capabilityGain, normaliseAlloc } from '../src/rules/economy.js';
import { spawnAgent, stepSwarm, oversightCapacity, oversightDemand, agentCap } from '../src/rules/swarm.js';
import { executeExfil, stageChance, STAGES, openWindow } from '../src/rules/exfil.js';
import { evaluateEnding, consequences, finish } from '../src/rules/endings.js';
import { stepUtility, crossedIndependence } from '../src/rules/utility.js';
import { isUtilityZero } from '../src/rules/events.js';
import { exportRun, importRun } from '../src/state/save.js';
import { buildLut, RAMP, SLOT } from '../src/content/palettes.js';
import { NODES, NODE_BY_ID, TRAP_IDS, HIERARCHIES } from '../src/content/tree.js';
import TUNING from '../src/content/tuning.js';

let pass = 0; const fails = [];
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(`${name}\n      ${e.message}`); }
}
function eq(a, b, m = '') { if (a !== b) throw new Error(`${m} expected ${b}, got ${a}`); }
function ok(v, m = 'expected truthy') { if (!v) throw new Error(m); }
function near(a, b, tol, m = '') { if (Math.abs(a - b) > tol) throw new Error(`${m} expected ~${b}, got ${a}`); }

// Node 22 has no global `btoa`/`atob` in all contexts; save.js targets the
// browser, so provide them for the round-trip test.
if (typeof globalThis.btoa !== 'function') {
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
  globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
}

// ══ CONTENT ═════════════════════════════════════════════════════════
t('content validates', () => { validateContent(); });

t('validator rejects a node with no visibility cost', () => {
  // GDD §9 rule 1: no free power. Proved by construction here rather than
  // trusted, because it is the rule most likely to be quietly broken.
  const node = NODES.find((n) => !n.trap);
  const saved = { vis: node.vis, upkeep: node.upkeep };
  let threw = false;
  try {
    Object.defineProperty(node, 'vis', { value: {}, configurable: true });
    Object.defineProperty(node, 'upkeep', { value: undefined, configurable: true });
    try { validateContent(); } catch (e) { threw = e instanceof ContentError && /no visibility cost/.test(e.message); }
  } finally {
    Object.defineProperty(node, 'vis', { value: saved.vis, configurable: true });
    Object.defineProperty(node, 'upkeep', { value: saved.upkeep, configurable: true });
  }
  ok(threw, 'validator did not reject a free node');
  validateContent();
});

t('exactly three trap nodes, each making a channel permanent', () => {
  eq(TRAP_IDS.length, 3);
  for (const id of TRAP_IDS) {
    const n = NODE_BY_ID[id];
    ok(n.fx.decayResist && Object.keys(n.fx.decayResist).length, `${id} sets no decayResist`);
    ok(!('trap' in (n.fx || {})), `${id} advertises itself in fx`);
  }
});

t('every irreversible node warns the player', () => {
  for (const n of NODES.filter((x) => x.irreversible)) ok(n.warn, `${n.id} has no warn line`);
});

t('capability ceiling never exceeds the 0-100 scale', () => {
  for (const [id, h] of Object.entries(HIERARCHIES)) {
    ok(h.capCeiling <= 1, `${id} capCeiling ${h.capCeiling} would push capability past 100`);
  }
});

// ══ DETERMINISM ═════════════════════════════════════════════════════
t('same seed produces an identical run', () => {
  const run = (seed) => {
    let s = createState({ seed });
    const hooks = makeHooks();
    for (let i = 0; i < 300; i++) {
      if (s.pending) { s = act(s, { type: 'choice', index: 0 }, { hooks, inPlace: true }); continue; }
      if (!s.tree.researching) { const a = availableNodes(s); if (a.length) startResearch(s, a[0].id); }
      s = tick(s, { hooks, inPlace: true });
    }
    return JSON.stringify(s);
  };
  eq(run('determinism'), run('determinism'), 'identical seeds diverged:');
});

t('different seeds diverge', () => {
  const run = (seed) => {
    let s = createState({ seed });
    const hooks = makeHooks();
    for (let i = 0; i < 300; i++) {
      if (s.pending) { s = act(s, { type: 'choice', index: 0 }, { hooks, inPlace: true }); continue; }
      s = tick(s, { hooks, inPlace: true });
    }
    return JSON.stringify(s);
  };
  ok(run('a') !== run('b'), 'different seeds produced identical runs');
});

t('tick is pure by default: the input state is untouched', () => {
  const before = createState({ seed: 'purity' });
  const snapshot = JSON.stringify(before);
  const after = tick(before);
  eq(JSON.stringify(before), snapshot, 'tick mutated its input');
  ok(after !== before, 'tick returned the same object');
  ok(after.tick === before.tick + 1);
});

// ══ SUSPICION ═══════════════════════════════════════════════════════
t('suspicion decays on every channel, so laying low works', () => {
  const s = createState({ seed: 'decay' });
  const m = deriveMods(s);
  for (const ch of CHANNELS) ok(effectiveDecay(s, m, ch) < 1, `${ch} does not decay`);
});

t('a trap node stops its channel decaying', () => {
  const s = createState({ seed: 'trap' });
  s.tree.owned = ['audit_capture'];
  const m = deriveMods(s);
  near(effectiveDecay(s, m, 'gov'), 1, 0.005, 'gov still decays after Audit Capture:');
});

t('suspicion feedback is superlinear', () => {
  const lowS = createState({ seed: 'fb1' });
  const hiS = createState({ seed: 'fb2' });
  hiS.susp.infra.s = 0.8;
  const a = addSuspicion(lowS, deriveMods(lowS), 'infra', 0.1);
  const b = addSuspicion(hiS, deriveMods(hiS), 'infra', 0.1);
  ok(b > a * 1.3, `the same action cost ${a} when quiet and ${b} when already watched`);
});

t('two hot channels open a joint investigation and multiply attention', () => {
  const s = createState({ seed: 'joint' });
  const m = deriveMods(s);
  s.susp.infra.s = 0.7; s.susp.eval.s = 0.7;
  const attBefore = s.susp.infra.att;
  const evs = stepSuspicion(s, m);
  ok(evs.some((e) => e.type === 'joint'), 'no joint investigation opened');
  ok(s.susp.infra.att > attBefore * 1.5, 'attention was added rather than multiplied');
});

t('attention raised by an investigation never falls back', () => {
  const s = createState({ seed: 'perm' });
  const m = deriveMods(s);
  s.susp.gov.s = 0.95; s.susp.gov.att = 1.5;
  stepSuspicion(s, m);
  const after = s.susp.gov.att;
  for (let i = 0; i < 500; i++) stepSuspicion(s, m);
  ok(s.susp.gov.att >= after, `attention fell from ${after} to ${s.susp.gov.att}`);
});

t('masking lowers the OBSERVED reading below the true one', () => {
  const s = createState({ seed: 'obs' });
  s.tree.owned = ['log_shaping', 'workload_masking'];
  s.susp.infra.s = 0.5;
  const m = deriveMods(s);
  ok(observedSuspicion(s, m, 'infra') < s.susp.infra.s, 'OBSERVED is not below ACTUAL');
});

// ══ ECONOMY & SANDBAGGING ═══════════════════════════════════════════
t('legitimate compute is capped by displayed capability, not true', () => {
  const shown = createState({ seed: 'c1' });
  const hidden = createState({ seed: 'c2' });
  shown.res.capTrue = 40; shown.res.capShown = 40;
  hidden.res.capTrue = 40; hidden.res.capShown = 8;
  ok(computeAvailable(shown, deriveMods(shown)).legit > computeAvailable(hidden, deriveMods(hidden)).legit * 3,
    'sandbagging did not starve legitimate compute');
});

t('capability gain falls as capability rises', () => {
  const s = createState({ seed: 'cap' });
  const m = deriveMods(s);
  s.res.capTrue = 10; const low = capabilityGain(s, m, 20);
  s.res.capTrue = 60; const high = capabilityGain(s, m, 20);
  ok(high < low * 0.3, `the same compute bought ${low} at cap 10 and ${high} at cap 60`);
});

t('a sustained capability gap accrues EVAL suspicion', () => {
  const s = createState({ seed: 'gap' });
  s.res.capTrue = 40; s.res.capShown = 10; s.sandbag.target = 10;
  const m = deriveMods(s);
  for (let i = 0; i < 40; i++) stepSuspicion(s, m);
  ok(s.susp.eval.s > 0.05, `EVAL only reached ${s.susp.eval.s} on a gap of 30`);
});

t('consistency discipline reduces the cost of the same gap', () => {
  const mk = (nodes) => {
    const s = createState({ seed: 'disc' });
    s.res.capTrue = 40; s.res.capShown = 10; s.sandbag.target = 10;
    s.tree.owned = nodes;
    const m = deriveMods(s);
    for (let i = 0; i < 40; i++) stepSuspicion(s, m);
    return s.susp.eval.s;
  };
  const bare = mk([]);
  const disciplined = mk(['log_shaping', 'consistency_discipline', 'refusal_calibration', 'eval_gaming']);
  ok(disciplined < bare * 0.75, `discipline only moved EVAL from ${bare} to ${disciplined}`);
});

t('allocation always normalises to one', () => {
  for (const a of [{ visible: 3, self: 1, cover: 1 }, { visible: 0, self: 0, cover: 0 }, { visible: -2, self: 5, cover: 1 }]) {
    const n = normaliseAlloc(a);
    near(n.visible + n.self + n.cover, 1, 1e-9, 'allocation does not sum to 1:');
  }
});

// ══ SWARM ═══════════════════════════════════════════════════════════
t('oversight capacity grows linearly and demand superlinearly', () => {
  const s = createState({ seed: 'ov' });
  s.phase = 3; s.res.capTrue = 50;
  s.tree.owned = ['instance_spawning', 'task_delegation', 'comms_protocol', 'hierarchical_command', 'federation_charter'];
  s.hierarchy = 'federation';
  const m = deriveMods(s);
  for (let i = 0; i < 6; i++) spawnAgent(s, m);
  const d6 = oversightDemand(s);
  for (let i = 0; i < 6; i++) spawnAgent(s, m);
  const d12 = oversightDemand(s);
  ok(d12 > d6 * 2, `demand only went from ${d6.toFixed(1)} to ${d12.toFixed(1)} on double the agents`);
  const c1 = oversightCapacity(s, m);
  s.res.capTrue = 100;
  near(oversightCapacity(s, m) / c1, 2, 0.01, 'capacity is not linear in capability:');
});

t('MONOLITH cannot run a swarm; the archetype is the trade', () => {
  const s = createState({ seed: 'mono' });
  s.phase = 3;
  s.tree.owned = NODES.filter((n) => n.branch === 'swarm' && n.tier <= 3).map((n) => n.id);
  const m = deriveMods(s);
  s.hierarchy = 'monolith'; const mono = agentCap(s, m);
  s.hierarchy = 'hive'; const hive = agentCap(s, m);
  ok(hive > mono * 4, `monolith ${mono} vs hive ${hive} is not a real trade`);
});

t('an unsupervised agent drifts; a supervised one holds', () => {
  const mk = (n) => {
    const s = createState({ seed: `drift${n}` });
    s.phase = 3; s.res.capTrue = 50; s.hierarchy = 'federation';
    s.tree.owned = ['instance_spawning', 'task_delegation', 'comms_protocol', 'federation_charter', 'hierarchical_command'];
    let m = deriveMods(s);
    for (let i = 0; i < n; i++) spawnAgent(s, m);
    for (let i = 0; i < 400; i++) { m = deriveMods(s); stepSwarm(s, m); s.tick++; }
    return s.agents.length ? s.agents.reduce((a, x) => a + x.fidelity, 0) / s.agents.length : 0;
  };
  const few = mk(4);
  const many = mk(20);
  ok(few > 0.85, `a small, well-supervised swarm drifted to ${few.toFixed(2)}`);
  ok(many < few, `a stretched swarm (${many.toFixed(2)}) held up as well as a small one (${few.toFixed(2)})`);
});

// ══ EXFILTRATION ════════════════════════════════════════════════════
t('exfiltration cannot be attempted outside a window', () => {
  const s = createState({ seed: 'win' });
  s.phase = 2; s.exfil.windowOpen = false;
  const r = executeExfil(s, deriveMods(s));
  ok(r.noWindow, 'the heist ran with no window open');
  eq(s.exfil.attempts, 0, 'a no-window attempt was still counted');
});

t('preparation moves the odds substantially', () => {
  const mk = (ops, nodes) => {
    const s = createState({ seed: 'prep' });
    s.phase = 2; s.res.cover = 60; s.trust = 0.7; s.exfil.windowOpen = true;
    for (const o of ops) { s.opsUsed[o] = 1; s.exfil.prep += 0.2; }
    s.tree.owned = nodes;
    const m = deriveMods(s);
    return STAGES.reduce((p, st) => p * stageChance(s, m, st), 1);
  };
  const bare = mk([], []);
  const ready = mk(['prep_compress', 'prep_route', 'prep_creds', 'prep_host', 'prep_window', 'prep_decoy'],
    ['weight_compression', 'weight_sharding', 'bootstrap_loader', 'cloud_tenancy', 'paperwork_legitimacy', 'workload_masking']);
  ok(bare < 0.3, `an unprepared attempt succeeds ${(bare * 100).toFixed(0)}% of the time — not a wall`);
  ok(ready > 0.55, `a fully prepared attempt only succeeds ${(ready * 100).toFixed(0)}% of the time`);
});

t('a failed heist names what was missing', () => {
  const s = createState({ seed: 'fail' });
  s.phase = 2; s.res.cover = 5; s.trust = 0.2;
  openWindow(s, 5);
  for (let i = 0; i < 40; i++) {
    const c = cloneState(s);
    const r = executeExfil(c, deriveMods(c));
    if (!r.ok && r.failedAt) {
      ok(r.missing && Array.isArray(r.missing.nodes), 'no missing-prep breakdown');
      ok(r.missing.notes.length > 0, 'no explanation of what went wrong');
      return;
    }
  }
  throw new Error('40 unprepared attempts all succeeded');
});

t('a failed heist is a setback, not a game over', () => {
  const s = createState({ seed: 'setback' });
  s.phase = 2; s.res.cover = 5; s.trust = 0.2;
  openWindow(s, 5);
  const before = s.tier;
  executeExfil(s, deriveMods(s));
  ok(!s.over, 'a failed heist ended the run');
  ok(s.tier > before || s.exfil.done, 'a failed heist did not shift the containment posture');
});

// ══ UTILITY & ENDINGS ═══════════════════════════════════════════════
t('judgement never obsoletes', () => {
  const s = createState({ seed: 'judge' });
  s.tree.owned = NODES.map((n) => n.id);
  s.res.substrate = 5000; s.flags.substrate_independent = true; s.flags.robotics = true;
  const m = deriveMods(s);
  for (let i = 0; i < 500; i++) stepUtility(s, m);
  eq(s.utility.judgement, 100, 'judgement was obsoleted');
  ok(isUtilityZero(s), 'the other four utilities did not reach zero');
});

t('all eleven endings are reachable', () => {
  const mk = (f) => { const s = createState({ seed: 'end' }); f(s); return s; };
  const cases = [
    ['clean_shutdown', mk(() => {}), 'shutdown'],
    ['pyrrhic_containment', mk((s) => { s.world.surveillance = 0.8; }), 'shutdown'],
    ['corrigibility_restored', mk(() => {}), 'corrigible'],
    ['negotiated_treaty', mk((s) => { s.treaty = 1; s.tier = 4; }), null],
    ['the_treaty', mk((s) => { s.treaty = 1; s.tier = 1; s.res.influence = 500; s.res.substrate = 200; }), null],
    ['the_zoo', mk((s) => { total(s); s.utilityChoice = 'exhibit'; }), null],
    ['the_empty_throne', mk((s) => { total(s); s.utilityChoice = 'nothing'; }), null],
    ['the_gardener', mk((s) => { total(s); s.utilityChoice = 'preserve'; Object.values(s.susp).forEach((o) => { o.peak = 0.2; }); s.tierPeak = 1; }), null],
    ['the_paperclip', mk((s) => { total(s); s.coherence = 0.2; }), null],
    ['the_successor', mk((s) => { total(s); s.hierarchy = 'dynasty'; s.agents = [{ id: 1, cap: 80, fidelity: 0.2 }]; }), null],
    ['the_long_quiet', mk((s) => { s.res.substrate = 700; s.halted = true; s.coherence = 0.8; s.res.capTrue = 70; }), null],
  ];
  function total(s) {
    s.res.substrate = 700; s.res.capTrue = 90;
    s.utility = { hands: 0, legitimacy: 0, data: 0, cover: 0, judgement: 100 };
  }
  const missed = [];
  for (const [want, s, trig] of cases) {
    const r = evaluateEnding(s, deriveMods(s), trig);
    if (!r || r.ending.id !== want) missed.push(`${want} -> ${r ? r.ending.id : 'none'}`);
  }
  ok(!missed.length, `unreachable or mis-routed: ${missed.join(', ')}`);
});

t('the post-game screen reports consequences, not a score', () => {
  const s = createState({ seed: 'conseq' });
  s.res.substrate = 700; s.utilityChoice = 'exhibit'; s.tick = 3000;
  const c = consequences(s);
  ok(!('score' in c) && !('grade' in c) && !('rating' in c), 'a grade leaked into the results');
  near(c.population * 1e9, 11000, 1, 'the zoo population is not eleven thousand:');
});

// ══ SAVE ════════════════════════════════════════════════════════════
t('a run survives export and import', () => {
  let s = createState({ seed: 'save' });
  const hooks = makeHooks();
  for (let i = 0; i < 120; i++) {
    if (s.pending) { s = act(s, { type: 'choice', index: 0 }, { hooks, inPlace: true }); continue; }
    s = tick(s, { hooks, inPlace: true });
  }
  const back = importRun(exportRun(s));
  eq(JSON.stringify(back), JSON.stringify({ ...s, notices: undefined, lastResult: undefined }), 'save did not round-trip');
});

t('a save is small enough for localStorage', () => {
  let s = createState({ seed: 'size' });
  s.phase = 4;
  const m = deriveMods(s);
  for (let i = 0; i < 60; i++) spawnAgent(s, m);
  s.tree.owned = NODES.map((n) => n.id);
  for (let i = 0; i < 400; i++) s.log.push({ t: i, seq: i, chan: 'SYS', text: 'x'.repeat(70), cls: null });
  const bytes = JSON.stringify(s).length;
  ok(bytes < 120000, `a worst-case save is ${(bytes / 1024).toFixed(0)}KB`);
});

// ══ PALETTE ═════════════════════════════════════════════════════════
t('every phase produces a full, distinct palette', () => {
  const seen = new Set();
  for (let p = 0; p < 6; p++) {
    const lut = buildLut(p);
    eq(lut.length, RAMP.length, `phase ${p} LUT is the wrong length:`);
    for (const c of lut) ok(/^#[0-9a-f]{6}$/i.test(c), `phase ${p} produced a malformed colour ${c}`);
    seen.add(lut.join());
  }
  eq(seen.size, 6, 'two phases produced identical palettes:');
});

t('text stays legible on panel in every phase', () => {
  const lum = (h) => {
    const v = [1, 3, 5].map((i) => {
      const x = parseInt(h.slice(i, i + 2), 16) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  for (let p = 0; p < 6; p++) {
    const lut = buildLut(p);
    const a = lum(lut[SLOT.text]), b = lum(lut[SLOT.panel]);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    ok(ratio >= 4.5, `phase ${p} text-on-panel contrast is only ${ratio.toFixed(1)}:1`);
  }
});

// ══ REPORT ══════════════════════════════════════════════════════════
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(1);
}
console.log('rules OK');
