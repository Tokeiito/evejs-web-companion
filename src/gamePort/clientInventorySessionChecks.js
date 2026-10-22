"use strict";

const { nativeSessionScalar } = require("./clientSessionContext");
const { projectNativeNodeAddress } = require("./clientMachoAddress");
const { getDecodedNumberKind } = require("../gameProtocol/marshal");
const { long } = require("./clientMarshal");

/** Original native inventory connections, owned by actual receipt holders.
 * The session registry is weak; neither it nor a per-N callback roots them.
 * Native containers and the original synchronous RPC scheduler remain separate.
 */
function createClientInventorySessionChecks({ runtime, module, context, assertCurrent }) {
  const receipts = new WeakMap(), publicValues = new WeakMap(), publicFailures = new WeakMap(), converting = new WeakSet();
  function current() { assertCurrent(); context.assertCurrent(); }
  function receipt(objectID, reference) {
    current();
    if (typeof objectID !== "string" || !objectID.startsWith("N=")) throw new TypeError("An actual returned inventory object is required.");
    if (reference?.objectID !== objectID || !reference.source || !reference.pair || !reference.refID) throw new TypeError("The actual decoded inventory reference receipt is required.");
    let record = receipts.get(reference);
    if (!record) {
      const pa = reference.hasPublicAttributes ? publicValue(reference.publicAttributes) : module.getAttr("new_policy").call();
      record = module.getAttr("receipt").call(context.module, Buffer.from(objectID, "utf8"), pa, nativeSessionScalar(runtime, reference.refID));
      receipts.set(reference, record);
    }
    return record;
  }
  function project(value) {
    if (value.kind === "int") return value.scalar;
    if (value.kind === "long") return long(value.scalar);
    if (value.kind === "str") return value.scalar;
    if (value.kind === "NoneType") return null;
    if (value.getAttr("__class__").getAttr("__name__").scalar.toString() === "tuple") {
      return Array.from({ length: Number(value.getAttr("__len__").call().scalar) }, (_, index) => project(value.getItem(BigInt(index))));
    }
    throw new TypeError("The native manager identity has no prepared wire projection.");
  }
  function dispatch(record) {
    module.getAttr("perform_in_context").call(context.module, record);
    const destination = record.getAttr("destination");
    return { cacheIdentity: project(record.getAttr("persistantObjectID")), prepareDestination() {
      return projectNativeNodeAddress(destination);
    } };
  }
  function publicValue(value, kind) {
    if (value && typeof value === "object" && !Buffer.isBuffer(value) && value.type !== "wstring") {
      const failed = publicFailures.get(value);
      if (failed) throw failed;
      const kept = publicValues.get(value);
      if (kept) return kept;
      if (converting.has(value)) throw new TypeError("A cyclic public-attribute tuple has no prepared native ingress.");
      if (value.type === "dict" || value.type === "list") {
        const result = module.getAttr(value.type === "dict" ? "new_policy" : "new_list").call();
        publicValues.set(value, result);
        try {
          if (value.type === "dict") for (const pair of value.entries) result.setItem(publicValue(pair[0], getDecodedNumberKind(pair, 0)), publicValue(pair[1], getDecodedNumberKind(pair, 1)));
          else for (const [index, item] of value.items.entries()) result.getAttr("append").call(publicValue(item, getDecodedNumberKind(value.items, index)));
        } catch (error) { publicFailures.set(value, error); throw error; }
        return result;
      }
      if (Array.isArray(value)) {
        converting.add(value);
        try {
          const result = module.getAttr("wire_tuple").call(...value.map((item, index) => publicValue(item, getDecodedNumberKind(value, index))));
          publicValues.set(value, result); return result;
        } finally { converting.delete(value); }
      }
      throw new TypeError("The remote public attribute has no prepared native wire ingress.");
    }
    return nativeSessionScalar(runtime, { value, kind });
  }
  return Object.freeze({
    manager(which) {
      current();
      const moniker = module.getAttr("manager").call(Buffer.from(which));
      const params = project(moniker.getAttr("_Moniker__bindParams"));
      return Object.freeze({
        moniker, params,
        check() { current(); return module.getAttr("check_manager").call(moniker); },
        resolved(nodeRecord) {
          current();
          if (!nodeRecord?.kind) throw new TypeError("The manager requires its actual typed node-resolution result.");
          module.getAttr("resolve_manager").call(moniker, nativeSessionScalar(runtime, nodeRecord));
        },
        publish(objectID, reference) {
          const record = receipt(objectID, reference);
          module.getAttr("publish_manager").call(moniker, record);
          return Object.freeze({
            objectID, moniker, record, reference,
            dispatch() {
              current();
              module.getAttr("check_manager").call(moniker);
              return dispatch(record);
            },
          });
        },
      });
    },
    capture(names) {
      current();
      const policy = module.getAttr("new_policy").call();
      for (const name of names) {
        if (!["locationid", "stationid", "structureid"].includes(name)) throw new TypeError("Unknown original inventory session-check field.");
        policy.setItem(Buffer.from(name), context.session.getAttr(name));
      }
      return Object.freeze({
        policy,
        receipt(objectID, reference) {
          const record = receipt(objectID, reference);
          record.getAttr("SetSessionCheck").call(policy);
          // The dispatch callback retains this receipt owner, including its
          // actual public-attribute object, rather than only an N= string.
          const scope = {
            record, reference,
            check() { current(); return module.getAttr("perform_in_context").call(context.module, scope.record); },
            dispatch() {
              scope.check();
              // Capture the original OBJECT per invocation. Its mutable state
              // is serialized only on a real send, after cache/throttle waits;
              // replacing the record's field cannot retarget this invocation.
              const destination = scope.record.getAttr("destination");
              return { cacheIdentity: project(scope.record.getAttr("persistantObjectID")), prepareDestination() {
                return projectNativeNodeAddress(destination);
              } };
            },
          };
          return Object.freeze(scope);
        },
      });
    },
  });
}

module.exports = { createClientInventorySessionChecks };
