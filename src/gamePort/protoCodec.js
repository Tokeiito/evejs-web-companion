"use strict";

// A protobuf (proto3) codec for the messages the BFF sends to and reads from the public gateway, as the retail client
// does (publicGateway/grpc/requestBroker.py), driven by the client's own descriptors (scripts/eve-proto-descriptors.py
// reads them from its generated eveProto modules; scripts/eve-proto-schema.js keeps them as eveProtoSchema.json).
//
// A message is encoded from, and decoded to, a plain object by its fields' proto names:
//   int64, uint64, sint64, fixed64, sfixed64   a decimal string (they pass 2^53)
//   bytes                                      a base64 string
//   an enum                                    its value's name (its number where the schema has no name for it)
//   a map                                      an object by key
//   a repeated field                           an array
//   a message                                  an object
// What the encoder is given that is the field's default (nought, "", false, an empty list) is left out, as proto3
// leaves it out; a field of a oneof, or a message field, is written whenever given. The decoder fills nothing in: a
// field absent from the wire is absent from the object.

const TYPE = Object.freeze({
  DOUBLE: 1, FLOAT: 2, INT64: 3, UINT64: 4, INT32: 5, FIXED64: 6, FIXED32: 7, BOOL: 8, STRING: 9, GROUP: 10,
  MESSAGE: 11, BYTES: 12, UINT32: 13, ENUM: 14, SFIXED32: 15, SFIXED64: 16, SINT32: 17, SINT64: 18,
});
const LABEL_REPEATED = 3;
const WIRE = Object.freeze({ VARINT: 0, FIXED64: 1, LENGTH: 2, FIXED32: 5 });

function wireTypeOf(type) {
  switch (type) {
    case TYPE.DOUBLE: case TYPE.FIXED64: case TYPE.SFIXED64: return WIRE.FIXED64;
    case TYPE.FLOAT: case TYPE.FIXED32: case TYPE.SFIXED32: return WIRE.FIXED32;
    case TYPE.STRING: case TYPE.BYTES: case TYPE.MESSAGE: return WIRE.LENGTH;
    default: return WIRE.VARINT;
  }
}

const isScalarPackable = (type) => wireTypeOf(type) !== WIRE.LENGTH && type !== TYPE.GROUP;

// --- the wire -------------------------------------------------------------------------------------------------------

class Writer {
  constructor() {
    this.parts = [];
  }

  varint(value) {
    let number = BigInt.asUintN(64, BigInt(value));
    const bytes = [];
    do {
      let byte = Number(number & 0x7fn);
      number >>= 7n;
      if (number > 0n) byte |= 0x80;
      bytes.push(byte);
    } while (number > 0n);
    this.parts.push(Buffer.from(bytes));
  }

  tag(number, wireType) {
    this.varint((BigInt(number) << 3n) | BigInt(wireType));
  }

  fixed32(value, signedFloat) {
    const buffer = Buffer.alloc(4);
    if (signedFloat === "float") buffer.writeFloatLE(Number(value));
    else buffer.writeUInt32LE(Number(BigInt.asUintN(32, BigInt(value))));
    this.parts.push(buffer);
  }

  fixed64(value, kind) {
    const buffer = Buffer.alloc(8);
    if (kind === "double") buffer.writeDoubleLE(Number(value));
    else buffer.writeBigUInt64LE(BigInt.asUintN(64, BigInt(value)));
    this.parts.push(buffer);
  }

  bytes(buffer) {
    this.varint(buffer.length);
    this.parts.push(buffer);
  }

  finish() {
    return Buffer.concat(this.parts);
  }
}

class Reader {
  constructor(buffer) {
    this.buffer = buffer;
    this.pos = 0;
  }

  get done() {
    return this.pos >= this.buffer.length;
  }

  varint() {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (this.pos >= this.buffer.length) throw new Error("A varint runs past the message.");
      const byte = this.buffer[this.pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
  }

  take(length) {
    if (this.pos + length > this.buffer.length) throw new Error("A field runs past the message.");
    const slice = this.buffer.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  skip(wireType) {
    if (wireType === WIRE.VARINT) this.varint();
    else if (wireType === WIRE.FIXED64) this.take(8);
    else if (wireType === WIRE.LENGTH) this.take(Number(this.varint()));
    else if (wireType === WIRE.FIXED32) this.take(4);
    else throw new Error(`A wire type the codec does not read: ${wireType}.`);
  }
}

// --- the schema -----------------------------------------------------------------------------------------------------

/**
 * A schema of messages and enums by full name (no leading dot), each message's fields by name and by number:
 * {messages: {name: {fields: [{name, number, type, label, typeName, oneof}], mapEntry}}, enums: {name: {values: {name:
 * number}}}}.
 */
function createSchema(json) {
  const messages = new Map();
  for (const [name, message] of Object.entries(json.messages || {})) {
    const byNumber = new Map();
    const byName = new Map();
    for (const field of message.fields || []) {
      byNumber.set(field.number, field);
      byName.set(field.name, field);
    }
    messages.set(name, { name, byNumber, byName, mapEntry: Boolean(message.mapEntry), fields: message.fields || [] });
  }
  const enums = new Map();
  for (const [name, enumeration] of Object.entries(json.enums || {})) {
    const byName = new Map(Object.entries(enumeration.values || {}));
    const byNumber = new Map();
    for (const [valueName, number] of byName) if (!byNumber.has(number)) byNumber.set(number, valueName);
    enums.set(name, { byName, byNumber });
  }
  const messageOf = (name) => {
    const message = messages.get(String(name).replace(/^\./, ""));
    if (!message) throw new Error(`The schema has no message ${name}.`);
    return message;
  };
  const enumOf = (name) => enums.get(String(name).replace(/^\./, "")) || null;

  function encodeScalar(writer, field, value) {
    switch (field.type) {
      case TYPE.DOUBLE: writer.fixed64(value, "double"); break;
      case TYPE.FLOAT: writer.fixed32(value, "float"); break;
      case TYPE.FIXED64: case TYPE.SFIXED64: writer.fixed64(BigInt(value)); break;
      case TYPE.FIXED32: case TYPE.SFIXED32: writer.fixed32(BigInt(value)); break;
      case TYPE.BOOL: writer.varint(value ? 1 : 0); break;
      case TYPE.SINT32: case TYPE.SINT64: {
        const number = BigInt(value);
        writer.varint(number >= 0n ? number * 2n : -number * 2n - 1n);
        break;
      }
      case TYPE.ENUM: {
        const enumeration = enumOf(field.typeName);
        const number = typeof value === "number" ? value : enumeration && enumeration.byName.has(String(value)) ? enumeration.byName.get(String(value)) : NaN;
        if (!Number.isInteger(number)) throw new Error(`${field.name} has no value ${value}.`);
        writer.varint(number);
        break;
      }
      case TYPE.INT32: writer.varint(BigInt.asUintN(64, BigInt(value))); break;
      default: writer.varint(BigInt(value)); break;
    }
  }

  function isDefault(field, value) {
    if (value === undefined || value === null) return true;
    if (field.oneof !== undefined && field.oneof !== null) return false;
    if (field.type === TYPE.MESSAGE) return false;
    if (field.type === TYPE.STRING || field.type === TYPE.BYTES) return String(value) === "";
    if (field.type === TYPE.BOOL) return value === false;
    if (field.type === TYPE.ENUM) {
      const enumeration = enumOf(field.typeName);
      return value === 0 || (enumeration !== null && enumeration.byName.get(String(value)) === 0);
    }
    return Number(value) === 0 && String(value) !== "";
  }

  function encodeInto(writer, message, object) {
    for (const field of message.fields) {
      const value = object[field.name];
      if (value === undefined || value === null) continue;
      if (field.label === LABEL_REPEATED) {
        const nested = field.type === TYPE.MESSAGE ? messageOf(field.typeName) : null;
        if (nested && nested.mapEntry) {
          const keyField = nested.byNumber.get(1);
          const valueField = nested.byNumber.get(2);
          for (const [key, entry] of Object.entries(value)) {
            const entryWriter = new Writer();
            encodeInto(entryWriter, nested, { [keyField.name]: keyField.type === TYPE.BOOL ? key === "true" : key, [valueField.name]: entry });
            writer.tag(field.number, WIRE.LENGTH);
            writer.bytes(entryWriter.finish());
          }
          continue;
        }
        const items = Array.isArray(value) ? value : [value];
        if (items.length === 0) continue;
        if (isScalarPackable(field.type)) {
          const packed = new Writer();
          for (const item of items) encodeScalar(packed, field, item);
          writer.tag(field.number, WIRE.LENGTH);
          writer.bytes(packed.finish());
        } else {
          for (const item of items) encodeOne(writer, field, item);
        }
        continue;
      }
      if (isDefault(field, value)) continue;
      encodeOne(writer, field, value);
    }
  }

  function encodeOne(writer, field, value) {
    if (field.type === TYPE.MESSAGE) {
      writer.tag(field.number, WIRE.LENGTH);
      writer.bytes(encode(field.typeName, value));
    } else if (field.type === TYPE.STRING) {
      writer.tag(field.number, WIRE.LENGTH);
      writer.bytes(Buffer.from(String(value), "utf8"));
    } else if (field.type === TYPE.BYTES) {
      writer.tag(field.number, WIRE.LENGTH);
      writer.bytes(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "base64"));
    } else {
      writer.tag(field.number, wireTypeOf(field.type));
      encodeScalar(writer, field, value);
    }
  }

  /** A message of that name made of the object. */
  function encode(typeName, object) {
    const writer = new Writer();
    encodeInto(writer, messageOf(typeName), object || {});
    return writer.finish();
  }

  function decodeScalar(reader, field) {
    switch (field.type) {
      case TYPE.DOUBLE: return reader.take(8).readDoubleLE(0);
      case TYPE.FLOAT: return reader.take(4).readFloatLE(0);
      case TYPE.FIXED64: return reader.take(8).readBigUInt64LE(0).toString();
      case TYPE.SFIXED64: return reader.take(8).readBigInt64LE(0).toString();
      case TYPE.FIXED32: return reader.take(4).readUInt32LE(0);
      case TYPE.SFIXED32: return reader.take(4).readInt32LE(0);
      case TYPE.BOOL: return reader.varint() !== 0n;
      case TYPE.INT32: return Number(BigInt.asIntN(32, reader.varint()));
      case TYPE.UINT32: return Number(BigInt.asUintN(32, reader.varint()));
      case TYPE.INT64: return BigInt.asIntN(64, reader.varint()).toString();
      case TYPE.UINT64: return BigInt.asUintN(64, reader.varint()).toString();
      case TYPE.SINT32: case TYPE.SINT64: {
        const number = reader.varint();
        return ((number & 1n) === 0n ? number >> 1n : -(number >> 1n) - 1n).toString();
      }
      case TYPE.ENUM: {
        const number = Number(BigInt.asIntN(32, reader.varint()));
        const enumeration = enumOf(field.typeName);
        return enumeration && enumeration.byNumber.has(number) ? enumeration.byNumber.get(number) : number;
      }
      default: return Number(reader.varint());
    }
  }

  function decodeValue(reader, field) {
    if (field.type === TYPE.MESSAGE) return decode(field.typeName, reader.take(Number(reader.varint())));
    if (field.type === TYPE.STRING) return reader.take(Number(reader.varint())).toString("utf8");
    if (field.type === TYPE.BYTES) return Buffer.from(reader.take(Number(reader.varint()))).toString("base64");
    return decodeScalar(reader, field);
  }

  /** The object a message of that name holds. */
  function decode(typeName, buffer) {
    const message = messageOf(typeName);
    const reader = new Reader(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
    const out = {};
    while (!reader.done) {
      const key = reader.varint();
      const number = Number(key >> 3n);
      const wireType = Number(key & 7n);
      const field = message.byNumber.get(number);
      if (!field) {
        reader.skip(wireType);
        continue;
      }
      if (field.label === LABEL_REPEATED) {
        const nested = field.type === TYPE.MESSAGE ? messageOf(field.typeName) : null;
        if (nested && nested.mapEntry) {
          const entry = decode(field.typeName, reader.take(Number(reader.varint())));
          const keyName = nested.byNumber.get(1).name;
          const valueName = nested.byNumber.get(2).name;
          out[field.name] = { ...(out[field.name] || {}), [String(entry[keyName] ?? "")]: entry[valueName] };
          continue;
        }
        const list = out[field.name] || (out[field.name] = []);
        if (wireType === WIRE.LENGTH && isScalarPackable(field.type)) {
          const packed = new Reader(reader.take(Number(reader.varint())));
          while (!packed.done) list.push(decodeScalar(packed, field));
        } else {
          list.push(decodeValue(reader, field));
        }
        continue;
      }
      out[field.name] = decodeValue(reader, field);
    }
    return out;
  }

  return { encode, decode, hasMessage: (name) => messages.has(String(name).replace(/^\./, "")) };
}

// --- the descriptors themselves -------------------------------------------------------------------------------------

// descriptor.proto's own messages, as far as a FileDescriptorSet of the client's needs them: enough of the schema to
// read the rest of the schema.
const DESCRIPTOR_SCHEMA = createSchema({
  messages: {
    FileDescriptorSet: { fields: [{ name: "file", number: 1, type: TYPE.MESSAGE, label: 3, typeName: "FileDescriptorProto" }] },
    FileDescriptorProto: {
      fields: [
        { name: "name", number: 1, type: TYPE.STRING, label: 1 },
        { name: "package", number: 2, type: TYPE.STRING, label: 1 },
        { name: "dependency", number: 3, type: TYPE.STRING, label: 3 },
        { name: "message_type", number: 4, type: TYPE.MESSAGE, label: 3, typeName: "DescriptorProto" },
        { name: "enum_type", number: 5, type: TYPE.MESSAGE, label: 3, typeName: "EnumDescriptorProto" },
        { name: "syntax", number: 12, type: TYPE.STRING, label: 1 },
      ],
    },
    DescriptorProto: {
      fields: [
        { name: "name", number: 1, type: TYPE.STRING, label: 1 },
        { name: "field", number: 2, type: TYPE.MESSAGE, label: 3, typeName: "FieldDescriptorProto" },
        { name: "nested_type", number: 3, type: TYPE.MESSAGE, label: 3, typeName: "DescriptorProto" },
        { name: "enum_type", number: 4, type: TYPE.MESSAGE, label: 3, typeName: "EnumDescriptorProto" },
        { name: "options", number: 7, type: TYPE.MESSAGE, label: 1, typeName: "MessageOptions" },
        { name: "oneof_decl", number: 8, type: TYPE.MESSAGE, label: 3, typeName: "OneofDescriptorProto" },
      ],
    },
    MessageOptions: { fields: [{ name: "map_entry", number: 7, type: TYPE.BOOL, label: 1 }] },
    OneofDescriptorProto: { fields: [{ name: "name", number: 1, type: TYPE.STRING, label: 1 }] },
    FieldDescriptorProto: {
      fields: [
        { name: "name", number: 1, type: TYPE.STRING, label: 1 },
        { name: "number", number: 3, type: TYPE.INT32, label: 1 },
        { name: "label", number: 4, type: TYPE.INT32, label: 1 },
        { name: "type", number: 5, type: TYPE.INT32, label: 1 },
        { name: "type_name", number: 6, type: TYPE.STRING, label: 1 },
        { name: "oneof_index", number: 9, type: TYPE.INT32, label: 1 },
        { name: "proto3_optional", number: 17, type: TYPE.BOOL, label: 1 },
      ],
    },
    EnumDescriptorProto: {
      fields: [
        { name: "name", number: 1, type: TYPE.STRING, label: 1 },
        { name: "value", number: 2, type: TYPE.MESSAGE, label: 3, typeName: "EnumValueDescriptorProto" },
      ],
    },
    EnumValueDescriptorProto: {
      fields: [
        { name: "name", number: 1, type: TYPE.STRING, label: 1 },
        { name: "number", number: 2, type: TYPE.INT32, label: 1 },
      ],
    },
  },
});

/** A FileDescriptorSet's messages and enums as a schema's JSON (createSchema's input), by full name. */
function schemaJsonFromDescriptorSet(buffer) {
  const set = DESCRIPTOR_SCHEMA.decode("FileDescriptorSet", buffer);
  const messages = {};
  const enums = {};
  const addEnum = (prefix, enumeration) => {
    const values = {};
    for (const value of enumeration.value || []) values[value.name] = value.number || 0;
    enums[`${prefix}${enumeration.name}`] = { values };
  };
  const addMessage = (prefix, message) => {
    const fullName = `${prefix}${message.name}`;
    const oneofs = (message.oneof_decl || []).map((oneof) => oneof.name);
    messages[fullName] = {
      ...(message.options && message.options.map_entry ? { mapEntry: true } : {}),
      fields: (message.field || []).map((field) => ({
        name: field.name,
        number: field.number,
        type: field.type,
        label: field.label || 1,
        ...(field.type_name ? { typeName: field.type_name.replace(/^\./, "") } : {}),
        // A proto3 optional field is a one-field oneof of its own: written whenever given, as a oneof's is.
        ...(field.oneof_index !== undefined ? { oneof: field.proto3_optional ? `_${field.name}` : oneofs[field.oneof_index] } : {}),
      })),
    };
    for (const nested of message.nested_type || []) addMessage(`${fullName}.`, nested);
    for (const enumeration of message.enum_type || []) addEnum(`${fullName}.`, enumeration);
  };
  for (const file of set.file || []) {
    const prefix = file.package ? `${file.package}.` : "";
    for (const message of file.message_type || []) addMessage(prefix, message);
    for (const enumeration of file.enum_type || []) addEnum(prefix, enumeration);
  }
  return { messages, enums };
}

module.exports = { TYPE, createSchema, schemaJsonFromDescriptorSet };
