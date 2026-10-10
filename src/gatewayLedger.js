"use strict";

/**
 * A tally of what the BFF asks the web gateway.
 *
 * The plan's cutover (docs/game-port-transport-plan.md, Phase 5) is done when the only gateway routes the BFF
 * calls are the account-level ones the plan lists (2.3). This counts every call made on the gateway client,
 * beneath the seam that sends a pilot to its transport, so that what it lists is what really went to the web
 * gateway: a pilot on the game port leaves no row of its own here.
 *
 * `counted(client)` answers the client's functions, each counted as it is called and then called as it was;
 * what the client has not got, the answer has not got either. A row is one function asked one way:
 *
 *   fn      the gateway client's function
 *   route   the gateway route it asks (ROUTES)
 *   pair    "service.method", for a call or a bind
 *   held    for a call or a bind: whether it named a session the gateway holds
 *   online  for a read of one character: whether that character was online on this BFF then
 *   calls   how many times
 *
 * `kindOf(row)` says what the plan makes of a row.
 */

/** The gateway route each of the client's functions asks (src/eveGatewayClient.js). */
const ROUTES = Object.freeze({
  getGatewayHealth: "/health",
  getStatus: "/status",
  getAccount: "/account",
  createAccount: "/account/create",
  listCharacters: "/characters",
  getSnapshot: "/snapshot",
  getSkills: "/skills",
  getCharacterStatus: "/character-status",
  saveOfflineSkillQueue: "/skill-queue",
  callMethod: "/call",
  bindObject: "/bound/bind",
  callBoundMethod: "/bound/call",
  selectCharacter: "/session/select",
  releaseBridgeSession: "/session/release",
  readFlightStatus: "/session/flight-status",
  readScannerState: "/session/scanner-state",
  readSpaceSnapshot: "/space/snapshot",
  openSessionEventStream: "/session-events",
  createChatSession: "the chat edge",
});

/** The pilot's nine (plan, 2.1): what a held pilot is reached through. */
const PILOT_FUNCTIONS = new Set(["selectCharacter", "callMethod", "bindObject", "callBoundMethod", "releaseBridgeSession", "readFlightStatus", "readScannerState", "readSpaceSnapshot", "openSessionEventStream"]);
/** Of those, the two that are also made with no session held: a call as a pilot who is not logged in (plan, 2.3). */
const MAY_BE_UNHELD = new Set(["callMethod", "bindObject"]);
/**
 * The account-level routes the plan keeps on the gateway for good (2.3). The snapshot of one character is among
 * them since 2026-10-10, when each of its call sites was read: the select's check that the account owns the
 * character, and the roster's planetary boards and haul, each of a pilot the retail protocol cannot be asked of.
 */
const ACCOUNT_ROUTES = new Set(["/health", "/status", "/account", "/account/create", "/characters", "/character-status", "/skills", "/skill-queue", "/snapshot"]);
/** Reads of one character, by where the character is among the arguments. */
const CHARACTER_AT = Object.freeze({ getSnapshot: 1, getSkills: 1, getCharacterStatus: 1, saveOfflineSkillQueue: 1 });
/** Of those, the ones the plan keeps for pilots who are not online: of a pilot who is, the pilot's own session is what the retail client asks. */
const OFFLINE_ONLY = new Set(["getSkills", "saveOfflineSkillQueue", "getSnapshot"]);

const KINDS = Object.freeze({
  pilot: "A held pilot's own. A pilot on the game port asks none of these; the cutover removes them.",
  unheld: "A call made as a pilot who is not logged in, with a session the BFF makes up. The retail protocol has no such thing; the plan lists which stay (2.3).",
  account: "Account-level, kept on the gateway for good (plan, 2.3).",
  online: "A read the plan keeps for pilots who are not online (a roster's board, the select's check), made here of a pilot who was online. The retail client asks the pilot's own session.",
  unlisted: "Not among the routes the plan keeps on the gateway (2.3). To be accounted for before the cutover is done.",
  chat: "The chat edge, which the retail client's chat speaks too. Not one of the web gateway's routes.",
});

/** What the plan makes of a row: one of KINDS' names. */
function kindOf(row) {
  if (row.fn === "createChatSession") return "chat";
  if (PILOT_FUNCTIONS.has(row.fn)) return MAY_BE_UNHELD.has(row.fn) && row.held === false ? "unheld" : "pilot";
  if (!ACCOUNT_ROUTES.has(row.route)) return "unlisted";
  return OFFLINE_ONLY.has(row.fn) && row.online === true ? "online" : "account";
}

/**
 * `isOnline(characterID)` says whether a character is online on this BFF now, on either transport; with none
 * given, nobody is known to be. `watch({ isOnline })` gives one later: the client is counted from the first, and
 * the BFF that knows who is online is made after it.
 */
function createGatewayLedger({ isOnline = () => null } = {}) {
  const rows = new Map();
  let onlineNow = isOnline;

  function note(fn, args) {
    const named = fn === "callMethod" || fn === "bindObject" || fn === "callBoundMethod";
    const pair = named ? `${args[0]}.${args[1]}` : null;
    const held = named ? Boolean(args[5]) : null;
    let online = null;
    if (Object.hasOwn(CHARACTER_AT, fn)) {
      const characterID = Number(args[CHARACTER_AT[fn]]);
      try {
        const known = Number.isSafeInteger(characterID) && characterID > 0 ? onlineNow(characterID) : null;
        online = known === true || known === false ? known : null;
      } catch {
        online = null;
      }
    }
    const key = `${fn}|${pair ?? ""}|${held}|${online}`;
    const row = rows.get(key) ?? { fn, route: ROUTES[fn] ?? null, pair, held, online, calls: 0 };
    row.calls += 1;
    rows.set(key, row);
  }

  return {
    /** The client's functions, each counted as it is called, however the call ends. What is no function is handed on as it is. */
    counted(client) {
      const counting = {};
      for (const [name, value] of Object.entries(client)) {
        counting[name] = typeof value !== "function" ? value : function counted(...args) {
          note(name, args);
          return value.apply(client, args);
        };
      }
      return counting;
    },
    watch({ isOnline: online }) {
      onlineNow = typeof online === "function" ? online : () => null;
    },
    /** Every row, the most called first, each with what the plan makes of it. */
    rows: () => [...rows.values()].map((row) => ({ ...row, kind: kindOf(row) })).sort((a, b) => b.calls - a.calls || `${a.fn} ${a.pair}`.localeCompare(`${b.fn} ${b.pair}`)),
    forget() {
      rows.clear();
    },
  };
}

module.exports = { KINDS, ROUTES, createGatewayLedger, kindOf };
