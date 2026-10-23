#!/usr/bin/env node
"use strict";

// Write an ignored local JSON file of the retail client's seasonal login campaigns.
//
// The server says only WHICH seasonal campaign is on (seasonalLoginCampaignManager.get_active_campaign answers its
// ID); the client knows the rest from its static data: res:/staticdata/seasonalcampaignsloginrewards.fsdbinary, read
// by its seasonalCampaignsLoginRewardsLoader (loginrewards/common/fsdloaders.py), each campaign its name (a message
// ID), whether an omega clone may claim the days it took as an alpha (retroClaim), and the alpha and the omega
// reward of each day, from 0. The BFF reads this optional operator-owned file at runtime. Generated client data is
// never written into the web source or committed.
//
//     node scripts/build-seasonal-campaigns.js <client folder>
//
//     <client folder>  the folder holding the client's tq and ResFiles (EVEJS_CLIENT_ROOT)
//
// Run it on Windows with a 64-bit Python 3 (EVEJS_PYTHON, or `python`): the loader runs inside the client's own
// python27.dll (scripts/client-built-data.py). Run it again for another client build.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const config = require("../src/config");
const { runLoader } = require("../src/clientData/clientBuiltData");
const { createClientWords, readResourceIndex } = require("../src/clientData/clientWords");

const RESOURCE = "res:/staticdata/seasonalcampaignsloginrewards.fsdbinary";
const LOADER = "seasonalCampaignsLoginRewardsLoader";
const OUT = config.seasonalCampaignsPath;

/** A custom location inside the checkout must also be ignored before client data can be written there. */
function writeCampaignData(data, destination = OUT) {
  const output = path.resolve(destination);
  const relative = path.relative(config.repoRoot, output);
  if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    try {
      execFileSync("git", ["check-ignore", "--quiet", "--no-index", "--", relative], { cwd: config.repoRoot, stdio: "ignore" });
    } catch {
      throw new Error("Client-derived campaign data must be written outside the checkout or to a Git-ignored path.");
    }
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(data)}\n`, { mode: 0o600 });
}

/** A day's rewards as [day from 0, typeID, quantity, tier], in order of the day. */
function rewardsOf(table) {
  return Object.entries(table && typeof table === "object" ? table : {})
    .map(([day, reward]) => [Number(day), Number(reward.typeID) || 0, Number(reward.quantity) || 1, Number(reward.tier) || 1])
    .filter(([day, typeID]) => Number.isSafeInteger(day) && day >= 0 && typeID > 0)
    .sort((one, other) => one[0] - other[0]);
}

async function main() {
  const clientRoot = process.argv[2];
  if (!clientRoot) throw new Error("Give the client's folder (the one holding tq and ResFiles).");
  const start = fs.readFileSync(path.join(clientRoot, "tq", "start.ini"), "utf8");
  const build = (/^\s*build\s*=\s*(\d+)/m.exec(start) || [])[1];
  if (!build) throw new Error("The client's start.ini says no build.");
  const relative = readResourceIndex(fs.readFileSync(path.join(clientRoot, "tq", "resfileindex.txt"), "utf8")).get(RESOURCE);
  if (!relative) throw new Error(`The client's index has no ${RESOURCE}.`);
  const table = JSON.parse(await runLoader({
    python: process.env.EVEJS_PYTHON || "python",
    binFolder: path.join(clientRoot, "tq", "bin64"),
    loader: LOADER,
    dataFile: path.join(clientRoot, "ResFiles", relative),
  }));
  const words = createClientWords({ clientRoot });
  const ids = Object.keys(table).map(Number).filter(Number.isSafeInteger).sort((one, other) => one - other);
  const campaigns = Object.fromEntries(ids.map((id) => {
    const campaign = table[String(id)];
    const name = words.message(Number(campaign.campaignName)) || "";
    const entry = { name, retroClaim: Boolean(campaign.retroClaim), alpha: rewardsOf(campaign.alphaRewards), omega: rewardsOf(campaign.omegaRewards) };
    return [id, entry];
  }));
  writeCampaignData({ version: 1, build: Number(build), campaigns });
  process.stdout.write(`${ids.length} campaigns from build ${build} written to ${path.relative(process.cwd(), OUT)}\n`);
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exitCode = 1;
});

module.exports = { rewardsOf, writeCampaignData };
