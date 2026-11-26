// Hands-free control with the browser's speech recognition (Chrome on Android and Mac).
// Listens continuously and turns phrases into commands. parseCommand is pure and unit-tested.

const RULES = [
  [/\b(follow me|track me|start (following|tracking)|follow on)\b/, 'follow-on'],
  [/\b(stop (following|tracking)|stay( there)?|hold( it)?|freeze|follow off)\b/, 'follow-off'],
  [/\b(re ?cent(er|re)|cent(er|re)( up)?|reset|home)\b/, 'recenter'],
  [/\b(pan |look |turn |go )?left\b/, 'left'],
  [/\b(pan |look |turn |go )?right\b/, 'right'],
  [/\b(tilt |look |go )?up\b/, 'up'],
  [/\b(tilt |look |go )?down\b/, 'down'],
  [/\b(frame|put) me (on the )?left\b|\bleft third\b/, 'frame-left'],
  [/\b(frame|put) me (on the )?right\b|\bright third\b/, 'frame-right'],
  [/\b(frame|put) me (in the )?(middle|cent(er|re))\b/, 'frame-center'],
  [/\b(start|begin) record(ing)?\b|\brecord\b|\baction\b/, 'record-start'],
  [/\bstop record(ing)?\b|\bcut\b/, 'record-stop'],
  [/\b(camera|cam) (one|1)\b/, 'camera-1'],
  [/\b(camera|cam) (two|2|to|too)\b/, 'camera-2'],
  [/\b(camera|cam) (three|3)\b/, 'camera-3'],
  [/\bauto (switch|camera)\b/, 'camera-auto'],
  [/\b(landscape|sideways|horizontal)\b/, 'orient-landscape'],
  [/\b(portrait|vertical|upright)\b/, 'orient-portrait'],
  [/\b(rotate|flip)( the)?( phone| camera)?\b/, 'orient-toggle'],
  [/\b(start|play|roll) (the )?(script|prompter)\b/, 'prompter-play'],
  [/\b(pause|stop) (the )?(script|prompter)\b/, 'prompter-pause'],
  [/\bfaster\b/, 'faster'],
  [/\bslower\b/, 'slower'],
  [/\b(play|run) (move|shot) (\w+)\b/, 'play-move'],
];

// Order matters: "stop recording" must win over "record", "stop following" over "follow".
const PRIORITY = ['record-stop', 'follow-off', 'prompter-pause', 'frame-left', 'frame-right', 'frame-center', 'play-move', 'orient-landscape', 'orient-portrait', 'orient-toggle'];

export function parseCommand(text) {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `;
  const hits = RULES.filter(([re]) => re.test(t)).map(([re, cmd]) => ({ cmd, m: t.match(re) }));
  if (!hits.length) return null;
  hits.sort((a, b) => (PRIORITY.includes(b.cmd) - PRIORITY.includes(a.cmd)));
  const { cmd, m } = hits[0];
  return cmd === 'play-move' ? { cmd, arg: m[3] } : { cmd };
}

// While live you say "right" and "up" all the time, so by default only words after the
// wake word count: "gimbal follow me", "gimbal camera two". Returns the command part or null.
export function afterWakeWord(text, wake) {
  if (!wake) return text;
  const t = text.toLowerCase();
  const w = wake.toLowerCase();
  // Speech engines often hear "gimbal" as "gamble"/"gimble"/"jimbo".
  const variants = w === 'gimbal' ? ['gimbal', 'gimble', 'gamble', 'jimbo', 'gimbel', 'gym ball'] : [w];
  let at = -1; let len = 0;
  for (const v of variants) { const i = t.lastIndexOf(v); if (i > at) { at = i; len = v.length; } }
  return at < 0 ? null : text.slice(at + len).trim();
}

export class Voice extends EventTarget {
  constructor() {
    super();
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    this.supported = !!SR;
    this.on = false;
    this.wake = 'gimbal';
    if (!SR) return;
    this.rec = new SR();
    this.rec.continuous = true;
    this.rec.interimResults = false;
    this.track = null;   // audio track from a chosen mic (Chrome 13x+); null = browser default mic
    this.useTrack = true;
    this.rec.lang = navigator.language || 'en-US';
    this.rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;  // final results only
        const text = e.results[i][0].transcript.trim();
        const part = afterWakeWord(text, this.wake);
        const c = part ? parseCommand(part) : null;
        this.dispatchEvent(new CustomEvent('heard', { detail: { text, command: c } }));
      }
    };
    this.rec.onerror = (e) => this.dispatchEvent(new CustomEvent('error', { detail: e.error }));
    this.rec.onstart = () => this.dispatchEvent(new Event('listening'));
    // Chrome stops listening after silence; keep it going while switched on.
    this.rec.onend = () => { if (this.on) setTimeout(() => this._start(), 250); };
  }

  // Starts recognition, feeding it the chosen mic's track when the browser allows that
  // (Web Speech API start(audioTrack)). Falls back to the browser's default mic otherwise.
  _start() {
    const t = this.useTrack && this.track && this.track.readyState === 'live' ? this.track : null;
    try {
      if (t) this.rec.start(t); else this.rec.start();
      this.usingTrack = !!t;
    } catch (e) {
      if (t && e.name !== 'InvalidStateError') { this.useTrack = false; this._start(); }  // older Chrome: no track support
    }
  }

  start(track = null) {
    if (!this.supported) return false;
    this.track = track; this.on = true; this._start();
    return true;
  }

  stop() { this.on = false; try { this.rec?.stop(); } catch { /* ignore */ } }
}
