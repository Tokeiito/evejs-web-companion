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
  STATION_SERVICE_GROUPS,
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
  const all: readonly ShellSlot[] = [...STATION_SERVICES, ...SPACE_PANELS];
  for (const slot of all) {
    if (slot.wires !== null) {
      assert.ok(TAB_IDS.has(slot.wires), `slot ${slot.id} wires to unknown tab ${slot.wires}`);
    }
  }
});

test("the docked services host the docked-only tabs (fitting, travel, bots)", () => {
  const wired = STATION_SERVICES.filter((s) => s.wires !== null).map((s) => s.wires);
  for (const tab of ["fitting", "travel", "bots"] as const) {
    assert.ok(wired.includes(tab), `the docked services do not open ${tab}`);
  }
});

test("the HUD hosts the overview slot", () => {
  assert.ok(SPACE_PANELS.some((s) => s.wires === "overview"), "no HUD slot hosts the overview");
});

test("the service groups partition STATION_SERVICES: wired panels vs not-yet-built", () => {
  const grouped = STATION_SERVICE_GROUPS.flatMap((g) => g.slots);
  // Every service appears in exactly one group, none lost or duplicated.
  assert.equal(grouped.length, STATION_SERVICES.length);
  assert.deepEqual(
    new Set(grouped.map((s) => s.id)),
    new Set(STATION_SERVICES.map((s) => s.id)),
  );
  const panels = STATION_SERVICE_GROUPS.find((g) => g.label === "Panels")!;
  const services = STATION_SERVICE_GROUPS.find((g) => g.label === "Station Services")!;
  assert.ok(panels.slots.every((s) => s.wires !== null), "a Panels entry opens no panel");
  assert.ok(services.slots.every((s) => s.wires === null), "a Station Services entry is unexpectedly wired");
});
