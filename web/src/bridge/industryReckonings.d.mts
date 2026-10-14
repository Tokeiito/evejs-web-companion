// The exports of industryReckonings.mjs, the job's reckonings the page and the BFF both use, as the page sees them.
// Each reckoning checks what it is given and answers null where an input is not what it should be, so what it takes
// is said here loosely (unknown) where the module itself is the judge of it.

export declare const COPYING_MAX_RUNS: number;
export declare const DECRYPTOR_GROUP_ID: number;
export declare const INVENTION_ACTIVITY_ID: number;
export declare const INVENTION_MAX_RUNS: number;
/** The name the empty place of an invention's optional material has in a job's materials. */
export declare const NO_OPTIONAL_MATERIAL: string;
export declare const SERVICE_LABORATORY_COPYING: number;
export declare const SERVICE_LABORATORY_INVENTION: number;

/** A facility's modifier, as a GetFacilities row has it: [value, categoryID, groupID, typeID, reference]. */
export type FacilityModifier = readonly unknown[];

/** The type a facility's modifier is held to: the blueprint's product, by its type, group and category. */
export interface ProductType {
  readonly typeID?: unknown;
  readonly groupID?: unknown;
  readonly categoryID?: unknown;
}

/** One material of a recipe, as the game's data lists it. */
export interface RecipeMaterial {
  readonly typeID: unknown;
  readonly quantity: unknown;
}

/** What a job takes of each material, by type (and an invention's empty optional place, NO_OPTIONAL_MATERIAL). */
export type MaterialsTaken = Record<string, number>;

/** What a job costs to start, each part a whole amount, and their total. */
export interface JobFee {
  readonly cost: number;
  readonly tax: number;
  readonly sccSurcharge: number;
  readonly securityTax: number;
  readonly total: number;
}

/** Where a blueprint stands in a research. */
export interface ResearchStanding {
  readonly level: number;
  readonly runsLeft: number;
  readonly finished: boolean;
}

/** What a job's time is reckoned through, beside its own inputs. */
interface Timed {
  readonly activityTime: unknown;
  readonly characterAmount: unknown;
  readonly facilityModifiers: readonly FacilityModifier[] | null | undefined;
  readonly productType: ProductType | null | undefined;
}

/** What a job's materials are reckoned through, beside its own inputs. */
interface Listed {
  readonly materials: unknown;
  readonly runs: unknown;
  readonly facilityModifiers: readonly FacilityModifier[] | null | undefined;
  readonly productType: ProductType | null | undefined;
}

/** A job's base: the price of the blueprint it is of, and its runs. */
interface Based {
  readonly blueprintPrice: unknown;
  readonly runs: unknown;
}

/** A research job's base, beside the price and the runs. */
interface Researched {
  readonly activityTime: unknown;
  readonly level: unknown;
}

/** What a job's fee is reckoned of, beside its base. */
interface Charges {
  readonly cost: unknown;
  readonly tax: unknown;
  readonly sccTaxModifier: unknown;
  readonly security: unknown;
}

/** What a job's cost is reckoned through, beside its base. */
interface CostModifiers {
  readonly blueprintAmount: unknown;
  readonly alpha: unknown;
  readonly faction: unknown;
  readonly system: unknown;
  readonly facilityModifiers: readonly FacilityModifier[] | null | undefined;
  readonly productType: ProductType | null | undefined;
}

/** How a blueprint is priced: the work whose materials price it, a type's activities, and a type's adjusted price. */
export interface PriceLookups {
  readonly activity?: string;
  activitiesOf(typeID: number): Readonly<Record<string, { readonly materials?: readonly RecipeMaterial[] } | undefined>> | null;
  /** Null where the price table has not the type; undefined where there is no table. */
  adjustedPriceOf(typeID: number): number | null | undefined;
}

export declare function blueprintPrice(typeID: number, lookups: PriceLookups, within?: Set<number>): number | null;

export declare function facilityMaterialModifiers(facilityRow: unknown, activityID: number): FacilityModifier[];
export declare function facilityTimeModifiers(facilityRow: unknown, activityID: number): FacilityModifier[];
export declare function facilityCostModifiers(facilityRow: unknown, activityID: number): FacilityModifier[];
export declare function facilityGlobalModifiers(facilityRow: unknown, activityID: number): { readonly faction: number | null; readonly system: number | null };
export declare function facilityCharges(facilityRow: unknown): { readonly sccTaxModifier: number | null; readonly solarSystemID: number | null };
export declare function facilityTaxRate(facilityRow: unknown, serviceID: unknown): number | null;
/** The row of a GetFacilities answer for the facility, or null. */
export declare function findFacilityRow(facilities: unknown, facilityID: number): unknown;
export declare function modifierMatchesProduct(modifier: FacilityModifier, productType: ProductType | null | undefined): boolean;

export declare function manufacturingServiceID(productGroupID: unknown): number | null;
export declare function reactionServiceID(productGroupID: unknown): number | null;
export declare function researchServiceID(activityID: unknown): number | null;
export declare function researchStanding(activityID: unknown, efficiency: unknown): ResearchStanding | null;
export declare function inventionProductTypeID(invention: { readonly products?: readonly { readonly typeID?: unknown }[] } | null | undefined, requested: number): number;
export declare function roundToTwoPlaces(value: number): number;

export declare function manufacturingJobSeconds(job: Timed & {
  readonly runs: unknown;
  readonly skills: readonly { readonly perLevel: unknown; readonly level: unknown }[] | null | undefined;
  readonly timeEfficiency: unknown;
}): number | null;
export declare function copyingJobSeconds(job: Timed & { readonly runs: unknown; readonly licensedRuns: unknown }): number | null;
export declare function researchJobSeconds(job: Timed & { readonly level: unknown; readonly runs: unknown }): number | null;
export declare function inventionJobSeconds(job: Timed & { readonly runs: unknown }): number | null;
export declare function reactionJobSeconds(job: Timed & { readonly runs: unknown }): number | null;

export declare function copyingJobMostRuns(job: Timed): number | null;
export declare function researchJobMostRuns(job: Timed & { readonly runsLeft: unknown }): number | null;
export declare function inventionJobMostRuns(job: Timed): number | null;

export declare function manufacturingJobMaterials(job: Listed & { readonly materialEfficiency: unknown }): MaterialsTaken | null;
export declare function copyingJobMaterials(job: Listed & { readonly licensedRuns: unknown }): MaterialsTaken | null;
export declare function researchJobMaterials(job: Listed): MaterialsTaken | null;
export declare function inventionJobMaterials(job: Listed & { readonly decryptorTypeID?: unknown }): MaterialsTaken | null;
export declare function reactionJobMaterials(job: Listed): MaterialsTaken | null;

export declare function manufacturingJobTax(job: Based & { readonly facilityTax: unknown }): number | null;
export declare function copyingJobTax(job: Based & { readonly licensedRuns: unknown; readonly facilityTax: unknown }): number | null;
export declare function researchJobTax(job: Based & Researched & { readonly facilityTax: unknown }): number | null;
export declare function inventionJobTax(job: Based & { readonly facilityTax: unknown }): number | null;

export declare function manufacturingJobFee(job: Based & Charges): JobFee | null;
export declare function copyingJobFee(job: Based & Charges & { readonly licensedRuns: unknown }): JobFee | null;
export declare function researchJobFee(job: Based & Researched & Charges): JobFee | null;
export declare function inventionJobFee(job: Based & Charges): JobFee | null;

export declare function manufacturingJobCost(job: Based & CostModifiers): number | null;
export declare function copyingJobCost(job: Based & CostModifiers & { readonly licensedRuns: unknown }): number | null;
export declare function researchJobCost(job: Based & Researched & CostModifiers): number | null;
export declare function inventionJobCost(job: Based & CostModifiers): number | null;
