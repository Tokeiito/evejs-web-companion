// tsc does not parse .svelte files (vite-plugin-svelte compiles them; Svelte 5
// handles lang="ts" scripts natively). This shim types the module boundary so
// `npm run typecheck` accepts .svelte imports; props are typed inside each
// component.
declare module "*.svelte" {
  import type { Component } from "svelte";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: Component<any>;
  export default component;
}
