// The order CPython 2.7 (the retail client's interpreter, 64-bit Windows) iterates a dict whose keys are integers,
// built by inserting them one by one: its open-addressing table, its probing and its growth, as the BFF's
// src/gamePort/py27.js reproduces them (that one checked against the client's own python27.dll). Integer keys of
// the 32-bit range only: an int hashes to itself there (-1 to -2), and that is every owner's id.

const MIN_TABLE_SIZE = 8;
const PERTURB_SHIFT = 5n;

interface Slot {
  readonly key: number;
  readonly hash: number;
}

/** lookdict: the slot holding `key`, or the empty slot it would go in. No deletions. */
function findSlot(table: readonly (Slot | undefined)[], hash: number, key: number): number {
  const mask = BigInt(table.length - 1);
  // `perturb` is a size_t: a negative hash is sign-extended to 64 bits, then unsigned.
  let perturb = BigInt.asUintN(64, BigInt(hash));
  let index = perturb & mask;
  for (;;) {
    const entry = table[Number(index)];
    if (entry === undefined || entry.key === key) return Number(index);
    index = BigInt.asUintN(64, index * 5n + perturb + 1n) & mask;
    perturb >>= PERTURB_SHIFT;
  }
}

/** dictresize: the smallest power of two above `minimumUsed`, refilled in slot order. */
function resized(table: readonly (Slot | undefined)[], minimumUsed: number): (Slot | undefined)[] {
  let size = MIN_TABLE_SIZE;
  while (size <= minimumUsed) size *= 2;
  const next = new Array<Slot | undefined>(size);
  for (const entry of table) {
    if (entry !== undefined) next[findSlot(next, entry.hash, entry.key)] = entry;
  }
  return next;
}

/** The keys of a dict that began empty and had these inserted in turn, in the order the client iterates it. */
export function pyIntDictOrder(keys: readonly number[]): number[] {
  let table = new Array<Slot | undefined>(MIN_TABLE_SIZE);
  let used = 0;
  for (const key of keys) {
    if (!Number.isSafeInteger(key) || key < -2147483648 || key > 2147483647) {
      throw new RangeError(`A key outside the 32-bit range has a long's hash: ${key}`);
    }
    const hash = key === -1 ? -2 : key;
    const slot = findSlot(table, hash, key);
    if (table[slot] !== undefined) continue;
    table[slot] = { key, hash };
    used += 1;
    // PyDict_SetItem grows the table when it is two-thirds full.
    if (used * 3 >= table.length * 2) table = resized(table, (used > 50000 ? 2 : 4) * used);
  }
  return table.filter((entry): entry is Slot => entry !== undefined).map((entry) => entry.key);
}
