import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD,
  USER_PROVINCE_OPTIONS,
  OTP_TTL_MS,
  OTP_RESEND_COOLDOWN_MS,
  generateOtpCode,
  hashOtpCode,
  verifyOtpHash,
  hashPassword,
  verifyPassword,
  toPublicUser
} from './auth.js';
import {
  REGIONAL_REGISTRY,
  PROVINCE_CODES,
  OPTOOL_SHEET_SCHEMAS,
  MILESTONE_STAGES,
  MILESTONE_TARGET_TABS,
  DASHBOARD_MILESTONES,
  normalizeNepTargets,
  normalizeNepProvinceList,
  normalizeNepMilestoneList,
  inferProvinceCodeFromMunicipality,
  inferProvinceCodeFromText,
  formatArea4,
  normalizeChecklistValue,
  LEASEHOLD_COLUMNS,
  normalizeLeaseholdRow
} from './schema.js';
import { createSeedState } from './seedData.js';
import {
  LEGACY_SURVEY_STATUS_LABELS,
  formatCurrentMonthYear,
  formatReportedMonthWord,
  formatYearDisplay,
  formatLhidDisplay,
  getOptoolRowKey,
  resolveSurveyCurrentStatus,
  resolveTargetFromDatabaseRow,
  resolveTotalArbsFromGenderCounts
} from '../public/reportingUtils.js';

const PROVINCIAL_NODES = REGIONAL_REGISTRY.filter((n) => n.role === 'Provincial Node');

function findLinkedDatabaseRow(dbRows, lhid) {
  const key = String(lhid ?? '').trim().toLowerCase();
  if (!key || !Array.isArray(dbRows)) return null;
  const cleanKey = formatLhidDisplay(lhid).toLowerCase();
  return (
    dbRows.find((r) => {
      const rKey = String(r?.lhid ?? '').trim().toLowerCase();
      const rClean = formatLhidDisplay(r?.lhid).toLowerCase();
      return rKey === key || rClean === cleanKey || rKey === cleanKey || rClean === key;
    }) || null
  );
}

/**
 * Default Target Year (Current / Previous Year) from the linked Database row when blank.
 */
function applyTargetPeriodDefault(row, dbRow) {
  if (!row || String(row.target ?? '').trim() !== '') return false;
  row.target = resolveTargetFromDatabaseRow(dbRow);
  return true;
}

/**
 * Normalize RegistrationDistribution ARB counts, Target Year, and legacy gender field.
 */
function applyRegistrationDistributionDefaults(row, dbRow) {
  if (!row) return false;
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(row, 'gender')) {
    const legacyGender = String(row.gender ?? '').trim().toLowerCase();
    const hasGenderCounts =
      String(row.maleArbs ?? '').trim() !== '' || String(row.femaleArbs ?? '').trim() !== '';
    if (!hasGenderCounts && legacyGender) {
      const count = String(row.noOfArbs ?? '').trim() || '1';
      if (legacyGender.startsWith('m')) {
        row.maleArbs = count;
        row.femaleArbs = '0';
      } else if (legacyGender.startsWith('f')) {
        row.maleArbs = '0';
        row.femaleArbs = count;
      }
    }
    delete row.gender;
    changed = true;
  }
  if (String(row.noOfArbs ?? '').trim() === '') {
    const derivedTotal = resolveTotalArbsFromGenderCounts(row.maleArbs, row.femaleArbs);
    if (derivedTotal) {
      row.noOfArbs = derivedTotal;
      changed = true;
    }
  }
  if (applyTargetPeriodDefault(row, dbRow)) {
    changed = true;
  }
  return changed;
}

function applyTabRowDefaults(tabName, row, dbRow) {
  let changed = false;
  if (tabName === 'Survey') {
    if (applySurveyCurrentStatus(row)) changed = true;
  } else if (tabName === 'RegistrationDistribution') {
    if (applyRegistrationDistributionDefaults(row, dbRow)) changed = true;
  } else if (tabName === 'Installation') {
    if (applyTargetPeriodDefault(row, dbRow)) changed = true;
  }

  // Auto-connect targetYear from linked Database row if unset
  if (tabName !== 'Database' && (!row.targetYear || String(row.targetYear).trim() === '') && dbRow) {
    const yr = formatYearDisplay(dbRow.year || dbRow.targetYear || '');
    if (yr) {
      row.targetYear = yr;
      changed = true;
    }
  } else if (row.targetYear) {
    const cleanYr = formatYearDisplay(row.targetYear);
    if (cleanYr && cleanYr !== row.targetYear) {
      row.targetYear = cleanYr;
      changed = true;
    }
  }

  // Normalize reportedMonth / monthReported
  if (row.reportedMonth) {
    const cleanMo = formatReportedMonthWord(row.reportedMonth);
    if (cleanMo && cleanMo !== row.reportedMonth) {
      row.reportedMonth = cleanMo;
      changed = true;
    }
  }
  if (row.monthReported) {
    const cleanMo = formatReportedMonthWord(row.monthReported);
    if (cleanMo && cleanMo !== row.monthReported) {
      row.monthReported = cleanMo;
      changed = true;
    }
  }

  return changed;
}

/**
 * Populate Survey currentStatus/currentDate from the latest workflow stage date
 * when unset or holding an unnumbered placeholder status label.
 */
function applySurveyCurrentStatus(row) {
  if (!row) return false;
  const existingStatus = String(row.currentStatus ?? '').trim();
  const existingDate = String(row.currentDate ?? '').trim();
  const isUnset = existingStatus === '' && existingDate === '';
  const isLegacyLabel = LEGACY_SURVEY_STATUS_LABELS.has(existingStatus);
  if (!isUnset && !isLegacyLabel) {
    return false;
  }
  const { currentStatus, currentDate } = resolveSurveyCurrentStatus(row);
  let changed = false;
  if (currentStatus && row.currentStatus !== currentStatus) {
    row.currentStatus = currentStatus;
    changed = true;
  }
  if (currentDate && row.currentDate !== currentDate) {
    row.currentDate = currentDate;
    changed = true;
  }
  return changed;
}

export function resolveTargetTab(target) {
  const norm = String(target || '').trim();
  if (norm.toLowerCase() === 'land valuation' || norm.toLowerCase() === 'mov') {
    return 'MOV';
  }
  if (norm.toLowerCase() === 'leasehold' || norm.toLowerCase() === 'leaseholl') {
    return 'Leasehold';
  }
  return norm;
}

const DATABASE_TO_TARGET_MAP = {
  'CF(DOC)': {
    lhid: 'lhid',
    target: (r) => resolveTargetFromDatabaseRow(r),
    reportedMonth: () => formatCurrentMonthYear(),
    targetYear: (r) => formatYearDisplay(r.year || r.targetYear || '')
  },
  Survey: {
    lhid: 'lhid',
    target: (r) => resolveTargetFromDatabaseRow(r),
    reportedMonth: () => formatCurrentMonthYear(),
    targetYear: (r) => formatYearDisplay(r.year || r.targetYear || '')
  },
  MOV: {
    lhid: 'lhid',
    lotNumber: 'lotNumber',
    subLotNumber: 'subLotNumber',
    target: (r) => resolveTargetFromDatabaseRow(r),
    reportedMonth: () => formatCurrentMonthYear(),
    targetYear: (r) => formatYearDisplay(r.year || r.targetYear || '')
  },
  'Land Valuation': {
    lhid: 'lhid',
    lotNumber: 'lotNumber',
    subLotNumber: 'subLotNumber',
    target: (r) => resolveTargetFromDatabaseRow(r),
    reportedMonth: () => formatCurrentMonthYear(),
    targetYear: (r) => formatYearDisplay(r.year || r.targetYear || '')
  },
  'Land valuation': {
    lhid: 'lhid',
    lotNumber: 'lotNumber',
    subLotNumber: 'subLotNumber',
    target: (r) => resolveTargetFromDatabaseRow(r),
    reportedMonth: () => formatCurrentMonthYear(),
    targetYear: (r) => formatYearDisplay(r.year || r.targetYear || '')
  },
  RegistrationDistribution: {
    lhid: 'lhid',
    region: 'regionName',
    province: 'province',
    municipality: 'municipality',
    barangay: 'barangay',
    areaHas: (r) => r.totalArea || r.carpable || r.computedArea || '',
    moa: 'moa',
    rodTitleNo: 'titleNumber',
    target: (r) => resolveTargetFromDatabaseRow(r),
    monthReported: () => formatCurrentMonthYear(),
    targetYear: (r) => formatYearDisplay(r.year || r.targetYear || '')
  },
  Installation: {
    lhid: 'lhid',
    region: 'regionName',
    province: 'province',
    municipality: 'municipality',
    barangay: 'barangay',
    loLastName: 'landOwner',
    titleOrTaxDecNo: 'titleNumber',
    lotNo: 'lotNumber',
    areaHas1: (r) => r.totalArea || r.computedArea || '',
    surveyNo: 'surveyNumber',
    areaHas2: (r) => r.totalArea || r.distributedArea || r.carpable || r.computedArea || '',
    target: (r) => resolveTargetFromDatabaseRow(r),
    monthReported: () => formatCurrentMonthYear(),
    targetYear: (r) => formatYearDisplay(r.year || r.targetYear || '')
  },
  Leasehold: {
    lhid: 'lhid',
    reg: (r) => r.regionName || 'Region VIII',
    provs: (r) => r.province || 'Leyte',
    mun: (r) => r.municipality || '',
    brgy: (r) => r.barangay || '',
    titleNo: (r) => r.titleNumber || '',
    areaPerTitle: (r) => r.totalArea || '',
    areaTenanted: (r) => r.carpable || r.totalArea || '',
    targetYear: (r) => formatYearDisplay(r.year || r.targetYear || '')
  }
};

const MONTH_NAME_INDEX = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12
};

function parseMetricNumber(val) {
  const cleaned = typeof val === 'string' ? val.replace(/,/g, '').trim() : val;
  if (cleaned === '' || cleaned === null || cleaned === undefined) return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

/** Extract `{ year, month, quarter }` from ISO, MM/DD/YYYY, or "Month YYYY" strings. */
function parseQuarterAndYear(raw, fallbackYear = null) {
  const str = String(raw ?? '').trim();
  if (!str) return null;

  const isoMatch = str.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) {
      return { year, month, quarter: Math.ceil(month / 3) };
    }
  }

  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const month = first > 12 ? second : first;
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) {
      return { year, month, quarter: Math.ceil(month / 3) };
    }
  }

  const wordMatch = str.match(/\b([A-Za-z]+)\s+(\d{4})\b/);
  if (wordMatch) {
    const month = MONTH_NAME_INDEX[wordMatch[1].toLowerCase()];
    const year = Number(wordMatch[2]);
    if (month && year >= 1900 && year <= 2100) {
      return { year, month, quarter: Math.ceil(month / 3) };
    }
  }

  // Check MonthName alone (e.g. "March", "November") with fallbackYear
  const singleMonthMatch = str.match(/^([A-Za-z]+)\.?$/);
  if (singleMonthMatch) {
    const month = MONTH_NAME_INDEX[singleMonthMatch[1].toLowerCase()];
    const year = Number(fallbackYear);
    if (month && year >= 1900 && year <= 2100) {
      return { year, month, quarter: Math.ceil(month / 3) };
    }
  }

  if (!/^\d+(?:\.\d+)?$/.test(str)) {
    const dt = new Date(str);
    if (!Number.isNaN(dt.getTime())) {
      const year = dt.getFullYear();
      const month = dt.getMonth() + 1;
      if (year >= 1900 && year <= 2100) {
        return { year, month, quarter: Math.ceil(month / 3) };
      }
    }
  }

  return null;
}

const REPORTED_MONTH_KEYS = [
  'reportedMonth',
  'Reported Month',
  'monthReported',
  'Month Reported',
  'reportMonth',
  'Report Month',
  'Report Month (Words)'
];

function resolveFirstDateQuarter(row, dateKeys, fallbackYear = null) {
  const rowTargetYear =
    Number(
      row?.targetYear ||
      row?.['Year Target'] ||
      row?.['YEAR TARGET'] ||
      row?.['Target Year'] ||
      row?.['TARGET YEAR'] ||
      row?.year ||
      row?.['Year']
    ) || fallbackYear;

  // 1. Accomplishment quarter/month/year must be derived primarily from Reported Month
  for (const key of REPORTED_MONTH_KEYS) {
    if (row?.[key]) {
      const parsed = parseQuarterAndYear(row[key], rowTargetYear);
      if (parsed) return parsed;
    }
  }

  // 2. Fall back to milestone completion date keys
  for (const key of dateKeys) {
    if (!REPORTED_MONTH_KEYS.includes(key) && row?.[key]) {
      const parsed = parseQuarterAndYear(row[key], rowTargetYear);
      if (parsed) return parsed;
    }
  }
  return null;
}

function getDbParcelArea(dbRow) {
  if (!dbRow) return 0;
  return (
    parseMetricNumber(dbRow.totalArea) ||
    parseMetricNumber(dbRow.carpable) ||
    parseMetricNumber(dbRow.computedArea) ||
    0
  );
}

export function isSurveyAccomplished(r, targetYearFilter = null) {
  if (!r) return false;
  const repMonth = String(
    (Array.isArray(r) ? r[39] : '') ||
    r.reportedMonth ||
    r['Reported Month'] ||
    r.monthReported ||
    r['Month Reported'] ||
    r.reportMonth ||
    r['Report Month'] ||
    r['REPORT MONTH'] ||
    ''
  ).trim();

  if (
    !repMonth ||
    repMonth === '-' ||
    repMonth === '—' ||
    repMonth === 'N/A' ||
    repMonth.toLowerCase() === 'null' ||
    repMonth.toLowerCase() === 'undated' ||
    repMonth.toLowerCase() === 'pending'
  ) {
    return false;
  }

  const targetYearRaw = String(
    (Array.isArray(r) ? r[43] : '') ||
    r.targetYear ||
    r['Target Year'] ||
    r['TARGET YEAR'] ||
    r.year ||
    r['Year'] ||
    ''
  ).trim();

  const targetYearMatch = targetYearRaw.match(/\b(20\d{2})\b/);
  const targetYear = targetYearMatch
    ? Number(targetYearMatch[1])
    : targetYearFilter && targetYearFilter !== 'ALL'
    ? Number(targetYearFilter)
    : null;

  if (!targetYear) return false;

  const parsed = parseQuarterAndYear(repMonth, targetYear);
  if (!parsed || !parsed.year) return false;

  // Accomplishment rule: count if the LHs have Reported Month is equal to the year Target in Column AR
  if (parsed.year !== targetYear) return false;
  if (targetYearFilter && targetYearFilter !== 'ALL' && targetYear !== Number(targetYearFilter)) {
    return false;
  }

  return true;
}

export function isMilestoneDatePopulated(val) {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  if (
    !s ||
    s === '-' ||
    s === '—' ||
    s === 'N/A' ||
    s === 'n/a' ||
    s.toLowerCase() === 'null' ||
    s.toLowerCase() === 'undated' ||
    s.toLowerCase() === 'pending'
  ) {
    return false;
  }
  return true;
}

export function isMovAccomplished(r, targetYearFilter = null) {
  if (!r) return false;
  const targetYearRaw = String(
    (Array.isArray(r) ? r[12] : '') ||
    r.targetYear ||
    r['Year Target'] ||
    r['YEAR TARGET'] ||
    r['Target Year'] ||
    r['TARGET YEAR'] ||
    r.year ||
    r['Year'] ||
    ''
  ).trim();

  const targetYearMatch = targetYearRaw.match(/\b(20\d{2})\b/);
  let targetYear = targetYearMatch ? Number(targetYearMatch[1]) : null;
  if (!targetYear && targetYearFilter && targetYearFilter !== 'ALL') {
    targetYear = Number(targetYearFilter);
  }
  if (!targetYear) {
    const dateStr = [
      (Array.isArray(r) ? r[1] : '') || r.ppuDate || r['PPU Date'] || r['PPU DATE'] || r['WITH PPU DATE'],
      (Array.isArray(r) ? r[3] : '') || r.dateReceivedDarpo || r['Date Received at DARPO'] || r['Received DARPO'] || r['WITH RECEIVED DARPO'],
      (Array.isArray(r) ? r[5] : '') || r.dateOfMov || r['Date of MOV'] || r['DATE OF MOV'] || r['WITH DATE OF MOV'],
      (Array.isArray(r) ? r[6] : '') || r.dateTransLbpAoc || r['Date Trans to LBP/AOC'] || r['TRANS TO LBP/AOC'] || r['WITH TRANS TO LBP/AOC'],
      (Array.isArray(r) ? r[10] : '') || r.reportedMonth || r['Reported Month'] || r['REPORTED MONTH'] || r['WITH REPORTED MONTH']
    ].filter(isMilestoneDatePopulated).join(' ');
    const dm = dateStr.match(/\b(20\d{2})\b/);
    if (dm) targetYear = Number(dm[1]);
  }

  if (!targetYear) return false;
  if (targetYearFilter && targetYearFilter !== 'ALL' && targetYear !== Number(targetYearFilter)) {
    return false;
  }

  // Count if any of the Land Valuation milestone indicators are populated:
  // Column B: PPU Date
  // Column D: WITH RECEIVED DARPO
  // Column F: WITH DATE OF MOV
  // Column G: WITH TRANS TO LBP/AOC
  // Column K: WITH REPORTED MONTH
  const hasPpu = isMilestoneDatePopulated((Array.isArray(r) ? r[1] : '') || r.ppuDate || r['PPU Date'] || r['PPU DATE'] || r['WITH PPU DATE']);
  const hasDarpo = isMilestoneDatePopulated((Array.isArray(r) ? r[3] : '') || r.dateReceivedDarpo || r['Date Received at DARPO'] || r['Received DARPO'] || r['WITH RECEIVED DARPO']);
  const hasMov = isMilestoneDatePopulated((Array.isArray(r) ? r[5] : '') || r.dateOfMov || r['Date of MOV'] || r['DATE OF MOV'] || r['WITH DATE OF MOV']);
  const hasTrans = isMilestoneDatePopulated((Array.isArray(r) ? r[6] : '') || r.dateTransLbpAoc || r['Date Trans to LBP/AOC'] || r['TRANS TO LBP/AOC'] || r['WITH TRANS TO LBP/AOC']);
  const repMonth = String((Array.isArray(r) ? r[10] : '') || r.reportedMonth || r['Reported Month'] || r['REPORTED MONTH'] || r['WITH REPORTED MONTH'] || '').trim();
  const hasRepMonth = isMilestoneDatePopulated(repMonth);

  if (!hasPpu && !hasDarpo && !hasMov && !hasTrans && !hasRepMonth) {
    return false;
  }

  if (hasRepMonth) {
    const wordMatch = repMonth.match(/\b([A-Za-z]+)\s*,?\s*(\d{4})\b/);
    if (wordMatch && Number(wordMatch[2]) !== targetYear) {
      return false;
    }
  }

  return true;
}

const MILESTONE_ANALYTICS_SPECS = {
  cf_doc: {
    tabName: 'CF(DOC)',
    dateKeys: ['reportedMonth', 'datePreparedSigned', 'dateFiConducted'],
    include: () => true,
    getCount: () => 1,
    getArea: (_r, db) => getDbParcelArea(db)
  },
  land_survey: {
    tabName: 'Survey',
    dateKeys: [
      'reportedMonth',
      'Reported Month',
      'monthReported',
      'Month Reported',
      'reportMonth',
      'Report Month'
    ],
    // Accomplishment rule: count if the LHs have Reported Month is equal to the year Target in Column AR
    include: (r, filterYear) => isSurveyAccomplished(r, filterYear),
    getCount: () => 1,
    getArea: (_r, db) => getDbParcelArea(db)
  },
  land_valuation: {
    tabName: 'MOV',
    dateKeys: [
      'reportedMonth',
      'Reported Month',
      'dateTransLbpAoc',
      'Date Trans to LBP/AOC',
      'TRANS TO LBP/AOC',
      'dateOfMov',
      'Date of MOV',
      'dateReceivedDarpo',
      'Date Received at DARPO',
      'Received DARPO',
      'ppuDate',
      'PPU Date'
    ],
    // Accomplishment rule: count PPU Date in Col B, Received DARPO in Col D, Date of MOV in Col F, Trans to LBP/AOC in Col G, Reported Month in Col K equal to Year Target in Col M
    include: (r, filterYear) => isMovAccomplished(r, filterYear),
    getCount: () => 1,
    getArea: (_r, db) => getDbParcelArea(db)
  },
  ep_cloa_registration: {
    tabName: 'RegistrationDistribution',
    dateKeys: ['monthReported', 'reportedMonth', 'dateRegistered'],
    include: (r) => {
      const d = String(r?.dateRegistered || r?.['DATE REGISTERED'] || r?.['Date Registered'] || r?.date_registered || '').trim();
      return d !== '' && d !== '-' && d !== 'N/A' && d.toLowerCase() !== 'null';
    },
    getCount: (r) => Math.max(1, Number.parseInt(r?.noOfTitles, 10) || 1),
    getArea: (r, db) => parseMetricNumber(r?.areaHas) || getDbParcelArea(db)
  },
  ep_cloa_distribution: {
    tabName: 'RegistrationDistribution',
    dateKeys: ['monthReported', 'reportedMonth', 'dateOfDistribution'],
    include: (r) => String(r?.dateOfDistribution || '').trim() !== '',
    getCount: (r) => Math.max(1, Number.parseInt(r?.noOfTitles, 10) || 1),
    getArea: (r, db) => parseMetricNumber(r?.areaHas) || getDbParcelArea(db)
  },
  installation: {
    tabName: 'Installation',
    dateKeys: ['monthReported', 'reportedMonth', 'dateOfInstallation', 'dateDistributed', 'dateRegistered'],
    include: (r) => !['no', 'false', '0'].includes(String(r?.installedStatus || '').trim().toLowerCase()),
    getCount: (r) => Math.max(1, Number.parseInt(r?.noOfTitles, 10) || 1),
    getArea: (r, db) =>
      parseMetricNumber(r?.areaHas2) || parseMetricNumber(r?.areaHas1) || getDbParcelArea(db)
  },
  leasehold: {
    tabName: 'Leasehold',
    dateKeys: ['reportMonth', 'reportedMonth', 'monthReported', 'dateContractRegistered', 'datePlrRegistered'],
    include: () => true,
    getCount: () => 1,
    getArea: (r) => parseMetricNumber(r?.areaTenanted) || parseMetricNumber(r?.areaPerTitle) || 0
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.join(__dirname, 'data');

/** Resolve storage directory, falling back to /tmp on Vercel read-only filesystems. */
export function resolveDefaultDataDir() {
  return process.env.VERCEL ? path.join(os.tmpdir(), 'salig-data') : DEFAULT_DATA_DIR;
}

export class ConsolidatedStore {
  constructor(dataDir) {
    const resolvedDir = (dataDir && typeof dataDir === 'object') ? dataDir.dataDir : dataDir;
    this.isVercelTmpFallback = !resolvedDir && Boolean(process.env.VERCEL);
    this.dataDir = resolvedDir || resolveDefaultDataDir();
    this.storePath = path.join(this.dataDir, 'store.json');
    this.state = null;
    this.load();
  }

  ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  load() {
    this.ensureDir();
    const bundledStorePath = path.join(DEFAULT_DATA_DIR, 'store.json');
    if (this.isVercelTmpFallback && !fs.existsSync(this.storePath) && fs.existsSync(bundledStorePath)) {
      fs.copyFileSync(bundledStorePath, this.storePath);
    }
    if (fs.existsSync(this.storePath)) {
      try {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        this.state = JSON.parse(raw);
        this.normalizeState();
        return;
      } catch (err) {
        console.error('Failed to read store.json, re-initializing:', err);
      }
    }
    this.state = createSeedState();
    this.normalizeState();
    this.save();
  }

  normalizeState() {
    const seed = createSeedState();
    if (!this.state.baselines) this.state.baselines = seed.baselines;
    this.state.nepTargets = normalizeNepTargets(this.state.nepTargets);
    this.state.nepProvinceList = normalizeNepProvinceList(this.state.nepProvinceList);
    this.state.nepMilestoneList = normalizeNepMilestoneList(this.state.nepMilestoneList);

    // Multi-Year NEP Targets support
    if (!this.state.nepMilestoneListByYear || typeof this.state.nepMilestoneListByYear !== 'object') {
      this.state.nepMilestoneListByYear = {};
    }
    if (!this.state.nepProvinceListByYear || typeof this.state.nepProvinceListByYear !== 'object') {
      this.state.nepProvinceListByYear = {};
    }
    if (!this.state.nepTargetsByYear || typeof this.state.nepTargetsByYear !== 'object') {
      this.state.nepTargetsByYear = {};
    }

    // Populate multi-year index from current nepProvinceList and nepMilestoneList
    if (this.state.nepProvinceList) {
      for (const [code, item] of Object.entries(this.state.nepProvinceList)) {
        const yr = Math.round(Number(item.year) || 2026);
        if (!this.state.nepProvinceListByYear[yr]) this.state.nepProvinceListByYear[yr] = {};
        this.state.nepProvinceListByYear[yr][code] = item;
      }
    }
    if (this.state.nepMilestoneList) {
      for (const [msKey, provMap] of Object.entries(this.state.nepMilestoneList)) {
        if (provMap && typeof provMap === 'object') {
          for (const [code, item] of Object.entries(provMap)) {
            const yr = Math.round(Number(item.year) || new Date().getFullYear());
            if (!this.state.nepMilestoneListByYear[yr]) this.state.nepMilestoneListByYear[yr] = {};
            if (!this.state.nepMilestoneListByYear[yr][msKey]) this.state.nepMilestoneListByYear[yr][msKey] = {};
            this.state.nepMilestoneListByYear[yr][msKey][code] = item;
          }
        }
      }
    }
    if (!Array.isArray(this.state.milestoneData)) this.state.milestoneData = [];
    if (!this.state.uploadedFiles || typeof this.state.uploadedFiles !== 'object') {
      this.state.uploadedFiles = {};
    }
    for (const m of this.state.milestoneData) {
      if (m?.LHID) {
        const cleanLhid = formatLhidDisplay(m.LHID);
        if (cleanLhid !== m.LHID) {
          m.LHID = cleanLhid;
          dirty = true;
        }
      }
    }
    if (!this.state.optool) this.state.optool = {};
    if (!this.state.optool['Land Valuation']) {
      Object.defineProperty(this.state.optool, 'Land Valuation', {
        get() { return this.MOV; },
        set(v) { this.MOV = v; },
        enumerable: false,
        configurable: true
      });
    }
    let dirty = false;
    const dbByLhid = new Map();
    for (const r of (Array.isArray(this.state.optool.Database) ? this.state.optool.Database : [])) {
      if (!r?.lhid) continue;
      const rawKey = String(r.lhid).trim().toLowerCase();
      const cleanKey = formatLhidDisplay(r.lhid).toLowerCase();
      if (cleanKey && !dbByLhid.has(cleanKey)) dbByLhid.set(cleanKey, r);
      if (rawKey && !dbByLhid.has(rawKey)) dbByLhid.set(rawKey, r);
    }
    for (const tab of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
      if (!Array.isArray(this.state.optool[tab])) {
        this.state.optool[tab] = [];
        dirty = true;
      } else {
        const schemaCols = OPTOOL_SHEET_SCHEMAS[tab];
        for (const row of this.state.optool[tab]) {
          if (!row || typeof row !== 'object') continue;
          if (row.lhid) {
            const cleanLhid = formatLhidDisplay(row.lhid);
            if (cleanLhid !== row.lhid) {
              row.lhid = cleanLhid;
              dirty = true;
            }
          }
          if (row.lotNumber && /^\d+\.0+$/.test(String(row.lotNumber).trim())) {
            row.lotNumber = String(row.lotNumber).trim().split('.')[0];
            dirty = true;
          }
          if (row.subLotNumber && /^\d+\.0+$/.test(String(row.subLotNumber).trim())) {
            row.subLotNumber = String(row.subLotNumber).trim().split('.')[0];
            dirty = true;
          }
          if (row.titleNumber && /^\d+\.0+$/.test(String(row.titleNumber).trim())) {
            row.titleNumber = String(row.titleNumber).trim().split('.')[0];
            dirty = true;
          }
          if (tab === 'CF(DOC)' && Object.prototype.hasOwnProperty.call(row, 'carperLadForm47')) {
            if (!row.carperLadForm42 && row.carperLadForm47) {
              row.carperLadForm42 = row.carperLadForm47;
            }
            delete row.carperLadForm47;
            dirty = true;
          }
          for (const col of schemaCols) {
            const k = col.key;
            if (col.type === 'pdfFile' || k === 'pdfFile' || k === 'transmittalSrPdf') {
              if (row[k] && String(row[k]).startsWith('data:application/pdf')) {
                const fileId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const rawStr = String(row[k]);
                const base64Data = rawStr.split(',')[1] || '';
                this.state.uploadedFiles[fileId] = {
                  fileName: `${tab}_${k}.pdf`,
                  data: base64Data,
                  createdAt: new Date().toISOString()
                };
                row[k] = `/api/pdf/${fileId}`;
                dirty = true;
              }
            }
          }
          if (Object.prototype.hasOwnProperty.call(row, 'test')) {
            delete row.test;
            dirty = true;
          }
          // Universal year rescue from PDF fields across all tabs (e.g. CF(DOC), Survey, MOV, etc.)
          if (row.pdfFile && /^(20\d{2})(\.0+)?$/.test(String(row.pdfFile).trim())) {
            const ym = String(row.pdfFile).trim().replace(/\.0+$/, '').match(/^(20\d{2})$/);
            if (ym && (!row.targetYear || String(row.targetYear).trim() === '')) {
              row.targetYear = ym[1];
            }
            row.pdfFile = '';
            dirty = true;
          }
          if (row['PDF File'] && /^(20\d{2})(\.0+)?$/.test(String(row['PDF File']).trim())) {
            const ym = String(row['PDF File']).trim().replace(/\.0+$/, '').match(/^(20\d{2})$/);
            if (ym && (!row.targetYear || String(row.targetYear).trim() === '')) {
              row.targetYear = ym[1];
            }
            delete row['PDF File'];
            dirty = true;
          }
          if (tab === 'Survey') {
            if (Object.prototype.hasOwnProperty.call(row, 'srForwardedPreIvas')) {
              delete row.srForwardedPreIvas;
              dirty = true;
            }
          }
          for (const col of schemaCols) {
            if (!Object.prototype.hasOwnProperty.call(row, col.key) || row[col.key] === '') {
              const altVal =
                row[col.header] ??
                (col.key === 'areaHas'
                  ? (row['AREA (HAs)'] ?? row['AREA(HAS)'] ?? row['Area (HAs)'] ?? row['AREA'])
                  : undefined) ??
                (col.key === 'dateRegistered'
                  ? (row['DATE REGISTERED'] ?? row['Date Registered'])
                  : undefined) ??
                (col.key === 'lhid'
                  ? (row['LHID/ Sequence No.'] ?? row['LHID / Sequence No.'])
                  : undefined);
              if (altVal !== undefined && altVal !== '') {
                row[col.key] = altVal;
                dirty = true;
              } else if (!Object.prototype.hasOwnProperty.call(row, col.key)) {
                row[col.key] = '';
                dirty = true;
              }
            } else if (col.type === 'checkbox') {
              const normalized = normalizeChecklistValue(row[col.key]);
              if (row[col.key] !== normalized) {
                row[col.key] = normalized;
                dirty = true;
              }
            }
          }
          const rawKey = String(row.lhid ?? '').trim().toLowerCase();
          const cleanKey = formatLhidDisplay(row.lhid).toLowerCase();
          const linkedDbRow =
            (cleanKey ? dbByLhid.get(cleanKey) : null) ||
            (rawKey ? dbByLhid.get(rawKey) : null) ||
            null;
          if (applyTabRowDefaults(tab, row, linkedDbRow)) {
            dirty = true;
          }
        }
      }
      // Deduplicate rows within tab using canonical key
      if (Array.isArray(this.state.optool[tab]) && this.state.optool[tab].length > 1) {
        const seenKeys = new Map();
        const dedupedRows = [];
        for (const row of this.state.optool[tab]) {
          if (!row || typeof row !== 'object') continue;
          const key = getOptoolRowKey(tab, row);
          if (!key) {
            dedupedRows.push(row);
            continue;
          }
          if (seenKeys.has(key)) {
            const existingIdx = seenKeys.get(key);
            const target = dedupedRows[existingIdx];
            for (const [k, v] of Object.entries(row)) {
              if (v !== '' && v !== null && v !== undefined && (target[k] === '' || target[k] === null || target[k] === undefined)) {
                target[k] = v;
              }
            }
            dirty = true;
          } else {
            seenKeys.set(key, dedupedRows.length);
            dedupedRows.push(row);
          }
        }
        if (dedupedRows.length !== this.state.optool[tab].length) {
          this.state.optool[tab] = dedupedRows;
          dirty = true;
        }
      }
    }
    if (!this.state.gasWebAppUrl && process.env.GAS_WEB_APP_URL) {
      this.state.gasWebAppUrl = String(process.env.GAS_WEB_APP_URL).trim();
    }
    if (!this.state.driveFolderId) {
      this.state.driveFolderId = '1z7SycuDvk9M5pPDZ2IvhwebQDsGHOhsJ';
      dirty = true;
    }
    if (!this.state.authSecret) {
      this.state.authSecret =
        String(process.env.SALIG_AUTH_SECRET || '').trim() ||
        crypto.randomBytes(32).toString('hex');
      dirty = true;
    }
    if (!Array.isArray(this.state.users)) {
      this.state.users = [];
      dirty = true;
    }
    if (!Array.isArray(this.state.auditLogs)) {
      this.state.auditLogs = [];
      dirty = true;
    }
    if (!Array.isArray(this.state.deletedUserEmails)) {
      this.state.deletedUserEmails = [];
      dirty = true;
    }
    if (!Array.isArray(this.state.deletedUserIds)) {
      this.state.deletedUserIds = [];
      dirty = true;
    }
    if (this.state.deletedUserEmails.length > 0 || this.state.deletedUserIds.length > 0) {
      for (const u of (this.state.users || [])) {
        if (u && (u.status === 'approved' || u.status === 'pending') && this.isUserDeleted(u.email, u.id)) {
          this.clearDeletedUserTombstone(u.email, u.id);
        }
      }
      const beforeCount = (this.state.users || []).length;
      this.state.users = (this.state.users || []).filter((u) => !this.isUserDeleted(u?.email, u?.id));
      if (this.state.users.length !== beforeCount) {
        dirty = true;
      }
    }
    const hasApprovedAdmin = this.state.users.some(
      (u) => u && u.role === 'admin' && u.status === 'approved'
    );
    if (!hasApprovedAdmin) {
      const adminEmail = String(DEFAULT_ADMIN_EMAIL || 'admin@dar8.gov.ph').trim().toLowerCase();
      const existingAdmin = this.state.users.find(
        (u) => u && String(u.email || '').trim().toLowerCase() === adminEmail
      );
      const now = new Date().toISOString();
      if (existingAdmin) {
        existingAdmin.role = 'admin';
        existingAdmin.status = 'approved';
        existingAdmin.updatedAt = now;
        existingAdmin.approvedAt = existingAdmin.approvedAt || now;
        existingAdmin.approvedBy = existingAdmin.approvedBy || 'system';
      } else {
        this.state.users.push({
          id: `usr-admin-${crypto.randomBytes(4).toString('hex')}`,
          name: 'Region VIII Administrator',
          email: adminEmail,
          province: 'Region VIII Hub',
          contactNumber: '0917-000-0000',
          passwordHash: hashPassword(DEFAULT_ADMIN_PASSWORD),
          role: 'admin',
          status: 'approved',
          createdAt: now,
          updatedAt: now,
          approvedAt: now,
          approvedBy: 'system'
        });
      }
      dirty = true;
    }
    if (!Array.isArray(this.state.syncLogs)) this.state.syncLogs = [];
    if (!this.state.pendingOtps || typeof this.state.pendingOtps !== 'object') {
      this.state.pendingOtps = {};
    }
    const nowMs = Date.now();
    for (const [k, entry] of Object.entries(this.state.pendingOtps)) {
      if (!entry || !entry.expiresAt || Number(entry.expiresAt) < nowMs) {
        delete this.state.pendingOtps[k];
      }
    }
    if (!this.state.liveHubSnapshot) {
      this.state.liveHubSnapshot = { checkedAt: null, reachable: null, tabRowCounts: {} };
    }
    if (!Array.isArray(this.state.leasehold)) {
      this.state.leasehold = [];
      dirty = true;
    } else {
      for (let i = 0; i < this.state.leasehold.length; i++) {
        const norm = normalizeLeaseholdRow(this.state.leasehold[i]);
        if (JSON.stringify(norm) !== JSON.stringify(this.state.leasehold[i])) {
          this.state.leasehold[i] = norm;
          dirty = true;
        }
      }
      if (this.state.leasehold.length > 1) {
        const seenLh = new Map();
        const dedupedLh = [];
        for (const row of this.state.leasehold) {
          if (!row || typeof row !== 'object') continue;
          const key = getOptoolRowKey('Leasehold', row);
          if (!key) {
            dedupedLh.push(row);
            continue;
          }
          if (seenLh.has(key)) {
            const existingIdx = seenLh.get(key);
            const target = dedupedLh[existingIdx];
            for (const [k, v] of Object.entries(row)) {
              if (v !== '' && v !== null && v !== undefined && (target[k] === '' || target[k] === null || target[k] === undefined)) {
                target[k] = v;
              }
            }
            dirty = true;
          } else {
            seenLh.set(key, dedupedLh.length);
            dedupedLh.push(row);
          }
        }
        if (dedupedLh.length !== this.state.leasehold.length) {
          this.state.leasehold = dedupedLh;
          dirty = true;
        }
      }
    }
    if (!Array.isArray(this.state.optool.Leasehold) || this.state.optool.Leasehold !== this.state.leasehold) {
      this.state.optool.Leasehold = this.state.leasehold;
    }
    if (dirty && fs.existsSync(this.storePath)) {
      this.save();
    }
  }

  save() {
    this.ensureDir();
    const tmpPath = `${this.storePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.storePath);
  }

  addSyncLog(source, status, message, details = null) {
    this.state.syncLogs.unshift({
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      source,
      status,
      message,
      details
    });
    if (this.state.syncLogs.length > 50) {
      this.state.syncLogs = this.state.syncLogs.slice(0, 50);
    }
  }

  generateNextRecordId(provinceCode, milestoneDate) {
    const prov = PROVINCE_CODES.includes(provinceCode) ? provinceCode : 'LEY';
    const cleanDate = /^\d{4}-\d{2}/.test(String(milestoneDate || ''))
      ? String(milestoneDate).slice(0, 7).replace('-', '')
      : new Date().toISOString().slice(0, 7).replace('-', '');
    const prefix = `${prov}-${cleanDate}-`;
    let maxSeq = 0;
    for (const row of this.state.milestoneData) {
      if (String(row.Record_ID || '').startsWith(prefix)) {
        const suffix = Number(String(row.Record_ID).slice(prefix.length));
        if (Number.isFinite(suffix) && suffix > maxSeq) {
          maxSeq = suffix;
        }
      }
    }
    return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
  }

  upsertMilestone(payload, options = {}) {
    const { skipSave = false } = options;
    const provinceCode =
      PROVINCE_CODES.includes(payload.Province_Code)
        ? payload.Province_Code
        : inferProvinceCodeFromMunicipality(payload.Municipality) ||
          inferProvinceCodeFromText(payload.Record_ID) ||
          'LEY';

    const milestoneDate = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.Milestone_Date || ''))
      ? payload.Milestone_Date
      : new Date().toISOString().slice(0, 10);

    const recordId = String(payload.Record_ID || '').trim() ||
      this.generateNextRecordId(provinceCode, milestoneDate);

    const normalized = {
      Record_ID: recordId,
      Province_Code: provinceCode,
      Municipality: String(payload.Municipality || '').trim(),
      Land_Allocation_ID: String(payload.Land_Allocation_ID || '').trim(),
      eTitle_No: String(payload.eTitle_No || '').trim(),
      Area_HAS: formatArea4(payload.Area_HAS),
      Milestone_Stage: String(payload.Milestone_Stage || MILESTONE_STAGES[5]).trim(),
      Milestone_Date: milestoneDate,
      Batch_Category: String(payload.Batch_Category || 'ADMIN BATCH 1').trim(),
      LHID: String(payload.LHID || '').trim()
    };

    const idx = this.state.milestoneData.findIndex((r) => r.Record_ID === recordId);
    if (idx >= 0) {
      this.state.milestoneData[idx] = normalized;
    } else {
      this.state.milestoneData.unshift(normalized);
    }
    if (!skipSave) this.save();
    return normalized;
  }

  deleteMilestone(recordId) {
    const before = this.state.milestoneData.length;
    this.state.milestoneData = this.state.milestoneData.filter((r) => r.Record_ID !== recordId);
    if (this.state.milestoneData.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  normalizeOptoolRow(tabName, rowPayload, linkedDbRow = null) {
    if (tabName === 'Leasehold') {
      return normalizeLeaseholdRow(rowPayload);
    }
    const schema = OPTOOL_SHEET_SCHEMAS[tabName];
    if (!schema) throw new Error(`Unknown OPTool tab: ${tabName}`);
    const cleanRow = {};
    for (const col of schema) {
      let val = rowPayload[col.key] ?? rowPayload[col.header] ?? '';
      if (col.key === 'carperLadForm42' && (!val || val === '')) {
        val = rowPayload.carperLadForm47 ?? rowPayload['Carper LAD form 47'] ?? '';
      }
      if (col.key === 'areaHas' && (!val || val === '')) {
        val =
          rowPayload['AREA (HAs)'] ??
          rowPayload['AREA(HAS)'] ??
          rowPayload['Area (HAs)'] ??
          rowPayload['Area (HAS)'] ??
          rowPayload['AREA\n(HAs)'] ??
          rowPayload['Area\n (HAs) 2'] ??
          rowPayload['AREA'] ??
          rowPayload.area ??
          rowPayload.totalArea ??
          '';
      }
      if (col.key === 'dateRegistered' && (!val || val === '')) {
        val =
          rowPayload['DATE REGISTERED'] ??
          rowPayload['Date Registered'] ??
          rowPayload.date_registered ??
          rowPayload['Date registered'] ??
          '';
      }
      if (col.key === 'dateAcceptedDenrSmd' && (!val || val === '')) {
        val =
          rowPayload['Date Accepted by DENR-SMD\nDATE'] ??
          rowPayload['Date Accepted by DENR-SMD DATE'] ??
          rowPayload['Date Accepted by DENR-SMD'] ??
          rowPayload['Date accepted by DENR-SMD'] ??
          rowPayload.dateAcceptedDenrSmd ??
          rowPayload.date_accepted_denr_smd ??
          rowPayload.dateAcceptedDenr ??
          rowPayload.dateAccepted ??
          rowPayload.AC ??
          rowPayload['Column AC'] ??
          '';
      }
      if ((col.key === 'lhid' || col.key === 'LHID') && (!val || val === '')) {
        val =
          rowPayload['LHID/ Sequence No.'] ??
          rowPayload['LHID / Sequence No.'] ??
          rowPayload['LHID'] ??
          rowPayload.lhid ??
          '';
      }
      if (col.key === 'surveyRequirement' && (!val || val === '')) {
        val =
          rowPayload['LHs (Needing/Not Needing Survey)'] ??
          rowPayload['LHs (Needing / Not Needing Survey)'] ??
          rowPayload['Needing Survey / Not Needing Survey'] ??
          rowPayload['Needing/Not Needing Survey'] ??
          rowPayload['Survey Requirement'] ??
          rowPayload['surveyRequirement'] ??
          rowPayload['LHs'] ??
          rowPayload.surveyRequirement ??
          rowPayload.surveyNeed ??
          '';
      }
      if (col.type === 'decimal' && val !== '' && val !== null && val !== undefined) {
        const num = Number(val);
        val = Number.isFinite(num) ? num.toFixed(4) : String(val);
      } else if (col.type === 'checkbox') {
        val = normalizeChecklistValue(val);
      } else if (col.type === 'pdfFile' || col.key === 'pdfFile' || (col.label && col.label.toLowerCase().includes('pdf'))) {
        const strVal = String(val ?? '').trim();
        const yearMatch = strVal.replace(/\.0+$/, '').match(/^(20\d{2})$/) || (typeof val === 'number' && val >= 2000 && val <= 2099 ? [String(val), String(val)] : null);
        if (yearMatch) {
          // Mistakenly put Year into PDF File column: redirect to targetYear if not set
          if (!cleanRow.targetYear || String(cleanRow.targetYear).trim() === '') {
            cleanRow.targetYear = yearMatch[1];
          }
          val = '';
        } else if (val === true || val === 'true' || val === 'TRUE') {
          val = 'Yes';
        } else if (val === false || val === 'false' || val === 'FALSE') {
          val = '';
        } else {
          val = strVal;
        }
      } else if (['targetYear', 'year', 'pipelineYear', 'reportYear'].includes(col.key)) {
        val = formatYearDisplay(val || cleanRow[col.key] || '');
      } else if (col.key === 'reportedMonth' || col.key === 'monthReported') {
        val = formatReportedMonthWord(val) || String(val ?? '').trim();
      } else {
        val = String(val ?? '').trim();
      }
      cleanRow[col.key] = val;
    }
    if (rowPayload.province && !cleanRow.province) {
      cleanRow.province = String(rowPayload.province).trim();
    }
    if (rowPayload.provinceCode && !cleanRow.provinceCode) {
      cleanRow.provinceCode = String(rowPayload.provinceCode).trim();
    }
    const resolvedLinked =
      linkedDbRow ||
      (cleanRow.lhid ? findLinkedDatabaseRow(this.state.optool.Database, cleanRow.lhid) : null);
    applyTabRowDefaults(tabName, cleanRow, resolvedLinked);
    return cleanRow;
  }

  upsertOptoolRow(tabName, rowPayload, index = null, options = {}) {
    const { skipSave = false } = options;
    const schema = OPTOOL_SHEET_SCHEMAS[tabName];
    if (!schema) {
      throw new Error(`Unknown OPTool tab: ${tabName}`);
    }
    const cleanRow = this.normalizeOptoolRow(tabName, rowPayload);

    const rows = this.state.optool[tabName];
    if (index !== null && Number.isInteger(index) && index >= 0 && index < rows.length) {
      rows[index] = cleanRow;
    } else {
      const areRowsEqual = (a, b) => {
        if (!a || !b) return false;
        if (JSON.stringify(a) === JSON.stringify(b)) return true;
        for (const col of schema) {
          if ((a[col.key] ?? '') !== (b[col.key] ?? '')) return false;
        }
        return true;
      };
      const existingIdx =
        (tabName === 'Database' || tabName === 'Leasehold') && cleanRow.lhid
          ? rows.findIndex((r) => r.lhid && r.lhid === cleanRow.lhid)
          : cleanRow.id
            ? rows.findIndex((r) => r.id && r.id === cleanRow.id)
            : rows.findIndex((r) => areRowsEqual(r, cleanRow));
      if (existingIdx >= 0) {
        rows[existingIdx] = cleanRow;
      } else {
        rows.unshift(cleanRow);
      }
    }
    if (tabName === 'Leasehold') {
      this.state.leasehold = this.state.optool.Leasehold;
    }
    if (!skipSave) this.save();
    return cleanRow;
  }

  /** Bulk-upsert parsed Milestone_Data, OPTool tabs, and optional NEP province sheet using O(1) indexes and a single save. */
  importParsedDataset(dataset = {}, options = {}) {
    let { milestoneData = [], optool = {}, leasehold = [], nepProvinceList = null, nepMilestoneList = null } = dataset || {};
    const { skipSave = false } = options;
    let importedCount = 0;

    if (Array.isArray(leasehold) && leasehold.length > 0 && (!optool || !optool.Leasehold)) {
      if (!optool) optool = {};
      optool.Leasehold = leasehold;
    }

    if (Array.isArray(milestoneData) && milestoneData.length > 0) {
      const msIndex = new Map();
      this.state.milestoneData.forEach((r, idx) => {
        if (r && r.Record_ID) msIndex.set(r.Record_ID, idx);
      });
      for (const ms of milestoneData) {
        const beforeLen = this.state.milestoneData.length;
        const saved = this.upsertMilestone(ms, { skipSave: true });
        importedCount++;
        if (!msIndex.has(saved.Record_ID) && this.state.milestoneData.length > beforeLen) {
          msIndex.set(saved.Record_ID, 0);
        }
      }
    }

    if (optool && typeof optool === 'object') {
      // Import Database first so linked defaults resolve for downstream tabs
      const orderedTabs = Object.keys(optool).sort((a, b) =>
        a === 'Database' ? -1 : b === 'Database' ? 1 : 0
      );
      let dbByLhid = null;
      const getDbByLhid = () => {
        if (dbByLhid) return dbByLhid;
        dbByLhid = new Map();
        for (const row of this.state.optool.Database || []) {
          const key = String(row?.lhid || '').trim().toLowerCase();
          if (key && !dbByLhid.has(key)) dbByLhid.set(key, row);
        }
        return dbByLhid;
      };

      for (const tabName of orderedTabs) {
        const incoming = optool[tabName];
        if (!OPTOOL_SHEET_SCHEMAS[tabName]) continue;

        if (tabName === 'Leasehold') {
          const arr = Array.isArray(incoming) ? incoming : [];
          if (!Array.isArray(this.state.leasehold)) this.state.leasehold = [];
          if (options.replaceMilestoneTabs) {
            // Safeguard: do not wipe existing populated leasehold records if incoming array is empty
            if (arr.length === 0 && this.state.leasehold.length > 0) {
              continue;
            }
            const cleanedIncoming = arr.map((rawRow) => normalizeLeaseholdRow(rawRow));
            let merged = [];
            if (options.scopeCode) {
              const keepRows = this.state.leasehold.filter(
                (r) => this.getLeaseholdRowProvinceCode(r) !== options.scopeCode
              );
              merged = [...cleanedIncoming, ...keepRows];
            } else {
              merged = cleanedIncoming;
            }
            const seenLh = new Map();
            const dedupedLh = [];
            for (const r of merged) {
              const k = getOptoolRowKey('Leasehold', r);
              if (k && seenLh.has(k)) {
                const idx = seenLh.get(k);
                dedupedLh[idx] = { ...dedupedLh[idx], ...r };
              } else {
                if (k) seenLh.set(k, dedupedLh.length);
                dedupedLh.push(r);
              }
            }
            this.state.leasehold = dedupedLh;
            this.state.optool.Leasehold = this.state.leasehold;
            importedCount += cleanedIncoming.length;
          } else {
            const keyMap = new Map();
            this.state.leasehold.forEach((r, idx) => {
              const k = getOptoolRowKey('Leasehold', r);
              if (k) keyMap.set(k, idx);
            });
            for (const raw of arr) {
              const clean = normalizeLeaseholdRow(raw);
              const k = getOptoolRowKey('Leasehold', clean);
              if (k && keyMap.has(k)) {
                const idx = keyMap.get(k);
                if (idx >= 0) this.state.leasehold[idx] = { ...this.state.leasehold[idx], ...clean };
              } else {
                if (k) keyMap.set(k, this.state.leasehold.length);
                this.state.leasehold.push(clean);
              }
              importedCount++;
            }
            this.state.optool.Leasehold = this.state.leasehold;
          }
          continue;
        }

        if (options.replaceMilestoneTabs && tabName !== 'Database') {
          const arr = Array.isArray(incoming) ? incoming : [];
          // Safeguard: do not wipe existing populated tab records if incoming array is empty
          if (arr.length === 0 && (this.state.optool[tabName] || []).length > 0) {
            continue;
          }
          const cleanedIncoming = arr.map((rawRow) => {
            const lhidKey = String(rawRow?.lhid || '').trim().toLowerCase();
            const linkedDb =
              tabName === 'RegistrationDistribution' || tabName === 'Installation'
                ? getDbByLhid().get(lhidKey) || null
                : null;
            return this.normalizeOptoolRow(tabName, rawRow, linkedDb);
          });

          let mergedList = [];
          if (options.scopeCode) {
            const keepRows = (this.state.optool[tabName] || []).filter(
              (r) => this.getOptoolRowProvinceCode(tabName, r) !== options.scopeCode
            );
            mergedList = [...cleanedIncoming, ...keepRows];
          } else {
            mergedList = cleanedIncoming;
          }

          const seenKeys = new Map();
          const finalRows = [];
          for (const row of mergedList) {
            if (!row || typeof row !== 'object') continue;
            const key = getOptoolRowKey(tabName, row);
            if (!key) {
              finalRows.push(row);
              continue;
            }
            if (seenKeys.has(key)) {
              const existingIdx = seenKeys.get(key);
              finalRows[existingIdx] = { ...finalRows[existingIdx], ...row };
            } else {
              seenKeys.set(key, finalRows.length);
              finalRows.push(row);
            }
          }
          this.state.optool[tabName] = finalRows;
          importedCount += cleanedIncoming.length;
          continue;
        }

        if (!Array.isArray(incoming) || incoming.length === 0) {
          continue;
        }
        const targetRows = this.state.optool[tabName];
        const keyMap = new Map();
        targetRows.forEach((r, idx) => {
          const k = getOptoolRowKey(tabName, r);
          if (k) keyMap.set(k, idx);
        });
        const newRows = [];
        for (const rawRow of incoming) {
          const lhidKey = String(rawRow?.lhid || '').trim().toLowerCase();
          const linkedDb =
            tabName === 'RegistrationDistribution' || tabName === 'Installation'
              ? (lhidKey ? getDbByLhid().get(lhidKey) || null : null)
              : null;
          const cleanRow = this.normalizeOptoolRow(tabName, rawRow, linkedDb);
          const rKey = getOptoolRowKey(tabName, cleanRow);
          if (rKey && keyMap.has(rKey)) {
            const existingIdx = keyMap.get(rKey);
            if (existingIdx >= 0) {
              targetRows[existingIdx] = { ...targetRows[existingIdx], ...cleanRow };
            }
          } else {
            if (rKey) keyMap.set(rKey, targetRows.length + newRows.length);
            newRows.push(cleanRow);
          }
          if (tabName === 'Database' && dbByLhid && cleanRow.lhid) {
            dbByLhid.set(cleanRow.lhid.trim().toLowerCase(), cleanRow);
            dbByLhid.set(formatLhidDisplay(cleanRow.lhid).toLowerCase(), cleanRow);
          }
          importedCount++;
        }
        if (newRows.length > 0) {
          this.state.optool[tabName] = [...targetRows, ...newRows];
        }
      }
    }

    if (nepProvinceList && typeof nepProvinceList === 'object') {
      const actualProvinceList = nepProvinceList.nepProvinceList || nepProvinceList;
      if (nepProvinceList.nepMilestoneList && !nepMilestoneList) {
        nepMilestoneList = nepProvinceList.nepMilestoneList;
      }
      const incomingNep = normalizeNepProvinceList(actualProvinceList);
      const mergedNep = normalizeNepProvinceList(this.state.nepProvinceList);
      for (const code of Object.keys(mergedNep)) {
        if (Object.prototype.hasOwnProperty.call(actualProvinceList, code)) {
          mergedNep[code] = incomingNep[code];
          importedCount++;
        }
      }
      this.state.nepProvinceList = normalizeNepProvinceList(mergedNep);
      if (!this.state.nepProvinceListByYear) this.state.nepProvinceListByYear = {};
      for (const [code, item] of Object.entries(this.state.nepProvinceList)) {
        const yr = Math.round(Number(item.year) || 2026);
        if (!this.state.nepProvinceListByYear[yr]) this.state.nepProvinceListByYear[yr] = {};
        this.state.nepProvinceListByYear[yr][code] = item;
      }
    }

    if (nepMilestoneList && typeof nepMilestoneList === 'object') {
      if (!this.state.nepMilestoneList) this.state.nepMilestoneList = {};
      if (!this.state.nepMilestoneListByYear) this.state.nepMilestoneListByYear = {};
      for (const [msKey, provMap] of Object.entries(nepMilestoneList)) {
        if (provMap && typeof provMap === 'object') {
          const norm = normalizeNepProvinceList(provMap);
          this.state.nepMilestoneList[msKey] = norm;
          for (const [code, item] of Object.entries(norm)) {
            const yr = Math.round(Number(item.year) || 2027);
            if (!this.state.nepMilestoneListByYear[yr]) this.state.nepMilestoneListByYear[yr] = {};
            if (!this.state.nepMilestoneListByYear[yr][msKey]) this.state.nepMilestoneListByYear[yr][msKey] = {};
            this.state.nepMilestoneListByYear[yr][msKey][code] = item;
          }
          const totalLhs = Object.values(norm).reduce((s, r) => s + (Number(r.lhs) || 0), 0);
          const totalArea = Number(Object.values(norm).reduce((s, r) => s + (Number(r.area) || 0), 0).toFixed(4));
          const totalSem1Lhs = Object.values(norm).reduce((s, r) => s + (Number(r.sem1Lhs) || 0), 0);
          const totalSem2Lhs = Object.values(norm).reduce((s, r) => s + (Number(r.sem2Lhs) || 0), 0);
          const totalSem1Area = Number(Object.values(norm).reduce((s, r) => s + (Number(r.sem1Area) || 0), 0).toFixed(4));
          const totalSem2Area = Number(Object.values(norm).reduce((s, r) => s + (Number(r.sem2Area) || 0), 0).toFixed(4));

          const s1Count = totalSem1Lhs > 0 ? totalSem1Lhs : (totalLhs > 0 ? Math.round(totalLhs / 2) : 0);
          const s2Count = totalSem2Lhs > 0 ? totalSem2Lhs : Math.max(0, totalLhs - s1Count);
          const s1Area = totalSem1Area > 0 ? totalSem1Area : Number((totalArea / 2).toFixed(4));
          const s2Area = totalSem2Area > 0 ? totalSem2Area : Math.max(0, Number((totalArea - s1Area).toFixed(4)));

          if (!this.state.nepTargets) this.state.nepTargets = {};
          this.state.nepTargets[msKey] = {
            targetCount: totalLhs,
            targetAreaHas: totalArea,
            sem1TargetCount: s1Count,
            sem2TargetCount: s2Count,
            sem1TargetAreaHas: s1Area,
            sem2TargetAreaHas: s2Area
          };
          importedCount++;
        }
      }
    }

    if (dataset.nepMilestoneListByYear && typeof dataset.nepMilestoneListByYear === 'object') {
      if (!this.state.nepMilestoneListByYear) this.state.nepMilestoneListByYear = {};
      for (const [yr, msMap] of Object.entries(dataset.nepMilestoneListByYear)) {
        if (!this.state.nepMilestoneListByYear[yr]) this.state.nepMilestoneListByYear[yr] = {};
        for (const [msKey, pMap] of Object.entries(msMap || {})) {
          this.state.nepMilestoneListByYear[yr][msKey] = {
            ...(this.state.nepMilestoneListByYear[yr][msKey] || {}),
            ...pMap
          };
        }
      }
    }

    if (dataset.nepProvinceListByYear && typeof dataset.nepProvinceListByYear === 'object') {
      if (!this.state.nepProvinceListByYear) this.state.nepProvinceListByYear = {};
      for (const [yr, pMap] of Object.entries(dataset.nepProvinceListByYear)) {
        this.state.nepProvinceListByYear[yr] = {
          ...(this.state.nepProvinceListByYear[yr] || {}),
          ...pMap
        };
      }
    }

    if (!skipSave) this.save();
    return importedCount;
  }

  deleteOptoolRow(tabName, index) {
    if (!OPTOOL_SHEET_SCHEMAS[tabName]) return false;
    const rows = this.state.optool[tabName];
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return false;
    rows.splice(index, 1);
    this.save();
    return true;
  }

  /**
   * Ensure a Database parcel with a valid Milestone Target has a linked row in that target tab.
   */
  syncDatabaseRowToTargetTab(dbRow) {
    const rawTarget = String(dbRow?.milestoneTarget || '').trim();
    const targetTab = resolveTargetTab(rawTarget);
    const fieldMap = DATABASE_TO_TARGET_MAP[targetTab] || DATABASE_TO_TARGET_MAP[rawTarget];
    if (!fieldMap) return false;

    const lhidKey = String(dbRow.lhid || '').trim().toLowerCase();
    const targetRows = this.state.optool[targetTab] || [];
    const existingRow = lhidKey
      ? targetRows.find((r) => String(r.lhid || '').trim().toLowerCase() === lhidKey)
      : null;

    const targetYearVal = formatYearDisplay(dbRow.year || dbRow.targetYear || '');
    const targetVal = resolveTargetFromDatabaseRow(dbRow);

    if (existingRow) {
      let updated = false;
      if (targetYearVal && existingRow.targetYear !== targetYearVal) {
        existingRow.targetYear = targetYearVal;
        updated = true;
      }
      if (targetVal && existingRow.target !== targetVal) {
        existingRow.target = targetVal;
        updated = true;
      }
      if (updated) this.save();
      return false;
    }

    const mappedRow = {};
    for (const [destKey, src] of Object.entries(fieldMap)) {
      mappedRow[destKey] = typeof src === 'function' ? src(dbRow) : dbRow[src] ?? '';
    }
    this.upsertOptoolRow(targetTab, mappedRow);
    return true;
  }

  /**
   * Assign a Database row's Milestone Target and route a linked entry to that stage tab.
   */
  setDatabaseMilestoneTarget(index, milestoneTarget) {
    const rows = this.state.optool.Database || [];
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
      throw new Error('Database row not found');
    }
    const normalized = String(milestoneTarget ?? '').trim();
    const validTargets = [...MILESTONE_TARGET_TABS, 'MOV', 'Land Valuation', 'Land valuation'];
    if (normalized !== '' && !validTargets.includes(normalized)) {
      throw new Error(`Invalid Milestone Target: ${normalized}`);
    }

    const row = rows[index];
    row.milestoneTarget = normalized;
    const targetTab = resolveTargetTab(normalized);
    const createdInTab = normalized ? this.syncDatabaseRowToTargetTab(row) : false;
    if (!createdInTab) {
      this.save();
    }
    return { row, targetTab, createdInTab };
  }

  getLandholding360(lhid) {
    const rawTarget = String(lhid || '').trim();
    const cleanTarget = formatLhidDisplay(lhid);
    const tabs = {};
    for (const tabName of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
      tabs[tabName] = this.state.optool[tabName].filter((row) => {
        const rowLhid = String(row.lhid || '').trim();
        const rowClean = formatLhidDisplay(row.lhid);
        return (
          (rawTarget && rowLhid.toLowerCase() === rawTarget.toLowerCase()) ||
          (cleanTarget && rowClean.toLowerCase() === cleanTarget.toLowerCase()) ||
          (cleanTarget && rowLhid.toLowerCase() === cleanTarget.toLowerCase()) ||
          (rawTarget && rowClean.toLowerCase() === rawTarget.toLowerCase())
        );
      });
    }
    const milestones = this.state.milestoneData.filter((m) => {
      const mLhid = String(m.LHID || '').trim();
      const mClean = formatLhidDisplay(m.LHID);
      return (
        (rawTarget && mLhid.toLowerCase() === rawTarget.toLowerCase()) ||
        (cleanTarget && mClean.toLowerCase() === cleanTarget.toLowerCase()) ||
        (cleanTarget && mLhid.toLowerCase() === cleanTarget.toLowerCase()) ||
        (rawTarget && mClean.toLowerCase() === rawTarget.toLowerCase())
      );
    });
    const auditLogs = this.getAuditLogs({ lhid: cleanTarget || rawTarget, limit: 50 }).logs;
    return { lhid: cleanTarget || rawTarget, tabs, milestones, auditLogs };
  }

  /**
   * Record a user revision audit log entry for changes made to Landholdings across OPTool, Milestones, or Leasehold.
   * Tracks previous update vs current update per user and LHID.
   */
  recordAuditLog({ user = null, action = 'update', tabName = '', lhid = '', rowIndex = null, changes = [], summary = '' } = {}) {
    if (!Array.isArray(this.state.auditLogs)) {
      this.state.auditLogs = [];
    }

    const cleanLhid = formatLhidDisplay(lhid) || String(lhid || '').trim();
    const userMeta = {
      id: user?.id || 'usr-system',
      name: user?.name || user?.fullName || 'Staff / Anonymous',
      email: user?.email || 'user@dar8.gov.ph',
      role: user?.role || 'staff',
      province: user?.province || user?.provinceName || 'Region VIII Hub'
    };

    const cleanChanges = (Array.isArray(changes) ? changes : [])
      .map((ch) => ({
        field: String(ch.field || ch.key || ''),
        label: String(ch.label || ch.field || ch.key || ''),
        oldValue: ch.oldValue !== undefined && ch.oldValue !== null ? String(ch.oldValue) : '',
        newValue: ch.newValue !== undefined && ch.newValue !== null ? String(ch.newValue) : ''
      }))
      .filter((ch) => ch.field && (ch.oldValue !== ch.newValue || action === 'create' || action === 'delete'));

    // Generate descriptive summary if none provided
    let autoSummary = summary;
    if (!autoSummary && cleanChanges.length > 0) {
      const fieldSummaries = cleanChanges.slice(0, 3).map((ch) => {
        if (action === 'create') return `${ch.label}: "${ch.newValue}"`;
        if (action === 'delete') return `${ch.label} was "${ch.oldValue}"`;
        return `${ch.label} ("${ch.oldValue || '(empty)'}" → "${ch.newValue || '(empty)'}")`;
      });
      const extraCount = cleanChanges.length - 3;
      autoSummary = `${action.toUpperCase()}: ${fieldSummaries.join(', ')}${extraCount > 0 ? ` (+${extraCount} more)` : ''}`;
    }

    const logEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      user: userMeta,
      action: action.toLowerCase(), // 'create', 'update', 'delete'
      tabName: String(tabName || '').trim(),
      lhid: cleanLhid,
      rowIndex: typeof rowIndex === 'number' ? rowIndex : null,
      changes: cleanChanges,
      summary: autoSummary || `${action.toUpperCase()} on ${tabName} for LHID ${cleanLhid}`
    };

    this.state.auditLogs.unshift(logEntry);
    // Keep max 2,500 logs to maintain fast performance and JSON storage limits
    if (this.state.auditLogs.length > 2500) {
      this.state.auditLogs = this.state.auditLogs.slice(0, 2500);
    }
    this.save();
    return logEntry;
  }

  /**
   * Retrieve filtered audit logs by LHID, user email, tab, or action with pagination.
   */
  getAuditLogs({ lhid = '', userEmail = '', tabName = '', action = '', limit = 100, offset = 0 } = {}) {
    if (!Array.isArray(this.state.auditLogs)) return { logs: [], total: 0 };

    const normLhid = lhid ? formatLhidDisplay(lhid).toLowerCase() : '';
    const normRawLhid = lhid ? String(lhid).trim().toLowerCase() : '';
    const normUser = userEmail ? String(userEmail).trim().toLowerCase() : '';
    const normTab = tabName ? String(tabName).trim().toLowerCase() : '';
    const normAction = action ? String(action).trim().toLowerCase() : '';

    const filtered = this.state.auditLogs.filter((entry) => {
      if (normLhid) {
        const eLhid = formatLhidDisplay(entry.lhid).toLowerCase();
        const eRawLhid = String(entry.lhid || '').trim().toLowerCase();
        if (eLhid !== normLhid && eRawLhid !== normRawLhid && !eLhid.includes(normLhid)) return false;
      }
      if (normUser) {
        const email = String(entry.user?.email || '').toLowerCase();
        const name = String(entry.user?.name || '').toLowerCase();
        if (!email.includes(normUser) && !name.includes(normUser)) return false;
      }
      if (normTab && normTab !== 'all') {
        const eTab = String(entry.tabName || '').toLowerCase();
        if (eTab !== normTab && !eTab.includes(normTab)) return false;
      }
      if (normAction && normAction !== 'all') {
        if (String(entry.action || '').toLowerCase() !== normAction) return false;
      }
      return true;
    });

    const parsedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const parsedOffset = Math.max(0, Number(offset) || 0);

    return {
      total: filtered.length,
      logs: filtered.slice(parsedOffset, parsedOffset + parsedLimit),
      limit: parsedLimit,
      offset: parsedOffset
    };
  }

  /** Resolve province code for a milestone record (returns null if unknown). */
  getMilestoneProvinceCode(row) {
    if (!row) return null;
    if (PROVINCE_CODES.includes(row.Province_Code)) return row.Province_Code;
    return (
      inferProvinceCodeFromMunicipality(row.Municipality) ||
      inferProvinceCodeFromText(row.Record_ID) ||
      null
    );
  }

  /** Resolve province code for a Leasehold record. */
  getLeaseholdRowProvinceCode(row) {
    if (!row) return null;
    const provs = String(row.provs || row.PROVS || row.province || '').trim();
    if (PROVINCE_CODES.includes(provs.toUpperCase())) return provs.toUpperCase();
    const inferred = inferProvinceCodeFromText(provs);
    if (inferred) return inferred;
    const mun = String(row.mun || row.MUN || row.municipality || '').trim();
    if (mun) {
      const munInferred = inferProvinceCodeFromMunicipality(mun);
      if (munInferred) return munInferred;
    }
    return null;
  }

  /** Retrieve Leasehold records filtered by province scope (or all if Regional Admin). */
  getScopedLeaseholdRows(scopeCode) {
    const rows = Array.isArray(this.state.leasehold) ? this.state.leasehold : [];
    if (!scopeCode) return rows;
    return rows.filter((r) => this.getLeaseholdRowProvinceCode(r) === scopeCode);
  }

  /** Upsert a Leasehold record. Regular users and admins can encode (create/edit). Scoped to user's province. */
  upsertLeaseholdRow(rawRow, index = null, actingUser = null, scopeCode = null) {
    if (!Array.isArray(this.state.leasehold)) {
      this.state.leasehold = [];
    }
    const norm = normalizeLeaseholdRow(rawRow);
    const rowProvCode = this.getLeaseholdRowProvinceCode(norm);

    if (scopeCode) {
      if (rowProvCode && rowProvCode !== scopeCode) {
        const err = new Error(`Access restricted to ${scopeCode} records only.`);
        err.statusCode = 403;
        throw err;
      }
      if (!rowProvCode) {
        const registryEntry = REGIONAL_REGISTRY.find((r) => r.code === scopeCode);
        norm.provs = registryEntry ? registryEntry.provinceName : scopeCode;
      }
    }

    let targetIdx = -1;
    if (Number.isInteger(index) && index >= 0 && index < this.state.leasehold.length) {
      targetIdx = index;
    } else if (norm.id) {
      targetIdx = this.state.leasehold.findIndex((r) => r.id === norm.id);
    }

    const nowIso = new Date().toISOString();
    const actorName = actingUser?.name || actingUser?.email || 'User';

    if (targetIdx >= 0) {
      const existing = this.state.leasehold[targetIdx];
      if (scopeCode && this.getLeaseholdRowProvinceCode(existing) !== scopeCode) {
        const err = new Error(`Access restricted to ${scopeCode} records only.`);
        err.statusCode = 403;
        throw err;
      }
      const updated = {
        ...existing,
        ...norm,
        id: existing.id || norm.id,
        createdAt: existing.createdAt || norm.createdAt || nowIso,
        encodedBy: existing.encodedBy || norm.encodedBy || actorName,
        updatedAt: nowIso,
        lastModifiedBy: actorName
      };
      this.state.leasehold[targetIdx] = updated;
      this.state.optool.Leasehold = this.state.leasehold;
      this.save();
      return updated;
    } else {
      const created = {
        ...norm,
        createdAt: nowIso,
        updatedAt: nowIso,
        encodedBy: actorName
      };
      this.state.leasehold.push(created);
      this.state.optool.Leasehold = this.state.leasehold;
      this.save();
      return created;
    }
  }

  /** Delete a Leasehold record. Restricted to Administrator role only. */
  deleteLeaseholdRow(idOrIndex, actingUser = null, scopeCode = null) {
    if (actingUser && actingUser.role !== 'admin') {
      const err = new Error('Administrator access required to delete records. Users are permitted to encode only.');
      err.statusCode = 403;
      throw err;
    }
    if (!Array.isArray(this.state.leasehold)) {
      this.state.leasehold = [];
      this.state.optool.Leasehold = this.state.leasehold;
      return false;
    }
    let targetIdx = -1;
    if (Number.isInteger(idOrIndex) && idOrIndex >= 0 && idOrIndex < this.state.leasehold.length) {
      targetIdx = idOrIndex;
    } else {
      const strId = String(idOrIndex).trim();
      targetIdx = this.state.leasehold.findIndex((r) => r.id === strId);
      if (targetIdx === -1 && /^\d+$/.test(strId)) {
        const parsed = parseInt(strId, 10);
        if (parsed >= 0 && parsed < this.state.leasehold.length) {
          targetIdx = parsed;
        }
      }
    }
    if (targetIdx === -1) {
      const err = new Error('Leasehold record not found.');
      err.statusCode = 404;
      throw err;
    }
    const [removed] = this.state.leasehold.splice(targetIdx, 1);
    this.state.optool.Leasehold = this.state.leasehold;
    this.save();
    return removed || true;
  }

  /** Map normalized LHID -> province code from the master OPTool Database tab. */
  buildDbLhidProvinceMap() {
    const map = new Map();
    for (const r of this.state.optool?.Database || []) {
      const rawKey = String(r.lhid || '').trim().toLowerCase();
      const cleanKey = formatLhidDisplay(r.lhid).toLowerCase();
      if (!rawKey && !cleanKey) continue;
      const code =
        inferProvinceCodeFromText(r.province) ||
        inferProvinceCodeFromMunicipality(r.municipality) ||
        inferProvinceCodeFromText(r.lhid) ||
        null;
      if (code) {
        if (cleanKey && !map.has(cleanKey)) map.set(cleanKey, code);
        if (rawKey && !map.has(rawKey)) map.set(rawKey, code);
      }
    }
    return map;
  }

  /** Resolve province code for any OPTool tab row via provinceCode, province, municipality, or Database LHID link. */
  getOptoolRowProvinceCode(tabName, row, dbLhidMap = null) {
    if (!row) return null;
    if (tabName === 'Leasehold') {
      return this.getLeaseholdRowProvinceCode(row);
    }
    const directCode = String(row.provinceCode || row.Province_Code || '').trim().toUpperCase();
    if (PROVINCE_CODES.includes(directCode)) return directCode;
    if (row.province) {
      const fromProv = inferProvinceCodeFromText(row.province);
      if (fromProv) return fromProv;
    }
    if (row.municipality) {
      const fromMun = inferProvinceCodeFromMunicipality(row.municipality);
      if (fromMun) return fromMun;
    }
    const lhidKey = String(row.lhid || '').trim().toLowerCase();
    if (lhidKey && tabName !== 'Database') {
      const lookup = dbLhidMap || this.buildDbLhidProvinceMap();
      if (lookup.has(lhidKey)) return lookup.get(lhidKey);
    }
    return inferProvinceCodeFromText(row.lhid) || null;
  }

  /**
   * Extract all registered records from Google Sheets RegistrationDistribution tab
   * based on Column M (Date Registered non-empty) and Column J (Area HAS sum).
   */
  getRegisteredOptoolRecords(provinceFilter = 'ALL') {
    const regRows = this.state.optool?.RegistrationDistribution || this.state.optool?.['Registration/Distribution'] || [];
    const dbLhidMap = this.buildDbLhidProvinceMap();
    const result = [];

    for (const r of regRows) {
      const dateReg = String(
        r.dateRegistered ||
        r['DATE REGISTERED'] ||
        r['Date Registered'] ||
        r.date_registered ||
        ''
      ).trim();

      // Must have Date Registered in Column M (non-empty, not '-', not 'N/A')
      if (!dateReg || dateReg === '-' || dateReg === 'N/A' || dateReg.toLowerCase() === 'null') {
        continue;
      }

      const rawArea =
        r.areaHas ||
        r['AREA\n(HAs)'] ||
        r['AREA (HAs)'] ||
        r['AREA(HAS)'] ||
        r['Area (HAs)'] ||
        r['AREA'] ||
        r.area ||
        r.totalArea ||
        r.carpable ||
        0;

      const areaNum = typeof rawArea === 'number'
        ? rawArea
        : (parseFloat(String(rawArea).replace(/,/g, '')) || 0);

      const provCode =
        this.getOptoolRowProvinceCode('RegistrationDistribution', r, dbLhidMap) ||
        (r.lhid ? dbLhidMap.get(String(r.lhid).trim().toLowerCase()) : null) ||
        'LEY';

      if (provinceFilter && provinceFilter !== 'ALL' && provCode !== provinceFilter) {
        continue;
      }

      const monthKey = /^\d{4}-\d{2}/.test(dateReg) ? dateReg.slice(0, 7) : 'Unknown';

      result.push({
        Record_ID: String(r.lhid || r.rodTitleNo || r.epOrCloaSerialNo || `REG-${result.length + 1}`).trim(),
        Province_Code: provCode,
        Municipality: String(r.municipality || '').trim(),
        Land_Allocation_ID: String(r.epOrCloaSerialNo || r.rodTitleNo || '').trim(),
        eTitle_No: String(r.rodTitleNo || r.epOrCloaSerialNo || '').trim(),
        Area_HAS: areaNum.toFixed(4),
        Area_Num: areaNum,
        Milestone_Stage: 'eTitle Registered',
        Milestone_Date: dateReg,
        Month_Key: monthKey,
        Batch_Category: String(r.targetYear || r.target || 'ADMIN BATCH 1').trim(),
        LHID: String(r.lhid || '').trim(),
        dateRegistered: dateReg,
        areaHas: areaNum
      });
    }

    return result;
  }

  /** Return per-province registered summary (Count of rows with Date Reg in Col M, sum of Col J Area HAS). */
  getRegisteredSummaryByProvince() {
    const regRecords = this.getRegisteredOptoolRecords('ALL');
    const summary = {};
    for (const code of PROVINCE_CODES) {
      const node = REGIONAL_REGISTRY.find((n) => n.code === code);
      const provRows = regRecords.filter((r) => r.Province_Code === code);
      const sumArea = provRows.reduce((acc, r) => acc + r.Area_Num, 0);
      summary[code] = {
        code,
        provinceName: node ? node.provinceName : code,
        registeredCount: provRows.length,
        registeredAreaHas: Number(sumArea.toFixed(4))
      };
    }
    const totalCount = regRecords.length;
    const totalArea = regRecords.reduce((acc, r) => acc + r.Area_Num, 0);
    return {
      byProvince: summary,
      totalCount,
      totalArea: Number(totalArea.toFixed(4))
    };
  }

  /** Return rows for a single OPTool tab filtered to `scopeCode` when provided. */
  getScopedOptoolTabRows(tabName, scopeCode, dbLhidMap = null) {
    if (tabName === 'Leasehold') {
      return this.getScopedLeaseholdRows(scopeCode);
    }
    const rows = this.state.optool?.[tabName] || [];
    if (!scopeCode) return rows;
    const lookup = dbLhidMap || this.buildDbLhidProvinceMap();
    return rows.filter((row) => this.getOptoolRowProvinceCode(tabName, row, lookup) === scopeCode);
  }

  /**
   * Translate a client-side scoped array index back to the true global index
   * in `this.state.optool[tabName]`. Returns -1 if out of bounds.
   */
  getOptoolGlobalIndex(tabName, scopedIndex, scopeCode) {
    const rows = this.state.optool?.[tabName] || [];
    if (!Number.isInteger(scopedIndex) || scopedIndex < 0) return -1;
    if (!scopeCode) return scopedIndex < rows.length ? scopedIndex : -1;

    const lookup = this.buildDbLhidProvinceMap();
    let seen = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (this.getOptoolRowProvinceCode(tabName, rows[i], lookup) === scopeCode) {
        if (seen === scopedIndex) return i;
        seen += 1;
      }
    }
    return -1;
  }

  /** Return a shallow state view restricted to `scopeCode` (or full state when null). */
  getScopedState(scopeCode) {
    if (!scopeCode) return this.state;
    const dbLhidMap = this.buildDbLhidProvinceMap();
    const scopedOptool = {};
    for (const tabName of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
      scopedOptool[tabName] = this.getScopedOptoolTabRows(tabName, scopeCode, dbLhidMap);
    }
    scopedOptool['Land Valuation'] = scopedOptool.MOV;
    const scopedBaselines = {};
    if (this.state.baselines?.[scopeCode]) {
      scopedBaselines[scopeCode] = this.state.baselines[scopeCode];
    }
    const scopedNepProvinceList = {};
    if (this.state.nepProvinceList?.[scopeCode]) {
      scopedNepProvinceList[scopeCode] = this.state.nepProvinceList[scopeCode];
    }
    const scopedNepMilestoneList = {};
    if (scopeCode) {
      for (const [mKey, mMap] of Object.entries(this.state.nepMilestoneList || {})) {
        if (mMap?.[scopeCode]) {
          scopedNepMilestoneList[mKey] = { [scopeCode]: mMap[scopeCode] };
        }
      }
    }
    const scopedNodeStatuses = {};
    if (this.state.nodeStatuses?.[scopeCode]) {
      scopedNodeStatuses[scopeCode] = this.state.nodeStatuses[scopeCode];
    }
    return {
      ...this.state,
      baselines: scopedBaselines,
      nepTargets: this.state.nepTargets,
      nepTargetsByYear: this.state.nepTargetsByYear || {},
      nepProvinceList: scopedNepProvinceList,
      nepMilestoneList: scopeCode ? scopedNepMilestoneList : (this.state.nepMilestoneList || {}),
      nepMilestoneListByYear: this.state.nepMilestoneListByYear || {},
      nepProvinceListByYear: this.state.nepProvinceListByYear || {},
      nodeStatuses: scopedNodeStatuses,
      milestoneData: (this.state.milestoneData || []).filter(
        (m) => this.getMilestoneProvinceCode(m) === scopeCode
      ),
      optool: scopedOptool,
      leasehold: this.getScopedLeaseholdRows(scopeCode)
    };
  }

  /** Restrict a Landholding 360 dossier to records belonging to `scopeCode`. */
  filterLandholding360ByScope(dossier, scopeCode) {
    if (!scopeCode || !dossier) return dossier;
    const dbLhidMap = this.buildDbLhidProvinceMap();
    const tabs = {};
    for (const tabName of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
      tabs[tabName] = (dossier.tabs?.[tabName] || []).filter(
        (row) => this.getOptoolRowProvinceCode(tabName, row, dbLhidMap) === scopeCode
      );
    }
    const milestones = (dossier.milestones || []).filter(
      (m) => this.getMilestoneProvinceCode(m) === scopeCode
    );
    return { ...dossier, tabs, milestones };
  }

  updateBaselines(newBaselines) {
    for (const code of PROVINCE_CODES) {
      if (newBaselines[code]) {
        this.state.baselines[code] = {
          targetETitles: Math.max(0, Number(newBaselines[code].targetETitles) || 0),
          targetAreaHas: Math.max(0, Number(newBaselines[code].targetAreaHas) || 0)
        };
      }
    }
    this.save();
    return this.state.baselines;
  }

  /** Persist per-province, per-milestone NEP Target updates. */
  updateNepTargets(newNepTargets, targetYear = null) {
    const yr = targetYear ? Math.round(Number(targetYear)) : null;
    const existing = yr && this.state.nepTargetsByYear?.[yr]
      ? this.state.nepTargetsByYear[yr]
      : (this.state.nepTargets || {});
    const merged = { ...existing, ...(newNepTargets || {}) };
    this.state.nepTargets = normalizeNepTargets(merged);
    if (yr) {
      if (!this.state.nepTargetsByYear) this.state.nepTargetsByYear = {};
      this.state.nepTargetsByYear[yr] = normalizeNepTargets(merged);
    }
    this.save();
    return this.state.nepTargets;
  }

  /** Persist Regional Hub NEP Sheet per-province totals (LHS, AREA, ARBs, Year) for overall or a selected milestone. */
  updateNepProvinceList(raw = {}, milestoneKey = 'overall', targetYear = null) {
    const isOverall = !milestoneKey || milestoneKey === 'overall';
    let rawYear = null;
    if (raw && typeof raw === 'object') {
      for (const item of Object.values(raw)) {
        const y = Math.round(Number(item?.year) || 0);
        if (y >= 2000 && y <= 2099) {
          rawYear = y;
          break;
        }
      }
    }
    const resolvedYear = targetYear
      ? Math.round(Number(targetYear))
      : (rawYear || new Date().getFullYear());

    const norm = normalizeNepProvinceList(raw, resolvedYear);

    if (!this.state.nepMilestoneListByYear) this.state.nepMilestoneListByYear = {};
    if (!this.state.nepProvinceListByYear) this.state.nepProvinceListByYear = {};
    if (!this.state.nepMilestoneListByYear[resolvedYear]) this.state.nepMilestoneListByYear[resolvedYear] = {};
    if (!this.state.nepProvinceListByYear[resolvedYear]) this.state.nepProvinceListByYear[resolvedYear] = {};

    for (const code of Object.keys(norm)) {
      if (norm[code]) norm[code].year = resolvedYear;
    }

    if (isOverall) {
      this.state.nepProvinceList = norm;
      this.state.nepProvinceListByYear[resolvedYear] = norm;
    } else {
      if (!this.state.nepMilestoneList) this.state.nepMilestoneList = {};
      this.state.nepMilestoneList[milestoneKey] = norm;
      this.state.nepMilestoneListByYear[resolvedYear][milestoneKey] = norm;

      const totalLhs = Object.values(norm).reduce((s, r) => s + (Number(r.lhs) || 0), 0);
      const totalArea = Number(Object.values(norm).reduce((s, r) => s + (Number(r.area) || 0), 0).toFixed(4));
      const totalSem1Lhs = Object.values(norm).reduce((s, r) => s + (Number(r.sem1Lhs) || 0), 0);
      const totalSem2Lhs = Object.values(norm).reduce((s, r) => s + (Number(r.sem2Lhs) || 0), 0);
      const totalSem1Area = Number(Object.values(norm).reduce((s, r) => s + (Number(r.sem1Area) || 0), 0).toFixed(4));
      const totalSem2Area = Number(Object.values(norm).reduce((s, r) => s + (Number(r.sem2Area) || 0), 0).toFixed(4));

      const s1Count = totalSem1Lhs > 0 ? totalSem1Lhs : (totalLhs > 0 ? Math.round(totalLhs / 2) : 0);
      const s2Count = totalSem2Lhs > 0 ? totalSem2Lhs : Math.max(0, totalLhs - s1Count);
      const s1Area = totalSem1Area > 0 ? totalSem1Area : Number((totalArea / 2).toFixed(4));
      const s2Area = totalSem2Area > 0 ? totalSem2Area : Math.max(0, Number((totalArea - s1Area).toFixed(4)));

      if (!this.state.nepTargets) this.state.nepTargets = {};
      this.state.nepTargets[milestoneKey] = {
        targetCount: totalLhs,
        targetAreaHas: totalArea,
        sem1TargetCount: s1Count,
        sem2TargetCount: s2Count,
        sem1TargetAreaHas: s1Area,
        sem2TargetAreaHas: s2Area
      };

      if (!this.state.nepTargetsByYear) this.state.nepTargetsByYear = {};
      if (!this.state.nepTargetsByYear[resolvedYear]) this.state.nepTargetsByYear[resolvedYear] = {};
      this.state.nepTargetsByYear[resolvedYear][milestoneKey] = {
        targetCount: totalLhs,
        targetAreaHas: totalArea,
        sem1TargetCount: s1Count,
        sem2TargetCount: s2Count,
        sem1TargetAreaHas: s1Area,
        sem2TargetAreaHas: s2Area
      };
    }
    this.save();
    return this.state.nepProvinceList;
  }

  /**
   * CRUD: Create or Add a new NEP target for a specific year, milestone, and province.
   */
  createNepTarget({ year, milestone = 'overall', provinceCode, lhs = 0, area = 0, arbs = 0, sem1Lhs, sem2Lhs, sem1Area, sem2Area, sem1Arbs, sem2Arbs }) {
    const yr = Math.round(Number(year) || new Date().getFullYear());
    const msKey = String(milestone || 'overall').trim().toLowerCase();
    const pCode = String(provinceCode || '').trim().toUpperCase();
    if (!PROVINCE_CODES.includes(pCode)) {
      throw new Error(`Invalid province code: "${pCode}". Allowed: ${PROVINCE_CODES.join(', ')}`);
    }

    const nLhs = Math.max(0, Math.round(Number(lhs) || 0));
    const nArea = Math.max(0, Number((Number(area) || 0).toFixed(4)));
    const nArbs = Math.max(0, Math.round(Number(arbs) || 0));

    const s1Lhs = sem1Lhs !== undefined && sem1Lhs !== null && sem1Lhs !== ''
      ? Math.max(0, Math.min(nLhs, Math.round(Number(sem1Lhs) || 0)))
      : (nLhs > 0 ? Math.round(nLhs / 2) : 0);
    const s2Lhs = sem2Lhs !== undefined && sem2Lhs !== null && sem2Lhs !== ''
      ? Math.max(0, Math.round(Number(sem2Lhs) || 0))
      : Math.max(0, nLhs - s1Lhs);

    const s1Area = sem1Area !== undefined && sem1Area !== null && sem1Area !== ''
      ? Math.max(0, Math.min(nArea, Number((Number(sem1Area) || 0).toFixed(4))))
      : Number((nArea / 2).toFixed(4));
    const s2Area = sem2Area !== undefined && sem2Area !== null && sem2Area !== ''
      ? Math.max(0, Number((Number(sem2Area) || 0).toFixed(4)))
      : Math.max(0, Number((nArea - s1Area).toFixed(4)));

    const s1Arbs = sem1Arbs !== undefined && sem1Arbs !== null && sem1Arbs !== ''
      ? Math.max(0, Math.min(nArbs, Math.round(Number(sem1Arbs) || 0)))
      : (nArbs > 0 ? Math.round(nArbs / 2) : 0);
    const s2Arbs = sem2Arbs !== undefined && sem2Arbs !== null && sem2Arbs !== ''
      ? Math.max(0, Math.round(Number(sem2Arbs) || 0))
      : Math.max(0, nArbs - s1Arbs);

    const entry = {
      lhs: nLhs,
      area: nArea,
      arbs: nArbs,
      year: yr,
      sem1Lhs: s1Lhs,
      sem2Lhs: s2Lhs,
      sem1Area: s1Area,
      sem2Area: s2Area,
      sem1Arbs: s1Arbs,
      sem2Arbs: s2Arbs
    };

    if (!this.state.nepMilestoneListByYear) this.state.nepMilestoneListByYear = {};
    if (!this.state.nepProvinceListByYear) this.state.nepProvinceListByYear = {};
    if (!this.state.nepMilestoneListByYear[yr]) this.state.nepMilestoneListByYear[yr] = {};
    if (!this.state.nepProvinceListByYear[yr]) this.state.nepProvinceListByYear[yr] = {};

    if (msKey === 'overall') {
      this.state.nepProvinceListByYear[yr][pCode] = entry;
      if (!this.state.nepProvinceList) this.state.nepProvinceList = {};
      this.state.nepProvinceList[pCode] = entry;
    } else {
      if (!this.state.nepMilestoneListByYear[yr][msKey]) this.state.nepMilestoneListByYear[yr][msKey] = {};
      this.state.nepMilestoneListByYear[yr][msKey][pCode] = entry;
      if (!this.state.nepMilestoneList) this.state.nepMilestoneList = {};
      if (!this.state.nepMilestoneList[msKey]) this.state.nepMilestoneList[msKey] = {};
      this.state.nepMilestoneList[msKey][pCode] = entry;
    }

    this.recalculateNepTargetsForYear(yr, msKey);
    this.save();

    return {
      id: `NEP-${yr}-${msKey}-${pCode}`,
      year: yr,
      milestone: msKey,
      provinceCode: pCode,
      ...entry
    };
  }

  /**
   * CRUD: Update an existing NEP target.
   */
  updateNepTarget(payload) {
    return this.createNepTarget(payload);
  }

  /**
   * CRUD: Delete a specific NEP target by year, milestone, and province.
   */
  deleteNepTarget({ year, milestone = 'overall', provinceCode }) {
    const yr = Math.round(Number(year) || 0);
    const msKey = String(milestone || 'overall').trim().toLowerCase();
    const pCode = String(provinceCode || '').trim().toUpperCase();

    let deleted = false;
    if (this.state.nepMilestoneListByYear?.[yr]?.[msKey]?.[pCode]) {
      delete this.state.nepMilestoneListByYear[yr][msKey][pCode];
      deleted = true;
    }
    if (this.state.nepProvinceListByYear?.[yr]?.[pCode] && (msKey === 'overall' || !msKey)) {
      delete this.state.nepProvinceListByYear[yr][pCode];
      deleted = true;
    }

    if (this.state.nepMilestoneList?.[msKey]?.[pCode]?.year === yr) {
      delete this.state.nepMilestoneList[msKey][pCode];
    }
    if (this.state.nepProvinceList?.[pCode]?.year === yr && (msKey === 'overall' || !msKey)) {
      delete this.state.nepProvinceList[pCode];
    }

    this.recalculateNepTargetsForYear(yr, msKey);
    this.save();

    return {
      ok: true,
      deleted: { year: yr, milestone: msKey, provinceCode: pCode }
    };
  }

  /**
   * Recalculate rollup totals in nepTargets and nepTargetsByYear for a specific year and milestone.
   */
  recalculateNepTargetsForYear(year, milestoneKey) {
    const yr = Math.round(Number(year) || new Date().getFullYear());
    const msKey = String(milestoneKey || 'overall').toLowerCase();
    if (msKey === 'overall') return;

    const msMap = this.state.nepMilestoneListByYear?.[yr]?.[msKey] || this.state.nepMilestoneList?.[msKey] || {};
    const totalLhs = Object.values(msMap).reduce((s, r) => s + (Number(r.lhs) || 0), 0);
    const totalArea = Number(Object.values(msMap).reduce((s, r) => s + (Number(r.area) || 0), 0).toFixed(4));
    const totalSem1Lhs = Object.values(msMap).reduce((s, r) => s + (Number(r.sem1Lhs) || 0), 0);
    const totalSem2Lhs = Object.values(msMap).reduce((s, r) => s + (Number(r.sem2Lhs) || 0), 0);
    const totalSem1Area = Number(Object.values(msMap).reduce((s, r) => s + (Number(r.sem1Area) || 0), 0).toFixed(4));
    const totalSem2Area = Number(Object.values(msMap).reduce((s, r) => s + (Number(r.sem2Area) || 0), 0).toFixed(4));

    const s1Count = totalSem1Lhs > 0 ? totalSem1Lhs : (totalLhs > 0 ? Math.round(totalLhs / 2) : 0);
    const s2Count = totalSem2Lhs > 0 ? totalSem2Lhs : Math.max(0, totalLhs - s1Count);
    const s1Area = totalSem1Area > 0 ? totalSem1Area : Number((totalArea / 2).toFixed(4));
    const s2Area = totalSem2Area > 0 ? totalSem2Area : Math.max(0, Number((totalArea - s1Area).toFixed(4)));

    if (!this.state.nepTargetsByYear) this.state.nepTargetsByYear = {};
    if (!this.state.nepTargetsByYear[yr]) this.state.nepTargetsByYear[yr] = {};
    this.state.nepTargetsByYear[yr][msKey] = {
      targetCount: totalLhs,
      targetAreaHas: totalArea,
      sem1TargetCount: s1Count,
      sem2TargetCount: s2Count,
      sem1TargetAreaHas: s1Area,
      sem2TargetAreaHas: s2Area
    };

    if (!this.state.nepTargets) this.state.nepTargets = {};
    this.state.nepTargets[msKey] = {
      targetCount: totalLhs,
      targetAreaHas: totalArea,
      sem1TargetCount: s1Count,
      sem2TargetCount: s2Count,
      sem1TargetAreaHas: s1Area,
      sem2TargetAreaHas: s2Area
    };
  }

  /**
   * CRUD: Query NEP target records across all years, milestones, and provinces.
   */
  getNepTargetsList({ year = 'ALL', milestone = 'ALL', provinceCode = 'ALL' } = {}) {
    const list = [];
    const yrFilter = year && year !== 'ALL' ? Math.round(Number(year)) : null;
    const msFilter = milestone && milestone !== 'ALL' ? String(milestone).toLowerCase() : null;
    const provFilter = provinceCode && provinceCode !== 'ALL' ? String(provinceCode).toUpperCase() : null;

    // Collect from nepProvinceListByYear (overall)
    for (const [yrStr, provMap] of Object.entries(this.state.nepProvinceListByYear || {})) {
      const yr = Math.round(Number(yrStr));
      if (yrFilter && yr !== yrFilter) continue;
      if (msFilter && msFilter !== 'overall') continue;
      for (const [code, item] of Object.entries(provMap || {})) {
        if (provFilter && code !== provFilter) continue;
        list.push({
          id: `NEP-${yr}-overall-${code}`,
          year: yr,
          milestone: 'overall',
          milestoneLabel: 'Overall NEP (All Milestones)',
          provinceCode: code,
          provinceName: PROVINCIAL_NODES.find((n) => n.code === code)?.name || code,
          lhs: item.lhs || 0,
          sem1Lhs: item.sem1Lhs ?? (item.lhs > 0 ? Math.round(item.lhs / 2) : 0),
          sem2Lhs: item.sem2Lhs ?? Math.max(0, (item.lhs || 0) - (item.sem1Lhs || 0)),
          area: item.area || 0,
          sem1Area: item.sem1Area ?? Number(((item.area || 0) / 2).toFixed(4)),
          sem2Area: item.sem2Area ?? Math.max(0, Number(((item.area || 0) - (item.sem1Area || 0)).toFixed(4))),
          arbs: item.arbs || 0,
          sem1Arbs: item.sem1Arbs ?? (item.arbs > 0 ? Math.round(item.arbs / 2) : 0),
          sem2Arbs: item.sem2Arbs ?? Math.max(0, (item.arbs || 0) - (item.sem1Arbs || 0))
        });
      }
    }

    // Collect from nepMilestoneListByYear
    for (const [yrStr, msMap] of Object.entries(this.state.nepMilestoneListByYear || {})) {
      const yr = Math.round(Number(yrStr));
      if (yrFilter && yr !== yrFilter) continue;
      for (const [msKey, provMap] of Object.entries(msMap || {})) {
        if (msFilter && msKey !== msFilter) continue;
        const msObj = DASHBOARD_MILESTONES.find((m) => m.key === msKey);
        const msLabel = msObj ? msObj.label : msKey;
        for (const [code, item] of Object.entries(provMap || {})) {
          if (provFilter && code !== provFilter) continue;
          list.push({
            id: `NEP-${yr}-${msKey}-${code}`,
            year: yr,
            milestone: msKey,
            milestoneLabel: msLabel,
            provinceCode: code,
            provinceName: PROVINCIAL_NODES.find((n) => n.code === code)?.name || code,
            lhs: item.lhs || 0,
            sem1Lhs: item.sem1Lhs ?? (item.lhs > 0 ? Math.round(item.lhs / 2) : 0),
            sem2Lhs: item.sem2Lhs ?? Math.max(0, (item.lhs || 0) - (item.sem1Lhs || 0)),
            area: item.area || 0,
            sem1Area: item.sem1Area ?? Number(((item.area || 0) / 2).toFixed(4)),
            sem2Area: item.sem2Area ?? Math.max(0, Number(((item.area || 0) - (item.sem1Area || 0)).toFixed(4))),
            arbs: item.arbs || 0,
            sem1Arbs: item.sem1Arbs ?? (item.arbs > 0 ? Math.round(item.arbs / 2) : 0),
            sem2Arbs: item.sem2Arbs ?? Math.max(0, (item.arbs || 0) - (item.sem1Arbs || 0))
          });
        }
      }
    }

    return list.sort((a, b) => b.year - a.year || a.milestone.localeCompare(b.milestone) || a.provinceCode.localeCompare(b.provinceCode));
  }

  resetToSample() {
    const currentUrl = this.state.gasWebAppUrl;
    const currentSnapshot = this.state.liveHubSnapshot;
    const currentUsers = this.state.users;
    const currentSecret = this.state.authSecret;
    this.state = createSeedState();
    this.state.gasWebAppUrl = currentUrl;
    this.state.liveHubSnapshot = currentSnapshot;
    if (currentSecret) this.state.authSecret = currentSecret;
    if (Array.isArray(currentUsers)) this.state.users = currentUsers;
    this.normalizeState();
    this.save();
    return this.state;
  }

  clearToEmptyLive() {
    this.state.dataSourceMode = 'live';
    this.state.milestoneData = [];
    for (const tab of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
      this.state.optool[tab] = [];
    }
    this.addSyncLog('Workspace Reset', 'info', 'Cleared sample staging data. Ready for live Google Sheet sync or fresh entries.');
    this.save();
    return this.state;
  }

  deleteMockMilestones({ clearAll = false } = {}) {
    const seed = createSeedState();
    const mockRecordIds = new Set((seed.milestoneData || []).map((m) => m.Record_ID));
    const mockLhids = new Set(
      Object.values(seed.optool || {})
        .flatMap((rows) => (Array.isArray(rows) ? rows.map((r) => r.lhid) : []))
        .filter(Boolean)
    );

    const isMockRecord = (r) => {
      if (clearAll) return true;
      if (mockRecordIds.has(r.Record_ID)) return true;
      if (r.LHID && mockLhids.has(r.LHID)) return true;
      const batch = String(r.Batch_Category || '').toUpperCase();
      if (
        batch.startsWith('ADMIN BATCH') ||
        batch.includes('SPLIT PIPELINE 2026') ||
        batch.includes('CARRYOVER BASELINE')
      ) {
        return true;
      }
      return false;
    };

    const beforeMs = this.state.milestoneData.length;
    this.state.milestoneData = this.state.milestoneData.filter((r) => !isMockRecord(r));
    const deletedMilestonesCount = beforeMs - this.state.milestoneData.length;

    let deletedOptoolCount = 0;
    if (this.state.optool) {
      for (const tab of Object.keys(this.state.optool)) {
        if (Array.isArray(this.state.optool[tab])) {
          const beforeTab = this.state.optool[tab].length;
          this.state.optool[tab] = this.state.optool[tab].filter((r) => {
            if (mockLhids.has(r.lhid)) return false;
            if (tab !== 'Database' && r.lhid === '805000006') return false;
            return true;
          });
          deletedOptoolCount += beforeTab - this.state.optool[tab].length;
        }
      }
    }

    this.addSyncLog(
      'Delete Mock Data',
      'info',
      `Deleted ${deletedMilestonesCount} mock milestone records and ${deletedOptoolCount} mock OPTool rows across every Region VIII province.`
    );
    this.save();
    return {
      deletedMilestonesCount,
      deletedOptoolCount,
      totalDeleted: deletedMilestonesCount + deletedOptoolCount
    };
  }

  computeMilestoneNepBreakdown({ dbLhidMap, activeScope, milestoneYear = 'ALL' }) {
    const dbByLhid = new Map();
    for (const r of this.state.optool?.Database || []) {
      const key = String(r?.lhid || '').trim().toLowerCase();
      if (key && !dbByLhid.has(key)) dbByLhid.set(key, r);
    }

    const yearSet = new Set();
    const currentYear = new Date().getFullYear();
    yearSet.add(currentYear);

    // Collect all target years from nepMilestoneListByYear & nepProvinceListByYear
    if (this.state.nepMilestoneListByYear && typeof this.state.nepMilestoneListByYear === 'object') {
      for (const yrStr of Object.keys(this.state.nepMilestoneListByYear)) {
        const yr = Math.round(Number(yrStr) || 0);
        if (yr >= 2000 && yr <= 2099) yearSet.add(yr);
      }
    }
    if (this.state.nepProvinceListByYear && typeof this.state.nepProvinceListByYear === 'object') {
      for (const yrStr of Object.keys(this.state.nepProvinceListByYear)) {
        const yr = Math.round(Number(yrStr) || 0);
        if (yr >= 2000 && yr <= 2099) yearSet.add(yr);
      }
    }

    // Collect all target years from Regional Hub nepProvinceList
    if (this.state.nepProvinceList && typeof this.state.nepProvinceList === 'object') {
      for (const p of Object.values(this.state.nepProvinceList)) {
        const yr = Math.round(Number(p?.year) || 0);
        if (yr >= 2000 && yr <= 2099) yearSet.add(yr);
      }
    }

    // Collect all target years from per-milestone NEP lists
    if (this.state.nepMilestoneList && typeof this.state.nepMilestoneList === 'object') {
      for (const msMap of Object.values(this.state.nepMilestoneList)) {
        if (msMap && typeof msMap === 'object') {
          for (const p of Object.values(msMap)) {
            const yr = Math.round(Number(p?.year) || 0);
            if (yr >= 2000 && yr <= 2099) yearSet.add(yr);
          }
        }
      }
    }

    // Collect target years and accomplishment dates from OPTool records
    for (const tabName of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
      const tabRows = this.getScopedOptoolTabRows(tabName, activeScope, dbLhidMap);
      for (const r of tabRows) {
        const rawYr = Math.round(Number(r?.targetYear || r?.Target_Year) || 0);
        if (rawYr >= 2000 && rawYr <= 2099) {
          yearSet.add(rawYr);
        }
        if (typeof r?.Target_CurrentYear_PreviousYear === 'string') {
          const m = r.Target_CurrentYear_PreviousYear.match(/\b(20\d\d)\b/);
          if (m) yearSet.add(Number(m[1]));
        }
      }
    }

    const filterYear = milestoneYear && milestoneYear !== 'ALL' ? Number(milestoneYear) : null;
    const roundArea = (val) => Number((Number(val) || 0).toFixed(4));

    const rows = DASHBOARD_MILESTONES.map((meta) => {
      const spec = MILESTONE_ANALYTICS_SPECS[meta.key];
      const sourceRows = this.getScopedOptoolTabRows(spec.tabName, activeScope, dbLhidMap).filter(
        (r) => spec.include(r, filterYear)
      );

      const q = {
        1: { count: 0, areaHas: 0 },
        2: { count: 0, areaHas: 0 },
        3: { count: 0, areaHas: 0 },
        4: { count: 0, areaHas: 0 },
        undated: { count: 0, areaHas: 0 }
      };

      const m = {
        1: { count: 0, areaHas: 0 },
        2: { count: 0, areaHas: 0 },
        3: { count: 0, areaHas: 0 },
        4: { count: 0, areaHas: 0 },
        5: { count: 0, areaHas: 0 },
        6: { count: 0, areaHas: 0 },
        7: { count: 0, areaHas: 0 },
        8: { count: 0, areaHas: 0 },
        9: { count: 0, areaHas: 0 },
        10: { count: 0, areaHas: 0 },
        11: { count: 0, areaHas: 0 },
        12: { count: 0, areaHas: 0 }
      };

      const provData = {};
      for (const node of PROVINCIAL_NODES) {
        provData[node.code] = {
          code: node.code,
          name: node.name,
          count: 0,
          areaHas: 0,
          q: {
            1: { count: 0, areaHas: 0 },
            2: { count: 0, areaHas: 0 },
            3: { count: 0, areaHas: 0 },
            4: { count: 0, areaHas: 0 }
          },
          m: {
            1: { count: 0, areaHas: 0 }, 2: { count: 0, areaHas: 0 }, 3: { count: 0, areaHas: 0 },
            4: { count: 0, areaHas: 0 }, 5: { count: 0, areaHas: 0 }, 6: { count: 0, areaHas: 0 },
            7: { count: 0, areaHas: 0 }, 8: { count: 0, areaHas: 0 }, 9: { count: 0, areaHas: 0 },
            10: { count: 0, areaHas: 0 }, 11: { count: 0, areaHas: 0 }, 12: { count: 0, areaHas: 0 }
          },
          targetCount: 0,
          targetAreaHas: 0
        };
      }

      for (const r of sourceRows) {
        const parsed = resolveFirstDateQuarter(r, spec.dateKeys, filterYear);
        if (parsed?.year) yearSet.add(parsed.year);
        if (filterYear && parsed?.year !== filterYear) continue;

        const dbRow = dbByLhid.get(String(r?.lhid || '').trim().toLowerCase()) || null;
        const countVal = spec.getCount(r);
        const areaVal = spec.getArea(r, dbRow);
        const bucket = parsed?.quarter ? q[parsed.quarter] : q.undated;
        bucket.count += countVal;
        bucket.areaHas += areaVal;
        if (parsed?.month && m[parsed.month]) {
          m[parsed.month].count += countVal;
          m[parsed.month].areaHas += areaVal;
        }

        const pCode = this.getOptoolRowProvinceCode(spec.tabName, r, dbLhidMap);
        if (pCode && provData[pCode]) {
          provData[pCode].count += countVal;
          provData[pCode].areaHas += areaVal;
          if (parsed?.quarter && provData[pCode].q[parsed.quarter]) {
            provData[pCode].q[parsed.quarter].count += countVal;
            provData[pCode].q[parsed.quarter].areaHas += areaVal;
          }
          if (parsed?.month && provData[pCode].m[parsed.month]) {
            provData[pCode].m[parsed.month].count += countVal;
            provData[pCode].m[parsed.month].areaHas += areaVal;
          }
        }
      }

      const totalCount = q[1].count + q[2].count + q[3].count + q[4].count + q.undated.count;
      const totalArea = q[1].areaHas + q[2].areaHas + q[3].areaHas + q[4].areaHas + q.undated.areaHas;

      const regTarget = (filterYear && this.state.nepTargetsByYear?.[filterYear]?.[meta.key]) ||
                        this.state.nepTargets?.[meta.key] || {};
      let nepTargetCount = Number(regTarget.targetCount) || 0;
      let nepTargetAreaHas = Number(regTarget.targetAreaHas) || 0;

      // If milestone-specific provincial list has targets for this milestone, calculate from it
      const msProvMap = (filterYear && this.state.nepMilestoneListByYear?.[filterYear]?.[meta.key]) ||
                        (filterYear ? null : this.state.nepMilestoneList?.[meta.key]);
      if (msProvMap && typeof msProvMap === 'object') {
        const provEntries = Object.entries(msProvMap);
        const hasEntries = provEntries.some(([, d]) => (Number(d?.lhs) || 0) > 0 || (Number(d?.area) || 0) > 0);
        if (hasEntries) {
          let specificCount = 0;
          let specificArea = 0;
          for (const [pCode, pData] of provEntries) {
            if (activeScope && pCode !== activeScope) continue;
            const pYear = Math.round(Number(pData?.year) || currentYear);
            if (filterYear && pYear !== filterYear) continue;
            specificCount += Math.max(0, Math.round(Number(pData?.lhs) || 0));
            specificArea += Math.max(0, Number(pData?.area) || 0);
          }
          if (filterYear) {
            nepTargetCount = specificCount;
            nepTargetAreaHas = roundArea(specificArea);
          } else if (specificCount > 0 || specificArea > 0) {
            nepTargetCount = specificCount;
            nepTargetAreaHas = roundArea(specificArea);
          }
        }
      }

      const provinceBreakdown = {};
      const zeroAccompProvinces = [];
      const activeProvinces = [];

      for (const node of PROVINCIAL_NODES) {
        const pd = provData[node.code] || { count: 0, areaHas: 0, q: { 1: { count: 0, areaHas: 0 }, 2: { count: 0, areaHas: 0 }, 3: { count: 0, areaHas: 0 }, 4: { count: 0, areaHas: 0 } } };
        const pTotalCount = pd.count;
        const pTotalArea = roundArea(pd.areaHas);
        const hasAccomp = pTotalCount > 0 || pTotalArea > 0;
        if (hasAccomp) activeProvinces.push(node.code);
        else zeroAccompProvinces.push(node.code);
        const pSem1Count = (pd.q[1]?.count || 0) + (pd.q[2]?.count || 0);
        const pSem1Area = roundArea((pd.q[1]?.areaHas || 0) + (pd.q[2]?.areaHas || 0));
        const pSem2Count = (pd.q[3]?.count || 0) + (pd.q[4]?.count || 0);
        const pSem2Area = roundArea((pd.q[3]?.areaHas || 0) + (pd.q[4]?.areaHas || 0));
        let pTargetCount = 0;
        let pTargetArea = 0;
        let pSem1TargetCount = 0;
        let pSem1TargetArea = 0;
        let pSem2TargetCount = 0;
        let pSem2TargetArea = 0;

        if (msProvMap && msProvMap[node.code]) {
          const pt = msProvMap[node.code];
          const pYear = Math.round(Number(pt?.year) || currentYear);
          if (!filterYear || pYear === filterYear) {
            pTargetCount = Math.max(0, Math.round(Number(pt?.lhs) || 0));
            pTargetArea = Math.max(0, Number(pt?.area) || 0);

            const hasExplicitSem1Lhs = pt.sem1Lhs !== undefined && pt.sem1Lhs !== null && pt.sem1Lhs !== '';
            const hasExplicitSem1Area = pt.sem1Area !== undefined && pt.sem1Area !== null && pt.sem1Area !== '';

            pSem1TargetCount = hasExplicitSem1Lhs
              ? Math.max(0, Math.min(pTargetCount, Math.round(Number(pt.sem1Lhs) || 0)))
              : (pTargetCount > 0 ? pTargetCount / 2 : 0);
            pSem1TargetArea = hasExplicitSem1Area
              ? Math.max(0, Math.min(pTargetArea, roundArea(Number(pt.sem1Area) || 0)))
              : roundArea(pTargetArea / 2);

            pSem2TargetCount = Math.max(0, pTargetCount - pSem1TargetCount);
            pSem2TargetArea = roundArea(Math.max(0, pTargetArea - pSem1TargetArea));
          }
        } else {
          pSem1TargetCount = pTargetCount > 0 ? pTargetCount / 2 : 0;
          pSem1TargetArea = roundArea(pTargetArea / 2);
          pSem2TargetCount = pTargetCount > 0 ? pTargetCount / 2 : 0;
          pSem2TargetArea = roundArea(pTargetArea / 2);
        }

        const pSem1RateCount = pSem1TargetCount > 0 ? Number(((pSem1Count / pSem1TargetCount) * 100).toFixed(2)) : 0;
        const pSem1RateArea = pSem1TargetArea > 0 ? Number(((pSem1Area / pSem1TargetArea) * 100).toFixed(2)) : 0;
        const pSem1VarCount = pSem1Count - pSem1TargetCount;
        const pSem1VarArea = roundArea(pSem1Area - pSem1TargetArea);

        const pSem2RateCount = pSem2TargetCount > 0 ? Number(((pSem2Count / pSem2TargetCount) * 100).toFixed(2)) : 0;
        const pSem2RateArea = pSem2TargetArea > 0 ? Number(((pSem2Area / pSem2TargetArea) * 100).toFixed(2)) : 0;
        const pSem2VarCount = pSem2Count - pSem2TargetCount;
        const pSem2VarArea = roundArea(pSem2Area - pSem2TargetArea);

        provinceBreakdown[node.code] = {
          code: node.code,
          name: node.name,
          count: pTotalCount,
          areaHas: pTotalArea,
          targetCount: pTargetCount,
          targetAreaHas: roundArea(pTargetArea),
          targetSem1Count: pSem1TargetCount,
          targetSem1AreaHas: pSem1TargetArea,
          targetSem2Count: pSem2TargetCount,
          targetSem2AreaHas: pSem2TargetArea,
          hasAccomp,
          q1: { count: pd.q[1]?.count || 0, areaHas: roundArea(pd.q[1]?.areaHas || 0) },
          q2: { count: pd.q[2]?.count || 0, areaHas: roundArea(pd.q[2]?.areaHas || 0) },
          q3: { count: pd.q[3]?.count || 0, areaHas: roundArea(pd.q[3]?.areaHas || 0) },
          q4: { count: pd.q[4]?.count || 0, areaHas: roundArea(pd.q[4]?.areaHas || 0) },
          sem1: {
            count: pSem1Count,
            areaHas: pSem1Area,
            targetCount: pSem1TargetCount,
            targetAreaHas: pSem1TargetArea,
            rateCountPct: pSem1RateCount,
            rateAreaPct: pSem1RateArea,
            varianceCount: pSem1VarCount,
            varianceAreaHas: pSem1VarArea
          },
          sem2: {
            count: pSem2Count,
            areaHas: pSem2Area,
            targetCount: pSem2TargetCount,
            targetAreaHas: pSem2TargetArea,
            rateCountPct: pSem2RateCount,
            rateAreaPct: pSem2RateArea,
            varianceCount: pSem2VarCount,
            varianceAreaHas: pSem2VarArea
          },
          months: {
            1: { count: pd.m[1]?.count || 0, areaHas: roundArea(pd.m[1]?.areaHas || 0) },
            2: { count: pd.m[2]?.count || 0, areaHas: roundArea(pd.m[2]?.areaHas || 0) },
            3: { count: pd.m[3]?.count || 0, areaHas: roundArea(pd.m[3]?.areaHas || 0) },
            4: { count: pd.m[4]?.count || 0, areaHas: roundArea(pd.m[4]?.areaHas || 0) },
            5: { count: pd.m[5]?.count || 0, areaHas: roundArea(pd.m[5]?.areaHas || 0) },
            6: { count: pd.m[6]?.count || 0, areaHas: roundArea(pd.m[6]?.areaHas || 0) },
            7: { count: pd.m[7]?.count || 0, areaHas: roundArea(pd.m[7]?.areaHas || 0) },
            8: { count: pd.m[8]?.count || 0, areaHas: roundArea(pd.m[8]?.areaHas || 0) },
            9: { count: pd.m[9]?.count || 0, areaHas: roundArea(pd.m[9]?.areaHas || 0) },
            10: { count: pd.m[10]?.count || 0, areaHas: roundArea(pd.m[10]?.areaHas || 0) },
            11: { count: pd.m[11]?.count || 0, areaHas: roundArea(pd.m[11]?.areaHas || 0) },
            12: { count: pd.m[12]?.count || 0, areaHas: roundArea(pd.m[12]?.areaHas || 0) }
          },
          varianceCount: pTotalCount - pTargetCount,
          varianceAreaHas: roundArea(pTotalArea - pTargetArea),
          rateCountPct: pTargetCount > 0 ? Number(((pTotalCount / pTargetCount) * 100).toFixed(2)) : 0,
          rateAreaPct: pTargetArea > 0 ? Number(((pTotalArea / pTargetArea) * 100).toFixed(2)) : 0
        };
      }

      const sem1Count = q[1].count + q[2].count;
      const sem1Area = roundArea(q[1].areaHas + q[2].areaHas);
      const sem2Count = q[3].count + q[4].count;
      const sem2Area = roundArea(q[3].areaHas + q[4].areaHas);

      let sem1TargetCount = nepTargetCount > 0 ? nepTargetCount / 2 : 0;
      let sem1TargetAreaHas = roundArea(nepTargetAreaHas / 2);

      const hasProvBreakdownTargets = Object.values(provinceBreakdown).some(
        (p) => (p.targetCount || 0) > 0 || (p.targetAreaHas || 0) > 0
      );

      if (filterYear && hasProvBreakdownTargets) {
        sem1TargetCount = Object.values(provinceBreakdown).reduce((s, p) => s + (p.targetSem1Count || 0), 0);
        sem1TargetAreaHas = roundArea(Object.values(provinceBreakdown).reduce((s, p) => s + (p.targetSem1AreaHas || 0), 0));
      } else if (regTarget.sem1TargetCount !== undefined && regTarget.sem1TargetCount !== null && regTarget.sem1TargetCount !== '') {
        sem1TargetCount = Math.max(0, Math.min(nepTargetCount, Number(regTarget.sem1TargetCount) || 0));
        if (regTarget.sem1TargetAreaHas !== undefined && regTarget.sem1TargetAreaHas !== null && regTarget.sem1TargetAreaHas !== '') {
          sem1TargetAreaHas = Math.max(0, Math.min(nepTargetAreaHas, roundArea(Number(regTarget.sem1TargetAreaHas) || 0)));
        } else if (hasProvBreakdownTargets) {
          sem1TargetAreaHas = roundArea(Object.values(provinceBreakdown).reduce((s, p) => s + (p.targetSem1AreaHas || 0), 0));
        }
      } else if (hasProvBreakdownTargets) {
        sem1TargetCount = Object.values(provinceBreakdown).reduce((s, p) => s + (p.targetSem1Count || 0), 0);
        sem1TargetAreaHas = roundArea(Object.values(provinceBreakdown).reduce((s, p) => s + (p.targetSem1AreaHas || 0), 0));
      }

      const sem2TargetCount = Math.max(0, nepTargetCount - sem1TargetCount);
      const sem2TargetAreaHas = roundArea(Math.max(0, nepTargetAreaHas - sem1TargetAreaHas));

      const sem1RateCountPct = sem1TargetCount > 0 ? Number(((sem1Count / sem1TargetCount) * 100).toFixed(2)) : 0;
      const sem1RateAreaPct = sem1TargetAreaHas > 0 ? Number(((sem1Area / sem1TargetAreaHas) * 100).toFixed(2)) : 0;
      const sem1VarianceCount = sem1Count - sem1TargetCount;
      const sem1VarianceAreaHas = roundArea(sem1Area - sem1TargetAreaHas);

      const sem2RateCountPct = sem2TargetCount > 0 ? Number(((sem2Count / sem2TargetCount) * 100).toFixed(2)) : 0;
      const sem2RateAreaPct = sem2TargetAreaHas > 0 ? Number(((sem2Area / sem2TargetAreaHas) * 100).toFixed(2)) : 0;
      const sem2VarianceCount = sem2Count - sem2TargetCount;
      const sem2VarianceAreaHas = roundArea(sem2Area - sem2TargetAreaHas);

      return {
        key: meta.key,
        label: meta.label,
        sourceTab: spec.tabName,
        nepTargetCount,
        nepTargetAreaHas: roundArea(nepTargetAreaHas),
        nepTargetSem1Count: sem1TargetCount,
        nepTargetSem1AreaHas: sem1TargetAreaHas,
        nepTargetSem2Count: sem2TargetCount,
        nepTargetSem2AreaHas: sem2TargetAreaHas,
        provinceBreakdown,
        zeroAccompProvinces,
        activeProvinces,
        q1: { count: q[1].count, areaHas: roundArea(q[1].areaHas) },
        q2: { count: q[2].count, areaHas: roundArea(q[2].areaHas) },
        q3: { count: q[3].count, areaHas: roundArea(q[3].areaHas) },
        q4: { count: q[4].count, areaHas: roundArea(q[4].areaHas) },
        sem1: {
          count: sem1Count,
          areaHas: sem1Area,
          targetCount: sem1TargetCount,
          targetAreaHas: sem1TargetAreaHas,
          rateCountPct: sem1RateCountPct,
          rateAreaPct: sem1RateAreaPct,
          varianceCount: sem1VarianceCount,
          varianceAreaHas: sem1VarianceAreaHas
        },
        sem2: {
          count: sem2Count,
          areaHas: sem2Area,
          targetCount: sem2TargetCount,
          targetAreaHas: sem2TargetAreaHas,
          rateCountPct: sem2RateCountPct,
          rateAreaPct: sem2RateAreaPct,
          varianceCount: sem2VarianceCount,
          varianceAreaHas: sem2VarianceAreaHas
        },
        months: {
          1: { count: m[1].count, areaHas: roundArea(m[1].areaHas) },
          2: { count: m[2].count, areaHas: roundArea(m[2].areaHas) },
          3: { count: m[3].count, areaHas: roundArea(m[3].areaHas) },
          4: { count: m[4].count, areaHas: roundArea(m[4].areaHas) },
          5: { count: m[5].count, areaHas: roundArea(m[5].areaHas) },
          6: { count: m[6].count, areaHas: roundArea(m[6].areaHas) },
          7: { count: m[7].count, areaHas: roundArea(m[7].areaHas) },
          8: { count: m[8].count, areaHas: roundArea(m[8].areaHas) },
          9: { count: m[9].count, areaHas: roundArea(m[9].areaHas) },
          10: { count: m[10].count, areaHas: roundArea(m[10].areaHas) },
          11: { count: m[11].count, areaHas: roundArea(m[11].areaHas) },
          12: { count: m[12].count, areaHas: roundArea(m[12].areaHas) }
        },
        undated: { count: q.undated.count, areaHas: roundArea(q.undated.areaHas) },
        total: { count: totalCount, areaHas: roundArea(totalArea) },
        rateCountPct:
          nepTargetCount > 0 ? Number(((totalCount / nepTargetCount) * 100).toFixed(2)) : 0,
        rateAreaPct:
          nepTargetAreaHas > 0 ? Number(((totalArea / nepTargetAreaHas) * 100).toFixed(2)) : 0,
        varianceCount: totalCount - nepTargetCount,
        varianceAreaHas: roundArea(totalArea - nepTargetAreaHas)
      };
    });

    return {
      milestoneNepBreakdown: rows,
      availableMilestoneYears: Array.from(yearSet).sort((a, b) => b - a)
    };
  }

  getAnalytics(filters = {}) {
    return this.computeAnalytics({ useOptoolRegistration: true, ...filters });
  }

  computeAnalytics(filters = {}) {
    const {
      province = 'ALL',
      periodMonth = 'LATEST',
      batch = 'ALL',
      stage = 'ALL',
      milestoneYear = 'ALL',
      restrictToProvince = false,
      useOptoolRegistration = false,
      registrationSource = '',
      allProvincesForNep = false
    } = filters;

    // Registered accomplishment: dynamically sourced from Google Sheets RegistrationDistribution
    // (records with Column M Date Registered and Column J Area HAS) when requested or in live mode.
    const shouldUseOptool =
      Boolean(useOptoolRegistration || registrationSource === 'optool') ||
      (this.state.dataSourceMode === 'live' && (this.state.optool?.RegistrationDistribution?.length || 0) > 0);
    const optoolRegistered = shouldUseOptool ? this.getRegisteredOptoolRecords(restrictToProvince ? province : 'ALL') : [];
    const sourceMilestones = shouldUseOptool ? optoolRegistered : this.state.milestoneData;

    const allMilestones = sourceMilestones.map((row) => {
      const provCode =
        row.Province_Code ||
        this.getMilestoneProvinceCode(row) || 'LEY';
      const monthKey = /^\d{4}-\d{2}/.test(String(row.Milestone_Date || row.dateRegistered || ''))
        ? String(row.Milestone_Date || row.dateRegistered).slice(0, 7)
        : (row.Month_Key || 'Unknown');
      return {
        ...row,
        Province_Code: provCode,
        Month_Key: monthKey,
        Area_Num: typeof row.Area_Num === 'number' ? row.Area_Num : (Number(row.Area_HAS || row.areaHas || 0) || 0)
      };
    });

    const visibleMilestones =
      restrictToProvince && province !== 'ALL'
        ? allMilestones.filter((m) => m.Province_Code === province)
        : allMilestones;

    // Discover available months sorted ascending
    const availableMonths = Array.from(
      new Set(visibleMilestones.map((m) => m.Month_Key).filter((m) => m !== 'Unknown'))
    ).sort();

    const activeMonth =
      periodMonth === 'LATEST'
        ? availableMonths[availableMonths.length - 1] || new Date().toISOString().slice(0, 7)
        : periodMonth;

    // Filter by province, batch, stage
    const scoped = visibleMilestones.filter((m) => {
      if (province !== 'ALL' && m.Province_Code !== province) return false;
      if (batch !== 'ALL' && m.Batch_Category !== batch) return false;
      if (stage !== 'ALL' && m.Milestone_Stage !== stage) return false;
      return true;
    });

    // Cumulative up to activeMonth (or all if periodMonth === 'ALL')
    const cumulativeRecords =
      activeMonth === 'ALL'
        ? scoped
        : scoped.filter((m) => m.Month_Key === 'Unknown' || m.Month_Key <= activeMonth);

    // Incremental inside activeMonth (or latest month if activeMonth === 'ALL')
    const targetIncMonth =
      activeMonth === 'ALL'
        ? availableMonths[availableMonths.length - 1] || ''
        : activeMonth;
    const incrementalRecords = targetIncMonth
      ? scoped.filter((m) => m.Month_Key === targetIncMonth)
      : scoped;

    const sumArea = (rows) => rows.reduce((acc, r) => acc + r.Area_Num, 0);

    const cumulativeETitles = cumulativeRecords.length;
    const cumulativeAreaHas = sumArea(cumulativeRecords);
    const incrementalETitles = incrementalRecords.length;
    const incrementalAreaHas = sumArea(incrementalRecords);

    // Baselines
    const targetProvinces = province === 'ALL' ? PROVINCE_CODES : [province];
    const baselineTargetETitles = targetProvinces.reduce(
      (sum, code) => sum + (this.state.baselines[code]?.targetETitles || 0),
      0
    );
    const baselineTargetAreaHas = targetProvinces.reduce(
      (sum, code) => sum + (this.state.baselines[code]?.targetAreaHas || 0),
      0
    );

    // Provincial breakdown matrix
    const dbLhidMap = this.buildDbLhidProvinceMap();
    const provincialNodes = REGIONAL_REGISTRY.filter(
      (n) =>
        n.role === 'Provincial Node' &&
        (!restrictToProvince || province === 'ALL' || n.code === province)
    );
    const provincialBreakdown = provincialNodes.map((node) => {
      const code = node.code;
      const provCum = cumulativeRecords.filter((m) => m.Province_Code === code);
      const provInc = incrementalRecords.filter((m) => m.Province_Code === code);
      const base = this.state.baselines[code] || { targetETitles: 0, targetAreaHas: 0 };
      const cumTitles = provCum.length;
      const cumArea = sumArea(provCum);
      const incTitles = provInc.length;
      const incArea = sumArea(provInc);

      return {
        code,
        jurisdiction: node.jurisdiction,
        provinceName: node.provinceName,
        spreadsheetId: node.spreadsheetId,
        url: node.url,
        baselineTargetETitles: base.targetETitles,
        baselineTargetAreaHas: Number(base.targetAreaHas.toFixed(4)),
        incrementalETitles: incTitles,
        incrementalAreaHas: Number(incArea.toFixed(4)),
        cumulativeETitles: cumTitles,
        cumulativeAreaHas: Number(cumArea.toFixed(4)),
        completionPctETitles:
          base.targetETitles > 0 ? Number(((cumTitles / base.targetETitles) * 100).toFixed(2)) : 0,
        completionPctArea:
          base.targetAreaHas > 0 ? Number(((cumArea / base.targetAreaHas) * 100).toFixed(2)) : 0,
        optoolCounts: {
          Database: this.getScopedOptoolTabRows('Database', code, dbLhidMap).length,
          RegistrationDistribution: this.getScopedOptoolTabRows(
            'RegistrationDistribution',
            code,
            dbLhidMap
          ).length,
          Installation: this.getScopedOptoolTabRows('Installation', code, dbLhidMap).length,
          Leasehold: this.getScopedOptoolTabRows('Leasehold', code, dbLhidMap).length
        }
      };
    });

    // Monthly Trend (Incremental + Cumulative)
    const monthBuckets = new Map();
    for (const m of availableMonths) {
      monthBuckets.set(m, { month: m, incrementalETitles: 0, incrementalAreaHas: 0 });
    }
    for (const rec of scoped) {
      if (!monthBuckets.has(rec.Month_Key)) {
        monthBuckets.set(rec.Month_Key, {
          month: rec.Month_Key,
          incrementalETitles: 0,
          incrementalAreaHas: 0
        });
      }
      const bucket = monthBuckets.get(rec.Month_Key);
      bucket.incrementalETitles += 1;
      bucket.incrementalAreaHas += rec.Area_Num;
    }

    const sortedMonths = Array.from(monthBuckets.values())
      .filter((b) => b.month !== 'Unknown')
      .sort((a, b) => a.month.localeCompare(b.month));

    let runningTitles = 0;
    let runningArea = 0;
    const monthlyTrend = sortedMonths.map((b) => {
      runningTitles += b.incrementalETitles;
      runningArea += b.incrementalAreaHas;
      return {
        month: b.month,
        incrementalETitles: b.incrementalETitles,
        incrementalAreaHas: Number(b.incrementalAreaHas.toFixed(4)),
        cumulativeETitles: runningTitles,
        cumulativeAreaHas: Number(runningArea.toFixed(4))
      };
    });

    // Stage breakdown (cumulative)
    const stageCounts = {};
    for (const s of MILESTONE_STAGES) {
      stageCounts[s] = { stage: s, count: 0, areaHas: 0 };
    }
    for (const r of cumulativeRecords) {
      if (!stageCounts[r.Milestone_Stage]) {
        stageCounts[r.Milestone_Stage] = { stage: r.Milestone_Stage, count: 0, areaHas: 0 };
      }
      stageCounts[r.Milestone_Stage].count += 1;
      stageCounts[r.Milestone_Stage].areaHas += r.Area_Num;
    }
    const stageBreakdown = Object.values(stageCounts).map((item) => ({
      ...item,
      areaHas: Number(item.areaHas.toFixed(4))
    }));

    // Batch breakdown
    const batchMap = new Map();
    for (const r of cumulativeRecords) {
      const key = r.Batch_Category || 'Unassigned';
      if (!batchMap.has(key)) batchMap.set(key, { batch: key, count: 0, areaHas: 0 });
      const b = batchMap.get(key);
      b.count += 1;
      b.areaHas += r.Area_Num;
    }
    const batchBreakdown = Array.from(batchMap.values()).map((b) => ({
      ...b,
      areaHas: Number(b.areaHas.toFixed(4))
    }));

    // OPTool cross-tab metrics & Database per province
    const activeScope = province === 'ALL' ? null : province;
    const dbRows = this.getScopedOptoolTabRows('Database', activeScope, dbLhidMap);

    const databaseByProvince = provincialNodes.map((node) => {
      const pDb = this.getScopedOptoolTabRows('Database', node.code, dbLhidMap);
      return {
        code: node.code,
        jurisdiction: node.jurisdiction,
        provinceName: node.provinceName,
        parcelCount: pDb.length,
        totalArea: Number(pDb.reduce((s, r) => s + (Number(r.totalArea) || 0), 0).toFixed(4)),
        computedArea: Number(pDb.reduce((s, r) => s + (Number(r.computedArea) || 0), 0).toFixed(4)),
        carpableArea: Number(pDb.reduce((s, r) => s + (Number(r.carpable) || 0), 0).toFixed(4)),
        distributedArea: Number(pDb.reduce((s, r) => s + (Number(r.distributedArea) || 0), 0).toFixed(4))
      };
    });

    const optoolSummary = {
      Database: dbRows.length,
      'CF(DOC)': this.getScopedOptoolTabRows('CF(DOC)', activeScope, dbLhidMap).length,
      Survey: this.getScopedOptoolTabRows('Survey', activeScope, dbLhidMap).length,
      MOV: this.getScopedOptoolTabRows('MOV', activeScope, dbLhidMap).length,
      RegistrationDistribution: this.getScopedOptoolTabRows(
        'RegistrationDistribution',
        activeScope,
        dbLhidMap
      ).length,
      Installation: this.getScopedOptoolTabRows('Installation', activeScope, dbLhidMap).length,
      Leasehold: this.getScopedOptoolTabRows('Leasehold', activeScope, dbLhidMap).length,
      totalArea: Number(dbRows.reduce((s, r) => s + (Number(r.totalArea) || 0), 0).toFixed(4)),
      totalComputedArea: Number(dbRows.reduce((s, r) => s + (Number(r.computedArea) || 0), 0).toFixed(4)),
      totalCarpableArea: Number(
        dbRows.reduce((s, r) => s + (Number(r.carpable) || 0), 0).toFixed(4)
      ),
      totalDistributedArea: Number(
        dbRows.reduce((s, r) => s + (Number(r.distributedArea) || 0), 0).toFixed(4)
      )
    };

    const { milestoneNepBreakdown, availableMilestoneYears } = this.computeMilestoneNepBreakdown({
      dbLhidMap,
      activeScope,
      milestoneYear
    });

    const normalizedNepSheet = normalizeNepProvinceList(this.state.nepProvinceList);
    const nepProvinceBreakdown = provincialNodes.map((node) => {
      const entry = normalizedNepSheet[node.code] || {
        lhs: 0,
        area: 0,
        arbs: 0,
        year: new Date().getFullYear()
      };
      return {
        code: node.code,
        jurisdiction: node.jurisdiction,
        provinceName: node.provinceName,
        lhs: entry.lhs,
        sem1Lhs: entry.sem1Lhs,
        sem2Lhs: entry.sem2Lhs,
        area: entry.area,
        sem1Area: entry.sem1Area,
        sem2Area: entry.sem2Area,
        arbs: entry.arbs,
        sem1Arbs: entry.sem1Arbs,
        sem2Arbs: entry.sem2Arbs,
        year: entry.year || new Date().getFullYear()
      };
    });
    const nepProvinceTotals = {
      lhs: nepProvinceBreakdown.reduce((s, r) => s + r.lhs, 0),
      sem1Lhs: nepProvinceBreakdown.reduce((s, r) => s + (r.sem1Lhs || 0), 0),
      sem2Lhs: nepProvinceBreakdown.reduce((s, r) => s + (r.sem2Lhs || 0), 0),
      area: Number(nepProvinceBreakdown.reduce((s, r) => s + r.area, 0).toFixed(4)),
      sem1Area: Number(nepProvinceBreakdown.reduce((s, r) => s + (r.sem1Area || 0), 0).toFixed(4)),
      sem2Area: Number(nepProvinceBreakdown.reduce((s, r) => s + (r.sem2Area || 0), 0).toFixed(4)),
      arbs: nepProvinceBreakdown.reduce((s, r) => s + r.arbs, 0),
      sem1Arbs: nepProvinceBreakdown.reduce((s, r) => s + (r.sem1Arbs || 0), 0),
      sem2Arbs: nepProvinceBreakdown.reduce((s, r) => s + (r.sem2Arbs || 0), 0)
    };

    return {
      activeMonth,
      incrementalTargetMonth: targetIncMonth,
      availableMonths,
      milestoneYear,
      availableMilestoneYears,
      milestoneNepBreakdown,
      nepProvinceBreakdown,
      nepProvinceTotals,
      nepMilestoneList: normalizeNepMilestoneList(this.state.nepMilestoneList),
      kpis: {
        cumulativeETitles,
        cumulativeAreaHas: Number(cumulativeAreaHas.toFixed(4)),
        incrementalETitles,
        incrementalAreaHas: Number(incrementalAreaHas.toFixed(4)),
        baselineTargetETitles,
        baselineTargetAreaHas: Number(baselineTargetAreaHas.toFixed(4)),
        eTitlesCompletionPct:
          baselineTargetETitles > 0
            ? Number(((cumulativeETitles / baselineTargetETitles) * 100).toFixed(2))
            : 0,
        areaCompletionPct:
          baselineTargetAreaHas > 0
            ? Number(((cumulativeAreaHas / baselineTargetAreaHas) * 100).toFixed(2))
            : 0,
        eTitlesVariance: cumulativeETitles - baselineTargetETitles,
        areaVarianceHas: Number((cumulativeAreaHas - baselineTargetAreaHas).toFixed(4))
      },
      provincialBreakdown,
      registeredSummary: this.getRegisteredSummaryByProvince(),
      databaseByProvince,
      monthlyTrend,
      stageBreakdown,
      batchBreakdown,
      optoolSummary
    };
  }

  /** Return the HMAC secret used to sign session cookies. */
  getAuthSecret() {
    return this.state.authSecret;
  }

  /** Check if an account email or user ID has been deleted (tombstoned). */
  isUserDeleted(email, id) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanId = String(id || '').trim();
    const deletedEmails = Array.isArray(this.state?.deletedUserEmails) ? this.state.deletedUserEmails : [];
    const deletedIds = Array.isArray(this.state?.deletedUserIds) ? this.state.deletedUserIds : [];
    if (cleanEmail && deletedEmails.includes(cleanEmail)) return true;
    if (cleanId && deletedIds.includes(cleanId)) return true;
    return false;
  }

  /** Clear tombstone for an account email and/or user ID when re-registering or actively approved/pending. */
  clearDeletedUserTombstone(email, id = null) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanId = String(id || '').trim();
    let changed = false;
    if (cleanEmail && Array.isArray(this.state?.deletedUserEmails)) {
      const beforeLen = this.state.deletedUserEmails.length;
      this.state.deletedUserEmails = this.state.deletedUserEmails.filter((e) => e !== cleanEmail);
      if (this.state.deletedUserEmails.length !== beforeLen) changed = true;
    }
    if (cleanId && Array.isArray(this.state?.deletedUserIds)) {
      const beforeLen = this.state.deletedUserIds.length;
      this.state.deletedUserIds = this.state.deletedUserIds.filter((i) => i !== cleanId);
      if (this.state.deletedUserIds.length !== beforeLen) changed = true;
    }
    return changed;
  }

  /** Record a tombstone for a deleted account email/id and purge from local state. */
  recordDeletedUserTombstone(id, email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanId = String(id || '').trim();
    if (!Array.isArray(this.state.deletedUserEmails)) this.state.deletedUserEmails = [];
    if (!Array.isArray(this.state.deletedUserIds)) this.state.deletedUserIds = [];
    let changed = false;
    if (cleanEmail && !this.state.deletedUserEmails.includes(cleanEmail)) {
      this.state.deletedUserEmails.push(cleanEmail);
      changed = true;
    }
    if (cleanId && !this.state.deletedUserIds.includes(cleanId)) {
      this.state.deletedUserIds.push(cleanId);
      changed = true;
    }
    const beforeLen = (this.state.users || []).length;
    this.state.users = (this.state.users || []).filter((u) => !this.isUserDeleted(u?.email, u?.id));
    if (this.state.users.length !== beforeLen) changed = true;
    if (changed) this.save();
  }

  /** Find a persisted user record by normalized email. */
  findUserByEmail(email) {
    const target = String(email || '').trim().toLowerCase();
    if (!target) return null;
    return (this.state.users || []).find(
      (u) => String(u.email || '').trim().toLowerCase() === target
    ) || null;
  }

  /** Find a persisted user record by ID or Email. */
  findUserById(id) {
    const target = String(id || '').trim();
    if (!target) return null;
    const targetLower = target.toLowerCase();
    return (
      (this.state.users || []).find(
        (u) =>
          u.id === target ||
          String(u.id || '').trim().toLowerCase() === targetLower ||
          String(u.email || '').trim().toLowerCase() === targetLower
      ) || null
    );
  }

  /** List sanitized public user records ordered with pending requests first. */
  listPublicUsers() {
    const rank = { pending: 0, approved: 1, rejected: 2 };
    return [...(this.state.users || [])]
      .sort((a, b) => {
        const ra = rank[a.status] ?? 9;
        const rb = rank[b.status] ?? 9;
        if (ra !== rb) return ra - rb;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      })
      .map((u) => toPublicUser(u));
  }

  /** Count accounts awaiting Administrator confirmation. */
  getPendingUserCount() {
    return (this.state.users || []).filter((u) => u.status === 'pending').length;
  }

  /** Issue a 6-digit email verification OTP for a pending registration. */
  issueSignupOtp(email, { bypassCooldown = false } = {}) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      const err = new Error('Please enter a valid Email address before requesting an OTP.');
      err.statusCode = 400;
      throw err;
    }
    if (this.findUserByEmail(cleanEmail)) {
      const err = new Error('An account with that email already exists.');
      err.statusCode = 409;
      throw err;
    }
    this.clearDeletedUserTombstone(cleanEmail);

    if (!this.state.pendingOtps || typeof this.state.pendingOtps !== 'object') {
      this.state.pendingOtps = {};
    }
    const now = Date.now();
    const existing = this.state.pendingOtps[cleanEmail];
    if (!bypassCooldown && existing?.sentAt && now - existing.sentAt < OTP_RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - existing.sentAt)) / 1000);
      const err = new Error(`Please wait ${waitSec}s before requesting another OTP code.`);
      err.statusCode = 429;
      err.retryAfterSeconds = waitSec;
      throw err;
    }

    const code = generateOtpCode();
    this.state.pendingOtps[cleanEmail] = {
      otpHash: hashOtpCode(cleanEmail, code, this.getAuthSecret()),
      expiresAt: now + OTP_TTL_MS,
      sentAt: now,
      attempts: 0
    };
    this.save();
    return {
      email: cleanEmail,
      code,
      expiresInMinutes: Math.round(OTP_TTL_MS / 60000),
      cooldownSeconds: Math.round(OTP_RESEND_COOLDOWN_MS / 1000)
    };
  }

  /** Verify and consume a 6-digit signup email OTP code. */
  verifyAndConsumeSignupOtp(email, otpCode) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(otpCode || '').trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      const err = new Error('Please enter the 6-digit Email OTP code.');
      err.statusCode = 400;
      throw err;
    }
    const entry = this.state.pendingOtps?.[cleanEmail];
    if (!entry) {
      const err = new Error('No active OTP found for this email. Click "Send OTP" first.');
      err.statusCode = 400;
      throw err;
    }
    if (Date.now() > Number(entry.expiresAt || 0)) {
      delete this.state.pendingOtps[cleanEmail];
      this.save();
      const err = new Error('Verification OTP has expired. Please request a new code.');
      err.statusCode = 400;
      throw err;
    }
    if ((entry.attempts || 0) >= 5) {
      delete this.state.pendingOtps[cleanEmail];
      this.save();
      const err = new Error('Too many incorrect OTP attempts. Please request a new OTP code.');
      err.statusCode = 429;
      throw err;
    }
    const ok = verifyOtpHash(cleanEmail, cleanCode, entry.otpHash, this.getAuthSecret());
    if (!ok) {
      entry.attempts = (entry.attempts || 0) + 1;
      this.save();
      const err = new Error('Invalid Email OTP code. Please double-check and try again.');
      err.statusCode = 400;
      throw err;
    }
    delete this.state.pendingOtps[cleanEmail];
    this.save();
    return true;
  }

  /** Alias for createPendingUser to support direct user registration across store callers and test harnesses. */
  registerUser(payload, options = {}) {
    const opts = typeof options === 'boolean' ? { requireOtp: options } : options;
    return this.createPendingUser(payload, opts);
  }

  /** Register a new account in pending status awaiting Admin confirmation after OTP verification. */
  createPendingUser({ name, email, province, contactNumber, password, otpCode }, options = {}) {
    const { requireOtp = true } = options;
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanProvince = String(province || '').trim();
    const cleanContact = String(contactNumber || '').trim();
    const rawPassword = String(password || '');

    if (!cleanName) throw new Error('Full Name is required.');
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('A valid Email address is required.');
    }
    if (!USER_PROVINCE_OPTIONS.includes(cleanProvince)) {
      throw new Error('Please select a valid Region VIII Province.');
    }
    if (!cleanContact || cleanContact.replace(/\D/g, '').length < 7) {
      throw new Error('A valid Contact Number is required.');
    }
    if (rawPassword.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
    if (this.findUserByEmail(cleanEmail)) {
      const err = new Error('An account with that email already exists.');
      err.statusCode = 409;
      throw err;
    }
    this.clearDeletedUserTombstone(cleanEmail);
    if (requireOtp) {
      this.verifyAndConsumeSignupOtp(cleanEmail, otpCode);
    }

    const now = new Date().toISOString();
    const record = {
      id: `usr-${crypto.randomBytes(6).toString('hex')}`,
      name: cleanName,
      email: cleanEmail,
      province: cleanProvince,
      contactNumber: cleanContact,
      passwordHash: hashPassword(rawPassword),
      emailVerified: Boolean(requireOtp),
      emailVerifiedAt: requireOtp ? now : null,
      role: 'user',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
      approvedBy: null
    };
    if (!Array.isArray(this.state.users)) {
      this.state.users = [];
    }
    this.state.users.push(record);
    this.save();
    return toPublicUser(record);
  }

  /** Verify credentials and ensure the account has been confirmed by an Administrator. */
  authenticateUser(email, password) {
    const user = this.findUserByEmail(email);
    if (!user) {
      if (this.isUserDeleted(email)) {
        const err = new Error(
          'This account was deactivated or deleted by an Administrator. Please register a new account or contact your Region VIII Administrator.'
        );
        err.statusCode = 403;
        err.code = 'ACCOUNT_DELETED';
        throw err;
      }
      const err = new Error('Invalid email or password.');
      err.statusCode = 401;
      throw err;
    }
    if (!verifyPassword(password, user.passwordHash)) {
      const err = new Error('Invalid email or password.');
      err.statusCode = 401;
      throw err;
    }
    if (user.status === 'pending') {
      const err = new Error(
        'Your account is awaiting Administrator confirmation. Please contact your Region VIII Admin to confirm your registration.'
      );
      err.statusCode = 403;
      err.code = 'ACCOUNT_PENDING';
      throw err;
    }
    if (user.status === 'rejected') {
      const err = new Error(
        'Your account registration was declined by an Administrator.'
      );
      err.statusCode = 403;
      err.code = 'ACCOUNT_REJECTED';
      throw err;
    }
    return toPublicUser(user);
  }

  /** Approve, reject, or update the role of a user account by an Administrator. */
  updateUserStatus(id, { status, role } = {}, actingAdmin = 'admin') {
    const user = this.findUserById(id);
    if (!user) {
      const err = new Error('Account not found.');
      err.statusCode = 404;
      throw err;
    }
    const nextStatus = status !== undefined ? String(status).trim().toLowerCase() : user.status;
    const nextRole = role !== undefined ? String(role).trim().toLowerCase() : user.role;
    if (!['pending', 'approved', 'rejected'].includes(nextStatus)) {
      throw new Error('Status must be pending, approved, or rejected.');
    }
    if (!['user', 'admin'].includes(nextRole)) {
      throw new Error('Role must be user or admin.');
    }
    if (actingAdmin && typeof actingAdmin === 'object' && actingAdmin.id === user.id) {
      if (nextStatus !== 'approved' || nextRole !== 'admin') {
        throw new Error('You cannot revoke your own active Administrator access.');
      }
    }

    const now = new Date().toISOString();
    user.status = nextStatus;
    user.role = nextRole;
    user.updatedAt = now;
    if (nextStatus === 'approved') {
      user.approvedAt = now;
      user.approvedBy =
        typeof actingAdmin === 'object' ? actingAdmin.email || actingAdmin.name : String(actingAdmin);
    }
    this.save();
    return toPublicUser(user);
  }

  /**
   * Merge user account rows fetched from the Regional Hub Google Sheet (`User_Accounts`)
   * into `this.state.users`, preserving scrypt password hashes and newer timestamps.
   */
  mergeUsersFromSheet(sheetUsers = []) {
    if (!Array.isArray(sheetUsers) || sheetUsers.length === 0) {
      return { added: 0, updated: 0, total: this.state.users.length };
    }
    let added = 0;
    let updated = 0;

    for (const raw of sheetUsers) {
      const cleanEmail = String(raw?.email || '').trim().toLowerCase();
      const cleanId = String(raw?.id || '').trim();
      if (!cleanEmail && !cleanId) continue;
      if (cleanId && Array.isArray(this.state?.deletedUserIds) && this.state.deletedUserIds.includes(cleanId)) {
        // A specific deleted account ID must never resurrect from sheet sync
        continue;
      }
      if (cleanEmail && Array.isArray(this.state?.deletedUserEmails) && this.state.deletedUserEmails.includes(cleanEmail)) {
        // If an approved account exists in Google Sheet with a non-deleted ID, clear the email tombstone
        if (raw.status === 'approved') {
          this.clearDeletedUserTombstone(cleanEmail);
        } else {
          continue;
        }
      }
      const finalId = cleanId || `usr-${crypto.randomBytes(6).toString('hex')}`;
      const existing =
        (this.state.users || []).find((u) => u.id === finalId) ||
        this.findUserByEmail(cleanEmail);

      if (!existing) {
        this.state.users.push({
          id: finalId,
          name: String(raw.name || cleanEmail).trim(),
          email: cleanEmail,
          province: String(raw.province || 'Region VIII Hub').trim(),
          contactNumber: String(raw.contactNumber || '').trim(),
          passwordHash: String(raw.passwordHash || '').trim(),
          emailVerified: Boolean(raw.emailVerified),
          emailVerifiedAt: raw.emailVerified ? raw.createdAt || new Date().toISOString() : null,
          role: String(raw.role || 'user').toLowerCase() === 'admin' ? 'admin' : 'user',
          status: ['pending', 'approved', 'rejected'].includes(String(raw.status || '').toLowerCase())
            ? String(raw.status).toLowerCase()
            : 'pending',
          createdAt: raw.createdAt || new Date().toISOString(),
          updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
          approvedAt: raw.approvedAt || null,
          approvedBy: raw.approvedBy || null
        });
        added += 1;
      } else {
        const sheetTs = Date.parse(raw.updatedAt || raw.createdAt || '') || 0;
        const localTs = Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
        if (sheetTs >= localTs) {
          if (raw.name) existing.name = String(raw.name).trim();
          if (raw.province) existing.province = String(raw.province).trim();
          if (raw.contactNumber !== undefined && String(raw.contactNumber).trim() !== '') {
            existing.contactNumber = String(raw.contactNumber).trim();
          }
          if (raw.passwordHash && String(raw.passwordHash).includes(':')) {
            existing.passwordHash = String(raw.passwordHash).trim();
          }
          if (raw.role && ['user', 'admin'].includes(String(raw.role).toLowerCase())) {
            existing.role = String(raw.role).toLowerCase();
          }
          if (raw.status && ['pending', 'approved', 'rejected'].includes(String(raw.status).toLowerCase())) {
            existing.status = String(raw.status).toLowerCase();
          }
          if (raw.updatedAt) existing.updatedAt = raw.updatedAt;
          if (raw.approvedAt !== undefined) existing.approvedAt = raw.approvedAt || null;
          if (raw.approvedBy !== undefined) existing.approvedBy = raw.approvedBy || null;
          updated += 1;
        }
      }
    }

    if (added > 0 || updated > 0) {
      this.save();
    }
    return { added, updated, total: this.state.users.length };
  }

  /**
   * Merge audit log entries fetched from the Regional Hub Google Sheet (`Audit_Logs`)
   * into `this.state.auditLogs`, de-duplicating by log.id and preserving newest first.
   */
  mergeAuditLogsFromSheet(sheetLogs = []) {
    if (!Array.isArray(sheetLogs) || sheetLogs.length === 0) {
      return { added: 0, total: (this.state.auditLogs || []).length };
    }
    if (!Array.isArray(this.state.auditLogs)) {
      this.state.auditLogs = [];
    }
    const existingIds = new Set(this.state.auditLogs.map((l) => l.id).filter(Boolean));
    let added = 0;
    for (const log of sheetLogs) {
      if (!log || !log.id) continue;
      if (!existingIds.has(log.id)) {
        this.state.auditLogs.push(log);
        existingIds.add(log.id);
        added += 1;
      }
    }
    this.state.auditLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (this.state.auditLogs.length > 2500) {
      this.state.auditLogs = this.state.auditLogs.slice(0, 2500);
    }
    if (added > 0) {
      this.save();
    }
    return { added, total: this.state.auditLogs.length };
  }

  /** Alias for deleteUserAccount to support deleteUser across store callers and test harnesses. */
  deleteUser(id, actingAdmin = null) {
    return this.deleteUserAccount(id, actingAdmin);
  }

  /** Permanently delete a user account while preventing self-delete or removing the last admin. */
  deleteUserAccount(id, actingAdmin = null) {
    const targetId = String(id || '').trim();
    const targetLower = targetId.toLowerCase();
    const idx = (this.state.users || []).findIndex(
      (u) =>
        u.id === targetId ||
        String(u.id || '').trim().toLowerCase() === targetLower ||
        String(u.email || '').trim().toLowerCase() === targetLower
    );
    if (idx < 0) {
      const err = new Error('Account not found.');
      err.statusCode = 404;
      throw err;
    }
    const target = this.state.users[idx];
    if (
      actingAdmin &&
      typeof actingAdmin === 'object' &&
      (actingAdmin.id === target.id ||
        String(actingAdmin.email || '').trim().toLowerCase() === String(target.email || '').trim().toLowerCase())
    ) {
      const err = new Error('You cannot delete your own active Administrator account.');
      err.statusCode = 400;
      throw err;
    }
    if (target.role === 'admin' && target.status === 'approved') {
      const otherAdmins = this.state.users.filter(
        (u) =>
          u.id !== target.id &&
          String(u.email || '').trim().toLowerCase() !== String(target.email || '').trim().toLowerCase() &&
          u.role === 'admin' &&
          u.status === 'approved'
      );
      if (otherAdmins.length === 0) {
        const err = new Error('Cannot delete the last active Administrator account.');
        err.statusCode = 400;
        throw err;
      }
    }
    const targetEmail = String(target.email || '').trim().toLowerCase();
    const targetIdClean = String(target.id || '').trim();
    if (!Array.isArray(this.state.deletedUserEmails)) this.state.deletedUserEmails = [];
    if (!Array.isArray(this.state.deletedUserIds)) this.state.deletedUserIds = [];
    if (targetEmail && !this.state.deletedUserEmails.includes(targetEmail)) {
      this.state.deletedUserEmails.push(targetEmail);
    }
    if (targetIdClean && !this.state.deletedUserIds.includes(targetIdClean)) {
      this.state.deletedUserIds.push(targetIdClean);
    }
    this.state.users.splice(idx, 1);
    this.save();
    return toPublicUser(target);
  }
}

export function getLeaseholdRowProvinceCode(row) {
  if (!row) return null;
  const provs = String(row.provs || row.PROVS || row.province || '').trim();
  if (PROVINCE_CODES.includes(provs.toUpperCase())) return provs.toUpperCase();
  const inferred = inferProvinceCodeFromText(provs);
  if (inferred) return inferred;
  const mun = String(row.mun || row.MUN || row.municipality || '').trim();
  if (mun) {
    const munInferred = inferProvinceCodeFromMunicipality(mun);
    if (munInferred) return munInferred;
  }
  return null;
}

