export const TARGET_PERIOD_OPTIONS = ['Current', 'Previous Year'];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

function resolveSafeDate(referenceDate = new Date()) {
  const date = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Format a Date into "<MonthName> <YYYY>" (e.g. "November 2026").
 */
export function formatCurrentMonthYear(referenceDate = new Date()) {
  const safeDate = resolveSafeDate(referenceDate);
  return `${MONTH_NAMES[safeDate.getMonth()]} ${safeDate.getFullYear()}`;
}

/**
 * Return true when a schema column key stores the reported month/year dropdown.
 */
export function isReportedMonthKey(key) {
  return key === 'reportedMonth' || key === 'monthReported';
}

/**
 * Compute Total Number of ARB from Male and Female counts when at least one is provided.
 */
export function resolveTotalArbsFromGenderCounts(maleRaw, femaleRaw) {
  const maleStr = String(maleRaw ?? '').trim();
  const femaleStr = String(femaleRaw ?? '').trim();
  if (maleStr === '' && femaleStr === '') return '';
  const male = Number.parseInt(maleStr || '0', 10);
  const female = Number.parseInt(femaleStr || '0', 10);
  if (!Number.isFinite(male) && !Number.isFinite(female)) return '';
  const safeMale = Number.isFinite(male) && male >= 0 ? male : 0;
  const safeFemale = Number.isFinite(female) && female >= 0 ? female : 0;
  return String(safeMale + safeFemale);
}

/**
 * Build the 12 month options paired with the current year (e.g. "January 2026" .. "December 2026").
 */
export function getReportedMonthOptions(referenceDate = new Date()) {
  const year = resolveSafeDate(referenceDate).getFullYear();
  return MONTH_NAMES.map((month) => `${month} ${year}`);
}

/**
 * Extract a 4-digit year from raw Database field text (handles values like "2013.0").
 */
export function parseDatabaseYear(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return null;
  const match = str.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  if (match) return Number(match[1]);
  const num = Number(str);
  if (Number.isInteger(num) && num >= 1900 && num <= 2100) return num;
  return null;
}

/**
 * Resolve Database parcel year: inspect `year` first, then fall back to `targetYear`.
 */
export function resolveDatabaseYear(dbRow) {
  if (!dbRow) return null;
  return parseDatabaseYear(dbRow.year) ?? parseDatabaseYear(dbRow.targetYear);
}

/**
 * Determine "Current" vs "Previous Year" from linked Database year against reference year.
 */
export function resolveTargetFromDatabaseRow(dbRow, referenceDate = new Date()) {
  const dbYear = resolveDatabaseYear(dbRow);
  if (!dbYear) return 'Previous Year';
  return dbYear >= resolveSafeDate(referenceDate).getFullYear() ? 'Current' : 'Previous Year';
}

export const SURVEY_STATUS_STAGES = [
  { key: 'dateRss', status: '01 - With RSS' },
  { key: 'fieldWorkStartDate', status: '02 - Field Work Started' },
  { key: 'fieldWorkCompletionDate', status: '03 - Field Work Completed' },
  { key: 'finalizedSrDate', status: '04 - Finalized SR' },
  { key: 'srForwardedToDarro', status: '05 - SR Forwarded to DARRO' },
  { key: 'srAcceptedByDarro', status: '06 - SR Accepted by DARRO' },
  { key: 'srReturnedDarroToDarpoDate', status: '07 - SR Returned to DARPO for Correction' },
  { key: 'srResubmittedDarroDate', status: '08 - SR Returned to DARRO' },
  { key: 'srTransmittedDenrSmdDate', status: '09 - SR Transmitted to DENR-LMS' },
  { key: 'dateAcceptedDenrSmd', status: '10 - SR Accepted by LMS' },
  { key: 'srReturnedDenrToDarroDate', status: '11 - SR Returned by LMS to DARRO' },
  { key: 'srReturnedDenrDarroToDarpoDate', status: '07 - SR Returned to DARPO for Correction' },
  { key: 'srReturnedDarpoToDarroDate', status: '08 - SR Forwarded to DARRO' },
  { key: 'darroResubmittedDenrDate', status: '09 - SR Transmitted to DENR-LMS' },
  { key: 'aspDate', status: '12 - WITH ASP' }
];

export const LEGACY_SURVEY_STATUS_LABELS = new Set([
  'Date RSS',
  'Field Work Start',
  'Field Work Completed',
  'Finalized Survey Return',
  'SR Forwarded to DARRO',
  'SR Accepted by DARRO',
  'SR Returned DARRO -> DARPO',
  'SR Re-submitted to DARRO',
  'SR Transmitted to DENR-SMD',
  'Accepted by DENR-SMD',
  'SR Returned DENR-SMD -> DARRO',
  'SR Returned DENR-SMD -> DARRO - DARPO',
  'SR Returned DARPO -> DARRO',
  'DARRO Re-submitted to DENR-SMD',
  'ASP Approved'
]);

function parseComparableDateMs(raw) {
  const str = String(raw ?? '').trim();
  if (!str) return null;
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }
  const parsed = Date.parse(str);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Derive Current Status and Current Date from the latest filled Survey workflow stage/date.
 */
export function resolveSurveyCurrentStatus(row) {
  if (!row) return { currentStatus: '', currentDate: '' };
  let best = null;
  for (let i = 0; i < SURVEY_STATUS_STAGES.length; i++) {
    const stage = SURVEY_STATUS_STAGES[i];
    const dateVal = String(row[stage.key] ?? '').trim();
    if (!dateVal) continue;
    const ts = parseComparableDateMs(dateVal);
    if (
      !best ||
      (ts !== null && best.ts === null) ||
      (ts !== null && best.ts !== null && (ts > best.ts || (ts === best.ts && i > best.order))) ||
      (ts === null && best.ts === null && i > best.order)
    ) {
      best = { currentStatus: stage.status, currentDate: dateVal, ts, order: i };
    }
  }
  return best
    ? { currentStatus: best.currentStatus, currentDate: best.currentDate }
    : { currentStatus: '', currentDate: '' };
}

