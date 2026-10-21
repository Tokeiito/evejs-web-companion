"use strict";

const { attributePythonType, attributeRecordLessThan } = require("./clientDogmaArithmetic");

const less = attributeRecordLessThan;
const MIN_GALLOP = 7;

function move(destination, to, source, from, length) {
  // The C implementation uses both memcpy (disjoint temp storage) and
  // memmove (overlapping runs). Copy backwards only for rightward overlap.
  if (destination === source && to > from && to < from + length) {
    for (let index = length - 1; index >= 0; --index) destination[to + index] = source[from + index];
  } else {
    for (let index = 0; index < length; ++index) destination[to + index] = source[from + index];
  }
}

function binarySort(values, low, high, start) {
  if (start === low) ++start;
  for (; start < high; ++start) {
    const pivot = values[start];
    let left = low, right = start;
    while (left < right) {
      const middle = left + Math.floor((right - left) / 2);
      if (less(pivot, values[middle])) right = middle;
      else left = middle + 1;
    }
    move(values, left + 1, values, left, start - left);
    values[left] = pivot;
  }
}

function naturalRun(values, low, high) {
  if (low + 1 === high) return 1;
  let length = 2;
  const descending = less(values[low + 1], values[low]);
  while (low + length < high && less(values[low + length], values[low + length - 1]) === descending) ++length;
  if (descending) {
    for (let left = low, right = low + length - 1; left < right; ++left, --right) {
      [values[left], values[right]] = [values[right], values[left]];
    }
  }
  return length;
}

// listobject.c1173-1247 /1264-1338. Keep their opposite comparison
// directions: !(x<y) must not be replaced with y<x for unordered NaNs.
function gallopLeft(key, values, base, length, hint) {
  let last = 0, offset = 1;
  if (less(values[base + hint], key)) {
    const maximum = length - hint;
    while (offset < maximum && less(values[base + hint + offset], key)) {
      last = offset;
      offset = offset * 2 + 1;
    }
    if (offset > maximum) offset = maximum;
    last += hint;
    offset += hint;
  } else {
    const maximum = hint + 1;
    while (offset < maximum && !less(values[base + hint - offset], key)) {
      last = offset;
      offset = offset * 2 + 1;
    }
    if (offset > maximum) offset = maximum;
    const previous = last;
    last = hint - offset;
    offset = hint - previous;
  }
  ++last;
  while (last < offset) {
    const middle = last + Math.floor((offset - last) / 2);
    if (less(values[base + middle], key)) last = middle + 1;
    else offset = middle;
  }
  return offset;
}

function gallopRight(key, values, base, length, hint) {
  let last = 0, offset = 1;
  if (less(key, values[base + hint])) {
    const maximum = hint + 1;
    while (offset < maximum && less(key, values[base + hint - offset])) {
      last = offset;
      offset = offset * 2 + 1;
    }
    if (offset > maximum) offset = maximum;
    const previous = last;
    last = hint - offset;
    offset = hint - previous;
  } else {
    const maximum = length - hint;
    while (offset < maximum && !less(key, values[base + hint + offset])) {
      last = offset;
      offset = offset * 2 + 1;
    }
    if (offset > maximum) offset = maximum;
    last += hint;
    offset += hint;
  }
  ++last;
  while (last < offset) {
    const middle = last + Math.floor((offset - last) / 2);
    if (less(key, values[base + middle])) offset = middle;
    else last = middle + 1;
  }
  return offset;
}

// Original merge_lo1458-1582. The shared, adaptive minGallop and the fixed
// MIN_GALLOP exit condition are distinct. Preserve every degenerate exit,
// including na===0 after a gallop with an inconsistent (NaN) ordering.
function mergeLow(state, values, baseA, na, pb, nb) {
  const temporary = values.slice(baseA, baseA + na);
  let destination = baseA, pa = 0;
  const finish = () => move(values, destination, temporary, pa, na);
  const copyB = () => {
    move(values, destination, values, pb, nb);
    values[destination + nb] = temporary[pa];
  };
  values[destination++] = values[pb++];
  if (--nb === 0) return finish();
  if (na === 1) return copyB();
  let minGallop = state.minGallop;
  for (;;) {
    let aCount = 0, bCount = 0;
    for (;;) {
      if (less(values[pb], temporary[pa])) {
        values[destination++] = values[pb++];
        ++bCount;
        aCount = 0;
        if (--nb === 0) return finish();
        if (bCount >= minGallop) break;
      } else {
        values[destination++] = temporary[pa++];
        ++aCount;
        bCount = 0;
        if (--na === 1) return copyB();
        if (aCount >= minGallop) break;
      }
    }
    ++minGallop;
    do {
      if (minGallop > 1) --minGallop;
      state.minGallop = minGallop;
      aCount = gallopRight(values[pb], temporary, pa, na, 0);
      if (aCount) {
        move(values, destination, temporary, pa, aCount);
        destination += aCount;
        pa += aCount;
        na -= aCount;
        if (na === 1) return copyB();
        if (na === 0) return finish();
      }
      values[destination++] = values[pb++];
      if (--nb === 0) return finish();
      bCount = gallopLeft(temporary[pa], values, pb, nb, 0);
      if (bCount) {
        move(values, destination, values, pb, bCount);
        destination += bCount;
        pb += bCount;
        nb -= bCount;
        if (nb === 0) return finish();
      }
      values[destination++] = temporary[pa++];
      if (--na === 1) return copyB();
    } while (aCount >= MIN_GALLOP || bCount >= MIN_GALLOP);
    state.minGallop = ++minGallop;
  }
}

// Original merge_hi1591-1728. Merge backwards and take B on an unordered
// comparison; reversing a forward merge is not equivalent for NaN lists.
function mergeHigh(state, values, baseA, na, baseB, nb) {
  const temporary = values.slice(baseB, baseB + nb);
  let destination = baseB + nb - 1, pa = baseA + na - 1, pb = nb - 1;
  const finish = () => move(values, destination - (nb - 1), temporary, 0, nb);
  const copyA = () => {
    destination -= na;
    pa -= na;
    move(values, destination + 1, values, pa + 1, na);
    values[destination] = temporary[pb];
  };
  values[destination--] = values[pa--];
  if (--na === 0) return finish();
  if (nb === 1) return copyA();
  let minGallop = state.minGallop;
  for (;;) {
    let aCount = 0, bCount = 0;
    for (;;) {
      if (less(temporary[pb], values[pa])) {
        values[destination--] = values[pa--];
        ++aCount;
        bCount = 0;
        if (--na === 0) return finish();
        if (aCount >= minGallop) break;
      } else {
        values[destination--] = temporary[pb--];
        ++bCount;
        aCount = 0;
        if (--nb === 1) return copyA();
        if (bCount >= minGallop) break;
      }
    }
    ++minGallop;
    do {
      if (minGallop > 1) --minGallop;
      state.minGallop = minGallop;
      aCount = na - gallopRight(temporary[pb], values, baseA, na, na - 1);
      if (aCount) {
        destination -= aCount;
        pa -= aCount;
        move(values, destination + 1, values, pa + 1, aCount);
        na -= aCount;
        if (na === 0) return finish();
      }
      values[destination--] = temporary[pb--];
      if (--nb === 1) return copyA();
      bCount = nb - gallopLeft(values[pa], temporary, 0, nb, nb - 1);
      if (bCount) {
        destination -= bCount;
        pb -= bCount;
        move(values, destination + 1, temporary, pb + 1, bCount);
        nb -= bCount;
        if (nb === 1) return copyA();
        if (nb === 0) return finish();
      }
      values[destination--] = values[pa--];
      if (--na === 0) return finish();
    } while (aCount >= MIN_GALLOP || bCount >= MIN_GALLOP);
    state.minGallop = ++minGallop;
  }
}

function mergeAt(state, values, index) {
  const runs = state.runs, first = runs[index], second = runs[index + 1];
  let baseA = first.base, na = first.length, nb = second.length;
  const baseB = second.base;
  first.length = na + nb;
  runs.splice(index + 1, 1);
  const skip = gallopRight(values[baseB], values, baseA, na, 0);
  baseA += skip;
  na -= skip;
  if (na === 0) return;
  nb = gallopLeft(values[baseA + na - 1], values, baseB, nb, nb - 1);
  if (nb === 0) return;
  if (na <= nb) mergeLow(state, values, baseA, na, baseB, nb);
  else mergeHigh(state, values, baseA, na, baseB, nb);
}

function collapse(state, values, force) {
  const runs = state.runs;
  while (runs.length > 1) {
    let index = runs.length - 2;
    // CPython2.7.1's ORIGINAL schedule, not the later extra-invariant fix.
    // Changing merge order changes primitive outputs for NaN counterexamples.
    if (force || (index > 0 && runs[index - 1].length <= runs[index].length + runs[index + 1].length)) {
      if (index > 0 && runs[index - 1].length < runs[index + 1].length) --index;
    } else if (runs[index].length > runs[index + 1].length) break;
    mergeAt(state, values, index);
  }
}

function nativeSort(values) {
  if (values.length < 2) return values;
  let minimum = values.length, remainder = 0;
  while (minimum >= 64) {
    remainder = remainder || minimum % 2;
    minimum = Math.floor(minimum / 2);
  }
  minimum += remainder;
  const state = { minGallop: MIN_GALLOP, runs: [] };
  let low = 0;
  do {
    let length = naturalRun(values, low, values.length);
    if (length < minimum) {
      const force = Math.min(minimum, values.length - low);
      binarySort(values, low, low + force, low + length);
      length = force;
    }
    state.runs.push({ base: low, length });
    collapse(state, values, false);
    low += length;
  } while (low < values.length);
  collapse(state, values, true);
  return values;
}

/** Internal source-record array seam for StackingNurfedAttribute's sorted().
 * Supported builtin None/bool/int/long/float classes use Python comparisons;
 * infinities and signed zero are supported. Without NaN these form the same
 * stable total ordering at any length. With NaN, stability alone is insufficient:
 * installed CPython2.7.1 and V8 merge schedules produce different orders.
 * cdxstackingsortagent1 retains original builtin counterexamples and sources.
 * For NaN lists use the original natural runs, binary insertion, old merge
 * schedule, directional gallops and adaptive min_gallop. Primary authority is
 * CPython v2.7.1 Objects/listobject.c1040-1862/2120-2165; retained original
 * runtime comparisons are cdxfullfactorsortagent1. No custom comparator/key,
 * rich-comparison object, arbitrary iterable or allocator/GC parity is claimed.
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
  return nativeSort(result);
}

module.exports = { sortClientDogmaAttributeFactors };
