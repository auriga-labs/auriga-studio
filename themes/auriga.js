/* Aurigaオリジナル テーマ（既定）の JavaScript 挙動 */
(function () {
  'use strict';
  window.registerTheme && window.registerTheme('auriga', {
    // テーマ適用時：汎用のワークスペース構成に戻す
    apply(ctx) {
      document.body.classList.add('theme-js--auriga');
      ctx.setTitleSuffix('');
      ctx.setWorkspaceTabs(['編集', 'カラー', 'オーディオ', '書き出し']);
    },
    // 他テーマへの切替時：このテーマ専用の状態を片付ける
    cleanup() {
      document.body.classList.remove('theme-js--auriga');
    },
  });
})();
