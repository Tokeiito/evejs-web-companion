"use strict";

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
        receipt(objectID) {
          current();
          if (typeof objectID !== "string" || !objectID.startsWith("N=")) throw new TypeError("An actual returned inventory object is required.");
          const record = module.getAttr("receipt").call(context.session, policy, Buffer.from(objectID, "utf8"));
          return Object.freeze({ record, check() { current(); return module.getAttr("perform_in_context").call(context.module, record); } });
        },
      });
    },
  });
}

module.exports = { createClientInventorySessionChecks };
