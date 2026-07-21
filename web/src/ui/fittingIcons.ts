// Socket TEXT for the fitting window (goal R21): the short name a socket shows
// when there is no cached picture for what is fitted there.
//
// R27 moved the icon rules themselves out to `typeIcons.ts` + `TypeIcon.svelte`
// so that every panel shares one implementation. What stayed here is the part
// that is genuinely specific to a socket: a socket is the ONE place in the app
// where the fallback is the ONLY text — every other caller renders the item's
// full name right next to the icon, so a two-letter tile is enough there. A
// socket has no room for a neighbour, so it needs a name it can actually read.

/**
 * A module's name shortened to something that fits inside a socket, for when
 * no icon is cached. It keeps the parts a player actually recognises:
 *
 *   "425mm AutoCannon II"          -> "425mm AC II"
 *   "Large Shield Extender II"     -> "Lg Shield Ext II"
 *   "Damage Control II"            -> "Damage Ctrl II"
 *
 * The full name is always in the socket's tooltip and accessible name, so this
 * is a visual convenience and never the only way to read what is fitted.
 */
export function abbreviate(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed.length <= 12) {
    return trimmed;
  }
  const SHORT: Readonly<Record<string, string>> = {
    autocannon: "AC",
    artillery: "Arty",
    extender: "Ext",
    control: "Ctrl",
    hardener: "Hard",
    amplifier: "Amp",
    membrane: "Memb",
    stabilizer: "Stab",
    stabilizers: "Stab",
    repairer: "Rep",
    magnetic: "Mag",
    multispectrum: "Multi",
    afterburner: "AB",
    microwarpdrive: "MWD",
    launcher: "Lchr",
    accelerator: "Accel",
    computer: "Comp",
    processor: "Proc",
    upgrade: "Upg",
    expanded: "Exp",
    cargohold: "Cargo",
    large: "Lg",
    medium: "Md",
    small: "Sm",
    compact: "C",
    enduring: "E",
  };
  const words = trimmed.split(/\s+/).map((word) => {
    const key = word.toLowerCase().replace(/[^a-z]/g, "");
    return SHORT[key] ?? word;
  });
  const shortened = words.join(" ");
  // Still too long? Keep the head and the tier marker at the tail ("II"),
  // because "Gyrostabilizer II" and "Gyrostabilizer I" must stay distinct.
  const LIMIT = 16;
  if (shortened.length <= LIMIT) {
    return shortened;
  }
  const last = words[words.length - 1]!;
  const tier = /^(I{1,3}|IV|V|X)$/i.test(last) ? ` ${last}` : "";
  const head = tier ? words.slice(0, -1).join(" ") : shortened;
  const room = Math.max(3, LIMIT - tier.length - 1);
  return `${head.slice(0, room).trimEnd()}…${tier}`;
}
