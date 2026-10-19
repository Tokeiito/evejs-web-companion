import type { NamedAddressBook } from "../bridge/contacts.ts";

/** An owner's menu opens the existing address-book management or removal dialog. */
export interface ContactAction {
  readonly kind: "manage" | "remove";
  readonly ownerID: number;
  readonly name: string;
  readonly book: NamedAddressBook;
}
