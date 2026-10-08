"use strict";

// Reads the retail client's own words from an installed client, and says what it found.
//
//   node scripts/client-words.js <clientRoot> [label ...]
//
// <clientRoot> is the folder that holds `tq` and `ResFiles`. With no labels it
// reports only the counts. For each label it reports the length of the
// client's text, the parameters it takes, and its first forty characters:
// enough to see that the right text was found, without copying the client's
// text out of the client.
//
// The BFF reads the same data when EVEJS_CLIENT_ROOT names that folder
// (src/clientData/clientWords.js).

const { createClientWords } = require("../src/clientData/clientWords");

function main(argv = process.argv.slice(2)) {
  const [clientRoot, ...labels] = argv;
  if (!clientRoot) {
    console.error("Usage: node scripts/client-words.js <clientRoot> [label ...]");
    return 2;
  }
  const started = Date.now();
  const words = createClientWords({ clientRoot, onError: (error) => console.error(`could not read the client: ${error.message}`) });
  // Asking for any label loads the data.
  words.template(labels[0] ?? "");
  const status = words.status();
  console.log(`${status.labels} labels, ${status.worded} with ${status.language} text, among ${status.messages} texts; read in ${Date.now() - started} ms`);
  for (const label of labels) {
    const text = words.template(label);
    if (text === null) {
      console.log(`${label}: not found`);
    } else {
      const parameters = text.match(/\{[^{}]*\}/g) || [];
      console.log(`${label}: ${text.length} characters; parameters ${parameters.length > 0 ? parameters.join(" ") : "none"}; begins ${JSON.stringify(text.slice(0, 40))}`);
    }
  }
  return status.error ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
