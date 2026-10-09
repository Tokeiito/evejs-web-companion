"use strict";

// For every agent DoAction in the recordings: what was pressed (None is a fresh talk), the buttons the
// answer offered, and the last thing the server had said of that pilot's missions before it.
//   node scripts/recordings/agent-talks.js <marshal.js> <logs root> > <agent-talks output>
// Prints numbers only: none of the recordings' text.

const fs = require("fs");
const path = require("path");

const [, , marshalPath, root] = process.argv;
const { marshalDecode } = require(marshalPath);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function parsePyRepr(text, start) {
  const quote = text[start];
  if (quote !== "'" && quote !== '"') return null;
  const bytes = [];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === quote) return Buffer.from(bytes);
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "x") {
        bytes.push(parseInt(text.slice(i + 2, i + 4), 16));
        i += 4;
        continue;
      }
      const simple = { n: 10, r: 13, t: 9, "\\": 92, "'": 39, '"': 34 }[next];
      if (simple === undefined) return null;
      bytes.push(simple);
      i += 2;
      continue;
    }
    bytes.push(ch.charCodeAt(0) & 0xff);
    i += 1;
  }
  return null;
}

const text = (value) => (Buffer.isBuffer(value) ? value.toString("latin1") : value && typeof value === "object" && "value" in value ? String(value.value) : String(value));
const items = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);
const number = (value) => (typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : value && typeof value === "object" && "value" in value && /^-?\d+$/.test(String(value.value)) ? Number(value.value) : null);

/** Every MarshalStream on a line, decoded; and any stream nested in one as bytes. */
function streams(line) {
  const out = [];
  let at = line.indexOf("<MarshalStream ");
  while (at >= 0) {
    const bytes = parsePyRepr(line, at + "<MarshalStream ".length);
    if (bytes) {
      try { out.push(marshalDecode(bytes)); } catch { /* not one this decoder reads */ }
    }
    at = line.indexOf("<MarshalStream ", at + 1);
  }
  return out;
}

/** The first list in a value whose every item is a pair of numbers with a button's number second: the answer's buttons. */
function buttonsIn(value, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) {
    // A stream inside a stream (the answer's payload is one).
    if (value.length > 4 && value[0] === 0x7e) {
      try { return buttonsIn(marshalDecode(value), depth + 1); } catch { return null; }
    }
    return null;
  }
  const list = items(value);
  if (list.length > 0 && value && value.type === "list" && list.every((item) => items(item).length === 2 && number(items(item)[0]) !== null)) {
    return list.map((item) => [number(items(item)[0]), number(items(item)[1]) ?? "words"]);
  }
  if (typeof value === "object") {
    const children = Array.isArray(value) ? value : value.items || (value.entries ? value.entries.flat() : Object.values(value));
    for (const child of children) {
      const found = buttonsIn(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Whether an answer holds an empty list where the buttons go: found by the answer having no pair list at all. */
const NAMES = { 1: "view", 2: "request", 3: "accept", 4: "accept-remote", 5: "complete?", 6: "complete", 7: "complete-remote", 8: "continue", 9: "decline", 10: "defer", 11: "quit", 12: "research", 13: "stop-research", 14: "datacores", 15: "locate", 16: "locate-yes", 17: "locate-no", 18: "yes", 19: "no" };

const tally = new Map();
for (const file of walk(root).sort()) {
  let content;
  try { content = fs.readFileSync(file, "latin1"); } catch { continue; }
  if (!content.includes("DoAction")) continue;
  const lines = content.split(/\r?\n/);
  const byCallID = new Map();
  let lastChange = "none yet";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("eveMachoNet transport")) continue;
    if (line.includes("Read:  Packet::Notification") && line.includes('broadcastID="OnAgentMissionChange"')) {
      const inner = items(items(items(streams(line)[0])[1])[1]);
      lastChange = inner.length ? text(inner[0]) : "?";
      continue;
    }
    if (line.includes("Write:  Packet::CallReq") && line.includes("DoAction")) {
      const callID = (/Address::Client\([^)]*callID="(\d+)"/.exec(line) || [])[1];
      const parts = items(streams(line)[0]);
      if ((parts.length > 1 ? text(parts[1]) : "") !== "DoAction") continue;
      const args = items(parts[2]);
      const pressed = args.length === 0 || args[0] === null || args[0] === undefined ? null : number(args[0]);
      byCallID.set(callID, { line: index + 1, pressed, before: lastChange });
      continue;
    }
    if (line.includes("Read:  Packet::CallRsp")) {
      const callID = (/Address::Client\([^)]*callID="(\d+)"/.exec(line) || [])[1];
      const call = byCallID.get(callID);
      if (!call) continue;
      let buttons = null;
      for (const stream of streams(line)) {
        buttons = buttonsIn(stream);
        if (buttons) break;
      }
      // A provisional answer comes first for some calls; the one with buttons, or the last, is the answer.
      if (!buttons) {
        call.empty = (call.empty || 0) + 1;
        call.emptyLine = index + 1;
        continue;
      }
      byCallID.delete(callID);
      const shown = buttons ? buttons.map(([id, type]) => `${id}:${typeof type === "number" ? NAMES[type] ?? type : type}`).join(" ") : "(no buttons)";
      const kinds = buttons ? buttons.map(([, type]) => (typeof type === "number" ? NAMES[type] ?? type : type)).join("+") : "none";
      console.log(`${path.relative(root, file)}\t${call.line}\t${call.pressed === null ? "talk" : `press ${call.pressed}`}\tafter ${call.before}\t${shown}`);
      const key = `${call.pressed === null ? "fresh talk" : "a press   "} after ${call.before.padEnd(10)} -> ${kinds}`;
      tally.set(key, (tally.get(key) || 0) + 1);
    }
  }
  // Calls none of whose answers held a list of buttons.
  for (const call of byCallID.values()) {
    console.log(`${path.relative(root, file)}\t${call.line}\t${call.pressed === null ? "talk" : `press ${call.pressed}`}\tafter ${call.before}\t(no buttons in ${call.empty || 0} answers, last at ${call.emptyLine || "-"})`);
    const key = `${call.pressed === null ? "fresh talk" : "a press   "} after ${call.before.padEnd(10)} -> none (${call.empty ? `${call.empty} answers` : "no answer recorded"})`;
    tally.set(key, (tally.get(key) || 0) + 1);
  }
}
console.log("\n== tally");
for (const [key, count] of [...tally.entries()].sort()) console.log(`${String(count).padStart(4)}  ${key}`);
