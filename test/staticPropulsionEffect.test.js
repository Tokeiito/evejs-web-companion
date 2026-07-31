"use strict";

// getPropulsionEffectName: the typeID -> propulsion-effect-name resolver behind
// the deactivate route's AB/MWD handling.
//
// WHY IT EXISTS (the marked server-side asymmetry): eve.js's Handle_Deactivate
// routes a module to deactivatePropulsionModule only when the effect argument
// NAMES a propulsion effect; an empty effect takes the generic path, which
// answers success while the prop mod keeps cycling. Activation infers the
// module's default effect from its type — deactivation does not. Observed live
// (2026-07-30): Deactivate(ab, "") -> 200, stopped:false, burner still running;
// Deactivate(ab, "moduleBonusAfterburner") stops it.
//
// The table is a FIXTURE shaped exactly like the gameStore's typeDogma
// (typesByTypeID -> {effects: [effectID...]}) so the test does not depend on an
// EveJS checkout being present.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-propfx-"));
fs.mkdirSync(path.join(dataDir, "typeDogma"));
fs.writeFileSync(
  path.join(dataDir, "typeDogma", "data.json"),
  JSON.stringify({
    typesByTypeID: {
      // 1MN Afterburner I — real shape: effects carry ids, 6731 is the AB bonus.
      439: { typeID: 439, effects: [13, 16, 3175, 6731] },
      // 5MN Microwarpdrive II — 6730 is the MWD bonus.
      440: { typeID: 440, effects: [13, 16, 58, 3175, 6730] },
      // A turret: effects, none of them propulsion.
      3634: { typeID: 3634, effects: [13, 16] },
      // A type with no effects array at all.
      999: { typeID: 999 },
    },
  }),
);
process.env.EVEJS_GAMESTORE_DATA_DIR = dataDir;
// Point the SDE dir somewhere empty so nothing else resolves accidentally.
process.env.EVEJS_SDE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-nosde-"));

const staticData = require("../src/staticData");

test("an afterburner type resolves to moduleBonusAfterburner", () => {
  assert.equal(staticData.getPropulsionEffectName(439), "moduleBonusAfterburner");
});

test("a microwarpdrive type resolves to moduleBonusMicrowarpdrive", () => {
  assert.equal(staticData.getPropulsionEffectName(440), "moduleBonusMicrowarpdrive");
});

test("everything that is not a prop mod resolves to null — the generic path is correct for it", () => {
  assert.equal(staticData.getPropulsionEffectName(3634), null);
  assert.equal(staticData.getPropulsionEffectName(999), null);
  assert.equal(staticData.getPropulsionEffectName(0), null);
  assert.equal(staticData.getPropulsionEffectName(123456789), null);
});
