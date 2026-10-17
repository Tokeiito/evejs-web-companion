<script lang="ts">
  // The client's skill plan editor (skillPlanEditor/skillPlanEditorPanel.py), for a new personal plan or a copy of one
  // to edit (skillPlanPanel.OnCreateNewPersonalSkillPlanButton, OnEditSkillPlanButton: skillPlan.GetCopy()). Its rules
  // are bridge/skillPlanEditor.ts; every change of the skills goes through the client's validation
  // (bridge/skillPlanValidation.ts, as EditableSkillPlanController does).
  //
  //   Back            ShouldContinueAfterAskingAboutLeavingEditor: AskCloseSkillPlanEditor where the plan was changed
  //   the catalogue   SkillsCataloguePanel: its caption Skills, the text filter, the groups, a group's skills, each
  //                   with its add button (EditorSkillEntryPrimaryButton: the next level, hinted AddSkillLevelToPlan,
  //                   or off with AllLevelsInPlan where V is in the plan)
  //   the contents    SkillPlanEditorContents: the caption Skill Plan and the count of levels, the filter, each level
  //                   ("skill level") with its remove button (EditorSkillLevelEntryPrimaryButton: RemoveFromPlan, or off
  //                   with RemoveFromPlanLocked where it may not go); NoSkillsInPlanHint with none,
  //                   NoSkillsMatchingFilters with none shown
  //   the overview    SkillPlanEditorOverview: Name (50 letters, counted, hinted EnterPlanName), Description (1000
  //                   letters, hinted EnterPlanDescription), Clear (the skills, the name and the description) and Save
  //                   (off with CantSaveTooltip with no skill or no name)
  //
  // Not done: milestones, the category (a corporation plan's), dragging (skills, levels, ships, fittings) and the
  // double clicks, a row's selection marks, the catalogue's filter combo and group icons, the contents' menu (copy,
  // import, clear), the time and bar of a level.
  import { onMount } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { resolvedName } from "../store/names.ts";
  import { romanLevel } from "../bridge/skills.ts";
  import type { SkillLevel } from "../bridge/skillPlanValidation.ts";
  import type { PersonalSkillPlanEntry } from "../bridge/skillPlans.ts";
  import {
    MAX_PLAN_DESCRIPTION_LENGTH, MAX_PLAN_NAME_LENGTH, canRemoveLevel, canSavePlan, catalogueGroups, catalogueSearch,
    editedPlanDiffers, highestPlanLevel, nextPlanLevel, withLevelAppended, withLevelRemoved, type CatalogueGroup,
  } from "../bridge/skillPlanEditor.ts";

  let { store, flow, plan, planCount, onClose }: {
    store: ClientStore;
    flow: AppFlow;
    /** The plan edited, or null for a new one. */
    plan: PersonalSkillPlanEntry | null;
    /** How many personal plans there are (the new plan's limit). */
    planCount: number;
    /** Gone back, the plan saved or not. */
    onClose: (saved: boolean) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  const OWN: Readonly<Record<string, string>> = {
    "UI/SkillPlan/Skills": "Skills",
    "UI/SkillPlan/SkillPlan": "Plan",
    "UI/SkillPlan/AddSkillLevelToPlan": "Put level {skillLevel} of it in the plan",
    "UI/SkillPlan/AllLevelsInPlan": "Every level of it is in the plan",
    "UI/SkillPlan/RemoveFromPlan": "Take this level out of the plan",
    "UI/SkillPlan/RemoveFromPlanLocked": "Another skill in the plan needs this level",
    "UI/SkillPlan/NoSkillsInPlanHint": "No skill is in the plan yet.",
    "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/NoSkillsMatchingFilters": "No skill shown with these filters",
    "UI/Common/Name": "Name",
    "UI/Common/Description": "Description",
    "UI/SkillPlan/EnterPlanName": "The plan's name",
    "UI/SkillPlan/EnterPlanDescription": "What the plan is for",
    "UI/Inventory/Clear": "Clear",
    "UI/Common/Buttons/Save": "Save",
    "Tooltips/SkillPlanner/CantSaveTooltip": "A plan wants a name and a skill before it is saved.",
    "UI/InfoWindow/RequiredSkillNameAndLevel": "{[item]skill.name} {level}",
  };

  function word(label: string, args: Readonly<Record<string, string | number>> = {}): string {
    const template = $words.templates[label];
    const text = typeof template === "string" ? template : OWN[label];
    return text === undefined ? "" : plainText(formatTemplate(text, args, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
  }

  // The plan as edited (a copy: nothing is saved until Save).
  // svelte-ignore state_referenced_locally
  let name = $state(plan?.name ?? "");
  // svelte-ignore state_referenced_locally
  let description = $state(plan?.description ?? "");
  // svelte-ignore state_referenced_locally
  let requirements = $state<SkillLevel[]>(plan ? plan.requirements.map(([skill, level]) => [skill, level] as const) : []);
  let saving = $state(false);
  let working = $state(false);
  let note = $state("");

  const edited = $derived({ name, description, requirements });

  // The catalogue.
  let groups = $state<CatalogueGroup[] | null | undefined>(undefined);
  let selectedGroupID = $state<number | null>(null);
  let catalogueFilter = $state("");
  const shownSkills = $derived(
    !groups ? [] : catalogueFilter !== "" ? catalogueSearch(groups, catalogueFilter) : groups.find((group) => group.groupID === selectedGroupID)?.skills ?? [],
  );

  // GetSkillsRequiring for the plan's skills, as read.
  let requiring = $state(new Map<number, ReadonlyMap<number, readonly number[]>>());
  let contentsFilter = $state("");

  onMount(() => {
    flow.requestWords(Object.keys(OWN));
    void (async () => {
      const catalogue = await flow.skillCatalogue();
      groups = catalogue ? catalogueGroups(catalogue.skills, (typeID) => catalogue.held.has(typeID)) : null;
      if (groups && groups.length > 0) selectedGroupID = groups[0]!.groupID;
    })();
    void readRequiring();
  });

  async function readRequiring(): Promise<void> {
    const skills = [...new Set(requirements.map(([skill]) => skill))];
    flow.requestNames(skills.map((skill) => ({ kind: "type" as const, id: skill })));
    const missing = skills.filter((skill) => !requiring.has(skill));
    if (missing.length === 0) return;
    const read = await flow.skillsRequiring(missing).catch(() => null);
    if (read) requiring = new Map([...requiring, ...read]);
  }

  const skillsNeeding = (typeID: number, level: number): readonly number[] => requiring.get(typeID)?.get(level) ?? [];

  /** EditorSkillEntryPrimaryButton.OnClickFunc */
  async function addLevel(typeID: number): Promise<void> {
    if (working) return;
    working = true;
    note = "";
    try {
      const facts = await flow.skillPlanValidationFor([...new Set([...requirements.map(([skill]) => skill), typeID])]);
      if (facts === null) {
        note = "The client's skill data could not be read: the plan was not changed.";
        return;
      }
      requirements = withLevelAppended(requirements, typeID, facts);
      await readRequiring();
    } catch {
      note = "That level could not be put in the plan.";
    } finally {
      working = false;
    }
  }

  /** EditorSkillLevelEntryPrimaryButton._Remove */
  async function removeLevel(typeID: number, level: number): Promise<void> {
    if (working) return;
    working = true;
    note = "";
    try {
      const facts = await flow.skillPlanValidationFor([...new Set(requirements.map(([skill]) => skill))]);
      if (facts === null) {
        note = "The client's skill data could not be read: the plan was not changed.";
        return;
      }
      requirements = withLevelRemoved(requirements, typeID, level, facts);
    } catch {
      note = "That level could not be taken out.";
    } finally {
      working = false;
    }
  }

  /** SkillPlanEditorOverview.OnClearButton */
  function clear(): void {
    requirements = [];
    name = "";
    description = "";
  }

  /** SkillPlanEditorPanel.OnBack */
  async function back(): Promise<void> {
    if (editedPlanDiffers(plan, edited) && !(await flow.askLeaveSkillPlanEditor())) return;
    onClose(false);
  }

  /** SkillPlanEditorOverview.OnSaveButton */
  async function save(): Promise<void> {
    if (saving || !canSavePlan(edited)) return;
    saving = true;
    try {
      if (await flow.saveSkillPlan(edited, plan, planCount)) onClose(true);
    } finally {
      saving = false;
    }
  }

  const shownRows = $derived(
    requirements.filter(([skill]) => contentsFilter === "" || resolvedName($names.resolved, "type", skill, "").toLowerCase().includes(contentsFilter.toLowerCase())),
  );
</script>

<div class="plan-editor">
  <div class="plan-editor-head">
    <button type="button" class="plan-editor-back" aria-label="Back" onclick={() => void back()}>←</button>
  </div>
  {#if note}
    <p class="note">{note}</p>
  {/if}
  <div class="plan-editor-body">
    <section class="plan-editor-catalogue">
      <div class="plan-editor-caption">
        <h3>{word("UI/SkillPlan/Skills")}</h3>
        <input type="search" bind:value={catalogueFilter} aria-label="Filter skills" />
      </div>
      {#if groups === undefined}
        <p class="note">Reading the skills…</p>
      {:else if groups === null}
        <p class="error">The skills could not be read.</p>
      {:else}
        <div class="plan-editor-groups" role="tablist">
          {#each groups as group (group.groupID)}
            <button type="button" role="tab" aria-selected={catalogueFilter === "" && selectedGroupID === group.groupID}
              class:selected={catalogueFilter === "" && selectedGroupID === group.groupID}
              onclick={() => { catalogueFilter = ""; selectedGroupID = group.groupID; }}>{group.name}</button>
          {/each}
        </div>
        <ul class="plan-editor-skills">
          {#each shownSkills as skill (skill.typeID)}
            {@const next = nextPlanLevel(requirements, skill.typeID)}
            {@const full = highestPlanLevel(requirements, skill.typeID) === 5}
            <li>
              <span>{skill.name}</span>
              <button type="button" class="plan-editor-add" disabled={full || working}
                title={full ? word("UI/SkillPlan/AllLevelsInPlan") : word("UI/SkillPlan/AddSkillLevelToPlan", { skillLevel: next ?? 1 })}
                aria-label={full ? word("UI/SkillPlan/AllLevelsInPlan") : word("UI/SkillPlan/AddSkillLevelToPlan", { skillLevel: next ?? 1 })}
                onclick={() => void addLevel(skill.typeID)}>+</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
    <section class="plan-editor-contents">
      <div class="plan-editor-caption">
        <h3>{word("UI/SkillPlan/SkillPlan")} <span class="plan-editor-count">{requirements.length}</span></h3>
        <input type="search" bind:value={contentsFilter} aria-label="Filter the plan" />
      </div>
      {#if requirements.length === 0}
        <p class="empty plan-editor-hint">{word("UI/SkillPlan/NoSkillsInPlanHint")}</p>
      {:else if shownRows.length === 0}
        <p class="empty">{word("UI/CharacterSheet/CharacterSheetWindow/SkillTabs/NoSkillsMatchingFilters")}</p>
      {:else}
        <ul class="plan-editor-rows">
          {#each shownRows as [skill, level], at (at)}
            {@const removable = canRemoveLevel(requirements, skill, level, skillsNeeding)}
            <li>
              <span>{word("UI/InfoWindow/RequiredSkillNameAndLevel", { skill, level: romanLevel(level), levelColor: "#ffffff" })}</span>
              <button type="button" class="plan-editor-remove" disabled={!removable || working}
                title={word(removable ? "UI/SkillPlan/RemoveFromPlan" : "UI/SkillPlan/RemoveFromPlanLocked")}
                aria-label={word(removable ? "UI/SkillPlan/RemoveFromPlan" : "UI/SkillPlan/RemoveFromPlanLocked")}
                onclick={() => void removeLevel(skill, level)}>✕</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
    <section class="plan-editor-overview">
      <label for="plan-editor-name">{word("UI/Common/Name")}</label>
      <div class="plan-editor-name">
        <input id="plan-editor-name" type="text" maxlength={MAX_PLAN_NAME_LENGTH} placeholder={word("UI/SkillPlan/EnterPlanName")} bind:value={name} />
        <span class="plan-editor-counter">{name.length}/{MAX_PLAN_NAME_LENGTH}</span>
      </div>
      <label for="plan-editor-description">{word("UI/Common/Description")}</label>
      <textarea id="plan-editor-description" rows="6" maxlength={MAX_PLAN_DESCRIPTION_LENGTH} placeholder={word("UI/SkillPlan/EnterPlanDescription")} bind:value={description}></textarea>
      <div class="plan-editor-buttons">
        <button type="button" onclick={clear}>{word("UI/Inventory/Clear")}</button>
        <button type="button" class="primary" disabled={!canSavePlan(edited) || saving || working}
          title={canSavePlan(edited) ? undefined : word("Tooltips/SkillPlanner/CantSaveTooltip")}
          onclick={() => void save()}>{word("UI/Common/Buttons/Save")}</button>
      </div>
    </section>
  </div>
</div>

<style>
  .plan-editor { display: flex; flex-direction: column; gap: 0.5rem; }
  .plan-editor-back { align-self: flex-start; }
  .plan-editor-body { display: grid; grid-template-columns: minmax(14rem, 1fr) minmax(14rem, 1fr) minmax(12rem, 0.8fr); gap: 1rem; align-items: start; }
  .plan-editor-caption { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .plan-editor-caption h3 { margin: 0; }
  .plan-editor-count { opacity: 0.6; font-size: 0.9em; }
  .plan-editor-groups { display: flex; flex-wrap: wrap; gap: 0.25rem; margin: 0.5rem 0; }
  .plan-editor-groups button.selected { outline: 1px solid currentColor; }
  .plan-editor-skills, .plan-editor-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; max-height: 28rem; overflow-y: auto; }
  .plan-editor-skills li, .plan-editor-rows li { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; padding: 0.2rem 0.5rem; background: rgba(255, 255, 255, 0.04); }
  .plan-editor-hint { white-space: pre-line; }
  .plan-editor-overview { display: flex; flex-direction: column; gap: 0.35rem; }
  .plan-editor-name { display: flex; align-items: center; gap: 0.5rem; }
  .plan-editor-name input { flex: 1; }
  .plan-editor-counter { font-size: 0.8rem; opacity: 0.6; }
  .plan-editor-buttons { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .plan-editor-buttons button { flex: 1; }
</style>
