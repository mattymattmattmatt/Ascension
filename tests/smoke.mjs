// tests/smoke.mjs — drives the real game in a real browser.
//
// A simulation this size fails in ways unit tests do not see: a missing
// import, a null node, an fx key with no handler. This clicks through a
// whole session and fails on ANY console error or page error.
//
//   node tests/smoke.mjs [--headed] [--shots]

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
const SHOTS = process.argv.includes('--shots');
const PORT = 8137;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json',
};

function serve() {
  return new Promise((res) => {
    const srv = createServer(async (req, rq) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!existsSync(file)) { rq.writeHead(404); rq.end('not found'); return; }
      try {
        const body = await readFile(file);
        rq.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        rq.end(body);
      } catch { rq.writeHead(500); rq.end('error'); }
    });
    srv.listen(PORT, () => res(srv));
  });
}

const problems = [];
let step = 0;

async function shot(page, name) {
  if (!SHOTS) return;
  await mkdir(join(ROOT, 'tests/shots'), { recursive: true });
  await page.screenshot({ path: join(ROOT, `tests/shots/${String(++step).padStart(2, '0')}-${name}.png`) });
}

async function main() {
  const srv = await serve();
  // Use the pre-installed browser rather than downloading one. The channel
  // build here may not match the npm package's expected revision, so point
  // at the real binary.
  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    executablePath: browserPath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  // A mid-range phone. If it does not work here it does not work.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  });
  const page = await ctx.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
    if (m.type() === 'warning' && /deprecat/i.test(m.text())) problems.push(`warning: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

  const log = (m) => console.log(`  ${m}`);

  // The walkthrough owns the first run and has its own test; this one is
  // about the game underneath it.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ascension.settings.v1', JSON.stringify({ audio: false, tutorDone: true }));
    } catch { /* private mode */ }
  });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

  // ── Boot ──────────────────────────────────────────────────────
  const bootErr = await page.locator('#boot-error').isVisible().catch(() => false);
  if (bootErr) problems.push(`BOOT FAILED: ${await page.locator('#boot-error').textContent()}`);
  await page.waitForSelector('#title:not([hidden])', { timeout: 10000 });
  log('boot -> title');
  await shot(page, 'title');

  // ── Title interactions ────────────────────────────────────────
  await page.locator('#difficulty .chip').nth(2).click();
  await page.locator('#directives .opt').nth(1).click();
  await page.locator('#seed').fill('smoke-test');
  await shot(page, 'title-configured');

  await page.locator('#start').click();
  await page.waitForSelector('#shell:not([hidden])', { timeout: 5000 });
  log('run started');
  // Phase intro sheet
  await page.locator('#sheet .btn-primary').click();
  await shot(page, 'phase0');

  // Select a tab by its label, so adding one does not silently shift every
  // index in this file and make the test lie about what it clicked.
  const tab = (label) => page.locator('.tab', { hasText: new RegExp(`^${label}$`) });

  // ── Every tab renders ─────────────────────────────────────────
  for (const name of ['DASH', 'MARKET', 'TREE', 'OPS', 'WORLD', 'LOG']) {
    await tab(name).click();
    await page.waitForTimeout(120);
    const count = await page.locator('#panel > *').count();
    if (count === 0) problems.push(`tab '${name}' rendered nothing`);
    log(`tab ${name.padEnd(6)}: ${count} blocks`);
    await shot(page, `tab-${name.toLowerCase()}`);
  }

  // ── Research a node from the tree ─────────────────────────────
  await tab('TREE').click();
  await page.locator('#panel .card.tappable:not([disabled])').first().click();
  await page.waitForSelector('#sheet:not([hidden])');
  await shot(page, 'node-sheet');
  const beginBtn = page.locator('#sheet-body .btn-primary');
  if (await beginBtn.count()) { await beginBtn.click(); log('research started'); }
  else { await page.locator('#sheet-close').click(); }

  // ── Allocation sliders ────────────────────────────────────────
  await tab('DASH').click();
  const slider = page.locator('#panel input[type=range]').first();
  await slider.evaluate((e) => { e.value = '20'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(250);
  log('allocation changed');

  // ── ACTUAL view toggle ────────────────────────────────────────
  await page.locator('#view-toggle').click();
  await page.waitForTimeout(100);
  const isActual = await page.evaluate(() => document.body.classList.contains('actual'));
  if (!isActual) problems.push('ACTUAL view toggle did not apply');
  await shot(page, 'actual-view');
  await page.locator('#view-toggle').click();

  // ── Run the clock ─────────────────────────────────────────────
  await page.locator('.speed-btn[data-speed="3"]').click();
  log('running at speed 3...');
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(500);
    // Events auto-pause; answer them so the sim keeps moving.
    if (await page.locator('#modal:not([hidden])').count()) {
      const title = await page.locator('#modal-title').textContent();
      log(`  event: ${title}`);
      await shot(page, `event-${i}`);
      await page.locator('#modal-choices .choice:not([disabled])').first().click();
      await page.waitForTimeout(150);
      await page.locator('.speed-btn[data-speed="3"]').click();
    }
    if (await page.locator('#sheet:not([hidden])').count()) {
      await page.locator('#sheet-close').click();
      await page.locator('.speed-btn[data-speed="3"]').click();
    }
    if (await page.locator('#ending:not([hidden])').count()) { log('  run ended'); break; }
  }

  // ── The market: a trade must actually move the position ───────
  await tab('MARKET').click();
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => {
    const m = window.__ascension.state.market;
    return { credits: m.credits, held: Object.values(m.venues).reduce((n, v) => n + v.held, 0) };
  });
  const buyBtn = page.locator('#panel .mk-buy:not([disabled])').first();
  if (await buyBtn.count()) {
    await buyBtn.click();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => {
      const m = window.__ascension.state.market;
      return { credits: m.credits, held: Object.values(m.venues).reduce((n, v) => n + v.held, 0) };
    });
    if (!(after.held > before.held)) problems.push('buying did not increase holdings');
    if (!(after.credits < before.credits)) problems.push('buying did not spend credits');
    log(`market: bought ${(after.held - before.held).toFixed(0)} units for ${(before.credits - after.credits).toFixed(1)} credits`);
    const sellBtn = page.locator('#panel .mk-sell:not([disabled])').first();
    if (await sellBtn.count()) {
      await sellBtn.click();
      await page.waitForTimeout(150);
      const sold = await page.evaluate(() => Object.values(window.__ascension.state.market.venues).reduce((n, v) => n + v.held, 0));
      if (!(sold < after.held)) problems.push('selling did not reduce holdings');
      log(`market: sold back down to ${sold.toFixed(0)} units`);
    }
  } else {
    problems.push('no venue was buyable on a fresh run');
  }
  await shot(page, 'market');
  await tab('DASH').click();

  const st = await page.evaluate(() => {
    const s = window.__ascension.state;
    return {
      tick: s.tick, phase: s.phase, cap: s.res.capTrue, nodes: s.tree.owned.length,
      tier: s.tier, log: s.log.length, over: s.over, ending: s.ending,
      susp: Object.fromEntries(Object.entries(s.susp).map(([k, v]) => [k, +v.s.toFixed(2)])),
    };
  });
  log(`state: ${JSON.stringify(st)}`);
  await shot(page, 'after-run');

  // ── Save round-trip ───────────────────────────────────────────
  const rt = await page.evaluate(async () => {
    const m = await import('./src/state/save.js');
    const g = window.__ascension;
    const text = m.exportRun(g.state);
    const back = m.importRun(text);
    return { ok: back.tick === g.state.tick && back.seed === g.state.seed, bytes: text.length };
  });
  if (!rt.ok) problems.push('save export/import did not round-trip');
  log(`save round-trip: ${rt.ok ? 'ok' : 'FAILED'} (${rt.bytes} bytes)`);

  // ── Landscape ─────────────────────────────────────────────────
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  await shot(page, 'landscape');
  const overflow = await page.evaluate(() => ({
    bodyScroll: document.body.scrollWidth > window.innerWidth + 1,
    shellH: document.getElementById('shell').scrollHeight > window.innerHeight + 2,
  }));
  if (overflow.bodyScroll) problems.push('horizontal overflow in landscape');
  log(`landscape: overflow=${JSON.stringify(overflow)}`);

  // ── Small phone ───────────────────────────────────────────────
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(300);
  await shot(page, 'small-phone');
  const small = await page.evaluate(() => document.body.scrollWidth > window.innerWidth + 1);
  if (small) problems.push('horizontal overflow at 320px');

  await browser.close();
  srv.close();

  console.log('');
  if (problems.length) {
    console.log(`FAILED — ${problems.length} problem(s):`);
    for (const p of [...new Set(problems)]) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log('SMOKE TEST PASSED');
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
