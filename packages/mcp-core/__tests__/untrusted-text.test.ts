/**
 * untrusted-text.ts — the outbound character policy (SEC-5).
 *
 * The defect this guards is not "a character got through" — it is that the
 * policy was a hand-written range list while the module header described
 * CLASSES. The list stripped U+200E/U+200F but not U+061C, a bidi control that
 * sits beside them; it stripped U+FEFF but not U+2060, the character Unicode
 * designates as its successor for that use; and it stripped none of U+00AD,
 * U+180E, U+2061-U+2064 or the Hangul fillers. Every one of those falls inside
 * a class the module header claims to cover.
 *
 * So the table below is mechanical rather than a hand list. It walks every code
 * point in Unicode and asserts that membership of the three classes the header
 * names — and nothing else — decides whether a character survives. A hand list
 * can only ever pin the characters somebody thought of, which is the failure
 * being fixed.
 *
 * The named cases after it are the code points the audit called the built
 * function on, kept as an independent anchor: if the properties below were ever
 * relaxed to match a weakened implementation, those still fail.
 *
 * Escape codes are written as \uXXXX rather than pasted literally, as in
 * serialize-outbound-trust.test.ts: a test whose intent is invisible in the
 * diff is a test nobody can review.
 */

import { describe, it, expect } from "vitest";
import {
  stripInvisibleCharacters,
  sanitizeEstateText,
  ESTATE_TEXT_MAX,
} from "../src/untrusted-text.js";

/**
 * The classes the module header claims, written independently of the
 * implementation: C0/C1 controls, the format category (bidi controls,
 * zero-width characters, the TAG block), and the code points Unicode defines as
 * rendering to nothing. Tab and newline are the two stated exceptions.
 */
const CLAIMED = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const EXEMPT = new Set(["\t", "\n"]);

/** Every code point, minus the surrogate range, which is not a character. */
function* allCodePoints(): Generator<number> {
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) {continue;}
    yield cp;
  }
}

const format = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

describe("the stripped class is the class the header names, over the whole of Unicode", () => {
  // Walked once: ~1.1M code points, and both assertions read the result.
  const survived: string[] = [];
  const removed: string[] = [];
  for (const cp of allCodePoints()) {
    const char = String.fromCodePoint(cp);
    const stripped = stripInvisibleCharacters(`A${char}B`) === "AB";
    const claimed = CLAIMED.test(char) && !EXEMPT.has(char);
    if (claimed && !stripped) {survived.push(format(cp));}
    if (!claimed && stripped) {removed.push(format(cp));}
  }

  it("removes every code point inside the claimed classes", () => {
    // The previous range list left several thousand behind, including every one
    // the audit sampled. Reported as a list rather than a count so a regression
    // names the characters it let through.
    expect(survived.slice(0, 40)).toEqual([]);
    expect(survived).toHaveLength(0);
  });

  it("removes nothing outside them", () => {
    // The other direction matters as much: a policy that eats legitimate estate
    // text is a data-loss bug wearing a security fix.
    expect(removed.slice(0, 40)).toEqual([]);
    expect(removed).toHaveLength(0);
  });
});

describe("the code points the audit measured against the built module", () => {
  // Named characters, independent of the property escapes above: these keep
  // failing even if CLAIMED were relaxed alongside the implementation.
  const stripped: Array<[string, number]> = [
    // Stripped by the range list this replaced.
    ["zero-width space", 0x200b],
    ["zero-width non-joiner", 0x200c],
    ["zero-width joiner", 0x200d],
    ["left-to-right mark", 0x200e],
    ["right-to-left mark", 0x200f],
    ["right-to-left override", 0x202e],
    ["left-to-right isolate", 0x2066],
    ["pop directional isolate", 0x2069],
    ["zero-width no-break space (BOM)", 0xfeff],
    ["language tag", 0xe0001],
    ["tag latin capital A", 0xe0041],
    // Everything below here SURVIVED it.
    ["soft hyphen", 0x00ad],
    ["combining grapheme joiner", 0x034f],
    ["Arabic letter mark", 0x061c],
    ["word joiner", 0x2060],
    ["function application", 0x2061],
    ["invisible times", 0x2062],
    ["invisible separator", 0x2063],
    ["invisible plus", 0x2064],
    ["Mongolian vowel separator", 0x180e],
    ["Khmer vowel inherent aq", 0x17b4],
    ["Khmer vowel inherent aa", 0x17b5],
    ["Hangul choseong filler", 0x115f],
    ["Hangul jungseong filler", 0x1160],
    ["Hangul filler", 0x3164],
    ["halfwidth Hangul filler", 0xffa0],
    ["variation selector-16", 0xfe0f],
    ["interlinear annotation anchor", 0xfff9],
  ];

  it.each(stripped)("removes %s (%i)", (_name, cp) => {
    expect(stripInvisibleCharacters(`W${String.fromCodePoint(cp)}ORKSTATION1`)).toBe("WORKSTATION1");
  });

  const kept: Array<[string, string]> = [
    ["a decomposed accented letter", "Gerät-01"],
    ["Hebrew letters", "עברית"],
    ["Arabic letters", "العربية"],
    ["a Devanagari cluster with a virama", "हिन्दी"],
    ["an emoji", "srv \u{1F4BB}"],
    ["CJK", "中文"],
    ["tab and newline", "line one\nstep\ttwo"],
  ];

  it.each(kept)("leaves %s untouched", (_name, value) => {
    expect(stripInvisibleCharacters(value)).toBe(value);
  });
});

describe("sanitizeEstateText applies the same policy before it collapses and bounds", () => {
  it("strips characters the old range list kept, then collapses whitespace", () => {
    // U+2060 word joiner, U+00AD soft hyphen — both survived the range list.
    expect(sanitizeEstateText("  W\u2060ORKSTATION1   is\u00ADstale  ")).toBe(
      "WORKSTATION1 isstale"
    );
  });

  it("still bounds length", () => {
    const out = sanitizeEstateText("x".repeat(ESTATE_TEXT_MAX + 50));
    expect(out).toHaveLength(ESTATE_TEXT_MAX + 1);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns an empty string for a non-string", () => {
    expect(sanitizeEstateText(undefined)).toBe("");
    expect(sanitizeEstateText(42)).toBe("");
  });
});
