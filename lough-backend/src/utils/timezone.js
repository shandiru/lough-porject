/**
 * timezone.js — Central timezone utility
 *
 * All timezone-dependent operations go through this file.
 * To change the app timezone, update APP_TIMEZONE in your .env file.
 *
 * Example .env values:
 *   APP_TIMEZONE=Europe/London       ← UK (BST/GMT)
 *   APP_TIMEZONE=Asia/Colombo        ← Sri Lanka (UTC+5:30)
 *   APP_TIMEZONE=America/New_York    ← US Eastern
 */

import config from '../config/index.js';

/** The active IANA timezone string, sourced from config (which reads .env). */
export const TZ = config.timezone;

/**
 * Convert a "YYYY-MM-DD" date string to UTC midnight-start for that day
 * in the configured timezone. Stored in MongoDB as UTC.
 *
 * @param {string} dateStr  e.g. "2025-07-10"
 * @returns {Date}
 */
export const dayStart = (dateStr) => {
  return new Date(
    new Date(`${dateStr}T00:00:00`).toLocaleString('en-US', { timeZone: TZ })
      // Use Intl to get the correct UTC equivalent of midnight in TZ
  );
};

/**
 * Returns a Date representing 00:00:00.000 at the START of a "YYYY-MM-DD"
 * string in the configured timezone — stored as UTC in MongoDB.
 *
 * Uses Temporal-safe approach: always appends 'Z' to avoid server-local-TZ
 * ambiguity (e.g. server running in IST would misparse "T00:00:00" without Z).
 *
 * Works for any IANA timezone including half-hour offsets (Asia/Colombo +05:30).
 */
export const tzDayStart = (dateStr) => {
  // Step 1: Use noon UTC as a reference — guaranteed to land on the right
  //         calendar date in any timezone (avoids midnight boundary edge cases)
  const noonUTC = new Date(`${dateStr}T12:00:00Z`);

  // Step 2: Get the UTC offset (in ms) for this TZ at this moment
  //         by comparing what the TZ reads vs actual UTC
  const tzMidnightStr = noonUTC.toLocaleDateString('en-CA', { timeZone: TZ }) + 'T00:00:00Z';
  //                                                                                         ^ Z here = treat as UTC anchor

  // Step 3: Find what UTC time corresponds to midnight in TZ
  //         Use Intl to read back the TZ's local time for our UTC anchor
  const anchor = new Date(tzMidnightStr); // e.g. 2026-03-30T00:00:00Z
  const localParts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(anchor);

  const lp = {};
  localParts.forEach(({ type, value }) => { lp[type] = value; });
  const offsetMs =
    (parseInt(lp.hour === '24' ? '0' : lp.hour, 10)) * 3_600_000 +
    parseInt(lp.minute, 10)                            *    60_000 +
    parseInt(lp.second, 10)                            *     1_000;

  // Step 4: Subtract offset so TZ reads exactly 00:00:00
  return new Date(anchor.getTime() - offsetMs);
};

/**
 * End of day (23:59:59.999) in the configured timezone.
 * @param {string} dateStr  e.g. "2025-07-10"
 * @returns {Date}
 */
export const tzDayEnd = (dateStr) => {
  const start = tzDayStart(dateStr);
  return new Date(start.getTime() + 86_399_999); // +23h 59m 59.999s
};

/**
 * Get today's date string ("YYYY-MM-DD") in the configured timezone.
 * @returns {string}
 */
export const todayStr = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: TZ });

/**
 * Get today's day boundaries (start & end Date) in the configured timezone.
 * @returns {{ start: Date, end: Date, dateStr: string }}
 */
export const todayBounds = () => {
  const dateStr = todayStr();
  return {
    start:   tzDayStart(dateStr),
    end:     tzDayEnd(dateStr),
    dateStr,
  };
};

/**
 * Get the day-of-week name ("monday", "tuesday" …) for a date string,
 * evaluated at noon in the configured timezone (avoids midnight boundary issues).
 * @param {string} dateStr  e.g. "2025-07-10"
 * @returns {string}
 */
export const dayName = (dateStr) => {
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const noonUTC  = new Date(`${dateStr}T12:00:00Z`);
  const localDay = new Date(noonUTC.toLocaleString('en-US', { timeZone: TZ })).getDay();
  return dayNames[localDay];
};

/**
 * Format a Date as a readable date string in the configured timezone.
 * e.g. "10 July 2025"
 * @param {Date|string} dateVal
 * @returns {string}
 */
export const formatDate = (dateVal) =>
  new Date(dateVal).toLocaleDateString('en-GB', {
    timeZone: TZ,
    day: 'numeric', month: 'long', year: 'numeric',
  });

/**
 * Extract HH:MM time string from a Date in the configured timezone.
 * @param {Date} date
 * @returns {string}  e.g. "09:30"
 */
export const formatTime = (date) =>
  new Date(date).toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

/**
 * Get today's date string AND start/end bounds — shorthand alias.
 * Kept for backward compatibility with googleCalendarCronjobs naming.
 */
export const getTodayBounds = todayBounds;