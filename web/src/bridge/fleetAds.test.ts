// Fleet-finder (fleetProxy) advert reads decoder (goal R69) against builder-mirrored bytes.
// Farmer is not in a fleet, so live GetAvailableFleetAds is an empty dict and
// GetMyFleetFinderAdvert is null. The POPULATED advert fixture reproduces buildAdvertPayload
// exactly: a BARE dict body, a util.KeyVal leader, __builtin__.set entity sets and long
// advertTime/dateCreated. R7d: every id stays numeric; the timestamps are bigint FILETIMEs.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeAvailableFleetAds, decodeMyFleetFinderAdvert } from "./fleetAds.ts";
import type { JsonValue } from "./wire.ts";

// --- wire-shape helpers -----------------------------------------------------

function list(items: JsonValue[]): JsonValue {
  return { type: "list", items };
}
function dict(entries: [JsonValue, JsonValue][]): JsonValue {
  return { type: "dict", entries };
}
function keyval(entries: [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}
function long(value: string): JsonValue {
  return { type: "long", value };
}
/** buildPythonSet: objectex1 __builtin__.set wrapping a single list of ids. */
function pythonSet(ids: number[]): JsonValue {
  return {
    type: "objectex1",
    header: [{ type: "token", value: "__builtin__.set" }, [list(ids)]],
    list: [],
    dict: [],
  };
}

function advert(overrides: Partial<Record<string, JsonValue>> = {}): JsonValue {
  const base: Record<string, JsonValue> = {
    fleetID: 90000001,
    leader: keyval([
      ["charID", 140000005],
      ["corpID", 98000001],
      ["allianceID", 99000001],
      ["warFactionID", null],
      ["securityStatus", 5],
    ]),
    solarSystemID: 30000142,
    numMembers: 4,
    advertTime: long("133500000000000000"),
    dateCreated: long("133400000000000000"),
    fleetName: "Home Defense",
    description: "Come fly with us",
    inviteScope: 2,
    activityValue: null,
    useAdvanceOptions: false,
    newPlayerFriendly: true,
    public_minStanding: null,
    public_minSecurity: null,
    public_allowedEntities: pythonSet([99000001, 98000001]),
    public_disallowedEntities: pythonSet([]),
    membergroups_minStanding: null,
    membergroups_minSecurity: null,
    membergroups_allowedEntities: pythonSet([]),
    membergroups_disallowedEntities: pythonSet([]),
    joinNeedsApproval: false,
    hideInfo: false,
    updateOnBossChange: true,
    advertJoinLimit: null,
  };
  const entries = Object.entries({ ...base, ...overrides }) as [string, JsonValue][];
  return dict(entries as [JsonValue, JsonValue][]);
}

// --- GetAvailableFleetAds ---------------------------------------------------

test("decodeAvailableFleetAds returns [] for the real empty listing and reads a populated map", () => {
  assert.deepEqual(decodeAvailableFleetAds(dict([])), []);
  assert.deepEqual(decodeAvailableFleetAds(null), []);

  const map = dict([[90000001, advert()]]);
  const ads = decodeAvailableFleetAds(map);
  assert.equal(ads.length, 1);
  assert.equal(ads[0]!.fleetID, 90000001);
  assert.equal(ads[0]!.fleetName, "Home Defense");
  assert.equal(ads[0]!.numMembers, 4);
  assert.equal(ads[0]!.leader.charID, 140000005);
  assert.equal(ads[0]!.leader.corpID, 98000001);
  assert.equal(ads[0]!.leader.warFactionID, null);
  assert.deepEqual(ads[0]!.public_allowedEntities, [99000001, 98000001]);
  assert.deepEqual(ads[0]!.public_disallowedEntities, []);
  assert.equal(ads[0]!.advertTime, 133500000000000000n);
  assert.equal(ads[0]!.dateCreated, 133400000000000000n);
  assert.equal(ads[0]!.newPlayerFriendly, true);
  assert.equal(ads[0]!.updateOnBossChange, true);
});

// --- GetMyFleetFinderAdvert -------------------------------------------------

test("decodeMyFleetFinderAdvert returns null when not in a fleet (real) and reads own advert", () => {
  assert.equal(decodeMyFleetFinderAdvert(null), null);
  const mine = decodeMyFleetFinderAdvert(
    advert({ fleetID: 90000002, fleetName: "My Roam", advertJoinLimit: 30 }),
  );
  assert.equal(mine!.fleetID, 90000002);
  assert.equal(mine!.fleetName, "My Roam");
  assert.equal(mine!.advertJoinLimit, 30);
  assert.equal(mine!.leader.charID, 140000005);
});

// --- R7d sweep --------------------------------------------------------------

test("R7d: fleet-advert decoder keeps numeric ids as data", () => {
  const mine = decodeMyFleetFinderAdvert(advert());
  assert.equal(typeof mine!.fleetID, "number");
  assert.equal(typeof mine!.leader.corpID, "number");
  assert.equal(typeof mine!.public_allowedEntities[0], "number");
});

// --- as Tranquility answered them -------------------------------------------
//
// Recorded 2026-07-03 ("Join Fleet - Receive Boss - Set other as boss - leave fleet"): fleetProxy::GetAvailableFleetAds
// answered three adverts. Two are here in their form, name for name and kind for kind; the names, and the
// numbers of the pilots, corporations and fleets, are made up. What differs from the builder's bytes above: the
// name and the description are unicode (a wstring on the wire); a yes or no may be 0 or 1; and a set of
// entities that is not used is None, not an empty set.

const wide = (value: string): JsonValue => ({ type: "wstring", value });
function recorded(fields: Record<string, JsonValue>): JsonValue {
  return dict(Object.entries(fields) as [JsonValue, JsonValue][]);
}
const FIRST = recorded({
  public_minStanding: -0.4, hideInfo: 0, updateOnBossChange: false, activityValue: 7, membergroups_minSecurity: null, membergroups_minStanding: null,
  public_disallowedEntities: null, fleetName: wide("Belt Miners"), advertJoinLimit: null, public_minSecurity: -1.2, fleetID: 1204200000001, public_allowedEntities: null,
  inviteScope: 16, membergroups_disallowedEntities: null,
  leader: keyval([["charID", 90000001], ["corpID", 98000001], ["warFactionID", null], ["securityStatus", 5.002546822433678], ["allianceID", null]]),
  joinNeedsApproval: 0, description: wide("Boosts and compression."), membergroups_allowedEntities: null, advertTime: long("134275762815337312"), dateCreated: long("134275759616731414"),
  useAdvanceOptions: true, numMembers: 2, newPlayerFriendly: 0, solarSystemID: 30005318,
});
const SECOND = recorded({
  public_minStanding: null, hideInfo: 0, updateOnBossChange: true, activityValue: 7, membergroups_minSecurity: null, membergroups_minStanding: null,
  public_disallowedEntities: null, fleetName: wide("High Sec Mining"), advertJoinLimit: null, public_minSecurity: null, fleetID: 1163700000002, public_allowedEntities: null,
  inviteScope: 17, membergroups_disallowedEntities: null,
  leader: keyval([["charID", 2120000002], ["corpID", 98000002], ["warFactionID", null], ["securityStatus", 0.8747203415891415], ["allianceID", null]]),
  joinNeedsApproval: 1, description: wide("Public mining fleet."), membergroups_allowedEntities: null, advertTime: long("134275765638624153"), dateCreated: long("134275742607591844"),
  useAdvanceOptions: true, numMembers: 5, newPlayerFriendly: 1, solarSystemID: 30002795,
});

test("adverts as Tranquility answered them are read: a name and a description that are unicode, a yes or no that is 0 or 1, a set that is None", () => {
  const ads = decodeAvailableFleetAds(dict([[1204200000001, FIRST], [1163700000002, SECOND]]));
  assert.deepEqual(ads.map((ad) => [ad.fleetID, ad.fleetName, ad.description, ad.numMembers, ad.solarSystemID, ad.inviteScope, ad.activityValue]), [
    [1204200000001, "Belt Miners", "Boosts and compression.", 2, 30005318, 16, 7],
    [1163700000002, "High Sec Mining", "Public mining fleet.", 5, 30002795, 17, 7],
  ]);
  assert.deepEqual(ads.map((ad) => [ad.joinNeedsApproval, ad.newPlayerFriendly, ad.hideInfo, ad.useAdvanceOptions, ad.updateOnBossChange]), [[false, false, false, true, false], [true, true, false, true, true]]);
  assert.deepEqual(ads.map((ad) => [ad.public_minStanding, ad.public_minSecurity, ad.public_allowedEntities, ad.membergroups_disallowedEntities, ad.advertJoinLimit]), [[-0.4, -1.2, [], [], null], [null, null, [], [], null]]);
  assert.deepEqual([ads[0]?.leader, ads[0]?.advertTime, ads[0]?.dateCreated], [{ charID: 90000001, corpID: 98000001, allianceID: null, warFactionID: null, securityStatus: 5.002546822433678 }, 134275762815337312n, 134275759616731414n]);
  // The session's own advert is one such, and a name that is unicode is its name.
  assert.equal(decodeMyFleetFinderAdvert(FIRST)?.fleetName, "Belt Miners");
  // What is neither text nor a wire string is no name: it is not written out as "[object Object]". A long is no
  // text though its value is digits in a string; a wire string with no value is none; nor is a yes or no. A
  // number is written out.
  const named = (fleetName: JsonValue): string | undefined => decodeMyFleetFinderAdvert(recorded({ fleetID: 5, fleetName }))?.fleetName;
  assert.deepEqual(
    [named({ type: "list", items: [] } as JsonValue), named(long("5")), named({ type: "wstring" } as JsonValue), named({ type: "wstring", value: 5 } as JsonValue), named(true), named(null), named(5), named("5th Fleet")],
    ["", "", "", "", "", "", "5", "5th Fleet"],
  );
});
