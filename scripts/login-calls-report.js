"use strict";

// The retail client's login, set beside the game port's.
//
// From the moment it connects until it is sitting in a station doing nothing, the retail client asks the server
// some hundred and fifty things as its services start. The game-port transport asks what the features built so
// far need, and no more (docs/game-port-client-reference.md, "Startup call sequence"). What is absent is what a
// server could tell the two apart by. This reads both logins out of the server's own log, where every call a
// client makes is a line, and writes docs/game-port-login-calls.md: each call of the retail client's login in the
// order it first made it, with whether the game port asks it at login too, asks it later when a feature wants it
// (it has an entry in src/gamePort/retailCalls.js, or is a bind the transport makes as the client does), has only a
// route of the BFF's that can ask it (it is on the BFF's list of calls and has not been read against the client's),
// or never asks it.
//
//   node scripts/login-calls-report.js <retail log> <from line> <to line> <what that was>
//                                      <our log> <from line> <to line> <what that was> [learn-from log ...] [--out path]
//
// A call on a bound object is its service's where the log says whose object it is ("bound object registered").
// An older log does not say: such a call is given the one service whose objects the learn-from logs (and the two
// logs themselves) show that method on, and is marked as inferred; with none or several it stays "(an object)".

const fs = require("node:fs");
const path = require("node:path");
const { MONIKER_SERVICES, RETAIL_CALLS } = require("../src/gamePort/retailCalls");
const contract = require("../contracts/evejs-web-bridge-contract.json");

/** The colours an older log was written with. */
const ANSI = /\u001b\[[0-9;]*m/g;
/** A call a client made: when (as the log has it), whom it was asked of, and the method. In either form of the log. */
const CALL = /^\[?(\d{4}-\d\d-\d\dT[\d:.]+Z|\d\d:\d\d:\d\d)\]?\s+(?:\[PKT\] )?IN\s+(\S+) (\w+)\(\)/;
const REGISTERED = /bound object registered: (N=\d+:\d+) -> (\w+)/;
const UNNAMED = "(an object)";

/**
 * The calls a server's log says a client made between two of its lines (counted from 1, both included), in order.
 * Each is { pair, service, method, onObject, chosen, at, line }: `chosen` says whether a character had been
 * chosen by then, the choosing itself being the first that had. Whose object a call was on is taken from what the
 * log said before the call, however far before.
 */
function callsIn(text, { from = 1, to = Infinity } = {}) {
  const objects = new Map();
  const calls = [];
  let chosen = false;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(ANSI, "");
    const registered = REGISTERED.exec(line);
    if (registered) objects.set(registered[1], registered[2]);
    if (index + 1 < from || index + 1 > to) continue;
    const call = CALL.exec(line);
    if (!call) continue;
    const [, at, target, method] = call;
    const onObject = target.startsWith("N=");
    const service = onObject ? objects.get(target) ?? null : target;
    if (service === "charUnboundMgr" && method === "SelectCharacterID") chosen = true;
    calls.push({ pair: `${service ?? UNNAMED}.${method}`, service, method, onObject, chosen, at, line: index + 1 });
  }
  return calls;
}

/** Method -> the one service whose bound objects these calls show it on. A method seen on two services' objects is left out. */
function methodServices(calls) {
  const seen = new Map();
  for (const call of calls) {
    if (!call.onObject || call.service === null) continue;
    seen.set(call.method, (seen.get(call.method) ?? new Set()).add(call.service));
  }
  return new Map([...seen].filter(([, services]) => services.size === 1).map(([method, services]) => [method, [...services][0]]));
}

/** Those calls, each one on an object nobody named given the service the table has for its method, and marked. */
function attributed(calls, table) {
  return calls.map((call) => {
    const service = call.service === null ? table.get(call.method) ?? null : null;
    return service === null ? { ...call, inferred: false } : { ...call, service, pair: `${service}.${call.method}`, inferred: true };
  });
}

/** Rows of [pair, part of the login], in the order each was first made, with how many times. */
function tally(calls) {
  const rows = new Map();
  for (const call of calls) {
    const key = `${call.chosen ? 1 : 0} ${call.pair}`;
    const row = rows.get(key) ?? { pair: call.pair, chosen: call.chosen === true, calls: 0, inferred: call.inferred === true };
    row.calls += 1;
    rows.set(key, row);
  }
  return [...rows.values()];
}

/**
 * The retail client's login beside ours. Each of its calls is "at login" where ours makes that call at login too;
 * "by a feature" where ours makes it when a feature wants it, in a form read against the client's (`known.read`);
 * "by a route" where the BFF only has a route that can make it (`known.routed`); and "never" otherwise.
 * `oursOnly` is what ours asks at login that the client's login has none of.
 */
function compare(retail, ours, known) {
  const asked = new Set(ours.map((call) => call.pair));
  const standing = (pair) => (asked.has(pair) ? "at login" : known.read.has(pair) ? "by a feature" : known.routed.has(pair) ? "by a route" : "never");
  const rows = tally(retail).map((row) => ({ ...row, ours: standing(row.pair) }));
  const theirs = new Set(retail.map((call) => call.pair));
  const counts = { pairs: rows.length, calls: retail.length, "at login": 0, "by a feature": 0, "by a route": 0, never: 0 };
  for (const row of rows) counts[row.ours] += 1;
  return { retail: rows, oursOnly: tally(ours).filter((row) => !theirs.has(row.pair)), counts };
}

const MEANING = {
  "at login": "The game port asks this at login too.",
  "by a feature": "A feature of the web client asks this when it is wanted, in a form read against the client's.",
  "by a route": "The BFF has a route that can ask this. It has not been read against the client's.",
  never: "Nothing of ours asks this.",
};

function report({ retail, ours, known, what }) {
  const compared = compare(retail, ours, known);
  const callsOf = (kind) => compared.retail.filter((row) => row.ours === kind).reduce((sum, row) => sum + row.calls, 0);
  const table = (rows) => ["| Call | Times | The game port |", "|---|---|---|", ...rows.map((row) => `| \`${row.pair}\`${row.inferred ? " (inferred)" : ""} | ${row.calls} | ${row.ours} |`)];
  const part = (chosen) => compared.retail.filter((row) => row.chosen === chosen);
  return [
    "# Game-port login calls",
    "",
    "Generated by `scripts/login-calls-report.js`. Do not edit: run the script.",
    "",
    `The retail client's login: ${what.retail}. The game port's: ${what.ours}. Both are read out of the server's own log, where every call a client makes is a line.`,
    "",
    "A call on a bound object is listed under its service where the log says whose object it was. Where an older log does not say, the service is the one whose objects other logs show that method on, and the call is marked \"(inferred)\"; with none or several it is listed as `(an object)`.",
    "",
    `The retail client made ${compared.counts.calls} calls of ${compared.counts.pairs} kinds (a call asked before a character is chosen and again after is counted as two kinds).`,
    "",
    "| The game port | Kinds | Calls | Meaning |",
    "|---|---|---|---|",
    ...Object.keys(MEANING).map((kind) => `| ${kind} | ${compared.counts[kind]} | ${callsOf(kind)} | ${MEANING[kind]} |`),
    "",
    "## Before a character is chosen",
    "",
    ...table(part(false)),
    "",
    "## From the choosing of a character",
    "",
    ...table(part(true)),
    "",
    "## Asked by the game port and not by the client",
    "",
    ...(compared.oursOnly.length === 0 ? ["Nothing."] : ["| Call | Times |", "|---|---|", ...compared.oursOnly.map((row) => `| \`${row.pair}\` | ${row.calls} |`)]),
    "",
  ].join("\n");
}

/**
 * What of ours can make a call. Read against the client's: the registry's pairs, and the resolving and binding of
 * every service the transport binds as the client's Moniker does (the registry's moniker services, and those the
 * BFF may bind). Routed: every pair on the BFF's list of calls.
 */
function knownCalls() {
  const routed = new Set(contract.gatewayAllowlist.pairs);
  const bound = new Set([...Object.keys(MONIKER_SERVICES), ...[...routed].filter((pair) => pair.endsWith(".MachoBindObject")).map((pair) => pair.split(".")[0])]);
  const read = new Set([...Object.keys(RETAIL_CALLS), ...[...bound].flatMap((service) => [`${service}.MachoResolveObject`, `${service}.MachoBindObject`])]);
  return { read, routed };
}

if (require.main === module) {
  const given = process.argv.slice(2);
  const outAt = given.indexOf("--out");
  const reportPath = outAt >= 0 ? given.splice(outAt, 2)[1] : path.resolve(__dirname, "..", "docs", "game-port-login-calls.md");
  const [retailLog, retailFrom, retailTo, retailWhat, ourLog, ourFrom, ourTo, ourWhat, ...learnFrom] = given;
  if (!ourWhat) {
    console.error("usage: node scripts/login-calls-report.js <retail log> <from> <to> <what> <our log> <from> <to> <what> [learn-from log ...] [--out path]");
    process.exit(2);
  }
  const read = (file) => fs.readFileSync(file, "utf8");
  const theirs = callsIn(read(retailLog), { from: Number(retailFrom), to: Number(retailTo) });
  const ours = callsIn(read(ourLog), { from: Number(ourFrom), to: Number(ourTo) });
  const table = methodServices([...theirs, ...ours, ...learnFrom.flatMap((file) => callsIn(read(file)))]);
  const retail = attributed(theirs, table);
  const known = knownCalls();
  const text = report({ retail, ours: attributed(ours, table), known, what: { retail: retailWhat, ours: ourWhat } });
  fs.writeFileSync(reportPath, text);
  const { counts } = compare(retail, attributed(ours, table), known);
  console.log(`${counts.calls} calls of ${counts.pairs} kinds; at login ${counts["at login"]}, by a feature ${counts["by a feature"]}, by a route ${counts["by a route"]}, never ${counts.never}; written to ${reportPath}`);
}

module.exports = { attributed, callsIn, compare, knownCalls, methodServices, report };
