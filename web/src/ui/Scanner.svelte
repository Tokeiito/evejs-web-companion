<script lang="ts">
  // Store/flow adapter for the pure ScannerCenter view. It deliberately wires
  // only prerequisites the live client actually owns today: current-system
  // reads, type names, formation reference data, and safe reconnect. Launch,
  // recovery, and analysis stay disabled until exact launcher/probe geometry is
  // present in authoritative state.
  import { onMount } from "svelte";
  import ScannerCenter from "./ScannerCenter.svelte";
  import { nameKey } from "../store/names.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { ScannerActionBindings } from "../scanner/scannerCenter.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const scanner = store.scanner;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  const typeNames = $derived.by(() => {
    const catalog: Record<number, string> = {};
    if ($scanner.scan.status !== "ready") {
      return catalog;
    }
    for (const site of [
      ...$scanner.scan.value.anomalies,
      ...$scanner.scan.value.signatures,
      ...$scanner.scan.value.staticSites,
      ...$scanner.scan.value.structures,
    ]) {
      for (const value of [site.fields.typeID, site.fields.entryObjectTypeID]) {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
          continue;
        }
        const name = $names.resolved[nameKey("type", value)];
        if (typeof name === "string" && name.trim() !== "") {
          catalog[value] = name;
        }
      }
    }
    return catalog;
  });

  const actions: ScannerActionBindings = {
    reconnect: { run: () => flow.reconnectScannerProbes() },
  };

  onMount(() => {
    // Session-loss handling lives in the flow; suppress only the otherwise
    // unhandled onMount promise after it has taken the character offline.
    void flow.loadScanner().catch(() => undefined);
  });
</script>

<ScannerCenter
  scan={$scanner.scan}
  formations={$scanner.formations}
  names={{ typeNames }}
  {actions}
  onRefresh={() => flow.loadScanner()}
/>
