// Fake navigator.bluetooth: an "OM 4" that only moves once it has heard the status heartbeat,
// and pushes attitude every 300 ms. Injected by test/page.test.mjs before the page loads.
(() => {
  const listeners = [];
  let yaw = -91, heard = false, buf = [];
  const u = (n) => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
  const crc8t = []; // not needed: the page parser checks crc8, so we copy packets the page builds
  function push(bytes) { listeners.forEach((f) => f({ target: { value: new DataView(Uint8Array.from(bytes).buffer) } })); }
  window.__sentPackets = [];
  const rx = { properties: { notify: true }, uuid: u(0xfff4),
    addEventListener: (_, f) => listeners.push(f), startNotifications: async () => {} };
  const tx = { properties: { writeWithoutResponse: true }, uuid: u(0xfff5),
    async writeValueWithoutResponse(chunk) {
      buf.push(...chunk);
      while (buf.length >= 4) {
        const len = buf[1] | ((buf[2] & 3) << 8);
        if (buf.length < len) break;
        const p = buf.splice(0, len);
        window.__sentPackets.push(p);
        const set = p[9], cmd = p[10];
        if (set === 0x04 && cmd === 0x50) heard = true;
        if (set === 0x04 && cmd === 0x14 && heard) yaw += ((p[11] | (p[12] << 8)) << 16 >> 16) / 10;
      }
    } };
  const service = { uuid: u(0xfff0), getCharacteristic: async (id) => (id.includes('fff4') ? rx : tx),
    getCharacteristics: async () => [rx, tx] };
  const device = { name: 'OM4-MOCK', addEventListener() {},
    gatt: { connected: true, connect: async () => device.gatt,
      getPrimaryService: async () => service, getPrimaryServices: async () => [service], disconnect() {} } };
  window.__attitude = (pkt) => { window.__template = pkt; };
  navigator.bluetooth = { requestDevice: async () => device };
  window.BluetoothUUID = { getService: (n) => u(n) };
  // attitude pushes, built by the page's own encoder (exposed for the test)
  setInterval(async () => {
    const { build } = await import('/lib/duml.js');
    const y = Math.round(yaw * 10), p = -1799;
    push(build({ src: 0x04, dst: 0x02, attr: 0, cmdSet: 0x04, cmd: 0x05,
      payload: [p & 255, (p >> 8) & 255, 0, 0, y & 255, (y >> 8) & 255, 0x82, 0, 0, 0] }));
    push(build({ src: 0xe5, dst: 0x02, attr: 0, cmdSet: 0x05, cmd: 0x06, payload: [77, 0, 0, 0] }));
  }, 300);
})();
