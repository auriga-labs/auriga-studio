/* YMM4 風テーマの JavaScript 挙動 */
(function () {
  'use strict';

  // ステータスバーの時刻表示をトランスポートの表示と同期させる監視
  let timeObserver = null;
  // 解像度セレクトの change リスナー（cleanup で外すため保持する）
  let resHandler = null;

  // トランスポートの時刻と解像度セレクトの値を下部ステータスバーへ写す
  function syncStatusbar(ctx) {
    const bar = document.querySelector('.ymm4-statusbar');
    if (!bar) return;
    const cur = ctx.$('#curTime');
    const dur = ctx.$('#durTime');
    const sbCur = bar.querySelector('[data-sb="cur"]');
    const sbDur = bar.querySelector('[data-sb="dur"]');
    if (cur && sbCur) sbCur.textContent = cur.textContent;
    if (dur && sbDur) sbDur.textContent = dur.textContent;
    // 「1920 × 1080 (16:9)」→「1920x1080」の形式へ整形する
    const res = ctx.$('#resSelect');
    const sbRes = bar.querySelector('[data-sb="res"]');
    if (res && sbRes) {
      const m = String(res.value).match(/(\d+)\s*[×x]\s*(\d+)/);
      sbRes.textContent = m ? `${m[1]}x${m[2]}` : '';
    }
  }

  window.registerTheme && window.registerTheme('ymm4', {
    // テーマ適用時：本家 YMM4 に合わせて各部のラベルを差し替え、
    // 下部にステータスバー（時刻 / 解像度）を追加する。
    // 配色モード切替でも再実行されるため、多重適用しても安全に書く。
    apply(ctx) {
      document.body.classList.add('theme-js--ymm4');
      // モニターのラベルは本家の「プレビュー」
      const label = ctx.$('.stage__label');
      if (label) label.textContent = 'プレビュー';
      // 右パネルは本家の「アイテム」
      const ptab = ctx.$('.panel--props .ptab');
      if (ptab) ptab.textContent = 'アイテム';
      ctx.setTitleSuffix('YMM4');

      // 下部ステータスバー（本家はここに現在時刻・プロジェクト情報を表示する）
      if (!document.querySelector('.ymm4-statusbar')) {
        const bar = document.createElement('footer');
        bar.className = 'ymm4-statusbar';
        bar.innerHTML =
          '<span class="ymm4-statusbar__time">' +
          '<span data-sb="cur">00:00:00:00</span> / <span data-sb="dur">00:00:00:00</span>' +
          '</span>' +
          '<span class="ymm4-statusbar__right"><span data-sb="res"></span></span>';
        document.body.appendChild(bar);
      }

      // トランスポートの時刻表示（テーマ CSS で非表示）を監視して写す
      if (timeObserver) timeObserver.disconnect();
      timeObserver = new MutationObserver(() => syncStatusbar(ctx));
      ['#curTime', '#durTime'].forEach((sel) => {
        const el = ctx.$(sel);
        if (el) timeObserver.observe(el, { childList: true, characterData: true, subtree: true });
      });
      // 解像度の変更にも追従する
      const res = ctx.$('#resSelect');
      if (res) {
        if (resHandler) res.removeEventListener('change', resHandler);
        resHandler = () => syncStatusbar(ctx);
        res.addEventListener('change', resHandler);
      }
      syncStatusbar(ctx);
    },

    // 他テーマへの切替時：このテーマ専用の状態を片付ける
    cleanup(ctx) {
      document.body.classList.remove('theme-js--ymm4');
      // 変更した各ラベルを既定へ戻す
      const label = ctx.$('.stage__label');
      if (label) label.textContent = 'プログラムモニター';
      const ptab = ctx.$('.panel--props .ptab');
      if (ptab) ptab.textContent = 'プロパティ';
      // ステータスバーと監視を取り除く
      if (timeObserver) { timeObserver.disconnect(); timeObserver = null; }
      const res = ctx.$('#resSelect');
      if (res && resHandler) { res.removeEventListener('change', resHandler); resHandler = null; }
      const bar = document.querySelector('.ymm4-statusbar');
      if (bar) bar.remove();
    },
  });
})();
