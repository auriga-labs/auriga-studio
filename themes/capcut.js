/* CapCut 風テーマの JavaScript 挙動 */
(function () {
  'use strict';
  window.registerTheme && window.registerTheme('capcut', {
    // テーマ適用時：CapCut のワークスペース構成に合わせてタブを書き換える
    apply(ctx) {
      document.body.classList.add('theme-js--capcut');
      ctx.setTitleSuffix('CapCut');
      ctx.setWorkspaceTabs(['編集', 'テキスト', 'エフェクト', '書き出し']);
    },
    // 他テーマへの切替時：このテーマ専用の状態を片付ける
    cleanup() {
      document.body.classList.remove('theme-js--capcut');
    },
  });
})();
