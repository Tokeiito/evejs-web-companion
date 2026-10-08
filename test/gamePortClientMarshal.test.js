"use strict";

// The encoder for what the client sends: a Python long goes out as blue's 0x2f.
//
// The byte strings for longs are the ones eve.js pins in
// server/tests/marshalBlueWireParity.test.js against CCP's blue source
// ("Bytes as blue's WriteLong produces them"). There they prove the server READS
// them; here they are what we must WRITE.

const test = require("node:test");
const assert = require("node:assert/strict");
const { marshalDecodeExact, marshalEncode } = require("../src/gameProtocol/marshal");
const { encodeClient, long } = require("../src/gamePort/clientMarshal");

const HEADER = "7e00000000";
const body = (value) => encodeClient(value).toString("hex").slice(HEADER.length);

const BLUE_LONGS = [
  ["2f00", 0n],
  ["2f0105", 5n],
  ["2f02ff00", 255n],
  ["2f028000", 128n],
  ["2f01ff", -1n],
  ["2f01fb", -5n],
  ["2f0180", -128n],
  ["2f027fff", -129n],
  ["2f060010a5d4e800", 1_000_000_000_000n],
  ["2f0600f05a2b17ff", -1_000_000_000_000n],
  ["2f07ffffffffffff1f", BigInt(Number.MAX_SAFE_INTEGER)],
  ["2f07010000000000e0", BigInt(Number.MIN_SAFE_INTEGER)],
  ["2f09000000000000008000", 2n ** 63n],
  ["2f080000000000000080", -(2n ** 63n)],
  ["2f09ffffffffffffff7fff", -(2n ** 63n) - 1n],
  ["2f09000000000000000040", 2n ** 70n],
  ["2f090000000000000000c0", -(2n ** 70n)],
];

test("a Python long is written as blue's WriteLong writes it", () => {
  for (const [hex, value] of BLUE_LONGS) {
    assert.equal(body(long(value)), hex, String(value));
    assert.equal(body(value), hex, `${value}n as a BigInt`);
  }
});

test("the server reads our long back as the same number", () => {
  for (const [, value] of BLUE_LONGS) {
    const decoded = marshalDecodeExact(encodeClient(long(value)));
    assert.equal(BigInt(decoded), value, String(value));
  }
});

test("a whole number beyond 32 bits is a long, because the client can hold it no other way", () => {
  // An item ID. As an int64 (the server encoder's choice) the server reads a
  // BigInt; as a long it reads the number its handlers expect.
  const itemID = 9988400103291;
  // 0x09159b0a3f7b, low byte first.
  assert.equal(itemID.toString(16), "9159b0a3f7b");
  assert.equal(body(itemID), "2f067b3f0a9b1509");
  assert.deepEqual(marshalDecodeExact(encodeClient([itemID])), [itemID]);
  assert.equal(typeof marshalDecodeExact(encodeClient([itemID]))[0], "number");
  assert.equal(typeof marshalDecodeExact(marshalEncode([itemID]))[0], "bigint", "the server encoder's int64 is what this replaces");
  assert.equal(body(2147483648), "2f050000008000");
  assert.equal(body(-2147483649), "2f05ffffff7fff");
});

test("a whole number within 32 bits stays an int, in the int form its size calls for", () => {
  for (const value of [0, 1, -1, 5, -5, 127, -128, 128, 32767, -32768, 32768, 2147483647, -2147483648]) {
    assert.equal(encodeClient(value).toString("hex"), marshalEncode(value).toString("hex"), String(value));
  }
  // The same small value written as a long is not the same bytes.
  assert.notEqual(body(long(5)), body(5));
});

test("everything without a long in it is the server codec's own encoding", () => {
  const values = [
    null, true, false, 0.5, 24.01, 0.0, "", "a", "V24.01@ccp", "machoNet", "\u0000".repeat(64),
    { type: "wstring", value: "test" }, { type: "wstring", value: "" },
    { type: "bytes", value: Buffer.from([0, 255, 16, 128]) }, Buffer.from([1, 2, 3]),
    [], [1], [1, "two"], [1, 2, 3, 4],
    { type: "list", items: [] }, { type: "list", items: [1] }, { type: "list", items: [1, 2, 3] },
    { type: "dict", entries: [] }, { type: "dict", entries: [["machoVersion", 1], ["flag", null]] },
    { type: "object", name: "carbon.common.script.net.machoNetPacket.MachoAddress", args: [8, "config", null] },
    { type: "substream", value: [1, "GetTime", [], { type: "dict", entries: [["machoVersion", 1]] }] },
    [[0, { type: "substream", value: ["N=65450:3", "List", [4], { type: "dict", entries: [] }] }]],
    { type: "tuple", items: [1, 2] },
    { type: "substruct", value: { type: "substream", value: ["N=1:2", 0] } },
  ];
  for (const value of values) {
    assert.equal(encodeClient(value).toString("hex"), marshalEncode(value).toString("hex"), JSON.stringify(value)?.slice(0, 80));
  }
});

test("a long is found wherever it sits: in a tuple, a list, a dict, an object, a substream", () => {
  const id = 1054656331535;
  const cases = [
    [id, "x"],
    { type: "list", items: [id] },
    { type: "dict", entries: [[id, 80], ["pin", id]] },
    { type: "object", name: "util.KeyVal", args: [id] },
    { type: "substream", value: [1, "Method", [id], { type: "dict", entries: [] }] },
    [[0, { type: "substream", value: [1, "Method", [[id, 15]], { type: "dict", entries: [] }] }]],
  ];
  const numbers = (value, found = []) => {
    if (typeof value === "number" || typeof value === "bigint") found.push(value);
    else if (Array.isArray(value)) value.forEach((entry) => numbers(entry, found));
    else if (value && typeof value === "object" && !Buffer.isBuffer(value)) Object.values(value).forEach((entry) => numbers(entry, found));
    return found;
  };
  for (const value of cases) {
    const decoded = numbers(marshalDecodeExact(encodeClient(value)));
    assert.ok(decoded.includes(id), JSON.stringify(value).slice(0, 60));
    assert.ok(decoded.every((entry) => typeof entry === "number"), `no BigInt reaches the server: ${JSON.stringify(value).slice(0, 60)}`);
  }
});
