"use strict";

const { ClientDogmaAttribute } = require("./clientDogmaAttribute");
const {
  applyAttributeOperator: operation, attributeRecordsEqual: equal,
  attributeRecordLessThan: less, minimumAttributeRecord: minimum,
  attributeSquareRoot: sqrt, attributeExponential: exp, attributeSquare: square,
} = require("./clientDogmaArithmetic");
const REAL = Object.freeze({ kind: "real", pythonType: "float", source: "client-loaded-charge-literal" });
const INT = Object.freeze({ kind: "integer", pythonType: "int", source: "client-loaded-charge-literal" });
const literal = (value, kind) => Object.freeze({ value, kind });
const ZERO = literal(0, INT), ONE = literal(1, REAL), FIVE = literal(5, REAL), TICKS_PER_MS = literal(10000, REAL), BACKWARD_LIMIT = literal(-0.0001, REAL);
const add = (a, b) => operation(2, a, b), subtract = (a, b) => operation(3, a, b);
const multiply = (a, b) => operation(0, a, b), divide = (a, b) => operation(1, a, b);

function target(reference) {
  const value = reference.deref();
  if (value === null || value === undefined) throw new ReferenceError("weakly-referenced object no longer exists");
  return value;
}

// ORIGINAL loaded ChargedAttribute15-107, not StateManager.GetChargeValue.
// cdxloadedchargeagent1 executes the compiled class with actual static values
// and recorded instance amounts. The plain world/provider contract still
// applies. GetSimTimeRecord must return actual integer simulation ticks with
// their established class; no Date.now fallback is supplied here.
class ClientDogmaChargedAttribute extends ClientDogmaAttribute {
  constructor(input) {
    super(input);
    this.rechargeRateAttribute = this.dogmaLM.collections.weak(this.item.attributes.get(input.definition.chargeRechargeTimeID));
    const cap = target(this.capAttrib).GetValue();
    this.currentValue = minimum(cap, this.currentValue);
    this.prevCap = cap;
    this.lastCalcTime = this.dogmaLM.GetSimTimeRecord();
    this.rechargeRate = divide(target(this.rechargeRateAttribute).GetValue(), FIVE);
    target(this.rechargeRateAttribute).AddNonModifyingDependant(this);
  }

  Update() {
    const cap = target(this.capAttrib).GetValue();
    this.rechargeRate = divide(target(this.rechargeRateAttribute).GetValue(), FIVE);
    const rate = this.rechargeRate;
    if (equal(cap, ZERO)) { this.currentValue = ZERO; this.prevCap = ZERO; return; }
    if (!equal(cap, this.prevCap)) {
      if (less(ZERO, this.prevCap)) this.currentValue = multiply(divide(this.currentValue, this.prevCap), cap);
      this.prevCap = cap;
    }
    if (less(cap, this.currentValue) || equal(cap, this.currentValue)) { this.currentValue = cap; return; }
    if (equal(rate, ZERO)) { this.lastCalcTime = this.dogmaLM.GetSimTimeRecord(); return; }
    const currentTime = this.dogmaLM.GetSimTimeRecord();
    const elapsed = divide(subtract(currentTime, this.lastCalcTime), TICKS_PER_MS);
    if (less(elapsed, BACKWARD_LIMIT)) return;
    const root = sqrt(divide(this.currentValue, cap));
    const blend = exp(divide(multiply(literal(-1, INT), elapsed), rate));
    const rootBlended = add(multiply(subtract(root, ONE), blend), ONE);
    const ratio = square(rootBlended);
    this.currentValue = multiply(ratio, cap);
    this.lastCalcTime = currentTime;
    // Native does not clear dirty, run plain Update, or call value callbacks.
  }

  GetValue() {
    if (this.dirty || !equal(this.lastCalcTime, this.dogmaLM.GetSimTimeRecord())) this.Update();
    return this.currentValue;
  }

  GetFullChargedInfo() {
    if (this.dirty || !equal(this.lastCalcTime, this.dogmaLM.GetSimTimeRecord())) this.Update();
    return [this.currentValue, this.prevCap, this.rechargeRate];
  }

  MarkDirty(silent = false) { super.MarkDirty(silent); if (!silent) this.Update(); }
  SetBaseValue(value) {
    if (!equal(this.currentValue, value)) {
      this.currentValue = value;
      this.lastCalcTime = this.dogmaLM.GetSimTimeRecord();
      this.MarkDirty();
    }
  }
  AddIncomingModifier() { this.dogmaLM.LogTraceback("Cannot modify a charged attribute!"); }
  RemoveIncomingModifier() { this.dogmaLM.LogTraceback("Cannot modify a charged attribute!"); }
  ResetBaseValue() { this.Update(); this.currentValue = this.typeValue; }
  IncreaseBaseValue(amount) { this.Update(); this.currentValue = add(this.currentValue, amount); }
  DecreaseBaseValue(amount) { this.Update(); this.currentValue = subtract(this.currentValue, amount); }
  GetPersistData() { this.Update(); return this.currentValue; }
}

module.exports = { ClientDogmaChargedAttribute };
