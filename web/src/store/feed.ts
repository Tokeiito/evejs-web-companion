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
  AgentConversation,
  AgentFinderRow,
  AgentFinderTarget,
  AgentRow,
  ChatChannel,
  ChatChannelState,
  CharacterSummary,
  CharStanding,
  CourierBriefing,
  FlightStatus,
  InventoryContainerState,
  JournalState,
  OnlineCharacterState,
  StationGuest,
  StationServiceBits,
  StationStatic,
  TravelRouteStep,
  TravelStatus,
  WalletLPBalance,
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
  // Goal R6b — the docked station changed on the SAME live session (autopilot
  // arrival / manual dock), learned from a flight-status snapshot. Re-points the
  // docked identity (online station/system + static station identity) and clears
  // the previous station's panel reads so the flow's re-fetch repopulates them.
  | {
      readonly type: "station/relocated";
      readonly stationID: number;
      readonly solarSystemID: number | null;
      readonly station: StationStatic | null;
    }
  // Docked station-panel reads on the live session.
  | { readonly type: "station/bits"; readonly bits: StationServiceBits }
  | { readonly type: "station/guests"; readonly guests: readonly StationGuest[] }
  // map.GetStationInfo answered with its retail CachedMethodCallResult
  // envelope (the rowset itself rides the retail object cache).
  | { readonly type: "station/info-cached"; readonly cached: boolean }
  // One or more docked reads failed non-fatally (e.g. a slow GetStationInfo):
  // surfaced so the panel shows the reason instead of a perpetual "Loading…".
  // A null message clears the error after a clean refresh.
  | { readonly type: "station/read-error"; readonly message: string | null }
  // Goal R3 — the Inventory & Ship page (bound-object bridge). A full panel
  // load: the docked station hangar and the active ship's cargo, each already
  // decoded (its own error preserved, so one failed container never blanks the
  // other).
  | {
      readonly type: "inventory/loaded";
      readonly stationID: number | null;
      readonly activeShipID: number | null;
      readonly hangar: InventoryContainerState;
      readonly cargo: InventoryContainerState;
    }
  // A mutation (move/stack/board) failed; null clears the error after success.
  | { readonly type: "inventory/action-error"; readonly message: string | null }
  // Drop the inventory state (character offline / logged out).
  | { readonly type: "inventory/cleared" }
  // Goal R4 — the Agents & Missions page (agentMgr bridge). The station's
  // agent roster (decoded + filtered to the docked station by the BFF).
  | { readonly type: "agents/list"; readonly stationID: number | null; readonly agents: readonly AgentRow[] }
  // An open agent conversation: what the agent says + the action buttons.
  | {
      readonly type: "agents/conversation";
      readonly agentID: number;
      readonly conversation: AgentConversation;
    }
  // The accepted-courier briefing (null clears it, e.g. after a decline).
  | { readonly type: "agents/briefing"; readonly briefing: CourierBriefing | null }
  // The mission journal (active + offered missions).
  | { readonly type: "agents/journal"; readonly journal: JournalState }
  // An agent action/read failed; null clears the error after success.
  | { readonly type: "agents/action-error"; readonly message: string | null }
  // Drop the agents state (character offline / logged out).
  | { readonly type: "agents/cleared" }
  // Goal R6 — the post-completion reward readout (inventory Step 12). The
  // wallet/LP/standings pull reads after Complete pays out (the journal, the
  // fourth Step-12 read, refreshes into the agents slice on the same Complete).
  | {
      readonly type: "rewards/loaded";
      readonly cashBalance: string | null;
      readonly lpBalances: readonly WalletLPBalance[];
      readonly standings: readonly CharStanding[];
      readonly error: string | null;
    }
  // Drop the reward readout (character offline / logged out).
  | { readonly type: "rewards/cleared" }
  // Goal R6a — the Agent Finder. A find completed: the filtered/capped agents,
  // already annotated with jumps from the current system and sorted
  // nearest-first by the flow, plus the filter echo and match/cap counts.
  | {
      readonly type: "finder/results";
      readonly kind: string;
      readonly level: number | null;
      readonly originSystemID: number | null;
      readonly agents: readonly AgentFinderRow[];
      readonly total: number;
      readonly capped: boolean;
    }
  // The player set the autopilot to an agent (or cleared it): who they're flying
  // to. null clears the target.
  | { readonly type: "finder/target"; readonly target: AgentFinderTarget | null }
  // A find failed non-fatally; null clears the error after a clean find.
  | { readonly type: "finder/error"; readonly message: string | null }
  // Drop the finder state (character offline / logged out).
  | { readonly type: "finder/cleared" }
  // Goal R5a — the Flight page (manually-stepped space movement). A flight-
  // status snapshot: the session's current location + ship movement state.
  | { readonly type: "flight/status"; readonly status: FlightStatus }
  // Goal R7a — resolved location NAMES for the current status (system / station /
  // structure), so the readout shows "Jita" not "30000142". Carries the IDs the
  // names were resolved for; the reducer applies each name only if the current
  // status still has that ID (so a stale resolve can never mislabel a new one).
  | {
      readonly type: "flight/location";
      readonly forSolarSystemID: number | null;
      readonly forStationID: number | null;
      readonly forStructureID: number | null;
      readonly solarSystemName: string | null;
      readonly stationName: string | null;
      readonly structureName: string | null;
    }
  // The last movement step issued (undock / warp / jump / dock) — for the
  // status readout. A successful step clears any stale action error.
  | { readonly type: "flight/action"; readonly action: string }
  // A movement step failed (the handler's own refusal reason); null clears it.
  | { readonly type: "flight/action-error"; readonly message: string | null }
  // Drop the flight state (character offline / logged out).
  | { readonly type: "flight/cleared" }
  // Goal R5b — the Travel panel (browser autopilot decide-loop). A route was
  // computed (client-side solver) and the loop started.
  | {
      readonly type: "travel/planned";
      readonly destinationSystemID: number;
      readonly destinationStationID: number | null;
      readonly destinationName: string | null;
      readonly route: readonly TravelRouteStep[];
      readonly totalJumps: number;
      readonly startedAt: number;
    }
  // A live progress push from the decide-loop (system/next/phase/remaining/…).
  | {
      readonly type: "travel/progress";
      readonly status: TravelStatus;
      readonly action: string | null;
      readonly phase: string | null;
      readonly currentSystemID: number | null;
      readonly currentSystemName: string | null;
      readonly nextSystemID: number | null;
      readonly nextSystemName: string | null;
      readonly remainingJumps: number;
      readonly totalJumps: number;
      readonly failureReason: string | null;
    }
  // Starting a route failed before the loop began (unreachable / not in space /
  // graph load); null clears a stale plan error.
  | { readonly type: "travel/plan-error"; readonly message: string | null }
  // Drop the travel state (character offline / logged out / new route).
  | { readonly type: "travel/cleared" }
  // Goal R7 — the Chat panel (Local + Corp). A channel read completed (roster +
  // recent backlog) — the panel polls while open (READ is a backlog poll).
  | {
      readonly type: "chat/loaded";
      readonly channel: ChatChannel;
      readonly channelState: ChatChannelState;
    }
  // The active channel tab changed (Local <-> Corp).
  | { readonly type: "chat/active"; readonly channel: ChatChannel }
  // A chat read/send failed non-fatally; null clears it after success.
  | { readonly type: "chat/error"; readonly message: string | null }
  // Drop the chat state (character offline / logged out).
  | { readonly type: "chat/cleared" };

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
