"use strict";

// Record what the retail client's Python 2.7 does with a set of dict keys, as
// the fixture src/gamePort/py27.js is tested against.
//
//   node scripts/build-py27-fixture.js "<client bin64 folder>" [python3 command]
//
// It writes a Python 2.7 snippet, runs it inside the client's python27.dll
// (scripts/py27-oracle.py) and saves the answers to
// test/fixtures/py27Oracle.json. Nothing in the fixture is computed by this
// repository: every hash and every ordering is the interpreter's own.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WEB_ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(WEB_ROOT, "test", "fixtures", "py27Oracle.json");
const SEPARATOR = String.fromCharCode(31);

// A fixed linear congruential generator: the cases are the same on every run.
function generator(seed) {
  let state = seed >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % limit;
  };
}

/** Key sets: strings, and integers as BigInt so any size is exact. */
function cases() {
  const next = generator(20261008);
  const word = () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
    let text = "";
    for (let length = 1 + next(14); length > 0; length -= 1) text += alphabet[next(alphabet.length)];
    return text;
  };
  const unique = (make, count) => {
    const keys = new Map();
    while (keys.size < count) {
      const key = make();
      keys.set(String(key), key);
    }
    return [...keys.values()];
  };
  const sets = [
    // The dict the client sends at login (GPS.py Authenticate), in source order.
    ["macho_version", "boot_version", "boot_build", "boot_codename", "boot_region", "user_name",
      "user_password", "user_password_hash", "user_languageid", "user_affiliateid", "user_sso_token"],
    // The session attributes a character select changes.
    ["charid", "corpid", "allianceid", "genderID", "bloodlineID", "raceID", "schoolID", "factionid",
      "stationid", "stationid2", "solarsystemid2", "constellationid", "regionid", "shipid", "locationid",
      "corpAccountKey", "hqID", "role", "corprole", "rolesAtAll", "rolesAtBase", "rolesAtHQ", "rolesAtOther"],
    ["machoVersion"],
    ["machoVersion", "machoTimeout"],
    [2396n, 3645n, 2393n, 9828n, 2401n],
    [1054656331535n, 1054656331534n, 9988400091900n, 140000002n, 60000004n, 30002780n],
    [-1n, -2n, 0n, 1n, 2147483647n, -2147483648n, 2147483648n, -2147483649n, 4294967296n,
      2n ** 60n, -(2n ** 63n), 2n ** 70n + 12345n],
    ["flag", 5n, "itemID", 1054656331535n, "typeID", 2396n],
  ];
  for (const count of [1, 2, 5, 6, 7, 11, 12, 21, 22, 43, 86, 200]) {
    sets.push(unique(word, count));
    sets.push(unique(() => BigInt(next(100000)), count));
    sets.push(unique(() => 1000000000000n + BigInt(next(1000000000)), count));
  }
  return sets;
}

/** Inputs for binascii.crc_hqx, as hex. */
const CRC_INPUTS = [
  "", "616263", "7465737432", "00".repeat(64), "ff".repeat(300),
  // blue.marshal.Save(('\x00' * 64,)): what Placebo hashes for its login challenge.
  `7e00000000251340${"00".repeat(64)}`,
  // blue.marshal.Save(('',)): the hash the client returns for an empty server challenge.
  "7e00000000250e",
];
/** [userName, password] pairs for the client's password hash. */
const PASSWORD_INPUTS = [["Alice", "correct horse"], ["  bob ", ""], ["MiXeD", "MiXeD"], ["Łukasz", "päss"]];
const FOLD_INPUTS = ["RRFarmer", "test2", "MiXeD_Case-99"];
/** A string as a Python 2.7 unicode literal, ASCII only in the source. */
const pyUnicode = (value) => `u'${[...value].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")}'`;

/**
 * Keyword sets for a remote call, in the order written at the call site. Small
 * sets from a small alphabet, so that keys often want the same slot.
 */
function keywordCases() {
  const next = generator(8675309);
  const real = ["passive", "machoTimeout", "flag", "qty", "locationID", "ownerID", "itemID", "typeID", "force", "name"];
  const sets = [["passive"], ["machoTimeout"], ["flag", "qty"], ["passive", "machoTimeout"], real.slice(0, 5), real];
  for (let index = 0; index < 400; index += 1) {
    const count = 1 + next(7);
    const keys = new Set();
    while (keys.size < count) {
      keys.add(next(3) === 0 ? real[next(real.length)] : `k${"abcdefgh"[next(8)]}${next(40)}`);
    }
    sets.push([...keys]);
  }
  return sets;
}

/** A key as Python 2.7 source. */
const literal = (key) => (typeof key === "string" ? JSON.stringify(key) : String(key));
/** A key as the fixture writes it: "s:name" or "i:123", exact for any integer. */
const tag = (key) => (typeof key === "string" ? `s:${key}` : `i:${key}`);

function snippet(sets) {
  const lines = [
    "import sys",
    "def tag(k):",
    "    return ('s:' + k) if isinstance(k, str) else ('i:%d' % k)",
    "out('version ' + sys.version.replace(chr(10), ' '))",
    "out('maxint %d' % sys.maxint)",
  ];
  const hashed = new Set();
  for (const keys of sets) {
    for (const key of keys) {
      if (hashed.has(tag(key))) continue;
      hashed.add(tag(key));
      lines.push(`out('hash ' + tag(${literal(key)}) + ' %d' % hash(${literal(key)}))`);
    }
    // A dict display: its table is allocated for the number of entries written.
    lines.push(`d = {${keys.map((key) => `${literal(key)}: 0`).join(", ")}}`);
    lines.push("out('literal ' + chr(31).join([tag(k) for k in d]))");
    // The same keys put into an empty dict one at a time.
    lines.push("d = {}");
    for (const key of keys) lines.push(`d[${literal(key)}] = 0`);
    lines.push("out('inserted ' + chr(31).join([tag(k) for k in d]))");
  }
  // The parts of the Placebo crypto pack and the password hash that are plain
  // Python: binascii.crc_hqx, and machobase.PasswordHash written out by hand
  // (there are no codecs in here, so UTF-16LE is spelled out).
  lines.push(
    "import binascii, _sha",
    "def u16(s):",
    "    return ''.join([chr(ord(c) & 255) + chr(ord(c) >> 8) for c in s])",
    "def password_hash(userName, password):",
    "    unicodeUserName = u16(userName.strip())",
    "    salt = unicodeUserName.lower()",
    "    h = _sha.new(u16(password) + salt)",
    "    for i in xrange(1000):",
    "        h = _sha.new(h.digest() + salt)",
    "    return h.digest()",
    "def casefold(s):",
    "    s2 = s.upper().lower()",
    "    if s2 != s:",
    "        return casefold(s2)",
    "    return s2",
  );
  // A remote call's keywords, through the same kind of layers the client's
  // call wrappers put them through: an object with __call__, then zero, one or
  // two functions taking **keywords, then a copy with machoVersion added.
  lines.push(
    "def bottom(keywords):",
    "    if keywords:",
    "        kw2 = keywords.copy()",
    "    else:",
    "        kw2 = {}",
    "    if kw2.get('machoVersion', None) is None:",
    "        kw2['machoVersion'] = 1",
    "    return chr(31).join(kw2.keys())",
    "def hop1(*args, **keywords):",
    "    return bottom(keywords)",
    "def hop2(*args, **keywords):",
    "    return hop1(*args, **keywords)",
    "class Wrapper0:",
    "    def __call__(self, *args, **keywords):",
    "        return bottom(keywords)",
    "class Wrapper1:",
    "    def __call__(self, *args, **keywords):",
    "        return hop1(*args, **keywords)",
    "class Wrapper2(object):",
    "    def __call__(self, *args, **keywords):",
    "        return hop2(*args, **keywords)",
    "w0 = Wrapper0(); w1 = Wrapper1(); w2 = Wrapper2()",
    // A plain function, which is what a remote SERVICE's method is in the client.
    "def function0(*args, **keywords):",
    "    return bottom(keywords)",
    // A call that rides along with a Moniker's bind (moniker.py): the wrapper is an object with __call__, and
    // Bind builds the keywords anew without the two the client keeps to itself. Nothing is added to them.
    "class MonikerWrap:",
    "    def __call__(self, *args, **kw):",
    "        call = ('Method', args, kw)",
    "        localKeywords = ('machoTimeout', 'noCallThrottling')",
    "        if call is not None and call[2]:",
    "            c2 = {k: v for k, v in call[2].iteritems() if k not in localKeywords}",
    "            call = (call[0], call[1], c2)",
    "        return chr(31).join(call[2].keys())",
    "mw = MonikerWrap()",
  );
  for (const keys of keywordCases()) {
    const call = `(1, ${keys.map((key) => `${key}=0`).join(", ")})`;
    lines.push(`out('kw ' + w0${call} + chr(30) + w1${call} + chr(30) + w2${call} + chr(30) + function0${call} + chr(30) + mw${call})`);
  }
  for (const hex of CRC_INPUTS) {
    lines.push(`out('crc ${hex} %d' % binascii.crc_hqx(binascii.unhexlify('${hex}'), 0))`);
  }
  for (const [user, password] of PASSWORD_INPUTS) {
    const [u, p] = [pyUnicode(user), pyUnicode(password)];
    lines.push(`out('pw ' + binascii.hexlify(u16(${u})) + ' ' + binascii.hexlify(u16(${p})) + ' ' + binascii.hexlify(password_hash(${u}, ${p})))`);
  }
  for (const name of FOLD_INPUTS) {
    lines.push(`out('fold ${name} ' + casefold('${name}'))`);
  }
  return `${lines.join("\n")}\n`;
}

function main(argv = process.argv.slice(2)) {
  const [clientBin, python = "python"] = argv;
  if (!clientBin) {
    throw new Error('Usage: node scripts/build-py27-fixture.js "<client bin64 folder>" [python3 command]');
  }
  const sets = cases();
  const snippetPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wc-py27-")), "snippet.py");
  fs.writeFileSync(snippetPath, snippet(sets), "latin1");
  const output = childProcess.execFileSync(python, [path.join(__dirname, "py27-oracle.py"), clientBin, snippetPath], {
    encoding: "latin1",
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.rmSync(path.dirname(snippetPath), { recursive: true, force: true });

  const fixture = {
    about: "What the retail client's own Python 2.7 answers. Rebuild with scripts/build-py27-fixture.js; never edit by hand.",
    interpreter: "",
    maxint: 0,
    hashes: [],
    dicts: [],
    crc: [],
    passwordHashes: [],
    caseFolds: [],
    keywords: [],
  };
  const orders = { literal: [], inserted: [] };
  const keywordSets = keywordCases();
  for (const raw of output.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const space = line.indexOf(" ");
    const [kind, rest] = [line.slice(0, space), line.slice(space + 1)];
    if (kind === "version") fixture.interpreter = rest.trim();
    else if (kind === "maxint") fixture.maxint = Number(rest);
    else if (kind === "hash") {
      const split = rest.lastIndexOf(" ");
      fixture.hashes.push([rest.slice(0, split), Number(rest.slice(split + 1))]);
    } else if (kind === "crc") {
      // An empty input leaves two spaces: "crc  0".
      const split = rest.lastIndexOf(" ");
      fixture.crc.push([rest.slice(0, split), Number(rest.slice(split + 1))]);
    } else if (kind === "pw") {
      // [userName, password] as UTF-16LE hex, then the 20-byte digest as hex.
      fixture.passwordHashes.push(rest.split(" "));
    } else if (kind === "kw") {
      // The same call made on an object with __call__ whose keywords then pass
      // through no, one and two more functions, and made on a plain function.
      const [object0, object1, object2, viaFunction, moniker] = rest.split(String.fromCharCode(30)).map((order) => order.split(SEPARATOR));
      // And made on a Moniker that is not bound yet, where the call goes with the bind: none left is one empty name.
      const viaMoniker = moniker.filter((name) => name !== "");
      fixture.keywords.push({ written: keywordSets[fixture.keywords.length], viaObject: [object0, object1, object2], viaFunction, viaMoniker });
    } else if (kind === "fold") {
      fixture.caseFolds.push(rest.split(" "));
    } else if (kind === "literal" || kind === "inserted") {
      orders[kind].push(rest.split(SEPARATOR));
    }
  }
  if (orders.literal.length !== sets.length || orders.inserted.length !== sets.length) {
    throw new Error(`The oracle answered ${orders.literal.length}/${orders.inserted.length} of ${sets.length} cases.`);
  }
  fixture.dicts = sets.map((keys, index) => ({
    keys: keys.map(tag),
    literal: orders.literal[index],
    inserted: orders.inserted[index],
  }));
  fs.writeFileSync(OUTPUT, `${JSON.stringify(fixture)}\n`, "utf8");
  if (fixture.crc.length !== CRC_INPUTS.length || fixture.passwordHashes.length !== PASSWORD_INPUTS.length || fixture.keywords.length !== keywordSets.length) {
    throw new Error("The oracle did not answer every CRC and password case.");
  }
  console.log(
    `Recorded ${fixture.hashes.length} hashes, ${fixture.dicts.length} dicts, ${fixture.crc.length} CRCs and ` +
      `${fixture.passwordHashes.length} password hashes, plus ${fixture.keywords.length} keyword calls, from ${fixture.interpreter}`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
