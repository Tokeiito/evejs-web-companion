"use strict";

// The BFF's own answers, through both transports, compared.
//
// scripts/parity-harness.js compares raw calls. This compares what the browser
// actually fetches: the BFF's routes, which bind, call, re-read and reshape
// before they answer. It asks two running BFFs the same questions as the same
// docked character, one BFF with that account on the web gateway and one with
// it on the game port, and judges each pair with scripts/parity-compare.js.
//
//   node scripts/bff-parity.js <gatewayBffUrl> <gamePortBffUrl> <accountName> <characterID> [route ...]
//
// ⚠ ONE TRANSPORT AT A TIME. A character is in game on one session only, so
// the first BFF is logged out, and the character seen offline, before the
// second selects it. Anything else holding that character is taken over.
//
// ⚠ READS ONLY. Every route here is a GET, or the BFF's read-only call route.
//
// Which transport each BFF really used is read from the server's own log, not
// from its character status: the status says "retail_client" on "tcp" for a
// gateway session too, because the gateway registers its session as one. The
// log tells them apart. A gateway session writes "[EvejsWebGateway] Browser
// session started characterID=N"; a call on the game port writes "[PKT] IN".

const fs = require("node:fs");
const path = require("node:path");
const config = require("../src/config");
const gateway = require("../src/eveGatewayClient");
const { MOVED, TOLERATED, compare, kindsOf, openEnvelope } = require("./parity-compare");

/** The routes the web client's docked panels fetch. {shipID} is the active ship. */
const DOCKED_ROUTES = [
  "/api/bridge/flight/status",
  "/api/bridge/inventory",
  "/api/bridge/inventory/corp",
  "/api/bridge/ship/{shipID}/bays",
  "/api/bridge/fitting",
  "/api/bridge/bound-dogma",
  "/api/bridge/skills",
  "/api/bridge/wallet",
  "/api/bridge/journal",
  "/api/bridge/market",
  "/api/bridge/agents",
  "/api/bridge/assets",
  "/api/bridge/character-sheet",
  "/api/bridge/standings",
  "/api/bridge/contracts",
  "/api/bridge/industry",
  "/api/bridge/planets",
  "/api/bridge/mail",
  "/api/bridge/notifications",
  "/api/bridge/bound-fleet",
  "/api/bridge/calendar?month=10&year=2026",
  "/api/bridge/provisioning/options",
];

/** Fields that are different on every request by design, wherever they appear. */
const VOLATILE = new Set(["droneRecoveryCheckID", "sampledAtMs", "serverTimeMs", "readAtMs", "checkedAtMs", "nowMs", "generatedAt"]);

function withoutVolatile(value) {
  if (Array.isArray(value)) return value.map(withoutVolatile);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([name]) => !VOLATILE.has(name)).map(([name, entry]) => [name, withoutVolatile(entry)]));
}

/**
 * A BFF answer with every cached-answer envelope in it opened, as the
 * browser's decoders open one (unwrapCachedResult): the gateway hands the BFF
 * the envelope, the game-port session has already opened it. `references`
 * collects where an envelope only pointed into the server's object cache,
 * which the browser cannot follow and the game port can.
 */
function withEnvelopesOpened(value, path = "$", references = []) {
  if (Array.isArray(value)) return value.map((entry, index) => withEnvelopesOpened(entry, `${path}[${index}]`, references));
  if (value === null || typeof value !== "object") return value;
  const opened = openEnvelope(value);
  if (opened.envelope === "reference") {
    references.push(path);
    return null;
  }
  if (opened.envelope === "inline") return withEnvelopesOpened(opened.value, path, references);
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, withEnvelopesOpened(entry, `${path}.${name}`, references)]));
}

function client(base) {
  let token = null;
  return async function request(path, body) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Not JSON: the status alone is the answer.
    }
    if (path === "/api/login" && payload && payload.sessionToken) token = payload.sessionToken;
    return { status: response.status, payload };
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SERVER_LOG = path.join(config.eveRoot, "_local", "logs", "server.log");

/** How long the server's log is now, or null when it cannot be read from here. */
function logMark() {
  try {
    return fs.statSync(SERVER_LOG).size;
  } catch {
    return null;
  }
}

/** What the server logged since a mark: gateway sessions started for the character, and game-port calls taken. */
function logSince(mark, characterID) {
  if (mark === null) return null;
  try {
    const size = fs.statSync(SERVER_LOG).size;
    // The log rotates by the hour; a shorter file is a new one, read whole.
    const from = size >= mark ? mark : 0;
    const handle = fs.openSync(SERVER_LOG, "r");
    const buffer = Buffer.alloc(size - from);
    fs.readSync(handle, buffer, 0, buffer.length, from);
    fs.closeSync(handle);
    const written = buffer.toString("utf8");
    return {
      gatewaySessions: written.split(`[EvejsWebGateway] Browser session started characterID=${characterID} `).length - 1,
      gamePortCalls: written.split("[PKT] IN ").length - 1,
    };
  } catch {
    return null;
  }
}

/** Log in, select, read every route, log out. Answers {route: {status, payload}} and how the server saw the pilot. */
async function pass(base, accountName, accountID, characterID, routes) {
  const request = client(base);
  const mark = logMark();
  const login = await request("/api/login", { username: accountName });
  if (login.status !== 200) throw new Error(`${base} refused the login: ${JSON.stringify(login.payload)}`);
  const selected = await request("/api/bridge/select", { characterID });
  if (selected.status !== 200) throw new Error(`${base} refused the select: ${JSON.stringify(selected.payload)}`);
  if (selected.payload.droneRecoveryCheckID) {
    await request("/api/bridge/drone-recovery/ready", { checkID: selected.payload.droneRecoveryCheckID });
  }
  const answers = {};
  try {
    const flight = await request("/api/bridge/flight/status");
    const shipID = flight.payload && flight.payload.flight ? flight.payload.flight.shipID : null;
    for (const route of routes) {
      answers[route] = await request(route.replace("{shipID}", String(shipID)));
    }
  } finally {
    await request("/api/logout", {});
  }
  for (let waited = 0; waited < 10000; waited += 250) {
    if ((await gateway.getCharacterStatus(accountID, characterID)).online === false) break;
    await sleep(250);
  }
  await sleep(300); // the log is written a moment behind the calls
  return { answers, logged: logSince(mark, characterID) };
}

function judge(gatewayAnswer, gamePortAnswer) {
  if (gatewayAnswer.status !== gamePortAnswer.status) {
    return { verdict: "status differs", detail: `${gatewayAnswer.status} against ${gamePortAnswer.status}: ${JSON.stringify(gamePortAnswer.payload).slice(0, 200)}` };
  }
  const references = [];
  const differences = compare(
    withEnvelopesOpened(withoutVolatile(gatewayAnswer.payload), "$", references),
    withEnvelopesOpened(withoutVolatile(gamePortAnswer.payload)),
  );
  // Where the gateway could only point at the object cache, the game port having the object is a gain.
  for (const difference of differences) {
    if (difference.kind === "null-vs-value" && references.includes(difference.path)) difference.kind = "gained";
  }
  const settled = (difference) => MOVED.has(difference.kind) || TOLERATED.has(difference.kind) || difference.kind === "gained";
  const verdict = differences.length === 0 ? "identical"
    : differences.every((difference) => MOVED.has(difference.kind)) ? "moved"
      : differences.every(settled) ? "tolerated"
        : "divergent";
  return {
    verdict,
    detail: kindsOf(differences).map(([kind, count]) => `${kind} ×${count}`).join(", "),
    differences,
  };
}

async function main() {
  const [gatewayBff, gamePortBff, accountName, characterText, ...chosen] = process.argv.slice(2);
  const characterID = Number(characterText);
  if (!gatewayBff || !gamePortBff || !accountName || !Number.isSafeInteger(characterID)) {
    console.error("usage: node scripts/bff-parity.js <gatewayBffUrl> <gamePortBffUrl> <accountName> <characterID> [route ...]");
    process.exit(2);
  }
  const routes = chosen.length > 0 ? chosen : DOCKED_ROUTES;
  const account = await gateway.getAccount(accountName);
  const viaGateway = await pass(gatewayBff, accountName, account.accountID, characterID, routes);
  const viaGamePort = await pass(gamePortBff, accountName, account.accountID, characterID, routes);
  const said = (logged) => logged === null
    ? "the server's log could not be read"
    : `the server logged ${logged.gatewaySessions} gateway session(s) for this pilot and ${logged.gamePortCalls} game-port call(s)`;
  console.log(`gateway BFF   ${gatewayBff}: ${said(viaGateway.logged)}`);
  console.log(`game-port BFF ${gamePortBff}: ${said(viaGamePort.logged)}`);
  if (viaGateway.logged === null || viaGamePort.logged === null) {
    console.log("⚠ Without the server's log this cannot say which transport each BFF used.");
    process.exitCode = 1;
  } else if (viaGateway.logged.gatewaySessions < 1 || viaGamePort.logged.gatewaySessions !== 0 ||
      viaGamePort.logged.gamePortCalls <= viaGateway.logged.gamePortCalls) {
    console.log("⚠ The two BFFs are not on the two transports. This compares nothing.");
    process.exitCode = 1;
  }
  const counts = {};
  for (const route of routes) {
    const { verdict, detail, differences = [] } = judge(viaGateway.answers[route], viaGamePort.answers[route]);
    counts[verdict] = (counts[verdict] ?? 0) + 1;
    console.log(`${verdict.padEnd(15)} ${String(viaGateway.answers[route].status).padEnd(4)} ${route}${detail ? `   ${detail}` : ""}`);
    if (verdict === "divergent" || verdict === "status differs") {
      for (const difference of differences.filter((entry) => !["value", "count"].includes(entry.kind)).slice(0, 6)) {
        console.log(`     ${difference.path} ${difference.kind}: ${JSON.stringify(difference.gateway).slice(0, 110)} | ${JSON.stringify(difference.wire).slice(0, 110)}`);
      }
      process.exitCode = 1;
    }
    if (process.env.BFF_PARITY_SHOW_MOVED && verdict === "moved") {
      for (const difference of differences.slice(0, 6)) {
        console.log(`     ${difference.path} ${difference.kind}: ${JSON.stringify(difference.gateway).slice(0, 110)} | ${JSON.stringify(difference.wire).slice(0, 110)}`);
      }
    }
  }
  console.log(Object.entries(counts).map(([verdict, count]) => `${count} ${verdict}`).join(", "));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { DOCKED_ROUTES, judge, withEnvelopesOpened, withoutVolatile };
