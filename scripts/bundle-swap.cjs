'use strict';
// How `npm run package` puts a new app bundle in place (scripts/package.cjs). The bundle is built in a temporary folder and its
// Dayboard.exe is run once there; only an exe that runs replaces the bundle in 앱/ (2026-10-28: this PC's Smart App Control
// refused the new 1.1.4 exe after packager had already overwritten the working bundle in place, so the user's Dayboard could
// not start until a stand-in exe was put back). Tested in tests/package-swap.test.cjs.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const firstLine = error => String(error && error.message || error).split('\n')[0];

// Runs the new Dayboard.exe with --quit-for-install alone, which ends at once (main.cjs). Its own profile keeps it from the
// single-instance lock of a running Dayboard (that would quit it) and from the user's data.
function probeBundle(directory, scratch, run = execFileSync) {
  const profile = path.join(scratch, 'probe-profile');
  fs.mkdirSync(profile, { recursive: true });
  const env = { ...process.env, DAYBOARD_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE; // would start the exe as plain Node
  delete env.DAYBOARD_SMOKE_TEST;
  try {
    run(path.join(directory, 'Dayboard.exe'), ['--quit-for-install'], { env, stdio: 'pipe', windowsHide: true, timeout: 60000 });
  } catch (error) {
    // A refused exe does not start at all: spawn UNKNOWN (CodeIntegrity 3077, "An Application Control policy has blocked this file").
    const blocked = error && (error.code === 'UNKNOWN' || error.code === 'EACCES' || error.code === 'EPERM' || /application control|blocked/i.test(firstLine(error)));
    throw new Error(blocked
      ? `새로 만든 Dayboard.exe를 이 PC의 앱 제어 정책(스마트 앱 컨트롤)이 실행하지 못하게 합니다 (${firstLine(error)}). 기존 앱 번들을 그대로 둡니다.`
      : `새로 만든 Dayboard.exe가 시험 실행에서 정상적으로 끝나지 않았습니다 (${firstLine(error)}). 기존 앱 번들을 그대로 둡니다.`);
  }
}

// OneDrive can hold a file of the folder for a moment while it syncs: a few tries, a second apart.
function renameWithRetry(from, to, rename, tries = 5) {
  for (let attempt = 1; ; attempt++) {
    try { return rename(from, to); } catch (error) {
      if (attempt >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }
}

// Moves the tried bundle to `target`. The old bundle is first renamed beside it — a folder whose Dayboard.exe is running
// cannot be renamed, so a running Dayboard stops this before anything changed — and comes back if the new one cannot be put
// in place. A temporary folder on another drive is copied instead of renamed.
function replaceBundle(staged, target, { rename = fs.renameSync, copy = (from, to) => fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false }) } = {}) {
  const old = `${target}.old-${Date.now()}`;
  const had = fs.existsSync(target);
  if (had) {
    try { renameWithRetry(target, old, rename); } catch (error) {
      throw new Error(`기존 앱 번들을 옮기지 못했습니다. 실행 중인 Dayboard를 닫고 다시 실행하세요 (${firstLine(error)}).`);
    }
  }
  try {
    try { renameWithRetry(staged, target, rename); } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      copy(staged, target);
      fs.rmSync(staged, { recursive: true, force: true });
    }
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (had) fs.renameSync(old, target);
    throw new Error(`새 앱 번들을 제자리에 놓지 못해 기존 번들을 되돌렸습니다 (${firstLine(error)}).`);
  }
  if (had) {
    try { fs.rmSync(old, { recursive: true, force: true }); } catch (error) {
      console.warn(`경고: 이전 앱 번들을 지우지 못했습니다. 나중에 직접 지워 주세요: ${old} (${firstLine(error)})`);
    }
  }
}

module.exports = { probeBundle, replaceBundle };
