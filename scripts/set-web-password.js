"use strict";

const eveStore = require("../src/eveStore");
const webAuth = require("../src/webAuth");

const [, , usernameArg, passwordArg] = process.argv;
const username = String(usernameArg || "").trim();
const password = String(passwordArg || "");

if (!username || !password) {
  console.error("Usage: npm run webpass -- <evejs-username> <web-password>");
  process.exit(1);
}

async function main() {
  const account = await eveStore.getAccount(username);
  if (!account) {
    console.error(`EveJS account not found: ${username}`);
    process.exit(1);
  }
  const record = webAuth.upsertWebPassword(account, password);
  console.log(
    `Web password set for ${record.username} (EveJS account ${record.eveAccountID}).`,
  );
  console.log(`Stored outside EveJS at ${webAuth.USERS_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
