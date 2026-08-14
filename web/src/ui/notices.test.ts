// Notices (goal R80): one list behind the toasts and the log, deduplicated hard
// enough to survive being fed by polling loops, and bounded.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEDUPE_MS,
  LOG_CAP,
  TOAST_MS,
  createNoticeBoard,
  isDuplicate,
  isToastLive,
  noticeBoard,
  visibleToasts,
  type Notice,
} from "./notices.ts";

const T0 = 1_000_000;

function notice(over: Partial<Notice> & { id: number }): Notice {
  return {
    kind: "info",
    title: "Something happened",
    detail: null,
    atMs: T0,
    key: "k",
    ...over,
  };
}

// --- posting -----------------------------------------------------------------

test("a posted notice is kept", () => {
  const board = createNoticeBoard();
  const posted = board.post({ kind: "warn", title: "A pirate has arrived" }, T0);
  assert.ok(posted);
  assert.deepEqual(
    board.notices.get().map((entry) => entry.title),
    ["A pirate has arrived"],
  );
});

test("notices keep their order, oldest first", () => {
  const board = createNoticeBoard();
  board.post({ kind: "info", title: "first" }, T0);
  board.post({ kind: "info", title: "second" }, T0 + 1);
  assert.deepEqual(board.notices.get().map((entry) => entry.title), ["first", "second"]);
});

test("ids are unique so a list key can never collide", () => {
  const board = createNoticeBoard();
  const a = board.post({ kind: "info", title: "a" }, T0);
  const b = board.post({ kind: "info", title: "b" }, T0);
  assert.notEqual(a!.id, b!.id);
});

// --- the dedupe, which is what makes this usable at all ----------------------

test("the same event re-observed by a polling loop is dropped", () => {
  // ⚠ THE FAILURE THIS PREVENTS. Every source here is a poll: the space snapshot
  // ticks about once a second. Without this, a pirate standing on the belt
  // announces itself sixty times a minute and the stack is unreadable.
  const board = createNoticeBoard();
  assert.ok(board.post({ kind: "danger", title: "Pirate", key: "hostile:42" }, T0));
  assert.equal(board.post({ kind: "danger", title: "Pirate", key: "hostile:42" }, T0 + 1_000), null);
  assert.equal(board.notices.get().length, 1);
});

test("the SAME key is allowed again once the window has passed", () => {
  // Otherwise the second time a pirate ever arrives is silent, forever.
  const board = createNoticeBoard();
  board.post({ kind: "danger", title: "Pirate", key: "hostile:42" }, T0);
  assert.ok(board.post({ kind: "danger", title: "Pirate", key: "hostile:42" }, T0 + DEDUPE_MS + 1));
  assert.equal(board.notices.get().length, 2);
});

test("dedupe compares against the MOST RECENT match, not the oldest", () => {
  // A key seen an hour ago must not keep suppressing a fresh one, and a key seen
  // a second ago must suppress even if an older one has aged out.
  const older = notice({ id: 1, key: "x", atMs: T0 });
  const recent = notice({ id: 2, key: "x", atMs: T0 + DEDUPE_MS * 10 });
  const now = T0 + DEDUPE_MS * 10 + 1_000;
  assert.equal(isDuplicate([older, recent], "x", now), true, "the recent one suppresses");
  assert.equal(isDuplicate([older], "x", now), false, "the old one alone does not");
});

test("different keys never suppress each other", () => {
  const board = createNoticeBoard();
  board.post({ kind: "danger", title: "Pirate", key: "hostile:1" }, T0);
  assert.ok(board.post({ kind: "danger", title: "Pirate", key: "hostile:2" }, T0));
  assert.equal(board.notices.get().length, 2, "two rats are two arrivals");
});

test("the title is the default key, which is right for a one-off message", () => {
  const board = createNoticeBoard();
  board.post({ kind: "info", title: "Hold is full" }, T0);
  assert.equal(board.post({ kind: "info", title: "Hold is full" }, T0 + 100), null);
});

// --- bounded -----------------------------------------------------------------

test("the log is capped, and drops the OLDEST", () => {
  // A mining session runs for hours. The newest entries are the ones anyone is
  // looking for, so the trim comes off the front.
  const board = createNoticeBoard();
  for (let index = 0; index < LOG_CAP + 25; index += 1) {
    board.post({ kind: "info", title: `n${index}`, key: `k${index}` }, T0 + index * DEDUPE_MS * 2);
  }
  const kept = board.notices.get();
  assert.equal(kept.length, LOG_CAP);
  assert.equal(kept[kept.length - 1]?.title, `n${LOG_CAP + 24}`, "the newest survives");
  assert.equal(kept[0]?.title, "n25", "the oldest 25 were dropped");
});

// --- toasts ------------------------------------------------------------------

test("a fresh notice is a live toast; an old one is not", () => {
  const fresh = notice({ id: 1, atMs: T0 });
  assert.equal(isToastLive(fresh, T0 + TOAST_MS - 1), true);
  assert.equal(isToastLive(fresh, T0 + TOAST_MS + 1), false);
});

test("the toast stack shows the newest first", () => {
  const notices = [
    notice({ id: 1, title: "older", key: "a" }),
    notice({ id: 2, title: "newer", key: "b" }),
  ];
  const shown = visibleToasts(notices, new Set(), T0 + 100);
  assert.deepEqual(shown.map((entry) => entry.title), ["newer", "older"]);
});

test("a dismissed notice leaves the stack but STAYS in the log", () => {
  const board = createNoticeBoard();
  const posted = board.post({ kind: "info", title: "kept" }, T0)!;
  board.dismiss(posted.id);
  assert.deepEqual(
    visibleToasts(board.notices.get(), board.dismissed.get(), T0 + 100),
    [],
    "gone from the stack",
  );
  assert.equal(board.notices.get().length, 1, "still in the log");
});

test("an expired notice leaves the stack but STAYS in the log", () => {
  const board = createNoticeBoard();
  board.post({ kind: "info", title: "kept" }, T0);
  assert.deepEqual(visibleToasts(board.notices.get(), new Set(), T0 + TOAST_MS + 1), []);
  assert.equal(board.notices.get().length, 1);
});

test("the stack is capped so a burst cannot fill the screen", () => {
  const notices = Array.from({ length: 12 }, (_, index) =>
    notice({ id: index + 1, title: `n${index}`, key: `k${index}` }),
  );
  assert.equal(visibleToasts(notices, new Set(), T0 + 100).length, 4);
});

test("the cap keeps the NEWEST, not the first four of a burst", () => {
  const notices = Array.from({ length: 12 }, (_, index) =>
    notice({ id: index + 1, title: `n${index}`, key: `k${index}` }),
  );
  const shown = visibleToasts(notices, new Set(), T0 + 100);
  assert.deepEqual(shown.map((entry) => entry.title), ["n11", "n10", "n9", "n8"]);
});

test("the cap counts only LIVE toasts, so expired ones do not use up slots", () => {
  const old = Array.from({ length: 6 }, (_, index) =>
    notice({ id: index + 1, title: `old${index}`, key: `o${index}`, atMs: T0 }),
  );
  const fresh = notice({ id: 99, title: "fresh", key: "f", atMs: T0 + TOAST_MS });
  const shown = visibleToasts([...old, fresh], new Set(), T0 + TOAST_MS + 10);
  assert.deepEqual(shown.map((entry) => entry.title), ["fresh"]);
});

// --- housekeeping ------------------------------------------------------------

test("clearing empties the log and forgets the dismissals", () => {
  const board = createNoticeBoard();
  const posted = board.post({ kind: "info", title: "x" }, T0)!;
  board.dismiss(posted.id);
  board.clear();
  assert.deepEqual(board.notices.get(), []);
  assert.equal(board.dismissed.get().size, 0);
});

test("two boards built separately do not share state", () => {
  const a = createNoticeBoard();
  const b = createNoticeBoard();
  a.post({ kind: "info", title: "x" }, T0);
  assert.deepEqual(b.notices.get(), []);
});

test("the app's shared board is a real board", () => {
  assert.equal(typeof noticeBoard.post, "function");
});

test("every notice carries WORDS, so colour is never the only signal", () => {
  const board = createNoticeBoard();
  const posted = board.post({ kind: "danger", title: "Under attack" }, T0)!;
  assert.ok(posted.title.length > 0);
  assert.ok(["info", "good", "warn", "danger"].includes(posted.kind));
});
