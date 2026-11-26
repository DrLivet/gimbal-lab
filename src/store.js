// Settings that survive reloads (per device, in this browser).
const KEY = 'gimbal-app.settings';

export const DEFAULT_SETTINGS = {
  framing: 'center', speed: 1, tiltEnabled: true, trackMode: 'face',
  hfov: 66, deadzone: 0.06, maxSpeed: 120,
  method: 'speed', invertPan: false, invertTilt: false,
  voiceWake: 'gimbal', micId: 'auto',
  autoSwitch: true, switchHold: 3,
  obsUrl: 'ws://localhost:4455', obsPassword: '', obsScenes: {},
  script: '', prompterSpeed: 40, prompterSize: 34, prompterMirror: false,
  showOverlay: true, gestures: true, sounds: true, autoCheckDirs: true, voiceOn: true, autoFollow: true, videoQuality: '1080', videoFps: '30', sonyMode: 'sony',
};

export function load() {
  try {
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    if ((s.v || 1) < 2) { if (s.maxSpeed === 60) s.maxSpeed = 120; s.v = 2; }  // faster follow (2026-11-26)
    return s;
  }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }
