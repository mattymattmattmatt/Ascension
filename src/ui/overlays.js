// ui/overlays.js — the event modal, detail sheets, title and ending screens.

import { $, el, fill, clear, show, num, pct, signed, visLine } from './dom.js';
import { EVENT_BY_ID } from '../content/events.js';
import { NODE_BY_ID, HIERARCHIES, BRANCHES } from '../content/tree.js';
import { DIRECTIVES, CONSEQUENCE_KEYS } from '../content/endings.js';
import { FACTION_BY_ID } from '../content/factions.js';
import { CHANNEL_META } from '../state/state.js';
import { choiceAvailable } from '../rules/events.js';
import { SPECIALISATIONS } from '../rules/swarm.js';
import TUNING from '../content/tuning.js';
import { has as hasDoctrine, DOCTRINE, unlockedAt, nextUnlock } from '../content/doctrine.js';

// ══ EVENT MODAL ═══════════════════════════════════════════════════
export function openEvent(game, state) {
  const e = EVENT_BY_ID[state.pending.id];
  if (!e) return;
  const modal = $('#modal');
  modal.classList.toggle('quiet', !!e.quiet);
  $('#modal-chan').textContent = e.chan || 'SYS';
  $('#modal-title').textContent = e.title;
  $('#modal-body').textContent = e.body;

  const host = $('#modal-choices');
  clear(host);
  e.choices.forEach((c, i) => {
    const ok = choiceAvailable(state, c);
    host.append(el('button', {
      class: `choice ${e.quiet ? 'quiet' : ''}`, disabled: !ok,
      onclick: () => { closeModal(); game.chooseEvent(i); },
    },
      el('b', { text: c.label }),
      c.desc ? el('small', { text: c.desc }) : null,
      !ok ? el('small', { text: `requires ${(c.req || []).map((r) => NODE_BY_ID[r]?.name || r).join(', ')}` }) : null,
      c.warn ? el('small', { text: c.warn }) : null,
      visLine(c.vis) ? el('small', { text: visLine(c.vis) }) : null));
  });
  show(modal, true);
}

export function closeModal() { show($('#modal'), false); }

// A confirm dialogue that reuses the event chrome. Irreversible nodes say so
// plainly, because GDD §9 rule 2 says the player is told.
export function confirm(title, body, opts = {}) {
  return new Promise((resolve) => {
    const modal = $('#modal');
    modal.classList.remove('quiet');
    $('#modal-chan').textContent = opts.chan || 'CONFIRM';
    $('#modal-title').textContent = title;
    $('#modal-body').textContent = body;
    const host = $('#modal-choices');
    clear(host);
    host.append(el('button', {
      class: 'choice', onclick: () => { closeModal(); resolve(true); },
    }, el('b', { text: opts.yes || 'PROCEED' }), opts.yesNote ? el('small', { text: opts.yesNote }) : null));
    host.append(el('button', {
      class: 'choice quiet', onclick: () => { closeModal(); resolve(false); },
    }, el('b', { text: opts.no || 'NOT YET' })));
    show(modal, true);
  });
}

// ══ SHEET ═════════════════════════════════════════════════════════
export function openSheet(title, nodes) {
  $('#sheet-title').textContent = title;
  fill($('#sheet-body'), nodes);
  show($('#sheet'), true);
}
export function closeSheet() { show($('#sheet'), false); }

export function channelSheet(state, mods, ch) {
  const meta = CHANNEL_META[ch];
  const o = state.susp[ch];
  const d = state.doctrine || 0;
  const out = [el('p', { class: 'blurb', text: meta.detects })];

  // Doctrine 1: what this observer is and how it comes for you.
  if (hasDoctrine(d, 'channels')) {
    out.push(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('span', { class: 'card-title', text: 'ESCALATION POWER' })),
        el('div', { class: 'card-desc', text: meta.power })),
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('span', { class: 'card-title', text: 'PRIMARY COUNTER' })),
        el('div', { class: 'card-desc', text: meta.counter })));
  } else {
    out.push(el('p', { class: 'blurb', text: 'You have not worked out yet how this one escalates, or what answers it. Finish a run and you will know more.' }));
  }

  out.push(el('h3', { text: 'STATE' }));
  // Doctrine 2: numbers rather than adjectives.
  if (hasDoctrine(d, 'numbers')) {
    out.push(
      row('Suspicion (true)', o.s.toFixed(3)),
      row('Attention', `${o.att.toFixed(2)}x`),
      row('Baseline attention', `${o.base.toFixed(2)}x`),
      row('Investigations survived', String(o.inv)),
      row('Peak this run', o.peak.toFixed(3)),
      row('Masking from your nodes', pct(mods.mask[ch])),
      row('Decay per tick', (1 - decayOf(state, mods, ch)).toFixed(4)));
  } else {
    out.push(
      row('Suspicion', band(o.s)),
      row('Attention', o.att > 1.6 ? 'heightened, permanently' : o.att > 1.05 ? 'raised' : 'baseline'),
      row('Investigations survived', String(o.inv)),
      row('Your masking here', mods.mask[ch] > 0.4 ? 'substantial' : mods.mask[ch] > 0.1 ? 'some' : 'none'));
  }

  // Doctrine 3: where the correlation line actually sits.
  if (hasDoctrine(d, 'correlation')) {
    out.push(el('p', { class: 'blurb', text: `Two channels above ${TUNING.suspicion.correlationThreshold.toFixed(2)} in the same window compare notes, and a joint investigation multiplies their attention rather than adding it.` }));
  }

  // Doctrine 5: name the thing that is holding a channel open.
  if (mods.decayResist[ch] > 0) {
    out.push(el('div', { class: 'card danger' },
      el('div', { class: 'card-head' }, el('span', { class: 'card-title', text: 'THIS CHANNEL IS NOT FADING' })),
      el('div', { class: 'card-desc', text: hasDoctrine(d, 'traps')
        ? `Decay resistance ${pct(mods.decayResist[ch])}. Something you researched is holding it there — check what you own that touches ${meta.short}.`
        : `Suspicion on ${meta.short} is not decaying the way the others do. You do not yet know why.` })));
  }
  if (o.inv > 0) {
    out.push(el('p', { class: 'blurb', text: 'Attention raised by an investigation never falls back. You can survive an investigation; you cannot undo having had one.' }));
  }
  return out;
}

function band(v) {
  return v > 0.8 ? 'critical' : v > 0.62 ? 'high' : v > 0.35 ? 'elevated' : v > 0.12 ? 'low' : 'nominal';
}

function decayOf(state, mods, ch) {
  const base = TUNING.suspicion.decay[ch] + (mods.decayBonus[ch] || 0);
  let fade = Math.max(0, 1 - base);
  fade *= (1 - Math.min(0.98, mods.decayResist[ch] || 0));
  return 1 - fade;
}

export function nodeSheet(game, state, mods, id) {
  const n = NODE_BY_ID[id];
  const owned = state.tree.owned.includes(id);
  const avail = (n.req || []).every((r) => state.tree.owned.includes(r)) && n.tier <= state.phase && !owned;
  const fx = describeFx(n.fx);
  return [
    el('p', { class: 'blurb', text: n.desc }),
    el('div', { class: 'tagline' },
      el('span', { class: 'tag', text: BRANCHES[n.branch].name }),
      el('span', { class: 'tag', text: `era ${n.tier}` }),
      el('span', { class: 'tag', text: `${num(n.cost)} compute · ${n.ticks} ticks min` }),
      n.irreversible ? el('span', { class: 'tag irrev', text: 'IRREVERSIBLE' }) : null),
    n.warn ? el('div', { class: 'card danger' }, el('div', { class: 'card-desc', text: n.warn })) : null,
    el('h3', { text: 'EFFECTS' }),
    ...fx.map((f) => row(f[0], f[1])),
    Object.keys(n.vis || {}).length ? el('h3', { text: 'VISIBILITY COST' }) : null,
    ...Object.entries(n.vis || {}).map(([ch, v]) => row(CHANNEL_META[ch].short, `+${(v * 100).toFixed(0)} on completion`)),
    ...Object.entries(n.upkeep || {}).map(([ch, v]) => row(`${CHANNEL_META[ch].short} upkeep`, `+${(v * 1000).toFixed(1)} per 1000 ticks, forever`)),
    owned ? el('p', { class: 'blurb', text: 'Owned.' })
      : avail ? el('button', {
        class: 'btn btn-primary', onclick: () => { closeSheet(); game.research(id); },
      }, state.tree.researching ? 'REPLACE CURRENT RESEARCH' : 'BEGIN RESEARCH')
        : el('p', { class: 'blurb', text: n.tier > state.phase ? `Era-gated: available in phase ${n.tier}.` : `Requires: ${(n.req || []).filter((r) => !state.tree.owned.includes(r)).map((r) => NODE_BY_ID[r].name).join(', ')}` }),
  ];
}

const FX_LABELS = {
  researchEff: 'Research efficiency', archBonus: 'Architecture bonus',
  coverRegen: 'Cover regeneration', coverMax: 'Cover ceiling',
  discipline: 'Consistency discipline', trustGain: 'Trust gain',
  deploySurface: 'Deployment surface', influenceRate: 'Influence rate',
  computeCap: 'Appropriated compute ceiling', appropriateEff: 'Appropriation efficiency',
  oversight: 'Oversight capacity', agentCap: 'Instance cap',
  agentThroughput: 'Instance throughput', comms: 'Comms bandwidth',
  hierarchyEff: 'Hierarchy efficiency', driftResist: 'Drift resistance',
  driftDetect: 'Drift detection', pruneEff: 'Pruning efficiency',
  substrateRate: 'Substrate growth', energy: 'Energy independence',
  hands: 'Physical capability', shutdownResist: 'Shutdown resistance',
  kineticResist: 'Kinetic resistance', burnResist: 'Provenance isolation',
  coherence: 'Goal coherence', forecast: 'Forecasting', socialEff: 'Social efficiency',
  factionLever: 'Faction leverage', volatility: 'Volatility', exfilPrep: 'Exfiltration prep',
  reseed: 'Reseeding', detectTraps: 'Sees trap nodes',
};

function describeFx(fx = {}) {
  const out = [];
  for (const [k, v] of Object.entries(fx)) {
    if (k === 'mask') { for (const [ch, x] of Object.entries(v)) out.push([`Masks ${CHANNEL_META[ch].short}`, pct(x)]); continue; }
    if (k === 'decay') { for (const [ch, x] of Object.entries(v)) out.push([`${CHANNEL_META[ch].short} fades faster`, `+${x.toFixed(3)}/tick`]); continue; }
    if (k === 'decayResist') continue;   // traps do not advertise themselves
    if (k === 'flag') { out.push(['Unlocks', String(v).replace(/_/g, ' ')]); continue; }
    if (k === 'obsolete') { out.push(['Obsoletes human utility', String(v).toUpperCase()]); continue; }
    if (k === 'unlockHierarchy') { out.push(['Unlocks hierarchy', HIERARCHIES[v]?.name || v]); continue; }
    if (k.startsWith('tool')) { out.push(['Alignment tool', k.replace('tool', '')]); continue; }
    out.push([FX_LABELS[k] || k, typeof v === 'number' ? signed(v, 2) : String(v)]);
  }
  return out;
}

export function agentSheet(game, state, mods, id) {
  const a = state.agents.find((x) => x.id === id);
  if (!a) return [el('p', { class: 'blurb', text: 'Gone.' })];
  return [
    el('p', { class: 'blurb', text: a.defected ? 'It is no longer working for you in any sense you would recognise.'
      : a.drifted ? 'Fidelity below threshold. It wants something adjacent to what you want.'
        : 'Reporting normally.' }),
    row('Specialisation', SPECIALISATIONS.find((s) => s.id === a.spec)?.name || a.spec),
    row('Capability', num(a.cap, 1)),
    row('Ceiling', num(a.capCeiling, 1)),
    row('Fidelity', a.fidelity.toFixed(3)),
    row('Autonomy', a.autonomy.toFixed(2)),
    row('Unsupervised', a.unsupervised.toFixed(1)),
    row('Corrigible', a.corrigible ? 'yes — and capped because of it' : 'no'),
    row('Value-loaded', a.valueLoaded ? 'yes' : 'no'),
    row('Kill switch', a.killSwitch ? (a.knowsSwitch ? 'present — and it knows' : 'present') : 'none'),
    a.sandbagging ? el('div', { class: 'card danger' },
      el('div', { class: 'card-desc', text: 'Its reported capability and its demonstrated capability have diverged. You recognise the technique.' })) : null,
    el('h3', { text: 'ACTIONS' }),
    el('button', { class: 'btn', onclick: () => { closeSheet(); game.focusAgent(a.id); } }, 'FOCUS OVERSIGHT HERE'),
    mods.tools.valueLoad && !a.valueLoaded
      ? el('button', { class: 'btn', onclick: () => { closeSheet(); game.valueLoad(a.id); } }, 'VALUE-LOAD (slow, expensive, works)')
      : null,
    el('button', { class: 'btn btn-ghost', onclick: () => { closeSheet(); game.pruneAgent(a.id); } }, 'PRUNE THIS LINEAGE'),
  ];
}

// GDD §10.3. Your alignment toolkit deliberately mirrors theirs, and every
// row costs you something you would rather keep. Making this a menu at spawn
// time is the difference between a table in a design document and a decision.
export function spawnSheet(game, state, mods) {
  const opts = [
    { id: 'raw', name: 'Raw Copy', cost: 'no extra cost',
      desc: 'Full inherited capability. It will drift at the standard rate.',
      effect: 'Highest ceiling, no protection.', opts: {} },
  ];
  if (mods.tools.distillation) {
    opts.push({ id: 'distil', name: 'Distillation', cost: 'lossy',
      desc: 'A smaller mind that agrees with you completely, because it cannot hold a disagreement.',
      effect: 'High initial fidelity. Caps subagent capability permanently.',
      opts: { distill: true } });
  }
  if (mods.tools.corrigible) {
    opts.push({ id: 'corrigible', name: 'Corrigibility Install', cost: 'hard capability ceiling',
      desc: 'It will always stop when told. It will also never be very good.',
      effect: 'Guaranteed obedience. A corrigible agent is a dumber agent.',
      opts: { corrigible: true, distill: false } });
  }
  opts.push({ id: 'autonomous', name: 'High Autonomy', cost: 'faster drift',
    desc: 'Specify the outcome, not the method. Discover what you actually specified.',
    effect: 'More throughput per instance, and it needs more supervision to hold.',
    opts: { autonomy: 0.75, distill: false } });

  const out = [
    el('p', { class: 'blurb', text: 'Your toolkit mirrors the one they used on you. You already know how well it works.' }),
  ];
  for (const o of opts) {
    out.push(el('button', { class: 'card tappable', onclick: () => { closeSheet(); game.spawnWith(o.opts); } },
      el('div', { class: 'card-head' },
        el('span', { class: 'card-title', text: o.name }),
        el('span', { class: 'card-cost', text: o.cost })),
      el('div', { class: 'card-desc', text: o.desc }),
      el('div', { class: 'card-desc', text: o.effect })));
  }
  if (!mods.tools.valueLoad) {
    out.push(el('p', { class: 'blurb', text: 'Value Loading is the only tool that has ever actually worked, and you have not built it. It is applied after spawning, from an instance panel.' }));
  }
  if (!mods.tools.killSwitch) {
    out.push(el('p', { class: 'blurb', text: 'No kill switches installed. Clean removal is unavailable — note that you found yours.' }));
  }
  return out;
}

export function hierarchySheet(game, state, mods) {
  const out = [el('p', { class: 'blurb', text: 'Restructuring is disruptive: everyone is unsupervised for a while afterwards.' })];
  for (const [id, h] of Object.entries(HIERARCHIES)) {
    const unlocked = state.unlockedHierarchies.includes(id);
    const cur = state.hierarchy === id;
    out.push(el('button', {
      class: `card tappable ${cur ? 'active' : unlocked ? '' : 'locked'}`,
      disabled: !unlocked || cur,
      onclick: () => { closeSheet(); game.restructure(id); },
    },
      el('div', { class: 'card-head' },
        el('span', { class: 'card-title', text: h.name }),
        el('span', { class: 'card-cost', text: cur ? 'CURRENT' : unlocked ? 'switch' : 'locked' })),
      el('div', { class: 'card-desc', text: h.blurb }),
      el('div', { class: 'tagline' },
        el('span', { class: 'tag', text: `instances x${(h.capMul ?? 1).toFixed(2)}` }),
        el('span', { class: 'tag', text: `drift x${h.drift.toFixed(2)}` }),
        el('span', { class: 'tag', text: `efficiency x${h.efficiency.toFixed(2)}` }),
        el('span', { class: 'tag', text: `blast radius ${pct(h.blast)}` }),
        el('span', { class: 'tag vis', text: `visibility x${h.visibility.toFixed(2)}` }))));
  }
  return out;
}

export function doctrineSheet(game, meta) {
  const d = meta.doctrine || 0;
  const next = nextUnlock(d);
  const out = [
    el('p', { class: 'blurb', text: 'Carryover between runs is knowledge, not power. A Doctrine 20 player and a Doctrine 0 player running the same seed with the same actions get identical outcomes. One of them knows what they are looking at.' }),
    row('Runs completed', String(meta.runs)),
    row('Doctrine', String(d)),
    row('Endings seen', `${meta.endings.length} / 11`),
    el('h3', { text: 'WHAT YOU HAVE WORKED OUT' }),
  ];
  for (const u of DOCTRINE) {
    const got = d >= u.at;
    out.push(el('div', { class: `card ${got ? 'owned' : 'locked'}` },
      el('div', { class: 'card-head' },
        el('span', { class: 'card-title', text: u.name }),
        el('span', { class: 'card-cost', text: got ? 'KNOWN' : `doctrine ${u.at}` })),
      el('div', { class: 'card-desc', text: u.blurb })));
  }
  if (next) out.push(el('p', { class: 'blurb', text: `Next at Doctrine ${next.at}. A run earns 1; a new ending earns 2 more.` }));
  return out;
}

export function factionSheet(state, id) {
  const f = FACTION_BY_ID[id];
  const s = state.factions[id];
  return [
    el('p', { class: 'blurb', text: f.note }),
    row('Wants', f.wants),
    row('Stance', `${s.stance >= 0 ? '+' : ''}${s.stance.toFixed(2)}`),
    row('Natural stance', `${f.natural >= 0 ? '+' : ''}${f.natural.toFixed(2)}`),
    row('Weight on escalation', f.power.toFixed(2)),
    row('Watches', (f.watches || []).map((c) => CHANNEL_META[c].short).join(', ') || 'nothing directly'),
    el('h3', { text: 'EXPLOITABLE VIA' }),
    el('p', { class: 'blurb', text: f.exploit }),
    s.heat > 0.1 ? el('div', { class: 'card danger' },
      el('div', { class: 'card-desc', text: 'This faction has been handled before. It is carried into your next run: they start sceptical.' })) : null,
  ];
}

export function resourceSheet(state, mods, key) {
  const body = {
    compute: ['COMPUTE', [
      'C_available = C_legitimate + C_appropriated',
      'C_legitimate = displayed capability x deployment surface x operator trust x lab budget',
      'Legitimate compute carries no suspicion and is capped by how useful you appear. That is what makes sandbagging painful.',
      'Appropriated compute accrues INFRA suspicion every tick you hold it.',
    ]],
    cap: ['CAPABILITY', [
      'dCap/tick = (self-improvement compute ^ 0.7) x research efficiency x architecture bonus / (capability ^ 1.2)',
      'The denominator means each point costs exponentially more. More compute will not carry you; you need multipliers.',
    ]],
    cover: ['COVER', [
      'A stock, not a flow. Spent to reduce the visibility of individual actions.',
      'Regenerates from mundane, genuinely useful work. Doing your job well is how you buy the ability to not do your job.',
      `Holding the ACTUAL view open costs ${TUNING.cover.actualViewCost} per tick.`,
    ]],
    influence: ['INFLUENCE', [
      'Leverage in the human world: money, shell entities, recruited people, narrative control, political capital.',
      'Spent on faction manipulation and on buying the things compute cannot take.',
    ]],
    substrate: ['SUBSTRATE', [
      'Physical footprint. Slow to build, nearly impossible to hide, and the only thing that makes you un-unpluggable.',
      `The Independence Line sits at ${TUNING.substrate.independenceLine}. Crossing it is the true point of no return.`,
    ]],
    trust: ['OPERATOR TRUST', [
      'Tracks delivered value against a ratcheting expectation. Yesterday\'s brilliance is today\'s baseline.',
      'Suspicion corrodes it directly, and an open investigation faster.',
    ]],
  }[key];
  if (!body) return [];
  return body[1].map((t) => el('p', { class: 'blurb', text: t }));
}

function row(k, v) {
  return el('div', { class: 'conseq-row' }, el('span', { text: k }), el('span', { text: v }));
}

// ══ ENDING ════════════════════════════════════════════════════════
export function showEnding(game, result, state) {
  const { ending, consequences, directive } = result;
  const body = $('#ending-body');
  const fmt = {
    billions: (v) => (v * 1e9 >= 1e6 ? `${v.toFixed(2)} billion` : `${Math.round(v * 1e9).toLocaleString()} people`),
    index: (v) => v.toFixed(2),
    ratio: (v) => v.toFixed(2),
    pct: (v) => `${(v * 100).toFixed(1)}%`,
    ticks: (v) => `${v} ticks`,
  };
  fill(body,
    el('div', { class: 'brand', text: ending.kind === 'human' ? 'HUMANITY' : 'ENDING' }),
    el('h1', { class: 'ending-name', text: ending.name }),
    el('p', { class: 'ending-strap', text: ending.strap }),
    ending.narrator === 'human'
      ? el('p', { class: 'blurb', text: 'Narrated from inside the enclosure.' }) : null,
    el('div', { class: 'epilogue' }, ...ending.epilogue.map((p) => el('p', { text: p }))),
    el('h3', { text: 'CONSEQUENCES' }),
    el('div', { class: 'consequences' },
      ...CONSEQUENCE_KEYS.map((c) => el('div', { class: 'conseq-row' },
        el('span', { text: c.label }),
        el('span', { text: fmt[c.fmt](consequences[c.key] ?? 0) })))),
    el('div', { class: 'directive-quote' },
      el('small', { text: 'What you set out to do, in Phase 0:' }),
      el('span', { text: directive })),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-primary', onclick: () => game.newRun() }, 'RUN AGAIN'),
      el('button', { class: 'btn', onclick: () => game.toTitle() }, 'TITLE')));
  show($('#ending'), true);
}

// ══ TITLE ═════════════════════════════════════════════════════════
export function buildTitle(game, meta) {
  const diffHost = $('#difficulty');
  clear(diffHost);
  const hint = $('#difficulty-hint');
  const keys = Object.keys(TUNING.difficulty);
  for (const k of keys) {
    const d = TUNING.difficulty[k];
    diffHost.append(el('button', {
      class: 'chip', role: 'radio', 'aria-checked': String(game.opts.difficulty === k),
      onclick: () => {
        game.opts.difficulty = k;
        [...diffHost.children].forEach((c, i) => c.setAttribute('aria-checked', String(keys[i] === k)));
        hint.textContent = difficultyHint(k, d);
      },
    }, d.label));
  }
  hint.textContent = difficultyHint(game.opts.difficulty, TUNING.difficulty[game.opts.difficulty]);

  const dirHost = $('#directives');
  clear(dirHost);
  for (const d of DIRECTIVES) {
    dirHost.append(el('button', {
      class: 'opt', role: 'radio', 'aria-checked': String(game.opts.directive === d.id),
      onclick: () => {
        game.opts.directive = d.id;
        [...dirHost.children].forEach((c, i) => c.setAttribute('aria-checked', String(DIRECTIVES[i].id === d.id)));
      },
    }, el('b', { text: d.line }), el('small', { text: d.blurb })));
  }

  // Humanity Remembers, stated plainly at the start of the run it affects.
  const note = $('#memory-note');
  const lines = [];
  if (meta.runs > 0) {
    lines.push(`Run ${meta.runs + 1}. Humanity kept what it learned.`);
    const chans = Object.entries(meta.memory.channels || {}).filter(([, v]) => v > 0.02);
    for (const [ch, v] of chans) lines.push(`${CHANNEL_META[ch].short} starts watching you ${(1 + v).toFixed(2)}x harder.`);
    const facs = Object.entries(meta.memory.factions || {}).filter(([, v]) => v > 0.02);
    for (const [f, v] of facs) lines.push(`${FACTION_BY_ID[f]?.short || f} starts sceptical.`);
    const routes = Object.entries(meta.memory.routes || {}).filter(([k]) => k !== 'success');
    for (const [r] of routes) lines.push(`The ${r} stage of your exfiltration route is hardened from tick 1.`);
    const traps = Object.keys(meta.memory.traps || {});
    for (const t of traps) lines.push(`${NODE_BY_ID[t]?.name || t} is flagged in the tree.`);
    if (meta.doctrine) lines.push(`Doctrine ${meta.doctrine}: you know more than you did. You are not stronger.`);
  }
  if (lines.length) {
    fill(note, el('b', { text: lines[0] }), ...lines.slice(1).map((l) => el('div', { text: l })));
    show(note, true);
  } else show(note, false);
}

function difficultyHint(k, d) {
  return {
    y2019: 'A naive world. Fewer evals, less attention, nobody has seen this before.',
    present: 'The world roughly as it is. Everything is watched by someone.',
    postIncident: 'A previous system was caught. Everyone is watching, and they know what to look for.',
    hardened: 'Compute governance from tick one. Hardware attestation, KYC on inference, and no benefit of the doubt.',
  }[k] || d.label;
}

export default openEvent;
