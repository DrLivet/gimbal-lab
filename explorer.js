// Generic BLE explorer: lists every service/characteristic the page is allowed to see,
// listens to everything that can notify, and lets you write raw hex. Used to learn
// gimbals nobody has documented yet (Feiyu SCORP-C).
import { pickDevice, writeChunks, normalizeUuid } from './ble.js';
import { hex } from './duml.js';

export class Explorer extends EventTarget {
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connect({ namePrefix, extra }) {
    const extraServices = (extra || '').split(/[\s,]+/).filter(Boolean);
    this.device = await pickDevice({ namePrefix, extraServices });
    this.device.addEventListener('gattserverdisconnected', () => this.emit('disconnected'));
    this.server = await this.device.gatt.connect();
    this.chars = [];
    const services = await this.server.getPrimaryServices();
    for (const s of services) {
      let list = [];
      try { list = await s.getCharacteristics(); } catch (e) { this.emit('log', `can't read ${s.uuid}: ${e.message}`); }
      for (const c of list) {
        const p = c.properties;
        const props = ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter((k) => p[k]);
        const entry = { service: s.uuid, uuid: c.uuid, props, ch: c };
        this.chars.push(entry);
        if (p.notify || p.indicate) {
          c.addEventListener('characteristicvaluechanged', (e) =>
            this.emit('rx', { uuid: c.uuid, bytes: new Uint8Array(e.target.value.buffer) }));
          try { await c.startNotifications(); entry.listening = true; }
          catch (e) { this.emit('log', `can't listen to ${short(c.uuid)}: ${e.message}`); }
        }
        if (p.read) {
          try { entry.value = new Uint8Array((await c.readValue()).buffer); } catch { /* some refuse reads */ }
        }
      }
    }
    this.emit('connected', { name: this.device.name, chars: this.chars, services: services.map((s) => s.uuid) });
  }

  async write(uuid, hexText) {
    const entry = this.chars.find((c) => c.uuid === uuid);
    const bytes = Uint8Array.from(hexText.replace(/0x/gi, '').split(/[^0-9a-f]+/i).filter(Boolean).map((x) => parseInt(x, 16)));
    if (!bytes.length) throw new Error('Nothing to send');
    await writeChunks(entry.ch, bytes);
    this.emit('tx', { uuid, bytes });
  }

  disconnect() { this.device?.gatt?.connected && this.device.gatt.disconnect(); }
}

export function short(uuid) {
  const m = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/.exec(uuid);
  return m ? m[1] : uuid;
}

export { hex, normalizeUuid };
