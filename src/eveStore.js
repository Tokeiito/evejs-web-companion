"use strict";

const eveBridgeClient = require("./eveBridgeClient");
const staticData = require("./staticData");

const ROW_KEY_SEP = "\u001f";
const FILETIME_EPOCH_MS = 11644473600000n;
const FILETIME_TICKS_PER_MS = 10000n;

const RUNTIME_TABLES = new Set([
  "accounts",
  "characters",
  "industryBlueprintState",
  "industryFacilityState",
  "industryJobs",
  "industryRuntime",
  "items",
  "marketEscrow",
  "marketRuntime",
  "planetRuntimeState",
  "skills",
  "skillQueues",
]);

const ROW_GROUPS = {
  industryBlueprintState: ["records"],
  industryJobs: ["jobs"],
  industryRuntime: ["monitors"],
  planetRuntimeState: [
    "resourcesByPlanetID",
    "coloniesByKey",
    "launchesByID",
    "acceptedNetworkEditsByKey",
  ],
};

const SKILL_POINTS_BY_LEVEL = Object.freeze([0, 250, 1415, 8000, 45255, 256000]);
const ATTRIBUTE_PRIMARY_ATTRIBUTE = 180;
const ATTRIBUTE_SECONDARY_ATTRIBUTE = 181;
const ATTRIBUTE_SKILL_TIME_CONSTANT = 275;
const ATTRIBUTE_CHARISMA = 164;
const ATTRIBUTE_INTELLIGENCE = 165;
const ATTRIBUTE_MEMORY = 166;
const ATTRIBUTE_PERCEPTION = 167;
const ATTRIBUTE_WILLPOWER = 168;
const DEFAULT_LEARNING_ATTRIBUTE_VALUE = 20;
const DEFAULT_SKILL_POINTS_PER_MINUTE = 30;

const LEARNING_ATTRIBUTE_NAMES = Object.freeze({
  [ATTRIBUTE_CHARISMA]: "charisma",
  [ATTRIBUTE_INTELLIGENCE]: "intelligence",
  [ATTRIBUTE_MEMORY]: "memory",
  [ATTRIBUTE_PERCEPTION]: "perception",
  [ATTRIBUTE_WILLPOWER]: "willpower",
});

const INVENTORY_FLAG_NAMES = Object.freeze({
  4: "Item Hangar",
  5: "Cargo Hold",
  11: "Low Slot 1",
  12: "Low Slot 2",
  13: "Low Slot 3",
  14: "Low Slot 4",
  15: "Low Slot 5",
  16: "Low Slot 6",
  17: "Low Slot 7",
  18: "Low Slot 8",
  19: "Medium Slot 1",
  20: "Medium Slot 2",
  21: "Medium Slot 3",
  22: "Medium Slot 4",
  23: "Medium Slot 5",
  24: "Medium Slot 6",
  25: "Medium Slot 7",
  26: "Medium Slot 8",
  27: "High Slot 1",
  28: "High Slot 2",
  29: "High Slot 3",
  30: "High Slot 4",
  31: "High Slot 5",
  32: "High Slot 6",
  33: "High Slot 7",
  34: "High Slot 8",
  62: "Corporation Deliveries",
  87: "Drone Bay",
  90: "Ship Maintenance Bay",
  92: "Rig Slot 1",
  93: "Rig Slot 2",
  94: "Rig Slot 3",
  95: "Rig Slot 4",
  96: "Rig Slot 5",
  97: "Rig Slot 6",
  98: "Rig Slot 7",
  99: "Rig Slot 8",
  125: "Subsystem Slot 1",
  126: "Subsystem Slot 2",
  127: "Subsystem Slot 3",
  128: "Subsystem Slot 4",
  129: "Subsystem Slot 5",
  130: "Subsystem Slot 6",
  131: "Subsystem Slot 7",
  132: "Subsystem Slot 8",
  133: "Fuel Bay",
  134: "Mining Hold",
  135: "Gas Hold",
  136: "Mineral Hold",
  137: "Salvage Hold",
  138: "Ship Hold",
  143: "Ammo Hold",
  148: "Command Center Hold",
  149: "Planetary Commodities Hold",
  155: "Fleet Hangar",
  158: "Fighter Bay",
  173: "Deliveries",
  174: "Corpse Bay",
  176: "Booster Bay",
  177: "Subsystem Bay",
  180: "Structure Deed Bay",
  181: "Ice Hold",
  182: "Asteroid Hold",
  183: "Mobile Depot Hold",
  185: "Colony Resources Hold",
  187: "Capsuleer Deliveries",
  188: "Expedition Hold",
});

const INDUSTRY_ACTIVITY_NAMES = Object.freeze({
  1: "Manufacturing",
  3: "Time Efficiency Research",
  4: "Material Efficiency Research",
  5: "Copying",
  8: "Invention",
  9: "Reaction",
});

const INDUSTRY_STATUS_NAMES = Object.freeze({
  0: "Unsubmitted",
  1: "Installed",
  2: "Paused",
  3: "Ready",
  100: "Completed",
  101: "Delivered",
  102: "Cancelled",
  103: "Reverted",
});

const PI_GROUP_EXTRACTION_CONTROL_UNIT = 1063;
const PI_STATE_ACTIVE = 1;

function quoteTable(table) {
  if (!RUNTIME_TABLES.has(table)) {
    throw new Error(`Unsupported EveJS table: ${table}`);
  }
  return `"${table}"`;
}

function cloneValue(value) {
  return value === undefined || value === null
    ? value
    : JSON.parse(JSON.stringify(value));
}

function getSnapshotTable(db, table) {
  quoteTable(table);
  const snapshot = db && db.__snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("EveJS bridge snapshot is required for gameplay data reads.");
  }
  const value = snapshot[table];
  return value && typeof value === "object" ? value : {};
}

async function withDb(callback, options = {}) {
  const snapshot = options.snapshot || await eveBridgeClient.getSnapshot(
    options.accountID,
    options.characterID,
  );
  return callback({ __snapshot: snapshot || {} });
}

function readRow(db, table, key) {
  return cloneValue(getSnapshotTable(db, table)[String(key)] || null);
}

function listRows(db, table) {
  return Object.entries(getSnapshotTable(db, table))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      value: cloneValue(value),
    }));
}

function readWholeTable(db, table) {
  return cloneValue(assembleWrapperRows(table, getSnapshotTable(db, table)));
}

function assembleWrapperRows(table, rows) {
  const groups = new Set(ROW_GROUPS[table] || []);
  if (!groups.size) {
    return rows;
  }
  const object = {};
  for (const [rowKey, value] of Object.entries(rows || {})) {
    const sepIndex = rowKey.indexOf(ROW_KEY_SEP);
    if (sepIndex >= 0) {
      const group = rowKey.slice(0, sepIndex);
      const entityKey = rowKey.slice(sepIndex + 1);
      object[group] = object[group] && typeof object[group] === "object"
        ? object[group]
        : {};
      object[group][entityKey] = value;
    } else if (groups.has(rowKey)) {
      object[rowKey] = {
        ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
        ...(object[rowKey] || {}),
      };
    } else {
      object[rowKey] = value;
    }
  }
  return object;
}

function normalizeBigIntLike(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value.trim());
    }
  } catch (error) {
    return fallback;
  }
  return fallback;
}

function filetimeToMs(value) {
  const ticks = normalizeBigIntLike(value, 0n);
  if (ticks <= 0n) {
    return null;
  }
  if (ticks <= 9999999999999n) {
    return Number(ticks);
  }
  return Number(ticks / FILETIME_TICKS_PER_MS - FILETIME_EPOCH_MS);
}

function filetimeToIso(value) {
  const ms = filetimeToMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

function filetimeTicksToMs(value) {
  const ticks = normalizeBigIntLike(value, 0n);
  if (ticks <= 0n) {
    return null;
  }
  return Number(ticks / FILETIME_TICKS_PER_MS);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSkillPointsForLevel(rank, level) {
  const numericLevel = Math.max(0, Math.min(5, Number(level) || 0));
  return Math.round((Number(rank) || 1) * SKILL_POINTS_BY_LEVEL[numericLevel]);
}

function getPositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function getTrainingSpeedMultiplier() {
  return getPositiveNumber(process.env.EVEJS_SKILL_TRAINING_SPEED, 1);
}

function getCharacterAttributeValue(character, attributeID) {
  const source =
    character &&
    character.raw &&
    character.raw.characterAttributes &&
    typeof character.raw.characterAttributes === "object"
      ? character.raw.characterAttributes
      : {};
  const attributeName = LEARNING_ATTRIBUTE_NAMES[Number(attributeID)];
  return getPositiveNumber(
    source[String(attributeID)] ?? source[attributeID] ?? source[attributeName],
    DEFAULT_LEARNING_ATTRIBUTE_VALUE,
  );
}

function getSkillPointsPerMinute(typeID, character) {
  const primaryAttributeID = Number(
    staticData.getTypeDogmaAttribute(typeID, ATTRIBUTE_PRIMARY_ATTRIBUTE, 0),
  );
  const secondaryAttributeID = Number(
    staticData.getTypeDogmaAttribute(typeID, ATTRIBUTE_SECONDARY_ATTRIBUTE, 0),
  );
  if (!primaryAttributeID || !secondaryAttributeID) {
    return DEFAULT_SKILL_POINTS_PER_MINUTE * getTrainingSpeedMultiplier();
  }
  const primaryValue = getCharacterAttributeValue(character, primaryAttributeID);
  const secondaryValue = getCharacterAttributeValue(character, secondaryAttributeID);
  return (primaryValue + secondaryValue / 2) * getTrainingSpeedMultiplier();
}

function getTrainingTimeMs(pointsToTrain, skillPointsPerMinute) {
  const normalizedPoints = Math.max(0, Number(pointsToTrain) || 0);
  const normalizedRate = Math.max(0, Number(skillPointsPerMinute) || 0);
  if (!normalizedPoints) {
    return 0;
  }
  if (!normalizedRate) {
    return null;
  }
  return Math.ceil((normalizedPoints / normalizedRate) * 60000);
}

function getFlagName(flagID) {
  const numericFlagID = Number(flagID || 0);
  return INVENTORY_FLAG_NAMES[numericFlagID] || (numericFlagID > 0 ? `Flag ${numericFlagID}` : "-");
}

function normalizeAccount(username, record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const accountID = Number(record.id || record.accountID || 0);
  if (!accountID) {
    return null;
  }
  return {
    username,
    accountID,
    role: String(record.role || "0"),
    chatRole: String(record.chatRole || record.role || "0"),
    banned: record.banned === true,
  };
}

async function getAccount(username, options = {}) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) {
    return null;
  }
  const account = await eveBridgeClient.getAccount(normalizedUsername);
  return normalizeAccount(normalizedUsername, account);
}

async function listAccounts(options = {}) {
  void options;
  const accounts = await eveBridgeClient.listAccounts();
  return accounts
    .map((account) => normalizeAccount(account.username, account))
    .filter(Boolean);
}

function normalizeCharacter(characterID, record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const numericCharacterID = Number(characterID || record.characterID || record.charID || 0);
  const accountID = Number(record.accountId || record.accountID || record.userid || 0);
  if (!numericCharacterID || !accountID) {
    return null;
  }
  const corporationID = Number(record.corporationID || record.corpid || 0) || null;
  const allianceID = Number(record.allianceID || record.allianceid || 0) || null;
  const stationID = Number(record.stationID || record.stationid || 0) || null;
  const solarSystemID = Number(record.solarSystemID || record.solarsystemid2 || 0) || null;
  const regionID = Number(record.regionID || record.regionid || 0) || null;
  return {
    characterID: numericCharacterID,
    accountID,
    characterName: String(record.characterName || `Character ${numericCharacterID}`),
    corporationID,
    corporationName: staticData.getCorporationName(corporationID),
    allianceID,
    allianceName: staticData.getAllianceName(allianceID),
    stationID,
    stationName: stationID ? staticData.getStationName(stationID) : null,
    solarSystemID,
    solarSystemName: solarSystemID ? staticData.getSolarSystemName(solarSystemID) : null,
    regionID,
    regionName: staticData.getRegionName(regionID),
    balance: Number(record.balance || 0),
    skillPoints: Number(record.skillPoints || 0),
    plexBalance: Number(record.plexBalance || 0),
    raw: record,
  };
}

async function listCharactersForAccount(accountID, options = {}) {
  const numericAccountID = Number(accountID || 0);
  if (!numericAccountID) {
    return [];
  }
  void options;
  const characters = await eveBridgeClient.listCharacters(numericAccountID);
  return characters
    .map((record) => normalizeCharacter(record.characterID || record.charID, record))
    .filter((character) => character && character.accountID === numericAccountID)
    .sort((left, right) => left.characterName.localeCompare(right.characterName));
}

async function getCharacterForAccount(accountID, characterID, options = {}) {
  const numericAccountID = Number(accountID || 0);
  const numericCharacterID = Number(characterID || 0);
  if (!numericAccountID || !numericCharacterID) {
    return null;
  }
  return withDb((db) => {
    const character = normalizeCharacter(
      numericCharacterID,
      readRow(db, "characters", numericCharacterID),
    );
    return character && character.accountID === numericAccountID ? character : null;
  }, { ...options, accountID: numericAccountID, characterID: numericCharacterID });
}

function normalizeSkill(typeID, record, character = null) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const numericTypeID = Number(typeID || record.typeID || 0);
  if (!numericTypeID) {
    return null;
  }
  const staticSkill = staticData.getSkillType(numericTypeID);
  const rank = getPositiveNumber(
    record.skillRank ||
      record.rank ||
      staticData.getTypeDogmaAttribute(numericTypeID, ATTRIBUTE_SKILL_TIME_CONSTANT, 1),
    1,
  );
  const level = Number(record.trainedSkillLevel ?? record.skillLevel ?? 0) || 0;
  const skillPoints = Number(record.trainedSkillPoints ?? record.skillPoints ?? 0) || 0;
  const nextLevel = level < 5 ? level + 1 : null;
  const nextLevelPoints = nextLevel ? getSkillPointsForLevel(rank, nextLevel) : skillPoints;
  const pointsToNextLevel = nextLevel ? Math.max(0, nextLevelPoints - skillPoints) : 0;
  const skillPointsPerMinute = getSkillPointsPerMinute(numericTypeID, character);
  return {
    typeID: numericTypeID,
    itemID: Number(record.itemID || 0) || null,
    name: String(record.itemName || record.typeName || (staticSkill && staticSkill.name) || `Type ${numericTypeID}`),
    groupID: Number(record.groupID || (staticSkill && staticSkill.groupID) || 0) || null,
    groupName: String(record.groupName || (staticSkill && staticSkill.groupName) || "Unknown"),
    rank,
    level,
    effectiveLevel: Number(record.effectiveSkillLevel ?? record.trainedSkillLevel ?? 0) || 0,
    skillPoints,
    inTraining: record.inTraining === true,
    nextLevel,
    nextLevelPoints,
    pointsToNextLevel,
    skillPointsPerMinute,
    trainingTimeMs: getTrainingTimeMs(pointsToNextLevel, skillPointsPerMinute),
    iconUrl: staticData.getTypeIconUrl(numericTypeID, 64, "icon"),
  };
}

function getSkillsForCharacter(db, characterID, character = null) {
  const skillMap = readRow(db, "skills", characterID) || {};
  return Object.entries(skillMap)
    .map(([typeID, record]) => normalizeSkill(typeID, record, character))
    .filter(Boolean)
    .sort((left, right) => {
      const groupCompare = left.groupName.localeCompare(right.groupName);
      return groupCompare || left.name.localeCompare(right.name);
    });
}

function getSkillQueueForCharacter(db, characterID, skillsByTypeID) {
  const rawQueue = readRow(db, "skillQueues", characterID) || {};
  const queue = Array.isArray(rawQueue.queue) ? rawQueue.queue : [];
  return {
    active: rawQueue.active === true,
    activeStartTime: rawQueue.activeStartTime || null,
    queueEndTime: rawQueue.queueEndTime || null,
    queueEndIso: rawQueue.queueEndTime ? filetimeToIso(rawQueue.queueEndTime) : null,
    freeSkillPoints: Math.max(0, Number(rawQueue.freeSkillPoints) || 0),
    queue: queue.map((entry, index) => {
      const typeID = Number(entry.typeID || entry.trainingTypeID || 0);
      const skill = skillsByTypeID.get(typeID);
      return normalizeQueueEntry({
        index,
        typeID,
        toLevel: Number(entry.toLevel || entry.trainingToLevel || 0) || null,
      }, skillsByTypeID, skill);
    }),
  };
}

function normalizeQueueSnapshot(snapshot, skillsByTypeID) {
  const queueEntries = Array.isArray(snapshot && snapshot.queueEntries)
    ? snapshot.queueEntries
    : [];
  return {
    active: Boolean(snapshot && snapshot.active),
    activeStartTime: snapshot && snapshot.currentEntry
      ? snapshot.currentEntry.trainingStartTime || null
      : null,
    queueEndTime: snapshot && snapshot.queueEndTime ? snapshot.queueEndTime : null,
    queueEndIso: snapshot && snapshot.queueEndTime ? filetimeToIso(snapshot.queueEndTime) : null,
    freeSkillPoints: Math.max(0, Number(snapshot && snapshot.freeSkillPoints) || 0),
    queue: queueEntries.map((entry, index) => normalizeQueueEntry({
      index,
      typeID: entry.trainingTypeID,
      toLevel: entry.trainingToLevel,
      trainingStartSP: entry.trainingStartSP,
      trainingDestinationSP: entry.trainingDestinationSP,
      trainingStartTime: entry.trainingStartTime,
      trainingEndTime: entry.trainingEndTime,
      skillPointsPerMinute: entry.skillPointsPerMinute,
    }, skillsByTypeID)),
  };
}

function normalizeQueueEntry(entry, skillsByTypeID, skill = null) {
  const typeID = Number(entry.typeID || entry.trainingTypeID || 0);
  const resolvedSkill = skill || skillsByTypeID.get(typeID);
  const trainingStartMs = filetimeToMs(entry.trainingStartTime);
  const trainingEndMs = filetimeToMs(entry.trainingEndTime);
  return {
    index: Number(entry.index || 0),
    typeID,
    name: resolvedSkill ? resolvedSkill.name : staticData.getTypeName(typeID),
    iconUrl: staticData.getTypeIconUrl(typeID, 64, "icon"),
    toLevel: Number(entry.toLevel || entry.trainingToLevel || 0) || null,
    currentLevel: resolvedSkill ? resolvedSkill.level : null,
    trainingStartSP: Number(entry.trainingStartSP || 0),
    trainingDestinationSP: Number(entry.trainingDestinationSP || 0),
    trainingStartTime: entry.trainingStartTime || null,
    trainingStartIso: trainingStartMs === null ? null : new Date(trainingStartMs).toISOString(),
    trainingEndTime: entry.trainingEndTime || null,
    trainingEndIso: trainingEndMs === null ? null : new Date(trainingEndMs).toISOString(),
    remainingMs: trainingEndMs === null ? null : Math.max(0, trainingEndMs - Date.now()),
    durationMs:
      trainingStartMs === null || trainingEndMs === null
        ? null
        : Math.max(0, trainingEndMs - trainingStartMs),
    skillPointsPerMinute: Number(entry.skillPointsPerMinute || 0),
  };
}

function sumSkillPoints(skills) {
  return skills.reduce((total, skill) => total + (Number(skill.skillPoints) || 0), 0);
}

function buildGroupSummary(skills) {
  const groups = new Map();
  for (const skill of skills) {
    const key = skill.groupName || "Unknown";
    const existing = groups.get(key) || {
      groupName: key,
      trainedSkills: 0,
      skillPoints: 0,
      highestLevel: 0,
    };
    existing.trainedSkills += 1;
    existing.skillPoints += Number(skill.skillPoints) || 0;
    existing.highestLevel = Math.max(existing.highestLevel, Number(skill.level) || 0);
    groups.set(key, existing);
  }
  return [...groups.values()].sort((left, right) => {
    return right.skillPoints - left.skillPoints || left.groupName.localeCompare(right.groupName);
  });
}

async function getSkillDashboard(accountID, characterID, options = {}) {
  const numericAccountID = Number(accountID || 0);
  const numericCharacterID = Number(characterID || 0);
  if (!numericAccountID || !numericCharacterID) {
    return null;
  }
  return withDb((db) => {
    const character = normalizeCharacter(
      numericCharacterID,
      readRow(db, "characters", numericCharacterID),
    );
    if (!character || character.accountID !== numericAccountID) {
      return null;
    }

    let queueSnapshot =
      options.queueSnapshot &&
      Number(options.queueSnapshot.characterID || 0) === numericCharacterID
        ? options.queueSnapshot
        : null;
    let queueSnapshotWarning = null;
    if (!queueSnapshot && db.__snapshot && db.__snapshot.queueSnapshot) {
      queueSnapshot = db.__snapshot.queueSnapshot;
    }
    if (!queueSnapshot && db.__snapshot && db.__snapshot.queueSnapshotWarning) {
      queueSnapshotWarning = db.__snapshot.queueSnapshotWarning;
    }

    const skills = getSkillsForCharacter(db, numericCharacterID, character);
    const skillsByTypeID = new Map(skills.map((skill) => [skill.typeID, skill]));
    const skillQueue = queueSnapshot
      ? normalizeQueueSnapshot(queueSnapshot, skillsByTypeID)
      : getSkillQueueForCharacter(db, numericCharacterID, skillsByTypeID);
    if (queueSnapshotWarning && !skillQueue.warning) {
      skillQueue.warning = queueSnapshotWarning;
    }
    const computedSkillPoints = sumSkillPoints(skills);

    return {
      character: {
        characterID: character.characterID,
        characterName: character.characterName,
        corporationID: character.corporationID,
        corporationName: character.corporationName,
        allianceID: character.allianceID,
        allianceName: character.allianceName,
        stationID: character.stationID,
        stationName: character.stationName,
        solarSystemID: character.solarSystemID,
        solarSystemName: character.solarSystemName,
        regionID: character.regionID,
        regionName: character.regionName,
        balance: character.balance,
        plexBalance: character.plexBalance,
      },
      summary: {
        source: "evejs-web-bridge",
        trainedSkillCount: skills.length,
        trainableSkillCount: skills.filter((skill) => skill.nextLevel !== null).length,
        totalSkillPoints: character.skillPoints || computedSkillPoints,
        computedSkillPoints,
        queuedSkillCount: skillQueue.queue.length,
        queueActive: skillQueue.active,
        freeSkillPoints: skillQueue.freeSkillPoints || 0,
      },
      queue: skillQueue,
      queueSaveSource: options.queueSaveSource || null,
      queueSaveWarning: options.queueSaveWarning || null,
      groups: buildGroupSummary(skills).slice(0, 12),
      skills,
    };
  }, { ...options, accountID: numericAccountID, characterID: numericCharacterID });
}

function resolveItemLocation(record, itemByID, depth = 0) {
  const locationID = Number(record && record.locationID || 0);
  if (!locationID) {
    return {
      locationID: null,
      locationName: "-",
      stationID: null,
      stationName: null,
      solarSystemID: null,
      solarSystemName: null,
      regionID: null,
      regionName: null,
      trail: [],
    };
  }

  const station = staticData.getStation(locationID);
  if (station) {
    return {
      locationID,
      locationName: String(station.stationName || `Station ${locationID}`),
      stationID: locationID,
      stationName: String(station.stationName || `Station ${locationID}`),
      solarSystemID: Number(station.solarSystemID || 0) || null,
      solarSystemName: station.solarSystemName || staticData.getSolarSystemName(station.solarSystemID),
      regionID: Number(station.regionID || 0) || null,
      regionName: station.regionName || staticData.getRegionName(station.regionID),
      trail: [String(station.stationName || `Station ${locationID}`)],
    };
  }

  const solarSystem = staticData.getSolarSystem(locationID);
  if (solarSystem) {
    return {
      locationID,
      locationName: String(solarSystem.solarSystemName || `System ${locationID}`),
      stationID: null,
      stationName: null,
      solarSystemID: locationID,
      solarSystemName: String(solarSystem.solarSystemName || `System ${locationID}`),
      regionID: Number(solarSystem.regionID || 0) || null,
      regionName: staticData.getRegionName(solarSystem.regionID),
      trail: [String(solarSystem.solarSystemName || `System ${locationID}`)],
    };
  }

  const parent = depth < 8 ? itemByID.get(locationID) : null;
  if (parent) {
    const parentLocation = resolveItemLocation(parent, itemByID, depth + 1);
    const parentName = String(parent.itemName || parent.typeName || staticData.getTypeName(parent.typeID));
    const flagName = getFlagName(record.flagID);
    return {
      ...parentLocation,
      locationID,
      locationName: `${parentName} / ${flagName}`,
      containerID: Number(parent.itemID || 0) || null,
      containerName: parentName,
      containerTypeID: Number(parent.typeID || 0) || null,
      trail: [...(parentLocation.trail || []), parentName, flagName],
    };
  }

  return {
    locationID,
    locationName: `Location ${locationID}`,
    stationID: null,
    stationName: null,
    solarSystemID: null,
    solarSystemName: null,
    regionID: null,
    regionName: null,
    trail: [`Location ${locationID}`],
  };
}

function normalizeItem(record, itemByID = new Map()) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const itemID = Number(record.itemID || record.shipID || 0);
  const typeID = Number(record.typeID || record.shipTypeID || 0);
  const ownerID = Number(record.ownerID || 0);
  if (!itemID || !typeID || !ownerID) {
    return null;
  }
  const locationID = Number(record.locationID || 0) || null;
  const quantity = Number(record.stacksize ?? record.quantity ?? 1);
  const singleton = Number(record.singleton || 0);
  const location = resolveItemLocation(record, itemByID);
  const staticType = staticData.getType(typeID) || {};
  return {
    itemID,
    typeID,
    typeName: String(record.itemName || record.typeName || staticType.name || staticData.getTypeName(typeID)),
    iconUrl: staticData.getTypeIconUrl(typeID, 64, "icon"),
    ownerID,
    locationID,
    locationName: location.locationName,
    locationTrail: location.trail,
    stationID: location.stationID || null,
    stationName: location.stationName || null,
    solarSystemID: location.solarSystemID || null,
    solarSystemName: location.solarSystemName || null,
    regionID: location.regionID || null,
    regionName: location.regionName || null,
    containerID: location.containerID || null,
    containerName: location.containerName || null,
    flagID: Number(record.flagID || 0) || null,
    flagName: getFlagName(record.flagID),
    categoryID: Number(record.categoryID || staticType.categoryID || 0) || null,
    groupID: Number(record.groupID || staticType.groupID || 0) || null,
    groupName: String(record.groupName || staticType.groupName || "Unknown"),
    quantity: singleton === 1 ? 1 : Math.max(0, Number.isFinite(quantity) ? quantity : 1),
    singleton,
    volume: Number(record.volume || 0) || 0,
  };
}

async function getInventoryDashboard(accountID, characterID, options = {}) {
  const numericAccountID = Number(accountID || 0);
  const numericCharacterID = Number(characterID || 0);
  if (!numericAccountID || !numericCharacterID) {
    return null;
  }
  return withDb((db) => {
    const character = normalizeCharacter(
      numericCharacterID,
      readRow(db, "characters", numericCharacterID),
    );
    if (!character || character.accountID !== numericAccountID) {
      return null;
    }
    const rawItems = listRows(db, "items").map((row) => row.value).filter(Boolean);
    const itemByID = new Map(
      rawItems.map((item) => [Number(item.itemID || item.shipID || 0), item]).filter(([itemID]) => itemID > 0),
    );
    const items = rawItems
      .map((record) => normalizeItem(record, itemByID))
      .filter((item) => item && item.ownerID === numericCharacterID)
      .sort((left, right) => {
        const locationCompare = left.locationName.localeCompare(right.locationName);
        return locationCompare || left.typeName.localeCompare(right.typeName);
      });

    const byLocation = new Map();
    const byGroup = new Map();
    for (const item of items) {
      const locationKey =
        item.stationName ||
        item.solarSystemName ||
        item.locationName ||
        `Location ${item.locationID || "-"}`;
      const location = byLocation.get(locationKey) || {
        locationName: locationKey,
        stationName: item.stationName || null,
        solarSystemName: item.solarSystemName || null,
        itemCount: 0,
        totalQuantity: 0,
      };
      location.itemCount += 1;
      location.totalQuantity += item.quantity;
      byLocation.set(locationKey, location);

      const groupKey = item.groupName || "Unknown";
      const group = byGroup.get(groupKey) || {
        groupName: groupKey,
        itemCount: 0,
        totalQuantity: 0,
      };
      group.itemCount += 1;
      group.totalQuantity += item.quantity;
      byGroup.set(groupKey, group);
    }

    return {
      character,
      summary: {
        itemCount: items.length,
        totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
        locationCount: byLocation.size,
      },
      locations: [...byLocation.values()].sort((left, right) => right.itemCount - left.itemCount),
      groups: [...byGroup.values()].sort((left, right) => right.itemCount - left.itemCount),
      items,
    };
  }, { ...options, accountID: numericAccountID, characterID: numericCharacterID });
}

function normalizeColony(key, record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const planetID = Number(record.planetID || String(key).split(":")[0] || 0);
  const ownerID = Number(record.ownerID || String(key).split(":")[1] || 0);
  const pins = Array.isArray(record.pins) ? record.pins : [];
  const extractors = pins.filter((pin) => {
    const type = staticData.getType(pin && pin.typeID);
    const groupName = String(type && type.groupName || "").toLowerCase();
    const typeName = String(type && type.name || "").toLowerCase();
    return (
      Number(type && type.groupID) === PI_GROUP_EXTRACTION_CONTROL_UNIT ||
      groupName.includes("extractor") ||
      typeName.includes("extractor control unit")
    );
  });
  const nowMs = Date.now();
  const extractorRows = extractors.map((pin) => {
    const programType = pin.programType || null;
    const state = Number(pin.state || 0);
    const installMs = filetimeToMs(pin.installTime);
    const expiryMs = filetimeToMs(pin.expiryTime);
    const expired = expiryMs !== null && expiryMs <= nowMs;
    const durationMs = installMs !== null && expiryMs !== null && expiryMs > installMs
      ? expiryMs - installMs
      : null;
    const elapsedMs = durationMs !== null
      ? clampNumber(nowMs - installMs, 0, durationMs)
      : null;
    const remainingMs = expiryMs !== null
      ? Math.max(0, expiryMs - nowMs)
      : null;
    const progress = durationMs && elapsedMs !== null
      ? clampNumber(elapsedMs / durationMs, 0, 1)
      : null;
    const cycleTimeMs = filetimeTicksToMs(pin.cycleTime);
    const cycleCount = durationMs && cycleTimeMs
      ? Math.max(1, Math.round(durationMs / cycleTimeMs))
      : null;
    const cyclesCompleted = cycleCount !== null && cycleTimeMs && elapsedMs !== null
      ? clampNumber(Math.floor(elapsedMs / cycleTimeMs), 0, cycleCount)
      : null;
    // Mirrors the server restart rule (planetRuntimeStore.restartExtractorsForCharacter):
    // a configured ECU that is idle or past its expiry gets reinstalled on "restart".
    const needsRestart = Boolean(programType) && (state !== PI_STATE_ACTIVE || expired);
    const active = Boolean(programType) && state === PI_STATE_ACTIVE && !expired;
    return {
      pinID: Number(pin.pinID || 0),
      typeID: Number(pin.typeID || 0),
      typeName: staticData.getTypeName(pin.typeID),
      iconUrl: staticData.getTypeIconUrl(pin.typeID, 64, "icon"),
      programType,
      programName: programType ? staticData.getTypeName(programType) : null,
      programIconUrl: programType ? staticData.getTypeIconUrl(programType, 64, "icon") : null,
      state,
      active,
      expiryTime: pin.expiryTime || null,
      expiryIso: filetimeToIso(pin.expiryTime),
      expiryMs,
      installTime: pin.installTime || null,
      installIso: filetimeToIso(pin.installTime),
      installMs,
      expired,
      needsRestart,
      durationMs,
      elapsedMs,
      remainingMs,
      progress,
      cycleTime: pin.cycleTime || 0,
      cycleTimeMs,
      cycleCount,
      cyclesCompleted,
      qtyPerCycle: Number(pin.qtyPerCycle || 0),
      headCount: Array.isArray(pin.heads) ? pin.heads.length : 0,
      headRadius: Number(pin.headRadius || 0) || null,
      statusName: !programType
        ? "No program"
        : needsRestart
          ? "Needs restart"
          : active
            ? "Extracting"
            : "Configured",
    };
  }).sort((left, right) => {
    return Number(right.needsRestart) - Number(left.needsRestart) ||
      Number(right.active) - Number(left.active) ||
      String(left.programName || left.typeName).localeCompare(String(right.programName || right.typeName));
  });
  return {
    key,
    planetID,
    planetName: planetID ? `Planet ${planetID}` : "Unknown planet",
    ownerID,
    solarSystemID: Number(record.solarSystemID || 0) || null,
    solarSystemName: record.solarSystemID ? staticData.getSolarSystemName(record.solarSystemID) : null,
    pinCount: pins.length,
    extractorCount: extractors.length,
    needsRestartCount: extractorRows.filter((extractor) => extractor.needsRestart).length,
    routeCount: Array.isArray(record.routes) ? record.routes.length : 0,
    linkCount: Array.isArray(record.links) ? record.links.length : 0,
    updatedAt: record.updatedAt || null,
    extractors: extractorRows,
  };
}

async function getPlanetDashboard(accountID, characterID, options = {}) {
  const numericAccountID = Number(accountID || 0);
  const numericCharacterID = Number(characterID || 0);
  if (!numericAccountID || !numericCharacterID) {
    return null;
  }
  return withDb((db) => {
    const character = normalizeCharacter(
      numericCharacterID,
      readRow(db, "characters", numericCharacterID),
    );
    if (!character || character.accountID !== numericAccountID) {
      return null;
    }
    const state = readWholeTable(db, "planetRuntimeState");
    const coloniesByKey = state.coloniesByKey && typeof state.coloniesByKey === "object"
      ? state.coloniesByKey
      : {};
    const colonies = Object.entries(coloniesByKey)
      .map(([key, colony]) => normalizeColony(key, colony))
      .filter((colony) => colony && colony.ownerID === numericCharacterID)
      .sort((left, right) => (left.solarSystemName || "").localeCompare(right.solarSystemName || ""));
    const launchesByID = state.launchesByID && typeof state.launchesByID === "object"
      ? state.launchesByID
      : {};
    const launches = Object.values(launchesByID)
      .filter((launch) => Number(launch && launch.ownerID) === numericCharacterID)
      .map((launch) => ({
        launchID: Number(launch.launchID || launch.itemID || 0),
        planetID: Number(launch.planetID || 0),
        solarSystemID: Number(launch.solarSystemID || 0) || null,
        contents: launch.contents || {},
        deleted: launch.deleted === true,
      }));
    return {
      character,
      summary: {
        colonyCount: colonies.length,
        extractorCount: colonies.reduce((total, colony) => total + colony.extractorCount, 0),
        activeExtractorCount: colonies.reduce(
          (total, colony) => total + colony.extractors.filter((extractor) => extractor.active).length,
          0,
        ),
        expiredExtractorCount: colonies.reduce(
          (total, colony) => total + colony.extractors.filter((extractor) => extractor.expired).length,
          0,
        ),
        needsRestartCount: colonies.reduce((total, colony) => total + colony.needsRestartCount, 0),
        launchCount: launches.length,
        generatedAt: new Date().toISOString(),
      },
      colonies,
      launches,
    };
  }, { ...options, accountID: numericAccountID, characterID: numericCharacterID });
}

function normalizeIndustryJob(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const jobID = Number(record.jobID || 0);
  if (!jobID) {
    return null;
  }
  const activityID = Number(record.activityID || 0);
  const rawStatus = Number(record.status || 0);
  const startMs = filetimeToMs(record.startDate);
  const endMs = filetimeToMs(record.endDate);
  const pauseMs = filetimeToMs(record.pauseDate);
  const ready = rawStatus === 1 && endMs !== null && endMs <= Date.now();
  const status = ready ? 3 : rawStatus;
  const elapsedAtMs = status === 2 && pauseMs !== null ? pauseMs : Date.now();
  const durationMs = startMs !== null && endMs !== null ? Math.max(0, endMs - startMs) : null;
  const elapsedMs = startMs !== null ? Math.max(0, elapsedAtMs - startMs) : null;
  const progress = durationMs && elapsedMs !== null
    ? Math.max(0, Math.min(1, elapsedMs / durationMs))
    : status >= 3
      ? 1
      : 0;
  const facilityStation = staticData.getStation(record.facilityID);
  const blueprintDefinition = staticData.getIndustryBlueprint(record.blueprintTypeID);
  const productTypeID = Number(record.productTypeID || (blueprintDefinition && blueprintDefinition.productTypeID) || 0);
  return {
    jobID,
    activityID,
    activityName: INDUSTRY_ACTIVITY_NAMES[activityID] || `Activity ${activityID || "-"}`,
    status,
    statusName: INDUSTRY_STATUS_NAMES[status] || `Status ${status}`,
    blueprintID: Number(record.blueprintID || 0) || null,
    blueprintTypeID: Number(record.blueprintTypeID || 0) || null,
    blueprintName: staticData.getTypeName(record.blueprintTypeID),
    blueprintIconUrl: staticData.getTypeIconUrl(record.blueprintTypeID, 64, "bp"),
    productTypeID: productTypeID || null,
    productName: productTypeID ? staticData.getTypeName(productTypeID) : "-",
    productIconUrl: productTypeID ? staticData.getTypeIconUrl(productTypeID, 64, "icon") : null,
    ownerID: Number(record.ownerID || 0) || null,
    installerID: Number(record.installerID || 0) || null,
    facilityID: Number(record.facilityID || 0) || null,
    facilityName:
      facilityStation && facilityStation.stationName
        ? String(facilityStation.stationName)
        : Number(record.facilityID || 0)
          ? `Facility ${record.facilityID}`
          : "-",
    solarSystemID:
      Number(record.solarSystemID || 0) ||
      Number(facilityStation && facilityStation.solarSystemID || 0) ||
      null,
    solarSystemName:
      record.solarSystemID
        ? staticData.getSolarSystemName(record.solarSystemID)
        : facilityStation && facilityStation.solarSystemName
          ? facilityStation.solarSystemName
          : null,
    runs: Number(record.runs || 0),
    successfulRuns: Number(record.successfulRuns || 0),
    cost: Number(record.cost || 0),
    tax: Number(record.tax || 0),
    totalCost: Number(record.totalCost || 0),
    timeInSeconds: Number(record.timeInSeconds || 0),
    startDate: record.startDate || null,
    startIso: filetimeToIso(record.startDate),
    endDate: record.endDate || null,
    endIso: filetimeToIso(record.endDate),
    pauseDate: record.pauseDate || null,
    pauseIso: filetimeToIso(record.pauseDate),
    durationMs,
    remainingMs: status === 1 && endMs !== null ? Math.max(0, endMs - Date.now()) : 0,
    progress,
  };
}

async function getIndustryDashboard(accountID, characterID, options = {}) {
  const numericAccountID = Number(accountID || 0);
  const numericCharacterID = Number(characterID || 0);
  if (!numericAccountID || !numericCharacterID) {
    return null;
  }
  return withDb((db) => {
    const character = normalizeCharacter(
      numericCharacterID,
      readRow(db, "characters", numericCharacterID),
    );
    if (!character || character.accountID !== numericAccountID) {
      return null;
    }

    const jobsState = readWholeTable(db, "industryJobs");
    const jobs = Object.values(jobsState.jobs || {})
      .map((job) => normalizeIndustryJob(job))
      .filter((job) => job && (job.ownerID === numericCharacterID || job.installerID === numericCharacterID))
      .sort((left, right) => {
        const statusCompare = left.status - right.status;
        if (statusCompare) {
          return statusCompare;
        }
        return (filetimeToMs(left.endDate) || 0) - (filetimeToMs(right.endDate) || 0);
      });

    const rawItems = listRows(db, "items").map((row) => row.value).filter(Boolean);
    const itemByID = new Map(
      rawItems.map((item) => [Number(item.itemID || item.shipID || 0), item]).filter(([itemID]) => itemID > 0),
    );
    const blueprints = rawItems
      .map((record) => normalizeItem(record, itemByID))
      .filter((item) => item && item.ownerID === numericCharacterID && item.categoryID === 9)
      .map((item) => {
        const definition = staticData.getIndustryBlueprint(item.typeID);
        return {
          itemID: item.itemID,
          typeID: item.typeID,
          typeName: item.typeName,
          iconUrl: staticData.getTypeIconUrl(item.typeID, 64, item.singleton === 2 ? "bpc" : "bp"),
          productTypeID: definition ? Number(definition.productTypeID || 0) || null : null,
          productName: definition && definition.productTypeID
            ? staticData.getTypeName(definition.productTypeID)
            : "-",
          locationName: item.locationName,
          stationName: item.stationName,
          solarSystemName: item.solarSystemName,
          original: item.singleton !== 2,
        };
      });

    const activeJobs = jobs.filter((job) => job.status === 1 || job.status === 2);
    const readyJobs = jobs.filter((job) => job.status === 3);
    const completedJobs = jobs.filter((job) => job.status >= 100);
    const byActivity = new Map();
    for (const job of jobs) {
      const entry = byActivity.get(job.activityName) || {
        activityName: job.activityName,
        count: 0,
      };
      entry.count += 1;
      byActivity.set(job.activityName, entry);
    }

    return {
      character,
      summary: {
        jobCount: jobs.length,
        activeJobCount: activeJobs.length,
        readyJobCount: readyJobs.length,
        completedJobCount: completedJobs.length,
        blueprintCount: blueprints.length,
      },
      activities: [...byActivity.values()].sort((left, right) => right.count - left.count),
      jobs,
      blueprints,
    };
  }, { ...options, accountID: numericAccountID, characterID: numericCharacterID });
}

async function saveSkillQueue(accountID, characterID, entries, options = {}) {
  const character = await getCharacterForAccount(accountID, characterID, options);
  if (!character) {
    return null;
  }

  let queueSnapshot = null;
  let queueSaveSource = "evejs-web-bridge";
  const bridgeResult = await eveBridgeClient.saveSkillQueue(
    accountID,
    character.characterID,
    entries,
    {
      activate: options.activate !== false,
    },
  );
  queueSnapshot = bridgeResult.snapshot || null;

  return getSkillDashboard(accountID, character.characterID, {
    ...options,
    queueSnapshot,
    queueSaveSource,
  });
}

async function getCharacterStatus(accountID, characterID, options = {}) {
  const character = await getCharacterForAccount(accountID, characterID, options);
  if (!character) {
    return null;
  }

  try {
    const result = await eveBridgeClient.getCharacterStatus(accountID, character.characterID);
    return {
      characterID: character.characterID,
      online: result.online === true,
      bridgeAvailable: true,
    };
  } catch (error) {
    // If the bridge is unreachable we cannot know live login state. Report it as
    // unknown rather than failing the page; write endpoints stay guarded server-side.
    return {
      characterID: character.characterID,
      online: null,
      bridgeAvailable: false,
    };
  }
}

async function restartExtractors(accountID, characterID, options = {}) {
  const character = await getCharacterForAccount(accountID, characterID, options);
  if (!character) {
    return null;
  }

  // There is no local fallback for PI: the companion's SQLite handle is read-only and the
  // EveJS runtime owns the colony simulation. If the bridge is unavailable, surface the error.
  const bridgeResult = await eveBridgeClient.restartExtractors(
    accountID,
    character.characterID,
    { planetID: options.planetID },
  );

  const dashboard = await getPlanetDashboard(accountID, character.characterID, options);
  if (dashboard) {
    dashboard.restartSummary = (bridgeResult && bridgeResult.summary) || null;
  }
  return dashboard;
}

async function getCharacterOverview(accountID, characterID, options = {}) {
  const skillDashboard = await getSkillDashboard(accountID, characterID, options);
  if (!skillDashboard) {
    return null;
  }
  const [inventoryDashboard, planetDashboard, industryDashboard] = await Promise.all([
    getInventoryDashboard(accountID, characterID, options),
    getPlanetDashboard(accountID, characterID, options),
    getIndustryDashboard(accountID, characterID, options),
  ]);
  return {
    character: {
      ...skillDashboard.character,
      corporationName:
        skillDashboard.character.corporationName ||
        staticData.getCorporationName(skillDashboard.character.corporationID),
      allianceName:
        skillDashboard.character.allianceName ||
        staticData.getAllianceName(skillDashboard.character.allianceID),
      stationName:
        skillDashboard.character.stationName ||
        (skillDashboard.character.stationID
          ? staticData.getStationName(skillDashboard.character.stationID)
          : null),
      solarSystemName:
        skillDashboard.character.solarSystemName ||
        (skillDashboard.character.solarSystemID
          ? staticData.getSolarSystemName(skillDashboard.character.solarSystemID)
          : null),
      regionName:
        skillDashboard.character.regionName ||
        staticData.getRegionName(skillDashboard.character.regionID),
    },
    summary: {
      skillPoints: skillDashboard.summary.totalSkillPoints,
      trainedSkillCount: skillDashboard.summary.trainedSkillCount,
      queuedSkillCount: skillDashboard.summary.queuedSkillCount,
      itemCount: inventoryDashboard ? inventoryDashboard.summary.itemCount : 0,
      colonyCount: planetDashboard ? planetDashboard.summary.colonyCount : 0,
      extractorCount: planetDashboard ? planetDashboard.summary.extractorCount : 0,
      industryJobCount: industryDashboard ? industryDashboard.summary.jobCount : 0,
      activeIndustryJobCount: industryDashboard ? industryDashboard.summary.activeJobCount : 0,
    },
  };
}

async function getStatus(options = {}) {
  void options;
  return eveBridgeClient.getStatus();
}

function openDb() {
  throw new Error("Direct SQLite access is disabled; use the EveJS web bridge.");
}

module.exports = {
  getAccount,
  getCharacterForAccount,
  getCharacterOverview,
  getIndustryDashboard,
  getInventoryDashboard,
  getPlanetDashboard,
  getSkillDashboard,
  getStatus,
  getCharacterStatus,
  listAccounts,
  listCharactersForAccount,
  openDb,
  restartExtractors,
  saveSkillQueue,
};
