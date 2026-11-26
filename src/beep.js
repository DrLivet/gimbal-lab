// Short sounds so you know the app heard you without looking at the screen.
let ac = null;

function tone(freq, start, len, vol = 0.18) {
  ac ??= new AudioContext();
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  const t = ac.currentTime + start;
  const o = ac.createOscillator(); const g = ac.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + len + 0.02);
}

export const beep = {
  ok: () => tone(1320, 0, 0.09),                                         // command heard
  on: () => { tone(880, 0, 0.1); tone(1320, 0.12, 0.14); },              // something switched on
  off: () => { tone(1320, 0, 0.1); tone(660, 0.12, 0.18); },             // switched off / recording saved
  count: () => tone(990, 0, 0.08),                                       // countdown tick
  go: () => tone(1760, 0, 0.25, 0.22),                                   // recording started
  nope: () => tone(220, 0, 0.25),                                        // didn't work
};
