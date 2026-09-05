/* YMM4 風テーマの JavaScript 挙動 */
(function () {
  'use strict';

  // ステータスバーの時刻表示をトランスポートの表示と同期させる監視
  let timeObserver = null;
  // 解像度セレクトの change リスナー（cleanup で外すため保持する）
  let resHandler = null;
  // プロジェクト情報の変更（auriga:project）でステータスバーを更新するリスナー
  let projectHandler = null;
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
  let zoomUnsub = null;            // 描画比率の変化の購読解除（ズームコンボの表示更新）
  // タイムラインツールバー関連の後始末用
  let tlZoomHandler = null;        // ズーム倍率表示（100.0 など）の更新
  let savedToolIcons = null;       // 差し替えたツールボタン（⤧✂✋）の絵文字の復元用

  // ---------------------------------------------------------
  // 下部ステータスバー
  // ---------------------------------------------------------
  // 本家の並び: 現在時刻 / 総時間 | 現在フレーム / 総フレーム | 動画形式（1920x1080 60fps 48000Hz） | プロジェクト名

  // 秒を本家の時刻表記「HH:MM:SS.ff」（ff は 1/100 秒、切り捨て）にする
  function sbTime(sec) {
    const t = Math.max(0, Number(sec) || 0);
    // 浮動小数の誤差で 1 つ手前の値に落ちないよう、切り捨ての前にごく小さな値を足す
    const whole = Math.floor(t + 1e-6);
    const cs = Math.min(99, Math.floor((t - whole) * 100 + 1e-6));
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}.${pad(cs)}`;
  }

  // 秒をフレーム番号（切り捨て）にする
  function sbFrame(sec, fps) {
    return String(Math.floor(Math.max(0, Number(sec) || 0) * fps + 1e-6));
  }

  // 再生ヘッド・尺・プロジェクト情報（解像度・FPS・音声レート・名前）を下部ステータスバーへ写す
  function syncStatusbar(ctx) {
    const bar = document.querySelector('.ymm4-statusbar');
    if (!bar) return;
    const set = (key, text) => {
      const el = bar.querySelector(`[data-sb="${key}"]`);
      if (el && el.textContent !== text) el.textContent = text;
    };
    const fps = ctx.project.fps();
    const cur = ctx.transport.playhead();
    const dur = ctx.transport.duration();
    set('cur', sbTime(cur));
    set('dur', sbTime(dur));
    set('frame', sbFrame(cur, fps));
    set('frames', sbFrame(dur, fps));
    set('format', `${ctx.project.width()}x${ctx.project.height()} ${fps}fps ${ctx.project.hz()}Hz`);
    set('name', (ctx.project.name() || '').trim() || '無題');
  }

  // ---------------------------------------------------------
  // トランスポート（本家 YMM4 の再生コントロール帯）
  // ---------------------------------------------------------
  // 既存のボタン（再生・先頭へ など）は main.js のリスナーを保ったままの移動にとどめ、
  // 本家にしかない部品（停止・再生速度・シークバー・音量 % 表示）を新たに作って足す。
  // 並びは本家と同じ:
  //   再生 / 停止 / 速度 / リピート / フィット / ズーム | 先頭 / 前アイテム / 前フレーム
  //   [シークバー] 次フレーム / 次アイテム / 末尾 | 音量アイコン / % / スライダー

  // プレビューの再生速度の選択肢（本家のコンボボックスと同じ並び）
  const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5];
  // プレビューの描画比率（描画サイズ / 動画サイズ）の選択肢（%。本家のズームコンボと同じ並び）
  const ZOOM_OPTIONS = [50, 75, 100, 150, 200, 400, 800];

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

    // フィット：プレビューを領域に収まる大きさへ戻す（押下状態は syncZoom が現在の状態に合わせる）
    const btnFit = tpButton('映像を画面サイズに合わせる', 'ti ti-arrows-diagonal', () => ctx.preview.fit());
    btnFit.classList.add('ymm4-tp__fit');

    // ズーム：描画サイズ / 動画サイズの比率を表示・選択するコンボ（本家の「🔍 33%」）。
    // 先頭項目は現在の比率（フィット中や Ctrl+ホイールでの任意倍率）を示し、選ぶとフィットに戻る
    const zoomIco = document.createElement('i');
    zoomIco.className = 'ti ti-zoom ymm4-tpico';
    const zoom = document.createElement('select');
    zoom.className = 'ymm4-speed ymm4-zoom';
    zoom.title = '描画サイズの比率';
    zoom.innerHTML = '<option value="fit">--%</option>'
      + ZOOM_OPTIONS.map((v) => `<option value="${v}">${v}%</option>`).join('');
    zoom.addEventListener('change', () => {
      if (zoom.value === 'fit') ctx.preview.fit();
      else ctx.preview.setRatio(Number(zoom.value) / 100);
      syncZoom(ctx);   // 変更できなかった場合（プレビュー非表示など）も表示を実状態へ戻す
    });

    gPlay.append(ctx.$('#btnPlay'), btnStop, speed, ctx.$('#btnLoop'), btnFit, zoomIco, zoom);

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

  // ズームコンボとフィットボタンを現在の描画比率にそろえる
  function syncZoom(ctx) {
    const zoom = document.querySelector('.ymm4-transport .ymm4-zoom');
    if (!zoom) return;
    const isFit = ctx.preview.isFit();
    const pct = Math.round(ctx.preview.ratio() * 100);
    const fixed = !isFit && ZOOM_OPTIONS.includes(pct);
    // 先頭項目：固定値を選択中はフィット比率、それ以外（フィット中・任意倍率）は現在の比率を見せる
    const headPct = fixed ? Math.round(ctx.preview.fitRatio() * 100) : pct;
    zoom.options[0].textContent = headPct > 0 ? `${headPct}%` : '--%';
    zoom.value = fixed ? String(pct) : 'fit';
    const fit = document.querySelector('.ymm4-transport .ymm4-tp__fit');
    if (fit) fit.classList.toggle('is-active', isFit);
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
  // タイムライン（本家 YMM4 のシーンタブとツールバー帯）
  // ---------------------------------------------------------
  // タイムライン上部を本家の構成へ組み替える。
  //   ・上端：シーンタブ（メイン ＋ ▼）
  //   ・ツールバー：ズーム | アイテム追加 | 元に戻す/やり直し | 編集 |
  //     既存ツール（選択・カット・ハンド） | アイテム間移動 | ファイル | スクショ | フィードバック
  // 実処理がある操作（分割・削除・ズームなど）は既存のボタンへ委譲し、
  // 本家にしかない機能は未実装トーストのボタン（スタブ）として並べる。

  // フラットなアイコンボタンを 1 つ作る
  function tlButton(title, icon, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ymm4-tlbtn';
    b.title = title;
    b.innerHTML = `<i class="ti ti-${icon}"></i>`;
    b.addEventListener('click', onClick);
    return b;
  }

  // まだ実体のない機能のボタン（押すと未実装トーストを出す）
  function tlStub(ctx, label, icon) {
    return tlButton(label, icon, () => ctx.toast(`${label}（未実装）`));
  }

  // ボタンをひとまとまりにするグループ
  function tlGroup(...children) {
    const g = document.createElement('div');
    g.className = 'ymm4-tlgroup';
    g.append(...children);
    return g;
  }

  // グループ間の区切り（WPF ツールバー風の点線グリップ）
  function tlSep() {
    const s = document.createElement('span');
    s.className = 'ymm4-tlsep';
    return s;
  }

  // シーンタブ帯（メイン ＋ ▼）を .timeline の先頭に挿す
  function buildTimelineTabs(ctx) {
    const tl = ctx.$('.timeline');
    if (!tl || tl.querySelector('.ymm4-tltabs')) return;   // 再適用では作り直さない

    const tabs = document.createElement('div');
    tabs.className = 'ymm4-tltabs';
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'ymm4-tltab is-active';
    tab.textContent = 'メイン';
    const add = tlButton('タイムラインを追加', 'plus', () => ctx.toast('タイムラインの追加（未実装）'));
    const menu = tlButton('タイムライン一覧', 'caret-down', () => ctx.toast('タイムライン一覧（未実装）'));
    add.classList.add('ymm4-tlbtn--mini');
    menu.classList.add('ymm4-tlbtn--mini');
    tabs.append(tab, add, menu);
    tl.insertBefore(tabs, tl.firstChild);
  }

  // ツールバー帯を組み立てて .timeline__toolbar へ足す
  function buildTimelineToolbar(ctx) {
    const bar = ctx.$('.timeline__toolbar');
    if (!bar || bar.querySelector('.ymm4-tltb')) return;   // 再適用では作り直さない

    const wrap = document.createElement('div');
    wrap.className = 'ymm4-tltb';

    // --- ズーム：虫眼鏡・倍率表示・既存スライダー（移設）・▼ ---
    const zoom = ctx.$('#zoom');
    const zBox = document.createElement('div');
    zBox.className = 'ymm4-tlz';
    zBox.innerHTML = '<i class="ti ti-zoom-in"></i>';
    const zNum = document.createElement('span');
    zNum.className = 'ymm4-tlz__num';
    tlZoomHandler = () => { zNum.textContent = Number(zoom.value).toFixed(1); };
    zoom.addEventListener('input', tlZoomHandler);
    tlZoomHandler();   // 初期値（現在のズーム）を表示する
    const zCaret = tlButton('ズームプリセット', 'caret-down', () => ctx.toast('ズームプリセット（未実装）'));
    zCaret.classList.add('ymm4-tlbtn--mini');
    zBox.append(zNum, zoom, zCaret);

    // --- アイテム追加：テキストは実際に追加、動画・音声・画像はファイル選択を開く ---
    const openPicker = () => ctx.$('#fileInput').click();
    const gAdd = tlGroup(
      tlStub(ctx, 'ボイスアイテム', 'message-circle'),
      tlButton('テキストアイテム', 'letter-t', () => ctx.timeline.addItem('text', 'テキスト', 3)),
      tlButton('動画アイテム（ファイルを選択）', 'video', openPicker),
      tlButton('音声アイテム（ファイルを選択）', 'music', openPicker),
      tlButton('画像アイテム（ファイルを選択）', 'photo', openPicker),
      tlStub(ctx, '図形アイテム', 'triangle-square-circle'),
      tlStub(ctx, '立ち絵アイテム', 'user'),
      tlStub(ctx, '表情アイテム', 'mood-smile'),
      tlStub(ctx, '画面効果アイテム', 'sparkles'),
      tlStub(ctx, '画面パーツアイテム', 'layout-grid'),
      tlStub(ctx, 'テンプレートアイテム', 'template'),
      tlStub(ctx, 'エフェクトアイテム', 'wand')
    );

    // --- 元に戻す・やり直し（既存ボタンへ委譲） ---
    const gUndo = tlGroup(
      tlButton('元に戻す', 'arrow-back-up', () => ctx.$('#btnUndo').click()),
      tlButton('やり直し', 'arrow-forward-up', () => ctx.$('#btnRedo').click())
    );

    // --- 編集：分割・削除は既存ボタンへ委譲 ---
    const gEdit = tlGroup(
      tlButton('再生位置で分割', 'scissors', () => ctx.$('#btnSplit').click()),
      tlStub(ctx, 'コピー', 'copy'),
      tlStub(ctx, '貼り付け', 'clipboard'),
      tlButton('削除', 'trash', () => ctx.$('#btnDelete').click()),
      tlStub(ctx, 'ロック', 'lock'),
      tlStub(ctx, 'グリッド設定', 'grid-dots')
    );

    // --- 既存の選択・カット・ハンドツール（main.js のリスナーを保ったまま移す） ---
    // 絵文字グリフ（⤧✂✋）は他のボタンと揃うアイコンへ差し替える（cleanup で戻す）
    const TOOL_ICONS = { select: 'pointer', cut: 'cut', hand: 'hand-stop' };
    savedToolIcons = {};
    ctx.$$('.tl-tool').forEach((b) => {
      savedToolIcons[b.dataset.tool] = b.innerHTML;
      if (TOOL_ICONS[b.dataset.tool]) b.innerHTML = `<i class="ti ti-${TOOL_ICONS[b.dataset.tool]}"></i>`;
    });
    const gTools = tlGroup(...ctx.$$('.tl-tool'));

    // --- 前後のアイテム境界へ移動 ---
    const gJump = tlGroup(
      tlButton('前のアイテムへ移動', 'arrow-bar-to-left', () => ctx.transport.prevItem()),
      tlButton('次のアイテムへ移動', 'arrow-bar-to-right', () => ctx.transport.nextItem())
    );

    // --- ファイル操作・設定 ---
    const gFile = tlGroup(
      tlButton('ファイルを開く', 'folder-open', openPicker),
      tlStub(ctx, 'プロジェクトを保存', 'device-floppy'),
      tlStub(ctx, '設定', 'adjustments')
    );

    // --- スクリーンショット ---
    const gShot = tlGroup(
      tlStub(ctx, 'スクリーンショット', 'camera'),
      tlStub(ctx, '画面の複製', 'screenshot')
    );

    // --- フィードバック送信（右端のラベル付きボタン） ---
    const feedback = document.createElement('button');
    feedback.type = 'button';
    feedback.className = 'ymm4-tlfeedback';
    feedback.innerHTML = '<i class="ti ti-message-report"></i>フィードバックを送信';
    feedback.addEventListener('click', () => ctx.toast('フィードバックを送信（デモ）'));

    wrap.append(
      zBox, tlSep(), gAdd, tlSep(), gUndo, tlSep(), gEdit, tlSep(),
      gTools, tlSep(), gJump, tlSep(), gFile, tlSep(), gShot, feedback
    );
    bar.appendChild(wrap);
  }

  // タイムライン上部を既定の構成へ戻す（他テーマへの切替時）
  function restoreTimelineToolbar(ctx) {
    const bar = ctx.$('.timeline__toolbar');
    const wrap = bar && bar.querySelector('.ymm4-tltb');
    if (wrap) {
      // ズームスライダーの購読を外して元の位置へ戻す
      const zoom = ctx.$('#zoom');
      if (zoom && tlZoomHandler) zoom.removeEventListener('input', tlZoomHandler);
      tlZoomHandler = null;
      const zHome = bar.querySelector('.tl-zoom');
      if (zHome && zoom) zHome.appendChild(zoom);
      // 移設したツールボタンをアイコンごと元へ戻す
      const tHome = bar.querySelector('.tl-tools');
      wrap.querySelectorAll('.tl-tool').forEach((b) => {
        if (savedToolIcons && savedToolIcons[b.dataset.tool] != null) b.innerHTML = savedToolIcons[b.dataset.tool];
        if (tHome) tHome.appendChild(b);
      });
      savedToolIcons = null;
      // 新設した部品ごと帯を取り除く
      wrap.remove();
    }
    // シーンタブ帯も取り除く
    const tabs = document.querySelector('.ymm4-tltabs');
    if (tabs) tabs.remove();
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

  // ---------------------------------------------------------
  // 動画出力ダイアログ（本家 YMM4 の「動画出力」ウィンドウ）
  // ---------------------------------------------------------
  // メニュー「ファイル > 動画出力」から開くモーダル。main.js はテーマフック
  // exportVideo() 経由でここへ委譲する。出力モード（FFmpeg / MediaFoundation /
  // 連番PNG+WAV / その他）ごとにエンコード設定の内容を切り替え、
  // 範囲指定・音量調整・その他の各セクションは全モード共通で表示する。
  // 実際のエンコード処理は未実装（デモ）で、見た目と操作感の再現が目的。

  let exDlg = null;        // 生成済みダイアログのルート要素（テーマ内で使い回す）
  let exRaf = 0;           // プレビュー転写ループの requestAnimationFrame ID
  let exKeyHandler = null; // Esc で閉じるキー購読（開いている間だけ）

  // FFmpeg プリセット定義（本家 YMM4 と同じ内容）。
  // v / a はコマンド欄に入るコーデック・フォーマット指定のみで、
  // ビットレート（-b:v / -b:a）と -loglevel はプレビュー生成時に組み立てる。
  // vbr は kbps、abr は音声ビットレートの選択肢の表記。
  // 「カスタム」は定義を持たず、選択しても現在の設定を保つ
  const EX_FF_PRESETS = {
    'AVI':             { vbr: 2097151, abr: '192 kbps', v: '-c:v rawvideo -f avi', a: '-c:a mp3 -f avi' },
    'GIF':             { vbr: 2097151, abr: '192 kbps', v: '-c:v gif -f gif',      a: '-f null -c:a aac' },
    'MP3':             { vbr: 240000,  abr: '192 kbps', v: '-f null -c:v h264',    a: '-c:a mp3 -f mp3' },
    'MP4 / AV1+AAC':   { vbr: 10000,   abr: '192 kbps', v: '-c:v libsvtav1 -f mp4', a: '-c:a aac -f mp4' },
    'MP4 / H.264+AAC': { vbr: 240000,  abr: '192 kbps', v: '-c:v h264 -f mp4',     a: '-c:a aac -f mp4' },
    'MP4 / VP9+AAC':   { vbr: 2097151, abr: '192 kbps', v: '-c:v vp9 -f mp4',      a: '-c:a aac -f mp4' },
    'WebP':            { vbr: 2097151, abr: '192 kbps', v: '-c:v webp -f webp',    a: '-f null -c:a aac' },
  };

  // 音声ビットレートの選択肢（本家 YMM4 の一覧）。
  // 「指定しない」を選ぶとコマンドから -b:a を省く
  const EX_ABR_OPTIONS = [
    '指定しない', '32 kbps', '96 kbps', '128 kbps', '160 kbps', '192 kbps',
    '256 kbps', '320 kbps', '384 kbps', '512 kbps', '576 kbps',
  ];

  // ラベル + 任意の部品を 1 行に並べる
  function exRow(label, body) {
    return `<div class="ymm4-ex__row"><span class="ymm4-ex__label">${label}</span>${body}</div>`;
  }

  // セレクトボックス。sel と一致する項目を選択状態にする
  function exSelect(cls, options, sel, disabled) {
    const opts = options.map((t) => `<option${t === sel ? ' selected' : ''}>${t}</option>`).join('');
    return `<select class="ymm4-select${cls ? ' ' + cls : ''}"${disabled ? ' disabled' : ''}>${opts}</select>`;
  }

  // 2 列グリッド用：ラベル + セレクトのセル
  function exCellSelect(label, options, sel) {
    return `<div class="ymm4-ex__cell"><span class="ymm4-ex__label">${label}</span>${exSelect('', options, sel)}</div>`;
  }

  // 2 列グリッド用：ラベル + 数値表示 + スライダーのセル。
  // data-dec / data-unit は数値表示の整形（syncExSlider）が読む
  function exCellSlider(label, o) {
    return `
      <div class="ymm4-ex__cell">
        <span class="ymm4-ex__label">${label}</span>
        <span class="ymm4-ex__num"></span>
        <input type="range" min="${o.min}" max="${o.max}" step="${o.step || 1}" value="${o.value}"
               data-dec="${o.dec || 0}" data-unit="${o.unit || ''}">
      </div>`;
  }

  // 2 列グリッド用：ラベル + トグルスイッチのセル（スイッチはセル右端へ寄せる）
  function exCellToggle(label, on) {
    return `
      <div class="ymm4-ex__cell ymm4-ex__cell--tg">
        <span class="ymm4-ex__label">${label}</span>
        <button class="ymm4-switch${on ? ' is-on' : ''}" type="button" role="switch" aria-checked="${!!on}"></button>
      </div>`;
  }

  // エクスパンダー（丸囲みシェブロンの見出し + 折りたたみ本文）を 1 つ組む。
  // mode を渡したグループは該当する出力モードのときだけ表示され、
  // closed=true のグループは折りたたんだ状態で開始する
  function exGroup(title, body, mode, closed) {
    return `
      <section class="ymm4-ex__group${closed ? ' is-closed' : ''}"${mode ? ` data-exmode="${mode}"` : ''}>
        <button class="ymm4-ex__head" type="button"><span class="ymm4-ex__chev"></span>${title}</button>
        <div class="ymm4-ex__grp">${body}</div>
      </section>`;
  }

  // 範囲指定のトランスポートのアイコンボタン
  function exTpBtn(action, title, icon, extra) {
    return `<button class="tbtn${extra ? ' ' + extra : ''}" type="button" data-ex="${action}" title="${title}"><i class="${icon}"></i></button>`;
  }

  // 秒数を本家の「00:00:00.0333333」形式（.NET TimeSpan 風）へ整形する
  function exFormatLen(sec) {
    const s = Math.max(0, sec);
    const whole = Math.floor(s % 60);
    const frac = (s % 60 - whole).toFixed(7).slice(2);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(whole)}.${frac}`;
  }

  // スライダーの数値表示（「-18.0 dB」「50」など）を隣の .ymm4-ex__num へ反映する
  function syncExSlider(input) {
    const num = input.parentElement && input.parentElement.querySelector('.ymm4-ex__num');
    if (!num) return;
    const body = Number(input.value).toFixed(Number(input.dataset.dec || 0));
    num.textContent = input.dataset.unit ? `${body} ${input.dataset.unit}` : body;
  }

  // FFmpeg のコマンドプレビューを組み立て直す（手入力があればそちらを見せる）
  function updateExCmds() {
    if (!exDlg) return;
    const ff = exDlg.querySelector('[data-exmode="ffmpeg"]');
    const vbr = Number(ff.querySelector('.ymm4-ex__vbr').value) || 0;
    const abr = parseInt(ff.querySelector('.ymm4-ex__abr').value, 10);   // 「指定しない」は NaN になる
    // コマンド欄はコーデック・フォーマット部分のみ（空なら既定の H.264 / AAC）。
    // ビットレートと -loglevel はここで足してプレビューを組み立てる
    const vcmd = ff.querySelector('.ymm4-ex__vcmd').value.trim() || '-c:v h264 -f mp4';
    const acmd = ff.querySelector('.ymm4-ex__acmd').value.trim() || '-c:a aac -f mp4';
    ff.querySelector('[data-excmd="v"]').textContent = `-b:v ${vbr * 1000} ${vcmd} -loglevel warning`;
    ff.querySelector('[data-excmd="a"]').textContent =
      `${Number.isFinite(abr) ? `-b:a ${abr * 1000} ` : ''}${acmd} -loglevel warning`;
  }

  // プリセットの内容を FFmpeg の各欄（コマンド・映像ビットレート）へ反映する
  function applyExPreset(name) {
    const p = EX_FF_PRESETS[name];
    if (!p || !exDlg) return;   // 「カスタム」は何もしない（現在の設定を保つ）
    const ff = exDlg.querySelector('[data-exmode="ffmpeg"]');
    ff.querySelector('.ymm4-ex__vcmd').value = p.v;
    ff.querySelector('.ymm4-ex__acmd').value = p.a;
    ff.querySelector('.ymm4-ex__vbr').value = String(p.vbr);
    ff.querySelector('.ymm4-ex__abr').value = p.abr;
    updateExCmds();
  }

  // 出力モードに応じてエンコード設定グループの表示を切り替える
  function applyExMode() {
    if (!exDlg) return;
    const mode = exDlg.querySelector('.ymm4-ex__mode').value;
    exDlg.querySelectorAll('[data-exmode]').forEach((g) => { g.hidden = g.dataset.exmode !== mode; });
  }

  // ズーム（%）に合わせてプレビューの表示幅を変える（出力解像度 1920px 基準）
  function applyExZoom() {
    if (!exDlg) return;
    const pct = parseInt(exDlg.querySelector('.ymm4-ex__zoomsel').value, 10) || 18;
    exDlg.querySelector('.ymm4-ex__canvas').style.width = `${Math.round(1920 * pct / 100)}px`;
  }

  // 動画範囲（開始・終了フレーム）から「動画の長さ」を計算し直す
  function updateExRangeLen(ctx) {
    if (!exDlg) return;
    const s = Number(exDlg.querySelector('[data-exval="start"]').value) || 0;
    const e = Number(exDlg.querySelector('[data-exval="end"]').value) || 0;
    exDlg.querySelector('[data-exval="len"]').textContent = exFormatLen(Math.max(0, e - s) / ctx.transport.fps());
  }

  // プレビュー転写ループ：メインのコンポジターの画と現在フレームを追従させる
  function exPreviewLoop(ctx) {
    exRaf = 0;
    if (!exDlg || exDlg.hidden) return;
    // 現在のフレーム表示（変化したときだけ書き換える）
    const cur = exDlg.querySelector('[data-exval="cur"]');
    const txt = String(Math.round(ctx.transport.playhead() * ctx.transport.fps()));
    if (cur.textContent !== txt) cur.textContent = txt;
    // コンポジターの画を転写する（WebGL 側の都合で写せない場合は黒のまま）
    const canvas = exDlg.querySelector('.ymm4-ex__canvas');
    const src = document.getElementById('compositor');
    if (canvas && src) {
      const g = canvas.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, canvas.width, canvas.height);
      try { g.drawImage(src, 0, 0, canvas.width, canvas.height); } catch (e) {}
    }
    exRaf = requestAnimationFrame(() => exPreviewLoop(ctx));
  }

  // ダイアログの DOM を組み立てて body 直下へ追加する（初回のみ）
  function buildExportDialog(ctx) {
    exDlg = document.createElement('div');
    exDlg.className = 'ymm4-export';
    exDlg.hidden = true;

    // --- エンコード設定（FFmpeg 出力） ---
    const ffmpegGroup = exGroup('エンコード設定', `
      ${exRow('FFmpegフォルダ', `
        <input type="text" class="ymm4-text ymm4-ex__dir" value=".\\user\\resource\\ffmpeg\\" spellcheck="false">
        <button class="ymm4-mini ymm4-mini--icon" type="button" data-ex="dir" title="フォルダを選択"><i class="ti ti-folder"></i></button>`)}
      ${exRow('プリセット', `
        ${exSelect('ymm4-ex__preset', ['カスタム', ...Object.keys(EX_FF_PRESETS)], 'カスタム')}
        <button class="ymm4-mini ymm4-mini--icon" type="button" data-ex="preset-save" title="プリセットを保存"><i class="ti ti-device-floppy"></i></button>`)}
      ${exRow('映像ビットレート', `
        ${exSelect('ymm4-ex__w120 ymm4-ex__vauto', ['自動', '手動'], '自動')}
        ${exSelect('ymm4-ex__w140 ymm4-ex__vkind', ['固定ビットレート', '平均ビットレート', '品質基準 VBR'], '固定ビットレート', true)}
        <input type="number" class="ymm4-text ymm4-ex__vbr" value="240000" min="1" disabled>
        <span class="ymm4-ex__unit">kbps</span>`)}
      ${exRow('音声ビットレート', exSelect('ymm4-ex__abr', EX_ABR_OPTIONS, '192 kbps'))}
      ${exRow('映像コマンド', '<input type="text" class="ymm4-text ymm4-ex__vcmd" spellcheck="false">')}
      ${exRow('プレビュー', '<span class="ymm4-ex__cmd" data-excmd="v"></span>')}
      ${exRow('音声コマンド', '<input type="text" class="ymm4-text ymm4-ex__acmd" spellcheck="false">')}
      ${exRow('プレビュー', '<span class="ymm4-ex__cmd" data-excmd="a"></span>')}
      <div class="ymm4-ex__cols">${exCellToggle('ハードウェアエンコード', true)}</div>
    `, 'ffmpeg');

    // --- エンコード設定 + 詳細設定（MediaFoundation出力） ---
    const mfGroup = exGroup('エンコード設定', `
      ${exRow('映像ビットレート', `
        ${exSelect('ymm4-ex__w120 ymm4-ex__vauto', ['自動', '手動'], '自動')}
        ${exSelect('ymm4-ex__w140 ymm4-ex__vkind', ['平均ビットレート', '固定ビットレート'], '平均ビットレート', true)}
        <input type="number" class="ymm4-text ymm4-ex__vbr" value="300000" min="1" disabled>
        <span class="ymm4-ex__unit">kbps</span>`)}
      ${exRow('音声ビットレート', exSelect('', ['96 kbps', '128 kbps', '160 kbps', '192 kbps', '256 kbps', '320 kbps'], '192 kbps'))}
    `, 'mf');
    // 詳細設定は折りたたんだ状態で開始する
    const mfDetailGroup = exGroup('詳細設定', `
      <div class="ymm4-ex__cols">
        ${exCellSelect('H.264 プロファイル', ['デフォルト（High）', 'Baseline', 'Main', 'High'], 'デフォルト（High）')}
        ${exCellSelect('H.264 レベル', ['自動', '3.0', '3.1', '3.2', '4.0', '4.1', '4.2', '5.0', '5.1', '5.2'], '自動')}
        ${exCellSelect('AAC プロファイル', ['AAC Level 2', 'AAC Level 4', 'HE-AAC v1', 'HE-AAC v2'], 'AAC Level 2')}
        <div class="ymm4-ex__cell"></div>
        ${exCellSlider('エンコード速度', { min: 0, max: 100, value: 50 })}
        ${exCellSlider('スレッド数（0：自動）', { min: 0, max: 64, value: 0 })}
        ${exCellSlider('量子化最小値', { min: 0, max: 51, value: 0 })}
        ${exCellSlider('量子化最大値', { min: 0, max: 51, value: 51 })}
        ${exCellSlider('最大キーフレーム間隔（0：自動）', { min: 0, max: 300, value: 0 })}
        ${exCellSlider('最大Bフレーム連続数', { min: 0, max: 16, value: 2 })}
        ${exCellToggle('ハードウェアエンコード', false)}
        ${exCellToggle('CABAC', true)}
        ${exCellToggle('ノイズ対策', true)}
      </div>
    `, 'mf', true);

    // --- エンコード設定（連番PNG + WAV出力） ---
    const pngGroup = exGroup('エンコード設定', `
      <div class="ymm4-ex__cols">
        ${exCellToggle('連番PNG出力', true)}
        ${exCellToggle('WAV出力', true)}
      </div>
      ${exRow('ファイル名', '<input type="text" class="ymm4-text" value="無題" spellcheck="false">')}
    `, 'png');

    // --- 範囲指定（全モード共通） ---
    const rangeGroup = exGroup('範囲指定', `
      <div class="ymm4-ex__stage"><canvas class="ymm4-ex__canvas" width="960" height="540"></canvas></div>
      <div class="ymm4-ex__tp">
        ${exTpBtn('play', '再生/停止', 'ti ti-fi ti-player-play')}
        ${exTpBtn('stop', '停止', 'ti ti-fi ti-player-stop')}
        <select class="ymm4-speed ymm4-ex__speed" title="再生速度">${SPEED_OPTIONS.map((v) => `<option value="${v}"${v === 1 ? ' selected' : ''}>${speedLabel(v)}</option>`).join('')}</select>
        ${exTpBtn('sync', 'プレビューの更新', 'ti ti-refresh')}
        ${exTpBtn('fit', '映像を画面サイズに合わせる', 'ti ti-arrows-diagonal', 'is-active')}
        <span class="ymm4-ex__tpico"><i class="ti ti-zoom-in"></i></span>
        <select class="ymm4-speed ymm4-ex__zoomsel" title="ズーム">${[10, 18, 25, 33, 50, 100].map((v) => `<option${v === 18 ? ' selected' : ''}>${v}%</option>`).join('')}</select>
        ${exTpBtn('rangefit', '表示範囲を映像に合わせる', 'ti ti-maximize')}
        ${exTpBtn('start', '先頭へ', 'ti ti-fi ti-player-skip-back')}
        ${exTpBtn('prev-item', '前のアイテムへ', 'ti ti-fi ti-player-track-prev')}
        ${exTpBtn('prev-frame', '前のフレームへ', 'ti ti-fi ti-caret-left')}
        ${exTpBtn('next-frame', '次のフレームへ', 'ti ti-fi ti-caret-right')}
        ${exTpBtn('next-item', '次のアイテムへ', 'ti ti-fi ti-player-track-next')}
        ${exTpBtn('end', '末尾へ', 'ti ti-fi ti-player-skip-forward')}
        <span class="ymm4-ex__tpico ymm4-ex__tpvol"><i class="ti ti-volume"></i></span>
        <span class="ymm4-volnum ymm4-ex__volnum">100.0 %</span>
        <input type="range" class="ymm4-ex__vol" min="0" max="100" value="100" title="音量">
      </div>
      ${exRow('現在のフレーム', '<span class="ymm4-ex__val" data-exval="cur">0</span>')}
      ${exRow('動画範囲（フレーム）', `
        <button class="ymm4-mini" type="button" data-ex="range-start" title="現在のフレームを開始位置にする">[..</button>
        <input type="number" class="ymm4-text ymm4-ex__frame" data-exval="start" value="0" min="0">
        <span class="ymm4-ex__tilde">～</span>
        <input type="number" class="ymm4-text ymm4-ex__frame" data-exval="end" value="1" min="0">
        <button class="ymm4-mini" type="button" data-ex="range-end" title="現在のフレームを終了位置にする">..]</button>`)}
      ${exRow('動画の長さ', '<span class="ymm4-ex__val" data-exval="len">00:00:00.0000000</span>')}
    `, null, true);

    // --- 音量調整 / 音割れ対策（全モード共通） ---
    const compGroup = exGroup('音量調整 / 音割れ対策（コンプレッサー）', `
      ${exRow('音量調整', exSelect('ymm4-ex__w220', ['何もしない', '最大音量を0dBにする', '最大音量を0dB以下にする'], '最大音量を0dB以下にする'))}
      ${exRow('コンプレッサー', exSelect('', ['無効', '自動', '手動'], '自動'))}
      <div class="ymm4-ex__cols">
        ${exCellSlider('閾値', { min: -60, max: 0, step: 0.1, value: -18, dec: 1, unit: 'dB' })}
        ${exCellSlider('最大音量', { min: -10, max: 0, step: 0.1, value: -0.2, dec: 1, unit: 'dB' })}
        ${exCellSlider('アタックタイム', { min: 0, max: 0.5, step: 0.001, value: 0.006, dec: 3, unit: '秒' })}
        ${exCellSlider('リリースタイム', { min: 0, max: 1, step: 0.001, value: 0.06, dec: 3, unit: '秒' })}
        ${exCellToggle('先読み', true)}
      </div>
    `, null, true);

    // --- その他（全モード共通） ---
    const etcGroup = exGroup('その他', `
      <div class="ymm4-ex__cols">
        ${exCellToggle('字幕ファイル（.sub）を出力', false)}
        ${exCellToggle('字幕にキャラクター名を含める', true)}
        ${exCellToggle('ボイス一覧（.csv）を出力', false)}
        ${exCellToggle('素材一覧（.csv）を出力', false)}
        ${exCellToggle('親作品ID一覧（.txt）を出力', true)}
      </div>
    `);

    exDlg.innerHTML = `
      <div class="ymm4-export__backdrop"></div>
      <div class="ymm4-ex" role="dialog" aria-modal="true" aria-label="動画出力">
        <header class="ymm4-ex__title">
          <img class="ymm4-ex__mark" src="favicon-symbol.svg" alt="" width="16" height="16">
          <span class="ymm4-ex__name">動画出力</span>
          <button class="ymm4-ex__wbtn" type="button" data-ex="min" title="最小化"><i class="ti ti-minus"></i></button>
          <button class="ymm4-ex__wbtn" type="button" data-ex="max" title="最大化"><i class="ti ti-square"></i></button>
          <button class="ymm4-ex__wbtn ymm4-ex__wbtn--close" type="button" data-ex="close" title="閉じる"><i class="ti ti-x"></i></button>
        </header>
        <div class="ymm4-ex__body">
          ${exGroup('全般', exRow('動画出力', `
            <select class="ymm4-select ymm4-ex__mode">
              <option value="ffmpeg">FFmpeg 出力</option>
              <option value="mf">MediaFoundation出力</option>
              <option value="png">連番PNG + WAV出力</option>
              <option value="other">その他のファイルのみ</option>
            </select>`))}
          ${ffmpegGroup}
          ${mfGroup}
          ${mfDetailGroup}
          ${pngGroup}
          ${rangeGroup}
          ${compGroup}
          ${etcGroup}
          <div class="ymm4-ex__foot"><button type="button" class="btn ymm4-ex__run" data-ex="run">出力</button></div>
        </div>
      </div>`;
    document.body.appendChild(exDlg);

    // スライダーの数値表示を初期値で整形する
    exDlg.querySelectorAll('.ymm4-ex__cell input[type="range"]').forEach(syncExSlider);
    updateExCmds();
    applyExMode();

    // --- クリック（トグル・エクスパンダー・各ボタン） ---
    exDlg.addEventListener('click', (e) => {
      // 背景クリックで閉じる
      if (e.target.classList.contains('ymm4-export__backdrop')) { closeExportDialog(); return; }
      // トグルスイッチ
      const sw = e.target.closest('.ymm4-switch');
      if (sw) {
        const on = sw.classList.toggle('is-on');
        sw.setAttribute('aria-checked', String(on));
        return;
      }
      // エクスパンダーの開閉
      const head = e.target.closest('.ymm4-ex__head');
      if (head) { head.parentElement.classList.toggle('is-closed'); return; }
      // data-ex 属性のボタン
      const btn = e.target.closest('[data-ex]');
      if (!btn) return;
      const fps = ctx.transport.fps();
      switch (btn.dataset.ex) {
        case 'close': closeExportDialog(); break;
        case 'min': ctx.toast('最小化（未実装）'); break;
        case 'max': {
          // 最大化 ⇔ 元のサイズ の切り替え
          const on = exDlg.classList.toggle('is-max');
          btn.title = on ? '元に戻す' : '最大化';
          break;
        }
        case 'play': ctx.transport.toggle(); break;
        case 'stop': ctx.transport.stop(); break;
        case 'sync': ctx.toast('プレビューの更新（未実装）'); break;
        case 'fit': btn.classList.toggle('is-active'); break;
        case 'rangefit': ctx.toast('表示範囲の変更（未実装）'); break;
        case 'start': ctx.transport.seek(0); break;
        case 'prev-item': ctx.transport.prevItem(); break;
        case 'prev-frame': ctx.transport.seek(ctx.transport.playhead() - 1 / fps); break;
        case 'next-frame': ctx.transport.seek(ctx.transport.playhead() + 1 / fps); break;
        case 'next-item': ctx.transport.nextItem(); break;
        case 'end': ctx.transport.seek(ctx.transport.duration()); break;
        // 現在のフレームを動画範囲の開始/終了へ書き込む
        case 'range-start':
        case 'range-end': {
          const which = btn.dataset.ex === 'range-start' ? 'start' : 'end';
          exDlg.querySelector(`[data-exval="${which}"]`).value = String(Math.round(ctx.transport.playhead() * fps));
          updateExRangeLen(ctx);
          break;
        }
        case 'dir': ctx.toast('FFmpeg フォルダの選択（未実装）'); break;
        case 'preset-save': ctx.toast('プリセットの保存（未実装）'); break;
        case 'run':
          closeExportDialog();
          ctx.toast('書き出しを開始しました… 🎞️');
          break;
      }
    });

    // --- 変更（モード・ビットレート自動/手動・ズーム・再生速度・音声ビットレート） ---
    exDlg.addEventListener('change', (e) => {
      const t = e.target;
      if (t.classList.contains('ymm4-ex__mode')) { applyExMode(); return; }
      if (t.classList.contains('ymm4-ex__vauto')) {
        // 「手動」のときだけビットレートの種類と数値を編集できる
        const row = t.closest('.ymm4-ex__row');
        const manual = t.value === '手動';
        row.querySelector('.ymm4-ex__vkind').disabled = !manual;
        row.querySelector('.ymm4-ex__vbr').disabled = !manual;
        return;
      }
      if (t.classList.contains('ymm4-ex__preset')) { applyExPreset(t.value); return; }
      if (t.classList.contains('ymm4-ex__zoomsel')) { applyExZoom(); return; }
      if (t.classList.contains('ymm4-ex__speed')) { ctx.transport.setRate(t.value); return; }
      if (t.classList.contains('ymm4-ex__abr')) {
        // 音声ビットレートを手動で変えたらプリセットは「カスタム」へ戻す
        exDlg.querySelector('.ymm4-ex__preset').value = 'カスタム';
        updateExCmds();
      }
    });

    // --- 入力（スライダーの数値表示・音量 %・コマンドプレビュー・動画範囲） ---
    exDlg.addEventListener('input', (e) => {
      const t = e.target;
      if (t.type === 'range' && t.closest('.ymm4-ex__cell')) { syncExSlider(t); return; }
      if (t.classList.contains('ymm4-ex__vol')) {
        exDlg.querySelector('.ymm4-ex__volnum').textContent = `${Number(t.value).toFixed(1)} %`;
        return;
      }
      if (t.classList.contains('ymm4-ex__vbr') || t.classList.contains('ymm4-ex__vcmd') || t.classList.contains('ymm4-ex__acmd')) {
        // FFmpeg 側の欄を手動で変えたらプリセットは「カスタム」へ戻す
        // （MediaFoundation 側のビットレート欄はプリセットと無関係）
        if (t.closest('[data-exmode="ffmpeg"]')) {
          exDlg.querySelector('.ymm4-ex__preset').value = 'カスタム';
          updateExCmds();
        }
        return;
      }
      if (t.dataset.exval === 'start' || t.dataset.exval === 'end') updateExRangeLen(ctx);
    });
  }

  // ダイアログを開く（メニュー「ファイル > 動画出力」から）
  function openExportDialog(ctx) {
    if (!exDlg) buildExportDialog(ctx);
    // 動画範囲は開くたびにプロジェクトの長さで初期化し直す
    const frames = Math.max(1, Math.round(ctx.transport.duration() * ctx.transport.fps()));
    exDlg.querySelector('[data-exval="start"]').value = '0';
    exDlg.querySelector('[data-exval="end"]').value = String(frames);
    updateExRangeLen(ctx);
    applyExZoom();
    exDlg.hidden = false;
    // Esc で閉じる（開いている間だけ・アプリ側のキー処理より先に受ける）
    exKeyHandler = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeExportDialog(); }
    };
    window.addEventListener('keydown', exKeyHandler, true);
    exPreviewLoop(ctx);
  }

  // ダイアログを閉じる（DOM は残して設定値を保つ）
  function closeExportDialog() {
    if (!exDlg) return;
    exDlg.hidden = true;
    if (exKeyHandler) { window.removeEventListener('keydown', exKeyHandler, true); exKeyHandler = null; }
    if (exRaf) { cancelAnimationFrame(exRaf); exRaf = 0; }
  }

  // ダイアログを DOM ごと取り除く（他テーマへの切替時）
  function destroyExportDialog() {
    closeExportDialog();
    if (exDlg) { exDlg.remove(); exDlg = null; }
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
      // 縦の分け目は本家と同じく「プレビューの高さ固定・タイムラインが残りを使う」構成にする
      // （境界バーのドラッグはプレビューの高さを変え、ウィンドウの高さの変化はタイムラインが受ける）
      ctx.layout.setPreviewFixed(true);

      // アイテムパネル（プロパティ）を本家と同じ構成に組み直し、
      // 画面右側の高さいっぱいへ移す
      buildPropsPanel(ctx);
      detachPropsPanel(ctx);

      // 再生コントロールを本家の帯（停止・速度・シークバー・ズームつき）へ組み替える
      buildTransport(ctx);
      // ズームコンボは描画比率の変化（リサイズ・解像度変更・Ctrl+ホイール）に追従させる
      if (zoomUnsub) zoomUnsub();
      zoomUnsub = ctx.preview.onChange(() => syncZoom(ctx));
      syncZoom(ctx);

      // タイムライン上部を本家の構成（シーンタブ＋アイテム追加・編集ツールバー）へ組み替える
      buildTimelineTabs(ctx);
      buildTimelineToolbar(ctx);

      // 下部ステータスバー（本家はここに現在時刻・フレーム・動画形式・プロジェクト名を表示する）
      if (!document.querySelector('.ymm4-statusbar')) {
        const bar = document.createElement('footer');
        bar.className = 'ymm4-statusbar';
        // 区切り線で仕切った小さな枠を左から並べる。
        // 「現在時刻 / 総時間」「現在フレーム / 総フレーム」はそれぞれ 1 つの枠にまとめる（「/」の前後に区切り線は置かない）
        const cell = (html) => `<span class="ymm4-statusbar__cell">${html}</span>`;
        bar.innerHTML =
          cell('<span data-sb="cur">00:00:00.00</span> / <span data-sb="dur">00:00:00.00</span>') +
          cell('<span data-sb="frame">0</span> / <span data-sb="frames">0</span>') +
          cell('<span data-sb="format"></span>') +
          cell('<span data-sb="name">無題</span>');
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
      // プロジェクト情報（名前・FPS・解像度・音声レート）の変更（新規作成・読み込み）にも追従する
      if (projectHandler) document.removeEventListener('auriga:project', projectHandler);
      projectHandler = () => syncStatusbar(ctx);
      document.addEventListener('auriga:project', projectHandler);
      syncStatusbar(ctx);
      syncSeekbar(ctx);
    },

    // メニュー「ファイル > 動画出力」からの委譲先（main.js の handleMenuAction が呼ぶ）
    exportVideo(ctx) {
      openExportDialog(ctx);
    },

    // 他テーマへの切替時：このテーマ専用の状態を片付ける
    cleanup(ctx) {
      document.body.classList.remove('theme-js--ymm4');
      // 縦の分け目を既定の「タイムラインの高さ固定・プレビューが残りを使う」構成へ戻す
      ctx.layout.setPreviewFixed(false);
      // 変更した各ラベルを既定へ戻す
      const label = ctx.$('.stage__label');
      if (label) label.textContent = 'プログラムモニター';
      const ptab = ctx.$('.panel--props .ptab');
      if (ptab) ptab.textContent = 'プロパティ';
      // アイテムパネルを元の内容・元の位置へ戻す
      restorePropsPanel(ctx);
      reattachPropsPanel(ctx);
      // ズームコンボの購読を外し、再生コントロールを既定の構成へ戻す
      if (zoomUnsub) { zoomUnsub(); zoomUnsub = null; }
      restoreTransport(ctx);
      // タイムライン上部（シーンタブ・ツールバー）を既定の構成へ戻す
      restoreTimelineToolbar(ctx);
      // 動画出力ダイアログを DOM ごと取り除く
      destroyExportDialog();
      // ステータスバーと監視を取り除く
      if (timeObserver) { timeObserver.disconnect(); timeObserver = null; }
      const res = ctx.$('#resSelect');
      if (res && resHandler) { res.removeEventListener('change', resHandler); resHandler = null; }
      if (projectHandler) { document.removeEventListener('auriga:project', projectHandler); projectHandler = null; }
      const bar = document.querySelector('.ymm4-statusbar');
      if (bar) bar.remove();
    },
  });
})();
