<script lang="ts">
  // menusvc.FleetMenu725-730; SessionChecker229-269; FleetMemberChecker470-510.
  import { onMount } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { fleetBeaconOffers } from "../bridge/fleetBeaconMenu.ts";
  import { plainText } from "../bridge/clientWords.ts";

  let { store, flow, ownerID, blocked, travel }: {
    store: ClientStore; flow: AppFlow; ownerID: number; blocked: boolean;
    travel: (how: "jump" | "bridge" | "group") => void;
  } = $props();
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const fleet = store.fleet;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const dogma = store.dogma;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  const offers = $derived(fleetBeaconOffers($station.online?.characterID ?? null, ownerID, $flight.status, $space.snapshot,
    $dogma.allInfo, $fleet.jumpBeacons?.[String(ownerID)] ?? null));
  const LABELS = { jump: "UI/Inflight/JumpToFleetMember", bridge: "UI/Fleet/BridgeToMember", group: "UI/Fleet/ConduitJumpToFleetMember" };
  const word = (label: string, fallback: string): string => plainText($words.templates[label] ?? fallback);
  onMount(() => {
    flow.requestWords(Object.values(LABELS));
    if ($flight.status?.inSpace && ($dogma.allInfo === null || String($dogma.allInfo.activeShipID) !== String($flight.status.shipID))) {
      void flow.loadDogma().catch(() => {});
    }
  });
</script>

{#if offers.jump}<button type="button" class="minor" disabled={blocked} onclick={() => travel("jump")}>{word(LABELS.jump, "Jump to Member")}</button>{/if}
{#if offers.bridge}<button type="button" class="minor" disabled={blocked} onclick={() => travel("bridge")}>{word(LABELS.bridge, "Bridge to Member")}</button>{/if}
{#if offers.group}<button type="button" class="minor" disabled={blocked} onclick={() => travel("group")}>{word(LABELS.group, "Conduit Jump to Member")}</button>{/if}
