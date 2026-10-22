"use strict";

const { ADDRESS, nodeAddress } = require("./packets");
const { long } = require("./clientMarshal");

/** Serialize the actual original MachoAddress object at the real send. */
function projectNativeNodeAddress(destination) {
  const state = destination.getAttr("__getstate__").call();
  if (state.getItem(0n).scalar !== ADDRESS.NODE || state.getItem(1n).kind !== "long") throw new TypeError("Only native remote node addresses are prepared for dispatch.");
  const service = state.getItem(2n), callID = state.getItem(3n);
  let serviceWire, callWire;
  if (service.kind === "NoneType") serviceWire = null;
  else if (service.kind === "str") serviceWire = service.scalar;
  else if (service.kind === "unicode") serviceWire = { type: "wstring", value: service.scalar };
  else throw new TypeError("The native node service has no prepared wire projection.");
  if (callID.kind === "NoneType") callWire = null;
  else if (callID.kind === "long") callWire = long(callID.scalar);
  else if (callID.kind === "int") callWire = callID.scalar;
  else throw new TypeError("The native node call ID has no prepared wire projection.");
  return nodeAddress(long(state.getItem(1n).scalar), serviceWire, callWire);
}

module.exports = { projectNativeNodeAddress };
