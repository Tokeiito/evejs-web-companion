// R72 — the five GATEWAY-BIND reads decoded to a plain reachability record
// (PLUMBING ONLY — no UI, no bound methods).
//
// GET /api/bridge/gateway-binds performs each of the five bind gateways every
// Phase-2 bound-read batch hangs off, and returns the handle ENVELOPE INTACT —
// NOT decoded entity fields. This decoder reads that envelope; it is deliberately
// thin (a bind gateway carries no rows to decode). Each gateway is either
// reachable (a bound handle / moniker came back) or carries the failure code.
//
// Captured LIVE from Farmer (char 140000005) on 2026-07-22:
//   {ok:true, gateways:{
//     skillHandler:{bound:true, moniker:{type:"object",
//        name:"carbon.common.script.net.moniker.Moniker",
//        args:["skillHandler", null, 140000005, null]}},
//     dogma:{bound:true, service:"dogmaIM", method:"MachoBindObject"},
//     entity:{bound:true, service:"entity", method:"MachoBindObject"},
//     systemScan:{bound:true, service:"scanMgr", method:"GetSystemScanMgr"},
//     fleet:{bound:true, service:"fleetObjectHandler", method:"MachoBindObject"}}}
//
// ⚠ The OID handle itself never reaches the browser (it is held BFF-side); the
// only thing this decoder ever sees is `bound: true/false`. For the skills
// gateway the SESSION's OWN characterID rides the Moniker — kept as DATA (R7d), a
// future UI resolves it, it is never coerced into a label here.

import { unwrapLong, type JsonValue } from "./wire.ts";

/** Whether one bind gateway resolved to a usable handle, and its failure code if not. */
export interface GatewayHandleStatus {
  /** True when a bound handle / moniker came back. */
  readonly reachable: boolean;
  /** The failure code when the bind did not resolve (e.g. "SESSION_NOT_FOUND"), else null. */
  readonly error: string | null;
}

/** The skills gateway also carries the Moniker the Phase-2 skill reads address. */
export interface SkillHandlerGateway extends GatewayHandleStatus {
  /** The Moniker's __serviceName — the service the Phase-2 skill reads call ("skillHandler"). */
  readonly monikerService: string | null;
  /**
   * ⚠ DATA, NEVER A LABEL (R7d). The character the skill handler is bound to — the
   * SESSION's OWN character. A future UI resolves it to a name; it is never rendered
   * as a number. Present only so a caller can confirm the gateway is session-scoped.
   */
  readonly characterId: number | null;
}

/** The reachability of all five R72 gateway binds. */
export interface GatewayBindReachability {
  readonly skillHandler: SkillHandlerGateway;
  readonly dogma: GatewayHandleStatus;
  readonly entity: GatewayHandleStatus;
  readonly systemScan: GatewayHandleStatus;
  readonly fleet: GatewayHandleStatus;
}

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

/** A positive game ID (long-aware), or null. Never coerced into a label. */
function idOrNull(value: JsonValue | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const long = unwrapLong(value);
  const numeric = Number(long === null ? value : long);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/** Read one gateway's `{bound, ...}` envelope into a reachability status. */
function decodeStatus(entry: JsonValue | undefined): GatewayHandleStatus {
  const row = asObject(entry);
  const reachable = row.bound === true;
  const error = typeof row.error === "string" && row.error.length > 0 ? row.error : null;
  return { reachable, error };
}

/** Read the skills gateway's Moniker envelope, keeping its ids as data (R7d). */
function decodeSkillHandler(entry: JsonValue | undefined): SkillHandlerGateway {
  const base = decodeStatus(entry);
  const moniker = asObject(asObject(entry).moniker);
  const args = Array.isArray(moniker.args) ? (moniker.args as readonly JsonValue[]) : [];
  const monikerService =
    typeof args[0] === "string" && args[0].length > 0 ? args[0] : null;
  // The Moniker's __bindParams slot (index 2) is the bound character.
  const characterId = idOrNull(args[2]);
  return { ...base, monikerService, characterId };
}

/**
 * Decode the /api/bridge/gateway-binds envelope. A gateway that did not resolve
 * (missing target, lost session) is `reachable: false` with its error code — never
 * an exception, so one absent gateway never blanks the rest.
 */
export function decodeGatewayBinds(raw: JsonValue | null | undefined): GatewayBindReachability {
  const gateways = asObject(asObject(raw).gateways);
  return {
    skillHandler: decodeSkillHandler(gateways.skillHandler),
    dogma: decodeStatus(gateways.dogma),
    entity: decodeStatus(gateways.entity),
    systemScan: decodeStatus(gateways.systemScan),
    fleet: decodeStatus(gateways.fleet),
  };
}
