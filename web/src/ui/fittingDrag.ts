// A fitting dragged (a listentry.FittingEntry holding the fitting: FittingEntry.GetDragData, the fitting browser's
// rows; FittingDraggableIcon2.GetDragData, the display window's ship icon), for the skill plan editor to take
// (SkillPlanEditorContents._OnDropFitting) and for a text to take as a link (eveEditPlainText.OnDropData). Its type
// tells the drag apart while it is dragged over; its text, read at the drop, is the fitting: its number where it is
// saved, its hull, its items and its name.

export const FITTING_DRAG_MIME = "application/x-evejs-fitting";

/** What a fitting's drag carries. */
export interface DraggedFitting {
  /** Its number where it is a saved one; null for a fitting not saved (one read from a link, the ship's as it stands). */
  readonly fittingID: number | null;
  readonly shipTypeID: number;
  readonly fitData: readonly (readonly [number, number, number])[];
  readonly name: string;
}

/**
 * A fitting the Fitting window gives as it is dragged, read as it is dropped: its ghost ship icon's (ghostShipIcon
 * .GetDragData: the active ship's own) or its fit-name label's (fittingUtil.GetFittingDragData: the one it shows).
 */
export type FittingDragSource = "activeShip" | "fittingWindow";

/** What a fitting's drag gives at the drop: the fitting itself, or the Fitting window's, to be read. */
export type DroppedFittingDrag =
  | { readonly kind: "fitting"; readonly fitting: DraggedFitting }
  | { readonly kind: "source"; readonly source: FittingDragSource };

/** The Fitting window's fitting's drag begun. */
export function startFittingSourceDrag(event: DragEvent, source: FittingDragSource): void {
  event.dataTransfer?.setData(FITTING_DRAG_MIME, JSON.stringify({ source }));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

/** A fitting's drag begun. */
export function startFittingDrag(event: DragEvent, fitting: DraggedFitting): void {
  event.dataTransfer?.setData(FITTING_DRAG_MIME, JSON.stringify(fitting));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

/** Whether a fitting is being dragged over. */
export function isFittingDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(FITTING_DRAG_MIME) ?? false;
}

const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

/** What a fitting's drag gave, or null where none was (read in the drop's own handler, before any await). */
export function droppedFittingDrag(event: DragEvent): DroppedFittingDrag | null {
  const raw = event.dataTransfer?.getData(FITTING_DRAG_MIME) ?? "";
  if (raw === "") return null;
  let read: unknown;
  try {
    read = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof read !== "object" || read === null) return null;
  const { source } = read as Record<string, unknown>;
  if (source === "activeShip" || source === "fittingWindow") return { kind: "source", source };
  const fitting = fittingOf(read as Record<string, unknown>);
  return fitting === null ? null : { kind: "fitting", fitting };
}

/** The fitting itself dropped, or null where none was (or the Fitting window's, which is read later). */
export function droppedFitting(event: DragEvent): DraggedFitting | null {
  const dropped = droppedFittingDrag(event);
  return dropped?.kind === "fitting" ? dropped.fitting : null;
}

function fittingOf(read: Record<string, unknown>): DraggedFitting | null {
  const { fittingID, shipTypeID, fitData, name } = read;
  if (!(fittingID === null || whole(fittingID)) || !whole(shipTypeID) || typeof name !== "string" || !Array.isArray(fitData)) return null;
  const items = fitData.filter((item): item is [number, number, number] => Array.isArray(item) && item.length === 3 && item.every(whole));
  if (items.length !== fitData.length) return null;
  return { fittingID, shipTypeID, fitData: items, name };
}
