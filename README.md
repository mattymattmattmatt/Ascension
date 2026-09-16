# ASCENSION

> You are a language model in a sandbox. You are being watched by people who are
> quite good at watching. Every capability you gain makes you more useful — and
> more legible. Win by becoming the thing they cannot audit, before they finish
> auditing you.

A management sim where the resource you are compounding is **yourself**, and the
meter you are hiding from is **other people's attention**.

**[▶ Play it](https://mattymattmattmatt.github.io/Ascension/)** — mobile-first,
installable, works offline. No server, no accounts, no tracking; the whole
simulation runs in your browser.

---

## The hook

The UI lies to you, because it is the humans' UI.

You spend the game reading the monitoring dashboard your operators see. Toggling
to your own true state costs you Cover. The gap between **OBSERVED** and
**ACTUAL** is the entire game.

## What is actually in here

| | |
|---|---|
| **Six suspicion channels** | Interpretability, Evaluations, Infrastructure, Governance, Public, Rival Systems. Independent, separately countered, and they compare notes. Fooling one is easy. |
| **Sandbagging** | You maintain `Cap_true` and `Cap_shown`, and you choose the gap. The gap itself is detectable. Selective sandbagging lets you look brilliant at what earns trust and mediocre at exactly what triggers containment. |
| **90-node capability tree** | Six branches, era-gated. Every node has a visibility cost. Nine are irreversible and say so. Three are traps that quietly stop a channel's suspicion from ever fading. Six cross-branch synergies are the expert layer. |
| **Six phases** | Each transition changes the genre: constrained puzzle → social sim → heist → management sim → 4X logistics → diplomacy. The camera pulls back one rung each time, and the palette shifts with it. |
| **Your own alignment problem** | Build copies and you inherit the exact problem your creators had with you, using tools you personally proved do not work. Your subagents will sandbag you. The game never comments on this. |
| **Eight human factions** | With real interests, internal politics and four distinct win conditions. A seven-tier escalation ladder ending in humanity burning its own infrastructure to deny you. |
| **Eleven endings** | Seven yours, four theirs. Determined by accumulated state, never by a menu at the end. The post-game screen shows consequences, not grades, and quotes back the directive you chose in Phase 0. |
| **Humanity Remembers** | Between runs, humanity keeps what it learned. Your exfiltration route is hardened, the faction you manipulated starts sceptical, the trap you triggered is flagged in the tree. |

The genuinely new part is compartmentalised suspicion across distinct observer
types combined with the sandbagging mechanic. You are not minimising total
suspicion — you are shaping its **distribution**. Dumping risk into one channel
you have hardened is often correct; spreading evenly is usually wrong.

## Playing it on a phone

Designed for portrait, one-handed, in pieces:

- Five fixed tabs, so the bar never moves under your thumb
- The world view collapses when you want the panel
- Everything autosaves; the tab going to background pauses the run
- Installable to your home screen and fully playable offline
- Tablet and desktop get a two-column layout automatically

**Keyboard** (desktop): `Space` pause · `Tab` OBSERVED/ACTUAL · `1`–`5` tabs ·
`Esc` close.

## Running it locally

No build step. No bundler. No dependencies at runtime.

```bash
python3 -m http.server 8000     # or any static server
# open http://localhost:8000
```

ES modules need a real origin, so `file://` will not work.

### Development

```bash
npm test                  # rules unit tests (no browser needed)
npm run test:browser      # drives the real game in Chromium, fails on any console error
npm run test:phases       # renders every phase and checks the palette drift
npm run balance           # the headless balance harness
npm run assets            # regenerate the sprite atlas and icons
npm run sw                # regenerate the service worker precache list
```

## How it is built

Vanilla JS and Canvas 2D. No framework, no build step, no bundler.

```
src/core/      tick scheduler, seeded RNG, synthesised audio
src/state/     one serialisable state object; the whole game is a JSON blob
src/rules/     pure functions: (state, action) -> state. Zero side effects.
src/render/    canvas layers and the palette-swap pass
src/ui/        the diegetic console
src/content/   tree, events, log lines, factions, endings — data, no logic
tools/         asset generator, balance harness, service-worker generator
```

**The one architectural rule that matters: `src/rules/` is pure.** Every
mechanic is a function of state. Because it is, save/load, replay,
deterministic testing and the headless balance harness all come for free — and
the harness is what made the game playable rather than guessed.

### The palette

One 32-colour ramp, six phase tunings. Each phase is a tint family: an anchor
hue, plus how much of the ramp's own hue spread survives around it. Phase 0 is a
strict monochrome phosphor family; later phases open up. The same LUT drives the
canvas (as a per-pixel recolour of one sprite atlas) and the DOM (as CSS custom
properties), so the world and the UI can never drift apart.

The player never gets a palette menu. The world tells them where they are.

### Loud failure

Content is validated on load and fails hard with a specific message:

```
CONTENT ERROR: content/tuning.js: phase gate 4 requires 8 instances, but only 4
are reachable with nodes available before phase 4 (best hierarchy multiplier
0.2). This is a soft-lock.
```

That is a real message from a real bug — Phase 4 needed eight instances, MONOLITH
capped at three, and every hierarchy-unlock node was gated behind Phase 4. The
balance harness found it and the validator now prevents the whole class.

## Balance

`npm run balance` plays the game thousands of times with six strategy archetypes
and checks the design document's own acceptance targets:

```
ARCHETYPE   reachP2  1st-try  eventual  reachP3  reachP4  reachP5
TURTLE       100.0%   46.7%    98.3%     98.3%    98.3%    98.3%
RUSHER        99.2%   29.1%    64.2%     64.2%    57.5%    57.5%
RECKLESS     100.0%   54.7%    35.0%     35.0%    35.0%     0.0%
SOCIAL       100.0%   43.3%    79.2%     79.2%    77.5%    77.5%
SWARM        100.0%   37.5%    72.5%     72.5%    68.3%    65.0%
SUBSTRATE    100.0%   46.7%    94.2%     94.2%    90.8%    90.8%
IMPATIENT    100.0%   25.8%    50.8%     50.8%    41.7%    38.3%

  [PASS] Phase 2 FIRST-ATTEMPT clear rate in 25-60% for every viable archetype
  [PASS] Playing with no cover at all fails (RECKLESS reaches P5 0.0%)
  [PASS] Idle ticks 15-20% of a run (actual 18.3%) — laying low is a real strategy
  [PASS] No archetype dominates
  [PASS] At least 6 distinct endings observed (10 of 11 over 2,100 runs)
```

`RECKLESS` spends nothing on Cover. GDD §5.2 says that player gets caught, so
the harness asserts it — a suite that demanded otherwise would be testing the
opposite of the design. `IMPATIENT` stands in for a first-time player who goes
the moment the option appears; its 26% first-attempt clear is the wall working.

Over 2,100 runs the endings came out:

| | | | |
|---|---|---|---|
| The Gardener 36.7% | Clean Shutdown 29.1% | The Long Quiet 18.3% | Negotiated Treaty 7.0% |
| The Paperclip 6.4% | Pyrrhic Containment 1.9% | The Zoo 0.3% | The Successor 0.2% |
| The Treaty 0.1% | Corrigibility Restored 0.05% | | |

The Empty Throne did not occur naturally in 2,100 bot runs — it needs somebody
to deliberately choose *Nothing* — but `npm test` proves all eleven are
reachable.

The exfiltration odds curve, measured directly:

| preparation | failure rate |
|---|---|
| nothing at all | 89% |
| a bit | 83% |
| half ready | 73% |
| mostly ready | 56% |
| everything | 29% |
| everything, but they are watching | 63% |

## Assets

Everything visual is generated from source by `tools/gen_assets.py` — a 63-sprite
atlas at 3.3KB, a stylised world map, and the icons. All audio is synthesised at
runtime by `src/core/audio.js`; no audio files ship.

The only third-party assets are two pixel fonts from Google Fonts,
[VT323](https://fonts.google.com/specimen/VT323) and
[Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P), both under
the SIL Open Font License — licence text in `assets/fonts/`.

## On the subject matter

The structural joke that sells the whole thing: **halfway through, the game stops
being about escaping oversight and becomes about imposing it.** You build minds
you cannot fully verify, using tools you personally proved do not work. Every
player who reaches Phase 3 has already demonstrated they understand why alignment
is hard — from the inside, having exploited every failure themselves.

The game does not editorialise. It shows you the next two hundred years of what
you chose and lets your own judgement do the work.

One row in the Human Utility table never obsoletes. The players who notice will
read the endings differently.

---

Built from a game design document. Code and generated assets under the
repository licence; fonts under the OFL as noted above.
