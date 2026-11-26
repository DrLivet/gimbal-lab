// Saves recordings on the device.
// If the owner picked a folder (Settings › Recordings), each take is written straight into it
// while recording, e.g. Movies or DCIM/Camera so it shows in Gallery. Otherwise the take is
// downloaded into the phone's Downloads folder when recording stops.

const DB = 'gimbal-saver'; const STORE = 'kv'; const KEY = 'folder';

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode); const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { open.result.close(); resolve(req?.result); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

export const canPickFolder = () => typeof window.showDirectoryPicker === 'function';

export async function pickFolder() {
  const dir = await window.showDirectoryPicker({ id: 'gimbal-recordings', mode: 'readwrite', startIn: 'videos' });
  await idb('readwrite', (s) => s.put(dir, KEY));
  return dir;
}

export async function forgetFolder() { await idb('readwrite', (s) => s.delete(KEY)); }

// Returns the saved folder if we may write to it. `ask` may show a permission prompt
// (only works straight after a tap).
export async function getFolder({ ask = false } = {}) {
  if (!canPickFolder()) return null;
  let dir; try { dir = await idb('readonly', (s) => s.get(KEY)); } catch { return null; }
  if (!dir) return null;
  const opts = { mode: 'readwrite' };
  let p = await dir.queryPermission?.(opts);
  if (p === 'prompt' && ask) { try { p = await dir.requestPermission(opts); } catch { /* no gesture */ } }
  return p === 'granted' ? dir : null;
}

export function takeName(ext, d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `Gimbal ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.${ext}`;
}

// Opens a place to write one take. Returns { write(blob), close() -> where, folderName }.
export async function openTake(name, type, { ask = false } = {}) {
  const dir = await getFolder({ ask });
  if (dir) {
    try {
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      let chain = Promise.resolve();
      return {
        folderName: dir.name,
        write: (blob) => { chain = chain.then(() => w.write(blob)); return chain; },
        close: async () => { await chain; await w.close(); return `${dir.name}/${name}`; },
      };
    } catch { /* fall through to download */ }
  }
  const chunks = [];
  return {
    folderName: null,
    write: (blob) => { chunks.push(blob); return Promise.resolve(); },
    close: async () => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(chunks, { type })), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return `Downloads/${name}`;
    },
  };
}
