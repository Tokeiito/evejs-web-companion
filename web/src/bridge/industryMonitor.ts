// The Industry window's job as the client's industry service sends it and watches what its place has
// (eve/client/script/industry/industrySvc.py), made by the page itself since 2026-10-14. Until then the BFF's
// preview route made these, and the transport kept the window's job for it.
//
//   facilitySvc.GetFacilityLocations(facilityID, ownerID)   the places a job at the facility may take from and put
//   (114, Memoize(1); industrySvc.LoadLocations, 317)       to: kept a minute by the client, and by the game port
//   industrySvc.ConnectJob(job) (305 to 307)                RemoteSvc('industryMonitor').ConnectJob(job.dump()),
//                                                           answered (monitorID, available); the job is the one
//                                                           monitored from then (self.monitoring = weakref.ref(job))
//   OnIndustryMaterials(jobID, materials) (324)             what the monitored job's place has, as the server says it
//                                                           (the store keeps the notice; the window reads it)
//   industrySvc.DisconnectJob(job) (311 to 313)             at the window's close (industryWnd.Close, 107 to 108):
//                                                           DisconnectJob(job.monitorID if job else None), where the
//                                                           job is None or the one monitored, and nothing else
//
// The job's dump is industry.Job.dump() (industry/job.py 624 to 640): its seventeen names, held here as a plain
// object, which the game port makes the client's own dict and its places the client's own objects
// (src/gamePort/retailCalls.js, jobDumped) and the web gateway takes as it is.

import type { Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

/** inventorycommon.const.accountingKeyCash: the wallet key of a character's own ISK. */
const CASH_ACCOUNT_KEY = 1000;

/** One place a job at a facility may take from or put to, as GetFacilityLocations answers it: its seven fields. */
export interface FacilityPlace {
  readonly itemID: number;
  readonly typeID: number;
  readonly ownerID: number;
  readonly flagID: number;
  readonly solarSystemID: number;
  readonly canView: boolean;
  readonly canTake: boolean;
}

/** The places of facilityManager.GetFacilityLocations' answer: each an industry.Location (objectex1) with an item. */
export function decodeFacilityPlaces(result: JsonValue): FacilityPlace[] {
  const items = result !== null && typeof result === "object" && !Array.isArray(result) && Array.isArray((result as { items?: unknown }).items)
    ? ((result as { items: unknown[] }).items)
    : [];
  const places: FacilityPlace[] = [];
  for (const item of items) {
    const header = item !== null && typeof item === "object" && (item as { type?: unknown }).type === "objectex1" ? (item as { header?: unknown }).header : null;
    const state = Array.isArray(header) ? (header[2] as { entries?: unknown } | null) : null;
    const entries = state && Array.isArray(state.entries) ? (state.entries as unknown[]) : [];
    const fields: Record<string, unknown> = {};
    for (const entry of entries) {
      if (Array.isArray(entry) && typeof entry[0] === "string") fields[entry[0]] = entry[1];
    }
    const itemID = Number(fields.itemID) || 0;
    if (itemID > 0) {
      places.push({
        itemID,
        typeID: Number(fields.typeID) || 0,
        ownerID: Number(fields.ownerID) || 0,
        flagID: Number(fields.flagID) || 0,
        solarSystemID: Number(fields.solarSystemID) || 0,
        canView: fields.canView !== false,
        canTake: fields.canTake !== false,
      });
    }
  }
  return places;
}

/** The job's two places, as the client's job has them where it was given none of its own: the first it may take from, and the first. */
export function jobPlaces(places: readonly FacilityPlace[]): { readonly input: FacilityPlace | null; readonly output: FacilityPlace | null } {
  return { input: places.find((place) => place.canTake) ?? places[0] ?? null, output: places[0] ?? null };
}

/** What a job's dump is made of. */
export interface JobDumped {
  readonly blueprintItemID: number;
  readonly blueprintTypeID: number;
  readonly activityID: number;
  readonly facilityID: number;
  readonly characterID: number;
  /** The session's corporation (industryCommon.AttachSessionToJob). */
  readonly corporationID: number;
  /** The pilot's own system, where the facility gave no place. */
  readonly solarSystemID: number;
  readonly runs: number;
  readonly licensedRuns: number;
  /** The job's reckoning, each nought (or none) where it was not reckoned whole: the server works it out then. */
  readonly cost: number | null;
  readonly tax: number | null;
  readonly time: number | null;
  readonly materials: Readonly<Record<string, number>> | null;
  readonly input: FacilityPlace | null;
  readonly output: FacilityPlace | null;
  readonly productTypeID: number | null;
}

/**
 * industry.Job.dump() (job.py 624 to 640), as the client sends its job: the facility's solar system (629: each of its
 * places says it; the pilot's own where it gave none), personal industry paid from the character's own cash
 * (industrySvc._UpdateAccounts), the job's reckonings, its places, and its product where one was chosen.
 */
export function jobDump(job: JobDumped): Record<string, JsonValue> {
  const place = (each: FacilityPlace | null): JsonValue => (each === null ? null : { ...each });
  return {
    blueprintID: job.blueprintItemID,
    blueprintTypeID: job.blueprintTypeID || 0,
    activityID: job.activityID,
    facilityID: job.facilityID,
    solarSystemID: (job.input && job.input.solarSystemID) || job.solarSystemID || 0,
    characterID: job.characterID,
    corporationID: job.corporationID || 0,
    account: [job.characterID, CASH_ACCOUNT_KEY],
    runs: job.runs,
    licensedRuns: job.licensedRuns,
    cost: job.cost || 0,
    tax: job.tax || 0,
    time: job.time || 0,
    materials: job.materials ? { ...job.materials } : {},
    inputLocation: place(job.input),
    outputLocation: place(job.output),
    productTypeID: job.productTypeID || null,
  };
}

/** By what a job is the one monitored: what it was made as, and the place it takes from. */
export function monitoredAs(dump: Record<string, JsonValue>): string {
  const input = dump.inputLocation as { itemID?: unknown; flagID?: unknown } | null;
  return `${dump.blueprintID}:${dump.activityID}:${dump.facilityID}:${input ? `${input.itemID}:${input.flagID}` : "nowhere"}`;
}

/** What a monitor answered: its number, and what the job's place has of each material, by type. */
export interface Monitored {
  readonly monitorID: number | null;
  readonly available: Readonly<Record<string, number>>;
}

/** industrySvc.ConnectJob: ConnectJob(job.dump()), answered (monitorID, available). */
export async function connectJob(act: Ask, dump: Record<string, JsonValue>): Promise<Monitored> {
  const answer = await act("industryMonitor", "ConnectJob", [dump]);
  const pair = Array.isArray(answer) ? answer : [];
  const monitorID = typeof pair[0] === "number" && Number.isSafeInteger(pair[0]) && pair[0] > 0 ? pair[0] : null;
  const dict = pair[1] as { entries?: unknown } | null | undefined;
  const available: Record<string, number> = {};
  for (const entry of dict && Array.isArray(dict.entries) ? (dict.entries as unknown[]) : []) {
    if (Array.isArray(entry)) available[String(Number(entry[0]) || 0)] = Number(entry[1]) || 0;
  }
  return { monitorID, available };
}

/** industrySvc.DisconnectJob: DisconnectJob(job.monitorID if job else None). */
export async function disconnectJob(act: Ask, monitorID: number | null): Promise<void> {
  await act("industryMonitor", "DisconnectJob", [monitorID]);
}
