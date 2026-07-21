"use strict";

// R45: the legacy vanilla app is deleted and the Svelte SPA is served at "/".
//
// Every assertion here checks CONTENT, never bare status. This whole goal
// exists because `express.static` + the catch-all handed back `index.html`
// with a 200 for routes that had been dead since R9b, so a 200 hid a broken
// app for thirty goals. A test that only asserted `res.status === 200` would
// have passed the entire time the app was dead.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

// Point the server at a scratch data dir so the real icon cache, sessions and
// gameplay data are never touched by this test.
const originalDataDir = process.env.EVEJS_WEB_POC_DATA_DIR;
const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-static-"));
process.env.EVEJS_WEB_POC_DATA_DIR = temporaryDataDir;

const iconCacheDir = path.join(temporaryDataDir, "icon-cache");
fs.mkdirSync(iconCacheDir, { recursive: true });
// A real 1x1 PNG, so the "an icon still serves" case is a genuine image and
// not a text file that happens to be named .png.
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
fs.writeFileSync(path.join(iconCacheDir, "type-587-64.png"), onePixelPng);

const { startServer } = require("../src/server");

let server;
let origin;

test.before(async () => {
  server = startServer({ port: 0, host: "127.0.0.1", silent: true });
  await new Promise((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) {
    server.close();
  }
  if (originalDataDir === undefined) {
    delete process.env.EVEJS_WEB_POC_DATA_DIR;
  } else {
    process.env.EVEJS_WEB_POC_DATA_DIR = originalDataDir;
  }
  fs.rmSync(temporaryDataDir, { recursive: true, force: true });
});

test("the root serves the SPA shell, not the deleted legacy app", async () => {
  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/html/);
  const html = await response.text();

  // The SPA's own markers.
  assert.match(html, /<div id="app">/);
  assert.match(html, /<title>EveJS Web<\/title>/);
  assert.match(html, /type="module"/);

  // The legacy shell's markers must be gone. These are what "/" used to
  // return, and each of them returned a 200 the whole time it was dead.
  //
  // Matched as full quoted attributes, not bare paths: the SPA's own HTML
  // carries a comment pointing at web/src/styles.css — its OWN Tailwind entry,
  // nothing to do with the deleted public/styles.css — and a bare "/styles.css"
  // substring test flags that comment as if the legacy app were still wired in.
  for (const legacyMarker of [
    'src="/app.js"',
    'href="/styles.css"',
    'src="/commandClient.js"',
    'src="/eventClient.js"',
    'src="/mutationScope.js"',
    'id="login-view"',
    'id="page-tabs"',
    "EveJS Web POC",
  ]) {
    assert.equal(
      html.includes(legacyMarker),
      false,
      `the root still references the deleted legacy file ${legacyMarker}`,
    );
  }
});

test("the SPA's own script and stylesheet load from where the HTML asks for them", async () => {
  const html = await (await fetch(`${origin}/`)).text();

  const scriptSource = /<script[^>]+src="([^"]+)"/.exec(html);
  const styleHref = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/.exec(html);
  assert.ok(scriptSource, "the served HTML references no module script");
  assert.ok(styleHref, "the served HTML references no stylesheet");

  // The asset URLs must be resolvable from the path the document is served
  // at. A built bundle still pointing at /dist/assets/ while the document is
  // served at / is the exact failure this goal warned about: the document
  // loads, both assets 404, and the operator sees a blank page.
  const script = await fetch(new URL(scriptSource[1], origin));
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") || "", /javascript/);
  const scriptBody = await script.text();
  assert.equal(
    scriptBody.startsWith("<!doctype html"),
    false,
    "the script URL fell through to the HTML catch-all instead of serving the bundle",
  );

  const stylesheet = await fetch(new URL(styleHref[1], origin));
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get("content-type") || "", /text\/css/);
  const styleBody = await stylesheet.text();
  assert.equal(
    styleBody.startsWith("<!doctype html"),
    false,
    "the stylesheet URL fell through to the HTML catch-all instead of serving the bundle",
  );
});

test("a client deep link resolves to the SPA shell", async () => {
  const response = await fetch(`${origin}/some/client/route`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<div id="app">/);
});

test("the /dist/ bookmark still reaches the app", async () => {
  const response = await fetch(`${origin}/dist/`, { redirect: "follow" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<div id="app">/);
});

// R27: the /icon-cache mount sits ABOVE the catch-all with fallthrough:false.
// That is the ONLY reason a missing icon 404s so <img onerror> fires. If it
// ever falls through, the browser receives index.html with a 200, onerror
// never fires, and every missing icon becomes a broken image forever.
test("a cached icon serves as a real image", async () => {
  const response = await fetch(`${origin}/icon-cache/type-587-64.png`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
});

test("an uncached icon 404s rather than falling through to the HTML catch-all", async () => {
  const response = await fetch(`${origin}/icon-cache/type-999999999-64.png`);
  assert.equal(response.status, 404);
  const body = await response.text();
  assert.equal(
    body.includes("<div id=\"app\">"),
    false,
    "a missing icon returned the SPA shell; <img onerror> will never fire",
  );
});

test("the six legacy app files are gone from public/", async () => {
  for (const legacyFile of [
    "index.html",
    "app.js",
    "styles.css",
    "commandClient.js",
    "eventClient.js",
    "mutationScope.js",
  ]) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, "public", legacyFile)),
      false,
      `public/${legacyFile} still exists`,
    );
  }
});
