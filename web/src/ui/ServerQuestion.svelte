<script lang="ts">
  // A question the SERVER has asked and is waiting on: the retail client's
  // Yes/No window. Mounted once for the whole workspace, because the question
  // belongs to the pilot and not to whichever panel happened to cause it. The
  // server waits until it is answered or its time runs out; closing the tab
  // answers nothing, and the question lapses as a No.
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { questionText } from "../bridge/questions.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const live = store.live;

  let answering = $state<string | null>(null);
  let error = $state("");

  async function answer(questionID: string, yes: boolean): Promise<void> {
    if (answering !== null) {
      return;
    }
    answering = questionID;
    error = "";
    try {
      await flow.answerQuestion(questionID, yes);
    } catch (cause) {
      error = panelErrorWords(cause);
    } finally {
      answering = null;
    }
  }
</script>

{#each $live.questions as question (question.id)}
  <div class="server-question" role="alertdialog" aria-label={questionText(question.title)} data-question-id={question.id}>
    <strong>{questionText(question.title)}</strong>
    <span class="body">{questionText(question.body)}</span>
    <span class="answers">
      <button type="button" disabled={answering !== null} onclick={() => void answer(question.id, true)}>Yes</button>
      <button type="button" disabled={answering !== null} onclick={() => void answer(question.id, false)}>No</button>
    </span>
    {#if error}
      <span class="error" role="alert">{error}</span>
    {/if}
  </div>
{/each}

<style>
  .server-question { display: flex; gap: 0.65rem; align-items: center; flex-wrap: wrap;
    padding: 0.5rem 0.75rem; background: #14273a; color: #d6e6f7; border: 1px solid #3c6f9e; }
  .body { flex: 1 1 20rem; }
  .answers { display: flex; gap: 0.4rem; }
  button { border: 1px solid #5b93c7; background: #1b3956; color: inherit; padding: 0.2rem 0.75rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .error { color: #f3b0a8; flex-basis: 100%; }
</style>
