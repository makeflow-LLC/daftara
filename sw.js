/* ================= دفترة — Service Worker =================
   الهدف: أن يفتح التطبيق ويعمل بالكامل ووضع الطيران مفعّل.
   الاستراتيجية: cache-first لهيكل التطبيق، مع اسم مخزن يحمل رقم النسخة.
   عند تحديث أي ملف: ارفع رقم CACHE_VERSION.
================================================================ */
var CACHE_VERSION = 'v5';
var CACHE_NAME = 'daftara-shell-' + CACHE_VERSION;

var SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'db.js',
  'manifest.json',
  'vendor/dexie.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME) return caches.delete(k);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // طلبات خارجية (مثل مكتبة Dexie من الـ CDN): الشبكة فقط،
  // وإن فشلت يتكفّل التطبيق بالنسخة المحلية المخزّنة.
  if (url.origin !== self.location.origin) return;

  // أي تنقّل يعود إلى صفحة التطبيق المخزّنة
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html').then(function (cached) {
        return cached || fetch(req).catch(function () { return caches.match('./'); });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
