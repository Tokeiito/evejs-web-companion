// Overview refresh cadence (goal R11).
//
// The retail client re-renders its overview every 0.5-1.0s off a locally
// dead-reckoned ballpark. We re-read the authoritative snapshot about three
// times a second while the ship is in space and the panel is open, and draw
// exactly what it says — see the note in `ui/Tactical.svelte` for the two
// attempts at smoothing between reads and why neither survived. Polling here is
// not a stand-in for push — it IS the cadence the real client runs at,
// and the R10 push channel does not replace it (the channel carries events, not
// continuous positions).
//
// Two rules keep it from getting in the autopilot's way:
//   - it is a READ, and it is skipped whenever a read is already in flight, so a
//     slow snapshot can never queue up behind itself;
//   - it stops the moment the ship is not in space or the panel closes, so a
//     docked player and a backgrounded tab cost nothing.
// The autopilot loop owns its own cadence and its own flight-status reads; this
// poller never issues a movement call and never blocks one.

/**
 * The in-space cadence — how often the AUTHORITATIVE grid is re-read.
 *
 * ⚠ THIS IS ALSO THE FRAME RATE OF SPACE. Nothing is drawn between reads, so
 * brackets step at exactly this cadence — raising it makes the picture smoother
 * AND costlier in the same breath, which is why it is worth being deliberate
 * about. R89 raised it from 1_000 to 200 and R91 settled it at 333: three times
 * the snapshot reads and three times the bytes of the original.
 *
 * Two things keep that safe rather than merely faster. A beat is SKIPPED
 * whenever a read is still in flight (see below), so a server that cannot answer
 * in time is naturally throttled to whatever it can actually do instead of
 * accumulating a queue. And the poller stops entirely the moment the ship is not
 * in space, the panel closes, or the tab is hidden.
 */
export const SPACE_POLL_INTERVAL_MS = 333;

export interface SpacePollerDeps {
  /** Perform one snapshot read. Rejections are swallowed by the poller. */
  readonly refresh: () => Promise<void> | void;
  /** Whether polling should currently run (in space AND the panel is open). */
  readonly shouldPoll: () => boolean;
  readonly intervalMs?: number;
  readonly setInterval?: (handler: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

export interface SpacePoller {
  /** Start polling (no-op when already running). */
  start(): void;
  stop(): void;
  /** True while the timer is armed (for tests/diagnostics). */
  running(): boolean;
  /** Run one cycle now, honouring the in-flight guard. Used by tests. */
  tick(): Promise<void>;
}

export function createSpacePoller(deps: SpacePollerDeps): SpacePoller {
  const intervalMs = deps.intervalMs ?? SPACE_POLL_INTERVAL_MS;
  const setTimer = deps.setInterval ?? ((handler, ms) => setInterval(handler, ms));
  const clearTimer =
    deps.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));

  let handle: unknown = null;
  let inFlight = false;

  async function cycle(): Promise<void> {
    // Stop as soon as the ship is out of space (docked) or the panel closed —
    // the poll must not keep a docked player's session busy.
    if (!deps.shouldPoll()) {
      stop();
      return;
    }
    // A slow read must never queue behind itself; skipping a beat is correct.
    if (inFlight) {
      return;
    }
    inFlight = true;
    try {
      await deps.refresh();
    } catch {
      // A failed read is surfaced through the store by the flow; the poller
      // simply tries again next beat rather than tearing itself down.
    } finally {
      inFlight = false;
    }
  }

  function stop(): void {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  }

  return {
    start() {
      if (handle !== null) {
        return;
      }
      handle = setTimer(() => void cycle(), intervalMs);
    },
    stop,
    running() {
      return handle !== null;
    },
    tick: cycle,
  };
}
