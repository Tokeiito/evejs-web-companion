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
  // Not done: the menu's Edit and the Create button (the plan editor), a plan opened by a click (the selected plan's
  // view, where a plan is tracked), the progress gauge, the omega mark, the tooltip, dragging a plan, and the
  // Certified and Corporation plans.
  import { onMount } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { shortWrittenInterval, SHORT_INTERVAL_WORD_LABELS } from "../bridge/timeInterval.ts";
  import { sortPlansByName, timeLeftShowTo, type PersonalSkillPlanEntry, type PersonalSkillPlansRead } from "../bridge/skillPlans.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;

  /** The page's own words, where the install's are not to hand. */
  const OWN: Readonly<Record<string, string>> = {
    "UI/SkillPlan/PersonalPlans": "My own plans",
    "UI/SkillPlan/PersonalPlansHoverTooltip": "Plans you made or copied for yourself.",
    "UI/SkillPlan/NoPersonalSkillPlans": "You have made no skill plan of your own.",
    "UI/SkillPlan/ConnectionError": "Skill plans cannot be reached just now.",
    "UI/SkillPlan/Completed": "All trained",
    "UI/SkillPlan/TrackedSkillPlan": "The plan you are following",
    "UI/Common/Buttons/Delete": "Delete",
  };

  onMount(() => {
    flow.requestWords([...Object.keys(OWN), ...SHORT_INTERVAL_WORD_LABELS]);
    void load();
  });

  function word(label: string): string {
    const template = $words.templates[label];
    const text = typeof template === "string" ? template : OWN[label];
    return text === undefined ? "" : plainText(formatTemplate(text, {}, { nameOf: () => "" }));
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

  /** GetTotalTrainingTimeLeftText */
  function timeLeft(plan: PersonalSkillPlanEntry): string {
    if (plan.completed) return word("UI/SkillPlan/Completed");
    const ticks = plan.trainingTicks;
    if (ticks === null) return "–";
    const written = shortWrittenInterval(BigInt(Math.trunc(ticks)), $words.templates, "day", timeLeftShowTo(ticks));
    if (written !== null) return written;
    const minutes = Math.ceil(ticks / 600_000_000);
    const [days, hours, mins] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
    return [days > 0 ? `${days}d` : "", hours > 0 ? `${hours}h` : "", `${mins}m`].filter(Boolean).join(" ");
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
      if (await flow.deletePersonalSkillPlan(plan.id)) await load();
    } catch {
      // _DeletePersonal: message_player(ConnectionError).
      error = word("UI/SkillPlan/ConnectionError");
    }
  }
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
  {:else if plans.length === 0}
    <p class="empty">{word("UI/SkillPlan/NoPersonalSkillPlans")}</p>
  {:else}
    <ul class="skill-plan-cards">
      {#each plans as plan (plan.id)}
        <li class="skill-plan-card" oncontextmenu={(event) => openMenu(plan, event)}>
          <span class="skill-plan-name">{plan.name}</span>
          {#if read.trackedID === plan.id}
            <span class="skill-plan-tracked" title={word("UI/SkillPlan/TrackedSkillPlan")} aria-label={word("UI/SkillPlan/TrackedSkillPlan")}>👁</span>
          {/if}
          <span class="skill-plan-time" class:completed={plan.completed}>
            {timeLeft(plan)}
            {#if plan.completed}<span class="skill-plan-done" aria-hidden="true">✔</span>{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  {#if menuUp && menu !== null}
    {@const menuFor = menu}
    <span class="hull-menu" role="menu" style:left={`${menuFor.x}px`} style:top={`${menuFor.y}px`}>
      <button type="button" role="menuitem" onclick={() => void deletePlan(menuFor.plan)}>{word("UI/Common/Buttons/Delete")}</button>
    </span>
  {/if}
</section>

<style>
  /* SkillPlanScroll: as many to a row as fit at 325 wide, each entry 134 high. */
  .skill-plan-cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); gap: 0.75rem; }
  .skill-plan-card { position: relative; display: flex; flex-direction: column; justify-content: flex-end; gap: 0.5rem; min-height: 5.5rem;
    padding: 0.75rem 2rem 0.75rem 1rem; border: 1px solid var(--line, #333); background: var(--panel-raised, rgba(255, 255, 255, 0.04)); }
  .skill-plan-name { font-size: 1.15rem; overflow-wrap: anywhere; }
  .skill-plan-tracked { position: absolute; top: 0.6rem; right: 0.7rem; }
  .skill-plan-time { display: flex; justify-content: space-between; align-items: center; }
  /* TextColor.SUCCESS where the plan is completed. */
  .skill-plan-time.completed { color: #4caf50; }
</style>
