// The client's "Auto-reject invitations" (systemmenu.py ConstructChatSettings, 1208: the system menu's Audio & Chat,
// its Chat section; settings.user.ui autoRejectInvitations, off until ticked). Its fleet service turns a fleet's
// invitation away unasked with it on (fleetSvc.OnFleetInvite, 1183 to 1185: RejectInvite(False), unless the pilot
// applied to that fleet or the invitation says autoAccept), and so does its chat a channel's (xmppchatsvc.py 581 to
// 585).
//
// The client keeps it for its user on that machine; the page keeps it in this browser, for every pilot in it.

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";

const KEPT = "evejs-web-user-ui:autoRejectInvitations";

function readKept(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEPT) === "1";
  } catch {
    return false;
  }
}

const setting = createSignal(readKept());

/** Whether invitations are turned away unasked. */
export const autoRejectInvitations: ReadableSignal<boolean> = readonlySignal(setting);

/** The setting ticked or unticked, and kept in this browser. */
export function setAutoRejectInvitations(on: boolean): void {
  setting.set(on);
  try {
    globalThis.localStorage?.setItem(KEPT, on ? "1" : "0");
  } catch {
    // Not kept: it holds for this page's life.
  }
}
