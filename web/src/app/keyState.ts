// uicore.uilib.Key(uiconst.VK_SHIFT): whether Shift is held now, as the client asks it in the middle of an act (the
// fitting display's DisplayFitting, among others). The browser tells of the key with every key and pointer event; each
// is read in the capture phase, before any handler of the page's runs, and a window that loses the focus has none held.

let shift = false;

function track(event: KeyboardEvent | MouseEvent): void {
  shift = event.shiftKey;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  for (const type of ["keydown", "keyup", "pointerdown", "mousedown", "click", "dragstart"] as const) {
    window.addEventListener(type, track as EventListener, true);
  }
  window.addEventListener("blur", () => {
    shift = false;
  });
}

/** Whether Shift is held, as the last key or pointer event said. */
export function shiftHeld(): boolean {
  return shift;
}
