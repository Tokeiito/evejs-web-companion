// The character NOTES cluster, decoded to plain rows (goal R58, PLUMBING ONLY —
// no UI).
//
// GET /api/bridge/character-notes returns three raw retail-shaped charMgr
// results, captured live from Farmer (character 140000005) on 2026-07-22:
//
//   • labels    = GetOwnerNoteLabels() -> Rowset[noteID, label]. The note index.
//     ⚠ The handler LAZILY SEEDS a default "S:Folders" note, so this is NEVER
//     empty: Farmer's live capture was one row [1, "S:Folders"]. Rows are BARE
//     ARRAYS (read through readRowsetRows).
//   • ownerNote = GetOwnerNote(noteID) -> {type:"list", items:[util.KeyVal{
//     noteID, label, note}]}. One owner note wrapped in a list; the empty payload
//     ({noteID, label:"", note:""}) when the id is unknown. Farmer's noteID 1 is
//     the folders note {noteID:1, label:"S:Folders", note:"1::F::0::Main|"}.
//   • entityNote = GetNote(itemID) -> a BARE STRING (a note the character keeps
//     ABOUT an entity). "" is a REAL "no note" answer — Farmer keeps none.
//
// R7d: noteID is an internal note handle kept as a numeric field; the label/note
// text is free-form the character wrote. No entity ids are forced into labels.

import {
  isListValue,
  readKeyVal,
  readRowsetRows,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

/** One owner-note label/index row. */
export interface OwnerNoteLabel {
  readonly noteID: number;
  readonly label: string;
}

/** One owner note (label + body). */
export interface OwnerNote {
  readonly noteID: number;
  readonly label: string;
  readonly note: string;
}

function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return Number(long);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return 0;
}

function toStringOrEmpty(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Decode charMgr.GetOwnerNoteLabels — the note index Rowset. A row with no
 * positive noteID is dropped. Never legitimately empty (the handler seeds a
 * default folders note), but `[]` is returned for a non-rowset / failed read.
 */
export function decodeOwnerNoteLabels(
  result: JsonValue | null | undefined,
): readonly OwnerNoteLabel[] {
  const rows: OwnerNoteLabel[] = [];
  for (const row of readRowsetRows(result)) {
    const noteID = toNumber(row.noteID);
    if (noteID <= 0) {
      continue;
    }
    rows.push({ noteID, label: toStringOrEmpty(row.label) });
  }
  return rows;
}

/**
 * Decode charMgr.GetOwnerNote — the single note wrapped in a list. Reads
 * items[0] (a util.KeyVal). null when the list is empty or the row is absent (a
 * failed read); an empty-body note ({noteID, label:"", note:""}) is a real
 * "unknown id" answer the handler returns, not a failure.
 */
export function decodeOwnerNote(
  result: JsonValue | null | undefined,
): OwnerNote | null {
  if (!isListValue(result)) {
    return null;
  }
  const row = result.items[0];
  if (row === undefined) {
    return null;
  }
  return {
    noteID: toNumber(readKeyVal(row, "noteID")),
    label: toStringOrEmpty(readKeyVal(row, "label")),
    note: toStringOrEmpty(readKeyVal(row, "note")),
  };
}

/**
 * Decode charMgr.GetNote — a bare string (the entity note body). "" is a REAL
 * "no note kept about this entity" answer; null when the value was not a string
 * (an absent / failed read the flow's error handling covers).
 */
export function decodeEntityNote(
  result: JsonValue | null | undefined,
): string | null {
  return typeof result === "string" ? result : null;
}
