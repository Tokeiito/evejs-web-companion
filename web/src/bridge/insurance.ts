// Ship-insurance reads decoded to plain rows (goal R65, PLUMBING ONLY — no UI).
//
// GET /api/bridge/insurance batches four insuranceSvc reads. Their retail wire
// shapes, captured live from Farmer (character 140000005) on 2026-07-22:
//   • GetContracts()          -> {type:"list", items:[util.KeyVal, …]} of the
//       char's own active SHIP-insurance policies (empty when nothing is insured).
//   • GetContractForShip(shipID) -> one policy util.KeyVal, or null.
//   • GetInsurancePrice(shipTypeID)  -> a bare JSON number (the full base premium).
//   • GetInsurancePrices([typeIDs])  -> {type:"dict", entries:[[typeID, price], …]}.
//
// A policy KeyVal is the server's buildClientContract (insuranceRuntime.js:434):
// contractID / shipID / typeID / ownerID / fraction / startDate / endDate, where
// startDate & endDate are long FILETIMEs. These are ship-INSURANCE contracts, NOT
// player contracts.
//
// ⚠ ISK note: insurance premiums are plain JS numbers server-side (getFull
// InsurancePrice returns a Number), so they cross the wire as bare JSON numbers
// within the safe-integer range — decoded here as numbers. The FILETIMEs, which
// DO exceed 2^53, arrive as {type:"long", value:"<decimal>"} and are decoded to
// bigint. R7d: contractID / shipID / typeID / ownerID stay numeric fields.

import { readRowField, readDictPairs, unwrapLong, type JsonValue } from "./wire.ts";

/** One ship-insurance policy (buildClientContract). */
export interface InsuranceContract {
  readonly contractID: number;
  readonly shipID: number;
  readonly typeID: number;
  readonly ownerID: number;
  /** The insurance package fraction (0.5 … 1.0). */
  readonly fraction: number;
  /** Policy start / end as FILETIME bigints (they exceed 2^53); null if absent. */
  readonly startDate: bigint | null;
  readonly endDate: bigint | null;
}

/** One (shipTypeID -> full base premium) entry from GetInsurancePrices. */
export interface InsurancePrice {
  readonly typeID: number;
  readonly price: number;
}

/** A number tolerant of a {type:"long"} wrapper and a numeric string; 0 otherwise. */
function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return Number(long);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return 0;
}

/** A number, or null when the value is absent / not numeric (never a substituted 0). */
function toNumberOrNull(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return Number(long);
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return null;
}

/** A FILETIME as a bigint (it exceeds 2^53); null when absent or a zero sentinel. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/** The items of a marshaled list wrapper, or a bare array; [] otherwise. */
function listItems(value: JsonValue | undefined): readonly JsonValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    const candidate = value as { type?: unknown; items?: unknown };
    if (candidate.type === "list" && Array.isArray(candidate.items)) {
      return candidate.items as readonly JsonValue[];
    }
  }
  return [];
}

/** Decode one policy KeyVal; null when it carries no contractID/shipID. */
function decodeContractRow(row: JsonValue): InsuranceContract | null {
  const contractID = toNumber(readRowField(row, "contractID"));
  const shipID = toNumber(readRowField(row, "shipID"));
  if (contractID <= 0 && shipID <= 0) {
    return null;
  }
  return {
    contractID,
    shipID,
    typeID: toNumber(readRowField(row, "typeID")),
    ownerID: toNumber(readRowField(row, "ownerID")),
    fraction: toNumber(readRowField(row, "fraction")),
    startDate: toFiletime(readRowField(row, "startDate")),
    endDate: toFiletime(readRowField(row, "endDate")),
  };
}

/**
 * Decode GetContracts (the char's own active ship-insurance policies) into rows.
 * `[]` is a REAL "no ship insured" answer, not a failure.
 */
export function decodeInsuranceContracts(result: JsonValue): InsuranceContract[] {
  const rows: InsuranceContract[] = [];
  for (const item of listItems(result)) {
    const row = decodeContractRow(item);
    if (row) {
      rows.push(row);
    }
  }
  return rows;
}

/** Decode GetContractForShip: one policy, or null when the ship has none visible. */
export function decodeInsuranceContract(result: JsonValue): InsuranceContract | null {
  if (result === null || result === undefined) {
    return null;
  }
  return decodeContractRow(result);
}

/** Decode GetInsurancePrice (a bare number premium); null when absent. */
export function decodeInsurancePrice(result: JsonValue): number | null {
  return toNumberOrNull(result);
}

/**
 * Decode GetInsurancePrices ({typeID -> price} dict) into rows sorted by typeID.
 * `[]` is a real "no prices asked" answer.
 */
export function decodeInsurancePrices(result: JsonValue): InsurancePrice[] {
  const rows: InsurancePrice[] = [];
  for (const [key, value] of readDictPairs(result)) {
    const typeID = toNumber(key as JsonValue);
    if (typeID <= 0) {
      continue;
    }
    rows.push({ typeID, price: toNumber(value) });
  }
  rows.sort((left, right) => left.typeID - right.typeID);
  return rows;
}
