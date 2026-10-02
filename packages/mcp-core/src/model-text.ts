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

/** Shown where hidden characters were removed from bMS data, so the removal is visible. */
export const HIDDEN_CHARACTERS_MARKER = "[hidden characters removed]";

const ZWNJ = 0x200c;
const ZWJ = 0x200d;

/**
 * True for a character removed from bMS data (REQ-XC-006 AC 2, ADR-0009): every
 * format character and the whole tag block, but not ZWNJ/ZWJ, which several
 * scripts and emoji need.
 */
function isHiddenInData(ch: string, cp: number): boolean {
  if (cp >= 0xe0000 && cp <= 0xe007f) {return true;}
  return cp !== ZWNJ && cp !== ZWJ && FORMAT_CHARACTER.test(ch);
}

/** Cheap pre-check: a string without format, unassigned or CR characters is returned as is. */
const MAY_NEED_CLEANING = /[\p{Cf}\p{Cn}\r]/u;

function cleanDataString(text: string): string {
  if (!MAY_NEED_CLEANING.test(text)) {return text;}
  let out = "";
  let inRun = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isHiddenInData(ch, cp)) {
      if (!inRun) {out += HIDDEN_CHARACTERS_MARKER;}
      inRun = true;
      continue;
    }
    inRun = false;
    out += ch;
  }
  return out.split("\r\n").join("\n");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {return false;}
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function cleanDataValue(value: unknown): unknown {
  if (typeof value === "string") {return cleanDataString(value);}
  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    value.forEach((item: unknown, i) => {
      const cleaned = cleanDataValue(item);
      if (cleaned !== item) {
        copy ??= [...value];
        copy[i] = cleaned;
      }
    });
    return copy ?? value;
  }
  if (!isPlainObject(value)) {return value;}
  const entries = Object.entries(value).map(([key, item]) => [key, cleanDataString(key), item, cleanDataValue(item)] as const);
  if (entries.every(([key, cleanKey, item, cleanItem]) => key === cleanKey && item === cleanItem)) {return value;}
  const out: Record<string, unknown> = {};
  for (const [, cleanKey, , cleanItem] of entries) {
    // Two keys that differed only in removed characters both stay (#167).
    let key = cleanKey;
    while (Object.prototype.hasOwnProperty.call(out, key)) {key = `${key} ${HIDDEN_CHARACTERS_MARKER}`;}
    // defineProperty, not assignment: a "__proto__" key from JSON stays an own property.
    Object.defineProperty(out, key, { value: cleanItem, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/**
 * bMS data cleaned for the model (REQ-XC-006 AC 2, ADR-0009): in every string
 * value and key, at any depth, each run of hidden characters becomes
 * HIDDEN_CHARACTERS_MARKER and CRLF becomes LF. Data without hidden characters
 * or CRLF is returned as the same object; the input is never changed.
 */
export function cleanModelData<T>(value: T): T {
  return cleanDataValue(value) as T;
}
