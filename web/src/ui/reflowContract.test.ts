// The R8 reflow contract, at the level it is actually decided (goal R85).
//
// ⚠ WHAT WENT WRONG. The card reflow was a MEDIA query: it asked how wide the
// VIEWPORT was. That was the right question while the app was one column, and
// the wrong one the moment panels became floating windows and a resizable dock
// column — a four-column table in a 320px panel on a 1440px screen kept its wide
// layout and crushed every cell to about 50px, because the browser window was
// not phone-sized. Measured in a browser before the fix: `reflowFired: false`,
// narrowest cell 52px.
//
// It is a CONTAINER query now, so the question is "does this row fit HERE".
// These tests pin the two halves that make that work: the query is a container
// query, and every reflow table actually sits inside the container it names.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(path.join(UI_DIR, "..", "styles.css"), "utf8");

test("the reflow is driven by the CONTAINER, not the viewport", () => {
  assert.match(CSS, /@container \(max-width: 640px\) \{/, "the reflow must be a container query");
  // And the old media query must not come back beside it — two queries would
  // reflow at different times and neither would be the rule.
  assert.equal(
    /@media \(max-width: 640px\) \{[\s\S]{0,200}table\.reflow/.test(CSS),
    false,
    "a viewport-driven reflow has come back",
  );
});

test("the container is the wrapper every reflow table already sits in", () => {
  const wrapRule = CSS.slice(CSS.indexOf("  .table-wrap {"));
  const body = wrapRule.slice(0, wrapRule.indexOf("}"));
  assert.match(body, /container-type: inline-size/, ".table-wrap must be the container");
  // ⚠ `inline-size` containment is only safe because the wrapper's width comes
  // from its parent. If it ever sized to its contents, containing it would
  // collapse it.
  assert.match(body, /width: 100%/, "the wrapper must take its width from its parent");
});

test("every reflow table in the app is inside a .table-wrap", () => {
  // The container query can only fire on descendants of the container, so a
  // reflow table outside one would silently keep its wide layout for ever —
  // exactly the failure this goal fixed, reintroduced one table at a time.
  const offences: string[] = [];
  for (const file of readdirSync(UI_DIR).filter((name) => name.endsWith(".svelte"))) {
    const source = readFileSync(path.join(UI_DIR, file), "utf8");
    for (const match of source.matchAll(/<table[^>]*class="[^"]*\breflow\b[^"]*"/g)) {
      // Look back for the nearest opening wrapper before this table.
      const before = source.slice(0, match.index);
      const wrapAt = before.lastIndexOf("table-wrap");
      const closeAt = before.lastIndexOf("</table>");
      if (wrapAt === -1 || wrapAt < closeAt) {
        const line = before.split("\n").length;
        offences.push(`${file}:${line} has a reflow table outside a .table-wrap`);
      }
    }
  }
  assert.deepEqual(offences, []);
});

test("the reflow still hides the header and labels every cell", () => {
  // The two halves that make a card readable: the column headers go away, and
  // each cell grows its own label from data-label. Without the second, a phone
  // shows a stack of unlabelled values.
  const block = CSS.slice(CSS.indexOf("@container (max-width: 640px) {"));
  const reflow = block.slice(0, block.indexOf("\n  }\n"));
  assert.match(reflow, /table\.reflow thead/, "the header must be hidden");
  assert.match(reflow, /content: attr\(data-label\)/, "each cell must grow its label");
});
