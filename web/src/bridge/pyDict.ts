// The order the retail client's Python iterates a dict of whole numbers in, for a dict it is answered and shows in
// that order (a mailing list's access lists, evemailingListConfig.py 438 to 447).
//
// The client is Stackless Python 2.7.1 on 64-bit Windows, where a C long is 32 bits: a whole number within it hashes
// to itself (-1 to -2). A dict is an open-addressed table of eight slots at first, probed from the hash with the
// hash's bits shifted in, and grown to the smallest power of two above four times its entries when it is two-thirds
// full; it iterates in slot order. This is the part for whole numbers of the BFF's own model, src/gamePort/py27.js,
// which is checked against the client's python27.dll (scripts/py27-oracle.py).
//
// ⚠ A dict the client is answered is taken here to be filled from empty in the order its entries come. That is what
// a dict built by setting its items is; how the client's own unmarshaller (blue.marshal) builds one has not been
// measured.

const MIN_TABLE_SIZE = 8;
const PERTURB_SHIFT = 5n;
const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;

interface Slot {
  readonly key: number;
  readonly hash: number;
}

/** lookdict's probe: the key's own slot, or the first empty one on its path. */
function findSlot(table: readonly (Slot | undefined)[], hash: number, key: number): number {
  const mask = BigInt(table.length - 1);
  // `perturb` is a size_t: a negative hash is sign-extended to 64 bits, then unsigned.
  let perturb = BigInt.asUintN(64, BigInt(hash));
  let index = perturb & mask;
  for (;;) {
    const entry = table[Number(index)];
    if (entry === undefined || (entry.hash === hash && entry.key === key)) {
      return Number(index);
    }
    index = BigInt.asUintN(64, index * 5n + perturb + 1n) & mask;
    perturb >>= PERTURB_SHIFT;
  }
}

/** dictresize: the smallest power of two above `minimumUsed`, refilled in slot order. */
function resized(table: readonly (Slot | undefined)[], minimumUsed: number): (Slot | undefined)[] {
  let size = MIN_TABLE_SIZE;
  while (size <= minimumUsed) {
    size *= 2;
  }
  const next: (Slot | undefined)[] = new Array(size);
  for (const entry of table) {
    if (entry !== undefined) {
      next[findSlot(next, entry.hash, entry.key)] = entry;
    }
  }
  return next;
}

/**
 * The keys of a dict filled from empty with `keys` in their order, in the order the client iterates it. Keys outside
 * a C long hash otherwise, as a Python long: for those the order given is kept.
 */
export function pyIntDictOrder(keys: readonly number[]): readonly number[] {
  if (!keys.every((key) => Number.isInteger(key) && key >= INT_MIN && key <= INT_MAX)) {
    return [...keys];
  }
  let table: (Slot | undefined)[] = new Array(MIN_TABLE_SIZE);
  let used = 0;
  for (const key of keys) {
    const hash = key === -1 ? -2 : key;
    const slot = findSlot(table, hash, key);
    if (table[slot] !== undefined) {
      continue;
    }
    table[slot] = { key, hash };
    used += 1;
    if (used * 3 >= table.length * 2) {
      table = resized(table, (used > 50000 ? 2 : 4) * used);
    }
  }
  return table.filter((entry): entry is Slot => entry !== undefined).map((entry) => entry.key);
}
