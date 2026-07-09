/* ======================================================
   Auriga Studio — Electron メインプロセス
   index.html（レンダラー）を表示するウィンドウを管理する。
   ※ ロジック本体（main.js）はレンダラー側で動く別ファイル。
   ====================================================== */
'use strict';

const { app, BrowserWindow, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// 認証ポップアップを許可するオリジン（OAuth は window.open + postMessage で動く）
const OAUTH_ORIGIN = 'https://app.auriga.studio';

// ウィンドウの位置・サイズ・最大化状態を保存するファイル
const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');
const DEFAULT_WINDOW_STATE = { width: 1440, height: 900, x: undefined, y: undefined, isMaximized: false };

// メインウィンドウの参照を保持しておく（GC 防止）
let mainWindow = null;

// 前回終了時のウィンドウ状態をファイルから読み込む（無い・壊れている場合は既定値）
function loadWindowState() {
  try {
    const raw = fs.readFileSync(WINDOW_STATE_PATH, 'utf-8');
    const saved = JSON.parse(raw);
    if (typeof saved.width === 'number' && typeof saved.height === 'number') {
      return { ...DEFAULT_WINDOW_STATE, ...saved };
    }
  } catch (err) {
    // 初回起動やファイル破損時は既定値を使う
  }
  return { ...DEFAULT_WINDOW_STATE };
}

// ウィンドウ状態をファイルへ保存する
function persistWindowState(state) {
  try {
    fs.mkdirSync(path.dirname(WINDOW_STATE_PATH), { recursive: true });
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(state));
  } catch (err) {
    // 保存に失敗しても致命的ではないため無視する
  }
}

// 保存されていた座標が現在接続中のディスプレイ上に実在するか確認する
// （モニター構成が変わって画面外に復元されるのを防ぐ）
function isPositionOnScreen(x, y, width, height) {
  if (typeof x !== 'number' || typeof y !== 'number') return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      x < area.x + area.width &&
      x + width > area.x &&
      y < area.y + area.height &&
      y + height > area.y
    );
  });
}

// メインウィンドウを生成する
function createWindow() {
  const windowState = loadWindowState();

  const windowOptions = {
    width: windowState.width,
    height: windowState.height,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    icon: path.join(__dirname, 'favicon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      // レンダラーは純粋なブラウザコード。Node 連携は不要なので無効のまま安全側に倒す。
      nodeIntegration: false,
      contextIsolation: true,
    },
  };

  if (isPositionOnScreen(windowState.x, windowState.y, windowState.width, windowState.height)) {
    windowOptions.x = windowState.x;
    windowOptions.y = windowState.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (windowState.isMaximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.loadFile('index.html');

  // リサイズ・移動のたびに書き込むと重いので、変化を貯めてから間引いて保存する
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistWindowState(windowState), 300);
  };

  const captureBoundsIfNormal = () => {
    // 最大化・最小化中の bounds は「元のサイズ」ではないので取り込まない
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      Object.assign(windowState, mainWindow.getBounds());
    }
  };

  mainWindow.on('resize', () => { captureBoundsIfNormal(); scheduleSave(); });
  mainWindow.on('move', () => { captureBoundsIfNormal(); scheduleSave(); });
  mainWindow.on('maximize', () => { windowState.isMaximized = true; scheduleSave(); });
  mainWindow.on('unmaximize', () => { windowState.isMaximized = false; scheduleSave(); });

  mainWindow.on('close', () => {
    clearTimeout(saveTimer);
    windowState.isMaximized = mainWindow.isMaximized();
    captureBoundsIfNormal();
    persistWindowState(windowState);
  });

  // window.open の扱い：OAuth 系は子ウィンドウとして開き（opener/postMessage を維持）、
  // それ以外の外部リンクは既定ブラウザで開く。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(OAUTH_ORIGIN) || url.startsWith('https://accounts.google.com')) {
      return { action: 'allow' };
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    // http(s) 以外（file: など）は安全のため開かない
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 起動準備が整ったらウィンドウを開く
app.whenReady().then(() => {
  createWindow();

  // macOS 風の挙動：ウィンドウが無い状態でアクティブ化されたら開き直す
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// すべてのウィンドウが閉じたら終了（Windows 想定）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
