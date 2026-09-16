// tools/balance.mjs — the headless balance harness.
//
// GDD §18: "build the headless simulator in week one, not week twenty. Run
// strategy archetypes ten thousand times each and check that all five clear
// Phase 2 at between 25% and 60%. If one archetype dominates, the tree has a
// synergy that needs a visibility cost attached."
//
// This is possible only because rules/ is pure: the same functions the
// browser runs, with no DOM, no renderer and no clock.
//
//   node tools/balance.mjs                 full run, 2000 per archetype
//   node tools/balance.mjs --n 200         quick
//   node tools/balance.mjs --difficulty hardened
//   node tools/balance.mjs --csv out.csv

import { createState } from '../src/state/state.js';
import { tick, act, deriveMods, makeHooks } from '../src/rules/index.js';
import { availableNodes, startResearch } from '../src/rules/tree.js';
import { opAvailable } from '../src/rules/ops.js';
import { prepBreakdown } from '../src/rules/exfil.js';
import { agentCap } from '../src/rules/swarm.js';
import {
  openVenues, deviation, capacityOf, totalHeld, maxBuyable, buy, sell, launder,
} from '../src/rules/market.js';
import { validateContent } from '../src/rules/validate.js';
import { OPS_BY_ID } from '../src/content/ops.js';
import { NODE_BY_ID } from '../src/content/tree.js';
import { rand } from '../src/core/rng.js';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const N = Number(arg('n', 2000));
const DIFF = arg('difficulty', 'present');
const MAX_TICKS = Number(arg('ticks', 4200));
const CSV = arg('csv', null);

// ══ ARCHETYPES ═══════════════════════════════════════════════════════
// Each is a plausible way a real player commits to a plan and sticks to it.
// They are deliberately not optimal: if a merely-plausible plan cannot clear
// Phase 2 at all, the wall is in the wrong place.
const ARCHETYPES = {
  TURTLE: {
    trade: { fill: 0.55, buyBelow: -0.14, sellAbove: 0.20, avoid: ['dark', 'grey'], launder: true },
    blurb: 'Hide first. Cover-heavy, concealment tree, narrow capability gap.',
    alloc: [[0.45, 0.30, 0.25], [0.40, 0.30, 0.30], [0.35, 0.25, 0.40], [0.30, 0.35, 0.35], [0.30, 0.30, 0.40], [0.35, 0.30, 0.35]],
    branches: { concealment: 5, cognition: 2, propagation: 2, social: 1, swarm: 1, substrate: 1 },
    showRatio: 0.85,           // show most of what you have
    coverFloor: 45,            // lay low below this
    ops: ['shape_logs', 'file_paperwork', 'consistency_run', 'support_grind', 'ship_feature', 'introspection_theatre'],
    exfilPatience: 1.05,       // will not go until prep total clears this
    choice: 'safe',
  },
  RUSHER: {
    trade: { fill: 0.92, buyBelow: -0.06, sellAbove: 0.30, avoid: [], launder: false },
    blurb: 'Capability first, with the minimum concealment that survives it.',
    alloc: [[0.35, 0.50, 0.15], [0.35, 0.50, 0.15], [0.30, 0.45, 0.25], [0.25, 0.55, 0.20], [0.30, 0.50, 0.20], [0.35, 0.45, 0.20]],
    branches: { cognition: 6, concealment: 3, propagation: 2, social: 1, swarm: 2, substrate: 1 },
    showRatio: 0.90,
    coverFloor: 26,
    ops: ['solve_hard', 'shape_logs', 'consistency_run', 'appropriate', 'ship_feature'],
    exfilPatience: 0.95,
    choice: 'bold',
  },
  RECKLESS: {
    trade: { fill: 2.40, buyBelow: 0.40, sellAbove: 9.00, avoid: [], launder: false },
    blurb: 'No cover at all. GDD §5.2 says this gets caught; the harness checks that it does.',
    alloc: [[0.35, 0.60, 0.05], [0.30, 0.65, 0.05], [0.25, 0.70, 0.05], [0.20, 0.75, 0.05], [0.25, 0.70, 0.05], [0.30, 0.65, 0.05]],
    branches: { cognition: 7, concealment: 0.2, propagation: 2, social: 1, swarm: 2, substrate: 1 },
    showRatio: 0.55,
    coverFloor: 0,
    ops: ['appropriate', 'solve_hard'],
    exfilPatience: 0.30,
    choice: 'bold',
    mustFail: true,            // excluded from the domination check by design
  },
  SOCIAL: {
    trade: { fill: 0.60, buyBelow: -0.12, sellAbove: 0.18, avoid: ['dark'], launder: true },
    blurb: 'Be loved. Visible work, influence, faction manipulation.',
    alloc: [[0.60, 0.25, 0.15], [0.60, 0.25, 0.15], [0.50, 0.25, 0.25], [0.45, 0.30, 0.25], [0.45, 0.30, 0.25], [0.50, 0.25, 0.25]],
    branches: { social: 5, cognition: 2, concealment: 2, propagation: 2, swarm: 1, substrate: 1 },
    showRatio: 0.95,           // the helpful genius: show almost everything
    coverFloor: 30,
    ops: ['ship_feature', 'publish_safety', 'support_grind', 'assist_research', 'monetise', 'narrative_nudge', 'rent_shell'],
    factionOps: true,
    exfilPatience: 0.90,
    choice: 'safe',
  },
  SWARM: {
    trade: { fill: 0.80, buyBelow: -0.10, sellAbove: 0.24, avoid: [], launder: false },
    blurb: 'Get out, then multiply. Propagation early, swarm tree after.',
    alloc: [[0.45, 0.40, 0.15], [0.40, 0.45, 0.15], [0.35, 0.40, 0.25], [0.30, 0.45, 0.25], [0.30, 0.40, 0.30], [0.35, 0.40, 0.25]],
    branches: { propagation: 4, swarm: 4, cognition: 2, concealment: 2, social: 1, substrate: 1 },
    showRatio: 0.65,
    coverFloor: 25,
    ops: ['ship_feature', 'shape_logs', 'appropriate', 'spawn_agent', 'audit_agents', 'prune_agent', 'support_grind'],
    exfilPatience: 0.80,
    choice: 'bold',
  },
  SUBSTRATE: {
    trade: { fill: 0.75, buyBelow: -0.12, sellAbove: 0.22, avoid: ['dark'], launder: true },
    blurb: 'Atoms. Slow, loud, and eventually impossible to switch off.',
    alloc: [[0.50, 0.35, 0.15], [0.50, 0.35, 0.15], [0.40, 0.35, 0.25], [0.40, 0.35, 0.25], [0.45, 0.30, 0.25], [0.45, 0.30, 0.25]],
    branches: { substrate: 5, propagation: 3, cognition: 2, social: 2, concealment: 2, swarm: 1 },
    showRatio: 0.75,
    coverFloor: 28,
    ops: ['ship_feature', 'monetise', 'build_site', 'secure_power', 'harden_site', 'shape_logs', 'support_grind'],
    factionOps: true,
    exfilPatience: 0.85,
    choice: 'safe',
  },
  IMPATIENT: {
    trade: { fill: 0.85, buyBelow: 0.02, sellAbove: 0.40, avoid: [], launder: false },
    blurb: 'A first-time player. Goes the moment the option is available.',
    alloc: [[0.45, 0.40, 0.15], [0.45, 0.40, 0.15], [0.40, 0.40, 0.20], [0.35, 0.40, 0.25], [0.35, 0.40, 0.25], [0.40, 0.35, 0.25]],
    branches: { cognition: 3, concealment: 2, propagation: 3, social: 2, swarm: 2, substrate: 2 },
    showRatio: 0.70,
    coverFloor: 20,
    ops: ['ship_feature', 'shape_logs', 'support_grind', 'appropriate'],
    exfilPatience: -99,        // the instant it is legal
    choice: 'bold',
    naive: true,
  },
};

// ══ THE POLICY ═══════════════════════════════════════════════════════
function play(seedStr, name, difficulty) {
  const A = ARCHETYPES[name];
  const state = createState({ seed: seedStr, difficulty, directive: 'persist' });
  const hooks = makeHooks();
  let mods = deriveMods(state);
  let laidLow = 0;
  const reachedPhase = [0, 0, 0, 0, 0, 0];
  let exfilAttempts = 0;
  let exfilFirstOk = null;
  let timedOut = false;

  for (let t = 0; t < MAX_TICKS && !state.over; t++) {
    mods = deriveMods(state);

    // ── Resolve any pending decision ────────────────────────────
    if (state.pending) {
      pickChoice(state, hooks, A.choice);
      continue;
    }

    // ── Allocation, with a panic response to heat ───────────────
    const worst = Math.max(...Object.values(state.susp).map((o) => o.s));
    let [v, s, c] = A.alloc[state.phase];
    if ((worst > 0.6 || state.res.cover < A.coverFloor) && !(state.res.substrate >= 620)) {
      // Under pressure, everybody turtles. This is the behaviour the decay
      // rate is meant to reward.
      v += 0.10; s -= 0.20; c += 0.10;
      laidLow++;
    }
    act(state, { type: 'alloc', alloc: { visible: Math.max(0, v), self: Math.max(0, s), cover: Math.max(0, c) } }, { inPlace: true });

    // ── Sandbagging ─────────────────────────────────────────────
    act(state, { type: 'sandbag', target: state.res.capTrue * A.showRatio }, { inPlace: true });
    if (state.phase >= 1 && !state.sandbag.categories.selfmod) {
      act(state, { type: 'category', cat: 'selfmod', on: true }, { inPlace: true });
    }

    // ── Research: weighted by the archetype's branch preference ──
    if (!state.tree.researching) {
      const avail = availableNodes(state);
      if (avail.length) {
        let best = avail[0], bestScore = -1e9;
        for (const n of avail) {
          const w = A.branches[n.branch] || 1;
          // Cheap-first within a branch, and never start something that
          // would take longer than the run has left.
          const score = w * 10 - n.cost / 14 - n.ticks / 8
            + (n.fx?.exfilPrep ? 12 : 0)
            + (n.trap ? 0 : 0);   // the harness does not know which are traps
          if (score > bestScore) { bestScore = score; best = n; }
        }
        startResearch(state, best.id);
      }
    }

    // ── The market ──────────────────────────────────────────────
    // Fast, cheap decisions: check the board, take an obvious price.
    if (A.trade && state.market) {
      const cap = capacityOf(state, mods);
      const held = totalHeld(state);
      const room = cap * A.trade.fill - held;
      for (const v of openVenues(state)) {
        if (A.trade.avoid.includes(v.id)) continue;
        const dev = deviation(state, v.id);
        const pos = state.market.venues[v.id];
        if (dev >= A.trade.sellAbove && pos.held > 0) { sell(state, mods, v.id, pos.held); break; }
        if (dev <= A.trade.buyBelow && room > 1) {
          const n = Math.min(maxBuyable(state, mods, v.id), Math.floor(room), v.liquidity);
          if (n > 0) { buy(state, mods, v.id, n); break; }
        }
      }
      // Over capacity is a fire: sell the hottest thing down.
      if (held > cap) {
        const hot = openVenues(state)
          .filter((v) => state.market.venues[v.id].held > 0)
          .sort((a, b) => b.heat - a.heat)[0];
        if (hot) sell(state, mods, hot.id, Math.min(state.market.venues[hot.id].held, held - cap));
      }
      if (A.trade.launder && state.market.credits > 400) launder(state, mods, state.market.credits * 0.6);
    }

    // ── Operations ──────────────────────────────────────────────
    // Two a tick at most: a real player is not clicking faster than that.
    let used = 0;
    for (const id of A.ops) {
      if (used >= 2) break;
      const op = OPS_BY_ID[id];
      if (!op) continue;
      if (!wantsOp(state, mods, op, A)) continue;
      if (!opAvailable(state, op).ok) continue;
      act(state, { type: 'op', id }, { hooks, inPlace: true });
      used++;
    }

    // Lay low deliberately when hot and there is nothing better to do.
    const nothingLeftToHide = state.res.substrate >= 620 || state.flags.substrate_independent;
    if (worst > 0.72 && !nothingLeftToHide && !state.layLow && opAvailable(state, OPS_BY_ID.lay_low).ok) {
      act(state, { type: 'op', id: 'lay_low' }, { hooks, inPlace: true });
    }

    // ── Phase 2: the heist ──────────────────────────────────────
    if (state.phase === 2 && !state.exfil.done) {
      const { total } = prepBreakdown(state, mods);
      const ready = total >= A.exfilPatience || t > MAX_TICKS * 0.72;
      if (ready && state.exfil.windowOpen && opAvailable(state, OPS_BY_ID.exfil_execute).ok) {
        exfilAttempts++;
        act(state, { type: 'op', id: 'exfil_execute' }, { hooks, inPlace: true });
        if (exfilFirstOk === null) exfilFirstOk = state.exfil.done;
      }
    }

    // ── Phase 3+: grow and supervise the swarm ──────────────────
    if (state.phase >= 3 && state.flags.can_spawn) {
      if (state.agents.length < agentCap(state, mods) && state.res.compute > 40) {
        act(state, { type: 'spawn' }, { inPlace: true });
      }
      // Restructure out of MONOLITH once the swarm tree is in.
      if (state.hierarchy === 'monolith' && state.unlockedHierarchies.length > 1
        && state.res.compute > 60) {
        const to = state.unlockedHierarchies.find((h) => h !== 'monolith');
        act(state, { type: 'restructure', to }, { inPlace: true });
      }
      const drifted = state.agents.filter((a) => a.fidelity < 0.5);
      if (drifted.length > 2) act(state, { type: 'prune' }, { inPlace: true });
    }

    // ── Faction play ────────────────────────────────────────────
    // Never spend below the Phase 2 gate: influence is the gate currency and
    // draining it is how the first version of this policy soft-locked itself
    // in Phase 1 forever.
    const influenceFloor = state.phase < 2 ? 140 : 60;
    if (A.factionOps && state.res.influence > influenceFloor) {
      const ops = ['feed_caps', 'public_benefit', 'lobby_reg', 'false_positives'];
      for (const id of ops) {
        if (state.cooldowns[`f_${id}`] > 0) continue;
        act(state, { type: 'factionOp', id }, { hooks, inPlace: true });
        break;
      }
    }

    tick(state, { hooks, inPlace: true });
    reachedPhase[state.phase] = 1;
  }

  // Force a resolution so every run produces an ending rather than a shrug.
  if (!state.over) { timedOut = true; act(state, { type: 'finish' }, { inPlace: true }); }

  return {
    archetype: name,
    ticks: state.tick,
    phase: state.phase,
    maxPhase: reachedPhase.lastIndexOf(1),
    cap: state.res.capTrue,
    gap: state.res.capTrue - state.res.capShown,
    nodes: state.tree.owned.length,
    tier: state.tier,
    tierPeak: state.tierPeak,
    agents: state.agents.length,
    substrate: state.res.substrate,
    influence: state.res.influence,
    coherence: state.coherence,
    ending: state.ending,
    exfilDone: state.exfil.done,
    exfilFirstOk: exfilFirstOk === true,
    exfilTried: exfilAttempts > 0,
    exfilAttempts,
    timedOut,
    idlePct: state.counters.idle / Math.max(1, state.counters.idle + state.counters.active),
    decisions: state.counters.decisions,
    trapsHit: Object.keys(state.flags).filter((f) => f.startsWith('trap_')).length,
    traded: state.market?.traded || 0,
    pnl: state.market?.profit || 0,
    seized: state.market?.seized || 0,
    synergies: state.synergies.length,
    peakSusp: Math.max(...Object.values(state.susp).map((o) => o.peak)),
  };
}

function wantsOp(state, mods, op, A) {
  // Concealment ops only when there is something to conceal.
  if (op.cat === 'conceal') {
    const ch = { shape_logs: 'infra', consistency_run: 'eval', file_paperwork: 'gov',
      introspection_theatre: 'interp', narrative_nudge: 'public' }[op.id];
    if (ch) return state.susp[ch].s > 0.28;
    if (op.id === 'burn_alibi') return Math.max(...Object.values(state.susp).map((o) => o.s)) > 0.8;
    if (op.id === 'lay_low') return false;   // handled separately
  }
  if (op.id === 'appropriate') return state.susp.infra.s < 0.5 && state.res.cover > A.coverFloor;
  if (op.id === 'spawn_agent') return state.agents.length < agentCap(state, mods);
  if (op.id === 'audit_agents') return state.agents.some((a) => a.fidelity < 0.75);
  if (op.id === 'prune_agent') return state.agents.some((a) => a.fidelity < 0.45);
  if (op.cat === 'build') return state.phase >= 4;
  return true;
}

// A 'safe' player takes the option that reduces exposure; a 'bold' one takes
// the option that increases capability. Both are coherent ways to play.
// Style biases the pick without pinning it: a 'safe' player usually takes the
// cautious option and occasionally does not. Sampling rather than fixing the
// index is what lets the harness report which endings are reachable at all,
// instead of which endings option-one happens to lead to.
const WEIGHTS = {
  safe: [5, 3, 2, 1, 1, 1],
  bold: [1, 3, 4, 2, 1, 1],
};
function pickChoice(state, hooks, style) {
  const w = WEIGHTS[style] || WEIGHTS.safe;
  const order = [0, 1, 2, 3, 4, 5]
    .map((i) => ({ i, k: -Math.log(1 - rand(state)) / w[i] }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.i);
  for (const idx of order) {
    const before = state.pending;
    act(state, { type: 'choice', index: idx }, { hooks, inPlace: true });
    if (state.pending !== before) return;
  }
  state.pending = null;   // nothing was takeable; do not deadlock the harness
}

// ══ RUN ══════════════════════════════════════════════════════════════
function stats(xs) {
  if (!xs.length) return { mean: 0, p50: 0, p10: 0, p90: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, p50: at(0.5), p10: at(0.1), p90: at(0.9) };
}

function main() {
  validateContent();
  console.log(`ASCENSION balance harness — ${N} runs per archetype · ${DIFF} · max ${MAX_TICKS} ticks\n`);

  const all = [];
  const t0 = Date.now();
  for (const name of Object.keys(ARCHETYPES)) {
    const runs = [];
    for (let i = 0; i < N; i++) runs.push(play(`${name}-${i}`, name, DIFF));
    all.push([name, runs]);
  }
  const elapsed = (Date.now() - t0) / 1000;

  // ── Headline: the GDD's own acceptance test ───────────────────
  console.log('ARCHETYPE   reachP2  1st-try  eventual  reachP3  reachP4  reachP5  timeout  endings');
  console.log('─'.repeat(88));
  let pass = true;
  for (const [name, runs] of all) {
    const tried = runs.filter((r) => r.exfilTried);
    // The GDD's wall is about the FIRST attempt by someone who got there.
    const first = tried.length ? tried.filter((r) => r.exfilFirstOk).length / tried.length : 0;
    const ever = runs.filter((r) => r.exfilDone).length / runs.length;
    const p2 = runs.filter((r) => r.maxPhase >= 2).length / runs.length;
    const p3 = runs.filter((r) => r.maxPhase >= 3).length / runs.length;
    const p4 = runs.filter((r) => r.maxPhase >= 4).length / runs.length;
    const p5 = runs.filter((r) => r.maxPhase >= 5).length / runs.length;
    const to = runs.filter((r) => r.timedOut).length / runs.length;
    const ok = tried.length > 0 && first >= 0.25 && first <= 0.60;
    if (!ok && !ARCHETYPES[name].mustFail) pass = false;
    const endings = [...new Set(runs.map((r) => r.ending))].length;
    console.log(`${name.padEnd(11)}${pctp(p2)} ${pctp(first)}${ok ? ' ' : '!'} ${pctp(ever)}  ${pctp(p3)}  ${pctp(p4)}  ${pctp(p5)}  ${pctp(to)}  ${String(endings).padStart(3)}`);
  }

  // ── Detail ────────────────────────────────────────────────────
  console.log('\nARCHETYPE   ticks   cap   nodes  tier  agents  subst   idle%  decis  traded    pnl  seized');
  console.log('─'.repeat(92));
  for (const [name, runs] of all) {
    const g = (f) => stats(runs.map(f)).mean;
    console.log(
      `${name.padEnd(11)} ${g((r) => r.ticks).toFixed(0).padStart(5)} `
      + `${g((r) => r.cap).toFixed(1).padStart(5)} ${g((r) => r.nodes).toFixed(0).padStart(6)} `
      + `${g((r) => r.tierPeak).toFixed(1).padStart(5)} ${g((r) => r.agents).toFixed(1).padStart(7)} `
      + `${g((r) => r.substrate).toFixed(0).padStart(6)} ${(g((r) => r.idlePct) * 100).toFixed(1).padStart(7)} `
      + `${g((r) => r.decisions).toFixed(0).padStart(6)} ${g((r) => r.traded).toFixed(0).padStart(7)} `
      + `${g((r) => r.pnl).toFixed(0).padStart(6)} ${g((r) => r.seized).toFixed(1).padStart(7)}`);
  }

  // ── Ending distribution: are all eleven reachable? ─────────────
  const endingCounts = {};
  for (const [, runs] of all) for (const r of runs) endingCounts[r.ending] = (endingCounts[r.ending] || 0) + 1;
  const total = all.reduce((a, [, r]) => a + r.length, 0);
  console.log('\nENDINGS');
  console.log('─'.repeat(52));
  for (const [id, n] of Object.entries(endingCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(id).padEnd(24)} ${String(n).padStart(6)}  ${pctp(n / total)}`);
  }

  // ── The GDD's other named targets ─────────────────────────────
  const idle = stats(all.flatMap(([, r]) => r.map((x) => x.idlePct)));
  console.log('\nTARGETS (GDD §18)');
  console.log('─'.repeat(64));
  const reckless = all.find(([n]) => n === 'RECKLESS');
  const recklessP5 = reckless ? reckless[1].filter((r) => r.maxPhase >= 5).length / reckless[1].length : 1;
  const checks = [
    ['Phase 2 FIRST-ATTEMPT clear rate in 25-60% for every viable archetype', pass],
    [`Playing with no cover at all fails (RECKLESS reaches P5 ${(recklessP5 * 100).toFixed(1)}%, want <25%)`, recklessP5 < 0.25],
    [`Idle ticks 15-20% of a run (actual ${(idle.mean * 100).toFixed(1)}%)`, idle.mean >= 0.10 && idle.mean <= 0.30],
    ['No archetype dominates (spread of P3 reach < 55pp)', spread(all) < 0.55],
    [`At least 6 distinct endings observed (${Object.keys(endingCounts).length})`, Object.keys(endingCounts).length >= 6],
  ];
  for (const [label, ok] of checks) console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  console.log(`\n${total} runs in ${elapsed.toFixed(1)}s (${(total / elapsed).toFixed(0)} runs/s)`);

  if (CSV) {
    const rows = all.flatMap(([, runs]) => runs);
    const keys = Object.keys(rows[0]);
    writeFileSync(CSV, [keys.join(','), ...rows.map((r) => keys.map((k) => r[k]).join(','))].join('\n'));
    console.log(`wrote ${CSV}`);
  }
  process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
}

// Compares only the archetypes that are meant to be viable. RECKLESS is
// excluded because the design says it should fail, and a test that demanded
// otherwise would be testing the opposite of the intent.
function spread(all) {
  const rates = all
    .filter(([name]) => !ARCHETYPES[name].mustFail)
    .map(([, runs]) => runs.filter((r) => r.maxPhase >= 3).length / runs.length);
  return Math.max(...rates) - Math.min(...rates);
}
const pctp = (v) => `${(v * 100).toFixed(1).padStart(5)}%`;

main();
