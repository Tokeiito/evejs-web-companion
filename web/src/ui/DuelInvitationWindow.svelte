<script lang="ts">
  // Original duelInviteWindow.py: no close button; 100ms countdown, then red /
  // disabled for 2 seconds. A timeout produces no response or block operation.
  import { onMount, onDestroy } from "svelte";
  import type { Session } from "../app/sessions.ts";
  import type { DuelInvitation } from "../bridge/duel.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import { resolvedName } from "../store/names.ts";
  import { failureCode } from "../bridge/ask.ts";
  import { showOwnerInfo } from "./ownerInfo.ts";
  import OwnerPicture from "./OwnerPicture.svelte";
  import { portraitUrl, portraitDefaultPath } from "./ownerImages.ts";
  import { clientTexture } from "./skillGroupIcons.ts";
  import { notify } from "./notices.ts";
  let { session, invitation, inFront }: { session: Session; invitation: DuelInvitation; inFront: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const words = session.store.words, names = session.store.names, station = session.store.station, images = session.flow.imageServer;
  let block = $state(false), busy = $state(false), remaining = $state(30), disposed = false;
  let timer: ReturnType<typeof setInterval> | null = null, closeAt: number | null = null;
  const portrait = $derived(portraitUrl($images, invitation.characterID, 64));
  const word = (label: string, fallback: string) => plainText($words.templates[label] ?? fallback);
  const name = (id: number) => resolvedName($names.resolved, "owner", id, String(id));
  function tick(): void {
    const expiryMs = Number((BigInt(invitation.expiry) - 116444736000000000n) / 10000n);
    remaining = Math.max(0, Math.floor((expiryMs - Date.now() - invitation.clockOffsetMs) / 1000));
    if (expiryMs <= Date.now() + invitation.clockOffsetMs && closeAt === null) {
      closeAt = Date.now() + 2000; session.flow.expireDuel(invitation.n);
    }
    if (closeAt !== null && Date.now() >= closeAt) session.flow.closeDuel(invitation.n);
  }
  async function answer(accept: boolean): Promise<void> {
    if (busy || invitation.expired) return;
    busy = true;
    try { await session.flow.answerDuel(invitation.n, accept, block); }
    catch (cause) { if (failureCode(cause) !== "SESSION_REQUEST_RETIRED") notify({ kind: "danger", title: "Duel", detail: String(cause) }); }
    finally { if (!disposed) busy = false; }
  }
  function info(id: number): void { void showOwnerInfo(session.flow, id).catch(cause => { if (failureCode(cause) !== "SESSION_REQUEST_RETIRED") notify({ kind: "danger", title: "Show Info", detail: String(cause) }); }); }
  onMount(() => {
    session.flow.loadImageServer();
    session.flow.requestWords(["UI/Common/Name", "UI/Common/Corporation", "UI/Common/Alliance"]);
    tick(); timer = setInterval(tick, 100);
  });
  onDestroy(() => { disposed = true; if (timer !== null) clearInterval(timer); });
</script>
<dialog open aria-modal="false" aria-label={word("UI/Crimewatch/Duel/InvitationWindowCaption", "Duel Invitation")} class="duel-invitation" class:in-front={inFront}>
  <h2>{word("UI/Crimewatch/Duel/InvitationWindowCaption", "Duel Invitation")}</h2>
  <p class="note">{$station.online?.characterName ?? ""}</p>
  <div class="challenger">
    <button type="button" class="minor portrait" aria-label={`Show Info: ${name(invitation.characterID)}`} onclick={() => info(invitation.characterID)}><OwnerPicture name={name(invitation.characterID)} urls={portrait ? [portrait, clientTexture(portraitDefaultPath(64))] : [clientTexture(portraitDefaultPath(64))]} size={64} /></button>
    <dl><dt>{word("UI/Common/Name", "Name")}</dt><dd><button type="button" class="minor" onclick={() => info(invitation.characterID)}>{name(invitation.characterID)}</button></dd><dt>{word("UI/Common/Corporation", "Corporation")}</dt><dd><button type="button" class="minor" onclick={() => info(invitation.corporationID)}>{name(invitation.corporationID)}</button></dd>
      {#if invitation.allianceID !== null}<dt>{word("UI/Common/Alliance", "Alliance")}</dt><dd><button type="button" class="minor" onclick={() => info(invitation.allianceID!)}>{name(invitation.allianceID)}</button></dd>{/if}
    </dl>
    <div class="countdown" class:expired={invitation.expired} style:background-image={`url("${clientTexture("res:/UI/Texture/Crimewatch/Crimewatch_LimitedEngagement_64.png")}")`}><output aria-label="Time remaining">{remaining}</output></div>
  </div>
  <p>{word("UI/Crimewatch/Duel/DuelDecleration", "You have been challenged to a duel.")}</p>
  <div class="answers"><button type="button" disabled={busy || invitation.expired} onclick={() => void answer(true)}>{word("UI/Crimewatch/Duel/Accept", "Accept")}</button><button type="button" disabled={busy || invitation.expired} onclick={() => void answer(false)}>{word("UI/Crimewatch/Duel/Decline", "Decline")}</button><label><input type="checkbox" disabled={busy || invitation.expired} bind:checked={block} />{word("UI/Crimewatch/Duel/BlockCommunications", "Block Communications")}</label></div>
</dialog>
<style>
  .duel-invitation { position: relative; margin: 0; width: min(420px, calc(100vw - 2rem)); padding: 1rem; border: 1px solid var(--color-accent); background: var(--color-bg, #0b1119); color: var(--color-text); box-shadow: 0 0.5rem 2rem #0009; }
  h2 { margin: 0; font-size: 1rem; } .challenger { display: flex; gap: 8px; align-items: flex-start; } .portrait { padding: 0; flex: 0 0 64px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; flex: 1; margin: 0; } dt { align-self: center; } dd { margin: 0; } dd button { text-align: left; padding: 2px; }
  .countdown { width: 64px; height: 64px; flex: 0 0 64px; display: grid; place-items: center; background-size: contain; color: #00cdd0; font-size: 32px; } .countdown.expired { color: red; }
  .answers { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; } .answers label { display: flex; align-items: center; gap: 4px; }
</style>
