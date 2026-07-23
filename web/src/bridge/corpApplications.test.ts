// R81 corpRegistry application + welcome-mail decoders against REAL captured shapes.
//
// Fixtures are the EXACT retail shapes the server builders emit
// (buildCorporationApplicationRow → a name-keyed packedrow with a {type:"long"}
// applicationDateTime; buildCorporationAllianceApplicationsIndexRowset → an IndexRowset
// whose `items` dict maps allianceID → a positional line; buildKeyVal for the welcome
// mail). Farmer's corp (98000001) seeds NO applications and no welcome mail, so the
// EMPTY shapes were captured live on 2026-07-22; the populated shapes are built from the
// same server builder, so the columns are identical — only the rows differ. FILETIMEs
// exceed 2^53 and are asserted to survive as raw decimal STRINGS.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpApplicationRow,
  decodeCorpApplicationGroups,
  decodeCorpApplicationList,
  decodeCorpAllianceApplications,
  decodeCorpWelcomeMail,
} from "./corpApplications.ts";
import type { JsonValue } from "./wire.ts";

const APP_COLUMNS = [
  ["applicationID", 3],
  ["corporationID", 3],
  ["characterID", 3],
  ["applicationText", 130],
  ["status", 3],
  ["applicationDateTime", 64],
  ["deleted", 11],
  ["responseText", 130],
];

// An application packedrow in the name-keyed `fields` variant.
function appRow(fields: Record<string, JsonValue>): JsonValue {
  return { type: "packedrow", columns: APP_COLUMNS, fields } as unknown as JsonValue;
}

// Farmer's REAL archived application row (corp 98000001), verbatim from the live
// GetOldApplications capture on 2026-07-22: char 998830009 (asdf) applied, status 2,
// responseText "". The FILETIME crosses as {type:"long"} (exceeds 2^53).
const REAL_APP = appRow({
  applicationID: 1,
  corporationID: 98000001,
  characterID: 998830009,
  applicationText: "dfghdfgh",
  status: 2,
  applicationDateTime: { type: "long", value: "134276061832600000" },
  deleted: false,
  responseText: "",
});

function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items } as unknown as JsonValue;
}

function dict(entries: readonly (readonly [JsonValue, JsonValue])[]): JsonValue {
  return { type: "dict", entries } as unknown as JsonValue;
}

function keyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: dict(entries) } as unknown as JsonValue;
}

// GetAllianceApplications IndexRowset — the `items` dict maps allianceID → positional line.
function allianceAppsIndexRowset(
  rows: readonly (readonly [number, number, string, number, JsonValue])[],
): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.IndexRowset",
    args: dict([
      ["header", list(["allianceID", "corporationID", "applicationText", "state", "applicationDateTime"])],
      ["columns", list(["allianceID", "corporationID", "applicationText", "state", "applicationDateTime"])],
      ["RowClass", { type: "token", value: "util.Row" } as unknown as JsonValue],
      ["idName", "allianceID"],
      ["items", dict(rows.map((cells) => [cells[0], list([...cells])]))],
    ]),
  } as unknown as JsonValue;
}

test("application row decodes, keeping the FILETIME as a raw decimal string", () => {
  const app = decodeCorpApplicationRow(REAL_APP);
  assert.equal(app.applicationID, 1);
  assert.equal(app.corporationID, 98000001);
  assert.equal(app.characterID, 998830009);
  assert.equal(app.applicationText, "dfghdfgh");
  assert.equal(app.status, 2);
  // Would round if Number()-coerced — kept exact.
  assert.equal(app.applicationDateTime, "134276061832600000");
  assert.equal(app.deleted, false);
  assert.equal(app.responseText, "");
});

test("GetApplications decodes the applicant-char-keyed groups", () => {
  const groups = decodeCorpApplicationGroups(dict([[998830009, list([REAL_APP])]]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.key, 998830009);
  assert.equal(groups[0]!.applications.length, 1);
  assert.equal(groups[0]!.applications[0]!.applicationID, 1);
});

test("GetMyApplications decodes the corp-keyed groups", () => {
  const groups = decodeCorpApplicationGroups(dict([[98000001, list([REAL_APP])]]));
  assert.equal(groups[0]!.key, 98000001);
  assert.equal(groups[0]!.applications[0]!.characterID, 998830009);
});

test("GetApplications / GetMyApplications return [] for a real empty dict (Farmer live)", () => {
  assert.deepEqual(decodeCorpApplicationGroups(dict([])), []);
  assert.deepEqual(decodeCorpApplicationGroups(null), []);
});

test("GetOldApplications / GetMyOldApplications decode the flat archived list", () => {
  // Farmer's corp 98000001 has exactly one archived application live (this row).
  const rows = decodeCorpApplicationList(list([REAL_APP]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.applicationID, 1);
  assert.equal(rows[0]!.characterID, 998830009);
  assert.deepEqual(decodeCorpApplicationList(list([])), []);
  assert.deepEqual(decodeCorpApplicationList(null), []);
});

test("GetAllianceApplications decodes the IndexRowset lines positionally", () => {
  const rows = decodeCorpAllianceApplications(
    allianceAppsIndexRowset([
      [99000000, 98000001, "sign us up", 1, { type: "long", value: "134276026827720000" }],
    ]),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    allianceID: 99000000,
    corporationID: 98000001,
    applicationText: "sign us up",
    state: 1,
    applicationDateTime: "134276026827720000",
  });
});

test("GetAllianceApplications returns [] for an empty IndexRowset (Farmer live)", () => {
  assert.deepEqual(decodeCorpAllianceApplications(allianceAppsIndexRowset([])), []);
  assert.deepEqual(decodeCorpAllianceApplications(null), []);
});

test("GetCorpWelcomeMail decodes the KeyVal, FILETIME as a string", () => {
  const mail = decodeCorpWelcomeMail(
    keyVal([
      ["characterID", 140000005],
      ["changeDate", { type: "long", value: "134276026827720000" }],
      ["welcomeMail", "Welcome to the corp!"],
    ]),
  );
  assert.ok(mail);
  assert.equal(mail.characterID, 140000005);
  assert.equal(mail.changeDate, "134276026827720000");
  assert.equal(mail.welcomeMail, "Welcome to the corp!");
});

test("GetCorpWelcomeMail decodes the real 'never set' empty state (Farmer live)", () => {
  // buildCorporationWelcomeMailPayload with no mail: null editor, changeDate "0", "".
  const mail = decodeCorpWelcomeMail(
    keyVal([
      ["characterID", null],
      ["changeDate", { type: "long", value: "0" }],
      ["welcomeMail", ""],
    ]),
  );
  assert.ok(mail);
  assert.equal(mail.characterID, null);
  assert.equal(mail.changeDate, "0");
  assert.equal(mail.welcomeMail, "");
  assert.equal(decodeCorpWelcomeMail(null), null);
});
