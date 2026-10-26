'use strict';
// Public release notes: docs/public/releases/<version>.md, a "## title" line and 3–6 short bullets, optionally followed by
// a "### English" part with its own 3–6 bullets (2026-10-27: the public pages come in Korean and English). They become
// the GitHub Release text, which the app's 「새 기능 보기」 opens.
// No personal data: before anything is published the notes are checked against scripts/public-text-rules.cjs and,
// on the maintainer's PC, the personal markers in private/personal-markers.json (account, machine and workplace
// names, kept out of every public file and of the public source). The notes also never mention OneDrive, where the
// maintainer keeps the project.
const fs = require('node:fs');
const path = require('node:path');
const { SECRETS, GENERAL, personalMarkers, firstHit } = require('./public-text-rules.cjs');

const NOTES_ONLY = [{ kind: 'a local path or OneDrive', re: /\b[A-Z]:\\|OneDrive/i }];

function privateMarkers(project) {
  return personalMarkers(project).map(rule => rule.re);
}

function readPublicReleaseNotes(project, version) {
  const file = path.join(project, 'docs', 'public', 'releases', `${version}.md`);
  if (!fs.existsSync(file)) throw new Error(`Add the public release notes first: docs/public/releases/${version}.md`);
  const notes = fs.readFileSync(file, 'utf8').trim();
  const parts = notes.split(/^### English[ \t]*$/m);
  const fits = part => { const bullets = part.match(/^- /gm) || []; return part.length <= 1800 && bullets.length >= 3 && bullets.length <= 6; };
  if (!/^## \S/.test(notes) || parts.length > 2 || !parts.every(fits)) {
    throw new Error('Public release notes need a "## title" line and 3–6 short bullets (at most 1800 characters), and the same again under an optional "### English" line.');
  }
  // The rule that matched is not echoed, so a refusal never prints a private word.
  if (firstHit(notes, [...personalMarkers(project), ...SECRETS, ...GENERAL, ...NOTES_ONLY])) {
    throw new Error('Public release notes contain something personal or secret.');
  }
  return notes;
}

module.exports = { readPublicReleaseNotes, privateMarkers };
