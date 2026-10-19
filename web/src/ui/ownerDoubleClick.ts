import type { AppFlow } from "../app/flow.ts";
import { showTypedOwnerInfo } from "./ownerInfo.ts";
import { infoShiftPressed } from "./showInfo.ts";

/** Ordinary User entries; AgentEntry and modal/custom callbacks keep theirs. */
export function doubleClickOwner(flow: AppFlow, ownerID: number): Promise<void> {
  const options = { shift: infoShiftPressed() };
  return flow.ownerEntryDoubleClick(ownerID, (type, item) => showTypedOwnerInfo(type, item, options));
}
