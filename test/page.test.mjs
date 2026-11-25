// Run: node test/page.test.mjs  (needs Playwright + Chromium, serves the repo on :8765)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // global install is fine
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  try {
    const f = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    res.writeHead(200, { 'content-type': types[extname(f)] || 'text/plain' });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end(); }
}).listen(8765);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript({ path: join(root, 'test/mock-gimbal.js') });
await page.goto('http://localhost:8765/');
await page.click('#omConnect');
await page.waitForFunction(() => document.getElementById('omRx').textContent.startsWith('yes'));
await page.waitForFunction(() => document.getElementById('omBatt').textContent === '77%');
await page.click('#runLadder');
// Steps 1-2 don't move the mock (no heartbeat yet): the page reads no change and asks us.
for (let i = 0; i < 2; i++) {
  await page.waitForSelector('.ask button:nth-child(2)', { timeout: 15000 });
  await page.click('.ask button:nth-child(2)');
}
// Step 3 adds the heartbeat: the mock moves and the page should detect it by itself.
await page.waitForSelector('#found:not([hidden])', { timeout: 20000 });
const found = await page.textContent('#found');
const results = await page.$$eval('.ladder .res', (n) => n.map((x) => x.textContent));
await page.screenshot({ path: process.env.SHOT || '/tmp/gimbal-lab.png', fullPage: true });
await browser.close(); server.close();
console.log(results.slice(0, 3), '\n', found);
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
if (!found.includes('status heartbeat')) process.exit(1);
console.log('page: test passed');
