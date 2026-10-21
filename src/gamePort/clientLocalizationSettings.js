"use strict";

const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fileHash = filename => hash(fs.readFileSync(filename));
const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

/** Capture actual installed start/common bytes before awaiting the shared VM.
 * Native original read-only INI/Handler classes read this immutable snapshot.
 * It is an explicitly selected installed boot-field phase, not full path/profile
 * detection, eveprefs.Init, localization text loading or engine/session state.
 */
async function createClientLocalizationSettings({ provider, preferences, clientRoot, cacheRoot = path.resolve(__dirname, "../../data/native-preferences/boot") }) {
  if (!provider || typeof provider.ready !== "function" || !preferences?.handler) throw new TypeError("Actual installed runtime and companion preference owner are required.");
  if (typeof clientRoot !== "string" || !path.isAbsolute(clientRoot) || typeof cacheRoot !== "string" || !path.isAbsolute(cacheRoot)) throw new TypeError("Absolute installed client and native cache roots are required.");
  const root = fs.realpathSync(path.join(clientRoot, "tq"));
  const captured = ["start.ini", "common.ini"].map(name => {
    const filename = path.join(root, name);
    let bytes;
    try {
      if (!samePath(fs.realpathSync(filename), filename)) throw new Error(`Installed boot file is not its exact tq path: ${name}.`);
      bytes = fs.readFileSync(filename);
    } catch (error) {
      if (name !== "common.ini" || error.code !== "ENOENT") throw error;
      bytes = null; // Preserve the original absent common-file input.
    }
    return { name, filename, bytes, sha256: bytes === null ? null : hash(bytes) };
  });
  const digest = hash(Buffer.concat(captured.flatMap(record => [Buffer.from(record.name + "\0" + (record.bytes === null ? "absent" : "present") + "\0"), record.bytes || Buffer.alloc(0), Buffer.from("\0")])));
  const directory = path.join(cacheRoot, digest);
  fs.mkdirSync(directory, { recursive: true });
  for (const record of captured) {
    const target = path.join(directory, record.name);
    if (record.bytes === null) {
      if (fs.existsSync(target)) throw new Error("An absent boot-file snapshot has unexpected content.");
      continue;
    }
    if (!fs.existsSync(target)) {
      const temporary = path.join(directory, "capture-" + crypto.randomUUID());
      fs.writeFileSync(temporary, record.bytes, { flag: "wx" });
      try { fs.linkSync(temporary, target); } catch (error) { if (error.code !== "EEXIST") throw error; }
      fs.unlinkSync(temporary); // Only this uniquely created nonrecursive file.
    }
    if (fileHash(target) !== record.sha256) throw new Error("Native boot snapshot identity differs.");
  }
  function verify() {
    for (const record of captured) {
      if (record.bytes === null) {
        if (fs.existsSync(record.filename) || fs.existsSync(path.join(directory, record.name))) throw new Error("Installed absent common-file input changed.");
      } else if (!samePath(fs.realpathSync(record.filename), record.filename) || fileHash(record.filename) !== record.sha256 || fileHash(path.join(directory, record.name)) !== record.sha256) throw new Error("Installed boot input identity changed during preparation.");
    }
  }
  verify();
  const runtime = await provider.ready();
  verify();
  const module = runtime.values.global("_create_localization_settings").call(directory, preferences.handler);
  verify();
  const internal = module.getAttr("internal"), settings = module.getAttr("settings");
  return Object.freeze({
    module, preferences, boot: module.getAttr("boot"), common: module.getAttr("common"),
    internal, qa: module.getAttr("qa"), bilingual: module.getAttr("bilingual"), settings,
    identity: runtime.identity,
    bootIdentity: Object.freeze({ directory, digest, files: Object.freeze(captured.map(({ name, filename, sha256 }) => Object.freeze({ name, filename, sha256 }))) }),
    getLanguageID: () => internal.getAttr("GetLanguageID").call(),
    cleanImportantMarkup: value => settings.getAttr("CleanImportantMarkup").call(value),
  });
}

module.exports = { createClientLocalizationSettings };
