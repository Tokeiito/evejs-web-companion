"use strict";

// core/CcpTime.cpp10-65 and BlueTime.cpp63-102. Actual in-process Win32
// reads; no Date.now/hrtime/Unix conversion, subprocess sampling or engine.
const { buildNativeClock } = require("../../scripts/build-native-clock");
async function loadClientWindowsClockPrimitives(options) {
  const identity = await buildNativeClock(options), native = require(identity.target);
  const owner = native.create(); // Closure keeps native owner alive even for extracted methods.
  const signed = value => BigInt.asIntN(64, value);
  if (native.frequency() === 0n) throw new Error("Windows performance-counter frequency is unavailable.");
  return Object.freeze({
    highRes: () => signed(native.timestamp(owner)),
    reliable: () => signed(native.ticks() * 10000n),
    highResUnitsPerSecond: () => signed(native.frequency()),
    utcNow: () => signed(native.utc()),
    // [kernel,user] actual signed64 CPU counters,100ns units. Closures retain
    // their real native owner even when extracted; native checks owner thread.
    threadCPU: () => native.threadCPU(owner),
    processCPU: () => native.processCPU(owner),
    identity: Object.freeze(identity),
  });
}
module.exports = { loadClientWindowsClockPrimitives };
