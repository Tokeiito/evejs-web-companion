// The R2 page controller: drives the login -> character select -> docked
// station panel flow and feeds every outcome into the client-state store as
// events ("how to add a page", docs/bridge-wire-contract.md). The Svelte view
// is a pure reader of the store; this module owns all fetch/decode logic so
// it stays framework-agnostic and unit-testable under node:test.

import { getCharacterSelectionData } from "../bridge/characterSelection.ts";
import {
  getStationGuests,
  getStationInfoCached,
  getStationItemBits,
} from "../bridge/stationPanel.ts";
import { decodeContainer, decodeInventoryRows } from "../bridge/inventoryShip.ts";
import {
  AGENT_BUTTON,
  decodeBriefing,
  decodeConversation,
  decodeJournal,
} from "../bridge/agents.ts";
import {
  decodeCashBalance,
  decodeCharStandings,
  decodeLpBalances,
} from "../bridge/rewards.ts";
import { decodeFlightStatus } from "../bridge/flight.ts";
import { decodeSpaceSnapshot } from "../bridge/space.ts";
import { createSpacePoller, type SpacePoller } from "./spacePoll.ts";
import type { FlightStepResult } from "./api.ts";
import { BridgeCallError } from "../bridge/callMethod.ts";
import type { JsonValue } from "../bridge/wire.ts";
import * as api from "./api.ts";
import type { ClientStore } from "../store/clientStore.ts";
import type {
  AgentAction,
  ChatChannel,
  DestinationMatch,
  FlightStatus,
  StationStatic,
} from "../store/types.ts";
import {
  decodeChatChannel,
  decodeChatChannelName,
  decodeMessageEntry,
} from "../bridge/chat.ts";
import { nameKey, type NameRef } from "../store/names.ts";
import {
  buildSystemGraph,
  distancesFrom,
  solveRoute,
  type SystemGraph,
} from "../nav/routeSolver.ts";
import type { AgentFinderRow } from "../store/types.ts";
import {
  createAutopilot,
  type AutopilotController,
  type AutopilotDeps,
  type RoutePlan,
} from "../nav/autopilotLoop.ts";

export interface AppFlowOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /**
   * R10 — injectable EventSource factory for the live event channel. Defaults
   * to the browser's own EventSource; tests supply a fake.
   */
  readonly eventSource?: (url: string) => api.EventSourceLike;
}

export interface AppFlow {
  /** Who-cares login, then the typed reference call to fill the character list. */
  login(username: string, password: string): Promise<void>;
  /** Select a character onto the persistent session, then run the docked reads. */
  selectCharacter(characterID: number): Promise<void>;
  /** Refresh the docked station-panel reads on the live session. */
  refreshStationPanel(): Promise<void>;
  /** Load the Inventory & Ship panel (station hangar + active-ship cargo). */
  loadInventory(): Promise<void>;
  /** Move a selected item hangar <-> active-ship cargo, then refresh. */
  moveItem(itemID: number, direction: "toCargo" | "toHangar", qty?: number | null): Promise<void>;
  /** Stack all loose stacks in the hangar or active-ship cargo, then refresh. */
  stackContainer(target: "hangar" | "cargo"): Promise<void>;
  /** Board a hangar ship (it becomes active), then refresh. */
  boardShip(shipID: number): Promise<void>;
  /** Load the docked station's agent roster (agentMgr.GetAgents). */
  loadAgents(): Promise<void>;
  /** Open a conversation with an agent (bound DoAction(None)). */
  openConversation(agentID: number): Promise<void>;
  /**
   * Take a conversation action (DoAction on the bound agent): request / accept /
   * decline. Accepting a courier refreshes the briefing + journal; declining
   * clears the briefing and refreshes the journal.
   */
  chooseAction(agentID: number, action: AgentAction): Promise<void>;
  /** Load the accepted-courier briefing (bound reads on the agent). */
  loadBriefing(agentID: number): Promise<void>;
  /** Load the mission journal (agentMgr.GetMyJournalDetails). */
  loadJournal(): Promise<void>;
  /**
   * Load the accepted courier's package (matching the briefing cargo type) from
   * the station hangar into the active ship (reuses the R3 inventory move).
   */
  loadPackageIntoShip(cargoTypeID: number): Promise<void>;
  /**
   * Set the browser autopilot to the mission dropoff (a station): reuses the
   * R5b route solver + decide-loop via startRoute(dropoffStationID).
   */
  setAutopilotToDropoff(dropoffStationID: number): Promise<void>;
  /**
   * R6 — the post-completion reward readout (Step 12): wallet / LP / standings.
   * The journal (the fourth Step-12 read) refreshes via loadJournal.
   */
  loadRewards(): Promise<void>;
  /** Refresh the flight status (location + ship movement state). */
  loadFlightStatus(): Promise<void>;
  /** Undock from the station (the session enters space). */
  undock(): Promise<void>;
  /** Warp to a chosen gate/celestial through the bound park. */
  warpTo(destinationID: number): Promise<void>;
  /**
   * R11 — approach an object at full speed (the same atomic move the autopilot
   * uses to close the last gap to a gate). Offered on every overview row.
   */
  approach(destinationID: number): Promise<void>;
  /** R11 — read what is currently around the ship (and the ship's condition). */
  loadSpaceSnapshot(): Promise<void>;
  /**
   * R11 — start/stop the ~1s overview poll. The Overview panel starts it when it
   * mounts and stops it when it unmounts; it also stops itself as soon as the
   * ship is no longer in space (docked).
   */
  startSpacePolling(): void;
  stopSpacePolling(): void;
  /** Jump through an NPC stargate (fromGate -> toGate). */
  jump(fromGateID: number, toGateID: number): Promise<void>;
  /** Dock at the destination station. */
  dock(stationID: number): Promise<void>;
  /**
   * R6a — find agents from the static reference table (default courier),
   * annotate each with jumps from the current system (a single client-side
   * BFS), and sort nearest-first. Surfaces a failure through the finder slice
   * rather than throwing.
   */
  findAgents(filters?: { kind?: string; level?: number | null; limit?: number }): Promise<void>;
  /**
   * R6a — set the browser autopilot to a found agent's station (reuses the R5b
   * route solver + decide-loop via startRoute), and record the target agent so
   * the player knows who they're flying to.
   */
  setDestinationToAgent(agentID: number): Promise<void>;
  /**
   * R5b — start the browser autopilot to a destination (station or system ID):
   * solve the route client-side, then run the decide-loop. Surfaces a plan
   * error (unreachable / unknown) through the travel slice rather than throwing.
   */
  startRoute(destinationID: number): Promise<void>;
  /**
   * R7a — search the static map by name (systems + stations) so a player can set
   * a destination without knowing EVE IDs. Returns the matches annotated with
   * jumps from the current system (best-effort). A too-short query returns []
   * without a request; a read failure throws (the caller surfaces it).
   */
  searchDestinations(
    query: string,
    kind?: "system" | "station" | null,
  ): Promise<DestinationMatch[]>;
  /** Pause the autopilot loop (it stops issuing; the ship finishes its last move). */
  pauseRoute(): void;
  /** Resume a paused autopilot loop from where it stopped. */
  resumeRoute(): void;
  /** Abort the autopilot loop (it stops and never calls the bridge again). */
  abortRoute(): void;
  /**
   * R7 — read a chat channel's member roster + recent backlog (Local or Corp)
   * and push it to the store. The panel polls this while open (READ is a backlog
   * poll). A lost session unwinds to offline; any other failure surfaces through
   * the chat slice.
   */
  loadChat(channel: ChatChannel): Promise<void>;
  /** R7 — send a message to a chat channel, then refresh its backlog. */
  sendChatMessage(channel: ChatChannel, message: string): Promise<void>;
  /** R7 — switch the active chat tab (Local <-> Corp). */
  setChatChannel(channel: ChatChannel): void;
  /**
   * R7c — request display names for a set of `{kind, id}` refs (names-everywhere).
   * Fire-and-forget: unresolved refs are batched into one /api/names round-trip,
   * cached (including a definitive "unknown" so they never refetch), and pushed
   * into the store's `names` slice for pure-reader components. Already-cached or
   * in-flight refs are skipped; a transient failure is not cached (it can retry).
   * Never throws and never blocks interaction (the UI shows the ID until the name
   * lands).
   */
  requestNames(refs: readonly NameRef[]): void;
  /** Release the persistent session (character offline), back to the select list. */
  releaseSession(): Promise<void>;
  logout(): Promise<void>;
}

/** True when the session the BFF held is gone (TTL, takeover, restart). */
export function isSessionLost(error: unknown): boolean {
  return error instanceof BridgeCallError && error.code === "SESSION_NOT_FOUND";
}

/** Short, human-readable reason for a failed docked read. */
function readErrorReason(error: unknown): string {
  if (error instanceof BridgeCallError) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createAppFlow(store: ClientStore, options: AppFlowOptions = {}): AppFlow {
  const callOptions = {
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.eventSource !== undefined ? { eventSource: options.eventSource } : {}),
  };

  // R6b — the docked station the station-scoped panels are currently synced to,
  // and a guard so an in-flight relocate is not re-entered. Set on select and
  // updated whenever a flight-status snapshot reveals the character docked at a
  // different station (autopilot arrival / manual dock); see observeFlightStatus.
  let syncedStationID: number | null = null;
  let relocating = false;

  // --- R10 live event channel ---------------------------------------------
  // One SSE subscription per online character, opened when select succeeds and
  // closed when the character goes offline. It feeds the store the session
  // notifications the page used to discard and the chat messages the Chat panel
  // used to poll for. Liveness only: every bridge response still carries its
  // notification drain, so a channel that never opens costs latency, not data.
  let liveStream: api.BridgeEventSubscription | null = null;

  function applyLiveFrame(frame: unknown): void {
    if (typeof frame !== "object" || frame === null) {
      return;
    }
    const record = frame as Record<string, JsonValue>;

    // BFF-originated status frame (the gateway socket connected / dropped).
    if (record.source === "evejs-web-bff" && record.type === "stream-status") {
      const state = record.state;
      store.apply({
        type: "live/status",
        status:
          state === "live" || state === "connecting" || state === "degraded" || state === "ended"
            ? state
            : "idle",
      });
      return;
    }
    if (record.source !== "evejs-web-gateway") {
      return;
    }

    const cursor = (record.cursor ?? {}) as Record<string, JsonValue>;
    const epoch = typeof cursor.epoch === "string" ? cursor.epoch : null;
    const sequence = typeof cursor.sequence === "number" ? cursor.sequence : 0;

    // The gateway could not replay from our cursor: what we hold may have gaps,
    // so re-read the active chat channel rather than pretend the backlog is
    // continuous.
    if (record.type === "snapshot") {
      store.apply({ type: "live/resynchronize", epoch, sequence });
      if (record.reason === "cursor_not_replayable") {
        void loadChat(store.chat.get().activeChannel);
      }
      return;
    }
    if (record.type !== "event") {
      return;
    }

    const event = (record.event ?? {}) as Record<string, JsonValue>;
    if (event.kind === "chat") {
      const channel = event.channel === "corp" ? "corp" : "local";
      const message = decodeMessageEntry(event.entry);
      if (message) {
        store.apply({ type: "chat/message", channel, message });
      }
      return;
    }
    if (event.kind === "notification") {
      const notification = (event.notification ?? {}) as Record<string, JsonValue>;
      store.apply({
        type: "live/notification",
        epoch,
        sequence,
        notification: {
          kind: typeof notification.kind === "string" ? notification.kind : "unknown",
          service: typeof notification.service === "string" ? notification.service : null,
          method: typeof notification.method === "string" ? notification.method : null,
          receivedAtMs: Date.now(),
        },
      });
    }
  }

  function startLiveStream(): void {
    stopLiveStream();
    store.apply({ type: "live/status", status: "connecting" });
    liveStream = api.subscribeBridgeEvents(
      {
        onFrame: applyLiveFrame,
        onOpen: () => store.apply({ type: "live/status", status: "live" }),
        // EventSource reconnects on its own; the store just records that the
        // page is back on its polls until frames resume.
        onError: () => store.apply({ type: "live/status", status: "degraded" }),
      },
      callOptions,
    );
  }

  function stopLiveStream(): void {
    if (liveStream) {
      liveStream.close();
      liveStream = null;
    }
    store.apply({ type: "live/cleared" });
  }

  async function refreshStationPanel(): Promise<void> {
    // Retail issues these when the docked UI loads; the page issues them after
    // select succeeds (push forwarding is a later goal, G6). The three reads
    // are INDEPENDENT: a slow or failed map.GetStationInfo (the heavy
    // full-table marshal) must never blank the services row or the guest list.
    // And because selectCharacter calls this after the view has already
    // switched to the panel, a failure is reported through the store (visible
    // in the panel) rather than thrown into an unmounted caller — except a
    // lost session, which must unwind the flow back to the character list.
    const labels = ["GetStationItemBits", "GetGuests", "GetStationInfo"] as const;
    const [bits, guests, cached] = await Promise.allSettled([
      getStationItemBits(callOptions),
      getStationGuests(callOptions),
      getStationInfoCached(callOptions),
    ]);

    if (bits.status === "fulfilled") {
      store.apply({ type: "station/bits", bits: bits.value });
    }
    if (guests.status === "fulfilled") {
      store.apply({ type: "station/guests", guests: guests.value });
    }
    if (cached.status === "fulfilled") {
      store.apply({ type: "station/info-cached", cached: cached.value });
    }

    const failures = [bits, guests, cached]
      .map((result, index) => ({ result, label: labels[index] }))
      .filter((entry) => entry.result.status === "rejected") as ReadonlyArray<{
      result: PromiseRejectedResult;
      label: string;
    }>;

    // A lost live session can't be recovered by any read: flip offline and
    // unwind so the view falls back to the character list.
    const lost = failures.find((entry) => isSessionLost(entry.result.reason));
    if (lost) {
      stopLiveStream();
        store.apply({ type: "character/offline" });
      throw lost.result.reason;
    }

    // Otherwise keep whatever succeeded and surface the rest (null clears a
    // stale error after a clean refresh). Never throw here.
    store.apply({
      type: "station/read-error",
      message: failures.length
        ? failures
            .map((entry) => `${entry.label}: ${readErrorReason(entry.result.reason)}`)
            .join("; ")
        : null,
    });
  }

  // Load the Inventory & Ship panel. The two containers are decoded
  // independently (their own error is preserved) so one failed read never
  // blanks the other — R2's Promise.allSettled rule, applied here on the BFF's
  // already-settled per-container results. A lost session unwinds to select.
  async function loadInventory(): Promise<void> {
    let panel: Awaited<ReturnType<typeof api.loadInventory>>;
    try {
      panel = await api.loadInventory(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        // The live session ended out from under the inventory tab: unwind to
        // the character list like refreshStationPanel/runMutation, so the page
        // doesn't stay mounted with stale rows on a dead session.
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    store.apply({
      type: "inventory/loaded",
      stationID: panel.stationID,
      activeShipID: panel.activeShipID,
      hangar: decodeContainer(panel.hangar.list, panel.hangar.capacity, panel.hangar.error),
      cargo: decodeContainer(panel.cargo.list, panel.cargo.capacity, panel.cargo.error),
    });
  }

  // Run a mutation, then refresh the panel. A lost session is rethrown to
  // unwind the flow; any other failure is surfaced through the store (the page
  // stays put and shows the reason) rather than thrown into the UI handler.
  async function runMutation(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      store.apply({ type: "inventory/action-error", message: null });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "inventory/action-error", message: readErrorReason(error) });
      return;
    }
    await loadInventory();
  }

  // --- R4 Agents & Missions ------------------------------------------------

  async function loadJournal(): Promise<void> {
    const result = await api.loadJournal(callOptions);
    store.apply({ type: "agents/journal", journal: decodeJournal(result) });
  }

  async function loadBriefing(agentID: number): Promise<void> {
    const reads = await api.loadBriefing(agentID, callOptions);
    store.apply({
      type: "agents/briefing",
      briefing: decodeBriefing(reads.briefing, reads.objective),
    });
  }

  // R6 — the post-completion reward readout (Step 12): wallet / LP / standings.
  // The three reads are independent on the BFF (Promise.allSettled); a per-read
  // error rides in the `error` field rather than blanking the whole panel. The
  // journal (the fourth Step-12 read) is refreshed separately via loadJournal.
  async function loadRewards(): Promise<void> {
    const reads = await api.loadRewards(callOptions);
    const errors = [
      reads.errors.cash ? `wallet: ${reads.errors.cash}` : null,
      reads.errors.lp ? `LP: ${reads.errors.lp}` : null,
      reads.errors.standings ? `standings: ${reads.errors.standings}` : null,
    ].filter((entry): entry is string => entry !== null);
    store.apply({
      type: "rewards/loaded",
      cashBalance: decodeCashBalance(reads.cash),
      lpBalances: decodeLpBalances(reads.lp),
      standings: decodeCharStandings(reads.standings),
      error: errors.length ? errors.join("; ") : null,
    });
  }

  // R7 — read a chat channel's roster + backlog and push it to the store. The
  // panel polls this while open (READ is a backlog poll). A lost session unwinds
  // to offline; any other failure surfaces through the chat slice so the panel
  // stays put and shows the reason.
  async function loadChat(channel: ChatChannel): Promise<void> {
    try {
      const raw = await api.readChat(channel, callOptions);
      store.apply({
        type: "chat/loaded",
        channel: decodeChatChannelName(raw, channel),
        channelState: decodeChatChannel(raw),
      });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "chat/error", message: readErrorReason(error) });
    }
  }

  async function sendChatMessage(channel: ChatChannel, message: string): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    try {
      await api.sendChat(channel, trimmed, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "chat/error", message: readErrorReason(error) });
      return;
    }
    // Reflect the sent message immediately by re-reading the channel backlog
    // (loadChat clears the error on success).
    await loadChat(channel);
  }

  // Load the docked station's agent roster (agentMgr.GetAgents, filtered to the
  // held session's station by the BFF). Standalone so both the tab (onMount /
  // Refresh) and the R6b docked-station-change refresh can call it.
  async function loadAgents(): Promise<void> {
    await runAgentAction(async () => {
      const list = await api.loadAgents(callOptions);
      store.apply({ type: "agents/list", stationID: list.stationID, agents: list.agents });
    });
  }

  // Run an agent read/action, unwinding to offline on a lost session and
  // surfacing any other failure through the store (the page stays put and shows
  // the reason) rather than throwing into the UI handler.
  async function runAgentAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      store.apply({ type: "agents/action-error", message: null });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "agents/action-error", message: readErrorReason(error) });
    }
  }

  // --- R5a Flight (manually-stepped space movement) ------------------------

  // A movement refusal (CALL_REFUSED, 409) carries the handler's OWN
  // user-facing text as the message (scrambled, invalid target,
  // docking-approach, lost control, ship destroyed). Surface it so the operator
  // sees the real reason, not just the code — "pause on unsafe" must show why.
  function flightErrorReason(error: unknown): string {
    if (error instanceof BridgeCallError) {
      return error.message && error.message !== error.code
        ? `${error.code}: ${error.message}`
        : error.code;
    }
    return readErrorReason(error);
  }

  // --- R6b docked-station-change refresh -----------------------------------

  // Re-run the station-scoped reads for a newly-docked station. The Station
  // panel identity is re-pointed immediately (so the header/finder-origin track
  // the new station before the async reads land), then the docked reads refresh:
  // the station panel always (it IS the docked context), and agents/inventory
  // only if their tab has already loaded (an unopened tab re-fetches on open via
  // its own onMount). A lost session inside any read unwinds to character select
  // (rethrown); any other per-read failure rides that read's own slice.
  async function relocateStationContext(
    stationID: number,
    solarSystemID: number | null,
  ): Promise<void> {
    let station: StationStatic | null = null;
    try {
      station = await api.loadStationStatic(stationID, callOptions);
    } catch {
      // Static identity is a display nicety; fall back to ID-only rather than
      // fail the whole relocate if the read hiccups.
      station = null;
    }
    store.apply({ type: "station/relocated", stationID, solarSystemID, station });

    await refreshStationPanel();
    if (store.agents.get().loaded) {
      await loadAgents();
    }
    if (store.inventory.get().loaded) {
      try {
        await loadInventory();
      } catch (error) {
        if (isSessionLost(error)) {
          throw error;
        }
        store.apply({ type: "inventory/action-error", message: readErrorReason(error) });
      }
    }
  }

  // Observe a flight-status snapshot: when it reveals the character docked at a
  // station DIFFERENT from the one the panels are synced to, refresh the
  // station-scoped context (autopilot arrival, manual dock). Guarded so the
  // autopilot loop's per-tick reads relocate exactly once per change, and so an
  // in-flight relocate is never re-entered. Never rejects: a lost session has
  // already flipped the store offline inside the reads, so the swallowed
  // rejection is safe to `void` from an autopilot tick or to await from a step.
  async function syncDockedStation(status: FlightStatus): Promise<void> {
    // Only a docked, online character has a station context to reconcile; skip
    // otherwise (in space, or a flight read taken before a character is online).
    if (store.station.get().online === null) {
      return;
    }
    const stationID = status.docked ? status.stationID : null;
    if (stationID === null || stationID === syncedStationID || relocating) {
      return;
    }
    syncedStationID = stationID;
    relocating = true;
    try {
      await relocateStationContext(stationID, status.solarSystemID);
    } catch {
      // Session-loss already unwound to offline; nothing more to do here.
    } finally {
      relocating = false;
    }
  }

  // R7a — resolve location IDs to names for the Flight readout, cached so the
  // status doesn't refetch every poll. The cache holds a resolved name, or null
  // for a definitive static "unknown" (e.g. a player structure not in the static
  // tables) so those are not refetched either; a transient network failure is
  // NOT cached (it can retry). Names resolve through the existing read-only
  // /api/map/resolve route — no new gateway/bridge call.
  const locationNames = new Map<number, string | null>();

  async function cachedLocationName(id: number): Promise<string | null> {
    if (locationNames.has(id)) {
      return locationNames.get(id) ?? null;
    }
    let resolved: Awaited<ReturnType<typeof api.resolveDestination>>;
    try {
      resolved = await api.resolveDestination(id, callOptions);
    } catch {
      // Best-effort: leave the UI on the raw-ID fallback and allow a later retry.
      return null;
    }
    const name =
      resolved.kind === "station"
        ? resolved.stationName
        : resolved.kind === "system"
          ? resolved.systemName
          : null;
    locationNames.set(id, name);
    return name;
  }

  // Resolve the current status's system / station / structure names (from the
  // cache or a one-off static read) and push them to the flight slice, tagged
  // with the IDs they were resolved for so a stale resolve can't mislabel a newer
  // location. Fire-and-forget from observeFlightStatus (never blocks the loop).
  async function resolveFlightLocation(status: FlightStatus): Promise<void> {
    const [solarSystemName, stationName, structureName] = await Promise.all([
      status.solarSystemID !== null ? cachedLocationName(status.solarSystemID) : Promise.resolve(null),
      status.stationID !== null ? cachedLocationName(status.stationID) : Promise.resolve(null),
      status.structureID !== null ? cachedLocationName(status.structureID) : Promise.resolve(null),
    ]);
    store.apply({
      type: "flight/location",
      forSolarSystemID: status.solarSystemID,
      forStationID: status.stationID,
      forStructureID: status.structureID,
      solarSystemName,
      stationName,
      structureName,
    });
  }

  // The single choke point for a decoded flight-status snapshot: push it to the
  // flight slice, resolve its location names (cached), then reconcile the
  // docked-station context. Every flight read (manual step, autopilot tick,
  // route-origin read) flows through here. Returns the reconcile promise so a
  // manual step can await the refresh; the autopilot tick voids it (the loop must
  // not block on a panel refresh). Name resolution is always fire-and-forget.
  function observeFlightStatus(status: FlightStatus): Promise<void> {
    store.apply({ type: "flight/status", status });
    void resolveFlightLocation(status);
    return syncDockedStation(status);
  }

  // Push a step's decoded flight snapshot into the store (+ docked-context sync).
  function applyFlight(step: FlightStepResult): Promise<void> {
    return observeFlightStatus(decodeFlightStatus(step.flight));
  }

  async function loadFlightStatus(): Promise<void> {
    try {
      await applyFlight(await api.getFlightStatus(callOptions));
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
  }

  // --- R11 Space overview + ship HUD ---------------------------------------

  // Read what the ship can currently see (plus its own shield/armor/hull/cap)
  // and push it to the space slice. A failed read is surfaced as a non-fatal
  // panel error rather than thrown at the poller — except a lost session, which
  // unwinds to character select like every other held-session read.
  //
  // Docked is not an error: the gateway answers a docked session with an empty
  // overview, and the slice is cleared so the panel shows the docked message
  // instead of a stale grid.
  async function loadSpaceSnapshot(): Promise<void> {
    let result;
    try {
      result = await api.getSpaceSnapshot(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "space/error",
        message: `The view around the ship could not be read: ${flightErrorReason(error)}`,
      });
      return;
    }
    const snapshot = decodeSpaceSnapshot(result.space);
    store.apply({ type: "space/snapshot", snapshot });
    // Keep the flight readout honest too: a snapshot that says the ship is no
    // longer in space means the poll is about to stop, and the panel should not
    // keep showing the last grid it saw.
    if (!snapshot.inSpace) {
      store.apply({ type: "space/cleared" });
    }
  }

  // The ~1s overview poll. It runs only while the panel is open AND the ship is
  // in space, and it skips a beat rather than queueing when a read is slow, so
  // it never piles work behind the autopilot's own flight-status cadence.
  let spacePanelOpen = false;
  const spacePoller: SpacePoller = createSpacePoller({
    refresh: () => loadSpaceSnapshot(),
    shouldPoll: () => {
      if (!spacePanelOpen) {
        return false;
      }
      const flight = store.flight.get().status;
      const space = store.space.get().snapshot;
      // Trust either source: the flight slice is authoritative for in-space, and
      // a fresh snapshot that says "not in space" stops the poll immediately.
      if (space && !space.inSpace) {
        return false;
      }
      return flight === null || flight.inSpace;
    },
  });
  const startSpacePolling = (): void => {
    spacePanelOpen = true;
    spacePoller.start();
  };
  const stopSpacePolling = (): void => {
    spacePanelOpen = false;
    spacePoller.stop();
  };

  // Run one movement step, record it as the last action, and refresh the flight
  // snapshot the step returned. A lost session unwinds to the character list; a
  // movement refusal (scrambled, invalid target, docking-approach, lost control,
  // ship destroyed) is surfaced through the store as a visible reason — never a
  // silent no-op or a fake success. On refusal the flight snapshot is still
  // refreshed so the readout reflects the real (unchanged) state.
  async function runFlightStep(
    label: string,
    step: () => Promise<FlightStepResult>,
  ): Promise<void> {
    let result: FlightStepResult;
    try {
      result = await step();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "flight/action-error", message: `${label} refused: ${flightErrorReason(error)}` });
      // Re-read the true state so the page shows where the ship actually is,
      // not a stale optimistic guess (best-effort; ignore a follow-up failure).
      try {
        await applyFlight(await api.getFlightStatus(callOptions));
      } catch {
        // The refusal reason is already surfaced; a failed re-read changes nothing.
      }
      return;
    }
    store.apply({ type: "flight/action", action: label });
    // Await the docked-context reconcile so a step that changes the docked
    // station (dock) doesn't resolve before the new station's panels refresh.
    await applyFlight(result);
  }

  // --- R5b Travel (browser autopilot decide-loop) --------------------------

  // The client-side route solver's graph (fetched once, then cached) and the
  // single autopilot controller instance. The loop runs in the browser; closing
  // the tab kills this JS and the loop simply stops issuing (no "stop" sent) —
  // the ship completes its last server-side command and sits (roadmap §7).
  let routeGraph: SystemGraph | null = null;
  let autopilot: AutopilotController | null = null;

  async function loadRouteGraph(): Promise<SystemGraph> {
    if (routeGraph) {
      return routeGraph;
    }
    const data = await api.loadSystemGraph(callOptions);
    routeGraph = buildSystemGraph(data);
    return routeGraph;
  }

  // Wire the framework-agnostic controller to the BFF calls and the store. The
  // loop reads flight-status each cycle (pushed to the flight slice too, so the
  // Flight readout stays in sync) and pushes its progress into the travel slice.
  function makeAutopilotDeps(): AutopilotDeps {
    return {
      getStatus: async () => {
        const step = await api.getFlightStatus(callOptions);
        const status = decodeFlightStatus(step.flight);
        // Reconcile the docked station in the background — the tick must not
        // block on a panel refresh (the loop owns its own cadence).
        void observeFlightStatus(status);
        return status;
      },
      undock: async () => {
        await api.undock(callOptions);
      },
      warp: async (destinationID) => {
        await api.warpTo(destinationID, callOptions);
      },
      approach: async (destinationID) => {
        await api.approach(destinationID, callOptions);
      },
      jump: async (fromGateID, toGateID) => {
        await api.jump(fromGateID, toGateID, callOptions);
      },
      dock: async (stationID) => {
        await api.dock(stationID, callOptions);
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      onProgress: (progress) => {
        const nameFor = (systemID: number | null): string | null =>
          systemID !== null && routeGraph ? routeGraph.systemName(systemID) : null;
        store.apply({
          type: "travel/progress",
          status: progress.status,
          action: progress.action,
          phase: progress.phase,
          currentSystemID: progress.currentSystemID,
          currentSystemName: nameFor(progress.currentSystemID),
          nextSystemID: progress.nextSystemID,
          nextSystemName: nameFor(progress.nextSystemID),
          remainingJumps: progress.remainingJumps,
          totalJumps: progress.totalJumps,
          failureReason: progress.failureReason,
        });
        // A lost session inside the loop unwinds to character select, like every
        // other held-session flow (R3-R5a).
        if (progress.status === "error") {
          stopLiveStream();
        store.apply({ type: "character/offline" });
        }
      },
      isSessionLost,
      refusalReason: (error) => flightErrorReason(error),
    };
  }

  async function startRoute(destinationID: number): Promise<void> {
    store.apply({ type: "travel/plan-error", message: null });

    // 1. The client-side route graph (retail's clientPathfinderService is local;
    //    this is read-only static reference data, not a gateway/route call).
    let graph: SystemGraph;
    try {
      graph = await loadRouteGraph();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "travel/plan-error", message: `Could not load the map graph: ${readErrorReason(error)}` });
      return;
    }

    // 2. The current location is the route origin (also validates the session).
    let originSystem: number | null;
    try {
      const step = await api.getFlightStatus(callOptions);
      const status = decodeFlightStatus(step.flight);
      void observeFlightStatus(status);
      originSystem = status.solarSystemID;
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "travel/plan-error", message: `Could not read your location: ${readErrorReason(error)}` });
      return;
    }
    if (originSystem === null) {
      store.apply({ type: "travel/plan-error", message: "Your current solar system is unknown." });
      return;
    }

    // 3. Resolve the destination (a courier destination is a station; the solver
    //    routes systems) from static reference data.
    let destination: Awaited<ReturnType<typeof api.resolveDestination>>;
    try {
      destination = await api.resolveDestination(destinationID, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "travel/plan-error", message: `Could not resolve the destination: ${readErrorReason(error)}` });
      return;
    }
    if (destination.kind === "unknown" || destination.solarSystemID === null) {
      store.apply({ type: "travel/plan-error", message: `Unknown destination ${destinationID}.` });
      return;
    }

    // 4. Solve the route (fewest jumps).
    const route = solveRoute(graph, originSystem, destination.solarSystemID);
    if (!route.reachable) {
      store.apply({
        type: "travel/plan-error",
        message: `No gate route from ${graph.systemName(originSystem) ?? originSystem} to ${destination.systemName ?? destination.solarSystemID}.`,
      });
      return;
    }

    const destinationStationID = destination.kind === "station" ? destination.stationID : null;
    const destinationName = destination.kind === "station" ? destination.stationName : destination.systemName;
    const plan: RoutePlan = {
      destinationSystemID: destination.solarSystemID,
      destinationStationID,
      destinationName,
      hops: route.hops,
    };

    store.apply({
      type: "travel/planned",
      destinationSystemID: destination.solarSystemID,
      destinationStationID,
      destinationName,
      route: route.hops.map((hop) => ({
        fromSystemID: hop.fromSystemID,
        toSystemID: hop.toSystemID,
        gateToWarpID: hop.gateToWarpID,
        jumpToGateID: hop.jumpToGateID,
        fromSystemName: graph.systemName(hop.fromSystemID),
        toSystemName: graph.systemName(hop.toSystemID),
      })),
      totalJumps: route.hops.length,
      startedAt: Date.now(),
    });

    // 5. Run the decide-loop in the browser.
    if (!autopilot) {
      autopilot = createAutopilot(makeAutopilotDeps());
    }
    autopilot.start(plan);
    void autopilot.run();
  }

  // R7a — search the static map by name so a player can set a destination
  // without knowing EVE IDs. The static /api/map/find read (login-gated, no
  // bridge session) returns systems + stations; we annotate each with jumps from
  // the current system using the same single BFS the Agent Finder uses (the map
  // graph is already the route solver's, loaded once). Jumps are best-effort:
  // if the origin is unknown or the graph can't load, the row simply has no
  // distance. A hard read failure throws so the caller can surface it.
  async function searchDestinations(
    query: string,
    kind: "system" | "station" | null = null,
  ): Promise<DestinationMatch[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return [];
    }
    const result = await api.findMapLocations(trimmed, kind, callOptions);

    // The origin is the live location if known (in space or docked), else the
    // docked character's system. Distances come from ONE BFS over the map graph.
    const origin =
      store.flight.get().status?.solarSystemID ??
      store.station.get().online?.solarSystemID ??
      null;
    let distances: Map<number, number> | null = null;
    if (origin !== null) {
      try {
        distances = distancesFrom(await loadRouteGraph(), origin);
      } catch {
        distances = null;
      }
    }

    return result.matches.map((match) => ({
      ...match,
      jumps:
        distances !== null && match.solarSystemID !== null
          ? distances.get(match.solarSystemID) ?? null
          : null,
    }));
  }

  // --- R7c Names everywhere (batch name cache) -----------------------------

  // The generalized R7a location-name cache: every tab asks for names by
  // (kind, id) and this cache resolves them in ONE batched /api/names round-trip
  // per microtask, caches each outcome (a name, or null for a definitive
  // "unknown" so it never refetches), and pushes them into the store's `names`
  // slice for pure-reader components. A transient network failure is NOT cached
  // (the pending marks are released so a later request retries). Fire-and-forget:
  // requestNames never throws and never blocks a UI interaction — the component
  // shows the raw ID until the name lands. Chunked to the route's server-side cap
  // so a large list is never silently truncated.
  const NAMES_REQUEST_CAP = 500;
  const nameCache = new Map<string, string | null>();
  const namePending = new Set<string>();
  let nameQueue: NameRef[] = [];
  let nameFlushScheduled = false;

  async function flushNameQueue(): Promise<void> {
    nameFlushScheduled = false;
    const batch = nameQueue;
    nameQueue = [];
    for (let start = 0; start < batch.length; start += NAMES_REQUEST_CAP) {
      const chunk = batch.slice(start, start + NAMES_REQUEST_CAP);
      let result: Awaited<ReturnType<typeof api.resolveNames>>;
      try {
        result = await api.resolveNames(chunk, callOptions);
      } catch {
        // Best-effort: release the pending marks so these refs can be retried
        // by a later requestNames (a transient failure must not cache "unknown").
        for (const ref of chunk) {
          namePending.delete(nameKey(ref.kind, ref.id));
        }
        continue;
      }
      const entries: Record<string, string | null> = {};
      for (const ref of chunk) {
        const key = nameKey(ref.kind, ref.id);
        const name = key in result.names ? result.names[key] : null;
        nameCache.set(key, name ?? null);
        namePending.delete(key);
        entries[key] = name ?? null;
      }
      store.apply({ type: "names/resolved", entries });
    }
  }

  function requestNames(refs: readonly NameRef[]): void {
    let queued = false;
    for (const ref of refs) {
      const id = ref.id;
      if (!Number.isSafeInteger(id) || id <= 0) {
        continue;
      }
      const key = nameKey(ref.kind, id);
      if (nameCache.has(key) || namePending.has(key)) {
        continue;
      }
      namePending.add(key);
      nameQueue.push({ kind: ref.kind, id });
      queued = true;
    }
    if (queued && !nameFlushScheduled) {
      nameFlushScheduled = true;
      queueMicrotask(() => {
        void flushNameQueue();
      });
    }
  }

  // --- R6a Agent Finder ----------------------------------------------------

  // The finder pulls a bounded set from the static reference table and sorts it
  // by jumps from the current system. We request a limit that fully covers a
  // single mission-kind level (the largest, courier L1, is ~1531) so choosing a
  // level yields the complete, correctly-nearest-sorted set; the browser then
  // renders only a capped page. Bounded well under the ~11k-agent dataset.
  const FINDER_REQUEST_LIMIT = 2000;

  // Nearest-first; unreachable / unknown-origin agents (jumps === null) sort
  // last, then by level, then by name for a stable order.
  function compareFinderRows(a: AgentFinderRow, b: AgentFinderRow): number {
    if (a.jumps !== b.jumps) {
      if (a.jumps === null) {
        return 1;
      }
      if (b.jumps === null) {
        return -1;
      }
      return a.jumps - b.jumps;
    }
    if ((a.level ?? 0) !== (b.level ?? 0)) {
      return (a.level ?? 0) - (b.level ?? 0);
    }
    return a.name.localeCompare(b.name);
  }

  async function findAgents(
    filters: { kind?: string; level?: number | null; limit?: number } = {},
  ): Promise<void> {
    const kind = filters.kind ?? "courier";
    const level = filters.level ?? null;

    let result: Awaited<ReturnType<typeof api.findAgents>>;
    try {
      result = await api.findAgents(
        { kind, level, limit: filters.limit ?? FINDER_REQUEST_LIMIT },
        callOptions,
      );
    } catch (error) {
      // The finder reads static reference data (web-login only, no bridge
      // session), so a failure is a plain read error surfaced in the slice.
      store.apply({ type: "finder/error", message: `Could not find agents: ${readErrorReason(error)}` });
      return;
    }

    // The player's current system is the docked character's system (the finder
    // is a docked-station tool). Distances come from ONE BFS over the map graph
    // (client-side, like the route solver) — never a solveRoute per agent.
    const origin = store.station.get().online?.solarSystemID ?? null;
    let distances: Map<number, number> | null = null;
    let distanceNote: string | null = null;
    if (origin !== null) {
      try {
        distances = distancesFrom(await loadRouteGraph(), origin);
      } catch (error) {
        // The map graph is the same read-only static data the route solver
        // uses; if it can't load, still list the agents (jumps null) and note
        // why rather than failing the whole find.
        distanceNote = `Agents listed without distances (map graph unavailable: ${readErrorReason(error)}).`;
      }
    }

    const rows: AgentFinderRow[] = result.agents
      .map((agent) => ({
        ...agent,
        jumps:
          distances !== null && agent.solarSystemID !== null
            ? distances.get(agent.solarSystemID) ?? null
            : null,
      }))
      .sort(compareFinderRows);

    store.apply({
      type: "finder/results",
      kind: result.kind,
      level: result.level,
      originSystemID: origin,
      agents: rows,
      total: result.total,
      capped: result.capped,
    });
    // finder/results clears the error; re-apply the soft distance note after it
    // so it survives (a hard find error already returned above).
    if (distanceNote) {
      store.apply({ type: "finder/error", message: distanceNote });
    }
  }

  async function setDestinationToAgent(agentID: number): Promise<void> {
    const agent = store.finder.get().agents.find((row) => row.agentID === agentID);
    if (!agent) {
      store.apply({ type: "finder/error", message: `Agent ${agentID} is not in the current results.` });
      return;
    }
    if (agent.stationID === null) {
      store.apply({ type: "finder/error", message: `Agent ${agent.name} has no station to route to.` });
      return;
    }
    // Record who we're flying to (the panel shows the target), then reuse the
    // R5b route solver + browser autopilot via startRoute(agent.stationID).
    store.apply({
      type: "finder/target",
      target: {
        agentID: agent.agentID,
        name: agent.name,
        level: agent.level,
        stationID: agent.stationID,
        stationName: agent.stationName,
        solarSystemID: agent.solarSystemID,
        solarSystemName: agent.solarSystemName,
        jumps: agent.jumps,
      },
    });
    await startRoute(agent.stationID);
  }

  return {
    async login(username, password) {
      const result = await api.login(username, password, callOptions);
      store.apply({
        type: "session/logged-in",
        accountID: result.accountID,
        username: result.username,
      });
      // The character list comes from the typed retail reference call, not a
      // bespoke projection (charUnboundMgr.GetCharacterSelectionData).
      const selection = await getCharacterSelectionData(callOptions);
      store.apply({ type: "character/list", characters: selection.characters });
    },

    async selectCharacter(characterID) {
      store.apply({ type: "character/selected", characterID });
      const result = await api.selectCharacter(characterID, callOptions);
      store.apply({
        type: "character/online",
        character: result.character,
        station: result.station,
      });
      // Anchor the docked-station sync to where select landed so the first
      // flight read at this station doesn't trigger a redundant relocate; a
      // later dock elsewhere on this session will.
      syncedStationID = result.character.stationID;
      // R10: the session is live, so open the push channel before the docked
      // reads — anything the reads trigger is then already being observed.
      startLiveStream();
      await refreshStationPanel();
    },

    refreshStationPanel,

    loadInventory,

    async moveItem(itemID, direction, qty = null) {
      await runMutation(() => api.moveItem(itemID, direction, qty ?? null, callOptions));
    },

    async stackContainer(target) {
      await runMutation(() => api.stackItems(target, callOptions));
    },

    async boardShip(shipID) {
      await runMutation(() => api.boardShip(shipID, callOptions));
    },

    loadAgents,

    async openConversation(agentID) {
      await runAgentAction(async () => {
        const result = await api.agentAction(agentID, null, callOptions);
        store.apply({
          type: "agents/conversation",
          agentID,
          conversation: decodeConversation(result),
        });
        // Opening a conversation clears any stale briefing from a prior agent.
        store.apply({ type: "agents/briefing", briefing: null });
      });
    },

    async chooseAction(agentID, action) {
      await runAgentAction(async () => {
        const result = await api.agentAction(agentID, action.actionID, callOptions);
        store.apply({
          type: "agents/conversation",
          agentID,
          conversation: decodeConversation(result),
        });
        // Accepting a courier stages the mission: pull its briefing + journal
        // entry. Completing it pays out: clear the briefing and pull the Step-12
        // reward reads (wallet / LP / standings) alongside the journal.
        // Declining clears the briefing; the journal always refreshes so the
        // offered/accepted/cleared state stays truthful.
        if (action.buttonType === AGENT_BUTTON.ACCEPT || action.buttonType === AGENT_BUTTON.ACCEPT_REMOTELY) {
          await loadBriefing(agentID);
        } else if (
          action.buttonType === AGENT_BUTTON.COMPLETE ||
          action.buttonType === AGENT_BUTTON.COMPLETE_REMOTELY
        ) {
          store.apply({ type: "agents/briefing", briefing: null });
          await loadRewards();
        } else if (action.buttonType === AGENT_BUTTON.DECLINE) {
          store.apply({ type: "agents/briefing", briefing: null });
        }
        await loadJournal();
      });
    },

    loadBriefing,

    loadJournal,

    loadRewards,

    async loadPackageIntoShip(cargoTypeID) {
      await runAgentAction(async () => {
        // Find the accepted courier's package in the station hangar (the stack
        // whose type matches the briefing cargo) and move it into the active
        // ship via the R3 inventory move. The BFF addresses the item by game ID.
        const panel = await api.loadInventory(callOptions);
        const item = decodeInventoryRows(panel.hangar.list).find(
          (row) => row.typeID === cargoTypeID,
        );
        if (!item) {
          // runAgentAction's success path clears the action-error, so signal the
          // miss by throwing — its catch surfaces the reason through the store.
          throw new Error(
            `The mission package (type ${cargoTypeID}) is not in the station hangar.`,
          );
        }
        await api.moveItem(item.itemID, "toCargo", null, callOptions);
      });
    },

    async setAutopilotToDropoff(dropoffStationID) {
      // Reuse the R5b route solver + browser autopilot: startRoute resolves the
      // dropoff station -> its solar system and runs the decide-loop.
      await startRoute(dropoffStationID);
    },

    loadFlightStatus,

    async undock() {
      await runFlightStep("Undock", () => api.undock(callOptions));
    },

    async warpTo(destinationID) {
      await runFlightStep("Warp", () => api.warpTo(destinationID, callOptions));
    },

    async approach(destinationID) {
      await runFlightStep("Approach", () => api.approach(destinationID, callOptions));
    },

    loadSpaceSnapshot,

    startSpacePolling,

    stopSpacePolling,

    async jump(fromGateID, toGateID) {
      await runFlightStep("Jump", () => api.jump(fromGateID, toGateID, callOptions));
    },

    async dock(stationID) {
      await runFlightStep("Dock", () => api.dock(stationID, callOptions));
    },

    findAgents,

    setDestinationToAgent,

    startRoute,

    searchDestinations,

    pauseRoute() {
      autopilot?.pause();
    },

    resumeRoute() {
      if (autopilot) {
        autopilot.resume();
        void autopilot.run();
      }
    },

    abortRoute() {
      autopilot?.abort();
    },

    loadChat,

    sendChatMessage,

    setChatChannel(channel) {
      store.apply({ type: "chat/active", channel });
    },

    requestNames,

    async releaseSession() {
      // R10: stop consuming the push channel first — the session it belongs to
      // is about to end.
      stopLiveStream();
      try {
        await api.releaseSession(callOptions);
      } finally {
        syncedStationID = null;
        stopLiveStream();
        store.apply({ type: "character/offline" });
        store.apply({ type: "character/selected", characterID: null });
      }
    },

    async logout() {
      stopLiveStream();
      try {
        await api.logout(callOptions);
      } finally {
        syncedStationID = null;
        store.apply({ type: "session/logged-out" });
      }
    },
  };
}
