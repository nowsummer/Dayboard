'use strict';
// The 「바탕화면 위젯」 gallery's stage picture (2026-11-14 owner: 「D 새벽 능선으로 해주고, 앱 내 위젯 화면이나 깃허브나 ms 스토어나
// 홈페이지나 모두 같은걸로 통일해줘」, after the stretched 「새벽 풍경」's grey curves looked 「어색하고 부자연스러워서」). The homepage
// draft's wallpaper.py style D (light) and N (dark) as one inline SVG per theme in styles.css 「Gallery stages」 — no binary asset, so
// scripts/export-public-source BINARY_FILES stays as it is. What this holds: both themes set, each SVG parses and refers only to itself,
// only its documented palette is written (every blend is a palette colour at an opacity), the three crests are wallpaper.py's own sines
// (seeds 11/23/37) at 932x230, the slicing over the three stages is untouched, the picture is drawn 20px low in every stage with the
// sky's own top colour above it (2026-11-14 owner 「20px 내리기」), and the near ridge crosses each card on its bottom corners' arc (D7)
// at 1180/1240/1600px windows, with the stage and card sizes and the drop read from styles.css. Strings and numbers only in the asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8').replace(/\r\n?/g, '\n');
const lines = css.split('\n');

// wallpaper.py D and N, as the CSS comment lists them.
const PALETTE = {
  light: ['#d9e5f4', '#f1f4f8', '#fcefe0', '#dbe3ef', '#e8edf5', '#c6d1e4', '#dbe2ee', '#afbdd5', '#cdd6e6', '#fff'],
  dark: ['#1d2636', '#3a4254', '#5b5160', '#3c4558', '#444d60', '#323b4e', '#3d4659', '#283245', '#353f52', '#4a5266', '#fff'],
};
// wallpaper.py ridge_line(base, seed, amps): [base, [[amplitude, frequency, phase] …]] from numpy default_rng(11 / 23 / 37).
const RIDGES = [
  [0.5, [[0.03, 0.337657, 3.137055], [0.014, 0.958318, 0.180258], [0.006, 1.878193, 5.832122], [0.0025, 4.007180, 0.815394]]],
  [0.62, [[0.045, 0.402108, 4.030401], [0.02, 0.826392, 0.714449], [0.008, 2.196608, 5.362429], [0.003, 4.188455, 1.369851]]],
  [0.76, [[0.05, 0.403273, 4.157387], [0.022, 0.809749, 4.415833], [0.009, 1.985946, 2.828035], [0.0035, 5.263248, 0.404839]]],
];
const WP = 1864, HP = 460; // the reference picture (1864x460 = the SVG's 932x230 at 2x)

function stageRule(prefix) {
  const found = lines.filter(l => l.startsWith(prefix));
  assert.equal(found.length, 1, `one rule starts with ${prefix}`);
  const line = found[0];
  const base = /--wp-base:(#[0-9a-f]{3,6});/.exec(line);
  const url = /--wp:url\("data:image\/svg\+xml;utf8,([^"]*)"\)\}$/.exec(line);
  assert.equal(Boolean(base), true, `${prefix} sets --wp-base`);
  assert.equal(Boolean(url), true, `${prefix} sets --wp to an SVG data URL, last in the rule`);
  return { line, base: base[1], encoded: url[1], svg: decodeURIComponent(url[1]) };
}
const STAGES = {
  light: stageRule('.widget-gallery{--wp-gap:22px;gap:var(--wp-gap);'),
  dark: stageRule('[data-theme=dark] .widget-gallery{'),
};

// A small XML reader: elements with single-quoted attributes, text only inside <style>; throws on anything else.
function parse(text) {
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+='[^'<>]*')*)\s*(\/?)>|([^<]+)/gy;
  const rootNode = { name: '#root', attrs: {}, children: [] }, stack = [rootNode];
  let at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m) throw new Error(`not XML at ${at}: ${text.slice(at, at + 40)}`);
    at = re.lastIndex;
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      if (top.name !== 'style') throw new Error(`text outside <style>: ${m[5].slice(0, 40)}`);
      if (/[&]/.test(m[5])) throw new Error('an entity in the text');
      top.text = (top.text || '') + m[5];
      continue;
    }
    if (m[1]) {
      if (top.name !== m[2]) throw new Error(`</${m[2]}> closes <${top.name}>`);
      stack.pop();
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([\w:-]+)='([^']*)'/g)) {
      if (Object.hasOwn(attrs, a[1])) throw new Error(`${m[2]} repeats ${a[1]}`);
      attrs[a[1]] = a[2];
    }
    const node = { name: m[2], attrs, children: [] };
    top.children.push(node);
    if (!m[4]) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1].name}> left open`);
  if (rootNode.children.length !== 1) throw new Error('more than one root');
  return rootNode.children[0];
}
const walk = (node, out = []) => { out.push(node); for (const c of node.children) walk(c, out); return out; };

// The crest of a ridge path ('M x y c … s … V … H … Z', relative cubic segments) as points sampled along it.
function crest(d) {
  const tokens = d.match(/[MmCcSsVvHhZz]|-?(?:\d+\.?\d*|\.\d+)/g);
  let i = 0, cmd = '', x = 0, y = 0, lastC2 = null;
  const pts = [], num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === 'M') { x = num(); y = num(); pts.push([x, y]); continue; }
    if (cmd === 'c' || cmd === 's') {
      let c1;
      if (cmd === 'c') c1 = [x + num(), y + num()];
      else c1 = lastC2 ? [2 * x - lastC2[0], 2 * y - lastC2[1]] : [x, y];
      const c2 = [x + num(), y + num()], end = [x + num(), y + num()];
      for (let k = 1; k <= 24; k++) {
        const t = k / 24, u = 1 - t;
        pts.push([u ** 3 * x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * end[0], u ** 3 * y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * end[1]]);
      }
      lastC2 = c2; [x, y] = end;
      continue;
    }
    break; // V H Z: the sides and foot, below and beside the picture
  }
  return pts;
}
const crestAt = (pts, x) => {
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
    if (x0 <= x && x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0 || 1);
  }
  return NaN;
};
const sineAt = ([base, waves], x) => {
  const u = (2 * x - 0.5) / (WP - 1);
  const c = base + waves.reduce((s, [a, f, p]) => s + a * Math.sin(2 * Math.PI * f * u + p), 0);
  return (c * (HP - 1) + 0.5) / 2;
};

for (const [theme, stage] of Object.entries(STAGES)) {
  test(`gallery stage ${theme}: the SVG parses, is one picture of its own, and asks for nothing outside`, () => {
    assert.equal(/[{}]/.test(stage.encoded), false, 'no braces in the URL — the tests read styles.css by its braces');
    assert.equal(/[<>#"]/.test(stage.encoded), false, '< > # and " are percent-encoded');
    assert.ok(stage.encoded.length < 5000, `the URL stays small (${stage.encoded.length} bytes); a picture would be many times this`);
    let svg = null, error = '';
    try { svg = parse(stage.svg); } catch (e) { error = e.message; }
    assert.equal(error, '', 'parses');
    assert.equal(svg.name, 'svg');
    assert.equal(svg.attrs.xmlns, 'http://www.w3.org/2000/svg');
    assert.equal(svg.attrs.viewBox, '0 0 932 230', 'the gallery at a 1240px window, as the slicing assumes');
    assert.equal(svg.attrs.preserveAspectRatio, 'none', 'stretched to the three stages and two gaps');
    const nodes = walk(svg), ids = new Set(nodes.map(n => n.attrs.id).filter(Boolean));
    const refs = [...stage.svg.matchAll(/href='([^']*)'|url\(([^)]*)\)/g)].map(m => m[1] ?? m[2]);
    assert.ok(refs.length > 10, 'the ridges are drawn by reference');
    for (const r of refs) assert.equal(r.startsWith('#') && ids.has(r.slice(1)), true, `${r} is an id of this SVG`);
    assert.equal(/https?:/.test(stage.svg.replace("xmlns='http://www.w3.org/2000/svg'", '')), false, 'no address but the namespace');
    for (const tag of ['script', 'image', 'foreignObject', 'a']) assert.equal(nodes.some(n => n.name === tag), false, `no <${tag}>`);
  });

  test(`gallery stage ${theme}: only the documented palette is written, and the fallback is one of it`, () => {
    const used = new Set([...stage.svg.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g)].map(m => '#' + m[1].toLowerCase()));
    assert.equal([...used].sort().join(" "), [...PALETTE[theme]].sort().join(" "), 'every colour is the palette\'s, and the palette is all there');
    assert.equal(PALETTE[theme].includes(stage.base), true, `--wp-base ${stage.base} is a palette colour`);
    const comment = css.slice(css.indexOf('/* Gallery stages ('), css.indexOf('*/', css.indexOf('/* Gallery stages (')));
    for (const c of PALETTE[theme]) assert.equal(comment.includes(c), true, `the comment documents ${c}`);
    assert.equal(/stop-color='[^']*'/.test(stage.svg), false, 'the stops take the colour from <style>; each stop writes an opacity only');
  });
}

test('gallery stage: three ridges whose crests are wallpaper.py\'s sines, the same in both themes', () => {
  const paths = {};
  for (const [theme, stage] of Object.entries(STAGES)) {
    const nodes = walk(parse(stage.svg));
    paths[theme] = [0, 1, 2].map(i => nodes.find(n => n.name === 'path' && n.attrs.id === `r${i}`)?.attrs.d ?? '');
  }
  assert.equal(paths.dark.join("|"), paths.light.join("|"), 'N is D at blue hour: the same ridges');
  paths.light.forEach((d, i) => {
    assert.notEqual(d, '', `ridge r${i} is there`);
    const pts = crest(d);
    assert.ok(pts[0][0] <= -50 && pts[pts.length - 1][0] >= 982, `ridge r${i} runs past both sides (its blurred shading never fades inside)`);
    let worst = 0;
    for (let x = 0; x <= 932; x += 4) worst = Math.max(worst, Math.abs(crestAt(pts, x) - sineAt(RIDGES[i], x)));
    assert.ok(worst < 0.25, `ridge r${i} follows its sines within ${worst.toFixed(3)} (under .25 of a CSS px)`);
  });
});

// styles.css's top-level rules (comments and at-rule blocks taken out) as [selectors, declarations], and a property's last value
// for one selector — the cascade for rules of one selector is their order.
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[a-z-]+[^{;]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
const RULES = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].split(',').map(s => s.trim()), m[2]]);
function lastValue(selector, prop) {
  let value = '';
  for (const [sels, body] of RULES) {
    if (!sels.includes(selector)) continue;
    for (const d of body.split(';')) { const i = d.indexOf(':'); if (i > 0 && d.slice(0, i).trim() === prop) value = d.slice(i + 1).trim(); }
  }
  return value;
}
const px = text => { const m = /^(\d+(?:\.\d+)?)px$/.exec(text); return m ? Number(m[1]) : NaN; };

test('gallery stage: D7 — drawn 20px low, the near ridge crosses every card on its bottom corners\' arc, the layout read from styles.css', () => {
  // D7 (2026-10-27): the near ridge's crisp edge has to cross the cards low, where the glass rim bends it. The old hills crossed the
  // bottom corners' arc; D as drawn crossed the straight sides 22–43px above each foot (rim change 2–4 levels at p99 against the old
  // 5–11), so the owner had it drawn 20px low (2026-11-14 「20px 내리기」): five of the six crossings within the card's radius of its foot,
  // the first card's left one 0.5–0.8px above it (the ridge falls from left to right, so that one is at the arc's top, nearly the straight
  // side — measured at 20, 21 and 22px: 21 puts it on the arc but brings the last crossing to 1.1px of the foot). A ridge that rises
  // towards the cards' middle (where nothing bends), or the drop taken out, fails here.
  const DROP = px(/^\.widget-gallery\{[^}]*--wp-drop:([\d.]+px);/m.exec(css)?.[1] ?? '');
  const stagePad = lastValue('.widget-stage', 'padding').split(/\s+/).map(px);
  const STAGE_H = px(lastValue('.widget-stage', 'height')), PAD = stagePad[1] ?? stagePad[0];
  const H = px(lastValue('.widget-preview', 'min-height')), R = px(lastValue('.widget-preview', 'border-radius'));
  const GAP = Number(/@media\(min-width:1081px\)\{\.widget-gallery\{--wp-gap:(\d+)px\}\}/.exec(css)?.[1]);
  const MAXW = Number(/@media\(min-width:651px\)\{\.widget-preview\{max-width:(\d+)px\}\}/.exec(css)?.[1]);
  assert.equal([STAGE_H, PAD, H, R, GAP, MAXW, DROP].every(Number.isFinite), true, `the layout is read: stage ${STAGE_H} tall, sides ${PAD}, card ${H} tall r ${R}, gap ${GAP}, card at most ${MAXW}, drawn ${DROP} low`);
  const ROOM = R + 1;
  assert.equal([lastValue('.widget-stage', 'display'), lastValue('.widget-stage', 'align-items'), lastValue('.widget-stage', 'justify-content')].join(' '), 'flex center center', 'the card sits in the middle of its stage');
  // The gallery is the window's inner width less 308 above 1080px (sidebar, context pane and page sides — measured in Electron
  // 2026-11-14 at 1180, 1240 and 1600: 871, 931, 1291). The picture spans the gallery (calc(300% + 2 gaps) of a stage) and the
  // stage's height (100%); at a 1240px window it is drawn at its own 932 width.
  const SIDE = 308, windows = [1180, 1240, 1600];
  assert.ok(Math.abs(1240 - 1 - SIDE - 932) <= 1, 'the viewBox is the gallery at a 1240px window');
  const pts = crest(walk(parse(STAGES.light.svg)).find(n => n.attrs.id === 'r2').attrs.d);
  for (const win of windows) {
    const G = win - 1 - SIDE, SW = (G - 2 * GAP) / 3, CW = Math.min(SW - 2 * PAD, MAXW), FOOT = (STAGE_H - H) / 2 + H;
    const heights = [];
    for (let k = 0; k < 3; k++) {
      const left = k * (SW + GAP) + (SW - CW) / 2;
      for (const edge of [left, left + CW]) heights.push(FOOT - DROP - crestAt(pts, edge * 932 / G) * STAGE_H / 230);
    }
    const shown = heights.map(h => h.toFixed(1)).join(', '), onArc = heights.filter(h => h > 0 && h <= R).length;
    assert.ok(onArc >= 5, `${win}px window: ${onArc} of 6 crossings on the ${R}px corner arc (${shown})`);
    for (const h of heights) assert.ok(h > 0 && h <= ROOM, `${win}px window: the near crest crosses ${shown}px above the cards' feet — each within ${ROOM} (${onArc} of 6 on the ${R}px corner arc)`);
  }
});

test('gallery stage: the slicing over three stages and two gaps drawn 20px low over the sky\'s top colour, and the CSP that lets a data: picture in', () => {
  // each stage: its third of the picture, 20px down, and the 20px band above it in the sky's own top colour (the #s stop), over --wp-base
  assert.equal(lines.includes('.widget-stage,.widget-gallery-item:nth-child(2) .widget-stage,.widget-gallery-item:nth-child(3) .widget-stage{background:var(--wp) 0 var(--wp-drop,0px)/calc(300% + 2 * var(--wp-gap)) 100% no-repeat,linear-gradient(var(--wp-sky,transparent),var(--wp-sky,transparent)) 0 0/100% var(--wp-drop,0px) no-repeat var(--wp-base)}'), true);
  assert.equal(lines.includes('.widget-gallery-item:nth-child(2) .widget-stage{background-position:50% var(--wp-drop,0px),0 0}'), true);
  assert.equal(lines.includes('.widget-gallery-item:nth-child(3) .widget-stage{background-position:100% var(--wp-drop,0px),0 0}'), true);
  assert.equal(/--wp-drop:20px;/.test(STAGES.light.line), true, 'drawn 20px low (the light rule sets it for both themes)');
  for (const theme of ['light', 'dark']) {
    const sky = /--wp-sky:(#[0-9a-f]{3,6});/.exec(STAGES[theme].line)?.[1] ?? 'none';
    const top = /#s stop\{stop-color:(#[0-9a-f]{3,6})\}/.exec(STAGES[theme].svg)?.[1] ?? 'none';
    assert.equal(sky, top, `${theme}: the band above the picture is the sky's top colour`);
    assert.equal(PALETTE[theme].includes(sky), true, `${theme}: a palette colour`);
  }
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  assert.equal(/img-src 'self' data:;/.test(html), true, 'img-src keeps data:');
});
