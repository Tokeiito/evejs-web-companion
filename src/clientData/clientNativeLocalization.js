"use strict";

const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { readResourceIndex } = require("./clientWords");
const preparations = new WeakMap(); // One immutable dataset per actual native VM.
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fileHash = filename => hash(fs.readFileSync(filename));
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

/** Actual installed full main/English pickles and _evelocalization backend in
 * the retained Python27 VM. Native language data and primary are process global;
 * preparation is pinned/coalesced, never reset/unloaded for individual clients.
 * Cached NativeValue roots belong to this VM capability; clients retain them
 * without disposing shared handles. getMessageByID is the native primitive,
 * not Localization.GetByMessageID's formatting/unresolved-message behavior.
 * This explicit extension/file phase is not Localization.LoadLanguageData,
 * property handlers, Get's settings/session/formatting chain or Blue startup.
 */
function createClientNativeLocalization({ provider, clientRoot, cacheRoot = path.resolve(__dirname, "../../data/native-preferences/localization") } = {}) {
  if (!provider || typeof provider.ready !== "function") throw new TypeError("An installed native Python provider is required.");
  if (typeof clientRoot !== "string" || !path.isAbsolute(clientRoot) || typeof cacheRoot !== "string" || !path.isAbsolute(cacheRoot)) throw new TypeError("Absolute installed client and native cache roots are required.");
  let pending = null, captured = null;
  function capture() {
    const bin = fs.realpathSync(path.join(clientRoot, "tq", "bin64")), resources = fs.realpathSync(path.join(clientRoot, "ResFiles"));
    const extensionFilename = path.join(bin, "_evelocalization.dll");
    if (!samePath(fs.realpathSync(extensionFilename), extensionFilename)) throw new Error("Installed localization extension is not its exact bin64 file.");
    const extension = Object.freeze({ filename: extensionFilename, sha256: fileHash(extensionFilename) });
    const indexFilename = path.join(clientRoot, "tq", "resfileindex.txt"), indexBytes = fs.readFileSync(indexFilename), index = readResourceIndex(indexBytes.toString("utf8"));
    const records = ["main", "en-us"].map(language => {
      const resource = `res:/localizationfsd/localization_fsd_${language}.pickle`, relative = index.get(resource);
      if (!relative) throw new Error(`The installed client index has no ${resource}.`);
      const indexed = path.resolve(resources, relative);
      if (!inside(resources, indexed)) throw new Error("Indexed localization path escapes ResFiles.");
      const filename = fs.realpathSync(indexed);
      if (!inside(resources, filename)) throw new Error("Indexed localization reparse path escapes ResFiles.");
      const bytes = fs.readFileSync(filename), sha256 = hash(bytes), snapshotFilename = path.join(cacheRoot, sha256 + ".pickle");
      fs.mkdirSync(cacheRoot, { recursive: true });
      if (!fs.existsSync(snapshotFilename)) {
        const temporary = path.join(cacheRoot, "capture-" + crypto.randomUUID());
        fs.writeFileSync(temporary, bytes, { flag: "wx" });
        try { fs.linkSync(temporary, snapshotFilename); } catch (error) { if (error.code !== "EEXIST") throw error; }
        fs.unlinkSync(temporary); // Only this uniquely created nonrecursive file.
      }
      return Object.freeze({ resource, filename, sha256, length: bytes.length, snapshotFilename });
    });
    const identity = Object.freeze({ extension, index: Object.freeze({ filename: indexFilename, sha256: hash(indexBytes) }), resources: Object.freeze(records) });
    function verify() {
      if (!samePath(fs.realpathSync(extension.filename), extension.filename) || fileHash(extension.filename) !== extension.sha256 || fileHash(indexFilename) !== identity.index.sha256) throw new Error("Installed localization extension/index identity changed; restart the native host.");
      for (const record of records) {
        if (!samePath(fs.realpathSync(record.filename), record.filename) || fileHash(record.filename) !== record.sha256 || fileHash(record.snapshotFilename) !== record.sha256) throw new Error("Installed native localization resource identity changed.");
      }
    }
    verify();
    return { identity, verify };
  }
  function ready() {
    if (pending) {
      try { captured.verify(); } catch (error) { return Promise.reject(error); }
      return pending;
    }
    let input;
    try { input = capture(); } catch (error) { return Promise.reject(error); }
    captured = input;
    pending = (async () => {
      const runtime = await provider.ready(); input.verify();
      const signature = JSON.stringify(input.identity);
      let kept = preparations.get(runtime.binding);
      if (kept && kept.signature !== signature) throw new Error("Native VM already pins another localization dataset; restart the host.");
      if (!kept) {
        kept = { signature, pending: null };
        preparations.set(runtime.binding, kept); // Retain the pin even after failure; never reload partially prepared globals.
        kept.pending = Promise.resolve().then(() => {
          input.verify();
          let module;
          try { module = runtime.values.global("_prepare_localization_data").call(input.identity.extension.filename, ...input.identity.resources.map(record => record.snapshotFilename)); }
          finally { input.verify(); }
          const backend = module.getAttr("backend");
          if (!backend.getAttr("HasLanguage").call(Buffer.from("en-us")).truth()) throw new Error("Native English language preparation did not publish data.");
          return Object.freeze({
            module, backend, main: module.getAttr("main"), english: module.getAttr("english"),
            identity: Object.freeze({ ...input.identity, runtime: runtime.identity }),
            getMessageByID: (...args) => backend.getAttr("GetMessageByID").call(...args),
          });
        });
      }
      const result = await kept.pending; input.verify(); return result;
    })();
    return pending;
  }
  return Object.freeze({ ready });
}

module.exports = { createClientNativeLocalization };
