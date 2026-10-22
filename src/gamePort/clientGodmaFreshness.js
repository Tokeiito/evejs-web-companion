"use strict";

const { getDecodedNumberKind } = require("../gameProtocol/marshal");
const { attributePythonType } = require("./clientDogmaArithmetic");

// Preserve ingress classes before fieldsOf/key/number or a spread loses the
// decoder sidecar. A field record is a view of the actual reply, not a cache.
function decodedFieldRecord(info, name) {
  const dict = info?.type === "object" ? info.args : info;
  if (Array.isArray(dict?.entries)) {
    const pair = dict.entries.find(([key]) => (Buffer.isBuffer(key) ? key.toString("utf8") : key) === name);
    if (pair) return { value: pair[1], kind: getDecodedNumberKind(pair, 1) };
  }
  const fields = info?.fields;
  return { value: fields?.[name], kind: getDecodedNumberKind(fields, name) };
}

// Shared numeric ingress conversion. Existing heap references stay unchanged.
function createGodmaNativeRecordConverter(runtime, tuple) {
  const values = runtime.values;
  function native(record) {
    if (record.native) return record.native;
    const { value, kind } = record;
    if (Array.isArray(value)) return tuple.call(...value.map((part, index) => native({ value: part, kind: getDecodedNumberKind(value, index) })));
    if (value === null) return values.none();
    if (typeof value === "boolean") return values.bool(value);
    // A retained BigInt is an explicit long; ordinary JS numbers require
    // decoder or arithmetic provenance, never an integrality guess.
    const type = attributePythonType(record) ?? (typeof value === "bigint" ? "long" : undefined);
    if (type === "int") return values.int(value);
    if (type === "long") return values.long(typeof value === "bigint" ? value : BigInt(value));
    if (type === "float") return values.float(value);
    throw new TypeError("Godma ingress requires the original Python numeric class.");
  }
  return native;
}

/** Capture the original manager at logical entry and read its CURRENT native
 * freshness dict per operation. Release refuses an old continuation instead
 * of moving it into a replacement manager.
 */
function createClientGodmaFreshness({ runtime, owner, module, context, assertCurrent }) {
  const native = createGodmaNativeRecordConverter(runtime, module.getAttr("tuple_key"));
  return Object.freeze({
    captureWarm() {
      assertCurrent();
      const manager = owner.getAttr("get_state_manager_warm").call();
      function current() {
        assertCurrent();
        if (manager.getAttr("godma") !== owner.getAttr("instance")) throw new Error("The captured Godma manager was released.");
      }
      return Object.freeze({
        manager,
        assertCurrent: current,
        character() { current(); return context.session.getAttr("charid"); },
        relevant(item, attribute, wallclock) {
          current();
          return manager.getAttr("_IsAttributeChangeRelevant").call(native(item), native(attribute), native(wallclock)).truth();
        },
        notice(item, attribute, wallclock) {
          current();
          return module.getAttr("notice_prefix").call(manager, native(item), native(attribute), native(wallclock)).truth();
        },
        owns(item, ownerID) {
          current();
          return module.getAttr("owns").call(native(item), native(ownerID), context.session.getAttr("charid")).truth();
        },
        replace() { current(); return module.getAttr("replace").call(manager); },
      });
    },
  });
}

module.exports = { createClientGodmaFreshness, decodedFieldRecord, createGodmaNativeRecordConverter };
