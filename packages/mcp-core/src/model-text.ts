/**
 * Text from bConnect that reaches the model (REQ-XC-001 AC 2, REQ-XC-006 AC 2).
 *
 * Control characters, invisible characters and characters that change the
 * reading direction are removed, so the text the model reads is the text a
 * person sees; line breaks become spaces, so quoted text stays on one line.
 */

const DEFAULT_MAX_LENGTH = 300;

const FORMAT_CHARACTER = /\p{Cf}/u;
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const TEXT_PRESENTATION = 0xfe0e;
const EMOJI_PRESENTATION = 0xfe0f;

/**
 * The hidden-character class (REQ-XC-006 AC 2, ADR-0009): every format
 * character, every default-ignorable code point (zero-width and bidi
 * characters, variation selectors incl. the supplement used to smuggle bytes
 * in emoji, Hangul fillers, the whole tag block U+E0000-E0FFF) - except ZWNJ,
 * ZWJ and the two emoji presentation selectors, which visible text needs.
 */
function inHiddenClass(ch: string, cp: number): boolean {
  if (cp === ZWNJ || cp === ZWJ || cp === TEXT_PRESENTATION || cp === EMOJI_PRESENTATION) {return false;}
  return (cp >= 0xe0000 && cp <= 0xe0fff) || FORMAT_CHARACTER.test(ch) || DEFAULT_IGNORABLE.test(ch);
}

/**
 * True for a code point removed outright from error text: the hidden class,
 * and there also ZWNJ/ZWJ and the presentation selectors (error text is one
 * plain line; nothing there needs them).
 */
function isHidden(ch: string, cp: number): boolean {
  return inHiddenClass(ch, cp) || cp === ZWNJ || cp === ZWJ || cp === TEXT_PRESENTATION || cp === EMOJI_PRESENTATION;
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

/** Cheap pre-check: a string without class or CR characters is returned as is. */
const MAY_NEED_CLEANING = /[\p{Cf}\p{Default_Ignorable_Code_Point}\r]/u;

function cleanDataString(text: string): string {
  if (!MAY_NEED_CLEANING.test(text)) {return text;}
  const chars = [...text];
  let out = "";
  let inRun = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x0d) {
      // CR, hidden characters, LF: a line break (CRLF -> LF), with the marker if any were hidden.
      let j = i + 1;
      while (j < chars.length && inHiddenClass(chars[j], chars[j].codePointAt(0) ?? 0)) {j++;}
      if (chars[j] === "\n") {
        if (j > i + 1 && !inRun) {out += HIDDEN_CHARACTERS_MARKER;}
        out += "\n";
        inRun = false;
        i = j;
        continue;
      }
    }
    if (inHiddenClass(ch, cp)) {
      if (!inRun) {out += HIDDEN_CHARACTERS_MARKER;}
      inRun = true;
      continue;
    }
    inRun = false;
    out += ch;
  }
  return out;
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
  // Keys that needed no cleaning keep their names; a cleaned key that collides
  // with one gets another marker, so both stay (#167). Original order is kept.
  const taken = new Set(entries.filter(([key, cleanKey]) => key === cleanKey).map(([key]) => key));
  const out: Record<string, unknown> = {};
  for (const [key, cleanKey, , cleanItem] of entries) {
    let name = cleanKey;
    if (key !== cleanKey) {
      while (taken.has(name)) {name = `${name} ${HIDDEN_CHARACTERS_MARKER}`;}
      taken.add(name);
    }
    // defineProperty, not assignment: a "__proto__" key from JSON stays an own property.
    Object.defineProperty(out, name, { value: cleanItem, enumerable: true, writable: true, configurable: true });
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
