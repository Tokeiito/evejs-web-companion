<script lang="ts">
  // The character sheet's Expert Systems panel, its home page (expertSystems/client/ui/character_sheet/home), as the
  // client draws it:
  //
  //   the slots       MAX_CHARACTER_INSTALLATIONS of them, the pilot's expert systems by when they were installed
  //                   (PageController.load); an empty one adds by browsing; one clicked is selected, the first at
  //                   first; each says its name and how long it has left (ExpiresIn, from years to seconds), in the
  //                   warning colour under a day
  //   none installed  the intro (IntroHeader, ExpertSystemDescription, BrowseExpertSystems)
  //   the selected    its name and time left; Extend Duration (the New Eden Store, which the page has not: off, its
  //                   hint and the client's reason it would be refused, validate_extend); Remove (after the client's
  //                   question: flow.removeExpertSystem); Train Skills (not here yet: off)
  //   its skills      SkillCountHint and the skills it gives by name, each with its skill bar at the level given
  //                   (SkillList, SkillRow)
  //
  // Not here: the browse page (all the expert systems), Train Skills, the fanfare, the slot's ring of time left.
  import { onMount, untrack } from "svelte";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { shortWrittenInterval } from "../bridge/timeInterval.ts";
  import { resolvedName } from "../store/names.ts";
  import { MAX_CHARACTER_INSTALLATIONS, expiresSoon, extendRefusal } from "../bridge/expertSystems.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  /** The page's own words, where the install's are not to hand. */
  const OWN: Readonly<Record<string, string>> = {
    "Tooltips/CharacterSheet/ExpertSystems": "Expert Systems",
    "UI/ExpertSystem/IntroHeader": "No expert systems",
    "UI/CharacterSheet/CharacterSheetWindow/ExpertSystems/ExpertSystemDescription": "An expert system lets you use skills you have not trained, for a time.",
    "UI/ExpertSystem/BrowseExpertSystems": "Browse expert systems",
    "UI/ExpertSystem/ExpiresIn": "Expires in {time}",
    "UI/ExpertSystem/ExtendDuration": "Extend",
    "UI/ExpertSystem/ExtendDurationHint": "Add time to it, while {days} days or fewer are left.",
    "UI/ExpertSystem/ExtendDisabledReasonNotAvailable": "It can no longer be had.",
    "UI/ExpertSystem/ExtendDisabledReasonDurationLimit": "More than {days} days of it are left.",
    "UI/ExpertSystem/Remove": "Remove",
    "UI/ExpertSystem/RemoveHint": "Take it out, freeing its slot.",
    "UI/ExpertSystem/RemoveWarning": "What is left of its time is lost.",
    "UI/ExpertSystem/TrainSkills": "Train skills",
    "UI/ExpertSystem/SkillCountHint": "{skill_count} skills",
  };

  function word(label: string, args: Readonly<Record<string, string | number>> = {}): string {
    const template = $words.templates[label];
    const text = typeof template === "string" ? template : OWN[label] ?? "";
    return plainText(formatTemplate(text, args, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
  }

  let home = $state<Awaited<ReturnType<AppFlow["expertSystemsHome"]>> | undefined>(undefined);
  let selected = $state<number | null>(null);
  let busy = $state(false);
  let nowMs = $state(Date.now());

  async function load(): Promise<void> {
    const read = await flow.expertSystemsHome();
    home = read;
    if (read === null) return;
    // (The one selected kept where it is still installed, else the first.)
    if (selected === null || !read.installed.some((one) => one.typeID === selected)) selected = read.installed[0]?.typeID ?? null;
  }

  const slots = $derived(Array.from({ length: MAX_CHARACTER_INSTALLATIONS }, (_, at) => home?.installed[at] ?? null));
  const chosen = $derived(home?.installed.find((one) => one.typeID === selected) ?? null);
  const chosenData = $derived(chosen === null ? null : home?.data.get(chosen.typeID) ?? null);
  /** SkillList.update_skills: by name. */
  const chosenSkills = $derived(
    [...(chosenData?.skills ?? [])].sort(([left], [right]) =>
      resolvedName($names.resolved, "type", left, "").localeCompare(resolvedName($names.resolved, "type", right, ""))),
  );

  /** format_timespan_short: FormatTimeIntervalShortWritten, year to second. */
  function timeLeft(expiresMs: number): string {
    const ms = Math.max(0, expiresMs - nowMs);
    const written = shortWrittenInterval(BigInt(ms) * 10_000n, $words.templates, "year", "second");
    if (written !== null) return written;
    const seconds = Math.floor(ms / 1000);
    const [days, hours, minutes, secs] = [Math.floor(seconds / 86400), Math.floor((seconds % 86400) / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
    return [days > 0 ? days + "d" : "", hours > 0 ? hours + "h" : "", minutes > 0 ? minutes + "m" : "", secs + "s"].filter(Boolean).join(" ");
  }

  function extendHint(): string {
    const days = 30;
    const hint = word("UI/ExpertSystem/ExtendDuration") + "\n" + word("UI/ExpertSystem/ExtendDurationHint", { days });
    const refusal = chosen === null ? null : extendRefusal(chosenData, chosen.expiresMs, nowMs);
    const reason = refusal === "duration"
      ? word("UI/ExpertSystem/ExtendDisabledReasonDurationLimit", { days })
      : refusal !== null ? word("UI/ExpertSystem/ExtendDisabledReasonNotAvailable") : "";
    return hint + (reason ? "\n\n" + reason : "") + "\n\nThe New Eden Store is not on this page.";
  }

  /** PageController.remove_selected: the page loads again at the server's word (OnExpertSystemsUpdated). */
  async function remove(): Promise<void> {
    if (chosen === null || busy) return;
    busy = true;
    try {
      await flow.removeExpertSystem(chosen.typeID);
    } finally {
      busy = false;
    }
  }

  // _handle_expert_systems_updated: loaded again at each OnExpertSystemsUpdated (the first count is the mount's).
  // svelte-ignore state_referenced_locally
  const changed = flow.expertSystemsChanged;
  let changedSeen: number | null = null;
  $effect(() => {
    const count = $changed;
    untrack(() => {
      if (changedSeen === null) {
        changedSeen = count;
        return;
      }
      if (count === changedSeen) return;
      changedSeen = count;
      void load();
    });
  });

  onMount(() => {
    flow.requestWords(Object.keys(OWN));
    void load();
    const timer = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
</script>

<section class="expert-systems">
  <h3>{word("Tooltips/CharacterSheet/ExpertSystems")}</h3>
  {#if home === undefined}
    <p class="empty">Reading your expert systems…</p>
  {:else if home === null}
    <p class="error">Your expert systems could not be read.</p>
  {:else}
    <div class="expert-system-slots">
      {#each slots as slot, at (at)}
        {#if slot === null}
          <button type="button" class="expert-system-slot empty" disabled title={word("UI/ExpertSystem/BrowseExpertSystems") + "\n\nThe New Eden Store is not on this page."}>+</button>
        {:else}
          <button type="button" class="expert-system-slot" class:selected={slot.typeID === selected} aria-pressed={slot.typeID === selected}
            onclick={() => { selected = slot.typeID; }}>
            <strong>{resolvedName($names.resolved, "type", slot.typeID, "")}</strong>
            <span class:soon={expiresSoon(slot.expiresMs, nowMs)}>{word("UI/ExpertSystem/ExpiresIn", { time: timeLeft(slot.expiresMs) })}</span>
          </button>
        {/if}
      {/each}
    </div>
    {#if chosen === null}
      <div class="expert-system-intro">
        <strong>{word("UI/ExpertSystem/IntroHeader")}</strong>
        <p>{word("UI/CharacterSheet/CharacterSheetWindow/ExpertSystems/ExpertSystemDescription")}</p>
        <button type="button" disabled title="The New Eden Store is not on this page.">{word("UI/ExpertSystem/BrowseExpertSystems")}</button>
      </div>
    {:else}
      <div class="expert-system-details">
        <strong>{resolvedName($names.resolved, "type", chosen.typeID, "")}</strong>
        <span class:soon={expiresSoon(chosen.expiresMs, nowMs)}>{word("UI/ExpertSystem/ExpiresIn", { time: timeLeft(chosen.expiresMs) })}</span>
        <span class="expert-system-buttons">
          <button type="button" disabled title={extendHint()}>{word("UI/ExpertSystem/ExtendDuration")}</button>
          <button type="button" disabled={busy} onclick={() => void remove()}
            title={word("UI/ExpertSystem/Remove") + "\n" + word("UI/ExpertSystem/RemoveHint") + "\n\n" + word("UI/ExpertSystem/RemoveWarning")}>{word("UI/ExpertSystem/Remove")}</button>
          <button type="button" disabled title="Not on this page yet.">{word("UI/ExpertSystem/TrainSkills")}</button>
        </span>
      </div>
      <p class="expert-system-count">{word("UI/ExpertSystem/SkillCountHint", { skill_count: chosenSkills.length })}</p>
      <ul class="expert-system-skills">
        {#each chosenSkills as [skill, level] (skill)}
          <li>
            <span class="skill-bar" aria-hidden="true">
              {#each home.boxes.get(skill + ":" + level) ?? [] as one, box (box)}
                <span class="skill-box {one.box}" class:partial={one.partial}></span>
              {/each}
            </span>
            <span>{resolvedName($names.resolved, "type", skill, "")}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .expert-system-slots { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
  .expert-system-slot { display: flex; flex-direction: column; align-items: flex-start; gap: 0.2rem; min-width: 11rem; min-height: 3.5rem; padding: 0.4rem 0.6rem; text-align: left; }
  .expert-system-slot.empty { align-items: center; justify-content: center; font-size: 1.4rem; }
  .expert-system-slot.selected { outline: 1px solid #5ccbcb; }
  .soon { color: #ffa64d; }
  .expert-system-intro, .expert-system-details { display: flex; flex-direction: column; gap: 0.3rem; }
  .expert-system-intro p { margin: 0; }
  .expert-system-buttons { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .expert-system-count { margin: 0.6rem 0 0.3rem; }
  .expert-system-skills { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
  .expert-system-skills li { display: flex; align-items: center; gap: 0.6rem; }
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
