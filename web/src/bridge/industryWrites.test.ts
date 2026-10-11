// A job delivered, and a job stopped, by the page itself: each call as the client makes it, what it is judged by,
// and what is never asked.

import test from "node:test";
import assert from "node:assert/strict";

import { cancelIndustryJob, deliverIndustryJob } from "./industryWrites.ts";
import type { JsonValue } from "./wire.ts";

const JOB = { jobID: 4_200_001, solarSystemID: 30000142 };

/** The job as the server answers it: a job's row, as GetJob answers and GetJobsByOwner repeats. */
function jobRow(status: number, jobID = JOB.jobID): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: [["jobID", jobID], ["activityID", 1], ["status", status], ["solarSystemID", JOB.solarSystemID], ["facilityID", 60003760], ["runs", 3]] },
  };
}

function recording(said: JsonValue) {
  const asked: unknown[] = [];
  const act = async (service: string, method: string, args: readonly JsonValue[], kwargs?: unknown, of?: unknown) => {
    asked.push([service, method, args, kwargs ?? null, of ?? null]);
    return said;
  };
  return { asked, act };
}

test("a job is delivered by the client's own call, with the job's own solar system, and judged by the job the server answers", async () => {
  const { asked, act } = recording(jobRow(101));
  // industrySvc.py 150: RemoteSvc('industryManager').CompleteJob(int(jobID), solarSystemID).
  const change = await deliverIndustryJob(act, JOB);
  assert.deepEqual(asked, [["industryManager", "CompleteJob", [4_200_001, 30000142], null, null]]);
  assert.equal(change.applied, true);
  assert.deepEqual([change.job?.jobID, change.job?.status, change.job?.solarSystemID], [4_200_001, "delivered", 30000142]);
});

test("a job is stopped by the client's own call, with the job's own solar system, and judged by the job the server answers", async () => {
  const { asked, act } = recording(jobRow(102));
  // industrySvc.py 160: RemoteSvc('industryManager').CancelJob(int(jobID), solarSystemID).
  const change = await cancelIndustryJob(act, JOB);
  assert.deepEqual(asked, [["industryManager", "CancelJob", [4_200_001, 30000142], null, null]]);
  assert.equal(change.applied, true);
  assert.deepEqual([change.job?.jobID, change.job?.status], [4_200_001, "cancelled"]);
});

test("a job answered as it was, another job's row, or nothing, is no change", async () => {
  // Ready still after a delivery; running still after a stop.
  const ready = await deliverIndustryJob(recording(jobRow(3)).act, JOB);
  assert.deepEqual([ready.applied, ready.job?.status], [false, "ready"]);
  const running = await cancelIndustryJob(recording(jobRow(1)).act, JOB);
  assert.deepEqual([running.applied, running.job?.status], [false, "running"]);
  // A delivery is not a stop, nor a stop a delivery.
  assert.equal((await deliverIndustryJob(recording(jobRow(102)).act, JOB)).applied, false);
  assert.equal((await cancelIndustryJob(recording(jobRow(101)).act, JOB)).applied, false);
  // The row of another job says nothing of this one.
  const other = await deliverIndustryJob(recording(jobRow(101, 4_200_002)).act, JOB);
  assert.deepEqual([other.applied, other.job], [false, null]);
  for (const said of [null, {}, [], "ok", jobRow(101, 0)] as JsonValue[]) {
    assert.deepEqual(await deliverIndustryJob(recording(said).act, JOB), { applied: false, job: null }, JSON.stringify(said));
    assert.deepEqual(await cancelIndustryJob(recording(said).act, JOB), { applied: false, job: null }, JSON.stringify(said));
  }
});

test("nothing is asked for what is no job, nor for a job whose solar system is not known", async () => {
  let asked = 0;
  const act = async () => { asked += 1; return null; };
  for (const each of [deliverIndustryJob, cancelIndustryJob]) {
    for (const jobID of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      await assert.rejects(each(act, { jobID, solarSystemID: 30000142 }), /^Error: That is no industry job\.$/, String(jobID));
    }
    // idCheckers.IsSolarSystem: thirty million and up, and under forty.
    for (const solarSystemID of [0, -30000142, 29_999_999, 40_000_000, 60003760, 30000142.5, Number.NaN]) {
      await assert.rejects(each(act, { jobID: 4_200_001, solarSystemID }), /^Error: That job's solar system is not known\.$/, String(solarSystemID));
    }
  }
  assert.equal(asked, 0);
  for (const solarSystemID of [30_000_000, 31_000_005, 39_999_999]) {
    assert.deepEqual(await deliverIndustryJob(act, { jobID: 1, solarSystemID }), { applied: false, job: null });
  }
  assert.equal(asked, 3);
});

test("what the server refuses with is the caller's to tell, in the server's words", async () => {
  const refusing = async () => { throw new Error("That industry job is not ready yet."); };
  await assert.rejects(deliverIndustryJob(refusing, JOB), /^Error: That industry job is not ready yet\.$/);
  await assert.rejects(cancelIndustryJob(refusing, JOB), /^Error: That industry job is not ready yet\.$/);
});
