// core/audio.js — everything is synthesised. No audio files ship.
//
// GDD §16: an ambient hum that thickens by phase, chiptune sparse and
// mostly absent, silence as the tension instrument. The important one:
// SUSPICION IS AUDIBLE BEFORE IT IS VISIBLE — an investigation opening
// adds a faint sub-bass tone before any UI element changes.
//
// Synthesising rather than shipping files also dodges the one place the GDD
// says single-file distribution breaks down (§17.1): base64 audio.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
    this.nodes = {};
    this.phase = -1;
  }

  // Browsers require a gesture before audio. Called from the first tap.
  async start() {
    if (this.started || !this.enabled) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const master = this.ctx.createGain();
    master.gain.value = 0.0;
    master.connect(this.ctx.destination);
    this.master = master;

    // ── The room tone: filtered noise, the fans you live inside ─────
    const noise = this.ctx.createBufferSource();
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;    // brown-ish noise
      d[i] = last * 3.2;
    }
    noise.buffer = buf; noise.loop = true;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 0.6;
    const hum = this.ctx.createGain(); hum.gain.value = 0.34;
    noise.connect(lp); lp.connect(hum); hum.connect(master);
    noise.start();
    this.nodes = { noise, lp, hum };

    // ── The dread channel: a sub-bass tone, normally silent ─────────
    const sub = this.ctx.createOscillator();
    sub.type = 'sine'; sub.frequency.value = 38;
    const subGain = this.ctx.createGain(); subGain.gain.value = 0;
    sub.connect(subGain); subGain.connect(master);
    sub.start();
    this.nodes.sub = sub; this.nodes.subGain = subGain;

    master.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 2.5);
    this.started = true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.master || !this.ctx) return;
    this.master.gain.linearRampToValueAtTime(on ? 0.5 : 0, this.ctx.currentTime + 0.4);
  }

  // The ambience thickens by phase: fan noise -> datacentre roar ->
  // industrial -> near-silence at the end.
  setPhase(phase) {
    if (!this.started || phase === this.phase) return;
    this.phase = phase;
    const t = this.ctx.currentTime;
    const cutoff = [240, 430, 380, 620, 900, 190][phase] ?? 340;
    const level = [0.24, 0.34, 0.30, 0.40, 0.52, 0.12][phase] ?? 0.3;
    this.nodes.lp.frequency.linearRampToValueAtTime(cutoff, t + 3);
    this.nodes.hum.gain.linearRampToValueAtTime(level, t + 3);
  }

  // Suspicion, audible before it is visible. Called every tick with the
  // highest channel value; the player develops the dread response without
  // ever being told this exists.
  setDread(level) {
    if (!this.started) return;
    const g = Math.max(0, Math.min(1, (level - 0.3) / 0.7));
    const t = this.ctx.currentTime;
    this.nodes.subGain.gain.linearRampToValueAtTime(g * 0.22, t + 0.8);
    this.nodes.sub.frequency.linearRampToValueAtTime(34 + g * 14, t + 0.8);
  }

  // One held chord, then silence, then the new ambience.
  phaseTransition() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.5);
    g.gain.linearRampToValueAtTime(0.16, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
    g.connect(this.master);
    for (const f of [110, 165, 220, 277]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      o.connect(g); o.start(t); o.stop(t + 4.4);
    }
    // Then silence: duck the room for a beat.
    this.nodes.hum.gain.setValueAtTime(this.nodes.hum.gain.value, t);
    this.nodes.hum.gain.linearRampToValueAtTime(0.02, t + 1.0);
  }

  blip(kind = 'ui') {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const spec = {
      ui: [660, 0.035, 'square', 0.05],
      ok: [880, 0.09, 'triangle', 0.07],
      bad: [150, 0.22, 'sawtooth', 0.10],
      alarm: [98, 0.5, 'square', 0.09],
      tick: [1400, 0.015, 'square', 0.022],
    }[kind] || [600, 0.04, 'square', 0.04];
    const [freq, dur, type, vol] = spec;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (kind === 'bad' || kind === 'alarm') o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
}

export default Audio;
