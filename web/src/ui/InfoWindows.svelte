<script lang="ts">
  import { untrack } from "svelte";
  import type { Session } from "../app/sessions.ts";
  import type { InfoWindowState } from "../app/infoWindows.ts";
  import type { InfoWindowHost } from "./infoWindowHost.ts";
  import { portal } from "./portal.ts";
  import DesktopWindow from "./DesktopWindow.svelte";
  import ShowInfo from "./ShowInfo.svelte";
  import ErrorBoundary from "./ErrorBoundary.svelte";
  import { infoWindowLabel } from "./infoWindowLabel.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import { infoShiftPressed } from "./showInfo.ts";
  import { notify } from "./notices.ts";

  let { session, inFront, host }: { session: Session; inFront: boolean; host: InfoWindowHost | null } = $props();
  // svelte-ignore state_referenced_locally
  const windows = session.flow.infoWindows.state;
  // svelte-ignore state_referenced_locally
  const raised = session.flow.infoWindows.raised;
  // svelte-ignore state_referenced_locally
  const names = session.store.names;
  // svelte-ignore state_referenced_locally
  const words = session.store.words;
  // svelte-ignore state_referenced_locally
  const model = session.flow.infoWindows;
  const visible = $derived(inFront && host !== null);
  const mobileID = $derived($windows.filter(w => !w.minimized).reduce<InfoWindowState | null>((top, w) => !top || w.z > top.z ? w : top, null)?.id ?? null);
  let servedRaise = 0;
  $effect(() => {
    const r = $raised;
    if (!r || r.n === servedRaise || !visible || !host) return;
    servedRaise = r.n;
    untrack(() => { host!.reveal(); model.focus(r.id, host!.topZ() + 1); });
  });
  function fit(): void {
    if (!host || host.mobile) return;
    const width = host.element.clientWidth, height = host.element.clientHeight;
    if (!width || !height) return;
    for (const w of windows.get()) {
      const ww = Math.min(w.w, width), hh = Math.min(w.h, height);
      model.geometry(w.id, { w: ww, h: hh, x: Math.min(Math.max(0, w.x), Math.max(0, width - ww)), y: Math.min(Math.max(0, w.y), Math.max(0, height - hh)) });
    }
  }
  $effect(() => { if (!host) return; const observer = new ResizeObserver(fit); observer.observe(host.element); fit(); return () => observer.disconnect(); });
  $effect(() => { $windows; untrack(fit); });
  $effect(() => { session.flow.requestWords(["UI/Control/EveWindow/Previous", "UI/Control/EveWindow/Next"]); });
  function word(key: string, fallback: string): string { return plainText($words.templates[key] ?? "") || fallback; }
  function focus(w: InfoWindowState): void { model.focus(w.id, (host?.topZ() ?? Math.max(0, ...windows.get().map(w => w.z))) + 1); }
  function resize(w: InfoWindowState, width: number, height: number): void { model.geometry(w.id, { x: w.x, y: w.y, w: Math.max(260, width), h: Math.max(120, height) }); fit(); }
  function navigate(w: InfoWindowState, direction: -1 | 1): void {
    void model.navigate(w.id, direction, infoShiftPressed()).catch(error => { if (error?.code !== "SESSION_REQUEST_RETIRED") notify({ kind: "danger", title: "Show Info", detail: error instanceof Error ? error.message : String(error) }); });
  }
</script>

{#snippet contents(w: InfoWindowState)}
  <nav class="info-history" aria-label="Information history">
    <button type="button" class="minor" disabled={w.index === 0} onclick={() => navigate(w, -1)}>{word("UI/Control/EveWindow/Previous", "Previous")}</button>
    <button type="button" class="minor" disabled={w.index >= w.history.length - 1} onclick={() => navigate(w, 1)}>{word("UI/Control/EveWindow/Next", "Next")}</button>
  </nav>
  <ErrorBoundary name={infoWindowLabel(w, $names.resolved)}><ShowInfo store={session.store} flow={session.flow} subject={w.subject} /></ErrorBoundary>
{/snippet}

<div use:portal={host?.element ?? document.body} class="info-window-layer" class:info-phone={host?.mobile} style:display={visible ? undefined : "none"}>
  {#each $windows as w (w.id)}
    {#if w.modal}
      <div use:portal class="info-modal-shade" style:display={visible && !w.minimized ? undefined : "none"}>
        <div class="info-modal" tabindex="-1" role="dialog" aria-modal={visible && !w.minimized} aria-label={infoWindowLabel(w, $names.resolved)}>
          <header><strong>{infoWindowLabel(w, $names.resolved)}</strong><button type="button" class="minor" aria-label="Close" onclick={() => model.close(w.id)}>✕</button></header>
          <div class="info-modal-body">{@render contents(w)}</div>
        </div>
      </div>
    {:else}
      <DesktopWindow win={{ ...w, minimized: w.minimized || (!!host?.mobile && w.id !== mobileID) }} title={infoWindowLabel(w, $names.resolved)} focused={w.z >= (host?.topZ() ?? 0)}
        onFocus={() => focus(w)} onClose={() => model.close(w.id)} onToggleMinimize={() => model.minimize(w.id)}
        onMove={(x, y) => model.geometry(w.id, { x, y, w: w.w, h: w.h })} onResize={(width, height) => resize(w, width, height)}>
        {@render contents(w)}
      </DesktopWindow>
    {/if}
  {/each}
  {#if host?.mobile && $windows.length}
    <nav class="info-phone-tabs" aria-label="Information windows">
      {#each $windows as w (w.id)}<button type="button" class="minor" aria-pressed={w.id === mobileID} onclick={() => { if (w.minimized) model.minimize(w.id); else focus(w); }}>{infoWindowLabel(w, $names.resolved)}</button>{/each}
    </nav>
  {/if}
</div>

<style>
  .info-window-layer { position: absolute; inset: 0; pointer-events: none; }
  .info-window-layer :global(.win), .info-phone-tabs { pointer-events: auto; }
  .info-history { display: flex; gap: .4rem; margin-bottom: .5rem; }
  .info-phone :global(.win) { left: 0 !important; top: 0 !important; width: 100% !important; height: calc(100% - 2.8rem) !important; z-index: 10 !important; border-radius: 0; }
  .info-phone :global(.win-resize) { display: none; }
  .info-phone :global(.win-body) { overscroll-behavior: contain; }
  .info-modal header { display: flex; align-items: center; gap: .4rem; padding: .5rem; border-bottom: 1px solid #364353; }
  header strong { flex: 1; min-width: 0; }
  .info-modal-body { padding: .6rem; overflow: auto; min-height: 0; flex: 1; }
  .info-phone-tabs { position: absolute; bottom: 0; left: 0; right: 0; display: flex; gap: .3rem; overflow-x: auto; height: 2.6rem; background: var(--color-bg, #0a111a); z-index: 11; }
  .info-phone-tabs button { flex: 0 0 auto; }
  .info-modal-shade { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; background: #0008; }
  .info-modal { width: min(500px, calc(100vw - 1rem)); max-height: calc(100dvh - 1rem); background: var(--color-bg, #0a111a); border: 1px solid #526476; display: flex; flex-direction: column; }
</style>
