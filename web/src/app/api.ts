// Typed BFF endpoints for the R2 page flow: who-cares login, persistent-
// session select/release. The bridge call tuple itself goes through
// bridge/callMethod.ts; these are the BFF's own session routes
// (docs/bridge-wire-contract.md, "BFF routes").
//
// The opaque bridgeSessionID never appears here: the BFF holds it server-side
// in its cookie-session store and attaches it to bridge calls itself.

import { BridgeCallError } from "../bridge/callMethod.ts";
import type { JsonValue } from "../bridge/wire.ts";
import type { OnlineCharacterState, StationStatic } from "../store/types.ts";

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
