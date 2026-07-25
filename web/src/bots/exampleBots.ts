// Bundled EXAMPLE BOTS — one per play style, each a complete wired program a
// player can load, glance over, and start. They are typed against the format
// (a block renamed without updating an example fails to compile) and a test
// round-trips each through the CODEC and the VALIDATOR, so a bundled example
// can never be a program the import gate would refuse or the editor would
// flag. Every world slot uses a runtime binding ("nearest", "starting
// station", find-an-agent) so the examples work on ANY character, anywhere.

import { startingStation, type BotScript } from "./botScript.ts";

export interface ExampleBot {
  readonly key: string;
  /** The preset button label (R9a — play language). */
  readonly label: string;
  /** One line under the button. */
  readonly blurb: string;
  readonly doc: BotScript;
}

const FORMAT = { format: "evejs-bot-script", version: 1 } as const;

/** Mine → haul home → refine, forever; reps when shot, drones on rats. */
const MINING_DAY: BotScript = {
  ...FORMAT,
  name: "Mining day",
  notes: "Mines the nearest belt, hauls home, refines, repeats.",
  home: startingStation(),
  interrupts: [
    { id: "w-shield", when: { kind: "shield-below", fraction: 0.5 }, respond: "repair" },
    { id: "w-rats", when: { kind: "hostile-on-grid" }, respond: "launch-drones" },
    { id: "w-hull", when: { kind: "hull-below", fraction: 0.5 }, respond: "dock-and-pause" },
  ],
  program: [
    {
      id: "loop",
      kind: "loop",
      repeat: { kind: "forever" },
      body: [
        { id: "s1", kind: "macro", macro: "undock", args: {} },
        {
          id: "s2",
          kind: "macro",
          macro: "mine-at-belt",
          args: { belt: { kind: "belt", belt: { mode: "nearest" } } },
          until: { kind: "ore-hold-at-least", fraction: 0.9 },
        },
        { id: "s3", kind: "macro", macro: "deliver-ore", args: { station: { kind: "station", ref: startingStation() } } },
        { id: "s4", kind: "macro", macro: "refine-ore", args: {} },
      ],
    },
  ],
};

/** The distribution-mission loop: find an agent once, then run deliveries. */
const DELIVERY_RUNS: BotScript = {
  ...FORMAT,
  name: "Delivery runs",
  notes: "Finds a delivery agent and runs missions back to back.",
  home: startingStation(),
  interrupts: [
    { id: "w-hull", when: { kind: "hull-below", fraction: 0.5 }, respond: "dock-and-pause" },
  ],
  program: [
    {
      id: "loop",
      kind: "loop",
      repeat: { kind: "times", count: 20 },
      body: [
        // Finding the agent is instant on every lap after the first (the run
        // remembers who it works with), so it lives inside the loop.
        { id: "s1", kind: "macro", macro: "find-distribution-agent", args: { level: { kind: "count", value: 1 } } },
        { id: "s2", kind: "macro", macro: "request-mission", args: {} },
        { id: "s3", kind: "macro", macro: "accept-mission", args: { maxJumps: { kind: "count", value: 6 } } },
        { id: "s4", kind: "macro", macro: "load-mission-cargo", args: {} },
        { id: "s5", kind: "macro", macro: "travel-to-dropoff", args: {} },
        { id: "s6", kind: "macro", macro: "turn-in-mission", args: {} },
        { id: "s7", kind: "macro", macro: "return-to-agent", args: {} },
      ],
    },
  ],
};

/** The ratting loop: den to den, guns + drones, sweep and loot the field. */
const RATTING_NIGHT: BotScript = {
  ...FORMAT,
  name: "Ratting night",
  notes: "Anomaly to anomaly: clear it, salvage it, loot it, next.",
  home: startingStation(),
  interrupts: [
    { id: "w-shield", when: { kind: "shield-below", fraction: 0.6 }, respond: "repair" },
    { id: "w-armor", when: { kind: "armor-below", fraction: 0.5 }, respond: "dock-and-pause" },
  ],
  program: [
    {
      id: "loop",
      kind: "loop",
      repeat: { kind: "forever" },
      body: [
        // Undock/hardeners finish instantly on every lap after the first, so
        // the whole night fits one loop (which is also the editor's shape).
        { id: "s1", kind: "macro", macro: "undock", args: {} },
        { id: "s2", kind: "macro", macro: "hardeners-on", args: {} },
        { id: "s3", kind: "macro", macro: "warp-to-anomaly", args: {} },
        { id: "s4", kind: "macro", macro: "fight-the-rats", args: {} },
        { id: "s5", kind: "macro", macro: "salvage-wrecks", args: {} },
        { id: "s6", kind: "macro", macro: "loot-wrecks", args: {} },
      ],
    },
  ],
};

/** The PI keeper: restart what expired, nap, repeat. */
const PLANET_KEEPER: BotScript = {
  ...FORMAT,
  name: "Planet keeper",
  notes: "Restarts expired extractors, then checks again after a break.",
  home: startingStation(),
  interrupts: [],
  program: [
    {
      id: "loop",
      kind: "loop",
      repeat: { kind: "forever" },
      body: [
        { id: "s1", kind: "macro", macro: "restart-extractors", args: {} },
        { id: "s2", kind: "macro", macro: "wait", args: { seconds: { kind: "count", value: 500 } } },
      ],
    },
  ],
};

/** A branch demo, forever: mine a belt, haul home, then FORK on the ship's
 * shields — repair if it took a beating this lap, otherwise refine what it
 * mined. The branch lives INSIDE the loop, so the choice is made fresh each lap. */
const SMART_MINER: BotScript = {
  ...FORMAT,
  name: "Smart miner",
  notes: "Mines and hauls on a loop, then each lap either repairs the ship (if it got hurt) or refines the ore.",
  home: startingStation(),
  interrupts: [{ id: "w-hull", when: { kind: "hull-below", fraction: 0.4 }, respond: "dock-and-pause" }],
  program: [
    {
      id: "loop",
      kind: "loop",
      repeat: { kind: "forever" },
      body: [
        { id: "s1", kind: "macro", macro: "undock", args: {} },
        {
          id: "s2",
          kind: "macro",
          macro: "mine-at-belt",
          args: { belt: { kind: "belt", belt: { mode: "nearest" } } },
          until: { kind: "ore-hold-at-least", fraction: 0.9 },
        },
        { id: "s3", kind: "macro", macro: "deliver-ore", args: { station: { kind: "station", ref: startingStation() } } },
        // Docked at home now — fork on how the shields held up THIS lap.
        {
          id: "br",
          kind: "branch",
          when: { kind: "shield-below", fraction: 0.6 },
          then: [{ id: "t1", kind: "macro", macro: "repair-ship", args: {} }],
          else: [{ id: "e1", kind: "macro", macro: "refine-ore", args: {} }],
        },
      ],
    },
  ],
};

export const EXAMPLE_BOTS: readonly ExampleBot[] = Object.freeze([
  { key: "mining", label: "Mining day", blurb: "Mine, haul home, refine — forever.", doc: MINING_DAY },
  { key: "delivery", label: "Delivery runs", blurb: "Find an agent, run 20 deliveries.", doc: DELIVERY_RUNS },
  { key: "ratting", label: "Ratting night", blurb: "Den to den: fight, salvage, loot.", doc: RATTING_NIGHT },
  { key: "planets", label: "Planet keeper", blurb: "Keep the extractors running.", doc: PLANET_KEEPER },
  { key: "smart", label: "Smart miner", blurb: "Mine, haul, then repair or refine.", doc: SMART_MINER },
]);
