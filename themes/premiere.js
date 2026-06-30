/* Adobe Premiere Pro 風テーマの JavaScript 挙動 */
(function () {
  'use strict';
  window.registerTheme && window.registerTheme('premiere', {
    // テーマ適用時：Premiere のワークスペース構成に合わせてタブを書き換える
    apply(ctx) {
      document.body.classList.add('theme-js--premiere');
      ctx.setTitleSuffix('Premiere');
      ctx.setWorkspaceTabs(['編集', 'カラー', 'エフェクト', 'オーディオ']);
    },
    // 他テーマへの切替時：このテーマ専用の状態を片付ける
    cleanup() {
      document.body.classList.remove('theme-js--premiere');
    },
  });
})();
