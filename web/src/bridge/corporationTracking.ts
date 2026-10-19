// CorpMemberTracking.ShowMemberTracking: the full and simple registry calls expose the same named fields.
import { readRowField, readRowsetRows, readKeyVal, isListValue, unwrapLong, type JsonValue } from "./wire.ts";
import { unwrapCachedResult } from "./market.ts";

export interface CorporationTrackingMember {
  readonly characterID: number;
  readonly corporationID: number;
  readonly title: string;
  readonly roles: bigint;
  readonly grantableRoles: bigint;
  readonly baseID: number | null;
  readonly startDateTime: bigint | null;
  readonly lastOnline: number | null;
  readonly shipTypeID: number | null;
  readonly locationID: number | null;
  readonly factionID: number | null;
  readonly logonDateTime: bigint | null;
  readonly logoffDateTime: bigint | null;
}
export interface CorporationTracking {
  readonly members: readonly CorporationTrackingMember[];
  readonly factionID: number | null;
}

export function corporationTrackingOf(answer: JsonValue): readonly CorporationTrackingMember[] {
  const rowset = unwrapCachedResult(answer);
  const crowset = rowset && typeof rowset === "object" && !Array.isArray(rowset) && "list" in rowset && Array.isArray(rowset.list);
  if (!crowset && !isListValue(readKeyVal(rowset, "lines"))) throw new Error("Your corporation's member tracking could not be read.");
  const rows = rowset && typeof rowset === "object" && !Array.isArray(rowset) && "list" in rowset && Array.isArray(rowset.list)
    ? rowset.list : readRowsetRows(rowset);
  return rows.flatMap((row): CorporationTrackingMember[] => {
    const field = (name: string): JsonValue | undefined => readRowField(row, name) ?? (row as Record<string, JsonValue>)[name];
    const integer = (name: string): bigint | null => {
      const value = field(name);
      return typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
    };
    const number = (name: string): number | null => {
      const value = integer(name);
      return value === null ? null : Number(value);
    };
    const characterID = number("characterID");
    if (characterID === null || characterID <= 0) return [];
    const title = field("title");
    const titleText = typeof title === "string" ? title : title && typeof title === "object" && "value" in title && typeof title.value === "string" ? title.value : "";
    return [{ characterID, corporationID: number("corporationID") ?? 0, title: titleText,
      roles: integer("roles") ?? 0n, grantableRoles: integer("grantableRoles") ?? 0n,
      baseID: number("baseID"), startDateTime: integer("startDateTime"), lastOnline: number("lastOnline"),
      shipTypeID: number("shipTypeID"), locationID: number("locationID"), factionID: number("factionID"),
      logonDateTime: integer("logonDateTime"), logoffDateTime: integer("logoffDateTime") }];
  });
}
