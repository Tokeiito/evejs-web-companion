// A manufacturing job reckoned by the page itself, as the client's own job reckons it before it sends the job to be
// previewed or installed (industry/job.py: the time 460 to 468, the materials 470 to 485, the cost 310 to 320, the
// tax 450 to 458, and what it costs to start 127 to 174), by the arithmetic the BFF's routes use too
// (industryReckonings.mjs, which says the order of each and why it matters). What each is reckoned from, and where
// the page has it:
//
//   the blueprint's recipe, the product's group and category,        the game's data, by the BFF's static reads
//   each required skill's time per level (1982), the blueprint
//   type's cost multiplier (1954), the facility's system's security
//   the blueprint's time and material research                       the blueprint, as the page read it
//   the pilot's level in effect of each required skill                skillHandler.GetSkills, as the client's skill
//                                                                     service has it (industrySvc._UpdateSkills 224)
//   the pilot's own manufacturing time (219)                          its own dogma location (QueryAttributeValue),
//                                                                     which on the game port godma answers with
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
// ⚠ ALL OR NOTHING, as the routes' reckonings are: the server refuses a job whose time, cost or materials are not
// nought (or empty) and are not its own to the unit. Each figure is null where an input was not had, and nought goes
// for it then, which the server works out by itself.
//
// NOT DONE: a facility with rig modifiers, which the client's job asks afresh (facilitySvc.GetFreshFacility); any
// other kind of work than manufacturing.

import type { Ask } from "./ask.ts";
import { effectiveSkillLevel } from "./skillSheet.ts";
import type { JsonValue } from "./wire.ts";
import {
  blueprintPrice,
  facilityCharges,
  facilityCostModifiers,
  facilityGlobalModifiers,
  facilityMaterialModifiers,
  facilityTaxRate,
  facilityTimeModifiers,
  findFacilityRow,
  manufacturingJobCost,
  manufacturingJobFee,
  manufacturingJobMaterials,
  manufacturingJobSeconds,
  manufacturingJobTax,
  manufacturingServiceID,
  type JobFee,
  type MaterialsTaken,
  type ProductType,
  type RecipeMaterial,
} from "./industryReckonings.mjs";

/** industry.ACTIVITY_MANUFACTURING: the facility's lists of modifiers are by the activity's number. */
const ACTIVITY_MANUFACTURING = 1;
/** const.attributeManufactureTimeMultiplier: the pilot's own manufacturing time. */
const ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER = 219;
/** const.attributeManufactureTimePerLevel: what a skill a blueprint requires takes off a manufacturing job's time, a level. */
const ATTRIBUTE_MANUFACTURE_TIME_PER_LEVEL = 1982;
/** const.attributeJobCostMultiplier: a blueprint type's own multiplier of what a job with it costs. */
const ATTRIBUTE_JOB_COST_MULTIPLIER = 1954;

/** A blueprint's industry, as the game's data has it (the BFF's static read of blueprints). */
interface Definition {
  readonly productTypeID?: unknown;
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
export interface ManufacturingJob {
  readonly blueprintTypeID: number;
  readonly facilityID: number;
  readonly runs: number;
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
}

const NONE: JobReckoning = Object.freeze({ timeSeconds: null, materials: null, cost: null, tax: null, fee: null });

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

const positive = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

/** The adjusted price of each type, by type, out of config.GetAverageMarketPrices as answered; null for no table. */
export function adjustedPrices(answered: JsonValue | null): ReadonlyMap<number, number | null> | null {
  if (answered === null || typeof answered !== "object" || Array.isArray(answered)) return null;
  const dict = answered as { type?: unknown; entries?: unknown };
  if (dict.type !== "dict" || !Array.isArray(dict.entries)) return null;
  const prices = new Map<number, number | null>();
  for (const pair of dict.entries as unknown[]) {
    if (!Array.isArray(pair)) continue;
    const typeID = positive(pair[0]);
    const row = pair[1] as { args?: { entries?: unknown } } | null;
    const fields = row && row.args && Array.isArray(row.args.entries) ? (row.args.entries as unknown[]) : [];
    const adjusted = fields.find((field) => Array.isArray(field) && field[0] === "adjustedPrice") as unknown[] | undefined;
    if (typeID !== null) prices.set(typeID, adjusted && typeof adjusted[1] === "number" && Number.isFinite(adjusted[1]) ? adjusted[1] : null);
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
    async facilities(): Promise<JsonValue | null> {
      facilities ??= await orNone(() => reads.ask("facilityManager", "GetFacilities", []));
      return facilities;
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

  /** Blueprints' industry, asked of the game's data where it is not kept, until every blueprint among materials is had. */
  async function definitionsOf(typeIDs: readonly number[]): Promise<void> {
    let asking = typeIDs.filter((typeID) => !definitionsKept.has(typeID));
    while (asking.length > 0) {
      const answered = await reads.definitions(asking);
      const next: number[] = [];
      for (const typeID of asking) {
        const definition = answered[String(typeID)];
        const had = definition !== null && typeof definition === "object" && !Array.isArray(definition) ? (definition as Definition) : null;
        definitionsKept.set(typeID, had);
        for (const material of had?.activities?.manufacturing?.materials ?? []) {
          const materialType = positive(material.typeID);
          if (materialType !== null && !definitionsKept.has(materialType) && !next.includes(materialType)) next.push(materialType);
        }
      }
      asking = next;
    }
  }

  /** A manufacturing job, reckoned. */
  async function manufacturing(job: ManufacturingJob): Promise<JobReckoning> {
    await definitionsOf([job.blueprintTypeID]);
    const definition = definitionsKept.get(job.blueprintTypeID) ?? null;
    const activity = definition?.activities?.manufacturing ?? null;
    if (!definition || !activity) return NONE;
    const productTypeID = positive(definition.productTypeID) ?? positive(activity.products?.[0]?.typeID);
    const firstMade = positive(activity.products?.[0]?.typeID);
    const [productType, madeType, facilityList] = await Promise.all([
      productTypeID === null ? null : orNone(() => reads.typeFacts(productTypeID)),
      firstMade === null ? null : orNone(() => reads.typeFacts(firstMade)),
      kept.facilities(),
    ]);
    const row = facilityList === null ? null : findFacilityRow(facilityList, job.facilityID);
    if (!row) return NONE;

    const timeSeconds = await reckonedTime(job, activity, row, productType);
    const materials = job.materialEfficiency === null ? null : manufacturingJobMaterials({
      materials: Array.isArray(activity.materials) ? activity.materials : [],
      runs: job.runs,
      materialEfficiency: job.materialEfficiency,
      facilityModifiers: facilityMaterialModifiers(row, ACTIVITY_MANUFACTURING),
      productType,
    });

    // The cost, the tax and what it costs to start, off the price table: none of them without one.
    const table = await kept.prices();
    if (table === null) return { timeSeconds, materials, cost: null, tax: null, fee: null };
    const price = blueprintPrice(job.blueprintTypeID, {
      activity: "manufacturing",
      activitiesOf: (typeID) => definitionsKept.get(typeID)?.activities ?? null,
      adjustedPriceOf: (typeID) => (table.has(typeID) ? table.get(typeID) ?? null : null),
    });
    if (price === null) return { timeSeconds, materials, cost: null, tax: null, fee: null };
    const [cloneGrade, multipliers] = await Promise.all([
      kept.grade(),
      orNone(() => reads.typeAttributes([job.blueprintTypeID], [ATTRIBUTE_JOB_COST_MULTIPLIER])),
    ]);
    const { faction, system } = facilityGlobalModifiers(row, ACTIVITY_MANUFACTURING);
    const multiplier = multipliers === null ? undefined : multipliers[job.blueprintTypeID]?.[ATTRIBUTE_JOB_COST_MULTIPLIER];
    const cost = cloneGrade === null || multipliers === null ? null : manufacturingJobCost({
      blueprintPrice: price,
      runs: job.runs,
      blueprintAmount: multiplier === undefined ? null : multiplier,
      alpha: cloneGrade === 0,
      faction,
      system,
      facilityModifiers: facilityCostModifiers(row, ACTIVITY_MANUFACTURING),
      productType,
    });
    // The service a structure would manufacture this by, by the group of the first thing made (activity.py 54 to 57).
    const serviceID = manufacturingServiceID(madeType ? positive(madeType.groupID) : null);
    const tax = manufacturingJobTax({ blueprintPrice: price, runs: job.runs, facilityTax: facilityTaxRate(row, serviceID) });
    const charges = facilityCharges(row);
    const securities = charges.solarSystemID === null ? null : await orNone(() => reads.security([charges.solarSystemID as number]));
    const security = securities === null || charges.solarSystemID === null ? null : securities[charges.solarSystemID] ?? null;
    const fee = manufacturingJobFee({ blueprintPrice: price, runs: job.runs, cost, tax, sccTaxModifier: charges.sccTaxModifier, security });
    return { timeSeconds, materials, cost, tax, fee };
  }

  /** The job's time: of its required skills that have a time per level, the pilot's own time, and the facility's. */
  async function reckonedTime(job: ManufacturingJob, activity: Activity, row: unknown, productType: ProductType | null): Promise<number | null> {
    const activityTime = Number(activity.time);
    if (job.timeEfficiency === null || !(activityTime > 0)) return null;
    const required = (activity.skills ?? []).map((skill) => positive(skill.typeID)).filter((typeID): typeID is number => typeID !== null);
    const none: Readonly<Record<number, Readonly<Record<number, number>>>> = {};
    const [perLevels, skills, character] = await Promise.all([
      required.length === 0 ? none : orNone(() => reads.typeAttributes(required, [ATTRIBUTE_MANUFACTURE_TIME_PER_LEVEL])),
      required.length === 0 ? null : orNone(() => reads.ask("skillHandler", "GetSkills", [])),
      orNone(() => reads.ask("dogmaIM", "QueryAttributeValue", [reads.characterID, ATTRIBUTE_MANUFACTURE_TIME_MULTIPLIER])),
    ]);
    if (perLevels === null || (required.length > 0 && skills === null) || typeof character !== "number") return null;
    // (Only a skill that has a time per level is among the job's modifiers: industryCommon.GetJobModifiers, 485.)
    const timed = required.flatMap((typeID) => {
      const perLevel = perLevels[typeID]?.[ATTRIBUTE_MANUFACTURE_TIME_PER_LEVEL];
      return perLevel === undefined ? [] : [{ perLevel, level: effectiveSkillLevel(skills, typeID) }];
    });
    return manufacturingJobSeconds({
      activityTime,
      runs: job.runs,
      skills: timed,
      characterAmount: character,
      timeEfficiency: job.timeEfficiency,
      facilityModifiers: facilityTimeModifiers(row, ACTIVITY_MANUFACTURING),
      productType,
    });
  }

  return { manufacturing };
}

export type JobReckoner = ReturnType<typeof createJobReckoner>;
