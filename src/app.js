// Gimbal Studio: the main app screen.
// A "rig" is one camera + (optionally) one gimbal + a face/body tracker + a follow controller.
// Phone: one full-screen rig. Mac: a grid of rigs, with OBS scene switching to the camera you face.
import { MODELS } from '../lib/gimbal.js';
import { Follow, pickTarget, FRAMING } from './follow.js';
import { Tracker } from './tracker.js';
import { Voice } from './voice.js';
import { PRESETS, loadCustom, saveCustom, play as playMove, MoveRecorder } from './moves.js';
import { Obs } from './obs.js';
import { findWorkingMic, testAllMics } from './mic.js';
import { canPickFolder, pickFolder, forgetFolder, getFolder, openTake, takeName } from './saver.js';
import { load as loadSettings, save as saveSettings } from './store.js';

const $ = (id) => document.getElementById(id);
const S = loadSettings();
const persist = () => saveSettings(S);
const VERSION = '2026-11-26';

// ---------- toast ----------
let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- rigs ----------
const rigs = [];
let active = null;          // rig the dock controls
let live = null;            // rig currently on air (studio auto-switch)

async function listCameras() {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); }
  catch { return []; }
}

class Rig {
  constructor(index) {
    this.index = index;
    this.el = $('rigTpl').content.firstElementChild.cloneNode(true);
    this.video = this.el.querySelector('video');
    this.canvas = this.el.querySelector('canvas');
    this.camSel = this.el.querySelector('.cam');
    this.modelSel = this.el.querySelector('.model');
    this.btnConnect = this.el.querySelector('.connect');
    this.statusEl = this.el.querySelector('.status');
    this.gimbal = null;
    this.stream = null;
    this.tracker = null;
    this.trackerMode = null;
    this.follow = new Follow(this.followSettings());
    this.following = false;
    this.lastTarget = null;
    this.facing = 0;          // how directly the person faces this camera (0..1)
    this.selfie = false;
    this.lastT = performance.now();
    this.lastDetect = 0;

    for (const [id, m] of Object.entries(MODELS)) this.modelSel.add(new Option(m.label, id));
    this.modelSel.value = localStorage.getItem(`rig${index}.model`) || (index === 1 ? 'scorp' : 'om4');
    this.modelSel.onchange = () => localStorage.setItem(`rig${index}.model`, this.modelSel.value);
    this.btnConnect.onclick = () => (this.gimbal?.connected ? this.disconnect() : this.connect());
    this.camSel.onchange = () => { localStorage.setItem(`rig${index}.cam`, this.camSel.value); this.startCamera(this.camSel.value); };
    this.el.addEventListener('pointerdown', () => setActive(this));
    const rm = this.el.querySelector('.remove');
    rm.hidden = index === 0;
    rm.onclick = (e) => { e.stopPropagation(); removeRig(this); };
  }

  followSettings() {
    return { framing: S.framing, speed: S.speed, tiltEnabled: S.tiltEnabled, hfov: S.hfov, deadzone: S.deadzone, maxSpeed: S.maxSpeed };
  }

  applySettings() {
    this.follow.set(this.followSettings());
    if (this.gimbal) Object.assign(this.gimbal.settings, { invertPan: S.invertPan, invertTilt: S.invertTilt, method: S.method, maxSpeed: Math.max(S.maxSpeed, 30) });
    if (this.tracker && this.trackerMode !== S.trackMode) { this.tracker.close(); this.tracker = null; }
  }

  async fillCameras() {
    const cams = await listCameras();
    const keep = this.camSel.value || localStorage.getItem(`rig${this.index}.cam`) || '';
    this.camSel.innerHTML = '';
    if (!cams.length) this.camSel.add(new Option('Camera', ''));
    cams.forEach((c, i) => this.camSel.add(new Option(c.label || `Camera ${i + 1}`, c.deviceId)));
    if (cams.some((c) => c.deviceId === keep)) this.camSel.value = keep;
  }

  async startCamera(deviceId) {
    this.stream?.getTracks().forEach((t) => t.stop());
    const video = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' };
    Object.assign(video, { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (e) {
      {
        this.statusEl.textContent = 'Camera busy or blocked. Close other camera apps; retrying…';
        if (!this.retried) { this.retried = true; setTimeout(() => this.startCamera(deviceId), 2000); }
        return;
      }
    }
    this.retried = false; this.statusEl.textContent = '';
    this.video.srcObject = this.stream;
    const track = this.stream.getVideoTracks()[0];
    const fm = track?.getSettings?.().facingMode;
    // Selfie cameras: show mirrored like a mirror; on a phone the gimbal's left/right is flipped too.
    this.selfie = fm ? fm === 'user' : /front|face ?time|user/i.test(track?.label || '');
    this.el.classList.toggle('mirror', this.selfie);
    await this.fillCameras();
    if (track) {
      const id = track.getSettings?.().deviceId;
      if (id && [...this.camSel.options].some((o) => o.value === id)) this.camSel.value = id;
    }
  }

  async connect() {
    const m = MODELS[this.modelSel.value];
    if (!m?.create) return toast('That gimbal is not supported yet');
    const g = m.create();
    g.addEventListener('log', (e) => this.setStatus(e.detail));
    g.addEventListener('state', () => this.updateConnectButton());
    this.gimbal = g;
    this.applySettings();
    this.setStatus('Pick your gimbal in the list…');
    try {
      await g.connect();
      this.setStatus(`${g.name} connected`);
      toast(`${g.name} connected`);
    } catch (e) {
      this.gimbal = null;
      this.setStatus(/cancel/i.test(e.message) ? '' : `Couldn't connect: ${e.message}`);
    }
    this.updateConnectButton();
  }

  disconnect() { this.gimbal?.disconnect(); this.gimbal = null; this.updateConnectButton(); this.setStatus('Disconnected'); }

  updateConnectButton() {
    const on = !!this.gimbal?.connected;
    this.btnConnect.textContent = on ? `${this.gimbal.name} ✓` : 'Connect gimbal';
    this.btnConnect.classList.toggle('on', on);
  }

  setStatus(t) { this.statusEl.textContent = t || ''; }

  setVelocity(pan, tilt) {
    if (!this.gimbal?.connected) return;
    this.gimbal.setVelocity(this.selfie ? -pan : pan, tilt);
  }

  async setFollowing(on) {
    this.following = on;
    this.follow.reset();
    if (!on) { this.setVelocity(0, 0); this.clearOverlay(); return; }
    if (!this.tracker) {
      this.setStatus('Loading tracker…');
      try {
        this.trackerMode = S.trackMode;
        this.tracker = await (window.__makeTracker ? window.__makeTracker(S.trackMode) : new Tracker(S.trackMode).load());
        this.setStatus('');
      } catch (e) { this.setStatus(`Tracker failed: ${e.message}`); this.following = false; return; }
    }
  }

  // Called every animation frame.
  tick(now) {
    const dt = (now - this.lastT) / 1000; this.lastT = now;
    const wantTracker = this.following || (studio.auto && rigs.length > 1);
    if (!wantTracker || now - this.lastDetect < 60) return;   // ~15 detections a second
    if (!this.tracker) { if (studio.auto && rigs.length > 1 && !this.loadingTracker) this.loadTracker(); return; }
    const ddt = (now - (this.lastDetectT || now)) / 1000; this.lastDetectT = now; this.lastDetect = now;
    let cands = [];
    try { cands = this.tracker.detect(this.video); } catch { /* frame not ready */ }
    const t = pickTarget(cands, this.lastTarget);
    this.lastTarget = t;
    this.facing = t ? t.facing ?? 0 : 0;
    if (this.following) {
      const v = this.follow.update(t, ddt || dt);
      this.setVelocity(v.pan, v.tilt);
    }
    if (S.showOverlay && this.following) this.drawOverlay(t); else this.clearOverlay();
  }

  async loadTracker() {
    this.loadingTracker = true;
    try { this.trackerMode = S.trackMode; this.tracker = await (window.__makeTracker ? window.__makeTracker(S.trackMode) : new Tracker(S.trackMode).load()); }
    catch { /* stays null */ }
    this.loadingTracker = false;
  }

  // Overlay drawn in the same box as the video (object-fit: contain).
  drawOverlay(t) {
    const c = this.canvas; const r = this.el.getBoundingClientRect();
    if (c.width !== r.width * devicePixelRatio) { c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio; }
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
    const vw = this.video.videoWidth; const vh = this.video.videoHeight;
    if (!vw) return;
    const scale = Math.min(c.width / vw, c.height / vh);
    const ox = (c.width - vw * scale) / 2; const oy = (c.height - vh * scale) / 2;
    const goal = FRAMING[S.framing] || FRAMING.center;
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2 * devicePixelRatio;
    const gx = ox + goal.x * vw * scale; const gy = oy + goal.y * vh * scale;
    ctx.beginPath(); ctx.moveTo(gx - 14, gy); ctx.lineTo(gx + 14, gy); ctx.moveTo(gx, gy - 14); ctx.lineTo(gx, gy + 14); ctx.stroke();
    if (!t) return;
    ctx.strokeStyle = '#3fa0ff'; ctx.lineWidth = 3 * devicePixelRatio;
    ctx.strokeRect(ox + (t.x - t.w / 2) * vw * scale, oy + (t.y - t.h / 2) * vh * scale, t.w * vw * scale, t.h * vh * scale);
  }

  clearOverlay() { const ctx = this.canvas.getContext('2d'); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

  destroy() {
    this.setFollowing(false);
    this.gimbal?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.tracker?.close();
    this.el.remove();
  }
}

function layout() {
  $('rigs').dataset.n = String(rigs.length);
  renderObsMap();
}

async function addRig() {
  if (rigs.length >= 4) return toast('Up to 4 cameras');
  const r = new Rig(rigs.length);
  rigs.push(r);
  $('rigs').append(r.el);
  layout();
  setActive(r);
  await r.fillCameras();
  const saved = localStorage.getItem(`rig${r.index}.cam`);
  const cams = [...r.camSel.options].map((o) => o.value).filter(Boolean);
  const used = rigs.filter((x) => x !== r).map((x) => x.camSel.value);
  const pick = saved && cams.includes(saved) ? saved : (cams.find((c) => !used.includes(c)) || '');
  await r.startCamera(pick || undefined);
  return r;
}

function removeRig(r) {
  r.destroy();
  rigs.splice(rigs.indexOf(r), 1);
  if (active === r) setActive(rigs[0]);
  layout();
}

function setActive(r) {
  if (!r) return;
  active = r;
  rigs.forEach((x) => x.el.classList.toggle('active', x === r));
  $('btnFollow').setAttribute('aria-pressed', String(!!r.following));
}

// ---------- dock: follow, recenter, record ----------
async function toggleFollow(on = !active.following) {
  await active.setFollowing(on);
  $('btnFollow').setAttribute('aria-pressed', String(active.following));
  if (on && !active.gimbal?.connected) toast('Following — connect a gimbal so it can turn');
  else toast(active.following ? 'Following you' : 'Follow off');
}

function recenter() {
  if (!active.gimbal?.connected) return toast('Connect a gimbal first');
  if (active.following) toggleFollow(false);
  active.gimbal.recenter();
  toast('Recentering');
}

let recorder = null;
async function toggleRecord() {
  if (recorder) { recorder.stop(); return; }
  const stream = active.stream;
  if (!stream) return toast('No camera yet');
  // Standard MP4 (H.264 picture + AAC sound) plays in Gallery and every player; then fall back.
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const mimeType = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const ext = /mp4/.test(mimeType) ? 'mp4' : 'webm';
  // Open the save folder first, while the tap still counts (a permission prompt needs it).
  const take = await openTake(takeName(ext), mimeType.split(';')[0] || 'video/webm', { ask: true });
  let audio = [];
  try { audio = [(await getMic()).track]; } catch { toast('No microphone — recording picture only'); }
  const tracks = [...stream.getVideoTracks(), ...audio];
  let rec;
  try { rec = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 12e6, audioBitsPerSecond: 160e3 }); }
  catch (e) { return toast(`Can't record here: ${e.message}`); }
  recorder = rec;
  rec.ondataavailable = (e) => { if (e.data.size) take.write(e.data).catch(() => toast('Saving failed — phone storage full?', 4000)); };
  rec.onstop = async () => {
    recorder = null;
    $('btnRecord').setAttribute('aria-pressed', 'false');
    try { toast(`Saved on this device: ${await take.close()}`, 4000); }
    catch { toast('Could not save the recording', 4000); }
  };
  rec.start(1000);
  $('btnRecord').setAttribute('aria-pressed', 'true');
  toast(take.folderName ? `Recording to ${take.folderName}` : 'Recording');
}

// ---------- joystick ----------
const joy = { x: 0, y: 0, el: $('joy') };
function setJoy(x, y) {
  joy.x = x; joy.y = y;
  joy.el.querySelector('.knob').style.transform = `translate(${x * 22}px, ${y * 22}px)`;
  if (!active?.gimbal?.connected) return;
  if (x || y) { if (active.following) toggleFollow(false); if (moveHandle) { moveHandle.stop(); moveHandle = null; } }
  const m = Math.max(S.maxSpeed, 30);
  // squared response: fine control near the middle, full speed at the edge
  const curve = (v) => Math.sign(v) * v * v;
  active.setVelocity(curve(x) * m, -curve(y) * m);
}
joy.el.addEventListener('pointerdown', (e) => {
  joy.el.setPointerCapture(e.pointerId); joy.el.classList.add('drag');
  const move = (ev) => {
    const r = joy.el.getBoundingClientRect();
    let x = (ev.clientX - r.left - r.width / 2) / (r.width / 2);
    let y = (ev.clientY - r.top - r.height / 2) / (r.height / 2);
    const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; }
    setJoy(Math.abs(x) < 0.08 ? 0 : x, Math.abs(y) < 0.08 ? 0 : y);
  };
  move(e);
  const up = () => { joy.el.classList.remove('drag'); setJoy(0, 0); joy.el.removeEventListener('pointermove', move); joy.el.removeEventListener('pointerup', up); joy.el.removeEventListener('pointercancel', up); };
  joy.el.addEventListener('pointermove', move); joy.el.addEventListener('pointerup', up); joy.el.addEventListener('pointercancel', up);
});
const keys = new Set();
function keyJoy() {
  setJoy((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0));
}

// ---------- nudges (voice) ----------
function nudge(pan, tilt) {
  if (!active.gimbal?.connected) return toast('Connect a gimbal first');
  if (active.following) toggleFollow(false);
  active.gimbal.moveBy(active.selfie ? -pan : pan, tilt, 0.8);
}

// ---------- prompter ----------
const pr = { playing: false, y: 0, last: 0, el: $('prompter'), text: $('prompterText') };
function prompterShow(on) {
  pr.el.hidden = !on;
  $('btnPrompter').setAttribute('aria-pressed', String(on));
  if (on) { pr.text.textContent = S.script || 'Your script is empty. Tap More → Script to paste it.'; prompterStyle(); }
  else prompterPlay(false);
}
function prompterStyle() {
  pr.text.style.fontSize = `${S.prompterSize}px`;
  pr.el.classList.toggle('mirror', S.prompterMirror);
  prompterPaint();
}
function prompterPaint() {
  pr.text.style.transform = `translateY(${pr.el.clientHeight * 0.3 - pr.y}px)${S.prompterMirror ? ' scaleX(-1)' : ''}`;
}
function prompterPlay(on = !pr.playing) {
  pr.playing = on;
  $('prPlay').textContent = on ? 'Pause' : 'Play';
  if (on && pr.el.hidden) prompterShow(true);
  pr.last = performance.now();
}
function prompterTick(now) {
  if (pr.playing && !pr.el.hidden) {
    pr.y += (S.prompterSpeed * (now - pr.last)) / 1000;
    const end = pr.text.scrollHeight;
    if (pr.y > end) { pr.y = end; prompterPlay(false); }
    prompterPaint();
  }
  pr.last = now;
}
pr.el.addEventListener('wheel', (e) => { pr.y = Math.max(0, pr.y + e.deltaY); prompterPaint(); }, { passive: true });

// ---------- voice ----------
const voice = new Voice();
function applyVoice(c) {
  const map = {
    'follow-on': () => toggleFollow(true),
    'follow-off': () => toggleFollow(false),
    recenter,
    left: () => nudge(-12, 0), right: () => nudge(12, 0), up: () => nudge(0, 8), down: () => nudge(0, -8),
    'frame-left': () => setFraming('left'), 'frame-right': () => setFraming('right'), 'frame-center': () => setFraming('center'),
    'record-start': () => { if (!recorder) toggleRecord(); },
    'record-stop': () => { if (recorder) toggleRecord(); },
    'camera-1': () => goLive(rigs[0], true), 'camera-2': () => goLive(rigs[1], true), 'camera-3': () => goLive(rigs[2], true),
    'camera-auto': () => { studio.auto = true; S.autoSwitch = true; persist(); $('autoSwitch').checked = true; toast('Auto camera on'); },
    'prompter-play': () => prompterPlay(true),
    'prompter-pause': () => prompterPlay(false),
    faster: () => { S.prompterSpeed = Math.min(150, S.prompterSpeed + 8); persist(); $('prSpeed').value = S.prompterSpeed; toast(`Script speed ${S.prompterSpeed}`); },
    slower: () => { S.prompterSpeed = Math.max(5, S.prompterSpeed - 8); persist(); $('prSpeed').value = S.prompterSpeed; toast(`Script speed ${S.prompterSpeed}`); },
    'play-move': () => playMoveByName(c.arg),
  };
  map[c.cmd]?.();
}
// ---------- microphone ----------
// One shared mic for voice and recording: the first input that isn't dead (see mic.js).
let mic = null; let micPromise = null;
async function getMic(force = false) {
  if (!force && mic?.track?.readyState === 'live') return mic;
  micPromise ??= findWorkingMic(S.micId).then((m) => { mic = m; micPromise = null; $('micInfo').textContent = `Using: ${m.label}`; return m; })
    .catch((e) => { micPromise = null; throw e; });
  return micPromise;
}
function releaseMic() { mic?.stream.getTracks().forEach((t) => t.stop()); mic = null; }

voice.addEventListener('heard', (e) => {
  const { text, command } = e.detail;
  if (command) { applyVoice(command); toast(`🎙 ${text}`); }
  else toast(voice.wake ? `🎙 Heard “${text}” — start with “${voice.wake}”` : `🎙 Heard “${text}”`, 3000);
});
voice.addEventListener('error', (e) => {
  if (e.detail === 'not-allowed') { toast('Microphone blocked for voice control'); setVoice(false); }
  else if (e.detail === 'audio-capture') toast('Voice: no sound from the microphone. Try Settings → Test microphones.', 4000);
  else if (e.detail === 'network') toast('Voice needs an internet connection', 3000);
});
async function setVoice(on) {
  if (on && !voice.supported) return toast('Voice control needs Chrome');
  voice.wake = S.voiceWake || '';
  $('btnVoice').setAttribute('aria-pressed', String(on && voice.supported));
  if (!on) { voice.stop(); return; }
  let m = null;
  try { m = await getMic(); } catch { /* fall back to the browser's own mic */ }
  voice.start(m?.track || null);
  const where = m ? ` (mic: ${m.label})` : '';
  toast(voice.wake ? `Listening — say “${voice.wake} follow me”${where}` : `Listening${where}`, 3500);
}

function setFraming(f) { S.framing = f; persist(); $('setFraming').value = f; rigs.forEach((r) => r.applySettings()); toast(`Framing: ${f === 'center' ? 'middle' : `${f} third`}`); }

// ---------- moves ----------
let moveHandle = null; let moveRec = null;
function allMoves() { return [...PRESETS, ...loadCustom()]; }
function renderMoves() {
  const list = $('movesList'); list.innerHTML = '';
  for (const m of allMoves()) {
    const row = document.createElement('div'); row.className = 'item';
    const name = document.createElement('span'); name.textContent = m.name;
    const go = Object.assign(document.createElement('button'), { textContent: 'Play' });
    go.onclick = () => startMove(m);
    row.append(name, go);
    if (m.custom) {
      const del = Object.assign(document.createElement('button'), { textContent: 'Delete' });
      del.onclick = () => { saveCustom(loadCustom().filter((x) => x.id !== m.id)); renderMoves(); };
      row.append(del);
    }
    list.append(row);
  }
}
function startMove(m) {
  if (!active.gimbal?.connected) return toast('Connect a gimbal first');
  if (active.following) toggleFollow(false);
  moveHandle?.stop();
  const g = active.gimbal; const flip = active.selfie;
  const proxy = { moveBy: (p, t, s) => g.moveBy(flip ? -p : p, t, s), setVelocity: (p, t) => g.setVelocity(p, t), offset: g.offset };
  moveHandle = playMove(proxy, m.points, (i, n) => active.setStatus(`${m.name}: ${i}/${n}`));
  moveHandle.done.then(() => { active.setStatus(''); moveHandle = null; });
  $('sheetMore').close();
  toast(`Playing “${m.name}” — tap the joystick to stop`);
}
function playMoveByName(word) {
  const m = allMoves().find((x) => x.name.toLowerCase().includes(String(word).toLowerCase()) || x.id === word);
  if (m) startMove(m); else toast(`No move called “${word}”`);
}
$('moveRecStart').onclick = () => {
  if (!active.gimbal?.connected) return toast('Connect a gimbal first');
  moveRec = new MoveRecorder(active.gimbal); moveRec.add();
  ['moveRecAdd', 'moveRecName', 'moveRecSave'].forEach((id) => { $(id).disabled = false; });
  toast('Start point saved. Aim with the joystick, then Add point.');
};
$('moveRecAdd').onclick = () => toast(`Point ${moveRec.add()} saved`);
$('moveRecSave').onclick = () => {
  if (!moveRec || moveRec.points.length < 2) return toast('Add at least one more point');
  const name = $('moveRecName').value.trim() || `My move ${loadCustom().length + 1}`;
  saveCustom([...loadCustom(), { id: `c${Date.now()}`, name, points: moveRec.points, custom: true }]);
  moveRec = null; ['moveRecAdd', 'moveRecName', 'moveRecSave'].forEach((id) => { $(id).disabled = true; });
  $('moveRecName').value = '';
  renderMoves(); toast(`Saved “${name}”`);
};

// ---------- studio: OBS + auto switch ----------
const obs = new Obs();
const studio = { auto: S.autoSwitch, candidate: null, since: 0 };
function renderObsMap() {
  const box = $('obsMap'); if (!box) return;
  box.innerHTML = '';
  rigs.forEach((r, i) => {
    const row = document.createElement('div'); row.className = 'item';
    const name = document.createElement('span'); name.textContent = `Camera ${i + 1}`;
    const sel = document.createElement('select'); sel.setAttribute('aria-label', `OBS scene for camera ${i + 1}`);
    sel.add(new Option('— OBS scene —', ''));
    (obs.sceneNames || []).forEach((s) => sel.add(new Option(s, s)));
    sel.value = S.obsScenes[i] || '';
    sel.onchange = () => { S.obsScenes[i] = sel.value; persist(); };
    const go = Object.assign(document.createElement('button'), { textContent: 'Go live' });
    go.onclick = () => goLive(r, true);
    row.append(name, sel, go); box.append(row);
  });
}
async function goLive(r, manual = false) {
  if (!r) return;
  live = r;
  rigs.forEach((x) => { x.el.querySelector('.live-tag').hidden = x !== r || rigs.length < 2; });
  if (manual) { studio.auto = false; $('autoSwitch').checked = false; }
  const scene = S.obsScenes[rigs.indexOf(r)];
  if (obs.ready && scene) { try { await obs.setScene(scene); } catch (e) { toast(`OBS: ${e.message}`); } }
}
function studioTick(now) {
  if (!studio.auto || rigs.length < 2) return;
  const best = rigs.reduce((a, b) => (b.facing > a.facing ? b : a));
  if (best.facing < 0.35 || best === live) { studio.candidate = null; return; }
  if (studio.candidate !== best) { studio.candidate = best; studio.since = now; return; }
  if (now - studio.since > S.switchHold * 1000) { goLive(best); studio.candidate = null; }
}
$('obsConnect').onclick = async () => {
  S.obsUrl = $('obsUrl').value.trim() || 'ws://localhost:4455'; S.obsPassword = $('obsPassword').value; persist();
  try {
    await obs.connect(S.obsUrl, S.obsPassword);
    const r = await obs.request('GetSceneList');
    obs.sceneNames = (r.scenes || []).map((s) => s.sceneName).reverse();
    renderObsMap(); toast('OBS connected');
  } catch (e) { toast(`OBS: ${e.message}`); }
};

// ---------- sheet + settings wiring ----------
const sheet = $('sheetMore');
function openSheet(tab = 'moves') {
  renderMoves(); renderObsMap(); if (tab === 'settings') { fillMics().catch(() => {}); showFolder(); }
  sheet.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  sheet.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  if (!sheet.open) sheet.showModal();
}
sheet.querySelectorAll('[role="tab"]').forEach((b) => { b.onclick = () => openSheet(b.dataset.tab); });
sheet.querySelector('[data-close]').onclick = () => sheet.close();
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

function bind(id, key, { type = 'value', after } = {}) {
  const el = $(id);
  el[type === 'checked' ? 'checked' : 'value'] = S[key];
  el.addEventListener(el.type === 'range' || el.tagName === 'TEXTAREA' ? 'input' : 'change', () => {
    let v = type === 'checked' ? el.checked : el.value;
    if (type === 'number') v = Number(v);
    S[key] = v; persist(); after?.();
  });
}
const reapply = () => rigs.forEach((r) => r.applySettings());
bind('setFraming', 'framing', { after: reapply });
bind('setTrack', 'trackMode', { after: reapply });
bind('setSpeed', 'speed', { type: 'number', after: reapply });
bind('setMax', 'maxSpeed', { type: 'number', after: reapply });
bind('setTilt', 'tiltEnabled', { type: 'checked', after: reapply });
bind('setOverlay', 'showOverlay', { type: 'checked' });
bind('setInvPan', 'invertPan', { type: 'checked', after: reapply });
bind('setInvTilt', 'invertTilt', { type: 'checked', after: reapply });
bind('setMethod', 'method', { after: reapply });
bind('setWake', 'voiceWake', { after: () => { voice.wake = S.voiceWake; } });
async function fillMics() {
  const sel = $('setMic'); const keep = S.micId || 'auto';
  const ins = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  sel.innerHTML = ''; sel.add(new Option('Automatic (first one that works)', 'auto'));
  ins.forEach((d, i) => sel.add(new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'auto';
}
$('setMic').addEventListener('change', async () => {
  S.micId = $('setMic').value; persist(); releaseMic();
  try { const m = await getMic(true); toast(`Mic: ${m.label}`); if (voice.on) { voice.stop(); voice.start(m.track); } } catch { toast('That microphone is unavailable'); }
});
$('micTest').onclick = async () => {
  const out = $('micResults'); out.textContent = 'Talk now… testing each microphone';
  releaseMic();
  try {
    const res = await testAllMics(1500);
    out.innerHTML = '';
    for (const r of res) {
      const row = document.createElement('div'); row.className = 'item';
      row.textContent = `${r.label}: ${r.error ? 'unavailable' : r.alive ? `works (loudest ${r.peakDb} dB)` : 'DEAD — no sound at all'}`;
      out.append(row);
    }
  } catch (e) { out.textContent = `Test failed: ${e.message}`; }
  if (voice.on) setVoice(true);
};
// Recordings folder
async function showFolder() {
  const info = $('folderInfo');
  if (!canPickFolder()) { info.textContent = 'Recordings go to Downloads.'; $('folderPick').hidden = true; return; }
  const dir = await getFolder().catch(() => null);
  info.textContent = dir ? `Recordings save to: ${dir.name}` : 'Recordings save to: Downloads (pick a folder to change)';
  $('folderForget').hidden = !dir;
}
$('folderPick').onclick = async () => {
  try { const d = await pickFolder(); toast(`Recordings will save to ${d.name}`); } catch (e) { if (e.name !== 'AbortError') toast(`Couldn't use that folder: ${e.message}`, 4000); }
  showFolder();
};
$('folderForget').onclick = async () => { await forgetFolder(); showFolder(); };
bind('scriptText', 'script', { after: () => { if (!pr.el.hidden) pr.text.textContent = S.script; } });
bind('prSpeed', 'prompterSpeed', { type: 'number' });
bind('prSize', 'prompterSize', { type: 'number', after: prompterStyle });
bind('prMirror', 'prompterMirror', { type: 'checked', after: prompterStyle });
bind('obsUrl', 'obsUrl');
bind('obsPassword', 'obsPassword');
bind('autoSwitch', 'autoSwitch', { type: 'checked', after: () => { studio.auto = S.autoSwitch; } });
bind('switchHold', 'switchHold', { type: 'number' });
$('prPlay').onclick = () => { prompterPlay(); sheet.close(); };
$('prRestart').onclick = () => { pr.y = 0; prompterPaint(); };
$('addRig').onclick = () => { sheet.close(); addRig(); };
$('buildInfo').textContent = `Gimbal Studio ${VERSION}`;

$('btnFollow').onclick = () => toggleFollow();
$('btnRecord').onclick = toggleRecord;
$('btnCenter').onclick = recenter;
$('btnVoice').onclick = () => setVoice(!voice.on);
$('btnPrompter').onclick = () => prompterShow(pr.el.hidden);
$('btnMore').onclick = () => openSheet();

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || sheet.open) return;
  if (e.key.startsWith('Arrow')) { keys.add(e.key); keyJoy(); e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (k === 'f') toggleFollow(); else if (k === 'r') toggleRecord(); else if (k === 'c') recenter();
  else if (k === 'v') setVoice(!voice.on); else if (k === 'p') prompterShow(pr.el.hidden);
  else if (k === ' ') { prompterPlay(); e.preventDefault(); }
});
document.addEventListener('keyup', (e) => { if (keys.delete(e.key)) keyJoy(); });

// ---------- main loop ----------
function frame(now) {
  for (const r of rigs) r.tick(now);
  studioTick(now);
  prompterTick(now);
  requestAnimationFrame(frame);
}

// Keep the screen awake while the app is open (phones dim mid-take otherwise).
async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch { /* not allowed yet */ } }
// Release cameras in the background (another app or tab may need them) and take them back on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (recorder) return; // keep recording if a take is running
    for (const r of rigs) { r.stream?.getTracks().forEach((t) => t.stop()); r.stream = null; r.paused = true; }
    if (voice.on) { voice.stop(); voice.resume = true; }
    releaseMic();
  } else {
    keepAwake();
    for (const r of rigs) if (r.paused) { r.paused = false; r.startCamera(r.camSel.value || undefined); }
    if (voice.resume) { voice.resume = false; setVoice(true); }
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

(async () => {
  if (!navigator.bluetooth) toast('Bluetooth needs Chrome on Android or Mac', 4000);
  await addRig();
  keepAwake();
  requestAnimationFrame(frame);
  window.__app = { rigs, toggleFollow, applyVoice, prompterShow, prompterPlay, get active() { return active; }, settings: S };
})();
