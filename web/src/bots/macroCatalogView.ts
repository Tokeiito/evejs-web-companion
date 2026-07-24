// C3 — the palette's view of the macros: the plain name, a one-line "what it
// does", a one-line "what it needs", and which picker each parameter uses. Pure
// UI metadata — the Svelte palette and inspector read it, and a test proves every
// macro has an entry and that none of this copy carries an id or engineering word
// (R7d / R9a).
//
// The parameters are DERIVED from the shared `macroSpecs.ts`, so the palette can
// never offer a control for an argument the codec/validator don't know about.

import { MACRO_IDS, type MacroID } from "./botScript.ts";
import { MACRO_SPECS, type MacroArgSpec } from "./macroSpecs.ts";
import { macroName } from "./scriptText.ts";

/** Which inspector widget fills a parameter. */
export type ParamPicker = "belt" | "station" | "equipment" | "agent" | "count" | "corp";

export interface MacroParamView {
  readonly key: string;
  readonly label: string;
  readonly picker: ParamPicker;
  readonly required: boolean;
}

export interface MacroCatalogEntry {
  readonly id: MacroID;
  readonly name: string;
  /** What it does, one line. */
  readonly does: string;
  /** What it needs before it can start, one line — or null when it needs nothing. */
  readonly needs: string | null;
  readonly params: readonly MacroParamView[];
  /** Whether an `until` is required (mine-at-belt) — the inspector makes it mandatory. */
  readonly untilRequired: boolean;
}

const PARAM_LABEL: Readonly<Record<string, string>> = {
  belt: "Belt",
  station: "Station",
  equipment: "Equipment",
  agent: "Agent",
  level: "Agent level",
  maxJumps: "Longest trip (jumps)",
  corporation: "Corporation",
  seconds: "Seconds",
  fitting: "Saved fitting",
  item: "Item",
  from: "From",
  to: "To",
  amount: "How many",
  bookmark: "Saved spot",
};

function paramView(arg: MacroArgSpec): MacroParamView {
  return {
    key: arg.key,
    label: PARAM_LABEL[arg.key] ?? arg.key,
    picker: arg.kind as ParamPicker,
    required: arg.required,
  };
}

function entry(id: MacroID, does: string, needs: string | null): MacroCatalogEntry {
  const spec = MACRO_SPECS[id];
  return {
    id,
    name: macroName(id),
    does,
    needs,
    params: spec.args.map(paramView),
    untilRequired: spec.untilRequired,
  };
}

/** Exhaustive by the Record type — a new macro cannot compile without an entry. */
const ENTRIES: Readonly<Record<MacroID, MacroCatalogEntry>> = {
  undock: entry("undock", "Undocks your ship.", null),
  "travel-to-station": entry(
    "travel-to-station",
    "Flies to a station, through gates if it needs to, and docks.",
    "A station to go to",
  ),
  "mine-at-belt": entry(
    "mine-at-belt",
    "Warps to a belt, locks rocks, and runs your mining equipment — moving on when a belt runs dry.",
    "A belt and mining equipment fitted",
  ),
  "deliver-ore": entry(
    "deliver-ore",
    "Flies to a station and unloads the ore into your hangar.",
    "A station to unload at",
  ),
  "defend-with-drones": entry(
    "defend-with-drones",
    "Launches your combat drones, targets the pirates, and sets them attacking.",
    "Combat drones in the bay",
  ),
  // ── The distribution-mission set. Wire them in order (usually inside a Repeat
  // loop): find an agent → ask for work → accept → load → deliver → turn in →
  // fly back. Later blocks use the agent and mission the earlier ones found.
  "find-distribution-agent": entry(
    "find-distribution-agent",
    "Searches for a delivery (distribution) agent by level, distance and corporation, and remembers the best match for the blocks after it.",
    null,
  ),
  "request-mission": entry(
    "request-mission",
    "Flies to the agent's station, docks, and asks for a mission.",
    "An agent — picked here, or found by the block before",
  ),
  "accept-mission": entry(
    "accept-mission",
    "Checks the offer (trip length, whether the cargo fits your ship) and accepts it — or turns it down and asks again.",
    null,
  ),
  "load-mission-cargo": entry(
    "load-mission-cargo",
    "Moves the mission cargo from the pickup hangar into your ship, and checks it is really aboard.",
    "An accepted mission",
  ),
  "travel-to-dropoff": entry(
    "travel-to-dropoff",
    "Sets the destination to the mission's drop-off station and flies there, gate to gate, and docks.",
    "An accepted mission with cargo aboard",
  ),
  "turn-in-mission": entry(
    "turn-in-mission",
    "Unloads the cargo at the drop-off and tells the agent the job is done.",
    "Being docked at the drop-off station",
  ),
  "return-to-agent": entry(
    "return-to-agent",
    "Flies back to the agent's station and docks, ready to ask for the next mission.",
    "An agent found or picked earlier in the run",
  ),
  wait: entry(
    "wait",
    "Does nothing for a set number of seconds — a breather between blocks. Give it a \"stop when\" to wait for something instead (like shields recovering).",
    null,
  ),
  "unload-cargo": entry(
    "unload-cargo",
    "Moves everything in your ship's cargo hold into the station hangar, and checks the hold really is empty. Handy before accepting a delivery, so the cargo is sure to fit.",
    "Being docked",
  ),
  "salvage-wrecks": entry(
    "salvage-wrecks",
    "Works through the wrecks around you: salvage drones sweep on their own, and fitted salvagers are run on each wreck in turn. Finishes when nothing salvageable is left, drones home.",
    "Salvage drones in the bay, or salvagers fitted",
  ),
  "loot-wrecks": entry(
    "loot-wrecks",
    "Flies to each of YOUR OWN wrecks in turn and takes what's inside. It never touches anyone else's wreck, so it can never get you flagged as a thief.",
    "Wrecks of yours on the grid",
  ),
  "refine-ore": entry(
    "refine-ore",
    "Runs every ore stack in the station hangar through the refinery. The station takes its cut in tax; anything it cannot be sure is ore is left alone.",
    "Being docked, with ore in the hangar",
  ),
  "hardeners-on": entry(
    "hardeners-on",
    "Switches every fitted hardener and damage control on — one block at the top of a fight or a mining trip. Finishes once they are all running.",
    "Hardeners or a damage control fitted",
  ),
  "fight-the-rats": entry(
    "fight-the-rats",
    "Locks the nearest pirate, runs your guns on it and sets the drones on it too, then moves to the next. Finishes when the grid is clear and the drones are back aboard.",
    "Guns fitted, or combat drones in the bay",
  ),
  "warp-to-anomaly": entry(
    "warp-to-anomaly",
    "Reads your ship's scanner and warps to the next pirate den it shows, skipping the ones this run has already visited. Pair it with Fight the rats in a repeat loop.",
    "Being in space, with a den on the scanner",
  ),
  "refit-ship": entry(
    "refit-ship",
    "Boards the right hull from your hangar if you are flying something else, then applies the saved fitting you picked — modules pulled from this station's hangar.",
    "Being docked, the saved fitting, and its modules in the hangar",
  ),
  "move-items": entry(
    "move-items",
    "Moves an item you pick between the station hangar and your ship's holds — a set amount, or every last one — and checks the move really landed.",
    "Being docked, with the item where you said it is",
  ),
  "warp-to-bookmark": entry(
    "warp-to-bookmark",
    "Warps to one of your saved spots — a mission site, a safe spot, a mining perch. Finishes when the warp lands.",
    "Being in space, in the saved spot's system",
  ),
  "find-combat-agent": entry(
    "find-combat-agent",
    "Searches for a combat (security) agent by level, distance and corporation, and remembers the best match for the blocks after it.",
    null,
  ),
  "fly-to-mission-site": entry(
    "fly-to-mission-site",
    "Warps to the site of the mission you accepted — the spot the agent marked for you. Finishes when the warp lands. Put Fight the rats right after it.",
    "An accepted mission, in the mission's system",
  ),
  "restart-extractors": entry(
    "restart-extractors",
    "Checks every planet colony you own and restarts each extractor whose program has run out, on the same resource it was already pulling. Works from anywhere.",
    "A planet colony with extractors",
  ),
  "repair-ship": entry(
    "repair-ship",
    "Asks the station's repair shop what is damaged on your ship and its fitted modules, fixes it, and checks the shop agrees there is nothing left to fix. The station charges your wallet.",
    "Being docked, with money for the shop",
  ),
};

export const MACRO_CATALOG: Readonly<Record<MacroID, MacroCatalogEntry>> = ENTRIES;

/** The palette list, in menu order. */
export const MACRO_CATALOG_LIST: readonly MacroCatalogEntry[] = MACRO_IDS.map((id) => ENTRIES[id]);

export function macroEntry(id: MacroID): MacroCatalogEntry {
  return ENTRIES[id];
}
