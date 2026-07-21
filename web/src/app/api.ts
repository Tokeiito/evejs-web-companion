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
  IndustryActivity,
  InventoryPlace,
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

// --- R14 Inventory depth + corporation hangars ------------------------------
// The browser names a PLACE — the hangar, the ship's cargo, a container, a
// corporation division by its ordinal — and the BFF maps that to the retail
// flagIDs. No flag number is ever sent from here.

/**
 * What a mutation ACTUALLY did, re-read by the BFF after the call. invbroker
 * declines silently in several branches (a source location that no longer
 * matches, no room, a division the character cannot take from): it returns null
 * WITHOUT raising, so a 200 is not proof anything moved. `declinedSilently`
 * means the server refused and gave no reason — which is reported as exactly
 * that rather than dressed up as a cause.
 */
export interface TransferResult {
  readonly applied: boolean;
  readonly moved: readonly number[];
  readonly declined: readonly number[];
  readonly declinedSilently: boolean;
  readonly notFound: readonly number[];
}

function asNumberList(value: JsonValue | undefined): readonly number[] {
  return Array.isArray(value) ? value.map((entry) => Number(entry) || 0).filter((id) => id > 0) : [];
}

/**
 * Move items between any two places. One call carries them all, because they
 * are the same retail call with different arguments: a single item with a
 * `qty` is a SPLIT (a partial-quantity Add), several items are one MultiAdd.
 */
export async function transferItems(
  itemIDs: readonly number[],
  from: InventoryPlace,
  to: InventoryPlace,
  qty: number | null = null,
  options: ApiOptions = {},
): Promise<TransferResult> {
  const body: Record<string, JsonValue> = {
    itemIDs: [...itemIDs],
    from: from as unknown as JsonValue,
    to: to as unknown as JsonValue,
  };
  if (qty !== null) {
    body.qty = qty;
  }
  const data = await postJson("/api/bridge/inventory/transfer", body, options);
  return {
    applied: data.applied === true,
    moved: asNumberList(data.moved),
    declined: asNumberList(data.declined),
    declinedSilently: data.declinedSilently === true,
    notFound: asNumberList(data.notFound),
  };
}

export interface MergeResult {
  readonly applied: boolean;
  readonly merged: number;
  readonly declinedSilently: boolean;
}

/** Re-merge one stack into another of the same type (drag-onto-stack). */
export async function mergeStacks(
  sourceItemID: number,
  destinationItemID: number,
  place: InventoryPlace,
  qty: number | null = null,
  options: ApiOptions = {},
): Promise<MergeResult> {
  const body: Record<string, JsonValue> = {
    sourceItemID,
    destinationItemID,
    place: place as unknown as JsonValue,
  };
  if (qty !== null) {
    body.qty = qty;
  }
  const data = await postJson("/api/bridge/inventory/merge", body, options);
  return {
    applied: data.applied === true,
    merged: Number(data.merged) || 0,
    declinedSilently: data.declinedSilently === true,
  };
}

export interface TrashResult {
  readonly applied: boolean;
  readonly destroyed: readonly number[];
  readonly survived: readonly number[];
  readonly declinedSilently: boolean;
}

/**
 * DESTROY items. Irreversible, so the BFF refuses outright without `confirm`,
 * and the UI asks first — this flag is the second gate behind that, exactly as
 * the rig destroy is fenced.
 */
export async function trashItems(
  itemIDs: readonly number[],
  place: InventoryPlace,
  options: ApiOptions = {},
): Promise<TrashResult> {
  const data = await postJson(
    "/api/bridge/inventory/trash",
    { itemIDs: [...itemIDs], place: place as unknown as JsonValue, confirm: true },
    options,
  );
  return {
    applied: data.applied === true,
    destroyed: asNumberList(data.destroyed),
    survived: asNumberList(data.survived),
    declinedSilently: data.declinedSilently === true,
  };
}

export interface RawContainerReads {
  readonly containerID: number;
  readonly list: JsonValue;
  readonly capacity: JsonValue;
}

/** Open a container and read its contents. */
export async function openContainer(
  containerID: number,
  options: ApiOptions = {},
): Promise<RawContainerReads> {
  const data = await getJson(`/api/bridge/inventory/container/${containerID}`, options);
  return {
    containerID: asNumberOrNull(data.containerID) ?? containerID,
    list: data.list ?? null,
    capacity: data.capacity ?? null,
  };
}

/** A ship's bays as the BFF reports them (goal R40); still to be decoded. */
export interface RawShipBaysResult {
  readonly shipID: number;
  readonly bays: JsonValue;
}

/**
 * Read which bays a ship has, how full each is, and what is in it. Works for
 * ANY ship the character can see — the one they are flying and the ones sitting
 * in the hangar alike.
 */
export async function getShipBays(
  shipID: number,
  options: ApiOptions = {},
): Promise<RawShipBaysResult> {
  const data = await getJson(`/api/bridge/ship/${shipID}/bays`, options);
  return {
    shipID: asNumberOrNull(data.shipID) ?? shipID,
    bays: data.bays ?? null,
  };
}

/** One corporation hangar division as the BFF reports it (rows still raw). */
export interface RawCorpDivision {
  readonly division: number;
  readonly name: string | null;
  readonly list: JsonValue;
  readonly error: string | null;
}

export interface RawCorpHangar {
  readonly available: boolean;
  readonly reason: string | null;
  readonly divisions: readonly RawCorpDivision[];
}

/**
 * Read the corporation hangar at the docked station: which divisions exist,
 * what they are CALLED, and what is in each. A division the character lacks
 * the query role for simply reads empty — the server filters it, and that
 * filtering is the authority (the UI's own greying-out is cosmetic).
 */
export async function loadCorpHangar(options: ApiOptions = {}): Promise<RawCorpHangar> {
  const data = await getJson("/api/bridge/inventory/corp", options);
  const divisions = Array.isArray(data.divisions) ? data.divisions : [];
  return {
    available: data.available === true,
    reason: typeof data.reason === "string" ? data.reason : null,
    divisions: divisions.map((entry) => {
      const row = (entry ?? {}) as Record<string, JsonValue>;
      return {
        division: Number(row.division) || 0,
        name: typeof row.name === "string" && row.name !== "" ? row.name : null,
        list: row.list ?? null,
        error: typeof row.error === "string" ? row.error : null,
      };
    }),
  };
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

// --- R15 Industry ----------------------------------------------------------
// Industry needs no bound-object machinery: the whole retail surface is
// top-level, so the BFF simply issues five independent calls and hands back
// their raw retail-shaped results, decoded in the flow with bridge/industry.ts.
// Names and recipes come separately from static data, which never varies by
// player and so never needs the live session at all.

/** One of the five industry reads, with its own error (they are independent). */
export interface RawIndustryRead {
  readonly result: JsonValue;
  readonly error: string | null;
}

export interface RawIndustryReads {
  readonly ownerID: number | null;
  readonly stationID: number | null;
  readonly solarSystemID: number | null;
  readonly blueprints: RawIndustryRead;
  readonly jobs: RawIndustryRead;
  readonly jobCounts: RawIndustryRead;
  readonly facilities: RawIndustryRead;
  readonly activityModifiers: RawIndustryRead;
}

function asIndustryRead(value: JsonValue | undefined): RawIndustryRead {
  const row = (value ?? {}) as Record<string, JsonValue>;
  return {
    result: row.result ?? null,
    error: typeof row.error === "string" ? row.error : null,
  };
}

/** Read the player's blueprints, jobs, job slots, and available facilities. */
export async function loadIndustry(options: ApiOptions = {}): Promise<RawIndustryReads> {
  const data = await getJson("/api/bridge/industry", options);
  return {
    ownerID: asNumberOrNull(data.ownerID),
    stationID: asNumberOrNull(data.stationID),
    solarSystemID: asNumberOrNull(data.solarSystemID),
    blueprints: asIndustryRead(data.blueprints),
    jobs: asIndustryRead(data.jobs),
    jobCounts: asIndustryRead(data.jobCounts),
    facilities: asIndustryRead(data.facilities),
    activityModifiers: asIndustryRead(data.activityModifiers),
  };
}

/**
 * The static recipes for a set of blueprint types: which activities each one
 * supports, what they consume, and how long they take. Read-only reference
 * data — no live session is involved, so this survives a lost bridge session.
 */
export async function loadIndustryDefinitions(
  blueprintTypeIDs: readonly number[],
  options: ApiOptions = {},
): Promise<Readonly<Record<string, JsonValue>>> {
  if (blueprintTypeIDs.length === 0) {
    return {};
  }
  const data = await postJson(
    "/api/industry/blueprints",
    { blueprintTypeIDs: [...blueprintTypeIDs] },
    options,
  );
  const definitions = data.definitions;
  return typeof definitions === "object" && definitions !== null && !Array.isArray(definitions)
    ? (definitions as Readonly<Record<string, JsonValue>>)
    : {};
}

/** What an install would draw on: the request the preview and the install share. */
export interface IndustryJobRequest {
  readonly blueprintItemID: number;
  readonly blueprintTypeID: number;
  /** An activity NAME. The activityID lives only on the BFF. */
  readonly activity: IndustryActivity;
  readonly facilityID: number;
  readonly runs: number;
  readonly licensedRuns?: number;
  readonly productTypeID?: number;
}

export interface IndustryPreviewResult {
  /** typeID -> how much of it the player HAS at the input hangar (server-read). */
  readonly available: Readonly<Record<string, number>>;
}

/**
 * What the player HAS of each material the job would consume, from the
 * server's own preview seam. The installation FEE is deliberately absent: no
 * allowlisted retail call quotes a cost without also installing the job, so the
 * panel says so rather than showing an invented estimate.
 */
export async function previewIndustryJob(
  request: IndustryJobRequest,
  options: ApiOptions = {},
): Promise<IndustryPreviewResult> {
  const data = await postJson(
    "/api/bridge/industry/preview",
    { ...request } as unknown as Record<string, JsonValue>,
    options,
  );
  const available = data.available;
  const normalized: Record<string, number> = {};
  if (typeof available === "object" && available !== null && !Array.isArray(available)) {
    for (const [typeID, quantity] of Object.entries(available)) {
      normalized[typeID] = Number(quantity) || 0;
    }
  }
  return { available: normalized };
}

/**
 * An industry mutation's outcome. `applied` is the BFF's RE-READ of the job
 * after the call, never an echo of the request — the R12/R14 lesson.
 */
export interface IndustryChangeResult {
  readonly applied: boolean;
  readonly declinedSilently: boolean;
  readonly jobID: number | null;
  /** The re-read job row (raw; decoded by bridge/industry.ts). */
  readonly job: JsonValue;
}

function asIndustryChange(data: Record<string, JsonValue>): IndustryChangeResult {
  return {
    applied: data.applied === true,
    declinedSilently: data.declinedSilently === true,
    jobID: asNumberOrNull(data.jobID),
    job: data.job ?? null,
  };
}

/**
 * INSTALL a job. This spends materials and charges an installation fee, so the
 * BFF refuses the route outright without `confirm`. The UI asks first; this
 * flag is the second gate behind that, exactly as `trashItems` and `destroyRig`
 * are fenced.
 */
export async function installIndustryJob(
  request: IndustryJobRequest,
  options: ApiOptions = {},
): Promise<IndustryChangeResult> {
  const data = await postJson(
    "/api/bridge/industry/install",
    { ...request, confirm: true } as unknown as Record<string, JsonValue>,
    options,
  );
  return asIndustryChange(data);
}

/** DELIVER a finished job — the retail `CompleteJob`. Only ever gives. */
export async function deliverIndustryJob(
  jobID: number,
  options: ApiOptions = {},
): Promise<IndustryChangeResult> {
  const data = await postJson("/api/bridge/industry/deliver", { jobID }, options);
  return asIndustryChange(data);
}

/**
 * CANCEL a job. The materials and the installation fee are NOT returned, so
 * the BFF refuses without `confirm` and the UI says what will be lost first.
 */
export async function cancelIndustryJob(
  jobID: number,
  options: ApiOptions = {},
): Promise<IndustryChangeResult> {
  const data = await postJson(
    "/api/bridge/industry/cancel",
    { jobID, confirm: true },
    options,
  );
  return asIndustryChange(data);
}

// --- R16 Market ------------------------------------------------------------
// Like industry, the whole retail market surface is top-level, so the BFF
// issues independent calls and hands back their raw retail-shaped results,
// decoded in the flow with bridge/market.ts. All of it is `marketProxy` — the
// `market` service is a dead stub (see src/server.js) — and the sorting /
// filtering / best-price logic is CLIENT-side, because in retail it is too.

/** One market read, with its own error (they are independent). */
export interface RawMarketRead {
  readonly result: JsonValue;
  readonly error: string | null;
}

export interface RawMarketReads {
  readonly typeID: number | null;
  readonly characterID: number | null;
  readonly stationID: number | null;
  readonly solarSystemID: number | null;
  readonly book: RawMarketRead;
  readonly ownOrders: RawMarketRead;
  readonly orderHistory: RawMarketRead;
  readonly transactions: RawMarketRead;
  readonly escrow: RawMarketRead;
  readonly cashBalance: RawMarketRead;
  readonly priceHistory: RawMarketRead;
  /** Non-null when the market DAEMON is not answering (≠ "no orders"). */
  readonly marketUnavailable: string | null;
}

function asMarketRead(value: JsonValue | undefined): RawMarketRead {
  const row = (value ?? {}) as Record<string, JsonValue>;
  return {
    result: row.result ?? null,
    error: typeof row.error === "string" ? row.error : null,
  };
}

/**
 * Read the market: an item's order book (when a type is chosen), the player's
 * own orders, their closed-order history, their trades, their escrow, their
 * price history and their ISK.
 */
export async function loadMarket(
  typeID: number | null,
  options: ApiOptions = {},
): Promise<RawMarketReads> {
  const query = typeID && typeID > 0 ? `?typeID=${encodeURIComponent(String(typeID))}` : "";
  const data = await getJson(`/api/bridge/market${query}`, options);
  return {
    typeID: asNumberOrNull(data.typeID),
    characterID: asNumberOrNull(data.characterID),
    stationID: asNumberOrNull(data.stationID),
    solarSystemID: asNumberOrNull(data.solarSystemID),
    book: asMarketRead(data.book),
    ownOrders: asMarketRead(data.ownOrders),
    orderHistory: asMarketRead(data.orderHistory),
    transactions: asMarketRead(data.transactions),
    escrow: asMarketRead(data.escrow),
    cashBalance: asMarketRead(data.cashBalance),
    priceHistory: asMarketRead(data.priceHistory),
    marketUnavailable:
      typeof data.marketUnavailable === "string" ? data.marketUnavailable : null,
  };
}

/**
 * What a market write ACTUALLY did.
 *
 * ⚠ `applied` is the BFF's RE-READ (of the wallet, of the player's own orders),
 * never an echo of the request — the R12/R14/R15 lesson. ⚠ `charged` is the
 * wallet balance BEFORE minus the balance AFTER: the only authoritative
 * statement about what an order cost. The estimated broker fee the confirm step
 * showed never appears here, and is never compared against this.
 */
export interface MarketChangeResult {
  readonly applied: boolean;
  readonly declinedSilently: boolean;
  /** ISK taken (positive) or returned (negative), as a decimal string. */
  readonly charged: string | null;
  readonly balanceAfter: string | null;
  /** The re-read own-orders rowset (raw; decoded by bridge/market.ts). */
  readonly ownOrders: JsonValue;
}

function asMarketChange(data: Record<string, JsonValue>): MarketChangeResult {
  return {
    applied: data.applied === true,
    declinedSilently: data.declinedSilently === true,
    charged: typeof data.charged === "string" ? data.charged : null,
    balanceAfter: typeof data.balanceAfter === "string" ? data.balanceAfter : null,
    ownOrders: data.ownOrders ?? null,
  };
}

/** What the browser sends to place an order. Prices are already rounded. */
export interface MarketBuyRequest {
  readonly typeID: number;
  readonly price: number;
  readonly quantity: number;
  readonly durationDays: number;
}

export interface MarketSellRequest {
  /** The specific STACK being sold — selling is item-based, not type-based. */
  readonly itemID: number;
  readonly typeID: number;
  readonly price: number;
  readonly quantity: number;
  readonly durationDays: number;
}

/**
 * PLACE A BUY ORDER. Sets ISK aside immediately and charges a broker's fee, so
 * the BFF refuses the route outright without `confirm`. The UI asks first; this
 * flag is the second gate behind that.
 */
export async function placeMarketBuyOrder(
  request: MarketBuyRequest,
  options: ApiOptions = {},
): Promise<MarketChangeResult> {
  const data = await postJson(
    "/api/bridge/market/buy",
    { ...request, confirm: true } as unknown as Record<string, JsonValue>,
    options,
  );
  return asMarketChange(data);
}

/** PLACE A SELL ORDER. Hands the goods over and charges a broker's fee. */
export async function placeMarketSellOrder(
  request: MarketSellRequest,
  options: ApiOptions = {},
): Promise<MarketChangeResult> {
  const data = await postJson(
    "/api/bridge/market/sell",
    { ...request, confirm: true } as unknown as Record<string, JsonValue>,
    options,
  );
  return asMarketChange(data);
}

/**
 * CANCEL an order. Returns what it was holding; the broker's fee already paid
 * is NOT returned, which is why the UI says so before asking.
 */
export async function cancelMarketOrder(
  orderID: string,
  options: ApiOptions = {},
): Promise<MarketChangeResult> {
  const data = await postJson("/api/bridge/market/cancel", { orderID, confirm: true }, options);
  return asMarketChange(data);
}

/** CHANGE an order's price. Charges a fee, and moves a buy order's escrow. */
export async function modifyMarketOrder(
  orderID: string,
  price: number,
  options: ApiOptions = {},
): Promise<MarketChangeResult> {
  const data = await postJson(
    "/api/bridge/market/modify",
    { orderID, price, confirm: true },
    options,
  );
  return asMarketChange(data);
}

// --- R17 Mail ---------------------------------------------------------------
// The BFF cold-starts the delta sync and hands back the RAW retail-shaped
// arms, decoded in the flow with bridge/mail.ts — except the message BODY,
// which arrives as plain TEXT because mailMgr.GetBody answers a zlib-DEFLATED
// buffer and the BFF inflates it. The browser never handles a compressed byte.

export interface RawMailInbox {
  readonly characterID: number | null;
  /** The raw SyncMail answer: {newMail, oldMail, mailStatus}. */
  readonly sync: JsonValue;
  /** Raw GetMailHeaders rows, when a status row had no header; else null. */
  readonly backfill: JsonValue;
  readonly unreadCount: number;
}

export async function loadMail(options: ApiOptions = {}): Promise<RawMailInbox> {
  const data = await getJson("/api/bridge/mail", options);
  return {
    characterID: asNumberOrNull(data.characterID),
    sync: data.sync ?? null,
    backfill: data.backfill ?? null,
    unreadCount: Number(data.unreadCount) || 0,
  };
}

export interface MailBodyResult {
  readonly messageID: number;
  /** ⚠ Already inflated by the BFF — plain text, never compressed bytes. */
  readonly body: string | null;
  /** True when the body arrived but would not inflate. */
  readonly unreadable: boolean;
  /** From a RE-READ after opening; null when that re-read failed. */
  readonly markedRead: boolean | null;
  readonly unreadCount: number | null;
}

export async function loadMailBody(
  messageID: number,
  markRead: boolean,
  options: ApiOptions = {},
): Promise<MailBodyResult> {
  const query = `?messageID=${encodeURIComponent(String(messageID))}${markRead ? "&markRead=1" : ""}`;
  const data = await getJson(`/api/bridge/mail/body${query}`, options);
  return {
    messageID: Number(data.messageID) || messageID,
    body: typeof data.body === "string" ? data.body : null,
    unreadable: data.unreadable === true,
    markedRead: typeof data.markedRead === "boolean" ? data.markedRead : null,
    unreadCount: asNumberOrNull(data.unreadCount),
  };
}

export interface MailSendRequest {
  /** ⚠ A LIST on the way in, even though headers read it back as a string. */
  readonly toCharacterIDs: readonly number[];
  readonly title: string;
  readonly body: string;
}

export interface MailSendResult {
  /** Did the message really land? From the sender-copy re-read, not the 200. */
  readonly applied: boolean;
  /** True when the server answered success and wrote nothing. */
  readonly declinedSilently: boolean;
  readonly messageID: number | null;
  readonly unreadCount: number | null;
  readonly recipientCount: number;
  /** What the server said when it declined without a reason. */
  readonly message: string | null;
}

/**
 * Send mail. No `confirm` gate, unlike R12/R14/R15/R16: nothing is spent and
 * nothing is deleted. The BFF still refuses an empty recipient list, because
 * the SERVER cannot — its NO_RECIPIENTS guard can never fire through the
 * gateway, so mail to nobody would be written and would look sent.
 */
export async function sendMail(
  request: MailSendRequest,
  options: ApiOptions = {},
): Promise<MailSendResult> {
  const data = await postJson(
    "/api/bridge/mail/send",
    request as unknown as Record<string, JsonValue>,
    options,
  );
  return {
    applied: data.applied === true,
    declinedSilently: data.declinedSilently === true,
    messageID: asNumberOrNull(data.messageID),
    unreadCount: asNumberOrNull(data.unreadCount),
    recipientCount: Number(data.recipientCount) || 0,
    message: typeof data.message === "string" ? data.message : null,
  };
}

// --- R17 Contracts ----------------------------------------------------------
// READS ONLY. Every contract mutator is refused at the gateway, so there is no
// write surface here. The BFF issues five independent reads and hands back
// their raw retail-shaped results, decoded in the flow with
// bridge/contracts.ts.

export interface RawContractRead {
  readonly result: JsonValue;
  readonly error: string | null;
}

export interface RawContractReads {
  readonly characterID: number | null;
  readonly page: number;
  readonly pageSize: number;
  readonly browse: RawContractRead;
  readonly outstanding: RawContractRead;
  readonly accepted: RawContractRead;
  readonly expired: RawContractRead;
  readonly summary: RawContractRead;
  /**
   * ⚠ True ONLY when the browse SUCCEEDED and found nothing. EveJS has no
   * NPC/seed contract generator, so an empty public browse is EXPECTED — but
   * "the browse failed" and "this world has no contracts yet" are different
   * facts and the panel must never confuse them.
   */
  readonly worldHasNoContracts: boolean;
}

function asContractRead(value: JsonValue | undefined): RawContractRead {
  const row = (value ?? {}) as Record<string, JsonValue>;
  return {
    result: row.result ?? null,
    error: typeof row.error === "string" ? row.error : null,
  };
}

export async function loadContracts(
  page: number,
  options: ApiOptions = {},
): Promise<RawContractReads> {
  const query = page > 0 ? `?page=${encodeURIComponent(String(page))}` : "";
  const data = await getJson(`/api/bridge/contracts${query}`, options);
  return {
    characterID: asNumberOrNull(data.characterID),
    page: Number(data.page) || 0,
    pageSize: Number(data.pageSize) || 100,
    browse: asContractRead(data.browse),
    outstanding: asContractRead(data.outstanding),
    accepted: asContractRead(data.accepted),
    expired: asContractRead(data.expired),
    summary: asContractRead(data.summary),
    worldHasNoContracts: data.worldHasNoContracts === true,
  };
}

/** One contract in full. */
export async function loadContractDetail(
  contractID: number,
  options: ApiOptions = {},
): Promise<JsonValue> {
  const data = await getJson(
    `/api/bridge/contracts/detail?contractID=${encodeURIComponent(String(contractID))}`,
    options,
  );
  return data.detail ?? null;
}

// --- R37 Personal Assets ----------------------------------------------------
// READS ONLY. Raw retail shapes out; decoding is bridge/personalAssets.ts's
// job, as everywhere else.

export interface RawAssetStations {
  readonly characterID: number | null;
  /** charMgr.ListStations' CRowset, untouched. null when the read failed. */
  readonly stations: JsonValue;
  /** ⚠ True ONLY when the read SUCCEEDED and was empty. */
  readonly ownsNothing: boolean;
  readonly error: string | null;
}

export interface RawAssetStationItems {
  readonly stationID: number;
  /** charMgr.ListStationItems' list, untouched. null when the read failed. */
  readonly items: JsonValue;
  /** Per-type m³ from static data; a type it does not know is simply absent. */
  readonly volumes: Readonly<Record<string, number>>;
  readonly hasNoItems: boolean;
  readonly error: string | null;
}

/** Every station holding this character's items. */
export async function loadAssetStations(
  options: ApiOptions = {},
): Promise<RawAssetStations> {
  const data = await getJson("/api/bridge/assets", options);
  return {
    characterID: asNumberOrNull(data.characterID),
    stations: data.stations ?? null,
    ownsNothing: data.ownsNothing === true,
    error: typeof data.error === "string" ? data.error : null,
  };
}

/** What is at one of them. */
export async function loadAssetStationItems(
  stationID: number,
  options: ApiOptions = {},
): Promise<RawAssetStationItems> {
  const data = await getJson(
    `/api/bridge/assets/station?stationID=${encodeURIComponent(String(stationID))}`,
    options,
  );
  const volumes =
    data.volumes && typeof data.volumes === "object" && !Array.isArray(data.volumes)
      ? (data.volumes as Record<string, number>)
      : {};
  return {
    stationID: Number(data.stationID) || stationID,
    items: data.items ?? null,
    volumes,
    hasNoItems: data.hasNoItems === true,
    error: typeof data.error === "string" ? data.error : null,
  };
}

/** One person match from /api/characters/find. */
export interface CharacterMatch {
  readonly characterID: number;
  readonly name: string;
}

/**
 * Find someone to write to, by NAME. ⚠ The one place the names rule runs
 * backwards (see the route): the player types a name, the panel carries the id
 * invisibly, and no numeric ID is ever shown.
 */
export async function findCharacters(
  q: string,
  options: ApiOptions = {},
): Promise<readonly CharacterMatch[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return [];
  }
  const data = await getJson(`/api/characters/find?q=${encodeURIComponent(trimmed)}`, options);
  return Array.isArray(data.matches)
    ? (data.matches as unknown as readonly CharacterMatch[])
    : [];
}

/** One tradable-item match from /api/market/find. */
export interface MarketTypeMatch {
  readonly typeID: number;
  readonly name: string;
  readonly groupName: string;
}

/**
 * Search tradable items by NAME. Static reference data, so it works before the
 * market itself answers — and it is the only way the panel ever obtains a
 * typeID, because the player must never be asked for one (R7d).
 */
export async function findMarketTypes(
  q: string,
  options: ApiOptions = {},
): Promise<readonly MarketTypeMatch[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    return [];
  }
  const data = await getJson(
    `/api/market/find?q=${encodeURIComponent(trimmed)}`,
    options,
  );
  return Array.isArray(data.matches)
    ? (data.matches as unknown as readonly MarketTypeMatch[])
    : [];
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

// --- R23 slice A: targeting + module activation -----------------------------
//
// THE GENERIC IN-SPACE ACTION LAYER. Nothing here names mining, combat,
// salvaging or ewar. A target is a target; a module is a module; the effect
// name is an argument the caller supplies (or omits, in which case the SERVER
// resolves the module's own default activation effect from its typeID — the
// browser never guesses which effect a module runs). Slice B drives a mining
// laser through these five functions; a later combat goal drives a turret
// through the same five unchanged.

/** What the server says is locked right now — the only authority. */
export interface TargetsResult {
  readonly targetIDs: JsonValue;
  readonly notifications: readonly JsonValue[];
}

/**
 * One lock/unlock outcome. Both flags come from a RE-READ of GetTargets after
 * the mutation, never from the mutation's own 200.
 *
 * `locked`  — the lock has landed and the target is usable.
 * `acquiring` — the server accepted the attempt and is still acquiring it.
 * `released` — it is no longer locked (the unlock answer).
 */
export interface TargetActionResult {
  readonly targetID: number;
  readonly locked: boolean;
  readonly acquiring: boolean;
  readonly released: boolean;
  readonly targetIDs: JsonValue;
  readonly notifications: readonly JsonValue[];
}

/**
 * One module activate/deactivate outcome, verified against the space snapshot's
 * activeModuleIDs. `active` / `stopped` are NULL when the snapshot could not
 * answer — "unknown", never "off".
 */
export interface ModuleActionResult {
  readonly itemID: number;
  readonly active: boolean | null;
  readonly stopped: boolean | null;
  readonly activeModuleIDs: JsonValue;
  readonly notifications: readonly JsonValue[];
}

function readNotifications(data: Record<string, JsonValue>): readonly JsonValue[] {
  return Array.isArray(data.notifications) ? data.notifications : [];
}

/** Read the locked-target list (dogmaIM.GetTargets). */
export async function getTargets(options: ApiOptions = {}): Promise<TargetsResult> {
  const data = await getJson("/api/bridge/targets", options);
  return { targetIDs: data.targetIDs ?? null, notifications: readNotifications(data) };
}

/** Lock a target (dogmaIM.AddTarget). Acquisition is not instant. */
export async function lockTarget(
  targetID: number,
  options: ApiOptions = {},
): Promise<TargetActionResult> {
  const data = await postJson("/api/bridge/targets/lock", { targetID }, options);
  return {
    targetID,
    locked: data.locked === true,
    acquiring: data.acquiring === true,
    released: false,
    targetIDs: data.targetIDs ?? null,
    notifications: readNotifications(data),
  };
}

/**
 * Release ONE lock (dogmaIM.RemoveTarget, preceded by CancelAddTarget so the
 * same button also abandons a lock that is still being acquired). The bulk
 * verbs are not on the gateway allowlist at all, so a stray click here can only
 * ever cost one lock.
 */
export async function unlockTarget(
  targetID: number,
  options: ApiOptions = {},
): Promise<TargetActionResult> {
  const data = await postJson("/api/bridge/targets/unlock", { targetID }, options);
  return {
    targetID,
    locked: false,
    acquiring: false,
    released: data.released === true,
    targetIDs: data.targetIDs ?? null,
    notifications: readNotifications(data),
  };
}

function readModuleAction(itemID: number, data: Record<string, JsonValue>): ModuleActionResult {
  return {
    itemID,
    active: typeof data.active === "boolean" ? data.active : null,
    stopped: typeof data.stopped === "boolean" ? data.stopped : null,
    activeModuleIDs: data.activeModuleIDs ?? null,
    notifications: readNotifications(data),
  };
}

/**
 * Switch a module on (dogmaIM.Activate).
 *
 * `effect` is optional BY DESIGN: omit it and the server resolves the module's
 * own default activation effect. `repeat` is retail's cycle flag — -1 keeps
 * cycling (the default), 0 runs a single cycle. `targetID` is omitted for
 * modules that act on the ship itself.
 */
export async function activateModule(
  itemID: number,
  opts: { effect?: string; targetID?: number | null; repeat?: -1 | 0 } = {},
  options: ApiOptions = {},
): Promise<ModuleActionResult> {
  const body: Record<string, JsonValue> = { itemID };
  if (opts.effect) {
    body.effect = opts.effect;
  }
  if (opts.targetID) {
    body.targetID = opts.targetID;
  }
  if (opts.repeat === 0) {
    body.repeat = 0;
  }
  return readModuleAction(itemID, await postJson("/api/bridge/modules/activate", body, options));
}

/** Switch a module off (dogmaIM.Deactivate). */
export async function deactivateModule(
  itemID: number,
  opts: { effect?: string } = {},
  options: ApiOptions = {},
): Promise<ModuleActionResult> {
  const body: Record<string, JsonValue> = { itemID };
  if (opts.effect) {
    body.effect = opts.effect;
  }
  return readModuleAction(itemID, await postJson("/api/bridge/modules/deactivate", body, options));
}

// --- R23 slice B: the mining loop -------------------------------------------
//
// mine -> haul -> refine -> sell. There is no "start mining" call here and no
// mining cycle: mining a rock IS the generic lockTarget + activateModule above
// with a mining laser, flying to the belt is warpTo/orbit, and selling the
// minerals is the market functions. These five are only what was missing — a
// place to see the ore, a way to get it home, the scanner, and the refinery.

/** The ship's mining holds, each already named by the BFF (never a flagID). */
export interface MiningHoldsResult {
  readonly activeShipID: number | null;
  readonly holds: JsonValue;
}

/** What the scanner saw: `[[entityID, yieldTypeID, remainingQuantity]]`. */
export interface SurveyScanResult {
  readonly results: JsonValue;
  readonly notifications: readonly JsonValue[];
}

/** The refinery's quote, with the station's ISK TAX RATE reported separately. */
export interface ReprocessingQuoteResult {
  readonly stationID: number | null;
  readonly taxRate: JsonValue;
  readonly quotes: JsonValue;
}

/**
 * What an unload or a reprocess ACTUALLY did, verified by re-reading. `moved` /
 * `processed` are null when the verification read itself failed — "we could not
 * check", which the page reports as such and never as success.
 */
export interface MiningActionResult {
  readonly requested: readonly number[];
  readonly moved: readonly number[] | null;
  readonly remaining: readonly number[] | null;
  readonly notifications: readonly JsonValue[];
}

function readIDArray(value: JsonValue | undefined): readonly number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((entry) => Number(entry) || 0).filter((entry) => entry > 0);
}

/** Read the ship's ore / gas / ice holds (falling back to cargo). */
export async function getMiningHolds(options: ApiOptions = {}): Promise<MiningHoldsResult> {
  const data = await getJson("/api/bridge/ship/ore-hold", options);
  return {
    activeShipID: Number(data.activeShipID) || null,
    holds: data.holds ?? null,
  };
}

/** Move mined ore from the ship's holds into the station hangar (docked only). */
export async function unloadMiningHolds(
  itemIDs: readonly number[],
  options: ApiOptions = {},
): Promise<MiningActionResult> {
  const data = await postJson(
    "/api/bridge/ship/ore-hold/unload",
    { itemIDs: [...itemIDs] },
    options,
  );
  return {
    requested: readIDArray(data.requested) ?? [],
    moved: readIDArray(data.moved),
    remaining: readIDArray(data.remaining),
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
  };
}

/** Run the survey scanner (miningScanMgr.perform_scan). Read-only. */
export async function runSurveyScan(options: ApiOptions = {}): Promise<SurveyScanResult> {
  const data = await getJson("/api/bridge/mining/scan", options);
  return {
    results: data.results ?? null,
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
  };
}

/**
 * Ask the station's refinery what these stacks WOULD yield, and what it will
 * take. A pure read: nothing is consumed and no ISK is charged by this call.
 */
export async function getReprocessingQuote(
  itemIDs: readonly number[],
  options: ApiOptions = {},
): Promise<ReprocessingQuoteResult> {
  const query = encodeURIComponent(itemIDs.join(","));
  const data = await getJson(`/api/bridge/reprocessing/quote?itemIDs=${query}`, options);
  return {
    stationID: Number(data.stationID) || null,
    taxRate: data.taxRate ?? null,
    quotes: data.quotes ?? null,
  };
}

/**
 * ⚠ REPROCESS. This CONSUMES the chosen stacks and CHARGES the station's ISK
 * tax, so the BFF refuses it outright unless `confirm` is true. The panel asks
 * first — showing the quote and the tax — and this flag is the second gate
 * behind that, exactly as destroyRig does for a rig.
 */
export async function reprocessItems(
  itemIDs: readonly number[],
  options: ApiOptions = {},
): Promise<MiningActionResult> {
  const data = await postJson(
    "/api/bridge/reprocessing/reprocess",
    { itemIDs: [...itemIDs], confirm: true },
    options,
  );
  return {
    requested: readIDArray(data.requested) ?? [],
    moved: readIDArray(data.processed),
    remaining: readIDArray(data.remaining),
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

/**
 * A destination resolved to its solar system — a station or system from static
 * reference data, or (R38) a player-owned structure from the live world.
 */
export interface ResolvedDestination {
  readonly id: number;
  readonly kind: "station" | "system" | "structure" | "unknown";
  readonly solarSystemID: number | null;
  readonly systemName: string | null;
  readonly stationID: number | null;
  readonly stationName: string | null;
  /**
   * R38 — true when this came back `unknown` because a player-structure lookup
   * could not be completed, rather than because nothing bears the ID. A caller
   * must not cache the miss when this is set.
   */
  readonly lookupFailed: boolean;
}

/**
 * Resolve a picked destination ID to its solar system (a courier destination is
 * a station; the route solver works on systems).
 *
 * R38 — mostly static reference data, but a player-owned structure is a legal
 * destination that exists only at runtime, so the route answers `kind:"structure"`
 * for one. The structure's name and system are echoed into `stationName` /
 * `stationID` as well, because a structure IS a dockable place and every
 * existing caller already reads those fields; a caller that needs to tell the
 * two apart reads `kind`.
 */
export async function resolveDestination(
  id: number,
  options: ApiOptions = {},
): Promise<ResolvedDestination> {
  const data = await getJson(`/api/map/resolve/${id}`, options);
  return {
    id,
    kind:
      data.kind === "station" || data.kind === "system" || data.kind === "structure"
        ? data.kind
        : "unknown",
    solarSystemID: asNumberOrNull(data.solarSystemID),
    systemName: typeof data.systemName === "string" ? data.systemName : null,
    stationID: asNumberOrNull(data.stationID),
    stationName: typeof data.stationName === "string" ? data.stationName : null,
    lookupFailed: data.lookupFailed === true,
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
  /**
   * R38 — keys whose lookup could NOT be completed (no character online, a
   * gateway error, or past the per-request structure cap).
   *
   * ⚠ NOT THE SAME AS A null IN `names`. A null there is the server's definite
   * finding that nothing bears that ID; a key listed here means the question
   * was never answered. The name cache must not store these, or one lookup
   * failure would pin a place to its fallback for the rest of the session.
   */
  readonly unresolved: readonly string[];
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
  const unresolved = Array.isArray(data.unresolved)
    ? (data.unresolved as JsonValue[]).filter(
        (key): key is string => typeof key === "string",
      )
    : [];
  return { names, unresolved };
}

// --- R24 slice C: module cycle times (static reference data) ----------------
// POST /api/types/cycle-times takes { typeIDs } and returns { baseCycleMs }.
// Read-only static data over attribute 73 (`duration`) — like /api/names, NOT a
// gateway/bridge call. The wire name says `base` because that is what it is:
// the type's duration before skills, bonuses, rigs or heat. Where the server
// has pushed a real cycle event, THAT figure wins.

export interface CycleTimesResult {
  /** typeID -> milliseconds, or null where the type has no duration at all. */
  readonly baseCycleMs: Readonly<Record<number, number | null>>;
}

export async function loadBaseCycleTimes(
  typeIDs: readonly number[],
  options: ApiOptions = {},
): Promise<CycleTimesResult> {
  const data = await getJson(
    `/api/types/cycle-times?typeIDs=${encodeURIComponent(typeIDs.join(","))}`,
    options,
  );
  const raw =
    typeof data.baseCycleMs === "object" && data.baseCycleMs !== null && !Array.isArray(data.baseCycleMs)
      ? (data.baseCycleMs as Record<string, JsonValue>)
      : {};
  const baseCycleMs: Record<number, number | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    const typeID = Number(key) || 0;
    if (typeID <= 0) {
      continue;
    }
    const ms = Number(value);
    baseCycleMs[typeID] = Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  return { baseCycleMs };
}

// --- R25 slice A: drones -----------------------------------------------------
//
// Four routes, and NOT ONE of them can be trusted on its own return value. The
// server's launch handler answers 200 with an empty dict when it refuses, and
// all three entity orders answer an empty dict on SUCCESS and error tuples
// otherwise. So every function below reports what the BFF read back OUT OF
// SPACE afterwards, and `inSpace: null` means the re-read failed — never "you
// have no drones".

/** The whole Drones panel in one read: bay, space, and the server's limits. */
export interface DronesResult {
  readonly activeShipID: number | null;
  /** null when the bay could not be read — NOT an empty bay. */
  readonly bay: JsonValue;
  /** null when the snapshot could not be read — NOT "no drones in space". */
  readonly inSpace: JsonValue;
  /** Raw dogmaIM.ShipGetInfo, decoded by bridge/drones.ts (no new call). */
  readonly shipInfo: JsonValue;
  readonly errors: Readonly<Record<string, string | null>>;
}

/**
 * What a launch or an order ACTUALLY changed, as the snapshot reports it.
 *
 * `launched` is present only for a launch, and is the honest claim: the drones
 * in space now that were not in space before. A drone the server declined
 * simply does not appear, so the panel says "nothing launched" instead of
 * echoing a phantom success.
 */
export interface DroneActionResult {
  readonly inSpace: JsonValue;
  readonly launched: JsonValue;
  /**
   * R34 — the raw call RESULT dict, which is where the server writes its OWN
   * plain-language reason for every drone it refused, keyed by droneID.
   *
   * ⚠ IT WAS BEING DROPPED IN THE BFF, and that was the whole of the defect
   * R33 worked around by predicting: `droneOrderRoute` forwarded only
   * `outcome.notifications`, so thirteen sentences the server had already
   * written for the player never left the building. Undecoded here on purpose —
   * `bridge/drones.ts` reads it, `bridge/refusals.ts` turns it into words.
   *
   * Present only for the three in-space orders. A launch answers with a
   * different per-item shape and is still judged by `launched` alone.
   */
  readonly result: JsonValue;
  readonly notifications: readonly JsonValue[];
}

function readDroneAction(data: Record<string, JsonValue>): DroneActionResult {
  return {
    inSpace: data.inSpace ?? null,
    launched: data.launched ?? null,
    result: data.result ?? null,
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
  };
}

export async function getDrones(options: ApiOptions = {}): Promise<DronesResult> {
  const data = await getJson("/api/bridge/drones", options);
  const rawErrors =
    typeof data.errors === "object" && data.errors !== null && !Array.isArray(data.errors)
      ? (data.errors as Record<string, JsonValue>)
      : {};
  const errors: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(rawErrors)) {
    errors[key] = typeof value === "string" && value.length > 0 ? value : null;
  }
  return {
    activeShipID: Number(data.activeShipID) || null,
    bay: data.bay ?? null,
    inSpace: data.inSpace ?? null,
    shipInfo: data.shipInfo ?? null,
    errors,
  };
}

/**
 * Launch from the bay (ship.LaunchDrones).
 *
 * ⚠ THIS IS THE DEFENCE. An idle combat drone auto-engages whatever shoots the
 * ship it came from — the server's own behaviour, on by default — so a miner
 * who launches is defended without another click. `engageDrones` below is for
 * choosing a victim, not for being protected.
 */
export async function launchDrones(
  drones: readonly { readonly itemID: number; readonly quantity?: number }[],
  options: ApiOptions = {},
): Promise<DroneActionResult> {
  const body: JsonValue = drones.map((entry) => ({
    itemID: entry.itemID,
    quantity: entry.quantity ?? 1,
  }));
  return readDroneAction(await postJson("/api/bridge/drones/launch", { drones: body }, options));
}

/** Set drones on a target (entity.CmdEngage). */
export async function engageDrones(
  droneIDs: readonly number[],
  targetID: number,
  options: ApiOptions = {},
): Promise<DroneActionResult> {
  return readDroneAction(
    await postJson("/api/bridge/drones/engage", { droneIDs: [...droneIDs], targetID }, options),
  );
}

/** Put mining drones on a rock (entity.CmdMineRepeatedly). */
export async function mineWithDrones(
  droneIDs: readonly number[],
  targetID: number,
  options: ApiOptions = {},
): Promise<DroneActionResult> {
  return readDroneAction(
    await postJson("/api/bridge/drones/mine", { droneIDs: [...droneIDs], targetID }, options),
  );
}

/**
 * Bring drones home (entity.CmdReturnBay). The runtime flies them back and
 * scoops them itself inside 2500 m, so they stay visibly "coming home" for the
 * length of the trip — which is exactly what the re-read reports.
 */
export async function recallDrones(
  droneIDs: readonly number[],
  options: ApiOptions = {},
): Promise<DroneActionResult> {
  return readDroneAction(
    await postJson("/api/bridge/drones/recall", { droneIDs: [...droneIDs] }, options),
  );
}

// --- R28 Skills: the character sheet and the training queue -------------------
//
// ONE read and ONE write, because that is what the server has. Adding a skill,
// removing one and reordering are all "save this list" — the same call retail
// makes — so there is no add/remove/move endpoint to keep in step with three
// different server behaviours.
//
// The write's answer is NOT its own return value: the BFF re-reads the sheet
// after every save and returns THAT, so a caller cannot accidentally believe a
// queue edit that never landed.

/** The whole Skills panel in one read: sheet, queue, and the server's clock. */
export interface SkillsResult {
  /** Raw; decoded by bridge/skills.ts. Carries serverNowMs for the countdown. */
  readonly skills: JsonValue;
  readonly notifications: readonly JsonValue[];
}

function readSkills(data: Record<string, JsonValue>): SkillsResult {
  return {
    skills: data.skills ?? null,
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
  };
}

export async function getSkills(options: ApiOptions = {}): Promise<SkillsResult> {
  return readSkills(await getJson("/api/bridge/skills", options));
}

/**
 * Save the whole training queue (skillMgr.SaveNewQueue).
 *
 * Sending [] pauses training. The server validates the list as a WHOLE and
 * refuses all of it with one of eleven public codes if any part is wrong — the
 * refusal arrives as a BridgeCallError whose message is that bare code, which
 * bridge/skills.ts turns into a sentence.
 */
export async function saveSkillQueue(
  entries: readonly { readonly typeID: number; readonly toLevel: number }[],
  options: ApiOptions = {},
): Promise<SkillsResult> {
  const body: JsonValue = entries.map((entry) => ({
    typeID: entry.typeID,
    toLevel: entry.toLevel,
  }));
  return readSkills(await postJson("/api/bridge/skills/queue", { entries: body }, options));
}

// --- R41 Planets: the character's colonies ------------------------------------
//
// ONE read and no write. This is not a bridge `callMethod` — the BFF answers it
// from the gateway's owner-scoped snapshot, so it costs the deny-by-default
// allowlist nothing. See src/server.js for why the planetMgr reads that would
// have needed allowlisting were declined.

/** The whole Planets panel in one read, decoded by bridge/planets.ts. */
export interface PlanetsResult {
  /** Raw colony rows; every id in them is for an icon, never for display. */
  readonly planets: JsonValue;
}

export async function getPlanets(options: ApiOptions = {}): Promise<PlanetsResult> {
  const data = await getJson("/api/bridge/planets", options);
  return { planets: data as JsonValue };
}
