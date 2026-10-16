<script lang="ts">
  // Store/flow adapter for the pure ScannerCenter view. What each order would
  // send, and why the client would not offer it now, come from the scanner as
  // the transport keeps it, by the client's own rules (bridge/scannerWrites.ts).
  // The flow reads the scanner again as an order is made, and makes the
  // client's call itself.
  import { onMount } from "svelte";
  import ScannerCenter from "./ScannerCenter.svelte";
  import ProbeScanResults from "./ProbeScanResults.svelte";
  import ScannerProbes from "./ScannerProbes.svelte";
  import { SCAN_IN_PROGRESS, launchOf, recallOf, scanOf } from "../bridge/scannerWrites.ts";
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
    // What each order would send, or why the client would not offer it now (bridge/scannerWrites.ts). The flow
    // reads the scanner again as an order is made, and goes by that.
    const read = operations.value;
    const launch = launchOf(read);
    const scan = scanOf(read);
    const recall = recallOf(read);
    const launcher = read.launcher;
    return {
      launch: {
        moduleID: "refusal" in launch ? 0 : launch.moduleID,
        count: "refusal" in launch ? 0 : launch.count,
        launcherName: launcher === null || launcher.typeID === null
          ? null
          : typeNames[launcher.typeID] ?? null,
        blocked: "refusal" in launch ? launch.refusal : undefined,
        run: () => flow.launchScannerProbes(),
      },
      recover: {
        probeIDs: "refusal" in recall ? [] : recall.probeIDs,
        blocked: "refusal" in recall ? recall.refusal : undefined,
        run: () => flow.recoverScannerProbes(),
      },
      analyze: {
        probeMap: "refusal" in scan ? {} : scan.probes,
        blocked: "refusal" in scan ? scan.refusal : undefined,
        run: () => flow.analyzeScannerSignatures(),
      },
      reconnect: {
        blocked: read.scanning === true ? SCAN_IN_PROGRESS : undefined,
        run: () => flow.reconnectScannerProbes(),
      },
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
  names={{ typeNames }}
  {actions}
  onRefresh={() => flow.loadScanner()}
/>
<ScannerProbes {store} {flow} />
<ProbeScanResults {store} {flow} />
