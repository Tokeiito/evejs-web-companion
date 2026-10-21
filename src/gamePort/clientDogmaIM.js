"use strict";

// ClientDogmaInstanceManager's REGULAR controller lifetime only. Original
// clientDogmaIM.Run/GetDogmaLocation/ProcessSessionChange/OnSessionReset,
// cdxclientimlifecycleagent1 and cdximnamedlockagent1. No controller ctor,
// Prime tail, activation, service-manager startup or graph admission is supplied.
const { types: { isPromise } } = require("node:util");
const { createClientDogmaLoadScheduling } = require("./clientDogmaLoadScheduling");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const { clientDogmaItemID } = require("./clientDogmaItem");

const namespaces = new WeakMap();
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);
const valueError = message => Object.assign(new Error(message), { name: "ValueError" });
const field = (object, name) => {
  if (object === null || object === undefined || !(name in Object(object))) {
    throw Object.assign(new Error(`Object has no ${name} attribute.`), { name: "AttributeError" });
  }
  return object[name];
};

/** One emulated CLIENT/pilot namespace, shared by its IM instances. Fixed
 * original string-literal lock identities map to these private names; unrelated
 * pilots must create separate namespaces. This is NOT a global BFF mutex.
 * Scheduling is exposed for explicit task-entry/inheritance boundaries.
 * Native clock/lock registry diagnostics, cancellation and tasklet killing are
 * outside this balanced-IM named-lock model; no wait is converted to success. */
function createClientDogmaIMNamespace() {
  const scheduling = createClientDogmaLoadScheduling(), locks = new Map();
  function entry(name) {
    if (!locks.has(name)) locks.set(name, { semaphore: null, users: 0 });
    return locks.get(name);
  }
  function acquire(semaphore) {
    if (semaphore.count === 0) {
      semaphore.nWaiting += 1;
      return new Promise(resolve => semaphore.waiting.push(resolve)).then(() => {
        semaphore.nWaiting -= 1;
        return acquire(semaphore); // A wake does not reserve the free count.
      });
    }
    semaphore.count -= 1;
    semaphore.threads.push(scheduling.currentTask());
  }
  function lock(name) {
    const item = entry(name);
    if (item.semaphore === null) item.semaphore = { count: 1, nWaiting: 0, threads: [], waiting: [] };
    item.users += 1; // uthread.Lock increments BEFORE potentially blocking.
    return acquire(item.semaphore);
  }
  function unlock(name) {
    // Native UnLock rereads the CURRENT registry entry, rather than retaining
    // the entry/lock object captured at acquisition.
    const item = entry(name), semaphore = item.semaphore;
    if (semaphore === null) throw Object.assign(new Error("None has no release attribute."), { name: "AttributeError" });
    semaphore.count += 1;
    const index = semaphore.threads.indexOf(scheduling.currentTask());
    if (index < 0) throw valueError("list.remove(x): x not in list");
    semaphore.threads.splice(index, 1);
    // strict=False Semaphore, preference0: release continues synchronously;
    // signalled waiters resume on their later JS microtask and recheck count.
    const wake = Math.min(semaphore.count, semaphore.waiting.length);
    for (let index = 0; index < wake; ++index) semaphore.waiting.shift()();
    item.users -= 1;
    if (item.users === 0) locks.delete(name);
  }
  const namespace = Object.freeze({ scheduling });
  namespaces.set(namespace, { lock, unlock });
  return namespace;
}

function sameIdentity(left, right) {
  if (left === null || right === null) return left === right;
  // A tuple item key never equals the scalar actor ID. No tuple admission or
  // generic Python rich-comparison policy is manufactured by this observer.
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) throw notReady("numeric IM location identity");
  return clientDogmaItemID(left) === clientDogmaItemID(right);
}

function dictionary(change) {
  if (!(change instanceof Map)) throw notReady("normalized IM change dictionary");
  return change;
}

function synchronous(result, part) {
  if (isPromise(result)) throw notReady(`synchronous ${part}`);
  return result;
}

/** Required ready adapters:
 * - serviceRun(manager,...args): actual synchronous Service.Run phase, whose
 *   return is ignored; this module does not fake a started ServiceManager.
 * - constructLocation(manager,charBrain): actual factory, optionally an actual
 *   Promise for its blocking work. Never a default partial construction world.
 * - isReadyLocation(value): mandatory SYNCHRONOUS, strict-true type/readiness
 *   authority for that factory's actually supported controller. This is an
 *   EMULATOR boundary absent from Python, not a duck-shape/full-graph proof.
 * - session(): actual current session; identityForLog(controller) and
 *   logging.LogInfo(message,identity): real synchronous logging adapters.
 * Controller methods with ignored native returns stay synchronous adapters;
 * actual Promise results reject readiness, other ignored payloads are untouched.
 * There are no explicit `.then` probes on arbitrary payloads. The async return
 * path necessarily uses JS Promise adoption: the readiness authority must
 * recognize nonthenable controller classes for that domain. This is not generic
 * Python-object return equivalence or native Stackless scheduling parity.
 */
function createClientDogmaIM({ namespace, constructLocation, isReadyLocation, session, serviceRun, identityForLog, logging }) {
  const locks = namespaces.get(namespace);
  if (!locks) throw notReady("per-client IM named-lock namespace");
  for (const [name, provider] of Object.entries({ constructLocation, isReadyLocation, session, serviceRun, identityForLog })) {
    if (typeof provider !== "function") throw notReady(name);
  }
  if (!logging || typeof logging.LogInfo !== "function") throw notReady("manager LogInfo");
  const scheduling = namespace.scheduling;
  let ran = false, regular, fitting;
  const requireRun = () => { if (!ran) throw notReady("IM Run phase"); };

  function Run(...args) {
    // Actual async adapters cannot make an incomplete Service.Run look done.
    // Failure leaves the previous/unrun slots; non-Promise results are ignored.
    synchronous(serviceRun(manager, ...args), "Service.Run");
    regular = null;
    fitting = null;
    ran = true;
  }

  function publish(candidate) {
    if (candidate === null || typeof candidate !== "object" || isPromise(candidate) ||
      isReadyLocation(candidate) !== true) throw notReady("supported completed client dogma controller");
    regular = candidate;
    // Publication precedes method/identity/log evaluation. A log/readiness of
    // the log adapter failure retains this already-created controller.
    const logInfo = logging.LogInfo;
    const identity = synchronous(identityForLog(regular), "controller log identity");
    synchronous(Reflect.apply(logInfo, logging, ["Created client dogmaLocation", identity]), "manager LogInfo");
  }

  function GetDogmaLocation(charBrain = null, ..._ignored) {
    requireRun();
    return scheduling.run(() => {
      const acquired = locks.lock("GetDogmaLocation");
      const body = () => {
        let work;
        try {
          if (regular === null) {
            const candidate = constructLocation(manager, charBrain);
            if (isPromise(candidate)) work = candidate.then(publish);
            else publish(candidate);
          }
        } catch (error) {
          locks.unlock("GetDogmaLocation");
          throw error;
        }
        if (isPromise(work)) return work.then(() => {
          locks.unlock("GetDogmaLocation");
          return regular;
        }, error => {
          locks.unlock("GetDogmaLocation");
          throw error;
        });
        locks.unlock("GetDogmaLocation");
        return regular;
      };
      return isPromise(acquired) ? acquired.then(body) : body();
    });
  }

  function ProcessSessionChange(_isRemote, _changedSession, change) {
    requireRun();
    if (regular === null) return;
    const changes = dictionary(change);
    if (changes.has("stationid") || changes.has("solarsystemid")) {
      synchronous(regular.UpdateRemoteDogmaLocation(), "UpdateRemoteDogmaLocation");
    }
  }

  function OnSessionReset() {
    requireRun();
    regular = null; // No regular-controller UnregisterNotify in the source.
    if (fitting !== null) throw notReady("fitting-controller notification retirement");
  }

  function GodmaItemChanged(item, change, location) {
    requireRun();
    if (sameIdentity(field(item, "itemID"), field(session(), "charid"))) return;
    if (regular === null) return;
    const shipID = synchronous(regular.GetCurrentShipID(), "GetCurrentShipID");
    if (sameIdentity(field(item, "locationID"), shipID)) synchronous(regular.OnItemChange(item, change, location), "OnItemChange");
    else {
      const changes = dictionary(change);
      if (changes.has(3n)) throw notReady("normalized numeric IM change keys");
      const oldLocation = changes.has(3) ? changes.get(3) : null;
      // Preserve absent-old None == current-ship None: this CAN forward.
      if (sameIdentity(oldLocation, shipID)) synchronous(regular.OnItemChange(item, change, location), "OnItemChange");
    }
  }

  function GetCapacityForItem(itemID, attributeID) {
    requireRun();
    if (regular === null) return;
    const loaded = regular.IsItemLoaded(itemID);
    if (typeof loaded !== "boolean") throw notReady("synchronous IsItemLoaded predicate");
    if (!loaded) return;
    return synchronous(regular.GetAttributeValue(itemID, attributeID), "GetAttributeValue");
  }

  const manager = {
    Run, GetDogmaLocation, ProcessSessionChange, OnSessionReset, GodmaItemChanged, GetCapacityForItem,
    GetFittingDogmaLocation() { requireRun(); throw notReady("separate fitting-controller construction"); },
    get dogmaLocation() { requireRun(); return regular; },
    get fittingDogmaLocation() { requireRun(); return fitting; },
    scheduling,
  };
  return manager;
}

module.exports = { createClientDogmaIMNamespace, createClientDogmaIM };
