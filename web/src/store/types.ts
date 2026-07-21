// Domain row types shared by the client-state store and the bridge decoders.
// These are the *decoded* browser-side shapes; the marshaled wire shapes
// (util.KeyVal rows, {type:"long"} wrappers, ...) live in ../bridge/wire.ts.

import type { ShipStats } from "../bridge/shipStats.ts";

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
  // --- R14 inventory depth ---
  /** The items ticked for a bulk move / trash, by itemID. */
  readonly selection: readonly number[];
  /** The container currently open, or null when browsing the top level. */
  readonly container: OpenContainerState | null;
  /** The corporation hangar at this station. */
  readonly corp: CorpHangarState;
  /**
   * What the LAST mutation actually did, re-read from the server rather than
   * echoed from the request. `applied: false` with no reason is a silent
   * decline — the server refused without saying why, and the UI says exactly
   * that instead of inventing a cause.
   */
  readonly lastOutcome: MutationOutcome | null;
}

// --- R14 inventory depth ----------------------------------------------------

/**
 * A place items can live. The browser names a place; the retail flagIDs that
 * back them (4 hangar, 5 cargo, 0 container contents, 115-121 corporation
 * divisions) live on the BFF and never reach here.
 */
export type InventoryPlace =
  | { readonly kind: "hangar" }
  | { readonly kind: "cargo" }
  | { readonly kind: "container"; readonly itemID: number }
  | { readonly kind: "corp"; readonly division: number };

/**
 * An open container. Its contents are read with a NO-FLAG List on the BFF
 * (container contents carry flagID 0), but that is a wire detail — here it is
 * just another set of rows.
 */
export interface OpenContainerState {
  readonly itemID: number;
  readonly typeID: number;
  readonly rows: readonly InventoryItemRow[];
  readonly capacity: CapacityInfo | null;
  readonly error: string | null;
}

/** One corporation hangar division, addressed by ordinal and shown by NAME. */
export interface CorpDivisionState {
  /** 1-7. Never rendered — it selects the division, the name labels it. */
  readonly division: number;
  /**
   * The corporation's own name for this division, or null when it was never
   * renamed (the UI then falls back to "Division N" — never a flag number).
   */
  readonly name: string | null;
  readonly rows: readonly InventoryItemRow[];
  readonly error: string | null;
}

/**
 * The corporation hangar at the docked station. `available: false` is the
 * ordinary case of a character whose corporation rents no office here — not an
 * error state.
 */
export interface CorpHangarState {
  readonly available: boolean;
  /** Why the hangar is unavailable, when it is. */
  readonly reason: string | null;
  readonly divisions: readonly CorpDivisionState[];
  /** Which division the panel is showing. */
  readonly selectedDivision: number;
  readonly loaded: boolean;
}

/**
 * The honest result of a mutation. The BFF re-reads after every call because
 * invbroker declines silently — it returns null WITHOUT raising — so a 200 is
 * never proof. `declinedSilently` means the server refused and gave no reason.
 */
export interface MutationOutcome {
  readonly applied: boolean;
  readonly declinedSilently: boolean;
  /** A short player-facing summary of what actually happened. */
  readonly message: string;
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
  /**
   * R21 — the ship's derived statistics (resists, EHP, align time, speed,
   * targeting, bays), promoted from the SAME `ShipGetInfo` attribute map the
   * resource bars already read. Anything that could not be sourced carries
   * its reason instead of a number; see `bridge/shipStats.ts`.
   */
  readonly stats: ShipStats;
  /** True once a fitting read has populated the slice. */
  readonly loaded: boolean;
  /** Non-null when the slot read failed (the resource bars still show). */
  readonly slotsError: string | null;
  /** Non-null when the resource read failed (the slots still show). */
  readonly resourcesError: string | null;
  /** Non-null when the last fitting action failed or was declined. */
  readonly actionError: string | null;
}

// --- R15 Industry ----------------------------------------------------------

/**
 * The industry activities a blueprint can be put to. The browser works in
 * these NAMES throughout — an activityID is decoded to one of these the moment
 * it comes off the wire and never appears in rendered text (R7d).
 */
export type IndustryActivity =
  | "manufacturing"
  | "research_time"
  | "research_material"
  | "copying"
  | "invention"
  | "reaction";

/**
 * What a job is doing right now, as the SERVER computed it. `ready` is derived
 * server-side from the job's end date (an installed job whose clock ran out
 * reads back as ready), so the browser never does that arithmetic itself.
 */
export type IndustryJobStatus =
  | "unsubmitted"
  | "running"
  | "paused"
  | "ready"
  | "completed"
  | "delivered"
  | "cancelled"
  | "reverted";

/** One material line of a recipe: how much of a type an activity consumes. */
export interface IndustryMaterial {
  readonly typeID: number;
  readonly quantity: number;
}

/** One activity of a blueprint DEFINITION (static data): what it costs in
 * materials and time for a single run, and what it yields. */
export interface IndustryRecipe {
  readonly activity: IndustryActivity;
  readonly materials: readonly IndustryMaterial[];
  readonly products: readonly IndustryMaterial[];
  /** Base seconds for one run, before efficiency and facility modifiers. */
  readonly timeSeconds: number;
}

/** A blueprint DEFINITION from static data — the same for every player. */
export interface IndustryDefinition {
  readonly blueprintTypeID: number;
  readonly blueprintName: string | null;
  readonly productTypeID: number | null;
  readonly productName: string | null;
  readonly maxProductionLimit: number | null;
  readonly recipes: readonly IndustryRecipe[];
}

/**
 * One blueprint the PLAYER owns (blueprintManager.GetBlueprintDataByOwner).
 * Everything here is live and per-instance; the name and the recipe come from
 * the matching IndustryDefinition.
 */
export interface IndustryBlueprintRow {
  readonly itemID: number;
  readonly typeID: number;
  /** Percent of material saved. Shown as "Material efficiency", never "ME". */
  readonly materialEfficiency: number;
  /** Percent of time saved. Shown as "Time efficiency", never "TE". */
  readonly timeEfficiency: number;
  /** Runs left on a copy. Meaningless for an original, which never runs out. */
  readonly runs: number;
  /** True for an original (unlimited runs), false for a copy. */
  readonly original: boolean;
  readonly locationID: number;
  readonly facilityID: number | null;
  /** Non-null when this blueprint is busy in a job right now. */
  readonly jobID: number | null;
}

/** One of the player's industry jobs (industryManager.GetJobsByOwner). */
export interface IndustryJobRow {
  readonly jobID: number;
  readonly activity: IndustryActivity | null;
  readonly status: IndustryJobStatus;
  readonly blueprintID: number;
  readonly blueprintTypeID: number;
  readonly productTypeID: number;
  readonly facilityID: number;
  readonly runs: number;
  readonly successfulRuns: number;
  /** Installation cost the server charged, in ISK. */
  readonly cost: number;
  /** Retail FILETIME; the panel renders these as a finish time / countdown. */
  readonly startDate: bigint | null;
  readonly endDate: bigint | null;
  readonly timeSeconds: number;
}

/** A facility the player's region offers (facilityManager.GetFacilities). */
export interface IndustryFacilityRow {
  readonly facilityID: number;
  readonly solarSystemID: number;
  readonly typeID: number;
  readonly ownerID: number;
  readonly online: boolean;
  /** Facility tax as a FRACTION (0.01 = 1%); the panel renders a percentage. */
  readonly tax: number | null;
  /** Which activities this facility will host, by name. */
  readonly activities: readonly IndustryActivity[];
}

/** How many job slots of each activity the character currently has in use. */
export type IndustrySlotUsage = Partial<Record<IndustryActivity, number>>;

/**
 * The Industry page state (goal R15). Each of the five BFF reads is
 * independent, so each carries its own error and a failed one never blanks the
 * rest — a player with no facilities in range still sees their blueprints.
 */
export interface IndustryState {
  readonly ownerID: number | null;
  readonly stationID: number | null;
  readonly solarSystemID: number | null;
  readonly blueprints: readonly IndustryBlueprintRow[];
  readonly jobs: readonly IndustryJobRow[];
  readonly facilities: readonly IndustryFacilityRow[];
  readonly slotsUsed: IndustrySlotUsage;
  /** Static recipes keyed by blueprintTypeID, filled in after the live read. */
  readonly definitions: Readonly<Record<number, IndustryDefinition | null>>;
  readonly loaded: boolean;
  readonly blueprintsError: string | null;
  readonly jobsError: string | null;
  readonly facilitiesError: string | null;
  /** Non-null when the last install/deliver/cancel failed or was declined. */
  readonly actionError: string | null;
}

// --- R16 Market ------------------------------------------------------------
//
// ⚠ MONEY IS A DECIMAL STRING HERE, NEVER A NUMBER. ISK in EveJS routinely
// exceeds 2^53, so every price, escrow figure and balance below is the exact
// decimal string the server sent (R7d), formatted for display by
// bridge/market.ts. Quantities and jump counts are small integers and stay
// numbers.
//
// ⚠ AN ORDER IS IDENTIFIED BY ITS orderID, WHICH IS NEVER RENDERED. It is a
// handle the panel passes back to cancel or modify; the player sees the item,
// the place and the price instead.

/** Which side of the book an order sits on. */
export type MarketSide = "buy" | "sell";

/** One order in an item's public order book (marketProxy.GetOrders). */
export interface MarketOrderRow {
  /** Bigint-safe handle. Passed back to the server; never shown (R7d). */
  readonly orderID: string;
  readonly side: MarketSide;
  readonly typeID: number;
  readonly stationID: number;
  readonly solarSystemID: number;
  readonly regionID: number;
  /** ISK per unit, as a decimal string. */
  readonly price: string;
  readonly volumeRemaining: number;
  readonly volumeEntered: number;
  /** The smallest quantity this order will trade in one go. */
  readonly minimumVolume: number;
  /** How far the order REACHES, in jumps (-1 station, 32767 region). */
  readonly range: number;
  /** How far AWAY it is from the player — computed by the SERVER. */
  readonly jumps: number;
  readonly durationDays: number;
  /** Retail FILETIME; rendered as a date, never as a number. */
  readonly issuedAt: bigint | null;
}

/** What became of one of the player's own orders. */
export type MarketOwnFillState = "open" | "filled" | "expired" | "cancelled";

/** One of the player's own orders (GetCharOrders / GetMarketOrderHistory). */
export interface MarketOwnOrderRow {
  readonly orderID: string;
  readonly side: MarketSide;
  readonly typeID: number;
  readonly stationID: number;
  readonly solarSystemID: number;
  readonly price: string;
  readonly volumeRemaining: number;
  readonly volumeEntered: number;
  readonly minimumVolume: number;
  readonly range: number;
  readonly durationDays: number;
  /** ISK the SERVER has locked behind a buy order, as a decimal string. */
  readonly escrow: string;
  readonly state: MarketOwnFillState;
  readonly issuedAt: bigint | null;
  /** True for a corporation order. Out of scope to place, but shown if present
   * so the player is never given a partial picture of their own market. */
  readonly isCorp: boolean;
}

/** One completed trade (marketProxy.CharGetTransactions). */
export interface MarketTransactionRow {
  readonly transactionID: string;
  readonly typeID: number;
  readonly quantity: number;
  /** ISK per unit, as a decimal string. */
  readonly price: string;
  readonly stationID: number;
  /** Derived by comparing buyerID/sellerID with the character's own id. */
  readonly side: "bought" | "sold" | null;
  readonly transactedAt: bigint | null;
}

/** What the player currently has locked up behind open orders. */
export interface MarketEscrow {
  /** ISK locked behind buy orders, as a decimal string. */
  readonly isk: string;
  /** Units of goods locked behind sell orders. */
  readonly items: number;
}

/** One day of an item's price history. */
export interface MarketPriceHistoryRow {
  readonly day: bigint | null;
  readonly low: string;
  readonly high: string;
  readonly average: string;
  readonly volume: number;
  readonly orders: number;
}

/**
 * The Market page state (goal R16). The reads are INDEPENDENT — a failure to
 * read the public order book must not hide the player's own orders, and vice
 * versa — so each carries its own error.
 */
export interface MarketState {
  /** The item currently being looked at; null before one is chosen. */
  readonly typeID: number | null;
  readonly stationID: number | null;
  readonly solarSystemID: number | null;
  readonly sells: readonly MarketOrderRow[];
  readonly buys: readonly MarketOrderRow[];
  readonly ownOrders: readonly MarketOwnOrderRow[];
  readonly orderHistory: readonly MarketOwnOrderRow[];
  readonly transactions: readonly MarketTransactionRow[];
  readonly escrow: MarketEscrow | null;
  readonly priceHistory: readonly MarketPriceHistoryRow[];
  /** Personal ISK balance, decimal string (bigint-safe); null until read. */
  readonly cashBalance: string | null;
  readonly loaded: boolean;
  readonly bookError: string | null;
  readonly ownOrdersError: string | null;
  readonly transactionsError: string | null;
  /** Non-null when the market daemon itself is not answering. */
  readonly marketUnavailable: string | null;
  /** Non-null when the last place/cancel/modify failed or was declined. */
  readonly actionError: string | null;
  /**
   * What the LAST write actually did, read back from the server afterwards.
   * Never a prediction — see `MarketActionOutcome`.
   */
  readonly lastOutcome: MarketActionOutcome | null;
}

/**
 * The verdict on a completed write, assembled from RE-READS.
 *
 * ⚠ `charged` is the wallet balance BEFORE minus the balance AFTER — the only
 * authoritative statement about what an order cost. The estimated broker fee
 * shown at confirm time never appears here.
 */
export interface MarketActionOutcome {
  readonly kind: "buy" | "sell" | "cancel" | "modify";
  /** Did the server actually change anything? From the re-read, not the 200. */
  readonly applied: boolean;
  /** True when the server answered success and nothing moved. */
  readonly declinedSilently: boolean;
  /** ISK actually taken from (positive) or returned to (negative) the wallet. */
  readonly charged: string | null;
  /** The wallet balance after the write, as the server reports it. */
  readonly balanceAfter: string | null;
}

// --- R17 Mail ---------------------------------------------------------------

/**
 * One message HEADER from the delta sync.
 *
 * ⚠ `toCharacterIDs` is a COMMA-JOINED STRING on the wire and a real list on
 * the way back in (SendMail's args[0]). The two directions are not symmetric;
 * bridge/mail.ts splits the string in exactly one place, and by the time a row
 * reaches here it is already a proper list of ids.
 *
 * ⚠ `sentDate` is a retail FILETIME (100 ns ticks since 1601-01-01), which
 * exceeds 2^53 — so it stays a bigint until the moment it is rendered.
 */
export interface MailHeaderRow {
  readonly messageID: number;
  readonly senderID: number;
  readonly toCharacterIDs: readonly number[];
  /** Set when the message went to a mailing list (a surface out of this slice). */
  readonly toListID: number | null;
  /** Set when it went to a whole corporation or alliance. */
  readonly toCorpOrAllianceID: number | null;
  readonly title: string;
  readonly sentDate: bigint | null;
}

/** One status row: whether a message has been opened, and how it is filed. */
export interface MailStatusRow {
  readonly messageID: number;
  readonly statusMask: number;
  readonly labelMask: number;
  /** The read bit of statusMask, pulled out because it is the one that shows. */
  readonly read: boolean;
}

/** The body of the message currently open, as TEXT. */
export interface MailOpenMessage {
  readonly messageID: number;
  /**
   * ⚠ Already INFLATED. mailMgr.GetBody answers a zlib-DEFLATED buffer; the BFF
   * inflates it (src/server.js, mailBodyText) so this is plain text and the
   * browser never handles a compressed byte.
   */
  readonly body: string | null;
  /** True when the body arrived but would not inflate — say so, show no garbage. */
  readonly unreadable: boolean;
  /**
   * Whether the server now holds this message as read, from a RE-READ after
   * opening it. null when that re-read failed — in which case no claim is made.
   */
  readonly markedRead: boolean | null;
}

/**
 * The Mail page state (goal R17, Slice A).
 *
 * ⚠ The inbox arrives as a DELTA SYNC, not a list: SyncMail answers only what
 * falls outside the window the caller holds. The browser caches nothing across
 * a page load, so it is permanently cold and `messages` is always the whole
 * mailbox rather than a page of it.
 */
export interface MailState {
  readonly messages: readonly MailHeaderRow[];
  readonly statuses: readonly MailStatusRow[];
  /** How many are unread — what the tab badge shows. */
  readonly unreadCount: number;
  /** The message currently open, if any. */
  readonly open: MailOpenMessage | null;
  readonly loaded: boolean;
  readonly inboxError: string | null;
  /** Non-null when the last open/send failed or was declined. */
  readonly actionError: string | null;
  readonly lastOutcome: MailActionOutcome | null;
}

/** The verdict on a completed send, assembled from a RE-READ. */
export interface MailActionOutcome {
  readonly kind: "send";
  /** Did the message really land? From the sender-copy re-read, not the 200. */
  readonly applied: boolean;
  /** True when the server answered success and nothing was written. */
  readonly declinedSilently: boolean;
  /** How many people it went to. */
  readonly recipientCount: number;
  /**
   * What the server said, when it declined without giving a reason. Never a
   * cause this client invented.
   */
  readonly message: string | null;
}

// --- R17 Contracts ----------------------------------------------------------

/**
 * One contract.
 *
 * ⚠ `price`, `reward` and `collateral` are DECIMAL STRINGS, not numbers: ISK
 * exceeds 2^53 in ordinary play and routing it through a JS number would round
 * it on the way to the screen (R7d).
 *
 * ⚠ The four dates are retail FILETIMEs (100 ns ticks since 1601-01-01), which
 * exceed 2^53 — so they stay bigints until they are rendered.
 */
export interface ContractRow {
  readonly contractID: number;
  /** 1 item trade, 2 auction (stubbed server-side), 3 delivery job. */
  readonly type: number;
  readonly status: number;
  readonly availability: number;
  readonly issuerID: number;
  readonly issuerCorpID: number;
  readonly forCorp: boolean;
  /** Who it is reserved for; null when it is open to anyone. */
  readonly assigneeID: number | null;
  /** Who took it; null while nobody has. */
  readonly acceptorID: number | null;
  readonly dateIssued: bigint | null;
  readonly dateExpired: bigint | null;
  readonly dateAccepted: bigint | null;
  readonly dateCompleted: bigint | null;
  readonly numDays: number;
  readonly startStationID: number;
  readonly endStationID: number;
  readonly startSolarSystemID: number;
  readonly endSolarSystemID: number;
  readonly price: string | null;
  readonly reward: string | null;
  readonly collateral: string | null;
  /** Cubic metres of cargo. */
  readonly volume: number;
  readonly title: string;
  readonly description: string;
}

/** One item attached to a contract. */
export interface ContractItemRow {
  readonly typeID: number;
  readonly quantity: number;
  /**
   * True when the item is being HANDED OVER, false when it is being ASKED FOR
   * — the difference between a gift and a trade.
   */
  readonly inCrate: boolean;
}

/** One contract in full: the row, its items, and its route endpoints. */
export interface ContractDetail {
  readonly contract: ContractRow;
  readonly items: readonly ContractItemRow[];
  readonly startSolarSystemID: number;
  readonly endSolarSystemID: number;
}

/** The headline counts from GetLoginInfo. */
export interface ContractSummary {
  readonly needsAttention: number;
  readonly inProgress: number;
  readonly assignedToMe: number;
}

/**
 * The Contracts page state (goal R17, Slice B). READS ONLY — every contract
 * mutator is refused at the gateway, so there is no action state here.
 *
 * The reads are INDEPENDENT: a public browse that fails must not hide the
 * player's own contracts, so each keeps its own error.
 */
export interface ContractsState {
  /** The public courier browse. Legitimately EMPTY in a world with no contracts. */
  readonly browse: readonly ContractRow[];
  readonly numFound: number;
  readonly page: number;
  readonly pageSize: number;
  /** The player's own: issued and waiting, taken on, and expired. */
  readonly outstanding: readonly ContractRow[];
  readonly accepted: readonly ContractRow[];
  readonly expired: readonly ContractRow[];
  readonly summary: ContractSummary | null;
  /** The contract currently opened in full, if any. */
  readonly detail: ContractDetail | null;
  readonly loaded: boolean;
  readonly browseError: string | null;
  readonly mineError: string | null;
  readonly detailError: string | null;
  /**
   * ⚠ TRUE ONLY WHEN THE BROWSE SUCCEEDED AND FOUND NOTHING — never inferred
   * from an absence. EveJS has no NPC/seed contract generator, so an empty
   * public browse is EXPECTED, and the panel says so plainly. "The browse
   * failed" and "this world has no contracts yet" must never look alike.
   */
  readonly worldHasNoContracts: boolean;
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
  /**
   * R23 slice B — asteroid rows only (null on everything else).
   *
   * `name`/`typeID` already resolve to the ORE, because the server stamps a
   * rock's display name and slim type from the ore it holds. These three add
   * what a miner actually needs: which ore the laser yields, which belt the rock
   * belongs to, and HOW MUCH IS LEFT.
   *
   * `remainingQuantity` is null for "unknown" — either the row is not a rock, or
   * the server had no mining record for it. It is NEVER 0 to mean unknown: a
   * zero reads as a mined-out rock and would send a player past a full belt.
   */
  readonly remainingQuantity: number | null;
  readonly miningYieldTypeID: number | null;
  readonly beltID: number | null;
  /**
   * R25 slice B — SHIP rows only. The only thing that separates a pirate from a
   * person.
   *
   * ⚠ A belt rat is `kind: "ship"`. It is built through the same entity path as
   * the player parked next to you and carries the same name, position, health
   * and velocity fields, so `kind` cannot tell them apart and neither can
   * anything else this row carried before R25.
   *
   * `isNpc` is the runtime's own "nobody is flying this" flag. `npcEntityType`
   * is which KIND of NPC, verbatim from the runtime: "npc" (pirates — the thing
   * that shoots a miner), "concord" (law enforcement, which does not),
   * "drifter". Both are null/false on rows the gateway does not project them
   * for, so a non-ship row is never mistaken for a friendly ship.
   */
  readonly isNpc: boolean;
  readonly npcEntityType: string | null;
  /**
   * R25 slice A — DRONE rows only (null on everything else).
   *
   * `ownerID` (above) already says whose drone it is; `controllerID` says which
   * HULL is flying it, which is the question that matters after a ship swap.
   * `droneActivity` is what it is doing as a word ("idle", "fighting",
   * "mining", …) — NULL means the gateway could not tell, never "idle".
   * `targetEntityID` is the ball it is busy with, so the panel can name the rock
   * or the rat instead of reporting a bare "mining".
   */
  readonly controllerID: number | null;
  readonly droneActivity: string | null;
  readonly targetEntityID: number | null;
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
  /**
   * The fitted modules the SERVER says are cycling right now (goal R23). Read
   * from the ship entity's own active-effect map, never from the browser's
   * memory of what it clicked — otherwise the page would keep claiming a module
   * is running after the server short-cycled it (target lost, hold full, out of
   * range). Empty means nothing is running; null means the read could not
   * answer and the page must say "unknown", not "off".
   */
  readonly activeModuleIDs: readonly number[] | null;
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

// --- R23 slice A: targeting + module activation ----------------------------
//
// THE GENERIC IN-SPACE ACTION LAYER. Nothing here names mining, combat,
// salvaging or ewar, and nothing should: a target is a target, a module is a
// module, and which effect a module runs is an ARGUMENT the caller passes.
// Slice B drives a mining laser through this slice; a later combat goal drives
// a turret through the same slice unchanged.

/**
 * One target the ship has locked, or is still locking (goal R23).
 *
 * `name` is resolved from the space snapshot — the same row the overview shows
 * — so the locked list reads "Veldspar" or "Ibis", never an itemID (R7d). It is
 * null only while the target is not in the current snapshot (it warped off, or
 * the poll has not caught up), and the page shows a plain "out of view" label
 * rather than falling back to the number.
 */
export interface LockedTarget {
  readonly itemID: number;
  readonly name: string | null;
  /** The type behind the ball, so the panel can resolve a TYPE name. */
  readonly typeID: number | null;
  /** True while the server is still acquiring the lock (it is not usable yet). */
  readonly acquiring: boolean;
}

/**
 * The targeting + activation slice (goal R23 slice A).
 *
 * `lockedTargetIDs` is the server's answer to dogmaIM.GetTargets and is the
 * ONLY authority on what is locked — a 200 from a lock call is not proof, so
 * every mutation re-reads and lands here.
 *
 * `acquiringTargetIDs` is the browser's short-lived note of locks the server
 * ACCEPTED but has not finished acquiring. It is not a claim about server
 * state: an entry is dropped the moment the target appears in
 * `lockedTargetIDs`, and cleared outright when the ship leaves space.
 */
export interface TargetingState {
  readonly lockedTargetIDs: readonly number[];
  readonly acquiringTargetIDs: readonly number[];
  /** True once a GetTargets read has populated the slice. */
  readonly loaded: boolean;
  /** The last lock/unlock/activate action issued, for the status readout. */
  readonly lastAction: string | null;
  /** Non-null when the last action failed — the SERVER's own refusal reason. */
  readonly actionError: string | null;
  /**
   * Non-null when a call returned 200 but the re-read showed nothing changed
   * and the server gave no reason. This is deliberately a DIFFERENT field from
   * actionError: "it was refused, and here is why" and "it quietly did nothing"
   * are different things and the page says so.
   */
  readonly silentDecline: string | null;
  /**
   * R24 slice C — WHAT EACH MODULE'S CYCLE LOOKS LIKE, keyed by module itemID.
   *
   * Two independent facts live here and they are NOT interchangeable, which is
   * why `source` is on the record rather than in a comment:
   *
   *   "server"  the server told us, in an `OnGodmaShipEffect` cycle event
   *             (runtime.js:13012). That duration is the EFFECTIVE one — skills,
   *             role bonuses, rigs and heat already in it — and it is the only
   *             way the browser can ever know it, because there is still no
   *             allowlisted call returning effective per-module attributes.
   *   "base"    nobody has told us yet, so this is attribute 73 off the type,
   *             before any of that. A real number, but the STARTING point, and
   *             the page must say so.
   *
   * A module with no entry has no cycle we can speak to. That is not the same
   * as "instant" and must never render as one.
   */
  readonly moduleCycles: Readonly<Record<number, ModuleCycle>>;
  /**
   * R29 — THE SHOTS, newest last, as they were pushed.
   *
   * A survey concluded that no NPC emits damage and that this client therefore
   * could never show one. That was WRONG, and R29 settled it on the live wire:
   * sitting in a Perimeter belt with a rat shooting and nothing of ours firing,
   * 16 `OnDamageMessage` frames arrived naming the rat as source and our ship
   * as target. Killing it produced the mirror image. Both directions are real
   * and both are here.
   *
   * A BOUNDED TAIL, not a ledger. The push channel is lossy by design — the
   * gateway trims and blanks its buffer on resynchronise — so this is what we
   * were told about, never a running total to be trusted as arithmetic. Nothing
   * in the page sums it into a "total damage" figure, because a dropped frame
   * would make that figure quietly wrong forever.
   */
  readonly damageLog: readonly DamageEvent[];
}

/**
 * One shot, as `OnDamageMessage` reported it (R29).
 *
 * The direction is taken from the payload's own `attackType`, not inferred:
 * "me" is a shot WE fired, anything else is a shot fired at us. Measured
 * live — outgoing frames carry attackType "me" with a null attackerID, and
 * incoming carry "otherPlayerWeapons" with the attacker's id populated.
 */
export interface DamageEvent {
  /** Monotonic within the session, for keyed rendering only. Never shown. */
  readonly id: number;
  readonly direction: "dealt" | "taken";
  /** Who we hit, or who hit us. Named via the name cache — never shown raw. */
  readonly otherPartyID: number | null;
  /** The weapon's typeID, for naming. Null when the payload did not say. */
  readonly weaponTypeID: number | null;
  /** Damage this shot did. 0 is a real, meaningful value: a clean miss. */
  readonly amount: number;
  /**
   * The server's own hit-quality band, or null when absent. NOT translated to
   * retail's "Grazes"/"Wrecks" wording here: the mapping is not sourced from
   * this server, and inventing it would be fabricated detail.
   */
  readonly quality: number | null;
  /** Browser clock reading for when the frame arrived. */
  readonly atMs: number;
}

/** One module's cycle, and where the figure came from (R24 slice C). */
export interface ModuleCycle {
  /** One cycle's length in milliseconds. */
  readonly durationMs: number;
  /** "server" = the effective duration; "base" = attribute 73 off the type. */
  readonly source: "server" | "base";
  /**
   * Browser clock reading for when the running cycle was observed to start, or
   * null when the module is not known to be running. Deliberately the LOCAL
   * clock: the server's stamp is a Windows FILETIME on the server's clock, and
   * pretending we can line the two up would be fabricated precision. What we
   * honestly know is "the cycle had just started when this reached us".
   */
  readonly startedAtMs: number | null;
  /** True when the server said the effect repeats (a laser left running). */
  readonly repeating: boolean;
}

// --- R23 slice B: the mining loop ------------------------------------------
//
// mine -> haul -> refine -> sell. Note what is NOT modelled here: there is no
// mining cycle, no yield prediction and no rock countdown. Mining a rock is the
// GENERIC targeting slice above with a mining laser; this slice is only the
// places ore lives, what the scanner saw, and what the refinery quoted.

/** One reading of a hold: how much is in it, out of how much it holds. */
export interface HoldCapacity {
  /** Cubic metres the hold can take, or null when the ship did not say. */
  readonly capacity: number | null;
  readonly used: number | null;
}

/** One item sitting in a hold. Named in the UI by typeID via the name cache. */
export interface HoldItem {
  readonly itemID: number;
  readonly typeID: number;
  readonly quantity: number;
}

/**
 * One of the ship's mining holds (goal R23).
 *
 * The browser works in NAMES throughout: "Ore hold", "Ice hold", "Cargo hold".
 * The retail flagIDs behind them (134 / 135 / 181 / 182, falling back to cargo)
 * live only on the BFF and never reach here — R7d, and R9a's "ore hold, not
 * flag 134".
 */
export interface MiningHold {
  readonly key: string;
  readonly label: string;
  /** null when the read failed — "we could not look" is not "it is empty". */
  readonly items: readonly HoldItem[] | null;
  readonly capacity: HoldCapacity | null;
  /** False for a hull that simply does not have this hold; it is not shown. */
  readonly present: boolean;
  readonly error: string | null;
}

/**
 * One stack sitting in the ship's drone bay (goal R25). Named in the UI by
 * typeID via the name cache — the bay's flagID (87) lives only on the BFF, so
 * the browser has no idea that number exists (R7d).
 */
export interface DroneBayStack {
  readonly itemID: number;
  readonly typeID: number;
  readonly quantity: number;
}

/**
 * One drone the SERVER says is in space under this ship's control (goal R25).
 *
 * `activity` is a WORD ("idle", "fighting", "mining", …), never the runtime's
 * activity enum, and null means "we could not tell" — never "idle". A player
 * told their drones are idle when nobody looked will not launch the ones that
 * would have saved them.
 */
export interface DroneInSpace {
  readonly itemID: number;
  readonly typeID: number | null;
  readonly name: string | null;
  readonly activity: string | null;
  /** The ball it is busy with, so the panel can NAME the rock or the rat. */
  readonly targetID: number | null;
  readonly shieldRatio: number | null;
  readonly armorRatio: number | null;
  readonly hullRatio: number | null;
}

/**
 * The two limits the SERVER enforces on a launch (goal R25): how many drones
 * may be in space at once, and the hull's drone bandwidth.
 *
 * Shown so a player can see why a launch was refused — and NOT used to
 * pre-refuse one. Both are null for "unknown", which is also what a hull with
 * no drone bay reports; the panel says "unknown" rather than showing a
 * confident 0 it did not read.
 */
export interface DroneLimits {
  readonly maxActiveDrones: number | null;
  readonly droneBandwidth: number | null;
}

/**
 * One survey-scanner result (goal R23): what the scanner saw in a rock. The
 * browser MERGES these into the overview by itemID and computes nothing itself.
 */
export interface SurveyResult {
  readonly itemID: number;
  readonly yieldTypeID: number | null;
  readonly remainingQuantity: number | null;
}

/** What reprocessing one stack would yield, as the SERVER quoted it. */
export interface ReprocessingQuote {
  readonly itemID: number;
  readonly typeID: number | null;
  readonly quantityToProcess: number | null;
  readonly leftOvers: number | null;
  /** What this stack costs in ISK, as the station computed it. null = unknown. */
  readonly iskCost: number | null;
  /**
   * The minerals the PLAYER receives. The server's quote also carries the
   * station's own share; that is deliberately not here, because presenting it
   * as the player's yield would be a confidently wrong number.
   */
  readonly outputs: readonly { readonly typeID: number; readonly quantity: number }[];
}

/**
 * The mining panel state (goal R23 slice B).
 *
 * `taxRate` is null for "not known" rather than 0. Reprocessing DEBITS the
 * station's tax from the wallet, so showing a confident 0 for a rate the server
 * never gave would understate what the player is about to pay.
 */
export interface MiningState {
  readonly holds: readonly MiningHold[];
  readonly holdsLoaded: boolean;
  readonly holdsError: string | null;
  /** The last survey scan, newest first read; empty until the player scans. */
  readonly survey: readonly SurveyResult[];
  readonly surveyAtMs: number | null;
  readonly surveyError: string | null;
  readonly quotes: readonly ReprocessingQuote[];
  readonly taxRate: number | null;
  readonly quotesFor: readonly number[];
  readonly quotesError: string | null;
  readonly lastAction: string | null;
  readonly actionError: string | null;
  /** A call that succeeded, changed nothing, and gave no reason (see R23). */
  readonly silentDecline: string | null;
}

/**
 * The Drones panel's slice (goal R25).
 *
 * ⚠ EVERY "we could not look" IS A NULL, and that is load-bearing here in a way
 * it is nowhere else in this store. "You have no drones in space" and "the
 * snapshot did not answer" are the same pixels and opposite facts: the first
 * invites a player to launch, the second invites them to launch a SECOND flight
 * on top of the one already out there. `bay` and `inSpace` are null until a
 * successful read fills them, and the panel renders null as "not known".
 */
export interface DronesState {
  /** null until read; null again if a read fails. NEVER [] for "unknown". */
  readonly bay: readonly DroneBayStack[] | null;
  readonly inSpace: readonly DroneInSpace[] | null;
  /** The launch limits the SERVER enforces — shown, never used to pre-refuse. */
  readonly limits: DroneLimits;
  readonly loaded: boolean;
  readonly error: string | null;
  readonly lastAction: string | null;
  readonly actionError: string | null;
  /**
   * A drone call that answered success and changed nothing. The server's launch
   * handler returns an empty dict when it refuses, so this is the ONLY way a
   * refused launch can be reported at all.
   */
  readonly silentDecline: string | null;
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

// --- R26: the mining bot ----------------------------------------------------

export type MiningBotRunState = "idle" | "running" | "paused" | "stopped" | "error";

/**
 * The mining bot's panel state (goal R26).
 *
 * The decide-loop runs in the BROWSER and pushes its readout here; the panel is
 * a pure reader, exactly as the Travel panel is for the autopilot.
 *
 * `why` is the field this slice exists for. A bot you cannot interrogate is one
 * you cannot trust, so the reason for the LAST thing it did is always on screen
 * — not only when something goes wrong. It is plain player language and carries
 * no numeric ids (R9a / R7d).
 *
 * `holdUsed` / `holdCapacity` are null for UNKNOWN, never 0: a hull that did not
 * report a capacity must not render as an empty hold with room to spare.
 */
export interface MiningBotState {
  readonly status: MiningBotRunState;
  /** Where in the loop it is ("Mining", "Hauling", "Docking"). */
  readonly phase: string | null;
  /** What it last did. */
  readonly action: string | null;
  /** WHY it did that — always present while running. */
  readonly why: string | null;
  /** The rock it is working, by NAME (R7d). */
  readonly rockName: string | null;
  /** The belt and station the player picked, by name. */
  readonly beltName: string | null;
  readonly stationName: string | null;
  /** Loads actually unloaded into the hangar this run. */
  readonly cyclesCompleted: number;
  /** Ore units this run, counted from the HOLD growing — never from a yield sum. */
  readonly oreUnitsMined: number;
  readonly holdUsed: number | null;
  readonly holdCapacity: number | null;
  /** Set when it stopped — always a sentence a player can act on. */
  readonly failureReason: string | null;
  /** A problem starting it (nothing picked, not in space); null clears it. */
  readonly startError: string | null;
  readonly startedAt: number | null;
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
  /**
   * R24 — the notification's own payload, as the gateway JSON-encoded it.
   *
   * R10 kept only the metadata, because liveness was all the page needed then:
   * "something happened, go and re-read". The in-space cockpit needs more than
   * that from two of these — `OnGodmaShipEffect` carries the only effective
   * cycle duration the browser will ever see, and `OnItemsChanged` carries what
   * changed. The gateway has always pushed the whole notification
   * (`encodeJsonSafeCallValue`, evejsWebGatewayRuntime.js:2672); this is the
   * page finally keeping it. Empty when the frame carried no args.
   */
  readonly args: readonly unknown[];
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

// --- R28 Skills: the character sheet and the training queue -----------------
//
// Every number in here came from the server already evaluated (the gateway's
// GET /skills): the SP threshold for each level, the SP a queue entry starts
// and ends at, and the instants it starts and ends. Nothing in the client
// re-derives them — see bridge/skills.ts.

/** One skill the character has, with the server's thresholds for all 5 levels. */
export interface SkillRow {
  readonly typeID: number;
  readonly name: string;
  readonly groupName: string;
  /** The level the character HAS. Partial progress rides in skillPoints. */
  readonly level: number;
  readonly rank: number;
  readonly skillPoints: number;
  /** SP needed for levels I..V. The server's curve, not ours. */
  readonly levelSkillPoints: readonly number[];
  readonly inTraining: boolean;
}

/** One skill group as the sheet reads it. */
export interface SkillGroup {
  readonly groupName: string;
  readonly skills: readonly SkillRow[];
  readonly skillCount: number;
  readonly totalSkillPoints: number;
  readonly maxedCount: number;
}

/** One planned step of training, exactly as the server scheduled it. */
export interface SkillQueueEntry {
  readonly typeID: number;
  readonly toLevel: number;
  readonly startSP: number;
  readonly destinationSP: number;
  /** Epoch ms, or null when the server gave none. Never coerced to 0. */
  readonly startTimeMs: number | null;
  readonly endTimeMs: number | null;
  /** Non-zero only for the head: a later entry's rate is not knowable yet. */
  readonly skillPointsPerMinute: number;
}

export interface SkillQueueState {
  readonly active: boolean;
  readonly entries: readonly SkillQueueEntry[];
  readonly endTimeMs: number | null;
  /** The server's own cap on queue length, shown rather than enforced here. */
  readonly maxEntries: number;
}

/** The decoded GET /api/bridge/skills payload. */
export interface SkillSheet {
  readonly characterName: string;
  readonly totalSkillPoints: number;
  readonly freeSkillPoints: number;
  readonly skills: readonly SkillRow[];
  /** null when the gateway could not read the queue — NOT an empty queue. */
  readonly queue: SkillQueueState | null;
  /** serverNowMs minus the browser's clock at read time. */
  readonly clockOffsetMs: number;
}

/** The live readout for whatever is training, interpolated between reads. */
export interface SkillTrainingReadout {
  readonly typeID: number;
  readonly toLevel: number;
  readonly skillPoints: number;
  readonly startSP: number;
  readonly destinationSP: number;
  readonly fraction: number;
  readonly remainingMs: number;
  readonly finishAtMs: number;
  readonly skillPointsPerMinute: number;
}

export interface SkillsState {
  readonly characterName: string | null;
  readonly totalSkillPoints: number | null;
  readonly freeSkillPoints: number | null;
  /** null until read; null again if a read fails. NEVER [] for "unknown". */
  readonly skills: readonly SkillRow[] | null;
  readonly queue: SkillQueueState | null;
  readonly clockOffsetMs: number;
  readonly loaded: boolean;
  readonly error: string | null;
  readonly lastAction: string | null;
  readonly actionError: string | null;
}
