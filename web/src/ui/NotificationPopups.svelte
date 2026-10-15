<script lang="ts">
  // The notification popups' mount point. Renders nothing: it keeps watchNotificationPopups alive for as long as
  // this pilot's workspace is on screen (notificationPopups.ts), and tears it down when they are switched away. The
  // autopilot's and the star map's notify messages are watched here too (autopilotNotices.ts).
  //
  // Mounted exactly once per workspace, beside the NoticeBridge and the flash.
  import { watchNotificationPopups } from "./notificationPopups.ts";
  import { watchAutopilotNotices } from "./autopilotNotices.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { TabID } from "./tabs.ts";

  let { store, flow, onOpen }: { store: ClientStore; flow: AppFlow; onOpen: (id: TabID) => void } = $props();

  $effect(() => watchNotificationPopups(store, flow, (id) => onOpen(id)));
  $effect(() => watchAutopilotNotices(store, flow));
</script>
