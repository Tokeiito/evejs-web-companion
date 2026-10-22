"use strict";

const { long } = require("./clientMarshal");
const { projectNativeNodeAddress } = require("./clientMachoAddress");
const dict = entries => ({ type: "dict", entries });

function referenceID(value) {
  if (value.kind === "long") return long(value.scalar);
  if (value.kind === "int") return value.scalar;
  throw new TypeError("A native released reference requires its original integer class.");
}
function objectID(value) {
  if (value.kind === "str") return value.scalar;
  if (value.kind === "unicode") return { type: "wstring", value: value.scalar };
  throw new TypeError("A native released object requires its original string class.");
}
function pairs(value) {
  const result = [];
  for (let index = 0, count = value.getAttr("__len__").call().scalar; index < count; index++) {
    const pair = value.getItem(BigInt(index));
    result.push([objectID(pair.getItem(0n)), referenceID(pair.getItem(1n))]);
  }
  return result;
}

/** ObjectCallGPCS35-65: actual wallclock wait before EACH detached batch.
 * Native code owns queue/registry/weak references/grouping/order/maxima. This
 * managed timer and notification bridge are not a native uthread/RPC service.
 */
function startClientRemoteObjectReleases({ module, session }) {
  let timer = null, stopped = false, failure = null, iterations = 0, notifications = 0;
  let forgetClose = () => {};
  function stop() {
    stopped = true;
    if (timer !== null) { session.timers.clearTimeout(timer); timer = null; }
    forgetClose();
  }
  function schedule() {
    timer = session.timers.setTimeout(step, 30000);
    timer?.unref?.();
  }
  function step() {
    timer = null;
    if (stopped || session.closed) return;
    try {
      module.getAttr("assert_entry").call();
      const iterator = module.getAttr("release_calls").call();
      try {
        for (;;) {
          const group = module.getAttr("next_release").call(iterator);
          if (group.kind === "NoneType") break;
          const released = { type: "list", items: pairs(group.getItem(2n)) };
          const minus = dict(pairs(group.getItem(3n).getAttr("items").call()));
          if (session.releaseRemoteObjects(projectNativeNodeAddress(group.getItem(1n)), released, minus)) notifications++;
        }
      } finally { iterator.getAttr("close").call(); }
      iterations++;
    } catch (error) {
      failure = error; stop();
      // A failed original helper task dies; no retry or automatic requeue.
      console.error("[game-port remote releases]", error);
      return;
    }
    if (!stopped) schedule();
  }
  forgetClose = session.onClose(stop);
  schedule();
  return Object.freeze({ stop, lifecycle: () => Object.freeze({ stopped, failed: failure !== null, iterations, notifications }) });
}

module.exports = { startClientRemoteObjectReleases };
