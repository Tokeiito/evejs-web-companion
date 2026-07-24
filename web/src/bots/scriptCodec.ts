// A2 — the Bot Builder codec: the ONE gate every document passes through, from a
// paste, a file, the BFF, or localStorage, before anything trusts it.
//
// ⚠ EVERY BYTE IS UNTRUSTED — imported or stored. A script drives an unattended
// ship; a malformed one must never reach the runner. So this reads the raw value
// FIELD BY FIELD in the bridge-decoder style (own properties only, no spread, no
// copy), and answers in exactly two ways:
//
//   • REFUSE the whole file, with one plain sentence (R9a). There is NO
//     import-with-holes: a script with a silently dropped action is a different
//     program, and "every branch bounded" reasoning dies the moment a hole
//     exists. First failure refuses.
//   • ACCEPT, with WARNINGS for the things it safely fixed — an out-of-range
//     number clamped to the same bound the editor uses, control characters
//     stripped, an absurd saved location forgotten, a missing safety cut-off
//     added. Clamp-with-a-spoken-warning beats a silent clamp (dishonest) and a
//     refusal (hostile to a hand-edited share).
//
// The refusal and warning sentences are player-facing, so they are plain and —
// critically — they NEVER echo an attacker's string unsanitised (an unknown
// macro name is stripped to a short safe token before it is quoted). The safety
// floor is guaranteed here: a document that arrives without it leaves with it.

import {
  MAX_DOC_BYTES,
  MAX_INTERRUPTS,
  MAX_NAME_LEN,
  MAX_NOTES_LEN,
  MAX_ORE_HOLD_FRACTION,
  MAX_PROGRAM_NODES,
  MAX_REPEAT_TIMES,
  MAX_TOTAL_STEPS,
  INTERRUPT_RESPONSES,
  MAX_CONDITION_FRACTION,
  MAX_COUNT_ARG,
  MIN_CONDITION_FRACTION,
  MIN_COUNT_ARG,
  MIN_REPEAT_TIMES,
  ITEM_PLACES,
  SCRIPT_FORMAT,
  SCRIPT_VERSION,
  conditionAllowedAt,
  type Arg,
  type BeltArg,
  type BotScript,
  type Condition,
  type ConditionSite,
  type InterruptResponse,
  type InterruptRow,
  type ItemPlace,
  type LoopBlock,
  type MacroID,
  type MacroStep,
  type ProgramNode,
  type Repeat,
  type WorldEntity,
  type WorldRef,
} from "./botScript.ts";
import { MACRO_SPECS, type MacroSpec } from "./macroSpecs.ts";

// ─── Result ──────────────────────────────────────────────────────────────────

export type DecodeResult =
  | { readonly ok: true; readonly doc: BotScript; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly refusal: string };

// ─── What the codec knows a valid document may contain ───────────────────────
//
// The RUNTIME behaviour of each macro is a later slice (nav/macros); this is only
// the structural spec — which arguments a macro takes, and whether it must carry
// an `until`. It lives with the codec because "what a valid file may hold" is the
// codec's question, and a macro added to the runner without a spec entry here
// simply cannot be imported until it gets one.

const KNOWN_MACROS = new Set<string>(Object.keys(MACRO_SPECS));
// Derived from the format's own list, so a new response can never be forgotten here.
const KNOWN_RESPONSES = new Set<InterruptResponse>(INTERRUPT_RESPONSES);
const WORLD_ENTITIES = new Set<WorldEntity>(["station", "belt", "agent", "system"]);
const DOC_KEYS = new Set(["format", "version", "name", "notes", "home", "interrupts", "program"]);

const MAX_ID_LEN = 40;
const MAX_WORLD_NAME_LEN = 100;
const MAX_ECHO_LEN = 24;

// ─── Player sentences ────────────────────────────────────────────────────────

const SAY = {
  tooBig: "This file is too big to be a bot script.",
  notJson: "This file is not a bot script.",
  notObject: "This file is not a bot script.",
  wrongFormat: "This file is not a bot script.",
  newerVersion:
    "This script was made with a newer version of the Bot Builder. Update this app, or export the script again from the version you are running.",
  badVersion: "This file is not a bot script.",
  unknownKey: "This script has parts this app does not recognise.",
  noName: "This script has no name.",
  noHome: "This script does not say which station to dock at when it breaks off.",
  emptyProgram: "This script has no steps.",
  tooManyNodes: "This script has too many steps.",
  tooManySteps: "This script has too many steps.",
  tooManyInterrupts: "This script is watching for too many things at once.",
  unknownNode: "This script has a step this app does not understand.",
  unknownMacro: (safe: string): string =>
    safe.length > 0
      ? `This script uses an action this app does not have: "${safe}".`
      : "This script uses an action this app does not have.",
  unknownCondition: "This script uses a check this app does not have.",
  conditionOffSite:
    "This script checks for something out in space at a point where the ship may not be there yet.",
  missingArg: (label: string): string => `A step is missing something it needs: ${label}.`,
  unknownArg: "A step has a setting this app does not recognise.",
  badArg: (label: string): string => `A step's ${label} is not set up correctly.`,
  badNumber: "A number in this script is not a real number.",
  untilRequired: "A mining step must say when to stop.",
  noRepeat: "Every loop must say how many times it may repeat.",
  emptyLoop: "A loop has no steps inside it.",
  nestedLoop: "A loop cannot contain another loop.",
  badResponse: "This script answers a warning in a way this app does not know.",
} as const;

const WARN = {
  strippedControl: "Removed some characters from a name that cannot be shown.",
  clampFraction: (label: string, toFraction: number): string =>
    `${label} was brought back to ${Math.round(toFraction * 100)}%.`,
  clampRepeat: (to: number): string => `A loop's repeat count was brought into range (now ${to}).`,
  clampCount: (label: string, to: number): string => `A step's ${label} was brought into range (now ${to}).`,
  forgotWorldId: "A saved location did not look valid and was forgotten — pick it again.",
  reassignedIds: "Renamed some step handles that were missing or repeated.",
} as const;

// ─── Refusal as control flow ─────────────────────────────────────────────────
// A first-failure-refuses reader is far clearer with an internal throw caught at
// the boundary than with a result monad threaded through forty helpers.

class ScriptRefusal extends Error {
  readonly sentence: string;
  constructor(sentence: string) {
    super(sentence);
    this.name = "ScriptRefusal";
    this.sentence = sentence;
  }
}
function refuse(sentence: string): never {
  throw new ScriptRefusal(sentence);
}

interface Ctx {
  warn(sentence: string): void;
}

// ─── Entry points ────────────────────────────────────────────────────────────

/** Decode from raw TEXT (a paste, a file, a localStorage string). Caps bytes before parsing. */
export function decodeScriptText(text: string): DecodeResult {
  if (byteLength(text) > MAX_DOC_BYTES) {
    return { ok: false, refusal: SAY.tooBig };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, refusal: SAY.notJson };
  }
  return decodeScriptValue(raw);
}

/** Decode from an already-parsed value (a BFF row, a bundled template). */
export function decodeScriptValue(raw: unknown): DecodeResult {
  const warnings: string[] = [];
  const ctx: Ctx = { warn: (s) => warnings.push(s) };
  try {
    const doc = readDocument(raw, ctx);
    return { ok: true, doc, warnings };
  } catch (err) {
    if (err instanceof ScriptRefusal) {
      return { ok: false, refusal: err.sentence };
    }
    // A reader threw something unexpected — treat the file as unreadable rather
    // than leaking a stack. This should not happen; the readers refuse cleanly.
    return { ok: false, refusal: SAY.notObject };
  }
}

/**
 * Serialise a document to stable, diff-able text — fixed key order, two-space
 * indent. Storage metadata never lives in a ScriptDoc, so there is nothing to
 * strip; what goes out is exactly the shareable document.
 */
export function encodeScriptDoc(doc: BotScript): string {
  return JSON.stringify(orderDoc(doc), null, 2);
}

// ─── Document ────────────────────────────────────────────────────────────────

function readDocument(raw: unknown, ctx: Ctx): BotScript {
  const obj = asObject(raw, SAY.notObject);

  for (const key of Object.keys(obj)) {
    if (!DOC_KEYS.has(key)) {
      refuse(SAY.unknownKey);
    }
  }

  if (obj["format"] !== SCRIPT_FORMAT) {
    refuse(SAY.wrongFormat);
  }

  const version = obj["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    refuse(SAY.badVersion);
  }
  if (version > SCRIPT_VERSION) {
    refuse(SAY.newerVersion);
  }
  // version < SCRIPT_VERSION would migrate here; v1 is the first, so no file can
  // carry a lower version and there is nothing to migrate yet.

  const name = readText(obj["name"], { min: 1, max: MAX_NAME_LEN, allowNewline: false }, ctx, SAY.noName);
  const notes =
    obj["notes"] === undefined
      ? ""
      : readText(obj["notes"], { min: 0, max: MAX_NOTES_LEN, allowNewline: true }, ctx, SAY.notObject);
  // A missing home defaults to the starting station — the portable default that
  // needs no picking. A present home is read normally (chosen / starting / unbound).
  const home =
    obj["home"] === undefined
      ? { entity: "station" as const, id: null, name: null, systemName: null, starting: true }
      : readWorldRef(obj["home"], "station", ctx, SAY.noHome);
  const interrupts = readInterrupts(obj["interrupts"], ctx);
  const program = readProgram(obj["program"], ctx);

  const doc: BotScript = {
    format: SCRIPT_FORMAT,
    version: SCRIPT_VERSION,
    name,
    notes,
    home,
    interrupts,
    program,
  };
  return withValidIds(doc, ctx);
}

// ─── Interrupts, and the guaranteed safety floor ─────────────────────────────

function readInterrupts(raw: unknown, ctx: Ctx): readonly InterruptRow[] {
  const arr = asArray(raw, SAY.notObject);
  if (arr.length > MAX_INTERRUPTS) {
    refuse(SAY.tooManyInterrupts);
  }
  return arr.map((row) => readInterruptRow(row, ctx));
}

function readInterruptRow(raw: unknown, ctx: Ctx): InterruptRow {
  const obj = asObject(raw, SAY.notObject);
  const id = readRawId(obj["id"]);
  const when = readCondition(obj["when"], "interrupt", ctx);
  const respond = obj["respond"];
  if (typeof respond !== "string" || !KNOWN_RESPONSES.has(respond as InterruptResponse)) {
    refuse(SAY.badResponse);
  }
  // `builtIn` is legacy (the old auto-injected safety floor). It is still accepted
  // so old files load, but nothing injects or requires it — watches are entirely
  // the player's now.
  const builtIn = obj["builtIn"];
  if (builtIn !== undefined && builtIn !== "safety-floor") {
    refuse(SAY.unknownKey);
  }
  const row: InterruptRow =
    builtIn === "safety-floor"
      ? { id, when, respond: respond as InterruptResponse, builtIn: "safety-floor" }
      : { id, when, respond: respond as InterruptResponse };
  return row;
}

// ─── Program ─────────────────────────────────────────────────────────────────

function readProgram(raw: unknown, ctx: Ctx): readonly ProgramNode[] {
  const arr = asArray(raw, SAY.notObject);
  if (arr.length === 0) {
    refuse(SAY.emptyProgram);
  }
  if (arr.length > MAX_PROGRAM_NODES) {
    refuse(SAY.tooManyNodes);
  }
  const program = arr.map((node) => readProgramNode(node, ctx));

  let steps = 0;
  for (const node of program) {
    steps += node.kind === "loop" ? node.body.length : 1;
  }
  if (steps > MAX_TOTAL_STEPS) {
    refuse(SAY.tooManySteps);
  }
  return program;
}

function readProgramNode(raw: unknown, ctx: Ctx): ProgramNode {
  const obj = asObject(raw, SAY.unknownNode);
  const kind = obj["kind"];
  if (kind === "macro") {
    return readMacroStep(obj, ctx);
  }
  if (kind === "loop") {
    return readLoopBlock(obj, ctx);
  }
  return refuse(SAY.unknownNode);
}

function readMacroStep(obj: Readonly<Record<string, unknown>>, ctx: Ctx): MacroStep {
  const id = readRawId(obj["id"]);
  const macro = obj["macro"];
  if (typeof macro !== "string" || !KNOWN_MACROS.has(macro)) {
    refuse(SAY.unknownMacro(safeToken(macro)));
  }
  const spec = MACRO_SPECS[macro as MacroID];
  const args = readArgs(obj["args"], spec, ctx);

  let until: Condition | undefined;
  if (obj["until"] !== undefined) {
    until = readCondition(obj["until"], "until", ctx);
  } else if (spec.untilRequired) {
    refuse(SAY.untilRequired);
  }

  return until === undefined
    ? { id, kind: "macro", macro: macro as MacroID, args }
    : { id, kind: "macro", macro: macro as MacroID, args, until };
}

function readArgs(
  raw: unknown,
  spec: MacroSpec,
  ctx: Ctx,
): Readonly<Record<string, Arg>> {
  const obj = raw === undefined ? {} : asObject(raw, SAY.unknownArg);
  const allowed = new Set(spec.args.map((a) => a.key));
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      refuse(SAY.unknownArg);
    }
  }
  const out: Record<string, Arg> = {};
  for (const argSpec of spec.args) {
    const value = obj[argSpec.key];
    if (value === undefined) {
      if (argSpec.required) {
        refuse(SAY.missingArg(argSpec.key));
      }
      continue;
    }
    out[argSpec.key] = readArg(value, argSpec.kind, argSpec.key, ctx);
  }
  return out;
}

function readArg(raw: unknown, expected: Arg["kind"], label: string, ctx: Ctx): Arg {
  const obj = asObject(raw, SAY.badArg(label));
  if (obj["kind"] !== expected) {
    refuse(SAY.badArg(label));
  }
  if (expected === "belt") {
    return { kind: "belt", belt: readBelt(obj["belt"], label, ctx) };
  }
  if (expected === "station") {
    return { kind: "station", ref: readWorldRef(obj["ref"], "station", ctx, SAY.badArg(label)) };
  }
  if (expected === "agent") {
    return { kind: "agent", ref: readWorldRef(obj["ref"], "agent", ctx, SAY.badArg(label)) };
  }
  if (expected === "count") {
    const value = obj["value"];
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      refuse(SAY.badArg(label));
    }
    // Out-of-range counts CLAMP with a warning (the number rule the thresholds
    // follow) rather than refusing the whole file over an editable number.
    const clamped = Math.min(MAX_COUNT_ARG, Math.max(MIN_COUNT_ARG, value));
    if (clamped !== value) {
      ctx.warn(WARN.clampCount(label, clamped));
    }
    return { kind: "count", value: clamped };
  }
  if (expected === "fitting") {
    const id = obj["fittingID"];
    if (id !== null && id !== undefined && (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) {
      refuse(SAY.badArg(label));
    }
    const nameRaw = obj["name"];
    const name =
      nameRaw === null || nameRaw === undefined
        ? null
        : readText(nameRaw, { min: 0, max: MAX_WORLD_NAME_LEN, allowNewline: false }, ctx, SAY.badArg(label));
    return { kind: "fitting", fittingID: id === null || id === undefined ? null : (id as number), name };
  }
  if (expected === "itemType") {
    const id = obj["typeID"];
    if (id !== null && id !== undefined && (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) {
      refuse(SAY.badArg(label));
    }
    const nameRaw = obj["name"];
    const name =
      nameRaw === null || nameRaw === undefined
        ? null
        : readText(nameRaw, { min: 0, max: MAX_WORLD_NAME_LEN, allowNewline: false }, ctx, SAY.badArg(label));
    return { kind: "itemType", typeID: id === null || id === undefined ? null : (id as number), name };
  }
  if (expected === "place") {
    const place = obj["place"];
    if (typeof place !== "string" || !ITEM_PLACES.includes(place as ItemPlace)) {
      refuse(SAY.badArg(label));
    }
    return { kind: "place", place: place as ItemPlace };
  }
  if (expected === "bookmark") {
    const id = obj["bookmarkID"];
    if (id !== null && id !== undefined && (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) {
      refuse(SAY.badArg(label));
    }
    const nameRaw = obj["name"];
    const name =
      nameRaw === null || nameRaw === undefined
        ? null
        : readText(nameRaw, { min: 0, max: MAX_WORLD_NAME_LEN, allowNewline: false }, ctx, SAY.badArg(label));
    return { kind: "bookmark", bookmarkID: id === null || id === undefined ? null : (id as number), name };
  }
  if (expected === "corp") {
    const id = obj["id"];
    if (id !== null && (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)) {
      refuse(SAY.badArg(label));
    }
    const nameRaw = obj["name"];
    const name =
      nameRaw === null || nameRaw === undefined
        ? null
        : readText(nameRaw, { min: 0, max: MAX_WORLD_NAME_LEN, allowNewline: false }, ctx, SAY.badArg(label));
    return { kind: "corp", id: id === null || id === undefined ? null : id, name };
  }
  // equipment
  const equip = asObject(obj["equipment"], SAY.badArg(label));
  const groupID = equip["groupID"];
  if (typeof groupID !== "number" || !Number.isSafeInteger(groupID) || groupID <= 0) {
    refuse(SAY.badArg(label));
  }
  const equipLabel = readText(equip["label"], { min: 0, max: MAX_WORLD_NAME_LEN, allowNewline: false }, ctx, SAY.badArg(label));
  return { kind: "equipment", equipment: { groupID, label: equipLabel } };
}

function readBelt(raw: unknown, label: string, ctx: Ctx): BeltArg {
  const obj = asObject(raw, SAY.badArg(label));
  const mode = obj["mode"];
  if (mode === "nearest") {
    return { mode: "nearest" };
  }
  if (mode === "chosen") {
    return { mode: "chosen", ref: readWorldRef(obj["ref"], "belt", ctx, SAY.badArg(label)) };
  }
  return refuse(SAY.badArg(label));
}

// ─── Loop blocks ─────────────────────────────────────────────────────────────

function readLoopBlock(obj: Readonly<Record<string, unknown>>, ctx: Ctx): LoopBlock {
  const id = readRawId(obj["id"]);
  const repeat = readRepeat(obj["repeat"], ctx);

  let until: Condition | undefined;
  if (obj["until"] !== undefined) {
    until = readCondition(obj["until"], "until", ctx);
  }

  const bodyRaw = asArray(obj["body"], SAY.emptyLoop);
  if (bodyRaw.length === 0) {
    refuse(SAY.emptyLoop);
  }
  const body = bodyRaw.map((node) => {
    const nodeObj = asObject(node, SAY.unknownNode);
    if (nodeObj["kind"] === "loop") {
      refuse(SAY.nestedLoop);
    }
    if (nodeObj["kind"] !== "macro") {
      refuse(SAY.unknownNode);
    }
    return readMacroStep(nodeObj, ctx);
  });

  return until === undefined
    ? { id, kind: "loop", repeat, body }
    : { id, kind: "loop", repeat, until, body };
}

function readRepeat(raw: unknown, ctx: Ctx): Repeat {
  const obj = asObject(raw, SAY.noRepeat);
  const kind = obj["kind"];
  if (kind === "forever") {
    return { kind: "forever" };
  }
  if (kind === "times") {
    const count = obj["count"];
    if (typeof count !== "number" || !Number.isFinite(count)) {
      refuse(SAY.noRepeat);
    }
    let n = Math.trunc(count);
    if (n < MIN_REPEAT_TIMES) {
      n = MIN_REPEAT_TIMES;
      ctx.warn(WARN.clampRepeat(n));
    } else if (n > MAX_REPEAT_TIMES) {
      n = MAX_REPEAT_TIMES;
      ctx.warn(WARN.clampRepeat(n));
    }
    return { kind: "times", count: n };
  }
  return refuse(SAY.noRepeat);
}

// ─── Conditions ──────────────────────────────────────────────────────────────

function readCondition(raw: unknown, site: ConditionSite, ctx: Ctx): Condition {
  const obj = asObject(raw, SAY.unknownCondition);
  const kind = obj["kind"];

  const condition = buildCondition(obj, kind, ctx);
  if (!conditionAllowedAt(condition.kind, site)) {
    refuse(SAY.conditionOffSite);
  }
  return condition;
}

function buildCondition(obj: Readonly<Record<string, unknown>>, kind: unknown, ctx: Ctx): Condition {
  switch (kind) {
    case "hold-empty":
      return { kind: "hold-empty" };
    case "hostile-on-grid":
      return { kind: "hostile-on-grid" };
    case "ore-hold-at-least":
      return {
        kind: "ore-hold-at-least",
        fraction: readFraction(obj["fraction"], MIN_CONDITION_FRACTION, MAX_ORE_HOLD_FRACTION, "The ore-hold level", ctx),
      };
    case "shield-below":
    case "armor-below":
    case "hull-below":
    case "health-below":
    case "capacitor-below":
      return {
        kind,
        fraction: readFraction(obj["fraction"], MIN_CONDITION_FRACTION, MAX_CONDITION_FRACTION, thresholdLabel(kind), ctx),
      };
    default:
      return refuse(SAY.unknownCondition);
  }
}

function thresholdLabel(
  kind: "shield-below" | "armor-below" | "hull-below" | "health-below" | "capacitor-below",
): string {
  switch (kind) {
    case "shield-below":
      return "The shield threshold";
    case "armor-below":
      return "The armor threshold";
    case "hull-below":
      return "The hull threshold";
    case "health-below":
      return "The ship-health threshold";
    case "capacitor-below":
      return "The capacitor threshold";
  }
}

// ─── World references ────────────────────────────────────────────────────────

function readWorldRef(raw: unknown, expected: WorldEntity, ctx: Ctx, refuseSentence: string): WorldRef {
  const obj = asObject(raw, refuseSentence);
  const entity = obj["entity"];
  if (typeof entity !== "string" || !WORLD_ENTITIES.has(entity as WorldEntity) || entity !== expected) {
    refuse(refuseSentence);
  }

  let id: number | null = null;
  const rawId = obj["id"];
  if (rawId === null || rawId === undefined) {
    id = null;
  } else if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    id = rawId;
  } else {
    id = null;
    ctx.warn(WARN.forgotWorldId);
  }

  const name = readNullableText(obj["name"], MAX_WORLD_NAME_LEN, ctx);
  const systemName = readNullableText(obj["systemName"], MAX_WORLD_NAME_LEN, ctx);
  // "starting" (station only) is included only when literally true, so a plain
  // chosen/unbound ref round-trips without an extra field.
  if (expected === "station" && obj["starting"] === true) {
    return { entity: "station", id: null, name, systemName, starting: true };
  }
  return { entity: expected, id, name, systemName };
}

// ─── Ids ─────────────────────────────────────────────────────────────────────
// Ids are local handles, referenced by nothing in the format. Read what came,
// then a single pass guarantees they are non-empty and unique — reassigning all
// of them deterministically if any is bad, so a hostile duplicate cannot make
// two rows indistinguishable and a hand-edited file need not invent them.

function readRawId(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return stripControl(raw, false).slice(0, MAX_ID_LEN);
}

function withValidIds(doc: BotScript, ctx: Ctx): BotScript {
  const ids: string[] = [];
  for (const row of doc.interrupts) {
    ids.push(row.id);
  }
  for (const node of doc.program) {
    ids.push(node.id);
    if (node.kind === "loop") {
      for (const step of node.body) {
        ids.push(step.id);
      }
    }
  }
  const clean = ids.every((id) => id.length > 0) && new Set(ids).size === ids.length;
  if (clean) {
    return doc;
  }
  ctx.warn(WARN.reassignedIds);

  let n = 0;
  const nextId = (): string => `n${(n += 1)}`;
  const interrupts = doc.interrupts.map((row) => ({ ...row, id: nextId() }));
  const program = doc.program.map((node) =>
    node.kind === "loop"
      ? { ...node, id: nextId(), body: node.body.map((step) => ({ ...step, id: nextId() })) }
      : { ...node, id: nextId() },
  );
  return { ...doc, interrupts, program };
}

// ─── Primitive readers ───────────────────────────────────────────────────────

function asObject(raw: unknown, refuseSentence: string): Readonly<Record<string, unknown>> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    refuse(refuseSentence);
  }
  // Own enumerable properties only — a `__proto__` or `constructor` key is just
  // an unknown key to be rejected by whatever validates this object's key set;
  // it is never followed.
  return raw as Readonly<Record<string, unknown>>;
}

function asArray(raw: unknown, refuseSentence: string): readonly unknown[] {
  if (!Array.isArray(raw)) {
    refuse(refuseSentence);
  }
  return raw;
}

interface TextSpec {
  readonly min: number;
  readonly max: number;
  readonly allowNewline: boolean;
}

function readText(raw: unknown, spec: TextSpec, ctx: Ctx, refuseSentence: string): string {
  if (typeof raw !== "string") {
    refuse(refuseSentence);
  }
  const cleaned = stripControl(raw, spec.allowNewline);
  if (cleaned !== raw) {
    ctx.warn(WARN.strippedControl);
  }
  const trimmed = cleaned.trim().slice(0, spec.max);
  if (trimmed.length < spec.min) {
    refuse(refuseSentence);
  }
  return trimmed;
}

function readNullableText(raw: unknown, max: number, ctx: Ctx): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = stripControl(raw, false);
  if (cleaned !== raw) {
    ctx.warn(WARN.strippedControl);
  }
  const trimmed = cleaned.trim().slice(0, max);
  return trimmed.length === 0 ? null : trimmed;
}

function readFraction(raw: unknown, min: number, max: number, label: string, ctx: Ctx): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    refuse(SAY.badNumber);
  }
  if (raw < min) {
    ctx.warn(WARN.clampFraction(label, min));
    return min;
  }
  if (raw > max) {
    ctx.warn(WARN.clampFraction(label, max));
    return max;
  }
  return raw;
}

function stripControl(text: string, allowNewline: boolean): string {
  // Drop C0/C1 control characters and bidi overrides that could reshape a line on
  // screen. Tab/newline/carriage-return are kept only where a field allows them.
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (allowNewline && (code === 0x09 || code === 0x0a || code === 0x0d)) {
      out += ch;
      continue;
    }
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBidi =
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    if (isControl || isBidi) {
      continue;
    }
    out += ch;
  }
  return out;
}

/** A hostile string, reduced to a short safe token before it may be quoted on screen. */
function safeToken(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, MAX_ECHO_LEN);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ─── Stable serialisation ────────────────────────────────────────────────────

function orderDoc(doc: BotScript): unknown {
  return {
    format: doc.format,
    version: doc.version,
    name: doc.name,
    notes: doc.notes,
    home: orderRef(doc.home),
    interrupts: doc.interrupts.map(orderInterrupt),
    program: doc.program.map(orderNode),
  };
}

function orderRef(ref: WorldRef): unknown {
  const base: Record<string, unknown> = { entity: ref.entity, id: ref.id, name: ref.name, systemName: ref.systemName };
  if (ref.starting === true) {
    base["starting"] = true;
  }
  return base;
}

function orderCondition(condition: Condition): unknown {
  return "fraction" in condition
    ? { kind: condition.kind, fraction: condition.fraction }
    : { kind: condition.kind };
}

function orderInterrupt(row: InterruptRow): unknown {
  const base: Record<string, unknown> = {
    id: row.id,
    when: orderCondition(row.when),
    respond: row.respond,
  };
  if (row.builtIn !== undefined) {
    base["builtIn"] = row.builtIn;
  }
  return base;
}

function orderArg(arg: Arg): unknown {
  switch (arg.kind) {
    case "belt":
      return arg.belt.mode === "nearest"
        ? { kind: "belt", belt: { mode: "nearest" } }
        : { kind: "belt", belt: { mode: "chosen", ref: orderRef(arg.belt.ref) } };
    case "station":
      return { kind: "station", ref: orderRef(arg.ref) };
    case "equipment":
      return { kind: "equipment", equipment: { groupID: arg.equipment.groupID, label: arg.equipment.label } };
  }
}

function orderArgs(args: Readonly<Record<string, Arg>>): unknown {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) {
    const arg = args[key];
    if (arg !== undefined) {
      out[key] = orderArg(arg);
    }
  }
  return out;
}

function orderRepeat(repeat: Repeat): unknown {
  return repeat.kind === "forever" ? { kind: "forever" } : { kind: "times", count: repeat.count };
}

function orderNode(node: ProgramNode): unknown {
  if (node.kind === "loop") {
    const base: Record<string, unknown> = {
      id: node.id,
      kind: "loop",
      repeat: orderRepeat(node.repeat),
    };
    if (node.until !== undefined) {
      base["until"] = orderCondition(node.until);
    }
    base["body"] = node.body.map(orderNode);
    return base;
  }
  const base: Record<string, unknown> = {
    id: node.id,
    kind: "macro",
    macro: node.macro,
    args: orderArgs(node.args),
  };
  if (node.until !== undefined) {
    base["until"] = orderCondition(node.until);
  }
  return base;
}
