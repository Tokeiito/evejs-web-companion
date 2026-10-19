<script lang="ts">
  import { onMount } from "svelte";
  import Contacts from "./Contacts.svelte";
  import type { ContactAction } from "./contactAction.ts";
  import type { ContactScope, NamedAddressBook } from "../bridge/contacts.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, action, contactType = "contact", done }: {
    store: ClientStore; flow: AppFlow; action: ContactAction; contactType?: ContactScope;
    done: (book: NamedAddressBook | null) => void;
  } = $props();
  let dialog = $state<HTMLDialogElement | undefined>(undefined);
  // menuMerge._ExecMulti starts each owner's callback separately. Each native
  // contactmanagement_<owner> window has its own draft/question and modal life.
  onMount(() => { dialog?.showModal(); });
</script>

<dialog bind:this={dialog} class="member-contact-dialog" aria-label="Contact action" oncancel={() => done(null)}>
  <Contacts {store} {flow} {contactType} contactAction={action} onActionDone={done} />
</dialog>

<style>
  .member-contact-dialog { position: fixed; inset: 0; margin: auto; width: min(32rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); overflow: auto; padding: 0.5rem; color: var(--color-text); background: var(--color-bg, #0b1119); border: 1px solid var(--color-accent); }
  .member-contact-dialog::backdrop { background: #0009; }
</style>
