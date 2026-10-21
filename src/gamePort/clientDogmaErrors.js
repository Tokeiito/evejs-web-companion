"use strict";

class ZeroDivisionError extends Error {
  constructor(message = "float division by zero") {
    super(message);
    this.name = "ZeroDivisionError";
  }
}

class OverflowError extends Error {
  constructor(message) {
    super(message);
    this.name = "OverflowError";
  }
}

module.exports = { ZeroDivisionError, OverflowError };
