"use strict";

// ── A shopping list read as the client's multibuy window reads one ───────────
//
// The client's multibuy window imports a list from the clipboard
// (buyMultiFromBase.ImportShoppingList, 139 to 151): textImporting.importMultibuy
// ImportMultibuy.GetTypesAndQty reads it line by line, each line a type's name
// and a quantity before it or after it, and the names are the market's types
// (marketQuote.GetMarketTypeIDFinder: every type in the market's groups, by its
// English name lowered, textToTypeIDFinder.py). This is that reading, line for
// line, with the English separators (a client in English: '.' for the decimal,
// ',' for the thousands).

/** textImporting.CleanText: the <localized> tags and the important mark '*' taken out (__init__.py 65 to 68). */
function cleanText(text) {
  const untagged = String(text).split(/<\/localized>|<localized>|<localized .*?>|<localized *=.*?>|<localized\/>/).join("");
  return untagged.replace(/\*/g, "");
}

/** textImporting.GetLines (21 to 28): each line, trimmed, the empty ones left out. */
function getLines(text) {
  const withBreaks = String(text).replace(/\n/g, "<br>").replace(/\r\n/g, "<br>");
  return withBreaks.split("<br>").map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Python's int() of a string: an optional sign and digits, with spaces about them. */
const PY_INT = /^\s*[+-]?\d+\s*$/;
/** Python's float() of a string, as far as a quantity can be one. */
const PY_FLOAT = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;

const QTY_NOT_FOUND = -1;

/**
 * An importer over the market's names (a Map of a name lowered to its type).
 *
 *   getTypesAndQty(text)  {found: [[typeID, qty], ...], failedLines: [...]}, as GetTypesAndQty (14 to 32) answers
 */
function createMultibuyImport(namesToTypeIDs, { decimalSymbol = ".", digitSymbol = "," } = {}) {
  /** _FindQty (55 to 66): the first part, its x's stripped, its thousands taken out, read as a whole number. */
  function findQty(parts) {
    if (parts.length === 0) return QTY_NOT_FOUND;
    let part = parts[0].replace(/^x+|x+$/g, "").split(digitSymbol).join("");
    if (part.includes(decimalSymbol)) {
      part = part.split(decimalSymbol).join(".");
      if (!PY_FLOAT.test(part)) return QTY_NOT_FOUND;
      const value = Number(part);
      return Number.isFinite(value) ? Math.trunc(value) : QTY_NOT_FOUND;
    }
    return PY_INT.test(part) ? Number.parseInt(part, 10) : QTY_NOT_FOUND;
  }

  /** FindTypeID (68 to 79): the longest run of the parts from the first that names a market type. */
  function findTypeID(parts) {
    const words = parts.length > 0 && parts[0] === "x" ? parts.slice(1) : parts;
    for (let count = words.length; count > 0; count -= 1) {
      const potentialName = words.slice(0, count).join(" ").toLowerCase();
      const typeID = namesToTypeIDs.get(potentialName);
      if (typeID) return [typeID, potentialName];
    }
    return [null, null];
  }

  /** ParseLine (34 to 53). */
  function parseLine(rawLine) {
    const line = cleanText(rawLine);
    const allParts = line.toLowerCase().split(/\s+/).filter((part) => part.length > 0);
    let qty = findQty(allParts);
    let typeID = null;
    let foundName = "";
    if (qty !== QTY_NOT_FOUND) [typeID, foundName] = findTypeID(allParts.slice(1));
    if (typeID === null) {
      [typeID, foundName] = findTypeID(allParts);
      qty = QTY_NOT_FOUND;
    }
    if (typeID !== null && qty === QTY_NOT_FOUND) {
      const restOfLine = line.toLowerCase().replace(foundName, "").trim();
      qty = findQty(restOfLine.split(/\s+/).filter((part) => part.length > 0));
    }
    if (qty === QTY_NOT_FOUND) qty = 1;
    return [typeID, qty];
  }

  function getTypesAndQty(text) {
    if (!text) return { found: [], failedLines: [""] };
    const found = new Map();
    const failedLines = [];
    for (const line of getLines(text)) {
      const [typeID, qty] = parseLine(line);
      if (typeID) found.set(typeID, (found.get(typeID) ?? 0) + qty);
      else failedLines.push(line);
    }
    // The client hands them on in the reverse of the order they were first read in.
    return { found: [...found.entries()].reverse(), failedLines };
  }

  return { getTypesAndQty };
}

module.exports = { cleanText, createMultibuyImport, getLines };
