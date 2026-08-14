// The in-space HUD's panel slots.
//
// ⚠ WHAT THIS FILE USED TO BE. It was the model behind two top-level spatial
// shells — `StationShell` (docked) and `SpaceShell` (in space) — switched by
// `deriveDocked`, each with a rail of slots naming the panel it would host.
// Those shells were superseded by the windowing workspace (`Workspace.svelte`:
// a Neocom rail, a desktop of floating windows, a fixed dock panel and a bottom
// HUD bar) and were deleted once they turned out to be reachable only from their
// own test.
//
// What survived is the one part the live UI still uses: the list of flight
// panels the in-space HUD bar offers as buttons. `STATION_SERVICES`,
// `STATION_SERVICE_GROUPS`, `shellFor` and `shellSlotIDs` went with the shells —
// the docked side of the app is the dock panel and the Neocom now, and it does
// not read a slot table.

import type { TabID } from "./tabs.ts";

/**
 * One panel the HUD offers. `wires` names the tab it opens; it is nullable
 * because the slot model once described station services with no panel behind
 * them, and the field is still read defensively by the HUD bar's filter.
 */
export interface ShellSlot {
  readonly id: string;
  readonly label: string;
  readonly wires: TabID | null;
  /** One line describing what it is for — shown as the button's tooltip. */
  readonly hint: string;
}

// The panels reachable from the in-space HUD bar. The overview is deliberately
// here even though it is not a HUD button: it is the fixed top-right dock panel,
// and `HudBar` filters it out by id rather than this list pretending it does not
// exist.
export const SPACE_PANELS: readonly ShellSlot[] = [
  { id: "hud-overview", label: "Overview", wires: "overview", hint: "Everything around your ship." },
  { id: "hud-nav", label: "Navigation & Flight", wires: "flight", hint: "Where you are, where you're headed, and manual flight." },
  { id: "hud-mining", label: "Mining", wires: "mining", hint: "Mining lasers, targets, and yield." },
];
