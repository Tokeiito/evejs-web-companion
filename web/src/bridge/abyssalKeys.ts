// An Abyssal filament's use, as the client makes it.
//
// THE MENU. A filament (inventory group 1979, groupAbyssalKeys) the pilot owns, where the pilot is (in the station
// or structure it is docked in, in its ship but not the ship's hangar), offers "Activate" with the filament named
// (menusvc.py 394 and 395, 'UI/Commands/ActivateAbyssalKey'; menucheckers/itemCheckers.py OfferActivateAbyssalKey,
// 28 and 29; baseCheckers.IsInPilotLocation, 555 to 565), and so does a double click on its row (item.py 850 and
// 851). Either opens the key activation window (menuFunctions.ActivateAbyssalKey, 522 to 524; abyssal_service.py
// open_key_activation_window, 61 to 63).
//
// THE WINDOW (eve/client/script/ui/shared/abyss/keyActivationWindow.py KeyActivationWindow): captioned with the
// filament's name, its icon beside the filament's short description and its tier's description (TIER_DESCRIPTION_BY_
// TIER, the type's attribute 2761); the weather's icon, name and description (the type's attribute 2760,
// WEATHER_DESCRIPTION_BY_TYPE); the timer's description (twenty minutes in the pocket: DEFAULT_ABYSS_CONTENT_DURATION);
// the suspect's description where activating it here is suspicious; a combo of three, cruiser, destroyer and
// frigate (GetAbyssGameModeOptions), kept for the character ('abyssGameModeSetting', 1 where none is kept); and
// under it the button of the mode chosen (gameModeControllers 1, 2 and 3: the solo, the two-player and the co-op
// controller).
//
// THE BUTTON (activateButton.py, baseActivationController.py): enabled where the client's own checks find nothing
// (ClientValidator.validate_deploy: abyss/common/validator.py perform_base_validation_checks and perform_deploy_
// validation_checks), red with the errors in its tooltip otherwise, each in the client's words (abyss/error.py
// get_error_label). Pressed, it deploys: solo, which jumps on deploy, through a session change
// (sessionMgr.PerformSessionChange('JumpToAbyss', abyss.deploy_entrance_gate, itemID, gameModeID)); the others
// without one (keyActivationWindow.py 49 to 54). deploy_entrance_gate is RemoteSvc('abyssalMgr').
// AbyssalEntranceDeployment(item_id, game_mode_id) (abyssal_service.py 51 to 54). A refusal that is an AbyssError
// puts its errors on the button; any other is put up as any UserError is (BaseActivationController.Activate, 82 to
// 104). Once a deploy is made the window closes a second later (UpdateState, _AnimCloseWindow).
//
// The constants are the compiled modules' own, read through the client's Python (inventorycommon/const.pyc, dogma/
// const.pyc, abyss/common/constants.pyc, abyss/common/suspicion.pyc, abyss/game_mode.pyc). The text is the client's,
// read from its install at run time (the words store).

import type { Ask } from "./ask.ts";
import { isListValue, readDictEntry, unwrapLong, type JsonValue } from "./wire.ts";

/** inventorycommon.const.groupAbyssalKeys. */
export const GROUP_ABYSSAL_KEYS = 1979;
/** dogma.const.attributeWeatherID: the weather a filament's pocket has, a type. */
export const ATTRIBUTE_WEATHER_ID = 2760;
/** dogma.const.attributeDifficultyTier: a filament's tier. */
export const ATTRIBUTE_DIFFICULTY_TIER = 2761;
/** abyss.common.constants.TIER_0_DEMO: the demo filament's tier, which no security or invulnerability stops. */
export const TIER_0_DEMO = 1002;
/** abyss.common.constants.DEFAULT_ABYSS_CONTENT_DURATION: twenty minutes, in the game's 100 ns ticks. */
export const DEFAULT_ABYSS_CONTENT_DURATION = 12_000_000_000n;
/** crimewatch/const.py criminalTimerTimeout: fifteen minutes, in the game's 100 ns ticks. */
export const CRIMINAL_TIMER_TIMEOUT = 9_000_000_000n;
/** crimewatch/const.py pvpTimerStateIdle and shipSafetyLevelFull. */
export const PVP_TIMER_STATE_IDLE = 200;
export const SHIP_SAFETY_LEVEL_FULL = 2;
/** inventorycommon.const mapVoidSystemMin and mapVoidSystemMax (idCheckers.IsVoidSpaceSystem). */
const VOID_SYSTEMS = [34_000_000, 34_999_999] as const;
/** inventorycommon.const mapAbyssalSystemMin and mapAbyssalSystemMax (idCheckers.IsAbyssalSpaceSystem). */
const ABYSSAL_SYSTEMS = [32_000_000, 32_999_999] as const;
/** appConst.solarSystemZarzakh (idCheckers.IsZarzakh). */
const SOLAR_SYSTEM_ZARZAKH = 30_100_000;

/** abyss.game_mode.GameModeID. */
export const GAME_MODE = Object.freeze({ SOLO: 1, COOP: 2, TWO_PLAYER: 3 } as const);
export type GameModeID = (typeof GAME_MODE)[keyof typeof GAME_MODE];

/** abyss.error.Error, the client's numbers. */
export const ABYSS_ERROR = Object.freeze({
  ABYSS_CONTENT_ACTIVE: 1,
  IN_ABYSS_SYSTEM: 2,
  INVALID_KEY_TYPE: 3,
  INVALID_OWNER: 4,
  INVALID_SHIP_TYPE: 5,
  ITEM_NOT_REACHABLE: 6,
  KEY_NOT_FOUND: 7,
  PROXIMITY_RESTRICTION: 8,
  PVP_TIMER_ACTIVE: 9,
  SAFETY_ENGAGED: 10,
  SESSION_CHANGE_IN_PROGRESS: 11,
  SHIP_IN_DUNGEON: 12,
  SHIP_IN_FORCE_FIELD: 13,
  SHIP_IN_WARP: 14,
  SHIP_IS_CLOAKED: 15,
  SHIP_IS_DOCKED: 16,
  SHIP_IS_INVULNERABLE: 17,
  SHIP_IS_SELF_DESTRUCTING: 18,
  SHIP_IS_TETHERED: 19,
  SHIP_IS_WARP_SCRAMBLED: 20,
  SHIP_NOT_FOUND: 21,
  UNKNOWN_ERROR: 22,
  SHIP_NOT_IN_FLEET: 23,
  INVALID_SHIP_TYPE_THREE_PLAYER: 24,
  SHIP_NOT_IN_SAME_FLEET: 25,
  SHIP_HAS_ENTERED: 26,
  MAX_ENTERED: 27,
  ENTRANCE_CLOSED: 28,
  PROXIMITY_ENTRANCE: 29,
  ENTRANCE_MISSING: 30,
  INVALID_KEY_AMOUNT: 31,
  POCKET_COLLAPSING: 32,
  CONGESTION_BAN: 33,
  INVALID_SHIP_TYPE_TWO_PLAYER: 34,
  VOID_SPACE_DISALLOWED: 35,
  VERY_SECURE_SYSTEM_DISALLOWED: 36,
  IN_BANNED_SYSTEM: 37,
} as const);

/** One of the client's abyss errors and its arguments ((error, args) in the validator and in an AbyssError). */
export type AbyssErrorEntry = readonly [code: number, args: readonly (number | string)[]];

/** A game mode's rules (abyss/game_mode.py AbyssSoloGameMode, AbyssCoOpGameMode, AbyssTwoPlayerGameMode). */
export interface AbyssGameMode {
  readonly id: GameModeID;
  /** The type list of the hulls it takes (evetypes.GetTypeIDsByListID). */
  readonly allowedShipsListID: number;
  readonly maxPlayers: number;
  /** How many filaments of the stack it takes. */
  readonly keyStackSize: number;
  readonly shipRestrictionError: number;
  readonly jumpsOnDeploy: boolean;
}

export const GAME_MODES: Readonly<Record<GameModeID, AbyssGameMode>> = Object.freeze({
  1: { id: 1, allowedShipsListID: 57, maxPlayers: 1, keyStackSize: 1, shipRestrictionError: ABYSS_ERROR.INVALID_SHIP_TYPE, jumpsOnDeploy: true },
  2: { id: 2, allowedShipsListID: 92, maxPlayers: 3, keyStackSize: 3, shipRestrictionError: ABYSS_ERROR.INVALID_SHIP_TYPE_THREE_PLAYER, jumpsOnDeploy: false },
  3: { id: 3, allowedShipsListID: 233, maxPlayers: 2, keyStackSize: 2, shipRestrictionError: ABYSS_ERROR.INVALID_SHIP_TYPE_TWO_PLAYER, jumpsOnDeploy: false },
});

/**
 * The window's combo (GetAbyssGameModeOptions), each option's value the button it shows (gameModeControllers): 1 the
 * solo controller's, 2 the two-player's, 3 the co-op's.
 */
export const GAME_MODE_OPTIONS: ReadonlyArray<{ readonly value: 1 | 2 | 3; readonly label: string; readonly mode: GameModeID }> = Object.freeze([
  { value: 1, label: "UI/Abyss/cruiserSelection", mode: GAME_MODE.SOLO },
  { value: 2, label: "UI/Abyss/destroyerSelection", mode: GAME_MODE.TWO_PLAYER },
  { value: 3, label: "UI/Abyss/frigateSelection", mode: GAME_MODE.COOP },
]);
/** GetDefaultGameModeSetting: settings.char.ui 'abyssGameModeSetting', 1 where none is kept. */
export const DEFAULT_GAME_MODE_SETTING = 1;

/** The window's words (keyActivationWindow.py; the controllers' GetText; menusvc.py 395). */
export const ABYSS_WINDOW_LABELS = Object.freeze({
  activateKey: "UI/Commands/ActivateAbyssalKey",
  shortDescription: "UI/Abyss/FilamentSoloAndFleetShortDescription",
  timerDescription: "UI/Abyss/TimerDescription",
  suspectDescription: "UI/Abyss/SuspectDescription",
  activate: "UI/Abyss/Activate",
  jumping: "UI/Abyss/Jumping",
  fleet: "UI/Abyss/Fleet",
  deploying: "UI/Abyss/Deploying",
});

/** abyss/common/__init__ TIER_0 to TIER_6 and TIER_0_DEMO, by the window's TIER_DESCRIPTION_BY_TIER (const.py 7 to 14). */
export const TIER_DESCRIPTION_BY_TIER: Readonly<Record<number, string>> = Object.freeze({
  0: "UI/Abyss/tranquilDescription",
  [TIER_0_DEMO]: "UI/Abyss/tranquilDescription",
  1: "UI/Abyss/CalmDescription",
  2: "UI/Abyss/AgitatedDescription",
  3: "UI/Abyss/FierceDescription",
  4: "UI/Abyss/RagingDescription",
  5: "UI/Abyss/ChaoticDescription",
  6: "UI/Abyss/cataclysmicDescription",
});

/** The weathers, by type (const.py 15 to 19: typeCausticAbyss 47862 to typeXenonAbyss 47866). */
export const WEATHER_DESCRIPTION_BY_TYPE: Readonly<Record<number, string>> = Object.freeze({
  47862: "UI/Abyss/ExoticParticleStormDescription",
  47863: "UI/Abyss/DarkMatterFieldDescription",
  47864: "UI/Abyss/PlasmaFirestormDescription",
  47865: "UI/Abyss/ElectricalStormDescription",
  47866: "UI/Abyss/GammaRayAfterglowDescription",
});

/** abyss.common.constants.FILAMENT_PROXIMITY_RESTRICTION_RANGE, in metres. */
const FILAMENT_PROXIMITY_RESTRICTION_RANGE = 1_000_000;

/** An error's words and their arguments (abyss/error.py get_error_label). */
export function abyssErrorLabel([code, args]: AbyssErrorEntry): { readonly label: string; readonly args: Record<string, number | string> } {
  const E = ABYSS_ERROR;
  const plain = (label: string) => ({ label, args: {} });
  switch (code) {
    case E.ABYSS_CONTENT_ACTIVE: return plain("UI/Abyss/Error/AbyssContentActive");
    case E.IN_ABYSS_SYSTEM: return plain("UI/Abyss/Error/InAbyssSystem");
    case E.INVALID_KEY_TYPE: return plain("UI/Abyss/Error/InvalidKeyType");
    case E.INVALID_OWNER: return plain("UI/Abyss/Error/InvalidOwner");
    case E.INVALID_SHIP_TYPE: return plain("UI/Abyss/Error/InvalidShipType");
    case E.ITEM_NOT_REACHABLE: return { label: "UI/Abyss/Error/ItemNotReachable", args: { type: args[0] ?? 0 } };
    case E.KEY_NOT_FOUND: return plain("UI/Abyss/Error/KeyNotFound");
    case E.PROXIMITY_RESTRICTION:
      return { label: "UI/Abyss/Error/ProximityRestriction", args: { distance: FILAMENT_PROXIMITY_RESTRICTION_RANGE, type: args[0] ?? 0 } };
    case E.PVP_TIMER_ACTIVE: return plain("UI/Abyss/Error/PvpTimerActive");
    case E.SAFETY_ENGAGED: return plain("UI/Abyss/Error/SafetyEngaged");
    case E.SESSION_CHANGE_IN_PROGRESS: return plain("UI/Abyss/Error/SessionChangeInProgress");
    case E.SHIP_IN_DUNGEON: return plain("UI/Abyss/Error/ShipInDungeon");
    case E.SHIP_IN_FORCE_FIELD: return plain("UI/Abyss/Error/ShipInForceField");
    case E.SHIP_IN_WARP: return plain("UI/Abyss/Error/ShipInWarp");
    case E.SHIP_IS_CLOAKED: return plain("UI/Abyss/Error/ShipIsCloaked");
    case E.SHIP_IS_DOCKED: return plain("UI/Abyss/Error/ShipIsDocked");
    case E.SHIP_IS_INVULNERABLE: return plain("UI/Abyss/Error/ShipIsInvulnerable");
    case E.SHIP_IS_SELF_DESTRUCTING: return plain("UI/Abyss/Error/ShipIsSelfDestructing");
    case E.SHIP_IS_TETHERED: return plain("UI/Abyss/Error/ShipIsTethered");
    case E.SHIP_IS_WARP_SCRAMBLED: return plain("UI/Abyss/Error/ShipIsWarpScrambled");
    case E.SHIP_NOT_FOUND: return plain("UI/Abyss/Error/ShipNotFound");
    case E.SHIP_NOT_IN_FLEET: return plain("UI/Abyss/Error/PlayerNotInFleet");
    case E.INVALID_SHIP_TYPE_THREE_PLAYER: return plain("UI/Abyss/Error/InvalidShipTypeFleet");
    case E.SHIP_NOT_IN_SAME_FLEET: return plain("UI/Abyss/Error/PlayerNotInSameFleet");
    case E.SHIP_HAS_ENTERED: return plain("UI/Abyss/Error/HasEntered");
    case E.MAX_ENTERED: return plain("UI/Abyss/Error/MaxEntered");
    case E.ENTRANCE_CLOSED: return plain("UI/Abyss/Error/EntranceClosed");
    case E.PROXIMITY_ENTRANCE: return { label: "UI/Abyss/Error/ProximityEntrance", args: { distance: args[0] ?? 0 } };
    case E.ENTRANCE_MISSING: return plain("UI/Abyss/Error/AbyssalEntranceMissing");
    case E.POCKET_COLLAPSING: return plain("UI/Abyss/Error/PocketCollapsing");
    case E.INVALID_KEY_AMOUNT: return { label: "UI/Abyss/Error/AdditionalFilamentsNeeded", args: { amount: args[0] ?? 0 } };
    case E.CONGESTION_BAN: return plain("UI/PVPFilament/Errors/filamentCongestionBan");
    case E.INVALID_SHIP_TYPE_TWO_PLAYER: return plain("UI/Abyss/Error/InvalidShipTypeTwoPlayer");
    case E.VOID_SPACE_DISALLOWED: return plain("UI/VoidSpace/Error/InVoidSpaceSystem");
    case E.VERY_SECURE_SYSTEM_DISALLOWED: return plain("UI/Abyss/Error/SystemRestriction");
    case E.IN_BANNED_SYSTEM: return plain("UI/Abyss/Error/InBannedSystem");
    default: return plain("UI/Abyss/Error/UnknownError");
  }
}

/** Every label an error may be said in, for the words store to fetch before the window needs them. */
export function abyssErrorLabels(): string[] {
  return [...new Set(Array.from({ length: 38 }, (_, code) => abyssErrorLabel([code, []]).label))];
}

/** abyss/common/suspicion.py FILAMENT_ACTIVATION_NOT_ALLOWED and FILAMENT_ACTIVATION_UNRESTRICTED. */
export const FILAMENT_ACTIVATION_NOT_ALLOWED = -405;
export const FILAMENT_ACTIVATION_UNRESTRICTED = 200;
const MAX_TIER_ALLOWED_BY_DECA_SECURITY_RANGE: Readonly<Record<number, number>> = Object.freeze({ 10: 0, 9: 0, 8: 3, 7: 4, 6: 5, 5: 6 });

/**
 * suspicion.get_max_allowed_tier_by_security_level: the highest tier a filament may have where the system's security
 * is this, without the pilot being made a suspect. _deca_security_range is int(round(security, 1) * 10), Python 2's
 * round, which goes by the double's exact value and away from nought at a half (0.85 is a little under, so 0.8, and 3;
 * 0.45 a little over, so 0.5, and 6). toFixed rounds the same way.
 */
export function maxAllowedTierBySecurity(security: number): number {
  const clamped = security > 0 && security < 0.05 ? 0.05 : security;
  const rounded = Number(Math.abs(clamped).toFixed(1)) * Math.sign(clamped);
  return MAX_TIER_ALLOWED_BY_DECA_SECURITY_RANGE[Math.trunc(rounded * 10)] ?? FILAMENT_ACTIVATION_UNRESTRICTED;
}

/** What the page knows of where a filament is (baseCheckers.IsInPilotLocation; itemCheckers.IsInPilotLocation). */
export type FilamentPlace = "ship" | "shipHangar" | "dockedHangar" | "elsewhere";

/** itemCheckers.OfferActivateAbyssalKey: a filament, the pilot's own, where the pilot is. */
export function offersActivateAbyssalKey(groupID: number | null, ownedByPilot: boolean, place: FilamentPlace): boolean {
  return groupID === GROUP_ABYSSAL_KEYS && ownedByPilot && (place === "ship" || place === "dockedHangar");
}

/** What the client's checks look at, as the page knows it; null where the page does not know it yet. */
export interface DeployFacts {
  readonly solarSystemID: number | null;
  /** The system's security (securitySvc.get_modified_security_level). */
  readonly security: number | null;
  readonly docked: boolean;
  /** The ship's type, or null where there is no ship (SHIP_NOT_FOUND). */
  readonly shipTypeID: number | null;
  /** The type lists that hold the ship's type, of those the modes name; null where not read. */
  readonly shipTypeLists: readonly number[] | null;
  readonly inWarp: boolean;
  readonly cloaked: boolean;
  readonly selfDestructing: boolean;
  /** The PvP timer's state (crimewatchSvc.GetPvpTimer); null where not read. */
  readonly pvpTimerState: number | null;
  /** The ship's safety level (crimewatchSvc.GetSafetyLevel); null where not read. */
  readonly safetyLevel: number | null;
  readonly sessionChangeInProgress: boolean;
  readonly inFleet: boolean | null;
  readonly key: { readonly groupID: number | null; readonly ownedByPilot: boolean; readonly quantity: number };
  /** The filament's tier (attribute 2761); null where not read. */
  readonly keyTier: number | null;
}

/** BaseValidator.is_in_secure_system. */
function isInSecureSystem(facts: DeployFacts): boolean {
  if (facts.security === null) return false;
  const maxTier = maxAllowedTierBySecurity(facts.security);
  if (maxTier === FILAMENT_ACTIVATION_NOT_ALLOWED) return true;
  if (maxTier !== 0) return false;
  return facts.keyTier !== null && facts.keyTier > 0;
}

/** BaseValidator.is_suspicious: a filament of a higher tier than the system allows. */
export function isSuspicious(security: number | null, keyTier: number | null): boolean {
  if (security === null || keyTier === null) return false;
  const maxTier = maxAllowedTierBySecurity(security);
  if (maxTier === FILAMENT_ACTIVATION_NOT_ALLOWED) return false;
  return keyTier > maxTier;
}

const within = (id: number | null, [low, high]: readonly [number, number]): boolean => id !== null && id >= low && id <= high;

/**
 * ClientValidator.validate_deploy's errors, in the order the client finds them (perform_base_validation_checks, then
 * perform_deploy_validation_checks). What the client's own validator answers False to it answers so here too: the
 * congestion ban, an active encounter, a force field, warp scrambling, a dungeon, a filament out of reach, and the
 * proximity restriction (validator.py, the ClientValidator's is_in_banned_system, is_in_active_encounter,
 * is_in_force_field, is_warp_scrambled, is_blocked_by_dungeon, is_item_reachable and get_closest_of_type). The
 * tether and the invulnerability timer the page does not know yet; the server checks both.
 */
export function validateDeploy(facts: DeployFacts, mode: AbyssGameMode): AbyssErrorEntry[] {
  const errors: AbyssErrorEntry[] = [];
  const add = (code: number, ...args: (number | string)[]) => errors.push([code, args]);
  const demo = facts.keyTier === TIER_0_DEMO;
  if (isInSecureSystem(facts)) add(ABYSS_ERROR.VERY_SECURE_SYSTEM_DISALLOWED);
  if (within(facts.solarSystemID, VOID_SYSTEMS)) add(ABYSS_ERROR.VOID_SPACE_DISALLOWED);
  if (facts.shipTypeID === null) {
    add(ABYSS_ERROR.SHIP_NOT_FOUND);
  } else if (facts.shipTypeLists !== null && !facts.shipTypeLists.includes(mode.allowedShipsListID)) {
    add(mode.shipRestrictionError);
  }
  if (facts.docked) add(ABYSS_ERROR.SHIP_IS_DOCKED);
  if (facts.cloaked) add(ABYSS_ERROR.SHIP_IS_CLOAKED);
  if (facts.pvpTimerState !== null && facts.pvpTimerState !== PVP_TIMER_STATE_IDLE) add(ABYSS_ERROR.PVP_TIMER_ACTIVE);
  if (facts.selfDestructing) add(ABYSS_ERROR.SHIP_IS_SELF_DESTRUCTING);
  if (facts.inWarp) add(ABYSS_ERROR.SHIP_IN_WARP);
  if (within(facts.solarSystemID, ABYSSAL_SYSTEMS)) add(ABYSS_ERROR.IN_ABYSS_SYSTEM);
  if (facts.sessionChangeInProgress) add(ABYSS_ERROR.SESSION_CHANGE_IN_PROGRESS);
  // _is_in_banned_system: eveuniverse.solar_systems.is_abyssal_filament_restricted, a hazard system, which is Zarzakh.
  if (facts.solarSystemID === SOLAR_SYSTEM_ZARZAKH) add(ABYSS_ERROR.IN_BANNED_SYSTEM);
  // perform_deploy_validation_checks: the fleet, the filament, the proximity (none, the client's), the safety.
  if (mode.maxPlayers > 1 && facts.inFleet === false) add(ABYSS_ERROR.SHIP_NOT_IN_FLEET);
  if (facts.key.groupID !== GROUP_ABYSSAL_KEYS) add(ABYSS_ERROR.INVALID_KEY_TYPE);
  if (!facts.key.ownedByPilot) add(ABYSS_ERROR.INVALID_OWNER);
  if (facts.key.quantity < mode.keyStackSize) add(ABYSS_ERROR.INVALID_KEY_AMOUNT, mode.keyStackSize);
  if (!demo && isSuspicious(facts.security, facts.keyTier) && facts.safetyLevel === SHIP_SAFETY_LEVEL_FULL) add(ABYSS_ERROR.SAFETY_ENGAGED);
  return errors;
}

// THE POCKET'S TIMER (abyss/client/abyssal_service.py): the server's OnAddExpiryDurationForAbyssalContent(end_time)
// sets the combat timers' Abyssal one (crimewatchTimers.SetAbyssalTimer: red, its tooltip
// AbyssalContentExpiryTooltip, deleted when it runs out) and schedules the collapse's warnings 300, 120 and 30
// seconds before the end, each the HUD's passing indication for eight seconds (ABYSSAL_COLLAPSE_NOTIFICATION_TIMERS_
// SECONDS, EXPIRATION_INDICATION_DURATION, _display_expiry_message); OnAbyssalContentFinished clears the warnings,
// and the timers' own OnAbyssalContentFinished deletes the timer (crimewatchTimers.py 515 to 520).

/** ABYSSAL_COLLAPSE_NOTIFICATION_TIMERS_SECONDS, in the order the client schedules them. */
export const ABYSSAL_COLLAPSE_WARNING_SECONDS: readonly number[] = Object.freeze([300, 120, 30]);
/** EXPIRATION_INDICATION_DURATION: eight seconds. */
export const EXPIRATION_INDICATION_MS = 8_000;
export const ABYSS_POCKET_LABELS = Object.freeze({
  collapseHeader: "UI/Abyss/AbyssalCollapseWarningHeader",
  collapseSubject: "UI/Abyss/AbyssalCollapseWarningSubject",
  timerTooltip: "UI/Crimewatch/Timers/AbyssalContentExpiryTooltip",
});

/** The clock's 100 ns ticks at the start of Unix time. */
const FILETIME_OF_UNIX_EPOCH = 116_444_736_000_000_000n;

/** OnAddExpiryDurationForAbyssalContent's end_time (the game's clock, 100 ns ticks) in Unix milliseconds; null for none. */
export function abyssalExpiryMs(value: unknown): number | null {
  const ticks = typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : unwrapLong(value);
  if (ticks === null || ticks <= FILETIME_OF_UNIX_EPOCH) return null;
  return Number((ticks - FILETIME_OF_UNIX_EPOCH) / 10_000n);
}

/** An entry's parts, from a tuple or a list as the wire carries either. */
function itemsOf(value: JsonValue | undefined): readonly JsonValue[] | null {
  if (Array.isArray(value)) return value;
  if (isListValue(value)) return value.items;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const items = (value as { items?: unknown }).items;
    if (Array.isArray(items)) return items as JsonValue[];
  }
  return null;
}

/**
 * The errors an AbyssError says (its dict's 'errors': a list of (error, args)), as BaseActivationController.Activate
 * puts them on the button; null for a refusal that is no AbyssError.
 */
export function abyssErrorsOfRefusal(refusal: { readonly key: string; readonly values: JsonValue | null } | null): AbyssErrorEntry[] | null {
  if (refusal === null || refusal.key !== "AbyssError") return null;
  const values = refusal.values;
  const listed = readDictEntry(values, "errors")
    ?? (typeof values === "object" && values !== null && !Array.isArray(values) ? (values as Record<string, JsonValue>).errors : undefined);
  const entries = itemsOf(listed) ?? [];
  return entries.flatMap((entry): AbyssErrorEntry[] => {
    const parts = itemsOf(entry);
    if (parts === null || typeof parts[0] !== "number") return [];
    const args = (itemsOf(parts[1]) ?? []).filter((arg): arg is number | string => typeof arg === "number" || typeof arg === "string");
    return [[parts[0], args]];
  });
}

/**
 * Deploys a filament (abyssal_service.deploy_entrance_gate): RemoteSvc('abyssalMgr').AbyssalEntranceDeployment(item_id,
 * game_mode_id), by the service's name. Solo's is a session change, kept by the BFF as the client's session manager
 * keeps one (bridgeCallPolicy.js, PAGE_PLACE_CHANGE_CALLS): the call coming back is the session in the pocket.
 */
export async function deployEntranceGate(act: Ask, itemID: number, gameModeID: GameModeID): Promise<void> {
  if (!Number.isSafeInteger(itemID) || itemID <= 0) throw new Error("That filament could not be identified.");
  if (!(gameModeID in GAME_MODES)) throw new Error("That is no game mode of the client's.");
  await act("abyssalMgr", "AbyssalEntranceDeployment", [itemID, gameModeID]);
}
