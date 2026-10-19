<!--
  The training time and the skill action, as the client's skill requirement panels draw them
  (tooltip/skill_requirement.py AddTrainingTime, skillBtns.py SkillActionContainer): an omega's time, or an alpha's row
  (its time and an omega's), which an alpha whose need is above its clone (NeedsOmegaUpgrade) has even with no time,
  its warning naming what it would be for, and the Upgrade button of every alpha row (AlphaTrainingTimeContainer); then
  the points the levels cost with the apply-points button, and Train Skills or Buy and Train. The skill requirement
  window's and the Fitting window's skill tooltip's. The page has no clone upgrade window to open.
-->
<script lang="ts">
  import type { SkillTrainingRecord } from "../app/flow.ts";
  import { clientTexture } from "./skillGroupIcons.ts";
  import { SKILL_PLAN_ICON } from "./skillPlanTemplate.ts";

  let {
    record,
    activity,
    word,
    timeText,
    apply,
    onTrain,
    onBuy,
    plan = null,
  }: {
    record: SkillTrainingRecord;
    /** What the skills are for, the label OmegaCloneStateRequiredForActivity names (doActivity). */
    activity: string;
    /** The words of the window it is in, its own where the install's are not to hand. */
    word: (label: string, args?: Readonly<Record<string, string | number>>) => string;
    /** A training time as the window writes it. */
    timeText: (ticks: number | null) => string;
    /** The apply-points button: its hint, whether it is enabled (and why not), and what it does. */
    apply: { readonly hint: string; readonly enabled: boolean; readonly why?: string; readonly use: () => void };
    onTrain: () => void;
    onBuy: () => void;
    /** CreateSkillPlanButton: its hint and its click; none where the window has none. */
    plan?: { readonly hint: string; readonly use: () => void } | null;
  } = $props();

  /** eveformat.number: whole, grouped by thousands. */
  const groupedNumber = (value: number): string => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
</script>

{#if record.trainingTicks !== null || (!record.omega && record.omegaRestricted)}
  <div class="skill-time">
    {#if record.omega}
      <span class="dim">{word("Tooltips/SkillPlanner/OmegaTrainingTime")}</span>
      <span>{timeText(record.trainingTicks ?? 0)}</span>
    {:else}
      {#if record.trainingTicks !== null}
        <span class="dim">{word("Tooltips/SkillPlanner/TrainingTime")}</span>
        <span class:restricted={record.omegaRestricted}>α {timeText(record.trainingTicks)}</span>
        <span class="omega">Ω {timeText(Math.floor(record.trainingTicks / 2))}</span>
      {/if}
      {#if record.omegaRestricted}
        <span class="omega-warning">⚠ {word("Tooltips/SkillPlanner/OmegaCloneStateRequiredForActivity", { doActivity: word(activity) })}</span>
      {/if}
      <button type="button" class="omega-upgrade" disabled title="The page has no clone upgrade window.">Ω {word("UI/CloneState/Upgrade")}</button>
    {/if}
  </div>
{/if}
{#if record.action !== null}
  <div class="skill-points">
    <span class="dim">{word("UI/Skills/SkillPointsRequired")}</span>
    <span>{record.skillPointsRequired === null ? "" : groupedNumber(record.skillPointsRequired)}</span>
    <button type="button" class="apply-points" title={apply.why === undefined ? apply.hint : `${apply.hint} (${apply.why})`} aria-label={apply.hint} disabled={!apply.enabled} onclick={apply.use}>+</button>
  </div>
  {#if record.action.kind === "train"}
    <span class="answers">
      <button
        type="button"
        disabled={record.action.queued}
        title={word(record.action.queued ? "Tooltips/SkillPlanner/AddAllSkillsToQueueButtonFinished" : "Tooltips/SkillPlanner/AddAllSkillsToQueueButton")}
        onclick={onTrain}
      >{word("UI/Skills/TrainSkills")}</button>
      {#if plan}{@render planButton(plan)}{/if}
    </span>
  {:else}
    <!-- BuyAndTrainButton: its hint says where a book is a rare one (isRareSkill, IsMissingRarePrereqs). -->
    {@const rare = record.action.missing.some((skill) => record.books[skill]?.sold !== true)}
    <span class="answers">
      <button type="button" title={rare ? word("UI/Skills/ErrorRareRequirements") : ""} onclick={onBuy}>{word("UI/Skills/BuyAndTrain")}</button>
      {#if plan}{@render planButton(plan)}{/if}
    </span>
  {/if}
{/if}

<!-- CreateSkillPlanButton: the skill plan icon alone (a ghost button with no label), its hint on the pointer. -->
{#snippet planButton(button: { readonly hint: string; readonly use: () => void })}
  <button type="button" class="skill-plan-create" title={button.hint} aria-label={button.hint} onclick={button.use}>
    <img src={clientTexture(SKILL_PLAN_ICON)} alt="" width="16" height="16" />
  </button>
{/snippet}

<style>
  .skill-time, .skill-points { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.4rem 0.6rem; background: rgba(25, 25, 25, 0.7); }
  .skill-points { flex-direction: row; justify-content: space-between; }
  .skill-time .omega { color: #ff9e1b; }
  .skill-time .omega-upgrade { align-self: flex-start; margin-top: 0.4rem; }
  .apply-points { margin-left: 0.6rem; padding: 0 0.5rem; }
  .dim { opacity: 0.7; }
  .answers { display: flex; justify-content: flex-end; gap: 0.4rem; }
  .skill-plan-create { display: inline-flex; align-items: center; padding: 0 0.4rem; background: none; }
</style>
