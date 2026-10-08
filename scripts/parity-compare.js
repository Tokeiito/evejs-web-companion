"use strict";

// Compare one answer as the gateway gave it with the same answer from the game
// port, after src/gamePort/bridgeJson.js.
//
// The two were read minutes apart on different sessions, so their VALUES can
// honestly differ (a clock, a row that moved). What matters for a decoder is
// the SHAPE: whether it will find the same kinds of thing in the same places.
// So each difference is given a kind, and the kinds are ranked:
//
//   value, count      the data moved; the shape is the same
//   tolerated forms   two spellings of one value that the browser's shared
//                     readers (web/src/bridge/wire.ts) already accept either of
//   divergent         a decoder written against the gateway's answer could
//                     read the game port's differently. Two of these are known
//                     spellings with no shared reader, so each decoder that
//                     meets one has to take both: tuple-form (a tuple with or
//                     without its wrapper) and bytes-form (the same for bytes)
//
// The verdict for an answer is the worst kind found in it.

const TOLERATED = new Set([
  // unwrapLong reads a bare integer and a {type:"long"} wrapper alike.
  "long-form",
  // unwrapLong reads a bare string of digits too (since 2026-10-08), which is
  // how the gateway prints a handler's bare BigInt.
  "bare-bigint-string",
  // unwrapReal reads a bare number and a {type:"real"} wrapper alike.
  "real-form",
  // readPackedRow reads a row by `fields` or by `values` against `columns`.
  "packedrow-form",
]);
const MOVED = new Set(["value", "count"]);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isIntegerString = (value) => typeof value === "string" && /^-?\d+$/.test(value);

/** The byte values of a buffer as either transport spells it, or null. */
function bytesOf(value) {
  const buffer = isObject(value) && value.type === "bytes" ? value.value : value;
  return isObject(buffer) && buffer.type === "Buffer" && Array.isArray(buffer.data) ? buffer.data : null;
}

/** What a value is, for telling two shapes apart. */
function kindOf(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "tuple";
  if (typeof value !== "object") return typeof value;
  return typeof value.type === "string" ? value.type : "plain-object";
}

/** The number a numeric form stands for, or null: a bare number, a long or a real wrapper. */
function numeric(value) {
  if (typeof value === "number") return { form: "number", value };
  if (isObject(value) && (value.type === "long" || value.type === "real")) {
    const inner = value.value;
    if (typeof inner === "number") return { form: value.type, value: inner };
    if (isIntegerString(inner)) return { form: value.type, value: BigInt(inner) };
  }
  return null;
}

/** A string form's text, or null: a bare string, or a wstring / token / rawstr wrapper. */
function textual(value) {
  if (typeof value === "string") return { form: "string", value };
  if (isObject(value) && ["wstring", "token", "rawstr"].includes(value.type) && typeof value.value === "string") {
    return { form: value.type, value: value.value };
  }
  return null;
}

/** Two numbers are the same value, whether each is a JS number or a BigInt. */
function sameNumber(a, b) {
  if (typeof a === "number" && typeof b === "number") return a === b;
  const whole = (value) => (typeof value === "bigint" ? value : Number.isInteger(value) ? BigInt(value) : null);
  const [x, y] = [whole(a), whole(b)];
  return x !== null && y !== null && x === y;
}

/** A dict key as something two sides can be matched on. */
function keyOf(key) {
  const number = numeric(key);
  if (number) return `n:${number.value}`;
  const text = textual(key);
  if (text) return `s:${text.value}`;
  return `j:${JSON.stringify(key)}`;
}

/** A packed row's cells by column name, whichever of its two forms it is in. */
function rowCells(row) {
  if (isObject(row.fields)) return { form: "fields", cells: row.fields };
  const cells = {};
  const columns = Array.isArray(row.columns) ? row.columns : [];
  columns.forEach((column, index) => {
    const name = Array.isArray(column) ? column[0] : column;
    if (typeof name === "string") cells[name] = Array.isArray(row.values) ? row.values[index] ?? null : null;
  });
  return { form: "values", cells };
}

const sample = (value) => {
  const text = JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > 90 ? `${text.slice(0, 87)}...` : text;
};

function compare(gateway, wire, path = "$", differences = []) {
  const note = (kind) => {
    if (differences.length < 400) differences.push({ path, kind, gateway: sample(gateway), wire: sample(wire) });
  };

  // Two numeric forms of anything.
  const [numberA, numberB] = [numeric(gateway), numeric(wire)];
  if (numberA && numberB) {
    if (numberA.form !== numberB.form) note(numberA.form === "real" || numberB.form === "real" ? "real-form" : "long-form");
    if (!sameNumber(numberA.value, numberB.value)) note("value");
    return differences;
  }
  // The gateway prints a handler's bare BigInt as a string of digits.
  if (isIntegerString(gateway) && numberB) {
    note("bare-bigint-string");
    return differences;
  }

  const [textA, textB] = [textual(gateway), textual(wire)];
  if (textA && textB) {
    if (textA.form !== textB.form) note("string-form");
    if (textA.value !== textB.value) note("value");
    return differences;
  }

  const [kindA, kindB] = [kindOf(gateway), kindOf(wire)];
  // {type:"tuple", items} is a tuple too.
  const tupleItems = (value, kind) => (kind === "tuple" && !Array.isArray(value) ? value.items ?? [] : value);
  if (kindA !== kindB) {
    // The gateway prints a byte string inside a {type:"bytes"} wrapper that
    // the wire does not carry. Same bytes, two spellings.
    const [bytesA, bytesB] = [bytesOf(gateway), bytesOf(wire)];
    if (bytesA && bytesB) {
      note("bytes-form");
      if (bytesA.length !== bytesB.length) note("count");
      else if (bytesA.some((byte, index) => byte !== bytesB[index])) note("value");
      return differences;
    }
    note(kindA === "null" || kindB === "null" ? "null-vs-value" : "shape");
    return differences;
  }

  switch (kindA) {
    case "null":
      return differences;
    case "boolean":
      if (gateway !== wire) note("value");
      return differences;
    case "tuple": {
      const [itemsA, itemsB] = [tupleItems(gateway, kindA), tupleItems(wire, kindB)];
      if (Array.isArray(gateway) !== Array.isArray(wire)) note("tuple-form");
      if (itemsA.length !== itemsB.length) note("count");
      for (let index = 0; index < Math.min(itemsA.length, itemsB.length); index += 1) {
        compare(itemsA[index], itemsB[index], `${path}[${index}]`, differences);
      }
      return differences;
    }
    case "list": {
      const [itemsA, itemsB] = [gateway.items ?? [], wire.items ?? []];
      if (itemsA.length !== itemsB.length) note("count");
      // Rows of one list share a shape; the first few say what it is.
      for (let index = 0; index < Math.min(itemsA.length, itemsB.length, 5); index += 1) {
        compare(itemsA[index], itemsB[index], `${path}.items[${index}]`, differences);
      }
      return differences;
    }
    case "dict": {
      const byKey = (dict) => new Map((dict.entries ?? []).map((entry) => [keyOf(entry[0]), entry]));
      const [entriesA, entriesB] = [byKey(gateway), byKey(wire)];
      const missing = [...entriesA.keys()].filter((key) => !entriesB.has(key));
      const extra = [...entriesB.keys()].filter((key) => !entriesA.has(key));
      if (missing.length > 0 || extra.length > 0) {
        // A dict keyed by ids is data; a dict keyed by names is structure.
        const named = [...missing, ...extra].some((key) => key.startsWith("s:"));
        if (differences.length < 400) {
          differences.push({ path, kind: named ? "keys" : "count", gateway: sample(missing.slice(0, 6)), wire: sample(extra.slice(0, 6)) });
        }
      }
      let compared = 0;
      for (const [key, [rawKey, entry]] of entriesA) {
        if (!entriesB.has(key)) continue;
        // The key's own spelling: a string here and a wrapper there would matter.
        compare(rawKey, entriesB.get(key)[0], `${path}.key(${key.slice(2, 30)})`, differences);
        // An id-keyed dict's values share a shape; a name-keyed one's do not.
        if (key.startsWith("s:") || compared < 5) compare(entry, entriesB.get(key)[1], `${path}.${key.slice(2, 30)}`, differences);
        compared += 1;
      }
      return differences;
    }
    case "object":
      compare(gateway.name, wire.name, `${path}.name`, differences);
      compare(gateway.args, wire.args, `${path}.args`, differences);
      return differences;
    case "objectex1":
    case "objectex2":
      compare(gateway.header, wire.header, `${path}.header`, differences);
      compare({ type: "list", items: gateway.list ?? [] }, { type: "list", items: wire.list ?? [] }, `${path}.list`, differences);
      compare({ type: "dict", entries: gateway.dict ?? [] }, { type: "dict", entries: wire.dict ?? [] }, `${path}.dict`, differences);
      return differences;
    case "packedrow": {
      const [rowA, rowB] = [rowCells(gateway), rowCells(wire)];
      // The game port's row carries both forms, so it can stand in for either.
      if (rowA.form === "values" && !Array.isArray(wire.values)) note("packedrow-form");
      if (rowA.form === "fields" && !isObject(wire.fields)) note("packedrow-form");
      const names = new Set([...Object.keys(rowA.cells), ...Object.keys(rowB.cells)]);
      for (const name of names) {
        if (!(name in rowA.cells) || !(name in rowB.cells)) {
          if (differences.length < 400) differences.push({ path: `${path}.${name}`, kind: "keys", gateway: sample(rowA.cells[name]), wire: sample(rowB.cells[name]) });
          continue;
        }
        compare(rowA.cells[name], rowB.cells[name], `${path}.${name}`, differences);
      }
      return differences;
    }
    case "substream":
    case "substruct":
    case "checksummed":
      compare(gateway.value, wire.value, `${path}.value`, differences);
      return differences;
    case "Buffer":
      if (JSON.stringify(gateway.data) !== JSON.stringify(wire.data)) note("value");
      return differences;
    case "plain-object": {
      const names = new Set([...Object.keys(gateway), ...Object.keys(wire)]);
      for (const name of names) {
        if (!(name in gateway) || !(name in wire)) {
          if (differences.length < 400) differences.push({ path: `${path}.${name}`, kind: "keys", gateway: sample(gateway[name]), wire: sample(wire[name]) });
          continue;
        }
        compare(gateway[name], wire[name], `${path}.${name}`, differences);
      }
      return differences;
    }
    default:
      if (JSON.stringify(gateway) !== JSON.stringify(wire)) note("value");
      return differences;
  }
}

/**
 * The gateway's cached-answer envelope, opened the way the browser opens it
 * (web/src/bridge/market.ts unwrapCachedResult): the answer when it is carried
 * inline, nothing when it is a reference to the object cache, which the browser
 * cannot follow. The game port never needs this; its session returns the answer.
 */
function openEnvelope(value) {
  if (!isObject(value) || value.type !== "object") return { envelope: null, value };
  const name = textual(value.name);
  if (!name || !name.value.endsWith("objectCaching.CachedMethodCallResult")) return { envelope: null, value };
  const carrier = Array.isArray(value.args) ? value.args[1] : null;
  if (isObject(carrier) && carrier.type === "substream") return { envelope: "inline", value: carrier.value ?? null };
  return { envelope: "reference", value: null };
}

/**
 * Where in a gateway answer there is a value the server cannot marshal, or null.
 *
 * The gateway prints whatever a handler returned. The game port has to marshal
 * it, and the server's marshaller refuses a bare JS object that says no type
 * ("Cannot marshal value: object {}"); it logs that and answers None. So a
 * handler that returns one works through the gateway and answers nothing on the
 * game port, to us and to the retail client alike.
 */
function findUnmarshalable(value, path = "$") {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findUnmarshalable(entry, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (typeof value.type !== "string") return path;
  // A packed row's `fields` is a plain object by design; the marshaller packs it.
  if (value.type === "packedrow" || value.type === "Buffer") return null;
  for (const [name, entry] of Object.entries(value)) {
    const found = findUnmarshalable(entry, `${path}.${name}`);
    if (found) return found;
  }
  return null;
}

/** identical, moved, tolerated or divergent: the worst kind of difference found. */
function verdictOf(differences) {
  if (differences.length === 0) return "identical";
  if (differences.every((difference) => MOVED.has(difference.kind))) return "moved";
  if (differences.every((difference) => MOVED.has(difference.kind) || TOLERATED.has(difference.kind))) return "tolerated";
  return "divergent";
}

/** The kinds of difference found, most serious first, with how many of each. */
function kindsOf(differences) {
  const counts = new Map();
  for (const { kind } of differences) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const rank = (kind) => (MOVED.has(kind) ? 2 : TOLERATED.has(kind) ? 1 : 0);
  return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]);
}

module.exports = { MOVED, TOLERATED, compare, findUnmarshalable, kindsOf, openEnvelope, verdictOf };
