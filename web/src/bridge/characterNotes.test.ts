// Character-notes decoders (goal R58) against REAL captured bytes.
//
// ⚠ All three fixtures are the EXACT live capture from Farmer through
// GET /api/bridge/character-notes on 2026-07-22:
//   • labels    -> Rowset with the lazily-seeded default folders note
//     [1, "S:Folders"] (bare-array line).
//   • ownerNote -> {type:"list", items:[util.KeyVal{noteID:1, label:"S:Folders",
//     note:"1::F::0::Main|"}]}.
//   • entityNote-> "" (Farmer keeps no entity note — a real "no note" answer).
// The populated/empty variants below prove the shapes the handler also emits.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeOwnerNoteLabels,
  decodeOwnerNote,
  decodeEntityNote,
} from "./characterNotes.ts";
import type { JsonValue } from "./wire.ts";

// The live GetOwnerNoteLabels capture: one bare-array row for the folders note.
const LABELS_LIVE: JsonValue = {
  type: "object",
  name: "eve.common.script.sys.rowset.Rowset",
  args: {
    type: "dict",
    entries: [
      ["header", { type: "list", items: ["noteID", "label"] }],
      ["columns", { type: "list", items: ["noteID", "label"] }],
      ["RowClass", { type: "token", value: "util.Row" }],
      ["lines", { type: "list", items: [[1, "S:Folders"]] }],
    ],
  },
};

// The live GetOwnerNote(1) capture: the folders note wrapped in a list.
const OWNER_NOTE_LIVE: JsonValue = {
  type: "list",
  items: [
    {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["noteID", 1],
          ["label", "S:Folders"],
          ["note", "1::F::0::Main|"],
        ],
      },
    },
  ],
};

test("decodeOwnerNoteLabels decodes the live folders-note row (bare-array lines)", () => {
  assert.deepEqual(decodeOwnerNoteLabels(LABELS_LIVE), [{ noteID: 1, label: "S:Folders" }]);
});

test("decodeOwnerNoteLabels decodes multiple note rows in order", () => {
  const labels = decodeOwnerNoteLabels({
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["columns", { type: "list", items: ["noteID", "label"] }],
        ["lines", { type: "list", items: [[1, "S:Folders"], [7, "Pilots to watch"]] }],
      ],
    },
  });
  assert.deepEqual(labels, [
    { noteID: 1, label: "S:Folders" },
    { noteID: 7, label: "Pilots to watch" },
  ]);
});

test("decodeOwnerNoteLabels drops a row with no positive noteID; [] for a non-rowset", () => {
  const labels = decodeOwnerNoteLabels({
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["columns", { type: "list", items: ["noteID", "label"] }],
        ["lines", { type: "list", items: [[0, "orphan"]] }],
      ],
    },
  });
  assert.deepEqual(labels, []);
  assert.deepEqual(decodeOwnerNoteLabels(null), []);
});

test("decodeOwnerNote reads items[0] of the live folders-note list", () => {
  assert.deepEqual(decodeOwnerNote(OWNER_NOTE_LIVE), {
    noteID: 1,
    label: "S:Folders",
    note: "1::F::0::Main|",
  });
});

test("decodeOwnerNote reads the empty payload the handler returns for an unknown id", () => {
  const empty: JsonValue = {
    type: "list",
    items: [
      {
        type: "object",
        name: "util.KeyVal",
        args: { type: "dict", entries: [["noteID", 0], ["label", ""], ["note", ""]] },
      },
    ],
  };
  assert.deepEqual(decodeOwnerNote(empty), { noteID: 0, label: "", note: "" });
});

test("decodeOwnerNote is null for an empty list or a non-list (a failed read)", () => {
  assert.equal(decodeOwnerNote({ type: "list", items: [] }), null);
  assert.equal(decodeOwnerNote(null), null);
});

test("decodeEntityNote on the real empty string is '' (a real 'no note')", () => {
  assert.equal(decodeEntityNote(""), "");
});

test("decodeEntityNote returns a populated note body verbatim; null for a non-string", () => {
  assert.equal(decodeEntityNote("scammed me in Jita"), "scammed me in Jita");
  assert.equal(decodeEntityNote(null), null);
  assert.equal(decodeEntityNote({ type: "list", items: [] }), null);
});
