// social decoder (goal R60) against REAL captured bytes.
//
// The fixtures are VERBATIM live captures through GET /api/bridge/social from
// Farmer (character 140000005) on 2026-07-22: LSC.GetChannels() -> a util.Rowset
// carrying ONE line (the docked Local channel, channelID 30000144) with only a
// `header` (no `columns`) and a {type:"list"} (util.Row) line;
// account.GetDefaultContactCost() -> null (a `return null` stub in this world).
//
// R7d: channelID / ownerID survive as numeric fields.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeChannels, decodeDefaultContactCost } from "./social.ts";
import type { JsonValue } from "./wire.ts";

function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items };
}

const CHANNEL_HEADERS = [
  "channelID",
  "ownerID",
  "displayName",
  "motd",
  "comparisonKey",
  "memberless",
  "password",
  "mailingList",
  "cspa",
  "temporary",
  "languageRestriction",
  "groupMessageID",
  "channelMessageID",
  "mode",
  "subscribed",
  "estimatedMemberCount",
];

// VERBATIM live capture: LSC.GetChannels() — util.Rowset with header-only (no
// columns) and a util.Row list line. The one Local channel.
const MOTD =
  "<br>EveJS Elysian Local Chat<br>Commands: /help, /wallet, /where, /who, /ship <name|typeID>, /laser, /lesmis, /gmships, /gmskills, /backintime, /expertsystem";
const CHANNELS_LIVE: JsonValue = {
  type: "object",
  name: "util.Rowset",
  args: {
    type: "dict",
    entries: [
      ["header", list(CHANNEL_HEADERS)],
      ["RowClass", { type: "token", value: "util.Row" }],
      [
        "lines",
        list([
          list([
            30000144,
            1,
            "Local",
            MOTD,
            "local_30000144",
            false,
            null,
            false,
            0,
            false,
            false,
            0,
            0,
            3,
            true,
            1,
          ]),
        ]),
      ],
    ],
  },
};

test("decodeChannels decodes the live Local channel row from a header-only Rowset", () => {
  const rows = decodeChannels(CHANNELS_LIVE);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    channelID: 30000144,
    ownerID: 1,
    displayName: "Local",
    motd: MOTD,
    comparisonKey: "local_30000144",
    memberless: false,
    password: null,
    mailingList: false,
    cspa: 0,
    temporary: false,
    languageRestriction: false,
    groupMessageID: 0,
    channelMessageID: 0,
    mode: 3,
    subscribed: true,
    estimatedMemberCount: 1,
  });
});

test("decodeChannels on a non-rowset / no lines is empty (a real 'no channels')", () => {
  assert.deepEqual(decodeChannels(null), []);
  assert.deepEqual(
    decodeChannels({
      type: "object",
      name: "util.Rowset",
      args: { type: "dict", entries: [["header", list(CHANNEL_HEADERS)], ["lines", list([])]] },
    }),
    [],
  );
});

test("decodeChannels drops a row with no positive channelID", () => {
  const ghost: JsonValue = {
    type: "object",
    name: "util.Rowset",
    args: {
      type: "dict",
      entries: [["header", list(CHANNEL_HEADERS)], ["lines", list([list([0, 1, "ghost"])])]],
    },
  };
  assert.deepEqual(decodeChannels(ghost), []);
});

test("decodeDefaultContactCost decodes the live null (a real 'no default cost')", () => {
  assert.equal(decodeDefaultContactCost(null), null);
  assert.equal(decodeDefaultContactCost(undefined), null);
});

test("decodeDefaultContactCost decodes a real numeric cost when one exists", () => {
  assert.equal(decodeDefaultContactCost(0), 0);
  assert.equal(decodeDefaultContactCost(150.5), 150.5);
  // A negative / non-numeric value is not a cost.
  assert.equal(decodeDefaultContactCost(-1), null);
  assert.equal(decodeDefaultContactCost("free" as unknown as JsonValue), null);
});

// R7d id-sweep: channelID / ownerID survive as numeric fields.
test("R7d: decodeChannels preserves channelID and ownerID as numeric fields", () => {
  const row = decodeChannels(CHANNELS_LIVE)[0]!;
  assert.equal(row.channelID, 30000144);
  assert.equal(row.ownerID, 1);
});

test("the social id assertion actually reads distinct decoded content (not vacuous)", () => {
  const other: JsonValue = {
    type: "object",
    name: "util.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", list(CHANNEL_HEADERS)],
        ["lines", list([list([30002537, 42, "Corp"])])],
      ],
    },
  };
  const row = decodeChannels(other)[0]!;
  assert.equal(row.channelID, 30002537);
  assert.equal(row.ownerID, 42);
  assert.notEqual(row.channelID, 30000144);
});
