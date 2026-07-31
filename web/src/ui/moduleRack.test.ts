// The module-rack model (moduleRack.ts): grouping into high/mid/low, the
// activation overlay from the snapshot, the empty-fit signal — and the click
// decision that makes the rack an F-row rather than a picture.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildModuleRack,
  rackClickAction,
  rackDamageText,
  rackIsEmpty,
  rackModuleBurntOut,
  rackSlotTitle,
} from "./moduleRack.ts";
import type { RackModule } from "./moduleRack.ts";
import type { FittingSlot } from "../store/types.ts";

function slot(family: FittingSlot["family"], index: number, mod: { itemID: number; typeID: number; online?: boolean } | null): FittingSlot {
  return {
    family,
    index,
    module: mod ? { itemID: mod.itemID, typeID: mod.typeID, groupID: null, online: mod.online ?? true, charge: null } : null,
  };
}

test("groups slots into high/mid/low in order, skipping rigs/subsystems", () => {
  const slots: FittingSlot[] = [
    slot("high", 0, { itemID: 1, typeID: 3634 }),
    slot("mid", 0, { itemID: 2, typeID: 5001 }),
    slot("low", 0, null),
    slot("rig", 0, { itemID: 9, typeID: 31358 }),
    slot("subsystem", 0, { itemID: 10, typeID: 30000 }),
  ];
  const rows = buildModuleRack(slots, null);
  assert.deepEqual(rows.map((r) => r.family), ["high", "mid", "low"]);
  assert.equal(rows[0]!.slots.length, 1);
  assert.equal(rows[1]!.slots.length, 1);
  assert.equal(rows[2]!.slots.length, 1);
  // The low slot is present but empty.
  assert.equal(rows[2]!.slots[0]!.module, null);
});

test("marks a module active when the snapshot lists its itemID", () => {
  const slots: FittingSlot[] = [
    slot("high", 0, { itemID: 1, typeID: 3634 }),
    slot("high", 1, { itemID: 2, typeID: 3634 }),
  ];
  const rows = buildModuleRack(slots, [1]);
  assert.equal(rows[0]!.slots[0]!.module?.active, true, "module 1 should be active");
  assert.equal(rows[0]!.slots[1]!.module?.active, false, "module 2 should be idle");
});

test("no snapshot means nothing glows", () => {
  const slots: FittingSlot[] = [slot("high", 0, { itemID: 1, typeID: 3634 })];
  assert.equal(buildModuleRack(slots, null)[0]!.slots[0]!.module?.active, false);
});

test("an offline module carries its offline flag through", () => {
  const slots: FittingSlot[] = [slot("mid", 0, { itemID: 7, typeID: 5001, online: false })];
  assert.equal(buildModuleRack(slots, [])[1]!.slots[0]!.module?.online, false);
});

test("rackIsEmpty is true only when no slots exist at all", () => {
  assert.equal(rackIsEmpty(buildModuleRack([], null)), true);
  assert.equal(rackIsEmpty(buildModuleRack([slot("high", 0, null)], null)), false);
});

test("the rack carries each module's itemID — what activation addresses", () => {
  const rows = buildModuleRack([slot("high", 0, { itemID: 42, typeID: 3634 })], []);
  assert.equal(rows[0]!.slots[0]!.module?.itemID, 42);
});

// --- the click decision -------------------------------------------------------

function rackModule(overrides: Partial<RackModule> = {}): RackModule {
  return { itemID: 42, typeID: 3634, online: true, active: false, charge: null, overloaded: false, damage: 0, bankMasterID: null, bankMaster: false, bankSize: 1, ...overrides };
}

test("a click on an idle online module ACTIVATES it", () => {
  assert.equal(rackClickAction(rackModule()), "activate");
});

test("a click on a cycling module DEACTIVATES it", () => {
  assert.equal(rackClickAction(rackModule({ active: true })), "deactivate");
});

test("⚠ an OFFLINE module is inert — onlining is a Fitting decision, not a rack misclick", () => {
  assert.equal(rackClickAction(rackModule({ online: false })), null);
  // Even an offline module the snapshot somehow calls active stays inert: the
  // fit's offline flag wins, because activating an offline module cannot work.
  assert.equal(rackClickAction(rackModule({ online: false, active: true })), null);
});

test("an empty slot has no click", () => {
  assert.equal(rackClickAction(null), null);
});

// --- the readout line ---------------------------------------------------------

test("the slot title names the module and what a click would do", () => {
  assert.equal(
    rackSlotTitle("Small Shield Booster I", rackModule()),
    "Small Shield Booster I — click to switch on. Shift-click to overload.",
  );
  assert.equal(
    rackSlotTitle("Small Shield Booster I", rackModule({ active: true })),
    "Small Shield Booster I — active. Click to switch off. Shift-click to overload.",
  );
  assert.equal(
    rackSlotTitle("Small Shield Booster I", rackModule({ online: false })),
    "Small Shield Booster I — offline (bring it online from the Fitting window)",
  );
  assert.equal(rackSlotTitle("", null), "Empty slot");
});

// --- What is loaded ----------------------------------------------------------
//
// The rack tile is a PICTURE of the module, so a gun that is out of ammunition
// looks exactly like a loaded one. The title is the only place that can say.

test("the rack carries the loaded charge through from the fit", () => {
  const slots: FittingSlot[] = [
    {
      family: "high",
      index: 0,
      module: {
        itemID: 42,
        typeID: 485,
        groupID: 55,
        online: true,
        charge: { itemID: 99, typeID: 184, quantity: 160 },
      },
    },
  ];
  assert.deepEqual(buildModuleRack(slots, [])[0]!.slots[0]!.module?.charge, {
    typeID: 184,
    quantity: 160,
  });
});

test("the slot title says what is loaded, by NAME and count", () => {
  const loaded = rackModule({ charge: { typeID: 184, quantity: 160 } });
  assert.equal(
    rackSlotTitle("150mm Light AutoCannon I", loaded, "Phased Plasma S"),
    "150mm Light AutoCannon I — click to switch on. Loaded: 160 Phased Plasma S. Shift-click to overload.",
  );
  // Cycling, and offline, keep their own wording and gain the same suffix.
  assert.match(
    rackSlotTitle("150mm Light AutoCannon I", rackModule({ charge: { typeID: 184, quantity: 160 }, active: true }), "Phased Plasma S"),
    /Click to switch off\. Loaded: 160 Phased Plasma S\. Shift-click to overload\.$/,
  );
});

test("a charge whose name has not resolved yet is left unsaid, never numbered", () => {
  // R7d — the id must not stand in for the name while it is in flight.
  const loaded = rackModule({ charge: { typeID: 184, quantity: 160 } });
  const title = rackSlotTitle("150mm Light AutoCannon I", loaded, null);
  assert.doesNotMatch(title, /184|Loaded/);
});

test("a module with no charge says nothing about ammunition", () => {
  assert.doesNotMatch(rackSlotTitle("Miner I", rackModule(), "Phased Plasma S"), /Loaded/);
});

// --- Overloading --------------------------------------------------------------
//
// ⚠ IT DAMAGES THE MODULE, which is why it lives behind a modifier rather than
// sharing the plain click that fires the gun. The tile is a picture, so the
// title is where the state and the modifier are both said in words.

test("the rack carries the overloaded flag from the snapshot", () => {
  const slots: FittingSlot[] = [
    slot("high", 0, { itemID: 1, typeID: 485 }),
    slot("high", 1, { itemID: 2, typeID: 485 }),
  ];
  const rows = buildModuleRack(slots, [], [1]);
  assert.equal(rows[0]!.slots[0]!.module?.overloaded, true);
  assert.equal(rows[0]!.slots[1]!.module?.overloaded, false);
});

test("⚠ an ABSENT overload list is unknown, NOT 'nothing is hot'", () => {
  // A rack that reported "cool" for a reading it never got would hide a module
  // burning itself out.
  const slots: FittingSlot[] = [slot("high", 0, { itemID: 1, typeID: 485 })];
  assert.equal(buildModuleRack(slots, [], null)[0]!.slots[0]!.module?.overloaded, null);
  assert.equal(buildModuleRack(slots, [])[0]!.slots[0]!.module?.overloaded, null);
  // An EMPTY list is a real answer: nothing is overloaded.
  assert.equal(buildModuleRack(slots, [], [])[0]!.slots[0]!.module?.overloaded, false);
});

test("an overloaded module says so, and says how to stop", () => {
  const title = rackSlotTitle("150mm Light AutoCannon I", rackModule({ overloaded: true }));
  assert.match(title, /Overloaded — running hot and taking damage\./);
  assert.match(title, /Shift-click to stop\.$/);
});

test("an UNKNOWN overload state says nothing about heat either way", () => {
  const title = rackSlotTitle("150mm Light AutoCannon I", rackModule({ overloaded: null }));
  assert.doesNotMatch(title, /overload/i);
  assert.doesNotMatch(title, /hot/i);
});

// --- Module damage and repair -------------------------------------------------
//
// ⚠ THE COMPLEMENT TO OVERLOADING. Heat damages modules, so shipping overload
// without any way to see or undo the damage left a one-way door: burn a module
// out and it is dead for the session. Damage is 0..1 with 1 meaning burnt out
// (runtime.js isModuleIncapacitated).

test("the rack carries per-module damage, and absent-from-the-map means intact", () => {
  const slots: FittingSlot[] = [
    slot("high", 0, { itemID: 1, typeID: 485 }),
    slot("high", 1, { itemID: 2, typeID: 485 }),
  ];
  const rows = buildModuleRack(slots, [], [], { 1: 0.4 });
  assert.equal(rows[0]!.slots[0]!.module?.damage, 0.4);
  assert.equal(rows[0]!.slots[1]!.module?.damage, 0, "listed nowhere = undamaged");
});

test("⚠ an ABSENT damage map is unknown, NOT 'everything is intact'", () => {
  const slots: FittingSlot[] = [slot("high", 0, { itemID: 1, typeID: 485 })];
  assert.equal(buildModuleRack(slots, [], [], null)[0]!.slots[0]!.module?.damage, null);
  assert.equal(buildModuleRack(slots, [], [])[0]!.slots[0]!.module?.damage, null);
  // An EMPTY map is a real answer.
  assert.equal(buildModuleRack(slots, [], [], {})[0]!.slots[0]!.module?.damage, 0);
});

test("burnt out is a definite 1 — unknown damage is never reported as burnt out", () => {
  assert.equal(rackModuleBurntOut(rackModule({ damage: 1 })), true);
  assert.equal(rackModuleBurntOut(rackModule({ damage: 0.99 })), false);
  assert.equal(rackModuleBurntOut(rackModule({ damage: 0 })), false);
  assert.equal(rackModuleBurntOut(rackModule({ damage: null })), false, "unknown is not burnt out");
  assert.equal(rackModuleBurntOut(null), false);
});

test("damage renders as whole percent, and says nothing when there is none", () => {
  assert.equal(rackDamageText(rackModule({ damage: 0.4 })), "40%");
  assert.equal(rackDamageText(rackModule({ damage: 0.055 })), "6%");
  assert.equal(rackDamageText(rackModule({ damage: 0 })), null);
  assert.equal(rackDamageText(rackModule({ damage: null })), null);
});

test("⚠ a burnt-out module's title leads with WHY it will not run", () => {
  // "click to switch on" on a module the server refuses outright is an
  // invitation to fail, so the damage comes first and names the remedy.
  const title = rackSlotTitle("150mm Light AutoCannon I", rackModule({ damage: 1 }));
  assert.match(title, /^150mm Light AutoCannon I — BURNT OUT\./);
  assert.match(title, /nanite paste/i);
  assert.doesNotMatch(title, /click to switch on/i);
});

test("a partly damaged module still works, and says how worn it is", () => {
  const title = rackSlotTitle("150mm Light AutoCannon I", rackModule({ damage: 0.25 }));
  assert.match(title, /click to switch on\./);
  assert.match(title, /Damaged: 25%\./);
});

// --- Weapon banking -----------------------------------------------------------
//
// ⚠ THE BUG THIS FIXES. dogmaService's Handle_Activate silently redirects a
// banked weapon to its bank MASTER, and the snapshot's activeModuleIDs then
// names only the master. A rack that read each slave's own id showed a tile that
// stayed dark however many times it was clicked, while the whole group fired.

test("⚠ a banked SLAVE reads active when its master is cycling", () => {
  const slots: FittingSlot[] = [
    slot("high", 0, { itemID: 100, typeID: 485 }), // master
    slot("high", 1, { itemID: 101, typeID: 485 }), // slave
  ];
  // Only the MASTER is in the server's cycling list — that is the whole point.
  const rows = buildModuleRack(slots, [100], [], {}, { 100: [101] });
  assert.equal(rows[0]!.slots[0]!.module?.active, true, "the master lights");
  assert.equal(rows[0]!.slots[1]!.module?.active, true, "and so does its slave");
});

test("an unbanked module is unaffected by other ships' banks", () => {
  const slots: FittingSlot[] = [slot("high", 0, { itemID: 200, typeID: 485 })];
  const rows = buildModuleRack(slots, [100], [], {}, { 100: [101] });
  assert.equal(rows[0]!.slots[0]!.module?.active, false);
  assert.equal(rows[0]!.slots[0]!.module?.bankSize, 1);
  assert.equal(rows[0]!.slots[0]!.module?.bankMasterID, null);
});

test("bank membership is carried through, master and slave alike", () => {
  const slots: FittingSlot[] = [
    slot("high", 0, { itemID: 100, typeID: 485 }),
    slot("high", 1, { itemID: 101, typeID: 485 }),
    slot("high", 2, { itemID: 102, typeID: 485 }),
  ];
  const rows = buildModuleRack(slots, [], [], {}, { 100: [101, 102] });
  const modules = rows[0]!.slots.map((s) => s.module!);
  const master = modules[0]!;
  const slaveA = modules[1]!;
  const slaveB = modules[2]!;
  assert.equal(master.bankMaster, true);
  assert.equal(master.bankMasterID, null, "a master fires through itself");
  assert.equal(master.bankSize, 3);
  assert.equal(slaveA.bankMasterID, 100);
  assert.equal(slaveA.bankSize, 3);
  assert.equal(slaveB.bankMasterID, 100);
});

test("⚠ an ABSENT bank map means unbanked, and never invents a group", () => {
  const slots: FittingSlot[] = [slot("high", 0, { itemID: 100, typeID: 485 })];
  for (const banks of [null, undefined]) {
    const module = buildModuleRack(slots, [], [], {}, banks)[0]!.slots[0]!.module!;
    assert.equal(module.bankSize, 1);
    assert.equal(module.bankMasterID, null);
    assert.equal(module.bankMaster, false);
  }
});

test("a banked gun's title says it fires with the others", () => {
  assert.match(
    rackSlotTitle("150mm Light AutoCannon I", rackModule({ bankSize: 3 })),
    /Banked: fires with 2 others\./,
  );
  // Singular reads correctly for a pair.
  assert.match(
    rackSlotTitle("150mm Light AutoCannon I", rackModule({ bankSize: 2 })),
    /Banked: fires with 1 other\./,
  );
  // And an unbanked gun says nothing about banks.
  assert.doesNotMatch(rackSlotTitle("Miner I", rackModule()), /Banked/);
});
