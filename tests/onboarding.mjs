// tests/onboarding.mjs — the walkthrough, the objective bar and the zoom lock.
//
// These are the three things a first-time player hits before anything else,
// so they get their own test rather than riding along in the smoke test.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8143;
const SHOTS = process.argv.includes('--shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };

function browserPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  for (const p of ['/opt/pw-browsers/chromium']) if (existsSync(p)) return p;
  return undefined;
}

const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
});
await new Promise((r) => srv.listen(PORT, r));

const browser = await chromium.launch({ headless: true, executablePath: browserPath(), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });

let shot = 0;
const snap = async (n) => {
  if (!SHOTS) return;
  await mkdir(join(ROOT, 'tests/shots-onboarding'), { recursive: true });
  await page.screenshot({ path: join(ROOT, `tests/shots-onboarding/${String(++shot).padStart(2, '0')}-${n}.png`) });
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('#title:not([hidden])');

// ── Zoom lock ───────────────────────────────────────────────────────
const meta = await page.getAttribute('meta[name=viewport]', 'content');
for (const want of ['user-scalable=no', 'maximum-scale=1']) {
  if (!meta.includes(want)) problems.push(`viewport meta is missing ${want}`);
}
const gestureBlocked = await page.evaluate(() => {
  const e = new Event('gesturestart', { cancelable: true, bubbles: true });
  document.dispatchEvent(e);
  return e.defaultPrevented;
});
if (!gestureBlocked) problems.push('pinch-zoom (gesturestart) is not being cancelled');
const wheelBlocked = await page.evaluate(() => {
  const e = new WheelEvent('wheel', { cancelable: true, bubbles: true, ctrlKey: true, deltaY: -10 });
  document.dispatchEvent(e);
  return e.defaultPrevented;
});
if (!wheelBlocked) problems.push('trackpad pinch (ctrl+wheel) is not being cancelled');
const vh = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vh').trim());
if (!vh.endsWith('px')) problems.push(`--vh was not published (got "${vh}")`);
console.log(`  zoom lock: gesture ${gestureBlocked ? 'blocked' : 'OPEN'}, ctrl+wheel ${wheelBlocked ? 'blocked' : 'OPEN'}, --vh ${vh}`);

// ── HOW TO PLAY is reachable before a run starts ────────────────────
await page.locator('#open-howto').click();
await page.waitForSelector('#sheet:not([hidden])');
const howto = (await page.locator('#sheet-body').textContent()).length;
if (howto < 1200) problems.push(`HOW TO PLAY is only ${howto} characters`);
await snap('howto');
await page.locator('#sheet-close').click();
console.log(`  how-to-play: ${howto} characters, reachable from the title screen`);

// ── The walkthrough ─────────────────────────────────────────────────
await page.locator('#start').click();
await page.waitForSelector('#shell:not([hidden])');
await page.waitForSelector('.tutor:not([hidden])', { timeout: 4000 }).catch(() => problems.push('the walkthrough did not start on a first run'));

const titles = [];
for (let i = 0; i < 12; i++) {
  if (await page.locator('.tutor[hidden]').count()) break;
  const t = await page.locator('.tutor-title').textContent();
  titles.push(t);
  await snap(`tutor-${i}`);

  // Do what the step asks, so the auto-advance paths are exercised.
  if (/COMPUTE SPLITS/.test(t)) {
    await page.locator('#panel input[type=range]').first()
      .evaluate((e) => { e.value = '25'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  } else if (/BECOME/.test(t)) {
    await page.locator('#panel .card.tappable').first().click();
    await page.waitForSelector('#sheet:not([hidden])');
    const begin = page.locator('#sheet-body .btn-primary');
    if (await begin.count()) await begin.click(); else await page.locator('#sheet-close').click();
  } else if (/SCREEN IS THEIRS/.test(t)) {
    await page.locator('#view-toggle').click();
  } else if (/TIME ONLY MOVES/.test(t)) {
    await page.locator('.speed-btn[data-speed="2"]').click();
  } else {
    await page.locator('.tutor-card .btn-primary, .tutor-card .btn').first().click();
  }
  await page.waitForTimeout(320);
}
if (titles.length < 7) problems.push(`the walkthrough only showed ${titles.length} steps`);
console.log(`  walkthrough: ${titles.length} steps completed`);
for (const t of titles) console.log(`      ${t}`);

const tutorGone = await page.locator('.tutor[hidden]').count();
if (!tutorGone) problems.push('the walkthrough never finished');

// ── The objective bar ───────────────────────────────────────────────
const obj = await page.locator('#obj-text').textContent();
if (!obj || obj === '—') problems.push('the objective bar is empty');
console.log(`  objective: "${obj}"`);
await snap('objective');

// It must change as the situation changes, and route to the right tab.
const states = await page.evaluate(async () => {
  const { objectiveFor } = await import('./src/ui/objective.js');
  const { deriveMods } = await import('./src/rules/mods.js');
  const g = window.__ascension;
  const base = JSON.parse(JSON.stringify(g.state));
  const out = [];
  const probe = (label, f) => {
    const s = JSON.parse(JSON.stringify(base));
    f(s);
    const o = objectiveFor(s, deriveMods(s));
    out.push({ label, text: o.text, tab: o.tab, urgent: !!o.urgent });
  };
  probe('quiet, researching', (s) => { s.tree.researching = { id: 'reflective_bootstrap', spent: 0, ticks: 0 }; });
  probe('nothing researching', (s) => { s.tree.researching = null; });
  probe('a meter is hot', (s) => { s.susp.infra.s = 0.8; });
  probe('two meters comparing notes', (s) => { s.joint = { active: true, chans: ['infra', 'eval'], ticks: 9, count: 1 }; });
  probe('phase 2, no window', (s) => { s.phase = 2; s.exfil = { ...s.exfil, prep: 0.5, windowOpen: false }; });
  probe('phase 2, window open', (s) => { s.phase = 2; s.exfil = { ...s.exfil, prep: 0.9, windowOpen: true, windowTicks: 6 }; });
  probe('an instance drifted', (s) => { s.phase = 3; s.agents = [{ id: 1, fidelity: 0.3, cap: 10 }]; });
  return out;
});
console.log('  objective adapts:');
for (const s of states) console.log(`      ${s.label.padEnd(26)} -> [${s.tab}]${s.urgent ? '!' : ' '} ${s.text}`);
if (new Set(states.map((s) => s.text)).size < 6) problems.push('the objective bar says the same thing in different situations');

// ── Nothing overflows with the new bar in place ─────────────────────
for (const [w, h, name] of [[320, 568, 'small phone'], [390, 844, 'phone'], [844, 390, 'landscape']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(250);
  const over = await page.evaluate(() => ({
    x: document.body.scrollWidth > window.innerWidth + 1,
    shell: document.getElementById('shell').scrollHeight > window.innerHeight + 2,
  }));
  if (over.x) problems.push(`horizontal overflow at ${name}`);
  if (over.shell) problems.push(`the shell is taller than the screen at ${name}`);
  await snap(`fit-${name.replace(' ', '-')}`);
}
console.log('  layout: no overflow at 320x568, 390x844 or landscape');

await browser.close(); srv.close();
if (problems.length) {
  console.log(`\nFAILED:\n${[...new Set(problems)].map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nONBOARDING TEST PASSED');
