"use strict";

// ── The retail client's own words ────────────────────────────────────────────
//
// The server words much of what it sends as localisation labels,
// "UI/Agents/StandardMission/DeclineMessage" with a dict of parameters, and
// only the retail client's data turns a label into text. That data is on the
// player's own disk, in their own copy of the client, and this reads it from
// there at run time. Nothing of it is copied into this repository.
//
// Where it is, from the client's own index (<client>/tq/resfileindex.txt, one
// line per resource: "res:/path,<file under ResFiles>,<md5>,<size>,<packed>"):
//
//   res:/localizationfsd/localization_fsd_main.pickle
//       {'labels': {messageID: {'FullPath': 'UI/Agents/StandardMission',
//                               'label': 'DeclineMessage', 'messageID': ...}}}
//   res:/localizationfsd/localization_fsd_<language>.pickle
//       (language, {messageID: (text, metaData, tokens)})
//
// (carbon/common/script/localization/localizationBase.py loads the same two.)
// A label's full name is its FullPath, a slash, and its label.
//
// What comes back for a label is the client's TEMPLATE, with its {parameters}
// still in it: filling them needs names the browser already keeps.
//
// A text can also be asked for by its message ID, which is how the server
// names a mission's own text (what an agent says when offering one is a
// number, and agents.py ProcessMessage hands it to GetByMessageID). Those are
// among the 300,000 texts no label names, so the whole language file is kept
// from the first time one is asked for, and not before: it is about 90 MB.

const fs = require("node:fs");
const path = require("node:path");
const { unpickle } = require("./pickle0");

const MAIN = "res:/localizationfsd/localization_fsd_main.pickle";
const languageResource = (language) => `res:/localizationfsd/localization_fsd_${language}.pickle`;

/** The client's resource index: resource name (lower case) -> path under ResFiles. */
function readResourceIndex(text) {
  const index = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const fields = line.split(",");
    if (fields.length >= 2 && fields[0].startsWith("res:/") && fields[1]) {
      index.set(fields[0].toLowerCase(), fields[1]);
    }
  }
  return index;
}

/**
 * The client's words, read from `clientRoot` (the folder holding `tq` and
 * `ResFiles`) when first asked for.
 *
 *   available()        whether there is a client to read at all
 *   template(label)    the client's text for a label, parameters unfilled, or null
 *   templates(labels)  {label: text | null}
 *   message(id)        the client's text for a message ID, parameters unfilled, or null
 *   messages(ids)      {id: text | null}
 *   status()           {available, loaded, labels, worded, messages, everyMessageKept, language, error}
 */
function createClientWords({ clientRoot = null, language = "en-us", readFile = fs.readFileSync, onError = () => {} } = {}) {
  let loaded = null;
  let failure = null;

  const resource = (index, name) => {
    const relative = index.get(name.toLowerCase());
    if (!relative) throw new Error(`The client's index has no ${name}.`);
    return readFile(path.join(clientRoot, "ResFiles", relative));
  };

  let every = null;

  const readIndex = () => readResourceIndex(readFile(path.join(clientRoot, "tq", "resfileindex.txt"), "utf8"));
  /** The language file: messageID -> (text, metaData, tokens). */
  function readMessages(index) {
    const translated = unpickle(resource(index, languageResource(language)));
    const messages = Array.isArray(translated) ? translated[1] : null;
    if (!(messages instanceof Map)) throw new Error(`The client's ${language} texts are not where they are expected.`);
    return messages;
  }
  const textOf = (message) => {
    const text = Array.isArray(message) ? message[0] : message;
    return typeof text === "string" ? text : null;
  };

  /** Every text by its message ID, read and kept the first time one is asked for by number. */
  function loadEvery() {
    if (every || failure) return every;
    try {
      const kept = new Map();
      for (const [messageID, message] of readMessages(readIndex())) kept.set(messageID, textOf(message));
      every = kept;
    } catch (error) {
      failure = error;
      onError(error);
    }
    return every;
  }

  function load() {
    if (loaded || failure) return loaded;
    try {
      const index = readIndex();
      const main = unpickle(resource(index, MAIN));
      const labels = main instanceof Map ? main.get("labels") : null;
      if (!(labels instanceof Map)) throw new Error("The client's label table is not where it is expected.");
      const messages = readMessages(index);
      // Only what a label names is kept. The language file holds ten times as much (every item's name and
      // description among it), and none of that is reached by label.
      const texts = new Map();
      for (const [messageID, entry] of labels) {
        if (!(entry instanceof Map)) continue;
        const folder = entry.get("FullPath");
        const name = entry.get("label");
        if (typeof folder !== "string" || typeof name !== "string" || name === "") continue;
        const text = textOf(messages.get(entry.get("messageID") ?? messageID));
        if (text !== null) texts.set(`${folder}/${name}`, text);
      }
      loaded = { texts, labels: labels.size, messages: messages.size };
    } catch (error) {
      failure = error;
      onError(error);
    }
    return loaded;
  }

  const available = () => Boolean(clientRoot);

  function template(label) {
    if (!available() || typeof label !== "string") return null;
    const data = load();
    return data ? data.texts.get(label) ?? null : null;
  }

  /** The client's text for a message ID, parameters unfilled, or null. */
  function message(messageID) {
    if (!available() || !Number.isSafeInteger(messageID) || messageID <= 0) return null;
    const all = loadEvery();
    return all ? all.get(messageID) ?? null : null;
  }

  return {
    available,
    template,
    message,
    templates(labels) {
      const out = {};
      for (const label of Array.isArray(labels) ? labels : []) {
        if (typeof label === "string") out[label] = template(label);
      }
      return out;
    },
    /** {messageID: text | null} */
    messages(messageIDs) {
      const out = {};
      for (const messageID of Array.isArray(messageIDs) ? messageIDs : []) {
        if (Number.isSafeInteger(messageID) && messageID > 0) out[messageID] = message(messageID);
      }
      return out;
    },
    status() {
      return {
        available: available(),
        loaded: Boolean(loaded),
        /** Labels the client defines, labels that have a text in this language, and texts in the language file. */
        labels: loaded ? loaded.labels : 0,
        worded: loaded ? loaded.texts.size : 0,
        messages: loaded ? loaded.messages : 0,
        /** Whether every text is being kept, which is so once one has been asked for by number. */
        everyMessageKept: Boolean(every),
        language,
        error: failure ? String(failure.message || failure) : null,
      };
    },
  };
}

module.exports = { createClientWords, readResourceIndex };
