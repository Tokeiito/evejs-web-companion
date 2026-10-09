"use strict";

// For every fresh talk about a mission already accepted, made while docked: the buttons the answer had,
// beside the mission's objectives as the client read them next (GetMissionObjectiveInfo), so that it can
// be said whether the pilot was at the drop-off, and whether the objective was done.
//   node scripts/recordings/agent-talks-objectives.js <marshal.js> <agent-talks output> <logs root>
// Prints numbers only.

const fs = require("fs");
const path = require("path");
const [, , marshalPath, scan, root] = process.argv;
const { marshalDecode } = require(marshalPath);

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
      if (next === "x") { bytes.push(parseInt(text.slice(i + 2, i + 4), 16)); i += 4; continue; }
      const simple = { n: 10, r: 13, t: 9, "\\": 92, "'": 39, '"': 34 }[next];
      if (simple === undefined) return null;
      bytes.push(simple); i += 2; continue;
    }
    bytes.push(ch.charCodeAt(0) & 0xff);
    i += 1;
  }
  return null;
}
const text = (value) => (Buffer.isBuffer(value) ? value.toString("latin1") : value && typeof value === "object" && "value" in value ? String(value.value) : String(value));
const items = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);
const number = (value) => (typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : value && typeof value === "object" && "value" in value && /^-?\d+$/.test(String(value.value)) ? Number(value.value) : null);
function streams(line) {
  const out = [];
  let at = line.indexOf("<MarshalStream ");
  while (at >= 0) {
    const bytes = parsePyRepr(line, at + "<MarshalStream ".length);
    if (bytes) { try { out.push(marshalDecode(bytes)); } catch { /* skip */ } }
    at = line.indexOf("<MarshalStream ", at + 1);
  }
  return out;
}
/** The first dict anywhere in a value that has this key. */
function dictWith(value, key, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) {
    if (value.length > 4 && value[0] === 0x7e) { try { return dictWith(marshalDecode(value), key, depth + 1); } catch { return null; } }
    return null;
  }
  if (typeof value !== "object") return null;
  if (value.type === "dict" && Array.isArray(value.entries)) {
    if (value.entries.some(([name]) => text(name) === key)) return value;
    for (const [, child] of value.entries) { const found = dictWith(child, key, depth + 1); if (found) return found; }
    return null;
  }
  for (const child of Array.isArray(value) ? value : value.items || Object.values(value)) {
    const found = dictWith(child, key, depth + 1);
    if (found) return found;
  }
  return null;
}
const get = (dict, key) => { const entry = dict && dict.entries ? dict.entries.find(([name]) => text(name) === key) : null; return entry ? entry[1] : undefined; };

const rows = fs.readFileSync(scan, "utf8").split(/\r?\n/).filter((line) => line.split("\t").length >= 5);
const byFile = new Map();
for (const row of rows) {
  const [file, line, what, before, buttons] = row.split("\t");
  if (what !== "talk" || !/accepted|modified/.test(before)) continue;
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push({ line: Number(line), before, buttons: buttons.startsWith("(no buttons") ? "none" : buttons.replace(/\d+:/g, "").replace(/ /g, "+") });
}
const tally = new Map();
for (const [file, calls] of byFile) {
  const lines = fs.readFileSync(path.join(root, file), "latin1").split(/\r?\n/);
  const changes = [];
  const reads = new Map(); // callID -> request line of a GetMissionObjectiveInfo
  const answers = []; // { line, info }
  lines.forEach((line, index) => {
    if (line.includes("Packet::SessionChangeNotification")) {
      const found = /'stationid': \((\w+), (\w+)\)/.exec(line);
      if (found) changes.push({ line: index + 1, from: found[1], to: found[2] });
      return;
    }
    if (!line.includes("eveMachoNet transport")) return;
    if (line.includes("Write:  Packet::CallReq") && line.includes("GetMissionObjectiveInfo")) {
      const callID = (/Address::Client\([^)]*callID="(\d+)"/.exec(line) || [])[1];
      reads.set(callID, index + 1);
      return;
    }
    if (line.includes("Read:  Packet::CallRsp")) {
      const callID = (/Address::Client\([^)]*callID="(\d+)"/.exec(line) || [])[1];
      if (!reads.has(callID)) return;
      for (const stream of streams(line)) {
        const info = dictWith(stream, "missionState");
        if (info) { answers.push({ line: index + 1, asked: reads.get(callID), info }); reads.delete(callID); break; }
      }
    }
  });
  for (const call of calls) {
    const earlier = changes.filter((change) => change.line < call.line);
    const where = earlier.length > 0 ? earlier[earlier.length - 1].to : changes.length > 0 ? changes[0].from : "unknown";
    if (where === "None") continue; // in space
    // The objectives read next after the talk, before the pilot's session changes again.
    const nextChange = changes.find((change) => change.line > call.line);
    const read = answers.find((answer) => answer.asked > call.line && (!nextChange || answer.asked < nextChange.line));
    let said = "objectives not read after it";
    let kind = "unknown";
    if (read) {
      const objectives = items(get(read.info, "objectives")).map((objective) => {
        const [type, data] = items(objective);
        const parts = items(data);
        if (text(type) === "transport") {
          const pickup = number(get(parts[1], "locationID"));
          const dropoff = number(get(parts[3], "locationID"));
          const hasCargo = get(parts[4], "hasCargo");
          return { type: "transport", pickup, dropoff, hasCargo: hasCargo === true || number(hasCargo) === 1 };
        }
        if (text(type) === "fetch") {
          const dropoff = number(get(parts[1], "locationID"));
          const hasCargo = get(parts[2], "hasCargo");
          return { type: "fetch", dropoff, hasCargo: hasCargo === true || number(hasCargo) === 1 };
        }
        return { type: text(type) };
      });
      const dungeons = items(get(read.info, "dungeons")).map((dungeon) => ({ completed: number(get(dungeon, "objectiveCompleted")) }));
      const completion = number(get(read.info, "completionStatus"));
      const here = Number(where);
      const carry = objectives.find((objective) => objective.type === "transport" || objective.type === "fetch");
      if (carry) {
        kind = `${carry.type}: docked at ${carry.dropoff === here ? "the drop-off" : carry.pickup === here ? "the pick-up, not the drop-off" : "neither end"}, cargo ${carry.hasCargo ? "aboard or in the hangar" : "not held"}`;
      } else if (dungeons.length > 0) {
        kind = `dungeon: ${dungeons.map((dungeon) => (dungeon.completed === 1 ? "done" : dungeon.completed === 0 ? "failed" : "not done")).join(",")}`;
      } else {
        kind = objectives.map((objective) => objective.type).join(",") || "no objectives";
      }
      said = `${kind}; completionStatus ${completion}; state ${number(get(read.info, "missionState"))}`;
    }
    console.log(`${file.slice(5, 60).padEnd(55)}\t${String(call.line).padStart(6)}\tdocked ${where}\t${call.buttons}\t${said}`);
    const key = `${call.buttons.padEnd(14)} <- ${kind}`;
    tally.set(key, (tally.get(key) || 0) + 1);
  }
}
console.log("\n== docked fresh talks about a mission already accepted, by what the mission was");
for (const [key, count] of [...tally].sort()) console.log(`${String(count).padStart(4)}  ${key}`);
