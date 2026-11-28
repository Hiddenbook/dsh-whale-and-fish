/* DSH · 鲸与鱼 —— 离线缓存
   网络优先：改完代码刷新就能看到；断网才退回缓存，所以装上以后离线也能开。
   注意：Service Worker 只在 https 或 localhost 下生效，局域网 http 不注册。 */

const CACHE = 'dsh-whale-v2';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/xiaoyu.jpg',
  './assets/avatar-user.jpg',
  './assets/vendor/jsQR.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-180.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        return cache.addAll(ASSETS);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key !== CACHE) return caches.delete(key);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  /* 中继接口不缓存 */
  if (url.pathname.indexOf('/messages') === 0) return;
  if (url.pathname.indexOf('/send') === 0) return;
  if (url.pathname.indexOf('/info') === 0) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
  );
});
