/* YMM4 風テーマの JavaScript 挙動 */
(function () {
  'use strict';
  window.registerTheme && window.registerTheme('ymm4', {
    // テーマ適用時：YMM4 はワークスペースタブを持たない（CSS で非表示）。
    // 念のためラベルは既定に戻し、タイトルへソフト名を付与する。
    apply(ctx) {
      document.body.classList.add('theme-js--ymm4');
      // YMM4 に合わせてモニターのラベルを変更する
      const label = ctx.$('.stage__label');
      if (label) label.textContent = 'プレビュー';
      ctx.setTitleSuffix('YMM4');
      ctx.setWorkspaceTabs(['編集', 'カラー', 'オーディオ', '書き出し']);
    },
    // 他テーマへの切替時：このテーマ専用の状態を片付ける
    cleanup(ctx) {
      document.body.classList.remove('theme-js--ymm4');
      // 変更したモニターのラベルを既定へ戻す
      const label = ctx.$('.stage__label');
      if (label) label.textContent = 'プログラムモニター';
    },
  });
})();
