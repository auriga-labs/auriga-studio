// Auriga Studio サービスワーカー
// オフライン起動とアセットの高速表示を担う。
// キャッシュ名はアプリのバージョンに紐付け、更新時に古いキャッシュを破棄する。

const CACHE_VERSION = 'auriga-v0.0.1-r4';

// 起動に最低限必要なアプリシェル。install 時に先読みキャッシュする。
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './main.js',
  './manifest.webmanifest',
  './favicon.ico',
  './favicon.svg',
  './favicon-symbol.svg',
  './favicon-symbol.png',
  './icon-maskable.svg',
  './version.json',
  './themes/ymm4.css',
  './themes/ymm4-light.css'
];

// API・認証系のパス（動的なので絶対にキャッシュしない）
const NETWORK_ONLY_PREFIXES = ['/oauth/', '/cloud/'];

// インストール時：アプリシェルを先読みキャッシュする
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // 個別に失敗しても全体を止めないよう、取得できたものだけ入れる
      await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      );
      // 新しい SW を即時有効化する
      self.skipWaiting();
    })()
  );
});

// 有効化時：古いバージョンのキャッシュを掃除する
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      );
      // 既存のクライアントをこの SW の管理下に置く
      await self.clients.claim();
    })()
  );
});

// レンダラーからの指示（新バージョンへ即時切替）を受け取る
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// フェッチ：GET のみ扱い、方針を出し分ける
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 別オリジン（CDN 等）は SW を介さず素通しする
  if (url.origin !== self.location.origin) return;

  // API・認証系は常にネットワークのみ（キャッシュしない）
  if (NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  // ページ遷移（HTML）はネットワーク優先。オフライン時はキャッシュした index.html を返す
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_VERSION);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch (e) {
          const cache = await caches.open(CACHE_VERSION);
          const cached = await cache.match('./index.html');
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // それ以外のアセットは stale-while-revalidate
  // （まずキャッシュを返しつつ裏で更新し、次回アクセスを最新化する）
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          // 正常なレスポンスのみキャッシュ更新する
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      return cached || (await network) || Response.error();
    })()
  );
});
