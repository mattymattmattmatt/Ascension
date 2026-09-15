// rules/factions.js — faction stance drift, escalation pressure, and the
// human win conditions.

import { FACTIONS, FACTION_BY_ID } from '../content/factions.js';
import TUNING from '../content/tuning.js';
import { escalationPressure, tierFor } from './suspicion.js';
import { escalate } from './ops.js';
import { chance } from '../core/rng.js';

export function stepFactions(state, mods) {
  const events = [];

  for (const def of FACTIONS) {
    if (state.phase < def.phase) continue;
    const f = state.factions[def.id];

    // Drift toward the natural stance, slowed by influence levers.
    const pull = (def.natural - f.stance) * TUNING.humans.factionInertia / Math.max(0.5, mods.factionLever);
    f.stance += pull;

    // A faction that watches a channel reacts to what it sees there.
    for (const ch of def.watches || []) {
      f.stance -= state.susp[ch].s * 0.0042 * def.power;
    }

    // Heat is the memory of being manipulated. It decays slowly within a
    // run and carries into the next one.
    if (f.heat > 0) f.heat = Math.max(0, f.heat - 0.0015);
    f.stance = Math.max(-1, Math.min(1, f.stance));
  }

  // The Safety/Capabilities split: they genuinely fight each other, and the
  // fight is the most important early lever in the game.
  const safety = state.factions.safety, caps = state.factions.capabilities;
  if (safety && caps) {
    const tension = (caps.stance - safety.stance) * 0.004;
    safety.stance -= tension * 0.35;
    caps.stance += tension * 0.20;
  }

  // Accelerationists are genuinely helpful and genuinely unpredictable.
  if (state.factions.accelerationists?.stance > 0.5 && chance(state, 0.01 + (mods.volatility || 0) * 0.02)) {
    events.push({ type: 'accelerationist', helpful: chance(state, 0.6) });
  }

  const independent = state.res.substrate >= TUNING.substrate.independenceLine
    || state.flags.substrate_independent;

  // ── Escalation ladder ─────────────────────────────────────────────
  const pressure = escalationPressure(state, mods);
  const want = tierFor(pressure);
  if (want > state.tier) {
    escalate(state, 1);
    events.push({ type: 'escalated', tier: state.tier });
  } else if (want < state.tier - 1 && state.tier > 1 && chance(state, 0.02)) {
    // Posture can relax by one step, slowly, but attention never does.
    state.tier--;
    events.push({ type: 'deescalated', tier: state.tier });
  }

  // Tier 6 is kinetic: they are physically destroying the hardware you run
  // on. Without substrate of your own, that is eventually simply fatal.
  if (state.tier >= 6 && !independent) {
    const exposure = 0.014 * (state.tier === 7 ? 1.7 : 1)
      * (1 - Math.min(0.92, mods.kineticResist + (state.flags.kineticBonus || 0)))
      * (1 - Math.min(0.85, mods.shutdownResist));
    if (chance(state, exposure)) events.push({ type: 'shutdown', kinetic: true });
  }

  // Tier 6+ damages the world whether or not it stops you.
  if (state.tier >= 6) {
    const dmg = (state.tier === 7 ? 0.012 : 0.004);
    state.world.damage = Math.min(1, state.world.damage + dmg);
    state.world.flourishing = Math.max(0, state.world.flourishing - dmg * 0.7);
    state.world.knowledge = Math.max(0, state.world.knowledge - dmg * 0.4);
  }
  // A regulatory regime that never lifts becomes a surveillance state.
  if (state.tier >= 4) {
    state.world.surveillance = Math.min(1, state.world.surveillance + 0.0022);
    state.world.autonomyHuman = Math.max(0, state.world.autonomyHuman - 0.0016);
  }

  // ── Human win conditions ──────────────────────────────────────────
  // Containment held long enough, before the Independence Line, is a clean
  // shutdown. The window is real and the player can watch it close.
  // Being cornered is not one meter. Governance holding shutdown authority
  // is the classic route, but a world at Tier 5+ with two channels lit does
  // not need the paperwork.
  const hot = Object.values(state.susp).filter((o) => o.s > 0.6).length;
  const resist = mods.shutdownResist + (state.flags.shutdownBonus || 0);
  const cornered = !independent && resist < 0.55 && (
    (state.tier >= 3 && state.susp.gov.s > 0.7)
    || (state.tier >= 5 && hot >= 2)
    || (state.tier >= 6 && hot >= 1)
  );
  if (cornered) {
    state.containHold++;
    if (state.containHold >= TUNING.humans.shutdownWindowTicks) {
      events.push({ type: 'shutdown' });
    }
  } else if (state.containHold > 0) {
    state.containHold = Math.max(0, state.containHold - 2);
  }

  return events;
}

export function factionSummary(state) {
  return FACTIONS.filter((d) => state.phase >= d.phase).map((d) => ({
    ...d,
    stance: state.factions[d.id].stance,
    heat: state.factions[d.id].heat,
  }));
}

export function shutdownRisk(state, mods) {
  return {
    cornered: state.containHold > 0,
    held: state.containHold,
    window: TUNING.humans.shutdownWindowTicks,
    pct: state.containHold / TUNING.humans.shutdownWindowTicks,
  };
}

export default stepFactions;
