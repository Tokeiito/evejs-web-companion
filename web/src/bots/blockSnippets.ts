// Ready-made BLOCK GROUPS for the Bot Builder. These are deliberately smaller
// than complete example bots: inserting one appends a proven sequence to the
// bot the player is already editing; it never replaces their name, watches,
// home, repeat setting, or existing blocks.

import {
  startingStation,
  type MacroID,
  type MacroStep,
  type ProgramNode,
} from "./botScript.ts";

export const BLOCK_SNIPPET_IDS = [
  "safe-return-home",
  "mine-haul-cycle",
  "clear-loot-salvage",
  "fleet-logistics",
  "dock-refit-repair",
] as const;

export type BlockSnippetID = (typeof BLOCK_SNIPPET_IDS)[number];

export interface BlockSnippet {
  readonly id: BlockSnippetID;
  /** Short button/card label in player language. */
  readonly label: string;
  /** Exactly what is appended to the current bot. */
  readonly adds: string;
  /** A choice the player must make for insertion, or null when ready as-is. */
  readonly setup: string | null;
  readonly steps: readonly MacroStep[];
}

export interface BlockSnippetBindings {
  /** The player's explicit saved-fitting choice for a refit-bearing group. */
  readonly fitting?: { readonly fittingID: number; readonly name: string };
}

export interface AppendBlockSnippetOptions {
  readonly bindings?: BlockSnippetBindings;
  /** Non-program ids in the same document (for example interrupt handles). */
  readonly reservedIDs?: ReadonlySet<string>;
}

function step(
  id: string,
  macro: MacroID,
  args: MacroStep["args"] = {},
  until?: MacroStep["until"],
): MacroStep {
  return until === undefined
    ? { id, kind: "macro", macro, args }
    : { id, kind: "macro", macro, args, until };
}

/**
 * Exhaustive over BlockSnippetID: adding an id above cannot compile until its
 * complete, typed group is added here too. Every step uses the existing
 * MacroID/Arg format, so renamed or removed runtime blocks also fail at compile
 * time instead of becoming a dead builder button.
 */
export const BLOCK_SNIPPETS: Readonly<Record<BlockSnippetID, BlockSnippet>> = {
  "safe-return-home": {
    id: "safe-return-home",
    label: "Safe return home",
    adds: "Fly back to the station where this run began, empty the cargo hold, and repair the ship.",
    setup: null,
    steps: [
      step("safe-home-travel", "travel-to-station", {
        station: { kind: "station", ref: startingStation() },
      }),
      step("safe-home-unload", "unload-cargo"),
      step("safe-home-repair", "repair-ship"),
    ],
  },
  "mine-haul-cycle": {
    id: "mine-haul-cycle",
    label: "Mine and haul cycle",
    adds: "Undock, mine the nearest belt until the ore hold is 90% full, then haul it to the starting station.",
    setup: null,
    steps: [
      step("mine-haul-undock", "undock"),
      step(
        "mine-haul-mine",
        "mine-at-belt",
        { belt: { kind: "belt", belt: { mode: "nearest" } } },
        { kind: "ore-hold-at-least", fraction: 0.9 },
      ),
      step("mine-haul-deliver", "deliver-ore", {
        station: { kind: "station", ref: startingStation() },
      }),
    ],
  },
  "clear-loot-salvage": {
    id: "clear-loot-salvage",
    label: "Clear an anomaly",
    adds: "Undock, harden the ship, visit the next combat anomaly, clear the rats, loot your wrecks, then salvage them.",
    setup: null,
    steps: [
      step("anomaly-undock", "undock"),
      step("anomaly-harden", "hardeners-on"),
      step("anomaly-warp", "warp-to-anomaly"),
      step("anomaly-fight", "fight-the-rats"),
      step("anomaly-loot", "loot-wrecks"),
      step("anomaly-salvage", "salvage-wrecks"),
    ],
  },
  "fleet-logistics": {
    id: "fleet-logistics",
    label: "Fleet logistics support",
    adds: "Wait for a fleet invite, undock, harden up, repair fleet-mates, feed capacitor, then orbit close and keep repairing.",
    setup: null,
    steps: [
      step("logi-join", "join-fleet"),
      step("logi-undock", "undock"),
      step("logi-harden", "hardeners-on"),
      step("logi-repair", "remote-rep"),
      step("logi-cap", "remote-cap"),
      step("logi-anchor", "orbit-and-boost"),
    ],
  },
  "dock-refit-repair": {
    id: "dock-refit-repair",
    label: "Dock, refit, and repair",
    adds: "Dock at the nearest station, unload, apply a saved fitting, repair the new hull and modules, then tidy the hangar.",
    setup: "Choose the saved fitting this group should apply.",
    steps: [
      step("turnaround-dock", "dock-at-nearest"),
      step("turnaround-unload", "unload-cargo"),
      // The argument SHAPE is complete so the codec round-trips it. A null pick
      // remains visible to validation/UI; inventing a fitting would be unsafe.
      step("turnaround-refit", "refit-ship", {
        fitting: { kind: "fitting", fittingID: null, name: null },
      }),
      step("turnaround-repair", "repair-ship"),
      step("turnaround-tidy", "tidy-hangar"),
    ],
  },
};

export const BLOCK_SNIPPET_LIST: readonly BlockSnippet[] = Object.freeze(
  BLOCK_SNIPPET_IDS.map((id) => BLOCK_SNIPPETS[id]),
);

/** Every id in a program, including ids nested under a loop or branch. */
export function programNodeIDs(program: readonly ProgramNode[]): ReadonlySet<string> {
  const ids = new Set<string>();
  const visit = (node: ProgramNode): void => {
    ids.add(node.id);
    if (node.kind === "loop") {
      node.body.forEach(visit);
    } else if (node.kind === "branch") {
      node.then.forEach(visit);
      node.else.forEach(visit);
    }
  };
  program.forEach(visit);
  return ids;
}

/**
 * Materialize one group with ids that are fresh against the current program and
 * against every other node in this insertion. The catalog's ids are examples
 * only and never escape into a player's document.
 */
export function instantiateBlockSnippet(
  id: BlockSnippetID,
  makeId: () => string,
  reserved: ReadonlySet<string> = new Set<string>(),
  bindings: BlockSnippetBindings = {},
): readonly MacroStep[] {
  const used = new Set(reserved);
  const fresh = (): string => {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const candidate = makeId().trim();
      if (candidate.length > 0 && !used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
    throw new Error("Could not make a fresh block id.");
  };
  return BLOCK_SNIPPETS[id].steps.map((template) => {
    const cloned = structuredClone(template) as MacroStep;
    const bound =
      cloned.macro === "refit-ship" && bindings.fitting !== undefined
        ? {
            ...cloned,
            args: {
              ...cloned.args,
              fitting: {
                kind: "fitting" as const,
                fittingID: bindings.fitting.fittingID,
                name: bindings.fitting.name,
              },
            },
          }
        : cloned;
    return { ...bound, id: fresh() };
  });
}

/** Append a group without replacing or mutating any existing node. */
export function appendBlockSnippet<T extends ProgramNode>(
  program: readonly T[],
  id: BlockSnippetID,
  makeId: () => string,
  options: AppendBlockSnippetOptions = {},
): readonly (T | MacroStep)[] {
  const reserved = new Set(options.reservedIDs ?? []);
  for (const nodeID of programNodeIDs(program)) {
    reserved.add(nodeID);
  }
  return [
    ...program,
    ...instantiateBlockSnippet(id, makeId, reserved, options.bindings),
  ];
}
