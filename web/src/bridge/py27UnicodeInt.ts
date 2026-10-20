// int(unicode) in build3396210's narrow Stackless2.7 runtime. An exhaustive
// BMP walk in its python27.dll measured these 35 decimal ranges, U+19DA's
// exceptional value1, and these 30 whitespace characters. Modern Unicode
// property expressions have different assignments. Unrecognized code units
// above Latin1 fail in decimal encoding before the integer parser runs.
const DECIMAL_ZEROES = [48, 1632, 1776, 1984, 2406, 2534, 2662, 2790, 2918,
  3046, 3174, 3302, 3430, 3664, 3792, 3872, 4160, 4240, 6112, 6160, 6470,
  6608, 6784, 6800, 6992, 7088, 7232, 7248, 42528, 43216, 43264, 43472,
  43600, 44016, 65296];
const WHITESPACE = new Set([9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160,
  5760, 6158, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201,
  8202, 8232, 8233, 8239, 8287, 12288]);

/** PyUnicode_EncodeDecimal's text, to be parsed by the existing int consumer. */
export function unicodeIntText(text: string): string {
  let encoded = "";
  // charCodeAt deliberately walks UTF16 code units, as this narrow runtime
  // does. A supplementary character's surrogate fails before int parsing.
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const zero = DECIMAL_ZEROES.find(start => code >= start && code < start + 10);
    if (zero !== undefined) encoded += String(code - zero);
    else if (code === 0x19da) encoded += "1";
    else if (WHITESPACE.has(code)) encoded += " ";
    else if (code <= 255) encoded += text[index];
    else throw Object.assign(new Error("Invalid decimal Unicode string for int()."), {
      name: "UnicodeEncodeError", code: "INFO_CORPORATION_ENLISTMENT_OWNER_KEY",
    });
  }
  return encoded;
}
