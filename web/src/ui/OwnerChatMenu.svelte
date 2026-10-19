<script lang="ts">
  import { onMount } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import { notify } from "./notices.ts";
  let { store, flow, ownerID, onDone }: { store: ClientStore; flow: AppFlow; ownerID: number; onDone: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const conversations = flow.conversations.state;
  let offered = $state(false), expanded = $state(false), reading = 0;
  let channels = $state<readonly { channel: string; title: string }[]>([]);
  const word = (label: string, fallback: string) => plainText($words.templates[label] ?? fallback);
  $effect(() => {
    const target = ownerID, sequence = ++reading; offered = false; expanded = false;
    void flow.conversations.canStart(target).then(value => { if (reading === sequence) offered = value; }).catch(() => {});
  });
  function start(room?: string) {
    const action = flow.conversations.start(ownerID, room); onDone();
    void action.catch(error => { if (error?.code !== "SESSION_REQUEST_RETIRED") notify({ kind: "danger", title: "Conversation refused", detail: error instanceof Error ? error.message : String(error) }); });
  }
  async function inviteMenu() {
    expanded = !expanded; if (!expanded) return;
    try { channels = await flow.conversations.invitable(ownerID); } catch { channels = []; }
  }
  onMount(() => flow.requestWords(["UI/Chat/StartConversation", "UI/Chat/InviteToChat"]));
</script>

{#if offered}
  <button type="button" class="minor" disabled={$conversations.busy} onclick={() => start()}>{word("UI/Chat/StartConversation", "Start Conversation")}</button>
  <button type="button" class="minor" disabled={$conversations.busy} aria-expanded={expanded} onclick={inviteMenu}>{word("UI/Chat/InviteToChat", "Invite To Chat")} {expanded ? "▾" : "▸"}</button>
  {#if expanded}<span class="chat-invite-menu"><button type="button" class="minor" disabled={$conversations.busy} onclick={() => start()}>{word("UI/Chat/StartConversation", "Start Conversation")}</button>{#each channels as channel (channel.channel)}<button type="button" class="minor" disabled={$conversations.busy} onclick={() => start(channel.channel)}>{channel.title}</button>{/each}</span>{/if}
{/if}

<style>.chat-invite-menu { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; }</style>
