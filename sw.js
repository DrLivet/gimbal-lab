// Network-first app shell: always fresh when online, still opens offline (e.g. on set with no signal).
const CACHE = 'gimbal-studio-v6';
const SHELL = [
  './', './index.html', './app.css', './manifest.webmanifest', './lab.html', './styles.css',
  './src/app.js', './src/follow.js', './src/tracker.js', './src/voice.js', './src/moves.js', './src/obs.js', './src/store.js', './src/mic.js', './src/saver.js', './src/gesture.js', './src/beep.js', './src/calibrate.js', './src/orient.js', './src/lab.js',
  './lib/gimbal.js', './lib/om.js', './lib/duml.js', './lib/ble.js', './lib/feiyu.js', './lib/explorer.js',
  './icons/icon-192.png', './icons/icon-512.png',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});
