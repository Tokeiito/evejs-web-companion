// A target locked and let go by the page itself (the plan's Phase 6b).
//
// Until 2026-10-11 each was one route of the BFF (POST /api/bridge/targets/lock and /api/bridge/targets/unlock).
//
// THE CALLS, as the client's target service makes them (targetMgr.py), each on the dogma location's own object
// (GetDogmaLM()):
//
//   flag, targetList = AddTarget(tid)   _LockTarget, 1366. With no flag the lock is made already; with one it is
//                                       still being made, and the server says when it is (OnTarget).
//   RemoveTarget(tid)                   UnlockTarget, 1385: of a thing the client has locked, and of no other.
//   CancelAddTarget(tid)                CancelAddTarget, 1303: of a lock still being made.
//
// Every caller of a lock goes by TryLockTarget (1305), which asks nothing for a thing the client has locked or is
// locking. Tranquility's recordings have 223 AddTarget and 4 RemoveTarget, each the target alone and a long; no
// CancelAddTarget.
//
// THE PAGE ASKS EACH OF THE DOGMA SERVICE BY ITS NAME, as it asks its other calls of that object. The game port
// makes each on the dogma location it keeps, and keeps the client's own list of targets right from the answer
// and from the server's word (src/gamePort/pilotTargets.js).
//
// WHAT THE SERVER TAKES FROM THE CALLER: the target. The ship is the session's own.
//
// ⚠ THE ANSWER IS NOT WHAT THE PAGE GOES BY. AddTarget answers before a lock is made, and RemoveTarget answers
// nothing whether or not anything was let go: the caller reads what is locked after (the flow's lockTarget and
// releaseTarget), as the routes did.

import type { Ask } from "./ask.ts";
import { unwrapLong } from "./wire.ts";

/** What the page has of its targets: those locked, and those it is locking. */
export interface TargetsKnown {
  readonly lockedTargetIDs: readonly number[];
  readonly acquiringTargetIDs: readonly number[];
}

/** What came of a lock asked: whether anything was asked, and whether the lock is still being made. */
export interface LockAsked {
  readonly asked: boolean;
  readonly pending: boolean;
}

const anID = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/**
 * Locks the thing `targetID`. `known` is what the caller has of its targets, or null where it has decided on a
 * reading of its own: for a thing locked or being locked already the client asks nothing, and nor does this.
 * Fails as the call fails.
 */
export async function lockTarget(act: Ask, targetID: number, known: TargetsKnown | null): Promise<LockAsked> {
  if (!anID(targetID)) {
    throw new Error("That target could not be identified.");
  }
  if (known !== null && known.lockedTargetIDs.includes(targetID)) {
    return { asked: false, pending: false };
  }
  if (known !== null && known.acquiringTargetIDs.includes(targetID)) {
    return { asked: false, pending: true };
  }
  const answer = await act("dogmaIM", "AddTarget", [targetID]);
  const flag = Array.isArray(answer) && answer.length > 0 ? answer[0] : null;
  const count = unwrapLong(flag);
  return { asked: true, pending: flag === true || (count !== null && count !== 0n) };
}

/**
 * Lets go of the thing `targetID`: as a lock that is made ("locked": RemoveTarget), or as one still being made
 * ("acquiring": CancelAddTarget). Fails as the call fails.
 */
export async function unlockTarget(act: Ask, targetID: number, as: "locked" | "acquiring"): Promise<void> {
  if (!anID(targetID)) {
    throw new Error("That target could not be identified.");
  }
  await act("dogmaIM", as === "locked" ? "RemoveTarget" : "CancelAddTarget", [targetID]);
}
