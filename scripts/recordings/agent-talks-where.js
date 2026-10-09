// Adds to each row of agent-talks.js output where the pilot's session was when it talked: the station it was docked in, or "space".
//   node scripts/recordings/agent-talks-where.js <agent-talks output> <logs root>
const fs = require("fs");
const path = require("path");
const [, , scan, root] = process.argv;
const rows = fs.readFileSync(scan, "utf8").split(/\r?\n/).filter((line) => line.split("\t").length >= 5);
const byFile = new Map();
for (const row of rows) {
  const [file, line, what, before, buttons] = row.split("\t");
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push({ line: Number(line), what, before, buttons });
}
const tally = new Map();
const perFile = [];
for (const [file, calls] of byFile) {
  const lines = fs.readFileSync(path.join(root, file), "latin1").split(/\r?\n/);
  const changes = [];
  lines.forEach((line, index) => {
    if (!line.includes("Packet::SessionChangeNotification")) return;
    const found = /'stationid': \((\w+), (\w+)\)/.exec(line);
    if (found) changes.push({ line: index + 1, from: found[1], to: found[2] });
  });
  const stations = new Map();
  for (const call of calls) {
    const earlier = changes.filter((change) => change.line < call.line);
    const where = earlier.length > 0 ? earlier[earlier.length - 1].to : changes.length > 0 ? changes[0].from : "unknown";
    call.where = where === "None" ? "space" : where;
    if (call.what === "talk" && /accepted|modified/.test(call.before)) {
      const kind = call.buttons.startsWith("(no buttons") ? "no buttons" : call.buttons.replace(/\d+:/g, "");
      const key = `${call.where === "space" ? "in space" : call.where === "unknown" ? "unknown" : "docked"} -> ${kind}`;
      tally.set(key, (tally.get(key) || 0) + 1);
      const perStation = stations.get(call.where) || new Map();
      perStation.set(kind, (perStation.get(kind) || 0) + 1);
      stations.set(call.where, perStation);
    }
  }
  if (stations.size > 0) perFile.push(`${file.slice(0, 70)}\t${[...stations].map(([where, kinds]) => `${where}: ${[...kinds].map(([kind, count]) => `${kind} x${count}`).join(", ")}`).join(" | ")}`);
}
for (const line of perFile) console.log(line);
console.log("\n== fresh talks about a mission already accepted");
for (const [key, count] of [...tally].sort()) console.log(`${String(count).padStart(4)}  ${key}`);
