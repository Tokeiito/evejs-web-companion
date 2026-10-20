// corp_ui_member_decorations.LoadDecorations55-87 and medals.GetAllCorpMedals60-62.
// TQ's cached value is a list of catalogue and graphics CRowsets (admin panels1249).
import { isListValue, readKeyVal, readRowField, readRowsetRows, unwrapLong, type JsonValue } from "./wire.ts";
import { unwrapCachedResult } from "./market.ts";
import { intDictOrder } from "./py27DictOrder.ts";

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

export interface CorporationMedalAwardee {
  readonly recipientID: number;
  readonly issuerID: number;
  readonly date: bigint;
  readonly reason: string;
  readonly awarded: number;
}

// MedalRibbonPickerWindow.SubmitData553-560: ribbon rows, then medal rows.
export type MedalCreationGraphic = readonly [part: number, graphic: string, color: number];

// GetMedalSubContent112-149: first award supplies the fields; repeats only
// increase the count. Iteration follows the native integer-key dict.
export function corporationMedalAwardeesOf(answer: JsonValue): readonly CorporationMedalAwardee[] {
  const grouped = new Map<number, CorporationMedalAwardee>();
  for (const row of rowsOf(unwrapCachedResult(answer))) {
    const recipientID = integer(row, "recepientID"), previous = grouped.get(recipientID);
    if (previous) { grouped.set(recipientID, { ...previous, awarded: previous.awarded + 1 }); continue; }
    const date = unwrapLong(field(row, "date"));
    if (date === null) throw new Error("A medal award's date could not be read.");
    grouped.set(recipientID, { recipientID, issuerID: integer(row, "issuerID"), date, reason: text(row, "reason"), awarded: 1 });
  }
  return intDictOrder([...grouped.keys()]).map(id => grouped.get(id)!);
}

export interface MedalLayer {
  readonly url: string;
  readonly left: number;
  readonly top: number;
  readonly part: number;
  readonly color: number;
}

export interface MedalInfo {
  readonly title: string;
  readonly description: string;
  readonly ownerID: number;
  readonly awarded: number;
  readonly ticker: string | null;
}

// InfoWindowMonolith uses GetMedalDetails(...).info[0] for its caption and
// again for its corporation header (infoContentBase1450-1453,675-687).
export function medalDetailsInfoOf(answer: JsonValue): Omit<MedalInfo, "ticker"> {
  const info = readKeyVal(unwrapCachedResult(answer), "info");
  const row = Array.isArray(info) ? info[0] : isListValue(info) ? info.items[0] : undefined;
  return { title: text(row, "title"), description: text(row, "description"), ownerID: integer(row, "ownerID"), awarded: integer(row, "numberOfRecipients") };
}

// uix.FormatMedalData777-794 ignores layer numbers and preserves row order.
// MapLogo196-236 selects a 128px quadrant of an installed 256px atlas.
export function medalLayersOf(graphics: readonly CorporationDecorationGraphic[]): readonly MedalLayer[] {
  const result: MedalLayer[] = [];
  for (const part of [1, 2]) {
    const rows = graphics.filter(row => row.part === part);
    if (!rows.length) throw new Error("The medal has no graphics for one of its parts.");
    for (const row of rows) {
      result.push(medalGraphicLayer(part, row.graphic, row.color));
    }
  }
  // PyChildrenList appends at idx=-1. Trinity's container gathers children
  // in reverse order (Tr2Sprite2dContainer.cpp312-318): first row is on top.
  return result.reverse();
}

// The designer can display an incomplete part; catalogue validation above
// still requires both. Share only the native MapLogo atlas mapping.
export function medalGraphicLayer(part: number, graphic: string, color: number): MedalLayer {
  const match = /^([a-z0-9_-]+)\.([0-9]+)_([0-9]+)$/i.exec(graphic);
  if (!match || Number(match[2]) < 1) throw new Error("The medal's graphic mapping could not be read.");
  const file = String(Number(match[2])).padStart(2, "0"), quadrant = Number(match[3]);
  return { url: `/client-res/ui/texture/medals/${part === 1 ? "ribbons" : "medals"}/${match[1]!.toLowerCase()}${file}.dds`,
    left: quadrant === 2 || quadrant === 4 ? 128 : 0, top: quadrant > 2 ? 128 : 0, part, color };
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
