// loadCharacterSheet (goal R56) against the raw /api/bridge/character-sheet
// envelope. The BFF ships four independent charMgr reads (public info,
// description, home station, clone info) as raw retail shapes; the flow decodes
// them and — the crux — RESOLVES every id to a name through /api/names.
//
// ⚠ R7d is the invariant under test: the flow must ask /api/names for the
// corporation, the alliance (when present), the home station and EVERY implant
// typeID — under the right kind. An id static data cannot name (a player corp)
// resolves to null and is cached as a definitive unknown, never re-rendered raw.
// ⚠ empty ≠ failed: a FAILED read leaves its field null (with its *Error); a
// clean clone (no implants) is a real [] answer.

import test from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "../store/clientStore.ts";
import { createAppFlow } from "./flow.ts";
import { nameKey } from "../store/names.ts";
import type { JsonValue } from "../bridge/wire.ts";

function keyval(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: entries as JsonValue },
  };
}
function longVal(value: string): JsonValue {
  return { type: "long", value };
}
function dict(entries: readonly (readonly [JsonValue, JsonValue])[]): JsonValue {
  return { type: "dict", entries: entries as JsonValue };
}

// The real GetPublicInfo3 (list of one KeyVal); alliance/implants overridable.
function publicInfo(
  over: { allianceID?: JsonValue; corporationID?: number } = {},
): JsonValue {
  return {
    type: "list",
    items: [
      keyval([
        ["characterID", 140000005],
        ["characterName", "Farmer"],
        ["corporationID", over.corporationID ?? 98000001],
        ["allianceID", over.allianceID ?? null],
        ["securityStatus", 0.1404],
      ]),
    ],
  };
}

const HOME_STATION: JsonValue = keyval([
  ["stationID", 60015249],
  ["name", "Manifest V - AIR Laboratories Trade Center"],
]);

const CLONE_CLEAN: JsonValue = keyval([
  ["homeStationID", 60015249],
  ["cloneStationID", 60015249],
  ["clones", dict([])],
  ["implants", dict([])],
  ["timeLastJump", longVal("0")],
]);

const CLONE_WITH_IMPLANTS: JsonValue = keyval([
  ["homeStationID", 60015249],
  ["cloneStationID", 60015249],
  ["clones", dict([])],
  [
    "implants",
    dict([
      [1, keyval([["typeID", 9941], ["slot", 1]])],
      [2, keyval([["typeID", 9899], ["slot", 6]])],
    ]),
  ],
  ["timeLastJump", longVal("0")],
]);

interface SheetBody {
  readonly publicInfo?: JsonValue;
  readonly description?: JsonValue;
  readonly homeStation?: JsonValue;
  readonly cloneInfo?: JsonValue;
  readonly errors?: Record<string, string | null>;
}

// A fetch answering /api/bridge/character-sheet and /api/names. The names route
// captures the request refs and, unless an id is in `unnameable`, echoes a name.
function sheetFetch(
  body: SheetBody,
  nameRequests: { kind: string; id: number }[] = [],
  unnameable: ReadonlySet<number> = new Set(),
): typeof fetch {
  return (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url === "/api/names") {
      const parsed = init && init.body ? JSON.parse(init.body) : { items: [] };
      const names: Record<string, string | null> = {};
      for (const item of parsed.items ?? []) {
        nameRequests.push({ kind: String(item.kind), id: Number(item.id) });
        names[`${item.kind}:${item.id}`] = unnameable.has(Number(item.id))
          ? null
          : `Name ${item.id}`;
      }
      return { ok: true, status: 200, async json() { return { ok: true, names, unresolved: [] }; } };
    }
    if (url.startsWith("/api/bridge/character-sheet")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            publicInfo: body.publicInfo ?? null,
            description: body.description ?? null,
            homeStation: body.homeStation ?? null,
            cloneInfo: body.cloneInfo ?? null,
            errors: {
              publicInfo: null,
              description: null,
              homeStation: null,
              cloneInfo: null,
              ...(body.errors ?? {}),
            },
          };
        },
      };
    }
    return { ok: true, status: 200, async json() { return { ok: true }; } };
  }) as unknown as typeof fetch;
}

/** Let the queued name-resolution microtask + its fetch settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("loadCharacterSheet decodes identity, bio, home station and a clean clone", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: sheetFetch({
      publicInfo: publicInfo(),
      description: "Character created via EveJS Elysian",
      homeStation: HOME_STATION,
      cloneInfo: CLONE_CLEAN,
    }),
  });

  await flow.loadCharacterSheet();

  const sheet = store.characterSheet.get();
  assert.equal(sheet.loaded, true);
  assert.equal(sheet.identity?.characterName, "Farmer");
  assert.equal(sheet.identity?.corporationID, 98000001);
  assert.equal(sheet.identity?.allianceID, null);
  assert.equal(sheet.identity?.securityStatus, 0.1404);
  assert.equal(sheet.description, "Character created via EveJS Elysian");
  assert.equal(sheet.homeStationID, 60015249);
  // A clean clone is [] implants — a real answer, not a failure.
  assert.deepEqual(sheet.clone?.implants, []);
  assert.equal(sheet.cloneError, null);
});

test("R7d: loadCharacterSheet asks /api/names for corp, alliance, station and every implant type", async () => {
  const store = createClientStore();
  const nameRequests: { kind: string; id: number }[] = [];
  const flow = createAppFlow(store, {
    fetch: sheetFetch(
      {
        publicInfo: publicInfo({ allianceID: 99000001 }),
        description: "hi",
        homeStation: HOME_STATION,
        cloneInfo: CLONE_WITH_IMPLANTS,
      },
      nameRequests,
    ),
  });

  await flow.loadCharacterSheet();
  await settle();

  assert.deepEqual(nameRequests.find((r) => r.id === 98000001), { kind: "corporation", id: 98000001 });
  assert.deepEqual(nameRequests.find((r) => r.id === 99000001), { kind: "alliance", id: 99000001 });
  assert.deepEqual(nameRequests.find((r) => r.id === 60015249), { kind: "station", id: 60015249 });
  // Every implant typeID is requested as a `type`.
  assert.deepEqual(nameRequests.find((r) => r.id === 9941), { kind: "type", id: 9941 });
  assert.deepEqual(nameRequests.find((r) => r.id === 9899), { kind: "type", id: 9899 });
});

test("R7d: a player corp that resolves to null is cached as a definitive unknown (never the id)", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    // 98000001 is a player corp: /api/names answers null for it.
    fetch: sheetFetch(
      { publicInfo: publicInfo(), description: "", homeStation: HOME_STATION, cloneInfo: CLONE_CLEAN },
      [],
      new Set([98000001]),
    ),
  });

  await flow.loadCharacterSheet();
  await settle();

  // The store caches the miss as null (a definitive unknown) — the panel shows a
  // fallback, and the id 98000001 is never rendered.
  assert.equal(store.names.get().resolved[nameKey("corporation", 98000001)], null);
  // The station, which DOES resolve, carries a real name.
  assert.equal(store.names.get().resolved[nameKey("station", 60015249)], "Name 60015249");
});

test("loadCharacterSheet: a FAILED clone read leaves clone null with cloneError; identity survives", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: sheetFetch({
      publicInfo: publicInfo(),
      description: "bio",
      homeStation: HOME_STATION,
      cloneInfo: null,
      errors: { cloneInfo: "READ_FAILED" },
    }),
  });

  await flow.loadCharacterSheet();

  const sheet = store.characterSheet.get();
  // ⚠ null, NOT an empty clone — a failed read must never look like a clean clone.
  assert.equal(sheet.clone, null);
  assert.match(sheet.cloneError ?? "", /READ_FAILED/);
  // The identity read survived the clone-side failure.
  assert.equal(sheet.identity?.characterName, "Farmer");
  assert.equal(sheet.identityError, null);
});

test("loadCharacterSheet keeps an empty bio ('') distinct from a failed bio read", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: sheetFetch({
      publicInfo: publicInfo(),
      description: "",
      homeStation: HOME_STATION,
      cloneInfo: CLONE_CLEAN,
    }),
  });

  await flow.loadCharacterSheet();

  const sheet = store.characterSheet.get();
  // "" is a real empty bio; null would mean unread/failed.
  assert.equal(sheet.description, "");
  assert.equal(sheet.descriptionError, null);
});
