"use strict";

// Builds the retail client's dialog table, for tests: an FSD binary laid out as
// the client's own loaders read one (fsd/schemas/loaders/*.py; src/clientData/fsd.js
// says how), and the schema that describes it. The schema is the layout the
// client's `dialogs.schema` gives. The dialogs put in it are the test's own.

const DIALOG_SCHEMA = `keyFooter:
  itemTypes:
    attributes:
      offset: {min: 0, size: 4, type: int}
      key: {type: string}
    attributesWithVariableOffsets: [key]
    constantAttributeOffsets: {offset: 0}
    endOfFixedSizeData: 4
    optionalValueLookups: {}
    type: object
  type: list
keyTypes: {type: string}
type: dict
valueTypes:
  attributes:
    dialogID: {size: 4, type: int}
    dialogType:
      maxEnumValue: 9
      size: 1
      type: enum
      values:
        hint: 1
        info: 2
        notify: 3
        question: 4
        audio: 5
        warning: 6
        error: 7
        fatal: 8
        windowhelp: 9
    bodyID: {default: null, isOptional: true, size: 4, type: int}
    suppressable:
      default: false
      isOptional: true
      maxEnumValue: 7
      size: 1
      type: enum
      values:
        false: 0
        true: 1
        ID_YES: 6
        ID_NO: 7
    closable: {default: true, isOptional: true, size: 1, type: bool}
    titleID: {default: null, isOptional: true, size: 4, type: int}
    urlAudio: {default: '', isOptional: true, type: string}
    urlIcon: {default: '', isOptional: true, type: string}
  attributesWithVariableOffsets: [bodyID, suppressable, closable, titleID, urlAudio,
    urlIcon]
  constantAttributeOffsets: {dialogID: 0, dialogType: 4}
  endOfFixedSizeData: 5
  maxBitFieldValue: 32
  optionalValueLookups: {bodyID: 1, closable: 4, suppressable: 2, titleID: 8, urlAudio: 16,
    urlIcon: 32}
  type: object
`;

const TYPES = { hint: 1, info: 2, notify: 3, question: 4, audio: 5, warning: 6, error: 7, fatal: 8, windowhelp: 9 };
const SUPPRESSABLE = { false: 0, true: 1, ID_YES: 6, ID_NO: 7 };
const OPTIONAL = [["bodyID", 1], ["suppressable", 2], ["closable", 4], ["titleID", 8], ["urlAudio", 16], ["urlIcon", 32]];

const u32 = (value) => { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; };
const i32 = (value) => { const out = Buffer.alloc(4); out.writeInt32LE(value); return out; };
const string = (text) => Buffer.concat([u32(Buffer.byteLength(text, "latin1")), Buffer.from(text, "latin1")]);

function encode(name, value) {
  switch (name) {
    case "bodyID":
    case "titleID": return i32(value);
    // By name, or as the byte itself (for a value the enum has no name for).
    case "suppressable": return Buffer.from([typeof value === "number" ? value : SUPPRESSABLE[String(value)]]);
    case "closable": return Buffer.from([value ? 255 : 0]);
    default: return string(value);
  }
}

/** One dialog's object: the fixed part, the bits for what is present, an offset for each, then the values. */
function dialogObject({ dialogID, type = "question", ...optional }) {
  const present = OPTIONAL.filter(([name]) => optional[name] !== undefined);
  const bits = Buffer.alloc(8);
  bits.writeBigUInt64LE(BigInt(present.reduce((sum, [, bit]) => sum + bit, 0)));
  const values = present.map(([name]) => encode(name, optional[name]));
  let at = 0;
  const table = values.map((value) => { const offset = u32(at); at += value.length; return offset; });
  return Buffer.concat([i32(dialogID), Buffer.from([TYPES[type]]), bits, ...table, ...values]);
}

/** The whole table: its size, the dialogs, a footer of {offset, key} sorted by key, and the footer's size. */
function dialogTable(dialogs) {
  const names = Object.keys(dialogs).sort();
  const objects = [];
  const offsets = new Map();
  let at = 0;
  for (const name of names) {
    const object = dialogObject(dialogs[name]);
    offsets.set(name, at);
    objects.push(object);
    at += object.length;
  }
  // The footer is a list of objects of varying size: a count, an offset for each from the list's start, the objects.
  const items = names.map((name) => Buffer.concat([u32(offsets.get(name)), Buffer.alloc(8), u32(0), string(name)]));
  let itemAt = 4 + 4 * items.length;
  const itemOffsets = items.map((item) => { const offset = u32(itemAt); itemAt += item.length; return offset; });
  const footer = Buffer.concat([u32(items.length), ...itemOffsets, ...items]);
  const values = Buffer.concat(objects);
  return Buffer.concat([u32(values.length + footer.length + 4), values, footer, u32(footer.length)]);
}

module.exports = { DIALOG_SCHEMA, dialogObject, dialogTable };
