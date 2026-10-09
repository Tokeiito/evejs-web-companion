"use strict";

// Prints the machoNet transport lines of one LogLite export between two line numbers, with every
// MarshalStream repr on them decoded by the server's marshal decoder.
//   node scripts/recordings/decode-lines.js <marshal.js> <log file> <from line> <to line> [filter regex]

const fs = require("fs");

const [, , marshalPath, file, fromArg, toArg, filterArg] = process.argv;
const { marshalDecode } = require(marshalPath);
const from = Number(fromArg);
const to = Number(toArg);
const filter = filterArg ? new RegExp(filterArg) : null;

function parsePyRepr(text, start) {
  const quote = text[start];
  if (quote !== "'" && quote !== '"') return null;
  const bytes = [];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === quote) return [Buffer.from(bytes), i + 1];
    if (ch === "\\") {
      const next = text[i + 1];
      if (next === "x") {
        bytes.push(parseInt(text.slice(i + 2, i + 4), 16));
        i += 4;
        continue;
      }
      const simple = { n: 10, r: 13, t: 9, "\\": 92, "'": 39, '"': 34 }[next];
      if (simple === undefined) throw new Error(`unknown escape \\${next}`);
      bytes.push(simple);
      i += 2;
      continue;
    }
    bytes.push(ch.charCodeAt(0) & 0xff);
    i += 1;
  }
  return null;
}

function show(value, depth = 0) {
  if (value === null || value === undefined) return "None";
  if (typeof value === "bigint") return `${value}L`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value.length > 70 ? `${value.slice(0, 70)}...` : value);
  if (Buffer.isBuffer(value)) {
    const text = value.toString("latin1");
    return JSON.stringify(text.length > 70 ? `${text.slice(0, 70)}...` : text);
  }
  if (depth > 9) return "...";
  if (Array.isArray(value)) return `[${value.map((item) => show(item, depth + 1)).join(", ")}]`;
  if (value.type === "dict" && Array.isArray(value.entries)) {
    return `{${value.entries.map(([k, v]) => `${show(k, depth + 1)}: ${show(v, depth + 1)}`).join(", ")}}`;
  }
  if ((value.type === "tuple" || value.type === "list") && Array.isArray(value.items)) {
    const [open, close] = value.type === "tuple" ? ["(", ")"] : ["[", "]"];
    return `${open}${value.items.map((item) => show(item, depth + 1)).join(", ")}${close}`;
  }
  if (value.type === "long" || value.type === "int") return `${value.value}L`;
  if (value.type === "substream" || value.type === "substruct") return `<${value.type} ${show(value.value, depth + 1)}>`;
  if (value.type === "object") return `<object ${show(value.name, depth + 1)} ${show(value.args, depth + 1)}>`;
  if (value.type === "rawstr" || value.type === "token" || value.type === "wstring") return JSON.stringify(String(value.value));
  return `<${value.type || "?"} ${Object.keys(value).filter((k) => k !== "type").map((k) => `${k}=${show(value[k], depth + 1)}`).join(" ")}>`;
}

const lines = fs.readFileSync(file, "latin1").split(/\r?\n/);
for (let lineNo = from; lineNo <= Math.min(to, lines.length); lineNo += 1) {
  const line = lines[lineNo - 1];
  if (!line.includes("eveMachoNet transport") && !/ScatterEvent\( OnAgentMissionChange |agents::YesNo/.test(line)) continue;
  if (filter && !filter.test(line)) continue;
  const fields = line.split("\t");
  const message = fields.slice(7).join("\t");
  const head = message.split("<MarshalStream ")[0].slice(0, 230);
  console.log(`${lineNo}\t${fields[1]}\t${head}`);
  let at = 0;
  for (;;) {
    const found = line.indexOf("<MarshalStream ", at);
    if (found < 0) break;
    const start = found + "<MarshalStream ".length;
    try {
      const parsed = parsePyRepr(line, start);
      if (!parsed) {
        console.log("    (cut line)");
        break;
      }
      console.log(`    ${show(marshalDecode(parsed[0])).slice(0, 1500)}`);
      at = parsed[1];
    } catch (error) {
      console.log(`    (undecoded: ${error && error.message})`);
      at = start;
    }
  }
}
