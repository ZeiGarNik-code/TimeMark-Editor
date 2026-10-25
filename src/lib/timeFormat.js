const CLOCK_TIME_PATTERN = /^(?<hour>\d{1,2})\s*[:.]\s*(?<minute>\d{1,2})(?:\s*[:.]\s*\d{1,2})?(?:\s*(?<period>a\.?m\.?|p\.?m\.?))?$/i;
const SPACED_TIME_PATTERN = /^(?<hour>\d{1,2})\s+(?<minute>\d{1,2})(?:\s+\d{1,2})?(?:\s*(?<period>a\.?m\.?|p\.?m\.?))?$/i;

/** Format a recognized clock value as 24-hour HH:MM, intentionally dropping seconds. */
export function formatTimeToMinutes(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '';

  const match = text.match(CLOCK_TIME_PATTERN) ?? text.match(SPACED_TIME_PATTERN);
  if (!match) return '';

  let hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const period = match.groups.period?.replace(/\./g, '').toUpperCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return '';

  if (period) {
    if (hour < 1 || hour > 12) return '';
    hour %= 12;
    if (period === 'PM') hour += 12;
  } else if (hour < 0 || hour > 23) {
    return '';
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
