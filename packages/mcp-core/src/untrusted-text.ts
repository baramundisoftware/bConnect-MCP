/**
 * Estate strings are untrusted input.
 *
 * ── The direction nobody was guarding ───────────────────────────────────────
 * This suite has a well-built INBOUND trust boundary — model → tool arguments,
 * via argument validation and the path guard — and the docs treat that as "the"
 * injection problem. The OUTBOUND direction, estate strings → model context,
 * had zero controls and zero documentation.
 *
 * Endpoint names, job and job-definition names, software titles, group names,
 * registered-user names and job-failure text are all operator-controllable
 * inside a customer estate. Anyone who can rename an endpoint, or make a job
 * exit with crafted text, gets that text into the model's context — and in
 * several places directly into model-facing ADVISORY PROSE, which is the
 * sentence a model is most likely to act on.
 *
 * ── What this does and, more importantly, what it does not ──────────────────
 * It is not a sanitiser for instructions. There is no reliable way to strip
 * "instructions" from free text, and pretending otherwise is worse than saying
 * so. What it removes is the class of characters that are never legitimate in
 * a bMS object name and that exist mainly to make text render as something
 * other than what it is:
 *
 *   - zero-width characters (U+200B–U+200D, U+2060–U+2064, U+FEFF), which hide
 *     content
 *   - bidirectional controls and overrides (U+061C, U+200E–U+200F,
 *     U+202A–U+202E, U+2066–U+2069), which reorder displayed text against its
 *     byte order
 *   - Unicode TAG characters (U+E0000–U+E007F), which are invisible and have
 *     been used to smuggle whole instructions past human review
 *   - the other characters Unicode defines as rendering to nothing: the Hangul
 *     and halfwidth fillers, the variation selectors, U+00AD, U+034F, U+180E
 *   - C0/C1 control characters other than tab and newline
 *
 * And it BOUNDS length, because an unbounded estate string in a headline is a
 * whole injected paragraph with a legitimate prefix.
 *
 * The real control remains the one stated in SECURITY.md: estate data is data,
 * not instruction, and a deployer should not run ALLOW_WRITE_OPERATIONS on an
 * unattended agent loop.
 */

/**
 * Characters that are never legitimate in a bMS object name.
 *
 * Unicode properties rather than a hand-written range list, because the range
 * list closed only what somebody remembered to type: it stripped U+200E/U+200F
 * but not U+061C, which is a bidi control alongside them; it stripped U+FEFF but
 * not U+2060, which is the character Unicode designates as its successor for
 * that use; and it stripped nothing at all of U+00AD, U+180E, U+2061-U+2064 or
 * the Hangul fillers, all of which render as nothing. Three properties close
 * those classes by definition instead:
 *
 *   \p{Cc}  C0 and C1 controls
 *   \p{Cf}  the format category: every bidi control, every zero-width
 *           joiner/non-joiner/space, the interlinear annotations and the whole
 *           U+E0000-U+E007F TAG block
 *   \p{Default_Ignorable_Code_Point}
 *           the characters Unicode defines as rendering to nothing even where
 *           they are not format characters - the Hangul and halfwidth fillers,
 *           the variation selectors, U+034F
 *
 * The lookahead exempts tab and newline, which are in \p{Cc} and are real
 * content in bMS job output.
 *
 * What is deliberately NOT in here: RTL and LTR letters themselves, and
 * ordinary combining marks. Arabic, Hebrew and decomposed accented text is
 * legitimate estate data; only the invisible controls that reorder or hide it
 * are removed.
 */
const INVISIBLE_OR_REORDERING = /(?![\t\n])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * Remove invisible and text-reordering characters from a string that came from
 * the estate. Leaves ordinary text, including tabs and newlines, untouched.
 */
export function stripInvisibleCharacters(value: string): string {
  return value.replace(INVISIBLE_OR_REORDERING, "");
}

/** Default cap for estate text that reaches model-facing prose. */
export const ESTATE_TEXT_MAX = 120;

/**
 * Make an estate string safe to place in advisory prose: strip the invisible
 * classes, collapse whitespace, and bound the length.
 *
 * Use this wherever untrusted text is INTERPOLATED INTO A SENTENCE. Where the
 * value can instead be carried in its own structured field, do that — a name
 * in `endpointName` is data, the same name inside "the worst offender is X"
 * is a sentence the model may act on. `modules/security-posture.ts` already
 * does it the right way and is the pattern to copy.
 */
export function sanitizeEstateText(value: unknown, max = ESTATE_TEXT_MAX): string {
  if (typeof value !== "string") {
    return "";
  }
  const cleaned = stripInvisibleCharacters(value).replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}
