// Picks a microphone that actually works.
// The owner's S24 Ultra has a failing bottom mic: the "Default" input then delivers exact
// digital silence, while "Speakerphone" (which uses the top mic) hears fine. A dead input
// returns all-zero samples; a live one always has some room noise. So we open each input
// briefly and keep the first one that isn't perfectly silent.

const SILENT = 1e-7; // a live mic's noise floor is far above this

export function isSilent(samples) {
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > SILENT) return false;
  return true;
}

// Order to try: the user's choice, then Default, then speakerphone-like inputs, then the rest.
export function orderInputs(inputs, preferredId) {
  const score = (d) => {
    if (preferredId && preferredId !== 'auto' && d.deviceId === preferredId) return 0;
    if (d.deviceId === 'default') return 1;
    if (/speaker|top|back|camcorder/i.test(d.label)) return 2;
    if (/headset|earpiece/i.test(d.label)) return 4;
    return 3;
  };
  return [...inputs].sort((a, b) => score(a) - score(b));
}

const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

// Returns { alive, peakDb }, or { alive: null } when the browser won't run audio processing yet
// (before the first tap on the screen) so the mic can't be measured.
async function listen(stream, ms) {
  const ac = new AudioContext();
  try {
    await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 300))]);
    if (ac.state !== 'running') return { alive: null, peakDb: null };
    const an = ac.createAnalyser(); an.fftSize = 2048;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    let alive = false; let peak = -200; const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 60));
      an.getFloatTimeDomainData(buf);
      if (!isSilent(buf)) alive = true;
      let e = 0; for (const v of buf) e += v * v;
      peak = Math.max(peak, 10 * Math.log10(e / buf.length + 1e-14));
    }
    return { alive, peakDb: Math.round(peak) };
  } finally { ac.close(); }
}

// Returns { stream, track, deviceId, label, tried: [{label, alive, peakDb}] }.
// The returned stream stays open for the caller to use (voice, recording).
export async function findWorkingMic(preferredId = 'auto', { ms = 700 } = {}) {
  let inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  // Labels/ids are hidden until mic permission is granted once.
  if (!inputs.some((d) => d.label)) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  }
  const tried = [];
  const KEY = 'gimbal.micWorking';
  for (const d of orderInputs(inputs, preferredId)) {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: d.deviceId }, ...RAW } }); }
    catch { tried.push({ label: d.label || d.deviceId, alive: false, error: true }); continue; }
    const r = await listen(stream, ms);
    tried.push({ label: d.label || d.deviceId, ...r });
    if (r.alive) {
      try { localStorage.setItem(KEY, d.deviceId); } catch { /* ignore */ }
      const track = stream.getAudioTracks()[0];
      return { stream, track, deviceId: d.deviceId, label: d.label || 'Microphone', tried };
    }
    stream.getTracks().forEach((t) => t.stop());
    if (r.alive === null) {
      // Can't measure yet: use the mic that worked last time, else a speaker-type mic
      // (the S24's "Speakerphone" input uses the working top mic), else the user's choice.
      let id = null; try { id = localStorage.getItem(KEY); } catch { /* ignore */ }
      const pick = (preferredId && preferredId !== 'auto' && inputs.find((x) => x.deviceId === preferredId))
        || inputs.find((x) => x.deviceId === id)
        || inputs.find((x) => /speaker/i.test(x.label)) || inputs[0];
      if (pick) {
        try {
          const st = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: pick.deviceId }, ...RAW } });
          return { stream: st, track: st.getAudioTracks()[0], deviceId: pick.deviceId, label: `${pick.label || 'Microphone'} (not checked yet)`, tried, unchecked: true };
        } catch { /* fall through */ }
      }
      break;
    }
  }
  // Nothing passed: fall back to the default input so at least something is open.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return { stream, track: stream.getAudioTracks()[0], deviceId: 'default', label: 'Default (no live mic found)', tried };
}

// Checks every input (for the Settings "Test microphones" button).
export async function testAllMics(ms = 1500) {
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const out = [];
  for (const d of inputs) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: d.deviceId }, ...RAW } });
      out.push({ deviceId: d.deviceId, label: d.label || d.deviceId, ...(await listen(s, ms)) });
      s.getTracks().forEach((t) => t.stop());
    } catch (e) { out.push({ deviceId: d.deviceId, label: d.label || d.deviceId, alive: false, error: e.name }); }
  }
  return out;
}
