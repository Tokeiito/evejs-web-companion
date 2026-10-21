"use strict";

const { attributePythonType } = require("./clientDogmaArithmetic");
const fields = Object.freeze(["charid", "userid", "role", "languageID"]);

function nativeSessionScalar(runtime, record) {
  const { value } = record, values = runtime.values;
  if (value === null) return values.none();
  if (typeof value === "boolean") return values.bool(value);
  if (Buffer.isBuffer(value)) return values.bytes(value);
  // Bare JS strings are the codec's actual byte string table values.
  if (typeof value === "string") return values.bytes(Buffer.from(value, "utf8"));
  if (value?.type === "wstring" && typeof value.value === "string") return values.unicode(value.value);
  const type = attributePythonType(record);
  if (type === "int") return values.int(value);
  if (type === "long") {
    if (typeof value !== "bigint" && !Number.isSafeInteger(value)) throw new Error("Original session long has no exact wire integer value.");
    return values.long(typeof value === "bigint" ? value : BigInt(value));
  }
  if (type === "float") return values.float(value);
  throw new Error("Current session field has no supported original wire scalar class.");
}

/** Real original Sissy/localstorage over the current transport's typed fields.
 * This is a bounded raw input capability, not CoreSession construction,
 * ComputeNotifySets/equal-update retention, defaults/dependent fields, remote
 * service notifications or full native session/Get readiness. Missing fields
 * remain absent. Original native owner entries; shared tasklet-local
 * storage/scheduling requires its own real entry-context producer first.
 * Consumers must call assertCurrent() before entering source code: a failed
 * ingress conversion retains its exception and prior native prefix, not a
 * silently ready replacement session. Direct NativeValues are low-level refs.
 */
async function createClientSessionContext({ provider, session }) {
  if (!provider || typeof provider.ready !== "function" || !session || typeof session.readSessionAttribute !== "function" || typeof session.sessionLifecycle !== "function" || typeof session.onSessionAttributeUpdate !== "function" || typeof session.onClose !== "function") throw new TypeError("An installed runtime and actual typed transport session are required.");
  let module = null, runtime = null, retired = false, failure = null;
  function scalar(record) {
    return nativeSessionScalar(runtime, record);
  }
  function refresh() {
    if (!module) return;
    if (retired || session.sessionLifecycle().closed) { retired = true; module.getAttr("retire").call(); return; }
    const dictionary = module.getAttr("fields").getAttr("__dict__").getAttr("__class__").call();
    for (const name of fields) {
      const record = session.readSessionAttribute(name);
      if (record.present) dictionary.setItem(Buffer.from(name), scalar(record));
    }
    module.getAttr("publish").call(dictionary);
    failure = null;
  }
  function changed() { try { refresh(); } catch (error) { failure = error; } }
  const forgetChanges = session.onSessionAttributeUpdate(changed);
  const forgetClose = session.onClose(() => { retired = true; changed(); forgetChanges(); });
  try {
    runtime = await provider.ready();
    module = runtime.values.global("_create_session_context").call();
    refresh();
    return Object.freeze({
      module, localstorage: module.getAttr("localstorage"), builtins: module.getAttr("builtins"),
      session: module.getAttr("session"), fields: module.getAttr("fields"), transport: session,
      identity: runtime.identity,
      assertCurrent() { if (failure) throw failure; module.getAttr("assert_entry").call(); },
      refresh,
      retire() { retired = true; refresh(); forgetChanges(); forgetClose(); },
    });
  } catch (error) { forgetChanges(); forgetClose(); throw error; }
}

module.exports = { createClientSessionContext, nativeSessionScalar };
