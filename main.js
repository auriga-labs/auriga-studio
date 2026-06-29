/* ======================================================
   Auriga Studio — 動画編集UI ロジック
   ====================================================== */
(() => {
    'use strict';

    // ---- 定数 ----
    const FPS = 30;
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
    };

    // ---- トラック定義（上から） ----
    const TRACKS = [
        { id: 'T1', kind: 'text',  label: 'テキスト', icon: 'T' },
        { id: 'V2', kind: 'video', label: 'ビデオ 2', icon: '▦' },
        { id: 'V1', kind: 'video', label: 'ビデオ 1', icon: '▦' },
        { id: 'A1', kind: 'audio', label: 'オーディオ', icon: '♪' },
    ];

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
        renderMedia();
        renderEffects();
        renderTextPresets();
        renderTrackHeaders();
        renderTracks();
        renderRuler();
        bindUI();
        updateTimeDisplay();
        updatePlayhead();
        els.viewerCanvas.classList.add('program');   // 既定はプログラム（合成）モニター
        composite(state.playhead, false);
        toast('Auriga Studio へようこそ 🎬');
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
            el.addEventListener('dblclick', () => addClip('text', TEXT_PRESETS[i].name, 'T1', state.playhead, 3));
        });
    }

    // ======================================================
    // 描画：トラックヘッダー
    // ======================================================
    function renderTrackHeaders() {
        els.trackHeaders.innerHTML = TRACKS.map((t) => {
            const iconCls = t.kind === 'audio' ? 'a' : t.kind === 'text' ? 't' : 'v';
            return `
            <div class="track-header" data-track="${t.id}">
                <div class="track-header__icon track-header__icon--${iconCls}">${t.icon}</div>
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

    // 適切なトラックへ自動振り分け（落としたトラックが種別違いなら補正）
    function placeClip(type, name, track, start, dur, src) {
        const kind = TRACKS.find((t) => t.id === track)?.kind;
        if (type === 'audio' && kind !== 'audio') track = 'A1';
        if (type !== 'audio' && kind === 'audio') track = 'V1';
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
        const track = type === 'audio' ? 'A1' : type === 'text' ? 'T1' : 'V1';
        addClip(type, name, track, state.playhead, type === 'image' || type === 'text' ? 3 : 5, false, src);
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
            if (tr.kind !== 'audio' && trackVisible(tr.id)) {
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

    // ======================================================
    // 再生コントロール
    // ======================================================
    let rafId = null;
    let lastTs = 0;

    function togglePlay() {
        state.playing = !state.playing;
        els.btnPlay.textContent = state.playing ? '⏸' : '▶';
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
    // UI バインド
    // ======================================================
    function bindUI() {
        bindProps();
        bindContextMenu();

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
            tab.addEventListener('click', () => {
                $$('.panel--media .ptab').forEach((t) => t.classList.remove('is-active'));
                tab.classList.add('is-active');
                $$('.ptab-content').forEach((c) =>
                    c.classList.toggle('is-active', c.dataset.content === tab.dataset.tab));
            });
        });

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

        // タイムラインクリックでシーク
        els.tracksArea.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;   // 右クリックは無視
            if (e.target.closest('.clip')) return;
            const rect = els.tracksArea.getBoundingClientRect();
            const x = e.clientX - rect.left + els.tracksArea.scrollLeft;
            seek(x / state.zoom);
            // 空白クリックで選択解除
            if (!e.target.closest('.clip')) selectClip(null);
        });
        els.tracksArea.addEventListener('scroll', updatePlayhead);

        // ルーラードラッグでスクラブ
        els.ruler.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const scrub = (ev) => {
                const rect = els.tracksArea.getBoundingClientRect();
                const x = ev.clientX - rect.left + els.tracksArea.scrollLeft;
                seek(x / state.zoom);
            };
            scrub(e);
            const up = () => {
                document.removeEventListener('mousemove', scrub);
                document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mousemove', scrub);
            document.addEventListener('mouseup', up);
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
        $('#btnSave').addEventListener('click', () => toast('プロジェクトを保存しました 💾'));
        $('#btnExport').addEventListener('click', () => toast('書き出しを開始しました… 🎞️'));

        // 解像度切替
        $('#resSelect').addEventListener('change', (e) => {
            const v = e.target.value;
            const ratio = v.includes('9:16') ? '9/16'
                : v.includes('1:1') ? '1/1' : '16/9';
            els.viewerCanvas.style.aspectRatio = ratio;
            // キャンバスの解像度を更新（"1920 × 1080" を解析）
            const m = v.match(/(\d+)\s*[×x]\s*(\d+)/);
            if (m) { els.compositor.width = +m[1]; els.compositor.height = +m[2]; }
            composite(state.playhead, state.playing);
            toast(`解像度: ${v}`);
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
                            const tr = c ? c.track : (state.clipboard.type === 'audio' ? 'A1' : state.clipboard.type === 'text' ? 'T1' : 'V1');
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
            const mediaEl = e.target.closest('.media-item');
            const trackEl = e.target.closest('.track');
            const viewerEl = e.target.closest('.viewer__canvas');

            if (clipEl) {
                e.preventDefault();
                const clip = state.clips.find((c) => c.id === clipEl.dataset.clip);
                if (clip) { selectClip(clip.id); showClipMenu(e.clientX, e.clientY, clip); }
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
            { icon: '🅰', label: 'ここにテキストを追加', disabled: trackEl.dataset.track !== 'T1',
              action: () => addClip('text', 'テキスト', 'T1', at, 3, false) },
            { separator: true },
            { icon: '⏱', label: 'ここへ再生ヘッドを移動', action: () => seek(at) },
            { icon: '🔍', label: 'ズームをリセット', action: () => { $('#zoom').value = 60; $('#zoom').dispatchEvent(new Event('input')); } },
        ], 'タイムライン');
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
        const dest = TRACKS.find((t) => t.id === track) ? track
            : (cb.type === 'audio' ? 'A1' : cb.type === 'text' ? 'T1' : 'V1');
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
