// The labels' colours, the mail's and the contacts' alike (mailSvc.py swatchColors, 31 to 48): eighteen numbers, each
// an RGB hex, offered in this order by the mail's colour window (MailAssignColorWnd: swatchColors.values()).

/** The labels' colours by their numbers, each an RGB hex. */
export const SWATCH_COLORS: Readonly<Record<number, string>> = Object.freeze({
  0: "ffffff",
  1: "ffff01",
  2: "ff6600",
  3: "fe0000",
  4: "9a0000",
  5: "660066",
  6: "0000fe",
  7: "0099ff",
  8: "01ffff",
  9: "00ff33",
  10: "349800",
  11: "006634",
  12: "666666",
  13: "999999",
  14: "e6e6e6",
  15: "ffffcd",
  16: "99ffff",
  17: "ccff9a",
});

/** The swatches' numbers, in the colour window's order. */
export const SWATCH_IDS: readonly number[] = Object.freeze(Object.keys(SWATCH_COLORS).map(Number).sort((left, right) => left - right));

const isSwatch = (color: number | null | undefined): color is number => typeof color === "number" && Object.prototype.hasOwnProperty.call(SWATCH_COLORS, color);

/**
 * A label's name's colour, as the client writes it in a label line (addressbookService.py GetLabelText, 1189 to 1202;
 * evemail.py GetLabelText, 697 to 714: `<color=0xBF…>`, its swatch at three quarters' opacity), as a CSS colour. None
 * for no colour, one that is no swatch's, or white: the client's white is its own light text, and the page's own text
 * colour stands for it.
 */
export function labelSwatch(color: number | null | undefined): string | null {
  if (!isSwatch(color) || SWATCH_COLORS[color] === "ffffff") return null;
  return `#${SWATCH_COLORS[color]}bf`;
}

/**
 * A label's colour tag beside its name in the mail's folders (evemail.py MailLabelEntry.Load, 1501 to 1513, and
 * MailGroup.Load, 1420 to 1428: an eight-pixel square of its swatch at 0.75 opacity), as a CSS colour; none for no
 * colour or white, which the client draws no tag for.
 */
export function swatchTag(color: number | null | undefined): string | null {
  if (!isSwatch(color) || SWATCH_COLORS[color] === "ffffff") return null;
  return `#${SWATCH_COLORS[color]}`;
}

/** A swatch's own colour, for the colour window's squares. */
export function swatchColor(color: number): string {
  return `#${SWATCH_COLORS[color] ?? "ffffff"}`;
}
