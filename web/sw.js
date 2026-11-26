/* DSH · 鲸与鱼 —— 离线缓存
   把外壳（html/css/js/图片）预缓存，装成 App 后断网也能打开。
   注意：Service Worker 只在 https 或 localhost 下生效，局域网 http 不行。 */

const CACHE = 'dsh-whale-v1';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/xiaoyu.jpg',
  './assets/avatar-user.jpg',
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

  /* 先给缓存（离线可用），后台顺手更新，下次打开就是新的 */
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      const fetching = fetch(req)
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
          /* 断网：有缓存就用缓存，没有就退回首页 */
          return hit || caches.match('./index.html');
        });

      return hit || fetching;
    })
  );
});
