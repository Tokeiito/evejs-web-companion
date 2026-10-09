"use strict";

// For every OnAgentMissionChange the server pushed (transport Packet::Notification lines), finds
// the agent DoAction the pilot had most recently sent and says whether the push was read before
// or after that DoAction's answer.
//   node scripts/recordings/push-order.js <marshal.js> <logs root>

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

function text(value) {
  if (Buffer.isBuffer(value)) return value.toString("latin1");
  if (value && typeof value === "object" && "value" in value) return String(value.value);
  return String(value);
}

function items(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function firstStream(line) {
  const at = line.indexOf("<MarshalStream ");
  if (at < 0) return null;
  const bytes = parsePyRepr(line, at + "<MarshalStream ".length);
  if (!bytes) return null;
  try {
    return marshalDecode(bytes);
  } catch (error) {
    return null;
  }
}

const tally = new Map();
const rows = [];

for (const file of walk(root).sort()) {
  let content;
  try {
    content = fs.readFileSync(file, "latin1");
  } catch (error) {
    continue;
  }
  if (!content.includes('broadcastID="OnAgentMissionChange"')) continue;
  const lines = content.split(/\r?\n/);
  const doActions = []; // { callID, reqLine, action, rspLines: [] }
  const byCallID = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("eveMachoNet transport")) continue;
    const lineNo = index + 1;
    if (line.includes("Write:  Packet::CallReq") && line.includes("DoAction")) {
      const callID = (/Address::Client\([^)]*callID="(\d+)"/.exec(line) || [])[1];
      const decoded = firstStream(line);
      const parts = items(decoded);
      const method = parts.length > 1 ? text(parts[1]) : "";
      if (method !== "DoAction") continue;
      const args = items(parts[2]);
      const entry = {
        callID,
        reqLine: lineNo,
        action: args.length ? text(args[0]) : "None",
        rspLines: [],
        rspStamps: [],
        reqStamp: line.split("	")[1],
      };
      doActions.push(entry);
      byCallID.set(callID, entry);
      continue;
    }
    if (line.includes("Read:  Packet::CallRsp")) {
      const callID = (/Address::Client\([^)]*callID="(\d+)"/.exec(line) || [])[1];
      const entry = byCallID.get(callID);
      if (entry) { entry.rspLines.push(lineNo); entry.rspStamps.push(line.split("	")[1]); }
      continue;
    }
    if (
      line.includes("Read:  Packet::Notification") &&
      line.includes('broadcastID="OnAgentMissionChange"')
    ) {
      const decoded = firstStream(line);
      // (0, (1, (state, agentID)))
      const inner = items(items(items(decoded)[1])[1]);
      const state = inner.length ? text(inner[0]) : "?";
      const last = doActions[doActions.length - 1] || null;
      rows.push({ file: path.relative(root, file), lineNo, state, doAction: last, stamp: line.split("\t")[1] });
    }
  }
}

for (const row of rows) {
  const { doAction } = row;
  let verdict;
  let detail;
  if (!doAction) {
    verdict = "no DoAction earlier in the recording";
    detail = "";
  } else {
    const finalRsp = doAction.rspLines[doAction.rspLines.length - 1];
    const firstRsp = doAction.rspLines[0];
    if (finalRsp === undefined || row.lineNo < firstRsp) verdict = "BEFORE the reply";
    else if (row.lineNo > finalRsp) verdict = "AFTER the reply";
    else verdict = "between the provisional and the final reply";
    detail = `DoAction(${doAction.action}) callID=${doAction.callID} req@${doAction.reqLine} rsp@${doAction.rspLines.join(",") || "none"} reqAt=${doAction.reqStamp} rspAt=${doAction.rspStamps.join(" | ")}`;
    row.gap = finalRsp === undefined ? null : row.lineNo - finalRsp;
  }
  const key = `${row.state.padEnd(10)} ${verdict}`;
  tally.set(key, (tally.get(key) || 0) + 1);
  console.log(`${row.file}\t${row.lineNo}\t${row.stamp}\t${row.state}\t${verdict}\t${detail}`);
}

console.log("\n== tally");
for (const [key, count] of [...tally.entries()].sort()) console.log(`${String(count).padStart(4)}  ${key}`);
