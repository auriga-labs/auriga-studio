/* ======================================================
   Auriga Studio — プリロードスクリプト
   contextIsolation 有効のレンダラーへ、必要最小限の
   ネイティブ API を window.aurigaNative として公開する。
   ====================================================== */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aurigaNative', {
  // ローカル情報（git・ランタイムのバージョンなど）をメインプロセスから取得する
  getLocalInfo: () => ipcRenderer.invoke('auriga:local-info'),
});
