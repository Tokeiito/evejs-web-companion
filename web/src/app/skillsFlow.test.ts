// R28 skills WIRED THROUGH THE FLOW, against a faked BFF.
//
// `bridge/skills.test.ts` pins the arithmetic and the wording against synthetic
// state; this pins the other half — that a queue edit is ONE call, that what
// lands in the store is always the RE-READ sheet, and that a refusal never
// leaves an edit looking like it worked.
//
// The claim under test that is easiest to get wrong: skillMgr.SaveNewQueue
// returns null on success. If the flow ever believed its own POST instead of
// the sheet that came back with it, a refused or half-applied edit would show
// on screen as a queue the server does not have.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

interface Recorded {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

const GUNNERY = 3300;
const INDUSTRY = 3380;
const SURGICAL = 3315;

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

/** The queue a save by the page's own call names: each place's skill and level, in order. */
function savedPlaces(body: Record<string, unknown>): { typeID: number; toLevel: number }[] {
  const places = ((body.args as { entries: [number, [number, number]][] }[])[0]!).entries;
  return places.map(([, [typeID, toLevel]]) => ({ typeID, toLevel }));
}

/** The sheet envelope the BFF returns, with a queue we control. */
function sheetBody(
  entries: readonly { typeID: number; toLevel: number }[],
  serverNowMs = 1_784_617_000_000,
  paused = false,
): unknown {
  return {
    ok: true,
    skills: {
      characterName: "Test Two",
      totalSkillPoints: 384402,
      freeSkillPoints: 0,
      serverNowMs,
      skills: [
        {
          typeID: GUNNERY,
          name: "Gunnery",
          groupName: "Gunnery",
          level: 4,
          rank: 1,
          skillPoints: 45255,
          levelSkillPoints: [250, 1414, 8000, 45255, 256000],
          inTraining: !paused && entries[0]?.typeID === GUNNERY,
        },
        {
          typeID: SURGICAL,
          name: "Surgical Strike",
          groupName: "Gunnery",
          level: 0,
          rank: 4,
          skillPoints: 0,
          levelSkillPoints: [1000, 5657, 32000, 181019, 1024000],
          inTraining: false,
        },
        {
          typeID: INDUSTRY,
          name: "Industry",
          groupName: "Production",
          level: 1,
          rank: 1,
          skillPoints: 250,
          levelSkillPoints: [250, 1414, 8000, 45255, 256000],
          inTraining: false,
        },
      ],
      queue: {
        active: entries.length > 0 && !paused,
        maxEntries: 150,
        endTimeMs: entries.length > 0 && !paused ? serverNowMs + entries.length * 3_600_000 : null,
        entries: entries.map((entry, index) => ({
          queuePosition: index,
          typeID: entry.typeID,
          toLevel: entry.toLevel,
          startSP: 0,
          destinationSP: 1000,
          // A paused queue's entries have no start and no end, and nothing trains at any rate.
          startTimeMs: paused ? null : serverNowMs + index * 3_600_000,
          endTimeMs: paused ? null : serverNowMs + (index + 1) * 3_600_000,
          skillPointsPerMinute: index === 0 && !paused ? 30 : 0,
        })),
      },
    },
  };
}

test("loading the sheet lands the skills, the queue and the server's clock", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(() => ({
    status: 200,
    body: sheetBody([{ typeID: GUNNERY, toLevel: 5 }]),
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadSkills();

  assert.deepEqual(requests.map((request) => request.path), ["/api/bridge/skills"]);
  const skills = store.get().skills;
  assert.equal(skills.loaded, true);
  assert.equal(skills.characterName, "Test Two");
  assert.equal(skills.totalSkillPoints, 384402);
  assert.equal(skills.skills?.length, 3);
  assert.equal(skills.queue?.entries.length, 1);
  assert.equal(skills.error, null);
});

test("a failed read says so and leaves the sheet UNKNOWN, never empty", () => {
  const store = createClientStore();
  // Before any read: null, not [] — a character who knows nothing is a
  // different thing from a sheet we could not fetch.
  assert.equal(store.get().skills.skills, null);
  assert.equal(store.get().skills.queue, null);
  assert.equal(store.get().skills.loaded, false);
});

test("a read failure reports it without inventing a sheet", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 502,
    body: { ok: false, error: "CALL_FAILED", message: "the gateway is down" },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadSkills();

  const skills = store.get().skills;
  assert.match(skills.error ?? "", /could not be read/);
  assert.equal(skills.skills, null, "a failed read must not become an empty sheet");
  assert.equal(skills.loaded, false);
});

test("adding, removing and reordering are ONE call: save the whole list", async () => {
  const store = createClientStore();
  let queue: { typeID: number; toLevel: number }[] = [];
  const { fetch, requests } = makeFakeFetch((path, method, body) => {
    // The save is the page's own call, a write it says it means (bridge/skillWrites.ts): the whole queue by place.
    if (path === "/api/bridge/call" && body.service === "skillHandler" && body.method === "SaveNewQueue") {
      queue = savedPlaces(body);
      return { status: 200, body: { ok: true, service: "skillHandler", method: "SaveNewQueue", result: null, notifications: [] } };
    }
    return { status: 200, body: sheetBody(queue) };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.saveSkillQueue([{ typeID: GUNNERY, toLevel: 5 }], "Added Gunnery V", "Gunnery");
  assert.deepEqual(
    store.get().skills.queue?.entries.map((entry) => [entry.typeID, entry.toLevel]),
    [[GUNNERY, 5]],
  );

  // Add a second — the client sends the WHOLE list, not a delta.
  await flow.saveSkillQueue(
    [{ typeID: GUNNERY, toLevel: 5 }, { typeID: SURGICAL, toLevel: 1 }],
    "Added Surgical Strike I",
    "Surgical Strike",
  );
  assert.deepEqual(requests.at(-2)!.body, {
    service: "skillHandler",
    method: "SaveNewQueue",
    args: [{ type: "dict", entries: [[0, [GUNNERY, 5]], [1, [SURGICAL, 1]]] }],
    kwargs: { activate: true },
    pilot: true,
    confirm: true,
  });
  // And the sheet read again after it, which is what lands.
  assert.deepEqual([requests.at(-1)!.method, requests.at(-1)!.path], ["GET", "/api/bridge/skills"]);

  // Reorder, then remove — same call, same shape, every time.
  await flow.saveSkillQueue(
    [{ typeID: SURGICAL, toLevel: 1 }, { typeID: GUNNERY, toLevel: 5 }],
    "Moved Surgical Strike up",
    "Surgical Strike",
  );
  assert.deepEqual(
    store.get().skills.queue?.entries.map((entry) => entry.typeID),
    [SURGICAL, GUNNERY],
  );

  await flow.saveSkillQueue([], "Emptied the queue", "your queue");
  assert.deepEqual(store.get().skills.queue?.entries, []);
  assert.equal(store.get().skills.queue?.active, false);

  // Exactly one call for every one of those edits, and never the queue's route.
  assert.deepEqual(
    requests.filter((request) => request.method === "POST").map((r) => [r.path, r.body.method]),
    [1, 2, 3, 4].map(() => ["/api/bridge/call", "SaveNewQueue"]),
  );
  assert.deepEqual(savedPlaces(requests.filter((request) => request.method === "POST").at(-1)!.body), []);
});

test("pausing asks the server to stop the skill in training and re-reads: the queue is KEPT, and starting is a save of it", async () => {
  const store = createClientStore();
  const queue = [{ typeID: GUNNERY, toLevel: 5 }, { typeID: SURGICAL, toLevel: 1 }];
  let paused = false;
  const { fetch, requests } = makeFakeFetch((path, method, body) => {
    // The pause is the page's own call, a write it says it means (bridge/skillWrites.ts).
    if (path === "/api/bridge/call" && body.service === "skillHandler" && body.method === "AbortTraining") {
      paused = true;
      return { status: 200, body: { ok: true, service: "skillHandler", method: "AbortTraining", result: null, notifications: [] } };
    }
    if (path === "/api/bridge/call" && body.service === "skillHandler" && body.method === "SaveNewQueue") {
      paused = false;
      return { status: 200, body: { ok: true, service: "skillHandler", method: "SaveNewQueue", result: null, notifications: [] } };
    }
    return { status: 200, body: sheetBody(queue, undefined, paused) };
  });
  const flow = createAppFlow(store, { fetch });
  await flow.loadSkills();
  requests.length = 0;

  await flow.pauseSkillTraining();
  // The retail client's pause: one call that stops the skill in training, and the sheet read again. The call is
  // the handler's own, with nothing, made as a pilot's and as a write the page means; its route is not asked.
  assert.deepEqual(requests.map((request) => [request.method, request.path]), [
    ["POST", "/api/bridge/call"],
    ["GET", "/api/bridge/skills"],
  ]);
  assert.deepEqual(requests[0]!.body, { service: "skillHandler", method: "AbortTraining", args: [], kwargs: null, pilot: true, confirm: true });
  // What is on screen is the server's: every skill still queued, none of them training, no end in sight.
  const kept = store.get().skills.queue!;
  assert.deepEqual([kept.active, kept.endTimeMs, kept.entries.map((entry) => [entry.typeID, entry.toLevel, entry.startTimeMs, entry.endTimeMs])], [
    false, null, [[GUNNERY, 5, null, null], [SURGICAL, 1, null, null]],
  ]);
  assert.equal(store.get().skills.lastAction, "Paused training");

  // Starting again is the queue saved as it stands.
  requests.length = 0;
  await flow.saveSkillQueue(queue, "Started training", "your queue");
  const started = requests.at(0)!;
  assert.deepEqual([started.path, started.body.method, savedPlaces(started.body), started.body.kwargs, store.get().skills.queue?.active], ["/api/bridge/call", "SaveNewQueue", queue, { activate: true }, true]);
});

test("a pause the server will not make says so, and re-reads so nothing looks paused", async () => {
  const store = createClientStore();
  const queue = [{ typeID: GUNNERY, toLevel: 5 }];
  const { fetch, requests } = makeFakeFetch((path, method, body) => (path === "/api/bridge/call" && body.method === "AbortTraining"
    ? { status: 409, body: { ok: false, error: "CALL_REFUSED", message: "NotNow" } }
    : { status: 200, body: sheetBody(queue) }));
  const flow = createAppFlow(store, { fetch });
  await flow.loadSkills();
  requests.length = 0;
  await flow.pauseSkillTraining();
  assert.match(store.get().skills.actionError ?? "", /could not be paused/);
  assert.deepEqual([requests.map((request) => request.path), store.get().skills.queue?.active], [["/api/bridge/call", "/api/bridge/skills"], true]);
});

test("what lands in the store is the RE-READ sheet, not the edit we asked for", async () => {
  const store = createClientStore();
  // ⚠ The server accepts the call and stores something DIFFERENT (here: it
  // dropped the second entry). A client that believed its own request would
  // now show a queue that does not exist.
  const { fetch } = makeFakeFetch((path, method, body) => (path === "/api/bridge/call"
    ? { status: 200, body: { ok: true, service: body.service, method: body.method, result: null, notifications: [] } }
    : { status: 200, body: sheetBody([{ typeID: GUNNERY, toLevel: 5 }]) }));
  const flow = createAppFlow(store, { fetch });

  await flow.saveSkillQueue(
    [{ typeID: GUNNERY, toLevel: 5 }, { typeID: SURGICAL, toLevel: 1 }],
    "Added two skills",
    "Surgical Strike",
  );

  assert.deepEqual(
    store.get().skills.queue?.entries.map((entry) => entry.typeID),
    [GUNNERY],
    "the sheet the server sent back is what the panel shows",
  );
  assert.equal(store.get().skills.lastAction, "Added two skills");
});

test("a refusal becomes player language AND re-reads, so nothing looks applied", async () => {
  const store = createClientStore();
  const paths: string[] = [];
  const { fetch } = makeFakeFetch((path, method) => {
    paths.push(`${method} ${path}`);
    if (path === "/api/bridge/call") {
      // Exactly what the BFF passes through for a refused save: a
      // CALL_REFUSED carrying the server's bare code as the message.
      return {
        status: 409,
        body: {
          ok: false,
          error: "CALL_REFUSED",
          message: "QueueCannotPlaceSkillBeforeRequirements",
        },
      };
    }
    return { status: 200, body: sheetBody([]) };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.saveSkillQueue(
    [{ typeID: SURGICAL, toLevel: 1 }],
    "Added Surgical Strike I",
    "Surgical Strike",
  );

  const skills = store.get().skills;
  assert.equal(
    skills.actionError,
    "Surgical Strike needs another skill trained first. Put the skill it depends on ahead of it in the queue.",
  );
  // R9a: the code itself never reaches the player.
  assert.equal(skills.actionError?.includes("QueueCannot"), false);
  // The optimistic order on screen is replaced by the server's actual queue.
  assert.deepEqual(skills.queue?.entries, []);
  assert.equal(skills.lastAction, null, "a refused edit is not an action taken");
  assert.deepEqual(paths, [
    "POST /api/bridge/call",
    "GET /api/bridge/skills",
  ]);
});

test("a lost session unwinds to character select instead of blaming the queue", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 404,
    body: { ok: false, error: "SESSION_NOT_FOUND", message: "gone" },
  }));
  const flow = createAppFlow(store, { fetch });

  await assert.rejects(() => flow.loadSkills());
  assert.equal(store.get().station.online, null, "the page returns to character select");
  assert.equal(store.get().skills.error, null, "this is not a skills problem");
});

test("going offline drops the sheet, so another character never sees these skills", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: sheetBody([{ typeID: GUNNERY, toLevel: 5 }]),
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadSkills();
  assert.equal(store.get().skills.loaded, true);

  store.apply({ type: "character/offline" });
  assert.equal(store.get().skills.skills, null);
  assert.equal(store.get().skills.queue, null);
  assert.equal(store.get().skills.loaded, false);
});

// ── the sheet made by the page itself (bridge/skillReads.ts; the plan's Phase 6b) ──
//
// The tests above read the sheet with nobody chosen, where the flow reads the route's (and the route, were it a
// real one, would refuse). With a pilot chosen the flow makes the sheet from the reads it asks for itself, as the
// client's skill and queue services ask them, and reads the route's only where the queue's read is not carried:
// through the web gateway.

const AFTERBURNER = 3450;
const HANDLER_ENTRY = "characterskills.common.character_skill_entry.CharacterSkillEntry";
const skillEntry = (typeID: number, level: number, points: number, rank = 1) =>
  ({ type: "objectex1", header: [{ type: "token", value: HANDLER_ENTRY }, [typeID, level, points, rank, null], { type: "dict", entries: [] }], list: [], dict: [] });
const skillsDict = (...entries: ReturnType<typeof skillEntry>[]) => ({ type: "dict", entries: entries.map((entry) => [(entry.header[1] as number[])[0], entry]) });
const filetime = (ms: number) => ({ type: "long", value: String(BigInt(ms) * 10000n + 116444736000000000n) });
const queueEntry = (typeID: number, toLevel: number, startMs: number | null, endMs: number | null) => ({
  type: "object",
  name: "util.KeyVal",
  args: { type: "dict", entries: [["queuePosition", 0], ["trainingTypeID", typeID], ["trainingToLevel", toLevel], ["trainingStartSP", 8000], ["trainingDestinationSP", 45255], ["trainingStartTime", startMs === null ? null : filetime(startMs)], ["trainingEndTime", endMs === null ? null : filetime(endMs)]] },
});
/** The browser's clock, held still, and a server two hours ahead of it. */
const BROWSER_NOW = 1_791_600_000_000;
const SERVER_AHEAD = 7_200_000;

interface PilotBff {
  /** What the handler's reads answer now; `null` for the queue's is the web gateway, which does not carry it. */
  queue: unknown[] | null;
  paused: boolean;
  /** Why a call fails, by its method: the status, the code, and the message where it is not the usual one. */
  fails: Record<string, readonly [number, string, string?]>;
  /** Whether an answer says the server's clock. */
  saysClock: boolean;
  /** False where a test does not count the static data's asking in what was asked. */
  countsStatic?: boolean;
  /** Whether the account's other character has a skill in training, by the selection screen's data. */
  otherTrains?: boolean;
  /** Whether the server says the account's training changed as it answers a save, as it does. */
  tellsTraining?: boolean;
}

/** A BFF with a pilot chosen: the generic call for the skill handler, the static data, the route, and the pause. */
function pilotBff(state: PilotBff): { fetch: typeof fetch; asked: () => string[]; slotsAsked: () => string[]; requests: Recorded[] } {
  const made = makeFakeFetch((path, method, body) => {
    if (path === "/api/bridge/select") {
      return { status: 200, body: { ok: true, character: { characterID: 140000002, characterName: "Test Two", stationID: 60000004, structureID: null, solarSystemID: 30000142, corporationID: 98000000 }, station: null, notifications: [] } };
    }
    // The two reads the client's queue service reckons the account's training slots from (bridge/trainingSlots.ts).
    // The game port carries the first; the web gateway's list has not got it.
    if (path === "/api/bridge/call" && body.service === "userSvc" && body.method === "GetMultiCharactersTrainingSlots") {
      return state.queue === null
        ? { status: 403, body: { ok: false, error: "CALL_NOT_ALLOWED", message: "userSvc.GetMultiCharactersTrainingSlots is not on the web-call allowlist." } }
        : { status: 200, body: { ok: true, service: body.service, method: body.method, result: { type: "dict", entries: [] }, notifications: [] } };
    }
    if (path === "/api/bridge/call" && body.service === "charUnboundMgr" && body.method === "GetCharacterSelectionData") {
      const row = (characterID: number, training: boolean) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["characterID", characterID], ["skillTypeID", training ? GUNNERY : null]] } });
      const characters = { type: "list", items: [row(140000002, true), row(140000003, state.otherTrains === true)] };
      return { status: 200, body: { ok: true, service: body.service, method: body.method, result: [{ type: "list", items: [] }, [null, null], characters, { type: "list", items: [] }], notifications: [] } };
    }
    if (path === "/api/bridge/call" && body.service === "skillHandler") {
      const failure = state.fails[String(body.method)];
      if (failure) return { status: failure[0], body: { ok: false, error: failure[1], message: failure[2] ?? `${String(body.method)} failed.` } };
      // The queue's saving: the handler's own call, which the game port carries and the web gateway does not.
      if (body.method === "SaveNewQueue") {
        if (state.queue === null) return { status: 403, body: { ok: false, error: "CALL_NOT_ALLOWED", message: "skillHandler.SaveNewQueue is not on the web-call allowlist." } };
        const places = ((body.args as { entries: [number, [number, number]][] }[])[0]!).entries;
        state.queue = places.map(([, [typeID, toLevel]]) => queueEntry(typeID, toLevel, BROWSER_NOW + SERVER_AHEAD - 60_000, BROWSER_NOW + SERVER_AHEAD + 3_600_000));
        state.paused = false;
        const told = state.tellsTraining === true ? [{ kind: "client", method: "OnMultipleCharactersTrainingUpdated", args: [] }] : [];
        return { status: 200, body: { ok: true, service: body.service, method: body.method, result: null, notifications: told } };
      }
      // The pause: the handler's own call, which either transport carries.
      if (body.method === "AbortTraining") {
        state.paused = true;
        return { status: 200, body: { ok: true, service: body.service, method: body.method, result: null, notifications: [] } };
      }
      const queue = (state.queue ?? []).map((entry) => (state.paused ? queueEntry(AFTERBURNER, 4, null, null) : entry)) as unknown[];
      const answers: Record<string, unknown> = {
        GetSkillQueueAndFreePoints: [{ type: "list", items: queue }, 0],
        GetSkills: skillsDict(skillEntry(GUNNERY, 4, 45255), skillEntry(AFTERBURNER, 3, 8000)),
        GetAllSkills: skillsDict(skillEntry(GUNNERY, 4, 45255), skillEntry(AFTERBURNER, 3, 8000), skillEntry(INDUSTRY, 1, 250)),
        GetFreeSkillPoints: 700,
        GetAttributes: { type: "dict", entries: [[164, 20], [165, 20], [166, 20], [167, 20], [168, 20]] },
      };
      if (body.method === "GetSkillQueueAndFreePoints" && state.queue === null) {
        return { status: 403, body: { ok: false, error: "CALL_NOT_ALLOWED", message: "skillHandler.GetSkillQueueAndFreePoints is not on the web-call allowlist." } };
      }
      return { status: 200, body: { ok: true, service: body.service, method: body.method, result: answers[String(body.method)] ?? null, notifications: [], ...(state.saysClock ? { serverNowMs: Date.now() + SERVER_AHEAD } : {}) } };
    }
    if (path === "/api/names") {
      const names: Record<string, string> = { [`type:${GUNNERY}`]: "Gunnery", [`typeGroup:${GUNNERY}`]: "Gunnery", [`type:${AFTERBURNER}`]: "Afterburner", [`typeGroup:${AFTERBURNER}`]: "Navigation" };
      return { status: 200, body: { ok: true, names: Object.fromEntries((body.items as { kind: string; id: number }[]).map((item) => [`${item.kind}:${item.id}`, names[`${item.kind}:${item.id}`] ?? null])), unresolved: [] } };
    }
    if (path === "/api/types/dogma") return { status: 200, body: { ok: true, attributes: { [AFTERBURNER]: { 180: 166, 181: 164 } } } };
    if (path === "/api/bridge/skills") return { status: 200, body: sheetBody([{ typeID: GUNNERY, toLevel: 5 }]) };
    // The route's save, which answers the route's sheet of what it saved.
    if (path === "/api/bridge/skills/queue") return { status: 200, body: sheetBody(body.entries as { typeID: number; toLevel: number }[]) };
    // (What else a choosing asks by the generic call is answered with nothing.)
    if (path === "/api/bridge/call") return { status: 200, body: { ok: true, service: body.service, method: body.method, result: null, notifications: [] } };
    return { status: 200, body: { ok: true } };
  });
  /** What was asked for the sheet, in order: the handler's reads by their names, and the routes by their paths. */
  const asked = () => made.requests
    .filter((request) => (request.path === "/api/bridge/call" && request.body.service === "skillHandler") || /^\/api\/(names|types\/dogma|bridge\/skills)/.test(request.path))
    // (A type's names and attributes are asked for once and kept: whether they are asked here is another test's.)
    .filter((request) => !/^\/api\/(names|types\/dogma)/.test(request.path) || state.countsStatic !== false)
    .map((request) => (request.path === "/api/bridge/call" ? String(request.body.method) : `${request.method} ${request.path}`));
  /** What was asked to reckon the training slots, in order. */
  const slotsAsked = () => made.requests
    .filter((request) => request.path === "/api/bridge/call" && (request.body.service === "userSvc" || request.body.service === "charUnboundMgr"))
    .map((request) => `${String(request.body.service)}.${String(request.body.method)}`);
  return { fetch: made.fetch, asked, slotsAsked, requests: made.requests };
}

/** Runs `body` with the browser's clock held still. */
async function atBrowserNow<T>(body: () => Promise<T>): Promise<T> {
  const realNow = Date.now;
  Date.now = () => BROWSER_NOW;
  try {
    return await body();
  } finally {
    Date.now = realNow;
  }
}

const noStream = () => ({ onmessage: null, onopen: null, onerror: null, close() {} });
const TRAINING_SINCE = BROWSER_NOW + SERVER_AHEAD - 120_000;

test("with a pilot chosen, the sheet is made by the page from the reads it asks for itself, and the route is not read", () => atBrowserNow(async () => {
  const store = createClientStore();
  const state: PilotBff = { queue: [queueEntry(AFTERBURNER, 4, TRAINING_SINCE, TRAINING_SINCE + 3_600_000)], paused: false, fails: {}, saysClock: true };
  const { fetch, asked, requests } = pilotBff(state);
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  requests.length = 0;

  await flow.loadSkills();
  // The client's own reads, the queue first; then what is known of the types, once; and no route's sheet.
  assert.deepEqual(asked(), ["GetSkillQueueAndFreePoints", "GetSkills", "GetAllSkills", "GetFreeSkillPoints", "GetAttributes", "POST /api/names", "POST /api/types/dogma"]);
  // Each is asked as a pilot's call, with nothing.
  assert.deepEqual(requests.filter((request) => request.path === "/api/bridge/call").map((request) => [request.body.args, request.body.pilot]), Array(5).fill([[], true]));
  assert.deepEqual(requests.find((request) => request.path === "/api/names")?.body, { items: [{ kind: "type", id: GUNNERY }, { kind: "typeGroup", id: GUNNERY }, { kind: "type", id: AFTERBURNER }, { kind: "typeGroup", id: AFTERBURNER }] });
  assert.deepEqual(requests.find((request) => request.path === "/api/types/dogma")?.body, { typeIDs: [AFTERBURNER], attributeIDs: [180, 181] });

  const skills = store.get().skills;
  // Whose it is comes from the pilot chosen; the rows from the reads and the static data's names.
  assert.deepEqual([skills.loaded, skills.error, skills.characterName, skills.freeSkillPoints, skills.totalSkillPoints], [true, null, "Test Two", 700, 45255 + 8000 + 250 + 700]);
  // The server's clock is what the answers said: two hours ahead of this browser's.
  assert.equal(skills.clockOffsetMs, SERVER_AHEAD);
  // Two minutes of training at 30 a minute, reckoned by the server's clock and not the browser's.
  assert.deepEqual(skills.skills?.map((row) => [row.name, row.groupName, row.level, row.skillPoints, row.inTraining]), [["Afterburner", "Navigation", 3, 8060, true], ["Gunnery", "Gunnery", 4, 45255, false]]);
  assert.deepEqual([skills.queue?.active, skills.queue?.entries.map((entry) => [entry.typeID, entry.toLevel, entry.startTimeMs, entry.endTimeMs, entry.skillPointsPerMinute])], [true, [[AFTERBURNER, 4, TRAINING_SINCE, TRAINING_SINCE + 3_600_000, 30]]]);

  // Read again: the reads again, which a transport answers from what it keeps; of the types nothing more is asked.
  requests.length = 0;
  await flow.loadSkills();
  assert.deepEqual(asked(), ["GetSkillQueueAndFreePoints", "GetSkills", "GetAllSkills", "GetFreeSkillPoints", "GetAttributes"]);
}));

test("with nothing in training the attributes are not asked for, and an answer that says no clock leaves the browser's", () => atBrowserNow(async () => {
  const store = createClientStore();
  const { fetch, asked, requests } = pilotBff({ queue: [], paused: false, fails: {}, saysClock: false });
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  requests.length = 0;
  await flow.loadSkills();
  assert.deepEqual(asked(), ["GetSkillQueueAndFreePoints", "GetSkills", "GetAllSkills", "GetFreeSkillPoints", "POST /api/names"]);
  const skills = store.get().skills;
  assert.deepEqual([skills.loaded, skills.clockOffsetMs, skills.queue?.active, skills.queue?.entries.length, skills.skills?.some((row) => row.inTraining)], [true, 0, false, 0, false]);
}));

test("through the web gateway the queue's read is not carried: the page asks, is told so, and reads the route's sheet as before", async () => {
  const store = createClientStore();
  const { fetch, asked, requests } = pilotBff({ queue: null, paused: false, fails: {}, saysClock: false });
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  requests.length = 0;
  await flow.loadSkills();
  assert.deepEqual(asked(), ["GetSkillQueueAndFreePoints", "GET /api/bridge/skills"]);
  const skills = store.get().skills;
  // The route's sheet, as it is: its own three skills and its own name for whose it is.
  assert.deepEqual([skills.loaded, skills.error, skills.skills?.length, skills.totalSkillPoints, skills.queue?.entries.map((entry) => entry.typeID)], [true, null, 3, 384402, [GUNNERY]]);
});

test("a read of the page's own that fails is the sheet's failure, said, and the route is not read in its place", async () => {
  for (const method of ["GetSkillQueueAndFreePoints", "GetAllSkills", "GetAttributes"]) {
    const store = createClientStore();
    const { fetch, asked, requests } = pilotBff({ queue: [queueEntry(AFTERBURNER, 4, 1, 2)], paused: false, fails: { [method]: [502, "CALL_REFUSED"] }, saysClock: true });
    const flow = createAppFlow(store, { fetch, eventSource: noStream });
    await flow.selectCharacter(140000002);
    requests.length = 0;
    await flow.loadSkills();
    assert.deepEqual([store.get().skills.loaded, asked().includes("GET /api/bridge/skills")], [false, false], method);
    assert.match(store.get().skills.error ?? "", /^Your skills could not be read: /, method);
  }
  // The pilot's session gone is said as it is anywhere: the pilot is offline, and whoever asked is told.
  const store = createClientStore();
  const { fetch } = pilotBff({ queue: [], paused: false, fails: { GetSkills: [404, "SESSION_NOT_FOUND"] }, saysClock: true });
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  await assert.rejects(flow.loadSkills(), (error: { code?: string }) => error.code === "SESSION_NOT_FOUND");
  assert.equal(store.station.get().online, null);
});

test("a pause re-reads the sheet as it is read at any time: by the page's own reads where they are carried, and by the route where not", async () => {
  const store = createClientStore();
  const state: PilotBff = { queue: [queueEntry(AFTERBURNER, 4, 1_791_600_000_000, 1_791_603_600_000)], paused: false, fails: {}, saysClock: true };
  const { fetch, asked, requests } = pilotBff(state);
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  await flow.loadSkills();
  assert.equal(store.get().skills.queue?.active, true);
  requests.length = 0;

  await flow.pauseSkillTraining();
  // The pause by the page's own call, and no route of the skills' asked at all.
  assert.deepEqual(requests.filter((request) => request.path.startsWith("/api/bridge/skills")).map((request) => [request.method, request.path]), []);
  assert.deepEqual(requests.find((request) => request.body.method === "AbortTraining")?.body, { service: "skillHandler", method: "AbortTraining", args: [], kwargs: null, pilot: true, confirm: true });
  // Then the sheet's reads. Nothing is in training now, so the attributes are not asked for.
  assert.deepEqual(asked(), ["AbortTraining", "GetSkillQueueAndFreePoints", "GetSkills", "GetAllSkills", "GetFreeSkillPoints"]);
  const kept = store.get().skills.queue!;
  assert.deepEqual([kept.active, kept.endTimeMs, kept.entries.map((entry) => [entry.typeID, entry.toLevel, entry.startTimeMs, entry.endTimeMs]), store.get().skills.lastAction], [false, null, [[AFTERBURNER, 4, null, null]], "Paused training"]);

  // Through the gateway: the pause, the page's asking refused, and the route's sheet.
  const gatewayStore = createClientStore();
  const gateway = pilotBff({ queue: null, paused: false, fails: {}, saysClock: false });
  const gatewayFlow = createAppFlow(gatewayStore, { fetch: gateway.fetch, eventSource: noStream });
  await gatewayFlow.selectCharacter(140000002);
  gateway.requests.length = 0;
  await gatewayFlow.pauseSkillTraining();
  assert.deepEqual(gateway.asked(), ["AbortTraining", "GetSkillQueueAndFreePoints", "GET /api/bridge/skills"]);
  assert.equal(gatewayStore.get().skills.lastAction, "Paused training");
});

test("with a pilot chosen a queue is saved by the page's own call, and the sheet after it is the page's own: no route of the skills' is asked", () => atBrowserNow(async () => {
  const store = createClientStore();
  const state: PilotBff = { queue: [], paused: false, fails: {}, saysClock: true, countsStatic: false };
  const { fetch, asked, requests } = pilotBff(state);
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  await flow.loadSkills();
  assert.deepEqual(store.get().skills.queue?.entries, []);
  requests.length = 0;

  await flow.saveSkillQueue([{ typeID: AFTERBURNER, toLevel: 4 }, { typeID: GUNNERY, toLevel: 5 }], "Added Gunnery V to the queue", "Gunnery");
  // The client's own save, as a pilot's and as a write the page means; then the sheet's reads, with the
  // attributes, a skill being in training now.
  assert.deepEqual(requests.find((request) => request.body.method === "SaveNewQueue")?.body, {
    service: "skillHandler",
    method: "SaveNewQueue",
    args: [{ type: "dict", entries: [[0, [AFTERBURNER, 4]], [1, [GUNNERY, 5]]] }],
    kwargs: { activate: true },
    pilot: true,
    confirm: true,
  });
  assert.deepEqual(asked(), ["SaveNewQueue", "GetSkillQueueAndFreePoints", "GetSkills", "GetAllSkills", "GetFreeSkillPoints", "GetAttributes"]);
  assert.deepEqual(requests.filter((request) => request.path.startsWith("/api/bridge/skills")), []);
  const skills = store.get().skills;
  assert.deepEqual([skills.queue?.active, skills.queue?.entries.map((entry) => [entry.typeID, entry.toLevel]), skills.lastAction, skills.actionError], [true, [[AFTERBURNER, 4], [GUNNERY, 5]], "Added Gunnery V to the queue", null]);
}));

test("through the web gateway the handler's save is not carried: the page asks, is told so with nothing saved, and the route saves and answers its sheet", async () => {
  const store = createClientStore();
  const { fetch, asked, requests } = pilotBff({ queue: null, paused: false, fails: {}, saysClock: false });
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  requests.length = 0;
  await flow.saveSkillQueue([{ typeID: SURGICAL, toLevel: 1 }, { typeID: GUNNERY, toLevel: 5 }], "Added Gunnery V to the queue", "Gunnery");
  assert.deepEqual(asked(), ["SaveNewQueue", "POST /api/bridge/skills/queue"]);
  assert.deepEqual(requests.find((request) => request.path === "/api/bridge/skills/queue")?.body, { entries: [{ typeID: SURGICAL, toLevel: 1 }, { typeID: GUNNERY, toLevel: 5 }] });
  // The route's sheet is what lands, as it did before.
  const skills = store.get().skills;
  assert.deepEqual([skills.queue?.entries.map((entry) => [entry.typeID, entry.toLevel]), skills.lastAction, skills.actionError], [[[SURGICAL, 1], [GUNNERY, 5]], "Added Gunnery V to the queue", null]);
});

test("a save the server refuses by the page's own call is said in the player's words, is not asked of the route, and the sheet is read again", () => atBrowserNow(async () => {
  const store = createClientStore();
  const state: PilotBff = { queue: [queueEntry(AFTERBURNER, 4, BROWSER_NOW, BROWSER_NOW + 3_600_000)], paused: false, fails: { SaveNewQueue: [409, "CALL_REFUSED", "QueueCannotPlaceSkillBeforeRequirements"] }, saysClock: true, countsStatic: false };
  const { fetch, asked, requests } = pilotBff(state);
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  requests.length = 0;
  await flow.saveSkillQueue([{ typeID: SURGICAL, toLevel: 1 }], "Added Surgical Strike I", "Surgical Strike");
  const skills = store.get().skills;
  assert.equal(skills.actionError, "Surgical Strike needs another skill trained first. Put the skill it depends on ahead of it in the queue.");
  // A refusal is the server's answer to the save: the route is not asked to save it instead.
  assert.deepEqual(asked().filter((each) => each.includes("/api/bridge/skills")), []);
  assert.deepEqual(asked().slice(0, 2), ["SaveNewQueue", "GetSkillQueueAndFreePoints"]);
  // What is on screen is the server's queue, and no action is said to have been taken.
  assert.deepEqual([skills.queue?.entries.map((entry) => [entry.typeID, entry.toLevel]), skills.lastAction], [[[AFTERBURNER, 4]], null]);

  // The pilot's session gone under the save is said as it is anywhere: the pilot is offline, and whoever asked is told.
  const lostStore = createClientStore();
  const lost = pilotBff({ queue: [], paused: false, fails: { SaveNewQueue: [404, "SESSION_NOT_FOUND"] }, saysClock: true });
  const lostFlow = createAppFlow(lostStore, { fetch: lost.fetch, eventSource: noStream });
  await lostFlow.selectCharacter(140000002);
  await assert.rejects(lostFlow.saveSkillQueue([], "Emptied the queue", "your queue"), (error: { code?: string }) => error.code === "SESSION_NOT_FOUND");
  assert.deepEqual([lostStore.station.get().online, lost.asked().includes("POST /api/bridge/skills/queue")], [null, false]);
}));

test("a change of the queue is saved started, and unstarted where every training slot of the account is used; the start button starts it whatever", () => atBrowserNow(async () => {
  const kwargsOf = (requests: Recorded[]) => requests.filter((request) => request.body.method === "SaveNewQueue").map((request) => request.body.kwargs);
  const QUEUE = [{ typeID: AFTERBURNER, toLevel: 4 }];
  // The account's other character has a skill in training, and the account has the one slot: every slot is used.
  const store = createClientStore();
  const state: PilotBff = { queue: [], paused: false, fails: {}, saysClock: true, countsStatic: false, otherTrains: true };
  const { fetch, slotsAsked, requests } = pilotBff(state);
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  // Nothing of the slots is asked until a change of the queue wants it.
  assert.deepEqual(slotsAsked(), []);
  await flow.saveSkillQueue(QUEUE, "Added Afterburner IV to the queue", "Afterburner");
  // skillQueueSvc.OnClientQueueModified: IsAllCharacterTrainingSlotsUsed, then the commit, unstarted.
  assert.deepEqual([slotsAsked(), kwargsOf(requests)], [["userSvc.GetMultiCharactersTrainingSlots", "charUnboundMgr.GetCharacterSelectionData"], [{ activate: false }]]);
  assert.equal(store.get().skills.lastAction, "Added Afterburner IV to the queue");
  // Kept: another change asks nothing more, and is saved the same way.
  await flow.saveSkillQueue([], "Took Afterburner off the queue", "Afterburner");
  assert.deepEqual([slotsAsked().length, kwargsOf(requests)], [2, [{ activate: false }, { activate: false }]]);
  // skillQueuePanelNew.StartOrStopTraining: the start button says True, and it is the server's to refuse.
  await flow.saveSkillQueue(QUEUE, "Started training", "your queue", true);
  assert.deepEqual([slotsAsked().length, kwargsOf(requests).at(-1)], [2, { activate: true }]);

  // Pressed before anything was reckoned, the start button asks nothing of the slots: it starts the queue.
  const firstStore = createClientStore();
  const first = pilotBff({ queue: [], paused: false, fails: {}, saysClock: true, otherTrains: true });
  const firstFlow = createAppFlow(firstStore, { fetch: first.fetch, eventSource: noStream });
  await firstFlow.selectCharacter(140000002);
  await firstFlow.saveSkillQueue(QUEUE, "Started training", "your queue", true);
  assert.deepEqual([first.slotsAsked(), kwargsOf(first.requests)], [[], [{ activate: true }]]);

  // With a slot free a change is saved started.
  const freeStore = createClientStore();
  const free = pilotBff({ queue: [], paused: false, fails: {}, saysClock: true, otherTrains: false });
  const freeFlow = createAppFlow(freeStore, { fetch: free.fetch, eventSource: noStream });
  await freeFlow.selectCharacter(140000002);
  await freeFlow.saveSkillQueue(QUEUE, "Added Afterburner IV to the queue", "Afterburner");
  assert.deepEqual([free.slotsAsked().length, kwargsOf(free.requests)], [2, [{ activate: true }]]);
}));

test("what was reckoned of the training slots is let go at the server's word that the account's training changed, and with another character", () => atBrowserNow(async () => {
  const kwargsOf = (requests: Recorded[]) => requests.filter((request) => request.body.method === "SaveNewQueue").map((request) => request.body.kwargs);
  const QUEUE = [{ typeID: AFTERBURNER, toLevel: 4 }];
  const store = createClientStore();
  // The server says the account's training changed as it answers each save.
  const state: PilotBff = { queue: [], paused: false, fails: {}, saysClock: true, otherTrains: true, tellsTraining: true };
  const { fetch, slotsAsked, requests } = pilotBff(state);
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  await flow.saveSkillQueue(QUEUE, "Added Afterburner IV to the queue", "Afterburner");
  assert.equal(slotsAsked().length, 2);
  // skillQueueSvc.OnMultipleCharactersTrainingUpdated: reckoned again at the next change, by what is so then.
  state.otherTrains = false;
  await flow.saveSkillQueue([], "Took Afterburner off the queue", "Afterburner");
  assert.deepEqual([slotsAsked().length, kwargsOf(requests)], [4, [{ activate: false }, { activate: true }]]);
  // Another character chosen: what the last one's queue service had reckoned is not this one's.
  state.tellsTraining = false;
  await flow.saveSkillQueue(QUEUE, "Added Afterburner IV to the queue", "Afterburner");
  await flow.saveSkillQueue([], "Took Afterburner off the queue", "Afterburner");
  assert.equal(slotsAsked().length, 6);
  await flow.selectCharacter(140000002);
  await flow.saveSkillQueue(QUEUE, "Added Afterburner IV to the queue", "Afterburner");
  assert.equal(slotsAsked().length, 8);
}));

test("through the web gateway the training slots cannot be reckoned: asked once, told so, and a change is saved started by the route as before", async () => {
  const store = createClientStore();
  const { fetch, asked, slotsAsked, requests } = pilotBff({ queue: null, paused: false, fails: {}, saysClock: false, otherTrains: true });
  const flow = createAppFlow(store, { fetch, eventSource: noStream });
  await flow.selectCharacter(140000002);
  requests.length = 0;
  await flow.saveSkillQueue([{ typeID: GUNNERY, toLevel: 5 }], "Added Gunnery V to the queue", "Gunnery");
  await flow.saveSkillQueue([], "Took Gunnery off the queue", "Gunnery");
  // The user service's read is refused, and the selection data is not asked for. Kept: the second change asks nothing.
  assert.deepEqual(slotsAsked(), ["userSvc.GetMultiCharactersTrainingSlots"]);
  assert.deepEqual(requests.filter((request) => request.body.method === "SaveNewQueue").map((request) => request.body.kwargs), [{ activate: true }, { activate: true }]);
  assert.deepEqual(asked(), ["SaveNewQueue", "POST /api/bridge/skills/queue", "SaveNewQueue", "POST /api/bridge/skills/queue"]);
  assert.equal(store.get().skills.actionError, null);
});

test("a reckoning of the training slots that fails is the change's failure, said, and nothing is saved", () => atBrowserNow(async () => {
  const store = createClientStore();
  const made = pilotBff({ queue: [queueEntry(AFTERBURNER, 4, BROWSER_NOW, BROWSER_NOW + 3_600_000)], paused: false, fails: {}, saysClock: true, countsStatic: false });
  // The user service's read fails for a reason of its own: not that it is not carried.
  const failing = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    if (String(input) === "/api/bridge/call" && body.service === "userSvc") {
      made.requests.push({ path: String(input), method: "POST", body });
      return { ok: false, status: 502, async json() { return { ok: false, error: "CALL_FAILED", message: "The user service did not answer." }; } };
    }
    return made.fetch(input as never, init as never);
  }) as unknown as typeof fetch;
  const flow = createAppFlow(store, { fetch: failing, eventSource: noStream });
  await flow.selectCharacter(140000002);
  await flow.saveSkillQueue([{ typeID: GUNNERY, toLevel: 5 }], "Added Gunnery V to the queue", "Gunnery");
  // Said in the words the failure came with, as a save's own failure is.
  assert.equal(store.get().skills.actionError, "The user service did not answer.");
  assert.deepEqual([made.requests.filter((request) => request.body.method === "SaveNewQueue").length, made.asked().includes("POST /api/bridge/skills/queue"), store.get().skills.lastAction], [0, false, null]);
}));
