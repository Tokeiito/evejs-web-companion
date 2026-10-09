// What the server said once, taken once.
//
// The retail client hears a notification once, on its one connection. This page can hear it twice: on the
// pilot's live stream as it arrives, and again with the next answer, where the BFF keeps a copy for a
// reader with no stream. On the game port both copies name the stream event they are (its cursor: the BFF
// process's epoch, and the event's number in the pilot's session), and this remembers which were taken.
//
// A copy with no cursor is always taken. The web gateway's answers carry none, so on that transport the
// two copies cannot be told apart, and both are still acted on.

export interface PushLedger {
  /** Whether this push is to be acted on: the first time its cursor is seen, and always when it has none. */
  take(cursor: unknown): boolean;
  /** A new session, whose events are numbered from the start again. */
  clear(): void;
}

/**
 * The game port keeps this many notifications for an answer (BACKLOG_LIMIT, src/gamePort/pilots.js), so a
 * copy that old can still arrive. Twice that many are remembered.
 */
export const PUSHES_REMEMBERED = 8192;

export function createPushLedger(limit: number = PUSHES_REMEMBERED): PushLedger {
  let epoch: string | null = null;
  const taken = new Set<number>();
  return {
    take(cursor) {
      const given = (typeof cursor === "object" && cursor !== null ? cursor : {}) as { epoch?: unknown; sequence?: unknown };
      const sequence = given.sequence;
      if (typeof given.epoch !== "string" || given.epoch === "" || typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence <= 0) {
        return true;
      }
      if (given.epoch !== epoch) {
        // Another BFF process: nothing of the last one's numbering holds.
        epoch = given.epoch;
        taken.clear();
      }
      if (taken.has(sequence)) {
        return false;
      }
      taken.add(sequence);
      if (taken.size > limit) {
        // The oldest remembered goes first: a set keeps the order things were added in.
        taken.delete(taken.values().next().value as number);
      }
      return true;
    },
    clear() {
      // With no epoch held, the next cursor is another epoch's, and its numbers are forgotten there.
      epoch = null;
    },
  };
}
