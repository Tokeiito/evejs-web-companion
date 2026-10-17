// An industry job reckoned by the page itself, as the client's own job reckons it before it sends the job to be
// previewed or installed (industry/job.py: the time 460 to 468, the materials 470 to 485, the cost 310 to 320, the
// tax 450 to 458, and what it costs to start 127 to 174), by the arithmetic the BFF's routes use too
// (industryReckonings.mjs, which says the order of each and why it matters): a manufacturing job, a copy job, a
// research of a blueprint's time or of its materials, an invention and a reaction. What each is reckoned from, and
// where the page has it:
//
//   the blueprint's recipe, the product's group and category,        the game's data, by the BFF's static reads
//   each required skill's time per level (1982), the blueprint
//   type's cost multiplier (1954), the facility's system's security
//   the blueprint's time and material research                       the blueprint, as the page read it
//   the pilot's level in effect of each required skill                skillHandler.GetSkills, as the client's skill
//   (a manufacturing job's alone)                                     service has it (industrySvc._UpdateSkills 224)
//   the pilot's own time for the work (219, 387, 385, 398, 1959,      its own dogma location (QueryAttributeValue),
//   2662: industryCommon.CHARACTER_MODIFIERS, 19 to 43)               which on the game port godma answers with
//                                                                     nothing asked of the server
//   the facility's row                                                facilityManager.GetFacilities: the region's,
//                                                                     as the client's facility service keeps them
//   each material's adjusted price                                    the cfg's price table, asked once by the
//                                                                     client two seconds after it loads; on the game
//                                                                     port the transport has it and answers the
//                                                                     page's asking from it, and through the gateway
//                                                                     there is none
//   the clone grade                                                   subscriptionMgr.GetCloneGrade, as the clone
//                                                                     grade service asks it (game port only)
//
// What differs by the work (as the routes have it, src/server.js JOB_RECKONINGS): a copy job is by the runs each copy
// is licensed for; a research job by the level the blueprint is at in that research, and nothing where the page
// read no research of that kind; an invention's base is the price of the blueprint it is to make, and its materials
// have the place of its decryptor, chosen or not; a reaction's cost, tax and fee are a manufacturing job's, its
// formula priced by its reaction's materials. Only a manufacturing job is of the blueprint's time and material
// research and of its required skills' times.
//
// ⚠ ALL OR NOTHING, as the routes' reckonings are: the server refuses a job whose time, cost or materials are not
// nought (or empty) and are not its own to the unit. Each figure is null where an input was not had, and nought goes
// for it then, which the server works out by itself.
//
// A facility with rig modifiers is asked for afresh, as the client's job asks it (facilitySvc.GetFreshFacility).
//
// The most runs a job can have is said beside the job's figures (mostRuns), for the window to hold its runs to.

import type { Ask } from "./ask.ts";
import { effectiveSkillLevel } from "./skillSheet.ts";
import type { JsonValue } from "./wire.ts";
import {
  SERVICE_LABORATORY_COPYING,
  SERVICE_LABORATORY_INVENTION,
  blueprintPrice,
  copyingJobCost,
  copyingJobFee,
  copyingJobMaterials,
  copyingJobMostRuns,
  copyingJobSeconds,
  copyingJobTax,
  facilityCharges,
  facilityCostModifiers,
  facilityGlobalModifiers,
  facilityMaterialModifiers,
  facilityTaxRate,
  facilityTimeModifiers,
  findFacilityRow,
  inventionJobCost,
  inventionJobFee,
  inventionJobMaterials,
  inventionJobMostRuns,
  inventionJobSeconds,
  inventionJobTax,
  inventionProductTypeID,
  manufacturingJobCost,
  manufacturingJobFee,
  manufacturingJobMaterials,
  manufacturingJobSeconds,
  manufacturingJobTax,
  manufacturingServiceID,
  reactionJobMaterials,
  reactionJobSeconds,
  reactionServiceID,
  researchJobCost,
  researchJobFee,
  researchJobMaterials,
  researchJobMostRuns,
  researchJobSeconds,
  researchJobTax,
  researchServiceID,
  researchStanding,
  type FacilityModifier,
  type JobFee,
  type MaterialsTaken,
  type ProductType,
  type RecipeMaterial,
  type ResearchStanding,
} from "./industryReckonings.mjs";

/** const.attributeManufactureTimePerLevel: what a skill a blueprint requires takes off a manufacturing job's time, a level. */
const ATTRIBUTE_MANUFACTURE_TIME_PER_LEVEL = 1982;
/** const.attributeJobCostMultiplier: a blueprint type's own multiplier of what a job with it costs. */
const ATTRIBUTE_JOB_COST_MULTIPLIER = 1954;

/** The kinds of work, by the name the page and the game's data give each. */
export type JobActivity = "manufacturing" | "copying" | "research_time" | "research_material" | "invention" | "reaction";

/** A job's base, beside the blueprint's price: its runs, a copy's licensed runs, and a research's time and level. */
interface Basis {
  readonly runs: number;
  readonly licensedRuns: number;
  readonly activityTime?: number;
  readonly level?: number;
}

/** What each kind of work is reckoned by: its number, and the pilot's own time for it (an attribute of the character's). */
const KINDS: Readonly<Record<JobActivity, { readonly activityID: number; readonly timeAttribute: number }>> = Object.freeze({
  manufacturing: { activityID: 1, timeAttribute: 219 },
  research_time: { activityID: 3, timeAttribute: 385 },
  research_material: { activityID: 4, timeAttribute: 398 },
  copying: { activityID: 5, timeAttribute: 387 },
  invention: { activityID: 8, timeAttribute: 1959 },
  reaction: { activityID: 9, timeAttribute: 2662 },
});
type Kind = (typeof KINDS)[JobActivity];

/** A kind of work's activity number, as a job's dump names it. */
export const activityIDOf = (activity: JobActivity): number => KINDS[activity].activityID;

/** A job's cost through its modifiers, by its kind (a reaction's is a manufacturing job's: activities/reaction.py 16). */
function costOf(activity: JobActivity, job: Basis & { readonly blueprintPrice: number }, modifiers: {
  readonly blueprintAmount: number | null; readonly alpha: boolean; readonly faction: number | null; readonly system: number | null;
  readonly facilityModifiers: readonly FacilityModifier[]; readonly productType: ProductType | null;
}): number | null {
  switch (activity) {
    case "copying": return copyingJobCost({ ...job, ...modifiers });
    case "research_time": case "research_material": return researchJobCost({ ...job, activityTime: job.activityTime, level: job.level, ...modifiers });
    case "invention": return inventionJobCost({ ...job, ...modifiers });
    default: return manufacturingJobCost({ ...job, ...modifiers });
  }
}

/** A job's tax of its base, by its kind. */
function taxOf(activity: JobActivity, job: Basis & { readonly blueprintPrice: number }, facilityTax: number | null): number | null {
  switch (activity) {
    case "copying": return copyingJobTax({ ...job, facilityTax });
    case "research_time": case "research_material": return researchJobTax({ ...job, activityTime: job.activityTime, level: job.level, facilityTax });
    case "invention": return inventionJobTax({ ...job, facilityTax });
    default: return manufacturingJobTax({ ...job, facilityTax });
  }
}

/** What a job costs to start, by its kind (a research job's SCC surcharge halved). */
function feeOf(activity: JobActivity, job: Basis & { readonly blueprintPrice: number }, charges: {
  readonly cost: number | null; readonly tax: number | null; readonly sccTaxModifier: number | null; readonly security: number | null;
}): JobFee | null {
  switch (activity) {
    case "copying": return copyingJobFee({ ...job, ...charges });
    case "research_time": case "research_material": return researchJobFee({ ...job, activityTime: job.activityTime, level: job.level, ...charges });
    case "invention": return inventionJobFee({ ...job, ...charges });
    default: return manufacturingJobFee({ ...job, ...charges });
  }
}

/** A blueprint's industry, as the game's data has it (the BFF's static read of blueprints). */
interface Definition {
  readonly productTypeID?: unknown;
  readonly maxProductionLimit?: unknown;
  readonly activities?: Readonly<Record<string, Activity | undefined>>;
}
interface Activity {
  readonly time?: unknown;
  readonly materials?: readonly RecipeMaterial[];
  readonly skills?: readonly { readonly typeID?: unknown }[];
  readonly products?: readonly { readonly typeID?: unknown }[];
}

/** What the page reckons a job by: the server's, through the page's own calls, and the game's data, by the BFF's static reads. */
export interface JobReckoningReads {
  /** The page's own read of the server's (bridgeAsk). */
  readonly ask: Ask;
  readonly characterID: number;
  /** Blueprints' industry by type, null for a type that is no blueprint (api.loadIndustryDefinitions). */
  definitions(typeIDs: readonly number[]): Promise<Readonly<Record<string, JsonValue>>>;
  /** A type's group and category, or null for a type the data has not. */
  typeFacts(typeID: number): Promise<ProductType | null>;
  /** Types' attributes by type and attribute, an attribute a type has not left out (api.fetchTypeDogma). */
  typeAttributes(typeIDs: readonly number[], attributeIDs: readonly number[]): Promise<Readonly<Record<number, Readonly<Record<number, number>>>>>;
  /** Systems' security by ID, null for an ID that is no system's (api.loadSystemSecurity). */
  security(systemIDs: readonly number[]): Promise<Readonly<Record<number, number | null>>>;
}

/** The job as the window has it. */
export interface IndustryJob {
  readonly activity: JobActivity;
  readonly blueprintTypeID: number;
  readonly facilityID: number;
  readonly runs: number;
  /** A copy job's runs each copy is licensed for, where the pilot said them; the blueprint's most otherwise. */
  readonly licensedRuns?: number;
  /** An invention's blueprint to make, where its recipe has more than one. */
  readonly productTypeID?: number;
  /** An invention's decryptor, nought or none for none. */
  readonly decryptorTypeID?: number;
  /** The blueprint's own time research; null where it was not read. */
  readonly timeEfficiency: number | null;
  /** And its material research. */
  readonly materialEfficiency: number | null;
}

/** What the page reckons of a job: each null where it could not be reckoned whole. */
export interface JobReckoning {
  readonly timeSeconds: number | null;
  readonly materials: MaterialsTaken | null;
  readonly cost: number | null;
  readonly tax: number | null;
  readonly fee: JobFee | null;
  /** The runs each copy is licensed for, as the job goes with them (job.py 639); null where the job has no recipe. */
  readonly licensedRuns: number | null;
  /**
   * The most runs the job can have, as the client's job holds its runs to it (job.py 395; activity.py job_max_runs):
   * a copy job's, a research's and an invention's, where its time was reckoned; null for any other, or where it
   * could not be reckoned.
   */
  readonly mostRuns: number | null;
}

const NONE: JobReckoning = Object.freeze({ timeSeconds: null, materials: null, cost: null, tax: null, fee: null, licensedRuns: null, mostRuns: null });

/** A read that fails is none; a lost session is not, and fails the reckoning. */
async function orNone<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (reason) {
    const code = reason !== null && typeof reason === "object" ? (reason as { code?: unknown }).code : undefined;
    if (code === "SESSION_NOT_FOUND") throw reason;
    return null;
  }
}

/**
 * Whether a facility's row lists rig modifiers (facilitySvc.GetFreshFacility, 109: `rigModifiers`), which the
 * client's job then asks for afresh.
 */
function hasRigModifiers(row: unknown): boolean {
  const args = row !== null && typeof row === "object" ? (row as { args?: { entries?: unknown } }).args : undefined;
  const entries = args && Array.isArray(args.entries) ? (args.entries as unknown[]) : [];
  const field = entries.find((each) => Array.isArray(each) && each[0] === "rigModifiers") as unknown[] | undefined;
  const rigs = field ? (field[1] as { items?: unknown; entries?: unknown } | null) : null;
  return Boolean(rigs) && ((Array.isArray(rigs?.items) && rigs.items.length > 0) || (Array.isArray(rigs?.entries) && rigs.entries.length > 0));
}

const positive = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

/** The adjusted price of each type, by type, out of config.GetAverageMarketPrices as answered; null for no table. */
export function adjustedPrices(answered: JsonValue | null): ReadonlyMap<number, number | null> | null {
  return pricesOf(answered, "adjustedPrice");
}

/**
 * The average price of each type, by type, out of config.GetAverageMarketPrices as answered (the cfg's table:
 * typeHelpers.GetAveragePrice reads its averagePrice); null for no table.
 */
export function averagePrices(answered: JsonValue | null): ReadonlyMap<number, number | null> | null {
  return pricesOf(answered, "averagePrice");
}

function pricesOf(answered: JsonValue | null, field: "adjustedPrice" | "averagePrice"): ReadonlyMap<number, number | null> | null {
  if (answered === null || typeof answered !== "object" || Array.isArray(answered)) return null;
  const dict = answered as { type?: unknown; entries?: unknown };
  if (dict.type !== "dict" || !Array.isArray(dict.entries)) return null;
  const prices = new Map<number, number | null>();
  for (const pair of dict.entries as unknown[]) {
    if (!Array.isArray(pair)) continue;
    const typeID = positive(pair[0]);
    const row = pair[1] as { args?: { entries?: unknown } } | null;
    const fields = row && row.args && Array.isArray(row.args.entries) ? (row.args.entries as unknown[]) : [];
    const found = fields.find((each) => Array.isArray(each) && each[0] === field) as unknown[] | undefined;
    if (typeID !== null) prices.set(typeID, found && typeof found[1] === "number" && Number.isFinite(found[1]) ? found[1] : null);
  }
  return prices;
}

/**
 * The page's reckoner of jobs, which keeps what the client's services keep for the session: the region's
 * facilities (facilitySvc._PrimeFacilities, 128), the price table and the clone grade. Each asked once; one that
 * could not be had is asked again next time.
 */
export function createJobReckoner(reads: JobReckoningReads) {
  let facilities: JsonValue | null = null;
  let prices: ReadonlyMap<number, number | null> | null = null;
  let grade: number | null = null;
  const definitionsKept = new Map<number, Definition | null>();

  const kept = {
    /**
     * A job's facility, as the client's job is given one (industrySvc.CreateJob, 109: facilitySvc.GetFreshFacility):
     * its row among the region's, as they are kept, asked for again once where the facility is not among them (as
     * after a move to another region, where the client's service has another region's); and one whose row lists rig
     * modifiers asked for afresh by itself (facilityManager.GetFacility), as the client asks it. Null where none is had.
     */
    async facility(facilityID: number): Promise<unknown> {
      let row = facilities === null ? null : findFacilityRow(facilities, facilityID);
      if (!row) {
        facilities = await orNone(() => reads.ask("facilityManager", "GetFacilities", []));
        row = facilities === null ? null : findFacilityRow(facilities, facilityID);
      }
      if (!row || !hasRigModifiers(row)) return row;
      const fresh = await orNone(() => reads.ask("facilityManager", "GetFacility", [facilityID]));
      return fresh !== null && typeof fresh === "object" && !Array.isArray(fresh) ? fresh : null;
    },
    async prices(): Promise<ReadonlyMap<number, number | null> | null> {
      prices ??= adjustedPrices(await orNone(() => reads.ask("config", "GetAverageMarketPrices", [])));
      return prices;
    },
    async grade(): Promise<number | null> {
      if (grade === null) {
        const answered = await orNone(() => reads.ask("subscriptionMgr", "GetCloneGrade", []));
        grade = answered === 0 || answered === 1 ? answered : null;
      }
      return grade;
    },
  };

  /**
   * Blueprints' industry, asked of the game's data where it is not kept, and that of every blueprint among the
   * materials of `work` in turn: a blueprint is priced by those (industryCommon.GetBlueprintPrice, 520 to 543).
   */
  async function definitionsOf(typeIDs: readonly number[], work: string): Promise<void> {
    let asking = typeIDs.filter((typeID) => !definitionsKept.has(typeID));
    while (asking.length > 0) {
      const answered = await reads.definitions(asking);
      const next: number[] = [];
      for (const typeID of asking) {
        const definition = answered[String(typeID)];
        const had = definition !== null && typeof definition === "object" && !Array.isArray(definition) ? (definition as Definition) : null;
        definitionsKept.set(typeID, had);
        for (const material of had?.activities?.[work]?.materials ?? []) {
          const materialType = positive(material.typeID);
          if (materialType !== null && !definitionsKept.has(materialType) && !next.includes(materialType)) next.push(materialType);
        }
      }
      asking = next;
    }
  }

  /** A job, reckoned. */
  async function reckon(job: IndustryJob): Promise<JobReckoning> {
    const kind = KINDS[job.activity];
    if (!kind) return NONE;
    const manufacturing = job.activity === "manufacturing";
    const research = job.activity === "research_time" || job.activity === "research_material";
    await definitionsOf([job.blueprintTypeID], "manufacturing");
    const definition = definitionsKept.get(job.blueprintTypeID) ?? null;
    const activity = definition?.activities?.[job.activity] ?? null;
    if (!definition || !activity) return NONE;
    // Where the blueprint stands in the research the job is for, by the research of that kind the page read of it;
    // null for a research of which it read nothing, which has no job reckoned.
    const standing: ResearchStanding | null | undefined = research
      ? researchStanding(kind.activityID, job.activity === "research_time" ? job.timeEfficiency : job.materialEfficiency)
      : undefined;
    if (standing && standing.finished) return NONE;
    // The runs each copy is licensed for: a copy job's as the pilot said them, and the blueprint's most else.
    const most = positive(definition.maxProductionLimit) ?? 1;
    const licensedRuns = job.activity === "copying" && job.licensedRuns !== undefined ? job.licensedRuns : most;

    // The type a facility's modifiers are held to: the blueprint's product, or a formula's (industry/blueprint.py 62 to 72).
    const making = definition.activities?.manufacturing ?? definition.activities?.reaction ?? null;
    const productTypeID = positive(definition.productTypeID) ?? positive(making?.products?.[0]?.typeID);
    // The service a structure does the work by (activity.py 54 to 57): a manufacturing job's or a reaction's by the
    // group of the first thing made, and every other's its own.
    const madeBy = job.activity === "manufacturing" || job.activity === "reaction" ? positive(definition.activities?.[job.activity]?.products?.[0]?.typeID) : null;
    const [productType, madeType, facilityRow] = await Promise.all([
      productTypeID === null ? null : orNone(() => reads.typeFacts(productTypeID)),
      madeBy === null ? null : orNone(() => reads.typeFacts(madeBy)),
      kept.facility(job.facilityID),
    ]);
    const row = facilityRow || null;
    const decryptor = job.activity === "invention" && (job.decryptorTypeID ?? 0) > 0;
    if (!row && !decryptor) return NONE;

    const timed = row ? await reckonedTime(job, kind, activity, row, productType, standing, licensedRuns) : null;
    const timeSeconds = timed ? timed.seconds : null;
    const mostRuns = timed ? timed.mostRuns : null;
    const materials = manufacturing && job.materialEfficiency === null ? null : reckonedMaterials(job, kind, activity, row, productType, licensedRuns);
    if (!row || standing === null) return { timeSeconds, materials, cost: null, tax: null, fee: null, licensedRuns, mostRuns };

    // The cost, the tax and what it costs to start, off the price table: none of them without one.
    const table = await kept.prices();
    if (table === null) return { timeSeconds, materials, cost: null, tax: null, fee: null, licensedRuns, mostRuns };
    // The type the base is of (the invented blueprint for an invention), priced by the materials of the work it is
    // priced by (a reaction's own for a reaction, manufacturing's for any other).
    const pricedType = job.activity === "invention" ? inventionProductTypeID(activity, job.productTypeID ?? 0) : job.blueprintTypeID;
    const pricedWork = job.activity === "reaction" ? "reaction" : "manufacturing";
    if (!(pricedType > 0)) return { timeSeconds, materials, cost: null, tax: null, fee: null, licensedRuns, mostRuns };
    await definitionsOf([pricedType], pricedWork);
    const price = blueprintPrice(pricedType, {
      activity: pricedWork,
      activitiesOf: (typeID) => definitionsKept.get(typeID)?.activities ?? null,
      adjustedPriceOf: (typeID) => (table.has(typeID) ? table.get(typeID) ?? null : null),
    });
    if (price === null) return { timeSeconds, materials, cost: null, tax: null, fee: null, licensedRuns, mostRuns };
    const basis: Basis = {
      runs: job.runs,
      licensedRuns,
      ...(standing ? { activityTime: Number(activity.time), level: standing.level } : {}),
    };
    const [cloneGrade, multipliers] = await Promise.all([
      kept.grade(),
      orNone(() => reads.typeAttributes([job.blueprintTypeID], [ATTRIBUTE_JOB_COST_MULTIPLIER])),
    ]);
    const { faction, system } = facilityGlobalModifiers(row, kind.activityID);
    const multiplier = multipliers === null ? undefined : multipliers[job.blueprintTypeID]?.[ATTRIBUTE_JOB_COST_MULTIPLIER];
    const based = { blueprintPrice: price, ...basis };
    const cost = cloneGrade === null || multipliers === null ? null : costOf(job.activity, based, {
      blueprintAmount: multiplier === undefined ? null : multiplier,
      alpha: cloneGrade === 0,
      faction,
      system,
      facilityModifiers: facilityCostModifiers(row, kind.activityID),
      productType,
    });
    const tax = taxOf(job.activity, based, facilityTaxRate(row, serviceOf(job.activity, kind.activityID, madeType)));
    const charges = facilityCharges(row);
    const systemID = charges.solarSystemID;
    const securities = systemID === null ? null : await orNone(() => reads.security([systemID]));
    const security = securities === null || systemID === null ? null : securities[systemID] ?? null;
    const fee = feeOf(job.activity, based, { cost, tax, sccTaxModifier: charges.sccTaxModifier, security });
    return { timeSeconds, materials, cost, tax, fee, licensedRuns, mostRuns };
  }

  /** The service a structure would do the work by, as the client's activity asks for it (activity.py 54 to 57). */
  function serviceOf(activity: JobActivity, activityID: number, madeType: ProductType | null): number | null {
    if (activity === "copying") return SERVICE_LABORATORY_COPYING;
    if (activity === "invention") return SERVICE_LABORATORY_INVENTION;
    const researched = researchServiceID(activityID);
    if (researched !== null) return researched;
    const groupID = madeType ? positive(madeType.groupID) : null;
    return activity === "reaction" ? reactionServiceID(groupID) : manufacturingServiceID(groupID);
  }

  /** The job's time: of the pilot's own time for the work and the facility's, and a manufacturing job's skills and research. */
  async function reckonedTime(
    job: IndustryJob,
    kind: Kind,
    activity: Activity,
    row: unknown,
    productType: ProductType | null,
    standing: ResearchStanding | null | undefined,
    licensedRuns: number,
  ): Promise<{ readonly seconds: number | null; readonly mostRuns: number | null } | null> {
    const manufacturing = job.activity === "manufacturing";
    const activityTime = Number(activity.time);
    // (What each kind of work wants said of the blueprint: a manufacturing job its time research, a research where
    // the blueprint stands in it.)
    if ((manufacturing ? job.timeEfficiency === null : standing === null) || !(activityTime > 0)) return null;
    // (No other job has a skill's time per level: the client lists those for manufacturing alone.)
    const required = manufacturing
      ? (activity.skills ?? []).map((skill) => positive(skill.typeID)).filter((typeID): typeID is number => typeID !== null)
      : [];
    const none: Readonly<Record<number, Readonly<Record<number, number>>>> = {};
    const [perLevels, skills, character] = await Promise.all([
      required.length === 0 ? none : orNone(() => reads.typeAttributes(required, [ATTRIBUTE_MANUFACTURE_TIME_PER_LEVEL])),
      required.length === 0 ? null : orNone(() => reads.ask("skillHandler", "GetSkills", [])),
      orNone(() => reads.ask("dogmaIM", "QueryAttributeValue", [reads.characterID, kind.timeAttribute])),
    ]);
    if (perLevels === null || (required.length > 0 && skills === null) || typeof character !== "number") return null;
    const timedBy = {
      activityTime,
      characterAmount: character,
      facilityModifiers: facilityTimeModifiers(row, kind.activityID),
      productType,
    };
    switch (job.activity) {
      case "copying":
        return { seconds: copyingJobSeconds({ ...timedBy, runs: job.runs, licensedRuns }), mostRuns: copyingJobMostRuns(timedBy) };
      case "research_time":
      case "research_material":
        return standing
          ? { seconds: researchJobSeconds({ ...timedBy, level: standing.level, runs: job.runs }), mostRuns: researchJobMostRuns({ ...timedBy, runsLeft: standing.runsLeft }) }
          : null;
      case "invention":
        return { seconds: inventionJobSeconds({ ...timedBy, runs: job.runs }), mostRuns: inventionJobMostRuns(timedBy) };
      case "reaction":
        return { seconds: reactionJobSeconds({ ...timedBy, runs: job.runs }), mostRuns: null };
      default: {
        // (Only a skill that has a time per level is among the job's modifiers: industryCommon.GetJobModifiers, 485.)
        const timed = required.flatMap((typeID) => {
          const perLevel = perLevels[typeID]?.[ATTRIBUTE_MANUFACTURE_TIME_PER_LEVEL];
          return perLevel === undefined ? [] : [{ perLevel, level: effectiveSkillLevel(skills, typeID) }];
        });
        return { seconds: manufacturingJobSeconds({ ...timedBy, runs: job.runs, skills: timed, timeEfficiency: job.timeEfficiency }), mostRuns: null };
      }
    }
  }

  /** The job's materials, through the facility's material modifiers (none of a facility that is not had). */
  function reckonedMaterials(
    job: IndustryJob,
    kind: Kind,
    activity: Activity,
    row: unknown,
    productType: ProductType | null,
    licensedRuns: number,
  ): MaterialsTaken | null {
    const facilityModifiers: FacilityModifier[] = facilityMaterialModifiers(row, kind.activityID);
    const listed = { materials: Array.isArray(activity.materials) ? activity.materials : [], runs: job.runs, facilityModifiers, productType };
    switch (job.activity) {
      case "manufacturing":
        return manufacturingJobMaterials({ ...listed, materialEfficiency: job.materialEfficiency });
      case "copying":
        return copyingJobMaterials({ ...listed, licensedRuns });
      case "research_time":
      case "research_material":
        return researchJobMaterials(listed);
      case "invention":
        return inventionJobMaterials({ ...listed, decryptorTypeID: job.decryptorTypeID ?? 0 });
      case "reaction":
        return reactionJobMaterials(listed);
    }
  }

  /**
   * The region's facilities let go, as the client's facility service lets a facility go where a job at it was refused
   * (industrySvc.InstallJob, 142 to 143: facilitySvc.Reload): the next reckoning asks for them again.
   */
  function facilityReloaded(): void {
    facilities = null;
  }

  return { reckon, facilityReloaded };
}

export type JobReckoner = ReturnType<typeof createJobReckoner>;
