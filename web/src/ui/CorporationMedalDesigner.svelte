<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import { emptyMedalDesign, selectMedalDesign, resetMedalDesignLayer, setMedalDesignColour, medalDesignPreview, medalDesignGraphics, ribbonShapes, RIBBON_BASES, MEDAL_BASES, MEDAL_ELEMENTS } from "../bridge/medalDesigner.ts";
  import MedalPreview from "./MedalPreview.svelte";
  import MedalDesignSlider from "./MedalDesignSlider.svelte";
  import MedalColourPicker from "./MedalColourPicker.svelte";
  let { store, flow, onClose }: { store: ClientStore; flow: AppFlow; onClose?: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words;
  const P = "UI/Corporations/CreateDecorationWindow/";
  const word = (key: string, fallback: string) => plainText($words.templates[key] ?? fallback);
  let design = $state(emptyMedalDesign()), name = $state(""), description = $state(""), reset = $state(0);
  const preview = $derived(medalDesignPreview(design));
  let submitting = $state(false), error = $state("");
  let disposed = false;
  const current = () => { if (disposed) throw new Error("This decoration window has closed."); };
  onDestroy(() => { disposed = true; });
  async function submit(): Promise<void> {
    if (submitting) return;
    submitting = true; error = "";
    const title = name, desc = description, graphics = medalDesignGraphics(design);
    let ready: "ready" | "missing" | "refused";
    try { ready = await flow.prepareCorporationMedal(title, desc, graphics, current); }
    catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); return; }
    if (ready !== "ready") { if (ready === "missing") submitting = false; return; }
    // Native SubmitData's finally covers CreateMedal only. A preflight wallet
    // exception leaves its submitting fence set until the window is closed.
    try { if (await flow.createCorporationMedal(title, desc, graphics, current)) onClose?.(); }
    catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); }
    finally { submitting = false; }
  }
  function resetAll(): void { design = emptyMedalDesign(); name = ""; description = ""; reset++; }
  onMount(() => { flow.requestWords(["UI/Contracts/BasicInfo", ...["Title", "DecorationName", "Description", "Ribbon", "Medal", "Submit", "Reset", "ResetItem", "PreviousItem", "NextItem"].map(key => P + key)]); });
</script>

<section class="designer" aria-label={word(P + "Title", "Create Decoration")} aria-busy={submitting}>
  {#if error}<p class="error">{error}</p>{/if}
  <div class="design-body">
    <div class="preview"><MedalPreview layers={preview} title={name || word(P + "Title", "Create Decoration")} size={256} width={128} /></div>
    <div class="controls">
      <h3>{word("UI/Contracts/BasicInfo", "Basic Info")}</h3>
      <label>{word(P + "DecorationName", "Decoration Name")}<input name="medalname" maxlength="100" bind:value={name} /></label>
      <label>{word(P + "Description", "Description")}<textarea name="medaldesc" maxlength="1000" bind:value={description}></textarea></label>
      {#key reset}
        {#each [1, 2] as part}
          <h3>{word(P + (part === 1 ? "Ribbon" : "Medal"), part === 1 ? "Ribbon" : "Medal")}</h3>
          {#each [0, 1, 2, 3] as row}
            {@const shown = (part === 1 ? design.ribbonVisible : design.medalVisible)[row]}
            <div class="design-row" class:hidden={!shown}>
              {#if row > 0}<button type="button" class="reset-item" title={word(P + "ResetItem", "Reset Item")} aria-label={`${part === 1 ? "Ribbon" : "Medal"} ${row}: ${word(P + "ResetItem", "Reset Item")}`} onclick={() => design = resetMedalDesignLayer(design, part as 1 | 2, row)}>×</button>{:else}<span class="reset-spacer"></span>{/if}
                <MedalDesignSlider options={part === 1 ? row === 0 ? RIBBON_BASES : ribbonShapes(design.race) : row === 0 ? MEDAL_BASES : MEDAL_ELEMENTS} part={part as 1 | 2} label={`${part === 1 ? "Ribbon" : "Medal"} ${row}`} selected={(part === 1 ? design.ribbonSelected : design.medalSelected)[row] ?? null} onSelect={index => design = selectMedalDesign(design, part as 1 | 2, row, index)} previous={word(P + "PreviousItem", "Previous Item")} next={word(P + "NextItem", "Next Item")} />
              {#if part === 1 && design.ribbonColoursVisible[row]}<MedalColourPicker color={design.ribbon[4 - row]!.color} label={`${word(P + "Ribbon", "Ribbon")} ${row}`} onSelect={swatch => design = setMedalDesignColour(design, row, swatch)} onOpen={() => flow.medalColourPaletteOpened()} />{/if}
            </div>
          {/each}
        {/each}
      {/key}
    </div>
  </div>
  <div class="buttons"><button type="button" onclick={() => { void submit(); }}>{word(P + "Submit", "Submit")}</button><button type="button" onclick={resetAll}>{word(P + "Reset", "Reset")}</button></div>
</section>

<style>
  .designer { height: 100%; display: flex; flex-direction: column; font-size: 12px; }
  .design-body { display: flex; flex: 1; min-height: 0; gap: 8px; }
  .preview { flex: 0 0 128px; display: flex; align-items: center; }
  .controls { display: block; flex: 1; min-width: 292px; }
  h3 { font-size: 11px; line-height: 14px; border-bottom: 1px solid var(--border); margin: 2px 0; padding-bottom: 2px; }
  label { display: block; margin: 4px 0; font-size: 11px; line-height: 12px; }
  input, textarea { box-sizing: border-box; display: block; width: 100%; margin-top: 3px; padding: 4px; font-size: 12px; }
  input { height: 26px; }
  textarea { height: 64px; resize: none; }
  .design-row { height: 32px; margin: 4px 0; display: flex; align-items: center; gap: 4px; }
  .hidden { display: none; }
  .reset-item, .reset-spacer { width: 16px; flex-shrink: 0; padding: 0; }
  .reset-item { height: 32px; border: 1px solid var(--border); background: #0004; color: inherit; cursor: pointer; }
  .buttons { display: flex; justify-content: center; padding-top: 8px; gap: 8px; }
  .buttons button { font-size: 12px; line-height: 16px; padding: 4px 12px; }
</style>
