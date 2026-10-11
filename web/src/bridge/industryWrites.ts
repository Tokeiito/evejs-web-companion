// A finished job delivered, and a job stopped, by the page itself (the plan's Phase 6b).
//
// Until 2026-10-11 each was one route of the BFF (POST /api/bridge/industry/deliver and .../industry/cancel).
//
// THE CALLS, as the client makes them (industrySvc.CompleteJob, 150, and CancelJob, 160):
//
//   sm.RemoteSvc('industryManager').CompleteJob(int(jobID), solarSystemID)
//   sm.RemoteSvc('industryManager').CancelJob(int(jobID), solarSystemID)
//
// each of the industry manager by its name, and the solar system THE JOB'S OWN, from the job's row
// (jobData.solarSystemID), wherever the pilot is. A delivery is offered only for a job that is ready (the job's
// own button, and the window's); a stop only for a job installed and not ready, and is pressed twice. The client
// asks nothing after either: it goes by the notice the server sends of the job (OnIndustryJob). No Tranquility
// recording has either call.
//
// WHAT THE SERVER TAKES FROM THE CALLER: the job, and nothing else (the solar system is not read). It lets the
// job's owner act, or one with the corporation's leave, and refuses in a sentence of its own a job not found, a
// job that is another's, a job not ready (for a delivery), a job past stopping (for a stop). It answers the job
// as it is after.
//
// WHAT EACH IS JUDGED BY: the job answered. The routes read the job again (GetJob) for that; the call's own
// answer is the same row, read by the server itself after it acted. A job answered as it was, or no job
// answered, is no change, and the caller says so without a cause. The page does not read the job's notice: its
// window reads its jobs again after either.

import type { IndustryJobRow, IndustryJobStatus } from "../store/types.ts";
import type { Ask } from "./ask.ts";
import { decodeJob } from "./industry.ts";

/** What a delivery or a stop is asked with: the job, and the solar system the job is in. */
export interface JobAsked {
  readonly jobID: number;
  readonly solarSystemID: number;
}

/** What came of it: whether the job is as the call meant it to be, and the job as the server answered it. */
export interface JobChange {
  readonly applied: boolean;
  readonly job: IndustryJobRow | null;
}

const anID = (value: number): boolean => Number.isSafeInteger(value) && value > 0;
/** idCheckers.IsSolarSystem, by the number alone. */
const isSolarSystem = (value: number): boolean => Number.isSafeInteger(value) && value >= 30_000_000 && value <= 39_999_999;

async function askOfTheJob(act: Ask, method: "CompleteJob" | "CancelJob", asked: JobAsked, meant: IndustryJobStatus): Promise<JobChange> {
  if (!anID(asked.jobID)) {
    throw new Error("That is no industry job.");
  }
  if (!isSolarSystem(asked.solarSystemID)) {
    throw new Error("That job's solar system is not known.");
  }
  const answered = decodeJob(await act("industryManager", method, [asked.jobID, asked.solarSystemID]));
  const job = answered !== null && answered.jobID === asked.jobID ? answered : null;
  return { applied: job !== null && job.status === meant, job };
}

/**
 * Delivers the finished job `asked`: what it made is handed over. Applied where the server answers the job as
 * delivered. Throws the server's own sentence where it refuses.
 */
export function deliverIndustryJob(act: Ask, asked: JobAsked): Promise<JobChange> {
  return askOfTheJob(act, "CompleteJob", asked, "delivered");
}

/**
 * Stops the job `asked`. Its materials and its fee are not given back, so the caller asks the pilot first.
 * Applied where the server answers the job as cancelled. Throws the server's own sentence where it refuses.
 */
export function cancelIndustryJob(act: Ask, asked: JobAsked): Promise<JobChange> {
  return askOfTheJob(act, "CancelJob", asked, "cancelled");
}
