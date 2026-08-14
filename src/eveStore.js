"use strict";

// Account/character lookup for the auth path (slimmed by goal R9b).
//
// This module used to be the whole legacy "emulation snapshot" store: skill /
// inventory / industry / planet dashboards, character-control claim/renew/
// release, and the command DTOs behind the retired
// `GET|POST /api/characters/:characterID/*` family. All of that is gone — the
// browser client is bridge-only (POST /api/bridge/*), so nothing read those
// snapshots any more.
//
// What survives is exactly what the auth + session surface needs:
//   - getAccount(username)                     -> requireAuth + POST /api/login
//   - createAccount(username)                  -> POST /api/login auto-create (R2)
//   - listCharactersForAccount(accountID)      -> the login response payload
//   - getCharacterForAccount(accountID, id)    -> ownership check in
//                                                 POST /api/bridge/select
//   - getStatus()                              -> GET /api/health
//
// Each is a thin normalizer over the matching eveGatewayClient read.

const eveGatewayClient = require("./eveGatewayClient");
const staticData = require("./staticData");

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

async function getAccount(username, options = {}) {
  void options;
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) {
    return null;
  }
  const account = await eveGatewayClient.getAccount(normalizedUsername);
  return normalizeAccount(normalizedUsername, account);
}

// Account auto-create for the who-cares login (goal R2): unknown usernames are
// created through the gateway, which owns the policy — it enforces the
// emulator's devAutoCreateAccounts flag and answers an existing username's
// account with `created: false`. Returns { account, created }.
async function createAccount(username, options = {}) {
  void options;
  const normalizedUsername = String(username || "").trim();
  const outcome = await eveGatewayClient.createAccount(normalizedUsername);
  return {
    account: normalizeAccount(normalizedUsername, outcome.account),
    created: outcome.created === true,
  };
}

async function listCharactersForAccount(accountID, options = {}) {
  void options;
  const numericAccountID = Number(accountID || 0);
  if (!numericAccountID) {
    return [];
  }
  const characters = await eveGatewayClient.listCharacters(numericAccountID);
  return characters
    .map((record) => normalizeCharacter(record.characterID || record.charID, record))
    .filter((character) => character && character.accountID === numericAccountID)
    .sort((left, right) => left.characterName.localeCompare(right.characterName));
}

// Ownership check for POST /api/bridge/select: the account signing in must own
// the character it asks the bridge to select. Reads the one `characters` row
// out of the gateway snapshot; returns null when the row is missing or belongs
// to a different account.
async function getCharacterForAccount(accountID, characterID, options = {}) {
  const numericAccountID = Number(accountID || 0);
  const numericCharacterID = Number(characterID || 0);
  if (!numericAccountID || !numericCharacterID) {
    return null;
  }
  const snapshot = options.snapshot || await eveGatewayClient.getSnapshot(
    numericAccountID,
    numericCharacterID,
  );
  const characters = snapshot && typeof snapshot === "object" && snapshot.characters
    && typeof snapshot.characters === "object"
    ? snapshot.characters
    : {};
  const record = characters[String(numericCharacterID)] || null;
  const character = normalizeCharacter(numericCharacterID, record);
  return character && character.accountID === numericAccountID ? character : null;
}

async function getStatus(options = {}) {
  void options;
  return eveGatewayClient.getStatus();
}

module.exports = {
  createAccount,
  getAccount,
  getCharacterForAccount,
  getStatus,
  listCharactersForAccount,
};
