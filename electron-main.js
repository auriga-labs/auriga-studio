/* ======================================================
   Auriga Studio — Electron メインプロセス
   index.html（レンダラー）を表示するウィンドウを管理する。
   ※ ロジック本体（main.js）はレンダラー側で動く別ファイル。
   ====================================================== */
'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// 認証ポップアップを許可するオリジン（OAuth は window.open + postMessage で動く）
const OAUTH_ORIGIN = 'https://app.auriga.studio';

// メインウィンドウの参照を保持しておく（GC 防止）
let mainWindow = null;

// メインウィンドウを生成する
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    icon: path.join(__dirname, 'favicon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      // レンダラーは純粋なブラウザコード。Node 連携は不要なので無効のまま安全側に倒す。
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('index.html');

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
    return { action: 'allow' };
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
