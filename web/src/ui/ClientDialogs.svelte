<script lang="ts">
  // A refusal the server names a dialog for, put up as the retail client puts up a UserError
  // (eve_exception_handler.handle_exception: prompt_player_fsd_dialog(exc.msg, exc.dict); player_messaging/client/
  // dialog_handler.py, _handle_player_fsd_dialog). The dialog's type in the install says how:
  //   info, infomodal, warning, question, error, fatal, windowhelp   a box (_prompt_player): the dialog's title, or the
  //                                                                type's own word where it has none
  //                                                                (TITLE_BY_DIALOG_TYPE), its body, and OK;
  //   notify, hint, event                                          the passing strip (message_player, carbonui
  //                                                                QuickMessage): one, 300 wide at the top of the
  //                                                                middle, a newer one's text in its place, gone after
  //                                                                five seconds, not to be clicked;
  //   any other                                                    nothing (an empty type, audio).
  // Where the install has not the dialog, or the page has no install to read, a box with the page's own words. Each
  // pilot of the tab is a client of its own: one not in front is told all the same, and what it is told says which
  // pilot it is for (the page's own words, as the fleet invitation's). What is to be put up is the flow's
  // (dialogsSaid); a box is taken down by its OK, the strip by its time.
  //
  // Not done: the dialog's icon, its sound (audio.AudioMessage), its line in the client's log (logger.AddMessage), the
  // strip's place with the HUD at the top and its being dragged, and the box's holding the rest of the client still
  // (is_modal) for a pilot not in front.
  import { onDestroy, tick } from "svelte";
  import type { Session } from "../app/sessions.ts";
  import type { SaidDialog } from "../app/flow.ts";
  import type { QuestionWords } from "../store/types.ts";
  import { resolvedName, type NameKind } from "../store/names.ts";
  import { NUMERIC_WORD_LABELS, questionText, wordsLabels, wordsNameRefs, type ClientWording } from "../bridge/questions.ts";

  let { session, inFront }: { session: Session; inFront: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const words = session.store.words;
  // svelte-ignore state_referenced_locally
  const names = session.store.names;
  // svelte-ignore state_referenced_locally
  const station = session.store.station;
  // svelte-ignore state_referenced_locally
  const flow = session.flow;
  // svelte-ignore state_referenced_locally
  const said = flow.dialogsSaid;
  // svelte-ignore state_referenced_locally
  const asked = flow.quantityAsked;

  /** The client's words for its quantity question (uix.QtyPopup) and for the buttons, with the page's own. */
  const QUANTITY_WORDS: Readonly<Record<string, string>> = {
    "UI/Common/SetQuantity": "Set Quantity",
    "UI/Common/Buttons/OK": "OK",
    "UI/Common/Buttons/Cancel": "Cancel",
  };
  const wordOf = (label: string, own: string): string => {
    const template = $words.templates[label];
    return typeof template === "string" && template !== "" ? template : own;
  };

  /** The types the client puts up as a box (_prompt_player), and as the passing strip (message_player). */
  const BOX_TYPES: ReadonlySet<string> = new Set(["info", "infomodal", "warning", "question", "error", "fatal", "windowhelp"]);
  const STRIP_TYPES: ReadonlySet<string> = new Set(["notify", "hint", "event"]);
  /** TITLE_BY_DIALOG_TYPE: the type's own word for a box whose dialog has no title; Information for any other. */
  const TYPE_TITLES: Readonly<Record<string, string>> = {
    info: "UI/Common/Information",
    infomodal: "UI/Common/Information",
    warning: "UI/Generic/Warning",
    question: "UI/Common/Question",
    error: "UI/Common/Error",
    fatal: "UI/Common/Fatal",
  };
  const INFORMATION = "UI/Common/Information";
  /** The page's own words for those, where the install's are not to hand. */
  const OWN_TITLES: Readonly<Record<string, string>> = {
    "UI/Common/Information": "Information",
    "UI/Generic/Warning": "Warning",
    "UI/Common/Question": "Question",
    "UI/Common/Error": "Error",
    "UI/Common/Fatal": "Fatal",
  };
  /** How long the strip stays (QuickMessage.ShowMsg: AutoTimer(5000, self.hide)). */
  const STRIP_MS = 5000;

  const client = $derived<ClientWording>({
    templates: $words.templates,
    playerID: $station.online?.characterID ?? null,
  });
  const pilotName = $derived($station.online?.characterName ?? null);

  const partOf = (one: SaidDialog, part: "title" | "body"): QuestionWords => ({ label: null, text: null, parameters: one.values, dialog: one.dialog, part });
  const typeKey = (one: SaidDialog): string => `dialog:${one.dialog}/type`;

  // The dialogs' texts, types and names from the install, asked once each; and the types' own words for a title.
  $effect(() => {
    const parts = $said.flatMap((one) => [partOf(one, "title"), partOf(one, "body")]);
    if (parts.length === 0) {
      return;
    }
    // (And the words a dialog's numeric distance and ISK are written in: questions.ts, writeDistance and writeIsk.)
    flow.requestWords([...wordsLabels(parts), ...$said.map(typeKey), ...Object.keys(OWN_TITLES), ...NUMERIC_WORD_LABELS]);
    const refs = wordsNameRefs(parts, client);
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  function nameOf(kind: NameKind, id: number): string {
    return resolvedName($names.resolved, kind, id, `${kind} ${id}`);
  }

  /** How each is put up: not yet (its type not read), a box, the strip, or not at all. */
  type Shown = { readonly said: SaidDialog; readonly kind: "pending" | "box" | "strip" | "none"; readonly type: string | null };
  const shown = $derived<readonly Shown[]>($said.map((one) => {
    const key = typeKey(one);
    if (!(key in $words.templates)) {
      return { said: one, kind: "pending", type: null };
    }
    const type = $words.templates[key] ?? null;
    // No such dialog to be read: the page's own words, in a box.
    if (type === null) return { said: one, kind: "box", type: null };
    return { said: one, kind: BOX_TYPES.has(type) ? "box" : STRIP_TYPES.has(type) ? "strip" : "none", type };
  }));

  // What the client shows nothing of is taken down at once; of the strip's, only the newest stays (ShowMsg puts a
  // newer text in the one strip).
  $effect(() => {
    const strips = shown.filter((one) => one.kind === "strip");
    for (const one of [...shown.filter((each) => each.kind === "none"), ...strips.slice(0, -1)]) {
      flow.dismissDialog(one.said.n);
    }
  });

  const box = $derived.by(() => {
    const first = shown.find((one) => one.kind === "box");
    if (first === undefined) {
      return null;
    }
    const own = questionText(partOf(first.said, "title"), nameOf, client);
    const typeTitle = first.type === null ? INFORMATION : TYPE_TITLES[first.type] ?? INFORMATION;
    const typeWords = $words.templates[typeTitle];
    const title = own || (typeof typeWords === "string" && typeWords !== "" ? typeWords : OWN_TITLES[typeTitle] ?? "Information");
    const body = first.type === null ? first.said.fallback : questionText(partOf(first.said, "body"), nameOf, client) || first.said.fallback;
    return { said: first.said, title, body };
  });

  const strip = $derived.by(() => {
    const strips = shown.filter((one) => one.kind === "strip");
    const last = strips[strips.length - 1];
    return last === undefined ? null : { said: last.said, text: questionText(partOf(last.said, "body"), nameOf, client) || last.said.fallback };
  });

  // The strip's own time, from when its text is put in. Kept apart from the effect's runs: a run for any other change
  // of the store leaves the time as it is (the effect reads the whole store's words).
  let stripTimer: ReturnType<typeof setTimeout> | null = null;
  let stripTimed: number | null = null;
  $effect(() => {
    const n = strip === null ? null : strip.said.n;
    if (n === stripTimed) {
      return;
    }
    if (stripTimer !== null) {
      clearTimeout(stripTimer);
      stripTimer = null;
    }
    stripTimed = n;
    if (n !== null) {
      stripTimer = setTimeout(() => {
        stripTimer = null;
        flow.dismissDialog(n);
      }, STRIP_MS);
    }
  });
  onDestroy(() => {
    if (stripTimer !== null) {
      clearTimeout(stripTimer);
    }
  });

  // The quantity question (uix.QtyPopup): its words asked for, the number it begins at put in once for each question,
  // and the field taken to it with what is in it selected (setfocus, selectall).
  $effect(() => {
    const ask = $asked;
    if (ask === null) return;
    flow.requestWords([...Object.keys(QUANTITY_WORDS), ...(ask.hintLabel === null ? [] : [ask.hintLabel])]);
  });
  // (Text, not a number field: a number field's text cannot be selected, and the client's is selected to begin with.
  // Digits only, as the client's field takes them: intonly.)
  let typed = $state("");
  let typedFor: number | null = null;
  let field = $state<HTMLInputElement | null>(null);
  $effect(() => {
    const ask = $asked;
    if ((ask?.n ?? null) === typedFor) return;
    typedFor = ask?.n ?? null;
    typed = ask === null ? "" : String(ask.value);
    // Selected once its number is in it.
    void tick().then(() => field?.select());
  });
  const hintText = $derived($asked === null ? "" : $asked.hintLabel === null ? $asked.hint ?? "" : wordOf($asked.hintLabel, $asked.hint ?? ""));
  function focusAll(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }
  function answerQuantity(ok: boolean): void {
    const ask = $asked;
    if (ask === null) return;
    // A field left empty is no answer (the client's field is required).
    if (ok && !/^\d+$/.test(typed)) return;
    flow.answerQuantity(ask.n, ok ? Number(typed) : null);
  }
</script>

{#if $asked !== null}
  <div class="client-dialog-shade" class:modal={inFront}>
    <div class="client-dialog" role="dialog" aria-label={wordOf("UI/Common/SetQuantity", "Set Quantity")} data-dialog="setQuantityPopup" data-in-front={inFront}>
      <form
        class="quantity"
        onsubmit={(event) => {
          event.preventDefault();
          answerQuantity(true);
        }}
      >
        {#if !inFront && pilotName !== null}
          <span class="for-pilot">For {pilotName}</span>
        {/if}
        <strong>{wordOf("UI/Common/SetQuantity", "Set Quantity")}</strong>
        {#if hintText !== ""}<p class="body">{hintText}</p>{/if}
        <input
          type="text"
          inputmode="numeric"
          aria-label={wordOf("UI/Common/SetQuantity", "Set Quantity")}
          bind:value={typed}
          oninput={() => (typed = typed.replace(/\D+/g, ""))}
          bind:this={field}
          use:focusAll
        />
        <span class="answers">
          <button type="submit">{wordOf("UI/Common/Buttons/OK", "OK")}</button>
          <button type="button" onclick={() => answerQuantity(false)}>{wordOf("UI/Common/Buttons/Cancel", "Cancel")}</button>
        </span>
      </form>
    </div>
  </div>
{/if}

{#if box !== null}
  <div class="client-dialog-shade" class:modal={inFront}>
    <div class="client-dialog" role="alertdialog" aria-label={box.title} data-dialog={box.said.dialog} data-in-front={inFront}>
      {#if !inFront && pilotName !== null}
        <span class="for-pilot">For {pilotName}</span>
      {/if}
      <strong>{box.title}</strong>
      <p class="body">{box.body}</p>
      <span class="answers">
        <button type="button" onclick={() => flow.dismissDialog(box.said.n)}>OK</button>
      </span>
    </div>
  </div>
{/if}
{#if strip !== null}
  <div class="client-strip" role="status" data-dialog={strip.said.dialog} data-in-front={inFront}>
    {#if !inFront && pilotName !== null}<span class="for-pilot">For {pilotName}</span>{/if}
    <span class="strip-text">{strip.text}</span>
  </div>
{/if}

<style>
  .client-dialog-shade { position: fixed; inset: 0; z-index: 45; display: flex; align-items: center; justify-content: center;
    pointer-events: none; }
  .client-dialog-shade.modal { pointer-events: auto; background: rgba(0, 0, 0, 0.25); }
  .client-dialog { pointer-events: auto; display: flex; flex-direction: column; gap: 0.6rem; width: min(26rem, calc(100vw - 2rem));
    padding: 0.75rem 1rem; background: #14273a; color: #d6e6f7; border: 1px solid #3c6f9e; }
  .body { margin: 0; white-space: pre-line; }
  /* The client's label starts a new line at each line break in its text (trinity, Tr2LabelTextParser.cpp 360 to 375). */
  .strip-text { white-space: pre-line; }
  .answers { display: flex; justify-content: flex-end; gap: 0.4rem; }
  .quantity { display: contents; }
  input { background: #0d1b29; color: inherit; border: 1px solid #3c6f9e; padding: 0.2rem 0.4rem; }
  button { border: 1px solid #5b93c7; background: #1b3956; color: inherit; padding: 0.2rem 1rem; cursor: pointer; }
  .for-pilot { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
  .client-strip { position: fixed; top: max(20vh, 175px); left: 50%; transform: translateX(-50%); width: 300px; z-index: 44;
    padding: 8px; box-sizing: border-box; text-align: center; pointer-events: none; background: rgba(10, 18, 28, 0.85);
    color: #d6e6f7; border: 1px solid rgba(91, 147, 199, 0.4); }
  .client-strip .for-pilot { display: block; }
</style>
