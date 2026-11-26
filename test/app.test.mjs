// Smoke test of the main app in headless Chromium: fake camera, mock OM 4 (test/mock-gimbal.js),
// and a stub tracker that always sees a face on the right of the frame.
// Run: node test/app.test.mjs   (needs Playwright + Chromium; serves the repo on :8767)
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    const f = join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch { res.writeHead(404); res.end(); }
}).listen(8767);

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
await page.addInitScript({ path: join(root, 'test/mock-gimbal.js') });
await page.addInitScript(() => {
  localStorage.setItem('rig0.model', 'om4');
  localStorage.setItem('om4.wakeStep', 'heartbeat');
  if (!localStorage.getItem('gimbal-app.settings')) localStorage.setItem('gimbal-app.settings', JSON.stringify({ autoCheckDirs: false }));
  // Fake camera: a canvas stream (macOS blocks real/fake devices for automated browsers).
  const fakeStream = () => {
    const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
    const g = c.getContext('2d'); let f = 0;
    setInterval(() => { g.fillStyle = '#234'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fc6'; g.beginPath(); g.arc(540, 150, 40 + (f++ % 10), 0, 7); g.fill(); }, 33);
    return c.captureStream(30);
  };
  // Mics like the owner's S24: "Default" is dead (digital silence), "Speakerphone" hears.
  const audioStream = (alive) => {
    const ac = new AudioContext(); const dst = ac.createMediaStreamDestination();
    if (alive) { const o = ac.createOscillator(); const g = ac.createGain(); g.gain.value = 0.05; o.connect(g).connect(dst); o.start(); }
    else { const c = ac.createConstantSource(); c.offset.value = 0; c.connect(dst); c.start(); }
    const s = dst.stream; s.getAudioTracks()[0].__mic = alive ? 'Speakerphone' : 'Default'; return s;
  };
  window.__audioCtxResume = () => {};
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c.audio && !c.video) { const id = c.audio?.deviceId?.exact || 'default'; return audioStream(id === 'spk'); }
    return fakeStream();
  };
  navigator.mediaDevices.enumerateDevices = async () => [
    { kind: 'videoinput', deviceId: 'fake-cam', label: 'Fake camera', groupId: 'g' },
    { kind: 'audioinput', deviceId: 'default', label: 'Default', groupId: 'a' },
    { kind: 'audioinput', deviceId: 'spk', label: 'Speakerphone', groupId: 'a' },
  ];
  // Fake speech engine: records which mic track it was started with.
  window.__srStarts = [];
  class FakeSR { start(track) { window.__srStarts.push(track ? track.__mic : 'browser-default'); setTimeout(() => this.onstart?.(), 10); }
    stop() { setTimeout(() => this.onend?.(), 10); } abort() {} }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  window.__sign = null;
  window.__makeGestures = async () => ({ detect: () => window.__sign, close() {} });
  window.__makeTracker = async () => ({ detect: () => [{ x: 0.85, y: 0.42, w: 0.15, h: 0.2, score: 1, facing: 0.9 }], close() {} });
});

try {
  await page.goto('http://localhost:8767/index.html');
  await page.waitForFunction(() => window.__app?.rigs?.length === 1);
  await page.waitForFunction(() => document.querySelector('.rig video').videoWidth > 0, null, { timeout: 10000 });

  // Connect the (mock) gimbal
  await page.click('.rig .connect');
  await page.waitForFunction(() => /✓/.test(document.querySelector('.rig .connect').textContent), null, { timeout: 10000 });

  // Stored direction-check result reverses that axis on the gimbal
  await page.evaluate(() => { const r = window.__app.active; localStorage.setItem(r.dirsKey(), JSON.stringify({ pan: 'ok', tilt: 'flip' })); r.applySettings(); });
  assert.deepEqual(await page.evaluate(() => [window.__app.active.gimbal.settings.invertPan, window.__app.active.gimbal.settings.invertTilt]), [false, true]);
  // The check runs and reports even when the picture can't tell (test camera doesn't move)
  const dirs = await page.evaluate(() => window.__app.checkDirections());
  assert.deepEqual(dirs, { pan: null, tilt: null });
  assert.match(await page.textContent('.rig .status'), /Directions:/);
  assert.equal(await page.evaluate(() => window.__app.active.gimbal.settings.invertTilt), true, 'unsure check keeps the earlier answer');

  // Follow: face is right of centre, so the app must send rotate commands
  const before = await page.evaluate(() => window.__sentPackets.length);
  await page.click('#btnFollow');
  await page.waitForFunction(() => document.getElementById('btnFollow').getAttribute('aria-pressed') === 'true');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__sentPackets.length);
  assert.ok(after > before + 5, `follow sent ${after - before} packets`);
  const offset = await page.evaluate(() => window.__app.active.gimbal.offset.pan);
  assert.ok(Math.abs(offset) > 0.5, `gimbal pan offset moved (${offset})`);
  await page.click('#btnFollow');

  // Voice command path (speech engine itself isn't available headless)
  await page.evaluate(() => window.__app.applyVoice({ cmd: 'follow-on' }));
  assert.equal(await page.getAttribute('#btnFollow', 'aria-pressed'), 'true');
  await page.evaluate(() => window.__app.applyVoice({ cmd: 'follow-off' }));
  assert.equal(await page.getAttribute('#btnFollow', 'aria-pressed'), 'false');

  // Voice is on from the start (hands-free) and listens on the working mic (Speakerphone),
  // not the dead Default. The button turns it off and the choice is remembered.
  await page.waitForFunction(() => window.__srStarts.length > 0, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.__srStarts[0]), 'Speakerphone', 'voice uses the live mic');
  assert.equal(await page.getAttribute('#btnVoice', 'aria-pressed'), 'true', 'voice on without a tap');
  await page.click('#btnVoice');
  assert.equal(await page.getAttribute('#btnVoice', 'aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gimbal-app.settings')).voiceOn), false, 'off is remembered');

  // Record: picture + sound, saved as a file on the device (Downloads when no folder is picked)
  await page.click('#btnRecord');
  await page.waitForFunction(() => document.getElementById('btnRecord').getAttribute('aria-pressed') === 'true');
  await page.waitForTimeout(2500);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#btnRecord')]);
  const recPath = (process.env.SHOT || '/tmp/gimbal-app.png').replace(/\.png$/, '') + '-take';
  await dl.saveAs(recPath);
  assert.match(dl.suggestedFilename(), /^Gimbal \d{4}-\d\d-\d\d .*\.(mp4|webm)$/);
  const { execFileSync } = await import('node:child_process');
  const kinds = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', recPath]).toString().trim().split(/\s+/).sort();
  assert.deepEqual(kinds, ['audio', 'video'], `take has picture and sound (${kinds})`);
  await page.waitForFunction(() => /Saved on this device: Downloads\//.test(document.getElementById('toast').textContent));

  // Hand signals: hold ✋ → 3-2-1 → recording; hold ✋ again → stops and saves.
  const sign = async (g, ms) => { await page.evaluate((x) => { window.__sign = x; }, g); await page.waitForTimeout(ms); await page.evaluate(() => { window.__sign = null; }); await page.waitForTimeout(1000); };
  await sign('palm', 1500);
  assert.ok(await page.evaluate(() => window.__app.counting || window.__app.recording), 'palm starts the countdown');
  await page.waitForFunction(() => window.__app.recording, null, { timeout: 5000 });
  await page.waitForTimeout(1000);
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), sign('palm', 1500)]);
  assert.match(dl2.suggestedFilename(), /^Gimbal .*\.(mp4|webm)$/, 'palm stops and saves');
  assert.equal(await page.evaluate(() => window.__app.recording), false);
  // ✌️ toggles follow
  const f0 = await page.getAttribute('#btnFollow', 'aria-pressed');
  await sign('peace', 1500);
  assert.notEqual(await page.getAttribute('#btnFollow', 'aria-pressed'), f0, 'peace sign toggles follow');
  await sign('peace', 1500);
  assert.equal(await page.getAttribute('#btnFollow', 'aria-pressed'), f0);
  // Voice "start recording" counts down too; "stop recording" during the countdown cancels.
  await page.evaluate(() => window.__app.applyVoice({ cmd: 'record-start' }));
  assert.equal(await page.evaluate(() => window.__app.counting), true, 'voice start counts down');
  await page.evaluate(() => window.__app.applyVoice({ cmd: 'record-stop' }));
  await page.waitForTimeout(3500);
  assert.equal(await page.evaluate(() => window.__app.recording), false, 'cancelled countdown never records');
  // Walking mode uses the gentler follow settings
  await page.evaluate(() => { window.__app.settings.trackMode = 'body'; window.__app.rigs.forEach((r) => r.applySettings()); });
  assert.equal(await page.evaluate(() => window.__app.active.follow.s.smoothing), 0.3, 'walking smoothing applied');
  await page.evaluate(() => { window.__app.settings.trackMode = 'face'; window.__app.rigs.forEach((r) => r.applySettings()); });

  // Prompter: paste a script, play, it scrolls
  await page.click('#btnMore');
  await page.click('[role="tab"][data-tab="script"]');
  await page.fill('#scriptText', 'Line one of the script.\n'.repeat(40));
  await page.click('#prPlay');
  await page.waitForTimeout(1200);
  const tf = await page.evaluate(() => document.getElementById('prompterText').style.transform);
  assert.match(tf, /translateY\(-?\d/, 'prompter transform set');
  const y1 = Number(tf.match(/translateY\((-?[\d.]+)px/)[1]);
  await page.waitForTimeout(800);
  const y2 = Number((await page.evaluate(() => document.getElementById('prompterText').style.transform)).match(/translateY\((-?[\d.]+)px/)[1]);
  assert.ok(y2 < y1, `prompter scrolls (${y1} -> ${y2})`);
  await page.evaluate(() => window.__app.applyVoice({ cmd: 'prompter-pause' }));

  // Moves sheet renders presets
  await page.click('#btnMore');
  const moves = await page.$$eval('#movesList .item', (n) => n.length);
  assert.ok(moves >= 4, 'preset moves listed');
  await page.click('[data-close]');

  // Settings persist
  await page.click('#btnMore');
  await page.click('[role="tab"][data-tab="settings"]');
  await page.selectOption('#setFraming', 'left');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('gimbal-app.settings')).framing), 'left');
  assert.match(await page.textContent('#folderInfo'), /Recordings save to: Downloads|Recordings go to Downloads/);
  await page.click('#micTest');
  await page.waitForFunction(() => document.querySelectorAll('#micResults .item').length === 2, null, { timeout: 10000 });
  const micRows = await page.$$eval('#micResults .item', (n) => n.map((x) => x.textContent));
  assert.match(micRows[0], /Default: DEAD/); assert.match(micRows[1], /Speakerphone: works/);
  await page.click('[data-close]');

  // Manifest + service worker reachable
  const mf = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  assert.equal(mf.short_name, 'Gimbal');
  await page.screenshot({ path: process.env.SHOT || '/tmp/gimbal-app.png' });

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`app: ok (follow sent ${after - before} packets, pan offset ${offset.toFixed(1)}°, prompter ${y1.toFixed(0)}→${y2.toFixed(0)}px, ${moves} moves)`);
} finally {
  await browser.close(); server.close();
}
