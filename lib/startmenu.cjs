'use strict';
// Keeps the per-user Start Menu shortcut that carries our AppUserModelID.
//
// Windows toast notifications need such a shortcut, and when one exists the
// taskbar draws the shortcut's icon for our windows instead of the window's own
// icon, through the shell icon cache. That cache is keyed by the icon path, so
// after an icon update the taskbar kept showing the old design even though the
// .exe and .ico had changed. The shortcut therefore points at a content-hashed
// copy of assets/icon.ico under userData: a new design means a new path, so the
// cache cannot be stale. The target is the running exe itself: Electron's toast
// code rewrites a shortcut whose target is another file (observed 2026-10-20 when
// the target was the launcher), which would drop the icon again. Only this one
// shortcut file and the icons folder under userData are written; nothing else in
// the shell is touched.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function createStartMenu({ programsDir, userData, iconSource, execPath, appId, name = 'Dayboard', shell, exists = fs.existsSync } = {}) {
  function hashedIcon() {
    const hash = createHash('sha1').update(fs.readFileSync(iconSource)).digest('hex').slice(0, 10);
    const directory = path.join(userData, 'icons');
    fs.mkdirSync(directory, { recursive: true });
    const icon = path.join(directory, `icon-${hash}.ico`);
    if (!exists(icon)) fs.copyFileSync(iconSource, icon);
    for (const entry of fs.readdirSync(directory)) {
      if (entry !== path.basename(icon) && /^icon-[0-9a-f]+\.ico$/.test(entry)) fs.rmSync(path.join(directory, entry), { force: true });
    }
    return icon;
  }
  // Creates or updates the shortcut; returns what was written, or null when the
  // Start Menu folder or the icon is unavailable.
  function ensure() {
    if (!programsDir || !exists(programsDir) || !iconSource || !exists(iconSource)) return null;
    const icon = hashedIcon();
    const link = path.join(programsDir, `${name}.lnk`);
    const wanted = { target: execPath, cwd: path.dirname(execPath), args: '', icon, iconIndex: 0, appUserModelId: appId, description: name };
    let current = null;
    if (exists(link)) { try { current = shell.readShortcutLink(link); } catch { current = {}; } }
    if (current && ['target', 'icon', 'appUserModelId'].every(key => current[key] === wanted[key])) return { link, icon, changed: false };
    const written = shell.writeShortcutLink(link, current ? 'replace' : 'create', wanted);
    return { link, icon, changed: Boolean(written) };
  }
  return { ensure };
}

module.exports = { createStartMenu };
