import test from "node:test";
import assert from "node:assert/strict";
import { keptByKey, keptByType, keptTypeAttributes, keptWhereKnown, type TypeAttributes } from "./keptTypeFacts.ts";

/** A reading by type that keeps what it was asked, and answers by a table: undefined is "not answered". */
function reading<V>(table: Record<number, V | undefined>) {
  const asked: number[][] = [];
  const read = async (typeIDs: readonly number[]): Promise<Record<number, V>> => {
    asked.push([...typeIDs]);
    const answered: Record<number, V> = {};
    for (const typeID of typeIDs) {
      const value = table[typeID];
      if (value !== undefined) answered[typeID] = value;
    }
    return answered;
  };
  return { asked, read };
}

test("a type is asked for once and kept: asked again, nothing is read, and only the types not yet told are asked for", async () => {
  const { asked, read } = reading<number | null>({ 1: 10, 2: 20, 3: 30 });
  const of = keptByType(read);
  assert.deepEqual(await of([1, 2]), { 1: 10, 2: 20 });
  assert.deepEqual(await of([2, 1]), { 1: 10, 2: 20 });
  assert.deepEqual(await of([2, 3, 3, 1]), { 1: 10, 2: 20, 3: 30 });
  assert.deepEqual(asked, [[1, 2], [3]]);
  // With nothing left to ask, nothing is read; and nothing is read for no types at all.
  assert.deepEqual(await of([]), {});
  assert.deepEqual(asked.length, 2);
});

test("null is an answer and is kept; a type the reading says nothing of was not answered, and is asked for again", async () => {
  const table: Record<number, number | null | undefined> = { 1: null, 2: undefined };
  const { asked, read } = reading<number | null>(table);
  const of = keptByType(read);
  assert.deepEqual(await of([1, 2]), { 1: null });
  assert.deepEqual(await of([1, 2]), { 1: null });
  assert.deepEqual(asked, [[1, 2], [2]]);
  table[2] = 7;
  assert.deepEqual(await of([1, 2]), { 1: null, 2: 7 });
  assert.deepEqual(await of([1, 2]), { 1: null, 2: 7 });
  assert.deepEqual(asked, [[1, 2], [2], [2]]);
});

test("what is no type's number is passed over, and asked of nothing", async () => {
  const { asked, read } = reading<number>({ 5: 50 });
  const of = keptByType(read);
  assert.deepEqual(await of([0, -3, 1.5, Number.NaN, 5, Number.MAX_SAFE_INTEGER + 2]), { 5: 50 });
  assert.deepEqual(asked, [[5]]);
});

test("nothing is kept of a reading that failed: it fails its asker, and the types are asked for again", async () => {
  let fail = true;
  const asked: number[][] = [];
  const of = keptByType(async (typeIDs: readonly number[]) => {
    asked.push([...typeIDs]);
    if (fail) throw new Error("the static data could not be read");
    return Object.fromEntries(typeIDs.map((typeID) => [typeID, typeID * 2]));
  });
  await assert.rejects(of([4, 5]), /could not be read/);
  fail = false;
  assert.deepEqual(await of([4, 5]), { 4: 8, 5: 10 });
  assert.deepEqual(asked, [[4, 5], [4, 5]]);
});

test("askers at one time share a reading: a type being read is not asked for again, and a reading that fails fails them all", async () => {
  const asked: number[][] = [];
  const answers: { resolve(value: Record<number, number>): void; reject(error: Error): void }[] = [];
  const of = keptByType((typeIDs: readonly number[]) => {
    asked.push([...typeIDs]);
    return new Promise<Record<number, number>>((resolve, reject) => { answers.push({ resolve, reject }); });
  });
  const first = of([1, 2]);
  const second = of([2, 3]);
  const third = of([1]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(asked, [[1, 2], [3]], "2 is being read for the first asker, and 1 for the third");
  answers[0]!.resolve({ 1: 10, 2: 20 });
  answers[1]!.resolve({ 3: 30 });
  assert.deepEqual([await first, await second, await third], [{ 1: 10, 2: 20 }, { 2: 20, 3: 30 }, { 1: 10 }]);

  // A reading that fails: the asker who shares it fails too, and the type is asked for again after.
  const failing = of([7]);
  const sharing = of([7, 1]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(asked, [[1, 2], [3], [7]]);
  answers[2]!.reject(new Error("lost"));
  await assert.rejects(failing, /lost/);
  await assert.rejects(sharing, /lost/);
  const again = of([7]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  answers[3]!.resolve({ 7: 70 });
  assert.deepEqual(await again, { 7: 70 });
  assert.deepEqual(asked, [[1, 2], [3], [7], [7]]);
});

test("a reading by key keeps by whatever the key is, and tells a key answered from one that was not by the Map having it", async () => {
  const asked: string[][] = [];
  const of = keptByKey<string, string | null>(async (keys) => {
    asked.push([...keys]);
    return new Map(keys.filter((key) => key !== "unanswered").map((key) => [key, key === "nothing" ? null : key.toUpperCase()]));
  });
  assert.deepEqual([...await of(["a", "nothing", "unanswered", "a"])], [["a", "A"], ["nothing", null]]);
  assert.deepEqual([...await of(["nothing", "unanswered", "b"])], [["nothing", null], ["b", "B"]]);
  assert.deepEqual(asked, [["a", "nothing", "unanswered"], ["unanswered", "b"]]);
});

/** The static data's route for attributes, with its table and what it was asked. */
function dogma(table: Record<number, Record<number, number> | undefined>) {
  const asked: { typeIDs: number[]; attributeIDs: number[] }[] = [];
  const read = async (typeIDs: readonly number[], attributeIDs: readonly number[]): Promise<TypeAttributes> => {
    asked.push({ typeIDs: [...typeIDs], attributeIDs: [...attributeIDs] });
    const rows: Record<number, Record<number, number>> = {};
    for (const typeID of typeIDs) {
      const row = table[typeID];
      if (row !== undefined) rows[typeID] = Object.fromEntries(attributeIDs.filter((attributeID) => row[attributeID] !== undefined).map((attributeID) => [attributeID, row[attributeID]!]));
    }
    return rows;
  };
  return { asked, read };
}

test("a type's attributes are each asked for once: the first asking is as it was asked, and a second asks nothing", async () => {
  const { asked, read } = dogma({ 100: { 128: 1, 77: 5 }, 200: { 128: 2 } });
  const of = keptTypeAttributes(read);
  assert.deepEqual(await of([100, 200], [128]), { 100: { 128: 1 }, 200: { 128: 2 } });
  assert.deepEqual(await of([200, 100, 100], [128]), { 100: { 128: 1 }, 200: { 128: 2 } });
  assert.deepEqual(asked, [{ typeIDs: [100, 200], attributeIDs: [128] }]);
});

test("an attribute a type has none of is known as none, zero is a value, and an empty row is an answer", async () => {
  const { asked, read } = dogma({ 100: { 504: 0 }, 300: {} });
  const of = keptTypeAttributes(read);
  // 100 has 504 at nought and no 103; 300 is known to the tables and has neither.
  assert.deepEqual(await of([100, 300], [504, 103]), { 100: { 504: 0 }, 300: {} });
  assert.deepEqual(await of([100, 300], [103]), { 100: {}, 300: {} });
  assert.deepEqual(await of([300], [504, 103]), { 300: {} });
  assert.equal(asked.length, 1);
});

test("a type with no row was not answered: it is left out, and asked for again; a type is asked for where any attribute wanted of it is not known", async () => {
  const table: Record<number, Record<number, number> | undefined> = { 100: { 128: 1, 77: 5 }, 400: undefined };
  const { asked, read } = dogma(table);
  const of = keptTypeAttributes(read);
  assert.deepEqual(await of([100, 400], [128]), { 100: { 128: 1 } });
  assert.deepEqual(await of([100, 400], [128]), { 100: { 128: 1 } });
  assert.deepEqual(asked, [{ typeIDs: [100, 400], attributeIDs: [128] }, { typeIDs: [400], attributeIDs: [128] }]);
  // Another attribute of a type that is known for the first: the type is asked for what is not known of it.
  assert.deepEqual(await of([100], [128, 77]), { 100: { 128: 1, 77: 5 } });
  assert.deepEqual(asked[2], { typeIDs: [100], attributeIDs: [77] });
  assert.deepEqual(await of([100], [77, 128]), { 100: { 128: 1, 77: 5 } });
  assert.equal(asked.length, 3);
});

test("with no attributes wanted, or no types, nothing is asked; and a reading that failed keeps nothing of a type's attributes", async () => {
  let fail = true;
  const asked: number[][] = [];
  const of = keptTypeAttributes(async (typeIDs, attributeIDs) => {
    asked.push([...typeIDs, ...attributeIDs]);
    if (fail) throw new Error("refused");
    return Object.fromEntries(typeIDs.map((typeID) => [typeID, { 128: 3 }]));
  });
  assert.deepEqual(await of([100], []), {});
  assert.deepEqual(await of([], [128]), {});
  assert.deepEqual(await of([0, -1], [128, 0]), {});
  assert.deepEqual(asked, []);
  await assert.rejects(of([100], [128]), /refused/);
  fail = false;
  assert.deepEqual(await of([100], [128]), { 100: { 128: 3 } });
  assert.deepEqual(asked, [[100, 128], [100, 128]]);
});

test("a read that leaves out what the tables do not know: a type left out is known to be unknown, asked for once, and not among what comes back", async () => {
  const { asked, read } = reading<{ groupID: number }>({ 1: { groupID: 7 }, 2: undefined, 3: { groupID: 9 } });
  const of = keptWhereKnown(read);
  assert.deepEqual(await of([1, 2]), { 1: { groupID: 7 } });
  assert.deepEqual(await of([2, 1]), { 1: { groupID: 7 } });
  assert.deepEqual(await of([2]), {});
  assert.deepEqual(await of([3, 2, 1]), { 1: { groupID: 7 }, 3: { groupID: 9 } });
  assert.deepEqual(asked, [[1, 2], [3]]);
});

test("a read that leaves out what the tables do not know, and fails: nothing is kept, and the types are asked for again", async () => {
  let fail = true;
  const asked: number[][] = [];
  const of = keptWhereKnown(async (typeIDs: readonly number[]) => {
    asked.push([...typeIDs]);
    if (fail) throw new Error("The types' facts could not be read.");
    return { 1: "one" } as Record<number, string>;
  });
  await assert.rejects(of([1, 2]), /could not be read/);
  fail = false;
  assert.deepEqual(await of([1, 2]), { 1: "one" });
  assert.deepEqual(await of([1, 2]), { 1: "one" });
  assert.deepEqual(asked, [[1, 2], [1, 2]]);
});
