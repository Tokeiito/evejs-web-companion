// Client-state store skeleton (goal R1b, roadmap section 5).
//
// One store is the single source of truth mirroring the relevant EveJS
// session/character state in the browser. The UI pages and, later, the
// browser autopilot loop are *pure readers*: they read via `get()` or the
// per-slice signals and subscribe for changes; they never write slices
// directly. State enters through `apply(event)` — normally called by the
// feed adapter attached with `attachFeed` (see feed.ts), which hides whether
// the events came from the legacy WS stream or from bridge-forwarded session
// notifications.
//
// R1b ships the session/character skeleton. Further slices (inventory,
// journal, space, ...) arrive with their pages on the R2-R6 rail.

import {
  createSignal,
  readonlySignal,
  type ReadableSignal,
  type Unsubscribe,
} from "./signals.ts";
import type { FeedAdapter, FeedEvent, FeedSink, FeedStatus } from "./feed.ts";
import type {
  AgentFinderState,
  AgentsState,
  ChatChannelState,
  ChatState,
  CharacterSummary,
  FlightState,
  FittingResources,
  FittingSlot,
  FittingState,
  IndustryBlueprintRow,
  IndustryDefinition,
  IndustryFacilityRow,
  IndustryJobRow,
  IndustrySlotUsage,
  IndustryState,
  MarketActionOutcome,
  MarketEscrow,
  MarketOrderRow,
  MarketOwnOrderRow,
  MarketPriceHistoryRow,
  MarketState,
  MailActionOutcome,
  MailHeaderRow,
  MailOpenMessage,
  MailState,
  MailStatusRow,
  ContractDetail,
  ContractRow,
  ContractSummary,
  ContractsState,
  MarketTransactionRow,
  InventoryContainerState,
  CorpHangarState,
  InventoryState,
  LiveState,
  OnlineCharacterState,
  RewardsState,
  SpaceState,
  StationGuest,
  StationServiceBits,
  StationStatic,
  TravelState,
} from "./types.ts";
import type { NamesState } from "./names.ts";
import { deriveShipStats } from "../bridge/shipStats.ts";

// --- Typed state slices ----------------------------------------------------

/** Who is logged in to the web BFF (which pins bridge session identity). */
export interface SessionSlice {
  readonly phase: "logged-out" | "logged-in";
  readonly accountID: number | null;
  readonly username: string | null;
}

/** Character context: the account's characters and the selected one. */
export interface CharacterSlice {
  readonly selectedCharacterID: number | null;
  readonly characters: readonly CharacterSummary[];
}

/**
 * The docked station panel (goal R2): who is online on the persistent
 * browser-backed session and what the docked-entry reads returned.
 */
export interface StationSlice {
  readonly online: OnlineCharacterState | null;
  readonly station: StationStatic | null;
  readonly bits: StationServiceBits | null;
  readonly guests: readonly StationGuest[];
  /** null until map.GetStationInfo answered; then whether it was the cached envelope. */
  readonly stationInfoCached: boolean | null;
  /** Non-null when the last docked-read refresh had a (non-fatal) failure. */
  readonly readError: string | null;
}

/** Which feed adapter is attached and its connectivity — not the transport itself. */
export interface FeedSlice {
  readonly adapter: string | null;
  readonly status: FeedStatus;
}

export interface ClientState {
  readonly session: SessionSlice;
  readonly character: CharacterSlice;
  readonly station: StationSlice;
  readonly inventory: InventoryState;
  readonly fitting: FittingState;
  readonly industry: IndustryState;
  readonly market: MarketState;
  readonly mail: MailState;
  readonly contracts: ContractsState;
  readonly agents: AgentsState;
  readonly finder: AgentFinderState;
  readonly rewards: RewardsState;
  readonly flight: FlightState;
  readonly space: SpaceState;
  readonly travel: TravelState;
  readonly chat: ChatState;
  readonly live: LiveState;
  readonly names: NamesState;
  readonly feed: FeedSlice;
}

const INITIAL_SESSION: SessionSlice = Object.freeze({
  phase: "logged-out",
  accountID: null,
  username: null,
});

const INITIAL_CHARACTER: CharacterSlice = Object.freeze({
  selectedCharacterID: null,
  characters: Object.freeze([]) as readonly CharacterSummary[],
});

const INITIAL_STATION: StationSlice = Object.freeze({
  online: null,
  station: null,
  bits: null,
  guests: Object.freeze([]) as readonly StationGuest[],
  stationInfoCached: null,
  readError: null,
});

const EMPTY_CONTAINER: InventoryContainerState = Object.freeze({
  rows: Object.freeze([]) as InventoryContainerState["rows"],
  capacity: null,
  error: null,
});

// A corporation hangar starts unavailable: most characters, most of the time,
// have no corp office at the station they are docked in, and that is an
// ordinary state rather than an error.
const EMPTY_CORP_HANGAR: CorpHangarState = Object.freeze({
  available: false,
  reason: null,
  divisions: Object.freeze([]),
  selectedDivision: 1,
  loaded: false,
});

const INITIAL_INVENTORY: InventoryState = Object.freeze({
  stationID: null,
  activeShipID: null,
  hangar: EMPTY_CONTAINER,
  cargo: EMPTY_CONTAINER,
  loaded: false,
  actionError: null,
  selection: Object.freeze([]),
  container: null,
  corp: EMPTY_CORP_HANGAR,
  lastOutcome: null,
});

// A resource reading with no total: `known: false` renders as an unknown bar
// rather than a misleading 0 / 0.
const UNKNOWN_RESOURCE = Object.freeze({ used: 0, total: 0, known: false });
const EMPTY_RESOURCES: FittingResources = Object.freeze({
  cpu: UNKNOWN_RESOURCE,
  powergrid: UNKNOWN_RESOURCE,
  capacitor: UNKNOWN_RESOURCE,
  calibration: UNKNOWN_RESOURCE,
});

const INITIAL_FITTING: FittingState = Object.freeze({
  activeShipID: null,
  slots: Object.freeze([]) as readonly FittingSlot[],
  resources: EMPTY_RESOURCES,
  // Before any read, every statistic is honestly unavailable rather than zero
  // — deriving from an empty attribute map produces exactly that.
  stats: deriveShipStats(new Map()),
  loaded: false,
  slotsError: null,
  resourcesError: null,
  actionError: null,
});

const INITIAL_INDUSTRY: IndustryState = Object.freeze({
  ownerID: null,
  stationID: null,
  solarSystemID: null,
  blueprints: Object.freeze([]) as readonly IndustryBlueprintRow[],
  jobs: Object.freeze([]) as readonly IndustryJobRow[],
  facilities: Object.freeze([]) as readonly IndustryFacilityRow[],
  slotsUsed: Object.freeze({}) as IndustrySlotUsage,
  definitions: Object.freeze({}) as Readonly<Record<number, IndustryDefinition | null>>,
  loaded: false,
  blueprintsError: null,
  jobsError: null,
  facilitiesError: null,
  actionError: null,
});

// R16 market. Every read is independent, so each keeps its own error: a public
// order book that fails to load must never hide the player's own orders.
const INITIAL_MARKET: MarketState = Object.freeze({
  typeID: null,
  stationID: null,
  solarSystemID: null,
  sells: Object.freeze([]) as readonly MarketOrderRow[],
  buys: Object.freeze([]) as readonly MarketOrderRow[],
  ownOrders: Object.freeze([]) as readonly MarketOwnOrderRow[],
  orderHistory: Object.freeze([]) as readonly MarketOwnOrderRow[],
  transactions: Object.freeze([]) as readonly MarketTransactionRow[],
  escrow: null as MarketEscrow | null,
  priceHistory: Object.freeze([]) as readonly MarketPriceHistoryRow[],
  cashBalance: null,
  loaded: false,
  bookError: null,
  ownOrdersError: null,
  transactionsError: null,
  marketUnavailable: null,
  actionError: null,
  lastOutcome: null as MarketActionOutcome | null,
});

// R17 mail. The inbox arrives as a DELTA SYNC the BFF cold-starts, so
// `messages` is always the WHOLE mailbox — the browser holds no window across a
// page load and therefore never syncs against one.
const INITIAL_MAIL: MailState = Object.freeze({
  messages: Object.freeze([]) as readonly MailHeaderRow[],
  statuses: Object.freeze([]) as readonly MailStatusRow[],
  unreadCount: 0,
  open: null as MailOpenMessage | null,
  loaded: false,
  inboxError: null,
  actionError: null,
  lastOutcome: null as MailActionOutcome | null,
});

// R17 contracts. READS ONLY — every mutator is refused at the gateway, so
// there is no action state here. Each read keeps its own error, so a public
// browse that failed never hides the player's own contracts.
//
// ⚠ worldHasNoContracts starts FALSE and only ever becomes true from a
// SUCCESSFUL empty browse. "Nothing loaded yet" and "this world has no
// contracts" are different statements and must never look alike.
const INITIAL_CONTRACTS: ContractsState = Object.freeze({
  browse: Object.freeze([]) as readonly ContractRow[],
  numFound: 0,
  page: 0,
  pageSize: 100,
  outstanding: Object.freeze([]) as readonly ContractRow[],
  accepted: Object.freeze([]) as readonly ContractRow[],
  expired: Object.freeze([]) as readonly ContractRow[],
  summary: null as ContractSummary | null,
  detail: null as ContractDetail | null,
  loaded: false,
  browseError: null,
  mineError: null,
  detailError: null,
  worldHasNoContracts: false,
});

const INITIAL_AGENTS: AgentsState = Object.freeze({
  stationID: null,
  agents: Object.freeze([]) as AgentsState["agents"],
  activeAgentID: null,
  conversation: null,
  briefing: null,
  journal: null,
  loaded: false,
  actionError: null,
});

const INITIAL_FINDER: AgentFinderState = Object.freeze({
  kind: "courier",
  level: null,
  originSystemID: null,
  agents: Object.freeze([]) as AgentFinderState["agents"],
  total: 0,
  capped: false,
  loaded: false,
  target: null,
  error: null,
});

const INITIAL_REWARDS: RewardsState = Object.freeze({
  cashBalance: null,
  lpBalances: Object.freeze([]) as RewardsState["lpBalances"],
  standings: Object.freeze([]) as RewardsState["standings"],
  loaded: false,
  error: null,
});

const INITIAL_FLIGHT: FlightState = Object.freeze({
  status: null,
  loaded: false,
  lastAction: null,
  actionError: null,
  solarSystemName: null,
  stationName: null,
  structureName: null,
});

const INITIAL_SPACE: SpaceState = Object.freeze({
  snapshot: null,
  loaded: false,
  error: null,
});

const INITIAL_TRAVEL: TravelState = Object.freeze({
  status: "idle" as TravelState["status"],
  destinationSystemID: null,
  destinationStationID: null,
  destinationName: null,
  route: Object.freeze([]) as TravelState["route"],
  currentSystemID: null,
  currentSystemName: null,
  nextSystemID: null,
  nextSystemName: null,
  action: null,
  phase: null,
  remainingJumps: 0,
  totalJumps: 0,
  startedAt: null,
  failureReason: null,
});

const EMPTY_CHAT_CHANNEL: ChatChannelState = Object.freeze({
  roomName: null,
  corporationID: null,
  solarSystemID: null,
  roster: Object.freeze([]) as ChatChannelState["roster"],
  messages: Object.freeze([]) as ChatChannelState["messages"],
  loaded: false,
});

const INITIAL_CHAT: ChatState = Object.freeze({
  activeChannel: "local" as ChatState["activeChannel"],
  local: EMPTY_CHAT_CHANNEL,
  corp: EMPTY_CHAT_CHANNEL,
  error: null,
});

// Static reference names (goal R7c): resolved once, kept for the app's life
// (they can't change). Not reset on offline/logout — the flow's name cache is
// kept in step, and re-resolving immutable data would only cause needless
// refetches.
const INITIAL_NAMES: NamesState = Object.freeze({
  resolved: Object.freeze({}) as NamesState["resolved"],
});

// R10 live channel: how many pushed session notifications to keep. A bounded
// tail — this is a liveness record for the page to react to, not a log.
const LIVE_NOTIFICATION_LIMIT = 50;
// How many messages a channel backlog keeps once live pushes start appending.
// Matches the gateway's default backlog read so live and polled state converge.
const CHAT_BACKLOG_LIMIT = 50;

const INITIAL_LIVE: LiveState = Object.freeze({
  status: "idle" as LiveState["status"],
  epoch: null,
  sequence: 0,
  notifications: Object.freeze([]) as LiveState["notifications"],
  lastEventAtMs: null,
});

const INITIAL_FEED: FeedSlice = Object.freeze({
  adapter: null,
  status: "idle" as FeedStatus,
});

// --- Store -----------------------------------------------------------------

export interface ClientStore {
  /** Per-slice read/subscribe API for pure readers. */
  readonly session: ReadableSignal<SessionSlice>;
  readonly character: ReadableSignal<CharacterSlice>;
  readonly station: ReadableSignal<StationSlice>;
  readonly inventory: ReadableSignal<InventoryState>;
  readonly fitting: ReadableSignal<FittingState>;
  readonly industry: ReadableSignal<IndustryState>;
  readonly market: ReadableSignal<MarketState>;
  readonly mail: ReadableSignal<MailState>;
  readonly contracts: ReadableSignal<ContractsState>;
  readonly agents: ReadableSignal<AgentsState>;
  readonly finder: ReadableSignal<AgentFinderState>;
  readonly rewards: ReadableSignal<RewardsState>;
  readonly flight: ReadableSignal<FlightState>;
  readonly space: ReadableSignal<SpaceState>;
  readonly travel: ReadableSignal<TravelState>;
  readonly chat: ReadableSignal<ChatState>;
  readonly live: ReadableSignal<LiveState>;
  readonly names: ReadableSignal<NamesState>;
  readonly feed: ReadableSignal<FeedSlice>;

  /** Whole-state snapshot. */
  get(): ClientState;
  /**
   * Whole-store subscription: called synchronously with the current state,
   * then exactly once per applied event / feed-status change (slice updates
   * from one event are batched into one notification).
   */
  subscribe(listener: (state: ClientState) => void): Unsubscribe;

  /** Reduce one normalized feed event into the state. */
  apply(event: FeedEvent): void;

  /**
   * Attach a feed adapter (detaching any previous one) and start it. Returns
   * a detach function that stops the adapter; events published by a detached
   * adapter are ignored.
   */
  attachFeed(adapter: FeedAdapter): Unsubscribe;
}

export function createClientStore(): ClientStore {
  const session = createSignal<SessionSlice>(INITIAL_SESSION);
  const character = createSignal<CharacterSlice>(INITIAL_CHARACTER);
  const station = createSignal<StationSlice>(INITIAL_STATION);
  const inventory = createSignal<InventoryState>(INITIAL_INVENTORY);
  const fitting = createSignal<FittingState>(INITIAL_FITTING);
  const industry = createSignal<IndustryState>(INITIAL_INDUSTRY);
  const market = createSignal<MarketState>(INITIAL_MARKET);
  const mail = createSignal<MailState>(INITIAL_MAIL);
  const contracts = createSignal<ContractsState>(INITIAL_CONTRACTS);
  const agents = createSignal<AgentsState>(INITIAL_AGENTS);
  const finder = createSignal<AgentFinderState>(INITIAL_FINDER);
  const rewards = createSignal<RewardsState>(INITIAL_REWARDS);
  const flight = createSignal<FlightState>(INITIAL_FLIGHT);
  const space = createSignal<SpaceState>(INITIAL_SPACE);
  const travel = createSignal<TravelState>(INITIAL_TRAVEL);
  const chat = createSignal<ChatState>(INITIAL_CHAT);
  const live = createSignal<LiveState>(INITIAL_LIVE);
  const names = createSignal<NamesState>(INITIAL_NAMES);
  const feed = createSignal<FeedSlice>(INITIAL_FEED);

  // Whole-store notification: bumped once per applied change so multi-slice
  // reducers still produce a single store-level notification.
  const version = createSignal(0);
  const bump = (): void => {
    version.set(version.get() + 1);
  };

  const get = (): ClientState => ({
    session: session.get(),
    character: character.get(),
    station: station.get(),
    inventory: inventory.get(),
    fitting: fitting.get(),
    industry: industry.get(),
    market: market.get(),
    mail: mail.get(),
    contracts: contracts.get(),
    agents: agents.get(),
    finder: finder.get(),
    rewards: rewards.get(),
    flight: flight.get(),
    space: space.get(),
    travel: travel.get(),
    chat: chat.get(),
    live: live.get(),
    names: names.get(),
    feed: feed.get(),
  });

  const reduce = (event: FeedEvent): void => {
    switch (event.type) {
      case "session/logged-in":
        session.set({
          phase: "logged-in",
          accountID: event.accountID,
          username: event.username,
        });
        break;
      case "session/logged-out":
        // Logging out drops the character and station context with the session.
        session.set(INITIAL_SESSION);
        character.set(INITIAL_CHARACTER);
        station.set(INITIAL_STATION);
        inventory.set(INITIAL_INVENTORY);
        fitting.set(INITIAL_FITTING);
        industry.set(INITIAL_INDUSTRY);
        market.set(INITIAL_MARKET);
        mail.set(INITIAL_MAIL);
        contracts.set(INITIAL_CONTRACTS);
        agents.set(INITIAL_AGENTS);
        finder.set(INITIAL_FINDER);
        rewards.set(INITIAL_REWARDS);
        flight.set(INITIAL_FLIGHT);
        space.set(INITIAL_SPACE);
        travel.set(INITIAL_TRAVEL);
        chat.set(INITIAL_CHAT);
        live.set(INITIAL_LIVE);
        break;
      case "character/list": {
        const characters = [...event.characters];
        const selected = character.get().selectedCharacterID;
        const stillPresent =
          selected !== null &&
          characters.some((row) => row.characterID === selected);
        character.set({
          selectedCharacterID: stillPresent ? selected : null,
          characters,
        });
        break;
      }
      case "character/selected": {
        const current = character.get();
        const requested = event.characterID;
        const known =
          requested !== null &&
          current.characters.some((row) => row.characterID === requested);
        character.set({
          ...current,
          selectedCharacterID: known ? requested : null,
        });
        break;
      }
      case "character/online":
        // A fresh docked entry: the panel reads (bits/guests/info) repopulate
        // from their own events on the new live session.
        station.set({
          ...INITIAL_STATION,
          online: event.character,
          station: event.station,
        });
        inventory.set(INITIAL_INVENTORY);
        fitting.set(INITIAL_FITTING);
        industry.set(INITIAL_INDUSTRY);
        market.set(INITIAL_MARKET);
        mail.set(INITIAL_MAIL);
        contracts.set(INITIAL_CONTRACTS);
        agents.set(INITIAL_AGENTS);
        finder.set(INITIAL_FINDER);
        rewards.set(INITIAL_REWARDS);
        flight.set(INITIAL_FLIGHT);
        space.set(INITIAL_SPACE);
        travel.set(INITIAL_TRAVEL);
        chat.set(INITIAL_CHAT);
        live.set(INITIAL_LIVE);
        break;
      case "character/offline":
        station.set(INITIAL_STATION);
        inventory.set(INITIAL_INVENTORY);
        fitting.set(INITIAL_FITTING);
        industry.set(INITIAL_INDUSTRY);
        market.set(INITIAL_MARKET);
        mail.set(INITIAL_MAIL);
        contracts.set(INITIAL_CONTRACTS);
        agents.set(INITIAL_AGENTS);
        finder.set(INITIAL_FINDER);
        rewards.set(INITIAL_REWARDS);
        flight.set(INITIAL_FLIGHT);
        space.set(INITIAL_SPACE);
        travel.set(INITIAL_TRAVEL);
        chat.set(INITIAL_CHAT);
        live.set(INITIAL_LIVE);
        break;
      case "station/relocated": {
        // The docked station changed on the same live session (autopilot
        // arrival / manual dock). Re-point the online location + static identity
        // and drop the prior station's reads (bits/guests/info/error) so the
        // flow's follow-up refresh repopulates them for the new station. No-op
        // if nobody is online.
        const current = station.get();
        if (!current.online) {
          break;
        }
        station.set({
          ...current,
          online: {
            ...current.online,
            stationID: event.stationID,
            solarSystemID: event.solarSystemID,
          },
          station: event.station,
          bits: null,
          guests: [],
          stationInfoCached: null,
          readError: null,
        });
        break;
      }
      case "station/bits":
        station.set({ ...station.get(), bits: event.bits });
        break;
      case "station/guests":
        station.set({ ...station.get(), guests: [...event.guests] });
        break;
      case "station/info-cached":
        station.set({ ...station.get(), stationInfoCached: event.cached });
        break;
      case "station/read-error":
        station.set({ ...station.get(), readError: event.message });
        break;
      case "inventory/loaded": {
        const previous = inventory.get();
        // A reload drops any selection whose item is no longer in the hangar or
        // cargo: acting on a stale tick would move something the player can no
        // longer see.
        const visible = new Set([
          ...event.hangar.rows.map((row) => row.itemID),
          ...event.cargo.rows.map((row) => row.itemID),
          ...(previous.container ? previous.container.rows.map((row) => row.itemID) : []),
          ...previous.corp.divisions.flatMap((division) =>
            division.rows.map((row) => row.itemID),
          ),
        ]);
        inventory.set({
          ...previous,
          stationID: event.stationID,
          activeShipID: event.activeShipID,
          hangar: event.hangar,
          cargo: event.cargo,
          loaded: true,
          selection: previous.selection.filter((itemID) => visible.has(itemID)),
          // A successful load clears any stale mutation error.
          actionError: null,
        });
        break;
      }
      case "inventory/action-error":
        inventory.set({ ...inventory.get(), actionError: event.message });
        break;
      case "inventory/cleared":
        inventory.set(INITIAL_INVENTORY);
        break;
      case "inventory/selection":
        inventory.set({ ...inventory.get(), selection: [...event.itemIDs] });
        break;
      case "inventory/container":
        inventory.set({
          ...inventory.get(),
          container: event.container,
          // Leaving or entering a container clears the selection: a tick made
          // in one place must never be applied in another.
          selection: [],
        });
        break;
      case "inventory/corp-loaded":
        inventory.set({
          ...inventory.get(),
          corp: {
            ...inventory.get().corp,
            available: event.available,
            reason: event.reason,
            divisions: [...event.divisions],
            loaded: true,
          },
        });
        break;
      case "inventory/corp-division":
        inventory.set({
          ...inventory.get(),
          corp: { ...inventory.get().corp, selectedDivision: event.division },
          selection: [],
        });
        break;
      case "inventory/outcome":
        inventory.set({ ...inventory.get(), lastOutcome: event.outcome });
        break;
      case "fitting/loaded":
        fitting.set({
          activeShipID: event.activeShipID,
          slots: [...event.slots],
          resources: event.resources,
          stats: event.stats,
          loaded: true,
          slotsError: event.slotsError,
          resourcesError: event.resourcesError,
          // A successful load clears any stale action error.
          actionError: null,
        });
        break;
      case "fitting/action-error":
        fitting.set({ ...fitting.get(), actionError: event.message });
        break;
      case "fitting/cleared":
        fitting.set(INITIAL_FITTING);
        break;
      case "industry/loaded":
        industry.set({
          ...industry.get(),
          ownerID: event.ownerID,
          stationID: event.stationID,
          solarSystemID: event.solarSystemID,
          blueprints: [...event.blueprints],
          jobs: [...event.jobs],
          facilities: [...event.facilities],
          slotsUsed: event.slotsUsed,
          loaded: true,
          blueprintsError: event.blueprintsError,
          jobsError: event.jobsError,
          facilitiesError: event.facilitiesError,
          // A successful load clears any stale action error.
          actionError: null,
        });
        break;
      case "industry/definitions":
        // Recipes MERGE rather than replace: they are static, so one already
        // fetched stays valid, and a later load only needs the new types.
        industry.set({
          ...industry.get(),
          definitions: { ...industry.get().definitions, ...event.definitions },
        });
        break;
      case "industry/action-error":
        industry.set({ ...industry.get(), actionError: event.message });
        break;
      case "industry/cleared":
        industry.set(INITIAL_INDUSTRY);
        break;
      // R16 market. Each read lands with its own error, so a public order book
      // that failed never blanks the player's own orders (or the reverse).
      case "market/loaded":
        market.set({
          ...market.get(),
          typeID: event.typeID,
          stationID: event.stationID,
          solarSystemID: event.solarSystemID,
          sells: [...event.sells],
          buys: [...event.buys],
          ownOrders: [...event.ownOrders],
          orderHistory: [...event.orderHistory],
          transactions: [...event.transactions],
          escrow: event.escrow,
          priceHistory: [...event.priceHistory],
          cashBalance: event.cashBalance,
          loaded: true,
          bookError: event.bookError,
          ownOrdersError: event.ownOrdersError,
          transactionsError: event.transactionsError,
          marketUnavailable: event.marketUnavailable,
          // A successful load clears any stale action error, but NOT the last
          // outcome: what the server actually charged stays on screen until the
          // player does something else.
          actionError: null,
        });
        break;
      case "market/action-error":
        market.set({ ...market.get(), actionError: event.message });
        break;
      case "market/outcome":
        market.set({ ...market.get(), lastOutcome: event.outcome });
        break;
      case "market/cleared":
        market.set(INITIAL_MARKET);
        break;
      // R17 mail. A cold delta sync IS the whole mailbox, so the message list
      // is REPLACED rather than merged — an old row surviving a reload would be
      // a message the server no longer says the player has.
      case "mail/loaded":
        mail.set({
          ...mail.get(),
          messages: [...event.messages],
          statuses: [...event.statuses],
          unreadCount: event.unreadCount,
          loaded: true,
          inboxError: event.inboxError,
          // A successful load clears a stale action error but NOT the last
          // outcome: what the server did with the player's message stays on
          // screen until they do something else.
          actionError: null,
        });
        break;
      case "mail/opened":
        mail.set({ ...mail.get(), open: event.open });
        break;
      case "mail/action-error":
        mail.set({ ...mail.get(), actionError: event.message });
        break;
      case "mail/outcome":
        mail.set({ ...mail.get(), lastOutcome: event.outcome });
        break;
      case "mail/cleared":
        mail.set(INITIAL_MAIL);
        break;
      // R17 contracts. Reads only; each keeps its own error.
      case "contracts/loaded":
        contracts.set({
          ...contracts.get(),
          browse: [...event.browse],
          numFound: event.numFound,
          page: event.page,
          pageSize: event.pageSize,
          outstanding: [...event.outstanding],
          accepted: [...event.accepted],
          expired: [...event.expired],
          summary: event.summary,
          loaded: true,
          browseError: event.browseError,
          mineError: event.mineError,
          worldHasNoContracts: event.worldHasNoContracts,
        });
        break;
      case "contracts/detail":
        contracts.set({ ...contracts.get(), detail: event.detail, detailError: null });
        break;
      case "contracts/detail-error":
        contracts.set({ ...contracts.get(), detailError: event.message });
        break;
      case "contracts/cleared":
        contracts.set(INITIAL_CONTRACTS);
        break;
      case "agents/list":
        agents.set({
          ...agents.get(),
          stationID: event.stationID,
          agents: [...event.agents],
          loaded: true,
          actionError: null,
        });
        break;
      case "agents/conversation":
        agents.set({
          ...agents.get(),
          activeAgentID: event.agentID,
          conversation: event.conversation,
          actionError: null,
        });
        break;
      case "agents/briefing":
        agents.set({ ...agents.get(), briefing: event.briefing });
        break;
      case "agents/journal":
        agents.set({ ...agents.get(), journal: event.journal });
        break;
      case "agents/action-error":
        agents.set({ ...agents.get(), actionError: event.message });
        break;
      case "agents/cleared":
        agents.set(INITIAL_AGENTS);
        break;
      case "finder/results":
        finder.set({
          ...finder.get(),
          kind: event.kind,
          level: event.level,
          originSystemID: event.originSystemID,
          agents: [...event.agents],
          total: event.total,
          capped: event.capped,
          loaded: true,
          // A fresh result clears any stale find error.
          error: null,
        });
        break;
      case "finder/target":
        finder.set({ ...finder.get(), target: event.target });
        break;
      case "finder/error":
        finder.set({ ...finder.get(), error: event.message });
        break;
      case "finder/cleared":
        finder.set(INITIAL_FINDER);
        break;
      case "rewards/loaded":
        rewards.set({
          cashBalance: event.cashBalance,
          lpBalances: [...event.lpBalances],
          standings: [...event.standings],
          loaded: true,
          error: event.error,
        });
        break;
      case "rewards/cleared":
        rewards.set(INITIAL_REWARDS);
        break;
      case "flight/status": {
        // Preserve a resolved name only while its ID is unchanged; on any ID
        // change drop the stale name (the UI falls back to the raw ID) until the
        // flow resolves the new one (goal R7a).
        const prev = flight.get();
        const prevStatus = prev.status;
        const next = event.status;
        flight.set({
          ...prev,
          status: next,
          loaded: true,
          solarSystemName:
            prevStatus && prevStatus.solarSystemID === next.solarSystemID ? prev.solarSystemName : null,
          stationName:
            prevStatus && prevStatus.stationID === next.stationID ? prev.stationName : null,
          structureName:
            prevStatus && prevStatus.structureID === next.structureID ? prev.structureName : null,
        });
        break;
      }
      case "flight/location": {
        // Apply each resolved name only if the current status still carries the
        // ID it was resolved for, so a slow resolve landing after the ship moved
        // can never mislabel the new location (goal R7a).
        const cur = flight.get();
        const s = cur.status;
        flight.set({
          ...cur,
          solarSystemName:
            s && s.solarSystemID !== null && s.solarSystemID === event.forSolarSystemID
              ? event.solarSystemName
              : cur.solarSystemName,
          stationName:
            s && s.stationID !== null && s.stationID === event.forStationID
              ? event.stationName
              : cur.stationName,
          structureName:
            s && s.structureID !== null && s.structureID === event.forStructureID
              ? event.structureName
              : cur.structureName,
        });
        break;
      }
      case "flight/action":
        // A successful movement step: record it and clear any stale refusal.
        flight.set({ ...flight.get(), lastAction: event.action, actionError: null });
        break;
      case "flight/action-error":
        flight.set({ ...flight.get(), actionError: event.message });
        break;
      case "flight/cleared":
        flight.set(INITIAL_FLIGHT);
        break;
      case "space/snapshot":
        // A clean read clears any stale read error.
        space.set({ snapshot: event.snapshot, loaded: true, error: null });
        break;
      case "space/error":
        space.set({ ...space.get(), error: event.message });
        break;
      case "space/cleared":
        space.set(INITIAL_SPACE);
        break;
      case "travel/planned":
        travel.set({
          ...INITIAL_TRAVEL,
          status: "running",
          destinationSystemID: event.destinationSystemID,
          destinationStationID: event.destinationStationID,
          destinationName: event.destinationName,
          route: [...event.route],
          remainingJumps: event.totalJumps,
          totalJumps: event.totalJumps,
          startedAt: event.startedAt,
        });
        break;
      case "travel/progress":
        travel.set({
          ...travel.get(),
          status: event.status,
          action: event.action,
          phase: event.phase,
          currentSystemID: event.currentSystemID,
          currentSystemName: event.currentSystemName,
          nextSystemID: event.nextSystemID,
          nextSystemName: event.nextSystemName,
          remainingJumps: event.remainingJumps,
          totalJumps: event.totalJumps,
          failureReason: event.failureReason,
        });
        break;
      case "travel/plan-error":
        travel.set({ ...travel.get(), status: "idle", failureReason: event.message });
        break;
      case "travel/cleared":
        travel.set(INITIAL_TRAVEL);
        break;
      case "chat/loaded": {
        const current = chat.get();
        chat.set({
          ...current,
          [event.channel]: event.channelState,
          // A successful read clears any stale read/send error.
          error: null,
        });
        break;
      }
      case "chat/active":
        chat.set({ ...chat.get(), activeChannel: event.channel });
        break;
      case "chat/error":
        chat.set({ ...chat.get(), error: event.message });
        break;
      case "chat/cleared":
        chat.set(INITIAL_CHAT);
        break;
      // R10 — a live-pushed message. The safety-net poll and the push channel
      // both deliver the same backlog entries, so an append that duplicates a
      // message already present is dropped: a message is identified by its
      // author, text, and timestamp (the gateway backlog entry has no ID).
      case "chat/message": {
        const current = chat.get();
        const channelState = current[event.channel];
        const incoming = event.message;
        const duplicate = channelState.messages.some(
          (existing) =>
            existing.createdAtMs === incoming.createdAtMs &&
            existing.characterID === incoming.characterID &&
            existing.message === incoming.message,
        );
        if (duplicate) {
          break;
        }
        const messages = [...channelState.messages, incoming];
        chat.set({
          ...current,
          [event.channel]: {
            ...channelState,
            messages: messages.slice(-CHAT_BACKLOG_LIMIT),
            // A live message proves the channel exists even before its first
            // read completes.
            loaded: true,
          },
        });
        break;
      }
      // R10 — the live push channel's own state.
      case "live/status":
        live.set({ ...live.get(), status: event.status });
        break;
      case "live/notification": {
        const current = live.get();
        live.set({
          ...current,
          status: "live",
          epoch: event.epoch ?? current.epoch,
          sequence: event.sequence,
          notifications: [...current.notifications, event.notification].slice(
            -LIVE_NOTIFICATION_LIMIT,
          ),
          lastEventAtMs: event.notification.receivedAtMs,
        });
        break;
      }
      // The gateway could not replay from the held cursor. Adopt the new cursor
      // and drop the buffered tail: continuing to show it would imply a
      // continuity the stream just told us it cannot provide.
      case "live/resynchronize": {
        const current = live.get();
        live.set({
          ...current,
          epoch: event.epoch ?? current.epoch,
          sequence: event.sequence,
          notifications: Object.freeze([]) as LiveState["notifications"],
        });
        break;
      }
      case "live/cleared":
        live.set(INITIAL_LIVE);
        break;
      case "names/resolved": {
        // Merge the freshly-resolved batch into the names cache (static
        // reference data — a name only ever gets more resolved, never cleared).
        const current = names.get();
        names.set({ resolved: { ...current.resolved, ...event.entries } });
        break;
      }
    }
  };

  const apply = (event: FeedEvent): void => {
    reduce(event);
    bump();
  };

  // --- Feed attachment -----------------------------------------------------

  let activeDetach: Unsubscribe | null = null;

  const attachFeed = (adapter: FeedAdapter): Unsubscribe => {
    if (activeDetach) {
      activeDetach();
    }

    let attached = true;
    const sink: FeedSink = {
      publish(event) {
        if (attached) {
          apply(event);
        }
      },
      setStatus(status) {
        if (attached || status === "disconnected") {
          feed.set({ adapter: adapter.name, status });
          bump();
        }
      },
    };

    const detach = (): void => {
      if (!attached) {
        return;
      }
      attached = false;
      if (activeDetach === detach) {
        activeDetach = null;
      }
      adapter.stop();
    };

    activeDetach = detach;
    feed.set({ adapter: adapter.name, status: "connecting" });
    bump();
    adapter.start(sink);
    return detach;
  };

  const subscribe = (listener: (state: ClientState) => void): Unsubscribe =>
    version.subscribe(() => listener(get()));

  return {
    session: readonlySignal(session),
    character: readonlySignal(character),
    station: readonlySignal(station),
    inventory: readonlySignal(inventory),
    fitting: readonlySignal(fitting),
    industry: readonlySignal(industry),
    market: readonlySignal(market),
    mail: readonlySignal(mail),
    contracts: readonlySignal(contracts),
    agents: readonlySignal(agents),
    finder: readonlySignal(finder),
    rewards: readonlySignal(rewards),
    flight: readonlySignal(flight),
    space: readonlySignal(space),
    travel: readonlySignal(travel),
    chat: readonlySignal(chat),
    live: readonlySignal(live),
    names: readonlySignal(names),
    feed: readonlySignal(feed),
    get,
    subscribe,
    apply,
    attachFeed,
  };
}
