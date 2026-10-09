"use strict";

// The calls one recording made on bound objects.
//
//   node scripts/recordings/object-calls.js <marshal.js> <log file>
//       every method called on each bound object, in the order each was first called, with how many times
//   node scripts/recordings/object-calls.js <marshal.js> <log file> <Method>
//       each call of that method: what it was called with, and what answered, decoded
//
// A call on a bound object is written in the log as a MarshalStream whose text has the object ("N=<node>:<n>")
// and the method's name; the answer is the CallRsp to the same call ID. An answer too large is not in the log at
// all: where one should be it says LARGE PAYLOAD and a size, and that is what is printed.

const fs = require("fs");

const [, , marshalPath, file, method] = process.argv;
const { marshalDecode } = require(marshalPath);
const log = fs.readFileSync(file, "latin1");

/** The bytes a Python repr of a str stands for: `start` is at its opening quote. */
function bytesOf(text, start) {
  const quote = text[start];
  const bytes = [];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === quote) return Buffer.from(bytes);
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "x") {
        bytes.push(parseInt(text.slice(i + 2, i + 4), 16));
        i += 4;
        continue;
      }
      bytes.push({ n: 10, r: 13, t: 9, "\\": 92, "'": 39, '"': 34 }[next]);
      i += 2;
      continue;
    }
    bytes.push(ch.charCodeAt(0) & 0xff);
    i += 1;
  }
  return null;
}

const show = (value) => JSON.stringify(value, (key, each) => (typeof each === "bigint" ? `${each}L` : each && each.type === "Buffer" ? Buffer.from(each.data).toString("latin1") : each));
const STREAM = "<MarshalStream ";
const decoded = (at) => {
  try {
    return show(marshalDecode(bytesOf(log, at + STREAM.length)));
  } catch (error) {
    return `(not decoded: ${String(error.message).slice(0, 80)})`;
  }
};

if (!method) {
  // The object, the marker of a string, its length, and the method's name.
  const called = /(N=\d+:\d+)\\x13(?:\\x[0-9a-f]{2}|\\[rnt]|.)([A-Za-z_]{3,60})/g;
  const order = [];
  const count = new Map();
  for (const match of log.matchAll(called)) {
    const key = `${match[1]} ${match[2]}`;
    if (!count.has(key)) order.push(key);
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  for (const key of order) console.log(String(count.get(key)).padStart(4), key);
} else {
  const asked = new RegExp(`callID="(\\d+)",service="None"\\),Address::Node\\(nodeID="\\d+",service="None",callID="None"\\),\\d+ bytes,\\[\\(1, <MarshalStream '[^>]{0,200}\\\\x13(?:\\\\x[0-9a-f]{2}|\\\\[rnt]|.)${method}[^A-Za-z_]`, "g");
  let found = 0;
  for (const match of log.matchAll(asked)) {
    found += 1;
    console.log(`call ${match[1]}: ${decoded(match.index + match[0].indexOf(STREAM))}`);
    // The answer to it: the next packet addressed to that call ID that is not the call itself.
    const answered = new RegExp(`callID="${match[1]}",service="None"\\),(?:(\\d+) bytes,\\[<MarshalStream |LARGE PAYLOAD\\((\\d+) bytes\\))`, "g");
    answered.lastIndex = match.index + match[0].length;
    const answer = answered.exec(log);
    if (!answer) console.log("   no answer in the log");
    else if (answer[2]) console.log(`   LARGE PAYLOAD, ${answer[2]} bytes: not in the log`);
    else console.log(`   ${decoded(answer.index + answer[0].length - STREAM.length)}`);
  }
  if (!found) console.log(`no call of ${method} on a bound object`);
}
