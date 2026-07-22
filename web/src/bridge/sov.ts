// Sovereignty (sovMgr) reads decoded to plain rows (goal R69, PLUMBING ONLY — no UI).
//
// GET /api/bridge/sov bundles the sovMgr read set. Built from bytes captured LIVE
// from Farmer (char 140000005) on 2026-07-22 and cross-checked against the server
// builders (eve.js .../services/sovereignty/sovPayloads.js). Farmer sits in highsec,
// so every live read is its legitimate EMPTY state (no sov structures, null claim/hub,
// null fuel-access-group); the POPULATED fixtures in the test mirror the server's own
// payload builders (buildSovStructuresPayload / buildSovClaimInfoPayload /
// buildSovHubInfoPayload), descriptor and all.
//
// ⚠ EMPTY-STATE QUIRK (captured live 2026-07-22): sovMgrService.callMethod rewrites ANY
// null handler return into `{type:"list", items:[]}`. So in highsec GetSystemSovereigntyInfo
// / GetInfrastructureHubInfo / GetSovHubFuelAccessGroup answer that empty LIST, NOT null —
// the decoders below defensively read null/[] for it (an empty list is not an objectex1 and
// not a positive id). Only IsOnLocalSovHubFuelAccessGroup returns a real bool (Farmer: true).
//
// OWNERSHIP-SAFETY (R63): every sovMgr read is PUBLIC solar-system sovereignty data,
// keyed by systemID (arg) or the session's own system — no owner argument points one
// at private data. IsOnLocalSovHubFuelAccessGroup is a session-derived boolean.
//
// R7d: every id (itemID / typeID / ownerID / corporationID / allianceID / solarSystemID /
// claimStructureID / hubID) survives as a numeric field; none is forced into a label.
// FILETIMEs (claimTime / campaign + vulnerability times) are bigint-safe.

import {
  isListValue,
  readDictPairs,
  readRowField,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

// --- shared field coercions -------------------------------------------------

function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : 0;
}

/** A positive entity id, or null when absent/zero. Keeps ids as data (R7d). */
function toOptionalID(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const id = toNumber(value);
  return id > 0 ? id : null;
}

/** A FILETIME as a bigint; null when absent or a zero sentinel. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/** A boolean from a wire field — a real bool or the number 1. */
function toBool(value: JsonValue | undefined): boolean {
  return value === true || toNumber(value) === 1;
}

/**
 * The positional args of a buildObjectEx1 payload — `{type:"objectex1",
 * header:[{type:"token", value:name}, [arg0, arg1, ...]], list:[], dict:[]}`.
 * The args live at header[1]. null for anything that is not an objectex1 (which
 * includes the server's `null` answer for a system with no claim/hub).
 */
function readObjectEx1Args(value: JsonValue | null | undefined): readonly JsonValue[] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as { type?: unknown; header?: unknown };
  if (candidate.type !== "objectex1" || !Array.isArray(candidate.header)) {
    return null;
  }
  const args = candidate.header[1];
  return Array.isArray(args) ? (args as readonly JsonValue[]) : null;
}

// --- GetSovStructuresInfoForLocalSolarSystem / ...ForSolarSystem -------------

export interface SovCampaignState {
  readonly campaignEventType: number;
  readonly allianceID: number | null;
  readonly campaignStartTime: bigint | null;
  readonly scoresByTeam: readonly { readonly teamID: number; readonly score: number }[];
}

export interface SovVulnerabilityState {
  readonly vulnerableStartTime: bigint | null;
  readonly vulnerableEndTime: bigint | null;
}

export interface SovStructure {
  readonly itemID: number | null;
  readonly typeID: number | null;
  readonly ownerID: number | null;
  readonly corporationID: number | null;
  readonly allianceID: number | null;
  readonly solarSystemID: number | null;
  readonly campaignState: SovCampaignState | null;
  readonly vulnerabilityState: SovVulnerabilityState | null;
  readonly defenseMultiplier: number;
  readonly isCapital: boolean;
}

/** campaignState is the bare tuple [eventType, allianceID, startTime(long), scores(dict)] | null. */
function decodeCampaignState(value: JsonValue | undefined): SovCampaignState | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }
  const scores: { teamID: number; score: number }[] = [];
  for (const [key, score] of readDictPairs(value[3])) {
    const teamID = Number(key);
    if (Number.isInteger(teamID)) {
      scores.push({ teamID, score: toNumber(score) });
    }
  }
  return {
    campaignEventType: toNumber(value[0]),
    allianceID: toOptionalID(value[1]),
    campaignStartTime: toFiletime(value[2]),
    scoresByTeam: scores,
  };
}

/** vulnerabilityState is the bare tuple [start(long), end(long)] | null. */
function decodeVulnerabilityState(value: JsonValue | undefined): SovVulnerabilityState | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  return {
    vulnerableStartTime: toFiletime(value[0]),
    vulnerableEndTime: toFiletime(value[1]),
  };
}

/**
 * Decode the sov-structures reads -> the sovereignty structures in a system. The
 * wire is a list of util.KeyVal rows. `[]` in highsec (no sov structures) — a real
 * state. Both the local and the systemID-keyed reads share this shape.
 */
export function decodeSovStructures(result: JsonValue | null | undefined): SovStructure[] {
  if (!isListValue(result)) {
    return [];
  }
  const structures: SovStructure[] = [];
  for (const row of result.items) {
    const itemID = toOptionalID(readRowField(row, "itemID"));
    const typeID = toOptionalID(readRowField(row, "typeID"));
    // A row must at least carry an itemID or typeID to be a real structure.
    if (itemID === null && typeID === null) {
      continue;
    }
    structures.push({
      itemID,
      typeID,
      ownerID: toOptionalID(readRowField(row, "ownerID")),
      corporationID: toOptionalID(readRowField(row, "corporationID")),
      allianceID: toOptionalID(readRowField(row, "allianceID")),
      solarSystemID: toOptionalID(readRowField(row, "solarSystemID")),
      campaignState: decodeCampaignState(readRowField(row, "campaignState")),
      vulnerabilityState: decodeVulnerabilityState(readRowField(row, "vulnerabilityState")),
      defenseMultiplier: toNumber(readRowField(row, "defenseMultiplier")),
      isCapital: toBool(readRowField(row, "isCapital")),
    });
  }
  return structures;
}

// --- GetSystemSovereigntyInfo -----------------------------------------------

export interface SovClaimInfo {
  readonly claimStructureID: number | null;
  readonly corporationID: number | null;
  readonly allianceID: number | null;
}

/**
 * Decode GetSystemSovereigntyInfo -> the system's sovereignty claim. The wire is an
 * objectex1 SovClaimInfo whose positional args are [claimStructureID, corporationID,
 * allianceID]. `null` in highsec (no claim) — a real state.
 */
export function decodeSovClaimInfo(result: JsonValue | null | undefined): SovClaimInfo | null {
  const args = readObjectEx1Args(result);
  if (!args) {
    return null;
  }
  return {
    claimStructureID: toOptionalID(args[0]),
    corporationID: toOptionalID(args[1]),
    allianceID: toOptionalID(args[2]),
  };
}

// --- GetInfrastructureHubInfo -----------------------------------------------

export interface SovHubInfo {
  readonly hubID: number | null;
  readonly corporationID: number | null;
  readonly allianceID: number | null;
  readonly claimTime: bigint | null;
}

/**
 * Decode GetInfrastructureHubInfo -> the system's infrastructure-hub claim. The wire
 * is an objectex1 SovHubInfo whose positional args are [hubID, corporationID,
 * allianceID, claimTime(long)]. `null` in highsec (no hub) — a real state.
 */
export function decodeSovHubInfo(result: JsonValue | null | undefined): SovHubInfo | null {
  const args = readObjectEx1Args(result);
  if (!args) {
    return null;
  }
  return {
    hubID: toOptionalID(args[0]),
    corporationID: toOptionalID(args[1]),
    allianceID: toOptionalID(args[2]),
    claimTime: toFiletime(args[3]),
  };
}

// --- GetSovHubFuelAccessGroup / IsOnLocalSovHubFuelAccessGroup ---------------

/**
 * Decode GetSovHubFuelAccessGroup -> the hub's fuel-access-group id, or null when
 * the system has no hub / no group set (a real state). A bare id on the wire.
 */
export function decodeFuelAccessGroup(result: JsonValue | null | undefined): number | null {
  return toOptionalID(result ?? undefined);
}

/** Decode IsOnLocalSovHubFuelAccessGroup -> whether the session is on the local group. */
export function decodeIsOnLocalFuelAccessGroup(result: JsonValue | null | undefined): boolean {
  return toBool(result ?? undefined);
}
