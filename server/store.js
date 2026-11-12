import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  REGIONAL_REGISTRY,
  PROVINCE_CODES,
  OPTOOL_SHEET_SCHEMAS,
  MILESTONE_STAGES,
  MILESTONE_TARGET_TABS,
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
    if (!Array.isArray(this.state.syncLogs)) this.state.syncLogs = [];
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

  upsertMilestone(payload) {
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
    this.save();
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

  upsertOptoolRow(tabName, rowPayload, index = null) {
    if (!OPTOOL_SHEET_SCHEMAS[tabName]) {
      throw new Error(`Unknown OPTool tab: ${tabName}`);
    }
    const schema = OPTOOL_SHEET_SCHEMAS[tabName];
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

    const linkedDbRow =
      tabName === 'RegistrationDistribution' || tabName === 'Installation'
        ? findLinkedDatabaseRow(this.state.optool.Database, cleanRow.lhid)
        : null;
    applyTabRowDefaults(tabName, cleanRow, linkedDbRow);

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
    this.save();
    return cleanRow;
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

  computeAnalytics(filters = {}) {
    const {
      province = 'ALL',
      periodMonth = 'LATEST',
      batch = 'ALL',
      stage = 'ALL'
    } = filters;

    const allMilestones = this.state.milestoneData.map((row) => {
      const provCode =
        PROVINCE_CODES.includes(row.Province_Code)
          ? row.Province_Code
          : inferProvinceCodeFromMunicipality(row.Municipality) ||
            inferProvinceCodeFromText(row.Record_ID) ||
            'LEY';
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

    // Discover available months sorted ascending
    const availableMonths = Array.from(
      new Set(allMilestones.map((m) => m.Month_Key).filter((m) => m !== 'Unknown'))
    ).sort();

    const activeMonth =
      periodMonth === 'LATEST'
        ? availableMonths[availableMonths.length - 1] || new Date().toISOString().slice(0, 7)
        : periodMonth;

    // Filter by province, batch, stage
    const scoped = allMilestones.filter((m) => {
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
    const provincialNodes = REGIONAL_REGISTRY.filter((n) => n.role === 'Provincial Node');
    const provincialBreakdown = provincialNodes.map((node) => {
      const code = node.code;
      const provCum = cumulativeRecords.filter((m) => m.Province_Code === code);
      const provInc = incrementalRecords.filter((m) => m.Province_Code === code);
      const base = this.state.baselines[code] || { targetETitles: 0, targetAreaHas: 0 };
      const cumTitles = provCum.length;
      const cumArea = sumArea(provCum);
      const incTitles = provInc.length;
      const incArea = sumArea(provInc);

      const matchesProv = (val) => inferProvinceCodeFromText(val) === code;

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
          Database: this.state.optool.Database.filter((r) => matchesProv(r.province)).length,
          RegistrationDistribution: this.state.optool.RegistrationDistribution.filter((r) =>
            matchesProv(r.province)
          ).length,
          Installation: this.state.optool.Installation.filter((r) => matchesProv(r.province)).length
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
    const dbRows = this.state.optool.Database.filter(
      (r) => province === 'ALL' || inferProvinceCodeFromText(r.province) === province
    );
    const dbLhids = new Set(
      dbRows.map((r) => String(r.lhid || '').trim().toLowerCase()).filter(Boolean)
    );
    const filterOptoolByProv = (rows, hasProvCol) => {
      if (province === 'ALL') return rows;
      return rows.filter((r) => {
        if (hasProvCol && r.province) return inferProvinceCodeFromText(r.province) === province;
        const lhidKey = String(r.lhid || '').trim().toLowerCase();
        return lhidKey && dbLhids.has(lhidKey);
      });
    };

    const databaseByProvince = provincialNodes.map((node) => {
      const pDb = this.state.optool.Database.filter(
        (r) => inferProvinceCodeFromText(r.province) === node.code
      );
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
      'CF(DOC)': filterOptoolByProv(this.state.optool['CF(DOC)'], false).length,
      Survey: filterOptoolByProv(this.state.optool.Survey, false).length,
      MOV: filterOptoolByProv(this.state.optool.MOV, false).length,
      RegistrationDistribution: filterOptoolByProv(this.state.optool.RegistrationDistribution, true).length,
      Installation: filterOptoolByProv(this.state.optool.Installation, true).length,
      totalArea: Number(dbRows.reduce((s, r) => s + (Number(r.totalArea) || 0), 0).toFixed(4)),
      totalComputedArea: Number(dbRows.reduce((s, r) => s + (Number(r.computedArea) || 0), 0).toFixed(4)),
      totalCarpableArea: Number(
        dbRows.reduce((s, r) => s + (Number(r.carpable) || 0), 0).toFixed(4)
      ),
      totalDistributedArea: Number(
        dbRows.reduce((s, r) => s + (Number(r.distributedArea) || 0), 0).toFixed(4)
      )
    };

    return {
      activeMonth,
      incrementalTargetMonth: targetIncMonth,
      availableMonths,
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
}

