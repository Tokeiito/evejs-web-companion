<script lang="ts">
  // THE BOT BUILDER — build a bot from ready-made BLOCKS (like Lego): an ordered
  // list of blocks that repeat as a whole, plus a row of "watches" that are
  // checked every moment. Built on the tested pure helpers (format, sentences,
  // validator, JSON codec), so what you see here is the logic the runner will run.
  //
  // Not yet wired (needs the live-session pass): the Start button. You can shape,
  // validate, and import/export a bot; running one comes next.

  import {
    type BotScript,
    type Condition,
    type ConditionKind,
    type InterruptResponse,
    type InterruptRow,
    type LoopBlock,
    type MacroID,
    type MacroStep,
    type ProgramNode,
    type WorldRef,
    conditionAllowedAt,
    startingStation,
  } from "../bots/botScript.ts";
  import { MACRO_CATALOG_LIST } from "../bots/macroCatalogView.ts";
  import { EXAMPLE_BOTS, type ExampleBot } from "../bots/exampleBots.ts";
  import { stepSentence } from "../bots/scriptText.ts";
  import { validateScript, type ScriptProblem } from "../bots/validateScript.ts";
  import { decodeScriptText, decodeScriptValue, encodeScriptDoc } from "../bots/scriptCodec.ts";
  import {
    createBotScript,
    deleteBotScript,
    getBotScript,
    listBotScripts,
    updateBotScript,
    type BotScriptSummary,
  } from "../app/api.ts";
  import StationPicker from "./StationPicker.svelte";
  import { onMount } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { nameKey } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const inventory = store.inventory;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let idSeed = 0;
  const makeId = (): string => `n${(idSeed += 1)}`;

  // ── Editor state (the flat "blocks" shape the player thinks in) ──────────────
  let name = $state("My mining bot");
  let repeatMode = $state<"forever" | "times" | "once">("times");
  let repeatCount = $state(20);
  let home = $state<WorldRef>(startingStation());
  let watches = $state<InterruptRow[]>([
    { id: "w-shield", when: { kind: "shield-below", fraction: 0.3 }, respond: "dock-and-pause" },
  ]);
  let steps = $state<MacroStep[]>([
    { id: "s-undock", kind: "macro", macro: "undock", args: {} },
    {
      id: "s-mine",
      kind: "macro",
      macro: "mine-at-belt",
      args: { belt: { kind: "belt", belt: { mode: "nearest" } } },
      until: { kind: "ore-hold-at-least", fraction: 0.9 },
    },
    {
      id: "s-haul",
      kind: "macro",
      macro: "deliver-ore",
      args: { station: { kind: "station", ref: startingStation() } },
    },
  ]);
  let importText = $state("");
  let importNote = $state<string | null>(null);

  // Saved bots — kept per account on the web server (src/botScriptStore.js).
  let savedList = $state<BotScriptSummary[]>([]);
  let currentSavedId = $state<string | null>(null);
  let currentRev = $state(0);
  let libraryError = $state<string | null>(null);

  // ── Derived ──────────────────────────────────────────────────────────────────
  // The stations a player can pick right now — at least the one they are docked
  // at. (More sources come with the live pass.)
  const stations = $derived.by<{ id: number; name: string }[]>(() => {
    const out: { id: number; name: string }[] = [];
    const st = $flight.status;
    if (st !== null && st.docked && st.stationID !== null) {
      out.push({ id: st.stationID, name: $flight.stationName ?? "This station" });
    }
    return out;
  });

  const currentStation = $derived<{ id: number; name: string } | null>(stations[0] ?? null);
  const someWatchDocks = $derived(watches.some((w) => w.respond === "dock-and-pause"));
  const builtDoc = $derived<BotScript>(buildScript());
  const problems = $derived(validateScript(builtDoc));
  const problemsByPath = $derived(groupProblems(problems));

  function buildScript(): BotScript {
    const program: readonly ProgramNode[] =
      steps.length === 0
        ? []
        : repeatMode === "once"
          ? [...steps]
          : [
              {
                id: "main-loop",
                kind: "loop",
                repeat: repeatMode === "forever" ? { kind: "forever" } : { kind: "times", count: repeatCount },
                body: [...steps],
              },
            ];
    return { format: "evejs-bot-script", version: 1, name, notes: "", home, interrupts: [...watches], program };
  }

  function groupProblems(list: readonly ScriptProblem[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const p of list) {
      const existing = map.get(p.path) ?? [];
      existing.push(p.sentence);
      map.set(p.path, existing);
    }
    return map;
  }

  // ── Small helpers ────────────────────────────────────────────────────────────
  function unboundStation(): WorldRef {
    return { entity: "station", id: null, name: null, systemName: null };
  }
  function pct(fraction: number): number {
    return Math.round(fraction * 100);
  }
  function clampFraction(f: number): number {
    return Math.min(0.95, Math.max(0.05, f));
  }
  // The station ref a step currently points at (unbound when unset).
  function stationArgRef(step: MacroStep): WorldRef {
    const station = step.args["station"];
    return station !== undefined && station.kind === "station" ? station.ref : unboundStation();
  }

  const WATCH_LABEL: Record<string, string> = {
    "shield-below": "Shields",
    "armor-below": "Armor",
    "hull-below": "Hull",
    "health-below": "Ship health",
    "capacitor-below": "Capacitor",
  };
  const RESPONSE_OPTIONS: readonly { value: InterruptResponse; label: string }[] = [
    { value: "dock-and-pause", label: "Dock at home and stop" },
    { value: "pause", label: "Just stop and wait" },
    { value: "repair", label: "Run the repairers until it recovers" },
  ];
  const untilKinds = ["ore-hold-at-least", "hold-empty", "shield-below", "armor-below", "hull-below", "health-below", "capacitor-below"].filter(
    (k) => conditionAllowedAt(k as ConditionKind, "until"),
  ) as ConditionKind[];
  const UNTIL_LABEL: Record<string, string> = {
    "ore-hold-at-least": "the ore hold is nearly full",
    "hold-empty": "the hold is empty",
    "shield-below": "shields drop below…",
    "armor-below": "armor drops below…",
    "hull-below": "hull drops below…",
    "health-below": "ship health drops below…",
    "capacitor-below": "the capacitor drops below…",
  };
  function untilHasFraction(kind: ConditionKind): boolean {
    return kind !== "hold-empty" && kind !== "hostile-on-grid";
  }

  // ── Watches ──────────────────────────────────────────────────────────────────
  function hasWatch(kind: ConditionKind): boolean {
    return watches.some((w) => w.when.kind === kind);
  }
  function addWatch(kind: ConditionKind): void {
    if (hasWatch(kind)) return;
    const when: Condition = kind === "hostile-on-grid" ? { kind } : ({ kind, fraction: 0.3 } as Condition);
    const respond: InterruptResponse = kind === "hostile-on-grid" ? "launch-drones" : "dock-and-pause";
    watches = [...watches, { id: makeId(), when, respond }];
  }
  function removeWatch(id: string): void {
    watches = watches.filter((w) => w.id !== id);
  }
  function setWatchFraction(id: string, percent: number): void {
    watches = watches.map((w) =>
      w.id === id && "fraction" in w.when ? { ...w, when: { ...w.when, fraction: clampFraction(percent / 100) } } : w,
    );
  }
  function setWatchResponse(id: string, respond: InterruptResponse): void {
    watches = watches.map((w) => (w.id === id ? { ...w, respond } : w));
  }
  // ── Blocks (steps) ───────────────────────────────────────────────────────────
  function addStep(macro: MacroID): void {
    if (macro === "mine-at-belt") {
      steps = [
        ...steps,
        {
          id: makeId(),
          kind: "macro",
          macro,
          args: { belt: { kind: "belt", belt: { mode: "nearest" } } },
          until: { kind: "ore-hold-at-least", fraction: 0.9 },
        },
      ];
      return;
    }
    if (macro === "deliver-ore" || macro === "travel-to-station") {
      steps = [...steps, { id: makeId(), kind: "macro", macro, args: { station: { kind: "station", ref: startingStation() } } }];
      return;
    }
    if (macro === "move-items") {
      // Sensible defaults: hangar -> cargo; the item stays to pick.
      steps = [
        ...steps,
        { id: makeId(), kind: "macro", macro, args: { from: { kind: "place", place: "hangar" }, to: { kind: "place", place: "cargo" } } },
      ];
      return;
    }
    steps = [...steps, { id: makeId(), kind: "macro", macro, args: {} }];
  }
  function moveStep(i: number, delta: number): void {
    const j = i + delta;
    if (j < 0 || j >= steps.length) return;
    const copy = steps.slice();
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) return;
    copy[i] = b;
    copy[j] = a;
    steps = copy;
  }
  function removeStep(i: number): void {
    steps = steps.filter((_, idx) => idx !== i);
  }
  function duplicateStep(i: number): void {
    const s = steps[i];
    if (s === undefined) return;
    const clone: MacroStep = { ...structuredClone(s), id: makeId() };
    steps = [...steps.slice(0, i + 1), clone, ...steps.slice(i + 1)];
  }
  function setStepStationRef(i: number, ref: WorldRef): void {
    steps = steps.map((s, idx) => (idx === i ? { ...s, args: { ...s.args, station: { kind: "station", ref } } } : s));
  }
  function setStepUntilKind(i: number, kind: ConditionKind): void {
    steps = steps.map((s, idx) => {
      if (idx !== i) return s;
      const keep = s.until && "fraction" in s.until ? s.until.fraction : 0.3;
      const until: Condition = untilHasFraction(kind) ? ({ kind, fraction: kind === "ore-hold-at-least" ? Math.min(keep, 0.9) : keep } as Condition) : ({ kind } as Condition);
      return { ...s, until };
    });
  }
  function setStepUntilFraction(i: number, percent: number): void {
    steps = steps.map((s, idx) => {
      if (idx !== i || !s.until || !("fraction" in s.until)) return s;
      const cap = s.until.kind === "ore-hold-at-least" ? 0.9 : 0.95;
      return { ...s, until: { ...s.until, fraction: Math.min(cap, clampFraction(percent / 100)) } };
    });
  }

  // ── The refit block's saved-fitting picker ─────────────────────────────────
  let savedFittings = $state<readonly { fittingID: number; name: string }[]>([]);
  let savedSpots = $state<readonly { bookmarkID: number; name: string }[]>([]);
  onMount(() => {
    void flow
      .listSavedFittings()
      .then((rows) => {
        savedFittings = rows.map((f) => ({ fittingID: f.fittingID, name: f.name }));
      })
      .catch(() => {});
    void flow
      .listBookmarks()
      .then((rows) => {
        savedSpots = rows;
      })
      .catch(() => {});
  });
  function bookmarkArgID(step: MacroStep): number | null {
    const arg = step.args["bookmark"];
    return arg !== undefined && arg.kind === "bookmark" ? arg.bookmarkID : null;
  }
  function setStepBookmark(i: number, bookmarkID: number): void {
    const match = savedSpots.find((bm) => bm.bookmarkID === bookmarkID);
    if (match === undefined) return;
    steps = steps.map((s, idx) =>
      idx === i ? { ...s, args: { ...s.args, bookmark: { kind: "bookmark", bookmarkID: match.bookmarkID, name: match.name } } } : s,
    );
  }
  function fittingArgID(step: MacroStep): number | null {
    const arg = step.args["fitting"];
    return arg !== undefined && arg.kind === "fitting" ? arg.fittingID : null;
  }
  function setStepFitting(i: number, fittingID: number): void {
    const match = savedFittings.find((f) => f.fittingID === fittingID);
    if (match === undefined) return;
    steps = steps.map((s, idx) =>
      idx === i ? { ...s, args: { ...s.args, fitting: { kind: "fitting", fittingID: match.fittingID, name: match.name } } } : s,
    );
  }

  // ── The move block's pickers ────────────────────────────────────────────────
  // Items offered = what is visible in the hangar/cargo right now, by NAME.
  const knownItems = $derived.by<readonly { typeID: number; name: string }[]>(() => {
    const seen = new Map<number, string>();
    for (const row of [...$inventory.hangar.rows, ...$inventory.cargo.rows]) {
      if (row.typeID > 0 && !seen.has(row.typeID)) {
        const name = $names.resolved[nameKey("type", row.typeID)] ?? null;
        if (name !== null && name.length > 0) {
          seen.set(row.typeID, name);
        }
      }
    }
    return [...seen.entries()].map(([typeID, name]) => ({ typeID, name })).sort((a, b) => a.name.localeCompare(b.name));
  });
  const PLACE_OPTIONS: readonly { value: string; label: string }[] = [
    { value: "hangar", label: "station hangar" },
    { value: "cargo", label: "cargo hold" },
    { value: "ore-hold", label: "ore hold" },
  ];
  function moveArg(step: MacroStep, key: string): string {
    const arg = step.args[key];
    if (arg === undefined) return "";
    if (arg.kind === "itemType") return arg.typeID === null ? "" : String(arg.typeID);
    if (arg.kind === "place") return arg.place;
    return "";
  }
  function setMoveItem(i: number, raw: string): void {
    const typeID = Number(raw);
    const match = knownItems.find((it) => it.typeID === typeID);
    if (match === undefined) return;
    steps = steps.map((s, idx) =>
      idx === i ? { ...s, args: { ...s.args, item: { kind: "itemType", typeID: match.typeID, name: match.name } } } : s,
    );
  }
  function setMovePlace(i: number, key: "from" | "to", place: string): void {
    steps = steps.map((s, idx) =>
      idx === i ? { ...s, args: { ...s.args, [key]: { kind: "place", place: place as never } } } : s,
    );
  }

  // ── Mission-block number args (agent level, max jumps) ─────────────────────
  function countArgValue(step: MacroStep, key: string): number | null {
    const arg = step.args[key];
    return arg !== undefined && arg.kind === "count" ? arg.value : null;
  }
  /** Set (or clear, on empty input) a bounded number arg on a step. */
  function setStepCountArg(i: number, key: string, raw: string, min: number, max: number): void {
    steps = steps.map((s, idx) => {
      if (idx !== i) return s;
      const parsed = Number(raw);
      if (raw.trim() === "" || !Number.isSafeInteger(parsed)) {
        const { [key]: _dropped, ...rest } = s.args;
        return { ...s, args: rest };
      }
      const value = Math.min(max, Math.max(min, parsed));
      return { ...s, args: { ...s.args, [key]: { kind: "count", value } } };
    });
  }

  // ── Import / export ──────────────────────────────────────────────────────────
  function exportJson(): void {
    importText = encodeScriptDoc(builtDoc);
    importNote = "Copied this bot into the box below — copy it out to save or share.";
  }
  function importJson(): void {
    const result = decodeScriptText(importText);
    if (!result.ok) {
      importNote = result.refusal;
      return;
    }
    loadFrom(result.doc);
    currentSavedId = null; // an imported bot is a new, unsaved one
    currentRev = 0;
    importNote =
      result.warnings.length > 0
        ? `Loaded, with ${result.warnings.length} thing(s) tidied: ${result.warnings.join(" ")}`
        : "Loaded the bot from the box.";
  }
  function loadExample(example: ExampleBot): void {
    // Through the CODEC, exactly like an import — a bundled example must never
    // sidestep the gate a pasted file goes through.
    const result = decodeScriptValue(example.doc);
    if (!result.ok) {
      importNote = result.refusal;
      return;
    }
    loadFrom(result.doc);
    currentSavedId = null;
    currentRev = 0;
    importNote = `Loaded the "${example.label}" example - look it over, then Save and Start.`;
  }
  function loadFrom(doc: BotScript): void {
    name = doc.name;
    home = doc.home;
    watches = [...doc.interrupts];
    const first = doc.program[0];
    if (doc.program.length === 1 && first !== undefined && first.kind === "loop") {
      const loop = first as LoopBlock;
      steps = [...loop.body];
      if (loop.repeat.kind === "forever") {
        repeatMode = "forever";
      } else {
        repeatMode = "times";
        repeatCount = loop.repeat.count;
      }
    } else {
      // A mixed program (steps beside loops) does not fit this flat editor; the
      // steps are FLATTENED IN ORDER (loop bodies inlined) rather than silently
      // dropping whatever sat inside a loop.
      steps = doc.program.flatMap((n): MacroStep[] => (n.kind === "macro" ? [n] : [...n.body]));
      repeatMode = "once";
    }
    idSeed += 1000;
  }

  // ── Saved bots (per-account, on the web server) ──────────────────────────────
  async function refreshSaved(): Promise<void> {
    try {
      savedList = await listBotScripts();
      libraryError = null;
    } catch {
      savedList = [];
      libraryError = "Could not reach your saved bots — are you still logged in?";
    }
  }
  async function saveBot(): Promise<void> {
    try {
      if (currentSavedId !== null) {
        const { rev } = await updateBotScript(currentSavedId, builtDoc, currentRev);
        currentRev = rev;
        importNote = `Saved changes to "${name}".`;
      } else {
        const { scriptID, rev } = await createBotScript(builtDoc);
        currentSavedId = scriptID;
        currentRev = rev;
        importNote = `Saved "${name}" to your account.`;
      }
      await refreshSaved();
    } catch (error) {
      importNote = error instanceof Error ? `Could not save: ${error.message}` : "Could not save.";
    }
  }
  async function loadSaved(id: string): Promise<void> {
    try {
      const record = await getBotScript(id);
      if (record === null) {
        importNote = "That saved bot could not be found.";
        return;
      }
      const decoded = decodeScriptValue(record.doc);
      if (!decoded.ok) {
        importNote = decoded.refusal;
        return;
      }
      loadFrom(decoded.doc);
      currentSavedId = record.scriptID;
      currentRev = record.rev;
      importNote = "Loaded a saved bot.";
    } catch {
      importNote = "Could not load that bot.";
    }
  }
  async function deleteSaved(id: string): Promise<void> {
    try {
      await deleteBotScript(id);
      if (currentSavedId === id) {
        currentSavedId = null;
        currentRev = 0;
      }
      await refreshSaved();
    } catch {
      importNote = "Could not delete that bot.";
    }
  }
  onMount(() => {
    void refreshSaved();
  });
</script>

<section class="panel botbuilder">
  <div class="panel-head">
    <h2>Bot Builder</h2>
    <div class="controls">
      {#each EXAMPLE_BOTS as example (example.key)}
        <button class="minor" title={example.blurb} onclick={() => loadExample(example)}>{example.label}</button>
      {/each}
      {#if problems.length === 0}
        <span class="badge good">Ready</span>
      {:else}
        <span class="badge warn">{problems.length} thing{problems.length === 1 ? "" : "s"} to fix</span>
      {/if}
    </div>
  </div>

  <p class="subnote">Build and save your bot here. Start it from the <strong>Bots</strong> tab (Station services).</p>

  <div class="field-row">
    <label for="bot-name">Name</label>
    <input id="bot-name" bind:value={name} />
  </div>
  {#each problemsByPath.get("name") ?? [] as sentence}<p class="prob">{sentence}</p>{/each}

  <!-- Always watching -->
  <h3>Always watching</h3>
  <p class="subnote">Checked every moment. Add the ones you want — only one of each.</p>
  <div class="watch-buttons">
    <button onclick={() => addWatch("shield-below")} disabled={hasWatch("shield-below")}>Watch Shields</button>
    <button onclick={() => addWatch("armor-below")} disabled={hasWatch("armor-below")}>Watch Armor</button>
    <button onclick={() => addWatch("hull-below")} disabled={hasWatch("hull-below")}>Watch Hull</button>
    <button onclick={() => addWatch("capacitor-below")} disabled={hasWatch("capacitor-below")}>Watch Capacitor</button>
    <button onclick={() => addWatch("hostile-on-grid")} disabled={hasWatch("hostile-on-grid")}>Watch for Rats</button>
  </div>
  <ul class="rows">
    {#each watches as row (row.id)}
      <li class="row watch">
        <span class="mark">◆</span>
        <div class="body">
          {#if row.when.kind === "hostile-on-grid"}
            <span class="sentence">If a pirate shows up, send out combat drones to fight it off.</span>
          {:else if "fraction" in row.when}
            <span class="sentence">{WATCH_LABEL[row.when.kind]} drop below</span>
            <span class="inline-edit">
              <input class="pct" type="number" min="5" max="95" value={pct(row.when.fraction)} oninput={(e) => setWatchFraction(row.id, Number(e.currentTarget.value))} />%
              →
              <select value={row.respond} onchange={(e) => setWatchResponse(row.id, e.currentTarget.value as InterruptResponse)}>
                {#each RESPONSE_OPTIONS as opt}<option value={opt.value}>{opt.label}</option>{/each}
              </select>
            </span>
          {/if}
        </div>
        <button class="tiny danger" onclick={() => removeWatch(row.id)} aria-label="Remove this watch">✕</button>
      </li>
    {/each}
  </ul>
  {#if someWatchDocks}
    <div class="field-row">
      <span class="field-caption">Dock at</span>
      <StationPicker {flow} value={home} current={currentStation} onPick={(ref) => (home = ref)} />
      {#each problemsByPath.get("home") ?? [] as sentence}<span class="prob">{sentence}</span>{/each}
    </div>
  {/if}

  <!-- Steps -->
  <div class="steps-head">
    <h3>Steps</h3>
    <span class="repeat-control">
      Repeat
      <select bind:value={repeatMode}>
        <option value="forever">forever</option>
        <option value="times">a set number of times</option>
        <option value="once">just once</option>
      </select>
      {#if repeatMode === "times"}
        <input class="count" type="number" min="1" max="500" bind:value={repeatCount} />
      {/if}
    </span>
  </div>
  {#each problemsByPath.get("program") ?? [] as sentence}<p class="prob">{sentence}</p>{/each}
  {#each problemsByPath.get("main-loop") ?? [] as sentence}<p class="prob">{sentence}</p>{/each}

  {#if steps.length === 0}
    <p class="empty">No blocks yet. Add one from the palette below.</p>
  {/if}
  <ol class="rows program">
    {#each steps as step, i (step.id)}
      <li class="row node">
        <span class="num">{i + 1}</span>
        <div class="body">
          <span class="sentence">{stepSentence(step)}</span>
          {#if step.macro === "mine-at-belt"}
            <span class="inline-edit">
              stop when
              <select value={step.until?.kind ?? "ore-hold-at-least"} onchange={(e) => setStepUntilKind(i, e.currentTarget.value as ConditionKind)}>
                {#each untilKinds as k}<option value={k}>{UNTIL_LABEL[k]}</option>{/each}
              </select>
              {#if step.until && "fraction" in step.until}
                <input class="pct" type="number" min="5" max="95" value={pct(step.until.fraction)} oninput={(e) => setStepUntilFraction(i, Number(e.currentTarget.value))} />%
              {/if}
            </span>
          {/if}
          {#if step.macro === "deliver-ore" || step.macro === "travel-to-station"}
            <span class="inline-edit">
              at
              <StationPicker {flow} value={stationArgRef(step)} current={currentStation} onPick={(ref) => setStepStationRef(i, ref)} />
            </span>
          {/if}
          {#if step.macro === "find-distribution-agent" || step.macro === "find-combat-agent"}
            <span class="inline-edit">
              level
              <input class="pct" type="number" min="1" max="5" placeholder="1" value={countArgValue(step, "level") ?? ""} oninput={(e) => setStepCountArg(i, "level", e.currentTarget.value, 1, 5)} />
              · within
              <input class="pct" type="number" min="1" max="50" placeholder="any" value={countArgValue(step, "maxJumps") ?? ""} oninput={(e) => setStepCountArg(i, "maxJumps", e.currentTarget.value, 1, 50)} />
              jumps
            </span>
          {/if}
          {#if step.macro === "accept-mission"}
            <span class="inline-edit">
              only if
              <input class="pct" type="number" min="1" max="50" placeholder="any" value={countArgValue(step, "maxJumps") ?? ""} oninput={(e) => setStepCountArg(i, "maxJumps", e.currentTarget.value, 1, 50)} />
              jumps or fewer
            </span>
          {/if}
          {#if step.macro === "refit-ship"}
            <span class="inline-edit">
              using
              <select
                value={fittingArgID(step) ?? ""}
                onchange={(e) => setStepFitting(i, Number(e.currentTarget.value))}
              >
                <option value="" disabled>pick a saved fitting…</option>
                {#each savedFittings as f (f.fittingID)}
                  <option value={f.fittingID}>{f.name}</option>
                {/each}
              </select>
            </span>
          {/if}
          {#if step.macro === "move-items"}
            <span class="inline-edit">
              <select value={moveArg(step, "item")} onchange={(e) => setMoveItem(i, e.currentTarget.value)}>
                <option value="" disabled>pick an item…</option>
                {#each knownItems as it (it.typeID)}<option value={it.typeID}>{it.name}</option>{/each}
              </select>
              ×
              <input class="pct" type="number" min="1" max="500" placeholder="all" value={countArgValue(step, "amount") ?? ""} oninput={(e) => setStepCountArg(i, "amount", e.currentTarget.value, 1, 500)} />
              from
              <select value={moveArg(step, "from")} onchange={(e) => setMovePlace(i, "from", e.currentTarget.value)}>
                {#each PLACE_OPTIONS as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
              </select>
              to
              <select value={moveArg(step, "to")} onchange={(e) => setMovePlace(i, "to", e.currentTarget.value)}>
                {#each PLACE_OPTIONS as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
              </select>
            </span>
          {/if}
          {#if step.macro === "warp-to-bookmark"}
            <span class="inline-edit">
              to
              <select value={bookmarkArgID(step) ?? ""} onchange={(e) => setStepBookmark(i, Number(e.currentTarget.value))}>
                <option value="" disabled>pick a saved spot…</option>
                {#each savedSpots as bm (bm.bookmarkID)}<option value={bm.bookmarkID}>{bm.name}</option>{/each}
              </select>
            </span>
          {/if}
          {#if step.macro === "wait"}
            <span class="inline-edit">
              for
              <input class="pct" type="number" min="1" max="500" placeholder="10" value={countArgValue(step, "seconds") ?? ""} oninput={(e) => setStepCountArg(i, "seconds", e.currentTarget.value, 1, 500)} />
              seconds
            </span>
          {/if}
          {#each problemsByPath.get(step.id) ?? [] as sentence}<p class="prob">{sentence}</p>{/each}
        </div>
        <div class="ops">
          <button class="tiny" onclick={() => moveStep(i, -1)} aria-label="Move up">↑</button>
          <button class="tiny" onclick={() => moveStep(i, 1)} aria-label="Move down">↓</button>
          <button class="tiny" onclick={() => duplicateStep(i)} aria-label="Duplicate">⧉</button>
          <button class="tiny danger" onclick={() => removeStep(i)} aria-label="Delete">✕</button>
        </div>
      </li>
    {/each}
  </ol>

  <div class="save-row">
    <button class="primary" onclick={saveBot}>Save</button>
  </div>

  <!-- Palette -->
  <h3>Add a block</h3>
  <div class="palette">
    {#each MACRO_CATALOG_LIST as entry}
      <div class="macro-card">
        <div class="macro-name">{entry.name}</div>
        <div class="macro-does">{entry.does}</div>
        {#if entry.needs}<div class="macro-needs">Needs: {entry.needs}</div>{/if}
        <div class="macro-add">
          <button class="primary tiny" onclick={() => addStep(entry.id)}>Add</button>
        </div>
      </div>
    {/each}
  </div>

  <!-- Saved bots -->
  <h3>Your saved bots</h3>
  <p class="subnote">Kept on the server against your account, so they follow you to any browser or character.</p>
  {#if libraryError}<p class="prob">{libraryError}</p>{/if}
  {#if savedList.length === 0}
    <p class="empty">No saved bots yet. Press Save above to keep one.</p>
  {:else}
    <ul class="rows">
      {#each savedList as meta (meta.scriptID)}
        <li class="row">
          <div class="body">
            <span class="sentence">{meta.name}</span>
            {#if meta.scriptID === currentSavedId}<span class="badge accent">open</span>{/if}
          </div>
          <div class="ops">
            <button class="tiny" onclick={() => loadSaved(meta.scriptID)}>Load</button>
            <button class="tiny danger" onclick={() => deleteSaved(meta.scriptID)}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Import / export -->
  <h3>Import or export</h3>
  <p class="subnote">Paste a bot's JSON and load it, or export the current one to copy out.</p>
  <textarea class="io" bind:value={importText} placeholder="Paste a bot script (JSON) here…" rows="6"></textarea>
  <div class="controls">
    <button class="minor" onclick={importJson}>Load from box</button>
    <button class="minor" onclick={exportJson}>Export to box</button>
  </div>
  {#if importNote}<p class="note io-note">{importNote}</p>{/if}
</section>

<style>
  .botbuilder h3 {
    margin: 1.4rem 0 0.3rem;
    font-size: 0.95rem;
    color: var(--color-accent-bright);
  }
  .note {
    color: var(--color-muted);
    max-width: 60ch;
  }
  .subnote {
    color: var(--color-muted);
    font-size: 0.85rem;
    margin: 0 0 0.5rem;
  }
  .field-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.8rem;
  }
  .field-row label,
  .field-row .field-caption {
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.8rem;
  }
  .field-row input {
    flex: 1;
    min-width: 12rem;
  }
  .steps-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.8rem;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--color-line);
    margin-top: 1.4rem;
  }
  .steps-head h3 {
    margin: 0 0 0.3rem;
  }
  .repeat-control {
    color: var(--color-muted);
  }
  .watch-buttons {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .rows {
    list-style: none;
    margin: 0.4rem 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .row {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    border: 1px solid var(--color-row-line);
    border-radius: 4px;
    background: var(--color-panel-3);
    padding: 0.5rem 0.6rem;
    min-height: 40px;
    flex-wrap: wrap;
  }
  .row .body {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .row .mark,
  .row .num {
    flex: none;
    color: var(--color-accent-dim);
    min-width: 1.2rem;
    text-align: center;
  }
  .row.watch {
    border-left: 3px solid var(--color-shield);
  }
  .sentence {
    color: var(--color-text-bright);
  }
  .inline-edit {
    color: var(--color-muted);
    margin-left: 0.4rem;
  }
  .inline-edit select,
  .inline-edit input,
  .repeat-control select,
  .repeat-control input {
    margin: 0 0.2rem;
  }
  input.pct,
  input.count {
    width: 4rem;
  }
  .ops {
    flex: none;
    display: flex;
    gap: 0.2rem;
  }
  button.tiny {
    min-height: 32px;
    padding: 0.1rem 0.5rem;
  }
  .prob {
    color: var(--color-danger);
    font-size: 0.85rem;
    margin: 0.25rem 0 0;
  }
  .empty {
    color: var(--color-muted);
    background: var(--color-panel-3);
    border: 1px dashed var(--color-line);
    border-radius: 4px;
    padding: 0.8rem;
    text-align: center;
  }
  .palette {
    display: grid;
    /* Strict grid: equal-width columns (auto-fill + 1fr keeps every column the
       same width and never stretches the last row), each card a FIXED height so
       every cell is identical regardless of how much text it holds. */
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.6rem;
  }
  .macro-card {
    display: flex;
    flex-direction: column;
    height: 10rem;
    overflow: hidden;
    border: 1px solid var(--color-line);
    border-radius: 4px;
    background: var(--color-panel-3);
    padding: 0.6rem;
  }
  .macro-name {
    color: var(--color-text-bright);
    font-weight: 600;
  }
  .macro-does {
    color: var(--color-text);
    font-size: 0.85rem;
    margin: 0.2rem 0;
    flex: 1;
    overflow: hidden;
  }
  .macro-needs {
    color: var(--color-muted);
    font-size: 0.8rem;
    margin-bottom: 0.4rem;
  }
  /* Pin Add to the bottom-right of every card, so all cards read identically. */
  .macro-add {
    display: flex;
    justify-content: flex-end;
  }
  .save-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.8rem;
  }
  textarea.io {
    width: 100%;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.8rem;
  }
  .io-note {
    margin-top: 0.4rem;
  }
  button {
    min-height: 40px;
  }
</style>
