'use strict';
// A widget resized from any edge or corner (2026-10-30 owner: 「양 사방 어디서든 잡고 크기를 늘리는 게 낫지 않을까?」, lib/desktop.cjs
// resizedBounds): the sides not dragged stay put, the minimum holds, and a dragged side stops at the screen instead of pushing the widget.
const test = require('node:test');
const assert = require('node:assert/strict');
const { resizedBounds, RESIZE_EDGES } = require('../lib/desktop.cjs');

const screen = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
const min = { minWidth: 280, minHeight: 240 };
const right = b => b.x + b.width, bottom = b => b.y + b.height;

test('from the left or the top the opposite side holds; from the right or the bottom the widget stays where it is', () => {
  const at = { x: 1500, y: 300, width: 320, height: 400 }; // near the right of the screen
  const left = resizedBounds(at, { width: 420, height: 400, edge: 'w' }, screen, min);
  assert.deepEqual(left, { x: 1400, y: 300, width: 420, height: 400 }, 'widens to the left');
  assert.equal(right(left), right(at));
  const top = resizedBounds(at, { width: 320, height: 460, edge: 'n' }, screen, min);
  assert.deepEqual(top, { x: 1500, y: 240, width: 320, height: 460 });
  const corner = resizedBounds(at, { width: 380, height: 450, edge: 'nw' }, screen, min);
  assert.equal(right(corner), right(at)); assert.equal(bottom(corner), bottom(at));
  const ne = resizedBounds(at, { width: 360, height: 450, edge: 'ne' }, screen, min);
  assert.equal(ne.x, at.x); assert.equal(bottom(ne), bottom(at));
  const sw = resizedBounds(at, { width: 360, height: 450, edge: 'sw' }, screen, min);
  assert.equal(right(sw), right(at)); assert.equal(sw.y, at.y);
  assert.deepEqual(resizedBounds(at, { width: 340, height: 420, edge: 'se' }, screen, min), { x: 1500, y: 300, width: 340, height: 420 });
  assert.deepEqual(resizedBounds(at, { width: 340, height: 420 }, screen, min), { x: 1500, y: 300, width: 340, height: 420 }, 'the grip and the arrow keys: the right and bottom sides');
});

test('the minimum holds with the opposite side still in place; a dragged side stops at the screen', () => {
  const at = { x: 600, y: 300, width: 320, height: 400 };
  const narrow = resizedBounds(at, { width: 100, height: 400, edge: 'w' }, screen, min);
  assert.equal(narrow.width, 280); assert.equal(right(narrow), right(at), 'shrunk from the left to the minimum: the right side did not move');
  const short = resizedBounds(at, { width: 320, height: 50, edge: 'n' }, screen, min);
  assert.equal(short.height, 240); assert.equal(bottom(short), bottom(at));
  const pastLeft = resizedBounds({ x: 40, y: 300, width: 320, height: 400 }, { width: 500, height: 400, edge: 'w' }, screen, min);
  assert.deepEqual(pastLeft, { x: 0, y: 300, width: 360, height: 400 }, 'the left side stops at the screen edge; the right one holds');
  const pastRight = resizedBounds({ x: 1500, y: 300, width: 320, height: 400 }, { width: 600, height: 400, edge: 'e' }, screen, min);
  assert.deepEqual(pastRight, { x: 1500, y: 300, width: 420, height: 400 }, 'the right side stops at the screen edge instead of sliding the widget left');
  const pastTop = resizedBounds({ x: 600, y: 20, width: 320, height: 400 }, { width: 320, height: 600, edge: 'n' }, screen, min);
  assert.deepEqual(pastTop, { x: 600, y: 0, width: 320, height: 420 });
  // A widget a pixel past the bottom of the work area (it happens on a second screen) is not made smaller by growing it: it keeps its
  // size and comes back inside, as before (2026-10-30 smoke: the calendar widget lost two pixels).
  const over = resizedBounds({ x: 600, y: 621, width: 400, height: 420 }, { width: 400, height: 460, edge: 'se' }, screen, min);
  assert.equal(over.height, 420); assert.equal(bottom(over), 1040);
  assert.deepEqual(RESIZE_EDGES.slice().sort(), ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
});

test('on a second screen to the left (negative coordinates) the same rules apply', () => {
  const two = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }, { workArea: { x: -1600, y: 0, width: 1600, height: 860 } }];
  const at = { x: -400, y: 200, width: 320, height: 400 };
  const left = resizedBounds(at, { width: 400, height: 400, edge: 'w' }, two, min);
  assert.deepEqual(left, { x: -480, y: 200, width: 400, height: 400 });
  const right2 = resizedBounds(at, { width: 600, height: 400, edge: 'e' }, two, min);
  assert.equal(right(right2), 0, 'stops at that screen\'s right side');
});
