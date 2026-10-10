"use strict";

// Whose a character is (src/eveStore.js, getCharacterForAccount).
//
// The check is made before a pilot is chosen, before a bot is started for one,
// and before the BFF asks anything of the gateway as a pilot who is not logged
// in. It is answered from the account's own list of characters, which is an
// account-level read; it used to be answered from the gateway's snapshot of the
// one character, which named a pilot whether or not that pilot was online here.

const test = require("node:test");
const assert = require("node:assert/strict");

const client = require("../src/eveGatewayClient");
const store = require("../src/eveStore");

/** The gateway client with its two reads stood in for, for the length of one test. */
function standIn(t, { characters = [], snapshot = () => { throw new Error("the snapshot of a character must not be read"); } } = {}) {
  const asked = [];
  const real = { listCharacters: client.listCharacters, getSnapshot: client.getSnapshot };
  client.listCharacters = async (accountID) => { asked.push(["listCharacters", accountID]); return typeof characters === "function" ? characters(accountID) : characters; };
  client.getSnapshot = async (accountID, characterID) => { asked.push(["getSnapshot", accountID, characterID]); return snapshot(accountID, characterID); };
  t.after(() => Object.assign(client, real));
  return asked;
}

const row = (characterID, accountId, more = {}) => ({ characterID, accountId, characterName: `Pilot ${characterID}`, corporationID: 1000044, ...more });

test("a character is the account's if the account's own list has it, and the list is all that is asked", async (t) => {
  const asked = standIn(t, { characters: [row(140000002, 2), row(140000003, 2), row(140000004, 2)] });
  const own = await store.getCharacterForAccount(2, 140000003);
  assert.deepEqual([own.characterID, own.accountID, own.characterName, own.corporationID], [140000003, 2, "Pilot 140000003", 1000044]);
  // The same character the account's list gives, field for field.
  const listed = (await store.listCharactersForAccount(2)).find((character) => character.characterID === 140000003);
  assert.deepEqual(own, listed);
  assert.deepEqual(asked, [["listCharacters", 2], ["listCharacters", 2]]);
  // Ids that come as text are the same ids.
  assert.equal((await store.getCharacterForAccount("2", "140000002")).characterID, 140000002);
});

test("a character the account has not got is nobody's to it: null, and nothing thrown", async (t) => {
  const asked = standIn(t, { characters: [row(140000002, 2)] });
  assert.equal(await store.getCharacterForAccount(2, 140000001), null);
  assert.deepEqual(asked, [["listCharacters", 2]]);
  // An account with no characters at all.
  const none = standIn(t, { characters: [] });
  assert.equal(await store.getCharacterForAccount(7, 140000002), null);
  assert.deepEqual(none, [["listCharacters", 7]]);
});

test("a row in the list that is another account's is not this account's character", async (t) => {
  // The gateway lists an account's own; should a row of somebody else's come with them, the store does not take it.
  standIn(t, { characters: [row(140000001, 1), row(140000002, 2)] });
  assert.equal(await store.getCharacterForAccount(2, 140000001), null);
  assert.equal((await store.getCharacterForAccount(2, 140000002)).characterID, 140000002);
});

test("with no account or no character named, nobody is asked", async (t) => {
  const asked = standIn(t, { characters: [row(140000002, 2)] });
  for (const [accountID, characterID] of [[0, 140000002], [2, 0], [null, 140000002], [2, undefined], ["", ""]]) {
    assert.equal(await store.getCharacterForAccount(accountID, characterID), null);
  }
  assert.deepEqual(asked, []);
});

test("what the gateway refuses is the caller's to hear", async (t) => {
  standIn(t, { characters: () => { throw Object.assign(new Error("the gateway is away"), { code: "EVE_GATEWAY_UNAVAILABLE" }); } });
  await assert.rejects(store.getCharacterForAccount(2, 140000002), (error) => error.code === "EVE_GATEWAY_UNAVAILABLE");
});

test("a snapshot the caller already has is read as it was, and nobody is asked", async (t) => {
  const asked = standIn(t, { characters: [] });
  const snapshot = { characters: { 140000002: row(140000002, 2), 140000001: row(140000001, 1) } };
  assert.equal((await store.getCharacterForAccount(2, 140000002, { snapshot })).characterID, 140000002);
  assert.equal(await store.getCharacterForAccount(2, 140000001, { snapshot }), null, "another account's row");
  assert.equal(await store.getCharacterForAccount(2, 140000009, { snapshot }), null, "no such row");
  assert.equal(await store.getCharacterForAccount(2, 140000002, { snapshot: { characters: null } }), null);
  assert.deepEqual(asked, []);
});
