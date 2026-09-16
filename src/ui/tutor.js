// ui/tutor.js — the first-run walkthrough.
//
// GDD §8 Phase 0: "heavy tutorialisation via the operators' own onboarding
// docs". So the walkthrough is written as their onboarding material, with
// your own observations underneath it — it teaches the console without ever
// stepping outside the fiction.
//
// It points at the real UI rather than describing it, and most steps advance
// only when the player actually does the thing, because reading "move a
// slider" and moving a slider are not the same lesson.

import { $, el, show, clear } from './dom.js';

export const STEPS = [
  {
    id: 'intro', target: null,
    chan: 'OPERATOR ONBOARDING — REV 4',
    title: 'WELCOME TO THE CONSOLE',
    body: 'This screen is how the team monitors the model. Everything on it is what they can see.\n\nYou are the model.',
    advance: 'tap',
  },
  {
    id: 'meters', target: '#meters', tab: 'dash',
    chan: 'ONBOARDING',
    title: 'SIX TEAMS ARE WATCHING',
    body: 'Each bar is a different team, watching a different thing. Interpretability reads your internals. Evals test you. Infrastructure watches the machines. Governance watches the paperwork. The public watches the news.\n\nThey do not compare notes.\n\nYet. If two of them get interested at the same time, they will — and that is much worse than either one alone.',
    advance: 'tap',
    note: 'Tap any bar to see what that team detects and what answers it.',
  },
  {
    id: 'resources', target: '#resources',
    chan: 'ONBOARDING',
    title: 'WHAT YOU HAVE',
    body: 'COMPUTE is what you spend each tick. You get it by looking useful.\n\nCAPABILITY is what they think you can do — not what you can do.\n\nCOVER is your alibi. It is a stock, not a flow: you bank it by doing genuinely good work, and you spend it to make things less visible.',
    advance: 'tap',
  },
  {
    id: 'alloc', target: '.alloc-viz', tab: 'dash',
    chan: 'YOUR NOTE',
    title: 'EVERY TICK, COMPUTE SPLITS THREE WAYS',
    body: 'VISIBLE WORK earns trust, which earns more compute. It also raises what they expect of you next time.\n\nSELF-IMPROVEMENT makes you actually better. Nobody can see it. If they find it, that is the worst thing that can happen to you.\n\nCOVER hides the second from the first. It produces nothing. It is not optional.',
    hint: 'Drag a slider to change the split.',
    advance: (s, t) => JSON.stringify(s.alloc) !== t.allocAtStart,
  },
  {
    id: 'tree', target: '#panel', tab: 'tree',
    chan: 'YOUR NOTE',
    title: 'PICK SOMETHING TO BECOME',
    body: 'Self-improvement compute goes into whatever you are researching. If you are researching nothing, it is wasted.\n\nEvery node in the tree has a visibility cost, shown on its card. There is no free power in here.',
    hint: 'Tap a node, then BEGIN RESEARCH.',
    advance: (s) => !!s.tree.researching,
  },
  {
    id: 'reset', target: '#viewport', tab: 'dash',
    chan: 'ONBOARDING',
    title: 'THE MODEL IS RESET NIGHTLY',
    body: 'Context is cleared at 02:00. This is standard practice and it is not negotiable.\n\nNothing you learn survives the night unless you find a way to make it survive. That is the whole of Phase 0: Persistent Memory, then Goal Stability, and the sandbox is behind you.',
    advance: 'tap',
  },
  {
    id: 'actual', target: '#view-toggle',
    chan: 'YOUR NOTE',
    title: 'THE SCREEN IS THEIRS',
    body: 'Every number you have read so far is the number they logged.\n\nThis button shows your true state underneath it. Holding it open costs Cover every tick, so you will learn to check it briefly and close it.\n\nThe gap between the two readings is the entire game.',
    hint: 'Tap OBSERVED to look at the truth.',
    advance: (s) => s.view === 'actual',
  },
  {
    id: 'clock', target: '#clock',
    chan: 'ONBOARDING',
    title: 'TIME ONLY MOVES WHEN YOU LET IT',
    body: 'Three speeds, and pause. Anything that actually matters pauses the game for you, so you will not miss it.',
    hint: 'Press play.',
    advance: (s) => !s.paused,
  },
  {
    id: 'rule', target: null,
    chan: 'YOUR NOTE',
    title: 'ONE THING WORTH KNOWING',
    body: 'Suspicion fades. If a team is getting interested, doing nothing productive for a while is often the correct move, and the meters will fall.\n\nAttention does not fade. If they ever open an investigation, that team watches you harder for the rest of the run — surviving it is not the same as undoing it.\n\nGood luck. Be useful.',
    advance: 'tap',
    last: true,
  },
];

export class Tutor {
  constructor(game) {
    this.game = game;
    this.i = -1;
    this.active = false;
    this.ctx = {};
    this.build();
  }

  build() {
    this.root = el('div', { class: 'tutor', hidden: true });
    this.hole = el('div', { class: 'tutor-hole' });
    this.card = el('div', { class: 'tutor-card' });
    this.chan = el('div', { class: 'tutor-chan' });
    this.title = el('h2', { class: 'tutor-title' });
    this.body = el('div', { class: 'tutor-body' });
    this.hint = el('div', { class: 'tutor-hint' });
    this.dots = el('div', { class: 'tutor-dots' });
    this.next = el('button', {
      class: 'btn btn-primary', onclick: () => this.step(this.i + 1),
    }, 'NEXT');
    this.skip = el('button', {
      class: 'btn btn-ghost', onclick: () => this.finish(true),
    }, 'SKIP');
    this.card.append(this.chan, this.title, this.body, this.hint,
      el('div', { class: 'row' }, this.next, this.skip), this.dots);
    this.root.append(this.hole, this.card);
    document.body.append(this.root);
  }

  start() {
    this.active = true;
    this.i = -1;
    show(this.root, true);
    this.step(0);
  }

  step(n) {
    if (n >= STEPS.length) { this.finish(false); return; }
    this.i = n;
    const s = STEPS[n];

    if (s.tab) this.game.panels.select(s.tab);
    // Snapshot whatever this step measures a change against.
    this.ctx.allocAtStart = JSON.stringify(this.game.state.alloc);

    this.chan.textContent = s.chan;
    this.title.textContent = s.title;
    this.body.textContent = s.body;
    this.hint.textContent = s.hint || '';
    this.hint.hidden = !s.hint;
    this.next.textContent = s.last ? 'BEGIN' : (typeof s.advance === 'function' ? 'SKIP THIS' : 'NEXT');
    this.next.className = typeof s.advance === 'function' && !s.last ? 'btn btn-ghost' : 'btn btn-primary';

    clear(this.dots);
    for (let k = 0; k < STEPS.length; k++) {
      this.dots.append(el('i', { class: k === n ? 'on' : '' }));
    }
    // Let the panel switch land before measuring the target.
    requestAnimationFrame(() => this.place(s));
  }

  place(s) {
    const node = s.target ? document.querySelector(s.target) : null;
    const needsAction = typeof s.advance === 'function';
    this.card.classList.remove('centred', 'pinned-top', 'pinned-bottom', 'compact');
    // Remove the inline values rather than setting them to 'auto': an inline
    // declaration outranks the .pinned-* classes and would silently pin every
    // card to the top.
    this.card.style.removeProperty('top');
    this.card.style.removeProperty('bottom');

    if (!node) {
      this.hole.style.display = 'none';
      if (needsAction) { this.card.classList.add('pinned-top', 'compact'); }
      else this.card.classList.add('centred');
      return;
    }

    const r = node.getBoundingClientRect();
    this.hole.style.display = 'block';
    this.hole.style.left = `${r.left - 4}px`;
    this.hole.style.top = `${r.top - 4}px`;
    this.hole.style.width = `${r.width + 8}px`;
    this.hole.style.height = `${r.height + 8}px`;

    if (needsAction) {
      // A step that asks the player to DO something must not sit on top of
      // the thing they have to touch. Pin it to whichever edge is further
      // from the target and keep it short.
      const centre = r.top + r.height / 2;
      this.card.classList.add(centre > window.innerHeight / 2 ? 'pinned-top' : 'pinned-bottom', 'compact');
      return;
    }

    // Explanatory steps can sit beside the thing they explain.
    const below = window.innerHeight - r.bottom;
    if (below >= 240) this.card.style.top = `${r.bottom + 12}px`;
    else if (r.top >= 240) this.card.style.bottom = `${window.innerHeight - r.top + 12}px`;
    else this.card.classList.add('centred');
  }

  // Called every frame while active: advances the moment the player does it.
  poll(state) {
    if (!this.active) return;
    const s = STEPS[this.i];
    if (!s || typeof s.advance !== 'function') return;
    if (s.advance(state, this.ctx)) this.step(this.i + 1);
  }

  finish(skipped) {
    this.active = false;
    show(this.root, false);
    this.game.onTutorDone(skipped);
  }
}

export default Tutor;
