<script lang="ts">
  // THE LOG (goal R80) — everything the toasts showed, kept.
  //
  // The permanent half of the same list. A toast is on screen for seven seconds;
  // this is where a player looks when they were reading something else at the
  // time, which for a bot run is most of the time.
  //
  // Newest first, because the question is almost always "what just happened".
  import { noticeBoard } from "./notices.ts";

  const notices = noticeBoard.notices;

  const newestFirst = $derived([...$notices].reverse());

  /** A wall-clock time for a log line. Local, unlike the Neocom's EVE clock —
   *  this is "when did this happen to me", not a time to quote to a fleet. */
  function at(atMs: number): string {
    const date = new Date(atMs);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function kindWord(kind: string): string {
    return kind === "danger" ? "Alert" : kind === "warn" ? "Warning" : kind === "good" ? "Done" : "Note";
  }
</script>

<section class="notice-log">
  <div class="panel-head">
    <h2>Log</h2>
    <span class="controls">
      <button type="button" class="minor" disabled={$notices.length === 0} onclick={() => noticeBoard.clear()}>
        Clear
      </button>
    </span>
  </div>

  {#if newestFirst.length === 0}
    <p class="empty">Nothing has happened yet.</p>
  {:else}
    <ul class="notice-list">
      {#each newestFirst as notice (notice.id)}
        <li class={`notice ${notice.kind}`}>
          <span class="notice-time">{at(notice.atMs)}</span>
          <!-- The severity as a WORD. The row's colour repeats it; it never
               carries it alone. -->
          <span class="notice-kind">{kindWord(notice.kind)}</span>
          <span class="notice-text">
            <span class="notice-title">{notice.title}</span>
            {#if notice.detail}
              <span class="notice-detail">{notice.detail}</span>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
