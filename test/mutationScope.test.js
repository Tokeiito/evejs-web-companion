"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const mutationScope = require("../public/mutationScope");

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function skillState() {
  return {
    authGeneration: 3,
    viewGeneration: 8,
    selectedCharacterID: 7,
    page: "skills",
    data: { dashboard: { character: { characterID: 7 } } },
    skillQueueDraft: [{ typeID: 3300, toLevel: 4 }],
  };
}

function captureSkillOrigin(state) {
  return mutationScope.captureMutationOrigin(state, {
    expectedPage: "skills",
    draftProperty: "skillQueueDraft",
    submittedSkillDraft: state.skillQueueDraft.map((entry) => ({ ...entry })),
  });
}

function validMutationDashboard(kind, characterID = 7, stateVersion = "epoch.1") {
  const dashboard = {
    stateVersion,
    character: { characterID, characterName: "Test Pilot" },
  };
  if (kind === "skill-queue") {
    dashboard.summary = {
      trainedSkillCount: 0,
      totalSkillPoints: 0,
      queuedSkillCount: 0,
      freeSkillPoints: 0,
      queueActive: false,
    };
    dashboard.queue = { active: false, freeSkillPoints: 0, queue: [] };
    dashboard.skills = [];
    dashboard.groups = [];
    dashboard.queueSaveSource = "evejs-web-gateway";
  } else {
    dashboard.summary = {
      colonyCount: 0,
      extractorCount: 0,
      activeExtractorCount: 0,
      expiredExtractorCount: 0,
      needsRestartCount: 0,
      launchCount: 0,
    };
    dashboard.colonies = [];
    dashboard.launches = [];
    dashboard.restartSummary = {
      colonyCount: 0,
      restartedCount: 0,
      failedCount: 0,
    };
  }
  return { ok: true, stateVersion, dashboard };
}

test("mutation dashboard validation requires paired versions, the expected character, and renderer shapes", () => {
  for (const kind of ["skill-queue", "pi-restart"]) {
    const valid = validMutationDashboard(kind);
    assert.equal(
      mutationScope.validateMutationDashboardPayload(valid, kind, 7),
      true,
    );
    assert.equal(
      mutationScope.validateMutationDashboardPayload(
        valid,
        kind,
        7,
        { expectedStateVersion: "epoch.0" },
      ),
      true,
    );
    assert.equal(
      mutationScope.validateMutationDashboardPayload(
        valid,
        kind,
        7,
        { expectedStateVersion: "epoch.1" },
      ),
      false,
    );
    assert.equal(
      mutationScope.validateMutationDashboardPayload({ ok: true }, kind, 7),
      false,
    );
    assert.equal(
      mutationScope.validateMutationDashboardPayload(
        { ...valid, stateVersion: "epoch.2" },
        kind,
        7,
      ),
      false,
    );
    assert.equal(
      mutationScope.validateMutationDashboardPayload(valid, kind, 8),
      false,
    );
  }
  const malformedSkills = validMutationDashboard("skill-queue");
  delete malformedSkills.dashboard.skills;
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      malformedSkills,
      "skill-queue",
      7,
    ),
    false,
  );
  const missingGroups = validMutationDashboard("skill-queue");
  delete missingGroups.dashboard.groups;
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      missingGroups,
      "skill-queue",
      7,
    ),
    false,
  );
  const malformedSkill = validMutationDashboard("skill-queue");
  malformedSkill.dashboard.skills.push({ name: "Missing group" });
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      malformedSkill,
      "skill-queue",
      7,
    ),
    false,
  );
  const missingQueueMarker = validMutationDashboard("skill-queue");
  delete missingQueueMarker.dashboard.queueSaveSource;
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      missingQueueMarker,
      "skill-queue",
      7,
      { expectedStateVersion: "epoch.0" },
    ),
    false,
  );
  const missingSkillSummaryField = validMutationDashboard("skill-queue");
  delete missingSkillSummaryField.dashboard.summary.totalSkillPoints;
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      missingSkillSummaryField,
      "skill-queue",
      7,
    ),
    false,
  );
  const malformedPi = validMutationDashboard("pi-restart");
  delete malformedPi.dashboard.colonies;
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      malformedPi,
      "pi-restart",
      7,
    ),
    false,
  );
  const malformedColony = validMutationDashboard("pi-restart");
  malformedColony.dashboard.colonies.push({ planetID: 9 });
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      malformedColony,
      "pi-restart",
      7,
    ),
    false,
  );
  const malformedExtractor = validMutationDashboard("pi-restart");
  malformedExtractor.dashboard.colonies.push({ planetID: 9, extractors: [null] });
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      malformedExtractor,
      "pi-restart",
      7,
    ),
    false,
  );
  const missingRestartSummary = validMutationDashboard("pi-restart");
  delete missingRestartSummary.dashboard.restartSummary;
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      missingRestartSummary,
      "pi-restart",
      7,
      { expectedStateVersion: "epoch.0" },
    ),
    false,
  );
  const missingPiSummaryField = validMutationDashboard("pi-restart");
  delete missingPiSummaryField.dashboard.summary.launchCount;
  assert.equal(
    mutationScope.validateMutationDashboardPayload(
      missingPiSummaryField,
      "pi-restart",
      7,
    ),
    false,
  );
});

test("canonical skill-draft keys preserve order and normalize numeric fields", () => {
  assert.equal(
    mutationScope.canonicalSkillDraftKey([
      { typeID: "3300", toLevel: "4", ignored: true },
      { typeID: 4400, toLevel: 2 },
    ]),
    mutationScope.canonicalSkillDraftKey([
      { typeID: 3300, toLevel: 4 },
      { typeID: "4400", toLevel: "2" },
    ]),
  );
  assert.notEqual(
    mutationScope.canonicalSkillDraftKey([
      { typeID: 3300, toLevel: 4 },
      { typeID: 4400, toLevel: 2 },
    ]),
    mutationScope.canonicalSkillDraftKey([
      { typeID: 4400, toLevel: 2 },
      { typeID: 3300, toLevel: 4 },
    ]),
  );
});

test("an auth boundary detaches a captured mutation", () => {
  const state = skillState();
  const origin = captureSkillOrigin(state);

  state.authGeneration += 1;

  assert.equal(
    mutationScope.classifyMutationOrigin(state, origin),
    mutationScope.ORIGIN_CLASSIFICATION.DETACHED,
  );
  assert.equal(mutationScope.isMutationOriginCurrent(state, origin), false);
});

test("a same-page refresh makes a captured mutation stale without detaching it", () => {
  const state = skillState();
  const origin = captureSkillOrigin(state);

  state.viewGeneration += 1;
  state.data = { dashboard: { character: { characterID: 7 }, refreshed: true } };

  assert.equal(
    mutationScope.classifyMutationOrigin(state, origin),
    mutationScope.ORIGIN_CLASSIFICATION.SAME_VIEW_STALE,
  );
});

test("an in-place semantic draft edit makes a captured mutation stale", () => {
  const state = skillState();
  const origin = captureSkillOrigin(state);
  assert.equal(
    mutationScope.classifyMutationOrigin(state, origin),
    mutationScope.ORIGIN_CLASSIFICATION.EXACT,
  );

  state.skillQueueDraft[0].toLevel = 5;

  assert.equal(
    mutationScope.classifyMutationOrigin(state, origin),
    mutationScope.ORIGIN_CLASSIFICATION.SAME_VIEW_STALE,
  );
});

test("cross-character and cross-page completions are detached", () => {
  const state = skillState();
  const characterOrigin = captureSkillOrigin(state);
  state.selectedCharacterID = 8;
  assert.equal(
    mutationScope.classifyMutationOrigin(state, characterOrigin),
    mutationScope.ORIGIN_CLASSIFICATION.DETACHED,
  );

  state.selectedCharacterID = 7;
  const pageOrigin = captureSkillOrigin(state);
  state.page = "pi";
  assert.equal(
    mutationScope.classifyMutationOrigin(state, pageOrigin),
    mutationScope.ORIGIN_CLASSIFICATION.DETACHED,
  );
});

test("a delayed A completion cannot compare-delete B's replacement record", async () => {
  const retained = new Map();
  const key = "7:skill-queue";
  const recordA = { commandID: "command-a" };
  const recordB = { commandID: "command-b" };
  const gate = deferred();
  retained.set(key, recordA);

  const completion = gate.promise.then(() => (
    mutationScope.deleteMapEntryIfRecordMatches(retained, key, recordA)
  ));
  retained.set(key, recordB);
  gate.resolve();

  assert.equal(await completion, false);
  assert.equal(retained.get(key), recordB);
  assert.equal(
    mutationScope.deleteMapEntryIfRecordMatches(retained, key, recordB),
    true,
  );
  assert.equal(retained.has(key), false);
});

test("settlement reconciliation clears only an exact retained command ID", () => {
  const retained = new Map();
  const key = "7:skill-queue";
  const record = {
    request: Object.freeze({
      commandID: "command-a",
      serializedBody: '{"commandID":"command-a"}',
    }),
  };
  retained.set(key, record);

  assert.equal(
    mutationScope.reconcileRetainedCommandSettlement(retained, key, {
      commandID: "command-b",
      success: true,
    }),
    null,
  );
  assert.equal(retained.get(key), record);
  const settlement = Object.freeze({ commandID: "command-a", success: true });
  assert.equal(
    mutationScope.reconcileRetainedCommandSettlement(retained, key, settlement),
    record,
  );
  assert.equal(record.authoritativeSettlement, settlement);
  assert.equal(retained.has(key), false);
  assert.equal(record.request.serializedBody, '{"commandID":"command-a"}');

  // A settlement replay after the HTTP completion is harmless.
  assert.equal(
    mutationScope.reconcileRetainedCommandSettlement(retained, key, settlement),
    null,
  );
});

test("a view refresh never clears a genuinely uncertain retained command", () => {
  const state = skillState();
  const retained = new Map();
  const record = {
    request: Object.freeze({
      commandID: "uncertain-command",
      serializedBody: '{"commandID":"uncertain-command"}',
    }),
  };
  retained.set("skill-queue:7", record);

  const context = mutationScope.beginViewLoad(state);
  state.data = { dashboard: { stateVersion: "epoch.2" } };
  assert.equal(mutationScope.isViewLoadCurrent(state, context), true);
  assert.equal(retained.get("skill-queue:7"), record);
  assert.equal(record.request.serializedBody, '{"commandID":"uncertain-command"}');
});

test("only the newest generation-guarded view load can apply", async () => {
  const state = skillState();
  const firstGate = deferred();
  const secondGate = deferred();

  const applyLoad = async (context, gate) => {
    const payload = await gate.promise;
    if (!mutationScope.isViewLoadCurrent(state, context)) {
      return false;
    }
    state.data = payload;
    return true;
  };

  const firstContext = mutationScope.beginViewLoad(state);
  const first = applyLoad(firstContext, firstGate);
  const secondContext = mutationScope.beginViewLoad(state);
  const second = applyLoad(secondContext, secondGate);
  const latestData = { dashboard: { stateVersion: "epoch.2" } };
  secondGate.resolve(latestData);
  assert.equal(await second, true);

  firstGate.resolve({ dashboard: { stateVersion: "epoch.1" } });
  assert.equal(await first, false);
  assert.equal(state.data, latestData);
});

test("same-view reconciliation uses a post-settlement load and clears only an unchanged submitted draft", async () => {
  const state = skillState();
  state.skillQueueDirty = true;
  const origin = captureSkillOrigin(state);

  const preCommandRefresh = mutationScope.beginViewLoad(state);
  const preCommandData = { dashboard: { stateVersion: "epoch.0" } };
  state.data = preCommandData;
  assert.equal(mutationScope.isViewLoadCurrent(state, preCommandRefresh), true);
  assert.equal(
    mutationScope.classifyMutationOrigin(state, origin),
    mutationScope.ORIGIN_CLASSIFICATION.SAME_VIEW_STALE,
  );
  assert.equal(
    mutationScope.shouldPreserveSkillDraftAfterSuccess(state, origin),
    false,
  );

  const reconcileGate = deferred();
  const reconcileContext = mutationScope.beginViewLoad(state);
  const reconcile = reconcileGate.promise.then((freshData) => {
    if (!mutationScope.isViewLoadCurrent(state, reconcileContext)) {
      return false;
    }
    state.data = freshData;
    if (!mutationScope.shouldPreserveSkillDraftAfterSuccess(state, origin)) {
      state.skillQueueDraft = null;
      state.skillQueueDirty = false;
    }
    return true;
  });
  const postCommandData = { dashboard: { stateVersion: "epoch.1" } };
  reconcileGate.resolve(postCommandData);

  assert.equal(await reconcile, true);
  assert.equal(state.data, postCommandData);
  assert.notEqual(state.data, preCommandData);
  assert.equal(state.skillQueueDraft, null);
  assert.equal(state.skillQueueDirty, false);
});

test("same-view reconciliation preserves a semantically newer dirty draft", () => {
  const state = skillState();
  state.skillQueueDirty = true;
  const origin = captureSkillOrigin(state);
  state.viewGeneration += 1;
  state.data = { dashboard: { refreshed: true } };
  state.skillQueueDraft[0].toLevel = 5;

  assert.equal(
    mutationScope.classifyMutationOrigin(state, origin),
    mutationScope.ORIGIN_CLASSIFICATION.SAME_VIEW_STALE,
  );
  assert.equal(
    mutationScope.shouldPreserveSkillDraftAfterSuccess(state, origin),
    true,
  );
});

test("definitive remote domain failures reconcile even from an exact view", () => {
  assert.equal(
    mutationScope.shouldReconcileDefinitiveCommandError(
      { status: 400, code: "QueueTooLong", uncertain: false },
      false,
    ),
    true,
  );
  assert.equal(
    mutationScope.shouldReconcileDefinitiveCommandError(
      { status: 0, code: "COMMAND_REQUEST_IN_FLIGHT", uncertain: false },
      false,
    ),
    false,
  );
  assert.equal(
    mutationScope.shouldReconcileDefinitiveCommandError(
      { status: 503, code: "CHARACTER_COMMAND_UNAVAILABLE", uncertain: true },
      true,
    ),
    false,
  );
});

test("a pending logout transition cannot expose login until cookie clearing settles", async () => {
  const logout = deferred();
  const phases = [];
  const transition = mutationScope.runPendingAuthTransition(
    () => logout.promise,
    () => phases.push("pending"),
    () => phases.push("settled"),
  );

  await Promise.resolve();
  assert.deepEqual(phases, ["pending"]);
  logout.resolve("logged-out");
  assert.equal(await transition, "logged-out");
  assert.deepEqual(phases, ["pending", "settled"]);
});
