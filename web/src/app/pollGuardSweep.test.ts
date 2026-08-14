// Every periodic NETWORK read in the client is guarded (goal R92).
//
// ⚠ WHY THIS IS A SWEEP AND NOT FOUR UNIT TESTS. The bug it pins is not in any
// one poller — it is in the SHAPE that gets copied. `spacePoll.ts` had the
// in-flight guard from the beginning; the four pollers written after it copied
// its outline and left the guard out, and nothing failed, because an unguarded
// poll is perfectly well-behaved right up until the server slows down. Then it
// stacks up, fills the browser's ~6 connections per origin, and the requests
// that visibly fail are the ones it displaced — a different panel entirely.
//
// A unit test for each poller would not have caught the FIFTH one. This does.
// See app/skipWhileBusy.ts for the full failure chain.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_SRC = join(fileURLToPath(new URL("../", import.meta.url)));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|svelte)$/.test(entry) || /\.test\.ts$/.test(entry)) {
      continue;
    }
    out.push(full);
  }
  return out;
}

/**
 * Blank out comments so the sweep reads CODE.
 *
 * ⚠ An earlier sweep in this codebase matched its own explanatory prose and
 * reported an offence that did not exist. Any sweep over raw source has to do
 * this, and has to be checked against a planted offence (see the last test).
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (line, lead: string) =>
      lead + " ".repeat(line.length - lead.length),
    );
}

/** The callback expression handed to each `setInterval` in a file. */
function intervalCallbacks(code: string): string[] {
  const found: string[] = [];
  const pattern = /setInterval\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < code.length && depth > 0) {
      const ch = code[index];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      index += 1;
    }
    found.push(code.slice(start, index - 1));
  }
  return found;
}

/**
 * Does this timer body reach the network?
 *
 * Deliberately broad — a false positive costs one allowlist entry with a reason,
 * a false negative costs a production outage nobody can find. Clock ticks
 * (`nowMs = Date.now()`) and pure local recomputation match nothing here.
 */
function looksLikeNetwork(callback: string): boolean {
  return /\b(refresh|ping|poll|reload|load|fetch|list|read|send|check)\w*\s*\(/i.test(callback);
}

/**
 * Timers whose body reaches the network but which cannot pile up, with the
 * reason each is safe. Anything added here needs an argument, not a shrug.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  [
    "app/spacePoll.ts",
    "the original: it carries its own documented in-flight guard (`inFlight`), " +
      "which is the guard skipWhileBusy generalises",
  ],
]);

function relative(path: string): string {
  return path.slice(WEB_SRC.length).replace(/\\/g, "/");
}

test("every periodic network read in the client is guarded against piling up", () => {
  const offences: string[] = [];
  for (const file of sourceFiles(WEB_SRC)) {
    const code = withoutComments(readFileSync(file, "utf8"));
    const name = relative(file);
    if (ALLOWED.has(name)) {
      continue;
    }
    const guardsSomething = /skipWhileBusy\s*\(/.test(code);
    for (const callback of intervalCallbacks(code)) {
      if (!looksLikeNetwork(callback)) {
        continue;
      }
      if (!guardsSomething) {
        offences.push(`${name}: setInterval(${callback.trim().slice(0, 60)}…)`);
      }
    }
  }
  assert.deepEqual(
    offences,
    [],
    "these timers fire a network read on the clock without waiting for the last " +
      "one to come back — wrap the body in skipWhileBusy (app/skipWhileBusy.ts):\n" +
      offences.join("\n"),
  );
});

test("the sweep can actually SEE an offence", () => {
  // ⚠ Without this, the test above passes just as happily when the scanner is
  // broken — which is how a sweep in this codebase once passed while reading
  // nothing at all.
  const planted = `
    onMount(() => {
      const timer = setInterval(() => void refresh(), 5000);
      return () => clearInterval(timer);
    });
  `;
  const callbacks = intervalCallbacks(withoutComments(planted));
  assert.equal(callbacks.length, 1, "the scanner did not find the timer");
  assert.equal(looksLikeNetwork(callbacks[0] ?? ""), true, "it did not read it as a network call");
  assert.equal(/skipWhileBusy\s*\(/.test(planted), false, "and it would not have been excused");
});

test("the sweep does not flag a plain clock tick", () => {
  // A countdown that re-reads `Date.now()` touches nothing and must not be
  // dragged into this — several panels legitimately do it.
  const clock = `const handle = setInterval(() => { nowMs = Date.now(); }, period);`;
  const [callback] = intervalCallbacks(withoutComments(clock));
  assert.equal(looksLikeNetwork(callback ?? ""), false);
});

test("the sweep reads code, not comments", () => {
  const prose = `
    // A poll here would setInterval(() => void refresh(), 1000) and pile up.
    const handle = setInterval(() => { nowMs = Date.now(); }, 1000);
  `;
  const callbacks = intervalCallbacks(withoutComments(prose));
  assert.equal(callbacks.length, 1, "the commented-out example was counted as real code");
  assert.equal(looksLikeNetwork(callbacks[0] ?? ""), false);
});

test("the sweep actually walked the client source", () => {
  // A path bug would make every assertion above vacuous.
  const files = sourceFiles(WEB_SRC).map(relative);
  assert.ok(files.includes("app/spacePoll.ts"), `only found ${files.length} files`);
  assert.ok(files.includes("ui/App.svelte"));
  assert.ok(
    files.some((name) => name.endsWith(".svelte")),
    "no .svelte files were read, so no panel poller was ever checked",
  );
});
