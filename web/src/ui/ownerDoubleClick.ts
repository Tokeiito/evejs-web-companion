import type { AppFlow } from "../app/flow.ts";
import { showTypedOwnerInfo } from "./ownerInfo.ts";

/** Ordinary User entries; AgentEntry and modal/custom callbacks keep theirs. */
export function doubleClickOwner(flow: AppFlow, ownerID: number): Promise<void> {
  return flow.ownerEntryDoubleClick(ownerID, showTypedOwnerInfo);
}
