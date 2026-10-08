"use strict";

// ── Python pickle, protocol 0: the reader ───────────────────────────────────
//
// The retail client keeps its localisation in two pickles written by Python 2
// with the text protocol (cPickle.dump(obj, f), protocol 0): one opcode
// character, then for most opcodes an argument that runs to the next newline.
// This reads the opcodes those two files use, and refuses any other by name,
// so a file in another protocol is a clear error and not a wrong answer.
//
//   (        MARK                     .        STOP
//   d l t    DICT, LIST, TUPLE from the mark
//   s a      SETITEM, APPEND
//   S        STRING: a Python string literal in quotes
//   V        UNICODE: raw-unicode-escape, to the end of the line
//   I L F    INT (I01 / I00 are True / False), LONG, FLOAT
//   N        NONE
//   p g      PUT, GET: the memo
//
// A dict becomes a Map (its keys are numbers as often as strings), a list or
// a tuple an Array, a str or unicode a string, an int a number (a BigInt past
// the safe range), None null.

class PickleError extends Error {
  constructor(message) {
    super(message);
    this.name = "PickleError";
  }
}

const MARK = Symbol("mark");
const NEWLINE = 0x0a;

/** A Python 2 string literal's body, between its quotes: the escapes repr() writes. */
function unescapeString(body) {
  if (!body.includes("\\")) return body;
  return body.replace(/\\(x[0-9a-fA-F]{2}|[0-7]{1,3}|[\s\S])/g, (whole, escape) => {
    switch (escape[0]) {
      case "x": return String.fromCharCode(parseInt(escape.slice(1), 16));
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "\\": return "\\";
      case "'": return "'";
      case "\"": return "\"";
      case "a": return "\x07";
      case "b": return "\b";
      case "f": return "\f";
      case "v": return "\v";
      case "0": case "1": case "2": case "3": case "4": case "5": case "6": case "7":
        return String.fromCharCode(parseInt(escape, 8));
      default: return whole;
    }
  });
}

/** raw-unicode-escape: latin-1 bytes, with \uXXXX and \UXXXXXXXX for what is not latin-1. */
function decodeRawUnicodeEscape(line) {
  if (!line.includes("\\")) return line;
  return line.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8})/g, (whole, escape) =>
    String.fromCodePoint(parseInt(escape.slice(1), 16)));
}

function parseInteger(text, what) {
  if (!/^-?\d+$/.test(text)) throw new PickleError(`Not a pickled ${what}: ${JSON.stringify(text.slice(0, 40))}`);
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : BigInt(text);
}

/** The object a protocol 0 pickle holds. `buffer` is the whole file. */
function unpickle(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("unpickle needs a Buffer.");
  const stack = [];
  const memo = new Map();
  let at = 0;

  const line = () => {
    const end = buffer.indexOf(NEWLINE, at);
    if (end === -1) throw new PickleError("The pickle ends in the middle of an argument.");
    const text = buffer.latin1Slice(at, end);
    at = end + 1;
    return text;
  };
  const sinceMark = () => {
    const from = stack.lastIndexOf(MARK);
    if (from === -1) throw new PickleError("An opcode wants a mark and there is none.");
    return stack.splice(from).slice(1);
  };
  const top = () => {
    if (stack.length === 0) throw new PickleError("An opcode wants a value and the stack is empty.");
    return stack[stack.length - 1];
  };

  for (;;) {
    if (at >= buffer.length) throw new PickleError("The pickle ends without a STOP.");
    const opcode = String.fromCharCode(buffer[at]);
    at += 1;
    switch (opcode) {
      case "(":
        stack.push(MARK);
        break;
      case ".":
        if (stack.length !== 1) throw new PickleError(`STOP with ${stack.length} values on the stack.`);
        return stack[0];
      case "d": {
        const items = sinceMark();
        if (items.length % 2 !== 0) throw new PickleError("A dict with a key and no value.");
        const dict = new Map();
        for (let index = 0; index < items.length; index += 2) dict.set(items[index], items[index + 1]);
        stack.push(dict);
        break;
      }
      case "l":
      case "t":
        stack.push(sinceMark());
        break;
      case "s": {
        const value = stack.pop();
        const key = stack.pop();
        const dict = top();
        if (!(dict instanceof Map)) throw new PickleError("SETITEM on something that is not a dict.");
        dict.set(key, value);
        break;
      }
      case "a": {
        const value = stack.pop();
        const list = top();
        if (!Array.isArray(list)) throw new PickleError("APPEND on something that is not a list.");
        list.push(value);
        break;
      }
      case "S": {
        const literal = line();
        const quote = literal[0];
        if ((quote !== "'" && quote !== "\"") || literal.length < 2 || literal[literal.length - 1] !== quote) {
          throw new PickleError(`Not a pickled string: ${JSON.stringify(literal.slice(0, 40))}`);
        }
        stack.push(unescapeString(literal.slice(1, -1)));
        break;
      }
      case "V":
        stack.push(decodeRawUnicodeEscape(line()));
        break;
      case "I": {
        const text = line();
        stack.push(text === "01" ? true : text === "00" ? false : parseInteger(text, "int"));
        break;
      }
      case "L": {
        const text = line();
        stack.push(parseInteger(text.endsWith("L") ? text.slice(0, -1) : text, "long"));
        break;
      }
      case "F": {
        const text = line();
        const number = Number(text);
        if (text.trim() === "" || Number.isNaN(number)) throw new PickleError(`Not a pickled float: ${JSON.stringify(text.slice(0, 40))}`);
        stack.push(number);
        break;
      }
      case "N":
        stack.push(null);
        break;
      case "p":
        memo.set(line(), top());
        break;
      case "g": {
        const name = line();
        if (!memo.has(name)) throw new PickleError(`GET of memo ${JSON.stringify(name)}, which was never PUT.`);
        stack.push(memo.get(name));
        break;
      }
      default:
        throw new PickleError(`Opcode 0x${buffer[at - 1].toString(16).padStart(2, "0")} at byte ${at - 1} is not one this reader knows; it reads pickle protocol 0 only.`);
    }
  }
}

module.exports = { PickleError, unpickle };
