// The multibuy window's "Use corporation account" (buySellMultiBase.DrawCheckBox, 122 to 127: settings.user.ui
// 'buyUseCorp', off until ticked; OnUseCorp, 155 to 162, keeps it as it is ticked). The client keeps it for its user
// on that machine; the page keeps it in this browser, for every pilot in it.

const KEPT = "evejs-web-user-ui:buyUseCorp";

/** Whether the window buys from the corporation's wallet where it offers to. */
export function buyUseCorp(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEPT) === "1";
  } catch {
    return false;
  }
}

/** The setting ticked or unticked, and kept in this browser. */
export function setBuyUseCorp(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEPT, on ? "1" : "0");
  } catch {
    // Not kept: it holds for this page's life.
  }
}
