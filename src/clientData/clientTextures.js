"use strict";

// ── The client's own pictures, from the install ───────────────────────────────
//
// The retail client draws much of its UI with textures of its own, named by
// res: paths (res:/UI/Texture/Classes/Skills/doNotHave.png, a skill group's
// icon in skills/skillConst.py ICON_BY_GROUPID). The install keeps each one in
// ResFiles under a hashed name, and tq/resfileindex.txt says which: the path,
// lowercased, then the file under ResFiles. The PNGs are stored as they are.
//
// Only a PNG under res:/ui/texture/ that the index names is found here: the
// index is the whole of what may be read, and nothing else under the install.

const fs = require("node:fs");
const path = require("node:path");
const { readResourceIndex } = require("./clientWords");

const TEXTURE_PATH = /^res:\/ui\/texture\/[a-z0-9_./-]+\.png$/;

/**
 * The client's textures, read from `clientRoot` (the folder holding `tq` and
 * `ResFiles`), the index read once when first asked.
 *
 *   available()       whether there is a client to read at all
 *   fileFor(resPath)  the file under ResFiles that holds the texture, or null
 */
function createClientTextures({ clientRoot = null, readFile = fs.readFileSync } = {}) {
  let index = null;
  function fileFor(resPath) {
    if (!clientRoot) return null;
    const asked = String(resPath || "").toLowerCase();
    if (!TEXTURE_PATH.test(asked) || asked.includes("..")) return null;
    if (index === null) index = readResourceIndex(readFile(path.join(clientRoot, "tq", "resfileindex.txt"), "utf8"));
    const relative = index.get(asked);
    return relative ? path.join(clientRoot, "ResFiles", relative) : null;
  }
  return { available: () => Boolean(clientRoot), fileFor };
}

module.exports = { createClientTextures };
