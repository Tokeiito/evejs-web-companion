"use strict";

const { getDecodedNumberKind, marshalDecode } = require("../gameProtocol/marshal");
const { encodeClient } = require("./clientMarshal");
const { nativeSessionScalar } = require("./clientSessionContext");
const { GODMA_NATIVE_ROW } = require("./clientGodmaFreshness");

/** One actual wire-row/header occurrence -> one native backing object on this
 * inventory owner. This is the existing named DBRow port, not the Blue heap
 * unmarshaller. Inventory and numeric Godma consumers share this ingress.
 */
function createClientInventoryRows({ runtime, rows, descriptors, assertCurrent }) {
  const headers = new WeakMap(), objects = new WeakMap(), failures = new WeakMap(), converting = new WeakSet();
  const builtins = runtime.values.global("__builtin__");
  function value(wire, kind) {
    if (wire && typeof wire === "object") {
      if (failures.has(wire)) throw failures.get(wire);
      if (objects.has(wire)) return objects.get(wire);
      if (converting.has(wire)) throw new TypeError("Cyclic tuple ingress requires the native unmarshaller.");
      if (Buffer.isBuffer(wire) || wire.type === "wstring") {
        const result = nativeSessionScalar(runtime, { value: wire, kind });
        objects.set(wire, result); return result;
      }
      if (wire.type === "dict" || wire.type === "list") {
        const result = builtins.getAttr(wire.type).call();
        objects.set(wire, result);
        try {
          if (wire.type === "dict") for (const pair of wire.entries) result.setItem(value(pair[0], getDecodedNumberKind(pair, 0)), value(pair[1], getDecodedNumberKind(pair, 1)));
          else for (const [i, item] of wire.items.entries()) result.getAttr("append").call(value(item, getDecodedNumberKind(wire.items, i)));
        } catch (error) { failures.set(wire, error); throw error; }
        return result;
      }
      if (Array.isArray(wire)) {
        converting.add(wire);
        try {
          const list = builtins.getAttr("list").call();
          for (const [i, item] of wire.entries()) list.getAttr("append").call(value(item, getDecodedNumberKind(wire, i)));
          const result = builtins.getAttr("tuple").call(list); objects.set(wire, result); return result;
        } catch (error) { failures.set(wire, error); throw error; }
        finally { converting.delete(wire); }
      }
      throw new TypeError("The inventory object cell requires an unprepared native wire class.");
    }
    return nativeSessionScalar(runtime, { value: wire, kind });
  }
  function materialize(wire) {
    assertCurrent();
    if (wire?.[GODMA_NATIVE_ROW]) return wire[GODMA_NATIVE_ROW];
    if (!wire || wire.type !== "packedrow" || !Array.isArray(wire.values) || !wire.header) throw new TypeError("An actual decoded packed inventory row is required.");
    if (failures.has(wire)) throw failures.get(wire);
    if (objects.has(wire)) return objects.get(wire);
    try {
      let header = headers.get(wire.header);
      if (!header) { header = descriptors.materialize(wire.header); headers.set(wire.header, header); }
      const values = builtins.getAttr("list").call();
      for (const [index, cell] of wire.values.entries()) values.getAttr("append").call(value(cell, getDecodedNumberKind(wire.values, index)));
      const result = rows.create(header, values);
      objects.set(wire, result); return result;
    } catch (error) { failures.set(wire, error); throw error; }
  }
  function projectValue(native, seen = new Set()) {
    if (["NoneType", "bool", "int", "long", "float", "str"].includes(native.kind)) return native.scalar;
    if (native.kind === "unicode") return { type: "wstring", value: native.scalar };
    if (seen.has(native)) throw new TypeError("Cyclic inventory object cells cannot enter bridge JSON.");
    seen.add(native);
    try {
      const name = builtins.getAttr("type").call(native).getAttr("__name__").scalar.toString();
      if (name === "list" || name === "tuple") {
        const items = Array.from({ length: Number(native.getAttr("__len__").call().scalar) }, (_, i) => projectValue(native.getItem(BigInt(i)), seen));
        return name === "tuple" ? items : { type: "list", items };
      }
      if (name === "dict") {
        const pairs = native.getAttr("items").call();
        return { type: "dict", entries: Array.from({ length: Number(pairs.getAttr("__len__").call().scalar) }, (_, i) => {
          const pair = pairs.getItem(BigInt(i)); return [projectValue(pair.getItem(0n), seen), projectValue(pair.getItem(1n), seen)];
        }) };
      }
      throw new TypeError("The native inventory object cell has no prepared bridge projection.");
    } finally { seen.delete(native); }
  }
  function project(native) {
    assertCurrent();
    const header = native.getAttr("__header__"), wire = descriptors.provenance(header).wire;
    const names = header.getAttr("Keys").call(), virtual = header.getAttr("_virtual");
    const count = Number(names.getAttr("__len__").call().scalar), physical = count - (virtual.kind === "NoneType" ? 0 : Number(virtual.getAttr("__len__").call().scalar));
    const fields = {}, values = [], columns = wire.header[1][0];
    for (let i = 0; i < count; i++) {
      const name = names.getItem(BigInt(i)).scalar.toString();
      const get = () => projectValue(native.getAttr(name));
      Object.defineProperty(fields, name, { enumerable: true, get });
      if (i < physical) Object.defineProperty(values, i, { enumerable: true, get });
    }
    const result = { type: "packedrow", header: wire, columns, values, fields };
    Object.defineProperty(result, GODMA_NATIVE_ROW, { value: native });
    return result;
  }
  function argument(wire) {
    assertCurrent();
    const tuple = marshalDecode(encodeClient([wire]), { preserveNumberKinds: true });
    return value(tuple[0], getDecodedNumberKind(tuple, 0));
  }
  return Object.freeze({ materialize, project, argument, projectValue });
}

module.exports = { createClientInventoryRows };
