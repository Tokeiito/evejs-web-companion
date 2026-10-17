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
  //                   question: flow.removeExpertSystem); Train Skills (flow.trainExpertSystemSkills: the books of the
  //                   skills to train bought and the levels queued; off with TrainSkillsDisabledReasonNoSkills where
  //                   none is left to train)
  //   its skills      SkillCountHint and the skills it gives by name, each with its skill bar at the level given
  //                   (SkillList, SkillRow)
  //
  //   the browse page  an empty slot or the intro's Browse opens it (PageController.browse, on_browse:
  //                   ExpertSystemsPanel.show_browse_page); its back button the home page again (BackToHome). Every
  //                   expert system neither hidden nor retired, by name, the first selected (BrowsePage.load); each
  //                   entry its name and, with ships, ShipUnlockHint. The selected one's name, its benefits (SkillCount,
  //                   Duration, and the ships it goes with: four, and "+N" past five), View in Store (off: the store is
  //                   not on this page), and its skills with their bars (browse/details.py ExpertSystemDetails)
  //
  // Not here: the fanfare, the slot's ring of time left, the browse entries' menu and drag.
  import { onMount, untrack } from "svelte";
  import TypeIcon from "./TypeIcon.svelte";
  import { clientTexture } from "./skillGroupIcons.ts";
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
    "UI/ExpertSystem/TrainSkillsHint": "Queue its skills you lack, buying the books first.",
    "UI/ExpertSystem/TrainSkillsDisabledReasonNoSkills": "Every skill it gives is trained or queued.",
    "UI/ExpertSystem/SkillCountHint": "{skill_count} skills",
    "UI/ExpertSystem/BackToHome": "Back",
    "UI/ExpertSystem/BrowseHeader": "Expert systems",
    "UI/ExpertSystem/ShipUnlockHint": "Goes with {ship_count} ships",
    "UI/ExpertSystem/SkillCount": "{skill_count} skills",
    "UI/ExpertSystem/Duration": "{days} days",
    "UI/InfoWindow/ViewExpertSystemInStore": "View in the store",
  };

  /** expertSystems/client/texture.py benefit_icon_skill, benefit_icon_duration, benefit_icon_ship_unlock. */
  const BENEFIT_SKILL = clientTexture("res:/UI/Texture/classes/ExpertSystems/skill.png");
  const BENEFIT_DURATION = clientTexture("res:/UI/Texture/classes/ExpertSystems/time.png");
  const BENEFIT_SHIPS = clientTexture("res:/UI/Texture/classes/ExpertSystems/lock.png");

  let page = $state<"home" | "browse">("home");
  let browse = $state<Awaited<ReturnType<AppFlow["expertSystemsBrowse"]>> | undefined>(undefined);
  let browseSelected = $state<number | null>(null);
  /** sorted_by_name: the browse page's expert systems. */
  const browseSorted = $derived(
    [...(browse?.systems ?? [])].sort((left, right) =>
      resolvedName($names.resolved, "type", left.typeID, "").localeCompare(resolvedName($names.resolved, "type", right.typeID, ""))),
  );
  const browseChosen = $derived(browseSorted.find((one) => one.typeID === browseSelected) ?? null);
  const browseSkills = $derived(
    [...(browseChosen?.skills ?? [])].sort(([left], [right]) =>
      resolvedName($names.resolved, "type", left, "").localeCompare(resolvedName($names.resolved, "type", right, ""))),
  );

  /** PageController.browse: the browse page shown, read as it opens; the first by name selected. */
  async function openBrowse(): Promise<void> {
    page = "browse";
    browse = undefined;
    const read = await flow.expertSystemsBrowse();
    browse = read;
    browseSelected = null;
  }
  $effect(() => {
    const first = browseSorted[0]?.typeID ?? null;
    untrack(() => {
      if (browseSelected === null && first !== null) browseSelected = first;
    });
  });

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
  /** ExpertSystem.can_train_skills. */
  const chosenCanTrain = $derived(chosen === null ? false : home?.canTrain.get(chosen.typeID) ?? false);
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

  /** _get_train_skills_hint: the hint, and the reason it is off where it is. */
  function trainHint(canTrain: boolean): string {
    return word("UI/ExpertSystem/TrainSkillsHint") + (canTrain ? "" : "\n\n" + word("UI/ExpertSystem/TrainSkillsDisabledReasonNoSkills"));
  }

  /** PageController.train_selected_skills; the page loads again for the queue's change (OnSkillQueueChanged). */
  async function train(): Promise<void> {
    if (chosen === null || busy) return;
    busy = true;
    try {
      await flow.trainExpertSystemSkills(chosen.typeID);
      await load();
    } finally {
      busy = false;
    }
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
  {#if page === "browse"}
    <div class="expert-browse-head">
      <button type="button" class="expert-browse-back" title={word("UI/ExpertSystem/BackToHome")} aria-label={word("UI/ExpertSystem/BackToHome")}
        onclick={() => { page = "home"; }}>‹</button>
      <strong>{word("UI/ExpertSystem/BrowseHeader")}</strong>
    </div>
    {#if browse === undefined}
      <p class="empty">Reading the expert systems…</p>
    {:else if browse === null}
      <p class="error">The expert systems could not be read.</p>
    {:else}
      <div class="expert-browse">
        <ul class="expert-browse-list">
          {#each browseSorted as one (one.typeID)}
            <li>
              <button type="button" class:selected={one.typeID === browseSelected} aria-pressed={one.typeID === browseSelected}
                onclick={() => { browseSelected = one.typeID; }}>
                <strong>{resolvedName($names.resolved, "type", one.typeID, "")}</strong>
                {#if one.ships.length > 0}<small>{word("UI/ExpertSystem/ShipUnlockHint", { ship_count: one.ships.length })}</small>{/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if browseChosen !== null}
          {@const shown = browseChosen.ships.length > 5 ? browseChosen.ships.slice(0, 4) : browseChosen.ships}
          <div class="expert-browse-details">
            <strong class="expert-browse-name">{resolvedName($names.resolved, "type", browseChosen.typeID, "")}</strong>
            <span class="expert-browse-benefits">
              <span title={word("UI/ExpertSystem/SkillCountHint", { skill_count: browseChosen.skills.length })}>
                <img src={BENEFIT_SKILL} alt="" width="16" height="16" />{word("UI/ExpertSystem/SkillCount", { skill_count: browseChosen.skills.length })}
              </span>
              <span><img src={BENEFIT_DURATION} alt="" width="16" height="16" />{word("UI/ExpertSystem/Duration", { days: browseChosen.durationDays })}</span>
              {#if browseChosen.ships.length > 0}
                <span title={word("UI/ExpertSystem/ShipUnlockHint", { ship_count: browseChosen.ships.length })}>
                  <img src={BENEFIT_SHIPS} alt="" width="16" height="16" />
                  {#each shown as ship (ship)}
                    <TypeIcon typeID={ship} name={resolvedName($names.resolved, "type", ship, "")} />
                  {/each}
                  {#if browseChosen.ships.length > shown.length}
                    <span title={browseChosen.ships.slice(shown.length).map((ship) => resolvedName($names.resolved, "type", ship, "")).join("\n")}>+{browseChosen.ships.length - shown.length}</span>
                  {/if}
                </span>
              {/if}
            </span>
            <button type="button" disabled title="The New Eden Store is not on this page.">{word("UI/InfoWindow/ViewExpertSystemInStore")}</button>
            <ul class="expert-system-skills">
              {#each browseSkills as [skill, level] (skill)}
                <li>
                  <span class="skill-bar" aria-hidden="true">
                    {#each browse.boxes.get(skill + ":" + level) ?? [] as one, box (box)}
                      <span class="skill-box {one.box}" class:partial={one.partial}></span>
                    {/each}
                  </span>
                  <span>{resolvedName($names.resolved, "type", skill, "")}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  {:else if home === undefined}
    <p class="empty">Reading your expert systems…</p>
  {:else if home === null}
    <p class="error">Your expert systems could not be read.</p>
  {:else}
    <div class="expert-system-slots">
      {#each slots as slot, at (at)}
        {#if slot === null}
          <button type="button" class="expert-system-slot empty" title={word("UI/ExpertSystem/BrowseExpertSystems")} onclick={() => void openBrowse()}>+</button>
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
        <button type="button" onclick={() => void openBrowse()}>{word("UI/ExpertSystem/BrowseExpertSystems")}</button>
      </div>
    {:else}
      <div class="expert-system-details">
        <strong>{resolvedName($names.resolved, "type", chosen.typeID, "")}</strong>
        <span class:soon={expiresSoon(chosen.expiresMs, nowMs)}>{word("UI/ExpertSystem/ExpiresIn", { time: timeLeft(chosen.expiresMs) })}</span>
        <span class="expert-system-buttons">
          <button type="button" disabled title={extendHint()}>{word("UI/ExpertSystem/ExtendDuration")}</button>
          <button type="button" disabled={busy} onclick={() => void remove()}
            title={word("UI/ExpertSystem/Remove") + "\n" + word("UI/ExpertSystem/RemoveHint") + "\n\n" + word("UI/ExpertSystem/RemoveWarning")}>{word("UI/ExpertSystem/Remove")}</button>
          <button type="button" class="primary" disabled={busy || !chosenCanTrain} title={trainHint(chosenCanTrain)} onclick={() => void train()}>{word("UI/ExpertSystem/TrainSkills")}</button>
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
  .expert-browse-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
  .expert-browse-back { padding: 0 0.4rem; }
  .expert-browse { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .expert-browse-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
  .expert-browse-list button { display: flex; flex-direction: column; align-items: flex-start; width: 100%; text-align: left; }
  .expert-browse-list button.selected { outline: 1px solid #5ccbcb; }
  .expert-browse-details { display: flex; flex-direction: column; gap: 0.4rem; }
  .expert-browse-name { font-size: 1.1rem; }
  .expert-browse-benefits { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
  .expert-browse-benefits > span { display: inline-flex; align-items: center; gap: 0.3rem; }
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
