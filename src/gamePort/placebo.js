"use strict";

// The retail client's "Placebo" crypto pack, and its password hash.
//
// The client has two crypto packs (packages/evecrypto). A client that talks to
// eve.js runs the Placebo one, and the proof is on the server's side of the
// wire: the handshake answers every login with challenge_responsehash "55087",
// which the client checks against CryptoHash(clientChallenge) and hangs up on
// any mismatch. 55087 is exactly what Placebo's hash gives for Placebo's
// challenge (64 NUL bytes). test/gamePortPlacebo.test.js pins that number.
//
// Placebo is not encryption. Packets are sent in the clear; what it provides is
// the set of values the handshake still has to carry.

const crypto = require("node:crypto");
const { marshalEncode } = require("../gameProtocol/marshal");

/** binascii.crc_hqx: CRC-CCITT, polynomial 0x1021, as Python 2.7 computes it. */
function crcHqx(bytes, crc = 0) {
  let value = crc & 0xffff;
  for (const byte of bytes) {
    value ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 0x8000 ? ((value << 1) ^ 0x1021) & 0xffff : (value << 1) & 0xffff;
    }
  }
  return value;
}

/**
 * placebo.crypto_hash(*args): str(binascii.crc_hqx(blue.marshal.Save(args), 0)).
 * A decimal string, not a number. Arguments are Python byte strings, given here
 * as JS strings of latin1 code units.
 */
function cryptoHash(...args) {
  return String(crcHqx(marshalEncode(args)));
}

/** placebo.get_random_bytes(n): not random at all. */
function randomBytes(count) {
  return "\u0000".repeat(count);
}

/** carbon format.CaseFold: upper then lower, repeated until it stops changing. */
function caseFold(text) {
  const folded = text.toUpperCase().toLowerCase();
  return folded === text ? folded : caseFold(folded);
}

/**
 * machobase.PasswordHash(userName, password): SHA-1 over the UTF-16LE password
 * and a salt, then 1000 more rounds of SHA-1 over the previous digest and the
 * salt. 20 raw bytes.
 *
 * ⚠ The salt is the stripped user name encoded to UTF-16LE and THEN lowered as
 * a byte string, which is what the client does. Lowering bytes touches only
 * 0x41-0x5A, wherever they fall, so a name outside ASCII does not come out as
 * its lower-cased spelling.
 */
function passwordHash(userName, password) {
  const salt = Buffer.from(userName.trim(), "utf16le").map((byte) => (byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte));
  const sha1 = (data) => crypto.createHash("sha1").update(Buffer.concat([data, salt])).digest();
  let digest = sha1(Buffer.from(password, "utf16le"));
  for (let round = 0; round < 1000; round += 1) digest = sha1(digest);
  return digest;
}

module.exports = { caseFold, crcHqx, cryptoHash, passwordHash, randomBytes };
