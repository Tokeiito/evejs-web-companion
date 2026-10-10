// The account's clone grade, as the retail client's clone grade service has it (omega/client/clone_grade_svc.py).
//
// The client asks subscriptionMgr.GetCloneGrade() as the account logs in (gameui.py 450) and keeps the answer; the
// server's notice of a change, OnSubscriptionChangedServer(new_state), is the grade from then on (243). The grade
// is one of two (clonegrade/const.py): an alpha clone's, or an omega's.
//
// The page reads it of the BFF as a pilot comes online, and takes the notice's word after. A pilot whose
// connection does not carry it (the web gateway) has none here, and what goes by the grade is then as it is for
// an omega clone.

export type CloneGrade = 0 | 1;
export const CLONE_GRADE_ALPHA = 0;
export const CLONE_GRADE_OMEGA = 1;

/** The server's notice that the grade has changed. */
export const CLONE_GRADE_NOTICE = "OnSubscriptionChangedServer";

/** A grade off the wire or out of a notice; null for what is neither grade. */
export function cloneGradeOf(value: unknown): CloneGrade | null {
  return value === CLONE_GRADE_ALPHA || value === CLONE_GRADE_OMEGA ? value : null;
}
