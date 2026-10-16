// The probe formations, as the retail client keeps and makes them (probescanning/formations.py, formationTracker.py,
// probeTracker.py 34 to 43 and 148 to 182, util.py).
//
// A FORMATION is eight places about a centre, each with a size: Pinpoint, the centre, half a unit above and below,
// and five on a ring of half a unit, the unit 4 AU and each probe's size 4 AU; Spread, a quarter unit above and
// below and six on a ring of 0.75 + cos(asin(0.25)) units, the unit 16 AU and each size 16 AU.
//
// THE TRACKER (FormationTracker) holds the formation, its centre and which probe has which place. The probe tracker
// makes it Pinpoint about (0, 0, 0) as it starts. Each probe the server tells of (AddProbe) takes the first free
// place, and is sent to it (ProbeGoToPoint): where it is idle, its destination is the place and its range step the
// one whose range is nearest the place's size. A probe gone (RemoveProbe) frees its place.
//
// A FORMATION'S BUTTON (MoveProbesToFormation) refuses where the probes held and the charges loaded do not make
// eight; makes the formation anew about the centre of the idle probes' destinations ((0, 0, 0) where none is
// idle), the probes held taking places in their order; recalls any past eight; and else launches the active
// probes' shortfall from eight, which take the free places as they come.
//
// The destination and the range step are the client's own list's (SetProbeDestination, SetProbeRangeStep): the
// game port's transport keeps them and sends nothing, and the next RequestScans carries them.

export const AU = 149_597_870_700;
export const SPREAD_FORMATION = -1;
export const PINPOINT_FORMATION = -2;
export const PROBES_IN_A_FORMATION = 8;

export type Vec3 = readonly [number, number, number];

/** One place in a formation: its offset from the centre, in metres, and its probe's size. */
export interface FormationSpot {
  readonly offset: Vec3;
  readonly size: number;
}

function scaled(offsets: readonly Vec3[], unit: number): FormationSpot[] {
  return offsets.map(([x, y, z]) => ({ offset: [x * unit, y * unit, z * unit] as const, size: unit }));
}

/** formations._GetPinPointFormation. */
function pinpoint(): FormationSpot[] {
  const offsets: Vec3[] = [[0, 0, 0], [0, 0.5, 0], [0, -0.5, 0]];
  for (let i = 0; i < 5; i += 1) offsets.push([0.5 * Math.cos((i * 2 * Math.PI) / 5), 0, 0.5 * Math.sin((i * 2 * Math.PI) / 5)]);
  return scaled(offsets, 4 * AU);
}

/** formations._GetSpreadFormation. */
function spread(): FormationSpot[] {
  const vertDev = 0.25;
  const centerOffsetRadius = 0.75 + Math.cos(Math.asin(vertDev));
  const offsets: Vec3[] = [[0, vertDev, 0], [0, -vertDev, 0]];
  for (let i = 0; i < 6; i += 1) offsets.push([centerOffsetRadius * Math.cos((i * Math.PI) / 3), 0, centerOffsetRadius * Math.sin((i * Math.PI) / 3)]);
  return scaled(offsets, 16 * AU);
}

const FORMATIONS: Readonly<Record<number, readonly FormationSpot[]>> = Object.freeze({ [SPREAD_FORMATION]: spread(), [PINPOINT_FORMATION]: pinpoint() });

/** formations.GetFormation, for the two built in. */
export function formationSpots(formationID: number): readonly FormationSpot[] {
  return FORMATIONS[formationID] ?? [];
}

/** util.GetCenter: the mean of the positions; (0, 0, 0) for none. */
export function centerOf(positions: readonly Vec3[]): Vec3 {
  if (positions.length === 0) return [0, 0, 0];
  const sum = positions.reduce<[number, number, number]>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return [sum[0] / positions.length, sum[1] / positions.length, sum[2] / positions.length];
}

/** util.GetRangeStepAndSizeFromScanRange: the step (1 to 8) whose range is nearest, the first of equals. */
export function rangeStepFor(size: number, rangeSteps: readonly number[]): number | null {
  if (rangeSteps.length === 0) return null;
  let best = 0;
  for (let i = 1; i < rangeSteps.length; i += 1) {
    if (Math.abs(size - rangeSteps[i]!) < Math.abs(size - rangeSteps[best]!)) best = i;
  }
  return best + 1;
}

/** FormationTracker: the formation, its centre, and which probe has which place. */
export interface FormationState {
  readonly formationID: number;
  readonly center: Vec3;
  readonly slots: readonly (number | null)[];
}

/** ProbeTracker.__init__: Pinpoint about (0, 0, 0). */
export const INITIAL_FORMATION: FormationState = Object.freeze({
  formationID: PINPOINT_FORMATION,
  center: [0, 0, 0] as const,
  slots: Object.freeze(new Array<number | null>(PROBES_IN_A_FORMATION).fill(null)),
});

/** Where a probe is sent: its place and size (FormationTracker.GetPositionAndSize). */
export interface Placement {
  readonly probeID: number;
  readonly destination: Vec3;
  readonly size: number;
}

function placementAt(state: FormationState, probeID: number, index: number): Placement | null {
  const spot = formationSpots(state.formationID)[index];
  if (spot === undefined) return null;
  return { probeID, destination: [spot.offset[0] + state.center[0], spot.offset[1] + state.center[1], spot.offset[2] + state.center[2]], size: spot.size };
}

/** AddProbeToFormation: the first free place, or none. */
export function addProbeToFormation(state: FormationState, probeID: number): { readonly state: FormationState; readonly placement: Placement | null } {
  if (state.slots.includes(probeID)) return { state, placement: null };
  const index = state.slots.indexOf(null);
  if (index < 0) return { state, placement: null };
  const slots = [...state.slots];
  slots[index] = probeID;
  const next = { ...state, slots };
  return { state: next, placement: placementAt(next, probeID, index) };
}

/** RemoveProbeFromFormation. */
export function removeProbeFromFormation(state: FormationState, probeID: number): FormationState {
  return state.slots.includes(probeID) ? { ...state, slots: state.slots.map((id) => (id === probeID ? null : id)) } : state;
}

/** CreateFormation: the formation anew about its centre; the probes held take places in their order, the rest are excess. */
export function createFormation(formationID: number, probeIDs: readonly number[], center: Vec3): {
  readonly state: FormationState; readonly placements: readonly Placement[]; readonly excess: readonly number[];
} {
  const size = formationSpots(formationID).length;
  let state: FormationState = { formationID, center, slots: new Array<number | null>(size).fill(null) };
  const placements: Placement[] = [];
  for (const probeID of probeIDs.slice(0, size)) {
    const added = addProbeToFormation(state, probeID);
    state = added.state;
    if (added.placement !== null) placements.push(added.placement);
  }
  return { state, placements, excess: probeIDs.slice(size) };
}
