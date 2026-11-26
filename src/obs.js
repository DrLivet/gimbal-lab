// Minimal OBS WebSocket (v5, built into OBS 28+) client: connect, list scenes, switch scene.
// In OBS: Tools → WebSocket Server Settings → Enable. Default address ws://localhost:4455.

async function sha256b64(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(d)));
}

export class Obs extends EventTarget {
  constructor() { super(); this.ws = null; this.pending = new Map(); this.id = 0; this.ready = false; }

  connect(url = 'ws://localhost:4455', password = '') {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const fail = (msg) => { reject(new Error(msg)); this.close(); };
      const t = setTimeout(() => fail('OBS did not answer. Is OBS open with WebSocket enabled?'), 6000);
      ws.onerror = () => { clearTimeout(t); fail('Could not reach OBS at ' + url); };
      ws.onclose = () => { this.ready = false; this.dispatchEvent(new Event('close')); };
      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.op === 0) { // Hello
          const ident = { rpcVersion: 1, eventSubscriptions: 0 };
          if (msg.d.authentication) {
            const { salt, challenge } = msg.d.authentication;
            ident.authentication = await sha256b64((await sha256b64(password + salt)) + challenge);
          }
          ws.send(JSON.stringify({ op: 1, d: ident }));
        } else if (msg.op === 2) { // Identified
          clearTimeout(t); this.ready = true; resolve();
        } else if (msg.op === 7) { // RequestResponse
          const p = this.pending.get(msg.d.requestId);
          if (!p) return;
          this.pending.delete(msg.d.requestId);
          if (msg.d.requestStatus.result) p.resolve(msg.d.responseData || {});
          else p.reject(new Error(msg.d.requestStatus.comment || 'OBS refused'));
        }
      };
    });
  }

  request(requestType, requestData = {}) {
    if (!this.ready) return Promise.reject(new Error('Not connected to OBS'));
    const requestId = String(++this.id);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  async scenes() { return (await this.request('GetSceneList')).scenes.map((s) => s.sceneName).reverse(); }
  setScene(sceneName) { return this.request('SetCurrentProgramScene', { sceneName }); }
  close() { try { this.ws?.close(); } catch { /* ignore */ } this.ws = null; this.ready = false; }
}
