'use strict';
// What must never appear in text Dayboard publishes (release notes, the public source): secret shapes, real Windows
// user folders, a company OneDrive folder, personal e-mail. Shared by scripts/release-notes.cjs and the maintainer's
// source export, so both refuse the same things. The maintainer's own words (account, PC and workplace names) are not
// here: they live in private/personal-markers.json, which is never published.
const fs = require('node:fs');
const path = require('node:path');

const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SECRETS = [
  /GOCSPX-[\w-]{6,}/, /AIza[0-9A-Za-z_-]{30,}/, /\bya29\.[\w-]{20,}/, /\b1\/\/0[\w-]{20,}/,
  /\b\d{6,}-[a-z0-9]{32}\.apps\.googleusercontent\.com/,
  /gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_\w{20,}/, /sk-ant-[\w-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/, /\bM\.[A-Z]\d{3}_[A-Z]{2,}\d*\.[\w!*$.-]{20,}/,
  /\b[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}\b/, // an Apple app-specific password
].map(re => ({ kind: 'a secret', re }));

// Placeholders allowed after Users\: example, someone, you, user, Public, Default (as whole folder names), <...>, %...%, ${...}.
const PLACEHOLDER = '(?:example|someone|you|user|Public|Default)(?![^\\\\/\\s\'"`<>])';
// A folder name: no separators, quotes, placeholders' brackets or regular-expression signs (so these rules never match themselves).
const FOLDER = `(?!${PLACEHOLDER})[^\\\\/\\s'"\`<>%$+*?()[\\]{}|^]+`;
const GENERAL = [
  // C:\Users\<name>, c:/Users/<name>
  { kind: 'a Windows user folder', re: new RegExp(`[A-Za-z]:[\\\\/]+Users[\\\\/]+${FOLDER}`, 'i') },
  // /c/Users/<name> (Git Bash), /mnt/c/Users/<name> (WSL), wherever it stands (PATH lists, HOME=…)
  { kind: 'a Windows user folder', re: new RegExp(`(?<![\\w.-])\\/(?:mnt\\/)?[a-z]\\/Users\\/${FOLDER}`, 'i') },
  // \Users\<name> without a drive (HOMEPATH, \\host\c$\Users\<name>)
  { kind: 'a Windows user folder', re: new RegExp(`(?<![\\w.-])\\\\Users\\\\+${FOLDER}`, 'i') },
  { kind: 'a company OneDrive folder', re: /OneDrive[ ]-[ ]\S/i },
  { kind: 'an e-mail address', email: true, re: /\b[A-Za-z0-9._%+-]+@(?!(?:users\.noreply\.github\.com|example\.(?:com|org|invalid))\b)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/ },
];

// The same text with %XX, \u005c and \x5c escapes undone, so an encoded path or address is still seen.
function decodedView(text) {
  return text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// private/personal-markers.json of a project: [] when the file is absent (a public clone); an error when it is
// present but unusable, so a broken file never turns the check off quietly.
function personalMarkers(project) {
  const file = path.join(project, 'private', 'personal-markers.json');
  if (!fs.existsSync(file)) return [];
  let markers;
  try { ({ markers } = JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { throw new Error('private/personal-markers.json is not valid JSON.'); }
  const words = Array.isArray(markers) ? markers.filter(m => typeof m === 'string' && m.trim()).map(m => m.trim()) : [];
  if (words.length < 3) throw new Error('private/personal-markers.json has no usable markers.');
  // Literal text, not patterns: "a.b" matches only "a.b".
  return words.map(m => ({ kind: 'a private marker', re: new RegExp(escape(m), 'i') }));
}

// The first rule a text breaks, or null. The match itself is never returned, so a refusal never echoes it.
function firstHit(text, rules, { allowEmail = false } = {}) {
  const views = [text, decodedView(text)];
  return rules.find(rule => !(allowEmail && rule.email) && views.some(view => rule.re.test(view))) || null;
}

module.exports = { SECRETS, GENERAL, PLACEHOLDER, decodedView, personalMarkers, firstHit, escape };
