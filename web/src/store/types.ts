// Domain row types shared by the client-state store and the bridge decoders.
// These are the *decoded* browser-side shapes; the marshaled wire shapes
// (util.KeyVal rows, {type:"long"} wrappers, ...) live in ../bridge/wire.ts.

/**
 * One character row from the reference call
 * charUnboundMgr.GetCharacterSelectionData (docs/bridge-wire-contract.md),
 * decoded from its util.KeyVal wire row. FILETIME fields arrive as
 * {type:"long"} wrappers (BigInt encoded as decimal string, or plain number)
 * and are decoded to bigint.
 */
/**
 * The character brought online on the persistent browser-backed session
 * (goal R2): the session echo the BFF returns from POST /api/bridge/select.
 */
export interface OnlineCharacterState {
  readonly characterID: number;
  readonly characterName: string;
  readonly stationID: number | null;
  readonly structureID: number | null;
  readonly solarSystemID: number | null;
  readonly corporationID: number | null;
}

/**
 * Client-local static station identity (names stay client-side, exactly as
 * the retail client resolves station names from its static DB). Provided by
 * the BFF's read-only static reference data in the select response.
 */
export interface StationStatic {
  readonly stationID: number;
  readonly stationName: string;
  readonly solarSystemName: string;
  readonly regionName: string;
  readonly stationTypeID: number | null;
  readonly stationTypeName: string | null;
  readonly operationID: number | null;
  readonly security: number | null;
}

/**
 * The docked station-services row from stationSvc.GetStationItemBits:
 * retail builds Row(ownerID, itemID, operationID, stationTypeID) from this
 * tuple (eve/client/script/ui/station/base.py:575).
 */
export interface StationServiceBits {
  readonly ownerID: number | null;
  readonly stationID: number | null;
  readonly operationID: number | null;
  readonly stationTypeID: number | null;
}

/** One docked guest from station.GetGuests: (charID, corp, alliance, warFaction). */
export interface StationGuest {
  readonly characterID: number;
  readonly corporationID: number | null;
  readonly allianceID: number | null;
  readonly warFactionID: number | null;
}

/**
 * One decoded inventory row from an invbroker List (goal R3), from either a
 * packedrow list or an (empty) python set. The bound OID that produced it never
 * reaches the browser; the BFF holds it and the browser addresses items by
 * these game IDs.
 */
export interface InventoryItemRow {
  readonly itemID: number;
  readonly typeID: number;
  readonly groupID: number | null;
  readonly categoryID: number | null;
  readonly flagID: number | null;
  readonly quantity: number;
  readonly singleton: boolean;
}

/** Decoded invbroker.GetCapacity result (util.KeyVal {capacity, used}). */
export interface CapacityInfo {
  readonly capacity: number;
  readonly used: number;
}

/** One inventory container's decoded reads (hangar or active-ship cargo). */
export interface InventoryContainerState {
  readonly rows: readonly InventoryItemRow[];
  readonly capacity: CapacityInfo | null;
  /** Non-null when this container's read failed (the other container still shows). */
  readonly error: string | null;
}

/**
 * The Inventory & Ship page state (goal R3): the docked station hangar and the
 * active ship's cargo, plus which ships in the hangar can be boarded (derived
 * from the hangar rows: category 6 items that are not already active).
 */
export interface InventoryState {
  readonly stationID: number | null;
  readonly activeShipID: number | null;
  readonly hangar: InventoryContainerState;
  readonly cargo: InventoryContainerState;
  /** True once a panel load has populated the slice. */
  readonly loaded: boolean;
  /** Non-null when the last mutation (move/stack/board) failed. */
  readonly actionError: string | null;
}

// --- R4 Agents & Missions --------------------------------------------------

/**
 * One agent at the docked station (agentMgr.GetAgents, decoded + filtered to
 * the station by the BFF). The browser addresses the agent by agentID.
 */
export interface AgentRow {
  readonly agentID: number;
  readonly agentTypeID: number | null;
  readonly divisionID: number | null;
  readonly level: number | null;
  readonly stationID: number | null;
  readonly corporationID: number | null;
  readonly missionKind: string | null;
  readonly missionTypeLabel: string | null;
}

/**
 * One available conversation action from a DoAction result. `actionID` is the
 * server-assigned dialogue token the UI sends back to DoAction; `buttonType` is
 * the retail dialogue-button constant (2=Request, 3=Accept, 6=Complete,
 * 9=Decline, 11=Quit, ...) that selects the presentation/label.
 */
export interface AgentAction {
  readonly actionID: number;
  readonly buttonType: number;
  readonly label: string;
}

/** The last-action-info flags a DoAction result carries. */
export interface AgentLastActionInfo {
  readonly missionCompleted: boolean | null;
  readonly missionDeclined: boolean | null;
  readonly missionQuit: boolean | null;
  readonly loyaltyPoints: number | null;
}

/** A decoded agent conversation: what the agent says + the action buttons. */
export interface AgentConversation {
  readonly agentSays: string;
  readonly contentID: number | null;
  readonly actions: readonly AgentAction[];
  readonly lastActionInfo: AgentLastActionInfo;
}

/**
 * The courier briefing decoded from GetMissionBriefingInfo +
 * GetMissionObjectiveInfo. ISK amounts and FILETIMEs are kept as decimal
 * strings (bigint-safe — ISK can exceed 2^53), decoded with unwrapLong; never
 * the lossy `typeof === "number" ? … : 0` pattern.
 */
export interface CourierBriefing {
  readonly missionTitleID: number | null;
  readonly cargoTypeID: number | null;
  readonly cargoQuantity: number | null;
  readonly cargoVolume: number | null;
  readonly pickupLocationID: number | null;
  readonly pickupSystemID: number | null;
  readonly destinationLocationID: number | null;
  readonly destinationSystemID: number | null;
  readonly rewardISK: string | null;
  readonly bonusISK: string | null;
  readonly loyaltyPoints: number | null;
  readonly expirationTime: string | null;
  readonly acceptTimestamp: string | null;
}

/** One journal mission row (active or offered) from GetMyJournalDetails. */
export interface JournalMission {
  readonly missionState: number | null;
  readonly missionTypeLabel: string | null;
  readonly missionTitleID: number | null;
  readonly agentID: number | null;
  readonly missionID: number | null;
  readonly expirationTime: string | null;
}

/** The decoded mission journal: active + offered missions. */
export interface JournalState {
  readonly active: readonly JournalMission[];
  readonly offered: readonly JournalMission[];
}

/**
 * The Agents & Missions page state (goal R4): the station's agents, the open
 * conversation, the accepted-courier briefing, and the mission journal. The
 * browser addresses agents by game ID; the BFF holds the bound agent handles.
 */
export interface AgentsState {
  readonly stationID: number | null;
  readonly agents: readonly AgentRow[];
  readonly activeAgentID: number | null;
  readonly conversation: AgentConversation | null;
  readonly briefing: CourierBriefing | null;
  readonly journal: JournalState | null;
  /** True once the agent list has loaded. */
  readonly loaded: boolean;
  /** Non-null when the last agent action/read failed (non-fatally). */
  readonly actionError: string | null;
}

// --- R6 Courier completion reward readout (Step 12) ------------------------

/**
 * One character loyalty-point balance from
 * LPSvc.GetAllMyCharacterWalletLPBalances: the issuing corp and the amount.
 * LP is kept as a bigint-safe decimal string (the decoder rule for LP/ISK).
 */
export interface WalletLPBalance {
  readonly issuerCorpID: number;
  readonly loyaltyPoints: string;
}

/**
 * One character standing row from standingMgr.GetCharStandings: the standing
 * the character holds toward `fromID`. `standing` is a small float (‑10..10),
 * kept as a number.
 */
export interface CharStanding {
  readonly fromID: number;
  readonly standing: number;
}

/**
 * The post-completion reward readout (goal R6, inventory Step 12): the pull
 * reads a wallet/LP/standings panel issues after Complete pays out
 * (account.GetCashBalance / LPSvc.GetAllMyCharacterWalletLPBalances /
 * standingMgr.GetCharStandings). The mission journal (the fourth Step-12 read)
 * lives in the agents slice (`agents.journal`) and refreshes on the same
 * Complete. Each read is independent (Promise.allSettled on the BFF); a failed
 * read carries its own error code. ISK/LP are decimal strings (bigint-safe).
 */
export interface RewardsState {
  /** Personal ISK balance (account.GetCashBalance), decimal string; null until read. */
  readonly cashBalance: string | null;
  readonly lpBalances: readonly WalletLPBalance[];
  readonly standings: readonly CharStanding[];
  /** True once a reward read has populated the slice. */
  readonly loaded: boolean;
  /** Non-null when one or more of the reward reads failed (non-fatally). */
  readonly error: string | null;
}

// --- R5a Flight (manually-stepped space movement) --------------------------

/**
 * The flight status snapshot (goal R5a): the persistent session's current
 * location + ship movement state, read from the gateway's
 * session/flight-status. IDs decode with unwrapLong (long-aware); system,
 * station, and ship IDs all fit in 2^53, so they are kept as `number`.
 * `shipMode` is the scene entity's movement mode (e.g. WARP / STOP), null when
 * docked or unavailable.
 */
export interface FlightStatus {
  readonly inSpace: boolean;
  readonly docked: boolean;
  readonly solarSystemID: number | null;
  readonly stationID: number | null;
  readonly structureID: number | null;
  readonly shipID: number | null;
  readonly shipMode: string | null;
  readonly shipSpeedFraction: number | null;
}

/**
 * The Flight page state (goal R5a): the current flight status plus the last
 * movement step issued and any refusal reason. Manual single-step movement —
 * the browser sequences undock/warp/jump/dock via buttons; the autopilot
 * decide-loop is R5b.
 */
export interface FlightState {
  readonly status: FlightStatus | null;
  /** True once a flight-status read has populated the slice. */
  readonly loaded: boolean;
  /** The last movement step issued (for the status readout). */
  readonly lastAction: string | null;
  /** Non-null when the last movement step failed (the handler's refusal reason). */
  readonly actionError: string | null;
}

// --- R5b Travel (browser autopilot decide-loop) ----------------------------

/**
 * One hop of a planned route for the travel panel: the systems and, per hop,
 * the source stargate to warp to (and jump through) and the gate on the far
 * side, with names resolved for display. Mirrors the route solver's RouteHop.
 */
export interface TravelRouteStep {
  readonly fromSystemID: number;
  readonly toSystemID: number;
  readonly gateToWarpID: number;
  readonly jumpToGateID: number;
  readonly fromSystemName: string | null;
  readonly toSystemName: string | null;
}

export type TravelStatus =
  | "idle"
  | "running"
  | "paused"
  | "arrived"
  | "aborted"
  | "error";

/**
 * The travel-panel state (goal R5b): the destination, the computed route, and
 * the live autopilot readout (current/next system, travel state, remaining
 * jumps, elapsed time, failure reason). The decide-loop runs in the browser and
 * pushes progress here; the panel is a pure reader. `startedAt` is the loop's
 * start epoch (the panel ticks elapsed time locally so the store stays quiet).
 */
export interface TravelState {
  readonly status: TravelStatus;
  readonly destinationSystemID: number | null;
  readonly destinationStationID: number | null;
  readonly destinationName: string | null;
  readonly route: readonly TravelRouteStep[];
  readonly currentSystemID: number | null;
  readonly currentSystemName: string | null;
  readonly nextSystemID: number | null;
  readonly nextSystemName: string | null;
  /** The current action label (e.g. "Warp to gate 50000802", "Docking"). */
  readonly action: string | null;
  /** The travel-state text (e.g. "In warp", "Jumping", "Docked"). */
  readonly phase: string | null;
  readonly remainingJumps: number;
  readonly totalJumps: number;
  readonly startedAt: number | null;
  /** Actionable failure reason (the handler's own refusal, or a plan error). */
  readonly failureReason: string | null;
}

export interface CharacterSummary {
  readonly characterID: number;
  readonly characterName: string;
  readonly gender: number | null;
  readonly typeID: number | null;
  readonly corporationID: number | null;
  readonly allianceID: number | null;
  readonly stationID: number | null;
  readonly solarSystemID: number | null;
  readonly regionID: number | null;
  readonly balance: number | null;
  readonly skillPoints: number | null;
  readonly shipTypeID: number | null;
  readonly shipName: string | null;
  readonly securityStatus: number | null;
  readonly title: string | null;
  readonly unreadMailCount: number | null;
  readonly logoffDate: bigint | null;
  readonly skillTypeID: number | null;
  readonly toLevel: number | null;
  readonly trainingStartTime: bigint | null;
  readonly trainingEndTime: bigint | null;
  readonly queueEndTime: bigint | null;
}
