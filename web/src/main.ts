// R2 entry: the first real page on the new stack (view-lib spike: Svelte 5).
// login form -> character selection -> docked station panel, all state in the
// framework-agnostic client-state store, all fetch/decode logic in
// app/flow.ts, the Svelte components pure readers. Replaces the R1b scaffold
// smoke page per its own note.

import { mount } from "svelte";
import App from "./ui/App.svelte";
import { createClientStore } from "./store/clientStore.ts";
import { createAppFlow } from "./app/flow.ts";

const store = createClientStore();
const flow = createAppFlow(store);

const target = document.getElementById("app");
if (target) {
  mount(App, { target, props: { store, flow } });
}
