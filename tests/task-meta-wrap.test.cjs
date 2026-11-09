'use strict';
// A task row's details never break inside one (2026-11-06 owner: 「이거 우측패널을 좁혔더니 알림이랑 하위항목 표시가 깨져서 나타나」 — 「오후 12:00」
// split over two lines in the calendar's narrow day panel): each chunk stays whole and the line wraps between chunks; the day panel's
// check circle is 18px at its 13px titles (「할 일 완료 체크하는 동그라미가 글자 대비 좀 과하게 크지 않아?」). Primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the details line wraps between chunks, never inside one; the day panel check circle is 18px', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  assert.equal(/\n\.task-meta\{flex-wrap:wrap;row-gap:2px\}/.test(css), true);
  assert.equal(/\n\.task-meta>\*\{white-space:nowrap\}/.test(css), true);
  assert.equal(/\n\.day-panel \.task-check\{width:18px;height:18px;margin-top:1px\}/.test(css), true);
  assert.equal(/\n\.day-panel \.task-title\{font-size:13px\}/.test(css), true, 'with the 13px titles it is sized for');
});
