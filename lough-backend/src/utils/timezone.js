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
 * Robust dayStart: uses Intl.DateTimeFormat to compute midnight in TZ correctly
 * regardless of the offset (handles half-hour offsets like +05:30 too).
 */
export const tzDayStart = (dateStr) => {
  // Parse as local noon first to avoid any date-boundary ambiguity
  const ref = new Date(`${dateStr}T12:00:00Z`);

  // Get the actual calendar date in the target TZ
  const tzDateStr = ref.toLocaleDateString('en-CA', { timeZone: TZ }); // "YYYY-MM-DD"

  // Build a "midnight in TZ" timestamp by finding the UTC offset at that moment
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  // Use a simple offset calculation: parse midnight as if local, then correct
  // This approach works universally for any IANA timezone
  const candidate = new Date(`${tzDateStr}T00:00:00`);

  // Get what TZ thinks the time is for this UTC candidate
  const parts = formatter.formatToParts(candidate);
  const p = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  const tzHour   = parseInt(p.hour === '24' ? '0' : p.hour, 10);
  const tzMinute = parseInt(p.minute, 10);
  const tzSecond = parseInt(p.second, 10);

  // Adjust candidate so that TZ reads exactly 00:00:00
  candidate.setTime(
    candidate.getTime()
    - tzHour   * 3600_000
    - tzMinute *    60_000
    - tzSecond *     1_000
  );
  return candidate;
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
