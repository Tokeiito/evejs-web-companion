<script lang="ts">
  // A fleet invitation, asked as the retail client asks it (fleetSvc.OnFleetInvite, 1176 to 1199): the client's
  // own window for the dialog the invitation names (AskJoinFleet), not modal, Yes or No, whatever window is open;
  // Yes is AcceptInvite on the fleet's Moniker, No is RejectInvite. Each pilot of the tab is a client of its own,
  // so a pilot not in front is asked all the same, and the question says which pilot it is for (the page's own
  // words: a client has one pilot and says nothing of it). The answer is made by that pilot's own flow.
  //
  // What the invitation is, and when it is put down unasked (a pilot already in a fleet, an autoAccept), is the
  // flow's (flow.ts applyPushedNotification); this shows what that pilot's store holds as pending.
  import type { Session } from "../app/sessions.ts";
  import type { QuestionWords } from "../store/types.ts";
  import { resolvedName, type NameKind } from "../store/names.ts";
  import { questionText, wordsLabels, wordsNameRefs, type ClientWording } from "../bridge/questions.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";

  let { session, inFront }: { session: Session; inFront: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const fleet = session.store.fleet;
  // svelte-ignore state_referenced_locally
  const words = session.store.words;
  // svelte-ignore state_referenced_locally
  const names = session.store.names;
  // svelte-ignore state_referenced_locally
  const station = session.store.station;
  // svelte-ignore state_referenced_locally
  const flow = session.flow;

  const invite = $derived($fleet.pendingInvite);
  const client = $derived<ClientWording>({
    templates: $words.templates,
    playerID: $station.online?.characterID ?? null,
  });
  const dialogWords = (part: "title" | "body"): QuestionWords | null =>
    invite === null
      ? null
      : { label: null, text: null, parameters: invite.parameters ?? null, dialog: invite.dialog ?? "AskJoinFleet", part };
  const title = $derived(dialogWords("title"));
  const body = $derived(dialogWords("body"));

  // The client's text for the dialog, from the player's install, and the names it is about (the inviter).
  $effect(() => {
    if (title === null || body === null) {
      return;
    }
    const labels = wordsLabels([title, body]);
    if (labels.length > 0) {
      flow.requestWords(labels);
    }
    const refs = wordsNameRefs([title, body], client);
    if (invite !== null && invite.inviterID !== null) {
      refs.push({ kind: "character", id: invite.inviterID });
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  function nameOf(kind: NameKind, id: number): string {
    return resolvedName($names.resolved, kind, id, `${kind} ${id}`);
  }

  // The page's own words where the client's are not to hand.
  const titleText = $derived(title === null ? "" : questionText(title, nameOf, client) || "Fleet invitation");
  const bodyText = $derived.by(() => {
    if (body === null || invite === null) {
      return "";
    }
    const said = questionText(body, nameOf, client);
    if (said) {
      return said;
    }
    const inviter = invite.inviterID === null ? "A pilot" : nameOf("character", invite.inviterID);
    return `${inviter} invites you to join a fleet.`;
  });
  const pilotName = $derived($station.online?.characterName ?? null);

  let answering = $state(false);
  let error = $state("");

  async function answer(yes: boolean): Promise<void> {
    if (answering || invite === null) {
      return;
    }
    answering = true;
    error = "";
    try {
      if (yes) {
        await flow.acceptFleetInvite(invite.fleetID);
      } else {
        await flow.declineFleetInvite(invite.fleetID);
      }
      const said = fleet.get().actionError;
      if (said) {
        error = said;
      }
    } catch (cause) {
      error = panelErrorWords(cause);
    } finally {
      answering = false;
    }
  }
</script>

{#if invite !== null}
  <div
    class="fleet-invitation"
    role="alertdialog"
    aria-label={titleText}
    data-fleet-id={invite.fleetID}
    data-in-front={inFront}
  >
    {#if !inFront && pilotName !== null}
      <span class="for-pilot">For {pilotName}</span>
    {/if}
    <strong>{titleText}</strong>
    <span class="body">{bodyText}</span>
    <span class="answers">
      <button type="button" disabled={answering} onclick={() => void answer(true)}>Yes</button>
      <button type="button" disabled={answering} onclick={() => void answer(false)}>No</button>
    </span>
    {#if error}
      <span class="error" role="alert">{error}</span>
    {/if}
  </div>
{/if}

<style>
  .fleet-invitation { display: flex; gap: 0.65rem; align-items: center; flex-wrap: wrap;
    padding: 0.5rem 0.75rem; background: #14273a; color: #d6e6f7; border: 1px solid #3c6f9e; }
  .for-pilot { flex-basis: 100%; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
  .body { flex: 1 1 20rem; white-space: pre-line; }
  .answers { display: flex; gap: 0.4rem; }
  button { border: 1px solid #5b93c7; background: #1b3956; color: inherit; padding: 0.2rem 0.75rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .error { color: #f3b0a8; flex-basis: 100%; }
</style>
