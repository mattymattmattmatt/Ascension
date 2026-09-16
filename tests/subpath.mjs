// GitHub Pages serves a project site from /<repo>/, not from /. Any absolute
// path in the game would 404 there and nowhere else, so serve it from a
// subdirectory and check it still boots.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PREFIX = '/Ascension';
const PORT = 8141;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };

const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith(PREFIX)) { res.writeHead(404); res.end('outside project scope'); return; }
  p = p.slice(PREFIX.length) || '/';
  if (p === '/' || p === '') p = '/index.html';
  const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
});
await new Promise((r) => srv.listen(PORT, r));

function browserPath() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  for (const p of ['/opt/pw-browsers/chromium']) if (existsSync(p)) return p;
  return undefined;
}
const browser = await chromium.launch({ headless: true, executablePath: browserPath(), args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const bad = [];
page.on('requestfailed', (r) => bad.push(`FAILED ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));

await page.addInitScript(() => {
  try {
    localStorage.setItem('ascension.settings.v1', JSON.stringify({ audio: false, tutorDone: true }));
  } catch { /* private mode */ }
});
await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
const titleUp = await page.locator('#title:not([hidden])').count();
const bootErr = await page.locator('#boot-error:not([hidden])').count();
if (bootErr) bad.push(`boot error: ${await page.locator('#boot-error').textContent()}`);
if (!titleUp) bad.push('title screen never appeared');

// And it must still play, not merely load.
await page.locator('#start').click();
await page.waitForSelector('#shell:not([hidden])', { timeout: 5000 });
await page.locator('#sheet .btn-primary').click();
await page.locator('.speed-btn[data-speed="3"]').click();
await page.waitForTimeout(2500);
const tick = await page.evaluate(() => window.__ascension.state.tick);
if (tick < 2) bad.push(`simulation did not advance (tick ${tick})`);

await browser.close(); srv.close();
if (bad.length) { console.log(`SUBPATH TEST FAILED:\n${[...new Set(bad)].map((b) => `  - ${b}`).join('\n')}`); process.exit(1); }
console.log(`SUBPATH TEST PASSED — boots and runs from ${PREFIX}/ (reached tick ${tick})`);
