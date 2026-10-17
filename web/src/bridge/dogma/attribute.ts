// The client's dogma attribute (packages/dogma/attributes): how an attribute's value is reckoned from its base value
// and the modifiers that reach it. The first part of the page's own dogma, which the Fitting window's simulation (the
// client's ghost fitting: ghostFittingSvc, FittingDogmaLocation on baseDogmaLocation) reckons a ship with.
//
//   Attribute.Update           the base held between its floor and cap attributes' values (where it has them), the
//                              modifiers applied in the operators' precedence, then the floor and cap again; a whole
//                              number for the integer data types (categories 10, 11, 12); CPU and power rounded to two
//                              places (cpuLoad, powerLoad, powerOutput, cpuOutput, cpu, power)
//   the operators              dogma/const.py dgmOperators, in dgmOperatorPrecedence
//   StackingNurfedAttribute    an attribute whose static record is not stackable: in each operator's place, those of
//                              its modifiers that may be penalised (dgmNurfableOperations, from an item not of
//                              dgmUnnerfedCategories, not forceUnnurfed) are taken together: each made a factor
//                              (the operator on 1), sorted, those under 1 and those over 1 (the latter from the
//                              largest) each penalised in turn by NurfDenominators, and their product applied; the
//                              others as Attribute applies them
//   itemAttributeFactory       which class an attribute is (here: the stacking one where the static record is not
//                              stackable; the skill level, charged, heat, security and TiDi attributes are later parts)

/** dogma/const.py: the operators (dgmAss*). */
export const OP_PRE_ASSIGNMENT = -1;
export const OP_PRE_MUL = 0;
export const OP_PRE_DIV = 1;
export const OP_MOD_ADD = 2;
export const OP_MOD_SUB = 3;
export const OP_POST_MUL = 4;
export const OP_POST_DIV = 5;
export const OP_POST_PERCENT = 6;
export const OP_POST_ASSIGNMENT = 7;
export const OP_POST_PERCENT_UNNERFED = 8;

/** dgmOperatorPrecedence: the order the operators are applied in. */
export const OPERATOR_PRECEDENCE: readonly number[] = [
  OP_PRE_ASSIGNMENT, OP_PRE_MUL, OP_PRE_DIV, OP_MOD_ADD, OP_MOD_SUB, OP_POST_MUL, OP_POST_DIV, OP_POST_PERCENT,
  OP_POST_PERCENT_UNNERFED, OP_POST_ASSIGNMENT,
];

/** dgmOperators: each operator on the value so far and the modifying attribute's value. */
export function applyOperator(op: number, value: number, by: number): number {
  switch (op) {
    case OP_PRE_ASSIGNMENT:
    case OP_POST_ASSIGNMENT:
      return by;
    case OP_PRE_MUL:
    case OP_POST_MUL:
      return value * by;
    case OP_PRE_DIV:
    case OP_POST_DIV:
      return value / by;
    case OP_MOD_ADD:
      return value + by;
    case OP_MOD_SUB:
      return value - by;
    case OP_POST_PERCENT:
    case OP_POST_PERCENT_UNNERFED:
      return (value * (100 + by)) / 100;
    default:
      return value;
  }
}

/** dgmNurfableOperations: the operators a stacking penalty may fall on. */
const NURFABLE_OPERATIONS: ReadonlySet<number> = new Set([OP_PRE_MUL, OP_POST_MUL, OP_POST_PERCENT, OP_PRE_DIV, OP_POST_DIV]);
/** dgmUnnerfedCategories: skills, implants, ships, charges and subsystems (inventorycommon/const.py). */
const UNNERFED_CATEGORIES: ReadonlySet<number> = new Set([16, 20, 6, 8, 32]);
/** stackingNurfedAttribute.py: MAX_NURF_SEQUENCE_LENGTH and NurfDenominators, exp((i / 2.67) ** 2). */
const NURF_DENOMINATORS: readonly number[] = Array.from({ length: 8 }, (_, i) => Math.exp((i / 2.67) ** 2));

/** One modifier reaching an attribute: its operator, the modifying attribute's value, and where it comes from. */
export interface IncomingModifier {
  readonly op: number;
  readonly value: number;
  /** The modifying item's category (dgmUnnerfedCategories). */
  readonly fromCategoryID: number | null;
  /** forceUnnurfed on the modifying attribute. */
  readonly forceUnnurfed?: boolean;
}

/** StackingNurfedAttribute._ShouldNotNurf */
export function shouldNotNurf(modifier: IncomingModifier): boolean {
  if (!NURFABLE_OPERATIONS.has(modifier.op)) return true;
  if (modifier.fromCategoryID !== null && UNNERFED_CATEGORIES.has(modifier.fromCategoryID)) return true;
  return modifier.forceUnnurfed === true;
}

/** StackingOperator: a factor penalised by its place's denominator. */
function stackingOperator(factor: number, denominator: number): number {
  return (factor - 1.0) * (1.0 / denominator) + 1.0;
}

/**
 * The factor the penalised modifiers of one operator make together (StackingNurfedAttribute
 * _ApplyModifierOperationsToVal): each made a factor (the operator on 1), sorted; those not over 1 (bisect's split,
 * the smallest first) and those over 1 (the largest first) each penalised by the denominators in turn, as many as
 * there are of them (zip: past eight, none), and all multiplied.
 */
export function stackingFactor(op: number, values: readonly number[]): number {
  const factors = values.map((value) => applyOperator(op, 1, value)).sort((left, right) => left - right);
  // bisect.bisect(factors, 1.0): the place after every factor not over 1.
  let split = 0;
  while (split < factors.length && factors[split]! <= 1.0) split += 1;
  const below = factors.slice(0, split);
  const above = factors.slice(split).reverse();
  let product = 1;
  for (const [factor, denominator] of [...zipped(below), ...zipped(above)]) product *= stackingOperator(factor, denominator);
  return product;
}

/** izip(factors, NurfDenominators): as many pairs as the shorter has. */
function zipped(factors: readonly number[]): [number, number][] {
  return factors.slice(0, NURF_DENOMINATORS.length).map((factor, at) => [factor, NURF_DENOMINATORS[at]!]);
}

/** CPU and power attributes rounded to two places (Attribute.Update). */
const ROUNDED_ATTRIBUTES: ReadonlySet<number> = new Set([
  49, // cpuLoad
  15, // powerLoad
  11, // powerOutput
  48, // cpuOutput
  50, // cpu
  30, // power
]);

/** What Attribute.Update goes by, of an attribute and its static record. */
export interface AttributeFacts {
  readonly attributeID: number;
  readonly baseValue: number;
  /** The static record's stackable: where not, StackingNurfedAttribute. */
  readonly stackable: boolean;
  /** The static record's dataType (Attribute.category). */
  readonly dataType: number | null;
  /** The value of its maxAttributeID and minAttributeID attributes on the item, where it has them. */
  readonly cap?: number | null;
  readonly floor?: number | null;
}

/** Python's round(x, 2): to two places, halves away from nought (Python 2). */
function round2(value: number): number {
  const scaled = Math.abs(value) * 100;
  const rounded = Math.floor(scaled + 0.5);
  return (Math.sign(value) * rounded) / 100;
}

/**
 * Attribute.Update (and StackingNurfedAttribute's _ApplyModifierOperationsToVal where the attribute is not stackable):
 * the attribute's value from its base and the modifiers reaching it.
 */
export function attributeValue(facts: AttributeFacts, modifiers: readonly IncomingModifier[]): number {
  const cap = facts.cap ?? null;
  const floor = facts.floor ?? null;
  let base = facts.baseValue;
  if (cap !== null) base = Math.min(base, cap);
  if (floor !== null) base = Math.max(base, floor);
  let value = base;
  for (const op of OPERATOR_PRECEDENCE) {
    const mine = modifiers.filter((modifier) => modifier.op === op);
    if (mine.length === 0) continue;
    if (facts.stackable) {
      for (const modifier of mine) value = applyOperator(op, value, modifier.value);
      continue;
    }
    const plain = mine.filter(shouldNotNurf);
    const penalised = mine.filter((modifier) => !shouldNotNurf(modifier));
    for (const modifier of plain) value = applyOperator(op, value, modifier.value);
    if (penalised.length > 0) value *= stackingFactor(op, penalised.map((modifier) => modifier.value));
  }
  if (cap !== null) value = Math.min(value, cap);
  if (floor !== null) value = Math.max(value, floor);
  if (facts.dataType === 10 || facts.dataType === 11 || facts.dataType === 12) value = Math.trunc(value);
  if (ROUNDED_ATTRIBUTES.has(facts.attributeID)) value = round2(value);
  return value;
}
