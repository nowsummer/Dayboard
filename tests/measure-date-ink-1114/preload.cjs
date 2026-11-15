'use strict';
// A stand-in for the app's preload: window.dayboard answers from the measuring main process (no store of the user's, no network).
const { contextBridge, ipcRenderer } = require('electron');
const none = () => () => {};
contextBridge.exposeInMainWorld('dayboard', Object.freeze({
  invoke: (command, payload = {}) => ipcRenderer.invoke('measure:invoke', command, payload),
  subscribe(callback) { const l = (_e, s) => callback(s); ipcRenderer.on('measure:state', l); return () => ipcRenderer.removeListener('measure:state', l); },
  onWindowState: none, onBackdrop: none, onOpenDay: none, onOpenTask: none, onOpenView: none, onGlassPreview: none, onFlush: none,
}));
