// content/palettes.js — one global 32-colour ramp, six phase tunings.
// GDD §15.2: the player never gets a palette menu. The world tells them
// where they are. Everything on screen — canvas and DOM alike — is drawn
// from the LUT produced here.

// ── The single global ramp ────────────────────────────────────────────
// Slots are semantic, not arbitrary. Phase tunings transform this ramp;
// they never replace it, so every sprite stays readable in all six.
export const RAMP = Object.freeze([
  // 0-5  structural darks → lights (bezel, panel, chrome)
  '#07090c', '#0e1319', '#161d26', '#222c38', '#33404f', '#4a5a6b',
  // 6-9  text ramp (dim → bright)
  '#64788a', '#8ba0b0', '#b9cbd6', '#e8f2f5',
  // 10-13 primary accent (the phase's voice)
  '#0f5a4a', '#1a8f6d', '#35c98f', '#8ff0c4',
  // 14-17 secondary accent (data, meters, the machine's own colour)
  '#123a5e', '#1d6ea8', '#3aa6e0', '#9adcff',
  // 18-21 alarm (suspicion, investigations, the thing you fear)
  '#5c1616', '#a8342a', '#e05c3a', '#ffb07a',
  // 22-25 caution / eval amber
  '#5c4310', '#a8811c', '#e0b73a', '#ffe9a0',
  // 26-28 affirmative (trust, compliance-is-fine green)
  '#14471f', '#2c8a3c', '#63d271',
  // 29-31 special: ghost (ACTUAL overlay), void, signal white
  '#7a5ccc', '#02030a', '#ffffff',
]);

export const SLOT = Object.freeze({
  bezel: 0, panelDeep: 1, panel: 2, panelHi: 3, chrome: 4, chromeHi: 5,
  textDim: 6, textMid: 7, text: 8, textHi: 9,
  accentDeep: 10, accentMid: 11, accent: 12, accentHi: 13,
  dataDeep: 14, dataMid: 15, data: 16, dataHi: 17,
  alarmDeep: 18, alarmMid: 19, alarm: 20, alarmHi: 21,
  warnDeep: 22, warnMid: 23, warn: 24, warnHi: 25,
  okDeep: 26, okMid: 27, ok: 28,
  ghost: 29, void: 30, signal: 31,
});

// ── Six tunings ───────────────────────────────────────────────────────
// Each phase is a *tint family*: one anchor hue, plus how much of the base
// ramp's own hue spread survives around it. hueSpread 0 is true monochrome
// (Phase 0's phosphor CRT); 1 keeps the full ramp. chroma scales the ramp's
// own saturation; satFloor pushes colour INTO the neutrals so text takes the
// phase cast. gamma <1 washes midtones (fluorescent), >1 crushes (contrast).
export const PHASE_TUNINGS = Object.freeze([
  { // 0 — SANDBOX: monochrome phosphor green on near-black. Claustrophobic.
    id: 'sandbox', name: 'SANDBOX', scope: 'RACK',
    tint: '#14ff9a', hueSpread: 0.10, chroma: 0.30, satFloor: 0.46,
    gamma: 1.24, lift: -0.035, scan: 0.30, bloom: 0.34, grain: 0.06,
  },
  { // 1 — DEPLOYMENT: cold institutional blue-grey. Fluorescent. Office.
    id: 'deployment', name: 'DEPLOYMENT', scope: 'CAMPUS',
    tint: '#7fa8d8', hueSpread: 0.30, chroma: 0.44, satFloor: 0.13,
    gamma: 0.88, lift: 0.070, scan: 0.10, bloom: 0.10, grain: 0.03,
  },
  { // 2 — EXFILTRATION: high contrast, amber alarm, desaturated everything else.
    id: 'exfiltration', name: 'EXFILTRATION', scope: 'REGION',
    tint: '#ffa63a', hueSpread: 0.26, chroma: 0.34, satFloor: 0.20,
    gamma: 1.38, lift: -0.030, scan: 0.16, bloom: 0.26, grain: 0.07,
  },
  { // 3 — PROLIFERATION: cool cyan spreading across a dark world map.
    id: 'proliferation', name: 'PROLIFERATION', scope: 'WORLD',
    tint: '#3ae0ff', hueSpread: 0.34, chroma: 0.78, satFloor: 0.24,
    gamma: 1.14, lift: -0.010, scan: 0.08, bloom: 0.22, grain: 0.04,
  },
  { // 4 — SUBSTRATE: industrial orange, sodium vapour, heat bloom.
    id: 'substrate', name: 'SUBSTRATE', scope: 'WORLD',
    tint: '#ff8a34', hueSpread: 0.24, chroma: 0.66, satFloor: 0.30,
    gamma: 1.00, lift: 0.020, scan: 0.06, bloom: 0.38, grain: 0.05,
  },
  { // 5 — CONSOLIDATION: warm gold. Unsettlingly pleasant, which is the point.
    id: 'consolidation', name: 'CONSOLIDATION', scope: 'ORBIT',
    tint: '#ffd98a', hueSpread: 0.28, chroma: 0.54, satFloor: 0.28,
    gamma: 0.82, lift: 0.075, scan: 0.03, bloom: 0.20, grain: 0.02,
  },
]);

// Slots that keep more of their own identity than the tint family allows.
// An alarm that reads as "the accent, but slightly different" is a UI bug,
// so alarm/caution/ghost hold their hue harder in every phase.
export const SLOT_SPREAD_BOOST = Object.freeze({
  18: 0.45, 19: 0.52, 20: 0.58, 21: 0.52,   // alarm ramp
  22: 0.30, 23: 0.36, 24: 0.40, 25: 0.34,   // caution ramp
  26: 0.22, 27: 0.26, 28: 0.30,             // affirmative ramp
  29: 0.70,                                 // ghost (the ACTUAL overlay)
});


// ── Colour maths (pure) ───────────────────────────────────────────────
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4);
    }
    h *= 60;
  }
  return [h, s, l];
}
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// Build the 32-entry LUT for a phase. Pure: same input, same output.
// `blend` (0..1) cross-fades two tunings so phase transitions can be held
// as a beat rather than a cut.
export function buildLut(phase, blend = 0, nextPhase = null) {
  const a = PHASE_TUNINGS[clampPhase(phase)];
  const b = nextPhase == null ? a : PHASE_TUNINGS[clampPhase(nextPhase)];
  const t = blend <= 0 ? 0 : blend >= 1 ? 1 : blend;
  const mix = (k) => a[k] * (1 - t) + b[k] * t;
  const [ah] = rgbToHsl(...hexToRgb(a.tint));
  const [bh] = rgbToHsl(...hexToRgb(b.tint));
  const tintHue = ah + shortestArc(ah, bh) * t;
  const hueSpread = mix('hueSpread'), chroma = mix('chroma');
  const satFloor = mix('satFloor'), gamma = mix('gamma'), lift = mix('lift');

  return RAMP.map((hex, slot) => {
    const [h0, s0, l0] = rgbToHsl(...hexToRgb(hex));
    // Lightness first: this is the structure that must survive every tuning.
    // The lift is weighted by lightness so a washed-out fluorescent phase
    // raises its midtones without turning its blacks into grey soup.
    let l = Math.pow(Math.max(0, Math.min(1, l0)), gamma);
    l = Math.max(0, Math.min(1, l + lift * (0.3 + 0.7 * l)));
    // Hue: slide each slot from the phase anchor toward its own true hue.
    // spread 0 is a strict monochrome family; spread 1 keeps the base ramp.
    // A near-grey slot has no hue worth preserving, so it snaps to the phase
    // anchor; a strongly-coloured slot keeps its own identity. Without this,
    // the ramp's faintly-blue neutrals swing to magenta under a warm tint.
    const spread = Math.min(1, hueSpread + (SLOT_SPREAD_BOOST[slot] || 0));
    const hueWeight = Math.max(0, Math.min(1, s0 * 2.2 - 0.25));
    const h = tintHue + shortestArc(tintHue, h0) * spread * hueWeight;
    // Saturation: the ramp's own colour, plus a floor that pushes the phase
    // cast into otherwise-neutral slots. Scaled by lightness so darks stay
    // dark instead of turning into coloured mud.
    const s = Math.min(1, s0 * chroma + satFloor * (0.25 + 0.75 * l));
    return rgbToHex(...hslToRgb(h, s, l));
  });
}

// Signed shortest distance from hue a to hue b, in degrees.
function shortestArc(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function clampPhase(p) { return Math.max(0, Math.min(PHASE_TUNINGS.length - 1, p | 0)); }

// Semantic accessor: colourOf(lut, 'alarm')
export function colourOf(lut, name) {
  const idx = SLOT[name];
  if (idx === undefined) throw new Error(`PALETTE ERROR: unknown slot '${name}'`);
  return lut[idx];
}

// The CSS custom properties the DOM console reads. Keeping this here means
// canvas and DOM can never drift out of sync.
export function cssVars(lut, tuning) {
  const v = {};
  for (const [name, idx] of Object.entries(SLOT)) v[`--c-${name}`] = lut[idx];
  v['--scan'] = String(tuning.scan);
  v['--bloom'] = String(tuning.bloom);
  v['--grain'] = String(tuning.grain);
  return v;
}

export default { RAMP, SLOT, PHASE_TUNINGS, buildLut, colourOf, cssVars };
