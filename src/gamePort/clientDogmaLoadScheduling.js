"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");

// Base.LoadItem / uthread.Semaphore95-215, CriticalSection218-261 and
// locks.LockInheritanceMap. Original execution: cdxloadwrapperagent1,
// especially critical.log and ACTUAL Stackless channels2.log. These are
// logical JS tasks, not a Stackless scheduler, timer/pool or lock registry.
const runtimeError = message => Object.assign(new Error(message), { name: "RuntimeError" });

/** One explicit scheduling domain. AsyncLocalStorage propagates across JS
 * awaits AND timer callbacks; callers must use runIndependent at actual new
 * task/pool/notice entrypoints, or runInherited only for explicit inheritance.
 * Merely scheduling a JS callback does not establish native lock inheritance.
 * No cancellation, tasklet killing, timeout, priority or implicit retirement
 * success is supplied here. The loader owns its live critical/channel maps. */
function createClientDogmaLoadScheduling() {
  const scopes = new AsyncLocalStorage();

  function current() {
    const task = scopes.getStore();
    if (!task) {
      const error = new Error("A native load operation requires an explicit logical task scope.");
      error.name = "ClientDogmaTaskScopeNotReadyError";
      throw error;
    }
    return task;
  }

  function workFunction(work) {
    if (typeof work !== "function") throw new TypeError("A logical task function is required.");
    return work;
  }

  function root() { return { ancestors: new Set() }; }

  function run(work) {
    workFunction(work);
    return scopes.getStore() ? work() : scopes.run(root(), work);
  }

  function runIndependent(work) {
    return scopes.run(root(), workFunction(work));
  }

  function runInherited(work) {
    workFunction(work);
    const parent = current();
    const ancestors = new Set(parent.ancestors);
    ancestors.add(parent);
    return scopes.run({ ancestors }, work);
  }

  function createCritical(name) {
    let count = 1, holder = null, reentrantRefs = 0, nWaiting = 0;
    const waiting = [];
    const owns = task => task === holder || task.ancestors.has(holder);

    function acquireFor(task) {
      if (count <= 0 && owns(task)) {
        reentrantRefs += 1;
        return;
      }
      if (count > 0) {
        count -= 1;
        holder = task;
        return;
      }
      // Semaphore.acquire counts a waiter until receive resumes, then loops
      // against CURRENT count. A wake does not reserve ownership. Keep that
      // distinction if another synchronous acquisition takes the free count.
      nWaiting += 1;
      const ready = new Promise(resolve => waiting.push(resolve));
      return ready.then(() => {
        nWaiting -= 1;
        return acquireFor(task);
      });
    }

    function acquire() { return acquireFor(current()); }

    function release() {
      const task = current();
      if (reentrantRefs) {
        if (!owns(task)) throw runtimeError("wrong tasklet releasing reentrant CriticalSection");
        reentrantRefs -= 1;
        return;
      }
      // Inherited ownership permits only the reentrant-ref branch. The final
      // strict Semaphore.release requires the ACTUAL acquiring task, not an
      // inherited child and not a per-acquisition fabricated token.
      if (task !== holder) throw runtimeError("wrong tasklet releasing strict semaphore");
      count += 1;
      holder = null;
      // The semaphore's internal channel has preference0: release remains
      // synchronous. nWaiting still includes a signalled but unresumed task,
      // so Base.LeaveCriticalSection must not delete this critical yet.
      const wake = Math.min(count, waiting.length);
      for (let index = 0; index < wake; index += 1) waiting.shift()();
    }

    return Object.freeze({
      name,
      acquire,
      release,
      IsCool: () => count === 1 && nWaiting === 0,
    });
  }

  function createChannel() {
    const receivers = [], senders = [];
    function receive(work) {
      current();
      if (work !== undefined) workFunction(work);
      if (senders.length) {
        // Receiver-preferred rendezvous: the current receiver continues; the
        // waiting sender's Promise continuation runs on its later JS turn.
        senders.shift().resume();
        return work === undefined ? null : work(null);
      }
      const delivery = new Promise(resolve => receivers.push({
        head: Object.freeze({ direction: "receive" }), resume: resolve,
      }));
      // Register this continuation in the RECEIVER's logical scope. Receiver
      // errors belong to its returned work; they do not reject a sender.
      return work === undefined ? delivery : delivery.then(work);
    }

    function send(value) {
      current();
      if (value !== null) throw new TypeError("The bounded native load channel sends only None (null).");
      if (receivers.length) {
        receivers.shift().resume(null);
        // Awaiting this fulfilled Promise yields one receiver microtask turn,
        // matching the existing godmaPrimeChannel boundary. Do NOT adopt or
        // await its entire async work, and do not catch its errors as ours.
        return Promise.resolve();
      }
      return new Promise(resolve => senders.push({
        head: Object.freeze({ direction: "send" }), resume: resolve,
      }));
    }

    return Object.freeze({
      // Native queue is a tasklet head or None, not an array/count. This
      // read-only head is only a truthiness/direction seam, not a tasklet.
      get queue() { return receivers[0]?.head ?? senders[0]?.head ?? null; },
      receive,
      send,
    });
  }

  // Named uthread.Lock semaphores need the actual task identity too: unlike
  // CriticalSection they never grant reentry to this task or its descendants.
  return Object.freeze({ run, runIndependent, runInherited, currentTask: current, createCritical, createChannel });
}

module.exports = { createClientDogmaLoadScheduling };
