<script lang="ts">
  // Who-cares login (roadmap section 6): an existing EveJS account username
  // signs in with any password, including an empty one.
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { flow }: { flow: AppFlow } = $props();

  let username = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state("");

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || !username.trim()) {
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

<section>
  <h2>Log in</h2>
  <p class="note">
    EveJS account name; the password is not checked (dev emulator).
  </p>
  <form onsubmit={submit}>
    <label>
      Account
      <input
        type="text"
        bind:value={username}
        autocomplete="username"
        placeholder="EveJS account"
      />
    </label>
    <label>
      Password
      <input
        type="password"
        bind:value={password}
        autocomplete="current-password"
        placeholder="anything"
      />
    </label>
    <button type="submit" disabled={busy || !username.trim()}>
      {busy ? "Signing in…" : "Log in"}
    </button>
  </form>
  {#if error}
    <p class="error">{error}</p>
  {/if}
</section>
