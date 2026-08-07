// The distribution-mission bot (goal R36) — the other half of automated play.
//
// THIS IS THE FIFTH INSTANCE OF ONE PATTERN, not a new one. R5b's autopilot,
// R13's measured ladder, R24's Dock and R26's mining bot are all the same shape,
// and so is this: a browser-side decide-loop that reads AUTHORITATIVE state each
// tick, issues AT MOST ONE atomic call, never simulates, bounds every branch,
// and PAUSES WITH A REASON rather than guessing.
//
// It runs in the BROWSER. Closing the tab is closing the client.
//
// ─── THE FLIGHT IS NOT REIMPLEMENTED HERE ────────────────────────────────────
//
// R26 shares `decideCloseIn` with the autopilot rather than copying it. This
// goes further, because a courier route is MULTI-SYSTEM and the autopilot
// already solves, sequences and bounds exactly that: warp, approach, jump,
// handoff, dock, with R24's warp dead band and silent-dock bound intact. So the
// mission bot does not own a flight ladder at all. It hands a destination to
// the SAME autopilot controller the Travel panel drives (`startTravel`) and then
// reads that controller's own status back (`getTravel`). One flight ladder, one
// set of bounds, one place any correction lands.
//
// ─── WHAT R35 MEASURED LIVE, AND WHY EACH LINE HERE IS SHAPED BY IT ──────────
//
// 1. `missionCompleted` is `null` ON A REFUSAL, NOT `false`. A refused Complete
//    returns HTTP 200, ok:true, an EMPTY actions list, and
//    `lastActionInfo.missionCompleted === null`. `=== true` is the ONLY safe
//    test — `!== false` reports every refusal as a success. See `completed()`.
//
// 2. `doAgentAction` returns `success: true` ON EVERY BRANCH
//    (agentMissionRuntime.js:6725-7092). So nothing here reads a call's own
//    answer to decide it worked. Every action is confirmed against the authority
//    that owns the fact:
//
//        requested a mission  -> the conversation's own actions list (an Accept)
//        accepted a mission   -> the JOURNAL row's state (ACCEPTED)
//        loaded the package   -> the SHIP'S CARGO rows
//        unloaded it          -> the STATION HANGAR rows
//        completed a mission  -> lastActionInfo.missionCompleted === true
//        flew somewhere       -> flight status (docked + stationID)
//
// 3. ACTION TOKENS ARE RE-MINTED ACROSS A MOVE (observed 815/816 -> 819/820 ->
//    821/822 for one agent). So no actionID is ever stored. The conversation is
//    re-opened and re-read in the SAME TICK that uses it, and `agentActionID()`
//    is the only way an id reaches a call. There is deliberately no field on
//    memory that could hold one.
//
// 4. AN EMPTY ACTIONS LIST IS NOT TERMINAL. It is location-dependent and it
//    RECOVERS — the same agent offered nothing at the pickup and Complete+Quit
//    at the dropoff. So "no actions" is never a stop; it is "not here, not now",
//    and the ladder carries on to whatever rung the rest of the state says.
//
// 5. JOURNAL DISAPPEARANCE IS AMBIGUOUS. `completeMission` deletes the row, and
//    quit, decline and expire delete it identically. So a MISSING row proves
//    nothing and is never read as success. A PRESENT row with a state is a
//    positive fact and is used as one; absence only ever means "no mission".
//
// 6. ACCEPT MUST BE IN PERSON. Remote accept is silently refused for couriers
//    (200 + the offered conversation back). The accept rung therefore requires
//    the ship to be docked at the AGENT'S station.
//
// 7. THE DROPOFF IS NOT NEARBY. `resolveDropoffStation` takes the corp's
//    LOWEST-solarSystemID station and every agent of a corp routes to the same
//    one, so routes are long (the live run was 6 jumps) and can cross lowsec.
//    The jump cap and the volume check are applied BEFORE Accept, never after —
//    see `gateOffer`.

import {
  isSessionChangeSettling,
  isTransitionTimeout,
  isTransportTransient,
  refusalWords,
} from "../bridge/refusals.ts";
import type { AutopilotStatus } from "./autopilotLoop.ts";
import type {
  AgentConversation,
  CapacityInfo,
  CourierBriefing,
  FlightStatus,
  InventoryItemRow,
  JournalState,
} from "../store/types.ts";

// --- The retail dialogue buttons this ladder acts on -------------------------
//
// Imported rather than redeclared: `bridge/agents.ts` already owns the mapping
// from retail's `agentMissionRuntime.js` constants, and two copies of a button
// number drifting apart would have the bot press Decline believing it was
// pressing Accept.
import { AGENT_BUTTON } from "../bridge/agents.ts";

// --- Thresholds and bounds ---------------------------------------------------

/** How often the loop re-decides. The autopilot's cadence, for the same reason. */
export const MISSION_BOT_CADENCE_MS = 2000;

/**
 * The default jump cap. The dropoff is the corp's lowest-`solarSystemID`
 * station, so a route is long by construction and may cross lowsec — a bot that
 * accepts anything commits an unattended ship to a trip the player never
 * sanctioned. Ten covers the R35 live run (6) with room, and the player sets it.
 */
export const DEFAULT_MAX_JUMPS = 10;

/** Settle windows — retail's `ignoreTimerCycles`, per action kind. */
const SETTLE_AGENT = 2;
const SETTLE_CARGO = 2;
const SETTLE_TRAVEL = 2;

/**
 * Consecutive Request decisions with the conversation still offering no
 * mission. `doAgentAction` answers success either way, so the only evidence a
 * Request landed is an OFFER appearing, and three tries without one is already
 * past "the last one did not take" (an agent with nothing to give — standings,
 * a replay timer, a decline cooldown — looks exactly like this).
 */
export const MAX_REQUEST_ATTEMPTS = 3;
/**
 * Consecutive Accept decisions with the JOURNAL still not showing the mission
 * accepted. This is the bound that catches R35's silent remote-accept refusal:
 * 200, the offered conversation back, and nothing accepted.
 */
export const MAX_ACCEPT_ATTEMPTS = 3;
/** Consecutive load decisions with the package still not in the ship's cargo. */
export const MAX_LOAD_ATTEMPTS = 3;
/** Consecutive unload decisions with the package still not in the hangar. */
export const MAX_UNLOAD_ATTEMPTS = 3;
/**
 * Consecutive Complete decisions with `missionCompleted` never coming back
 * `true`. THE bound this goal exists to get right: a refused Complete is a 200
 * with an empty actions list and a `null` flag, so without a counter the bot
 * presses Complete forever at a dropoff that will not take it.
 */
export const MAX_COMPLETE_ATTEMPTS = 3;
/**
 * Consecutive offers turned down because they failed one of the PLAYER's gates.
 *
 * ⚠ WATCHED LIVE (R39), AND IT IS THE ONE COUNTER THAT MUST SURVIVE ITS OWN
 * ALTERNATE. An agent whose every offer is out of range re-offers indefinitely,
 * so the ladder runs request -> offer -> gate refuses -> decline -> request, and
 * every other counter in `bound()` is cleared by any non-wait action — so a
 * decline counter reset by the Request that follows it would bound nothing at
 * all. Only ACCEPTING something clears this one.
 *
 * This is not a harmless spin: each decline costs real standing with the agent,
 * so an unattended bot left overnight grinds the character down while looking
 * busy. Live capture: 5 declines in 49 s, still "running", no reason shown.
 */
export const MAX_DECLINE_ATTEMPTS = 3;
/**
 * Consecutive travel starts to the SAME station without ever arriving. The
 * autopilot has its own bounds and pauses itself; this catches the outer case
 * where it keeps being restarted and never gets there.
 */
export const MAX_TRAVEL_RESTARTS = 3;
/** Transient read failures tolerated before the loop stops trusting the read. */
export const MAX_READ_FAILURES = 5;
/**
 * The SAME tolerance for issued ACTIONS. A gateway timeout on an agent press,
 * a cargo move, or a travel start says nothing about what the game decided —
 * the call may have landed an instant after the abort — so it is never read as
 * a refusal. The loop settles, re-reads the authority that owns the fact (the
 * whole design of this file), and only a STREAK of unanswered actions pauses.
 */
export const MAX_ACTION_TRANSPORT_FAILURES = 3;
/** Give a busy gateway a breath before the re-read (same window as a move). */
const SETTLE_TRANSPORT = 2;
/**
 * Presses turned back with 409 SESSION_CHANGE_IN_PROGRESS while a previous
 * dock/jump/undock settles. Transient BY DESIGN and legitimately slow (the
 * barrier plus the ten-second cooldown is close to a minute), so this bound is
 * far more generous than the transport one.
 */
export const MAX_SESSION_CHANGE_WAITS = 12;
/**
 * THE WAIT WATCHDOG. Every named counter above bounds a specific press; this
 * bounds the WAITS — a docked rung that keeps answering the same wait (an
 * unreadable journal, an agent that never offers a Request button, a briefing
 * that never carries cargo fields because the accepted mission is not a
 * courier) is stuck, and five minutes of one unchanged reason is long past any
 * read hiccup. Flying is excluded: it has its own hour-scale bound. This is a
 * watchdog by construction — it also bounds wait rungs nobody has found yet.
 */
export const MAX_STUCK_WAIT_TICKS = 150;
/**
 * Ticks spent waiting on a travel that reports itself running. At the 2 s
 * cadence this is an hour — far longer than any high-sec courier route — so
 * reaching it means the flight is not progressing and the bot must say so.
 */
export const MAX_TRAVEL_WAIT_CYCLES = 1800;

// --- Reading the world -------------------------------------------------------

/** What the shared autopilot is doing. A LOCAL read — it issues nothing. */
export interface TravelReading {
  readonly status: AutopilotStatus;
  /** Where it was sent. Null when it was never started for us. */
  readonly destinationStationID: number | null;
  /** The destination SYSTEM — the only destination a system-only route has.
   * Optional so older fakes need not supply it; absent reads as unknown. */
  readonly destinationSystemID?: number | null;
  readonly remainingJumps: number;
  readonly failureReason: string | null;
}

/** The ship's cargo: what is in it and how much room it has. */
export interface CargoReading {
  readonly rows: readonly InventoryItemRow[];
  readonly capacity: CapacityInfo | null;
}

/** Everything one tick looked at. Pure input to the decision. */
export interface MissionObservation {
  readonly status: FlightStatus;
  /**
   * A FRESHLY OPENED conversation with the plan's agent, read THIS TICK. Null
   * when it was not needed or the read failed. It is never carried between
   * ticks — see the action-token note at the top of the file.
   */
  readonly conversation: AgentConversation | null;
  /**
   * The mission briefing. Readable for an OFFERED mission as well as an accepted
   * one (`getMissionRecordForRead`, agentMissionRuntime.js:3907, only
   * special-cases the accepted state for a re-sync), which is what lets the
   * volume and jump gates run BEFORE Accept rather than after.
   */
  readonly briefing: CourierBriefing | null;
  /** THE authority on whether a mission is accepted. null = the read failed. */
  readonly journal: JournalState | null;
  /** The active ship's cargo. null = the read failed. */
  readonly cargo: CargoReading | null;
  /** The docked station's hangar rows. null = not docked, or the read failed. */
  readonly hangar: readonly InventoryItemRow[] | null;
  /** What the shared autopilot is doing. */
  readonly travel: TravelReading | null;
  /**
   * Jumps from the ship's CURRENT system to the mission's dropoff system, from
   * the same client-side solver the autopilot routes on. null = not computable
   * (no origin, no graph, unreachable) — and unknown NEVER passes the gate.
   */
  readonly jumpsToDropoff: number | null;
}

/** What the player set the bot to do. */
export interface MissionPlan {
  /** The agent to work with. Request and Accept happen AT its station. */
  readonly agentID: number;
  /** The agent's NAME, for the readout. R7d: the panel never shows the id. */
  readonly agentName: string | null;
  /** Where the agent is. Accept must be in person, so this is a hard location. */
  readonly agentStationID: number;
  readonly agentStationName: string | null;
  /** Refuse any mission whose route is longer than this. The PLAYER's number. */
  readonly maxJumps: number;
  /** Stop after this many completed missions. 0 keeps going until stopped. */
  readonly maxMissions: number;
}

// --- The one atomic action a tick produces -----------------------------------

export type MissionBotAction =
  /** Ask the agent for work (button 2). */
  | { readonly kind: "request"; readonly actionID: number; readonly label: string }
  /** Take the offer (button 3) — only ever docked at the agent's own station. */
  | { readonly kind: "accept"; readonly actionID: number; readonly label: string }
  /** Turn the offer down (button 9), with the reason it failed a gate. */
  | {
      readonly kind: "decline";
      readonly actionID: number;
      readonly reason: string;
      readonly label: string;
    }
  /** Move the package from the pickup hangar into the ship. */
  | {
      readonly kind: "loadPackage";
      readonly typeID: number;
      readonly quantity: number;
      readonly label: string;
    }
  /** Move it out of the ship into the dropoff hangar. */
  | {
      readonly kind: "unloadPackage";
      readonly itemIDs: readonly number[];
      readonly quantity: number;
      readonly label: string;
    }
  /** Press Complete (button 6 or 7) and judge it by `missionCompleted === true`. */
  | { readonly kind: "complete"; readonly actionID: number; readonly label: string }
  /** Hand a destination to the SHARED autopilot. This bot flies nothing itself. */
  | { readonly kind: "travel"; readonly stationID: number; readonly label: string }
  | { readonly kind: "wait"; readonly reason: string }
  | { readonly kind: "pause"; readonly reason: string }
  | { readonly kind: "stopped" };

/**
 * One decision: the action, and the plain-language WHY that goes on screen.
 *
 * The `why` is not decoration. A bot you cannot interrogate is one you cannot
 * trust, so every branch states its own reason in the words a player uses, and
 * the panel shows the reason for the LAST thing it did at all times.
 */
export interface MissionDecision {
  readonly action: MissionBotAction;
  readonly why: string;
  /**
   * Set when this tick could not be SURE the stack it is loading is the mission
   * package. `getCourierProgress` judges delivery by typeID and the package's
   * own itemID is not readable by any client, so a player stack of identical
   * type AND quantity is genuinely indistinguishable. The bot says so; it does
   * not pretend the match was certain.
   */
  readonly caution?: string;
  /**
   * What to CALL the place a `travel` action is heading for, decided at the
   * moment the flight is chosen and remembered for its duration.
   *
   * ⚠ FROM THE LIVE R36 RUN. While a flight is running the loop deliberately
   * does NOT re-read the briefing (polling the agent every two seconds for a
   * ship in warp is load for nothing), so the flying rung has no briefing to
   * name the destination from — and the readout said "Flying to the station"
   * for six jumps when it knew perfectly well it was the delivery point. The
   * name is captured here, where the briefing IS in hand.
   */
  readonly travelLabel?: string;
}

export type MissionBotStatus = "idle" | "running" | "paused" | "stopped" | "error";

/** The live readout the panel renders (pushed every cycle). */
export interface MissionBotProgress {
  readonly status: MissionBotStatus;
  /** Where in the loop it is, in a couple of words ("Hauling", "At the agent"). */
  readonly phase: string | null;
  /** What it just did. */
  readonly action: string | null;
  /** WHY it did that. Always present while running. */
  readonly why: string | null;
  /** The agent, by NAME (R7d: never an id). */
  readonly agentName: string | null;
  /** The mission, in the words the briefing gave. */
  readonly missionName: string | null;
  /** What is being hauled, and how much of it. */
  readonly cargoText: string | null;
  /** Where it is going, by name. */
  readonly destinationName: string | null;
  /** Jumps still to fly, as the autopilot reports them. */
  readonly jumpsRemaining: number | null;
  readonly missionsCompleted: number;
  /** Earned THIS RUN, measured as a balance difference — never from a field. */
  readonly iskEarned: string | null;
  readonly lpEarned: string | null;
  /** Non-null when a load could not be certain it took the right stack. */
  readonly caution: string | null;
  /** Set when it stopped. Always a sentence a player can act on. */
  readonly failureReason: string | null;
}

// --- Reading the authorities -------------------------------------------------

/**
 * THE completion test, in one place so it can never drift.
 *
 * ⚠ `=== true` IS THE WHOLE POINT. R35 pressed Complete at the wrong station and
 * got HTTP 200, `ok:true`, an EMPTY actions list and `missionCompleted: null` —
 * not `false`. Every "did it work" shorthand that is not `=== true`
 * (`!== false`, `!= null`, a truthiness check on the whole object) reports that
 * refusal as a completed mission, pays out nothing, and sends the bot off to
 * request its next job with the old one still accepted.
 */
export function completed(conversation: AgentConversation | null): boolean {
  return conversation?.lastActionInfo.missionCompleted === true;
}

/**
 * Find the dialogue token for a button in a FRESHLY READ conversation.
 *
 * This is the only path by which an actionID reaches a call, and it takes the
 * conversation as an argument rather than reading anything stored — because the
 * server RE-MINTS these tokens across a move (R35 watched one agent's pair go
 * 815/816 -> 819/820 -> 821/822 without the mission changing). A cached id is a
 * stale id, so there is nowhere here to cache one.
 */
export function agentActionID(
  conversation: AgentConversation | null,
  buttonType: number,
): number | null {
  const match = conversation?.actions.find((action) => action.buttonType === buttonType);
  return match ? match.actionID : null;
}

/** The Complete button, in person or remotely — whichever this agent is offering. */
export function completeActionID(conversation: AgentConversation | null): number | null {
  return (
    agentActionID(conversation, AGENT_BUTTON.COMPLETE) ??
    agentActionID(conversation, AGENT_BUTTON.COMPLETE_REMOTELY)
  );
}

/**
 * Is a mission ACCEPTED, as the journal says?
 *
 * The journal row's state is a POSITIVE fact and is used as one. Its ABSENCE is
 * not: `completeMission` deletes the row, and so do quit, decline and expire, so
 * "no row" is only ever "no mission" and never "the mission completed". `null`
 * (the read failed) is neither — the caller must not act on an unread journal.
 */
export function missionAccepted(
  journal: JournalState | null,
  agentID: number,
): boolean | null {
  if (journal === null) {
    return null;
  }
  return journal.active.some((row) => row.agentID === agentID);
}

/**
 * The stack in `rows` that is the mission package — and whether we can be SURE.
 *
 * ⚠ THIS IS KNOWN BAD GROUND AND IT IS HANDLED, NOT FIXED. Courier cargo is
 * ordinary tradeable goods (the R35 run hauled Reports, typeID 3814), the
 * package's own itemID is not readable by any client, and the server's
 * `getCourierProgress` judges delivery by TYPE rather than item. So:
 *
 *   * the exact-quantity stack is preferred, because Accept stages precisely the
 *     mission's quantity as its own stack;
 *   * a larger stack is the fallback, split down to the mission quantity;
 *   * and when MORE THAN ONE stack matches the exact quantity, the right one is
 *     genuinely undecidable from anything the browser can see. `sure` goes
 *     false, and the bot SAYS SO rather than implying the match was certain.
 */
export function findPackageStack(
  rows: readonly InventoryItemRow[] | null,
  typeID: number,
  quantity: number,
): { readonly item: InventoryItemRow | null; readonly sure: boolean } {
  if (!rows) {
    return { item: null, sure: false };
  }
  const wanted = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const candidates = rows.filter((row) => row.typeID === typeID);
  const exact = candidates.filter((row) => row.quantity === wanted);
  if (exact.length > 0) {
    return { item: exact[0] ?? null, sure: exact.length === 1 && candidates.length === 1 };
  }
  const bigger = candidates.find((row) => row.quantity > wanted) ?? null;
  return { item: bigger, sure: bigger !== null && candidates.length === 1 };
}

/** Is the package aboard the ship? Read off the SHIP'S CARGO, never remembered. */
export function packageAboard(
  cargo: CargoReading | null,
  briefing: CourierBriefing | null,
): boolean | null {
  if (cargo === null) {
    return null;
  }
  const typeID = briefing?.cargoTypeID ?? null;
  const quantity = briefing?.cargoQuantity ?? null;
  if (typeID === null || quantity === null) {
    return null;
  }
  const total = cargo.rows
    .filter((row) => row.typeID === typeID)
    .reduce((sum, row) => sum + row.quantity, 0);
  return total >= quantity;
}

/** Free cubic metres in the ship's cargo. null when the ship did not say. */
export function cargoRoom(cargo: CargoReading | null): number | null {
  const capacity = cargo?.capacity;
  if (!capacity || !Number.isFinite(capacity.capacity) || !Number.isFinite(capacity.used)) {
    return null;
  }
  return Math.max(0, capacity.capacity - capacity.used);
}

/**
 * THE PRE-ACCEPT GATE. Returns null when the offer is takeable, or the plain
 * reason it is not.
 *
 * Both checks run BEFORE Accept and never after, because after is too late: an
 * accepted courier the ship cannot carry, or whose route the player never
 * sanctioned, is already the bot's problem to unwind.
 *
 * ⚠ UNKNOWN NEVER PASSES. A volume the briefing did not carry, a capacity the
 * ship did not report and a route the solver could not compute are all refusals
 * here, not shrugs — committing an unattended ship on a number nobody could read
 * is exactly the guess this project does not make.
 */
export function gateOffer(
  briefing: CourierBriefing | null,
  cargo: CargoReading | null,
  jumpsToDropoff: number | null,
  plan: MissionPlan,
): string | null {
  if (!briefing) {
    return "The agent's offer could not be read, so the bot left it alone.";
  }

  const volume = briefing.cargoVolume;
  const room = cargoRoom(cargo);
  if (volume === null) {
    return "The offer did not say how big the cargo is, so the bot left it alone rather than guess.";
  }
  if (room === null) {
    return "Your ship did not report how much room its cargo hold has, so the bot left the offer alone.";
  }
  if (volume > room) {
    return `That job needs ${volume.toLocaleString()} m³ and your ship has ${room.toLocaleString()} m³ free, so the bot turned it down.`;
  }

  if (jumpsToDropoff === null) {
    return "The bot could not work out a route to the delivery point, so it turned the job down.";
  }
  if (jumpsToDropoff > plan.maxJumps) {
    return `The delivery is ${jumpsToDropoff} jumps away and you set a limit of ${plan.maxJumps}, so the bot turned it down.`;
  }

  return null;
}

// --- The decision ------------------------------------------------------------

/** Memory the decision reads. It never mutates it — the controller does. */
export interface MissionDecisionMemory {
  /** The station the shared autopilot was last sent to on our behalf. */
  readonly travellingTo: number | null;
  /** What that place is CALLED, captured when the flight was chosen. */
  readonly travellingToLabel: string | null;
  /** Completed missions this run, against `plan.maxMissions`. */
  readonly missionsCompleted: number;
  /** Set once a Complete has been confirmed and the rewards read. */
}

/**
 * The pure decision. Given one tick's reading of the world, choose ONE action
 * and say why.
 *
 * The ladder, in the goal's order:
 *
 *   0. flying           the shared autopilot has it — wait, or surface its pause
 *   1. no mission       find work at this station; if there is none, PAUSE
 *   2. offer in hand    gate on volume and jumps, then Accept or Decline
 *   3. accepted         package not aboard -> load it at the pickup
 *   4. package aboard   not at the dropoff -> fly there (the autopilot's job)
 *   5. at the dropoff   unload, then Complete
 *   6. completed        read the rewards, then go again
 *   7. anything unclear PAUSE with a reason. Never fabricate progress.
 */
export function decideMissionAction(
  observation: MissionObservation,
  plan: MissionPlan,
  memory: MissionDecisionMemory,
): MissionDecision {
  const { status, conversation, briefing, journal, cargo, hangar, travel } = observation;

  // ── 0. The autopilot has the ship ─────────────────────────────────────────
  //
  // While a flight we started is running, this bot decides NOTHING about the
  // ship. Two loops steering one hull is the bug neither of them can see.
  if (memory.travellingTo !== null && travel) {
    if (travel.status === "running") {
      return {
        action: { kind: "wait", reason: "flying" },
        why: `Flying to ${memory.travellingToLabel ?? destinationWord(memory.travellingTo, plan, briefing)}${
          travel.remainingJumps > 0
            ? `, ${travel.remainingJumps} ${travel.remainingJumps === 1 ? "jump" : "jumps"} to go`
            : ""
        }.`,
      };
    }
    if (travel.status === "paused" || travel.status === "error") {
      // The autopilot stopped and said why. That reason is the player's, so it
      // is passed through rather than replaced with a summary of it.
      return {
        action: {
          kind: "pause",
          reason: travel.failureReason ?? "The flight stopped and the bot could not tell why.",
        },
        why: travel.failureReason ?? "The flight stopped.",
      };
    }
    // "arrived" / "aborted" / "idle" fall through: the ladder re-reads where the
    // ship actually is rather than believing the flight's own word for it.
  }

  if (!status.docked) {
    // In space with no flight of ours running. The ladder's every rung happens
    // docked, so the only honest move is to get docked — but only somewhere the
    // mission actually needs. Where that is, is decided below by the same rungs;
    // here we only note that nothing can be decided in space.
    const target = whereToBe(observation, plan, memory);
    if (target === null) {
      return {
        action: {
          kind: "pause",
          reason: "Your ship is in space and the bot could not work out where it should be, so it stopped.",
        },
        why: "In space with nowhere decided to go.",
      };
    }
    return {
      action: { kind: "travel", stationID: target, label: "Fly there" },
      why: `Heading for ${destinationWord(target, plan, briefing)}.`,
      travelLabel: destinationWord(target, plan, briefing),
    };
  }

  // ── Docked. The journal is the authority on whether we have a mission. ─────
  const accepted = missionAccepted(journal, plan.agentID);
  if (accepted === null) {
    return {
      action: { kind: "wait", reason: "reading the journal" },
      why: "Checking which jobs you have on.",
    };
  }

  // ── 3-6. A mission is on. ─────────────────────────────────────────────────
  if (accepted) {
    if (!briefing) {
      return {
        action: { kind: "wait", reason: "reading the briefing" },
        why: "Reading the job details.",
      };
    }
    const dropoff = briefing.destinationLocationID;
    const pickup = briefing.pickupLocationID;
    const aboard = packageAboard(cargo, briefing);
    if (aboard === null) {
      return {
        action: { kind: "wait", reason: "reading the cargo" },
        why: "Looking in your ship's cargo hold.",
      };
    }

    // ── 5. At the dropoff with the package: unload, then Complete. ──────────
    if (aboard) {
      if (dropoff === null) {
        return {
          action: {
            kind: "pause",
            reason: "The job did not say where the cargo has to go, so the bot stopped rather than fly somewhere at random.",
          },
          why: "No delivery point in the job details.",
        };
      }
      if (status.stationID !== dropoff) {
        // ── 4. Not there yet. The AUTOPILOT flies it, not this loop. ────────
        return {
          action: { kind: "travel", stationID: dropoff, label: "Fly to the delivery point" },
          why: `The cargo is aboard, so it goes to ${destinationWord(dropoff, plan, briefing)}.`,
          travelLabel: destinationWord(dropoff, plan, briefing),
        };
      }
      // Docked AT the dropoff with the cargo still in the ship: put it in the
      // hangar. The server judges delivery on what is in the STATION, so this
      // step is the delivery — Complete only records it.
      const typeID = briefing.cargoTypeID;
      const quantity = briefing.cargoQuantity ?? 1;
      if (typeID === null) {
        return {
          action: {
            kind: "pause",
            reason: "The job did not say what the cargo is, so the bot could not unload it.",
          },
          why: "No cargo type in the job details.",
        };
      }
      const found = findPackageStack(cargo?.rows ?? null, typeID, quantity);
      if (found.item) {
        return {
          action: {
            kind: "unloadPackage",
            itemIDs: [found.item.itemID],
            quantity,
            label: "Unload the cargo",
          },
          why: "Docked at the delivery point, so the cargo goes into the hangar.",
        };
      }
      // Aboard by the type count but no single stack to move: the cargo is split
      // across stacks. Say so rather than half-deliver.
      return {
        action: {
          kind: "pause",
          reason: "The cargo is split across more than one stack in your hold, so the bot stopped rather than deliver part of it.",
        },
        why: "The cargo is not in one stack.",
      };
    }

    // ── Package not aboard. Is it already delivered? ────────────────────────
    //
    // Docked at the dropoff, cargo gone from the ship, and the hangar holding
    // it: that is a delivery that has happened and a Complete that has not.
    if (dropoff !== null && status.stationID === dropoff) {
      const actionID = completeActionID(conversation);
      if (actionID !== null) {
        return {
          action: { kind: "complete", actionID, label: "Hand the job in" },
          why: "The cargo is delivered, so the bot is handing the job in.",
        };
      }
      // ⚠ NO COMPLETE BUTTON IS NOT A DEAD END (R35). An empty actions list is
      // location- and state-dependent and it RECOVERS — the same agent offered
      // nothing at the pickup and Complete+Quit at the dropoff. So this waits
      // for the next read rather than concluding anything, and the Complete
      // bound is what stops it going round forever.
      return {
        action: { kind: "wait", reason: "no complete offered" },
        why: "The cargo is delivered and the agent has not offered to settle up yet.",
      };
    }

    // ── 3. Load the package at the pickup. ─────────────────────────────────
    if (pickup === null) {
      return {
        action: {
          kind: "pause",
          reason: "The job did not say where to collect the cargo, so the bot stopped.",
        },
        why: "No collection point in the job details.",
      };
    }
    if (status.stationID !== pickup) {
      return {
        action: { kind: "travel", stationID: pickup, label: "Fly to the collection point" },
        why: `The cargo is waiting at ${destinationWord(pickup, plan, briefing)}.`,
        travelLabel: destinationWord(pickup, plan, briefing),
      };
    }
    const typeID = briefing.cargoTypeID;
    const quantity = briefing.cargoQuantity ?? 1;
    if (typeID === null) {
      return {
        action: {
          kind: "pause",
          reason: "The job did not say what the cargo is, so the bot could not collect it.",
        },
        why: "No cargo type in the job details.",
      };
    }
    if (hangar === null) {
      return {
        action: { kind: "wait", reason: "reading the hangar" },
        why: "Looking in the station hangar for the cargo.",
      };
    }
    const found = findPackageStack(hangar, typeID, quantity);
    if (!found.item) {
      return {
        action: {
          kind: "pause",
          reason: "The cargo for this job is not in the station hangar, so the bot stopped rather than fly an empty ship to the delivery point.",
        },
        why: "The cargo is not in the hangar.",
      };
    }
    return {
      action: {
        kind: "loadPackage",
        typeID,
        quantity,
        label: "Load the cargo",
      },
      why: "The cargo is in the hangar here, so it goes into the ship.",
      // ⚠ SAY SO WHEN IT CANNOT BE SURE. See findPackageStack: a player stack of
      // identical type AND quantity is indistinguishable from the package, and
      // the client has nothing that can tell them apart.
      ...(found.sure
        ? {}
        : {
            caution:
              "There is more than one stack here that matches this job's cargo, so the bot cannot be certain it loaded the right one.",
          }),
    };
  }

  // ── 1/2. No mission on. Everything from here needs the agent. ─────────────

  // ⚠ THE PLAYER'S STOPPING POINT IS CHECKED BEFORE THE FLIGHT, NOT AFTER IT.
  //
  // This ordering is from the live R36 run. With the cap tested further down —
  // after the "fly to the agent" rung — a bot that had just completed its last
  // job at the DROPOFF would decide "no mission on, and I am not at the agent",
  // fly the whole route back (six jumps, seven minutes), arrive, and only then
  // notice it had already finished and stop. It committed the ship to a journey
  // whose only purpose was to reach the place where it would refuse to work.
  //
  // Nothing is owed at this point — no mission accepted, no cargo aboard — so
  // stopping right here leaves the ship docked and sane wherever it is, which is
  // the whole promise of a bot you can walk away from.
  if (plan.maxMissions > 0 && memory.missionsCompleted >= plan.maxMissions) {
    return {
      action: {
        kind: "pause",
        reason: `The bot finished the ${memory.missionsCompleted} ${
          memory.missionsCompleted === 1 ? "job" : "jobs"
        } you asked for and stopped.`,
      },
      why: "Reached the number of jobs you asked for.",
    };
  }

  // And taking work on has to happen AT the agent: R35 watched a remote Accept
  // be refused silently for a courier (200 + the offered conversation straight
  // back), so the bot goes to them rather than trying from wherever it is.
  if (status.stationID !== plan.agentStationID) {
    return {
      action: { kind: "travel", stationID: plan.agentStationID, label: "Fly to the agent" },
      why: `Jobs have to be taken on in person, so the bot is going to ${
        plan.agentStationName ?? "the agent"
      }.`,
      travelLabel: plan.agentStationName ?? "the agent",
    };
  }

  if (conversation === null) {
    return {
      action: { kind: "wait", reason: "reading the agent" },
      why: `Talking to ${plan.agentName ?? "the agent"}.`,
    };
  }

  // ── 2. An offer is on the table: GATE IT, then take it or turn it down. ───
  const acceptID = agentActionID(conversation, AGENT_BUTTON.ACCEPT);
  if (acceptID !== null) {
    const refusal = gateOffer(briefing, cargo, observation.jumpsToDropoff, plan);
    if (refusal === null) {
      return {
        action: { kind: "accept", actionID: acceptID, label: "Take the job on" },
        why: `The cargo fits and the delivery is ${
          observation.jumpsToDropoff ?? 0
        } jumps away, so the bot took the job on.`,
      };
    }
    const declineID = agentActionID(conversation, AGENT_BUTTON.DECLINE);
    if (declineID !== null) {
      return {
        action: { kind: "decline", actionID: declineID, reason: refusal, label: "Turn the job down" },
        why: refusal,
      };
    }
    // Nothing to press but Accept, and Accept is gated. Stopping is the honest
    // move: accepting anyway is exactly the guess the gate exists to prevent.
    return {
      action: { kind: "pause", reason: refusal },
      why: refusal,
    };
  }

  // ── 1. No offer. Ask for one. ────────────────────────────────────────────
  const requestID = agentActionID(conversation, AGENT_BUTTON.REQUEST_MISSION);
  if (requestID !== null) {
    return {
      action: { kind: "request", actionID: requestID, label: "Ask for a job" },
      why: `Asking ${plan.agentName ?? "the agent"} for a job.`,
    };
  }

  // No Accept and no Request. R35 says an empty list is not terminal — but the
  // bot is standing in front of the agent with nothing to press and nothing else
  // in the ladder to do, so waiting forever would be the unbounded repeat this
  // project has been bitten by. The REQUEST bound turns this into a pause with a
  // reason; until then, keep asking.
  return {
    action: { kind: "wait", reason: "agent offering nothing" },
    why: `${plan.agentName ?? "The agent"} has nothing to offer right now.`,
  };
}

/**
 * Where should the ship be, for whatever the ladder would decide next? Used only
 * from the in-space branch, where nothing else can be decided.
 */
function whereToBe(
  observation: MissionObservation,
  plan: MissionPlan,
  _memory: MissionDecisionMemory,
): number | null {
  const briefing = observation.briefing;
  const accepted = missionAccepted(observation.journal, plan.agentID);
  if (accepted === true && briefing) {
    const aboard = packageAboard(observation.cargo, briefing);
    if (aboard === true && briefing.destinationLocationID !== null) {
      return briefing.destinationLocationID;
    }
    if (aboard === false && briefing.pickupLocationID !== null) {
      return briefing.pickupLocationID;
    }
  }
  return plan.agentStationID > 0 ? plan.agentStationID : null;
}

/** Name a destination for the readout. R7d — a description, never an id. */
function destinationWord(
  stationID: number,
  plan: MissionPlan,
  briefing: CourierBriefing | null,
): string {
  if (stationID === plan.agentStationID) {
    return plan.agentStationName ?? "the agent's station";
  }
  if (briefing && stationID === briefing.destinationLocationID) {
    return "the delivery point";
  }
  if (briefing && stationID === briefing.pickupLocationID) {
    return "the collection point";
  }
  return "the station";
}

// --- The controller ----------------------------------------------------------

/** Everything the loop needs from the outside — all injectable for tests. */
export interface MissionBotDeps {
  getStatus(): Promise<FlightStatus>;
  /**
   * Open the agent conversation and decode it. Called FRESH in every tick that
   * could act on it — never cached, because the server re-mints the tokens.
   */
  openConversation(agentID: number): Promise<AgentConversation | null>;
  /**
   * Press a dialogue button. Returns the decoded conversation that came back,
   * which is the only place `missionCompleted` can be read from.
   *
   * ⚠ It does NOT throw on a refusal. `doAgentAction` answers `success: true` on
   * every branch, so a returned conversation is evidence of nothing on its own.
   */
  doAgentAction(agentID: number, actionID: number): Promise<AgentConversation | null>;
  /** The mission briefing (offered or accepted). null = no mission / read failed. */
  getBriefing(agentID: number): Promise<CourierBriefing | null>;
  /** The journal — THE authority on accepted-ness. null = the read failed. */
  getJournal(): Promise<JournalState | null>;
  /** The active ship cargo rows + capacity. null = the read failed. */
  getCargo(): Promise<CargoReading | null>;
  /** The docked station hangar rows. null = the read failed. */
  getHangar(): Promise<readonly InventoryItemRow[] | null>;
  /** Move a stack hangar to ship. Raises when nothing actually moved. */
  loadPackage(typeID: number, quantity: number): Promise<void>;
  /** Move a stack ship to hangar. Raises when nothing actually moved. */
  unloadPackage(itemIDs: readonly number[], quantity: number): Promise<void>;
  /**
   * Hand a destination to the SHARED autopilot (the Travel panel own
   * controller). This bot never issues a warp, a jump or a dock itself.
   */
  startTravel(stationID: number): Promise<void>;
  /** Read that autopilot status back. A LOCAL read — it issues nothing. */
  getTravel(): TravelReading | null;
  /** Stop the shared autopilot (used when the bot itself stops). */
  stopTravel(): void;
  /** Jumps between two systems, from the autopilot own route solver. */
  getJumps(fromSystemID: number, toSystemID: number): Promise<number | null>;
  /**
   * The wallet and LP balances, for measuring what a mission actually paid.
   *
   * ⚠ NOT `lastActionInfo.loyaltyPoints` — R35 watched that field read 0 on a
   * completion that paid 213 LP. Earnings are a BALANCE DIFFERENCE, read from
   * the accounts either side of the Complete, exactly as the hold is what proves
   * the mining bot mined.
   */
  getBalances(): Promise<{ readonly isk: string | null; readonly lp: string | null } | null>;
  sleep(ms: number): Promise<void>;
  onProgress(progress: MissionBotProgress): void;
  isSessionLost(error: unknown): boolean;
  refusalReason(error: unknown): string;
}

export interface MissionBotController {
  start(plan: MissionPlan): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** One decision cycle: read, decide, issue at most one atomic call. */
  tick(): Promise<MissionBotAction>;
  /** Drive until the loop leaves the running state (production driver). */
  run(): Promise<void>;
  snapshot(): MissionBotProgress;
}

interface BotMemory {
  status: MissionBotStatus;
  phase: string | null;
  action: string | null;
  why: string | null;
  caution: string | null;
  failureReason: string | null;
  settleTicks: number;
  travellingTo: number | null;
  travellingToLabel: string | null;
  missionsCompleted: number;
  missionName: string | null;
  cargoText: string | null;
  destinationName: string | null;
  jumpsRemaining: number | null;
  // Earnings, measured as a difference between two readings of the ACCOUNTS.
  startISK: string | null;
  startLP: string | null;
  iskEarned: string | null;
  lpEarned: string | null;
  // Every counter below counts CONSECUTIVE decisions of one kind whose authority
  // has not changed. A landed action resets its own counter by construction,
  // because the decision stops choosing it.
  requestAttempts: number;
  acceptAttempts: number;
  /** Cleared ONLY by an Accept — see MAX_DECLINE_ATTEMPTS. */
  declineAttempts: number;
  loadAttempts: number;
  unloadAttempts: number;
  completeAttempts: number;
  travelTargetID: number | null;
  travelRestarts: number;
  travelWaitCycles: number;
  readFailures: number;
  /** Consecutive issued actions whose call never got an answer (transport). */
  actionTransportFailures: number;
  /** Consecutive presses turned back while a session change was settling. */
  sessionChangeWaits: number;
  /** The wait watchdog: the reason being waited on, and for how many ticks. */
  stuckWaitReason: string | null;
  stuckWaitTicks: number;
  /** The last swallowed read failure, in player words — for the watchdog. */
  lastReadFailure: string | null;
}

function freshMemory(): BotMemory {
  return {
    status: "idle",
    phase: null,
    action: null,
    why: null,
    caution: null,
    failureReason: null,
    settleTicks: 0,
    travellingTo: null,
    travellingToLabel: null,
    missionsCompleted: 0,
    missionName: null,
    cargoText: null,
    destinationName: null,
    jumpsRemaining: null,
    startISK: null,
    startLP: null,
    iskEarned: null,
    lpEarned: null,
    requestAttempts: 0,
    acceptAttempts: 0,
    declineAttempts: 0,
    loadAttempts: 0,
    unloadAttempts: 0,
    completeAttempts: 0,
    travelTargetID: null,
    travelRestarts: 0,
    travelWaitCycles: 0,
    readFailures: 0,
    actionTransportFailures: 0,
    sessionChangeWaits: 0,
    stuckWaitReason: null,
    stuckWaitTicks: 0,
    lastReadFailure: null,
  };
}

function phaseFor(action: MissionBotAction): string {
  switch (action.kind) {
    case "request":
      return "Asking for work";
    case "accept":
      return "Taking a job on";
    case "decline":
      return "Turning a job down";
    case "loadPackage":
      return "Loading";
    case "unloadPackage":
      return "Delivering";
    case "complete":
      return "Handing it in";
    case "travel":
      return "Flying";
    case "pause":
    case "stopped":
      return "Stopped";
    case "wait":
      return action.reason === "flying" ? "Flying" : "Working";
  }
}

function actionText(action: MissionBotAction): string {
  switch (action.kind) {
    case "request":
    case "accept":
    case "decline":
    case "loadPackage":
    case "unloadPackage":
    case "complete":
    case "travel":
      return action.label;
    case "wait":
      return "Working";
    case "pause":
    case "stopped":
      return "Stopped";
  }
}

/**
 * Subtract two bigint-safe decimal strings. ISK and LP can exceed 2^53, so this
 * never goes through Number — the decoder rule (docs/bridge-wire-contract.md)
 * that keeps them as strings would be pointless if the arithmetic re-lost it.
 */
export function subtractAmounts(after: string | null, before: string | null): string | null {
  if (after === null || before === null) {
    return null;
  }
  try {
    return (BigInt(after) - BigInt(before)).toString();
  } catch {
    return null;
  }
}

export function createMissionBot(deps: MissionBotDeps): MissionBotController {
  let memory = freshMemory();
  let plan: MissionPlan | null = null;
  // Bumped on pause/stop/start so a stale in-flight run() loop stops driving.
  let runToken = 0;

  function snapshot(): MissionBotProgress {
    return {
      status: memory.status,
      phase: memory.phase,
      action: memory.action,
      why: memory.why,
      agentName: plan?.agentName ?? null,
      missionName: memory.missionName,
      cargoText: memory.cargoText,
      destinationName: memory.destinationName,
      jumpsRemaining: memory.jumpsRemaining,
      missionsCompleted: memory.missionsCompleted,
      iskEarned: memory.iskEarned,
      lpEarned: memory.lpEarned,
      caution: memory.caution,
      failureReason: memory.failureReason,
    };
  }

  function emit(): void {
    deps.onProgress(snapshot());
  }

  function setPause(reason: string): void {
    memory.status = "paused";
    memory.failureReason = reason;
    memory.phase = "Stopped";
    memory.action = null;
    memory.why = reason;
    runToken += 1;
    // A paused bot must not leave the shared autopilot flying the ship on its
    // behalf: the player pressed nothing, so nothing should keep moving.
    deps.stopTravel();
  }

  function setError(reason: string): void {
    memory.status = "error";
    memory.failureReason = reason;
    memory.phase = "Stopped";
    memory.action = null;
    memory.why = reason;
    runToken += 1;
    deps.stopTravel();
  }

  /**
   * A read that failed is a read that failed — null, never a confident empty.
   * A LOST SESSION is different and is allowed to propagate: the run is over.
   */
  async function safely<T>(read: () => Promise<T | null>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (deps.isSessionLost(error)) {
        throw error;
      }
      // Remembered, not shown: if the wait watchdog later fires because a rung
      // kept waiting on a read that kept failing, the pause can say WHY the
      // read failed instead of only what was being waited on.
      memory.lastReadFailure = refusalWords(deps.refusalReason(error));
      return null;
    }
  }

  /**
   * Read what this tick needs.
   *
   * ⚠ THE CONVERSATION IS READ HERE, EVERY TICK THAT COULD USE IT, AND NEVER
   * STORED. That is the whole anti-caching rule from R35 expressed as control
   * flow: the tokens in `observation.conversation` were minted this tick and are
   * spent this tick, so there is no window in which a move can stale them.
   */
  async function observe(status: FlightStatus, current: MissionPlan): Promise<MissionObservation> {
    const travel = deps.getTravel();
    // While a flight of ours is running, nothing else is worth reading — the
    // ladder flying rung decides on the travel status alone, and polling the
    // agent and the inventory every 2 s for a ship in warp is load for nothing.
    if (memory.travellingTo !== null && travel?.status === "running") {
      return {
        status,
        conversation: null,
        briefing: null,
        journal: null,
        cargo: null,
        hangar: null,
        travel,
        jumpsToDropoff: null,
      };
    }

    const [journal, briefing, cargo] = await Promise.all([
      safely(() => deps.getJournal()),
      safely(() => deps.getBriefing(current.agentID)),
      safely(() => deps.getCargo()),
    ]);

    const hangar = status.docked ? await safely(() => deps.getHangar()) : null;

    // The agent is only opened when the ladder could actually press something:
    // docked, and either with no mission on (request / accept) or standing at
    // the dropoff (complete). Everywhere else it would be a call for nothing.
    let conversation: AgentConversation | null = null;
    const accepted = missionAccepted(journal, current.agentID);
    const atAgent = status.docked && status.stationID === current.agentStationID;
    const dropoffID = briefing?.destinationLocationID ?? null;
    const atDropoff = status.docked && dropoffID !== null && status.stationID === dropoffID;
    if ((accepted === false && atAgent) || (accepted === true && atDropoff)) {
      conversation = await safely(() => deps.openConversation(current.agentID));
    }

    // The route gate number, computed from the SAME solver the autopilot flies
    // on. Only needed while an offer is being gated.
    let jumpsToDropoff: number | null = null;
    const dropoffSystem = briefing?.destinationSystemID ?? null;
    const origin = status.solarSystemID;
    if (accepted === false && dropoffSystem !== null && origin !== null) {
      jumpsToDropoff = await safely(() => deps.getJumps(origin, dropoffSystem));
    }

    return { status, conversation, briefing, journal, cargo, hangar, travel, jumpsToDropoff };
  }

  /** Keep the readout truthful about the mission in hand. */
  function describeMission(observation: MissionObservation): void {
    // What to CALL the job. The only name the client actually holds is the
    // journal row's mission-TYPE label ("…/MissionTypes/Courier"); the
    // briefing's `missionTitleID` is a localization message id with no static
    // name, so rendering it would be a bare number on screen (R7d). This is the
    // same choice the Agents & Missions journal already makes.
    const row = observation.journal?.active.find((entry) => entry.agentID === plan?.agentID);
    const label = row?.missionTypeLabel?.split("/").pop() ?? null;
    if (label) {
      memory.missionName = label;
    }

    const briefing = observation.briefing;
    if (!briefing) {
      return;
    }
    if (briefing.cargoQuantity !== null && briefing.cargoVolume !== null) {
      memory.cargoText = `${briefing.cargoQuantity.toLocaleString()} units, ${briefing.cargoVolume.toLocaleString()} m³`;
    }
    memory.jumpsRemaining =
      observation.travel?.status === "running"
        ? observation.travel.remainingJumps
        : observation.jumpsToDropoff ?? memory.jumpsRemaining;
  }

  /**
   * BOUND THE BRANCH. Each counter tracks consecutive decisions of one kind
   * whose authority still says the thing has not happened. Anything else resets
   * it. Returns false when the bound is spent and the loop has already stopped.
   */
  function bound(action: MissionBotAction): boolean {
    // Request — the authority is an OFFER appearing in the conversation.
    if (action.kind === "request") {
      memory.requestAttempts += 1;
      if (memory.requestAttempts > MAX_REQUEST_ATTEMPTS) {
        setPause(
          "The agent was asked for work three times and offered nothing, so the bot stopped. Your standing with them may be too low, or you may have to wait before they will deal with you again.",
        );
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.requestAttempts = 0;
    }

    // Decline — bounded, and DELIBERATELY NOT cleared by the Request that
    // alternates with it (see MAX_DECLINE_ATTEMPTS). Only taking a job on means
    // the agent is offering work this player's limits actually allow, so Accept
    // is the one thing that clears it. Everything else leaves it standing.
    if (action.kind === "decline") {
      memory.declineAttempts += 1;
      if (memory.declineAttempts > MAX_DECLINE_ATTEMPTS) {
        setPause(
          `${MAX_DECLINE_ATTEMPTS} jobs in a row were outside the limits you set, so the bot stopped rather than keep turning work down — every job refused costs you standing with the agent. Allow more jumps, use a ship with more room, or pick a different agent.`,
        );
        return false;
      }
    } else if (action.kind === "accept") {
      memory.declineAttempts = 0;
    }

    // Accept — the authority is the JOURNAL showing the mission accepted. This
    // is the bound that catches R35 silently-refused remote accept.
    if (action.kind === "accept") {
      memory.acceptAttempts += 1;
      if (memory.acceptAttempts > MAX_ACCEPT_ATTEMPTS) {
        setPause(
          "The job was accepted three times and your journal still does not show it, so the bot stopped rather than fly off on a job it may not have.",
        );
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.acceptAttempts = 0;
    }

    // Load — the authority is the SHIP CARGO holding the package.
    if (action.kind === "loadPackage") {
      memory.loadAttempts += 1;
      if (memory.loadAttempts > MAX_LOAD_ATTEMPTS) {
        setPause("The cargo would not go into your ship, so the bot stopped with it still in the hangar.");
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.loadAttempts = 0;
    }

    // Unload — the authority is the HANGAR holding it.
    if (action.kind === "unloadPackage") {
      memory.unloadAttempts += 1;
      if (memory.unloadAttempts > MAX_UNLOAD_ATTEMPTS) {
        setPause("The cargo would not come out of your ship, so the bot stopped without handing the job in.");
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.unloadAttempts = 0;
    }

    // Complete — the authority is `missionCompleted === true`, and NOTHING else.
    // A refused Complete is a 200 with an empty actions list and a null flag, so
    // without this counter the bot presses it forever.
    if (action.kind === "complete") {
      memory.completeAttempts += 1;
      if (memory.completeAttempts > MAX_COMPLETE_ATTEMPTS) {
        setPause(
          "The agent would not settle up after three tries, so the bot stopped. Your cargo is delivered — hand the job in yourself under Agents & Missions.",
        );
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.completeAttempts = 0;
    }

    // Travel — bounded on RESTARTS to the same place. The autopilot bounds the
    // flight itself; this bounds the bot re-launching it and never arriving.
    if (action.kind === "travel") {
      if (memory.travelTargetID === action.stationID) {
        memory.travelRestarts += 1;
      } else {
        memory.travelTargetID = action.stationID;
        memory.travelRestarts = 1;
      }
      if (memory.travelRestarts > MAX_TRAVEL_RESTARTS) {
        setPause("The flight was started three times and the ship never got there, so the bot stopped.");
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.travelTargetID = null;
      memory.travelRestarts = 0;
    }

    // And the wait on a running flight is bounded too, so a flight that reports
    // itself running forever still stops rather than hanging the bot.
    if (action.kind === "wait" && action.reason === "flying") {
      memory.travelWaitCycles += 1;
      if (memory.travelWaitCycles > MAX_TRAVEL_WAIT_CYCLES) {
        setPause("The ship has been flying for a long time without arriving, so the bot stopped.");
        return false;
      }
    } else if (action.kind !== "wait") {
      memory.travelWaitCycles = 0;
    }

    return true;
  }

  /**
   * Issue AT MOST ONE atomic call, then CONFIRM it against the authority that
   * owns the fact. Nothing here believes a call own answer — `doAgentAction`
   * returns `success: true` on every branch it has.
   */
  async function issue(action: MissionBotAction): Promise<void> {
    if (memory.status !== "running" || !plan) {
      return;
    }
    const current = plan;
    try {
      switch (action.kind) {
        case "request":
        case "accept":
        case "decline":
          await deps.doAgentAction(current.agentID, action.actionID);
          memory.settleTicks = SETTLE_AGENT;
          break;
        case "complete": {
          // ⚠ THE ONE TEST THAT MATTERS. `completed()` is `=== true`; a refusal
          // comes back 200 with an empty actions list and `null`, and reading
          // that as anything but "it did not complete" is the bug R35 found.
          const back = await deps.doAgentAction(current.agentID, action.actionID);
          if (completed(back)) {
            memory.missionsCompleted += 1;
            memory.completeAttempts = 0;
            // What it actually PAID, as a balance difference. Never
            // `lastActionInfo.loyaltyPoints` — R35 saw that read 0 on a
            // completion that paid 213 LP.
            const after = await safely(() => deps.getBalances());
            if (after) {
              memory.iskEarned = subtractAmounts(after.isk, memory.startISK);
              memory.lpEarned = subtractAmounts(after.lp, memory.startLP);
            }
            memory.why = "The job is handed in and paid.";
          }
          memory.settleTicks = SETTLE_AGENT;
          break;
        }
        case "loadPackage":
          await deps.loadPackage(action.typeID, action.quantity);
          memory.settleTicks = SETTLE_CARGO;
          break;
        case "unloadPackage":
          await deps.unloadPackage(action.itemIDs, action.quantity);
          memory.settleTicks = SETTLE_CARGO;
          break;
        case "travel":
          await deps.startTravel(action.stationID);
          memory.travellingTo = action.stationID;
          memory.settleTicks = SETTLE_TRAVEL;
          break;
        default:
          return;
      }
      // The call reached the server and answered: the transport and
      // session-change streaks are over.
      memory.actionTransportFailures = 0;
      memory.sessionChangeWaits = 0;
    } catch (error) {
      handleActionError(action, error);
    }
  }

  /** Roll back the rung counter bound() charged for a press that never arrived. */
  function uncountAttempt(action: MissionBotAction): void {
    switch (action.kind) {
      case "request":
        memory.requestAttempts = Math.max(0, memory.requestAttempts - 1);
        return;
      case "accept":
        memory.acceptAttempts = Math.max(0, memory.acceptAttempts - 1);
        return;
      case "decline":
        memory.declineAttempts = Math.max(0, memory.declineAttempts - 1);
        return;
      case "loadPackage":
        memory.loadAttempts = Math.max(0, memory.loadAttempts - 1);
        return;
      case "unloadPackage":
        memory.unloadAttempts = Math.max(0, memory.unloadAttempts - 1);
        return;
      case "complete":
        memory.completeAttempts = Math.max(0, memory.completeAttempts - 1);
        return;
      case "travel":
        memory.travelRestarts = Math.max(0, memory.travelRestarts - 1);
        return;
      default:
        return;
    }
  }

  function handleActionError(action: MissionBotAction, error: unknown): void {
    if (deps.isSessionLost(error)) {
      setError("The live session ended (idle timeout or another client took over).");
      return;
    }
    // A press turned back while a previous session change settles is not a
    // refusal either — the barrier becomes ready, or its latch heals on the
    // status polls this loop already makes. Wait it out generously.
    if (isSessionChangeSettling(error)) {
      memory.sessionChangeWaits += 1;
      if (memory.sessionChangeWaits > MAX_SESSION_CHANGE_WAITS) {
        setPause(
          `${actionText(action)} kept being turned back while a session change was finishing: ${refusalWords(deps.refusalReason(error))}`,
        );
        return;
      }
      uncountAttempt(action);
      memory.settleTicks = SETTLE_TRANSPORT;
      return;
    }
    // A transport failure is NOT a refusal — the wire did not answer, and the
    // press may have landed an instant after the abort. Every rung already
    // confirms its action against the authority that owns the fact, so the
    // honest response is to settle, re-observe, and let the bounded rung
    // counters govern a re-issue; only a STREAK of unanswered calls pauses.
    // A barrier that timed out (TRANSITION_TIMEOUT) carries the same "outcome
    // unknown" semantics, so it rides the same bounded path.
    if (isTransportTransient(error) || isTransitionTimeout(error)) {
      memory.actionTransportFailures += 1;
      if (memory.actionTransportFailures > MAX_ACTION_TRANSPORT_FAILURES) {
        setPause(
          `${actionText(action)} got no answer from the server after ${memory.actionTransportFailures} tries: ${refusalWords(deps.refusalReason(error))}`,
        );
        return;
      }
      // The press never reached the game, so it must not count against the
      // rung's own bound — those counters measure presses the authority saw
      // and did not act on, and this one was seen by nobody. (bound() runs
      // before issue(), so the increment has already happened.)
      uncountAttempt(action);
      memory.settleTicks = SETTLE_TRANSPORT;
      return;
    }
    // ⚠ TWO STRINGS, AND THEY ARE NOT INTERCHANGEABLE (R31). The raw server text
    // is what a classifier would read; `words` is the same refusal in player
    // language and is the ONLY one that may be shown, because `failureReason`
    // renders in the panel where R9a applies.
    const words = refusalWords(deps.refusalReason(error));
    setPause(`${actionText(action)} was refused: ${words}`);
  }

  async function tick(): Promise<MissionBotAction> {
    if (memory.status !== "running" || !plan) {
      return memory.status === "stopped"
        ? { kind: "stopped" }
        : { kind: "wait", reason: memory.failureReason ?? "not running" };
    }
    const current = plan;

    let status: FlightStatus;
    try {
      status = await deps.getStatus();
      memory.readFailures = 0;
    } catch (error) {
      if (deps.isSessionLost(error)) {
        setError("The live session ended (idle timeout or another client took over).");
        emit();
        return { kind: "pause", reason: memory.failureReason ?? "session lost" };
      }
      memory.readFailures += 1;
      if (memory.readFailures > MAX_READ_FAILURES) {
        setPause(
          `Your ship's status could not be read after ${memory.readFailures} tries, so the bot stopped: ${refusalWords(deps.refusalReason(error))}`,
        );
        emit();
        return { kind: "pause", reason: memory.failureReason ?? "status read failed" };
      }
      memory.phase = "Reconnecting";
      memory.why = "Waiting for your ship to answer.";
      emit();
      return { kind: "wait", reason: "status read retry" };
    }

    if (memory.status !== "running") {
      emit();
      return { kind: memory.status === "stopped" ? "stopped" : "wait", reason: "stopped" };
    }

    // Settle window: let the last move begin before re-deciding.
    if (memory.settleTicks > 0) {
      memory.settleTicks -= 1;
      memory.phase = "Working";
      memory.action = "Waiting for the last move to take effect";
      emit();
      return { kind: "wait", reason: "settling" };
    }

    let observation: MissionObservation;
    try {
      observation = await observe(status, current);
    } catch (error) {
      if (deps.isSessionLost(error)) {
        setError("The live session ended (idle timeout or another client took over).");
        emit();
        return { kind: "pause", reason: memory.failureReason ?? "session lost" };
      }
      emit();
      return { kind: "wait", reason: "read failed" };
    }
    if (memory.status !== "running") {
      emit();
      return { kind: memory.status === "stopped" ? "stopped" : "wait", reason: "stopped" };
    }

    // A flight that is over is a flight the bot no longer owns. Clearing this
    // BEFORE the decision is what lets the ladder re-read where the ship
    // actually ended up rather than trusting the flight own word for it.
    //
    // ⚠ ONLY AN ARRIVAL AT *OUR* DESTINATION CLEARS THE COUNTERS. The travel
    // snapshot is the SHARED autopilot's, and between legs it still says
    // "arrived" — about the PREVIOUS leg. Clearing the restart bound on that
    // stale word is what used to let a travel that kept failing to start spin
    // forever: every re-decide reset the very counter meant to stop it.
    if (
      memory.travellingTo !== null &&
      observation.travel?.status === "arrived" &&
      observation.travel.destinationStationID === memory.travellingTo
    ) {
      memory.travellingTo = null;
      memory.travellingToLabel = null;
      memory.travelTargetID = null;
      memory.travelRestarts = 0;
      memory.travelWaitCycles = 0;
    }

    describeMission(observation);

    const decision = decideMissionAction(observation, current, {
      travellingTo: memory.travellingTo,
      travellingToLabel: memory.travellingToLabel,
      missionsCompleted: memory.missionsCompleted,
    });

    memory.why = decision.why;
    memory.action = actionText(decision.action);
    memory.phase = phaseFor(decision.action);

    // The wait watchdog — see MAX_STUCK_WAIT_TICKS. Same reason, tick after
    // tick, means the rung's authority is never going to change on its own.
    if (decision.action.kind === "wait" && decision.action.reason !== "flying") {
      if (memory.stuckWaitReason === decision.action.reason) {
        memory.stuckWaitTicks += 1;
        if (memory.stuckWaitTicks > MAX_STUCK_WAIT_TICKS) {
          setPause(
            `Nothing changed for five minutes while the bot was waiting — ${decision.why}${
              memory.lastReadFailure
                ? ` The last read that failed said: ${memory.lastReadFailure}`
                : ""
            } The bot stopped so you can take a look.`,
          );
          emit();
          return { kind: "wait", reason: "stuck" };
        }
      } else {
        memory.stuckWaitReason = decision.action.reason;
        memory.stuckWaitTicks = 1;
      }
    } else {
      memory.stuckWaitReason = null;
      memory.stuckWaitTicks = 0;
    }
    // A caution is STICKY for the mission it was raised on: the player must be
    // able to see, at the point the job is handed in, that the load it was based
    // on could not be certain. It clears when the next job is taken on.
    if (decision.caution) {
      memory.caution = decision.caution;
    }
    if (decision.action.kind === "accept") {
      memory.caution = null;
    }
    if (decision.action.kind === "travel") {
      // The place's NAME, remembered for the flight — see MissionDecision.travelLabel.
      memory.travellingToLabel = decision.travelLabel ?? null;
      memory.destinationName = decision.travelLabel ?? decision.action.label;
    }

    if (decision.action.kind === "pause") {
      setPause(decision.action.reason);
      emit();
      return decision.action;
    }
    if (!bound(decision.action)) {
      emit();
      return { kind: "wait", reason: "bounded" };
    }
    if (decision.action.kind === "wait") {
      emit();
      return decision.action;
    }

    emit();
    await issue(decision.action);
    emit();
    return decision.action;
  }

  async function run(): Promise<void> {
    const token = runToken;
    while (token === runToken && memory.status === "running") {
      try {
        await tick();
      } catch (error) {
        // The backstop: tick() handles its own read/decide/issue failures, so
        // reaching here means something truly unexpected threw. The loop must
        // never die silently with the panel still saying "running" — that was
        // the observed failure shape when a store subscriber threw back
        // through an emit. Stop visibly instead.
        setError(
          `The bot hit an unexpected error and stopped: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        try {
          emit();
        } catch {
          // The subscriber may be the very thing that is broken.
        }
        return;
      }
      if (token !== runToken || memory.status !== "running") {
        break;
      }
      await deps.sleep(MISSION_BOT_CADENCE_MS);
    }
  }

  return {
    start(nextPlan: MissionPlan): void {
      plan = nextPlan;
      memory = freshMemory();
      memory.status = "running";
      memory.phase = "Starting";
      memory.why = `Starting with ${nextPlan.agentName ?? "the agent"} at ${
        nextPlan.agentStationName ?? "their station"
      }.`;
      runToken += 1;
      // The opening balance, so what a mission PAID can be measured rather than
      // read off a field that has been seen to lie.
      void (async () => {
        const opening = await deps.getBalances().catch(() => null);
        if (opening) {
          memory.startISK = opening.isk;
          memory.startLP = opening.lp;
        }
      })();
      emit();
    },
    pause(): void {
      if (memory.status === "running") {
        memory.status = "paused";
        memory.phase = "Paused";
        memory.action = null;
        memory.why = "You paused the bot. Your ship keeps doing whatever it was last told to.";
        runToken += 1;
        emit();
      }
    },
    resume(): void {
      if (memory.status === "paused") {
        memory.status = "running";
        memory.failureReason = null;
        memory.phase = "Resuming";
        memory.why = "Picking up where it left off.";
        // A resume is CONSENT TO TRY AGAIN. Every bound counter is spent state
        // from the run that paused — left in place, the first post-resume tick
        // re-decides the same action, trips the same spent bound, and pauses
        // with the identical message: resume that can never work. Mission
        // progress (completions, earnings, the flight in hand) is kept.
        memory.requestAttempts = 0;
        memory.acceptAttempts = 0;
        memory.declineAttempts = 0;
        memory.loadAttempts = 0;
        memory.unloadAttempts = 0;
        memory.completeAttempts = 0;
        memory.travelRestarts = 0;
        memory.travelWaitCycles = 0;
        memory.readFailures = 0;
        memory.actionTransportFailures = 0;
        memory.sessionChangeWaits = 0;
        memory.stuckWaitReason = null;
        memory.stuckWaitTicks = 0;
        runToken += 1;
        emit();
      }
    },
    stop(): void {
      if (memory.status === "running" || memory.status === "paused") {
        memory.status = "stopped";
        memory.phase = "Stopped";
        memory.action = null;
        memory.why = "You stopped the bot. It will not send your ship any more orders.";
        runToken += 1;
        deps.stopTravel();
        emit();
      }
    },
    tick,
    run,
    snapshot,
  };
}
