// R31 — the server's refusal, in the player's language.
//
// ⚠ THIS IS THE ONLY PLACE A REFUSAL BECOMES WORDS. Every verb that can be
// turned down routes through `refusalWords`/`describeRefusal`; nothing else in
// the app is allowed to interpolate a raw server string into a sentence a
// player reads. R9a — plain player language, never codes or jargon — was being
// violated in the one place a player is most likely to look, and the fix has to
// be a seam rather than a patch at each of the fifteen call sites.
//
// ── WHERE THIS VOCABULARY CAME FROM (measured, not invented) ────────────────
//
// R28 set the precedent: its skill-queue table is EXACTLY the gateway's own
// eleven-code allowlist, pinned by a test. Movement has no such allowlist —
// there are only two code tables in `evejsWebGatewayRuntime.js`
// (PUBLIC_SKILL_QUEUE_ERROR_CODES and PUBLIC_PI_RESTART_ERROR_CODES) and BOTH
// gate the offline character-command path, not `/call`. So the bound had to be
// derived a different way, and it was derived like this:
//
//   1. WEB_CALL_ALLOWLIST (evejsWebGatewayRuntime.js:88) says which
//      (service, method) pairs a browser can dispatch at all. For the verbs
//      that can be refused in flight that is beyonce.Cmd* , dogmaIM.*,
//      ship.Board/Undock/LaunchDrones/ScoopDrone and invbroker.*.
//   2. Every `throwWrappedUserError("<Name>", …)` site inside the handlers
//      those pairs reach was enumerated (beyonceService.js, dogmaService.js,
//      shipService.js, structureDockingService.js) and attributed to its
//      enclosing handler, so unreachable names were excluded rather than
//      guessed at — Handle_CreateNewbieShip, Handle_InitiateModuleRepair, the
//      overload / probe-launch / bookmark / fleet-bridge helpers and
//      Handle_Scoop are all real UserError sites that this client CANNOT
//      provoke, and none of them is in the table below.
//   3. That leaves the 24 bare codes and 2 localization labels in
//      SERVER_REFUSALS. The list is asserted in refusals.test.ts.
//
// ── HOW A REFUSAL ARRIVES ──────────────────────────────────────────────────
//
// `readWrappedUserErrorRefusal` (evejsWebGatewayRuntime.js:1232) reads ONLY the
// `info` and `notify` keys of the UserError dict and otherwise falls through to
// the bare code. That produces exactly three shapes on the wire, and the table
// is built around those three and nothing else:
//
//   a. PROSE — the handler's own sentence, e.g. "Your ship cannot warp while an
//      active module is preventing movement." This is ALREADY plain player
//      language and is passed through untouched. Translating it would be us
//      talking over the server.
//   b. A BARE CODE — e.g. `DockingApproach`, `TargetTooFar`. The dicts these
//      carry (`distance`, `reason`, `remainingTime`) are dropped by the gateway,
//      so the code is genuinely all we get.
//   c. A LOCALIZATION TUPLE — `101,UI/Menusvc/MenuHints/NotWithingMaxJumpDist`.
//      The `101,` prefix is NOT a protocol field: the handler throws
//      `CustomInfo {info: [101, "UI/..."]}` and the gateway does
//      `String(proseEntry[1])`, so a JS array is comma-joined on its way out.
//      101 is `carbon.common.lib.const.UE_LOC`, retail's "this is a
//      localization key" marker; the real client substitutes localized text for
//      it and we have no such table, which is why the raw key reached the
//      player. `Withing` is CCP's own typo and is reproduced faithfully here
//      because matching the server's string is the whole job.
//
// Only TWO of these tuples can reach us — both from `_throwStargateJumpUserError`
// (beyonceService.js:1701, :1706). The two other `[101, path]` tuples in eve.js
// (ShipTooLarge, InsufficientRoles) sit under a `reason` key the gateway never
// reads, so they arrive as a bare code with the label discarded.
//
// ── THE RULES THIS FILE OBEYS ──────────────────────────────────────────────
//
// • A refusal is NEVER swallowed. This changes the wording, never the fact that
//   the action did not happen — every caller still renders a failure.
// • Nothing is translated in the BFF. The raw server text keeps flowing over
//   the wire unchanged (`src/server.js` passes CALL_REFUSED through untouched);
//   this is a browser-side presentation concern, and putting it here is what
//   keeps the wording inside reach of the tests that pin it.
// • A reason is NEVER invented. Where the server's own meaning is a bare
//   "it failed and here is no cause" — `DeniedTargetingAttemptFailed` is
//   literally the `default:` arm of the targeting switch — the sentence says
//   something true and non-specific instead of a confident guess.
// • An UNRECOGNISED refusal still reads as a sentence. It is not dumped raw at
//   the player; the raw text stays recoverable as `Refusal.detail`.

/** A server refusal, split into what the player reads and what a diagnostician needs. */
export interface Refusal {
  /**
   * The sentence to show. Never a code, a resource path or an identifier —
   * `isPlainPlayerLanguage(text)` is true for every value this can produce.
   */
  readonly text: string;
  /**
   * The server's own words, verbatim, when `text` is NOT them — i.e. when we
   * translated a code or fell back. Null when the server already spoke plainly
   * and `text` IS its sentence, because there is then nothing extra to recover.
   */
  readonly detail: string | null;
}

// --- The vocabulary ---------------------------------------------------------

/**
 * eve.js's own refusal vocabulary, keyed by the exact string that arrives as the
 * CALL_REFUSED message. Two localization tuples, then the bare UserError codes
 * in alphabetical order. Each comment names the server-side condition the
 * wording is derived from, so a reader can check the sentence against the cause
 * rather than trusting it.
 */
const SERVER_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  // beyonceService `_throwStargateJumpUserError` — TOO_FAR_FROM_STARGATE.
  "101,UI/Menusvc/MenuHints/NotWithingMaxJumpDist":
    "That gate is too far away to jump through. Get closer to it first.",
  // beyonceService `_throwStargateJumpUserError` — STARGATE_NOT_ACTIVE.
  "101,UI/GateIcons/GateClosed":
    "That gate is closed. Nothing can jump through it right now.",

  // beyonce Handle_CmdWarpToStuff — the bookmark is gone or not yours.
  BookmarkNotAvailable:
    "That bookmark is not available to you, so the ship cannot warp to it.",
  // dogma `_throwModuleOnlineUserError` — MAX_GROUP_ONLINE.
  CannotOnlineReachedMaxGroupOnline:
    "Your ship already has as many modules of that kind online as it is allowed.",
  // dogma `_throwModuleActivationUserError` — MODULE_DISALLOWED_IN_HIGHSEC.
  CantInHighSecSpace:
    "That module cannot be used in high-security space.",
  // dogma `_throwModuleOnlineUserError` — CRP_ACCESS_DENIED.
  CrpAccessDenied:
    "Your corporation roles do not let you do that.",
  // dogma `_throwModuleActivationUserError` — CANNOT_ACTIVATE_IN_WARP.
  DeniedActivateInWarp:
    "That module cannot be used while the ship is in warp. Wait until it lands.",
  // dogma `_throwModuleActivationUserError` — TARGET_NOT_FOUND.
  DeniedActivateTargetNotPresent:
    "The target is no longer there, so the module was not activated.",
  // beyonce / dogma / structure docking — NOT_IN_SPACE, SHIP_NOT_FOUND,
  // SHIP_ID_MISMATCH, WRONG_SOLAR_SYSTEM, MODULE_NOT_FOUND. The command was
  // aimed at a ship or a place that is no longer the one you are in.
  DeniedShipChanged:
    "Your ship is no longer where that command expected it. Check where you are and try again.",
  // dogma targeting / activation — TARGET_WARPING.
  DeniedTargetOtherWarping:
    "That target is warping away, so it cannot be locked or shot.",
  // dogma targeting / activation — TARGET_SELF.
  DeniedTargetSelf:
    "You cannot do that to your own ship.",
  // dogma targeting / activation — SOURCE_WARPING.
  DeniedTargetSelfWarping:
    "Your ship is in warp, so it cannot lock or shoot anything. Wait until it lands.",
  // dogma `_throwTargetingUserError` DEFAULT arm — the lock failed and the
  // server named no cause. Saying anything specific here would be a guess.
  DeniedTargetingAttemptFailed:
    "The lock did not take, and the server did not say why.",
  // beyonce Handle_CmdDock / structure docking — out of docking range. The
  // server has ALREADY started closing the distance itself (it converts the
  // dock into a followBall to 2,500 m), which is why this says "closing in"
  // rather than telling the player to fly there.
  DockingApproach:
    "You are too far from the station to dock. Your ship is closing in — try docking again once it arrives.",
  // beyonce / structure docking — module blocks docking, ship excluded, ship
  // too large, structure access denied. Six distinct server reasons collapse to
  // this one code on the wire (their prose sits under a `reason` key the
  // gateway does not read), so the sentence must NOT name one of them.
  DockingRequestDenied:
    "Docking was refused. Something about your ship or that station is not allowing it right now.",
  // dogma `_throwModuleActivationUserError` — MODULE_ALREADY_ACTIVE.
  EffectAlreadyActive2:
    "That module is already running.",
  // dogma `_throwModuleActivationUserError` — MAX_GROUP_ACTIVE.
  EffectCrowdedOut:
    "Your ship already has as many modules of that kind running as it is allowed.",
  // dogma `_throwModuleActivationUserError` — MODULE_REACTIVATING.
  ModuleReactivationDelayed2:
    "That module is still cooling down from its last cycle. Give it a moment.",
  // dogma `_throwModuleActivationUserError` — NO_AMMO.
  NoCharges:
    "That module has no ammunition loaded. Load some before using it.",
  // dogma `_throwModuleOnlineUserError` — NOT_ENOUGH_CPU / POWER / CAPACITOR.
  // The code names capacitor but the arm covers all three fittings resources,
  // so the sentence covers what the arm covers rather than what the code says.
  NotEnoughCapacitorForOnline:
    "Your ship does not have enough power, CPU or capacitor to bring that module online.",
  // dogma `_throwModuleActivationUserError` — TARGET_OUT_OF_RANGE for anything
  // that is not a mining laser.
  TargetNotWithinRangeGeneric:
    "That target is out of the module's range. Get closer and try again.",
  // dogma targeting / mining lasers / invbroker — TARGET_OUT_OF_RANGE.
  TargetTooFar:
    "That is too far away. Get closer and try again.",
  // beyonce jump (STARGATE_NOT_FOUND / DESTINATION_MISMATCH), dogma targeting
  // (TARGET_NOT_FOUND), structure docking (STRUCTURE / STATION_NOT_FOUND).
  TargetingAttemptCancelled:
    "What that command was aimed at is not there any more, so it was cancelled.",
  // dogma `_throwTargetingUserError` — TARGET_LOCK_LIMIT_REACHED.
  TargetingSystemsAlreadyFullyUtilized:
    "Your ship is already locking as many targets as it can hold. Release one first.",
  // beyonce `_enforceMovementCommandThrottle` — the same movement command
  // inside 1,000 ms. The remainingTime the server sends is dropped by the
  // gateway, so we cannot tell the player how long, and do not pretend to.
  ThrottleGeneric:
    "That command came too soon after the last one. Wait a moment and try again.",
  // beyonce `_throwWarpFailureUserError` — WARP_DISRUPTED_BY_BUBBLE.
  WarpDisrupted:
    "Something is holding your ship in place, so it cannot warp.",
});

/**
 * The transport and request-shape failures the BFF and this client raise, keyed
 * by the wire `error` code (docs/bridge-wire-contract.md, `BridgeErrorCode` in
 * wire.ts, and the codes `src/server.js` returns from the flight-family routes).
 *
 * These are not the game refusing — they are the pipe. A player still has to
 * learn the action did not happen, and SCREAMING_SNAKE is no more player
 * language than camelCase is.
 *
 * ⚠ CALL_REFUSED IS DELIBERATELY ABSENT. It is the envelope that CARRIES a
 * server refusal, never a reason in itself; if it were here it would shadow the
 * real reason in the message (see the candidate ordering in `describeRefusal`).
 */
const BRIDGE_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  // --- eve.js gateway (evejsWebGatewayRuntime.js) ---
  CALL_FAILED: "The game server hit an error carrying that out.",
  CALL_NOT_ALLOWED: "This client is not allowed to ask the game server for that.",
  CALL_INVALID: "The game server could not make sense of that request.",
  CALL_SERVICE_UNAVAILABLE: "That part of the game server is not available right now.",
  GATEWAY_RUNTIME_NOT_READY: "The game server is still starting up. Try again shortly.",
  UNAUTHORIZED: "The game server did not accept this session.",

  // --- BFF transport (src/server.js) ---
  EVE_GATEWAY_UNREACHABLE: "The game server could not be reached.",
  EVE_GATEWAY_TIMEOUT: "The game server did not answer in time.",
  AUTH_REQUIRED: "You are signed out. Sign in again to carry on.",
  NO_LIVE_SESSION: "No character is online. Pick a character first.",
  SESSION_NOT_FOUND: "The live session ended. Pick your character again.",

  // --- BFF request checks on the flight-family routes ---
  ALREADY_IN_SPACE: "Your ship is already in space.",
  NOT_IN_SPACE: "Your ship is docked. Undock before doing that.",
  NOT_DOCKED: "Your ship is in space. That can only be done while docked.",
  NO_ACTIVE_SHIP: "You are not in a ship right now.",
  NO_DRONES: "There are no drones in the bay to launch.",
  NOTHING_SELECTED: "Nothing was selected to act on.",
  INVALID_GATE: "That gate could not be identified.",
  INVALID_STATION: "That station could not be identified.",
  INVALID_MODULE: "That module could not be identified.",
  INVALID_SHIP: "That ship could not be identified.",
  INVALID_TARGET: "That target could not be identified.",
  INVALID_RANGE: "That distance is not one the ship can be told to hold.",
  CHARACTER_NOT_FOUND: "Your character could not be read.",
  STATION_NOT_FOUND: "That station could not be found.",

  // --- client-side, never reaches the server (callMethod.ts) ---
  BRIDGE_NETWORK_ERROR: "The connection to the server dropped. Check it and try again.",
  BRIDGE_BAD_RESPONSE: "The server's answer could not be read.",
});

// --- R33: the refusals we can see coming ------------------------------------
//
// ⚠ THESE ARE NOT WIRE STRINGS, and they are deliberately NOT in
// SERVER_REFUSALS. That table is the vocabulary of refusals that ARRIVE, pinned
// key-for-key against the codes a browser call can provoke; putting a sentence
// there that no wire message maps to would corrupt the one table whose value is
// that it matches the server exactly.
//
// This is the other half of the same job. A PREDICTED refusal is one the client
// can source from a field it already holds, BEFORE the player presses anything
// — so the control renders disabled wearing the reason instead of inviting a
// press that goes nowhere. The wording lives here for the same reason every
// other refusal's does: refusals.ts is the only place in this app where "the
// action will not happen" becomes words a player reads, and a sentence kept
// anywhere else drifts out of reach of the R9a sweep that pins it.
//
// ⚠ THE BAR FOR ADDING ONE IS A SERVER GATE YOU CAN POINT AT, not a hunch. If
// the client cannot tell, the control STAYS ENABLED and the server's own
// refusal answers — a disabled button asserting a reason we cannot source is a
// worse failure than an enabled one that gets a true answer.

/**
 * A drone your ship is not flying (goal R33).
 *
 * SOURCED FROM: `droneRuntime.js` refuses every drone order — recall, engage,
 * mine, salvage, abandon; five call sites, one condition — unless
 * `droneEntity.controllerID === shipRecord.itemID`. The server's own words for
 * it are "That drone is not currently under this ship's control."; this says
 * the same thing in the second person, because we are saying it BEFORE the
 * press rather than relaying an answer.
 *
 * ⚠ IT NAMES NO REMEDY, on purpose. Regaining control is
 * `entity.CmdReconnectToDrones`, which is NOT in the gateway's
 * WEB_CALL_ALLOWLIST — this client cannot dispatch it. Telling a player to
 * reconnect would be sending them after a button that does not exist here, and
 * an invented remedy is the same failure as an invented reason.
 */
export const DRONE_NOT_UNDER_YOUR_CONTROL = "Your ship is not flying this drone";

/** The same fact about a whole flight, for the group order (goal R33). */
export const NO_DRONE_UNDER_YOUR_CONTROL = "Your ship is not flying any of these drones";

/** Every predicted refusal this client can put on a control. Exported for the tests. */
export const PREDICTED_REFUSAL_TEXTS: readonly string[] = Object.freeze([
  DRONE_NOT_UNDER_YOUR_CONTROL,
  NO_DRONE_UNDER_YOUR_CONTROL,
]);

/** Every server refusal string this client explains in words. Exported for the tests. */
export const SERVER_REFUSAL_KEYS: readonly string[] = Object.freeze(
  Object.keys(SERVER_REFUSALS),
);

/** Every bridge/transport code this client explains in words. Exported for the tests. */
export const BRIDGE_REFUSAL_CODES: readonly string[] = Object.freeze(
  Object.keys(BRIDGE_REFUSALS),
);

/**
 * What the player is told when the refusal is one we have never seen.
 *
 * It says two true things — it was refused, and we cannot put the reason into
 * words — and it invents nothing. The raw text rides along as `Refusal.detail`
 * so a bug report can still carry it.
 */
export const UNKNOWN_REFUSAL_TEXT =
  "The server turned that down without a reason this client can put into words.";

/** What the player is told when the refusal carries no text at all. */
export const SILENT_REFUSAL_TEXT = "The server turned that down without saying why.";

// --- Is this a sentence, or is it jargon? -----------------------------------

/**
 * True when `text` is something a player can read — the R9a predicate.
 *
 * ⚠ THIS IS LOAD-BEARING TWICE, on purpose. At runtime it decides whether an
 * UNRECOGNISED refusal is the server speaking plainly (pass it through — over
 * 130 handlers refuse with a real sentence via CustomNotify, and rewording
 * those would be us talking over the server) or jargon (fall back, keep the raw
 * as detail). In the tests it is the sweep that proves no rendered refusal can
 * regress into a code. One predicate means the two can never disagree.
 *
 * It is deliberately conservative: anything it cannot vouch for is treated as
 * jargon, because showing a clean fallback for a real sentence is a much
 * smaller failure than showing a resource key to a player.
 */
export function isPlainPlayerLanguage(text: string): boolean {
  const value = text.trim();
  if (value === "") {
    return false;
  }
  // A single token is a name, not a sentence — no player writes `DockingApproach`.
  if (!/\s/.test(value)) {
    return false;
  }
  // A resource path: `UI/Menusvc/MenuHints/...`, `/Carbon/MachoNet/...`.
  if (/[A-Za-z]\/[A-Za-z]/.test(value)) {
    return false;
  }
  // The retail localization tuple leaking through as `101,UI/...`.
  if (/^\d+\s*,/.test(value)) {
    return false;
  }
  // SCREAMING_SNAKE — CALL_REFUSED, MISSING_MATERIAL, NOT_IN_SPACE.
  if (/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.test(value)) {
    return false;
  }
  // An identifier with an internal lower-to-upper hinge: `NotWithingMaxJumpDist`,
  // `destinationID`, `solarSystemID`. The two characters must be ADJACENT, so
  // this only ever fires inside a single word — which is why prose survives it:
  // "Heavy Interdictor" and "…try again. Get closer" both have a space or a
  // full stop at the hinge, and a proper noun has no hinge inside itself.
  if (/[a-z][A-Z]/.test(value)) {
    return false;
  }
  return true;
}

// --- The seam ---------------------------------------------------------------

/**
 * Split a raw refusal into the strings we might recognise.
 *
 * `flightErrorReason` and friends hand us either the bare wire message
 * (`DockingApproach`), the bare code (`NOT_IN_SPACE`), or the two joined
 * (`CALL_REFUSED: DockingApproach`). The whole string is tried first so a
 * genuine sentence containing a colon is not chopped up; then the part AFTER
 * the colon, so the server's specific reason beats the envelope; then the part
 * before it.
 */
function refusalCandidates(raw: string): string[] {
  const value = raw.trim();
  const separator = value.indexOf(":");
  if (separator < 0) {
    return [value];
  }
  return [
    value,
    value.slice(separator + 1).trim(),
    value.slice(0, separator).trim(),
  ];
}

/**
 * A server refusal, as a sentence plus the raw text behind it.
 *
 * `raw` is whatever the wire produced — the CALL_REFUSED message, a bridge
 * code, or the two joined with a colon. Nothing here throws and nothing here
 * returns an empty string: every input produces a sentence, because the caller
 * is going to show it to somebody.
 */
export function describeRefusal(raw: string): Refusal {
  const value = String(raw ?? "").trim();
  if (value === "") {
    return { text: SILENT_REFUSAL_TEXT, detail: null };
  }
  const candidates = refusalCandidates(value);
  for (const candidate of candidates) {
    const known = SERVER_REFUSALS[candidate] ?? BRIDGE_REFUSALS[candidate];
    if (known !== undefined) {
      return { text: known, detail: value };
    }
  }
  // Not in the table. If the server spoke plainly, those are its words and they
  // stand — we are not in the business of rewording a handler that already said
  // something a player can act on.
  //
  // ⚠ THE CANDIDATES ARE CHECKED, NOT JUST THE WHOLE STRING, and that is not a
  // nicety: the prose case almost always arrives with the wire envelope glued
  // to the front — `CALL_REFUSED: You do not have the required roles.` — and
  // testing only the whole string would see the SCREAMING_SNAKE prefix, call
  // the entire thing jargon, and throw away a perfectly good sentence the
  // server had already written for the player.
  for (const candidate of candidates) {
    if (isPlainPlayerLanguage(candidate)) {
      // No detail: the envelope is all that was dropped, and nothing a
      // diagnostician needs was lost.
      return { text: candidate, detail: null };
    }
  }
  // Jargon we do not recognise. The player gets a sentence; the raw text stays
  // recoverable rather than being thrown away OR shoved in their face.
  return { text: UNKNOWN_REFUSAL_TEXT, detail: value };
}

/**
 * The player-facing half of `describeRefusal`, with the raw text put where a
 * diagnostician can still find it.
 *
 * ⚠ THE CONSOLE LINE IS THE "RECOVERABLE" HALF OF R31, not a debug leftover.
 * The player reads prose; anyone chasing a refusal this table has never seen
 * reads exactly what the server said. It fires ONLY when the wording is not
 * already the server's own — `describeRefusal` returns a null detail when the
 * handler spoke plainly, and echoing a sentence we did not change is noise.
 *
 * This is the one impure function in this module on purpose: keeping the log
 * beside the translation is what stops the raw text being silently dropped at
 * one of the fifteen call sites. `describeRefusal` stays pure for the tests.
 */
export function refusalWords(raw: string): string {
  const refusal = describeRefusal(raw);
  if (refusal.detail !== null) {
    console.info(`[refusal] ${refusal.detail}`);
  }
  return refusal.text;
}
