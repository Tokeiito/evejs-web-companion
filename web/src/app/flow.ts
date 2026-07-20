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
import { decodeCapacity, decodeContainer, decodeInventoryRows } from "../bridge/inventoryShip.ts";
import { buildSlots, decodeResources, decodeShipAttributes } from "../bridge/fitting.ts";
import { deriveShipStats } from "../bridge/shipStats.ts";
import {
  decodeBlueprints,
  decodeDefinition,
  decodeFacilities,
  decodeJobs,
  decodeSlotUsage,
  industryRefusalMessage,
} from "../bridge/industry.ts";
import {
  decodeEscrow,
  decodeOrderBook,
  decodeOwnOrders,
  decodePriceHistory,
  decodeTransactions,
  marketRefusalMessage,
  toAmountString,
} from "../bridge/market.ts";
import { decodeMailbox, mailRefusalMessage } from "../bridge/mail.ts";
import {
  contractRefusalMessage,
  decodeContractDetail,
  decodeContractList,
  decodeContractSearch,
  decodeContractSummary,
} from "../bridge/contracts.ts";
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
import { decodeSpaceSnapshot, decodeTargetIDs } from "../bridge/space.ts";
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
  InventoryPlace,
  SlotFamily,
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

/**
 * What the panel asks for when it places an order. `side` decides which retail
 * call is used, and they are NOT symmetric: buying names a TYPE, selling names
 * a specific STACK (`itemID`), because the sell handler moves that stack into
 * escrow.
 */
export interface MarketOrderRequest {
  readonly side: "buy" | "sell";
  readonly typeID: number;
  readonly price: number;
  readonly quantity: number;
  readonly durationDays: number;
  /** Required for a sell: the stack being handed over. */
  readonly itemID?: number;
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
  // --- R14 inventory depth ---
  /** Tick or untick a row for a bulk move / trash. */
  toggleSelection(itemID: number): void;
  /** Drop every tick (e.g. after acting, or on leaving a place). */
  clearSelection(): void;
  /** Open a container and read its contents; null closes it. */
  openContainer(containerID: number | null): Promise<void>;
  /**
   * Move items between two places. A single item with a `qty` is a SPLIT; more
   * than one item is a single batch move. Reports what ACTUALLY applied.
   */
  transferItems(
    itemIDs: readonly number[],
    from: InventoryPlace,
    to: InventoryPlace,
    qty?: number | null,
  ): Promise<void>;
  /** Re-merge one stack into another of the same type. */
  mergeStacks(
    sourceItemID: number,
    destinationItemID: number,
    place: InventoryPlace,
  ): Promise<void>;
  /** DESTROY items. The caller must have confirmed first — this is irreversible. */
  trashItems(itemIDs: readonly number[], place: InventoryPlace): Promise<void>;
  /** Read the corporation hangar at the docked station. */
  loadCorpHangar(): Promise<void>;
  /** Show a different corporation hangar division. */
  selectCorpDivision(division: number): void;
  /** Load the Fitting panel (the active ship's slots + resource readings). */
  loadFitting(): Promise<void>;
  /**
   * Fit a module from the station hangar or the ship's cargo. `slot` picks a
   * specific slot by family + index, or "auto" to let the SERVER choose one.
   */
  fitModule(
    itemID: number,
    source: "hangar" | "cargo",
    slot: { readonly family: SlotFamily; readonly index: number } | "auto",
  ): Promise<void>;
  /** Unfit a module back to the station hangar or the ship's cargo. */
  unfitModule(itemID: number, destination: "hangar" | "cargo"): Promise<void>;
  /** Bring a fitted module online, or take it offline. */
  setModuleOnline(itemID: number, online: boolean): Promise<void>;
  /**
   * DESTROY a fitted rig. Rigs cannot be unfitted, so this is irreversible —
   * the panel confirms before calling it and the BFF confirms again.
   */
  destroyRig(itemID: number): Promise<void>;
  /**
   * Load the Industry panel: the player's blueprints, their jobs, their used
   * job slots, and the facilities their region offers. Also fetches the static
   * recipes for the blueprint types it saw, and the names for everything.
   */
  loadIndustry(): Promise<void>;
  /**
   * What the player HAS of each material an install would consume, read from
   * the SERVER. Feeds the confirm step so the decision is informed.
   */
  previewIndustryJob(request: api.IndustryJobRequest): Promise<Readonly<Record<string, number>>>;
  /**
   * INSTALL a job. Spends materials and charges an installation fee, so the
   * panel confirms before calling it and the BFF confirms again.
   */
  installIndustryJob(request: api.IndustryJobRequest): Promise<void>;
  /** DELIVER a finished job (the retail CompleteJob). */
  deliverIndustryJob(jobID: number): Promise<void>;
  /**
   * CANCEL a job. Returns the blueprint but NOT the materials or the fee, so
   * this is confirmed twice as well.
   */
  cancelIndustryJob(jobID: number): Promise<void>;
  /**
   * Load the Market panel: an item's order book (when one is chosen), the
   * player's own orders, their closed-order history, their trades, their
   * escrow, their price history and their ISK — plus every NAME those need.
   */
  loadMarket(typeID: number | null): Promise<void>;
  /**
   * Search tradable items by NAME — how the player picks what to look at.
   * Static reference data, so it answers even when the market daemon does not.
   */
  findMarketTypes(q: string): Promise<readonly api.MarketTypeMatch[]>;
  /**
   * PLACE A BUY ORDER. Sets ISK aside immediately and charges a broker's fee,
   * so the panel confirms before calling it and the BFF confirms again. What
   * the server ACTUALLY charged lands in the store as `lastOutcome`.
   */
  placeMarketOrder(request: MarketOrderRequest): Promise<void>;
  /** CANCEL an order. Returns what it held; the fee already paid is not. */
  cancelMarketOrder(orderID: string): Promise<void>;
  /** CHANGE an order's price. Charges a fee and moves a buy order's escrow. */
  modifyMarketOrder(orderID: string, price: number): Promise<void>;
  /**
   * Load the Mail panel: the whole inbox, plus the NAME of everyone who sent or
   * received a message. ⚠ The inbox is a DELTA SYNC the BFF cold-starts, so
   * this is always the entire mailbox rather than a page of it.
   */
  loadMail(): Promise<void>;
  /**
   * Open one message. ⚠ The body arrives as plain TEXT — mailMgr.GetBody
   * answers a zlib-DEFLATED buffer and the BFF inflates it. `markRead` makes
   * this a WRITE, and whether the flag really moved is RE-READ afterwards.
   */
  openMail(messageID: number, markRead: boolean): Promise<void>;
  /** Close the open message without touching the server. */
  closeMail(): void;
  /**
   * Find someone to write to, by NAME. Static reference data; the id it
   * carries is never shown to the player (R7d).
   */
  findCharacters(q: string): Promise<readonly api.CharacterMatch[]>;
  /**
   * SEND a message. Not a costly or destructive write, so no confirm gate —
   * but an empty recipient list is refused, because the SERVER will not refuse
   * it and mail addressed to nobody would look sent.
   */
  sendMail(request: api.MailSendRequest): Promise<void>;
  /**
   * Load the Contracts panel: the public courier browse, the player's own
   * contracts (waiting / taken on / expired), the summary counts, and every
   * NAME those need. READS ONLY — every contract mutator is refused at the
   * gateway.
   *
   * ⚠ An empty public browse is EXPECTED: EveJS has no contract generator, so
   * there is nothing to find until a player creates one.
   */
  loadContracts(page: number): Promise<void>;
  /** Open one contract in full: its items and its route endpoints, by name. */
  openContract(contractID: number): Promise<void>;
  /** Close the open contract without touching the server. */
  closeContract(): void;
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
  /**
   * Warp to a chosen gate/celestial through the bound park. `minRange` null is
   * the autopilot warp; a number warps to that distance from the target (R13).
   */
  warpTo(destinationID: number, minRange?: number | null): Promise<void>;
  /**
   * R11 — approach an object at full speed (the same atomic move the autopilot
   * uses to close the last gap to a gate). Offered on every overview row.
   * R13 — the range is retail's: 50 m from the menu, 0 from the autopilot.
   */
  approach(destinationID: number, range?: number | null): Promise<void>;
  /** R13 — hold a set distance from a target (CmdFollowBall at that range). */
  keepAtRange(targetID: number, range?: number | null): Promise<void>;
  /** R13 — circle a target at a set distance (CmdOrbit). */
  orbit(targetID: number, range?: number | null): Promise<void>;
  /** R13 — point the ship at a target and hold that heading (CmdAlignTo). */
  alignTo(targetID: number): Promise<void>;
  /**
   * R13 — cut the engines (CmdStop). As in retail, this also switches the
   * autopilot off: stopping the ship must not leave something still flying it.
   */
  stopShip(): Promise<void>;
  /** R11 — read what is currently around the ship (and the ship's condition). */
  loadSpaceSnapshot(): Promise<void>;
  /**
   * R11 — start/stop the ~1s overview poll. The Overview panel starts it when it
   * mounts and stops it when it unmounts; it also stops itself as soon as the
   * ship is no longer in space (docked).
   */
  startSpacePolling(): void;
  stopSpacePolling(): void;
  // --- R23 slice A: the GENERIC in-space action layer --------------------
  // Deliberately free of any notion of mining or combat. A target is a target;
  // a module is a module; the effect name is an OPTIONAL argument (omit it and
  // the server resolves the module's own default activation effect from its
  // typeID — the browser never guesses which effect a module runs). A later
  // combat goal reuses all five of these unchanged.
  /** R23 — read the locked-target list (the only authority on what is locked). */
  loadTargets(): Promise<void>;
  /** R23 — lock a ball. Acquisition takes time; the lock is not instant. */
  lockTarget(targetID: number): Promise<void>;
  /** R23 — release ONE lock (or abandon one still being acquired). */
  unlockTarget(targetID: number): Promise<void>;
  /** R23 — switch a module on. `repeat` is -1 continuous (default) or 0 single-cycle. */
  activateModule(
    itemID: number,
    opts?: { effect?: string; targetID?: number | null; repeat?: -1 | 0 },
  ): Promise<void>;
  /** R23 — switch a module off. */
  deactivateModule(itemID: number, opts?: { effect?: string }): Promise<void>;
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

  // --- R14 Inventory depth + corporation hangars ---------------------------

  /**
   * The reason a mutation was refused, keeping the SERVER's own words.
   *
   * The shared readErrorReason() reduces a typed refusal to its code, which is
   * right for panels whose failures are transport-shaped. R14's are not: a corp
   * hangar refusal is the invbroker handler's own sentence ("You do not have
   * the required roles"), and the goal is to surface that verbatim rather than
   * make the player decode CALL_REFUSED. The code is kept as a prefix so the
   * machine-readable part is not lost either.
   */
  function readRefusalReason(error: unknown): string {
    if (error instanceof BridgeCallError) {
      const detail = error.message.trim();
      return detail === "" || detail === error.code ? error.code : `${error.code}: ${detail}`;
    }
    return readErrorReason(error);
  }

  // Turn a transfer result into one honest sentence. A split is judged by the
  // source stack shrinking (it mints a NEW stack at the destination, so the
  // requested itemID never appears there), and a decline with no reason is
  // reported AS a decline with no reason.
  function describeTransfer(
    result: { applied: boolean; moved: readonly number[]; declined: readonly number[] },
    requested: number,
    qty: number | null,
  ): string {
    if (result.applied && qty !== null) {
      return `Split ${qty} off the stack.`;
    }
    if (result.applied && result.declined.length === 0) {
      return `Moved ${result.moved.length} of ${requested}.`;
    }
    if (result.applied) {
      return `Moved ${result.moved.length} of ${requested}; the server declined the rest without giving a reason.`;
    }
    return "The server did not move anything, and gave no reason.";
  }

  // Reload whatever places are currently on screen. A mutation can touch the
  // hangar, the open container and a corp division at once (a move out of a
  // container into a division touches all three), so after any action every
  // open view is re-read rather than guessing which one changed.
  async function refreshOpenPlaces(): Promise<void> {
    const current = store.get().inventory;
    await loadInventory();
    if (current.container) {
      await openContainer(current.container.itemID);
    }
    if (current.corp.loaded) {
      await loadCorpHangar();
    }
  }

  // Run a mutation and report what the SERVER says actually happened. The BFF
  // re-reads after every call because invbroker declines silently, so `applied`
  // here is a real observation, not an echo of the request.
  async function runInventoryAction(
    action: () => Promise<{ applied: boolean; declinedSilently: boolean; message: string }>,
  ): Promise<void> {
    store.apply({ type: "inventory/outcome", outcome: null });
    let outcome: { applied: boolean; declinedSilently: boolean; message: string };
    try {
      outcome = await action();
      store.apply({ type: "inventory/action-error", message: null });
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      // A typed refusal carries the HANDLER's own reason; it is surfaced
      // verbatim rather than reworded.
      store.apply({ type: "inventory/action-error", message: readRefusalReason(error) });
      return;
    }
    store.apply({ type: "inventory/outcome", outcome });
    store.apply({ type: "inventory/selection", itemIDs: [] });
    await refreshOpenPlaces();
  }

  async function openContainer(containerID: number | null): Promise<void> {
    if (containerID === null) {
      store.apply({ type: "inventory/container", container: null });
      return;
    }
    // Carry the container's own typeID so the panel can name it; it is a row in
    // whichever place the player opened it from.
    const current = store.get().inventory;
    const owningRow =
      current.hangar.rows.find((row) => row.itemID === containerID) ??
      current.cargo.rows.find((row) => row.itemID === containerID) ??
      null;
    let reads: Awaited<ReturnType<typeof api.openContainer>>;
    try {
      reads = await api.openContainer(containerID, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "inventory/container",
        container: {
          itemID: containerID,
          typeID: owningRow ? owningRow.typeID : 0,
          rows: [],
          capacity: null,
          error: readErrorReason(error),
        },
      });
      return;
    }
    store.apply({
      type: "inventory/container",
      container: {
        itemID: containerID,
        typeID: owningRow
          ? owningRow.typeID
          : (store.get().inventory.container?.typeID ?? 0),
        rows: decodeInventoryRows(reads.list),
        capacity: reads.capacity === null ? null : decodeCapacity(reads.capacity),
        error: null,
      },
    });
  }

  async function loadCorpHangar(): Promise<void> {
    let reads: Awaited<ReturnType<typeof api.loadCorpHangar>>;
    try {
      reads = await api.loadCorpHangar(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "inventory/corp-loaded",
        available: false,
        reason: readErrorReason(error),
        divisions: [],
      });
      return;
    }
    store.apply({
      type: "inventory/corp-loaded",
      available: reads.available,
      reason: reads.reason,
      divisions: reads.divisions.map((division) => ({
        division: division.division,
        name: division.name,
        // A division the character cannot query answers an EMPTY list, not an
        // error — the server filtered it, and that is the authority.
        rows: division.list === null ? [] : decodeInventoryRows(division.list),
        error: division.error,
      })),
    });
  }

  // --- R12 Ship fitting ----------------------------------------------------

  // Load the Fitting panel. The slot read and the resource read are
  // INDEPENDENT on the BFF, so each keeps its own error and a failed resource
  // read still shows the fit (and vice versa). A lost session unwinds to
  // select, exactly as loadInventory does.
  async function loadFitting(): Promise<void> {
    let reads: Awaited<ReturnType<typeof api.loadFitting>>;
    try {
      reads = await api.loadFitting(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    store.apply({
      type: "fitting/loaded",
      activeShipID: reads.activeShipID,
      slots: buildSlots(reads.slots, reads.shipInfo, reads.online),
      resources: decodeResources(reads.shipInfo),
      // R21 — the derived statistics come off the SAME ShipGetInfo attribute
      // map as the resource bars. No extra read, and nothing re-simulated:
      // the server already applied the ship's active-module effects before it
      // sent this (see bridge/shipStats.ts for why that matters).
      stats: deriveShipStats(decodeShipAttributes(reads.shipInfo)),
      slotsError: reads.errors.slots || reads.errors.online,
      resourcesError: reads.errors.shipInfo,
    });
  }

  /**
   * Run a fitting action, then reload the panel so it shows SERVER truth.
   *
   * Two refusal shapes have to be handled, and they are not the same thing:
   *  - a THROWN refusal carries the handler's own reason (e.g. "You do not
   *    have enough CPU to online that module.") and is surfaced verbatim;
   *  - a SILENT decline returns success while nothing moved (invbroker's
   *    fit validation does this for a module you lack the skill for). The BFF
   *    re-reads the slots and reports `applied: false`; saying only that the
   *    server declined is honest, where naming a cause would be a guess.
   */
  async function runFittingAction(
    action: () => Promise<{ readonly applied: boolean } | void>,
  ): Promise<void> {
    let declined = false;
    try {
      const outcome = await action();
      declined = outcome !== undefined && outcome !== null && outcome.applied === false;
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "fitting/action-error", message: readErrorReason(error) });
      return;
    }
    await loadFitting();
    // loadFitting clears the action error on success, so a silent decline is
    // recorded AFTER the reload or it would be wiped by its own refresh.
    if (declined) {
      store.apply({
        type: "fitting/action-error",
        message: "The server did not apply that change, and gave no reason.",
      });
    }
  }

  // --- R15 Industry --------------------------------------------------------

  /**
   * Load the Industry panel.
   *
   * Two round-trips, and the ORDER matters: the live read has to answer first
   * because it is what names the blueprint types the static recipes are then
   * fetched for. The live read is five INDEPENDENT calls on the BFF, so a
   * player whose region answers no facilities still sees their blueprints and
   * jobs — each read keeps its own error.
   *
   * The recipe fetch is deliberately NOT awaited into the same failure path:
   * it is static reference data, so a failure there costs the install preview
   * its material list but must never blank the panel.
   */
  async function loadIndustry(): Promise<void> {
    let reads: Awaited<ReturnType<typeof api.loadIndustry>>;
    try {
      reads = await api.loadIndustry(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const blueprints = decodeBlueprints(reads.blueprints.result);
    const jobs = decodeJobs(reads.jobs.result);
    const facilities = decodeFacilities(reads.facilities.result);
    store.apply({
      type: "industry/loaded",
      ownerID: reads.ownerID,
      stationID: reads.stationID,
      solarSystemID: reads.solarSystemID,
      blueprints,
      jobs,
      facilities,
      slotsUsed: decodeSlotUsage(reads.jobCounts.result),
      blueprintsError: reads.blueprints.error,
      // The slot counts are part of the jobs picture; a failure there is a
      // jobs-side failure rather than a whole-panel one.
      jobsError: reads.jobs.error || reads.jobCounts.error,
      facilitiesError: reads.facilities.error,
    });

    // Every ID the panel will show, resolved to a NAME (R7d). A blueprint and
    // its product are ordinary types; a facility is a station in a system.
    const refs: NameRef[] = [];
    for (const blueprint of blueprints) {
      refs.push({ kind: "type", id: blueprint.typeID });
    }
    for (const job of jobs) {
      refs.push({ kind: "type", id: job.blueprintTypeID });
      refs.push({ kind: "type", id: job.productTypeID });
      refs.push({ kind: "station", id: job.facilityID });
    }
    for (const facility of facilities) {
      refs.push({ kind: "station", id: facility.facilityID });
      refs.push({ kind: "system", id: facility.solarSystemID });
    }
    requestNames(refs);

    // The static recipes for every blueprint type in view — the blueprints the
    // player holds AND the ones their running jobs are built from (a job's
    // blueprint may be locked away in the job and absent from the list).
    const typeIDs = new Set<number>();
    for (const blueprint of blueprints) {
      typeIDs.add(blueprint.typeID);
    }
    for (const job of jobs) {
      typeIDs.add(job.blueprintTypeID);
    }
    const known = store.get().industry.definitions;
    const wanted = [...typeIDs].filter((typeID) => typeID > 0 && !(typeID in known));
    if (wanted.length === 0) {
      return;
    }
    let raw: Readonly<Record<string, JsonValue>>;
    try {
      raw = await api.loadIndustryDefinitions(wanted, callOptions);
    } catch {
      // Static data only: the panel still lists everything, it just cannot
      // preview what an install would consume until a later load succeeds.
      return;
    }
    const definitions: Record<number, ReturnType<typeof decodeDefinition>> = {};
    for (const typeID of wanted) {
      // A definitive miss is cached as null so it is never refetched.
      definitions[typeID] = decodeDefinition(raw[String(typeID)]);
    }
    store.apply({ type: "industry/definitions", definitions });
  }

  /**
   * Run an industry mutation, then reload the panel so it shows SERVER truth.
   *
   * The same two refusal shapes R12 and R14 established, and they are not the
   * same thing:
   *  - a THROWN refusal carries the handler's own reason. For deliver and
   *    cancel that is prose ("That industry job is not ready yet."); for
   *    install it is a structured list of the server's OWN error names, which
   *    `industryRefusalMessage` turns into a sentence without inventing a
   *    cause the server did not give.
   *  - a SILENT decline returns success while nothing happened. The BFF
   *    re-reads the job and reports `applied: false`; saying only that the
   *    server declined is honest, where naming a cause would be a guess.
   */
  async function runIndustryAction(
    action: () => Promise<{ readonly applied: boolean }>,
  ): Promise<void> {
    let declined = false;
    try {
      const outcome = await action();
      declined = outcome.applied === false;
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "industry/action-error",
        message: industryRefusalMessage(error),
      });
      return;
    }
    await loadIndustry();
    // loadIndustry clears the action error on success, so a silent decline is
    // recorded AFTER the reload or it would be wiped by its own refresh.
    if (declined) {
      store.apply({
        type: "industry/action-error",
        message: "The server did not apply that change, and gave no reason.",
      });
    }
  }

  // --- R16 Market ----------------------------------------------------------

  /**
   * Load the Market panel.
   *
   * Seven INDEPENDENT reads on the BFF, so a public order book that fails
   * never hides the player's own orders — and the other way round. The
   * DAEMON-outage case is kept separate from an empty book on purpose: "nobody
   * is trading this" and "the market is not answering" are different facts and
   * the panel says which one happened.
   *
   * Nothing here sorts or filters: that is the client-local `marketQuote`
   * logic, applied at render time in the panel so the player can re-sort
   * without a round-trip — exactly as retail does it.
   */
  async function loadMarket(typeID: number | null): Promise<void> {
    let reads: Awaited<ReturnType<typeof api.loadMarket>>;
    try {
      reads = await api.loadMarket(typeID, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const book = decodeOrderBook(reads.book.result);
    const ownOrders = decodeOwnOrders(reads.ownOrders.result);
    const orderHistory = decodeOwnOrders(reads.orderHistory.result);
    // ⚠ The transaction decoder needs the character's OWN id: a trade row names
    // a buyer and a seller and nothing else, so which side the player was on is
    // derived by comparison, never guessed.
    const transactions = decodeTransactions(
      reads.transactions.result,
      reads.characterID ?? 0,
    );
    store.apply({
      type: "market/loaded",
      typeID: reads.typeID,
      stationID: reads.stationID,
      solarSystemID: reads.solarSystemID,
      sells: book.sells,
      buys: book.buys,
      ownOrders,
      orderHistory,
      transactions,
      escrow: reads.escrow.error ? null : decodeEscrow(reads.escrow.result),
      priceHistory: decodePriceHistory(reads.priceHistory.result),
      cashBalance: toAmountString(reads.cashBalance.result),
      bookError: reads.book.error,
      // The own-orders picture is one thing to the player, so a failure in
      // either half is an own-orders failure.
      ownOrdersError: reads.ownOrders.error || reads.orderHistory.error,
      transactionsError: reads.transactions.error,
      marketUnavailable: reads.marketUnavailable,
    });

    // Every ID the panel will show, resolved to a NAME (R7d). An order is an
    // item (a type) at a station in a system.
    const refs: NameRef[] = [];
    if (reads.typeID) {
      refs.push({ kind: "type", id: reads.typeID });
    }
    for (const row of [...book.sells, ...book.buys]) {
      refs.push({ kind: "station", id: row.stationID });
      refs.push({ kind: "system", id: row.solarSystemID });
    }
    for (const row of [...ownOrders, ...orderHistory]) {
      refs.push({ kind: "type", id: row.typeID });
      refs.push({ kind: "station", id: row.stationID });
      refs.push({ kind: "system", id: row.solarSystemID });
    }
    for (const row of transactions) {
      refs.push({ kind: "type", id: row.typeID });
      refs.push({ kind: "station", id: row.stationID });
    }
    requestNames(refs);
  }

  /**
   * Run a market write, then reload the panel so it shows SERVER truth, and
   * record what ACTUALLY happened to the money.
   *
   * Three outcomes, handled differently on purpose:
   *  - a THROWN refusal carries the handler's own reason (or a named market
   *    error), which `marketRefusalMessage` turns into a sentence without
   *    inventing a cause the server did not give;
   *  - a SILENT decline returns success while nothing moved. The BFF judged
   *    that from its RE-READ (the wallet did not change, or the order is still
   *    there at the old price), and saying only that the server declined is
   *    honest where naming a cause would be a guess;
   *  - success, in which case the amount reported is the WALLET DIFFERENCE the
   *    BFF measured — never the estimate the confirm step showed.
   */
  async function runMarketAction(
    kind: "buy" | "sell" | "cancel" | "modify",
    action: () => Promise<api.MarketChangeResult>,
  ): Promise<void> {
    let outcome: api.MarketChangeResult;
    try {
      outcome = await action();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "market/action-error", message: marketRefusalMessage(error) });
      return;
    }
    // Reload first: the panel must show the server's own picture of the
    // player's orders and ISK before it says anything about what happened.
    await loadMarket(store.get().market.typeID);
    // loadMarket clears the action error on success, so the verdict is recorded
    // AFTER the reload or its own refresh would wipe it.
    store.apply({
      type: "market/outcome",
      outcome: {
        kind,
        applied: outcome.applied,
        declinedSilently: outcome.declinedSilently,
        charged: outcome.charged,
        balanceAfter: outcome.balanceAfter,
      },
    });
  }

  // --- R17 Mail -------------------------------------------------------------

  async function loadMail(): Promise<void> {
    let inbox: Awaited<ReturnType<typeof api.loadMail>>;
    try {
      inbox = await api.loadMail(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    // ⚠ The sync's two header arms plus any backfill ARE the whole mailbox:
    // the BFF cold-started the delta, so there is no window and no paging.
    const { messages, statuses } = decodeMailbox(inbox.sync, inbox.backfill);
    store.apply({
      type: "mail/loaded",
      messages,
      statuses,
      unreadCount: inbox.unreadCount,
      inboxError: null,
    });

    // Every person the panel will show, resolved to a NAME (R7d): who sent each
    // message, and who each one went to. A corporation/alliance recipient is
    // named too, so a corp-wide message reads as "to <corp>" rather than a
    // number.
    const refs: NameRef[] = [];
    for (const header of messages) {
      refs.push({ kind: "character", id: header.senderID });
      for (const recipientID of header.toCharacterIDs) {
        refs.push({ kind: "character", id: recipientID });
      }
      if (header.toCorpOrAllianceID !== null) {
        refs.push({ kind: "corporation", id: header.toCorpOrAllianceID });
      }
    }
    requestNames(refs);
  }

  /**
   * Open one message.
   *
   * ⚠ `markRead` makes this a WRITE — it clears the unread bit and pushes
   * OnMailUpdatedByExternal to the character's other sessions. The BFF re-reads
   * the mailbox afterwards, so `markedRead` is what the server actually holds;
   * when that re-read failed it is null and NO claim is made. On a successful
   * mark-read the inbox is reloaded so the unread count and the list row agree.
   */
  async function openMail(messageID: number, markRead: boolean): Promise<void> {
    let result: Awaited<ReturnType<typeof api.loadMailBody>>;
    try {
      result = await api.loadMailBody(messageID, markRead, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "mail/action-error", message: mailRefusalMessage(error) });
      return;
    }
    if (markRead && result.markedRead === true) {
      // Reload BEFORE recording the open: mail/loaded clears the action error
      // and the list must agree with the count.
      await loadMail();
    }
    store.apply({
      type: "mail/opened",
      open: {
        messageID: result.messageID,
        body: result.body,
        unreadable: result.unreadable,
        markedRead: result.markedRead,
      },
    });
  }

  function closeMail(): void {
    store.apply({ type: "mail/opened", open: null });
  }

  // --- R17 Contracts --------------------------------------------------------

  async function loadContracts(page: number): Promise<void> {
    let reads: Awaited<ReturnType<typeof api.loadContracts>>;
    try {
      reads = await api.loadContracts(page, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    const browse = decodeContractSearch(reads.browse.result);
    const outstanding = decodeContractList(reads.outstanding.result);
    const accepted = decodeContractList(reads.accepted.result);
    const expired = decodeContractList(reads.expired.result);

    store.apply({
      type: "contracts/loaded",
      browse: browse.contracts,
      numFound: browse.numFound,
      page: reads.page,
      pageSize: reads.pageSize,
      outstanding,
      accepted,
      expired,
      summary: reads.summary.error ? null : decodeContractSummary(reads.summary.result),
      browseError: reads.browse.error,
      // The player's own contracts come from three reads; any one failing
      // means the "yours" view is incomplete.
      mineError: reads.outstanding.error || reads.accepted.error || reads.expired.error,
      worldHasNoContracts: reads.worldHasNoContracts,
    });

    // Every ID the panel will show, resolved to a NAME (R7d). A contract is
    // issued by someone, runs between two stations in two systems, and may be
    // reserved for or taken by someone.
    const refs: NameRef[] = [];
    for (const row of [...browse.contracts, ...outstanding, ...accepted, ...expired]) {
      refs.push({ kind: "character", id: row.issuerID });
      refs.push({ kind: "corporation", id: row.issuerCorpID });
      refs.push({ kind: "station", id: row.startStationID });
      refs.push({ kind: "station", id: row.endStationID });
      refs.push({ kind: "system", id: row.startSolarSystemID });
      refs.push({ kind: "system", id: row.endSolarSystemID });
      if (row.assigneeID !== null) {
        refs.push({ kind: "owner", id: row.assigneeID });
      }
      if (row.acceptorID !== null) {
        refs.push({ kind: "owner", id: row.acceptorID });
      }
    }
    requestNames(refs);
  }

  async function openContract(contractID: number): Promise<void> {
    let raw: Awaited<ReturnType<typeof api.loadContractDetail>>;
    try {
      raw = await api.loadContractDetail(contractID, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "contracts/detail-error", message: contractRefusalMessage(error) });
      return;
    }
    const detail = decodeContractDetail(raw);
    store.apply({ type: "contracts/detail", detail });
    if (detail) {
      // The item types and the route endpoints all render as NAMES.
      const refs: NameRef[] = [
        { kind: "station", id: detail.contract.startStationID },
        { kind: "station", id: detail.contract.endStationID },
        { kind: "system", id: detail.startSolarSystemID },
        { kind: "system", id: detail.endSolarSystemID },
        { kind: "character", id: detail.contract.issuerID },
      ];
      for (const item of detail.items) {
        refs.push({ kind: "type", id: item.typeID });
      }
      requestNames(refs);
    }
  }

  function closeContract(): void {
    store.apply({ type: "contracts/detail", detail: null });
  }

  /**
   * Send a message, then reload the inbox so the panel shows the server's own
   * picture, and record what ACTUALLY happened.
   *
   * Same three outcomes as a market write: a thrown refusal becomes a sentence
   * without inventing a cause; a SILENT decline (SendMail's bare null, which
   * carries no reason at all) is reported as exactly that; and a success is
   * confirmed by the BFF's re-read of the sender's own copy, not by the 200.
   */
  async function sendMail(request: api.MailSendRequest): Promise<void> {
    let outcome: Awaited<ReturnType<typeof api.sendMail>>;
    try {
      outcome = await api.sendMail(request, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "mail/action-error", message: mailRefusalMessage(error) });
      return;
    }
    await loadMail();
    store.apply({
      type: "mail/outcome",
      outcome: {
        kind: "send",
        applied: outcome.applied,
        declinedSilently: outcome.declinedSilently,
        recipientCount: outcome.recipientCount,
        message: outcome.message,
      },
    });
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
    // R23: the locked-target list rides the SAME ~1s beat as the snapshot.
    // Locking is asynchronous — the server acquires a lock over a duration — so
    // without a poll the page would show "Locking…" forever. The targets read
    // is best-effort: it must never make a snapshot read look like a failure.
    refresh: async () => {
      await loadSpaceSnapshot();
      if (store.space.get().snapshot?.inSpace === true) {
        await loadTargets().catch(() => {});
      }
    },
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

  // --- R23 slice A: targeting + module activation --------------------------
  //
  // THE GENERIC IN-SPACE ACTION LAYER. Nothing below names mining, combat,
  // salvaging or ewar, and nothing should: lockTarget/unlockTarget take a ball,
  // activateModule/deactivateModule take a module and an OPTIONAL effect name.
  // Slice B drives a mining laser through these four; a later combat goal
  // drives a turret through the same four unchanged.
  //
  // Every one of them obeys the same two rules:
  //   1. A REFUSAL carries the server's own reason verbatim (targeting/action-error).
  //   2. A 200 IS NOT PROOF — the BFF re-reads the authoritative state after
  //      every mutation, and when that re-read shows nothing changed AND the
  //      server gave no reason, that is reported as a SILENT DECLINE
  //      (targeting/silent-decline), a different thing from a refusal. The page
  //      never invents a cause for it.

  /** Read the locked-target list. Also used by the overview poll. */
  async function loadTargets(): Promise<void> {
    let result;
    try {
      result = await api.getTargets(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      // A targets read failing is not fatal to the overview; say so plainly.
      store.apply({
        type: "targeting/action-error",
        message: `The locked-target list could not be read: ${flightErrorReason(error)}`,
      });
      return;
    }
    store.apply({ type: "targeting/targets", targetIDs: decodeTargetIDs(result.targetIDs) });
  }

  /**
   * Run one targeting/activation action: record it, surface a refusal verbatim,
   * and land the server's own re-read. `verify` decides whether the action
   * actually took effect; false with no thrown refusal is a SILENT DECLINE.
   */
  async function runTargetingAction<T>(
    label: string,
    step: () => Promise<T>,
    apply: (result: T) => void | Promise<void>,
    verify: (result: T) => boolean,
    declineMessage: string,
  ): Promise<void> {
    let result: T;
    try {
      result = await step();
    } catch (error) {
      if (isSessionLost(error)) {
        stopLiveStream();
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({
        type: "targeting/action-error",
        message: `${label} refused: ${flightErrorReason(error)}`,
      });
      return;
    }
    store.apply({ type: "targeting/action", action: label });
    await apply(result);
    if (!verify(result)) {
      store.apply({ type: "targeting/silent-decline", message: declineMessage });
    }
  }

  async function lockTarget(targetID: number): Promise<void> {
    await runTargetingAction(
      "Lock",
      () => api.lockTarget(targetID, callOptions),
      (result) => {
        store.apply({ type: "targeting/targets", targetIDs: decodeTargetIDs(result.targetIDs) });
        if (result.acquiring) {
          store.apply({ type: "targeting/acquiring", targetID });
        }
      },
      // Accepted-and-acquiring is a SUCCESS: a lock takes time, and reporting
      // "nothing happened" while the server is mid-acquisition would be wrong.
      (result) => result.locked || result.acquiring,
      "The server accepted that lock and then did not lock anything, and gave no reason.",
    );
  }

  async function unlockTarget(targetID: number): Promise<void> {
    await runTargetingAction(
      "Unlock",
      () => api.unlockTarget(targetID, callOptions),
      (result) =>
        store.apply({ type: "targeting/targets", targetIDs: decodeTargetIDs(result.targetIDs) }),
      (result) => result.released,
      "The server did not release that lock, and gave no reason.",
    );
  }

  async function activateModule(
    itemID: number,
    opts: { effect?: string; targetID?: number | null; repeat?: -1 | 0 } = {},
  ): Promise<void> {
    await runTargetingAction(
      "Switch on",
      () => api.activateModule(itemID, opts, callOptions),
      // Refresh the snapshot NOW rather than waiting for the next poll tick, so
      // the button state the player sees after the click is the server's answer
      // to THIS action. Best-effort: a failed refresh must not turn a
      // successful activation into an error.
      () => loadSpaceSnapshot().catch(() => {}),
      // null means the verification read could not answer. That is NOT a silent
      // decline — we simply do not know — so it is not reported as one.
      (result) => result.active !== false,
      "The server accepted that module and then did not run it, and gave no reason.",
    );
  }

  async function deactivateModule(itemID: number, opts: { effect?: string } = {}): Promise<void> {
    await runTargetingAction(
      "Switch off",
      () => api.deactivateModule(itemID, opts, callOptions),
      () => loadSpaceSnapshot().catch(() => {}),
      (result) => result.stopped !== false,
      "The server did not stop that module, and gave no reason.",
    );
  }

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
      // R13 — the measurement the decide-loop runs retail's distance ladder on.
      // A READ (it starts nothing); the decoded snapshot is pushed into the
      // space slice too, so the Overview stays fresh while the autopilot flies
      // even if the panel's own poll is not running. A failure returns null and
      // the loop falls back to mode + refusals for that cycle.
      getSpaceSnapshot: async () => {
        try {
          const result = await api.getSpaceSnapshot(callOptions);
          const snapshot = decodeSpaceSnapshot(result.space);
          store.apply({ type: "space/snapshot", snapshot });
          return snapshot;
        } catch (error) {
          if (isSessionLost(error)) {
            throw error;
          }
          return null;
        }
      },
      undock: async () => {
        await api.undock(callOptions);
      },
      warp: async (destinationID) => {
        await api.warpTo(destinationID, null, callOptions);
      },
      approach: async (destinationID) => {
        // The autopilot's close-the-gap approach is retail's 0.0, not the
        // right-click menu's 50 m.
        await api.approach(destinationID, 0, callOptions);
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

    // --- R14 inventory depth ---

    toggleSelection(itemID) {
      const selection = store.get().inventory.selection;
      store.apply({
        type: "inventory/selection",
        itemIDs: selection.includes(itemID)
          ? selection.filter((id) => id !== itemID)
          : [...selection, itemID],
      });
    },

    clearSelection() {
      store.apply({ type: "inventory/selection", itemIDs: [] });
    },

    openContainer,

    async transferItems(itemIDs, from, to, qty = null) {
      await runInventoryAction(async () => {
        const result = await api.transferItems(itemIDs, from, to, qty ?? null, callOptions);
        return {
          applied: result.applied,
          declinedSilently: result.declinedSilently,
          message: describeTransfer(result, itemIDs.length, qty ?? null),
        };
      });
    },

    async mergeStacks(sourceItemID, destinationItemID, place) {
      await runInventoryAction(async () => {
        const result = await api.mergeStacks(
          sourceItemID,
          destinationItemID,
          place,
          null,
          callOptions,
        );
        return {
          applied: result.applied,
          declinedSilently: result.declinedSilently,
          message: result.applied
            ? `Merged ${result.merged} into the stack.`
            : "The server did not merge those stacks, and gave no reason.",
        };
      });
    },

    async trashItems(itemIDs, place) {
      await runInventoryAction(async () => {
        const result = await api.trashItems(itemIDs, place, callOptions);
        const destroyed = result.destroyed.length;
        const survived = result.survived.length;
        let message: string;
        if (destroyed > 0 && survived === 0) {
          message = `Destroyed ${destroyed} ${destroyed === 1 ? "item" : "items"}.`;
        } else if (destroyed > 0) {
          message = `Destroyed ${destroyed}; the server refused to destroy ${survived}, and gave no reason.`;
        } else {
          message = "The server destroyed nothing, and gave no reason.";
        }
        return { applied: result.applied, declinedSilently: result.declinedSilently, message };
      });
    },

    loadCorpHangar,

    selectCorpDivision(division) {
      store.apply({ type: "inventory/corp-division", division });
    },

    loadFitting,

    async fitModule(itemID, source, slot) {
      await runFittingAction(() => api.fitModule(itemID, source, slot, callOptions));
    },

    async unfitModule(itemID, destination) {
      await runFittingAction(() => api.unfitModule(itemID, destination, callOptions));
    },

    async setModuleOnline(itemID, online) {
      await runFittingAction(() => api.setModuleOnline(itemID, online, callOptions));
    },

    async destroyRig(itemID) {
      await runFittingAction(() => api.destroyRig(itemID, callOptions));
    },

    loadIndustry,

    async previewIndustryJob(request) {
      const result = await api.previewIndustryJob(request, callOptions);
      return result.available;
    },

    async installIndustryJob(request) {
      await runIndustryAction(() => api.installIndustryJob(request, callOptions));
    },

    async deliverIndustryJob(jobID) {
      await runIndustryAction(() => api.deliverIndustryJob(jobID, callOptions));
    },

    async cancelIndustryJob(jobID) {
      await runIndustryAction(() => api.cancelIndustryJob(jobID, callOptions));
    },
    loadMarket,
    findMarketTypes: (q: string) => api.findMarketTypes(q, callOptions),
    async placeMarketOrder(request) {
      // Buying names a TYPE; selling names a specific STACK. Two different
      // retail calls, and the panel chooses between them here rather than the
      // BFF guessing from the payload.
      if (request.side === "sell") {
        const itemID = request.itemID ?? 0;
        await runMarketAction("sell", () =>
          api.placeMarketSellOrder(
            {
              itemID,
              typeID: request.typeID,
              price: request.price,
              quantity: request.quantity,
              durationDays: request.durationDays,
            },
            callOptions,
          ));
        return;
      }
      await runMarketAction("buy", () =>
        api.placeMarketBuyOrder(
          {
            typeID: request.typeID,
            price: request.price,
            quantity: request.quantity,
            durationDays: request.durationDays,
          },
          callOptions,
        ));
    },
    async cancelMarketOrder(orderID) {
      await runMarketAction("cancel", () => api.cancelMarketOrder(orderID, callOptions));
    },
    async modifyMarketOrder(orderID, price) {
      await runMarketAction("modify", () => api.modifyMarketOrder(orderID, price, callOptions));
    },
    loadMail,
    openMail,
    closeMail,
    findCharacters: (q: string) => api.findCharacters(q, callOptions),
    sendMail,
    loadContracts,
    openContract,
    closeContract,

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

    async warpTo(destinationID, minRange = null) {
      await runFlightStep("Warp", () => api.warpTo(destinationID, minRange, callOptions));
    },

    async approach(destinationID, range = null) {
      await runFlightStep("Approach", () => api.approach(destinationID, range, callOptions));
    },

    async keepAtRange(targetID, range = null) {
      await runFlightStep("Keep at range", () => api.keepAtRange(targetID, range, callOptions));
    },

    async orbit(targetID, range = null) {
      await runFlightStep("Orbit", () => api.orbit(targetID, range, callOptions));
    },

    async alignTo(targetID) {
      await runFlightStep("Align", () => api.alignTo(targetID, callOptions));
    },

    async stopShip() {
      // Retail's Stop cancels the client-side navigation BEFORE the command and
      // switches the autopilot off after it. Ours is the same order: abort the
      // browser decide-loop first so it cannot issue another move into the stop,
      // then tell the server to cut the engines.
      autopilot?.abort();
      await runFlightStep("Stop", () => api.stopShip(callOptions));
    },

    loadSpaceSnapshot,
    loadTargets,
    lockTarget,
    unlockTarget,
    activateModule,
    deactivateModule,

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
