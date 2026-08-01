/* YMM4 風テーマの JavaScript 挙動 */
(function () {
  'use strict';

  // ステータスバーの時刻表示をトランスポートの表示と同期させる監視
  let timeObserver = null;
  // 解像度セレクトの change リスナー（cleanup で外すため保持する）
  let resHandler = null;
  // 差し替え前のプロパティパネル（cleanup で書き戻す）
  let originalPropsHTML = null;
  // 数値表示（.ymm4-num）を出力欄に追従させる監視とリスナー
  let numObserver = null;
  let propsInputHandler = null;
  let propsClickHandler = null;
  // トランスポート（再生コントロール）関連の後始末用
  let seekDragging = false;        // シークバーをドラッグ中は再生ヘッドへの自動追従を止める
  let volumeInputHandler = null;   // 音量スライダーの % 表示更新
  let savedPrevIcon = null;        // 差し替えたフレーム送りアイコンの復元用
  let savedNextIcon = null;

  // ---------------------------------------------------------
  // 下部ステータスバー
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // トランスポート（本家 YMM4 の再生コントロール帯）
  // ---------------------------------------------------------
  // 既存のボタン（再生・先頭へ など）は main.js のリスナーを保ったままの移動にとどめ、
  // 本家にしかない部品（停止・再生速度・シークバー・音量 % 表示）を新たに作って足す。
  // 並びは本家と同じ:
  //   再生 / 停止 / 速度 / リピート / フィット | 先頭 / 前アイテム / 前フレーム
  //   [シークバー] 次フレーム / 次アイテム / 末尾 | 音量アイコン / % / スライダー

  // プレビューの再生速度の選択肢（本家のコンボボックスと同じ並び）
  const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5];

  // 「x 1.0」「x 1.25」の表示形式（整数は 1 桁小数で見せる）
  function speedLabel(v) {
    return `x ${Number.isInteger(v) ? v.toFixed(1) : String(v)}`;
  }

  // アイコンボタンを 1 つ作る小さなヘルパー
  function tpButton(title, icon, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tbtn';
    b.title = title;
    b.innerHTML = `<i class="${icon}"></i>`;
    b.addEventListener('click', onClick);
    return b;
  }

  // 再生コントロール帯を本家 YMM4 の構成へ組み替える
  function buildTransport(ctx) {
    const bar = ctx.$('.transport');
    if (!bar || bar.querySelector('.ymm4-transport')) return;   // 配色モード切替などの再適用では作り直さない

    const wrap = document.createElement('div');
    wrap.className = 'ymm4-transport';

    // --- 左グループ：再生・停止・速度・リピート・フィット ---
    const gPlay = document.createElement('div');
    gPlay.className = 'ymm4-tp__group';

    const btnStop = tpButton('停止', 'ti ti-fi ti-player-stop', () => ctx.transport.stop());

    const speed = document.createElement('select');
    speed.className = 'ymm4-speed';
    speed.title = '再生速度';
    speed.innerHTML = SPEED_OPTIONS.map((v) => `<option value="${v}">${speedLabel(v)}</option>`).join('');
    speed.value = String(ctx.transport.getRate());
    speed.addEventListener('change', () => ctx.transport.setRate(speed.value));

    // プレビューは常にフィット表示のため、いまは押下状態の切り替えのみ
    const btnFit = tpButton('映像を画面サイズに合わせる', 'ti ti-arrows-diagonal', (e) => {
      e.currentTarget.classList.toggle('is-active');
    });

    gPlay.append(ctx.$('#btnPlay'), btnStop, speed, ctx.$('#btnLoop'), btnFit);

    // --- 中央：フレーム移動ボタンとシークバー ---
    const btnPrev = ctx.$('#btnPrev');
    const btnNext = ctx.$('#btnNext');
    // 1 フレーム送りは本家と同じ小さな三角のアイコンへ差し替える（cleanup で戻す）
    savedPrevIcon = btnPrev.innerHTML;
    savedNextIcon = btnNext.innerHTML;
    btnPrev.innerHTML = '<i class="ti ti-fi ti-caret-left"></i>';
    btnNext.innerHTML = '<i class="ti ti-fi ti-caret-right"></i>';

    const gPrev = document.createElement('div');
    gPrev.className = 'ymm4-tp__group';
    gPrev.append(
      ctx.$('#btnStart'),
      tpButton('前のアイテムへ', 'ti ti-fi ti-player-track-prev', () => ctx.transport.prevItem()),
      btnPrev
    );

    // シークバー（ミリ秒単位）。再生ヘッドへの追従は syncSeekbar が行う
    const seek = document.createElement('input');
    seek.type = 'range';
    seek.className = 'ymm4-seek';
    seek.title = 'シーク';
    seek.min = '0';
    seek.step = '1';
    seek.max = String(Math.round(ctx.transport.duration() * 1000));
    seek.value = String(Math.round(ctx.transport.playhead() * 1000));
    seek.addEventListener('input', () => ctx.transport.seek(Number(seek.value) / 1000));
    seek.addEventListener('pointerdown', () => { seekDragging = true; });
    seek.addEventListener('pointerup', () => { seekDragging = false; });
    seek.addEventListener('pointercancel', () => { seekDragging = false; });

    const gNext = document.createElement('div');
    gNext.className = 'ymm4-tp__group';
    gNext.append(
      btnNext,
      tpButton('次のアイテムへ', 'ti ti-fi ti-player-track-next', () => ctx.transport.nextItem()),
      ctx.$('#btnEnd')
    );

    // --- 右：音量（既存のアイコン＋スライダーに % 表示を挟む） ---
    const vol = bar.querySelector('.volume');
    const volInput = ctx.$('#volume');
    const volNum = document.createElement('span');
    volNum.className = 'ymm4-volnum';
    vol.insertBefore(volNum, volInput);
    volumeInputHandler = () => { volNum.textContent = `${Number(volInput.value).toFixed(1)} %`; };
    volInput.addEventListener('input', volumeInputHandler);
    volumeInputHandler();   // 初期値（現在の音量）を表示する

    wrap.append(gPlay, gPrev, seek, gNext, vol);
    bar.appendChild(wrap);
  }

  // 再生コントロール帯を既定の構成へ戻す（他テーマへの切替時）
  function restoreTransport(ctx) {
    const bar = ctx.$('.transport');
    const wrap = bar && bar.querySelector('.ymm4-transport');
    if (!wrap) return;

    // 音量の % 表示と購読を取り除く
    const volInput = ctx.$('#volume');
    if (volInput && volumeInputHandler) volInput.removeEventListener('input', volumeInputHandler);
    volumeInputHandler = null;
    const volNum = wrap.querySelector('.ymm4-volnum');
    if (volNum) volNum.remove();

    // フレーム送りのアイコンを元へ戻す
    const btnPrev = ctx.$('#btnPrev');
    const btnNext = ctx.$('#btnNext');
    if (btnPrev && savedPrevIcon != null) btnPrev.innerHTML = savedPrevIcon;
    if (btnNext && savedNextIcon != null) btnNext.innerHTML = savedNextIcon;
    savedPrevIcon = savedNextIcon = null;

    // 移動した既存ボタンを元のコンテナへ元の並びで戻す
    const controls = bar.querySelector('.transport__controls');
    if (controls) controls.append(ctx.$('#btnStart'), btnPrev, ctx.$('#btnPlay'), btnNext, ctx.$('#btnEnd'));
    const right = bar.querySelector('.transport__right');
    const vol = wrap.querySelector('.volume');
    if (right) {
      right.append(ctx.$('#btnLoop'));
      if (vol) right.append(vol);
    }

    // プレビュー速度を等倍へ戻し、新設した部品ごと帯を取り除く
    ctx.transport.setRate(1);
    seekDragging = false;
    wrap.remove();
  }

  // 再生ヘッドの動きへシークバーを追従させる（ドラッグ中は触らない）
  function syncSeekbar(ctx) {
    const seek = document.querySelector('.ymm4-seek');
    if (!seek || seekDragging) return;
    const durMs = Math.round(ctx.transport.duration() * 1000);
    if (Number(seek.max) !== durMs) seek.max = String(durMs);
    seek.value = String(Math.round(ctx.transport.playhead() * 1000));
  }

  // ---------------------------------------------------------
  // アイテム（プロパティ）パネルの組み立て
  // ---------------------------------------------------------
  // 本家 YMM4 の「アイテム」パネルと同じ行・同じ並びを HTML で組む。
  //
  // 数値行の DOM は必ず [input] → [output] → [.ymm4-num] の順に置く。
  //   ・main.js は input.nextElementSibling（= output）へ生の値を書き込む
  //   ・その output を監視して .ymm4-num に「-63.0 px」の形へ整形して表示する
  // 見た目の並び（ラベル → 数値 → スライダー → 補助ボタン）は CSS の order で作る。

  // 数値行。prop を渡した行だけ main.js のクリップ props と連動する
  function numRow(label, o) {
    const prop = o.prop ? ` data-prop="${o.prop}"` : '';
    const minis = (o.minis || []).map((m) => `<button class="ymm4-mini" type="button">${m}</button>`).join('');
    return `
      <div class="ymm4-row">
        <span class="ymm4-row__label">${label}</span>
        <input type="range" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${o.value}"${prop}
               data-unit="${o.unit || ''}" data-dec="${o.dec || 0}">
        <output hidden>${o.value}</output>
        <span class="ymm4-num"></span>
        ${minis}
      </div>`;
  }

  // セレクト行（合成モード・フォントなど）
  function selRow(label, options, o) {
    const opts = options.map((t) => `<option>${t}</option>`).join('');
    const after = (o && o.after) || '';
    return `
      <div class="ymm4-row ymm4-row--sel">
        <span class="ymm4-row__label">${label}</span>
        <select class="ymm4-select">${opts}</select>
        ${after}
      </div>`;
  }

  // 色見本の行（アイテムの色・文字色・装飾色）
  function swatchRow(label, color) {
    return `
      <div class="ymm4-row ymm4-row--sw">
        <span class="ymm4-row__label">${label}</span>
        <button class="ymm4-swatch" type="button" style="background:${color}"></button>
      </div>`;
  }

  // トグルスイッチ（1 セル内に 1〜2 個並べる）
  function toggle(label, on) {
    return `
      <span class="ymm4-tg">
        <span class="ymm4-tg__label">${label}</span>
        <button class="ymm4-switch${on ? ' is-on' : ''}" type="button" role="switch" aria-checked="${!!on}"></button>
      </span>`;
  }
  function toggleCell(...toggles) {
    return `<div class="ymm4-row ymm4-row--tg">${toggles.join('')}</div>`;
  }

  // 備考欄（1 行テキスト。プレースホルダは本家と同じ文言）
  function noteRow() {
    return `
      <div class="ymm4-row ymm4-row--full">
        <span class="ymm4-row__label">備考</span>
        <input type="text" class="ymm4-text" placeholder="Shift+Enterで改行">
      </div>`;
  }

  // テキスト編集ツールバー（本家の並びに合わせたアイコン列）
  const TEXT_TOOLBAR_ICONS = [
    'grip-vertical', 'bold', 'italic', 'underline', 'strikethrough',
    'language-katakana', 'text-increase', 'text-decrease', 'text-size',
    'cut', 'copy', 'clipboard', 'corner-down-left', 'chevron-down',
  ];

  // 映像エフェクトの一覧（右側の縦ツールバーつき）
  const FX_TOOLBAR_ICONS = ['plus', 'minus', 'device-floppy', 'device-floppy', 'chevron-up', 'chevron-down', 'dots-vertical'];

  function buildPanelHTML() {
    return `
    <div class="ymm4-props">

      <div class="prop-group">
        <h4 class="prop-group__title">全般</h4>
        <div class="ymm4-grid">
          ${numRow('フレーム', { min: 0, max: 4447, value: 104, minis: ['フ'] })}
          ${numRow('レイヤー', { min: 1, max: 30, value: 6 })}
          ${numRow('長さ', { min: 1, max: 4447, value: 98, minis: ['フ'] })}
          ${swatchRow('アイテムの色', '#2b53d6')}
          ${noteRow()}
          ${toggleCell(toggle('ロック', false), toggle('非表示', false))}
        </div>
      </div>

      <div class="prop-group">
        <h4 class="prop-group__title">描画</h4>
        <div class="ymm4-grid">
          ${numRow('X', { min: -500, max: 500, value: 0, unit: 'px', dec: 1, prop: 'x', minis: ['-'] })}
          ${numRow('Y', { min: -500, max: 500, value: 0, unit: 'px', dec: 1, prop: 'y', minis: ['-'] })}
          ${numRow('Z', { min: -500, max: 500, value: 0, unit: 'px', dec: 1, minis: ['-'] })}
          ${numRow('不透明度', { min: 0, max: 100, value: 100, unit: '%', dec: 1, prop: 'opacity', minis: ['-'] })}
          ${numRow('拡大率', { min: 10, max: 300, value: 100, unit: '%', dec: 1, prop: 'scale', minis: ['x2', '-'] })}
          ${numRow('回転角', { min: -180, max: 180, value: 0, unit: '°', dec: 1, prop: 'rotate', minis: ['-'] })}
          ${numRow('フェードイン', { min: 0, max: 5, step: 0.01, value: 0, unit: '秒', dec: 2 })}
          ${numRow('フェードアウト', { min: 0, max: 5, step: 0.01, value: 0, unit: '秒', dec: 2 })}
          ${selRow('合成モード', ['通常', '加算', '減算', '乗算', 'スクリーン', 'オーバーレイ'])}
          ${toggleCell(toggle('左右反転', false), toggle('クリッピング', false))}
          ${toggleCell(toggle('手前に表示', false))}
          ${toggleCell(toggle('Z値順に表示', false))}
        </div>
      </div>

      <div class="prop-group">
        <h4 class="prop-group__title">テキスト</h4>
        <div class="ymm4-grid">
          <div class="ymm4-row ymm4-row--full ymm4-row--top">
            <span class="ymm4-row__label">テキスト</span>
            <div class="ymm4-editor">
              <div class="ymm4-texttools">
                ${TEXT_TOOLBAR_ICONS.map((n) => `<button class="ymm4-tt" type="button"><i class="ti ti-${n}"></i></button>`).join('')}
              </div>
              <textarea class="ymm4-textarea" rows="2" spellcheck="false">杜気の人生
Season2</textarea>
            </div>
          </div>
          ${selRow('フォント', ['源ノグリッチ黒体 H1', 'Yu Gothic UI', 'Meiryo UI', 'BIZ UDGothic'],
            { after: '<button class="ymm4-mini ymm4-mini--icon" type="button"><i class="ti ti-refresh"></i></button>' })}
          ${numRow('サイズ', { min: 8, max: 400, value: 200, unit: 'px', dec: 1, minis: ['x8', '-'] })}
          ${numRow('行の高さ', { min: 10, max: 300, value: 100, unit: '%', dec: 1 })}
          ${numRow('文字間隔', { min: -50, max: 50, value: 0, unit: 'px', dec: 1, minis: ['-'] })}
          ${selRow('折り返し', ['折り返さない', '折り返す'])}
          ${numRow('折り返し幅', { min: 100, max: 3840, value: 1920, unit: 'px', dec: 1, minis: ['-'] })}
          ${selRow('文字揃え', ['中央揃え[中]', '左揃え[上]', '右揃え[下]'])}
          ${swatchRow('文字色', '#ffffff')}
          ${selRow('装飾', ['なし', '縁取り', '影', '縁取りと影'])}
          ${swatchRow('装飾色', '#000000')}
          ${toggleCell(toggle('太字', true), toggle('イタリック', true))}
          ${toggleCell(toggle('下線', false), toggle('打ち消し線', false))}
          ${toggleCell(toggle('行末スペース削除', false), toggle('文字ごとに分割', false))}
        </div>
      </div>

      <div class="prop-group">
        <h4 class="prop-group__title">テキスト / テキストアニメーション</h4>
        <div class="ymm4-grid">
          ${numRow('表示間隔', { min: 0, max: 5, step: 0.01, value: 0, unit: '秒', dec: 1 })}
          ${selRow('表示方向', ['先頭から', '末尾から', '中央から'])}
          ${numRow('非表示間隔', { min: 0, max: 5, step: 0.01, value: 0, unit: '秒', dec: 1 })}
          ${selRow('非表示方向', ['先頭から', '末尾から', '中央から'])}
        </div>
      </div>

      <div class="prop-group">
        <h4 class="prop-group__title">映像エフェクト</h4>
        <div class="ymm4-fx">
          <div class="ymm4-fx__list">
            <div class="ymm4-fx__item is-sel"><span class="ymm4-check is-on"></span>ランダム移動 X145px, Y145px, 0.07秒</div>
            <div class="ymm4-fx__item"><span class="ymm4-check is-on"></span>画面外へ退場</div>
            <div class="ymm4-fx__item"><span class="ymm4-check is-on"></span>画面外から登場</div>
          </div>
          <div class="ymm4-fx__tools">
            ${FX_TOOLBAR_ICONS.map((n) => `<button class="ymm4-tt" type="button"><i class="ti ti-${n}"></i></button>`).join('')}
          </div>
        </div>
      </div>

      <div class="prop-group">
        <h4 class="prop-group__title">ランダム</h4>
        <div class="ymm4-grid">
          ${numRow('X', { min: 0, max: 500, value: 145, unit: 'px', dec: 1, minis: ['-'] })}
          ${numRow('Y', { min: 0, max: 500, value: 145, unit: 'px', dec: 1, minis: ['-'] })}
          ${numRow('Z', { min: 0, max: 500, value: 0, unit: 'px', dec: 1, minis: ['-'] })}
          ${numRow('間隔', { min: 0, max: 1, step: 0.01, value: 0.07, unit: '秒', dec: 2, minis: ['-'] })}
          ${noteRow()}
        </div>
      </div>

      <div class="prop-group">
        <h4 class="prop-group__title">その他</h4>
        <button class="btn ymm4-default-btn" type="button">デフォルトに設定</button>
      </div>

    </div>`;
  }

  // 出力欄の生の値を「-63.0 px」の形へ整形して .ymm4-num に反映する
  function syncNum(out) {
    const input = out.previousElementSibling;
    const num = out.nextElementSibling;
    if (!input || !num || !num.classList.contains('ymm4-num')) return;
    const v = Number(out.textContent);
    const dec = Number(input.dataset.dec || 0);
    const unit = input.dataset.unit || '';
    const body = Number.isFinite(v) ? v.toFixed(dec) : out.textContent;
    num.textContent = unit ? `${body} ${unit}` : body;
  }

  // パネル内の全ての数値行を整形しなおす
  function syncAllNums(root) {
    root.querySelectorAll('.ymm4-row output').forEach(syncNum);
  }

  // 数値表示・トグル・エフェクト一覧の操作を購読する
  function attachPanelBehaviour(content) {
    detachPanelBehaviour(content);

    // スライダー操作：main.js が購読しない行（data-prop 無し）の出力欄を自分で更新する
    propsInputHandler = (e) => {
      const input = e.target;
      if (input.type !== 'range' || input.dataset.prop) return;
      const out = input.nextElementSibling;
      if (out && out.tagName === 'OUTPUT') out.textContent = input.value;
    };
    content.addEventListener('input', propsInputHandler);

    // トグル・チェック・エフェクト行の選択
    propsClickHandler = (e) => {
      const sw = e.target.closest('.ymm4-switch');
      if (sw) {
        const on = sw.classList.toggle('is-on');
        sw.setAttribute('aria-checked', String(on));
        return;
      }
      const check = e.target.closest('.ymm4-check');
      if (check) { check.classList.toggle('is-on'); return; }
      const item = e.target.closest('.ymm4-fx__item');
      if (item) {
        content.querySelectorAll('.ymm4-fx__item').forEach((el) => el.classList.remove('is-sel'));
        item.classList.add('is-sel');
      }
    };
    content.addEventListener('click', propsClickHandler);

    // main.js が出力欄へ書き込んだ値（クリップ選択時など）も整形して見せる
    numObserver = new MutationObserver((records) => {
      records.forEach((r) => {
        const out = r.target.nodeType === 1 ? r.target : r.target.parentNode;
        if (out && out.tagName === 'OUTPUT') syncNum(out);
      });
    });
    content.querySelectorAll('.ymm4-row output').forEach((out) => {
      numObserver.observe(out, { childList: true, characterData: true, subtree: true });
    });

    syncAllNums(content);
  }

  function detachPanelBehaviour(content) {
    if (numObserver) { numObserver.disconnect(); numObserver = null; }
    if (content && propsInputHandler) content.removeEventListener('input', propsInputHandler);
    if (content && propsClickHandler) content.removeEventListener('click', propsClickHandler);
    propsInputHandler = propsClickHandler = null;
  }

  // アイテムパネルを body 直下へ移し、画面の高さいっぱいに置けるようにする。
  // （既定では .layout の中にあり、タイムラインと縦に並べられないため）
  function detachPropsPanel(ctx) {
    const props = ctx.$('.panel--props');
    if (props && props.parentNode !== document.body) document.body.appendChild(props);
  }

  // アイテムパネルを .layout の末尾（元の位置）へ戻す
  function reattachPropsPanel(ctx) {
    const props = ctx.$('.panel--props');
    const layout = ctx.$('.layout');
    if (props && layout && props.parentNode !== layout) layout.appendChild(props);
  }

  // プロパティパネルを YMM4 の「アイテム」パネルへ差し替える
  function buildPropsPanel(ctx) {
    const content = ctx.$('#propsContent');
    if (!content) return;
    if (originalPropsHTML === null) originalPropsHTML = content.innerHTML;
    if (content.querySelector('.ymm4-props')) return;   // 配色モード切替などの再適用では作り直さない
    content.innerHTML = buildPanelHTML();
    // 差し替えで失われた input の購読をやり直す（新しい要素へ張り直される）
    ctx.rebindProps && ctx.rebindProps();
    attachPanelBehaviour(content);
  }

  // 元のプロパティパネルへ戻す
  function restorePropsPanel(ctx) {
    const content = ctx.$('#propsContent');
    if (!content) return;
    detachPanelBehaviour(content);
    if (originalPropsHTML !== null) {
      content.innerHTML = originalPropsHTML;
      ctx.rebindProps && ctx.rebindProps();
    }
  }

  window.registerTheme && window.registerTheme('ymm4', {
    // テーマ適用時：本家 YMM4 に合わせて各部のラベルを差し替え、
    // アイテムパネルを組み直し、下部にステータスバー（時刻 / 解像度）を追加する。
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

      // アイテムパネル（プロパティ）を本家と同じ構成に組み直し、
      // 画面右側の高さいっぱいへ移す
      buildPropsPanel(ctx);
      detachPropsPanel(ctx);

      // 再生コントロールを本家の帯（停止・速度・シークバーつき）へ組み替える
      buildTransport(ctx);

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

      // トランスポートの時刻表示（テーマ CSS で非表示）を監視して写す。
      // 同じ更新タイミングでシークバーも再生ヘッドへ追従させる
      if (timeObserver) timeObserver.disconnect();
      timeObserver = new MutationObserver(() => { syncStatusbar(ctx); syncSeekbar(ctx); });
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
      syncSeekbar(ctx);
    },

    // 他テーマへの切替時：このテーマ専用の状態を片付ける
    cleanup(ctx) {
      document.body.classList.remove('theme-js--ymm4');
      // 変更した各ラベルを既定へ戻す
      const label = ctx.$('.stage__label');
      if (label) label.textContent = 'プログラムモニター';
      const ptab = ctx.$('.panel--props .ptab');
      if (ptab) ptab.textContent = 'プロパティ';
      // アイテムパネルを元の内容・元の位置へ戻す
      restorePropsPanel(ctx);
      reattachPropsPanel(ctx);
      // 再生コントロールを既定の構成へ戻す
      restoreTransport(ctx);
      // ステータスバーと監視を取り除く
      if (timeObserver) { timeObserver.disconnect(); timeObserver = null; }
      const res = ctx.$('#resSelect');
      if (res && resHandler) { res.removeEventListener('change', resHandler); resHandler = null; }
      const bar = document.querySelector('.ymm4-statusbar');
      if (bar) bar.remove();
    },
  });
})();
