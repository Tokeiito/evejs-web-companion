// The two top-level UI SHELLS (docked vs undocked as the WHOLE UI, not a tab
// filter). Until now docked/in-space only swapped which tabs a single shared
// workspace showed (see tabs.ts). This promotes the distinction to two
// genuinely different spatial layouts, mirroring the retail client: a station
// interior with a services rail when docked, a HUD over a space viewport when
// in space.
//
// This module is the DATA + pure decision, kept out of the .svelte files so the
// rules are unit-testable without a DOM and so the panels that will fill each
// slot are declared in one place. This first pass renders PLACEHOLDER panels in
// these slots; each slot names the existing tab/panel that will be wired into it
// next (the `wires` field), so the follow-up is a mechanical swap, not a
// redesign.

import type { TabID } from "./tabs.ts";

/** Which shell the whole UI is in. */
export type ShellKind = "station" | "space";

/**
 * The shell for the current state, from the same authoritative docked flag that
 * drives tabs.ts (deriveDocked). Docked → the station interior; in space → the
 * flight HUD. One function, so the App renderer stays thin.
 */
export function shellFor(isDocked: boolean): ShellKind {
  return isDocked ? "station" : "space";
}

/**
 * One spatial slot in a shell — a region that shows a placeholder now and will
 * host a real panel later. `wires` names the existing tab/panel destined for the
 * slot (null = a station service or HUD element with no panel built yet), which
 * both documents the next pass and keeps this file honest about what exists.
 */
export interface ShellSlot {
  readonly id: string;
  readonly label: string;
  readonly wires: TabID | null;
  /** One line describing what belongs here — shown in the placeholder. */
  readonly hint: string;
}

// ── Docked: the station-services rail (left), mirroring EVE's station panel ──
// The retail station column mixes true station services (reprocess/repair/
// insurance) with the panels a docked pilot reaches most (fitting, market,
// industry) plus our docked tools (travel, bots). A slot with a `wires` opens
// that real panel; a null `wires` is a station service with no panel built yet.
export const STATION_SERVICES: readonly ShellSlot[] = [
  { id: "svc-fitting", label: "Fitting", wires: "fitting", hint: "Fit the active ship." },
  { id: "svc-market", label: "Market", wires: "market", hint: "Regional market — buy and sell." },
  { id: "svc-industry", label: "Industry", wires: "industry", hint: "Jobs, blueprints, and facilities." },
  { id: "svc-travel", label: "Travel", wires: "travel", hint: "Plan and set your autopilot route." },
  { id: "svc-bots", label: "Bots", wires: "bots", hint: "Mining and mission automation." },
  { id: "svc-repair", label: "Repair Shop", wires: null, hint: "Repair modules and hull. (Service — not yet built.)" },
  { id: "svc-reprocess", label: "Reprocessing", wires: null, hint: "Reprocess items to minerals. (Service — not yet built.)" },
  { id: "svc-insurance", label: "Insurance", wires: null, hint: "Insure the active ship. (Service — not yet built.)" },
];

// ── In space: the HUD panels reachable from the viewport chrome ──
export const SPACE_PANELS: readonly ShellSlot[] = [
  { id: "hud-overview", label: "Overview", wires: "overview", hint: "Everything around your ship." },
  { id: "hud-nav", label: "Navigation & Flight", wires: "flight", hint: "Where you are, where you're headed, and manual flight." },
  { id: "hud-mining", label: "Mining", wires: "mining", hint: "Mining lasers, targets, and yield." },
];

/** Sanity for the model — every slot id across a shell is unique. */
export function shellSlotIDs(kind: ShellKind): readonly string[] {
  const slots = kind === "station" ? STATION_SERVICES : SPACE_PANELS;
  return slots.map((s) => s.id);
}
