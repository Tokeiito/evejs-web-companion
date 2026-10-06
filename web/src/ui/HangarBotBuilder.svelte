<script lang="ts">
  // The FLOATING Bot Builder — the window the Bot Manager's New and Edit open on
  // the global layer (globalWindow.ts `BUILDER_TAB`).
  //
  // The Builder itself is unchanged; this supplies the pilot it reads, and its
  // "Data from" picker. With a pilot chosen it is that pilot's store and flow.
  // With none (nobody in the client, or "No pilot" picked) its flow rides an
  // ACCOUNT sign-in, the same one the Manager's library calls use
  // (app/pilotReach.ts), and its store is an empty one: no ship, no cargo, no
  // station, so the pickers that read those start empty rather than showing
  // somebody's. See bots/builderFlow.ts.
  import { onMount } from "svelte";
  import { derived, readable, type Readable } from "svelte/store";
  import BotBuilder from "./BotBuilder.svelte";
  import { createPilotReach } from "../app/pilotReach.ts";
  import { loadKnownAccounts, loadKnownCharacters } from "../app/knownCharacters.ts";
  import type { Session } from "../app/sessions.ts";
  import { createPilotlessBuilderFlow, type BuilderPilotChoice } from "../bots/builderFlow.ts";
  import { createClientStore } from "../store/clientStore.ts";

  let {
    sessions,
    pilot = null,
    onPilot = () => {},
  }: {
    sessions: readonly Session[];
    /** The pilot the pickers read, or null for none. */
    pilot?: Session | null;
    /** "Data from" changed. App holds the choice, so it outlives this mount. */
    onPilot?: (sessionID: string | null) => void;
  } = $props();

  const reach = createPilotReach({
    held: () => sessions,
    known: () => loadKnownCharacters(),
    accounts: () => loadKnownAccounts(),
  });
  onMount(() => () => void reach.release());

  const pilotlessFlow = createPilotlessBuilderFlow(() => reach.libraryOptions());
  const emptyStore = createClientStore();

  const store = $derived(pilot?.store ?? emptyStore);
  const flow = $derived(pilot?.flow ?? pilotlessFlow);

  // Every held session that has a pilot online, by name. Derived from each
  // session's station slice so a pilot finishing its sign-in joins the list
  // without the window being reopened.
  const choiceStore: Readable<readonly BuilderPilotChoice[]> = $derived(
    sessions.length === 0
      ? readable([])
      : derived(
          sessions.map((session) => session.store.station),
          (slices) =>
            slices.flatMap((slice, i) => {
              const online = slice.online;
              const session = sessions[i];
              return online && session ? [{ sessionID: session.id, name: online.characterName ?? "Unnamed pilot" }] : [];
            }),
        ),
  );

  const dataSource = $derived({ choices: $choiceStore, current: pilot?.id ?? null, onPick: onPilot });
</script>

<BotBuilder {store} {flow} {dataSource} />
