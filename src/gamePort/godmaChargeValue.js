"use strict";

const { ZeroDivisionError, OverflowError } = require("./clientDogmaErrors");

// StateManager.GetChargeValue2037-2050, original Python27 evidence:
// cdxchargearithmeticagent1 (24 identities). Numeric cache only, not the legacy
// projection, loaded dogma nodes or GetAttribute's diagnostic wrapper.
const REAL_KIND = Object.freeze({ kind: "real", source: "godma-charge-arithmetic" });
const INTEGER_KIND = Object.freeze({ kind: "integer", source: "godma-charge-arithmetic" });
const ZERO_KIND = Object.freeze({ kind: "integer", source: "godma-charge-zero-capacity" });
const record = (value, kind) => Object.freeze({ value, kind });

class NumericProvenanceError extends Error {
  constructor() {
    super("Python numeric division requires the operands' source classes.");
    this.name = "NumericProvenanceError";
  }
}

function numeric(given) {
  const value = given?.value;
  if (typeof value === "boolean" || typeof value === "bigint") {
    return { value, kind: "integer" };
  }
  if (typeof value !== "number") throw new TypeError("A Python numeric operand is required.");
  const kind = given.kind?.kind;
  return { value, kind: kind === "real" ? "real" : kind === "integer" || kind === "boolean" ? "integer" : undefined };
}

function doubleValue(value) {
  const converted = Number(value);
  if (typeof value === "bigint" && !Number.isFinite(converted)) {
    throw new OverflowError("long int too large to convert to float");
  }
  return converted;
}

function integerValue(value) {
  try {
    return BigInt(value);
  } catch {
    // This validates an explicitly integer operand; it does not infer class
    // from a JS number's integral appearance.
    throw new TypeError("The Python integer operand has no integer representation.");
  }
}

function realDivision(left, right) {
  const a = doubleValue(left), b = doubleValue(right);
  if (b === 0) throw new ZeroDivisionError();
  return record(a / b, REAL_KIND);
}

function divideRecords(left, right) {
  const a = numeric(left), b = numeric(right);
  if (a.kind === "real" || b.kind === "real") return realDivision(a.value, b.value);
  if (a.kind !== "integer" || b.kind !== "integer") throw new NumericProvenanceError();
  const numerator = integerValue(a.value), denominator = integerValue(b.value);
  if (denominator === 0n) throw new ZeroDivisionError("integer division or modulo by zero");
  let quotient = numerator / denominator;
  if (numerator % denominator !== 0n && (numerator < 0n) !== (denominator < 0n)) quotient -= 1n;
  return record(quotient, INTEGER_KIND);
}

/** Native capacity ratio: float(newValue) / oldValue. The explicit float
 * conversion establishes real division even when a numeric source is unknown.
 * None/nonnumeric inputs fail; this is not Python's string-to-float parser. */
function floatDivideRecords(left, right) {
  const a = numeric(left);
  const converted = doubleValue(a.value);
  const b = numeric(right);
  return realDivision(converted, b.value);
}

/** Scaling after a real capacity ratio. At least one operand must already be
 * known real; do not silently turn unresolved integer arithmetic into real. */
function scaleRealRecords(left, right) {
  const a = numeric(left), b = numeric(right);
  if (a.kind !== "real" && b.kind !== "real") throw new NumericProvenanceError();
  return record(doubleValue(a.value) * doubleValue(b.value), REAL_KIND);
}

function tick(value) {
  if (!["number", "bigint", "boolean"].includes(typeof value)) {
    throw new TypeError("An integer simulation timestamp is required.");
  }
  return integerValue(value);
}

function exponential(value) {
  const result = Math.exp(value);
  if (Number.isFinite(value) && result === Infinity) throw new OverflowError("math range error");
  return result;
}

function square(value) {
  const result = value ** 2;
  if (Number.isFinite(value) && result === Infinity) throw new OverflowError("Result too large");
  return result;
}

/** Original numeric GetChargeValue. Operands are {value,kind} source records.
 * Times are integer simulation ticks from pilotDogma.clock; subtraction stays
 * exact before conversion. The caller supplies newTime or a simulation-clock
 * function, invoked only after the capacity-zero branch. No wallclock/default
 * clock or fractional-time emulation is supplied here.
 *
 * Operation order/errors and derived classes follow the original. Cross-runtime
 * transcendental bit identity, arbitrary huge integers and outer diagnostic
 * dispatch are not established by this bounded evaluator.
 */
function evaluateGodmaCharge(amount, oldTime, tau, capacity, newTime) {
  const cap = capacity?.value;
  if (cap === 0 || cap === 0n || cap === false) return record(0, ZERO_KIND);
  const at = typeof newTime === "function" ? newTime() : newTime;
  const ratio = divideRecords(amount, capacity);
  // Python max/min retain the first operand on equality, including signed0.
  const sq = Math.sqrt(doubleValue(ratio.value < 0 ? 0 : ratio.value));
  const difference = tick(oldTime) - tick(at);
  const elapsed = difference > 0n ? 0n : difference;
  const timePassed = record(doubleValue(elapsed) / 10000.0, REAL_KIND);
  const exponent = divideRecords(timePassed, tau);
  const exp = exponential(exponent.value);
  const result = square(1.0 + (sq - 1.0) * exp) * doubleValue(numeric(capacity).value);
  // Ordinary multiplication may produce inf/nan without Python exp/pow errors.
  return record(result, REAL_KIND);
}

module.exports = { evaluateGodmaCharge, floatDivideRecords, scaleRealRecords, ZeroDivisionError };
