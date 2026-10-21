"use strict";

// evetypes461-473/573-585: source-order defaultdict(set) indexes followed by
// NEW set(cachedset) copies. English names:489-491/localizationUtils63-74.
const { createClientDogmaValueCollections } = require("./clientDogmaValueCollections");
const { getClientCrystalGroups } = require("./clientDogmaCrystalGroups");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);

class ClientDogmaGroupNotFoundException extends Error {
  constructor(groupID) { super(`Group ${String(groupID)} was not found.`); this.name = "GroupNotFoundException"; this.groupID = groupID; }
}
function ordered(table, part) {
  if (!table || typeof table !== "object" || Array.isArray(table) || !Array.isArray(table["#order"])) throw notReady(`complete ordered ${part}`);
  const ids = table["#order"], seen = new Set();
  if (Object.keys(table).length !== ids.length + 1) throw notReady(`${part} complete order coverage`);
  return ids.map(id => {
    if (!Number.isSafeInteger(id) || seen.has(id) || !Object.hasOwn(table, id)) throw notReady(`${part} numeric identity`);
    seen.add(id);
    return [id, table[id]];
  });
}
function numeric(value) {
  if (typeof value === "bigint" || typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw notReady("normalized numeric group/category identity");
}

/** One emulated client's fixed installed-data namespace. Explicit async
 * preparation is not Cfg/Service startup or loaded-world readiness. The
 * default owner ports only EveConfig183's real empty crystal-cache field;
 * caller may supply the actual owner when full Cfg lifecycle is available.
 * Names use the witnessed current primary-English/no-QA/highlight/tooltip
 * profile: all1605 installed templates have NO tokens/braces/angle markup
 * (cdxclientstaticcrystalinputsagent1). This does not port native Parse,
 * alternate-language important formatting or arbitrary CleanImportantMarkup.
 * Numeric maps/sets model real table history, not cFSD wrapper/GC identity. */
function createClientDogmaStaticGroupData({ typeGroups, groups, typeNameIDs, messages, constants, language, cfg = { crystalgroups: [] } } = {}) {
  if ([typeGroups, groups, typeNameIDs, messages, constants, language].some(reader => typeof reader !== "function")) throw new TypeError("Complete installed type/group/name/constant readers and language policy are required.");
  const values = createClientDogmaValueCollections();
  let sourceTypes = null, sourceGroups = null, names = null, constantValues = null, pending = null;
  let typeIndex = null, categoryIndex = null;
  function prepared() { if (sourceTypes === null || sourceGroups === null || names === null || constantValues === null) throw notReady("complete installed type/group/English inputs"); }
  function getTypesByGroupIndex() {
    prepared();
    if (typeIndex === null) {
      const result = values.map({ defaultFactory: () => values.set() });
      for (const [typeID, groupID] of sourceTypes) result.at(groupID).add(typeID);
      typeIndex = result;
    }
    return typeIndex;
  }
  function getGroupsByCategoryIndex() {
    prepared();
    if (categoryIndex === null) {
      const result = values.map({ defaultFactory: () => values.set() });
      for (const [groupID, categoryID] of sourceGroups) result.at(categoryID).add(groupID);
      categoryIndex = result;
    }
    return categoryIndex;
  }
  function copied(index, key) {
    const absent = Symbol("absent group cache key");
    const cached = index.get(numeric(key), absent); // Unknown MUST NOT insert.
    return cached === absent ? values.set() : values.mutableCopy(cached);
  }
  function getGroupNameByGroup(groupID, languageID) {
    prepared();
    if (languageID !== "en" || language() !== "en-us") throw notReady("primary-English important group names");
    const key = numeric(groupID), canonical = typeof key === "bigint" ? Number(key) : key;
    if (!Number.isSafeInteger(canonical) || !names.has(canonical)) throw new ClientDogmaGroupNotFoundException(groupID);
    return names.get(canonical);
  }
  const providers = {
    getGroupIDsByCategory: categoryID => copied(getGroupsByCategoryIndex(), categoryID),
    getGroupNameByGroup,
    cleanImportantMarkup(text) {
      if (language() !== "en-us" || typeof text !== "string" || /[<>{}]/.test(text)) throw notReady("witnessed plain primary-English group text");
      return text; // Original clean operation is identity in this fixed profile.
    },
    get constants() { prepared(); return constantValues; },
  };
  async function load() {
    if (language() !== "en-us") throw notReady("primary-English group text profile");
    const types = ordered(await typeGroups(), "type groups"), rawGroups = ordered(await groups(), "groups");
    const allTypeNames = await typeNameIDs();
    // The existing complete name-ID projection is an independent membership
    // witness: a group-field projection must not silently drop a type whose
    // field is missing/None. This is emulator preparation, not a source RPC.
    if (!allTypeNames || typeof allTypeNames !== "object" || Array.isArray(allTypeNames) || Object.keys(allTypeNames).length !== types.length || types.some(([id]) => !Object.hasOwn(allTypeNames, id))) throw notReady("complete type-group membership including type0");
    const groupIDs = new Set(), groupRows = [], nameIDs = [];
    for (const [id, row] of rawGroups) {
      if (!row || typeof row !== "object" || !Number.isSafeInteger(row.categoryID) || !Number.isSafeInteger(row.groupNameID)) throw notReady("installed group category/name fields");
      groupIDs.add(id); groupRows.push(Object.freeze([id, row.categoryID, row.groupNameID])); nameIDs.push(row.groupNameID);
    }
    for (const [, id] of types) if (!Number.isSafeInteger(id) || !groupIDs.has(id)) throw notReady("installed type-group relation");
    const texts = await messages(nameIDs), loadedNames = new Map();
    for (const [id, , messageID] of groupRows) {
      if (!texts || !Object.hasOwn(texts, messageID) || typeof texts[messageID] !== "string" || /[<>{}]/.test(texts[messageID])) throw notReady("complete witnessed plain English group messages");
      loadedNames.set(id, texts[messageID]);
    }
    const loadedConstants = await constants();
    if (!loadedConstants || !Number.isSafeInteger(loadedConstants.categoryCharge)) throw notReady("installed categoryCharge");
    if (language() !== "en-us") throw notReady("primary-English group text profile");
    sourceTypes = Object.freeze(types.map(pair => Object.freeze(pair)));
    sourceGroups = Object.freeze(groupRows); names = loadedNames; constantValues = loadedConstants;
    return api;
  }
  const api = Object.freeze({
    ready() {
      if (sourceTypes !== null) return Promise.resolve(api);
      if (pending !== null) return pending;
      const reading = Promise.resolve().then(load); pending = reading;
      const forget = () => { if (pending === reading) pending = null; };
      reading.then(forget, forget); return reading;
    },
    getTypesByGroupIndex, getGroupsByCategoryIndex,
    getTypeIDsByGroup: groupID => copied(getTypesByGroupIndex(), groupID),
    getGroupIDsByCategory: categoryID => copied(getGroupsByCategoryIndex(), categoryID),
    getGroupNameByGroup,
    getCrystalGroups: () => getClientCrystalGroups(cfg, providers),
    // Source evetypes cache invalidation does NOT clear cfg.crystalgroups.
    // These reset indexes on the SAME prepared inputs, not actual FSD reload.
    clearTypeIndex() { typeIndex = null; },
    clearGroupIndex() { categoryIndex = null; },
  });
  return api;
}

module.exports = { createClientDogmaStaticGroupData, ClientDogmaGroupNotFoundException };
