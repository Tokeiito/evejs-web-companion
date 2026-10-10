"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createKeptReads } = require("../src/gamePort/keptReads");

/** An asker that answers its name and how many times it has been asked, and says so. */
function counted() {
  const asked = [];
  return { asked, ask: (name) => async () => { asked.push(name); return `${name} ${asked.filter((each) => each === name).length}`; } };
}

test("an answer is asked for once and kept, each under what it is kept as", async () => {
  const reads = createKeptReads();
  const { asked, ask } = counted();
  assert.deepEqual([await reads.read("all", ask("all")), await reads.read("all", ask("all")), await reads.read("unread", ask("unread")), await reads.read("all", ask("all"))], ["all 1", "all 1", "unread 1", "all 1"]);
  assert.deepEqual(asked, ["all", "unread"]);
  // An answer that is nothing is an answer, and is kept as one.
  let nothing = 0;
  const none = () => { nothing += 1; return null; };
  assert.deepEqual([await reads.read("none", none), await reads.read("none", none), nothing], [null, null, 1]);
});

test("two reads at once that find nothing kept ask once, and reads are answered in the order they came", async () => {
  const reads = createKeptReads();
  const { asked, ask } = counted();
  assert.deepEqual(await Promise.all([reads.read("all", ask("all")), reads.read("all", ask("all")), reads.read("unread", ask("unread"))]), ["all 1", "all 1", "unread 1"]);
  assert.deepEqual(asked, ["all", "unread"]);
  // One waits for the one before it, whatever each is kept as.
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const slow = reads.read("slow", async () => { order.push("slow asked"); await gate; order.push("slow answered"); return 1; });
  const quick = reads.read("quick", async () => { order.push("quick asked"); return 2; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["slow asked"]);
  release();
  assert.deepEqual([await slow, await quick, order], [1, 2, ["slow asked", "slow answered", "quick asked"]]);
});

test("forgetting forgets all that is kept, and what is asked next is kept again", async () => {
  const reads = createKeptReads();
  const { asked, ask } = counted();
  await reads.read("all", ask("all"));
  await reads.read("unread", ask("unread"));
  reads.forget();
  assert.deepEqual([await reads.read("all", ask("all")), await reads.read("all", ask("all")), await reads.read("unread", ask("unread"))], ["all 2", "all 2", "unread 2"]);
  assert.deepEqual(asked, ["all", "unread", "all", "unread"]);
});

test("an answer on its way when everything is forgotten is handed on and not kept", async () => {
  const reads = createKeptReads();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = reads.read("all", () => gate);
  await new Promise((resolve) => setImmediate(resolve));
  reads.forget();
  release("from before");
  assert.equal(await first, "from before");
  assert.deepEqual([await reads.read("all", async () => "from after"), await reads.read("all", async () => "never asked")], ["from after", "from after"]);
});

test("an asking that fails fails for who asked, keeps nothing, and leaves the next read to ask", async () => {
  const reads = createKeptReads();
  await assert.rejects(reads.read("all", async () => { throw new Error("refused"); }), /refused/);
  assert.deepEqual([await reads.read("all", async () => "answered"), await reads.read("all", async () => "never asked")], ["answered", "answered"]);
  // One that throws before it is a promise fails the same way.
  await assert.rejects(reads.read("unread", () => { throw new Error("at once"); }), /at once/);
  assert.equal(await reads.read("unread", async () => 3), 3);
});

test("everything kept can be read as it was answered, and nothing once it is forgotten", async () => {
  const reads = createKeptReads();
  assert.deepEqual(reads.answers(), []);
  await reads.read("one", async () => "first");
  await reads.read("two", async () => "second");
  await assert.rejects(reads.read("three", async () => { throw new Error("refused"); }));
  assert.deepEqual(reads.answers(), ["first", "second"]);
  reads.forget();
  assert.deepEqual(reads.answers(), []);
});

test("what is kept is amended with nothing asked, and where nothing is kept there is nothing to amend", async () => {
  const reads = createKeptReads();
  const { asked, ask } = counted();
  await reads.read("all", ask("all"));
  await reads.read("unread", ask("unread"));
  await reads.amend("all", (kept) => `${kept}, amended`);
  assert.deepEqual([await reads.read("all", ask("all")), await reads.read("unread", ask("unread")), asked], ["all 1, amended", "unread 1", ["all", "unread"]]);
  // Nothing is kept as this: nothing is made of nothing, and the next read asks.
  const made = [];
  await reads.amend("other", (kept) => { made.push(kept); return "made up"; });
  assert.deepEqual([made, await reads.read("other", ask("other"))], [[], "other 1"]);
  // After everything is forgotten there is nothing to amend either.
  reads.forget();
  await reads.amend("all", () => "made up");
  assert.equal(await reads.read("all", ask("all")), "all 2");
});

test("an amendment takes its turn behind a read begun before it, and comes before one begun after", async () => {
  const reads = createKeptReads();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = reads.read("all", async () => { await gate; return "answered"; });
  const amended = reads.amend("all", (kept) => `${kept}, then amended`);
  const after = reads.read("all", async () => "asked again");
  await new Promise((resolve) => setImmediate(resolve));
  release();
  // The read begun before is answered as the server answered it; what is kept is that answer amended.
  assert.deepEqual([await first, await amended, await after], ["answered", undefined, "answered, then amended"]);
  // A read that failed leaves nothing kept, and the amendment behind it does nothing and does not fail.
  const failing = reads.read("unread", async () => { throw new Error("no"); });
  const behind = reads.amend("unread", () => "made up");
  await assert.rejects(failing, /no/);
  await behind;
  assert.equal(await reads.read("unread", async () => "asked"), "asked");
});
