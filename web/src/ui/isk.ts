// ISK amount formatting for the wallet panels (goal R50, R9a "plain player
// language" + R7d "a currency amount is fine, an ID is not").
//
// The amount arrives as a bigint-safe decimal string (the decoder rule keeps
// ISK exact past 2^53). This formats it WITHOUT going through Number, so a
// balance larger than 2^53 groups exactly rather than rounding — the same
// invariant the mission-bot panel test pins ("ISK is formatted without going
// through Number").

/**
 * Group an ISK amount for display: thousands-separated whole part, up to two
 * fractional digits, a trailing " ISK". "—" for a null (not-yet-read) amount.
 * A value that is not a plain decimal string is returned verbatim rather than
 * invented into something else.
 */
export function formatIsk(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) {
    return value;
  }
  const sign = match[1] ?? "";
  // BigInt, never Number — a >2^53 balance must stay exact.
  const whole = BigInt(match[2] ?? "0").toLocaleString("en-US");
  const frac = (match[3] ?? "").slice(0, 2).replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""} ISK`;
}
