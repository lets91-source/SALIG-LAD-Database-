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
 * Web App POST Endpoint: Upserts Milestone_Data or OPTool rows from external Web App
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
  const sheet = ensureBaselineSheet_();
  const rows = PROVINCIAL_NODES.map(function (n) {
    const item = (baselinesMap && baselinesMap[n.code]) || DEFAULT_BASELINES[n.code];
    return [n.code, n.name, Number(item.targetETitles) || 0, Number(item.targetAreaHas) || 0];
  });
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  sheet.getRange(2, 4, rows.length, 1).setNumberFormat('0.0000');
  return getHubBootstrap();
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
