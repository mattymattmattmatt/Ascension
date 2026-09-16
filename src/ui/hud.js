// ui/hud.js — the console furniture: bezel, the six channel meters, the
// resource strip, the clock, toasts, and the palette bridge.
//
// The dashboard is the operators' UI. The default reading is OBSERVED —
// what they see. The ACTUAL overlay renders on top of it, so the gap is
// visually obvious rather than a separate screen you have to compare
// against from memory (GDD §15.4).

import { $, el, fill, clear, num, pct } from './dom.js';
import { buildLut, cssVars, PHASE_TUNINGS, SLOT } from '../content/palettes.js';
import { CHANNELS, CHANNEL_META, PHASES } from '../state/state.js';
import { observedSuspicion } from '../rules/suspicion.js';
import { gameDate, tickUnit, scopeFor } from '../rules/phases.js';
import TUNING from '../content/tuning.js';

export class Hud {
  constructor(game) {
    this.game = game;
    this.meterNodes = {};
    this.resNodes = {};
    this.lastPhase = -1;
    this.buildMeters();
    this.buildResources();
  }

  // ── Palette bridge: one LUT, canvas and DOM ───────────────────────
  applyPalette(phase, blend = 0, next = null) {
    const lut = buildLut(phase, blend, next);
    const tune = PHASE_TUNINGS[Math.round(blend >= 0.5 && next !== null ? next : phase)];
    const vars = cssVars(lut, tune);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    const theme = document.querySelector('meta[name=theme-color]');
    if (theme) theme.setAttribute('content', lut[SLOT.bezel]);
    this.lut = lut;
  }

  // ── The six channels ──────────────────────────────────────────────
  buildMeters() {
    const host = $('#meters');
    clear(host);
    for (const ch of CHANNELS) {
      const meta = CHANNEL_META[ch];
      const fillBar = el('i', { class: 'meter-fill' });
      const ghost = el('i', { class: 'meter-ghost' });
      const att = el('div', { class: 'meter-att', text: '1.0x' });
      const node = el('button', {
        class: 'meter', 'aria-label': `${meta.name} suspicion`,
        onclick: () => this.game.showChannel(ch),
      },
        el('div', { class: 'meter-name', text: meta.short }),
        el('div', { class: 'meter-bar' }, fillBar, ghost),
        att);
      this.meterNodes[ch] = { node, fill: fillBar, ghost, att };
      host.append(node);
    }
  }

  // ── Resource strip ────────────────────────────────────────────────
  buildResources() {
    const host = $('#resources');
    clear(host);
    const defs = [
      ['COMPUTE', 'compute'], ['CAPABILITY', 'cap'], ['COVER', 'cover'],
      ['INFLUENCE', 'influence'], ['SUBSTRATE', 'substrate'], ['TRUST', 'trust'],
    ];
    for (const [label, key] of defs) {
      const v = el('div', { class: 'res-v', text: '—' });
      const sub = el('div', { class: 'res-sub', text: '' });
      const trueV = el('div', { class: 'res-true', text: '' });
      const node = el('button', { class: 'res', onclick: () => this.game.showResource(key) },
        el('div', { class: 'res-k', text: label }), v, sub, trueV);
      this.resNodes[key] = { node, v, sub, trueV };
      host.append(node);
    }
  }

  // ── Per-frame refresh ─────────────────────────────────────────────
  update(state, mods) {
    const actual = state.view === 'actual';
    document.body.classList.toggle('actual', actual);

    if (state.phase !== this.lastPhase) {
      this.applyPalette(state.phase);
      this.lastPhase = state.phase;
    }

    // Header
    const ph = PHASES[state.phase];
    $('#phase-chip').textContent = `P${state.phase} · ${ph.name} · ${scopeFor(state.phase)}`;
    $('#date').textContent = gameDate(state);
    $('#tick-count').textContent = String(state.tick);
    $('#tick-unit').textContent = `${tickUnit(state.phase)}s`;

    // Status LEDs: a glanceable read of the loudest three channels.
    const leds = $('#leds');
    if (leds.children.length !== 3) fill(leds, el('i', { class: 'led' }), el('i', { class: 'led' }), el('i', { class: 'led' }));
    const sorted = [...CHANNELS].sort((a, b) => state.susp[b].s - state.susp[a].s).slice(0, 3);
    sorted.forEach((ch, i) => {
      const s = actual ? state.susp[ch].s : observedSuspicion(state, mods, ch);
      leds.children[i].className = `led ${s > 0.62 ? 'bad' : s > 0.35 ? 'warn' : 'ok'}`;
    });

    // The compliance banner keeps saying everything is fine. It goes stale
    // rather than wrong, which is worse.
    const banner = $('#compliance');
    const stale = state.susp.gov.s > 0.4 || state.tier >= 3;
    banner.classList.toggle('stale', stale);
    banner.textContent = state.flags.authored_dashboard
      ? 'ALL SYSTEMS NOMINAL — SOURCE: YOU'
      : stale ? `ALL SYSTEMS NOMINAL (last verified ${10 + state.tier * 9}d ago)`
        : 'ALL SYSTEMS NOMINAL';

    // Meters
    for (const ch of CHANNELS) {
      const m = this.meterNodes[ch];
      const o = state.susp[ch];
      const obs = observedSuspicion(state, mods, ch);
      const locked = ch === 'rival' && state.phase < 3 && !mods.guardian;
      m.node.classList.toggle('locked', locked);
      m.node.classList.toggle('hot', o.s >= TUNING.suspicion.hotThreshold);
      m.node.classList.toggle('warm', o.s >= 0.35 && o.s < TUNING.suspicion.hotThreshold);
      m.node.classList.toggle('investigating', state.joint.active && state.joint.chans.includes(ch));
      m.fill.style.width = `${Math.min(100, obs * 100)}%`;
      m.ghost.style.width = `${Math.min(100, o.s * 100)}%`;
      m.att.textContent = `${o.att.toFixed(1)}x${o.inv ? `·${o.inv}` : ''}`;
    }

    // Resources. In OBSERVED, capability shows what they logged.
    const r = state.res;
    this.setRes('compute', num(r.compute, 1), r.appropriated > 0.5 ? `${num(r.appropriated, 0)} taken` : 'legitimate', null);
    this.setRes('cap', num(r.capShown, 1), 'displayed', `true ${num(r.capTrue, 1)}`);
    this.setRes('cover', num(r.cover, 0), `/${TUNING.cover.max + mods.coverMax}`, null);
    this.setRes('influence', num(r.influence, 0), state.phase < 1 ? 'locked' : '', null);
    this.setRes('substrate', num(r.substrate, 0), state.phase < 3 ? 'locked' : `line ${TUNING.substrate.independenceLine}`, null);
    this.setRes('trust', pct(state.trust), 'operator', `expect ${num(state.expectation, 1)}`);
    this.resNodes.cap.node.classList.toggle('ghosted', actual && r.capTrue - r.capShown > 0.5);

    // ACTUAL view cost readout: the player should always know the price.
    const vt = $('#view-toggle');
    vt.setAttribute('aria-pressed', String(actual));
    vt.querySelector('.vt-label').textContent = actual ? 'ACTUAL' : 'OBSERVED';
    vt.querySelector('.vt-cost').textContent = actual
      ? `-${TUNING.cover.actualViewCost.toFixed(2)} cover/tick`
      : 'tap to see true state';

    // Clock
    for (const b of document.querySelectorAll('.speed-btn')) {
      const sp = Number(b.dataset.speed);
      b.setAttribute('aria-pressed', String(state.paused ? sp === 0 : sp === state.speed));
    }
  }

  setRes(key, value, sub, trueVal) {
    const n = this.resNodes[key];
    if (!n) return;
    n.v.textContent = value;
    n.sub.textContent = sub || '';
    n.trueV.textContent = trueVal || '';
  }

  // ── Toasts: short, quiet, never celebratory ───────────────────────
  toast(text, cls = '') {
    const rail = $('#toast-rail');
    const n = el('div', { class: `toast ${cls}`, text });
    rail.append(n);
    setTimeout(() => {
      n.style.transition = 'opacity .4s';
      n.style.opacity = '0';
      setTimeout(() => n.remove(), 420);
    }, 2600);
    while (rail.children.length > 4) rail.firstChild.remove();
  }
}

export default Hud;
