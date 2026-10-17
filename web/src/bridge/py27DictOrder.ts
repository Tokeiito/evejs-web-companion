// The order CPython 2.7 iterates a dict of whole-number keys in, for the page's own reckoning of a list the client
// builds from a dict (the client is Python 2.7, 64-bit Windows: a C long is 32 bits). The BFF's src/gamePort/py27.js
// has the whole of it, strings and longs too, checked against the client's own python27.dll; this is its int part.

const PERTURB_SHIFT = 5n;
const MIN_TABLE_SIZE = 8;

interface Slot {
  readonly key: number;
  readonly hash: number;
}

/** hash() of a Python int on this platform: itself, -1 being kept for an error. Keys here are within 32 bits. */
const hashOf = (key: number): number => (key === -1 ? -2 : key);

/** lookdict: the slot holding `key`, or the empty slot it would go in. No deletions. */
function findSlot(table: (Slot | undefined)[], hash: number, key: number): number {
  const mask = BigInt(table.length - 1);
  let perturb = BigInt.asUintN(64, BigInt(hash));
  let index = perturb & mask;
  for (;;) {
    const entry = table[Number(index)];
    if (entry === undefined || (entry.hash === hash && entry.key === key)) return Number(index);
    index = BigInt.asUintN(64, index * 5n + perturb + 1n) & mask;
    perturb >>= PERTURB_SHIFT;
  }
}

/** dictresize: the smallest power of two above `minimumUsed`, refilled in slot order. */
function resized(table: (Slot | undefined)[], minimumUsed: number): (Slot | undefined)[] {
  let size = MIN_TABLE_SIZE;
  while (size <= minimumUsed) size *= 2;
  const next: (Slot | undefined)[] = new Array(size);
  for (const entry of table) {
    if (entry !== undefined) next[findSlot(next, entry.hash, entry.key)] = entry;
  }
  return next;
}

/**
 * The order a dict that began empty iterates `keys` in, given the order they were first set (d[key] = value:
 * PyDict_SetItem, the table grown when two-thirds full). Whole numbers within 32 bits only.
 */
export function intDictOrder(keys: readonly number[]): number[] {
  let table: (Slot | undefined)[] = new Array(MIN_TABLE_SIZE);
  let used = 0;
  for (const key of keys) {
    if (!Number.isInteger(key) || key < -2147483648 || key > 2147483647) throw new TypeError("A whole number within 32 bits is a dict key here.");
    const hash = hashOf(key);
    const slot = findSlot(table, hash, key);
    if (table[slot] !== undefined) continue;
    table[slot] = { key, hash };
    used += 1;
    if (used * 3 >= table.length * 2) table = resized(table, (used > 50000 ? 2 : 4) * used);
  }
  return table.filter((entry): entry is Slot => entry !== undefined).map((entry) => entry.key);
}

/**
 * A dict of whole-number keys as CPython 2.7 lays out its table, for the order it iterates in (no deletions; values
 * are not kept). `set` is d[key] = value (PyDict_SetItem: the table grown when two-thirds full). `update` is
 * d.update(other) and dict(other) of a dict (PyDict_Merge): the table first made big enough for both where the two
 * would pass two-thirds of it, then the other's keys put in the order it iterates in, with no growing after
 * (insertdict). Whole numbers within 32 bits only.
 *
 * The size the merge grows to is the client's python27.dll's, measured (sys.getsizeof of a dict after update, for
 * one to 39 keys into an empty dict and into one of one key): above four times the count of both (six keys into an
 * empty dict make a table of 32, eight of 64), where CPython 2.7's own source reads twice.
 */
export class IntDict {
  private table: (Slot | undefined)[] = new Array(MIN_TABLE_SIZE);
  private used = 0;

  set(key: number): void {
    if (!Number.isInteger(key) || key < -2147483648 || key > 2147483647) throw new TypeError("A whole number within 32 bits is a dict key here.");
    const hash = hashOf(key);
    const slot = findSlot(this.table, hash, key);
    if (this.table[slot] !== undefined) return;
    this.table[slot] = { key, hash };
    this.used += 1;
    if (this.used * 3 >= this.table.length * 2) this.table = resized(this.table, (this.used > 50000 ? 2 : 4) * this.used);
  }

  update(other: IntDict): void {
    const keys = other.keys();
    if (keys.length === 0) return;
    if ((this.used + keys.length) * 3 >= this.table.length * 2) this.table = resized(this.table, (this.used + keys.length) * 4);
    for (const key of keys) {
      const hash = hashOf(key);
      const slot = findSlot(this.table, hash, key);
      if (this.table[slot] !== undefined) continue;
      this.table[slot] = { key, hash };
      this.used += 1;
    }
  }

  /** The keys in the order the dict iterates them: its table's slots in order. */
  keys(): number[] {
    return this.table.filter((entry): entry is Slot => entry !== undefined).map((entry) => entry.key);
  }
}

/** A dict set with `keys` in that order (IntDict.set each). */
export function intDictOf(keys: readonly number[]): IntDict {
  const dict = new IntDict();
  for (const key of keys) dict.set(key);
  return dict;
}
