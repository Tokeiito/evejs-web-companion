"use strict";

// Reads the retail client's LogLite text exports and prints, per file and in line order:
//   - every GetMissionBriefingInfo answer (a CallRsp whose marshal carries "Decline Time"),
//     decoded with the server's own marshal decoder,
//   - every OnAgentMissionChange scatter and every agents::YesNo question,
// so each "Decline Time" form can be matched to the state the mission was in.

const fs = require("fs");
const path = require("path");

const [, , marshalPath, root, mode = "timeline"] = process.argv;
const { marshalDecode } = require(marshalPath);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// Python 2 repr of a str, starting at the opening quote. Returns [bytes, indexAfterClosingQuote].
function parsePyRepr(text, start) {
  const quote = text[start];
  if (quote !== "'" && quote !== '"') return null;
  const bytes = [];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === quote) return [Buffer.from(bytes), i + 1];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "x") {
        bytes.push(parseInt(text.slice(i + 2, i + 4), 16));
        i += 4;
        continue;
      }
      const simple = { n: 10, r: 13, t: 9, "\\": 92, "'": 39, '"': 34 }[next];
      if (simple === undefined) throw new Error(`unknown escape \\${next}`);
      bytes.push(simple);
      i += 2;
      continue;
    }
    bytes.push(ch.charCodeAt(0) & 0xff);
    i += 1;
  }
  return null; // unterminated: the line was cut
}

function keyText(key) {
  if (Buffer.isBuffer(key)) return key.toString("latin1");
  if (key && typeof key === "object" && "value" in key) return String(key.value);
  return String(key);
}

function findBriefingDict(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 12) return null;
  if (node.type === "dict" && Array.isArray(node.entries)) {
    if (node.entries.some(([key]) => keyText(key) === "Decline Time")) return node;
    for (const [, value] of node.entries) {
      const found = findBriefingDict(value, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    const found = findBriefingDict(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function plain(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return value;
  if (Buffer.isBuffer(value)) return value.toString("latin1");
  if (typeof value === "object" && (value.type === "long" || value.type === "int")) {
    return BigInt(value.value);
  }
  return value;
}

function fmtInterval(ticks) {
  const seconds = Number(ticks) / 1e7;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(1);
  return `${h}h${String(m).padStart(2, "0")}m${s.padStart(4, "0")}s`;
}

function fmtFileTime(ticks) {
  const ms = Number(BigInt(ticks) / 10000n) - 11644473600000;
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

function describeDecline(value) {
  if (value === null) return "None";
  const n = BigInt(value);
  if (n === -1n) return "-1";
  // An absolute FILETIME for these years is ~1.34e17; an interval of hours is ~1e11.
  if (n > 100000000000000000n) return `ABSOLUTE ${fmtFileTime(n)} (${n})`;
  return `remaining ${fmtInterval(n)} (${n} ticks)`;
}

function describeStamp(value) {
  if (value === null) return "None";
  const n = BigInt(value);
  if (n > 100000000000000000n) return fmtFileTime(n);
  return `interval ${fmtInterval(n)} (${n})`;
}

const files = walk(root).sort();
const tally = new Map();
let briefings = 0;
let undecodable = 0;

for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, "latin1");
  } catch (error) {
    continue;
  }
  if (!text.includes("Decline Time")) continue;
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;
    const stamp = line.split("\t")[1] || "";
    if (line.includes("Decline Time") && line.includes("<MarshalStream ")) {
      const at = line.indexOf("<MarshalStream ") + "<MarshalStream ".length;
      const callID = (/Address::Client\([^)]*callID="(\d+)"/.exec(line) || [])[1] || "?";
      let decoded = null;
      let why = "";
      try {
        const parsed = parsePyRepr(line, at);
        if (!parsed) why = "cut line";
        else decoded = marshalDecode(parsed[0]);
      } catch (error) {
        why = String(error && error.message);
      }
      const dict = decoded ? findBriefingDict(decoded) : null;
      if (!dict) {
        undecodable += 1;
        rows.push(`${lineNo}\t${stamp}\tBRIEFING callID=${callID}\tUNDECODED ${why}`);
        continue;
      }
      const fields = new Map(dict.entries.map(([key, value]) => [keyText(key), plain(value)]));
      const decline = fields.get("Decline Time");
      const accept = fields.get("AcceptTimestamp");
      const expiry = fields.get("Expiration Time");
      const form = decline === null
        ? "None"
        : BigInt(decline) === -1n
          ? "-1"
          : BigInt(decline) > 100000000000000000n ? "absolute" : "remaining";
      const state = accept === null ? "not-accepted" : "accepted";
      const tallyKey = `${state} / Decline Time ${form} / Expiration Time ${expiry === null ? "None" : "set"}`;
      tally.set(tallyKey, (tally.get(tallyKey) || 0) + 1);
      briefings += 1;
      rows.push(
        `${lineNo}\t${stamp}\tBRIEFING callID=${callID}\tDecline Time=${describeDecline(decline)}`
          + `\tAcceptTimestamp=${describeStamp(accept)}\tExpiration Time=${describeStamp(expiry)}`
          + `\tContentID=${fields.get("ContentID")}`
          + `\tTitle=${fields.get("Mission Title ID")}\tBriefing=${fields.get("Mission Briefing ID")}`,
      );
      continue;
    }
    const scatter = /ScatterEvent\( OnAgentMissionChange ,\*args= \(('[a-z_]+', \d+)\)/.exec(line);
    if (scatter) {
      rows.push(`${lineNo}\t${stamp}\tPUSH ${scatter[1]}`);
      continue;
    }
    const yesNo = /agents::YesNo args=\(.*?'(Agt[A-Za-z]+)'\), retval=(\w+)/.exec(line);
    if (yesNo) {
      const when = /'when': (\d+)L/.exec(line);
      rows.push(
        `${lineNo}\t${stamp}\tYESNO ${yesNo[1]} answered ${yesNo[2]}`
          + (when ? `\twhen=${fmtFileTime(when[1])}` : ""),
      );
    }
  }
  if (mode === "timeline") {
    console.log(`\n== ${path.relative(root, file)}`);
    for (const row of rows) console.log(row);
  }
}

console.log(`\n== tally over ${briefings} decoded briefing answers (${undecodable} undecoded)`);
for (const [key, count] of [...tally.entries()].sort()) console.log(`${String(count).padStart(4)}  ${key}`);
