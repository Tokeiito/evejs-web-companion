// A last-resort, framework-free error surface.
//
// WHY VANILLA DOM: a thrown error inside a Svelte `$effect`/`onMount` aborts that
// render flush, and if it recurs the page can stop updating entirely — the whole
// UI freezes while the underlying loops keep running, with nothing on screen to
// say why (exactly the "bot ran but the interface never changed" report). A
// banner built out of Svelte would be wedged by the same failure it is meant to
// report. So this pokes the DOM directly, installs before anything else, and
// never touches the store or the framework — it works even when they don't.
//
// It also catches unhandled promise rejections, which is how a background loop
// (`void run()`) dies without a trace.
//
// WHY IT ALSO TAKES REPORTS: `window.onerror` gives a message and a minified
// stack and nothing else. A production Svelte error thrown deep inside the each
// reconciler (`each_key_duplicate`) names no component at all — the report reads
// the same whichever list is at fault, which is useless when there are a hundred
// of them. `reportUiError` lets ui/ErrorBoundary.svelte name the panel that
// actually failed, so the copied-out report says WHERE.

let panel: HTMLElement | null = null;
let list: HTMLElement | null = null;
let count = 0;

function ensure(): HTMLElement | null {
  if (list !== null) {
    return list;
  }
  if (typeof document === "undefined") {
    return null;
  }
  try {
    panel = document.createElement("div");
    panel.setAttribute("role", "alert");
    Object.assign(panel.style, {
      position: "fixed", top: "0", left: "0", right: "0", zIndex: "2147483647",
      background: "#3b0d0d", color: "#ffd7d7",
      font: "12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
      padding: "10px 46px 12px 12px", borderBottom: "2px solid #ff6b6b",
      maxHeight: "45vh", overflow: "auto", whiteSpace: "pre-wrap", boxShadow: "0 2px 10px rgba(0,0,0,.55)",
    } as Partial<CSSStyleDeclaration>);

    const close = document.createElement("button");
    close.textContent = "Dismiss";
    Object.assign(close.style, {
      position: "absolute", top: "8px", right: "8px", background: "transparent", color: "#ffd7d7",
      border: "1px solid #ff6b6b", borderRadius: "4px", cursor: "pointer", padding: "4px 8px", minHeight: "28px",
    } as Partial<CSSStyleDeclaration>);
    close.addEventListener("click", () => {
      if (panel !== null) {
        panel.style.display = "none";
      }
    });

    const head = document.createElement("strong");
    head.textContent = "A script error occurred — the page may have stopped updating. Copy this and send it over:";
    Object.assign(head.style, { display: "block", marginBottom: "6px", color: "#ffbdbd" } as Partial<CSSStyleDeclaration>);

    list = document.createElement("div");
    panel.appendChild(close);
    panel.appendChild(head);
    panel.appendChild(list);
    (document.body ?? document.documentElement).appendChild(panel);
    return list;
  } catch {
    return null; // the overlay must never make things worse
  }
}

function show(message: string): void {
  try {
    // Console first: even if the DOM write fails, the message is somewhere.
    // eslint-disable-next-line no-console
    console.error("[eve error surface]", message);
    const target = ensure();
    if (target === null || panel === null) {
      return;
    }
    count += 1;
    const line = document.createElement("div");
    line.style.marginTop = "4px";
    line.textContent = `#${count}  ${message}`;
    target.appendChild(line);
    while (target.childNodes.length > 8 && target.firstChild !== null) {
      target.removeChild(target.firstChild);
    }
    panel.style.display = "block";
  } catch {
    /* swallow — reporting an error must not raise one */
  }
}

/**
 * The one class of `window.onerror` message this overlay deliberately swallows.
 *
 * ⚠ NARROW ON PURPOSE — IT MATCHES EXACTLY ONE KNOWN STRING. Filtering an error
 * surface is how an error surface becomes useless, so this is not a pattern to
 * extend without the same justification.
 *
 * "ResizeObserver loop completed with undelivered notifications" is not a script
 * error and nothing has failed. It is the browser SAYING SO: it detected that
 * delivering the remaining resize observations would re-dirty layout in the same
 * frame, so it deferred them to the next one. The page keeps working and the
 * observations arrive; the spec requires the notice purely so a developer can
 * find a genuine feedback loop.
 *
 * The reason to swallow it is that the overlay's headline reads "the page may
 * have stopped updating" — which, for this message, is FALSE and alarming, and
 * an operator who learns the banner cries wolf will dismiss the one that matters.
 * A real loop still shows up: it pegs a core and the picture visibly stutters.
 *
 * (The instance that prompted this was ours — the tactical viewport wrote canvas
 * size from inside its own observer callback. That cause is fixed in
 * `ui/Tactical.svelte`; this keeps the surface honest for any future one.)
 */
export function isBenignBrowserNotice(message: string): boolean {
  if (typeof message !== "string") {
    return false;
  }
  // Both wordings of the same condition: "…completed with undelivered
  // notifications" (current) and "…limit exceeded" (older Chrome). Both require
  // the "ResizeObserver loop" prefix, so neither can swallow an unrelated error
  // that happens to contain one of the tails.
  return (
    message.includes("ResizeObserver loop") &&
    (message.includes("undelivered notifications") || message.includes("limit exceeded"))
  );
}

function stackTail(value: unknown): string {
  if (value !== null && typeof value === "object" && "stack" in value) {
    const stack = (value as { stack?: unknown }).stack;
    if (typeof stack === "string") {
      return `\n${stack.split("\n").slice(0, 4).join("\n")}`;
    }
  }
  return "";
}

/**
 * Describe a caught error the way the overlay's own handlers do. `context` is
 * the human name of the thing that broke ("Overview", "Market") — the one fact
 * a minified framework stack can never supply.
 */
export function reportUiError(context: string, error: unknown): void {
  const message =
    error !== null && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error);
  show(`${context} stopped working: ${message}${stackTail(error)}`);
}

/** Install the global handlers. Idempotent; safe to call under SSR (no-ops). */
export function installErrorOverlay(): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const w = window as unknown as { __eveErrorOverlay?: boolean };
  if (w.__eveErrorOverlay === true) {
    return;
  }
  w.__eveErrorOverlay = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    if (isBenignBrowserNotice(event.message)) {
      return;
    }
    const where = event.filename ? ` @ ${event.filename}:${event.lineno}:${event.colno}` : "";
    show(`${event.message}${where}${stackTail(event.error)}`);
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const message =
      reason !== null && typeof reason === "object" && "message" in reason
        ? String((reason as { message?: unknown }).message)
        : String(reason);
    show(`Unhandled promise rejection: ${message}${stackTail(reason)}`);
  });
}
