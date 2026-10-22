"use strict";

const { nativeSessionScalar } = require("./clientSessionContext");
const { ADDRESS, nodeAddress } = require("./packets");
const { long } = require("./clientMarshal");

/** Exact original MachoObjectConnection.PerformSessionCheck on actual native
 * session/expected fields and the real remote object's N= receipt. A bounded
 * check record, never a pretend remote connection/container or synchronous RPC.
 */
function createClientInventorySessionChecks({ runtime, module, context, assertCurrent }) {
  function current() { assertCurrent(); context.assertCurrent(); }
  function service(value) {
    if (value.kind === "NoneType") return null;
    if (value.kind === "str") return value.scalar;
    if (value.kind === "unicode") return { type: "wstring", value: value.scalar };
    throw new TypeError("The native node service has no prepared wire projection.");
  }
  function callID(value) {
    if (value.kind === "NoneType") return null;
    if (value.kind === "long") return long(value.scalar);
    if (value.kind === "int") return value.scalar;
    throw new TypeError("The native node call ID has no prepared wire projection.");
  }
  return Object.freeze({
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
          current();
          if (typeof objectID !== "string" || !objectID.startsWith("N=")) throw new TypeError("An actual returned inventory object is required.");
          if (reference?.objectID !== objectID || !reference.source || !reference.pair || !reference.refID) throw new TypeError("The actual decoded inventory reference receipt is required.");
          const record = module.getAttr("receipt").call(context.module, policy, Buffer.from(objectID, "utf8"), nativeSessionScalar(runtime, reference.refID));
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
              return { prepareDestination() {
                const state = destination.getAttr("__getstate__").call();
                if (state.getItem(0n).scalar !== ADDRESS.NODE || state.getItem(1n).kind !== "long") throw new TypeError("Only native remote node addresses are prepared for inventory dispatch.");
                return nodeAddress(long(state.getItem(1n).scalar), service(state.getItem(2n)), callID(state.getItem(3n)));
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
