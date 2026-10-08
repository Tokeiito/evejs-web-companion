"use strict";

// The Placebo crypto pack and the password hash, against three independent
// witnesses:
//
//   the client's own Python 2.7   test/fixtures/py27Oracle.json: crc_hqx, and
//                                 machobase.PasswordHash run by hand
//   the eve.js server             its handshake answers every login with
//                                 challenge_responsehash "55087", which the
//                                 retail client checks and would hang up on
//   the retail client itself      eve.js logged its challenge answer as a
//                                 5-byte string on 2026-10-06 (tidi_probe)

const test = require("node:test");
const assert = require("node:assert/strict");
const { marshalEncode } = require("../src/gameProtocol/marshal");
const { caseFold, crcHqx, cryptoHash, passwordHash, randomBytes } = require("../src/gamePort/placebo");
const oracle = require("./fixtures/py27Oracle.json");

test("crc_hqx matches the client's binascii", () => {
  assert.ok(oracle.crc.length >= 6);
  for (const [hex, expected] of oracle.crc) {
    assert.equal(crcHqx(Buffer.from(hex, "hex")), expected, hex.slice(0, 24) || "(empty)");
  }
});

test("the hash of Placebo's login challenge is the number the server answers with", () => {
  const challenge = randomBytes(64);
  assert.equal(challenge, "\u0000".repeat(64), "Placebo's random bytes are NULs");
  // What blue.marshal.Save(args) writes, as the client's Python then hashes it.
  const marshaled = marshalEncode([challenge]).toString("hex");
  const fromOracle = new Map(oracle.crc);
  assert.equal(fromOracle.get(marshaled), 55087, "the oracle's CRC of the same bytes");
  assert.equal(cryptoHash(challenge), "55087");
});

test("the hash of an empty server challenge is the 5 characters the retail client sent", () => {
  assert.equal(new Map(oracle.crc).get(marshalEncode([""]).toString("hex")), 44596);
  assert.equal(cryptoHash(""), "44596");
});

test("a crypto hash is a decimal string, never a number", () => {
  assert.equal(typeof cryptoHash("test2"), "string");
  assert.match(cryptoHash("test2"), /^\d{1,5}$/);
});

test("the password hash matches the client's, including a name outside ASCII", () => {
  assert.ok(oracle.passwordHashes.length >= 4);
  const utf16 = (hex) => Buffer.from(hex, "hex").toString("utf16le");
  for (const [userHex, passwordHex, digestHex] of oracle.passwordHashes) {
    const [userName, password] = [utf16(userHex), utf16(passwordHex)];
    assert.equal(passwordHash(userName, password).toString("hex"), digestHex, JSON.stringify(userName));
  }
  // The trap: the client lowers the ENCODED name byte by byte. U+0141 encodes
  // as 41 01, so its 0x41 is lowered too and the salt is not "łukasz".
  const [, , digest] = oracle.passwordHashes.find(([userHex]) => utf16(userHex) === "Łukasz");
  const wrongSalt = require("node:crypto").createHash("sha1")
    .update(Buffer.concat([Buffer.from("päss", "utf16le"), Buffer.from("łukasz", "utf16le")])).digest("hex");
  assert.notEqual(wrongSalt, digest);
});

test("the user name's case and surrounding spaces do not change the hash; the password's do", () => {
  assert.deepEqual(passwordHash("Alice", "x"), passwordHash("  aLICE ", "x"));
  assert.notDeepEqual(passwordHash("Alice", "x"), passwordHash("Alice", "X"));
  assert.equal(passwordHash("Alice", "x").length, 20);
});

test("case folding matches the client's", () => {
  for (const [name, folded] of oracle.caseFolds) assert.equal(caseFold(name), folded);
});
