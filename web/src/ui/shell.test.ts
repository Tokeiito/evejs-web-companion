// The in-space HUD's panel list (shell.ts). Pure, no DOM.
//
// This file used to test the two-shell model as well — `shellFor`, the station
// service groups, the slot-id uniqueness across both shells. Those went with
// `StationShell`/`SpaceShell` when the shells were deleted for being reachable
// only from their own test. What is left is the claim that still has a live
// consumer: the HUD bar's buttons cannot point at a panel that does not exist.

import test from "node:test";
import assert from "node:assert/strict";

import { SPACE_PANELS } from "./shell.ts";
import { TABS, type TabID } from "./tabs.ts";

const TAB_IDS: ReadonlySet<TabID> = new Set(TABS.map((t) => t.id));

test("slot ids are unique", () => {
  const ids = SPACE_PANELS.map((slot) => slot.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate slot id");
});

test("every wired slot targets a REAL tab", () => {
  // The HUD bar turns each of these into a button that calls `onOpen(wires)`.
  // A typo here is a button that opens nothing, silently.
  for (const slot of SPACE_PANELS) {
    if (slot.wires !== null) {
      assert.ok(TAB_IDS.has(slot.wires), `slot ${slot.id} wires to unknown tab ${slot.wires}`);
    }
  }
});

test("the HUD lists the overview slot", () => {
  // It is not drawn as a HUD button — it is the fixed dock panel — but it is
  // listed so `HudBar` can filter it out by id rather than this table pretending
  // the overview does not exist.
  assert.ok(SPACE_PANELS.some((slot) => slot.wires === "overview"), "no slot hosts the overview");
});

test("every slot carries words for a player", () => {
  for (const slot of SPACE_PANELS) {
    assert.ok(slot.label.length > 0, `slot ${slot.id} has no label`);
    assert.ok(slot.hint.length > 0, `slot ${slot.id} has no tooltip`);
  }
});
