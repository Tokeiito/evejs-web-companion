"use strict";

const { attributePythonType, attributeRecordLessThan } = require("./clientDogmaArithmetic");

class ClientDogmaFactorSortNotReadyError extends Error {
  constructor(length) {
    super("Native factor sorting for NaN lists of 64 or more records is not ready.");
    this.name = "ClientDogmaFactorSortNotReadyError";
    this.length = length;
  }
}

/** Internal source-record array seam for StackingNurfedAttribute's sorted().
 * Supported builtin None/bool/int/long/float classes use Python comparisons;
 * infinities and signed zero are supported. Without NaN these form the same
 * stable total ordering at any length. With NaN, stability alone is insufficient:
 * installed CPython2.7.1 and V8 merge schedules produce different orders.
 * cdxstackingsortagent1 retains original builtin counterexamples and sources.
 * For length <64, listobject.c1040-1147/1840-1862/2120-2165 uses exactly one
 * natural run, strict descending reversal, then binary insertion. Longer NaN
 * lists require the original merge/gallop algorithm, not a finite-only policy.
 * Return a fresh array and retain the original record objects, as sorted does.
 */
function sortClientDogmaAttributeFactors(records) {
  if (!Array.isArray(records)) throw new TypeError("An attribute source-record array is required.");
  const result = records.slice();
  let hasNaN = false;
  for (const record of result) {
    // Validate even a singleton, before choosing either algorithm. This uses
    // the existing numeric-class authority without integral-value inference.
    attributeRecordLessThan(record, record);
    if (attributePythonType(record) === "float" && Number.isNaN(record.value)) hasNaN = true;
  }
  if (!hasNaN) {
    return result.sort((a, b) => attributeRecordLessThan(a, b) ? -1 : attributeRecordLessThan(b, a) ? 1 : 0);
  }
  if (result.length >= 64) throw new ClientDogmaFactorSortNotReadyError(result.length);
  if (result.length < 2) return result;

  let run = 2;
  const descending = attributeRecordLessThan(result[1], result[0]);
  while (run < result.length && attributeRecordLessThan(result[run], result[run - 1]) === descending) ++run;
  if (descending) {
    for (let left = 0, right = run - 1; left < right; ++left, --right) {
      [result[left], result[right]] = [result[right], result[left]];
    }
  }
  for (let start = run; start < result.length; ++start) {
    const pivot = result[start];
    let left = 0, right = start;
    while (left < right) {
      const middle = left + ((right - left) >> 1);
      if (attributeRecordLessThan(pivot, result[middle])) right = middle;
      else left = middle + 1;
    }
    for (let position = start; position > left; --position) result[position] = result[position - 1];
    result[left] = pivot;
  }
  return result;
}

module.exports = { sortClientDogmaAttributeFactors, ClientDogmaFactorSortNotReadyError };
