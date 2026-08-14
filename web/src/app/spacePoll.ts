// Overview refresh cadence (goal R11).
//
// The retail client re-renders its overview every 0.5-1.0s off a locally
// dead-reckoned ballpark. We re-read the authoritative snapshot twice a second
// while the ship is in space and the panel is open — the same cadence — and draw
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
 * ⚠ THIS IS ALSO THE FRAME RATE OF SPACE, AND EVERY BEAT IS AN OWNER CALL.
 * Nothing is drawn between reads, so brackets step at exactly this cadence —
 * raising it makes the picture smoother and costlier in the same breath, on a
 * gateway that serialises owner calls. That is not theoretical: R89 took this to
 * 200 ms, and the connection failures that followed were the load.
 *
 * 500 ms is retail's own overview cadence (0.5-1.0s), which is the argument for
 * it. Twice the original cost, half of what 3 Hz asked for, and the step from
 * three frames a second to two is far less visible than the difference in load.
 *
 * Two things keep it safe rather than merely faster. A beat is SKIPPED whenever
 * a read is still in flight (see below), so a server that cannot answer in time
 * is naturally throttled to whatever it can actually do instead of accumulating
 * a queue. And the poller stops entirely the moment the ship is not in space,
 * the panel closes, or the tab is hidden.
 */
export const SPACE_POLL_INTERVAL_MS = 500;

/**
 * How often the LOCKED-TARGET list is re-read, in milliseconds.
 *
 * ⚠ DELIBERATELY NOT THE SNAPSHOT'S RATE. The targets read rode the snapshot
 * beat, so raising the overview's refresh from 1 Hz to 3 Hz silently tripled a
 * second, unrelated owner call as well — six gateway calls a second per pilot
 * where there had been two, against an owner that serialises them. The comment
 * on that read already recorded gateway contention timing it out once before.
 *
 * Locking happens on human timescales: the server acquires a lock over a second
 * or more, and the list changes when a player clicks something. A second is
 * plenty, and it stays a second however smooth the grid is made.
 */
export const TARGETS_POLL_INTERVAL_MS = 1_000;

/**
 * Is a targets read due? `lastReadAtMs` is null before the first one.
 *
 * Kept here, next to the cadence it enforces, so the rule is one testable
 * decision rather than a comparison buried in the poll's callback.
 */
export function targetsReadIsDue(lastReadAtMs: number | null, nowMs: number): boolean {
  if (lastReadAtMs === null || !Number.isFinite(lastReadAtMs)) {
    return true;
  }
  // A clock that has jumped backwards must not freeze the read for ever.
  if (nowMs < lastReadAtMs) {
    return true;
  }
  return nowMs - lastReadAtMs >= TARGETS_POLL_INTERVAL_MS;
}

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
