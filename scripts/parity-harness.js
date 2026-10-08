"use strict";

// The parity harness: the same reads through both transports, compared.
//
// For one docked character it makes every read the BFF makes that it can make
// without a browser's input, first through the web gateway and then through the
// game port, and compares each pair of answers (scripts/parity-compare.js)
// after the game port's has been through src/gamePort/bridgeJson.js.
//
//   node scripts/parity-harness.js <accountName> <characterID> [reportPath]
//
// It answers the plan's Phase 2 question: can the browser's decoders, written
// against the gateway's JSON, read the game port's answers?
//
// ⚠ ONE TRANSPORT AT A TIME. A character is in game on one session only, so the
// gateway session is released, and seen offline, before the game port selects.
//
// ⚠ It SELECTS the character twice and logs it off twice. Use a docked
// character nobody is flying. It only makes calls the BFF classes as reads.
//
// The calls come from the BFF's own source: every heldTopLevelCall in
// src/server.js whose arguments are constants or facts about the session
// (the character, its corporation, station, ship and system). Calls that need
// something a player chose are listed in the report as not compared.

const fs = require("node:fs");
const path = require("node:path");
const gateway = require("../src/eveGatewayClient");
const { BRIDGE_WRITE_PAIR_KEYS } = require("../src/bridgeCallPolicy");
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");
const { notificationToBridgeJson, sessionChangeToBridgeJson, wireToBridgeJson } = require("../src/gamePort/bridgeJson");
const { compare, findUnmarshalable, kindsOf, openEnvelope, verdictOf } = require("./parity-compare");
const { boundObjectID, eveCommit } = require("./capture-game-frames");
const contract = require("../contracts/evejs-web-bridge-contract.json");

const WEB_ROOT = path.resolve(__dirname, "..");
const DEFAULT_REPORT = path.join(WEB_ROOT, "docs", "game-port-parity-report.md");
const SELECT_SETTLE_MS = 3000;
/** invGroups 15 (Station), const.containerHangar, and the hangar and cargo flags. */
const [GROUP_STATION, CONTAINER_HANGAR, FLAG_HANGAR, FLAG_CARGO] = [15, 10004, 4, 5];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── the reads ────────────────────────────────────────────────────────────────

/** What a name in the BFF's argument list stands for, when it is a fact about the session. */
const SESSION_FACTS = {
  charID: "characterID",
  characterID: "characterID",
  "held.characterID": "characterID",
  corporationID: "corporationID",
  corpID: "corporationID",
  systemID: "solarSystemID",
  solarSystemID: "solarSystemID",
  stationID: "stationID",
  shipID: "shipID",
};

/**
 * Stand-ins for a few arguments a player would choose, where one is obviously
 * safe: the pilot's own IDs, Tritanium, this month. Both transports are given
 * the same ones, so the comparison holds whatever the server makes of them.
 */
const STAND_INS = {
  typeID: () => 34,
  ownerID: (facts) => facts.characterID,
  locationID: (facts) => facts.stationID,
  itemID: (facts) => facts.shipID,
  "Number(held.corporationID) || 0": (facts) => facts.corporationID,
  month: () => new Date().getUTCMonth() + 1,
  year: () => new Date().getUTCFullYear(),
};

/** Split "a, [b, c], d" on its top-level commas. */
function splitArguments(source) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of source) {
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth -= 1;
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** An argument list as written in the BFF, as values; null when it needs more than the session. */
function resolveArguments(source, facts) {
  if (!source.startsWith("[") || !source.endsWith("]")) return null;
  const values = [];
  for (const part of splitArguments(source.slice(1, -1))) {
    if (/^-?\d+(\.\d+)?$/.test(part)) values.push(Number(part));
    else if (part === "null") values.push(null);
    else if (part === "true" || part === "false") values.push(part === "true");
    else if (part in SESSION_FACTS && facts[SESSION_FACTS[part]] !== undefined && facts[SESSION_FACTS[part]] !== null) values.push(facts[SESSION_FACTS[part]]);
    else if (part in STAND_INS && STAND_INS[part](facts) !== null && STAND_INS[part](facts) !== undefined) values.push(STAND_INS[part](facts));
    else return null;
  }
  return values;
}

/** Every read the BFF makes at top level, with each argument list it is written with. */
function readCallSites(serverSource = fs.readFileSync(path.join(WEB_ROOT, "src", "server.js"), "utf8")) {
  const pattern = /heldTopLevelCall\(\s*[\w.]+,\s*[\w.]+,\s*"(\w+)",\s*"(\w+)",\s*(\[[^\]]*\]|[\w.]+)/g;
  const writes = new Set(BRIDGE_WRITE_PAIR_KEYS);
  const allowed = new Set(contract.gatewayAllowlist.pairs);
  const sites = new Map();
  for (const match of serverSource.matchAll(pattern)) {
    const pair = `${match[1]}.${match[2]}`;
    if (writes.has(pair) || !allowed.has(pair)) continue;
    if (!sites.has(pair)) sites.set(pair, new Set());
    sites.get(pair).add(match[3].replace(/\s+/g, " "));
  }
  return sites;
}

/**
 * Reads on bound objects: the inventory, whose rows are the packed rows no
 * top-level read here returns. Each transport reaches the object its own way:
 * the gateway binds in one step as the BFF does (hangarBindSpec, cargoBindSpec
 * in src/server.js), the game port as the retail client does (bind the broker
 * for the station, then ask it for the inventory).
 */
function boundReads(facts) {
  if (!facts.stationID || !facts.shipID) return [];
  const broker = async (session, held) => {
    held.broker ??= (await session.bind("invbroker", [facts.stationID, GROUP_STATION])).objectID;
    return held.broker;
  };
  const hangar = {
    gateway: (via) => via.bind("hangar", "invbroker", "GetInventory", [facts.stationID], null),
    gamePort: async (session, held) => {
      held.hangar ??= boundObjectID(await session.callBound(await broker(session, held), "GetInventory", [CONTAINER_HANGAR]));
      return held.hangar;
    },
  };
  const cargo = {
    gateway: (via) => via.bind("cargo", "invbroker", "GetInventoryFromId", [facts.shipID], { passive: 0 }),
    gamePort: async (session, held) => {
      held.cargo ??= boundObjectID(await session.callBound(await broker(session, held), "GetInventoryFromId", [facts.shipID], { passive: 0 }));
      return held.cargo;
    },
  };
  const read = (label, object, method, args) => ({
    key: `invbroker.${method} (${label})`,
    pair: `invbroker.${method}`,
    args,
    gateway: async (via) => via.callBound("invbroker", method, args, await object.gateway(via)),
    gamePort: async (session, held) => session.callBound(await object.gamePort(session, held), method, args),
  });
  return [
    read("station hangar", hangar, "List", [FLAG_HANGAR]),
    read("station hangar", hangar, "GetCapacity", [FLAG_HANGAR]),
    read("ship cargo", cargo, "List", [FLAG_CARGO]),
    read("ship cargo", cargo, "GetCapacity", [FLAG_CARGO]),
  ];
}

/**
 * The plan: for every read the gateway allows, either how to make it on each
 * transport, or the reason it is not compared.
 */
function planReads(facts, sites = readCallSites()) {
  const writes = new Set(BRIDGE_WRITE_PAIR_KEYS);
  const reads = [];
  const skipped = [];
  for (const pair of contract.gatewayAllowlist.pairs) {
    if (writes.has(pair)) continue;
    const [service, method] = pair.split(".");
    const written = sites.get(pair);
    if (!written) {
      skipped.push({ pair, reason: "not a top-level call in the BFF (a bound object's method, or reached another way)" });
      continue;
    }
    const args = [...written].map((source) => resolveArguments(source, facts)).find((values) => values !== null);
    if (!args) {
      skipped.push({ pair, reason: "its arguments are a player's choice" });
      continue;
    }
    reads.push({
      key: pair,
      pair,
      args,
      gateway: (via) => via.call(service, method, args),
      gamePort: (session) => session.call(service, method, args),
    });
  }
  const bound = boundReads(facts);
  // A pair read on a bound object here was "not a top-level call" above.
  const covered = new Set(bound.map((read) => read.pair));
  return { reads: [...reads, ...bound], skipped: skipped.filter((entry) => !covered.has(entry.pair)) };
}

// ── the two passes ───────────────────────────────────────────────────────────

const failure = (error) => ({
  ok: false,
  code: String(error.code ?? error.name ?? "ERROR"),
  message: String(error.message ?? "").slice(0, 300),
  // The game port's refusal reason, put together the way the gateway's message is.
  reason: error.refusal ? error.refusal.reason : null,
});

async function untilOffline(accountID, characterID, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await gateway.getCharacterStatus(accountID, characterID);
    if (status && status.online === false) return;
    await sleep(500);
  }
  throw new Error("The character did not go offline between the two passes.");
}

function factsFromGateway(session, characterID) {
  const number = (...names) => {
    for (const name of names) {
      const value = Number(session[name]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  };
  return {
    characterID,
    corporationID: number("corporationID", "corpid", "corpID"),
    stationID: number("stationID", "stationid"),
    solarSystemID: number("solarSystemID", "solarsystemid2", "solarsystemid"),
    shipID: number("shipID", "shipid", "activeShipID"),
  };
}

async function gatewayPass({ accountID, characterID }) {
  const session = { userid: accountID };
  const selected = await gateway.selectCharacter([characterID, null, true], null, session);
  const notifications = [...selected.notifications];
  const answers = new Map();
  try {
    const facts = factsFromGateway(selected.session, characterID);
    const { reads, skipped } = planReads(facts);
    const handles = new Map();
    const keep = (outcome) => {
      notifications.push(...outcome.notifications);
      return outcome;
    };
    const via = {
      call: async (service, method, args) => keep(await gateway.callMethod(service, method, args, null, session, selected.bridgeSessionID)).result,
      bind: async (name, service, method, args, kwargs) => {
        if (!handles.has(name)) {
          handles.set(name, keep(await gateway.bindObject(service, method, args, kwargs, session, selected.bridgeSessionID)).boundHandle);
        }
        return handles.get(name);
      },
      callBound: async (service, method, args, handle) =>
        keep(await gateway.callBoundMethod(service, method, args, null, session, selected.bridgeSessionID, handle)).result,
    };
    for (const read of reads) {
      try {
        answers.set(read.key, { ok: true, value: await read.gateway(via) });
      } catch (error) {
        answers.set(read.key, failure(error));
      }
    }
    return { facts, reads, skipped, answers, notifications };
  } finally {
    await gateway.releaseBridgeSession(selected.bridgeSessionID, session).catch(() => {});
    await untilOffline(accountID, characterID);
  }
}

async function gamePortPass({ accountName, characterID, reads, endpoint = gameEndpoint() }) {
  const session = new GamePortSession({ transport: await connectTcp(endpoint) });
  const notifications = [];
  session.onNotification((notification) => notifications.push(notificationToBridgeJson(notification)));
  const answers = new Map();
  try {
    await session.login(accountName, "");
    // Listen only from here: the gateway's select reports the character's own
    // session change, not the login's.
    session.onSessionChange((changes) => notifications.push(sessionChangeToBridgeJson(changes)));
    await session.call("charUnboundMgr", "SelectCharacterID", [characterID]);
    await sleep(SELECT_SETTLE_MS);
    const held = {};
    for (const read of reads) {
      try {
        answers.set(read.key, { ok: true, value: wireToBridgeJson(await read.gamePort(session, held)) });
      } catch (error) {
        answers.set(read.key, failure(error));
      }
      if (session.closed) break;
    }
    await sleep(500);
    return { answers, notifications, dropped: session.closed ? session.closeReason.message : null };
  } finally {
    session.close();
  }
}

// ── the comparison ───────────────────────────────────────────────────────────

function compareAnswers(reads, fromGateway, fromGamePort) {
  return reads.map((read) => {
    const { key, pair, args } = read;
    const [a, b] = [fromGateway.get(key), fromGamePort.get(key)];
    if (!b) return { key, pair, args, verdict: "not reached" };
    if (!a.ok && !b.ok) {
      // The gateway's CALL_REFUSED message is the handler's reason, and so is ours.
      const alike = a.code === "CALL_REFUSED" && b.reason !== null && a.message === b.reason;
      return {
        key, pair, args,
        verdict: alike ? "refused alike" : "refused differently",
        gateway: `${a.code}: ${a.message}`,
        gamePort: `${b.code}: ${b.reason ?? b.message}`,
      };
    }
    if (!a.ok || !b.ok) {
      return { key, pair, args, verdict: "refused by one", gateway: a.ok ? "answered" : `${a.code}: ${a.message}`, gamePort: b.ok ? "answered" : `${b.code}: ${b.message}` };
    }
    // The gateway hands a cached answer over in its envelope, which the browser
    // opens. A reference into the object cache it cannot open at all; the game
    // port's session can.
    const opened = openEnvelope(a.value);
    if (opened.envelope === "reference") return { key, pair, args, verdict: "gained", envelope: "reference" };
    // A handler whose answer the server cannot marshal: the gateway prints it,
    // the game port gets None.
    const unmarshalable = b.value === null ? findUnmarshalable(opened.value) : null;
    if (unmarshalable) return { key, pair, args, verdict: "server cannot marshal", where: unmarshalable, gatewayAnswer: JSON.stringify(opened.value).slice(0, 160) };
    const differences = compare(opened.value, b.value);
    return { key, pair, args, verdict: verdictOf(differences), kinds: kindsOf(differences), differences, envelope: opened.envelope };
  });
}

/** The notifications of a pass, as kind and name with how many of each. */
function notificationCounts(notifications) {
  const counts = new Map();
  for (const notification of notifications) {
    const key = `${notification.kind} ${notification.method}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ── the report ───────────────────────────────────────────────────────────────

const code = (value) => `\`${value}\``;
const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");

function renderReport({ accountName, characterID, facts, results, skipped, notifications, commit, when }) {
  const by = (verdict) => results.filter((result) => result.verdict === verdict);
  const lines = [];
  lines.push("# Game-port parity report", "");
  lines.push(
    `Generated by \`scripts/parity-harness.js\` on ${when}, as ${accountName} / character ${characterID}, docked at station ${facts.stationID}` +
      `${commit ? `, against eve.js \`${commit}\`` : ""}. Do not edit by hand; run the harness again.`,
    "",
  );
  lines.push(
    "Each read was made through the web gateway, then through the game port, and the two answers compared after the game port's was mapped by " +
      "`src/gamePort/bridgeJson.js`. What the kinds of difference mean is at the top of `scripts/parity-compare.js`; what is being done about " +
      "each is in `docs/game-port-transport-plan.md`, Phase 2.",
    "",
  );

  lines.push("## Summary", "");
  lines.push("| Verdict | Reads | What it means for a decoder |", "|---|---|---|");
  const row = (verdict, meaning) => lines.push(`| ${verdict} | ${by(verdict).length} | ${meaning} |`);
  row("identical", "The same JSON.");
  row("moved", "The same shape; some values or row counts changed between the two reads.");
  row("tolerated", "Differs only in spellings the shared readers in `wire.ts` accept either of.");
  row("divergent", "A decoder written against the gateway could read this differently.");
  row("gained", "The gateway answers with a cache reference the browser cannot follow. The game port returns the object.");
  row("server cannot marshal", "The handler returns something the server's marshaller refuses, so the game port gets None. A server defect: the retail client gets None too.");
  row("refused alike", "The server refused on both transports, and each reports the same reason.");
  row("refused differently", "The server refused on both, and the two report different reasons.");
  row("refused by one", "One transport answered and the other refused.");
  row("not reached", "The game-port session ended first.");
  lines.push(`| not compared | ${skipped.length} | Not callable without a player's input, or not a top-level call. |`);
  lines.push(`| **total** | **${results.length + skipped.length}** | ${results.length} compared. The inventory reads are counted once per inventory they were made on. |`, "");

  const kinds = new Map();
  for (const result of results) {
    for (const [kind] of result.kinds ?? []) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  if (kinds.size > 0) {
    lines.push("Kinds of difference, by how many reads show each:", "", "| Kind | Reads |", "|---|---|");
    for (const [kind, count] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${kind} | ${count} |`);
    lines.push("");
  }

  const detail = (title, verdict, limit) => {
    const rows = by(verdict);
    if (rows.length === 0) return;
    lines.push(`## ${title} (${rows.length})`, "");
    for (const result of rows) {
      const withArgs = result.args.length ? ` with ${code(JSON.stringify(result.args))}` : "";
      lines.push(`**${code(result.key)}**${withArgs} — ${result.kinds.map(([kind, count]) => `${kind} ×${count}`).join(", ")}`, "");
      lines.push("| Where | Kind | Gateway | Game port |", "|---|---|---|---|");
      const serious = result.differences.filter((difference) => difference.kind !== "value" && difference.kind !== "count");
      for (const difference of (serious.length > 0 ? serious : result.differences).slice(0, limit)) {
        lines.push(`| ${code(cell(difference.path))} | ${difference.kind} | ${code(cell(difference.gateway))} | ${code(cell(difference.wire))} |`);
      }
      lines.push("");
    }
  };
  detail("Divergent", "divergent", 6);
  detail("Tolerated", "tolerated", 3);

  const unmarshalable = by("server cannot marshal");
  if (unmarshalable.length > 0) {
    lines.push(`## The server cannot marshal the answer (${unmarshalable.length})`, "", "| Read | Where | What the gateway printed |", "|---|---|---|");
    for (const result of unmarshalable) lines.push(`| ${code(result.key)} | ${code(result.where)} | ${code(cell(result.gatewayAnswer))} |`);
    lines.push("");
  }
  for (const [title, verdict] of [["Refused by one transport", "refused by one"], ["Refused differently", "refused differently"], ["Refused alike", "refused alike"]]) {
    const rows = by(verdict);
    if (rows.length === 0) continue;
    lines.push(`## ${title} (${rows.length})`, "", "| Read | Gateway | Game port |", "|---|---|---|");
    for (const result of rows) lines.push(`| ${code(result.key)} | ${cell(result.gateway)} | ${cell(result.gamePort)} |`);
    lines.push("");
  }

  const enveloped = results.filter((result) => result.envelope === "inline");
  if (enveloped.length > 0) {
    lines.push(
      `## Cached answers the gateway wraps (${enveloped.length})`,
      "",
      "The gateway returns these inside a `CachedMethodCallResult` envelope and the browser opens it. The game port's session returns the answer " +
        "itself. They were compared after opening the envelope, so a decoder has to accept the answer without one.",
      "",
      enveloped.map((result) => `${code(result.key)} (${result.verdict})`).join(", "),
      "",
    );
  }
  for (const [title, verdict] of [["Gained", "gained"], ["Identical", "identical"], ["Moved", "moved"]]) {
    const rows = by(verdict);
    if (rows.length > 0) lines.push(`## ${title} (${rows.length})`, "", rows.map((result) => code(result.key)).join(", "), "");
  }

  lines.push("## Notifications", "");
  lines.push(
    "What each transport delivered over the whole pass, by kind and name, and how the first of each compares once the game port's is mapped:",
    "",
    "| Notification | Gateway | Game port | First of each |",
    "|---|---|---|---|",
  );
  const [fromGateway, fromGamePort] = [notificationCounts(notifications.gateway), notificationCounts(notifications.gamePort)];
  const first = (list, key) => list.find((notification) => `${notification.kind} ${notification.method}` === key);
  const pushedDifferences = [];
  for (const key of [...new Set([...fromGateway.keys(), ...fromGamePort.keys()])].sort()) {
    const [a, b] = [first(notifications.gateway, key), first(notifications.gamePort, key)];
    let verdict = "only one transport delivered it";
    if (a && b) {
      const differences = compare(JSON.parse(JSON.stringify(a)), b);
      verdict = verdictOf(differences);
      for (const difference of differences.filter((entry) => entry.kind !== "value" && entry.kind !== "count").slice(0, 4)) {
        pushedDifferences.push({ key, ...difference });
      }
    }
    lines.push(`| ${code(key)} | ${fromGateway.get(key) ?? 0} | ${fromGamePort.get(key) ?? 0} | ${verdict} |`);
  }
  lines.push("");
  if (pushedDifferences.length > 0) {
    lines.push("| Notification | Where | Kind | Gateway | Game port |", "|---|---|---|---|---|");
    for (const difference of pushedDifferences) {
      lines.push(`| ${code(difference.key)} | ${code(cell(difference.path))} | ${difference.kind} | ${code(cell(difference.gateway))} | ${code(cell(difference.wire))} |`);
    }
    lines.push("");
  }

  lines.push(`## Not compared (${skipped.length})`, "");
  const reasons = new Map();
  for (const entry of skipped) {
    if (!reasons.has(entry.reason)) reasons.set(entry.reason, []);
    reasons.get(entry.reason).push(entry.pair);
  }
  for (const [reason, pairs] of reasons) lines.push(`**${pairs.length}: ${reason}.**`, "", pairs.map(code).join(", "), "");
  return `${lines.join("\n")}\n`;
}

async function run({ accountName, characterID, reportPath = DEFAULT_REPORT, log = console.log }) {
  const account = await gateway.getAccount(accountName);
  if (!account) throw new Error(`There is no account named ${accountName}.`);
  const accountID = Number(account.accountID);
  await untilOffline(accountID, characterID, 2).catch(() => {
    throw new Error("That character is online. The harness only takes a character nobody is flying.");
  });

  log("gateway pass...");
  const viaGateway = await gatewayPass({ accountID, characterID });
  log(`  ${viaGateway.reads.length} reads made, ${viaGateway.skipped.length} not callable`);
  log("game-port pass...");
  const viaGamePort = await gamePortPass({ accountName, characterID, reads: viaGateway.reads });
  if (viaGamePort.dropped) log(`  the game-port session ended early: ${viaGamePort.dropped}`);
  await untilOffline(accountID, characterID);

  const results = compareAnswers(viaGateway.reads, viaGateway.answers, viaGamePort.answers);
  const notifications = { gateway: viaGateway.notifications, gamePort: viaGamePort.notifications };
  const report = renderReport({
    accountName,
    characterID,
    facts: viaGateway.facts,
    results,
    skipped: viaGateway.skipped,
    notifications,
    commit: eveCommit(),
    when: new Date().toISOString().slice(0, 10),
  });
  fs.writeFileSync(reportPath, report, "utf8");
  const counts = new Map();
  for (const result of results) counts.set(result.verdict, (counts.get(result.verdict) ?? 0) + 1);
  log([...counts.entries()].map(([verdict, count]) => `${count} ${verdict}`).join(", "));
  log(`Report written to ${reportPath}`);
  return { results, skipped: viaGateway.skipped, notifications, answers: { gateway: viaGateway.answers, gamePort: viaGamePort.answers } };
}

if (require.main === module) {
  const [accountName, characterID, reportPath] = process.argv.slice(2);
  if (!accountName || !/^\d+$/.test(characterID ?? "")) {
    console.error("Usage: node scripts/parity-harness.js <accountName> <characterID> [reportPath]");
    process.exitCode = 1;
  } else {
    run({ accountName, characterID: Number(characterID), reportPath }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { compareAnswers, planReads, readCallSites, renderReport, resolveArguments, run, splitArguments };
