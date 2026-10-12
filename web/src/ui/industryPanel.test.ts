// The Industry window's jobs: what is offered for a job that is ready, and what for a job that is not.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  // The client's own button (submitButton.ClickFunc, 200 to 210): a ready job is delivered by it, and only a job
  // installed and not ready is stopped. The server refuses the stop of a ready job in its own words.
  assert.deepEqual(offered(windowWith([job(1, "ready")])), [1, 0]);
  assert.deepEqual(offered(windowWith([job(2, "running")])), [0, 1]);
  assert.deepEqual(offered(windowWith([job(3, "paused")])), [0, 1]);
  assert.deepEqual(offered(windowWith([job(1, "ready"), job(2, "running"), job(3, "paused"), job(4, "ready")])), [2, 2]);
  // A job that is over is listed with neither.
  assert.deepEqual(offered(windowWith([job(5, "delivered"), job(6, "cancelled")])), [0, 0]);
});

/** The Industry window with the pilot's blueprints, and what the game's data says of each one's type. */
function windowOf(blueprints: readonly Record<string, unknown>[], definitions: Record<number, unknown>): string {
  const store = createClientStore();
  store.apply({
    type: "industry/loaded",
    ownerID: 7,
    stationID: 60003760,
    solarSystemID: 30000142,
    blueprints,
    jobs: [],
    facilities: [],
    slotsUsed: {},
    blueprintsError: null,
    jobsError: null,
    facilitiesError: null,
  } as never);
  store.apply({ type: "industry/definitions", definitions } as never);
  return render(Industry as never, { props: { store, flow: fakeFlow() } } as never).body;
}

test("a blueprint is said to be for the kinds of work that are for it as it is: an original is not invented from, and a copy is not copied or researched", () => {
  // The client's own activities (industry/activities: REQUIRES_ORIGINAL on copying and the researches,
  // REQUIRES_COPY on invention), by which its window offers a blueprint its work.
  const recipe = (activity: string) => ({ activity, materials: [], products: [], timeSeconds: 600 });
  const definitions = {
    811: {
      blueprintTypeID: 811, blueprintName: "A Blueprint", productTypeID: 210, productName: "A Thing", maxProductionLimit: 30,
      recipes: ["manufacturing", "copying", "research_material", "research_time", "invention"].map(recipe),
    },
  };
  const blueprint = (itemID: number, original: boolean) => ({
    itemID, typeID: 811, materialEfficiency: 0, timeEfficiency: 0, runs: original ? -1 : 10, original, locationID: 60003760, facilityID: 60003760, solarSystemID: 30000142, jobID: null,
  });
  // (The rendering's own markers, which are comments, are taken out of the cell first.)
  const usedFor = (body: string): readonly string[] =>
    [...body.replace(/<!--.*?-->/g, "").matchAll(/data-label="Can be used for">([^<]*)</g)].map((found) => found[1]!.replace(/\s+/g, " ").trim());
  assert.deepEqual(usedFor(windowOf([blueprint(1, true), blueprint(2, false)], definitions)), [
    "Manufacturing, Copying, Material research, Time research",
    "Manufacturing, Invention",
  ]);
});

// --- a job made as its blueprint is chosen ---------------------------------------
// The client's window makes the job as the blueprint is chosen, at the blueprint's own facility, and shows what it
// will take at once (industryWnd.py 131 to 160; industrySvc.CreateJob, 92 to 110, and ConnectJob, 305 to 308). What
// the page does at that press is drawn only after it, so its own lines are held here; the choice itself is held in
// bridge/industry.test.ts, and the press was made in the tab.

const SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "Industry.svelte"), "utf8").replace(/\r\n/g, "\n");

test("choosing a blueprint makes its job at the blueprint's own facility and asks what it will take at once", () => {
  // The row's press is the choosing.
  assert.match(SOURCE, /<button type="button" disabled=\{busy\} onclick=\{\(\) => chooseBlueprint\(blueprint\)\}>\s*Start a job…/);
  assert.doesNotMatch(SOURCE, /onclick=\{\(\) => startJobFor\(blueprint\)\}/);
  // The job's work and place are the client's choice for the blueprint, out of the facilities the page has.
  assert.match(SOURCE, /const chosen = jobAsChosen\(blueprintActivities\(blueprint\), blueprint\.facilityID, \$industry\.facilities\);\n\s*chosenActivity = chosen\.activity;\n\s*chosenFacilityID = chosen\.facilityID;/);
  // And what it will take is asked at once, where nothing is wanting for the asking.
  assert.match(SOURCE, /function chooseBlueprint\(blueprint: IndustryBlueprintRow\): void \{\n\s*startJobFor\(blueprint\);\n\s*if \(!cannotAsk\) \{\n\s*askToConfirm\(\);\n\s*\}\n\s*\}/);
  // The same wants keep the button from being pressed: the bridge's rule, asked of what is chosen now.
  assert.match(SOURCE, /disabled=\{busy \|\| cannotAsk\}\s*onclick=\{askToConfirm\}/);
  assert.match(SOURCE, /const cannotAsk = \$derived\(\s*startingBlueprint === null \|\|\s*jobCannotBeAsked\(\{\s*activity: chosenActivity,\s*facilityID: chosenFacilityID,\s*runs: chosenRuns,\s*researchFinished: research !== null && research\.finished,\s*productUnchosen,\s*licensedRuns: chosenLicensedRuns,\s*mostLicensedRuns: mostLicensedRuns\(startingBlueprint\),\s*\}\),\s*\);/);
});
