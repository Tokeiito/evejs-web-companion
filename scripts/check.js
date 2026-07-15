"use strict";

const eveStore = require("../src/eveStore");
const webAuth = require("../src/webAuth");

async function main() {
  const status = await eveStore.getStatus();
  const accounts = await eveStore.listAccounts();
  const gateway = status.gateway || {};

  console.log("EveJS Web POC check");
  console.log("Data source: EveJS web bridge");
  console.log(`Accounts: ${status.accountCount}`);
  console.log(`Characters: ${status.characterCount}`);
  console.log(`Web users configured: ${webAuth.countConfiguredUsers()}`);
  console.log(
    `Gateway v1: ${gateway.available === true ? "available" : "unavailable"}; ` +
      `runtime ${gateway.ready === true ? "ready" : "not ready"}`,
  );

  if (!status.hasAccounts || !status.hasCharacters || !status.hasSkills) {
    throw new Error("Required EveJS tables are missing.");
  }

  if (
    gateway.available !== true ||
    gateway.apiVersion !== 1 ||
    gateway.ready !== true ||
    !gateway.runtime ||
    !gateway.runtime.dependencies ||
    gateway.runtime.dependencies.serviceManager !== true
  ) {
    throw new Error("EveJS v1 gateway is unavailable or its runtime is not ready.");
  }

  if (accounts.length === 0) {
    throw new Error("No EveJS accounts found.");
  }

  const firstAccount = accounts[0];
  const characters = await eveStore.listCharactersForAccount(firstAccount.accountID);
  console.log(`First account: ${firstAccount.username}`);
  console.log(`Characters for first account: ${characters.length}`);

  if (characters.length > 0) {
    const dashboard = await eveStore.getSkillDashboard(
      firstAccount.accountID,
      characters[0].characterID,
    );
    console.log(
      `Skill dashboard sample: ${dashboard.character.characterName}, ` +
        `${dashboard.summary.trainedSkillCount} skills, ` +
        `${dashboard.summary.totalSkillPoints} SP`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
