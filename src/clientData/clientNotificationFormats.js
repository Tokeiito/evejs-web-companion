"use strict";

// ── How the retail client words each kind of notification, read by running its code ──
//
// The client formats a notification by the formatter its type has, else by
// notificationUtil's table of a subject's and a body's label for each type
// (notificationSvc.py FormatNotifications). Both are its code, not its data.
// So the code is what answers: the modules are taken out of the client's code
// archive and run in the client's own python27.dll, on the player's own disk,
// when the formats are first asked for (scripts/client-notification-formats.py).
// Nothing of the client is copied into this repository, and nothing is kept on
// disk.
//
// This needs a 64-bit Python 3 on the machine to host the client's Python
// (EVEJS_PYTHON, "python" when unset). Without one, or without a client, the
// formats are not available and are null; nothing here throws for that.

const childProcess = require("node:child_process");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "client-notification-formats.py");
const RUN_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Runs the script and answers what it printed. */
function runFormats({ python, binFolder, archive, timeoutMs = RUN_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      python,
      [SCRIPT, binFolder, archive],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const said = String(stderr || "").trim().split(/\r?\n/).pop() || error.message;
          reject(new Error(`The client's notification formats could not be read: ${said}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** What was printed, as {table, formatters, groups}; anything else is not the formats. The groups are null where none were printed. */
function formatsOf(printed) {
  const read = JSON.parse(printed);
  const isTable = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (!isTable(read) || !isTable(read.table) || !isTable(read.formatters)) throw new Error("The client's notification formats are not two tables.");
  return { table: read.table, formatters: read.formatters, groups: isTable(read.groups) ? read.groups : null };
}

/**
 * The client's notification formats, read from `clientRoot` (the folder holding `tq`) once, when first asked for.
 *
 *   available()   whether there is a client to read at all
 *   formats()     Promise of {table, formatters, groups}, or null when they cannot be read
 *   status()      {available, python, loaded, error}
 */
function createClientNotificationFormats({ clientRoot = null, python = "python", run = runFormats, onError = () => {} } = {}) {
  let read = null;
  let state = { loaded: false, error: null };
  const available = () => Boolean(clientRoot);
  return {
    available,
    formats() {
      if (!available()) return Promise.resolve(null);
      if (read === null) {
        read = run({ python, binFolder: path.join(clientRoot, "tq", "bin64"), archive: path.join(clientRoot, "tq", "code.ccp") })
          .then(formatsOf)
          .then(
            (formats) => {
              state = { loaded: true, error: null };
              return formats;
            },
            (error) => {
              // Kept: a client or a Python that is not there will not be there on the next request either.
              state = { loaded: false, error: String((error && error.message) || error) };
              onError(error);
              return null;
            },
          );
      }
      return read;
    },
    status() {
      return { available: available(), python, ...state };
    },
  };
}

module.exports = { createClientNotificationFormats, runFormats };
