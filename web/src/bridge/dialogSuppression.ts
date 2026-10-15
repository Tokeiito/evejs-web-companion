// "Do not ask again" on the client's dialogs (item 81's left parts).
//
// The client asks through prompt_player_fsd_dialog (player_messaging/client/dialog_handler.py
// _handle_player_fsd_dialog, 48 to 93; _prompt_player and _persist_prompt_suppress_choice, 96 to 135):
//
//   a dialog the install marks suppressable (dialogs.static's suppressable) is shown with a checkbox, worded
//   "/Carbon/UI/Common/DoNotAskAgain" where it asks a question and "DoNotShowAgain" where it only tells
//   (eve/client/script/ui/shared/messagebox.py prompt_player, 158 to 190);
//   ticked, and answered with the answer the call keeps (its suppress argument, else the dialog's own), that answer
//   is kept in the user's settings (settings.user.suppress, 'suppress.' and the dialog's name);
//   asked again with an answer kept, the dialog is not shown and the call's suppress argument is its answer.
//
// The dialogs the page asks that the client asks with suppress=uiconst.ID_YES, so that Yes alone is kept: the mail
// window's folder and list writes (evemail.py 1116 to 1158), the notification window's four (neocom/notifications.py
// 233 to 246; notificationSvc.py 223), a bookmark's removal (addressbookService.py DeleteBookmarks, 457 and 459), and
// the Locations window's folders and subfolders (bookmarksPanel.py DeleteACLFolder, DeleteSubfolder and
// CreateSubfolder, 435 to 487; locations/window.py _create_sub_folder, 152), and the folder window's two before a
// folder is made offline or with a name another has (bookmarkContainerWindow.py Confirm, 231 to 237).

export const ASKED_KEEPING_YES: ReadonlySet<string> = new Set([
  "EvemailMailMarkAllRead",
  "EvemailMailTrashAll",
  "EvemailMailRestoreAll",
  "EvemailMaillDeleteAll",
  "EvemailMailReadLabelGroup",
  "EvemailMailReadMailinglistGroup",
  "EvemailMailTrashLabelGroup",
  "EvemailMailTrashMailinglistGroup",
  "EvemailNotificationsDeleteAll",
  "EvemailNotificationsMarkAllRead",
  "EvemailNotificationsDeleteGroup",
  "EvemailNotificationsMarkGroupRead",
  "RemoveLocation",
  "RemoveMultipleLocation",
  "ConfirmDeleteFolder",
  "ConfirmDeleteSubfolder",
  "CreateBookmarkFolderAsNoneValid",
  "ConfirmCreateAsInactivePersonalFolder",
  "ConfirmCreateAsInactiveSharedFolder",
  "ConfirmCreateFolderWithDuplicateName",
]);

/** The checkbox's words on a dialog that asks (messagebox.py 164 to 168). */
export const DO_NOT_ASK_AGAIN_LABEL = "/Carbon/UI/Common/DoNotAskAgain";

/** Where the words store keeps whether a dialog may be kept: "1" where the install marks it suppressable. */
export const suppressableKey = (dialog: string): string => `dialog:${dialog}/suppressable`;
