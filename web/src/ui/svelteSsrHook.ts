// Test-only module-load hook: compile `.svelte` on import so the panels can be
// RENDERED inside `node --test` (goal R18).
//
// Why this exists: `npm run typecheck` runs `tsc`, and tsc does not parse
// `.svelte` files (see web/src/svelte-files.d.ts). Nothing in the suite ever
// executed a component, so a template expression could be wrong in a way that
// throws on the panel's FIRST MOUNT and no test — and no typecheck — would
// notice. R18 shipped exactly that bug: `{activeShipName()}` invoked a
// `$derived` string as a function, the Fitting component threw during creation,
// Svelte discarded the aborted render, and the tab silently did nothing.
//
// Svelte's SERVER generator is enough to catch that class of bug and needs no
// DOM: it runs the component's script body and its whole template. It does NOT
// run `$effect` or `onMount`, so this harness pins render-time correctness only.
//
// Registered via `node:module`'s `register()` from panelFirstMount.test.ts.

import { compile } from "svelte/compiler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface LoadResult {
  format: string;
  shortCircuit?: boolean;
  source?: string;
}

type NextLoad = (url: string, context: unknown) => Promise<LoadResult>;

export async function load(
  url: string,
  context: unknown,
  nextLoad: NextLoad,
): Promise<LoadResult> {
  if (!url.endsWith(".svelte")) {
    return nextLoad(url, context);
  }
  const filename = fileURLToPath(url);
  const { js } = compile(readFileSync(filename, "utf8"), {
    generate: "server",
    filename,
  });
  return { format: "module", shortCircuit: true, source: js.code };
}
