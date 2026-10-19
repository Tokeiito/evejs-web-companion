"use strict";

// The member dict in xmppchatwindow.py:104/459/485-571, including deletions.
// CPython 2.7 lookdict/insertdict/dictresize; hashes use our retail-python model.
const { hashKey } = require("./py27");
const DELETED = Symbol("deleted");
class PythonIntKeys {
  constructor() { this.table = new Array(8); this.used = 0; this.fill = 0; }
  slot(key) {
    const hash = hashKey(key), mask = BigInt(this.table.length - 1);
    let perturb = BigInt.asUintN(64, BigInt(hash)), index = perturb & mask, free = -1;
    for (;;) {
      const entry = this.table[Number(index)];
      if (entry === undefined) return free < 0 ? Number(index) : free;
      if (entry === DELETED) { if (free < 0) free = Number(index); }
      else if (entry === key) return Number(index);
      index = BigInt.asUintN(64, index * 5n + perturb + 1n) & mask;
      perturb >>= 5n;
    }
  }
  set(key) {
    const index = this.slot(key), prior = this.table[index];
    if (prior !== undefined && prior !== DELETED) return;
    if (prior === undefined) this.fill++;
    this.table[index] = key; this.used++;
    if (this.fill * 3 >= this.table.length * 2) {
      const keys = this.keys(); let size = 8;
      while (size <= this.used * (this.used > 50000 ? 2 : 4)) size *= 2;
      this.table = new Array(size); this.fill = this.used;
      for (const held of keys) this.table[this.slot(held)] = held;
    }
  }
  delete(key) {
    const index = this.slot(key);
    if (this.table[index] === key) { this.table[index] = DELETED; this.used--; }
  }
  keys() { return this.table.filter(entry => entry !== undefined && entry !== DELETED); }
}
module.exports = { PythonIntKeys };
