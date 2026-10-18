<script lang="ts">
  // The ship HUD's buff bar (buffBarContainer.py, buffButtons.py) as far as the warfare buffs go (bridge/buffBar.ts):
  // a slot for each kind of buff the server says is on the pilot's ship, in the order they came up, each with its
  // icon, its timer to the latest end of its buffs, and its hint: the slot's caption, then each buff's value, name and
  // time left, written again every quarter second while it is up (LoadTooltipPanel's AutoTimer).
  import { onMount, untrack } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { BUFF_SLOTS } from "../bridge/dbuffs.ts";
  import { buffHintRows, buffSlotOf, shownBuffSlots, slotBuffEndMs, UNIT_MODIFIER_RELATIVE_PERCENT, type BuffHintWriter } from "../bridge/buffBar.ts";
  import { valueAndUnitText, type AttributeWords } from "../bridge/typeComparison.ts";
  import { SHORT_INTERVAL_WORD_LABELS, shortWrittenInterval } from "../bridge/timeInterval.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { clientTexture } from "./skillGroupIcons.ts";
  import { portal } from "./portal.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const buffBar = flow.buffBar;

  onMount(() => {
    flow.requestWords([...new Set(BUFF_SLOTS.map((slot) => slot.hint)), "UI/InfoWindow/ValueAndUnit", ...SHORT_INTERVAL_WORD_LABELS]);
    flow.wantBuffBar();
  });

  /** The slots showing, in the order they came up (shownBuffSlots). */
  let order = $state<string[]>([]);
  $effect(() => {
    const incoming = $buffBar.incoming;
    order = shownBuffSlots(untrack(() => order), incoming);
  });

  /**
   * Each timed slot's timer (UpdateDbuffTimer): started when the latest end of its buffs changes, and running down from
   * then to that end (ModuleEffectTimer.StartTimer(duration), at least 0.2 s).
   */
  let timers = $state<Record<string, { readonly endMs: number; readonly fromMs: number }>>({});
  $effect(() => {
    const state = $buffBar;
    const shown = order;
    const before = untrack(() => timers);
    const now = Date.now() + state.clockOffsetMs;
    const next: Record<string, { readonly endMs: number; readonly fromMs: number }> = {};
    for (const name of shown) {
      const slot = buffSlotOf(name);
      const endMs = slot === null ? null : slotBuffEndMs(slot, state.incoming);
      if (endMs === null) continue;
      const kept = before[name];
      next[name] = kept !== undefined && kept.endMs === endMs ? kept : { endMs, fromMs: Math.min(now, endMs - 200) };
    }
    timers = next;
  });

  let tip = $state<{ readonly slot: string; readonly left: number; readonly top: number; readonly below: boolean } | null>(null);
  let nowMs = $state(Date.now());
  $effect(() => {
    if (Object.keys(timers).length === 0 && tip === null) return;
    const handle = setInterval(() => { nowMs = Date.now(); }, 250);
    return () => clearInterval(handle);
  });
  const serverNowMs = $derived(nowMs + $buffBar.clockOffsetMs);

  /** How much of a slot's timer is left, 0 to 1, or null for a slot with none. */
  function timerLeft(name: string): number | null {
    const timer = timers[name];
    if (timer === undefined) return null;
    const span = timer.endMs - timer.fromMs;
    return span <= 0 ? 0 : Math.max(0, Math.min(1, (timer.endMs - serverNowMs) / span));
  }

  function said(label: string, args: Readonly<Record<string, string>> = {}): string {
    const template = $words.templates[label];
    return typeof template === "string" ? plainText(formatTemplate(template, args, { nameOf: () => "" })) : "";
  }
  const attributeWords: AttributeWords = {
    label: (path, args) => said(path, args ?? {}) || (path === "UI/InfoWindow/ValueAndUnit" && args ? `${args.value ?? ""} ${args.unit ?? ""}`.trim() : ""),
    message: () => "",
    unitName: (unitID) => (unitID === UNIT_MODIFIER_RELATIVE_PERCENT ? $buffBar.percentUnitName : ""),
    typeName: () => "",
    groupName: () => "",
    attribute: () => null,
    shortInterval: (ticks) => shortWrittenInterval(ticks, $words.templates),
  };
  const writer: BuffHintWriter = {
    valueAndUnit: (value, unitID) => valueAndUnitText(value, unitID, attributeWords),
    interval: (ticks) => shortWrittenInterval(ticks, $words.templates) ?? "",
  };

  function showTip(event: Event, name: string): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Above the bar where there is room for it, as the client's tooltip stands off its button; below it otherwise.
    const below = box.top < 160;
    tip = { slot: name, left: box.left + box.width / 2, top: below ? box.bottom + 6 : box.top - 6, below };
  }
</script>

{#if order.length > 0}
  <div class="buff-bar" role="list" aria-label="Effects on your ship">
    {#each order as name (name)}
      {@const slot = buffSlotOf(name)}
      {#if slot !== null}
        {@const iconFile = $buffBar.iconFiles.get(slot.iconID) ?? null}
        {@const left = timerLeft(name)}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="buff-slot {slot.kind}" role="listitem" tabindex="0" data-buff-slot={name}
          onmouseenter={(event) => showTip(event, name)} onmouseleave={() => (tip = null)}
          onfocus={(event) => showTip(event, name)} onblur={() => (tip = null)}>
          <span class="buff-slot-underlay" style:--underlay-grad={`url(${clientTexture("res:/UI/Texture/classes/ShipUI/EwarBar/ewarBarUnderlayGrad.png")})`}
            style:--underlay-clean={`url(${clientTexture("res:/UI/Texture/classes/ShipUI/EwarBar/ewarBarUnderlayClean.png")})`} aria-hidden="true"></span>
          {#if iconFile !== null}
            <img class="buff-slot-icon" src={clientTexture(iconFile)} alt="" width="40" height="40" />
          {/if}
          {#if left !== null}
            <span class="buff-slot-timer" style:--left={`${left * 360}deg`} aria-hidden="true"></span>
          {/if}
          <span class="buff-slot-name">{said(slot.hint) || "An effect on your ship"}</span>
        </div>
      {/if}
    {/each}
  </div>
{/if}

{#if tip !== null}
  {@const slot = buffSlotOf(tip.slot)}
  {#if slot !== null}
    {@const rows = buffHintRows(slot, $buffBar.incoming, $buffBar.facts, writer, serverNowMs)}
    <div class="buff-tip" class:below={tip.below} role="tooltip" use:portal style:left={`${tip.left}px`} style:top={`${tip.top}px`}>
      <strong class="buff-tip-caption">{said(slot.hint) || "An effect on your ship"}</strong>
      {#each rows as row, index (index)}
        <span class="buff-tip-value">{row.value ?? ""}</span>
        <span class="buff-tip-name">{row.name}</span>
        <span class="buff-tip-time">{row.timeLeft}</span>
      {/each}
    </div>
  {/if}
{/if}
