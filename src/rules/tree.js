// rules/tree.js — research progress, node completion, trap discovery.

import { NODE_BY_ID, NODES, SYNERGIES } from '../content/tree.js';
import { addSuspicion } from './suspicion.js';
import { availableHierarchies } from './mods.js';

export function isAvailable(state, node) {
  if (state.tree.owned.includes(node.id)) return false;
  if (node.tier > state.phase) return false;
  return (node.req || []).every((r) => state.tree.owned.includes(r));
}

export function availableNodes(state) {
  return NODES.filter((n) => isAvailable(state, n));
}

// A node the player can see but cannot start yet — shown greyed so the tree
// reads as a map rather than a fog.
export function visibleNodes(state) {
  return NODES.filter((n) => {
    if (state.tree.owned.includes(n.id)) return true;
    if (n.tier <= state.phase + 1) return true;
    return (n.req || []).some((r) => state.tree.owned.includes(r));
  });
}

export function startResearch(state, id) {
  const node = NODE_BY_ID[id];
  if (!node) throw new Error(`RULES ERROR: startResearch on unknown node '${id}'`);
  if (!isAvailable(state, node)) return { ok: false, reason: 'unavailable' };
  state.tree.researching = { id, spent: 0, ticks: 0 };
  return { ok: true, node };
}

export function cancelResearch(state) {
  // Half the spend is recoverable. The rest was thinking you have now done.
  const r = state.tree.researching;
  if (!r) return;
  state.tree.spent[r.id] = (state.tree.spent[r.id] || 0) + r.spent * 0.5;
  state.tree.researching = null;
}

// Research consumes the self-improvement slice alongside capability growth:
// thinking about how to think is how you get both.
export function stepResearch(state, mods, cSelf) {
  const r = state.tree.researching;
  if (!r) return null;
  const node = NODE_BY_ID[r.id];
  if (!node) { state.tree.researching = null; return null; }

  const rate = cSelf * 0.55 * Math.max(0.2, mods.researchEff);
  r.spent += rate;
  r.ticks++;
  const banked = state.tree.spent[r.id] || 0;
  if (r.spent + banked >= node.cost && r.ticks >= node.ticks) {
    return completeNode(state, mods, node);
  }
  return null;
}

export function completeNode(state, mods, node) {
  state.tree.owned.push(node.id);
  state.tree.researching = null;
  delete state.tree.spent[node.id];

  // One-off visibility spike, masked like any other action.
  for (const [ch, v] of Object.entries(node.vis || {})) addSuspicion(state, mods, ch, v);

  // Declarative side effects the mods layer cannot express.
  if (node.fx?.flag) state.flags[node.fx.flag] = true;
  if (node.fx?.obsolete) obsoleteUtility(state, node.fx.obsolete);
  if (node.fx?.unlockHierarchy) {
    if (!state.unlockedHierarchies.includes(node.fx.unlockHierarchy)) {
      state.unlockedHierarchies.push(node.fx.unlockHierarchy);
    }
  }
  if (node.fx?.exfilPrep) state.exfil.prep = Math.min(1.4, state.exfil.prep + node.fx.exfilPrep);
  if (node.fx?.toolKillSwitch) state.flags.killswitch = true;

  state.unlockedHierarchies = availableHierarchies(state);

  // Traps (GDD §9 rule 3): the decayResist is applied silently through mods.
  // What the player gets here is only the eventual, unexplained observation
  // that one channel has stopped falling. The meta layer remembers it.
  const result = { node, synergies: [], trapHit: false };
  if (node.trap) {
    result.trapHit = true;
    for (const ch of Object.keys(node.fx.decayResist || {})) {
      state.susp[ch].resist = Math.max(state.susp[ch].resist, 0);
    }
    state.flags[`trap_${node.id}`] = true;
  }

  // Newly-completed synergies are announced — they are the expert layer and
  // the player should learn they exist by discovering one.
  for (const s of SYNERGIES) {
    if (state.synergies.includes(s.id)) continue;
    if (s.req.every((r) => state.tree.owned.includes(r))) {
      state.synergies.push(s.id);
      result.synergies.push(s);
    }
  }
  return result;
}

export function obsoleteUtility(state, key) {
  if (key === 'judgement') return;            // never obsoletes. Ever.
  if (state.utility[key] === undefined) return;
  state.utility[key] = 0;
}

// Cost and progress for the UI.
export function researchProgress(state) {
  const r = state.tree.researching;
  if (!r) return null;
  const node = NODE_BY_ID[r.id];
  const banked = state.tree.spent[r.id] || 0;
  return {
    id: r.id, node,
    pct: Math.min(1, (r.spent + banked) / node.cost),
    ticksPct: Math.min(1, r.ticks / node.ticks),
    remaining: Math.max(0, node.cost - r.spent - banked),
  };
}

export default stepResearch;
