import type { Ask } from "./ask.ts";
import { isListValue, isPackedRowValue, readDictEntry, readDictPairs, readRowField, unwrapLong, type JsonValue } from "./wire.ts";

export interface CorporationRecord {
  readonly header: readonly string[];
  readonly fields: Readonly<Record<string, JsonValue>>;
}

function recordOf(value: JsonValue): CorporationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A corporation record is missing.");
  if (isPackedRowValue(value)) {
    const header = value.columns?.map(column => Array.isArray(column) ? column[0] : column).filter((column): column is string => typeof column === "string")
      ?? Object.keys(value.fields ?? {});
    return { header, fields: Object.fromEntries(header.map(key => [key, readRowField(value, key) ?? null])) };
  }
  const row = value as Readonly<Record<string, JsonValue>>;
  const header = readDictEntry(row.args, "header"), line = readDictEntry(row.args, "line");
  if (!isListValue(header) || !isListValue(line) || !header.items.every(key => typeof key === "string")) throw new Error("A corporation row's columns could not be read.");
  return { header: header.items as readonly string[], fields: Object.fromEntries(header.items.map((key, index) => [String(key), line.items[index] ?? null])) };
}

/** bco_corporations.GetCorporation/LoadCorporation42-78. Keep completed rows,
 * not promises: concurrent native misses may each issue their own read. */
export function createCorporationRecords(ownCorporation: () => number | null) {
  let header: readonly string[] | null = null, generation = 0;
  const rows = new Map<number, CorporationRecord>();
  return {
    async get(ask: Ask, corporationID: number, current: () => void = () => {}, fresh = false): Promise<CorporationRecord> {
      current();
      if (!fresh && rows.has(corporationID)) return rows.get(corporationID)!;
      const epoch = generation;
      const answer = corporationID === ownCorporation()
        ? await ask("corpRegistry", "GetCorporation", [])
        : await ask("corpmgr", "GetCorporations", [corporationID]);
      current();
      if (epoch !== generation) throw Object.assign(new Error("The corporation read belongs to a previous pilot."), { code: "SESSION_REQUEST_RETIRED" });
      const row = recordOf(answer);
      header ??= row.header;
      const fields = Object.fromEntries(header.map(key => {
        if (!(key in row.fields)) throw new Error(`A corporation row has no ${key} column.`);
        return [key, row.fields[key]!];
      }));
      const id = Number(unwrapLong(row.fields.corporationID));
      rows.set(id, { header, fields });
      const held = rows.get(corporationID);
      if (!held) throw new Error(`KeyError: ${corporationID}`);
      return held;
    },
    /** DoSessionChanging23-30 drops only the new corporation on membership change. */
    membershipChanged(corporationID: number | null): void { if (corporationID !== null) rows.delete(corporationID); },
    reset(): void { generation++; header = null; rows.clear(); },
    /** bco_base.GetAddRemoveFromChange44-61 and bco_corporations79-113.
     * Native UI/ticker signals following the row update are separate callers. */
    changed(corporationID: number, change: JsonValue): void {
      const entries = readDictPairs(change).map(([key, value]) => {
        const pair: readonly JsonValue[] = Array.isArray(value) ? value
          : value !== null && typeof value === "object" && "items" in value && Array.isArray(value.items) ? value.items : [];
        if (typeof key !== "string" || pair.length !== 2) throw new Error("A corporation change is not a pair.");
        return { key, old: pair[0], value: pair[1] as JsonValue };
      });
      let add = entries.length > 0, remove = entries.length > 0;
      for (const entry of entries) {
        if (entry.old === null && entry.value === null) continue;
        if (entry.old !== null) add = false;
        if (entry.value !== null) remove = false;
      }
      if (add && remove) throw new Error("GetAddRemoveFromChange WTF");
      if (header === null) return;
      if (add) {
        if (entries.length !== header.length) { console.warn("IncorrectNumberOfColumns ignoring change as Add change:", corporationID); return; }
        const fields = Object.fromEntries(header.map(key => {
          const entry = entries.find(entry => entry.key === key);
          if (!entry) throw new Error(`KeyError: ${key}`);
          return [key, entry.value];
        }));
        rows.set(corporationID, { header, fields });
      } else if (!rows.has(corporationID)) return;
      if (remove) { rows.delete(corporationID); return; }
      const row = rows.get(corporationID)!;
      const fields = row.fields as Record<string, JsonValue>;
      for (const { key, value } of entries) if (header.includes(key)) fields[key] = value;
    },
  };
}
