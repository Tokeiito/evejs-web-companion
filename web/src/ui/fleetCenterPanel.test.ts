import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const { decodeFleetCenter } = await import("../bridge/fleetCenter.ts");
const { default: FleetCenter } = await import("./FleetCenter.svelte");
const { default: PanelHost } = await import("./PanelHost.svelte");

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

const READ_NAMES = [
  "GetInitState",
  "GetWings",
  "GetMotd",
  "GetJoinRequests",
  "GetFleetComposition",
] as const;

function keyVal(entries: readonly (readonly [string, unknown])[]) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

function noFleet(message = "FleetNotFound") {
  return decodeFleetCenter({
    ok: true,
    characterID: 140000005,
    fleetID: null,
    reads: Object.fromEntries(
      READ_NAMES.map((name) => [name, { error: "CALL_REFUSED", message }]),
    ),
  } as never);
}

function populatedFleet() {
  const squad = keyVal([["squadID", 700001], ["name", "Logistics"]]);
  const wing = keyVal([
    ["wingID", 800001],
    ["name", "Support Wing"],
    ["squads", { type: "dict", entries: [[700001, squad]] }],
  ]);
  const leader = keyVal([
    ["charID", 140000005],
    ["wingID", null],
    ["squadID", null],
    ["role", 1],
    ["job", 2],
    ["shipTypeID", 670],
    ["stationID", 60003760],
    ["solarSystemID", 30000142],
  ]);
  const member = keyVal([
    ["charID", 140000002],
    ["wingID", 800001],
    ["squadID", 700001],
    ["role", 4],
    ["job", 0],
    ["shipTypeID", 587],
    ["stationID", null],
    ["solarSystemID", 30000144],
  ]);
  const emptyDict = { type: "dict", entries: [] };
  return decodeFleetCenter({
    ok: true,
    characterID: 140000005,
    fleetID: null,
    reads: {
      GetInitState: {
        result: keyVal([
          ["motd", "Anchor on the support wing."],
          ["fleetID", 654500010000],
          ["members", { type: "dict", entries: [[140000005, leader], [140000002, member]] }],
          ["squads", { type: "dict", entries: [[700001, squad]] }],
          ["wings", { type: "dict", entries: [[800001, wing]] }],
        ]),
      },
      GetWings: { result: { type: "dict", entries: [[800001, wing]] } },
      GetMotd: { result: "Anchor on the support wing." },
      GetJoinRequests: { result: emptyDict },
      GetFleetComposition: { result: { type: "list", items: [] } },
    },
  } as never);
}

function loadSnapshot(
  store: ReturnType<typeof createClientStore>,
  snapshot: ReturnType<typeof decodeFleetCenter>,
): void {
  store.apply({
    type: "fleet/loaded",
    ...snapshot,
    readError: snapshot.availability === "unavailable" ? "Fleet membership could not be read just now." : null,
    refreshedAtMs: 100,
  });
}

test("Fleet Center has honest loading, fleetless and unavailable states", () => {
  const initial = render(FleetCenter as never, {
    props: { store: createClientStore(), flow: fakeFlow() },
  } as never).body;
  assert.match(initial, /Reading your fleet membership/);
  assert.doesNotMatch(initial, /You are not in a fleet/);

  const fleetlessStore = createClientStore();
  loadSnapshot(fleetlessStore, noFleet());
  const fleetless = render(FleetCenter as never, {
    props: { store: fleetlessStore, flow: fakeFlow() },
  } as never).body;
  assert.match(fleetless, /You are not in a fleet/);
  assert.match(fleetless, /Form fleet/);
  assert.match(fleetless, /No pending invitation/);

  const failedStore = createClientStore();
  loadSnapshot(failedStore, noFleet("Gateway unavailable"));
  const failed = render(FleetCenter as never, {
    props: { store: failedStore, flow: fakeFlow() },
  } as never).body;
  assert.match(failed, /Fleet status unavailable/);
  assert.doesNotMatch(failed, /Form fleet/);
});

test("Fleet Center renders resolved roster hierarchy and never primary raw IDs", () => {
  const store = createClientStore();
  store.apply({
    type: "names/resolved",
    entries: {
      "character:140000005": "Fleet Boss",
      "character:140000002": "Logi Pilot",
      "type:670": "Capsule",
      "type:587": "Rifter",
      "station:60003760": "Jita IV - Moon 4",
      "system:30000144": "Perimeter",
    },
  });
  loadSnapshot(store, populatedFleet());

  const body = render(FleetCenter as never, {
    props: { store, flow: fakeFlow() },
  } as never).body;
  for (const text of [
    "2 members",
    "Fleet hierarchy",
    "Fleet command",
    "Support Wing",
    "Logistics",
    "Fleet Boss",
    "Logi Pilot",
    "Rifter",
    "Perimeter",
    "Anchor on the support wing",
  ]) {
    assert.match(body, new RegExp(text));
  }
  for (const rawID of [
    "654500010000",
    "140000005",
    "140000002",
    "800001",
    "700001",
    "60003760",
    "30000144",
  ]) {
    assert.equal(body.includes(rawID), false, `${rawID} leaked into the rendered Fleet Center`);
  }
});

test("Fleet Center names an observed invitation and PanelHost routes the Fleet tab", () => {
  const store = createClientStore();
  loadSnapshot(store, noFleet());
  store.apply({
    type: "names/resolved",
    entries: { "character:140000002": "Wing Commander" },
  });
  store.apply({
    type: "fleet/pending-invite",
    invite: { fleetID: 654500010000, inviterID: 140000002, receivedAtMs: 200 },
  });

  const body = render(PanelHost as never, {
    props: { store, flow: fakeFlow(), tab: "fleet" },
  } as never).body;
  assert.match(body, /Fleet Center/);
  assert.match(body, /Wing Commander/);
  assert.match(body, /Accept invitation/);
  assert.equal(body.includes("654500010000"), false);
  assert.equal(body.includes("140000002"), false);
});

test("every consequential Fleet Center call is behind an explicit UI confirmation", () => {
  const source = readFileSync(new URL("./FleetCenter.svelte", import.meta.url), "utf8");
  assert.match(source, /window\.confirm/);

  const guardedCalls = [
    { handler: "formFleet", mutation: "formFleet", args: "" },
    { handler: "acceptInvite", mutation: "acceptFleetInvite", args: "" },
    { handler: "inviteMember", mutation: "inviteFleetMember", args: "inviteeID" },
    { handler: "leaveFleet", mutation: "leaveFleet", args: "" },
  ] as const;

  for (const { handler, mutation, args } of guardedCalls) {
    const functionBody = source.match(
      new RegExp(`async function ${handler}\\([^]*?\\n  \\}`),
    )?.[0];
    assert.ok(functionBody, `expected ${handler} action function in FleetCenter source`);
    const invocation = `flow\\.${mutation}\\(${args}\\)`;
    assert.match(
      functionBody,
      new RegExp(
        `if\\s*\\(confirmAction\\([\\s\\S]*?\\)\\)\\s*(?:\\{\\s*)?await\\s+${invocation};`,
      ),
      `${mutation} must be the mutation guarded by ${handler}'s own confirmation`,
    );
    assert.equal(
      [...functionBody.matchAll(new RegExp(`flow\\.${mutation}\\(`, "g"))].length,
      1,
      `${handler} must not have an additional unconfirmed ${mutation} call`,
    );
  }
});
