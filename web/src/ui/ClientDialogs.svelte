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
  // A box whose dialog the install lets be kept has the client's checkbox (messagebox.py prompt_player, 158 to 168:
  // Do Not Show Again under OK alone, Do Not Ask Again under a question); answered with it ticked, the answer is kept
  // where the dialog lets that answer be kept, and the dialog is not put up again (dialog_handler.py, 59 to 64 and
  // _persist_prompt_suppress_choice, 126 to 132; bridge/dialogSuppression.ts).
  //
  // Not done: the dialog's icon, its sound (audio.AudioMessage), its line in the client's log (logger.AddMessage), the
  // strip's place with the HUD at the top and its being dragged, and the box's holding the rest of the client still
  // (is_modal) for a pilot not in front.
  import { onDestroy, tick } from "svelte";
  import { DO_NOT_ASK_AGAIN_LABEL, DO_NOT_SHOW_AGAIN_LABEL, answerKept, suppressKey } from "../bridge/dialogSuppression.ts";
  import type { Session } from "../app/sessions.ts";
  import type { SaidDialog } from "../app/flow.ts";
  import type { QuestionWords } from "../store/types.ts";
  import { resolvedName, type NameKind } from "../store/names.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { romanLevel } from "../bridge/skills.ts";
  import {
    DIALOG_TYPE_TITLES, INFORMATION_TITLE, NUMERIC_WORD_LABELS, OWN_DIALOG_TITLES, iskWords, questionText, wordsLabels, wordsNameRefs,
    type ClientWording,
  } from "../bridge/questions.ts";
  import { SHORT_INTERVAL_WORD_LABELS, intervalWriters, shortWrittenInterval } from "../bridge/timeInterval.ts";
  import { showMarketDetails } from "./marketDetails.ts";
  import type { SkillRowMark } from "../bridge/missingSkills.ts";
  import TypeIcon from "./TypeIcon.svelte";

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
  // svelte-ignore state_referenced_locally
  const skillsRequired = flow.skillsRequired;
  // svelte-ignore state_referenced_locally
  const shipNameAsked = flow.shipNameAsked;
  // svelte-ignore state_referenced_locally
  const skillBooksAsked = flow.skillBooksAsked;
  // svelte-ignore state_referenced_locally
  const applyPointsAsked = flow.applyPointsAsked;

  /** The client's words for its quantity question (uix.QtyPopup) and for the buttons, with the page's own. */
  const QUANTITY_WORDS: Readonly<Record<string, string>> = {
    "UI/Common/SetQuantity": "Set Quantity",
    "UI/Common/Buttons/OK": "OK",
    "UI/Common/Buttons/Cancel": "Cancel",
  };
  /** A question's two answers (uiconst.YESNO), in the client's words. */
  const ANSWER_WORDS: Readonly<Record<string, string>> = {
    "UI/Common/Buttons/Yes": "Yes",
    "UI/Common/Buttons/No": "No",
  };
  const wordOf = (label: string, own: string): string => {
    const template = $words.templates[label];
    return typeof template === "string" && template !== "" ? template : own;
  };

  /** The types the client puts up as a box (_prompt_player), and as the passing strip (message_player). */
  const BOX_TYPES: ReadonlySet<string> = new Set(["info", "infomodal", "warning", "question", "error", "fatal", "windowhelp"]);
  const STRIP_TYPES: ReadonlySet<string> = new Set(["notify", "hint", "event"]);
  /** TITLE_BY_DIALOG_TYPE: the type's own word for a box whose dialog has no title; Information for any other. */
  const TYPE_TITLES = DIALOG_TYPE_TITLES;
  const INFORMATION = INFORMATION_TITLE;
  /** The page's own words for those, where the install's are not to hand. */
  const OWN_TITLES = OWN_DIALOG_TITLES;
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
    flow.requestWords([
      ...wordsLabels(parts), ...$said.map(typeKey), ...$said.map((one) => suppressKey(one.dialog)), ...Object.keys(OWN_TITLES), ...NUMERIC_WORD_LABELS,
      ...Object.keys(ANSWER_WORDS), DO_NOT_SHOW_AGAIN_LABEL, DO_NOT_ASK_AGAIN_LABEL,
    ]);
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
    // A question waits on its answer: a box, whatever its type.
    if (one.answers === "yesno") return { said: one, kind: "box", type };
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
    const suppress = $words.templates[suppressKey(first.said.dialog)];
    return { said: first.said, title, body, suppress: typeof suppress === "string" ? suppress : null };
  });
  // The box's checkbox, unticked for each box put up.
  let keepTicked = $state(false);
  let keepTickedFor: number | null = null;
  $effect(() => {
    const n = box === null ? null : box.said.n;
    if (n === keepTickedFor) return;
    keepTickedFor = n;
    keepTicked = false;
  });
  /** The box answered: OK, Yes or No; the answer kept where the checkbox is ticked and the dialog lets it be kept. */
  function answerBox(answer: "ok" | "yes" | "no"): void {
    const shownBox = box;
    if (shownBox === null) return;
    if (keepTicked && answerKept(shownBox.suppress, answer)) flow.keepDialogAnswer(shownBox.said.dialog, answer);
    if (answer === "ok") flow.dismissDialog(shownBox.said.n);
    else flow.answerDialog(shownBox.said.n, answer === "yes");
  }

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
  // The client's skill requirement window (skillRequirementDialog.py): the type's icon and name, what it would be
  // used for, how many skills and levels are missing and how many books, each skill at its level with its mark and its
  // five boxes (skill_requirement.py RequiredSkillRow, the skill bar), the training time (AddTrainingTimeForType), the
  // points the levels cost and Train Skills (AddSkillAction, skillBtns.py), and its one button. Its words are the
  // install's; the page's own stand in where they are not to hand. Not done: Buy and train (its window,
  // MissingSkillbooksWnd), the points-applying and skill plan buttons, an alpha clone's Upgrade button, the rows'
  // menus, drags and info.
  const SKILL_WINDOW_WORDS: Readonly<Record<string, string>> = {
    "Tooltips/SkillPlanner/OmegaTrainingTime": "Time to train it (omega)",
    "Tooltips/SkillPlanner/TrainingTime": "Time to train it",
    "Tooltips/SkillPlanner/TrainingComplete": "Trained",
    "UI/Skills/SkillPointsRequired": "Points it takes",
    "UI/Skills/TrainSkills": "Train them",
    "Tooltips/SkillPlanner/AddAllSkillsToQueueButton": "Put them all in the queue",
    "Tooltips/SkillPlanner/AddAllSkillsToQueueButtonFinished": "They are all in the queue",
    "UI/SkillQueue/SkillBookMissing": "The book is not injected",
    "UI/SkillQueue/RareSkillBookMissing": "The book is not injected, and is not sold",
    "UI/InfoWindow/SkillNotTrainedToRequiredLevel": "Short of the level needed",
    "UI/Skills/BuyAndTrain": "Buy them and train",
    "UI/Skills/ErrorRareSkill": "This book is not sold directly",
    "UI/Skills/ErrorRareRequirements": "A book this needs is not sold directly",
    "UI/Generic/Information": "Information",
    "Tooltips/SkillPlanner/SkillsRequiredToPerformActivity": "Skills needed to {doActivity}",
    "Tooltips/SkillPlanner/ActivityFlyShip": "fly it",
    "Tooltips/SkillPlanner/SkillsAndSkillLevels": "{numSkills} skills to train, {numLevels} levels in all",
    "Tooltips/SkillPlanner/MissingSkillBooks": "({numMissingBooks} not owned)",
    "UI/InfoWindow/RequiredSkillNameAndLevel": "{[item]skill.name} {level}",
    "Achievements/AuraText/laterButton": "Not now",
  };
  $effect(() => {
    const open = $skillsRequired;
    if (open === null) return;
    flow.requestWords([...Object.keys(SKILL_WINDOW_WORDS), ...SHORT_INTERVAL_WORD_LABELS]);
    flow.requestNames([{ kind: "type", id: open.typeID }, ...open.skills.map(([skill]) => ({ kind: "type" as const, id: skill }))]);
  });
  /** RequiredSkillRow's hint for each mark. */
  const SKILL_MARK_LABELS: Readonly<Record<Exclude<SkillRowMark, null>, string>> = {
    "book-missing": "UI/SkillQueue/SkillBookMissing",
    "rare-book-missing": "UI/SkillQueue/RareSkillBookMissing",
    "level-short": "UI/InfoWindow/SkillNotTrainedToRequiredLevel",
  };
  /**
   * A training time as the window writes it (FormatTimeIntervalShortWritten(time, showTo=TIME_CATEGORY_MINUTE)), in
   * the install's words; the page's own where they are not to hand. None is the window's Training Complete.
   */
  function trainingTime(ticks: number | null): string {
    if (ticks === null || !(ticks > 0)) return skillWord("Tooltips/SkillPlanner/TrainingComplete");
    const written = shortWrittenInterval(BigInt(Math.trunc(ticks)), $words.templates, "year", "minute");
    if (written !== null) return written;
    const minutes = Math.ceil(ticks / 600_000_000);
    const [days, hours, mins] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
    return [days > 0 ? `${days}d` : "", hours > 0 ? `${hours}h` : "", mins > 0 || minutes === 0 ? `${mins}m` : ""].filter(Boolean).join(" ");
  }
  // The client's books window (characterskills/client/UI/missingSkillbooksWnd.py), which Buy and train opens: its
  // title; the books sold, each by name, with what they cost and Buy and Inject; the books not sold, by name, under a
  // heading of their own; each heading's skill book and its hint; and its close. Its words are the install's; the
  // page's own stand in. Not done: Check on Market (the client's multibuy window) and the skill plan button.
  const SKILL_BOOK_WORDS: Readonly<Record<string, string>> = {
    "UI/SkillPlan/MissingSkillbooksWindow/ConfirmPurchaseTitle": "Buy skill books",
    "UI/SkillPlan/MissingSkillbooksWindow/AvailableForRemoteInjection": "Sold for injection at once",
    "UI/SkillPlan/MissingSkillbooksWindow/UnavailableForRemoteInjection": "Not sold for injection at once",
    "UI/SkillPlan/MissingSkillbooksWindow/PriceLabel": "Cost: {[numeric]cost.isk}",
    "UI/SkillPlan/MissingSkillbooksWindow/BuyAndInjectButton": "Buy and inject",
    "UI/SkillPlan/MissingSkillbooksWindow/BuyAndInjectTooltip": "Buy each book listed here and inject it now",
    "UI/SkillPlan/MissingSkillbooksWindow/RemoteInjectionTooltip": "Books bought this way are injected where the pilot is, with no book to carry.",
  };
  $effect(() => {
    if ($skillBooksAsked === null) return;
    flow.requestWords([...Object.keys(SKILL_BOOK_WORDS), ...NUMERIC_WORD_LABELS]);
    flow.requestNames([...$skillBooksAsked.available, ...$skillBooksAsked.unavailable].map((id) => ({ kind: "type" as const, id })));
  });
  /** A label of the books window filled with `args`, as plain text, its ISK in the client's words. */
  function bookWord(label: string, args: Readonly<Record<string, string | number>> = {}): string {
    return plainText(formatTemplate(wordOf(label, SKILL_BOOK_WORDS[label] ?? ""), args, {
      nameOf,
      writeIsk: (amount, decimalPlaces) => iskWords(amount, decimalPlaces, $words.templates, nameOf),
    }));
  }
  /** inventorycommon.const typeSkillInjector: what the apply-points button's market details are of, without free points. */
  const TYPE_SKILL_INJECTOR = 40520;
  // The skill requirement window's apply-points button (skillBtns.ApplySkillPointsButton) and the client's Apply Skill
  // Points window it opens where the pilot has free points (skilltrading/applySkillPointsWindow.py): its title and
  // words, each level a row with its gauges (trained, and with the points), the time saved and the percentages, and
  // Confirm and Cancel, then Close. Its words are the install's; the page's own stand in. Not done: the rows' group
  // icons and their book marks, the gauges' animation, and the button for an alpha clone with no free points (the
  // client's store, which this server has not).
  const APPLY_WORDS: Readonly<Record<string, string>> = {
    "UI/SkillQueue/ApplySkillPoints": "Put free points into these",
    "UI/Market/MarketQuote/BuyType": "Shop for {[item]typeID.name}",
    "UI/SkillTrading/ApplySkillPointsWindowCaption": "Free skill points",
    "UI/SkillTrading/ApplySkillPointsDescription": "{[numeric]points, useGrouping, decimalPlaces=0} free points go to {amount} levels.",
    "UI/SkillTrading/ConfirmInjectionLabel": "Apply",
    "UI/SkillTrading/CancelInjectionLabel": "Not now",
    "UI/SkillTrading/CloseInjectionLabel": "Done",
    "UI/SkillTrading/EstimatedSkillTimeSaved": "About {[timeinterval]timeSaved.shortWrittenForm, from=\"day\", to=\"minute\"} less to train",
    "UI/SkillTrading/SkillProgressLabel": "{progress}% to {progressWithFreePoints}%",
  };
  $effect(() => {
    if ($skillsRequired === null && $applyPointsAsked === null) return;
    flow.requestWords([...Object.keys(APPLY_WORDS), ...SHORT_INTERVAL_WORD_LABELS]);
    if ($applyPointsAsked !== null) flow.requestNames($applyPointsAsked.entries.map((entry) => ({ kind: "type" as const, id: entry.skill })));
    else flow.requestNames([{ kind: "type", id: TYPE_SKILL_INJECTOR }]);
  });
  /** A label of the apply-points button or its window, filled with `args`, as plain text. */
  function applyWord(label: string, args: Readonly<Record<string, string | number>> = {}): string {
    return plainText(formatTemplate(wordOf(label, APPLY_WORDS[label] ?? ""), args, {
      nameOf,
      ...intervalWriters($words.templates),
    }));
  }
  /** round(x * 100, 1), as the window's percentages are. */
  const percent = (fraction: number): number => Math.round(fraction * 1000) / 10;
  /**
   * The apply-points button (ApplySkillPointsButton.UpdateState and ClickFunc): with free points it puts them into the
   * levels, offered where no book is missing; without, an omega clone's opens the Skill Injector's market details.
   */
  function applyPointsButton(open: { readonly freeSkillPoints: number; readonly offerInjection: boolean; readonly omega: boolean }): { readonly hint: string; readonly enabled: boolean; readonly use: () => void } | null {
    if (open.freeSkillPoints > 0) {
      return { hint: applyWord("UI/SkillQueue/ApplySkillPoints"), enabled: open.offerInjection, use: () => void flow.applySkillPointsRequired().catch(() => {}) };
    }
    if (!open.omega) return null;
    return {
      hint: applyWord("UI/Market/MarketQuote/BuyType", { typeID: TYPE_SKILL_INJECTOR }),
      enabled: true,
      use: () => {
        flow.dismissSkillsRequired();
        showMarketDetails(TYPE_SKILL_INJECTOR);
      },
    };
  }
  /** eveformat.number: whole, grouped by thousands. */
  const groupedNumber = (value: number): string => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  /** A label of the window filled with `args`, as plain text. */
  function skillWord(label: string, args: Readonly<Record<string, string | number>> = {}): string {
    return plainText(formatTemplate(wordOf(label, SKILL_WINDOW_WORDS[label] ?? ""), args, { nameOf }));
  }
  // The client's ship naming window (shipNameDialog.py): its title, the field (32 letters at most, counted) with the
  // ship's type and the pilot's name as its hint, the line asking why, Do Not Ask Again, Confirm and Later. Confirm
  // takes the field, or the hint where it is empty, on one line and trimmed. Its words are the install's; the page's
  // own stand in where they are not to hand. Not done: the why line's tooltip, the sounds.
  const SHIP_NAME_WORDS: Readonly<Record<string, string>> = {
    "UI/Ship/NameChange/WindowTitle": "Ship name",
    "UI/Ship/NameChange/InputFieldLabel": "Name",
    "UI/Ship/NameChange/InfoLabel": "A name of your own for this ship",
    "UI/Inflight/OwnerAndShip": "{[item]shipTypeID.rawName} of {[character]charID.name}",
    "UI/Common/Confirm": "OK",
    "UI/Common/Later": "Not now",
  };
  /** A word of the naming window: the install's, or the page's own. */
  const shipWord = (label: string): string => wordOf(label, SHIP_NAME_WORDS[label] ?? "");
  let shipNameTyped = $state("");
  let shipNameFor: number | null = null;
  let shipNameKeep = $state(false);
  $effect(() => {
    const ask = $shipNameAsked;
    if ((ask?.n ?? null) === shipNameFor) return;
    shipNameFor = ask?.n ?? null;
    shipNameTyped = ask?.currentName ?? "";
    shipNameKeep = false;
    if (ask === null) return;
    flow.requestWords([...Object.keys(SHIP_NAME_WORDS), DO_NOT_ASK_AGAIN_LABEL]);
    const pilot = $station.online?.characterID ?? null;
    flow.requestNames([{ kind: "type", id: ask.typeID }, ...(pilot === null ? [] : [{ kind: "owner" as const, id: pilot }])]);
  });
  const shipNameHint = $derived(
    $shipNameAsked === null
      ? ""
      : plainText(formatTemplate(shipWord("UI/Inflight/OwnerAndShip"), {
          shipTypeID: $shipNameAsked.typeID,
          charID: $station.online?.characterID ?? 0,
        }, { nameOf })),
  );
  function answerShipName(confirm: boolean): void {
    const ask = $shipNameAsked;
    if (ask === null) return;
    const name = confirm ? (shipNameTyped || shipNameHint).replace(/\n/g, " ").trim() : null;
    flow.answerShipName(ask.n, name, shipNameKeep);
  }
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

{#if $applyPointsAsked !== null}
  {@const apply = $applyPointsAsked}
  <div class="client-dialog-shade" class:modal={inFront}>
    <div class="client-dialog apply-window" role="dialog" aria-label={applyWord("UI/SkillTrading/ApplySkillPointsWindowCaption")} data-dialog="ApplySkillPointsWindow" data-in-front={inFront}>
      {#if !inFront && pilotName !== null}
        <span class="for-pilot">For {pilotName}</span>
      {/if}
      <strong class="apply-head">{applyWord("UI/SkillTrading/ApplySkillPointsWindowCaption")}</strong>
      <p class="body apply-description">{applyWord("UI/SkillTrading/ApplySkillPointsDescription", { color: "#3ea8d9", points: apply.points, amount: apply.entries.length })}</p>
      <ul class="apply-rows">
        {#each apply.entries as entry (`${entry.skill}:${entry.level}`)}
          <li class="apply-row">
            <span class="apply-gauge">
              <span class="apply-fill with-points" style:width={`${entry.progressWithFreePoints * 100}%`}></span>
              <span class="apply-fill trained" class:complete={apply.finished && entry.progressWithFreePoints === 1} style:width={`${entry.progress * 100}%`}></span>
              <span class="apply-name">{nameOf("type", entry.skill)} {romanLevel(entry.level)}</span>
            </span>
            <span class="apply-saved">
              <span class="dim">{entry.timeSavedTicks === null ? "" : applyWord("UI/SkillTrading/EstimatedSkillTimeSaved", { timeSaved: Math.max(0, Math.trunc(entry.timeSavedTicks)) })}</span>
              <span>{applyWord("UI/SkillTrading/SkillProgressLabel", { progress: percent(entry.progress), progressWithFreePoints: percent(entry.progressWithFreePoints) })}</span>
            </span>
          </li>
        {/each}
      </ul>
      <span class="answers">
        {#if apply.finished}
          <button type="button" onclick={() => void flow.answerApplyPoints(apply.n, "close")}>{applyWord("UI/SkillTrading/CloseInjectionLabel")}</button>
        {:else}
          <button type="button" disabled={!apply.canConfirm} onclick={() => void flow.answerApplyPoints(apply.n, "confirm").catch(() => {})}>{applyWord("UI/SkillTrading/ConfirmInjectionLabel")}</button>
          <button type="button" onclick={() => void flow.answerApplyPoints(apply.n, "close")}>{applyWord("UI/SkillTrading/CancelInjectionLabel")}</button>
        {/if}
      </span>
    </div>
  </div>
{/if}

{#if $skillBooksAsked !== null}
  {@const books = $skillBooksAsked}
  <div class="client-dialog-shade" class:modal={inFront}>
    <div class="client-dialog" role="dialog" aria-label={bookWord("UI/SkillPlan/MissingSkillbooksWindow/ConfirmPurchaseTitle")} data-dialog="MissingSkillbooksWnd" data-in-front={inFront}>
      {#if !inFront && pilotName !== null}
        <span class="for-pilot">For {pilotName}</span>
      {/if}
      <span class="book-title">
        <strong>{bookWord("UI/SkillPlan/MissingSkillbooksWindow/ConfirmPurchaseTitle")}</strong>
        <button type="button" class="close" aria-label="Close" onclick={() => void flow.answerSkillBooks(books.n, "close")}>✕</button>
      </span>
      {#if books.available.length > 0}
        <section class="book-section">
          <span class="book-heading" title={bookWord("UI/SkillPlan/MissingSkillbooksWindow/RemoteInjectionTooltip")}>
            <span class="skill-mark book"></span>{bookWord("UI/SkillPlan/MissingSkillbooksWindow/AvailableForRemoteInjection")}
          </span>
          <ul class="book-list">
            {#each books.available as skill (skill)}<li>- {nameOf("type", skill)}</li>{/each}
          </ul>
          {#if books.cost !== null}
            <span>{bookWord("UI/SkillPlan/MissingSkillbooksWindow/PriceLabel", { cost: books.cost })}</span>
          {/if}
          <button
            type="button"
            title={bookWord("UI/SkillPlan/MissingSkillbooksWindow/BuyAndInjectTooltip")}
            onclick={() => void flow.answerSkillBooks(books.n, "buy").catch(() => {})}
          >{bookWord("UI/SkillPlan/MissingSkillbooksWindow/BuyAndInjectButton")}</button>
        </section>
      {/if}
      {#if books.available.length > 0 && books.unavailable.length > 0}<hr class="book-line" />{/if}
      {#if books.unavailable.length > 0}
        <section class="book-section">
          <span class="book-heading unavailable" title={bookWord("UI/SkillPlan/MissingSkillbooksWindow/RemoteInjectionTooltip")}>
            <span class="skill-mark book"></span>{bookWord("UI/SkillPlan/MissingSkillbooksWindow/UnavailableForRemoteInjection")}
          </span>
          <ul class="book-list">
            {#each books.unavailable as skill (skill)}<li>- {nameOf("type", skill)}</li>{/each}
          </ul>
        </section>
      {/if}
    </div>
  </div>
{/if}

{#if $shipNameAsked !== null}
  <div class="client-dialog-shade" class:modal={inFront}>
    <div class="client-dialog" role="dialog" aria-label={shipWord("UI/Ship/NameChange/WindowTitle")} data-dialog="ShipNameDialog" data-in-front={inFront}>
      <form
        class="quantity"
        onsubmit={(event) => {
          event.preventDefault();
          answerShipName(true);
        }}
      >
        {#if !inFront && pilotName !== null}
          <span class="for-pilot">For {pilotName}</span>
        {/if}
        <strong>{shipWord("UI/Ship/NameChange/WindowTitle")}</strong>
        <label class="ship-name-field">
          <span>{shipWord("UI/Ship/NameChange/InputFieldLabel")}</span>
          <input type="text" maxlength="32" placeholder={shipNameHint} bind:value={shipNameTyped} use:focusAll />
          <span class="ship-name-count">{shipNameTyped.length}/32</span>
        </label>
        <p class="body">{shipWord("UI/Ship/NameChange/InfoLabel")}</p>
        {#if $shipNameAsked.suppress}
          <label class="keep">
            <input type="checkbox" bind:checked={shipNameKeep} />
            {wordOf(DO_NOT_ASK_AGAIN_LABEL, "Do not ask me again")}
          </label>
        {/if}
        <span class="answers">
          <button type="submit">{shipWord("UI/Common/Confirm")}</button>
          <button type="button" onclick={() => answerShipName(false)}>{shipWord("UI/Common/Later")}</button>
        </span>
      </form>
    </div>
  </div>
{/if}

{#if $skillsRequired !== null}
  {@const open = $skillsRequired}
  <div class="client-dialog-shade" class:modal={inFront}>
    <div class="client-dialog" role="dialog" aria-label={skillWord("UI/Generic/Information")} data-dialog="SkillRequirementDialog" data-in-front={inFront}>
      {#if !inFront && pilotName !== null}
        <span class="for-pilot">For {pilotName}</span>
      {/if}
      <strong>{skillWord("UI/Generic/Information")}</strong>
      <span class="skill-head">
        <TypeIcon typeID={open.typeID} name={nameOf("type", open.typeID)} size="md" />
        <span class="skill-type">{nameOf("type", open.typeID)}</span>
      </span>
      <p class="body">{skillWord("Tooltips/SkillPlanner/SkillsRequiredToPerformActivity", { doActivity: skillWord("Tooltips/SkillPlanner/ActivityFlyShip") })}</p>
      <p class="body">
        {skillWord("Tooltips/SkillPlanner/SkillsAndSkillLevels", { numSkills: open.skills.length, numLevels: open.totalMissingLevels })}
        {#if open.missingBooks > 0}{" "}{skillWord("Tooltips/SkillPlanner/MissingSkillBooks", { numMissingBooks: open.missingBooks })}{/if}
      </p>
      <ul class="skill-rows">
        {#each open.skills as [skill, level] (skill)}
          {@const row = open.rows.find((one) => one.skill === skill) ?? null}
          <li class="skill-row">
            <span class="skill-name">{skillWord("UI/InfoWindow/RequiredSkillNameAndLevel", { skill, level: romanLevel(level), levelColor: "#ffffff" })}</span>
            {#if row !== null && row.mark !== null}
              <span class="skill-mark" class:book={row.mark !== "level-short"} title={skillWord(SKILL_MARK_LABELS[row.mark])}></span>
            {/if}
            {#if row !== null && row.boxes.length > 0}
              <span class="skill-bar" aria-hidden="true">
                {#each row.boxes as one, at (at)}
                  <span class="skill-box {one.box}" class:partial={one.partial}></span>
                {/each}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if open.trainingTicks !== null}
        <div class="skill-time">
          {#if open.omega}
            <span class="dim">{skillWord("Tooltips/SkillPlanner/OmegaTrainingTime")}</span>
            <span>{trainingTime(open.trainingTicks)}</span>
          {:else}
            <span class="dim">{skillWord("Tooltips/SkillPlanner/TrainingTime")}</span>
            <span>α {trainingTime(open.trainingTicks)}</span>
            <span class="omega">Ω {trainingTime(Math.floor(open.trainingTicks / 2))}</span>
          {/if}
        </div>
      {/if}
      {#if open.action !== null}
        <div class="skill-points">
          <span class="dim">{skillWord("UI/Skills/SkillPointsRequired")}</span>
          <span>{open.skillPointsRequired === null ? "" : groupedNumber(open.skillPointsRequired)}</span>
          {#if applyPointsButton(open) !== null}
            {@const button = applyPointsButton(open)!}
            <button type="button" class="apply-points" title={button.hint} aria-label={button.hint} disabled={!button.enabled} onclick={button.use}>+</button>
          {/if}
        </div>
        {#if open.action.kind === "train"}
          <span class="answers">
            <button
              type="button"
              disabled={open.action.queued}
              title={skillWord(open.action.queued ? "Tooltips/SkillPlanner/AddAllSkillsToQueueButtonFinished" : "Tooltips/SkillPlanner/AddAllSkillsToQueueButton")}
              onclick={() => void flow.trainSkillsRequired().catch(() => {})}
            >{skillWord("UI/Skills/TrainSkills")}</button>
          </span>
        {:else}
          <!-- BuyAndTrainButton: its hint says where a book is a rare one (isRareSkill, IsMissingRarePrereqs). -->
          {@const rare = open.action.missing.some((skill) => open.books[skill]?.sold !== true)}
          <span class="answers">
            <button
              type="button"
              title={rare ? skillWord("UI/Skills/ErrorRareRequirements") : ""}
              onclick={() => void flow.buySkillsRequired().catch(() => {})}
            >{skillWord("UI/Skills/BuyAndTrain")}</button>
          </span>
        {/if}
      {/if}
      <span class="answers">
        <button type="button" onclick={() => flow.dismissSkillsRequired()}>{skillWord("Achievements/AuraText/laterButton")}</button>
      </span>
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
      {#if box.suppress !== null}
        <label class="keep">
          <input type="checkbox" bind:checked={keepTicked} />
          {box.said.answers === "yesno" ? wordOf(DO_NOT_ASK_AGAIN_LABEL, "Do not ask me again") : wordOf(DO_NOT_SHOW_AGAIN_LABEL, "Do not show me this again")}
        </label>
      {/if}
      <span class="answers">
        {#if box.said.answers === "yesno"}
          <button type="button" onclick={() => answerBox("yes")}>{wordOf("UI/Common/Buttons/Yes", "Yes")}</button>
          <button type="button" onclick={() => answerBox("no")}>{wordOf("UI/Common/Buttons/No", "No")}</button>
        {:else}
          <button type="button" onclick={() => answerBox("ok")}>OK</button>
        {/if}
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
  .skill-type { font-size: 1.05rem; }
  .ship-name-field { display: flex; flex-direction: column; gap: 0.25rem; }
  .ship-name-count { align-self: flex-end; font-size: 0.8rem; opacity: 0.7; }
  .skill-rows { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 0.35rem; }
  .skill-head { display: flex; align-items: center; gap: 0.75rem; }
  .skill-row { display: flex; align-items: center; gap: 0.5rem; }
  .skill-name { flex: 1; }
  .skill-mark { width: 12px; height: 14px; flex: none; }
  .skill-mark.book { background: #e0a43c; border-radius: 1px 3px 3px 1px; }
  .skill-bar { display: inline-flex; gap: 2px; margin-left: 0.75rem; }
  .skill-box { width: 8px; height: 8px; box-sizing: border-box; }
  .skill-box.none { visibility: hidden; }
  .skill-box.trained { background: rgba(204, 204, 204, 1); }
  .skill-box.training { background: rgba(204, 204, 204, 0.6); outline: 1px solid rgba(204, 204, 204, 1); }
  .skill-box.queued { background: #3ea8d9; }
  .skill-box.untrained { background: rgba(255, 255, 255, 0.3); }
  .skill-box.small { width: 4px; height: 4px; margin: 2px; background: rgba(255, 255, 255, 0.3); }
  .skill-box.partial { outline: 1px solid rgba(204, 204, 204, 1); }
  .skill-time, .skill-points { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.4rem 0.6rem; background: rgba(25, 25, 25, 0.7); }
  .skill-points { flex-direction: row; justify-content: space-between; }
  .skill-time .omega { color: #ff9e1b; }
  .dim { opacity: 0.7; }
  .book-title { display: flex; justify-content: space-between; align-items: center; }
  .book-title .close { padding: 0 0.4rem; border: none; background: none; }
  .book-section { display: flex; flex-direction: column; gap: 0.35rem; }
  .book-heading { display: flex; align-items: center; gap: 0.6rem; padding: 0.2rem 0.3rem; background: rgba(51, 51, 51, 0.5); font-size: 1.05rem; }
  .book-heading.unavailable { color: #ff4d4d; }
  .book-list { margin: 0; padding: 0; list-style: none; max-height: 100px; overflow-y: auto; }
  .apply-points { margin-left: 0.6rem; padding: 0 0.5rem; }
  .apply-window { width: min(37.5rem, calc(100vw - 2rem)); }
  .apply-head { padding: 0.4rem 0.5rem; background: rgba(34, 34, 36, 0.7); }
  .apply-description { text-align: center; }
  .apply-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.6rem; max-height: 50vh; overflow-y: auto; }
  .apply-row { display: flex; flex-direction: column; gap: 0.2rem; }
  .apply-gauge { position: relative; height: 1.9rem; border: 1px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; }
  .apply-fill { position: absolute; left: 0; top: 0; bottom: 0; }
  .apply-fill.with-points { background: rgba(54, 102, 140, 0.6); }
  .apply-fill.trained { background: rgba(62, 168, 217, 0.7); }
  .apply-fill.trained.complete { background: rgba(61, 165, 71, 0.7); }
  .apply-name { position: relative; }
  .apply-saved { display: flex; justify-content: space-between; font-size: 0.8rem; border: 1px solid rgba(255, 255, 255, 0.15); padding: 0.1rem 0.4rem; }
  .book-line { width: 100%; border: none; border-top: 1px solid rgba(240, 248, 255, 0.5); margin: 0.3rem 0; }
  .client-dialog-shade { position: fixed; inset: 0; z-index: 45; display: flex; align-items: center; justify-content: center;
    pointer-events: none; }
  .client-dialog-shade.modal { pointer-events: auto; background: rgba(0, 0, 0, 0.25); }
  .client-dialog { pointer-events: auto; display: flex; flex-direction: column; gap: 0.6rem; width: min(26rem, calc(100vw - 2rem));
    padding: 0.75rem 1rem; background: #14273a; color: #d6e6f7; border: 1px solid #3c6f9e; }
  .body { margin: 0; white-space: pre-line; }
  /* The client's label starts a new line at each line break in its text (trinity, Tr2LabelTextParser.cpp 360 to 375). */
  .strip-text { white-space: pre-line; }
  .answers { display: flex; justify-content: flex-end; gap: 0.4rem; }
  .keep { display: flex; align-items: center; gap: 0.4rem; font-size: 0.9rem; }
  .quantity { display: contents; }
  input { background: #0d1b29; color: inherit; border: 1px solid #3c6f9e; padding: 0.2rem 0.4rem; }
  button { border: 1px solid #5b93c7; background: #1b3956; color: inherit; padding: 0.2rem 1rem; cursor: pointer; }
  .for-pilot { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
  .client-strip { position: fixed; top: max(20vh, 175px); left: 50%; transform: translateX(-50%); width: 300px; z-index: 44;
    padding: 8px; box-sizing: border-box; text-align: center; pointer-events: none; background: rgba(10, 18, 28, 0.85);
    color: #d6e6f7; border: 1px solid rgba(91, 147, 199, 0.4); }
  .client-strip .for-pilot { display: block; }
</style>
