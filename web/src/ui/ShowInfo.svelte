<script lang="ts">
  // THE SHOW INFO WINDOW (goal R76) — what this thing is, from everything the
  // client already knows about it.
  //
  // ⚠ IT NEVER INVENTS A SECTION. Each block below is drawn only when its source
  // actually answered: a rock that has left the grid loses its distance rather
  // than keeping a stale one, a module we have no dogma read for shows no
  // attribute table rather than an empty one, and a type the name cache has not
  // resolved says so instead of printing an id (R7d).
  //
  // That discipline is why the window is worth having. EVE's Show Info is
  // trusted precisely because every figure in it is real; one fabricated zero
  // would make a player check every other number by hand.
  import { onMount } from "svelte";
  import TypeIcon from "./TypeIcon.svelte";
  import { showInfo, showInfoTarget, subjectTypeID, type InfoSubject } from "./showInfo.ts";
  import { LINK_WORDS, linkFollowerOf, startLinkDrag } from "./linkFollowers.ts";
  import { formatIsk } from "./isk.ts";
  import { DATE_LABELS, formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { mailBodyLines } from "../bridge/mailMarkup.ts";
  import {
    OWNER_INFO_WORDS,
    friendlyFireAt,
    friendlyFireLabel,
    isCharacterOwner,
    isNpcCorporation,
    warPermitLabel,
    type CorporationShowInfo,
  } from "../bridge/ownerInfo.ts";
  import type { AllianceInfoExtra } from "../bridge/allianceInfo.ts";
  import type { JsonValue } from "../bridge/wire.ts";
  import { moduleEffectiveStats } from "../bridge/moduleAttributes.ts";
  import { securityStatusColor, shownSecurity } from "../bridge/systemSecurity.ts";
  import type { MapLocationInfo, MapPlaceRow } from "../app/api.ts";
  import { fmtDist, hostileLabel, isHostile, ratioPercent, surfaceDistanceMeters } from "../space/overview.ts";
  import { distanceSay } from "../space/distanceWords.ts";
  import { spaceSelection } from "../space/selection.ts";
  import { resolvedName, type NameRef } from "../store/names.ts";
  import { abbreviate } from "./fittingIcons.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { SpaceEntity } from "../store/types.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const standings = store.standings;
  const subject = showInfoTarget.subject;

  const typeID = $derived(subjectTypeID($subject));

  /** The live snapshot row for a space subject, or null once it has left grid. */
  const entity = $derived.by<SpaceEntity | null>(() => {
    const current = $subject;
    if (current === null || current.kind !== "spaceObject") {
      return null;
    }
    return (
      ($space.snapshot?.entities ?? []).find((row) => row.itemID === current.itemID) ?? null
    );
  });

  /** The fitted module for a module subject, from the same fit the window shows. */
  const fittedModule = $derived.by(() => {
    const current = $subject;
    if (current === null || current.kind !== "module") {
      return null;
    }
    for (const slot of $fitting.slots) {
      if (slot.module && slot.module.itemID === current.itemID) {
        return slot.module;
      }
    }
    return null;
  });

  /**
   * The SERVER's post-dogma attributes for that module — skills, hull bonuses
   * and in-space effects already applied. This is the only place in the client
   * where a module's real numbers exist; the static SDE values would be a
   * different (and wrong) claim.
   */
  const moduleStats = $derived.by(() => {
    const current = $subject;
    if (current === null || current.kind !== "module") {
      return [];
    }
    const entry = $fitting.dogma?.items?.find((item) => item.itemID === current.itemID);
    return moduleEffectiveStats(entry?.attributes);
  });

  /**
   * The kind a character's name is kept under: an agent's (the NPC characters' numbers, 3000000 to 3999999) as an
   * agent's, as the People & Places window asks for it, and a pilot's as a character's.
   */
  const characterNameKind = (characterID: number): "agent" | "character" =>
    (characterID >= 3_000_000 && characterID < 4_000_000 ? "agent" : "character");

  const title = $derived.by(() => {
    const current = $subject;
    if (current === null) {
      return "Show Info";
    }
    if (current.kind === "character") {
      // Its own kind's name, else the owner table's (cfg.eveowners: an NPC character that is no agent, a CEO).
      const own = resolvedName($names.resolved, characterNameKind(current.characterID), current.characterID, "");
      return own !== "" ? own : resolvedName($names.resolved, "owner", current.characterID, "Unknown pilot");
    }
    // A map place's own name (cfg.evelocations), its type's while it is not read.
    if (current.kind === "mapLocation") {
      return mapLocationRead?.name || mapTypeName(current.typeID);
    }
    // update_description_caption_and_sub_caption: the owner's name, "[Closed]" before it where it is no more.
    if (current.kind === "corporation" || current.kind === "alliance") {
      const name = current.kind === "corporation"
        ? resolvedName($names.resolved, "corporation", current.corporationID, "Unknown corporation")
        : resolvedName($names.resolved, "alliance", current.allianceID, "Unknown alliance");
      const deleted = current.kind === "corporation" ? corporationRead?.info.deleted === true : allianceRead?.deleted === true;
      return deleted ? word("UI/InfoWindow/ClosedCorpOrAllianceCaption", { corpOrAllianceName: name }) : name;
    }
    // A space object's own name beats its type name — "Asteroid Belt 1" is more
    // use than "Asteroid Belt".
    const own = entity?.name;
    if (typeof own === "string" && own.length > 0) {
      return own;
    }
    return resolvedName($names.resolved, "type", typeID, "Unknown object");
  });

  const groupName = $derived(
    entity?.groupID != null
      ? resolvedName($names.resolved, "typeGroup", entity.groupID, "")
      : "",
  );
  const categoryName = $derived(
    entity?.categoryID != null
      ? resolvedName($names.resolved, "typeCategory", entity.categoryID, "")
      : "",
  );
  /** The type's own name, shown under a space object that has its own name. */
  const typeName = $derived(resolvedName($names.resolved, "type", typeID, ""));

  const shipPosition = $derived($space.snapshot?.ship?.position ?? null);
  // Hull to hull, as the client's selected item gives it, and worded as it words it (FmtDist, one decimal).
  const distance = $derived(
    entity && shipPosition
      ? surfaceDistanceMeters(shipPosition, $space.snapshot?.ship?.radius ?? 0, entity.position, entity.radius)
      : null,
  );
  // svelte-ignore state_referenced_locally
  const words = store.words;
  const say = $derived(distanceSay($words.templates));
  const speed = $derived.by(() => {
    if (!entity) {
      return null;
    }
    const { x, y, z } = entity.velocity;
    const value = Math.sqrt(x * x + y * y + z * z);
    return Number.isFinite(value) ? value : null;
  });

  const condition = $derived(
    entity
      ? [
          { label: "Shield", pct: ratioPercent(entity.shieldRatio) },
          { label: "Armor", pct: ratioPercent(entity.armorRatio) },
          { label: "Hull", pct: ratioPercent(entity.hullRatio) },
        ].filter((row) => row.pct !== null)
      : [],
  );

  /** The standing we hold toward a pilot, when the standings slice has one. */
  const standing = $derived.by(() => {
    const current = $subject;
    if (current === null || current.kind !== "character") {
      return null;
    }
    return ($standings.char ?? []).find((row) => row.fromID === current.characterID) ?? null;
  });

  // ---- A corporation and an alliance (bridge/ownerInfo.ts) ---------------------------------------------------------
  //
  // What the client's window reads of the owner, read again each time the subject changes (reconstruct_info_window
  // reads it on every opening). Nothing is shown of a record not had.

  let corporationRead = $state<CorporationShowInfo | null>(null);
  /** A map place's read (infosvc.UpdateDataCelestial for a region, a constellation or a solar system). */
  let mapLocationRead = $state<MapLocationInfo | null>(null);
  let allianceRead = $state<AllianceInfoExtra | null>(null);
  /** Whether the owner's read has answered, so a record not had is said rather than waited for. */
  let ownerReadDone = $state(false);
  /** The latest read asked; an older one's answer is dropped. Not reactive. */
  let ownerReads = 0;

  $effect(() => {
    const current = $subject;
    const ticket = ++ownerReads;
    corporationRead = null;
    allianceRead = null;
    mapLocationRead = null;
    ownerReadDone = false;
    if (current?.kind === "corporation") {
      void flow.corporationShowInfo(current.corporationID).then((read) => {
        if (ticket !== ownerReads) return;
        corporationRead = read;
        ownerReadDone = true;
      });
    } else if (current?.kind === "alliance") {
      void flow.allianceShowInfo(current.allianceID).then((read) => {
        if (ticket !== ownerReads) return;
        allianceRead = read;
        ownerReadDone = true;
      });
    } else if (current?.kind === "mapLocation") {
      void flow.mapLocationShowInfo(current.itemID).then((read) => {
        if (ticket !== ownerReads) return;
        mapLocationRead = read;
        ownerReadDone = true;
      });
    }
  });

  onMount(() => {
    flow.requestWords([...Object.keys(OWNER_INFO_WORDS), DATE_LABELS.ls!, DATE_LABELS.ns!, DATE_LABELS.xn!, ...Object.keys(LINK_WORDS), ...Object.keys(MAP_INFO_WORDS)]);
    // The map places' type names (evetypes.GetName of typeRegion, typeConstellation, typeSolarSystem).
    flow.requestNames([3, 4, 5].map((id) => ({ kind: "type" as const, id })));
  });

  /** The map places' labels the window uses, with the page's own words where the install's are not had. */
  const MAP_INFO_WORDS: Readonly<Record<string, string>> = {
    "UI/InfoWindow/AdjacentConstellations": "Constellations next to it",
    "UI/InfoWindow/AdjacentRegions": "Regions next to it",
    "UI/InfoWindow/AdjacentSolarSystem": "Systems next to it",
    "UI/InfoWindow/RelatedConstellation": "Its constellations",
    "UI/InfoWindow/RelatedSolarSystem": "Its systems",
    "UI/Neocom/SecurityLevel": "Security",
  };
  /** infosvc's neighborGrouping and childGrouping: the two lists' names, by the place's type. */
  const NEIGHBOUR_LABELS: Readonly<Record<number, string>> = {
    3: "UI/InfoWindow/AdjacentRegions",
    4: "UI/InfoWindow/AdjacentConstellations",
    5: "UI/InfoWindow/AdjacentSolarSystem",
  };
  const CHILD_LABELS: Readonly<Record<number, string>> = {
    3: "UI/InfoWindow/RelatedConstellation",
    4: "UI/InfoWindow/RelatedSolarSystem",
  };
  const MAP_TYPE_NAMES: Readonly<Record<number, string>> = { 3: "Region", 4: "Constellation", 5: "Solar system" };
  /** A map place's type name (evetypes.GetName), the page's own while it is not read. */
  const mapTypeName = (typeID: number): string => resolvedName($names.resolved, "type", typeID, MAP_TYPE_NAMES[typeID] ?? "");
  // localization.util.Sort on the names (SortListOfTuples): the collator on the names in lower case, then as they are
  // the other way about.
  const placeCollator = new Intl.Collator("en");
  const byPlaceName = (a: MapPlaceRow, b: MapPlaceRow): number =>
    placeCollator.compare(a.name.toLowerCase(), b.name.toLowerCase()) || placeCollator.compare(b.name, a.name);
  const placeSubject = (place: MapPlaceRow): InfoSubject => ({ kind: "mapLocation", typeID: place.typeID, itemID: place.itemID });

  /** The client's words for a label, filled; the page's own (OWNER_INFO_WORDS) where the install's are not had. */
  function word(label: string, args: Readonly<Record<string, JsonValue>> = {}): string {
    const template = $words.templates[label];
    return formatTemplate(typeof template === "string" ? template : OWNER_INFO_WORDS[label] ?? LINK_WORDS[label] ?? MAP_INFO_WORDS[label] ?? "", args, { nameOf: () => "" });
  }

  /** FmtDate(ticks, fmt): the moment as its format's label words it (carbon format.py 71 to 114). */
  function fmtDate(ticks: bigint, fmt: "ls" | "ns" | "xn"): string {
    return word(DATE_LABELS[fmt] ?? "", { datetime: { type: "long", value: ticks.toString() } });
  }

  /** A link in the owner's words (its description, its URL), followed as the client's link registry follows it. */
  function followerOf(url: string, text: string) {
    return linkFollowerOf(url, flow, null, (label) => word(label), text);
  }

  /** One of the Attributes tab's rows: its words, and an owner it opens (LabelTextSidesAttributes' typeID and itemID). */
  interface OwnerRow {
    readonly key: string;
    readonly label: string;
    /** Plain words, or the client's markup (bold, a link) where it is "markup". */
    readonly text: string;
    readonly markup?: boolean;
    readonly opens?: InfoSubject;
    /** LabelTextSidesMoreInfo's hint. */
    readonly hint?: string;
  }

  // A character named as the window names it: cfg.eveowners (the page's "owner" kind), an NPC CEO as a pilot.
  const characterName = (id: number): string => resolvedName($names.resolved, "owner", id, "Unknown pilot");
  const corporationName = (id: number): string => resolvedName($names.resolved, "corporation", id, "Unknown corporation");
  const allianceName = (id: number): string => resolvedName($names.resolved, "alliance", id, "Unknown alliance");
  const percentage = (rate: number): string => word("UI/Common/Percentage", { percentage: rate * 100 });

  /** infosvc.UpdateDataCorp: the Attributes tab of a corporation. */
  const corporationRows = $derived.by<readonly OwnerRow[]>(() => {
    const read = corporationRead;
    if (read === null) return [];
    const { info } = read;
    const npc = isNpcCorporation(info.corporationID);
    const rows: OwnerRow[] = [];
    let founderDone = false;
    if (info.ceoID !== null && isCharacterOwner(info.ceoID)) {
      founderDone = info.creatorID === info.ceoID;
      rows.push({
        key: "ceo",
        label: word(founderDone ? "UI/Corporations/CorpUIHome/CeoAndFounder" : "UI/Corporations/Common/CEO"),
        text: characterName(info.ceoID),
        opens: { kind: "character", characterID: info.ceoID },
      });
    }
    if (!founderDone && info.creatorID !== null && isCharacterOwner(info.creatorID)) {
      rows.push({ key: "founder", label: word("UI/Corporations/Common/Founder"), text: characterName(info.creatorID), opens: { kind: "character", characterID: info.creatorID } });
    }
    if (info.allianceID !== null && info.allianceID > 0) {
      rows.push({ key: "alliance", label: word("UI/Common/Alliance"), text: allianceName(info.allianceID), opens: { kind: "alliance", allianceID: info.allianceID } });
    }
    rows.push({ key: "ticker", label: word("UI/Corporations/CorpUIHome/TickerName"), text: info.tickerName });
    // An int is written grouped (FormatNumeric, useGrouping); anything else (Tranquility's shares, a string) as it is.
    const grouped = (value: number | string | null): string =>
      (typeof value === "number" && Number.isInteger(value) ? value.toLocaleString("en-US") : value === null ? "0.0" : String(value));
    rows.push({ key: "shares", label: word("UI/Corporations/CorpUIHome/Shares"), text: grouped(info.shares) });
    if (!npc) {
      rows.push({ key: "members", label: word("UI/Corporations/CorpUIHome/MemberCount"), text: grouped(info.memberCount) });
    }
    rows.push({
      key: "tax",
      label: word("UI/Corporations/CorpUIHome/ISKTaxRate"),
      text: percentage(info.taxRate),
      hint: word("UI/Corporations/BaseCorporationUI/ISKTaxRateDescription", { min_isk_amount: formatIsk("100000") }),
    });
    rows.push({
      key: "lpTax",
      label: word("UI/Corporations/CorpUIHome/LPTaxRate"),
      text: percentage(info.loyaltyPointTaxRate),
      hint: word("UI/Corporations/BaseCorporationUI/LPTaxRateDescription"),
    });
    if (read.aggression !== null) {
      const { legal, changeAt } = friendlyFireAt(read.aggression, read.readAt);
      const tomorrow = changeAt !== null && fmtDate(changeAt, "xn") !== fmtDate(read.readAt, "xn");
      rows.push({
        key: "friendlyFire",
        label: word("UI/Corporations/CorpUIHome/FriendlyFire"),
        text: word(friendlyFireLabel(legal, changeAt, tomorrow), changeAt === null ? {} : { time: fmtDate(changeAt, "ns") }),
        markup: true,
        hint: plainText(word("UI/Corporations/FriendlyFire/Description")),
      });
    }
    if (!npc) {
      if (read.enlistmentFactions !== null) {
        const factionNames = read.enlistmentFactions.map((id) => resolvedName($names.resolved, "faction", id, "Unknown faction")).sort();
        rows.push({
          key: "factions",
          label: word("UI/Corporations/CorpUIHome/PermittedFwFactions"),
          text: factionNames.length > 0 ? factionNames.join("\n") : word("UI/Corporations/CorpUIHome/NoFwFactionsPermitted"),
        });
      }
      rows.push({ key: "war", label: word("UI/WarPermit/WarPermitStatus"), text: word(warPermitLabel(info.allowWar)), hint: plainText(word("UI/WarPermit/WarPermitExplanation")) });
    }
    if (info.url !== "") {
      rows.push({
        key: "url",
        label: word("UI/Corporations/CorpUIHome/URL"),
        text: word("UI/Corporations/CorpUIHome/URLPlaceholder", { linkTag: `<url=${info.url}>`, url: info.url }),
        markup: true,
      });
    }
    return rows;
  });

  /** infosvc.UpdateDataAlliance: the Attributes tab of an alliance. */
  const allianceRows = $derived.by<readonly OwnerRow[]>(() => {
    const read = allianceRead;
    if (read === null) return [];
    const rows: OwnerRow[] = [];
    if (read.executorCorpID !== null) {
      rows.push({ key: "executor", label: word("UI/Corporations/CorporationWindow/Alliances/Home/Executor"), text: corporationName(read.executorCorpID), opens: { kind: "corporation", corporationID: read.executorCorpID } });
    }
    rows.push({ key: "shortName", label: word("UI/Corporations/CorporationWindow/Alliances/Home/ShortName"), text: read.shortName });
    if (read.creatorCorpID !== null) {
      rows.push({ key: "creatorCorp", label: word("UI/InfoWindow/CreatedByCorp"), text: corporationName(read.creatorCorpID), opens: { kind: "corporation", corporationID: read.creatorCorpID } });
    }
    if (read.creatorCharID !== null) {
      rows.push({ key: "creator", label: word("UI/Corporations/CorporationWindow/Alliances/Home/CreatedBy"), text: characterName(read.creatorCharID), opens: { kind: "character", characterID: read.creatorCharID } });
    }
    rows.push({ key: "start", label: word("UI/InfoWindow/StartDate"), text: read.startDate === null ? "" : fmtDate(BigInt(read.startDate), "ls") });
    // PrimeTimeHourEntryHorizontal: the hour, and the hour it becomes and when, while a change is pending.
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
    const pending = read.newPrimeHour !== 0 && read.newPrimeHourValidAfter !== null && now < BigInt(read.newPrimeHourValidAfter);
    rows.push({
      key: "primeHour",
      label: word("UI/Sovereignty/DefaultVulnerabilityTime"),
      text: pending
        ? `${word("UI/Sovereignty/VulnerabilityTimerChangesTime", { hour: read.currentPrimeHour, newHour: read.newPrimeHour })} · ${word("UI/Sovereignty/VulnerabilityTimerChangesInfo", { validAfterDate: { type: "long", value: read.newPrimeHourValidAfter! } })}`
        : word("UI/Sovereignty/VulnerabilityTime", { hour: read.currentPrimeHour }),
    });
    rows.push({ key: "war", label: word("UI/WarPermit/WarPermitStatus"), text: word(warPermitLabel(read.allowWar)), hint: plainText(word("UI/WarPermit/WarPermitExplanation")) });
    // The capital's link is to its solar system, which the page's window does not show: its name.
    if (read.currentCapital !== null && read.currentCapital > 0) {
      rows.push({ key: "capital", label: word("UI/Sovereignty/CurrentCapital"), text: resolvedName($names.resolved, "system", read.currentCapital, "") });
    }
    if (read.url !== null && read.url !== "") {
      rows.push({
        key: "url",
        label: word("UI/Common/URL"),
        text: word("UI/Corporations/CorpUIHome/URLPlaceholder", { linkTag: `<url=${read.url}>`, url: read.url }),
        markup: true,
      });
    }
    return rows;
  });

  /** The owner's description (the Description tab, there only where it has words: ConstructTabs' `if text`). */
  const ownerDescription = $derived(corporationRead?.info.description ?? allianceRead?.description ?? "");

  /** Ask for the names this window needs. Batched, cached, never throws. */
  $effect(() => {
    const refs: NameRef[] = [];
    if (typeID !== null) {
      refs.push({ kind: "type", id: typeID });
    }
    const current = $subject;
    if (current?.kind === "character") {
      refs.push({ kind: characterNameKind(current.characterID), id: current.characterID });
      refs.push({ kind: "owner", id: current.characterID });
    }
    if (current?.kind === "corporation") {
      refs.push({ kind: "corporation", id: current.corporationID });
    }
    if (current?.kind === "alliance") {
      refs.push({ kind: "alliance", id: current.allianceID });
    }
    const corporation = corporationRead?.info ?? null;
    if (corporation !== null) {
      for (const id of [corporation.ceoID, corporation.creatorID]) {
        if (id !== null && isCharacterOwner(id)) refs.push({ kind: "owner", id });
      }
      if (corporation.allianceID !== null && corporation.allianceID > 0) refs.push({ kind: "alliance", id: corporation.allianceID });
      if (corporation.stationID !== null && corporation.stationID > 0) refs.push({ kind: "station", id: corporation.stationID });
      for (const id of corporationRead?.enlistmentFactions ?? []) refs.push({ kind: "faction", id });
    }
    const alliance = allianceRead;
    if (alliance !== null) {
      for (const id of [alliance.executorCorpID, alliance.creatorCorpID]) {
        if (id !== null) refs.push({ kind: "corporation", id });
      }
      if (alliance.creatorCharID !== null) refs.push({ kind: "owner", id: alliance.creatorCharID });
      if (alliance.currentCapital !== null && alliance.currentCapital > 0) refs.push({ kind: "system", id: alliance.currentCapital });
      if (alliance.warFactionID !== null) refs.push({ kind: "faction", id: alliance.warFactionID });
    }
    if (entity?.groupID != null) {
      refs.push({ kind: "typeGroup", id: entity.groupID });
    }
    if (entity?.categoryID != null) {
      refs.push({ kind: "typeCategory", id: entity.categoryID });
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  function subjectKindLabel(current: InfoSubject): string {
    switch (current.kind) {
      case "spaceObject":
        return "On this grid";
      case "module":
        return "Fitted to your ship";
      case "character":
        return "Pilot";
      case "corporation":
        return "Corporation";
      case "alliance":
        return "Alliance";
      case "type":
        return "Item";
      case "mapLocation":
        return mapTypeName(current.typeID);
    }
  }
</script>

<!-- The client's markup (a description, a URL, bold words), its links followed as the link registry follows them. -->
{#snippet markupLines(markup: string)}
  {#each mailBodyLines(markup) as line, place (place)}
    <p class="info-line">{#each line as run, at (at)}{@const follower = run.link === null ? null : followerOf(run.link, run.text)}{#if follower !== null}<button
          type="button"
          class="evelink {follower.kind}"
          title={follower.hint}
          draggable="true"
          ondragstart={(event) => startLinkDrag(event, run.link ?? "", run.text)}
          onclick={follower.follow}>{run.text}</button>{:else}<span
          class:info-bold={run.bold}
          class:info-italic={run.italic}
          class:info-underline={run.underline || run.link !== null}
          title={run.link ?? undefined}>{run.text}</span>{/if}{/each}</p>
  {/each}
{/snippet}

<section class="show-info">
  {#if $subject === null}
    <p class="empty">
      Nothing selected. Pick something and choose Show Info — from the overview, a
      target, or a fitting socket.
    </p>
  {:else}
    <header class="info-head">
      <TypeIcon
        {typeID}
        name={title}
        size="lg"
        fallbackText={corporationRead?.info.tickerName || allianceRead?.shortName || abbreviate(title)} />
      <div class="info-identity">
        <h2>{title}</h2>
        <p class="info-kind">{subjectKindLabel($subject)}</p>
        {#if typeName && typeName !== title}
          <p class="info-type">{typeName}</p>
        {/if}
        {#if groupName || categoryName}
          <p class="info-class">
            {[categoryName, groupName].filter((part) => part.length > 0).join(" · ")}
          </p>
        {/if}
        {#if corporationRead !== null}
          {@const info = corporationRead.info}
          {#if !isNpcCorporation(info.corporationID) && info.stationID !== null && info.stationID > 0}
            <!-- construct_header: a player's corporation's headquarters, its station, by the house icon. -->
            <p class="info-class">⌂ {resolvedName($names.resolved, "station", info.stationID, "")}</p>
          {/if}
          {#if info.allianceID !== null && info.allianceID > 0}
            {@const allianceID = info.allianceID}
            <!-- MemberOfAlliance beside the alliance's logo, which opens the alliance (ClickForAllianceInfo). -->
            <p class="info-class">
              <button type="button" class="evelink showInfo" title={word("UI/InfoWindow/ClickForAllianceInfo")} onclick={() => showInfo({ kind: "alliance", allianceID })}>
                {word("UI/InfoWindow/MemberOfAlliance", { allianceName: allianceName(allianceID) })}
              </button>
            </p>
          {/if}
        {/if}
        {#if allianceRead !== null && allianceRead.warFactionID !== null}
          <!-- ConstructHeaderAlliance: the militia it fights for. -->
          <p class="info-class">{word("UI/FactionWarfare/MilitiaAndFaction", { factionName: resolvedName($names.resolved, "faction", allianceRead.warFactionID, "") })}</p>
        {/if}
      </div>
      {#if corporationRead !== null && corporationRead.info.ceoID !== null && !isNpcCorporation(corporationRead.info.corporationID)}
        <!-- construct_ceo_picture_info: a player's corporation's CEO beside the window's picture. -->
        <div class="info-ceo">
          <span class="info-ceo-label">{word("UI/Corporations/Common/CEO")}</span>
          <strong>{characterName(corporationRead.info.ceoID)}</strong>
        </div>
      {/if}
    </header>

    {#if $subject.kind === "spaceObject"}
      {#if entity}
        <h3>Where it is</h3>
        <dl class="kv">
          <dt>Distance</dt>
          <dd>{distance != null ? fmtDist(distance, 1, say) : "—"}</dd>
          <dt>Speed</dt>
          <dd>{speed != null ? `${Math.round(speed)} m/s` : "—"}</dd>
          {#if isHostile(entity)}
            <dt>Threat</dt>
            <dd>{hostileLabel(entity) ?? "Hostile"}</dd>
          {/if}
          {#if entity.remainingQuantity != null}
            <!-- Only a rock the server gave a mining record for. Null stays
                 absent rather than becoming a 0 that reads as mined out. -->
            <dt>Ore left</dt>
            <dd>{entity.remainingQuantity.toLocaleString("en-US")}</dd>
          {/if}
          {#if entity.oreValuePerM3 != null}
            <!-- What the retail client's Mining Surveyor shows as a colour: the
                 ore's reprocessed value per cubic metre. Absent when it could
                 not be priced — never a 0, which would read as worthless. -->
            <dt>Ore value</dt>
            <dd>{Math.round(entity.oreValuePerM3).toLocaleString("en-US")} ISK/m³</dd>
          {/if}
        </dl>

        {#if condition.length > 0}
          <h3>Condition</h3>
          <dl class="kv">
            {#each condition as row (row.label)}
              <dt>{row.label}</dt>
              <dd>{row.pct}%</dd>
            {/each}
          </dl>
        {/if}

        <div class="controls">
          <button type="button" onclick={() => spaceSelection.select($subject.itemID)}>
            Select it
          </button>
        </div>
      {:else}
        <!-- ⚠ Said, not silently blanked. The window keeps the thing's identity
             and reports that it has gone, rather than showing stale numbers. -->
        <p class="note">This is no longer on your grid, so there is nothing live to report about it.</p>
      {/if}
    {:else if $subject.kind === "module"}
      {#if fittedModule}
        <dl class="kv">
          <dt>State</dt>
          <dd>{fittedModule.online ? "Online" : "Offline"}</dd>
          {#if fittedModule.charge}
            <dt>Loaded</dt>
            <dd>
              {resolvedName($names.resolved, "type", fittedModule.charge.typeID, "Unknown charge")}
              × {fittedModule.charge.quantity.toLocaleString("en-US")}
            </dd>
          {/if}
        </dl>
      {/if}
      {#if moduleStats.length > 0}
        <h3>Attributes</h3>
        <!-- The SERVER's effective values, with skills and hull bonuses already
             applied — not the static table's base numbers. -->
        <dl class="kv">
          {#each moduleStats as stat (stat.id)}
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          {/each}
        </dl>
      {:else}
        <p class="note">
          No attribute reading for this module yet — the fitting window's dogma read is what
          supplies them.
        </p>
      {/if}
    {:else if $subject.kind === "mapLocation"}
      {#if mapLocationRead !== null}
        {@const read = mapLocationRead}
        <!-- The sub caption's location trace (GetLocationTrace): the places it lies in, each a link, a system's security
             level after them. -->
        {#if read.parents.length > 0 || read.securityStatus != null}
          <dl class="kv">
            {#each read.parents as parent (parent.itemID)}
              <dt>{mapTypeName(parent.typeID)}</dt>
              <dd><button type="button" class="evelink showInfo" title={word("UI/Commands/ShowInfo")} onclick={() => showInfo(placeSubject(parent))}>{parent.name}</button></dd>
            {/each}
            {#if read.securityStatus != null}
              <dt>{word("UI/Neocom/SecurityLevel")}</dt>
              <dd><span style:color={securityStatusColor(shownSecurity(read.securityStatus))}>{shownSecurity(read.securityStatus).toFixed(1)}</span></dd>
            {/if}
          </dl>
        {/if}
        <h3>{word("UI/InfoWindow/TabNames/Description")}</h3>
        <div class="info-description">{@render markupLines(read.description ?? mapTypeName(read.typeID))}</div>
        {#each [[CHILD_LABELS[read.typeID], read.children], [NEIGHBOUR_LABELS[read.typeID], read.neighbours]] as const as [label, list] (label ?? "none")}
          {#if label && list.length > 0}
            <h3>{word(label)}</h3>
            <ul class="info-places">
              {#each [...list].sort(byPlaceName) as place (place.itemID)}
                <li>
                  <span class="info-place-type">{mapTypeName(place.typeID)}</span>
                  <span class="info-place-sec" style:color={place.securityStatus != null ? securityStatusColor(shownSecurity(place.securityStatus)) : undefined}>{place.securityStatus != null ? shownSecurity(place.securityStatus).toFixed(1) : ""}</span>
                  <button type="button" class="evelink showInfo" title={word("UI/Commands/ShowInfo")} onclick={() => showInfo(placeSubject(place))}>{place.name}</button>
                </li>
              {/each}
            </ul>
          {/if}
        {/each}
      {:else if ownerReadDone}
        <p class="note">The page has no record of this place.</p>
      {:else}
        <p class="note">Reading…</p>
      {/if}
    {:else if $subject.kind === "character"}
      {#if standing}
        <h3>Standing</h3>
        <dl class="kv">
          <dt>Yours toward them</dt>
          <dd>{standing.standing.toFixed(2)}</dd>
        </dl>
      {:else}
        <p class="note">You hold no recorded standing toward this pilot.</p>
      {/if}
    {:else if $subject.kind === "corporation" || $subject.kind === "alliance"}
      {@const rows = $subject.kind === "corporation" ? corporationRows : allianceRows}
      {#if rows.length > 0}
        {#if ownerDescription.trim() !== ""}
          <h3>{word("UI/InfoWindow/TabNames/Description")}</h3>
          <div class="info-description">{@render markupLines(ownerDescription)}</div>
        {/if}
        <h3>{word("UI/InfoWindow/TabNames/Attributes")}</h3>
        <dl class="kv">
          {#each rows as row (row.key)}
            <dt>{row.label}</dt>
            <dd title={row.hint || undefined} class:info-more={!!row.hint}>
              {#if row.opens}
                {@const opens = row.opens}
                <button type="button" class="evelink showInfo" title={word("UI/Commands/ShowInfo")} onclick={() => showInfo(opens)}>{row.text}</button>
              {:else if row.markup}
                {@render markupLines(row.text)}
              {:else}
                {#each row.text.split("\n") as part, at (at)}<span class="info-part">{part}</span>{/each}
              {/if}
            </dd>
          {/each}
        </dl>
      {:else if ownerReadDone}
        <!-- Said, not blanked: the server had no record to give. -->
        <p class="note">The server gave no record of this {$subject.kind === "corporation" ? "corporation" : "alliance"}.</p>
      {:else}
        <p class="note">Reading…</p>
      {/if}
    {:else}
      <p class="note">
        Nothing further is loaded about this item. Fit one to your ship to see its effective
        attributes.
      </p>
    {/if}
  {/if}
</section>
