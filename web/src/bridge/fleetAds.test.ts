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
