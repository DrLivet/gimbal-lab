import { OsmoMobile, LADDER, runStep } from '../lib/om.js';
import { Explorer, short } from '../lib/explorer.js';
import { hex, h2 } from '../lib/duml.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

if (!navigator.bluetooth) $('nobt').hidden = false;

// ---------- tabs ----------
for (const b of document.querySelectorAll('[data-tab]')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('[data-tab]')) o.setAttribute('aria-selected', String(o === b));
    $('tab-om').hidden = b.dataset.tab !== 'om';
    $('tab-ex').hidden = b.dataset.tab !== 'ex';
  });
}

// ---------- log ----------
const logLines = [];
function log(line) {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  logLines.push(`[${t}] ${line}`);
  if (logLines.length > 3000) logLines.splice(0, 1000);
  $('log').textContent = logLines.slice(-400).reverse().join('\n');
}
$('clearLog').addEventListener('click', () => { logLines.length = 0; $('log').textContent = ''; });
$('copyLog').addEventListener('click', async () => {
  const text = `Gimbal Lab log (${navigator.userAgent})\n` + logLines.join('\n');
  try { await navigator.clipboard.writeText(text); log('Log copied — paste it to Claude.'); }
  catch { log('Copy failed. Select the log text and copy it by hand.'); }
});
const showNoise = () => $('showNoise').checked;

// ---------- OM 4 ----------
const g = new OsmoMobile();
let lastByKey = new Map();
let lastAttLog = 0;
let working = false;

function setConnected(on, name) {
  $('omConnect').disabled = on;
  $('omDisconnect').disabled = !on;
  $('runLadder').disabled = !on;
  $('rawSend').disabled = !on;
  $('omStatus').textContent = on ? `Connected to ${name || 'gimbal'}` : 'Not connected';
}

g.addEventListener('connected', (e) => { setConnected(true, e.detail.name); log(`Connected to ${e.detail.name}. Listening…`); });
g.addEventListener('disconnected', () => { setConnected(false); stopLadder(); log('Gimbal disconnected.'); });
g.addEventListener('sent', (e) => { if (!e.detail.quiet || showNoise()) log(`→ ${hex(e.detail.pkt)}`); });
g.addEventListener('packet', ({ detail: { m, d } }) => {
  $('omRx').textContent = `yes — ${g.rxCount} messages`;
  if (d.kind === 'battery') $('omBatt').textContent = `${d.level}%`;
  if (d.kind === 'attitude') {
    $('omAtt').textContent = `pan ${g.pan ?? '–'}°  tilt ${d.pitch}°  yaw ${d.yaw}°`;
    if (!showNoise() && performance.now() - lastAttLog < 3000) return;
    lastAttLog = performance.now();
  }
  const key = `${m.cmdSet}/${m.cmd}/${m.attr & 0x80}`;
  if (!showNoise() && d.kind !== 'attitude' && d.kind !== 'ack' && lastByKey.get(key) === d.text) return;
  lastByKey.set(key, d.text);
  log(`← ${m.crcOk ? '' : '[bad crc] '}${d.text}   [${hex(m.raw)}]`);
});

$('omConnect').addEventListener('click', async () => {
  try { await g.connect(); } catch (e) { log(`Connect failed: ${e.message}`); }
});
$('omDisconnect').addEventListener('click', () => g.disconnect());

// ----- ladder -----
let ladderRun = 0;
function renderLadder() {
  $('ladder').innerHTML = LADDER.map((s, i) => `
    <li id="step-${s.id}">
      <span class="t">${i + 1}. ${esc(s.title)}</span>
      <span class="n">${esc(s.note)}</span>
      <span class="res" id="res-${s.id}"></span>
    </li>`).join('');
}
renderLadder();

function setRes(step, text, cls) {
  const r = $(`res-${step.id}`);
  r.textContent = text;
  r.className = `res ${cls || ''}`;
}

function askUser(step) {
  return new Promise((resolve) => {
    const li = $(`step-${step.id}`);
    const box = document.createElement('div');
    box.className = 'ask';
    box.innerHTML = '<button class="primary">Moved</button><button>Didn\'t move</button>';
    li.append(box);
    const [yes, no] = box.querySelectorAll('button');
    const done = (v) => { box.remove(); resolve(v); };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    stopHooks.push(() => done(null));
  });
}

let stopHooks = [];
function stopLadder() { ladderRun++; stopHooks.forEach((f) => f()); stopHooks = []; $('runLadder').disabled = !g.device?.gatt?.connected; $('stopLadder').disabled = true; }
$('stopLadder').addEventListener('click', () => { stopLadder(); log('Test stopped.'); });

$('runLadder').addEventListener('click', async () => {
  const run = ++ladderRun;
  renderLadder();
  working = false;
  $('found').hidden = true;
  $('runLadder').disabled = true;
  $('stopLadder').disabled = false;
  log(`Starting wake-up test. Gimbal talking back: ${g.rxCount > 0 ? 'yes' : 'not yet'}.`);
  for (const step of LADDER) {
    if (run !== ladderRun) return;
    const li = $(`step-${step.id}`);
    li.classList.add('active');
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setRes(step, 'testing…');
    log(`— Step: ${step.title}`);
    let result;
    try { result = await runStep(g, step); } catch (e) { log(`Step failed: ${e.message}`); result = { moved: false }; }
    if (run !== ladderRun) return;
    let moved = result.moved;
    if (moved === null || moved === false) {
      if (result.haveAttitude) log(`  position changed by ${result.delta.toFixed(1)}°`);
      setRes(step, result.haveAttitude ? `no change (${result.delta.toFixed(1)}°) — did it move?` : 'did it move?');
      moved = await askUser(step);
      if (moved === null) return;
    } else {
      log(`  position changed by ${result.delta.toFixed(1)}° ✅`);
    }
    li.classList.remove('active');
    setRes(step, moved ? 'MOVED ✅' : 'no ✖', moved ? 'yes' : 'no');
    log(`  result: ${moved ? 'MOVED' : 'did not move'}`);
    if (moved) {
      working = true;
      try { localStorage.setItem('om4.wakeStep', step.id); } catch { /* private mode */ }
      $('found').hidden = false;
      $('found').textContent = `Found it: step "${step.title}" moves your gimbal. The app will now use this automatically. Tap Copy log and send it to Claude, then try the arrows below.`;
      break;
    }
  }
  if (!working) log('No step moved the gimbal. Tap Copy log and send it to Claude.');
  stopLadder();
});

// ----- pad -----
const DIRS = { left: { yaw: -4 }, right: { yaw: 4 }, up: { pitch: 4 }, down: { pitch: -4 } };
for (const b of document.querySelectorAll('[data-move]')) {
  let t = null;
  const stop = () => { clearInterval(t); t = null; };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!g.device?.gatt?.connected) return log('Connect first.');
    const send = () => g.rotate({ ...DIRS[b.dataset.move], time: 0.3 }).catch((err) => log(err.message));
    send(); t = setInterval(send, 250);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
}
let sweepT = null;
$('sweep').addEventListener('click', () => {
  if (sweepT) { clearInterval(sweepT); sweepT = null; $('sweep').textContent = 'Sweep'; return; }
  if (!g.device?.gatt?.connected) return log('Connect first.');
  let dir = 1;
  const go = () => { g.rotate({ yaw: 30 * dir, time: 1.5 }).catch((err) => log(err.message)); dir = -dir; };
  go(); sweepT = setInterval(go, 2000);
  $('sweep').textContent = 'Stop';
});

$('rawSend').addEventListener('click', () => {
  const p = (s) => parseInt(s.trim(), 16);
  const payload = $('rawPay').value.split(/[^0-9a-f]+/i).filter(Boolean).map((x) => parseInt(x, 16));
  g.send(p($('rawSet').value), p($('rawCmd').value), payload).catch((e) => log(e.message));
});

// ---------- Explorer ----------
const ex = new Explorer();
ex.addEventListener('log', (e) => log(e.detail));
ex.addEventListener('disconnected', () => {
  $('exStatus').textContent = 'Disconnected'; $('exConnect').disabled = false; $('exDisconnect').disabled = true; $('exSend').disabled = true;
  log('Explorer: disconnected.');
});
ex.addEventListener('rx', ({ detail }) => log(`← ${short(detail.uuid)}  ${hex(detail.bytes)}`));
ex.addEventListener('tx', ({ detail }) => log(`→ ${short(detail.uuid)}  ${hex(detail.bytes)}`));
ex.addEventListener('connected', ({ detail }) => {
  $('exStatus').textContent = `Connected to ${detail.name || 'device'} — ${detail.chars.length} characteristics found`;
  $('exConnect').disabled = true; $('exDisconnect').disabled = false;
  const writable = detail.chars.filter((c) => c.props.includes('write') || c.props.includes('writeWithoutResponse'));
  $('exTarget').innerHTML = writable.map((c) => `<option value="${esc(c.uuid)}">${esc(short(c.uuid))}</option>`).join('');
  $('exSend').disabled = !writable.length;
  $('exChars').innerHTML = detail.chars.length ? `<table class="chars"><thead><tr><th>Service</th><th>Characteristic</th><th>Can</th><th>Value</th></tr></thead><tbody>${
    detail.chars.map((c) => `<tr><td><code>${esc(short(c.service))}</code></td><td><code>${esc(short(c.uuid))}</code></td><td>${esc(c.props.join(', '))}${c.listening ? ' 👂' : ''}</td><td><code>${c.value ? esc(hex(c.value)) : ''}</code></td></tr>`).join('')
  }</tbody></table>` : '<p class="warn">No services visible. Try adding service IDs in "Extra service IDs" and reconnect.</p>';
  log(`Explorer: ${detail.name}. Services: ${detail.services.map(short).join(', ') || 'none visible'}`);
  for (const c of detail.chars) log(`  ${short(c.service)} / ${short(c.uuid)}  [${c.props.join(', ')}]${c.value ? '  value ' + hex(c.value) : ''}`);
});
$('exConnect').addEventListener('click', async () => {
  try { await ex.connect({ namePrefix: $('exName').value.trim(), extra: $('exExtra').value }); }
  catch (e) { log(`Explorer connect failed: ${e.message}`); }
});
$('exDisconnect').addEventListener('click', () => ex.disconnect());
$('exSend').addEventListener('click', () => ex.write($('exTarget').value, $('exHex').value).catch((e) => log(e.message)));

export { h2 };
