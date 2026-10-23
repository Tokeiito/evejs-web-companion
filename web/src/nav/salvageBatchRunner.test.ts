import test from "node:test";
import assert from "node:assert/strict";
import { SCRIPT_MACROS, settleSalvageBatchMemory } from "./scriptMacros.ts";
import { issueSalvageBatch } from "./salvageBatchIssue.ts";
import { createScriptRunner } from "./scriptRunner.ts";
import type { BotScript, MacroStep } from "../bots/botScript.ts";
import type { ScriptObservation } from "./scriptConditions.ts";
import type { SalvageBatchOutcome, SalvageBatchStep, ScriptAction } from "./scriptDecide.ts";

const FROM = 7000001, DONE = 7000002, SITE = 9000011, HERE = 30000142, HOME = 60000004;
const FIRST = 4101, SECOND = 4102, CAN = 4103;
const step: MacroStep = { id: "salvager", kind: "macro", macro: "salvage-bookmarked-sites", args: {
  fromFolder: { kind: "bookmarkFolder", folderID: FROM, name: "To Salvage" },
  doneFolder: { kind: "bookmarkFolder", folderID: DONE, name: "Salvaged" },
  station: { kind: "station", ref: { entity: "station", id: HOME, name: "Home", systemName: null } },
} };
const doc: BotScript = { format: "evejs-bot-script", version: 1, name: "Salvager", notes: "",
  home: { entity: "station", id: HOME, name: "Home", systemName: null }, interrupts: [], program: [step] };

function scenario(issueStep: (step: SalvageBatchStep) => Promise<void>, secondWreck = true) {
  const issued: ScriptAction[] = [];
  const calls: SalvageBatchStep[] = [];
  const locked = new Set<number>();
  const active = new Map<number, number>();
  const entity = (itemID: number, kind: string, x: number) => ({ itemID, kind, ownerID: 90000001,
    corporationID: null, position: { x, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } });
  const observe = (): ScriptObservation => ({
    inSpace: true, docked: false, inWarp: false, health: 1, shieldRatio: 1, armorRatio: 1, hullRatio: 1,
    holdEmpty: true, hostileOnGrid: false, dronesOut: false, myCharacterID: 90000001,
    flightStatus: { inSpace: true, docked: false, solarSystemID: HERE, stationID: null, structureID: null, shipID: 9001 },
    bookmarkFolders: { known: [
      { folderID: FROM, name: "To Salvage", isPersonal: false, isActive: true },
      { folderID: DONE, name: "Salvaged", isPersonal: false, isActive: true },
    ], addable: [] },
    bookmarks: [{ bookmarkID: SITE, name: "Site", folderID: FROM, solarSystemID: HERE, position: { x: 0, y: 0, z: 0 } }],
    salvageModuleIDs: [501], tractorModuleIDs: [], lockedTargetIDs: [...locked], maxLockedTargets: 10, maxTargetRangeM: 30000,
    snapshot: { ship: { itemID: 9001, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      activeModuleIDs: [...active.keys()], activeModuleTargets: [...active].map(([moduleID, targetID]) => ({ moduleID, targetID })),
      moduleRanges: [] }, entities: [entity(FIRST, "wreck", 1200), ...(secondWreck ? [entity(SECOND, "wreck", 1500)] : []), entity(CAN, "container", 1000)] },
  } as unknown as ScriptObservation);
  const dispatch = async (substep: SalvageBatchStep) => {
    calls.push(substep);
    await issueStep(substep);
    if (substep.kind === "lock") locked.add(substep.targetID);
    if (substep.kind === "unlock") locked.delete(substep.targetID);
    if (substep.kind === "activate") active.set(substep.moduleID, substep.targetID);
    if (substep.kind === "deactivate") active.delete(substep.moduleID);
  };
  const runner = createScriptRunner({ observe: async () => observe(),
    issue: async (action) => {
      issued.push(action);
      if (action.kind === "salvageBatch") return issueSalvageBatch(action.steps, dispatch, () => false);
      if (action.kind === "lock" || action.kind === "unlock" || action.kind === "activate" || action.kind === "deactivate") await dispatch(action);
    }, sleep: async () => {}, onProgress: () => {}, isSessionLost: () => false,
    refusalReason: (error) => error instanceof Error ? error.message : String(error),
    registry: SCRIPT_MACROS,
    travelHome: () => ({ action: { kind: "wait" }, why: "Home", phase: "Home", armed: false, outcome: { kind: "done" }, nextMem: {} }),
  });
  runner.start(doc);
  return { runner, calls, issued };
}

for (const [partial, secondWreck] of [[false, true], [true, true], [false, false]] as const) {
  test(`salvage retries retain each refused wreck's three attempts and continue looting, partial success ${partial}, second wreck ${secondWreck}`, async () => {
    const { runner, calls, issued } = scenario(async (substep) => {
      if (substep.kind === "lock" && (!partial || substep.targetID === FIRST)) {
        throw Object.assign(new Error("TargetingAttemptCancelled"), { code: "CALL_REFUSED" });
      }
    }, secondWreck);
    for (let i = 0; i < 150 && !issued.some((action) => action.kind === "lootWreck" && action.wreckID === CAN); i++) {
      assert.equal(runner.getStatus(), "running", runner.snapshot().pauseReason ?? "");
      await runner.tick();
    }
    assert.ok(issued.some((action) => action.kind === "lootWreck" && action.wreckID === CAN), "the can is looted after the refused wrecks are set aside");
    assert.equal(calls.filter((action) => action.kind === "lock" && action.targetID === FIRST).length, 3);
    assert.equal(calls.filter((action) => action.kind === "lock" && action.targetID === SECOND).length, !secondWreck ? 0 : partial ? 1 : 3);
    assert.equal(runner.snapshot().refusals.find((record) => record.key === `salvager:lock:${FIRST}`)?.count, 3);
    assert.ok(!runner.snapshot().refusals.some((record) => record.key.includes(":salvageBatch:")));
    if (partial) assert.equal(calls.filter((action) => action.kind === "activate" && action.targetID === SECOND).length, 1);
  });
}

test("an interrupted salvage batch keeps confirmed prefix bookkeeping and blocks subsequent writes", async () => {
  const failure = Object.assign(new Error("The module's outcome is unknown"), { code: "MODULE_ACTION_UNCERTAIN" });
  const { runner, calls } = scenario(async (substep) => { if (substep.kind === "lock" && substep.targetID === SECOND) throw failure; });
  for (let i = 0; i < 10 && runner.getStatus() === "running"; i++) await runner.tick();
  assert.equal(runner.getStatus(), "paused");
  assert.match(runner.snapshot().pauseReason ?? "", /before every outcome was confirmed/);
  assert.deepEqual(calls, [{ kind: "lock", targetID: FIRST }, { kind: "lock", targetID: SECOND }]);
  runner.resume();
  await runner.tick();
  assert.equal(runner.getStatus(), "paused");
  assert.equal(calls.length, 2);
  const outcomes = (failure as unknown as { salvageBatchOutcomes: SalvageBatchOutcome[] }).salvageBatchOutcomes;
  const memory = settleSalvageBatchMemory({ work: { pending: {}, tries: {}, lockTries: {}, lastSet: {} } }, outcomes);
  assert.deepEqual(memory["work"], { pending: { [FIRST]: 0 }, tries: { [FIRST]: 1 }, lockTries: { [FIRST]: 1 }, lastSet: {} });
});

