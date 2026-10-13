// What a monitored industry job's place has, as the server says it without being asked.
//
// What is asserted here is the client's own rule, read in its code (eve/client/script/industry/industrySvc.py of
// build 3396210): ConnectJob, 305 to 308, gives the job its monitor's number and what its place has; and
// OnIndustryMaterials(jobID, materials), 324 to 327, sets job.available = materials where the monitored job's
// monitorID is jobID, and does nothing where it is another number.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeIndustryMaterials, placeHasNow } from "./industryMaterials.ts";

const dict = (entries: readonly (readonly unknown[])[]) => ({ type: "dict", entries });

test("the notice is read as the monitor's number and what its place has, by type", () => {
  // industrySvc.OnIndustryMaterials(jobID, materials), 324: the notice's two.
  assert.deepEqual(decodeIndustryMaterials([970000000000123, dict([[34, 32500], [35, 7000]])]), { monitorID: 970000000000123, available: { "34": 32500, "35": 7000 } });
  // A long is a number to it; a place that has nothing left is said so.
  assert.deepEqual(decodeIndustryMaterials([{ type: "long", value: "501" }, dict([[34, { type: "long", value: "5" }]])]), { monitorID: 501, available: { "34": 5 } });
  assert.deepEqual(decodeIndustryMaterials([501, dict([])]), { monitorID: 501, available: {} });
});

test("what the place has is what the server said of the job's own monitor, and of no other", () => {
  const previewed = { "34": 32000 };
  const said = (monitorID: number, seq: number) => ({ monitorID, seq, available: { "34": 32500 } });
  // industrySvc 326 to 327: job.monitorID == jobID, and job.available = materials.
  assert.deepEqual(placeHasNow(previewed, 501, 3, said(501, 4)), { "34": 32500 });
  // 326: another monitor's number changes nothing.
  assert.equal(placeHasNow(previewed, 501, 3, said(502, 4)), previewed);
  // 307 then 324: the job has what ConnectJob answered until a notice comes after it. A telling the page had
  // before it asked is not a later word than the answer.
  assert.equal(placeHasNow(previewed, 501, 3, null), previewed);
  assert.equal(placeHasNow(previewed, 501, 3, said(501, 3)), previewed);
  // 326, hasattr(job, 'monitorID'): a job with no monitor is told nothing.
  assert.equal(placeHasNow(previewed, null, 0, said(501, 4)), previewed);
});
