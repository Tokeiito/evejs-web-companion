"use strict";

const { getDecodedNumberKind } = require("../gameProtocol/marshal");
const { text, unwrapSubstream } = require("./packets");

// ObjectCallGPCS.ParseObjectID286-302: the last cell is the server's refID,
// not an incidental timestamp. Two cells mean no public-attribute argument;
// three retain the actual decoded public-attribute object. Keep each receipt
// occurrence distinct, even when the server returns the same N= identity.
const references = new WeakMap();

function remoteObjectReference(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object" || Buffer.isBuffer(value)) return null;
  if (value.type === "substruct") {
    const previous = references.get(value);
    if (previous) return previous;
    const pair = unwrapSubstream(value.value);
    if (Array.isArray(pair) && (pair.length === 2 || pair.length === 3)) {
      const objectID = text(pair[0]);
      if (objectID?.startsWith("N=")) {
        const index = pair.length - 1;
        const reference = Object.freeze({
          objectID, source: value, pair,
          refID: Object.freeze({ value: pair[index], kind: getDecodedNumberKind(pair, index) }),
          hasPublicAttributes: pair.length === 3,
          publicAttributes: pair.length === 3 ? pair[1] : undefined,
        });
        references.set(value, reference);
        return reference;
      }
    }
  }
  const children = Array.isArray(value) ? value : [value.value, value.items, value.args];
  for (const inner of children) {
    const found = remoteObjectReference(inner, depth + 1);
    if (found) return found;
  }
  return null;
}

module.exports = { remoteObjectReference };
