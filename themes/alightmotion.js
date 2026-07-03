/* Alight Motion 風テーマの JavaScript 挙動 */
(function () {
  'use strict';
  window.registerTheme && window.registerTheme('alightmotion', {
    // テーマ適用時：Alight Motion のワークスペース構成に合わせてタブを書き換える
    apply(ctx) {
      document.body.classList.add('theme-js--alightmotion');
      ctx.setTitleSuffix('Alight Motion');
      ctx.setWorkspaceTabs(['編集', 'エフェクト', 'カラー', '書き出し']);
    },
    // 他テーマへの切替時：このテーマ専用の状態を片付ける
    cleanup() {
      document.body.classList.remove('theme-js--alightmotion');
    },
  });
})();
