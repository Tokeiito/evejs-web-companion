"use strict";

// The repository's tests, run with the game-port audit in every test process, and what it found judged.
//
//   npm run audit:game-port                     the whole suite (it IS a run of the whole suite)
//   node scripts/game-port-audit.js -- <files>  some test files only
//   node scripts/game-port-audit.js --keep <folder>   and keep the suite's output and the audit's files there
//
// What is looked for, and why: scripts/gamePortAudit.js. It fails where the suite fails, and where a finding is
// one a window can meet (a route the page names, or the page's own call) or is not on the list of those known
// (scripts/game-port-audit-known.json). A finding on that list is one no window can meet yet; when a window
// comes to ask its route, it comes off the list and is put right.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { coverage, gather, judge, routePatterns } = require("./gamePortAudit");

const root = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const rest = argv.includes("--") ? argv.slice(argv.indexOf("--") + 1) : [];
const own = argv.includes("--") ? argv.slice(0, argv.indexOf("--")) : argv;
const keep = own.includes("--keep") ? path.resolve(own[own.indexOf("--keep") + 1] || "") : null;

const folder = keep || fs.mkdtempSync(path.join(os.tmpdir(), "game-port-audit-"));
fs.mkdirSync(folder, { recursive: true });
const files = { out: path.join(folder, "findings.jsonl"), seen: path.join(folder, "seen.jsonl"), log: path.join(folder, "suite.log") };
for (const file of Object.values(files)) fs.rmSync(file, { force: true });
fs.writeFileSync(files.out, "");
fs.writeFileSync(files.seen, "");

// The suite, its output to a file (it is long), with the hook loaded first in every test process.
const hook = path.join(__dirname, "game-port-audit-hook.js").replace(/\\/g, "/");
const log = fs.openSync(files.log, "w");
const run = spawnSync(process.execPath, ["--test", ...rest], {
  cwd: root,
  stdio: ["ignore", log, log],
  env: {
    ...process.env,
    GAME_PORT_AUDIT_OUT: files.out,
    GAME_PORT_AUDIT_SEEN: files.seen,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--require="${hook}"`,
  },
});
fs.closeSync(log);

const lines = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
const rows = (file) => lines(file).map((line) => JSON.parse(line));
const suite = lines(files.log);
console.log(`the suite: ${suite.filter((line) => /^ℹ (tests|pass|fail|cancelled|skipped) /.test(line)).map((line) => line.slice(2)).join(", ") || "no totals"} (exit ${run.status})`);
for (const line of suite.filter((line) => /^✖ /.test(line)).slice(0, 20)) console.log(`  ${line}`);

const routes = routePatterns(fs.readFileSync(path.join(root, "src/server.js"), "utf8"), fs.readFileSync(path.join(root, "web/src/app/api.ts"), "utf8"));
const known = JSON.parse(fs.readFileSync(path.join(__dirname, "game-port-audit-known.json"), "utf8"));
const seen = rows(files.seen);
const verdict = judge(gather(rows(files.out), routes), known);
const { PAGE_WRITE_PAIR_KEYS } = require("../src/bridgeCallPolicy");
const measured = coverage(seen, routes, [...PAGE_WRITE_PAIR_KEYS]);

const told = (row) => `${row.kind}${row.when ? ` (${row.when})` : ""} | ${row.route}${row.named && row.fn !== "page" ? "  [the page names it]" : ""} | ${row.fn} ${row.pair}${row.write === true ? " (a write)" : row.write === false ? " (a read)" : ""}${row.status ? ` [${row.status}]` : ""}`;
console.log(`\nlooked at: ${new Set(seen.filter((each) => each.fn !== "request" && each.fn !== "page").map((each) => `${each.fn} ${each.pair}`)).size} calls of the transport's, for ${new Set(seen.filter((each) => each.fn === "request").map((each) => each.route)).size} paths asked; ${measured.pageCalls} calls of the page's own; ${measured.withNoRequest} calls made for no request`);
console.log(`of the ${measured.named} routes the page names: ${measured.asked} asked by a test, ${measured.called} of them with a call of the transport's looked at`);
const ofTheBridge = (each) => each.includes(" /api/bridge/");
const listed = (list) => list.map((each) => `    ${each}`).join("\n");
if (measured.notAsked.length) console.log(`  asked by no test (NOT LOOKED AT): ${measured.notAsked.length}\n   of the bridge's routes:\n${listed(measured.notAsked.filter(ofTheBridge))}\n   of the others:\n${listed(measured.notAsked.filter((each) => !ofTheBridge(each)))}`);
if (measured.askedWithNoCall.length) console.log(`  asked, and no call of the transport's made for it: ${measured.askedWithNoCall.length}, of the bridge's routes these:\n${listed(measured.askedWithNoCall.filter(ofTheBridge))}`);
if (measured.pageWritesNotSeen.length) console.log(`  writes of the page's own that no test of the page's makes (NOT LOOKED AT): ${measured.pageWritesNotSeen.join(", ")}`);

console.log(`\nfindings a window can meet, or that are not on the list: ${verdict.unexpected.length}`);
for (const row of verdict.unexpected) console.log(`  ${told(row)}\n      ${row.detail ? `${row.detail.slice(0, 200)}\n      ` : ""}in ${row.tests.join(", ")}`);
console.log(`findings on the list (no window can meet them yet): ${verdict.expected.length}`);
for (const row of verdict.expected) console.log(`  ${told(row)}`);
if (rest.length > 0) console.log("(only some test files were run: what is not looked at above, and what is on the list and was not met, says nothing)");
else if (verdict.gone.length) console.log(`on the list and not met (take them off it):\n${verdict.gone.map((each) => `  ${each.kind} | ${each.route} | ${each.pair}`).join("\n")}`);
if (keep) console.log(`\nkept in ${folder}`); else fs.rmSync(folder, { recursive: true, force: true });

process.exitCode = run.status === 0 && verdict.unexpected.length === 0 ? 0 : 1;
