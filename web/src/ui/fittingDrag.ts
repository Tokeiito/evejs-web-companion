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

/** The fitting dropped, or null where none was (read in the drop's own handler, before any await). */
export function droppedFitting(event: DragEvent): DraggedFitting | null {
  const raw = event.dataTransfer?.getData(FITTING_DRAG_MIME) ?? "";
  if (raw === "") return null;
  let read: unknown;
  try {
    read = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof read !== "object" || read === null) return null;
  const { fittingID, shipTypeID, fitData, name } = read as Record<string, unknown>;
  if (!(fittingID === null || whole(fittingID)) || !whole(shipTypeID) || typeof name !== "string" || !Array.isArray(fitData)) return null;
  const items = fitData.filter((item): item is [number, number, number] => Array.isArray(item) && item.length === 3 && item.every(whole));
  if (items.length !== fitData.length) return null;
  return { fittingID, shipTypeID, fitData: items, name };
}

/** The number of the saved fitting dropped, or null where none was (read in the drop's own handler, before any await). */
export function droppedFittingID(event: DragEvent): number | null {
  const fittingID = droppedFitting(event)?.fittingID ?? null;
  return fittingID !== null && fittingID > 0 ? fittingID : null;
}
