// Vite build for the TS web stack (goal R1b). The TS app lives in web/ and
// builds into public/dist/, which the existing Express static setup
// (src/server.js, express.static(public)) serves at /dist/ alongside the
// untouched vanilla app. No dev server is required to ship: `npm run build:web`
// then `npm start` is the production arrangement.
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

const bffTarget = process.env.EVEJS_WEB_BFF_URL || "http://127.0.0.1:26500";

export default defineConfig({
  root: "web",
  plugins: [svelte()],
  // Built asset URLs are absolute under /dist/ so the bundle works when the
  // Express static middleware serves public/dist/ at /dist/.
  base: "/dist/",
  build: {
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
