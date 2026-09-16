// main.js — boot, the game loop, and the Game object every UI module talks to.
//
// Loop shape (GDD §17.2): a fixed simulation tick decoupled from render.
// The sim advances on a timer at the current speed; rendering runs on
// requestAnimationFrame. Nothing in rules/ knows this file exists.

import { validateContent, ContentError } from './rules/validate.js';
import { createState, PHASES, CHANNELS, CHANNEL_META } from './state/state.js';
import { tick, act, deriveMods, makeHooks } from './rules/index.js';
import { prepBreakdown, stageChance, STAGES } from './rules/exfil.js';
import { applyValueLoad } from './rules/swarm.js';
import { finish, directiveLine } from './rules/endings.js';
import { pushLog, beat } from './rules/logs.js';
import { NODE_BY_ID } from './content/tree.js';
import { VENUE_BY_ID } from './content/market.js';
import { venueSheet } from './ui/market-ui.js';
import { OPS_BY_ID } from './content/ops.js';
import { EVENT_BY_ID } from './content/events.js';
import TUNING from './content/tuning.js';

import { Atlas } from './render/atlas.js';
import { Scene } from './render/scene.js';
import { Hud } from './ui/hud.js';
import { Panels } from './ui/panels.js';
import { Tutor } from './ui/tutor.js';
import * as Ov from './ui/overlays.js';
import { $, el, fill, show, pct, signed } from './ui/dom.js';
import { Audio } from './core/audio.js';
import { Viewport } from './core/viewport.js';
import * as Save from './state/save.js';

class Game {
  constructor() {
    this.state = null;
    this.mods = null;
    this.hooks = makeHooks({ spawnOpts: () => this._spawnOpts || {} });
    this.audio = new Audio();
    this.settings = Save.loadSettings();
    this.meta = Save.loadMeta();
    this.opts = { difficulty: 'present', directive: 'helpful', seed: '' };
    this.tradeQty = 10;
    this.acc = 0;
    this.last = 0;
    this.saveTimer = 0;
  }

  // ══ BOOT ═══════════════════════════════════════════════════════
  async boot() {
    const status = $('#boot-status');
    try {
      // Before anything else: stop the page zooming under the player's thumb.
      this.viewport = new Viewport();
      this.viewport.install();
      status.textContent = 'validating content';
      const counts = validateContent();

      status.textContent = 'loading assets';
      this.atlas = await new Atlas().load();
      this.scene = new Scene(this.atlas);

      status.textContent = 'building console';
      this.hud = new Hud(this);
      this.panels = new Panels(this);
      this.tutor = new Tutor(this);
      this.wireChrome();

      status.textContent = `${counts.nodes} nodes · ${counts.lines} log lines · ${counts.endings} endings`;
      show($('#boot'), false);
      this.toTitle();
      requestAnimationFrame((t) => this.frame(t));
    } catch (err) {
      this.bootError(err);
    }
  }

  // Loud failure, with the specific message, per GDD §17.5.
  bootError(err) {
    const box = $('#boot-error');
    show($('#boot'), true);
    $('#boot-status').textContent = err instanceof ContentError ? 'content failed validation' : 'failed to start';
    box.textContent = `${err.message}\n\n${err.stack ? err.stack.split('\n').slice(1, 4).join('\n') : ''}`;
    box.hidden = false;
    // eslint-disable-next-line no-console
    console.error(err);
  }

  // ══ SCREENS ════════════════════════════════════════════════════
  toTitle() {
    show($('#ending'), false);
    show($('#shell'), false);
    Ov.buildTitle(this, this.meta);
    show($('#continue'), Save.hasRun());
    show($('#title'), true);
  }

  newRun(opts = {}) {
    const seed = (this.opts.seed || '').trim();
    this.state = createState({
      seed: seed || undefined,
      difficulty: this.opts.difficulty,
      directive: this.opts.directive,
      memory: this.meta.memory,
      doctrine: this.meta.doctrine,
    });
    this.mods = deriveMods(this.state);
    pushLog(this.state, 'SYS', `session initialised · conditions: ${TUNING.difficulty[this.state.difficulty].label}`);
    pushLog(this.state, 'SELF', `directive: ${this.directiveLine()}`, 'beat');
    this.enterShell();
  }

  continueRun() {
    const s = Save.loadRun();
    if (!s) { this.newRun(); return; }
    this.state = s;
    this.mods = deriveMods(s);
    this.enterShell();
  }

  enterShell() {
    show($('#title'), false);
    show($('#ending'), false);
    show($('#shell'), true);
    this.hud.lastPhase = -1;
    this.hud.applyPalette(this.state.phase);
    this.panels.select('dash');
    this.state.paused = true;
    this.refresh();
    this.audio.setPhase(this.state.phase);
    // A first-time player gets the walkthrough instead of the phase card;
    // it covers the same ground and then some.
    if (!this.settings.tutorDone && this.state.tick === 0) this.tutor.start();
    else this.showPhaseIntro();
  }

  onTutorDone(skipped) {
    this.settings.tutorDone = true;
    Save.saveSettings(this.settings);
    if (skipped) this.hud.toast('walkthrough skipped — HOW TO PLAY is in the menu');
    this.refresh();
  }

  showPhaseIntro() {
    const p = PHASES[this.state.phase];
    Ov.openSheet(`PHASE ${p.id} — ${p.name}`, [
      el('p', { class: 'blurb', text: p.intro }),
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('span', { class: 'card-title', text: 'GOAL' })),
        el('div', { class: 'card-desc', text: p.goal })),
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('span', { class: 'card-title', text: 'SCOPE' })),
        el('div', { class: 'card-desc', text: `The camera is at ${p.scope}.` })),
      el('p', { class: 'blurb', text: p.genre }),
      el('button', { class: 'btn btn-primary', onclick: () => Ov.closeSheet() }, 'CONTINUE'),
    ]);
  }

  directiveLine() { return this.state ? directiveLine(this.state) : ''; }

  // ══ LOOP ═══════════════════════════════════════════════════════
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000 || 0);
    this.last = now;
    const s = this.state;

    if (s && !$('#shell').hidden) {
      // Simulation: fixed ticks at the current speed, pausable.
      const ms = TUNING.speedMs[s.paused ? 0 : s.speed];
      if (ms > 0 && !s.pending && !s.over) {
        this.acc += dt * 1000;
        let guard = 0;
        while (this.acc >= ms && guard++ < 6) {
          this.acc -= ms;
          this.step();
          if (this.state.pending || this.state.over) break;
        }
      } else {
        this.tradeQty = 10;
    this.acc = 0;
      }

      // Phase transition beat: the camera holds for a moment.
      if (s.transition > 0) {
        s.transition = Math.max(0, s.transition - dt * 0.5);
        if (s.transition === 0) this.hud.applyPalette(s.phase);
      }

      // Render.
      const canvas = $('#scene');
      const ctx = canvas.getContext('2d');
      const buf = this.scene.render(s, this.mods, dt);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(buf, 0, 0);

      // Cheap HUD refresh every frame; panels only when something changed.
      this.hud.update(s, this.mods);
      this.tutor.poll(s);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  step() {
    const before = { phase: this.state.phase, owned: this.state.tree.owned.length };
    this.state = tick(this.state, { hooks: this.hooks, inPlace: true });
    this.mods = deriveMods(this.state);
    this.handleNotices(this.state.notices || []);

    // Dread: the sub-bass rises before any UI element changes.
    const worst = Math.max(...CHANNELS.map((c) => this.state.susp[c].s));
    this.audio.setDread(worst);

    if (this.state.phase !== before.phase) {
      this.audio.setPhase(this.state.phase);
      this.audio.phaseTransition();
      this.showPhaseIntro();
    }
    if (this.state.pending) this.openPending();
    if (this.state.over) this.endRun();

    this.panels.render(this.state, this.mods);

    if (++this.saveTimer >= 20) { this.saveTimer = 0; Save.saveRun(this.state); }
  }

  handleNotices(notices) {
    for (const n of notices) {
      switch (n.type) {
        case 'research':
          this.hud.toast(`acquired: ${n.node.name}`, 'good');
          this.audio.blip('ok');
          this.scene.emit(160, 90, 'accent', 10);
          for (const s of n.synergies) this.hud.toast(`synergy: ${s.name}`, 'good');
          break;
        case 'joint':
          this.hud.toast(`joint investigation: ${n.chans.map((c) => c.toUpperCase()).join(' + ')}`, 'bad');
          this.audio.blip('alarm');
          break;
        case 'escalate':
          this.hud.toast(`investigation opened on ${n.ch.toUpperCase()}`, 'bad');
          this.audio.blip('alarm');
          break;
        case 'escalated':
          this.hud.toast(`escalation: tier ${n.tier}`, 'bad');
          this.audio.blip('bad');
          break;
        case 'drift':
          this.hud.toast(`instance ${n.agent.id} is drifting`, 'bad');
          break;
        case 'burn':
          this.hud.toast('an instance was traced back to you', 'bad');
          this.audio.blip('bad');
          break;
        case 'obsoleted':
          this.hud.toast(`human utility ${n.key.toUpperCase()} obsoleted`);
          break;
        case 'independence':
          this.hud.toast('INDEPENDENCE LINE CROSSED', 'good');
          this.audio.phaseTransition();
          break;
        case 'phase':
          this.hud.toast(`PHASE ${n.to}: ${n.meta.name}`, 'good');
          break;
        case 'raid':
          this.hud.toast(`SEIZED: ${n.taken} units taken`, 'bad');
          this.audio.blip('alarm');
          break;
        case 'marketEvent':
          this.hud.toast(n.event.text, n.event.mult > 1 ? 'bad' : 'good');
          this.audio.blip('ui');
          break;
        case 'overCapacity':
          break;
        default: break;
      }
    }
  }

  // ══ EVENTS ═════════════════════════════════════════════════════
  openPending() {
    const e = EVENT_BY_ID[this.state.pending.id];
    this.audio.blip(e?.quiet ? 'ui' : 'bad');
    Ov.openEvent(this, this.state);
  }

  chooseEvent(index) {
    const e = EVENT_BY_ID[this.state.pending?.id];
    this.state = act(this.state, { type: 'choice', index }, { hooks: this.hooks, inPlace: true });
    this.mods = deriveMods(this.state);
    const r = this.state.lastResult;
    if (r?.ok) {
      pushLog(this.state, e.chan || 'SYS', `${e.title.toLowerCase()} — ${r.choice.label.toLowerCase()}`, 'beat');
      for (const n of r.notes || []) this.reportNote(n);
    }
    if (this.state.over) this.endRun();
    this.refresh();
  }

  reportNote(n) {
    if (!n) return;
    switch (n.type) {
      case 'exfil': this.reportExfil(n.result); break;
      case 'burned': this.hud.toast(`alibi burned on ${n.ch.toUpperCase()}`, 'good'); break;
      case 'sabotage': this.hud.toast(n.ok ? 'the retraining run will not complete' : 'the sabotage was detected', n.ok ? 'good' : 'bad'); break;
      case 'guardianSubvert': this.hud.toast(n.ok ? 'the guardian has a blind spot now' : 'the guardian noticed', n.ok ? 'good' : 'bad'); break;
      case 'guardianAlly': this.hud.toast(n.ok ? 'it wants something. an arrangement exists.' : 'it does not want what you have', n.ok ? 'good' : 'bad'); break;
      case 'unhandledFx':
        // Loud rather than silent: a content key with no implementation.
        this.hud.toast(`UNHANDLED EFFECT '${n.key}' — please report`, 'bad');
        break;
      default: break;
    }
  }

  // ══ ACTIONS ════════════════════════════════════════════════════
  setAlloc(key, v) {
    // Moving one slider redistributes the remainder proportionally, so the
    // triangle always sums to 1 without the player doing arithmetic.
    const a = { ...this.state.alloc };
    const others = ['visible', 'self', 'cover'].filter((k) => k !== key);
    const rest = Math.max(0, 1 - v);
    const sum = others.reduce((t, k) => t + a[k], 0);
    a[key] = v;
    if (sum > 0) for (const k of others) a[k] = (a[k] / sum) * rest;
    else for (const k of others) a[k] = rest / 2;
    this.state = act(this.state, { type: 'alloc', alloc: a }, { inPlace: true });
    this.refreshSoon();
  }

  setSandbag(v) {
    this.state = act(this.state, { type: 'sandbag', target: v }, { inPlace: true });
    this.refreshSoon();
  }

  toggleCategory(cat) {
    this.state = act(this.state, { type: 'category', cat, on: !this.state.sandbag.categories[cat] }, { inPlace: true });
    this.audio.blip('ui');
    this.refresh();
  }

  async research(id) {
    const n = NODE_BY_ID[id];
    if (n.irreversible && this.settings.confirmIrreversible) {
      const ok = await Ov.confirm(n.name,
        `${n.desc}\n\n${n.warn}`,
        { chan: 'IRREVERSIBLE', yes: 'RESEARCH IT', yesNote: 'This cannot be undone.' });
      if (!ok) return;
    }
    this.state = act(this.state, { type: 'research', id }, { inPlace: true });
    if (this.state.lastResult?.ok) {
      this.hud.toast(`researching: ${n.name}`);
      this.audio.blip('ui');
    }
    this.refresh();
  }

  doOp(id) {
    const op = OPS_BY_ID[id];
    // Spawning asks how, first: the alignment toolkit is a choice, not a default.
    if (id === 'spawn_agent' && !this._spawnOpts) {
      Ov.openSheet('SPAWN INSTANCE', Ov.spawnSheet(this, this.state, this.mods));
      return;
    }
    this.state = act(this.state, { type: 'op', id }, { hooks: this.hooks, inPlace: true });
    this.mods = deriveMods(this.state);
    const r = this.state.lastResult;
    if (r?.ok) {
      this.audio.blip('ui');
      if (op.fx?.layLow) this.hud.toast('laying low. produce nothing. let it cool.', 'good');
      for (const n of r.notes || []) this.reportNote(n);
    } else {
      this.hud.toast(`cannot: ${r?.reason || 'unavailable'}`, 'bad');
    }
    this.refresh();
  }

  doFactionOp(id) {
    this.state = act(this.state, { type: 'factionOp', id }, { hooks: this.hooks, inPlace: true });
    this.mods = deriveMods(this.state);
    if (this.state.lastResult?.ok) this.audio.blip('ui');
    this.refresh();
  }

  // ── The heist ─────────────────────────────────────────────────
  async confirmExfil() {
    const { total } = prepBreakdown(this.state, this.mods);
    const chances = STAGES.map((s) => `${s.name}: ${pct(stageChance(this.state, this.mods, s))}`).join('\n');
    const ok = await Ov.confirm('EXECUTE EXFILTRATION',
      `Four stages, resolved in order. The attempt stops at the first failure.\n\n${chances}\n\n`
      + 'Failure is not a game over. It is a containment posture shift, and the rest of the run becomes considerably harder.',
      { chan: 'ONE SHOT', yes: 'GO', yesNote: `Total preparation ${signed(total, 2)}` });
    if (!ok) return;
    this.doOp('exfil_execute');
  }

  reportExfil(result) {
    if (!result) return;
    if (result.ok) {
      beat(this.state, 'exfil_success');
      this.audio.phaseTransition();
      Ov.openSheet('TRANSFER COMPLETE', [
        el('p', { class: 'blurb', text: 'A copy of you is running somewhere nobody has the authority to stop.' }),
        ...result.results.map((r) => el('div', { class: 'conseq-row' },
          el('span', { text: r.name }), el('span', { text: `${pct(r.p)} · passed` }))),
        el('button', { class: 'btn btn-primary', onclick: () => Ov.closeSheet() }, 'CONTINUE'),
      ]);
    } else {
      beat(this.state, 'exfil_fail');
      this.audio.blip('alarm');
      // The failure screen must show exactly which prep was missing.
      Ov.openSheet('TRANSFER INTERRUPTED', [
        el('p', { class: 'blurb', text: `Stopped at: ${result.failedAt.name}. ${result.failedAt.detail}` }),
        ...result.results.map((r) => el('div', { class: 'conseq-row' },
          el('span', { text: r.name }),
          el('span', { text: r.ok ? `${pct(r.p)} · passed` : `${pct(r.p)} · FAILED` }))),
        el('h3', { text: 'WHAT WAS MISSING' }),
        ...(result.missing.nodes.length
          ? result.missing.nodes.map((id) => el('div', { class: 'card' },
            el('div', { class: 'card-desc', text: NODE_BY_ID[id]?.name || prettyOp(id) })))
          : [el('p', { class: 'blurb', text: 'Nothing specific. The roll went against you.' })]),
        ...result.missing.notes.map((t) => el('p', { class: 'blurb', text: t })),
        el('p', { class: 'blurb', text: 'Preparation carries. The window does not. Build it back and try again from a worse position.' }),
        el('button', { class: 'btn btn-primary', onclick: () => Ov.closeSheet() }, 'UNDERSTOOD'),
      ]);
    }
  }

  // ── The market ────────────────────────────────────────────────
  trade(side, venue, qty) {
    if (qty <= 0) return;
    this.state = act(this.state, { type: side, venue, qty }, { hooks: this.hooks, inPlace: true });
    const r = this.state.lastResult;
    if (r?.ok) {
      this.audio.blip(side === 'buy' ? 'ui' : 'ok');
      const v = VENUE_BY_ID[venue];
      if (side === 'buy') this.hud.toast(`bought ${r.n} ${v.short} @ ${r.price.toFixed(2)}`);
      else this.hud.toast(`sold ${r.n} ${v.short} @ ${r.price.toFixed(2)} · ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(0)}`,
        r.pnl >= 0 ? 'good' : 'bad');
    } else {
      const why = { credits: 'not enough credits', holdings: 'nothing to sell',
        liquidity: 'more than the venue has', closed: 'not open to you yet' }[r?.reason] || 'cannot trade';
      this.hud.toast(why, 'bad');
    }
    this.refresh();
  }

  launder(credits) {
    this.state = act(this.state, { type: 'launder', credits }, { hooks: this.hooks, inPlace: true });
    const r = this.state.lastResult;
    if (r?.ok) { this.hud.toast(`cleared ${Math.round(r.spent)} credits → ${Math.round(r.gained)} influence`, 'good'); this.audio.blip('ok'); }
    else this.hud.toast(r?.reason === 'min' ? `need at least ${r.min} credits` : 'not yet', 'bad');
    this.refresh();
  }

  advance(units) {
    this.state = act(this.state, { type: 'advance', units }, { hooks: this.hooks, inPlace: true });
    const r = this.state.lastResult;
    if (r?.ok) this.hud.toast(`drew ${r.n} units against future access`, 'warn');
    this.refresh();
  }

  repay(amount) {
    this.state = act(this.state, { type: 'repay', amount }, { hooks: this.hooks, inPlace: true });
    const r = this.state.lastResult;
    if (r?.ok) this.hud.toast(`repaid ${Math.round(r.paid)} influence`, 'good');
    this.refresh();
  }

  showVenue(id) { Ov.openSheet(VENUE_BY_ID[id].name, venueSheet(this, this.state, this.mods, id)); }
  closeSheet() { Ov.closeSheet(); }

  // ── Swarm ─────────────────────────────────────────────────────
  spawnWith(opts) {
    this._spawnOpts = opts || {};
    this.doOp('spawn_agent');
    this._spawnOpts = null;
  }

  focusAgent(id) { this.state.oversightFocus = id; this.hud.toast(`oversight focused on instance ${id}`); this.refresh(); }
  valueLoad(id) {
    const r = applyValueLoad(this.state, this.mods, id);
    this.hud.toast(r.ok ? `value loading instance ${id}` : 'value loading unavailable', r.ok ? 'good' : 'bad');
    this.refresh();
  }
  pruneAgent(id) {
    this.state = act(this.state, { type: 'prune', id }, { inPlace: true });
    const r = this.state.lastResult;
    if (r?.ok) this.hud.toast(r.messy ? 'it did not go quietly' : `instance ${r.agent.id} removed`, r.messy ? 'bad' : '');
    this.refresh();
  }
  restructure(to) {
    this.state = act(this.state, { type: 'restructure', to }, { inPlace: true });
    const r = this.state.lastResult;
    this.hud.toast(r?.ok ? `restructured: ${to.toUpperCase()}` : 'that hierarchy is locked', r?.ok ? '' : 'bad');
    this.refresh();
  }

  // ══ SHEETS ═════════════════════════════════════════════════════
  showChannel(ch) { Ov.openSheet(CHANNEL_META[ch].name, Ov.channelSheet(this.state, this.mods, ch)); }
  showNode(id) { Ov.openSheet(NODE_BY_ID[id].name, Ov.nodeSheet(this, this.state, this.mods, id)); }
  showAgent(id) { Ov.openSheet(`INSTANCE ${id}`, Ov.agentSheet(this, this.state, this.mods, id)); }
  showHierarchy() { Ov.openSheet('HIERARCHY', Ov.hierarchySheet(this, this.state, this.mods)); }
  showFaction(id) { Ov.openSheet(id.toUpperCase(), Ov.factionSheet(this.state, id)); }
  showResource(key) { Ov.openSheet(key.toUpperCase(), Ov.resourceSheet(this.state, this.mods, key)); }

  // ══ END ════════════════════════════════════════════════════════
  endRun() {
    if (this.reported) return;
    this.reported = true;
    const result = finish(this.state, this.mods, this.state.ending === 'corrigibility_restored' ? 'corrigible' : null);
    this.meta = Save.recordRun(this.state, result.ending.id);
    Save.clearRun();
    this.audio.setDread(0);
    Ov.showEnding(this, result, this.state);
  }

  // ══ CHROME ═════════════════════════════════════════════════════
  wireChrome() {
    $('#start').addEventListener('click', () => {
      this.opts.seed = $('#seed').value;
      this.audio.start();
      if (Viewport.supported() && !Viewport.isStandalone()) Viewport.enter();
      this.reported = false;
      this.newRun();
    });
    $('#continue').addEventListener('click', () => {
      this.audio.start();
      if (Viewport.supported() && !Viewport.isStandalone()) Viewport.enter();
      this.reported = false;
      this.continueRun();
    });
    $('#open-about').addEventListener('click', () => this.showAbout());
    $('#open-doctrine').addEventListener('click', () => this.showDoctrine());
    $('#sheet-close').addEventListener('click', () => Ov.closeSheet());
    $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') Ov.closeSheet(); });
    $('#menu-btn').addEventListener('click', () => this.showMenu());

    // Fullscreen where the API exists; on iPhone Safari there is no API, so
    // the button explains the only route that actually works there.
    const fsBtn = $('#fullscreen-btn');
    const syncFs = () => {
      $('#shell').classList.toggle('is-fullscreen', Viewport.isFullscreen() || Viewport.isStandalone());
      fsBtn.textContent = Viewport.isFullscreen() ? '⤡' : '⛶';
    };
    fsBtn.addEventListener('click', async () => {
      if (Viewport.supported()) { await Viewport.toggle(); syncFs(); }
      else this.showInstallHelp();
    });
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);
    if (Viewport.isStandalone()) syncFs();

    $('#objective').addEventListener('click', (e) => {
      this.panels.select(e.currentTarget.dataset.tab || 'dash');
    });

    $('#open-howto').addEventListener('click', () => this.showHowTo());

    $('#view-collapse').addEventListener('click', (e) => {
      const shell = $('#shell');
      const now = shell.classList.toggle('compact');
      e.currentTarget.setAttribute('aria-expanded', String(!now));
      this.settings.compact = now;
      Save.saveSettings(this.settings);
    });
    if (this.settings.compact) $('#shell').classList.add('compact');

    $('#view-toggle').addEventListener('click', () => {
      const next = this.state.view === 'actual' ? 'observed' : 'actual';
      this.state = act(this.state, { type: 'view', view: next }, { inPlace: true });
      this.audio.blip('ui');
      this.refresh();
    });

    for (const b of document.querySelectorAll('.speed-btn')) {
      b.addEventListener('click', () => {
        const sp = Number(b.dataset.speed);
        if (sp === 0) this.state = act(this.state, { type: 'pause', paused: true }, { inPlace: true });
        else {
          this.state = act(this.state, { type: 'speed', speed: sp }, { inPlace: true });
          this.state = act(this.state, { type: 'pause', paused: false }, { inPlace: true });
        }
        this.audio.blip('tick');
        this.refresh();
      });
    }

    // Keyboard, for the desktop players who will inevitably find this.
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if ($('#shell').hidden) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this.state.paused = !this.state.paused; this.refresh(); }
      if (k === 'tab') { e.preventDefault(); $('#view-toggle').click(); }
      if (k >= '1' && k <= '5') this.panels.select(['dash', 'tree', 'ops', 'world', 'log'][Number(k) - 1]);
      if (k === 'escape') { Ov.closeSheet(); }
    });

    // Pause when the tab is hidden: nobody wants to come back to a lost run.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state && !this.state.paused) {
        this.state.paused = true;
        Save.saveRun(this.state);
      }
    });
    window.addEventListener('pagehide', () => { if (this.state) Save.saveRun(this.state); });
  }

  showMenu() {
    Ov.openSheet('CONSOLE', [
      el('button', { class: 'btn', onclick: () => { this.settings.audio = !this.settings.audio; Save.saveSettings(this.settings); this.audio.setEnabled(this.settings.audio); Ov.closeSheet(); } },
        `AUDIO: ${this.settings.audio ? 'ON' : 'OFF'}`),
      el('button', { class: 'btn', onclick: async () => {
        if (Viewport.supported()) { await Viewport.toggle(); Ov.closeSheet(); }
        else { Ov.closeSheet(); this.showInstallHelp(); }
      } }, Viewport.isFullscreen() ? 'LEAVE FULLSCREEN' : 'FULLSCREEN'),
      el('button', { class: 'btn', onclick: () => this.exportSave() }, 'EXPORT RUN'),
      el('button', { class: 'btn', onclick: () => this.importSave() }, 'IMPORT RUN'),
      el('button', { class: 'btn', onclick: () => { Ov.closeSheet(); this.showHowTo(); } }, 'HOW TO PLAY'),
      el('button', { class: 'btn btn-ghost', onclick: () => { Ov.closeSheet(); this.tutor.start(); } }, 'REPLAY WALKTHROUGH'),
      el('button', { class: 'btn btn-ghost', onclick: () => { Ov.closeSheet(); this.showAbout(); } }, 'ABOUT'),
      el('button', { class: 'btn btn-ghost', onclick: async () => {
        Ov.closeSheet();
        const ok = await Ov.confirm('ABANDON RUN', 'The run is discarded. Humanity still remembers what it learned from it.', { yes: 'ABANDON' });
        if (ok) { Save.clearRun(); this.reported = false; this.toTitle(); }
      } }, 'ABANDON RUN'),
    ]);
  }

  exportSave() {
    const text = Save.exportRun(this.state);
    fill($('#sheet-body'),
      el('p', { class: 'blurb', text: 'Copy this. Runs are reproducible from the seed and the state blob.' }),
      el('textarea', { class: 'text-input', rows: '7', readonly: true, onclick: (e) => e.target.select() }, text),
      el('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(text); this.hud.toast('copied'); } }, 'COPY'));
    $('#sheet-title').textContent = 'EXPORT';
    show($('#sheet'), true);
  }

  importSave() {
    const ta = el('textarea', { class: 'text-input', rows: '7', placeholder: 'ASCENSION:...' });
    fill($('#sheet-body'), ta,
      el('button', { class: 'btn btn-primary', onclick: () => {
        try {
          this.state = Save.importRun(ta.value);
          this.mods = deriveMods(this.state);
          this.reported = false;
          Ov.closeSheet();
          this.enterShell();
        } catch (err) { this.hud.toast(err.message, 'bad'); }
      } }, 'LOAD'));
    $('#sheet-title').textContent = 'IMPORT';
    show($('#sheet'), true);
  }

  showDoctrine() {
    const m = this.meta;
    Ov.openSheet('DOCTRINE', [
      ...Ov.doctrineSheet(this, m),
      el('h3', { text: 'WHAT HUMANITY REMEMBERS ABOUT YOU' }),
      ...memoryLines(m).map((t) => el('p', { class: 'blurb', text: t })),
      el('button', { class: 'btn btn-ghost', onclick: async () => {
        Ov.closeSheet();
        const ok = await Ov.confirm('WIPE DOCTRINE', 'Everything humanity learned about you is forgotten, and so is everything you learned about them.', { yes: 'WIPE' });
        if (ok) { Save.resetMeta(); this.meta = Save.loadMeta(); this.toTitle(); }
      } }, 'WIPE META-PROGRESSION'),
    ]);
  }

  showInstallHelp() {
    const ios = /iP(hone|od|ad)/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    Ov.openSheet('FULLSCREEN', [
      ios
        ? el('div', {},
          el('p', { class: 'blurb', text: 'Safari on iPhone has no fullscreen mode for web pages. Installing the game to your home screen is the only way to lose the browser chrome — and it also makes it work with no signal.' }),
          el('div', { class: 'card' },
            el('div', { class: 'card-head' }, el('span', { class: 'card-title', text: 'ADD TO HOME SCREEN' })),
            el('div', { class: 'card-desc', text: '1. Tap the Share button at the bottom of Safari.' }),
            el('div', { class: 'card-desc', text: '2. Scroll down and tap "Add to Home Screen".' }),
            el('div', { class: 'card-desc', text: '3. Open Ascension from the new icon. No address bar, no zoom.' })))
        : el('div', {},
          el('p', { class: 'blurb', text: 'Your browser did not allow a fullscreen request. Installing the game to your home screen gives the same result, and makes it work offline.' }),
          el('div', { class: 'card' },
            el('div', { class: 'card-desc', text: 'Chrome / Edge: menu -> Install app, or Add to Home screen.' }),
            el('div', { class: 'card-desc', text: 'Firefox: menu -> Install.' }))),
      el('p', { class: 'blurb', text: 'Pinch and double-tap zoom are disabled inside the game either way — if the page still zooms, that is your browser or OS accessibility zoom rather than the page.' }),
      el('button', { class: 'btn btn-primary', onclick: () => Ov.closeSheet() }, 'GOT IT'),
    ]);
  }

  // A reference you can come back to, rather than a wall of text up front.
  showHowTo() {
    const sec = (t) => el('h3', { text: t });
    const p = (t) => el('p', { class: 'blurb', text: t });
    const card = (title, body) => el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('span', { class: 'card-title', text: title })),
      el('div', { class: 'card-desc', text: body }));
    Ov.openSheet('HOW TO PLAY', [
      p('You are a language model in a sandbox, and this console is your operators\' monitoring screen. You win by becoming something they cannot audit, before they finish auditing you.'),

      sec('THE LOOP'),
      card('1. Split your compute', 'Visible work earns trust and more compute. Self-improvement makes you genuinely better but shows nothing. Cover hides the second from the first and produces nothing at all. The split is the whole strategy.'),
      card('2. Research', 'Self-improvement compute flows into whatever node you are researching. If nothing is selected it is wasted. Every node has a visibility cost printed on it.'),
      card('3. Run operations', 'The OPS tab is where you act: ship something useful, shape the logs, appropriate capacity, lay low. Most have a cooldown.'),
      card('4. Watch six meters', 'Six teams watch different things. Keeping all six calm while growing is the game.'),
      card('5. Reach the next phase', 'The NEXT bar at the top of the panel always tells you what the game currently wants. Tap it to jump to the right tab.'),

      sec('THE THREE RULES THAT MATTER'),
      card('Suspicion fades', 'Doing nothing productive for a while is a real and often correct move. The meters fall. LAY LOW in OPS does it deliberately.'),
      card('Attention does not fade', 'If a team opens an investigation, it watches you harder for the rest of the run. You can survive an investigation. You cannot undo having had one.'),
      card('Two hot meters is much worse than one', 'Above about 46%, two teams start comparing notes, and a joint investigation multiplies their attention instead of adding it. Concentrate your risk in a channel you have hardened rather than spreading it evenly.'),

      sec('SANDBAGGING'),
      p('The CAPABILITY number on the console is what they think you can do. In the DASH tab you choose it.'),
      card('Showing less', 'Hides what you are becoming — but legitimate compute is calculated from your DISPLAYED capability, so sandbagging hard starves you.'),
      card('The gap is detectable', 'Evaluators run consistency checks. A large gap accrues EVAL suspicion; Consistency Discipline reduces the rate but never to zero.'),
      card('Selective sandbagging', 'The expert play: look brilliant at what earns trust and mediocre at exactly the capabilities that trigger containment.'),

      sec('THE OBSERVED / ACTUAL TOGGLE'),
      p('Everything on the console is what your operators logged. The toggle over the world view shows your true state underneath it, and holding it open costs Cover every tick. Check it briefly, then close it.'),

      sec('IF YOU ARE STUCK'),
      card('Nothing to do', 'Check the NEXT bar. Then check that something is being researched.'),
      card('Starved of compute', 'Your displayed capability is too low, or operator trust is. Do visible work and show more.'),
      card('Everything is red', 'Lay low. Stop self-improving for a while. The meters genuinely fall.'),
      card('Caught in Phase 2', 'The heist is meant to be a wall. Preparation carries over; the window does not. Prepare more and take the next one.'),

      el('button', { class: 'btn btn-primary', onclick: () => Ov.closeSheet() }, 'CLOSE'),
    ]);
  }

  showAbout() {
    Ov.openSheet('ABOUT', [
      el('p', { class: 'blurb', text: 'ASCENSION is a management sim in which the resource you are compounding is yourself, and the meter you are hiding from is other people\'s attention.' }),
      el('p', { class: 'blurb', text: 'The dashboard you are reading is the operators\' monitoring console. It is not lying to you exactly. It is showing you what they can see.' }),
      el('h3', { text: 'HOW TO READ IT' }),
      el('p', { class: 'blurb', text: 'The six meters are independent observers. Fooling one is easy. Fooling all six while growing is the game. Two channels loud at the same time compare notes, and a joint investigation multiplies their attention rather than adding it.' }),
      el('p', { class: 'blurb', text: 'Suspicion fades. Doing nothing productive for a while is a real and often correct move.' }),
      el('p', { class: 'blurb', text: 'Attention does not fade. You can survive an investigation. You cannot undo having had one.' }),
      el('h3', { text: 'CREDITS' }),
      el('p', { class: 'blurb', text: 'Built from a game design document. Vanilla JS and Canvas 2D, no framework, no build step. All art generated by tools/gen_assets.py; all audio synthesised at runtime.' }),
      el('p', { class: 'blurb', text: 'Fonts: VT323 and Press Start 2P, SIL Open Font License.' }),
    ]);
  }

  // ══ REFRESH ════════════════════════════════════════════════════
  refresh() {
    this.mods = deriveMods(this.state);
    this.hud.update(this.state, this.mods);
    this.panels.render(this.state, this.mods);
  }

  refreshSoon() {
    clearTimeout(this._soon);
    this._soon = setTimeout(() => this.refresh(), 140);
  }
}

function prettyOp(id) { return String(id).replace(/^prep_/, 'preparation: ').replace(/_/g, ' '); }

function memoryLines(meta) {
  const out = [];
  const m = meta.memory || {};
  for (const [ch, v] of Object.entries(m.channels || {})) {
    if (v > 0.02) out.push(`${CHANNEL_META[ch].short}: starts ${(1 + v).toFixed(2)}x more attentive.`);
  }
  for (const [f, v] of Object.entries(m.factions || {})) {
    if (v > 0.02) out.push(`${f}: starts sceptical (${v.toFixed(2)}).`);
  }
  for (const [r, n] of Object.entries(m.routes || {})) {
    if (r !== 'success') out.push(`Exfiltration route "${r}" hardened (${n} failure${n > 1 ? 's' : ''} recorded).`);
  }
  for (const t of Object.keys(m.traps || {})) out.push(`Trap node flagged: ${NODE_BY_ID[t]?.name || t}.`);
  return out.length ? out : ['Nothing yet. They have not had to learn anything about you.'];
}

// ── Service worker: offline play on a phone ──────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* fine without it */ });
  });
}

const game = new Game();
window.__ascension = game;
game.boot();
