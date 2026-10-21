"use strict";

const { getDecodedNumberKind } = require("../gameProtocol/marshal");
const { attributePythonType } = require("./clientDogmaArithmetic");

/** Source-port structural prerequisite for the real Godma descriptor owner.
 * The C capability uses installed Python27's own si|O parser/converters and
 * CCP's packed-column layout. It returns actual native tuples and PyInts,
 * not a Blue heap descriptor, DBRow, virtual resolver or ready StateManager.
 * Result: (columns(name,type,size,offset), dataBytes, objectCount, totalBytes,
 * nullStartBit, objectStartPointerIndex). Only tuple schemas are admitted.
 */
async function createClientRowDescriptorLayout({ provider }) {
  if (!provider || typeof provider.ready !== "function") throw new TypeError("An installed Python runtime provider is required.");
  const runtime = await provider.ready(), values = runtime.values;
  const calculate = values.global("_client_prefs_io").getAttr("row_descriptor_layout");
  const builtins = values.global("__builtin__"), list = builtins.getAttr("list"), tuple = builtins.getAttr("tuple");
  function layout(schema) { return calculate.call(schema); }
  function inventorySchema(wire) {
    if (wire?.type !== "objectex1" || wire.header?.[0]?.value !== "blue.DBRowDescriptor" ||
        !Array.isArray(wire.header[1]) || wire.header[1].length !== 1 || !Array.isArray(wire.header[1][0])) {
      throw new TypeError("An actual decoded inventory DBRowDescriptor is required.");
    }
    const columns = list.call();
    for (const column of wire.header[1][0]) {
      if (!Array.isArray(column) || column.length < 2 || column.length > 3 ||
          !(Buffer.isBuffer(column[0]) || typeof column[0] === "string" && /^[\x00-\x7f]*$/.test(column[0]))) {
        throw new TypeError("The inventory schema requires preserved ASCII byte names and tuple columns.");
      }
      // Preserve the REAL wire numeric class. An integral-looking float is
      // never promoted to PyInt; the installed C parser decides admission.
      const kind = getDecodedNumberKind(column, 1), raw = column[1];
      let type;
      if (kind?.kind === "integer") {
        const pythonType = attributePythonType({ value: raw, kind });
        if (pythonType === "long") type = values.long(BigInt(raw));
        else if (pythonType === "int") type = values.int(raw);
        else throw new TypeError("Inventory DBTYPE integer class is unknown.");
      }
      else if (kind?.kind === "real") type = values.float(raw);
      else if (kind?.kind === "boolean") type = values.bool(raw);
      else throw new TypeError("Inventory DBTYPE numeric provenance is missing.");
      const entry = list.call();
      entry.getAttr("append").call(Buffer.isBuffer(column[0]) ? column[0] : Buffer.from(column[0], "ascii"));
      entry.getAttr("append").call(type);
      // Init's optional third object is ignored. No resolver is inferred from
      // it; the original raw column and virtual state remain in wire below.
      if (column.length === 3) entry.getAttr("append").call(null);
      columns.getAttr("append").call(tuple.call(entry));
    }
    return Object.freeze({ wire, schema: tuple.call(columns), virtualState: wire.header[2] });
  }
  function inventoryHeader(wire) {
    const prepared = inventorySchema(wire);
    return Object.freeze({ ...prepared, layout: layout(prepared.schema) });
  }
  return Object.freeze({ layout, inventorySchema, inventoryHeader, identity: runtime.identity });
}

module.exports = { createClientRowDescriptorLayout };
