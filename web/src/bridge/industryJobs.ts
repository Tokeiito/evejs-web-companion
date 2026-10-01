// Jobs against a plan (goal R109 slice 5): what is already being made, and
// what can be started next. Pure; the panel hands in each online pilot's own
// industry read.
//
// ---------------------------------------------------------------------------
// A JOB IS SUPPLY THAT HAS NOT ARRIVED YET.
//
// A running, paused or ready job will put its product in a hangar; until it is
// delivered it is counted as in production, which the resolver treats like
// stock (bridge/industryChain.ts). Delivered, it is stock, and the next stock
// read sees it there. Units are runs times what one run makes, from the recipe.
//
// ---------------------------------------------------------------------------
// START NEXT IS A LIST, NOT A SCHEDULER.
//
// It says which steps of the plan have every input in hand, grouped by stage the
// way a build is worked (buy, then reactions, then components, then the final
// item). Starting one is the Industry panel's job, behind its own confirm; this
// only says which pilot holds the blueprint to start it with.

import type { IndustryJobRow } from "../store/types.ts";
import { isActiveJob } from "./industry.ts";
import type { IndustryChain, IndustryLine } from "./industryChain.ts";
import type { IndustryRecipeBook } from "./industryRecipes.ts";
import type { OwnedBlueprint } from "./industryOwned.ts";
import type { PilotStockStack } from "./piRoster.ts";

/** Units being made per product type, and how many of them are ready to deliver. */
export interface JobSupply {
  readonly inProduction: Map<number, number>;
  readonly ready: Map<number, number>;
}

/**
 * Every pilot's active jobs, counted once each (two sessions on one pilot read
 * the same jobs), as units of their product.
 */
export function jobSupply(jobLists: readonly (readonly IndustryJobRow[])[], book: IndustryRecipeBook | null): JobSupply {
  const inProduction = new Map<number, number>();
  const ready = new Map<number, number>();
  const seen = new Set<number>();
  for (const jobs of jobLists) {
    for (const job of jobs) {
      if (seen.has(job.jobID)) continue;
      seen.add(job.jobID);
      if (!isActiveJob(job.status)) continue;
      if (job.activity !== "manufacturing" && job.activity !== "reaction") continue;
      if (job.productTypeID <= 0 || job.runs <= 0) continue;
      const perRun = book?.byProduct.get(job.productTypeID)?.quantityPerRun ?? 1;
      const units = job.runs * perRun;
      inProduction.set(job.productTypeID, (inProduction.get(job.productTypeID) ?? 0) + units);
      if (job.status === "ready") {
        ready.set(job.productTypeID, (ready.get(job.productTypeID) ?? 0) + units);
      }
    }
  }
  return { inProduction, ready };
}

export type StartStage = "reactions" | "components" | "final";

/** One step still to start. */
export interface StartStep {
  readonly line: IndustryLine;
  /** Every input held or already being made. */
  readonly canStart: boolean;
}

export interface StartGroup {
  readonly stage: StartStage;
  readonly label: string;
  readonly steps: readonly StartStep[];
}

const STAGE_LABEL: Readonly<Record<StartStage, string>> = {
  reactions: "Reactions",
  components: "Components",
  final: "Final",
};

/**
 * The steps that still have runs to start, deepest first within each stage,
 * stages in the order a build is worked. Bought items are the Missing list's.
 */
export function startNext(chain: IndustryChain): StartGroup[] {
  const groups = new Map<StartStage, StartStep[]>([["reactions", []], ["components", []], ["final", []]]);
  const rootTypeID = chain.root.typeID;
  for (const typeID of [...chain.order].reverse()) {
    const line = chain.lines.get(typeID);
    if (!line || line.obtain === "buy" || line.runs <= 0) continue;
    let canStart = true;
    for (const materialTypeID of line.materials.keys()) {
      const input = chain.lines.get(materialTypeID);
      if (input && input.short > 0) {
        canStart = false;
        break;
      }
    }
    const stage: StartStage = typeID === rootTypeID ? "final" : line.obtain === "react" ? "reactions" : "components";
    groups.get(stage)?.push({ line, canStart });
  }
  return (["reactions", "components", "final"] as const)
    .map((stage) => ({ stage, label: STAGE_LABEL[stage], steps: groups.get(stage) ?? [] }))
    .filter((group) => group.steps.length > 0);
}

// ---------------------------------------------------------------------------
// WHERE A JOB CAN START — the server's rules, checked before the button shows.
//
// From server/src/services/industry/ (industryRuntimeState.js validation and
// industryRestrictions.js resolveIndustryFacilityDistanceRestriction):
//   1. the blueprint sits in an industry facility, and the job runs in that
//      facility only (INVALID_BLUEPRINT_LOCATION, BLUEPRINT_WRONG_FACILITY);
//   2. the facility is no more stargate jumps from the pilot's current system
//      than 5 per level of the activity's range skill (FACILITY_DISTANCE);
//   3. the materials are in the job's input hangar there (MISSING_MATERIAL).
// A copy picked without these was refused live (2026-10-01). The facility must
// also be one the pilot's own industry read offers: that list is what the
// Industry panel lets the player pick from.

/** Jumps of remote reach per level of the range skill (server FACILITY_RANGE_BY_SKILL_LEVEL). */
export const RANGE_JUMPS_PER_LEVEL = 5;
/** The range skill per activity (server INDUSTRY_DISTANCE_SKILL_BY_ACTIVITY). */
export const RANGE_SKILL_BY_ACTIVITY: Readonly<Record<"manufacturing" | "reaction", number>> = {
  manufacturing: 24268, // Supply Chain Management
  reaction: 45750, // Remote Reactions
};

/** What the check needs to know about one online pilot. */
export interface InstallPilot {
  readonly characterName: string;
  /** The system it is in now, and the station or structure it is docked in. */
  readonly solarSystemID: number | null;
  readonly dockedAt: number | null;
  /** Trained level per skill type; null when its skills have not been read. */
  readonly skills: ReadonlyMap<number, number> | null;
  /** Facility -> its system, from the pilot's own industry read. */
  readonly facilities: ReadonlyMap<number, number>;
  /** Its own stacks with where they sit, from the stock read; null when unread. */
  readonly stock: readonly PilotStockStack[] | null;
}

export type InstallBlock =
  | "no-copy"
  | "not-in-facility"
  | "facility-not-offered"
  | "skills-unknown"
  | "out-of-range"
  | "materials-elsewhere";

export type InstallCheck =
  | { readonly ok: true; readonly from: OwnedBlueprint }
  | {
      readonly ok: false;
      readonly block: InstallBlock;
      /** The copy that got furthest, and the numbers that stopped it. */
      readonly from: OwnedBlueprint | null;
      readonly jumps: number | null;
      readonly range: number | null;
    };

const STAGE: Readonly<Record<InstallBlock, number>> = {
  "no-copy": 0,
  "not-in-facility": 1,
  "facility-not-offered": 2,
  "skills-unknown": 3,
  "out-of-range": 4,
  "materials-elsewhere": 5,
};

/**
 * Whether `line` can be started now, and from which copy. `jumpsBetween` is
 * the fewest stargate jumps between two systems, or null when unknown.
 * Copies are tried where their pilot is docked first, then best first (`owned`
 * is already best-first, bridge/industryOwned.ts). When none passes, the copy
 * that got furthest says why.
 */
export function installCheck(
  line: IndustryLine,
  owned: readonly OwnedBlueprint[],
  pilots: ReadonlyMap<number, InstallPilot>,
  jumpsBetween: (fromSystemID: number, toSystemID: number) => number | null,
): InstallCheck {
  const blueprintTypeID = line.blueprint?.blueprintTypeID ?? null;
  const activity = line.obtain === "react" ? "reaction" : "manufacturing";
  const candidates = blueprintTypeID === null
    ? []
    : owned.filter((blueprint) => blueprint.blueprintTypeID === blueprintTypeID && !blueprint.busy && pilots.has(blueprint.characterID));
  candidates.sort((a, b) =>
    Number(b.facilityID !== null && b.facilityID === pilots.get(b.characterID)?.dockedAt) -
    Number(a.facilityID !== null && a.facilityID === pilots.get(a.characterID)?.dockedAt));

  let furthest: Extract<InstallCheck, { ok: false }> = { ok: false, block: "no-copy", from: null, jumps: null, range: null };
  const note = (block: InstallBlock, from: OwnedBlueprint, jumps: number | null = null, range: number | null = null): void => {
    if (STAGE[block] > STAGE[furthest.block]) furthest = { ok: false, block, from, jumps, range };
  };

  for (const copy of candidates) {
    const pilot = pilots.get(copy.characterID) as InstallPilot;
    if (copy.facilityID === null) {
      note("not-in-facility", copy);
      continue;
    }
    const facilitySystem = pilot.facilities.get(copy.facilityID);
    if (facilitySystem === undefined) {
      note("facility-not-offered", copy);
      continue;
    }
    if (pilot.skills === null || pilot.solarSystemID === null) {
      note("skills-unknown", copy);
      continue;
    }
    const range = RANGE_JUMPS_PER_LEVEL * Math.min(Math.max(pilot.skills.get(RANGE_SKILL_BY_ACTIVITY[activity]) ?? 0, 0), 5);
    const jumps = jumpsBetween(pilot.solarSystemID, facilitySystem);
    if (jumps === null || jumps > range) {
      note("out-of-range", copy, jumps, range);
      continue;
    }
    if (pilot.stock !== null) {
      const here = new Map<number, number>();
      for (const stack of pilot.stock) {
        if (stack.holder === "hangar" && stack.locationID === copy.facilityID) {
          here.set(stack.typeID, (here.get(stack.typeID) ?? 0) + stack.quantity);
        }
      }
      const short = [...line.materials].some(([typeID, quantity]) => (here.get(typeID) ?? 0) < quantity);
      if (short) {
        note("materials-elsewhere", copy, jumps, range);
        continue;
      }
    }
    return { ok: true, from: copy };
  }
  return furthest;
}

/** Plain words for why a step cannot be set up yet. */
export function installBlockWords(check: Extract<InstallCheck, { ok: false }>): string {
  const who = check.from ? check.from.characterName : "Nobody online here";
  switch (check.block) {
    case "no-copy":
      return "Nobody online here holds an idle copy of its blueprint.";
    case "not-in-facility":
      return `${who}'s copy is not in a hangar where industry is offered.`;
    case "facility-not-offered":
      return `${who}'s copy is in a facility ${who} cannot start jobs in.`;
    case "skills-unknown":
      return `${who}'s skills have not been read yet.`;
    case "out-of-range":
      return check.jumps === null
        ? `${who}'s copy is in a facility no route reaches.`
        : `${who}'s copy is ${check.jumps} ${check.jumps === 1 ? "jump" : "jumps"} away; ${who} can start jobs ${check.range === 0 ? "only in the same system" : `up to ${check.range} jumps away`}.`;
    case "materials-elsewhere":
      return `The materials are not all in ${who}'s hangar where the blueprint is.`;
  }
}
