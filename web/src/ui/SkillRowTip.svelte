<script lang="ts">
  // A skill entry's tooltip (LoadSkillEntryTooltipInfoOnly: the skill tooltip controller's information, no actions):
  // the description; the level and the points of the level V total; for a skill in the queue the level it trains to
  // (cryo blue), the time until then (day to minute) and the rate. A plan's contents rows and the plan editor's
  // catalogue show it. Not here: the description's info icon and the tooltip staying under the pointer, and the expert
  // systems' notice.
  import { onMount } from "svelte";
  import { portal } from "./portal.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { shortWrittenInterval } from "../bridge/timeInterval.ts";
  import { resolvedName } from "../store/names.ts";
  import { romanLevel } from "../bridge/skills.ts";
  import type { SkillRowInfo } from "../bridge/skillPlans.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, info, top, left = null, right = null }: {
    store: ClientStore;
    flow: AppFlow;
    info: SkillRowInfo;
    /** Its place: its top, and its left edge or its right edge's distance from the screen's right. */
    top: number;
    left?: number | null;
    right?: number | null;
  } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  const OWN: Readonly<Record<string, string>> = {
    "UI/Common/SkillLevel": "Level {level}",
    "UI/SkillQueue/CurrentAndTotalSkillPoints": "{[numeric]current, useGrouping, decimalPlaces=0} of {[numeric]total, useGrouping, decimalPlaces=0} points",
    "UI/Skills/TrainingToLevel": "Queued to level {level}",
    "UI/Skills/TimeUntilTrained": "Trained in",
    "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/TrainingRate": "Rate",
    "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/SpPerMinute": "{spPerMin} points a minute",
  };

  function word(label: string, args: Readonly<Record<string, string | number>> = {}): string {
    const template = $words.templates[label];
    const text = typeof template === "string" ? template : OWN[label] ?? "";
    return plainText(formatTemplate(text, args, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
  }

  /** A message by its number (the description), as the install words it. */
  function message(messageID: number): string {
    const template = $words.templates[`#${messageID}`];
    return typeof template === "string" ? plainText(formatTemplate(template, {}, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") })) : "";
  }

  /** FormatTimeIntervalShortWritten, day to minute. */
  function interval(ticks: number): string {
    const written = shortWrittenInterval(BigInt(Math.trunc(ticks)), $words.templates, "day", "minute");
    if (written !== null) return written;
    const minutes = Math.ceil(ticks / 600_000_000);
    const [days, hours, mins] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
    return [days > 0 ? `${days}d` : "", hours > 0 ? `${hours}h` : "", `${mins}m`].filter(Boolean).join(" ");
  }

  onMount(() => {
    flow.requestWords(Object.keys(OWN));
  });
</script>

<div class="skill-row-tip" role="tooltip" use:portal style:top={`${top}px`}
  style:left={left === null ? undefined : `${left}px`} style:right={right === null ? undefined : `${right}px`}>
  {#if info.descriptionID !== null && message(info.descriptionID) !== ""}<p>{message(info.descriptionID)}</p>{/if}
  <span class="skill-row-tip-pair">
    <span>{word("UI/Common/SkillLevel", { level: info.level === 0 ? "0" : romanLevel(info.level) })}</span>
    {#if info.totalPoints !== null}<span>{word("UI/SkillQueue/CurrentAndTotalSkillPoints", { current: info.points, total: info.totalPoints })}</span>{/if}
  </span>
  {#if info.queued !== null}
    <span class="skill-row-tip-queued">{word("UI/Skills/TrainingToLevel", { level: info.queued.level })}</span>
    {#if info.queued.ticks !== null}
      <span class="skill-row-tip-pair"><span>{word("UI/Skills/TimeUntilTrained")}</span><span>{interval(info.queued.ticks)}</span></span>
    {/if}
    {#if info.queued.rate !== null}
      <span class="skill-row-tip-pair"><span>{word("UI/CharacterSheet/CharacterSheetWindow/SkillTabs/TrainingRate")}</span><span>{word("UI/CharacterSheet/CharacterSheetWindow/SkillTabs/SpPerMinute", { spPerMin: info.queued.rate })}</span></span>
    {/if}
  {/if}
</div>

<style>
  /* A standard tooltip, one column, 17rem wide (TOOLTIP_WIDTH_DEFAULT's grid). */
  .skill-row-tip { position: fixed; z-index: 60; display: flex; flex-direction: column; gap: 0.45rem; width: 17rem;
    padding: 0.6rem 0.75rem; border: 1px solid var(--line, #333); background: rgba(10, 12, 16, 0.96); pointer-events: none; }
  .skill-row-tip p { margin: 0; overflow-wrap: anywhere; }
  .skill-row-tip-pair { display: flex; justify-content: space-between; gap: 0.75rem; }
  .skill-row-tip-queued { color: #58a7bf; }
</style>
