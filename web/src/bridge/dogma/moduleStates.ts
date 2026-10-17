// A simulated module's state, as the Fitting window keeps it (eve/client/script/ui/shared/fittingScreen
// ghostFittingSvc.py, moduleStateUtil.py, fittingUtil.py), on the page's own dogma location (location.ts).
//
//   its state            a rig: online while its default effect runs, else offline; a module with no default effect
//                        it is activated by (IsPassive): online or offline; any other: offline, online, active, or
//                        overheated where its overload effect runs too (GetCurrentStateForDogmaItemWithEffects)
//   the next state       a click goes offline > online > active > overheated > offline, past a state the module
//                        cannot be in (GetNewState); with shift, the other way (GetNewStateBackwards)
//   each change          online, activated, overheated, offline, deactivated, overheat stopped, or online first and
//                        then activated or overheated (PerformActionAndSetNewState); overheating a module with no
//                        overload effect activates it, activating one with no default effect does nothing
//   a rack at once       the modules in the slots asked, a slot at a time: offline; online (offline first); active
//                        (offline, online, then active: a cloak or a mass entangler not activated); overheated
//                        (active first) (PerformActionOnSlotList), the UserErrors of a fit that does not run passed
//                        over (USERERRORS_TO_EAT)
//   a ship loaded        its rigs activated, every module online, then every module activated (_ActivateOnLoading)

import { DogmaUserError, type DogmaItem, type DogmaLocation } from "./location.ts";

/** eve/client/script/ui/shared/fittingScreen: the states and the changes between them. */
export const OFFLINE = 0;
export const ONLINE = 1;
export const ACTIVE = 2;
export const OVERHEATED = 3;
export const DEACTIVATING = 10;
export const DEHEATING = 11;
export const HEATING_FROM_OFFLINE = 12;
export const ACTIVE_FROM_OFFLINE = 13;

/** inventorycommon/const.py: the slot flags. */
const LO_SLOT_FLAGS = [11, 12, 13, 14, 15, 16, 17, 18];
const MED_SLOT_FLAGS = [19, 20, 21, 22, 23, 24, 25, 26];
const HI_SLOT_FLAGS = [27, 28, 29, 30, 31, 32, 33, 34];
const SUBSYSTEM_SLOT_FLAGS = [125, 126, 127, 128];
export const RIG_SLOT_FLAGS: readonly number[] = [92, 93, 94];
const SERVICE_SLOT_FLAGS = [164, 165, 166, 167, 168, 169, 170, 171];
/** ghostFittingSvc allModuleSlots: the subsystems, the low, medium and high slots, the services. */
export const ALL_MODULE_SLOTS: readonly number[] = [...SUBSYSTEM_SLOT_FLAGS, ...LO_SLOT_FLAGS, ...MED_SLOT_FLAGS, ...HI_SLOT_FLAGS, ...SERVICE_SLOT_FLAGS];

/** TYPEIDS_NOT_ACTIVE_BY_DEFAULT: the types of groupCloakingDevice and groupMassEntanglers. */
const GROUPS_NOT_ACTIVE_BY_DEFAULT: ReadonlySet<number> = new Set([330, 2008]);

/** USERERRORS_TO_EAT */
const USERERRORS_TO_EAT: ReadonlySet<string> = new Set([
  "EffectAlreadyActive2",
  "NotEnoughCpu",
  "NotEnoughPower",
  "NoCharges",
  "EffectCrowdedOut",
  "CantCloakTooManyDevices",
  "DeniedActivateCloaked",
  "ModuleIsBlocked",
  "CannotOnlineReachedMaxGroupOnline",
]);

const isRigSlot = (flagID: number): boolean => RIG_SLOT_FLAGS.includes(flagID);
const isSubsystemSlot = (flagID: number): boolean => SUBSYSTEM_SLOT_FLAGS.includes(flagID);

/** The module in a slot of the ship (GetModuleFromShipFlag): not the charge loaded there. */
export function moduleInSlot(ship: DogmaItem, flagID: number): DogmaItem | null {
  for (const item of ship.fitted.values()) {
    if (item !== ship && item.flagID === flagID && ship.subLocations.get(flagID) !== item) return item;
  }
  return null;
}

/** GetModuleStatus: a subsystem is online; else GetCurrentStateForDogmaItemWithEffects. */
export function moduleState(location: DogmaLocation, module: DogmaItem): number {
  const flagID = module.flagID ?? 0;
  if (isSubsystemSlot(flagID)) return ONLINE;
  const info = location.typeEffectInfo(module.typeID);
  if (isRigSlot(flagID)) return info.defaultEffectID !== null && module.activeEffects.has(info.defaultEffectID) ? ONLINE : OFFLINE;
  if (info.defaultEffectID === null || !info.isActivatable) return location.isOnline(module) ? ONLINE : OFFLINE;
  if (!location.isOnline(module)) return OFFLINE;
  if (!location.isActive(module)) return ONLINE;
  if (info.overloadEffectID !== null && module.activeEffects.has(info.overloadEffectID)) return OVERHEATED;
  return ACTIVE;
}

/** GetNewState and, with shift, GetNewStateBackwards: the state a click puts the module in. */
export function nextState(location: DogmaLocation, module: DogmaItem, backwards: boolean): number | null {
  const flagID = module.flagID ?? 0;
  const info = location.typeEffectInfo(module.typeID);
  const current = moduleState(location, module);
  const isActivateable = info.defaultEffectID !== null && info.isActivatable;
  const isOverHeatable = info.overloadEffectID !== null;
  if (backwards) {
    if (current === ONLINE) return OFFLINE;
    if (current === ACTIVE) return DEACTIVATING;
    if (current === OVERHEATED) return DEHEATING;
    if (current === OFFLINE) {
      if (isOverHeatable) return HEATING_FROM_OFFLINE;
      if (isRigSlot(flagID) || isActivateable) return ACTIVE_FROM_OFFLINE;
      return ONLINE;
    }
    return null;
  }
  if (current === ONLINE) return isActivateable ? ACTIVE : OFFLINE;
  if (current === ACTIVE) return isOverHeatable ? OVERHEATED : OFFLINE;
  if (current === OVERHEATED) return OFFLINE;
  if (current === OFFLINE) return isRigSlot(flagID) ? ACTIVE : ONLINE;
  return null;
}

/** PerformActionAndSetNewState: the module put in the state asked (a DogmaUserError where it cannot be). */
export function setModuleState(location: DogmaLocation, module: DogmaItem, newState: number): void {
  const info = location.typeEffectInfo(module.typeID);
  let state = newState;
  if (state === OVERHEATED && info.overloadEffectID === null) state = ACTIVE;
  if (state === ACTIVE && info.defaultEffectID === null) return;
  if (state === ONLINE) location.startEffect(module, 16);
  else if (state === ACTIVE) location.activateModule(module);
  else if (state === OVERHEATED) location.overheatModule(module, true);
  else if (state === OFFLINE) location.offlineModule(module);
  else if (state === DEACTIVATING) location.deactivateModule(module);
  else if (state === DEHEATING) location.overheatModule(module, false);
  else if (state === HEATING_FROM_OFFLINE) {
    location.startEffect(module, 16);
    location.overheatModule(module, true);
  } else if (state === ACTIVE_FROM_OFFLINE) {
    location.startEffect(module, 16);
    location.activateModule(module);
  }
}

/** SwitchBetweenModes: a click on the module (shift: backwards). */
export function switchModuleState(location: DogmaLocation, module: DogmaItem, backwards: boolean): void {
  const state = nextState(location, module, backwards);
  if (state !== null) setModuleState(location, module, state);
}

/** EatCpuPowergridActiveUserErrors around one module's change. */
function eatingFitErrors(change: () => void): void {
  try {
    change();
  } catch (error) {
    if (!(error instanceof DogmaUserError) || !USERERRORS_TO_EAT.has(error.key)) throw error;
  }
}

/** PerformActionOnSlotList: each slot's module put in the state, a cloak or a mass entangler not activated or overheated. */
function stateOfSlots(location: DogmaLocation, ship: DogmaItem, state: number, flagIDs: readonly number[]): void {
  for (const flagID of flagIDs) {
    const module = moduleInSlot(ship, flagID);
    if (!module) continue;
    if (module.groupID !== null && GROUPS_NOT_ACTIVE_BY_DEFAULT.has(module.groupID) && (state === ACTIVE || state === OVERHEATED)) continue;
    eatingFitErrors(() => setModuleState(location, module, state));
  }
}

/** OfflineSlotList */
export function offlineSlots(location: DogmaLocation, ship: DogmaItem, flagIDs: readonly number[]): void {
  stateOfSlots(location, ship, OFFLINE, flagIDs);
}

/** OnlineSlotList: offline first. */
export function onlineSlots(location: DogmaLocation, ship: DogmaItem, flagIDs: readonly number[]): void {
  offlineSlots(location, ship, flagIDs);
  stateOfSlots(location, ship, ONLINE, flagIDs);
}

/** ActivateSlotList: offline, online, then active. */
export function activateSlots(location: DogmaLocation, ship: DogmaItem, flagIDs: readonly number[]): void {
  offlineSlots(location, ship, flagIDs);
  onlineSlots(location, ship, flagIDs);
  stateOfSlots(location, ship, ACTIVE, flagIDs);
}

/** OverheatSlotList: active first. */
export function overheatSlots(location: DogmaLocation, ship: DogmaItem, flagIDs: readonly number[]): void {
  activateSlots(location, ship, flagIDs);
  stateOfSlots(location, ship, OVERHEATED, flagIDs);
}

/** _ActivateOnLoading: the rigs activated, every module online, then every module activated. */
export function activateOnLoading(location: DogmaLocation, ship: DogmaItem): void {
  activateSlots(location, ship, RIG_SLOT_FLAGS);
  onlineSlots(location, ship, ALL_MODULE_SLOTS);
  activateSlots(location, ship, ALL_MODULE_SLOTS);
}
