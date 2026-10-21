"use strict";

const { ClientDogmaAttribute } = require("./clientDogmaAttribute");
const {
  applyAttributeOperator: operation,
  attributeRecordLessThan: less,
} = require("./clientDogmaArithmetic");

const PRECEDENCE = Object.freeze([-1, 0, 1, 2, 3, 4, 5, 6, 8, 7]);
const PENALIZED_OPERATIONS = new Set([0, 4, 6, 1, 5]);
const EXEMPT_CATEGORIES = new Set([16, 20, 6, 8, 32]);
const REAL = Object.freeze({ kind: "real", pythonType: "float", source: "client-loaded-stacking-literal" });
const INT = Object.freeze({ kind: "integer", pythonType: "int", source: "client-loaded-stacking-literal" });
const literal = (value, kind) => Object.freeze({ value, kind });
const INTEGER_ZERO = literal(0, INT), INTEGER_ONE = literal(1, INT), REAL_ONE = literal(1, REAL);

// Original installed module's eight PyFloat values, not a V8 exp recomputation.
// Both sides of the split start at denominator0 independently.
const DENOMINATORS = Object.freeze([
  1.0, 1.1505891270375252, 1.7525929592791982, 3.534128945104115,
  9.434616479798228, 33.34315118721123, 156.0017836720985, 966.2578108622836,
].map(value => literal(value, REAL)));

const namedError = (name, message) => Object.assign(new Error(message), { name });
function field(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) {
    throw namedError("AttributeError", `Object has no ${name} attribute.`);
  }
  return object[name];
}
function call(object, name, ...args) { return field(object, name).apply(object, args); }

function numericKey(value) {
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "bigint" && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return value;
}
function operatorIndex(value) {
  const index = PRECEDENCE.indexOf(numericKey(value));
  if (index < 0) throw Object.assign(namedError("KeyError", String(value)), { key: value });
  return index;
}

function flagTruth(value) {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0; // Python NaN is truthy.
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "string") return value.length !== 0;
  // The installed BrainLiteralAttribute producer supplies literal True.
  // Custom Python __nonzero__/__len__ is not inferred from a JS object.
  throw new TypeError("A native primitive forceUnnurfed flag is required.");
}

function bisectRight(factors) {
  let low = 0, high = factors.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (less(REAL_ONE, factors[middle])) high = middle;
    else low = middle + 1;
  }
  return low;
}

function stackingOperator(factor, denominator) {
  // Preserve (factor - REAL1) * (REAL1 / denominator) + REAL1 order.
  return operation(2, operation(0, operation(3, factor, REAL_ONE), operation(1, REAL_ONE, denominator)), REAL_ONE);
}

function* transformedFactors(factors, split) {
  for (let index = 0; index < Math.min(split, DENOMINATORS.length); index += 1) {
    yield stackingOperator(factors[index], DENOMINATORS[index]);
  }
  for (let index = 0; index < Math.min(factors.length - split, DENOMINATORS.length); index += 1) {
    yield stackingOperator(factors[factors.length - 1 - index], DENOMINATORS[index]);
  }
}

// Original StackingNurfedAttribute23-110, compiled branch/arithmetic proof in
// cdxloadedstackingagent1. This is a primitive/factory class, not admission or
// passive-effect success. The world owns identity sets and MUST provide native
// SortAttributeFactors(records)->array; no JS sort or traversal fallback exists.
class ClientDogmaStackingAttribute extends ClientDogmaAttribute {
  _InitializeStateBeforeAttribute() {
    this.unNurfedMods = null;
    this.nurfedMods = null;
    this.nurfedModsFactor = INTEGER_ZERO;
  }

  _initIncomingUnNurfedModifiers() { this.unNurfedMods = this._makeEmptyIncomingModifiers(); }
  _initIncomingNurfedModifiers() { this.nurfedMods = this._makeEmptyIncomingModifiers(); }

  _ShouldNotNurf(op, attribute) {
    if (!PENALIZED_OPERATIONS.has(numericKey(op))) return true;
    try {
      // The original reads item twice, preserving getter failures/order.
      if (field(attribute, "item") !== null) {
        const category = field(field(field(attribute, "item"), "invItem"), "categoryID");
        if (EXEMPT_CATEGORIES.has(numericKey(category))) return true;
      }
    } catch (error) {
      if (error.name !== "ReferenceError") throw error;
      call(this.dogmaLM, "LogWarn", "_ShouldNotNurf: 'Orphan' Attribute detected (its dogmaItem has gone!):", attribute);
      call(this.dogmaLM, "LogWarn", "TraceReferrers is BEING SUPPRESSED in case it overloads the node! (Sorry)");
      call(this.dogmaLM, "LogTraceback", "Orphan Attribute! (via _ShouldNotNurf)");
    }
    // Python2 hasattr swallows the FIRST lookup's exception. A successful
    // lookup is followed by a SECOND getter, whose exception propagates.
    let present = false;
    try { field(attribute, "forceUnnurfed"); present = true; } catch {}
    return present && flagTruth(field(attribute, "forceUnnurfed"));
  }

  AddIncomingModifier(op, attribute) {
    // The decompiler's apparent unconditional penalized add is incorrect.
    if (this._ShouldNotNurf(op, attribute)) {
      if (this.unNurfedMods === null) this._initIncomingUnNurfedModifiers();
      this.unNurfedMods[operatorIndex(op)].add(attribute);
    } else {
      if (this.nurfedMods === null) this._initIncomingNurfedModifiers();
      this.nurfedMods[operatorIndex(op)].add(attribute);
    }
    super.AddIncomingModifier(op, attribute);
  }

  RemoveIncomingModifier(op, attribute) {
    // Reclassify NOW. A category/force change can leave a stale parallel
    // bucket; native does not search or repair the other classification.
    try {
      if (this._ShouldNotNurf(op, attribute)) {
        this.unNurfedMods[operatorIndex(op)].remove(attribute);
        if (!this.unNurfedMods.some(set => set.size)) this.unNurfedMods = null;
      } else {
        this.nurfedMods[operatorIndex(op)].remove(attribute);
        if (!this.nurfedMods.some(set => set.size)) this.nurfedMods = null;
      }
    } catch {} // Original bare except, followed by the superclass removal.
    super.RemoveIncomingModifier(op, attribute);
  }

  _ApplyModifierOperationsToVal(value) {
    const exempt = this.unNurfedMods ?? this._makeEmptyIncomingModifiers();
    const penalized = this.nurfedMods ?? this._makeEmptyIncomingModifiers();
    for (let index = 0; index < PRECEDENCE.length; index += 1) {
      const direct = exempt[index], group = penalized[index], op = PRECEDENCE[index];
      for (const attribute of direct) value = operation(op, value, call(attribute, "GetValue"));
      if (!group.size) continue;
      const factors = [];
      for (const attribute of group) factors.push(operation(op, INTEGER_ONE, call(attribute, "GetValue")));
      const sorted = call(this.dogmaLM, "SortAttributeFactors", factors);
      const split = bisectRight(sorted);
      let combined, started = false;
      // reduce(operator.mul, iterator), with NO initializer.
      for (const factor of transformedFactors(sorted, split)) {
        combined = started ? operation(0, combined, factor) : factor;
        started = true;
      }
      if (!started) throw new TypeError("reduce() of empty sequence with no initial value");
      this.nurfedModsFactor = combined;
      value = operation(0, value, this.nurfedModsFactor);
    }
    // Empty groups leave the last factor unchanged, including initial INT0.
    return value;
  }

  GetNurfedModsFactor() { this.Update(); return this.nurfedModsFactor; }
}

module.exports = { ClientDogmaStackingAttribute };
