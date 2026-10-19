<script lang="ts">
  import type { Session } from "../app/sessions.ts";
  import type { ChatInviteChoice } from "../app/chatConversations.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import LabelText from "./LabelText.svelte";
  import OwnerPicture from "./OwnerPicture.svelte";
  import { clientTexture } from "./skillGroupIcons.ts";
  import { portraitDefaultPath, portraitUrl } from "./ownerImages.ts";
  import { showInfo } from "./showInfo.ts";
  import { linkFollowerOf, LINK_WORDS } from "./linkFollowers.ts";
  let { session, sender, generation, inFront }: { session: Session; sender: number; generation: number; inFront: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const words = session.store.words;
  // svelte-ignore state_referenced_locally
  const station = session.store.station;
  // svelte-ignore state_referenced_locally
  const imageServer = session.flow.imageServer;
  const portrait = $derived(portraitUrl($imageServer, sender, 64));
  // svelte-ignore state_referenced_locally
  const conversations = session.flow.conversations.state;
  let choice = $state<ChatInviteChoice>("accept");
  const choices: readonly [ChatInviteChoice, string, string][] = [
    ["accept", "UI/Chat/AcceptInvitation", "Accept Invitation"],
    ["acceptadd", "UI/Chat/AcceptInvitationAndAddContact", "Accept Invitation and Add Contact"],
    ["reject", "UI/Chat/RejectInvitation", "Reject Invitation"],
    ["block", "UI/Chat/RejectInvitationAndBlock", "Reject Invitation and Block"],
  ];
  const word = (label: string, fallback: string) => plainText($words.templates[label] ?? fallback);
  const body = $derived(formatTemplate($words.templates["UI/Chat/InvitedToConversation"] ?? `${session.flow.conversations.name(sender)} invites you to a conversation.`, { inviter: sender }, { nameOf: () => session.flow.conversations.name(sender) }));
  const followerOf = (url: string, text: string) => linkFollowerOf(url, session.flow, null, label => word(label, LINK_WORDS[label] ?? ""), text);
  const group = $derived(`chat-invite-${session.id}-${generation}-${sender}`);
  async function confirm(answer: ChatInviteChoice = choice) {
    try { await session.flow.conversations.answer(sender, answer, generation); } catch { /* the controller keeps the actual refusal */ }
  }
</script>

<dialog open aria-modal="false" aria-label={word("UI/Chat/ChatInvite", "Chat Invitation")} class="chat-invitation" class:in-front={inFront} data-chat-inviter={sender}>
  <header><h2>{word("UI/Chat/ChatInvite", "Chat Invitation")}</h2><button type="button" class="minor" aria-label="Close invitation" disabled={$conversations.busy} onclick={() => confirm("reject")}>×</button></header>
  <p class="note">{$station.online?.characterName ?? ""}</p>
  <div class="inviter"><button type="button" class="minor" onclick={() => showInfo({ kind: "character", characterID: sender })}><OwnerPicture name={session.flow.conversations.name(sender)} urls={portrait ? [portrait, clientTexture(portraitDefaultPath(64))] : [clientTexture(portraitDefaultPath(64))]} size={64} /></button><LabelText markup={body} {followerOf} /></div>
  <fieldset disabled={$conversations.busy}>
    {#each choices as [value, label, fallback] (value)}<label><input type="radio" name={group} {value} bind:group={choice} />{word(label, fallback)}</label>{/each}
  </fieldset>
  <button type="button" disabled={$conversations.busy} onclick={() => confirm()}>{word("UI/Generic/OK", "OK")}</button>
</dialog>

<style>
  .chat-invitation { position: relative; margin: 0; width: min(23rem, calc(100vw - 2rem)); padding: 1rem; border: 1px solid var(--color-accent); background: var(--color-bg, #0b1119); color: var(--color-text); box-shadow: 0 0.5rem 2rem #0009; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; } h2 { margin: 0; font-size: 1rem; }
  .inviter { display: flex; align-items: center; gap: 0.75rem; margin: 0.75rem 0; } fieldset { border: 0; padding: 0; margin: 0.75rem 0; } fieldset label { display: flex; align-items: center; gap: 0.5rem; margin: 0.65rem 0; }
</style>
