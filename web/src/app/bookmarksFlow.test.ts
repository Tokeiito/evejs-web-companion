// A pilot's bookmarks read by the page itself (the plan's Phase 6b), through the real flow over a faked BFF.
//
// Until 2026-10-11 they were read by GET /api/bridge/bookmarks, which made two calls (three with a folder named)
// and of which the page took the bookmarks alone. Where the route's read of them failed it answered with nothing
// and a code beside it, and the page read nothing as no bookmarks: a bot's warp to a saved spot was told the spot
// was not in the list, and stopped. It is the client's bookmark service's call now (bridge/bookmarkReads.ts).

import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import type { BotScript } from "../bots/botScript.ts";
import { fittingBody, flightBody, holdsBody, namesBody, SHIP_ID, SOLAR_SYSTEM_ID } from "./botFixtures.ts";

const PILOT = 140000005;
const FOLDER = 500001;
const SPOT = 900000008;

// The server's forms (eve.js bookmarkPayloads.js: a KeyVal for each row).
const keyVal = (entries: readonly (readonly [string, unknown])[]): unknown => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries } });
const text = (value: string) => ({ type: "wstring", value });
const folderRow = keyVal([
  ["folderID", FOLDER], ["folderName", text("Personal Locations")], ["description", text("")], ["creatorID", PILOT], ["isPersonal", true],
  ["isActive", true], ["accessLevel", 1], ["adminGroupID", null], ["manageGroupID", null], ["useGroupID", null], ["viewGroupID", null],
]);
const bookmarkRow = (bookmarkID: number, memo: string): unknown => keyVal([
  ["bookmarkID", bookmarkID], ["folderID", FOLDER], ["itemID", null], ["typeID", 5], ["flag", null], ["memo", text(memo)],
  ["created", { type: "long", value: "134360000000000000" }], ["expiry", null], ["x", 1000.5], ["y", 2000.5], ["z", 3000.5],
  ["locationID", SOLAR_SYSTEM_ID], ["note", text("")], ["subfolderID", null], ["creatorID", PILOT],
]);
/** GetMyActiveBookmarks as the server answers it: its folders, its bookmarks (one with a name, one with none) and its subfolders. */
const ACTIVE = [{ type: "list", items: [folderRow] }, { type: "list", items: [bookmarkRow(SPOT, "Safe one"), bookmarkRow(SPOT + 1, "")] }, { type: "list", items: [] }];
/** What the route answered where its read of the bookmarks had failed: nothing, and a code beside it. */
const THE_ROUTES_FAILURE = { ok: true, active: null, adminFolders: { type: "list", items: [] }, folderInfo: null, errors: { active: "CALL_FAILED", adminFolders: null, folderInfo: null } };

type Answer = { readonly status: number; readonly body: unknown };
const answered = (result: unknown): Answer => ({ status: 200, body: { ok: true, service: "accessGroupBookmarkMgr", method: "GetMyActiveBookmarks", result, notifications: [] } });
const refused = (error: string, status: number): Answer => ({ status, body: { ok: false, error, message: error } });

// bookmarkSvc.py 163: self.accessGroupBookmarkMgr.GetMyActiveBookmarks(), nothing sent, as a pilot's read.
const THE_READ = { service: "accessGroupBookmarkMgr", method: "GetMyActiveBookmarks", args: [], kwargs: null, pilot: true };

/** A pilot in space, and a BFF whose answer to each read of the bookmarks is the test's to say (the first read is 1). */
function harness(answerTo: (read: number) => Answer = () => answered(ACTIVE)) {
  const store = createClientStore();
  store.apply({ type: "character/online", character: {
    characterID: PILOT, characterName: "Test", stationID: null,
    structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 98000000,
  }, station: null } as never);
  const reads: Record<string, unknown>[] = [];
  const routes: string[] = [];
  const warps: Record<string, unknown>[] = [];
  const flow = createAppFlow(store, { livePush: false, fetch: async (input, init) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let answer: Answer = { status: 200, body: { ok: true } };
    if (path === "/api/bridge/flight/status") answer = { status: 200, body: flightBody(false) };
    if (path === "/api/bridge/fitting") answer = { status: 200, body: fittingBody() };
    if (path === "/api/names") answer = { status: 200, body: namesBody(body) };
    if (path === "/api/bridge/script/observation") answer = { status: 200, body: { ok: true, inSpace: [], bay: [], space: {
      inSpace: true, solarSystemID: SOLAR_SYSTEM_ID, shipID: SHIP_ID, sampledAtMs: Date.now(),
      ship: { itemID: SHIP_ID, typeID: 17480, radius: 100, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mode: "STOP" },
      entities: [],
    } } };
    if (path === "/api/bridge/targets") answer = { status: 200, body: { ok: true, targetIDs: [] } };
    if (path === "/api/bridge/ship/ore-hold") answer = { status: 200, body: holdsBody(0, []) };
    // The route, which nothing is to ask: it answers as it did where its read had failed.
    if (path.startsWith("/api/bridge/bookmarks")) { routes.push(path); answer = { status: 200, body: THE_ROUTES_FAILURE }; }
    if (path === "/api/bridge/call" && body.service === "accessGroupBookmarkMgr") {
      reads.push(body);
      answer = answerTo(reads.length);
    }
    if (path === "/api/bridge/flight/warp-bookmark") { warps.push(body); answer = { status: 200, body: flightBody(false) }; }
    return Response.json(answer.body, { status: answer.status });
  } });
  return { store, flow, reads, routes, warps };
}

test("the Bot Builder's saved spots are read by the page's own call, and never by the route: the named ones listed", async () => {
  const { flow, reads, routes } = harness();
  assert.deepEqual(await flow.listBookmarks(), [{ bookmarkID: SPOT, name: "Safe one" }]);
  assert.deepEqual(reads, [THE_READ]);
  assert.deepEqual(routes, []);
});

test("saved spots that could not be read are not an empty list: the read fails as the call failed, or as its answer was no three lists", async () => {
  const failed = harness(() => refused("CALL_FAILED", 502));
  await assert.rejects(failed.flow.listBookmarks(), (error: { code?: string }) => error.code === "CALL_FAILED");
  const nothing = harness(() => answered(null));
  await assert.rejects(nothing.flow.listBookmarks(), /Your bookmarks could not be read \(the server did not answer with its three lists\)\./);
  assert.deepEqual([failed.reads, nothing.reads, failed.routes, nothing.routes], [[THE_READ], [THE_READ], [], []]);
});

const script: BotScript = {
  format: "evejs-bot-script", version: 1, name: "To the safe", notes: "",
  home: { entity: "station", id: null, name: null, systemName: null },
  interrupts: [],
  program: [{ id: "spot", kind: "macro", macro: "warp-to-bookmark", args: { bookmark: { kind: "bookmark", bookmarkID: null, name: "Safe one" } } }],
};

/** The bot started and its clock turned until the test's condition holds, or the bot stops, or twelve looks have passed. */
async function run(context: TestContext, made: ReturnType<typeof harness>, until: () => boolean) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  /** What the bot said it was doing, as it changed. */
  const said: string[] = [];
  const unsubscribe = made.store.customBot.subscribe((state) => {
    const line = `${state.status}: ${state.why ?? ""}`;
    if (said.at(-1) !== line) said.push(line);
  });
  try {
    await made.flow.startCustomBot(script);
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (let look = 0; look < 12 && !until() && made.store.customBot.get().status === "running"; look += 1) {
      context.mock.timers.tick(2000);
      for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    unsubscribe();
    made.flow.stopCustomBot();
  }
  return said;
}

test("a bot's warp to a saved spot reads the bookmarks by the page's own call each time it looks, and warps to the one of its name", { timeout: 10_000 }, async (context) => {
  const made = harness();
  await run(context, made, () => made.warps.length > 0);
  assert.deepEqual(made.warps, [{ bookmarkID: SPOT, minRange: 0 }]);
  assert.ok(made.reads.length >= 1);
  for (const each of made.reads) assert.deepEqual(each, THE_READ);
  assert.deepEqual(made.routes, []);
});

test("a bot whose bookmarks could not be read goes on reading, and is not told its spot is not in the list", { timeout: 10_000 }, async (context) => {
  // Twice the read fails, and then it answers.
  const made = harness((read) => (read <= 2 ? refused("CALL_FAILED", 502) : answered(ACTIVE)));
  const said = await run(context, made, () => made.warps.length > 0);
  assert.deepEqual(made.warps, [{ bookmarkID: SPOT, minRange: 0 }]);
  assert.ok(made.reads.length >= 3, `${made.reads.length} reads`);
  assert.ok(said.includes("running: Reading your saved spots."), said.join(" | "));
  assert.equal(said.some((line) => /not in your list|no saved spot/i.test(line)), false, said.join(" | "));
  assert.deepEqual(made.routes, []);
});

test("a bot told by the server that there are no bookmarks does not go on reading: the step is given up, and the bot with it", { timeout: 10_000 }, async (context) => {
  const made = harness(() => answered([{ type: "list", items: [folderRow] }, { type: "list", items: [] }, { type: "list", items: [] }]));
  const said = await run(context, made, () => false);
  assert.deepEqual(made.warps, []);
  assert.deepEqual(made.reads, [THE_READ]);
  assert.equal(said.includes("running: Reading your saved spots."), false, said.join(" | "));
  // A step that cannot be done sends the bot home, and this one has no home: it stops where it is.
  assert.match(said.at(-1) ?? "", /^paused: /, said.join(" | "));
});
