// What the mail window is to show when a popup is clicked (notificationCenter.OnEntryClick, 304 to 410):
//
//   a new mail's popup opens the mail (mailSvc.OnOpenPopupMail);
//   any other notification's opens the mail window's notifications on its type's group and selects it
//   (mailInteractor.py SelectByNotificationID, 37 to 41: SelectGroupForTypeID, then SelectNodeByNotificationID,
//   which the window reads a second after, as any selection).
//
// The popup sets it and opens the mail window; Mail.svelte takes a mail's, MailNotifications.svelte a
// notification's, each clearing it as it is served. `n` tells one ask from the next of the same thing.

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";

export type MailFocus =
  | { readonly kind: "mail"; readonly messageID: number; readonly n: number }
  | { readonly kind: "notification"; readonly notificationID: number; readonly typeID: number; readonly n: number };

const focus = createSignal<MailFocus | null>(null);
let asked = 0;

export const mailFocus: ReadableSignal<MailFocus | null> = readonlySignal(focus);

/** Ask the mail window to show a mail, or a notification. */
export function focusMail(next: { readonly kind: "mail"; readonly messageID: number } | { readonly kind: "notification"; readonly notificationID: number; readonly typeID: number }): void {
  asked += 1;
  focus.set({ ...next, n: asked });
}

/** The ask served: cleared, where it is still the one served. */
export function mailFocusServed(n: number): void {
  if (focus.get()?.n === n) focus.set(null);
}
