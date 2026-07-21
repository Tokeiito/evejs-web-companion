"use strict";

// A build asset that is not on disk must answer 404 — never the SPA shell.
//
// Why this exists. R45 moved the Svelte app to "/" and left the catch-all
// (`app.get(/.*/)`) returning `index.html` for anything unmatched. That is
// correct for client-side routes and WRONG for `/assets/*`: a rebuild changes
// every hashed filename, so a browser still holding the previous `index.html`
// requests the old bundle, the catch-all hands it a document with a 200 and
// `text/html`, and the page dies on `Unexpected token '<'` — a confusing
// failure instead of a clean 404 it could recover from by reloading.
//
// Measured live on 2026-07-21 before the fix: a rebuild replaced
// `index-CR6BU842.js`, the file was gone from `public/dist/assets/`, and the
// deleted name still answered `200 text/html`.
//
// This is the same guarantee the icon cache has carried since R27, for the same
// reason and by the same mechanism (`fallthrough: false`), which is why the two
// mounts should keep looking alike.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createApp } = require("../src/server");

function noopStore() {
  return {};
}

async function withServer(run) {
  const app = createApp({
    eveStore: noopStore(),
    eveGatewayClient: {},
    webAuth: {},
    staticData: {},
    errorLogger() {},
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function get(base, path) {
  const response = await fetch(base + path);
  return {
    status: response.status,
    type: response.headers.get("content-type") || "",
    body: await response.text(),
  };
}

test("a missing build asset 404s instead of returning the SPA shell", async () => {
  await withServer(async (base) => {
    const missing = await get(base, "/assets/index-DoesNotExist9999.js");

    assert.notEqual(
      missing.status,
      200,
      "a bundle that is not on disk must not answer 200 — that is the stale-index.html trap",
    );
    assert.equal(missing.status, 404);
    assert.ok(
      !missing.body.startsWith("<!doctype html"),
      `a missing asset must not be served the SPA document; got: ${missing.body.slice(0, 60)}`,
    );
    assert.ok(
      !/text\/html/.test(missing.type),
      `a missing asset must not be typed text/html; got: ${missing.type}`,
    );
  });
});

test("a client-side route still gets the SPA shell", async () => {
  await withServer(async (base) => {
    // The complement, so the fix above can never be "404 everything". A deep
    // link is not a file and MUST fall through to the document.
    const route = await get(base, "/industry/jobs");
    assert.equal(route.status, 200);
    assert.ok(
      route.body.startsWith("<!doctype html"),
      "a client-side route must still receive the SPA document",
    );
  });
});
