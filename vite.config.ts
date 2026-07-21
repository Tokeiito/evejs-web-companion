// Vite build for the TS web stack (goal R1b). The TS app lives in web/ and
// builds into public/dist/, which src/server.js serves at the ROOT — this is
// the only app now. No dev server is required to ship: `npm run build:web`
// then `npm start` is the production arrangement.
//
// R45: the vanilla app that used to own "/" (public/index.html, app.js,
// styles.css, commandClient.js, eventClient.js, mutationScope.js) is deleted.
// It had been dead since R9b — all six of its tabs fetched a retired route
// family and got index.html back with a 200, so nothing ever surfaced the
// breakage. The SPA became a strict superset at R41 and now serves "/".
//
// Dev arrangement (optional): `npm run dev:web` runs the Vite dev server on
// its default port (5173) and proxies /api and /icon-cache to the running BFF
// (default http://127.0.0.1:26500), so the TS app can iterate with hot reload
// while the BFF keeps owning auth, the bridge proxy, and static vanilla pages.
// Override the proxy target with EVEJS_WEB_BFF_URL if the BFF runs elsewhere.
import { defineConfig } from "vite";
// View library (locked by the R2 spike): Svelte 5. Components stay thin pure
// readers of the framework-agnostic signal store (web/src/store), which
// implements the Svelte store contract so `$slice` auto-subscription works.
import { svelte } from "@sveltejs/vite-plugin-svelte";
// Styling (goal R8): Tailwind CSS v4 via its first-party Vite plugin. The
// CSS-first entry (web/src/styles.css: `@import "tailwindcss"`) is imported
// from main.ts, so Vite emits the compiled Tailwind bundle into public/dist/
// alongside the app and the built index.html links it. Presentation only —
// no change to the store, flow, or bridge.
import tailwindcss from "@tailwindcss/vite";

const bffTarget = process.env.EVEJS_WEB_BFF_URL || "http://127.0.0.1:26500";

export default defineConfig({
  root: "web",
  plugins: [svelte(), tailwindcss()],
  // Built asset URLs are absolute under "/" because the Express static
  // middleware serves public/dist/ AT THE ROOT (R45). This must stay in step
  // with where src/server.js mounts the build: emit /dist/assets/* while the
  // document is served at "/" and the browser gets a document that loads and
  // two assets that 404 — a blank page with no error anywhere.
  base: "/",
  build: {
    // Keep the output in its OWN directory. Pointing outDir at public/ itself
    // would let emptyOutDir wipe sibling files on every build.
    outDir: "../public/dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    proxy: {
      "/api": bffTarget,
      "/icon-cache": bffTarget,
    },
  },
});
