"use strict";

// Local Base constructor row only: exact original schema and eight PyInt0
// inputs, or the omitted-data zero-storage branch. This is an INTERNAL
// source-record interface, not blue.DBRow or a decoded packed-row carrier.
// Original Base133-155 and installed InitSeq/Set/Get evidence: cdxctorrowagent1.
const { attributePythonType } = require("./clientDogmaArithmetic");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");

const CLIENT_DOGMA_INSTANCE_SCHEMA = Object.freeze([
  ["instanceID", 20], ["online", 11], ["damage", 5], ["charge", 5],
  ["skillPoints", 3], ["armorDamage", 5], ["shieldCharge", 5], ["incapacitated", 11],
].map(pair => Object.freeze(pair)));

const COLUMN_NAMES = new Map(CLIENT_DOGMA_INSTANCE_SCHEMA.map(([name], index) => [name, index]));
const KINDS = new Map([
  [20, Object.freeze({ kind: "integer", pythonType: "long", dbType: 20, source: "client-dogma-constructor-row" })],
  [11, Object.freeze({ kind: "boolean", pythonType: "bool", dbType: 11, source: "client-dogma-constructor-row" })],
  [5, Object.freeze({ kind: "real", pythonType: "float", dbType: 5, source: "client-dogma-constructor-row" })],
  [3, Object.freeze({ kind: "integer", pythonType: "int", dbType: 3, source: "client-dogma-constructor-row" })],
]);
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);

function zeroRecord(index) {
  const [, dbType] = CLIENT_DOGMA_INSTANCE_SCHEMA[index];
  return Object.freeze({ value: dbType === 20 ? 0n : dbType === 11 ? false : 0, kind: KINDS.get(dbType) });
}

function requirePyIntZero(record) {
  // Class comes from the source record, never from an integral-looking number.
  // Other valid native numeric/null conversions remain outside this adapter.
  if (attributePythonType(record) !== "int" || (record.value !== 0 && record.value !== 0n)) {
    throw notReady("literal PyInt-zero instance input");
  }
}

function createClientDogmaConstructorRowApi() {
  const descriptors = new WeakSet(), rows = new WeakMap();

  function DBRowDescriptor(columns) {
    if (arguments.length !== 1 || !Array.isArray(columns) || columns.length !== 8) {
      throw notReady("fixed eight-column instance descriptor");
    }
    for (let index = 0; index < 8; ++index) {
      const pair = columns[index], expected = CLIENT_DOGMA_INSTANCE_SCHEMA[index];
      if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== expected[0] || pair[1] !== expected[1]) {
        throw notReady("fixed ordered instance descriptor columns");
      }
    }
    const descriptor = Object.freeze({ length: 8 });
    descriptors.add(descriptor);
    return descriptor;
  }

  function DBRow(descriptor, data) {
    if (!descriptors.has(descriptor) || (arguments.length !== 1 && arguments.length !== 2)) {
      throw notReady("local fixed instance-row constructor");
    }
    const omitted = arguments.length === 1;
    if (!omitted && (!Array.isArray(data) || data.length !== 8)) {
      // Explicit null/undefined is NOT the omitted-data branch. Native None
      // goes through InitSeq; general/short sequence handling is unported.
      throw notReady("eight explicit PyInt-zero instance inputs");
    }
    const cells = [];
    for (let index = 0; index < 8; ++index) {
      if (!omitted) {
        if (!Object.hasOwn(data, index)) throw notReady("present instance input slot");
        // InitSeq reads then converts ONE input before reading the next. Do
        // not pre-map/validate every value and change failure/read ordering.
        requirePyIntZero(data[index]);
      }
      cells.push(zeroRecord(index));
    }
    const row = {};
    const unsupportedSet = () => { throw notReady("instance-row mutation"); };
    Object.defineProperties(row, {
      length: { value: 8 },
      __header__: { get: () => descriptor, set: unsupportedSet },
    });
    for (let index = 0; index < 8; ++index) {
      const get = () => cells[index];
      Object.defineProperty(row, index, { get, set: unsupportedSet });
      Object.defineProperty(row, CLIENT_DOGMA_INSTANCE_SCHEMA[index][0], { get, set: unsupportedSet });
    }
    // All aliases and record APIs share these SAME cells. Reusing internal
    // record wrappers makes no claim about native scalar heap identities.
    rows.set(row, Object.freeze(cells));
    return Object.freeze(row);
  }

  function recordAt(row, index) {
    if (!rows.has(row) || typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= 8) {
      throw notReady("local instance row and normalized index zero through seven");
    }
    return rows.get(row)[index];
  }

  function recordByName(row, name) {
    // JS strings here represent the exact fixed ASCII Python byte names;
    // Unicode/arbitrary mapping keys, negative indices and setters are not
    // silently generalized into a full native DBRow implementation.
    if (typeof name !== "string" || !COLUMN_NAMES.has(name)) throw notReady("known ASCII instance column name");
    return recordAt(row, COLUMN_NAMES.get(name));
  }

  return Object.freeze({ DBRowDescriptor, DBRow, recordAt, recordByName });
}

module.exports = { CLIENT_DOGMA_INSTANCE_SCHEMA, createClientDogmaConstructorRowApi };
