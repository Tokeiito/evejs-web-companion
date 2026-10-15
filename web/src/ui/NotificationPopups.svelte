<script lang="ts">
  // The notification popups' mount point. Renders nothing: it keeps watchNotificationPopups alive for as long as
  // this pilot's workspace is on screen (notificationPopups.ts), and tears it down when they are switched away.
  //
  // Mounted exactly once per workspace, beside the NoticeBridge and the flash.
  import { watchNotificationPopups } from "./notificationPopups.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  $effect(() => watchNotificationPopups(store, flow));
</script>
