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

/** The sheet envelope the BFF returns, with a queue we control. */
function sheetBody(
  entries: readonly { typeID: number; toLevel: number }[],
  serverNowMs = 1_784_617_000_000,
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
          inTraining: entries[0]?.typeID === GUNNERY,
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
        active: entries.length > 0,
        maxEntries: 150,
        endTimeMs: entries.length > 0 ? serverNowMs + entries.length * 3_600_000 : null,
        entries: entries.map((entry, index) => ({
          queuePosition: index,
          typeID: entry.typeID,
          toLevel: entry.toLevel,
          startSP: 0,
          destinationSP: 1000,
          startTimeMs: serverNowMs + index * 3_600_000,
          endTimeMs: serverNowMs + (index + 1) * 3_600_000,
          skillPointsPerMinute: index === 0 ? 30 : 0,
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
    if (path === "/api/bridge/skills/queue" && method === "POST") {
      queue = (body.entries as { typeID: number; toLevel: number }[]) ?? [];
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
  assert.deepEqual(requests.at(-1)!.body.entries, [
    { typeID: GUNNERY, toLevel: 5 },
    { typeID: SURGICAL, toLevel: 1 },
  ]);

  // Reorder, then remove — same route, same shape, every time.
  await flow.saveSkillQueue(
    [{ typeID: SURGICAL, toLevel: 1 }, { typeID: GUNNERY, toLevel: 5 }],
    "Moved Surgical Strike up",
    "Surgical Strike",
  );
  assert.deepEqual(
    store.get().skills.queue?.entries.map((entry) => entry.typeID),
    [SURGICAL, GUNNERY],
  );

  await flow.saveSkillQueue([], "Stopped training", "your queue");
  assert.deepEqual(store.get().skills.queue?.entries, []);
  assert.equal(store.get().skills.queue?.active, false);

  // Exactly one route for every one of those edits.
  assert.deepEqual(
    new Set(requests.filter((request) => request.method === "POST").map((r) => r.path)),
    new Set(["/api/bridge/skills/queue"]),
  );
});

test("what lands in the store is the RE-READ sheet, not the edit we asked for", async () => {
  const store = createClientStore();
  // ⚠ The server accepts the call and stores something DIFFERENT (here: it
  // dropped the second entry). A client that believed its own request would
  // now show a queue that does not exist.
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: sheetBody([{ typeID: GUNNERY, toLevel: 5 }]),
  }));
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
    if (path === "/api/bridge/skills/queue") {
      // Exactly what the BFF passes through for a refused save: the gateway's
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
    "POST /api/bridge/skills/queue",
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
