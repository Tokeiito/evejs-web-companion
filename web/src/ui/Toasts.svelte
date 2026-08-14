<script lang="ts">
  // THE TOAST STACK (goal R80) — what just happened, top right, briefly.
  //
  // Mounted once by the workspace and fed by `notify()` from anywhere, so an
  // event that happens inside a panel the player has CLOSED still reaches them.
  // Every toast also lands in the log window permanently; a toast is just a
  // recent notice that has not been dismissed.
  //
  // ⚠ IT DOES NOT STEAL FOCUS OR BLOCK ANYTHING. A pilot is usually mid-action
  // when one of these fires. The stack is `pointer-events: none` except for the
  // dismiss buttons themselves, so a toast can never swallow a click meant for
  // the thing underneath it.
  import { noticeBoard, visibleToasts, TOAST_MS } from "./notices.ts";

  const notices = noticeBoard.notices;
  const dismissed = noticeBoard.dismissed;

  /**
   * A clock, so a toast retires on time.
   *
   * ⚠ IT ONLY TICKS WHILE THERE IS SOMETHING TO RETIRE. An unconditional
   * interval would re-render this component every 500 ms for the entire session
   * to draw an empty list — a cost that never shows up in a profile anyone runs,
   * for no visible effect whatsoever.
   */
  let nowMs = $state(Date.now());
  const anyLive = $derived(
    $notices.some((notice) => Date.now() - notice.atMs < TOAST_MS && !$dismissed.has(notice.id)),
  );
  $effect(() => {
    if (!anyLive) {
      return;
    }
    const handle = setInterval(() => {
      nowMs = Date.now();
    }, 500);
    return () => clearInterval(handle);
  });

  const shown = $derived(visibleToasts($notices, $dismissed, nowMs));
</script>

{#if shown.length > 0}
  <!-- role=log + aria-live=polite: announced without interrupting whatever the
       player is doing. `assertive` would cut across a screen reader mid-sentence
       for something that is, by design, not modal. -->
  <div class="toasts" role="log" aria-live="polite" aria-label="Recent events">
    {#each shown as notice (notice.id)}
      <div class={`toast ${notice.kind}`}>
        <div class="toast-body">
          <!-- The kind is spelled out as a word, so the colour is reinforcement
               and never the only thing carrying the severity. -->
          <span class="toast-kind">{notice.kind === "danger" ? "Alert" : notice.kind === "warn" ? "Warning" : notice.kind === "good" ? "Done" : "Note"}</span>
          <span class="toast-title">{notice.title}</span>
          {#if notice.detail}
            <span class="toast-detail">{notice.detail}</span>
          {/if}
        </div>
        <button
          type="button"
          class="toast-close"
          title="Dismiss"
          aria-label={`Dismiss: ${notice.title}`}
          onclick={() => noticeBoard.dismiss(notice.id)}
        >✕</button>
      </div>
    {/each}
  </div>
{/if}
