"use strict";

// BlueTime.cpp113-223 / BlueOS.cpp1061-1107,1373-1378. Installed3396210:
// SuperTime.Get0x1802bb5e0, SetTime0x18019df10, GetActualTime0x18019e020.
// cdxcoreserviceclockagent1. This is NOT BlueOS initialization or a frame clock.
// Adapted from CCP Games' MIT-licensed Blue clock; see clientClock-LICENSE.txt.
const { types: { isPromise } } = require("node:util");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const MIN_TIME = -(1n << 63n), MAX_TIME = (1n << 63n) - 1n;
const MIN_DOUBLE_TIME = -9223372036854775808, MAX_DOUBLE_TIME = 9223372036854775808;
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);

function time(value, part) {
  if (typeof value !== "bigint" || value < MIN_TIME || value > MAX_TIME) throw notReady(`signed64 ${part}`);
  return value;
}
function add(left, right) { return time(left + right, "clock addition"); }
function subtract(left, right) { return time(left - right, "clock difference"); }
function finite(value) {
  if (!Number.isFinite(value)) throw notReady("finite native clock arithmetic");
  return value;
}
function integralTime(value) {
  // C++ conversion truncates toward zero. Out-of-range/NaN conversion is
  // outside the supported C++ domain, not a guessed clamp or modulo result.
  if (!Number.isFinite(value) || value < MIN_DOUBLE_TIME || value >= MAX_DOUBLE_TIME) throw notReady("representable double-to-signed64 clock conversion");
  return BigInt(Math.trunc(value));
}
// std::min/max retain the first operand on equality (including signed zero).
const minimum = (first, second) => second < first ? second : first;
const maximum = (first, second) => first < second ? second : first;

/** Required native, synchronous samplers, all returning signed64 BigInts:
 * highRes(): CcpGetTimestamp's QPC failure/backward clamp then signed cast;
 * reliable(): GetTickCount64()*10000 unsigned multiplication then signed cast;
 * highResUnitsPerSecond(): QueryPerformanceFrequency (zero on API failure);
 * utcNow(): GetSystemTimeAsFileTime, signed FILETIME/100ns UTC epoch.
 * The native provider owns CcpGetTimestamp's shared last-counter state.
 *
 * This component supports one synchronous JS owner, without reentrant/custom
 * providers, engine mutex/thread equivalence or cross-process clock identity.
 * No Date.now/hrtime substitution, implicit timer sampling or cached
 * GetWallclockTime is supplied. Native inputs/differences must fit signed64;
 * double operations must remain finite and integer casts representable.
 */
function createClientBlueWallclock({ primitives } = {}) {
  if (!primitives || typeof primitives !== "object") throw notReady("native Windows clock primitives");
  function sample(name) {
    const method = primitives[name];
    if (typeof method !== "function") throw notReady(`native ${name} clock sampler`);
    const result = Reflect.apply(method, primitives, []);
    if (isPromise(result)) throw notReady(`synchronous ${name} clock sampler`);
    return time(result, name);
  }

  // SuperTime construction order: high resolution, reliable, frequency.
  let highResBase = sample("highRes"), reliableBase = sample("reliable");
  let lastHighRes = highResBase, lastReliable = reliableBase;
  let lastTime = reliableBase;
  let reliablePerHighRes = finite(10000000 / Number(sample("highResUnitsPerSecond")));
  let knownError = 0, remainder = 0;
  let utcAdjustment = 0n, active = false;

  function wallclock() {
    const highRes = sample("highRes"), reliable = sample("reliable");
    const deltaHighRes = Number(subtract(highRes, lastHighRes));
    let newTime = lastTime;
    if (deltaHighRes > 0) {
      let deltaTime = finite(deltaHighRes * reliablePerHighRes + remainder);
      let adjustment = 0;
      if (knownError > 50000) {
        const factor = minimum(1, (knownError - 50000) / 10000000);
        adjustment = minimum(knownError, finite(deltaTime * factor));
      } else if (knownError < -20000) {
        const factor = maximum(-1, (knownError + 20000) / 10000000);
        adjustment = maximum(knownError, finite(deltaTime * factor));
      }
      knownError = finite(knownError - adjustment);
      deltaTime = finite(deltaTime - adjustment);
      const integral = integralTime(deltaTime);
      remainder = finite(deltaTime - Number(integral));
      newTime = add(newTime, integral);
    }
    if (reliable !== lastReliable) {
      knownError = finite(0.95 * knownError + 0.05 * Number(subtract(newTime, reliable)));
    }
    if (Number(subtract(reliable, reliableBase)) > 10000000) {
      const deltaHigh = Number(subtract(highRes, highResBase));
      const deltaReliable = Number(subtract(reliable, reliableBase));
      reliablePerHighRes = finite(0.95 * reliablePerHighRes + 0.05 * (deltaReliable / deltaHigh));
      highResBase = highRes;
      reliableBase = reliable;
    }
    lastHighRes = highRes;
    lastReliable = reliable;
    lastTime = newTime;
    return newTime;
  }

  function enter(work) {
    if (active) throw notReady("nonreentrant single-owner native wallclock");
    active = true;
    try { return work(); }
    finally { active = false; }
  }
  function rebaseWallclock(value = 0n) {
    return enter(() => {
      let requested = time(value, "wallclock rebase");
      if (requested === 0n) {
        const initial = sample("utcNow");
        do { requested = sample("utcNow"); } while (requested === initial);
      }
      utcAdjustment = subtract(requested, wallclock());
      // Only SetTime's UTC-offset portion. Simulation adjustment, cached
      // frame time/Rebase callback and synchronization sleepers are separate.
      return null;
    });
  }

  rebaseWallclock();
  return Object.freeze({
    getWallclockTimeNow: () => enter(() => add(utcAdjustment, wallclock())),
    rebaseWallclock,
  });
}

module.exports = { createClientBlueWallclock };
