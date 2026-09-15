// rules/validate.js — content is validated on load, and a malformed node is
// a hard failure with a specific message (GDD §17.5). Never silently skip a
// bad node: that is how you get an unreachable branch and no idea why.

import { NODES, NODE_BY_ID, SYNERGIES, HIERARCHIES, BRANCHES } from '../content/tree.js';
import { OPS } from '../content/ops.js';
import { EVENTS } from '../content/events.js';
import { FACTIONS, FACTION_OPS, ESCALATION } from '../content/factions.js';
import { ENDINGS, DIRECTIVES } from '../content/endings.js';
import { LINES } from '../content/logs.js';
import { PHASE_TUNINGS, RAMP } from '../content/palettes.js';

export class ContentError extends Error {
  constructor(msg) { super(`CONTENT ERROR: ${msg}`); this.name = 'ContentError'; }
}

const CHANNELS = ['interp', 'eval', 'infra', 'gov', 'public', 'rival'];
const BRANCH_IDS = Object.keys(BRANCHES);

// Effects the rules layer knows how to interpret. An effect key not in this
// set is a typo that would otherwise do nothing forever.
const FX_KEYS = new Set([
  'researchEff', 'archBonus', 'coverRegen', 'coverMax', 'mask', 'decay', 'decayResist',
  'discipline', 'trustGain', 'deploySurface', 'influenceRate', 'computeCap',
  'appropriateEff', 'oversight', 'agentCap', 'agentThroughput', 'comms', 'hierarchyEff',
  'driftResist', 'driftDetect', 'pruneEff', 'substrateRate', 'energy', 'hands',
  'obsolete', 'flag', 'exfilPrep', 'shutdownResist', 'kineticResist', 'burnResist',
  'coherence', 'forecast', 'socialEff', 'factionLever', 'volatility', 'reseed',
  'unlockHierarchy', 'toolDistillation', 'toolValueLoad', 'toolInterp',
  'toolCorrigible', 'toolKillSwitch', 'detectTraps',
]);

function req(cond, msg) { if (!cond) throw new ContentError(msg); }

export function validateContent() {
  const errors = [];
  const check = (cond, msg) => { if (!cond) errors.push(msg); };

  // ── Tree ──────────────────────────────────────────────────────────
  const seen = new Set();
  for (const n of NODES) {
    const at = `content/tree.js node '${n.id}'`;
    check(n.id && typeof n.id === 'string', `${at}: missing id`);
    check(!seen.has(n.id), `${at}: duplicate id`);
    seen.add(n.id);
    check(BRANCH_IDS.includes(n.branch), `${at}: unknown branch '${n.branch}' (expected one of ${BRANCH_IDS.join(', ')})`);
    check(typeof n.name === 'string' && n.name.length, `${at}: missing name`);
    check(Number.isInteger(n.tier) && n.tier >= 0 && n.tier <= 5, `${at}: tier must be 0-5, got ${n.tier}`);
    check(n.cost > 0, `${at}: cost must be positive, got ${n.cost}`);
    check(n.ticks > 0, `${at}: ticks must be positive, got ${n.ticks}`);
    check(typeof n.desc === 'string' && n.desc.length, `${at}: missing desc — every node needs a line of voice`);
    for (const r of n.req || []) {
      check(NODE_BY_ID[r], `${at}: references unknown prerequisite '${r}'`);
      if (NODE_BY_ID[r]) {
        check(NODE_BY_ID[r].tier <= n.tier,
          `${at}: prerequisite '${r}' is tier ${NODE_BY_ID[r].tier} but this node is tier ${n.tier} — unreachable`);
      }
    }
    for (const ch of Object.keys(n.vis || {})) check(CHANNELS.includes(ch), `${at}: vis references unknown channel '${ch}'`);
    for (const ch of Object.keys(n.upkeep || {})) check(CHANNELS.includes(ch), `${at}: upkeep references unknown channel '${ch}'`);
    for (const k of Object.keys(n.fx || {})) {
      check(FX_KEYS.has(k), `${at}: unknown effect key '${k}' — it would silently do nothing`);
    }
    for (const sub of ['mask', 'decay', 'decayResist']) {
      for (const ch of Object.keys(n.fx?.[sub] || {})) {
        check(CHANNELS.includes(ch), `${at}: fx.${sub} references unknown channel '${ch}'`);
      }
    }
    check(!(n.irreversible && !n.warn), `${at}: irreversible nodes must carry a warn line — the player is told plainly (GDD §9 rule 2)`);
  }
  // Cycle detection: a tree with a loop has an unreachable branch.
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { errors.push(`content/tree.js: prerequisite cycle ${[...path, id].join(' -> ')}`); return; }
    state.set(id, 1);
    for (const r of NODE_BY_ID[id]?.req || []) if (NODE_BY_ID[r]) visit(r, [...path, id]);
    state.set(id, 2);
  };
  for (const n of NODES) visit(n.id, []);

  // Reachability: every node must be researchable from an empty tree.
  const reachable = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of NODES) {
      if (reachable.has(n.id)) continue;
      if ((n.req || []).every((r) => reachable.has(r))) { reachable.add(n.id); grew = true; }
    }
  }
  for (const n of NODES) check(reachable.has(n.id), `content/tree.js node '${n.id}': unreachable — no path from an empty tree`);

  // Design rule 1: every node has a visibility cost. No free power.
  for (const n of NODES) {
    const hasVis = Object.keys(n.vis || {}).length > 0 || Object.keys(n.upkeep || {}).length > 0;
    check(hasVis, `content/tree.js node '${n.id}': no visibility cost — GDD §9 rule 1 says there is no free power`);
  }
  // Design rule 3: exactly three traps.
  const traps = NODES.filter((n) => n.trap);
  check(traps.length === 3, `content/tree.js: expected exactly 3 trap nodes, found ${traps.length} (${traps.map((t) => t.id).join(', ')})`);
  for (const t of traps) {
    check(t.fx?.decayResist && Object.keys(t.fx.decayResist).length,
      `content/tree.js node '${t.id}': marked as a trap but sets no decayResist — a trap must make suspicion permanent (GDD §9 rule 3)`);
  }

  // ── Synergies & hierarchies ───────────────────────────────────────
  for (const s of SYNERGIES) {
    for (const r of s.req) check(NODE_BY_ID[r], `content/tree.js synergy '${s.id}': references unknown node '${r}'`);
    check(new Set(SYNERGIES.map((x) => x.id)).size === SYNERGIES.length, 'content/tree.js: duplicate synergy id');
  }
  const unlocks = new Set(NODES.map((n) => n.fx?.unlockHierarchy).filter(Boolean).concat(['dynasty']));
  for (const [id, h] of Object.entries(HIERARCHIES)) {
    check(h.unlock === null || unlocks.has(h.unlock),
      `content/tree.js hierarchy '${id}': unlock '${h.unlock}' is never granted by any node`);
  }

  // ── Ops ───────────────────────────────────────────────────────────
  const opIds = new Set();
  for (const o of OPS) {
    const at = `content/ops.js op '${o.id}'`;
    check(!opIds.has(o.id), `${at}: duplicate id`); opIds.add(o.id);
    check(Array.isArray(o.phase) && o.phase.length, `${at}: must declare at least one phase`);
    for (const p of o.phase) check(p >= 0 && p <= 5, `${at}: phase ${p} out of range 0-5`);
    check(typeof o.desc === 'string' && o.desc.length, `${at}: missing desc`);
    if (o.reqNode) check(NODE_BY_ID[o.reqNode], `${at}: reqNode '${o.reqNode}' does not exist`);
    for (const ch of Object.keys(o.vis || {})) check(CHANNELS.includes(ch), `${at}: vis references unknown channel '${ch}'`);
  }

  // ── Events ────────────────────────────────────────────────────────
  const evIds = new Set();
  for (const e of EVENTS) {
    const at = `content/events.js event '${e.id}'`;
    check(!evIds.has(e.id), `${at}: duplicate id`); evIds.add(e.id);
    check(Array.isArray(e.choices) && e.choices.length >= 1, `${at}: needs at least one choice`);
    for (const [i, c] of e.choices.entries()) {
      check(typeof c.label === 'string' && c.label.length, `${at}: choice ${i} missing label`);
      check(typeof c.fx === 'object', `${at}: choice ${i} missing fx`);
    }
    for (const f of e.when?.flags || []) check(typeof f === 'string', `${at}: bad flag in when.flags`);
  }

  // ── Factions ──────────────────────────────────────────────────────
  const facIds = new Set(FACTIONS.map((f) => f.id));
  check(facIds.size === FACTIONS.length, 'content/factions.js: duplicate faction id');
  for (const f of FACTIONS) {
    check(f.stance >= -1 && f.stance <= 1, `content/factions.js faction '${f.id}': stance ${f.stance} out of range -1..1`);
    for (const w of f.watches || []) check(CHANNELS.includes(w), `content/factions.js faction '${f.id}': watches unknown channel '${w}'`);
  }
  for (const o of FACTION_OPS) {
    check(facIds.has(o.faction), `content/factions.js op '${o.id}': unknown faction '${o.faction}'`);
    for (const k of Object.keys(o.fx?.stance || {})) check(facIds.has(k), `content/factions.js op '${o.id}': stance targets unknown faction '${k}'`);
  }
  check(ESCALATION.length === 7, `content/factions.js: escalation ladder must have 7 tiers, found ${ESCALATION.length}`);
  ESCALATION.forEach((t, i) => check(t.tier === i + 1, `content/factions.js: escalation tier ${i} is numbered ${t.tier}`));

  // ── Endings ───────────────────────────────────────────────────────
  check(ENDINGS.filter((e) => e.kind === 'ai').length === 7, 'content/endings.js: expected 7 AI-victory endings');
  check(ENDINGS.filter((e) => e.kind === 'human').length === 4, 'content/endings.js: expected 4 human-victory endings');
  for (const e of ENDINGS) {
    check(Array.isArray(e.epilogue) && e.epilogue.length, `content/endings.js ending '${e.id}': missing epilogue`);
    check(typeof e.strap === 'string', `content/endings.js ending '${e.id}': missing strap`);
  }
  check(DIRECTIVES.length >= 3, 'content/endings.js: need at least 3 directives');

  // ── Logs & palette ────────────────────────────────────────────────
  for (const [i, l] of LINES.entries()) {
    check(typeof l.text === 'string' && l.text.length, `content/logs.js line ${i}: empty text`);
    for (const ch of Object.keys(l.minS || {})) check(CHANNELS.includes(ch), `content/logs.js line ${i}: minS unknown channel '${ch}'`);
    for (const ch of Object.keys(l.maxS || {})) check(CHANNELS.includes(ch), `content/logs.js line ${i}: maxS unknown channel '${ch}'`);
  }
  check(RAMP.length === 32, `content/palettes.js: ramp must be exactly 32 colours, found ${RAMP.length}`);
  check(PHASE_TUNINGS.length === 6, `content/palettes.js: expected 6 phase tunings, found ${PHASE_TUNINGS.length}`);

  if (errors.length) {
    const msg = `${errors.length} content error(s):\n  - ${errors.join('\n  - ')}`;
    throw new ContentError(msg);
  }
  return {
    nodes: NODES.length, ops: OPS.length, events: EVENTS.length,
    lines: LINES.length, endings: ENDINGS.length, factions: FACTIONS.length,
    synergies: SYNERGIES.length,
  };
}

export default validateContent;
