// corp_ui_member_decorations.LoadDecorations55-87 and medals.GetAllCorpMedals60-62.
// TQ's cached value is a list of catalogue and graphics CRowsets (admin panels1249).
import { isListValue, readRowField, readRowsetRows, unwrapLong, type JsonValue } from "./wire.ts";
import { unwrapCachedResult } from "./market.ts";

export interface CorporationDecoration {
  readonly medalID: number;
  readonly ownerID: number;
  readonly creatorID: number;
  readonly title: string;
  readonly description: string;
  readonly date: bigint;
  readonly awarded: number;
}
export interface CorporationDecorationGraphic {
  readonly medalID: number;
  readonly part: number;
  readonly layer: number | null;
  readonly graphic: string;
  readonly color: number;
}
export interface CorporationDecorations {
  readonly medals: readonly CorporationDecoration[];
  readonly graphics: readonly CorporationDecorationGraphic[];
}

function rowsOf(value: JsonValue): readonly unknown[] {
  if (value && typeof value === "object" && !Array.isArray(value) && "list" in value && Array.isArray(value.list)) return value.list;
  return readRowsetRows(value);
}
function field(row: unknown, name: string): JsonValue | undefined {
  return readRowField(row, name) ?? (row && typeof row === "object" ? (row as Record<string, JsonValue>)[name] : undefined);
}
function integer(row: unknown, name: string): number {
  const value = unwrapLong(field(row, name));
  if (value === null || value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("A corporation decoration could not be read.");
  return Number(value);
}
function text(row: unknown, name: string): string {
  const value = field(row, name);
  if (value && typeof value === "object" && !Array.isArray(value) && "type" in value && value.type === "wstring" && "value" in value && typeof value.value === "string") return value.value;
  if (typeof value !== "string") throw new Error("A corporation decoration could not be read.");
  return value;
}

export function corporationDecorationsOf(answer: JsonValue): CorporationDecorations {
  const raw = unwrapCachedResult(answer), tuple = Array.isArray(raw) ? raw : isListValue(raw) ? raw.items : [];
  if (tuple.length !== 2) throw new Error("The corporation's decorations could not be read.");
  const medals = rowsOf(tuple[0]!).map(row => {
    const date = unwrapLong(field(row, "date"));
    if (date === null) throw new Error("A corporation decoration's date could not be read.");
    return { medalID: integer(row, "medalID"), ownerID: integer(row, "ownerID"), creatorID: integer(row, "creatorID"),
      title: text(row, "title"), description: text(row, "description"), date, awarded: integer(row, "noRecepients") };
  });
  const graphics = rowsOf(tuple[1]!).map(row => ({ medalID: integer(row, "medalID"), part: integer(row, "part"),
    layer: field(row, "layer") == null ? null : integer(row, "layer"), graphic: text(row, "graphic"), color: integer(row, "color") }));
  return { medals, graphics };
}
