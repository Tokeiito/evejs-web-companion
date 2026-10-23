"use strict";

const fs = require("node:fs/promises");

const MAX_BYTES = 2 * 1024 * 1024;
const positive = (value) => Number.isSafeInteger(value) && value > 0;

/** Only the presentation data the rewards window understands crosses this boundary. */
function campaignDefinition(value) {
  if (!value || typeof value !== "object" || typeof value.name !== "string" || value.name.length > 5000 ||
      typeof value.retroClaim !== "boolean") return null;
  const track = (rewards) => {
    if (!Array.isArray(rewards) || rewards.length > 366) return null;
    const days = new Set();
    const result = [];
    for (const reward of rewards) {
      if (!Array.isArray(reward) || reward.length !== 4 || !Number.isSafeInteger(reward[0]) || reward[0] < 0 ||
          reward[0] > 365 || !reward.slice(1).every(positive) || days.has(reward[0])) return null;
      days.add(reward[0]);
      result.push([...reward]);
    }
    return result.sort((one, other) => one[0] - other[0]);
  };
  const alpha = track(value.alpha);
  const omega = track(value.omega);
  return alpha === null || omega === null ? null : { name: value.name, retroClaim: value.retroClaim, alpha, omega };
}

/** Optional operator-owned data. Missing or invalid data never prevents an account claiming its rewards. */
function createSeasonalCampaignDefinitions({ filePath }) {
  return {
    async get(campaignID) {
      if (!positive(campaignID)) return null;
      let file;
      try {
        file = await fs.open(filePath, "r");
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES) return null;
        // Bound the read even if a writer grows the file after stat.
        const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_BYTES + 1));
        let bytesRead = 0;
        while (bytesRead < bytes.length) {
          const next = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
          if (next.bytesRead === 0) break;
          bytesRead += next.bytesRead;
        }
        if (bytesRead > stat.size || bytesRead > MAX_BYTES) return null;
        const data = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
        if (data?.version !== 1 || !data.campaigns || typeof data.campaigns !== "object" || Array.isArray(data.campaigns)) return null;
        return campaignDefinition(data.campaigns[String(campaignID)]);
      } catch {
        return null;
      } finally {
        await file?.close().catch(() => {});
      }
    },
  };
}

module.exports = { campaignDefinition, createSeasonalCampaignDefinitions };
