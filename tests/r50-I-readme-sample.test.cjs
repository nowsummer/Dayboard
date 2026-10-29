'use strict';
// r50 area I (2026-10-28 user: 「제주여행준비 아이콘은 너무 빨간색이라 좀 눈아파」): the colours of the README sample data
// (scripts/readme-sample.cjs). The trip list is not red or pink, and no list in the sidebar sits within two rows of one of the same
// colour family — the owner found green 장보기 and teal 제주 여행 two rows apart 「너무 비슷」 (2026-10-27). The second pass (2026-10-28
// review of r50 I) checks the whole sidebar, 업무 included: purple trip, blue 내 할 일 and indigo 업무 made a run of three blue-violet
// icons. The event the demo drags in the month view (가족 저녁 식사) is not the eye-straining pink either.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seedSample } = require('../scripts/readme-sample.cjs');
const D = require('../renderer/domain.js');

const PLANNED_TILE = '#ec5e67'; // renderer/app.js smart.planned.color

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function hue(hex) {
  const [r, g, b] = rgb(hex).map(v => v / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const redOrPink = hex => { const h = hue(hex); return h >= 330 || h < 20; };
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function lab(hex) {
  const [r, g, b] = rgb(hex).map(lin);
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// CIEDE2000 (Sharma, Wu, Dalal 2005).
function deltaE00(c1, c2) {
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2), rad = Math.PI / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1 = Math.hypot(a1p, b1), C2 = Math.hypot(a2p, b2);
  const hp = (b, a) => (!b && !a) ? 0 : (Math.atan2(b, a) / rad + 360) % 360;
  const h1 = hp(b1, a1p), h2 = hp(b2, a2p);
  let dh = C1 * C2 ? h2 - h1 : 0; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dL = L2 - L1, dC = C2 - C1, dH = 2 * Math.sqrt(C1 * C2) * Math.sin(dh * rad / 2);
  const Lb = (L1 + L2) / 2, Cbp = (C1 + C2) / 2;
  let hb = h1 + h2; if (C1 * C2) { hb = Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2; if (hb >= 360) hb -= 360; }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + 0.015 * (Lb - 50) ** 2 / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad) * 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
const whiteContrast = hex => { const [r, g, b] = rgb(hex).map(lin); return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05); };
// One colour family: the app palette's six closest pairs are all under 22 — red/pink 10.4, blue/indigo 15.3, indigo/purple 15.7,
// brown/gray 19.1, orange/yellow 19.4, orange/brown 21.1 — and every other pair is 25 or more.
const FAMILY = 22;

// The sample as the screenshots seed it, recorded instead of sent to an app.
async function sample(lang) {
  const lists = [], events = []; let id = 0;
  const invoke = async (name, payload = {}) => {
    if (name === 'list:update' && payload.id === 'local-inbox') lists.push({ id: 'local-inbox', ...payload, groupId: null });
    if (name === 'list:add') { const list = { id: `list-${++id}`, groupId: null, ...payload }; lists.push(list); return list; }
    if (name === 'event:add') events.push(payload);
    return { id: `item-${++id}`, ...payload };
  };
  await seedSample(invoke, new Date(2026, 9, 28, 9, 41), lang);
  // The sidebar's order (artifacts/r50-I/sidebar-full.cjs prints it): the group's lists, then 내 할 일, then the other loose lists.
  // Names are read as the sidebar shows them: the emoji the sample's own lists start with (2026-10-29) is their symbol, not their name.
  for (const l of lists) l.name = D.splitEmoji(l.name).title || l.name;
  const sidebar = [...lists.filter(l => l.groupId), lists.find(l => l.id === 'local-inbox'), ...lists.filter(l => !l.groupId && l.id !== 'local-inbox')];
  return { lists, events, sidebar };
}

const NAMES = { ko: { trip: '제주 여행 준비', family: '가족 저녁 식사', order: ['장보기', '읽을 책', '제주 여행 준비', '내 할 일', '업무'] },
  en: { trip: 'Lisbon trip', family: 'Family dinner', order: ['Groceries', 'Reading list', 'Lisbon trip', 'My Tasks', 'Work'] } };

for (const lang of ['ko', 'en']) {
  const n = NAMES[lang];
  test(`the sample trip list (${lang}) is calm and no sidebar list sits near one of its colour family`, async () => {
    const { lists, sidebar } = await sample(lang);
    assert.deepEqual(sidebar.map(l => l.name), n.order);
    for (const list of lists) assert.ok(D.LIST_PALETTE.includes(list.color.toLowerCase()), `${list.name} ${list.color} is one of the app's list colours`);
    assert.equal(new Set(lists.map(l => l.color.toLowerCase())).size, lists.length, 'every list its own colour');
    const trip = sidebar.find(l => l.name === n.trip).color.toLowerCase();
    assert.ok(!redOrPink(trip), `${trip} (hue ${Math.round(hue(trip))}) is not red or pink`);
    assert.notEqual(trip, '#30b0c7', 'not the teal of 2026-10-27');
    assert.ok(deltaE00(trip, PLANNED_TILE) >= FAMILY, `${trip} vs the 「예정」 tile: ${deltaE00(trip, PLANNED_TILE).toFixed(1)}`);
    for (let i = 0; i < sidebar.length; i++) for (let j = i + 1; j <= i + 2 && j < sidebar.length; j++) {
      const a = sidebar[i], b = sidebar[j], d = deltaE00(a.color, b.color);
      assert.ok(d >= FAMILY, `${a.name} ${a.color} and ${b.name} ${b.color}, ${j - i} row(s) apart: CIEDE2000 ${d.toFixed(1)}`);
    }
    // The colours chosen here keep a white glyph readable (WCAG non-text 3:1).
    for (const list of sidebar.filter(l => [n.trip, n.order[4]].includes(l.name))) assert.ok(whiteContrast(list.color) >= 3, `${list.name} ${list.color}: white glyph ${whiteContrast(list.color).toFixed(2)}:1`);
  });

  test(`the event the demo drags (${lang}) is calm and its own colour`, async () => {
    const { events } = await sample(lang);
    const family = events.find(e => e.title === n.family);
    assert.ok(family, 'seeded');
    const color = family.color.toLowerCase();
    assert.ok(D.LIST_PALETTE.includes(color));
    assert.ok(!redOrPink(color), `${color} (hue ${Math.round(hue(color))}) is not red or pink`);
    for (const other of events.filter(e => e !== family)) assert.notEqual(other.color.toLowerCase(), color, `${other.title} has another colour`);
  });
}
