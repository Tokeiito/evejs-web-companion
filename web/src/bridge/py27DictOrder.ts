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

/** setobject.c's dummy: the mark a discarded key leaves in its slot. */
const DUMMY = Symbol("dummy");

/**
 * A set of whole numbers as CPython 2.7 lays out its table (setobject.c), for the order it iterates in. `add` is
 * s.add(key), set(list) and a set comprehension (set_add_key: the table grown to four times the keys when two-thirds
 * of it is filled, dummies counted). `discard` leaves a dummy. `update` is set(other) and s | other of a set
 * (set_merge: the table first made big enough for both where they would fill two-thirds of it, then the other's keys
 * put in the order it iterates in, with no growing after). `differenceUpdate` is s -= other (the table remade where a
 * fifth of it is dummies). A merge grows the table to above twice the keys of both, as the source reads (measured
 * against the client's python27.dll: set(list), s | t, s -= t, s.add and a comprehension, 400 lists alike; its dict
 * merge grows by four). Whole numbers within 32 bits.
 */
export class IntSet {
  private table: (Slot | typeof DUMMY | undefined)[] = new Array(MIN_TABLE_SIZE);
  private fill = 0;
  private used = 0;

  /** set_lookkey: the slot holding `key`, else the first dummy met, else the empty slot the probe ends at. */
  private lookup(hash: number, key: number): number {
    const mask = BigInt(this.table.length - 1);
    let perturb = BigInt.asUintN(64, BigInt(hash));
    let index = perturb & mask;
    let freeSlot: number | null = null;
    for (;;) {
      const entry = this.table[Number(index)];
      if (entry === undefined) return freeSlot ?? Number(index);
      if (entry === DUMMY) freeSlot ??= Number(index);
      else if (entry.hash === hash && entry.key === key) return Number(index);
      index = BigInt.asUintN(64, index * 5n + perturb + 1n) & mask;
      perturb >>= PERTURB_SHIFT;
    }
  }

  /** set_insert_key: the key put where the lookup ends, unless it is there already. */
  private insert(key: number): void {
    if (!Number.isInteger(key) || key < -2147483648 || key > 2147483647) throw new TypeError("A whole number within 32 bits is a set key here.");
    const hash = hashOf(key);
    const slot = this.lookup(hash, key);
    const entry = this.table[slot];
    if (entry === undefined) {
      this.fill += 1;
      this.used += 1;
      this.table[slot] = { key, hash };
    } else if (entry === DUMMY) {
      this.used += 1;
      this.table[slot] = { key, hash };
    }
  }

  /** set_table_resize: the smallest power of two above `minimumUsed`, the keys put back in slot order. */
  private resize(minimumUsed: number): void {
    let size = MIN_TABLE_SIZE;
    while (size <= minimumUsed) size *= 2;
    const old = this.table;
    this.table = new Array(size);
    this.fill = 0;
    this.used = 0;
    for (const entry of old) if (entry !== undefined && entry !== DUMMY) this.insert(entry.key);
  }

  add(key: number): void {
    const before = this.used;
    this.insert(key);
    if (this.used > before && this.fill * 3 >= this.table.length * 2) this.resize(this.used > 50000 ? this.used * 2 : this.used * 4);
  }

  discard(key: number): void {
    const slot = this.lookup(hashOf(key), key);
    const entry = this.table[slot];
    if (entry === undefined || entry === DUMMY) return;
    this.table[slot] = DUMMY;
    this.used -= 1;
  }

  update(other: IntSet): void {
    const keys = other.keys();
    if (keys.length === 0) return;
    if ((this.fill + keys.length) * 3 >= this.table.length * 2) this.resize((this.used + keys.length) * 2);
    for (const key of keys) this.insert(key);
  }

  differenceUpdate(other: IntSet): void {
    for (const key of other.keys()) this.discard(key);
    if ((this.fill - this.used) * 5 < this.table.length - 1) return;
    this.resize(this.used > 50000 ? this.used * 2 : this.used * 4);
  }

  has(key: number): boolean {
    const entry = this.table[this.lookup(hashOf(key), key)];
    return entry !== undefined && entry !== DUMMY;
  }

  /** The keys in the order the set iterates them: its table's slots in order. */
  keys(): number[] {
    return this.table.filter((entry): entry is Slot => entry !== undefined && entry !== DUMMY).map((entry) => entry.key);
  }
}

/** set(keys) of a list, or a set comprehension over it (IntSet.add each). */
export function intSetOf(keys: Iterable<number>): IntSet {
  const set = new IntSet();
  for (const key of keys) set.add(key);
  return set;
}

/** left | right of two sets: a copy of the left (set_copy: merged into an empty set), the right merged into it. */
export function intSetUnion(left: IntSet, right: IntSet): IntSet {
  const result = new IntSet();
  result.update(left);
  result.update(right);
  return result;
}
