const WEEKDAYS = [
  { pattern: /\bchu\s*nhat\b/, value: 'Chủ Nhật' },
  { pattern: /\bthu\s*(?:hai|2)\b/, value: 'Thứ Hai' },
  { pattern: /\bthu\s*(?:ba|3)\b/, value: 'Thứ Ba' },
  { pattern: /\bthu\s*(?:tu|4)\b/, value: 'Thứ Tư' },
  { pattern: /\bthu\s*(?:nam|5)\b/, value: 'Thứ Năm' },
  { pattern: /\btha\s*nam\b/, value: 'Thứ Năm' },
  { pattern: /\bthir\s*nam\b/, value: 'Thứ Năm' },
  { pattern: /\bthu\s*(?:sau|6)\b/, value: 'Thứ Sáu' },
  { pattern: /\bthu\s*(?:bay|7)\b/, value: 'Thứ Bảy' },
  { pattern: /\b(?:sunday|sun)\b/, value: 'Chủ Nhật' },
  { pattern: /\b(?:monday|mon)\b/, value: 'Thứ Hai' },
  { pattern: /\b(?:tuesday|tue)\b/, value: 'Thứ Ba' },
  { pattern: /\b(?:wednesday|wed)\b/, value: 'Thứ Tư' },
  { pattern: /\b(?:thursday|thu)\b/, value: 'Thứ Năm' },
  { pattern: /\b(?:friday|fri)\b/, value: 'Thứ Sáu' },
  { pattern: /\b(?:saturday|sat)\b/, value: 'Thứ Bảy' },
];

const MONTHS = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_PATTERNS = [
  /\b\d{1,2}\s*th[aá]ng\s*\d{1,2}(?:\s*,?\s*(?:n[aă]m\s*)?\d{2,4})?\b/i,
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/,
  /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/,
  new RegExp(`\\b${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)?[,]?\\s+\\d{4}\\b`, 'i'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}[,]?\\s+\\d{4}\\b`, 'i'),
];
const TIME_PATTERN = /(?:^|\D)((?:[01]?\d|2[0-3])\s*[:.]\s*[0-5]\d(?:\s*[:.]\s*[0-5]\d)?\s*(?:[ap]\.?m\.?)?)(?=$|\D)/i;
const SPACED_TIME_PATTERN = /^\s*((?:[01]?\d|2[0-3])\s+[0-5]\d(?:\s+[0-5]\d)?\s*(?:[ap]\.?m\.?)?)\s*$/i;

export function normalizeOCRText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (letter) => letter === 'Đ' ? 'D' : 'd')
    .toLocaleLowerCase('vi-VN');
}

export function parseTimemarkOCR(rawText) {
  const lines = String(rawText ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/[|¦]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const result = { weekday: '', date: '', time: '', address: '' };
  const addressLines = [];

  for (const line of lines) {
    const normalized = normalizeOCRText(line);
    if (!result.weekday) result.weekday = extractWeekday(normalized);

    const dateMatch = findMatch(line, DATE_PATTERNS);
    if (!result.date && dateMatch) result.date = cleanPunctuation(dateMatch[0]);

    const timeMatch = line.match(TIME_PATTERN) ?? line.match(SPACED_TIME_PATTERN);
    if (!result.time && timeMatch) result.time = normalizeTime(timeMatch[1]);

    let remainder = line;
    if (dateMatch) remainder = remainder.replace(dateMatch[0], ' ');
    if (timeMatch) remainder = remainder.replace(timeMatch[1], ' ');
    remainder = remainder.replace(/(?:th[uứư]\s*(?:hai|ba|tư|tu|năm|nam|sáu|sau|bảy|bay|[2-7])|th[aá]\s*nam|th[ií]r\s*nam|ch[uủ]\s*nh[aậ]t|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/gi, ' ');
    const normalizedRemainder = normalizeOCRText(remainder);
    if (/^(?:timemark|timel|time|verified)\b/.test(normalizedRemainder) || /^100\s*%/.test(normalizedRemainder)) remainder = '';
    remainder = remainder.replace(/\b(?:ngày|date|thứ|weekday|giờ|time|địa\s*chỉ|địa\s*điểm|address|location)\s*[:=–-]?\s*/gi, ' ');
    remainder = cleanPunctuation(remainder);

    if (/[\p{L}]/u.test(remainder) || /\d.{0,3}[°º]/.test(remainder)) {
      const normalizedRemainder = normalizeOCRText(remainder);
      const compactRemainder = normalizedRemainder.replace(/[^a-z0-9]/g, '');
      const brandNoise = /^(?:timemark|timel|time|verified)\b/.test(normalizedRemainder) || /^100\s*%/.test(normalizedRemainder);
      const artifactNoise = /[`^~|\\]/.test(remainder) && compactRemainder.length <= 2;
      if (!brandNoise && !artifactNoise && !DATE_PATTERNS.some((pattern) => pattern.test(remainder)) && !TIME_PATTERN.test(remainder)
        && !WEEKDAYS.some(({ pattern }) => pattern.test(normalizedRemainder))) {
        addressLines.push(remainder);
      }
    }
  }

  result.address = [...new Set(addressLines)].join(' · ');
  const recognizedCount = Object.values(result).filter(Boolean).length;
  return { content: result, lines, recognizedCount };
}

function extractWeekday(normalized) {
  return WEEKDAYS.find(({ pattern }) => pattern.test(normalized))?.value ?? '';
}

function findMatch(value, patterns) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match;
  }
  return null;
}

function normalizeTime(value) {
  let normalized = String(value ?? '').trim().replace(/[.]/g, ':');
  const spacedTime = normalized.match(/^(\d{1,2})\s+(\d{2})(?:\s+(\d{2}))?(\s*[ap]\.?m\.?)?$/i);
  if (spacedTime) {
    normalized = [spacedTime[1], spacedTime[2], spacedTime[3]].filter(Boolean).join(':');
    if (spacedTime[4]) normalized += ` ${spacedTime[4].trim()}`;
  }
  return normalized
    .replace(/\s*:\s*/g, ':')
    .replace(/a\.?m\.?/i, 'AM')
    .replace(/p\.?m\.?/i, 'PM')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPunctuation(value) {
  return value
    .replace(/^[\s,.;:|·–—-]+|[\s,.;:|·–—-]+$/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,.;:])(?=\S)/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
