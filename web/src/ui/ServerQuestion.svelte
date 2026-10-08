<script lang="ts">
  // A question the SERVER has asked and is waiting on: the retail client's
  // Yes/No window, its radio-button box or its number box. Mounted once for
  // the whole workspace, because the question belongs to the pilot and not to
  // whichever panel happened to cause it. The server waits until it is
  // answered or its time runs out; closing the tab answers nothing, and the
  // question lapses as a No or a Cancel.
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientQuestion, QuestionAnswer } from "../store/types.ts";
  import { resolvedName, type NameKind } from "../store/names.ts";
  import { answerFits, questionNameRefs, questionText } from "../bridge/questions.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const live = store.live;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let answering = $state<string | null>(null);
  let error = $state("");
  // What the user has picked or typed so far, by question: a choice's index, a number box's text.
  let picked = $state<Record<string, number>>({});
  let typed = $state<Record<string, string>>({});

  // The names the questions' words are about (a skill, a datacore, contraband, a faction).
  $effect(() => {
    const refs = $live.questions.flatMap((question) => questionNameRefs(question));
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  function nameOf(kind: NameKind, id: number): string {
    return resolvedName($names.resolved, kind, id, `${kind} ${id}`);
  }

  function typedNumber(question: ClientQuestion): number | null {
    const text = (typed[question.id] ?? String(question.quantity?.initial ?? "")).trim();
    const value = text === "" ? Number.NaN : Number(text);
    return Number.isFinite(value) ? value : null;
  }

  async function answer(question: ClientQuestion, given: QuestionAnswer): Promise<void> {
    if (answering !== null) {
      return;
    }
    if (!answerFits(question, given)) {
      error = "That is not an answer this question takes.";
      return;
    }
    answering = question.id;
    error = "";
    try {
      await flow.answerQuestion(question.id, given);
    } catch (cause) {
      error = panelErrorWords(cause);
    } finally {
      answering = null;
    }
  }
</script>

{#each $live.questions as question (question.id)}
  <div
    class="server-question"
    role="alertdialog"
    aria-label={questionText(question.title, nameOf) || questionText(question.body, nameOf)}
    data-question-id={question.id}
    data-question-kind={question.kind}
  >
    {#if questionText(question.title, nameOf)}
      <strong>{questionText(question.title, nameOf)}</strong>
    {/if}
    <span class="body">{questionText(question.body, nameOf)}</span>
    {#if question.kind === "choice"}
      <span class="choices" role="radiogroup">
        {#each question.choices as choice, index (index)}
          <label>
            <input
              type="radio"
              name={`question-${question.id}`}
              checked={(picked[question.id] ?? 0) === index}
              onchange={() => (picked = { ...picked, [question.id]: index })}
            />
            {questionText(choice, nameOf)}
          </label>
        {/each}
      </span>
      <span class="answers">
        <button type="button" disabled={answering !== null}
          onclick={() => void answer(question, { confirmed: true, index: picked[question.id] ?? 0 })}>OK</button>
        <button type="button" disabled={answering !== null}
          onclick={() => void answer(question, { confirmed: false, index: picked[question.id] ?? 0 })}>Cancel</button>
      </span>
    {:else if question.kind === "quantity" && question.quantity}
      <input
        class="quantity"
        type="number"
        min={question.quantity.min}
        max={question.quantity.max ?? undefined}
        step={question.quantity.digits > 0 ? "any" : 1}
        value={typed[question.id] ?? String(question.quantity.initial ?? "")}
        oninput={(event) => (typed = { ...typed, [question.id]: (event.currentTarget as HTMLInputElement).value })}
      />
      <span class="note">
        {question.quantity.max === null
          ? `${question.quantity.min.toLocaleString("en-US")} or more`
          : `${question.quantity.min.toLocaleString("en-US")} to ${question.quantity.max.toLocaleString("en-US")}`}
      </span>
      <span class="answers">
        <button type="button" disabled={answering !== null || typedNumber(question) === null}
          onclick={() => void answer(question, typedNumber(question))}>OK</button>
        <button type="button" disabled={answering !== null} onclick={() => void answer(question, null)}>Cancel</button>
      </span>
    {:else}
      <span class="answers">
        <button type="button" disabled={answering !== null} onclick={() => void answer(question, true)}>Yes</button>
        <button type="button" disabled={answering !== null} onclick={() => void answer(question, false)}>No</button>
      </span>
    {/if}
    {#if error}
      <span class="error" role="alert">{error}</span>
    {/if}
  </div>
{/each}

<style>
  .server-question { display: flex; gap: 0.65rem; align-items: center; flex-wrap: wrap;
    padding: 0.5rem 0.75rem; background: #14273a; color: #d6e6f7; border: 1px solid #3c6f9e; }
  .body { flex: 1 1 20rem; }
  .choices { display: flex; flex-direction: column; gap: 0.2rem; flex-basis: 100%; }
  .quantity { width: 8rem; background: #0e1c2b; color: inherit; border: 1px solid #5b93c7; padding: 0.2rem 0.4rem; }
  .note { opacity: 0.75; }
  .answers { display: flex; gap: 0.4rem; }
  button { border: 1px solid #5b93c7; background: #1b3956; color: inherit; padding: 0.2rem 0.75rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .error { color: #f3b0a8; flex-basis: 100%; }
</style>
