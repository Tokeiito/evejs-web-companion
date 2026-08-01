// ⚠ THE SILENT-DECLINE AUDIT, as a test rather than a document.
//
// This server has a recurring shape: a handler that returns null (or a constant)
// on BOTH success and refusal, so the BFF answers a flat `applied: true` either
// way and the client has no way to tell from the envelope whether anything
// happened. Four were found the hard way, each after it had already shipped a
// user-visible lie:
//
//   • dogmaIM.LoadAmmo          — 200/applied with an incompatible charge
//   • dogmaIM.Deactivate        — stopped:false is normal cycle-end, not failure
//   • skillMgr.ApplyFreeSkillPoints — spends nothing when the skill is training
//   • fitting/state (online)    — the api verb returns VOID, so runFittingAction's
//                                 `applied` check was dead code
//
// The rule that came out of it: a write is only proven by a RE-READ of the thing
// it claims to have changed. The tests below pin that rule on the verbs where it
// was won, so a future refactor cannot quietly drop the verification and go back
// to trusting the envelope.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const FLOW = readFileSync(path.join(APP_DIR, "flow.ts"), "utf8");
const API = readFileSync(path.join(APP_DIR, "api.ts"), "utf8");

/**
 * The body of one flow verb, up to the next one.
 *
 * Verbs come in two shapes: `async function name(` for the internal helpers and
 * `async name(` for the methods on the returned AppFlow object. Both are
 * matched — which shape a verb uses is an accident of where it was written, not
 * something these assertions should depend on.
 */
function flowFunction(name: string): string {
  let start = FLOW.indexOf(`async function ${name}(`);
  if (start === -1) {
    start = FLOW.search(new RegExp(`\\n\\s+async ${name}\\(`));
  }
  assert.notEqual(start, -1, `flow.ts has no ${name}`);
  const rest = FLOW.slice(start + 10);
  const next = rest.search(/\n\s+async (function )?[A-Za-z]+\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

test("⚠ setModuleOnline verifies against the RE-READ, not a dead applied flag", () => {
  // api.setModuleOnline returns void, so any helper that decides "declined"
  // from an `applied` field is checking nothing at all for this verb.
  assert.match(
    API,
    /export async function setModuleOnline\([\s\S]*?\): Promise<void>/,
    "if this ever returns a result, revisit the flow's verification",
  );
  const body = flowFunction("setModuleOnline");
  assert.match(body, /moduleOnlineState\(itemID\)/, "reads the state before and after");
  assert.match(body, /await loadFitting\(\)/, "re-reads the fit");
  assert.match(body, /still (offline|online)/, "says so when nothing moved");
  // A CALL, not a mention — the body deliberately explains why it does not use
  // the helper, and that explanation must not defeat the assertion.
  assert.doesNotMatch(
    body,
    /await runFittingAction\(/,
    "runFittingAction's applied-flag check is dead for a void verb",
  );
});

test("⚠ deactivateModule never reports cycle-end as a decline", () => {
  const body = flowFunction("deactivateModule");
  assert.match(body, /finishing its cycle/i);
  // The verifier must be unconditional: both answers this verb can give are the
  // server doing as it was told.
  assert.match(body, /\(\) => true,/);
});

test("⚠ the ammo verbs prove themselves against what the modules HOLD", () => {
  const body = flowFunction("runAmmoAction");
  assert.match(body, /ammoSignature\(moduleIDs\)/);
  assert.match(body, /await loadFitting\(\)/);
  // And the decline is recorded AFTER the reload, or the reload would wipe it.
  const reload = body.indexOf("await loadFitting()");
  // The catch block records an error too, so it is the LAST occurrence — the
  // silent-decline path — that has to come after the reload.
  const decline = body.lastIndexOf("fitting/action-error");
  assert.ok(decline > reload, "a decline recorded before the reload is erased by it");
});

test("⚠ applyFreeSkillPoints reports what was SPENT, never what was asked", () => {
  const body = flowFunction("applyFreeSkillPoints");
  assert.match(body, /const spent = before - after/);
  assert.match(body, /spent no points/i, "a total that did not move is a decline");
  assert.doesNotMatch(
    body,
    /action: `Applied \$\{points/,
    "reporting the request back would invent a number the server capped",
  );
});

test("the overload, repair and banking verbs all check the snapshot", () => {
  for (const [name, marker] of [
    ["setModuleOverload", /overloadedModuleIDs/],
    ["repairModule", /moduleDamage/],
    ["setWeaponBanks", /weaponBanks/],
  ] as const) {
    const body = flowFunction(name);
    assert.match(body, marker, `${name} must read the server's own state back`);
    assert.match(body, /gave no reason/, `${name} must report a silent decline`);
  }
});

test("⚠ every one of them treats UNKNOWN as 'not a decline'", () => {
  // A reading we could not get must never be reported as a refusal — that is a
  // scarier lie than saying nothing, and it is the mistake the cycle-end bug
  // made in the opposite direction.
  for (const name of ["setModuleOverload", "repairModule", "setWeaponBanks"]) {
    const body = flowFunction(name);
    assert.match(
      body,
      /=== null\)\s*\{\s*return true;|before === null \|\| after === null/,
      `${name} must let an unknown reading pass`,
    );
  }
});
