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
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

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

  // The WORLD tab in a late phase is the densest panel in the game.
  await page.locator('.tab').nth(3).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(ROOT, 'tests/shots-phases/world-tab.png') });
  await page.locator('.tab').nth(2).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(ROOT, 'tests/shots-phases/ops-tab.png') });

  await browser.close();
  srv.close();
  if (problems.length) {
    console.log(`\nFAILED:\n${[...new Set(problems)].map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('\nPHASE TOUR PASSED');
}
main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
