/* ======================================================
   Auriga Studio — 動画編集UI ロジック
   ====================================================== */
(() => {
    'use strict';

    // ---- 定数 ----
    const FPS = 30;
    const THEME_KEY = 'auriga.theme';   // テーマ（モード）設定の保存キー
    const RES_KEY = 'auriga.resolution';   // 解像度選択の保存キー
    const PLAYHEAD_KEY = 'auriga.playhead'; // 再生ヘッド位置(秒)の保存キー
    const USER_KEY = 'auriga.user';     // ログイン中ユーザー情報の保存キー

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
    const THEMES = ['auriga', 'ymm4', 'davinci', 'premiere'];
    const THEME_LABELS = { auriga: 'Aurigaオリジナル', ymm4: 'YMM4', davinci: 'DaVinci', premiere: 'Premiere' };

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
    const TIMELINE_SECONDS = 60;      // タイムライン全体の長さ(秒)

    // ---- 状態 ----
    const state = {
        zoom: 60,                     // 1秒あたりのpx
        playing: false,
        loop: false,
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
    };

    // ---- トラック定義（上から） ----
    // YMM4 ライクに種類を設けず「レイヤー1」のような連番にする。
    // どのレイヤーにも映像・音声・テキストを置ける。上のレイヤーほど手前に描画する。
    const LAYER_COUNT = 5;             // 既定のレイヤー数（上から レイヤー1…）
    const DEFAULT_TRACK = 'L1';        // 新規クリップの既定レイヤー
    const TRACKS = Array.from({ length: LAYER_COUNT }, (_, i) => ({
        id: 'L' + (i + 1),
        label: 'レイヤー ' + (i + 1),
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
        speed: 100, brightness: 100, contrast: 100, saturate: 100,
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

    const compCtx = els.compositor.getContext('2d');

    // ======================================================
    // 初期化
    // ======================================================
    function init() {
        applyStoredTheme();   // 保存済みテーマを最初に適用（対応するメニューバーも生成される）
        renderMedia();
        renderEffects();
        renderTextPresets();
        renderTrackHeaders();
        renderTracks();
        renderRuler();
        bindUI();
        restorePersistedState();   // 保存済みの解像度・再生ヘッド位置を復元
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
    // 一瞬で消えると味気ないので最低表示時間（700ms）を確保する。
    const SPLASH_MIN_MS = 700;            // スプラッシュの最低表示時間(ms)
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
                <div class="media-item__name" title="${m.name}">${m.name}</div>
            </div>
        `).join('');

        $$('.media-item').forEach((el) => {
            el.classList.toggle('is-active', el.dataset.media === state.selectedMediaId);
            const m = () => MEDIA.find((x) => x.id === el.dataset.media);

            el.addEventListener('dragstart', (e) => {
                const md = m();
                e.dataTransfer.setData('application/json', JSON.stringify({
                    kind: 'media', type: md.type, name: md.name, src: md.src || null,
                }));
            });
            // クリック → モニターに表示
            el.addEventListener('click', () => showInMonitor(m()));
            // ダブルクリック → タイムラインに追加
            el.addEventListener('dblclick', () => {
                const md = m();
                addClipToBestTrack(md.type, md.name, md.src);
            });
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
            return `
            <div class="track-header" data-track="${t.id}">
                <div class="track-header__icon">${i + 1}</div>
                <div class="track-header__label">${t.label}</div>
                <div class="track-header__ctrl">
                    <button class="track-header__btn" data-act="mute" title="ミュート">M</button>
                    <button class="track-header__btn" data-act="hide" title="表示切替">👁</button>
                </div>
            </div>`;
        }).join('');

        $$('.track-header__btn').forEach((b) => {
            b.addEventListener('click', () => {
                b.classList.toggle('is-off');
                renderViewer();
            });
        });
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

        $$('.track').forEach((trackEl) => {
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
                    const dur = data.type === 'image' || data.type === 'text' ? 3 : 5;
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
                probeDuration(m.src, m.type, (dur) => {
                    m.badge = formatRulerTime(Math.round(dur));
                    lastClip = placeClip(m.type, m.name, track, offset, dur, m.src);
                    offset += dur;
                    renderMedia();
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

    // ---- メディアプールへの登録（サムネ生成つき） ----
    function registerMedia(file) {
        const type = fileType(file);
        const src = URL.createObjectURL(file);
        const m = {
            id: 'm' + (state.nextId++),
            type, name: file.name, src,
            thumb: null,
            badge: type === 'image' ? 'IMG' : type.toUpperCase(),
        };
        MEDIA.push(m);
        generateThumbnail(src, type, (thumb) => {
            if (thumb) { m.thumb = thumb; renderMedia(); }
        });
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

    function addClipToBestTrack(type, name, src) {
        addClip(type, name, DEFAULT_TRACK, state.playhead, type === 'image' || type === 'text' ? 3 : 5, false, src);
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

            const inner = clip.type === 'audio' || clip.type === 'video'
                ? `<div class="clip__wave">${waveBars(clip.dur)}</div>` : '';
            el.innerHTML = `
                <div class="clip__handle clip__handle--l"></div>
                <div class="clip__label">${clip.name}</div>
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
        const move = (ev) => {
            const dx = (ev.clientX - startX) / state.zoom;
            if (side === 'r') {
                clip.dur = Math.max(0.5, Math.round((origDur + dx) * 10) / 10);
            } else {
                const newStart = Math.max(0, Math.min(origStart + dx, origStart + origDur - 0.5));
                clip.dur = Math.round((origDur - (newStart - origStart)) * 10) / 10;
                clip.start = Math.round(newStart * 10) / 10;
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

    function splitClipAt(clip, t) {
        if (t <= clip.start + 0.1 || t >= clip.start + clip.dur - 0.1) {
            toast('再生ヘッドをクリップ内に置いてください'); return;
        }
        const leftDur = Math.round((t - clip.start) * 10) / 10;
        const rightDur = Math.round((clip.dur - leftDur) * 10) / 10;
        clip.dur = leftDur;
        addClip(clip.type, clip.name, clip.track, t, rightDur, true);
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
        updateTimeDisplay();
        // 編集後、停止中ならプログラムモニターを更新
        if (!state.playing && state.monitorMode === 'program') {
            composite(state.playhead, false);
        }
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
        const W = els.compositor.width, H = els.compositor.height;
        compCtx.setTransform(1, 0, 0, 1, 0, 0);
        compCtx.filter = 'none';
        compCtx.globalAlpha = 1;
        compCtx.fillStyle = '#000';
        compCtx.fillRect(0, 0, W, H);

        const active = new Set();

        // トラックを下から上へ（=奥から手前へ）描画。テキストが最前面。
        for (let i = TRACKS.length - 1; i >= 0; i--) {
            const tr = TRACKS[i];
            const clip = activeClipOnTrack(tr.id, time);
            if (!clip) continue;
            active.add(clip.id);
            // クリップ自身の種類で映像か音声かを判定（レイヤーは種類を持たない）
            if (clip.type !== 'audio' && trackVisible(tr.id)) {
                drawVisualClip(clip);
            }
            // 動画の音声・オーディオクリップを同期再生
            syncAV(clip, time, playing, tr.id);
        }

        pauseInactive(active);
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

    function drawVisualClip(clip) {
        const W = els.compositor.width, H = els.compositor.height;
        const p = clip.props;

        if (clip.type === 'text') { drawTextClip(clip); return; }

        let media, mw, mh, ready = false;
        if (clip.type === 'video') {
            media = getMediaEl(clip);
            mw = media.videoWidth; mh = media.videoHeight;
            ready = media.readyState >= 2 && mw > 0;
        } else if (clip.type === 'image') {
            media = getImg(clip);
            mw = media.naturalWidth; mh = media.naturalHeight;
            ready = media.complete && mw > 0;
        } else {
            return; // 音声は描画なし
        }
        if (!ready) return;

        compCtx.save();
        compCtx.globalAlpha = Math.max(0, Math.min(1, p.opacity / 100));
        compCtx.filter = `brightness(${p.brightness}%) contrast(${p.contrast}%) saturate(${p.saturate}%)`;
        const cx = W / 2 + (p.x / 500) * (W / 2);
        const cy = H / 2 + (p.y / 500) * (H / 2);
        compCtx.translate(cx, cy);
        compCtx.rotate(p.rotate * Math.PI / 180);
        const fit = Math.min(W / mw, H / mh) * (p.scale / 100);
        const dw = mw * fit, dh = mh * fit;
        try { compCtx.drawImage(media, -dw / 2, -dh / 2, dw, dh); } catch (e) { /* not ready */ }
        compCtx.restore();
    }

    function drawTextClip(clip) {
        const W = els.compositor.width, H = els.compositor.height;
        const p = clip.props;
        compCtx.save();
        compCtx.globalAlpha = Math.max(0, Math.min(1, p.opacity / 100));
        const cx = W / 2 + (p.x / 500) * (W / 2);
        const cy = H / 2 + (p.y / 500) * (H / 2);
        compCtx.translate(cx, cy);
        compCtx.rotate(p.rotate * Math.PI / 180);
        const fs = W * 0.05 * (p.scale / 100);
        compCtx.font = `800 ${fs}px "Hiragino Sans","Yu Gothic UI",sans-serif`;
        compCtx.textAlign = 'center';
        compCtx.textBaseline = 'middle';
        compCtx.shadowColor = 'rgba(0,0,0,.7)';
        compCtx.shadowBlur = fs * 0.4;
        compCtx.shadowOffsetY = fs * 0.06;
        compCtx.fillStyle = '#fff';
        compCtx.fillText(clip.name, 0, 0);
        compCtx.restore();
    }

    // ---- クリップ用メディア要素（遅延生成・クリップに紐付け） ----
    function getMediaEl(clip) {
        if (clip._el) return clip._el;
        if (clip.type === 'video') {
            const v = document.createElement('video');
            v.src = clip.src; v.preload = 'auto'; v.playsInline = true;
            v.addEventListener('seeked', onMediaSettled);
            v.addEventListener('loadeddata', onMediaSettled);
            clip._el = v;
            return v;
        }
        if (clip.type === 'audio') {
            const a = new Audio(clip.src);
            a.preload = 'auto';
            clip._el = a;
            return a;
        }
        return null;
    }

    function getImg(clip) {
        if (clip._img) return clip._img;
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
        el.playbackRate = rate;
        el.muted = trackMuted(trackId);
        el.volume = state.volume;
        const local = (time - clip.start) * rate;
        const dur = el.duration;
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

    function togglePlay() {
        state.playing = !state.playing;
        // 再生/一時停止アイコンを切り替える（Tabler アイコン）
        els.btnPlay.innerHTML = state.playing
            ? '<i class="ti ti-fi ti-player-pause"></i>'
            : '<i class="ti ti-fi ti-player-play"></i>';
        if (state.playing) {
            enterProgram();                  // 再生は常に合成モニターで
            els.viewerCanvas.classList.add('program');
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
        state.playhead += dt;
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
        state.playhead = Math.max(0, Math.min(sec, state.duration));
        enterProgram();
        updatePlayhead();
        updateTimeDisplay();
        composite(state.playhead, state.playing);
        savePlayhead();   // 再生ヘッド位置をブラウザに保存
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
        const headerW = els.trackHeaders.offsetWidth;
        const x = headerW + state.playhead * state.zoom - els.tracksArea.scrollLeft;
        els.playhead.style.left = x + 'px';
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
    };

    // テーマ JS からの登録窓口（テーマ JS は main.js より後に読み込まれる）
    window.registerTheme = (name, hooks) => { themeHooks[name] = hooks || {}; };

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
            els.compositor.width = w; els.compositor.height = h;
            // モニターのアスペクト比を解像度に合わせて固定（CSS変数で制御）
            els.viewerCanvas.style.setProperty('--ar-w', w);
            els.viewerCanvas.style.setProperty('--ar-h', h);
        }
        composite(state.playhead, state.playing);
        if (!silent) toast(`解像度: ${v}`);
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
        // タイムラインのスクロールに合わせて再生ヘッドとレイヤーヘッダーを連動させる
        els.tracksArea.addEventListener('scroll', () => {
            updatePlayhead();
            // 縦スクロールをレイヤーヘッダー側にも反映する
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

        // 音量
        $('#volume').addEventListener('input', (e) => {
            state.volume = Number(e.target.value) / 100;
            for (const c of state.clips) {
                if (c._el) c._el.volume = state.volume;
            }
            // ソースモニターのプレビューにも反映
            els.previewVideo.volume = state.volume;
        });

        // キーボードショートカット
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

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
        files.forEach((f) => {
            const m = registerMedia(f);
            // 動画/音声は尺をバッジに反映
            if (m.type !== 'image') {
                probeDuration(m.src, m.type, (dur) => {
                    m.badge = formatRulerTime(Math.round(dur));
                    renderMedia();
                });
            }
        });
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
        let html = header ? `<div class="ctxmenu__header">${header}</div>` : '';
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
            { icon: '＋', label: 'タイムラインに追加', action: () => addClipToBestTrack(m.type, m.name, m.src) },
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
        renderClips();
        selectClip(c.id);
        toast('クリップを複製しました');
    }

    function copyClip(clip) {
        state.clipboard = { type: clip.type, name: clip.name, src: clip.src, dur: clip.dur, props: { ...clip.props } };
        toast('クリップをコピーしました');
    }

    function pasteClip(track, at) {
        const cb = state.clipboard;
        if (!cb) { toast('コピーされたクリップがありません'); return; }
        const dest = TRACKS.find((t) => t.id === track) ? track : DEFAULT_TRACK;
        const c = addClip(cb.type, cb.name, dest, at, cb.dur, true, cb.src);
        c.props = { ...cb.props };
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
            const url = els.compositor.toDataURL('image/png');
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

    // ロゴ文字のメニュー（全テーマ共通のアプリメニュー）。
    // メニューバーは対応ソフトごとに切り替わるが、これはテーマに依存せず常に同じ内容。
    const LOGO_MENU = {
        id: '__logo__',
        items: [
            { id: 'about',             label: 'Auriga Studio について', icon: 'info-circle' },
            { id: 'whats-new',         label: '新着情報',               icon: 'sparkles' },
            { type: 'separator' },
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
    }

    // トップメニューを開く
    function openTopMenu(btn, menu) {
        closeMenuBar();
        activeMenuId = menu.id;
        btn.classList.add('is-active');
        const panel = buildPanel(menu.items || [], 0);
        menuLayer.appendChild(panel);
        const r = btn.getBoundingClientRect();
        positionPanel(panel, r.left, r.bottom + 2);
    }

    // すべてのドロップダウンを閉じる
    function closeMenuBar() {
        menuLayer.innerHTML = '';
        activeMenuId = null;
        els.appMenu.querySelectorAll('.menu__item').forEach((b) => b.classList.remove('is-active'));
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
        const checked = (it.type === 'radio' || it.type === 'checkbox') && !!it.checked;
        el.className = 'appmenu__item'
            + (hasSub ? ' has-sub' : '')
            + (checked ? ' is-checked' : '');

        // 右側：ショートカット優先、なければチェック中のみチェックアイコン
        let keyHtml = '';
        if (it.shortcut) keyHtml = escapeHtml(it.shortcut);
        else if (checked) keyHtml = '<i class="ti ti-check"></i>';

        el.innerHTML = `
            <span class="appmenu__icon">${iconHtml(it.icon)}</span>
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
            case 'save-project':    toast('プロジェクトを保存しました 💾'); return;
            case 'save-project-as': toast('別名で保存しました 💾'); return;
            case 'undo':            toast('元に戻す（デモ）'); return;
            case 'redo':            toast('やり直し（デモ）'); return;
            case 'export-video':    toast('書き出しを開始しました… 🎞️'); return;
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
            // ---- ロゴ文字のメニュー（全テーマ共通） ----
            case 'theme-auriga':    applyTheme('auriga');   return;
            case 'theme-ymm4':      applyTheme('ymm4');     return;
            case 'theme-davinci':   applyTheme('davinci');  return;
            case 'theme-premiere':  applyTheme('premiere'); return;
            case 'mode-light':      applyMode('light');  return;
            case 'mode-dark':       applyMode('dark');   return;
            case 'mode-system':     applyMode('system'); return;
            case 'about':           showAboutModal(); return;
            case 'whats-new':       toast('新着情報（準備中）'); return;
            case 'preferences':     toast('環境設定（準備中）⚙️'); return;
            case 'keyboard-shortcuts': toast('キーボードショートカット（準備中）'); return;
            case 'check-updates':   toast('お使いのバージョンは最新です ✅'); return;
            case 'website':         toast('公式サイトを開きます 🌐'); return;
            case 'quit':            toast('終了（デモ）'); return;
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
            if (e.target.closest('.appmenu') || e.target.closest('#appMenu') || e.target.closest('#appLogoMenu')) return;
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
    // version.json の値を表示する順番とラベル（VS Code の About に倣う）
    const ABOUT_FIELDS = [
        { key: 'version',         label: 'Version' },
        { key: 'commit',          label: 'Commit' },
        { key: 'date',            label: 'Date' },
        { key: 'electron',        label: 'Electron' },
        { key: 'electronBuildId', label: 'ElectronBuildId' },
        { key: 'chromium',        label: 'Chromium' },
        { key: 'node',            label: 'Node.js' },
        { key: 'v8',              label: 'V8' },
        { key: 'os',              label: 'OS' },
    ];

    let aboutInfoCache = null;   // 読み込んだ version.json を保持

    // version.json を読み込んでモーダルを開く
    async function showAboutModal() {
        const modal = $('#aboutModal');
        const infoEl = $('#aboutInfo');
        if (!modal || !infoEl) return;
        if (!aboutInfoCache) {
            try {
                const res = await fetch('version.json');
                if (!res.ok) throw new Error('fetch failed');
                aboutInfoCache = await res.json();
            } catch (e) {
                toast('バージョン情報の読み込みに失敗しました');
                return;
            }
        }
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
        const clamped = Math.min(timelineMaxHeight(), Math.max(TL_MIN_HEIGHT, Math.round(h)));
        const timeline = $('.timeline');
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
            <div class="effect-item cloud-file" data-id="${f.id}" title="${f.name}">
                <span class="effect-item__icon"><i class="ti ${cloudFileIcon(f.mimeType)}"></i></span>
                <div class="cloud-file__info">
                    <div class="effect-item__name">${f.name}</div>
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
    // スマホ幅メニュー（ヘッダー操作をネスト）
    // ======================================================
    // 狭い画面では、アプリメニュー・ワークスペースを
    // ハンバーガーのパネルへ実体ごと移設する（イベントを保ったまま移動）。
    function bindMobileMenu() {
        const burger = $('#menuBurger');
        const panel = $('#mobilePanel');
        if (!burger || !panel) return;

        // 移設対象と、デスクトップ復帰時の戻し先
        const left = $('.menubar__left');
        const center = $('.menubar__center');
        const appMenu = $('#appMenu');
        const wsTabs = $('.workspace-tabs');

        const mq = window.matchMedia('(max-width: 720px)');
        let mobile = false;

        // パネルへ集約する（DOM ノードごと移動するのでイベントは維持される）
        function toMobile() {
            panel.append(appMenu, wsTabs);
            mobile = true;
        }
        // ヘッダーの元の位置・順序へ戻す
        function toDesktop() {
            closePanel();
            left.append(appMenu);               // ロゴの直後
            center.append(wsTabs);
            mobile = false;
        }
        function apply(e) {
            if (e.matches && !mobile) toMobile();
            else if (!e.matches && mobile) toDesktop();
        }

        function openPanel() { panel.hidden = false; burger.setAttribute('aria-expanded', 'true'); }
        function closePanel() { panel.hidden = true; burger.setAttribute('aria-expanded', 'false'); }

        burger.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.hidden ? openPanel() : closePanel();
        });
        document.addEventListener('click', (e) => {
            if (!panel.hidden && !e.target.closest('#mobilePanel, #menuBurger')) closePanel();
        });

        apply(mq);
        mq.addEventListener('change', apply);
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
