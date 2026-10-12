"use strict";

// The game-port audit (scripts/gamePortAudit.js), put into a test process.
//
// scripts/game-port-audit.js runs the suite with NODE_OPTIONS=--require=<this file>, so that every test process
// loads it first. It does nothing unless that script named where findings go. It then:
//
//   - gives each request a record of its own, which says when the request was answered;
//   - puts the audit between the BFF's routes and the transport they call: the fence every route's transport is
//     wrapped by (src/pilotMutationFence.js) wraps the audit's own wrapper;
//   - in the page's own tests (web/), looks at each pilot's call the page writes as JSON.
//
// Findings go to GAME_PORT_AUDIT_OUT and what was looked at to GAME_PORT_AUDIT_SEEN, one JSON object a line,
// each kind once for a test process. An audit never fails a test: what it cannot do, it leaves undone.

const out = process.env.GAME_PORT_AUDIT_OUT;
const seenAt = process.env.GAME_PORT_AUDIT_SEEN;

if (out && seenAt) {
  const fs = require("node:fs");
  const path = require("node:path");
  const http = require("node:http");
  const Module = require("node:module");
  const { AsyncLocalStorage } = require("node:async_hooks");
  const { createAudit } = require("./gamePortAudit");

  const root = path.resolve(__dirname, "..");
  const testFile = path.relative(root, process.argv[1] || "").replace(/\\/g, "/");
  const requests = new AsyncLocalStorage();
  const written = new Set();
  const once = (file, row) => {
    const line = JSON.stringify(row);
    if (written.has(line)) return;
    written.add(line);
    try { fs.appendFileSync(file, `${line}\n`); } catch { /* left undone */ }
  };
  /** One route is one line: a part of a path that is a number is written ":n". */
  const shortly = (route) => route.split("/").map((part) => (/^\d+$/.test(part) ? ":n" : part)).join("/");

  // The BFF's own tools are loaded when the first call is looked at: this file is loaded before anything.
  let audit = null;
  const theAudit = () => {
    if (audit === null) {
      audit = createAudit({
        retailForm: require("../src/gamePort/retailCalls").retailForm,
        marshalEncode: require("../src/gameProtocol/marshal").marshalEncode,
        isBridgeWritePair: require("../src/bridgeCallPolicy").isBridgeWritePair,
        currentRequest: () => requests.getStore() || null,
        note: ({ kind, when, fn, pair, route, write, status, detail }) => once(out, { kind, when, fn, pair, route: shortly(route), write, status, detail, test: testFile }),
        saw: (route, fn, pair) => once(seenAt, { route: shortly(route), fn, pair }),
      });
    }
    return audit;
  };

  // Each request has a record of its own.
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function emitted(event, req, res) {
    if (event !== "request" || !req || !res || typeof res.end !== "function") return emit.apply(this, arguments);
    const record = { route: `${req.method} ${String(req.url).split("?")[0]}`, answered: false };
    once(seenAt, { route: shortly(record.route), fn: "request", pair: "-" });
    const end = res.end;
    res.end = function ended(...args) { record.answered = true; return end.apply(this, args); };
    return requests.run(record, () => emit.apply(this, arguments));
  };

  // The fence every route's transport is wrapped by: it wraps the audit's wrapper of that transport.
  const load = Module._load;
  Module._load = function loaded() {
    const exported = load.apply(this, arguments);
    if (exported && typeof exported.createPilotMutationFence === "function" && !exported.createPilotMutationFence.gamePortAudited) {
      const make = exported.createPilotMutationFence;
      const audited = (...options) => {
        const fence = make(...options);
        return { ...fence, wrap: (gateway) => theAudit().auditGateway(fence.wrap(gateway)) };
      };
      audited.gamePortAudited = true;
      exported.createPilotMutationFence = audited;
    }
    return exported;
  };

  // The page's own calls, where the page's own tests make them. (A test of the BFF's writes such bodies by hand,
  // some of them wrong on purpose: those are not the page's.)
  if (testFile.startsWith("web/")) {
    const stringify = JSON.stringify;
    JSON.stringify = function stringified(value, ...rest) {
      if (value && typeof value === "object" && typeof value.service === "string" && typeof value.method === "string") {
        try { theAudit().auditPageCall(value); } catch { /* left undone */ }
      }
      return stringify.call(JSON, value, ...rest);
    };
  }
}
