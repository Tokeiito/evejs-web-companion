// The autopilot's settings as the client keeps them. The words are made up; the names and what each is
// taken to be until set are the client's (evePathfinder/stateinterface.py, infoPanelRoute.py).

import test from "node:test";
import assert from "node:assert/strict";

import {
  OFFERED_ROUTE_TYPES, PENALTY_RANGE, ROUTE_SETTING_LABELS, ROUTE_SETTING_WORD_LABELS, autopilotSettingsFrom, autopilotSettingsKey, avoidingSystems,
  loadAutopilotSettings, penaltyOf, penaltyWords, routeSettingWords, routeTypeOf, saveAutopilotSettings, withAvoidSystemsClicked, withPenalty, withRouteType,
  type SettingsStorage, type StoredAutopilotSettings,
} from "./autopilotSettings.ts";
import { DEFAULT_AUTOPILOT_SETTINGS } from "./autopilotRoute.ts";

function storage(): SettingsStorage & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return { kept, getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => { kept.set(key, value); } };
}

test("with nothing set, the settings are the client's own: the safe route, a penalty of 50, Jita and Zarzakh avoided", () => {
  assert.equal(routeTypeOf({}), "safe");
  assert.equal(penaltyOf({}), 50);
  assert.equal(avoidingSystems({}), true);
  assert.deepEqual(autopilotSettingsFrom({}), { routeType: "safe", penalty: 50, avoid: [30000142, 30100000] });
  assert.deepEqual(autopilotSettingsFrom({}), { ...DEFAULT_AUTOPILOT_SETTINGS, avoid: [...DEFAULT_AUTOPILOT_SETTINGS.avoid] });
});

test("the route panel offers three kinds of route, shorter first, and a slider from 1 to 100", () => {
  assert.deepEqual(OFFERED_ROUTE_TYPES, ["shortest", "safe", "unsafe"]);
  assert.deepEqual(PENALTY_RANGE, { least: 1, most: 100 });
});

test("what is set is what the pathfinder is given, and the rest stays as it comes", () => {
  const set = withPenalty(withRouteType({}, "shortest"), 12);
  assert.deepEqual(set, { pfRouteType: "shortest", pfPenalty: 12 });
  assert.deepEqual(autopilotSettingsFrom(set), { routeType: "shortest", penalty: 12, avoid: [30000142, 30100000] });
  // The slider is kept within its ends, and something that is no number changes nothing.
  assert.equal(penaltyOf(withPenalty({}, 0)), 1);
  assert.equal(penaltyOf(withPenalty({}, 250)), 100);
  assert.equal(penaltyOf(withPenalty({}, 37.5)), 37.5);
  assert.deepEqual(withPenalty(set, Number.NaN), set);
  // Setting does not change what it was given.
  const before: StoredAutopilotSettings = Object.freeze({ pfPenalty: 9 });
  assert.deepEqual(withRouteType(before, "unsafe"), { pfPenalty: 9, pfRouteType: "unsafe" });
  assert.deepEqual(before, { pfPenalty: 9 });
});

test("the tick for avoiding: the first click on one never touched leaves it on, and the next turns it off", () => {
  // Drawn as on until set; a click sets the opposite of the setting taken as off until set.
  const once = withAvoidSystemsClicked({});
  assert.deepEqual(once, { pfAvoidSystems: true });
  assert.equal(avoidingSystems(once), true);
  const twice = withAvoidSystemsClicked(once);
  assert.equal(avoidingSystems(twice), false);
  assert.equal(avoidingSystems(withAvoidSystemsClicked(twice)), true);
  // The other settings are left as they were.
  assert.deepEqual(withAvoidSystemsClicked({ pfPenalty: 9, pfRouteType: "unsafe" }), { pfPenalty: 9, pfRouteType: "unsafe", pfAvoidSystems: true });
  // Off, nothing is avoided, whatever is on the list.
  assert.deepEqual(autopilotSettingsFrom(twice).avoid, []);
  assert.deepEqual(autopilotSettingsFrom({ pfAvoidSystems: false, autopilot_avoidance2: [30000001] }).avoid, []);
});

test("the list the pilot keeps is the one avoided: known space only, in order", () => {
  assert.deepEqual(autopilotSettingsFrom({ autopilot_avoidance2: [30002780, 31000005, 30000001, 20000020] }).avoid, [30000001, 30002780]);
  assert.deepEqual(autopilotSettingsFrom({ autopilot_avoidance2: [] }).avoid, []);
  // The list given is not put in order itself.
  const listed = [30000009, 30000003];
  autopilotSettingsFrom({ autopilot_avoidance2: listed });
  assert.deepEqual(listed, [30000009, 30000003]);
});

test("settings are kept by character, under the client's names, and read back as they were set", () => {
  const kept = storage();
  assert.deepEqual(loadAutopilotSettings(kept, 140000002), {});
  const set: StoredAutopilotSettings = { pfRouteType: "unsafe", pfPenalty: 77, pfAvoidSystems: false, autopilot_avoidance2: [30000142] };
  saveAutopilotSettings(kept, 140000002, set);
  assert.equal(autopilotSettingsKey(140000002), "evejs.autopilot.settings.140000002");
  assert.deepEqual(JSON.parse(kept.kept.get("evejs.autopilot.settings.140000002")!), { pfRouteType: "unsafe", pfPenalty: 77, pfAvoidSystems: false, autopilot_avoidance2: [30000142] });
  assert.deepEqual(loadAutopilotSettings(kept, 140000002), set);
  // Another character has its own.
  assert.deepEqual(loadAutopilotSettings(kept, 140000003), {});
  // With nowhere to keep them, nothing is kept and nothing is thrown.
  saveAutopilotSettings(null, 140000002, set);
  assert.deepEqual(loadAutopilotSettings(null, 140000002), {});
});

test("what is kept is read with care: what is not a setting is left out, and storage that fails is as if empty", () => {
  const kept = storage();
  const key = autopilotSettingsKey(7);
  for (const [text, expected] of [
    ["not json", {}],
    ["null", {}],
    ["[1,2]", {}],
    ['"safe"', {}],
    ['{"pfRouteType":"fastest","pfPenalty":"50","pfAvoidSystems":1,"autopilot_avoidance2":"30000142"}', {}],
    ['{"pfRouteType":"unsafe + zerosec","pfPenalty":3,"pfAvoidSystems":true,"autopilot_avoidance2":[30000142,"x",0,-5,1.5,30000144],"other":1}', { pfRouteType: "unsafe + zerosec", pfPenalty: 3, pfAvoidSystems: true, autopilot_avoidance2: [30000142, 30000144] }],
    ['{"pfPenalty":null}', {}],
  ] as const) {
    kept.kept.set(key, text);
    assert.deepEqual(loadAutopilotSettings(kept, 7), expected, text);
  }
  const broken: SettingsStorage = { getItem: () => { throw new Error("refused"); }, setItem: () => { throw new Error("full"); } };
  assert.deepEqual(loadAutopilotSettings(broken, 7), {});
  assert.doesNotThrow(() => saveAutopilotSettings(broken, 7, { pfPenalty: 9 }));
});

test("the settings are worded with the client's own labels, and with this page's words where those are not to hand", () => {
  assert.deepEqual(ROUTE_SETTING_LABELS, {
    shortest: "UI/Map/MapPallet/cbPreferShorter",
    safe: "UI/Map/MapPallet/cbPreferSafer",
    unsafe: "UI/Map/MapPallet/cbPreferRisky",
    penalty: "UI/Map/MapPallet/lblSecurityPenelity",
    avoidSystems: "UI/Map/MapPallet/cbAdvoidSystemsOnList",
  });
  assert.deepEqual([...ROUTE_SETTING_WORD_LABELS].sort(), Object.values(ROUTE_SETTING_LABELS).sort());
  const client = (label: string): string | null => (label === "UI/Map/MapPallet/cbPreferSafer" ? "The careful way" : null);
  assert.equal(routeSettingWords("safe", client), "The careful way");
  assert.equal(routeSettingWords("shortest", client), "Prefer shorter");
  assert.equal(routeSettingWords("unsafe", client), "Prefer less secure");
  assert.equal(routeSettingWords("penalty", client), "Security penalty");
  assert.equal(routeSettingWords("avoidSystems", client), "Avoid the systems on the list");
  // The slider's label: the words, then the value as a whole number.
  assert.equal(penaltyWords("Penalty", 50), "Penalty 50");
  assert.equal(penaltyWords("Penalty", 37.9), "Penalty 37");
});
