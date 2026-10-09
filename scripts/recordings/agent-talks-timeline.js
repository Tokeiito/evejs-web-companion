// One recording's agent talks in order, each with where the pilot was, beside its session changes and mission changes.
//   node scripts/recordings/agent-talks-timeline.js <agent-talks output> <logs root> <part of the file's name>
const fs = require("fs");
const path = require("path");
const [, , scan, root, part] = process.argv;
const rows = fs.readFileSync(scan, "utf8").split(/\r?\n/).filter((line) => line.split("\t").length >= 5 && line.includes(part));
const files = [...new Set(rows.map((row) => row.split("\t")[0]))];
for (const file of files) {
  console.log(`== ${file}`);
  const lines = fs.readFileSync(path.join(root, file), "latin1").split(/\r?\n/);
  const events = [];
  lines.forEach((line, index) => {
    if (line.includes("Packet::SessionChangeNotification")) {
      const found = /'stationid': \((\w+), (\w+)\)/.exec(line);
      if (found) events.push([index + 1, `   session: stationid ${found[1]} -> ${found[2]}`]);
    } else if (line.includes("Read:  Packet::Notification") && line.includes('broadcastID="OnAgentMissionChange"')) {
      const found = /\x13.([a-z_]+)/.exec(line);
      events.push([index + 1, `   push: OnAgentMissionChange ${found ? found[1] : ""}`]);
    }
  });
  for (const row of rows.filter((each) => each.split("\t")[0] === file)) {
    const [, line, what, before, buttons] = row.split("\t");
    events.push([Number(line), `${what.padEnd(14)} ${before.padEnd(16)} -> ${buttons.replace(/\d+:/g, "")}`]);
  }
  for (const [line, text] of events.sort((a, b) => a[0] - b[0])) console.log(`${String(line).padStart(7)} ${text}`);
}
