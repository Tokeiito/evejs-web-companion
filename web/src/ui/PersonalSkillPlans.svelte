<script lang="ts">
  // The client's Personal Plans (skillPlan/browser/personalPlansPanel.py), in the Skills window: the pilot's own skill
  // plans, read on the public gateway as the client reads them (flow.personalSkillPlans: GetAll, each plan by Get,
  // GetActive for the tracked one), sorted by name (SkillPlanScroll: localization.util.Sort).
  //
  // Each plan's entry is SkillPlanEntry's: its name; the time left to train it (GetTotalTrainingTimeLeftText:
  // FormatTimeIntervalShortWritten from the day, to the hour above a day, the minute above an hour, else the second),
  // or Completed, green, with the completed mark; the tracked mark (UpdateTrackedIcon), its hint Tracked Skill Plan;
  // and its menu's Delete (the client's DeleteSkillPlan question, then Delete). With none, the panel's hint "no
  // personal plans"; where the gateway could not be had, the client's connection error (_GetSkillPlans).
  //
  // A plan clicked opens (SkillPlanEntry.OnClick; selectedPlan/selectedSkillPlanContainer.py), in the list's place:
  // the caption Skill Plan and the plan's name (MilestoneIndicatorHeader), its close; Delete (its hint DeletePlan,
  // the same question) and Track (OnTrackButton, _ToggleTracked: SetActive with the plan, or with none where it is
  // tracked; its hint TrackPlanHint or UntrackPlanHint, its icon look_at or camera_untrack); Show and Hide Skill Plan
  // Contents; the Skill Plan Completed banner where the plan is completed; and the description. The contents
  // (contents/skillPlanContents.py): the caption, Hide Trained Skills (settings.char.ui SkillPlanContentsHideTrained,
  // on unless turned off), the filter on the skill's name, and each of the plan's skill levels in its order
  // (SkillPlanContentsSkillEntry): the skill bar for the level, "skill level" (RequiredSkillNameAndLevel) and the
  // level's training time, faint (GetTrainingTimeForLevelText: from the day to the minute); with none shown,
  // NoSkillsMatchingFilters.
  //
  // At its foot, hidden where the plan is completed (UpdateComponents), the locked panel (SkillPlanLockedCont): the
  // books button, its count of books missing in red where any are (its hint SkillbooksMissing, or
  // NoSkillbooksMissing), which shows the contents (onMissingSkillsButtonSignal); the omega button only where the plan
  // is omega locked (its hint OmegaMissing), with the lock. Then Start Training (UpdateStartTrainingButton): off where
  // the plan cannot be trained (StartTrainingLockedHint) or has nothing left to train
  // (StartTrainingNothingToTrainHint), else StartTrainingHint. It adds the plan's levels left to the queue and starts
  // it, then tracks the plan (at once where none is tracked; on the client's AskTrackPlan question where another is),
  // and says SkillsAddedNotification where levels were added (TrainSkills; the client's notice, said here in the view).
  //
  // Create (CreatePersonalPlanButton, under the plans or alone where there are none: off where there are ten,
  // MaximumSkillPlanReached; its tooltip CreatePersonalSkillPlan and PlansInTotal), the opened plan's Edit (its hint
  // EditPlan) and an entry's menu's Edit open the editor (SkillPlanEditor.svelte) in the list's place, on a new plan
  // or a copy of the plan; a save goes back to the list, read again (OnSkillPlanCreated, OnSkillPlanSaved).
  //
  // Not done: Save and Share, the omega button's upgrade window, the progress gauge and milestones, the faction and
  // career icons, the omega mark and banner, the missing books' buy button, a level's add-to-queue button, a skill
  // row's selection, menu, tooltip and drag, the contents' menu (copy to clipboard), the tooltip and drag of an entry,
  // and the Certified and Corporation plans.
  import { onMount } from "svelte";
  import SkillPlanEditor from "./SkillPlanEditor.svelte";
  import { MAX_PERSONAL_PLANS } from "../bridge/skillPlans.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { resolvedName } from "../store/names.ts";
  import { romanLevel } from "../bridge/skills.ts";
  import { shortWrittenInterval, SHORT_INTERVAL_WORD_LABELS } from "../bridge/timeInterval.ts";
  import {
    skillPlanRowVisible, sortPlansByName, startTrainingState, timeLeftShowTo,
    type PersonalSkillPlanEntry, type PersonalSkillPlansRead, type SkillPlanDetail,
  } from "../bridge/skillPlans.ts";
  import { milestoneLastSkillIndex, type MilestoneEntry } from "../bridge/skillPlanMilestones.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  /** The page's own words, where the install's are not to hand. */
  const OWN: Readonly<Record<string, string>> = {
    "UI/SkillPlan/PersonalPlans": "My own plans",
    "UI/SkillPlan/PersonalPlansHoverTooltip": "Plans you made or copied for yourself.",
    "UI/SkillPlan/NoPersonalSkillPlans": "You have made no skill plan of your own.",
    "UI/SkillPlan/ConnectionError": "Skill plans cannot be reached just now.",
    "UI/SkillPlan/Completed": "All trained",
    "UI/SkillPlan/TrackedSkillPlan": "The plan you are following",
    "UI/Common/Buttons/Delete": "Delete",
    "UI/SkillPlan/SkillPlan": "Plan",
    "UI/SkillPlan/DeletePlan": "Delete this plan for good.",
    "UI/SkillPlan/TrackPlanHint": "Follow this plan's progress.",
    "UI/SkillPlan/UntrackPlanHint": "Stop following this plan's progress.",
    "UI/SkillPlan/SkillPlanCompleted": "Every skill in this plan is trained",
    "UI/SkillPlan/ShowSkillPlanContents": "Show the skills",
    "UI/SkillPlan/HideSkillPlanContents": "Hide the skills",
    "UI/SkillPlan/SkillPlanOverview": "Its skills",
    "UI/SkillPlan/HideTrainedSkills": "Leave out those trained",
    "UI/CharacterSheet/CharacterSheetWindow/SkillTabs/NoSkillsMatchingFilters": "No skill shown with these filters",
    "UI/InfoWindow/RequiredSkillNameAndLevel": "{[item]skill.name} {level}",
    "UI/SkillPlan/StartTraining": "Train it",
    "UI/SkillPlan/StartTrainingHint": "Put as many of this plan's levels as fit into your training queue.",
    "UI/SkillPlan/StartTrainingLockedHint": "This plan cannot be trained yet: a book is missing, or it needs omega.",
    "UI/SkillPlan/StartTrainingNothingToTrainHint": "Every level of this plan is trained or queued already.",
    "UI/SkillPlan/SkillsAddedNotification": "{numSkills} put in the queue from {planName}.",
    "UI/SkillPlan/SkillbooksMissing": "{numMissing} books not held",
    "UI/SkillPlan/NoSkillbooksMissing": "Every book is held",
    "UI/SkillPlan/OmegaMissing": "{numMissing} of its skills need omega.",
    "UI/SkillPlan/CreateNewSkillPlan": "New plan",
    "UI/SkillPlan/CreatePersonalSkillPlan": "Make a plan of your own",
    "UI/SkillPlan/PlansInTotal": "Plans: {numPlans} of {numTotal}",
    "UI/SkillPlan/MaximumSkillPlanReached": "You have {numPlans} plans, as many as can be kept.",
    "UI/SkillPlan/EditPlan": "Change this plan",
    "UI/Neocom/Edit": "Edit",
    "UI/SkillPlan/Milestones": "Milestones",
    "UI/SkillPlan/SkillMilestonesDescText": "Points of the plan worth reaching on the way.",
    "UI/SkillPlan/MilestoneShip": "Ship",
    "UI/SkillPlan/MilestoneSkill": "Skill",
    "UI/SkillPlan/MilestoneModule": "Module",
    "UI/SkillPlan/MilestoneOther": "Other",
    "UI/SkillPlan/TotalTrainingTime": "Time to train:",
  };

  onMount(() => {
    flow.requestWords([...Object.keys(OWN), ...SHORT_INTERVAL_WORD_LABELS]);
    void load();
  });

  function word(label: string, args: Readonly<Record<string, string | number>> = {}): string {
    const template = $words.templates[label];
    const text = typeof template === "string" ? template : OWN[label];
    return text === undefined ? "" : plainText(formatTemplate(text, args, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
  }

  let read = $state<PersonalSkillPlansRead | null | undefined>(undefined);
  let error = $state("");
  let busy = $state(false);

  async function load(): Promise<void> {
    busy = true;
    try {
      read = await flow.personalSkillPlans();
    } finally {
      busy = false;
    }
  }

  const plans = $derived(read ? sortPlansByName(read.plans) : []);

  /** FormatTimeIntervalShortWritten from the day to `showTo`, in the install's words; the page's own otherwise. */
  function interval(ticks: number, showTo: "hour" | "minute" | "second"): string {
    const written = shortWrittenInterval(BigInt(Math.trunc(ticks)), $words.templates, "day", showTo);
    if (written !== null) return written;
    const minutes = Math.ceil(ticks / 600_000_000);
    const [days, hours, mins] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
    return [days > 0 ? `${days}d` : "", hours > 0 ? `${hours}h` : "", `${mins}m`].filter(Boolean).join(" ");
  }

  /** GetTotalTrainingTimeLeftText */
  function timeLeft(plan: PersonalSkillPlanEntry): string {
    if (plan.completed) return word("UI/SkillPlan/Completed");
    return plan.trainingTicks === null ? "–" : interval(plan.trainingTicks, timeLeftShowTo(plan.trainingTicks));
  }

  // The entry's menu (SkillPlanEntry.GetMenu), one open at a time; kept while it closes so nothing reads it gone.
  let menu = $state<{ readonly plan: PersonalSkillPlanEntry; readonly x: number; readonly y: number } | null>(null);
  let menuUp = $state(false);

  $effect(() => {
    if (!menuUp) return;
    const close = (event: Event): void => {
      if (!(event.target instanceof Element && event.target.closest(".hull-menu"))) menuUp = false;
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") menuUp = false;
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

  function openMenu(plan: PersonalSkillPlanEntry, event: MouseEvent): void {
    event.preventDefault();
    menu = { plan, x: event.clientX, y: event.clientY };
    menuUp = true;
  }

  async function deletePlan(plan: PersonalSkillPlanEntry): Promise<void> {
    menuUp = false;
    error = "";
    try {
      if (await flow.deletePersonalSkillPlan(plan.id)) {
        if (selectedID === plan.id) selectedID = null;
        await load();
      }
    } catch {
      // _DeletePersonal: message_player(ConnectionError).
      error = word("UI/SkillPlan/ConnectionError");
    }
  }

  // --- A plan opened ---------------------------------------------------------------------------------------------

  // The editor, open on a plan (a copy) or a new one (plan null).
  let editing = $state<{ readonly plan: PersonalSkillPlanEntry | null } | null>(null);

  function edit(plan: PersonalSkillPlanEntry | null): void {
    menuUp = false;
    editing = { plan };
  }

  function editorClosed(saved: boolean): void {
    editing = null;
    if (saved) {
      selectedID = null;
      void load();
    }
  }

  /** CreatePersonalPlanButton's tooltip: its header, the plans in total, the warning at the most. */
  function createTip(numPlans: number): string {
    const lines = [word("UI/SkillPlan/CreatePersonalSkillPlan"), word("UI/SkillPlan/PlansInTotal", { numPlans, numTotal: MAX_PERSONAL_PLANS })];
    if (numPlans >= MAX_PERSONAL_PLANS) lines.push(word("UI/SkillPlan/MaximumSkillPlanReached", { numPlans: MAX_PERSONAL_PLANS }));
    return lines.join("\n");
  }

  let selectedID = $state<string | null>(null);
  const selected = $derived(read && selectedID !== null ? read.plans.find((plan) => plan.id === selectedID) ?? null : null);
  let contentsShown = $state(false);
  /** The plan opened, as read (its rows, books, locks): undefined while read, null where it could not be. */
  let contents = $state<{ readonly planID: string; readonly detail: SkillPlanDetail | null } | undefined>(undefined);
  /** SkillsAddedNotification's words, said in the view after Start Training. */
  let notice = $state("");
  let training = $state(false);
  let filter = $state("");

  const HIDE_TRAINED_KEY = "evejs.SkillPlanContentsHideTrained";
  function hideTrainedSetting(): boolean {
    try {
      return localStorage.getItem(HIDE_TRAINED_KEY) !== "false";
    } catch {
      return true;
    }
  }
  let hideTrained = $state(hideTrainedSetting());
  function setHideTrained(on: boolean): void {
    hideTrained = on;
    try {
      localStorage.setItem(HIDE_TRAINED_KEY, on ? "true" : "false");
    } catch {
      // Kept for this page only.
    }
  }

  function open(plan: PersonalSkillPlanEntry): void {
    selectedID = plan.id;
    notice = "";
    void readContents(plan);
    void readMilestones(plan);
  }

  function close(): void {
    selectedID = null;
    contents = undefined;
    milestones = undefined;
    notice = "";
  }

  // The opened plan's milestones (flow.skillPlanMilestones): undefined while read, a null list where they could not be.
  let milestones = $state<{ readonly planID: string; readonly list: readonly MilestoneEntry[] | null } | undefined>(undefined);

  async function readMilestones(plan: PersonalSkillPlanEntry): Promise<void> {
    milestones = undefined;
    const read_ = await flow.skillPlanMilestones(plan).catch(() => null);
    if (selectedID !== plan.id) return;
    milestones = { planID: plan.id, list: read_ ? read_.milestones : null };
    // _AddSkillsMissingForMilestones put skills in the plan: the plan as it now is, and its view read again.
    if (read_ && read_.requirements !== null && read) {
      const requirements = read_.requirements;
      read = { ...read, plans: read.plans.map((each) => (each.id === plan.id ? { ...each, requirements } : each)) };
      const updated = read.plans.find((each) => each.id === plan.id);
      if (updated) await readContents(updated);
    }
  }

  /** The milestone kinds' words (MilestoneInfoTooltip._GetTypeLabel). */
  const MILESTONE_KIND_LABELS = {
    ship: "UI/SkillPlan/MilestoneShip",
    module: "UI/SkillPlan/MilestoneModule",
    skill: "UI/SkillPlan/MilestoneSkill",
    other: "UI/SkillPlan/MilestoneOther",
  } as const;

  async function readContents(plan: PersonalSkillPlanEntry): Promise<void> {
    contents = undefined;
    const detail = await flow.skillPlanDetail(plan).catch(() => null);
    if (selectedID === plan.id) contents = { planID: plan.id, detail };
  }

  /** OnToggleContents */
  function toggleContents(): void {
    contentsShown = !contentsShown;
  }

  /** TrainSkills */
  async function startTraining(plan: PersonalSkillPlanEntry): Promise<void> {
    if (!read || training) return;
    training = true;
    error = "";
    notice = "";
    try {
      const outcome = await flow.trainSkillPlan(plan, read.trackedID);
      if (read) read = { ...read, trackedID: outcome.trackedID };
      if (outcome.added !== null && outcome.added > 0) notice = word("UI/SkillPlan/SkillsAddedNotification", { numSkills: outcome.added, planName: plan.name });
    } catch {
      error = word("UI/SkillPlan/ConnectionError");
    } finally {
      training = false;
    }
    // OnSkillQueueChanged: the view's buttons and the contents' bars as the queue now is.
    if (selectedID === plan.id) await readContents(plan);
  }

  /** OnTrackButton, _ToggleTracked */
  async function toggleTracked(plan: PersonalSkillPlanEntry): Promise<void> {
    if (!read) return;
    error = "";
    const want = read.trackedID === plan.id ? null : plan.id;
    try {
      const tracked = await flow.setTrackedSkillPlan(want);
      if (read) read = { ...read, trackedID: tracked };
    } catch {
      // _SetTrackedPlanID: message_player(ConnectionError), and nothing tracked after it.
      error = word("UI/SkillPlan/ConnectionError");
      if (read) read = { ...read, trackedID: null };
    }
  }

  const shownRows = $derived(
    contents && contents.detail
      ? contents.detail.rows.filter((row) => skillPlanRowVisible(row, hideTrained, filter, resolvedName($names.resolved, "type", row.skill, "")))
      : [],
  );
</script>

<section>
  <header class="panel-head">
    <h2 title={word("UI/SkillPlan/PersonalPlansHoverTooltip")}>{word("UI/SkillPlan/PersonalPlans")}</h2>
    <span class="controls">
      <button type="button" disabled={busy} onclick={() => void load()}>Refresh</button>
    </span>
  </header>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if read === undefined}
    <p class="note">Reading your skill plans…</p>
  {:else if read === null}
    <p class="error">{word("UI/SkillPlan/ConnectionError")}</p>
  {:else if editing !== null}
    <SkillPlanEditor {store} {flow} plan={editing.plan} planCount={plans.length} onClose={editorClosed} />
  {:else if selected !== null}
    {@const plan = selected}
    {@const tracked = read.trackedID === plan.id}
    <div class="skill-plan-view">
      <div class="skill-plan-view-head">
        <span class="skill-plan-caption">{word("UI/SkillPlan/SkillPlan")}</span>
        <span class="skill-plan-view-name">{plan.name}</span>
        <button type="button" class="skill-plan-close" aria-label="Close" onclick={close}>✕</button>
      </div>
      <div class="skill-plan-view-buttons">
        <button type="button" title={word("UI/SkillPlan/EditPlan")} aria-label={word("UI/SkillPlan/EditPlan")} onclick={() => edit(plan)}>✎</button>
        <button type="button" title={word("UI/SkillPlan/DeletePlan")} aria-label={word("UI/SkillPlan/DeletePlan")} onclick={() => void deletePlan(plan)}>🗑</button>
        <button type="button" class="skill-plan-track" class:tracked
          title={word(tracked ? "UI/SkillPlan/UntrackPlanHint" : "UI/SkillPlan/TrackPlanHint")}
          aria-label={word(tracked ? "UI/SkillPlan/UntrackPlanHint" : "UI/SkillPlan/TrackPlanHint")}
          aria-pressed={tracked} onclick={() => void toggleTracked(plan)}>👁</button>
      </div>
      <button type="button" class="skill-plan-toggle" onclick={toggleContents}>
        {contentsShown ? "◂" : "▸"} {word(contentsShown ? "UI/SkillPlan/HideSkillPlanContents" : "UI/SkillPlan/ShowSkillPlanContents")}
      </button>
      {#if plan.completed}
        <div class="skill-plan-completed"><span aria-hidden="true">✔</span> {word("UI/SkillPlan/SkillPlanCompleted")}</div>
      {/if}
      {#if plan.description}
        <p class="skill-plan-description">{plan.description}</p>
      {/if}
      <!-- The milestones (SkillPlanProgressIndicator's, with MilestoneInfoTooltip's facts): each one's kind, its type or
           its skill and level, Completed where it is, else the time left to train what its type needs. Listed in the
           order the plan reaches them (GetMilestoneLastSkillIndex); the client's ring places them by a dict's order. -->
      {#if milestones !== undefined && milestones.planID === plan.id && milestones.list !== null && milestones.list.length > 0}
        {@const ordered = [...milestones.list].sort((a, b) => milestoneLastSkillIndex(a.needs, plan.requirements) - milestoneLastSkillIndex(b.needs, plan.requirements))}
        <div class="skill-plan-milestones">
          <h3 title={word("UI/SkillPlan/SkillMilestonesDescText")}>{word("UI/SkillPlan/Milestones")}</h3>
          <ul>
            {#each ordered as milestone (milestone.id)}
              <li class:completed={milestone.completed}>
                <span class="skill-plan-milestone-kind">{word(MILESTONE_KIND_LABELS[milestone.subType])}</span>
                <span class="skill-plan-milestone-name">{milestone.kind === "skill"
                  ? word("UI/InfoWindow/RequiredSkillNameAndLevel", { skill: milestone.typeID, level: romanLevel(milestone.level), levelColor: "#ffffff" })
                  : resolvedName($names.resolved, "type", milestone.typeID, "")}</span>
                {#if milestone.completed}
                  <span class="skill-plan-milestone-time"><span aria-hidden="true">✔</span> {word("UI/SkillPlan/Completed")}</span>
                {:else if milestone.trainingTicks !== null && milestone.trainingTicks > 0}
                  <span class="skill-plan-milestone-time">{word("UI/SkillPlan/TotalTrainingTime")} {interval(milestone.trainingTicks, "second")}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if contentsShown}
        <div class="skill-plan-contents">
          <h3>{word("UI/SkillPlan/SkillPlanOverview")}</h3>
          <div class="skill-plan-filters">
            <label><input type="checkbox" checked={hideTrained} onchange={(event) => setHideTrained((event.currentTarget as HTMLInputElement).checked)} />
              {word("UI/SkillPlan/HideTrainedSkills")}</label>
            <input type="search" bind:value={filter} aria-label="Filter" />
          </div>
          {#if contents === undefined || contents.planID !== plan.id}
            <p class="note">Reading the plan's skills…</p>
          {:else if contents.detail === null}
            <p class="error">Your skills could not be read.</p>
          {:else if shownRows.length === 0}
            <p class="empty">{word("UI/CharacterSheet/CharacterSheetWindow/SkillTabs/NoSkillsMatchingFilters")}</p>
          {:else}
            <ul class="skill-plan-rows">
              {#each shownRows as row, at (at)}
                <li class="skill-plan-row">
                  <span class="skill-bar" aria-hidden="true">
                    {#each row.boxes as one, box (box)}
                      <span class="skill-box {one.box}" class:partial={one.partial}></span>
                    {/each}
                  </span>
                  <span class="skill-plan-row-name">{word("UI/InfoWindow/RequiredSkillNameAndLevel", { skill: row.skill, level: romanLevel(row.level), levelColor: "#ffffff" })}</span>
                  <span class="skill-plan-row-time">{row.ticks === null ? "–" : interval(row.ticks, "minute")}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
      {#if notice}
        <p class="note">{notice}</p>
      {/if}
      {#if !plan.completed && contents !== undefined && contents.planID === plan.id && contents.detail !== null}
        {@const detail = contents.detail}
        {@const state = startTrainingState(detail)}
        <div class="skill-plan-foot">
          <div class="skill-plan-locks">
            <button type="button" class="skill-plan-lock books" class:locked={detail.missingBooks.length > 0}
              title={detail.missingBooks.length > 0 ? word("UI/SkillPlan/SkillbooksMissing", { numMissing: detail.missingBooks.length }) : word("UI/SkillPlan/NoSkillbooksMissing")}
              aria-label={detail.missingBooks.length > 0 ? word("UI/SkillPlan/SkillbooksMissing", { numMissing: detail.missingBooks.length }) : word("UI/SkillPlan/NoSkillbooksMissing")}
              onclick={toggleContents}>📖{#if detail.missingBooks.length > 0}<span class="skill-plan-lock-count">{detail.missingBooks.length}</span>{/if}</button>
            {#if detail.omegaLocked}
              <span class="skill-plan-lock-icon" aria-hidden="true">🔒</span>
              <span class="skill-plan-lock omega locked" title={word("UI/SkillPlan/OmegaMissing", { numMissing: detail.numOmegaSkills })}
                aria-label={word("UI/SkillPlan/OmegaMissing", { numMissing: detail.numOmegaSkills })}>Ω</span>
            {/if}
          </div>
          <button type="button" class="skill-plan-train" disabled={state !== "ready" || training}
            title={word(state === "locked" ? "UI/SkillPlan/StartTrainingLockedHint" : state === "nothing" ? "UI/SkillPlan/StartTrainingNothingToTrainHint" : "UI/SkillPlan/StartTrainingHint")}
            onclick={() => void startTraining(plan)}>{word("UI/SkillPlan/StartTraining")}</button>
        </div>
      {/if}
    </div>
  {:else if plans.length === 0}
    <p class="empty">{word("UI/SkillPlan/NoPersonalSkillPlans")}</p>
    <button type="button" class="skill-plan-create" title={createTip(0)} onclick={() => edit(null)}>{word("UI/SkillPlan/CreateNewSkillPlan")}</button>
  {:else}
    <ul class="skill-plan-cards">
      {#each plans as plan (plan.id)}
        <li>
          <button type="button" class="skill-plan-card" onclick={() => open(plan)} oncontextmenu={(event) => openMenu(plan, event)}>
            <span class="skill-plan-name">{plan.name}</span>
            {#if read.trackedID === plan.id}
              <span class="skill-plan-tracked" title={word("UI/SkillPlan/TrackedSkillPlan")} aria-label={word("UI/SkillPlan/TrackedSkillPlan")}>👁</span>
            {/if}
            <span class="skill-plan-time" class:completed={plan.completed}>
              {timeLeft(plan)}
              {#if plan.completed}<span class="skill-plan-done" aria-hidden="true">✔</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <button type="button" class="skill-plan-create" disabled={plans.length >= MAX_PERSONAL_PLANS} title={createTip(plans.length)}
      onclick={() => edit(null)}>{word("UI/SkillPlan/CreateNewSkillPlan")}</button>
  {/if}
  {#if menuUp && menu !== null}
    {@const menuFor = menu}
    <span class="hull-menu" role="menu" style:left={`${menuFor.x}px`} style:top={`${menuFor.y}px`}>
      <button type="button" role="menuitem" onclick={() => edit(menuFor.plan)}>{word("UI/Neocom/Edit")}</button>
      <button type="button" role="menuitem" onclick={() => void deletePlan(menuFor.plan)}>{word("UI/Common/Buttons/Delete")}</button>
    </span>
  {/if}
</section>

<style>
  /* SkillPlanScroll: as many to a row as fit at 325 wide, each entry 134 high. */
  .skill-plan-cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: 0.75rem; }
  .skill-plan-card { position: relative; width: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; gap: 0.5rem;
    min-height: 5.5rem; padding: 0.75rem 2rem 0.75rem 1rem; text-align: left; font: inherit; color: inherit; cursor: pointer;
    border: 1px solid var(--line, #333); background: var(--panel-raised, rgba(255, 255, 255, 0.04)); }
  .skill-plan-card:hover { background: rgba(255, 255, 255, 0.08); }
  .skill-plan-name { font-size: 1.15rem; overflow-wrap: anywhere; }
  .skill-plan-tracked { position: absolute; top: 0.6rem; right: 0.7rem; }
  .skill-plan-time { display: flex; justify-content: space-between; align-items: center; }
  /* TextColor.SUCCESS where the plan is completed. */
  .skill-plan-time.completed { color: #4caf50; }
  /* CreatePersonalPlanButton: 200 by 70, its words large. */
  .skill-plan-create { display: block; margin: 0.75rem auto 0; min-width: 12rem; min-height: 3rem; font-size: 1.05rem; }

  .skill-plan-view { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.75rem 1rem 1rem; border: 1px solid var(--line, #333); background: rgba(0, 0, 0, 0.6); }
  .skill-plan-view-head { display: flex; align-items: baseline; gap: 0.75rem; }
  .skill-plan-caption { font-size: 0.8rem; text-transform: uppercase; opacity: 0.7; }
  .skill-plan-view-name { flex: 1; font-size: 1.3rem; overflow-wrap: anywhere; }
  .skill-plan-view-buttons { display: flex; gap: 0.4rem; }
  .skill-plan-track.tracked { outline: 1px solid currentColor; }
  .skill-plan-toggle { align-self: stretch; text-align: left; }
  /* PlanCompletedBanner: the completed mark on COPPER_OXIDE_GREEN, the words black on white. */
  .skill-plan-completed { display: flex; align-items: center; gap: 0.6rem; padding: 0.4rem 0.75rem; color: #000; background: #fff; border-left: 2.6rem solid #3c8a5e; }
  .skill-plan-description { margin: 0; white-space: pre-wrap; }
  .skill-plan-milestones h3 { margin: 0 0 0.35rem; }
  .skill-plan-milestones ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .skill-plan-milestones li { display: flex; align-items: center; gap: 0.75rem; padding: 0.3rem 0.5rem; background: rgba(255, 255, 255, 0.04); }
  .skill-plan-milestone-kind { min-width: 5rem; font-size: 0.8rem; text-transform: uppercase; opacity: 0.7; }
  .skill-plan-milestone-name { flex: 1; }
  .skill-plan-milestones li.completed .skill-plan-milestone-time { color: #4caf50; }
  .skill-plan-contents { display: flex; flex-direction: column; gap: 0.5rem; }
  .skill-plan-contents h3 { margin: 0; }
  .skill-plan-filters { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; }
  .skill-plan-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .skill-plan-row { display: flex; align-items: center; gap: 0.75rem; min-height: 2rem; padding: 0 0.5rem; background: rgba(255, 255, 255, 0.04); }
  .skill-plan-row-name { flex: 1; }
  .skill-plan-row-time { opacity: 0.35; }
  .skill-plan-foot { display: flex; flex-direction: column; align-items: stretch; gap: 0.5rem; }
  .skill-plan-locks { display: flex; justify-content: center; align-items: center; gap: 1rem; }
  /* The lock buttons (lockButton.py): the books' framed white, PRIMARY_BLUE where locked, with the count on HOT_RED;
     the omega one SAND_YELLOW where locked. */
  .skill-plan-lock { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem;
    border: 1px solid #fff; background: rgba(60, 138, 94, 0.3); }
  .skill-plan-lock.books.locked { border-color: #58a7bf; background: rgba(55, 73, 87, 0.3); }
  .skill-plan-lock.omega.locked { border-color: #d8b25a; background: rgba(160, 120, 50, 0.3); }
  .skill-plan-lock-count { position: absolute; right: -0.4rem; bottom: -0.4rem; min-width: 1.1rem; height: 1.1rem; border-radius: 50%;
    font-size: 0.7rem; line-height: 1.1rem; text-align: center; color: #fff; background: #dd2c2c; }
  .skill-plan-lock-icon { color: #dd2c2c; }
  /* The skill bar's boxes, as the skill requirement window draws them (skillLevel.py). */
  .skill-bar { display: inline-flex; gap: 2px; }
  .skill-box { width: 8px; height: 8px; box-sizing: border-box; }
  .skill-box.none { visibility: hidden; }
  .skill-box.trained { background: rgba(204, 204, 204, 1); }
  .skill-box.training { background: rgba(204, 204, 204, 0.6); outline: 1px solid rgba(204, 204, 204, 1); }
  .skill-box.queued { background: #3ea8d9; }
  .skill-box.untrained { background: rgba(255, 255, 255, 0.3); }
  .skill-box.small { width: 4px; height: 4px; margin: 2px; background: rgba(255, 255, 255, 0.3); }
  .skill-box.trained-omega { background: rgba(252, 194, 7, 0.8); }
  .skill-box.small-omega { width: 4px; height: 4px; margin: 2px; background: rgba(252, 194, 7, 0.6); }
  .skill-box.partial { outline: 1px solid rgba(204, 204, 204, 1); }
</style>
