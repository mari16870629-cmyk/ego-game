// エゴ育成ゲーム：電波がなくても開ける＋通知を出す仕組み（Service Worker）
// 中身を更新したら CACHE の番号を1つ上げる
const CACHE = 'ego-game-v10';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './kotoba.js', './icon-192.png', './icon-512.png'];
const CFG = 'ego-game-config';   // おしらせ設定の控え（ページが閉じていても読める場所）

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CFG).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  const same = new URL(req.url).origin === location.origin;
  if (same) {
    // 自分のファイル（kotoba.js など）：ネット優先。まりが直したらすぐ反映。圏外ならキャッシュ
    e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req)));
    return;
  }
  // フォントなど外部：キャッシュ優先
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});

// ---- おしらせ設定の読み書き ----
async function getCfg() { try { const c = await caches.open(CFG); const r = await c.match('cfg'); return r ? await r.json() : null; } catch (e) { return null; } }
async function setCfg(v) { try { const c = await caches.open(CFG); await c.put('cfg', new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } })); } catch (e) {} }
const pad = n => String(n).padStart(2, '0');
const todayK = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'remind-config') setCfg({ on: !!d.on, time: d.time || '21:00', last: d.last || '', q: d.q || '' });
});

// ページが閉じていても、端末が許すタイミングで呼ばれる（Android Chrome・ホーム画面追加時。時刻ぴったりではない）
self.addEventListener('periodicsync', e => { if (e.tag === 'daily-remind') e.waitUntil(remindIfDue()); });
async function remindIfDue() {
  const cfg = await getCfg(); if (!cfg || !cfg.on) return;
  const k = todayK(); if (cfg.last === k) return;
  const [h, m] = cfg.time.split(':').map(Number); const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  await self.registration.showNotification('きょうの問い', { body: cfg.q || 'きょうも すこしだけ、じぶんを そだてよう', tag: 'daily', icon: 'icon-192.png', badge: 'icon-192.png', lang: 'ja', data: { open: 'today' } });
  cfg.last = k; await setCfg(cfg);
  const cs = await self.clients.matchAll({ type: 'window' }); cs.forEach(c => c.postMessage({ type: 'reminded', date: k }));
}

// 通知をタップ → アプリを開く
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tab = (e.notification.data && e.notification.data.open) || 'today';
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) { if ('focus' in c) { await c.focus(); c.postMessage({ type: 'open', tab }); return; } }
    if (self.clients.openWindow) await self.clients.openWindow('./');
  })());
});
