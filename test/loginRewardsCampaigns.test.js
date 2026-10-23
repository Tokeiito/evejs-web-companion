"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { createApp } = require("../src/server");
const { createSeasonalCampaignDefinitions } = require("../src/seasonalCampaignDefinitions");
const { writeCampaignData } = require("../scripts/build-seasonal-campaigns");
const { isBridgeWritePair, isPageWritePair } = require("../src/bridgeCallPolicy");
const { createPilotMutationFence } = require("../src/pilotMutationFence");

const definition = { name: "Synthetic seasonal campaign", retroClaim: true,
  alpha: [[0, 100, 1, 1]], omega: [[0, 200, 2, 1]] };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seasonal-definitions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "seasonal-campaigns.json");
}
const write = (filePath, campaigns) => fs.writeFileSync(filePath, JSON.stringify({ version: 1, build: 1, campaigns }));

test("both campaign claims and existing redemption remain protected pilot writes", async () => {
  let sent = 0;
  const blocked = Object.assign(new Error("Synthetic pilot belongs to a hosted run"), { code: "PILOT_OWNED" });
  const fence = createPilotMutationFence({ heldSessions: new Map([["tab", { bridgeSessionID: "held", characterID: 7 }]]),
    assertWritable(characterID) { assert.equal(characterID, 7); throw blocked; } });
  const transport = fence.wrap({ async callMethod() { sent += 1; } });
  for (const [service, method] of [["loginCampaignManager", "claim_reward"], ["seasonalLoginCampaignManager", "claim_reward"], ["userSvc", "ClaimRedeemTokens"]]) {
    assert.equal(isBridgeWritePair(service, method), true);
    assert.equal(isPageWritePair(service, method), true);
    await assert.rejects(async () => transport.callMethod(service, method, [], null, { userid: 4 }, "held"), (error) => error === blocked);
  }
  assert.equal(sent, 0, "the transport sees none of the unauthorized writes");
  assert.equal(isBridgeWritePair("loginCampaignManager", "get_client_campaign_state"), false);
  assert.equal(isBridgeWritePair("seasonalLoginCampaignManager", "get_active_campaign"), false);
});

test("the generator writes runtime JSON outside the source tree", async (t) => {
  const filePath = fixture(t);
  writeCampaignData({ version: 1, build: 1, campaigns: { 42: definition } }, filePath);
  assert.deepEqual(await createSeasonalCampaignDefinitions({ filePath }).get(42), definition);
  assert.throws(() => writeCampaignData({}, path.join(__dirname, "not-ignored-seasonal-data.json")), /Git-ignored path/);
});

test("optional local definitions validate and reload without preventing unknown campaigns", async (t) => {
  const filePath = fixture(t);
  const definitions = createSeasonalCampaignDefinitions({ filePath });
  assert.equal(await definitions.get(42), null, "a missing file is optional");
  write(filePath, { 42: { ...definition, privateField: "never sent" } });
  assert.deepEqual(await definitions.get(42), definition);
  assert.equal(await definitions.get(43), null);
  assert.equal(await definitions.get(-1), null);
  write(filePath, { 42: { ...definition, alpha: [[0, 100, -1, 1]] } });
  assert.equal(await definitions.get(42), null, "invalid rewards are not published");
  fs.writeFileSync(filePath, "broken json");
  assert.equal(await definitions.get(42), null, "a corrupt file has the same optional fallback");
  write(filePath, { 42: definition });
  assert.deepEqual(await definitions.get(42), definition, "an operator's replacement is picked up");
  fs.writeFileSync(filePath, " ".repeat(2 * 1024 * 1024 + 1));
  assert.equal(await definitions.get(42), null, "oversized input is not loaded");
});

test("campaign definition route requires authentication and accepts only a campaign ID", async (t) => {
  const filePath = fixture(t);
  write(filePath, { 42: definition });
  const app = createApp({ seasonalCampaignsPath: filePath, eveGatewayClient: {}, staticData: {},
    eveStore: { async getAccount() { return { username: "synthetic", accountID: 4, banned: false }; } },
    webAuth: { verifySessionToken(token) { return token === "synthetic-token"
      ? { username: "synthetic", accountID: 4, sessionID: "synthetic-tab" } : null; }, countConfiguredUsers() { return 1; } },
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/login-rewards/campaigns/`;
  assert.equal((await fetch(`${url}42`)).status, 401);
  const headers = { authorization: "Bearer synthetic-token" };
  const valid = await fetch(`${url}42`, { headers });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { ok: true, definition });
  assert.deepEqual(await (await fetch(`${url}43`, { headers })).json(), { ok: true, definition: null });
  assert.equal((await fetch(`${url}-1`, { headers })).status, 400);
  assert.equal((await fetch(`${url}not-a-path`, { headers })).status, 400);
  fs.writeFileSync(filePath, "invalid");
  assert.deepEqual(await (await fetch(`${url}42`, { headers })).json(), { ok: true, definition: null });
});
