'use strict';
// The 2026-11-13 pre-release review, design lens: styles.css rules the full smoke also measures (ui-smoke-pane-delete-1112.cjs: the switch in
// forced colours; ui-smoke.cjs subtask-time: a two-line subtask's circle on its first line). Each test failed on 4e57d10.
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./r50-F-harness.cjs');

const css = () => read('renderer/styles.css').replace(/\r\n/g, '\n');
const rule = (text, selector) => { const at = text.indexOf('\n' + selector + '{'); return at < 0 ? null : text.slice(at + selector.length + 2, text.indexOf('}', at)); };

test('a Windows contrast theme draws the switch in system colours, its ring an inset shadow (the focus outline stays its own), on and off', () => {
  const s = css();
  const block = s.match(/@media\(forced-colors:active\)\{:root \.checkbox-field input\[type=checkbox\]\{([^}]*)\}(.*)\n/);
  assert.ok(block, 'one forced-colours block for the switch');
  assert.equal(block[1], 'forced-color-adjust:none;background:Canvas;box-shadow:inset 0 0 0 1px ButtonText', 'its ground and ring kept, not taken away');
  for (const part of [':root .checkbox-field input[type=checkbox]::after{background:ButtonText;box-shadow:none}', ':root .checkbox-field input[type=checkbox]:checked{background:Highlight;box-shadow:none}',
    ':root .checkbox-field input[type=checkbox]:checked::after{background:HighlightText}', ':root .checkbox-field input[type=checkbox]:disabled{box-shadow:inset 0 0 0 1px GrayText}'])
    assert.ok(block[2].includes(part), part);
  assert.equal(/outline/.test(block[0]), false, 'no outline: the switch\'s focus ring is the global one');
  // after the dark theme's switch rules, so :root (same weight as [data-theme=dark]) wins by order
  assert.ok(s.indexOf('@media(forced-colors:active){:root .checkbox-field') > s.indexOf('[data-theme=dark] .checkbox-field input[type=checkbox]:checked{background:var(--blue)}'));
});

test('a subtask whose name wraps: circle, date and × at the middle of the row\'s first 32px (28px in the day panel and a widget), the name\'s first line there too', () => {
  const s = css();
  const tail = s.slice(s.indexOf('.tasks-view .task-step .step-date.empty{margin-left:auto}'));
  for (const line of ['.task-step{align-items:flex-start;--step-mid:16px}', '.day-panel .task-step,.widget-body .widget-tasks .task-step{--step-mid:14px}',
    '.task-step>.step-check{margin-top:calc(var(--step-mid) - 8.5px)}', '.day-panel .task-step>.step-check,.widget-body .widget-tasks .task-step>.step-check{margin-top:calc(var(--step-mid) - 7.5px)}',
    '.task-step>:is(.step-title,.step-title-input){margin-top:calc(var(--step-mid) - 3px - .5lh)}', '.task-step>.step-date{margin-top:calc(var(--step-mid) - 11px)}', '.task-step>.step-remove{margin-top:calc(var(--step-mid) - 13px)}'])
    assert.ok(tail.includes('\n' + line + '\n'), line);
  // the sizes the margins are made of: one line centred in the old rule's row lands where these put it
  assert.ok(s.includes('.task-step{display:flex;align-items:center;gap:10px;min-height:32px}.step-check{width:17px;height:17px;'));
  assert.equal(rule(s, '.day-panel .task-step'), 'min-height:28px;gap:8px'); assert.equal(rule(s, '.day-panel .step-check'), 'width:15px;height:15px');
  assert.equal(rule(s, '.widget-body .widget-tasks .task-step'), 'min-height:28px;gap:8px');
  assert.ok(s.includes('.step-remove{width:26px;height:26px;opacity:0}'));
  assert.ok(/\n\.step-date\{[^}]*height:22px/.test(s) && /\n\.step-title\{[^}]*padding:3px 0\}/.test(s) && s.includes('.step-title-input{flex:1;min-width:0;border:0;border-bottom:1px solid var(--blue);border-radius:0;background:none;font-size:13px;line-height:1.5;padding:3px 0 2px;'));
  // no margin shorthand left on these children that would put their top back to 0 (the widget's wrapped date sits on its own line: kept)
  const shorthand = [...s.matchAll(/([^{}\n]*\.task-step[^{}]*>?[^{}]*\.step-(?:check|title|date|remove)[^{}]*)\{([^}]*)\}/g)].filter(m => /(^|;)margin:/.test(m[2]) && !m[1].includes('.timed>.step-date')).map(m => m[1]);
  assert.deepEqual(shorthand, []);
});

test('the panel\'s 하위 할 일 추가 box rings as 할 일 삭제 under it: 2px blue inside; the open task\'s shade stops 2px short of the sidebar', () => {
  const s = css();
  assert.ok(s.includes('\n.task-pane-body .pane-step-add:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}'));
  assert.ok(s.includes('\n.task-pane-foot>.pane-delete:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}'));
  assert.ok(s.includes('.task-row.pane-open::after{content:"";position:absolute;inset:3px -8px 3px calc(0px - min(28px,var(--gutter) - 2px));'));
  // the arrow's press: 2px + its width left of the row, inside the shade at every gutter (32, 24, 16)
  assert.ok(s.includes('.steps-toggle{--w:min(24px,calc(var(--gutter) - 4px));position:absolute;top:10.5px;left:calc(-2px - var(--w));'));
  for (const gutter of [32, 24]) assert.ok(2 + Math.min(24, gutter - 4) <= Math.min(28, gutter - 2), `gutter ${gutter}`);
});
