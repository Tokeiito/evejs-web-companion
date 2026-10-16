// The overview's columns, as the client has them (eve/client/script/ui/inflight/overview/overviewConst.py,
// overviewColumns.py; parklife/overview/presetservice.py 1209 to 1247).
//
// The client's overview has fourteen columns, in this order unless the pilot moves them (ALL_COLUMNS, the order of
// NAME_BY_COLUMN): icon, distance, name, type, tag, corporation, alliance, faction, militia, size, velocity, radial
// velocity, transversal velocity, angular velocity. Five are shown until the pilot chooses (DEFAULT_COLUMNS): icon,
// distance, name, type and velocity. Each tab keeps which it shows (GetTabVisibleColumnIDs, the tab's own or else the
// user's columns, else the default) and their order (GetTabColumnOrder, else the fourteen as above); shown in the
// tab's order (GetColumns). The header's menu ticks one on or off (GetColumnVisibilitySubMenu,
// ToggleTabColumnVisibility); the configuration window moves one up or down and puts both back (columnsPanel.py
// MoveColumn, ResetColumns).
//
// Kept in this browser, by the page's own tab, as the client keeps them in the user's settings by its tab.

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";

export type OverviewColumnID =
  | "ICON" | "DISTANCE" | "NAME" | "TYPE" | "TAG" | "CORPORATION" | "ALLIANCE" | "FACTION" | "MILITIA" | "SIZE"
  | "VELOCITY" | "RADIALVELOCITY" | "TRANSVERSALVELOCITY" | "ANGULARVELOCITY";

/** NAME_BY_COLUMN: each column's label, in ALL_COLUMNS' order. */
export const COLUMN_LABELS: Readonly<Record<OverviewColumnID, string>> = {
  ICON: "UI/Generic/Icon",
  DISTANCE: "UI/Common/Distance",
  NAME: "UI/Common/Name",
  TYPE: "UI/Common/Type",
  TAG: "UI/Common/Tag",
  CORPORATION: "UI/Common/Corporation",
  ALLIANCE: "UI/Common/Alliance",
  FACTION: "UI/Common/Faction",
  MILITIA: "UI/Common/Militia",
  SIZE: "UI/Inventory/ItemSize",
  VELOCITY: "UI/Overview/Velocity",
  RADIALVELOCITY: "UI/Overview/RadialVelocity",
  TRANSVERSALVELOCITY: "UI/Overview/TraversalVelocity",
  ANGULARVELOCITY: "UI/Generic/AngularVelocity",
};
/** The page's own words for them, where the install's are not to hand. */
export const OWN_COLUMN_WORDS: Readonly<Record<OverviewColumnID, string>> = {
  ICON: "Icon",
  DISTANCE: "Distance",
  NAME: "Name",
  TYPE: "Type",
  TAG: "Tag",
  CORPORATION: "Corp",
  ALLIANCE: "Alliance",
  FACTION: "Faction",
  MILITIA: "Militia",
  SIZE: "Size",
  VELOCITY: "Velocity",
  RADIALVELOCITY: "Radial",
  TRANSVERSALVELOCITY: "Transversal",
  ANGULARVELOCITY: "Angular",
};
/** COLUMN_DESCRIPTIONS: a column's hint in the menu. */
export const COLUMN_DESCRIPTIONS: Readonly<Partial<Record<OverviewColumnID, string>>> = {
  VELOCITY: "UI/Overview/VelocityDescription",
  RADIALVELOCITY: "UI/Overview/RadialVelocityDescription",
  TRANSVERSALVELOCITY: "UI/Overview/TraversalVelocityDescription",
  ANGULARVELOCITY: "UI/Overview/AngularVelocityDescription",
  TAG: "UI/Overview/TagDescription",
  MILITIA: "UI/Overview/MilitiaDescription",
  SIZE: "UI/Overview/SizeDescription",
};
/** COLUMN_UNITS: the unit a column's label is given in the configuration window (GetColumnLabel, addFormatUnit). */
export const COLUMN_UNITS: Readonly<Partial<Record<OverviewColumnID, string>>> = {
  VELOCITY: "UI/Overview/MetersPerSecondUnitShort",
  RADIALVELOCITY: "UI/Overview/MetersPerSecondUnitShort",
  TRANSVERSALVELOCITY: "UI/Overview/MetersPerSecondUnitShort",
  ANGULARVELOCITY: "UI/Overview/DegreesPerSecondUnitShort",
};
/** The labels to ask the install for. */
export const COLUMN_WORD_LABELS: readonly string[] = [
  ...Object.values(COLUMN_LABELS),
  ...Object.values(COLUMN_DESCRIPTIONS),
  ...new Set(Object.values(COLUMN_UNITS)),
  "UI/Overview/TabColumnsCaption",
  "UI/Overview/ResetColumns",
];

/** ALL_COLUMNS: the fourteen in their own order. */
export const ALL_COLUMNS: readonly OverviewColumnID[] = Object.keys(COLUMN_LABELS) as OverviewColumnID[];
/** DEFAULT_COLUMNS. */
export const DEFAULT_COLUMNS: readonly OverviewColumnID[] = ["ICON", "DISTANCE", "NAME", "TYPE", "VELOCITY"];
/** RIGHTALIGNEDCOLUMNS. */
export const RIGHT_ALIGNED_COLUMNS: ReadonlySet<OverviewColumnID> = new Set([
  "DISTANCE", "SIZE", "VELOCITY", "RADIALVELOCITY", "ANGULARVELOCITY", "TRANSVERSALVELOCITY",
]);
const isColumn = (value: unknown): value is OverviewColumnID => typeof value === "string" && Object.hasOwn(COLUMN_LABELS, value);

/** A tab's choice: the columns it shows, and the order of all fourteen. */
export interface TabColumns {
  readonly visible: readonly OverviewColumnID[];
  readonly order: readonly OverviewColumnID[];
}

export const DEFAULT_TAB_COLUMNS: TabColumns = { visible: DEFAULT_COLUMNS, order: ALL_COLUMNS };

/** overviewColumns.GetColumns: the shown columns in the tab's order. */
export function shownColumns(columns: TabColumns): readonly OverviewColumnID[] {
  return columns.order.filter((column) => columns.visible.includes(column));
}

/** columnsPanel.LoadColumns: the tab's order with any column it lacks after it, as the window lists them. */
export function listedColumns(columns: TabColumns): readonly OverviewColumnID[] {
  return [...columns.order, ...ALL_COLUMNS.filter((column) => !columns.order.includes(column))];
}

/** ToggleTabColumnVisibility: on where off, off where on. */
export function toggleColumn(columns: TabColumns, column: OverviewColumnID): TabColumns {
  const visible = columns.visible.includes(column)
    ? columns.visible.filter((each) => each !== column)
    : [...columns.visible, column];
  return { ...columns, visible };
}

/** columnsPanel.MoveColumn, by one place up (-1) or down (+1) in the window's list. */
export function moveColumn(columns: TabColumns, column: OverviewColumnID, by: -1 | 1): TabColumns {
  const order = [...listedColumns(columns)];
  const at = order.indexOf(column);
  if (at === -1) return columns;
  const to = at + by;
  if (to < 0 || to >= order.length) return columns;
  order.splice(at, 1);
  order.splice(to, 0, column);
  return { ...columns, order };
}

const STORAGE_KEY = "evejs-web:overview-columns:v1";

function parseStored(raw: unknown): Record<string, TabColumns> {
  const out: Record<string, TabColumns> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [tabID, value] of Object.entries(raw as Record<string, unknown>)) {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
    const visible = Array.isArray(record?.visible) ? record.visible.filter(isColumn) : null;
    const order = Array.isArray(record?.order) ? record.order.filter(isColumn) : null;
    if (visible !== null && order !== null) out[tabID] = { visible, order };
  }
  return out;
}

/** Each tab's columns, kept in this browser. */
export interface OverviewColumnStore {
  readonly byTab: ReadableSignal<Readonly<Record<string, TabColumns>>>;
  columnsOf(tabID: string): TabColumns;
  set(tabID: string, columns: TabColumns): void;
  /** columnsPanel.ResetColumns: the default columns, in their own order. */
  reset(tabID: string): void;
}

export function createOverviewColumnStore(storage: Pick<Storage, "getItem" | "setItem"> | null = null): OverviewColumnStore {
  let loaded: Record<string, TabColumns> = {};
  try {
    loaded = parseStored(JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    loaded = {};
  }
  const signal = createSignal<Readonly<Record<string, TabColumns>>>(loaded);
  const persist = (next: Readonly<Record<string, TabColumns>>): void => {
    signal.set(next);
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or refused: the columns hold until the page is drawn again.
    }
  };
  return {
    byTab: readonlySignal(signal),
    columnsOf: (tabID) => signal.get()[tabID] ?? DEFAULT_TAB_COLUMNS,
    set: (tabID, columns) => persist({ ...signal.get(), [tabID]: columns }),
    reset: (tabID) => {
      const next = { ...signal.get() };
      delete next[tabID];
      persist(next);
    },
  };
}

const browserStorage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const overviewColumns: OverviewColumnStore = createOverviewColumnStore(browserStorage());
