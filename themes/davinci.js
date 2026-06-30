/* DaVinci Resolve 風テーマの JavaScript 挙動 */
(function () {
  'use strict';
  window.registerTheme && window.registerTheme('davinci', {
    // テーマ適用時：DaVinci のページ構成に合わせてワークスペースタブを書き換える
    apply(ctx) {
      document.body.classList.add('theme-js--davinci');
      ctx.setTitleSuffix('DaVinci');
      ctx.setWorkspaceTabs(['カット', '編集', 'カラー', 'デリバー']);
    },
    // 他テーマへの切替時：このテーマ専用の状態を片付ける
    cleanup() {
      document.body.classList.remove('theme-js--davinci');
    },
  });
})();
