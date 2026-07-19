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
