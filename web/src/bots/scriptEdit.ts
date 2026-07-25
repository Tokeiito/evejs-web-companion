// C (pure part) — the editor's operations on a program, as pure array transforms.
// The Svelte editor (later, live) calls these; here they are plain functions with
// a node --test file, so the reorder/insert/delete logic is proven without a DOM.
//
// ⚠ TWO STRUCTURAL RULES ARE ENFORCED HERE, NOT LEFT TO THE UI:
//   • The safety floor cannot be deleted (decision 3). `removeInterrupt` refuses
//     it, so no sequence of clicks can produce a bot with no health cut-off.
//   • A loop cannot be left with an empty body (the codec would refuse it, and an
//     empty loop is a no-op). Removing a loop's last step removes the loop.
//
// Everything is immutable: each function returns a new array, never mutating its
// input, so the editor can keep an undo/draft history cheaply.

import type {
  Condition,
  InterruptResponse,
  InterruptRow,
  LoopBlock,
  MacroID,
  LoopBodyNode,
  MacroStep,
  ProgramNode,
} from "./botScript.ts";

/** Supplies fresh unique handles. The editor passes a real generator; tests pass a counter. */
export type IdGen = () => string;

// ─── Making new pieces ───────────────────────────────────────────────────────

/** A blank macro step — its args are filled in by the inspector before it can start. */
export function newMacroStep(macro: MacroID, makeId: IdGen): MacroStep {
  return { id: makeId(), kind: "macro", macro, args: {} };
}

/** A new loop wrapping one step, bounded (10 passes) and visible — never forever by default. */
export function newLoop(firstStep: MacroStep, makeId: IdGen): LoopBlock {
  return { id: makeId(), kind: "loop", repeat: { kind: "times", count: 10 }, body: [firstStep] };
}

/** A new "always watching" row. */
export function newInterrupt(when: Condition, respond: InterruptResponse, makeId: IdGen): InterruptRow {
  return { id: makeId(), when, respond };
}

// ─── Generic array moves (shared by top-level nodes and loop bodies) ──────────

function insertAt<T>(arr: readonly T[], item: T, at?: number): readonly T[] {
  const idx = at === undefined ? arr.length : Math.max(0, Math.min(at, arr.length));
  return [...arr.slice(0, idx), item, ...arr.slice(idx)];
}

function removeAt<T>(arr: readonly T[], index: number): readonly T[] {
  if (index < 0 || index >= arr.length) {
    return arr;
  }
  return [...arr.slice(0, index), ...arr.slice(index + 1)];
}

function moveBy<T>(arr: readonly T[], index: number, delta: number): readonly T[] {
  const target = index + delta;
  if (index < 0 || index >= arr.length || target < 0 || target >= arr.length) {
    return arr;
  }
  const copy = arr.slice();
  const a = copy[index];
  const b = copy[target];
  if (a === undefined || b === undefined) {
    return arr;
  }
  copy[index] = b;
  copy[target] = a;
  return copy;
}

// ─── Cloning with fresh ids ──────────────────────────────────────────────────

function cloneWithFreshIds(node: ProgramNode, makeId: IdGen): ProgramNode {
  const cloned = structuredClone(node) as ProgramNode;
  if (cloned.kind === "loop") {
    return { ...cloned, id: makeId(), body: cloned.body.map((step) => ({ ...step, id: makeId() })) };
  }
  return { ...cloned, id: makeId() };
}

// ─── Top-level program operations ────────────────────────────────────────────

export function insertNode(program: readonly ProgramNode[], node: ProgramNode, at?: number): readonly ProgramNode[] {
  return insertAt(program, node, at);
}

export function removeNode(program: readonly ProgramNode[], index: number): readonly ProgramNode[] {
  return removeAt(program, index);
}

/** Move a node up (delta -1) or down (delta +1); a no-op at the edges. */
export function moveNode(program: readonly ProgramNode[], index: number, delta: number): readonly ProgramNode[] {
  return moveBy(program, index, delta);
}

/** Duplicate a node (deep, with fresh ids) directly after it. */
export function duplicateNode(program: readonly ProgramNode[], index: number, makeId: IdGen): readonly ProgramNode[] {
  const node = program[index];
  if (node === undefined) {
    return program;
  }
  return insertAt(program, cloneWithFreshIds(node, makeId), index + 1);
}

// ─── Loop body operations ────────────────────────────────────────────────────

function withLoopBody(
  program: readonly ProgramNode[],
  loopIndex: number,
  // A loop body holds steps AND branches, so these list ops are over the wider
  // element type; the callers below still insert plain steps.
  transform: (body: readonly LoopBodyNode[]) => readonly LoopBodyNode[],
): readonly ProgramNode[] {
  const node = program[loopIndex];
  if (node === undefined || node.kind !== "loop") {
    return program;
  }
  const body = transform(node.body);
  if (body.length === 0) {
    // A loop must keep at least one step — empty it and the loop goes with it.
    return removeAt(program, loopIndex);
  }
  return program.map((n, i) => (i === loopIndex ? { ...node, body } : n));
}

export function insertIntoLoop(
  program: readonly ProgramNode[],
  loopIndex: number,
  step: MacroStep,
  at?: number,
): readonly ProgramNode[] {
  return withLoopBody(program, loopIndex, (body) => insertAt(body, step, at));
}

export function removeFromLoop(
  program: readonly ProgramNode[],
  loopIndex: number,
  bodyIndex: number,
): readonly ProgramNode[] {
  return withLoopBody(program, loopIndex, (body) => removeAt(body, bodyIndex));
}

export function moveInLoop(
  program: readonly ProgramNode[],
  loopIndex: number,
  bodyIndex: number,
  delta: number,
): readonly ProgramNode[] {
  return withLoopBody(program, loopIndex, (body) => moveBy(body, bodyIndex, delta));
}

// ─── Interrupts ──────────────────────────────────────────────────────────────

export function addInterrupt(interrupts: readonly InterruptRow[], row: InterruptRow): readonly InterruptRow[] {
  return [...interrupts, row];
}

/**
 * Remove an interrupt — EXCEPT the safety floor, which is not deletable. Asking
 * to remove it returns the list unchanged, so no edit path can strip it.
 */
export function removeInterrupt(interrupts: readonly InterruptRow[], id: string): readonly InterruptRow[] {
  const row = interrupts.find((r) => r.id === id);
  if (row !== undefined && row.builtIn === "safety-floor") {
    return interrupts;
  }
  return interrupts.filter((r) => r.id !== id);
}

/** Set the threshold on a fraction-bearing interrupt (including the safety floor). */
export function setInterruptFraction(
  interrupts: readonly InterruptRow[],
  id: string,
  fraction: number,
): readonly InterruptRow[] {
  return interrupts.map((r) => {
    if (r.id !== id || !("fraction" in r.when)) {
      return r;
    }
    return { ...r, when: { ...r.when, fraction } };
  });
}
