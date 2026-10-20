'use strict';
// Main-process side of the UI language. The dictionary lives in renderer/i18n.js (shared with the
// renderer); this module keeps the language chosen for the main process (tray menu, Windows
// notifications, error messages sent to the renderer). Korean is the source language and the
// default, so unit tests that match Korean messages run unchanged.
const shared = require('../renderer/i18n.js');

let current = 'ko';
function resolve(setting, locale) { return shared.resolve(setting, locale); }
function setLanguage(language) { current = language === 'en' ? 'en' : 'ko'; }
function getLanguage() { return current; }
function tr(key, params) { return shared.translate(current, key, params); }

module.exports = { tr, resolve, setLanguage, getLanguage };
