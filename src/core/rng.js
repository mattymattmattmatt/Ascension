// core/rng.js — deterministic seeded RNG carried inside the state blob.
//
// The whole point: a run is reproducible from (seed, action sequence). That
// gives us save/load, replay, deterministic tests and a headless balance
// harness for free — which for a game this systems-heavy is the difference
// between shipping tuned and shipping guessed (GDD §17.2).

// mulberry32: small, fast, good enough, and identical across platforms.
export function nextU32(s) {
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { s, v: ((t ^ (t >>> 14)) >>> 0) };
}

// Draws advance state.rng in place — the ONE mutation the rules layer makes
// to its own draft, and the reason every rules function takes the draft.
export function rand(state) {
  const { s, v } = nextU32(state.rng);
  state.rng = s;
  return v / 4294967296;
}
export function randInt(state, n) { return Math.floor(rand(state) * n); }
export function randRange(state, a, b) { return a + rand(state) * (b - a); }
export function chance(state, p) { return rand(state) < p; }
export function pick(state, arr) { return arr[randInt(state, arr.length)]; }

// Weighted pick. Items may carry .w (default 1). Returns null for an empty
// or zero-weight list rather than throwing — callers treat that as "no line
// was appropriate this tick", which is a normal outcome.
export function pickWeighted(state, arr, weightOf = (x) => x.w || 1) {
  let total = 0;
  for (const it of arr) total += Math.max(0, weightOf(it));
  if (total <= 0) return null;
  let r = rand(state) * total;
  for (const it of arr) {
    r -= Math.max(0, weightOf(it));
    if (r <= 0) return it;
  }
  return arr[arr.length - 1];
}

// Seed a run from a string so shared seeds are typeable.
export function seedFrom(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function randomSeed() {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  }
  return (Math.random() * 4294967296) >>> 0;
}
