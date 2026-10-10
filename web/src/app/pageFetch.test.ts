// Which way the page's requests go (app/pageFetch.ts): on the tab's socket unless this browser has been told HTTP.

import test from "node:test";
import assert from "node:assert/strict";

import { TRANSPORT_SETTING_KEY, pageCarries, pageFetch, socketAddress, socketOver, socketTransport, transportSetting } from "./pageFetch.ts";

const storing = (value: string | null) => ({ getItem: (key: string) => (key === TRANSPORT_SETTING_KEY ? value : "http") });

test("the page is on the socket unless the setting says http, in so many letters", () => {
  assert.equal(TRANSPORT_SETTING_KEY, "evejs-web-transport:v1");
  assert.equal(transportSetting(storing("http")), "http");
  for (const other of [null, "", "socket", "Http", "http ", "0", "false"]) assert.equal(transportSetting(storing(other)), "socket", JSON.stringify(other));
  // No storage to read, or storage that will not be read (a private window): nothing is said, so the socket.
  assert.equal(transportSetting(null), "socket");
  assert.equal(transportSetting({ getItem: () => { throw new Error("storage is not allowed here"); } }), "socket");
  // Only its own key is read.
  assert.equal(transportSetting({ getItem: (key: string) => (key === "something-else" ? "http" : null) }), "socket");
});

test("the socket is at the page's own host, secure where the page is", () => {
  assert.equal(socketAddress({ protocol: "http:", host: "127.0.0.1:26500" }), "ws://127.0.0.1:26500/api/socket");
  assert.equal(socketAddress({ protocol: "https:", host: "client.example" }), "wss://client.example/api/socket");
});

test("where there is no page, requests are the world's fetch whatever the setting: a hosted bot runs this code too", () => {
  // This test runs in Node, as the bot host does: there is no `location`.
  assert.equal(typeof location, "undefined");
  assert.equal(pageFetch(), globalThis.fetch);
  assert.equal(socketTransport(), null);
  // And nothing there is carried: every request takes a lane, as it always has.
  assert.equal(pageCarries("/api/bridge/skills", { headers: { authorization: "Bearer T1" } }), false);
});

test("the browser's socket is handed on as the little of one that is asked for", () => {
  const calls: unknown[] = [];
  const browser = {
    send: (data: string) => calls.push(["send", data]),
    close: (code?: number, reason?: string) => calls.push(["close", code, reason]),
    onopen: null as ((event: unknown) => void) | null,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onclose: null as ((event: { code: number }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
  };
  const like = socketOver(browser as unknown as WebSocket);
  // With nobody listening yet, what the browser's socket says is let pass.
  browser.onopen?.({});
  browser.onmessage?.({ data: "early" });
  browser.onclose?.({ code: 1000 });
  browser.onerror?.({});
  const heard: unknown[] = [];
  like.onopen = () => heard.push("open");
  like.onmessage = (event) => heard.push(["message", event.data]);
  like.onclose = (event) => heard.push(["close", event.code]);
  like.onerror = () => heard.push("error");
  browser.onopen?.({});
  browser.onmessage?.({ data: "{\"hello\":{\"ok\":true}}" });
  browser.onerror?.({});
  browser.onclose?.({ code: 4401 });
  assert.deepEqual(heard, ["open", ["message", "{\"hello\":{\"ok\":true}}"], "error", ["close", 4401]]);
  like.send("a frame");
  like.close(1000, "done");
  assert.deepEqual(calls, [["send", "a frame"], ["close", 1000, "done"]]);
});
