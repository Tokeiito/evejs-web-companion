// The client's skill action's pieces as the skill requirement window and the Fitting window's skill tooltip draw them: the
// apply-points button (skillBtns.ApplySkillPointsButton) and a training time as the panels write it.

import { shortWrittenInterval } from "../bridge/timeInterval.ts";
import { showMarketDetails } from "./marketDetails.ts";

/** inventorycommon.const typeSkillInjector: what the apply-points button's market details are of, without free points. */
export const TYPE_SKILL_INJECTOR = 40520;
/** inventorycommon.const typeAlphaTrainingInjector: what an alpha clone's apply-points button offers in the store. */
export const TYPE_ALPHA_TRAINING_INJECTOR = 46375;

/**
 * The apply-points button (UpdateState and ClickFunc): with free points it puts them into the levels (`applyPoints`),
 * offered where no book is missing; without, an omega clone's opens the Skill Injector's market details (`close`
 * first), and an alpha clone's the store at the Alpha Training Injector (vgsService.OpenStore), which the page has
 * not: `why`.
 */
export function applyPointsButton(
  record: { readonly freeSkillPoints: number; readonly offerInjection: boolean; readonly omega: boolean },
  word: (label: string, args?: Readonly<Record<string, string | number>>) => string,
  applyPoints: () => void,
  close: () => void,
): { readonly hint: string; readonly enabled: boolean; readonly why?: string; readonly use: () => void } {
  if (record.freeSkillPoints > 0) return { hint: word("UI/SkillQueue/ApplySkillPoints"), enabled: record.offerInjection, use: applyPoints };
  if (!record.omega) {
    return { hint: word("UI/Market/MarketQuote/BuyType", { typeID: TYPE_ALPHA_TRAINING_INJECTOR }), enabled: false, why: "The page has no store.", use: () => {} };
  }
  return {
    hint: word("UI/Market/MarketQuote/BuyType", { typeID: TYPE_SKILL_INJECTOR }),
    enabled: true,
    use: () => {
      close();
      showMarketDetails(TYPE_SKILL_INJECTOR);
    },
  };
}

/**
 * A training time as the panels write it (FormatTimeIntervalShortWritten(time, showTo=TIME_CATEGORY_MINUTE)), in the
 * install's words; the page's own where they are not to hand. None is `complete` (Training Complete).
 */
export function trainingTimeText(ticks: number | null, templates: Parameters<typeof shortWrittenInterval>[1], complete: string): string {
  if (ticks === null || !(ticks > 0)) return complete;
  const written = shortWrittenInterval(BigInt(Math.trunc(ticks)), templates, "year", "minute");
  if (written !== null) return written;
  const minutes = Math.ceil(ticks / 600_000_000);
  const [days, hours, mins] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  return [days > 0 ? `${days}d` : "", hours > 0 ? `${hours}h` : "", mins > 0 || minutes === 0 ? `${mins}m` : ""].filter(Boolean).join(" ");
}
