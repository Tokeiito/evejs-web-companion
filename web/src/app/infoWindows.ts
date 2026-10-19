import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";
import type { InfoIdentity, InfoOpenOptions, InfoSubject } from "../bridge/infoWindow.ts";
import { createInfoReadScope, type InfoReadScope } from "./infoReadScope.ts";

interface Entry { readonly request: InfoSubject; readonly subject: InfoSubject; readonly identity: InfoIdentity }
export interface InfoWindowState {
  readonly id: number;
  readonly entry: Entry;
  readonly subject: ReadableSignal<InfoSubject | null>;
  readonly history: readonly Entry[];
  readonly index: number;
  /** Ordinary content: ConstructLayout/ReconstructSubContainer flush old controls. */
  readonly reconstruction: number;
  readonly reads: InfoReadScope;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly z: number; readonly minimized: boolean; readonly modal: boolean;
}

/** infosvc.ShowInfo412-454, HistoryBuffer and InfoWindow.NavigateHistory75-86.
 * Windows stay in registration order; focus must never reorder that list. */
export function createInfoWindows(deps: {
  resolve(subject: InfoSubject): Promise<InfoIdentity | null>;
  reuse(): boolean;
  shift(): boolean;
}) {
  const state = createSignal<readonly InfoWindowState[]>([]);
  const raised = createSignal<{ readonly n: number; readonly id: number } | null>(null);
  const subjects = new Map<number, ReturnType<typeof createSignal<InfoSubject | null>>>();
  let serial = 0, raisedSerial = 0, generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const update = (id: number, change: (w: InfoWindowState) => InfoWindowState): void => {
    state.update(windows => windows.map(w => w.id === id ? change(w) : w));
  };
  const requestRaise = (id: number): void => { raised.set({ n: ++raisedSerial, id }); };
  function reconstruct(w: InfoWindowState, entry: Entry, branch: boolean, directHistory = false): void {
    let history = w.history;
    let index = w.index;
    if (branch) { history = [...history.slice(0, index + 1), entry]; index = history.length - 1; }
    else { history = history.map((e, i) => i === index ? entry : e); }
    w.reads.retireRegistered();
    const epoch = generation;
    const reads = createInfoReadScope(() => epoch === generation, !directHistory);
    subjects.get(w.id)?.set({ ...entry.subject });
    update(w.id, current => ({ ...current, entry, history, index, reads,
      reconstruction: current.reconstruction + (entry.identity.content === "ship" ? 0 : 1), minimized: false }));
    requestRaise(w.id);
  }
  function show(subject: InfoSubject, options: InfoOpenOptions = {}): Promise<number | null> {
    const epoch = generation;
    const shift = options.shift ?? deps.shift();
    const reuse = deps.reuse();
    // Preserve every synchronous multi-menu request; a signal/effect alone
    // would collapse several subjects into only the last one.
    const result = queue.then(async () => {
      if (epoch !== generation) return null;
      const identity = await deps.resolve(subject);
      if (epoch !== generation || identity === null) return null;
      const normalized = identity.itemID !== null
        ? identity.content === "character" ? { kind: "character" as const, characterID: identity.itemID }
          : identity.content === "corporation" ? { kind: "corporation" as const, corporationID: identity.itemID }
          : identity.typeID === 16159 ? { kind: "alliance" as const, allianceID: identity.itemID }
            : identity.typeID === 30 ? { kind: "faction" as const, factionID: identity.itemID } : subject
        : subject;
      const entry: Entry = { request: subject, subject: normalized, identity };
      const bucket = identity.content === "ship" ? "ship" : "ordinary";
      const windows = state.get();
      const modal = !!options.modal || !!options.progressModal || windows.some(w => w.modal && !w.minimized);
      const existing = windows.filter(w => (w.entry.identity.content === "ship" ? "ship" : "ordinary") === bucket).at(-1);
      const create = options.new || options.addNewWindow || !reuse || shift || modal || !existing;
      if (create) {
        const id = ++serial, signal = createSignal<InfoSubject | null>({ ...normalized });
        subjects.set(id, signal);
        const offset = (windows.length % 8) * 24;
        const w: InfoWindowState = { id, entry, subject: readonlySignal(signal), history: [entry], index: 0, reconstruction: 1,
          reads: createInfoReadScope(() => epoch === generation),
          x: 16 + offset, y: 16 + offset, w: 500, h: 600,
          z: Math.max(0, ...windows.map(w => w.z)) + 1, minimized: false,
          modal: modal && !options.progressModal };
        state.set([...windows, w]); requestRaise(id); return id;
      }
      const duplicate = existing.entry.identity.typeID === identity.typeID && existing.entry.identity.itemID === identity.itemID;
      // A duplicate modern window does not reconstruct OR maximize here.
      if (duplicate && identity.content !== "legacy") return existing.id;
      reconstruct(existing, entry, !options.traversingHistory && !duplicate);
      return existing.id;
    });
    queue = result.catch(() => {});
    return result;
  }
  return {
    state: readonlySignal(state), raised: readonlySignal(raised), show,
    focus(id: number, top?: number): void {
      const z = top ?? Math.max(0, ...state.get().map(w => w.z)) + 1;
      update(id, w => ({ ...w, z }));
    },
    close(id: number): void { state.get().find(w => w.id === id)?.reads.retireRegistered(); subjects.delete(id); state.update(windows => windows.filter(w => w.id !== id)); },
    minimize(id: number): void {
      const w = state.get().find(w => w.id === id); if (!w) return;
      update(id, current => ({ ...current, minimized: !current.minimized }));
      if (w.minimized) requestRaise(id);
    },
    geometry(id: number, place: { x: number; y: number; w: number; h: number }): void {
      const old = state.get().find(w => w.id === id);
      if (old && Object.entries(place).some(([k, v]) => old[k as keyof typeof place] !== v)) update(id, w => ({ ...w, ...place }));
    },
    async navigate(id: number, direction: -1 | 1, shift = false): Promise<void> {
      const w = state.get().find(w => w.id === id); if (!w) return;
      // InfoWindow.OnBack/OnForward ignore input during ordinary reconstruction.
      // Ship history has no such guard. Only content-owned reads mark this flag.
      if (w.entry.identity.content !== "ship" && w.reads.loading.get()) return;
      const history = w.history.map((e, i) => i === w.index ? w.entry : e);
      const index = w.index + direction, entry = history[index]; if (!entry) return;
      update(id, current => ({ ...current, history, index }));
      const current = state.get().find(w => w.id === id)!;
      if (w.entry.identity.content === entry.identity.content) reconstruct(current, entry, false, entry.identity.content !== "ship");
      else await show(entry.request, { traversingHistory: true, shift });
    },
    reset(): void { generation++; subjects.clear(); state.set([]); raised.set(null); queue = Promise.resolve(); },
  };
}
export type InfoWindows = ReturnType<typeof createInfoWindows>;
