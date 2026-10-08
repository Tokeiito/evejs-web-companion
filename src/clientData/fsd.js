"use strict";

// ── The client's FSD data: a schema and the binary it describes ──────────────
//
// Much of the retail client's static data is "FSD": a binary file and, beside
// it, a small schema in YAML saying how the binary is laid out. This reads
// both, for the node types the client's dialog table uses. The layout is the
// client's own loaders' (fsd/schemas/binaryLoader.py and loaders/*.py):
//
//   int      4 bytes, unsigned when the schema's min is not negative
//   enum     the smallest unsigned integer that holds maxEnumValue; its name
//   bool     one byte, true when 255
//   string   a uint32 length and that many bytes
//   list     a uint32 count; then, for items of one size (fixedItemSize), the
//            items; otherwise a uint32 offset for each, from the list's start
//   object   attributes at fixed offsets (constantAttributeOffsets); then, at
//            endOfFixedSizeData, a uint64 of bits saying which optional
//            attributes are present (optionalValueLookups), when there are
//            any; then, 8 bytes after endOfFixedSizeData either way, a uint32
//            offset for each present attribute of attributesWithVariableOffsets,
//            counted from the end of that table
//   dict     a uint32 size; the values; a footer listing {key, offset}; and
//            the footer's own size in the last 4 bytes. A value is at the
//            dict's start + 4 + its offset.
//
// Anything else is refused by name.

class FsdError extends Error {
  constructor(message) {
    super(message);
    this.name = "FsdError";
  }
}

// ── the schema: the part of YAML these files use ─────────────────────────────

function scalar(text) {
  const value = text.trim();
  if (value === "" || value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith("\"") && value.endsWith("\""))) return value.slice(1, -1);
  return value;
}

/** A flow collection, {a: 1, b: [x, y]} or [a, b], from `text` at `at`. Answers [value, next]. */
function flow(text, at) {
  const skip = (index) => {
    let cursor = index;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    return cursor;
  };
  const value = (index) => {
    const start = skip(index);
    if (text[start] === "{" || text[start] === "[") return flow(text, start);
    let end = start;
    while (end < text.length && !",}]".includes(text[end])) end += 1;
    return [scalar(text.slice(start, end)), end];
  };
  const closing = text[at] === "{" ? "}" : "]";
  const out = text[at] === "{" ? {} : [];
  let cursor = skip(at + 1);
  while (cursor < text.length && text[cursor] !== closing) {
    if (Array.isArray(out)) {
      const [item, next] = value(cursor);
      out.push(item);
      cursor = skip(next);
    } else {
      const colon = text.indexOf(":", cursor);
      if (colon === -1) throw new FsdError("A flow mapping in the schema has a key with no value.");
      const [item, next] = value(colon + 1);
      out[text.slice(cursor, colon).trim()] = item;
      cursor = skip(next);
    }
    if (text[cursor] === ",") cursor = skip(cursor + 1);
  }
  if (text[cursor] !== closing) throw new FsdError("A flow collection in the schema is never closed.");
  return [out, cursor + 1];
}

/** A schema file as nested objects. Block mappings by indentation, flow collections, plain scalars. */
function parseSchema(text) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
  let index = 0;
  const indentOf = (line) => line.length - line.trimStart().length;
  function block(indent) {
    const out = {};
    while (index < lines.length && indentOf(lines[index]) === indent) {
      const line = lines[index];
      const colon = line.indexOf(":");
      if (colon === -1) throw new FsdError(`The schema has a line that is not a mapping: ${JSON.stringify(line.trim())}`);
      const key = line.slice(indent, colon).trim();
      let rest = line.slice(colon + 1).trim();
      index += 1;
      if (rest === "") {
        out[key] = index < lines.length && indentOf(lines[index]) > indent ? block(indentOf(lines[index])) : null;
      } else if (rest.startsWith("{") || rest.startsWith("[")) {
        // A flow collection may run on over the next, deeper lines.
        const balance = (value) => [...value].reduce((depth, char) => depth + ("{[".includes(char) ? 1 : "}]".includes(char) ? -1 : 0), 0);
        while (balance(rest) > 0 && index < lines.length) {
          rest += ` ${lines[index].trim()}`;
          index += 1;
        }
        out[key] = flow(rest, 0)[0];
      } else {
        out[key] = scalar(rest);
      }
    }
    return out;
  }
  const schema = block(lines.length > 0 ? indentOf(lines[0]) : 0);
  if (index < lines.length) throw new FsdError(`The schema's indentation is not understood at: ${JSON.stringify(lines[index].trim())}`);
  return schema;
}

// ── the binary ───────────────────────────────────────────────────────────────

function check(buffer, offset, size, what) {
  if (!Number.isInteger(offset) || offset < 0 || offset + size > buffer.length) {
    throw new FsdError(`The data ends before ${what} at byte ${offset}.`);
  }
}
const u32 = (buffer, offset, what) => { check(buffer, offset, 4, what); return buffer.readUInt32LE(offset); };

function readEnum(buffer, offset, schema) {
  const max = Number(schema.maxEnumValue) || 0;
  const size = max <= 0xff ? 1 : max <= 0xffff ? 2 : 4;
  check(buffer, offset, size, "an enum");
  const value = size === 1 ? buffer.readUInt8(offset) : size === 2 ? buffer.readUInt16LE(offset) : buffer.readUInt32LE(offset);
  if (schema.readEnumValue) return value;
  for (const [name, number] of Object.entries(schema.values || {})) {
    if (number === value) return name;
  }
  return null;
}

function readList(buffer, offset, schema) {
  const known = Number.isInteger(schema.length) ? schema.length : null;
  const count = known ?? u32(buffer, offset, "a list's count");
  const start = known === null ? 4 : 0;
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const at = "fixedItemSize" in schema
      ? offset + start + Number(schema.itemTypes.size) * index
      : offset + u32(buffer, offset + start + 4 * index, "a list item's offset");
    items.push(readNode(buffer, at, schema.itemTypes));
  }
  return items;
}

function readObject(buffer, offset, schema) {
  const attributes = schema.attributes || {};
  const out = {};
  const constant = schema.constantAttributeOffsets || {};
  for (const [name, at] of Object.entries(constant)) {
    out[name] = readNode(buffer, offset + at, attributes[name]);
  }
  for (const [name, attribute] of Object.entries(attributes)) {
    if (!(name in out) && "default" in attribute) out[name] = attribute.default;
  }
  if ("size" in schema) return out;
  const variable = schema.attributesWithVariableOffsets || [];
  const optional = schema.optionalValueLookups || {};
  const end = Number(schema.endOfFixedSizeData) || 0;
  let present = variable;
  if (Object.keys(optional).length > 0) {
    check(buffer, offset + end, 8, "an object's optional attributes");
    const bits = buffer.readBigUInt64LE(offset + end);
    present = variable.filter((name) => !(name in optional) || (bits & BigInt(optional[name])) !== 0n);
  }
  const table = offset + end + 8;
  const base = table + 4 * present.length;
  present.forEach((name, index) => {
    out[name] = readNode(buffer, base + u32(buffer, table + 4 * index, "an attribute's offset"), attributes[name]);
  });
  return out;
}

function readDict(buffer, offset, schema) {
  if (!schema.keyTypes || schema.keyTypes.type !== "string") {
    throw new FsdError(`A dict keyed by ${schema.keyTypes ? schema.keyTypes.type : "nothing"} is not one this reader knows; it reads dicts keyed by strings.`);
  }
  const sizeOfData = u32(buffer, offset, "a dict's size");
  const sizeOfFooter = u32(buffer, offset + sizeOfData, "a dict's footer size");
  const footerStart = offset + sizeOfData - sizeOfFooter;
  check(buffer, footerStart, sizeOfFooter, "a dict's footer");
  const out = new Map();
  for (const entry of readList(buffer, footerStart, schema.keyFooter)) {
    out.set(entry.key, readNode(buffer, offset + 4 + entry.offset, schema.valueTypes));
  }
  return out;
}

/** The value a schema node describes, at `offset` in `buffer`. */
function readNode(buffer, offset, schema) {
  switch (schema && schema.type) {
    case "int":
    case "typeID":
    case "localizationID":
      check(buffer, offset, 4, "an int");
      return (schema.min >= 0 || schema.exclusiveMin >= -1) ? buffer.readUInt32LE(offset) : buffer.readInt32LE(offset);
    case "enum":
      return readEnum(buffer, offset, schema);
    case "bool":
      check(buffer, offset, 1, "a bool");
      return buffer.readUInt8(offset) === 255;
    case "string":
    case "resPath": {
      const length = u32(buffer, offset, "a string's length");
      check(buffer, offset + 4, length, "a string");
      return buffer.latin1Slice(offset + 4, offset + 4 + length);
    }
    case "list":
      return readList(buffer, offset, schema);
    case "object":
      return readObject(buffer, offset, schema);
    case "dict":
      return readDict(buffer, offset, schema);
    default:
      throw new FsdError(`A ${schema ? JSON.stringify(schema.type) : "missing"} node is not one this reader knows.`);
  }
}

/** A whole FSD file read by the schema that ships beside it. */
function readFsd(buffer, schemaText) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("readFsd needs a Buffer.");
  return readNode(buffer, 0, parseSchema(schemaText));
}

module.exports = { FsdError, parseSchema, readFsd, readNode };
