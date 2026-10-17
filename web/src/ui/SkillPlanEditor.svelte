<script lang="ts">
  // The client's skill plan editor (skillPlanEditor/skillPlanEditorPanel.py), for a new personal or corporation plan or
  // a copy of one to edit (skillPlanPanel.OnCreateNewPersonalSkillPlanButton, OnCreateNewCorpSkillPlanButton,
  // OnEditSkillPlanButton: skillPlan.GetCopy()). Its rules
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
  //   the category    a corporation plan's only (HasEditableCategoryID): the overview's Category combo, None and then the
  //                   career paths in the client's table's order (_GetCategoryComboOptions); Clear puts it back to None;
  //                   Save sends it (OnSaveButton: SetCategoryID from the combo)
  //
  //   milestones      the overview's milestone editor (SkillPlanProgressIndicatorEditable and its header): Milestones
  //                   with the count of five, each milestone's kind and name with its Remove Milestone, an empty slot
  //                   while one is free; a skill level dragged from the contents, or a skill from the catalogue, dropped
  //                   on it is added, and on a milestone replaces it after the client's question
  //                   (bridge/skillPlanEditorMilestones.ts); an edited plan's milestones are its own, copied (GetCopy)
  //
  //   the contents' drags   SkillPlanEditorContents OnDropData and OnEntryDropData: a level dragged onto a level moves
  //                   above it, onto the list's end to the end (MoveSkillRequirement, only where the plan stays valid; the
  //                   line where it would land, grey where the move is valid and red where not); with Shift, the skill's
  //                   next level put in above it (where IsSkillInsertionValid) or at the end; a skill from the catalogue
  //                   put in above a level or at the end (InsertSkillRequirement, AppendSkillRequirement)
  //   double clicks   a level's: its skill's next level appended (OnEntryDblClicked); a catalogue skill's: Show Info
  //   selection       a level clicked: selected, the others marked by how they stand to it (OnEntryClicked,
  //                   GetRequirementStateForEntry); Ctrl and a click on the selected one: none
  //   the contents' menu  GetUtilMenu: Copy Skills to Clipboard, Import Skills from Clipboard (its hint the client's
  //                   format examples; the queue's importer, the BFF's port), Clear Skills (and the milestones)
  //
  // Not done: dragging ships, modules and fittings in from other windows, a milestone's level changed in its tooltip,
  // the ring, the catalogue's filter combo, group icons, menu and tooltip, the time and bar of a level.
  import { onMount } from "svelte";
  import { portal } from "./portal.ts";
  import { showInfo } from "./showInfo.ts";
  import { planRowRequirement } from "../bridge/skillPlans.ts";
  import type { SkillPlanValidationFacts } from "../bridge/skillPlanValidation.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { resolvedName } from "../store/names.ts";
  import { romanLevel } from "../bridge/skills.ts";
  import { validateSkillPlan, type SkillLevel } from "../bridge/skillPlanValidation.ts";
  import { milestoneSubType, type Milestone } from "../bridge/skillPlanMilestones.ts";
  import {
    MAX_NUM_MILESTONES, copiedMilestones, dropped, milestonesChanged, typeValidAsMilestone, withMilestoneAdded,
    withMilestoneRemoved, withMilestonesCheckedAgainst, type EditorMilestones,
  } from "../bridge/skillPlanEditorMilestones.ts";
  import type { PersonalSkillPlanEntry } from "../bridge/skillPlans.ts";
  import {
    MAX_PLAN_DESCRIPTION_LENGTH, MAX_PLAN_NAME_LENGTH, canRemoveLevel, canSavePlan, catalogueGroups, catalogueSearch,
    editedPlanDiffers, highestPlanLevel, nextPlanLevel, withLevelAppended, withLevelRemoved, type CatalogueGroup,
    insertionIsValid, moveIsValid, planLevelIndex, withLevelInserted, withLevelMoved, withLevelsAppended,
  } from "../bridge/skillPlanEditor.ts";

  let { store, flow, plan, planCount, onClose, corp = null }: {
    store: ClientStore;
    flow: AppFlow;
    /** The plan edited, or null for a new one. */
    plan: PersonalSkillPlanEntry | null;
    /** How many plans of its kind there are (the new plan's limit): personal ones, or the corporation's. */
    planCount: number;
    /** Gone back, the plan saved or not. */
    onClose: (saved: boolean) => void;
    /** A corporation plan's: its category (null for a new plan, None chosen) and the career paths to choose from. */
    corp?: { readonly categoryID: number | null; readonly categories: readonly { readonly id: number; readonly name: string }[] } | null;
  } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // The Category combo's value (0: None).
  // svelte-ignore state_referenced_locally
  let categoryID = $state(corp?.categoryID ?? 0);

  const OWN: Readonly<Record<string, string>> = {
    "UI/SkillPlan/CopySkillsToClipboard": "Copy the plan's skills",
    "UI/SkillPlan/ImportSkillsFromClipboard": "Add the skills on the clipboard",
    "UI/SkillPlan/ClearSkills": "Take every skill out",
    "UI/SkillQueue/ImportSkillplanFormatHint": "One skill to a line, its name and then its level: {[item]typeID.name} 3, or {[item]typeID.name} III",
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
    "UI/Common/Category": "Category",
    "UI/Generic/None": "None",
    "UI/SkillPlan/EnterPlanName": "The plan's name",
    "UI/SkillPlan/EnterPlanDescription": "What the plan is for",
    "UI/Inventory/Clear": "Clear",
    "UI/Common/Buttons/Save": "Save",
    "Tooltips/SkillPlanner/CantSaveTooltip": "A plan wants a name and a skill before it is saved.",
    "UI/InfoWindow/RequiredSkillNameAndLevel": "{[item]skill.name} {level}",
    "UI/SkillPlan/Milestones": "Milestones",
    "UI/SkillPlan/SkillMilestonesDescText": "Points of the plan worth reaching on the way.",
    "UI/SkillPlan/RemoveMilestone": "Remove",
    "UI/SkillPlan/AddingMilestones": "Adding milestones",
    "UI/SkillPlan/MilestonesDragDropInformation": "Drag a skill or a level of one here to make it a milestone.",
    "UI/SkillPlan/MilestoneShip": "Ship",
    "UI/SkillPlan/MilestoneSkill": "Skill",
    "UI/SkillPlan/MilestoneModule": "Module",
    "UI/SkillPlan/MilestoneOther": "Other",
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

  // The milestones (to add, and the plan's ids to delete), the plan's own as read, and the types' facts read.
  let milestones = $state<EditorMilestones>({ toAdd: [], toDelete: [] });
  let persisted = $state<readonly Milestone[]>([]);
  let typeFacts = $state<{ required: Record<number, readonly (readonly [number, number])[]>; categoryID: Map<number, number | null> }>({ required: {}, categoryID: new Map() });
  const newMilestoneID = (): string => crypto.randomUUID();

  async function readTypeFacts(typeIDs: readonly number[]): Promise<boolean> {
    const missing = [...new Set(typeIDs)].filter((typeID) => !typeFacts.categoryID.has(typeID));
    if (missing.length === 0) return true;
    flow.requestNames(missing.map((typeID) => ({ kind: "type" as const, id: typeID })));
    const read = await flow.skillPlanTypeFacts(missing).catch(() => null);
    if (read === null) return false;
    typeFacts = { required: { ...typeFacts.required, ...read.required }, categoryID: new Map([...typeFacts.categoryID, ...read.categoryID]) };
    return true;
  }

  const MILESTONE_KIND_LABELS = {
    ship: "UI/SkillPlan/MilestoneShip",
    module: "UI/SkillPlan/MilestoneModule",
    skill: "UI/SkillPlan/MilestoneSkill",
    other: "UI/SkillPlan/MilestoneOther",
  } as const;

  function milestoneName(milestone: Milestone): string {
    return milestone.kind === "skill"
      ? word("UI/InfoWindow/RequiredSkillNameAndLevel", { skill: milestone.typeID, level: romanLevel(milestone.level), levelColor: "#ffffff" })
      : resolvedName($names.resolved, "type", milestone.typeID, "");
  }

  // GetSkillsRequiring for the plan's skills, as read.
  let requiring = $state(new Map<number, ReadonlyMap<number, readonly number[]>>());
  let contentsFilter = $state("");

  // ---- The contents' drags, double clicks, selection and menu (SkillPlanEditorContents, SkillPlanEditorSkillEntry) ----

  /** What is being dragged here: a level of the plan (SkillLevelDragData) or a catalogue skill (a type's, level null). */
  let dragging = $state<{ readonly typeID: number; readonly level: number | null } | null>(null);
  /** The plan's skills' validation facts, read as a drag begins, for the drop line's colour. */
  let dragFacts: SkillPlanValidationFacts | null = null;
  /** DragIndicatorLine: above a level (its index in the plan) or at the list's end, grey where the drop is a valid move and red where not. */
  let dropLine = $state<{ readonly at: number | "end"; readonly valid: boolean } | null>(null);

  function draggedOf(event: DragEvent): { readonly typeID: number; readonly level: number | null } | null {
    if (dragging !== null) return dragging;
    const raw = event.dataTransfer?.getData("application/x-evejs-skill-level");
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as { typeID?: unknown; level?: unknown };
      return typeof data.typeID === "number" ? { typeID: data.typeID, level: typeof data.level === "number" ? data.level : null } : null;
    } catch {
      return null;
    }
  }

  function dragEnd(): void {
    dragging = null;
    dropLine = null;
  }

  /** The validation facts of the plan's skills and those given, or null where the client's data could not be read. */
  async function factsWith(typeIDs: readonly number[]): Promise<SkillPlanValidationFacts | null> {
    return flow.skillPlanValidationFor([...new Set([...requirements.map(([skill]) => skill), ...typeIDs])]).catch(() => null);
  }

  /** OnEntryDragEnter: the line above the level, its colour by whether a level dragged may move there. */
  function rowDragOver(event: DragEvent, skill: number, level: number): void {
    if (!event.dataTransfer?.types.includes("application/x-evejs-skill-level")) return;
    event.preventDefault();
    event.stopPropagation();
    const at = planLevelIndex(requirements, skill, level);
    let valid = true;
    if (dragging !== null && dragging.level !== null && dragFacts !== null) {
      valid = moveIsValid(requirements, planLevelIndex(requirements, dragging.typeID, dragging.level), at, dragFacts);
    }
    dropLine = { at, valid };
  }

  /** OnScrollDragEnter: the line at the list's end, as a level moved to the end would land. */
  function contentsDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes("application/x-evejs-skill-level")) return;
    event.preventDefault();
    let valid = true;
    if (dragging !== null && dragging.level !== null && dragFacts !== null) {
      valid = moveIsValid(requirements, planLevelIndex(requirements, dragging.typeID, dragging.level), requirements.length, dragFacts);
    }
    dropLine = { at: "end", valid };
  }

  /** OnEntryDropData: dropped on a level. */
  async function rowDrop(event: DragEvent, above: SkillLevel): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const data = draggedOf(event);
    const shift = event.shiftKey;
    dragEnd();
    if (data === null || working) return;
    working = true;
    try {
      const facts = await factsWith([data.typeID]);
      if (facts === null) {
        note = "The client's skill data could not be read: the plan was not changed.";
        return;
      }
      if (data.level !== null) {
        if (shift) {
          // The skill's next level put in above it, where the plan would stay valid (IsSkillInsertionValid).
          const next = nextPlanLevel(requirements, data.typeID);
          if (data.level < 5 && next !== null && insertionIsValid(requirements, data.typeID, next, planLevelIndex(requirements, above[0], above[1]), facts)) {
            requirements = withLevelInserted(requirements, data.typeID, next, above, facts);
          }
        } else {
          requirements = withLevelMoved(requirements, data.typeID, data.level, above, facts) ?? requirements;
        }
      } else {
        // A skill from the catalogue (a type's drag, a skill): its next level put in above (InsertSkillRequirement).
        requirements = withLevelInserted(requirements, data.typeID, null, above, facts);
      }
      await readRequiring();
    } finally {
      working = false;
    }
  }

  /** OnDropData: dropped on the list, not on a level. */
  async function contentsDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const data = draggedOf(event);
    const shift = event.shiftKey;
    dragEnd();
    if (data === null || working) return;
    working = true;
    try {
      const facts = await factsWith([data.typeID]);
      if (facts === null) {
        note = "The client's skill data could not be read: the plan was not changed.";
        return;
      }
      if (data.level !== null) {
        if (shift) {
          if (data.level < 5) requirements = withLevelAppended(requirements, data.typeID, facts);
        } else {
          // _MoveEntryToBottom.
          requirements = withLevelMoved(requirements, data.typeID, data.level, null, facts) ?? requirements;
        }
      } else {
        requirements = withLevelAppended(requirements, data.typeID, facts);
      }
      await readRequiring();
    } finally {
      working = false;
    }
  }

  // OnEntryClicked: the level clicked selected, the others marked by how they stand to it.
  let selection = $state<{
    readonly skill: number;
    readonly level: number;
    readonly prereqs: ReadonlyMap<number, number>;
    readonly requiredFor: ReadonlySet<number>;
  } | null>(null);
  async function selectLevel(skill: number, level: number, ctrlKey: boolean): Promise<void> {
    if (ctrlKey && selection !== null && selection.skill === skill && selection.level === level) {
      selection = null;
      return;
    }
    // GetPreReqsAndRequiredForSkillLevel: get_dogma_required_skills and GetSkillsRequiring(skill, level).
    const [facts, requiringRead] = await Promise.all([
      flow.skillPlanTypeFacts([skill]).catch(() => null),
      flow.skillsRequiring([skill]).catch(() => null),
    ]);
    selection = {
      skill,
      level,
      prereqs: new Map(facts?.required[skill] ?? []),
      requiredFor: new Set(requiringRead?.get(skill)?.get(level) ?? []),
    };
  }
  /** ReconstructScrollEntries: the selection kept while its level is in the plan. */
  function levelMark(skill: number, level: number): "selected" | "marked" | null {
    const chosen = selection;
    if (chosen === null || planLevelIndex(requirements, chosen.skill, chosen.level) < 0) return null;
    if (chosen.skill === skill && chosen.level === level) return "selected";
    return planRowRequirement(chosen, { skill, level }, chosen.prereqs, chosen.requiredFor) === null ? null : "marked";
  }

  // GetUtilMenu: Copy Skills to Clipboard, Import Skills from Clipboard, Clear Skills.
  let contentsMenu = $state<{ readonly left: number; readonly top: number } | null>(null);
  function openContentsMenu(event: MouseEvent): void {
    if (contentsMenu !== null) {
      contentsMenu = null;
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    contentsMenu = { left: Math.max(8, rect.right - 240), top: rect.bottom + 4 };
  }
  $effect(() => {
    if (contentsMenu === null) return;
    const close = (event: Event): void => {
      if (!(event.target instanceof Element && event.target.closest(".plan-editor-contents-menu, .plan-editor-menu-button"))) contentsMenu = null;
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") contentsMenu = null;
    };
    const timer = setTimeout(() => {
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", key);
    });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  });
  /** CopySkillsToClipboard: GetRequirementsClipboardText, each level "name level" and a new line. */
  function copySkills(): void {
    contentsMenu = null;
    const text = requirements.map(([typeID, level]) => `${resolvedName($names.resolved, "type", typeID, String(typeID))} ${level}\n`).join("");
    void navigator.clipboard?.writeText(text).catch(() => {});
  }
  /** ImportSkillsFromClipboard: the clipboard read as the queue's importer reads it, its levels appended. */
  async function importSkills(): Promise<void> {
    contentsMenu = null;
    if (working) return;
    const text = await navigator.clipboard?.readText().catch(() => null);
    if (typeof text !== "string" || text === "") return;
    working = true;
    note = "";
    try {
      const levels = await flow.skillPlanImportText(text);
      if (levels === null) {
        note = "The clipboard's skills could not be read.";
        return;
      }
      if (levels.length === 0) return;
      const facts = await factsWith(levels.map(([typeID]) => typeID));
      if (facts === null) {
        note = "The client's skill data could not be read: the plan was not changed.";
        return;
      }
      requirements = withLevelsAppended(requirements, levels, facts);
      await readRequiring();
    } finally {
      working = false;
    }
  }
  /** ClearSkills: every level out, and the milestones (ClearMilestones). */
  function clearSkills(): void {
    contentsMenu = null;
    requirements = [];
    milestones = milestones.toAdd.reduce((out, milestone) => withMilestoneRemoved(out, milestone.id), milestones);
    selection = null;
  }

  onMount(() => {
    flow.requestWords(Object.keys(OWN));
    // ImportSkillplanFormatHint's skill: appConst.typeSpaceshipCommand.
    flow.requestNames([{ kind: "type", id: 3327 }]);
    void (async () => {
      const catalogue = await flow.skillCatalogue();
      groups = catalogue ? catalogueGroups(catalogue.skills, (typeID) => catalogue.held.has(typeID)) : null;
      if (groups && groups.length > 0) selectedGroupID = groups[0]!.groupID;
    })();
    void readRequiring();
    // GetCopy: an edited plan's milestones, copied.
    if (plan) {
      const editedPlan = plan;
      void (async () => {
        const read = await flow.skillPlanMilestones(editedPlan, corp ? "corporation" : "character").catch(() => null);
        if (!read) return;
        persisted = read.milestones;
        milestones = copiedMilestones(read.milestones, newMilestoneID);
        await readTypeFacts(read.milestones.map((milestone) => milestone.typeID));
      })();
    }
  });

  /** A skill level, or a skill, dragged (skillPlanUtil: SkillLevelDragData, or a type's). */
  function dragStart(event: DragEvent, typeID: number, level: number | null): void {
    event.dataTransfer?.setData("application/x-evejs-skill-level", JSON.stringify({ typeID, level }));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
    dragging = { typeID, level };
    dragFacts = null;
    void factsWith([typeID]).then((facts) => {
      if (dragging !== null && dragging.typeID === typeID && dragging.level === level) dragFacts = facts;
    });
  }

  function dragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes("application/x-evejs-skill-level")) event.preventDefault();
  }

  /** SkillPlanProgressIndicatorEditable._OnDataDropped and SkillPlanEditorOverview.OnMilestoneDataDropped. */
  async function dropMilestone(event: DragEvent, onMilestoneID: string | null): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const raw = event.dataTransfer?.getData("application/x-evejs-skill-level");
    if (!raw || working) return;
    let data: { typeID: number; level: number | null };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    working = true;
    note = "";
    try {
      if (!(await readTypeFacts([data.typeID]))) {
        note = "The client's data for that could not be read.";
        return;
      }
      const categoryID = typeFacts.categoryID.get(data.typeID) ?? null;
      const what = dropped(data.typeID, data.level, categoryID);
      if (!typeValidAsMilestone(categoryID, (typeFacts.required[data.typeID] ?? []).length > 0)) {
        flow.sayCantAddAsMilestone();
        return;
      }
      let current = milestones;
      const old = onMilestoneID === null ? undefined : current.toAdd.find((each) => each.id === onMilestoneID);
      if (old) {
        // evetypes.GetName of each: the type, or the skill.
        if (!(await flow.askReplaceMilestone(resolvedName($names.resolved, "type", old.typeID, ""), resolvedName($names.resolved, "type", what.typeID, "")))) return;
        current = withMilestoneRemoved(current, old.id);
      }
      const added = withMilestoneAdded(current, requirements, what.typeID, what.level, typeFacts.required, newMilestoneID);
      if (added === null) {
        milestones = current;
        return;
      }
      const facts = await flow.skillPlanValidationFor([...new Set(added.list.map(([skill]) => skill))]);
      if (facts === null) {
        note = "The client's skill data could not be read: the plan was not changed.";
        return;
      }
      const list = added.list;
      validateSkillPlan(list, facts);
      requirements = list;
      milestones = added.milestones;
      await readRequiring();
    } catch {
      note = "That could not be made a milestone.";
    } finally {
      working = false;
    }
  }

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
      // RemoveSkillRequirement: the level out, the milestones that then lack a skill out (_CheckRemoveMilestones), then
      // the plan put right.
      const without = requirements.filter(([skill, l]) => !(skill === typeID && l === level));
      if (milestones.toAdd.length > 0 && (await readTypeFacts(milestones.toAdd.map((milestone) => milestone.typeID)))) {
        milestones = withMilestonesCheckedAgainst(milestones, without, typeFacts.required);
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
    milestones = milestones.toAdd.reduce((out, milestone) => withMilestoneRemoved(out, milestone.id), milestones);
    name = "";
    categoryID = 0;
    description = "";
  }

  /** SkillPlanEditorPanel.OnBack */
  async function back(): Promise<void> {
    const changed = editedPlanDiffers(plan, edited) || milestonesChanged(milestones, plan ? persisted : null);
    if (changed && !(await flow.askLeaveSkillPlanEditor())) return;
    onClose(false);
  }

  /** SkillPlanEditorOverview.OnSaveButton */
  async function save(): Promise<void> {
    if (saving || !canSavePlan(edited)) return;
    saving = true;
    try {
      const corpSave = corp ? { categoryID, savedCategoryID: corp.categoryID } : undefined;
      if (await flow.saveSkillPlan(edited, plan, planCount, { milestones, persisted }, corpSave)) onClose(true);
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
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <li draggable="true" ondragstart={(event) => dragStart(event, skill.typeID, null)} ondragend={dragEnd}
              ondblclick={(event) => { if (!(event.target instanceof Element && event.target.closest("button"))) showInfo({ kind: "type", typeID: skill.typeID }); }}>
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
        <button type="button" class="plan-editor-menu-button" aria-haspopup="menu" aria-expanded={contentsMenu !== null} onclick={openContentsMenu}>☰</button>
      </div>
      {#if contentsMenu !== null}
        <span class="hull-menu plan-editor-contents-menu" role="menu" use:portal style:left={`${contentsMenu.left}px`} style:top={`${contentsMenu.top}px`}>
          <button type="button" role="menuitem" onclick={copySkills}>{word("UI/SkillPlan/CopySkillsToClipboard")}</button>
          <button type="button" role="menuitem" title={word("UI/SkillQueue/ImportSkillplanFormatHint", { typeID: 3327 })} onclick={() => void importSkills()}>{word("UI/SkillPlan/ImportSkillsFromClipboard")}</button>
          <button type="button" role="menuitem" onclick={clearSkills}>{word("UI/SkillPlan/ClearSkills")}</button>
        </span>
      {/if}
      {#if requirements.length === 0}
        <p class="empty plan-editor-hint">{word("UI/SkillPlan/NoSkillsInPlanHint")}</p>
      {:else if shownRows.length === 0}
        <p class="empty">{word("UI/CharacterSheet/CharacterSheetWindow/SkillTabs/NoSkillsMatchingFilters")}</p>
      {:else}
        <ul class="plan-editor-rows" ondragover={contentsDragOver} ondrop={(event) => void contentsDrop(event)} ondragleave={(event) => { if (event.target === event.currentTarget) dropLine = null; }}>
          {#each shownRows as [skill, level], at (at)}
            {@const removable = canRemoveLevel(requirements, skill, level, skillsNeeding)}
            {@const mark = levelMark(skill, level)}
            {@const lineHere = dropLine !== null && dropLine.at === planLevelIndex(requirements, skill, level)}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <li draggable="true" ondragstart={(event) => dragStart(event, skill, level)} ondragend={dragEnd}
              class:selected={mark === "selected"} class:marked={mark === "marked"} class:drop-above={lineHere} class:drop-invalid={lineHere && dropLine?.valid === false}
              ondragover={(event) => rowDragOver(event, skill, level)} ondrop={(event) => void rowDrop(event, [skill, level])}
              onclick={(event) => { if (!(event.target instanceof Element && event.target.closest("button"))) void selectLevel(skill, level, event.ctrlKey); }}
              onkeydown={(event) => { if (event.key === "Enter") void selectLevel(skill, level, event.ctrlKey); }}
              ondblclick={(event) => { if (!(event.target instanceof Element && event.target.closest("button"))) void addLevel(skill); }}>
              <span>{word("UI/InfoWindow/RequiredSkillNameAndLevel", { skill, level: romanLevel(level), levelColor: "#ffffff" })}</span>
              <button type="button" class="plan-editor-remove" disabled={!removable || working}
                title={word(removable ? "UI/SkillPlan/RemoveFromPlan" : "UI/SkillPlan/RemoveFromPlanLocked")}
                aria-label={word(removable ? "UI/SkillPlan/RemoveFromPlan" : "UI/SkillPlan/RemoveFromPlanLocked")}
                onclick={() => void removeLevel(skill, level)}>✕</button>
            </li>
          {/each}
          {#if dropLine !== null && dropLine.at === "end"}
            <li class="plan-editor-drop-end" class:drop-invalid={!dropLine.valid} aria-hidden="true"></li>
          {/if}
        </ul>
      {/if}
    </section>
    <section class="plan-editor-overview">
      <div class="plan-editor-milestones" role="list" aria-label={word("UI/SkillPlan/Milestones")} ondragover={dragOver} ondrop={(event) => void dropMilestone(event, null)}>
        <div class="plan-editor-milestones-head">
          <span title={word("UI/SkillPlan/SkillMilestonesDescText")}>{word("UI/SkillPlan/Milestones")}</span>
          <span class="plan-editor-counter">{milestones.toAdd.length}/{MAX_NUM_MILESTONES}</span>
        </div>
        {#each milestones.toAdd as milestone (milestone.id)}
          <div class="plan-editor-milestone" role="listitem" ondragover={dragOver} ondrop={(event) => void dropMilestone(event, milestone.id)}>
            <span class="plan-editor-milestone-kind">{word(MILESTONE_KIND_LABELS[milestoneSubType(typeFacts.categoryID.get(milestone.typeID) ?? null)])}</span>
            <span class="plan-editor-milestone-name">{milestoneName(milestone)}</span>
            <button type="button" title={word("UI/SkillPlan/RemoveMilestone")} aria-label={word("UI/SkillPlan/RemoveMilestone")}
              onclick={() => { milestones = withMilestoneRemoved(milestones, milestone.id); }}>✕</button>
          </div>
        {/each}
        {#if milestones.toAdd.length < MAX_NUM_MILESTONES}
          <div class="plan-editor-milestone-slot" role="listitem" title={word("UI/SkillPlan/AddingMilestones") + "\n" + word("UI/SkillPlan/MilestonesDragDropInformation")}>+</div>
        {/if}
      </div>
      <label for="plan-editor-name">{word("UI/Common/Name")}</label>
      <div class="plan-editor-name">
        <input id="plan-editor-name" type="text" maxlength={MAX_PLAN_NAME_LENGTH} placeholder={word("UI/SkillPlan/EnterPlanName")} bind:value={name} />
        <span class="plan-editor-counter">{name.length}/{MAX_PLAN_NAME_LENGTH}</span>
      </div>
      <label for="plan-editor-description">{word("UI/Common/Description")}</label>
      <textarea id="plan-editor-description" rows="6" maxlength={MAX_PLAN_DESCRIPTION_LENGTH} placeholder={word("UI/SkillPlan/EnterPlanDescription")} bind:value={description}></textarea>
      {#if corp}
        <label for="plan-editor-category">{word("UI/Common/Category")}</label>
        <select id="plan-editor-category" bind:value={categoryID}>
          <option value={0}>{word("UI/Generic/None")}</option>
          {#each corp.categories as category (category.id)}
            <option value={category.id}>{category.name}</option>
          {/each}
        </select>
      {/if}
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
  .plan-editor-milestones { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.5rem; margin-bottom: 0.75rem; border: 1px dashed var(--line, #555); }
  .plan-editor-milestones-head { display: flex; justify-content: space-between; }
  .plan-editor-milestone { display: flex; align-items: center; gap: 0.5rem; padding: 0.2rem 0.4rem; background: rgba(255, 255, 255, 0.05); }
  .plan-editor-milestone-kind { font-size: 0.75rem; text-transform: uppercase; opacity: 0.7; min-width: 3.5rem; }
  .plan-editor-milestone-name { flex: 1; }
  .plan-editor-milestone-slot { text-align: center; opacity: 0.5; padding: 0.3rem; border: 1px dotted var(--line, #555); }
  .plan-editor-skills li[draggable="true"], .plan-editor-rows li[draggable="true"] { cursor: grab; }
  /* DragIndicatorLine: VALID_LINE_COLOR (0.8 grey) where the drop is a valid move, INVALID_LINE_COLOR (0.7 red) where not. */
  .plan-editor-rows li.drop-above { box-shadow: inset 0 2px 0 #cccccc; }
  .plan-editor-rows li.drop-above.drop-invalid { box-shadow: inset 0 2px 0 #b30000; }
  .plan-editor-rows li.plan-editor-drop-end { min-height: 0; height: 2px; padding: 0; background: #cccccc; }
  .plan-editor-rows li.plan-editor-drop-end.drop-invalid { background: #b30000; }
  /* SkillEntryUnderlay: the level selected, and those standing to it in its hover look. */
  .plan-editor-rows li { cursor: pointer; }
  .plan-editor-rows li.selected { background: rgba(255, 255, 255, 0.16); outline: 1px solid rgba(255, 255, 255, 0.35); }
  .plan-editor-rows li.marked { background: rgba(255, 255, 255, 0.1); }
  .plan-editor-name { display: flex; align-items: center; gap: 0.5rem; }
  .plan-editor-name input { flex: 1; }
  .plan-editor-counter { font-size: 0.8rem; opacity: 0.6; }
  .plan-editor-buttons { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  .plan-editor-buttons button { flex: 1; }
</style>
