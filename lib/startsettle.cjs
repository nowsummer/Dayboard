'use strict';
// What a stop left on its way, settled when Dayboard starts (main.cjs whenReady, before any window, IPC command or sync): a move to a connected
// list under way (lib/taskmove.cjs settleMovesAtStart) and an account write on its way (lib/outbox.cjs settleAtStart) — both may have reached
// the service, so both wait for a read or the user, never resent from here.
// 2026-11-15 review R3: the save this needs can fail for a moment (a data file held by an antivirus or an indexer) and, unguarded, ended the
// start with 「Dayboard를 열 수 없습니다」; 1.2.13 made that save common (a task added to or deleted from an account list, Dayboard closed before
// the next round). It is tried again after each of `waits` (ms) and only the last failure is thrown — the start then ends as before, a file
// that cannot be saved for that long saves nothing else either.
// Never tried again later in the run (Codex rel14-r1 U3): by then this run's own requests are on their way, and settling them as a stop's
// would make an add whose answer is coming an 'unsure' one. Run twice, either settle gives the same state, so a try after a half-done one is
// safe; a failed try changes nothing (lib/store.cjs mutate keeps its state when the save fails).
const { needsSettle, settleAtStart } = require('./outbox.cjs');
const { settleMovesAtStart } = require('./taskmove.cjs');

const WAITS = [500, 1000, 2000, 4000];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function settleOnce(store) {
  if ((store.read(state => state.taskMoves) || []).length) store.mutate(settleMovesAtStart);
  if (store.read(state => needsSettle(state))) store.mutate(state => settleAtStart(state));
}

async function settleStart(store, { waits = WAITS, sleep = pause, log = () => {} } = {}) {
  for (let turn = 0; ; turn++) {
    try { settleOnce(store); return; } catch (error) {
      if (turn >= waits.length) throw error;
      log(error);
      await sleep(waits[turn]);
    }
  }
}

module.exports = { settleStart, WAITS };
