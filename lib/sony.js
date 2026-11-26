// Sony camera Bluetooth remote (the link Sony's RMT-P1BT remote and Creators' App use).
// Works with cameras that have "Bluetooth Rmt Ctrl" (e.g. the owner's A7 IV and A6700).
// Protocol from the open freemote project (Greg Leeds, tao-j) and the OpenClick remote:
//   service 8000FF00-FF00-FFFF-FFFF-FFFFFFFFFFFF
//   FF01 = remote button presses (2 bytes, written), FF02 = camera status (notifications)
// Buttons are press/release pairs; the record button toggles recording.
// Pure helpers (CODES, parseStatus) are unit-tested in test/sony.test.mjs.

export const SERVICE = '8000ff00-ff00-ffff-ffff-ffffffffffff';
export const CMD_CHAR = 0xff01;
export const STATUS_CHAR = 0xff02;
export const SONY_COMPANY_ID = 0x012d;   // Sony's Bluetooth manufacturer ID (in its adverts)

// [press, release]
export const CODES = {
  record: [0x010f, 0x010e],
  shutterHalf: [0x0107, 0x0106],
  shutterFull: [0x0109, 0x0108],
  afOn: [0x0115, 0x0114],
  c1: [0x0121, 0x0120],
};

export const bytes = (code) => Uint8Array.of(code >> 8, code & 0xff);

// Camera status notifications on FF02 are [0x02, kind, value].
//   0x02 0xD5 0x20 / 0x00 → recording started / stopped
//   0x02 0x3F 0x20 / 0x00 → focus acquired / lost
//   0x02 0xA0 0x20 / 0x00 → shutter active / done
export function parseStatus(b) {
  if (!b || b.length < 3 || b[0] !== 0x02) return null;
  const on = b[2] === 0x20;
  if (b[1] === 0xd5) return { kind: 'recording', on };
  if (b[1] === 0x3f) return { kind: 'focus', on };
  if (b[1] === 0xa0) return { kind: 'shutter', on };
  return { kind: 'other', code: b[1], on };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class SonyRemote extends EventTarget {
  constructor() { super(); this.device = null; this.cmd = null; this.recording = null; }

  get connected() { return !!this.device?.gatt?.connected; }
  get name() { return this.device?.name || 'Sony camera'; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connect(device) {
    this.device = device || await navigator.bluetooth.requestDevice({
      filters: [{ manufacturerData: [{ companyIdentifier: SONY_COMPANY_ID }] }, { namePrefix: 'ILCE' }],
      optionalServices: [SERVICE],
    });
    this.device.addEventListener('gattserverdisconnected', () => { this.cmd = null; this.emit('state'); });
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(SERVICE);
    this.cmd = await svc.getCharacteristic(CMD_CHAR);
    try {
      const st = await svc.getCharacteristic(STATUS_CHAR);
      st.addEventListener('characteristicvaluechanged', (e) => {
        const s = parseStatus(new Uint8Array(e.target.value.buffer));
        if (s?.kind === 'recording') { this.recording = s.on; this.emit('recording', s.on); }
        if (s) this.emit('status', s);
      });
      await st.startNotifications();   // the first secure write/notify triggers phone ⇄ camera pairing
    } catch { /* status is optional */ }
    this.emit('state');
  }

  disconnect() { if (this.device?.gatt?.connected) this.device.gatt.disconnect(); }

  async write(code) {
    if (!this.cmd) throw new Error('Sony camera not connected');
    await this.cmd.writeValue(bytes(code));
  }

  // One button press: press, short hold, release.
  async press(name, holdMs = 120) {
    const [down, up] = CODES[name];
    await this.write(down); await wait(holdMs); await this.write(up);
  }

  // Start/stop using the camera's reported state when we have it (the button toggles).
  async setRecording(on) {
    if (this.recording === on) return;
    await this.press('record');
    // If the camera reports status, wait for it to confirm; otherwise assume it toggled.
    const ok = await new Promise((res) => {
      const t = setTimeout(() => res(false), 2500);
      this.addEventListener('recording', (e) => { if (e.detail === on) { clearTimeout(t); res(true); } }, { once: true });
    });
    if (!ok && this.recording === null) this.recording = on;
    return ok;
  }
}
