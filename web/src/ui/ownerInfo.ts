import type { AppFlow } from "../app/flow.ts";
import { showInfo, subjectOfShowInfoLink } from "./showInfo.ts";

/** User.ShowInfo549-552: cfg.eveowners' type, never an assumed character. */
export function showTypedOwnerInfo(typeID: number, itemID: number): void {
  const subject = subjectOfShowInfoLink(`showinfo:${typeID}//${itemID}`);
  if (subject) showInfo(subject);
}

export function showOwnerInfo(flow: AppFlow, ownerID: number): Promise<void> {
  return flow.ownerEntryInfo(ownerID, showTypedOwnerInfo);
}
