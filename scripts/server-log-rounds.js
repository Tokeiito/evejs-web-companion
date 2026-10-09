"use strict";

// Calls in a stretch of the EveJS server's log, set beside the server's own
// notices: how many calls, how many notices, and which calls had no notice
// just before them.
//
// A count of calls says nothing of why they were made. The page reads some
// things again when the server tells it something changed, and such a call is
// not polling: it follows the notice within a second or two. This puts each
// call beside what came before it.
//
//   node scripts/server-log-rounds.js <server log> <from> <to> [calls] [notices] [seconds]
//
//   <from>, <to>   the stretch, as the log writes its times: 2026-10-09T17:17:00
//   [calls]        a pattern for the calls' method names; default "List|ListByFlags"
//   [notices]      a pattern for the notices' names; default "OnItemsChanged|OnItemChange"
//   [seconds]      how long after a notice a call still counts as following it; default 3
//
// The log is eve.js/_local/logs/server.log for the hour under way, and
// server.<date>_<hour>.log beside it for an earlier one.

const fs = require("node:fs");

const [file, from, to, calls = "List|ListByFlags", notices = "OnItemsChanged|OnItemChange", seconds = "3"] = process.argv.slice(2);
if (!file || !from || !to) {
  console.error("usage: node scripts/server-log-rounds.js <server log> <from> <to> [calls] [notices] [seconds]");
  process.exit(2);
}
const within = Number(seconds) * 1000;
const at = (line) => Date.parse(line.slice(1, 25));
const lines = fs.readFileSync(file, "latin1").split("\n").filter((line) => line >= `[${from}` && line < `[${to}`);
const called = lines.filter((line) => new RegExp(`\\[PKT\\] IN .* (${calls})\\(\\) callID`).test(line));
const told = lines.filter((line) => new RegExp(`\\[PKT\\] OUT (${notices})\\b`).test(line)).map(at);
const unprompted = called.filter((line) => !told.some((when) => at(line) - when >= 0 && at(line) - when < within));

console.log(`${from} to ${to}: ${called.length} calls, ${told.length} notices, ${unprompted.length} calls with no notice in the ${seconds} s before`);
for (const line of unprompted) console.log(`  ${line.slice(12, 24)}  ${line.replace(/.*\[PKT\] IN\s+/, "").trim()}`);
