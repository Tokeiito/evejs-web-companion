// R1b scaffold smoke entry. Foundation proof only — no page migration.
//
// Wires the three R1b pieces together in ~a screen of code:
//  1. createClientStore() — the framework-agnostic client-state store,
//  2. MemoryFeedAdapter — a feed adapter feeding the store through the
//     transport-hiding seam (the legacy-WS / bridge adapters are R2+),
//  3. getCharacterSelectionData() — the typed browser callMethod client
//     driving the R1 reference call through POST /api/bridge/call.

import { createClientStore } from "./store/clientStore.ts";
import { MemoryFeedAdapter } from "./store/feed.ts";
import { getCharacterSelectionData } from "./bridge/characterSelection.ts";
import { BridgeCallError } from "./bridge/callMethod.ts";

const storeStateEl = document.getElementById("store-state");
const bridgeOutputEl = document.getElementById("bridge-output");
const runButton = document.getElementById("run-reference-call");

const store = createClientStore();
const feed = new MemoryFeedAdapter("memory-demo");
store.attachFeed(feed);

// Pure reader: render every store change (bigints stringified for display).
store.subscribe((state) => {
  if (storeStateEl) {
    storeStateEl.textContent = JSON.stringify(
      state,
      (_key, value: unknown) => (typeof value === "bigint" ? `${value}n` : value),
      2,
    );
  }
});

runButton?.addEventListener("click", () => {
  if (bridgeOutputEl) {
    bridgeOutputEl.textContent = "Calling EveJS through the bridge…";
    bridgeOutputEl.classList.remove("error");
  }
  getCharacterSelectionData()
    .then((selection) => {
      // Feed the decoded rows into the store through the adapter, so the
      // store panel above updates through the same seam real feeds will use.
      feed.emit({ type: "character/list", characters: selection.characters });
      const first = selection.characters[0];
      if (first) {
        feed.emit({ type: "character/selected", characterID: first.characterID });
      }
      if (bridgeOutputEl) {
        bridgeOutputEl.textContent = selection.characters.length
          ? selection.characters
              .map(
                (row) =>
                  `${row.characterName} — ${row.shipName ?? "-"} | ` +
                  `${row.balance ?? 0} ISK | ${row.skillPoints ?? 0} SP`,
              )
              .join("\n")
          : "EveJS returned no characters for this account.";
      }
    })
    .catch((error: unknown) => {
      if (!bridgeOutputEl) {
        return;
      }
      bridgeOutputEl.classList.add("error");
      if (error instanceof BridgeCallError) {
        bridgeOutputEl.textContent =
          error.code === "AUTH_REQUIRED"
            ? "Not signed in — log in on the vanilla app first (same origin), then retry."
            : `Bridge call failed: ${error.code} (HTTP ${error.status}) — ${error.message}`;
      } else {
        bridgeOutputEl.textContent = `Unexpected failure: ${String(error)}`;
      }
    });
});
