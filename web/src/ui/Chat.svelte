<script lang="ts">
  // Chat panel (goal R7): Local + Corp sub-channels, each with a member roster,
  // a message list, and a send box. A pure reader of the store's chat slice; all
  // read/send logic runs on the BFF (which holds the bridgeSessionID) and in
  // app/flow.ts. Chat delivery bypasses the notification drain, so READ is a
  // backlog poll: the panel polls the active channel on a modest interval while
  // it is open and stops when it closes (onDestroy). The browser never sees a
  // bridge session.
  //
  // A message is shown by its markup as the client's chat shows it (the editor's markup: bridge/mailMarkup.ts). Its
  // links are followed when clicked as the client's link registry follows them (evelink/client), each in its colour
  // (evelink/client/color.py) with its hint:
  //   skillPlan        link.py handle_link: the Skills window opens on the plan (registered with no colour of its own:
  //                    default_link_color_info)
  //   showinfo         handle_show_info_link: Show Info on the type, or on the pilot for a pilot's link
  //                    (default_with_subtle_color_info); a corporation's, an alliance's, a faction's or a place's link
  //                    the page's window does not show yet, and it is not followed
  //   http, https      handle_web_link: ExternalLinkWarning, then a tab of its own (external_link_color_info; its hint
  //                    the url)
  // Any other link is underlined with its url as its hint. A link dragged onto the send box (a skill plan's share
  // button: SkillPlanDragData.get_link) is put in at the caret as its markup.
  import { onDestroy, onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { createChatPoller } from "../app/chatPoll.ts";
  import { skipWhileBusy } from "../app/skipWhileBusy.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ChatChannel } from "../store/types.ts";
  import { resolvedName, type NameRef } from "../store/names.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { mailBodyLines } from "../bridge/mailMarkup.ts";
  import { LINK_DRAG_TYPE, parseSkillPlanUrl } from "../bridge/skillPlanLink.ts";
  import { linkScheme } from "../bridge/showInfoLink.ts";
  import { showInfo, subjectOfShowInfoLink } from "./showInfo.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";

  let { store, flow, openSkillPlanLink = null }: {
    store: ClientStore;
    flow: AppFlow;
    /** A skill plan's link in a message, clicked. */
    openSkillPlanLink?: ((url: string) => void) | null;
  } = $props();

  // svelte-ignore state_referenced_locally
  const chat = store.chat;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const live = store.live;

  // R7d — resolve each channel's identity to a NAME: Local → its solar system,
  // Corp → the corporation. Batched + cached by the flow; the raw room string
  // (local_<systemID> / corp_<corpID>) is never rendered.
  $effect(() => {
    const refs: NameRef[] = [];
    if ($chat.local.solarSystemID) {
      refs.push({ kind: "system", id: $chat.local.solarSystemID });
    }
    if ($chat.corp.corporationID) {
      refs.push({ kind: "corporation", id: $chat.corp.corporationID });
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  // R10 — messages now arrive live over the push channel, so the backlog poll
  // drops to a slow safety net while the channel is delivering and snaps back
  // to the old fast cadence whenever it is not. The poll still covers roster
  // changes (which the channel does not carry) and keeps the held session warm.
  // ⚠ GUARDED. `createChatPoller` arms a plain interval, so without this a slow
  // chat read stacks up beat on beat and the requests it displaces from the
  // browser's connection pool are the ones that visibly fail. See
  // app/skipWhileBusy.ts.
  const chatBeat = skipWhileBusy(refresh);
  const poller = createChatPoller({
    status: () => store.get().live.status,
    refresh: () => void chatBeat(),
  });
  let busy = $state(false);
  let error = $state("");
  let draft = $state("");
  let sendBox = $state<HTMLInputElement | undefined>(undefined);

  // svelte-ignore state_referenced_locally
  const words = store.words;
  /** The links' hints, the page's words where the install's are not to hand. */
  const LINK_WORDS: Readonly<Record<string, string>> = {
    "UI/SkillPlan/SkillPlan": "Skill plan",
    "UI/Commands/ShowInfo": "Show information",
  };
  function linkWord(label: string): string {
    const template = $words.templates[label];
    return plainText(formatTemplate(typeof template === "string" ? template : LINK_WORDS[label] ?? "", {}, { nameOf: () => "" }));
  }

  /** How a link in a message is followed (the client's link registry), or null where it is not. */
  function followerOf(url: string): { readonly kind: "skillPlan" | "showInfo" | "web"; readonly hint: string; readonly follow: () => void } | null {
    const scheme = linkScheme(url);
    if (scheme === "skillplan" && openSkillPlanLink !== null && parseSkillPlanUrl(url) !== null) {
      return { kind: "skillPlan", hint: linkWord("UI/SkillPlan/SkillPlan"), follow: () => openSkillPlanLink?.(url) };
    }
    if (scheme === "showinfo") {
      const subject = subjectOfShowInfoLink(url);
      return subject === null ? null : { kind: "showInfo", hint: linkWord("UI/Commands/ShowInfo"), follow: () => showInfo(subject) };
    }
    if (scheme === "http" || scheme === "https") {
      return { kind: "web", hint: url, follow: () => void flow.followWebLink(url) };
    }
    return null;
  }

  /** A link dragged over the send box is taken. */
  function linkDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes(LINK_DRAG_TYPE)) event.preventDefault();
  }

  /** A link dropped on the send box: its markup (<a href="url">text</a>, evelink.Link) put in at the caret. */
  function linkDropped(event: DragEvent): void {
    const raw = event.dataTransfer?.getData(LINK_DRAG_TYPE);
    if (!raw) return;
    event.preventDefault();
    let link: { readonly url?: unknown; readonly text?: unknown };
    try {
      link = JSON.parse(raw) as { readonly url?: unknown; readonly text?: unknown };
    } catch {
      return;
    }
    if (typeof link.url !== "string" || typeof link.text !== "string") return;
    const markup = `<a href="${link.url}">${link.text}</a>`;
    const at = sendBox?.selectionStart ?? draft.length;
    draft = draft.slice(0, at) + markup + draft.slice(at);
  }

  const CHANNELS: readonly { id: ChatChannel; label: string }[] = [
    { id: "local", label: "Local" },
    { id: "corp", label: "Corp" },
  ];

  function currentChannel(): ChatChannel {
    return store.get().chat.activeChannel;
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
    await run(() => flow.loadChat(currentChannel()));
  }

  async function switchChannel(channel: ChatChannel): Promise<void> {
    if (channel === currentChannel()) {
      return;
    }
    flow.setChatChannel(channel);
    await refresh();
  }

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text) {
      return;
    }
    const channel = currentChannel();
    await run(async () => {
      await flow.sendChatMessage(channel, text);
      draft = "";
    });
  }

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void send();
  }

  onMount(() => {
    flow.requestWords(Object.keys(LINK_WORDS));
    void refresh();
    poller.start();
  });

  // Re-arm the poll cadence when the live channel connects or drops.
  $effect(() => {
    void $live.status;
    poller.sync();
  });

  onDestroy(() => {
    // Closing the tab stops polling.
    poller.stop();
  });

  // The active channel's decoded state (roster + backlog).
  const active = $derived($chat[$chat.activeChannel]);

  // The active channel's resolved name (Local → system, Corp → corporation), or
  // "" while it resolves — the header then shows just "Local" / "Corp", never the
  // raw room string.
  const channelName = $derived(
    $chat.activeChannel === "corp"
      ? resolvedName($names.resolved, "corporation", active.corporationID, "")
      : resolvedName($names.resolved, "system", active.solarSystemID, ""),
  );
</script>

<section class="panel">
  <header class="panel-head">
    <h2 class="panel-title">Chat</h2>
  </header>
  <nav class="tabs">
    {#each CHANNELS as channel (channel.id)}
      <button
        type="button"
        class:active={$chat.activeChannel === channel.id}
        disabled={busy}
        onclick={() => switchChannel(channel.id)}
      >
        {channel.label}
      </button>
    {/each}
    <button type="button" disabled={busy} onclick={() => refresh()}>Refresh</button>
  </nav>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $chat.error}
    <p class="error">{$chat.error}</p>
  {/if}
</section>

<section>
  <h2>
    {$chat.activeChannel === "corp" ? "Corp" : "Local"}
    {#if channelName}<span class="note">· {channelName}</span>{/if}
  </h2>
  {#if !active.loaded}
    <p class="note">Loading…</p>
  {:else if $chat.activeChannel === "corp" && active.corporationID === null}
    <p class="note">This character is not in a corporation.</p>
  {:else}
    <div class="chat-grid">
      <div class="messages">
        <h3>Messages</h3>
        {#if active.messages.length === 0}
          <p class="empty">No recent messages.</p>
        {:else}
          <ul class="message-list">
            {#each active.messages as message, index (index)}
              <li>
                <span class="author">{message.characterName}</span>:
                <span class="body">{#each mailBodyLines(message.message) as line, place (place)}{#if place > 0}<br />{/if}{#each line as run, at (at)}{@const follower = run.link === null ? null : followerOf(run.link)}{#if follower !== null}<button type="button" class="chat-link {follower.kind}" title={follower.hint} onclick={follower.follow}>{run.text}</button>{:else}<span class:chat-bold={run.bold} class:chat-italic={run.italic} class:chat-underline={run.underline || run.link !== null} title={run.link ?? undefined}>{run.text}</span>{/if}{/each}{/each}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <div class="roster">
        <h3>Members ({active.roster.length})</h3>
        {#if active.roster.length === 0}
          <p class="empty">No members visible.</p>
        {:else}
          <ul class="roster-list">
            {#each active.roster as member (member.characterID)}
              <li>{member.name}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <form class="send-box" onsubmit={onSubmit}>
      <input
        type="text"
        bind:this={sendBox}
        bind:value={draft}
        ondragover={linkDragOver}
        ondrop={linkDropped}
        maxlength="4096"
        placeholder={`Message ${$chat.activeChannel === "corp" ? "Corp" : "Local"}…`}
        disabled={busy}
      />
      <button type="submit" disabled={busy || draft.trim().length === 0}>Send</button>
    </form>
  {/if}
</section>

<style>
  /* evelink/client/color.py: default_link_color_info (#d98d00, hovered #ffb732) for skill plans (registered with no
     colour of their own; link.py's link_color_info is not passed) and Show Info; external_link_color_info (#ffe400,
     hovered TextColor.HIGHLIGHT) for the web. The registry's links are bold (register: bold=True). */
  .chat-link { padding: 0; border: 0; background: none; font: inherit; font-weight: 700; color: #d98d00; cursor: pointer; }
  .chat-link:hover { color: #ffb732; }
  .chat-link.web { color: #ffe400; }
  .chat-link.web:hover { color: #ffffff; }
  .chat-bold { font-weight: 700; }
  .chat-italic { font-style: italic; }
  .chat-underline { text-decoration: underline; }
  .chat-grid {
    display: grid;
    grid-template-columns: 1fr minmax(140px, 220px);
    gap: 1rem;
    align-items: start;
  }
  .message-list,
  .roster-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 20rem;
    overflow-y: auto;
  }
  .message-list li {
    padding: 0.15rem 0;
  }
  .message-list .author {
    font-weight: 600;
  }
  .roster-list li {
    padding: 0.1rem 0;
  }
  .send-box {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .send-box input {
    flex: 1;
  }
  @media (max-width: 640px) {
    .chat-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
