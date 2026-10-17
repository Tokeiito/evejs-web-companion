"use strict";

// The BFF's schema of the client's public gateway messages (src/gamePort/eveProtoSchema.json), made from the
// FileDescriptorSet scripts/eve-proto-descriptors.py reads out of the decompiled client's generated eveProto modules.
//
//   python scripts/eve-proto-descriptors.py <decompiled client tree> <set .bin> <module> [<module> ...]
//   node scripts/eve-proto-schema.js <set .bin> [<out .json>]
//
// The schema is protoCodec.js's input: messages and enums by full name, each field's name, number, type, label, type
// name and oneof.

const fs = require("fs");
const path = require("path");
const { schemaJsonFromDescriptorSet } = require("../src/gamePort/protoCodec");

function sortedObject(object) {
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
}

function main() {
  const [setPath, outPath = path.join(__dirname, "..", "src", "gamePort", "eveProtoSchema.json")] = process.argv.slice(2);
  if (!setPath) {
    console.error("node scripts/eve-proto-schema.js <set .bin> [<out .json>]");
    process.exit(2);
  }
  const schema = schemaJsonFromDescriptorSet(fs.readFileSync(setPath));
  const out = { messages: sortedObject(schema.messages), enums: sortedObject(schema.enums) };
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${Object.keys(out.messages).length} messages, ${Object.keys(out.enums).length} enums -> ${outPath}`);
}

main();
