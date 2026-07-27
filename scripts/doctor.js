"use strict";

// `npm run doctor` — why won't this connect to EveJS?
//
// `npm run check` answers "is the gateway usable" with a pass/fail. This
// answers the different question that Docker introduced: WHICH LINK IS BROKEN,
// and what specifically to change. It exists because the failure that matters
// most is silent and counter-intuitive.
//
// ⚠ THE TRAP. EveJS's gateway grants token-less access ONLY to peers whose
// socket address is 127.0.0.1/::1 (evejs-web-gateway authorizeGatewayRequest /
// authorizeGatewayUpgrade). Every container boundary breaks that: Docker's
// published-port forwarder rewrites the peer address to a bridge address, and a
// container-to-container request never had a loopback source to begin with. So
// the moment EITHER side moves into Docker, an otherwise untouched, correct
// configuration starts answering 401 — with the ports open, the process up, and
// the URL right. That reads as "it just won't connect".
//
// The fix is always the same: set the SAME EVEJS_WEB_GATEWAY_TOKEN on both
// sides. This script says so by name rather than leaving it to be deduced.
//
// Runs on the host (`npm run doctor`) and inside the container
// (`docker compose exec bff node scripts/doctor.js`). It uses only built-ins
// and `ws`, never a devDependency, so the production image can run it.

const fs = require("fs");
const net = require("net");
const { WebSocket } = require("ws");

const config = require("../src/config");

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:26002/_evejs-web/v1";
const PROBE_TIMEOUT_MS = 4000;

let failures = 0;
let warnings = 0;

function ok(label, detail) {
  console.log(`  [ ok ] ${label}${detail ? ` — ${detail}` : ""}`);
}

function warn(label, detail) {
  warnings += 1;
  console.log(`  [warn] ${label}${detail ? ` — ${detail}` : ""}`);
}

function bad(label, detail) {
  failures += 1;
  console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
}

function fix(lines) {
  for (const line of [].concat(lines)) {
    console.log(`         ${line}`);
  }
}

function heading(text) {
  console.log(`\n${text}`);
}

/**
 * Are we inside a container?
 *
 * This is the single fact that decides whether the loopback allowance can
 * possibly apply to us, so it is worth getting right rather than guessing from
 * the hostname. /.dockerenv is written by the Docker runtime; the cgroup and
 * mountinfo probes cover podman and cgroup v2 hosts where it is absent.
 */
function detectContainer() {
  if (fs.existsSync("/.dockerenv")) {
    return { inContainer: true, evidence: "/.dockerenv" };
  }
  if (process.env.container) {
    return { inContainer: true, evidence: `container=${process.env.container}` };
  }
  for (const file of ["/proc/1/cgroup", "/proc/self/mountinfo"]) {
    try {
      const text = fs.readFileSync(file, "utf8");
      if (/docker|containerd|podman|kubepods/.test(text)) {
        return { inContainer: true, evidence: file };
      }
    } catch {
      // Not Linux, or not readable. Absence is not evidence either way.
    }
  }
  return { inContainer: false, evidence: null };
}

function parseGatewayUrl() {
  const raw = String(process.env.EVEJS_GATEWAY_URL || DEFAULT_GATEWAY_URL).trim();
  const usingDefault = !process.env.EVEJS_GATEWAY_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { raw, usingDefault, url: null };
  }
  return { raw, usingDefault, url };
}

function tcpProbe(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => done({ reachable: true }));
    socket.once("timeout", () => done({ reachable: false, reason: "timed out" }));
    socket.once("error", (error) =>
      done({ reachable: false, reason: error.code || error.message }));
  });
}

/**
 * GET a gateway route and report the RAW outcome.
 *
 * Deliberately not eveGatewayClient.getJson: that helper normalizes every
 * failure into "unreachable" or "not available", which is exactly the
 * information this script exists to recover. A 401 and a dead port are the same
 * error there and completely different problems here.
 */
async function gatewayGet(baseUrl, routePath, token) {
  const headers = {};
  if (token) {
    headers["x-evejs-web-token"] = token;
  }
  try {
    const response = await fetch(`${baseUrl}${routePath}`, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, error: error.message || String(error) };
  }
}

/**
 * Probe the push-channel upgrade.
 *
 * Worth a separate check: the token-less allowance for WebSocket upgrades is
 * NARROWER than the one for requests (SESSION_EVENTS_PATH only), so a setup can
 * pass every request probe above and still lose live notifications and chat. A
 * 401 here means auth; anything else means auth passed and the gateway simply
 * rejected a probe session id, which is the expected healthy answer.
 */
function websocketProbe(baseUrl, token) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}/session-events`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("userid", "0");
    url.searchParams.set("bridgeSessionID", "evejs-web-poc-doctor-probe");

    const headers = {};
    if (token) {
      headers["x-evejs-web-token"] = token;
    }

    let socket;
    try {
      socket = new WebSocket(url.toString(), { headers });
    } catch (error) {
      resolve({ outcome: "error", detail: error.message });
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      // A socket that never finished its handshake emits 'error' ASYNCHRONOUSLY
      // when torn down, and an 'error' with no listener is a hard process
      // crash in Node. Sink it before touching the socket — removeAllListeners
      // above is exactly what leaves it unhandled otherwise.
      socket.on("error", () => {});
      try {
        socket.terminate();
      } catch {
        // Already gone.
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ outcome: "timeout" }), PROBE_TIMEOUT_MS);

    socket.once("open", () => finish({ outcome: "upgraded" }));
    socket.once("unexpected-response", (_request, response) =>
      finish({ outcome: "rejected", status: response.statusCode }));
    socket.once("error", (error) => {
      const status = /Unexpected server response: (\d+)/.exec(error.message || "");
      finish(status
        ? { outcome: "rejected", status: Number(status[1]) }
        : { outcome: "error", detail: error.message });
    });
  });
}

function describeCombination(inContainer, gatewayHost) {
  const loopbackTarget =
    gatewayHost === "127.0.0.1" || gatewayHost === "localhost" || gatewayHost === "::1";
  if (inContainer) {
    return loopbackTarget
      ? {
        label: "BFF in Docker -> 127.0.0.1",
        broken: "127.0.0.1 inside a container is the CONTAINER itself, not the host.",
        fixes: [
          "EveJS native on the host: EVEJS_GATEWAY_URL=http://host.docker.internal:26002/_evejs-web/v1",
          "EveJS in Docker:          EVEJS_GATEWAY_URL=http://evejs-server:26002/_evejs-web/v1",
          "The compose files already set the right one; this looks like a manual override.",
        ],
      }
      : { label: `BFF in Docker -> ${gatewayHost}` };
  }
  return { label: `BFF on the host -> ${gatewayHost}` };
}

async function main() {
  console.log("EveJS Web POC — connection doctor");

  const container = detectContainer();
  const token = String(process.env.EVEJS_WEB_GATEWAY_TOKEN || "").trim();
  const gateway = parseGatewayUrl();

  heading("Environment");
  ok("this process runs", container.inContainer
    ? `in a container (${container.evidence})`
    : "on the host");
  console.log(`         EVEJS_ROOT ${config.eveRoot}`);

  heading("Gateway target");
  if (!gateway.url) {
    bad("EVEJS_GATEWAY_URL is not a URL", gateway.raw);
    fix("Expected form: http://<host>:26002/_evejs-web/v1");
    return;
  }
  if (gateway.url.pathname.replace(/\/+$/, "") !== "/_evejs-web/v1") {
    bad("EVEJS_GATEWAY_URL does not target the v1 namespace", gateway.url.pathname);
    fix("The BFF rejects this before it ever opens a socket. Append /_evejs-web/v1.");
    return;
  }

  const baseUrl = gateway.url.toString().replace(/\/$/, "");
  const host = gateway.url.hostname;
  const port = Number(gateway.url.port) || (gateway.url.protocol === "https:" ? 443 : 80);
  const combination = describeCombination(container.inContainer, host);

  ok(combination.label, gateway.usingDefault ? `${gateway.raw} (default)` : gateway.raw);
  if (combination.broken) {
    bad("this target cannot resolve to EveJS", combination.broken);
    fix(combination.fixes);
  }

  heading("Reachability");
  const tcp = await tcpProbe(host, port);
  if (tcp.reachable) {
    ok(`TCP ${host}:${port} accepts connections`);
  } else {
    bad(`TCP ${host}:${port} refused`, tcp.reason);
    fix([
      "Is EveJS running? Native: StartServer.bat. Docker: docker compose ps --all in eve.js.",
      container.inContainer
        ? "From a container, the host is host.docker.internal, and on native Linux that address cannot reach a 127.0.0.1-bound host listener at all."
        : "eve.js/compose.yaml publishes 26002 on 127.0.0.1 only — that is deliberate.",
    ]);
    return;
  }

  heading("Gateway authorization");
  const health = await gatewayGet(baseUrl, "/health", token);
  if (health.status === 0) {
    bad("no HTTP response from the gateway", health.error);
    // Do NOT say "that is not the gateway" here. When EveJS runs in Docker the
    // published port is held open by Docker's own port forwarder from the moment
    // the container starts, so the TCP probe above passes for the whole two
    // minutes EveJS spends loading the universe. Still-booting is by far the
    // likelier cause, and the confident wrong answer sends people hunting a
    // port conflict that does not exist.
    fix([
      "Most likely EveJS is still starting — the port opens before it answers,",
      "and a full boot takes a minute or two. Wait, then run this again.",
      "In Docker: docker compose logs --follow server (in the eve.js folder).",
      "If it stays this way, something else is on that port.",
    ]);
    return;
  }
  if (health.status === 401) {
    bad("gateway refused this peer (401)", token
      ? "a token WAS sent, so the two sides disagree on its value"
      : "no token sent, and this peer is not 127.0.0.1 as far as EveJS can see");
    fix(token
      ? [
        "EVEJS_WEB_GATEWAY_TOKEN here must match EveJS's byte for byte.",
        "EveJS reads it from its own process env — set it in eve.js/.env for Docker,",
        "or export it before StartServer.bat for a native run, then restart EveJS.",
      ]
      : [
        "This is the container trap: EveJS allows token-less access only from",
        "127.0.0.1/::1, and Docker rewrites the peer address off loopback.",
        "Set the SAME EVEJS_WEB_GATEWAY_TOKEN in .env here and in eve.js/.env,",
        "then restart BOTH sides. Safe to leave set for host-only runs too.",
      ]);
    return;
  }
  if (health.status !== 200) {
    bad(`gateway /health answered ${health.status}`,
      health.body && health.body.error ? health.body.error : "");
    return;
  }
  // Which RULE let us in is not visible from this side: a token EveJS has not
  // configured is simply ignored, and the request then passes (or not) on the
  // loopback rule instead. Report what we sent, not a guess at what it applied.
  ok("gateway accepted this peer", token
    ? "a token was sent"
    : "no token sent — EveJS accepted this peer as loopback");

  heading("Runtime readiness");
  const status = await gatewayGet(baseUrl, "/status", token);
  if (status.status === 503) {
    warn("EveJS is up but its runtime is not ready yet",
      status.body && status.body.error ? status.body.error : "");
    fix("Normal for the first minute or two after start, and while the universe loads.");
  } else if (status.status !== 200) {
    bad(`gateway /status answered ${status.status}`,
      status.body && status.body.error ? status.body.error : "");
  } else {
    ok("runtime ready",
      `${status.body.accountCount ?? "?"} accounts, ${status.body.characterCount ?? "?"} characters`);
  }

  heading("Push channel (live notifications and chat)");
  const stream = await websocketProbe(baseUrl, token);
  if (stream.outcome === "rejected" && stream.status === 401) {
    bad("WebSocket upgrade refused (401)",
      "the request routes are authorized but the push channel is not");
    fix([
      "The token-less allowance is narrower for upgrades than for requests.",
      "Set EVEJS_WEB_GATEWAY_TOKEN on both sides; without it the UI silently",
      "falls back to polling and loses live notifications and chat.",
    ]);
  } else if (stream.outcome === "upgraded" || stream.outcome === "rejected") {
    ok("WebSocket upgrade authorized",
      stream.outcome === "rejected"
        ? `probe session rejected with ${stream.status}, which is expected`
        : "");
  } else {
    warn("could not probe the push channel", stream.detail || stream.outcome);
  }

  heading("Static game data (names for types, stations, systems)");
  for (const [label, dir] of [
    ["gameStore tables", config.gamestoreDataDir],
    ["SDE JSONL", config.sdeDir],
  ]) {
    if (fs.existsSync(dir)) {
      ok(label, dir);
    } else {
      warn(`${label} not found`, dir);
      fix([
        "Not fatal — reads degrade to empty tables and the UI shows raw ids.",
        container.inContainer
          ? "In Docker, check the mount: compose.yaml binds EVEJS_ROOT at /srv/evejs, the overlay mounts evejs-data at /var/lib/evejs."
          : "Set EVEJS_ROOT to the EveJS checkout, or EVEJS_GAMESTORE_DATA_DIR/EVEJS_SDE_DIR directly.",
      ]);
    }
  }

  heading(failures === 0
    ? (warnings === 0
      ? "All clear — the BFF can reach EveJS."
      : `Connected, with ${warnings} warning(s) above.`)
    : `${failures} blocking problem(s) above.`);
}

main().catch((error) => {
  console.error(`\ndoctor crashed: ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});

process.on("exit", () => {
  if (failures > 0 && !process.exitCode) {
    process.exitCode = 1;
  }
});
