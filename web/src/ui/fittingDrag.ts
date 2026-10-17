// A saved fitting dragged (fittingMgmtCont FittingEntry.GetDragData: a listentry.FittingEntry holding the fitting), for
// the skill plan editor to take (SkillPlanEditorContents._OnDropFitting). Its type tells the drag apart while it is
// dragged over; its text, read at the drop, is the fitting's id, and the drop takes the fitting as the page holds it.

export const FITTING_DRAG_MIME = "application/x-evejs-fitting";

/** A saved fitting's drag begun. */
export function startFittingDrag(event: DragEvent, fittingID: number): void {
  event.dataTransfer?.setData(FITTING_DRAG_MIME, String(fittingID));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}

/** Whether a saved fitting is being dragged over. */
export function isFittingDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(FITTING_DRAG_MIME) ?? false;
}

/** The id of the saved fitting dropped, or null where none was (read in the drop's own handler, before any await). */
export function droppedFittingID(event: DragEvent): number | null {
  const raw = event.dataTransfer?.getData(FITTING_DRAG_MIME) ?? "";
  return /^[0-9]+$/.test(raw) ? Number(raw) : null;
}
