"use strict";

// The parts of CPython 2.7 that decide what the retail client's packets hold.
//
// The retail client is Python (Stackless 2.7.1, 64-bit Windows). When it sends a
// dict, the entries go out in the dict's own iteration order, and that order is
// a product of CPython's string hash and its open-addressing table. To send the
// same entries in the same order we have to reproduce both.
//
// Everything here is checked against the client's own python27.dll: see
// scripts/py27-oracle.py and test/gamePortPy27.test.js.
//
// ⚠ 64-bit WINDOWS, specifically. A C `long` is 32 bits there, so a hash is a
// 32-bit signed number, and any Python int above 2^31-1 is a `long` object with
// its own hash function. Neither is true of CPython 2.7 on Linux.

const PERTURB_SHIFT = 5n;
const MIN_TABLE_SIZE = 8;
const LONG_DIGIT_BITS = 30n;
const LONG_DIGIT_MASK = (1n << LONG_DIGIT_BITS) - 1n;

/** Wrap to a C `long` on 64-bit Windows: 32 bits, signed. */
function toInt32(value) {
  return Number(BigInt.asIntN(32, BigInt(value)));
}

/** hash() never returns -1; CPython keeps that for "error". */
const notMinusOne = (hash) => (hash === -1 ? -2 : hash);

/** string_hash: a byte string, given here as a JS string of latin1 code units. */
function hashString(text) {
  if (text.length === 0) return 0;
  let x = BigInt(text.charCodeAt(0)) << 7n;
  for (let index = 0; index < text.length; index += 1) {
    x = BigInt.asIntN(32, (1000003n * x) ^ BigInt(text.charCodeAt(index)));
  }
  x ^= BigInt(text.length);
  return notMinusOne(toInt32(x));
}

/** long_hash: for an integer too big to be a Python int on this platform. */
function hashLong(value) {
  let magnitude = value < 0n ? -value : value;
  const digits = [];
  while (magnitude > 0n) {
    digits.push(magnitude & LONG_DIGIT_MASK);
    magnitude >>= LONG_DIGIT_BITS;
  }
  let x = 0n; // unsigned long, 32 bits
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    x = BigInt.asUintN(32, (x >> (32n - LONG_DIGIT_BITS)) | (x << LONG_DIGIT_BITS));
    x = BigInt.asUintN(32, x + digits[index]);
    if (x < digits[index]) x += 1n;
  }
  const signed = BigInt.asIntN(32, value < 0n ? -x : x);
  return notMinusOne(Number(signed));
}

/** hash() of a dict key: a byte string or an integer. */
function hashKey(key) {
  if (typeof key === "string") return hashString(key);
  if (typeof key === "number" && Number.isInteger(key)) {
    // An int hashes to itself. Above the 32-bit range it is a long.
    return key >= -2147483648 && key <= 2147483647 ? notMinusOne(key) : hashLong(BigInt(key));
  }
  if (typeof key === "bigint") {
    return key >= -2147483648n && key <= 2147483647n ? notMinusOne(Number(key)) : hashLong(key);
  }
  throw new TypeError(`No Python 2.7 hash is implemented for a ${typeof key} key.`);
}

/** Two keys are the same dict key: 5 and 5L are, 5 and "5" are not. */
const sameKey = (a, b) => (typeof a === "string" || typeof b === "string" ? a === b : BigInt(a) === BigInt(b));

/** lookdict: the slot holding `key`, or the empty slot it would go in. No deletions. */
function findSlot(table, hash, key) {
  const mask = BigInt(table.length - 1);
  // `perturb` is a size_t: a negative hash is sign-extended to 64 bits, then unsigned.
  let perturb = BigInt.asUintN(64, BigInt(hash));
  let index = perturb & mask;
  for (;;) {
    const entry = table[Number(index)];
    if (entry === undefined || (entry.hash === hash && sameKey(entry.key, key))) return Number(index);
    index = BigInt.asUintN(64, index * 5n + perturb + 1n) & mask;
    perturb >>= PERTURB_SHIFT;
  }
}

/** dictresize: the smallest power of two above `minimumUsed`, refilled in slot order. */
function resized(table, minimumUsed) {
  let size = MIN_TABLE_SIZE;
  while (size <= minimumUsed) size *= 2;
  const next = new Array(size);
  for (const entry of table) {
    if (entry !== undefined) next[findSlot(next, entry.hash, entry.key)] = entry;
  }
  return next;
}

/**
 * A CPython 2.7 dict, as far as its key order goes. Keys only; no deletions.
 */
class Dict {
  constructor() {
    this.table = new Array(MIN_TABLE_SIZE);
    this.used = 0;
  }

  /**
   * A dict display, `{k1: v, k2: v, ...}`: BUILD_MAP allocates the table for
   * the number of entries written when there are more than five.
   */
  static literal(keys) {
    const dict = new Dict();
    if (keys.length > 5) dict.table = resized(dict.table, keys.length);
    for (const key of keys) dict.set(key);
    return dict;
  }

  _insert(key, hash) {
    const slot = findSlot(this.table, hash, key);
    if (this.table[slot] === undefined) this.used += 1;
    this.table[slot] = { key, hash };
  }

  /** d[key] = value: PyDict_SetItem, which grows the table when it is two-thirds full. */
  set(key) {
    const before = this.used;
    this._insert(key, hashKey(key));
    if (this.used > before && this.used * 3 >= this.table.length * 2) {
      this.table = resized(this.table, (this.used > 50000 ? 2 : 4) * this.used);
    }
    return this;
  }

  /**
   * d.copy(), and so copy.copy(d): PyDict_Merge into a new dict. One resize up
   * front if it will be needed, then the entries in the source's slot order,
   * with no growth check as they go in.
   *
   * ⚠ The resize is to FOUR times the entry count in the client's interpreter
   * (measured: a 6-entry copy has 32 slots, an 8-entry one 64). Reading the
   * CPython source from memory says two; the interpreter says four.
   */
  copy() {
    const copy = new Dict();
    if (this.used === 0) return copy;
    if (this.used * 3 >= copy.table.length * 2) copy.table = resized(copy.table, this.used * 4);
    for (const entry of this.table) {
      if (entry !== undefined) copy._insert(entry.key, entry.hash);
    }
    return copy;
  }

  /** The keys in iteration order: slot order. */
  keys() {
    return this.table.filter((entry) => entry !== undefined).map((entry) => entry.key);
  }
}

/**
 * The order CPython 2.7 iterates a dict built by inserting `keys` in order.
 *
 * `presized` is the number of entries a dict LITERAL was written with. Pass 0
 * for a dict that began empty (`{}`, `dict()`).
 */
function dictOrder(keys, { presized = 0 } = {}) {
  if (presized > 5) return Dict.literal(keys).keys();
  const dict = new Dict();
  for (const key of keys) dict.set(key);
  return dict.keys();
}

/** `entries` ([key, value] pairs in insertion order) in CPython 2.7 iteration order. */
function orderEntries(entries, options) {
  const byKey = new Map(entries.map((entry) => [entry[0], entry]));
  return dictOrder(entries.map(([key]) => key), options).map((key) => byKey.get(key));
}

/**
 * The order a remote call's keywords go out in, given the order they were
 * written at the call site: `thing.Method(a, first=1, second=2)`.
 *
 * Every step below makes a new dict, and a new dict can order two keys that
 * want the same slot differently, so the steps have to be the client's own:
 *
 *   via "function"  A remote SERVICE's method is a plain function
 *                   (MachoServiceConnection.__getattr__ returns a closure). The
 *                   interpreter fills its **kwargs in the order written.
 *   via "object"    A BOUND OBJECT's method is an object with __call__
 *                   (MachoObjectCallWrapper). The interpreter first collects
 *                   the keywords by popping its stack, LAST one first, and then
 *                   fills __call__'s **kwargs from that dict's order.
 *
 * Either way the GPCS layer then copies the dict (copy.copy) and adds
 * machoVersion. `hops` is for a path with further **keywords functions in it;
 * the client's own two paths have none.
 */
function keywordOrder(written, { via = "function", hops = 0, added = ["machoVersion"] } = {}) {
  let dict = new Dict();
  if (via === "object") {
    const collected = new Dict();
    for (const key of [...written].reverse()) collected.set(key);
    for (const key of collected.keys()) dict.set(key);
  } else {
    for (const key of written) dict.set(key);
  }
  for (let hop = 0; hop < hops; hop += 1) {
    const next = new Dict();
    for (const key of dict.keys()) next.set(key);
    dict = next;
  }
  const sent = dict.copy();
  for (const key of added) sent.set(key);
  return sent.keys();
}

/**
 * The order of the fields of an instance made by calling its class with keywords, where the class keeps them as
 * the instance's own: utillib.KeyVal(a=1, b=2), whose __init__(self, dictLikeObject=None, **kw) has
 * self.__dict__ = kw. A class is not a plain function, so the interpreter collects the keywords off its stack,
 * last one first, and __init__'s **kw is filled from that dict's order. The instance goes to the wire with its
 * fields in the order of kw.
 */
function constructorKeywordOrder(written) {
  const collected = new Dict();
  for (const key of [...written].reverse()) collected.set(key);
  const kept = new Dict();
  for (const key of collected.keys()) kept.set(key);
  return kept.keys();
}

/** moniker.py Bind's localKeywords: what a call's keywords say to the client itself, and are not sent. */
const MONIKER_LOCAL_KEYWORDS = new Set(["machoTimeout", "noCallThrottling"]);

/**
 * The order the keywords of a call go in when the call rides along with a
 * Moniker's bind (moniker.py). MonikerCallWrap is an object with __call__, so
 * the interpreter collects them as for a bound object's method; Bind then
 * builds a new dict of them, without the client's own two. Nothing is added:
 * machoVersion goes on the bind's own keywords.
 */
function monikerKeywordOrder(written) {
  const collected = new Dict();
  for (const key of [...written].reverse()) collected.set(key);
  const keywords = new Dict();
  for (const key of collected.keys()) keywords.set(key);
  const sent = new Dict();
  for (const key of keywords.keys()) if (!MONIKER_LOCAL_KEYWORDS.has(key)) sent.set(key);
  return sent.keys();
}

/**
 * The code units whose Unicode category is one of the C ones (control, format, surrogate, private use, not
 * assigned) to the client's own Python: unicodedata.category(ch)[0] == 'C' for each unichr below 0x10000, asked of
 * the client's python27.dll with its unicodedata.pyd (scripts/py27-oracle.py). Its Unicode data is 5.2.0, so a
 * character that was given a meaning later is not assigned to it; and its build is narrow (sys.maxunicode is
 * 65535), so a character beyond the first plane is two surrogates, each of them here. 383 ranges, in hex.
 */
const CATEGORY_C_RANGES = [
  "0-1F,7F-9F,AD,378-379,37F-383,38B,38D,3A2,526-530,557-558,560,588,58B-590,5C8-5CF," +
  "5EB-5EF,5F5-605,61C-61D,620,65F,6DD,70E-70F,74B-74C,7B2-7BF,7FB-7FF,82E-82F,83F-8FF,93A-93B,94F," +
  "956-957,973-978,980,984,98D-98E,991-992,9A9,9B1,9B3-9B5,9BA-9BB,9C5-9C6,9C9-9CA,9CF-9D6,9D8-9DB," +
  "9DE,9E4-9E5,9FC-A00,A04,A0B-A0E,A11-A12,A29,A31,A34,A37,A3A-A3B,A3D,A43-A46,A49-A4A," +
  "A4E-A50,A52-A58,A5D,A5F-A65,A76-A80,A84,A8E,A92,AA9,AB1,AB4,ABA-ABB,AC6,ACA," +
  "ACE-ACF,AD1-ADF,AE4-AE5,AF0,AF2-B00,B04,B0D-B0E,B11-B12,B29,B31,B34,B3A-B3B,B45-B46,B49-B4A," +
  "B4E-B55,B58-B5B,B5E,B64-B65,B72-B81,B84,B8B-B8D,B91,B96-B98,B9B,B9D,BA0-BA2,BA5-BA7,BAB-BAD," +
  "BBA-BBD,BC3-BC5,BC9,BCE-BCF,BD1-BD6,BD8-BE5,BFB-C00,C04,C0D,C11,C29,C34,C3A-C3C,C45," +
  "C49,C4E-C54,C57,C5A-C5F,C64-C65,C70-C77,C80-C81,C84,C8D,C91,CA9,CB4,CBA-CBB,CC5," +
  "CC9,CCE-CD4,CD7-CDD,CDF,CE4-CE5,CF0,CF3-D01,D04,D0D,D11,D29,D3A-D3C,D45,D49," +
  "D4E-D56,D58-D5F,D64-D65,D76-D78,D80-D81,D84,D97-D99,DB2,DBC,DBE-DBF,DC7-DC9,DCB-DCE,DD5,DD7," +
  "DE0-DF1,DF5-E00,E3B-E3E,E5C-E80,E83,E85-E86,E89,E8B-E8C,E8E-E93,E98,EA0,EA4,EA6,EA8-EA9," +
  "EAC,EBA,EBE-EBF,EC5,EC7,ECE-ECF,EDA-EDB,EDE-EFF,F48,F6D-F70,F8C-F8F,F98,FBD,FCD," +
  "FD9-FFF,10C6-10CF,10FD-10FF,1249,124E-124F,1257,1259,125E-125F,1289,128E-128F,12B1,12B6-12B7,12BF,12C1," +
  "12C6-12C7,12D7,1311,1316-1317,135B-135E,137D-137F,139A-139F,13F5-13FF,169D-169F,16F1-16FF,170D,1715-171F,1737-173F,1754-175F," +
  "176D,1771,1774-177F,17B4-17B5,17DE-17DF,17EA-17EF,17FA-17FF,180F,181A-181F,1878-187F,18AB-18AF,18F6-18FF,191D-191F,192C-192F," +
  "193C-193F,1941-1943,196E-196F,1975-197F,19AC-19AF,19CA-19CF,19DB-19DD,1A1C-1A1D,1A5F,1A7D-1A7E,1A8A-1A8F,1A9A-1A9F,1AAE-1AFF,1B4C-1B4F," +
  "1B7D-1B7F,1BAB-1BAD,1BBA-1BFF,1C38-1C3A,1C4A-1C4C,1C80-1CCF,1CF3-1CFF,1DE7-1DFC,1F16-1F17,1F1E-1F1F,1F46-1F47,1F4E-1F4F,1F58,1F5A," +
  "1F5C,1F5E,1F7E-1F7F,1FB5,1FC5,1FD4-1FD5,1FDC,1FF0-1FF1,1FF5,1FFF,200B-200F,202A-202E,2060-206F,2072-2073," +
  "208F,2095-209F,20B9-20CF,20F1-20FF,218A-218F,23E9-23FF,2427-243F,244B-245F,26CE,26E2,26E4-26E7,2700,2705,270A-270B," +
  "2728,274C,274E,2753-2755,275F-2760,2795-2797,27B0,27BF,27CB,27CD-27CF,2B4D-2B4F,2B5A-2BFF,2C2F,2C5F," +
  "2CF2-2CF8,2D26-2D2F,2D66-2D6E,2D70-2D7F,2D97-2D9F,2DA7,2DAF,2DB7,2DBF,2DC7,2DCF,2DD7,2DDF,2E32-2E7F," +
  "2E9A,2EF4-2EFF,2FD6-2FEF,2FFC-2FFF,3040,3097-3098,3100-3104,312E-3130,318F,31B8-31BF,31E4-31EF,321F,32FF,4DB6-4DBF," +
  "9FCC-9FFF,A48D-A48F,A4C7-A4CF,A62C-A63F,A660-A661,A674-A67B,A698-A69F,A6F8-A6FF,A78D-A7FA,A82C-A82F,A83A-A83F,A878-A87F,A8C5-A8CD,A8DA-A8DF," +
  "A8FC-A8FF,A954-A95E,A97D-A97F,A9CE,A9DA-A9DD,A9E0-A9FF,AA37-AA3F,AA4E-AA4F,AA5A-AA5B,AA7C-AA7F,AAC3-AADA,AAE0-ABBF,ABEE-ABEF,ABFA-ABFF," +
  "D7A4-D7AF,D7C7-D7CA,D7FC-F8FF,FA2E-FA2F,FA6E-FA6F,FADA-FAFF,FB07-FB12,FB18-FB1C,FB37,FB3D,FB3F,FB42,FB45,FBB2-FBD2," +
  "FD40-FD4F,FD90-FD91,FDC8-FDEF,FDFE-FDFF,FE1A-FE1F,FE27-FE2F,FE53,FE67,FE6C-FE6F,FE75,FEFD-FF00,FFBF-FFC1,FFC8-FFC9,FFD0-FFD1," +
  "FFD8-FFD9,FFDD-FFDF,FFE7,FFEF-FFFB,FFFE-FFFF",
].join("").split(",").map((range) => range.split("-").map((end) => parseInt(end, 16))).map(([from, to = from]) => [from, to]);

/** Whether a code unit is of a C category to the client's Python: a search of the ranges, which are in order. */
function isCategoryC(unit) {
  let low = 0;
  let high = CATEGORY_C_RANGES.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [from, to] = CATEGORY_C_RANGES[middle];
    if (unit < from) high = middle - 1;
    else if (unit > to) low = middle + 1;
    else return true;
  }
  return false;
}

/**
 * u''.join(ch for ch in text if unicodedata.category(ch)[0] != 'C'), as the client's Python does it: a JS string's
 * code units are a narrow build's characters, one for one.
 */
function withoutCategoryC(text) {
  let kept = "";
  for (let at = 0; at < text.length; at += 1) {
    if (!isCategoryC(text.charCodeAt(at))) kept += text[at];
  }
  return kept;
}

module.exports = { Dict, constructorKeywordOrder, dictOrder, hashKey, hashLong, hashString, keywordOrder, monikerKeywordOrder, orderEntries, withoutCategoryC };
