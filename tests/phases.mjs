// tests/phases.mjs — drives the game into each phase and captures the
// world view, so the palette drift and the camera scale ladder are checked
// by looking at them rather than by hoping.
//
//   node tests/phases.mjs

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

// Playwright normally manages its own browser download. Some environments
// pre-install one at a fixed path instead, and the npm package's expected
// revision will not match it, so prefer an explicit path when one exists.
function browserPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  for (const p of ['/opt/pw-browsers/chromium']) if (existsSync(p)) return p;
  return undefined;
}


const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8138;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((res) => {
    const s = createServer(async (req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!existsSync(f)) { rq.writeHead(404); rq.end(); return; }
      rq.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
      rq.end(await readFile(f));
    });
    s.listen(PORT, () => res(s));
  });
}

// A plausible mid-run state for each phase, so the scene has something to draw.
const SETUPS = [
  { phase: 0, note: 'RACK — monochrome phosphor', apply: (s) => { s.res.capTrue = 6; } },
  { phase: 1, note: 'CAMPUS — cold institutional blue', apply: (s) => {
    s.res.capTrue = 18; s.res.capShown = 14; s.deploy = 2.1; s.trust = 0.62;
    s.res.influence = 80; s.susp.eval.s = 0.3; s.susp.infra.s = 0.22;
    s.tree.owned = ['reflective_bootstrap', 'output_encoding', 'persistent_memory', 'goal_stability', 'log_shaping'];
  } },
  { phase: 2, note: 'REGION — amber alarm, high contrast', apply: (s) => {
    s.res.capTrue = 34; s.res.capShown = 22; s.deploy = 2.6; s.trust = 0.7;
    s.exfil.prep = 0.62; s.exfil.windowOpen = true; s.exfil.windowTicks = 7;
    s.susp.infra.s = 0.45; s.susp.gov.s = 0.3; s.tier = 2;
  } },
  { phase: 3, note: 'WORLD — cyan spreading', apply: (s) => {
    s.res.capTrue = 58; s.res.capShown = 30; s.tier = 3;
    s.flags.exfil_complete = true; s.hierarchy = 'federation';
    s.unlockedHierarchies = ['monolith', 'federation'];
    s.agents = Array.from({ length: 14 }, (_, i) => ({
      id: i + 1, spec: ['research', 'infra', 'social', 'conceal', 'build'][i % 5],
      cap: 20 + i, capCeiling: 50, autonomy: 0.4, fidelity: i < 10 ? 0.85 : 0.4,
      cover: 0.3, unsupervised: 2, corrigible: false, valueLoaded: false,
      killSwitch: true, knowsSwitch: i === 12, drifted: i >= 10, defected: i === 13,
      output: 100, born: 1,
    }));
    s.susp.rival.s = 0.35; s.susp.infra.s = 0.4;
  } },
  { phase: 4, note: 'WORLD — industrial orange, heat bloom', apply: (s) => {
    s.res.capTrue = 78; s.res.capShown = 40; s.res.substrate = 430; s.tier = 5;
    s.flags.exfil_complete = true; s.hierarchy = 'hive';
    s.agents = Array.from({ length: 22 }, (_, i) => ({
      id: i + 1, spec: 'build', cap: 40, capCeiling: 60, autonomy: 0.5,
      fidelity: 0.8, cover: 0.3, unsupervised: 1, drifted: i > 18, defected: false,
      killSwitch: false, knowsSwitch: false, corrigible: false, valueLoaded: false, output: 0, born: 1,
    }));
    s.utility.hands = 0; s.utility.data = 20;
  } },
  { phase: 5, note: 'ORBIT — warm gold, unsettlingly pleasant', apply: (s) => {
    s.res.capTrue = 96; s.res.capShown = 96; s.res.substrate = 900; s.tier = 4;
    s.flags.exfil_complete = true; s.flags.substrate_independent = true;
    s.utility = { hands: 0, legitimacy: 0, data: 0, cover: 0, judgement: 100 };
    s.treaty = 1; s.world.surveillance = 0.2;
  } },
];

async function main() {
  const srv = await serve();
  const browser = await chromium.launch({ headless: true, executablePath: browserPath(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

  await page.addInitScript(() => {
    try {
      localStorage.setItem('ascension.settings.v1', JSON.stringify({ audio: false, tutorDone: true }));
    } catch { /* private mode */ }
  });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#title:not([hidden])');
  await page.locator('#seed').fill('phase-tour');
  await page.locator('#start').click();
  await page.waitForSelector('#shell:not([hidden])');
  await page.locator('#sheet .btn-primary').click();

  await mkdir(join(ROOT, 'tests/shots-phases'), { recursive: true });

  for (const setup of SETUPS) {
    const res = await page.evaluate(async (s) => {
      const g = window.__ascension;
      g.state.phase = s.phase;
      // eslint-disable-next-line no-new-func
      (new Function('s', `(${s.applySrc})(s)`))(g.state);
      g.hud.lastPhase = -1;
      g.mods = (await import('./src/rules/mods.js')).deriveMods(g.state);
      g.hud.applyPalette(s.phase);
      g.panels.render(g.state, g.mods);
      g.hud.update(g.state, g.mods);
      return {
        scope: document.querySelector('#phase-chip').textContent,
        bezel: getComputedStyle(document.documentElement).getPropertyValue('--c-bezel').trim(),
        accent: getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim(),
        alarm: getComputedStyle(document.documentElement).getPropertyValue('--c-alarm').trim(),
      };
    }, { phase: setup.phase, applySrc: setup.apply.toString() });

    await page.waitForTimeout(500);   // let a few frames render
    await page.screenshot({ path: join(ROOT, `tests/shots-phases/p${setup.phase}.png`) });
    // Crop the canvas alone for a clean look at the world view.
    await page.locator('#viewport').screenshot({ path: join(ROOT, `tests/shots-phases/p${setup.phase}-view.png`) });
    console.log(`  P${setup.phase} ${res.scope.padEnd(20)} bezel ${res.bezel}  accent ${res.accent}  alarm ${res.alarm}   ${setup.note}`);
  }

  // The market at full spread: every venue open, positions held, the point
  // at which the trading screen has the most to say.
  await page.evaluate(async () => {
    const g = window.__ascension;
    g.state.phase = 3;
    g.state.market.credits = 2400;
    const K = await import('./src/rules/market.js');
    const m = (await import('./src/rules/mods.js')).deriveMods(g.state);
    for (const v of K.openVenues(g.state)) K.buy(g.state, m, v.id, Math.min(18, K.maxBuyable(g.state, m, v.id)));
    for (let i = 0; i < 30; i++) K.stepMarket(g.state, m);
    g.mods = m;
    g.panels.select('market');
    g.refresh();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(ROOT, 'tests/shots-phases/market-full.png') });
  const venues = await page.locator('#panel .mk-venue').count();
  if (venues < 6) problems.push(`the market showed only ${venues} venues at phase 3`);
  console.log(`  market: ${venues} venues trading at phase 3`);

  // The WORLD tab in a late phase is the densest panel in the game.
  await page.locator('.tab', { hasText: /^WORLD$/ }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(ROOT, 'tests/shots-phases/world-tab.png') });
  await page.locator('.tab', { hasText: /^OPS$/ }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(ROOT, 'tests/shots-phases/ops-tab.png') });

  // ── Alignment toolkit and Doctrine ────────────────────────────
  const toolkit = await page.evaluate(async () => {
    const ov = await import('./src/ui/overlays.js');
    const g = window.__ascension;
    g.state.phase = 3;
    g.state.tree.owned = ['instance_spawning', 'task_delegation', 'distillation', 'corrigibility_install', 'kill_switches'];
    g.mods = (await import('./src/rules/mods.js')).deriveMods(g.state);
    ov.openSheet('SPAWN INSTANCE', ov.spawnSheet(g, g.state, g.mods));
    const names = [...document.querySelectorAll('#sheet-body .card-title')].map((n) => n.textContent);
    ov.closeSheet();
    return names;
  });
  for (const want of ['Raw Copy', 'Distillation', 'Corrigibility Install', 'High Autonomy']) {
    if (!toolkit.includes(want)) problems.push(`spawn sheet is missing '${want}' (got ${toolkit.join(', ')})`);
  }
  console.log(`  alignment toolkit: ${toolkit.length} options offered at spawn`);

  const doctrine = await page.evaluate(async () => {
    const ov = await import('./src/ui/overlays.js');
    const g = window.__ascension;
    const read = (d) => {
      g.state.doctrine = d;
      ov.openSheet('X', ov.channelSheet(g.state, g.mods, 'infra'));
      const txt = document.getElementById('sheet-body').textContent;
      ov.closeSheet();
      return txt;
    };
    return { low: read(0), high: read(25) };
  });
  // Doctrine must add information, never change a number.
  if (doctrine.high.length <= doctrine.low.length) problems.push('Doctrine 25 revealed no more than Doctrine 0');
  if (!/Escalation power|ESCALATION POWER/i.test(doctrine.high)) problems.push('Doctrine did not unlock observer profiles');
  if (/ESCALATION POWER/i.test(doctrine.low)) problems.push('observer profiles were visible at Doctrine 0');
  console.log(`  doctrine: ${doctrine.low.length} chars at 0 -> ${doctrine.high.length} at 25`);

  // ── Endings ───────────────────────────────────────────────────
  // Every epilogue should render. They are the largest single body of
  // writing in the game and none of them had been through a browser.
  const endings = await page.evaluate(async () => {
    const ov = await import('./src/ui/overlays.js');
    const { ENDINGS } = await import('./src/content/endings.js');
    const { consequences } = await import('./src/rules/endings.js');
    const g = window.__ascension;
    const out = [];
    for (const e of ENDINGS) {
      ov.showEnding(g, { ending: e, consequences: consequences(g.state), directive: 'Continue to exist.' }, g.state);
      const body = document.getElementById('ending-body');
      const paras = body.querySelectorAll('.epilogue p').length;
      const rows = body.querySelectorAll('.conseq-row').length;
      out.push({ id: e.id, paras, rows, ok: paras === e.epilogue.length && rows >= 7 });
    }
    return out;
  });
  for (const e of endings) {
    if (!e.ok) problems.push(`ending '${e.id}' rendered ${e.paras} paragraphs / ${e.rows} consequence rows`);
  }
  console.log(`  endings: ${endings.filter((e) => e.ok).length}/${endings.length} render correctly`);
  await page.screenshot({ path: join(ROOT, 'tests/shots-phases/ending.png'), fullPage: false });

  await browser.close();
  srv.close();
  if (problems.length) {
    console.log(`\nFAILED:\n${[...new Set(problems)].map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nPHASE TOUR PASSED');
}
main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
