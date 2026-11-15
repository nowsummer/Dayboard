'use strict';
// What the README's desktop pictures share (scripts/readme-widget-scene.cjs, scripts/readme-widgets.cjs): they are put together
// from the windows' own pictures over the wallpaper by scripts/readme-scene-compose.py, never taken from the screen (2026-10-29
// user: 「깃허브 영문 소개 페이지 gif에서 바탕화면 위젯을 소개해주는 화면에 뒷 배경이 바탕화면이 아니라 내 개인 구글 크롬 화면으로
// 녹화가 됐어」 → 「Electron으로 합성」). Call `desktopSwitches` before app ready.
// The wallpaper is 「D 새벽 능선」, drawn for the picture at its own size by scripts/readme-wallpaper.py (owner's pick 2026-11-14, as
// on the homepage), never the user's: the pictures neither read it into a layer nor let a widget paint it (holdBackdrops).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PAPER_COLOR = '#e9f0f7'; // behind the drawn wallpaper, as the homepage photo (never seen: the wallpaper fills the picture)
const OURS = 'readme:'; // the key of every backdrop the scripts send

// Drawn at a forced scale (2x by default, 1.25 on a 1920 px screen) for sharp pictures. Painted while covered too
// (the widgets sit on the desktop, under the user's windows): Windows' occlusion would stop their frames.
function desktopSwitches(app, scale) {
  app.commandLine.appendSwitch('force-device-scale-factor', String(scale));
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  holdBackdrops(app);
}

// The app sends each widget on the desktop the piece of the user's wallpaper behind it (main.cjs sendBackdrop). Here no such piece
// reaches a widget: before the script's own backdrop it goes as a plain colour (its token kept, so the widget's reveal still completes
// and it counts as on the wallpaper), and after it the script's backdrop is kept (sent again with the token when the app waits for one).
function holdBackdrops(app) {
  app.on('web-contents-created', (_event, contents) => {
    const send = contents.send.bind(contents);
    let ours = null;
    contents.send = (channel, payload, ...rest) => {
      if (channel !== 'dayboard:backdrop' || !payload) return send(channel, payload, ...rest);
      if (String(payload.key || '').startsWith(OURS)) { ours = payload; return send(channel, payload, ...rest); }
      const token = payload.token ? { token: payload.token } : {};
      if (ours) return token.token ? send(channel, { ...ours, ...token }) : undefined;
      return send(channel, { color: PAPER_COLOR, key: 'color:' + PAPER_COLOR, x: 0, y: 0, width: 0, height: 0, repeat: false, ...token });
    };
  });
}

// What a widget's renderer paints behind its glass now (renderer/app.js `backdrop`): the pictures check it is the script's.
async function backdropKey(win) {
  return win.webContents.executeJavaScript('typeof backdrop !== "undefined" && backdrop ? String(backdrop.key) : ""');
}
async function checkBackdrop(win, what) {
  const key = await backdropKey(win);
  if (!key.startsWith(OURS)) throw new Error(`${what}: its backdrop is ${JSON.stringify(key)}, not the drawn wallpaper`);
  return key;
}

// A rectangle on the primary display (where the pictures are made), in physical pixels. Worked out here: Electron's
// dipToScreenRect(null, …) put a rect touching the screen's right edge on another monitor (the photo's calendar came out 1080 px low).
function physicalRect(screen, rect) {
  const display = screen.getPrimaryDisplay(); const origin = display.nativeOrigin || { x: 0, y: 0 }; const k = display.scaleFactor;
  return { x: origin.x + Math.round((rect.x - display.bounds.x) * k), y: origin.y + Math.round((rect.y - display.bounds.y) * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) };
}

// The wallpaper behind `rect` (DIP): 「D 새벽 능선」 drawn at the picture's size in physical pixels and saved in `dir`; returns the
// picture's meta in physical pixels. Each widget is sent the same picture at its place in it (backdropAt), so the glass and the
// desktop around it meet without a seam.
async function wallpaperLayer({ screen }, rect, dir, scale) {
  const area = physicalRect(screen, rect);
  const drawn = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-readme-wall-'));
  const result = spawnSync('py', ['-3', '-I', path.join(__dirname, 'readme-wallpaper.py'), drawn, String(area.width), String(area.height), 'D'], { encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout ? `[desktop] wallpaper ${result.stdout}` : '');
  if (result.status !== 0) throw new Error(`the wallpaper could not be drawn: ${result.stderr || result.error?.message}`);
  const file = path.join(dir, 'wallpaper.png');
  fs.copyFileSync(path.join(drawn, 'wall-D.png'), file);
  fs.rmSync(drawn, { recursive: true, force: true });
  const url = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  const meta = { scale, scene: area, color: PAPER_COLOR, layers: [],
    wallpaper: { file: 'wallpaper.png', left: area.x, top: area.y, right: area.x + area.width, bottom: area.y + area.height, repeat: false } };
  // What a widget at `rect` (physical) is sent to paint behind its glass (as main.cjs sendBackdrop sends the app's, lib/wallpaper.cjs
  // backdropPayload) for its place in the picture; not written to meta.json. `key` starts with 「readme:」 (holdBackdrops).
  Object.defineProperty(meta, 'backdropAt', { enumerable: false, value: (rect, key) => ({
    color: meta.color, key, url, x: area.x - rect.x, y: area.y - rect.y, width: area.width, height: area.height, repeat: false,
  }) });
  return meta;
}

function compose(layersDir, out, meta) {
  fs.writeFileSync(path.join(layersDir, 'meta.json'), JSON.stringify(meta, null, 1));
  const result = spawnSync('py', ['-3', '-I', path.join(__dirname, 'readme-scene-compose.py'), layersDir, out], { encoding: 'utf8', windowsHide: true });
  process.stdout.write(result.stdout || '');
  if (result.status !== 0) throw new Error(`composing failed: ${result.stderr || result.error?.message}`);
}

module.exports = { desktopSwitches, holdBackdrops, physicalRect, wallpaperLayer, compose, checkBackdrop };
