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
 *      - Execute as: Me (Regional Hub Account with access to provincial sheets)
 *      - Who has access: Anyone within DAR / Anyone with the link
 *   5. Open the deployed /exec URL in your browser OR paste it into the local
 *      Node.js Hub's "Google Sheets & GAS ETL" tab for two-way sync.
 * ============================================================================
 */

const HUB_SPREADSHEET_ID = '1jTVJSQlUcWyZFxm6Pxqj9L62q9NtLyhUy1ifYqqb0Lw';

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

const OPTOOL_TABS = [
  'Database',
  'CF(DOC)',
  'Survey',
  'MOV',
  'RegistrationDistribution',
  'Installation'
];

const OPTOOL_SCHEMA_HEADERS = {
  Database: [
    'LHID', 'Title Number', 'Land Owner', 'MOA', 'Phase',
    'RegionName', 'Province', 'Municipality', 'Barangay',
    'SurveyStatus', 'TargetYear', 'PipelineYear', 'problematic',
    'Total Area', 'ComputedArea', 'DistributedArea', 'SurveyNumber', 'LotNumber',
    'CARPable', 'NONCARPable', 'Optool Status', 'CurrentStatusDesc',
    'NewLandSize', 'Lad Status', 'Milestone Target', 'Year'
  ],
  'CF(DOC)': [
    'LHID', 'Certificate of TItle', 'DENR Certification', 'Tax Declaration',
    'Carper Lad Form 1&2', 'Carper Lad Form 3', 'ASP', 'Carper Lad form 18',
    'Carper LAD form 20', 'MARPO Cert.', 'FIR Carper LAD Form 46',
    'Land use per FI', 'Copy of the AdvSP', 'Carper LAD No. 49',
    'Carper LAD No. 37/oathe of ARB', 'Carper LAD form 47',
    'Approved Subdivision/Segregation Plan', 'DATE FI CONDUCTED',
    'DATE PREPARED & SIGNED', 'TARGET\n (Current/ Previous)',
    'Reported Month', 'REMARKS', 'PDF File'
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
    'Current Status', 'Current Date'
  ],
  MOV: [
    'LHID', 'PPU Date', 'PPU Review Result\n(PASSED/FAILED)',
    'Date Received at DARPO', 'Compensation Amount', 'Date of MOV',
    'Date Trans to LBP/AOC', 'LBP Claim Number', 'AOC Number',
    'TARGET\n (Current/ Previous)', 'Reported Month', 'PDF File'
  ],
  RegistrationDistribution: [
    'LHID/ Sequence No.', 'Origin/\nSource:\n(New Land, REDOC & DNYD)',
    'CLOA TYPE (EP/CLOA OR COLLECTIVE)', 'REGION', 'PROVINCE',
    'MUNICIPALITY', 'BARANGAY', 'NAME OF ARB (LN, FN, MI)',
    'EP or CLOA \nSERIAL No.', 'AREA\n(HAs)', 'MOA', 'ROD TITLE NO.',
    'DATE REGISTERED', 'DATE OF DISTRIBUTION (mm/dd/yyyy)',
    'Total Number of ARB', 'Male', 'Female', 'NO. OF TITLES',
    'TARGET YEAR\n (Current/ Previous)', 'MONTH REPORTED', 'REMARKS'
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
    'TARGET YEAR\n (Current/ Previous)', 'MONTH REPORTED'
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
    .addItem('Initialize Milestone_Data & Baselines Tabs', 'initializeHubTabs')
    .addItem('Install Hourly Auto-Sync Trigger', 'installHourlyTrigger')
    .addToUi();
}

function initializeHubTabs() {
  ensureMilestoneSheet_();
  ensureBaselineSheet_();
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

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('SPLIT Milestone Monitoring System — DAR Region VIII Hub')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
    const sh = hub.getSheetByName(tabName);
    if (sh && sh.getLastColumn() > 0) {
      optoolHeaders[tabName] = sh
        .getRange(1, 1, 1, sh.getLastColumn())
        .getValues()[0]
        .map(function (h) { return String(h).trim(); });
    } else {
      optoolHeaders[tabName] = [];
    }
    optool[tabName] = readSheetObjects_(sh);
  });

  const logs = readSheetObjects_(logSheet).slice(-30).reverse();

  return {
    ok: true,
    spreadsheetId: HUB_SPREADSHEET_ID,
    fetchedAt: new Date().toISOString(),
    registry: PROVINCIAL_NODES,
    baselines: baselines,
    milestoneData: readSheetObjects_(msSheet),
    optool: optool,
    optoolHeaders: optoolHeaders,
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
  const exact = ss.getSheetByName(tabName);
  if (exact) return exact;
  const targetNorm = normalizeHeaderKey_(tabName);
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (normalizeHeaderKey_(sheets[i].getName()) === targetNorm) {
      return sheets[i];
    }
  }
  return null;
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
  if (OPTOOL_SCHEMA_HEADERS[tabName]) return OPTOOL_SCHEMA_HEADERS[tabName].slice();
  return (headersSpec || []).map(function (h) { return h.header || h.key; });
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

  return { sheet: sheet, added: added, renamed: renamed, removedEmpty: removedEmpty };
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
  const rawCode = String(provinceCode || '').trim().toUpperCase();
  for (let i = 0; i < PROVINCIAL_NODES.length; i++) {
    if (PROVINCIAL_NODES[i].code === rawCode) return PROVINCIAL_NODES[i].id;
  }
  const provText = String((rowObj && rowObj.province) || '').toLowerCase();
  if (provText.indexOf('biliran') !== -1) return PROVINCIAL_NODES[0].id;
  if (provText.indexOf('eastern samar') !== -1) return PROVINCIAL_NODES[1].id;
  if (provText.indexOf('northern samar') !== -1) return PROVINCIAL_NODES[3].id;
  if (provText.indexOf('southern leyte') !== -1) return PROVINCIAL_NODES[5].id;
  if (provText.indexOf('samar') !== -1) return PROVINCIAL_NODES[4].id;
  if (provText.indexOf('leyte') !== -1) return PROVINCIAL_NODES[2].id;
  return '';
}

function getWriteTargetSpreadsheets_(provinceCode, rowObj) {
  const targets = [{ code: 'HUB', id: HUB_SPREADSHEET_ID }];
  const provId = resolveNodeIdFromRow_(provinceCode, rowObj);
  if (provId && provId !== HUB_SPREADSHEET_ID) {
    targets.push({ code: provinceCode || 'PROVINCE', id: provId });
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

function findOptoolRowNumber_(sheet, colMap, tabName, targetRow, prevRow) {
  if (sheet.getLastRow() <= 1) return -1;
  const values = sheet.getDataRange().getValues();
  let lhidCol = -1;
  for (let c = 0; c < colMap.length; c++) {
    if (colMap[c] && colMap[c].key === 'lhid') {
      lhidCol = c;
      break;
    }
  }
  const ref = prevRow || targetRow || {};
  const refLhid = String(ref.lhid || targetRow.lhid || '').trim().toLowerCase();
  if (!refLhid || lhidCol < 0) return -1;

  const isUniqueByLhid = tabName === 'Database';
  let firstLhidMatch = -1;

  for (let r = 1; r < values.length; r++) {
    const rowLhid = String(values[r][lhidCol] || '').trim().toLowerCase();
    if (rowLhid !== refLhid) continue;
    if (isUniqueByLhid) return r + 1;
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
    const raw = rowObj[spec.key] !== undefined ? rowObj[spec.key] : '';
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
  return { ok: true, tabName: tabName, updated: rowNumber > 0, rowNumber: rowNumber > 0 ? rowNumber : sheet.getLastRow() };
}

function upsertOptoolRecord_(tabName, headersSpec, rowObj, prevRow, provinceCode) {
  const targets = getWriteTargetSpreadsheets_(provinceCode, rowObj);
  const perNode = [];
  let primaryResult = { ok: true, tabName: tabName, updated: false, rowNumber: 0 };

  targets.forEach(function (t, idx) {
    try {
      const ss = SpreadsheetApp.openById(t.id);
      const res = upsertOptoolInSpreadsheet_(ss, tabName, headersSpec, rowObj, prevRow);
      if (idx === 0) primaryResult = res;
      perNode.push({ code: t.code, ok: true, updated: res.updated, rowNumber: res.rowNumber });
    } catch (err) {
      perNode.push({ code: t.code, ok: false, error: err.message });
    }
  });

  primaryResult.syncedNodes = perNode;
  return primaryResult;
}

function deleteOptoolRecord_(tabName, headersSpec, rowObj, provinceCode) {
  const targets = getWriteTargetSpreadsheets_(provinceCode, rowObj);
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
