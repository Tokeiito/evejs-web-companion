<script lang="ts">
  // A skill entry's tooltip (LoadSkillEntryTooltipInfoOnly: the skill tooltip controller's information, no actions):
  // the description; the level and the points of the level V total; for a skill in the queue the level it trains to
  // (cryo blue), the time until then (day to minute) and the rate. A plan's contents rows and the plan editor's
  // catalogue show it. Beside the description its InfoIcon (Show Info of the skill, its hint UI/Commands/ShowInfo). The
  // panel takes the pointer (its state UI_NORMAL): it stays while the pointer is on it, which onHover tells its host.
  // Not here: the expert systems' notice (add_expert_system_information).
  import { onMount } from "svelte";
  import { portal } from "./portal.ts";
  import { showInfo } from "./showInfo.ts";
  import { clientTexture } from "./skillGroupIcons.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { shortWrittenInterval } from "../bridge/timeInterval.ts";
  import { resolvedName } from "../store/names.ts";
  import { romanLevel } from "../bridge/skills.ts";
  import type { SkillRowInfo } from "../bridge/skillPlans.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, typeID, info, top, left = null, right = null, onHover = null }: {
    store: ClientStore;
    flow: AppFlow;
    /** The skill, for its InfoIcon. */
    typeID: number;
    info: SkillRowInfo;
    /** The pointer onto the tooltip (true) and off it (false), for its host to keep it or take it away. */
    onHover?: ((inside: boolean) => void) | null;
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
    "UI/Commands/ShowInfo": "Show information",
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

  /** InfoIcon's picture (infoIcon.py default_texturePath). */
  const INFO_ICON = clientTexture("res:/ui/Texture/Icons/38_16_208.png");

  onMount(() => {
    flow.requestWords(Object.keys(OWN));
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="skill-row-tip" role="tooltip" use:portal style:top={`${top}px`}
  style:left={left === null ? undefined : `${left}px`} style:right={right === null ? undefined : `${right}px`}
  onmouseenter={() => onHover?.(true)} onmouseleave={() => onHover?.(false)}>
  <span class="skill-row-tip-description">
    <p>{info.descriptionID !== null ? message(info.descriptionID) : ""}</p>
    <button type="button" class="skill-row-tip-info" title={word("UI/Commands/ShowInfo")} aria-label={word("UI/Commands/ShowInfo")}
      onclick={() => showInfo({ kind: "type", typeID })}><img src={INFO_ICON} alt="" width="16" height="16" /></button>
  </span>
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
    padding: 0.6rem 0.75rem; border: 1px solid var(--line, #333); background: rgba(10, 12, 16, 0.96); }
  .skill-row-tip-description { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; }
  .skill-row-tip-info { flex: none; padding: 0; border: 0; background: none; cursor: pointer; line-height: 0; }
  .skill-row-tip p { margin: 0; overflow-wrap: anywhere; }
  .skill-row-tip-pair { display: flex; justify-content: space-between; gap: 0.75rem; }
  .skill-row-tip-queued { color: #58a7bf; }
</style>
