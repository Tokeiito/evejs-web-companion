"use strict";
// For every fresh talk in the scan, the bound object it was sent to; then, file by file, whether the talks
// that got no buttons while docked went to the same object as the talks that got Complete and Quit.
//   node scripts/recordings/agent-talks-empty.js <agent-talks output> <logs root>
const fs = require("fs");
const path = require("path");
const [, , scan, root] = process.argv;
const rows = fs.readFileSync(scan, "utf8").split(/\r?\n/).filter((line) => line.split("\t").length >= 5);
const byFile = new Map();
for (const row of rows) {
  const [file, line, what, before, buttons] = row.split("\t");
  if (what !== "talk" || !/accepted|modified/.test(before)) continue;
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push({ line: Number(line), none: buttons.startsWith("(no buttons"), answer: Number((/last at (\d+)/.exec(buttons) || [])[1]) || null });
}
let sameObject = 0;
let otherObject = 0;
for (const [file, calls] of byFile) {
  const lines = fs.readFileSync(path.join(root, file), "latin1").split(/\r?\n/);
  const changes = [];
  lines.forEach((line, index) => {
    if (!line.includes("Packet::SessionChangeNotification")) return;
    const found = /'stationid': \((\w+), (\w+)\)/.exec(line);
    if (found) changes.push({ line: index + 1, to: found[2], from: found[1] });
  });
  const objectOf = (lineNo) => (/(N=\d+:\d+)/.exec(lines[lineNo - 1]) || [])[1] || "?";
  const missionObjects = new Set(calls.filter((call) => !call.none).map((call) => objectOf(call.line)));
  for (const call of calls.filter((each) => each.none)) {
    const earlier = changes.filter((change) => change.line < call.line);
    const where = earlier.length > 0 ? earlier[earlier.length - 1].to : changes.length > 0 ? changes[0].from : "unknown";
    if (where === "None") continue;
    const object = objectOf(call.line);
    const label = call.answer ? (/UI\/Agents\/[A-Za-z/0-9]+/.exec(lines[call.answer - 1]) || [""])[0] : "";
    const same = missionObjects.has(object);
    if (same) sameObject += 1; else otherObject += 1;
    console.log(`${file.slice(5, 50).padEnd(45)} line ${call.line}: sent to ${object}; the mission's agent is ${[...missionObjects].join(" ")}; ${same ? "THE SAME OBJECT" : "another object"}; answered with the label ${label.split("/").pop()}`);
  }
}
console.log(`\ndocked talks with no buttons: ${otherObject} to another agent's object, ${sameObject} to the mission's own`);
