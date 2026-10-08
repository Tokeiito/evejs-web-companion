"use strict";

// Reads the retail client's own words from an installed client, and says what it found.
//
//   node scripts/client-words.js <clientRoot> [label | dialog:<Name> ...]
//
// <clientRoot> is the folder that holds `tq` and `ResFiles`. With nothing asked
// for it reports only the counts. For each label it reports the length of the
// client's text, the parameters it takes, and its first forty characters:
// enough to see that the right text was found, without copying the client's
// text out of the client. For a dialog by its name ("dialog:" and the key the
// server sends, as in dialog:ShipContrabandWarningUndock) it reports the
// dialog's kind and the same for its title and for its body.
//
// The BFF reads the same data when EVEJS_CLIENT_ROOT names that folder
// (src/clientData/clientWords.js).

const { createClientWords } = require("../src/clientData/clientWords");

function describe(text) {
  if (text === null) return "not found";
  const parameters = text.match(/\{[^{}]*\}/g) || [];
  return `${text.length} characters; parameters ${parameters.length > 0 ? parameters.join(" ") : "none"}; begins ${JSON.stringify(text.slice(0, 40))}`;
}

function main(argv = process.argv.slice(2)) {
  const [clientRoot, ...asked] = argv;
  if (!clientRoot) {
    console.error("Usage: node scripts/client-words.js <clientRoot> [label | dialog:<Name> ...]");
    return 2;
  }
  const started = Date.now();
  const words = createClientWords({ clientRoot, onError: (error) => console.error(`could not read the client: ${error.message}`) });
  // Asking for any label loads the data.
  words.template("");
  const status = words.status();
  console.log(`${status.labels} labels, ${status.worded} with ${status.language} text, among ${status.messages} texts; ${status.dialogs} dialogs; read in ${Date.now() - started} ms`);
  for (const name of asked) {
    if (name.startsWith("dialog:")) {
      const dialog = words.dialog(name.slice("dialog:".length));
      if (dialog === null) {
        console.log(`${name}: not found`);
      } else {
        console.log(`${name}: ${dialog.type}${dialog.suppressable ? ", can be suppressed" : ""}`);
        console.log(`  title: ${describe(dialog.title)}`);
        console.log(`  body:  ${describe(dialog.body)}`);
      }
    } else {
      console.log(`${name}: ${describe(words.template(name))}`);
    }
  }
  return status.error ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
