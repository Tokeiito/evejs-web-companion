// Ordinary Scroll._GetSortValue721-758 and SortAsRoot914-951. Numeric keys
// precede text in Python 2; text fallback keeps the remaining columns' case.
function sortValue(label: string, index: number): string | number {
  const columns = label.split("<t>");
  if (index >= columns.length) return "aaa";
  // font.DeTag249-250 uses only font.py208's five tag alternatives;
  // other markup and entities remain part of the native sort value.
  const value = columns[index]!.toLowerCase().replace(/<color=0x.*?>|<\/color>|<right>|<center>|<left>/g, "");
  const numeric = value.replace(/m³|isk|km|au|,| |m3/g, "").trim();
  if (/^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|inf(?:inity)?|nan)$/i.test(numeric)) {
    const number = /^[+-]?inf(?:inity)?$/i.test(numeric) ? (numeric.startsWith("-") ? -Infinity : Infinity) : Number(numeric);
    return number * (value.includes("au") ? 149597870700 : value.includes("km") ? 1000 : 1);
  }
  return value + columns.slice(index + 1).join("");
}
function compare(left: string | number, right: string | number): number {
  if (typeof left !== typeof right) return typeof left === "number" ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}
export function sortScrollRows<T>(rows: readonly T[], labelOf: (row: T) => string, index: number, reversed: boolean): readonly T[] {
  const sorted = rows.map(row => { const label = labelOf(row); return { row, value: sortValue(label, index), label: label.toLowerCase() }; });
  sorted.sort((a, b) => compare(a.value, b.value) || compare(a.label, b.label));
  // Native reverses the completed list, including equal-key rows.
  if (reversed) sorted.reverse();
  return sorted.map(({ row }) => row);
}
