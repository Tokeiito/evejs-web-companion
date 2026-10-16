<script lang="ts">
  // The wallet's Auto Payment tab (personalPaySettingsPanel.py; bridge/characterSettings.ts): the jump gate's automatic
  // payment, a tick and an amount in ISK (CheckBoxWithInputField: the amount's field dimmed while the tick is off), from
  // the character setting 'personalAutopayment' (its singleValues jumpbridgeAutopaymentCB and
  // jumpbridgeAutopaymentValue), read once as the tab is first chosen (SetPersonalAutopaymentSettingsIfNeeded). Apply
  // (SubmitPersonalAutomaticPaymentSettings) sets both and saves the whole setting back (charMgr.SaveCharacterSetting);
  // the button is marked while there is a change not applied (Blink).
  import { onMount } from "svelte";
  import { plainText } from "../bridge/clientWords.ts";
  import { characterSettingsObject, characterSettingsYaml, singleValue, withSingleValue, type CharacterSettingsObject } from "../bridge/characterSettings.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words;

  /** characterSettingsConsts: the setting and its two single values. */
  const PERSONAL_AUTOPAYMENT = "personalAutopayment";
  const JUMPBRIDGE_AUTOPAYMENT_CB = "jumpbridgeAutopaymentCB";
  const JUMPBRIDGE_AUTOPAYMENT_VALUE = "jumpbridgeAutopaymentValue";

  const WORDS = {
    activateJumpGate: "UI/Wallet/WalletWindow/ActivateJumpGate",
    tooltip: "UI/Wallet/WalletWindow/ActivateJumpGateTooltip",
    isk: "UI/Common/ISK",
    apply: "UI/Commands/Apply",
  } as const;
  $effect(() => {
    flow.requestWords(Object.values(WORDS));
  });
  const word = (label: string, own: string): string => {
    const template = $words.templates[label];
    return typeof template === "string" && template !== "" ? plainText(template) : own;
  };

  let settings = $state<CharacterSettingsObject | null>(null);
  let checked = $state(false);
  let amountText = $state("0");
  let changed = $state(false);
  let busy = $state(false);
  let failure = $state("");

  /** SingleLineEditInteger's value: a whole number, nought where nothing is typed. */
  const amount = $derived(/^\d+$/.test(amountText.trim()) ? Number(amountText.trim()) : 0);

  async function apply(): Promise<void> {
    if (settings === null || busy) return;
    busy = true;
    failure = "";
    try {
      const next = withSingleValue(withSingleValue(settings, JUMPBRIDGE_AUTOPAYMENT_CB, checked), JUMPBRIDGE_AUTOPAYMENT_VALUE, amount);
      await flow.saveCharacterSetting(PERSONAL_AUTOPAYMENT, characterSettingsYaml(next));
      settings = next;
      changed = false;
    } catch (cause) {
      failure = panelErrorWords(cause);
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void flow.readCharacterSetting(PERSONAL_AUTOPAYMENT)
      .then((text) => {
        const read = characterSettingsObject(text);
        settings = read;
        checked = singleValue(read, JUMPBRIDGE_AUTOPAYMENT_CB, false) === true;
        const value = singleValue(read, JUMPBRIDGE_AUTOPAYMENT_VALUE, 0);
        amountText = String(typeof value === "number" ? Math.trunc(value) : 0);
      })
      .catch((cause) => {
        failure = panelErrorWords(cause);
      });
  });
</script>

<div class="wallet-auto-payment">
  {#if settings === null && !failure}
    <p class="empty">Reading…</p>
  {:else if settings !== null}
    <p class="auto-payment-row">
      <label class="auto-payment-tick">
        <input type="checkbox" bind:checked onchange={() => (changed = true)} />
        {word(WORDS.activateJumpGate, "Pay jump gate fees for me")}
      </label>
      <span class="auto-payment-more" title={word(WORDS.tooltip, "")} aria-label={word(WORDS.tooltip, "")}>ⓘ</span>
      <span class="auto-payment-amount" class:dim={!checked}>
        <input type="text" inputmode="numeric" size="12" maxlength="32" bind:value={amountText} oninput={() => (changed = true)} />
        {word(WORDS.isk, "ISK")}
      </span>
    </p>
    <p class="controls">
      <button type="button" class:primary={changed} disabled={busy} onclick={() => void apply()}>{word(WORDS.apply, "Apply")}</button>
    </p>
  {/if}
  {#if failure}
    <p class="error">{failure}</p>
  {/if}
</div>

<style>
  .wallet-auto-payment .auto-payment-row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .wallet-auto-payment .auto-payment-tick { display: inline-flex; gap: 0.4rem; align-items: center; }
  .wallet-auto-payment .auto-payment-more { cursor: help; color: var(--color-muted); }
  .wallet-auto-payment .auto-payment-amount { display: inline-flex; gap: 0.3rem; align-items: center; }
  /* _ChangeUiOpacity: the amount's field at half while the tick is off. */
  .wallet-auto-payment .dim { opacity: 0.5; }
</style>
