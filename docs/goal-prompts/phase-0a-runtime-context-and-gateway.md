# Goal Prompt: Phase 0A Runtime Context and Gateway Shell

Use the following prompt as a single Goal-mode run.

```text
Implement Goal 0A from the EveJS browser-client roadmap: explicit EveJS runtime-context injection and a versioned web-gateway shell.

Repositories:
- EveJS: C:\Users\ryanf\Documents\GitHub\eve.js
- Web app: C:\Users\ryanf\Documents\GitHub\evejs-web-poc

Read this planning document before changing code:
C:\Users\ryanf\Documents\GitHub\evejs-web-poc\docs\web-client-scope-and-roadmap.md

Objective:
Create the stable EveJS-side integration point that later character leases, commands, event streaming, query projections, and browser-pilot sessions will use. The existing Express secondary server must mount a new versioned web gateway with explicit access to the live EveJS runtime/service context, and the web app must use that gateway end to end.

Required work:
1. Inspect the current EveJS startup path, secondary-service loader, Express secondary server, existing web endpoint implementations, service manager, and tests before choosing the exact design.
2. Pass an explicit runtime context from EveJS startup into enabled secondary services. At minimum, the Express secondary service and web gateway must be able to access the live serviceManager without importing a second instance or using gameplay SQLite as an integration mechanism.
3. Make the context boundary testable. Prefer dependency injection over a mutable process-global singleton.
4. Mount every EveJS web endpoint exclusively under /_evejs-web/v1. Remove the unversioned /_evejs-web routes and ensure unknown or old paths return 404 instead of reaching Express's generic proxy fallback.
5. Add GET /_evejs-web/v1/health using the server-to-server gateway authorization policy. Return a stable JSON shape containing ok, source, apiVersion, gateway capabilities, and whether required runtime dependencies are ready. Do not expose secrets or raw internal objects.
6. Update the web app's gateway client and every account, character, snapshot, skill queue, PI, status, and market call to require v1. Preserve current application behavior by migrating it, not by retaining old routes or retrying through a fallback.
7. Add focused tests for context propagation, endpoint authorization/response shape, the exact v1 route manifest, 404 behavior for old paths, strict source/version validation, and proof that the web client never retries an unversioned endpoint.
8. Update the roadmap's Goal 0A row or add a short execution-status section with the final status, files changed, tests run, and any consciously deferred work.

Architectural constraints:
- The web process must not read or write gameplay SQLite directly.
- EveJS remains authoritative for in-memory state and persistence.
- Do not call retail-protocol Handle_* methods from the web gateway.
- Do not create another HTTP server; mount the gateway into the existing Express secondary service.
- Do not expose the server-to-server gateway token to browser JavaScript.
- Preserve unrelated user changes in both worktrees. The EveJS worktree may already be dirty.
- Keep edits narrowly scoped and cut both repositories over atomically; do not keep compatibility aliases or fallback transports.

Explicitly out of scope for Goal 0A:
- character leases or changing online-status semantics;
- gameplay command execution or mutation endpoints;
- command queues, idempotency, or state versions;
- WebSockets or event streaming;
- autopilot, browser pilot sessions, undocking, or space movement;
- agent or courier mission UI;
- combat, mining, or advanced gameplay;
- broad frontend redesign;
- commits, pushes, or pull requests.

Definition of done:
- The live EveJS serviceManager reaches the Express/web-gateway mount through an explicit, testable context path.
- /_evejs-web/v1/health is authenticated and reports API version 1 plus runtime readiness.
- Every EveJS web endpoint and web-client request uses /_evejs-web/v1 and the v1 gateway response identity.
- Old unversioned paths return 404, no legacy source or fallback machinery remains, and current web features continue through v1.
- Syntax checks and focused automated tests pass.
- Any temporary EveJS process started for verification is stopped before completion; do not stop processes you did not start.
- The roadmap records the result and evidence.

Execution behavior:
Work autonomously through inspection, implementation, tests, and documentation. Do not stop after proposing a design. Make reasonable local decisions that follow existing repository patterns. Ask for input only if a choice would materially change the architecture or require expanding the stated scope. Stop when Goal 0A is complete; do not begin Goal 0B.
```
