// Thin Web Bluetooth wrapper shared by the OM 4 driver and the explorer.

// Vendor services we ask permission for up front. Web Bluetooth only lets a page
// touch services it named in requestDevice(), so this list is deliberately broad
// to give the explorer a chance with unknown gimbals (e.g. the Feiyu SCORP-C).
export const KNOWN_SERVICES = [
  0xfff0, 0xffe0, 0xffe5, 0xffd0, 0xffc0, 0xff00, 0xfee7, 0xfee9, 0xfe59,
  0xae00, 0xae30, 0xae3a, 0xff12, 0x180f, 0x180a,
  0xffff, // Feiyu SCORP / G6 family (write FF01, notify FF02)
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip transparent UART
];

export function normalizeUuid(u) {
  if (typeof u === 'number') return BluetoothUUID.getService(u);
  const s = String(u).trim().toLowerCase();
  if (/^(0x)?[0-9a-f]{4}$/.test(s)) return BluetoothUUID.getService(parseInt(s.replace('0x', ''), 16));
  return s;
}

export async function pickDevice({ namePrefix, extraServices = [] } = {}) {
  if (!navigator.bluetooth) throw new Error('This browser has no Bluetooth. Use Chrome on Android or Mac.');
  const optionalServices = [...new Set([...KNOWN_SERVICES, ...extraServices].map(normalizeUuid))];
  const opts = { optionalServices };
  if (namePrefix) opts.filters = [{ namePrefix }];
  else opts.acceptAllDevices = true;
  return navigator.bluetooth.requestDevice(opts);
}

// Writes in chunks; BLE default payload is 20 bytes.
export async function writeChunks(ch, bytes, size = 20) {
  for (let i = 0; i < bytes.length; i += size) {
    const part = bytes.slice(i, i + size);
    if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(part);
    else await ch.writeValue(part);
  }
}

// One write at a time: Web Bluetooth throws "GATT operation already in progress" otherwise.
export function serial() {
  let tail = Promise.resolve();
  return (fn) => (tail = tail.then(fn, fn));
}
