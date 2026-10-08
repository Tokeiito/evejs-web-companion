"use strict";

// The retail client's own words: the pickle reader, and the label lookup over it.
//
// The pickles here are written by hand in the shape the client's two files
// have, down to the opcodes and the memo numbering their first bytes show
// (cPickle, protocol 0):
//
//   main      (dp1\nS'languages'\np2\n(lp3\nS'ru'\np4\naS'fr' ... sS'labels'\np13\n(dp14\nI1\n(dp15\n
//             S'FullPath'\np16\nS'UI/Drones'\np17\nsS'messageID'\np18\nI1\nsS'label'\np19\n
//             S'AggressionStatePassive'\np20\nssI2\n(dp21\ng16\nS'UI/Drones' ...
//   language  (S'en-us'\np1\n(dp2\nI524288\n(V<text>\nNNtp3\nsI1\n(V<text>\nNNtp4\ns ...
//
// The labels are real label names, because those are what the server sends.
// The texts are made up: none of the client's own text is in this repository.
// scripts/client-words.js reads the real thing from an installed client.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { PickleError, unpickle } = require("../src/clientData/pickle0");
const { createClientWords, readResourceIndex } = require("../src/clientData/clientWords");
const { DIALOG_SCHEMA, dialogTable } = require("./helpers/fsdDialogs");

const pickle = (text) => Buffer.from(text, "latin1");

// ── the reader ───────────────────────────────────────────────────────────────

test("a dict of ints to dicts reads as the client's label table is written, memo and all", () => {
  const value = unpickle(pickle(
    "(dp1\nS'languages'\np2\n(lp3\nS'ru'\np4\naS'en-us'\np5\nasS'labels'\np6\n(dp7\n" +
    "I1\n(dp8\nS'FullPath'\np9\nS'UI/Drones'\np10\nsS'messageID'\np11\nI1\nsS'label'\np12\nS'AggressionStatePassive'\np13\nss" +
    // The second entry spells its keys by memo, as the real file does from its second entry on.
    "I2\n(dp14\ng9\nS'UI/Drones'\np15\nsg11\nI2\nsg12\nS'AggressionStateAggressive'\np16\nsss.",
  ));
  assert.ok(value instanceof Map);
  assert.deepEqual(value.get("languages"), ["ru", "en-us"]);
  const labels = value.get("labels");
  assert.deepEqual([...labels.keys()], [1, 2]);
  assert.deepEqual([...labels.get(1)], [["FullPath", "UI/Drones"], ["messageID", 1], ["label", "AggressionStatePassive"]]);
  assert.deepEqual([...labels.get(2)], [["FullPath", "UI/Drones"], ["messageID", 2], ["label", "AggressionStateAggressive"]]);
});

test("a language file reads as (language, {messageID: (text, None, None)})", () => {
  const value = unpickle(pickle("(S'en-us'\np1\n(dp2\nI524288\n(VFirst text\nNNtp3\nsI1\n(VSecond {[item]thing.name}\nNNtp4\nstp5\n."));
  assert.equal(value[0], "en-us");
  assert.deepEqual([...value[1]], [[524288, ["First text", null, null]], [1, ["Second {[item]thing.name}", null, null]]]);
});

test("unicode is raw-unicode-escape: latin-1 as it stands, and \\u, \\U for the rest", () => {
  const value = unpickle(pickle("(lp0\nVcaf\xe9 \\u2014 \\u65e5\\u672c \\U0001f680 a\\\\b\naV\na."));
  assert.deepEqual(value, ["café — 日本 🚀 a\\\\b", ""]);
});

test("a str is a Python literal, with the escapes repr writes, in either quote", () => {
  const value = unpickle(pickle("(lp0\nS'it\\'s'\naS\"say \\\"hi\\\"\"\naS'tab\\there\\nnew \\\\ slash \\x41\\101'\naS''\na."));
  assert.deepEqual(value, ["it's", "say \"hi\"", "tab\there\nnew \\ slash AA", ""]);
});

test("numbers, booleans, None and a tuple", () => {
  const value = unpickle(pickle("(I7\nI-3\nI01\nI00\nL12345678901234567890L\nL5L\nF1.5\nF-2e3\nNtp0\n."));
  assert.deepEqual(value, [7, -3, true, false, 12345678901234567890n, 5, 1.5, -2000, null]);
});

test("a dict whose items are already on the stack takes them as key, value, key, value", () => {
  // cPickle writes an empty dict and sets items one by one; another writer may put them under the mark.
  const value = unpickle(pickle("(S'a'\nI1\nS'b'\nI2\nd."));
  assert.deepEqual([...value], [["a", 1], ["b", 2]]);
});

test("what this reader does not know is refused by name, not misread", () => {
  const cases = [
    // A binary pickle (protocol 2 begins 0x80 0x02).
    ["\x80\x02}q\x00.", /Opcode 0x80 at byte 0 .*protocol 0 only/],
    ["(dp1\nS'a'\nI1\ns", /ends without a STOP/],
    ["I1", /ends in the middle of an argument/],
    ["Iseven\n.", /Not a pickled int/],
    ["Sno quotes\n.", /Not a pickled string/],
    ["S'unfinished\n.", /Not a pickled string/],
    ["Fabc\n.", /Not a pickled float/],
    ["g9\n.", /GET of memo "9"/],
    ["I1\nI2\n.", /STOP with 2 values/],
    ["d.", /wants a mark/],
    ["(I1\nd.", /a key and no value/],
    ["I1\nI2\nI3\ns.", /SETITEM on something that is not a dict/],
    ["I1\nI2\na.", /APPEND on something that is not a list/],
    ["p0\n.", /the stack is empty/],
  ];
  for (const [text, message] of cases) {
    assert.throws(() => unpickle(pickle(text)), (error) => error instanceof PickleError && message.test(error.message), JSON.stringify(text));
  }
  assert.throws(() => unpickle("(dp1\n."), TypeError);
});

// ── the client's index ───────────────────────────────────────────────────────

test("the resource index maps a resource's name, whatever its case, to its file", () => {
  const index = readResourceIndex([
    "res:/localizationfsd/localization_fsd_main.pickle,79/79a4_c2f3,c2f3,3340890,751714",
    "res:/LocalizationFSD/Localization_fsd_EN-US.pickle,2c/2c30_5067,5067,40445484,8001079",
    "",
    "not a resource line",
    "app:/not/a/resource,aa/file,x,1,1",
    "res:/empty/name,",
  ].join("\r\n"));
  assert.deepEqual([...index], [
    ["res:/localizationfsd/localization_fsd_main.pickle", "79/79a4_c2f3"],
    ["res:/localizationfsd/localization_fsd_en-us.pickle", "2c/2c30_5067"],
  ]);
});

// ── the words ────────────────────────────────────────────────────────────────

const CLIENT = path.resolve("/a/client");
const INDEX = [
  "res:/localizationfsd/localization_fsd_main.pickle,79/main-file,x,1,1",
  "res:/localizationfsd/localization_fsd_en-us.pickle,2c/english-file,x,1,1",
  "res:/localizationfsd/localization_fsd_de.pickle,de/german-file,x,1,1",
  "res:/staticdata/dialogs.static,d1/dialogs-file,x,1,1",
  "res:/staticdata/dialogs.schema,d2/dialogs-schema,x,1,1",
].join("\n");
// The client's dialog table: made-up dialogs, their titles and bodies among the made-up texts below.
const DIALOGS = dialogTable({
  MadeUpQuestion: { dialogID: 1, type: "question", titleID: 235502, bodyID: 99, suppressable: true },
  OnlyABody: { dialogID: 2, type: "notify", bodyID: 235503 },
  NoWords: { dialogID: 3, type: "warning", titleID: 12345, bodyID: 7 },
  AnsweredYes: { dialogID: 4, type: "question", bodyID: 99, suppressable: "ID_YES" },
  NotSuppressed: { dialogID: 5, type: "question", bodyID: 99, suppressable: false },
  // A value the enum has no name for.
  OddlySuppressed: { dialogID: 6, type: "question", bodyID: 99, suppressable: 5 },
});
const MAIN =
  "(dp1\nS'labels'\np2\n(dp3\n" +
  "I235502\n(dp4\nS'FullPath'\np5\nS'UI/Agents/StandardMission'\np6\nsS'messageID'\np7\nI235502\nsS'label'\np8\nS'DeclineMissionTitle'\np9\nss" +
  "I235503\n(dp10\ng5\nS'UI/Agents/StandardMission'\np11\nsg7\nI235503\nsg8\nS'DeclineMessage'\np12\nss" +
  // A label the language has no text for, and one whose entry gives another message's ID.
  "I7\n(dp13\ng5\nS'UI/Agents/Research'\np14\nsg7\nI7\nsg8\nS'Unworded'\np15\nss" +
  "I8\n(dp16\ng5\nS'UI/Agents/Research'\np17\nsg7\nI235502\nsg8\nS'Borrowed'\np18\nss" +
  "s.";
const ENGLISH = "(S'en-us'\np1\n(dp2\nI235502\n(VA made-up title?\nNNtp3\nsI235503\n(VA made-up body, until {[datetime]when}.\nNNtp4\nsI99\n(VA text no label names\nNNtp5\nstp6\n.";
const GERMAN = "(S'de'\np1\n(dp2\nI235502\n(VEin erfundener Titel?\nNNtp3\nstp4\n.";

function fakeClient(files = {}) {
  const reads = [];
  const all = {
    [path.join(CLIENT, "tq", "resfileindex.txt")]: INDEX,
    [path.join(CLIENT, "ResFiles", "79/main-file")]: pickle(MAIN),
    [path.join(CLIENT, "ResFiles", "2c/english-file")]: pickle(ENGLISH),
    [path.join(CLIENT, "ResFiles", "de/german-file")]: pickle(GERMAN),
    [path.join(CLIENT, "ResFiles", "d1/dialogs-file")]: DIALOGS,
    [path.join(CLIENT, "ResFiles", "d2/dialogs-schema")]: Buffer.from(DIALOG_SCHEMA, "utf8"),
    ...files,
  };
  const readFile = (file) => {
    reads.push(file);
    if (!(file in all) || all[file] === null) throw Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
    return all[file];
  };
  return { readFile, reads };
}

test("a label is the client's own text for it, with its parameters left in", () => {
  const { readFile } = fakeClient();
  const words = createClientWords({ clientRoot: CLIENT, readFile });
  assert.equal(words.available(), true);
  assert.equal(words.template("UI/Agents/StandardMission/DeclineMissionTitle"), "A made-up title?");
  assert.equal(words.template("UI/Agents/StandardMission/DeclineMessage"), "A made-up body, until {[datetime]when}.");
  // The entry's own messageID is the one looked up.
  assert.equal(words.template("UI/Agents/Research/Borrowed"), "A made-up title?");
  // No text in this language, no such label, half a label, not a label at all: null, never a guess.
  for (const missing of ["UI/Agents/Research/Unworded", "UI/Nope/NotALabel", "UI/Agents/StandardMission", "DeclineMessage", "", 235502, null, undefined]) {
    assert.equal(words.template(missing), null, String(missing));
  }
  assert.deepEqual(words.templates(["UI/Agents/StandardMission/DeclineMissionTitle", "UI/Nope/NotALabel", 7]), {
    "UI/Agents/StandardMission/DeclineMissionTitle": "A made-up title?",
    "UI/Nope/NotALabel": null,
  });
  assert.deepEqual(words.templates("not a list"), {});
  assert.deepEqual(words.status(), { available: true, loaded: true, labels: 4, worded: 3, messages: 3, everyMessageKept: false, dialogs: 6, language: "en-us", error: null });
});

test("the client's files are read once, when first asked, and from where its index says", () => {
  const { readFile, reads } = fakeClient();
  const words = createClientWords({ clientRoot: CLIENT, readFile });
  assert.deepEqual(reads, [], "nothing is read until a label is asked for");
  assert.deepEqual(words.status(), { available: true, loaded: false, labels: 0, worded: 0, messages: 0, everyMessageKept: false, dialogs: 0, language: "en-us", error: null });
  words.template("UI/Agents/StandardMission/DeclineMissionTitle");
  words.template("UI/Agents/StandardMission/DeclineMessage");
  words.templates(["UI/Nope/NotALabel"]);
  words.dialog("MadeUpQuestion");
  words.dialogs(["OnlyABody", "NoSuchDialog"]);
  assert.deepEqual(reads, [
    path.join(CLIENT, "tq", "resfileindex.txt"),
    path.join(CLIENT, "ResFiles", "79/main-file"),
    path.join(CLIENT, "ResFiles", "2c/english-file"),
    path.join(CLIENT, "ResFiles", "d1/dialogs-file"),
    path.join(CLIENT, "ResFiles", "d2/dialogs-schema"),
  ]);
});

test("another language is read from its own file", () => {
  const { readFile } = fakeClient();
  const words = createClientWords({ clientRoot: CLIENT, language: "de", readFile });
  assert.equal(words.template("UI/Agents/StandardMission/DeclineMissionTitle"), "Ein erfundener Titel?");
  assert.equal(words.template("UI/Agents/StandardMission/DeclineMessage"), null);
  // The index is read without regard to case, so a language named in capitals finds the same file.
  const capitals = createClientWords({ clientRoot: CLIENT, language: "DE", readFile });
  assert.equal(capitals.template("UI/Agents/StandardMission/DeclineMissionTitle"), "Ein erfundener Titel?");
});

test("with no client configured there are no words, and nothing is read", () => {
  const { readFile, reads } = fakeClient();
  for (const clientRoot of [null, undefined, ""]) {
    const words = createClientWords({ clientRoot, readFile });
    assert.equal(words.available(), false);
    assert.equal(words.template("UI/Agents/StandardMission/DeclineMissionTitle"), null);
    assert.deepEqual(words.templates(["UI/Agents/StandardMission/DeclineMissionTitle"]), { "UI/Agents/StandardMission/DeclineMissionTitle": null });
  }
  assert.deepEqual(reads, []);
});

test("a client that cannot be read gives no words, says why once, and is not read again", () => {
  const broken = [
    [{ [path.join(CLIENT, "tq", "resfileindex.txt")]: null }, /ENOENT/],
    [{ [path.join(CLIENT, "tq", "resfileindex.txt")]: "res:/something/else,aa/file,x,1,1" }, /index has no res:\/localizationfsd\/localization_fsd_main\.pickle/],
    [{ [path.join(CLIENT, "ResFiles", "79/main-file")]: pickle("\x80\x02}q\x00.") }, /protocol 0 only/],
    [{ [path.join(CLIENT, "ResFiles", "79/main-file")]: pickle("(dp1\nS'other'\np2\nI1\ns.") }, /label table is not where it is expected/],
    [{ [path.join(CLIENT, "ResFiles", "2c/english-file")]: pickle("(dp1\n.") }, /en-us texts are not where they are expected/],
  ];
  for (const [files, message] of broken) {
    const { readFile, reads } = fakeClient(files);
    const errors = [];
    const words = createClientWords({ clientRoot: CLIENT, readFile, onError: (error) => errors.push(error.message) });
    assert.equal(words.template("UI/Agents/StandardMission/DeclineMissionTitle"), null);
    const readsAfterFirst = reads.length;
    assert.equal(words.template("UI/Agents/StandardMission/DeclineMessage"), null);
    assert.equal(errors.length, 1, "told once");
    assert.match(errors[0], message);
    assert.equal(reads.length, readsAfterFirst, "and not read again");
    assert.match(words.status().error, message);
    assert.equal(words.status().loaded, false);
  }
});

// ── a text by its message ID ─────────────────────────────────────────────────
//
// What an agent says when offering a mission is a message's number, and the
// client fills that message (agents.py ProcessMessage, GetByMessageID).

test("a text is found by its message ID, whether or not a label names it", () => {
  const { readFile } = fakeClient();
  const words = createClientWords({ clientRoot: CLIENT, readFile });
  assert.equal(words.message(99), "A text no label names");
  assert.equal(words.message(235503), "A made-up body, until {[datetime]when}.");
  for (const missing of [7, 0, -99, 99.5, "99", null, undefined, Number.NaN]) {
    assert.equal(words.message(missing), null, String(missing));
  }
  assert.deepEqual(words.messages([99, 7, 235502, "99", 0, null]), { 99: "A text no label names", 7: null, 235502: "A made-up title?" });
  assert.deepEqual(words.messages("not a list"), {});
  // Labels go on answering as before.
  assert.equal(words.template("UI/Agents/StandardMission/DeclineMissionTitle"), "A made-up title?");
});

test("every text is kept only once one is asked for by number, and the language file is read again for that once", () => {
  const { readFile, reads } = fakeClient();
  const words = createClientWords({ clientRoot: CLIENT, readFile });
  words.template("UI/Agents/StandardMission/DeclineMissionTitle");
  assert.equal(words.status().everyMessageKept, false);
  const afterLabels = reads.length;
  words.message(99);
  assert.equal(words.status().everyMessageKept, true);
  assert.deepEqual(reads.slice(afterLabels), [
    path.join(CLIENT, "tq", "resfileindex.txt"),
    path.join(CLIENT, "ResFiles", "2c/english-file"),
  ]);
  words.message(235503);
  words.messages([99, 7]);
  words.template("UI/Agents/StandardMission/DeclineMessage");
  assert.equal(reads.length, afterLabels + 2, "and not again");
});

test("asked for by number first, a text is found all the same, and so are labels after it", () => {
  const { readFile, reads } = fakeClient();
  const words = createClientWords({ clientRoot: CLIENT, readFile });
  // What is not a message's number is answered without reading anything.
  for (const junk of ["99", 0, -1, 1.5, null]) {
    assert.equal(words.message(junk), null);
  }
  assert.deepEqual(reads, []);
  assert.equal(words.message(99), "A text no label names");
  // Only the index and the language file: the label table is not needed for a number.
  assert.deepEqual(reads, [path.join(CLIENT, "tq", "resfileindex.txt"), path.join(CLIENT, "ResFiles", "2c/english-file")]);
  assert.equal(words.template("UI/Agents/StandardMission/DeclineMissionTitle"), "A made-up title?");
  assert.deepEqual(words.status(), { available: true, loaded: true, labels: 4, worded: 3, messages: 3, everyMessageKept: true, dialogs: 6, language: "en-us", error: null });
});

test("with no client, or a client that cannot be read, there is no text by number either", () => {
  const none = fakeClient();
  const unexpected = () => assert.fail("with no client there is nothing to fail at");
  assert.equal(createClientWords({ clientRoot: null, readFile: none.readFile, onError: unexpected }).message(99), null);
  assert.deepEqual(createClientWords({ clientRoot: null, readFile: none.readFile, onError: unexpected }).messages([99]), { 99: null });
  assert.deepEqual(none.reads, []);

  // The language file goes bad between the first read and the second.
  const good = fakeClient();
  const { reads } = good;
  let goneBad = false;
  const readFile = (file, ...rest) => {
    const read = good.readFile(file, ...rest);
    return goneBad && file.endsWith("english-file") ? pickle("(dp1\n.") : read;
  };
  const errors = [];
  const words = createClientWords({ clientRoot: CLIENT, readFile, onError: (error) => errors.push(error.message) });
  assert.equal(words.template("UI/Agents/StandardMission/DeclineMissionTitle"), "A made-up title?");
  goneBad = true;
  assert.equal(words.message(99), null);
  const readsAfter = reads.length;
  assert.equal(words.message(99), null);
  assert.equal(errors.length, 1, "told once");
  assert.match(errors[0], /en-us texts are not where they are expected/);
  assert.equal(reads.length, readsAfter, "and not read again");
  assert.equal(words.status().everyMessageKept, false);
});

// ── a dialog by its name ─────────────────────────────────────────────────────
//
// The server names some of what it asks or refuses with as a dialog
// ("ShipContrabandWarningUndock", the customs question), and the client's
// dialog table says which two messages are that dialog's title and body
// (eveCfg.GetMessage: msg.titleID, msg.bodyID, msg.dialogType, msg.suppressable).

test("a dialog is its kind, whether it can be suppressed, and the client's title and body with their parameters left in", () => {
  const { readFile } = fakeClient();
  const words = createClientWords({ clientRoot: CLIENT, readFile });
  // The body is a text no label names: a dialog's texts are kept without the whole language file.
  assert.deepEqual(words.dialog("MadeUpQuestion"), { type: "question", suppressable: true, title: "A made-up title?", body: "A text no label names" });
  assert.equal(words.status().everyMessageKept, false);
  assert.deepEqual(words.dialog("OnlyABody"), { type: "notify", suppressable: false, title: null, body: "A made-up body, until {[datetime]when}." });
  // A title and a body the language has no text for.
  assert.deepEqual(words.dialog("NoWords"), { type: "warning", suppressable: false, title: null, body: null });
  // Suppressed as an answer (ID_YES, ID_NO) is suppressable; false is not, whether said or left out.
  assert.equal(words.dialog("AnsweredYes").suppressable, true);
  assert.equal(words.dialog("NotSuppressed").suppressable, false);
  assert.equal(words.dialog("OddlySuppressed").suppressable, false);
  for (const missing of ["NoSuchDialog", "madeupquestion", "", 1, null, undefined, ["MadeUpQuestion"]]) {
    assert.equal(words.dialog(missing), null, String(missing));
  }
  assert.deepEqual(words.dialogs(["OnlyABody", "NoSuchDialog", 7, null]), {
    OnlyABody: { type: "notify", suppressable: false, title: null, body: "A made-up body, until {[datetime]when}." },
    NoSuchDialog: null,
  });
  assert.deepEqual(words.dialogs("not a list"), {});
  // What comes back is the caller's own: changing it changes nothing here.
  words.dialog("MadeUpQuestion").title = "changed";
  assert.equal(words.dialog("MadeUpQuestion").title, "A made-up title?");
});

test("a dialog asked for first is found, in the language asked for, and labels are found after it", () => {
  const { readFile } = fakeClient();
  const german = createClientWords({ clientRoot: CLIENT, language: "de", readFile });
  assert.deepEqual(german.dialog("MadeUpQuestion"), { type: "question", suppressable: true, title: "Ein erfundener Titel?", body: null });
  assert.equal(german.template("UI/Agents/StandardMission/DeclineMissionTitle"), "Ein erfundener Titel?");
  assert.equal(german.status().dialogs, 6);
});

test("with no client there are no dialogs, and nothing is read", () => {
  const { readFile, reads } = fakeClient();
  const words = createClientWords({ clientRoot: null, readFile, onError: () => assert.fail("with no client there is nothing to fail at") });
  assert.equal(words.dialog("MadeUpQuestion"), null);
  assert.deepEqual(words.dialogs(["MadeUpQuestion"]), { MadeUpQuestion: null });
  assert.deepEqual(reads, []);
});

test("a dialog table that cannot be read costs the dialogs and not the labels, and says why once", () => {
  const broken = [
    [{ [path.join(CLIENT, "tq", "resfileindex.txt")]: INDEX.split("\n").filter((line) => !line.includes("dialogs.static")).join("\n") }, /index has no res:\/staticdata\/dialogs\.static/],
    [{ [path.join(CLIENT, "tq", "resfileindex.txt")]: INDEX.split("\n").filter((line) => !line.includes("dialogs.schema")).join("\n") }, /index has no res:\/staticdata\/dialogs\.schema/],
    [{ [path.join(CLIENT, "ResFiles", "d1/dialogs-file")]: null }, /ENOENT/],
    [{ [path.join(CLIENT, "ResFiles", "d1/dialogs-file")]: DIALOGS.subarray(0, DIALOGS.length - 3) }, /ends before a dict's footer size/],
    [{ [path.join(CLIENT, "ResFiles", "d2/dialogs-schema")]: Buffer.from("type: vector3\n") }, /"vector3" node is not one this reader knows/],
  ];
  for (const [files, message] of broken) {
    const { readFile, reads } = fakeClient(files);
    const errors = [];
    const words = createClientWords({ clientRoot: CLIENT, readFile, onError: (error) => errors.push(error.message) });
    assert.equal(words.dialog("MadeUpQuestion"), null);
    assert.deepEqual(words.dialogs(["OnlyABody"]), { OnlyABody: null });
    // The labels and the numbered texts are there all the same.
    assert.equal(words.template("UI/Agents/StandardMission/DeclineMissionTitle"), "A made-up title?");
    const readsAfter = reads.length;
    assert.equal(words.dialog("OnlyABody"), null);
    assert.equal(errors.length, 1, "told once");
    assert.match(errors[0], message);
    assert.equal(reads.length, readsAfter, "and not read again");
    const status = words.status();
    assert.equal(status.loaded, true);
    assert.equal(status.dialogs, 0);
    assert.equal(status.worded, 3);
    assert.match(status.error, message);
    assert.equal(words.message(99), "A text no label names");
  }
});

test("a client whose labels cannot be read has no dialogs either", () => {
  const { readFile } = fakeClient({ [path.join(CLIENT, "ResFiles", "79/main-file")]: pickle("(dp1\nS'other'\np2\nI1\ns.") });
  const errors = [];
  const words = createClientWords({ clientRoot: CLIENT, readFile, onError: (error) => errors.push(error.message) });
  assert.equal(words.dialog("MadeUpQuestion"), null);
  assert.deepEqual(words.dialogs(["MadeUpQuestion"]), { MadeUpQuestion: null });
  assert.equal(errors.length, 1);
  assert.equal(words.status().dialogs, 0);
});
