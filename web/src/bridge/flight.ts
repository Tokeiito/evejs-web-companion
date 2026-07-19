// Flight status decoder (goal R5a, "how to add a page"). The manually-stepped
// space flow runs on the BFF (which holds the beyonce bound park handle) and
// the gateway returns the flight-status snapshot here; this module decodes it
// into a plain FlightStatus row for the store.
//
// Decoder rule (docs/bridge-wire-contract.md): numeric IDs are decoded with
// unwrapLong — never the `typeof === "number" ? … : 0` pattern, which silently
// zeroes a {type:"long"} wrapper. The gateway emits plain numbers today, but a
// forwarded OnSessionChanged carries long-encoded location IDs, so the decoder
// tolerates both. System / station / ship IDs fit in 2^53 and are kept as
// `number`.

import { unwrapLong, type JsonValue } from "./wire.ts";
import type { FlightStatus } from "../store/types.ts";

/** A location/ship ID as a plain number (long-aware), or null. */
function idOrNull(value: JsonValue | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const long = unwrapLong(value);
  return long === null ? null : Number(long);
}

/** A finite float (e.g. a speed fraction), or null. */
function floatOrNull(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function decodeFlightStatus(raw: JsonValue | undefined): FlightStatus {
  const flight =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, JsonValue>)
      : {};
  const inSpace = flight.inSpace === true;
  const stationID = idOrNull(flight.stationID);
  const structureID = idOrNull(flight.structureID);
  return {
    inSpace,
    // Trust the gateway's explicit `docked`, but fall back to a sound
    // derivation (out of space and at a station/structure) if it is absent.
    docked:
      typeof flight.docked === "boolean"
        ? flight.docked
        : !inSpace && (stationID !== null || structureID !== null),
    solarSystemID: idOrNull(flight.solarSystemID),
    stationID,
    structureID,
    shipID: idOrNull(flight.shipID),
    shipMode: typeof flight.shipMode === "string" ? flight.shipMode : null,
    shipSpeedFraction: floatOrNull(flight.shipSpeedFraction),
  };
}
