/* ======================================================
   Auriga Studio — 動画編集UI ロジック
   ====================================================== */
(() => {
    'use strict';

    // ---- 定数 ----
    let FPS = 30;   // 1秒あたりのフレーム数（プロジェクト読み込みで上書きされる）
    const THEME_KEY = 'auriga.theme';   // テーマ（モード）設定の保存キー
    const RES_KEY = 'auriga.resolution';   // 解像度選択の保存キー
    const PLAYHEAD_KEY = 'auriga.playhead'; // 再生ヘッド位置(秒)の保存キー
    const USER_KEY = 'auriga.user';     // ログイン中ユーザー情報の保存キー
    const PANELS_KEY = 'auriga.panels'; // ツールメニューで切り替えるパネル表示状態の保存キー
    const FLOATS_KEY = 'auriga.floats'; // 独立ウィンドウ化したパネルの状態（位置・サイズ）の保存キー
    const AUTOHIDE_KEY = 'auriga.autohide'; // 「自動的に隠す」中のパネルの保存キー

    // ---- OAuth（Google ログイン）----
    // Google の認可画面を新しいタブで直接開く。リダイレクト先の PHP バックエンド
    // （app.auriga.studio/oauth/callback.php）がトークン交換を行い、postMessage で
    // ユーザー情報を返す。client_id / redirect_uri / scope は公開情報なのでここに持つ。
    const OAUTH_ORIGIN = 'https://app.auriga.studio';            // 認証サーバーのオリジン
    const OAUTH_GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';  // Google 認可エンドポイント
    const OAUTH_CLIENT_ID = '1056602047872-2ajrhud4bs4iemgnhtro9bhb4fa9alpf.apps.googleusercontent.com';
    const OAUTH_REDIRECT_URI = OAUTH_ORIGIN + '/oauth/callback.php';  // 承認済みリダイレクトURI
    // ⚠ oauth/config.php の GOOGLE_SCOPES と一致させること
    const OAUTH_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive'];
    const OAUTH_LOGOUT_URL = OAUTH_ORIGIN + '/oauth/logout.php?app=1'; // ログアウトURL
    const THEMES = ['auriga', 'ymm4', 'davinci', 'premiere', 'capcut', 'alightmotion'];
    const THEME_LABELS = { auriga: 'Aurigaオリジナル', ymm4: 'YMM4', davinci: 'DaVinci', premiere: 'Premiere', capcut: 'CapCut', alightmotion: 'Alight Motion' };

    // ---- 配色モード（ライト / ダーク / システムに準ずる）----
    // テーマ（対応ソフト風の配色セット）とは独立した軸。共通の themes/<name>.css に
    // ライト時は themes/<name>-light.css、ダーク時は themes/<name>-dark.css を重ねて読み込む。
    const MODE_KEY = 'auriga.mode';   // 配色モードの保存キー
    const MODES = ['light', 'dark', 'system'];
    const MODE_LABELS = { light: 'ライト', dark: 'ダーク', system: 'システムに準ずる' };
    const DEFAULT_MODE = 'dark';      // 既定はダーク

    // ---- メニューレイアウト ----
    // テーマ（対応ソフト風の配色セット）ごとのメニュー定義ファイル。
    // キーは THEMES と対応させ、テーマ切替に追従してメニューバーを差し替える。
    const MENU_LAYOUTS = {
        auriga:   'menu_layout/auriga.json',
        ymm4:     'menu_layout/ymm4.json',
        davinci:  'menu_layout/davinci.json',
        premiere: 'menu_layout/premiere.json',
    };
    const DEFAULT_MENU_LAYOUT = 'ymm4';   // 未対応テーマ時のフォールバック（YMM4）
    const PX_PER_SEC_BASE = 1;        // ズーム値(px)がそのまま1秒あたりのpx
    let TIMELINE_SECONDS = 60;        // タイムライン全体の長さ(秒)。プロジェクト読み込みで延長される

    // ---- 状態 ----
    const state = {
        zoom: 60,                     // 1秒あたりのpx
        playing: false,
        loop: false,
        rate: 1,                      // プレビューの再生速度（YMM4 テーマの速度コンボが変更する）
        playhead: 0,                  // 秒
        duration: 10,                 // 秒
        selectedClipId: null,
        selectedMediaId: null,        // モニター表示中のメディア
        monitorSource: null,          // {type,name,src} モニターのソース
        monitorMode: 'program',       // 'program'=タイムライン合成 / 'source'=単一ソース
        volume: 0.8,
        clipboard: null,              // コピーしたクリップ
        tool: 'select',
        clips: [],                    // {id,type,name,track,start,dur,props}
        nextId: 1,
        menuLayoutKey: null,   // 現在のメニュー定義（初回 applyTheme で確定）
        projectName: null,     // プロジェクト名（読み込んだファイル名由来。書き出しファイル名に使う）
        projectWidth: null,    // YMM4 プロジェクトの解像度（px 座標の換算基準。null=未読込）
        projectHeight: null,
        // ツールメニューのチェックリストで切り替えるパネルの表示状態
        panels: { preview: true, items: true },
        // 独立ウィンドウ化（フローティング）したパネルの状態。{ on, x, y, w, h } を持つ
        floats: { preview: null, items: null, timeline: null },
        // 「自動的に隠す」中のパネル（画面端のタブへ畳み、ホバーでせり出す）
        autoHide: { preview: false, items: false },
    };

    // ---- トラック定義（上から） ----
    // YMM4 ライクに種類を設けず「レイヤー1」のような連番にする。
    // どのレイヤーにも映像・音声・テキストを置ける。
    // 重なり順は YMM4 と同じで、番号が大きい（下の行の）レイヤーほど手前に描画する。
    const LAYER_COUNT = 5;             // 既定のレイヤー数（上から レイヤー1…）
    const DEFAULT_TRACK = 'L1';        // 新規クリップの既定レイヤー
    const TRACKS = Array.from({ length: LAYER_COUNT }, (_, i) => ({
        id: 'L' + (i + 1),
        label: 'レイヤー ' + (i + 1),
        volume: 100,                   // レイヤー音量(%)（YMM4 の LayerSettings.Volume）
        color: null,                   // レイヤー色（YMM4 の LayerSettings.Color。null=なし）
    }));

    // ---- メディアプール（読み込んだファイルが入る） ----
    const MEDIA = [];

    const EFFECTS = [
        { icon: '✨', name: 'グロー',       desc: '光をにじませる' },
        { icon: '🌫️', name: 'ブラー',       desc: 'ぼかし効果' },
        { icon: '🎞️', name: 'フィルム',     desc: 'レトロな質感' },
        { icon: '⚡', name: 'グリッチ',     desc: 'ノイズ歪み' },
        { icon: '🌈', name: 'クロマキー',   desc: '背景を透過' },
        { icon: '🔆', name: 'ビネット',     desc: '周辺を暗く' },
    ];

    const TEXT_PRESETS = [
        { icon: '🅰️', name: 'シンプル見出し' },
        { icon: '💬', name: '字幕テロップ' },
        { icon: '🎯', name: 'ポップタイトル' },
        { icon: '📰', name: 'ニュース風' },
    ];

    const DEFAULT_PROPS = {
        x: 0, y: 0, scale: 100, rotate: 0, opacity: 100,
        speed: 100, volume: 100, brightness: 100, contrast: 100, saturate: 100,
    };

    // ---- DOM 参照 ----
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));

    const els = {
        splash: $('#splash'),
        appMenu: $('#appMenu'),
        mediaGrid: $('#mediaGrid'),
        effectList: $('#effectList'),
        textPresets: $('#textPresets'),
        trackHeaders: $('#trackHeaders'),
        tracks: $('#tracks'),
        ruler: $('#ruler'),
        playhead: $('#playhead'),
        tracksArea: $('#tracksArea'),
        curTime: $('#curTime'),
        durTime: $('#durTime'),
        btnPlay: $('#btnPlay'),
        toast: $('#toast'),
        propsEmpty: $('#propsEmpty'),
        propsContent: $('#propsContent'),
        viewerCanvas: $('#viewerCanvas'),
        textOverlay: $('#textOverlay'),
        previewVideo: $('#previewVideo'),
        compositor: $('#compositor'),
    };

    // 合成の描画基盤。initCompositor が PixiJS（WebGPU 優先 → WebGL）を初期化し、
    // どちらも使えない場合のみ Canvas 2D（compCtx）へフォールバックする。
    // ※ 同じキャンバスに 2D コンテキストを先に作ると WebGPU が取れなくなるため、
    //    compCtx はフォールバック確定時に初めて生成する。
    let pixi = null;      // { renderer, stage, bg, bgW, bgH } PixiJS 一式（初期化成功時のみ）
    let compCtx = null;   // Canvas 2D フォールバック用コンテキスト
    let compositorBackend = '';   // バージョン情報に表示する描画バックエンド名

    // ======================================================
    // 初期化
    // ======================================================
    async function init() {
        restorePanelVisibility();   // パネルの表示状態を先に確定させる（メニューのチェックがこれに従う）
        applyStoredTheme();   // 保存済みテーマを最初に適用（対応するメニューバーも生成される）
        renderMedia();
        renderEffects();
        renderTextPresets();
        renderTrackHeaders();
        renderTracks();
        renderRuler();
        bindUI();
        await initCompositor();    // 描画基盤（WebGPU / WebGL / Canvas 2D）を初期化
        restorePersistedState();   // 保存済みの解像度・再生ヘッド位置を復元
        els.previewVideo.volume = state.volume;   // ソースモニターの初期音量を状態に合わせる
        updateTimeDisplay();
        updatePlayhead();
        els.viewerCanvas.classList.add('program');   // 既定はプログラム（合成）モニター
        composite(state.playhead, false);
        hideSplash();   // 初期化が終わったのでスプラッシュを閉じる
        toast('Auriga Studio へようこそ 🎬');
    }

    // ======================================================
    // スプラッシュ画面
    // ======================================================
    // 初期化完了後にスプラッシュをフェードアウトさせて DOM から取り除く。
    // 一瞬で消えると味気ないので最低表示時間（3 秒）を確保する。
    const SPLASH_MIN_MS = 3000;           // スプラッシュの最低表示時間(ms)
    const splashShownAt = performance.now();   // スクリプト読み込み時刻を起点にする
    function hideSplash() {
        const el = els.splash;
        if (!el) return;
        const wait = Math.max(0, SPLASH_MIN_MS - (performance.now() - splashShownAt));
        setTimeout(() => {
            el.classList.add('is-hide');
            // フェードアウト後に要素を取り除く（保険でタイマーも併用）
            const remove = () => el.remove();
            el.addEventListener('transitionend', remove, { once: true });
            setTimeout(remove, 800);
        }, wait);
    }

    // ======================================================
    // 描画：メディア / エフェクト / テキスト
    // ======================================================
    function renderMedia() {
        if (!MEDIA.length) {
            els.mediaGrid.innerHTML = `
                <div class="media-empty">
                    <p>メディアがありません</p>
                    <p class="media-empty__sub">「＋ メディアを読み込む」または<br>ファイルをドラッグして追加</p>
                </div>`;
            return;
        }

        els.mediaGrid.innerHTML = MEDIA.map((m) => `
            <div class="media-item" draggable="true" data-media="${m.id}">
                <div class="media-item__thumb media-item__thumb--${m.type}">
                    ${thumbInner(m)}
                    <span class="media-item__badge">${m.badge || m.type.toUpperCase()}</span>
                </div>
                <div class="media-item__name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>
            </div>
        `).join('');

        $$('.media-item').forEach((el) => {
            el.classList.toggle('is-active', el.dataset.media === state.selectedMediaId);
            const m = () => MEDIA.find((x) => x.id === el.dataset.media);

            el.addEventListener('dragstart', (e) => {
                const md = m();
                e.dataTransfer.setData('application/json', JSON.stringify({
                    kind: 'media', type: md.type, name: md.name, src: md.src || null,
                    dur: md.dur || null,   // 実尺（読み取り済みなら配置に使う）
                }));
            });
            // クリック → モニターに表示
            el.addEventListener('click', () => showInMonitor(m()));
            // ダブルクリック → タイムラインに追加
            el.addEventListener('dblclick', () => addClipToBestTrack(m()));
        });
    }

    // メディアサムネイルの中身（生成済みなら画像、未生成・音声はアイコン）
    function thumbInner(m) {
        if (m.thumb) return `<img src="${m.thumb}" alt="">`;
        if (m.type === 'image' && m.src) return `<img src="${m.src}" alt="">`;
        if (m.type === 'audio') return `<span class="media-item__glyph">♪</span>`;
        return `<span class="media-item__glyph media-item__glyph--load">⏳</span>`;
    }

    function renderEffects() {
        els.effectList.innerHTML = EFFECTS.map((e) => `
            <div class="effect-item" draggable="true">
                <span class="effect-item__icon">${e.icon}</span>
                <div>
                    <div class="effect-item__name">${e.name}</div>
                    <div class="effect-item__desc">${e.desc}</div>
                </div>
            </div>
        `).join('');
        $$('.effect-item').forEach((el, i) => {
            el.addEventListener('dragstart', (ev) => {
                ev.dataTransfer.setData('application/json', JSON.stringify({
                    kind: 'effect', name: EFFECTS[i].name,
                }));
            });
            el.addEventListener('dblclick', () => {
                if (state.selectedClipId) toast(`「${EFFECTS[i].name}」を適用しました`);
                else toast('クリップを選択してください');
            });
        });
    }

    function renderTextPresets() {
        els.textPresets.innerHTML = TEXT_PRESETS.map((t) => `
            <div class="text-preset" draggable="true">
                <span class="effect-item__icon">${t.icon}</span>
                <div class="effect-item__name">${t.name}</div>
            </div>
        `).join('');
        $$('.text-preset').forEach((el, i) => {
            el.addEventListener('dragstart', (ev) => {
                ev.dataTransfer.setData('application/json', JSON.stringify({
                    kind: 'media', type: 'text', name: TEXT_PRESETS[i].name,
                }));
            });
            el.addEventListener('dblclick', () => addClip('text', TEXT_PRESETS[i].name, DEFAULT_TRACK, state.playhead, 3));
        });
    }

    // ======================================================
    // 描画：トラックヘッダー
    // ======================================================
    function renderTrackHeaders() {
        // 先頭のスペーサーはルーラー(28px)と高さを合わせ、縦スクロール時に
        // レイヤー行が潜り込んでも隠すスティッキー要素にする
        els.trackHeaders.innerHTML = '<div class="track-headers__spacer"></div>' + TRACKS.map((t, i) => {
            // 連番レイヤー。種類アイコンの代わりにレイヤー番号を表示する
            // レイヤー色（YMM4 の LayerSettings.Color）があれば番号の背景に反映する
            const tint = t.color ? ` style="background:${rgbaStr(t.color)};color:#fff"` : '';
            return `
            <div class="track-header" data-track="${t.id}">
                <div class="track-header__icon"${tint}>${i + 1}</div>
                <div class="track-header__label">${t.label}</div>
                <div class="track-header__ctrl">
                    <button class="track-header__btn" data-act="mute" title="ミュート">M</button>
                    <button class="track-header__btn" data-act="hide" title="表示切替">👁</button>
                </div>
            </div>`;
        }).join('');

        els.trackHeaders.querySelectorAll('.track-header__btn').forEach((b) => {
            b.addEventListener('click', () => {
                b.classList.toggle('is-off');
                renderViewer();
            });
        });

        // ヘッダー行を作り直したので、拡張レーン（TRIBE v2）に並べ直してもらう
        emitTimelineLayout();
    }

    // ======================================================
    // 拡張レーン（tribev2.js など）への通知
    // ======================================================
    // タイムラインの寸法（ズーム・全体尺）やヘッダーの並びが変わったことを知らせる。
    // レーン側はこれを受けて自分の幅と描画をやり直す。
    function emitTimelineLayout() {
        document.dispatchEvent(new CustomEvent('auriga:layout', {
            detail: { zoom: state.zoom, seconds: TIMELINE_SECONDS, fps: FPS },
        }));
    }

    // ======================================================
    // 描画：トラック本体（ドロップ受付）
    // ======================================================
    function renderTracks() {
        els.tracks.innerHTML = TRACKS.map((t) =>
            `<div class="track" data-track="${t.id}"></div>`
        ).join('');

        const totalW = TIMELINE_SECONDS * state.zoom;
        els.tracks.style.width = totalW + 'px';

        // 素材のドロップを受けるのはレイヤー行だけ（TRIBE v2 レーンも .track を名乗るため、
        // 全体検索ではなく #tracks の中に限って束ねる）
        els.tracks.querySelectorAll('.track').forEach((trackEl) => {
            trackEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                trackEl.classList.add('track--drop');
            });
            trackEl.addEventListener('dragleave', () => trackEl.classList.remove('track--drop'));
            trackEl.addEventListener('drop', (e) => {
                e.preventDefault();
                trackEl.classList.remove('track--drop');

                const rect = trackEl.getBoundingClientRect();
                const x = e.clientX - rect.left + els.tracksArea.scrollLeft;
                const start = Math.max(0, x / state.zoom);

                // OSのファイルエクスプローラーからのドロップ
                if (e.dataTransfer.files && e.dataTransfer.files.length) {
                    dropFilesOnTrack(e.dataTransfer.files, trackEl.dataset.track, start);
                    return;
                }

                // アプリ内（メディア / エフェクト）からのドロップ
                let data;
                try { data = JSON.parse(e.dataTransfer.getData('application/json')); }
                catch { return; }
                if (data.kind === 'media') {
                    // 実尺が読み取り済みならそれを、無ければ既定尺を使う
                    const dur = data.dur || (data.type === 'image' || data.type === 'text' ? 3 : 5);
                    addClip(data.type, data.name, trackEl.dataset.track, start, dur, false, data.src);
                } else if (data.kind === 'effect') {
                    toast(`「${data.name}」エフェクト — クリップにドロップしてください`);
                }
            });
        });
    }

    function renderRuler() {
        let html = '';
        for (let s = 0; s <= TIMELINE_SECONDS; s++) {
            const label = s % 5 === 0 ? formatRulerTime(s) : '';
            html += `<div class="ruler__tick" style="width:${state.zoom}px">${label}</div>`;
        }
        els.ruler.innerHTML = html;
        els.ruler.style.width = (TIMELINE_SECONDS * state.zoom) + 'px';

        // ズーム・全体尺が変わった直後なので、拡張レーンにも寸法を伝える
        emitTimelineLayout();
    }

    // ======================================================
    // クリップ管理
    // ======================================================
    function addClip(type, name, track, start, dur, silent, src) {
        const clip = {
            id: 'c' + (state.nextId++),
            type, name, track,
            start: Math.round(start * 10) / 10,
            dur,
            offset: 0,                // 素材内の再生開始位置(秒)。分割・左トリムで進む
            src: src || null,
            props: { ...DEFAULT_PROPS },
        };
        state.clips.push(clip);
        renderClips();
        recomputeDuration();
        if (!silent) {
            selectClip(clip.id);
            toast(`「${name}」を追加しました`);
        }
        return clip;
    }

    // ---- OSからドロップされた実ファイルをトラックに追加 ----
    function dropFilesOnTrack(fileList, track, start) {
        // .auriproj / .auripack が含まれていれば Auriga プロジェクトとして開く
        const auriga = Array.from(fileList).find((f) => /\.(auriproj|auripack)$/i.test(f.name));
        if (auriga) { importAurigaFile(auriga); return; }

        // .ymmp が含まれていればメディアではなく YMM4 プロジェクトとして開く
        const ymmp = Array.from(fileList).find((f) => /\.ymmp$/i.test(f.name));
        if (ymmp) { openYmmpFile(ymmp); return; }

        const files = Array.from(fileList).filter((f) =>
            /^(video|audio|image)\//.test(f.type) || /\.(mp4|mov|webm|mkv|mp3|wav|m4a|png|jpe?g|gif|webp)$/i.test(f.name));

        if (!files.length) {
            toast('対応していないファイル形式です');
            return;
        }

        let offset = start;
        let lastClip = null;
        let pending = files.length;

        files.forEach((file) => {
            const m = registerMedia(file);   // メディアプールに登録（サムネ生成）

            // 静止画はデフォルト3秒、動画/音声は実尺を読み取る
            if (m.type === 'image') {
                lastClip = placeClip(m.type, m.name, track, offset, 3, m.src);
                offset += 3;
                if (--pending === 0) finishDrop(lastClip);
            } else {
                // バッジは registerMedia 側が反映する。ここでは配置尺のためだけに読む
                probeDuration(m.src, m.type, (dur) => {
                    lastClip = placeClip(m.type, m.name, track, offset, dur, m.src);
                    offset += dur;
                    if (--pending === 0) finishDrop(lastClip);
                });
            }
        });

        function finishDrop(clip) {
            renderMedia();
            if (clip) selectClip(clip.id);
            toast(`${files.length}件のファイルをタイムラインに追加しました`);
        }
    }

    // ---- メディアプールへの登録（サムネ生成・実尺の読み取りつき） ----
    function registerMedia(file) {
        const type = fileType(file);
        const src = URL.createObjectURL(file);
        const m = {
            id: 'm' + (state.nextId++),
            type, name: file.name, src,
            thumb: null,
            dur: null,   // 動画/音声の実尺(秒)。読み取り後に入る
            badge: type === 'image' ? 'IMG' : type.toUpperCase(),
        };
        MEDIA.push(m);
        generateThumbnail(src, type, (thumb) => {
            if (thumb) { m.thumb = thumb; renderMedia(); }
        });
        // 動画/音声は実尺を読み取り、バッジとクリップの既定尺に使う
        if (type !== 'image') {
            probeDuration(src, type, (dur) => {
                m.dur = dur;
                m.badge = formatRulerTime(Math.round(dur));
                renderMedia();
            });
        }
        return m;
    }

    // ---- サムネイル生成（動画は1フレーム描画、画像はそのまま） ----
    function generateThumbnail(src, type, cb) {
        if (type === 'image') { cb(src); return; }
        if (type !== 'video') { cb(null); return; }
        const v = document.createElement('video');
        v.muted = true; v.preload = 'metadata'; v.crossOrigin = 'anonymous';
        let done = false;
        const fail = () => { if (!done) { done = true; cb(null); } };
        v.onloadedmetadata = () => {
            try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch { fail(); }
        };
        v.onseeked = () => {
            if (done) return;
            try {
                const c = document.createElement('canvas');
                c.width = 160; c.height = 90;
                c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
                done = true;
                cb(c.toDataURL('image/jpeg', 0.7));
            } catch { fail(); }
        };
        v.onerror = fail;
        setTimeout(fail, 5000);
        v.src = src;
    }

    // ---- メディアを（ソース）モニターに表示 ----
    function showInMonitor(m) {
        if (!m) return;
        state.monitorMode = 'source';
        state.selectedMediaId = m.id;
        state.monitorSource = { type: m.type, name: m.name, src: m.src };
        // クリップ選択を解除してソース表示に切り替え
        state.selectedClipId = null;
        $$('.clip').forEach((c) => c.classList.remove('is-selected'));
        $$('.media-item').forEach((el) => el.classList.toggle('is-active', el.dataset.media === m.id));
        updateProps();
        renderViewer();
        if (m.type === 'video' || m.type === 'audio') {
            els.previewVideo.play?.().catch(() => {});
        }
    }

    // レイヤーは種類を問わないので、落としたレイヤーにそのまま配置する
    function placeClip(type, name, track, start, dur, src) {
        if (!TRACKS.some((t) => t.id === track)) track = DEFAULT_TRACK;
        return addClip(type, name, track, start, dur, true, src);
    }

    function fileType(file) {
        if (/^video\//.test(file.type) || /\.(mp4|mov|webm|mkv)$/i.test(file.name)) return 'video';
        if (/^audio\//.test(file.type) || /\.(mp3|wav|m4a)$/i.test(file.name)) return 'audio';
        return 'image';
    }

    // 動画/音声の長さを読み取る（失敗時は5秒）
    function probeDuration(src, type, cb) {
        const el = document.createElement(type === 'audio' ? 'audio' : 'video');
        let done = false;
        const finish = (d) => { if (done) return; done = true; cb(Math.max(0.5, Math.round(d * 10) / 10)); };
        el.preload = 'metadata';
        el.onloadedmetadata = () => finish(isFinite(el.duration) ? el.duration : 5);
        el.onerror = () => finish(5);
        setTimeout(() => finish(5), 4000); // タイムアウト保険
        el.src = src;
    }

    // メディアプールの項目を既定レイヤーの再生ヘッド位置へ追加する（実尺があれば使う）
    function addClipToBestTrack(m) {
        const dur = m.dur || (m.type === 'image' || m.type === 'text' ? 3 : 5);
        addClip(m.type, m.name, DEFAULT_TRACK, state.playhead, dur, false, m.src);
    }

    function renderClips() {
        // 既存クリップ要素を消す
        $$('.clip').forEach((c) => c.remove());
        state.clips.forEach((clip) => {
            const trackEl = els.tracks.querySelector(`.track[data-track="${clip.track}"]`);
            if (!trackEl) return;
            const el = document.createElement('div');
            el.className = `clip clip--${clip.type}` + (clip.id === state.selectedClipId ? ' is-selected' : '');
            el.style.left = (clip.start * state.zoom) + 'px';
            el.style.width = (clip.dur * state.zoom) + 'px';
            el.dataset.clip = clip.id;
            // 素材が未解決のクリップは縞模様で区別し、参照元パスをツールチップで示す
            if (!clip.src && clip.filePath) {
                el.classList.add('clip--missing');
                el.title = '素材ファイルが見つかりません：' + clip.filePath;
            }

            const inner = clip.type === 'audio' || clip.type === 'video'
                ? `<div class="clip__wave">${waveBars(clip.dur)}</div>` : '';
            el.innerHTML = `
                <div class="clip__handle clip__handle--l"></div>
                <div class="clip__label">${escapeHtml(clip.name)}</div>
                ${inner}
                <div class="clip__handle clip__handle--r"></div>`;

            trackEl.appendChild(el);
            attachClipEvents(el, clip);
        });
    }

    function waveBars(dur) {
        const n = Math.max(6, Math.floor(dur * 4));
        let s = '';
        for (let i = 0; i < n; i++) {
            const h = 20 + Math.abs(Math.sin(i * 0.9) * 70);
            s += `<span style="height:${h}%"></span>`;
        }
        return s;
    }

    // ---- クリップのドラッグ / リサイズ / 選択 ----
    function attachClipEvents(el, clip) {
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;   // 右クリックはコンテキストメニューに任せる
            if (e.target.classList.contains('clip__handle')) return;
            if (state.tool === 'cut') { splitClipAt(clip, state.playhead); return; }
            selectClip(clip.id);
            startDrag(e, el, clip);
        });

        el.querySelector('.clip__handle--l').addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation(); selectClip(clip.id); startResize(e, el, clip, 'l');
        });
        el.querySelector('.clip__handle--r').addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation(); selectClip(clip.id); startResize(e, el, clip, 'r');
        });
    }

    function startDrag(e, el, clip) {
        const startX = e.clientX;
        const origStart = clip.start;
        el.style.cursor = 'grabbing';
        const move = (ev) => {
            const dx = (ev.clientX - startX) / state.zoom;
            clip.start = Math.max(0, Math.round((origStart + dx) * 10) / 10);
            el.style.left = (clip.start * state.zoom) + 'px';
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            el.style.cursor = '';
            recomputeDuration();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }

    function startResize(e, el, clip, side) {
        const startX = e.clientX;
        const origStart = clip.start, origDur = clip.dur;
        const origOffset = clip.offset || 0;
        const move = (ev) => {
            const dx = (ev.clientX - startX) / state.zoom;
            if (side === 'r') {
                clip.dur = Math.max(0.5, Math.round((origDur + dx) * 10) / 10);
            } else {
                const newStart = Math.max(0, Math.min(origStart + dx, origStart + origDur - 0.5));
                clip.dur = Math.round((origDur - (newStart - origStart)) * 10) / 10;
                clip.start = Math.round(newStart * 10) / 10;
                // 左トリムしたぶんだけ素材内の再生開始位置も進める
                const rate = (clip.props.speed || 100) / 100;
                clip.offset = Math.max(0, origOffset + (clip.start - origStart) * rate);
            }
            el.style.left = (clip.start * state.zoom) + 'px';
            el.style.width = (clip.dur * state.zoom) + 'px';
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            recomputeDuration();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }

    // クリップの付加情報（YMM4 由来の描画情報など）を複製先へ引き継ぐ
    function copyClipExtras(src, dest) {
        dest.text = src.text || null;
        dest.shape = src.shape || null;
        dest.effects = src.effects || null;
        dest.anim = src.anim || null;
        dest.blend = src.blend || null;
        dest.flipH = !!src.flipH;
        dest.flipV = !!src.flipV;
        dest.looped = !!src.looped;
        dest.fadeIn = src.fadeIn || 0;
        dest.fadeOut = src.fadeOut || 0;
        dest.hidden = !!src.hidden;
        dest.filePath = src.filePath || null;
        dest.ymm = !!src.ymm;
    }

    function splitClipAt(clip, t) {
        if (t <= clip.start + 0.1 || t >= clip.start + clip.dur - 0.1) {
            toast('再生ヘッドをクリップ内に置いてください'); return;
        }
        const leftDur = Math.round((t - clip.start) * 10) / 10;
        const rightDur = Math.round((clip.dur - leftDur) * 10) / 10;
        clip.dur = leftDur;
        // 右半分はソース・プロパティ・付加情報を引き継ぎ、素材の再生位置を分割点から始める
        const right = addClip(clip.type, clip.name, clip.track, t, rightDur, true, clip.src);
        right.props = { ...clip.props };
        right.offset = (clip.offset || 0) + leftDur * ((clip.props.speed || 100) / 100);
        copyClipExtras(clip, right);
        renderClips();
        toast('クリップを分割しました ✂');
    }

    function selectClip(id) {
        state.selectedClipId = id;
        if (id) {
            // クリップ選択時はプログラム（合成）モニターに切り替え
            enterProgram();
            state.selectedMediaId = null;
            $$('.media-item').forEach((el) => el.classList.remove('is-active'));
        }
        $$('.clip').forEach((c) => c.classList.toggle('is-selected', c.dataset.clip === id));
        updateProps();
        renderViewer();
    }

    function deleteSelected() {
        if (!state.selectedClipId) { toast('削除するクリップを選択してください'); return; }
        const del = getSelectedClip();
        if (del && del._el) { try { del._el.pause(); } catch (e) {} }
        state.clips = state.clips.filter((c) => c.id !== state.selectedClipId);
        state.selectedClipId = null;
        renderClips();
        updateProps();
        recomputeDuration();
        renderViewer();
        toast('クリップを削除しました');
    }

    function recomputeDuration() {
        const end = state.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
        state.duration = Math.max(1, Math.round(end));
        // クリップが右端に近づいたらタイムラインを自動延長する
        // （renderTracks はクリップ要素ごと作り直すため、幅とルーラーだけ更新する）
        if (end > TIMELINE_SECONDS - 5) {
            ensureTimelineCapacity(end + 30);
            renderRuler();
            els.tracks.style.width = (TIMELINE_SECONDS * state.zoom) + 'px';
        }
        updateRelinkModal();   // クリップ削除などで未解決数が変わったら追従させる
        updateTimeDisplay();
        // 編集後、停止中ならプログラムモニターを更新
        if (!state.playing && state.monitorMode === 'program') {
            composite(state.playhead, false);
        }
    }

    // ======================================================
    // YMM4 (.ymmp) プロジェクトの読み込み
    // ======================================================
    // .ymmp は YMM4 が書き出す単一の JSON ファイル（UTF-8、BOM 付きの場合あり）。
    // Timelines[n].Items にアイテムが並び、時間は「フレーム数」で持つ。
    // 素材のパスは作者マシンの絶対パスなので、ここでは配置情報のみ取り込み、
    // 実ファイルの解決（再リンク）は行わない。

    // YMM4 のアイテム型（$type の短い名前）→ Auriga のクリップ種別
    const YMMP_TYPE_MAP = {
        VideoItem: 'video',
        AudioItem: 'audio',
        VoiceItem: 'audio',       // ボイス（合成音声）は音声として扱う
        ImageItem: 'image',
        TachieItem: 'image',      // 立ち絵は画像として扱う
        TachieFaceItem: 'image',
        TextItem: 'text',
        ShapeItem: 'shape',
        EffectItem: 'effect',
    };

    // クリップ種別ごとの表示名（名前が決められない場合のフォールバック）
    const YMMP_TYPE_LABELS = {
        video: '動画', audio: '音声', image: '画像',
        text: 'テキスト', shape: '図形', effect: 'エフェクト', other: 'アイテム',
    };

    // 値を範囲内に収める
    function clampNum(v, lo, hi) {
        return Math.min(hi, Math.max(lo, v));
    }

    // ファイルパスからファイル名部分を取り出す（Windows / POSIX 両対応）
    function pathBaseName(p) {
        return String(p).split(/[\\/]/).pop() || '';
    }

    // "hh:mm:ss(.fffffff)"（日数付きは "d.hh:mm:ss…"）形式の TimeSpan 文字列を秒へ変換する
    function parseTimeSpan(str) {
        const m = String(str || '').match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+(?:\.\d+)?)$/);
        if (!m) return 0;
        return (Number(m[1]) || 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + parseFloat(m[4]);
    }

    // YMM4 の "#AARRGGBB" / "#RRGGBB" 形式の色を {r,g,b,a} へ変換する（不正時は fallback）
    function ymmpColor(str, fallback) {
        const m = String(str || '').match(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i);
        if (!m) return fallback || null;
        const hex = m[1];
        const n = parseInt(hex, 16);
        return hex.length === 8
            ? { a: ((n >>> 24) & 255) / 255, r: (n >>> 16) & 255, g: (n >>> 8) & 255, b: n & 255 }
            : { a: 1, r: (n >>> 16) & 255, g: (n >>> 8) & 255, b: n & 255 };
    }

    // {r,g,b,a} を rgba() 文字列へ整形する（mul で不透明度を乗算）
    function rgbaStr(c, mul) {
        if (!c) return 'rgba(0,0,0,0)';
        const a = clampNum(c.a * (mul == null ? 1 : mul), 0, 1);
        return `rgba(${c.r},${c.g},${c.b},${a})`;
    }

    // YMM4 のアニメ可能パラメータから値を取り出す。
    // 形式は {"Values":[{"Value":n}], "AnimationType":…} または素の数値。
    // アニメーション付きでも先頭キーフレームの値のみ採用する。
    function ymmpAnimValue(v, fallback) {
        if (typeof v === 'number' && isFinite(v)) return v;
        if (v && Array.isArray(v.Values) && v.Values.length) {
            const n = v.Values[0] && v.Values[0].Value;
            if (typeof n === 'number' && isFinite(n)) return n;
        }
        return fallback;
    }

    // $type のフルネーム（例: "YukkuriMovieMaker.Project.Items.TextItem, YukkuriMovieMaker"）
    // から短い型名（例: "TextItem"）を取り出す
    function ymmpShortType(t) {
        return String(t || '').split(',')[0].split('.').pop().trim();
    }

    // アニメ可能値が複数キーフレームを持つか
    function ymmpIsAnimated(v) {
        return !!(v && Array.isArray(v.Values) && v.Values.length > 1);
    }

    // アニメ可能値を {values, type} へ正規化する（静的値・単一キーフレームは null）。
    // convert で各キーフレーム値の座標変換（px→スライダー値など）を挟める。
    function ymmpAnimSpec(v, convert) {
        if (!ymmpIsAnimated(v)) return null;
        const f = convert || ((x) => x);
        return {
            values: v.Values.map((x) => f(Number(x.Value) || 0)),
            type: v.AnimationType || '直線移動',
        };
    }

    // キーフレーム列を進行度 p (0〜1) で評価する
    function evalAnimValues(values, type, p) {
        if (!values || !values.length) return 0;
        if (values.length === 1) return values[0];
        p = clampNum(p, 0, 1);
        // 瞬間移動：等分した区間の境界で次の値へ切り替わる
        if (type === '瞬間移動') {
            return values[Math.min(values.length - 1, Math.floor(p * values.length))];
        }
        const segCount = values.length - 1;
        const seg = Math.min(segCount - 1, Math.floor(p * segCount));
        let sp = p * segCount - seg;
        if (type === '加減速移動') sp = sp * sp * (3 - 2 * sp);   // 滑らかに加減速
        return values[seg] + (values[seg + 1] - values[seg]) * sp;
    }

    // クリップのアニメ付きプロパティを進行度で評価する（アニメが無ければ fallback）
    function animProp(clip, key, p, fallback) {
        const a = clip.anim && clip.anim[key];
        if (!a) return fallback;
        return evalAnimValues(a.values, a.type, p);
    }

    // エフェクトパラメータ（数値 または {values,type}）を進行度で評価する
    function fxVal(v, p, fallback) {
        if (typeof v === 'number' && isFinite(v)) return v;
        if (v && Array.isArray(v.values)) return evalAnimValues(v.values, v.type, p);
        return fallback;
    }

    // タイムラインに表示するアイテム名を決める
    function ymmpItemName(raw, type) {
        // テキストは本文の1行目をそのまま名前にする
        if (type === 'text') {
            const line = String(raw.Text || '').split(/\r?\n/)[0].trim();
            if (line) return line;
        }
        // ボイスアイテムはセリフを表示する
        if (typeof raw.Serif === 'string' && raw.Serif.trim()) {
            return raw.Serif.split(/\r?\n/)[0].trim();
        }
        // ユーザーが備考を付けていればそれを優先する
        if (typeof raw.Remark === 'string' && raw.Remark.trim()) {
            return raw.Remark.trim();
        }
        if (typeof raw.FilePath === 'string' && raw.FilePath) {
            return pathBaseName(raw.FilePath);
        }
        return YMMP_TYPE_LABELS[type] || 'アイテム';
    }

    // アイテム内エフェクト（VideoEffects）1件を描画用に正規化する（無効・未対応は null）
    function ymmpNormalizeEffect(fx) {
        if (!fx || fx.IsEnabled === false) return null;
        const t = ymmpShortType(fx['$type']);
        switch (t) {
            // 画面外から登場 / 退場（方向・時間・イージング付き）
            case 'InOutMoveFromOutsideFrameEffect':
                return {
                    kind: 'move-outside', dir: String(fx.Value || 'Bottom'),
                    isIn: fx.IsInEffect === true, isOut: fx.IsOutEffect === true,
                    time: Number(fx.EffectTimeSeconds) || 0.5,
                    easeT: fx.EasingType || 'Quad', easeM: fx.EasingMode || 'Out',
                };
            // 登場退場ぼかし
            case 'InOutGaussianBlurEffect':
                return {
                    kind: 'inout-blur', value: ymmpAnimValue(fx.Value, 10),
                    isIn: fx.IsInEffect === true, isOut: fx.IsOutEffect === true,
                    time: Number(fx.EffectTimeSeconds) || 0.5,
                    easeT: fx.EasingType || 'Quad', easeM: fx.EasingMode || 'Out',
                };
            // クラッシュ登場 / 退場（近似）
            case 'InOutCrashEffect':
                return {
                    kind: 'crash',
                    isIn: fx.IsInEffect === true, isOut: fx.IsOutEffect === true,
                    time: Number(fx.EffectTimeSeconds) || 0.5,
                    easeT: 'Quad', easeM: 'Out',
                };
            // 影
            case 'ShadowEffect':
                return {
                    kind: 'shadow',
                    x: ymmpAnimValue(fx.X, 6), y: ymmpAnimValue(fx.Y, 6),
                    blur: ymmpAnimValue(fx.Blur, 3),
                    opacity: ymmpAnimValue(fx.Opacity, 50),
                    color: ymmpColor(fx.Brush && fx.Brush.Parameter && fx.Brush.Parameter.Color,
                        { r: 0, g: 0, b: 0, a: 1 }),
                };
            // ランダム移動（振動）
            case 'RandomMoveEffect':
                return {
                    kind: 'random-move',
                    x: ymmpAnimValue(fx.X, 0), y: ymmpAnimValue(fx.Y, 0),
                    span: Math.max(0.02, ymmpAnimValue(fx.Span, 0.1)),
                };
            // クロマキー（近似・縮小バッファで処理）
            case 'ChromaKeyEffect':
                return {
                    kind: 'chroma-key', color: ymmpColor(fx.Color, null),
                    tolerance: ymmpAnimValue(fx.Tolerance, 10),
                    invert: fx.IsInvert === true,
                };
            // 放射光（EffectItem 経由で下位レイヤーに適用）
            case 'RadialLightEffect':
                return {
                    kind: 'radial-light',
                    value: ymmpAnimSpec(fx.Value) || ymmpAnimValue(fx.Value, 100),
                    x: ymmpAnimValue(fx.X, 0), y: ymmpAnimValue(fx.Y, 0),
                };
            default:
                return null;   // 未対応エフェクトは読み飛ばす
        }
    }

    // YMM4 アイテム1件を Auriga のクリップ相当の形に正規化する。
    // 対象外・不正なアイテムは null を返して読み飛ばす。
    function ymmpNormalizeItem(raw, fps, width, height) {
        if (!raw || typeof raw !== 'object') return null;
        const type = YMMP_TYPE_MAP[ymmpShortType(raw['$type'])] || 'other';
        const lengthFrames = Number(raw.Length) || 0;
        if (lengthFrames <= 0) return null;

        // 変形プロパティ。座標は YMM4 の中心原点 px を、スライダーの -500〜500 に射影する
        const props = { ...DEFAULT_PROPS };
        props.x = clampNum(Math.round(ymmpAnimValue(raw.X, 0) / (width / 2) * 500), -500, 500);
        props.y = clampNum(Math.round(ymmpAnimValue(raw.Y, 0) / (height / 2) * 500), -500, 500);
        props.scale = clampNum(Math.round(ymmpAnimValue(raw.Zoom, 100)), 10, 300);
        props.rotate = clampNum(Math.round(ymmpAnimValue(raw.Rotation, 0)), -180, 180);
        props.opacity = clampNum(Math.round(ymmpAnimValue(raw.Opacity, 100)), 0, 100);
        props.speed = clampNum(Math.round(Number(raw.PlaybackRate) || 100), 25, 200);
        props.volume = clampNum(Math.round(ymmpAnimValue(raw.Volume, 100)), 0, 200);

        // キーフレームアニメーション（複数キーフレームを持つプロパティのみ保持）
        const toX = (v) => clampNum(v / (width / 2) * 500, -500, 500);
        const toY = (v) => clampNum(v / (height / 2) * 500, -500, 500);
        const anim = {};
        const ax = ymmpAnimSpec(raw.X, toX); if (ax) anim.x = ax;
        const ay = ymmpAnimSpec(raw.Y, toY); if (ay) anim.y = ay;
        const az = ymmpAnimSpec(raw.Zoom); if (az) anim.scale = az;
        const ar = ymmpAnimSpec(raw.Rotation); if (ar) anim.rotate = ar;
        const ao = ymmpAnimSpec(raw.Opacity); if (ao) anim.opacity = ao;

        // テキスト書式（TextItem のみ）
        const text = type === 'text' ? {
            value: String(raw.Text || ''),
            font: typeof raw.Font === 'string' ? raw.Font : null,
            size: Math.max(1, ymmpAnimValue(raw.FontSize, 34)),
            color: ymmpColor(raw.FontColor, { r: 255, g: 255, b: 255, a: 1 }),
            style: typeof raw.Style === 'string' ? raw.Style : 'Normal',
            styleColor: ymmpColor(raw.StyleColor, { r: 0, g: 0, b: 0, a: 1 }),
            bold: raw.Bold === true,
            italic: raw.Italic === true,
            basePoint: typeof raw.BasePoint === 'string' ? raw.BasePoint : 'CenterCenter',
            lineHeight: ymmpAnimValue(raw.LineHeight2, 100),
        } : null;

        // 図形（ShapeItem のみ。単色ブラシの色を取り込む）
        const shapeParam = raw.ShapeParameter || {};
        const shape = type === 'shape' ? {
            kind: ymmpShortType(raw.ShapeType2),
            color: ymmpColor(shapeParam.Brush && shapeParam.Brush.Parameter
                && shapeParam.Brush.Parameter.Color, null),
        } : null;

        return {
            type,
            name: ymmpItemName(raw, type),
            layer: Math.max(0, Math.floor(Number(raw.Layer) || 0)),
            start: (Number(raw.Frame) || 0) / fps,
            dur: lengthFrames / fps,
            offset: parseTimeSpan(raw.ContentOffset),   // 素材内の再生開始位置(秒)
            filePath: typeof raw.FilePath === 'string' ? raw.FilePath : null,
            hidden: raw.IsHidden === true,
            fadeIn: Math.max(0, Number(raw.FadeIn) || 0),    // フェードイン(秒)
            fadeOut: Math.max(0, Number(raw.FadeOut) || 0),  // フェードアウト(秒)
            looped: raw.IsLooped === true,
            blend: typeof raw.Blend === 'string' ? raw.Blend : null,
            flipH: raw.IsFlippedHorizontally === true,
            flipV: raw.IsFlippedVertically === true,
            anim: Object.keys(anim).length ? anim : null,
            effects: (Array.isArray(raw.VideoEffects) ? raw.VideoEffects : [])
                .map(ymmpNormalizeEffect).filter(Boolean),
            text,
            shape,
            props,
        };
    }

    // .ymmp のテキストをパースし、正規化したプロジェクトを返す。
    // 構造が想定外の場合は Error を投げる（呼び出し側でトースト表示する）。
    function parseYmmp(text) {
        let t = String(text);
        if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);   // BOM 除去
        let data;
        try {
            data = JSON.parse(t);
        } catch (e) {
            throw new Error('JSON として解釈できません');
        }
        const timelines = Array.isArray(data.Timelines) ? data.Timelines : null;
        if (!timelines || !timelines.length) throw new Error('タイムラインが見つかりません');

        // 選択中のタイムラインを対象にする（範囲外なら先頭）
        let idx = Math.floor(Number(data.SelectedTimelineIndex) || 0);
        if (idx < 0 || idx >= timelines.length) idx = 0;
        const tl = timelines[idx] || {};

        const info = tl.VideoInfo || {};
        const fps = Number(info.FPS) > 0 ? Number(info.FPS) : 60;
        const width = Number(info.Width) > 0 ? Number(info.Width) : 1920;
        const height = Number(info.Height) > 0 ? Number(info.Height) : 1080;

        const items = (Array.isArray(tl.Items) ? tl.Items : [])
            .map((raw) => ymmpNormalizeItem(raw, fps, width, height))
            .filter(Boolean);

        return {
            name: pathBaseName(data.FilePath || '').replace(/\.ymmp$/i, '')
                || String(tl.Name || '').trim()
                || 'YMM4 プロジェクト',
            fps, width, height,
            layerSettings: (tl.LayerSettings && Array.isArray(tl.LayerSettings.Items))
                ? tl.LayerSettings.Items : [],
            items,
        };
    }

    // レイヤー数を count 以上に拡張する（既存の5本より多いプロジェクト用）
    function ensureLayerCount(count) {
        while (TRACKS.length < count) {
            const n = TRACKS.length + 1;
            TRACKS.push({ id: 'L' + n, label: 'レイヤー ' + n, volume: 100, color: null });
        }
    }

    // タイムラインの全長（秒）を seconds 以上に拡張する
    function ensureTimelineCapacity(seconds) {
        TIMELINE_SECONDS = Math.max(TIMELINE_SECONDS, Math.ceil(seconds));
    }

    // パース済みプロジェクトをタイムラインへ展開する（既存クリップは破棄）
    function loadYmmpProject(project, fileName) {
        pauseAllMedia();
        state.clips = [];
        state.selectedClipId = null;

        // 必要なレイヤー数とタイムライン長を確保する
        const maxLayer = project.items.reduce((m, it) => Math.max(m, it.layer), 0);
        ensureLayerCount(maxLayer + 1);
        const endSec = project.items.reduce((m, it) => Math.max(m, it.start + it.dur), 0);
        ensureTimelineCapacity(endSec + 5);   // 末尾に少し余白を持たせる

        // プロジェクトの FPS・解像度へ表示を追従させる
        FPS = project.fps;
        state.projectWidth = project.width;
        state.projectHeight = project.height;
        applyProjectResolution(project.width, project.height);

        // レイヤー設定を既定に戻してから、YMM4 の LayerSettings を反映する
        TRACKS.forEach((t, i) => { t.label = 'レイヤー ' + (i + 1); t.volume = 100; t.color = null; });
        project.layerSettings.forEach((ls) => {
            const t = TRACKS[Number(ls.Layer)];
            if (!t) return;
            if (typeof ls.Label === 'string' && ls.Label.trim()) t.label = ls.Label.trim();
            const vol = Number(ls.Volume);
            if (isFinite(vol)) t.volume = clampNum(vol, 0, 200);
            const col = ymmpColor(ls.Color, null);
            t.color = col && col.a > 0 ? col : null;   // 透明（未設定）は無視する
        });

        // アイテムをクリップとして展開する
        project.items.forEach((it) => {
            state.clips.push({
                id: 'c' + (state.nextId++),
                type: it.type,
                name: it.name,
                track: 'L' + (it.layer + 1),
                start: Math.round(it.start * 10) / 10,
                dur: Math.max(0.1, Math.round(it.dur * 10) / 10),
                offset: it.offset || 0,  // 素材内の再生開始位置（ContentOffset）
                src: null,               // 素材は作者マシンのパスのため未解決
                filePath: it.filePath,   // 参照元パス（再リンクで解決する）
                hidden: it.hidden,
                fadeIn: it.fadeIn,
                fadeOut: it.fadeOut,
                looped: it.looped,
                blend: it.blend,
                flipH: it.flipH,
                flipV: it.flipV,
                anim: it.anim,
                effects: it.effects,
                text: it.text,
                shape: it.shape,
                ymm: true,               // YMM4 由来（px 等倍配置・書式描画の分岐に使う）
                props: it.props,
            });
        });

        // メディアプールに同名ファイルが読み込み済みなら自動で割り当てる
        resolveClipsFromPool();
        relinkDismissed = false;   // 新しい読み込みでは不足ファイルダイアログを出し直す

        // タイムライン全体を再構築する
        renderTrackHeaders();
        renderTracks();
        renderRuler();
        renderClips();

        // YMM4 側のレイヤー表示状態（IsHidden）をトラックに反映する
        project.layerSettings.forEach((ls) => {
            const t = TRACKS[Number(ls.Layer)];
            if (t) setTrackVisible(t.id, ls.IsHidden !== true);
        });

        updateProps();
        recomputeDuration();
        seek(0);

        const displayName = String(fileName || '').replace(/\.ymmp$/i, '') || project.name;
        state.projectName = displayName;   // 書き出しファイル名に使う
        toast(`YMM4 プロジェクト「${displayName}」を読み込みました（${project.items.length} アイテム）`);
    }

    // .ymmp の File オブジェクトを読み込んでタイムラインに展開する
    function openYmmpFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                loadYmmpProject(parseYmmp(reader.result), file.name);
            } catch (err) {
                console.error('YMMP 読み込みエラー:', err);
                toast(`YMM4 プロジェクトを読み込めませんでした（${err.message}）`);
            }
        };
        reader.onerror = () => toast('ファイルを読み込めませんでした');
        reader.readAsText(file);
    }

    // 「プロジェクトを開く」のファイル選択ダイアログ
    function openProjectDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ymmp,application/json';
        input.addEventListener('change', () => {
            const f = input.files && input.files[0];
            if (f) openYmmpFile(f);
        });
        input.click();
    }

    // ======================================================
    // YMM4 素材の再リンク（OBS の「不足しているファイル」ダイアログ相当）
    // ======================================================
    // .ymmp の素材パスは作者マシンの絶対パスなので、ブラウザからは直接読めない。
    // 行ごとの個別ファイル参照、またはフォルダ一括検索で候補を選んでおき、
    // 「適用」を押すまでは state.clips に反映しない（キャンセルで破棄できるようにする）。
    let relinkDismissed = false;              // 閉じたら次の読み込みまで出さない
    const pendingRelinkFiles = new Map();     // filePath → 選択済み File（適用待ち）

    // 未解決（src が無く参照パスだけ持つ）クリップの数
    function unresolvedClipCount() {
        return state.clips.filter((c) => !c.src && c.filePath).length;
    }

    // メディアプールの同名ファイルを未解決クリップへ割り当てる
    function resolveClipsFromPool() {
        const byName = new Map();
        MEDIA.forEach((m) => {
            const k = m.name.toLowerCase();
            if (!byName.has(k)) byName.set(k, m);
        });
        let n = 0;
        state.clips.forEach((c) => {
            if (c.src || !c.filePath) return;
            const m = byName.get(pathBaseName(c.filePath).toLowerCase());
            if (m && m.type === c.type) { c.src = m.src; n++; }
        });
        return n;
    }

    // 種別ごとの一覧アイコン（Tabler）
    function missingItemIcon(type) {
        if (type === 'video') return 'ti-movie';
        if (type === 'image') return 'ti-photo';
        if (type === 'audio') return 'ti-music';
        return 'ti-file';
    }

    // 未解決クリップを参照パスごとにグループ化する（同じ素材を複数クリップが参照する場合まとめる）
    function missingFileGroups() {
        const map = new Map();
        state.clips.forEach((c) => {
            if (c.src || !c.filePath) return;
            if (!map.has(c.filePath)) map.set(c.filePath, { filePath: c.filePath, type: c.type, name: c.name, clips: [] });
            map.get(c.filePath).clips.push(c);
        });
        return Array.from(map.values());
    }

    // ダイアログを閉じる（適用・キャンセル・✕ 共通）
    function closeRelinkModal() {
        const modal = $('#relinkModal');
        if (modal) modal.hidden = true;
        pendingRelinkFiles.clear();
    }

    // 行の一覧・件数表示を今の未解決状況にあわせて描き直す
    function renderRelinkTable() {
        const body = $('#relinkTableBody');
        const status = $('#relinkStatus');
        if (!body) return;
        const groups = missingFileGroups();
        const foundCount = groups.filter((g) => pendingRelinkFiles.has(g.filePath)).length;
        body.innerHTML = groups.map((g) => {
            const found = pendingRelinkFiles.has(g.filePath);
            const newName = found ? pendingRelinkFiles.get(g.filePath).name : '';
            return `
                <tr data-filepath="${escapeHtml(g.filePath)}">
                    <td class="relink-table__source" title="${escapeHtml(g.name)}">
                        <i class="ti ${missingItemIcon(g.type)}"></i><span class="relink-table__sourcename">${escapeHtml(g.name)}</span>
                    </td>
                    <td class="relink-table__missing" title="${escapeHtml(g.filePath)}">${escapeHtml(pathBaseName(g.filePath))}</td>
                    <td class="relink-table__new">
                        <span class="relink-table__newname">${escapeHtml(newName)}</span>
                        <button class="relink-table__browse" type="button" data-browse title="ファイルを参照..."><i class="ti ti-dots"></i></button>
                    </td>
                    <td class="relink-table__status ${found ? 'is-found' : 'is-missing'}">${found ? '見つかりました' : '行方不明'}</td>
                </tr>`;
        }).join('');
        if (status) status.textContent = `${groups.length}個中${foundCount}個見つかりました`;
        body.querySelectorAll('[data-browse]').forEach((btn) => {
            btn.addEventListener('click', () => {
                browseRelinkFile(btn.closest('tr').dataset.filepath);
            });
        });
    }

    // 行の「…」ボタン：その1件だけファイルを選び直す
    function browseRelinkFile(filePath) {
        const group = missingFileGroups().find((g) => g.filePath === filePath);
        const input = document.createElement('input');
        input.type = 'file';
        input.addEventListener('change', () => {
            const f = input.files && input.files[0];
            if (!f) return;
            if (group && fileType(f) !== group.type) {
                toast(`種別が一致しません（${group.type} のクリップに ${fileType(f)} は選べません）`);
                return;
            }
            pendingRelinkFiles.set(filePath, f);
            renderRelinkTable();
        });
        input.click();
    }

    // 「ディレクトリを検索…」：フォルダ内をファイル名一致で一括候補付けする
    function startRelinkDirectorySearch() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.webkitdirectory = true;   // フォルダごと選択する（Chromium / Electron）
        input.addEventListener('change', () => {
            const files = Array.from(input.files || []);
            if (files.length) stageRelinkFromFiles(files);
        });
        input.click();
    }

    // 選択されたファイル群から、未解決の行に名前と種別が一致するものだけ候補として仮登録する
    function stageRelinkFromFiles(files) {
        // 同名ファイルを別々のパスが参照している場合があるので、ファイル名→グループ配列でまとめる
        const wanted = new Map();
        missingFileGroups().forEach((g) => {
            const k = pathBaseName(g.filePath).toLowerCase();
            if (!wanted.has(k)) wanted.set(k, []);
            wanted.get(k).push(g);
        });
        let n = 0;
        files.forEach((f) => {
            const groups = wanted.get(f.name.toLowerCase());
            if (!groups) return;
            // 同名で参照している全グループに候補を付ける（片方だけ行方不明のまま残らないように）
            groups.forEach((g) => {
                if (fileType(f) === g.type && !pendingRelinkFiles.has(g.filePath)) {
                    pendingRelinkFiles.set(g.filePath, f); n++;
                }
            });
        });
        renderRelinkTable();
        toast(n ? `${n}件の候補が見つかりました（「適用」で反映されます）` : '一致する素材が見つかりませんでした');
    }

    // 「適用」：候補が付いている行だけ実際にクリップへ反映する
    function applyRelink() {
        const registered = new Map();   // File → media（同一 File を複数グループへ割り当てても重複登録しない）
        let n = 0;
        missingFileGroups().forEach((g) => {
            const file = pendingRelinkFiles.get(g.filePath);
            if (!file) return;
            let m = registered.get(file);
            if (!m) { m = registerMedia(file); registered.set(file, m); }
            g.clips.forEach((c) => { c.src = m.src; });
            n += g.clips.length;
        });
        pendingRelinkFiles.clear();
        renderMedia();
        renderClips();
        renderViewer();
        toast(n ? `${n}件のクリップへ素材を再リンクしました` : '再リンクする素材が選択されていません');
        relinkDismissed = true;   // 残りが未解決でも、次の読み込みまで自動再表示はしない
        closeRelinkModal();
    }

    // 未解決件数の変化にあわせてダイアログの自動表示・行内容を更新する
    function updateRelinkModal() {
        const modal = $('#relinkModal');
        if (!modal) return;
        const n = unresolvedClipCount();
        if (n === 0) { modal.hidden = true; return; }
        if (relinkDismissed) return;   // 閉じた後は次の読み込みまで再表示しない
        modal.hidden = false;
        renderRelinkTable();
    }

    // ======================================================
    // プロジェクトの書き出し・読み込み（.auriproj / .auripack）
    //   .auriproj : 素材のパス参照だけを含む JSON。軽量で、素材は再リンクで解決する
    //   .auripack : 素材バイナリを同梱したコンテナを gzip 圧縮した単一パッケージ
    // 圧縮は Chromium 内蔵の CompressionStream を使う（外部ライブラリ不要）。
    // .auripack の構造: "AURIPACK1"(9バイト) + gzip( [マニフェスト長 uint32 LE][マニフェスト JSON][素材バイト列…] )
    // ======================================================
    const AURIPACK_MAGIC = 'AURIPACK1';   // .auripack 先頭の識別子
    const AURIPROJ_VERSION = 1;           // 保存形式のバージョン（将来の互換判定に使う）

    // フルエクスポート中の多重実行を防ぐフラグ（素材収集・圧縮が非同期のため）
    let packExporting = false;

    // 素材ファイルを持つクリップ種別か（テキスト・図形は持たない）
    function isMediaClipType(type) {
        return type === 'video' || type === 'audio' || type === 'image';
    }

    // 現在のプロジェクト状態を保存用の素の構造へ変換する。
    // assetKeyBySrc（blob URL → アセットキー）を渡すと .auripack 用に素材参照を付与する。
    function serializeProject(assetKeyBySrc) {
        const assetOf = (src) => (assetKeyBySrc && src && assetKeyBySrc.has(src))
            ? assetKeyBySrc.get(src) : null;
        return {
            name: state.projectName || null,
            fps: FPS,
            width: state.projectWidth,
            height: state.projectHeight,
            timelineSeconds: TIMELINE_SECONDS,
            tracks: TRACKS.map((t) => ({
                label: t.label,
                volume: t.volume,
                color: t.color || null,
                hidden: !trackVisible(t.id),
                muted: trackMuted(t.id),
            })),
            media: MEDIA.map((m) => ({
                type: m.type,
                name: m.name,
                dur: m.dur,
                asset: assetOf(m.src),
            })),
            clips: state.clips.map((c) => ({
                type: c.type,
                name: c.name,
                track: c.track,
                start: c.start,
                dur: c.dur,
                offset: c.offset || 0,
                // パス参照：YMM4 由来のパスが無い素材クリップはファイル名を参照として残す
                // （読み込み側は resolveClipsFromPool / 再リンクダイアログで解決する）
                filePath: c.filePath || (isMediaClipType(c.type) && c.src ? c.name : null),
                hidden: !!c.hidden,
                fadeIn: c.fadeIn || 0,
                fadeOut: c.fadeOut || 0,
                looped: !!c.looped,
                blend: c.blend || null,
                flipH: !!c.flipH,
                flipV: !!c.flipV,
                anim: c.anim || null,
                effects: c.effects || null,
                text: c.text || null,
                shape: c.shape || null,
                ymm: !!c.ymm,
                props: { ...(c.props || DEFAULT_PROPS) },
                asset: assetOf(c.src),
            })),
        };
    }

    // Blob をファイルとしてダウンロード保存する
    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        // ダウンロード開始後に解放する（即時 revoke すると保存に失敗することがある）
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // 書き出しファイル名を作る（プロジェクト名＋日時。ファイル名に使えない文字は置換）
    function exportFileName(ext) {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
        const base = String(state.projectName || 'AurigaProject').replace(/[\\/:*?"<>|]/g, '_');
        return `${base}_${stamp}.${ext}`;
    }

    // バイト列を gzip 圧縮する
    async function gzipBytes(bytes) {
        if (typeof CompressionStream === 'undefined') throw new Error('この環境は圧縮に対応していません');
        const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    // gzip 圧縮されたバイト列を展開する
    async function gunzipBytes(bytes) {
        if (typeof DecompressionStream === 'undefined') throw new Error('この環境は展開に対応していません');
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    // プール・クリップが参照する素材（blob URL）を集めてバイト列化する。
    // 戻り値: { list: [{key,name,type,mime,bytes}], keyBySrc: Map(src → key) }
    async function collectPackAssets() {
        const keyBySrc = new Map();
        const list = [];
        const add = async (src, name, type) => {
            if (!src || keyBySrc.has(src)) return;
            try {
                const blob = await (await fetch(src)).blob();
                const key = 'a' + list.length;
                keyBySrc.set(src, key);
                list.push({ key, name, type, mime: blob.type || '', bytes: new Uint8Array(await blob.arrayBuffer()) });
            } catch (e) {
                // 読み取れない素材は同梱をあきらめてパス参照のまま残す
                console.warn('素材を読み取れないため同梱をスキップします:', name, e);
            }
        };
        for (const m of MEDIA) await add(m.src, m.name, m.type);
        for (const c of state.clips) {
            if (isMediaClipType(c.type)) await add(c.src, c.name, c.type);
        }
        return { list, keyBySrc };
    }

    // 「プロジェクトのみ」書き出し：パス参照だけの JSON を保存する
    function exportAuriproj() {
        const data = {
            format: 'auriproj',
            version: AURIPROJ_VERSION,
            app: 'Auriga Studio',
            savedAt: new Date().toISOString(),
            project: serializeProject(null),
        };
        downloadBlob(
            new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
            exportFileName('auriproj'));
        toast('プロジェクトを書き出しました（.auriproj）📄');
    }

    // 「フルエクスポート」：素材バイナリを同梱した gzip パッケージを保存する
    async function exportAuripack() {
        if (packExporting) { toast('書き出し処理が進行中です…'); return; }
        packExporting = true;
        toast('素材を集めて圧縮しています… 📦');
        try {
            const assets = await collectPackAssets();
            const manifest = {
                format: 'auripack',
                version: AURIPROJ_VERSION,
                app: 'Auriga Studio',
                savedAt: new Date().toISOString(),
                project: serializeProject(assets.keyBySrc),
                assets: assets.list.map((a) => ({
                    key: a.key, name: a.name, type: a.type, mime: a.mime, size: a.bytes.length,
                })),
            };
            // コンテナを組み立てる: [マニフェスト長(uint32 LE)][マニフェスト JSON][素材バイト列…]
            const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
            const total = 4 + manifestBytes.length + assets.list.reduce((s, a) => s + a.bytes.length, 0);
            const container = new Uint8Array(total);
            new DataView(container.buffer).setUint32(0, manifestBytes.length, true);
            container.set(manifestBytes, 4);
            let offset = 4 + manifestBytes.length;
            assets.list.forEach((a) => { container.set(a.bytes, offset); offset += a.bytes.length; });

            const compressed = await gzipBytes(container);
            const magic = new TextEncoder().encode(AURIPACK_MAGIC);
            downloadBlob(
                new Blob([magic, compressed], { type: 'application/octet-stream' }),
                exportFileName('auripack'));
            const mb = (compressed.length / 1024 / 1024).toFixed(1);
            toast(`フルエクスポートが完了しました（素材 ${assets.list.length} 件・約 ${mb} MB）📦`);
        } catch (err) {
            console.error('auripack 書き出しエラー:', err);
            toast(`フルエクスポートに失敗しました（${err.message}）`);
        } finally {
            packExporting = false;
        }
    }

    // インポートのファイル選択ダイアログ（.auriproj / .auripack 共通）
    function importAurigaDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.auriproj,.auripack';
        input.addEventListener('change', () => {
            const f = input.files && input.files[0];
            if (f) importAurigaFile(f);
        });
        input.click();
    }

    // 拡張子で .auriproj / .auripack を振り分けて読み込む
    function importAurigaFile(file) {
        const reader = new FileReader();
        reader.onerror = () => toast('ファイルを読み込めませんでした');
        if (/\.auripack$/i.test(file.name)) {
            reader.onload = () => importAuripack(reader.result, file.name);
            reader.readAsArrayBuffer(file);
        } else {
            reader.onload = () => importAuriproj(reader.result, file.name);
            reader.readAsText(file);
        }
    }

    // .auriproj（JSON）を読み込んで復元する。素材は再リンクで解決する
    function importAuriproj(text, fileName) {
        try {
            let t = String(text);
            if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);   // BOM 除去
            const data = JSON.parse(t);
            if (!data || data.format !== 'auriproj' || !data.project) throw new Error('auriproj 形式ではありません');
            restoreProject(data.project, null, fileName);
            const n = unresolvedClipCount();
            toast(n
                ? `プロジェクトを読み込みました（素材 ${n} 件は再リンクが必要です）📄`
                : 'プロジェクトを読み込みました 📄');
        } catch (err) {
            console.error('auriproj 読み込みエラー:', err);
            toast(`プロジェクトを読み込めませんでした（${err.message}）`);
        }
    }

    // .auripack（gzip パッケージ）を読み込んで素材ごと復元する
    async function importAuripack(buffer, fileName) {
        try {
            const bytes = new Uint8Array(buffer);
            const magic = new TextEncoder().encode(AURIPACK_MAGIC);
            if (bytes.length < magic.length || !magic.every((b, i) => bytes[i] === b)) {
                throw new Error('auripack 形式ではありません');
            }
            const container = await gunzipBytes(bytes.subarray(magic.length));
            if (container.length < 4) throw new Error('データが壊れています');
            const manifestLen = new DataView(container.buffer, container.byteOffset).getUint32(0, true);
            if (4 + manifestLen > container.length) throw new Error('データが壊れています');
            const manifest = JSON.parse(new TextDecoder().decode(container.subarray(4, 4 + manifestLen)));
            if (!manifest || manifest.format !== 'auripack' || !manifest.project) throw new Error('auripack 形式ではありません');

            // 素材バイト列を Blob 化して blob URL を割り当てる
            const assetUrls = new Map();
            let offset = 4 + manifestLen;
            (Array.isArray(manifest.assets) ? manifest.assets : []).forEach((a) => {
                const size = Math.max(0, Math.floor(Number(a.size) || 0));
                if (offset + size > container.length) throw new Error('素材データが壊れています');
                const blob = new Blob([container.subarray(offset, offset + size)], { type: a.mime || '' });
                assetUrls.set(a.key, URL.createObjectURL(blob));
                offset += size;
            });

            restoreProject(manifest.project, assetUrls, fileName);
            toast(`フルパッケージを読み込みました（素材 ${assetUrls.size} 件を展開）📦`);
        } catch (err) {
            console.error('auripack 読み込みエラー:', err);
            toast(`パッケージを読み込めませんでした（${err.message}）`);
        }
    }

    // シリアライズ済みプロジェクトを現在の状態へ展開する（既存の内容は破棄）。
    // assetUrls（アセットキー → blob URL）があれば素材も復元する。
    function restoreProject(proj, assetUrls, fileName) {
        pauseAllMedia();
        state.clips = [];
        state.selectedClipId = null;
        state.selectedMediaId = null;
        state.monitorSource = null;
        state.monitorMode = 'program';
        state.clipboard = null;

        // プロジェクト名（保存されている名前 → ファイル名の順で採用する）
        state.projectName = (typeof proj.name === 'string' && proj.name.trim())
            ? proj.name.trim()
            : String(fileName || '').replace(/\.(auriproj|auripack)$/i, '') || null;

        // FPS・解像度・タイムライン長を復元する
        if (Number(proj.fps) > 0) FPS = Number(proj.fps);
        if (Number(proj.width) > 0 && Number(proj.height) > 0) {
            state.projectWidth = Number(proj.width);
            state.projectHeight = Number(proj.height);
            applyProjectResolution(state.projectWidth, state.projectHeight);
        }
        ensureTimelineCapacity(Number(proj.timelineSeconds) || 60);

        // トラックを既定へ戻してから保存値を反映する
        const savedTracks = Array.isArray(proj.tracks) ? proj.tracks : [];
        ensureLayerCount(savedTracks.length);
        TRACKS.forEach((t, i) => { t.label = 'レイヤー ' + (i + 1); t.volume = 100; t.color = null; });
        savedTracks.forEach((st, i) => {
            const t = TRACKS[i];
            if (!t || !st) return;
            if (typeof st.label === 'string' && st.label.trim()) t.label = st.label.trim();
            const vol = Number(st.volume);
            if (isFinite(vol)) t.volume = clampNum(vol, 0, 200);
            t.color = st.color || null;
        });

        // メディアプールを作り直す（素材が同梱されている場合のみ復元できる）
        MEDIA.length = 0;
        (Array.isArray(proj.media) ? proj.media : []).forEach((sm) => {
            const url = assetUrls && sm && sm.asset != null ? assetUrls.get(sm.asset) : null;
            if (!url) return;   // パスのみ保存ではプールは復元しない（クリップの再リンクで補う）
            const dur = isFinite(Number(sm.dur)) && sm.dur !== null ? Number(sm.dur) : null;
            const m = {
                id: 'm' + (state.nextId++),
                type: sm.type,
                name: String(sm.name || '素材'),
                src: url,
                thumb: null,
                dur,
                badge: sm.type === 'image' ? 'IMG'
                    : (dur ? formatRulerTime(Math.round(dur)) : String(sm.type || '').toUpperCase()),
            };
            MEDIA.push(m);
            generateThumbnail(url, m.type, (thumb) => {
                if (thumb) { m.thumb = thumb; renderMedia(); }
            });
        });

        // クリップを復元する
        (Array.isArray(proj.clips) ? proj.clips : []).forEach((sc) => {
            if (!sc || !sc.type) return;
            const track = TRACKS.some((t) => t.id === sc.track) ? sc.track : DEFAULT_TRACK;
            const url = assetUrls && sc.asset != null ? assetUrls.get(sc.asset) : null;
            state.clips.push({
                id: 'c' + (state.nextId++),
                type: sc.type,
                name: String(sc.name || 'クリップ'),
                track,
                start: Math.max(0, Number(sc.start) || 0),
                dur: Math.max(0.1, Number(sc.dur) || 0.1),
                offset: Math.max(0, Number(sc.offset) || 0),
                src: url,
                filePath: sc.filePath || null,
                hidden: sc.hidden === true,
                fadeIn: Math.max(0, Number(sc.fadeIn) || 0),
                fadeOut: Math.max(0, Number(sc.fadeOut) || 0),
                looped: sc.looped === true,
                blend: typeof sc.blend === 'string' ? sc.blend : null,
                flipH: sc.flipH === true,
                flipV: sc.flipV === true,
                anim: sc.anim || null,
                effects: Array.isArray(sc.effects) ? sc.effects : null,
                text: sc.text || null,
                shape: sc.shape || null,
                ymm: sc.ymm === true,
                props: { ...DEFAULT_PROPS, ...(sc.props || {}) },
            });
        });

        // プールに同名素材があれば未解決クリップへ割り当てる（.auriproj 用）
        resolveClipsFromPool();
        relinkDismissed = false;   // 新しい読み込みでは不足ファイルダイアログを出し直す

        // 画面全体を再構築する
        renderTrackHeaders();
        renderTracks();
        renderRuler();
        renderClips();
        renderMedia();

        // トラックの表示・ミュート状態を反映する（ヘッダー再生成後に行う）
        savedTracks.forEach((st, i) => {
            const t = TRACKS[i];
            if (!t || !st) return;
            setTrackVisible(t.id, st.hidden !== true);
            const b = document.querySelector(`.track-header[data-track="${t.id}"] [data-act="mute"]`);
            if (b) b.classList.toggle('is-off', st.muted === true);
        });

        updateProps();
        recomputeDuration();   // 未解決素材があれば再リンクダイアログもここで開く
        seek(0);
    }

    // ======================================================
    // プロパティパネル
    // ======================================================
    function updateProps() {
        const clip = getSelectedClip();
        if (!clip) {
            els.propsEmpty.hidden = false;
            els.propsContent.hidden = true;
            return;
        }
        els.propsEmpty.hidden = true;
        els.propsContent.hidden = false;
        $$('#propsContent input[data-prop]').forEach((input) => {
            const key = input.dataset.prop;
            input.value = clip.props[key];
            input.nextElementSibling.textContent = clip.props[key];
        });
    }

    function bindProps() {
        $$('#propsContent input[data-prop]').forEach((input) => {
            input.addEventListener('input', () => {
                const clip = getSelectedClip();
                if (!clip) return;
                clip.props[input.dataset.prop] = Number(input.value);
                input.nextElementSibling.textContent = input.value;
                renderViewer();
            });
        });
    }

    function getSelectedClip() {
        return state.clips.find((c) => c.id === state.selectedClipId) || null;
    }

    // ======================================================
    // モニター描画（ディスパッチャ）
    //   program : タイムライン全ソースを合成
    //   source  : メディアプールの単一ソース
    // ======================================================
    function renderViewer() {
        if (state.monitorMode === 'source') {
            els.viewerCanvas.classList.remove('program');
            els.previewVideo.style.display = '';
            renderSourceMonitor();
        } else {
            els.viewerCanvas.classList.add('program');
            els.viewerCanvas.classList.remove('has-media');
            els.viewerCanvas.style.filter = '';
            els.viewerCanvas.style.backgroundImage = '';
            els.textOverlay.innerHTML = '';
            els.previewVideo.pause?.();
            els.previewVideo.removeAttribute('src');
            composite(state.playhead, state.playing);
        }
    }

    // ---- ソースモニター（単一メディア表示） ----
    function renderSourceMonitor() {
        els.textOverlay.innerHTML = '';
        const s = state.monitorSource;
        if (!s) {
            els.viewerCanvas.classList.remove('has-media');
            els.viewerCanvas.style.filter = '';
            els.viewerCanvas.style.backgroundImage = '';
            els.previewVideo.removeAttribute('src');
            els.previewVideo.load?.();
            return;
        }
        els.viewerCanvas.style.filter = '';
        if ((s.type === 'video' || s.type === 'image') && s.src) {
            els.viewerCanvas.classList.add('has-media');
            if (s.type === 'video') {
                els.viewerCanvas.style.backgroundImage = '';
                els.previewVideo.style.opacity = 1;
                els.previewVideo.style.transform = '';
                if (els.previewVideo.getAttribute('src') !== s.src) els.previewVideo.src = s.src;
            } else {
                els.viewerCanvas.style.backgroundImage = `url("${s.src}")`;
                els.viewerCanvas.style.backgroundSize = 'contain';
                els.viewerCanvas.style.backgroundRepeat = 'no-repeat';
                els.viewerCanvas.style.backgroundPosition = 'center';
                els.previewVideo.removeAttribute('src');
            }
        } else if (s.type === 'audio' && s.src) {
            // 音声は <video> 要素で音だけ再生する（表示はプレースホルダーのまま）
            els.viewerCanvas.classList.remove('has-media');
            els.viewerCanvas.style.backgroundImage = '';
            if (els.previewVideo.getAttribute('src') !== s.src) els.previewVideo.src = s.src;
        } else {
            els.viewerCanvas.classList.remove('has-media');
            els.viewerCanvas.style.backgroundImage = '';
            els.previewVideo.removeAttribute('src');
        }
    }

    // モニターをプログラム（合成）モードへ
    function enterProgram() {
        if (state.monitorMode === 'program') return;
        state.monitorMode = 'program';
        state.selectedMediaId = null;
        state.monitorSource = null;
        $$('.media-item').forEach((el) => el.classList.remove('is-active'));
        els.viewerCanvas.classList.add('program');
        els.previewVideo.pause?.();
        els.previewVideo.removeAttribute('src');
    }

    // ======================================================
    // コンポジター：タイムライン上の全ソースを合成
    // ======================================================
    function composite(time, playing) {
        const active = new Set();
        const visuals = [];   // 描画対象のクリップ（奥→手前の順）

        // トラックを上の行から順に（=奥から手前へ）確認する。
        // YMM4 と同じく、番号が大きい（下の行の）レイヤーほど手前になる。
        for (let i = 0; i < TRACKS.length; i++) {
            const tr = TRACKS[i];
            const clip = activeClipOnTrack(tr.id, time);
            if (!clip) continue;
            // YMM4 側で非表示（IsHidden）だったアイテムは描画も再生もしない
            if (clip.hidden) continue;
            active.add(clip.id);
            if (trackVisible(tr.id) && clip.type !== 'audio') visuals.push(clip);
            // 動画の音声・オーディオクリップを同期再生
            syncAV(clip, time, playing, tr.id);
        }

        // 描画は PixiJS（WebGPU / WebGL）優先。初期化失敗時のみ Canvas 2D で描く
        if (pixi) compositePixi(visuals, time);
        else if (compCtx) composite2d(visuals, time);

        pauseInactive(active);
    }

    // Canvas 2D による合成（PixiJS が初期化できなかった場合のフォールバック）
    function composite2d(visuals, time) {
        const W = els.compositor.width, H = els.compositor.height;
        compCtx.setTransform(1, 0, 0, 1, 0, 0);
        compCtx.filter = 'none';
        compCtx.globalAlpha = 1;
        compCtx.globalCompositeOperation = 'source-over';
        compCtx.fillStyle = '#000';
        compCtx.fillRect(0, 0, W, H);
        for (const clip of visuals) {
            if (clip.type === 'effect') {
                // エフェクトアイテム：ここまで描画した下位レイヤーへ効果をかける
                drawEffectOverlay(clip, time);
            } else {
                drawVisualClip(clip, time);
            }
        }
    }

    // YMM4 のブレンドモード → canvas の合成モード（対応するもののみ）
    const BLEND_MODES = {
        'Normal': 'source-over', '通常': 'source-over',
        'Add': 'lighter', '加算': 'lighter',
        'Multiply': 'multiply', '乗算': 'multiply',
        'Screen': 'screen', 'スクリーン': 'screen',
        'Overlay': 'overlay', 'オーバーレイ': 'overlay',
        'Darken': 'darken', '比較(暗)': 'darken',
        'Lighten': 'lighten', '比較(明)': 'lighten',
        'Difference': 'difference', '差分': 'difference',
        'Exclusion': 'exclusion', '除外': 'exclusion',
        'ColorDodge': 'color-dodge', '覆い焼き': 'color-dodge',
        'ColorBurn': 'color-burn', '焼き込み': 'color-burn',
        'HardLight': 'hard-light', 'ハードライト': 'hard-light',
        'SoftLight': 'soft-light', 'ソフトライト': 'soft-light',
    };

    // YMM4 のイージング（近似）。mode: In / Out / InOut
    const EASE_FUNCS = {
        Linear: (x) => x,
        Sine:   (x) => 1 - Math.cos((x * Math.PI) / 2),
        Quad:   (x) => x * x,
        Cubic:  (x) => x * x * x,
        Quart:  (x) => x * x * x * x,
        Quint:  (x) => x * x * x * x * x,
        Expo:   (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
        Circ:   (x) => 1 - Math.sqrt(1 - clampNum(x, 0, 1) ** 2),
        Back:   (x) => 2.70158 * x * x * x - 1.70158 * x * x,
    };
    function easeValue(type, mode, x) {
        const f = EASE_FUNCS[type] || EASE_FUNCS.Quad;
        x = clampNum(x, 0, 1);
        if (mode === 'Out') return 1 - f(1 - x);
        if (mode === 'InOut') return x < 0.5 ? f(x * 2) / 2 : 1 - f((1 - x) * 2) / 2;
        return f(x);
    }

    // フェードイン / アウトによる不透明度係数（0〜1）
    function fadeFactor(clip, time) {
        const local = time - clip.start;
        let f = 1;
        if (clip.fadeIn > 0) f *= clampNum(local / clip.fadeIn, 0, 1);
        if (clip.fadeOut > 0) f *= clampNum((clip.dur - local) / clip.fadeOut, 0, 1);
        return f;
    }

    // 擬似乱数（同じ入力に同じ結果を返す。振動エフェクトの再現性確保用）
    function prand(n) {
        const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }
    // クリップ ID から擬似乱数の種を作る
    function seedOf(clip) {
        if (clip._seed) return clip._seed;
        let h = 0;
        const s = String(clip.id);
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        clip._seed = Math.abs(h) + 1;
        return clip._seed;
    }

    // 登場退場・ランダム移動エフェクトによる描画補正（位置・ぼかし・拡大・透明度）
    function effectState(clip, time) {
        const out = { dx: 0, dy: 0, blur: 0, scale: 1, alpha: 1 };
        const W = els.compositor.width, H = els.compositor.height;
        const local = time - clip.start;
        for (const f of (clip.effects || [])) {
            if (f.kind === 'move-outside' || f.kind === 'inout-blur' || f.kind === 'crash') {
                // 登場（in）/ 退場（out）区間の未完了度（0=定位置、1=完全に効果側）
                let disp = 0;
                if (f.isIn && local < f.time) {
                    disp = 1 - easeValue(f.easeT, f.easeM, local / f.time);
                } else if (f.isOut && clip.dur - local < f.time) {
                    disp = 1 - easeValue(f.easeT, f.easeM, (clip.dur - local) / f.time);
                }
                if (disp <= 0) continue;
                if (f.kind === 'move-outside') {
                    if (f.dir === 'Left') out.dx -= W * disp;
                    else if (f.dir === 'Right') out.dx += W * disp;
                    else if (f.dir === 'Top') out.dy -= H * disp;
                    else out.dy += H * disp;   // Bottom（既定）
                } else if (f.kind === 'inout-blur') {
                    out.blur += f.value * disp * projScale();
                } else {
                    // クラッシュ（近似）：上から落ちつつ拡大・フェードする
                    out.dy -= H * 0.4 * disp;
                    out.scale *= 1 + disp * 0.5;
                    out.alpha *= 1 - disp * 0.5;
                }
            } else if (f.kind === 'random-move') {
                // Span 秒ごとに擬似乱数で位置を揺らす
                const bucket = Math.floor(local / f.span);
                const seed = seedOf(clip);
                const s = projScale();
                out.dx += (prand(seed + bucket * 2) - 0.5) * 2 * f.x * s;
                out.dy += (prand(seed + bucket * 2 + 1) - 0.5) * 2 * f.y * s;
            }
        }
        return out;
    }

    // クロマキー（近似）：縮小オフスクリーンで色距離により透過させる
    const CHROMA_MAX_W = 640;   // 処理負荷を抑えるための最大処理幅(px)
    function applyChromaKey(clip, media, mw, mh, fx) {
        if (!fx.color || !(mw > 0 && mh > 0)) return null;
        const scale = Math.min(1, CHROMA_MAX_W / mw);
        const w = Math.max(1, Math.round(mw * scale));
        const h = Math.max(1, Math.round(mh * scale));
        if (!clip._ckCanvas) clip._ckCanvas = document.createElement('canvas');
        const c = clip._ckCanvas;
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        try {
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(media, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const d = img.data;
            // RGB 距離の最大値（√3×255）に対する割合をしきい値にする
            const th = (fx.tolerance / 100) * 442;
            const kr = fx.color.r, kg = fx.color.g, kb = fx.color.b;
            for (let i = 0; i < d.length; i += 4) {
                const dist = Math.sqrt(
                    (d[i] - kr) ** 2 + (d[i + 1] - kg) ** 2 + (d[i + 2] - kb) ** 2);
                const hit = dist <= th;
                if (fx.invert ? !hit : hit) d[i + 3] = 0;
            }
            ctx.putImageData(img, 0, 0);
            return c;
        } catch (e) {
            return null;   // 読み取り不可（クロスオリジン等）の場合は素通し
        }
    }

    // エフェクトアイテム：ここまで描画された下位レイヤーへ効果をかける（現状は放射光のみ）
    function drawEffectOverlay(clip, time) {
        const W = els.compositor.width, H = els.compositor.height;
        const p01 = clip.dur > 0 ? clampNum((time - clip.start) / clip.dur, 0, 1) : 0;
        const alpha = clampNum(clip.props.opacity / 100, 0, 1) * fadeFactor(clip, time);
        if (alpha <= 0) return;
        for (const f of (clip.effects || [])) {
            if (f.kind !== 'radial-light') continue;
            const value = clampNum(fxVal(f.value, p01, 100), 0, 400);
            if (value <= 0) continue;
            const s = projScale();
            const cx = W / 2 + f.x * s;
            const cy = H / 2 + f.y * s;
            const radius = Math.max(W, H) * (value / 100);
            const g = compCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            g.addColorStop(0, `rgba(255,250,220,${0.7 * alpha})`);
            g.addColorStop(1, 'rgba(255,250,220,0)');
            compCtx.save();
            compCtx.globalCompositeOperation = 'lighter';
            compCtx.fillStyle = g;
            compCtx.fillRect(0, 0, W, H);
            compCtx.restore();
        }
    }

    // 図形アイテムの描画（現状は背景＝画面全体の単色塗りのみ対応）
    function drawShapeClip(clip, time) {
        const s = clip.shape;
        if (!s || s.kind !== 'BackgroundShapePlugin' || !s.color) return;
        const W = els.compositor.width, H = els.compositor.height;
        const p01 = clip.dur > 0 ? clampNum((time - clip.start) / clip.dur, 0, 1) : 0;
        const alpha = clampNum(animProp(clip, 'opacity', p01, clip.props.opacity) / 100, 0, 1)
            * fadeFactor(clip, time);
        if (alpha <= 0) return;
        compCtx.save();
        compCtx.globalAlpha = 1;
        compCtx.filter = 'none';
        if (clip.blend && BLEND_MODES[clip.blend]) {
            compCtx.globalCompositeOperation = BLEND_MODES[clip.blend];
        }
        compCtx.fillStyle = rgbaStr(s.color, alpha);
        compCtx.fillRect(0, 0, W, H);
        compCtx.restore();
    }

    // 指定トラックで再生ヘッド位置にあるクリップ（重なりは後勝ち）
    function activeClipOnTrack(trackId, time) {
        let found = null;
        for (const c of state.clips) {
            if (c.track === trackId && time >= c.start && time < c.start + c.dur) {
                if (!found || c.start > found.start) found = c;
            }
        }
        return found;
    }

    function drawVisualClip(clip, time) {
        const W = els.compositor.width, H = els.compositor.height;
        const p = clip.props;

        if (clip.type === 'text') { drawTextClip(clip, time); return; }
        if (clip.type === 'shape') { drawShapeClip(clip, time); return; }

        let media, mw, mh, ready = false;
        if (clip.type === 'video') {
            media = getMediaEl(clip);
            if (!media) return;   // ソース未解決（YMM4 読み込み直後など）
            mw = media.videoWidth; mh = media.videoHeight;
            ready = media.readyState >= 2 && mw > 0;
        } else if (clip.type === 'image') {
            media = getImg(clip);
            if (!media) return;   // ソース未解決（YMM4 読み込み直後など）
            mw = media.naturalWidth; mh = media.naturalHeight;
            ready = media.complete && mw > 0;
        } else {
            return; // 音声・エフェクトなどは描画なし
        }
        if (!ready) return;

        // クリップ内の進行度（アニメーション・登場退場エフェクトの基準）
        const p01 = clip.dur > 0 ? clampNum((time - clip.start) / clip.dur, 0, 1) : 0;
        const fx = effectState(clip, time);

        // クロマキーは元画像を加工したオフスクリーンへ差し替えて描く（配置サイズは元のまま）
        const ck = (clip.effects || []).find((f) => f.kind === 'chroma-key');
        if (ck) {
            const keyed = applyChromaKey(clip, media, mw, mh, ck);
            if (keyed) media = keyed;
        }

        const alpha = clampNum(animProp(clip, 'opacity', p01, p.opacity) / 100, 0, 1)
            * fadeFactor(clip, time) * fx.alpha;
        if (alpha <= 0) return;

        compCtx.save();
        compCtx.globalAlpha = clampNum(alpha, 0, 1);
        let filter = `brightness(${p.brightness}%) contrast(${p.contrast}%) saturate(${p.saturate}%)`;
        if (fx.blur > 0.2) filter += ` blur(${fx.blur.toFixed(1)}px)`;
        compCtx.filter = filter;
        if (clip.blend && BLEND_MODES[clip.blend]) {
            compCtx.globalCompositeOperation = BLEND_MODES[clip.blend];
        }
        // 影エフェクト（YMM4 の ShadowEffect）
        const sh = (clip.effects || []).find((f) => f.kind === 'shadow');
        if (sh) {
            const s = projScale();
            compCtx.shadowColor = rgbaStr(sh.color, sh.opacity / 100);
            compCtx.shadowBlur = sh.blur * s;
            compCtx.shadowOffsetX = sh.x * s;
            compCtx.shadowOffsetY = sh.y * s;
        }
        const x = animProp(clip, 'x', p01, p.x);
        const y = animProp(clip, 'y', p01, p.y);
        const scale = animProp(clip, 'scale', p01, p.scale);
        const rotate = animProp(clip, 'rotate', p01, p.rotate);
        compCtx.translate(
            W / 2 + (x / 500) * (W / 2) + fx.dx,
            H / 2 + (y / 500) * (H / 2) + fx.dy);
        compCtx.rotate(rotate * Math.PI / 180);
        if (clip.flipH || clip.flipV) compCtx.scale(clip.flipH ? -1 : 1, clip.flipV ? -1 : 1);
        // YMM4 由来は素材の実寸 × 拡大率（等倍配置）、Auriga 内の素材は画面フィット基準
        const base = clip.ymm ? projScale() : Math.min(W / mw, H / mh);
        const fit = base * (scale / 100) * fx.scale;
        const dw = mw * fit, dh = mh * fit;
        try { compCtx.drawImage(media, -dw / 2, -dh / 2, dw, dh); } catch (e) { /* not ready */ }
        compCtx.restore();
    }

    function drawTextClip(clip, time) {
        const W = els.compositor.width, H = els.compositor.height;
        const p = clip.props;
        const p01 = clip.dur > 0 ? clampNum((time - clip.start) / clip.dur, 0, 1) : 0;
        const fx = effectState(clip, time);
        const alpha = clampNum(animProp(clip, 'opacity', p01, p.opacity) / 100, 0, 1)
            * fadeFactor(clip, time) * fx.alpha;
        if (alpha <= 0) return;

        compCtx.save();
        compCtx.globalAlpha = clampNum(alpha, 0, 1);
        if (fx.blur > 0.2) compCtx.filter = `blur(${fx.blur.toFixed(1)}px)`;
        if (clip.blend && BLEND_MODES[clip.blend]) {
            compCtx.globalCompositeOperation = BLEND_MODES[clip.blend];
        }
        const x = animProp(clip, 'x', p01, p.x);
        const y = animProp(clip, 'y', p01, p.y);
        const scale = animProp(clip, 'scale', p01, p.scale) / 100 * fx.scale;
        const rotate = animProp(clip, 'rotate', p01, p.rotate);
        compCtx.translate(
            W / 2 + (x / 500) * (W / 2) + fx.dx,
            H / 2 + (y / 500) * (H / 2) + fx.dy);
        compCtx.rotate(rotate * Math.PI / 180);

        const info = clip.text;
        if (info) {
            // ---- YMM4 のテキスト書式で描画する ----
            const fs = Math.max(1, info.size * projScale() * scale);
            const weight = info.bold ? '700' : '400';
            const style = info.italic ? 'italic ' : '';
            const family = info.font ? `"${info.font.replace(/"/g, '')}",` : '';
            compCtx.font = `${style}${weight} ${fs}px ${family}"Yu Gothic UI",sans-serif`;
            const lines = String(info.value || clip.name).split(/\r?\n/);
            const lh = fs * ((info.lineHeight || 100) / 100);
            // 基準点（BasePoint）から水平揃えと縦位置を決める
            const bp = String(info.basePoint || 'CenterCenter');
            compCtx.textAlign = bp.startsWith('Left') ? 'left'
                : bp.startsWith('Right') ? 'right' : 'center';
            compCtx.textBaseline = 'middle';
            const total = lh * (lines.length - 1);
            let startY = -total / 2;                        // 縦中央基準
            if (bp.endsWith('Top')) startY = lh / 2;        // 上端基準
            else if (bp.endsWith('Bottom')) startY = -total - lh / 2;   // 下端基準
            // 影エフェクト（YMM4 の ShadowEffect）
            const sh = (clip.effects || []).find((f) => f.kind === 'shadow');
            if (sh) {
                const s = projScale();
                compCtx.shadowColor = rgbaStr(sh.color, sh.opacity / 100);
                compCtx.shadowBlur = sh.blur * s;
                compCtx.shadowOffsetX = sh.x * s;
                compCtx.shadowOffsetY = sh.y * s;
            }
            compCtx.fillStyle = rgbaStr(info.color);
            lines.forEach((line, i) => {
                const ly = startY + i * lh;
                // 縁取りスタイルは先に輪郭を描いてから本体を重ねる
                if (info.style === 'Border' && info.styleColor) {
                    compCtx.lineJoin = 'round';
                    compCtx.lineWidth = Math.max(1, fs * 0.08);
                    compCtx.strokeStyle = rgbaStr(info.styleColor);
                    compCtx.strokeText(line, 0, ly);
                }
                compCtx.fillText(line, 0, ly);
            });
        } else {
            // ---- Auriga 内で追加したテキスト（従来の固定スタイル） ----
            const fs = W * 0.05 * scale;
            compCtx.font = `800 ${fs}px "Hiragino Sans","Yu Gothic UI",sans-serif`;
            compCtx.textAlign = 'center';
            compCtx.textBaseline = 'middle';
            compCtx.shadowColor = 'rgba(0,0,0,.7)';
            compCtx.shadowBlur = fs * 0.4;
            compCtx.shadowOffsetY = fs * 0.06;
            compCtx.fillStyle = '#fff';
            compCtx.fillText(clip.name, 0, 0);
        }
        compCtx.restore();
    }

    // ======================================================
    // PixiJS コンポジター（WebGPU / WebGL）
    // ======================================================
    // Canvas 2D 版（composite2d 系）と同じ見た目になるように、クリップごとの
    // 表示オブジェクトを毎フレーム組み立てて renderer.render で描画する。
    // 生成コストの高いオブジェクト（Sprite / Text / Filter / Texture）は
    // clip._px* にキャッシュして使い回す。

    // コンポジターの描画基盤を初期化する（init から一度だけ呼ぶ）
    async function initCompositor() {
        if (window.PIXI) {
            try {
                const renderer = await PIXI.autoDetectRenderer({
                    preference: 'webgpu',              // WebGPU を最優先で試し、非対応なら WebGL へ
                    canvas: els.compositor,
                    width: els.compositor.width,
                    height: els.compositor.height,
                    background: '#000000',
                    antialias: true,
                    // WebGL フォールバック時にも toDataURL（フレーム保存）を使えるようにする
                    preserveDrawingBuffer: true,
                });
                // ブレンドモードの下地とフレーム保存のため、黒背景は図形として毎フレーム敷く
                pixi = { renderer, stage: new PIXI.Container(), bg: new PIXI.Graphics(), bgW: 0, bgH: 0 };
                const kind = renderer.type === PIXI.RendererType.WEBGPU ? 'WebGPU' : 'WebGL';
                compositorBackend = `PixiJS ${PIXI.VERSION} (${kind})`;
                console.log(`[Auriga] コンポジター: ${compositorBackend}`);
                return;
            } catch (e) {
                console.warn('[Auriga] PixiJS の初期化に失敗したため Canvas 2D で描画します', e);
            }
        }
        compCtx = els.compositor.getContext('2d');
        compositorBackend = 'Canvas 2D';
    }

    // コンポジターの出力解像度を変更する（Pixi 使用時はレンダラー経由で変更する）
    function resizeCompositor(w, h) {
        if (pixi) {
            pixi.renderer.resize(w, h);
        } else {
            els.compositor.width = w;
            els.compositor.height = h;
        }
    }

    // canvas の合成モード名 → Pixi のブレンドモード名。
    // 加算・乗算・スクリーン以外は advanced-blend-modes.min.js が登録する拡張を使う
    const PIXI_BLEND = {
        'source-over': 'normal',
        'lighter': 'add',
        'multiply': 'multiply',
        'screen': 'screen',
        'overlay': 'overlay',
        'darken': 'darken',
        'lighten': 'lighten',
        'difference': 'difference',
        'exclusion': 'exclusion',
        'color-dodge': 'color-dodge',
        'color-burn': 'color-burn',
        'hard-light': 'hard-light',
        'soft-light': 'soft-light',
    };

    // クリップのブレンド設定（YMM4 名 → canvas 名 → Pixi 名）を解決する
    function pixiBlendOf(clip) {
        const canvasMode = clip.blend && BLEND_MODES[clip.blend];
        return (canvasMode && PIXI_BLEND[canvasMode]) || 'normal';
    }

    // 4x5 カラー行列の合成（b を先に適用し、続けて a を適用した結果を返す）
    function multiplyColorMatrix(a, b) {
        const out = new Array(20).fill(0);
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 5; col++) {
                let v = 0;
                for (let k = 0; k < 4; k++) v += a[row * 5 + k] * b[k * 5 + col];
                if (col === 4) v += a[row * 5 + 4];   // 平行移動（オフセット）成分
                out[row * 5 + col] = v;
            }
        }
        return out;
    }

    // CSS filter の brightness / contrast / saturate と同じ変換のカラー行列を作る。
    // オフセット列は 0〜1 正規化（Pixi v8 の ColorMatrixFilter の規約に合わせる）
    function cssColorMatrix(brightness, contrast, saturate) {
        const b = brightness;
        const brM = [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
        const c = contrast, cO = 0.5 - 0.5 * c;
        const coM = [c, 0, 0, 0, cO, 0, c, 0, 0, cO, 0, 0, c, 0, cO, 0, 0, 0, 1, 0];
        const s = saturate;
        const saM = [
            0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
            0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
            0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
            0, 0, 0, 1, 0,
        ];
        // CSS の記述順（brightness → contrast → saturate）と同じ順に適用する
        return multiplyColorMatrix(saM, multiplyColorMatrix(coM, brM));
    }

    // クリップの描画ソースから Pixi テクスチャを得る（クリップ単位でキャッシュ）
    function pixiTexture(clip, src) {
        if (clip._pxTex && clip._pxSrc === src) {
            // 動画・クロマキー用キャンバスは内容が毎フレーム変わるため再アップロードを指示する
            if (clip._pxLive) clip._pxTex.source.update();
            return clip._pxTex;
        }
        if (clip._pxTex) clip._pxTex.destroy(true);   // ソース差し替え時は古いテクスチャを破棄
        let source;
        if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) {
            // 再生・シークは syncAV が制御するため autoPlay は必ず切る
            source = new PIXI.VideoSource({ resource: src, autoPlay: false, autoLoad: true });
            clip._pxLive = true;
        } else if (src instanceof HTMLCanvasElement) {
            source = new PIXI.CanvasSource({ resource: src });
            clip._pxLive = true;
        } else {
            source = new PIXI.ImageSource({ resource: src });
            clip._pxLive = false;
        }
        clip._pxTex = new PIXI.Texture({ source });
        clip._pxSrc = src;
        return clip._pxTex;
    }

    // タイムライン上の表示クリップ一式を Pixi のシーングラフへ組み立てて描画する
    function compositePixi(visuals, time) {
        const W = els.compositor.width, H = els.compositor.height;
        const stage = pixi.stage;
        stage.removeChildren();
        // 黒背景（Canvas 2D 版の黒塗りと同じ役割。サイズが変わったときだけ引き直す）
        if (pixi.bgW !== W || pixi.bgH !== H) {
            pixi.bg.clear().rect(0, 0, W, H).fill(0x000000);
            pixi.bgW = W; pixi.bgH = H;
        }
        stage.addChild(pixi.bg);
        for (const clip of visuals) {
            if (clip.type === 'effect') pixiEffectOverlay(clip, time, stage);
            else if (clip.type === 'text') pixiTextClip(clip, time, stage);
            else if (clip.type === 'shape') pixiShapeClip(clip, time, stage);
            else if (clip.type === 'video' || clip.type === 'image') pixiVisualClip(clip, time, stage);
        }
        pixi.renderer.render(stage);
    }

    // スプライトへ配置・サイズ・回転・反転・不透明度・ブレンドを設定する共通処理
    function configurePixiSprite(sp, tex, dw, dh, clip, x, y, rotation, alpha, blend) {
        sp.texture = tex;
        sp.anchor.set(0.5);
        sp.width = dw;
        sp.height = dh;
        // width/height 代入で scale が正値に張り直されるため、反転はその後に符号だけ返す
        if (clip.flipH) sp.scale.x = -sp.scale.x;
        if (clip.flipV) sp.scale.y = -sp.scale.y;
        sp.position.set(x, y);
        sp.rotation = rotation;
        sp.alpha = alpha;
        sp.blendMode = blend;
    }

    // 映像・画像クリップをスプライトとして配置する（drawVisualClip の Pixi 版）
    function pixiVisualClip(clip, time, stage) {
        const W = els.compositor.width, H = els.compositor.height;
        const p = clip.props;

        let media, mw, mh, ready = false;
        if (clip.type === 'video') {
            media = getMediaEl(clip);
            if (!media) return;   // ソース未解決（YMM4 読み込み直後など）
            mw = media.videoWidth; mh = media.videoHeight;
            ready = media.readyState >= 2 && mw > 0;
        } else {
            media = getImg(clip);
            if (!media) return;   // ソース未解決（YMM4 読み込み直後など）
            mw = media.naturalWidth; mh = media.naturalHeight;
            ready = media.complete && mw > 0;
        }
        if (!ready) return;

        // クリップ内の進行度（アニメーション・登場退場エフェクトの基準）
        const p01 = clip.dur > 0 ? clampNum((time - clip.start) / clip.dur, 0, 1) : 0;
        const fx = effectState(clip, time);

        // クロマキーは CPU 加工済みキャンバスをテクスチャ元へ差し替える（配置サイズは元のまま）
        let src = media;
        const ck = (clip.effects || []).find((f) => f.kind === 'chroma-key');
        if (ck) {
            const keyed = applyChromaKey(clip, media, mw, mh, ck);
            if (keyed) src = keyed;
        }

        const alpha = clampNum(animProp(clip, 'opacity', p01, p.opacity) / 100, 0, 1)
            * fadeFactor(clip, time) * fx.alpha;
        if (alpha <= 0) return;

        const tex = pixiTexture(clip, src);
        const x = animProp(clip, 'x', p01, p.x);
        const y = animProp(clip, 'y', p01, p.y);
        const scale = animProp(clip, 'scale', p01, p.scale);
        const rotate = animProp(clip, 'rotate', p01, p.rotate);
        // YMM4 由来は素材の実寸 × 拡大率（等倍配置）、Auriga 内の素材は画面フィット基準
        const base = clip.ymm ? projScale() : Math.min(W / mw, H / mh);
        const fit = base * (scale / 100) * fx.scale;
        const dw = mw * fit, dh = mh * fit;
        const px = W / 2 + (x / 500) * (W / 2) + fx.dx;
        const py = H / 2 + (y / 500) * (H / 2) + fx.dy;
        const rot = rotate * Math.PI / 180;

        // 影エフェクト（YMM4 の ShadowEffect）：本体の後ろへ影色のシルエットを敷く
        const sh = (clip.effects || []).find((f) => f.kind === 'shadow');
        if (sh) {
            const s = projScale();
            const shSp = clip._pxShadowSp || (clip._pxShadowSp = new PIXI.Sprite());
            const shCm = clip._pxShadowCm || (clip._pxShadowCm = new PIXI.ColorMatrixFilter());
            const shBl = clip._pxShadowBl || (clip._pxShadowBl = new PIXI.BlurFilter());
            configurePixiSprite(shSp, tex, dw, dh, clip, px + sh.x * s, py + sh.y * s, rot, alpha, 'normal');
            // RGB を影色で塗りつぶし、アルファに影の不透明度を乗算するカラー行列
            const c = sh.color || { r: 0, g: 0, b: 0, a: 1 };
            shCm.matrix = [
                0, 0, 0, 0, c.r / 255,
                0, 0, 0, 0, c.g / 255,
                0, 0, 0, 0, c.b / 255,
                0, 0, 0, clampNum((c.a == null ? 1 : c.a) * sh.opacity / 100, 0, 1), 0,
            ];
            // canvas の shadowBlur はぼかし径なので、σ 相当へ半分に換算する（近似）
            shBl.strength = Math.max(0.1, sh.blur * s / 2);
            shSp.filters = [shCm, shBl];
            stage.addChild(shSp);
        }

        const sp = clip._pxSp || (clip._pxSp = new PIXI.Sprite());
        configurePixiSprite(sp, tex, dw, dh, clip, px, py, rot, alpha, pixiBlendOf(clip));
        // カラー補正（明るさ・コントラスト・彩度）と登場退場のぼかし
        const filters = [];
        if (p.brightness !== 100 || p.contrast !== 100 || p.saturate !== 100) {
            const f = clip._pxColor || (clip._pxColor = new PIXI.ColorMatrixFilter());
            f.matrix = cssColorMatrix(p.brightness / 100, p.contrast / 100, p.saturate / 100);
            filters.push(f);
        }
        if (fx.blur > 0.2) {
            const f = clip._pxBlur || (clip._pxBlur = new PIXI.BlurFilter());
            f.strength = fx.blur;
            filters.push(f);
        }
        sp.filters = filters.length ? filters : null;
        stage.addChild(sp);
    }

    // テキストクリップを Pixi Text として配置する（drawTextClip の Pixi 版）。
    // Text のラスタライズは重いため、内容やスタイルが変わったときだけ作り直す
    function pixiTextClip(clip, time, stage) {
        const W = els.compositor.width, H = els.compositor.height;
        const p = clip.props;
        const p01 = clip.dur > 0 ? clampNum((time - clip.start) / clip.dur, 0, 1) : 0;
        const fx = effectState(clip, time);
        const alpha = clampNum(animProp(clip, 'opacity', p01, p.opacity) / 100, 0, 1)
            * fadeFactor(clip, time) * fx.alpha;
        if (alpha <= 0) return;

        const x = animProp(clip, 'x', p01, p.x);
        const y = animProp(clip, 'y', p01, p.y);
        const scale = animProp(clip, 'scale', p01, p.scale) / 100 * fx.scale;
        const rotate = animProp(clip, 'rotate', p01, p.rotate);

        const info = clip.text;
        const sh = (clip.effects || []).find((f) => f.kind === 'shadow');
        let cacheKey, make;
        if (info) {
            // ---- YMM4 のテキスト書式 ----
            const ps = projScale();
            const fs = Math.max(1, info.size * ps);   // 拡大率は transform の scale で反映する
            const lh = fs * ((info.lineHeight || 100) / 100);
            const bp = String(info.basePoint || 'CenterCenter');
            cacheKey = JSON.stringify(['ymm', info.value, clip.name, info.font, info.size, info.bold,
                info.italic, info.color, info.style, info.styleColor, info.lineHeight, bp, sh, ps]);
            make = () => {
                const style = {
                    fontFamily: [info.font, 'Yu Gothic UI', 'sans-serif'].filter(Boolean),
                    fontSize: fs,
                    fontWeight: info.bold ? '700' : '400',
                    fontStyle: info.italic ? 'italic' : 'normal',
                    fill: rgbaStr(info.color),
                    align: bp.startsWith('Left') ? 'left' : bp.startsWith('Right') ? 'right' : 'center',
                    lineHeight: lh,
                };
                // 縁取りスタイル（Border）
                if (info.style === 'Border' && info.styleColor) {
                    style.stroke = { color: rgbaStr(info.styleColor), width: Math.max(1, fs * 0.08), join: 'round' };
                }
                // 影エフェクト（YMM4 の ShadowEffect）はテキストのドロップシャドウで表現する
                if (sh) {
                    style.dropShadow = {
                        color: sh.color ? `rgb(${sh.color.r},${sh.color.g},${sh.color.b})` : '#000',
                        alpha: clampNum(sh.opacity / 100, 0, 1),
                        blur: sh.blur * ps / 2,
                        angle: Math.atan2(sh.y, sh.x),
                        distance: Math.hypot(sh.x * ps, sh.y * ps),
                    };
                }
                const t = new PIXI.Text({ text: String(info.value || clip.name), style });
                // 基準点（BasePoint）をアンカーで再現する
                t.anchor.set(
                    bp.startsWith('Left') ? 0 : bp.startsWith('Right') ? 1 : 0.5,
                    bp.endsWith('Top') ? 0 : bp.endsWith('Bottom') ? 1 : 0.5);
                return t;
            };
        } else {
            // ---- Auriga 内で追加したテキスト（従来の固定スタイル） ----
            const fs = W * 0.05;
            cacheKey = JSON.stringify(['plain', clip.name, fs]);
            make = () => {
                const t = new PIXI.Text({
                    text: clip.name,
                    style: {
                        fontFamily: ['Hiragino Sans', 'Yu Gothic UI', 'sans-serif'],
                        fontSize: fs,
                        fontWeight: '800',
                        fill: '#ffffff',
                        align: 'center',
                        dropShadow: {
                            color: '#000000', alpha: 0.7,
                            blur: fs * 0.2, angle: Math.PI / 2, distance: fs * 0.06,
                        },
                    },
                });
                t.anchor.set(0.5);
                return t;
            };
        }

        if (!clip._pxText || clip._pxTextKey !== cacheKey) {
            if (clip._pxText) clip._pxText.destroy();
            clip._pxText = make();
            clip._pxTextKey = cacheKey;
        }
        const t = clip._pxText;
        t.position.set(
            W / 2 + (x / 500) * (W / 2) + fx.dx,
            H / 2 + (y / 500) * (H / 2) + fx.dy);
        t.rotation = rotate * Math.PI / 180;
        t.scale.set(scale);
        t.alpha = alpha;
        t.blendMode = pixiBlendOf(clip);
        if (fx.blur > 0.2) {
            const f = clip._pxBlur || (clip._pxBlur = new PIXI.BlurFilter());
            f.strength = fx.blur;
            t.filters = [f];
        } else {
            t.filters = null;
        }
        stage.addChild(t);
    }

    // 図形クリップ（現状は背景＝画面全体の単色塗りのみ）を Graphics として配置する
    function pixiShapeClip(clip, time, stage) {
        const s = clip.shape;
        if (!s || s.kind !== 'BackgroundShapePlugin' || !s.color) return;
        const W = els.compositor.width, H = els.compositor.height;
        const p01 = clip.dur > 0 ? clampNum((time - clip.start) / clip.dur, 0, 1) : 0;
        const alpha = clampNum(animProp(clip, 'opacity', p01, clip.props.opacity) / 100, 0, 1)
            * fadeFactor(clip, time);
        if (alpha <= 0) return;
        const g = clip._pxShape || (clip._pxShape = new PIXI.Graphics());
        g.clear().rect(0, 0, W, H).fill({
            color: (s.color.r << 16) | (s.color.g << 8) | s.color.b,
            alpha: clampNum(alpha * (s.color.a == null ? 1 : s.color.a), 0, 1),
        });
        g.blendMode = pixiBlendOf(clip);
        stage.addChild(g);
    }

    // 放射光テクスチャ（中心 0.7 → 端 0 のラジアルグラデーション）。初回だけ生成して共有する
    let radialLightTex = null;
    function radialLightTexture() {
        if (radialLightTex) return radialLightTex;
        const size = 512;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, 'rgba(255,250,220,0.7)');
        g.addColorStop(1, 'rgba(255,250,220,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        radialLightTex = new PIXI.Texture({ source: new PIXI.CanvasSource({ resource: c }) });
        return radialLightTex;
    }

    // エフェクトアイテム（放射光）を加算ブレンドのスプライトとして重ねる
    function pixiEffectOverlay(clip, time, stage) {
        const W = els.compositor.width, H = els.compositor.height;
        const p01 = clip.dur > 0 ? clampNum((time - clip.start) / clip.dur, 0, 1) : 0;
        const alpha = clampNum(clip.props.opacity / 100, 0, 1) * fadeFactor(clip, time);
        if (alpha <= 0) return;
        if (!clip._pxFx) clip._pxFx = [];
        let n = 0;
        for (const f of (clip.effects || [])) {
            if (f.kind !== 'radial-light') continue;
            const value = clampNum(fxVal(f.value, p01, 100), 0, 400);
            if (value <= 0) continue;
            const s = projScale();
            const radius = Math.max(W, H) * (value / 100);
            const sp = clip._pxFx[n] || (clip._pxFx[n] = new PIXI.Sprite());
            n++;
            sp.texture = radialLightTexture();
            sp.anchor.set(0.5);
            sp.position.set(W / 2 + f.x * s, H / 2 + f.y * s);
            sp.width = sp.height = radius * 2;
            sp.alpha = alpha;
            sp.blendMode = 'add';
            stage.addChild(sp);
        }
    }

    // ---- WebAudio（クリップ音量ゲイン用） ----
    // YMM4 の音量は 100% を超えられる（例: 172.5%）ため、GainNode を挟んで増幅する。
    let audioCtx = null;
    function attachClipAudio(clip, el) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
            if (!audioCtx) audioCtx = new AC();
            const src = audioCtx.createMediaElementSource(el);
            clip._gain = audioCtx.createGain();
            src.connect(clip._gain);
            clip._gain.connect(audioCtx.destination);
        } catch (e) {
            clip._gain = null;   // 接続できない場合は el.volume のみで制御する
        }
    }
    // 自動再生制限で停止した AudioContext を再開する（再生ボタン＝ユーザー操作時に呼ぶ）
    function resumeAudioCtx() {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    }

    // ---- クリップ用メディア要素（遅延生成・クリップに紐付け） ----
    function getMediaEl(clip) {
        if (clip._el) return clip._el;
        if (!clip.src) return null;   // ソースが無いクリップは要素を作らない
        if (clip.type === 'video') {
            const v = document.createElement('video');
            v.src = clip.src; v.preload = 'auto'; v.playsInline = true;
            v.addEventListener('seeked', onMediaSettled);
            v.addEventListener('loadeddata', onMediaSettled);
            clip._el = v;
            attachClipAudio(clip, v);
            return v;
        }
        if (clip.type === 'audio') {
            const a = new Audio(clip.src);
            a.preload = 'auto';
            clip._el = a;
            attachClipAudio(clip, a);
            return a;
        }
        return null;
    }

    function getImg(clip) {
        if (clip._img) return clip._img;
        if (!clip.src) return null;   // ソースが無いクリップは要素を作らない
        const i = new Image();
        i.addEventListener('load', onMediaSettled);
        i.src = clip.src;
        clip._img = i;
        return i;
    }

    // メディアの seek / load 完了時、停止中なら現在フレームを再描画
    function onMediaSettled() {
        if (!state.playing && state.monitorMode === 'program') {
            composite(state.playhead, false);
        }
    }

    // 動画/音声をタイムライン位置に同期
    function syncAV(clip, time, playing, trackId) {
        if (clip.type !== 'video' && clip.type !== 'audio') return;
        const el = getMediaEl(clip);
        if (!el) return;
        const rate = (clip.props.speed || 100) / 100;
        // クリップ速度 × プレビュー速度（ブラウザが対応する 0.0625〜16 倍へ収める）
        el.playbackRate = clampNum(rate * state.rate, 0.0625, 16);
        el.muted = trackMuted(trackId);
        el.loop = clip.looped === true;
        // 音量 = クリップ音量 × レイヤー音量 × フェード（マスター音量は別段で乗算）
        const clipVol = ((clip.props.volume != null ? clip.props.volume : 100) / 100)
            * trackGain(trackId) * fadeFactor(clip, time);
        if (clip._gain) {
            // WebAudio 経由：100% を超えるゲインもかけられる
            clip._gain.gain.value = clipVol;
            el.volume = clampNum(state.volume, 0, 1);
        } else {
            el.volume = clampNum(state.volume * clipVol, 0, 1);
        }
        // 素材内の再生開始位置（分割・左トリムで進んだぶん）を加味する
        let local = (clip.offset || 0) + (time - clip.start) * rate;
        const dur = el.duration;
        if (clip.looped && isFinite(dur) && dur > 0) local = local % dur;   // ループ素材は周回位置へ
        const want = Math.max(0, isFinite(dur) ? Math.min(local, dur - 0.05) : local);
        if (playing) {
            if (Math.abs(el.currentTime - want) > 0.35) { try { el.currentTime = want; } catch (e) {} }
            if (el.paused) el.play().catch(() => {});
        } else {
            if (!el.paused) el.pause();
            try { el.currentTime = want; } catch (e) {}
        }
    }

    // 非アクティブなメディアを停止
    function pauseInactive(activeSet) {
        for (const c of state.clips) {
            if ((c.type === 'video' || c.type === 'audio') && c._el && !activeSet.has(c.id)) {
                if (!c._el.paused) c._el.pause();
            }
        }
    }

    // 全メディアを停止
    function pauseAllMedia() {
        for (const c of state.clips) {
            if (c._el && !c._el.paused) c._el.pause();
        }
    }

    // ---- トラックの表示/ミュート状態 ----
    function trackVisible(trackId) {
        const b = document.querySelector(`.track-header[data-track="${trackId}"] [data-act="hide"]`);
        return !(b && b.classList.contains('is-off'));
    }
    function trackMuted(trackId) {
        const b = document.querySelector(`.track-header[data-track="${trackId}"] [data-act="mute"]`);
        return !!(b && b.classList.contains('is-off'));
    }
    // レイヤー音量（YMM4 の LayerSettings.Volume）を 0〜2 の係数で返す
    function trackGain(trackId) {
        const t = TRACKS.find((x) => x.id === trackId);
        const v = t && isFinite(t.volume) ? t.volume : 100;
        return v / 100;
    }
    // 指定トラックの表示/非表示を切り替える
    function toggleTrackVisible(trackId) {
        const b = document.querySelector(`.track-header[data-track="${trackId}"] [data-act="hide"]`);
        if (b) { b.classList.toggle('is-off'); renderViewer(); }
    }
    // 指定トラックの表示状態を明示的に設定する
    function setTrackVisible(trackId, visible) {
        const b = document.querySelector(`.track-header[data-track="${trackId}"] [data-act="hide"]`);
        if (b) b.classList.toggle('is-off', !visible);
    }
    // すべてのトラックを表示する
    function showAllTracks() {
        TRACKS.forEach((t) => setTrackVisible(t.id, true));
        renderViewer();
        toast('すべてのレイヤーを表示しました');
    }
    // 指定トラック以外を非表示にする
    function hideOtherTracks(trackId) {
        TRACKS.forEach((t) => setTrackVisible(t.id, t.id === trackId));
        renderViewer();
        toast('他のレイヤーを非表示にしました');
    }
    // 指定トラック上のクリップをすべて削除する
    function clearTrackClips(trackId) {
        const targets = state.clips.filter((c) => c.track === trackId);
        if (!targets.length) { toast('このレイヤーにクリップはありません'); return; }
        targets.forEach((c) => { if (c._el) { try { c._el.pause(); } catch (e) {} } });
        if (targets.some((c) => c.id === state.selectedClipId)) state.selectedClipId = null;
        state.clips = state.clips.filter((c) => c.track !== trackId);
        renderClips();
        updateProps();
        recomputeDuration();
        renderViewer();
        toast('レイヤーのクリップを削除しました');
    }
    // 指定トラックの表示/ミュート状態を初期化する
    function resetTrackState(trackId) {
        setTrackVisible(trackId, true);
        const m = document.querySelector(`.track-header[data-track="${trackId}"] [data-act="mute"]`);
        if (m) m.classList.remove('is-off');
        renderViewer();
        toast('レイヤー設定を初期化しました');
    }

    // ======================================================
    // 再生コントロール
    // ======================================================
    let rafId = null;
    let lastTs = 0;
    let playStartPos = 0;   // 再生を開始した位置(秒)。停止ボタンでここへ戻る

    function togglePlay() {
        state.playing = !state.playing;
        // 再生/一時停止アイコンを切り替える（Tabler アイコン）
        els.btnPlay.innerHTML = state.playing
            ? '<i class="ti ti-fi ti-player-pause"></i>'
            : '<i class="ti ti-fi ti-player-play"></i>';
        if (state.playing) {
            playStartPos = state.playhead;   // 停止ボタンで戻る位置を覚えておく
            enterProgram();                  // 再生は常に合成モニターで
            els.viewerCanvas.classList.add('program');
            resumeAudioCtx();                // 自動再生制限の解除（ユーザー操作起点）
            lastTs = performance.now();
            composite(state.playhead, true); // 再生開始フレーム
            rafId = requestAnimationFrame(tick);
        } else {
            cancelAnimationFrame(rafId);
            pauseAllMedia();
            composite(state.playhead, false);
            savePlayhead();   // 停止位置をブラウザに保存
        }
    }

    function tick(ts) {
        if (!state.playing) return;
        const dt = (ts - lastTs) / 1000;
        lastTs = ts;
        state.playhead += dt * state.rate;   // プレビュー速度ぶんだけ進める
        if (state.playhead >= state.duration) {
            if (state.loop) {
                state.playhead = 0;
            } else {
                state.playhead = state.duration;
                togglePlay();
                composite(state.playhead, false);
                updatePlayhead();
                updateTimeDisplay();
                return;
            }
        }
        composite(state.playhead, true);
        updatePlayhead();
        updateTimeDisplay();
        if (state.playing) rafId = requestAnimationFrame(tick);
    }

    function seek(sec) {
        // コンテンツ末尾より先にも置けるようにタイムライン全長でクランプする
        // （末尾より先へ置いてからクリップを追加する操作を可能にする）
        state.playhead = Math.max(0, Math.min(sec, TIMELINE_SECONDS));
        enterProgram();
        updatePlayhead();
        updateTimeDisplay();
        composite(state.playhead, state.playing);
        savePlayhead();   // 再生ヘッド位置をブラウザに保存
    }

    // クリップの境界（開始・終了）位置を昇順で返す（前後のアイテムへの移動用）
    function clipBoundaries() {
        const set = new Set([0, state.duration]);
        state.clips.forEach((c) => { set.add(c.start); set.add(c.start + c.dur); });
        return Array.from(set).sort((a, b) => a - b);
    }

    // マウス位置が要素のスクロールバー上かどうかを判定する
    // （overflow:auto の要素はスクロールバーを掴んだときも要素自身に mousedown が届くため）
    function isOnScrollbar(el, e) {
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const bl = parseFloat(cs.borderLeftWidth) || 0;
        const bt = parseFloat(cs.borderTopWidth) || 0;
        const x = e.clientX - rect.left - bl;   // パディングボックス基準の座標
        const y = e.clientY - rect.top - bt;
        // clientWidth / clientHeight はスクロールバーを含まないので、それを超えたらバー上
        return x >= el.clientWidth || y >= el.clientHeight;
    }

    // タイムライン上のマウス位置から時間を求めてシークする（ドラッグ継続対応）
    function startScrub(e) {
        const scrub = (ev) => {
            const rect = els.tracksArea.getBoundingClientRect();
            const x = ev.clientX - rect.left + els.tracksArea.scrollLeft;
            seek(x / state.zoom);
        };
        scrub(e);
        const up = () => {
            document.removeEventListener('mousemove', scrub);
            document.removeEventListener('mouseup', up);
            document.body.classList.remove('is-scrubbing');
        };
        document.body.classList.add('is-scrubbing');
        document.addEventListener('mousemove', scrub);
        document.addEventListener('mouseup', up);
    }

    function updatePlayhead() {
        // 再生ヘッドは tracksArea 内の absolute 要素なので、
        // クリップやルーラーと同じコンテンツ座標（秒 × ズーム）をそのまま使う
        els.playhead.style.left = (state.playhead * state.zoom) + 'px';
        // 拡張レーン（TRIBE v2）が再生位置の値を出せるように知らせる
        document.dispatchEvent(new CustomEvent('auriga:playhead', {
            detail: { playhead: state.playhead },
        }));
    }

    function updateTimeDisplay() {
        els.curTime.textContent = formatTimecode(state.playhead);
        els.durTime.textContent = formatTimecode(state.duration);
    }

    // ======================================================
    // タイムコード
    // ======================================================
    function formatTimecode(sec) {
        const f = Math.floor((sec % 1) * FPS);
        const s = Math.floor(sec) % 60;
        const m = Math.floor(sec / 60) % 60;
        const h = Math.floor(sec / 3600);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
    }

    function formatRulerTime(sec) {
        const s = sec % 60;
        const m = Math.floor(sec / 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    // ======================================================
    // テーマ切り替え
    // ======================================================
    // 現在のテーマ・配色モードを保持する（モード切替時に同じテーマを再適用するため）
    let currentTheme = 'ymm4';
    let currentMode = DEFAULT_MODE;
    // OS の配色設定（モード=システムに準ずる のときに参照する）
    const darkMq = window.matchMedia('(prefers-color-scheme: dark)');

    // 実際にダーク配色を使うかどうかを解決する（system は OS 設定に従う）
    function isDarkMode() {
        if (currentMode === 'dark') return true;
        if (currentMode === 'light') return false;
        return darkMq.matches;   // system
    }

    // テーマを適用して保存する（themes/*.css を差し替えて配色を切り替える）
    function applyTheme(name, silent) {
        const theme = THEMES.includes(name) ? name : 'auriga';
        currentTheme = theme;
        // テーマごとの配色 CSS を読み込む link を差し替える。
        // 共通（モード非依存）の themes/<name>.css を先に、その上に
        // 配色モードに応じた themes/<name>-light.css または -dark.css を重ねる。
        const link = $('#themeLink');
        const variant = $('#themeVariantLink');
        const dark = isDarkMode();
        if (link) link.href = `themes/${theme}.css`;
        if (variant) variant.href = `themes/${theme}${dark ? '-dark' : '-light'}.css`;
        // 構造的なテーマ／モード判定が必要な箇所のために属性も維持する
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.mode = dark ? 'dark' : 'light';
        // 配色 CSS と対になるテーマ別 JavaScript も切り替える
        applyThemeScript(theme, !!silent);
        // テーマに対応するメニューバーへ差し替える（定義が変わるときだけ再生成）。
        // 配色モードの切替など、メニューキーが変わらない再適用では再読込しない。
        const menuKey = MENU_LAYOUTS[theme] ? theme : DEFAULT_MENU_LAYOUT;
        if (menuKey !== state.menuLayoutKey) loadMenuBar(menuKey);
        try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 保存不可でも継続 */ }
        syncThemeMenuChecks();
        if (!silent) toast(`テーマ：${THEME_LABELS[theme]}`);
    }

    // ロゴメニューのテーマ項目のチェック状態を現在のテーマに同期する
    function syncThemeMenuChecks() {
        THEME_MENU_ITEMS.forEach((it) => { it.checked = (it.id === `theme-${currentTheme}`); });
    }

    // 配色モード（ライト / ダーク / システムに準ずる）を設定し、現在のテーマを再適用する
    function applyMode(mode, silent) {
        currentMode = MODES.includes(mode) ? mode : DEFAULT_MODE;
        try { localStorage.setItem(MODE_KEY, currentMode); } catch (e) { /* 保存不可でも継続 */ }
        syncModeMenuChecks();
        applyTheme(currentTheme, true);   // 配色 CSS の -dark 切替を反映（トーストは抑制）
        if (!silent) toast(`表示モード：${MODE_LABELS[currentMode]}`);
    }

    // ロゴメニューの配色モード項目のチェック状態を現在のモードに同期する
    function syncModeMenuChecks() {
        MODE_MENU_ITEMS.forEach((it) => { it.checked = (it.id === `mode-${currentMode}`); });
    }

    // ======================================================
    // テーマ別 JavaScript（themes/<name>.js）の読み込みと切り替え
    // ======================================================
    // 配色は themes/<name>.css、振る舞い（DOM 操作など）は themes/<name>.js に分離する。
    // 各テーマ JS は window.registerTheme(name, { apply, cleanup }) で自身を登録する。
    const themeHooks = {};          // name -> { apply, cleanup }
    const themeScriptLoad = {};     // name -> Promise（スクリプトの多重読込を防ぐ）
    let activeThemeName = null;     // 現在 apply 済みのテーマ名

    // テーマ JS が apply/cleanup から使う共通 API。DOM 操作はここに集約する
    const themeCtx = {
        $, $$, toast,
        // ワークスペースタブのラベルを書き換える（ボタンの数は変えない）
        setWorkspaceTabs(labels) {
            $$('.ws-tab').forEach((t, i) => {
                if (labels[i] != null) t.textContent = labels[i];
            });
        },
        // ドキュメントタイトルの末尾（対応ソフト名）を設定する
        setTitleSuffix(suffix) {
            document.title = suffix ? `Auriga Studio — ${suffix}` : 'Auriga Studio — 動画編集';
        },
        // プロパティパネルの DOM をテーマが差し替えたあと、入力の購読をやり直す。
        // 差し替え前の要素に付いたリスナーは要素ごと捨てられるため、二重購読にはならない。
        rebindProps() {
            bindProps();
            updateProps();
        },
        // トランスポート操作の窓口（YMM4 テーマの再生コントロールが使う）
        transport: {
            playing: () => state.playing,
            playhead: () => state.playhead,
            duration: () => state.duration,
            // プロジェクトのフレームレート（動画出力ダイアログのフレーム換算が使う）
            fps: () => FPS,
            toggle() { togglePlay(); },
            // 停止：再生を止めて再生開始位置へ戻す（本家 YMM4 の停止ボタンと同じ挙動）
            stop() {
                if (state.playing) togglePlay();
                seek(playStartPos);
            },
            seek(sec) { seek(sec); },
            // プレビューの再生速度（0.25〜5 倍）。再生中でも次のフレームから反映される
            getRate: () => state.rate,
            setRate(r) { state.rate = clampNum(Number(r) || 1, 0.25, 5); },
            // 前後のアイテム境界（クリップの開始・終了）へ移動する
            prevItem() {
                const prev = clipBoundaries().filter((t) => t < state.playhead - 0.001).pop();
                if (prev != null) seek(prev);
            },
            nextItem() {
                const next = clipBoundaries().find((t) => t > state.playhead + 0.001);
                if (next != null) seek(next);
            },
        },
        // タイムライン操作の窓口（YMM4 テーマのタイムラインツールバーが使う）
        timeline: {
            // 素材を持たない種別（テキストなど）を既定レイヤーの再生ヘッド位置へ追加する
            addItem(type, name, dur) {
                addClip(type, name, DEFAULT_TRACK, state.playhead, dur || 3);
            },
        },
    };

    // テーマ JS からの登録窓口（テーマ JS は main.js より後に読み込まれる）
    window.registerTheme = (name, hooks) => { themeHooks[name] = hooks || {}; };

    // 拡張レーン（tribev2.js）が使う窓口。themeCtx と同じ考え方で、
    // タイムラインの座標と最小限の操作だけを渡す。
    window.aurigaTimeline = {
        toast,
        zoom: () => state.zoom,           // 1秒あたりの px
        seconds: () => TIMELINE_SECONDS,  // タイムライン全体の長さ(秒)
        playhead: () => state.playhead,
        seek: (sec) => seek(sec),
        selectedClip: () => getSelectedClip(),
    };

    // themes/<name>.js を一度だけ動的に読み込む
    function loadThemeScript(name) {
        if (themeScriptLoad[name]) return themeScriptLoad[name];
        themeScriptLoad[name] = new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = `themes/${name}.js`;
            s.onload = () => resolve(true);
            s.onerror = () => { console.warn(`テーマJSの読み込みに失敗: ${name}`); resolve(false); };
            document.head.appendChild(s);
        });
        return themeScriptLoad[name];
    }

    // 直前テーマの cleanup → 対象テーマの apply、の順で振る舞いを切り替える
    async function applyThemeScript(name, silent) {
        // 直前テーマの後始末（テーマ固有の DOM 状態を元に戻す）
        if (activeThemeName && activeThemeName !== name) {
            const prev = themeHooks[activeThemeName];
            try { prev && prev.cleanup && prev.cleanup(themeCtx); } catch (e) { console.warn(e); }
        }
        await loadThemeScript(name);
        const hooks = themeHooks[name];
        try { hooks && hooks.apply && hooks.apply(themeCtx, { silent }); } catch (e) { console.warn(e); }
        activeThemeName = name;
        // テーマ JS がステータスバー等を出し入れするとスナップ領域が変わるため、
        // 画面端に固定中の独立ウィンドウを計算し直す
        reclampFloats();
    }

    // 起動時に保存済みテーマ・配色モードを復元する（未保存ならテーマ=YMM4 / モード=ダーク）
    function applyStoredTheme() {
        // 配色モード（テーマより先に決める。applyTheme が -dark 切替を参照するため）
        let savedMode = DEFAULT_MODE;
        try { savedMode = localStorage.getItem(MODE_KEY) || DEFAULT_MODE; } catch (e) {}
        currentMode = MODES.includes(savedMode) ? savedMode : DEFAULT_MODE;
        syncModeMenuChecks();
        // OS の配色変更に追従する（モード=システムに準ずる のときだけ再適用）
        darkMq.addEventListener('change', () => {
            if (currentMode === 'system') applyTheme(currentTheme, true);
        });
        // テーマ
        let saved = 'ymm4';
        try { saved = localStorage.getItem(THEME_KEY) || 'ymm4'; } catch (e) {}
        applyTheme(saved, true);
    }

    // ======================================================
    // 解像度
    // ======================================================
    // 解像度（"1920 × 1080 (16:9)"）を適用する。silent=trueでトーストを抑制
    function applyResolution(v, silent) {
        const m = v.match(/(\d+)\s*[×x]\s*(\d+)/);
        if (m) {
            const w = +m[1], h = +m[2];
            resizeCompositor(w, h);
            // モニターのアスペクト比を解像度に合わせて固定（CSS変数で制御）
            els.viewerCanvas.style.setProperty('--ar-w', w);
            els.viewerCanvas.style.setProperty('--ar-h', h);
        }
        composite(state.playhead, state.playing);
        if (!silent) toast(`解像度: ${v}`);
    }

    // プロジェクトの解像度をモニターへ適用する（選択肢に同じ値があれば同期する）
    function applyProjectResolution(w, h) {
        if (!(w > 0 && h > 0)) return;
        resizeCompositor(w, h);
        els.viewerCanvas.style.setProperty('--ar-w', w);
        els.viewerCanvas.style.setProperty('--ar-h', h);
        const sel = $('#resSelect');
        if (sel) {
            const opt = Array.from(sel.options).find((o) => {
                const m = o.value.match(/(\d+)\s*[×x]\s*(\d+)/);
                return m && +m[1] === w && +m[2] === h;
            });
            if (opt) sel.value = opt.value;
        }
    }

    // プロジェクト座標(px)→キャンバス座標(px)の倍率（プロジェクト未読込時は 1）
    function projScale() {
        return els.compositor.width / (state.projectWidth || els.compositor.width);
    }

    // ======================================================
    // ブラウザに保存した状態の復元
    // ======================================================
    // 解像度・再生ヘッド位置を localStorage から復元する（モード=テーマは別途復元済み）
    function restorePersistedState() {
        // 解像度：保存値が選択肢にあれば反映する
        try {
            const res = localStorage.getItem(RES_KEY);
            const sel = $('#resSelect');
            if (res && sel && Array.from(sel.options).some((o) => o.value === res)) {
                sel.value = res;
                applyResolution(res, true);
            }
        } catch (e) {}
        // 再生ヘッド位置：尺の範囲内なら復元する
        try {
            const ph = parseFloat(localStorage.getItem(PLAYHEAD_KEY));
            if (Number.isFinite(ph) && ph > 0) seek(ph);
        } catch (e) {}
    }

    // 再生ヘッド位置をブラウザに保存する
    function savePlayhead() {
        try { localStorage.setItem(PLAYHEAD_KEY, String(state.playhead)); } catch (e) {}
    }

    // ======================================================
    // パネルの表示/非表示（ツールメニューのチェックリスト）
    // ======================================================
    // ツールメニューの項目 id → 対象パネルと、空いた領域を詰めるための body クラス。
    // 詰め方はテーマごとにレイアウトが違うので、body クラスを見て CSS 側（style.css /
    // themes/ymm4.css）が調整する。
    const TOGGLEABLE_PANELS = {
        preview: { selector: '.stage',        bodyClass: 'is-no-preview', label: 'プレビュー' },
        items:   { selector: '.panel--props', bodyClass: 'is-no-items',   label: 'アイテム' },
    };

    // 現在の表示状態を DOM（パネルと body クラス）へ反映する
    function applyPanelVisibility() {
        Object.keys(TOGGLEABLE_PANELS).forEach((id) => {
            const def = TOGGLEABLE_PANELS[id];
            const el = $(def.selector);
            const visible = state.panels[id] !== false;
            if (el) el.classList.toggle('is-hidden', !visible);
            // 非表示のときだけでなく、独立ウィンドウ中・自動的に隠す中もドックの空きを詰める
            document.body.classList.toggle(def.bodyClass, !visible || isPanelFloating(id) || isPanelAutoHidden(id));
        });
        // メニュー側のチェック（ロゴメニュー「パネル」・メニューバーのツール）を追従させる
        syncPanelMenuChecks(PANEL_MENU_ITEMS);
        syncPanelMenuChecks(menuBarMenus);
        updatePanelTools();
    }

    // パネルの表示/非表示を切り替える（ツールメニューのチェックから呼ぶ）
    function setPanelVisible(id, visible) {
        const def = TOGGLEABLE_PANELS[id];
        if (!def) return;
        state.panels[id] = !!visible;
        // 隠すときは「自動的に隠す」も解除する（タブだけ残ると戻し方が分からなくなるため）
        if (!visible && isPanelAutoHidden(id)) setPanelAutoHide(id, false, true);
        applyPanelVisibility();
        savePanelVisibility();
        // プレビューを出し直したときは表示サイズが変わっているので描き直す
        if (id === 'preview' && state.panels[id]) composite(state.playhead, false);
        toast(`${def.label}を${state.panels[id] ? '表示' : '非表示'}にしました`);
    }

    // 表示状態をブラウザに保存する
    function savePanelVisibility() {
        try { localStorage.setItem(PANELS_KEY, JSON.stringify(state.panels)); } catch (e) {}
    }

    // 保存済みの表示状態を復元して反映する
    function restorePanelVisibility() {
        try {
            const saved = JSON.parse(localStorage.getItem(PANELS_KEY)) || {};
            Object.keys(TOGGLEABLE_PANELS).forEach((id) => {
                if (typeof saved[id] === 'boolean') state.panels[id] = saved[id];
            });
        } catch (e) { /* 壊れた保存値は既定値のまま無視する */ }
        applyPanelVisibility();
    }

    // 読み込んだメニュー定義のチェック状態を、現在の表示状態に合わせる（再帰）
    function syncPanelMenuChecks(items) {
        (items || []).forEach((it) => {
            if (!it) return;
            if (it.type === 'checkbox' && TOGGLEABLE_PANELS[it.id]) {
                it.checked = state.panels[it.id] !== false;
            }
            if (it.items) syncPanelMenuChecks(it.items);
        });
    }

    // ======================================================
    // UI バインド
    // ======================================================
    function bindUI() {
        bindProps();
        bindContextMenu();
        bindMenuBar();
        bindAboutModal();   // バージョン情報モーダルの開閉
        bindAccountMenu();   // アカウント情報ポップオーバーの開閉
        bindMobileMenu();   // スマホ幅でヘッダー操作をネストする
        bindTimelineResizer();   // タイムラインの高さをドラッグで調整
        bindItemsResizer();   // アイテムパネルの幅をドラッグで調整
        bindFloatingPanels();   // プレビュー / アイテム / タイムラインの独立ウィンドウ化
        bindAutoHidePanels();   // プレビュー / アイテムを画面端のタブへ畳む（自動的に隠す）

        // ファイルがトラック外に落ちてもブラウザがファイルを開かないようにする
        ['dragover', 'drop'].forEach((evt) => {
            window.addEventListener(evt, (e) => {
                if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
                    e.preventDefault();
                }
            });
        });
        // タイムライン全体（ルーラー含む）でドロップを視覚的に許可
        els.tracksArea.addEventListener('dragover', (e) => {
            if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
        });

        // 左パネルのタブ切替
        $$('.panel--media .ptab').forEach((tab) => {
            tab.addEventListener('click', () => activateMediaTab(tab.dataset.tab));
        });

        // クラウドの「更新」ボタン
        $('#btnCloudRefresh').addEventListener('click', () => fetchCloudFiles(false));

        // YMM4 素材の不足ファイルダイアログ
        const dismissRelink = () => {
            relinkDismissed = true;
            closeRelinkModal();
        };
        const btnRelinkDir = $('#btnRelinkDir');
        if (btnRelinkDir) btnRelinkDir.addEventListener('click', startRelinkDirectorySearch);
        const btnRelinkApply = $('#btnRelinkApply');
        if (btnRelinkApply) btnRelinkApply.addEventListener('click', applyRelink);
        const btnRelinkCancel = $('#btnRelinkCancel');
        if (btnRelinkCancel) btnRelinkCancel.addEventListener('click', dismissRelink);
        const relinkClose = $('#relinkClose');
        if (relinkClose) relinkClose.addEventListener('click', dismissRelink);
        const relinkBackdrop = document.querySelector('#relinkModal [data-relink-close]');
        if (relinkBackdrop) relinkBackdrop.addEventListener('click', dismissRelink);

        // ワークスペースタブ
        $$('.ws-tab').forEach((t) => t.addEventListener('click', () => {
            $$('.ws-tab').forEach((x) => x.classList.remove('is-active'));
            t.classList.add('is-active');
            toast(`${t.textContent}ワークスペース`);
        }));

        // ツール切替
        $$('.tl-tool').forEach((t) => t.addEventListener('click', () => {
            $$('.tl-tool').forEach((x) => x.classList.remove('is-active'));
            t.classList.add('is-active');
            state.tool = t.dataset.tool;
        }));

        // トランスポート
        els.btnPlay.addEventListener('click', togglePlay);
        $('#btnStart').addEventListener('click', () => seek(0));
        $('#btnEnd').addEventListener('click', () => seek(state.duration));
        $('#btnPrev').addEventListener('click', () => seek(state.playhead - 1 / FPS));
        $('#btnNext').addEventListener('click', () => seek(state.playhead + 1 / FPS));
        $('#btnLoop').addEventListener('click', (e) => {
            state.loop = !state.loop;
            e.currentTarget.classList.toggle('is-active', state.loop);
            toast(state.loop ? 'ループ ON' : 'ループ OFF');
        });

        // ズーム
        $('#zoom').addEventListener('input', (e) => {
            state.zoom = Number(e.target.value);
            renderRuler();
            renderTracks();   // 幅更新 + ドロップ再バインド
            renderClips();
            updatePlayhead();
        });

        // タイムラインの空白をクリック/ドラッグで連続シーク（スクラブ）
        els.tracksArea.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;   // 右クリックは無視
            // スクロールバーを掴んだときはシークしない（再生位置がずれるのを防ぐ）
            if (isOnScrollbar(els.tracksArea, e)) return;
            if (e.target.closest('.clip')) return;
            // 赤線（再生ヘッド）上は専用ハンドラに任せる
            if (e.target.closest('.playhead')) return;
            selectClip(null);   // 空白クリックで選択解除
            startScrub(e);
        });

        // シーク赤線をどこでも掴んでドラッグできるようにする
        els.playhead.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            startScrub(e);
        });
        // 縦スクロールをレイヤーヘッダー側にも反映する（再生ヘッドはコンテンツと一緒にスクロールする）
        els.tracksArea.addEventListener('scroll', () => {
            els.trackHeaders.scrollTop = els.tracksArea.scrollTop;
        });

        // ルーラードラッグでスクラブ
        els.ruler.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            startScrub(e);
        });

        // ツールバーアクション
        $('#btnSplit').addEventListener('click', () => {
            const c = getSelectedClip();
            if (c) splitClipAt(c, state.playhead);
            else toast('分割するクリップを選択してください');
        });
        $('#btnDelete').addEventListener('click', deleteSelected);
        $('#btnUndo').addEventListener('click', () => toast('元に戻す（デモ）'));
        $('#btnRedo').addEventListener('click', () => toast('やり直し（デモ）'));

        // ヘッダーボタン
        $('#btnImport').addEventListener('click', () => $('#fileInput').click());
        $('#fileInput').addEventListener('change', handleFileImport);

        // 解像度切替
        $('#resSelect').addEventListener('change', (e) => {
            applyResolution(e.target.value);
            // 選択した解像度をブラウザに保存する
            try { localStorage.setItem(RES_KEY, e.target.value); } catch (err) {}
        });

        // 音量（マスター）。クリップ音量・レイヤー音量は composite → syncAV が反映する
        $('#volume').addEventListener('input', (e) => {
            state.volume = Number(e.target.value) / 100;
            if (state.monitorMode === 'program') composite(state.playhead, state.playing);
            // ソースモニターのプレビューにも反映
            els.previewVideo.volume = state.volume;
        });

        // キーボードショートカット
        document.addEventListener('keydown', (e) => {
            // 入力中の要素ではショートカットを無効にする
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

            // Ctrl / Cmd の組み合わせ（コンテキストメニューと対応）
            if (e.ctrlKey || e.metaKey) {
                const c = getSelectedClip();
                switch (e.code) {
                    case 'KeyS': e.preventDefault(); toast('プロジェクトを保存しました 💾'); return;
                    case 'KeyD': e.preventDefault(); if (c) duplicateClip(c); return;
                    case 'KeyC': if (c) copyClip(c); return;
                    case 'KeyV': e.preventDefault();
                        if (state.clipboard) {
                            const tr = c ? c.track : DEFAULT_TRACK;
                            pasteClip(tr, state.playhead);
                        }
                        return;
                }
                return;
            }

            switch (e.code) {
                case 'Space': e.preventDefault(); togglePlay(); break;
                case 'Delete': case 'Backspace': deleteSelected(); break;
                case 'KeyV': setTool('select'); break;
                case 'KeyC': setTool('cut'); break;
                case 'KeyH': setTool('hand'); break;
                case 'ArrowLeft': seek(state.playhead - 1 / FPS); break;
                case 'ArrowRight': seek(state.playhead + 1 / FPS); break;
                case 'Home': seek(0); break;
                case 'End': seek(state.duration); break;
            }
        });
    }

    function setTool(tool) {
        state.tool = tool;
        $$('.tl-tool').forEach((x) => x.classList.toggle('is-active', x.dataset.tool === tool));
    }

    function handleFileImport(e) {
        const files = Array.from(e.target.files || []);
        // 登録時に尺の読み取り・バッジ反映まで行われる
        files.forEach((f) => registerMedia(f));
        renderMedia();
        if (files.length) toast(`${files.length}件のメディアを読み込みました`);
        e.target.value = '';
    }

    // ======================================================
    // コンテキストメニュー（右クリック）
    // ======================================================
    const ctxEl = document.createElement('div');
    ctxEl.className = 'ctxmenu';
    document.body.appendChild(ctxEl);

    function hideContextMenu() {
        ctxEl.classList.remove('is-open');
    }

    // items: [{icon,label,key,action,danger,disabled} | {separator:true}]
    function showContextMenu(x, y, items, header) {
        let html = header ? `<div class="ctxmenu__header">${escapeHtml(header)}</div>` : '';
        items.forEach((it, i) => {
            if (it.separator) { html += '<div class="ctxmenu__sep"></div>'; return; }
            const cls = 'ctxmenu__item'
                + (it.danger ? ' ctxmenu__item--danger' : '')
                + (it.disabled ? ' is-disabled' : '');
            html += `<div class="${cls}" data-idx="${i}">
                <span class="ctxmenu__icon">${it.icon || ''}</span>
                <span class="ctxmenu__label">${it.label}</span>
                ${it.key ? `<span class="ctxmenu__key">${it.key}</span>` : ''}
            </div>`;
        });
        ctxEl.innerHTML = html;

        // 表示してから画面端を考慮して位置補正
        ctxEl.classList.add('is-open');
        const rect = ctxEl.getBoundingClientRect();
        const px = Math.min(x, window.innerWidth - rect.width - 8);
        const py = Math.min(y, window.innerHeight - rect.height - 8);
        ctxEl.style.left = Math.max(4, px) + 'px';
        ctxEl.style.top = Math.max(4, py) + 'px';

        ctxEl.querySelectorAll('.ctxmenu__item').forEach((el) => {
            el.addEventListener('click', () => {
                const it = items[+el.dataset.idx];
                hideContextMenu();
                if (it && it.action && !it.disabled) it.action();
            });
        });
    }

    function bindContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            const clipEl = e.target.closest('.clip');
            const headerEl = e.target.closest('.track-header');
            const mediaEl = e.target.closest('.media-item');
            const trackEl = e.target.closest('.track');
            const viewerEl = e.target.closest('.viewer__canvas');

            if (clipEl) {
                e.preventDefault();
                const clip = state.clips.find((c) => c.id === clipEl.dataset.clip);
                if (clip) { selectClip(clip.id); showClipMenu(e.clientX, e.clientY, clip); }
            } else if (headerEl) {
                e.preventDefault();
                const t = TRACKS.find((x) => x.id === headerEl.dataset.track);
                if (t) showTrackHeaderMenu(e.clientX, e.clientY, t);
            } else if (mediaEl) {
                e.preventDefault();
                const m = MEDIA.find((x) => x.id === mediaEl.dataset.media);
                if (m) showMediaMenu(e.clientX, e.clientY, m);
            } else if (trackEl) {
                e.preventDefault();
                showTimelineMenu(e.clientX, e.clientY, trackEl, e);
            } else if (viewerEl) {
                e.preventDefault();
                showViewerMenu(e.clientX, e.clientY);
            }
            // それ以外（入力欄など）はブラウザ標準メニューを許可
        });

        // メニューを閉じる操作
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.ctxmenu')) hideContextMenu();
        });
        document.addEventListener('scroll', hideContextMenu, true);
        window.addEventListener('blur', hideContextMenu);
        window.addEventListener('resize', hideContextMenu);
        document.addEventListener('keydown', (e) => { if (e.code === 'Escape') hideContextMenu(); });
    }

    // ---- クリップ用メニュー ----
    function showClipMenu(x, y, clip) {
        showContextMenu(x, y, [
            { icon: '✂', label: '再生ヘッドで分割', key: 'S', action: () => splitClipAt(clip, state.playhead) },
            { icon: '⧉', label: '複製', key: 'Ctrl+D', action: () => duplicateClip(clip) },
            { icon: '⎘', label: 'コピー', key: 'Ctrl+C', action: () => copyClip(clip) },
            { separator: true },
            { icon: '◀', label: '先頭を再生ヘッドへ', action: () => { clip.start = Math.round(state.playhead * 10) / 10; renderClips(); recomputeDuration(); } },
            { icon: '🔈', label: '無音/再生（トラック）', action: () => toggleTrackMute(clip.track) },
            { separator: true },
            { icon: '🗑', label: '削除', key: 'Del', danger: true, action: deleteSelected },
        ], clip.name);
    }

    // ---- メディアプール用メニュー ----
    function showMediaMenu(x, y, m) {
        showContextMenu(x, y, [
            { icon: '🖥', label: 'モニターに表示', action: () => showInMonitor(m) },
            { icon: '＋', label: 'タイムラインに追加', action: () => addClipToBestTrack(m) },
            { separator: true },
            { icon: '✏', label: '名前を変更', action: () => renameMedia(m) },
            { icon: '🗑', label: 'プールから削除', danger: true, action: () => deleteMedia(m) },
        ], m.name);
    }

    // ---- タイムライン空白用メニュー ----
    function showTimelineMenu(x, y, trackEl, e) {
        const rect = trackEl.getBoundingClientRect();
        const dropX = e.clientX - rect.left + els.tracksArea.scrollLeft;
        const at = Math.max(0, Math.round((dropX / state.zoom) * 10) / 10);
        showContextMenu(x, y, [
            { icon: '📋', label: 'ここに貼り付け', key: 'Ctrl+V', disabled: !state.clipboard,
              action: () => pasteClip(trackEl.dataset.track, at) },
            { icon: '🅰', label: 'ここにテキストを追加',
              action: () => addClip('text', 'テキスト', trackEl.dataset.track, at, 3, false) },
            { separator: true },
            { icon: '⏱', label: 'ここへ再生ヘッドを移動', action: () => seek(at) },
            { icon: '🔍', label: 'ズームをリセット', action: () => { $('#zoom').value = 60; $('#zoom').dispatchEvent(new Event('input')); } },
        ], 'タイムライン');
    }

    // ---- トラックヘッダー（タイムラインソース）用メニュー ----
    function showTrackHeaderMenu(x, y, t) {
        const visible = trackVisible(t.id);
        const muted = trackMuted(t.id);
        showContextMenu(x, y, [
            { icon: visible ? '✓' : '', label: '表示', action: () => toggleTrackVisible(t.id) },
            { icon: muted ? '🔇' : '🔈', label: muted ? 'ミュートを解除' : 'ミュート', action: () => toggleTrackMute(t.id) },
            { separator: true },
            { icon: '📋', label: 'ここに貼り付け', key: 'Ctrl+V', disabled: !state.clipboard,
              action: () => pasteClip(t.id, Math.round(state.playhead * 10) / 10) },
            { icon: '🗑', label: 'このレイヤーのクリップを削除', danger: true, action: () => clearTrackClips(t.id) },
            { separator: true },
            { icon: '👁', label: 'すべてのレイヤーを表示', action: showAllTracks },
            { icon: '🙈', label: '他のレイヤーを非表示', action: () => hideOtherTracks(t.id) },
            { separator: true },
            { icon: '↺', label: 'レイヤー設定を初期化', action: () => resetTrackState(t.id) },
        ], t.label);
    }

    // ---- モニター用メニュー ----
    function showViewerMenu(x, y) {
        showContextMenu(x, y, [
            { icon: state.playing ? '⏸' : '▶', label: state.playing ? '一時停止' : '再生', key: 'Space', action: togglePlay },
            { icon: '⏮', label: '先頭へ', action: () => seek(0) },
            { separator: true },
            { icon: '🖼', label: '現在フレームを保存', action: saveFrame },
        ], 'プログラムモニター');
    }

    // ---- アクション ----
    function duplicateClip(clip) {
        const c = addClip(clip.type, clip.name, clip.track, clip.start + clip.dur, clip.dur, true, clip.src);
        c.props = { ...clip.props };
        c.offset = clip.offset || 0;
        copyClipExtras(clip, c);
        renderClips();
        selectClip(c.id);
        toast('クリップを複製しました');
    }

    function copyClip(clip) {
        const cb = { type: clip.type, name: clip.name, src: clip.src, dur: clip.dur, offset: clip.offset || 0, props: { ...clip.props } };
        copyClipExtras(clip, cb);   // 付加情報（書式・エフェクト等）もクリップボードへ
        state.clipboard = cb;
        toast('クリップをコピーしました');
    }

    function pasteClip(track, at) {
        const cb = state.clipboard;
        if (!cb) { toast('コピーされたクリップがありません'); return; }
        const dest = TRACKS.find((t) => t.id === track) ? track : DEFAULT_TRACK;
        const c = addClip(cb.type, cb.name, dest, at, cb.dur, true, cb.src);
        c.props = { ...cb.props };
        c.offset = cb.offset || 0;
        copyClipExtras(cb, c);
        renderClips();
        selectClip(c.id);
        toast('クリップを貼り付けました');
    }

    function toggleTrackMute(trackId) {
        const b = document.querySelector(`.track-header[data-track="${trackId}"] [data-act="mute"]`);
        if (b) { b.classList.toggle('is-off'); renderViewer(); }
    }

    function renameMedia(m) {
        const name = prompt('新しい名前を入力', m.name);
        if (name && name.trim()) { m.name = name.trim(); renderMedia(); toast('名前を変更しました'); }
    }

    function deleteMedia(m) {
        const idx = MEDIA.findIndex((x) => x.id === m.id);
        if (idx >= 0) MEDIA.splice(idx, 1);
        if (state.selectedMediaId === m.id) { state.selectedMediaId = null; state.monitorSource = null; }
        renderMedia();
        toast('メディアをプールから削除しました');
    }

    function saveFrame() {
        try {
            let url;
            if (pixi) {
                // Pixi のステージを画像へ書き出す（WebGPU でも確実にピクセルを取れる）
                const frame = new PIXI.Rectangle(0, 0, els.compositor.width, els.compositor.height);
                url = pixi.renderer.extract.canvas({ target: pixi.stage, frame }).toDataURL('image/png');
            } else {
                url = els.compositor.toDataURL('image/png');
            }
            const a = document.createElement('a');
            a.href = url; a.download = `frame_${formatTimecode(state.playhead).replace(/:/g, '-')}.png`;
            a.click();
            toast('現在フレームを保存しました 🖼');
        } catch (e) { toast('フレームの保存に失敗しました'); }
    }

    // ======================================================
    // メニューバー（menu_layout から動的生成）
    // ======================================================
    // ドロップダウンを格納するレイヤー（クリックは各パネルだけが受ける）
    const menuLayer = document.createElement('div');
    menuLayer.className = 'appmenu-layer';
    document.body.appendChild(menuLayer);

    let activeMenuId = null;   // 現在開いているトップメニューの id
    let menuBarMenus = [];     // 現在のメニューバー定義（スマホパネルの再構築に使う）

    // 配色モード（ライト / ダーク / システムに準ずる）のラジオ項目。
    // チェック状態は syncModeMenuChecks() が現在のモードに同期する。
    const MODE_MENU_ITEMS = MODES.map((m) => ({
        id: `mode-${m}`, type: 'radio', group: 'display-mode',
        label: MODE_LABELS[m], checked: false,
    }));

    // テーマ（対応ソフト風の配色セット）のラジオ項目。
    // チェック状態は syncThemeMenuChecks() が現在のテーマに同期する。
    const THEME_MENU_ITEMS = THEMES.map((t) => ({
        id: `theme-${t}`, type: 'radio', group: 'app-theme',
        label: THEME_LABELS[t], checked: false,
    }));

    // パネルの表示/非表示（プレビュー・アイテム）のチェック項目。
    // メニューバー側の定義はテーマごとに有無が違うので、テーマ非依存のロゴメニューにも置いて
    // 「非表示」にしたパネルをどのテーマからでも戻せるようにする。
    // チェック状態は applyPanelVisibility() が現在の表示状態に同期する。
    const PANEL_MENU_ITEMS = Object.keys(TOGGLEABLE_PANELS).map((id) => ({
        id, type: 'checkbox', label: TOGGLEABLE_PANELS[id].label, checked: true,
    }));

    // ロゴ文字のメニュー（全テーマ共通のアプリメニュー）。
    // メニューバーは対応ソフトごとに切り替わるが、これはテーマに依存せず常に同じ内容。
    const LOGO_MENU = {
        id: '__logo__',
        items: [
            { id: 'about',             label: 'Auriga Studio について', icon: 'info-circle' },
            { id: 'whats-new',         label: '新着情報',               icon: 'sparkles' },
            { type: 'separator' },
            { id: 'export-project',    label: 'エクスポート',           icon: 'package-export', type: 'submenu', items: [
                { id: 'export-auriproj', label: 'プロジェクトのみ (.auriproj)', icon: 'file-description' },
                { id: 'export-auripack', label: 'フルエクスポート (.auripack)', icon: 'file-zip' },
            ] },
            { id: 'import-project',    label: 'インポート…',           icon: 'package-import' },
            { type: 'separator' },
            { id: 'panels',            label: 'パネル',                 icon: 'layout-board-split', type: 'submenu', items: PANEL_MENU_ITEMS },
            { id: 'theme',             label: 'テーマ',                 icon: 'palette',  type: 'submenu', items: THEME_MENU_ITEMS },
            { id: 'display-mode',      label: '表示モード',             icon: 'sun-moon', type: 'submenu', items: MODE_MENU_ITEMS },
            { id: 'preferences',       label: '環境設定…',             icon: 'settings',  shortcut: 'Ctrl+,' },
            { id: 'keyboard-shortcuts', label: 'キーボードショートカット', icon: 'keyboard' },
            { type: 'separator' },
            { id: 'check-updates',     label: 'アップデートを確認…',   icon: 'refresh' },
            { id: 'website',           label: '公式サイトを開く',       icon: 'world' },
            { type: 'separator' },
            { id: 'quit',              label: '終了',                  icon: 'power',     shortcut: 'Ctrl+Q' },
        ],
    };

    // メニュー定義を読み込んでバーを生成する
    async function loadMenuBar(key) {
        const path = MENU_LAYOUTS[key] || MENU_LAYOUTS[DEFAULT_MENU_LAYOUT];
        try {
            const res = await fetch(path);
            if (!res.ok) throw new Error('fetch failed');
            const layout = await res.json();
            state.menuLayoutKey = key;
            // 定義ファイルの checked は初期値なので、現在のパネル表示状態で上書きする
            syncPanelMenuChecks(layout && layout.menus);
            renderMenuBar(layout);
        } catch (e) {
            // 読み込み失敗時は最小限のフォールバックを表示
            renderMenuBar({ menus: [
                { id: 'file', label: 'ファイル', items: [] },
                { id: 'edit', label: '編集', items: [] },
                { id: 'help', label: 'ヘルプ', items: [] },
            ] });
            toast('メニュー定義の読み込みに失敗しました');
        }
    }

    // トップレベルのメニューボタンを生成する
    function renderMenuBar(layout) {
        // id を持つ項目だけを描画対象にする（未整備テーマの空スタブで壊れたボタンを出さない）
        const menus = (((layout && layout.menus) || []).filter((m) => m && m.id));
        closeMenuBar();
        els.appMenu.innerHTML = menus.map((m) =>
            `<button class="menu__item" data-menu="${m.id}">${iconHtml(m.icon)}<span>${labelHtml(m)}</span></button>`
        ).join('');

        els.appMenu.querySelectorAll('.menu__item').forEach((btn) => {
            const menu = menus.find((m) => m.id === btn.dataset.menu);
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeMenuId === menu.id) { closeMenuBar(); return; }
                openTopMenu(btn, menu);
            });
            // 開いている間は他のメニューにマウスを移すだけで切り替わる（ネイティブ風）
            btn.addEventListener('mouseenter', () => {
                if (activeMenuId && activeMenuId !== menu.id) openTopMenu(btn, menu);
            });
        });

        // スマホパネルの1階層目も同じ定義から作り直す
        menuBarMenus = menus;
        renderMobilePanelMenu();
    }

    // スマホパネルの1階層目を、2階層目と同じ見た目（.appmenu 部品）で組み立てる
    function renderMobilePanelMenu() {
        const panel = $('#mobilePanel');
        if (!panel) return;
        const box = document.createElement('div');
        box.className = 'appmenu';
        menuBarMenus.forEach((menu, i) => {
            // 項目ごとに区切り線を入れる（ドロップダウンと同じ部品を使う）
            if (i > 0) {
                const sep = document.createElement('div');
                sep.className = 'appmenu__sep';
                box.appendChild(sep);
            }
            const row = document.createElement('div');
            row.className = 'appmenu__item has-sub';
            row.innerHTML = `
                <span class="appmenu__icon">${iconHtml(menu.icon)}</span>
                <span class="appmenu__label">${labelHtml(menu)}</span>
                <span class="appmenu__key"></span>
                <span class="appmenu__arrow"><i class="ti ti-chevron-right"></i></span>`;
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeMenuId === menu.id) { closeMenuBar(); return; }
                openTopMenu(row, menu);
            });
            // 開いている間は他のメニューにマウスを移すだけで切り替わる（ネイティブ風）
            row.addEventListener('mouseenter', () => {
                if (activeMenuId && activeMenuId !== menu.id) openTopMenu(row, menu);
            });
            box.appendChild(row);
        });
        panel.replaceChildren(box);
    }

    // トップメニューを開く
    function openTopMenu(btn, menu) {
        closeMenuBar();
        activeMenuId = menu.id;
        // is-open はスマホパネルの .appmenu__item 用（ドロップダウンと同じ選択色にする）
        btn.classList.add('is-active', 'is-open');
        const panel = buildPanel(menu.items || [], 0);
        menuLayer.appendChild(panel);
        const r = btn.getBoundingClientRect();
        // スマホパネル内から開いたときは、階層が分かるよう少し右にずらす
        const indent = btn.closest('.mobile-panel') ? 16 : 0;
        positionPanel(panel, r.left + indent, r.bottom + 2);
    }

    // すべてのドロップダウンを閉じる
    function closeMenuBar() {
        menuLayer.innerHTML = '';
        activeMenuId = null;
        els.appMenu.querySelectorAll('.menu__item').forEach((b) => b.classList.remove('is-active', 'is-open'));
        // スマホパネルの1階層目のハイライトも消す
        const mp = $('#mobilePanel');
        if (mp) mp.querySelectorAll('.appmenu__item').forEach((b) => b.classList.remove('is-active', 'is-open'));
        // パネルのツールメニューボタンの押下状態も戻す
        $$('.panel-tool').forEach((b) => b.classList.remove('is-active', 'is-open'));
        const logo = $('#appLogoMenu');
        if (logo) logo.classList.remove('is-active');
    }

    // ロゴ文字のメニューを開閉できるようにバインドする
    function bindLogoMenu() {
        const logo = $('#appLogoMenu');
        if (!logo) return;
        logo.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeMenuId === LOGO_MENU.id) { closeMenuBar(); return; }
            openTopMenu(logo, LOGO_MENU);
        });
        // 他のメニューが開いている間はホバーで切り替わる（ネイティブ風）
        logo.addEventListener('mouseenter', () => {
            if (activeMenuId && activeMenuId !== LOGO_MENU.id) openTopMenu(logo, LOGO_MENU);
        });
    }

    // dynamic ソースの実エントリ（将来データを差し込む。未対応ソースは空配列）
    const DYNAMIC_MENU_DATA = {};
    function dynamicItems(source) {
        return DYNAMIC_MENU_DATA[source] || [];
    }

    // dynamic 項目を実エントリへ展開する（中身が無い dynamic は消える）
    function expandItems(items) {
        const out = [];
        (items || []).forEach((it) => {
            if (it.type === 'dynamic') out.push(...dynamicItems(it.source));
            else out.push(it);
        });
        return out;
    }

    // サブメニューに表示できる中身があるか（区切り線だけ・空の dynamic だけは「なし」とみなす）
    function hasMenuContent(items) {
        return expandItems(items).some((it) => it.type !== 'separator');
    }

    // 1 枚のパネル（メニュー/サブメニュー）を組み立てる
    function buildPanel(items, level) {
        const panel = document.createElement('div');
        panel.className = 'appmenu' + (level > 0 ? ' appmenu--sub' : '');
        panel.dataset.level = level;
        // dynamic を実データへ展開してから描画する（空の dynamic はここで消える）
        const expanded = expandItems(items);
        if (!expanded.length) {
            const empty = document.createElement('div');
            empty.className = 'appmenu__empty';
            empty.textContent = '（項目がありません）';
            panel.appendChild(empty);
            return panel;
        }
        expanded.forEach((it) => panel.appendChild(buildMenuItem(it, level, expanded)));
        return panel;
    }

    // メニュー項目 1 行を組み立てる
    function buildMenuItem(it, level, siblings) {
        if (it.type === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'appmenu__sep';
            return sep;
        }
        const el = document.createElement('div');
        // サブメニューでも、表示できる中身が無ければネストせず普通の項目として描く
        // （＞矢印を出さず、子パネルも開かず、「～ありません」も表示しない）
        const hasSub = it.type === 'submenu' && hasMenuContent(it.items || []);
        const isToggle = it.type === 'radio' || it.type === 'checkbox';
        const checked = isToggle && !!it.checked;
        el.className = 'appmenu__item'
            + (hasSub ? ' has-sub' : '')
            + (checked ? ' is-checked' : '');

        // 左側のアイコン枠：checkbox / radio はアイコンを出さず、
        // チェック中ならチェックアイコンをここ（左端）に置く。
        let iconSlot;
        if (isToggle) {
            iconSlot = checked ? '<i class="ti ti-check"></i>' : '';
        } else {
            iconSlot = iconHtml(it.icon);
        }

        // 右側：ショートカットのみ（チェックは左へ移動した）
        const keyHtml = it.shortcut ? escapeHtml(it.shortcut) : '';

        el.innerHTML = `
            <span class="appmenu__icon">${iconSlot}</span>
            <span class="appmenu__label">${labelHtml(it)}</span>
            <span class="appmenu__key">${keyHtml}</span>
            <span class="appmenu__arrow">${hasSub ? '<i class="ti ti-chevron-right"></i>' : ''}</span>`;

        // ホバー：この階層より深いパネルを閉じ、同階層の開閉状態をリセット
        el.addEventListener('mouseenter', () => {
            closeDeeperPanels(level);
            const panel = el.closest('.appmenu');
            panel.querySelectorAll(':scope > .appmenu__item.is-open')
                .forEach((s) => s.classList.remove('is-open'));
            if (hasSub) {
                const child = buildPanel(it.items || [], level + 1);
                menuLayer.appendChild(child);
                const r = el.getBoundingClientRect();
                positionPanel(child, r.right - 4, r.top - 5);
                el.classList.add('is-open');
            }
        });

        // クリック可能な項目（サブメニューの親はクリックしても閉じない）
        if (!hasSub) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (it.type === 'radio' && it.group) {
                    siblings.forEach((s) => { if (s.group === it.group) s.checked = (s === it); });
                } else if (it.type === 'checkbox') {
                    it.checked = !it.checked;
                }
                closeMenuBar();
                // action を持つ項目（パネルのツールメニューなど）はその場で実行する
                if (typeof it.action === 'function') { it.action(it); return; }
                handleMenuAction(it);
            });
        }
        return el;
    }

    // 指定階層より深いパネルを閉じる
    function closeDeeperPanels(level) {
        menuLayer.querySelectorAll('.appmenu').forEach((p) => {
            if (Number(p.dataset.level) > level) p.remove();
        });
    }

    // パネルを画面内に収めて配置する
    function positionPanel(panel, x, y) {
        const r = panel.getBoundingClientRect();
        const px = Math.max(4, Math.min(x, window.innerWidth - r.width - 6));
        const py = Math.max(4, Math.min(y, window.innerHeight - r.height - 6));
        panel.style.left = px + 'px';
        panel.style.top = py + 'px';
    }

    // メニュー項目のアクションを実行する
    function handleMenuAction(it) {
        switch (it.id) {
            case 'open-project':    openProjectDialog(); return;
            case 'export-auriproj': exportAuriproj(); return;
            case 'export-auripack': exportAuripack(); return;
            case 'import-project':  importAurigaDialog(); return;
            case 'save-project':    toast('プロジェクトを保存しました 💾'); return;
            case 'save-project-as': toast('別名で保存しました 💾'); return;
            case 'undo':            toast('元に戻す（デモ）'); return;
            case 'redo':            toast('やり直し（デモ）'); return;
            case 'export-video': {
                // アクティブテーマが専用の出力ダイアログを持つ場合はそちらへ委譲する（YMM4 など）
                const th = themeHooks[activeThemeName];
                if (th && th.exportVideo) { th.exportVideo(themeCtx); return; }
                toast('書き出しを開始しました… 🎞️'); return;
            }
            case 'play-pause':      togglePlay(); return;
            case 'stop':            if (state.playing) togglePlay(); seek(0); return;
            case 'go-to-start':     seek(0); return;
            case 'go-to-end':       seek(state.duration); return;
            case 'next-frame':      seek(state.playhead + 1 / FPS); return;
            case 'prev-frame':      seek(state.playhead - 1 / FPS); return;
            case 'forward-1sec':    seek(state.playhead + 1); return;
            case 'backward-1sec':   seek(state.playhead - 1); return;
            case 'timeline-zoom-in':  setZoom(state.zoom + 20); return;
            case 'timeline-zoom-out': setZoom(state.zoom - 20); return;
            case 'add-text-item':   addClip('text', 'テキスト', DEFAULT_TRACK, state.playhead, 3); return;
            // ---- 編集系（選択中クリップに対する操作） ----
            case 'copy': {
                const c = getSelectedClip();
                if (c) copyClip(c); else toast('コピーするクリップを選択してください');
                return;
            }
            case 'cut': {
                const c = getSelectedClip();
                if (!c) { toast('切り取るクリップを選択してください'); return; }
                copyClip(c);
                deleteSelected();
                toast('クリップを切り取りました ✂');
                return;
            }
            case 'paste': {
                if (!state.clipboard) { toast('コピーされたクリップがありません'); return; }
                const c = getSelectedClip();
                pasteClip(c ? c.track : DEFAULT_TRACK, Math.round(state.playhead * 10) / 10);
                return;
            }
            case 'delete':          deleteSelected(); return;
            case 'split-at-playhead': {
                const c = getSelectedClip();
                if (c) splitClipAt(c, state.playhead); else toast('分割するクリップを選択してください');
                return;
            }
            case 'duplicate-clip':
            case 'duplicate-selection': {
                const c = getSelectedClip();
                if (c) duplicateClip(c); else toast('複製するクリップを選択してください');
                return;
            }
            // ---- ロゴ文字のメニュー（全テーマ共通） ----
            case 'theme-auriga':    applyTheme('auriga');   return;
            case 'theme-ymm4':      applyTheme('ymm4');     return;
            case 'theme-davinci':   applyTheme('davinci');  return;
            case 'theme-premiere':  applyTheme('premiere'); return;
            case 'theme-capcut':    applyTheme('capcut');   return;
            case 'theme-alightmotion': applyTheme('alightmotion'); return;
            case 'mode-light':      applyMode('light');  return;
            case 'mode-dark':       applyMode('dark');   return;
            case 'mode-system':     applyMode('system'); return;
            // ---- ツールメニュー（パネルの表示/非表示） ----
            case 'preview':
            case 'items':           setPanelVisible(it.id, it.checked); return;
            case 'about':           showAboutModal(); return;
            case 'whats-new':       toast('新着情報（準備中）'); return;
            case 'preferences':     toast('環境設定（準備中）⚙️'); return;
            case 'keyboard-shortcuts': toast('キーボードショートカット（準備中）'); return;
            case 'check-updates':   checkForUpdates(); return;
            case 'website':         toast('公式サイトを開きます 🌐'); return;
            case 'exit':
            case 'quit':
                // Electron ではウィンドウを閉じるとアプリが終了する。
                // ブラウザではスクリプトからタブを閉じられないことがあるため案内を出す
                window.close();
                setTimeout(() => toast('ブラウザではタブを閉じて終了してください'), 200);
                return;
            default:
                toast(`「${it.label}」（未実装）`);
        }
    }

    // ズーム値を設定してタイムラインを更新する
    function setZoom(v) {
        const z = $('#zoom');
        z.value = Math.max(Number(z.min), Math.min(Number(z.max), v));
        z.dispatchEvent(new Event('input'));
    }

    // メニューを閉じる操作をまとめてバインド
    function bindMenuBar() {
        bindLogoMenu();   // ロゴ文字のメニューも同じ機構で開閉する
        document.addEventListener('mousedown', (e) => {
            if (!activeMenuId) return;
            // パネルのツールメニューボタンは自前で開閉を切り替えるので、ここでは閉じない
            if (e.target.closest('.appmenu') || e.target.closest('#appMenu') || e.target.closest('#appLogoMenu')
                || e.target.closest('.panel-tool--menu')) return;
            closeMenuBar();
        });
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Escape' && activeMenuId) closeMenuBar();
        });
        window.addEventListener('blur', closeMenuBar);
        window.addEventListener('resize', closeMenuBar);
    }

    // Tabler アイコン要素を生成する（アイコン名は接頭辞なし。例: "device-floppy"）
    function iconHtml(name) {
        if (!name) return '';
        let safe = String(name).replace(/[^a-z0-9-]/g, '');
        // 末尾が "-filled" ならフィルド（塗りつぶし）バリアントとして ti-fi を付ける。
        // 接尾辞自体はアイコン名から取り除く（フォント側のクラス名は接尾辞なしのため）。
        let fill = '';
        if (safe.endsWith('-filled')) {
            safe = safe.slice(0, -'-filled'.length);
            fill = ' ti-fi';
        }
        return safe ? `<i class="ti${fill} ti-${safe}"></i>` : '';
    }

    // ラベルを生成する。mnemonic があれば "ラベル (M)" の形にする
    function labelHtml(item) {
        let html = escapeHtml(item.label);
        if (item.mnemonic) html += ` (${escapeHtml(item.mnemonic)})`;
        return html;
    }

    // HTML エスケープ（メニューラベル用）
    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    // ======================================================
    // バージョン情報モーダル（Auriga Studio について）
    // ======================================================
    // 表示する値の順番とラベル（VS Code の About に倣う）
    const ABOUT_FIELDS = [
        { key: 'version',         label: 'Version' },
        { key: 'commit',          label: 'Commit' },
        { key: 'branch',          label: 'Branch' },
        { key: 'commitMessage',   label: 'Message' },
        { key: 'commitAuthor',    label: 'Author' },
        { key: 'workingTree',     label: 'Working Tree' },
        { key: 'date',            label: 'Date' },
        { key: 'electron',        label: 'Electron' },
        { key: 'electronBuildId', label: 'ElectronBuildId' },
        { key: 'chromium',        label: 'Chromium' },
        { key: 'node',            label: 'Node.js' },
        { key: 'v8',              label: 'V8' },
        { key: 'renderer',        label: 'Renderer' },
        { key: 'os',              label: 'OS' },
    ];

    let aboutInfoCache = null;   // 組み立てたバージョン情報を保持

    // ローカル情報（git・ランタイム）を取得する。
    // Electron では preload が公開するネイティブ API から、
    // Web（app.auriga.studio）では PHP API から読み込む。
    async function fetchLocalInfo() {
        try {
            if (window.aurigaNative && window.aurigaNative.getLocalInfo) {
                return await window.aurigaNative.getLocalInfo();
            }
            if (location.protocol === 'http:' || location.protocol === 'https:') {
                const res = await fetch('api/local-info.php');
                if (res.ok) return await res.json();
            }
        } catch (e) {
            // 取得できなくても version.json の内容だけで表示を続行する
        }
        return null;
    }

    // 取得したローカル情報を About 表示用のフラットな形に反映する
    function applyLocalInfo(info, local) {
        if (!local || local.error) return;
        if (local.branch) info.branch = local.branch;
        if (local.commit) {
            if (local.commit.hash) info.commit = local.commit.hash;
            if (local.commit.message) info.commitMessage = local.commit.message;
            if (local.commit.author) info.commitAuthor = local.commit.author;
            if (local.commit.date) info.date = local.commit.date;
        }
        if (local.repository && local.repository.is_dirty != null) {
            info.workingTree = local.repository.is_dirty ? '変更あり' : 'クリーン';
        }
        // version.json が読めなかったときは Electron 側の package.json 由来の値で補完する
        if (info.version == null && local.app && local.app.version) {
            info.version = local.app.version;
        }
        if (local.runtime) {
            for (const key of ['electron', 'chromium', 'node', 'v8', 'os']) {
                if (local.runtime[key]) info[key] = local.runtime[key];
            }
        }
    }

    // version.json とローカル情報 API を読み込んでモーダルを開く
    async function showAboutModal() {
        const modal = $('#aboutModal');
        const infoEl = $('#aboutInfo');
        if (!modal || !infoEl) return;
        if (!aboutInfoCache) {
            const info = {};
            // 静的なビルド情報。Electron の file:// では読めないことがあるため任意扱いにする
            try {
                const res = await fetch('version.json');
                if (res.ok) Object.assign(info, await res.json());
            } catch (e) {
                // ローカル情報だけで表示を続行する
            }
            // ローカル情報（git・ランタイム）で上書き・補完する
            applyLocalInfo(info, await fetchLocalInfo());
            if (Object.keys(info).length === 0) {
                toast('バージョン情報の読み込みに失敗しました');
                return;
            }
            aboutInfoCache = info;
        }
        // コンポジターの描画バックエンド（WebGPU / WebGL / Canvas 2D）も表示する
        if (compositorBackend) aboutInfoCache.renderer = compositorBackend;
        // 取得済みの値を dt/dd で描画する（未定義の項目は飛ばす）
        infoEl.innerHTML = ABOUT_FIELDS
            .filter((f) => aboutInfoCache[f.key] != null)
            .map((f) => `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(aboutInfoCache[f.key])}</dd>`)
            .join('');
        modal.hidden = false;
    }

    // モーダルを閉じる
    function closeAboutModal() {
        const modal = $('#aboutModal');
        if (modal) modal.hidden = true;
    }

    // ======================================================
    // アップデートの確認
    // ======================================================
    // 比較対象のリモートリポジトリ（GitHub の公開 API を認証なしで利用する）
    const UPDATE_REPO = 'auriga-labs/auriga-studio';

    // ローカルのコミットとリモートの最新を比較して、結果をトーストで知らせる
    async function checkForUpdates() {
        toast('アップデートを確認しています…');
        // ローカルのコミット（Electron はネイティブ API、Web は PHP API から取得）
        const local = await fetchLocalInfo();
        const hash = local && local.commit && local.commit.hash;
        if (!hash) {
            toast('ローカルのコミット情報を取得できませんでした');
            return;
        }
        const branch = local.branch || 'main';
        try {
            // compare API はローカルのコミットから見たリモート最新の位置関係を返す
            const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/compare/${hash}...${encodeURIComponent(branch)}`);
            if (res.status === 404) {
                // ローカルのコミットやブランチがリモートに存在しない（未 push など）
                toast('リモートに比較対象が見つかりませんでした（未 push の可能性）');
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const cmp = await res.json();
            switch (cmp.status) {
                case 'identical':
                    toast('お使いのバージョンは最新です ✅');
                    break;
                case 'ahead':
                    // リモートにだけ新しいコミットがある＝アップデートあり
                    toast(`新しい更新が ${cmp.ahead_by} 件あります 🔄`);
                    break;
                case 'behind':
                    // ローカルにだけコミットがある＝開発中の未 push 状態
                    toast(`ローカルの方が ${cmp.behind_by} 件進んでいます（未 push）`);
                    break;
                case 'diverged':
                    toast(`リモートと分岐しています（ローカル +${cmp.behind_by} / リモート +${cmp.ahead_by}）`);
                    break;
                default:
                    toast('比較結果を判定できませんでした');
            }
        } catch (e) {
            toast('アップデートの確認に失敗しました（ネットワークをご確認ください）');
        }
    }

    // バージョン情報を「ラベル: 値」の複数行テキストにしてクリップボードへ
    function copyAboutInfo() {
        if (!aboutInfoCache) return;
        const text = ABOUT_FIELDS
            .filter((f) => aboutInfoCache[f.key] != null)
            .map((f) => `${f.label}: ${aboutInfoCache[f.key]}`)
            .join('\n');
        try {
            navigator.clipboard.writeText(text);
            toast('バージョン情報をコピーしました 📋');
        } catch (e) { toast('コピーに失敗しました'); }
    }

    // ======================================================
    // タイムラインの高さリサイズ
    // ======================================================
    // 高さの下限・上限（px）。上限はウィンドウ高さから一定量を引いて算出する
    const TL_MIN_HEIGHT = 120;
    const TL_HEIGHT_KEY = 'auriga.timelineHeight';

    // ウィンドウサイズに応じた高さの上限を求める
    function timelineMaxHeight() {
        return Math.max(TL_MIN_HEIGHT, window.innerHeight - 240);
    }

    // 高さを範囲内に収めてタイムラインへ適用する
    function setTimelineHeight(h) {
        const timeline = $('.timeline');
        // 独立ウィンドウ中の高さはフローティング側で管理する（ドック用のクランプはかけない）
        if (timeline && timeline.classList.contains('is-floating')) return h;
        const clamped = Math.min(timelineMaxHeight(), Math.max(TL_MIN_HEIGHT, Math.round(h)));
        if (timeline) timeline.style.height = clamped + 'px';
        return clamped;
    }

    // 境界バーのドラッグでタイムラインの高さを変える
    function bindTimelineResizer() {
        const resizer = $('#tlResizer');
        const timeline = $('.timeline');
        if (!resizer || !timeline) return;

        // 保存済みの高さがあれば復元する
        const stored = parseInt(localStorage.getItem(TL_HEIGHT_KEY), 10);
        if (Number.isFinite(stored)) setTimelineHeight(stored);

        let startY = 0;
        let startHeight = 0;

        function onMove(e) {
            // 上にドラッグするほど高さが増える
            setTimelineHeight(startHeight - (e.clientY - startY));
        }

        function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            document.body.classList.remove('is-resizing-timeline');
            resizer.classList.remove('is-dragging');
            // 確定した高さを保存する
            localStorage.setItem(TL_HEIGHT_KEY, parseInt(timeline.style.height, 10));
        }

        resizer.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            startY = e.clientY;
            startHeight = timeline.getBoundingClientRect().height;
            document.body.classList.add('is-resizing-timeline');
            resizer.classList.add('is-dragging');
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });

        // ウィンドウ縮小時に上限を超えないよう再クランプする
        window.addEventListener('resize', () => {
            if (timeline.style.height) setTimelineHeight(parseInt(timeline.style.height, 10));
        });
    }

    // ======================================================
    // アイテム（右パネル）の幅リサイズ
    // ======================================================
    // 幅の下限（px）と保存キー。実際の幅は :root の --items-w に書き込み、
    // style.css（3カラム）と themes/ymm4.css（body 2カラム）の両方がこれを見る。
    const ITEMS_MIN_WIDTH = 200;
    const ITEMS_WIDTH_KEY = 'auriga.itemsWidth';
    let itemsWidth = 0;   // 現在適用中の幅（0 = 未指定でテーマ既定のまま）

    // ウィンドウ幅に応じた幅の上限を求める（左隣のプレビューを潰しきらない）
    function itemsMaxWidth() {
        return Math.max(ITEMS_MIN_WIDTH, window.innerWidth - 420);
    }

    // 幅を範囲内に収めて適用する
    function setItemsWidth(w) {
        const clamped = Math.min(itemsMaxWidth(), Math.max(ITEMS_MIN_WIDTH, Math.round(w)));
        itemsWidth = clamped;
        document.documentElement.style.setProperty('--items-w', clamped + 'px');
        return clamped;
    }

    // 左辺のドラッグでアイテムパネルの幅を変える
    function bindItemsResizer() {
        const resizer = $('#itemsResizer');
        const panel = $('.panel--props');
        if (!resizer || !panel) return;

        // 保存済みの幅があれば復元する（なければテーマ既定の幅のまま）
        const stored = parseInt(localStorage.getItem(ITEMS_WIDTH_KEY), 10);
        if (Number.isFinite(stored)) setItemsWidth(stored);

        let startX = 0;
        let startWidth = 0;

        function onMove(e) {
            // 左へドラッグするほど幅が増える
            setItemsWidth(startWidth - (e.clientX - startX));
        }

        function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            document.body.classList.remove('is-resizing-items');
            resizer.classList.remove('is-dragging');
            // 確定した幅を保存する
            localStorage.setItem(ITEMS_WIDTH_KEY, itemsWidth);
        }

        resizer.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            startX = e.clientX;
            startWidth = panel.getBoundingClientRect().width;
            document.body.classList.add('is-resizing-items');
            resizer.classList.add('is-dragging');
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });

        // ウィンドウ縮小時に上限を超えないよう再クランプする
        window.addEventListener('resize', () => {
            if (itemsWidth) setItemsWidth(itemsWidth);
        });
    }

    // ======================================================
    // フローティングパネル（プレビュー / アイテム / タイムラインの独立ウィンドウ化）
    // ======================================================
    // ヘッダー右端のボタン（またはヘッダーのダブルクリック）でパネルをドックから
    // 切り離し、自由に移動・リサイズできる独立ウィンドウにする。
    // ドックの空きスペースは applyPanelVisibility が body クラスで詰める。
    // 位置・サイズは localStorage に保存して次回起動時に復元する。
    const FLOATABLE_PANELS = {
        preview:  { selector: '.stage',        handle: '.stage__head',       label: 'プレビュー',   minW: 320, minH: 220 },
        items:    { selector: '.panel--props', handle: '.panel__head',       label: 'アイテム',     minW: 260, minH: 220 },
        timeline: { selector: '.timeline',     handle: '.timeline__toolbar', label: 'タイムライン', minW: 480, minH: 180 },
    };
    const GRIP_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];   // リサイズつかみしろの方向
    const SNAP_THRESHOLD = 20;   // ポインタが画面端からこの距離に入ったらスナップ候補にする(px)
    let floatZ = 300;   // 最前面管理用の z-index カウンター（メニュー層の 900 より下に収める）
    let snapPreviewEl = null;   // スナップ先を示す半透明プレビュー（初回表示時に生成）

    // 指定パネルが独立ウィンドウ中か
    function isPanelFloating(id) {
        const f = state.floats[id];
        return !!(f && f.on);
    }

    // 独立ウィンドウの初期位置・サイズを決める（保存値がないときだけ）
    function ensureFloatGeometry(id) {
        const f = state.floats[id];
        if (f && Number.isFinite(f.x) && Number.isFinite(f.w)) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let g;
        if (id === 'preview') {
            const w = Math.max(FLOATABLE_PANELS.preview.minW, Math.min(760, Math.round(vw * 0.55)));
            g = { w, h: Math.round(w * 0.75), x: Math.round((vw - w) / 2), y: 70 };
        } else if (id === 'items') {
            const w = 340;
            g = { w, h: Math.max(FLOATABLE_PANELS.items.minH, Math.min(620, vh - 140)), x: Math.max(8, vw - w - 40), y: 80 };
        } else {
            const w = Math.max(FLOATABLE_PANELS.timeline.minW, Math.round(vw * 0.72));
            const h = 300;
            g = { w, h, x: Math.round((vw - w) / 2), y: Math.max(8, vh - h - 60) };
        }
        state.floats[id] = Object.assign({}, f, g);
    }

    // 位置・サイズを画面内に収める（つかめる部分が必ず画面に残るようにする）
    function clampFloatGeometry(id, f) {
        const def = FLOATABLE_PANELS[id];
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        f.w = Math.max(def.minW, Math.min(f.w, vw));
        f.h = Math.max(def.minH, Math.min(f.h, vh));
        f.x = Math.min(Math.max(f.x, 90 - f.w), vw - 90);
        f.y = Math.min(Math.max(f.y, 0), vh - 50);
    }

    // ======================================================
    // 画面端スナップ（ドラッグで端に寄せると張り付いて固定される）
    // ======================================================
    // スナップ領域の上端（メニューバーの下）
    function snapAreaTop() {
        const bar = $('.menubar');
        return bar ? Math.round(bar.getBoundingClientRect().bottom) : 0;
    }

    // スナップ領域の下端（YMM4 テーマのステータスバーがあればその上まで）
    function snapAreaBottom() {
        const sb = $('.ymm4-statusbar');
        return sb ? Math.round(sb.getBoundingClientRect().top) : window.innerHeight;
    }

    // ポインタ位置から、しきい値内で一番近い画面端を返す（なければ null）
    function detectSnapEdge(ev) {
        const cands = [
            ['left', ev.clientX],
            ['right', window.innerWidth - ev.clientX],
            ['top', ev.clientY - snapAreaTop()],
            ['bottom', snapAreaBottom() - ev.clientY],
        ].filter(([, d]) => d <= SNAP_THRESHOLD).sort((a, b) => a[1] - b[1]);
        return cands.length ? cands[0][0] : null;
    }

    // 指定した端へスナップしたときの位置・サイズ。
    // 左右は現在の幅を保って全高に、上下は現在の高さを保って全幅にする
    function snapRect(id, edge, f) {
        const def = FLOATABLE_PANELS[id];
        const vw = window.innerWidth;
        const top = snapAreaTop();
        const bottom = snapAreaBottom();
        const w = Math.max(def.minW, f.w);
        const h = Math.max(def.minH, f.h);
        if (edge === 'left')  return { x: 0, y: top, w, h: bottom - top };
        if (edge === 'right') return { x: vw - w, y: top, w, h: bottom - top };
        if (edge === 'top')   return { x: 0, y: top, w: vw, h };
        return { x: 0, y: bottom - h, w: vw, h };
    }

    // スナップを確定する（戻すとき用に直前のサイズを覚えておく）
    function applySnap(id, edge) {
        const f = state.floats[id];
        f.restore = { w: f.w, h: f.h };
        f.snap = edge;
        Object.assign(f, snapRect(id, edge, f));
        applyFloatGeometry(id);
    }

    // スナップ候補のプレビューを表示する
    function showSnapPreview(rect) {
        if (!snapPreviewEl) {
            snapPreviewEl = document.createElement('div');
            snapPreviewEl.className = 'snap-preview';
            document.body.appendChild(snapPreviewEl);
        }
        snapPreviewEl.style.left = rect.x + 'px';
        snapPreviewEl.style.top = rect.y + 'px';
        snapPreviewEl.style.width = rect.w + 'px';
        snapPreviewEl.style.height = rect.h + 'px';
        snapPreviewEl.style.display = 'block';
    }

    function hideSnapPreview() {
        if (snapPreviewEl) snapPreviewEl.style.display = 'none';
    }

    // 保存中の位置・サイズをパネルのインラインスタイルへ反映する
    function applyFloatGeometry(id) {
        const el = $(FLOATABLE_PANELS[id].selector);
        const f = state.floats[id];
        if (!el || !f) return;
        el.style.left = f.x + 'px';
        el.style.top = f.y + 'px';
        el.style.width = f.w + 'px';
        el.style.height = f.h + 'px';
        // スナップ固定中は端にぴったり見えるよう角丸を外す（CSS が参照する）
        el.classList.toggle('is-snapped', !!f.snap);
    }

    // パネルを最前面に出す（カウンターを使い切ったら振り直す）
    function raiseFloat(el) {
        if (floatZ > 850) {
            floatZ = 300;
            $$('.is-floating').forEach((p) => { p.style.zIndex = ++floatZ; });
        }
        el.style.zIndex = ++floatZ;
    }

    // フローティング状態を DOM へ反映する
    function applyFloating(id) {
        const def = FLOATABLE_PANELS[id];
        const el = $(def.selector);
        if (!el) return;
        const on = isPanelFloating(id);
        el.classList.toggle('is-floating', on);
        if (on) {
            ensureFloatGeometry(id);
            // スナップ固定中は現在の画面サイズに合わせて端の張り付きを計算し直す
            const f = state.floats[id];
            if (f.snap) Object.assign(f, snapRect(id, f.snap, f));
            applyFloatGeometry(id);
            raiseFloat(el);
        } else {
            el.classList.remove('is-snapped');
            el.style.left = el.style.top = el.style.width = el.style.height = el.style.zIndex = '';
            // タイムラインはドック時の高さ（リサイザーで保存した値）へ戻す
            if (id === 'timeline') {
                const stored = parseInt(localStorage.getItem(TL_HEIGHT_KEY), 10);
                if (Number.isFinite(stored)) setTimelineHeight(stored);
            }
        }
        // タイムラインが独立中は境界バー（tl-resizer）を畳む
        if (id === 'timeline') document.body.classList.toggle('is-tl-floating', on);
        applyPanelVisibility();   // ドックの空きを詰める body クラスを同期する（ツールボタンもここで更新される）
    }

    // パネルの独立ウィンドウ化を切り替える（ヘッダーのボタンから呼ぶ）
    function setPanelFloating(id, on) {
        const def = FLOATABLE_PANELS[id];
        if (!def) return;
        // 独立ウィンドウにするなら「自動的に隠す」は解除する（両立しない）
        if (on && isPanelAutoHidden(id)) setPanelAutoHide(id, false, true);
        if (!state.floats[id]) state.floats[id] = {};
        state.floats[id].on = !!on;
        applyFloating(id);
        saveFloats();
        // プレビューは表示領域が変わるので描き直す
        if (id === 'preview') composite(state.playhead, false);
        toast(on ? `${def.label}を独立ウィンドウにしました` : `${def.label}を元の位置に戻しました`);
    }

    // フローティング状態をブラウザに保存する
    function saveFloats() {
        try { localStorage.setItem(FLOATS_KEY, JSON.stringify(state.floats)); } catch (e) {}
    }

    // 保存済みのフローティング状態を復元して反映する
    function restoreFloatingPanels() {
        try {
            const saved = JSON.parse(localStorage.getItem(FLOATS_KEY)) || {};
            Object.keys(FLOATABLE_PANELS).forEach((id) => {
                if (saved[id] && typeof saved[id] === 'object') state.floats[id] = saved[id];
            });
        } catch (e) { /* 壊れた保存値は既定値のまま無視する */ }
        Object.keys(FLOATABLE_PANELS).forEach((id) => {
            // スナップ固定中は applyFloating が端の位置を計算し直すのでクランプしない
            if (isPanelFloating(id) && !state.floats[id].snap) clampFloatGeometry(id, state.floats[id]);
            applyFloating(id);
        });
    }

    // ヘッダー右端にツールボタンを差し込む。
    // プレビュー / アイテムは Visual Studio 風に「メニュー・自動的に隠す・ウィンドウ化・非表示」の
    // 4 つを並べ、タイムラインは独立ウィンドウ化の切り替えだけを置く。
    function makePanelTools(id, def, el) {
        const host = el.querySelector(def.handle);
        if (!host || host.querySelector('.panel-tools')) return;
        const box = document.createElement('div');
        box.className = 'panel-tools';

        // ボタン1つを作る（kind は見た目とアイコン更新の目印）
        const addTool = (kind, icon, title, onClick) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `panel-tool panel-tool--${kind}`;
            btn.dataset.panel = id;
            btn.title = title;
            btn.setAttribute('aria-label', title);
            btn.innerHTML = `<i class="ti ti-${icon}"></i>`;
            btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(btn); });
            box.appendChild(btn);
            return btn;
        };

        // ドッキング操作の一覧（2枚目のスクリーンショット相当のメニュー）
        if (TOGGLEABLE_PANELS[id]) {
            addTool('menu', 'menu-2', 'ウィンドウの位置', (btn) => togglePanelMenu(btn, id));
            addTool('pin', 'pin', '自動的に隠す', () => setPanelAutoHide(id, !isPanelAutoHidden(id)));
        }
        // 独立ウィンドウ化 / 元に戻す（アイコンは updatePanelTools が状態に合わせて差し替える）
        const floatBtn = addTool('float', 'external-link', '独立ウィンドウにする',
            () => setPanelFloating(id, !isPanelFloating(id)));
        floatBtn.dataset.float = id;
        if (TOGGLEABLE_PANELS[id]) {
            addTool('close', 'x', '非表示', () => setPanelVisible(id, false));
        }

        host.appendChild(box);
    }

    // 全ボタンのアイコンとツールチップを現在の状態に合わせる
    function updatePanelTools() {
        $$('.panel-tool--float').forEach((btn) => {
            const on = isPanelFloating(btn.dataset.float);
            btn.innerHTML = on
                ? '<i class="ti ti-arrows-diagonal-minimize-2"></i>'
                : '<i class="ti ti-external-link"></i>';
            btn.title = on ? '元の位置に戻す' : '独立ウィンドウにする';
            btn.setAttribute('aria-label', btn.title);
        });
        $$('.panel-tool--pin').forEach((btn) => {
            const on = isPanelAutoHidden(btn.dataset.panel);
            btn.innerHTML = on
                ? '<i class="ti ti-pinned-off"></i>'
                : '<i class="ti ti-pin"></i>';
            btn.title = on ? 'ドッキング（自動的に隠すを解除）' : '自動的に隠す';
            btn.setAttribute('aria-label', btn.title);
            btn.classList.toggle('is-on', on);
        });
    }

    // ツールメニュー（ウィンドウ化 / ドッキング / 自動的に隠す / 非表示）を開閉する
    function togglePanelMenu(btn, id) {
        const menuId = `__panel_${id}__`;
        if (activeMenuId === menuId) { closeMenuBar(); return; }
        const floating = isPanelFloating(id);
        const autoHidden = isPanelAutoHidden(id);
        openTopMenu(btn, {
            id: menuId,
            items: [
                {
                    id: 'panel-float', type: 'radio', group: 'panel-dock', label: 'ウィンドウ化',
                    checked: floating,
                    action: () => { if (!floating) setPanelFloating(id, true); },
                },
                {
                    id: 'panel-dock', type: 'radio', group: 'panel-dock', label: 'ドッキング',
                    checked: !floating && !autoHidden,
                    action: () => {
                        if (autoHidden) setPanelAutoHide(id, false);
                        else if (floating) setPanelFloating(id, false);
                    },
                },
                { type: 'separator' },
                {
                    id: 'panel-autohide', type: 'checkbox', label: '自動的に隠す',
                    checked: autoHidden,
                    action: (it) => setPanelAutoHide(id, it.checked),
                },
                { id: 'panel-hide', label: '非表示', icon: 'x', action: () => setPanelVisible(id, false) },
            ],
        });
    }

    // ヘッダーのドラッグで独立ウィンドウを移動する
    function bindFloatDrag(id, def, el) {
        const handle = el.querySelector(def.handle);
        if (!handle) return;
        handle.addEventListener('pointerdown', (e) => {
            if (!isPanelFloating(id) || e.button !== 0) return;
            // ヘッダー内の操作部品（ボタン・セレクトなど）はドラッグにしない
            if (e.target.closest('button, select, input, textarea, .ptab')) return;
            e.preventDefault();
            const f = state.floats[id];
            // スナップ固定中につかんだら固定を解除し、つかんだ位置を保ったまま元のサイズへ戻す
            if (f.snap) {
                const ratio = f.w > 0 ? (e.clientX - f.x) / f.w : 0.5;
                if (f.restore) { f.w = f.restore.w; f.h = f.restore.h; }
                f.snap = null;
                f.x = Math.round(e.clientX - f.w * ratio);
                f.y = Math.round(e.clientY - 14);
                clampFloatGeometry(id, f);
                applyFloatGeometry(id);
            }
            const sx = e.clientX;
            const sy = e.clientY;
            const ox = f.x;
            const oy = f.y;
            let pendingSnap = null;   // ドラッグ中のスナップ候補の端
            document.body.classList.add('is-dragging-float');
            const onMove = (ev) => {
                f.x = ox + (ev.clientX - sx);
                f.y = oy + (ev.clientY - sy);
                clampFloatGeometry(id, f);
                applyFloatGeometry(id);
                // 画面端に近づいたらスナップ先のプレビューを出す
                pendingSnap = detectSnapEdge(ev);
                if (pendingSnap) showSnapPreview(snapRect(id, pendingSnap, f));
                else hideSnapPreview();
            };
            const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                document.body.classList.remove('is-dragging-float');
                hideSnapPreview();
                if (pendingSnap) applySnap(id, pendingSnap);
                saveFloats();
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
        // ヘッダーのダブルクリックでも独立/戻すを切り替えられるようにする
        handle.addEventListener('dblclick', (e) => {
            if (e.target.closest('button, select, input, textarea, .ptab')) return;
            setPanelFloating(id, !isPanelFloating(id));
        });
    }

    // 8方向のつかみしろを差し込み、ドラッグでリサイズできるようにする
    function bindFloatResize(id, def, el) {
        GRIP_DIRS.forEach((dir) => {
            const grip = document.createElement('div');
            grip.className = `float-grip float-grip--${dir}`;
            el.appendChild(grip);
            grip.addEventListener('pointerdown', (e) => {
                if (!isPanelFloating(id) || e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                const f = state.floats[id];
                const s = { x: e.clientX, y: e.clientY, fx: f.x, fy: f.y, fw: f.w, fh: f.h };
                document.body.classList.add('is-dragging-float');
                const onMove = (ev) => {
                    const dx = ev.clientX - s.x;
                    const dy = ev.clientY - s.y;
                    // 西・北方向は最小サイズで止まるよう、確定した幅・高さから位置を逆算する
                    if (dir.includes('w')) { f.w = Math.max(def.minW, s.fw - dx); f.x = s.fx + (s.fw - f.w); }
                    else if (dir.includes('e')) { f.w = Math.max(def.minW, s.fw + dx); }
                    if (dir.includes('n')) { f.h = Math.max(def.minH, s.fh - dy); f.y = s.fy + (s.fh - f.h); }
                    else if (dir.includes('s')) { f.h = Math.max(def.minH, s.fh + dy); }
                    // スナップ固定中は端に張り付いたまま、空いている方向のサイズだけ変える
                    if (f.snap) {
                        if (f.snap === 'left' || f.snap === 'right') f.restore = Object.assign({}, f.restore, { w: f.w });
                        else f.restore = Object.assign({}, f.restore, { h: f.h });
                        Object.assign(f, snapRect(id, f.snap, f));
                    }
                    applyFloatGeometry(id);
                };
                const onUp = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    document.body.classList.remove('is-dragging-float');
                    saveFloats();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            });
        });
    }

    // ウィンドウ縮小時に独立ウィンドウが画面外へ出ないよう再クランプする
    // （スナップ固定中は端に張り付いたまま追従させる）
    function reclampFloats() {
        let changed = false;
        Object.keys(FLOATABLE_PANELS).forEach((id) => {
            if (!isPanelFloating(id)) return;
            const f = state.floats[id];
            if (f.snap) Object.assign(f, snapRect(id, f.snap, f));
            else clampFloatGeometry(id, f);
            applyFloatGeometry(id);
            changed = true;
        });
        if (changed) saveFloats();
    }

    // フローティングパネル一式の初期化（bindUI から呼ぶ）
    function bindFloatingPanels() {
        Object.keys(FLOATABLE_PANELS).forEach((id) => {
            const def = FLOATABLE_PANELS[id];
            const el = $(def.selector);
            if (!el) return;
            makePanelTools(id, def, el);
            bindFloatDrag(id, def, el);
            bindFloatResize(id, def, el);
            // どこかをつかんだら最前面へ出す
            el.addEventListener('pointerdown', () => {
                if (isPanelFloating(id)) raiseFloat(el);
            }, true);
        });
        window.addEventListener('resize', reclampFloats);
        restoreFloatingPanels();
    }

    // ======================================================
    // 自動的に隠す（パネルを画面端のタブへ畳む）
    // ======================================================
    // ヘッダーのピンボタン（またはツールメニュー）で有効にすると、パネルはドックから外れて
    // 画面端の細いタブだけになる。タブにポインタを乗せている間だけパネルがせり出し、
    // 離すとまた畳まれる。ピンをもう一度押すとドックへ戻る。
    const AUTOHIDE_PANELS = {
        preview: { selector: '.stage',        edge: 'left',  label: 'プレビュー', icon: 'player-play' },
        items:   { selector: '.panel--props', edge: 'right', label: 'アイテム',   icon: 'adjustments' },
    };
    const STRIP_OFFSET = 12;   // タブを端の上から少し下げる余白(px)
    const PEEK_CLOSE_DELAY = 260;   // ポインタが離れてから畳むまでの猶予(ms)
    const autoHideStrips = {};   // id → タブ要素
    const peekTimers = {};       // id → 畳むまでのタイマー

    // 指定パネルが「自動的に隠す」中か
    function isPanelAutoHidden(id) {
        return state.autoHide[id] === true;
    }

    // せり出し（ピーク）表示中か
    function isPanelPeeking(id) {
        const def = AUTOHIDE_PANELS[id];
        const el = def && $(def.selector);
        return !!(el && el.classList.contains('is-peek'));
    }

    // 画面端のタブを（なければ作って）返す
    function ensureAutoHideStrip(id) {
        if (autoHideStrips[id]) return autoHideStrips[id];
        const def = AUTOHIDE_PANELS[id];
        const strip = document.createElement('button');
        strip.type = 'button';
        strip.className = `autohide-strip autohide-strip--${def.edge}`;
        strip.dataset.strip = id;
        strip.hidden = true;
        strip.innerHTML = `<i class="ti ti-${def.icon}"></i><span>${escapeHtml(def.label)}</span>`;
        // ホバーでせり出し、離れると畳む（クリックはタッチ操作用）
        strip.addEventListener('pointerenter', () => { cancelClosePeek(id); openPeek(id); });
        strip.addEventListener('pointerleave', () => scheduleClosePeek(id));
        strip.addEventListener('click', () => openPeek(id));
        document.body.appendChild(strip);
        autoHideStrips[id] = strip;
        return strip;
    }

    // タブの位置を画面端に合わせる（メニューバーの下・ステータスバーの上に収める）
    function layoutAutoHideStrip(id) {
        const strip = autoHideStrips[id];
        if (!strip || strip.hidden) return;
        strip.style.top = (snapAreaTop() + STRIP_OFFSET) + 'px';
        strip.style.maxHeight = Math.max(60, snapAreaBottom() - snapAreaTop() - STRIP_OFFSET * 2) + 'px';
    }

    // せり出し中のパネルの位置・サイズを決める
    function applyPeekGeometry(id) {
        const def = AUTOHIDE_PANELS[id];
        const el = $(def.selector);
        if (!el) return;
        const strip = autoHideStrips[id];
        const stripW = strip ? Math.round(strip.getBoundingClientRect().width) : 26;
        const top = snapAreaTop();
        const height = Math.max(160, snapAreaBottom() - top);
        // アイテムはドック時の幅、プレビューは画面幅の半分強を目安にする
        const w = id === 'items'
            ? Math.max(ITEMS_MIN_WIDTH, itemsWidth || 300)
            : Math.max(320, Math.min(760, Math.round(window.innerWidth * 0.55)));
        const width = Math.min(w, Math.max(240, window.innerWidth - stripW - 8));
        el.style.top = top + 'px';
        el.style.height = height + 'px';
        el.style.width = width + 'px';
        el.style.left = (def.edge === 'right' ? window.innerWidth - width - stripW : stripW) + 'px';
    }

    // せり出し表示にする
    function openPeek(id) {
        if (!isPanelAutoHidden(id) || state.panels[id] === false) return;
        const el = $(AUTOHIDE_PANELS[id].selector);
        if (!el || el.classList.contains('is-peek')) return;
        el.classList.add('is-peek');
        applyPeekGeometry(id);
        if (id === 'preview') composite(state.playhead, false);
    }

    // せり出しを畳む
    function closePeek(id) {
        const el = $(AUTOHIDE_PANELS[id].selector);
        if (!el || !el.classList.contains('is-peek')) return;
        el.classList.remove('is-peek');
        el.style.left = el.style.top = el.style.width = el.style.height = '';
    }

    // 少し待ってから畳む（タブとパネルの間をポインタが通るときに閉じないようにする）
    function scheduleClosePeek(id) {
        cancelClosePeek(id);
        peekTimers[id] = setTimeout(() => {
            // パネル内から開いたメニューの操作中は畳まない
            if (activeMenuId) { scheduleClosePeek(id); return; }
            closePeek(id);
        }, PEEK_CLOSE_DELAY);
    }

    function cancelClosePeek(id) {
        clearTimeout(peekTimers[id]);
    }

    // 「自動的に隠す」状態を DOM へ反映する
    function applyAutoHide(id) {
        const def = AUTOHIDE_PANELS[id];
        const el = $(def.selector);
        if (!el) return;
        const on = isPanelAutoHidden(id);
        el.classList.toggle('is-autohide', on);
        if (!on) closePeek(id);
        const strip = ensureAutoHideStrip(id);
        strip.hidden = !(on && state.panels[id] !== false);
        layoutAutoHideStrip(id);
        updateStripGutters();
        applyPanelVisibility();   // ドックの空きを詰める body クラスを同期する
    }

    // タブを置く余白（画面端）を、表示中のタブに合わせて確保する
    function updateStripGutters() {
        ['left', 'right'].forEach((edge) => {
            const used = Object.keys(AUTOHIDE_PANELS).some((id) =>
                AUTOHIDE_PANELS[id].edge === edge && autoHideStrips[id] && !autoHideStrips[id].hidden);
            document.body.classList.toggle(`has-strip-${edge}`, used);
        });
    }

    // 「自動的に隠す」を切り替える（ピンボタン・ツールメニューから呼ぶ）
    // silent = true のときはトーストを出さない（他の操作からの内部呼び出し用）
    function setPanelAutoHide(id, on, silent) {
        const def = AUTOHIDE_PANELS[id];
        if (!def) return;
        // 独立ウィンドウ中に隠す指定をされたら、まずドックへ戻す
        if (on && isPanelFloating(id)) setPanelFloating(id, false);
        state.autoHide[id] = !!on;
        applyAutoHide(id);
        saveAutoHide();
        if (id === 'preview') composite(state.playhead, false);
        if (!silent) toast(on ? `${def.label}を自動的に隠すようにしました` : `${def.label}をドッキングしました`);
    }

    // 状態をブラウザに保存する
    function saveAutoHide() {
        try { localStorage.setItem(AUTOHIDE_KEY, JSON.stringify(state.autoHide)); } catch (e) {}
    }

    // 保存済みの状態を復元して反映する
    function restoreAutoHide() {
        try {
            const saved = JSON.parse(localStorage.getItem(AUTOHIDE_KEY)) || {};
            Object.keys(AUTOHIDE_PANELS).forEach((id) => {
                // 独立ウィンドウ中のパネルは畳まない（両立しないため）
                if (saved[id] === true && !isPanelFloating(id)) state.autoHide[id] = true;
            });
        } catch (e) { /* 壊れた保存値は既定値のまま無視する */ }
        Object.keys(AUTOHIDE_PANELS).forEach(applyAutoHide);
    }

    // 自動的に隠す一式の初期化（bindUI から呼ぶ）
    function bindAutoHidePanels() {
        Object.keys(AUTOHIDE_PANELS).forEach((id) => {
            const el = $(AUTOHIDE_PANELS[id].selector);
            if (!el) return;
            // パネル上にポインタがある間はせり出したままにする
            el.addEventListener('pointerenter', () => {
                if (isPanelAutoHidden(id)) cancelClosePeek(id);
            });
            el.addEventListener('pointerleave', () => {
                if (isPanelPeeking(id)) scheduleClosePeek(id);
            });
        });
        // 外側をクリックしたら畳む（タブとメニューの中は除く）
        document.addEventListener('mousedown', (e) => {
            Object.keys(AUTOHIDE_PANELS).forEach((id) => {
                if (!isPanelPeeking(id)) return;
                if (e.target.closest(AUTOHIDE_PANELS[id].selector)
                    || e.target.closest('.autohide-strip')
                    || e.target.closest('.appmenu')) return;
                closePeek(id);
            });
        });
        // 画面サイズが変わったらタブとせり出しの位置を計算し直す
        window.addEventListener('resize', () => {
            Object.keys(AUTOHIDE_PANELS).forEach((id) => {
                layoutAutoHideStrip(id);
                if (isPanelPeeking(id)) applyPeekGeometry(id);
            });
        });
        restoreAutoHide();
    }

    // ======================================================
    // アカウント情報ポップオーバー（Auriga Cloud 使用容量つき）
    // ======================================================
    const CLOUD_FALLBACK_TOTAL_GB = 15;   // Drive容量が取れないときの表示用フォールバック枠（GB）
    const QUOTA_KEY = 'auriga.quota';     // Drive容量（usage/limit）のキャッシュ保存キー

    // Drive の使用容量（バイト）。ログイン後に GET drive/v3/about で実値へ更新する。
    // limit が null のときは「無制限」を意味する。
    let cloudUsedBytes = 0;
    let cloudLimitBytes = CLOUD_FALLBACK_TOTAL_GB * 1024 * 1024 * 1024;
    let cloudHasQuota = false;            // 実値（Drive API由来）を取得済みか

    // 現在ログイン中のユーザー（未ログインは null）
    // 形: { id, email, name, picture, verified }
    let currentUser = null;
    let accessToken = null;              // Google アクセストークン（メモリ保持のみ・短命）
    let authPopup = null;                // ログイン用タブ（window.open）の参照
    let authState = null;                // CSRF対策のstate（クライアント生成・照合用）

    // バイト数を読みやすい単位（GB/TB等）に整形する
    function formatBytes(bytes) {
        if (!isFinite(bytes) || bytes < 0) bytes = 0;
        const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        let i = 0;
        let v = bytes;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        // GB以上は小数1桁、それ未満は整数寄りで読みやすく
        const digits = i >= 3 ? 1 : 0;
        return `${v.toFixed(digits)} ${units[i]}`;
    }

    // 使用容量ゲージを現在値で更新する
    function updateCloudGauge() {
        const bar = $('#cloudBar');
        const usage = $('#cloudUsage');
        const note = $('#cloudNote');
        if (!bar || !usage) return;

        const limited = cloudLimitBytes != null && isFinite(cloudLimitBytes) && cloudLimitBytes > 0;
        const pct = limited
            ? Math.max(0, Math.min(100, (cloudUsedBytes / cloudLimitBytes) * 100))
            : 0;
        bar.style.width = pct + '%';

        if (!currentUser) {
            // 未ログイン：フォールバック枠だけ示す
            usage.textContent = `— / ${CLOUD_FALLBACK_TOTAL_GB} GB`;
        } else if (limited) {
            usage.textContent = `${formatBytes(cloudUsedBytes)} / ${formatBytes(cloudLimitBytes)}`;
        } else {
            // 容量無制限（limit なし）
            usage.textContent = `${formatBytes(cloudUsedBytes)} / 無制限`;
        }

        if (note) {
            if (!currentUser) {
                note.textContent = `ログインすると ${CLOUD_FALLBACK_TOTAL_GB} GB を無料で利用できます`;
            } else if (!cloudHasQuota) {
                note.textContent = '容量を確認中…';
            } else if (limited) {
                note.textContent = `残り ${formatBytes(cloudLimitBytes - cloudUsedBytes)}`;
            } else {
                note.textContent = '容量無制限';
            }
        }
    }

    // ---- Drive 容量キャッシュ（localStorage） ----
    // 再起動後もアクセストークンが無い間、最後に取得した容量を表示するために使う。
    function loadStoredQuota() {
        try {
            const raw = localStorage.getItem(QUOTA_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function saveStoredQuota(quota) {
        try {
            if (quota) localStorage.setItem(QUOTA_KEY, JSON.stringify(quota));
            else localStorage.removeItem(QUOTA_KEY);
        } catch (e) {}
    }

    // キャッシュ済みの容量を状態へ反映する（実値が無いときの表示用）
    function applyStoredQuota() {
        const q = loadStoredQuota();
        if (!q) return;
        cloudUsedBytes = Number(q.usage) || 0;
        cloudLimitBytes = q.limit == null ? null : Number(q.limit);
        cloudHasQuota = true;
    }

    // Google Drive の使用容量を取得してゲージへ反映する
    // GET https://www.googleapis.com/drive/v3/about?fields=storageQuota
    async function fetchDriveStorage() {
        if (!accessToken) return;
        try {
            const res = await fetch(
                'https://www.googleapis.com/drive/v3/about?fields=storageQuota',
                { headers: { Authorization: 'Bearer ' + accessToken } }
            );
            if (!res.ok) {
                // 401（トークン失効）などはキャッシュ表示のまま黙って諦める
                if (res.status === 401) accessToken = null;
                return;
            }
            const data = await res.json();
            const q = data.storageQuota || {};
            // limit は無制限アカウントでは欠落する
            cloudUsedBytes = Number(q.usage) || 0;
            cloudLimitBytes = q.limit == null ? null : Number(q.limit);
            cloudHasQuota = true;
            saveStoredQuota({ usage: q.usage ?? '0', limit: q.limit ?? null });
            updateCloudGauge();
        } catch (e) {
            // ネットワークエラー等はキャッシュ表示のままにする
        }
    }

    // ======================================================
    // Auriga Cloud パネル（クラウド内のファイル一覧）
    // ======================================================
    // バックエンド（app.auriga.studio/cloud/*.php）が Google ドライブの
    // 「Auriga Cloud」フォルダを橋渡しする。アクセストークンを Bearer で送る。
    const CLOUD_LIST_URL = OAUTH_ORIGIN + '/cloud/list.php';
    const CLOUD_DOWNLOAD_URL = OAUTH_ORIGIN + '/cloud/download.php';
    let cloudFiles = [];           // 取得済みのクラウドファイル一覧
    let cloudFilesLoaded = false;  // 一度でも取得に成功したか
    let cloudLoading = false;      // 取得中フラグ（多重取得の抑制）

    // MIME タイプからファイル種別アイコン（Tabler）を選ぶ
    function cloudFileIcon(mime) {
        const m = String(mime || '');
        if (m === 'application/vnd.google-apps.folder') return 'ti-folder';
        if (m.startsWith('video/')) return 'ti-movie';
        if (m.startsWith('image/')) return 'ti-photo';
        if (m.startsWith('audio/')) return 'ti-music';
        return 'ti-file';
    }

    // ISO 日時を「YYYY/MM/DD」へ整形する（取得できなければ空文字）
    function formatCloudDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    }

    // クラウドファイル一覧（または各状態のメッセージ）を描画する
    function renderCloudList() {
        const list = $('#cloudList');
        if (!list) return;

        // 未ログイン：ログインを促す
        if (!currentUser) {
            list.innerHTML = `
                <div class="media-empty">
                    <p>未ログインです</p>
                    <p class="media-empty__sub">ログインすると Auriga Cloud の<br>ファイルが表示されます</p>
                </div>`;
            return;
        }
        // トークンが無い（再起動後など短命トークンが切れた状態）
        if (!accessToken) {
            list.innerHTML = `
                <div class="media-empty">
                    <p>セッションが切れています</p>
                    <p class="media-empty__sub">アカウントから再度<br>ログインしてください</p>
                </div>`;
            return;
        }
        // 読み込み中
        if (cloudLoading) {
            list.innerHTML = `<div class="media-empty"><p>読み込み中…</p></div>`;
            return;
        }
        // 取得済みだが空
        if (!cloudFiles.length) {
            list.innerHTML = `
                <div class="media-empty">
                    <p>ファイルがありません</p>
                    <p class="media-empty__sub">Auriga Cloud にアップロードした<br>ファイルがここに表示されます</p>
                </div>`;
            return;
        }

        // 一覧。各行はテーマ済みの .effect-item を再利用して配色を揃える
        list.innerHTML = cloudFiles.map((f) => `
            <div class="effect-item cloud-file" data-id="${escapeHtml(f.id)}" title="${escapeHtml(f.name)}">
                <span class="effect-item__icon"><i class="ti ${cloudFileIcon(f.mimeType)}"></i></span>
                <div class="cloud-file__info">
                    <div class="effect-item__name">${escapeHtml(f.name)}</div>
                    <div class="effect-item__desc">${formatBytes(Number(f.size) || 0)} · ${formatCloudDate(f.modifiedTime)}</div>
                </div>
            </div>
        `).join('');

        // クリックでメディアプールに読み込む
        $$('#cloudList .cloud-file').forEach((el) => {
            const f = cloudFiles.find((x) => x.id === el.dataset.id);
            if (f) el.addEventListener('click', () => importCloudFile(f));
        });
    }

    // Auriga Cloud のファイル一覧を取得して描画する
    async function fetchCloudFiles(silent) {
        if (!currentUser || !accessToken) { renderCloudList(); return; }
        if (cloudLoading) return;
        cloudLoading = true;
        renderCloudList();
        try {
            const res = await fetch(CLOUD_LIST_URL, {
                headers: { Authorization: 'Bearer ' + accessToken },
            });
            if (!res.ok) {
                if (res.status === 401) accessToken = null;   // トークン失効
                throw new Error('status ' + res.status);
            }
            const data = await res.json();
            cloudFiles = Array.isArray(data.files) ? data.files : [];
            cloudFilesLoaded = true;
            cloudLoading = false;
            renderCloudList();
            if (!silent) toast(`クラウド：${cloudFiles.length} 件のファイル`);
        } catch (e) {
            cloudLoading = false;
            renderCloudList();   // accessToken=null になっていれば再ログイン案内になる
            const list = $('#cloudList');
            if (accessToken && list) {
                list.innerHTML = `
                    <div class="media-empty">
                        <p>読み込みに失敗しました</p>
                        <p class="media-empty__sub">時間をおいて「更新」を<br>お試しください</p>
                    </div>`;
            }
            if (!silent) toast('クラウドの読み込みに失敗しました');
        }
    }

    // クラウドのファイルをダウンロードしてメディアプールへ読み込む
    async function importCloudFile(file) {
        if (!accessToken) { toast('再度ログインしてください'); return; }
        toast(`「${file.name}」を読み込み中…`);
        try {
            const res = await fetch(CLOUD_DOWNLOAD_URL + '?id=' + encodeURIComponent(file.id), {
                headers: { Authorization: 'Bearer ' + accessToken },
            });
            if (!res.ok) throw new Error('status ' + res.status);
            const blob = await res.blob();
            // registerMedia は File の type/name を参照するので File に包む
            const f = new File([blob], file.name, { type: file.mimeType || blob.type });
            registerMedia(f);
            renderMedia();
            activateMediaTab('media');   // 読み込んだファイルが見えるメディアタブへ
            toast(`「${file.name}」を読み込みました`);
        } catch (e) {
            toast('読み込みに失敗しました');
        }
    }

    // 左パネルのタブを切り替える（クラウドタブを開いたら必要に応じて取得）
    function activateMediaTab(name) {
        $$('.panel--media .ptab').forEach((t) =>
            t.classList.toggle('is-active', t.dataset.tab === name));
        $$('.ptab-content').forEach((c) =>
            c.classList.toggle('is-active', c.dataset.content === name));
        // クラウドタブを初めて開いたときに一覧を取得する
        if (name === 'cloud' && currentUser && accessToken && !cloudFilesLoaded && !cloudLoading) {
            fetchCloudFiles(true);
        }
    }

    // ---- ユーザー情報の永続化（localStorage） ----
    // 保存済みユーザーを読み込む（壊れていたら null）
    function loadStoredUser() {
        try {
            const raw = localStorage.getItem(USER_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    // ユーザーを保存／削除する
    function saveStoredUser(user) {
        try {
            if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
            else localStorage.removeItem(USER_KEY);
        } catch (e) {}
    }

    // アバター要素にユーザーの画像（なければ人型アイコン）を反映する
    function renderAvatar(el, user, size) {
        if (!el) return;
        if (user && user.picture) {
            el.innerHTML = `<img src="${user.picture}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`;
        } else {
            el.innerHTML = '<i class="ti ti-user"></i>';
        }
    }

    // ログイン状態をアカウントUI全体へ反映する
    function applyAccountUI() {
        const nameEl = $('#accountName');
        const mailEl = $('#accountMail');
        const signBtn = $('#btnSignIn');

        renderAvatar($('#avatarBtn'), currentUser, 26);
        renderAvatar($('#accountAvatarLg'), currentUser, 56);

        if (currentUser) {
            if (nameEl) nameEl.textContent = currentUser.name || 'ユーザー';
            if (mailEl) mailEl.textContent = currentUser.email || '';
            if (signBtn) signBtn.innerHTML = '<i class="ti ti-logout"></i> ログアウト';
        } else {
            if (nameEl) nameEl.textContent = 'ゲスト';
            if (mailEl) mailEl.textContent = '未ログイン';
            if (signBtn) signBtn.innerHTML = `            <!-- Google "G" ロゴ -->
            <svg width="20" height="20" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.29-8.16 2.29-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
            </svg> Google でログイン`;
        }
        updateCloudGauge();
        renderCloudList();   // ログイン状態に応じてクラウドパネルも更新する
    }

    // ログインに成功した（または復元した）ユーザーを反映する
    function setUser(user, persist) {
        currentUser = user;
        if (persist) saveStoredUser(user);
        applyAccountUI();
    }

    // CSRF対策用のランダムな16進文字列を生成する
    function randomHex(bytes) {
        const a = new Uint8Array(bytes);
        (window.crypto || window.msCrypto).getRandomValues(a);
        return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    // Google の認可画面を新しいタブで直接開く
    function startGoogleLogin() {
        // 既存のログインタブがあれば前面化するだけ
        if (authPopup && !authPopup.closed) { authPopup.focus(); return; }

        // state はクライアントで生成する。'app.' プレフィックスで
        // callback.php がアプリ起点だと判別し、照合はこちらで行う。
        authState = 'app.' + randomHex(16);

        const params = new URLSearchParams({
            client_id:     OAUTH_CLIENT_ID,
            redirect_uri:  OAUTH_REDIRECT_URI,
            response_type: 'code',
            scope:         OAUTH_SCOPES.join(' '),
            state:         authState,
            access_type:   'offline',   // refresh_token を取得する
            prompt:        'consent',
        });
        const url = OAUTH_GOOGLE_AUTH + '?' + params.toString();

        // 名前付きターゲットで開く（サイズ指定なし＝新しいタブ）。
        // 結果は postMessage で受け取るため opener を残す必要があり、noopener は付けない。
        authPopup = window.open(url, 'auriga-oauth');
        if (!authPopup) { toast('タブを開けませんでした 🚫'); return; }
        toast('Google でログイン中…🔑');
    }

    // ログアウトする（サーバーのセッションも破棄する）
    function signOut() {
        setUser(null, true);
        // トークンとキャッシュ済み容量を破棄し、フォールバック表示へ戻す
        accessToken = null;
        cloudHasQuota = false;
        cloudUsedBytes = 0;
        cloudLimitBytes = CLOUD_FALLBACK_TOTAL_GB * 1024 * 1024 * 1024;
        saveStoredQuota(null);
        updateCloudGauge();
        // クラウドパネルの一覧も破棄して未ログイン表示へ戻す
        cloudFiles = [];
        cloudFilesLoaded = false;
        cloudLoading = false;
        renderCloudList();
        // サーバー側セッションも破棄（自動で閉じるポップアップ）
        const out = window.open(OAUTH_LOGOUT_URL, 'auriga-oauth-out', 'width=420,height=520');
        if (out) setTimeout(() => { try { out.close(); } catch (e) {} }, 1500);
        toast('ログアウトしました 👋');
    }

    // 認証サーバーからの postMessage を受け取る
    function bindOAuthBridge() {
        window.addEventListener('message', (e) => {
            // オリジンを厳格に検証する（なりすまし防止）
            if (e.origin !== OAUTH_ORIGIN) return;
            const data = e.data;
            if (!data || data.type !== 'auriga-oauth') return;

            // state を照合する（クライアント生成値と一致しなければ拒否）
            if (authState && data.state !== authState) {
                toast('セキュリティエラー: state が一致しません 🚫');
                authState = null;
                if (authPopup && !authPopup.closed) { try { authPopup.close(); } catch (err) {} }
                authPopup = null;
                return;
            }
            authState = null;

            if (data.user) {
                setUser(data.user, true);
                // アクセストークンを受け取れたら Drive の実容量を取得する
                if (data.access_token) {
                    accessToken = data.access_token;
                    fetchDriveStorage();
                    fetchCloudFiles(true);   // クラウドパネルの一覧も取得
                }
                toast(`ようこそ、${data.user.name || 'ユーザー'} さん 🎉`);
            } else if (data.error) {
                toast('ログインに失敗しました: ' + data.error);
            }
            if (authPopup && !authPopup.closed) { try { authPopup.close(); } catch (err) {} }
            authPopup = null;
        });
    }

    // アカウントポップオーバーの開閉とログイン／ログアウトをバインドする
    function bindAccountMenu() {
        const btn = $('#avatarBtn');
        const pop = $('#accountPop');
        if (!btn || !pop) return;

        // 認証ブリッジを準備し、保存済みユーザーを復元する
        bindOAuthBridge();
        const stored = loadStoredUser();
        // ログイン中なら、トークンが無い間でも最後に取得した容量を表示する
        if (stored) applyStoredQuota();
        setUser(stored, false);

        const open = () => {
            // トークンが生きていれば開くたびに最新の容量へ更新する
            if (currentUser && accessToken) fetchDriveStorage();
            updateCloudGauge();
            pop.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
        };
        const close = () => {
            pop.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
        };
        const toggle = () => (pop.hidden ? open() : close());

        btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
        // ポップオーバー内クリックでは閉じない
        pop.addEventListener('click', (e) => e.stopPropagation());
        // 外側クリック / Esc で閉じる
        document.addEventListener('click', () => { if (!pop.hidden) close(); });
        document.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !pop.hidden) close(); });

        // ログイン中はログアウト、未ログインはログインを実行する
        $('#btnSignIn').addEventListener('click', () => {
            if (currentUser) signOut();
            else startGoogleLogin();
        });
    }

    // ======================================================
    // スマホ幅メニュー（ハンバーガー）
    // ======================================================
    // 狭い画面では、ハンバーガーのパネルにアプリメニューの1階層目を
    // 2階層目と同じ見た目で表示する（中身は renderMobilePanelMenu が組み立てる）。
    // ヘッダー側のメニューバーは CSS（メディアクエリ）で非表示にする。
    function bindMobileMenu() {
        const burger = $('#menuBurger');
        const panel = $('#mobilePanel');
        if (!burger || !panel) return;

        function openPanel() { panel.hidden = false; burger.setAttribute('aria-expanded', 'true'); }
        function closePanel() {
            closeMenuBar();   // 開いているドロップダウンも一緒に閉じる
            panel.hidden = true;
            burger.setAttribute('aria-expanded', 'false');
        }

        burger.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.hidden ? openPanel() : closePanel();
        });
        // パネル・ドロップダウン・ハンバーガー以外をクリックしたら閉じる
        document.addEventListener('click', (e) => {
            if (!panel.hidden && !e.target.closest('#mobilePanel, #menuBurger, .appmenu-layer')) closePanel();
        });
    }

    // モーダルの開閉操作をバインドする
    function bindAboutModal() {
        const modal = $('#aboutModal');
        if (!modal) return;
        $('#aboutClose').addEventListener('click', closeAboutModal);
        $('#aboutCopy').addEventListener('click', copyAboutInfo);
        // 背景クリックで閉じる
        modal.querySelector('[data-about-close]').addEventListener('click', closeAboutModal);
        // Esc で閉じる
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Escape' && !modal.hidden) closeAboutModal();
        });
    }

    // ======================================================
    // トースト
    // ======================================================
    let toastTimer = null;
    function toast(msg) {
        els.toast.textContent = msg;
        els.toast.classList.add('is-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => els.toast.classList.remove('is-show'), 2200);
    }

    // ---- 起動 ----
    document.addEventListener('DOMContentLoaded', init);
})();
