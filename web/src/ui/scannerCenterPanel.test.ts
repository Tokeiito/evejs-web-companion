import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

import type { ScanFieldValue, ScanFullState, ScanSite } from "../bridge/boundSmallServices.ts";
import type { FormationsResult } from "../bridge/formations.ts";
import type { ScannerActionBindings, ScannerDataState } from "../scanner/scannerCenter.ts";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const ScannerCenter = (await import("./ScannerCenter.svelte")).default;
const SOURCE = readFileSync(new URL("./ScannerCenter.svelte", import.meta.url), "utf8");

function scanSite(
  siteID: number | string,
  targetID: string | null,
  fields: Readonly<Record<string, ScanFieldValue>>,
): ScanSite {
  return { siteID, targetID, position: null, fields };
}

function state(overrides: Partial<ScanFullState> = {}): ScanFullState {
  return {
    anomalies: [],
    signatures: [],
    staticSites: [],
    structures: [],
    ...overrides,
  };
}

function visibleText(body: string): string {
  return body
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scene(options: {
  scan: ScannerDataState<ScanFullState>;
  formations?: ScannerDataState<FormationsResult>;
  actions?: ScannerActionBindings;
  names?: {
    typeNames?: Readonly<Record<number, string>>;
    dungeonNames?: Readonly<Record<number, string>>;
  };
}) {
  const output = render(ScannerCenter as never, { props: options } as never);
  return { body: output.body, text: visibleText(output.body) };
}

test("Scanner Center keeps loading, unavailable, and successful-empty states distinct", () => {
  const loading = scene({ scan: { status: "loading" } }).text;
  assert.match(loading, /Reading the current system’s scanner state/i);
  assert.doesNotMatch(loading, /successfully reported no/i);

  const unavailable = scene({
    scan: { status: "unavailable", reason: "The scanner could not be reached." },
  }).text;
  assert.match(unavailable, /could not be reached/i);
  assert.match(unavailable, /No conclusion about sites/i);
  assert.doesNotMatch(unavailable, /successfully reported no/i);

  const empty = scene({ scan: { status: "ready", value: state() } }).text;
  assert.match(empty, /successfully reported no anomalies, signatures, static sites, or structures/i);
  assert.doesNotMatch(empty, /No conclusion about sites/i);
});

test("Scanner Center renders signal and supplied site/type names without numeric metadata", () => {
  const { text } = scene({
    scan: {
      status: "ready",
      value: state({
        anomalies: [
          scanSite(5380000140001, "FTW-038", {
            dungeonNameID: 110922,
            entryObjectTypeID: 28356,
            difficulty: 2,
          }),
        ],
        signatures: [
          scanSite("9223372036854775001", "ABC-123", {
            difficulty: 4,
            deviation: 1500,
          }),
        ],
        structures: [
          scanSite(1030000000001, "QEE-288", {
            typeID: 35832,
            groupID: 1657,
            categoryID: 65,
          }),
        ],
      }),
    },
    names: {
      dungeonNames: { 110922: "Guristas Hideaway" },
      typeNames: { 28356: "Cosmic acceleration gate", 35832: "Astrahus" },
    },
  });

  for (const words of [
    "Guristas Hideaway",
    "Cosmic acceleration gate",
    "Astrahus",
    "FTW-038",
    "ABC-123",
    "QEE-288",
    "1.5 km deviation",
  ]) {
    assert.match(text, new RegExp(words, "i"));
  }
  for (const internal of [
    "5380000140001",
    "9223372036854775001",
    "1030000000001",
    "110922",
    "28356",
    "35832",
    "1657",
  ]) {
    assert.doesNotMatch(text, new RegExp(internal), `${internal} leaked into player text`);
  }
});

test("without probe telemetry/callbacks the panel is explicitly read-only and controls are disabled", () => {
  const { body, text } = scene({ scan: { status: "ready", value: state() } });
  assert.match(text, /currently read-only/i);
  assert.match(text, /does not store active-probe IDs or geometry/i);
  assert.match(text, /will not invent a scan map/i);
  assert.match(text, /reconnect route exists, but its callback has not been wired/i);

  for (const label of ["Launch probes", "Recover probes", "Analyze signatures", "Reconnect to probes"]) {
    assert.match(
      body,
      new RegExp(`<button[^>]*disabled[^>]*>\\s*${label}`, "i"),
      `${label} was not disabled`,
    );
  }
  assert.doesNotMatch(text, /Destroy probe/i);
});

test("only supplied, prerequisite-complete action bindings become enabled", () => {
  const actions: ScannerActionBindings = {
    launch: {
      moduleID: 7400000030,
      count: 8,
      launcherName: "Sisters Core Probe Launcher",
      run: () => {},
    },
    recover: { probeIDs: [70000001, 70000002], run: () => {} },
    analyze: { probeMap: { "70000001": { rangeStep: 2 } }, run: () => {} },
    reconnect: { run: () => {} },
  };
  const { body, text } = scene({
    scan: { status: "ready", value: state() },
    actions,
  });
  assert.match(text, /8 probes ready in Sisters Core Probe Launcher/i);
  assert.match(text, /2 launched probes are available to recover/i);
  assert.match(text, /1 probe position is ready for analysis/i);
  assert.doesNotMatch(text, /currently read-only/i);

  for (const label of ["Launch probes", "Recover probes", "Analyze signatures", "Reconnect to probes"]) {
    const button = body.match(new RegExp(`<button([^>]*)>\\s*${label}`, "i"));
    assert.ok(button, `${label} is missing`);
    assert.doesNotMatch(button[1] ?? "", /disabled/i, `${label} stayed disabled`);
  }
});

test("formation reference distinguishes unresolved cache data, empty, and inline names", () => {
  const unresolved = scene({
    scan: { status: "ready", value: state() },
    formations: {
      status: "ready",
      value: {
        formations: [],
        cacheReference: { objectId: null, nodeId: 65450, version: 1n },
      },
    },
  }).text;
  assert.match(unresolved, /no cache-fetch route/i);

  const empty = scene({
    scan: { status: "ready", value: state() },
    formations: {
      status: "ready",
      value: { formations: [], cacheReference: null },
    },
  }).text;
  assert.match(empty, /No formation shapes were reported/i);

  const inline = scene({
    scan: { status: "ready", value: state() },
    formations: {
      status: "ready",
      value: {
        formations: [
          { name: "Diamond", points: [] },
          { name: "Arrow", points: [] },
        ],
        cacheReference: null,
      },
    },
  }).text;
  assert.match(inline, /Diamond/);
  assert.match(inline, /Arrow/);
  assert.match(inline, /no supported route applies them to probes/i);
  assert.doesNotMatch(inline, /Apply formation/i);
});

test("the component is callback-only and launch uses an explicit two-step confirmation surface", () => {
  assert.doesNotMatch(SOURCE, /\.\.\/app\/(api|flow)/);
  assert.doesNotMatch(SOURCE, /\.\.\/store\/(types|clientStore)/);
  assert.doesNotMatch(SOURCE, /fetch\s*\(|\/api\/bridge\//);
  assert.match(SOURCE, /readonly onRefresh\?:/);
  assert.match(SOURCE, /readonly actions\?: ScannerActionBindings/);
  assert.match(SOURCE, /pendingAction = id/);
  assert.match(SOURCE, /role="alertdialog"/);
  assert.match(SOURCE, /pendingPolicy\.confirmation\.confirmLabel/);
  assert.doesNotMatch(SOURCE, /window\.confirm|DestroyProbe|destroy-probe/i);
});
