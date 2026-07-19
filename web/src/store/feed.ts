// Feed adapter seam (goal R1b, roadmap section 5).
//
// The client-state store is fed by whatever event transport exists at the
// time: initially the legacy sequenced WS event stream
// (public/eventClient.js), transitioning to bridge-forwarded session
// notifications (roadmap section 9 / G6) as the legacy machinery retires. The
// store never sees the transport — an adapter normalizes whichever wire
// events it speaks into `FeedEvent`s and reports connectivity via `FeedSink`.
// Swapping the transport means swapping the adapter; the store, the UI
// readers, and (later) the autopilot loop are unchanged.
//
// R1b ships the interface plus an in-memory adapter (tests and the scaffold
// smoke page). The legacy-WS adapter and the bridge-notification adapter are
// R2+ work and implement this same interface.

import type {
  CharacterSummary,
  OnlineCharacterState,
  StationGuest,
  StationServiceBits,
  StationStatic,
} from "./types.ts";

export type FeedStatus = "idle" | "connecting" | "connected" | "disconnected";

/**
 * Normalized store events. Transport-agnostic: a legacy WS payload or a
 * bridge-forwarded session notification must be mapped into one of these by
 * its adapter before it reaches the store. The union grows page by page on
 * the R2-R6 rail (inventory, journal, space, ... slices arrive with their
 * pages).
 */
export type FeedEvent =
  | { readonly type: "session/logged-in"; readonly accountID: number; readonly username: string }
  | { readonly type: "session/logged-out" }
  | { readonly type: "character/list"; readonly characters: readonly CharacterSummary[] }
  | { readonly type: "character/selected"; readonly characterID: number | null }
  // Goal R2 — the persistent browser-backed session and its docked entry:
  // a character came online (select-character succeeded) with its client-local
  // static station identity...
  | {
      readonly type: "character/online";
      readonly character: OnlineCharacterState;
      readonly station: StationStatic | null;
    }
  // ...or went offline (release, TTL expiry, session lost).
  | { readonly type: "character/offline" }
  // Docked station-panel reads on the live session.
  | { readonly type: "station/bits"; readonly bits: StationServiceBits }
  | { readonly type: "station/guests"; readonly guests: readonly StationGuest[] }
  // map.GetStationInfo answered with its retail CachedMethodCallResult
  // envelope (the rowset itself rides the retail object cache).
  | { readonly type: "station/info-cached"; readonly cached: boolean }
  // One or more docked reads failed non-fatally (e.g. a slow GetStationInfo):
  // surfaced so the panel shows the reason instead of a perpetual "Loading…".
  // A null message clears the error after a clean refresh.
  | { readonly type: "station/read-error"; readonly message: string | null };

/** What the store hands an adapter: publish events, report connectivity. */
export interface FeedSink {
  publish(event: FeedEvent): void;
  setStatus(status: FeedStatus): void;
}

/** A transport adapter. Constructed with its transport details; started with a sink. */
export interface FeedAdapter {
  /** Stable name surfaced in the store's feed slice (e.g. "legacy-ws", "bridge", "memory"). */
  readonly name: string;
  start(sink: FeedSink): void;
  stop(): void;
}

/**
 * In-memory adapter: the minimal transport used by unit tests and the R1b
 * scaffold smoke page. `emit` throws when the adapter is not started so test
 * bugs surface instead of silently dropping events.
 */
export class MemoryFeedAdapter implements FeedAdapter {
  readonly name: string;
  private sink: FeedSink | null = null;

  constructor(name = "memory") {
    this.name = name;
  }

  start(sink: FeedSink): void {
    this.sink = sink;
    sink.setStatus("connected");
  }

  stop(): void {
    if (this.sink) {
      this.sink.setStatus("disconnected");
      this.sink = null;
    }
  }

  get started(): boolean {
    return this.sink !== null;
  }

  emit(event: FeedEvent): void {
    if (!this.sink) {
      throw new Error("MemoryFeedAdapter.emit called before start()");
    }
    this.sink.publish(event);
  }
}
