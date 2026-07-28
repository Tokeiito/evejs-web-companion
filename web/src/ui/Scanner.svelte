<script lang="ts">
  // Store/flow adapter for the pure ScannerCenter view. Action prerequisites
  // come from EveJS's held-session scanner snapshot; the POST callbacks accept
  // no authority-bearing browser arguments and re-read that state server-side.
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
    if ($scanner.scan.status === "ready") {
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
    }
    if ($scanner.operations.status === "ready") {
      const typeIDs = [
        $scanner.operations.value.launcher?.typeID,
        ...$scanner.operations.value.probes.map((probe) => probe.typeID),
      ];
      for (const value of typeIDs) {
        if (typeof value !== "number" || value <= 0) continue;
        const name = $names.resolved[nameKey("type", value)];
        if (typeof name === "string" && name.trim() !== "") catalog[value] = name;
      }
    }
    return catalog;
  });

  const actions = $derived.by((): ScannerActionBindings => {
    const operations = $scanner.operations;
    if (operations.status !== "ready" || !operations.value.inSpace) {
      return {};
    }
    const { launcher, probes } = operations.value;
    const probeMap = Object.fromEntries(
      probes.map((probe) => [String(probe.probeID), {
        typeID: probe.typeID,
        pos: [...probe.pos],
        destination: [...probe.destination],
        scanRange: probe.scanRange,
        rangeStep: probe.rangeStep,
        state: probe.state,
        expiry: probe.expiry,
      }]),
    );
    return {
      launch: launcher === null ? undefined : {
        moduleID: launcher.moduleID,
        count: launcher.launchCount,
        launcherName: launcher.typeID === null
          ? null
          : typeNames[launcher.typeID] ?? null,
        run: () => flow.launchScannerProbes(),
      },
      recover: {
        probeIDs: probes.map((probe) => probe.probeID),
        run: () => flow.recoverScannerProbes(),
      },
      analyze: {
        probeMap,
        run: () => flow.analyzeScannerSignatures(),
      },
      reconnect: { run: () => flow.reconnectScannerProbes() },
    };
  });

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
