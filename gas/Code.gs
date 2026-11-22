/**
 * ============================================================================
 * DAR REGION VIII — SPLIT MILESTONE MONITORING SYSTEM & OPTOOL HUB
 * Google Apps Script (GAS) Automated ETL Pipeline + Hosted Web Application
 * ============================================================================
 * Deployment Steps in Regional Account (Hub) Google Sheet:
 *   1. Open Extensions -> Apps Script
 *   2. Paste this file into Code.gs
 *   3. Create an HTML file named "Index" (Index.html) and paste gas/Index.html
 *   4. Click Deploy -> New deployment -> Web app
 *      - Execute as: Me (ltsdarregion08@gmail.com — Regional Hub Account)
 *      - Who has access: Anyone (or Anyone with the link)
 *   5. Authorize permissions when prompted for Google Drive and Google Sheets.
 *   6. Open the deployed /exec URL in your browser OR paste it into the local
 *      Node.js Hub's "Google Sheets & GAS ETL" tab for two-way sync.
 * ============================================================================
 */

const REGIONAL_OWNER_EMAIL = 'ltsdarregion08@gmail.com';
const HUB_SPREADSHEET_ID = '1jTVJSQlUcWyZFxm6Pxqj9L62q9NtLyhUy1ifYqqb0Lw';
const REGIONAL_DRIVE_FOLDER_ID = '1z7SycuDvk9M5pPDZ2IvhwebQDsGHOhsJ';

const PROVINCE_DRIVE_CONFIGS = [
  { code: 'BIL', name: 'BILIRAN' },
  { code: 'ESA', name: 'EASTERN SAMAR' },
  { code: 'LEY', name: 'LEYTE' },
  { code: 'NSA', name: 'NORTHERN SAMAR' },
  { code: 'SAM', name: 'SAMAR' },
  { code: 'SLE', name: 'SOUTHERN LEYTE' }
];

const MILESTONE_DRIVE_FOLDERS = [
  'CF(DOC)',
  'Survey',
  'MOV',
  'RegistrationDistribution',
  'Installation',
  'Leasehold'
];

const PROVINCIAL_NODES = [
  { code: 'BIL', name: 'Biliran Province', id: '1MoHaQxhcCqXpMRAEUfLEBkXAgWfWRQxCZpJrjXDE-kk' },
  { code: 'ESA', name: 'Eastern Samar', id: '1RvpxOHrZQRKn-0gwnkIo5aLYP74TaO6d_GVIEVmjmcE' },
  { code: 'LEY', name: 'Leyte', id: '1gmHmA8FxFbGCO9hFXxsVn1n8WEwYeywFy8WmsIfUawQ' },
  { code: 'NSA', name: 'Northern Samar', id: '1d5xywDNJxYTEZNtwtAQjTo35eucrMlaVI10LOZ3rfd8' },
  { code: 'SAM', name: 'Samar (Western Samar)', id: '1cHhfvsVhTBKi_QuU6H2oiHfS1qiQqDFEh5ZJcOBpPYQ' },
  { code: 'SLE', name: 'Southern Leyte', id: '1joqlZK0VkFk-tUJnlwIebIa3vknh5fThcfZC6Yb7I8E' }
];

const MILESTONE_HEADERS = [
  'Record_ID',
  'Province_Code',
  'Municipality',
  'Land_Allocation_ID',
  'eTitle_No',
  'Area_HAS',
  'Milestone_Stage',
  'Milestone_Date',
  'Batch_Category',
  'LHID'
];

const USER_ACCOUNTS_HEADERS = [
  'User_ID',
  'Full_Name',
  'Email',
  'Province',
  'Contact_Number',
  'Role',
  'Status',
  'Email_Verified',
  'Password_Hash',
  'Created_At',
  'Updated_At',
  'Approved_At',
  'Approved_By'
];

const NEP_SHEET_HEADERS = ['Province_Code', 'Province', 'LHS', 'AREA', 'ARBs', 'Year', 'Milestone'];

const WORKABILITY_OPTIONS = ['Workable', 'For Replacement', 'Replacement'];
const LAD_STATUS_OPTIONS = ['LAD Balance', 'Temp. Park', 'For Inclusion'];

const OPTOOL_TABS = [
  'Database',
  'CF(DOC)',
  'Survey',
  'MOV',
  'RegistrationDistribution',
  'Installation',
  'Leasehold'
];

const OPTOOL_SCHEMA_HEADERS = {
  Database: [
    'LHID', 'Title Number', 'Land Owner', 'MOA', 'Phase',
    'RegionName', 'Province', 'Municipality', 'Barangay',
    'SurveyStatus', 'TargetYear', 'PipelineYear', 'problematic',
    'Total Area', 'ComputedArea', 'DistributedArea', 'SurveyNumber', 'LotNumber', 'Sub Lot Number',
    'CARPable', 'NONCARPable', 'Optool Status', 'CurrentStatusDesc',
    'NewLandSize', 'Lad Status', 'Workability', 'Milestone Target', 'Year'
  ],
  'CF(DOC)': [
    'LHID', 'DENR Certification', 'ASP',
    'MARPO Cert.', 'FIR Carper LAD Form 46',
    'Copy of the AdvSP',
    'Carper LAD No. 37/oathe of ARB', 'Carper LAD Form 42',
    'Upload Certificate of Titles', 'Upload Tax Declaration',
    'Upload CARPER LAD Form 1 & 2', 'Upload CARPER LAD Form 3',
    'Upload Land Use per FI', 'Upload CARPER LAD Form 46',
    'DATE FI CONDUCTED', 'DATE PREPARED & SIGNED',
    'TARGET\n (Current/ Previous)', 'Reported Month',
    'LHs (Needing/Not Needing Survey)',
    'REMARKS', 'Target Year'
  ],
  Survey: [
    'LHID', 'Kind of Survey', 'Date RSS', 'Field Work Start Date',
    'Field Work Completion Date', 'Finalized Survey Return \nDate',
    'SR Forwarded to DARRO', 'SR Accepted by DARRO', 'Plan\n(With/Out)',
    'Field Notes W/Cover\n(With/Out)', 'Traverse Computation\n(With/Out)',
    'Lot Data Computation\n(With/Out)', 'DLSD File',
    'Transmittal of Survey Returned PDF File\n(With/Out)',
    'Reference Boundary Computation\n(With/Out)', 'Notice of Coverage\n(With/Out)',
    'Tax Declaration\n(With/Out)', 'Certified Copy of Title\n(With/Out)',
    'MARPO Certification', 'Survey Authority\nIF APPLICABLE',
    'CENRO Certification\nIF APPLICABLE', 'Order of Cancellation\nIF APPLICABLE \n',
    'Order of Correction\nIF APPLICABLE', 'Remarks\n(SR Returned by DARRO to DARPO',
    'Survey Returns Returned DARRO to DARPO\nDATE',
    'Sruvey Returns Re-Submitted to DARRO\nDATE',
    'Surver Returns Trasmitted to DENR-SMD DATE', 'Transaction Number',
    'Date Accepted by DENR-SMD\nDATE', 'With Submitted DLSD',
    'SR Returned by DENR-SMD to DARRO\nDATE',
    'SR Returned DENR-SMD -> DARRO - DARPO',
    'Remarks\n(Returned SRs from DENR)',
    'SR Returned by DARPO to DARRO\nDATE',
    'DARRO Re-submitted survey to DENR-SMD\nDATE',
    'ASP Date', 'ASP No.', 'Received By',
    'TARGET\n (Current/ Previous)', 'Reported Month', 'PDF File',
    'Current Status', 'Current Date', 'Target Year'
  ],
  MOV: [
    'LHID', 'PPU Date', 'PPU Review Result\n(PASSED/FAILED)',
    'Date Received at DARPO', 'Compensation Amount', 'Date of MOV',
    'Lot Number', 'Sub Lot Number',
    'Date Trans to LBP/AOC', 'LBP Claim Number', 'AOC Number',
    'TARGET\n (Current/ Previous)', 'Reported Month', 'PDF File', 'Target Year'
  ],
  RegistrationDistribution: [
    'LHID/ Sequence No.', 'Origin/\nSource:\n(New Land, REDOC & DNYD)',
    'CLOA TYPE (EP/CLOA OR COLLECTIVE)', 'REGION', 'PROVINCE',
    'MUNICIPALITY', 'BARANGAY', 'NAME OF ARB (LN, FN, MI)',
    'EP or CLOA \nSERIAL No.', 'AREA\n(HAs)', 'MOA', 'ROD TITLE NO.',
    'DATE REGISTERED', 'DATE OF DISTRIBUTION (mm/dd/yyyy)',
    'Total Number of ARB', 'Male', 'Female', 'NO. OF TITLES',
    'TARGET YEAR\n (Current/ Previous)', 'MONTH REPORTED', 'REMARKS', 'PDF File', 'Target Year'
  ],
  Installation: [
    'LHID \n (From OPTool, \n if New Land)', 'REGION', 'PROVINCE',
    'MUNICIPALITY', 'BARANGAY', 'LAST NAME', 'FIRST NAME', 'MIDDLE NAME',
    'TITLE NO. OR TAX DEC. NO.', 'LOT No.', 'AREA (Has.)',
    'LAST NAME', 'FIRST NAME', 'MIDDLE NAME', 'GENDER (M/F)',
    'ROD TITLE No.', 'EP OR CLOA \n SERIAL No.', 'SURVEY No.', 'LOT No.2',
    'AREA\n (HAs) 2', 'DATE REGISTERED', 'DATE DISTRIBUTED',
    'DATE OF INSTALLATION (mm/dd/yyyy)', 'REMARKS (Installed - Yes/No)',
    'No. OF ARBs', 'No. OF TITLES', 'REMARKS', 'YEAR ACCOMP',
    'TARGET YEAR\n (Current/ Previous)', 'MONTH REPORTED', 'PDF File', 'Target Year'
  ],
  Leasehold: [
    'REG',
    'PROVS',
    'MUN',
    'BRGY',
    'LO SURNAME',
    'LO FIRSTNAME',
    'LO MI',
    'TITLE NO.',
    'TAX DEC NO.',
    'SURVEY NO.',
    'LOT NO.',
    'AREA PER TITLE (Has)',
    'AREA TENANTED (Has)',
    'WITHIN RETAINED AREA (Y,N)',
    'LEASEHOLDER SURNAME',
    'LEASEHOLDER FIRSTNAME',
    'LEASEHOLDER MI',
    'TENANT/LESSEE STATUS (alive, deceased)',
    'NEW LESSEE NAME (for deceased Tenant/Lessee) _Surname, First Name, MI',
    'RELATIONSHIP TO TENANT/LESSEE (relationship to original leaseholder)',
    'GENDER (M, F)',
    'Number of ARBs',
    'MAIN CROPS',
    'AUXILLIARY CROPS',
    'SHARING ARRANGEMENT',
    'TENURIAL ARRANGEMENT',
    'STATUS OF CONTRACT (New, Amended, Renewal)',
    '*DATE CONTRACT REGISTERED (mm/dd/yyyy)',
    '*DATE PLR REGISTERED (mm/dd/yyyy)',
    'LEASE RENTAL UNIT',
    'LEASE IN PESOS',
    'TARGET YEAR',
    'Report Month (Words)',
    'REMARKS'
  ]
};

const DEFAULT_BASELINES = {
  BIL: { targetETitles: 180, targetAreaHas: 245.5 },
  ESA: { targetETitles: 320, targetAreaHas: 512.75 },
  LEY: { targetETitles: 650, targetAreaHas: 980.0 },
  NSA: { targetETitles: 390, targetAreaHas: 640.25 },
  SAM: { targetETitles: 440, targetAreaHas: 715.8 },
  SLE: { targetETitles: 260, targetAreaHas: 385.4 }
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SPLIT Region VIII Hub')
    .addItem('Run Regional ETL Consolidation Now', 'runRegionalETL')
    .addItem('Sync SALIG Column Headers Across Sheets', 'syncAllSheetHeaders')
    .addItem('Apply Workability & LAD Dropdowns Across Sheets', 'applyDatabaseValidationAcrossSheets')
    .addItem('Initialize Milestone_Data, NEP, Baselines & User_Accounts Tabs', 'initializeHubTabs')
    .addItem('Create / Sync NEP Sheet (LHS, AREA, ARBs)', 'initializeNepSheet')
    .addItem('Setup Google Drive Milestone Folders', 'menuSetupDriveFolders')
    .addItem('Install Hourly Auto-Sync Trigger', 'installHourlyTrigger')
    .addToUi();
}

function initializeHubTabs() {
  ensureMilestoneSheet_();
  ensureNepSheet_();
  ensureBaselineSheet_();
  ensureUserAccountsSheet_();
}

function initializeNepSheet() {
  return ensureNepSheet_();
}

/** Ensure the NEP tab exists in the Regional Hub with per-province LHS, AREA, and ARBs. */
function ensureNepSheet_() {
  const hub = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  let sheet = hub.getSheetByName('NEP');
  const isNew = !sheet;
  if (!sheet) {
    sheet = hub.insertSheet('NEP');
  }
  sheet.getRange(1, 1, 1, NEP_SHEET_HEADERS.length).setValues([NEP_SHEET_HEADERS]);
  sheet
    .getRange(1, 1, 1, NEP_SHEET_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#14532D')
    .setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);

  if (isNew || sheet.getLastRow() < PROVINCIAL_NODES.length + 1) {
    const currentYear = new Date().getFullYear();
    const rows = PROVINCIAL_NODES.map(function (n) {
      return [n.code, n.name, 0, 0, 0, currentYear, 'overall'];
    });
    sheet.getRange(2, 1, rows.length, NEP_SHEET_HEADERS.length).setValues(rows);
    sheet
      .getRange(PROVINCIAL_NODES.length + 2, 1, 1, NEP_SHEET_HEADERS.length)
      .setValues([['TOTAL', 'Region VIII Total', '=SUM(C2:C7)', '=SUM(D2:D7)', '=SUM(E2:E7)', '-', '-']]);
    formatNepSheetRanges_(sheet);
  }
  return sheet;
}

function formatNepSheetRanges_(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), PROVINCIAL_NODES.length + 2);
  sheet.getRange(2, 3, lastRow - 1, 1).setNumberFormat('#,##0');
  sheet.getRange(2, 4, lastRow - 1, 1).setNumberFormat('#,##0.0000');
  sheet.getRange(2, 5, lastRow - 1, 1).setNumberFormat('#,##0');
  sheet.getRange(2, 6, lastRow - 1, 1).setNumberFormat('0');
  sheet
    .getRange(PROVINCIAL_NODES.length + 2, 1, 1, NEP_SHEET_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#ECFDF5');
}

function ensureMilestoneSheet_() {
  const hub = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  let sheet = hub.getSheetByName('Milestone_Data');
  if (!sheet) {
    sheet = hub.insertSheet('Milestone_Data');
    sheet.getRange(1, 1, 1, MILESTONE_HEADERS.length).setValues([MILESTONE_HEADERS]);
    sheet
      .getRange(1, 1, 1, MILESTONE_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#14532D')
      .setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  }
  return sheet;
}

function ensureBaselineSheet_() {
  const hub = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  let sheet = hub.getSheetByName('Regional_Baselines');
  if (!sheet) {
    sheet = hub.insertSheet('Regional_Baselines');
    sheet.getRange(1, 1, 1, 4).setValues([['Province_Code', 'Jurisdiction', 'Target_eTitles', 'Target_Area_HAS']]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#064E3B').setFontColor('#FFFFFF');
    const rows = PROVINCIAL_NODES.map(function (n) {
      const b = DEFAULT_BASELINES[n.code];
      return [n.code, n.name, b.targetETitles, b.targetAreaHas];
    });
    sheet.getRange(2, 1, rows.length, 4).setValues(rows);
    sheet.getRange(2, 4, rows.length, 1).setNumberFormat('0.0000');
    sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  }
  return sheet;
}

/**
 * Core ETL Pipeline: Extract provincial ledgers -> Transform (4-dec Area, ISO Date, Auto Record_ID)
 * -> Load consolidated records into Regional Account Hub.
 */
function runRegionalETL() {
  const hub = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  const milestoneSheet = ensureMilestoneSheet_();
  ensureBaselineSheet_();

  const consolidatedMilestones = new Map();
  const consolidatedOptool = {};
  OPTOOL_TABS.forEach(function (t) {
    consolidatedOptool[t] = [];
  });

  const syncLogs = [];

  PROVINCIAL_NODES.forEach(function (node) {
    try {
      const ss = SpreadsheetApp.openById(node.id);

      // 1. Extract Milestone_Data if present
      const msTab = ss.getSheetByName('Milestone_Data');
      let msCount = 0;
      if (msTab && msTab.getLastRow() > 1) {
        const values = msTab.getDataRange().getValues();
        const headers = values[0].map(function (h) {
          return String(h).trim();
        });
        for (let r = 1; r < values.length; r++) {
          const row = values[r];
          if (row.every(function (v) { return String(v).trim() === ''; })) continue;
          const obj = {};
          headers.forEach(function (h, idx) {
            obj[h] = row[idx];
          });
          const rawDate =
            obj.Milestone_Date instanceof Date
              ? Utilities.formatDate(obj.Milestone_Date, 'Asia/Manila', 'yyyy-MM-dd')
              : String(obj.Milestone_Date || '').trim();
          const ym = /^\d{4}-\d{2}/.test(rawDate)
            ? rawDate.slice(0, 7).replace('-', '')
            : Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyyMM');
          const recId =
            String(obj.Record_ID || '').trim() ||
            node.code + '-' + ym + '-' + String(r).padStart(4, '0');
          const areaNum = Number(obj.Area_HAS) || 0;

          consolidatedMilestones.set(recId, [
            recId,
            String(obj.Province_Code || node.code).trim(),
            String(obj.Municipality || '').trim(),
            String(obj.Land_Allocation_ID || '').trim(),
            String(obj.eTitle_No || '').trim(),
            Number(areaNum.toFixed(4)),
            String(obj.Milestone_Stage || '').trim(),
            rawDate,
            String(obj.Batch_Category || '').trim(),
            String(obj.LHID || '').trim()
          ]);
          msCount++;
        }
      }

      // 1b. Also extract Registered Data from Registration/Distribution tab (Column M Date Registered, Column J AREA (HAs))
      const regTab = findOptoolSheet_(ss, 'RegistrationDistribution');
      if (regTab && regTab.getLastRow() > 1) {
        const regValues = regTab.getDataRange().getValues();
        const regHeaders = regValues[0].map(function (h) { return String(h).trim(); });

        let areaColIdx = 9; // Column J (0-based 9)
        let dateRegColIdx = 12; // Column M (0-based 12)
        let lhidColIdx = 0; // Column A (0-based 0)
        let muniColIdx = 5; // Column F (0-based 5)
        let titleColIdx = 11; // Column L (0-based 11)
        let targetColIdx = 18; // Column S (0-based 18)

        regHeaders.forEach(function (h, idx) {
          const norm = normalizeHeaderKey_(h);
          if (norm.indexOf('areaha') >= 0 || norm === 'areahas' || norm === 'area') areaColIdx = idx;
          if (norm.indexOf('datereg') >= 0 || norm === 'dateregistered') dateRegColIdx = idx;
          if (norm.indexOf('lhid') >= 0) lhidColIdx = idx;
          if (norm === 'municipality') muniColIdx = idx;
          if (norm.indexOf('rodtitle') >= 0 || norm.indexOf('titleno') >= 0) titleColIdx = idx;
          if (norm.indexOf('targetyear') >= 0 || norm === 'target') targetColIdx = idx;
        });

        for (let r = 1; r < regValues.length; r++) {
          const row = regValues[r];
          if (row.every(function (v) { return String(v).trim() === ''; })) continue;

          const rawDateReg = row[dateRegColIdx];
          const dateRegStr = rawDateReg instanceof Date
            ? Utilities.formatDate(rawDateReg, 'Asia/Manila', 'yyyy-MM-dd')
            : String(rawDateReg || '').trim();

          if (!dateRegStr || dateRegStr === '-' || dateRegStr === 'N/A') continue;

          const rawArea = row[areaColIdx];
          const areaNum = typeof rawArea === 'number'
            ? rawArea
            : (parseFloat(String(rawArea || '').replace(/,/g, '')) || 0);

          const rawLhid = String(row[lhidColIdx] || '').trim();
          const cleanLhid = formatLhidString_(rawLhid);
          const rodTitle = String(row[titleColIdx] || '').trim();
          const muni = String(row[muniColIdx] || '').trim();
          const targetYr = String(row[targetColIdx] || 'ADMIN BATCH 1').trim();

          const ym = /^\d{4}-\d{2}/.test(dateRegStr)
            ? dateRegStr.slice(0, 7).replace('-', '')
            : Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyyMM');
          const recId = node.code + '-REG-' + (cleanLhid || ym + '-' + String(r).padStart(4, '0'));

          consolidatedMilestones.set(recId, [
            recId,
            node.code,
            muni,
            cleanLhid,
            rodTitle,
            Number(areaNum.toFixed(4)),
            'eTitle Registered',
            dateRegStr,
            targetYr,
            cleanLhid
          ]);
          msCount++;
        }
      }

      // 2. Extract OPTool standardized tabs
      let optoolCount = 0;
      OPTOOL_TABS.forEach(function (tabName) {
        const tab = ss.getSheetByName(tabName);
        if (!tab || tab.getLastRow() <= 1) return;
        const data = tab.getDataRange().getValues();
        for (let r = 1; r < data.length; r++) {
          if (data[r].some(function (c) { return String(c).trim() !== ''; })) {
            consolidatedOptool[tabName].push(data[r]);
            optoolCount++;
          }
        }
      });

      syncLogs.push([new Date(), node.code, node.name, 'SUCCESS', msCount, optoolCount, 'OK']);
    } catch (err) {
      syncLogs.push([new Date(), node.code, node.name, 'ERROR', 0, 0, err.message]);
    }
  });

  // Load Milestone_Data into Regional Hub
  if (consolidatedMilestones.size > 0) {
    const outRows = Array.from(consolidatedMilestones.values());
    if (milestoneSheet.getLastRow() > 1) {
      milestoneSheet
        .getRange(2, 1, milestoneSheet.getLastRow() - 1, MILESTONE_HEADERS.length)
        .clearContent();
    }
    milestoneSheet.getRange(2, 1, outRows.length, MILESTONE_HEADERS.length).setValues(outRows);
    milestoneSheet.getRange(2, 6, outRows.length, 1).setNumberFormat('0.0000');
  }

  // Load OPTool tabs into Regional Hub
  OPTOOL_TABS.forEach(function (tabName) {
    const rows = consolidatedOptool[tabName];
    const targetSheet = hub.getSheetByName(tabName);
    if (!targetSheet || rows.length === 0) return;
    const width = targetSheet.getLastColumn();
    if (targetSheet.getLastRow() > 1) {
      targetSheet.getRange(2, 1, targetSheet.getLastRow() - 1, width).clearContent();
    }
    const normalized = rows.map(function (r) {
      const padded = r.slice(0, width);
      while (padded.length < width) padded.push('');
      return padded;
    });
    targetSheet.getRange(2, 1, normalized.length, width).setValues(normalized);
  });

  // Write ETL_Sync_Log
  let logSheet = hub.getSheetByName('ETL_Sync_Log');
  if (!logSheet) {
    logSheet = hub.insertSheet('ETL_Sync_Log');
    logSheet
      .getRange(1, 1, 1, 7)
      .setValues([['Timestamp', 'Code', 'Province', 'Status', 'Milestone Rows', 'OPTool Rows', 'Message']]);
    logSheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#1E3A8A').setFontColor('#FFFFFF');
  }
  if (syncLogs.length > 0) {
    logSheet.getRange(logSheet.getLastRow() + 1, 1, syncLogs.length, 7).setValues(syncLogs);
  }

  return {
    syncedAt: new Date().toISOString(),
    milestones: consolidatedMilestones.size,
    logs: syncLogs.map(function (l) {
      return {
        timestamp: l[0] instanceof Date ? l[0].toISOString() : String(l[0]),
        code: l[1],
        province: l[2],
        status: l[3],
        milestoneRows: l[4],
        optoolRows: l[5],
        message: l[6]
      };
    })
  };
}

function installHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runRegionalETL') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runRegionalETL').timeBased().everyHours(1).create();
}

/**
 * Web App GET Endpoint:
 *  - ?action=snapshot -> JSON snapshot for external web app
 *  - ?action=runETL   -> triggers ETL and returns JSON summary
 *  - default (no action) -> serves hosted GAS HtmlService Web Application (Index.html)
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';

    if (action === 'runETL') {
      const res = runRegionalETL();
      return ContentService.createTextOutput(JSON.stringify({ ok: true, etl: res }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'snapshot') {
      return ContentService.createTextOutput(JSON.stringify(getHubBootstrap()))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'users') {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: true, spreadsheetId: HUB_SPREADSHEET_ID, users: readUserAccountsFromHub_() })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'nep') {
      ensureNepSheet_();
      const hubNep = readNepSheetFromHub_();
      return ContentService.createTextOutput(
        JSON.stringify({
          ok: true,
          spreadsheetId: HUB_SPREADSHEET_ID,
          nepProvinceList: hubNep.nepProvinceList,
          nepMilestoneList: hubNep.nepMilestoneList || {},
          nepMilestoneListByYear: hubNep.nepMilestoneListByYear || {},
          nepProvinceListByYear: hubNep.nepProvinceListByYear || {}
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'supportlist' || action === 'provincial-optool') {
      const res = readProvincialMilestoneSupportLists_();
      return ContentService.createTextOutput(
        JSON.stringify({ ok: true, optool: res.data, headers: res.headers })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'registered' || action === 'registered-summary') {
      const regRes = getRegisteredDataSummaryFromSheets();
      return ContentService.createTextOutput(JSON.stringify(regRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('SPLIT Milestone Monitoring System — DAR Region VIII Hub')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Web App POST Endpoint: Upserts or deletes Milestone_Data, Baselines, or OPTool rows from external Web App
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (body.action === 'upsertMilestone' && body.record) {
      const saved = upsertMilestoneRecord_(body.record);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, Record_ID: saved.Record_ID }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'deleteMilestone' && body.recordId) {
      const deleted = deleteMilestoneRecord_(body.recordId);
      return ContentService.createTextOutput(JSON.stringify({ ok: deleted }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'upsertOptoolRow' && body.tabName && body.row) {
      const result = upsertOptoolRecord_(
        body.tabName,
        body.headers || [],
        body.row,
        body.prevRow || null,
        body.provinceCode || ''
      );
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'deleteOptoolRow' && body.tabName && body.row) {
      const deleted = deleteOptoolRecord_(
        body.tabName,
        body.headers || [],
        body.row,
        body.provinceCode || ''
      );
      return ContentService.createTextOutput(JSON.stringify({ ok: deleted, tabName: body.tabName }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'syncOptoolHeaders') {
      const syncResult = syncAllSheetHeaders(body.spreadsheetId || '');
      return ContentService.createTextOutput(JSON.stringify(syncResult))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'saveBaselines' && body.baselines) {
      saveBaselinesRecord_(body.baselines);
      return ContentService.createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'initNepSheet') {
      ensureNepSheet_();
      const hubNep = readNepSheetFromHub_();
      return ContentService.createTextOutput(
        JSON.stringify({
          ok: true,
          sheetName: 'NEP',
          nepProvinceList: hubNep.nepProvinceList,
          nepMilestoneList: hubNep.nepMilestoneList || {}
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'saveNepSheet' && (body.nepProvinceList || body.nep || body.nepMilestoneList)) {
      const milestone = body.milestone || 'overall';
      const targetYear = body.targetYear || null;
      const batchMap = {};
      if (body.nepProvinceList || body.nep) {
        batchMap[milestone] = body.nepProvinceList || body.nep;
      }
      if (body.nepMilestoneList && typeof body.nepMilestoneList === 'object') {
        for (const ms in body.nepMilestoneList) {
          batchMap[ms] = body.nepMilestoneList[ms];
        }
      }
      saveNepSheetBatch_(batchMap, targetYear);
      const hubNep = readNepSheetFromHub_();
      return ContentService.createTextOutput(
        JSON.stringify({
          ok: true,
          sheetName: 'NEP',
          nepProvinceList: hubNep.nepProvinceList,
          nepMilestoneList: hubNep.nepMilestoneList || {},
          nepMilestoneListByYear: hubNep.nepMilestoneListByYear || {},
          nepProvinceListByYear: hubNep.nepProvinceListByYear || {}
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'deleteNepTarget') {
      deleteNepSheetRecord_(body.provinceCode || body.code, body.milestone || 'overall', body.targetYear || body.year);
      const hubNep = readNepSheetFromHub_();
      return ContentService.createTextOutput(
        JSON.stringify({
          ok: true,
          deleted: true,
          nepProvinceList: hubNep.nepProvinceList,
          nepMilestoneList: hubNep.nepMilestoneList || {},
          nepMilestoneListByYear: hubNep.nepMilestoneListByYear || {},
          nepProvinceListByYear: hubNep.nepProvinceListByYear || {}
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'sendOtpEmail' && body.email && body.otp) {
      sendOtpEmailRecord_(body);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, sent: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'upsertUserAccount' && body.user) {
      const savedUser = upsertUserAccountRecord_(body.user);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, user: savedUser }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'syncUserAccounts' && Array.isArray(body.users)) {
      const syncUsersRes = syncAllUserAccountsRecord_(body.users, body.deletedEmails, body.deletedIds);
      return ContentService.createTextOutput(JSON.stringify(syncUsersRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'deleteUserAccount' && (body.userId || body.email)) {
      const deleted = deleteUserAccountRecord_(body.userId || '', body.email || '');
      return ContentService.createTextOutput(JSON.stringify({ ok: true, deleted: deleted }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'setupDriveFolders') {
      const driveSetupRes = setupRegionalDriveFolders(body.rootFolderId || REGIONAL_DRIVE_FOLDER_ID);
      return ContentService.createTextOutput(JSON.stringify(driveSetupRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (body.action === 'uploadPdfFile') {
      const uploadPdfRes = uploadPdfFileToDrive(body);
      return ContentService.createTextOutput(JSON.stringify(uploadPdfRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Unsupported action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ============================================================================
 * GAS HtmlService RPC Functions (called via google.script.run from Index.html)
 * ============================================================================ */

function getHubBootstrap() {
  const hub = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  const msSheet = hub.getSheetByName('Milestone_Data');
  const baseSheet = hub.getSheetByName('Regional_Baselines');
  const logSheet = hub.getSheetByName('ETL_Sync_Log');

  const baselines = {};
  PROVINCIAL_NODES.forEach(function (n) {
    baselines[n.code] = {
      targetETitles: DEFAULT_BASELINES[n.code].targetETitles,
      targetAreaHas: DEFAULT_BASELINES[n.code].targetAreaHas
    };
  });
  if (baseSheet && baseSheet.getLastRow() > 1) {
    const bRows = baseSheet.getDataRange().getValues();
    for (let i = 1; i < bRows.length; i++) {
      const code = String(bRows[i][0] || '').trim();
      if (baselines[code]) {
        baselines[code] = {
          targetETitles: Number(bRows[i][2]) || 0,
          targetAreaHas: Number(bRows[i][3]) || 0
        };
      }
    }
  }

  const optool = {};
  const optoolHeaders = {};
  OPTOOL_TABS.forEach(function (tabName) {
    optool[tabName] = [];
    optoolHeaders[tabName] = [];
  });

  // 1. Read Database tab from Regional Hub (and merge any provincial Database entries)
  const hubDbSheet = hub.getSheetByName('Database');
  if (hubDbSheet && hubDbSheet.getLastColumn() > 0) {
    optoolHeaders['Database'] = hubDbSheet
      .getRange(1, 1, 1, hubDbSheet.getLastColumn())
      .getValues()[0]
      .map(function (h) { return String(h).trim(); });
    optool['Database'] = readSheetObjects_(hubDbSheet);
  }

  // Also merge any Database rows from provincial nodes
  PROVINCIAL_NODES.forEach(function (node) {
    try {
      const pss = SpreadsheetApp.openById(node.id);
      const pDbSheet = pss.getSheetByName('Database');
      if (pDbSheet && pDbSheet.getLastRow() > 1) {
        const pRows = readSheetObjects_(pDbSheet);
        pRows.forEach(function (row) {
          if (row.lhid) row.lhid = formatLhidString_(row.lhid);
          if (row.LHID) row.LHID = formatLhidString_(row.LHID);
          if (!row.province && !row.Province) row.province = node.name;
          if (!row.provinceCode && !row.Province_Code) row.provinceCode = node.code;
          if (tabName === 'Leasehold') {
            if (!row.provs && !row.PROVS) row.provs = node.name;
            if (!row.reg && !row.REG) row.reg = 'Region VIII';

            // Column M (13th column): Area Tenanted
            let tenantedAreaVal = row.areaTenanted || row['AREA TENANTED (Has)'] || row['Area Tenanted (Has)'] || row['AREA TENANTED'] || row['Area Tenanted'] || '';
            if (!tenantedAreaVal) {
              for (let k in row) {
                const kNorm = String(k).toLowerCase().replace(/[^a-z]/g, '');
                if (kNorm.indexOf('tenanted') !== -1 || (kNorm.indexOf('area') !== -1 && kNorm.indexOf('tenant') !== -1)) {
                  tenantedAreaVal = row[k];
                  break;
                }
              }
            }
            row.areaTenanted = tenantedAreaVal;
            row['AREA TENANTED (Has)'] = tenantedAreaVal;

            // Column AF (32nd column): Target Year
            let targetYearVal = row.targetYear || row['TARGET YEAR'] || row['Target Year'] || row['TARGET_YEAR'] || row['TargetYear'] || '';
            if (!targetYearVal) {
              for (let k in row) {
                const kNorm = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
                if (kNorm.indexOf('targetyear') !== -1 || (kNorm.indexOf('target') !== -1 && kNorm.indexOf('year') !== -1)) {
                  targetYearVal = row[k];
                  break;
                }
              }
            }
            const strY = String(targetYearVal || '').trim().replace(/\.0$/, '');
            const ym = strY.match(/\b(20[1-3]\d)\b/);
            if (ym) {
              row.targetYear = ym[1];
            } else {
              if (strY && !row.leaseInPesos && !row['LEASE IN PESOS'] && /^\d+(\.\d+)?$/.test(strY)) {
                row.leaseInPesos = strY;
                row['LEASE IN PESOS'] = strY;
              }
              const dateVal = row.dateContractRegistered || row['*DATE CONTRACT REGISTERED (mm/dd/yyyy)'] || row.datePlrRegistered || row['*DATE PLR REGISTERED (mm/dd/yyyy)'] || '';
              const dm = String(dateVal).match(/\b(20[1-3]\d)\b/);
              row.targetYear = dm ? dm[1] : '';
            }
            row['TARGET YEAR'] = row.targetYear;
          }
          optool['Database'].push(row);
        });
      }
    } catch (ignore) {}
  });

  // 2. Read OPTool Supportlist (CF(DOC), Survey, MOV, RegistrationDistribution, Installation, Leasehold)
  // DIRECTLY from each provincial Google Sheet (no fallback to Regional Hub)
  const provSupport = readProvincialMilestoneSupportLists_();
  ['CF(DOC)', 'Survey', 'MOV', 'RegistrationDistribution', 'Installation', 'Leasehold'].forEach(function (tab) {
    optool[tab] = provSupport.data[tab] || [];
    optoolHeaders[tab] = provSupport.headers[tab] || [];
  });

  const logs = readSheetObjects_(logSheet).slice(-30).reverse();

  const hubNep = readNepSheetFromHub_();

  return {
    ok: true,
    spreadsheetId: HUB_SPREADSHEET_ID,
    fetchedAt: new Date().toISOString(),
    registry: PROVINCIAL_NODES,
    baselines: baselines,
    milestoneData: readSheetObjects_(msSheet),
    optool: optool,
    optoolHeaders: optoolHeaders,
    nepProvinceList: hubNep.nepProvinceList,
    nepMilestoneList: hubNep.nepMilestoneList || {},
    nepMilestoneListByYear: hubNep.nepMilestoneListByYear || {},
    nepProvinceListByYear: hubNep.nepProvinceListByYear || {},
    users: readUserAccountsFromHub_(),
    syncLogs: logs
  };
}

function saveMilestoneFromUi(rec) {
  const saved = upsertMilestoneRecord_(rec);
  const boot = getHubBootstrap();
  boot.savedRecord = saved;
  return boot;
}

function deleteMilestoneFromUi(recordId) {
  deleteMilestoneRecord_(recordId);
  return getHubBootstrap();
}

function saveBaselinesFromUi(baselinesMap) {
  saveBaselinesRecord_(baselinesMap);
  return getHubBootstrap();
}

function saveBaselinesRecord_(baselinesMap) {
  const sheet = ensureBaselineSheet_();
  const rows = PROVINCIAL_NODES.map(function (n) {
    const item = (baselinesMap && baselinesMap[n.code]) || DEFAULT_BASELINES[n.code];
    return [n.code, n.name, Number(item.targetETitles) || 0, Number(item.targetAreaHas) || 0];
  });
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  sheet.getRange(2, 4, rows.length, 1).setNumberFormat('0.0000');
}

/** Read per-province LHS, AREA, ARBs from the Regional Hub NEP tab. */
function readNepSheetFromHub_() {
  const hub = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  const sheet = hub.getSheetByName('NEP');
  const currentYear = new Date().getFullYear();
  const out = {};
  const nepMilestoneList = {};
  const nepMilestoneListByYear = {};
  const nepProvinceListByYear = {};
  const nepRecords = [];

  PROVINCIAL_NODES.forEach(function (n) {
    out[n.code] = { lhs: 0, area: 0, arbs: 0, year: currentYear };
  });
  if (!sheet || sheet.getLastRow() <= 1) {
    return {
      nepProvinceList: out,
      nepMilestoneList: nepMilestoneList,
      nepMilestoneListByYear: nepMilestoneListByYear,
      nepProvinceListByYear: nepProvinceListByYear,
      nepRecords: nepRecords
    };
  }
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  const codeCol = Math.max(0, headers.indexOf('PROVINCE_CODE'));
  const provCol = headers.indexOf('PROVINCE') >= 0 ? headers.indexOf('PROVINCE') : 1;
  const lhsCol = headers.indexOf('LHS') >= 0 ? headers.indexOf('LHS') : 2;
  const areaCol = headers.indexOf('AREA') >= 0 ? headers.indexOf('AREA') : 3;
  const arbsCol = headers.indexOf('ARBS') >= 0 ? headers.indexOf('ARBS') : 4;
  const yearCol = headers.indexOf('YEAR') >= 0 ? headers.indexOf('YEAR') : 5;
  const msCol = headers.indexOf('MILESTONE') >= 0 ? headers.indexOf('MILESTONE') : 6;

  const parseNum = function (val) {
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    const n = Number(String(val || '').replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  };

  for (let i = 1; i < rows.length; i++) {
    const rawCode = String(rows[i][codeCol] || '').trim().toUpperCase();
    const rawProv = String(rows[i][provCol] || '').trim().toLowerCase();
    if (!rawCode || rawCode === 'TOTAL' || rawProv.indexOf('total') >= 0) continue;
    let code = PROVINCE_CODES.indexOf(rawCode) >= 0 ? rawCode : '';
    if (!code) {
      PROVINCIAL_NODES.forEach(function (n) {
        if (!code && (n.name.toLowerCase().indexOf(rawProv) >= 0 || rawProv.indexOf(n.name.toLowerCase()) >= 0)) {
          code = n.code;
        }
      });
    }
    if (code) {
      const parsedYear = yearCol >= 0 ? Math.round(parseNum(rows[i][yearCol])) : 0;
      const msKey = msCol >= 0 ? String(rows[i][msCol] || '').trim().toLowerCase() : '';
      const yr = parsedYear >= 2000 && parsedYear <= 2099 ? parsedYear : currentYear;
      const rec = {
        lhs: Math.max(0, Math.round(parseNum(rows[i][lhsCol]))),
        area: Math.max(0, Number(parseNum(rows[i][areaCol]).toFixed(4))),
        arbs: Math.max(0, Math.round(parseNum(rows[i][arbsCol]))),
        year: yr,
        milestone: msKey || 'overall',
        provinceCode: code
      };
      nepRecords.push(rec);

      if (!nepMilestoneListByYear[yr]) nepMilestoneListByYear[yr] = {};
      if (!nepProvinceListByYear[yr]) nepProvinceListByYear[yr] = {};

      if (!msKey || msKey === 'overall') {
        out[code] = rec;
        nepProvinceListByYear[yr][code] = rec;
      } else {
        if (!nepMilestoneList[msKey]) nepMilestoneList[msKey] = {};
        nepMilestoneList[msKey][code] = rec;
        if (!nepMilestoneListByYear[yr][msKey]) nepMilestoneListByYear[yr][msKey] = {};
        nepMilestoneListByYear[yr][msKey][code] = rec;
      }
    }
  }
  return {
    nepProvinceList: out,
    nepMilestoneList: nepMilestoneList,
    nepMilestoneListByYear: nepMilestoneListByYear,
    nepProvinceListByYear: nepProvinceListByYear,
    nepRecords: nepRecords
  };
}

/** Fast batch save for NEP targets across all milestones and provinces in 1 single setValues call. */
function saveNepSheetBatch_(milestoneMapList, defaultTargetYear) {
  const sheet = ensureNepSheet_();
  const currentYear = new Date().getFullYear();
  const allValues = sheet.getDataRange().getValues();
  const headers = allValues[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  const codeCol = Math.max(0, headers.indexOf('PROVINCE_CODE'));
  const msCol = headers.indexOf('MILESTONE') >= 0 ? headers.indexOf('MILESTONE') : 6;
  const yearCol = headers.indexOf('YEAR') >= 0 ? headers.indexOf('YEAR') : 5;

  for (const msKey in milestoneMapList) {
    const nepMap = milestoneMapList[msKey];
    if (!nepMap || typeof nepMap !== 'object') continue;
    const isOverall = !msKey || msKey === 'overall';
    const resolvedMilestone = isOverall ? 'overall' : String(msKey).toLowerCase();

    PROVINCIAL_NODES.forEach(function (n) {
      const item = nepMap[n.code] || {};
      const parsedYear = Math.round(Number(item.year || defaultTargetYear) || 0);
      const yr = parsedYear >= 2000 && parsedYear <= 2099 ? parsedYear : currentYear;
      const rowVals = [
        n.code,
        n.name,
        Math.max(0, Math.round(Number(item.lhs) || 0)),
        Math.max(0, Number((Number(item.area) || 0).toFixed(4))),
        Math.max(0, Math.round(Number(item.arbs) || 0)),
        yr,
        resolvedMilestone
      ];

      let foundIndex = -1;
      for (let r = 1; r < allValues.length; r++) {
        const rowCode = String(allValues[r][codeCol] || '').trim().toUpperCase();
        const rowMs = String(allValues[r][msCol] || '').trim().toLowerCase();
        const rowYr = Math.round(Number(allValues[r][yearCol]) || 0);
        if (rowCode === n.code && rowMs === resolvedMilestone && rowYr === yr) {
          foundIndex = r;
          break;
        }
      }

      if (foundIndex >= 1) {
        allValues[foundIndex] = rowVals;
      } else {
        allValues.push(rowVals);
      }
    });
  }

  if (allValues.length > 1) {
    if (allValues.length > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), allValues.length - sheet.getMaxRows() + 10);
    }
    sheet.getRange(1, 1, allValues.length, NEP_SHEET_HEADERS.length).setValues(allValues);
    formatNepSheetRanges_(sheet);
  }
}

/** Write per-province LHS, AREA, ARBs, and Year into the Regional Hub NEP tab without overwriting other years. */
function saveNepSheetRecord_(nepMap, milestoneKey, targetYear) {
  const map = {};
  map[milestoneKey || 'overall'] = nepMap;
  saveNepSheetBatch_(map, targetYear);
}

/** Delete NEP Target rows for a specific province, milestone, and target year in 1 fast batch. */
function deleteNepSheetRecord_(code, milestoneKey, targetYear) {
  const sheet = ensureNepSheet_();
  const allValues = sheet.getDataRange().getValues();
  if (allValues.length <= 1) return;
  const headers = allValues[0].map(function (h) { return String(h || '').trim().toUpperCase(); });
  const codeCol = Math.max(0, headers.indexOf('PROVINCE_CODE'));
  const msCol = headers.indexOf('MILESTONE') >= 0 ? headers.indexOf('MILESTONE') : 6;
  const yearCol = headers.indexOf('YEAR') >= 0 ? headers.indexOf('YEAR') : 5;

  const targetCode = String(code || '').trim().toUpperCase();
  const targetMs = String(milestoneKey || 'overall').trim().toLowerCase();
  const targetYr = Math.round(Number(targetYear) || 0);

  const remaining = [allValues[0]];
  for (let r = 1; r < allValues.length; r++) {
    const rowCode = String(allValues[r][codeCol] || '').trim().toUpperCase();
    const rowMs = String(allValues[r][msCol] || '').trim().toLowerCase();
    const rowYr = Math.round(Number(allValues[r][yearCol]) || 0);

    const matchCode = !targetCode || targetCode === 'ALL' || rowCode === targetCode;
    const matchMs = !targetMs || targetMs === 'all' || rowMs === targetMs;
    const matchYr = !targetYr || rowYr === targetYr;

    if (!(matchCode && matchMs && matchYr)) {
      remaining.push(allValues[r]);
    }
  }

  sheet.clearContents();
  sheet.getRange(1, 1, remaining.length, NEP_SHEET_HEADERS.length).setValues(remaining);
  formatNepSheetRanges_(sheet);
}

function runRegionalETLFromUi() {
  const etlSummary = runRegionalETL();
  const boot = getHubBootstrap();
  boot.etlSummary = etlSummary;
  return boot;
}

function upsertMilestoneRecord_(rec) {
  const sheet = ensureMilestoneSheet_();
  const values = sheet.getDataRange().getValues();
  const prov = String(rec.Province_Code || 'LEY').trim();
  const mDate = String(rec.Milestone_Date || Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd')).trim();
  const ym = /^\d{4}-\d{2}/.test(mDate) ? mDate.slice(0, 7).replace('-', '') : Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyyMM');

  let recordId = String(rec.Record_ID || '').trim();
  if (!recordId) {
    const prefix = prov + '-' + ym + '-';
    let maxSeq = 0;
    for (let r = 1; r < values.length; r++) {
      const existingId = String(values[r][0] || '').trim();
      if (existingId.indexOf(prefix) === 0) {
        const seq = Number(existingId.slice(prefix.length));
        if (seq > maxSeq) maxSeq = seq;
      }
    }
    recordId = prefix + String(maxSeq + 1).padStart(4, '0');
  }

  const areaNum = Number(rec.Area_HAS) || 0;
  const rowValues = [
    recordId,
    prov,
    String(rec.Municipality || '').trim(),
    String(rec.Land_Allocation_ID || '').trim(),
    String(rec.eTitle_No || '').trim(),
    Number(areaNum.toFixed(4)),
    String(rec.Milestone_Stage || '').trim(),
    mDate,
    String(rec.Batch_Category || '').trim(),
    String(rec.LHID || '').trim()
  ];

  let foundRow = -1;
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim() === recordId) {
      foundRow = r + 1;
      break;
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
    sheet.getRange(foundRow, 6, 1, 1).setNumberFormat('0.0000');
  } else {
    sheet.appendRow(rowValues);
    sheet.getRange(sheet.getLastRow(), 6, 1, 1).setNumberFormat('0.0000');
  }

  return {
    Record_ID: recordId,
    Province_Code: prov,
    Municipality: rowValues[2],
    Land_Allocation_ID: rowValues[3],
    eTitle_No: rowValues[4],
    Area_HAS: areaNum.toFixed(4),
    Milestone_Stage: rowValues[6],
    Milestone_Date: mDate,
    Batch_Category: rowValues[8],
    LHID: rowValues[9]
  };
}

function deleteMilestoneRecord_(recordId) {
  const sheet = ensureMilestoneSheet_();
  const values = sheet.getDataRange().getValues();
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][0]).trim() === String(recordId).trim()) {
      sheet.deleteRow(r + 1);
      return true;
    }
  }
  return false;
}

function readSheetObjects_(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = [];
  for (let r = 1; r < data.length; r++) {
    if (data[r].every(function (v) { return String(v).trim() === ''; })) continue;
    const obj = {};
    headers.forEach(function (h, idx) {
      const key = String(h).trim().replace(/\r?\n/g, ' ');
      const val = data[r][idx];
      obj[key] = val instanceof Date ? Utilities.formatDate(val, 'Asia/Manila', 'yyyy-MM-dd') : val;
    });
    rows.push(obj);
  }
  return rows;
}

function normalizeHeaderKey_(val) {
  return String(val || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function findOptoolSheet_(ss, tabName) {
  if (!ss) return null;
  const exact = ss.getSheetByName(tabName);
  if (exact) return exact;
  const targetNorm = normalizeHeaderKey_(tabName);
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sNorm = normalizeHeaderKey_(sheets[i].getName());
    if (sNorm === targetNorm) return sheets[i];
    if (targetNorm === 'cfdoc' && (sNorm === 'cf' || sNorm === 'cfdoc')) return sheets[i];
    if (
      targetNorm === 'registrationdistribution' &&
      (sNorm === 'registration' || sNorm === 'distribution' || sNorm === 'regdist' || sNorm === 'registrationdistribution')
    ) {
      return sheets[i];
    }
    if (targetNorm === 'survey' && (sNorm === 'survey' || sNorm === 'asp')) return sheets[i];
    if (targetNorm === 'installation' && (sNorm === 'installation' || sNorm === 'inst')) return sheets[i];
    if (targetNorm === 'database' && (sNorm === 'database' || sNorm === 'db' || sNorm.indexOf('database') >= 0)) return sheets[i];
    if (targetNorm === 'leasehold' && (sNorm === 'leasehold' || sNorm === 'leaseholl' || sNorm === 'lease' || sNorm.indexOf('leasehold') >= 0)) return sheets[i];
  }
  return null;
}

/**
 * Reads OPTool Supportlist in CF(DOC), Survey, MOV, Registration, Installation, Leasehold
 * DIRECTLY from each provincial Google Sheet (PROVINCIAL_NODES) instead of relying on the Regional Hub.
 */
function readProvincialMilestoneSupportLists_() {
  const MILESTONE_SUPPORT_TABS = ['CF(DOC)', 'Survey', 'MOV', 'RegistrationDistribution', 'Installation', 'Leasehold'];
  const optoolData = {};
  const optoolHeaders = {};

  MILESTONE_SUPPORT_TABS.forEach(function (tab) {
    optoolData[tab] = [];
    optoolHeaders[tab] = [];
  });

  PROVINCIAL_NODES.forEach(function (node) {
    try {
      const pss = SpreadsheetApp.openById(node.id);
      MILESTONE_SUPPORT_TABS.forEach(function (tabName) {
        const pSheet = findOptoolSheet_(pss, tabName);
        if (!pSheet || pSheet.getLastRow() <= 1) return;

        if (!optoolHeaders[tabName] || opttoolHeaders[tabName].length === 0) {
          optoolHeaders[tabName] = pSheet
            .getRange(1, 1, 1, pSheet.getLastColumn())
            .getValues()[0]
            .map(function (h) { return String(h).trim(); });
        }

        const pRows = readSheetObjects_(pSheet);
        pRows.forEach(function (row) {
          const rawLhid = row.lhid || row.LHID || row['LHID/ Sequence No.'] || row['LHID / Sequence No.'] || row['LHID'] || '';
          if (rawLhid) {
            row.lhid = formatLhidString_(rawLhid);
            row.LHID = row.lhid;
          }
          const rowLhid = String(row.lhid || '').trim();
          const hasAnyData = Object.values(row).some(function (v) { return String(v || '').trim() !== ''; });
          if (!rowLhid && !hasAnyData) return;
          if (!row.province && !row.Province) row.province = node.name;
          if (!row.provinceCode && !row.Province_Code) row.provinceCode = node.code;
          if (tabName === 'Leasehold') {
            if (!row.provs && !row.PROVS) row.provs = node.name;
            if (!row.reg && !row.REG) row.reg = 'Region VIII';

            // Column M (13th column): Area Tenanted
            let tenantedAreaVal = row.areaTenanted || row['AREA TENANTED (Has)'] || row['Area Tenanted (Has)'] || row['AREA TENANTED'] || row['Area Tenanted'] || '';
            if (!tenantedAreaVal) {
              for (let k in row) {
                const kNorm = String(k).toLowerCase().replace(/[^a-z]/g, '');
                if (kNorm.indexOf('tenanted') !== -1 || (kNorm.indexOf('area') !== -1 && kNorm.indexOf('tenant') !== -1)) {
                  tenantedAreaVal = row[k];
                  break;
                }
              }
            }
            row.areaTenanted = tenantedAreaVal;
            row['AREA TENANTED (Has)'] = tenantedAreaVal;

            // Column AF (32nd column): Target Year
            let targetYearVal = row.targetYear || row['TARGET YEAR'] || row['Target Year'] || row['TARGET_YEAR'] || row['TargetYear'] || '';
            if (!targetYearVal) {
              for (let k in row) {
                const kNorm = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
                if (kNorm.indexOf('targetyear') !== -1 || (kNorm.indexOf('target') !== -1 && kNorm.indexOf('year') !== -1)) {
                  targetYearVal = row[k];
                  break;
                }
              }
            }
            const strY = String(targetYearVal || '').trim().replace(/\.0$/, '');
            const ym = strY.match(/\b(20[1-3]\d)\b/);
            if (ym) {
              row.targetYear = ym[1];
            } else {
              if (strY && !row.leaseInPesos && !row['LEASE IN PESOS'] && /^\d+(\.\d+)?$/.test(strY)) {
                row.leaseInPesos = strY;
                row['LEASE IN PESOS'] = strY;
              }
              const dateVal = row.dateContractRegistered || row['*DATE CONTRACT REGISTERED (mm/dd/yyyy)'] || row.datePlrRegistered || row['*DATE PLR REGISTERED (mm/dd/yyyy)'] || '';
              const dm = String(dateVal).match(/\b(20[1-3]\d)\b/);
              row.targetYear = dm ? dm[1] : '';
            }
            row['TARGET YEAR'] = row.targetYear;
          }

          // Normalize Reported Month across all milestone support tabs
          if (!row.reportedMonth) {
            row.reportedMonth =
              row['Reported Month'] ||
              row['Month Reported'] ||
              row['MONTH REPORTED'] ||
              row['Report Month'] ||
              row['REPORT MONTH'] ||
              row['Report Month (Words)'] ||
              row['REPORT MONTH (WORDS)'] ||
              row.monthReported ||
              row.reportMonth ||
              '';
          }
          if (!row['Reported Month'] && row.reportedMonth) {
            row['Reported Month'] = row.reportedMonth;
          }

          // Normalize RegistrationDistribution area and date registered fields
          if (tabName === 'RegistrationDistribution') {
            if (!row.areaHas) {
              row.areaHas =
                row['AREA (HAs)'] ||
                row['AREA\n(HAs)'] ||
                row['AREA(HAS)'] ||
                row['Area (HAs)'] ||
                row['Area (HAS)'] ||
                row['Area'] ||
                '';
            }
            if (!row.dateRegistered) {
              row.dateRegistered =
                row['DATE REGISTERED'] ||
                row['Date Registered'] ||
                row.date_registered ||
                '';
            }
          }
          // Normalize Survey Column AC (Date Accepted by DENR-SMD)
          if (tabName === 'Survey') {
            if (!row.dateAcceptedDenrSmd) {
              row.dateAcceptedDenrSmd =
                row['Date Accepted by DENR-SMD\nDATE'] ||
                row['Date Accepted by DENR-SMD DATE'] ||
                row['Date Accepted by DENR-SMD'] ||
                row['Date accepted by DENR-SMD'] ||
                row.date_accepted_denr_smd ||
                '';
            }
            if (!row.dateAcceptedDenrSmd) {
              const keys = Object.keys(row);
              for (let k = 0; k < keys.length; k++) {
                const normK = normalizeHeaderKey_(keys[k]);
                if (normK.indexOf('dateaccepted') >= 0 || (normK.indexOf('accepted') >= 0 && normK.indexOf('denr') >= 0)) {
                  row.dateAcceptedDenrSmd = row[keys[k]];
                  break;
                }
              }
            }
          }
          optoolData[tabName].push(row);
        });
      });
    } catch (err) {
      Logger.log('Error reading provincial sheet for ' + node.code + ' (' + node.name + '): ' + err.message);
    }
  });

  return { data: optoolData, headers: optoolHeaders };
}

/**
 * Reads all provincial Google Sheets Registration/Distribution sheets,
 * identifies rows with Date Registered in Column M, and sums Area in Column J (AREA(HAs)).
 */
function getRegisteredDataSummaryFromSheets() {
  const summary = {};
  let totalRegisteredCount = 0;
  let totalRegisteredArea = 0;

  PROVINCIAL_NODES.forEach(function (node) {
    summary[node.code] = {
      code: node.code,
      provinceName: node.name,
      registeredCount: 0,
      registeredAreaHas: 0
    };
    try {
      const ss = SpreadsheetApp.openById(node.id);
      const regTab = findOptoolSheet_(ss, 'RegistrationDistribution');
      if (!regTab || regTab.getLastRow() <= 1) return;

      const values = regTab.getDataRange().getValues();
      const headers = values[0].map(function (h) { return String(h).trim(); });

      let areaColIdx = 9; // Column J (0-based 9)
      let dateRegColIdx = 12; // Column M (0-based 12)
      headers.forEach(function (h, idx) {
        const norm = normalizeHeaderKey_(h);
        if (norm.indexOf('areaha') >= 0 || norm === 'areahas' || norm === 'area') areaColIdx = idx;
        if (norm.indexOf('datereg') >= 0 || norm === 'dateregistered') dateRegColIdx = idx;
      });

      for (let r = 1; r < values.length; r++) {
        const row = values[r];
        if (row.every(function (v) { return String(v).trim() === ''; })) continue;

        const rawDate = row[dateRegColIdx];
        const dateStr = rawDate instanceof Date
          ? Utilities.formatDate(rawDate, 'Asia/Manila', 'yyyy-MM-dd')
          : String(rawDate || '').trim();

        if (!dateStr || dateStr === '-' || dateStr === 'N/A') continue;

        const rawArea = row[areaColIdx];
        const areaNum = typeof rawArea === 'number'
          ? rawArea
          : (parseFloat(String(rawArea || '').replace(/,/g, '')) || 0);

        summary[node.code].registeredCount++;
        summary[node.code].registeredAreaHas += areaNum;
        totalRegisteredCount++;
        totalRegisteredArea += areaNum;
      }

      summary[node.code].registeredAreaHas = Number(summary[node.code].registeredAreaHas.toFixed(4));
    } catch (err) {
      Logger.log('Error reading registered data for ' + node.code + ': ' + err.message);
    }
  });

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    totalRegisteredCount: totalRegisteredCount,
    totalRegisteredArea: Number(totalRegisteredArea.toFixed(4)),
    byProvince: summary
  };
}

function isColumnEmptyBelowHeader_(sheet, colOneBased) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return true;
  const vals = sheet.getRange(2, colOneBased, lastRow - 1, 1).getValues();
  for (let r = 0; r < vals.length; r++) {
    if (String(vals[r][0] || '').trim() !== '') return false;
  }
  return true;
}

function getDefaultHeaderTitles_(tabName, headersSpec) {
  const fromSpec = (headersSpec || []).map(function (h) { return h.header || h.key; }).filter(Boolean);
  if (fromSpec.length > 0) return fromSpec;
  if (OPTOOL_SCHEMA_HEADERS[tabName]) return OPTOOL_SCHEMA_HEADERS[tabName].slice();
  return [];
}

function styleHeaderRange_(range) {
  range.setFontWeight('bold').setBackground('#14532D').setFontColor('#FFFFFF');
}

function syncOptoolTabHeaders_(ss, tabName, headersSpec) {
  if (OPTOOL_TABS.indexOf(tabName) === -1) {
    throw new Error('Unsupported OPTool tab: ' + tabName);
  }
  const expectedTitles = getDefaultHeaderTitles_(tabName, headersSpec);
  let sheet = findOptoolSheet_(ss, tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  if (sheet.getLastColumn() === 0) {
    if (expectedTitles.length > 0) {
      const range = sheet.getRange(1, 1, 1, expectedTitles.length);
      range.setValues([expectedTitles]);
      styleHeaderRange_(range);
      sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
    }
    return { sheet: sheet, added: expectedTitles.slice(), renamed: [], removedEmpty: [] };
  }

  const renamed = [];
  const removedEmpty = [];
  const added = [];

  // Safe in-place cleanup & header label upgrades without moving populated data columns
  let headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (let c = headerRow.length - 1; c >= 0; c--) {
    const norm = normalizeHeaderKey_(headerRow[c]);
    if (tabName === 'CF(DOC)' && norm === 'test' && isColumnEmptyBelowHeader_(sheet, c + 1)) {
      sheet.deleteColumn(c + 1);
      removedEmpty.push('test');
    } else if (tabName === 'RegistrationDistribution' && norm === 'gendermf' && isColumnEmptyBelowHeader_(sheet, c + 1)) {
      sheet.deleteColumn(c + 1);
      removedEmpty.push('Gender (M/F)');
    }
  }

  headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (let c = 0; c < headerRow.length; c++) {
    const norm = normalizeHeaderKey_(headerRow[c]);
    if (tabName === 'MOV' && norm === 'ppureviewresult') {
      sheet.getRange(1, c + 1).setValue('PPU Review Result\n(PASSED/FAILED)');
      renamed.push('PPU Review Result -> PPU Review Result (PASSED/FAILED)');
    } else if (
      tabName === 'RegistrationDistribution' &&
      (norm === 'noofarbs' || norm === 'totalnoofarbs' || norm === 'totalnumberofarbs')
    ) {
      sheet.getRange(1, c + 1).setValue('Total Number of ARB');
      renamed.push(String(headerRow[c]) + ' -> Total Number of ARB');
    } else if (
      tabName === 'RegistrationDistribution' &&
      (norm === 'targetcurrentprevious' || norm === 'targetyearcurrentprevious')
    ) {
      sheet.getRange(1, c + 1).setValue('TARGET YEAR\n (Current/ Previous)');
    } else if (
      tabName === 'Installation' &&
      (norm === 'targetcurrentprevious' || norm === 'targetyearcurrentprevious')
    ) {
      sheet.getRange(1, c + 1).setValue('TARGET YEAR\n (Current/ Previous)');
    } else if (
      tabName === 'Database' &&
      (norm === 'lad' || norm === 'ladcolumn')
    ) {
      sheet.getRange(1, c + 1).setValue('Lad Status');
      renamed.push(String(headerRow[c]) + ' -> Lad Status');
    }
  }

  // Count existing occurrences of each normalized header so duplicate names (e.g. Installation) match exact multiplicity
  headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const existingCounts = {};
  for (let c = 0; c < headerRow.length; c++) {
    const norm = normalizeHeaderKey_(headerRow[c]);
    existingCounts[norm] = (existingCounts[norm] || 0) + 1;
  }

  const seenCounts = {};
  for (let i = 0; i < expectedTitles.length; i++) {
    const title = expectedTitles[i];
    const norm = normalizeHeaderKey_(title);
    seenCounts[norm] = (seenCounts[norm] || 0) + 1;
    if ((existingCounts[norm] || 0) < seenCounts[norm]) {
      added.push(title);
    }
  }

  if (added.length > 0) {
    const startCol = sheet.getLastColumn() + 1;
    const range = sheet.getRange(1, startCol, 1, added.length);
    range.setValues([added]);
    styleHeaderRange_(range);
  }

  if (tabName === 'Database') {
    applyDatabaseValidationRules_(sheet);
  } else {
    applyMilestoneTargetYearFormula_(sheet, tabName);
  }

  return { sheet: sheet, added: added, renamed: renamed, removedEmpty: removedEmpty };
}

/**
 * Apply dropdown validation rules to Database sheet:
 * - Workability: Workable, For Replacement, Replacement
 * - Lad Status: LAD Balance, Temp. Park, For Inclusion
 */
function applyDatabaseValidationRules_(sheet) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;
  const maxRows = Math.max(sheet.getMaxRows() - 1, 100);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  const workabilityRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(WORKABILITY_OPTIONS, true)
    .setAllowInvalid(true)
    .build();

  const ladStatusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(LAD_STATUS_OPTIONS, true)
    .setAllowInvalid(true)
    .build();

  let targetYearCol = -1;
  let yearCol = -1;
  for (let c = 0; c < headers.length; c++) {
    const norm = normalizeHeaderKey_(headers[c]);
    if (norm === 'workability') {
      sheet.getRange(2, c + 1, maxRows, 1).setDataValidation(workabilityRule);
    } else if (norm === 'ladstatus' || norm === 'lad' || norm === 'ladcolumn') {
      sheet.getRange(2, c + 1, maxRows, 1).setDataValidation(ladStatusRule);
    } else if (norm === 'targetyear') {
      targetYearCol = c + 1;
    } else if (norm === 'year') {
      yearCol = c + 1;
    }
  }

  // Auto-connect TargetYear formula to reflect Database Year column Z
  const lastRow = sheet.getLastRow();
  if (targetYearCol > 0 && yearCol > 0 && lastRow > 1) {
    const diff = yearCol - targetYearCol;
    const formulaStr = diff > 0
      ? '=IF(ISBLANK(RC[' + diff + ']), "", RC[' + diff + '])'
      : '=IF(ISBLANK(RC' + yearCol + '), "", RC' + yearCol + ')';
    sheet.getRange(2, targetYearCol, lastRow - 1, 1).setFormulaR1C1(formulaStr);
  }
}

/**
 * Auto-connect Target Year formula on Milestone sheets (CF(DOC), Survey, MOV, Registration/Distribution, Installation)
 * to look up LHID in Database!$A:$Z:
 * - Checks Milestone Target in Database Column Y (col 25) matches this milestone (or is blank)
 * - Returns Year from Database Column Z (col 26)
 */
function applyMilestoneTargetYearFormula_(sheet, tabName) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastCol === 0 || lastRow <= 1) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let targetYearCol = -1;
  for (let c = 0; c < headers.length; c++) {
    const norm = normalizeHeaderKey_(headers[c]);
    if (norm === 'targetyear') {
      targetYearCol = c + 1;
      break;
    }
  }
  if (targetYearCol <= 0) return;

  let targetCriteria = '';
  const normTab = normalizeHeaderKey_(tabName);
  if (normTab === 'cfdoc') {
    targetCriteria = 'OR(VLOOKUP(A2, Database!$A:$Z, 25, FALSE)="CF(DOC)", ISBLANK(VLOOKUP(A2, Database!$A:$Z, 25, FALSE)))';
  } else if (normTab === 'survey') {
    targetCriteria = 'OR(VLOOKUP(A2, Database!$A:$Z, 25, FALSE)="Survey", ISBLANK(VLOOKUP(A2, Database!$A:$Z, 25, FALSE)))';
  } else if (normTab === 'mov') {
    targetCriteria = 'OR(VLOOKUP(A2, Database!$A:$Z, 25, FALSE)="MOV", VLOOKUP(A2, Database!$A:$Z, 25, FALSE)="Land Valuation", ISBLANK(VLOOKUP(A2, Database!$A:$Z, 25, FALSE)))';
  } else if (normTab === 'registrationdistribution') {
    targetCriteria = 'OR(VLOOKUP(A2, Database!$A:$Z, 25, FALSE)="Registration/Distribution", VLOOKUP(A2, Database!$A:$Z, 25, FALSE)="RegistrationDistribution", ISBLANK(VLOOKUP(A2, Database!$A:$Z, 25, FALSE)))';
  } else if (normTab === 'installation') {
    targetCriteria = 'OR(VLOOKUP(A2, Database!$A:$Z, 25, FALSE)="Installation", ISBLANK(VLOOKUP(A2, Database!$A:$Z, 25, FALSE)))';
  } else {
    return;
  }

  const baseFormula = '=IF(ISBLANK(A2), "", IFERROR(IF(' + targetCriteria + ', VLOOKUP(A2, Database!$A:$Z, 26, FALSE), ""), ""))';
  sheet.getRange(2, targetYearCol, lastRow - 1, 1).setFormula(baseFormula);
}

function applyDatabaseValidationAcrossSheets() {
  return syncAllSheetHeaders();
}

/**
 * Menu & Web App action: Sync SALIG 6-tab column headers across Active Sheet, Regional Hub, and accessible Provincial Nodes.
 */
function syncAllSheetHeaders(specificSpreadsheetId) {
  const targets = [];
  const seenIds = {};
  const addTarget = function (code, id) {
    if (!id || seenIds[id]) return;
    seenIds[id] = true;
    targets.push({ code: code, id: id });
  };

  if (specificSpreadsheetId) {
    addTarget('TARGET', specificSpreadsheetId);
  } else {
    try {
      const active = SpreadsheetApp.getActiveSpreadsheet();
      if (active) addTarget('ACTIVE', active.getId());
    } catch (ignore) {}
    addTarget('HUB', HUB_SPREADSHEET_ID);
    PROVINCIAL_NODES.forEach(function (n) {
      addTarget(n.code, n.id);
    });
  }

  const results = [];
  targets.forEach(function (t) {
    try {
      const ss = SpreadsheetApp.openById(t.id);
      const tabReport = {};
      OPTOOL_TABS.forEach(function (tabName) {
        const res = syncOptoolTabHeaders_(ss, tabName, null);
        tabReport[tabName] = {
          added: res.added,
          renamed: res.renamed,
          removedEmpty: res.removedEmpty
        };
      });
      results.push({ code: t.code, spreadsheetId: t.id, name: ss.getName(), status: 'synced', tabs: tabReport });
    } catch (err) {
      results.push({ code: t.code, spreadsheetId: t.id, status: 'error', error: err.message });
    }
  });

  return { ok: true, results: results };
}

function resolveNodeIdFromRow_(provinceCode, rowObj) {
  const rawCode = String(provinceCode || (rowObj && (rowObj.provinceCode || rowObj.Province_Code)) || '').trim().toUpperCase();
  for (let i = 0; i < PROVINCIAL_NODES.length; i++) {
    if (PROVINCIAL_NODES[i].code === rawCode || (PROVINCIAL_NODES[i].code === 'SAM' && rawCode === 'WSA')) return PROVINCIAL_NODES[i].id;
  }
  const provText = String((rowObj && (rowObj.province || rowObj.Province || rowObj.provincename || rowObj.ProvinceName || rowObj.provs || rowObj.PROVS)) || '').toLowerCase();
  if (provText.indexOf('biliran') !== -1) return PROVINCIAL_NODES[0].id;
  if (provText.indexOf('eastern samar') !== -1) return PROVINCIAL_NODES[1].id;
  if (provText.indexOf('northern samar') !== -1) return PROVINCIAL_NODES[3].id;
  if (provText.indexOf('southern leyte') !== -1) return PROVINCIAL_NODES[5].id;
  if (provText.indexOf('samar') !== -1) return PROVINCIAL_NODES[4].id;
  if (provText.indexOf('leyte') !== -1) return PROVINCIAL_NODES[2].id;

  // Search Database sheet by LHID to auto-detect province if not provided directly
  const targetLhid = rowObj && (rowObj.lhid || rowObj.LHID);
  if (targetLhid) {
    try {
      const hub = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
      const dbSheet = hub.getSheetByName('Database');
      if (dbSheet && dbSheet.getLastRow() > 1) {
        const cleanTarget = formatLhidString_(targetLhid).toLowerCase();
        const headers = dbSheet.getRange(1, 1, 1, dbSheet.getLastColumn()).getValues()[0].map(normalizeHeaderKey_);
        const lhidCol = headers.indexOf('lhid');
        let provCol = headers.indexOf('province');
        if (provCol === -1) provCol = headers.indexOf('provincename');
        if (lhidCol >= 0 && provCol >= 0) {
          const vals = dbSheet.getDataRange().getValues();
          for (let r = 1; r < vals.length; r++) {
            if (formatLhidString_(vals[r][lhidCol]).toLowerCase() === cleanTarget) {
              const p = String(vals[r][provCol] || '').toLowerCase();
              if (p.indexOf('biliran') !== -1) return PROVINCIAL_NODES[0].id;
              if (p.indexOf('eastern samar') !== -1) return PROVINCIAL_NODES[1].id;
              if (p.indexOf('northern samar') !== -1) return PROVINCIAL_NODES[3].id;
              if (p.indexOf('southern leyte') !== -1) return PROVINCIAL_NODES[5].id;
              if (p.indexOf('samar') !== -1) return PROVINCIAL_NODES[4].id;
              if (p.indexOf('leyte') !== -1) return PROVINCIAL_NODES[2].id;
              break;
            }
          }
        }
      }
    } catch (ignore) {}
  }
  return '';
}

function getWriteTargetSpreadsheets_(tabName, provinceCode, rowObj) {
  const isMilestone = ['CF(DOC)', 'Survey', 'MOV', 'RegistrationDistribution', 'Installation', 'Leasehold'].indexOf(tabName) !== -1;
  const provId = resolveNodeIdFromRow_(provinceCode, rowObj);
  const targets = [];
  if (provId) {
    targets.push({ code: provinceCode || 'PROVINCE', id: provId });
  }
  if (!isMilestone || targets.length === 0) {
    targets.push({ code: 'HUB', id: HUB_SPREADSHEET_ID });
  }
  return targets;
}

function ensureOptoolSheet_(ss, tabName, headersSpec) {
  return syncOptoolTabHeaders_(ss, tabName, headersSpec).sheet;
}

function buildOptoolColMap_(sheet, tabName, headersSpec) {
  const specList =
    headersSpec && headersSpec.length > 0
      ? headersSpec
      : getDefaultHeaderTitles_(tabName, []).map(function (h) { return { key: h, header: h }; });
  const lastCol = Math.max(sheet.getLastColumn(), specList.length);
  const sheetHeaders = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : specList.map(function (h) { return h.header || h.key; });

  const buckets = {};
  specList.forEach(function (spec) {
    const k = normalizeHeaderKey_(spec.header || spec.key);
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(spec);
  });

  const colMap = [];
  for (let c = 0; c < sheetHeaders.length; c++) {
    const norm = normalizeHeaderKey_(sheetHeaders[c]);
    let spec = buckets[norm] && buckets[norm].length > 0 ? buckets[norm].shift() : null;
    if (!spec && specList[c] && normalizeHeaderKey_(specList[c].header || specList[c].key) === norm) {
      spec = specList[c];
    }
    colMap.push(spec || null);
  }
  return { colMap: colMap, width: Math.max(lastCol, colMap.length) };
}

function formatLhidString_(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const str = String(raw).trim();
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/i.test(str)) {
    const num = Number(str);
    if (!isNaN(num) && isFinite(num)) {
      return String(Math.round(num));
    }
  }
  if (/^\d+\.0+$/.test(str)) {
    return str.split('.')[0];
  }
  return str;
}

function findOptoolRowNumber_(sheet, colMap, tabName, targetRow, prevRow) {
  if (sheet.getLastRow() <= 1) return -1;
  const values = sheet.getDataRange().getValues();

  if (tabName === 'Leasehold') {
    const ref = prevRow || targetRow || {};
    let titleCol = -1, lotCol = -1, lhSurCol = -1, lhFirstCol = -1, loSurCol = -1, munCol = -1;
    for (let c = 0; c < colMap.length; c++) {
      if (!colMap[c]) continue;
      const k = colMap[c].key;
      if (k === 'titleNo') titleCol = c;
      else if (k === 'lotNo') lotCol = c;
      else if (k === 'leaseholderSurname') lhSurCol = c;
      else if (k === 'leaseholderFirstname') lhFirstCol = c;
      else if (k === 'loSurname') loSurCol = c;
      else if (k === 'mun') munCol = c;
    }
    const refTitle = String(ref.titleNo || ref['TITLE NO.'] || '').trim().toLowerCase();
    const refLot = String(ref.lotNo || ref['LOT NO.'] || '').trim().toLowerCase();
    const refLhSur = String(ref.leaseholderSurname || ref['LEASEHOLDER SURNAME'] || '').trim().toLowerCase();
    const refLhFirst = String(ref.leaseholderFirstname || ref['LEASEHOLDER FIRSTNAME'] || '').trim().toLowerCase();
    const refLoSur = String(ref.loSurname || ref['LO SURNAME'] || '').trim().toLowerCase();
    const refMun = String(ref.mun || ref['MUN'] || '').trim().toLowerCase();

    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const rowTitle = titleCol >= 0 ? String(row[titleCol] || '').trim().toLowerCase() : '';
      const rowLot = lotCol >= 0 ? String(row[lotCol] || '').trim().toLowerCase() : '';
      const rowLhSur = lhSurCol >= 0 ? String(row[lhSurCol] || '').trim().toLowerCase() : '';
      const rowLhFirst = lhFirstCol >= 0 ? String(row[lhFirstCol] || '').trim().toLowerCase() : '';
      const rowLoSur = loSurCol >= 0 ? String(row[loSurCol] || '').trim().toLowerCase() : '';
      const rowMun = munCol >= 0 ? String(row[munCol] || '').trim().toLowerCase() : '';

      if (refTitle && refLot && rowTitle === refTitle && rowLot === refLot && (!refMun || rowMun === refMun)) {
        return r + 1;
      }
      if (refLhSur && refLhFirst && rowLhSur === refLhSur && rowLhFirst === refLhFirst) {
        if ((refTitle && rowTitle === refTitle) || (refLot && rowLot === refLot) || (refLoSur && rowLoSur === refLoSur) || (refMun && rowMun === refMun)) {
          return r + 1;
        }
      }
    }
    return -1;
  }

  let lhidCol = -1;
  for (let c = 0; c < colMap.length; c++) {
    if (colMap[c] && colMap[c].key === 'lhid') {
      lhidCol = c;
      break;
    }
  }
  const ref = prevRow || targetRow || {};
  const rawRefLhid = String(ref.lhid || targetRow.lhid || '').trim().toLowerCase();
  const cleanRefLhid = formatLhidString_(ref.lhid || targetRow.lhid || '').toLowerCase();
  if ((!rawRefLhid && !cleanRefLhid) || lhidCol < 0) return -1;

  const isUniqueByLhid = tabName === 'Database';
  let firstLhidMatch = -1;

  for (let r = 1; r < values.length; r++) {
    const rawRowLhid = String(values[r][lhidCol] || '').trim().toLowerCase();
    const cleanRowLhid = formatLhidString_(values[r][lhidCol] || '').toLowerCase();
    const lhidMatches =
      rawRowLhid === rawRefLhid ||
      cleanRowLhid === cleanRefLhid ||
      rawRowLhid === cleanRefLhid ||
      cleanRowLhid === rawRefLhid;
    if (!lhidMatches) continue;
    if (isUniqueByLhid) {
      const refOwner = String(ref.landOwner || ref.landowner || '').trim().toLowerCase();
      const refTitle = String(ref.titleNumber || ref.title || '').trim().toLowerCase();
      if (!refOwner && !refTitle) return r + 1;
      let matchedSecondary = true;
      for (let c = 0; c < colMap.length; c++) {
        const spec = colMap[c];
        if (!spec) continue;
        if (refOwner && (spec.key === 'landOwner' || spec.key === 'landowner')) {
          const actual = String(values[r][c] || '').trim().toLowerCase();
          if (actual && actual !== refOwner) matchedSecondary = false;
        }
        if (refTitle && (spec.key === 'titleNumber' || spec.key === 'title')) {
          const actual = String(values[r][c] || '').trim().toLowerCase();
          if (actual && actual !== refTitle) matchedSecondary = false;
        }
      }
      if (matchedSecondary) return r + 1;
      if (firstLhidMatch === -1) firstLhidMatch = r + 1;
      continue;
    }
    if (firstLhidMatch === -1) firstLhidMatch = r + 1;

    let secondaryMatches = true;
    for (let c = 0; c < colMap.length; c++) {
      const spec = colMap[c];
      if (!spec || spec.key === 'lhid') continue;
      if (spec.key === 'monthReported' || spec.key === 'remarks' || spec.key === 'target') {
        const rawExpected = ref[spec.key];
        const expected = rawExpected !== undefined && rawExpected !== null ? String(rawExpected).trim() : '';
        const actual = String(values[r][c] || '').trim();
        if (expected && actual !== expected) {
          secondaryMatches = false;
          break;
        }
      }
    }
    if (secondaryMatches) return r + 1;
  }
  return prevRow ? -1 : firstLhidMatch;
}

function upsertOptoolInSpreadsheet_(ss, tabName, headersSpec, rowObj, prevRow) {
  const sheet = ensureOptoolSheet_(ss, tabName, headersSpec);
  const mapped = buildOptoolColMap_(sheet, tabName, headersSpec);
  const colMap = mapped.colMap;
  const width = mapped.width;

  const outRow = [];
  for (let c = 0; c < width; c++) {
    const spec = colMap[c];
    if (!spec) {
      outRow.push('');
      continue;
    }
    const raw =
      rowObj[spec.key] !== undefined
        ? rowObj[spec.key]
        : rowObj[spec.header] !== undefined
        ? rowObj[spec.header]
        : '';
    if (spec.type === 'decimal' && raw !== '') {
      const num = Number(raw);
      outRow.push(isNaN(num) ? String(raw) : Number(num.toFixed(4)));
    } else {
      outRow.push(raw);
    }
  }

  const rowNumber = findOptoolRowNumber_(sheet, colMap, tabName, rowObj, prevRow);
  if (rowNumber > 0) {
    sheet.getRange(rowNumber, 1, 1, width).setValues([outRow]);
  } else {
    sheet.appendRow(outRow);
  }
  if (tabName !== 'Database' && tabName !== 'Leasehold') {
    applyMilestoneTargetYearFormula_(sheet, tabName);
  }
  return { ok: true, tabName: tabName, updated: rowNumber > 0, rowNumber: rowNumber > 0 ? rowNumber : sheet.getLastRow() };
}

function upsertOptoolRecord_(tabName, headersSpec, rowObj, prevRow, provinceCode) {
  const targets = getWriteTargetSpreadsheets_(tabName, provinceCode, rowObj);
  const perNode = [];
  let primaryResult = { ok: true, tabName: tabName, updated: false, rowNumber: 0 };
  let anySuccess = false;

  targets.forEach(function (t, idx) {
    try {
      const ss = SpreadsheetApp.openById(t.id);
      const res = upsertOptoolInSpreadsheet_(ss, tabName, headersSpec, rowObj, prevRow);
      if (idx === 0) primaryResult = res;
      perNode.push({ code: t.code, ok: true, updated: res.updated, rowNumber: res.rowNumber });
      anySuccess = true;
    } catch (err) {
      perNode.push({ code: t.code, ok: false, error: err.message });
    }
  });

  primaryResult.ok = anySuccess;
  primaryResult.syncedNodes = perNode;
  return primaryResult;
}

function deleteOptoolRecord_(tabName, headersSpec, rowObj, provinceCode) {
  const targets = getWriteTargetSpreadsheets_(tabName, provinceCode, rowObj);
  let deletedAny = false;
  targets.forEach(function (t) {
    try {
      const ss = SpreadsheetApp.openById(t.id);
      const sheet = ensureOptoolSheet_(ss, tabName, headersSpec);
      const mapped = buildOptoolColMap_(sheet, tabName, headersSpec);
      const rowNumber = findOptoolRowNumber_(sheet, mapped.colMap, tabName, rowObj, rowObj);
      if (rowNumber > 1) {
        sheet.deleteRow(rowNumber);
        deletedAny = true;
      }
    } catch (ignore) {}
  });
  return deletedAny;
}

function sendOtpEmailRecord_(payload) {
  const recipient = String(payload.email || '').trim();
  const otp = String(payload.otp || '').trim();
  const recipientName = String(payload.name || 'SALIG User').trim();
  const expires = Number(payload.expiresInMinutes || 10);
  if (!recipient || !otp) throw new Error('Email and OTP are required.');

  const subject = 'SALIG (LAD DATABASE) — Email Verification OTP Code';
  const plainBody = [
    'Dear ' + recipientName + ',',
    '',
    'Your 6-digit verification OTP code for DAR Region VIII SALIG (LAD DATABASE) is:',
    '',
    '    ' + otp,
    '',
    'This code expires in ' + expires + ' minutes.',
    'After completing registration, an Administrator will confirm your account before login.',
    '',
    'DAR Region VIII — Eastern Visayas'
  ].join('\n');

  const htmlBody = [
    '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #dce5df;border-radius:12px;">',
    '<div style="font-size:12px;font-weight:700;color:#0f4c29;text-transform:uppercase;letter-spacing:0.06em;">Department of Agrarian Reform — Region VIII</div>',
    '<h2 style="margin:6px 0 12px;color:#132018;">SALIG Email Verification</h2>',
    '<p style="color:#374151;font-size:14px;">Hello <strong>' + recipientName.replace(/</g, '&lt;') + '</strong>,</p>',
    '<p style="color:#374151;font-size:14px;">Use the 6-digit verification OTP code below to verify your email address for creating your SALIG account:</p>',
    '<div style="margin:18px 0;padding:16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;text-align:center;">',
    '<span style="font-size:30px;font-weight:800;letter-spacing:0.3em;color:#0a361d;font-family:monospace;">' + otp + '</span>',
    '</div>',
    '<p style="color:#54655a;font-size:12.5px;">This code is valid for <strong>' + expires + ' minutes</strong>. After sign-up, your account will await Administrator confirmation.</p>',
    '</div>'
  ].join('');

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody
  });
}

/** Ensure the User_Accounts tab exists in the Regional Hub Google Sheet. */
function ensureUserAccountsSheet_() {
  const hub = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  let sheet = hub.getSheetByName('User_Accounts');
  if (!sheet) {
    sheet = hub.insertSheet('User_Accounts');
    sheet.getRange(1, 1, 1, USER_ACCOUNTS_HEADERS.length).setValues([USER_ACCOUNTS_HEADERS]);
    sheet
      .getRange(1, 1, 1, USER_ACCOUNTS_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#14532D')
      .setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
    sheet.getRange('E:E').setNumberFormat('@');
  }
  return sheet;
}

function findAccountColumnIndex_(headers, candidates) {
  for (let i = 0; i < headers.length; i++) {
    const norm = String(headers[i] || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let c = 0; c < candidates.length; c++) {
      if (norm === candidates[c]) return i;
    }
  }
  return -1;
}

/** Read all SALIG user accounts from the Regional Hub User_Accounts tab. */
function readUserAccountsFromHub_(deletedEmails, deletedIds) {
  const hub = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  const sheet = hub.getSheetByName('User_Accounts');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const data = sheet.getDataRange().getDisplayValues();
  const headers = data[0].map(function (h) {
    return String(h || '').trim();
  });
  const delEmails = Array.isArray(deletedEmails)
    ? deletedEmails.map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean)
    : [];
  const delIds = Array.isArray(deletedIds)
    ? deletedIds.map(function (i) { return String(i || '').trim(); }).filter(Boolean)
    : [];

  const getCol = function (candidates) {
    return findAccountColumnIndex_(headers, candidates);
  };
  const idCol = getCol(['userid', 'id', 'useridentification']);
  const nameCol = getCol(['fullname', 'name', 'userfullname']);
  const emailCol = getCol(['email', 'emailaddress', 'useremail', 'mail']);
  const provCol = getCol(['province', 'prov']);
  const phoneCol = getCol(['contactnumber', 'contact', 'phonenumber', 'phone', 'mobile']);
  const roleCol = getCol(['role', 'userrole']);
  const statusCol = getCol(['status', 'userstatus', 'approvalstatus']);
  const verifiedCol = getCol(['emailverified', 'verified']);
  const hashCol = getCol(['passwordhash', 'hash']);
  const createdCol = getCol(['createdat', 'created']);
  const updatedCol = getCol(['updatedat', 'updated']);
  const appAtCol = getCol(['approvedat']);
  const appByCol = getCol(['approvedby']);

  const getCell = function (row, col) {
    return col >= 0 ? String(row[col] || '').trim() : '';
  };

  const out = [];
  for (let r = 1; r < data.length; r++) {
    const email = getCell(data[r], emailCol).toLowerCase();
    const id = getCell(data[r], idCol);
    if (!email && !id) continue;
    if (delEmails.indexOf(email) >= 0 || (id && delIds.indexOf(id) >= 0)) continue;
    const verifiedRaw = getCell(data[r], verifiedCol).toUpperCase();
    out.push({
      id: id || ('usr-' + email),
      name: getCell(data[r], nameCol) || email,
      email: email,
      province: getCell(data[r], provCol),
      contactNumber: getCell(data[r], phoneCol),
      role: (getCell(data[r], roleCol) || 'user').toLowerCase(),
      status: (getCell(data[r], statusCol) || 'pending').toLowerCase(),
      emailVerified: verifiedRaw === 'TRUE' || verifiedRaw === 'YES',
      passwordHash: getCell(data[r], hashCol),
      createdAt: getCell(data[r], createdCol),
      updatedAt: getCell(data[r], updatedCol) || getCell(data[r], createdCol),
      approvedAt: getCell(data[r], appAtCol) || null,
      approvedBy: getCell(data[r], appByCol) || null
    });
  }
  return out;
}

/** Upsert a single SALIG user account into the Regional Hub User_Accounts tab. */
function upsertUserAccountRecord_(user) {
  const sheet = ensureUserAccountsSheet_();
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(function (h) { return String(h || '').trim(); });
  let idCol = findAccountColumnIndex_(headers, ['userid', 'id', 'useridentification']);
  if (idCol < 0) idCol = headers.indexOf('User_ID');
  let emailCol = findAccountColumnIndex_(headers, ['email', 'emailaddress', 'useremail', 'mail']);
  if (emailCol < 0) emailCol = headers.indexOf('Email');

  const targetId = String(user.id || '').trim();
  const targetEmail = String(user.email || '').trim().toLowerCase();
  const rowMap = {
    User_ID: targetId,
    Full_Name: String(user.name || '').trim(),
    Email: targetEmail,
    Province: String(user.province || '').trim(),
    Contact_Number: String(user.contactNumber || '').trim(),
    Role: String(user.role || 'user').trim().toLowerCase(),
    Status: String(user.status || 'pending').trim().toLowerCase(),
    Email_Verified: user.emailVerified ? 'TRUE' : 'FALSE',
    Password_Hash: String(user.passwordHash || '').trim(),
    Created_At: String(user.createdAt || '').trim(),
    Updated_At: String(user.updatedAt || user.createdAt || '').trim(),
    Approved_At: String(user.approvedAt || '').trim(),
    Approved_By: String(user.approvedBy || '').trim()
  };

  let existingExistingHash = '';
  let foundRow = -1;
  for (let r = 1; r < values.length; r++) {
    const rId = idCol >= 0 ? String(values[r][idCol] || '').trim() : '';
    const rEmail = emailCol >= 0 ? String(values[r][emailCol] || '').trim().toLowerCase() : '';
    if ((targetId && rId === targetId) || (targetEmail && rEmail === targetEmail)) {
      foundRow = r + 1;
      let hashCol = findAccountColumnIndex_(headers, ['passwordhash', 'hash']);
      if (hashCol < 0) hashCol = headers.indexOf('Password_Hash');
      if (hashCol >= 0) existingExistingHash = String(values[r][hashCol] || '').trim();
      break;
    }
  }
  if (!rowMap.Password_Hash && existingExistingHash) {
    rowMap.Password_Hash = existingExistingHash;
  }

  const outRow = USER_ACCOUNTS_HEADERS.map(function (h) {
    return rowMap[h] !== undefined ? rowMap[h] : '';
  });

  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, outRow.length).setValues([outRow]);
    sheet.getRange(foundRow, 5, 1, 1).setNumberFormat('@');
  } else {
    sheet.appendRow(outRow);
    sheet.getRange(sheet.getLastRow(), 5, 1, 1).setNumberFormat('@');
  }
  return rowMap;
}

/** Sync an array of SALIG user accounts into the Regional Hub User_Accounts tab. */
function syncAllUserAccountsRecord_(users, deletedEmails, deletedIds) {
  if (Array.isArray(deletedEmails) || Array.isArray(deletedIds)) {
    const delEmailList = (deletedEmails || []).map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean);
    const delIdList = (deletedIds || []).map(function (i) { return String(i || '').trim(); }).filter(Boolean);
    delEmailList.forEach(function (e) {
      deleteUserAccountRecord_('', e);
    });
    delIdList.forEach(function (i) {
      deleteUserAccountRecord_(i, '');
    });
  }
  if (!Array.isArray(users)) return { ok: true, synced: 0, users: readUserAccountsFromHub_(deletedEmails, deletedIds) };
  let synced = 0;
  users.forEach(function (u) {
    if (u && u.email) {
      upsertUserAccountRecord_(u);
      synced += 1;
    }
  });
  return { ok: true, synced: synced, users: readUserAccountsFromHub_(deletedEmails, deletedIds) };
}

/** Delete a SALIG user account row from the Regional Hub User_Accounts tab. */
function deleteUserAccountRecord_(userId, email) {
  const hub = SpreadsheetApp.openById(HUB_SPREADSHEET_ID);
  const sheet = hub.getSheetByName('User_Accounts');
  if (!sheet || sheet.getLastRow() <= 1) return false;
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(function (h) { return String(h || '').trim(); });
  let idCol = findAccountColumnIndex_(headers, ['userid', 'id', 'useridentification']);
  if (idCol < 0) idCol = headers.indexOf('User_ID');
  let emailCol = findAccountColumnIndex_(headers, ['email', 'emailaddress', 'useremail', 'mail']);
  if (emailCol < 0) emailCol = headers.indexOf('Email');
  const targetId = String(userId || '').trim();
  const targetEmail = String(email || '').trim().toLowerCase();

  let deletedAny = false;
  for (let r = values.length - 1; r >= 1; r--) {
    const row = values[r];
    const rId = idCol >= 0 ? String(row[idCol] || '').trim() : '';
    const rEmail = emailCol >= 0 ? String(row[emailCol] || '').trim().toLowerCase() : '';
    let matches = false;
    if (targetId && rId === targetId) matches = true;
    if (targetEmail && rEmail === targetEmail) matches = true;
    if (!matches && targetEmail) {
      for (let c = 0; c < row.length; c++) {
        if (String(row[c] || '').trim().toLowerCase() === targetEmail) {
          matches = true;
          break;
        }
      }
    }
    if (matches) {
      sheet.deleteRow(r + 1);
      deletedAny = true;
    }
  }
  return deletedAny;
}

/** Run once inside Apps Script editor to authorize MailApp email sending permission. */
function authorizeEmailQuota() {
  const remaining = MailApp.getRemainingDailyQuota();
  Logger.log('Remaining daily MailApp quota: ' + remaining);
  return remaining;
}

/* ============================================================================
 * Google Drive Milestone Storage & Automated PDF Ingestion
 * Root Folder: https://drive.google.com/drive/folders/1z7SycuDvk9M5pPDZ2IvhwebQDsGHOhsJ
 * ============================================================================ */

/** Find an existing subfolder by exact or normalized name, or create it with public-read permissions. */
function getOrCreateDriveSubfolder_(parentFolder, folderName) {
  const targetName = String(folderName || '').trim();
  const folders = parentFolder.getFoldersByName(targetName);
  if (folders.hasNext()) {
    return folders.next();
  }

  // Fallback: check case-insensitive or prefix matching
  const allIter = parentFolder.getFolders();
  while (allIter.hasNext()) {
    const f = allIter.next();
    const curName = f.getName().trim().toUpperCase();
    if (curName === targetName.toUpperCase() || curName.startsWith(targetName.toUpperCase())) {
      return f;
    }
  }

  // Create new folder
  const created = parentFolder.createFolder(targetName);
  try {
    created.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    Logger.log('Could not set link sharing for folder ' + targetName + ': ' + err.message);
  }
  return created;
}

/**
 * Creates/verifies a dedicated folder for each Region VIII province and 5 milestone subfolders in each.
 * Returns a JSON mapping of all folder IDs and web URLs.
 */
function setupRegionalDriveFolders(rootFolderId) {
  const targetId = rootFolderId || REGIONAL_DRIVE_FOLDER_ID;
  const root = DriveApp.getFolderById(targetId);
  try {
    root.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('Root link sharing: ' + e.message);
  }

  const result = {
    ok: true,
    rootFolderId: targetId,
    rootFolderUrl: root.getUrl(),
    provinces: {}
  };

  PROVINCE_DRIVE_CONFIGS.forEach(function (p) {
    const provFolder = getOrCreateDriveSubfolder_(root, p.name);
    result.provinces[p.code] = {
      code: p.code,
      name: p.name,
      folderId: provFolder.getId(),
      folderUrl: provFolder.getUrl(),
      milestones: {}
    };

    MILESTONE_DRIVE_FOLDERS.forEach(function (ms) {
      const msFolder = getOrCreateDriveSubfolder_(provFolder, ms);
      result.provinces[p.code].milestones[ms] = {
        name: ms,
        folderId: msFolder.getId(),
        folderUrl: msFolder.getUrl()
      };
    });
  });

  return result;
}

/** UI Menu wrapper to run setup from the Google Sheets menu. */
function menuSetupDriveFolders() {
  const ui = SpreadsheetApp.getUi();
  try {
    const res = setupRegionalDriveFolders(REGIONAL_DRIVE_FOLDER_ID);
    ui.alert(
      'Google Drive Setup Complete!\n\n' +
      'All 6 Province and 5 Milestone folders are active in:\n' +
      res.rootFolderUrl
    );
  } catch (err) {
    ui.alert('Drive Setup Failed: ' + err.message);
  }
}

/**
 * Uploads a base64 encoded PDF file to the appropriate province and milestone subfolder.
 * Optionally updates the matching Google Sheet row's "PDF File" column.
 */
function uploadPdfFileToDrive(payload) {
  const targetId = payload.rootFolderId || REGIONAL_DRIVE_FOLDER_ID;
  const root = DriveApp.getFolderById(targetId);

  // Match province code or name
  const rawProv = String(payload.province || 'LEYTE').trim().toUpperCase();
  let matchedProv = PROVINCE_DRIVE_CONFIGS.find(function (p) {
    return p.code === rawProv || p.name === rawProv || rawProv.indexOf(p.code) >= 0 || rawProv.indexOf(p.name) >= 0;
  });
  if (!matchedProv) matchedProv = PROVINCE_DRIVE_CONFIGS[2]; // Default Leyte

  const provFolder = getOrCreateDriveSubfolder_(root, matchedProv.name);

  const msName = String(payload.milestone || payload.tabName || 'CF(DOC)').trim();
  const msFolder = getOrCreateDriveSubfolder_(provFolder, msName);

  let cleanBase64 = String(payload.base64Data || payload.fileBase64 || '').trim();
  if (cleanBase64.indexOf(',') >= 0) {
    cleanBase64 = cleanBase64.split(',')[1];
  }
  const bytes = Utilities.base64Decode(cleanBase64);
  const rawFileName = String(payload.fileName || (msName + '_' + (payload.lhid || 'doc') + '.pdf')).trim();
  const fileName = rawFileName.toLowerCase().endsWith('.pdf') ? rawFileName : (rawFileName + '.pdf');

  const blob = Utilities.newBlob(bytes, 'application/pdf', fileName);
  const file = msFolder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('Sharing error on file: ' + e.message);
  }

  const fileUrl = file.getUrl();

  // If tabName and lhid provided, attempt to update the Google Sheet cell
  try {
    const tabName = payload.tabName || msName;
    const lhid = payload.lhid ? String(payload.lhid).trim().toLowerCase() : '';
    if (tabName && lhid) {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(tabName);
      if (sheet) {
        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn();
        if (lastRow > 1 && lastCol > 0) {
          const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
          const lhidColIdx = headers.findIndex(function (h) { return String(h).toUpperCase().indexOf('LHID') >= 0; });
          const colKey = payload.colKey || 'pdfFile';
          let targetColIdx = -1;
          if (colKey === 'transmittalSrPdf') {
            targetColIdx = headers.findIndex(function (h) {
              const u = String(h).toUpperCase();
              return u.indexOf('TRANSMITTAL') >= 0 || (u.indexOf('SR') >= 0 && u.indexOf('PDF') >= 0);
            });
          }
          if (targetColIdx < 0) {
            targetColIdx = headers.findIndex(function (h) {
              const u = String(h).toUpperCase();
              return u === 'PDF FILE' || u === 'PDF' || (colKey !== 'transmittalSrPdf' && u.indexOf('PDF') >= 0 && u.indexOf('TRANSMITTAL') < 0);
            });
          }
          if (targetColIdx < 0) {
            targetColIdx = headers.findIndex(function (h) { return String(h).toUpperCase().indexOf('PDF') >= 0; });
          }
          if (lhidColIdx >= 0 && targetColIdx >= 0) {
            const data = sheet.getRange(2, lhidColIdx + 1, lastRow - 1, 1).getValues();
            const cleanTargetLhid = formatLhidString_(lhid).toLowerCase();
            for (let i = 0; i < data.length; i++) {
              const rawCell = String(data[i][0]).trim().toLowerCase();
              const cleanCell = formatLhidString_(data[i][0]).toLowerCase();
              if (rawCell === lhid || cleanCell === cleanTargetLhid || rawCell === cleanTargetLhid || cleanCell === lhid) {
                sheet.getRange(i + 2, targetColIdx + 1).setValue(fileUrl);
                break;
              }
            }
          }
        }
      }
    }
  } catch (sheetErr) {
    Logger.log('Could not update sheet cell for PDF: ' + sheetErr.message);
  }

  return {
    ok: true,
    fileId: file.getId(),
    fileUrl: fileUrl,
    fileName: fileName,
    province: matchedProv.name,
    milestone: msName
  };
}

/**
 * Run once inside Apps Script editor under ltsdarregion08@gmail.com
 * to authorize Google Drive & Spreadsheet permissions and verify access to the root folder.
 */
function authorizeDriveAndRegionalHub() {
  const userEmail = Session.getEffectiveUser().getEmail();
  Logger.log('Active user authorizing Drive: ' + userEmail + ' (Primary Owner: ltsdarregion08@gmail.com)');
  const root = DriveApp.getFolderById(REGIONAL_DRIVE_FOLDER_ID);
  Logger.log('Root Folder Name: ' + root.getName());
  Logger.log('Root Folder URL: ' + root.getUrl());
  const res = setupRegionalDriveFolders(REGIONAL_DRIVE_FOLDER_ID);
  Logger.log('Google Drive Folders Initialized: ' + JSON.stringify(res));
  return {
    ok: true,
    authorizedUser: userEmail,
    primaryOwner: 'ltsdarregion08@gmail.com',
    rootFolderUrl: root.getUrl(),
    res: res
  };
}

/**
 * Automated Provincial Synchronization Trigger:
 * Pulls all milestone supportlists (CF, Survey, MOV, Registration, Installation)
 * across all 6 provincial Google Sheets and logs sync status.
 */
function scheduledProvincialSync() {
  const res = readProvincialMilestoneSupportLists_();
  let totalRows = 0;
  if (res && res.data) {
    Object.keys(res.data).forEach(function (t) {
      totalRows += (res.data[t] || []).length;
    });
  }
  Logger.log('Scheduled Provincial Sync: ' + totalRows + ' milestone rows verified across Region VIII.');
  return { ok: true, totalRows: totalRows };
}

/**
 * Run once to install an automatic 5-minute recurring timer
 * for continuous provincial Google Sheets consolidation.
 */
function installAutomatedSyncTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scheduledProvincialSync') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('scheduledProvincialSync')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Installed 5-minute automated provincial sync trigger.');
  return { ok: true, message: 'Automated 5-minute sync trigger installed successfully.' };
}

/**
 * Real-Time Outbound Webhook to SALIG Web System:
 * Instantly notifies the SALIG application server whenever an edit, insertion,
 * or deletion occurs in Google Sheets, enabling instant sub-second synchronization.
 */
function onSpreadsheetChangeWebhook(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const webhookUrl = props.getProperty('SALIG_WEBHOOK_URL');
    if (!webhookUrl) {
      Logger.log('SALIG_WEBHOOK_URL not configured in Script Properties.');
      return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = e && e.source ? e.source.getActiveSheet() : (ss ? ss.getActiveSheet() : null);
    const sheetName = sheet ? sheet.getName() : 'Unknown';

    const payload = {
      source: 'GoogleSheet',
      sheetName: sheetName,
      changeType: (e && e.changeType) || 'EDIT',
      timestamp: new Date().toISOString()
    };

    const res = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    Logger.log('Webhook dispatched to SALIG (' + res.getResponseCode() + '): ' + sheetName);
  } catch (err) {
    Logger.log('Error dispatching webhook to SALIG: ' + err.message);
  }
}

/**
 * Installs an instant onChange trigger in Google Sheets that sends
 * immediate webhook updates to SALIG whenever any user edits the spreadsheet.
 *
 * @param {string} saligWebhookUrl - e.g. "https://your-domain.vercel.app/api/sync/webhook"
 */
function installRealTimeWebhookTrigger(saligWebhookUrl) {
  if (saligWebhookUrl) {
    PropertiesService.getScriptProperties().setProperty('SALIG_WEBHOOK_URL', saligWebhookUrl.trim());
  }
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onSpreadsheetChangeWebhook') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('onSpreadsheetChangeWebhook')
    .forSpreadsheet(ss)
    .onChange()
    .create();
  const currentUrl = saligWebhookUrl || PropertiesService.getScriptProperties().getProperty('SALIG_WEBHOOK_URL');
  Logger.log('Real-time onChange webhook trigger installed for: ' + currentUrl);
  return { ok: true, message: 'Real-time webhook trigger installed successfully. Target: ' + currentUrl };
}
