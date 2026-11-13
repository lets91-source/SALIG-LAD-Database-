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
  inferProvinceCodeFromMunicipality,
  inferProvinceCodeFromText,
  formatArea4,
  normalizeChecklistValue
} from './schema.js';
import { createSeedState } from './seedData.js';
import {
  LEGACY_SURVEY_STATUS_LABELS,
  formatCurrentMonthYear,
  resolveSurveyCurrentStatus,
  resolveTargetFromDatabaseRow,
  resolveTotalArbsFromGenderCounts
} from '../public/reportingUtils.js';

function findLinkedDatabaseRow(dbRows, lhid) {
  const key = String(lhid ?? '').trim().toLowerCase();
  if (!key || !Array.isArray(dbRows)) return null;
  return dbRows.find((r) => String(r?.lhid ?? '').trim().toLowerCase() === key) || null;
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
  if (tabName === 'Survey') return applySurveyCurrentStatus(row);
  if (tabName === 'RegistrationDistribution') return applyRegistrationDistributionDefaults(row, dbRow);
  if (tabName === 'Installation') return applyTargetPeriodDefault(row, dbRow);
  return false;
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

const DATABASE_TO_TARGET_MAP = {
  'CF(DOC)': {
    lhid: 'lhid',
    target: (r) => resolveTargetFromDatabaseRow(r),
    reportedMonth: () => formatCurrentMonthYear()
  },
  Survey: {
    lhid: 'lhid',
    target: (r) => resolveTargetFromDatabaseRow(r),
    reportedMonth: () => formatCurrentMonthYear()
  },
  MOV: {
    lhid: 'lhid',
    target: (r) => resolveTargetFromDatabaseRow(r),
    reportedMonth: () => formatCurrentMonthYear()
  },
  RegistrationDistribution: {
    lhid: 'lhid',
    region: 'regionName',
    province: 'province',
    municipality: 'municipality',
    barangay: 'barangay',
    areaHas: (r) => r.carpable || r.computedArea || r.totalArea || '',
    moa: 'moa',
    rodTitleNo: 'titleNumber',
    target: (r) => resolveTargetFromDatabaseRow(r),
    monthReported: () => formatCurrentMonthYear()
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
    areaHas2: (r) => r.distributedArea || r.carpable || r.computedArea || '',
    target: (r) => resolveTargetFromDatabaseRow(r),
    monthReported: () => formatCurrentMonthYear()
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
function parseQuarterAndYear(raw) {
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

function resolveFirstDateQuarter(row, dateKeys) {
  for (const key of dateKeys) {
    const parsed = parseQuarterAndYear(row?.[key]);
    if (parsed) return parsed;
  }
  return null;
}

function getDbParcelArea(dbRow) {
  if (!dbRow) return 0;
  return (
    parseMetricNumber(dbRow.carpable) ||
    parseMetricNumber(dbRow.computedArea) ||
    parseMetricNumber(dbRow.totalArea) ||
    0
  );
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
      'currentDate',
      'aspDate',
      'dateAcceptedDenrSmd',
      'srTransmittedDenrSmdDate',
      'srAcceptedByDarro',
      'srForwardedToDarro',
      'finalizedSrDate',
      'fieldWorkCompletionDate',
      'fieldWorkStartDate',
      'dateRss'
    ],
    include: () => true,
    getCount: () => 1,
    getArea: (_r, db) => getDbParcelArea(db)
  },
  land_valuation: {
    tabName: 'MOV',
    dateKeys: ['reportedMonth', 'dateTransLbpAoc', 'dateOfMov', 'dateReceivedDarpo', 'ppuDate'],
    include: () => true,
    getCount: () => 1,
    getArea: (_r, db) => getDbParcelArea(db)
  },
  ep_cloa_registration: {
    tabName: 'RegistrationDistribution',
    dateKeys: ['dateRegistered', 'monthReported'],
    include: (r) =>
      String(r?.dateRegistered || '').trim() !== '' ||
      String(r?.rodTitleNo || '').trim() !== '' ||
      String(r?.dateOfDistribution || '').trim() === '',
    getCount: (r) => Math.max(1, Number.parseInt(r?.noOfTitles, 10) || 1),
    getArea: (r, db) => parseMetricNumber(r?.areaHas) || getDbParcelArea(db)
  },
  ep_cloa_distribution: {
    tabName: 'RegistrationDistribution',
    dateKeys: ['dateOfDistribution', 'monthReported'],
    include: (r) => String(r?.dateOfDistribution || '').trim() !== '',
    getCount: (r) => Math.max(1, Number.parseInt(r?.noOfTitles, 10) || 1),
    getArea: (r, db) => parseMetricNumber(r?.areaHas) || getDbParcelArea(db)
  },
  installation: {
    tabName: 'Installation',
    dateKeys: ['dateOfInstallation', 'monthReported', 'dateDistributed', 'dateRegistered'],
    include: (r) => !['no', 'false', '0'].includes(String(r?.installedStatus || '').trim().toLowerCase()),
    getCount: (r) => Math.max(1, Number.parseInt(r?.noOfTitles, 10) || 1),
    getArea: (r, db) =>
      parseMetricNumber(r?.areaHas2) || parseMetricNumber(r?.areaHas1) || getDbParcelArea(db)
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
    this.isVercelTmpFallback = !dataDir && Boolean(process.env.VERCEL);
    this.dataDir = dataDir || resolveDefaultDataDir();
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
    if (!Array.isArray(this.state.milestoneData)) this.state.milestoneData = [];
    if (!this.state.optool) this.state.optool = {};
    let dirty = false;
    const dbByLhid = new Map(
      (Array.isArray(this.state.optool.Database) ? this.state.optool.Database : [])
        .filter((r) => r?.lhid)
        .map((r) => [String(r.lhid).trim().toLowerCase(), r])
    );
    for (const tab of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
      if (!Array.isArray(this.state.optool[tab])) {
        this.state.optool[tab] = [];
        dirty = true;
      } else {
        const schemaCols = OPTOOL_SHEET_SCHEMAS[tab];
        for (const row of this.state.optool[tab]) {
          if (!row || typeof row !== 'object') continue;
          if (Object.prototype.hasOwnProperty.call(row, 'test')) {
            delete row.test;
            dirty = true;
          }
          if (tab === 'Survey' && Object.prototype.hasOwnProperty.call(row, 'srForwardedPreIvas')) {
            delete row.srForwardedPreIvas;
            dirty = true;
          }
          for (const col of schemaCols) {
            if (!Object.prototype.hasOwnProperty.call(row, col.key)) {
              row[col.key] = '';
              dirty = true;
            } else if (col.type === 'checkbox') {
              const normalized = normalizeChecklistValue(row[col.key]);
              if (row[col.key] !== normalized) {
                row[col.key] = normalized;
                dirty = true;
              }
            }
          }
          const linkedDbRow =
            tab === 'RegistrationDistribution' || tab === 'Installation'
              ? dbByLhid.get(String(row.lhid ?? '').trim().toLowerCase()) || null
              : null;
          if (applyTabRowDefaults(tab, row, linkedDbRow)) {
            dirty = true;
          }
        }
      }
    }
    if (!this.state.gasWebAppUrl && process.env.GAS_WEB_APP_URL) {
      this.state.gasWebAppUrl = String(process.env.GAS_WEB_APP_URL).trim();
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
    const schema = OPTOOL_SHEET_SCHEMAS[tabName];
    if (!schema) throw new Error(`Unknown OPTool tab: ${tabName}`);
    const cleanRow = {};
    for (const col of schema) {
      let val = rowPayload[col.key] ?? rowPayload[col.header] ?? '';
      if (col.type === 'decimal' && val !== '' && val !== null && val !== undefined) {
        const num = Number(val);
        val = Number.isFinite(num) ? num.toFixed(4) : String(val);
      } else if (col.type === 'checkbox') {
        val = normalizeChecklistValue(val);
      } else {
        val = String(val ?? '').trim();
      }
      cleanRow[col.key] = val;
    }
    const resolvedLinked =
      linkedDbRow ||
      (tabName === 'RegistrationDistribution' || tabName === 'Installation'
        ? findLinkedDatabaseRow(this.state.optool.Database, cleanRow.lhid)
        : null);
    applyTabRowDefaults(tabName, cleanRow, resolvedLinked);
    return cleanRow;
  }

  upsertOptoolRow(tabName, rowPayload, index = null, options = {}) {
    const { skipSave = false } = options;
    if (!OPTOOL_SHEET_SCHEMAS[tabName]) {
      throw new Error(`Unknown OPTool tab: ${tabName}`);
    }
    const cleanRow = this.normalizeOptoolRow(tabName, rowPayload);

    const rows = this.state.optool[tabName];
    if (index !== null && Number.isInteger(index) && index >= 0 && index < rows.length) {
      rows[index] = cleanRow;
    } else {
      const existingIdx =
        tabName === 'Database' && cleanRow.lhid
          ? rows.findIndex((r) => r.lhid && r.lhid === cleanRow.lhid)
          : rows.findIndex((r) => JSON.stringify(r) === JSON.stringify(cleanRow));
      if (existingIdx >= 0) {
        rows[existingIdx] = cleanRow;
      } else {
        rows.unshift(cleanRow);
      }
    }
    if (!skipSave) this.save();
    return cleanRow;
  }

  /** Bulk-upsert parsed Milestone_Data, OPTool tabs, and optional NEP province sheet using O(1) indexes and a single save. */
  importParsedDataset({ milestoneData = [], optool = {}, nepProvinceList = null } = {}, options = {}) {
    const { skipSave = false } = options;
    let importedCount = 0;

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
        if (!Array.isArray(incoming) || !OPTOOL_SHEET_SCHEMAS[tabName] || incoming.length === 0) {
          continue;
        }
        const targetRows = this.state.optool[tabName];
        const lhidMap = new Map();
        const jsonMap = new Map();
        targetRows.forEach((r, idx) => {
          if (tabName === 'Database' && r?.lhid) lhidMap.set(r.lhid, idx);
          jsonMap.set(JSON.stringify(r), idx);
        });
        const newPrepends = [];
        for (const rawRow of incoming) {
          const lhidKey = String(rawRow?.lhid || '').trim().toLowerCase();
          const linkedDb =
            tabName === 'RegistrationDistribution' || tabName === 'Installation'
              ? getDbByLhid().get(lhidKey) || null
              : null;
          const cleanRow = this.normalizeOptoolRow(tabName, rawRow, linkedDb);
          const jsonKey = JSON.stringify(cleanRow);
          if (tabName === 'Database' && cleanRow.lhid && lhidMap.has(cleanRow.lhid)) {
            targetRows[lhidMap.get(cleanRow.lhid)] = cleanRow;
          } else if (jsonMap.has(jsonKey)) {
            targetRows[jsonMap.get(jsonKey)] = cleanRow;
          } else {
            newPrepends.push(cleanRow);
            jsonMap.set(jsonKey, -1);
          }
          if (tabName === 'Database' && dbByLhid && cleanRow.lhid) {
            dbByLhid.set(cleanRow.lhid.trim().toLowerCase(), cleanRow);
          }
          importedCount++;
        }
        if (newPrepends.length > 0) {
          this.state.optool[tabName] = [...newPrepends.reverse(), ...targetRows];
        }
      }
    }

    if (nepProvinceList && typeof nepProvinceList === 'object') {
      const incomingNep = normalizeNepProvinceList(nepProvinceList);
      const mergedNep = normalizeNepProvinceList(this.state.nepProvinceList);
      for (const code of Object.keys(mergedNep)) {
        if (Object.prototype.hasOwnProperty.call(nepProvinceList, code)) {
          mergedNep[code] = incomingNep[code];
          importedCount++;
        }
      }
      this.state.nepProvinceList = normalizeNepProvinceList(mergedNep);
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
    const targetTab = String(dbRow?.milestoneTarget || '').trim();
    const fieldMap = DATABASE_TO_TARGET_MAP[targetTab];
    if (!fieldMap) return false;

    const lhidKey = String(dbRow.lhid || '').trim().toLowerCase();
    const targetRows = this.state.optool[targetTab] || [];
    if (lhidKey && targetRows.some((r) => String(r.lhid || '').trim().toLowerCase() === lhidKey)) {
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
    if (normalized !== '' && !MILESTONE_TARGET_TABS.includes(normalized)) {
      throw new Error(`Invalid Milestone Target: ${normalized}`);
    }

    const row = rows[index];
    row.milestoneTarget = normalized;
    const createdInTab = normalized ? this.syncDatabaseRowToTargetTab(row) : false;
    if (!createdInTab) {
      this.save();
    }
    return { row, targetTab: normalized, createdInTab };
  }

  getLandholding360(lhid) {
    const target = String(lhid || '').trim();
    const tabs = {};
    for (const tabName of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
      tabs[tabName] = this.state.optool[tabName].filter(
        (row) => String(row.lhid || '').trim().toLowerCase() === target.toLowerCase()
      );
    }
    const milestones = this.state.milestoneData.filter(
      (m) => String(m.LHID || '').trim().toLowerCase() === target.toLowerCase()
    );
    return { lhid: target, tabs, milestones };
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

  /** Map normalized LHID -> province code from the master OPTool Database tab. */
  buildDbLhidProvinceMap() {
    const map = new Map();
    for (const r of this.state.optool?.Database || []) {
      const lhidKey = String(r.lhid || '').trim().toLowerCase();
      if (!lhidKey) continue;
      const code =
        inferProvinceCodeFromText(r.province) ||
        inferProvinceCodeFromMunicipality(r.municipality) ||
        inferProvinceCodeFromText(r.lhid) ||
        null;
      if (code && !map.has(lhidKey)) {
        map.set(lhidKey, code);
      }
    }
    return map;
  }

  /** Resolve province code for any OPTool tab row via province, municipality, or Database LHID link. */
  getOptoolRowProvinceCode(tabName, row, dbLhidMap = null) {
    if (!row) return null;
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

  /** Return rows for a single OPTool tab filtered to `scopeCode` when provided. */
  getScopedOptoolTabRows(tabName, scopeCode, dbLhidMap = null) {
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
    const scopedBaselines = {};
    if (this.state.baselines?.[scopeCode]) {
      scopedBaselines[scopeCode] = this.state.baselines[scopeCode];
    }
    const scopedNepProvinceList = {};
    if (this.state.nepProvinceList?.[scopeCode]) {
      scopedNepProvinceList[scopeCode] = this.state.nepProvinceList[scopeCode];
    }
    const scopedNodeStatuses = {};
    if (this.state.nodeStatuses?.[scopeCode]) {
      scopedNodeStatuses[scopeCode] = this.state.nodeStatuses[scopeCode];
    }
    return {
      ...this.state,
      baselines: scopedBaselines,
      nepTargets: this.state.nepTargets,
      nepProvinceList: scopedNepProvinceList,
      nodeStatuses: scopedNodeStatuses,
      milestoneData: (this.state.milestoneData || []).filter(
        (m) => this.getMilestoneProvinceCode(m) === scopeCode
      ),
      optool: scopedOptool
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
  updateNepTargets(newNepTargets) {
    this.state.nepTargets = normalizeNepTargets(newNepTargets);
    this.save();
    return this.state.nepTargets;
  }

  /** Persist Regional Hub NEP Sheet per-province totals (LHS, AREA, ARBs). */
  updateNepProvinceList(raw = {}) {
    this.state.nepProvinceList = normalizeNepProvinceList(raw);
    this.save();
    return this.state.nepProvinceList;
  }

  resetToSample() {
    const currentUrl = this.state.gasWebAppUrl;
    const currentSnapshot = this.state.liveHubSnapshot;
    this.state = createSeedState();
    this.state.gasWebAppUrl = currentUrl;
    this.state.liveHubSnapshot = currentSnapshot;
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

  computeMilestoneNepBreakdown({ dbLhidMap, activeScope, milestoneYear = 'ALL' }) {
    const dbByLhid = new Map();
    for (const r of this.state.optool?.Database || []) {
      const key = String(r?.lhid || '').trim().toLowerCase();
      if (key && !dbByLhid.has(key)) dbByLhid.set(key, r);
    }

    const yearSet = new Set();
    const filterYear = milestoneYear && milestoneYear !== 'ALL' ? Number(milestoneYear) : null;
    const roundArea = (val) => Number((Number(val) || 0).toFixed(4));

    const rows = DASHBOARD_MILESTONES.map((meta) => {
      const spec = MILESTONE_ANALYTICS_SPECS[meta.key];
      const sourceRows = this.getScopedOptoolTabRows(spec.tabName, activeScope, dbLhidMap).filter(
        (r) => spec.include(r)
      );

      const q = {
        1: { count: 0, areaHas: 0 },
        2: { count: 0, areaHas: 0 },
        3: { count: 0, areaHas: 0 },
        4: { count: 0, areaHas: 0 },
        undated: { count: 0, areaHas: 0 }
      };

      for (const r of sourceRows) {
        const parsed = resolveFirstDateQuarter(r, spec.dateKeys);
        if (parsed?.year) yearSet.add(parsed.year);
        if (filterYear && parsed?.year !== filterYear) continue;

        const dbRow = dbByLhid.get(String(r?.lhid || '').trim().toLowerCase()) || null;
        const countVal = spec.getCount(r);
        const areaVal = spec.getArea(r, dbRow);
        const bucket = parsed?.quarter ? q[parsed.quarter] : q.undated;
        bucket.count += countVal;
        bucket.areaHas += areaVal;
      }

      const totalCount = q[1].count + q[2].count + q[3].count + q[4].count + q.undated.count;
      const totalArea = q[1].areaHas + q[2].areaHas + q[3].areaHas + q[4].areaHas + q.undated.areaHas;

      const regTarget = this.state.nepTargets?.[meta.key] || {};
      const nepTargetCount = Number(regTarget.targetCount) || 0;
      const nepTargetAreaHas = Number(regTarget.targetAreaHas) || 0;

      return {
        key: meta.key,
        label: meta.label,
        sourceTab: spec.tabName,
        nepTargetCount,
        nepTargetAreaHas: roundArea(nepTargetAreaHas),
        q1: { count: q[1].count, areaHas: roundArea(q[1].areaHas) },
        q2: { count: q[2].count, areaHas: roundArea(q[2].areaHas) },
        q3: { count: q[3].count, areaHas: roundArea(q[3].areaHas) },
        q4: { count: q[4].count, areaHas: roundArea(q[4].areaHas) },
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
      availableMilestoneYears: Array.from(yearSet).sort((a, b) => a - b)
    };
  }

  computeAnalytics(filters = {}) {
    const {
      province = 'ALL',
      periodMonth = 'LATEST',
      batch = 'ALL',
      stage = 'ALL',
      milestoneYear = 'ALL',
      restrictToProvince = false
    } = filters;

    const allMilestones = this.state.milestoneData.map((row) => {
      const provCode =
        this.getMilestoneProvinceCode(row) || 'LEY';
      const monthKey = /^\d{4}-\d{2}/.test(String(row.Milestone_Date || ''))
        ? String(row.Milestone_Date).slice(0, 7)
        : 'Unknown';
      return {
        ...row,
        Province_Code: provCode,
        Month_Key: monthKey,
        Area_Num: Number(row.Area_HAS) || 0
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
          Installation: this.getScopedOptoolTabRows('Installation', code, dbLhidMap).length
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
        area: entry.area,
        arbs: entry.arbs,
        year: entry.year || new Date().getFullYear()
      };
    });
    const nepProvinceTotals = {
      lhs: nepProvinceBreakdown.reduce((s, r) => s + r.lhs, 0),
      area: Number(nepProvinceBreakdown.reduce((s, r) => s + r.area, 0).toFixed(4)),
      arbs: nepProvinceBreakdown.reduce((s, r) => s + r.arbs, 0)
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

  /** Find a persisted user record by normalized email. */
  findUserByEmail(email) {
    const target = String(email || '').trim().toLowerCase();
    if (!target) return null;
    return (this.state.users || []).find(
      (u) => String(u.email || '').trim().toLowerCase() === target
    ) || null;
  }

  /** Find a persisted user record by ID. */
  findUserById(id) {
    const target = String(id || '').trim();
    if (!target) return null;
    return (this.state.users || []).find((u) => u.id === target) || null;
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
    this.state.users.push(record);
    this.save();
    return toPublicUser(record);
  }

  /** Verify credentials and ensure the account has been confirmed by an Administrator. */
  authenticateUser(email, password) {
    const user = this.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
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
      if (!cleanEmail) continue;
      const cleanId = String(raw?.id || '').trim() || `usr-${crypto.randomBytes(6).toString('hex')}`;
      const existing =
        (this.state.users || []).find((u) => u.id === cleanId) ||
        this.findUserByEmail(cleanEmail);

      if (!existing) {
        this.state.users.push({
          id: cleanId,
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

  /** Permanently delete a user account while preventing self-delete or removing the last admin. */
  deleteUserAccount(id, actingAdmin = null) {
    const targetId = String(id || '').trim();
    const idx = (this.state.users || []).findIndex((u) => u.id === targetId);
    if (idx < 0) {
      const err = new Error('Account not found.');
      err.statusCode = 404;
      throw err;
    }
    const target = this.state.users[idx];
    if (actingAdmin && typeof actingAdmin === 'object' && actingAdmin.id === target.id) {
      const err = new Error('You cannot delete your own active Administrator account.');
      err.statusCode = 400;
      throw err;
    }
    if (target.role === 'admin' && target.status === 'approved') {
      const otherAdmins = this.state.users.filter(
        (u) => u.id !== target.id && u.role === 'admin' && u.status === 'approved'
      );
      if (otherAdmins.length === 0) {
        const err = new Error('Cannot delete the last active Administrator account.');
        err.statusCode = 400;
        throw err;
      }
    }
    this.state.users.splice(idx, 1);
    this.save();
    return toPublicUser(target);
  }
}

