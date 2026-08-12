/**
 * HOW LONG IS LEFT ON A SUBSCRIPTION
 * ==================================
 * One end date, read by three screens and enforced by two more, so it lives in
 * one place. Every copy of this arithmetic that existed before disagreed with
 * the rule the API actually applies, in both directions.
 *
 * THE RULE
 * --------
 * An end date is valid THROUGH that day. An administrator choosing 11 August
 * means "the whole of the 11th", so access closes at the end of the 11th and
 * not at the start of it.
 *
 * WHY COUNTING CALENDAR DAYS AND NOT HOURS
 * -----------------------------------------
 * The old version measured the gap to the last instant of the end date and
 * rounded up:
 *
 *     Math.ceil((endOfDay - Date.now()) / 86400000)
 *
 * That is a count of 24-hour chunks, not of days on a calendar, and it is wrong
 * at both ends of the range:
 *
 *   - ON the end date, with eleven hours still to run, it returns 1 — so the
 *     panel said "1 day left" on the one day it should have said "ends today".
 *   - On the day AFTER, it returns -0. `-0 < 0` is false and `-0 === 0` is
 *     true, so the panel said "ends today" about a school that had already
 *     been locked out. An administrator read that, believed the licence was
 *     live until midnight, and reported the simulator as broken.
 *
 * Both are gone once the question is asked properly: how many calendar days
 * from today to the end date? Zero means today, and today is still open.
 *
 * UTC, AND THE DISPLAY MATCHES
 * -----------------------------
 * The comparison is in UTC because the server, the database and the browser can
 * each be in a different zone, and a licence that lapses at a different moment
 * depending on who is asking is worse than one that runs a few hours long.
 * Erring long errs in the school's favour, which is the right direction for the
 * one of the two that is paying.
 *
 * `formatEndDate` therefore formats in UTC as well. A date rendered in the
 * reader's zone can name a different day from the one the rule is using, and a
 * screen that shows one date while enforcing another is the whole reason this
 * file exists.
 */

/** Midnight UTC on the day an instant falls on. */
function utcDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Whole calendar days from today to the end date.
 *
 *   > 0   still to come
 *   = 0   today — and today is still valid, right through to midnight
 *   < 0   over
 *
 * `null` when there is no end date, which is not the same as zero: a school
 * with no end date never expires.
 */
export function daysUntilEnd(endsAt, now = Date.now()) {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return null;
  return Math.round((utcDay(end.getTime()) - utcDay(now)) / 86400000);
}

/**
 * Has it run out?
 *
 * Defined in terms of the same count, so the badge and the gate can never
 * disagree: expired is exactly "the end date is before today".
 */
export function hasExpired(endsAt, now = Date.now()) {
  const days = daysUntilEnd(endsAt, now);
  return days !== null && days < 0;
}

/** The end date, written the way the rule reads it. */
export function formatEndDate(endsAt, opts = { day: "numeric", month: "long", year: "numeric" }) {
  if (!endsAt) return null;
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
}
