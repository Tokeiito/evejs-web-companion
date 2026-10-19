<script lang="ts">
  // EditMemberDialog: General (corp_dlg_edit_member.py LoadChar, OnTabGeneral, DDXTabGeneral, UpdateMember).
  import { onMount, untrack } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { CorporationMemberDetails } from "../bridge/corporationMemberDetails.ts";
  import { DATE_LABELS, formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { resolvedName } from "../store/names.ts";
  import OwnerPicture from "./OwnerPicture.svelte";
  import { portraitDefaultPath, portraitUrl } from "./ownerImages.ts";
  import { clientTexture } from "./skillGroupIcons.ts";

  let { store, flow, onClose }: { store: ClientStore; flow: AppFlow; onClose?: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const target = flow.memberDetailsShown;
  // svelte-ignore state_referenced_locally
  const imageServer = flow.imageServer;
  const characterID = $derived($target?.characterID ?? null);
  const LABELS = {
    caption: "UI/Corporations/EditMemberDialog/EditMemberCaption", general: "UI/Generic/General",
    title: "UI/Corporations/EditMemberDialog/CorpMemberTitleCaption", base: "UI/Corporations/EditMemberDialog/CorpMemberBaseCaption",
    joined: "UI/Corporations/EditMemberDialog/CorpMemberJoined", name: "UI/Corporations/EditMemberDialog/Name",
    gender: "UI/Common/Gender/Gender", male: "UI/Common/Gender/Male", female: "UI/Common/Gender/Female", race: "UI/Common/Race",
    born: "UI/Corporations/EditMemberDialog/DateOfBirth", security: "UI/Corporations/EditMemberDialog/SecurityStatus",
    noBase: "UI/Corporations/EditMemberDialog/NoBase", baseName: "UI/Corporations/EditMemberDialog/CorpMemberBase",
    ok: "UI/Common/Buttons/OK", cancel: "UI/Common/Buttons/Cancel", apply: "UI/Corporations/EditMemberDialog/Apply",
  };
  const word = (label: string, fallback: string) => plainText($words.templates[label] ?? fallback);
  const fill = (label: string, args: Record<string, string | number | { type: "long"; value: string }>, fallback = "") => plainText(formatTemplate($words.templates[label] ?? fallback, args, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
  const date = (value: bigint) => fill(DATE_LABELS.ls!, { datetime: { type: "long", value: value.toString() } });
  let held = $state<CorporationMemberDetails | null>(null);
  let title = $state("");
  let base = $state("");
  let busy = $state(false);
  let error = $state("");
  let serial = 0;
  let disposed = false;
  function keep(value: CorporationMemberDetails): void { held = value; title = value.member.title; base = value.member.baseID?.toString() ?? ""; }
  async function load(id: number): Promise<void> {
    const request = ++serial;
    held = null; error = ""; busy = true;
    try { const value = await flow.corporationMemberDetails(id); if (!disposed && request === serial) keep(value); }
    catch (cause) { if (!disposed && request === serial) error = cause instanceof Error ? cause.message : String(cause); }
    finally { if (!disposed && request === serial) busy = false; }
  }
  async function apply(close: boolean): Promise<void> {
    if (!held || busy) return;
    const request = serial;
    busy = true; error = "";
    try {
      const value = await flow.saveMemberGeneral(held, title, base ? Number(base) : null);
      if (!disposed && request === serial) { keep(value); if (close) onClose?.(); }
    } catch (cause) { if (!disposed && request === serial) error = cause instanceof Error ? cause.message : String(cause); }
    finally { if (!disposed && request === serial) busy = false; }
  }
  const portrait = $derived(characterID === null ? null : portraitUrl($imageServer, characterID, 128));
  onMount(() => {
    flow.requestWords([...Object.values(LABELS), DATE_LABELS.ls!]);
    flow.loadImageServer();
    return () => { disposed = true; serial++; };
  });
  $effect(() => { const id = characterID; if (id !== null) untrack(() => { void load(id); }); });
</script>

<section class="panel member-details">
  <header class="panel-head"><h2 class="panel-title">{word(LABELS.caption, "Member Details")}</h2></header>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if held}
    <div class="identity">
      <OwnerPicture name={held.name} urls={portrait ? [portrait, clientTexture(portraitDefaultPath(128))] : [clientTexture(portraitDefaultPath(128))]} size={128} />
      <div><h3>{held.name}</h3>{#if held.member.title}<p>{held.member.title}</p>{/if}</div>
    </div>
    <h3>{word(LABELS.general, "General")}</h3>
    {#if held.canEditTitle}
      <label>{word(LABELS.title, "Title")}<input aria-label={word(LABELS.title, "Title")} maxlength="100" bind:value={title} disabled={busy} /></label>
    {:else if !held.canEditBase}<p>{word(LABELS.title, "Title")}: {held.member.title}</p>{/if}
    {#if held.canEditBase}
      <label>{word(LABELS.base, "Base")}<select aria-label={word(LABELS.base, "Base")} bind:value={base} disabled={busy}>
        <option value="">{word(LABELS.noBase, "No base")}</option>
        {#each held.bases as office (office.stationID)}<option value={String(office.stationID)}>{fill(LABELS.baseName, { station: office.stationID }, office.name)}</option>{/each}
      </select></label>
    {/if}
    <dl>
      {#if !held.canEditBase}<dt>{word(LABELS.base, "Base")}</dt><dd>{held.member.baseID ? fill(LABELS.baseName, { station: held.member.baseID }) : ""}</dd>{/if}
      <dt>{word(LABELS.joined, "Joined")}</dt><dd>{date(held.member.startDateTime)}</dd>
      <dt>{word(LABELS.name, "Name")}</dt><dd>{held.name}</dd>
      <dt>{word(LABELS.gender, "Gender")}</dt><dd>{word(held.gender ? LABELS.male : LABELS.female, held.gender ? "Male" : "Female")}</dd>
      <dt>{word(LABELS.race, "Race")}</dt><dd>{word(`#${held.raceNameID}`, "")}</dd>
      <dt>{word(LABELS.born, "Date of birth")}</dt><dd>{date(held.createDateTime)}</dd>
      <dt>{word(LABELS.security, "Security status")}</dt><dd>{held.security.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</dd>
    </dl>
    <div class="controls">
      <button type="button" disabled={busy} onclick={() => void apply(true)}>{word(LABELS.ok, "OK")}</button>
      <button type="button" onclick={() => onClose?.()}>{word(LABELS.cancel, "Cancel")}</button>
      <button type="button" disabled={busy} onclick={() => void apply(false)}>{word(LABELS.apply, "Apply")}</button>
    </div>
  {:else if !error}<p>{busy ? "Reading member…" : "Choose a corporation member."}</p>{/if}
</section>

<style>
  .identity { display: flex; align-items: center; gap: 1rem; }
  .identity h3, .identity p { margin: 0; }
  label { display: block; margin: 0.5rem 0; }
  label input, label select { display: block; width: 100%; }
  dl { display: grid; grid-template-columns: minmax(7rem, auto) minmax(0, 1fr); gap: 0.5rem; }
  dt { color: var(--color-muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
</style>
