// A launchpad's goods sent up into its planet's customs office by the page itself (the plan's Phase 6b): the
// second of the page's own calls on an inventory's own object, after a module's fitting (bridge/fitModule.ts).
//
// Until 2026-10-13 it was a route of the BFF's (POST /api/bridge/planet/customs/export), which read the pilot's
// flight to refuse a docked pilot, asked the office's tax rate, and made the transfer naming it.
//
// THE CALLS, as the client's customs window makes them (eve/client/script/ui/shared/planet/importExportUI.py):
//
//   the office's tax rate   UpdateTaxRate (382 to 385):
//                             eveMoniker.GetPlanetOrbitalRegistry(session.solarsystemid).GetTaxRate(officeID)
//                           on a Moniker for the system the session is in space in. None where the office's
//                           owner does not let the pilot use it: the window then says so, and refuses an export
//                           (ExportCommodity, 467 to 469: PortStandingCheckFail).
//   the transfer            ConfirmCommodityTransfer (537 to 558), on the office's own inventory:
//                             invCache.GetInventoryFromId(officeID).ImportExportWithPlanet(spaceportPinID,
//                               importData, exportData, self.taxRate)
//                           what comes down a dict of quantities by the item in the office, what goes up a dict
//                           of quantities by type, and the rate the registry answered.
//
// The window is opened at an office, in space (ApplyAttributes, 81 to 103: the office's slim item from the
// ballpark), and its registry Moniker is for the system the session is in space in: a docked client has neither.
// The page asks it only where the pilot is in space, as the route did. Up only: nothing comes down here.
//
// WHAT THE SERVER TAKES FROM THE CALLER (read 2026-10-09, at the route's making): the colony from the session's
// own character and the pin, the office checked to be that colony's planet's, the tax from the session's own
// wallet. A pin or an office that is not the pilot's own to use moves nothing. A rate that is not the office's is
// refused, TaxChanged.

import type { Ask } from "./ask.ts";

/** What the window says where the registry names no rate (CustomsOfficeAccessDenied), as the route said it. */
export const CUSTOMS_ACCESS_DENIED = "This customs office named no tax rate: its owner does not let this pilot use it.";

/** Where the pilot is: docked at a station or a structure, or in space (null). */
export interface CustomsPlace {
  readonly dockedAt: number | null;
}

const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** The registry's rate as a number, however the wire spelled it; null for none. */
export function taxRateOf(answer: unknown): number | null {
  const value = answer !== null && typeof answer === "object" && (answer as { type?: unknown }).type === "real"
    ? (answer as { value?: unknown }).value
    : answer;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Sends one launchpad's goods up into the customs office: the office's tax rate asked, and the transfer made on
 * the office's own inventory naming that rate, as it was answered. Fails as either call fails, and where the
 * office names no rate.
 */
export async function exportToCustomsOffice(
  ask: Ask,
  act: Ask,
  place: CustomsPlace,
  officeID: number,
  pinID: number,
  commodities: Readonly<Record<number, number>>,
): Promise<void> {
  const given = Object.entries(commodities);
  if (!whole(officeID) || !whole(pinID) || given.length === 0 || !given.every(([typeID, quantity]) => /^\d+$/.test(typeID) && whole(Number(typeID)) && whole(quantity))) {
    throw new Error("A customs office, a launchpad and a whole quantity of each commodity are required.");
  }
  if (place.dockedAt !== null) throw new Error("The ship is not in space; undock first.");
  const answered = await ask("planetOrbitalRegistryBroker", "GetTaxRate", [officeID]);
  if (taxRateOf(answered) === null) throw new Error(CUSTOMS_ACCESS_DENIED);
  await act("invbroker", "ImportExportWithPlanet", [pinID, {}, Object.fromEntries(given), answered], null, officeID);
}
