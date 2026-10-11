// The Industry window's jobs: what is offered for a job that is ready, and what for a job that is not.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const { default: Industry } = await import("./Industry.svelte");

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

function job(jobID: number, status: string) {
  return {
    jobID,
    activity: "manufacturing",
    status,
    blueprintID: jobID + 1000,
    blueprintTypeID: 811,
    productTypeID: 210,
    facilityID: 60003760,
    solarSystemID: 30000142,
    runs: 1,
    successfulRuns: 0,
    cost: 100,
    startDate: null,
    endDate: null,
    timeSeconds: 600,
  };
}

function windowWith(jobs: readonly ReturnType<typeof job>[]): string {
  const store = createClientStore();
  store.apply({
    type: "industry/loaded",
    ownerID: 7,
    stationID: 60003760,
    solarSystemID: 30000142,
    blueprints: [],
    jobs,
    facilities: [],
    slotsUsed: {},
    blueprintsError: null,
    jobsError: null,
    facilitiesError: null,
  } as never);
  return render(Industry as never, { props: { store, flow: fakeFlow() } } as never).body;
}

const count = (body: string, words: string): number => body.split(words).length - 1;
const offered = (body: string): readonly number[] => [count(body, "Collect the results"), count(body, "Stop this job")];

test("a job that is ready is offered its collecting and no stop; a job that is not, its stop and no collecting", () => {
  // The client's own button (submitButton.ClickFunc, 199 to 211): a ready job is delivered by it, and only a job
  // installed and not ready is stopped. The server refuses the stop of a ready job in its own words.
  assert.deepEqual(offered(windowWith([job(1, "ready")])), [1, 0]);
  assert.deepEqual(offered(windowWith([job(2, "running")])), [0, 1]);
  assert.deepEqual(offered(windowWith([job(3, "paused")])), [0, 1]);
  assert.deepEqual(offered(windowWith([job(1, "ready"), job(2, "running"), job(3, "paused"), job(4, "ready")])), [2, 2]);
  // A job that is over is listed with neither.
  assert.deepEqual(offered(windowWith([job(5, "delivered"), job(6, "cancelled")])), [0, 0]);
});
