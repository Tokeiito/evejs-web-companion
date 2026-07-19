// Browser autopilot decide-loop (goal R5b), driven against a SIMULATED
// flight-status timeline whose fake "server" advances the way the real space
// handlers do: docked -> undock -> in space -> warp to gate -> jump (new
// system) -> warp to station -> dock (out of range: DockingApproach) ->
// re-dock -> docked. The loop must issue the right atomic call at each state,
// replicate approach-then-redock, pause on an injected refusal, and never call
// the bridge after abort/stop.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createAutopilot,
  decideAutopilotAction,
  type AutopilotAction,
  type AutopilotController,
  type AutopilotDeps,
  type AutopilotProgress,
  type RoutePlan,
} from "./autopilotLoop.ts";
import type { FlightStatus } from "../store/types.ts";

const ORIGIN_SYSTEM = 30000142;
const DEST_SYSTEM = 30000140;
const ORIGIN_STATION = 60003760;
const DEST_STATION = 60003454;
const GATE_ORIGIN = 50000802; // source gate in ORIGIN_SYSTEM (warp + jump through)
const GATE_DEST = 50001248; // gate on the DEST_SYSTEM side (CmdStargateJump toGate)
const SHIP_ID = 9001;

const PLAN: RoutePlan = {
  destinationSystemID: DEST_SYSTEM,
  destinationStationID: DEST_STATION,
  destinationName: "Destination Station",
  hops: [
    {
      fromSystemID: ORIGIN_SYSTEM,
      toSystemID: DEST_SYSTEM,
      gateToWarpID: GATE_ORIGIN,
      jumpToGateID: GATE_DEST,
    },
  ],
};

interface Call {
  readonly m: "undock" | "warp" | "jump" | "dock";
  readonly a?: readonly number[];
}

function refusal(message: string, code = "CALL_REFUSED"): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

/**
 * A fake in-space server. `getStatus` advances warp/jump timers on each read
 * (warp completes after one poll; a jump hands off to the new system after one
 * poll), so the loop observes real transitions. Docking refuses `DockingApproach`
 * `dockRefusals` times (entering a FOLLOW approach) before it docks.
 */
function makeMock(opts: { dockRefusals?: number; warpBehavior?: (dest: number) => void } = {}) {
  const state = {
    docked: true,
    inSpace: false,
    system: ORIGIN_SYSTEM,
    stationID: ORIGIN_STATION as number | null,
    shipMode: null as string | null,
    warpTicks: 0,
    jumpTicks: 0,
    jumpTarget: null as number | null,
    dockRefusalsRemaining: opts.dockRefusals ?? 1,
  };
  const calls: Call[] = [];

  function snapshot(): FlightStatus {
    if (state.warpTicks > 0) {
      state.warpTicks -= 1;
      if (state.warpTicks === 0) {
        state.shipMode = "STOP";
      }
    }
    if (state.jumpTicks > 0) {
      state.jumpTicks -= 1;
      if (state.jumpTicks === 0 && state.jumpTarget !== null) {
        state.system = state.jumpTarget;
        state.jumpTarget = null;
      }
    }
    return {
      inSpace: state.inSpace,
      docked: state.docked,
      solarSystemID: state.system,
      stationID: state.docked ? state.stationID : null,
      structureID: null,
      shipID: SHIP_ID,
      shipMode: state.docked ? null : state.shipMode,
      shipSpeedFraction: state.shipMode === "WARP" ? 1 : 0,
    };
  }

  return {
    calls,
    state,
    getStatus: async (): Promise<FlightStatus> => snapshot(),
    undock: async (): Promise<void> => {
      calls.push({ m: "undock" });
      state.docked = false;
      state.inSpace = true;
      state.stationID = null;
      state.shipMode = "STOP";
    },
    warp: async (dest: number): Promise<void> => {
      calls.push({ m: "warp", a: [dest] });
      if (opts.warpBehavior) {
        opts.warpBehavior(dest);
      }
      state.shipMode = "WARP";
      state.warpTicks = 1;
    },
    jump: async (from: number, to: number): Promise<void> => {
      calls.push({ m: "jump", a: [from, to] });
      state.jumpTicks = 1;
      state.jumpTarget = DEST_SYSTEM;
      state.shipMode = "STOP";
    },
    dock: async (station: number): Promise<void> => {
      calls.push({ m: "dock", a: [station] });
      if (state.dockRefusalsRemaining > 0) {
        state.dockRefusalsRemaining -= 1;
        state.shipMode = "FOLLOW"; // enters approach
        throw refusal("CmdDock refused: DockingApproach (too far, approaching).");
      }
      state.docked = true;
      state.inSpace = false;
      state.stationID = station;
      state.shipMode = null;
    },
  };
}

function makeDeps(mock: ReturnType<typeof makeMock>): {
  deps: AutopilotDeps;
  progress: AutopilotProgress[];
} {
  const progress: AutopilotProgress[] = [];
  return {
    progress,
    deps: {
      getStatus: mock.getStatus,
      undock: mock.undock,
      warp: mock.warp,
      jump: mock.jump,
      dock: mock.dock,
      sleep: async () => {},
      now: () => 0,
      onProgress: (p) => progress.push(p),
      isSessionLost: (e) => (e as { code?: string })?.code === "SESSION_NOT_FOUND",
      refusalReason: (e) => (e instanceof Error ? e.message : String(e)),
    },
  };
}

async function drive(
  controller: AutopilotController,
  maxTicks = 60,
): Promise<AutopilotAction[]> {
  const actions: AutopilotAction[] = [];
  for (let i = 0; i < maxTicks; i += 1) {
    const snap = controller.snapshot();
    if (snap.status !== "running") {
      break;
    }
    actions.push(await controller.tick());
  }
  return actions;
}

test("the loop sequences undock -> warp gate -> jump -> warp station -> dock (with approach-then-redock) -> arrived", async () => {
  const mock = makeMock({ dockRefusals: 1 });
  const { deps } = makeDeps(mock);
  const controller = createAutopilot(deps);

  controller.start(PLAN);
  await drive(controller);

  assert.deepEqual(mock.calls, [
    { m: "undock" },
    { m: "warp", a: [GATE_ORIGIN] },
    { m: "jump", a: [GATE_ORIGIN, GATE_DEST] },
    { m: "warp", a: [DEST_STATION] },
    { m: "dock", a: [DEST_STATION] }, // refused (DockingApproach) -> FOLLOW
    { m: "dock", a: [DEST_STATION] }, // re-issued once in range -> docked
  ]);
  const snap = controller.snapshot();
  assert.equal(snap.status, "arrived");
  assert.equal(snap.remainingJumps, 0);
  assert.equal(snap.totalJumps, 1);
});

test("approach-then-redock: dock is re-issued repeatedly until in range", async () => {
  // Three DockingApproach refusals before the dock accepts.
  const mock = makeMock({ dockRefusals: 3 });
  const { deps } = makeDeps(mock);
  const controller = createAutopilot(deps);

  controller.start(PLAN);
  await drive(controller, 120);

  const dockCalls = mock.calls.filter((c) => c.m === "dock");
  assert.equal(dockCalls.length, 4, "3 approach refusals + 1 successful dock");
  assert.equal(controller.snapshot().status, "arrived");
});

test("the loop pauses (does not guess) on an injected warp-scramble refusal", async () => {
  const mock = makeMock({
    warpBehavior: (dest) => {
      if (dest === GATE_ORIGIN) {
        throw refusal("You cannot warp while warp scrambled.");
      }
    },
  });
  const { deps } = makeDeps(mock);
  const controller = createAutopilot(deps);

  controller.start(PLAN);
  await drive(controller);

  const snap = controller.snapshot();
  assert.equal(snap.status, "paused");
  assert.match(snap.failureReason ?? "", /warp scrambled/i);
  // Undock + the refused warp were issued; nothing past the pause.
  assert.deepEqual(
    mock.calls.map((c) => c.m),
    ["undock", "warp"],
  );
});

test("abort stops the loop and it never calls the bridge afterward", async () => {
  const mock = makeMock();
  const { deps } = makeDeps(mock);
  const controller = createAutopilot(deps);

  controller.start(PLAN);
  await controller.tick(); // undock
  assert.deepEqual(mock.calls.map((c) => c.m), ["undock"]);

  controller.abort();
  const callsAtAbort = mock.calls.length;

  // Any further ticks are no-ops that issue nothing.
  const action1 = await controller.tick();
  const action2 = await controller.tick();
  assert.equal(action1.kind, "aborted");
  assert.equal(action2.kind, "aborted");
  assert.equal(mock.calls.length, callsAtAbort, "no bridge call after abort");
  assert.equal(controller.snapshot().status, "aborted");
});

test("pause then resume continues the route from where it stopped", async () => {
  const mock = makeMock();
  const { deps } = makeDeps(mock);
  const controller = createAutopilot(deps);

  controller.start(PLAN);
  await controller.tick(); // undock
  controller.pause();
  const pausedCalls = mock.calls.length;

  // Paused: ticks issue nothing.
  await controller.tick();
  assert.equal(mock.calls.length, pausedCalls);
  assert.equal(controller.snapshot().status, "paused");

  controller.resume();
  await drive(controller);
  assert.equal(controller.snapshot().status, "arrived");
  assert.ok(mock.calls.some((c) => c.m === "jump"), "route completed after resume");
});

test("a lost session during the loop stops it as an error (no further bridge calls)", async () => {
  const mock = makeMock();
  const lostDeps = makeDeps(mock);
  // Make undock report a lost session.
  const deps: AutopilotDeps = {
    ...lostDeps.deps,
    undock: async () => {
      throw refusal("Bridge session gone.", "SESSION_NOT_FOUND");
    },
  };
  const controller = createAutopilot(deps);

  controller.start(PLAN);
  await controller.tick(); // undock -> session lost
  const callsAfter = mock.calls.length;
  await controller.tick();

  const snap = controller.snapshot();
  assert.equal(snap.status, "error");
  assert.match(snap.failureReason ?? "", /session ended/i);
  assert.equal(mock.calls.length, callsAfter, "no further bridge calls after session loss");
});

// --- direct decision-function assertions (the pure branches) ---------------

function status(overrides: Partial<FlightStatus>): FlightStatus {
  return {
    inSpace: false,
    docked: false,
    solarSystemID: ORIGIN_SYSTEM,
    stationID: null,
    structureID: null,
    shipID: SHIP_ID,
    shipMode: null,
    shipSpeedFraction: null,
    ...overrides,
  };
}

const COMPILED = {
  ...PLAN,
  hopsByFromSystem: new Map(PLAN.hops.map((h) => [h.fromSystemID, h])),
  totalJumps: PLAN.hops.length,
};

test("decide: docked away from destination -> undock; docked at destination -> arrived", () => {
  assert.equal(
    decideAutopilotAction(status({ docked: true, solarSystemID: ORIGIN_SYSTEM, stationID: ORIGIN_STATION }), COMPILED, {
      warpedInSystem: null,
      jumpedFromSystem: null,
    }).kind,
    "undock",
  );
  assert.equal(
    decideAutopilotAction(
      status({ docked: true, solarSystemID: DEST_SYSTEM, stationID: DEST_STATION }),
      COMPILED,
      { warpedInSystem: null, jumpedFromSystem: null },
    ).kind,
    "arrived",
  );
});

test("decide: in warp -> wait; at gate system already warped -> jump", () => {
  assert.equal(
    decideAutopilotAction(status({ inSpace: true, shipMode: "WARP", solarSystemID: ORIGIN_SYSTEM }), COMPILED, {
      warpedInSystem: null,
      jumpedFromSystem: null,
    }).kind,
    "wait",
  );
  const jump = decideAutopilotAction(
    status({ inSpace: true, shipMode: "STOP", solarSystemID: ORIGIN_SYSTEM }),
    COMPILED,
    { warpedInSystem: ORIGIN_SYSTEM, jumpedFromSystem: null },
  );
  assert.equal(jump.kind, "jump");
  if (jump.kind === "jump") {
    assert.equal(jump.fromGateID, GATE_ORIGIN);
    assert.equal(jump.toGateID, GATE_DEST);
  }
});

test("decide: jump handoff (still in old system) waits", () => {
  const action = decideAutopilotAction(
    status({ inSpace: true, shipMode: "STOP", solarSystemID: ORIGIN_SYSTEM }),
    COMPILED,
    { warpedInSystem: ORIGIN_SYSTEM, jumpedFromSystem: ORIGIN_SYSTEM },
  );
  assert.equal(action.kind, "wait");
});

test("decide: off-route system pauses", () => {
  const action = decideAutopilotAction(
    status({ inSpace: true, shipMode: "STOP", solarSystemID: 39999999 }),
    COMPILED,
    { warpedInSystem: null, jumpedFromSystem: null },
  );
  assert.equal(action.kind, "pause");
});
