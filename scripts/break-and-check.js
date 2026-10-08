"use strict";

// Break the code one way at a time and check that the tests notice.
//
//   node scripts/break-and-check.js <sourceFile> <testFile> <breakages.js|json>
//
// The third argument is a list of [find, replacement] pairs: a JSON file, or a
// module that exports the array. `find` must occur exactly once in the source.
// For each pair the source is rewritten, the test file run, and the source put
// back. A breakage the tests fail on (or hang on) is "caught"; one they pass
// with has "SURVIVED" and names a gap in the tests, or an equivalent change.
//
// A test that passes the first time it is run has proved nothing yet. This is
// how the game-port loop finds out what its tests would actually notice.
//
// The source is restored when the run ends or is interrupted. A copy of the
// original is also kept beside the system's temp files for the length of the
// run, and its path printed, in case the process is killed outright: the file
// under test may be one git has never seen.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function main(argv = process.argv.slice(2)) {
  const [file, testFile, listFile] = argv;
  if (!file || !testFile || !listFile) {
    console.error("Usage: node scripts/break-and-check.js <sourceFile> <testFile> <breakages.js|json>");
    return 2;
  }
  const loaded = require(path.resolve(listFile));
  const pairs = Array.isArray(loaded) ? loaded : loaded.default || loaded.breakages;
  if (!Array.isArray(pairs)) throw new Error(`${listFile} does not hold a list of [find, replacement] pairs.`);
  const original = fs.readFileSync(file, "utf8");
  // A file git has checked out on Windows ends its lines CRLF; one written by a
  // tool ends them LF. The text to find is written with LF, so match on that.
  const crlf = original.includes("\r\n");
  const source = original.replace(/\r\n/g, "\n");
  const asWritten = (text) => (crlf ? text.replace(/\n/g, "\r\n") : text);
  const backup = path.join(os.tmpdir(), `break-and-check-${process.pid}-${path.basename(file)}`);
  fs.writeFileSync(backup, original);
  console.log(`${pairs.length} breakages of ${file}; the original is also at ${backup} until this ends`);
  const restore = () => {
    fs.writeFileSync(file, original);
    fs.rmSync(backup, { force: true });
  };
  process.on("SIGINT", () => {
    restore();
    process.exit(130);
  });
  let survived = 0;
  try {
    for (const [find, replacement] of pairs) {
      const label = `${find.replace(/\s+/g, " ").slice(0, 58)} => ${replacement.replace(/\s+/g, " ").slice(0, 34)}`;
      if (source.split(find).length !== 2) {
        console.log(`NOT TRIED ${label} | the text to find is missing or not unique`);
        survived += 1;
        continue;
      }
      // A function, so that "$&" and the like in the replacement are not read as instructions.
      fs.writeFileSync(file, asWritten(source.replace(find, () => replacement)));
      const run = spawnSync(process.execPath, ["--test", "--test-timeout=20000", testFile], { encoding: "utf8", timeout: 120000 });
      const output = run.stdout || "";
      const caught = Boolean(run.error) || run.status !== 0;
      const names = [...output.matchAll(/^✖ (.+?) \(/gm)].map((match) => match[1]);
      const why = run.error ? "the tests did not finish" : (names[0] || "").slice(0, 70);
      console.log(`${caught ? "caught   " : "SURVIVED "} ${label} | ${why}`);
      if (!caught) survived += 1;
    }
  } finally {
    restore();
  }
  console.log(survived ? `${survived} not caught` : "all caught");
  return survived ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
