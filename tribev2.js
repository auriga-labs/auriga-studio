/* ======================================================
   Auriga Studio — TRIBE v2 レーン

   タイムラインの上段に「TRIBE v2」レーンを足し、素材に対する
   脳反応の予測（scripts/tribev2_predict.py が書き出す .tribe.json）を
   再生時刻に合わせた曲線として描く。

   TRIBE v2 本体は Python 製で Auriga Studio からは直接動かせないため、
   ここが受け持つのは「解析コマンドの案内」と「結果の可視化」だけ。
   main.js とは window.aurigaTimeline（座標と操作の窓口）と
   auriga:layout / auriga:playhead イベント越しにやり取りする。
   ====================================================== */
(() => {
  'use strict';

  // 読み込める JSON の形式（scripts/tribev2_predict.py と合わせる）
  const FORMAT_ID = 'auriga.tribev2.timeline';
  // レーンの高さ(px)の下限。テーマによってはレイヤー行が薄いので、曲線の分だけ確保する
  const MIN_LANE_HEIGHT = 48;
  // 曲線の上下に空ける余白(px)。上は凡例と数値の分だけ広く取る
  const PAD_TOP = 14;
  const PAD_BOTTOM = 4;

  // 読み込み済みの解析結果。{ data, anchor } anchor はタイムライン上の開始秒
  let dataset = null;
  let visible = false;     // レーンの表示状態（既定は非表示。メニュー「Aurigaツール」かヘッダーの👁で切り替える）
  let lane = null;         // レーン本体（#tribeLane）
  let view = null;         // 左端に貼り付く表示領域（.tribe-lane__view）
  let canvas = null;
  let ctx2d = null;
  let empty = null;        // 未読み込み時の案内
  let fileInput = null;

  // main.js が公開する窓口。読み込み順の都合で毎回取り直す
  const api = () => window.aurigaTimeline || null;

  // レーンの高さ。テーマごとに違うレイヤー行の高さに合わせつつ、下限は確保する
  function laneHeight() {
    const row = document.querySelector('#tracks .track');
    const rowH = row ? row.getBoundingClientRect().height : 0;
    return Math.max(MIN_LANE_HEIGHT, Math.round(rowH) || 0);
  }

  // ------------------------------------------------------
  // 起動
  // ------------------------------------------------------
  function init() {
    lane = document.getElementById('tribeLane');
    if (!lane) return;
    view = lane.querySelector('.tribe-lane__view');
    canvas = lane.querySelector('.tribe-lane__canvas');
    empty = lane.querySelector('.tribe-lane__empty');
    ctx2d = canvas.getContext('2d');

    // JSON を選ぶための隠しファイル入力
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) readFile(fileInput.files[0]);
      fileInput.value = '';
    });
    document.body.appendChild(fileInput);

    bindLaneEvents();
    // main.js のレイヤー行が組み直されるたびに、レーンのヘッダーを差し込み直す
    document.addEventListener('auriga:layout', () => { mountHeader(); relayout(); });
    document.addEventListener('auriga:playhead', draw);

    const area = document.getElementById('tracksArea');
    if (area) {
      area.addEventListener('scroll', draw, { passive: true });
      if (window.ResizeObserver) new ResizeObserver(relayout).observe(area);
    }

    mountHeader();
    relayout();

    // メニュー（main.js の「Aurigaツール」）から表示切り替えできるように公開する
    window.aurigaTribe = { setVisible, visible: () => visible };
  }

  // ------------------------------------------------------
  // レーンのヘッダー（左端のトラックヘッダー列に差し込む）
  // ------------------------------------------------------
  // #trackHeaders は main.js が innerHTML ごと組み直すので、
  // レイアウト通知のたびに自分の行を作り直して先頭へ戻す。
  function mountHeader() {
    const headers = document.getElementById('trackHeaders');
    if (!headers) return;
    const old = headers.querySelector('.tribe-header');
    if (old) old.remove();

    const row = document.createElement('div');
    // トラックヘッダーの見た目（テーマ配色）をそのまま借りる
    row.className = 'track-header tribe-header';
    row.innerHTML = `
      <div class="track-header__icon tribe-header__icon" title="TRIBE v2（脳反応の予測）">
        <i class="ti ti-brain"></i>
      </div>
      <div class="track-header__label">TRIBE v2</div>
      <div class="track-header__ctrl">
        <button class="track-header__btn" data-tribe="load" title="解析結果（.tribe.json）を読み込む">＋</button>
        <button class="track-header__btn" data-tribe="toggle" title="表示切替">👁</button>
      </div>`;

    row.querySelector('[data-tribe="load"]').addEventListener('click', () => fileInput.click());
    const toggle = row.querySelector('[data-tribe="toggle"]');
    toggle.classList.toggle('is-off', !visible);
    toggle.addEventListener('click', () => setVisible(!visible));

    // スペーサー（ルーラーと高さを合わせる要素）の直後＝レイヤー1 の上に置く
    const spacer = headers.querySelector('.track-headers__spacer');
    if (spacer && spacer.nextSibling) headers.insertBefore(row, spacer.nextSibling);
    else headers.appendChild(row);
  }

  // 表示状態を切り替えて反映する。メニュー側（main.js）にもイベントで知らせる
  function setVisible(v) {
    visible = !!v;
    const toggle = document.querySelector('.tribe-header [data-tribe="toggle"]');
    if (toggle) toggle.classList.toggle('is-off', !visible);
    relayout();
    document.dispatchEvent(new CustomEvent('auriga:tribe-visibility', { detail: { visible } }));
  }

  // ------------------------------------------------------
  // レーン本体のイベント（ドロップ・クリック）
  // ------------------------------------------------------
  function bindLaneEvents() {
    lane.addEventListener('dragover', (e) => {
      // 解析結果の JSON だけを受け付ける（素材のドロップはトラックの担当）
      e.preventDefault();
      lane.classList.add('tribe-lane--drop');
    });
    lane.addEventListener('dragleave', () => lane.classList.remove('tribe-lane--drop'));
    lane.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      lane.classList.remove('tribe-lane--drop');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) readFile(file);
    });

    // 空のときの案内ボタン
    empty.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tribe]');
      if (!btn) return;
      if (btn.dataset.tribe === 'load') fileInput.click();
      if (btn.dataset.tribe === 'copy') copyCommand();
    });

    // レーンをクリックしたらその時刻へシークする（曲線から編集点を探すため）
    canvas.addEventListener('click', (e) => {
      const t = api();
      if (!t || !dataset) return;
      const rect = canvas.getBoundingClientRect();
      const area = document.getElementById('tracksArea');
      const x = e.clientX - rect.left + (area ? area.scrollLeft : 0);
      t.seek(Math.max(0, x / t.zoom()));
    });
  }

  // ------------------------------------------------------
  // 解析コマンドの案内
  // ------------------------------------------------------
  // 本家 YMM4 の動画出力ダイアログと同じ考え方で、実行はせずコマンドだけ見せる。
  // 選択中のクリップがあればそのファイルパスを埋めておく。
  function commandLine() {
    const t = api();
    const clip = t && t.selectedClip ? t.selectedClip() : null;
    const target = (clip && (clip.filePath || clip.name)) || '素材.mp4';
    return `python scripts/tribev2_predict.py "${target}"`;
  }

  function copyCommand() {
    const t = api();
    const line = commandLine();
    navigator.clipboard.writeText(line).then(
      () => t && t.toast('解析コマンドをコピーしました'),
      () => t && t.toast('コピーできませんでした'),
    );
  }

  // ------------------------------------------------------
  // 解析結果の読み込み
  // ------------------------------------------------------
  function readFile(file) {
    const t = api();
    const reader = new FileReader();
    reader.onload = () => {
      let json;
      try { json = JSON.parse(String(reader.result)); }
      catch { t && t.toast('JSON を読み取れませんでした'); return; }
      applyData(json);
    };
    reader.onerror = () => t && t.toast('ファイルを読み込めませんでした');
    reader.readAsText(file);
  }

  function applyData(json) {
    const t = api();
    if (!json || json.format !== FORMAT_ID || !Array.isArray(json.series)) {
      t && t.toast('TRIBE v2 の解析結果ではないようです');
      return;
    }
    const tr = Number(json.tr);
    if (!(tr > 0)) { t && t.toast('TR（1 点あたりの秒数）が読み取れません'); return; }

    // 選択中のクリップがあれば、その開始位置に合わせて曲線を置く
    const clip = t && t.selectedClip ? t.selectedClip() : null;
    const anchor = clip ? clip.start : 0;
    dataset = { data: json, tr, anchor };

    // 結果を読み込んだらレーンを自動で表示する（メニューのチェックも通知で追従する）
    mountHeader();
    setVisible(true);
    const where = anchor > 0 ? `（${anchor.toFixed(1)} 秒から）` : '';
    t && t.toast(`TRIBE v2: ${json.source || '解析結果'} を読み込みました${where}`);
  }

  // ------------------------------------------------------
  // レイアウトと描画
  // ------------------------------------------------------
  // ズーム・全体尺・パネル幅が変わったときに、レーンの寸法を取り直して描き直す
  function relayout() {
    const t = api();
    if (!lane || !t) return;

    lane.hidden = !visible;
    const header = document.querySelector('.tribe-header');
    if (header) header.style.display = visible ? '' : 'none';
    if (!visible) return;

    // 横スクロールの長さはトラックと揃える（中身のキャンバスは見えている幅だけ描く）
    lane.style.width = (t.seconds() * t.zoom()) + 'px';
    // 高さはレイヤー行に合わせる。ヘッダー行にも同じ高さを入れて左右をそろえる
    const h = laneHeight();
    lane.style.height = h + 'px';
    if (header) header.style.height = h + 'px';
    empty.hidden = !!dataset;
    draw();
  }

  // 再生中は毎フレーム再生ヘッドの通知が来るので、描画は次の描画タイミングまでまとめる
  let drawPending = false;
  function draw() {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(() => { drawPending = false; paint(); });
  }

  function paint() {
    const t = api();
    if (!t || !visible || !canvas) return;

    const area = document.getElementById('tracksArea');
    const scrollLeft = area ? area.scrollLeft : 0;
    const viewW = Math.max(1, area ? area.clientWidth : lane.clientWidth);
    const laneH = lane.clientHeight || laneHeight();
    const dpr = window.devicePixelRatio || 1;

    // キャンバスは「見えている幅」だけ持ち、sticky で左端に貼り付けておく。
    // タイムラインが長くなってもキャンバスの最大寸法に当たらない。
    if (canvas.width !== Math.round(viewW * dpr) || canvas.height !== Math.round(laneH * dpr)) {
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(laneH * dpr);
    }
    canvas.style.width = viewW + 'px';
    canvas.style.height = laneH + 'px';
    if (view) view.style.width = viewW + 'px';

    const g = ctx2d;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, viewW, laneH);
    if (!dataset) return;

    const zoom = t.zoom();
    const { data, tr, anchor } = dataset;
    const plotH = laneH - PAD_TOP - PAD_BOTTOM;
    // 時刻(秒) → キャンバス内の x 座標
    const toX = (sec) => sec * zoom - scrollLeft;

    // 素材が置かれている区間の地色（曲線の有効範囲を分かりやすくする）
    const x0 = toX(anchor);
    const x1 = toX(anchor + Number(data.duration || 0));
    g.fillStyle = 'rgba(127, 127, 127, .10)';
    g.fillRect(Math.max(0, x0), 0, Math.min(viewW, x1) - Math.max(0, x0), laneH);

    data.series.forEach((series) => {
      const values = series.values;
      if (!Array.isArray(values) || values.length === 0) return;
      const color = series.color || '#2bae8f';

      // 画面内に入る範囲だけを描く
      const first = Math.max(0, Math.floor((scrollLeft / zoom - anchor) / tr) - 1);
      const last = Math.min(values.length - 1, Math.ceil(((scrollLeft + viewW) / zoom - anchor) / tr) + 1);
      if (last < first) return;

      g.beginPath();
      for (let i = first; i <= last; i++) {
        const x = toX(anchor + i * tr);
        const y = PAD_TOP + plotH * (1 - clamp01(values[i]));
        if (i === first) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      // 折れ線の下を薄く塗る
      g.save();
      g.lineTo(toX(anchor + last * tr), laneH - PAD_BOTTOM);
      g.lineTo(toX(anchor + first * tr), laneH - PAD_BOTTOM);
      g.closePath();
      g.fillStyle = withAlpha(color, .18);
      g.fill();
      g.restore();

      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.lineJoin = 'round';
      g.stroke();
    });

    drawLegend(g, data.series, viewW);
    drawReadout(g, t.playhead(), viewW);
  }

  // 系列名の凡例（左上に固定表示）
  function drawLegend(g, series, viewW) {
    let x = 8;
    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'middle';
    series.forEach((s) => {
      const label = s.label || s.key || '';
      const w = g.measureText(label).width;
      if (x + w + 16 > viewW) return;
      g.fillStyle = s.color || '#2bae8f';
      g.fillRect(x, 6, 6, 6);
      g.fillStyle = 'rgba(127, 134, 148, .95)';
      g.fillText(label, x + 10, 9.5);
      x += w + 20;
    });
  }

  // 再生ヘッド位置の値を右上に出す
  function drawReadout(g, playhead, viewW) {
    const { data, tr, anchor } = dataset;
    const i = Math.round((playhead - anchor) / tr);
    const parts = [];
    data.series.forEach((s) => {
      if (!Array.isArray(s.values) || i < 0 || i >= s.values.length) return;
      parts.push(`${s.label || s.key} ${clamp01(s.values[i]).toFixed(2)}`);
    });
    if (!parts.length) return;
    const text = parts.join('  ');
    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.fillStyle = 'rgba(127, 134, 148, .95)';
    g.fillText(text, viewW - 8, 9.5);
    g.textAlign = 'left';
  }

  // ------------------------------------------------------
  // 小物
  // ------------------------------------------------------
  function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // #rrggbb を rgba() へ（曲線の下塗り用）
  function withAlpha(hex, alpha) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
