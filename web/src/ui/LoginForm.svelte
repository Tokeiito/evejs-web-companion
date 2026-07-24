<script lang="ts">
  // Who-cares login (roadmap section 6): an existing EveJS account username
  // signs in with any password, including an empty one.
  //
  // Gated on the boot health ping (main.ts -> flow.checkHealth, once per page
  // load, never a poll): while the server's state is unknown the form waits, and
  // if the server is offline the form refuses login outright rather than letting
  // a doomed attempt fail confusingly. Centred on screen.
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const health = store.health;

  const online = $derived($health.status === "online");
  const offline = $derived($health.status === "offline");

  let username = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state("");

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    // No attempt while the server is offline or its state is still unknown.
    if (busy || !username.trim() || !online) {
      return;
    }
    busy = true;
    error = "";
    try {
      await flow.login(username.trim(), password);
    } catch (cause) {
      error =
        cause instanceof BridgeCallError
          ? cause.code === "UNKNOWN_EVEJS_ACCOUNT"
            ? "Unknown EveJS account."
            : `${cause.code}: ${cause.message}`
          : String(cause);
    } finally {
      busy = false;
    }
  }
</script>

<div class="login-screen">
  <section class="panel">
    <header class="panel-head">
      <h2>Log in</h2>
    </header>

    {#if offline}
      <p class="login-status offline" role="alert">
        The server is offline — login is unavailable. Start EveJS and refresh the page.
      </p>
    {:else if !online}
      <p class="login-status checking">Checking server…</p>
    {/if}

    <p class="note">Sign in with your EveJS account name — any password works.</p>
    <form onsubmit={submit}>
      <label>
        Account
        <input
          type="text"
          bind:value={username}
          autocomplete="username"
          placeholder="EveJS account"
          disabled={!online}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          bind:value={password}
          autocomplete="current-password"
          placeholder="anything"
          disabled={!online}
        />
      </label>
      <button type="submit" class="primary" disabled={busy || !username.trim() || !online}>
        {busy ? "Signing in…" : offline ? "Server offline" : !online ? "Checking…" : "Log in"}
      </button>
    </form>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  </section>
</div>
