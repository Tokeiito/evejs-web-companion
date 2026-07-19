// Client-state store skeleton (goal R1b, roadmap section 5).
//
// One store is the single source of truth mirroring the relevant EveJS
// session/character state in the browser. The UI pages and, later, the
// browser autopilot loop are *pure readers*: they read via `get()` or the
// per-slice signals and subscribe for changes; they never write slices
// directly. State enters through `apply(event)` — normally called by the
// feed adapter attached with `attachFeed` (see feed.ts), which hides whether
// the events came from the legacy WS stream or from bridge-forwarded session
// notifications.
//
// R1b ships the session/character skeleton. Further slices (inventory,
// journal, space, ...) arrive with their pages on the R2-R6 rail.

import {
  createSignal,
  readonlySignal,
  type ReadableSignal,
  type Unsubscribe,
} from "./signals.ts";
import type { FeedAdapter, FeedEvent, FeedSink, FeedStatus } from "./feed.ts";
import type {
  CharacterSummary,
  OnlineCharacterState,
  StationGuest,
  StationServiceBits,
  StationStatic,
} from "./types.ts";

// --- Typed state slices ----------------------------------------------------

/** Who is logged in to the web BFF (which pins bridge session identity). */
export interface SessionSlice {
  readonly phase: "logged-out" | "logged-in";
  readonly accountID: number | null;
  readonly username: string | null;
}

/** Character context: the account's characters and the selected one. */
export interface CharacterSlice {
  readonly selectedCharacterID: number | null;
  readonly characters: readonly CharacterSummary[];
}

/**
 * The docked station panel (goal R2): who is online on the persistent
 * browser-backed session and what the docked-entry reads returned.
 */
export interface StationSlice {
  readonly online: OnlineCharacterState | null;
  readonly station: StationStatic | null;
  readonly bits: StationServiceBits | null;
  readonly guests: readonly StationGuest[];
  /** null until map.GetStationInfo answered; then whether it was the cached envelope. */
  readonly stationInfoCached: boolean | null;
}

/** Which feed adapter is attached and its connectivity — not the transport itself. */
export interface FeedSlice {
  readonly adapter: string | null;
  readonly status: FeedStatus;
}

export interface ClientState {
  readonly session: SessionSlice;
  readonly character: CharacterSlice;
  readonly station: StationSlice;
  readonly feed: FeedSlice;
}

const INITIAL_SESSION: SessionSlice = Object.freeze({
  phase: "logged-out",
  accountID: null,
  username: null,
});

const INITIAL_CHARACTER: CharacterSlice = Object.freeze({
  selectedCharacterID: null,
  characters: Object.freeze([]) as readonly CharacterSummary[],
});

const INITIAL_STATION: StationSlice = Object.freeze({
  online: null,
  station: null,
  bits: null,
  guests: Object.freeze([]) as readonly StationGuest[],
  stationInfoCached: null,
});

const INITIAL_FEED: FeedSlice = Object.freeze({
  adapter: null,
  status: "idle" as FeedStatus,
});

// --- Store -----------------------------------------------------------------

export interface ClientStore {
  /** Per-slice read/subscribe API for pure readers. */
  readonly session: ReadableSignal<SessionSlice>;
  readonly character: ReadableSignal<CharacterSlice>;
  readonly station: ReadableSignal<StationSlice>;
  readonly feed: ReadableSignal<FeedSlice>;

  /** Whole-state snapshot. */
  get(): ClientState;
  /**
   * Whole-store subscription: called synchronously with the current state,
   * then exactly once per applied event / feed-status change (slice updates
   * from one event are batched into one notification).
   */
  subscribe(listener: (state: ClientState) => void): Unsubscribe;

  /** Reduce one normalized feed event into the state. */
  apply(event: FeedEvent): void;

  /**
   * Attach a feed adapter (detaching any previous one) and start it. Returns
   * a detach function that stops the adapter; events published by a detached
   * adapter are ignored.
   */
  attachFeed(adapter: FeedAdapter): Unsubscribe;
}

export function createClientStore(): ClientStore {
  const session = createSignal<SessionSlice>(INITIAL_SESSION);
  const character = createSignal<CharacterSlice>(INITIAL_CHARACTER);
  const station = createSignal<StationSlice>(INITIAL_STATION);
  const feed = createSignal<FeedSlice>(INITIAL_FEED);

  // Whole-store notification: bumped once per applied change so multi-slice
  // reducers still produce a single store-level notification.
  const version = createSignal(0);
  const bump = (): void => {
    version.set(version.get() + 1);
  };

  const get = (): ClientState => ({
    session: session.get(),
    character: character.get(),
    station: station.get(),
    feed: feed.get(),
  });

  const reduce = (event: FeedEvent): void => {
    switch (event.type) {
      case "session/logged-in":
        session.set({
          phase: "logged-in",
          accountID: event.accountID,
          username: event.username,
        });
        break;
      case "session/logged-out":
        // Logging out drops the character and station context with the session.
        session.set(INITIAL_SESSION);
        character.set(INITIAL_CHARACTER);
        station.set(INITIAL_STATION);
        break;
      case "character/list": {
        const characters = [...event.characters];
        const selected = character.get().selectedCharacterID;
        const stillPresent =
          selected !== null &&
          characters.some((row) => row.characterID === selected);
        character.set({
          selectedCharacterID: stillPresent ? selected : null,
          characters,
        });
        break;
      }
      case "character/selected": {
        const current = character.get();
        const requested = event.characterID;
        const known =
          requested !== null &&
          current.characters.some((row) => row.characterID === requested);
        character.set({
          ...current,
          selectedCharacterID: known ? requested : null,
        });
        break;
      }
      case "character/online":
        // A fresh docked entry: the panel reads (bits/guests/info) repopulate
        // from their own events on the new live session.
        station.set({
          ...INITIAL_STATION,
          online: event.character,
          station: event.station,
        });
        break;
      case "character/offline":
        station.set(INITIAL_STATION);
        break;
      case "station/bits":
        station.set({ ...station.get(), bits: event.bits });
        break;
      case "station/guests":
        station.set({ ...station.get(), guests: [...event.guests] });
        break;
      case "station/info-cached":
        station.set({ ...station.get(), stationInfoCached: event.cached });
        break;
    }
  };

  const apply = (event: FeedEvent): void => {
    reduce(event);
    bump();
  };

  // --- Feed attachment -----------------------------------------------------

  let activeDetach: Unsubscribe | null = null;

  const attachFeed = (adapter: FeedAdapter): Unsubscribe => {
    if (activeDetach) {
      activeDetach();
    }

    let attached = true;
    const sink: FeedSink = {
      publish(event) {
        if (attached) {
          apply(event);
        }
      },
      setStatus(status) {
        if (attached || status === "disconnected") {
          feed.set({ adapter: adapter.name, status });
          bump();
        }
      },
    };

    const detach = (): void => {
      if (!attached) {
        return;
      }
      attached = false;
      if (activeDetach === detach) {
        activeDetach = null;
      }
      adapter.stop();
    };

    activeDetach = detach;
    feed.set({ adapter: adapter.name, status: "connecting" });
    bump();
    adapter.start(sink);
    return detach;
  };

  const subscribe = (listener: (state: ClientState) => void): Unsubscribe =>
    version.subscribe(() => listener(get()));

  return {
    session: readonlySignal(session),
    character: readonlySignal(character),
    station: readonlySignal(station),
    feed: readonlySignal(feed),
    get,
    subscribe,
    apply,
    attachFeed,
  };
}
