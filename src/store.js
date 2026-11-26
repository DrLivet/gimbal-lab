// Settings that survive reloads (per device, in this browser).
const KEY = 'gimbal-app.settings';

export const DEFAULT_SETTINGS = {
  framing: 'center', speed: 1, tiltEnabled: true, trackMode: 'face',
  hfov: 66, deadzone: 0.06, maxSpeed: 60,
  method: 'speed', invertPan: false, invertTilt: false,
  voiceWake: 'gimbal', micId: 'auto',
  autoSwitch: true, switchHold: 3,
  obsUrl: 'ws://localhost:4455', obsPassword: '', obsScenes: {},
  script: '', prompterSpeed: 40, prompterSize: 34, prompterMirror: false,
  showOverlay: true, gestures: true, sounds: true, autoCheckDirs: true,
};

export function load() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }
