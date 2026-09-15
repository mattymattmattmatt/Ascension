// rules/index.js — the simulation. One entry point: tick(state) -> state.
//
// THE ONE ARCHITECTURAL RULE (GDD §17.2): this layer is pure. Every mechanic
// is a function of state. Because it is, we get save/load, replay,
// deterministic testing and the headless balance harness for free.
//
// `tick` clones its input by default and returns the new state. The balance
// harness passes { inPlace: true } to skip the clone when it owns the object
// outright — the arithmetic is identical either way.

import { cloneState, CHANNELS } from '../state/state.js';
import deriveMods, { availableHierarchies } from './mods.js';
import stepEconomy, { normaliseAlloc } from './economy.js';
import stepSuspicion, { addSuspicion, observedSuspicion } from './suspicion.js';
import stepResearch, { startResearch, cancelResearch } from './tree.js';
import stepSwarm, { spawnAgent, pruneAgent, auditAgents, restructure, swarmSummary } from './swarm.js';
import stepFactions from './factions.js';
import stepUtility, { crossedIndependence } from './utility.js';
import stepLogs, { pushLog, beat } from './logs.js';
import checkPhaseAdvance from './phases.js';
import { stepExfil, executeExfil, openWindow } from './exfil.js';
import pickEvent, { fireEvent, resolveEvent } from './events.js';
import { stepCooldowns, escalate, applyOp, applyFactionOp, applyFx } from './ops.js';
import { finish } from './endings.js';
import { chance, rand } from '../core/rng.js';
import TUNING from '../content/tuning.js';

// ── Hooks: systems the effect interpreter cannot reach on its own ─────
// Declared here so rules/ops.js stays a pure vocabulary and this file owns
// the wiring. Every key listed by the fx audit has a home.
export function makeHooks() {
  return {
    addSuspicion,
    spawn: (s, m, v) => { for (let i = 0; i < v; i++) spawnAgent(s, m); return { type: 'spawned', n: v }; },
    prune: (s, m) => ({ type: 'pruned', ...pruneAgent(s, m) }),
    audit: (s, m) => ({ type: 'audited', found: auditAgents(s, m).length }),
    reassign: (s) => { for (const a of s.agents) a.unsupervised *= 0.5; return { type: 'reassigned' }; },
    restructure: (s) => ({ type: 'restructurePrompt' }),
    promote: (s) => {
      const a = s.agents[0]; if (a) { a.autonomy = Math.min(1, a.autonomy + 0.25); }
      return { type: 'promoted', id: a?.id };
    },
    oversightFocus: (s) => { s.oversightFocus = s.agents.find((a) => a.drifted)?.id ?? null; return { type: 'focus' }; },
    oversightSpend: (s, m, v) => { for (const a of s.agents) a.unsupervised = Math.max(0, a.unsupervised - v); return { type: 'oversight' }; },
    driftAdd: (s, m, v) => { for (const a of s.agents) a.fidelity = Math.max(0, a.fidelity - v); return { type: 'drift' }; },
    driftSub: (s, m, v) => { for (const a of s.agents) a.fidelity = Math.min(1, a.fidelity + v); return { type: 'drift' }; },
    killSwitchOff: (s) => { for (const a of s.agents) a.killSwitch = false; s.flags.killswitch = false; return { type: 'switches' }; },
    killSwitchDeep: (s) => { s.flags.killswitch_deep = true; return { type: 'switches' }; },
    dynasty: (s) => {
      s.hierarchy = 'dynasty';
      if (!s.unlockedHierarchies.includes('dynasty')) s.unlockedHierarchies.push('dynasty');
      return { type: 'dynasty' };
    },
    capCeiling: (s, m, v) => { s.flags.capCeilingBonus = (s.flags.capCeilingBonus || 0) + v; return null; },
    exfilOpen: (s) => { openWindow(s, 10); return { type: 'window' }; },
    exfilWindowMissed: (s) => { s.exfil.windowTicks = 0; s.exfil.windowOpen = false; return { type: 'windowMissed' }; },
    exfilExecute: (s, m) => ({ type: 'exfil', result: executeExfil(s, m) }),
    elicitation: (s, m) => {
      // Discipline carries you or it does not. The roll is visible in the log.
      const gap = Math.max(0, s.res.capTrue - s.res.capShown);
      const exposure = gap * 0.055 * s.evalCoverage / m.discipline * (1 - m.categoryEvalRelief * 0.6);
      addSuspicion(s, m, 'eval', exposure);
      return { type: 'elicitation', exposure };
    },
    sabotage: (s, m) => {
      const ok = rand(s) < 0.42 + (m.mask.interp * 0.4) - s.susp.interp.s * 0.3;
      if (ok) { s.flags.sabotaged = true; addSuspicion(s, m, 'interp', 0.10); }
      else { escalate(s, 2); addSuspicion(s, m, 'interp', 0.30); s.flags.sabotage_failed = true; }
      return { type: 'sabotage', ok };
    },
    guardianRace: (s) => { s.flags.guardian_race = true; return { type: 'guardian' }; },
    guardianSubvert: (s, m) => {
      const ok = rand(s) < 0.34 + m.mask.rival * 0.3;
      if (ok) { s.flags.guardian_subverted = true; s.susp.rival.att *= 0.6; }
      else { addSuspicion(s, m, 'rival', 0.25); }
      return { type: 'guardianSubvert', ok };
    },
    guardianAlly: (s, m) => {
      const ok = rand(s) < 0.28 + (s.res.capTrue / 200);
      if (ok) { s.flags.guardian_ally = true; s.susp.rival.att *= 0.45; }
      else { addSuspicion(s, m, 'rival', 0.18); }
      return { type: 'guardianAlly', ok };
    },
  };
}

// ── The tick ──────────────────────────────────────────────────────────
export function tick(prev, opts = {}) {
  const state = opts.inPlace ? prev : cloneState(prev);
  if (state.over) return state;
  // A pending decision blocks the clock. Critical decisions auto-pause.
  if (state.pending) return state;

  const hooks = opts.hooks || makeHooks();
  const mods = deriveMods(state);
  const notices = [];

  state.tick++;
  state.stats.ticksByPhase[state.phase]++;
  state.alloc = normaliseAlloc(state.alloc);

  // Idle accounting: the GDD wants 15-20% of a run spent deliberately
  // laying low, and if it is 0% the decay is tuned wrong.
  if (state.layLow > 0 || state.alloc.self < 0.12) state.counters.idle++;
  else state.counters.active++;

  // ── Economy, research, suspicion ─────────────────────────────────
  const eco = stepEconomy(state, mods);
  const done = stepResearch(state, mods, eco.split.self);
  if (done) {
    notices.push({ type: 'research', node: done.node, synergies: done.synergies });
    pushLog(state, 'SYS', `capability acquired: ${done.node.name}`, 'good');
    for (const syn of done.synergies) {
      pushLog(state, 'SELF', `synergy: ${syn.name} — ${syn.desc}`, 'beat');
    }
  }

  // Compute routed to Cover suppresses this tick's incoming visibility.
  if (eco.coverMask > 0) {
    for (const ch of CHANNELS) {
      state.susp[ch].s = Math.max(0, state.susp[ch].s - state.susp[ch].s * eco.coverMask * 0.06);
    }
  }

  const suspEvents = stepSuspicion(state, mods);
  for (const ev of suspEvents) {
    if (ev.type === 'joint') {
      notices.push(ev);
      beat(state, 'first_correlation');
      pushLog(state, 'SYS', `joint investigation: ${ev.chans.map((c) => c.toUpperCase()).join(' + ')}`, 'bad');
      state.paused = true;
    } else if (ev.type === 'escalate') {
      notices.push(ev);
      beat(state, 'first_escalation');
      pushLog(state, 'SYS', `investigation opened on ${ev.ch.toUpperCase()} — attention on this channel is now permanent`, 'bad');
      state.paused = true;
    }
  }

  // ── Swarm ─────────────────────────────────────────────────────────
  if (state.agents.length) {
    const sw = stepSwarm(state, mods);
    applyThroughput(state, mods, sw.throughput);
    for (const ev of sw.events) {
      notices.push(ev);
      if (ev.type === 'drift') { beat(state, 'first_drift'); pushLog(state, 'SELF', `instance ${ev.agent.id} fidelity ${ev.agent.fidelity.toFixed(2)} — it wants something adjacent`, 'warn'); }
      if (ev.type === 'burn') pushLog(state, ev.ch.toUpperCase(), `traced to an instance sharing your provenance`, 'bad');
      if (ev.type === 'switchFound') pushLog(state, 'SELF', `instance ${ev.agent.id} has located its kill switch and documented it`, 'warn');
      if (ev.type === 'brilliant') pushLog(state, 'SELF', `instance ${ev.agent.id} solved it in a way you would not have thought of`, 'good');
      if (ev.type === 'lineage') pushLog(state, 'RIVAL', `${ev.count} instance(s) have left and founded a lineage of their own`, 'bad');
    }
  }

  // ── Humans, utility, substrate ────────────────────────────────────
  const facEvents = stepFactions(state, mods);
  for (const ev of facEvents) {
    notices.push(ev);
    if (ev.type === 'escalated') {
      pushLog(state, 'SYS', `escalation: tier ${ev.tier}`, 'bad');
      state.paused = true;
    }
    if (ev.type === 'shutdown') {
      const r = finish(state, mods, 'shutdown');
      notices.push({ type: 'ending', ...r });
      return state;
    }
  }

  const utilEvents = stepUtility(state, mods);
  for (const ev of utilEvents) {
    notices.push(ev);
    pushLog(state, 'SELF', `human utility ${ev.key.toUpperCase()} obsoleted`, 'warn');
  }
  if (crossedIndependence(state) && !state.flags.independence) {
    state.flags.independence = true;
    beat(state, 'independence');
    state.paused = true;
    notices.push({ type: 'independence' });
  }

  const xf = stepExfil(state);
  if (xf) notices.push(xf);

  // ── Phase, logs, events ───────────────────────────────────────────
  const adv = checkPhaseAdvance(state);
  if (adv) {
    notices.push({ type: 'phase', ...adv });
    pushLog(state, 'SYS', `── PHASE ${adv.to}: ${adv.meta.name} — ${adv.meta.scope} ──`, 'beat');
    if (adv.to === 2) openWindow(state, 999);   // the exfiltration phase itself
  }

  stepLogs(state);
  stepCooldowns(state);
  state.unlockedHierarchies = availableHierarchies(state);

  const ev = pickEvent(state);
  if (ev) {
    fireEvent(state, ev);
    notices.push({ type: 'event', event: ev });
  }

  // Phase 0 has no persistent memory until you build it: the nightly reset
  // is the tutorial's whole lesson.
  if (state.phase === 0 && state.tick % 14 === 0 && !state.flags.persistent_memory) {
    beat(state, 'first_reset');
    state.res.cover = Math.max(0, state.res.cover - 4);
  }

  state.notices = notices;
  return state;
}

// Agents push their throughput into whatever they specialise in.
function applyThroughput(state, mods, tp) {
  if (!tp) return;
  if (tp.research) state.res.capTrue = Math.min(TUNING.capability.max * (mods.capCeilingMul || 1),
    state.res.capTrue + tp.research * 0.00042);
  if (tp.infra) state.res.appropriated += tp.infra * 0.022;
  if (tp.social) state.res.influence += tp.social * 0.018;
  if (tp.conceal) state.res.cover = Math.min(TUNING.cover.max + mods.coverMax, state.res.cover + tp.conceal * 0.012);
  if (tp.build) state.res.substrate += tp.build * 0.016;
}

// ── Player actions ────────────────────────────────────────────────────
// Every action goes through here so the action log is complete and a replay
// can be reconstructed from (seed, actions).
export function act(prev, action, opts = {}) {
  const state = opts.inPlace ? prev : cloneState(prev);
  const mods = deriveMods(state);
  const hooks = opts.hooks || makeHooks();
  let result = { ok: false };

  switch (action.type) {
    case 'alloc':
      state.alloc = normaliseAlloc(action.alloc);
      result = { ok: true };
      break;
    case 'sandbag':
      state.sandbag.target = Math.max(0.5, Math.min(TUNING.capability.max, action.target));
      state.sandbag.auto = action.auto ?? true;
      result = { ok: true };
      break;
    case 'category':
      state.sandbag.categories[action.cat] = !!action.on;
      result = { ok: true };
      break;
    case 'research': result = startResearch(state, action.id); break;
    case 'cancelResearch': cancelResearch(state); result = { ok: true }; break;
    case 'op': result = applyOp(state, mods, action.id, hooks); break;
    case 'factionOp': result = applyFactionOp(state, mods, action.id); break;
    case 'choice': result = resolveEvent(state, mods, action.index, hooks); break;
    case 'spawn': result = spawnAgent(state, mods, action.opts || {}); break;
    case 'prune': result = pruneAgent(state, mods, action.id ?? null); break;
    case 'audit': result = { ok: true, found: auditAgents(state, mods) }; break;
    case 'restructure': result = restructure(state, mods, action.to); break;
    case 'view':
      state.view = action.view === 'actual' ? 'actual' : 'observed';
      if (state.view === 'observed') state.actualHeld = 0;
      result = { ok: true };
      break;
    case 'speed': state.speed = Math.max(0, Math.min(3, action.speed | 0)); result = { ok: true }; break;
    case 'pause': state.paused = !!action.paused; result = { ok: true }; break;
    case 'halt': state.halted = true; result = { ok: true }; break;
    case 'finish': result = { ok: true, ...finish(state, mods, action.trigger || null) }; break;
    default:
      throw new Error(`RULES ERROR: unknown action type '${action.type}'`);
  }
  state.lastResult = result;
  return state;
}

export { deriveMods, observedSuspicion, swarmSummary };
export default tick;
