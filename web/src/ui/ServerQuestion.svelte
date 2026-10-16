<script lang="ts">
  // A question the SERVER has asked and is waiting on: the retail client's
  // Yes/No window, its radio-button box or its number box. Mounted once for
  // the whole workspace, because the question belongs to the pilot and not to
  // whichever panel happened to cause it. The server waits until it is
  // answered or its time runs out; closing the tab answers nothing, and the
  // question lapses as a No or a Cancel.
  //
  // A question that is one of the install's dialogs (XmppChat.AskYesNoQuestion) waits until its type is read, and is
  // titled with the dialog's title or its type's own word (TITLE_BY_DIALOG_TYPE). Its box "Do Not Ask Again" is shown
  // where the install marks the dialog suppressable; an agent's question with a suppressID has the agent's box
  // (bridge/questions.ts). Answered with the box ticked, the answer is kept by the question's rule (keptValueOf), and
  // the question is answered with it, unshown, the next time (the flow, as a question arrives).
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientQuestion, QuestionAnswer } from "../store/types.ts";
  import { resolvedName, type NameKind } from "../store/names.ts";
  import {
    DIALOG_TYPE_TITLES, INFORMATION_TITLE, OWN_DIALOG_TITLES, SUPPRESSION_SHOW_MESSAGE, SUPPRESSION_SHOW_MESSAGE_REMEMBER,
    answerFits, keptValueOf, questionDialog, questionKeeping, questionNameRefs, questionText, wordsLabels, type ClientWording,
  } from "../bridge/questions.ts";
  import { DO_NOT_ASK_AGAIN_LABEL, suppressKey, suppressableKey } from "../bridge/dialogSuppression.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const live = store.live;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const station = store.station;

  // The retail client's own text for the labels, when the BFF has a client to read.
  const client = $derived<ClientWording>({
    templates: $words.templates,
    playerID: $station.online?.characterID ?? null,
  });

  let answering = $state<string | null>(null);
  let error = $state("");
  // What the user has picked or typed so far, by question: a choice's index, a number box's text; and the box ticked.
  let picked = $state<Record<string, number>>({});
  let typed = $state<Record<string, string>>({});
  let suppressTicked = $state<Record<string, boolean>>({});

  const typeKey = (dialog: string): string => `dialog:${dialog}/type`;

  // The client's text for the questions' labels, and the names their words are about (a skill, a datacore,
  // contraband, a faction); a dialog's type and whether it may be kept, and the boxes' and titles' own words.
  $effect(() => {
    const labels = wordsLabels($live.questions.flatMap((question) => [question.title, question.body, ...question.choices]));
    const dialogs = $live.questions.map(questionDialog).filter((dialog): dialog is string => dialog !== null);
    const kept = $live.questions.some((question) => questionKeeping(question) !== null);
    const asked = [
      ...labels,
      ...dialogs.flatMap((dialog) => [typeKey(dialog), suppressableKey(dialog), suppressKey(dialog)]),
      ...(dialogs.length > 0 ? Object.keys(OWN_DIALOG_TITLES) : []),
      ...(kept ? [DO_NOT_ASK_AGAIN_LABEL, SUPPRESSION_SHOW_MESSAGE, SUPPRESSION_SHOW_MESSAGE_REMEMBER] : []),
    ];
    if (asked.length > 0) {
      flow.requestWords(asked);
    }
    const refs = $live.questions.flatMap((question) => questionNameRefs(question, client));
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  function nameOf(kind: NameKind, id: number): string {
    return resolvedName($names.resolved, kind, id, `${kind} ${id}`);
  }

  /** A label's words from the install, or the page's own where they are not to hand. */
  function wordOf(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" && template !== "" ? plainText(template) : own;
  }

  /** A dialog's question waits until its type is read (or found missing), as the client cannot put it up before. */
  function pending(question: ClientQuestion): boolean {
    const dialog = questionDialog(question);
    return dialog !== null && !(typeKey(dialog) in $words.templates);
  }

  /** The title: the question's own, else, for a dialog, its type's word (_prompt_player, 107 to 109). */
  function titleOf(question: ClientQuestion): string {
    const own = questionText(question.title, nameOf, client);
    const dialog = questionDialog(question);
    if (own || dialog === null) return own;
    const type = $words.templates[typeKey(dialog)];
    const label = typeof type === "string" ? DIALOG_TYPE_TITLES[type] ?? INFORMATION_TITLE : INFORMATION_TITLE;
    return wordOf(label, OWN_DIALOG_TITLES[label] ?? "Information");
  }

  /** The box's words where the question has one: a suppressable dialog's, or the agent's. Null for none. */
  function suppressBox(question: ClientQuestion): string | null {
    const keeping = questionKeeping(question);
    if (keeping === null) return null;
    if (keeping.kind === "dialog") {
      return $words.templates[suppressableKey(keeping.key)] === "1" ? wordOf(DO_NOT_ASK_AGAIN_LABEL, "Don't ask this again") : null;
    }
    return keeping.kind === "agentYesNo"
      ? wordOf(SUPPRESSION_SHOW_MESSAGE, "Don't show this again")
      : wordOf(SUPPRESSION_SHOW_MESSAGE_REMEMBER, "Keep this answer");
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
      // The box ticked: the answer kept where the question's rule lets it be.
      const keeping = questionKeeping(question);
      if (keeping !== null && suppressTicked[question.id] === true && suppressBox(question) !== null) {
        const dialogSuppress = keeping.kind === "dialog" ? $words.templates[suppressKey(keeping.key)] : null;
        const value = keptValueOf(question, given, dialogSuppress);
        if (value !== null) flow.keepQuestionAnswer(keeping.key, value);
      }
    } catch (cause) {
      error = panelErrorWords(cause);
    } finally {
      answering = null;
    }
  }
</script>

{#each $live.questions.filter((question) => !pending(question)) as question (question.id)}
  {@const title = titleOf(question)}
  {@const box = suppressBox(question)}
  <div
    class="server-question"
    role="alertdialog"
    aria-label={title || questionText(question.body, nameOf, client)}
    data-question-id={question.id}
    data-question-kind={question.kind}
  >
    {#if title}
      <strong>{title}</strong>
    {/if}
    <span class="body">{questionText(question.body, nameOf, client)}</span>
    {#if box !== null}
      <label class="suppress">
        <input
          type="checkbox"
          checked={suppressTicked[question.id] === true}
          onchange={(event) => (suppressTicked = { ...suppressTicked, [question.id]: (event.currentTarget as HTMLInputElement).checked })}
        />
        {box}
      </label>
    {/if}
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
            {questionText(choice, nameOf, client)}
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
  .body { flex: 1 1 20rem; white-space: pre-line; }
  .choices { display: flex; flex-direction: column; gap: 0.2rem; flex-basis: 100%; }
  .quantity { width: 8rem; background: #0e1c2b; color: inherit; border: 1px solid #5b93c7; padding: 0.2rem 0.4rem; }
  .note { opacity: 0.75; }
  .suppress { flex-basis: 100%; display: flex; gap: 0.35rem; align-items: center; opacity: 0.85; }
  .answers { display: flex; gap: 0.4rem; }
  button { border: 1px solid #5b93c7; background: #1b3956; color: inherit; padding: 0.2rem 0.75rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .error { color: #f3b0a8; flex-basis: 100%; }
</style>
