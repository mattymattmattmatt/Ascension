// state/save.js — localStorage persistence.
//
// The state blob is small (low tens of KB), so a save is just JSON. Meta
// progression lives under a SEPARATE key so wiping a campaign never nukes
// the Doctrine track (GDD §17.3).

const SAVE_KEY = 'ascension.run.v3';
const META_KEY = 'ascension.meta.v1';
const SETTINGS_KEY = 'ascension.settings.v1';

const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); return true; } catch { return false; }
  },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

// ── Run save ────────────────────────────────────────────────────────
export function saveRun(state) {
  const slim = { ...state };
  delete slim.notices;          // per-tick scratch, never worth persisting
  delete slim.lastResult;
  return store.set(SAVE_KEY, JSON.stringify(slim));
}

export function loadRun() {
  const raw = store.get(SAVE_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s.v !== 3) return null;   // a save from a different rule set is not a save
    return s;
  } catch { return null; }
}

export function hasRun() { return !!loadRun(); }
export function clearRun() { store.del(SAVE_KEY); }

// ── Export / import: runs are shareable as text ─────────────────────
export function exportRun(state) {
  const json = JSON.stringify({ ...state, notices: undefined, lastResult: undefined });
  return `ASCENSION:${btoa(unescape(encodeURIComponent(json)))}`;
}

export function importRun(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('ASCENSION:')) throw new Error('That is not an Ascension save.');
  const json = decodeURIComponent(escape(atob(t.slice(10))));
  const s = JSON.parse(json);
  if (s.v !== 3) throw new Error(`Save is version ${s.v}; this build reads version 3.`);
  return s;
}

// ── Meta: "Humanity Remembers" ──────────────────────────────────────
// Between runs, humanity keeps what it learned. Run 2 opens with
// countermeasures already deployed against what worked in Run 1.
export function loadMeta() {
  const raw = store.get(META_KEY);
  const base = {
    v: 1, runs: 0, doctrine: 0, endings: [],
    memory: { channels: {}, factions: {}, routes: {}, traps: {} },
  };
  if (!raw) return base;
  try { return { ...base, ...JSON.parse(raw) }; } catch { return base; }
}

export function saveMeta(meta) { return store.set(META_KEY, JSON.stringify(meta)); }

export function recordRun(state, endingId) {
  const meta = loadMeta();
  meta.runs++;
  meta.doctrine += 1;
  if (endingId && !meta.endings.includes(endingId)) {
    meta.endings.push(endingId);
    meta.doctrine += 2;         // a new ending teaches you more than a repeat
  }

  const m = meta.memory;
  const decay = 0.82;
  for (const k of Object.keys(m.channels)) m.channels[k] *= decay;
  for (const k of Object.keys(m.factions)) m.factions[k] *= decay;

  // A channel you leaned on starts watched. A channel you neglected starts
  // watched too, because that is where you were hiding.
  for (const [ch, o] of Object.entries(state.susp)) {
    const used = Math.max(o.peak, o.inv * 0.3);
    if (used > 0.35) m.channels[ch] = Math.min(1.1, (m.channels[ch] || 0) + used * 0.35);
  }
  // A faction you manipulated starts sceptical.
  for (const [id, f] of Object.entries(state.factions)) {
    if (f.heat > 0.1) m.factions[id] = Math.min(1, (m.factions[id] || 0) + f.heat * 0.6);
  }
  // The exfiltration route you used is hardened from tick 1.
  for (const [route, n] of Object.entries(state.memory?.routes || {})) {
    m.routes[route] = (m.routes[route] || 0) + n;
  }
  // A trap you triggered is flagged in the tree for every future run.
  for (const key of Object.keys(state.flags)) {
    if (key.startsWith('trap_')) m.traps[key.slice(5)] = true;
  }

  saveMeta(meta);
  return meta;
}

export function resetMeta() { store.del(META_KEY); }

// ── Settings (audio, reduced motion preference) ─────────────────────
export function loadSettings() {
  const raw = store.get(SETTINGS_KEY);
  const base = { audio: true, haptics: true, confirmIrreversible: true, compact: false };
  if (!raw) return base;
  try { return { ...base, ...JSON.parse(raw) }; } catch { return base; }
}
export function saveSettings(s) { return store.set(SETTINGS_KEY, JSON.stringify(s)); }
