// Encounter Surveillance System (essMgr) reads decoded to plain rows (goal R69,
// PLUMBING ONLY — no UI).
//
// GET /api/bridge/ess bundles the essMgr read set. Built from bytes captured LIVE
// from Farmer (char 140000005) on 2026-07-22 and cross-checked against the server
// builders (eve.js .../services/dynamic/dynamicResourceState.js buildEssDataPayload /
// buildTheftHistoryPayload). Farmer's highsec system has no ESS, so live the data read
// is `null` and both theft reads are empty lists — real states. The POPULATED fixtures
// in the test mirror buildEssDataPayload / buildMainBankLinkPayload exactly.
//
// OWNERSHIP-SAFETY (R63): GetDataForClientSolarSystem is the PUBLIC in-space ESS state
// (essID/values/bank state everyone in system sees); IsClientLinkedToReserveBank is a
// session-scoped boolean; the two theft reads are the SYSTEM's public ESS theft-event
// history (state.theftHistory{Main,Reserve}), keyed by systemID — not a private ledger,
// not the requesting character's private data. Verified empty for a docked session live.
//
// R7d: ids (essID / beaconID / typeID / solarSystemID / characterID) stay numeric.
// ISK (mainValue / reserveValue) are money reals; FILETIMEs (startedAt / completesAt /
// reserveBankLastPulseInitiated) are bigint-safe.

import {
  isListValue,
  readDictEntry,
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

function toOptionalID(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const id = toNumber(value);
  return id > 0 ? id : null;
}

function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

function toBool(value: JsonValue | undefined): boolean {
  return value === true || toNumber(value) === 1;
}

// --- GetDataForClientSolarSystem --------------------------------------------

export interface EssMainBankLink {
  readonly linkID: string | null;
  readonly characterID: number | null;
  readonly startedAt: bigint | null;
  readonly completesAt: bigint | null;
}

export interface EssData {
  readonly essID: number | null;
  readonly beaconID: number | null;
  readonly typeID: number | null;
  readonly solarSystemID: number | null;
  readonly currentOutput: number;
  /** Main-bank ISK held in the ESS (money real, 2dp on the server). */
  readonly mainValue: number;
  /** Reserve-bank ISK held in the ESS. */
  readonly reserveValue: number;
  readonly mainBankLink: EssMainBankLink | null;
  readonly reserveBankLastPulseInitiated: bigint | null;
  readonly reserveBankPulsesRemaining: number;
  readonly reserveBankPulsesTotal: number;
  readonly reserveBankActiveLinks: number;
}

function decodeMainBankLink(value: JsonValue | undefined): EssMainBankLink | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const linkID = readDictEntry(value, "linkID");
  return {
    linkID: typeof linkID === "string" ? linkID : linkID == null ? null : String(linkID),
    characterID: toOptionalID(readDictEntry(value, "characterID")),
    startedAt: toFiletime(readDictEntry(value, "startedAt")),
    completesAt: toFiletime(readDictEntry(value, "completesAt")),
  };
}

/**
 * Decode GetDataForClientSolarSystem -> the system's ESS state. The wire is a bare
 * marshaled dict; the server answers `null` when the system has no ESS (a real
 * state), which decodes to null here.
 */
export function decodeEssData(result: JsonValue | null | undefined): EssData | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return null;
  }
  const candidate = result as { type?: unknown };
  if (candidate.type !== "dict") {
    return null;
  }
  return {
    essID: toOptionalID(readDictEntry(result, "essID")),
    beaconID: toOptionalID(readDictEntry(result, "beaconID")),
    typeID: toOptionalID(readDictEntry(result, "typeID")),
    solarSystemID: toOptionalID(readDictEntry(result, "solarSystemID")),
    currentOutput: toNumber(readDictEntry(result, "currentOutput")),
    mainValue: toNumber(readDictEntry(result, "mainValue")),
    reserveValue: toNumber(readDictEntry(result, "reserveValue")),
    mainBankLink: decodeMainBankLink(readDictEntry(result, "mainBankLink")),
    reserveBankLastPulseInitiated: toFiletime(readDictEntry(result, "reserveBankLastPulseInitiated")),
    reserveBankPulsesRemaining: toNumber(readDictEntry(result, "reserveBankPulsesRemaining")),
    reserveBankPulsesTotal: toNumber(readDictEntry(result, "reserveBankPulsesTotal")),
    reserveBankActiveLinks: toNumber(readDictEntry(result, "reserveBankActiveLinks")),
  };
}

// --- IsClientLinkedToReserveBank --------------------------------------------

/** Decode IsClientLinkedToReserveBank -> whether the SESSION char is linked (boolean). */
export function decodeIsLinkedToReserveBank(result: JsonValue | null | undefined): boolean {
  return toBool(result ?? undefined);
}

// --- GetMainBankTheftsForClientSolarSystem / GetReserveBankThefts... --------

/**
 * Decode an ESS theft-history read -> the system's public ESS theft events. The wire
 * is `buildList(entries)` with no per-entry server builder — this world never seeds a
 * theft, so the live result is an empty list. The raw list items are surfaced as-is
 * (the entry shape is server-internal); `[]` for the empty / non-list case — a real
 * "no ESS theft" state. Both the main-bank and reserve-bank reads share this shape.
 */
export function decodeEssThefts(result: JsonValue | null | undefined): readonly JsonValue[] {
  if (!isListValue(result)) {
    return [];
  }
  return result.items;
}
