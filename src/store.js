// Settings that survive reloads (per device, in this browser).
const KEY = 'gimbal-app.settings';

export const DEFAULT_SETTINGS = {
  framing: 'center', speed: 1, tiltEnabled: true, trackMode: 'face',
  hfov: 66, deadzone: 0.06, maxSpeed: 60,
  method: 'step', invertPan: false, invertTilt: false,
  voiceWake: 'gimbal',
  autoSwitch: true, switchHold: 3,
  obsUrl: 'ws://localhost:4455', obsPassword: '', obsScenes: {},
  script: '', prompterSpeed: 40, prompterSize: 34, prompterMirror: false,
  showOverlay: true,
};

export function load() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }
