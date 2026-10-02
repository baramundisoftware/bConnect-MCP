/**
 * Text from bConnect that reaches the model (REQ-XC-001 AC 2, REQ-XC-006 AC 2).
 *
 * Control characters, invisible characters and characters that change the
 * reading direction are removed, so the text the model reads is the text a
 * person sees; line breaks become spaces, so quoted text stays on one line.
 */

const DEFAULT_MAX_LENGTH = 300;

/** True for a code point that is removed outright. */
function isHidden(cp: number): boolean {
  return (
    cp === 0x00ad ||                       // soft hyphen
    (cp >= 0x200b && cp <= 0x200f) ||      // zero-width space/joiners, LRM, RLM
    (cp >= 0x202a && cp <= 0x202e) ||      // bidi embeddings and overrides
    (cp >= 0x2060 && cp <= 0x2064) ||      // word joiner, invisible operators
    (cp >= 0x2066 && cp <= 0x2069) ||      // bidi isolates
    cp === 0xfeff                          // zero-width no-break space / BOM
  );
}

/** True for a code point that becomes a space (C0/C1 controls, line and paragraph separators). */
function isBreaking(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;
}

/**
 * Clean bConnect text for the model: hidden characters removed, controls and
 * line breaks turned into spaces, whitespace collapsed, at most `maxLength`
 * characters (the last one an ellipsis when shortened).
 */
export function cleanModelText(text: string, maxLength = DEFAULT_MAX_LENGTH): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isHidden(cp)) {continue;}
    out += isBreaking(cp) ? " " : ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  const chars = [...out];
  return chars.length > maxLength ? chars.slice(0, maxLength - 1).join("").trimEnd() + "…" : out;
}
