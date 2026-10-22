"use strict";

const { nativeSessionScalar } = require("./clientSessionContext");

/** Exact original MachoObjectConnection.PerformSessionCheck on actual native
 * session/expected fields and the real remote object's N= receipt. A bounded
 * check record, never a pretend remote connection/container or synchronous RPC.
 */
function createClientInventorySessionChecks({ runtime, module, context, assertCurrent }) {
  function current() { assertCurrent(); context.assertCurrent(); }
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
          const record = module.getAttr("receipt").call(context.session, policy, Buffer.from(objectID, "utf8"), nativeSessionScalar(runtime, reference.refID));
          // The dispatch callback retains this receipt owner, including its
          // actual public-attribute object, rather than only an N= string.
          const scope = { record, reference, check() { current(); return module.getAttr("perform_in_context").call(context.module, scope.record); } };
          return Object.freeze(scope);
        },
      });
    },
  });
}

module.exports = { createClientInventorySessionChecks };
