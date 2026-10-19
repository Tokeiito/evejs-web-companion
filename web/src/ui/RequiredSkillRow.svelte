<!--
  A skill and the level needed of it, as the client's RequiredSkillRow draws it (tooltip/skill_requirement.py): its
  name and level (RequiredSkillNameAndLevel), its book's or level's mark with its hint (_GetTexturePathAndHint), and the
  skill bar's five boxes. The skill requirement window's rows and the Fitting window's skill tooltip's.
-->
<script lang="ts">
  import { romanLevel } from "../bridge/skills.ts";
  import type { SkillLevelBox, SkillRowMark } from "../bridge/missingSkills.ts";

  let {
    skill,
    level,
    mark,
    boxes,
    word,
  }: {
    skill: number;
    level: number;
    mark: SkillRowMark;
    boxes: readonly { readonly box: SkillLevelBox; readonly partial: boolean }[];
    /** The words of the window the row is in, its own where the install's are not to hand. */
    word: (label: string, args?: Readonly<Record<string, string | number>>) => string;
  } = $props();

  /** RequiredSkillRow's hint for each mark. */
  const MARK_LABELS: Readonly<Record<Exclude<SkillRowMark, null>, string>> = {
    "book-missing": "UI/SkillQueue/SkillBookMissing",
    "rare-book-missing": "UI/SkillQueue/RareSkillBookMissing",
    "level-short": "UI/InfoWindow/SkillNotTrainedToRequiredLevel",
  };
</script>

<li class="skill-row">
  <span class="skill-name">{word("UI/InfoWindow/RequiredSkillNameAndLevel", { skill, level: romanLevel(level), levelColor: "#ffffff" })}</span>
  {#if mark !== null}
    <span class="skill-mark" class:book={mark !== "level-short"} title={word(MARK_LABELS[mark])}></span>
  {/if}
  {#if boxes.length > 0}
    <span class="skill-bar" aria-hidden="true">
      {#each boxes as one, at (at)}
        <span class="skill-box {one.box}" class:partial={one.partial}></span>
      {/each}
    </span>
  {/if}
</li>

<style>
  .skill-row { display: flex; align-items: center; gap: 0.5rem; }
  .skill-name { flex: 1; }
  .skill-mark { width: 12px; height: 14px; flex: none; }
  .skill-mark.book { background: #e0a43c; border-radius: 1px 3px 3px 1px; }
  .skill-bar { display: inline-flex; gap: 2px; margin-left: 0.75rem; }
  .skill-box { width: 8px; height: 8px; box-sizing: border-box; }
  .skill-box.none { visibility: hidden; }
  .skill-box.trained { background: rgba(204, 204, 204, 1); }
  .skill-box.training { background: rgba(204, 204, 204, 0.6); outline: 1px solid rgba(204, 204, 204, 1); }
  .skill-box.queued { background: #3ea8d9; }
  .skill-box.untrained { background: rgba(255, 255, 255, 0.3); }
  .skill-box.small { width: 4px; height: 4px; margin: 2px; background: rgba(255, 255, 255, 0.3); }
  /* skillLevel.py COLOR_TRAINED_OMEGA and COLOR_REQUIRES_OMEGA: clonegrade.COLOR_OMEGA_ORANGE at 0.8 and 0.6. */
  .skill-box.trained-omega { background: rgba(252, 194, 7, 0.8); }
  .skill-box.small-omega { width: 4px; height: 4px; margin: 2px; background: rgba(252, 194, 7, 0.6); }
  .skill-box.partial { outline: 1px solid rgba(204, 204, 204, 1); }
</style>
