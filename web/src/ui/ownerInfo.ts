import type { AppFlow } from "../app/flow.ts";
import { showInfo, subjectOfShowInfoLink, infoShiftPressed, type InfoOpenOptions } from "./showInfo.ts";

/** User.ShowInfo549-552: cfg.eveowners' type, never an assumed character. */
export function showTypedOwnerInfo(typeID: number, itemID: number, options: InfoOpenOptions = {}): void {
  const subject = subjectOfShowInfoLink(`showinfo:${typeID}//${itemID}`);
  if (subject) showInfo(subject, options);
}

export function showOwnerInfo(flow: AppFlow, ownerID: number): Promise<void> {
  const options = { shift: infoShiftPressed() };
  return flow.ownerEntryInfo(ownerID, (type, item) => showTypedOwnerInfo(type, item, options));
}
