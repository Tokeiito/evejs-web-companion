<script lang="ts">
  // The fitting window, modelled on EVE's own (goals R12 + R21): the active ship
  // inside a circular ring with its slots as SOCKETS on arcs around it, a slim
  // toolbar down the left, the ship's readings in a COLLAPSIBLE panel down the
  // right, and CPU / powergrid / bay / value read-outs along the bottom — the
  // same shape a capsuleer already knows. A list view stays behind the R8
  // breakpoint for a phone.
  //
  // A pure reader of the store's fitting + inventory + dogma slices. All bind /
  // ListByFlags / Add / SetModuleOnline logic lives on the BFF (which holds the
  // bound-object handles) and in app/flow.ts. Slots are addressed by FAMILY and
  // INDEX — no slot flagID, typeID or itemID is ever rendered.
  //
  // THE IRON RULE: every number here is one the SERVER produced (or pure
  // arithmetic over server numbers). A statistic we cannot honestly source
  // renders the word "Unavailable" with its reason on hover — never a 0 and
  // never an empty cell, because a wrong 0 in a fitting window is a claim we are
  // not entitled to make. Clicking a module shows its EFFECTIVE stats — skills,
  // hull bonuses and in-space effects already applied — taken straight from the
  // server's post-dogma map and never recomputed in the browser.
  import { onMount } from "svelte";
  import { portal } from "./portal.ts";
  import {
    SLOT_FAMILY_LABELS,
    SLOT_FAMILY_ORDER,
    chargeLooksCompatible,
    isChargeRow,
    isFittableRow,
    slotsOfFamily,
  } from "../bridge/fitting.ts";
  import { OUTER_RADIUS_PERCENT, countByFamily, placeFamily } from "./fittingGeometry.ts";
  import { abbreviate } from "./fittingIcons.ts";
  import { HANGAR_NAME } from "./inventoryModel.ts";
  // R78 — drag and drop. The RULES (what may be dropped where, and why not) live
  // in a pure module, because a target that decides inside `dragover` can only be
  // checked by dragging onto it — and `dragover` is also what tells the cursor
  // whether a drop is allowed, so a rule written there can promise a drop that
  // the drop handler then refuses.
  import {
    DRAG_MIME,
    carriesOurPayload,
    decodeDrag,
    dropOnSocketVerdict,
    encodeDrag,
    type DragPayload,
  } from "./dragDrop.ts";
  import { startFittingDrag } from "./fittingDrag.ts";
  import TypeIcon from "./TypeIcon.svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type {
    FittingResource,
    FittingSlot,
    InventoryItemRow,
    SlotFamily,
  } from "../store/types.ts";
  import { resolvedName, nameKey, type NameRef } from "../store/names.ts";
  import { LAYERS, type LayerName, type Stat, unavailable } from "../bridge/shipStats.ts";
  import { moduleEffectiveStats, type ModuleStat } from "../bridge/moduleAttributes.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { INTERVAL_WORD_LABELS, SHORT_INTERVAL_WORD_LABELS, intervalWriters } from "../bridge/timeInterval.ts";
  import { hullTree, NON_EMPIRE, type HullFacts, type ShipTraitBonus, type ShipTraits } from "../bridge/hullBrowser.ts";
  import { showInfo } from "./showInfo.ts";
  import type { JsonValue } from "../bridge/wire.ts";
  import { showMarketDetails } from "./marketDetails.ts";
  import { findInPersonalAssets } from "./assetsSearch.ts";
  import { findInContracts } from "./contractsSearch.ts";
  import { compareType, compareTypes } from "./typeCompare.ts";
  import { assetSearchTextForType } from "../bridge/assetSearch.ts";
  import { mailBodyLines } from "../bridge/mailMarkup.ts";

  let {
    store,
    flow,
    showInventory,
  }: {
    store: ClientStore;
    flow: AppFlow;
    /** Opens the Inventory & Ship panel (where the drone bay lives while docked). */
    showInventory?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // svelte-ignore state_referenced_locally
  const inventory = store.inventory;
  // svelte-ignore state_referenced_locally
  const dogma = store.dogma;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const savedFittings = flow.savedFittings;
  // svelte-ignore state_referenced_locally
  const communityFittingsEnabled = flow.communityFittingsEnabled;
  // svelte-ignore state_referenced_locally
  const hullBrowser = flow.hullBrowser;
  // svelte-ignore state_referenced_locally
  const maxShipsToFit = flow.maxShipsToFit;
  // svelte-ignore state_referenced_locally
  const fittingsDeletable = flow.fittingsDeletable;
  /** GetDeletableNodes (fittingUtil.CanDeleteFit): the pilot's own, and the corporation's or the alliance's where it may. */
  const deletable = (source: string): boolean => source === "personal" || (source === "corporation" && $fittingsDeletable.corporation) || (source === "alliance" && $fittingsDeletable.alliance);
  // The browser's selection, as its scroll keeps one (scroll.SelectNode, 550 to 598): a click on a fitting selects it
  // alone; Ctrl, it added or taken out; Shift, the run of rows from the last clicked to it, alone (and the last
  // clicked kept), or with Ctrl added to what is selected. By the fittings' numbers, the run by the rows as shown.
  let selectedFittings = $state<readonly number[]>([]);
  let lastSelectedFitting: number | null = null;
  let browserSection = $state<HTMLElement | null>(null);
  /** The fittings' rows as the browser shows them now, in order (the scroll's nodes). */
  const shownFittingIDs = (): number[] => [...(browserSection?.querySelectorAll<HTMLElement>("[data-fitting-id]") ?? [])].map((row) => Number(row.dataset.fittingId));
  function selectFitting(fittingID: number, event: MouseEvent): void {
    const control = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;
    const rows = shownFittingIDs();
    const from = lastSelectedFitting === null ? -1 : rows.indexOf(lastSelectedFitting);
    const to = rows.indexOf(fittingID);
    const run = from >= 0 && to >= 0 && from !== to ? rows.slice(Math.min(from, to), Math.max(from, to) + 1) : null;
    if (!control && !shift) selectedFittings = [fittingID];
    else if (control && !shift) {
      selectedFittings = selectedFittings.includes(fittingID) ? selectedFittings.filter((id) => id !== fittingID) : [...selectedFittings, fittingID];
    } else if (!control && shift) {
      if (run !== null) {
        selectedFittings = run;
        return;
      }
      selectedFittings = [fittingID];
    } else if (run !== null) selectedFittings = [...new Set([...selectedFittings, ...run])];
    lastSelectedFitting = fittingID;
  }
  // A fitting no longer kept goes from the selection.
  $effect(() => {
    const kept = new Set(($savedFittings ?? []).map((fitting) => fitting.fittingID));
    if (selectedFittings.some((id) => !kept.has(id))) selectedFittings = selectedFittings.filter((id) => kept.has(id));
  });
  /** GetDeletableNodes of the selection: those of it CanDeleteFit lets go. */
  const selectedDeletable = $derived(selectedFittings.filter((id) => {
    const fitting = ($savedFittings ?? []).find((each) => each.fittingID === id);
    return fitting !== undefined && deletable(fitting.source);
  }));
  /** inventorycommon/const.py categoryStructure. */
  const CATEGORY_STRUCTURE = 65;
  // svelte-ignore state_referenced_locally
  const station = store.station;

  let busy = $state(false);
  let importExportOpen = $state(false);
  let error = $state("");
  /** Which module the player picked to fit, and where it is coming from. */
  let pickedItemID = $state<number | null>(null);
  let pickedSource = $state<"hangar" | "cargo">("hangar");
  /** The rig awaiting an explicit "yes, destroy it" — never a one-click loss. */
  let confirmingRigID = $state<number | null>(null);

  // --- R21 the radial window ------------------------------------------------

  /**
   * Which layout the player is looking at. The default is decided on mount
   * from the viewport (list on a phone, radial above the R8 breakpoint) and
   * then REMEMBERED, so an explicit choice always beats the guess.
   *
   * It starts as "radial" rather than reading the viewport here because this
   * component also renders under the server generator (panelFirstMount), where
   * there is no `window` at all.
   */
  let view = $state<"radial" | "list">("radial");
  const VIEW_STORAGE_KEY = "evejs.fitting.view";

  /** Which socket the player has selected; its actions show beneath the ring. */
  let selected = $state<{ family: SlotFamily; index: number } | null>(null);

  function chooseView(next: "radial" | "list"): void {
    view = next;
    selected = null;
    try {
      globalThis.localStorage?.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // A browser with storage blocked still gets the toggle, just not the
      // memory of it. Never let that break the panel.
    }
  }

  /** The sockets to draw, with each one's placement and what is in it. */
  const sockets = $derived.by(() => {
    const counts = countByFamily($fitting.slots);
    const placed: {
      slot: FittingSlot;
      xPercent: number;
      yPercent: number;
    }[] = [];
    for (const family of SLOT_FAMILY_ORDER) {
      const placements = placeFamily(family, counts[family], OUTER_RADIUS_PERCENT);
      const familySlots = slotsOfFamily($fitting.slots, family);
      for (const placement of placements) {
        const slot = familySlots[placement.index];
        if (slot) {
          placed.push({
            slot,
            xPercent: placement.xPercent,
            yPercent: placement.yPercent,
          });
        }
      }
    }
    return placed;
  });

  /** A key per family for the legend: label, how many, how many filled. */
  const legend = $derived.by(() =>
    SLOT_FAMILY_ORDER.map((family) => {
      const familySlots = slotsOfFamily($fitting.slots, family);
      return {
        family,
        label: SLOT_FAMILY_LABELS[family],
        total: familySlots.length,
        filled: familySlots.filter((slot) => slot.module !== null).length,
      };
    }).filter((entry) => entry.total > 0),
  );

  const selectedSlot = $derived.by<FittingSlot | null>(() => {
    if (selected === null) {
      return null;
    }
    return (
      $fitting.slots.find(
        (slot) => slot.family === selected!.family && slot.index === selected!.index,
      ) ?? null
    );
  });

  function isSelected(slot: FittingSlot): boolean {
    return selected !== null && selected.family === slot.family && selected.index === slot.index;
  }

  /**
   * Clicking a socket. Holding a module and tapping an EMPTY socket fits it
   * straight in — that is the gesture the layout exists for. Anything else
   * selects the socket and shows its actions underneath.
   */
  function clickSocket(slot: FittingSlot): void {
    if (slot.module === null && pickedItemID !== null) {
      fitInto(slot);
      return;
    }
    selected = isSelected(slot) ? null : { family: slot.family, index: slot.index };
    confirmingRigID = null;
  }

  /** What an EMPTY socket shows: its number within its family. */
  function socketText(slot: FittingSlot): string {
    return String(slot.index + 1);
  }

  /** The full spoken/hover description of a socket — never an abbreviation. */
  function socketDescription(slot: FittingSlot): string {
    if (!slot.module) {
      return `${slotName(slot)}, empty`;
    }
    const name = moduleName(slot.module.typeID);
    if (slot.family === "rig" || slot.family === "subsystem") {
      return `${slotName(slot)}, ${name}`;
    }
    // What is loaded belongs in the socket's own description: the tile is a
    // picture of the MODULE, so this is the only place a player learns the gun
    // has ammunition in it without opening something else.
    const loaded = slot.module.charge
      ? `, loaded with ${chargeCount(slot.module.charge.quantity)} ${moduleName(slot.module.charge.typeID)}`
      : "";
    return `${slotName(slot)}, ${name}, ${slot.module.online ? "online" : "offline"}${loaded}`;
  }

  // The fitting window's browser of saved fittings (fittingScreen/browsers/fittingBrowser.py), as far as the page has
  // it: its tree of ship groups, races and hulls with the fittings under each hull (bridge/hullBrowser.ts), and of a
  // fitting's menu (GetFittingMenu) View Fitting, Fit to Active Ship, Buy All and Delete Fitting (for the pilot's own:
  // CanDeleteFit) and Open Multifit (the multifit window, ClientDialogs.svelte), its import and export menu's Import
  // from Clipboard and Export to Clipboard (not its Simulate from Clipboard, its files nor Copy All Skills), and the
  // tooltips of a fitting and of a hull (its traits with them), a hull's menu (Show Info, View Market Details, Find in
  // Contracts, Find Personal Assets and Compare), and the selection's Delete Fitting for several at once
  // (DeleteManyFittings). Its words are the install's; the page's own stand in. Not done: a hull's Simulate button, the
  // menu's Simulate Fitting, a fitting clicked (simulated), and an unsupported fitting shown whole to a game master. A
  // group's or a race's menu is the client's ShipParentGroup's: Compare, then Expand or Collapse. Delete Fitting is offered as GetDeletableNodes offers it (the
  // corporation's and the alliance's by role). The tree's open groups are kept while the window is.
  const FITTING_BROWSER_WORDS: Readonly<Record<string, string>> = {
    // The browser's own button (fittingWnd.py 100, BROWSE_FITTINGS).
    "UI/Fitting/FittingWindow/ShipAndFittings": "Ships and fittings",
    // A hull's traits in its tooltip (traits.TraitsContainer) and its menu (menusvc.GetMenuFromItemIDTypeID).
    "UI/ShipTree/SkillNameCaption": "With each level of {skillName}:",
    "UI/ShipTree/RoleBonus": "By its role:",
    "UI/ShipTree/MiscBonus": "Besides:",
    "UI/InfoWindow/TraitWithNumber": "{value}{unit} {bonusText}",
    "UI/InfoWindow/TraitWithoutNumber": "- {bonusText}",
    "UI/Commands/ShowInfo": "About it",
    "UI/Inventory/ItemActions/ViewTypesMarketDetails": "Its market",
    "UI/Inventory/ItemActions/FindPersonalAssets": "Where you have it",
    "UI/Inventory/ItemActions/FindInContracts": "Contracts of it",
    "UI/Compare/CompareButton": "Side by side",
    // A group's menu after its Compare (ListGroup.GetMenu, 299 to 304).
    "UI/Common/Expand": "Open it",
    "UI/Common/Collapse": "Close it",
    // The asset search's exact-type keyword (assetSearchUtil, KeywordTypeExact): a word the search reads, not shown.
    "UI/Inventory/AssetSearch/KeywordTypeExact": "typeExact",
    "UI/Fitting/FittingWindow/ViewFitting": "Look at it",
    // The fitting window's own button (hullAndHardwareTypeBrowser.py 577).
    "UI/Fitting/FittingWindow/SaveFitAs": "Save this ship's fitting",
    "UI/Fitting/FittingWindow/FitFittingToActiveShip": "Fit to this ship",
    "UI/Fitting/FittingWindow/FittingManagement/DeleteFitting": "Delete it",
    "UI/Fitting/FittingWindow/FittingManagement/OpenMultifit": "Fit several ships",
    // The browser's import and export menu (hullAndHardwareTypeBrowser.py 680 to 694).
    "UI/Fitting/FittingWindow/ImportAndExport": "Import and export",
    "UI/Fitting/FittingWindow/FittingManagement/ImportFromClipboard": "Read a fitting from the clipboard",
    "UI/Fitting/FittingWindow/FittingManagement/ImportFromClipboardHint": "",
    "UI/Fitting/FittingWindow/FittingManagement/ExportToClipboard": "Copy this ship's fitting as text",
    "UI/Fitting/FittingWindow/FittingManagement/ExportToClipboardHint": "",
    // Said by the import (flow.ts importFittingFromClipboard): asked here, where it is made.
    "UI/SkillQueue/CouldNotReadLines": "",
    "UI/Market/MarketQuote/BuyAll": "Shop for all of it",
    "UI/Common/NothingFound": "None found",
    // The browser's filter buttons' hints (hullAndHardwareTypeBrowser.py 406 to 413, LoadFilterBtnTooltipPanel).
    "UI/Fitting/FittingWindow/FilterPersonalFittings": "Your own fittings {numFittings}",
    "UI/Fitting/FittingWindow/FilterCorpFittings": "Your corporation's fittings {numFittings}",
    "UI/Fitting/FittingWindow/FilterCurrentHull": "Only for the ship you are in",
    "UI/Fitting/FittingWindow/FilterSkillsForFitting": "Only those you have the skills for",
    "UI/Fitting/FilterCommunityFittings": "Fittings shared with everyone",
    "UI/Fitting/FittingWindow/FilterAllianceFittings": "Your alliance's fittings {numFittings}",
    "UI/Fitting/AllianceFittingHint": "Your alliance's fitting",
    "UI/Fitting/FittingWindow/SavedAllianceFittings": "Your alliance's fittings",
    // A fitting's tooltip (entries/fitting.py FittingEntry.LoadTooltipPanel, 87 to 98) and a hull's
    // (fittingBrowser.py HullTypeListGroup.LoadTooltipPanel, 705 to 738).
    "UI/Fitting/FittingLastSavedHint": "Saved {timestamp}",
    "/Carbon/UI/Common/DateTime/SimpleDateUTC": "",
    "UI/Fitting/FittingWindow/SavedFittings": "Saved fittings",
    "UI/Fitting/FittingWindow/PersonalFittingsNum": "Your own: {numFittings}",
    "UI/Fitting/FittingWindow/PersonalFittingsNumShort": "Own: {numFittings}",
    "UI/Fitting/FittingWindow/CorpFittingsNum": "Your corporation's: {numFittings}",
    "UI/Fitting/FittingWindow/CorpFittingsNumShort": "Corporation: {numFittings}",
    "UI/Fitting/FittingWindow/CommunityFittingsNum": "Shared with everyone: {numFittings}",
    "UI/Fitting/FittingWindow/CommunityFittingsNumShort": "Shared: {numFittings}",
    "UI/Fitting/FittingWindow/AllianceFittingsNum": "Your alliance's: {numFittings}",
    "UI/Fitting/FittingWindow/AllianceFittingsNumShort": "Alliance: {numFittings}",
    "UI/Fitting/FittingWindow/NoFittingsSaved": "No fittings saved for it",
    // The tree's own groups (fittingBrowser.py 131 to 182, GetNameAndIconIDForRace).
    "UI/Fitting/FittingWindow/NonEmpireFaction": "Other factions",
    "UI/Fitting/FittingWindow/SpecialEditionShips": "Special ships",
    "UI/Fitting/FittingWindow/UnsupportedShip": "Hulls no longer had",
    "UI/Fitting/FittingWindow/UnknownShipType": "an unknown hull",
    // A fitting's owner mark (entries/fitting.py FittingEntry.Load, 58 to 70) and a hull's counts by owner
    // (fittingBrowser.py ShipTypeGroup, 630 to 650).
    "UI/Fitting/CorpFittingHint": "Your corporation's fitting",
    "UI/Fitting/CommunityFittingHint": "A fitting shared with everyone",
    "UI/Fitting/FittingWindow/SavedPersonalFittings": "Your own fittings",
    "UI/Fitting/FittingWindow/SavedCorpFittings": "Your corporation's fittings",
    "UI/Fitting/FittingWindow/SavedCommunityFittings": "Fittings shared with everyone",
    // Said as a fitting is loaded (flow.ts loadSavedFitting): asked here, where it is loaded from.
    "UI/Fitting/ShipHasRigsAlready": "",
    "UI/Fitting/FittingWindow/FittingManagement/BusyFittingWarning": "",
  };
  const fitWord = (label: string): string => {
    const template = $words.templates[label];
    return plainText(typeof template === "string" && template !== "" ? template : FITTING_BROWSER_WORDS[label] ?? "");
  };
  $effect(() => {
    if (!$fitting.activeShipID) return;
    flow.requestWords(Object.keys(FITTING_BROWSER_WORDS));
  });

  // The capacitor panel's words (capacitorPanel.py), the client's from the player's install; the page's own where it
  // has none.
  const CAPACITOR_WORDS: Readonly<Record<string, string>> = {
    "UI/Fitting/FittingWindow/Stable": "Stable",
    "UI/Fitting/FittingWindow/CapacitorNotStable": "Empty after {[timeinterval]time.shortForm, from=hour, to=second}",
    "UI/Fitting/FittingWindow/ModulesSustainable": "Your modules can run without stopping",
    "UI/Fitting/FittingWindow/ModulesNotSustainable": "Your modules drain the capacitor faster than it recharges",
    "UI/Fitting/FittingWindow/CapacitorDelta": "{[numeric]delta, decimalPlaces=1} GJ/s spare ({[numeric]percentage, decimalPlaces=1}%)",
    "UI/Fitting/FittingWindow/ExcessCapacitor": "Recharge left over",
    "UI/Fitting/FittingWindow/CapSustainableBy": "Settles at {[numeric]balance, decimalPlaces=1}% of its capacity",
    "UI/Fitting/FittingWindow/CapRunsOutBy": "Lasts {[timeinterval]ttl, from=hour, to=second}",
  };
  $effect(() => {
    if (!$fitting.activeShipID) return;
    flow.requestWords([...Object.keys(CAPACITOR_WORDS), ...INTERVAL_WORD_LABELS, ...SHORT_INTERVAL_WORD_LABELS]);
  });
  /** A capacitor label filled: the client's template where the install has it, the page's own otherwise. */
  function capacitorWord(label: string, args: Record<string, string | number> = {}): string {
    const template = $words.templates[label];
    return plainText(formatTemplate(typeof template === "string" && template !== "" ? template : CAPACITOR_WORDS[label] ?? "", args, {
      nameOf: (kind, id) => String($names.resolved[nameKey(kind, id)] ?? id),
      ...intervalWriters($words.templates),
    }));
  }
  type CapacitorSimulation = NonNullable<typeof stats.capacitor.simulator>;
  /** capacitorPanel.SetHeaderText: Stable where it settles, else when it runs dry (its TTL, a whole number of ticks). */
  function capacitorHeadline(simulation: CapacitorSimulation): string {
    return simulation.loadBalance > 0
      ? capacitorWord("UI/Fitting/FittingWindow/Stable")
      : capacitorWord("UI/Fitting/FittingWindow/CapacitorNotStable", { time: Math.trunc(simulation.ttl ?? 0) });
  }
  /** capacitorPanel.ColorPowerCore's hint: the share it settles at, or how long it lasts. */
  function capacitorBalance(simulation: CapacitorSimulation): string {
    return simulation.loadBalance === 0
      ? capacitorWord("UI/Fitting/FittingWindow/CapRunsOutBy", { ttl: Math.trunc(simulation.ttl ?? 0) })
      : capacitorWord("UI/Fitting/FittingWindow/CapSustainableBy", { balance: simulation.loadBalance * 100 });
  }
  // The fittings read once the window has a ship (fittingSvc.PrimeFittings).
  let fittingsAsked = false;
  $effect(() => {
    if (!$fitting.activeShipID || fittingsAsked) return;
    fittingsAsked = true;
    void flow.loadSavedFittings().catch(() => {});
  });
  // The browser's filters (hullAndHardwareTypeBrowser.construct_fitting_filter_buttons, 405 to 414;
  // filterSettings.BrowserHullSettings): the pilot's own fittings, its corporation's, and only those for the ship it is
  // in, each off until set (with no owner set, every owner's are shown: GetFittingScrolllist, 74 to 79); and the search
  // (CharSettingString lastHullFilterString, the character's), which a fitting's name, its hull's name or the hull's
  // group's holds (FilterOutFittings, TextMatched, 265 to 320). The toggles are the account's (UserSettingBool), kept
  // here in this browser, as is the search for the character. The skills' filter lets through only the fittings the pilot has the skills for (FilterOutFittings,
  // 283 to 289; the flow's fittingsWithSkills, fittingSvc.HasSkillForFit). The community's filter is on until unset
  // (fittings_show_community, FILTER_DEFAULT_COMMUNITY_FITTING), and with the global config's community fittings off
  // (AreCommunityFittingsEnabled) its button is not shown nor its fittings read (GetFittingScrolllist, 66 to 80). With no
  // owner's filter set, every hull the market sells is listed that the search (its name or its group's), the
  // current-hull filter and the skills filter (godma.CheckSkillRequirementsForType: the flow's hullsWithSkills) let
  // through (GetAllShipGroupsAndShipsByGroupID, 359 to 383). The alliance's filter is off until set, and with the pilot in
  // no alliance its button is not shown nor its fittings read (fittings_show_alliance; GetFittingScrolllist, 70).
  const HULL_SETTINGS_KEPT = "evejs.BrowserHullSettings";
  const HULL_FILTER_KEPT = "evejs.lastHullFilterString";
  const keptHullSettings = ((): { personal: boolean; corp: boolean; alliance: boolean; community: boolean; currentShip: boolean; skills: boolean } => {
    try {
      const kept = JSON.parse(localStorage.getItem(HULL_SETTINGS_KEPT) ?? "null") as Record<string, unknown> | null;
      return { personal: kept?.personal === true, corp: kept?.corp === true, alliance: kept?.alliance === true, community: kept?.community !== false, currentShip: kept?.currentShip === true, skills: kept?.skills === true };
    } catch {
      return { personal: false, corp: false, alliance: false, community: true, currentShip: false, skills: false };
    }
  })();
  let allianceFilterSet = $state(keptHullSettings.alliance);
  /** session.allianceid, as the page has it: null for none. */
  const allianceID = $derived(((id) => (id !== null && id !== undefined && id > 0 ? id : null))($station.online?.allianceID));
  /** showAllianceFittings: the alliance's filter, where the pilot is in one. */
  const showAllianceFittings = $derived(allianceID !== null && allianceFilterSet);
  let communityFilterSet = $state(keptHullSettings.community);
  /** showCommunityFittings: the community's filter, where the global config has community fittings on. */
  const showCommunityFittings = $derived($communityFittingsEnabled && communityFilterSet);
  let onlyWithSkills = $state(keptHullSettings.skills);
  /** The fittings the pilot has the skills for, as the flow last answered; null while none is answered. */
  let fittingsWithSkills = $state<ReadonlySet<number> | null>(null);
  $effect(() => {
    if (!onlyWithSkills) return;
    const ids = ($savedFittings ?? []).map((saved) => saved.fittingID);
    void flow.fittingsWithSkills(ids).then((set) => { fittingsWithSkills = set; }).catch(() => {});
  });
  /** The market's hulls the pilot has the skills for, as the flow last answered; null while none is answered. */
  let hullsWithSkills = $state<ReadonlySet<number> | null>(null);
  $effect(() => {
    const data = $hullBrowser;
    if (!onlyWithSkills || ownerFilterIsSet || data === null || !data.available) return;
    void flow.hullsWithSkills(data.hullTypeIDs).then((set) => { hullsWithSkills = set; }).catch(() => {});
  });
  // The browser's hulls read once there are fittings to place (the client's own data), with each fitting's hull.
  $effect(() => {
    if ($savedFittings === null) return;
    void flow.loadHullBrowser([...new Set($savedFittings.map((saved) => saved.shipTypeID))]).catch(() => {});
  });
  let showPersonalFittings = $state(keptHullSettings.personal);
  let showCorpFittings = $state(keptHullSettings.corp);
  let onlyCurrentHull = $state(keptHullSettings.currentShip);
  const hullFilterKey = (): string | null => {
    const characterID = store.station.get().online?.characterID ?? null;
    return characterID === null ? null : `${HULL_FILTER_KEPT}.${characterID}`;
  };
  let hullFilterText = $state(((): string => {
    try {
      const key = hullFilterKey();
      return key === null ? "" : localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  })());
  function keepHullSettings(): void {
    try {
      localStorage.setItem(HULL_SETTINGS_KEPT, JSON.stringify({ personal: showPersonalFittings, corp: showCorpFittings, alliance: allianceFilterSet, community: communityFilterSet, currentShip: onlyCurrentHull, skills: onlyWithSkills }));
      const key = hullFilterKey();
      if (key !== null) localStorage.setItem(key, hullFilterText);
    } catch {
      // Storage refused: the filters hold while the window is open.
    }
  }
  // The hulls' names and their groups' (every hull the market sells, where they are listed), for the tree and the
  // search; and the races' names (the messages their records name).
  $effect(() => {
    const listed = !ownerFilterIsSet && $hullBrowser?.available ? $hullBrowser.hullTypeIDs : [];
    const hulls = [...new Set([...($savedFittings ?? []).map((saved) => saved.shipTypeID), ...listed])];
    if (hulls.length > 0) flow.requestNames(hulls.flatMap((id) => [{ kind: "type" as const, id }, { kind: "typeGroup" as const, id }]));
  });
  $effect(() => {
    const races = Object.values($hullBrowser?.raceNameIDs ?? {}).flatMap((messageID) => (messageID === null ? [] : [`#${messageID}`]));
    if (races.length > 0) flow.requestWords(races);
  });
  /** A race's name (characterdata/races.py get_race_name), the non-empire factions' the browser's own label. */
  function raceName(raceID: number): string {
    if (raceID === NON_EMPIRE) return fitWord("UI/Fitting/FittingWindow/NonEmpireFaction");
    const messageID = $hullBrowser?.raceNameIDs[raceID] ?? null;
    const template = messageID === null ? undefined : $words.templates[`#${messageID}`];
    return typeof template === "string" && template !== "" ? plainText(template) : String(raceID);
  }
  // The tree's groups, races and hulls opened (the client's list groups' open state), while the window is open.
  let opened = $state<Record<string, boolean>>({});
  function toggled(id: string, event: Event): void {
    const open = (event.currentTarget as HTMLDetailsElement).open;
    if ((opened[id] === true) !== open) opened[id] = open;
  }
  /** A filter button's hint with the owner's count (LoadFilterBtnTooltipPanel: "(n/most)"). */
  function filterHint(label: string, count: number, most: number): string {
    const template = $words.templates[label];
    return plainText(formatTemplate(typeof template === "string" && template !== "" ? template : FITTING_BROWSER_WORDS[label] ?? "", { numFittings: `(${count}/${most})` }, { nameOf: (kind, id) => String($names.resolved[nameKey(kind, id)] ?? id) }));
  }
  const hullName = (typeID: number): string => String($names.resolved[nameKey("type", typeID)] ?? "");
  const hullGroupName = (typeID: number): string => String($names.resolved[nameKey("typeGroup", typeID)] ?? "");
  /** A label's words with its arguments, the page's own where the install's are not to hand. */
  function fitWords(label: string, args: Record<string, string | number>): string {
    const template = $words.templates[label];
    return plainText(formatTemplate(typeof template === "string" && template !== "" ? template : FITTING_BROWSER_WORDS[label] ?? "", args, { nameOf: (kind, id) => String($names.resolved[nameKey(kind, id)] ?? id) }));
  }
  /**
   * FittingEntry.LoadTooltipPanel (entries/fitting.py 87 to 98): the fitting's name, its hull's, its description where
   * it has one, and when it was saved (FittingLastSavedHint, FmtDate: SimpleDateUTC) where it says. As a hint's lines;
   * the description's markup as its text.
   */
  function fittingTooltip(saved: { readonly name: string; readonly shipTypeID: number; readonly description: string; readonly savedDate: bigint | null }): string {
    const lines = [plainText(saved.name), hullName(saved.shipTypeID)];
    if (saved.description) lines.push(plainText(saved.description));
    if (saved.savedDate) {
      const date = $words.templates["/Carbon/UI/Common/DateTime/SimpleDateUTC"];
      const timestamp = typeof date === "string" && date !== "" ? plainText(formatTemplate(date, { datetime: saved.savedDate.toString() }, { nameOf: () => "" })) : "";
      if (timestamp) lines.push(fitWords("UI/Fitting/FittingLastSavedHint", { timestamp }));
    }
    return lines.join("\n");
  }
  /**
   * HullTypeListGroup.LoadTooltipPanel (fittingBrowser.py 705 to 738): the hull's name; then each owner's count of its
   * fittings that has any, the community's only where community fittings are on and the alliance's only for a pilot
   * in one, in short words under "Saved Fittings" where two owners or more have any; NoFittingsSaved where none has.
   * Then the hull's traits, where it has any (HasTraits, TraitsContainer: traitLines).
   */
  // svelte-ignore state_referenced_locally
  const shipTraits = flow.shipTraits;
  /** A message of the client's by its number, made plain; none where the page has not got it. */
  const messageText = (messageID: number | null): string => {
    const template = messageID === null ? undefined : $words.templates[`#${messageID}`];
    return typeof template === "string" ? plainText(template) : "";
  };
  /**
   * TraitsContainer (traits.py 34 to 125) as lines of a hint: a caption for each skill the bonuses go with, by the
   * skill's number (SkillNameCaption), then for the role's (RoleBonus) and the others (MiscBonus); under each its bonuses
   * by importance (_GetBonusText: TraitWithNumber, the bonus rounded to a tenth and a whole one as such, with its unit's
   * name; TraitWithoutNumber where it has no number). The markup is made plain, its tab a space.
   */
  function traitLines(traits: ShipTraits): string[] {
    const traitWords = (label: string, args: Record<string, JsonValue>): string => {
      const template = $words.templates[label];
      const text = typeof template === "string" && template !== "" ? template : FITTING_BROWSER_WORDS[label] ?? "";
      return plainText(formatTemplate(text.split("<t>").join(" "), args, { nameOf: (kind, id) => String($names.resolved[nameKey(kind, id)] ?? id) }));
    };
    const bonusLine = (bonus: ShipTraitBonus): string => {
      const bonusText = messageText(bonus.nameID);
      if (bonus.bonus === null) return traitWords("UI/InfoWindow/TraitWithoutNumber", { color: "", bonusText });
      // round(bonus, 1), and an int where int(bonus) == bonus (Python 2 rounds a half away from nought): given as a long,
      // which the numeric tag writes as an int ("5", where the float would be "5.0").
      const value: JsonValue = Number.isInteger(bonus.bonus)
        ? { type: "long", value: String(bonus.bonus) }
        : (Math.sign(bonus.bonus) * Math.round(Math.abs(bonus.bonus) * 10)) / 10;
      const unit = messageText(bonus.unitID === null ? null : $shipTraits.unitNameIDs.get(bonus.unitID) ?? null);
      return traitWords("UI/InfoWindow/TraitWithNumber", { color: "", value, unit, bonusText });
    };
    const lines: string[] = [];
    const add = (caption: string, bonuses: readonly ShipTraitBonus[]): void => {
      lines.push(caption);
      for (const bonus of [...bonuses].sort((left, right) => left.importance - right.importance)) lines.push(`  ${bonusLine(bonus)}`);
    };
    for (const skill of [...traits.skills].sort((left, right) => left.skillTypeID - right.skillTypeID)) {
      add(traitWords("UI/ShipTree/SkillNameCaption", { skillName: hullName(skill.skillTypeID) }), skill.bonuses);
    }
    if (traits.role.length > 0) add(fitWord("UI/ShipTree/RoleBonus"), traits.role);
    if (traits.misc.length > 0) add(fitWord("UI/ShipTree/MiscBonus"), traits.misc);
    return lines;
  }
  // A hull's menu (HullTypeListGroup.GetMenu, 693 to 695: menusvc.GetMenuFromItemIDTypeID(None, typeID,
  // includeMarketDetails=True), 2281 to 2352) on its right click: Show Info, and View Market Details where the type has a
  // market group, and where it is published Find in Contracts (contracts.FindRelated: the contracts window's search for
  // the type, contractsSearch.ts) and Find Personal Assets (invItemFunctions.FindInPersonalAssets: the assets window's
  // search for the type's exact name, assetsSearch.ts); and Compare, the type's category being among compareCategories
  // (2347 to 2348: every hull's is; CompareType, the compare tool, typeCompare.ts). Not the page's: a GM's "GM / WM
  // Extras".
  let hullMenu = $state<{ readonly typeID: number; readonly x: number; readonly y: number } | null>(null);
  function openHullMenu(typeID: number, event: MouseEvent): void {
    event.preventDefault();
    nodeMenu = null;
    hullMenu = { typeID, x: event.clientX, y: event.clientY };
  }
  // A group's or a race's menu (ShipParentGroup.GetMenu, fittingBrowser.py 579 to 583): Compare, which compares the
  // node's hulls in the order it holds them (menusvc.CompareTypes(node.typeIDs): the compare tool opened, typeCompare.ts);
  // then the list group's own (ListGroup.GetMenu, 284 to 311): Expand or Collapse, the node being locked (no Change
  // Label, no Delete Folder) and kept from a window of its own (BlockOpenWindow). The Special Edition Ships group is
  // given its hulls as "typeIds" (fittingBrowser.py 138), so its typeIDs are None, and its Compare raises in CompareTypes
  // before anything opens: here it does nothing (typeIDs null).
  let nodeMenu = $state<{ readonly typeIDs: readonly number[] | null; readonly id: string; readonly x: number; readonly y: number } | null>(null);
  function openNodeMenu(typeIDs: readonly number[] | null, id: string, event: MouseEvent): void {
    event.preventDefault();
    hullMenu = null;
    nodeMenu = { typeIDs, id, x: event.clientX, y: event.clientY };
  }
  $effect(() => {
    if (hullMenu === null && nodeMenu === null) return;
    const close = (event: Event): void => {
      if (!(event.target instanceof Element && event.target.closest(".hull-menu"))) {
        hullMenu = null;
        nodeMenu = null;
      }
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        hullMenu = null;
        nodeMenu = null;
      }
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
  function hullTooltip(typeID: number): string {
    const count = fittingNumByTypeID.get(typeID) ?? { personal: 0, corporation: 0, community: 0, alliance: 0 };
    const owners = [count.personal, count.corporation, count.community, count.alliance].filter((each) => each > 0).length;
    const short = owners >= 2;
    const lines = [hullName(typeID)];
    if (short) lines.push(fitWord("UI/Fitting/FittingWindow/SavedFittings"));
    const numAndPaths: [number, string][] = [
      [count.personal, "UI/Fitting/FittingWindow/PersonalFittingsNum"],
      [count.corporation, "UI/Fitting/FittingWindow/CorpFittingsNum"],
      ...($communityFittingsEnabled ? [[count.community, "UI/Fitting/FittingWindow/CommunityFittingsNum"] as [number, string]] : []),
      ...(allianceID !== null ? [[count.alliance, "UI/Fitting/FittingWindow/AllianceFittingsNum"] as [number, string]] : []),
    ];
    for (const [numFittings, path] of numAndPaths) {
      if (numFittings) lines.push(fitWords(short ? `${path}Short` : path, { numFittings }));
    }
    if (!owners) lines.push(fitWord("UI/Fitting/FittingWindow/NoFittingsSaved"));
    // HasTraits: then its traits (TraitsContainer), asked as the hull is pointed at.
    const traits = $shipTraits.traits.get(typeID);
    if (traits) lines.push("", ...traitLines(traits));
    return lines.join("\n");
  }
  /** A hull's fittings of each owner, every one read (fittingBrowser.GetNumShipsByTypeID, 200 to 211). */
  const fittingNumByTypeID = $derived.by(() => {
    const counts = new Map<number, { personal: number; corporation: number; community: number; alliance: number }>();
    for (const saved of $savedFittings ?? []) {
      const count = counts.get(saved.shipTypeID) ?? { personal: 0, corporation: 0, community: 0, alliance: 0 };
      counts.set(saved.shipTypeID, { ...count, [saved.source]: count[saved.source] + 1 });
    }
    return counts;
  });
  /** ownerFilterIsSet: an owner's fittings asked for (GetFittingScrolllist, 74). */
  const ownerFilterIsSet = $derived(showPersonalFittings || showCorpFittings || showAllianceFittings || showCommunityFittings);
  /** The fittings the filters let through (FilterOutFittings, 265 to 296). */
  const shownFittings = $derived.by(() => {
    const shownOwner = { personal: showPersonalFittings, corporation: showCorpFittings, community: showCommunityFittings, alliance: showAllianceFittings };
    const text = hullFilterText.toLowerCase();
    const shown = ($savedFittings ?? []).filter((saved) => {
      if (ownerFilterIsSet && !shownOwner[saved.source]) return false;
      if (onlyWithSkills && fittingsWithSkills !== null && !fittingsWithSkills.has(saved.fittingID)) return false;
      if (onlyCurrentHull && activeShipTypeID !== null && saved.shipTypeID !== activeShipTypeID) return false;
      return !text || saved.name.toLowerCase().includes(text) || hullName(saved.shipTypeID).toLowerCase().includes(text) || hullGroupName(saved.shipTypeID).toLowerCase().includes(text);
    });
    return shown;
  });
  /**
   * The browser's tree (bridge/hullBrowser.ts): with no owner's filter set, the market's hulls the search (a hull's name
   * or its group's), the current-hull filter (none at all with no ship: GetAllShipGroupsAndShipsByGroupID, 368 to
   * 369) and the skills filter let through, besides the fittings'. Null where the client's data is not had.
   */
  const browserTree = $derived.by(() => {
    const data = $hullBrowser;
    if (data === null || !data.available) return null;
    const text = hullFilterText.toLowerCase();
    const marketHulls = ownerFilterIsSet ? [] : data.hullTypeIDs.filter((typeID) => {
      if (text && !hullName(typeID).toLowerCase().includes(text) && !hullGroupName(typeID).toLowerCase().includes(text)) return false;
      if (onlyCurrentHull && activeShipTypeID !== typeID) return false;
      return !(onlyWithSkills && hullsWithSkills !== null && !hullsWithSkills.has(typeID));
    });
    return hullTree({
      fittings: shownFittings,
      ownerFilterIsSet,
      marketHulls,
      allMarketHulls: data.hullTypeIDs,
      specialTypeIDs: data.specialTypeIDs,
      facts: (typeID): HullFacts | null | undefined => (data.types.has(typeID) ? data.types.get(typeID) : undefined),
      typeName: hullName,
      groupName: hullGroupName,
      raceName,
      currentShipTypeID: activeShipTypeID,
    });
  });

  /** "160" — a stack count, grouped. A singleton charge reports -1; call it 1. */
  function chargeCount(quantity: number): string {
    return (quantity > 0 ? quantity : 1).toLocaleString();
  }

  // R7c — resolve the ACTIVE SHIP's typeID, every fitted module's typeID and
  // every fittable inventory row's typeID to a display NAME. Fire-and-forget so
  // the panel renders immediately and swaps in names as they arrive.
  $effect(() => {
    const refs: NameRef[] = [];
    if (activeShipTypeID !== null) {
      refs.push({ kind: "type", id: activeShipTypeID });
      refs.push({ kind: "typeGroup", id: activeShipTypeID });
    }
    if ($fitting.activeShipID) {
      refs.push({ kind: "evelocation", id: $fitting.activeShipID });
    }
    for (const slot of $fitting.slots) {
      if (slot.module) {
        refs.push({ kind: "type", id: slot.module.typeID });
        // The loaded charge needs a name too, or the socket description would
        // have to fall back to a number (R7d).
        if (slot.module.charge) {
          refs.push({ kind: "type", id: slot.module.charge.typeID });
        }
      }
    }
    for (const row of fittableRows()) {
      refs.push({ kind: "type", id: row.row.typeID });
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  /** Modules sitting in the hangar or the ship's cargo that could be fitted. */
  function fittableRows(): { row: InventoryItemRow; source: "hangar" | "cargo" }[] {
    const rows: { row: InventoryItemRow; source: "hangar" | "cargo" }[] = [];
    for (const row of $inventory.hangar.rows) {
      if (isFittableRow(row.categoryID)) {
        rows.push({ row, source: "hangar" });
      }
    }
    for (const row of $inventory.cargo.rows) {
      if (isFittableRow(row.categoryID)) {
        rows.push({ row, source: "cargo" });
      }
    }
    return rows;
  }

  const fittable = $derived.by(() => fittableRows());

  /**
   * Every CHARGE stack in the hangar or the ship's cargo — what "Load" can act
   * on. Not filtered by compatibility (see isChargeRow): the panel would have to
   * guess, and a wrong guess hides ammunition that would have worked.
   */
  const chargeRows = $derived.by(() => {
    const rows: { row: InventoryItemRow; source: "hangar" | "cargo" }[] = [];
    for (const row of $inventory.hangar.rows) {
      if (isChargeRow(row.categoryID)) {
        rows.push({ row, source: "hangar" });
      }
    }
    for (const row of $inventory.cargo.rows) {
      if (isChargeRow(row.categoryID)) {
        rows.push({ row, source: "cargo" });
      }
    }
    return rows;
  });

  /**
   * The charge list for the SELECTED module, likely-compatible first.
   *
   * ⚠ SORTED, NEVER FILTERED. The static tables cannot know every case and the
   * server is the authority on what loads, so hiding a charge that would have
   * worked is worse than showing one that will not. A charge we cannot judge
   * sorts between the two — ahead of a known mismatch, behind a known fit.
   */
  const sortedChargeRows = $derived.by(() => {
    const fitment = selectedSlot?.module
      ? $fitting.chargeFits[selectedSlot.module.typeID]
      : undefined;
    const rank = (row: InventoryItemRow): number => {
      const verdict = chargeLooksCompatible(fitment, row.groupID, chargeSizeOf(row));
      return verdict === true ? 0 : verdict === null ? 1 : 2;
    };
    return [...chargeRows].sort((left, right) => rank(left.row) - rank(right.row));
  });

  /**
   * A charge's own size. The inventory rows do not carry it, so this reads the
   * fitment table's entry for the charge TYPE when the BFF happened to include
   * one; otherwise null, which `chargeLooksCompatible` treats as "cannot say".
   */
  function chargeSizeOf(row: InventoryItemRow): number | null {
    return $fitting.chargeFits[row.typeID]?.size ?? null;
  }

  /** Whether this charge looks like it fits the selected module. */
  function chargeVerdict(row: InventoryItemRow): boolean | null {
    const fitment = selectedSlot?.module
      ? $fitting.chargeFits[selectedSlot.module.typeID]
      : undefined;
    return chargeLooksCompatible(fitment, row.groupID, chargeSizeOf(row));
  }

  function loadInto(moduleItemID: number, chargeItemID: number, source: "hangar" | "cargo"): void {
    void run(async () => {
      await flow.loadAmmo([moduleItemID], [chargeItemID], source);
      // The stack the charges came out of shrank, so the list has to re-read.
      await flow.loadInventory();
    });
  }

  function unloadFrom(moduleItemID: number, destination: "hangar" | "cargo"): void {
    void run(async () => {
      await flow.unloadAmmo([moduleItemID], destination);
      await flow.loadInventory();
    });
  }

  function moduleName(typeID: number): string {
    return resolvedName($names.resolved, "type", typeID);
  }

  const pickedName = $derived.by<string | null>(() => {
    if (pickedItemID === null) {
      return null;
    }
    const match = fittable.find((entry) => entry.row.itemID === pickedItemID);
    return match ? moduleName(match.row.typeID) : null;
  });

  /** The active ship's TYPE (what names it) — never its item ID. */
  const activeShipTypeID = $derived.by<number | null>(() => {
    const shipID = $fitting.activeShipID;
    if (shipID === null) {
      return null;
    }
    const row =
      $inventory.hangar.rows.find((entry) => entry.itemID === shipID) ??
      $inventory.cargo.rows.find((entry) => entry.itemID === shipID);
    return row ? row.typeID : null;
  });

  const activeShipName = $derived.by<string>(() => {
    // The ship's own name, as the client's fitting window names it (cfg.evelocations); its type's where it has none.
    const shipID = $fitting.activeShipID;
    const own = shipID === null ? null : $names.resolved[nameKey("evelocation", shipID)];
    if (typeof own === "string" && own !== "") {
      return own;
    }
    if (activeShipTypeID === null) {
      return "your ship";
    }
    const typeName = $names.resolved[nameKey("type", activeShipTypeID)];
    return typeName ?? "your ship";
  });

  /** The hull's class ("Battlecruiser") — its type GROUP, resolved to a name. */
  const activeShipClass = $derived.by<string | null>(() => {
    if (activeShipTypeID === null) {
      return null;
    }
    return $names.resolved[nameKey("typeGroup", activeShipTypeID)] ?? null;
  });

  /** A slot's position in plain language: "High slot 3", never "flag 29". */
  function slotName(slot: FittingSlot): string {
    const family = SLOT_FAMILY_LABELS[slot.family];
    // "High slots" -> "High slot 3"; "Rigs" -> "Rig 1".
    const singular = family.endsWith("slots")
      ? family.replace(/slots$/, "slot")
      : family.replace(/s$/, "");
    return `${singular} ${slot.index + 1}`;
  }

  function resourceText(resource: FittingResource, unit: string): string {
    if (!resource.known) {
      return "—";
    }
    return `${round(resource.used)} / ${round(resource.total)} ${unit}`;
  }

  function round(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function percent(resource: FittingResource): number | null {
    if (!resource.known || resource.total <= 0) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round((resource.used / resource.total) * 100)));
  }

  // --- R21 formatting for the statistic panels ------------------------------
  //
  // Every one of these takes a number the SERVER produced (or pure arithmetic
  // over server numbers) and makes it readable. None of them invents a value.

  const NUMBER = new Intl.NumberFormat("en-GB");

  function whole(value: number): string {
    return NUMBER.format(Math.round(value));
  }

  function toFixed(value: number, digits: number): string {
    return NUMBER.format(Number(value.toFixed(digits)));
  }

  function asPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  /** Metres, shown as km once the number gets long — the way EVE reads them. */
  function asDistance(value: number): string {
    return value >= 1000 ? `${toFixed(value / 1000, 1)} km` : `${whole(value)} m`;
  }

  function asSeconds(value: number): string {
    return `${toFixed(value, 2)} s`;
  }

  function asVolume(value: number): string {
    return `${toFixed(value, 1)} m³`;
  }

  /** Seconds as a clock the way EVE writes a capacitor time: "2m 26s". */
  function asDuration(seconds: number): string {
    const total = Math.round(seconds);
    if (total < 60) {
      return `${total}s`;
    }
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  }

  const layerLabels: Readonly<Record<LayerName, string>> = {
    shield: "Shield",
    armor: "Armor",
    hull: "Structure",
  };

  /** The four damage types, in the order every EVE UI lists them. */
  const DAMAGE_TYPES = [
    { key: "em", label: "EM", cls: "dmg-em" },
    { key: "thermal", label: "Therm", cls: "dmg-therm" },
    { key: "kinetic", label: "Kin", cls: "dmg-kin" },
    { key: "explosive", label: "Exp", cls: "dmg-exp" },
  ] as const;

  const stats = $derived.by(() => $fitting.stats);

  /** The resistance grid: one row per layer, four damage types across. */
  const defenceRows = $derived.by(() =>
    LAYERS.map((layer) => ({
      layer,
      label: layerLabels[layer],
      tank: stats.tank[layer],
    })),
  );

  const damageProfileText = $derived.by(() => {
    const profile = stats.damageProfile;
    const parts = [profile.em, profile.thermal, profile.kinetic, profile.explosive].map((share) =>
      Math.round(share * 100),
    );
    return parts.join("/");
  });

  /** Grade a resistance by strength, so a strong tank reads green at a glance —
   * always alongside the number, so colour is reinforcement, never the signal. */
  function resistClass(stat: Stat): string {
    if (!stat.known) {
      return "";
    }
    if (stat.value >= 0.55) return "resist-hi";
    if (stat.value >= 0.35) return "resist-med";
    if (stat.value >= 0.15) return "resist-lo";
    return "resist-none";
  }

  // --- the bottom read-outs -------------------------------------------------

  /** The cargo hold's used / total, from the inventory slice's own capacity read. */
  const cargoBayText = $derived.by<string>(() => {
    const cap = $inventory.cargo.capacity;
    if (cap) {
      return `${toFixed(cap.used, 1)} / ${toFixed(cap.capacity, 1)} m³`;
    }
    // No capacity read yet — fall back to the hull's total from ShipGetInfo,
    // with the used side honestly unknown rather than a fabricated 0.
    return stats.bays.cargoCapacity.known
      ? `— / ${asVolume(stats.bays.cargoCapacity.value)}`
      : "Unavailable";
  });

  /**
   * A fit's total ISK value needs a market price for the hull and every fitted
   * module — prices this window does not read. Stated as unavailable rather than
   * guessed, exactly like every other unsourced number here.
   */
  const fitValue = unavailable(
    "a fit's total value needs a market price for the hull and every module, which this window does not read",
  );

  // --- R21 slice B — a clicked module's EFFECTIVE stats ---------------------
  //
  // The server's post-dogma attributes for one fitted module: its skills, hull
  // bonuses and in-space effects are ALREADY baked in before we see them (see
  // bridge/boundDogma.ts / moduleAttributes.ts). We only label and format; the
  // numbers are the server's. An itemID can exceed 2^53 on the wire, so the
  // lookup compares string forms rather than trusting `===` on two numbers.

  function moduleStatsFor(itemID: number): readonly ModuleStat[] {
    const snapshot = $dogma.allInfo;
    if (!snapshot) {
      return [];
    }
    const key = String(itemID);
    const item = snapshot.ships.find((entry) => String(entry.itemID) === key);
    return moduleEffectiveStats(item?.attributes);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        error = "The live session ended (idle timeout or another client took over).";
      } else {
        error =
          panelErrorWords(cause);
      }
    } finally {
      busy = false;
    }
  }

  async function refresh(): Promise<void> {
    // The hangar / cargo rows feed the "what can I fit" list, so the fitting
    // panel refreshes both reads together. loadFitting also pulls the dogma
    // snapshot for the module stats on the same beat.
    await flow.loadInventory();
    await flow.loadFitting();
  }

  // --- R78: dragging a module onto a socket ---------------------------------
  //
  // ⚠ AN ACCELERATOR, NOT A REPLACEMENT. Pick-then-Fit still works exactly as it
  // did: every button below is untouched, and a player who cannot drag loses
  // nothing. Dragging is simply what someone arriving from the retail client
  // reaches for first.

  /** The socket the pointer is over, so it can light up while dragging. */
  let dropSlot = $state<string | null>(null);
  /** Why the last attempted drop was refused, in the panel's own error line. */
  function slotKey(slot: FittingSlot): string {
    return `${slot.family}:${slot.index}`;
  }

  function startItemDrag(event: DragEvent, itemID: number, typeID: number, source: "hangar" | "cargo"): void {
    const payload: DragPayload = {
      kind: "inventoryItem",
      itemID,
      typeID,
      from: source === "hangar" ? { kind: "hangar" } : { kind: "cargo" },
    };
    event.dataTransfer?.setData(DRAG_MIME, encodeDrag(payload));
    // A plain-text copy so dragging into a text field or another app produces
    // something legible rather than nothing.
    event.dataTransfer?.setData("text/plain", moduleName(typeID));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function overSocket(event: DragEvent, slot: FittingSlot): void {
    if (!carriesOurPayload(event.dataTransfer?.types as string[] | undefined)) {
      return;
    }
    // preventDefault is what MAKES an element a drop target; without it the
    // browser refuses the drop and shows the "no entry" cursor.
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    dropSlot = slotKey(slot);
  }

  function dropOnSocket(event: DragEvent, slot: FittingSlot): void {
    dropSlot = null;
    const payload = decodeDrag(event.dataTransfer?.getData(DRAG_MIME) ?? null);
    const verdict = dropOnSocketVerdict(payload);
    event.preventDefault();
    if (verdict !== null) {
      // Refused, and SAID — the panel's existing error line, so a rejected drop
      // reads the same way a rejected click does.
      error = verdict;
      return;
    }
    // Narrowed by the verdict above: only an inventory item can reach here.
    const item = payload as Extract<DragPayload, { kind: "inventoryItem" }>;
    // ⚠ IT GOES THROUGH `fitInto`, NOT ITS OWN `flow.fitModule` CALL. A drop is
    // the same act as picking an item and pressing Fit, so it makes the drop the
    // current pick and then runs the existing handler. Writing the call again
    // here would be a second path to the same server call — which is precisely
    // what `fittingWindow.test.ts` counts call sites to prevent, and it caught
    // this on the first run.
    pickedItemID = item.itemID;
    pickedSource = item.from.kind === "cargo" ? "cargo" : "hangar";
    fitInto(slot);
  }

  function fitInto(slot: FittingSlot): void {
    const itemID = pickedItemID;
    if (itemID === null) {
      return;
    }
    const source = pickedSource;
    void run(async () => {
      await flow.fitModule(itemID, source, { family: slot.family, index: slot.index });
      pickedItemID = null;
      await flow.loadInventory();
    });
  }

  function fitAnywhere(): void {
    const itemID = pickedItemID;
    if (itemID === null) {
      return;
    }
    const source = pickedSource;
    void run(async () => {
      await flow.fitModule(itemID, source, "auto");
      pickedItemID = null;
      await flow.loadInventory();
    });
  }

  function pick(itemID: number, source: "hangar" | "cargo"): void {
    pickedItemID = pickedItemID === itemID ? null : itemID;
    pickedSource = source;
  }

  function unfit(itemID: number): void {
    void run(async () => {
      await flow.unfitModule(itemID);
      selected = null;
      await flow.loadInventory();
    });
  }

  function toggleOnline(itemID: number, online: boolean): void {
    void run(() => flow.setModuleOnline(itemID, online));
  }

  function destroyRig(itemID: number): void {
    confirmingRigID = null;
    void run(async () => {
      await flow.destroyRig(itemID);
      selected = null;
      await flow.loadInventory();
    });
  }

  onMount(() => {
    // The remembered choice wins; with none, the viewport decides. This is the
    // R8 contract — list on a phone, radial above the breakpoint — but the
    // player can always override it, in either direction.
    let remembered: string | null = null;
    try {
      remembered = globalThis.localStorage?.getItem(VIEW_STORAGE_KEY) ?? null;
    } catch {
      remembered = null;
    }
    if (remembered === "radial" || remembered === "list") {
      view = remembered;
    } else if (globalThis.matchMedia?.("(max-width: 640px)").matches) {
      view = "list";
    }
    void run(refresh);
  });
</script>

<!-- ============================ shared snippets ========================== -->

{#snippet statValue(stat: Stat, format: (value: number) => string)}
  {#if stat.known}
    {format(stat.value)}
  {:else}
    <span class="stat-unavailable" title={stat.why}>Unavailable</span>
  {/if}
{/snippet}

{#snippet statRow(label: string, stat: Stat, format: (value: number) => string)}
  <tr>
    <th scope="row">{label}</th>
    <td class="num">{@render statValue(stat, format)}</td>
  </tr>
{/snippet}

<!-- A fitted module's EFFECTIVE stats — with the pilot's skills and this hull,
     straight from the server. Reused by the ring detail and the list view. -->
{#snippet moduleStatsBlock(itemID: number)}
  {@const rows = moduleStatsFor(itemID)}
  <div class="module-stats">
    <p class="module-stats-title">Stats — with your skills and this hull</p>
    {#if rows.length > 0}
      <table class="guests module-stats-table">
        <tbody>
          {#each rows as row (row.id)}
            <tr>
              <th scope="row">{row.label}</th>
              <td class="num">{row.value}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if !$dogma.loaded}
      <p class="note">Reading this module's effective stats…</p>
    {:else if $dogma.error}
      <p class="note">
        This module's effective stats could not be read: {$dogma.error}
      </p>
    {:else}
      <p class="note">This module reports no detailed stats.</p>
    {/if}
  </div>
{/snippet}

<!-- The right-hand statistics panel — EVE's collapsible sections, each a
     ▸/▾ header carrying its headline value. Everything is derived from the SAME
     ShipGetInfo attribute map the resource bars read; anything module-summed
     (offense, repairs, drone dps, cap stability) has no allowed read yet and
     says "Unavailable" rather than guessing. -->
{#snippet statsPanel()}
  <div class="fit-stats">
    <details class="fit-sec" open>
      <summary class="fit-sec-head">
        <span class="fit-sec-name">Capacitor</span>
        {#if stats.capacitor.simulator}
          <span
            class="fit-sec-headline"
            title={capacitorWord(stats.capacitor.simulator.loadBalance > 0
              ? "UI/Fitting/FittingWindow/ModulesSustainable"
              : "UI/Fitting/FittingWindow/ModulesNotSustainable")}
          >{capacitorHeadline(stats.capacitor.simulator)}</span>
        {:else}
          <span class="fit-sec-headline">
            {@render statValue(stats.capacitor.stability, (v) => (v > 0 ? "Stable" : "Unstable"))}
          </span>
        {/if}
      </summary>
      <div class="fit-sec-body">
        <table class="guests">
          <tbody>
            {@render statRow("Capacity", stats.capacitor.capacity, (v) => `${whole(v)} GJ`)}
            {@render statRow("Recharge time", stats.capacitor.rechargeSeconds, asSeconds)}
            {#if !stats.capacitor.simulator}
              {@render statRow("Net change per second", stats.capacitor.deltaPerSecond, whole)}
              {@render statRow("Lasts for", stats.capacitor.lastsForSeconds, asSeconds)}
            {/if}
          </tbody>
        </table>
        {#if stats.capacitor.simulator}
          <p class="fit-cap-delta" title={capacitorWord("UI/Fitting/FittingWindow/ExcessCapacitor")}>
            {capacitorWord("UI/Fitting/FittingWindow/CapacitorDelta", {
              delta: stats.capacitor.simulator.delta,
              percentage: stats.capacitor.simulator.deltaPercentage,
            })}
          </p>
          <p class="note fit-cap-balance">{capacitorBalance(stats.capacitor.simulator)}</p>
        {:else}
          <p class="note">
            Whether a fit runs its capacitor dry needs each module's drain, which
            this window cannot read yet — so it is left unsaid, not guessed.
          </p>
        {/if}
      </div>
    </details>

    <details class="fit-sec" open>
      <summary class="fit-sec-head">
        <span class="fit-sec-name">Offense</span>
        <span class="fit-sec-headline">{@render statValue(stats.firepower.dps, (v) => `${whole(v)} dps`)}</span>
      </summary>
      <div class="fit-sec-body">
        <table class="guests">
          <tbody>
            {@render statRow("Damage per second", stats.firepower.dps, whole)}
            {@render statRow("Drone damage per second", stats.firepower.droneDps, whole)}
            {@render statRow("Volley damage", stats.firepower.volley, whole)}
            {@render statRow("Mining yield", stats.mining.cubicMetresPerSecond, asVolume)}
          </tbody>
        </table>
        <p class="note">
          Damage summed across your guns, drones or miners needs each module's
          own stats — click a weapon below to read its effective figures.
        </p>
      </div>
    </details>

    <details class="fit-sec" open>
      <summary class="fit-sec-head">
        <span class="fit-sec-name">Defense</span>
        <span class="fit-sec-headline">{@render statValue(stats.totalEhp, (v) => `${whole(v)} ehp`)}</span>
      </summary>
      <div class="fit-sec-body">
        <p class="note">
          Effective hit points are worked out against an even {damageProfileText}
          spread of the four damage types.
        </p>
        <div class="table-wrap overflow-x-auto">
          <table class="guests defence-grid">
            <thead>
              <tr>
                <th>Layer</th>
                <th class="num">HP</th>
                {#each DAMAGE_TYPES as dt (dt.key)}
                  <th class="num"><span class="dmg-chip {dt.cls}">{dt.label}</span></th>
                {/each}
                <th class="num">EHP</th>
              </tr>
            </thead>
            <tbody>
              {#each defenceRows as row (row.layer)}
                <tr>
                  <td data-label="Layer">
                    <span class="layer-{row.layer}">{row.label}</span>
                    {#if row.layer === "shield" && stats.shieldRechargeSeconds.known}
                      <span class="fit-subnote">↻ {asDuration(stats.shieldRechargeSeconds.value)}</span>
                    {/if}
                  </td>
                  <td class="num" data-label="HP">{@render statValue(row.tank.hp, whole)}</td>
                  <td class="num {resistClass(row.tank.resistances.em)}" data-label="EM">
                    {@render statValue(row.tank.resistances.em, asPercent)}
                  </td>
                  <td class="num {resistClass(row.tank.resistances.thermal)}" data-label="Thermal">
                    {@render statValue(row.tank.resistances.thermal, asPercent)}
                  </td>
                  <td class="num {resistClass(row.tank.resistances.kinetic)}" data-label="Kinetic">
                    {@render statValue(row.tank.resistances.kinetic, asPercent)}
                  </td>
                  <td class="num {resistClass(row.tank.resistances.explosive)}" data-label="Explosive">
                    {@render statValue(row.tank.resistances.explosive, asPercent)}
                  </td>
                  <td class="num" data-label="EHP">{@render statValue(row.tank.ehp, whole)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <table class="guests">
          <tbody>
            {@render statRow("Shield repaired per second", stats.repairs.shield, whole)}
            {@render statRow("Armor repaired per second", stats.repairs.armor, whole)}
            {@render statRow("Structure repaired per second", stats.repairs.hull, whole)}
          </tbody>
        </table>
        <p class="note">
          Active repair rates need each repairer's own numbers — click one below
          to read its effective boost or repair amount.
        </p>
      </div>
    </details>

    <details class="fit-sec" open>
      <summary class="fit-sec-head">
        <span class="fit-sec-name">Targeting</span>
        <span class="fit-sec-headline">{@render statValue(stats.targeting.maxTargetRange, asDistance)}</span>
      </summary>
      <div class="fit-sec-body">
        <table class="guests">
          <tbody>
            {@render statRow("Targeting range", stats.targeting.maxTargetRange, asDistance)}
            {@render statRow("Targets at once", stats.targeting.maxLockedTargets, whole)}
            {@render statRow("Scan resolution", stats.targeting.scanResolution, (v) => `${toFixed(v, 1)} mm`)}
            {@render statRow(
              stats.targeting.sensorName
                ? `${stats.targeting.sensorName} sensor strength`
                : "Sensor strength",
              stats.targeting.sensorStrength,
              (v) => toFixed(v, 1),
            )}
          </tbody>
        </table>
      </div>
    </details>

    <details class="fit-sec" open>
      <summary class="fit-sec-head">
        <span class="fit-sec-name">Navigation</span>
        <span class="fit-sec-headline">{@render statValue(stats.navigation.maxVelocity, (v) => `${toFixed(v, 1)} m/s`)}</span>
      </summary>
      <div class="fit-sec-body">
        <table class="guests">
          <tbody>
            {@render statRow("Top speed", stats.navigation.maxVelocity, (v) => `${toFixed(v, 1)} m/s`)}
            {@render statRow("Time to align", stats.navigation.alignTimeSeconds, asSeconds)}
            {@render statRow("Warp speed", stats.navigation.warpSpeedAuPerSecond, (v) => `${toFixed(v, 2)} AU/s`)}
            {@render statRow("Signature radius", stats.navigation.signatureRadius, (v) => `${whole(v)} m`)}
            {@render statRow("Mass", stats.navigation.mass, (v) => `${whole(v)} kg`)}
          </tbody>
        </table>
      </div>
    </details>

    <details class="fit-sec" open>
      <summary class="fit-sec-head">
        <span class="fit-sec-name">Drones</span>
        <span class="fit-sec-headline">{@render statValue(stats.firepower.droneDps, (v) => `${whole(v)} dps`)}</span>
      </summary>
      <div class="fit-sec-body">
        <table class="guests">
          <tbody>
            {@render statRow("Bandwidth", stats.bays.droneBandwidth, (v) => `${toFixed(v, 0)} Mbit/s`)}
            {@render statRow("Control range", stats.bays.droneControlRange, asDistance)}
            {@render statRow("Drone bay", stats.bays.droneCapacity, asVolume)}
          </tbody>
        </table>
        {#if showInventory}
          <p class="controls">
            <button type="button" class="minor" onclick={() => showInventory?.()}>
              Manage drones
            </button>
          </p>
        {/if}
        <p class="note">
          Drones are launched and flown from the Overview in space; the bay
          itself is on the Inventory &amp; Ship page.
        </p>
      </div>
    </details>
  </div>
{/snippet}

<!-- The bottom read-out strip: CPU + powergrid bars, calibration, the bays and
     the fit's value. Every number is the server's; the ones with no allowed
     read say "Unavailable". -->
{#snippet fitFooter()}
  <div class="fit-footer">
    <div class="fit-bars">
      <div class="hud-gauge cpu">
        <div class="hud-head">
          <span class="hud-label">CPU</span>
          <span class="hud-value">{resourceText($fitting.resources.cpu, "tf")}</span>
        </div>
        <div
          class="hud-track"
          role="meter"
          aria-label="CPU"
          aria-valuenow={percent($fitting.resources.cpu) ?? 0}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span class="hud-fill" style={`width: ${percent($fitting.resources.cpu) ?? 0}%`}></span>
        </div>
      </div>
      <div class="hud-gauge powergrid">
        <div class="hud-head">
          <span class="hud-label">Power grid</span>
          <span class="hud-value">{resourceText($fitting.resources.powergrid, "MW")}</span>
        </div>
        <div
          class="hud-track"
          role="meter"
          aria-label="Power grid"
          aria-valuenow={percent($fitting.resources.powergrid) ?? 0}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span class="hud-fill" style={`width: ${percent($fitting.resources.powergrid) ?? 0}%`}></span>
        </div>
      </div>
    </div>
    <dl class="fit-readouts">
      <div>
        <dt>Calibration</dt>
        <dd>{resourceText($fitting.resources.calibration, "")}</dd>
      </div>
      <div>
        <dt>Cargo hold</dt>
        <dd>{cargoBayText}</dd>
      </div>
      <div>
        <dt>Drone bay</dt>
        <dd>{@render statValue(stats.bays.droneCapacity, asVolume)}</dd>
      </div>
      <div class="fit-readout-value">
        <dt>Fit value</dt>
        <dd>{@render statValue(fitValue, whole)}</dd>
      </div>
    </dl>
  </div>
{/snippet}

<!-- ============================ the window ============================== -->

<section class="panel">
  <header class="panel-head">
    <h2 class="panel-title">Fitting</h2>
    <!-- ⚠ THE SHIP LEAVES THE TITLE RATHER THAN GOING WITH IT. It used to be a
         `<small>` inside the heading, and a host that already says FITTING
         clips the heading — which would have taken the name of the hull you are
         actually looking at with it. Which ship this is, is the one thing on
         this strip worth reading. -->
    <p class="stat-line">
      {activeShipName}{activeShipClass ? ` · ${activeShipClass}` : ""}
    </p>
    <p class="controls">
      <span class="fit-views">
        <button
          type="button"
          class={view === "radial" ? "active" : "minor"}
          aria-pressed={view === "radial"}
          onclick={() => chooseView("radial")}
        >
          Ship view
        </button>
        <button
          type="button"
          class={view === "list" ? "active" : "minor"}
          aria-pressed={view === "list"}
          onclick={() => chooseView("list")}
        >
          List view
        </button>
      </span>
      <button type="button" class="primary" disabled={busy} onclick={() => run(refresh)}>
        Refresh
      </button>
    </p>
  </header>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  <!-- (A refusal the client's own dialog said is not said again here: ClientDialogs.svelte.) -->
  {#if $fitting.actionError && !$fitting.actionErrorSaid}
    <p class="error">Last change failed: {$fitting.actionError}</p>
  {/if}
  {#if $fitting.resourcesError}
    <p class="error">The ship's readings could not be loaded: {$fitting.resourcesError}</p>
  {/if}
  {#if !$fitting.activeShipID}
    <p class="note">
      No active ship — board a ship on the Inventory &amp; Ship page to fit it.
    </p>
  {/if}
</section>

{#if $fitting.activeShipID}
  {#if $fitting.slotsError}
    <section>
      <p class="error">The ship's slots could not be loaded: {$fitting.slotsError}</p>
    </section>
  {/if}

  {#if view === "radial"}
    <!-- ===================== EVE's fitting stage ======================= -->
    <section class="panel fit-window">
      <div class="fit-stage">
        <!-- The slim left toolbar: Fitting (current) and Cargo. -->
        <nav class="fit-toolbar" aria-label="Fitting window views">
          <button type="button" class="fit-tool active" aria-pressed="true" title="Fitting"
            onclick={() => chooseView("radial")} aria-label="Fitting">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8 6.2 21l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.2-2.2 2.6-2.4z" />
            </svg>
          </button>
          <button type="button" class="fit-tool" title="Cargo — open the Inventory & Ship page"
            aria-label="Cargo"
            disabled={!showInventory}
            onclick={() => showInventory?.()}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 8l9-5 9 5v8l-9 5-9-5V8z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" />
            </svg>
          </button>
        </nav>

        <!-- The ring, its detail, and the bottom read-outs. -->
        <div class="fit-center">
          <div class="fit-topline">
            <TypeIcon typeID={activeShipTypeID} name={activeShipName} size="sm" />
            <span class="fit-ship-name">{activeShipName}</span>
            {#if activeShipClass}<span class="fit-ship-class">{activeShipClass}</span>{/if}
            <span class="fit-info" title={`${activeShipName}${activeShipClass ? ` · ${activeShipClass}` : ""}`}
              aria-label={`Ship: ${activeShipName}${activeShipClass ? `, ${activeShipClass}` : ""}`}>ⓘ</span>
          </div>

          <p class="note fit-hint">
            {#if pickedItemID}
              Choose an empty slot to fit {pickedName} there.
            {:else}
              Choose a slot to see what is in it and what you can do with it.
            {/if}
          </p>

          <div class="fit-ring-wrap overflow-x-auto">
            <div class="fit-ring">
              <div class="fit-ring-guide" aria-hidden="true"></div>
              <div class="fit-hull">
                <TypeIcon typeID={activeShipTypeID} name={activeShipName} size="lg" />
              </div>

              {#each sockets as socket (`${socket.slot.family}:${socket.slot.index}`)}
                {@const slot = socket.slot}
                <button
                  type="button"
                  class="fit-socket family-{slot.family}"
                  class:empty={slot.module === null}
                  class:offline={slot.module !== null &&
                    !slot.module.online &&
                    slot.family !== "rig" &&
                    slot.family !== "subsystem"}
                  class:armed={isSelected(slot)}
                  style={`left: ${socket.xPercent}%; top: ${socket.yPercent}%`}
                  title={socketDescription(slot)}
                  aria-label={socketDescription(slot)}
                  aria-pressed={isSelected(slot)}
                  disabled={busy}
                  onclick={() => clickSocket(slot)}
                  ondragover={(event) => overSocket(event, slot)}
                  ondragleave={() => (dropSlot = null)}
                  ondrop={(event) => dropOnSocket(event, slot)}
                  class:drop-target={dropSlot === slotKey(slot)}
                >
                  {#if slot.module}
                    {@const moduleLabel = moduleName(slot.module.typeID)}
                    <TypeIcon
                      typeID={slot.module.typeID}
                      name={moduleLabel}
                      size="socket"
                      fallbackText={abbreviate(moduleLabel)}
                    />
                  {:else}
                    <span class="fit-socket-text">{socketText(slot)}</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>

          <ul class="fit-legend">
            {#each legend as entry (entry.family)}
              <li>
                <span class="badge">{entry.label}: {entry.filled} of {entry.total} filled</span>
              </li>
            {/each}
          </ul>

          {#if selectedSlot}
            <div class="fit-detail">
              <div class="fit-detail-head">
                <span class="fit-detail-slot">{slotName(selectedSlot)}</span>
                <span class="fit-detail-name">
                  {selectedSlot.module ? moduleName(selectedSlot.module.typeID) : "Empty"}
                </span>
                {#if selectedSlot.module && selectedSlot.family !== "rig" && selectedSlot.family !== "subsystem"}
                  <span class="badge {selectedSlot.module.online ? 'good' : 'warn'}">
                    {selectedSlot.module.online ? "Online" : "Offline"}
                  </span>
                {/if}
              </div>
              <div class="row-actions">
                {#if !selectedSlot.module}
                  <button
                    type="button"
                    disabled={busy || pickedItemID === null}
                    onclick={() => fitInto(selectedSlot!)}
                  >
                    Fit here
                  </button>
                  {#if pickedItemID === null}
                    <span class="note">Pick a module below first.</span>
                  {/if}
                {:else if selectedSlot.family === "rig"}
                  {#if confirmingRigID === selectedSlot.module.itemID}
                    <button
                      type="button"
                      class="danger"
                      disabled={busy}
                      onclick={() => destroyRig(selectedSlot!.module!.itemID)}
                    >
                      Yes, destroy it
                    </button>
                    <button
                      type="button"
                      class="minor"
                      disabled={busy}
                      onclick={() => (confirmingRigID = null)}
                    >
                      Keep it
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="minor"
                      disabled={busy}
                      onclick={() => (confirmingRigID = selectedSlot!.module!.itemID)}
                    >
                      Destroy rig…
                    </button>
                  {/if}
                {:else if selectedSlot.family === "subsystem"}
                  <span class="note">Subsystems stay fitted.</span>
                {:else}
                  <button
                    type="button"
                    disabled={busy}
                    onclick={() =>
                      toggleOnline(selectedSlot!.module!.itemID, !selectedSlot!.module!.online)}
                  >
                    {selectedSlot.module.online ? "Take offline" : "Bring online"}
                  </button>
                  <button
                    type="button"
                    class="minor"
                    disabled={busy}
                    onclick={() => unfit(selectedSlot!.module!.itemID)}
                  >
                    Unfit
                  </button>
                {/if}
              </div>
              {#if selectedSlot.family === "rig" && confirmingRigID !== null}
                <p class="error">
                  Destroying a rig is permanent — it is not returned to your hangar.
                </p>
              {/if}
              {#if selectedSlot.module && selectedSlot.family !== "rig" && selectedSlot.family !== "subsystem"}
                <!--
                  AMMUNITION. Every charge in the chosen inventory is offered,
                  not a filtered "compatible" subset: which charges a module
                  accepts lives in dogma attributes the browser has no
                  allowlisted read for, so narrowing the list would mean hiding
                  ammunition that would have loaded. The SERVER refuses the wrong
                  ones, in its own words, and that refusal is what shows.
                -->
                <div class="fit-ammo">
                  <h4 class="fit-ammo-head">Ammunition</h4>
                  {#if selectedSlot.module.charge}
                    {@const loaded = selectedSlot.module.charge}
                    <p class="fit-ammo-loaded">
                      Loaded: <strong>{chargeCount(loaded.quantity)} {moduleName(loaded.typeID)}</strong>
                    </p>
                    <div class="row-actions">
                      <button
                        type="button"
                        class="minor"
                        disabled={busy}
                        onclick={() => unloadFrom(selectedSlot!.module!.itemID, "hangar")}
                      >Unload to hangar</button>
                      <button
                        type="button"
                        class="minor"
                        disabled={busy}
                        onclick={() => unloadFrom(selectedSlot!.module!.itemID, "cargo")}
                      >Unload to cargo</button>
                    </div>
                  {:else}
                    <p class="note">Nothing loaded.</p>
                  {/if}

                  {#if chargeRows.length === 0}
                    <p class="note">
                      No ammunition in your hangar or cargo to load.
                    </p>
                  {:else}
                    <ul class="fit-ammo-list">
                      {#each sortedChargeRows as entry (`${entry.source}:${entry.row.itemID}`)}
                        <li>
                          <button
                            type="button"
                            class="minor"
                            disabled={busy}
                            onclick={() =>
                              loadInto(selectedSlot!.module!.itemID, entry.row.itemID, entry.source)}
                          >
                            Load {moduleName(entry.row.typeID)}
                          </button>
                          <span class="muted">
                            {chargeCount(entry.row.quantity)} in {entry.source === "cargo" ? "cargo" : "the hangar"}
                            {#if chargeVerdict(entry.row) === false}
                              <!-- A HINT, not a block: the button stays live and
                                   the server has the last word. -->
                              — probably will not fit
                            {/if}
                          </span>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
              {#if selectedSlot.module}
                {@render moduleStatsBlock(selectedSlot.module.itemID)}
              {/if}
            </div>
          {/if}

          {@render fitFooter()}
        </div>

        <!-- The right-hand collapsible stats panel. -->
        {@render statsPanel()}
      </div>
    </section>
  {:else}
    <!-- ===================== list view (narrow widths) ================= -->
    {#each SLOT_FAMILY_ORDER as family (family)}
      {@const slots = slotsOfFamily($fitting.slots, family as SlotFamily)}
      {#if slots.length > 0}
        <section>
          <h2>{SLOT_FAMILY_LABELS[family as SlotFamily]}</h2>
          {#if family === "rig"}
            <p class="note">
              Rigs cannot be taken off a ship. Removing one destroys it for good.
            </p>
          {/if}
          <div class="table-wrap overflow-x-auto">
            <table class="guests reflow">
              <thead>
                <tr><th>Slot</th><th>Fitted</th><th>State</th><th>Action</th></tr>
              </thead>
              <tbody>
                {#each slots as slot (`${slot.family}:${slot.index}`)}
                  <tr>
                    <td data-label="Slot">{slotName(slot)}</td>
                    <td data-label="Fitted">
                      {#if slot.module}
                        {moduleName(slot.module.typeID)}
                        <details class="module-stats-disclose">
                          <summary>Effective stats</summary>
                          {@render moduleStatsBlock(slot.module.itemID)}
                        </details>
                      {:else}
                        Empty
                      {/if}
                    </td>
                    <td data-label="State">
                      {#if !slot.module}
                        <span class="note">—</span>
                      {:else if family === "rig" || family === "subsystem"}
                        <span class="note">Always on</span>
                      {:else}
                        {slot.module.online ? "Online" : "Offline"}
                      {/if}
                    </td>
                    <td data-label="Action">
                      <div class="row-actions">
                        {#if !slot.module}
                          <button
                            type="button"
                            disabled={busy || pickedItemID === null}
                            onclick={() => fitInto(slot)}
                          >
                            Fit here
                          </button>
                        {:else if family === "rig"}
                          {#if confirmingRigID === slot.module.itemID}
                            <button
                              type="button"
                              class="danger"
                              disabled={busy}
                              onclick={() => destroyRig(slot.module!.itemID)}
                            >
                              Yes, destroy it
                            </button>
                            <button
                              type="button"
                              class="minor"
                              disabled={busy}
                              onclick={() => (confirmingRigID = null)}
                            >
                              Keep it
                            </button>
                          {:else}
                            <button
                              type="button"
                              class="minor"
                              disabled={busy}
                              onclick={() => (confirmingRigID = slot.module!.itemID)}
                            >
                              Destroy rig…
                            </button>
                          {/if}
                        {:else if family === "subsystem"}
                          <span class="note">Subsystems stay fitted</span>
                        {:else}
                          <button
                            type="button"
                            disabled={busy}
                            onclick={() => toggleOnline(slot.module!.itemID, !slot.module!.online)}
                          >
                            {slot.module.online ? "Take offline" : "Bring online"}
                          </button>
                          <button
                            type="button"
                            class="minor"
                            disabled={busy}
                            onclick={() => unfit(slot.module!.itemID)}
                          >
                            Unfit
                          </button>
                        {/if}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if family === "rig" && confirmingRigID !== null && slots.some((s) => s.module?.itemID === confirmingRigID)}
            <p class="error">
              Destroying a rig is permanent — it is not returned to your hangar.
            </p>
          {/if}
        </section>
      {/if}
    {/each}

    <section class="panel">
      {@render fitFooter()}
    </section>
    <section class="panel">
      {@render statsPanel()}
    </section>
  {/if}

  <!-- ===================== saved fittings ============================= -->
  <section bind:this={browserSection}>
    {#if hullMenu !== null}
      {@const menuFor = hullMenu}
      <span class="hull-menu" role="menu" use:portal style:left={`${menuFor.x}px`} style:top={`${menuFor.y}px`}>
        <button type="button" role="menuitem" onclick={() => { const typeID = menuFor.typeID; hullMenu = null; showInfo({ kind: "type", typeID }); }}>{fitWord("UI/Commands/ShowInfo")}</button>
        {#if ($hullBrowser?.types.get(menuFor.typeID)?.marketGroupID ?? null) !== null}
          <button type="button" role="menuitem" onclick={() => { const typeID = menuFor.typeID; hullMenu = null; showMarketDetails(typeID); }}>{fitWord("UI/Inventory/ItemActions/ViewTypesMarketDetails")}</button>
        {/if}
        {#if $hullBrowser?.types.get(menuFor.typeID)?.published === true}
          <button type="button" role="menuitem" onclick={() => { const typeID = menuFor.typeID; hullMenu = null; findInContracts(typeID); }}>{fitWord("UI/Inventory/ItemActions/FindInContracts")}</button>
          <button type="button" role="menuitem" onclick={() => { const typeID = menuFor.typeID; hullMenu = null; findInPersonalAssets(assetSearchTextForType(fitWord("UI/Inventory/AssetSearch/KeywordTypeExact"), hullName(typeID))); }}>{fitWord("UI/Inventory/ItemActions/FindPersonalAssets")}</button>
        {/if}
        <button type="button" role="menuitem" onclick={() => { const typeID = menuFor.typeID; hullMenu = null; compareType(typeID); }}>{fitWord("UI/Compare/CompareButton")}</button>
      </span>
    {/if}
    {#if nodeMenu !== null}
      {@const menuFor = nodeMenu}
      <span class="hull-menu" role="menu" use:portal style:left={`${menuFor.x}px`} style:top={`${menuFor.y}px`}>
        <button type="button" role="menuitem" onclick={() => { const typeIDs = menuFor.typeIDs; nodeMenu = null; if (typeIDs !== null) compareTypes(typeIDs); }}>{fitWord("UI/Compare/CompareButton")}</button>
        <hr />
        <button type="button" role="menuitem" onclick={() => { const id = menuFor.id; nodeMenu = null; opened[id] = opened[id] !== true; }}>{fitWord(opened[menuFor.id] === true ? "UI/Common/Collapse" : "UI/Common/Expand")}</button>
      </span>
    {/if}
    <h2>{fitWord("UI/Fitting/FittingWindow/ShipAndFittings")}</h2>
    <p class="controls">
      <button type="button" disabled={busy} onclick={() => void flow.saveFitAs().catch(() => {})}>{fitWord("UI/Fitting/FittingWindow/SaveFitAs")}</button>
      <!-- hullAndHardwareTypeBrowser.AddExportImportMenu (680 to 694): Import from Clipboard and Export to Clipboard. -->
      <span class="import-export">
        <button type="button" class="minor" aria-haspopup="menu" aria-expanded={importExportOpen} title={fitWord("UI/Fitting/FittingWindow/ImportAndExport")}
          onclick={() => (importExportOpen = !importExportOpen)}>⇅</button>
        {#if importExportOpen}
          <span class="import-export-menu" role="menu">
            <button type="button" role="menuitem" title={fitWord("UI/Fitting/FittingWindow/FittingManagement/ImportFromClipboardHint")}
              onclick={() => { importExportOpen = false; void navigator.clipboard.readText().catch(() => null).then((text) => flow.importFittingFromClipboard(text)).catch(() => {}); }}>
              {fitWord("UI/Fitting/FittingWindow/FittingManagement/ImportFromClipboard")}
            </button>
            <button type="button" role="menuitem" title={fitWord("UI/Fitting/FittingWindow/FittingManagement/ExportToClipboardHint")}
              onclick={() => { importExportOpen = false; void flow.currentFitText().then((text) => (text === null ? undefined : navigator.clipboard.writeText(text))).catch(() => {}); }}>
              {fitWord("UI/Fitting/FittingWindow/FittingManagement/ExportToClipboard")}
            </button>
          </span>
        {/if}
      </span>
    </p>
    <p class="controls">
      <button type="button" class={showPersonalFittings ? "active" : "minor"} aria-pressed={showPersonalFittings}
        title={filterHint("UI/Fitting/FittingWindow/FilterPersonalFittings", ($savedFittings ?? []).filter((saved) => saved.source === "personal").length, 500)}
        onclick={() => { showPersonalFittings = !showPersonalFittings; keepHullSettings(); }}>👤</button>
      <button type="button" class={showCorpFittings ? "active" : "minor"} aria-pressed={showCorpFittings}
        title={filterHint("UI/Fitting/FittingWindow/FilterCorpFittings", ($savedFittings ?? []).filter((saved) => saved.source === "corporation").length, 600)}
        onclick={() => { showCorpFittings = !showCorpFittings; keepHullSettings(); }}>🏢</button>
      {#if allianceID !== null}
        <button type="button" class={allianceFilterSet ? "active" : "minor"} aria-pressed={allianceFilterSet}
          title={filterHint("UI/Fitting/FittingWindow/FilterAllianceFittings", ($savedFittings ?? []).filter((saved) => saved.source === "alliance").length, 600)}
          onclick={() => { allianceFilterSet = !allianceFilterSet; keepHullSettings(); }}>🛡</button>
      {/if}
      {#if $communityFittingsEnabled}
        <button type="button" class={communityFilterSet ? "active" : "minor"} aria-pressed={communityFilterSet}
          title={fitWord("UI/Fitting/FilterCommunityFittings")}
          onclick={() => { communityFilterSet = !communityFilterSet; keepHullSettings(); }}>🌐</button>
      {/if}
      <button type="button" class={onlyCurrentHull ? "active" : "minor"} aria-pressed={onlyCurrentHull}
        title={fitWord("UI/Fitting/FittingWindow/FilterCurrentHull")}
        onclick={() => { onlyCurrentHull = !onlyCurrentHull; keepHullSettings(); }}>⛴</button>
      <button type="button" class={onlyWithSkills ? "active" : "minor"} aria-pressed={onlyWithSkills}
        title={fitWord("UI/Fitting/FittingWindow/FilterSkillsForFitting")}
        onclick={() => { onlyWithSkills = !onlyWithSkills; keepHullSettings(); }}>📘</button>
      <input type="search" bind:value={hullFilterText} oninput={keepHullSettings} aria-label="Search fittings" />
    </p>
    <!-- A fitting's name as the client's label draws it (FittingEntry, Generic's label: its markup read as the
         client's text reads it, bridge/mailMarkup.ts mailBodyLines): bold, italic, underlined or a link as its tags say,
         on one line. -->
    {#snippet markedText(text: string)}
      {#each mailBodyLines(text) as line, place (place)}{#if place > 0}{" "}{/if}{#each line as segment, at (at)}<span class="marked-run" class:bold={segment.bold} class:italic={segment.italic} class:underline={segment.underline || segment.link !== null}>{segment.text}</span>{/each}{/each}
    {/snippet}
    {#snippet fittingRow(saved: NonNullable<typeof $savedFittings>[number])}
        <!-- Draggable (FittingEntry.GetDragData): the skill plan editor takes a fitting dropped on its skills. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <p class="controls saved-fitting" class:selected={selectedFittings.includes(saved.fittingID)} data-fitting-id={saved.fittingID}
          draggable="true" ondragstart={(event) => startFittingDrag(event, saved.fittingID)}>
          {#if saved.source === "corporation"}
            <span title={fitWord("UI/Fitting/CorpFittingHint")}>🏢</span>
          {:else if saved.source === "community"}
            <span title={fitWord("UI/Fitting/CommunityFittingHint")}>🌐</span>
          {:else if saved.source === "alliance"}
            <span title={fitWord("UI/Fitting/AllianceFittingHint")}>🛡</span>
          {/if}
          <button type="button" class="fitting-name" title={fittingTooltip(saved)} aria-pressed={selectedFittings.includes(saved.fittingID)}
            onclick={(event) => selectFitting(saved.fittingID, event)}>{@render markedText(saved.name)}</button>
          {#if selectedFittings.length > 1 && selectedFittings.includes(saved.fittingID)}
            <!-- GetFittingMenu with more than one selected (506 to 528): Delete Fitting alone, for those of them
                 GetDeletableNodes lets go, in the browser's order. -->
            {#if selectedDeletable.length > 0}
              <button type="button" class="minor" onclick={() => void flow.deleteFittings(shownFittingIDs().filter((id) => selectedDeletable.includes(id))).catch(() => {})}>
                {fitWord("UI/Fitting/FittingWindow/FittingManagement/DeleteFitting")}
              </button>
            {/if}
          {:else}
          <button type="button" class="minor" onclick={() => void flow.viewFitting(saved.fittingID).catch(() => {})}>
            {fitWord("UI/Fitting/FittingWindow/ViewFitting")}
          </button>
          <!-- GetFittingMenu (513 to 516): no Fit to Active Ship for a structure's fitting (categoryStructure); Open
               Multifit only where the config allows any (GetMaxShipsToFit) and the pilot is docked. -->
          {#if $hullBrowser?.types.get(saved.shipTypeID)?.categoryID !== CATEGORY_STRUCTURE}
            <button type="button" disabled={busy} onclick={() => void flow.fitFittingToActiveShip(saved.fittingID).catch(() => {})}>
              {fitWord("UI/Fitting/FittingWindow/FitFittingToActiveShip")}
            </button>
          {/if}
          <button type="button" class="minor" onclick={() => void flow.buyFit(saved.fittingID).catch(() => {})}>
            {fitWord("UI/Market/MarketQuote/BuyAll")}
          </button>
          {#if $maxShipsToFit > 0 && ($inventory.stationID ?? $inventory.structureID ?? null) !== null}
            <button type="button" class="minor" onclick={() => void flow.openMultiFit(saved.fittingID).catch(() => {})}>
              {fitWord("UI/Fitting/FittingWindow/FittingManagement/OpenMultifit")}
            </button>
          {/if}
          {#if deletable(saved.source)}
            <button type="button" class="minor" onclick={() => void flow.deleteFitting(saved.fittingID).catch(() => {})}>
              {fitWord("UI/Fitting/FittingWindow/FittingManagement/DeleteFitting")}
            </button>
          {/if}
          {/if}
        </p>
    {/snippet}
    {#snippet hullEntry(hull: NonNullable<typeof browserTree>["groups"][number]["races"][number]["hulls"][number])}
      {@const id = `h:${hull.typeID}`}
      {@const count = fittingNumByTypeID.get(hull.typeID)}
      <details class="browser-node" class:current-hull={hull.isCurrent} open={opened[id] === true} ontoggle={(event) => toggled(id, event)}>
        <summary title={hullTooltip(hull.typeID)} onpointerenter={() => void flow.requestShipTraits([hull.typeID]).catch(() => {})}
          oncontextmenu={(event) => openHullMenu(hull.typeID, event)}>
          <TypeIcon typeID={hull.typeID} name={hullName(hull.typeID)} size="sm" />
          <strong>{hullName(hull.typeID)}</strong>
          {#if count?.personal}<small class="note" title={fitWord("UI/Fitting/FittingWindow/SavedPersonalFittings")}>👤 {count.personal}</small>{/if}
          {#if count?.corporation}<small class="note" title={fitWord("UI/Fitting/FittingWindow/SavedCorpFittings")}>🏢 {count.corporation}</small>{/if}
          {#if count?.community && $communityFittingsEnabled}<small class="note" title={fitWord("UI/Fitting/FittingWindow/SavedCommunityFittings")}>🌐 {count.community}</small>{/if}
          <!-- HullTypeListGroup.Load (683 to 686) shows the alliance's count where the corporation has any fittings for
               the hull (allianceCont.display = bool(numCorp)), its number nought where the alliance has none. -->
          {#if count?.corporation}<small class="note" title={fitWord("UI/Fitting/FittingWindow/SavedAllianceFittings")}>🛡 {count.alliance}</small>{/if}
        </summary>
        {#if opened[id] === true}
          {#each hull.fittings as saved (saved.fittingID)}
            {@render fittingRow(saved)}
          {/each}
        {/if}
      </details>
    {/snippet}
    {#snippet groupEntry(group: NonNullable<typeof browserTree>["groups"][number], prefix: string)}
      {@const id = `${prefix}g:${group.groupID}`}
      <details class="browser-node" class:holds-current={group.hasCurrent} open={opened[id] === true} ontoggle={(event) => toggled(id, event)}>
        <summary oncontextmenu={(event) => openNodeMenu(group.compareTypeIDs, id, event)}>{hullGroupName(group.namedBy)}</summary>
        {#if opened[id] === true}
          {#each group.races as race (race.raceID)}
            {@const raceID = `${id}_${race.raceID}`}
            <details class="browser-node" class:holds-current={race.hasCurrent} open={opened[raceID] === true} ontoggle={(event) => toggled(raceID, event)}>
              <summary oncontextmenu={(event) => openNodeMenu(race.compareTypeIDs, raceID, event)}>{raceName(race.raceID)}</summary>
              {#if opened[raceID] === true}
                {#each race.hulls as hull (hull.typeID)}
                  {@render hullEntry(hull)}
                {/each}
              {/if}
            </details>
          {/each}
        {/if}
      </details>
    {/snippet}
    {#if $savedFittings === null || $hullBrowser === null}
      <p class="note">…</p>
    {:else if browserTree === null}
      <!-- The client's data is not had here: the fittings let through, by name, each with its hull. -->
      {#if shownFittings.length === 0}
        <p class="note">{fitWord("UI/Common/NothingFound")}</p>
      {:else}
        {#each shownFittings as saved (saved.fittingID)}
          <small class="note">{hullName(saved.shipTypeID)}</small>
          {@render fittingRow(saved)}
        {/each}
      {/if}
    {:else if browserTree.nothingFound}
      <p class="note">{fitWord("UI/Common/NothingFound")}</p>
    {:else}
      <div class="browser-tree">
        {#each browserTree.groups as group (group.groupID)}
          {@render groupEntry(group, "")}
        {/each}
        {#if browserTree.special.length > 0}
          <details class="browser-node" class:holds-current={browserTree.specialHasCurrent} open={opened.special === true} ontoggle={(event) => toggled("special", event)}>
            <summary oncontextmenu={(event) => openNodeMenu(null, "special", event)}>{fitWord("UI/Fitting/FittingWindow/SpecialEditionShips")}</summary>
            {#if opened.special === true}
              {#each browserTree.special as group (group.groupID)}
                {@render groupEntry(group, "special")}
              {/each}
            {/if}
          </details>
        {/if}
        {#if browserTree.unsupported.length > 0}
          <details class="browser-node" open={opened.unsupported === true} ontoggle={(event) => toggled("unsupported", event)}>
            <summary>{fitWord("UI/Fitting/FittingWindow/UnsupportedShip")}</summary>
            {#if opened.unsupported === true}
              {#each browserTree.unsupported as saved (saved.fittingID)}
                <p class="controls saved-fitting">
                  <span>{@render markedText(`${saved.name} (${$hullBrowser?.types.get(saved.shipTypeID) ? hullName(saved.shipTypeID) : fitWord("UI/Fitting/FittingWindow/UnknownShipType")}) - unsupported`)}</span>
                  {#if deletable(saved.source)}
                    <button type="button" class="minor" onclick={() => void flow.deleteFitting(saved.fittingID).catch(() => {})}>
                      {fitWord("UI/Fitting/FittingWindow/FittingManagement/DeleteFitting")}
                    </button>
                  {/if}
                </p>
              {/each}
            {/if}
          </details>
        {/if}
      </div>
    {/if}
  </section>

  <!-- ===================== modules you can fit ======================== -->
  <section>
    <h2>
      Modules you can fit
      {#if pickedName}
        <small class="note">holding {pickedName}</small>
      {/if}
    </h2>
    {#if pickedItemID !== null}
      <p class="controls">
        <button type="button" disabled={busy} onclick={fitAnywhere}>
          Fit {pickedName} in the first free slot
        </button>
        <button type="button" class="minor" disabled={busy} onclick={() => (pickedItemID = null)}>
          Put it back down
        </button>
      </p>
    {:else}
      <p class="note">Pick a module below, then choose an empty slot to put it in.</p>
    {/if}
    {#if fittable.length === 0}
      <p class="note">
        {$inventory.loaded
          ? "No modules in your hangar or cargo hold to fit."
          : "Loading your hangar…"}
      </p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr><th>Module</th><th>Where it is</th><th>Action</th></tr>
          </thead>
          <tbody>
            {#each fittable as entry (entry.row.itemID)}
              <!-- Draggable onto a socket. The Fit button in the last cell is
                   unchanged and remains the keyboard path. -->
              <tr
                class={entry.row.itemID === pickedItemID ? "self" : ""}
                draggable="true"
                ondragstart={(event) =>
                  startItemDrag(event, entry.row.itemID, entry.row.typeID, entry.source)}
              >
                <td data-label="Module">{moduleName(entry.row.typeID)}</td>
                <td data-label="Where it is">
                  {entry.source === "hangar" ? HANGAR_NAME : "Cargo hold"}
                </td>
                <td data-label="Action">
                  <button
                    type="button"
                    disabled={busy}
                    onclick={() => pick(entry.row.itemID, entry.source)}
                  >
                    {entry.row.itemID === pickedItemID ? "Put down" : "Pick up"}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}
