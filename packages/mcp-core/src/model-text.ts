/**
 * Text from bConnect that reaches the model (REQ-XC-001 AC 2, REQ-XC-006 AC 2).
 *
 * Control characters, invisible characters and characters that change the
 * reading direction are removed, so the text the model reads is the text a
 * person sees; line breaks become spaces, so quoted text stays on one line.
 */

const DEFAULT_MAX_LENGTH = 300;

const FORMAT_CHARACTER = /\p{Cf}/u;

/**
 * True for a code point that is removed outright: every Unicode format character
 * (soft hyphen, zero-width characters, bidi marks, embeddings, overrides and
 * isolates, Arabic letter mark, BOM, tag characters U+E0000-E007F), the
 * combining grapheme joiner and the variation selectors.
 */
function isHidden(ch: string, cp: number): boolean {
  return (
    FORMAT_CHARACTER.test(ch) ||
    cp === 0x034f ||                       // combining grapheme joiner
    (cp >= 0xfe00 && cp <= 0xfe0f) ||      // variation selectors
    (cp >= 0xe0100 && cp <= 0xe01ef)       // variation selectors supplement
  );
}

/** True for a code point that becomes a space (C0/C1 controls, line and paragraph separators). */
function isBreaking(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029; // C1 includes NEL U+0085
}

/**
 * Clean bConnect text for the model: hidden characters removed, controls and
 * line breaks turned into spaces, whitespace collapsed, at most `maxLength`
 * characters (the last one an ellipsis when shortened).
 */
export function cleanModelText(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isHidden(ch, cp)) {continue;}
    out += isBreaking(cp) ? " " : ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  const chars = [...out];
  return chars.length > maxLength ? chars.slice(0, maxLength - 1).join("").trimEnd() + "…" : out;
}
