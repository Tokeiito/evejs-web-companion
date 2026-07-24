// The login form gates on the health slice: offline refuses login, unknown
// waits, online lets you in. Checked against real rendered output (SSR).

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const LoginForm = (await import("./LoginForm.svelte")).default;

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

function renderWith(status: "unknown" | "online" | "offline"): string {
  const store = createClientStore();
  if (status !== "unknown") {
    store.apply({ type: "health/status", status });
  }
  return render(LoginForm as never, { props: { store, flow: fakeFlow() } } as never).body;
}

/** Is the submit button (the last <button>) rendered disabled? */
function submitDisabled(body: string): boolean {
  const match = /<button[^>]*type="submit"[^>]*>/.exec(body);
  assert.ok(match, "no submit button rendered");
  return /\bdisabled\b/.test(match[0]);
}

test("offline: refuses login — banner shown, submit disabled", () => {
  const body = renderWith("offline");
  assert.match(body, /server is offline/i, "no offline banner");
  assert.match(body, /Server offline/, "the button does not say the server is offline");
  assert.equal(submitDisabled(body), true, "login was left enabled while offline");
});

test("unknown (still pinging): waits — checking note, submit disabled", () => {
  const body = renderWith("unknown");
  assert.match(body, /Checking server/i, "no checking note");
  assert.equal(submitDisabled(body), true, "login was enabled before the health ping answered");
});

test("online: login is available — no gate banner, inputs enabled", () => {
  const body = renderWith("online");
  assert.doesNotMatch(body, /server is offline/i, "offline banner shown while online");
  assert.doesNotMatch(body, /Checking server/i, "checking note shown while online");
  // The account input is not disabled when online.
  const accountInput = /<input[^>]*autocomplete="username"[^>]*>/.exec(body);
  assert.ok(accountInput, "no account input");
  assert.equal(/\bdisabled\b/.test(accountInput[0]), false, "account input disabled while online");
});
