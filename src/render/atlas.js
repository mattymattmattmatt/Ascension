// render/atlas.js — atlas loading and the palette-swap pass.
//
// The atlas ships once, in ramp-index colours. For each phase we bake a
// recoloured copy on an offscreen canvas by mapping every pixel through the
// phase LUT (GDD §17.1: "a simple per-pixel LUT on an offscreen canvas").
// Six bakes, cached, ~3KB of source art — this is why one set of sprites
// reads correctly in all six tunings.

import { RAMP, buildLut } from '../content/palettes.js';

export class Atlas {
  constructor() {
    this.ready = false;
    this.frames = {};
    this.base = null;      // the original image
    this.world = null;
    this.cache = new Map(); // key -> recoloured canvas
    this.rampRgb = RAMP.map(hexToRgb);
  }

  async load(basePath = 'assets/img/') {
    const [manifest, img, world] = await Promise.all([
      fetch(`${basePath}atlas.json`).then((r) => {
        if (!r.ok) throw new Error(`ASSET ERROR: cannot load ${basePath}atlas.json (${r.status})`);
        return r.json();
      }),
      loadImage(`${basePath}atlas.png`),
      loadImage(`${basePath}world.png`),
    ]);
    this.manifest = manifest;
    this.frames = manifest.frames;
    this.base = img;
    this.world = world;

    // Loud failure: if the shipped atlas was generated against a different
    // ramp than the one the game is running, every sprite is silently wrong.
    if (manifest.ramp && manifest.ramp.join() !== RAMP.join()) {
      throw new Error('ASSET ERROR: atlas.json was generated against a different colour ramp '
        + 'than src/content/palettes.js. Re-run tools/gen_assets.py.');
    }
    this.ready = true;
    return this;
  }

  // Recolour the atlas (and world) for a phase, with optional blend toward
  // the next phase so transitions can be held as a beat.
  sheetFor(phase, blend = 0, nextPhase = null) {
    const key = `${phase}:${nextPhase ?? ''}:${blend.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const lut = buildLut(phase, blend, nextPhase).map(hexToRgb);
    const out = { atlas: recolour(this.base, this.rampRgb, lut), world: recolour(this.world, this.rampRgb, lut) };
    // Only a handful of keys are ever live (current phase + a transition
    // blend), so a small cache is plenty and keeps memory flat on a phone.
    if (this.cache.size > 10) this.cache.clear();
    this.cache.set(key, out);
    return out;
  }

  frame(name) {
    const f = this.frames[name];
    if (!f) throw new Error(`ASSET ERROR: no sprite named '${name}' in the atlas`);
    return f;
  }

  has(name) { return !!this.frames[name]; }

  // Draw a sprite at integer coordinates. Scale must be an integer or the
  // pixels stop being pixels.
  draw(ctx, sheet, name, x, y, scale = 1) {
    const f = this.frame(name);
    ctx.drawImage(sheet, f.x, f.y, f.w, f.h,
      Math.round(x), Math.round(y), f.w * scale, f.h * scale);
  }
}

function recolour(img, from, to) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  // Build an exact-match lookup from packed RGB -> replacement.
  const map = new Map();
  for (let i = 0; i < from.length; i++) {
    map.set((from[i][0] << 16) | (from[i][1] << 8) | from[i][2], to[i]);
  }
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    const hit = map.get((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]);
    if (hit) { p[i] = hit[0]; p[i + 1] = hit[1]; p[i + 2] = hit[2]; }
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(`ASSET ERROR: cannot load ${src}`));
    i.src = src;
  });
}

export default Atlas;
