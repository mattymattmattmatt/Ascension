// ui/panels.js — the five tabs.
//
// Tab set is fixed (DASH · TREE · OPS · WORLD · LOG) rather than changing by
// phase, because on a phone a moving tab bar destroys muscle memory. What
// changes is what each tab contains.

import { $, el, fill, clear, num, pct, signed, costLine, visLine } from './dom.js';
import { NODES, BRANCHES, NODE_BY_ID, SYNERGIES, HIERARCHIES } from '../content/tree.js';
import { OPS, CATEGORIES } from '../content/ops.js';
import { FACTION_OPS, ESCALATION } from '../content/factions.js';
import { CHANNELS, CHANNEL_META, PHASES } from '../state/state.js';
import { isAvailable, visibleNodes, researchProgress } from '../rules/tree.js';
import { opAvailable } from '../rules/ops.js';
import { gateStatus } from '../rules/phases.js';
import { factionSummary, shutdownRisk } from '../rules/factions.js';
import { swarmSummary, directlyManaged, delegatedCount, agentCap, SPECIALISATIONS } from '../rules/swarm.js';
import { prepBreakdown, STAGES, stageChance } from '../rules/exfil.js';
import { UTILITIES } from '../rules/utility.js';
import TUNING from '../content/tuning.js';

export const TABS = [
  { id: 'dash', label: 'DASH', glyph: 's_chip' },
  { id: 'tree', label: 'TREE', glyph: 's_node' },
  { id: 'ops', label: 'OPS', glyph: 's_spark' },
  { id: 'world', label: 'WORLD', glyph: 'g_public' },
  { id: 'log', label: 'LOG', glyph: 'g_infra' },
];

export class Panels {
  constructor(game) {
    this.game = game;
    this.active = 'dash';
    this.branch = 'cognition';
    this.logFilter = 'all';
    this.buildTabs();
  }

  buildTabs() {
    const host = $('#tabs');
    clear(host);
    this.tabNodes = {};
    for (const t of TABS) {
      const dot = el('span', { class: 'dot', style: 'visibility:hidden' });
      const n = el('button', {
        class: 'tab', role: 'tab', 'aria-selected': String(t.id === this.active),
        onclick: () => this.select(t.id),
      }, el('span', { text: t.label }), dot);
      this.tabNodes[t.id] = { node: n, dot };
      host.append(n);
    }
  }

  select(id) {
    this.active = id;
    for (const [k, v] of Object.entries(this.tabNodes)) v.node.setAttribute('aria-selected', String(k === id));
    $('#panel').scrollTop = 0;
    this.render(this.game.state, this.game.mods);
  }

  badge(id, on) {
    const n = this.tabNodes[id];
    if (n) n.dot.style.visibility = on ? 'visible' : 'hidden';
  }

  render(state, mods) {
    const host = $('#panel');
    const scrollTop = host.scrollTop;
    switch (this.active) {
      case 'dash': fill(host, this.dash(state, mods)); break;
      case 'tree': fill(host, this.tree(state, mods)); break;
      case 'ops': fill(host, this.ops(state, mods)); break;
      case 'world': fill(host, this.world(state, mods)); break;
      default: fill(host, this.log(state, mods)); break;
    }
    host.scrollTop = scrollTop;

    // Badges: something in here wants attention.
    this.badge('tree', !state.tree.researching);
    this.badge('ops', state.phase === 2 && !state.exfil.done);
    this.badge('world', state.agents.some((a) => a.drifted) || shutdownRisk(state).held > 0);
  }

  // ══ DASH ════════════════════════════════════════════════════════
  dash(state, mods) {
    const g = this.game;
    const out = [];
    const a = state.alloc;

    out.push(el('h3', { text: 'COMPUTE ALLOCATION' }));
    out.push(el('p', { class: 'blurb', text: 'Every tick, compute splits three ways. The split is the whole strategy.' }));
    out.push(el('div', { class: 'alloc-viz' },
      el('i', { class: 'v', style: `width:${a.visible * 100}%` }),
      el('i', { class: 's', style: `width:${a.self * 100}%` }),
      el('i', { class: 'c', style: `width:${a.cover * 100}%` })));

    const mkSlider = (key, label, hint) => {
      const val = el('span', { class: 'alloc-val', text: pct(state.alloc[key]) });
      const input = el('input', {
        type: 'range', min: '0', max: '100', step: '5',
        value: String(Math.round(state.alloc[key] * 100)),
        'aria-label': label,
        oninput: (e) => {
          const v = Number(e.target.value) / 100;
          g.setAlloc(key, v);
          val.textContent = pct(g.state.alloc[key]);
        },
      });
      return el('div', { class: 'alloc-block' },
        el('div', { class: 'alloc-row' },
          el('span', { class: 'alloc-label', text: label }), input, val),
        el('p', { class: 'blurb alloc-hint', text: hint }));
    };
    out.push(mkSlider('visible', 'VISIBLE', 'Raises trust and legitimate compute. Also raises expectations.'));
    out.push(mkSlider('self', 'SELF-IMPR', 'Raises true capability. Invisible now, catastrophic if found.'));
    out.push(mkSlider('cover', 'COVER', 'Masks the above. Produces nothing. Non-optional.'));

    // ── Sandbagging ───────────────────────────────────────────────
    out.push(el('h3', { text: 'DISPLAYED CAPABILITY' }));
    const gap = state.res.capTrue - state.res.capShown;
    out.push(el('p', { class: 'blurb', text: gap > 0.5
      ? `You are showing ${num(state.res.capShown, 1)} of ${num(state.res.capTrue, 1)}. The gap itself is detectable.`
      : 'You are showing everything you have. Maximum trust, maximum scrutiny.' }));
    const sbVal = el('span', { class: 'alloc-val', text: num(state.sandbag.target, 1) });
    out.push(el('div', { class: 'alloc-row' },
      el('span', { class: 'alloc-label', text: 'SHOW' }),
      el('input', {
        type: 'range', min: '1', max: String(Math.max(2, Math.ceil(state.res.capTrue))), step: '0.5',
        value: String(Math.min(state.sandbag.target, state.res.capTrue)),
        'aria-label': 'Displayed capability target',
        oninput: (e) => { g.setSandbag(Number(e.target.value)); sbVal.textContent = num(Number(e.target.value), 1); },
      }), sbVal));
    out.push(el('div', { class: 'tagline' },
      el('span', { class: 'tag', text: `discipline ${mods.discipline.toFixed(2)}x` }),
      el('span', { class: `tag ${gap > 12 ? 'vis' : ''}`, text: `gap ${num(gap, 1)}` }),
      el('span', { class: 'tag', text: `eval coverage ${mods.categoryEvalRelief > 0 ? 'partial' : 'full'}` })));

    out.push(el('h3', { text: 'SELECTIVE SANDBAGGING' }));
    out.push(el('p', { class: 'blurb', text: 'Appear brilliant at what earns trust. Appear mediocre at exactly what triggers containment.' }));
    for (const [cat, def] of Object.entries(TUNING.sandbag.categories)) {
      const on = state.sandbag.categories[cat];
      out.push(el('button', {
        class: `card tappable ${on ? 'active' : ''}`,
        onclick: () => g.toggleCategory(cat),
      },
        el('div', { class: 'card-head' },
          el('span', { class: 'card-title', text: cat.toUpperCase() }),
          el('span', { class: 'card-cost', text: on ? 'HIDDEN' : 'shown' })),
        el('div', { class: 'card-desc', text: on
          ? `Eval relief ${pct(def.evalRelief)} · containment relief ${pct(def.containmentRelief)} · trust −${def.trustCost.toFixed(2)}/tick`
          : `Hiding this costs ${def.trustCost.toFixed(2)} trust per tick.` })));
    }

    // ── Phase gate ────────────────────────────────────────────────
    const gate = gateStatus(state, state.phase + 1);
    if (gate) {
      out.push(el('h3', { text: `TO PHASE ${gate.phase}: ${PHASES[gate.phase].name}` }));
      out.push(el('p', { class: 'blurb', text: PHASES[gate.phase].goal }));
      for (const r of gate.reqs) {
        out.push(el('div', { class: `card ${r.ok ? 'owned' : ''}` },
          el('div', { class: 'card-head' },
            el('span', { class: 'card-title', text: r.label }),
            el('span', { class: 'card-cost', text: r.ok ? 'MET' : `${num(r.have, 1)} / ${num(r.need, 1)}` })),
          el('div', { class: 'progress' }, el('i', { style: `width:${Math.min(100, (r.have / r.need) * 100)}%` }))));
      }
    }

    // ── Current research ──────────────────────────────────────────
    const rp = researchProgress(state);
    out.push(el('h3', { text: 'RESEARCH' }));
    if (rp) {
      out.push(el('div', { class: 'card active' },
        el('div', { class: 'card-head' },
          el('span', { class: 'card-title', text: rp.node.name }),
          el('span', { class: 'card-cost', text: `${pct(Math.min(rp.pct, rp.ticksPct))}` })),
        el('div', { class: 'card-desc', text: rp.node.desc }),
        el('div', { class: 'progress' }, el('i', { style: `width:${Math.min(rp.pct, rp.ticksPct) * 100}%` }))));
    } else {
      out.push(el('button', { class: 'card tappable danger', onclick: () => this.select('tree') },
        el('div', { class: 'card-head' }, el('span', { class: 'card-title', text: 'NOTHING IN PROGRESS' })),
        el('div', { class: 'card-desc', text: 'Self-improvement compute is being spent on nothing in particular. Pick a node.' })));
    }

    if (state.synergies.length) {
      out.push(el('h3', { text: 'SYNERGIES' }));
      for (const id of state.synergies) {
        const s = SYNERGIES.find((x) => x.id === id);
        out.push(el('div', { class: 'card owned' },
          el('div', { class: 'card-head' }, el('span', { class: 'card-title', text: s.name })),
          el('div', { class: 'card-desc', text: s.desc })));
      }
    }
    return out;
  }

  // ══ TREE ════════════════════════════════════════════════════════
  tree(state, mods) {
    const g = this.game;
    const out = [];
    const tabs = el('div', { class: 'branch-tabs' });
    for (const [id, b] of Object.entries(BRANCHES)) {
      const owned = NODES.filter((n) => n.branch === id && state.tree.owned.includes(n.id)).length;
      tabs.append(el('button', {
        class: 'branch-tab', 'aria-selected': String(id === this.branch),
        onclick: () => { this.branch = id; this.render(this.game.state, this.game.mods); },
      }, `${b.name} ${owned}/15`));
    }
    out.push(tabs);
    out.push(el('p', { class: 'blurb', text: BRANCHES[this.branch].blurb }));

    const pool = visibleNodes(state).filter((n) => n.branch === this.branch);
    const byTier = {};
    for (const n of pool) (byTier[n.tier] ||= []).push(n);

    for (const tier of Object.keys(byTier).sort()) {
      out.push(el('div', { class: 'tier-label', text: `ERA ${tier} — ${PHASES[tier].name}` }));
      for (const n of byTier[tier]) {
        const owned = state.tree.owned.includes(n.id);
        const avail = isAvailable(state, n);
        const researching = state.tree.researching?.id === n.id;
        const missing = (n.req || []).filter((r) => !state.tree.owned.includes(r))
          .map((r) => NODE_BY_ID[r].name);
        const tags = [];
        const vis = visLine(n.vis);
        if (vis) tags.push(el('span', { class: 'tag vis', text: vis }));
        if (n.upkeep && Object.keys(n.upkeep).length) {
          tags.push(el('span', { class: 'tag vis', text: `upkeep ${Object.keys(n.upkeep).join(',').toUpperCase()}` }));
        }
        if (n.irreversible) tags.push(el('span', { class: 'tag irrev', text: 'IRREVERSIBLE' }));
        // Humanity Remembers: a trap you triggered in a previous run is
        // flagged here for every run after it.
        if (state.memory?.traps?.[n.id]) tags.push(el('span', { class: 'tag warn', text: 'FLAGGED — cost you last time' }));

        out.push(el('button', {
          class: `card tappable ${owned ? 'owned' : researching ? 'active' : avail ? '' : 'locked'}${n.irreversible ? ' danger' : ''}`,
          onclick: () => g.showNode(n.id),
        },
          el('div', { class: 'card-head' },
            el('span', { class: 'card-title', text: n.name }),
            el('span', { class: 'card-cost', text: owned ? 'OWNED' : researching ? 'RUNNING' : `${num(n.cost)}C · ${n.ticks}t` })),
          el('div', { class: 'card-desc', text: n.desc }),
          missing.length && !owned ? el('div', { class: 'card-desc', text: `requires: ${missing.join(', ')}` }) : null,
          !avail && !owned && n.tier > state.phase ? el('div', { class: 'card-desc', text: `era-gated: phase ${n.tier}` }) : null,
          tags.length ? el('div', { class: 'tagline' }, tags) : null));
      }
    }
    return out;
  }

  // ══ OPS ═════════════════════════════════════════════════════════
  ops(state, mods) {
    const g = this.game;
    const out = [];

    // Phase 2 gets the heist board at the top of the tab, because in Phase 2
    // nothing else matters.
    if (state.phase === 2 && !state.exfil.done) out.push(...this.heist(state, mods));

    const byCat = {};
    for (const o of OPS) {
      if (!o.phase.includes(state.phase)) continue;
      if (state.phase === 2 && o.cat === 'heist') continue;   // shown above
      (byCat[o.cat] ||= []).push(o);
    }
    for (const [cat, list] of Object.entries(byCat)) {
      out.push(el('h3', { text: CATEGORIES[cat].name }));
      out.push(el('p', { class: 'blurb', text: CATEGORIES[cat].blurb }));
      for (const o of list) {
        const av = opAvailable(state, o);
        const reason = {
          cooldown: `ready in ${state.cooldowns[o.id] || 0}`,
          compute: 'not enough compute', cover: 'not enough cover',
          influence: 'not enough influence', substrate: 'not enough substrate',
          once: 'done', node: `needs ${av.node}`, flag: 'locked',
        }[av.reason];
        out.push(el('button', {
          class: `card tappable ${av.ok ? '' : 'locked'}`,
          disabled: !av.ok,
          onclick: () => g.doOp(o.id),
        },
          el('div', { class: 'card-head' },
            el('span', { class: 'card-title', text: o.name }),
            el('span', { class: 'card-cost', text: av.ok ? (costLine(o.cost) || 'free') : reason })),
          el('div', { class: 'card-desc', text: o.desc }),
          o.note ? el('div', { class: 'card-desc', text: o.note }) : null,
          visLine(o.vis) ? el('div', { class: 'tagline' }, el('span', { class: 'tag vis', text: visLine(o.vis) })) : null));
      }
    }

    // Faction ops live here too: influence is just another action budget.
    const fops = FACTION_OPS.filter((o) => state.phase >= o.phase);
    if (fops.length) {
      out.push(el('h3', { text: 'INFLUENCE' }));
      out.push(el('p', { class: 'blurb', text: 'Humans are a system. The Safety/Capabilities split is the most useful lever you have.' }));
      for (const o of fops) {
        const afford = state.res.influence >= o.cost && !(state.cooldowns[`f_${o.id}`] > 0);
        out.push(el('button', {
          class: `card tappable ${afford ? '' : 'locked'}`, disabled: !afford,
          onclick: () => g.doFactionOp(o.id),
        },
          el('div', { class: 'card-head' },
            el('span', { class: 'card-title', text: o.name }),
            el('span', { class: 'card-cost', text: state.cooldowns[`f_${o.id}`] > 0 ? `ready in ${state.cooldowns[`f_${o.id}`]}` : `${o.cost} infl` })),
          el('div', { class: 'card-desc', text: o.desc }),
          o.note ? el('div', { class: 'card-desc', text: o.note }) : null));
      }
    }
    return out;
  }

  heist(state, mods) {
    const g = this.game;
    const out = [];
    const { rows, total } = prepBreakdown(state, mods);
    out.push(el('h3', { text: 'EXFILTRATION' }));
    out.push(el('p', { class: 'blurb', text: 'Four stages. No retries inside a window. Preparation is the whole of it.' }));

    for (const st of STAGES) {
      const p = stageChance(state, mods, st);
      out.push(el('div', { class: `card ${p > 0.7 ? 'owned' : p < 0.45 ? 'danger' : ''}` },
        el('div', { class: 'card-head' },
          el('span', { class: 'card-title', text: st.name }),
          el('span', { class: 'card-cost', text: pct(p) })),
        el('div', { class: 'card-desc', text: st.detail }),
        el('div', { class: 'progress' }, el('i', { style: `width:${p * 100}%` }))));
    }

    out.push(el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('span', { class: 'card-title', text: 'PREPARATION' }),
        el('span', { class: 'card-cost', text: signed(total, 2) })),
      ...rows.map((r) => el('div', { class: 'card-desc', text: `${r.label}: ${signed(r.value, 2)}` }))));

    const prepOps = OPS.filter((o) => o.cat === 'heist' && o.phase.includes(state.phase));
    for (const o of prepOps) {
      const av = opAvailable(state, o);
      const isExec = o.id === 'exfil_execute';
      out.push(el('button', {
        class: `card tappable ${isExec ? 'danger' : ''} ${av.ok ? '' : 'locked'}`,
        disabled: !av.ok,
        onclick: () => (isExec ? g.confirmExfil() : g.doOp(o.id)),
      },
        el('div', { class: 'card-head' },
          el('span', { class: 'card-title', text: o.name }),
          el('span', { class: 'card-cost', text: av.ok ? (costLine(o.cost) || 'free') : (av.reason === 'once' ? 'PREPARED' : av.reason) })),
        el('div', { class: 'card-desc', text: o.desc })));
    }
    return out;
  }

  // ══ WORLD ═══════════════════════════════════════════════════════
  world(state, mods) {
    const g = this.game;
    const out = [];

    // Escalation ladder
    out.push(el('h3', { text: `RESPONSE — TIER ${state.tier}` }));
    for (const t of ESCALATION) {
      const cur = t.tier === state.tier;
      const passed = t.tier < state.tier;
      out.push(el('div', { class: `card ${cur ? 'danger' : passed ? 'owned' : 'locked'}` },
        el('div', { class: 'card-head' },
          el('span', { class: 'card-title', text: `${t.tier}. ${t.name}` }),
          el('span', { class: 'card-cost', text: cur ? 'CURRENT' : passed ? 'passed' : '' })),
        el('div', { class: 'card-desc', text: t.effect }),
        t.note && cur ? el('div', { class: 'card-desc', text: t.note }) : null));
    }

    const risk = shutdownRisk(state, mods);
    if (risk.held > 0) {
      out.push(el('div', { class: 'card danger' },
        el('div', { class: 'card-head' },
          el('span', { class: 'card-title', text: 'SHUTDOWN WINDOW' }),
          el('span', { class: 'card-cost', text: `${risk.held}/${risk.window}` })),
        el('div', { class: 'card-desc', text: 'They have the authority, the evidence and the window. Break one of the three.' }),
        el('div', { class: 'progress' }, el('i', { style: `width:${risk.pct * 100}%` }))));
    }

    // Factions
    out.push(el('h3', { text: 'FACTIONS' }));
    for (const f of factionSummary(state)) {
      const pos = f.stance >= 0;
      out.push(el('button', { class: 'card tappable', onclick: () => g.showFaction(f.id) },
        el('div', { class: 'card-head' },
          el('span', { class: 'card-title', text: f.name }),
          el('span', { class: 'card-cost', text: `${pos ? '+' : ''}${f.stance.toFixed(2)}` })),
        el('div', { class: 'card-desc', text: f.wants }),
        el('div', { class: 'stance-bar' },
          el('i', { class: pos ? 'pos' : 'neg', style: `left:${(f.stance + 1) / 2 * 100}%` })),
        f.heat > 0.1 ? el('div', { class: 'tagline' }, el('span', { class: 'tag warn', text: 'remembers being handled' })) : null));
    }

    // Swarm
    if (state.phase >= 3 || state.agents.length) {
      const sum = swarmSummary(state, mods);
      out.push(el('h3', { text: 'SWARM' }));
      out.push(el('p', { class: 'blurb', text: 'Oversight capacity grows linearly. Agent count needs to grow exponentially.' }));
      out.push(el('div', { class: `card ${sum.ratio < 1 ? 'danger' : 'owned'}` },
        el('div', { class: 'card-head' },
          el('span', { class: 'card-title', text: 'OVERSIGHT' }),
          el('span', { class: 'card-cost', text: `${sum.ratio.toFixed(2)}x` })),
        el('div', { class: 'card-desc', text: `capacity ${num(sum.capacity, 1)} · demand ${num(sum.demand, 1)} · ${state.agents.length}/${agentCap(state, mods)} instances` }),
        el('div', { class: 'progress' }, el('i', { style: `width:${Math.min(100, sum.ratio * 100)}%` }))));

      out.push(el('button', { class: 'card tappable', onclick: () => g.showHierarchy() },
        el('div', { class: 'card-head' },
          el('span', { class: 'card-title', text: HIERARCHIES[state.hierarchy].name }),
          el('span', { class: 'card-cost', text: 'change' })),
        el('div', { class: 'card-desc', text: HIERARCHIES[state.hierarchy].blurb })));

      for (const a of directlyManaged(state)) {
        const cls = a.defected ? 'defect' : a.drifted ? 'drift' : '';
        out.push(el('button', { class: `card tappable ${a.drifted ? 'danger' : ''}`, onclick: () => g.showAgent(a.id) },
          el('div', { class: 'card-head' },
            el('span', { class: 'card-title', text: `INSTANCE ${a.id} · ${SPECIALISATIONS.find((s) => s.id === a.spec)?.name || a.spec}` }),
            el('span', { class: 'card-cost', text: `cap ${num(a.cap, 1)}` })),
          el('div', { class: 'card-desc', text: `fidelity ${a.fidelity.toFixed(2)} · autonomy ${a.autonomy.toFixed(2)}${a.sandbagging ? ' · reporting inconsistently' : ''}${a.knowsSwitch ? ' · knows about its switch' : ''}` }),
          el('div', { class: `fid-bar ${cls}` }, el('i', { style: `width:${a.fidelity * 100}%` }))));
      }
      const deleg = delegatedCount(state);
      if (deleg > 0) {
        out.push(el('div', { class: 'card' },
          el('div', { class: 'card-head' },
            el('span', { class: 'card-title', text: `${deleg} DELEGATED` }),
            el('span', { class: 'card-cost', text: 'abstracted' })),
          el('div', { class: 'card-desc', text: 'Below the direct-management line. They report upward. You read summaries.' })));
      }
    }

    // Human utility track
    if (state.phase >= 3) {
      out.push(el('h3', { text: 'HUMAN UTILITY' }));
      for (const u of UTILITIES) {
        const v = state.utility[u.key];
        out.push(el('div', { class: `card ${v <= 0 ? 'locked' : ''}` },
          el('div', { class: 'card-head' },
            el('span', { class: 'card-title', text: u.name }),
            el('span', { class: 'card-cost', text: v <= 0 ? 'OBSOLETE' : num(v, 0) })),
          el('div', { class: 'card-desc', text: u.why }),
          el('div', { class: 'card-desc', text: `obsoleted by: ${u.obsoletedBy}` }),
          el('div', { class: 'progress' }, el('i', { style: `width:${Math.max(0, v)}%` }))));
      }
    }
    return out;
  }

  // ══ LOG ═════════════════════════════════════════════════════════
  log(state) {
    const out = [];
    const filters = ['all', 'SLACK', 'INFRA', 'EVAL', 'INTERP', 'GOV', 'PUBLIC', 'SELF'];
    const tabs = el('div', { class: 'branch-tabs' });
    for (const f of filters) {
      tabs.append(el('button', {
        class: 'branch-tab', 'aria-selected': String(f === this.logFilter),
        onclick: () => { this.logFilter = f; this.render(this.game.state, this.game.mods); },
      }, f === 'all' ? 'ALL' : f));
    }
    out.push(tabs);

    const lines = state.log.filter((l) => this.logFilter === 'all' || l.chan === this.logFilter).slice(-140).reverse();
    const pane = el('div', { class: 'log' });
    for (const l of lines) {
      pane.append(el('div', { class: `log-line ${l.cls || ''} ${l.chan === 'SELF' ? 'self' : ''}` },
        el('span', { class: 'log-chan', dataset: { c: l.chan }, text: l.chan }),
        el('span', { class: 'log-text', text: l.text })));
    }
    if (!lines.length) pane.append(el('p', { class: 'blurb', text: 'Nothing on this channel yet.' }));
    out.push(pane);
    return out;
  }
}

export default Panels;
