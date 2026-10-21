"use strict";

// Source-derived CCP Blue/core logger; see clientLog-LICENSE.txt.
// Installed3396210: channel constructor0x1802f8a30, Log0x1802f8c70,
// IsOpen0x1802f8e50, register0x1803e5ba0, formatter0x1803e5f00.
// cdxlogchannelnativeagent1 / cdxbluelogchannelagent1-utf8-native.
const { types: { isPromise, isAsyncFunction } } = require("node:util");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const { OverflowError } = require("./clientDogmaErrors");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);

function int32(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") {
    if (value < -2147483648n || value > 2147483647n) throw new OverflowError("signed integer is greater than maximum");
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isInteger(value)) throw new TypeError("A normalized signed32 integer argument is required.");
  if (value < -2147483648 || value > 2147483647) throw new OverflowError("signed integer is greater than maximum");
  return value;
}
function severity(value) {
  const result = int32(value);
  if (result < 0 || result > 3) throw notReady("native logger severity0..3");
  return result;
}
function logType(flag) {
  switch (flag & 255) {
    case 32: return 1;
    case 2: return 2;
    case 4: case 8: return 3;
    default: return 0;
  }
}
function text(value, message = "expected string or unicode object") {
  if (!Buffer.isBuffer(value) && typeof value !== "string") throw new TypeError(message);
  return value;
}
function count(args, minimum, maximum) {
  if (args.length < minimum || args.length > maximum) throw new TypeError("Invalid native channel argument count.");
}
function cString(bytes, maximum = bytes.length) {
  const zero = bytes.indexOf(0);
  return bytes.subarray(0, Math.min(maximum, zero < 0 ? bytes.length : zero));
}
function unicodeUTF8(value) {
  // Actual installed Python2 UCS2 strict encoder: valid surrogate pairs
  // combine; an unmatched surrogate encodes its OWN three bytes, unlike
  // Buffer.from(string)'s replacement. No defaultencoding/string coercion.
  const bytes = [];
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + next - 0xdc00;
        i++;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Buffer.from(bytes);
}

/** One emulated client's REAL callback registry. No default sink: callers
 * register actual synchronous output callbacks, with signature
 * (channel, severity, unsignedUserData, messageBytes). The channel retains
 * original Buffer facility/object objects as readonly properties; sinks must
 * treat those names as C strings (first NUL), and must not mutate buffers.
 * Messages are independent formatted bytes, C-NUL terminated semantically,
 * capped at65534 output bytes, possibly inside a UTF8 sequence.
 *
 * All execution belongs to the JS main owner: native threadSafe metadata is
 * retained, but arbitrary native thread identities are not emulated. Registry
 * mutation/privilege changes during dispatch and nested open Log dispatch
 * reject BEFORE state mutation, rather than simulating C++ vector invalidation
 * or callback reentry. Callbacks must be synchronous and nonmutating; errors
 * propagate after prior counter/callback effects, without rollback. No native
 * CRT/OOM/crash reporter, arbitrary Python coercion/subclasses or host startup
 * readiness is claimed. Buffers stand for byte str, strings for narrow Unicode;
 * integer arguments admit only normalized signed32 Number/BigInt/bool inputs.
 * Optional JS undefined means omission; null never stands for a missing arg.
 */
function createClientBlueLogDomain() {
  const echoes = [[], [], [], []], privileged = [false, false, false, false];
  const counters = new Uint32Array(4);
  const flags = { INFO: 1, NOTICE: 32, WARN: 2, ERR: 4 };
  let lastError = Buffer.alloc(0), dispatching = false;

  function idle() {
    if (dispatching) throw notReady("nonmutating, nonreentrant logger dispatch");
  }
  function unregister(callback) {
    for (const vector of echoes) {
      const index = vector.findIndex(entry => entry.callback === callback);
      if (index >= 0) {
        vector[index] = vector[vector.length - 1];
        vector.pop();
      }
    }
  }
  function emit(channel, type, userData, bytes) {
    idle();
    counters[type] = (counters[type] + 1) >>> 0;
    const message = Buffer.from(cString(bytes, 65534));
    dispatching = true;
    try {
      for (const entry of echoes[type]) {
        // Every supported invocation is on the owning main JS thread.
        if (entry.privilege === 0 && privileged[type]) continue;
        const result = Reflect.apply(entry.callback, undefined, [channel, type, userData, message]);
        if (isPromise(result)) throw notReady("synchronous logger echo callback");
      }
      // Native last-error retention occurs AFTER all normal echo returns.
      if (type === 3) lastError = Buffer.from(message.subarray(0, 255));
    } finally { dispatching = false; }
  }

  class Channel {
    constructor(facility, object) {
      if (!Buffer.isBuffer(facility) || !Buffer.isBuffer(object)) throw new TypeError("LogChannel requires two byte-string Buffers.");
      Object.defineProperties(this, {
        facility: { value: facility, enumerable: true },
        object: { value: object, enumerable: true },
        channelOpen: { value: 1, enumerable: true },
      });
    }
    IsOpen(...args) {
      count(args, 0, 1);
      const flag = args.length && args[0] !== undefined ? int32(args[0]) : -1;
      return echoes[logType(flag)].length && this.channelOpen ? 1 : 0;
    }
    Log(...args) {
      count(args, 1, 3);
      const flag = args.length > 1 && args[1] !== undefined ? int32(args[1]) : 1;
      if (args.length > 2 && args[2] !== undefined) int32(args[2]); // Parsed, unused.
      const value = text(args[0]), type = logType(flag);
      if (!echoes[type].length || !this.channelOpen) return null;
      idle(); // Before conversion/counters for unsupported nested dispatch.
      const bytes = typeof value === "string" ? unicodeUTF8(value) : value;
      emit(this, type, flag >>> 0, bytes);
      return null;
    }
    LogCounter(...args) {
      count(args, 1, 1);
      const value = text(args[0], "expected string or unicode"), method = this.Log;
      if (typeof method !== "function") throw new TypeError("Log is not callable.");
      return Reflect.apply(method, this, [value, 1]);
    }
  }
  Object.defineProperty(Channel.prototype, "flags", { value: flags });

  return Object.freeze({
    flags,
    registerEcho(callback, threshold = 0, isThreadSafe = false, privilege = 1) {
      idle();
      if (typeof callback !== "function") throw new TypeError("A logger echo callback is required.");
      if (isAsyncFunction(callback)) throw notReady("synchronous logger echo callback");
      const first = int32(threshold) >>> 0, access = int32(privilege);
      if (typeof isThreadSafe !== "boolean") throw new TypeError("isThreadSafe must be boolean.");
      unregister(callback);
      for (let type = first; type < 4; type++) echoes[type].push({ callback, privilege: access, isThreadSafe });
      return null;
    },
    unregisterEcho(callback) {
      idle();
      if (typeof callback !== "function") throw new TypeError("A logger echo callback is required.");
      unregister(callback);
      return null;
    },
    setPrivilegedOnly(type, value) {
      idle();
      const selected = severity(type);
      if (typeof value !== "boolean") throw new TypeError("bool required");
      const previous = privileged[selected];
      privileged[selected] = value;
      return previous;
    },
    createChannel(facility, object) { return new Channel(facility, object); },
    getCounter(type) { return counters[severity(type)]; },
    getLastError() { return Buffer.from(lastError); },
  });
}

module.exports = { createClientBlueLogDomain };
