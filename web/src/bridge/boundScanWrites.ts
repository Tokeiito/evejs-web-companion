// R104 Phase-4 BOUND WRITE acks — WB-SCAN: the 9 probe / scan-control writes
// (SignalTrackerRegister / SetProbeDestination / SetProbeRangeStep / ConeScan /
// RequestScans / ReconnectToLostProbes / DestroyProbe / RecoverProbes /
// SetActivityState) that hang off the R72 scanMgr.GetSystemScanMgr bind.
// PLUMBING ONLY — no UI.
//
// Each write dispatches as a BOUND method off systemScanBindSpec() (the BFF holds
// the OID handle; the browser never sees it), NOT the top-level /call seam. Unlike a
// MachoBindObject bind, GetSystemScanMgr takes NO caller args — it always binds the
// SESSION's own current-system scan manager, so the bind cannot be pointed at a
// foreign system. Every BFF route is confirm-gated (refuses without `confirm:true`)
// and folds the server return into the uniform ack `{ok, applied, result,
// notifications}` (dispatchBoundScanWrite in server.js). ⚠ DestroyProbe destroys a
// launched probe — its route carries an extra-explicit confirm message.
//
// ⚠ OWNERSHIP: the bind is session-scoped, and every handler operates on
// probeRuntimeState keyed on characterID = the SESSION char. A caller-supplied
// probeID only ever selects among the caller's OWN probes — a foreign probeID
// launched by another char simply misses. Inherently session-scoped; no leak.
//
// ⚠ FAST-MODE / educated guess: none fired live this batch (operator owns EveJS; no
// server restart), so this decoder was written from the scanMgr handler code, not
// captured bytes. Most verbs return null; ConeScan returns a directional-scan list;
// RecoverProbes returns the recovered-probeID list — `result` carries each through
// UNTOUCHED for a future scan UI to decode. `applied` is the confirm-gate's
// did-not-throw signal; a panel re-reads scan state to prove the mutation.
//
// ⚠ These are WRITES: never call a decoder to DRIVE a mutation — the confirm-gated
// BFF route is the only path, and it refuses without `confirm: true`.

import { readKeyVal, type JsonValue } from "./wire.ts";

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** The uniform ack every confirm-gated R104 bound scan-control write returns. */
export interface ScanWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
  /** The raw server return — null / a directional-scan list / a recovered-probeID list. */
  readonly result: JsonValue | null;
}

/**
 * Decode an R104 bound probe/scan-control write ack. `applied` is the confirm-gate's
 * did-not-throw signal; `result` passes the handler return through. FAST-MODE:
 * never fired live, so this is an educated guess from the scanMgr handler code.
 */
export function decodeScanWriteAck(response: JsonValue): ScanWriteAck {
  const result = readKeyVal(response, "result");
  return {
    ok: truthy(readKeyVal(response, "ok")),
    applied: truthy(readKeyVal(response, "applied")),
    result: result === undefined ? null : (result as JsonValue),
  };
}

/**
 * Decode a ConeScan result into the hit entity ids. The handler returns an
 * ARRAY of util.KeyVal rows `{id, typeID, groupID}` (buildDirectionalScanResult
 * — plain numbers, already normalized server-side). Bridge-decoder rules: a
 * malformed row is skipped, never a throw; a non-array result reads as null
 * (unreadable), never as an empty sky.
 */
export function decodeDirectionalScanHitIDs(result: JsonValue | null): readonly number[] | null {
  if (!Array.isArray(result)) {
    return null;
  }
  const ids: number[] = [];
  for (const row of result) {
    const id = readKeyVal(row, "id");
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) {
      ids.push(id);
    }
  }
  return ids;
}
