'use strict';
// What the README's desktop pictures share (scripts/readme-widget-scene.cjs, scripts/readme-widgets.cjs): they are put together
// from the windows' own pictures over the wallpaper by scripts/readme-scene-compose.py, never taken from the screen (2026-10-29
// user: 「깃허브 영문 소개 페이지 gif에서 바탕화면 위젯을 소개해주는 화면에 뒷 배경이 바탕화면이 아니라 내 개인 구글 크롬 화면으로
// 녹화가 됐어」 → 「Electron으로 합성」). Call `desktopSwitches` before app ready.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createWallpaper } = require('../lib/wallpaper.cjs');

// Drawn at a forced scale (2x by default, 1.25 on a 1920 px screen) for sharp pictures. Painted while covered too
// (the widgets sit on the desktop, under the user's windows): Windows' occlusion would stop their frames.
function desktopSwitches(app, scale) {
  app.commandLine.appendSwitch('force-device-scale-factor', String(scale));
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

// A rectangle on the primary display (where the pictures are made), in physical pixels. Worked out here: Electron's
// dipToScreenRect(null, …) put a rect touching the screen's right edge on another monitor (the photo's calendar came out 1080 px low).
function physicalRect(screen, rect) {
  const display = screen.getPrimaryDisplay(); const origin = display.nativeOrigin || { x: 0, y: 0 }; const k = display.scaleFactor;
  return { x: origin.x + Math.round((rect.x - display.bounds.x) * k), y: origin.y + Math.round((rect.y - display.bounds.y) * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) };
}

// The wallpaper behind `rect` (DIP) as Dayboard reads it for the widgets' glass — the same picture, placement and pixels a widget
// shows around its card, so the two meet without a seam — saved in `dir`; returns the picture's meta in physical pixels.
async function wallpaperLayer({ screen, nativeImage }, rect, dir, scale) {
  const area = physicalRect(screen, rect);
  const paper = await createWallpaper({ nativeImage, log: message => console.log('[desktop]', message) }).scene();
  const holds = item => area.x >= item.rect.left && area.x < item.rect.right && area.y >= item.rect.top && area.y < item.rect.bottom;
  const monitor = paper.monitors.find(holds) || paper.monitors[0];
  if (!monitor || monitor.image === undefined) throw new Error('the wallpaper could not be read');
  const image = monitor.image;
  if (image) fs.writeFileSync(path.join(dir, 'wallpaper.jpg'), Buffer.from(image.url.slice(image.url.indexOf(',') + 1), 'base64'));
  const meta = { scale, scene: area, color: paper.color || '#000000', layers: [],
    wallpaper: image ? { file: 'wallpaper.jpg', left: image.left, top: image.top, right: image.right, bottom: image.bottom, repeat: image.repeat } : null };
  // What a widget at `rect` (physical) is sent to paint behind its glass (main.cjs sendBackdrop, lib/wallpaper.cjs backdropPayload)
  // for its place in the picture rather than its real one; not written to meta.json.
  Object.defineProperty(meta, 'backdropAt', { enumerable: false, value: (rect, key) => ({
    color: meta.color, key, url: image ? image.url : undefined,
    x: image ? image.left - rect.x : 0, y: image ? image.top - rect.y : 0,
    width: image ? image.right - image.left : 0, height: image ? image.bottom - image.top : 0, repeat: image ? image.repeat : false,
  }) });
  return meta;
}

function compose(layersDir, out, meta) {
  fs.writeFileSync(path.join(layersDir, 'meta.json'), JSON.stringify(meta, null, 1));
  const result = spawnSync('py', ['-3', '-I', path.join(__dirname, 'readme-scene-compose.py'), layersDir, out], { encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || '');
  if (result.status !== 0) throw new Error(`composing failed: ${result.stderr || result.error?.message}`);
}

module.exports = { desktopSwitches, physicalRect, wallpaperLayer, compose };
