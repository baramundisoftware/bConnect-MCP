/**
 * Turning a bConnect timestamp into an age in days, honestly.
 *
 * ── This is NOT a timezone problem, which is worth recording ────────────────
 * Verified live against labcorp.local across /endpoints, MicrosoftDefender and
 * update-management: every real timestamp carries an explicit Z and is UTC,
 * including the sub-second forms `…:33.64Z` and the .NET-tick
 * `…:01.9846557Z`. `new Date()` parses all of them unambiguously.
 *
 * Endpoints DO sit in different zones — rows carry `timeZone` values like
 * "UTC+02:00 Europe/Berlin" and "UTC-04:00 America/New_York" — but bConnect
 * normalises the wire format, so that field matters for SCHEDULING (maintenance
 * windows, "Client Time and Day" preconditions) and not for age arithmetic.
 *
 * The one zone-less value seen is the `activity` display string
 * ("12.08.2026 11:41:54", rendered in the bMS server's own locale). Nothing
 * parses it as a date, and nothing should.
 *
 * ── What actually goes wrong ────────────────────────────────────────────────
 * Two clocks. Whatever stamps `lastSeen` is not the process supplying `now`, so
 * a timestamp can be marginally in the FUTURE — the bMS server running a few
 * seconds ahead, or an endpoint checking in between `now` being captured and
 * the read landing. `Math.floor` then turns a delta of -1 ms into **-1 days**,
 * and a briefing reports "last seen -1 days ago".
 *
 * Observed in a real payload (`daysSinceSeen: -1`) before anyone went looking.
 *
 * ── Why not simply clamp every negative to 0 ────────────────────────────────
 * Because a timestamp three days out is not skew, it is a fault — a broken
 * clock somewhere or bad data — and answering "seen today" would be a fact
 * nobody measured, which is the false all-clear this codebase exists to remove.
 * So: skew is absorbed, a fault is reported as UNKNOWN, and the two are
 * separated by an explicit threshold rather than by feel.
 *
 * 15 minutes is deliberately generous. Windows domains hold clocks far tighter
 * than that (Kerberos rejects beyond 5 minutes by default), so anything past it
 * is not ordinary drift.
 */

const DAY_MS = 86_400_000;

/** Clocks disagreeing by less than this are skew; beyond it, something is wrong. */
export const CLOCK_SKEW_TOLERANCE_MS = 15 * 60_000;

/** Anything before this is a sentinel or a clock fault, not an age. */
const SENTINEL_BEFORE = Date.parse("2000-01-01T00:00:00Z");

/**
 * bConnect emits .NET's DateTime.MinValue ("0001-01-01T00:00:00") for "never
 * happened". Read as a date it becomes ~739,839 days, and a briefing reports
 * antivirus definitions two thousand years old. Found when a machine was
 * switched on mid-session, by which point 32 tests had passed over it.
 */
export const isSentinelDate = (iso: unknown): boolean => {
  if (typeof iso !== "string") {return false;}
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t < SENTINEL_BEFORE;
};

/**
 * True when a timestamp is far enough ahead of `now` to be a fault rather than
 * skew. Callers use this to DISCLOSE the disagreement, because `daysSince`
 * returns null for it and a silent null would read as "not reported".
 */
export const isFutureBeyondSkew = (iso: unknown, now: number): boolean => {
  if (typeof iso !== "string" || isSentinelDate(iso)) {return false;}
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && now - t < -CLOCK_SKEW_TOLERANCE_MS;
};

/**
 * Whole days between `iso` and `now`, or null when there is no usable answer:
 * absent, malformed, a sentinel, or so far in the future that the clocks are
 * in conflict. NEVER negative.
 */
export const daysSince = (iso: unknown, now: number): number | null => {
  if (typeof iso !== "string" || isSentinelDate(iso)) {return null;}
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {return null;}
  const delta = now - t;
  if (delta < -CLOCK_SKEW_TOLERANCE_MS) {return null;}
  // max(0, …) absorbs the skew window: floor(-0.000001) is -1, and "-1 days
  // ago" is not a thing. Positive ages are untouched — for delta >= 0 this is
  // exactly the floor it always was.
  return Math.max(0, Math.floor(delta / DAY_MS));
};
