"use strict";

// addressbookService's successful own writes (617-869, 1001-1147).
// Keep the native reply containers/row descriptors; update existing rows in
// place in their order, append new owners, and preserve every unrelated field.
const { text, dictGet } = require("./packets");
const MAX_LONG = 9223372036854775807n;
const OWN_WRITES = new Set(["AddContact", "EditContact", "DeleteContacts", "EditContactsRelationshipID", "BlockOwners", "UnblockOwners", "CreateLabel", "EditLabel", "DeleteLabel", "AssignLabels", "RemoveLabels"]);
const list = value => Array.isArray(value) ? value : value?.items ?? [];
const whole = value => BigInt(value?.value ?? value ?? 0);
const field = (value, name) => dictGet(value?.args, name);

function rowFields(row) {
  return row.fields ?? Object.fromEntries(row.columns.map(([name], i) => [text(name), row.values[i]]));
}
function rowMade(rowset, fields, previous) {
  const header = previous?.header ?? dictGet(rowset.header[1], "header");
  const columns = previous?.columns ?? header.header[1][0];
  return { ...(previous ?? {}), type: "packedrow", header, columns,
    fields, values: columns.map(([name]) => fields[text(name)]) };
}
function rowsChanged(rowset, key, changes) {
  if (!Array.isArray(rowset?.list)) throw new TypeError("Expected native CRowset");
  const rows = new Map(rowset.list.map(row => [Number(rowFields(row)[key]), row]));
  changes(rows, (id, patch) => {
    const previous = rows.get(id);
    const fields = { ...(previous ? rowFields(previous) : {}), ...patch };
    rows.set(id, rowMade(rowset, fields, previous));
  });
  return { ...rowset, list: [...rows.values()] };
}
function keyValMade(fields) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries: Object.entries(fields) } };
}

function amendContacts(answer, method, args) {
  const addresses = field(answer, "addresses"), blocked = field(answer, "blocked");
  let nextAddresses = addresses, nextBlocked = blocked;
  if (["AddContact", "EditContact", "DeleteContacts", "EditContactsRelationshipID", "AssignLabels", "RemoveLabels", "DeleteLabel"].includes(method)) {
    nextAddresses = rowsChanged(addresses, "contactID", (rows, put) => {
      const id = Number(args[0]);
      if (method === "AddContact" || method === "EditContact") {
        if (!(id > 0)) return;
        const previous = rows.get(id);
        put(id, { contactID: id, relationshipID: args[1] ?? 0, inWatchlist: Boolean(args[2]), labelMask: previous ? rowFields(previous).labelMask : 0n });
      } else if (method === "DeleteContacts") {
        for (const owner of list(args[0])) rows.delete(Number(owner));
      } else {
        const ids = method === "DeleteLabel" ? [...rows.keys()] : list(args[0]).map(Number);
        const bits = whole(method === "DeleteLabel" ? args[0] : args[1]);
        for (const owner of ids) {
          const previous = rows.get(owner);
          if (!previous) continue;
          const before = rowFields(previous);
          put(owner, method === "EditContactsRelationshipID" ? { relationshipID: args[1] }
            : { labelMask: method === "AssignLabels" ? whole(before.labelMask) | bits : whole(before.labelMask) & (MAX_LONG - bits) });
        }
      }
    });
  }
  if (method === "BlockOwners" || method === "UnblockOwners") {
    nextBlocked = rowsChanged(blocked, "senderID", (rows, put) => {
      for (const owner of list(args[0])) {
        const id = Number(owner);
        if (!(id > 0)) continue;
        if (method === "BlockOwners") put(id, { senderID: id });
        else rows.delete(id);
      }
    });
  }
  return { ...answer, args: { ...answer.args, entries: answer.args.entries.map(([key, value]) =>
    [key, text(key) === "addresses" ? nextAddresses : text(key) === "blocked" ? nextBlocked : value]) } };
}

function amendLabels(answer, method, args, result) {
  if (method === "DeleteLabel") return undefined; // native immediately asks GetLabels again
  if (method !== "CreateLabel" && method !== "EditLabel") return answer;
  if (answer?.type !== "dict") throw new TypeError("Expected native labels dict");
  const id = whole(method === "CreateLabel" ? result : args[0]);
  if (id <= 0n) return answer;
  const entries = [...answer.entries], at = entries.findIndex(([key]) => whole(key) === id);
  if (method === "CreateLabel") {
    const made = [id, keyValMade({ labelID: id, name: text(args[0]) ?? args[0], color: args[1] ?? null })];
    if (at < 0) entries.push(made); else entries[at] = made;
  } else if (at >= 0) {
    const [key, row] = entries[at];
    entries[at] = [key, { ...row, args: { ...row.args, entries: row.args.entries.map(([name, value]) =>
      [name, text(name) === "name" && args[1] != null ? text(args[1]) ?? args[1] : text(name) === "color" && args[2] != null ? args[2] : value]) } }];
  }
  return { ...answer, entries };
}

function localEvent(method, args, result) {
  if (method === "CreateLabel" || method === "EditLabel" || method === "DeleteLabel") return ["OnMyLabelsChanged", ["contact", method === "CreateLabel" ? result : null]];
  const ids = method === "AddContact" || method === "EditContact" ? [args[0]] : list(args[0]);
  if (method === "BlockOwners") return ["OnBlockContacts", [ids]];
  if (method === "UnblockOwners") return ["OnUnblockContacts", [ids]];
  return [method === "AssignLabels" || method === "RemoveLabels" ? "OnEditLabel" : "OnContactChange", [ids, "contact"]];
}

module.exports = { OWN_WRITES, amendContacts, amendLabels, localEvent };
