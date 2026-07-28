import test from "node:test";
import assert from "node:assert/strict";

import {
  BLOCK_SNIPPET_IDS,
  BLOCK_SNIPPET_LIST,
  BLOCK_SNIPPETS,
  appendBlockSnippet,
  instantiateBlockSnippet,
  programNodeIDs,
} from "./blockSnippets.ts";
import { MACRO_IDS, startingStation, type BotScript, type MacroID, type ProgramNode } from "./botScript.ts";
import { decodeScriptText, decodeScriptValue, encodeScriptDoc } from "./scriptCodec.ts";
import { validateScript } from "./validateScript.ts";

function ids(): () => string {
  let value = 0;
  return () => `fresh-${(value += 1)}`;
}

function doc(program: readonly ProgramNode[]): BotScript {
  return {
    format: "evejs-bot-script",
    version: 1,
    name: "Snippet check",
    notes: "",
    home: startingStation(),
    interrupts: [],
    program,
  };
}

test("the typed snippet catalogue is exhaustive, ordered, and plain-language", () => {
  assert.deepEqual(BLOCK_SNIPPET_LIST.map((group) => group.id), BLOCK_SNIPPET_IDS);
  assert.equal(new Set(BLOCK_SNIPPET_IDS).size, BLOCK_SNIPPET_IDS.length);
  for (const id of BLOCK_SNIPPET_IDS) {
    const group = BLOCK_SNIPPETS[id];
    assert.equal(group.id, id);
    assert.ok(group.label.length > 0 && group.adds.length > 0);
    assert.doesNotMatch(`${group.label} ${group.adds} ${group.setup ?? ""}`, /\d{5,}/, "no raw world ids in copy");
    assert.ok(group.steps.length > 0);
    for (const step of group.steps) {
      assert.ok(MACRO_IDS.includes(step.macro), `${id} uses an unsupported block`);
    }
  }
});

test("the five promised groups contain their complete supported sequences", () => {
  const expected: Readonly<Record<(typeof BLOCK_SNIPPET_IDS)[number], readonly MacroID[]>> = {
    "safe-return-home": ["travel-to-station", "unload-cargo", "repair-ship"],
    "mine-haul-cycle": ["undock", "mine-at-belt", "deliver-ore"],
    "clear-loot-salvage": [
      "undock",
      "hardeners-on",
      "warp-to-anomaly",
      "fight-the-rats",
      "loot-wrecks",
      "salvage-wrecks",
    ],
    "fleet-logistics": [
      "join-fleet",
      "undock",
      "hardeners-on",
      "remote-rep",
      "remote-cap",
      "orbit-and-boost",
    ],
    "dock-refit-repair": [
      "dock-at-nearest",
      "unload-cargo",
      "refit-ship",
      "repair-ship",
      "tidy-hangar",
    ],
  };
  for (const id of BLOCK_SNIPPET_IDS) {
    assert.deepEqual(BLOCK_SNIPPETS[id].steps.map((step) => step.macro), expected[id]);
  }
});

for (const group of BLOCK_SNIPPET_LIST) {
  test(`block group "${group.label}" round-trips through the script codec`, () => {
    const bindings =
      group.id === "dock-refit-repair"
        ? { fitting: { fittingID: 77, name: "Fleet fit" } }
        : {};
    const script = doc(instantiateBlockSnippet(group.id, ids(), new Set(), bindings));
    const decoded = decodeScriptValue(script);
    assert.ok(decoded.ok, decoded.ok ? "" : decoded.refusal);
    if (!decoded.ok) return;
    assert.deepEqual(decoded.warnings, []);
    const text = decodeScriptText(encodeScriptDoc(decoded.doc));
    assert.ok(text.ok, text.ok ? "" : text.refusal);

    assert.deepEqual(validateScript(decoded.doc), [], "an inserted group with its required picks should validate cleanly");
  });
}

test("the turnaround refuses to hide its required fitting choice", () => {
  const script = doc(instantiateBlockSnippet("dock-refit-repair", ids()));
  const problems = validateScript(script);
  assert.equal(problems.length, 1);
  assert.match(problems[0]?.sentence ?? "", /pick the saved fitting/i);
});

test("inserting groups appends and gives every inserted node a fresh unique id", () => {
  const existing: ProgramNode[] = [
    {
      id: "fresh-1",
      kind: "branch",
      when: { kind: "shield-below", fraction: 0.5 },
      then: [{ id: "fresh-2", kind: "macro", macro: "repair-ship", args: {} }],
      else: [],
    },
  ];
  const makeId = ids();
  const once = appendBlockSnippet(existing, "mine-haul-cycle", makeId, {
    reservedIDs: new Set(["fresh-3"]),
  });
  const twice = appendBlockSnippet(once, "safe-return-home", makeId);

  assert.equal(twice[0], existing[0], "the current bot is preserved, not cloned or replaced");
  assert.equal(twice.length, 1 + 3 + 3);
  const all = [...programNodeIDs(twice)];
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.includes("fresh-1") && all.includes("fresh-2"));
  assert.equal(all.includes("fresh-3"), false, "non-program handles are reserved too");
  assert.equal(all.filter((id) => id.startsWith("fresh-")).length, all.length);
});

test("materializing a group never leaks or mutates its catalogue template ids", () => {
  const first = instantiateBlockSnippet("clear-loot-salvage", ids());
  const second = instantiateBlockSnippet("clear-loot-salvage", ids(), programNodeIDs(first));
  assert.equal(new Set([...first, ...second].map((step) => step.id)).size, first.length + second.length);
  assert.ok(BLOCK_SNIPPETS["clear-loot-salvage"].steps.every((step) => !step.id.startsWith("fresh-")));
});
