// The shell decision + model (shell.ts). Pure, no DOM: the docked flag maps to
// exactly one shell, and the slot tables are well-formed (unique ids, and every
// `wires` target is a real TabID so the next-pass wiring can't reference a panel
// that doesn't exist).

import test from "node:test";
import assert from "node:assert/strict";

import {
  shellFor,
  shellSlotIDs,
  STATION_SERVICES,
  STATION_PANELS,
  SPACE_PANELS,
  type ShellSlot,
} from "./shell.ts";
import { TABS, type TabID } from "./tabs.ts";

const TAB_IDS: ReadonlySet<TabID> = new Set(TABS.map((t) => t.id));

test("docked flag selects the shell", () => {
  assert.equal(shellFor(true), "station");
  assert.equal(shellFor(false), "space");
});

test("slot ids are unique within each shell", () => {
  for (const kind of ["station", "space"] as const) {
    const ids = shellSlotIDs(kind);
    assert.equal(new Set(ids).size, ids.length, `${kind} shell has a duplicate slot id`);
  }
});

test("every wired slot targets a real tab", () => {
  const all: readonly ShellSlot[] = [...STATION_SERVICES, ...STATION_PANELS, ...SPACE_PANELS];
  for (const slot of all) {
    if (slot.wires !== null) {
      assert.ok(TAB_IDS.has(slot.wires), `slot ${slot.id} wires to unknown tab ${slot.wires}`);
    }
  }
});

test("the docked default panel (station) and in-space default (overview) each have a slot", () => {
  assert.ok(
    [...STATION_SERVICES, ...STATION_PANELS].some((s) => s.wires === "station"),
    "no docked slot hosts the station panel",
  );
  assert.ok(SPACE_PANELS.some((s) => s.wires === "overview"), "no HUD slot hosts the overview");
});
