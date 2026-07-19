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
  AgentsState,
  CharacterSummary,
  FlightState,
  InventoryContainerState,
  InventoryState,
  OnlineCharacterState,
  RewardsState,
  StationGuest,
  StationServiceBits,
  StationStatic,
  TravelState,
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
  /** Non-null when the last docked-read refresh had a (non-fatal) failure. */
  readonly readError: string | null;
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
  readonly inventory: InventoryState;
  readonly agents: AgentsState;
  readonly rewards: RewardsState;
  readonly flight: FlightState;
  readonly travel: TravelState;
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
  readError: null,
});

const EMPTY_CONTAINER: InventoryContainerState = Object.freeze({
  rows: Object.freeze([]) as InventoryContainerState["rows"],
  capacity: null,
  error: null,
});

const INITIAL_INVENTORY: InventoryState = Object.freeze({
  stationID: null,
  activeShipID: null,
  hangar: EMPTY_CONTAINER,
  cargo: EMPTY_CONTAINER,
  loaded: false,
  actionError: null,
});

const INITIAL_AGENTS: AgentsState = Object.freeze({
  stationID: null,
  agents: Object.freeze([]) as AgentsState["agents"],
  activeAgentID: null,
  conversation: null,
  briefing: null,
  journal: null,
  loaded: false,
  actionError: null,
});

const INITIAL_REWARDS: RewardsState = Object.freeze({
  cashBalance: null,
  lpBalances: Object.freeze([]) as RewardsState["lpBalances"],
  standings: Object.freeze([]) as RewardsState["standings"],
  loaded: false,
  error: null,
});

const INITIAL_FLIGHT: FlightState = Object.freeze({
  status: null,
  loaded: false,
  lastAction: null,
  actionError: null,
});

const INITIAL_TRAVEL: TravelState = Object.freeze({
  status: "idle" as TravelState["status"],
  destinationSystemID: null,
  destinationStationID: null,
  destinationName: null,
  route: Object.freeze([]) as TravelState["route"],
  currentSystemID: null,
  currentSystemName: null,
  nextSystemID: null,
  nextSystemName: null,
  action: null,
  phase: null,
  remainingJumps: 0,
  totalJumps: 0,
  startedAt: null,
  failureReason: null,
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
  readonly inventory: ReadableSignal<InventoryState>;
  readonly agents: ReadableSignal<AgentsState>;
  readonly rewards: ReadableSignal<RewardsState>;
  readonly flight: ReadableSignal<FlightState>;
  readonly travel: ReadableSignal<TravelState>;
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
  const inventory = createSignal<InventoryState>(INITIAL_INVENTORY);
  const agents = createSignal<AgentsState>(INITIAL_AGENTS);
  const rewards = createSignal<RewardsState>(INITIAL_REWARDS);
  const flight = createSignal<FlightState>(INITIAL_FLIGHT);
  const travel = createSignal<TravelState>(INITIAL_TRAVEL);
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
    inventory: inventory.get(),
    agents: agents.get(),
    rewards: rewards.get(),
    flight: flight.get(),
    travel: travel.get(),
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
        inventory.set(INITIAL_INVENTORY);
        agents.set(INITIAL_AGENTS);
        rewards.set(INITIAL_REWARDS);
        flight.set(INITIAL_FLIGHT);
        travel.set(INITIAL_TRAVEL);
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
        inventory.set(INITIAL_INVENTORY);
        agents.set(INITIAL_AGENTS);
        rewards.set(INITIAL_REWARDS);
        flight.set(INITIAL_FLIGHT);
        travel.set(INITIAL_TRAVEL);
        break;
      case "character/offline":
        station.set(INITIAL_STATION);
        inventory.set(INITIAL_INVENTORY);
        agents.set(INITIAL_AGENTS);
        rewards.set(INITIAL_REWARDS);
        flight.set(INITIAL_FLIGHT);
        travel.set(INITIAL_TRAVEL);
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
      case "station/read-error":
        station.set({ ...station.get(), readError: event.message });
        break;
      case "inventory/loaded":
        inventory.set({
          stationID: event.stationID,
          activeShipID: event.activeShipID,
          hangar: event.hangar,
          cargo: event.cargo,
          loaded: true,
          // A successful load clears any stale mutation error.
          actionError: null,
        });
        break;
      case "inventory/action-error":
        inventory.set({ ...inventory.get(), actionError: event.message });
        break;
      case "inventory/cleared":
        inventory.set(INITIAL_INVENTORY);
        break;
      case "agents/list":
        agents.set({
          ...agents.get(),
          stationID: event.stationID,
          agents: [...event.agents],
          loaded: true,
          actionError: null,
        });
        break;
      case "agents/conversation":
        agents.set({
          ...agents.get(),
          activeAgentID: event.agentID,
          conversation: event.conversation,
          actionError: null,
        });
        break;
      case "agents/briefing":
        agents.set({ ...agents.get(), briefing: event.briefing });
        break;
      case "agents/journal":
        agents.set({ ...agents.get(), journal: event.journal });
        break;
      case "agents/action-error":
        agents.set({ ...agents.get(), actionError: event.message });
        break;
      case "agents/cleared":
        agents.set(INITIAL_AGENTS);
        break;
      case "rewards/loaded":
        rewards.set({
          cashBalance: event.cashBalance,
          lpBalances: [...event.lpBalances],
          standings: [...event.standings],
          loaded: true,
          error: event.error,
        });
        break;
      case "rewards/cleared":
        rewards.set(INITIAL_REWARDS);
        break;
      case "flight/status":
        flight.set({ ...flight.get(), status: event.status, loaded: true });
        break;
      case "flight/action":
        // A successful movement step: record it and clear any stale refusal.
        flight.set({ ...flight.get(), lastAction: event.action, actionError: null });
        break;
      case "flight/action-error":
        flight.set({ ...flight.get(), actionError: event.message });
        break;
      case "flight/cleared":
        flight.set(INITIAL_FLIGHT);
        break;
      case "travel/planned":
        travel.set({
          ...INITIAL_TRAVEL,
          status: "running",
          destinationSystemID: event.destinationSystemID,
          destinationStationID: event.destinationStationID,
          destinationName: event.destinationName,
          route: [...event.route],
          remainingJumps: event.totalJumps,
          totalJumps: event.totalJumps,
          startedAt: event.startedAt,
        });
        break;
      case "travel/progress":
        travel.set({
          ...travel.get(),
          status: event.status,
          action: event.action,
          phase: event.phase,
          currentSystemID: event.currentSystemID,
          currentSystemName: event.currentSystemName,
          nextSystemID: event.nextSystemID,
          nextSystemName: event.nextSystemName,
          remainingJumps: event.remainingJumps,
          totalJumps: event.totalJumps,
          failureReason: event.failureReason,
        });
        break;
      case "travel/plan-error":
        travel.set({ ...travel.get(), status: "idle", failureReason: event.message });
        break;
      case "travel/cleared":
        travel.set(INITIAL_TRAVEL);
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
    inventory: readonlySignal(inventory),
    agents: readonlySignal(agents),
    rewards: readonlySignal(rewards),
    flight: readonlySignal(flight),
    travel: readonlySignal(travel),
    feed: readonlySignal(feed),
    get,
    subscribe,
    apply,
    attachFeed,
  };
}
