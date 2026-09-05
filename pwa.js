// Auriga Studio PWA 登録スクリプト
// Web（http/https）で開かれたときだけサービスワーカーを登録する。
// Electron（file://）では登録しない。

(() => {
  'use strict';

  // Electron やローカルファイル起動では PWA 機能を使わない
  const isWeb = location.protocol === 'http:' || location.protocol === 'https:';
  if (!isWeb || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        // 新しいバージョンを検知したら、待機中の SW を即時有効化する
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              // 既に旧 SW が動いている＝更新なので切替を促す
              reg.waiting && reg.waiting.postMessage('skipWaiting');
            }
          });
        });
      })
      .catch((err) => {
        // 登録失敗はアプリ本体の動作に影響させない
        console.warn('[PWA] サービスワーカーの登録に失敗しました', err);
      });

    // 制御 SW が切り替わったら一度だけリロードして最新資産を反映する。
    // ただし初回インストール時はリロードしない。初回は、まだどの SW にも制御されていない
    // このページが sw.js の activate（clients.claim()）で制御下に入るだけで、
    // controllerchange は「更新」ではない。ここでリロードすると起動直後にページが
    // 読み直され、スプラッシュが二重に表示される
    const wasControlled = !!navigator.serviceWorker.controller;   // ロード時点で旧 SW の制御下にあったか
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!wasControlled || refreshed) return;
      refreshed = true;
      location.reload();
    });
  });
})();
