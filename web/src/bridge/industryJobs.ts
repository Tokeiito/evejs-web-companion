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

/**
 * The owned blueprint a step should be installed from, among pilots online
 * here (`dockedAt`: characterID -> the station or structure it is docked in).
 *
 * The server installs a job only from a blueprint that sits in an industry
 * facility, and only in that facility (INVALID_BLUEPRINT_LOCATION,
 * BLUEPRINT_WRONG_FACILITY; server industryRuntimeState.js). So only an idle
 * copy in a facility will do, one in the facility its pilot is docked at
 * first, and then the best one. `owned` is already best-first within a type
 * (bridge/industryOwned.ts). Picked by efficiency alone, the handoff once chose
 * a copy that sat in no facility, and the install was refused (seen live).
 */
export function installFrom(
  line: IndustryLine,
  owned: readonly OwnedBlueprint[],
  dockedAt: ReadonlyMap<number, number | null>,
): OwnedBlueprint | null {
  const blueprintTypeID = line.blueprint?.blueprintTypeID ?? null;
  if (blueprintTypeID === null) return null;
  const usable = owned.filter((blueprint) =>
    blueprint.blueprintTypeID === blueprintTypeID &&
    !blueprint.busy &&
    blueprint.facilityID !== null &&
    dockedAt.has(blueprint.characterID));
  return usable.find((blueprint) => blueprint.facilityID === dockedAt.get(blueprint.characterID)) ?? usable[0] ?? null;
}
