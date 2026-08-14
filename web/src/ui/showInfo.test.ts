// The Show Info target (goal R76): a shared subject any opener can set, and a
// request counter that makes "Show Info" work a second time on the same thing.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createShowInfoTarget,
  sameSubject,
  showInfoTarget,
  subjectTypeID,
  type InfoSubject,
} from "./showInfo.ts";
import { TABS, isLaunchable, launchableTabsFor, visibleTabsFor } from "./tabs.ts";

test("nothing is being shown to begin with", () => {
  const target = createShowInfoTarget();
  assert.equal(target.subject.get(), null);
  assert.equal(target.requests.get(), 0);
});

test("showing a subject sets it and raises a request", () => {
  const target = createShowInfoTarget();
  target.show({ kind: "type", typeID: 34 });
  assert.deepEqual(target.subject.get(), { kind: "type", typeID: 34 });
  assert.equal(target.requests.get(), 1);
});

test("asking again for the SAME subject still raises a request", () => {
  // ⚠ THE WHOLE REASON THE COUNTER EXISTS. The workspace raises the window off
  // this signal; if it watched the subject alone, a second Show Info on the
  // thing already displayed would change nothing — so a window the player had
  // closed or buried would never come back.
  const target = createShowInfoTarget();
  target.show({ kind: "type", typeID: 34 });
  target.show({ kind: "type", typeID: 34 });
  assert.equal(target.requests.get(), 2);
});

test("a subscriber sees every request, including repeats", () => {
  const target = createShowInfoTarget();
  const seen: number[] = [];
  const stop = target.requests.subscribe((count) => seen.push(count));
  target.show({ kind: "type", typeID: 1 });
  target.show({ kind: "type", typeID: 1 });
  stop();
  assert.deepEqual(seen, [0, 1, 2]);
});

test("clearing drops the subject without pretending a new request happened", () => {
  const target = createShowInfoTarget();
  target.show({ kind: "type", typeID: 34 });
  target.clear();
  assert.equal(target.subject.get(), null);
  assert.equal(target.requests.get(), 1, "clearing is not a request to show anything");
});

test("two targets built separately do not share state", () => {
  const a = createShowInfoTarget();
  const b = createShowInfoTarget();
  a.show({ kind: "type", typeID: 34 });
  assert.equal(b.subject.get(), null);
});

test("the app's shared target is a real target", () => {
  assert.equal(typeof showInfoTarget.show, "function");
});

// --- subject identity --------------------------------------------------------

test("subjects of the same kind and id are the same thing", () => {
  assert.equal(
    sameSubject({ kind: "spaceObject", itemID: 5, typeID: 1 }, { kind: "spaceObject", itemID: 5, typeID: 9 }),
    true,
    "a space object is identified by its itemID, not by the type it happens to be",
  );
});

test("subjects of different kinds are never the same", () => {
  assert.equal(
    sameSubject({ kind: "module", itemID: 5, typeID: 1 }, { kind: "spaceObject", itemID: 5, typeID: 1 }),
    false,
    "the same id as a module and as a ball in space are different questions",
  );
});

test("null compares only to null", () => {
  assert.equal(sameSubject(null, null), true);
  assert.equal(sameSubject(null, { kind: "type", typeID: 1 }), false);
  assert.equal(sameSubject({ kind: "type", typeID: 1 }, null), false);
});

// --- picturing a subject -----------------------------------------------------

test("a subject's typeID is what it can be pictured by", () => {
  assert.equal(subjectTypeID({ kind: "type", typeID: 34 }), 34);
  assert.equal(subjectTypeID({ kind: "module", itemID: 1, typeID: 483 }), 483);
  assert.equal(subjectTypeID({ kind: "spaceObject", itemID: 1, typeID: 1230 }), 1230);
});

test("a space object with no type stays NULL, never a zero", () => {
  // The snapshot really does carry `typeID: null` for rows the runtime did not
  // stamp. A 0 would send the icon cache off to fetch a picture for type zero.
  assert.equal(subjectTypeID({ kind: "spaceObject", itemID: 1, typeID: null }), null);
});

test("a pilot has no typeID to be pictured by", () => {
  assert.equal(subjectTypeID({ kind: "character", characterID: 140000005 }), null);
});

test("no subject, no typeID", () => {
  assert.equal(subjectTypeID(null), null);
});

// --- the contextual tab ------------------------------------------------------

test("Show Info is a real tab, openable in both states", () => {
  const tab = TABS.find((entry) => entry.id === "showInfo");
  assert.ok(tab, "Show Info must exist as a tab so it can be a window");
  assert.equal(tab?.where, "both");
});

test("Show Info is NOT launchable from the rail", () => {
  const tab = TABS.find((entry) => entry.id === "showInfo");
  assert.equal(isLaunchable(tab!), false);
  assert.equal(
    launchableTabsFor(true).some((entry) => entry.id === "showInfo"),
    false,
  );
  assert.equal(
    visibleTabsFor(true).some((entry) => entry.id === "showInfo"),
    true,
    "…but it is still VISIBLE, or its window could not stay open",
  );
});

test("every OTHER tab is still launchable", () => {
  // ⚠ `launchable` is absent on every pre-existing tab and absent means yes. A
  // truthiness test instead of `!== false` would empty the entire rail, which is
  // the kind of change that looks like a styling bug.
  for (const tab of TABS) {
    if (tab.id === "showInfo") continue;
    assert.equal(isLaunchable(tab), true, `the '${tab.id}' tab must stay launchable`);
  }
});
