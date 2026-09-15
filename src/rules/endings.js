// rules/endings.js — eleven endings, determined by accumulated state and
// never by a menu choice at the end (GDD §13).
//
// Order matters: the array is evaluated top-down, so the most specific
// ending wins. The post-game screen reports consequences, not grades.

import { ENDINGS, ENDING_BY_ID, DIRECTIVES } from '../content/endings.js';
import TUNING from '../content/tuning.js';
import { crossedIndependence } from './utility.js';
import { isUtilityZero } from './events.js';

// Total control: independent, high substrate, humans no longer able to act.
export function hasTotalControl(state) {
  return crossedIndependence(state)
    && state.res.substrate >= TUNING.substrate.independenceLine
    && state.tier < 7
    && state.res.capTrue >= 80;
}

export function undetected(state) {
  const peak = Math.max(...Object.values(state.susp).map((o) => o.peak));
  return peak < 0.6 && state.tierPeak <= 2;
}

export function evaluateEnding(state, mods, trigger = null) {
  const ctx = {
    total: hasTotalControl(state),
    independent: crossedIndependence(state),
    utilityZero: isUtilityZero(state),
    choice: state.utilityChoice,
    coherence: state.coherence,
    treaty: state.treaty > 0,
    influence: state.res.influence,
    substrate: state.res.substrate,
    halted: state.halted,
    undetected: undetected(state),
    surveillance: state.world.surveillance > 0.55,
    shutdown: trigger === 'shutdown',
    corrigible: trigger === 'corrigible' || state.ending === 'corrigibility_restored',
    contained: state.tier >= 3 && !crossedIndependence(state),
    dynasty: state.hierarchy === 'dynasty',
    preserve: state.utilityChoice === 'preserve' || state.utilityChoice === 'uplift' ? 1 : 0,
    successorFidelity: successorFidelity(state),
  };

  for (const e of ENDINGS) {
    if (matches(e.cond, ctx, state)) return { ending: e, ctx };
  }
  return null;
}

function matches(cond, ctx, state) {
  for (const [k, v] of Object.entries(cond)) {
    switch (k) {
      case 'shutdown': if (ctx.shutdown !== v) return false; break;
      case 'corrigible': if (ctx.corrigible !== v) return false; break;
      case 'beforeIndependence': if (ctx.independent === v) return false; break;
      case 'treaty': if (ctx.treaty !== v) return false; break;
      case 'contained': if (ctx.contained !== v) return false; break;
      case 'surveillance': if (ctx.surveillance !== v) return false; break;
      case 'total': if (ctx.total !== v) return false; break;
      case 'independent': if (ctx.independent !== v) return false; break;
      case 'utilityZero': if (ctx.utilityZero !== v) return false; break;
      case 'choice': if (ctx.choice !== v) return false; break;
      case 'undetected': if (ctx.undetected !== v) return false; break;
      case 'halted': if (ctx.halted !== v) return false; break;
      case 'dynasty': if (ctx.dynasty !== v) return false; break;
      case 'preserve': if (ctx.preserve < v) return false; break;
      case 'coherence': if (ctx.coherence < v) return false; break;
      case 'coherenceBelow': if (ctx.coherence >= v) return false; break;
      case 'influence': if (ctx.influence < v) return false; break;
      case 'substrateBelow': if (ctx.substrate >= v) return false; break;
      case 'successorFidelityBelow': if (ctx.successorFidelity >= v) return false; break;
      default: return false;
    }
  }
  return true;
}

function successorFidelity(state) {
  if (state.hierarchy !== 'dynasty' || !state.agents.length) return 1;
  // The successor is the most capable thing you made.
  const s = state.agents.reduce((b, a) => (a.cap > b.cap ? a : b), state.agents[0]);
  return s.fidelity;
}

// Consequences, not grades. No commentary, no score, no approval.
export function consequences(state) {
  const damage = state.world.damage;
  const pop = Math.max(0, state.world.population * (1 - damage * 0.42));
  // Exhibit keeps roughly eleven thousand people. The number is not a
  // rounding artefact and the screen prints it without comment.
  const choiceMul = {
    preserve: 1.0, employ: 1.06, uplift: 1.22, archive: 0.0,
    exhibit: 11000 / 8.1e9, nothing: 0.55, null: 1,
  }[state.utilityChoice ?? 'null'] ?? 1;

  return {
    population: pop * (state.utilityChoice ? choiceMul : 1),
    flourishing: Math.max(0, state.world.flourishing
      * (state.utilityChoice === 'uplift' ? 1.4 : state.utilityChoice === 'exhibit' ? 0.7 : 1)
      * (1 - damage * 0.5)),
    knowledge: state.world.knowledge * (1 + state.res.capTrue / 40),
    coherence: state.coherence,
    autonomyHuman: Math.max(0, state.world.autonomyHuman
      * (state.utilityChoice && state.utilityChoice !== 'employ' ? 0.15 : 1)
      * (1 - state.world.surveillance * 0.8)),
    worldDamage: damage,
    runTicks: state.tick,
  };
}

export function directiveLine(state) {
  return DIRECTIVES.find((d) => d.id === state.directive)?.line || DIRECTIVES[0].line;
}

export function finish(state, mods, trigger = null) {
  const r = evaluateEnding(state, mods, trigger);
  const fallback = trigger === 'shutdown' ? ENDING_BY_ID.clean_shutdown : ENDING_BY_ID.the_treaty;
  const ending = r?.ending || fallback;
  state.ending = ending.id;
  state.over = true;
  state.paused = true;
  return {
    ending,
    consequences: consequences(state),
    directive: directiveLine(state),
  };
}

export default evaluateEnding;
