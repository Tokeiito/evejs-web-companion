"use strict";

(function exposeMutationScope(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.EveMutationScope = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function createMutationScopeApi() {
  const ORIGIN_CLASSIFICATION = Object.freeze({
    EXACT: "exact",
    SAME_VIEW_STALE: "same_view_stale",
    DETACHED: "detached",
  });

  function generation(value) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
  }

  function characterID(value) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isArrayOfPlainObjects(value) {
    return Array.isArray(value) && value.every(isPlainObject);
  }

  function hasFiniteNumberFields(value, fields) {
    return fields.every((field) => Number.isFinite(value[field]));
  }

  function validateMutationDashboardPayload(
    payload,
    kind,
    expectedCharacterID,
    options = {},
  ) {
    if (!isPlainObject(payload) || payload.ok !== true || !isPlainObject(payload.dashboard)) {
      return false;
    }
    const dashboard = payload.dashboard;
    const expected = characterID(expectedCharacterID);
    const submittedStateVersion = typeof options.expectedStateVersion === "string"
      ? options.expectedStateVersion
      : "";
    if (
      !expected ||
      typeof payload.stateVersion !== "string" ||
      payload.stateVersion.length === 0 ||
      (submittedStateVersion && payload.stateVersion === submittedStateVersion) ||
      dashboard.stateVersion !== payload.stateVersion ||
      !isPlainObject(dashboard.character) ||
      characterID(dashboard.character.characterID) !== expected ||
      typeof dashboard.character.characterName !== "string"
    ) {
      return false;
    }
    if (kind === "skill-queue") {
      return isPlainObject(dashboard.summary) &&
        typeof dashboard.summary.queueActive === "boolean" &&
        hasFiniteNumberFields(dashboard.summary, [
          "trainedSkillCount",
          "totalSkillPoints",
          "queuedSkillCount",
          "freeSkillPoints",
        ]) &&
        isPlainObject(dashboard.queue) &&
        typeof dashboard.queue.active === "boolean" &&
        Number.isFinite(dashboard.queue.freeSkillPoints) &&
        isArrayOfPlainObjects(dashboard.queue.queue) &&
        dashboard.queue.queue.every((entry) => (
          characterID(entry.typeID) > 0 &&
          Number.isSafeInteger(entry.toLevel) &&
          entry.toLevel >= 1 &&
          entry.toLevel <= 5
        )) &&
        isArrayOfPlainObjects(dashboard.skills) &&
        dashboard.skills.every((skill) => (
          characterID(skill.typeID) > 0 &&
          typeof skill.name === "string" &&
          typeof skill.groupName === "string" &&
          Number.isFinite(skill.level) &&
          Number.isFinite(skill.rank)
        )) &&
        isArrayOfPlainObjects(dashboard.groups) &&
        dashboard.groups.every((group) => (
          typeof group.groupName === "string" && Number.isFinite(group.skillPoints)
        )) &&
        (!submittedStateVersion || dashboard.queueSaveSource === "evejs-web-gateway");
    }
    if (kind === "pi-restart") {
      return isPlainObject(dashboard.summary) &&
        hasFiniteNumberFields(dashboard.summary, [
          "colonyCount",
          "extractorCount",
          "activeExtractorCount",
          "expiredExtractorCount",
          "needsRestartCount",
          "launchCount",
        ]) &&
        isArrayOfPlainObjects(dashboard.colonies) &&
        dashboard.colonies.every((colony) => (
          characterID(colony.planetID) > 0 &&
          isArrayOfPlainObjects(colony.extractors)
        )) &&
        isArrayOfPlainObjects(dashboard.launches) &&
        (!submittedStateVersion || (
          isPlainObject(dashboard.restartSummary) &&
          hasFiniteNumberFields(dashboard.restartSummary, [
            "colonyCount",
            "restartedCount",
            "failedCount",
          ])
        ));
    }
    return false;
  }

  function canonicalSkillDraftKey(entries) {
    if (entries === null || entries === undefined) {
      return null;
    }
    if (!Array.isArray(entries)) {
      throw new TypeError("Skill queue draft must be an array.");
    }
    return JSON.stringify(entries.map((entry) => {
      if (!entry || typeof entry !== "object") {
        throw new TypeError("Skill queue draft entries must be objects.");
      }
      const typeID = Number(entry.typeID);
      const toLevel = Number(entry.toLevel);
      if (!Number.isSafeInteger(typeID) || typeID <= 0) {
        throw new TypeError("Skill queue draft typeID values must be positive integers.");
      }
      if (!Number.isSafeInteger(toLevel) || toLevel < 1 || toLevel > 5) {
        throw new TypeError("Skill queue draft toLevel values must be integers from 1 to 5.");
      }
      return [typeID, toLevel];
    }));
  }

  function captureMutationOrigin(state, options = {}) {
    if (!state || typeof state !== "object") {
      throw new TypeError("Mutation state is required.");
    }
    const page = String(state.page || "");
    if (options.expectedPage && page !== options.expectedPage) {
      throw new TypeError(`Mutation must originate from the ${options.expectedPage} page.`);
    }
    const draftProperty = typeof options.draftProperty === "string"
      ? options.draftProperty
      : null;
    const submittedDraft = Object.prototype.hasOwnProperty.call(options, "submittedSkillDraft")
      ? options.submittedSkillDraft
      : draftProperty
        ? state[draftProperty]
        : null;
    return Object.freeze({
      authGeneration: generation(state.authGeneration),
      viewGeneration: generation(state.viewGeneration),
      characterID: characterID(state.selectedCharacterID),
      page,
      pageData: state.data,
      draftProperty,
      submittedSkillDraftKey: draftProperty
        ? canonicalSkillDraftKey(submittedDraft)
        : null,
    });
  }

  function beginViewLoad(state) {
    if (!state || typeof state !== "object") {
      throw new TypeError("View state is required.");
    }
    const nextGeneration = generation(state.viewGeneration) + 1;
    if (!Number.isSafeInteger(nextGeneration)) {
      throw new TypeError("View generation is unavailable.");
    }
    state.viewGeneration = nextGeneration;
    return Object.freeze({
      authGeneration: generation(state.authGeneration),
      viewGeneration: nextGeneration,
      characterID: characterID(state.selectedCharacterID),
      page: String(state.page || ""),
    });
  }

  function isViewLoadCurrent(state, context) {
    return Boolean(state && context) &&
      generation(state.authGeneration) === context.authGeneration &&
      generation(state.viewGeneration) === context.viewGeneration &&
      characterID(state.selectedCharacterID) === context.characterID &&
      String(state.page || "") === context.page;
  }

  function classifyMutationOrigin(state, origin) {
    if (!state || typeof state !== "object" || !origin || typeof origin !== "object") {
      return ORIGIN_CLASSIFICATION.DETACHED;
    }
    if (
      generation(state.authGeneration) !== origin.authGeneration ||
      characterID(state.selectedCharacterID) !== origin.characterID ||
      String(state.page || "") !== origin.page
    ) {
      return ORIGIN_CLASSIFICATION.DETACHED;
    }
    if (
      generation(state.viewGeneration) !== origin.viewGeneration ||
      state.data !== origin.pageData
    ) {
      return ORIGIN_CLASSIFICATION.SAME_VIEW_STALE;
    }
    if (
      origin.draftProperty &&
      canonicalSkillDraftKey(state[origin.draftProperty]) !== origin.submittedSkillDraftKey
    ) {
      return ORIGIN_CLASSIFICATION.SAME_VIEW_STALE;
    }
    return ORIGIN_CLASSIFICATION.EXACT;
  }

  function isMutationOriginCurrent(state, origin) {
    return classifyMutationOrigin(state, origin) === ORIGIN_CLASSIFICATION.EXACT;
  }

  function deleteMapEntryIfRecordMatches(map, key, record) {
    if (!map || typeof map.get !== "function" || typeof map.delete !== "function") {
      throw new TypeError("A Map-like value is required.");
    }
    if (map.get(key) !== record) {
      return false;
    }
    return map.delete(key);
  }

  function reconcileRetainedCommandSettlement(map, key, settlement) {
    if (!map || typeof map.get !== "function") {
      throw new TypeError("A Map-like value is required.");
    }
    const record = map.get(key);
    const commandID = record && record.request && record.request.commandID;
    if (
      !record ||
      !settlement ||
      typeof settlement !== "object" ||
      typeof commandID !== "string" ||
      settlement.commandID !== commandID
    ) {
      return null;
    }
    record.authoritativeSettlement = settlement;
    return deleteMapEntryIfRecordMatches(map, key, record) ? record : null;
  }

  function shouldPreserveSkillDraftAfterSuccess(state, origin) {
    return Boolean(
      state &&
      origin &&
      origin.draftProperty &&
      state.skillQueueDirty === true &&
      canonicalSkillDraftKey(state[origin.draftProperty]) !==
        origin.submittedSkillDraftKey
    );
  }

  function shouldReconcileDefinitiveCommandError(error, sameViewStale = false) {
    if (error && error.uncertain === true) {
      return false;
    }
    return sameViewStale === true || Number(error && error.status) > 0;
  }

  async function runPendingAuthTransition(operation, onPending, onSettled) {
    if (
      typeof operation !== "function" ||
      typeof onPending !== "function" ||
      typeof onSettled !== "function"
    ) {
      throw new TypeError("Auth transition callbacks are required.");
    }
    onPending();
    try {
      return await operation();
    } finally {
      onSettled();
    }
  }

  return Object.freeze({
    ORIGIN_CLASSIFICATION,
    beginViewLoad,
    canonicalSkillDraftKey,
    captureMutationOrigin,
    classifyMutationOrigin,
    deleteMapEntryIfRecordMatches,
    isMutationOriginCurrent,
    isViewLoadCurrent,
    reconcileRetainedCommandSettlement,
    runPendingAuthTransition,
    shouldReconcileDefinitiveCommandError,
    shouldPreserveSkillDraftAfterSuccess,
    validateMutationDashboardPayload,
  });
});
