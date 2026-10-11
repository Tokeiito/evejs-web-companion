import test from "node:test";
import assert from "node:assert/strict";
import { systemGraphOnce } from "./systemGraphKept.ts";
import type { SystemGraphData } from "./routeSolver.ts";

const MAP: SystemGraphData = { systems: { 1: "One", 2: "Two" }, security: { 1: 0.9 }, edges: [[1, 2, 11, 12], [2, 1, 12, 11]] };

/** A reading of the map that counts its askings, and answers when it is told to. */
function reading(map: SystemGraphData = MAP) {
  const answers: { resolve(value: SystemGraphData): void; reject(error: Error): void }[] = [];
  const read = () => new Promise<SystemGraphData>((resolve, reject) => { answers.push({ resolve, reject }); });
  return { read, asked: () => answers.length, answer: (at: number) => answers[at]!.resolve(map), fail: (at: number) => answers[at]!.reject(new Error("no map")) };
}

test("the map is read once for what it is asked with: asked again, what was built is what comes back", async () => {
  const page = () => undefined;
  const { read, asked, answer } = reading();
  const first = systemGraphOnce(page, read);
  answer(0);
  const graph = await first;
  assert.deepEqual([graph.systemName(1), graph.systemName(2), graph.security(1), graph.systemCount, graph.edgeCount], ["One", "Two", 0.9, 2, 2]);
  assert.deepEqual(graph.neighbors(1).map((edge) => [edge.toSystemID, edge.gateID]), [[2, 11]]);
  // The very graph that was built, for whoever asks with the same, and nothing read for it.
  assert.equal(await systemGraphOnce(page, read), graph);
  assert.equal(await systemGraphOnce(page, () => { throw new Error("not asked"); }), graph);
  assert.equal(asked(), 1);
});

test("those who ask while the map is on its way wait for the one read", async () => {
  const page = {};
  const { read, asked, answer } = reading();
  const waiting = [systemGraphOnce(page, read), systemGraphOnce(page, read), systemGraphOnce(page, read)];
  assert.equal(asked(), 1);
  answer(0);
  const graphs = await Promise.all(waiting);
  assert.equal(graphs[0], graphs[1]);
  assert.equal(graphs[1], graphs[2]);
});

test("what is asked with another fetch is another's: each reads its own map, and has its own", async () => {
  const one = {};
  const other = {};
  const first = reading();
  const second = reading({ systems: { 1: "Uno" }, edges: [] });
  const mine = systemGraphOnce(one, first.read);
  const theirs = systemGraphOnce(other, second.read);
  first.answer(0);
  second.answer(0);
  assert.deepEqual([(await mine).systemName(1), (await theirs).systemName(1)], ["One", "Uno"]);
  assert.deepEqual([first.asked(), second.asked()], [1, 1]);
});

test("a read that fails is not kept: it fails those waiting on it, and the next to ask reads again", async () => {
  const page = {};
  const { read, asked, answer, fail } = reading();
  const first = systemGraphOnce(page, read);
  const second = systemGraphOnce(page, read);
  fail(0);
  await assert.rejects(first, /no map/);
  await assert.rejects(second, /no map/);
  const again = systemGraphOnce(page, read);
  assert.equal(asked(), 2);
  answer(1);
  assert.equal((await again).systemName(2), "Two");
  assert.equal(await systemGraphOnce(page, read), await again);
  assert.equal(asked(), 2);
});

test("one who hears of a failed read and asks again at once reads again: the failure is unkept before it is heard of", async () => {
  const page = {};
  const { read, asked, answer, fail } = reading();
  // The asking again is made in the very handler that hears of the failure.
  const again = systemGraphOnce(page, read).catch(() => systemGraphOnce(page, read));
  fail(0);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(asked(), 2);
  answer(1);
  assert.equal((await again).systemName(1), "One");
});
