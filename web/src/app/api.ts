// Typed BFF endpoints for the R2 page flow: who-cares login, persistent-
// session select/release. The bridge call tuple itself goes through
// bridge/callMethod.ts; these are the BFF's own session routes
// (docs/bridge-wire-contract.md, "BFF routes").
//
// The opaque bridgeSessionID never appears here: the BFF holds it server-side
// in its cookie-session store and attaches it to bridge calls itself.

import { BridgeCallError } from "../bridge/callMethod.ts";
import type { JsonValue } from "../bridge/wire.ts";
import type {
  AgentRow,
  OnlineCharacterState,
  SlotFamily,
  StationStatic,
} from "../store/types.ts";
import type { NameRef } from "../store/names.ts";

export interface LoginResult {
  readonly accountID: number;
  readonly username: string;
}

export interface SelectResult {
  readonly character: OnlineCharacterState;
  readonly station: StationStatic | null;
  readonly notifications: readonly JsonValue[];
}

export interface ApiOptions {
  /** Base URL prefix; default "" (same-origin against the BFF). */
  readonly baseUrl?: string;
  /** Injectable fetch for tests; default globalThis.fetch. */
  readonly fetch?: typeof fetch;
}

async function requestJson(
  path: string,
  init: RequestInit,
  options: ApiOptions,
): Promise<Record<string, JsonValue>> {
  const doFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl ?? ""}${path}`, {
      credentials: "same-origin",
      ...init,
    });
  } catch (cause) {
    throw new BridgeCallError(
      "BRIDGE_NETWORK_ERROR",
      `${path} could not reach the BFF: ${cause instanceof Error ? cause.message : String(cause)}`,
      0,
    );
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new BridgeCallError(
      "BRIDGE_BAD_RESPONSE",
      `${path} returned a non-JSON response (HTTP ${response.status}).`,
      response.status,
    );
  }
  if (
    typeof data !== "object" ||
    data === null ||
    (data as { ok?: unknown }).ok !== true ||
    !response.ok
  ) {
    const errorBody = (data ?? {}) as { error?: unknown; message?: unknown };
    throw new BridgeCallError(
      typeof errorBody.error === "string" ? errorBody.error : "BRIDGE_BAD_RESPONSE",
      typeof errorBody.message === "string"
        ? errorBody.message
        : `${path} failed (HTTP ${response.status}).`,
      response.status,
    );
  }
  return data as Record<string, JsonValue>;
}

async function postJson(
  path: string,
  body: unknown,
  options: ApiOptions,
): Promise<Record<string, JsonValue>> {
  return requestJson(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    options,
  );
}

async function getJson(
  path: string,
  options: ApiOptions,
): Promise<Record<string, JsonValue>> {
  return requestJson(path, { method: "GET" }, options);
}

function asNumberOrNull(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Who-cares login (roadmap section 6): any password signs an existing account in. */
export async function login(
  username: string,
  password: string,
  options: ApiOptions = {},
): Promise<LoginResult> {
  const data = await postJson("/api/login", { username, password }, options);
  const account = (data.account ?? {}) as { accountID?: JsonValue; username?: JsonValue };
  return {
    accountID: asNumberOrNull(account.accountID) ?? 0,
    username: typeof account.username === "string" ? account.username : username,
  };
}

export async function logout(options: ApiOptions = {}): Promise<void> {
  await postJson("/api/logout", {}, options);
}

/**
 * Bring a character online on a persistent browser-backed session:
 * POST /api/bridge/select dispatches the retail tuple
 * charUnboundMgr.SelectCharacterID on a gateway-minted live session and
 * returns the docked entry state (plus client-local static station identity).
 */
export async function selectCharacter(
  characterID: number,
  options: ApiOptions = {},
): Promise<SelectResult> {
  const data = await postJson("/api/bridge/select", { characterID }, options);
  const character = (data.character ?? {}) as Record<string, JsonValue>;
  const station = data.station;
  return {
    character: {
      characterID: asNumberOrNull(character.characterID) ?? characterID,
      characterName:
        typeof character.characterName === "string" ? character.characterName : "",
      stationID: asNumberOrNull(character.stationID),
      structureID: asNumberOrNull(character.structureID),
      solarSystemID: asNumberOrNull(character.solarSystemID),
      corporationID: asNumberOrNull(character.corporationID),
    },
    station:
      typeof station === "object" && station !== null && !Array.isArray(station)
        ? (station as unknown as StationStatic)
        : null,
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
  };
}

/**
 * Read-only static station identity by ID (goal R6b): the same client-local
 * StationStatic the select route returns, fetched so the Station panel can
 * refresh its identity after the docked station changes (autopilot arrival /
 * manual dock). Not a gateway/bridge call — read-only static reference data.
 */
export async function loadStationStatic(
  stationID: number,
  options: ApiOptions = {},
): Promise<StationStatic | null> {
  const data = await getJson(`/api/map/station/${stationID}`, options);
  const station = data.station;
  return typeof station === "object" && station !== null && !Array.isArray(station)
    ? (station as unknown as StationStatic)
    : null;
}

/** Release the persistent session (character goes offline via the retail disconnect path). */
export async function releaseSession(
  options: ApiOptions = {},
): Promise<{ released: boolean }> {
  const data = await postJson("/api/bridge/release", {}, options);
  return { released: data.released === true };
}

// --- R3 Inventory & Ship (bound-object bridge) -----------------------------
// The browser addresses items/ships by their game IDs; the BFF holds the
// bound-object handles and returns the raw retail-shaped List/GetCapacity
// results, which app/flow.ts decodes with bridge/inventoryShip.ts.

/** One inventory container's raw reads (retail-shaped; decoded in the flow). */
export interface RawContainer {
  readonly list: JsonValue;
  readonly capacity: JsonValue;
  readonly error: string | null;
}

export interface RawInventoryPanel {
  readonly stationID: number | null;
  readonly activeShipID: number | null;
  readonly hangar: RawContainer;
  readonly cargo: RawContainer & { readonly shipID: number | null };
}

function readRawContainer(value: JsonValue | undefined): RawContainer {
  const container = (value ?? {}) as Record<string, JsonValue>;
  return {
    list: container.list ?? null,
    capacity: container.capacity ?? null,
    error: typeof container.error === "string" ? container.error : null,
  };
}

/** Load the full Inventory & Ship panel (station hangar + active-ship cargo). */
export async function loadInventory(
  options: ApiOptions = {},
): Promise<RawInventoryPanel> {
  const data = await getJson("/api/bridge/inventory", options);
  const cargo = (data.cargo ?? {}) as Record<string, JsonValue>;
  return {
    stationID: asNumberOrNull(data.stationID),
    activeShipID: asNumberOrNull(data.activeShipID),
    hangar: readRawContainer(data.hangar),
    cargo: { ...readRawContainer(data.cargo), shipID: asNumberOrNull(cargo.shipID) },
  };
}

/** Move one item hangar <-> active-ship cargo. */
export async function moveItem(
  itemID: number,
  direction: "toCargo" | "toHangar",
  qty: number | null,
  options: ApiOptions = {},
): Promise<void> {
  const body: Record<string, JsonValue> = { itemID, direction };
  if (qty !== null) {
    body.qty = qty;
  }
  await postJson("/api/bridge/inventory/move", body, options);
}

/** Stack all loose stacks in the hangar or the active-ship cargo. */
export async function stackItems(
  target: "hangar" | "cargo",
  options: ApiOptions = {},
): Promise<void> {
  await postJson("/api/bridge/inventory/stack", { target }, options);
}

/** Board a ship sitting in the station hangar (it becomes the active ship). */
export async function boardShip(
  shipID: number,
  options: ApiOptions = {},
): Promise<void> {
  await postJson("/api/bridge/ship/board", { shipID }, options);
}

// --- R12 Ship fitting ------------------------------------------------------
// The BFF drives the same bound-object two-step as the inventory routes (a
// slot flag instead of hangar/cargo) and returns the raw retail-shaped reads,
// decoded in the flow with bridge/fitting.ts. The browser addresses a SLOT by
// family + index ("the third high slot") — slot flagIDs live on the BFF only.

/** The raw fitting reads (retail-shaped; decoded in the flow). */
export interface RawFittingReads {
  readonly activeShipID: number | null;
  readonly slots: JsonValue;
  readonly shipInfo: JsonValue;
  readonly online: JsonValue;
  readonly errors: {
    readonly slots: string | null;
    readonly shipInfo: string | null;
    readonly online: string | null;
  };
}

/** Read the active ship's fitting: slots, resources, and online state. */
export async function loadFitting(options: ApiOptions = {}): Promise<RawFittingReads> {
  const data = await getJson("/api/bridge/fitting", options);
  const errors = (data.errors ?? {}) as Record<string, JsonValue>;
  return {
    activeShipID: asNumberOrNull(data.activeShipID),
    slots: data.slots ?? null,
    shipInfo: data.shipInfo ?? null,
    online: data.online ?? null,
    errors: {
      slots: typeof errors.slots === "string" ? errors.slots : null,
      shipInfo: typeof errors.shipInfo === "string" ? errors.shipInfo : null,
      online: typeof errors.online === "string" ? errors.online : null,
    },
  };
}

/**
 * A fitting change's outcome. `applied` is the BFF's RE-READ of the slots
 * after the call, not an echo of the request: the server can decline a fit
 * silently (a module you have no skill for simply does not move), so a
 * successful response is not on its own proof anything happened.
 */
export interface FittingChangeResult {
  readonly applied: boolean;
}

/** Fit a module from the station hangar or the ship's cargo into a slot. */
export async function fitModule(
  itemID: number,
  source: "hangar" | "cargo",
  slot: { readonly family: SlotFamily; readonly index: number } | "auto",
  options: ApiOptions = {},
): Promise<FittingChangeResult> {
  const body: Record<string, JsonValue> =
    slot === "auto"
      ? { itemID, source, family: "auto" }
      : { itemID, source, family: slot.family, index: slot.index };
  const data = await postJson("/api/bridge/fitting/fit", body, options);
  return { applied: data.applied === true };
}

/** Unfit a module back to the station hangar or the ship's cargo. */
export async function unfitModule(
  itemID: number,
  destination: "hangar" | "cargo",
  options: ApiOptions = {},
): Promise<FittingChangeResult> {
  const data = await postJson(
    "/api/bridge/fitting/unfit",
    { itemID, destination },
    options,
  );
  return { applied: data.applied === true };
}

/**
 * Bring a fitted module online or take it offline. A refusal (not enough CPU
 * or powergrid, capacitor, max online of that group) arrives as the handler's
 * OWN message on a typed BridgeCallError — it is never guessed here.
 */
export async function setModuleOnline(
  itemID: number,
  online: boolean,
  options: ApiOptions = {},
): Promise<void> {
  await postJson("/api/bridge/fitting/state", { itemID, online }, options);
}

/**
 * DESTROY a fitted rig. Rigs cannot be unfitted — removing one destroys it —
 * so the BFF refuses this call outright unless `confirm` is true. The UI asks
 * first; this flag is the second gate behind that.
 */
export async function destroyRig(
  itemID: number,
  options: ApiOptions = {},
): Promise<FittingChangeResult> {
  const data = await postJson(
    "/api/bridge/fitting/destroy-rig",
    { itemID, confirm: true },
    options,
  );
  return { applied: data.applied === true };
}

// --- R4 Agents & Missions (agentMgr bridge) --------------------------------
// The BFF holds the bound agent handle; the browser addresses agents by game ID
// and decodes the raw retail-shaped conversation/briefing/journal results with
// bridge/agents.ts.

export interface AgentListResult {
  readonly stationID: number | null;
  readonly agents: readonly AgentRow[];
}

/** The station's agents (agentMgr.GetAgents, filtered to the docked station). */
export async function loadAgents(options: ApiOptions = {}): Promise<AgentListResult> {
  const data = await getJson("/api/bridge/agents", options);
  return {
    stationID: asNumberOrNull(data.stationID),
    agents: Array.isArray(data.agents) ? (data.agents as unknown as readonly AgentRow[]) : [],
  };
}

/**
 * Drive the agent conversation: DoAction(actionID). `actionID` null opens the
 * conversation; a token from availableActions requests / accepts / declines.
 * Returns the raw retail-shaped DoAction result (decoded in the flow).
 */
export async function agentAction(
  agentID: number,
  actionID: number | null,
  options: ApiOptions = {},
): Promise<JsonValue> {
  const data = await postJson(`/api/bridge/agents/${agentID}/action`, { actionID }, options);
  return data.result ?? null;
}

export interface RawBriefingReads {
  readonly briefing: JsonValue;
  readonly objective: JsonValue;
  readonly location: JsonValue;
  readonly errors: {
    readonly briefing: string | null;
    readonly objective: string | null;
    readonly location: string | null;
  };
}

/** The bound-agent mission briefing reads (raw; decoded in the flow). */
export async function loadBriefing(
  agentID: number,
  options: ApiOptions = {},
): Promise<RawBriefingReads> {
  const data = await getJson(`/api/bridge/agents/${agentID}/briefing`, options);
  const errors = (data.errors ?? {}) as Record<string, JsonValue>;
  return {
    briefing: data.briefing ?? null,
    objective: data.objective ?? null,
    location: data.location ?? null,
    errors: {
      briefing: typeof errors.briefing === "string" ? errors.briefing : null,
      objective: typeof errors.objective === "string" ? errors.objective : null,
      location: typeof errors.location === "string" ? errors.location : null,
    },
  };
}

/** The mission journal (agentMgr.GetMyJournalDetails; raw, decoded in the flow). */
export async function loadJournal(options: ApiOptions = {}): Promise<JsonValue> {
  const data = await getJson("/api/bridge/journal", options);
  return data.result ?? null;
}

// --- R6a Agent Finder (static agent reference data) ------------------------
// The Agent Finder lists agents from the static agentAuthority reference table
// (GET /api/agents/find) — read-only static data like /api/map/graph, NOT a
// gateway/bridge call. The BFF filters by kind/level and caps; the browser
// annotates each row with jumps from the current system (client-side BFS) and
// sorts nearest-first. This raw result carries the server-resolved names.

/** One agent from /api/agents/find (station/system names resolved server-side). */
export interface FoundAgent {
  readonly agentID: number;
  readonly name: string;
  readonly level: number | null;
  readonly missionKind: string | null;
  readonly missionTypeLabel: string | null;
  readonly corporationID: number | null;
  readonly factionID: number | null;
  readonly stationID: number | null;
  readonly stationName: string | null;
  readonly solarSystemID: number | null;
  readonly solarSystemName: string | null;
}

export interface FindAgentsResult {
  readonly kind: string;
  readonly level: number | null;
  readonly total: number;
  readonly capped: boolean;
  readonly agents: readonly FoundAgent[];
}

export interface FindAgentsFilters {
  /** Mission kind (default "courier"; "all" disables the kind filter). */
  readonly kind?: string;
  readonly level?: number | null;
  /** Server-side result cap (default 500 on the BFF; clamped to [1, 5000]). */
  readonly limit?: number;
}

function asFoundAgent(value: JsonValue): FoundAgent {
  const row = (value ?? {}) as Record<string, JsonValue>;
  return {
    agentID: asNumberOrNull(row.agentID) ?? 0,
    name: typeof row.name === "string" ? row.name : `Agent ${asNumberOrNull(row.agentID) ?? 0}`,
    level: asNumberOrNull(row.level),
    missionKind: typeof row.missionKind === "string" ? row.missionKind : null,
    missionTypeLabel: typeof row.missionTypeLabel === "string" ? row.missionTypeLabel : null,
    corporationID: asNumberOrNull(row.corporationID),
    factionID: asNumberOrNull(row.factionID),
    stationID: asNumberOrNull(row.stationID),
    stationName: typeof row.stationName === "string" ? row.stationName : null,
    solarSystemID: asNumberOrNull(row.solarSystemID),
    solarSystemName: typeof row.solarSystemName === "string" ? row.solarSystemName : null,
  };
}

/** Find agents from the static reference table (filtered + capped server-side). */
export async function findAgents(
  filters: FindAgentsFilters = {},
  options: ApiOptions = {},
): Promise<FindAgentsResult> {
  const params = new URLSearchParams();
  if (filters.kind !== undefined) {
    params.set("kind", filters.kind);
  }
  if (filters.level !== undefined && filters.level !== null) {
    params.set("level", String(filters.level));
  }
  if (filters.limit !== undefined) {
    params.set("limit", String(filters.limit));
  }
  const query = params.toString();
  const data = await getJson(`/api/agents/find${query ? `?${query}` : ""}`, options);
  return {
    kind: typeof data.kind === "string" ? data.kind : "courier",
    level: asNumberOrNull(data.level),
    total: asNumberOrNull(data.total) ?? 0,
    capped: data.capped === true,
    agents: Array.isArray(data.agents) ? data.agents.map(asFoundAgent) : [],
  };
}

// --- R6 Courier-completion reward readout (Step 12) ------------------------
// The post-completion wallet / LP / standings pull reads (account.GetCashBalance,
// LPSvc.GetAllMyCharacterWalletLPBalances, standingMgr.GetCharStandings). The
// BFF returns the raw retail-shaped results, decoded in the flow with
// bridge/rewards.ts. The journal (the fourth Step-12 read) uses loadJournal.

export interface RawRewardReads {
  readonly cash: JsonValue;
  readonly lp: JsonValue;
  readonly standings: JsonValue;
  readonly errors: {
    readonly cash: string | null;
    readonly lp: string | null;
    readonly standings: string | null;
  };
}

/** The wallet / LP / standings reward reads (raw; decoded in the flow). */
export async function loadRewards(options: ApiOptions = {}): Promise<RawRewardReads> {
  const data = await getJson("/api/bridge/rewards", options);
  const errors = (data.errors ?? {}) as Record<string, JsonValue>;
  return {
    cash: data.cash ?? null,
    lp: data.lp ?? null,
    standings: data.standings ?? null,
    errors: {
      cash: typeof errors.cash === "string" ? errors.cash : null,
      lp: typeof errors.lp === "string" ? errors.lp : null,
      standings: typeof errors.standings === "string" ? errors.standings : null,
    },
  };
}

// --- R7 Local + Corp chat --------------------------------------------------
// The BFF holds the bridgeSessionID; the browser addresses channels by name.
// READ is a backlog poll (chat delivery bypasses the notification drain), so
// the panel polls /api/bridge/chat/:channel while open. The raw `chat` object
// (roster + backlog) is decoded in the flow with bridge/chat.ts.

/** Read a chat channel's roster + recent backlog (raw; decoded in the flow). */
export async function readChat(
  channel: "local" | "corp",
  options: ApiOptions = {},
): Promise<JsonValue> {
  const data = await getJson(`/api/bridge/chat/${channel}`, options);
  return data.chat ?? null;
}

/** Send a message to a chat channel; returns the raw send echo. */
export async function sendChat(
  channel: "local" | "corp",
  message: string,
  options: ApiOptions = {},
): Promise<JsonValue> {
  const data = await postJson(`/api/bridge/chat/${channel}/send`, { message }, options);
  return data.chat ?? null;
}

// --- R10 Live event channel (SSE) ------------------------------------------
// The BFF republishes its gateway push WebSocket to the browser as Server-Sent
// Events on GET /api/bridge/events (same-origin, cookie-authed). Frames are
// either gateway frames (`source: "evejs-web-gateway"`) or BFF status frames
// (`source: "evejs-web-bff"`, `type: "stream-status"`).
//
// EventSource handles reconnection itself, so this is deliberately thin. It is
// a LIVENESS channel only — every bridge response still carries its notification
// drain — so a browser without EventSource, or one whose stream never connects,
// simply keeps polling.

export interface BridgeEventSubscription {
  close(): void;
}

export interface BridgeEventHandlers {
  readonly onFrame: (frame: JsonValue) => void;
  readonly onOpen?: () => void;
  readonly onError?: () => void;
}

/** Minimal EventSource surface, so tests can inject a fake. */
export interface EventSourceLike {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  close(): void;
}

export interface BridgeEventOptions extends ApiOptions {
  /** Injectable EventSource factory for tests; default globalThis.EventSource. */
  readonly eventSource?: (url: string) => EventSourceLike;
}

/**
 * Subscribe to the live bridge event channel. Returns a handle whose `close()`
 * detaches; call it when the character goes offline or the page unmounts.
 */
export function subscribeBridgeEvents(
  handlers: BridgeEventHandlers,
  options: BridgeEventOptions = {},
): BridgeEventSubscription {
  const url = `${options.baseUrl ?? ""}/api/bridge/events`;
  const factory =
    options.eventSource ??
    (typeof globalThis.EventSource === "function"
      ? (target: string) =>
          new globalThis.EventSource(target, {
            withCredentials: true,
          }) as unknown as EventSourceLike
      : null);
  if (!factory) {
    // No EventSource in this environment: report the failure once so the caller
    // stays on its polls rather than waiting for events that cannot arrive.
    handlers.onError?.();
    return { close() {} };
  }

  let source: EventSourceLike;
  try {
    source = factory(url);
  } catch {
    handlers.onError?.();
    return { close() {} };
  }

  let closed = false;
  source.onopen = () => {
    if (!closed) {
      handlers.onOpen?.();
    }
  };
  source.onmessage = (event) => {
    if (closed) {
      return;
    }
    let frame: JsonValue;
    try {
      frame = JSON.parse(event.data) as JsonValue;
    } catch {
      return; // A malformed frame is ignored, never thrown at the page.
    }
    handlers.onFrame(frame);
  };
  source.onerror = () => {
    if (!closed) {
      handlers.onError?.();
    }
  };

  return {
    close() {
      closed = true;
      try {
        source.close();
      } catch {
        // Already closed.
      }
    },
  };
}

// --- R5a Flight (manually-stepped space movement) --------------------------
// The BFF holds the beyonce bound park handle server-side and returns the raw
// flight-status snapshot (decoded in the flow with bridge/flight.ts). Movement
// refusals pass through as the handler's own CALL_REFUSED message.

/** One flight step's outcome: the raw flight snapshot after the step + notifications. */
export interface FlightStepResult {
  readonly flight: JsonValue;
  readonly notifications: readonly JsonValue[];
}

function readFlightStep(data: Record<string, JsonValue>): FlightStepResult {
  return {
    flight: data.flight ?? null,
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
  };
}

/** Read the current flight status (location + ship movement state). */
export async function getFlightStatus(options: ApiOptions = {}): Promise<FlightStepResult> {
  return readFlightStep(await getJson("/api/bridge/flight/status", options));
}

/** Undock from the station (ship.Undock; the session enters space). */
export async function undock(options: ApiOptions = {}): Promise<FlightStepResult> {
  return readFlightStep(await postJson("/api/bridge/flight/undock", {}, options));
}

/**
 * Warp to a chosen gate/celestial.
 *
 * `minRange` null is the autopilot's own warp (CmdWarpToStuffAutopilot); a
 * number is the right-click "warp to within N" form (CmdWarpToStuff with a
 * minRange kwarg). Retail's own default for the menu is 0.
 */
export async function warpTo(
  destinationID: number,
  minRange: number | null = null,
  options: ApiOptions = {},
): Promise<FlightStepResult> {
  const body = minRange === null ? { destinationID } : { destinationID, minRange };
  return readFlightStep(await postJson("/api/bridge/flight/warp", body, options));
}

/**
 * Approach a gate/target at full speed (beyonce.CmdSetSpeedFraction(1) +
 * CmdFollowBall). The range is retail's: the menu approach uses 50 m, and the
 * autopilot's close-the-gap step uses 0.
 */
export async function approach(
  destinationID: number,
  range: number | null = null,
  options: ApiOptions = {},
): Promise<FlightStepResult> {
  const body = range === null ? { destinationID } : { destinationID, range };
  return readFlightStep(await postJson("/api/bridge/flight/approach", body, options));
}

/**
 * Hold a set distance from a target (the same CmdFollowBall as approach, with a
 * non-zero range). Default 1000 m, floored at 50 m by the BFF.
 */
export async function keepAtRange(
  targetID: number,
  range: number | null = null,
  options: ApiOptions = {},
): Promise<FlightStepResult> {
  const body = range === null ? { targetID } : { targetID, range };
  return readFlightStep(await postJson("/api/bridge/flight/keep-at-range", body, options));
}

/** Circle a target at a set distance (beyonce.CmdOrbit). Default 1000 m. */
export async function orbit(
  targetID: number,
  range: number | null = null,
  options: ApiOptions = {},
): Promise<FlightStepResult> {
  const body = range === null ? { targetID } : { targetID, range };
  return readFlightStep(await postJson("/api/bridge/flight/orbit", body, options));
}

/** Point the ship at a target and hold that heading (beyonce.CmdAlignTo). */
export async function alignTo(
  targetID: number,
  options: ApiOptions = {},
): Promise<FlightStepResult> {
  return readFlightStep(await postJson("/api/bridge/flight/align", { targetID }, options));
}

/** Cut the engines (beyonce.CmdStop). */
export async function stopShip(options: ApiOptions = {}): Promise<FlightStepResult> {
  return readFlightStep(await postJson("/api/bridge/flight/stop", {}, options));
}

/** Jump through an NPC stargate (beyonce.CmdStargateJump). */
export async function jump(
  fromGateID: number,
  toGateID: number,
  options: ApiOptions = {},
): Promise<FlightStepResult> {
  return readFlightStep(
    await postJson("/api/bridge/flight/jump", { fromGateID, toGateID }, options),
  );
}

/** Dock at the destination station (beyonce.CmdDock). */
export async function dock(
  stationID: number,
  options: ApiOptions = {},
): Promise<FlightStepResult> {
  return readFlightStep(await postJson("/api/bridge/flight/dock", { stationID }, options));
}

// --- R11 Space overview + ship HUD -----------------------------------------
// A read-only snapshot of what the ship can see plus the active ship's
// shield/armor/hull/capacitor (decoded in the flow with bridge/space.ts). The
// page polls it ~1s while in space; distance/sorting/filtering are computed in
// the browser, exactly as the retail client does.

/** One space-snapshot read: the raw snapshot + the drained notifications. */
export interface SpaceSnapshotResult {
  readonly space: JsonValue;
  readonly notifications: readonly JsonValue[];
}

/** Read what is currently around the ship (and the ship's own condition). */
export async function getSpaceSnapshot(
  options: ApiOptions = {},
): Promise<SpaceSnapshotResult> {
  const data = await getJson("/api/bridge/space/snapshot", options);
  return {
    space: data.space ?? null,
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
  };
}

// --- R5b Travel (client-side route solver static data) ---------------------
// The system-adjacency graph the browser route solver runs BFS over is served
// as read-only static reference data (GET /api/map/graph) — NOT a gateway call
// and NOT a server-side travel job (roadmap §7 / G2).

/** The compact system-adjacency graph payload (systems name map + edge tuples). */
export interface SystemGraphResult {
  readonly systems: Readonly<Record<string, string>>;
  readonly edges: ReadonlyArray<readonly [number, number, number, number]>;
}

/** Fetch the system-adjacency graph for the client-side route solver. */
export async function loadSystemGraph(options: ApiOptions = {}): Promise<SystemGraphResult> {
  const data = await getJson("/api/map/graph", options);
  return {
    systems:
      typeof data.systems === "object" && data.systems !== null && !Array.isArray(data.systems)
        ? (data.systems as Record<string, string>)
        : {},
    edges: Array.isArray(data.edges)
      ? (data.edges as ReadonlyArray<readonly [number, number, number, number]>)
      : [],
  };
}

/** A destination resolved from static reference data (station or system → system). */
export interface ResolvedDestination {
  readonly id: number;
  readonly kind: "station" | "system" | "unknown";
  readonly solarSystemID: number | null;
  readonly systemName: string | null;
  readonly stationID: number | null;
  readonly stationName: string | null;
}

/**
 * Resolve a picked destination ID to its solar system (a courier destination is
 * a station; the route solver works on systems). Read-only static reference
 * data, like station identity — not a route or gateway call.
 */
export async function resolveDestination(
  id: number,
  options: ApiOptions = {},
): Promise<ResolvedDestination> {
  const data = await getJson(`/api/map/resolve/${id}`, options);
  return {
    id,
    kind: data.kind === "station" || data.kind === "system" ? data.kind : "unknown",
    solarSystemID: asNumberOrNull(data.solarSystemID),
    systemName: typeof data.systemName === "string" ? data.systemName : null,
    stationID: asNumberOrNull(data.stationID),
    stationName: typeof data.stationName === "string" ? data.stationName : null,
  };
}

// --- R7a Map name search (set a destination by name) -----------------------
// The Travel tab searches the static solar-system + station tables by name
// (GET /api/map/find) so a player can set a destination without knowing EVE IDs.
// Read-only static reference data like /api/map/graph — NOT a gateway/bridge
// call. The chosen match's `id` is handed to startRoute (the R5b route solver +
// autopilot); the flow annotates jumps-away client-side from the map graph.

/** One name-search match from /api/map/find (a solar system or a station). */
export interface MapLocation {
  readonly id: number;
  readonly name: string;
  readonly kind: "system" | "station";
  readonly solarSystemID: number | null;
  readonly solarSystemName: string | null;
}

export interface FindMapLocationsResult {
  readonly q: string;
  readonly kind: string | null;
  readonly total: number;
  readonly capped: boolean;
  readonly matches: readonly MapLocation[];
}

function asMapLocation(value: JsonValue): MapLocation {
  const row = (value ?? {}) as Record<string, JsonValue>;
  const kind = row.kind === "station" ? "station" : "system";
  return {
    id: asNumberOrNull(row.id) ?? 0,
    name: typeof row.name === "string" ? row.name : `Location ${asNumberOrNull(row.id) ?? 0}`,
    kind,
    solarSystemID: asNumberOrNull(row.solarSystemID),
    solarSystemName: typeof row.solarSystemName === "string" ? row.solarSystemName : null,
  };
}

/** Search the static map by name (systems + stations, or narrowed by kind). */
export async function findMapLocations(
  q: string,
  kind: "system" | "station" | null = null,
  options: ApiOptions = {},
): Promise<FindMapLocationsResult> {
  const params = new URLSearchParams();
  params.set("q", q);
  if (kind) {
    params.set("kind", kind);
  }
  const data = await getJson(`/api/map/find?${params.toString()}`, options);
  return {
    q: typeof data.q === "string" ? data.q : q,
    kind: typeof data.kind === "string" ? data.kind : null,
    total: asNumberOrNull(data.total) ?? 0,
    capped: data.capped === true,
    matches: Array.isArray(data.matches) ? data.matches.map(asMapLocation) : [],
  };
}

// --- R7c Batch name resolution (names everywhere) --------------------------
// Turn raw IDs into names across every tab in ONE round-trip. POST /api/names
// takes { items: [{kind, id}] } and returns { names: { "kind:id": name|null } }
// over the static reference getters — read-only, like /api/map/find, NOT a
// gateway/bridge call. A null value is a definitive "unknown" (an NPC/type not
// in the static tables); the client name-cache caches it so it never refetches.

export interface ResolveNamesResult {
  /** Keyed by `${kind}:${id}`; value is the resolved name or null (unknown). */
  readonly names: Readonly<Record<string, string | null>>;
}

/** Batch-resolve a set of `{kind, id}` refs to names (kind:id → name | null). */
export async function resolveNames(
  items: readonly NameRef[],
  options: ApiOptions = {},
): Promise<ResolveNamesResult> {
  const data = await postJson("/api/names", { items }, options);
  const raw =
    typeof data.names === "object" && data.names !== null && !Array.isArray(data.names)
      ? (data.names as Record<string, JsonValue>)
      : {};
  const names: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    names[key] = typeof value === "string" ? value : null;
  }
  return { names };
}
