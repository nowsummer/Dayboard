'use strict';
// A widget's own place (2026-11-11 owner: 「위젯화면 크기나 위치 고정을 했는데 오늘 컴퓨터 켜니깐 내가 기존에 크기 좀 키운 후 고정한 상태보다
// 작게 되어 있던데(거의 기본값인 듯)」): the screen it is on and where on that screen, in that screen's DIP, at the size the user gave it.
// The old homeBounds kept absolute desktop coordinates, which move whenever the main screen or the arrangement changes — the HDMI
// screen at x 1536–3456 beside a main laptop is at 0–1920 once it is the main screen — so a place kept that way was on no screen for
// good and the widget waited on the main screen at every start. Tests: tests/widget-home-1111.test.cjs.
const { onScreen } = require('./desktop.cjs');

const finite = value => typeof value === 'number' && Number.isFinite(value);
const isRect = rect => Boolean(rect) && ['x', 'y', 'width', 'height'].every(key => finite(rect[key]));
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

// A screen as it can be found again: Electron's id, else — Windows may number a screen anew when it comes back — its name and its pixels.
function screenKey(display) {
  const scale = display.scaleFactor || 1;
  return { id: display.id, label: typeof display.label === 'string' ? display.label : '', internal: Boolean(display.internal),
    width: Math.round(display.bounds.width * scale), height: Math.round(display.bounds.height * scale) };
}
// Another monitor on the same port (the office one at work, another at home) can come back under the same id: a different name is a
// different screen (2026-11-11 owner: 「지금 쓰고 있는 모니터는 회사 모니터인데, 집 모니터에 꽂을 때도 있어」).
const namesAgree = (a, b) => !a.label || !b.label || a.label === b.label;
const lookAlike = (a, b) => a.label === b.label && a.internal === b.internal && a.width === b.width && a.height === b.height;
const sameScreen = (a, b) => Boolean(a && b) && ((a.id === b.id && namesAgree(a, b)) || lookAlike(a, b));
function findScreen(key, displays) {
  if (!key) return null;
  const byId = displays.find(display => display.id === key.id && namesAgree(key, screenKey(display)));
  if (byId) return byId;
  const like = displays.filter(display => lookAlike(key, screenKey(display)));
  return like.length === 1 ? like[0] : null;
}
// The screen a rectangle is on: the one it overlaps most; null when it is on none.
function screenOf(rect, displays) {
  let best = null, most = 0;
  for (const display of displays) { const area = overlap(rect, display.bounds); if (area > most) { best = display; most = area; } }
  return best;
}
const onAnyScreen = (rect, displays) => isRect(rect) && Boolean(screenOf(rect, displays));
// Two placements a pixel or two apart are one: an attached widget read back at 125% drifts by one.
const sameRect = (a, b, slack = 2) => isRect(a) && isRect(b) && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= slack);

const validKey = key => Boolean(key) && (finite(key.id) || typeof key.id === 'string') && typeof key.label === 'string'
  && typeof key.internal === 'boolean' && finite(key.width) && finite(key.height);
function validHome(home) { return isRect(home) && validKey(home?.screen); }
// A rectangle on the screens connected now, as a home; null when it is on none of them.
function homeOf(rect, displays) {
  if (!isRect(rect)) return null;
  const display = screenOf(rect, displays);
  return display ? { screen: screenKey(display), x: Math.round(rect.x - display.bounds.x), y: Math.round(rect.y - display.bounds.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null;
}
// A home on its screen, when that screen is connected: { display, rect } (absolute DIP), else null.
function homeOn(home, displays) {
  if (!validHome(home)) return null;
  const display = findScreen(home.screen, displays);
  return display ? { display, rect: { x: display.bounds.x + home.x, y: display.bounds.y + home.y, width: home.width, height: home.height } } : null;
}
// The spots the user gave a widget while its own screen was away (spots, main.cjs setPlace), one per setup — the screens connected
// together, as Windows keeps a window's place per monitor setup: the laptop alone, the laptop with the home monitor. The laptop is in
// both, so a spot is the setup's, not the screen's. The latest first, at most four; a setup never seen opens in a free spot.
const SPOTS = 4;
const setupOf = displays => displays.map(screenKey);
const sameSetup = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every(key => b.some(other => sameScreen(key, other)));
function spotOf(rect, displays) {
  const spot = homeOf(rect, displays);
  return spot && { ...spot, setup: setupOf(displays) };
}
function rememberSpot(spots, spot) {
  return [spot, ...(Array.isArray(spots) ? spots : []).filter(item => validSpot(item) && !sameSetup(item.setup, spot.setup))].slice(0, SPOTS);
}
// The spot for the setup connected now: { display, rect }, else null.
function spotOn(spots, displays) {
  const setup = setupOf(displays);
  const spot = (Array.isArray(spots) ? spots : []).find(item => validSpot(item) && sameSetup(item.setup, setup));
  return spot ? homeOn(spot, displays) : null;
}
const validSpot = spot => validHome(spot) && Array.isArray(spot.setup) && spot.setup.length > 0 && spot.setup.length <= 8 && spot.setup.every(validKey);
const validSpots = spots => Array.isArray(spots) && spots.length > 0 && spots.length <= SPOTS && spots.every(validSpot);
const SEEN = 16;
const validSeen = seen => Array.isArray(seen) && seen.length > 0 && seen.length <= SEEN && seen.every(validKey);
// An older absolute place (homeBounds) on no connected screen when the user gives the widget a place (main.cjs setPlace): its screen may be
// away (the monitor unplugged before the update) or here under other coordinates (the main screen changed since, 2026-11-11). It is not
// dropped (2026-11-13 Codex review N2: a lock on the laptop with the monitor away lost the place there for good) but kept aside with the
// screens connected now (seen): the user's place stands for each of those, and the older one comes back only on a screen never among them.
function asideOf(old, displays) {
  if (!isRect(old) || onScreen(old, displays)) return null;
  const seen = validSeen(old.seen) ? [...old.seen] : [];
  for (const key of setupOf(displays)) if (!seen.some(other => sameScreen(other, key))) seen.push(key);
  return { x: old.x, y: old.y, width: old.width, height: old.height, seen: seen.slice(-SEEN) };
}
// What a record says about its own place, read on the screens connected now: { home } — since 2026-11-11; or one made from the older
// absolute rectangles when that rectangle is on a connected screen ({ home, migrated }): homeBounds, the old place kept while its screen
// was away, else bounds; or { legacy }, such a rectangle on no connected screen, kept as the old build kept it (it may still come back).
// migrated: the record takes this home and loses its homeBounds. An older place kept aside beside a home (asideOf) is that home once it is on
// a screen that was not connected whenever the user gave a place — its own screen is back — and goes once it is on one that was (the user's
// place stands there); on no screen it stays aside.
function ownPlace(widget, displays) {
  const old = isRect(widget?.homeBounds) ? widget.homeBounds : null;
  if (validHome(widget?.home)) {
    if (!old) return { home: widget.home };
    const display = onScreen(old, displays) ? screenOf(old, displays) : null;
    if (!validSeen(old.seen)) return { home: widget.home, migrated: true };
    if (!display) return { home: widget.home };
    const back = !old.seen.some(key => sameScreen(key, screenKey(display)));
    return { home: back ? homeOf(old, displays) : widget.home, migrated: true };
  }
  const place = old || (isRect(widget?.bounds) ? widget.bounds : null);
  if (!place) return {};
  const home = onScreen(place, displays) && homeOf(place, displays);
  return home ? { home, migrated: true } : { legacy: { x: place.x, y: place.y, width: place.width, height: place.height } };
}

// Which moves of a widget window are the user's choice of place. Dayboard's own placements (an open, the desktop attach, a return, a
// wait on the main screen) end where it put the window (placed); Windows moves and resizes windows around a screen change, a wake or an
// unlock (screens) — those are never the user's; a drag by the head sends 'will-move' first and a size from the widget's own edges
// comes through widget:resize (user). A move nothing explains is a drag too, once two seconds passed with no screen change around it
// (a window attached to the desktop may get no 'will-move'); judge answers null until then.
const USER_MS = 3000, QUIET_MS = 10000, SETTLE_MS = 2000;
function createPlaceWatch({ now = Date.now } = {}) {
  const placed = new Map(), user = new Map(), moved = new Map();
  let screensAt = -Infinity;
  return {
    placed(id, rect) { placed.set(id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }); },
    user(id) { user.set(id, now()); },
    moved(id) { moved.set(id, now()); },
    // A screen change ends every user mark: what Windows does to the window after it is not the user's, even within USER_MS of a drag.
    screens() { screensAt = now(); user.clear(); },
    forget(id) { placed.delete(id); user.delete(id); moved.delete(id); },
    // final: the app is quitting, so there is no later to wait for.
    judge(id, rect, { final = false } = {}) {
      const at = now();
      if (at - (user.get(id) ?? -Infinity) < USER_MS) return true;
      if (sameRect(placed.get(id), rect)) return false;
      const movedAt = moved.get(id) ?? at;
      if (screensAt >= movedAt - QUIET_MS) return false;
      if (!final && at - movedAt < SETTLE_MS) return null;
      return true;
    },
  };
}

module.exports = { screenKey, findScreen, sameScreen, sameSetup, screenOf, onAnyScreen, sameRect, validHome, homeOf, homeOn, spotOf, rememberSpot, spotOn, validSpots, validSeen, asideOf, ownPlace, createPlaceWatch, SETTLE_MS };
