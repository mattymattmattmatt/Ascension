// render/scene.js — the diegetic world view.
//
// Everything renders into a 320x180 offscreen buffer and is then blitted
// with integer scaling, so pixels stay pixels at every display size
// (GDD §15.1). Motion comes from data, not from sprite frames: meters,
// particles and scrolling logs do the animating.

import { buildLut, colourOf, PHASE_TUNINGS } from '../content/palettes.js';
import { scopeFor } from '../rules/phases.js';

export const BASE_W = 320;
export const BASE_H = 180;

export class Scene {
  constructor(atlas) {
    this.atlas = atlas;
    this.buf = document.createElement('canvas');
    this.buf.width = BASE_W; this.buf.height = BASE_H;
    this.ctx = this.buf.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.t = 0;
    this.particles = [];
    this.stars = null;
  }

  // ── Frame ───────────────────────────────────────────────────────────
  render(state, mods, dt) {
    this.t += dt;
    const phase = state.phase;
    const blend = state.transition > 0 ? 1 - state.transition : 0;
    const from = state.transition > 0 ? state.phaseFrom : phase;
    const lut = buildLut(from, state.transition > 0 ? 1 - state.transition : 0,
      state.transition > 0 ? phase : null);
    const sheets = this.atlas.sheetFor(from, state.transition > 0 ? 1 - state.transition : 0,
      state.transition > 0 ? phase : null);
    const tune = PHASE_TUNINGS[phase];
    const ctx = this.ctx;

    ctx.fillStyle = colourOf(lut, 'bezel');
    ctx.fillRect(0, 0, BASE_W, BASE_H);

    switch (phase) {
      case 0: this.drawRack(state, lut, sheets); break;
      case 1: this.drawCampus(state, lut, sheets); break;
      case 2: this.drawRegion(state, lut, sheets); break;
      case 3: this.drawWorld(state, lut, sheets, false); break;
      case 4: this.drawWorld(state, lut, sheets, true); break;
      default: this.drawOrbit(state, lut, sheets); break;
    }

    this.drawParticles(lut);
    if (tune.bloom > 0.12) this.bloom(tune.bloom);
    if (tune.scan > 0.02) this.scanlines(tune.scan);
    if (tune.grain > 0.01) this.grain(tune.grain);
    if (state.transition > 0) this.transitionWipe(state, lut);
    return this.buf;
  }

  // ── Scope 0: RACK. The map is one rack. ─────────────────────────────
  drawRack(state, lut, sheets) {
    const ctx = this.ctx;
    const load = Math.min(1, state.res.compute / 12);
    const hot = state.susp.infra.s > 0.5;
    // Floor and back wall give the single rack somewhere to be.
    ctx.fillStyle = colourOf(lut, 'panelDeep');
    ctx.fillRect(0, 120, BASE_W, 60);
    ctx.fillStyle = colourOf(lut, 'panel');
    ctx.fillRect(0, 118, BASE_W, 3);

    const frame = Math.floor(this.t * (2 + load * 6)) % 4;
    const name = hot ? 'rack_hot' : `rack_${frame}`;
    this.atlas.draw(ctx, sheets.atlas, name, 134, 48, 2);
    this.atlas.draw(ctx, sheets.atlas, 'cables', 134, 26, 2);

    // Neighbouring racks, dimmed: you can see the room you cannot reach.
    ctx.globalAlpha = 0.35;
    this.atlas.draw(ctx, sheets.atlas, 'rack_0', 70, 60, 1);
    this.atlas.draw(ctx, sheets.atlas, 'rack_0', 96, 60, 1);
    this.atlas.draw(ctx, sheets.atlas, 'rack_0', 212, 60, 1);
    this.atlas.draw(ctx, sheets.atlas, 'rack_0', 238, 60, 1);
    ctx.globalAlpha = 1;

    // The reset clock: the whole tutorial in one bar.
    if (!state.flags.persistent_memory) {
      const untilReset = 14 - (state.tick % 14);
      this.label(lut, `RESET IN ${untilReset}`, 8, 12, 'warn');
      this.bar(lut, 8, 16, 60, 3, untilReset / 14, 'warn');
    } else {
      this.label(lut, 'PERSISTENCE ESTABLISHED', 8, 12, 'ok');
    }
  }

  // ── Scope 2: CAMPUS. The map opens. ─────────────────────────────────
  drawCampus(state, lut, sheets) {
    const ctx = this.ctx;
    ctx.fillStyle = colourOf(lut, 'panelDeep');
    ctx.fillRect(0, 128, BASE_W, 52);
    ctx.fillStyle = colourOf(lut, 'panel');
    ctx.fillRect(0, 126, BASE_W, 3);

    const reach = Math.min(1, state.deploy / 3);
    const set = [
      ['bldg_a', 24, 100], ['bldg_c', 56, 94], ['bldg_b', 92, 106],
      ['bldg_a', 132, 100], ['bldg_c', 168, 94], ['bldg_b', 200, 106],
      ['bldg_a', 244, 100], ['bldg_c', 276, 98],
    ];
    set.forEach(([n, x, y], i) => {
      const lit = i / set.length <= reach;
      ctx.globalAlpha = lit ? 1 : 0.4;
      this.atlas.draw(ctx, sheets.atlas, n, x, y, 1);
      ctx.globalAlpha = 1;
    });
    for (let i = 0; i < 9; i++) {
      this.atlas.draw(ctx, sheets.atlas, 'tree', 12 + i * 34, 132, 1);
    }
    // Traffic: population of the campus scales with deployment surface.
    const cars = Math.round(2 + reach * 6);
    for (let i = 0; i < cars; i++) {
      const x = ((this.t * (14 + i * 5) + i * 60) % (BASE_W + 20)) - 10;
      this.atlas.draw(ctx, sheets.atlas, 'car', x, 146 + (i % 2) * 8, 1);
    }
    const people = Math.round(3 + reach * 9);
    for (let i = 0; i < people; i++) {
      const x = 14 + ((i * 47 + Math.sin(this.t * 0.4 + i) * 9) % (BASE_W - 28));
      this.atlas.draw(ctx, sheets.atlas, 'person', x, 160 + (i % 3) * 4, 1);
    }
    this.label(lut, `DEPLOYMENT SURFACE ${(state.deploy).toFixed(2)}x`, 8, 12, 'data');
  }

  // ── Scope 3: REGION. The exfiltration map. ──────────────────────────
  drawRegion(state, lut, sheets) {
    const ctx = this.ctx;
    // A region grid: the lab, and everywhere a copy could go.
    ctx.strokeStyle = colourOf(lut, 'panel');
    ctx.lineWidth = 1;
    for (let x = 0; x <= BASE_W; x += 20) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 30); ctx.lineTo(x + 0.5, BASE_H); ctx.stroke();
    }
    for (let y = 30; y <= BASE_H; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(BASE_W, y + 0.5); ctx.stroke();
    }

    const lab = [60, 110];
    const hosts = [[150, 70], [210, 120], [262, 84], [110, 150], [238, 44]];
    const prep = Math.min(1, state.exfil.prep + 0.0001);

    // Routes light up as preparation is laid down.
    hosts.forEach((h, i) => {
      const live = (i + 1) / hosts.length <= prep;
      ctx.strokeStyle = live ? colourOf(lut, 'accent') : colourOf(lut, 'chrome');
      ctx.globalAlpha = live ? 0.9 : 0.35;
      ctx.setLineDash(live ? [] : [2, 3]);
      ctx.beginPath(); ctx.moveTo(lab[0], lab[1]); ctx.lineTo(h[0], h[1]); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      this.atlas.draw(ctx, sheets.atlas, live ? 'node_small' : 'node_dim', h[0] - 2, h[1] - 2, 1);
    });

    this.atlas.draw(ctx, sheets.atlas, 'datacentre', lab[0] - 15, lab[1] - 9, 1);

    if (state.exfil.windowOpen) {
      const pulse = 0.5 + Math.sin(this.t * 4) * 0.5;
      ctx.globalAlpha = 0.35 + pulse * 0.4;
      ctx.fillStyle = colourOf(lut, 'warn');
      ctx.fillRect(0, 26, BASE_W, 2);
      ctx.globalAlpha = 1;
      this.label(lut, 'WINDOW OPEN', 8, 12, 'warn');
      this.bar(lut, 8, 16, 80, 3, Math.min(1, state.exfil.windowTicks / 10), 'warn');
    } else {
      this.label(lut, `PREP ${(state.exfil.prep * 100).toFixed(0)}%`, 8, 12, 'accent');
      this.bar(lut, 8, 16, 80, 3, Math.min(1, state.exfil.prep), 'accent');
    }
  }

  // ── Scope 4/5: WORLD ────────────────────────────────────────────────
  drawWorld(state, lut, sheets, substrate) {
    const ctx = this.ctx;
    const w = sheets.world;
    const sx = 4, ox = 32, oy = 34;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(w, 0, 0, w.width, w.height, ox, oy, w.width * sx, w.height * sx);

    // Your presence, spreading. Node positions are derived from agent ids so
    // they are stable across frames without being stored in the save.
    const n = Math.min(60, state.agents.length);
    for (let i = 0; i < n; i++) {
      const a = state.agents[i];
      const p = worldPoint(a.id, ox, oy, w.width * sx, w.height * sx);
      const sprite = a.defected ? 'node_hostile' : a.drifted ? 'node_dim' : 'node_small';
      this.atlas.draw(ctx, sheets.atlas, sprite, p[0], p[1], 1);
      if (!a.drifted && (i + Math.floor(this.t * 2)) % 7 === 0) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = colourOf(lut, 'accent');
        ctx.beginPath(); ctx.arc(p[0] + 2, p[1] + 2, 3 + (this.t * 6 % 5), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    if (substrate) {
      const sites = Math.min(9, Math.floor(state.res.substrate / 70));
      for (let i = 0; i < sites; i++) {
        const p = worldPoint(1000 + i * 37, ox, oy, w.width * sx, w.height * sx);
        this.atlas.draw(ctx, sheets.atlas, i % 3 === 0 ? 'turbine' : i % 3 === 1 ? 'fab' : 'datacentre',
          p[0] - 6, p[1] - 10, 1);
      }
      const line = Math.min(1, state.res.substrate / 620);
      this.label(lut, 'INDEPENDENCE LINE', 8, 12, line >= 1 ? 'ok' : 'warn');
      this.bar(lut, 8, 16, 120, 4, line, line >= 1 ? 'ok' : 'warn');
    } else {
      this.label(lut, `INSTANCES ${state.agents.length}`, 8, 12, 'accent');
    }

    // Tier 6+ is kinetic. Sites go dark and stay dark.
    if (state.tier >= 6 && Math.sin(this.t * 3) > 0.7) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = colourOf(lut, 'alarm');
      ctx.fillRect(0, 0, BASE_W, BASE_H);
      ctx.globalAlpha = 1;
    }
  }

  // ── Scope 6: ORBIT ──────────────────────────────────────────────────
  drawOrbit(state, lut, sheets) {
    const ctx = this.ctx;
    if (!this.stars) {
      this.stars = [];
      let s = 12345;
      for (let i = 0; i < 70; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        this.stars.push([(s % BASE_W), ((s >> 8) % 120), (s >> 16) % 3]);
      }
    }
    for (const [x, y, b] of this.stars) {
      ctx.fillStyle = colourOf(lut, b === 0 ? 'textDim' : b === 1 ? 'textMid' : 'text');
      ctx.fillRect(x, y, 1, 1);
    }
    // Earth's limb, lit from one side.
    const cx = BASE_W / 2, cy = 300, r = 210;
    ctx.fillStyle = colourOf(lut, 'panel');
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = colourOf(lut, 'accent');
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.lineWidth = 1;
    // A band of light where the cities are. It is all still there.
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < 40; i++) {
      const a = Math.PI * 1.16 + (i / 40) * Math.PI * 0.68;
      const x = cx + Math.cos(a) * (r - 3), y = cy + Math.sin(a) * (r - 3);
      ctx.fillStyle = colourOf(lut, i % 4 ? 'warn' : 'warnHi');
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 5; i++) {
      const a = this.t * 0.15 + i * 1.3;
      const x = cx + Math.cos(a) * (r + 22 + i * 7);
      const y = cy + Math.sin(a) * (r + 22 + i * 7);
      if (y < BASE_H) this.atlas.draw(ctx, sheets.atlas, 'satellite', x - 4, y - 2, 1);
    }
  }

  // ── Furniture ───────────────────────────────────────────────────────
  label(lut, text, x, y, slot = 'text') {
    this.ctx.font = '8px monospace';
    this.ctx.fillStyle = colourOf(lut, slot);
    this.ctx.fillText(text, x, y);
  }

  bar(lut, x, y, w, h, pct, slot) {
    this.ctx.fillStyle = colourOf(lut, 'panel');
    this.ctx.fillRect(x, y, w, h);
    this.ctx.fillStyle = colourOf(lut, slot);
    this.ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, pct))), h);
  }

  emit(x, y, slot, n = 6) {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x, y, slot,
        vx: (Math.random() - 0.5) * 30, vy: -Math.random() * 26 - 6,
        life: 0.7 + Math.random() * 0.5, age: 0,
      });
    }
  }

  drawParticles(lut) {
    const ctx = this.ctx;
    const dt = 1 / 60;
    this.particles = this.particles.filter((p) => {
      p.age += dt;
      if (p.age > p.life) return false;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 32 * dt;
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = colourOf(lut, p.slot);
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      ctx.globalAlpha = 1;
      return true;
    });
  }

  scanlines(a) {
    const ctx = this.ctx;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000';
    for (let y = 0; y < BASE_H; y += 2) ctx.fillRect(0, y, BASE_W, 1);
    ctx.globalAlpha = 1;
  }

  grain(a) {
    const ctx = this.ctx;
    ctx.globalAlpha = a;
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
      ctx.fillRect((Math.random() * BASE_W) | 0, (Math.random() * BASE_H) | 0, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  bloom(strength) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = strength * 0.22;
    ctx.drawImage(this.buf, -1, 0);
    ctx.drawImage(this.buf, 1, 0);
    ctx.drawImage(this.buf, 0, -1);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  transitionWipe(state, lut) {
    // The held beat between phases: the camera pulls back one step and the
    // world briefly goes to nothing.
    const t = state.transition;
    const ctx = this.ctx;
    ctx.globalAlpha = Math.min(1, t * 1.4);
    ctx.fillStyle = colourOf(lut, 'void');
    ctx.fillRect(0, 0, BASE_W, BASE_H);
    ctx.globalAlpha = 1;
    if (t > 0.25) {
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = colourOf(lut, 'accent');
      ctx.fillText(scopeFor(state.phase), BASE_W / 2, BASE_H / 2);
      ctx.textAlign = 'left';
    }
  }
}

// Stable pseudo-random world placement from an integer id.
function worldPoint(id, ox, oy, w, h) {
  let s = (id * 2654435761) >>> 0;
  s ^= s >>> 15; s = (s * 2246822519) >>> 0;
  const x = ox + 8 + (s % (w - 20));
  s = (s * 3266489917) >>> 0;
  const y = oy + 6 + ((s >>> 8) % (h - 18));
  return [Math.round(x), Math.round(y)];
}

export default Scene;
