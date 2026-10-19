<script lang="ts">
  // The HUD's utility buttons (shipUI's hudButtons: hudButtonsCont.HudButtonsCont.construct_buttons), those of the
  // client's the page has a part for, in the order of their column: Cargo (LeftSideButtonCargo), Scanner
  // (LeftSideButtonScanner) and Autopilot (LeftSideButtonAutopilot). The camera buttons, the tactical overlay's and the
  // zoom buttons want the client's three-dimensional view, which the page has not. All of them are hidden where the HUD
  // options' Display Utility Buttons is off (shipUI.ToggleHudButtons, settings.user.ui hudButtonsExpanded).
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { hudSetting } from "../store/hudSettings.ts";
  import { toggleWindow } from "./windowToggle.ts";
  import { DRAG_MIME, carriesOurPayload, decodeDrag, samePlace } from "./dragDrop.ts";
  import { holdRatio } from "../bridge/shipHolds.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const inventory = store.inventory;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const autopilotOn = flow.autopilotOn;
  // svelte-ignore state_referenced_locally
  const mining = store.mining;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  const shown = hudSetting("hudButtonsExpanded");
  const blinkCargo = hudSetting("BlinkCargoHudIcon");

  const LABELS = [
    "UI/Generic/Cargo",
    "UI/Generic/Scanner",
    "UI/Generic/Autopilot",
    "UI/Inflight/ActivateAutopilot",
    "UI/Inflight/DeactivateAutopilot",
    "UI/Inflight/Scanner/ProbeScanner",
    "UI/Inflight/Submenus/TrackHoldBay",
    "UI/Inflight/Submenus/HoldOrBayTracked",
  ];
  $effect(() => {
    flow.requestWords(LABELS);
  });
  const said = (label: string, own: string): string => $words.templates[label] || own;

  /**
   * The cargo button's hold tracker (holdTracker.HoldTracker): the ship's holds, the one tracked, and its figures as
   * last known (_SaveCapacityForTrackedHold). Read again as what the holds hold changes (OnCapacityChange,
   * OnItemChangeProcessed: here the page's own reads of the holds and the cargo changing), and where the tracked
   * hold's figures moved, the button blinks (BlinkAndUpdateIfChanged, Blink: where Blink Cargo is on).
   */
  let tracker = $state<Awaited<ReturnType<AppFlow["cargoTrackerHolds"]>>>(null);
  let lastKnown: { readonly key: string; readonly capacity: number; readonly used: number } | null = null;
  let blinking = $state(false);
  let blinkTimer: ReturnType<typeof setTimeout> | null = null;
  async function readTracker(): Promise<void> {
    const read = await flow.cargoTrackerHolds().catch(() => null);
    tracker = read;
    const hold = read?.holds.find((each) => each.holdName === read.tracked) ?? null;
    const capacity = hold?.capacity ?? null;
    if (read === null || hold === null || capacity === null) {
      lastKnown = null;
      return;
    }
    const key = `${read.shipID}:${hold.holdName}`;
    if (lastKnown !== null && lastKnown.key === key && (lastKnown.capacity !== capacity.capacity || lastKnown.used !== capacity.used) && $blinkCargo) {
      // BlinkWhite: in over a second, out over a quarter.
      blinking = false;
      if (blinkTimer !== null) clearTimeout(blinkTimer);
      queueMicrotask(() => (blinking = true));
      blinkTimer = setTimeout(() => (blinking = false), 1250);
    }
    lastKnown = { key, capacity: capacity.capacity, used: capacity.used };
  }
  const holdsKey = $derived(JSON.stringify([
    $flight.status?.shipID ?? null,
    $mining.holds.map((hold) => [hold.key, hold.capacity?.capacity ?? null, hold.capacity?.used ?? null]),
    $inventory.cargo.capacity,
  ]));
  $effect(() => {
    void holdsKey;
    const timer = setTimeout(() => void readTracker(), 300);
    return () => clearTimeout(timer);
  });
  const trackedHold = $derived(tracker?.holds.find((hold) => hold.holdName === tracker?.tracked) ?? null);
  /** SetFillRatio: the tracked hold's share taken, at most whole, the glow at least 0.4 bright; null where not read. */
  const cargoFill = $derived(trackedHold?.capacity ? Math.min(1, Math.max(0, holdRatio(trackedHold.capacity))) : null);
  /** GetHoldsDictionary's '{:.2%}' of each. */
  const percentOf = (capacity: { readonly capacity: number; readonly used: number } | null): string =>
    capacity === null ? "—" : `${(holdRatio(capacity) * 100).toFixed(2)}%`;
  /** UI/Inflight/Submenus/HoldOrBayTracked of a hold's name. */
  function trackedText(name: string): string {
    const template = $words.templates["UI/Inflight/Submenus/HoldOrBayTracked"];
    return typeof template === "string" && template !== ""
      ? plainText(formatTemplate(template, { holdName: name }, { nameOf: (_kind, id) => String(id) }))
      : `${name} (followed)`;
  }
  /** The tooltip (AddMoreToTooltipPanel): the button's name, then each hold and how full, the tracked one marked. */
  const cargoTitle = $derived(
    [said("UI/Generic/Cargo", "Cargo hold"), ...(tracker?.holds ?? []).map((hold) => `${hold.holdName === tracker?.tracked ? trackedText(hold.name) : hold.name}  ${percentOf(hold.capacity)}`)].join("\n"),
  );
  /**
   * The cargo button's menu (GetMenu): Track Hold/Bay, each hold (the tracked one marked), sorted by its words
   * lowercased (SortListOfTuples); one chosen is tracked for the ship's type (SetMainCargoHold).
   */
  let cargoMenuOpen = $state(false);
  const cargoMenu = $derived(
    (tracker?.holds ?? [])
      .map((hold) => ({ holdName: hold.holdName, text: hold.holdName === tracker?.tracked ? trackedText(hold.name) : hold.name }))
      .sort((a, b) => (a.text.toLowerCase() < b.text.toLowerCase() ? -1 : a.text.toLowerCase() > b.text.toLowerCase() ? 1 : 0)),
  );
  function trackHold(holdName: string): void {
    cargoMenuOpen = false;
    if (tracker === null) return;
    flow.setTrackedHold(tracker.shipTypeID, holdName);
    // SetMainCargoHold: Destroy, then Initialize, whose first figures do not blink.
    lastKnown = null;
    void readTracker();
  }
  /** OnDropData: ShipCargo().OnDropData, what is dropped put into the ship's cargo. */
  function cargoDragOver(event: DragEvent): void {
    if (!carriesOurPayload([...(event.dataTransfer?.types ?? [])])) return;
    event.preventDefault();
  }
  async function dropOnCargo(event: DragEvent): Promise<void> {
    const payload = decodeDrag(event.dataTransfer?.getData(DRAG_MIME));
    if (payload === null) return;
    event.preventDefault();
    try {
      if (payload.kind === "fittedModule") await flow.unloadModuleToCargo(payload.itemID);
      else if (payload.kind === "fittedCharge") await flow.unloadChargeToCargo(payload.flagID);
      else if (!samePlace(payload.from, { kind: "cargo" })) await flow.transferItems([payload.itemID], payload.from, { kind: "cargo" }, null);
      await flow.loadInventory();
    } catch {
      // The refusal is said where the move says it.
    }
  }

  /**
   * The scanner button's menu (LeftSideButtonScanner.OnMouseDown: ExpandRadialMenu, RadialMenuScanner): of its Moon
   * Analysis, Directional Scanner, Solar System Map and Probe Scanner, the page has the probe scanner.
   */
  let scannerMenuOpen = $state(false);

  /** LeftSideButtonAutopilot.OnClick: autoPilot.SetOn, or SetOff where it is on. */
  function toggleAutopilot(): void {
    if ($autopilotOn) flow.deactivateAutopilot();
    else void flow.activateAutopilot().catch(() => {});
  }
</script>

{#if $shown}
  <div class="hud-buttons" role="toolbar" aria-label="Utility buttons">
    <!-- Inventory.OpenOrShow of the active ship's cargo, toggled (the workspace's windowToggle). -->
    <span class="hud-button-wrap">
    <button
        type="button"
        class="hud-button"
        class:blinking
        title={cargoTitle}
        aria-label={said("UI/Generic/Cargo", "Cargo hold")}
        aria-haspopup="menu"
        onclick={() => toggleWindow("inventory")}
        oncontextmenu={(event) => {
          event.preventDefault();
          cargoMenuOpen = !cargoMenuOpen;
        }}
        ondragover={cargoDragOver}
        ondrop={dropOnCargo}
      >
        {#if cargoFill !== null}
          <span class="hud-button-fill" style={`height:${cargoFill * 100}%;opacity:${Math.max(0.4, cargoFill)}`}></span>
        {/if}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8l8-4 8 4v8l-8 4-8-4z" /><path d="M4 8l8 4 8-4M12 12v8" /></svg>
      </button>
      {#if cargoMenuOpen}
        <span class="hud-button-menu" role="menu">
          <span class="hud-button-menu-head">{said("UI/Inflight/Submenus/TrackHoldBay", "Follow a hold")}</span>
          {#each cargoMenu as entry (entry.holdName)}
            <button type="button" role="menuitem" onclick={() => trackHold(entry.holdName)}>{entry.text}</button>
          {/each}
        </span>
      {/if}
    </span>
      <span class="hud-button-wrap">
        <button
          type="button"
          class="hud-button"
          title={said("UI/Generic/Scanner", "Scanners")}
          aria-label={said("UI/Generic/Scanner", "Scanners")}
          aria-haspopup="menu"
          aria-expanded={scannerMenuOpen}
          onclick={() => (scannerMenuOpen = !scannerMenuOpen)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 12l6-6" /></svg>
        </button>
        {#if scannerMenuOpen}
          <span class="hud-button-menu" role="menu">
            <button type="button" role="menuitem" onclick={() => { scannerMenuOpen = false; toggleWindow("scanner"); }}>
              {said("UI/Inflight/Scanner/ProbeScanner", "Probes")}
            </button>
          </span>
        {/if}
      </span>
    <button
      type="button"
      class="hud-button"
      class:busy={$autopilotOn}
      aria-pressed={$autopilotOn}
      title={$autopilotOn ? said("UI/Inflight/DeactivateAutopilot", "Stop the autopilot") : said("UI/Inflight/ActivateAutopilot", "Start the autopilot")}
      aria-label={said("UI/Generic/Autopilot", "Autopilot control")}
      onclick={toggleAutopilot}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19l7-14 7 14-7-4z" /></svg>
    </button>
  </div>
{/if}
