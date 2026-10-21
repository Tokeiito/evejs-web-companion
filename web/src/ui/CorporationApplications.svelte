<script lang="ts">
  // corporation/corp_ui_applications.py50-151,263-301,533-770: personal view.
  import { onMount } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { APPLICATION_STATUS_LABELS, applicationEnded, applicationAcceptable, type CorporationApplication } from "../bridge/corporationApplications.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { resolvedName } from "../store/names.ts";
  import { showInfo } from "./showInfo.ts";
  import CorpLogo from "./CorpLogo.svelte";
  import { clientTexture } from "./skillGroupIcons.ts";
  import LabelText from "./LabelText.svelte";
  import { linkFollowerOf, LINK_WORDS } from "./linkFollowers.ts";
  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const logos = flow.corpLogos, library = flow.corpLogoLibrary, ownerLogos = flow.ownerLogos;
  const PREFIX = "UI/Corporations/CorpApplications/";
  const LABELS = { empty: PREFIX + "NoApplicationsFound", accept: PREFIX + "AcceptApplication", decline: PREFIX + "DeclineInvitation", withdraw: PREFIX + "WithdrawApplication", info: "UI/Commands/ShowInfo", date: "UI/Corporations/Applications/ApplicationDate" };
  const word = (label: string, fallback: string) => plainText($words.templates[label] ?? fallback);
  const nameOf = (id: number) => resolvedName($names.resolved, "owner", id, "…");
  const followerOf = (url: string, text: string) => linkFollowerOf(url, flow, null, label => word(label, LINK_WORDS[label] ?? ""), text);
  let rows = $state<readonly CorporationApplication[] | null>(null);
  let expanded = $state<number | null>(null);
  let menu = $state<number | null>(null);
  let busy = $state(false);
  let error = $state("");
  let disposed = false, serial = 0;
  async function load(): Promise<void> {
    const request = ++serial;
    try {
      const answer = await flow.corporationApplications();
      if (disposed || request !== serial) return;
      rows = answer;
      // CorpIcon.DoLayout uses cfg.corptickernames.Get for each unseen owner,
      // after the application view has finished priming owner names.
      for (const id of new Set(answer.map(row => row.corporationID))) flow.requestCorpLogos([id]);
    } catch (cause) { if (!disposed && request === serial) error = cause instanceof Error ? cause.message : String(cause); }
  }
  onMount(() => {
    expanded = flow.corporationApplicationsExpanded();
    flow.loadOwnerLogos();
    flow.requestWords([...Object.values(LABELS), ...Object.keys(LINK_WORDS), ...Object.values(APPLICATION_STATUS_LABELS).map(label => PREFIX + label)]);
    const stop = flow.corporationApplicationsChanged.subscribe(() => { void load(); });
    return () => { disposed = true; ++serial; stop(); };
  });
  function expand(id: number): void { expanded = expanded === id ? null : id; flow.corporationApplicationsExpanded(expanded); menu = null; }
  async function decide(row: CorporationApplication, status: 2 | 3 | 7): Promise<void> {
    if (busy) return;
    menu = null; busy = true; error = "";
    try { await flow.corporationApplicationDecision(row, status); if (!disposed) await load(); }
    catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); }
    finally { if (!disposed) busy = false; }
  }
  function dateText(row: CorporationApplication): string {
    return plainText(formatTemplate($words.templates[LABELS.date] ?? "{[datetime]applicationDateTime}", { applicationDateTime: row.date.toString() }, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
  }
</script>

<section class="applications" aria-label={word(PREFIX + "MyApplications", "My Applications")}>
  {#if error}<p class="error">{error}</p>{/if}
  {#if rows === null}<p class="note">Loading…</p>
  {:else if rows.length === 0}<p class="empty">{word(LABELS.empty, "No applications found")}</p>
  {:else}
    {#each rows as row (row.applicationID)}
      {@const logo = $logos[String(row.corporationID)]}
      <article class="application" data-application={row.applicationID}>
        <div class="application-head">
          <button type="button" class="application-logo minor" title={word(LABELS.info, "Show Info")} onclick={() => showInfo({ kind: "corporation", corporationID: row.corporationID })}>
            {#if logo && $library}<CorpLogo library={$library} {logo} name={nameOf(row.corporationID)} />
            {:else if $ownerLogos?.corporations[String(row.corporationID)]}<img src={clientTexture($ownerLogos.corporations[String(row.corporationID)]!)} width="48" height="48" alt="" />{/if}
          </button>
          <button type="button" class="application-title minor" aria-expanded={expanded === row.applicationID} onclick={() => expand(row.applicationID)} oncontextmenu={event => { event.preventDefault(); menu = row.applicationID; }}>
            <span aria-hidden="true">{expanded === row.applicationID ? "▾" : "▸"}</span>
            <span><strong>{nameOf(row.corporationID)} — {word(PREFIX + (APPLICATION_STATUS_LABELS[row.status] ?? ""), "")}</strong><small>{dateText(row)}</small></span>
          </button>
          <div class="application-actions">
            {#if applicationAcceptable(row.status)}<button type="button" disabled={busy} onclick={() => decide(row, 2)}>{word(LABELS.accept, "Accept")}</button>{/if}
            {#if !applicationEnded(row.status)}<button type="button" class="minor" disabled={busy} onclick={() => decide(row, row.status === 8 ? 3 : 7)}>{word(row.status === 8 ? LABELS.decline : LABELS.withdraw, row.status === 8 ? "Decline Invitation" : "Withdraw Application")}</button>{/if}
          </div>
        </div>
        {#if menu === row.applicationID}
          <div class="application-menu" role="menu" tabindex="-1" onkeydown={event => { if (event.key === "Escape") menu = null; }}>
            <button type="button" role="menuitem" onclick={() => { menu = null; showInfo({ kind: "corporation", corporationID: row.corporationID }); }}>{word(LABELS.info, "Show Info")}</button>
            {#if !applicationEnded(row.status)}<button type="button" role="menuitem" disabled={busy} onclick={() => decide(row, 7)}>{word(row.status === 8 ? LABELS.decline : LABELS.withdraw, row.status === 8 ? "Decline Invitation" : "Withdraw Application")}</button>{/if}
            {#if applicationAcceptable(row.status)}<button type="button" role="menuitem" disabled={busy} onclick={() => decide(row, 2)}>{word(LABELS.accept, "Accept")}</button>{/if}
          </div>
        {/if}
        {#if expanded === row.applicationID}<div class="application-text"><LabelText markup={row.displayText} {followerOf} /></div>{/if}
      </article>
    {/each}
  {/if}
</section>

<style>
  .applications { min-width: 0; }
  .application { border-bottom: 1px solid var(--color-border); padding: .35rem 0; }
  .application-head { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
  .application-logo { flex: 0 0 48px; width: 48px; height: 48px; padding: 0; }
  .application-title { display: flex; align-items: center; gap: .4rem; flex: 1 1 12rem; min-width: 0; text-align: left; }
  .application-title small { display: block; color: var(--color-muted); }
  .application-title strong { overflow-wrap: anywhere; }
  .application-actions, .application-menu { display: flex; flex-wrap: wrap; gap: .3rem; }
  .application-menu { padding: .4rem; background: var(--color-panel-2); }
  .application-text { white-space: pre-wrap; overflow-wrap: anywhere; margin: .5rem 1rem; }
</style>
