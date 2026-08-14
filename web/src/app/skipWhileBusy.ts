// A periodic read must never queue behind itself (goal R92).
//
// ---------------------------------------------------------------------------
// ⚠ THE FAILURE THIS EXISTS TO PREVENT — READ THIS BEFORE WRITING A `setInterval`
// THAT MAKES A NETWORK CALL.
//
// A browser opens about SIX connections per origin over HTTP/1.1, and that pool
// is shared by every request the tab makes. A poll written as
//
//     setInterval(() => void refresh(), 10_000)
//
// fires on the clock whether or not the previous read has come back. While the
// server answers promptly that is harmless — one request at a time, the pool
// barely notices. When the server STALLS it stops being harmless and starts
// being the thing that takes the whole page down:
//
//   1. The BFF slows (a busy owner lane, a bot fleet, one wedged call). Reads
//      that used to take 30 ms now take tens of seconds.
//   2. The unguarded poll keeps firing anyway. Every 10 s another request is
//      handed to the browser, and none of them are finishing.
//   3. Inside a minute the six connections are all held by stalled polls.
//   4. EVERY OTHER REQUEST NOW QUEUES IN THE BROWSER AND IS NEVER SENT. Not
//      slow — not sent. The socket to send it on does not exist.
//   5. `AbortSignal.timeout()` counts that queued time, so each one eventually
//      rejects with "signal timed out" having never touched the network. The
//      player sees several unrelated parts of the client fail at once, and the
//      server logs show nothing at all, because nothing arrived.
//
// That is the shape of the field reports this was written for: a journal read,
// the space snapshot and the location read all failing together with transport
// errors, on a BFF that bounds every one of those routes to a single ~18 s
// gateway call and so cannot possibly have spent 65 s on any of them.
//
// The poll that is slow is not the poll that visibly breaks. A poll that piles
// up steals the connections that everything ELSE needs, so the symptom lands on
// whatever the player happened to click. That is what makes this worth a shared
// primitive rather than a fix at each site: the cost is paid somewhere other
// than where the mistake is, which is exactly the sort of bug that does not get
// found by looking at the broken thing.
//
// ---------------------------------------------------------------------------
// SKIPPING A BEAT IS THE CORRECT BEHAVIOUR, NOT A COMPROMISE
//
// A poll asks "what is true now?". If the previous answer has not arrived, the
// question is already outstanding — asking again cannot make it arrive sooner,
// and the extra answer would be thrown away. Skipping degrades the poll's
// effective rate to whatever the server can actually sustain, which is the rate
// it should have been running at anyway.
//
// This is what `spacePoll.ts` has always done by hand, and what the pollers
// written after it copied the SHAPE of without the guard.

/** A poll wrapped so it can only ever have one call outstanding. */
export interface GuardedPoll {
  /** Run, unless a previous run is still outstanding. Never rejects. */
  (): Promise<void>;
  /** True while a run is outstanding. */
  busy(): boolean;
  /**
   * How many beats have been skipped because the previous read had not come
   * back. A steadily climbing count is the server telling you it cannot answer
   * as fast as you are asking — worth surfacing, and worth reading before
   * anyone "fixes" a slow panel by polling it harder.
   */
  skipped(): number;
}

/**
 * Wrap a periodic read so overlapping beats are skipped rather than queued.
 *
 * ⚠ NEVER REJECTS, DELIBERATELY. It is called from `setInterval` callbacks,
 * where a rejection becomes an unhandled promise rejection and — via the app's
 * error overlay — a page-covering "a script error occurred" for what is usually
 * one dropped read. A poll that fails simply tries again next beat; the flow it
 * wraps is what reports the failure to the player, and it is the only thing that
 * knows how to word it.
 */
export function skipWhileBusy(run: () => Promise<void> | void): GuardedPoll {
  let inFlight = false;
  let skipped = 0;

  const poll = async (): Promise<void> => {
    if (inFlight) {
      skipped += 1;
      return;
    }
    inFlight = true;
    try {
      await run();
    } catch {
      // Reported by the caller, through the store. See the note above.
    } finally {
      inFlight = false;
    }
  };

  return Object.assign(poll, {
    busy: () => inFlight,
    skipped: () => skipped,
  });
}
