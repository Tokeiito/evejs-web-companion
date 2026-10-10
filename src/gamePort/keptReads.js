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
 *
 * `amend(keptAs, change)` is the other way of the client's: what is kept becomes what `change` makes of it, and
 * nothing is asked. It takes its turn behind the reads begun before it, so that an answer on its way is kept
 * first and amended after. Where nothing is kept it does nothing: the next read asks, and is answered as things are.
 * Where `change` makes nothing of what is kept (it answers `undefined`, or fails), that one answer is let go, and
 * the next read of it asks: an amendment never fails for who made it.
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
    amend(keptAs, change) {
      work = work.then(() => {
        if (!kept.has(keptAs)) return;
        let made;
        try {
          made = change(kept.get(keptAs));
        } catch {
          made = undefined;
        }
        if (made === undefined) kept.delete(keptAs);
        else kept.set(keptAs, made);
      });
      return work;
    },
    forget() {
      kept.clear();
      forgotten += 1;
    },
  };
}

module.exports = { createKeptReads };
