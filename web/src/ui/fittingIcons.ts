// Socket faces for the fitting window (goal R21): the icon a socket shows, and
// the short text it falls back to.
//
// ICONS ARE LOCAL ONLY. `scripts/cache-icons.js` has already downloaded the
// type icons into `data/icon-cache/`, and the BFF serves that directory at
// `config.iconCacheUrlPath` (`/icon-cache`). We link there and NOWHERE else —
// the browser never hits an external image host, so the client keeps working
// offline and leaks nothing about what the player is flying.
//
// The cache does not cover every type in the game, so a socket must survive a
// missing icon. The panel listens for the image's `error` event and swaps in
// `abbreviate(name)`; this module owns both halves of that pair.

/** Where the BFF serves the cached type icons (src/config.js). */
const ICON_BASE = "/icon-cache/types/64/icon";

/**
 * The local URL for a type's icon. This puts a typeID in an image URL, which
 * is NOT an R7d violation: R7d bans numeric IDs shown to the player AS DATA,
 * and this one is never rendered — it is an asset path, the same way the name
 * cache keys on an ID the player never sees.
 */
export function typeIconUrl(typeID: number): string | null {
  if (!Number.isSafeInteger(typeID) || typeID <= 0) {
    return null;
  }
  return `${ICON_BASE}/${typeID}.png`;
}

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
