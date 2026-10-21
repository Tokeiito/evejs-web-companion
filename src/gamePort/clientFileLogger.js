"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createClientBlueLogDomain } = require("./clientBlueLogChannel");

/**
 * Explicit companion output policy, not an inferred retail LogServer setup.
 * Each emulated client owns its registry and a real synchronous JSONL outlet.
 * No engine socket/file worker, crash reporter or cross-thread delivery is
 * claimed. The callback contract is CCP core/CcpLog.h LogEchoFunc.
 */
function createClientFileLogger({ directory }) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new TypeError("A native client log directory must be absolute.");
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `client-${randomUUID()}.jsonl`);
  // Prove the outlet can be created before registering it. No fallback logger.
  fs.writeFileSync(filename, "", { flag: "wx" });
  const domain = createClientBlueLogDomain();
  const echo = (channel, severity, userData, message) => {
    // Base64 retains arbitrary Python byte strings, including non-UTF8 output.
    // Human-readable text is only a display alongside those authoritative bytes.
    const cString = bytes => { const end = bytes.indexOf(0); return end < 0 ? bytes : bytes.subarray(0, end); };
    fs.appendFileSync(filename, JSON.stringify({
      severity, userData,
      facility: cString(channel.facility).toString("utf8"),
      object: cString(channel.object).toString("utf8"),
      message: message.toString("utf8"),
      facilityBytes: cString(channel.facility).toString("base64"),
      objectBytes: cString(channel.object).toString("base64"),
      messageBytes: message.toString("base64"),
    }) + "\n");
  };
  // All severities, on this client's JS owner, with normal privilege checks.
  // These are declared companion choices; the registry still controls IsOpen.
  const start = () => domain.registerEcho(echo, 0, false, 0);
  const stop = () => domain.unregisterEcho(echo);
  start();
  return Object.freeze({ domain, filename, start, stop });
}

module.exports = { createClientFileLogger };
