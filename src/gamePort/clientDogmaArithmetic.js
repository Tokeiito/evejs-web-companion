"use strict";

// Original dogma.const operators and Attribute.Update. Numeric classes are
// supplied by source records, never inferred from a JS number's integrality.
// Evidence: cdxattributeoperatorsagent1 / cdxattributecompareagent1 /
// cdxattributeroundagent1. This is arithmetic, not loaded-node admission.
const { ZeroDivisionError, OverflowError } = require("./clientDogmaErrors");
const INT_MIN = -2147483648n, INT_MAX = 2147483647n;
const KINDS = Object.freeze(Object.fromEntries(["int", "long", "float"].map(pythonType => [pythonType,
  Object.freeze({ kind: pythonType === "float" ? "real" : "integer", pythonType, source: "client-dogma-arithmetic" }),
])));
const record = (value, pythonType) => Object.freeze({ value, kind: KINDS[pythonType] });
const HUNDRED = record(100, "int");
// Installed blue.dll.original handler table 0x180b015f0 / DBRow::Get
// 0x1802fc010. Exact REA + independent IAT/dispatch evidence is retained in
// cdxnumericclassagent1. Current CCP source uses Python3 constructors instead.
const INT_OPCODES = new Set([4, 5, 6, 7, 8, 9]);
const LONG_OPCODES = new Set([3, 47]);
const INT_COLUMNS = new Set([2, 3, 16, 17, 18, 19]);
const LONG_COLUMNS = new Set([20, 21, 64]);

function attributePythonType(given) {
  if (!given || typeof given !== "object" || !Object.hasOwn(given, "value")) return undefined;
  if (given.value === null) return "None";
  if (typeof given.value === "boolean") return "bool";
  const kind = given.kind;
  if (kind?.kind === "real") return "float";
  if (kind?.kind !== "integer") return undefined;
  if (["int", "long"].includes(kind.pythonType)) return kind.pythonType;
  if (INT_OPCODES.has(kind.opcode) || INT_COLUMNS.has(kind.dbType)) return "int";
  if (LONG_OPCODES.has(kind.opcode) || LONG_COLUMNS.has(kind.dbType)) return "long";
  return undefined;
}

class ClientDogmaNumericClassNotReadyError extends Error {
  constructor() {
    super("Native attribute arithmetic requires the source Python numeric class.");
    this.name = "ClientDogmaNumericClassNotReadyError";
  }
}

function integerValue(value) {
  if (typeof value === "bigint") return value;
  if (Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError("The declared Python integer has no exact integer representation.");
}

function operand(given) {
  if (!given || typeof given !== "object" || !Object.hasOwn(given, "value")) throw new TypeError("An attribute source record is required.");
  const value = given.value;
  if (value === null) return { type: "None", value };
  if (typeof value === "boolean") return { type: "bool", value: value ? 1n : 0n };
  const type = attributePythonType(given);
  if (type === "float") {
    if (typeof value !== "number") throw new TypeError("A Python float requires a binary64 value.");
    return { type: "float", value };
  }
  if (!["int", "long"].includes(type)) throw new ClientDogmaNumericClassNotReadyError();
  const exact = integerValue(value);
  if (type === "int" && (exact < INT_MIN || exact > INT_MAX)) throw new TypeError("A native Windows Python int must fit signed32.");
  return { type, value: exact };
}

function numeric(given, noneMessage = "None is not a Python numeric operand.") {
  const found = operand(given);
  if (found.type === "None") throw new TypeError(noneMessage);
  return found;
}

function double(found) {
  if (found.type === "float") return found.value;
  const value = Number(found.value);
  if (!Number.isFinite(value)) throw new OverflowError("long int too large to convert to float");
  return value;
}

function integerResult(value, longInput) {
  return longInput || value < INT_MIN || value > INT_MAX ? record(value, "long") : record(Number(value), "int");
}

// Explicit binary64 entry points also serve godma's existing charge evaluator
// AFTER its own operand validation/conversion. They do not classify a raw JS
// number or change that evaluator's source records and readiness policy.
function realOperation(op, x, y) {
  if (typeof x !== "number" || typeof y !== "number") throw new TypeError("Converted binary64 operands are required.");
  if (op === "/" && y === 0) throw new ZeroDivisionError();
  return op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : x / y;
}

function binary(op, left, right) {
  const a = operand(left), b = operand(right);
  if (a.type === "None" || b.type === "None") {
    const label = found => found.type === "None" ? "NoneType" : found.type;
    throw new TypeError(`unsupported operand type(s) for ${op}: '${label(a)}' and '${label(b)}'`);
  }
  if (a.type === "float" || b.type === "float") {
    // Native integer-to-double conversion happens before division's zero
    // check. A huge long /0.0 raises OverflowError first.
    const x = double(a), y = double(b);
    return record(realOperation(op, x, y), "float");
  }
  const x = a.value, y = b.value;
  let value;
  if (op === "/") {
    if (y === 0n) throw new ZeroDivisionError(`${a.type === "long" || b.type === "long" ? "long" : "integer"} division or modulo by zero`);
    value = x / y;
    if (x % y !== 0n && (x < 0n) !== (y < 0n)) value -= 1n;
  } else value = op === "+" ? x + y : op === "-" ? x - y : x * y;
  return integerResult(value, a.type === "long" || b.type === "long");
}

function applyAttributeOperator(operatorID, left, right) {
  // Native numeric dictionary keys alias bool/int/long (and equal floats).
  if (typeof operatorID === "boolean") operatorID = Number(operatorID);
  if (typeof operatorID === "bigint" && operatorID >= BigInt(Number.MIN_SAFE_INTEGER) && operatorID <= BigInt(Number.MAX_SAFE_INTEGER)) operatorID = Number(operatorID);
  switch (operatorID) {
    case -1: case 7: return right;
    case 0: case 4: return binary("*", left, right);
    case 1: case 5: return binary("/", left, right);
    case 2: return binary("+", left, right);
    case 3: return binary("-", left, right);
    // Preserve inner add, multiply and division, including intermediate
    // PyInt overflow and an existing PyLong's subtype even on a small result.
    case 6: case 8: return binary("/", binary("*", left, binary("+", HUNDRED, right)), HUNDRED);
    default: {
      const error = new Error(`Unknown dogma operator ${String(operatorID)}.`);
      error.name = "KeyError"; error.key = operatorID; throw error;
    }
  }
}

function selected(first, second, minimum) {
  const a = operand(first), b = operand(second);
  if (a.type === "None") return b.type === "None" || minimum ? first : second;
  if (b.type === "None") return minimum ? second : first;
  // JS BigInt/Number relational comparisons compare the exact integer and
  // represented double. Numeric NaN stays unordered. Replace only on a strict
  // comparison, preserving the FIRST record for equality, NaN and signed0.
  return (minimum ? a.value > b.value : a.value < b.value) ? second : first;
}

function attributeRecordsEqual(first, second) {
  const a = operand(first), b = operand(second);
  if (a.type === "None" || b.type === "None") return a.type === b.type;
  // Both are resolved BUILTIN numerics here. Mixed BigInt/Number equality is
  // exact; no string/null coercion or record-identity shortcut is permitted.
  // SetBaseValue123 ->123.0 therefore retains the old PyInt source record,
  // whereas NaN stays unequal even when both arguments are the same record.
  return a.value == b.value;
}

function attributeInteger(given) {
  const found = numeric(given, "int() argument must be a string or a number, not 'NoneType'");
  if (found.type === "float") {
    if (Number.isNaN(found.value)) {
      const error = new Error("cannot convert float NaN to integer"); error.name = "ValueError"; throw error;
    }
    if (!Number.isFinite(found.value)) throw new OverflowError("cannot convert float infinity to integer");
    const value = BigInt(Math.trunc(found.value));
    // PyInt_FromDouble's strict INPUT bounds differ from a PyLong input's
    // inclusive result bounds at both signed32 endpoints.
    return integerResult(value, !(found.value > Number(INT_MIN) && found.value < Number(INT_MAX)));
  }
  return integerResult(found.value, false);
}

function roundAttributeToTwoPlaces(given) {
  const value = double(numeric(given, "a float is required"));
  return record(value === 0 || !Number.isFinite(value) || Math.abs(value) >= 1e21 ? value : Number(value.toFixed(2)), "float");
}

module.exports = {
  attributePythonType,
  divideAttributeDoubles: (left, right) => realOperation("/", left, right),
  multiplyAttributeDoubles: (left, right) => realOperation("*", left, right),
  applyAttributeOperator,
  attributeRecordsEqual,
  minimumAttributeRecord: (first, second) => selected(first, second, true),
  maximumAttributeRecord: (first, second) => selected(first, second, false),
  attributeInteger,
  roundAttributeToTwoPlaces,
  ClientDogmaNumericClassNotReadyError,
};
