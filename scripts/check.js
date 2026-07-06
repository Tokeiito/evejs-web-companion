"use strict";

const eveStore = require("../src/eveStore");
const webAuth = require("../src/webAuth");

async function main() {
const status = await eveStore.getStatus();
const accounts = await eveStore.listAccounts();

console.log("EveJS Web POC check");
console.log("Data source: EveJS web bridge");
console.log(`Accounts: ${status.accountCount}`);
console.log(`Characters: ${status.characterCount}`);
console.log(`Web users configured: ${webAuth.countConfiguredUsers()}`);

if (!status.hasAccounts || !status.hasCharacters || !status.hasSkills) {
  throw new Error("Required EveJS tables are missing.");
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
