import type { AppFlow } from "../app/flow.ts";
import { showInfo, subjectOfShowInfoLink } from "./showInfo.ts";

/** Ordinary User entries; AgentEntry and modal/custom callbacks keep theirs. */
export function doubleClickOwner(flow: AppFlow, ownerID: number): Promise<void> {
  return flow.ownerEntryDoubleClick(ownerID, (typeID, itemID) => {
    const subject = subjectOfShowInfoLink(`showinfo:${typeID}//${itemID}`);
    if (subject) showInfo(subject);
  });
}
