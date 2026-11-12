'use strict';
// A date number has its ink in the middle of its box, everywhere by one rule with a circle or without, so it sits in the middle of a circle and on the line of its row; the 1st of a month is a number like any other,
// with its month beside the circle (2026-11-10 owner). Measured on screen in device pixels; these keep the code that gives that result. Strings and numbers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'renderer', file), 'utf8');
const CSS = read('styles.css'), CAL = read('calendar.js'), APP = read('app.js');
const D = require('../renderer/domain.js');
const em = (day, proportional) => parseFloat((D.discInk?.(day, proportional) || {})['--disc-ink']);

const NUMBER_SELECTORS = ['.date-pop-day', '.day-number', '.mini-preview-calendar span', '.time-date'];
const discRule = () => [...CSS.matchAll(/(?:^|\n)([^\n{}]+)\{([^\n]*--disc-ink[^\n]*)\}/g)].map(m => ({ selectors: m[1].split(',').map(s => s.trim()).sort().join(' | '), body: m[2] }));

// Where each number's ink sits in its advance box, in em, read from the font's pixels at 120px (tabular 600, proportional 700).
const TABULAR = [-.028, .005, .005, .004, .009, 0, 0, 0, 0, .048, -.026, .039, .046, .053, .044, .046, .033, .046, .046, .015, -.059, .006, .013, .02, .012, .013, 0, .013, .013, .007, -.067];
const PROPORTIONAL = [-.03, 0, .001, .001, .008, 0, -.004, 0, .001, .001, -.03, 0, -.002, .004, .001, .001, .002, .001, .001, .001, -.031, .001, 0, .004, .003, .001, .003, .003, .003, .001, -.03];

test('D.discInk moves every number by the opposite of where its ink sits', () => {
  for (let day = 1; day <= 31; day++) {
    const tabular = em(day, false), proportional = em(day, true);
    assert.ok(Math.abs(tabular + TABULAR[day - 1]) <= .006, `tabular ${day}: ${tabular} against ${TABULAR[day - 1]}`);
    assert.ok(Math.abs(proportional + PROPORTIONAL[day - 1]) <= .006, `proportional ${day}: ${proportional} against ${PROPORTIONAL[day - 1]}`);
  }
  assert.equal(em(10, false) < 0, true, '「10」 sits right of its box, so it moves left');
  assert.equal(em(31, false) > 0, true, '「31」 sits left of its box, so it moves right');
});

test('no number gets a height of its own: every number of a row stands on one baseline', () => {
  for (let day = 1; day <= 31; day++) assert.equal(Object.keys(D.discInk(day)).join(), '--disc-ink', 'day ' + day + ': a sideways correction alone');
  assert.equal(CSS.includes('--disc-mid'), false, 'a per-number baseline snaps one number of a row a device pixel off the others');
});

test('every place that draws a date number goes through D.discInk', () => {
  assert.match(CAL, /h\('button',\{type:'button',class:'day-number',[^\n]*?style:D\.discInk\(d\.day\),onclick:/, 'the month tab');
  assert.match(CAL, /h\('span',\{class:'time-date',style:D\.discInk\(d\.getDate\(\)\)\},d\.getDate\(\)\)/, 'the week and day headers');
  assert.match(APP, /h\('span',\{class:'day-number',style:D\.discInk\(d\.day\)\},d\.day\)/, 'the small calendar of the 할 일 panel and the calendar widget');
  assert.match(APP, /style:D\.discInk\(d\.getDate\(\)\),onclick:\(\)=>pick\(key\)\},String\(d\.getDate\(\)\)\)/, 'the date popover');
  assert.match(APP, /h\('span',\{class:\(c\.key===today\?'active':''\),style:c\.outside\?null:D\.discInk\(c\.day,true\)\},c\.outside\?'':c\.day\)/, 'the 위젯 tab preview, whose digits are proportional');
});

test('one rule places every date number, with a circle or without', () => {
  const rules = discRule();
  assert.equal(rules.length, 1, 'one rule holds the list');
  assert.equal(rules[0].selectors, NUMBER_SELECTORS.join(' | '));
  const body = rules[0].body;
  assert.match(body, /display:flex;/, 'no plain or grid number beside it');
  assert.match(body, /text-indent:calc\(var\(--disc-ink,0em\)\*2\)/, 'the sideways correction');
  assert.equal(body.includes('will-change'), false, 'no layer for a number with no circle');
  assert.match(body, /padding:0;/, 'the correction never widens a circle: 「31」 in the week header is 25px of text in its 32px');
  assert.match(body, /align-items:baseline/, 'the baseline is placed, not the line box');
  assert.equal(body.includes('&::before{content:"";height:round(nearest,calc(50% + var(--digit-mid,.354em)),calc(var(--dp,.01px)/var(--wz,1)))}'), true, 'the baseline stands the digits mid-height below the centre, a whole number of device pixels in: a number with a layer and a plain one then land on one line');
  assert.equal(APP.includes("style.setProperty('--dp',1/devicePixelRatio+'px')"), true, 'app.js keeps --dp at one device pixel');
  assert.equal(APP.includes("matchMedia('(resolution:'+devicePixelRatio+'dppx)').addEventListener('change',trackDevicePixel,{once:true})"), true, 'and follows a move to another screen or a text size');
  assert.match(CSS, /\n\.calendar-grid\.large\{--digit-mid:\.366em\}\n/, 'the month numbers stand a little lower: at 125% and 더 크게 their 37.5-device-pixel circle rounds up and its centre goes down');
  assert.equal(CSS.split('--disc-ink').length - 1, 1 + (CSS.match(/--disc-ink \(D\.discInk\)/g) || []).length, 'nothing else reads the correction');
  const at = CSS.indexOf('.day-number,.time-date,.date-pop-day,.mini-preview-calendar span{');
  assert.equal(at >= 0, true, 'the list as one selector');
  assert.equal(/(?:\.day-number|\.time-date|\.date-pop-day|\.mini-preview-calendar [a-z.]+)[^{}\n]*\{[^{}]*\bdisplay:/.test(CSS.slice(at + 64)), false, 'no later rule gives a date number another layout');
});

test('today, a selection and a hover colour the number and never move it', () => {
  const NUMBER = /\.day-number|\.time-date|\.date-pop-day|\.mini-preview-calendar (?:span|\.active)/, STATE = /is-today|is-selected|:hover|\.sel\b|\.active|\.today\b/;
  const states = [...CSS.matchAll(/(?:^|[}\n])([^{}\n]*)\{([^{}]*)\}/g)].filter(m => m[1].split(',').some(s => NUMBER.test(s) && STATE.test(s)));
  assert.ok(states.length >= 12, states.length + ' rules read');
  for (const m of states) assert.equal(/(?:^|;)\s*(?:display|padding[a-z-]*|margin[a-z-]*|width|height|text-indent|line-height|font-size|align-[a-z]+|justify-[a-z]+)\s*:/.test(m[2]), false, m[1] + ' { ' + m[2] + ' }');
  assert.equal(CSS.includes('.is-today .day-number{background:var(--today);color:white;font-weight:600}'), true, 'today keeps its fill and weight');
  assert.match(CSS, /\.large \.day-number\{align-self:center;width:24px;height:24px;font-size:12px\}/, 'the month circle keeps its size');
  assert.match(CSS, /\.widget-calendar-content \.day-number\{width:22px;height:22px\}/, 'the widget circle keeps its size');
});

test('a layer only under the numbers whose circle is always drawn', () => {
  const NUMBER = /\.day-number|\.time-date|\.date-pop-day|\.mini-preview-calendar (?:span|\.active)/;
  const layers = [...CSS.matchAll(/(?:^|[}\n])([^{}\n]*)\{([^{}]*will-change[^{}]*)\}/g)].filter(m => NUMBER.test(m[1]));
  assert.equal(layers.length, 1, 'one rule holds the list');
  assert.equal(layers[0][1].split(',').map(s => s.trim()).sort().join(' | '), '.date-pop-day.sel | .is-today .day-number | .mini-preview-calendar .active | .time-day.is-today .time-date', 'today and the popover\'s selection: the grey selection and a hover would change the glyphs under the press');
  assert.equal(layers[0][2], 'will-change:transform', 'a layer and nothing else: the place of the number is the rule above');
});

test('the 1st of a month is a number like any other: its circle holds the digit alone', () => {
  assert.equal(/d\.day===1\?calFirstLabel\(d\.key\):d\.day/.test(CAL), false, 'the button shows the number on every day');
  assert.match(CAL, /class:'day-number',tabindex:-1,[^\n]*?\},d\.day\),/, 'the number is the button\'s only content');
  assert.equal(/day-number\.first|day-number'\+\(d\.day===1/.test(CSS + CAL), false, 'no wider button for the 1st');
});

test('the month stands beside the circle, quietly, the same on any 1st', () => {
  assert.match(CAL, /d\.day===1\?h\('span',\{class:'day-month','aria-hidden':'true'\},calFirstMonth\(d\.key\)\):null/, 'one element outside the button, whether or not the 1st is today');
  assert.match(CAL, /const calFirstMonth=key=>D\.fromDate\(key\)\.toLocaleDateString\(I\.locale\(\),\{month:'short'\}\)/, '「11월」, 「Nov」: the app\'s language');
  assert.match(CAL, /'aria-label':d\.day===1\?calFirstLabel\(d\.key\):null/, 'read out as the full date');
  const rule = (CSS.match(/\.calendar-grid\.rolling \.day-month\{([^}]*)\}/) || [])[1] || '';
  assert.match(rule, /position:absolute/, 'it does not move the number');
  assert.match(rule, /right:calc\(50% \+ 16px\)/, '4px clear of the 24px circle');
  assert.match(rule, /font-size:12px/);
  assert.match(rule, /font-weight:500/);
  assert.match(rule, /color:var\(--secondary\)/, 'not red on a 1st that is today: the circle says today');
  assert.match(rule, /pointer-events:none/, 'the cell keeps its clicks');
  assert.match(CSS, /\.outside \.day-month\{opacity:\.28\}/, 'as dim as the number beside it');
});

test('a cell too narrow to keep 「12월」 off its edge shows the number alone', () => {
  const hide = CSS.match(/@container \(max-width:([\d.]+)px\)\{\.calendar-grid\.rolling \.day-month\{display:none\}\}/);
  assert.equal(Boolean(hide), true, 'the cell is its own container (.large .calendar-day)');
  assert.match(CSS, /\.large \.calendar-day\{container-type:inline-size\}/);
  // A query reads the content box (the cell less its 5px padding). 「12월」 is 25.45px wide at 12px; half a cell holds half the circle 12, the gap 4, the label and 4 clear of the edge.
  const shownFrom = (Number(hide[1]) + .02 + 10) / 2;
  assert.ok(shownFrom >= 12 + 4 + 25.45 + 4, 'half a cell from ' + shownFrom + 'px');
  assert.ok(shownFrom <= 46, 'no wider than that needs: half a cell from ' + shownFrom + 'px');
  assert.equal(84 - 10 <= Number(hide[1]), true, 'the 84px cells of the default 1180 window show the number alone, as 「12월」 would have 0.55px to the edge');
});
