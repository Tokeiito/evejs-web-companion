"use strict";

// What the BFF hands its pilot transport, looked at while the repository's own tests run.
//
// Two defects were met by accident in October 2026, each only on the game port, and neither by any test:
//
//   unsendable     A route handed the transport a plain object as an argument. The web gateway takes one as
//                  it is; the game port's marshal can write none, and answered 400 CALL_INVALID ("an argument
//                  that cannot be sent"). The Industry window could neither preview nor install a job.
//   after-answer   A route answered and then made its last call. A pilot has one write at a time
//                  (src/pilotMutationFence.js), so the write that followed the answer at once was refused
//                  CHARACTER_IN_USE.
//
// This looks for both, in every call any test causes the BFF to make: each call's arguments are reshaped as the
// game port's ledger reshapes them (src/gamePort/retailCalls.js) and given to the game port's own marshal; and
// each call is timed against the answer of the request it was made for. The page's own calls
// (POST /api/bridge/call) are looked at where the page's tests make them.
//
// It is put into the test processes by scripts/game-port-audit-hook.js, and run and judged by
// scripts/game-port-audit.js. It changes nothing of what a test does or is answered.
//
// ⚠ IT SEES WHAT THE TESTS SEND. A route that passes on what the browser gave it is as sendable as its test's
// body. What matters for a window is what the page sends, which the page's own tests have.

const fs = require("node:fs");
const path = require("node:path");

/** Where a call was made for no request of the browser's: a hosted bot's, or the BFF's own keeping. */
const NO_REQUEST = "(no request)";
/** The page's own call, by the generic route, as the page's tests make it. */
const PAGES_OWN_CALL = "(the page's own call)";

/** The transport's three calls of a pilot's: each is (service, method, args, kwargs, ...). */
const CALLS = new Set(["callMethod", "bindObject", "callBoundMethod"]);
/** A bound object's method that changes something, as src/pilotMutationFence.js tells one. */
const boundWrite = (method) => !/^(Get|List|Query|Is|Has|Check)/.test(String(method));
const said = (error) => String((error && error.message) || error).slice(0, 260);

/**
 * `currentRequest()` answers the record of the request being served ({ route, answered }), or null.
 * `note(finding)` and `saw(route, fn, pair)` take what is found and what was looked at.
 */
function createAudit({ retailForm, marshalEncode, isBridgeWritePair, currentRequest, note, saw }) {
  /** Whether the game port could write this call: reshaped as its ledger reshapes it, then marshalled. */
  function written(fn, service, method, args, kwargs, route) {
    const pair = `${service}.${method}`;
    let form = { args: Array.isArray(args) ? args : [], kwargs: kwargs || null, status: fn === "bindObject" ? "bind" : "as it came" };
    if (fn !== "bindObject") {
      try {
        form = retailForm(service, method, args, kwargs, {});
      } catch (error) {
        note({ kind: "shape-threw", fn, pair, route, detail: said(error) });
      }
    }
    try {
      marshalEncode(form.args);
      marshalEncode(Object.values(form.kwargs || {}));
    } catch (error) {
      note({ kind: "unsendable", fn, pair, route, status: form.status, detail: said(error) });
    }
  }

  function auditGateway(gateway) {
    return new Proxy(gateway, { get(target, name) {
      const fn = target[name];
      if (typeof fn !== "function" || !CALLS.has(String(name))) return fn;
      return (...args) => {
        const [service, method, given, kwargs] = args;
        const pair = `${service}.${method}`;
        const request = currentRequest() || null;
        const route = request ? request.route : NO_REQUEST;
        saw(route, name, pair);
        written(name, service, method, given, kwargs, route);
        const write = name === "callMethod" ? isBridgeWritePair(service, method) : name === "callBoundMethod" && boundWrite(method);
        const begunAfter = request !== null && request.answered;
        if (begunAfter) note({ kind: "after-answer", when: "begun", fn: name, pair, route, write });
        const result = fn.apply(target, args);
        if (request !== null && !begunAfter && result && typeof result.then === "function") {
          const over = () => { if (request.answered) note({ kind: "after-answer", when: "pending", fn: name, pair, route, write }); };
          result.then(over, over);
        }
        return result;
      };
    } });
  }

  /** A value the page is writing as JSON: where it is a pilot's call of the page's own, it is looked at. */
  function auditPageCall(value) {
    if (!value || typeof value !== "object" || value.pilot !== true || typeof value.service !== "string" || typeof value.method !== "string" || !Array.isArray(value.args)) return;
    saw(PAGES_OWN_CALL, "page", `${value.service}.${value.method}`);
    // What the BFF's parser makes of it: the page's body, read back.
    const body = JSON.parse(JSON.stringify({ args: value.args, kwargs: value.kwargs ?? null }));
    written("page", value.service, value.method, body.args, body.kwargs, PAGES_OWN_CALL);
  }

  return { auditGateway, auditPageCall };
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The page's own sources as one text: every source under web/src but its tests and their fixtures. A route is
 * the page's where any of them names it: its api.ts names most, and not the generic call nor the event stream.
 */
function pageSources(root) {
  const texts = [];
  const walk = (folder) => {
    const inside = fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const each of inside) {
      const at = path.join(folder, each.name);
      if (each.isDirectory()) walk(at);
      else if (/\.(ts|svelte|js)$/.test(each.name) && !/\.test\.(ts|js)$/.test(each.name) && !/Fixtures\.ts$/.test(each.name)) texts.push(fs.readFileSync(at, "utf8"));
    }
  };
  walk(path.join(root, "web", "src"));
  return texts.join("\n");
}

/**
 * The BFF's routes under /api/, as its app lists them (scripts/appRoutes.js: the app's own table, in the order a
 * request is matched in; the text of its source has not every one), each with whether the page's sources name it
 * by the whole path (a "${...}" where the route has a ":param", and ending where the path ends), and what paths
 * it takes: as the app takes one, whatever its case and with a last "/" or without.
 */
function routePatterns(table, pageSource) {
  const code = pageSource.split(/\r?\n/).filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  return table.filter((route) => route.path.startsWith("/api/")).map(({ method, path: pattern }) => {
    const parts = pattern.split("/");
    const inThePage = new RegExp("[\"`]" + parts.map((part) => (part.startsWith(":") ? "\\$\\{[^}]+\\}" : escaped(part))).join("/") + "(?:[\"`?]|\\$\\{)");
    const taken = new RegExp("^" + parts.map((part) => (part.startsWith(":") ? "[^/]+" : escaped(part))).join("/") + "/?$", "i");
    return { method, pattern, named: inThePage.test(code), matches: (url) => taken.test(url) };
  });
}

/** The route a request was for, by the BFF's own pattern: "POST /api/bridge/planets/:planetID/launch". */
function routeOf(asked, routes) {
  if (asked === PAGES_OWN_CALL) return { route: asked, named: true, found: null };
  const [method, url = ""] = String(asked).split(" ");
  const found = routes.find((route) => route.method === method && route.matches(url)) || null;
  return found ? { route: `${found.method} ${found.pattern}`, named: found.named, found } : { route: asked, named: false, found: null };
}

/** Findings gathered: one row for each kind of finding of each call of each route, with the tests it was met in. */
function gather(findings, routes) {
  const rows = new Map();
  for (const finding of findings) {
    const { route, named } = routeOf(finding.route, routes);
    const when = finding.when ?? null;
    const key = `${finding.kind} ${when ?? ""} ${route} ${finding.fn} ${finding.pair}`;
    const row = rows.get(key) || { kind: finding.kind, when, fn: finding.fn, route, named, pair: finding.pair, write: finding.write ?? null, status: finding.status ?? null, detail: finding.detail ?? "", tests: [] };
    if (finding.test && !row.tests.includes(finding.test)) row.tests.push(finding.test);
    rows.set(key, row);
  }
  return [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => ({ ...row, tests: row.tests.sort() }));
}

/**
 * A finding is expected only where it is listed (by kind, route and call) AND nothing of the page asks its
 * route: what a window can meet is never expected. A listed finding that was not met is `gone`.
 */
function judge(rows, known) {
  const listed = (row) => known.find((each) => each.kind === row.kind && each.route === row.route && each.pair === row.pair) || null;
  const expected = [];
  const unexpected = [];
  for (const row of rows) {
    const entry = listed(row);
    if (entry && !row.named) expected.push({ ...row, why: entry.why });
    else unexpected.push(row);
  }
  const gone = known.filter((each) => !rows.some((row) => each.kind === row.kind && each.route === row.route && each.pair === row.pair));
  return { expected, unexpected, gone };
}

/**
 * What was looked at, against what a window can ask: the routes the page names (asked by a test at all; and with
 * a call of the transport's looked at), and the writes the page makes itself (made by a test of the page's).
 */
function coverage(seen, routes, pageWritePairs) {
  const named = routes.filter((route) => route.named);
  const of = (route) => seen.filter((each) => { const [method, url = ""] = String(each.route).split(" "); return method === route.method && route.matches(url); });
  const label = (route) => `${route.method} ${route.pattern}`;
  const asked = named.filter((route) => of(route).length > 0);
  const called = named.filter((route) => of(route).some((each) => CALLS.has(each.fn)));
  const pageCalls = new Set(seen.filter((each) => each.fn === "page").map((each) => each.pair));
  return {
    named: named.length,
    asked: asked.length,
    called: called.length,
    notAsked: named.filter((route) => !asked.includes(route)).map(label),
    askedWithNoCall: asked.filter((route) => !called.includes(route)).map(label),
    pageCalls: pageCalls.size,
    pageWritesNotSeen: pageWritePairs.filter((pair) => !pageCalls.has(pair)),
    withNoRequest: new Set(seen.filter((each) => each.route === NO_REQUEST).map((each) => each.pair)).size,
  };
}

module.exports = { NO_REQUEST, PAGES_OWN_CALL, coverage, createAudit, gather, judge, pageSources, routePatterns };
