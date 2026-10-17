<script lang="ts">
  // A skill's menu at the pointer (menusvc.GetMenuForSkill, bridge/skillMenu.ts), as a skill entry's GetMenu opens it:
  // a plan's contents rows (SkillPlanContentsSkillEntry) and the plan editor's catalogue (SkillGroupSkillEntry). The
  // queue's entries and Apply Skill Points are the flow's (skillMenuChoose); the type menu's are the page's windows:
  // Show Info, the market's details, the contracts' and the assets' searches, the compare tool. Buy This Type opens
  // the market's buy window (marketutils.Buy), which the page has not: it is off, and says so. Closed by a click
  // elsewhere or Escape.
  import { onMount } from "svelte";
  import { portal } from "./portal.ts";
  import { showInfo } from "./showInfo.ts";
  import { showMarketDetails } from "./marketDetails.ts";
  import { findInPersonalAssets } from "./assetsSearch.ts";
  import { findInContracts } from "./contractsSearch.ts";
  import { compareType } from "./typeCompare.ts";
  import { assetSearchTextForType } from "../bridge/assetSearch.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { shortWrittenInterval, type TimePart } from "../bridge/timeInterval.ts";
  import { resolvedName } from "../store/names.ts";
  import type { SkillMenuEntry } from "../bridge/skillMenu.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { JsonValue } from "../bridge/wire.ts";

  let { store, flow, skill, entries, x, y, onClose, onApplied = null }: {
    store: ClientStore;
    flow: AppFlow;
    skill: number;
    entries: readonly SkillMenuEntry[];
    /** Where it opens: the pointer's place. */
    x: number;
    y: number;
    /** Closed: an entry chosen, a click elsewhere or Escape. */
    onClose: () => void;
    /** After Apply Skill Points has put the points in (OnSkillsChanged), for what shows the skill to be read again. */
    onApplied?: (() => void) | null;
  } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  /** The page's own words, where the install's are not to hand. */
  const OWN: Readonly<Record<string, string>> = {
    "UI/SkillQueue/AddSkillMenu/AddToFrontOfQueueTime": "Train first ({takes})",
    "UI/SkillQueue/Skills/CompletionImminent": "almost done",
    "UI/SkillQueue/Skills/SkillTimeLeft": "{[timeinterval]timeLeft.shortWrittenForm, from=day, to=second}",
    "UI/SkillQueue/AddSkillMenu/RemoveHighestLevelFromQueue": "Take level {level} out of the queue",
    "UI/SkillQueue/AddSkillMenu/AddToEndOfQueue": "Queue level {[numeric]nextLevel}",
    "UI/SkillQueue/AddSkillMenu/TrainToLevel5": "Queue every level to V",
    "UI/SkillQueue/AddSkillMenu/ApplySkillPoints": "Put free points into it",
    "UI/Inventory/ItemActions/BuyThisType": "Buy",
    "UI/Commands/ShowInfo": "Show information",
    "UI/Inventory/ItemActions/ViewTypesMarketDetails": "Market details",
    "UI/Inventory/ItemActions/FindInContracts": "Look in contracts",
    "UI/Inventory/ItemActions/FindPersonalAssets": "Look in your assets",
    "UI/Inventory/AssetSearch/KeywordTypeExact": "typeExact",
    "UI/Compare/CompareButton": "Compare",
  };

  function word(label: string, args: Readonly<Record<string, JsonValue>> = {}): string {
    const template = $words.templates[label];
    const text = typeof template === "string" ? template : OWN[label] ?? "";
    return plainText(formatTemplate(text, args, {
      nameOf: (kind, id) => resolvedName($names.resolved, kind, id, ""),
      writeShortInterval: (value, from, to) => shortWrittenInterval(value, $words.templates, (from ?? "day") as TimePart, (to ?? "second") as TimePart),
    }));
  }

  /** The words of an entry. */
  function entryWord(entry: SkillMenuEntry): string {
    switch (entry.kind) {
      case "front": {
        // AddToFrontOfQueueTime: its {takes}, Completion Imminent where it takes nothing, else SkillTimeLeft.
        const takes = entry.ticks !== null && entry.ticks <= 0
          ? word("UI/SkillQueue/Skills/CompletionImminent")
          : entry.ticks === null
            ? ""
            : word("UI/SkillQueue/Skills/SkillTimeLeft", { timeLeft: { type: "long", value: String(Math.trunc(entry.ticks)) } });
        return word("UI/SkillQueue/AddSkillMenu/AddToFrontOfQueueTime", { takes });
      }
      case "removeHighest":
        return word("UI/SkillQueue/AddSkillMenu/RemoveHighestLevelFromQueue", { level: entry.level });
      case "end":
        return word("UI/SkillQueue/AddSkillMenu/AddToEndOfQueue", { nextLevel: entry.level });
      case "toLevel5":
        return word("UI/SkillQueue/AddSkillMenu/TrainToLevel5", { nextLevel: entry.level });
      case "applyPoints":
        return word("UI/SkillQueue/AddSkillMenu/ApplySkillPoints");
      case "buy":
        return word("UI/Inventory/ItemActions/BuyThisType");
      case "showInfo":
        return word("UI/Commands/ShowInfo");
      case "marketDetails":
        return word("UI/Inventory/ItemActions/ViewTypesMarketDetails");
      case "findInContracts":
        return word("UI/Inventory/ItemActions/FindInContracts");
      case "findPersonalAssets":
        return word("UI/Inventory/ItemActions/FindPersonalAssets");
      case "compare":
        return word("UI/Compare/CompareButton");
      case "separator":
        return "";
    }
  }

  /** An entry chosen: the queue's and the points' by the flow, the type menu's by the page's windows. */
  function choose(entry: SkillMenuEntry): void {
    // The skill taken first: closing ends the menu, and with it what its props read.
    const typeID = skill;
    const applied = onApplied;
    onClose();
    switch (entry.kind) {
      case "front":
      case "removeHighest":
      case "end":
      case "toLevel5":
        void flow.skillMenuChoose(typeID, entry).catch(() => {});
        return;
      case "applyPoints":
        void flow.skillMenuChoose(typeID, entry).catch(() => {}).then(() => applied?.());
        return;
      case "showInfo":
        showInfo({ kind: "type", typeID });
        return;
      case "marketDetails":
        showMarketDetails(typeID);
        return;
      case "findInContracts":
        findInContracts(typeID);
        return;
      case "findPersonalAssets":
        findInPersonalAssets(assetSearchTextForType(word("UI/Inventory/AssetSearch/KeywordTypeExact"), resolvedName($names.resolved, "type", typeID, "")));
        return;
      case "compare":
        compareType(typeID);
        return;
      default:
        return;
    }
  }

  onMount(() => {
    flow.requestWords(Object.keys(OWN));
    const close = (event: Event): void => {
      if (!(event.target instanceof Element && event.target.closest(".skill-row-menu"))) onClose();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
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
</script>

<span class="hull-menu skill-row-menu" role="menu" use:portal style:left={`${x}px`} style:top={`${y}px`}>
  {#each entries as entry, at (at)}
    {#if entry.kind === "separator"}
      <hr />
    {:else if entry.kind === "buy"}
      <button type="button" role="menuitem" disabled title="The market's buy window is not on this page.">{entryWord(entry)}</button>
    {:else}
      <button type="button" role="menuitem" onclick={() => choose(entry)}>{entryWord(entry)}</button>
    {/if}
  {/each}
</span>
