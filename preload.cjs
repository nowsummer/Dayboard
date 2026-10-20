'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The main process asks every window to flush unsaved note drafts before it
// closes or quits. The renderer registers one handler; the reply carries the
// token back so a late or forged reply cannot complete another window's flush.
let flushHandler = null;
ipcRenderer.on('dayboard:flush', async (_event, payload) => {
  const token = payload && typeof payload.token === 'string' ? payload.token : null;
  if (!token) return;
  let error = null;
  try { if (flushHandler) await flushHandler(); }
  catch (failure) { error = String(failure?.message || failure || '메모를 저장하지 못했습니다.').slice(0, 1000); }
  ipcRenderer.send('dayboard:flushed', { token, error });
});

contextBridge.exposeInMainWorld('dayboard', Object.freeze({
  invoke(command, payload = {}) {
    if (typeof command !== 'string') return Promise.reject(new Error('올바른 명령이 필요합니다.'));
    // Electron wraps main-process rejections as "Error invoking remote method
    // 'dayboard:invoke': Error: <message>"; surface only the Korean message.
    return ipcRenderer.invoke('dayboard:invoke', command, payload).catch(error => {
      const raw = String(error?.message ?? error ?? '');
      throw new Error(raw.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '') || '요청을 처리하지 못했습니다.');
    });
  },
  subscribe(callback) {
    if (typeof callback !== 'function') throw new TypeError('변경 알림 함수가 필요합니다.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('dayboard:state', listener);
    return () => ipcRenderer.removeListener('dayboard:state', listener);
  },
  // Desktop widgets: the piece of wallpaper behind the window (or null to drop it).
  onBackdrop(callback) {
    if (typeof callback !== 'function') throw new TypeError('배경 함수가 필요합니다.');
    const listener = (_event, backdrop) => callback(backdrop);
    ipcRenderer.on('dayboard:backdrop', listener);
    return () => ipcRenderer.removeListener('dayboard:backdrop', listener);
  },
  onFlush(callback) {
    if (typeof callback !== 'function') throw new TypeError('저장 함수가 필요합니다.');
    flushHandler = callback;
    return () => { if (flushHandler === callback) flushHandler = null; };
  }
}));
