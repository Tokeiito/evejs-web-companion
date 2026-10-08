"use strict";

// The client's FSD data: its schema read, and the binary read by it.
//
// The schema here is the layout the client's own `dialogs.schema` gives, and
// the binary is built by test/helpers/fsdDialogs.js the way the client's
// loaders read one. The first bytes of the client's real table agree with that
// layout: 00 d8 04 00 (the size), then 87 0a 00 00 (dialogID 2695), 04
// (question), 09 00.. (bits: bodyID and titleID present), two offsets 0 and 4,
// and the two message IDs. scripts/client-words.js reads the real thing.

const test = require("node:test");
const assert = require("node:assert/strict");
const { FsdError, parseSchema, readFsd, readNode } = require("../src/clientData/fsd");
const { DIALOG_SCHEMA, dialogObject, dialogTable } = require("./helpers/fsdDialogs");

// ── the schema ───────────────────────────────────────────────────────────────

test("the dialog schema reads as its layout: block mappings, flow collections that run over a line, plain values", () => {
  const schema = parseSchema(DIALOG_SCHEMA);
  assert.equal(schema.type, "dict");
  assert.deepEqual(schema.keyTypes, { type: "string" });
  assert.deepEqual(schema.keyFooter.itemTypes.attributes, { offset: { min: 0, size: 4, type: "int" }, key: { type: "string" } });
  assert.deepEqual(schema.keyFooter.itemTypes.optionalValueLookups, {});
  assert.deepEqual(schema.keyFooter.itemTypes.attributesWithVariableOffsets, ["key"]);
  const value = schema.valueTypes;
  assert.deepEqual(value.constantAttributeOffsets, { dialogID: 0, dialogType: 4 });
  assert.equal(value.endOfFixedSizeData, 5);
  // Both of these run over two lines in the file.
  assert.deepEqual(value.attributesWithVariableOffsets, ["bodyID", "suppressable", "closable", "titleID", "urlAudio", "urlIcon"]);
  assert.deepEqual(value.optionalValueLookups, { bodyID: 1, closable: 4, suppressable: 2, titleID: 8, urlAudio: 16, urlIcon: 32 });
  assert.deepEqual(value.attributes.dialogType.values, { hint: 1, info: 2, notify: 3, question: 4, audio: 5, warning: 6, error: 7, fatal: 8, windowhelp: 9 });
  assert.deepEqual(value.attributes.suppressable.values, { false: 0, true: 1, ID_YES: 6, ID_NO: 7 });
  assert.deepEqual(value.attributes.bodyID, { default: null, isOptional: true, size: 4, type: "int" });
  assert.deepEqual(value.attributes.urlAudio, { default: "", isOptional: true, type: "string" });
  assert.deepEqual(value.attributes.closable, { default: true, isOptional: true, size: 1, type: "bool" });
});

test("a schema's plain values are read as what they are, and nesting follows the indentation", () => {
  const schema = parseSchema("# a comment\na: 1\nb: -2\nc: 1.5\nd: true\ne: false\nf: null\ng: ''\nh: \"quoted\"\ni: plain words\nj:\n  k:\n    l: [1, [2, 3], {m: x}]\n  n: {}\no:\n\r\np: []\n");
  assert.deepEqual(schema, { a: 1, b: -2, c: 1.5, d: true, e: false, f: null, g: "", h: "quoted", i: "plain words", j: { k: { l: [1, [2, 3], { m: "x" }] }, n: {} }, o: null, p: [] });
  assert.deepEqual(parseSchema(""), {});
});

test("a schema this reader cannot follow is refused, not half-read", () => {
  for (const [text, message] of [
    ["a: 1\nnot a mapping\n", /not a mapping/],
    ["a: {b: 1\n", /never closed/],
    ["a: {b}\n", /key with no value/],
    ["a:\n    b: 1\n  c: 2\n", /indentation is not understood/],
  ]) {
    assert.throws(() => parseSchema(text), (error) => error instanceof FsdError && message.test(error.message), JSON.stringify(text));
  }
});

// ── the binary ───────────────────────────────────────────────────────────────

const DIALOGS = {
  ShipContrabandWarningUndock: { dialogID: 1552, type: "question", bodyID: 258952, suppressable: true, titleID: 258951 },
  ChtCustomsConfiscationConfirmation2: { dialogID: 566, type: "question", bodyID: 259882, titleID: 259881 },
  OnlyABody: { dialogID: 7, type: "notify", bodyID: 5001 },
  Everything: { dialogID: -3, type: "windowhelp", bodyID: 1, suppressable: "ID_NO", closable: false, titleID: 2, urlAudio: "res:/audio/x.wem", urlIcon: "res:/ui/icon.png" },
  Bare: { dialogID: 9, type: "fatal" },
};

test("the dialog table reads as its dialogs by name, each with what it has and the schema's default for what it has not", () => {
  const table = readFsd(dialogTable(DIALOGS), DIALOG_SCHEMA);
  assert.ok(table instanceof Map);
  assert.deepEqual([...table.keys()], ["Bare", "ChtCustomsConfiscationConfirmation2", "Everything", "OnlyABody", "ShipContrabandWarningUndock"]);
  assert.deepEqual(table.get("ShipContrabandWarningUndock"), { dialogID: 1552, dialogType: "question", bodyID: 258952, suppressable: "true", closable: true, titleID: 258951, urlAudio: "", urlIcon: "" });
  assert.deepEqual(table.get("ChtCustomsConfiscationConfirmation2"), { dialogID: 566, dialogType: "question", bodyID: 259882, suppressable: false, closable: true, titleID: 259881, urlAudio: "", urlIcon: "" });
  assert.deepEqual(table.get("OnlyABody"), { dialogID: 7, dialogType: "notify", bodyID: 5001, suppressable: false, closable: true, titleID: null, urlAudio: "", urlIcon: "" });
  assert.deepEqual(table.get("Everything"), { dialogID: -3, dialogType: "windowhelp", bodyID: 1, suppressable: "ID_NO", closable: false, titleID: 2, urlAudio: "res:/audio/x.wem", urlIcon: "res:/ui/icon.png" });
  assert.deepEqual(table.get("Bare"), { dialogID: 9, dialogType: "fatal", bodyID: null, suppressable: false, closable: true, titleID: null, urlAudio: "", urlIcon: "" });
  assert.equal(table.get("NoSuchDialog"), undefined);
  assert.equal(readFsd(dialogTable({}), DIALOG_SCHEMA).size, 0);
});

test("a dialog's bytes are where the client's first real dialog has them", () => {
  // The client's table begins, after its size: dialogID 2695, question, bits 9, offsets 0 and 4, bodyID, titleID.
  const object = dialogObject({ dialogID: 2695, type: "question", bodyID: 257664, titleID: 257663 });
  assert.equal(object.toString("hex"), "870a0000" + "04" + "0900000000000000" + "00000000" + "04000000" + "80ee0300" + "7fee0300");
  const value = readNode(object, 0, parseSchema(DIALOG_SCHEMA).valueTypes);
  assert.deepEqual([value.dialogID, value.dialogType, value.bodyID, value.titleID], [2695, "question", 257664, 257663]);
});

test("the primitive kinds read as the client's loaders read them", () => {
  const bytes = Buffer.from("ffffffff" + "ff" + "00" + "fe" + "03000000616263" + "0201", "hex");
  assert.equal(readNode(bytes, 0, { type: "int", min: 0 }), 4294967295);
  assert.equal(readNode(bytes, 0, { type: "int" }), -1);
  assert.equal(readNode(bytes, 0, { type: "int", exclusiveMin: -1 }), 4294967295);
  assert.equal(readNode(bytes, 4, { type: "bool" }), true);
  assert.equal(readNode(bytes, 5, { type: "bool" }), false);
  assert.equal(readNode(bytes, 6, { type: "bool" }), false, "true is 255 and nothing else");
  assert.equal(readNode(bytes, 7, { type: "string" }), "abc");
  // An enum is as wide as its largest value needs, and is read as its name, or as its number when asked.
  assert.equal(readNode(bytes, 14, { type: "enum", maxEnumValue: 9, values: { two: 2, one: 1 } }), "two");
  assert.equal(readNode(bytes, 14, { type: "enum", maxEnumValue: 300, values: { wide: 258 } }), "wide");
  assert.equal(readNode(bytes, 14, { type: "enum", maxEnumValue: 9, values: { one: 1 } }), null);
  assert.equal(readNode(bytes, 14, { type: "enum", maxEnumValue: 9, values: { two: 2 }, readEnumValue: true }), 2);
  // A list of items of one size has them one after another; of a known length, with no count.
  const fixed = Buffer.from("02000000" + "0a000000" + "0b000000", "hex");
  assert.deepEqual(readNode(fixed, 0, { type: "list", fixedItemSize: 4, itemTypes: { type: "int", size: 4 } }), [10, 11]);
  assert.deepEqual(readNode(fixed, 4, { type: "list", fixedItemSize: 4, length: 2, itemTypes: { type: "int", size: 4 } }), [10, 11]);
});

test("data that ends early, or is of a kind this reader does not know, is refused by name", () => {
  const table = dialogTable(DIALOGS);
  const cases = [
    [() => readFsd(table.subarray(0, table.length - 3), DIALOG_SCHEMA), /ends before a dict's footer size/],
    [() => readFsd(table.subarray(0, 2), DIALOG_SCHEMA), /ends before a dict's size/],
    [() => readFsd(Buffer.concat([Buffer.from("10000000", "hex"), Buffer.alloc(12), Buffer.from("ff000000", "hex")]), DIALOG_SCHEMA), /ends before a dict's footer/],
    [() => readNode(Buffer.from("05000000ab", "hex"), 0, { type: "string" }), /ends before a string/],
    [() => readNode(Buffer.alloc(2), 0, { type: "int" }), /ends before an int/],
    [() => readNode(Buffer.alloc(8), 0, { type: "vector3" }), /"vector3" node is not one this reader knows/],
    [() => readNode(Buffer.alloc(8), 0, null), /missing node/],
    [() => readFsd(table, DIALOG_SCHEMA.replace("keyTypes: {type: string}", "keyTypes: {type: int}")), /dict keyed by int/],
  ];
  for (const [read, message] of cases) {
    assert.throws(read, (error) => error instanceof FsdError && message.test(error.message), String(message));
  }
  assert.throws(() => readFsd("not a buffer", DIALOG_SCHEMA), (error) => error instanceof TypeError && /needs a Buffer/.test(error.message));
});
