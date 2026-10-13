// The R15 Industry controller against a faked BFF: loadIndustry decodes the
// five reads into the store, asks for the NAMES of everything it will render,
// and follows up with the STATIC recipes for the blueprint types it saw.
//
// The properties that matter here are the ones that keep the panel honest when
// something goes wrong: an independent read failing must not blank the rest, a
// failed recipe fetch must not blank the panel at all (it is static data), and
// a lost session must unwind to character select.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const STATION_ID = 60003760;
const SOLAR_SYSTEM_ID = 30000142;
const BLUEPRINT_TYPE_ID = 681;
const BLUEPRINT_ITEM_ID = 7_100_000_001;
const PRODUCT_TYPE_ID = 165;
const JOB_ID = 4_200_001;
// The job's own solar system: its facility's, and not where the pilot is.
const JOB_SOLAR_SYSTEM_ID = 30000144;

function keyVal(fields: Record<string, unknown>): unknown {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

function list(items: readonly unknown[]): unknown {
  return { type: "list", items };
}

function dict(entries: readonly (readonly [unknown, unknown])[]): unknown {
  return { type: "dict", entries };
}

function industryPanel(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    ownerID: 7,
    stationID: STATION_ID,
    solarSystemID: SOLAR_SYSTEM_ID,
    blueprints: {
      // ⚠ A 2-TUPLE: [rows, facilityID -> count].
      result: [
        list([
          keyVal({
            typeID: BLUEPRINT_TYPE_ID,
            itemID: BLUEPRINT_ITEM_ID,
            timeEfficiency: 20,
            materialEfficiency: 10,
            runs: 40,
            locationID: STATION_ID,
            facilityID: null,
            ownerID: 7,
            jobID: null,
            original: false,
          }),
        ]),
        dict([[STATION_ID, 1]]),
      ],
      error: null,
    },
    jobs: {
      result: list([
        keyVal({
          activityID: 1,
          jobID: 4_200_001,
          blueprintID: BLUEPRINT_ITEM_ID,
          blueprintTypeID: BLUEPRINT_TYPE_ID,
          facilityID: STATION_ID,
          solarSystemID: JOB_SOLAR_SYSTEM_ID,
          status: 3,
          runs: 3,
          successfulRuns: 0,
          cost: 1250,
          timeInSeconds: 1800,
          productTypeID: PRODUCT_TYPE_ID,
          startDate: { type: "long", value: "133000000000000000" },
          endDate: { type: "long", value: "133000000018000000" },
        }),
      ]),
      error: null,
    },
    jobCounts: { result: dict([[1, 1]]), error: null },
    facilities: {
      result: list([
        keyVal({
          facilityID: STATION_ID,
          typeID: 52678,
          ownerID: 1000035,
          tax: 0.01,
          solarSystemID: SOLAR_SYSTEM_ID,
          online: true,
          activities: dict([
            [1, { type: "tuple", items: [] }],
            [5, { type: "tuple", items: [] }],
          ]),
        }),
      ]),
      error: null,
    },
    activityModifiers: { result: dict([[1, 1.0]]), error: null },
    ...overrides,
  };
}

const RAW_DEFINITIONS = {
  [String(BLUEPRINT_TYPE_ID)]: {
    blueprintTypeID: BLUEPRINT_TYPE_ID,
    blueprintName: "Clone Grade Beta Blueprint",
    productTypeID: PRODUCT_TYPE_ID,
    productName: "Clone Grade Beta",
    maxProductionLimit: 300,
    activities: {
      manufacturing: {
        materials: [{ typeID: 38, quantity: 86 }],
        products: [{ typeID: PRODUCT_TYPE_ID, quantity: 1 }],
        time: 600,
      },
      copying: { time: 480 },
    },
  },
};

interface Recorded {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

function makeFakeFetch(
  responder: (path: string, method: string, body: Record<string, unknown>) => {
    status: number;
    body: unknown;
  },
): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const fakeFetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const method = (init && init.method) || "GET";
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, method, body });
    const outcome = responder(path, method, body);
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      async json() {
        return outcome.body;
      },
    };
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, requests };
}

function respondOk(
  extra: (path: string, method: string, body: Record<string, unknown>) => unknown = () => null,
) {
  return (path: string, method: string, body: Record<string, unknown>) => {
    const custom = extra(path, method, body);
    if (custom !== null && custom !== undefined) {
      return custom as { status: number; body: unknown };
    }
    if (path === "/api/bridge/industry") {
      return { status: 200, body: industryPanel() };
    }
    if (path === "/api/industry/blueprints") {
      return {
        status: 200,
        body: { ok: true, source: "static-data", definitions: RAW_DEFINITIONS },
      };
    }
    if (path === "/api/names") {
      return { status: 200, body: { ok: true, names: {} } };
    }
    return { status: 200, body: { ok: true } };
  };
}

/** The listed job as the server answers it after a delivery or a stop: its row, with the status it has now. */
function jobAnswered(status: number): unknown {
  return keyVal({ activityID: 1, jobID: JOB_ID, facilityID: STATION_ID, solarSystemID: JOB_SOLAR_SYSTEM_ID, status, runs: 3 });
}

/** The page's own call, answered: POST /api/bridge/call says the service and the method it was asked. */
function called(body: Record<string, unknown>, result: unknown): { status: number; body: unknown } {
  return { status: 200, body: { ok: true, service: body.service, method: body.method, result, notifications: [] } };
}

/** Let the microtask-batched name queue flush. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// --- the read ---------------------------------------------------------------

test("loadIndustry decodes blueprints, jobs, slots and facilities into the store", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.loadIndustry();

  const industry = store.get().industry;
  assert.equal(industry.loaded, true);
  assert.equal(industry.ownerID, 7);
  assert.equal(industry.solarSystemID, SOLAR_SYSTEM_ID);

  assert.equal(industry.blueprints.length, 1);
  assert.equal(industry.blueprints[0]!.materialEfficiency, 10);
  assert.equal(industry.blueprints[0]!.timeEfficiency, 20);
  assert.equal(industry.blueprints[0]!.runs, 40);

  assert.equal(industry.jobs.length, 1);
  // The SERVER said ready; the browser did no clock arithmetic of its own.
  assert.equal(industry.jobs[0]!.status, "ready");
  assert.equal(industry.jobs[0]!.activity, "manufacturing");

  assert.deepEqual(industry.slotsUsed, { manufacturing: 1 });

  assert.equal(industry.facilities.length, 1);
  assert.deepEqual(industry.facilities[0]!.activities, ["manufacturing", "copying"]);
});

test("loadIndustry fetches the STATIC recipes for the blueprint types it saw", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.loadIndustry();

  const recipeCall = requests.find((entry) => entry.path === "/api/industry/blueprints");
  assert.ok(recipeCall, "the recipes must be fetched");
  assert.deepEqual(recipeCall.body.blueprintTypeIDs, [BLUEPRINT_TYPE_ID]);

  const definition = store.get().industry.definitions[BLUEPRINT_TYPE_ID]!;
  assert.equal(definition.productName, "Clone Grade Beta");
  assert.deepEqual(
    definition.recipes.map((recipe) => recipe.activity),
    ["manufacturing", "copying"],
  );
});

test("a second load does not refetch recipes it already holds", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.loadIndustry();
  await flow.loadIndustry();

  const recipeCalls = requests.filter((entry) => entry.path === "/api/industry/blueprints");
  assert.equal(recipeCalls.length, 1, "static recipes are fetched once and cached");
});

test("loadIndustry asks for the NAMES of every id the panel will render", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.loadIndustry();
  await settle();

  const nameCall = requests.find((entry) => entry.path === "/api/names");
  assert.ok(nameCall, "names must be requested (R7d: nothing renders as a number)");
  const asked = (nameCall.body.items as { kind: string; id: number }[]).map(
    (ref) => `${ref.kind}:${ref.id}`,
  );
  // The blueprint, the product it makes, and the facility + system it runs in.
  assert.ok(asked.includes(`type:${BLUEPRINT_TYPE_ID}`));
  assert.ok(asked.includes(`type:${PRODUCT_TYPE_ID}`));
  assert.ok(asked.includes(`station:${STATION_ID}`));
  assert.ok(asked.includes(`system:${SOLAR_SYSTEM_ID}`));
});

test("the materials a recipe uses are named too, so the install preview never reads a dash", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  await flow.loadIndustry();
  await settle();

  const asked = requests
    .filter((entry) => entry.path === "/api/names")
    .flatMap((entry) => (entry.body.items as { kind: string; id: number }[]).map((ref) => `${ref.kind}:${ref.id}`));
  // Tritanium (38) is only ever a material here: nothing else asks for it.
  assert.ok(asked.includes("type:38"), JSON.stringify(asked));
});

test("a failed facility read never blanks the blueprints or the jobs", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/bridge/industry"
        ? {
            status: 200,
            body: industryPanel({ facilities: { result: null, error: "CALL_FAILED" } }),
          }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  await flow.loadIndustry();

  const industry = store.get().industry;
  assert.equal(industry.facilitiesError, "CALL_FAILED");
  assert.deepEqual(industry.facilities, []);
  // The rest of the panel is intact.
  assert.equal(industry.blueprints.length, 1);
  assert.equal(industry.jobs.length, 1);
  assert.equal(industry.blueprintsError, null);
});

test("a failed job-slot read is reported as a jobs-side failure", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/bridge/industry"
        ? {
            status: 200,
            body: industryPanel({ jobCounts: { result: null, error: "CALL_FAILED" } }),
          }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  await flow.loadIndustry();
  assert.equal(store.get().industry.jobsError, "CALL_FAILED");
  // The jobs themselves still read fine, so they are still shown.
  assert.equal(store.get().industry.jobs.length, 1);
});

test("a failed recipe fetch leaves the panel fully populated", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/industry/blueprints"
        ? { status: 500, body: { ok: false, error: "BOOM" } }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  // Static reference data: its failure must not throw or blank anything.
  await flow.loadIndustry();

  const industry = store.get().industry;
  assert.equal(industry.loaded, true);
  assert.equal(industry.blueprints.length, 1);
  assert.equal(industry.jobs.length, 1);
  assert.deepEqual(industry.definitions, {});
});

test("a lost session during an industry read unwinds to character select", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 404,
    body: { ok: false, error: "SESSION_NOT_FOUND", message: "gone" },
  }));
  const flow = createAppFlow(store, { fetch });

  await assert.rejects(() => flow.loadIndustry());
  assert.equal(store.get().station.online, null, "the character is offline again");
  assert.equal(store.get().industry.loaded, false, "the industry slice is cleared");
});

// --- Slice B: install / deliver / cancel ------------------------------------

test("installIndustryJob passes the request through and reloads the panel", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/bridge/industry/install"
        ? { status: 200, body: { ok: true, applied: true, declinedSilently: false, jobID: 5 } }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  await flow.installIndustryJob({
    blueprintItemID: BLUEPRINT_ITEM_ID,
    blueprintTypeID: BLUEPRINT_TYPE_ID,
    activity: "manufacturing",
    facilityID: STATION_ID,
    runs: 3,
  });

  const install = requests.find((entry) => entry.path === "/api/bridge/industry/install");
  assert.ok(install);
  // The browser names the ACTIVITY; the activityID lives only on the BFF.
  assert.equal(install.body.activity, "manufacturing");
  assert.equal(install.body.runs, 3);
  // The second gate behind the UI's own confirm.
  assert.equal(install.body.confirm, true);
  // The panel reloaded, so it shows server truth rather than an optimistic edit.
  assert.ok(
    requests.filter((entry) => entry.path === "/api/bridge/industry").length >= 1,
    "the panel must reload after a mutation",
  );
  assert.equal(store.get().industry.actionError, null);
});

test("a SILENT decline is reported as a decline with no invented cause", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/bridge/industry/install"
        ? {
            status: 200,
            body: { ok: true, applied: false, declinedSilently: true, jobID: null },
          }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  await flow.installIndustryJob({
    blueprintItemID: BLUEPRINT_ITEM_ID,
    blueprintTypeID: BLUEPRINT_TYPE_ID,
    activity: "manufacturing",
    facilityID: STATION_ID,
    runs: 1,
  });

  const message = store.get().industry.actionError ?? "";
  assert.match(message, /gave no reason/i);
  // It must not guess at a cause the server never gave.
  assert.doesNotMatch(message, /material|fee|slot|skill/i);
});

test("a STRUCTURED refusal becomes the server's own reasons in plain words", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/bridge/industry/install"
        ? {
            status: 409,
            body: {
              ok: false,
              error: "CALL_REFUSED",
              message: "IndustryValidationError: MISSING_MATERIAL, ACCOUNT_FUNDS",
            },
          }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  await flow.installIndustryJob({
    blueprintItemID: BLUEPRINT_ITEM_ID,
    blueprintTypeID: BLUEPRINT_TYPE_ID,
    activity: "manufacturing",
    facilityID: STATION_ID,
    runs: 1,
  });

  const message = store.get().industry.actionError ?? "";
  assert.match(message, /materials/i, "the server said MISSING_MATERIAL");
  assert.match(message, /installation fee/i, "the server said ACCOUNT_FUNDS");
  // The raw code is jargon and must never reach the player (R9a / R7d).
  assert.doesNotMatch(message, /MISSING_MATERIAL|ACCOUNT_FUNDS|IndustryValidationError/);
});

test("a PROSE refusal is passed through verbatim - the handler's own words", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(
    respondOk((path, _method, body) =>
      path === "/api/bridge/call" && body.method === "CompleteJob"
        ? {
            status: 409,
            body: {
              ok: false,
              error: "CALL_REFUSED",
              message: "That industry job is not ready yet.",
            },
          }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  await flow.loadIndustry();
  const reads = requests.filter((entry) => entry.path === "/api/bridge/industry").length;
  await flow.deliverIndustryJob(JOB_ID);
  assert.equal(store.get().industry.actionError, "That industry job is not ready yet.");
  // A refusal is told as it came: the panel is not read again over it.
  assert.equal(requests.filter((entry) => entry.path === "/api/bridge/industry").length, reads);
});

test("deliver and cancel are the page's own calls, with the job's own solar system; each reloads the panel and clears a stale error", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(
    respondOk((path, _method, body) =>
      path === "/api/bridge/call" ? called(body, jobAnswered(body.method === "CompleteJob" ? 101 : 102)) : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });
  await flow.loadIndustry();
  const reads = () => requests.filter((entry) => entry.path === "/api/bridge/industry").length;
  const before = reads();

  store.apply({ type: "industry/action-error", message: "something old" });
  await flow.deliverIndustryJob(JOB_ID);
  assert.equal(store.get().industry.actionError, null);
  assert.equal(reads(), before + 1);

  store.apply({ type: "industry/action-error", message: "something old" });
  await flow.cancelIndustryJob(JOB_ID);
  assert.equal(store.get().industry.actionError, null);
  assert.equal(reads(), before + 2);

  // industrySvc.py 150 and 160: CompleteJob(int(jobID), solarSystemID), and CancelJob the same, as a pilot's
  // write the page means. The system is the job's own, as its row has it.
  assert.deepEqual(
    requests.filter((entry) => entry.path === "/api/bridge/call").map((entry) => entry.body),
    [
      { service: "industryManager", method: "CompleteJob", args: [JOB_ID, JOB_SOLAR_SYSTEM_ID], kwargs: null, pilot: true, confirm: true },
      { service: "industryManager", method: "CancelJob", args: [JOB_ID, JOB_SOLAR_SYSTEM_ID], kwargs: null, pilot: true, confirm: true },
    ],
  );
  // Neither route is asked.
  assert.deepEqual(requests.filter((entry) => entry.path.startsWith("/api/bridge/industry/")), []);
});

test("a job the server answers as it was is told as a decline with no invented cause", async () => {
  for (const [act, status] of [["deliver", 3], ["cancel", 1]] as const) {
    const store = createClientStore();
    const { fetch, requests } = makeFakeFetch(
      respondOk((path, _method, body) => (path === "/api/bridge/call" ? called(body, jobAnswered(status)) : null)),
    );
    const flow = createAppFlow(store, { fetch });
    await flow.loadIndustry();
    await (act === "deliver" ? flow.deliverIndustryJob(JOB_ID) : flow.cancelIndustryJob(JOB_ID));
    const message = store.get().industry.actionError ?? "";
    assert.match(message, /gave no reason/i, act);
    assert.doesNotMatch(message, /material|fee|slot|skill|ready/i, act);
    // It is the call's own answer that was read so, and the panel read again after it.
    assert.deepEqual(
      requests.filter((entry) => entry.path !== "/api/names" && entry.path !== "/api/industry/blueprints").map((entry) => (entry.path === "/api/bridge/call" ? entry.body.method : entry.path)),
      ["/api/bridge/industry", act === "deliver" ? "CompleteJob" : "CancelJob", "/api/bridge/industry"],
      act,
    );
  }
});

test("a job that is not among those read is not asked for: its solar system is not known", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(respondOk());
  const flow = createAppFlow(store, { fetch });

  // Nothing read yet.
  await flow.deliverIndustryJob(JOB_ID);
  assert.equal(store.get().industry.actionError, "That job is not among your jobs as they were last read.");
  // Read, and another job asked for.
  await flow.loadIndustry();
  assert.equal(store.get().industry.actionError, null);
  await flow.cancelIndustryJob(JOB_ID + 1);
  assert.equal(store.get().industry.actionError, "That job is not among your jobs as they were last read.");
  await flow.deliverIndustryJob(JOB_ID + 1);
  assert.equal(store.get().industry.actionError, "That job is not among your jobs as they were last read.");
  assert.deepEqual(requests.filter((entry) => entry.path === "/api/bridge/call" || entry.path.startsWith("/api/bridge/industry/")), []);
});

test("the preview returns what the player HAS and the time the job will take, and starts nothing", async () => {
  const store = createClientStore();
  let timeSeconds: number | null | string = 1163;
  let fee: Record<string, number> | string | null | undefined = { cost: 5284, tax: 1321, sccSurcharge: 5284, securityTax: 0, total: 11889 };
  let materials: Record<string, number | string> | string | null | undefined = { "38": 230 };
  const { fetch, requests } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/bridge/industry/preview"
        ? { status: 200, body: { ok: true, available: { "38": 500 }, timeSeconds, fee, materials } }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });
  const request = {
    blueprintItemID: BLUEPRINT_ITEM_ID,
    blueprintTypeID: BLUEPRINT_TYPE_ID,
    activity: "manufacturing" as const,
    facilityID: STATION_ID,
    runs: 3,
    timeEfficiency: 5,
    materialEfficiency: 10,
  };

  const previewed = await flow.previewIndustryJob(request);
  assert.deepEqual(previewed, { available: { "38": 500 }, timeSeconds: 1163, fee: { cost: 5284, tax: 1321, sccSurcharge: 5284, securityTax: 0, total: 11889 }, materials: { "38": 230 }, monitorID: null });
  // Materials that were not reckoned, or that are none, are none.
  const noMaterials: (Record<string, number | string> | string | null | undefined)[] = [null, undefined, "230", { "38": "230" }, { "38": 0 }];
  for (const none of noMaterials) {
    materials = none;
    assert.equal((await flow.previewIndustryJob(request)).materials, null, JSON.stringify(none));
  }
  materials = { "38": 230 };
  // A fee that was not reckoned, or that is no fee, is none.
  const noFees: (Record<string, number> | string | null | undefined)[] = [null, undefined, "11889", { cost: 5284 }, { cost: 5284, tax: 1321, sccSurcharge: 5284, securityTax: 0, total: 1 }];
  for (const none of noFees) {
    fee = none;
    assert.equal((await flow.previewIndustryJob(request)).fee, null, JSON.stringify(none));
  }
  fee = null;
  // The blueprint's time research goes with the request: the job's time is reckoned from it. And its material
  // research, from which its materials are.
  const sent = requests.find((entry) => entry.path === "/api/bridge/industry/preview");
  assert.equal((sent?.body as { timeEfficiency?: number }).timeEfficiency, 5);
  assert.equal((sent?.body as { materialEfficiency?: number }).materialEfficiency, 10);
  // A time that could not be reckoned, or that is no time, is none.
  for (const none of [null, "soon", 0, -4, 1.5]) {
    timeSeconds = none as number | null | string;
    assert.equal((await flow.previewIndustryJob(request)).timeSeconds, null, String(none));
  }
  const { available } = previewed;
  assert.deepEqual(available, { "38": 500 });
  assert.equal(
    requests.some((entry) => entry.path === "/api/bridge/industry/install"),
    false,
    "a preview must never install anything",
  );
});

test("the window's own events are told to the pilot's transport, and nothing is said where they could not be", async () => {
  const store = createClientStore();
  let status = 200;
  const { fetch, requests } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/bridge/industry/window"
        ? (status === 200 ? { status: 200, body: { ok: true, kept: true } } : { status, body: { ok: false, error: "NO_LIVE_SESSION", message: "no pilot" } })
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });
  const told = () => requests.filter((entry) => entry.path === "/api/bridge/industry/window").map((entry) => [entry.method, entry.body]);

  // The window closed, and its job let go while it stays: each is one event, and nothing else is asked.
  await flow.industryWindowClosed();
  await flow.industryJobLetGo();
  assert.deepEqual(told(), [["POST", { event: "closed" }], ["POST", { event: "job-let-go" }]]);
  assert.equal(requests.length, 2);
  // Where it could not be told (no pilot is held, the BFF is gone) the window is closed all the same: nothing
  // fails, and the panel says nothing of it.
  status = 409;
  await flow.industryWindowClosed();
  await flow.industryJobLetGo();
  assert.equal(told().length, 4);
  assert.equal(store.get().industry.actionError, null);
});

test("a lost session during a mutation unwinds to character select", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 404,
    body: { ok: false, error: "SESSION_NOT_FOUND", message: "gone" },
  }));
  const flow = createAppFlow(store, { fetch });

  await assert.rejects(() =>
    flow.installIndustryJob({
      blueprintItemID: BLUEPRINT_ITEM_ID,
      blueprintTypeID: BLUEPRINT_TYPE_ID,
      activity: "manufacturing",
      facilityID: STATION_ID,
      runs: 1,
    }),
  );
  assert.equal(store.get().station.online, null);
});

test("an invention install carries its decryptor; the decryptor list is read from static data", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(
    respondOk((path) =>
      path === "/api/industry/invention-terms"
        ? {
            status: 200,
            body: {
              ok: true,
              lowerRateSkillTypeIDs: [],
              decryptors: [{ typeID: 34204, name: "Parity Decryptor", probabilityMultiplier: 1.5, materialEfficiency: 1, timeEfficiency: -2, maxRuns: 3 }],
            },
          }
        : null,
    ),
  );
  const flow = createAppFlow(store, { fetch });

  const decryptors = await flow.loadDecryptors();
  assert.deepEqual(decryptors.map((decryptor) => [decryptor.typeID, decryptor.maxRuns]), [[34204, 3]]);

  await flow.installIndustryJob({
    blueprintItemID: BLUEPRINT_ITEM_ID,
    blueprintTypeID: BLUEPRINT_TYPE_ID,
    activity: "invention",
    facilityID: STATION_ID,
    runs: 2,
    decryptorTypeID: 34204,
  });
  const install = requests.find((entry) => entry.path === "/api/bridge/industry/install");
  assert.ok(install);
  assert.equal(install.body.decryptorTypeID, 34204);
  assert.equal(install.body.confirm, true);
});
