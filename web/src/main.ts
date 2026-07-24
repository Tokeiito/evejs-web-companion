// R2 entry: the first real page on the new stack (view-lib spike: Svelte 5).
// login form -> character selection -> docked station panel, all state in the
// framework-agnostic client-state store, all fetch/decode logic in
// app/flow.ts, the Svelte components pure readers. Replaces the R1b scaffold
// smoke page per its own note.

// Styling (goal R8): the Tailwind CSS v4 design-system entry. Importing it here
// makes Vite (via @tailwindcss/vite) compile Tailwind and emit the CSS bundle
// into public/dist/, and the built index.html links it automatically.
import "./styles.css";
import { mount } from "svelte";
import App from "./ui/App.svelte";
import { createClientStore } from "./store/clientStore.ts";
import { createAppFlow } from "./app/flow.ts";
import { installErrorOverlay } from "./app/errorOverlay.ts";

// Before anything else: a framework-free net for uncaught errors and unhandled
// rejections, so a throw that wedges the UI still shows a message instead of a
// silent freeze.
installErrorOverlay();

const store = createClientStore();
const flow = createAppFlow(store);

const target = document.getElementById("app");
if (target) {
  mount(App, { target, props: { store, flow } });
}

// One health ping per page load (never a poll): the login screen stays gated
// until it answers, and refuses login if the server is offline.
void flow.checkHealth();
