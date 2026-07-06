"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const config = require("../src/config");
const staticData = require("../src/staticData");

const DEFAULT_DELAY_MS = 250;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 1;
const DEFAULT_MANIFEST_FILE = "manifest.json";
const GAMESTORE_ICON_TABLES = [
  "skills",
  "items",
  "industryJobs",
  "planetRuntimeState",
  "marketEscrow",
  "marketRuntime",
];

function printHelp() {
  console.log(`
Usage:
  node scripts/cache-icons.js [options]

Default source:
  Scans the current EveJS gamestore and downloads icons the web app is likely to show.

Options:
  --source <name>        gamestore, all-types. Can be comma-separated or repeated.
  --type <id>           Add one typeID. Can be repeated.
  --types <ids>         Add comma-separated typeIDs.
  --file <path>         Read typeIDs from a file. Lines can be "typeID" or "typeID,variation".
  --size <px>           Icon size: 32, 64, 128, 256, 512, 1024. Default: 64.
  --variation <name>    CDN variation for manual/all-types IDs. Default: icon.
  --variations <names>  Comma-separated variations, for example icon,bp,bpc.
  --delay-ms <ms>       Delay between CDN requests. Default: ${DEFAULT_DELAY_MS}.
  --rate-limit <rate>   Max CDN request rate, for example 60/min or 2/sec.
  --rpm <n>             Shortcut for --rate-limit <n>/min.
  --limit <n>           Cap the number of uncached downloads this run.
  --manifest <path>     Manifest path. Default: data/icon-cache/${DEFAULT_MANIFEST_FILE}.
  --force               Re-download files that already exist.
  --dry-run             Print the plan without downloading.
  --timeout-ms <ms>     Per-request timeout. Default: ${DEFAULT_TIMEOUT_MS}.
  --retries <n>         Retry count after the first failed attempt. Default: ${DEFAULT_RETRIES}.
  --help                Show this help.

Examples:
  node scripts/cache-icons.js --dry-run
  node scripts/cache-icons.js --rate-limit 60/min --limit 200
  node scripts/cache-icons.js --type 34 --type 670
  node scripts/cache-icons.js --file .\\typeids.txt --variations icon,bp
  node scripts/cache-icons.js --source all-types --delay-ms 1000 --limit 500
`.trim());
}

function parsePositiveInt(value, fallback) {
  const numeric = Number.parseInt(String(value), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseRateLimit(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const match = normalized.match(/^(\d+)(?:\s*\/\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hour|hours))?$/);
  if (!match) {
    throw new Error(`Invalid rate limit: ${value}`);
  }
  const requests = Number.parseInt(match[1], 10);
  if (!Number.isFinite(requests) || requests <= 0) {
    throw new Error(`Invalid rate limit: ${value}`);
  }
  const unit = match[2] || "min";
  const windowMs =
    unit.startsWith("s")
      ? 1000
      : unit.startsWith("h")
        ? 3600000
        : 60000;
  return {
    label: `${requests}/${unit}`,
    requests,
    windowMs,
    intervalMs: Math.ceil(windowMs / requests),
  };
}

function parseArgs(argv) {
  const options = {
    sources: new Set(),
    sourceProvided: false,
    manualTypes: [],
    files: [],
    size: 64,
    variations: ["icon"],
    delayMs: DEFAULT_DELAY_MS,
    rateLimit: null,
    manifestPath: path.join(config.iconCacheDir, DEFAULT_MANIFEST_FILE),
    limit: 0,
    force: false,
    dryRun: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retries: DEFAULT_RETRIES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value after ${arg}`);
      }
      return argv[index];
    };

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--source" || arg === "--from") {
      options.sourceProvided = true;
      for (const source of splitList(next())) {
        options.sources.add(source.toLowerCase());
      }
    } else if (arg === "--all-types") {
      options.sourceProvided = true;
      options.sources.add("all-types");
    } else if (arg === "--type") {
      options.manualTypes.push(next());
    } else if (arg === "--types") {
      options.manualTypes.push(...splitList(next()));
    } else if (arg === "--file") {
      options.files.push(next());
    } else if (arg === "--size") {
      options.size = parsePositiveInt(next(), 64);
    } else if (arg === "--variation") {
      options.variations = [next()];
    } else if (arg === "--variations") {
      options.variations = splitList(next());
    } else if (arg === "--delay-ms") {
      options.delayMs = parsePositiveInt(next(), DEFAULT_DELAY_MS);
    } else if (arg === "--rate-limit") {
      options.rateLimit = parseRateLimit(next());
    } else if (arg === "--rpm" || arg === "--requests-per-minute") {
      options.rateLimit = parseRateLimit(`${next()}/min`);
    } else if (arg === "--limit") {
      options.limit = parsePositiveInt(next(), 0);
    } else if (arg === "--manifest") {
      options.manifestPath = path.resolve(next());
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = parsePositiveInt(next(), DEFAULT_TIMEOUT_MS);
    } else if (arg === "--retries") {
      options.retries = Math.max(0, Number.parseInt(next(), 10) || 0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.variations = options.variations
    .map((variation) => staticData.normalizeIconRequest(1, options.size, variation).variation)
    .filter(Boolean);
  if (!options.variations.length) {
    options.variations = ["icon"];
  }

  if (!options.sourceProvided && !options.manualTypes.length && !options.files.length) {
    options.sources.add("gamestore");
  }
  options.requestIntervalMs = Math.max(
    options.delayMs,
    options.rateLimit ? options.rateLimit.intervalMs : 0,
  );

  return options;
}

function getCandidateKey(candidate) {
  return `${candidate.typeID}:${candidate.size}:${candidate.variation}`;
}

function addCandidate(candidates, typeID, variation, source, options) {
  const normalized = staticData.normalizeIconRequest(typeID, options.size, variation);
  if (!normalized.typeID) {
    return;
  }
  const candidate = {
    typeID: normalized.typeID,
    size: normalized.size,
    variation: normalized.variation,
    source,
  };
  candidates.set(getCandidateKey(candidate), candidate);
}

function addTypeWithRequestedVariations(candidates, typeID, source, options) {
  for (const variation of options.variations) {
    addCandidate(candidates, typeID, variation, source, options);
  }
}

function parseJsonRow(row) {
  if (!row || typeof row.json !== "string") {
    return null;
  }
  try {
    return JSON.parse(row.json);
  } catch {
    return null;
  }
}

function readGamestoreRows(db, tableName) {
  try {
    return db.prepare(`SELECT key, json FROM "${tableName}"`).all();
  } catch {
    return [];
  }
}

function scanRuntimeValue(value, candidates, options, source = "gamestore") {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      scanRuntimeValue(entry, candidates, options, source);
    }
    return;
  }

  const genericTypeID = Number(
    value.typeID ||
      value.shipTypeID ||
      value.trainingTypeID ||
      value.programType ||
      0,
  );
  if (genericTypeID > 0) {
    addCandidate(candidates, genericTypeID, "icon", source, options);
  }

  const productTypeID = Number(value.productTypeID || 0);
  if (productTypeID > 0) {
    addCandidate(candidates, productTypeID, "icon", source, options);
  }

  const blueprintTypeID = Number(value.blueprintTypeID || 0);
  if (blueprintTypeID > 0) {
    addCandidate(candidates, blueprintTypeID, "bp", source, options);
  }

  if (genericTypeID > 0 && Number(value.categoryID || 0) === 9) {
    addCandidate(candidates, genericTypeID, Number(value.singleton || 0) === 2 ? "bpc" : "bp", source, options);
  }

  for (const child of Object.values(value)) {
    scanRuntimeValue(child, candidates, options, source);
  }
}

function addGamestoreCandidates(candidates, options) {
  const db = new Database(config.gamestorePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma("query_only = ON");
    for (const tableName of GAMESTORE_ICON_TABLES) {
      for (const row of readGamestoreRows(db, tableName)) {
        scanRuntimeValue(parseJsonRow(row), candidates, options, tableName);
      }
    }
  } finally {
    db.close();
  }
}

function readStaticBucket(tableName, bucketName) {
  const filePath = path.join(config.eveRoot, "_local", "gameStore", "data", tableName, "data.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const table = JSON.parse(raw);
  const bucket = table[bucketName] || table;
  return Array.isArray(bucket) ? bucket : Object.values(bucket);
}

function addAllTypeCandidates(candidates, options) {
  for (const entry of [
    ...readStaticBucket("itemTypes", "types"),
    ...readStaticBucket("skillTypes", "skills"),
  ]) {
    if (!entry || entry.published === false) {
      continue;
    }
    addTypeWithRequestedVariations(candidates, entry.typeID, "all-types", options);
  }
}

function addManualCandidates(candidates, options) {
  for (const typeID of options.manualTypes) {
    addTypeWithRequestedVariations(candidates, typeID, "manual", options);
  }

  for (const filePath of options.files) {
    const absolutePath = path.resolve(filePath);
    const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.replace(/#.*/, "").trim();
      if (!line) {
        continue;
      }
      const [typeID, variation] = line.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
      if (variation) {
        addCandidate(candidates, typeID, variation, `file:${absolutePath}`, options);
      } else {
        addTypeWithRequestedVariations(candidates, typeID, `file:${absolutePath}`, options);
      }
    }
  }
}

function buildCandidates(options) {
  const candidates = new Map();
  if (options.sources.has("gamestore")) {
    addGamestoreCandidates(candidates, options);
  }
  if (options.sources.has("all-types")) {
    addAllTypeCandidates(candidates, options);
  }
  for (const source of options.sources) {
    if (!["gamestore", "all-types"].includes(source)) {
      throw new Error(`Unsupported source: ${source}`);
    }
  }
  addManualCandidates(candidates, options);
  return [...candidates.values()].sort((left, right) => {
    return left.typeID - right.typeID || left.variation.localeCompare(right.variation);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequestRateLimiter(intervalMs) {
  let lastRequestStartedAt = 0;
  return {
    async wait() {
      const now = Date.now();
      const nextAllowedAt = lastRequestStartedAt + intervalMs;
      if (lastRequestStartedAt > 0 && nextAllowedAt > now) {
        await sleep(nextAllowedAt - now);
      }
      lastRequestStartedAt = Date.now();
    },
  };
}

function getManifestKey(candidate) {
  return `types/${candidate.size}/${candidate.variation}/${candidate.typeID}.png`;
}

function createManifest() {
  return {
    version: 1,
    generatedBy: "evejs-web-poc/scripts/cache-icons.js",
    cacheDir: config.iconCacheDir,
    updatedAt: null,
    lastRun: null,
    entries: {},
  };
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return createManifest();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return {
      ...createManifest(),
      ...parsed,
      entries:
        parsed && parsed.entries && typeof parsed.entries === "object"
          ? parsed.entries
          : {},
    };
  } catch (error) {
    throw new Error(`Could not read icon manifest at ${manifestPath}: ${error.message}`);
  }
}

function saveManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function getFileStats(targetPath) {
  try {
    const stats = fs.statSync(targetPath);
    return {
      bytes: stats.size,
      mtime: stats.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function updateManifestEntry(manifest, candidate, result) {
  const now = new Date().toISOString();
  const key = getManifestKey(candidate);
  const existing = manifest.entries[key] || {};
  const fileStats = result.targetPath ? getFileStats(result.targetPath) : null;
  const entry = {
    ...existing,
    typeID: candidate.typeID,
    size: candidate.size,
    variation: candidate.variation,
    source: candidate.source,
    localPath: key,
    remoteUrl: result.url || staticData.getRemoteTypeIconUrl(
      candidate.typeID,
      candidate.size,
      candidate.variation,
    ),
    lastStatus: result.status,
    checkedAt: now,
  };

  if (result.status === "downloaded" || result.status === "skipped") {
    entry.cached = true;
    entry.cachedAt = result.status === "downloaded"
      ? now
      : entry.cachedAt || (fileStats && fileStats.mtime) || now;
    entry.bytes = result.bytes || (fileStats && fileStats.bytes) || entry.bytes || null;
    entry.contentType = result.contentType || entry.contentType || null;
    entry.etag = result.etag || entry.etag || null;
    entry.lastModified = result.lastModified || entry.lastModified || null;
    entry.error = null;
  } else if (result.status === "failed") {
    entry.cached = Boolean(fileStats);
    entry.failedAt = now;
    entry.error = result.message || "download failed";
    if (fileStats) {
      entry.bytes = fileStats.bytes;
      entry.cachedAt = entry.cachedAt || fileStats.mtime;
    }
  }

  manifest.entries[key] = entry;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "evejs-web-poc-icon-cache/0.1",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadCandidate(candidate, options, rateLimiter) {
  const targetPath = staticData.getTypeIconCachePath(
    candidate.typeID,
    candidate.size,
    candidate.variation,
  );
  const url = staticData.getRemoteTypeIconUrl(
    candidate.typeID,
    candidate.size,
    candidate.variation,
  );
  if (!targetPath || !url) {
    return { status: "failed", message: "invalid icon request", targetPath, url };
  }
  if (!options.force && fs.existsSync(targetPath)) {
    return { status: "skipped", message: "already cached", targetPath, url };
  }
  if (options.dryRun) {
    return { status: "planned", message: url, targetPath, url };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  let lastError = null;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      await rateLimiter.wait();
      const response = await fetchWithTimeout(url, options.timeoutMs);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) {
        throw new Error("empty image response");
      }
      const tempPath = `${targetPath}.tmp-${process.pid}`;
      fs.writeFileSync(tempPath, bytes);
      fs.renameSync(tempPath, targetPath);
      return {
        status: "downloaded",
        message: `${bytes.length} bytes`,
        targetPath,
        url,
        bytes: bytes.length,
        contentType,
        etag: response.headers.get("etag") || null,
        lastModified: response.headers.get("last-modified") || null,
      };
    } catch (error) {
      lastError = error;
      if (attempt < options.retries) {
        await sleep(options.requestIntervalMs);
      }
    }
  }
  return {
    status: "failed",
    message: lastError ? lastError.message : "download failed",
    targetPath,
    url,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const candidates = buildCandidates(options);
  const cached = [];
  const uncached = [];
  for (const candidate of candidates) {
    const targetPath = staticData.getTypeIconCachePath(
      candidate.typeID,
      candidate.size,
      candidate.variation,
    );
    if (!options.force && targetPath && fs.existsSync(targetPath)) {
      cached.push(candidate);
    } else {
      uncached.push(candidate);
    }
  }
  const selected = options.limit > 0 ? uncached.slice(0, options.limit) : uncached;
  const rateLimiter = createRequestRateLimiter(options.requestIntervalMs);
  const manifest = options.dryRun ? null : loadManifest(options.manifestPath);
  const runStartedAt = new Date().toISOString();

  console.log("EveJS icon cache");
  console.log(`Cache: ${config.iconCacheDir}`);
  console.log(`Manifest: ${options.manifestPath}`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Already cached: ${cached.length}`);
  console.log(`${options.dryRun ? "Planned downloads" : "Downloads this run"}: ${selected.length}`);
  console.log(
    `Request interval: ${options.requestIntervalMs} ms` +
      (options.rateLimit ? ` (${options.rateLimit.label})` : ""),
  );

  const counts = {
    downloaded: 0,
    skipped: cached.length,
    planned: 0,
    failed: 0,
  };

  if (manifest) {
    manifest.lastRun = {
      startedAt: runStartedAt,
      finishedAt: null,
      dryRun: false,
      sources: [...options.sources],
      size: options.size,
      variations: options.variations,
      force: options.force,
      limit: options.limit || null,
      rateLimit: options.rateLimit,
      requestIntervalMs: options.requestIntervalMs,
      candidates: candidates.length,
      selected: selected.length,
      counts,
    };
    for (const candidate of cached) {
      updateManifestEntry(manifest, candidate, {
        status: "skipped",
        message: "already cached",
        targetPath: staticData.getTypeIconCachePath(candidate.typeID, candidate.size, candidate.variation),
        url: staticData.getRemoteTypeIconUrl(candidate.typeID, candidate.size, candidate.variation),
      });
    }
    saveManifest(options.manifestPath, manifest);
  }

  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index];
    const result = await downloadCandidate(candidate, options, rateLimiter);
    counts[result.status] = (counts[result.status] || 0) + 1;
    const progress = `${index + 1}/${selected.length}`;
    console.log(
      `[${progress}] ${result.status.padEnd(10)} ` +
        `${candidate.typeID}/${candidate.variation}/${candidate.size} ` +
        `(${candidate.source}) ${result.message}`,
    );
    if (manifest && result.status !== "planned") {
      updateManifestEntry(manifest, candidate, result);
      manifest.lastRun.counts = counts;
      saveManifest(options.manifestPath, manifest);
    }
  }

  if (manifest) {
    manifest.lastRun.finishedAt = new Date().toISOString();
    manifest.lastRun.counts = counts;
    saveManifest(options.manifestPath, manifest);
  }

  console.log(
    `Done. downloaded=${counts.downloaded} planned=${counts.planned} ` +
      `skipped=${counts.skipped} failed=${counts.failed}`,
  );
  if (counts.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
