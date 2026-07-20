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

// --- R12 Ship fitting ------------------------------------------------------

/** The slot families a fitting window groups modules into. */
export type SlotFamily = "high" | "mid" | "low" | "rig" | "subsystem";

/** A module sitting in a slot. Named in the UI by typeID via the name cache. */
export interface FittedModule {
  readonly itemID: number;
  readonly typeID: number;
  readonly groupID: number | null;
  /** True when the server reports this module as currently online. */
  readonly online: boolean;
}

/**
 * One slot of the active ship, empty or filled. `index` is the slot's position
 * within its family — the browser addresses a slot by (family, index) and
 * never by its flagID, which lives only on the BFF and in bridge/fitting.ts.
 */
export interface FittingSlot {
  readonly family: SlotFamily;
  readonly index: number;
  readonly module: FittedModule | null;
}

/** One used-vs-total reading (CPU, powergrid, capacitor, calibration). */
export interface FittingResource {
  readonly used: number;
  readonly total: number;
  /** False when the ship reported no total; the bar renders as unknown. */
  readonly known: boolean;
}

export interface FittingResources {
  readonly cpu: FittingResource;
  readonly powergrid: FittingResource;
  readonly capacitor: FittingResource;
  readonly calibration: FittingResource;
}

/**
 * The Fitting page state (goal R12): the active ship's slots by family with
 * what is fitted in each, plus the ship's resource readings. Every read is
 * independent on the BFF, so a failed one carries its own error and never
 * blanks the rest.
 */
export interface FittingState {
  readonly activeShipID: number | null;
  readonly slots: readonly FittingSlot[];
  readonly resources: FittingResources;
  /** True once a fitting read has populated the slice. */
  readonly loaded: boolean;
  /** Non-null when the slot read failed (the resource bars still show). */
  readonly slotsError: string | null;
  /** Non-null when the resource read failed (the slots still show). */
  readonly resourcesError: string | null;
  /** Non-null when the last fitting action failed or was declined. */
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

// --- R6a Agent Finder ------------------------------------------------------

/**
 * One agent from the static agentAuthority reference table (goal R6a), with its
 * station/system names resolved server-side and its jump distance from the
 * player's current system computed client-side (a single BFS — distancesFrom).
 * `jumps` is null when the agent's system is unreachable or the origin is
 * unknown; the finder sorts those last. The browser addresses the agent by
 * agentID (to bind it on arrival via the R4 agent flow) and by stationID (for
 * the R5b "Set destination" autopilot).
 */
export interface AgentFinderRow {
  readonly agentID: number;
  readonly name: string;
  readonly level: number | null;
  readonly missionKind: string | null;
  readonly missionTypeLabel: string | null;
  readonly corporationID: number | null;
  readonly factionID: number | null;
  readonly stationID: number | null;
  readonly stationName: string | null;
  readonly solarSystemID: number | null;
  readonly solarSystemName: string | null;
  /** Jumps from the player's current system; null = unreachable / unknown origin. */
  readonly jumps: number | null;
}

/**
 * The agent the player set the autopilot to (so the panel can show who they are
 * flying to). A projection of the chosen AgentFinderRow.
 */
export interface AgentFinderTarget {
  readonly agentID: number;
  readonly name: string;
  readonly level: number | null;
  readonly stationID: number | null;
  readonly stationName: string | null;
  readonly solarSystemID: number | null;
  readonly solarSystemName: string | null;
  readonly jumps: number | null;
}

/**
 * The Agent Finder page state (goal R6a): the filtered/capped agents (already
 * annotated with jumps and sorted nearest-first by the flow), the filter echo,
 * and the currently-selected destination agent. The full ~11k-agent dataset is
 * never held here — the BFF filters by kind/level and caps; `total`/`capped`
 * report how much was matched vs returned so the UI can prompt for a narrower
 * filter. The rendered rows are further capped in the view (like R6's roster).
 */
export interface AgentFinderState {
  readonly kind: string;
  readonly level: number | null;
  readonly originSystemID: number | null;
  readonly agents: readonly AgentFinderRow[];
  /** Full match count before the server cap. */
  readonly total: number;
  /** True when the server cap dropped some matches (narrow the filter). */
  readonly capped: boolean;
  /** True once a find has populated the slice. */
  readonly loaded: boolean;
  readonly target: AgentFinderTarget | null;
  /** Non-null when the last find failed (non-fatally). */
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
  /**
   * Resolved location names for the current status (goal R7a), so the readout
   * shows "Jita" not "30000142". Resolved from the static /api/map routes and
   * cached client-side by the flow; null until resolved (the UI falls back to
   * the raw ID) and cleared whenever the corresponding ID changes.
   */
  readonly solarSystemName: string | null;
  readonly stationName: string | null;
  readonly structureName: string | null;
}

// --- R11 Space overview + ship HUD -----------------------------------------

/** A position or velocity in space (metres, metres/second). */
export interface SpaceVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * One object the ship can see (goal R11). This is the browser's half of the
 * structure retail's overview reads: the server hands over identity, position
 * and velocity, and the CLIENT computes distance, sorting and filtering — the
 * same division the real client uses. `typeID`/`groupID`/`categoryID` exist so
 * the name cache can resolve a TYPE and GROUP name; they are never rendered
 * (R7d). Health fields are remaining fractions (0-1) or null for an object with
 * no damageable health (a planet, a stargate).
 */
export interface SpaceEntity {
  /** Coarse runtime kind ("ship", "structure", "celestial", …), or null. */
  readonly kind: string | null;
  /** The object's own id — used only as a row key and as a move target. */
  readonly itemID: number;
  readonly typeID: number | null;
  readonly groupID: number | null;
  readonly categoryID: number | null;
  /** The object's own name where it has one (a celestial, a named ship). */
  readonly name: string | null;
  readonly ownerID: number | null;
  readonly radius: number;
  readonly position: SpaceVector;
  readonly velocity: SpaceVector;
  /** True for the player's own ship (excluded from the overview list). */
  readonly isSelf: boolean;
  readonly shieldRatio: number | null;
  readonly armorRatio: number | null;
  readonly hullRatio: number | null;
  readonly characterID: number | null;
  readonly corporationID: number | null;
  readonly allianceID: number | null;
  readonly securityStatus: number | null;
  readonly maxVelocity: number | null;
  readonly mode: string | null;
  readonly capacitorRatio: number | null;
}

/**
 * The active ship's HUD numbers (goal R11). A DIFFERENT source from the
 * overview: shield / armor / hull / capacitor for the player's own ship come
 * from the ship item's dogma-backed state, not from the ballpark the overview
 * enumerates. Ratios are remaining fractions (0-1); capacities are the max HP
 * behind each bar (null when unavailable).
 */
export interface SpaceShipStatus {
  readonly itemID: number | null;
  readonly typeID: number | null;
  readonly name: string | null;
  readonly mode: string | null;
  readonly maxVelocity: number | null;
  /**
   * The ship's own hull radius, so the client can measure SURFACE distance the
   * way the server does — max(0, centre-to-centre - rA - rB). The autopilot
   * decides jump / dock / approach / warp from that measure (goal R13).
   */
  readonly radius: number;
  readonly position: SpaceVector;
  readonly velocity: SpaceVector;
  readonly shieldRatio: number | null;
  readonly armorRatio: number | null;
  readonly hullRatio: number | null;
  readonly capacitorRatio: number | null;
  readonly shieldCapacity: number | null;
  readonly armorCapacity: number | null;
  readonly hullCapacity: number | null;
}

/** One decoded space snapshot: everything visible plus the active ship. */
export interface SpaceSnapshot {
  readonly inSpace: boolean;
  readonly solarSystemID: number | null;
  readonly shipID: number | null;
  /** Server sim time the snapshot was taken at (tells two polls apart). */
  readonly sampledAtMs: number | null;
  readonly entities: readonly SpaceEntity[];
  readonly ship: SpaceShipStatus | null;
}

/**
 * The Overview panel state (goal R11). The flow polls the snapshot ~1s while
 * the ship is in space and the panel is open, and pushes each read here; the
 * panel is a pure reader that derives distances, sorting and filtering itself.
 */
export interface SpaceState {
  readonly snapshot: SpaceSnapshot | null;
  /** True once a snapshot read has populated the slice. */
  readonly loaded: boolean;
  /** Non-null when the last snapshot read failed (non-fatally). */
  readonly error: string | null;
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

/**
 * One destination match from the Travel-tab name search (goal R7a): a solar
 * system or station resolved from the static /api/map/find route, annotated with
 * jumps from the current system (best-effort, like the Agent Finder). `id` is
 * the ID handed to flow.startRoute (the R5b route solver + autopilot). This is a
 * transient search result (not held in the store); the Travel component keeps it
 * in local state.
 */
export interface DestinationMatch {
  readonly id: number;
  readonly name: string;
  readonly kind: "system" | "station";
  readonly solarSystemID: number | null;
  readonly solarSystemName: string | null;
  /** Jumps from the player's current system; null = unreachable / unknown origin. */
  readonly jumps: number | null;
}

// --- R7 Local + Corp chat --------------------------------------------------

/** One member of a chat channel (Local occupants / Corp members). */
export interface ChatMember {
  readonly characterID: number;
  readonly name: string;
  readonly corporationID: number | null;
  readonly allianceID: number | null;
  readonly solarSystemID: number | null;
}

/** One backlog message in a chat channel. */
export interface ChatMessage {
  readonly characterID: number;
  readonly characterName: string;
  readonly message: string;
  readonly createdAtMs: number;
}

/** One channel's decoded state: its room, roster, and recent backlog. */
export interface ChatChannelState {
  readonly roomName: string | null;
  readonly corporationID: number | null;
  readonly solarSystemID: number | null;
  readonly roster: readonly ChatMember[];
  readonly messages: readonly ChatMessage[];
  readonly loaded: boolean;
}

export type ChatChannel = "local" | "corp";

/**
 * The Chat panel state (goal R7): Local and Corp sub-channels, each with a
 * member roster + message backlog, plus the active tab and any send/read error.
 * READ is a backlog poll (chat delivery bypasses the notification drain), so the
 * panel polls while open and the flow pushes each fresh read here; the panel is
 * a pure reader.
 */
export interface ChatState {
  readonly activeChannel: ChatChannel;
  readonly local: ChatChannelState;
  readonly corp: ChatChannelState;
  readonly error: string | null;
}

// --- R10 live event channel ------------------------------------------------

/**
 * How the live push channel (gateway WebSocket -> BFF SSE -> browser) is doing.
 * "live" means events are arriving; anything else means the page is back on its
 * safety-net polls. Nothing about correctness depends on this — every bridge
 * response still carries its notification drain — so it drives poll cadence,
 * not what the player is shown.
 */
export type LiveStreamStatus = "idle" | "connecting" | "live" | "degraded" | "ended";

/**
 * One session notification pushed over the live channel: the same shape the
 * response drain carries (`kind` is the ClientSession surface that produced it).
 */
export interface LiveNotification {
  readonly kind: string;
  readonly service: string | null;
  readonly method: string | null;
  readonly receivedAtMs: number;
}

/**
 * The live channel slice (goal R10). Holds the connection status, the cursor
 * last seen (so a reconnect can resume), and a bounded tail of the session
 * notifications that arrived — which is where the drained `notifications` the
 * page used to discard now actually land.
 */
export interface LiveState {
  readonly status: LiveStreamStatus;
  readonly epoch: string | null;
  readonly sequence: number;
  readonly notifications: readonly LiveNotification[];
  readonly lastEventAtMs: number | null;
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
