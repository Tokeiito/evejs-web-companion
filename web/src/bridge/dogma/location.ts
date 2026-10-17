// The client's dogma location (eve/common/script/dogma/baseDogmaLocation.py, and the Fitting window's
// FittingDogmaLocation on it): the items a simulated ship is reckoned with, the modifiers between their attributes, and
// how a type's passive effects and the server's brain put those modifiers in place. The second part of the page's own
// dogma, on attribute.ts.
//
//   LoadMyShip            the pilot loaded, then the ship (its attributes as its type has them, fitted to itself,
//                         its passive effects started), then MakeShipActive: the brain's effects applied
//   StartPassiveEffects   each of a type's passive effects (dgmEffPassive; a system effect is not started in the
//                         Fitting window, and the slot-power and skill effects never are), the effect's modifiers
//                         started in its environment, unless it modifies a character and the item has no pilot, a ship
//                         and it has no ship, or names another item (otherID) it has none of, or goes by a chance the
//                         type has (ShouldStartChanceBasedEffect: never, in the Fitting window)
//   the modifiers         dogma/effects/modifiers.py: an ItemModifier on one item's attribute; a LocationModifier, a
//                         LocationGroupModifier and a LocationRequiredSkillModifier on every item fitted to a location
//                         (of a group, or requiring a skill) that has the attribute; an OwnerRequiredSkillModifier on
//                         what an owner owns that requires the skill. Each modifier's domain is the item it starts from
//                         (none: the effect's own item), the ship, the pilot or another item.
//   ApplyBrainEffects     the server's brain (eve/common/script/dogma/effect.py BrainEffect: what the pilot's skills
//                         and implants do, worked out on the server): its ship effects on the ship (a modifier of one
//                         attribute only where the hull's type has it, or it is capacity), its character effects on the
//                         pilot; each from a BrainLiteralAttribute of its value, one for each set of skills and value
//                         (brainLiterals), which no stacking penalty falls on (forceUnnurfed)
//   _ApplyPilotSecurityStatusToShip   the pilot's security status set on the ship (pilotSecurityStatus)
//
// An attribute is made the first time it is asked for (keydefaultdict, itemAttributeFactory) with its type's value or
// its default, and on being made takes the modifiers its item's location and owner hold for it
// (_PickUpInitialModifiers). A modifier from a location reaches only those of its items' attributes made already. A
// ship is fitted to itself but has no location of its own, so an attribute of the ship made after a location modifier
// was put in place never takes it.
//
// Not yet (later parts): the Python-written effects (online, the fitted, hardpoint and slot effects, propulsion, the
// migrated skill effects), modules and charges, drones and fighters, the skill level, charged, heat, security and
// TiDi attribute classes.

import type { JsonValue } from "../wire.ts";
import { readDictPairs, isListValue, unwrapLong, unwrapReal } from "../wire.ts";
import { attributeValue, type IncomingModifier } from "./attribute.ts";

/** One modifier of an effect's modifierInfo (dogmaEffects.fsdbinary). */
export interface DogmaModifierInfo {
  readonly func: string | null;
  readonly domain: string | null;
  readonly modifiedAttributeID: number | null;
  readonly modifyingAttributeID: number | null;
  readonly operation: number | null;
  readonly skillTypeID: number | null;
  readonly groupID: number | null;
}

/** An effect's record, as far as the location goes by it. */
export interface DogmaEffectFacts {
  readonly category: number | null;
  /** fittingUsageChanceAttributeID */
  readonly chanceAttributeID: number | null;
  /** Its modifierInfo; null where it has none (a neutral effect). */
  readonly modifiers: readonly DogmaModifierInfo[] | null;
}

/** A type as the location goes by it. */
export interface DogmaTypeFacts {
  /** dogma/data.py get_type_attributes: [attributeID, value], in its order. */
  readonly attributes: readonly (readonly [number, number | null])[];
  /** Its effects, in its typeDogma's order. */
  readonly effects: readonly number[];
  readonly groupID: number | null;
  readonly categoryID: number | null;
  /** get_dogma_required_skills: the skills it requires (an item's reqSkills). */
  readonly requiredSkills: readonly number[];
}

/** An attribute's static record, as Attribute and itemAttributeFactory go by it. */
export interface DogmaAttributeRecord {
  readonly stackable: boolean;
  readonly dataType: number | null;
  readonly defaultValue: number | null;
  readonly highIsGood: boolean;
  readonly maxAttributeID: number | null;
  readonly minAttributeID: number | null;
  readonly chargeRechargeTimeID: number | null;
}

/** The static data the location reckons with (GET /api/client-data/dogma-types). */
export interface DogmaStatic {
  readonly types: Readonly<Record<number, DogmaTypeFacts | null>>;
  readonly effects: Readonly<Record<number, DogmaEffectFacts | null>>;
  readonly attributes: Readonly<Record<number, DogmaAttributeRecord | null>>;
}

/** One of the brain's effects (BrainEffect): the kind of modifier, its target attribute and operator, its value. */
export interface BrainEffect {
  /** M, L, LG, LRS or ORS (ApplyBrainEffect). */
  readonly modifierType: string;
  readonly toAttribID: number;
  readonly operation: number;
  readonly value: number;
  /** The skills it comes from (its literal is one for each set of skills and value). */
  readonly skills: readonly number[];
  /** The group (LG) or skill (LRS, ORS) it goes by. */
  readonly extras: readonly number[];
}

/** The server's brain: (version, charEffects, shipEffects, structureEffects). */
export interface Brain {
  readonly version: number;
  readonly charEffects: readonly BrainEffect[];
  readonly shipEffects: readonly BrainEffect[];
  readonly structureEffects: readonly BrainEffect[];
}

/** dogma/const.py, inventorycommon/const.py */
const EFFECT_CATEGORY_PASSIVE = 0;
/** baseDogmaStaticSvc unwantedEffects: effectHiPower, effectLoPower, effectMedPower, effectSkillEffect. */
const UNWANTED_EFFECTS: ReadonlySet<number> = new Set([12, 11, 13, 132]);
const ATTRIBUTE_CAPACITY = 38;
const ATTRIBUTE_PILOT_SECURITY_STATUS = 2610;
const CATEGORY_SHIP = 6;

function brainNumber(value: JsonValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const real = unwrapReal(value);
  if (real !== null) return real;
  const long = unwrapLong(value);
  return long !== null ? Number(long) : null;
}

function brainNumbers(value: JsonValue | undefined): number[] {
  const items = isListValue(value) ? value.items : Array.isArray(value) ? value : [];
  return (items as readonly JsonValue[]).map(brainNumber).filter((at): at is number => at !== null);
}

/** One BrainEffect as it comes over the wire: an objectex1 whose state dict holds its fields. */
function decodeBrainEffect(raw: JsonValue): BrainEffect | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const header = (raw as Record<string, JsonValue>).header;
  const state = Array.isArray(header) ? (header as readonly JsonValue[])[2] : undefined;
  const fields = new Map(readDictPairs(state).map(([key, value]) => [String(key), value]));
  const modifierType = fields.get("modifierType");
  const toAttribID = brainNumber(fields.get("toAttribID"));
  const operation = brainNumber(fields.get("operation"));
  const value = brainNumber(fields.get("value"));
  if (typeof modifierType !== "string" || toAttribID === null || operation === null || value === null) return null;
  return { modifierType, toAttribID, operation, value, skills: brainNumbers(fields.get("skills")), extras: brainNumbers(fields.get("extras")) };
}

function decodeBrainEffects(raw: JsonValue | undefined): BrainEffect[] {
  const items = isListValue(raw) ? raw.items : Array.isArray(raw) ? raw : [];
  return (items as readonly JsonValue[]).map(decodeBrainEffect).filter((effect): effect is BrainEffect => effect !== null);
}

/** The brain as GetAllInfo's charInfo carries it (its second part). */
export function decodeBrain(raw: JsonValue | null | undefined): Brain | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const parts = raw as readonly JsonValue[];
  return {
    version: brainNumber(parts[0]) ?? -1,
    charEffects: decodeBrainEffects(parts[1]),
    shipEffects: decodeBrainEffects(parts[2]),
    structureEffects: decodeBrainEffects(parts[3]),
  };
}

/** What a modifier comes from: another attribute, or a literal (the brain's). */
type ModifierSource =
  | { readonly kind: "attribute"; readonly key: string; readonly itemKey: string; readonly attributeID: number }
  | { readonly kind: "literal"; readonly key: string; readonly value: number; readonly forceUnnurfed: boolean };

/** (operation, fromAttrib), as the location's and owner's modifier sets hold them. */
interface HeldModifier {
  readonly op: number;
  readonly source: ModifierSource;
}

function heldKey(held: HeldModifier): string {
  return `${held.op}|${held.source.key}`;
}

/** A dogma item (SlimDogmaItem and the classes on it, as far as the location needs). */
class DogmaItem {
  readonly key: string;
  readonly typeID: number;
  readonly groupID: number | null;
  readonly categoryID: number | null;
  readonly reqSkills: ReadonlySet<number>;
  /** The attributes made so far, and the base value each was given (null: its type's value or default). */
  readonly attributes = new Map<number, number | null>();
  /** attributeID -> (operation|source) -> the modifier: the incoming modifiers, a set by operator. */
  readonly incoming = new Map<number, Map<string, HeldModifier>>();
  /** The item's location, where it is not its own. */
  location: DogmaItem | null = null;
  /** The pilot (GetPilot). */
  pilot: DogmaItem | null = null;
  /** The ship it is in or is (GetShip: the pilot's ship), where it has one. */
  ship: DogmaItem | null = null;
  /** The effects started on it (activeEffects). */
  readonly activeEffects = new Set<number>();
  /** A location's: the items fitted to it (itself among them, for a ship), and the modifiers it holds for them. */
  readonly fitted = new Map<string, DogmaItem>();
  readonly locationMods = new Map<number, Map<string, HeldModifier>>();
  readonly locationGroupMods = new Map<number, Map<number, Map<string, HeldModifier>>>();
  readonly locationReqSkillMods = new Map<number, Map<number, Map<string, HeldModifier>>>();
  /** An owner's: the modifiers it holds for what it owns. */
  readonly ownerReqSkillMods = new Map<number, Map<number, Map<string, HeldModifier>>>();

  constructor(key: string, typeID: number, facts: DogmaTypeFacts | null) {
    this.key = key;
    this.typeID = typeID;
    this.groupID = facts ? facts.groupID : null;
    this.categoryID = facts ? facts.categoryID : null;
    this.reqSkills = new Set(facts ? facts.requiredSkills : []);
  }
}

function heldSet<K>(map: Map<K, Map<string, HeldModifier>>, key: K): Map<string, HeldModifier> {
  let set = map.get(key);
  if (!set) {
    set = new Map();
    map.set(key, set);
  }
  return set;
}

function heldSet2D(map: Map<number, Map<number, Map<string, HeldModifier>>>, first: number, second: number): Map<string, HeldModifier> {
  let inner = map.get(first);
  if (!inner) {
    inner = new Map();
    map.set(first, inner);
  }
  return heldSet(inner, second);
}

/**
 * A dogma location: its items and the modifiers between their attributes, each attribute's value reckoned as the
 * client's Attribute reckons it.
 */
export class DogmaLocation {
  readonly static: DogmaStatic;
  private readonly items = new Map<string, DogmaItem>();
  private readonly cache = new Map<string, number>();
  private readonly reckoning = new Set<string>();

  constructor(staticData: DogmaStatic) {
    this.static = staticData;
  }

  item(key: string): DogmaItem | null {
    return this.items.get(key) ?? null;
  }

  /** LoadItem: an item of a type, its attributes as its type has them (GetAttributesForItem, BaseDogmaItem.Load). */
  loadItem(key: string, typeID: number): DogmaItem {
    const facts = this.static.types[typeID] ?? null;
    const item = new DogmaItem(key, typeID, facts);
    this.items.set(key, item);
    for (const [attributeID, value] of facts ? facts.attributes : []) {
      this.makeAttribute(item, attributeID);
      item.attributes.set(attributeID, value);
    }
    this.cache.clear();
    return item;
  }

  /** The attribute's static record. */
  private record(attributeID: number): DogmaAttributeRecord | null {
    return this.static.attributes[attributeID] ?? null;
  }

  /** dogma_data.get_type_attribute_or_default: the type's value, else the attribute's default. */
  private typeValue(item: DogmaItem, attributeID: number): number {
    const facts = this.static.types[item.typeID];
    const listed = facts ? facts.attributes.find(([id]) => id === attributeID) : undefined;
    if (listed && listed[1] !== null) return listed[1];
    const record = this.record(attributeID);
    return record && record.defaultValue !== null ? record.defaultValue : 0;
  }

  /**
   * item.attributes[attributeID]: made the first time it is asked for, with its cap and floor attributes, and the
   * modifiers its location and owner hold for it (Attribute.__init__, _PickUpInitialModifiers).
   */
  private makeAttribute(item: DogmaItem, attributeID: number): void {
    if (item.attributes.has(attributeID)) return;
    item.attributes.set(attributeID, null);
    const record = this.record(attributeID);
    if (record && record.maxAttributeID) this.makeAttribute(item, record.maxAttributeID);
    if (record && record.minAttributeID) this.makeAttribute(item, record.minAttributeID);
    const location = item.location;
    if (location) this.pickUpFromLocation(location, item, attributeID);
    // _PickUpInitialModifiersFromOwnerTo: only an owner-modifiable item (a drone, a charge, a fighter), a later part.
  }

  /** _PickUpInitialModifiersFromLocationTo */
  private pickUpFromLocation(location: DogmaItem, item: DogmaItem, attributeID: number): void {
    const apply = (set: Map<string, HeldModifier> | undefined): void => {
      for (const held of set ? set.values() : []) this.addIncoming(item, attributeID, held);
    };
    apply(location.locationMods.get(attributeID));
    if (item.groupID !== null) apply(location.locationGroupMods.get(item.groupID)?.get(attributeID));
    for (const skillID of item.reqSkills) apply(location.locationReqSkillMods.get(skillID)?.get(attributeID));
  }

  private addIncoming(item: DogmaItem, attributeID: number, held: HeldModifier): void {
    heldSet(item.incoming, attributeID).set(heldKey(held), held);
    this.cache.clear();
  }

  /** dogmaItems[itemID].attributes[attribID], as a modifier's source. */
  private attributeSource(item: DogmaItem, attributeID: number): ModifierSource {
    this.makeAttribute(item, attributeID);
    return { kind: "attribute", key: `a|${item.key}|${attributeID}`, itemKey: item.key, attributeID };
  }

  /** brainLiterals[(skills, value)]: one BrainLiteralAttribute for each set of skills and value. */
  private brainLiteral(effect: BrainEffect): ModifierSource {
    return { kind: "literal", key: `b|${effect.skills.join(",")}|${effect.value}`, value: effect.value, forceUnnurfed: true };
  }

  /** AddModifierWithSource: the modifier on the target's attribute (made where it was not). */
  addModifier(op: number, to: DogmaItem, toAttributeID: number, source: ModifierSource): void {
    this.makeAttribute(to, toAttributeID);
    this.addIncoming(to, toAttributeID, { op, source });
  }

  /** AddLocationModifierWithSource */
  addLocationModifier(op: number, location: DogmaItem, toAttributeID: number, source: ModifierSource): void {
    const held = { op, source };
    heldSet(location.locationMods, toAttributeID).set(heldKey(held), held);
    for (const item of location.fitted.values()) if (item.attributes.has(toAttributeID)) this.addIncoming(item, toAttributeID, held);
  }

  /** AddLocationGroupModifierWithSource */
  addLocationGroupModifier(op: number, location: DogmaItem, groupID: number, toAttributeID: number, source: ModifierSource): void {
    const held = { op, source };
    heldSet2D(location.locationGroupMods, groupID, toAttributeID).set(heldKey(held), held);
    for (const item of location.fitted.values()) {
      if (item.groupID === groupID && item.attributes.has(toAttributeID)) this.addIncoming(item, toAttributeID, held);
    }
  }

  /** AddLocationRequiredSkillModifierWithSource */
  addLocationRequiredSkillModifier(op: number, location: DogmaItem, skillID: number, toAttributeID: number, source: ModifierSource): void {
    const held = { op, source };
    heldSet2D(location.locationReqSkillMods, skillID, toAttributeID).set(heldKey(held), held);
    for (const item of location.fitted.values()) {
      if (item.reqSkills.has(skillID) && item.attributes.has(toAttributeID)) this.addIncoming(item, toAttributeID, held);
    }
  }

  /** AddOwnerRequiredSkillModifierWithSource: held by the owner for what it owns (GetOwnedItemsToModify, later). */
  addOwnerRequiredSkillModifier(op: number, owner: DogmaItem, skillID: number, toAttributeID: number, source: ModifierSource): void {
    const held = { op, source };
    heldSet2D(owner.ownerReqSkillMods, skillID, toAttributeID).set(heldKey(held), held);
  }

  /** The item a modifier's domain names (BaseModifier._GetDomainID on the effect's environment). */
  private domainItem(item: DogmaItem, domain: string | null): DogmaItem | null {
    if (domain === null || domain === "itemID") return item;
    if (domain === "shipID") return item.categoryID === CATEGORY_SHIP ? item : item.ship;
    if (domain === "charID") return item.pilot;
    return null;
  }

  /** ModifierEffect.Start: each of the effect's modifiers put in place from the item. */
  private startModifiers(item: DogmaItem, modifiers: readonly DogmaModifierInfo[]): void {
    for (const info of modifiers) {
      if (info.operation === null || info.modifiedAttributeID === null || info.modifyingAttributeID === null) continue;
      const to = this.domainItem(item, info.domain);
      if (!to) continue;
      const source = this.attributeSource(item, info.modifyingAttributeID);
      switch (info.func) {
        case "ItemModifier":
          this.addModifier(info.operation, to, info.modifiedAttributeID, source);
          break;
        case "LocationModifier":
          this.addLocationModifier(info.operation, to, info.modifiedAttributeID, source);
          break;
        case "LocationGroupModifier":
          if (info.groupID !== null) this.addLocationGroupModifier(info.operation, to, info.groupID, info.modifiedAttributeID, source);
          break;
        case "LocationRequiredSkillModifier":
          if (info.skillTypeID !== null) this.addLocationRequiredSkillModifier(info.operation, to, info.skillTypeID, info.modifiedAttributeID, source);
          break;
        case "OwnerRequiredSkillModifier":
          if (info.skillTypeID !== null) this.addOwnerRequiredSkillModifier(info.operation, to, info.skillTypeID, info.modifiedAttributeID, source);
          break;
        default:
          break;
      }
    }
  }

  /** StartPassiveEffects, as the Fitting window starts them. */
  startPassiveEffects(item: DogmaItem): void {
    const facts = this.static.types[item.typeID];
    for (const effectID of facts ? facts.effects : []) {
      if (UNWANTED_EFFECTS.has(effectID) || item.activeEffects.has(effectID)) continue;
      const effect = this.static.effects[effectID];
      if (!effect || effect.category !== EFFECT_CATEGORY_PASSIVE) continue;
      const modifiers = effect.modifiers;
      if (!modifiers) continue;
      // __modifies_character__ and __modifies_ship__ (ModifierEffect): an OwnerRequiredSkillModifier is both.
      const modifiesCharacter = modifiers.some((info) => info.domain === "charID" || info.func === "OwnerRequiredSkillModifier");
      const modifiesShip = modifiers.some((info) => info.domain === "shipID" || info.func === "OwnerRequiredSkillModifier");
      if (item.pilot === null && modifiesCharacter) continue;
      if (item.ship === null && modifiesShip) continue;
      if (effect.chanceAttributeID && facts!.attributes.some(([id]) => id === effect.chanceAttributeID)) continue;
      if (modifiers.some((info) => info.domain === "otherID")) continue;
      this.startModifiers(item, modifiers);
      item.activeEffects.add(effectID);
    }
  }

  /** ApplyBrainEffect: one of the brain's effects on the target (the ship, or the pilot). */
  private applyBrainEffect(target: DogmaItem, effect: BrainEffect): void {
    const literal = this.brainLiteral(effect);
    const extra = effect.extras[0];
    switch (effect.modifierType) {
      case "M":
        this.addModifier(effect.operation, target, effect.toAttribID, literal);
        break;
      case "L":
        this.addLocationModifier(effect.operation, target, effect.toAttribID, literal);
        break;
      case "LG":
        if (extra !== undefined) this.addLocationGroupModifier(effect.operation, target, extra, effect.toAttribID, literal);
        break;
      case "LRS":
        if (extra !== undefined) this.addLocationRequiredSkillModifier(effect.operation, target, extra, effect.toAttribID, literal);
        break;
      case "ORS":
        if (extra !== undefined) this.addOwnerRequiredSkillModifier(effect.operation, target, extra, effect.toAttribID, literal);
        break;
      default:
        break;
    }
  }

  /** ApplyBrainEffects: the ship effects on the ship (a modifier of one attribute where the hull has it), then the character effects on the pilot. */
  applyBrainEffects(ship: DogmaItem, pilot: DogmaItem, brain: Brain): void {
    const facts = this.static.types[ship.typeID];
    const valid = new Set<number>((facts ? facts.attributes : []).map(([id]) => id));
    valid.add(ATTRIBUTE_CAPACITY);
    for (const effect of brain.shipEffects) {
      if (effect.modifierType === "M" && !valid.has(effect.toAttribID)) continue;
      this.applyBrainEffect(ship, effect);
    }
    for (const effect of brain.charEffects) this.applyBrainEffect(pilot, effect);
  }

  /** SetAttributeValue: an attribute's base value. */
  setBaseValue(item: DogmaItem, attributeID: number, value: number): void {
    this.makeAttribute(item, attributeID);
    item.attributes.set(attributeID, value);
    this.cache.clear();
  }

  /** Attribute.GetValue: the attribute's value as Update reckons it (its base, the modifiers reaching it). */
  value(item: DogmaItem, attributeID: number): number {
    const cacheKey = `${item.key}|${attributeID}`;
    const kept = this.cache.get(cacheKey);
    if (kept !== undefined) return kept;
    this.makeAttribute(item, attributeID);
    const record = this.record(attributeID);
    const base = item.attributes.get(attributeID) ?? this.typeValue(item, attributeID);
    if (this.reckoning.has(cacheKey)) return base;
    this.reckoning.add(cacheKey);
    try {
      const modifiers: IncomingModifier[] = [];
      for (const held of item.incoming.get(attributeID)?.values() ?? []) {
        const source = held.source;
        if (source.kind === "literal") {
          modifiers.push({ op: held.op, value: source.value, fromCategoryID: null, forceUnnurfed: source.forceUnnurfed });
          continue;
        }
        const from = this.items.get(source.itemKey);
        if (!from) continue;
        modifiers.push({ op: held.op, value: this.value(from, source.attributeID), fromCategoryID: from.categoryID });
      }
      const result = attributeValue(
        {
          attributeID,
          baseValue: base,
          stackable: record ? record.stackable : true,
          dataType: record ? record.dataType : null,
          cap: record && record.maxAttributeID ? this.value(item, record.maxAttributeID) : null,
          floor: record && record.minAttributeID ? this.value(item, record.minAttributeID) : null,
        },
        modifiers,
      );
      this.cache.set(cacheKey, result);
      return result;
    } finally {
      this.reckoning.delete(cacheKey);
    }
  }

  /** The values of the attributes an item has made: its type's, and those a modifier or a source made. */
  values(item: DogmaItem): Map<number, number> {
    const out = new Map<number, number>();
    for (const attributeID of [...item.attributes.keys()]) out.set(attributeID, this.value(item, attributeID));
    return out;
  }
}

/**
 * FittingDogmaLocation.LoadMyShip: the pilot loaded, then a ghost of the hull fitted to itself (the pilot its pilot:
 * GhostShipDogmaItem.GetPilot) and its passive effects started, though not yet those that modify a ship (it is no
 * pilot's ship yet: GetShip); the pilot seated in it (SetLocation, flagPilot: RegisterPilot, shipsByPilotID); then
 * MakeShipActive, which fits the ship to itself again (OnItemLoaded), starting the rest of its passive effects, and
 * applies the brain (ApplyBrainEffects); then the pilot's security status set on the ship.
 */
export function loadSimulatedShip(
  staticData: DogmaStatic,
  shipTypeID: number,
  pilot: { readonly characterID: number; readonly typeID: number; readonly securityStatus: number },
  brain: Brain | null,
): { readonly location: DogmaLocation; readonly ship: DogmaItem; readonly pilot: DogmaItem } {
  const location = new DogmaLocation(staticData);
  const pilotItem = location.loadItem(String(pilot.characterID), pilot.typeID);
  const ship = location.loadItem(`0_${shipTypeID}_ghost`, shipTypeID);
  ship.pilot = pilotItem;
  pilotItem.pilot = pilotItem;
  // LoadItem: ShipDogmaItem.OnItemLoaded, FitItemToLocation(ship, ship), then the passive effects.
  ship.fitted.set(ship.key, ship);
  location.startPassiveEffects(ship);
  // charDogmaItem.SetLocation(ship, flagPilot): RegisterPilot, and the ship the pilot's.
  ship.fitted.set(pilotItem.key, pilotItem);
  ship.ship = ship;
  pilotItem.ship = ship;
  // MakeShipActive: OnItemLoaded again, then ApplyBrainEffects.
  location.startPassiveEffects(ship);
  if (brain) location.applyBrainEffects(ship, pilotItem, brain);
  location.setBaseValue(ship, ATTRIBUTE_PILOT_SECURITY_STATUS, pilot.securityStatus);
  return { location, ship, pilot: pilotItem };
}
