// What a monitored industry job's place has, as the server says it without being asked.
//
// The client's industry service opens a monitor for the job its window has (industrySvc.ConnectJob, 299 to 301:
// the monitor's number and what the job's input place has, by type) and from then on takes the server's notice,
// OnIndustryMaterials(jobID, materials), for what the place has, where the number is its monitored job's (324 to
// 327: job.available = materials). The window shows it at once.
//
// Here the page's preview has the monitor's number where the pilot's transport keeps the monitor (the game port),
// and the notice comes to the page like any other. What the window shows of the place is what the preview had,
// until the server says otherwise of that monitor.

import { readDictPairs, unwrapLong } from "./wire.ts";

/** What the server said a monitor's place has: typeID -> how much of it. */
export interface MaterialsSaid {
  readonly monitorID: number;
  readonly available: Readonly<Record<string, number>>;
}

/** A whole number a number holds, off a number or a long; null for anything else. */
function wholeNumber(value: unknown): number | null {
  if (typeof value === "string") {
    return null;
  }
  const long = unwrapLong(value);
  return long !== null && long >= BigInt(Number.MIN_SAFE_INTEGER) && long <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(long) : null;
}

/**
 * OnIndustryMaterials(jobID, materials): the monitor's number and what its place has. Null where the notice is
 * not that, or any part of what it says cannot be read: a part of what a place has is not what it has.
 */
export function decodeIndustryMaterials(args: readonly unknown[]): MaterialsSaid | null {
  const monitorID = wholeNumber(args[0]);
  const said = args[1] as { readonly type?: unknown; readonly entries?: unknown } | null | undefined;
  if (monitorID === null || monitorID <= 0 || typeof said !== "object" || said === null || said.type !== "dict" || !Array.isArray(said.entries)) {
    return null;
  }
  const pairs = readDictPairs(said);
  if (pairs.length !== said.entries.length) {
    return null;
  }
  const available: Record<string, number> = {};
  for (const [type, amount] of pairs as readonly (readonly unknown[])[]) {
    const typeID = wholeNumber(type);
    const quantity = wholeNumber(amount);
    if (typeID === null || typeID <= 0 || quantity === null || quantity < 0) {
      return null;
    }
    available[String(typeID)] = quantity;
  }
  return { monitorID, available };
}

/**
 * What the job's place has, for the window to show: what the server last said of the job's monitor since the
 * preview was asked, and what the preview had until then (null before any preview). `sinceTelling` is the count
 * of the server's tellings as the preview was asked: a telling counted by then was said before the preview's
 * answer, and one counted after it, while the preview was on its way or later, is no older than that answer.
 */
export function placeHasNow(
  previewed: Readonly<Record<string, number>> | null,
  monitorID: number | null,
  sinceTelling: number,
  said: (MaterialsSaid & { readonly seq: number }) | null,
): Readonly<Record<string, number>> | null {
  if (previewed === null || said === null || monitorID === null || said.monitorID !== monitorID || said.seq <= sinceTelling) {
    return previewed;
  }
  return said.available;
}
