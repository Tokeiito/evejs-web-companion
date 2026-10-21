"use strict";

// Actual installed cFSD objects in the SAME retained Python27 VM. No JSON,
// row/attribute projection, host-engine startup or reconstructed data classes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { TABLES } = require("./clientBuiltData");
const { readResourceIndex } = require("./clientWords");
const loaderPins = new WeakMap(); // Native binding identity, shared across provider facades.
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fileHash = filename => hash(fs.readFileSync(filename));
const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

/**
 * table(name) owns one actual native root per loader/resource, including TABLES
 * aliases with different legacy projection flags. loadFresh(name) calls the
 * actual loader again against the SAME prepared immutable resource bytes.
 * identity(name) is null before preparation; metadata contains real native
 * pointer identities only after successful native loads, never a JS row copy.
 * Cached table handles belong to this provider; callers retain them rather
 * than disposing them while the provider or its service owner is in use.
 * Data snapshots remain local/ignored. Installed PYDs are never copied.
 */
function createClientNativeBuiltData({ provider, clientRoot, cacheRoot = path.resolve(__dirname, "../../data/native-preferences/fsd") } = {}) {
  if (!provider || typeof provider.ready !== "function") throw new TypeError("An installed native Python provider is required.");
  if (typeof clientRoot !== "string" || !path.isAbsolute(clientRoot)) throw new TypeError("An absolute installed client root is required.");
  if (typeof cacheRoot !== "string" || !path.isAbsolute(cacheRoot)) throw new TypeError("An absolute local native FSD cache root is required.");
  const records = new Map();

  function descriptor(name) {
    if (!Object.hasOwn(TABLES, name)) throw new Error(`Unknown installed native FSD table: ${name}.`);
    const described = TABLES[name];
    if (!/^[A-Za-z0-9_]+Loader$/.test(described.loader)) throw new Error("Unsupported installed loader name.");
    return described;
  }
  function keyOf(described) { return described.loader + "\0" + described.resource.toLowerCase(); }
  function verifyPyd(record) {
    const current = fs.realpathSync(record.pyd.filename);
    if (!samePath(current, record.pyd.filename) || fileHash(current) !== record.pyd.sha256) throw new Error(`Installed native loader changed: ${record.loader}; restart the native host.`);
  }
  function verifySnapshot(record) {
    if (fileHash(record.data.snapshotFilename) !== record.data.sha256) throw new Error(`Local native FSD snapshot changed: ${record.resource}.`);
  }
  function prepare(name) {
    const described = descriptor(name), key = keyOf(described);
    if (records.has(key)) { const kept = records.get(key); verifyPyd(kept); verifySnapshot(kept); return kept; }
    // Capture bytes before any await. Never derive resource paths from table
    // callers, and reject index/reparse paths escaping the installed ResFiles.
    const binRoot = fs.realpathSync(path.join(clientRoot, "tq", "bin64"));
    const resourceRoot = fs.realpathSync(path.join(clientRoot, "ResFiles"));
    const pydFilename = path.join(binRoot, described.loader + ".pyd");
    if (!samePath(fs.realpathSync(pydFilename), pydFilename)) throw new Error(`Installed loader is not its exact bin64 file: ${described.loader}.`);
    const index = readResourceIndex(fs.readFileSync(path.join(clientRoot, "tq", "resfileindex.txt"), "utf8"));
    const relative = index.get(described.resource.toLowerCase());
    if (!relative) throw new Error(`The installed client index has no ${described.resource}.`);
    const indexedFilename = path.resolve(resourceRoot, relative);
    if (!inside(resourceRoot, indexedFilename)) throw new Error(`Indexed FSD path escapes ResFiles: ${described.resource}.`);
    const sourceFilename = fs.realpathSync(indexedFilename);
    if (!inside(resourceRoot, sourceFilename)) throw new Error(`Indexed FSD reparse path escapes ResFiles: ${described.resource}.`);
    const pydSHA = fileHash(pydFilename), bytes = fs.readFileSync(sourceFilename), sha256 = hash(bytes);
    fs.mkdirSync(cacheRoot, { recursive: true });
    const snapshotFilename = path.join(cacheRoot, sha256 + ".fsdbinary");
    if (!fs.existsSync(snapshotFilename)) {
      const staging = path.join(cacheRoot, "capture-" + crypto.randomUUID() + ".fsdbinary");
      fs.writeFileSync(staging, bytes, { flag: "wx" });
      if (fileHash(sourceFilename) !== sha256) throw new Error(`Installed FSD resource changed during capture: ${described.resource}.`);
      if (fileHash(staging) !== sha256) throw new Error("Native FSD staging snapshot hash mismatch.");
      try { fs.linkSync(staging, snapshotFilename); } catch (error) { if (error.code !== "EEXIST") throw error; }
      // Only this explicit nonrecursive, uniquely created staging file is removed.
      fs.unlinkSync(staging);
    }
    if (fileHash(sourceFilename) !== sha256) throw new Error(`Installed FSD resource changed during capture: ${described.resource}.`);
    if (fileHash(snapshotFilename) !== sha256) throw new Error(`Local native FSD snapshot has invalid bytes: ${described.resource}.`);
    const record = {
      loader: described.loader, resource: described.resource,
      pyd: Object.freeze({ filename: pydFilename, sha256: pydSHA }),
      data: Object.freeze({ sourceFilename, snapshotFilename, sha256, length: bytes.length }),
      table: null, tableRootIdentity: null, lastFreshRootIdentity: null, runtimeIdentity: null,
    };
    verifyPyd(record); records.set(key, record); return record;
  }
  async function load(record, fresh) {
    const runtime = await provider.ready();
    verifyPyd(record); verifySnapshot(record);
    let pins = loaderPins.get(runtime.binding);
    if (!pins) { pins = new Map(); loaderPins.set(runtime.binding, pins); }
    const pinned = pins.get(record.loader);
    if (pinned && (!samePath(pinned.filename, record.pyd.filename) || pinned.sha256 !== record.pyd.sha256)) throw new Error(`Native VM already pins another ${record.loader} identity; restart the host.`);
    if (!pinned) pins.set(record.loader, record.pyd); // No unload/reset even after a failed native call.
    let root;
    try {
      root = runtime.values.global("_load_cfsd").call(record.loader, record.pyd.filename, record.data.snapshotFilename);
    } finally {
      verifyPyd(record); verifySnapshot(record);
    }
    record.runtimeIdentity = runtime.identity;
    if (fresh) record.lastFreshRootIdentity = root.identity;
    else record.tableRootIdentity = root.identity;
    return root;
  }
  function table(name) {
    let record; try { record = prepare(name); } catch (error) { return Promise.reject(error); }
    if (!record.table) {
      const pending = load(record, false);
      record.table = pending;
      pending.catch(() => { if (record.table === pending) record.table = null; });
    }
    return record.table;
  }
  function loadFresh(name) {
    try { return load(prepare(name), true); } catch (error) { return Promise.reject(error); }
  }
  function identity(name) {
    const record = records.get(keyOf(descriptor(name)));
    if (!record) return null;
    return Object.freeze({ loader: record.loader, resource: record.resource, pyd: record.pyd, data: record.data,
      tableRootIdentity: record.tableRootIdentity, lastFreshRootIdentity: record.lastFreshRootIdentity, runtime: record.runtimeIdentity });
  }
  return Object.freeze({ table, loadFresh, identity });
}

module.exports = { createClientNativeBuiltData };
