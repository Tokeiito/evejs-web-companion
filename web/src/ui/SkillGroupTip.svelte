<script lang="ts">
  // A skill group's tooltip in the plan editor's catalogue (SkillGroupEntry.LoadTooltipPanel,
  // skillsPanelUtil.LoadSkillGroupTooltipPanel): its name; its description (DESCRIPTION_BY_GROUPID); the levels of its
  // skills trained of all of them, those above an alpha clone's ceiling said apart in omega gold; their points trained
  // of all; its certificates' levels claimed of all, where it has any (AddCertificatesClaimed); its two attributes,
  // each with its picture (ATTRIBUTES_BY_GROUPID, AttributeCont).
  import { onMount } from "svelte";
  import { portal } from "./portal.ts";
  import { clientTexture } from "./skillGroupIcons.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { resolvedName } from "../store/names.ts";
  import { SKILL_GROUP_ATTRIBUTES, SKILL_GROUP_DESCRIPTIONS, type groupSummary } from "../bridge/skillPlanEditor.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, groupID, name, summary, certificates = null, attributes, top, left }: {
    store: ClientStore;
    flow: AppFlow;
    groupID: number;
    name: string;
    summary: ReturnType<typeof groupSummary>;
    /** Its certificates' levels claimed and of all; null until read. */
    certificates?: { readonly claimed: number; readonly total: number } | null;
    /** The attributes' names (their messages' numbers) and pictures, as read. */
    attributes: ReadonlyMap<number, { readonly displayNameID: number | null; readonly iconFile: string | null }>;
    top: number;
    left: number;
  } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  /** The page's own words, where the install's are not to hand. */
  const OWN: Readonly<Record<string, string>> = {
    "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/SkillLevelsPerGroup": "{[numeric]levelsTrained} of {[numeric]levelsTotal} levels trained",
    "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/SkillLevelsPerGroupDisabled": "{[numeric]levelsTrained} of {[numeric]levelsTotal} levels trained, {[numeric]levelsDisabled} of them past what an alpha clone may use",
    "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/SkillPointsPerGroup": "{[numeric]pointsTrained, useGrouping} of {[numeric]pointsTotal, useGrouping} points",
    "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/CertificatesClaimedPerGroup": "{[numeric]certsTrained} of {[numeric]certsTotal} certificate levels",
  };

  function word(label: string, args: Readonly<Record<string, string | number>> = {}): string {
    const template = $words.templates[label];
    const text = typeof template === "string" ? template : OWN[label] ?? "";
    return plainText(formatTemplate(text, args, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
  }

  function message(messageID: number | null): string {
    const template = messageID === null ? undefined : $words.templates["#" + messageID];
    return typeof template === "string" ? plainText(formatTemplate(template, {}, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") })) : "";
  }

  const descriptionLabel = $derived(SKILL_GROUP_DESCRIPTIONS.get(groupID) ?? null);
  const pair = $derived(SKILL_GROUP_ATTRIBUTES.get(groupID) ?? null);

  onMount(() => {
    flow.requestWords([...Object.keys(OWN), ...SKILL_GROUP_DESCRIPTIONS.values()]);
  });
</script>

<div class="skill-group-tip" role="tooltip" use:portal style:top={`${top}px`} style:left={`${left}px`}>
  <strong>{name}</strong>
  {#if descriptionLabel !== null && word(descriptionLabel) !== ""}<p>{word(descriptionLabel)}</p>{/if}
  <p>{summary.levelsDisabled > 0
    ? word("UI/CharacterSheet/CharacterSheetWindow/SkillTabs/SkillLevelsPerGroupDisabled", { levelsTrained: summary.levelsTrained, levelsTotal: summary.levelsTotal, levelsDisabled: summary.levelsDisabled, color: "#fcc207" })
    : word("UI/CharacterSheet/CharacterSheetWindow/SkillTabs/SkillLevelsPerGroup", { levelsTrained: summary.levelsTrained, levelsTotal: summary.levelsTotal })}</p>
  {#if summary.pointsTotal !== null}
    <p>{word("UI/CharacterSheet/CharacterSheetWindow/SkillTabs/SkillPointsPerGroup", { pointsTrained: summary.pointsTrained, pointsTotal: summary.pointsTotal })}</p>
  {/if}
  {#if certificates !== null && certificates.total > 0}
    <p>{word("UI/CharacterSheet/CharacterSheetWindow/SkillTabs/CertificatesClaimedPerGroup", { certsTrained: certificates.claimed, certsTotal: certificates.total })}</p>
  {/if}
  {#if pair !== null}
    <span class="skill-group-tip-attributes">
      {#each pair as attributeID (attributeID)}
        {@const shown = attributes.get(attributeID)}
        <span class="skill-group-tip-attribute">
          {#if shown?.iconFile}<img src={clientTexture(shown.iconFile)} alt="" width="32" height="32" />{/if}
          <span>{message(shown?.displayNameID ?? null)}</span>
        </span>
      {/each}
    </span>
  {/if}
</div>

<style>
  .skill-group-tip { position: fixed; z-index: 60; max-width: 320px; padding: 0.6rem 0.75rem; background: rgba(20, 22, 26, 0.97); border: 1px solid rgba(255, 255, 255, 0.15); pointer-events: none; display: flex; flex-direction: column; gap: 0.35rem; }
  .skill-group-tip p { margin: 0; }
  .skill-group-tip-attributes { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
  .skill-group-tip-attribute { display: flex; align-items: center; gap: 0.25rem; background: rgba(255, 255, 255, 0.1); padding: 0 0.4rem 0 0; }
</style>
