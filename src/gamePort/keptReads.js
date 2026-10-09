"use strict";

/**
 * Answers kept until something changes them.
 *
 * A service of the retail client asks its server for a list once, keeps it, and works the server's notices and its
 * own writes into what it keeps. Where the transport does not work a change into a list, it forgets the list and
 * asks for it again when it is next wanted: that asks more often than the client does, and is never behind it.
 *
 * `read(keptAs, ask)` answers what is kept as `keptAs`, or asks for it and keeps the answer. Reads go one after
 * another, so that two that find nothing kept ask once. `forget()` forgets everything kept. An answer on its way
 * when everything is forgotten may be from before what forgot it: it is handed on to who asked, and not kept.
 */
function createKeptReads() {
  const kept = new Map();
  let forgotten = 0;
  let work = Promise.resolve();
  return {
    /** Everything kept, each as it was answered. */
    answers: () => [...kept.values()],
    /** Fails as `ask` fails, for who asked; what is asked next is none the worse. */
    read(keptAs, ask) {
      const reading = work.then(async () => {
        if (kept.has(keptAs)) return kept.get(keptAs);
        const before = forgotten;
        const answer = await ask();
        if (before === forgotten) kept.set(keptAs, answer);
        return answer;
      });
      work = reading.catch(() => {});
      return reading;
    },
    forget() {
      kept.clear();
      forgotten += 1;
    },
  };
}

module.exports = { createKeptReads };
