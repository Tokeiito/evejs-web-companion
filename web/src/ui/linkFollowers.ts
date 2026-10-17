// A link in a chat message or a mail's body, followed as the client's link registry follows it (evelink/client:
// registry.register, each scheme with its handler, hint and colour), for every text the client shows links in:
//
//   skillPlan        link.py handle_link: the Skills window opens on the plan (registered with no colour of its own:
//                    default_link_color_info); its hint UI/SkillPlan/SkillPlan
//   showinfo         handle_show_info_link: Show Info on the type, or on the pilot for a pilot's link
//                    (default_with_subtle_color_info); its hint UI/Commands/ShowInfo; a corporation's, an alliance's, a
//                    faction's or a place's link the page's window does not show yet, and it is not followed
//   http, https      handle_web_link: ExternalLinkWarning, then a tab of its own (external_link_color_info); its hint
//                    the url
//
// Any other link is not followed (shown underlined, its url its hint). The colours are styles.css's `.evelink`.

import type { AppFlow } from "../app/flow.ts";
import { parseSkillPlanUrl } from "../bridge/skillPlanLink.ts";
import { linkScheme } from "../bridge/showInfoLink.ts";
import { showInfo, subjectOfShowInfoLink } from "./showInfo.ts";

/** The links' hints, the page's own words where the install's are not to hand. */
export const LINK_WORDS: Readonly<Record<string, string>> = {
  "UI/SkillPlan/SkillPlan": "Skill plan",
  "UI/Commands/ShowInfo": "Show information",
};

export interface LinkFollower {
  /** Its registry's kind, for its colour (styles.css .evelink.skillPlan, .showInfo, .web). */
  readonly kind: "skillPlan" | "showInfo" | "web";
  readonly hint: string;
  readonly follow: () => void;
}

/**
 * How a link is followed, or null where the page does not follow it. openSkillPlanLink opens the Skills window on a
 * plan (none where the text's window cannot); word is the install's words for the hints (LINK_WORDS).
 */
export function linkFollowerOf(
  url: string,
  flow: Pick<AppFlow, "followWebLink">,
  openSkillPlanLink: ((url: string) => void) | null,
  word: (label: string) => string,
): LinkFollower | null {
  const scheme = linkScheme(url);
  if (scheme === "skillplan" && openSkillPlanLink !== null && parseSkillPlanUrl(url) !== null) {
    return { kind: "skillPlan", hint: word("UI/SkillPlan/SkillPlan"), follow: () => openSkillPlanLink(url) };
  }
  if (scheme === "showinfo") {
    const subject = subjectOfShowInfoLink(url);
    return subject === null ? null : { kind: "showInfo", hint: word("UI/Commands/ShowInfo"), follow: () => showInfo(subject) };
  }
  if (scheme === "http" || scheme === "https") {
    return { kind: "web", hint: url, follow: () => void flow.followWebLink(url) };
  }
  return null;
}
