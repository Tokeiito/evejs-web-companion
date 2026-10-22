"use strict";

const { nativeSessionScalar } = require("./clientSessionContext");
const { createClientLocalizationSettings } = require("./clientLocalizationSettings");

async function createClientSessionOwners({ provider, session, clientRoot }) {
  const preferences = await provider.createOwner();
  try {
    const localizationSettings = await createClientLocalizationSettings({ provider, preferences, clientRoot });
    const sessionContext = await createClientEffectiveSessionContext({ provider, session, preferences, boot: localizationSettings.boot });
    return Object.freeze({ preferences, localizationSettings, sessionContext });
  } catch (error) { preferences.dispose(); throw error; }
}

/** Original default/comparison/dependent-field phase, subscribed BEFORE login.
 * Raw transport records stay separate. This is not CoreSession construction,
 * __ChangeAttribute clocks/indexes/history, service broadcasts or Get readiness.
 * Original Masquerade/UnMask stays within one synchronous native callback entry.
 */
async function createClientEffectiveSessionContext({ provider, session, preferences, boot }) {
  if (!provider || typeof provider.ready !== "function" || !preferences?.handler || !boot || !session || typeof session.onSessionAttributeUpdate !== "function" || typeof session.sessionLifecycle !== "function" || typeof session.onClose !== "function") throw new TypeError("Actual runtime, transport, preferences and installed boot are required.");
  const before = session.sessionLifecycle();
  if (before.closed || before.loggedIn || before.revision !== 0) throw new Error("Effective session fields must be bound before any login ingress.");
  let runtime = null, module = null, failure = null, retired = false, revision = 0;
  const queued = [];
  function refresh() {
    if (!module) return;
    if (retired || session.sessionLifecycle().closed) { retired = true; module.getAttr("retire").call(); }
    else module.getAttr("restore_current").call();
  }
  function apply(batch) {
    if (failure) throw failure;
    if (retired || session.sessionLifecycle().closed) throw new Error("Effective session ingress cannot republish a retired owner.");
    if (batch.revision <= revision || !Array.isArray(batch.records)) throw new Error("Effective session ingress is missing its ordered typed batch.");
    // machoNet.ConnectToServer only consumes session_init.userid for transport
    // association. SessionChangeGPCS applies actual initial/change packets.
    if (batch.source !== "login") {
      if (batch.source !== "initial" && batch.source !== "change") throw new Error("Unsupported effective session ingress phase.");
      const changes = module.getAttr("fields").getAttr("__dict__").getAttr("__class__").call();
      for (const [name, record] of batch.records) {
        const value = nativeSessionScalar(runtime, record);
        changes.setItem(Buffer.from(name), batch.source === "change"
          ? module.getAttr("wire_pair").call(nativeSessionScalar(runtime, record.old), value) : value);
      }
      module.getAttr("receive").call(changes, batch.source === "initial");
    }
    revision = batch.revision;
  }
  function changed(batch) {
    if (retired || session.sessionLifecycle().closed) return;
    if (!module) { queued.push(batch); return; }
    try { apply(batch); }
    catch (error) { failure = error; session.close(); }
  }
  const forgetChanges = session.onSessionAttributeUpdate(changed);
  const forgetClose = session.onClose(() => { retired = true; try { refresh(); } finally { forgetChanges(); } });
  try {
    runtime = await provider.ready();
    module = runtime.values.global("_create_effective_session_context").call(preferences.handler, boot);
    for (const batch of queued.splice(0)) apply(batch);
    refresh();
    if (retired) throw new Error("The transport closed during native session field preparation.");
    return Object.freeze({
      module, localstorage: module.getAttr("localstorage"), builtins: module.getAttr("builtins"),
      session: module.getAttr("session"), fields: module.getAttr("fields"), transport: session,
      preferences, boot, identity: runtime.identity,
      lifecycle: () => Object.freeze({ revision, retired, failed: failure !== null }),
      assertCurrent() { if (failure) throw failure; module.getAttr("assert_entry").call(); },
      refresh,
      retire() { retired = true; refresh(); forgetChanges(); forgetClose(); },
    });
  } catch (error) { retired = true; refresh(); forgetChanges(); forgetClose(); throw error; }
}

module.exports = { createClientEffectiveSessionContext, createClientSessionOwners };
