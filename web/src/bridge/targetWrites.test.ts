// A target locked and let go by the page itself (bridge/targetWrites.ts).

import test from "node:test";
import assert from "node:assert/strict";

import type { Ask } from "./ask.ts";
import { lockTarget, unlockTarget } from "./targetWrites.ts";
import type { JsonValue } from "./wire.ts";

/** A stand-in for the page's asking: what was asked, and `answer` (or what it throws) for each. */
function asking(answer: JsonValue | Error = null) {
  const asked: unknown[] = [];
  const act: Ask = async (service, method, args, kwargs, of) => {
    asked.push([service, method, args, kwargs ?? null, of ?? null]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { act, asked };
}
const none = { lockedTargetIDs: [], acquiringTargetIDs: [] };

test("a target is locked by one call of the dogma service, the target alone; and the answer says whether the lock is still being made", async () => {
  // targetMgr.py 1366: flag, targetList = self.GetDogmaLM().AddTarget(tid); with no flag the lock is made already.
  const pending = asking([1, { type: "list", items: [] }]);
  assert.deepEqual(await lockTarget(pending.act, 9001, none), { asked: true, pending: true });
  assert.deepEqual(pending.asked, [["dogmaIM", "AddTarget", [9001], null, null]]);

  const answers: Array<[JsonValue, boolean]> = [[[0, []], false], [[false, []], false], [[true, []], true], [[{ type: "long", value: "1" }, []], true], [[2, []], true],
    // An answer that is no such pair says nothing of a lock being made.
    [null, false], [[], false], ["1", false], [{ flag: 1 }, false]];
  for (const [answer, expected] of answers) {
    assert.deepEqual(await lockTarget(asking(answer).act, 9001, null), { asked: true, pending: expected }, JSON.stringify(answer));
  }
});

test("no lock is asked of a thing the page has locked or is locking, as the client asks none; nor of what is no thing", async () => {
  // targetMgr.TryLockTarget (1307): `if itemID in self.GetTargeting() or itemID in self.targetsByID: return`.
  const locked = asking([0, []]);
  assert.deepEqual(await lockTarget(locked.act, 9001, { lockedTargetIDs: [9001], acquiringTargetIDs: [] }), { asked: false, pending: false });
  const locking = asking([0, []]);
  assert.deepEqual(await lockTarget(locking.act, 9001, { lockedTargetIDs: [9002], acquiringTargetIDs: [9003, 9001] }), { asked: false, pending: true });
  assert.deepEqual([locked.asked, locking.asked], [[], []]);
  // Another thing than those is asked for.
  const other = asking([1, []]);
  assert.deepEqual(await lockTarget(other.act, 9004, { lockedTargetIDs: [9001], acquiringTargetIDs: [9003] }), { asked: true, pending: true });
  assert.equal(other.asked.length, 1);

  for (const thing of [0, -9001, 1.5, Number.NaN, 2 ** 53]) {
    const { act, asked } = asking([0, []]);
    await assert.rejects(lockTarget(act, thing, null), /^Error: That target could not be identified\.$/, String(thing));
    await assert.rejects(unlockTarget(act, thing, "locked"), /^Error: That target could not be identified\.$/, String(thing));
    assert.deepEqual(asked, [], String(thing));
  }
  await assert.rejects(lockTarget(asking(new Error("TargetTooFar")).act, 9001, null), /TargetTooFar/);
});

test("a target locked is let go by RemoveTarget, and a lock still being made is called off by CancelAddTarget: one call each, the target alone", async () => {
  // targetMgr.py 1385: self.GetDogmaLM().RemoveTarget(tid), for a thing in targetsByID.
  const made = asking();
  await unlockTarget(made.act, 9001, "locked");
  assert.deepEqual(made.asked, [["dogmaIM", "RemoveTarget", [9001], null, null]]);
  // 1303: self.GetDogmaLM().CancelAddTarget(tid).
  const making = asking();
  await unlockTarget(making.act, 9001, "acquiring");
  assert.deepEqual(making.asked, [["dogmaIM", "CancelAddTarget", [9001], null, null]]);
  await assert.rejects(unlockTarget(asking(new Error("DeniedShipChanged")).act, 9001, "locked"), /DeniedShipChanged/);
});
