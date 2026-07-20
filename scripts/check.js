"use strict";

// Operator sanity check (`npm run check`): is the EveJS gateway reachable and
// is its runtime ready enough for the web client to sign in?
//
// Trimmed by goal R9b: this used to walk `eveStore.listAccounts()` and print a
// sample skill dashboard, both of which lived on the retired emulation-snapshot
// surface. The gateway `/status` + `/health` reads it uses now are the same two
// the live `GET /api/health` route serves.

const eveStore = require("../src/eveStore");
const webAuth = require("../src/webAuth");

async function main() {
  const status = await eveStore.getStatus();

  console.log("EveJS Web POC check");
  console.log("Data source: EveJS web gateway v1");
  console.log(`Accounts: ${status.accountCount}`);
  console.log(`Characters: ${status.characterCount}`);
  console.log(`Web users configured: ${webAuth.countConfiguredUsers()}`);
  console.log(
    `Gateway v1: ${status.available === true ? "available" : "unavailable"}; ` +
      `runtime ${status.ready === true ? "ready" : "not ready"}`,
  );

  if (!status.hasAccounts || !status.hasCharacters || !status.hasSkills) {
    throw new Error("Required EveJS tables are missing.");
  }

  if (
    status.available !== true ||
    status.apiVersion !== 1 ||
    status.ready !== true ||
    !status.runtime ||
    !status.runtime.dependencies ||
    status.runtime.dependencies.serviceManager !== true
  ) {
    throw new Error("EveJS v1 gateway is unavailable or its runtime is not ready.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
