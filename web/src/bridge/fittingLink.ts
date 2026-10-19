// A fitting as the client writes it into a link and reads it back (shipfitting/client/link.py: the fitting: scheme;
// eve/client/script/environment/fittingSvc.py GetStringForFitting, 768 to 815, and GetFittingFromString, 817 to 884).
//
// The string is the hull's type, then "typeID;qty" for each kind of thing, the hold's modules marked "typeID_;qty",
// all joined by ":" and ended by "::". A string that does not end so was cut short (a link truncated to fit a text,
// eveEditPlainText's ConfirmTruncateLink): its last, partial part is dropped and the fitting is shown marked truncated.

import { intDictOrder } from "./py27DictOrder.ts";
import { TYPE_LIST_FILAMENTS, TYPE_LIST_OTHER_CARGO_HOLD_TYPES } from "./fittingContents.ts";

/** shipfitting/client/link.py SCHEME, and fittingSvc.py CARGO_MARKER. */
export const FITTING_SCHEME = "fitting";
const CARGO_MARKER = "_";

/** dogma/const.py: the slot effects (godma.GetPowerEffectForType's list, in its order). */
const EFFECT_HI_POWER = 12;
const EFFECT_MED_POWER = 13;
const EFFECT_LO_POWER = 11;
const EFFECT_RIG_SLOT = 2663;
const EFFECT_SUBSYSTEM = 3772;
const EFFECT_SERVICE_SLOT = 6306;
const POWER_EFFECTS: readonly number[] = [EFFECT_HI_POWER, EFFECT_MED_POWER, EFFECT_LO_POWER, EFFECT_RIG_SLOT, EFFECT_SUBSYSTEM, EFFECT_SERVICE_SLOT];

/** inventorycommon/const.py: each slot kind's first flag, the bays and the hold; the categories and the ice products. */
const FIRST_FLAG_BY_EFFECT: Readonly<Record<number, number>> = {
  [EFFECT_HI_POWER]: 27,
  [EFFECT_MED_POWER]: 19,
  [EFFECT_LO_POWER]: 11,
  [EFFECT_RIG_SLOT]: 92,
  [EFFECT_SUBSYSTEM]: 125,
  [EFFECT_SERVICE_SLOT]: 164,
};
const FLAG_CARGO = 5;
const FLAG_DRONE_BAY = 87;
const FLAG_FIGHTER_BAY = 158;
const CATEGORY_MODULE = 7;
const CATEGORY_CHARGE = 8;
const CATEGORY_DRONE = 18;
const CATEGORY_IMPLANT = 20;
const CATEGORY_SUBSYSTEM = 32;
const CATEGORY_STRUCTURE_MODULE = 66;
const CATEGORY_FIGHTER = 87;
const GROUP_ICE_PRODUCT = 423;

/** What the reading and the writing go by of a type; null for a type the client's data does not have. */
export interface FittingLinkTypeFacts {
  /** dogma.data.get_type_effects: its effects, in their order. */
  readonly effects: readonly number[];
  readonly groupID: number | null;
  readonly categoryID: number | null;
  /** Of the two type lists (filaments, other things the hold takes), those the type is on. */
  readonly lists: ReadonlySet<number>;
}

/** A fitting's hull and its items, each its type, flag and how many (fitData). */
export interface LinkedFitting {
  readonly shipTypeID: number;
  readonly fitData: readonly (readonly [number, number, number])[];
}

/**
 * Where the client's own reading raises (an unpacking of a part with more than one ";", a type its data does not have,
 * no hull at all, a slot count that leaves its loop variable unset): the link is then not followed, as the client's
 * handler ends in the error.
 */
export class FittingLinkError extends Error {}

/** parse_fitting_url: what follows the scheme's ":". */
export function parseFittingUrl(url: string): string {
  const at = url.indexOf(":");
  if (at < 0) throw new FittingLinkError("not a fitting link");
  return url.slice(at + 1);
}

/** format_fitting_url: the scheme and GetStringForFitting. */
export function formatFittingUrl(fitting: LinkedFitting, facts: (typeID: number) => FittingLinkTypeFacts | null): string {
  return `${FITTING_SCHEME}:${stringForFitting(fitting, facts)}`;
}

/** Python 2's int() of a str: spaces about it, a sign, the digits; null where it raises ValueError. */
function pyInt(text: string): number | null {
  if (!/^[ \t\n\v\f\r]*[+-]?[0-9]+[ \t\n\v\f\r]*$/.test(text)) return null;
  const value = Number(text.trim());
  return Number.isSafeInteger(value) ? value : null;
}

/** The type ids a fitting string names, to read their facts before it is read. */
export function typeIDsInFittingString(fittingString: string): number[] {
  const ids = new Set<number>();
  for (const line of fittingString.split(":")) {
    const [first] = line.split(";");
    const id = pyInt(first!.endsWith(CARGO_MARKER) ? first!.slice(0, -1) : first!);
    if (id !== null && id > 0) ids.add(id);
  }
  return [...ids];
}

/** godma.GetPowerEffectForType: the type's first effect among the slot effects; null with none. */
function powerEffectOf(facts: FittingLinkTypeFacts): number | null {
  return facts.effects.find((effectID) => POWER_EFFECTS.includes(effectID)) ?? null;
}

/**
 * GetFittingFromString (817 to 884): the fitting a string holds, named the link's text (`name`) or else the hull's
 * type's name (`typeName`), with no owner, number or description; or INVALID_FITTING_ID where the hull's part is not a
 * number (DisplayFittingFromString: FittingInvalidForViewing). Each module not in the hold to the next free slot of its
 * kind, one for each of its count; a part that is not two numbers passed over; anything else to its bay or the hold
 * by its category, group or type list, and the rest passed over.
 */
export function fittingFromString(
  fittingString: string,
  name: string | null,
  facts: (typeID: number) => FittingLinkTypeFacts | null,
  typeName: (typeID: number) => string,
): { readonly kind: "fitting"; readonly fitting: LinkedFitting & { readonly name: string }; readonly truncated: boolean } | { readonly kind: "invalid"; readonly truncated: boolean } {
  const effectSlots: Record<number, number> = { ...FIRST_FLAG_BY_EFFECT };
  let truncated = false;
  let text = fittingString;
  if (!text.endsWith("::")) {
    truncated = true;
    text = text.slice(0, text.lastIndexOf(":") < 0 ? -1 : text.lastIndexOf(":"));
  }
  const factsOf = (typeID: number): FittingLinkTypeFacts => {
    const known = facts(typeID);
    if (known === null) throw new FittingLinkError(`type ${typeID} not in the client's data`);
    return known;
  };
  let shipTypeID: number | null = null;
  const fitData: [number, number, number][] = [];
  // The slot loop's variable, which Python keeps after its loop and an empty loop leaves as it was.
  let flag: number | undefined;
  for (const line of text.split(":")) {
    const typeInfo = line.split(";");
    if (line === "") continue;
    if (typeInfo.length === 1) {
      const id = pyInt(typeInfo[0]!);
      if (id === null) return { kind: "invalid", truncated };
      shipTypeID = id;
      continue;
    }
    if (typeInfo.length !== 2) throw new FittingLinkError("a part with more than two values");
    let typeText = typeInfo[0]!;
    let inCargo = false;
    if (typeText.endsWith(CARGO_MARKER)) {
      typeText = typeText.slice(0, -1);
      inCargo = true;
    }
    const typeID = pyInt(typeText);
    const qty = pyInt(typeInfo[1]!);
    if (typeID === null || qty === null) continue;
    const type = factsOf(typeID);
    const powerEffectID = powerEffectOf(type);
    if (powerEffectID !== null && !inCargo) {
      const startSlot = effectSlots[powerEffectID]!;
      for (let each = startSlot; each < startSlot + qty; each += 1) {
        flag = each;
        fitData.push([typeID, flag, 1]);
      }
      if (flag === undefined) throw new FittingLinkError("a slot count of none before any slot");
      effectSlots[powerEffectID] = flag + 1;
      continue;
    }
    const { categoryID, groupID, lists } = type;
    if (categoryID === CATEGORY_DRONE) fitData.push([typeID, FLAG_DRONE_BAY, qty]);
    if (categoryID === CATEGORY_FIGHTER) fitData.push([typeID, FLAG_FIGHTER_BAY, qty]);
    else if (categoryID === CATEGORY_CHARGE || categoryID === CATEGORY_IMPLANT || categoryID === CATEGORY_MODULE || categoryID === CATEGORY_SUBSYSTEM) fitData.push([typeID, FLAG_CARGO, qty]);
    else if (groupID === GROUP_ICE_PRODUCT) fitData.push([typeID, FLAG_CARGO, qty]);
    else if (lists.has(TYPE_LIST_FILAMENTS)) fitData.push([typeID, FLAG_CARGO, qty]);
    else if (lists.has(TYPE_LIST_OTHER_CARGO_HOLD_TYPES)) fitData.push([typeID, FLAG_CARGO, qty]);
  }
  // fitting.shipTypeID unset raises at evetypes.GetName (here or in the window's caption), as an unknown hull does.
  if (shipTypeID === null) throw new FittingLinkError("no hull");
  factsOf(shipTypeID);
  return { kind: "fitting", fitting: { shipTypeID, name: name || typeName(shipTypeID), fitData }, truncated };
}

/**
 * GetStringForFitting (768 to 815): the hull, then each fitted module of its count (a defaultdict of the modules not
 * in the hold), the drones, fighters, charges, fuel, implants, filaments and other things the hold takes, each type
 * with its quantity (the last given), each kind in its dict's order; then the hold's modules, marked; and "::".
 */
export function stringForFitting(fitting: LinkedFitting, facts: (typeID: number) => FittingLinkTypeFacts | null): string {
  const kinds = ["types", "drones", "fighters", "charges", "ice", "implants", "filaments", "otherCargoItems", "modules"] as const;
  const dicts = new Map(kinds.map((kind) => [kind, { order: [] as number[], values: new Map<number, number>() }]));
  const put = (kind: (typeof kinds)[number], typeID: number, value: (before: number | undefined) => number): void => {
    const dict = dicts.get(kind)!;
    if (!dict.values.has(typeID)) dict.order.push(typeID);
    dict.values.set(typeID, value(dict.values.get(typeID)));
  };
  for (const [typeID, flag, qty] of fitting.fitData) {
    const type = facts(typeID);
    if (type === null) throw new FittingLinkError(`type ${typeID} not in the client's data`);
    const { categoryID, groupID, lists } = type;
    if (categoryID === CATEGORY_MODULE || categoryID === CATEGORY_SUBSYSTEM || categoryID === CATEGORY_STRUCTURE_MODULE) {
      if (flag === FLAG_CARGO) put("modules", typeID, () => qty);
      else put("types", typeID, (before) => (before ?? 0) + 1);
    } else if (categoryID === CATEGORY_DRONE) put("drones", typeID, () => qty);
    else if (categoryID === CATEGORY_FIGHTER) put("fighters", typeID, () => qty);
    else if (categoryID === CATEGORY_CHARGE) put("charges", typeID, () => qty);
    else if (categoryID === CATEGORY_IMPLANT) put("implants", typeID, () => qty);
    else if (groupID === GROUP_ICE_PRODUCT) put("ice", typeID, () => qty);
    else if (lists.has(TYPE_LIST_FILAMENTS)) put("filaments", typeID, () => qty);
    else if (lists.has(TYPE_LIST_OTHER_CARGO_HOLD_TYPES)) put("otherCargoItems", typeID, () => qty);
  }
  const parts = [String(fitting.shipTypeID)];
  for (const kind of kinds) {
    const dict = dicts.get(kind)!;
    for (const typeID of intDictOrder(dict.order)) parts.push(kind === "modules" ? `${typeID}${CARGO_MARKER};${dict.values.get(typeID)}` : `${typeID};${dict.values.get(typeID)}`);
  }
  return `${parts.join(":")}::`;
}

/** eveformat.simple_html_unescape: the three entities, either case. */
export function simpleHtmlUnescape(text: string): string {
  return text.replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&").replaceAll("&AMP;", "&").replaceAll("&GT;", ">").replaceAll("&LT;", "<");
}
