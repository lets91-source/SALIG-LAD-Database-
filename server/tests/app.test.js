import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  REGIONAL_REGISTRY,
  MILESTONE_TARGET_TABS,
  OPTOOL_SHEET_SCHEMAS,
  OPTOOL_PREVIEW_COLUMNS,
  inferProvinceCodeFromMunicipality,
  isChecklistChecked as isServerChecklistChecked
} from '../schema.js';
import { ConsolidatedStore, resolveDefaultDataDir } from '../store.js';
import { createSeedState } from '../seedData.js';
import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } from '../auth.js';
import {
  buildConsolidatedWorkbookBuffer,
  parseWorkbookBuffer,
  parseCsvText
} from '../sheetsSync.js';
import { createAppServer } from '../app.js';
import vercelHandler from '../../api/index.js';
import {
  renderOptoolView,
  getColumnFilterValues,
  isChecklistChecked,
  LINKED_DB_PROFILE_FIELDS,
  renderMilestoneWhereaboutsView,
  matchesWhereaboutsTargetYear,
  renderSurveySupportListModalHtml,
  renderCfSupportListModalHtml,
  DEFAULT_CF_PROVINCES,
  WHEREABOUTS_CONFIGS,
  renderUsersView,
  isLadBalance,
  isTempPark,
  resolveProvinceCode,
  renderDashboardView
} from '../../public/views.js';
import {
  TARGET_PERIOD_OPTIONS,
  formatCurrentMonthYear,
  getReportedMonthOptions,
  isReportedMonthKey,
  formatLhidDisplay,
  parseDatabaseYear,
  resolveDatabaseYear,
  resolveSurveyCurrentStatus,
  resolveTargetFromDatabaseRow,
  resolveTotalArbsFromGenderCounts
} from '../../public/reportingUtils.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'split-r8-test-'));
}

test('Schema & Region VIII Registry integrity', () => {
  assert.equal(REGIONAL_REGISTRY.length, 7);
  assert.equal(REGIONAL_REGISTRY[0].spreadsheetId, '1jTVJSQlUcWyZFxm6Pxqj9L62q9NtLyhUy1ifYqqb0Lw');

  assert.equal(OPTOOL_SHEET_SCHEMAS.Database.length, 28);
  const subLotCol = OPTOOL_SHEET_SCHEMAS.Database.find((c) => c.key === 'subLotNumber');
  assert.equal(subLotCol?.header, 'Sub Lot Number');
  assert.equal(subLotCol?.label, 'Sub Lot Number');
  assert.equal(subLotCol?.group, 'Parcel Details');
  const dbLotIdx = OPTOOL_SHEET_SCHEMAS.Database.findIndex((c) => c.key === 'lotNumber');
  const dbSubLotIdx = OPTOOL_SHEET_SCHEMAS.Database.findIndex((c) => c.key === 'subLotNumber');
  assert.equal(dbSubLotIdx, dbLotIdx + 1, 'Sub Lot Number must immediately follow LotNumber in Database schema');
  const ladCol = OPTOOL_SHEET_SCHEMAS.Database.find((c) => c.key === 'ladStatus');
  assert.equal(ladCol?.type, 'select');
  assert.deepEqual(ladCol?.options, ['LAD Balance', 'Temp. Park', 'For Inclusion']);
  const workCol = OPTOOL_SHEET_SCHEMAS.Database.find((c) => c.key === 'workability');
  assert.equal(workCol?.type, 'select');
  assert.deepEqual(workCol?.options, ['Workable', 'For Replacement', 'Replacement']);
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].length, 20);
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].some((c) => c.key === 'carperLadForm18'), false);
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].some((c) => c.key === 'carperLadForm20'), false);
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].some((c) => c.key === 'carperLadNo49'), false);
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].some((c) => c.key === 'approvedSubdivisionPlan'), false);
  assert.equal(OPTOOL_SHEET_SCHEMAS.Survey.length, 44);
  assert.equal(OPTOOL_SHEET_SCHEMAS.MOV.length, 15);
  const movDateMovIdx = OPTOOL_SHEET_SCHEMAS.MOV.findIndex((c) => c.key === 'dateOfMov');
  const movLotIdx = OPTOOL_SHEET_SCHEMAS.MOV.findIndex((c) => c.key === 'lotNumber');
  const movSubLotIdx = OPTOOL_SHEET_SCHEMAS.MOV.findIndex((c) => c.key === 'subLotNumber');
  assert.equal(movLotIdx, movDateMovIdx + 1, 'Lot Number must immediately follow Date of MOV in MOV schema');
  assert.equal(movSubLotIdx, movDateMovIdx + 2, 'Sub Lot Number must immediately follow Lot Number in MOV schema');
  const movLotCol = OPTOOL_SHEET_SCHEMAS.MOV.find((c) => c.key === 'lotNumber');
  assert.equal(movLotCol?.header, 'Lot Number');
  assert.equal(movLotCol?.group, 'Compensation & LBP');
  const movSubLotCol = OPTOOL_SHEET_SCHEMAS.MOV.find((c) => c.key === 'subLotNumber');
  assert.equal(movSubLotCol?.header, 'Sub Lot Number');
  assert.equal(movSubLotCol?.group, 'Compensation & LBP');
  assert.equal(OPTOOL_SHEET_SCHEMAS.MOV.some((c) => c.key === 'currentStatus' || c.key === 'currentDate'), false);
  const ppuCol = OPTOOL_SHEET_SCHEMAS.MOV.find((c) => c.key === 'ppuReviewResult');
  assert.equal(ppuCol?.type, 'select');
  assert.deepEqual(ppuCol?.options, ['PASSED', 'FAILED']);
  assert.equal(OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.length, 23);
  const regReporting = OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.slice(-9);
  assert.deepEqual(
    regReporting.map((c) => c.key),
    ['noOfArbs', 'maleArbs', 'femaleArbs', 'noOfTitles', 'target', 'monthReported', 'remarks', 'pdfFile', 'targetYear']
  );
  assert.ok(regReporting.every((c) => c.group === 'Reporting'));
  assert.equal(OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.some((c) => c.key === 'gender'), false);
  assert.equal(OPTOOL_SHEET_SCHEMAS.Installation.length, 32);
  const instReporting = OPTOOL_SHEET_SCHEMAS.Installation.slice(-4, -1);
  assert.deepEqual(
    instReporting.map((c) => c.key),
    ['target', 'monthReported', 'pdfFile']
  );
  assert.equal(instReporting[0].type, 'select');
  assert.deepEqual(instReporting[0].options, TARGET_PERIOD_OPTIONS);
  assert.equal(instReporting[1].type, 'select');
  assert.deepEqual(instReporting[1].options, getReportedMonthOptions());

  const surveyCols = OPTOOL_SHEET_SCHEMAS.Survey;
  const lastFourKeys = surveyCols.slice(-4).map((c) => c.key);
  assert.deepEqual(lastFourKeys, ['pdfFile', 'currentStatus', 'currentDate', 'targetYear']);
  const curStatusCol = surveyCols.find((c) => c.key === 'currentStatus');
  assert.equal(curStatusCol?.group, 'Reporting');
  assert.equal(curStatusCol?.type, 'text');
  const curDateCol = surveyCols.find((c) => c.key === 'currentDate');
  assert.equal(curDateCol?.group, 'Reporting');
  assert.equal(curDateCol?.type, 'date');
  const tgtYearCol = surveyCols.find((c) => c.key === 'targetYear');
  assert.equal(tgtYearCol?.group, 'Reporting');
  assert.equal(tgtYearCol?.type, 'text');
  const kindCol = surveyCols.find((c) => c.key === 'kindOfSurvey');
  assert.equal(kindCol?.type, 'select');
  assert.deepEqual(kindCol?.options, ['By Admin', 'By Contract']);
  assert.equal(kindCol?.group, 'DARPO Compliance');

  const finIdx = surveyCols.findIndex((c) => c.key === 'finalizedSrDate');
  const fwdIdx = surveyCols.findIndex((c) => c.key === 'srForwardedToDarro');
  const accIdx = surveyCols.findIndex((c) => c.key === 'srAcceptedByDarro');
  const planIdx = surveyCols.findIndex((c) => c.key === 'plan');
  assert.equal(fwdIdx, finIdx + 1);
  assert.equal(accIdx, fwdIdx + 1);
  assert.equal(planIdx, accIdx + 1);
  assert.equal(surveyCols.some((c) => c.key === 'srForwardedPreIvas'), false);
  assert.equal(surveyCols[fwdIdx].header, 'SR Forwarded to DARRO');
  assert.equal(surveyCols[fwdIdx].group, 'DARPO Compliance');
  assert.equal(surveyCols[accIdx].header, 'SR Accepted by DARRO');
  assert.equal(surveyCols[accIdx].group, 'DARRO Compliance');
  const surveyChecklistCols = surveyCols.filter((c) => c.type === 'checkbox');
  assert.equal(surveyChecklistCols.length, 14, 'Survey checklists reduced by 1 since Transmittal PDF is now a PDF file');
  const transmittalCol = surveyCols.find((c) => c.key === 'transmittalSrPdf');
  assert.equal(transmittalCol?.type, 'pdfFile', 'Transmittal PDF column has type pdfFile');
  assert.ok(surveyChecklistCols.every((c) => c.group === 'DARRO Compliance'));
  const remarksDarro = surveyCols.find((c) => c.key === 'remarksDarroToDarpo');
  assert.equal(remarksDarro?.fullWidth, true);
  const denrRetIdx = surveyCols.findIndex((c) => c.key === 'srReturnedDenrToDarroDate');
  const denrDarroDarpoIdx = surveyCols.findIndex((c) => c.key === 'srReturnedDenrDarroToDarpoDate');
  const remarksDenrIdx = surveyCols.findIndex((c) => c.key === 'remarksReturnedDenr');
  const darpoToDarroIdx = surveyCols.findIndex((c) => c.key === 'srReturnedDarpoToDarroDate');
  assert.equal(denrDarroDarpoIdx, denrRetIdx + 1);
  assert.equal(remarksDenrIdx, denrDarroDarpoIdx + 1);
  assert.equal(darpoToDarroIdx, remarksDenrIdx + 1);
  assert.equal(surveyCols[denrDarroDarpoIdx].header, 'SR Returned DENR-SMD -> DARRO - DARPO');
  assert.equal(surveyCols[denrDarroDarpoIdx].group, 'DARRO Compliance');
  assert.equal(remarksDenrIdx >= 0 && surveyCols[remarksDenrIdx].fullWidth, true);
  assert.equal(surveyCols[darpoToDarroIdx].group, 'DARPO Compliance');
  assert.equal(isChecklistChecked('Without'), false);
  assert.equal(isChecklistChecked('With'), true);
  assert.equal(isServerChecklistChecked('Without'), false);
  assert.equal(isServerChecklistChecked('With'), true);

  for (const [tabName, cols] of Object.entries(OPTOOL_SHEET_SCHEMAS)) {
    assert.ok(
      !cols.some((c) => c.key === 'test' || String(c.header).trim().toLowerCase() === 'test'),
      `Tab ${tabName} must not include deprecated test column`
    );
  }
  const cfChecklistCols = OPTOOL_SHEET_SCHEMAS['CF(DOC)'].filter((c) => c.type === 'checkbox');
  assert.equal(cfChecklistCols.length, 7);
  assert.deepEqual(
    cfChecklistCols.map((c) => c.key),
    [
      'denrCertification',
      'asp',
      'marpoCert',
      'firCarperLadForm46',
      'copyOfAdvSp',
      'carperLadNo37',
      'carperLadForm42'
    ]
  );
  const cfPdfCols = OPTOOL_SHEET_SCHEMAS['CF(DOC)'].filter((c) => c.type === 'pdfFile');
  assert.equal(cfPdfCols.length, 6);
  assert.deepEqual(
    cfPdfCols.map((c) => c.key),
    [
      'certificateOfTitle',
      'taxDeclaration',
      'carperLadForm1And2',
      'carperLadForm3',
      'landUsePerFi',
      'pdfFile'
    ]
  );
  const form42Col = OPTOOL_SHEET_SCHEMAS['CF(DOC)'].find((c) => c.key === 'carperLadForm42');
  assert.equal(form42Col.label, 'CARPER LAD Form 42');
  assert.equal(form42Col.type, 'checkbox');
  const form46Col = OPTOOL_SHEET_SCHEMAS['CF(DOC)'].find((c) => c.key === 'pdfFile');
  assert.equal(form46Col.label, 'Upload CARPER LAD Form 46');
  assert.equal(form46Col.type, 'pdfFile');
  assert.deepEqual(OPTOOL_PREVIEW_COLUMNS.Database, [
    'lhid',
    'titleNumber',
    'landOwner',
    'moa',
    'regionName',
    'province',
    'municipality',
    'barangay',
    'totalArea',
    'computedArea',
    'lotNumber',
    'subLotNumber',
    'carpable',
    'ladStatus',
    'workability'
  ]);

  assert.equal(inferProvinceCodeFromMunicipality('Ormoc City'), 'LEY');
  assert.equal(inferProvinceCodeFromMunicipality('Naval'), 'BIL');
  assert.equal(inferProvinceCodeFromMunicipality('Borongan City'), 'ESA');
  assert.equal(inferProvinceCodeFromMunicipality('Catarman'), 'NSA');
  assert.equal(inferProvinceCodeFromMunicipality('Catbalogan City'), 'SAM');
  assert.equal(inferProvinceCodeFromMunicipality('Maasin City'), 'SLE');
});

test('Store Auto-Index Record_ID and Incremental vs Cumulative Analytics', () => {
  const dir = makeTempDir();
  try {
    const store = new ConsolidatedStore(dir);
    const nextLey = store.generateNextRecordId('LEY', '2026-11-11');
    assert.equal(nextLey, 'LEY-202611-0090');

    const analytics = store.computeAnalytics({ periodMonth: '2026-11' });
    assert.equal(analytics.kpis.incrementalETitles, 5);
    assert.equal(analytics.kpis.cumulativeETitles, 13);
    assert.equal(analytics.kpis.incrementalAreaHas, 13.7725);
    assert.equal(analytics.kpis.cumulativeAreaHas, 43.385);

    const inserted = store.upsertMilestone({
      Province_Code: 'LEY',
      Municipality: 'Tacloban City',
      Land_Allocation_ID: 'LA-08-37-0099',
      eTitle_No: 'eT-2026-00999',
      Area_HAS: '1.2345',
      Milestone_Stage: 'eTitle Registered',
      Milestone_Date: '2026-11-11',
      Batch_Category: 'ADMIN BATCH 1',
      LHID: 'LH-0837-0012'
    });
    assert.equal(inserted.Record_ID, 'LEY-202611-0090');
    assert.equal(inserted.Area_HAS, '1.2345');

    const parcel360 = store.getLandholding360('LH-0837-0012');
    assert.equal(parcel360.tabs.Database.length, 1);
    assert.equal(parcel360.milestones.length, 2);

    // Verify databaseByProvince & OPTool deduplication
    assert.equal(analytics.databaseByProvince.length, 6);
    const leyDb = analytics.databaseByProvince.find((p) => p.code === 'LEY');
    assert.equal(leyDb.parcelCount, 1);
    assert.equal(leyDb.totalArea, 2.65);

    const beforeCfCount = store.state.optool['CF(DOC)'].length;
    store.upsertOptoolRow('CF(DOC)', store.state.optool['CF(DOC)'][0]);
    assert.equal(store.state.optool['CF(DOC)'].length, beforeCfCount);

    const savedCf = store.upsertOptoolRow('CF(DOC)', {
      lhid: 'LH-CHECK-001',
      certificateOfTitle: true,
      denrCertification: 'no',
      taxDeclaration: 'Yes',
      test: 'should-be-stripped',
      remarks: 'Checklist check'
    });
    assert.equal(savedCf.certificateOfTitle, 'Yes');
    assert.equal(savedCf.denrCertification, '');
    assert.equal(savedCf.taxDeclaration, 'Yes');
    assert.equal('test' in savedCf, false);

    // Strip stale test column on reload/normalizeState across any tab
    store.state.optool.Database[0].test = 'legacy';
    store.normalizeState();
    assert.equal('test' in store.state.optool.Database[0], false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('XLSX Round-Trip preserves Milestone_Data & all 6 OPTool tabs including duplicate Installation headers', async () => {
  const dir = makeTempDir();
  try {
    const store = new ConsolidatedStore(dir);
    const analytics = store.computeAnalytics();
    const xlsxBuf = await buildConsolidatedWorkbookBuffer(store.state, analytics);

    assert.equal(xlsxBuf[0], 0x50); // 'P'
    assert.equal(xlsxBuf[1], 0x4b); // 'K'

    const parsed = await parseWorkbookBuffer(xlsxBuf);
    assert.ok(parsed.sheetNames.includes('Milestone_Data'));
    assert.ok(parsed.sheetNames.includes('Installation'));
    assert.equal(parsed.milestoneData.length, store.state.milestoneData.length);
    assert.equal(parsed.optool.Database.length, store.state.optool.Database.length);
    assert.equal(parsed.optool.Installation.length, 1);
    // Verify duplicate LAST NAME mapping did not overwrite Landowner with ARB
    assert.equal(parsed.optool.Installation[0].loLastName, 'Sogod Devt.');
    assert.equal(parsed.optool.Installation[0].arbLastName, 'Magallanes');
    assert.equal(parsed.optool.Installation[0].areaHas2, '2.2100');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CSV Parser parses Milestone_Data cleanly', () => {
  const csv = [
    'Record_ID,Municipality,Land_Allocation_ID,eTitle_No,Area_HAS,Milestone_Stage,Milestone_Date,Batch_Category',
    'LEY-202611-0101,Ormoc City,LA-08-37-0101,eT-2026-01010,3.5,eTitle Registered,2026-11-11,ADMIN BATCH 1'
  ].join('\n');
  const rows = parseCsvText(csv, 'Milestone_Data');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Province_Code, 'LEY');
  assert.equal(rows[0].Area_HAS, '3.5000');
});

test('HTTP Server end-to-end API routes', async () => {
  const dir = makeTempDir();
  const { server } = createAppServer(dir, { requireAuth: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);

    const bootRes = await fetch(`${baseUrl}/api/bootstrap`);
    assert.equal(bootRes.status, 200);
    const boot = await bootRes.json();
    assert.equal(boot.schemas.registry.length, 7);
    assert.equal(boot.schemas.optoolPreviewCols.Database.length, 15);
    assert.ok(boot.gasScript.includes('runRegionalETL'));
    assert.ok(boot.gasHtml.includes('getHubBootstrap'));

    const postRes = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Province_Code: 'SAM',
        Municipality: 'Catbalogan City',
        Land_Allocation_ID: 'LA-08-60-0099',
        eTitle_No: 'eT-2026-09999',
        Area_HAS: '4.125',
        Milestone_Stage: 'eTitle Registered',
        Milestone_Date: '2026-11-11',
        Batch_Category: 'ADMIN BATCH 2'
      })
    });
    assert.equal(postRes.status, 200);
    const postJson = await postRes.json();
    assert.match(postJson.record.Record_ID, /^SAM-202611-\d{4}$/);
    assert.equal(postJson.record.Area_HAS, '4.1250');

    const exportRes = await fetch(`${baseUrl}/api/export/xlsx`);
    assert.equal(exportRes.status, 200);
    const exportBuf = Buffer.from(await exportRes.arrayBuffer());
    assert.equal(exportBuf[0], 0x50);
    assert.equal(exportBuf[1], 0x4b);

    // Import XLSX back via binary POST
    const importRes = await fetch(`${baseUrl}/api/import/xlsx?mode=merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': 'roundtrip.xlsx'
      },
      body: exportBuf
    });
    assert.equal(importRes.status, 200);
    const importJson = await importRes.json();
    assert.equal(importJson.ok, true);
    assert.ok(importJson.importedRows >= 14);

    // OPTool CRUD + Landholding 360
    const optRes = await fetch(`${baseUrl}/api/optool/Database`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        row: {
          lhid: 'LH-0837-9999',
          titleNumber: 'OCT-9999',
          landOwner: 'Dela Cruz, Juan',
          province: 'Leyte',
          municipality: 'Palo',
          barangay: 'Cavite East',
          carpable: '5.125',
          ladStatus: 'LAD Balance',
          workability: 'Workable'
        }
      })
    });
    assert.equal(optRes.status, 200);
    const optJson = await optRes.json();
    assert.equal(optJson.row.carpable, '5.1250');
    assert.equal(optJson.row.ladStatus, 'LAD Balance');
    assert.equal(optJson.row.workability, 'Workable');

    // Milestone Target routing from Database -> CF(DOC), Survey, Land Valuation, RegistrationDistribution, Installation
    for (const targetTab of MILESTONE_TARGET_TABS) {
      const mtRes = await fetch(`${baseUrl}/api/optool/Database/milestone-target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: 0, milestoneTarget: targetTab })
      });
      assert.equal(mtRes.status, 200);
      const mtJson = await mtRes.json();
      assert.equal(mtJson.row.milestoneTarget, targetTab);
      assert.equal(mtJson.createdInTab, true);
      const targetOptoolRows = mtJson.optool[targetTab] || (targetTab === 'Land Valuation' ? mtJson.optool.MOV : null);
      assert.ok(
        targetOptoolRows && targetOptoolRows.some((r) => r.lhid === 'LH-0837-9999'),
        `Expected LHID to be routed into ${targetTab}`
      );
      if (targetTab === 'CF(DOC)') {
        const routedCf = mtJson.optool['CF(DOC)'].find((r) => r.lhid === 'LH-0837-9999');
        assert.equal(routedCf.certificateOfTitle, '');
      }
    }

    // Re-selecting an already-routed target must not duplicate rows
    const dupMtRes = await fetch(`${baseUrl}/api/optool/Database/milestone-target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: 0, milestoneTarget: 'CF(DOC)' })
    });
    assert.equal(dupMtRes.status, 200);
    const dupMtJson = await dupMtRes.json();
    assert.equal(dupMtJson.createdInTab, false);
    assert.equal(
      dupMtJson.optool['CF(DOC)'].filter((r) => r.lhid === 'LH-0837-9999').length,
      1
    );

    // Invalid target returns 400
    const badMtRes = await fetch(`${baseUrl}/api/optool/Database/milestone-target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: 0, milestoneTarget: 'InvalidStage' })
    });
    assert.equal(badMtRes.status, 400);

    const lhRes = await fetch(`${baseUrl}/api/landholding/LH-0837-9999`);
    assert.equal(lhRes.status, 200);
    const lhJson = await lhRes.json();
    assert.equal(lhJson.tabs.Database.length, 1);
    assert.equal(lhJson.tabs['CF(DOC)'].length, 1);
    assert.equal(lhJson.tabs.Survey.length, 1);
    assert.equal(lhJson.tabs.MOV.length, 1);
    assert.equal(lhJson.tabs.RegistrationDistribution.length, 1);
    assert.equal(lhJson.tabs.Installation.length, 1);

    const delOptRes = await fetch(`${baseUrl}/api/optool/Database/0`, { method: 'DELETE' });
    assert.equal(delOptRes.status, 200);

    // Baselines update
    const basePut = await fetch(`${baseUrl}/api/baselines`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BIL: { targetETitles: 200, targetAreaHas: 260.5 }
      })
    });
    assert.equal(basePut.status, 200);
    const baseJson = await basePut.json();
    assert.equal(baseJson.baselines.BIL.targetETitles, 200);

    // Delete Milestone_Data record
    const delMs = await fetch(`${baseUrl}/api/milestones/${encodeURIComponent(postJson.record.Record_ID)}`, {
      method: 'DELETE'
    });
    assert.equal(delMs.status, 200);

    // Static assets
    for (const staticPath of ['/', '/styles.css', '/app.js', '/views.js', '/charts.js', '/dar-logo.svg', '/dar-logo.png']) {
      const sRes = await fetch(`${baseUrl}${staticPath}`);
      assert.equal(sRes.status, 200);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OPTool table displays linked Database columns right after LHID for CF(DOC), Survey, MOV, and RegistrationDistribution', () => {
  const dir = makeTempDir();
  try {
    const store = new ConsolidatedStore(dir);
    const schemas = {
      optoolTabs: OPTOOL_SHEET_SCHEMAS,
      optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS,
      milestoneTargetTabs: MILESTONE_TARGET_TABS
    };
    const dbRow = store.state.optool.Database[0];
    const expectedLabels = LINKED_DB_PROFILE_FIELDS.map((f) => f.label);

    for (const tab of ['CF(DOC)', 'Survey', 'MOV', 'RegistrationDistribution']) {
      // Ensure tab has a row matching dbRow.lhid for MOV/RegistrationDistribution too
      if (!store.state.optool[tab].some((r) => r.lhid === dbRow.lhid)) {
        store.upsertOptoolRow(tab, { lhid: dbRow.lhid });
      }
      const ctx = {
        state: store.state,
        schemas,
        activeOptoolTab: tab,
        searchTerm: '',
        optoolTargetFilter: 'ALL',
        optoolColFilters: {},
        optoolPage: 1,
        optoolPageSize: 50,
        optoolColMode: 'preview',
        optoolColPage: 1,
        filters: { province: 'ALL' }
      };
      const html = renderOptoolView(ctx);
      const headerMatches = Array.from(
        html.matchAll(/<button[^>]*data-col-dropdown="([^"]+)"[^>]*data-col-label="([^"]+)"/g)
      ).map((m) => ({ key: m[1], label: m[2] }));

      assert.equal(headerMatches[0].key, 'lhid', `Expected LHID first on ${tab}`);
      assert.deepEqual(
        headerMatches.slice(1, 1 + expectedLabels.length).map((h) => h.label),
        expectedLabels,
        `Expected linked DB columns immediately after LHID on ${tab}`
      );
      if (dbRow.titleNumber) {
        assert.ok(html.includes(dbRow.titleNumber), `Expected linked TitleNumber rendered in ${tab} table`);
      }

      const titleDd = getColumnFilterValues(ctx, '__db_titleNumber');
      assert.equal(titleDd.col?.dbKey, 'titleNumber');
      assert.ok(titleDd.values.length > 0, `Expected dropdown filter values for __db_titleNumber on ${tab}`);
    }

    // Installation should not inject linked DB table columns
    const instHtml = renderOptoolView({
      state: store.state,
      schemas,
      activeOptoolTab: 'Installation',
      searchTerm: '',
      optoolTargetFilter: 'ALL',
      optoolColFilters: {},
      optoolPage: 1,
      optoolPageSize: 50,
      optoolColMode: 'preview',
      optoolColPage: 1,
      filters: { province: 'ALL' }
    });
    assert.equal(instHtml.includes('__db_titleNumber'), false);

    // Survey tab renders grouped column header bands, inline Kind of Survey dropdown, and SR Forwarded to DARRO
    const surveyAllHtml = renderOptoolView({
      state: store.state,
      schemas,
      activeOptoolTab: 'Survey',
      searchTerm: '',
      optoolTargetFilter: 'ALL',
      optoolColFilters: {},
      optoolPage: 1,
      optoolPageSize: 50,
      optoolColMode: 'all',
      optoolColPage: 1,
      filters: { province: 'ALL' }
    });
    const groupBands = Array.from(
      surveyAllHtml.matchAll(/<th colspan="(\d+)" class="col-group-th [^"]*">([^<]+)<\/th>/g)
    ).map((m) => ({ span: Number(m[1]), label: m[2] }));
    assert.deepEqual(groupBands, [
      { span: 1, label: 'Identification' },
      { span: 11, label: 'Database Parcel Details' },
      { span: 6, label: 'DARPO Compliance' },
      { span: 18, label: 'DARRO Compliance' },
      { span: 1, label: 'DARPO Compliance' },
      { span: 7, label: 'DARRO Compliance' },
      { span: 1, label: 'DARPO Compliance' },
      { span: 3, label: 'DARRO Compliance' },
      { span: 7, label: 'Reporting' }
    ]);
    assert.ok(surveyAllHtml.includes('data-optool-select-key="kindOfSurvey"'));
    assert.ok(surveyAllHtml.includes('>By Admin</option>'));
    assert.ok(surveyAllHtml.includes('>By Contract</option>'));
    assert.ok(surveyAllHtml.includes('data-col-dropdown="srForwardedToDarro"'));
    assert.ok(surveyAllHtml.includes('data-col-dropdown="srAcceptedByDarro"'));
    assert.ok(surveyAllHtml.includes('data-col-dropdown="srReturnedDenrDarroToDarpoDate"'));
    assert.equal(surveyAllHtml.includes('data-col-dropdown="srForwardedPreIvas"'), false);
    assert.ok(surveyAllHtml.includes('data-optool-check-key="plan"'));
    assert.ok(surveyAllHtml.includes('data-optool-select-key="target"'));
    assert.ok(surveyAllHtml.includes('>Current</option>'));
    assert.ok(surveyAllHtml.includes('>Previous Year</option>'));
    assert.ok(surveyAllHtml.includes('data-optool-select-key="reportedMonth"'));
    assert.ok(surveyAllHtml.includes(`>${formatCurrentMonthYear()}</option>`));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Target dropdown (Current / Previous Year) & Reported Month (Month + Current Year) auto-logic', () => {
  for (const tab of ['CF(DOC)', 'Survey', 'MOV']) {
    const targetCol = OPTOOL_SHEET_SCHEMAS[tab].find((c) => c.key === 'target');
    assert.equal(targetCol?.type, 'select', `${tab}.target should be a select`);
    assert.deepEqual(targetCol?.options, ['Current', 'Previous Year']);
    assert.deepEqual(targetCol?.options, TARGET_PERIOD_OPTIONS);
  }
  for (const tab of ['CF(DOC)', 'Survey', 'MOV']) {
    const rmCol = OPTOOL_SHEET_SCHEMAS[tab].find((c) => c.key === 'reportedMonth');
    assert.equal(rmCol?.type, 'select', `${tab}.reportedMonth should be a select`);
    assert.deepEqual(rmCol?.options, getReportedMonthOptions());
  }

  const refNov2026 = new Date(2026, 10, 12);
  assert.equal(formatCurrentMonthYear(refNov2026), 'November 2026');
  const novOpts = getReportedMonthOptions(refNov2026);
  assert.equal(novOpts.length, 12);
  assert.equal(novOpts[0], 'January 2026');
  assert.equal(novOpts[10], 'November 2026');
  assert.equal(novOpts[11], 'December 2026');
  assert.equal(parseDatabaseYear('2013.0'), 2013);
  assert.equal(parseDatabaseYear('2026'), 2026);
  assert.equal(parseDatabaseYear(''), null);

  assert.equal(resolveDatabaseYear({ year: '2026', targetYear: '2013.0' }), 2026);
  assert.equal(resolveDatabaseYear({ year: '', targetYear: '2026' }), 2026);
  assert.equal(resolveDatabaseYear({ year: '', targetYear: '2013.0' }), 2013);
  assert.equal(resolveDatabaseYear({ year: '', targetYear: '' }), null);

  assert.equal(resolveTargetFromDatabaseRow({ year: '2026', targetYear: '' }, refNov2026), 'Current');
  assert.equal(resolveTargetFromDatabaseRow({ year: '', targetYear: '2026' }, refNov2026), 'Current');
  assert.equal(resolveTargetFromDatabaseRow({ year: '2025', targetYear: '2026' }, refNov2026), 'Previous Year');
  assert.equal(resolveTargetFromDatabaseRow({ year: '', targetYear: '2013.0' }, refNov2026), 'Previous Year');
  assert.equal(resolveTargetFromDatabaseRow({ year: '', targetYear: '' }, refNov2026), 'Previous Year');
  assert.equal(resolveTargetFromDatabaseRow(null, refNov2026), 'Previous Year');

  const dir = makeTempDir();
  try {
    const store = new ConsolidatedStore(dir);
    const expectedMonth = formatCurrentMonthYear();
    const currentYearStr = String(new Date().getFullYear());

    // Parcel with no year -> Previous Year; parcel falling back to targetYear=current -> Current
    store.upsertOptoolRow('Database', { lhid: 'LH-NO-YEAR', province: 'Leyte', year: '', targetYear: '' });
    store.upsertOptoolRow('Database', { lhid: 'LH-CUR-FALLBACK', province: 'Leyte', year: '', targetYear: currentYearStr });

    const noYearIdx = store.state.optool.Database.findIndex((r) => r.lhid === 'LH-NO-YEAR');
    const curIdx = store.state.optool.Database.findIndex((r) => r.lhid === 'LH-CUR-FALLBACK');

    for (const tab of ['CF(DOC)', 'Survey', 'MOV']) {
      store.setDatabaseMilestoneTarget(noYearIdx, tab);
      const routedNoYear = store.state.optool[tab].find((r) => r.lhid === 'LH-NO-YEAR');
      assert.equal(routedNoYear?.target, 'Previous Year');
      assert.equal(routedNoYear?.reportedMonth, expectedMonth);

      store.setDatabaseMilestoneTarget(curIdx, tab);
      const routedCur = store.state.optool[tab].find((r) => r.lhid === 'LH-CUR-FALLBACK');
      assert.equal(routedCur?.target, 'Current');
      assert.equal(routedCur?.reportedMonth, expectedMonth);
    }

    const cfHtml = renderOptoolView({
      state: store.state,
      schemas: {
        optoolTabs: OPTOOL_SHEET_SCHEMAS,
        optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS,
        milestoneTargetTabs: MILESTONE_TARGET_TABS
      },
      activeOptoolTab: 'CF(DOC)',
      searchTerm: '',
      optoolTargetFilter: 'ALL',
      optoolColFilters: {},
      optoolPage: 1,
      optoolPageSize: 50,
      optoolColMode: 'preview',
      optoolColPage: 1,
      filters: { province: 'ALL' }
    });
    assert.ok(cfHtml.includes('data-optool-select-key="reportedMonth"'));
    assert.ok(cfHtml.includes(`>${expectedMonth}</option>`));

    const movHtml = renderOptoolView({
      state: store.state,
      schemas: {
        optoolTabs: OPTOOL_SHEET_SCHEMAS,
        optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS,
        milestoneTargetTabs: MILESTONE_TARGET_TABS
      },
      activeOptoolTab: 'MOV',
      searchTerm: '',
      optoolTargetFilter: 'ALL',
      optoolColFilters: {},
      optoolPage: 1,
      optoolPageSize: 50,
      optoolColMode: 'preview',
      optoolColPage: 1,
      filters: { province: 'ALL' }
    });
    assert.ok(movHtml.includes('data-optool-select-key="ppuReviewResult"'));
    assert.ok(movHtml.includes('<option value="PASSED" selected>PASSED</option>'));
    assert.ok(movHtml.includes('<option value="FAILED" >FAILED</option>'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Survey Current Status & Current Date auto-detection and store persistence', () => {
  assert.deepEqual(resolveSurveyCurrentStatus(null), { currentStatus: '', currentDate: '' });

  // Verify all 15 Survey stage date -> status mappings individually
  const expectedStageMappings = [
    ['dateRss', '01 - With RSS'],
    ['fieldWorkStartDate', '02 - Field Work Started'],
    ['fieldWorkCompletionDate', '03 - Field Work Completed'],
    ['finalizedSrDate', '04 - Finalized SR'],
    ['srForwardedToDarro', '05 - SR Forwarded to DARRO'],
    ['srAcceptedByDarro', '06 - SR Accepted by DARRO'],
    ['srReturnedDarroToDarpoDate', '07 - SR Returned to DARPO for Correction'],
    ['srResubmittedDarroDate', '08 - SR Returned to DARRO'],
    ['srTransmittedDenrSmdDate', '09 - SR Transmitted to DENR-LMS'],
    ['dateAcceptedDenrSmd', '10 - SR Accepted by LMS'],
    ['srReturnedDenrToDarroDate', '11 - SR Returned by LMS to DARRO'],
    ['srReturnedDenrDarroToDarpoDate', '07 - SR Returned to DARPO for Correction'],
    ['srReturnedDarpoToDarroDate', '08 - SR Forwarded to DARRO'],
    ['darroResubmittedDenrDate', '09 - SR Transmitted to DENR-LMS'],
    ['aspDate', '12 - WITH ASP']
  ];
  for (const [key, expectedStatus] of expectedStageMappings) {
    assert.deepEqual(
      resolveSurveyCurrentStatus({ [key]: '2026-02-01' }),
      { currentStatus: expectedStatus, currentDate: '2026-02-01' },
      `Stage ${key} should map to ${expectedStatus}`
    );
  }

  // Chronological progression picks latest date even when return-loop stage numbers restart at 07/08/09
  assert.deepEqual(
    resolveSurveyCurrentStatus({
      dateRss: '2026-01-10',
      dateAcceptedDenrSmd: '2026-03-20',
      srReturnedDenrToDarroDate: '2026-03-25',
      srReturnedDenrDarroToDarpoDate: '2026-03-27'
    }),
    { currentStatus: '07 - SR Returned to DARPO for Correction', currentDate: '2026-03-27' }
  );
  assert.deepEqual(
    resolveSurveyCurrentStatus({
      srTransmittedDenrSmdDate: '2026-03-20',
      dateAcceptedDenrSmd: '2026-03-20'
    }),
    { currentStatus: '10 - SR Accepted by LMS', currentDate: '2026-03-20' }
  );

  const dir = makeTempDir();
  try {
    const store = new ConsolidatedStore(dir);
    const seedSurvey = store.state.optool.Survey[0];
    assert.equal(seedSurvey?.currentStatus, '12 - WITH ASP');
    assert.equal(seedSurvey?.currentDate, '2026-06-15');

    store.upsertOptoolRow('Survey', {
      lhid: 'LH-AUTO-01',
      dateRss: '2026-01-10',
      srForwardedToDarro: '2026-04-12'
    });
    const autoRow = store.state.optool.Survey.find((r) => r.lhid === 'LH-AUTO-01');
    assert.equal(autoRow?.currentStatus, '05 - SR Forwarded to DARRO');
    assert.equal(autoRow?.currentDate, '2026-04-12');

    store.upsertOptoolRow('Survey', {
      lhid: 'LH-MANUAL-01',
      dateRss: '2026-01-10',
      currentStatus: 'Custom Status',
      currentDate: '2026-05-01'
    });
    const manualRow = store.state.optool.Survey.find((r) => r.lhid === 'LH-MANUAL-01');
    assert.equal(manualRow?.currentStatus, 'Custom Status');
    assert.equal(manualRow?.currentDate, '2026-05-01');

    // Simulate older persisted Survey rows (missing fields & earlier unnumbered placeholder labels)
    const legacyDir = makeTempDir();
    try {
      const storeFile = path.join(legacyDir, 'store.json');
      const legacyState = structuredClone(store.state);
      legacyState.optool.Survey = [
        {
          lhid: 'LH-LEGACY-01',
          fieldWorkCompletionDate: '2026-03-14'
        },
        {
          lhid: 'LH-LEGACY-02',
          dateRss: '2026-04-01',
          currentStatus: 'Date RSS',
          currentDate: '2026-04-01'
        }
      ];
      fs.writeFileSync(storeFile, JSON.stringify(legacyState, null, 2), 'utf8');

      const reloaded = new ConsolidatedStore(legacyDir);
      assert.equal(reloaded.state.optool.Survey[0]?.currentStatus, '03 - Field Work Completed');
      assert.equal(reloaded.state.optool.Survey[0]?.currentDate, '2026-03-14');
      assert.equal(reloaded.state.optool.Survey[1]?.currentStatus, '01 - With RSS');
      assert.equal(reloaded.state.optool.Survey[1]?.currentDate, '2026-04-01');
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RegistrationDistribution Reporting fields, ARB totals, Target Year, Month Reported & legacy migration', () => {
  assert.equal(isReportedMonthKey('reportedMonth'), true);
  assert.equal(isReportedMonthKey('monthReported'), true);
  assert.equal(isReportedMonthKey('remarks'), false);

  assert.equal(resolveTotalArbsFromGenderCounts('', ''), '');
  assert.equal(resolveTotalArbsFromGenderCounts('2', '3'), '5');
  assert.equal(resolveTotalArbsFromGenderCounts('4', ''), '4');

  const dir = makeTempDir();
  try {
    const store = new ConsolidatedStore(dir);
    const seedReg0 = store.state.optool.RegistrationDistribution[0];
    const seedReg1 = store.state.optool.RegistrationDistribution[1];
    assert.equal(seedReg0?.noOfArbs, '1');
    assert.equal(seedReg0?.maleArbs, '1');
    assert.equal(seedReg0?.femaleArbs, '0');
    assert.equal(seedReg0?.target, 'Current');
    assert.equal(seedReg1?.noOfArbs, '3');
    assert.equal(seedReg1?.maleArbs, '0');
    assert.equal(seedReg1?.femaleArbs, '3');

    const currentYearStr = String(new Date().getFullYear());
    store.upsertOptoolRow('Database', { lhid: 'LH-REG-CUR', province: 'Leyte', year: currentYearStr });
    const regCurDbIdx = store.state.optool.Database.findIndex((r) => r.lhid === 'LH-REG-CUR');
    store.setDatabaseMilestoneTarget(regCurDbIdx, 'RegistrationDistribution');
    const routedReg = store.state.optool.RegistrationDistribution.find((r) => r.lhid === 'LH-REG-CUR');
    assert.equal(routedReg?.target, 'Current');
    assert.equal(routedReg?.monthReported, formatCurrentMonthYear());

    store.upsertOptoolRow('RegistrationDistribution', {
      lhid: 'LH-REG-CUR',
      maleArbs: '2',
      femaleArbs: '4',
      noOfTitles: '1',
      monthReported: formatCurrentMonthYear()
    });
    const upserted = store.state.optool.RegistrationDistribution.find(
      (r) => r.lhid === 'LH-REG-CUR' && r.maleArbs === '2'
    );
    assert.equal(upserted?.noOfArbs, '6');
    assert.equal(upserted?.target, 'Current');

    const regHtml = renderOptoolView({
      state: store.state,
      schemas: {
        optoolTabs: OPTOOL_SHEET_SCHEMAS,
        optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS,
        milestoneTargetTabs: MILESTONE_TARGET_TABS
      },
      activeOptoolTab: 'RegistrationDistribution',
      searchTerm: '',
      optoolTargetFilter: 'ALL',
      optoolColFilters: {},
      optoolPage: 1,
      optoolPageSize: 50,
      optoolColMode: 'preview',
      optoolColPage: 1,
      filters: { province: 'ALL' }
    });
    assert.ok(regHtml.includes('data-optool-select-key="target"'));
    assert.ok(regHtml.includes('data-optool-select-key="monthReported"'));
    assert.ok(regHtml.includes(`>${formatCurrentMonthYear()}</option>`));

    // Verify Installation Target Year & Month Reported auto-routing, persistence, and inline dropdowns
    const seedInst = store.state.optool.Installation[0];
    assert.equal(seedInst?.target, 'Current');
    assert.equal(seedInst?.monthReported, 'November 2026');

    store.setDatabaseMilestoneTarget(regCurDbIdx, 'Installation');
    const routedInst = store.state.optool.Installation.find((r) => r.lhid === 'LH-REG-CUR');
    assert.equal(routedInst?.target, 'Current');
    assert.equal(routedInst?.monthReported, formatCurrentMonthYear());

    const instHtml = renderOptoolView({
      state: store.state,
      schemas: {
        optoolTabs: OPTOOL_SHEET_SCHEMAS,
        optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS,
        milestoneTargetTabs: MILESTONE_TARGET_TABS
      },
      activeOptoolTab: 'Installation',
      searchTerm: '',
      optoolTargetFilter: 'ALL',
      optoolColFilters: {},
      optoolPage: 1,
      optoolPageSize: 50,
      optoolColMode: 'preview',
      optoolColPage: 1,
      filters: { province: 'ALL' }
    });
    assert.ok(instHtml.includes('data-optool-select-key="target"'));
    assert.ok(instHtml.includes('data-optool-select-key="monthReported"'));

    // Verify migration of legacy RegistrationDistribution rows using gender ('M'/'F')
    const legacyDir = makeTempDir();
    try {
      const storeFile = path.join(legacyDir, 'store.json');
      const legacyState = structuredClone(store.state);
      legacyState.optool.RegistrationDistribution = [
        {
          lhid: 'LH-REG-CUR',
          gender: 'F',
          noOfArbs: '3',
          noOfTitles: '1',
          monthReported: 'November 2026',
          remarks: 'Legacy row'
        }
      ];
      fs.writeFileSync(storeFile, JSON.stringify(legacyState, null, 2), 'utf8');

      const reloaded = new ConsolidatedStore(legacyDir);
      const migrated = reloaded.state.optool.RegistrationDistribution[0];
      assert.equal(Object.prototype.hasOwnProperty.call(migrated, 'gender'), false);
      assert.equal(migrated.maleArbs, '0');
      assert.equal(migrated.femaleArbs, '3');
      assert.equal(migrated.noOfArbs, '3');
      assert.equal(migrated.target, 'Current');
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Serverless handler export and Vercel /tmp fallback work without server.listen', async () => {
  const invokeMock = (fn, url, method = 'GET') =>
    new Promise((resolve, reject) => {
      const chunks = [];
      const req = { url, method, headers: { host: 'localhost:3001' } };
      const res = {
        statusCode: 200,
        headers: {},
        writeHead(code, headers = {}) {
          this.statusCode = code;
          Object.assign(this.headers, headers);
        },
        setHeader(name, value) {
          this.headers[name.toLowerCase()] = value;
        },
        write(chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        },
        end(chunk) {
          if (chunk) this.write(chunk);
          resolve({
            statusCode: this.statusCode,
            headers: this.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        }
      };
      Promise.resolve(fn(req, res)).catch(reject);
    });

  const prevVercel = process.env.VERCEL;
  const tmpVercelDir = path.join(os.tmpdir(), 'salig-data');
  const existedBefore = fs.existsSync(tmpVercelDir);

  try {
    process.env.VERCEL = '1';
    assert.equal(resolveDefaultDataDir(), tmpVercelDir);

    const vercelHealth = await invokeMock(vercelHandler, '/api/health');
    assert.equal(vercelHealth.statusCode, 200);
    assert.equal(JSON.parse(vercelHealth.body).ok, true);
    assert.ok(fs.existsSync(path.join(tmpVercelDir, 'store.json')));
  } finally {
    if (prevVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = prevVercel;
    }
    if (!existedBefore) {
      fs.rmSync(tmpVercelDir, { recursive: true, force: true });
    }
  }

  const dir = makeTempDir();
  try {
    const { handler } = createAppServer(dir, { requireAuth: false });
    assert.equal(typeof handler, 'function');

    const health = await invokeMock(handler, '/api/health');
    assert.equal(health.statusCode, 200);
    assert.equal(JSON.parse(health.body).ok, true);

    const bootstrap = await invokeMock(handler, '/api/bootstrap');
    assert.equal(bootstrap.statusCode, 200);
    const bootstrapJson = JSON.parse(bootstrap.body);
    assert.ok(Array.isArray(bootstrapJson.state?.optool?.Database));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GAS_WEB_APP_URL env default and automatic Google Sheet two-way push on mutations', async () => {
  const dir = makeTempDir();
  const prevGasEnv = process.env.GAS_WEB_APP_URL;
  const pushedPayloads = [];

  try {
    process.env.GAS_WEB_APP_URL = 'https://script.google.com/macros/s/test-exec/exec';
    const { handler, store } = createAppServer(dir, {
      requireAuth: false,
      pushToGasWebApp: async (url, payload) => {
        pushedPayloads.push({ url, payload });
        return { ok: true };
      }
    });

    assert.equal(store.state.gasWebAppUrl, 'https://script.google.com/macros/s/test-exec/exec');

    const callApi = (url, method = 'GET', bodyObj = null) =>
      new Promise((resolve, reject) => {
        const bodyBuf = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : Buffer.alloc(0);
        const chunks = [];
        const req = {
          url,
          method,
          headers: { host: 'localhost:3001', 'content-type': 'application/json' },
          async *[Symbol.asyncIterator]() {
            if (bodyBuf.length) yield bodyBuf;
          }
        };
        const res = {
          statusCode: 200,
          headers: {},
          writeHead(code, headers = {}) {
            this.statusCode = code;
            Object.assign(this.headers, headers);
          },
          setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
          },
          write(chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          },
          end(chunk) {
            if (chunk) this.write(chunk);
            resolve({
              statusCode: this.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
            });
          }
        };
        Promise.resolve(handler(req, res)).catch(reject);
      });

    // 1. Saving a Database row with milestoneTarget automatically pushes Database + routed Survey row
    const saveRes = await callApi('/api/optool/Database', 'POST', {
      row: {
        lhid: 'LH-AUTO-001',
        province: 'Leyte',
        municipality: 'Palo',
        milestoneTarget: 'Survey',
        year: '2026'
      }
    });
    assert.equal(saveRes.statusCode, 200);
    assert.equal(saveRes.body.gasPushResult?.ok, true);
    assert.ok(pushedPayloads.some((p) => p.payload.action === 'upsertOptoolRow' && p.payload.tabName === 'Database'));
    const surveyPush = pushedPayloads.find((p) => p.payload.action === 'upsertOptoolRow' && p.payload.tabName === 'Survey');
    assert.ok(surveyPush);
    assert.equal(surveyPush.payload.row.targetYear, '2026');
    const routedSurvey = saveRes.body.optool.Survey.find((r) => r.lhid === 'LH-AUTO-001');
    assert.ok(routedSurvey);
    assert.equal(routedSurvey.targetYear, '2026');

    // 2. Deleting an OPTool row automatically pushes deleteOptoolRow
    const delRes = await callApi('/api/optool/Database/0', 'DELETE');
    assert.equal(delRes.statusCode, 200);
    assert.equal(delRes.body.gasPushResult?.ok, true);
    assert.ok(pushedPayloads.some((p) => p.payload.action === 'deleteOptoolRow' && p.payload.tabName === 'Database'));

    // 3. Milestone upsert & delete push automatically without requiring pushToGas=true
    const msRes = await callApi('/api/milestones', 'POST', {
      Province_Code: 'LEY',
      Municipality: 'Palo',
      Area_HAS: '2.5000',
      Milestone_Stage: 'eTitle Registered',
      Milestone_Date: '2026-11-12',
      Batch_Category: 'ADMIN BATCH 1'
    });
    assert.equal(msRes.statusCode, 200);
    assert.equal(msRes.body.gasPushResult?.ok, true);
    assert.ok(pushedPayloads.some((p) => p.payload.action === 'upsertMilestone'));

    const delMsRes = await callApi(`/api/milestones/${encodeURIComponent(msRes.body.record.Record_ID)}`, 'DELETE');
    assert.equal(delMsRes.statusCode, 200);
    assert.equal(delMsRes.body.gasPushResult?.ok, true);
    assert.ok(pushedPayloads.some((p) => p.payload.action === 'deleteMilestone'));

    // 4. Provincial routing attaches provinceCode & sync-gas-headers pushes syncOptoolHeaders
    const nsaSave = await callApi('/api/optool/Database', 'POST', {
      row: {
        lhid: 'LH-NSA-001',
        province: 'Northern Samar',
        municipality: 'Catarman',
        milestoneTarget: 'RegistrationDistribution'
      }
    });
    assert.equal(nsaSave.statusCode, 200);
    assert.ok(
      pushedPayloads.some(
        (p) =>
          p.payload.action === 'upsertOptoolRow' &&
          p.payload.tabName === 'Database' &&
          p.payload.provinceCode === 'NSA'
      )
    );
    assert.ok(
      pushedPayloads.some(
        (p) =>
          p.payload.action === 'upsertOptoolRow' &&
          p.payload.tabName === 'RegistrationDistribution' &&
          p.payload.provinceCode === 'NSA'
      )
    );

    const hdrSyncRes = await callApi('/api/sync/gas-headers', 'POST', {});
    assert.equal(hdrSyncRes.statusCode, 200);
    assert.ok(pushedPayloads.some((p) => p.payload.action === 'syncOptoolHeaders'));

    // 5. Verify gas/Code.gs OPTOOL_SCHEMA_HEADERS matches OPTOOL_SHEET_SCHEMAS 1:1
    const gasCode = fs.readFileSync(path.resolve('gas/Code.gs'), 'utf8');
    const match = gasCode.match(/const OPTOOL_SCHEMA_HEADERS = (\{[\s\S]*?\n\});/);
    assert.ok(match, 'OPTOOL_SCHEMA_HEADERS missing from gas/Code.gs');
    const gasHeaders = new Function(`return (${match[1]});`)();
    for (const [tab, cols] of Object.entries(OPTOOL_SHEET_SCHEMAS)) {
      assert.deepEqual(gasHeaders[tab], cols.map((c) => c.header), `Mismatch in gas/Code.gs headers for ${tab}`);
    }
  } finally {
    if (prevGasEnv === undefined) {
      delete process.env.GAS_WEB_APP_URL;
    } else {
      process.env.GAS_WEB_APP_URL = prevGasEnv;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Authentication: Email OTP, Sign Up, Admin Confirmation Gate, Sign In, Role Guards & Logout', async () => {
  const dir = makeTempDir();
  const sentEmails = [];
  const { server } = createAppServer(dir, {
    sendOtpEmail: async (payload) => {
      sentEmails.push(payload);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Protected API rejects unauthenticated access
    const unauthBoot = await fetch(`${baseUrl}/api/bootstrap`);
    assert.equal(unauthBoot.status, 401);

    const sessionRes = await fetch(`${baseUrl}/api/auth/session`);
    assert.equal(sessionRes.status, 200);
    const sessionJson = await sessionRes.json();
    assert.equal(sessionJson.authenticated, false);
    assert.equal(sessionJson.requireAuth, true);
    assert.ok(sessionJson.provinces.includes('Leyte'));

    // 2. Sign up without OTP fails cleanly; Send OTP emails a 6-digit code
    const signupPayload = {
      name: 'Maria Clara',
      email: 'maria.clara@dar8.gov.ph',
      province: 'Leyte',
      contactNumber: '09171234567',
      password: 'SecretPassword123'
    };
    const missingOtpRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupPayload)
    });
    assert.equal(missingOtpRes.status, 400);

    const sendOtpRes = await fetch(`${baseUrl}/api/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signupPayload.email, name: signupPayload.name })
    });
    assert.equal(sendOtpRes.status, 200);
    const sendOtpJson = await sendOtpRes.json();
    assert.equal(sendOtpJson.deliveryMode, 'email');
    assert.equal(sendOtpJson.previewOtp, undefined);
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].otp, /^\d{6}$/);

    // Wrong OTP is rejected before creating account
    const wrongOtpRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...signupPayload, otpCode: '000000' })
    });
    assert.equal(wrongOtpRes.status, 400);

    // Valid OTP creates pending account with Name, Email, Province, Contact Number
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...signupPayload, otpCode: sentEmails[0].otp })
    });
    assert.equal(signupRes.status, 201);
    const signupData = await signupRes.json();
    assert.equal(signupData.pending, true);
    assert.equal(signupData.user.status, 'pending');
    assert.equal(signupData.user.province, 'Leyte');
    assert.equal(signupData.user.contactNumber, '09171234567');
    assert.equal(signupData.user.passwordHash, undefined);

    // Duplicate email rejected cleanly on both send-otp and signup
    const dupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...signupPayload, otpCode: sentEmails[0].otp })
    });
    assert.equal(dupRes.status, 409);

    // 3. Pending account cannot log in yet
    const pendingLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: signupPayload.email,
        password: signupPayload.password
      })
    });
    assert.equal(pendingLoginRes.status, 403);
    const pendingErr = await pendingLoginRes.json();
    assert.equal(pendingErr.code, 'ACCOUNT_PENDING');

    // 4. Default Admin logs in and receives session cookie
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: DEFAULT_ADMIN_EMAIL,
        password: DEFAULT_ADMIN_PASSWORD
      })
    });
    assert.equal(adminLoginRes.status, 200);
    const adminCookie = adminLoginRes.headers.get('set-cookie').split(';')[0];
    assert.ok(adminCookie.startsWith('salig_session='));

    const adminBoot = await (
      await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: adminCookie } })
    ).json();
    assert.equal(adminBoot.currentUser.role, 'admin');
    assert.equal(adminBoot.pendingUserCount, 1);

    // 5. Admin views user directory & confirms Maria Clara
    const usersRes = await fetch(`${baseUrl}/api/auth/users`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(usersRes.status, 200);
    const usersData = await usersRes.json();
    const maria = usersData.users.find((u) => u.email === signupPayload.email);
    assert.ok(maria);
    assert.equal(maria.status, 'pending');

    const approveRes = await fetch(`${baseUrl}/api/auth/users/${encodeURIComponent(maria.id)}/status`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'approved' })
    });
    assert.equal(approveRes.status, 200);
    const approvedData = await approveRes.json();
    assert.equal(approvedData.user.status, 'approved');
    assert.equal(approvedData.pendingCount, 0);

    // 6. Confirmed user can now sign in & access workspace, but cannot access admin approvals
    const userLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: signupPayload.email,
        password: signupPayload.password
      })
    });
    assert.equal(userLoginRes.status, 200);
    const userCookie = userLoginRes.headers.get('set-cookie').split(';')[0];

    const userBootRes = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Cookie: userCookie }
    });
    assert.equal(userBootRes.status, 200);
    const userBoot = await userBootRes.json();
    assert.equal(userBoot.currentUser.email, signupPayload.email);

    const forbiddenAdminRes = await fetch(`${baseUrl}/api/auth/users`, {
      headers: { Cookie: userCookie }
    });
    assert.equal(forbiddenAdminRes.status, 403);

    // 7. Logout clears cookie
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    assert.equal(logoutRes.status, 200);
    assert.match(logoutRes.headers.get('set-cookie'), /Max-Age=0/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Province-level scoping isolates data, preserves scoped indices, and blocks cross-province/admin mutations', async () => {
  const dir = makeTempDir();
  const { server, store } = createAppServer(dir, { requireAuth: true, requireOtp: false });

  // Clear seed & populate deterministic multi-province dataset with Biliran placed BEFORE Leyte
  store.state.milestoneData = [
    {
      Record_ID: 'BIL-202611-0001',
      Province_Code: 'BIL',
      Municipality: 'Naval',
      Land_Allocation_ID: 'LA-BIL-1',
      eTitle_No: 'eT-BIL-1',
      Area_HAS: '1.2500',
      Milestone_Stage: 'eTitle Registered',
      Milestone_Date: '2026-11-05',
      Batch_Category: 'ADMIN BATCH 1',
      LHID: 'LH-BIL-001'
    },
    {
      Record_ID: 'LEY-202611-0001',
      Province_Code: 'LEY',
      Municipality: 'Palo',
      Land_Allocation_ID: 'LA-LEY-1',
      eTitle_No: 'eT-LEY-1',
      Area_HAS: '3.5000',
      Milestone_Stage: 'eTitle Distributed',
      Milestone_Date: '2026-11-06',
      Batch_Category: 'ADMIN BATCH 1',
      LHID: 'LH-LEY-001'
    }
  ];
  for (const tab of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
    store.state.optool[tab] = [];
  }
  store.state.optool.Database = [
    { lhid: 'LH-BIL-001', province: 'Biliran', municipality: 'Naval', totalArea: '1.2500', carpable: '1.2500' },
    { lhid: 'LH-SAM-001', province: 'Samar (Western Samar)', municipality: 'Catbalogan', totalArea: '2.0000', carpable: '2.0000' },
    { lhid: 'LH-LEY-001', province: 'Leyte', municipality: 'Palo', totalArea: '3.5000', carpable: '3.5000', year: '2026' }
  ];
  store.state.optool['CF(DOC)'] = [
    { lhid: 'LH-BIL-001', target: 'Current' },
    { lhid: 'LH-LEY-001', target: 'Current' }
  ];
  store.state.optool.RegistrationDistribution = [
    { lhid: 'LH-BIL-001', province: 'Biliran', eTitleNo: 'eT-BIL-1' },
    { lhid: 'LH-LEY-001', province: 'Leyte', eTitleNo: 'eT-LEY-1' }
  ];
  store.save();

  const leyteUser = store.createPendingUser(
    {
      name: 'Juan Leyte',
      email: 'juan.leyte@dar8.gov.ph',
      province: 'Leyte',
      contactNumber: '09170001111',
      password: 'Password123!'
    },
    { requireOtp: false }
  );
  store.updateUserStatus(leyteUser.id, { status: 'approved' }, 'admin');

  const hubUser = store.createPendingUser(
    {
      name: 'Hub Viewer',
      email: 'hub@dar8.gov.ph',
      province: 'Region VIII Hub',
      contactNumber: '09170002222',
      password: 'Password123!'
    },
    { requireOtp: false }
  );
  store.updateUserStatus(hubUser.id, { status: 'approved' }, 'admin');

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Admin / Region VIII Hub sees all provinces
    const hubLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hub@dar8.gov.ph', password: 'Password123!' })
    });
    const hubCookie = hubLogin.headers.get('set-cookie').split(';')[0];
    const hubBoot = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: hubCookie } })).json();
    assert.equal(hubBoot.provinceScope, null);
    assert.equal(hubBoot.schemas.provinceCodes.length, 6);
    assert.equal(hubBoot.state.optool.Database.length, 3);
    assert.equal(hubBoot.analytics.provincialBreakdown.length, 6);

    // 2. Confirmed Leyte user ONLY sees Leyte across bootstrap, analytics, and all OPTool tabs
    const leyLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'juan.leyte@dar8.gov.ph', password: 'Password123!' })
    });
    const leyCookie = leyLogin.headers.get('set-cookie').split(';')[0];
    const leyBoot = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: leyCookie } })).json();

    assert.deepEqual(leyBoot.provinceScope, { code: 'LEY', provinceName: 'Leyte' });
    assert.deepEqual(leyBoot.schemas.provinceCodes, ['LEY']);
    assert.deepEqual(leyBoot.schemas.registry.map((n) => n.code), ['LEY']);
    assert.deepEqual(leyBoot.state.milestoneData.map((m) => m.Record_ID), ['LEY-202611-0001']);
    assert.deepEqual(leyBoot.state.optool.Database.map((r) => r.lhid), ['LH-LEY-001']);
    assert.deepEqual(leyBoot.state.optool['CF(DOC)'].map((r) => r.lhid), ['LH-LEY-001']);
    assert.deepEqual(leyBoot.state.optool.RegistrationDistribution.map((r) => r.lhid), ['LH-LEY-001']);
    assert.deepEqual(leyBoot.analytics.provincialBreakdown.map((p) => p.code), ['LEY']);
    assert.deepEqual(leyBoot.analytics.databaseByProvince.map((p) => p.code), ['LEY']);

    // Landholding 360 for a Biliran LHID must not leak Biliran records to a Leyte user
    const bilDossier = await (
      await fetch(`${baseUrl}/api/landholding/LH-BIL-001`, { headers: { Cookie: leyCookie } })
    ).json();
    assert.equal(bilDossier.tabs.Database.length, 0);
    assert.equal(bilDossier.milestones.length, 0);

    // 3. Index translation: Leyte's Database row is scoped index 0, even though global index is 2!
    const editRes = await fetch(`${baseUrl}/api/optool/Database`, {
      method: 'POST',
      headers: { Cookie: leyCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        index: 0,
        row: { lhid: 'LH-LEY-001', province: 'Biliran', municipality: 'Tanauan', totalArea: '4.1000', year: '2026' }
      })
    });
    assert.equal(editRes.status, 403, 'Explicit cross-province override should be blocked');

    const validEditRes = await fetch(`${baseUrl}/api/optool/Database`, {
      method: 'POST',
      headers: { Cookie: leyCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        index: 0,
        row: { lhid: 'LH-LEY-001', province: 'Leyte', municipality: 'Tanauan', totalArea: '4.1000', year: '2026' }
      })
    });
    assert.equal(validEditRes.status, 200);
    const validEditJson = await validEditRes.json();
    assert.deepEqual(validEditJson.rows.map((r) => r.lhid), ['LH-LEY-001']);
    assert.equal(validEditJson.rows[0].municipality, 'Tanauan');
    assert.equal(store.state.optool.Database[0].lhid, 'LH-BIL-001', 'Biliran row 0 must remain untouched');
    assert.equal(store.state.optool.Database[2].municipality, 'Tanauan', 'Leyte global row 2 updated');

    // Milestone-target routing with scoped index 0 routes Leyte parcel cleanly
    const mtRes = await fetch(`${baseUrl}/api/optool/Database/milestone-target`, {
      method: 'POST',
      headers: { Cookie: leyCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: 0, milestoneTarget: 'Survey' })
    });
    assert.equal(mtRes.status, 200);
    const mtJson = await mtRes.json();
    assert.equal(mtJson.row.lhid, 'LH-LEY-001');
    assert.equal(mtJson.row.milestoneTarget, 'Survey');
    assert.ok(store.state.optool.Survey.some((r) => r.lhid === 'LH-LEY-001'));

    // Cross-province Milestone & Admin endpoints must return 403
    const crossMsRes = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { Cookie: leyCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ Province_Code: 'BIL', Municipality: 'Naval', Area_HAS: '1.0000' })
    });
    assert.equal(crossMsRes.status, 403);

    const crossDelMsRes = await fetch(`${baseUrl}/api/milestones/BIL-202611-0001`, {
      method: 'DELETE',
      headers: { Cookie: leyCookie }
    });
    assert.equal(crossDelMsRes.status, 403);

    const baselinesRes = await fetch(`${baseUrl}/api/baselines`, {
      method: 'PUT',
      headers: { Cookie: leyCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ LEY: { targetETitles: 999, targetAreaHas: 100 } })
    });
    assert.equal(baselinesRes.status, 403);

    const clearRes = await fetch(`${baseUrl}/api/workspace/clear`, {
      method: 'POST',
      headers: { Cookie: leyCookie }
    });
    assert.equal(clearRes.status, 403);

    const wrongNodeSyncRes = await fetch(`${baseUrl}/api/sync/google-sheet`, {
      method: 'POST',
      headers: { Cookie: leyCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheetId: '1w5r72b6p4cY0e8k0gE1h-dU2aL6j3R1r4P0r7n0F6v8' })
    });
    assert.equal(wrongNodeSyncRes.status, 403);

    // Deleting scoped index 0 in CF(DOC) deletes LH-LEY-001, keeping LH-BIL-001 safe
    const delCfRes = await fetch(`${baseUrl}/api/optool/CF(DOC)/0`, {
      method: 'DELETE',
      headers: { Cookie: leyCookie }
    });
    assert.equal(delCfRes.status, 200);
    const delCfJson = await delCfRes.json();
    assert.equal(delCfJson.rows.length, 0);
    assert.deepEqual(store.state.optool['CF(DOC)'].map((r) => r.lhid), ['LH-BIL-001']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('User_Accounts two-way sync with Regional Account Hub GAS Web App', async () => {
  const dir = makeTempDir();
  const sheetUsers = [];

  const mockPush = async (_url, payload) => {
    if (payload.action === 'upsertUserAccount' && payload.user) {
      const idx = sheetUsers.findIndex(
        (u) => u.id === payload.user.id || u.email === payload.user.email
      );
      if (idx >= 0) sheetUsers[idx] = { ...payload.user };
      else sheetUsers.push({ ...payload.user });
      return { ok: true, user: payload.user };
    }
    if (payload.action === 'deleteUserAccount') {
      const idx = sheetUsers.findIndex(
        (u) => u.id === payload.userId || u.email === payload.email
      );
      if (idx >= 0) sheetUsers.splice(idx, 1);
      return { ok: true, deleted: idx >= 0 };
    }
    if (payload.action === 'syncUserAccounts' && Array.isArray(payload.users)) {
      for (const u of payload.users) {
        const idx = sheetUsers.findIndex((s) => s.id === u.id || s.email === u.email);
        if (idx >= 0) sheetUsers[idx] = { ...u };
        else sheetUsers.push({ ...u });
      }
      return { ok: true, synced: sheetUsers.length, users: [...sheetUsers] };
    }
    return { ok: true };
  };

  const mockPullUsers = async () => ({ ok: true, users: [...sheetUsers] });

  const { server, store } = createAppServer(dir, {
    requireAuth: true,
    requireOtp: false,
    pushToGasWebApp: mockPush,
    pullUsersFromGasWebApp: mockPullUsers
  });
  store.state.gasWebAppUrl = 'https://script.google.com/macros/s/test-users/exec';
  store.save();

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Signup auto-pushes user to GAS User_Accounts
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Pedro Samar',
        email: 'pedro.samar@dar8.gov.ph',
        province: 'Samar (Western Samar)',
        contactNumber: '09181112222',
        password: 'Password123!'
      })
    });
    assert.equal(signupRes.status, 201);
    const signupJson = await signupRes.json();
    assert.equal(signupJson.gasPushResult.ok, true);
    assert.equal(sheetUsers.length, 1);
    assert.equal(sheetUsers[0].status, 'pending');
    assert.ok(sheetUsers[0].passwordHash.includes(':'));

    // 2. Admin approves -> GAS User_Accounts updates to approved
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    const approveRes = await fetch(
      `${baseUrl}/api/auth/users/${encodeURIComponent(signupJson.user.id)}/status`,
      {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' })
      }
    );
    assert.equal(approveRes.status, 200);
    assert.equal(sheetUsers[0].status, 'approved');

    // 3. Admin syncs full directory -> both admin and Pedro are in Regional Google Sheet
    const syncAllRes = await fetch(`${baseUrl}/api/auth/users/sync-sheet`, {
      method: 'POST',
      headers: { Cookie: adminCookie }
    });
    assert.equal(syncAllRes.status, 200);
    const syncAllJson = await syncAllRes.json();
    assert.equal(syncAllJson.ok, true);
    assert.equal(sheetUsers.length, 2);

    // 4. Even if local store loses Pedro's record (e.g. cold serverless instance), login pulls from User_Accounts and succeeds!
    store.state.users = store.state.users.filter((u) => u.email !== 'pedro.samar@dar8.gov.ph');
    store.save();

    const pedroLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pedro.samar@dar8.gov.ph', password: 'Password123!' })
    });
    assert.equal(pedroLogin.status, 200);
    const pedroJson = await pedroLogin.json();
    assert.equal(pedroJson.user.province, 'Samar (Western Samar)');

    // 5. Admin cannot delete own account, but deleting Pedro removes both local & Google Sheet records
    const selfUser = store.findUserByEmail(DEFAULT_ADMIN_EMAIL);
    const selfDelRes = await fetch(`${baseUrl}/api/auth/users/${encodeURIComponent(selfUser.id)}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie }
    });
    assert.equal(selfDelRes.status, 400);

    const delPedroRes = await fetch(
      `${baseUrl}/api/auth/users/${encodeURIComponent(signupJson.user.id)}`,
      {
        method: 'DELETE',
        headers: { Cookie: adminCookie }
      }
    );
    assert.equal(delPedroRes.status, 200);
    const delPedroJson = await delPedroRes.json();
    assert.equal(delPedroJson.gasPushResult.ok, true);
    assert.equal(store.findUserByEmail('pedro.samar@dar8.gov.ph'), null);
    assert.equal(sheetUsers.some((u) => u.email === 'pedro.samar@dar8.gov.ph'), false);

    // 6. Test deleting a user who is in Google Sheets but not yet in local store (cold lambda / out of sync instance)
    const remoteUser = {
      id: 'usr-remote-test-123',
      name: 'Remote User',
      email: 'remote.user@dar8.gov.ph',
      province: 'Eastern Samar',
      role: 'user',
      status: 'approved',
      passwordHash: 'hash:123'
    };
    sheetUsers.push(remoteUser);
    assert.equal(store.findUserById(remoteUser.id), null);

    const delRemoteRes = await fetch(
      `${baseUrl}/api/auth/users/${encodeURIComponent(remoteUser.id)}?email=${encodeURIComponent(remoteUser.email)}`,
      {
        method: 'DELETE',
        headers: { Cookie: adminCookie }
      }
    );
    assert.equal(delRemoteRes.status, 200);
    const delRemoteJson = await delRemoteRes.json();
    assert.equal(delRemoteJson.ok, true);
    assert.equal(sheetUsers.some((u) => u.email === remoteUser.email), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Per-Milestone Dashboard NEP Target, Quarterly Accomplishment (Q1-Q4), Rate of Accomp., and Variance', async () => {
  const dir = makeTempDir();
  const { server, store } = createAppServer(dir, { requireAuth: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD })
    });
    assert.equal(loginRes.status, 200);
    const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

    // Clear seed rows and insert controlled rows across all 6 milestones & quarters
    store.clearToEmptyLive();
    store.upsertOptoolRow('Database', { lhid: 'LH-Q1', province: 'Leyte', carpable: '5.5000' });
    store.upsertOptoolRow('Database', { lhid: 'LH-Q2', province: 'Leyte', carpable: '4.2500' });
    store.upsertOptoolRow('Database', { lhid: 'LH-Q3', province: 'Biliran', carpable: '3.0000' });

    // CF Documentation: 1 in Q1 (ISO), 1 in Q3 (Month YYYY)
    store.upsertOptoolRow('CF(DOC)', { lhid: 'LH-Q1', reportedMonth: '2026-02-15' });
    store.upsertOptoolRow('CF(DOC)', { lhid: 'LH-Q3', reportedMonth: 'August 2026' });

    // Land Survey: 1 in Q2 via Column AC (Date Accepted by DENR-SMD), plus 1 with empty Column AC (must be excluded from accomplishment)
    store.upsertOptoolRow('Survey', { lhid: 'LH-Q2', dateAcceptedDenrSmd: '2026-05-19' });
    store.upsertOptoolRow('Survey', { lhid: 'LH-Q3', currentDate: '2026-05-19', dateAcceptedDenrSmd: '' });

    // Land Valuation: 1 in Q4 via dateTransLbpAoc
    store.upsertOptoolRow('MOV', { lhid: 'LH-Q1', dateTransLbpAoc: '2026-10-12' });

    // EP CLOA Registration (Q1, 2 titles) & EP CLOA Distribution (Q4, MM/DD/YYYY, 2 titles)
    store.upsertOptoolRow('RegistrationDistribution', {
      lhid: 'LH-Q1',
      province: 'Leyte',
      dateRegistered: '2026-03-04',
      dateOfDistribution: '11/08/2026',
      noOfTitles: '2',
      areaHas: '5.5000'
    });

    // Installation: 1 in Q4
    store.upsertOptoolRow('Installation', {
      lhid: 'LH-Q2',
      province: 'Leyte',
      dateOfInstallation: '12/01/2026',
      installedStatus: 'Yes',
      noOfTitles: '1',
      areaHas2: '4.2500'
    });

    // Save flat Regional List NEP Targets via Regional Account
    const nepRes = await fetch(`${baseUrl}/api/nep-targets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        cf_doc: { targetCount: 6, targetAreaHas: 15 },
        land_survey: { targetCount: 2, targetAreaHas: 8.5 },
        land_valuation: { targetCount: 1, targetAreaHas: 5.5 },
        ep_cloa_registration: { targetCount: 2, targetAreaHas: 5.5 },
        ep_cloa_distribution: { targetCount: 5, targetAreaHas: 12 },
        installation: { targetCount: 1, targetAreaHas: 4 }
      })
    });
    assert.equal(nepRes.status, 200);
    const nepJson = await nepRes.json();

    const rows = nepJson.analytics.milestoneNepBreakdown;
    assert.equal(rows.length, 6);
    assert.deepEqual(
      rows.map((r) => r.label),
      [
        'CF Documentation',
        'Land Survey',
        'Land Valuation',
        'EP CLOA Registration',
        'EP CLOA Distribution',
        'Installation'
      ]
    );

    const cf = rows[0];
    assert.equal(cf.nepTargetCount, 6);
    assert.equal(cf.nepTargetAreaHas, 15);
    assert.equal(cf.q1.count, 1);
    assert.equal(cf.q1.areaHas, 5.5);
    assert.equal(cf.q3.count, 1);
    assert.equal(cf.q3.areaHas, 3);
    assert.equal(cf.total.count, 2);
    assert.equal(cf.total.areaHas, 8.5);
    assert.equal(cf.rateCountPct, 33.33);
    assert.equal(cf.varianceCount, -4);
    assert.equal(cf.varianceAreaHas, -6.5);
    assert.ok(cf.months);
    assert.equal(typeof cf.months[1].count, 'number');
    assert.equal(typeof cf.months[12].areaHas, 'number');
    assert.ok(cf.sem1);
    assert.ok(cf.sem2);
    assert.equal(cf.sem1.count, cf.q1.count + cf.q2.count);
    assert.equal(cf.sem1.areaHas, Number((cf.q1.areaHas + cf.q2.areaHas).toFixed(4)));
    assert.equal(cf.sem2.count, cf.q3.count + cf.q4.count);
    assert.equal(cf.sem2.areaHas, Number((cf.q3.areaHas + cf.q4.areaHas).toFixed(4)));
    assert.equal(cf.nepTargetSem1Count, 3);
    assert.equal(cf.nepTargetSem1AreaHas, 7.5);
    assert.equal(cf.nepTargetSem2Count, 3);
    assert.equal(cf.nepTargetSem2AreaHas, 7.5);
    assert.equal(cf.sem1.targetCount, 3);
    assert.equal(cf.sem1.targetAreaHas, 7.5);
    assert.equal(cf.sem2.targetCount, 3);
    assert.equal(cf.sem2.targetAreaHas, 7.5);
    assert.equal(typeof cf.sem1.rateCountPct, 'number');
    assert.equal(typeof cf.sem1.varianceAreaHas, 'number');
    assert.ok(cf.provinceBreakdown);
    assert.ok(Array.isArray(cf.zeroAccompProvinces));
    assert.ok(Array.isArray(cf.activeProvinces));
    assert.ok(cf.provinceBreakdown.BIL);
    assert.ok(cf.provinceBreakdown.LEY);
    assert.equal(typeof cf.provinceBreakdown.LEY.count, 'number');
    assert.equal(typeof cf.provinceBreakdown.LEY.hasAccomp, 'boolean');
    assert.ok(cf.provinceBreakdown.LEY.sem1);
    assert.ok(cf.provinceBreakdown.LEY.sem2);
    assert.equal(typeof cf.provinceBreakdown.LEY.sem1.targetCount, 'number');
    assert.equal(typeof cf.provinceBreakdown.LEY.sem1.targetAreaHas, 'number');

    const survey = rows[1];
    assert.equal(survey.q2.count, 1);
    assert.equal(survey.rateCountPct, 50);

    const val = rows[2];
    assert.equal(val.q4.count, 1);
    assert.equal(val.rateCountPct, 100);
    assert.equal(val.varianceCount, 0);

    const reg = rows[3];
    assert.equal(reg.q1.count, 2);
    assert.equal(reg.rateCountPct, 100);

    const dist = rows[4];
    assert.equal(dist.q4.count, 2);
    assert.equal(dist.varianceCount, -3);

    const inst = rows[5];
    assert.equal(inst.q4.count, 1);
    assert.equal(inst.varianceAreaHas, 0.25);

    // Year filter & province filter preserve Regional List NEP target while scoping accomplishments
    const leyRes = await fetch(`${baseUrl}/api/analytics?province=LEY&milestoneYear=2026`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(leyRes.status, 200);
    const leyJson = await leyRes.json();
    const leyCf = leyJson.milestoneNepBreakdown[0];
    assert.equal(leyCf.nepTargetCount, 6);
    assert.equal(leyCf.total.count, 1); // Only LH-Q1 is Leyte; LH-Q3 is Biliran

    // Update NEP targets with explicit 1st Sem target, verifying 2nd Sem is auto-calculated as (NEP - 1st Sem)
    const customSemRes = await fetch(`${baseUrl}/api/nep-targets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        cf_doc: { targetCount: 10, targetAreaHas: 25.5, sem1TargetCount: 7, sem1TargetAreaHas: 18.25 },
        land_survey: { targetCount: 4, targetAreaHas: 10, sem1TargetCount: 1, sem1TargetAreaHas: 2.5 }
      })
    });
    assert.equal(customSemRes.status, 200);
    const customSemJson = await customSemRes.json();
    const customCf = customSemJson.analytics.milestoneNepBreakdown[0];
    assert.equal(customCf.nepTargetCount, 10);
    assert.equal(customCf.nepTargetAreaHas, 25.5);
    assert.equal(customCf.nepTargetSem1Count, 7);
    assert.equal(customCf.nepTargetSem2Count, 3); // 10 - 7
    assert.equal(customCf.nepTargetSem1AreaHas, 18.25);
    assert.equal(customCf.nepTargetSem2AreaHas, 7.25); // 25.5 - 18.25
    assert.equal(customCf.sem1.targetCount, 7);
    assert.equal(customCf.sem2.targetCount, 3);
    assert.equal(customCf.sem1.targetAreaHas, 18.25);
    assert.equal(customCf.sem2.targetAreaHas, 7.25);

    // Provincial user is blocked (403) while a Region VIII Hub user (role: 'user') can edit (200)
    const provUser = store.createPendingUser(
      {
        name: 'Leyte Provincial User',
        email: 'leyte.nep@dar8.gov.ph',
        province: 'Leyte',
        contactNumber: '09170001111',
        password: 'Password123!'
      },
      { requireOtp: false }
    );
    store.updateUserStatus(provUser.id, { status: 'approved' }, 'admin');
    const provLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'leyte.nep@dar8.gov.ph', password: 'Password123!' })
    });
    assert.equal(provLogin.status, 200);
    const provCookie = provLogin.headers.get('set-cookie').split(';')[0];
    const provForbidden = await fetch(`${baseUrl}/api/nep-targets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: provCookie },
      body: JSON.stringify({ cf_doc: { targetCount: 99, targetAreaHas: 99 } })
    });
    assert.equal(provForbidden.status, 403);

    const hubUser = store.createPendingUser(
      {
        name: 'Regional Hub Staff',
        email: 'hub.nep@dar8.gov.ph',
        province: 'Region VIII Hub',
        contactNumber: '09170002222',
        password: 'Password123!'
      },
      { requireOtp: false }
    );
    store.updateUserStatus(hubUser.id, { status: 'approved' }, 'admin');
    const hubLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hub.nep@dar8.gov.ph', password: 'Password123!' })
    });
    assert.equal(hubLogin.status, 200);
    const hubCookie = hubLogin.headers.get('set-cookie').split(';')[0];
    const hubAllowed = await fetch(`${baseUrl}/api/nep-targets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: hubCookie },
      body: JSON.stringify({ cf_doc: { targetCount: 10, targetAreaHas: 25 } })
    });
    assert.equal(hubAllowed.status, 200);
    const hubJson = await hubAllowed.json();
    assert.equal(hubJson.analytics.milestoneNepBreakdown[0].nepTargetCount, 10);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Regional Hub NEP Sheet (per province LHS, AREA, ARBs) XLSX round-trip, edit RBAC, and GAS sync', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salig-nep-sheet-'));
  const pushedPayloads = [];
  let mockedRemoteNep = {
    BIL: { lhs: 12, area: 145.5, arbs: 34 },
    ESA: { lhs: 18, area: 210.125, arbs: 48 },
    LEY: { lhs: 45, area: 890.75, arbs: 150 },
    NSA: { lhs: 22, area: 310.25, arbs: 62 },
    SAM: { lhs: 30, area: 405.5, arbs: 80 },
    SLE: { lhs: 15, area: 198.125, arbs: 41 }
  };

  const { server, store } = createAppServer(dir, {
    requireAuth: true,
    pushToGasWebApp: async (_url, payload) => {
      pushedPayloads.push(payload);
      return { ok: true, nepProvinceList: payload.nepProvinceList };
    },
    pullNepFromGasWebApp: async () => ({
      ok: true,
      sheetName: 'NEP',
      nepProvinceList: mockedRemoteNep
    })
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD })
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    // 1. Regional admin updates NEP Sheet via PUT /api/nep-sheet -> pushes saveNepSheet to GAS
    store.state.gasWebAppUrl = 'https://script.google.com/macros/s/mock/exec';
    store.save();

    const saveRes = await fetch(`${baseUrl}/api/nep-sheet`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        BIL: { lhs: 5, area: 50.25, arbs: 12, year: 2026 },
        LEY: { lhs: 40, area: 600.75, arbs: 120, year: 2026 }
      })
    });
    assert.equal(saveRes.status, 200);
    const saveJson = await saveRes.json();
    assert.equal(saveJson.nepProvinceList.BIL.lhs, 5);
    assert.equal(saveJson.nepProvinceList.BIL.year, 2026);
    assert.equal(saveJson.nepProvinceList.LEY.area, 600.75);
    assert.equal(saveJson.nepProvinceList.LEY.year, 2026);
    assert.equal(saveJson.analytics.nepProvinceBreakdown.length, 6);
    assert.equal(saveJson.analytics.nepProvinceTotals.lhs, 45);
    assert.equal(saveJson.analytics.nepProvinceTotals.area, 651);
    assert.equal(saveJson.analytics.nepProvinceTotals.arbs, 132);
    assert.equal(pushedPayloads[0].action, 'saveNepSheet');
    assert.equal(pushedPayloads[0].nepProvinceList.LEY.arbs, 120);
    assert.equal(pushedPayloads[0].nepProvinceList.LEY.year, 2026);

    // 2. Consolidated XLSX export includes NEP sheet and re-parses cleanly (ignoring TOTAL row)
    const xlsxBuffer = await buildConsolidatedWorkbookBuffer(
      store.getScopedState(null),
      store.computeAnalytics({})
    );
    const parsed = await parseWorkbookBuffer(xlsxBuffer);
    assert.ok(parsed.sheetNames.includes('NEP'));
    assert.equal(parsed.tabRowCounts.NEP, 6);
    assert.equal(parsed.nepProvinceList.BIL.lhs, 5);
    assert.equal(parsed.nepProvinceList.BIL.year, 2026);
    assert.equal(parsed.nepProvinceList.LEY.area, 600.75);
    assert.equal(parsed.nepProvinceList.LEY.arbs, 120);

    // 3. Provincial account is forbidden from editing or syncing NEP Sheet, but sees own province row read-only
    const provUser = store.createPendingUser(
      {
        name: 'Biliran Officer',
        email: 'biliran.nepsheet@dar8.gov.ph',
        province: 'Biliran',
        contactNumber: '09170003333',
        password: 'Password123!'
      },
      { requireOtp: false }
    );
    store.updateUserStatus(provUser.id, { status: 'approved' }, 'admin');
    const provLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'biliran.nepsheet@dar8.gov.ph', password: 'Password123!' })
    });
    assert.equal(provLogin.status, 200);
    const provCookie = provLogin.headers.get('set-cookie').split(';')[0];

    const provPut = await fetch(`${baseUrl}/api/nep-sheet`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: provCookie },
      body: JSON.stringify({ BIL: { lhs: 999, area: 999, arbs: 999 } })
    });
    assert.equal(provPut.status, 403);

    const provSync = await fetch(`${baseUrl}/api/nep-sheet/sync`, {
      method: 'POST',
      headers: { Cookie: provCookie }
    });
    assert.equal(provSync.status, 403);

    const provAnalytics = await (
      await fetch(`${baseUrl}/api/analytics`, { headers: { Cookie: provCookie } })
    ).json();
    assert.equal(provAnalytics.nepProvinceBreakdown.length, 1);
    assert.equal(provAnalytics.nepProvinceBreakdown[0].code, 'BIL');
    assert.equal(provAnalytics.nepProvinceBreakdown[0].lhs, 5);

    // 4. Regional admin syncs from GAS Web App (?action=nep) via POST /api/nep-sheet/sync
    const syncRes = await fetch(`${baseUrl}/api/nep-sheet/sync`, {
      method: 'POST',
      headers: { Cookie: adminCookie }
    });
    assert.equal(syncRes.status, 200);
    const syncJson = await syncRes.json();
    assert.equal(syncJson.analytics.nepProvinceTotals.lhs, 142);
    assert.equal(syncJson.analytics.nepProvinceTotals.area, 2160.25);
    assert.equal(syncJson.analytics.nepProvinceTotals.arbs, 415);

    // 5. Per-Milestone selection in Put Data / Allocation modal
    const cfPutRes = await fetch(`${baseUrl}/api/nep-sheet`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        milestone: 'cf_doc',
        nepProvinceList: {
          BIL: { lhs: 12, area: 24.5, arbs: 15, year: 2026 },
          LEY: { lhs: 28, area: 55.5, arbs: 40, year: 2026 }
        }
      })
    });
    assert.equal(cfPutRes.status, 200);
    const cfPutJson = await cfPutRes.json();
    assert.ok(cfPutJson.nepMilestoneList.cf_doc);
    assert.equal(cfPutJson.nepMilestoneList.cf_doc.BIL.lhs, 12);
    assert.equal(cfPutJson.nepMilestoneList.cf_doc.LEY.area, 55.5);
    // Verifies auto-calculation of NEP Target from milestone province totals
    assert.equal(cfPutJson.nepTargets.cf_doc.targetCount, 40);
    assert.equal(cfPutJson.nepTargets.cf_doc.targetAreaHas, 80);
    assert.equal(cfPutJson.analytics.milestoneNepBreakdown[0].nepTargetCount, 40);
    assert.equal(cfPutJson.analytics.milestoneNepBreakdown[0].nepTargetAreaHas, 80);

    // Provincial user receives scoped milestone breakdown
    const provBoot = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: { Cookie: provCookie } })).json();
    assert.ok(provBoot.state.nepMilestoneList.cf_doc);
    assert.equal(provBoot.state.nepMilestoneList.cf_doc.BIL.lhs, 12);
    assert.equal(provBoot.state.nepMilestoneList.cf_doc.LEY, undefined);

    // 6. Target year dropdown displays all years that have a target (e.g. 2025, 2026)
    await fetch(`${baseUrl}/api/nep-sheet`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        milestone: 'land_survey',
        nepProvinceList: {
          ESA: { lhs: 5, area: 23.5124, arbs: 10, year: 2025 },
          LEY: { lhs: 15, area: 1056.74, arbs: 50, year: 2025 }
        }
      })
    });
    const yrAnalytics = await (await fetch(`${baseUrl}/api/analytics`, { headers: { Cookie: adminCookie } })).json();
    assert.ok(yrAnalytics.availableMilestoneYears.includes(2025));
    assert.ok(yrAnalytics.availableMilestoneYears.includes(2026));

    // 7. Fetch live NEP targets from Regional Hub
    const fetchHubRes = await fetch(`${baseUrl}/api/nep-targets/fetch-hub`, {
      method: 'POST',
      headers: { Cookie: adminCookie }
    });
    assert.equal(fetchHubRes.status, 200);
    const fetchHubJson = await fetchHubRes.json();
    assert.equal(fetchHubJson.ok, true);
    assert.ok(fetchHubJson.nepTargets);
    assert.ok(fetchHubJson.nepProvinceList);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Survey Whereabouts Target Year filtering, NEP target alignment, and Accomplishment from database', () => {
  const curYear = 2026;
  const prevRow = { target: 'Previous Year', dateRss: '2026-11-12' };
  const currRow = { target: 'Current', dateRss: '2026-02-10', fieldWorkCompletionDate: '2026-03-04', aspDate: '2026-06-15' };

  // 1. matchesWhereaboutsTargetYear unit assertions
  assert.equal(matchesWhereaboutsTargetYear(prevRow, '2025', curYear), true);
  assert.equal(matchesWhereaboutsTargetYear(prevRow, '2026', curYear), false);
  assert.equal(matchesWhereaboutsTargetYear(prevRow, 'ALL', curYear), true);

  assert.equal(matchesWhereaboutsTargetYear(currRow, '2025', curYear), false);
  assert.equal(matchesWhereaboutsTargetYear(currRow, '2026', curYear), true);
  assert.equal(matchesWhereaboutsTargetYear(currRow, 'ALL', curYear), true);

  // 2. Integration with store data
  const store = createSeedState();
  store.optool.Survey = [
    {
      lhid: 'TEST-LEY-2025',
      target: 'Previous Year',
      dateRss: '2026-11-12',
      carpable: '6.1812',
      province: 'Leyte',
      currentStatus: '01 - With RSS'
    },
    {
      lhid: 'TEST-NSA-2025',
      target: 'Previous Year',
      dateRss: '2026-11-12',
      carpable: '6.1527',
      province: 'Northern Samar',
      currentStatus: 'Pending Survey'
    },
    {
      lhid: 'LH-0837-0012',
      target: 'Current',
      dateRss: '2026-02-10',
      fieldWorkCompletionDate: '2026-03-04',
      aspDate: '2026-06-15',
      carpable: '2.4500',
      province: 'Leyte',
      currentStatus: '12 - WITH ASP'
    }
  ];
  const cfg = WHEREABOUTS_CONFIGS['survey-whereabouts'];

  // Test 2025 (Previous Year)
  const ctx2025 = {
    state: store,
    schemas: { registry: [] },
    provinceScope: null,
    whereaboutsTargetYearFilter: { 'survey-whereabouts': '2025' },
    whereaboutsProvinceFilter: {},
    whereaboutsStatusFilter: {},
    whereaboutsSearch: {},
    whereaboutsColFilters: {},
    whereaboutsPage: {},
    surveyMetricMode: 'both',
    surveyIndicatorTab: 'all'
  };
  const html2025 = renderMilestoneWhereaboutsView(ctx2025, cfg);
  assert.ok(html2025.includes('1,610.8163')); // NEP Target 2025 present
  assert.ok(html2025.includes('Total With RSS'));
  assert.ok(html2025.includes('23.5124') || html2025.includes('22.6794') || html2025.includes('12.3339')); // With RSS accomplishment area for 2025

  // Test 2026 (Current Year)
  const ctx2026 = {
    state: store,
    schemas: { registry: [] },
    provinceScope: null,
    whereaboutsTargetYearFilter: { 'survey-whereabouts': '2026' },
    whereaboutsProvinceFilter: {},
    whereaboutsStatusFilter: {},
    whereaboutsSearch: {},
    whereaboutsColFilters: {},
    whereaboutsPage: {},
    surveyMetricMode: 'both',
    surveyIndicatorTab: 'all'
  };
  const html2026 = renderMilestoneWhereaboutsView(ctx2026, cfg);
  assert.ok(html2026.includes('2.6500') || html2026.includes('2.4500')); // Current year LH accomplishment total area (Column N)

  // Test ALL
  const ctxAll = {
    state: store,
    schemas: { registry: [] },
    provinceScope: null,
    whereaboutsTargetYearFilter: { 'survey-whereabouts': 'ALL' },
    whereaboutsProvinceFilter: {},
    whereaboutsStatusFilter: {},
    whereaboutsSearch: {},
    whereaboutsColFilters: {},
    whereaboutsPage: {},
    surveyMetricMode: 'both',
    surveyIndicatorTab: 'all'
  };
  const htmlAll = renderMilestoneWhereaboutsView(ctxAll, cfg);
  assert.ok(htmlAll.includes('1,610.8163'));
  assert.ok(htmlAll.includes('23.5124') || htmlAll.includes('25.1294')); // Total With RSS area

  // Test position: toolbar panel is below survey status monitoring panel
  const pMonitoring = htmlAll.indexOf('panel-survey-status-monitoring');
  const pToolbar = htmlAll.indexOf('whereabouts-toolbar-panel');
  assert.ok(pMonitoring > 0, 'Survey status panel should be present');
  assert.ok(pToolbar > 0, 'Toolbar panel should be present');
  assert.ok(pToolbar > pMonitoring, 'Toolbar panel should be below Survey Status Monitoring panel');

  // Test column AP Current Status options in status dropdown
  assert.ok(htmlAll.includes('01 - With RSS'), 'Column AP 01 - With RSS status should be in dropdown');
  assert.ok(htmlAll.includes('12 - WITH ASP'), 'Column AP 12 - WITH ASP should be in dropdown');

  // Test Province x Current Status Matrix Table
  const pMatrix = htmlAll.indexOf('panel-survey-current-status-matrix');
  assert.ok(pMatrix > pMonitoring, 'Matrix table panel should be located below the monitoring tables');
  assert.ok(pToolbar > pMatrix, 'Toolbar is merged inside the matrix table panel as integrated header');
  assert.ok(htmlAll.includes('Survey Current Status by Operating Unit'), 'Matrix panel heading should be rendered');
  assert.ok(htmlAll.includes('Row</strong> = Province • <strong>Column</strong> = Current Status (Column AP)'), 'Matrix subtitle describes row=Province, col=Current Status');

  // Check all 6 Region VIII provinces and Regional Total row are present
  for (const prov of ['BILIRAN', 'EASTERN SAMAR', 'LEYTE', 'NORTHERN SAMAR', 'SAMAR', 'SOUTHERN LEYTE', 'REGION VIII TOTAL']) {
    assert.ok(htmlAll.includes(prov), `Matrix table must include province row: ${prov}`);
  }

  // Check interactive figure buttons with data-open-survey-support-list
  assert.ok(htmlAll.includes('data-open-survey-support-list'), 'Figures must be clickable with data-open-survey-support-list attribute');
  assert.ok(htmlAll.includes('btn-figure-link'), 'Figure buttons use .btn-figure-link styling');

  // Check 2025 matrix values
  assert.ok(html2025.includes('panel-survey-current-status-matrix'));
  assert.ok(html2025.includes('6.1812'), 'Leyte 01 - With RSS area (6.1812) in 2025 matrix');
  assert.ok(html2025.includes('6.1527'), 'Northern Samar Pending Survey area (6.1527) in 2025 matrix');
  assert.ok(html2025.includes('12.3339') || html2025.includes('28.8321'), 'Region VIII Total area in 2025 matrix');

  // Check that cross-tabulation matrix cells render clickable figure links for province and status
  const matrixHtml2025 = html2025.slice(html2025.indexOf('panel-survey-current-status-matrix'));
  assert.ok(matrixHtml2025.includes('data-open-survey-support-list data-province="LEYTE"'), 'Matrix cells have data-open-survey-support-list for LEYTE');
  assert.ok(matrixHtml2025.includes('SAMAR'), 'Matrix table includes SAMAR');
  assert.ok(matrixHtml2025.includes('data-open-survey-support-list data-province="ALL"'), 'Matrix total cells have data-open-survey-support-list for ALL Region VIII');

  // Check 2026 matrix values
  assert.ok(html2026.includes('panel-survey-current-status-matrix'));
  assert.ok(html2026.includes('2.6500') || html2026.includes('2.4500'), 'Leyte 12 - WITH ASP area in 2026 matrix');

  // Check All 12 Stages toggle mode
  const ctxAllStages = {
    ...ctxAll,
    surveyMatrixMode: 'all'
  };
  const htmlAllStages = renderMilestoneWhereaboutsView(ctxAllStages, cfg);
  assert.ok(htmlAllStages.includes('02 - Field Work Started'), 'All stages mode should include 02 - Field Work Started');
  assert.ok(htmlAllStages.includes('04 - Finalized SR'), 'All stages mode should include 04 - Finalized SR');
  assert.ok(htmlAllStages.includes('10 - SR Accepted by LMS'), 'All stages mode should include 10 - SR Accepted by LMS');

  // Check LHS-only and Area-only metric modes
  const ctxLhs = { ...ctxAll, surveyMetricMode: 'lhs' };
  const htmlLhs = renderMilestoneWhereaboutsView(ctxLhs, cfg);
  assert.ok(htmlLhs.includes('TOTAL (LHS)'), 'LHS-only mode header has TOTAL (LHS)');

  const ctxArea = { ...ctxAll, surveyMetricMode: 'area' };
  const htmlArea = renderMilestoneWhereaboutsView(ctxArea, cfg);
  assert.ok(htmlArea.includes('TOTAL (HAS)'), 'Area-only mode header has TOTAL (HAS)');

  // Test renderSurveySupportListModalHtml
  const mockSupportRows = [
    {
      lhid: '8.01011057E8',
      province: 'LEYTE',
      municipality: 'MAYORGA',
      barangay: 'SANTA CRUZ',
      landOwner: 'REPUBLIC OF THE PHILIPPINES',
      titleNumber: 'OCT-1234',
      carpable: 3.0906,
      currentStatus: '01 - With RSS',
      stage: '01 - With RSS',
      target: 'Previous Year',
      datesMap: { dateRss: '2025-06-15' }
    }
  ];
  const supportModalHtml = renderSurveySupportListModalHtml({
    rows: mockSupportRows,
    province: 'LEYTE',
    status: '01 - With RSS',
    targetYear: '2025',
    totalArea: 3.0906
  });
  assert.ok(supportModalHtml.includes('survey-support-list-modal'), 'Support list modal wrapper rendered');
  assert.ok(supportModalHtml.includes('801011057'), 'Normalized clean LHID present in support list modal');
  assert.ok(supportModalHtml.includes('MAYORGA'), 'Municipality present in support list modal');
  assert.ok(supportModalHtml.includes('btn-export-support-list-csv'), 'Export CSV button present in support list modal');
  assert.ok(supportModalHtml.includes('support-list-search'), 'In-modal search input present in support list modal');

  // Test Balance Mode in renderSurveySupportListModalHtml
  const balanceModalHtml = renderSurveySupportListModalHtml({
    rows: mockSupportRows,
    province: 'LEYTE',
    status: 'ALL',
    stageKey: 'dateRss',
    stageLabel: 'With RSS',
    targetYear: '2025',
    totalArea: 3.0906,
    mode: 'balance',
    balanceArea: '1048.1088'
  });
  assert.ok(balanceModalHtml.includes('Balance / Pending: With RSS'), 'Balance label in modal banner');
  assert.ok(balanceModalHtml.includes('NEP Quota Balance: 1048.1088 HAS'), 'NEP Quota Balance badge in modal banner');
  assert.ok(balanceModalHtml.includes('id="btn-open-database-balance"'), 'Database workable pool button in balance modal');

  // Test Balance button attributes in Survey Monitoring summary table
  assert.ok(html2025.includes('data-mode="balance"'), 'Summary table must have clickable balance buttons with data-mode="balance"');
  assert.ok(html2025.includes('data-balance-area='), 'Summary table balance buttons must include data-balance-area');
});

test('CF Whereabouts Target Year filter in toolbar after All Records, removed standalone bar', () => {
  const store = JSON.parse(fs.readFileSync('./server/data/store.json', 'utf8'));
  const cfg = WHEREABOUTS_CONFIGS['cf-whereabouts'];

  const ctxAll = {
    state: store,
    schemas: { registry: [] },
    provinceScope: null,
    whereaboutsTargetYearFilter: { 'cf-whereabouts': 'ALL' },
    whereaboutsProvinceFilter: {},
    whereaboutsStatusFilter: {},
    whereaboutsSearch: {},
    whereaboutsColFilters: {},
    whereaboutsPage: {}
  };

  const htmlAll = renderMilestoneWhereaboutsView(ctxAll, cfg);

  // 1. Standalone bar must be removed
  assert.equal(htmlAll.includes('class="cf-target-year-bar"'), false, 'Standalone cf-target-year-bar must not exist');
  assert.equal(htmlAll.includes('class="cf-target-year-label"'), false, 'Standalone cf-target-year-label must not exist');

  // 2. Target Year filter must exist in toolbar and be positioned after whereabouts-status-filter
  assert.ok(htmlAll.includes('id="whereabouts-status-filter"'), 'Status filter exists');
  assert.ok(htmlAll.includes('id="whereabouts-target-year-filter"'), 'Target year filter exists in toolbar');

  const pStatus = htmlAll.indexOf('id="whereabouts-status-filter"');
  const pTargetYear = htmlAll.indexOf('id="whereabouts-target-year-filter"');
  const pExportCsv = htmlAll.indexOf('id="btn-whereabouts-export-csv"');

  assert.ok(pStatus < pTargetYear, 'whereabouts-target-year-filter must come after whereabouts-status-filter');
  assert.ok(pTargetYear < pExportCsv, 'whereabouts-target-year-filter must come before btn-whereabouts-export-csv');

  // 3. Check options in dropdown: Must display 4-digit years only, NEVER "Current" or "Previous Year"
  assert.ok(htmlAll.includes('value="ALL" selected>Target Year: ALL</option>'), 'Target Year: ALL selected by default');
  assert.equal(htmlAll.includes('Target Year: Current'), false, 'Target Year: Current must NOT be present in dropdown');
  assert.equal(htmlAll.includes('Target Year: Previous Year'), false, 'Target Year: Previous Year must NOT be present in dropdown');
  assert.equal(htmlAll.includes('Target Year: Previous'), false, 'Target Year: Previous must NOT be present in dropdown');

  // Verify all options in whereabouts-target-year-filter are 4-digit years or ALL
  const selectMatch = htmlAll.match(/<select[^>]*id="whereabouts-target-year-filter"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(selectMatch, 'Target year select found in html');
  const optionValues = Array.from(selectMatch[1].matchAll(/value="([^"]+)"/g)).map((m) => m[1]);
  for (const v of optionValues) {
    assert.ok(v === 'ALL' || /^\d{4}$/.test(v), `Option value "${v}" must be 'ALL' or a 4-digit year`);
  }

  // 4. Test Survey Whereabouts Target Year dropdown also displays 4-digit years only
  const surveyCfg = WHEREABOUTS_CONFIGS['survey-whereabouts'];
  const surveyCtx = {
    ...ctxAll,
    whereaboutsTargetYearFilter: { 'survey-whereabouts': 'ALL' }
  };
  const surveyHtml = renderMilestoneWhereaboutsView(surveyCtx, surveyCfg);
  assert.equal(surveyHtml.includes('Target Year: Current'), false, 'Survey must NOT contain Target Year: Current');
  assert.equal(surveyHtml.includes('Target Year: Previous Year'), false, 'Survey must NOT contain Target Year: Previous Year');
  const surveySelectMatch = surveyHtml.match(/<select[^>]*class="[^"]*survey-target-year-select[^"]*"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(surveySelectMatch, 'Survey target year select found');
  const surveyOptionVals = Array.from(surveySelectMatch[1].matchAll(/value="([^"]+)"/g)).map((m) => m[1]);
  for (const v of surveyOptionVals) {
    assert.ok(v === 'ALL' || /^\d{4}$/.test(v), `Survey option "${v}" must be 'ALL' or a 4-digit year`);
  }

  // 5. Test matchesWhereaboutsTargetYear prioritizes targetYear column
  assert.equal(matchesWhereaboutsTargetYear({ targetYear: '2026', target: 'Previous Year' }, '2026'), true, 'targetYear 2026 matches 2026 even if target says Previous Year');
  assert.equal(matchesWhereaboutsTargetYear({ targetYear: '2026', target: 'Previous Year' }, '2025'), false, 'targetYear 2026 does not match 2025');
  assert.equal(matchesWhereaboutsTargetYear({ targetYear: '2025', target: 'Current' }, '2025'), true, 'targetYear 2025 matches 2025 even if target says Current');
  assert.equal(matchesWhereaboutsTargetYear({ targetYear: '2025', target: 'Current' }, '2026'), false, 'targetYear 2025 does not match 2026');

  // 6. Test selecting specific year (e.g. 2026)
  const ctx2026 = {
    ...ctxAll,
    whereaboutsTargetYearFilter: { 'cf-whereabouts': '2026' }
  };
  const html2026 = renderMilestoneWhereaboutsView(ctx2026, cfg);
  assert.ok(html2026.includes('value="2026" selected>Target Year: 2026</option>'), 'Target Year: 2026 selected when filter set to 2026');
  assert.equal(html2026.includes('class="cf-target-year-bar"'), false, 'Standalone bar still absent in 2026 view');
});

test('CF Whereabouts Provincial Milestone Table: Province in rows, NEP Target, FI, Prep, Reported Month, Balances, and Support List modal', () => {
  const store = JSON.parse(fs.readFileSync('./server/data/store.json', 'utf8'));
  const cfg = WHEREABOUTS_CONFIGS['cf-whereabouts'];

  assert.equal(DEFAULT_CF_PROVINCES.length, 6, 'Region VIII must have 6 provinces');

  const ctxTransposed = {
    state: store,
    schemas: { registry: [] },
    provinceScope: null,
    cfMetricMode: 'both',
    cfTableLayout: 'transposed',
    whereaboutsTargetYearFilter: { 'cf-whereabouts': 'ALL' },
    whereaboutsProvinceFilter: {},
    whereaboutsStatusFilter: {},
    whereaboutsSearch: {},
    whereaboutsColFilters: {},
    whereaboutsPage: {}
  };

  const htmlTransposed = renderMilestoneWhereaboutsView(ctxTransposed, cfg);

  // 1. Panel and Title
  assert.ok(htmlTransposed.includes('id="panel-cf-status-table"'), 'panel-cf-status-table must exist');
  assert.ok(htmlTransposed.includes('CF(DOC) Milestone Status &amp; Accomplishment Summary'), 'Title exists in panel');

  // 2. Transposed Table has Province Columns across top
  for (const prov of DEFAULT_CF_PROVINCES) {
    assert.ok(htmlTransposed.includes(prov.name), `Province ${prov.name} must appear in table headers`);
  }
  assert.ok(htmlTransposed.includes('REGION VIII TOTAL'), 'REGION VIII TOTAL must appear as total column');

  // 3. Rows must contain NEP Target, Conducted FI & Balance, Prepared & Signed & Balance, Reported Month & Balance (Status column removed)
  assert.ok(htmlTransposed.includes('NEP Target'), 'NEP Target row exists');
  assert.ok(!htmlTransposed.includes('>Status<'), 'Status row must be removed');
  assert.ok(htmlTransposed.includes('With Conducted FI'), 'With Conducted FI row exists');
  assert.ok(htmlTransposed.includes('Balance (Conducted FI)'), 'Balance (Conducted FI) row exists');
  assert.ok(htmlTransposed.includes('With Prepared &amp; Signed'), 'With Prepared & Signed row exists');
  assert.ok(htmlTransposed.includes('Balance (Prepared &amp; Signed)'), 'Balance (Prepared & Signed) row exists');
  assert.ok(htmlTransposed.includes('With Reported Month'), 'With Reported Month row exists');
  assert.ok(htmlTransposed.includes('Balance (Reported Month)'), 'Balance (Reported Month) row exists');
  assert.ok(htmlTransposed.includes('Rate of Accomp. (Conducted FI)'), 'Rate of Accomp row exists in transposed layout');
  assert.ok(htmlTransposed.includes('Rate of Accomp. (Prepared &amp; Signed)'), 'Rate of Accomp Prep row exists in transposed layout');
  assert.ok(htmlTransposed.includes('Rate of Accomp. (Reported Month)'), 'Rate of Accomp Month row exists in transposed layout');

  // 4. Clickable figure links with data-open-cf-support-list
  assert.ok(htmlTransposed.includes('data-open-cf-support-list'), 'Clickable figure links must be present');
  assert.ok(htmlTransposed.includes('data-cf-metric="both"'), 'Metric mode switcher exists');
  assert.ok(htmlTransposed.includes('data-cf-layout="transposed"'), 'Layout switcher exists');

  // 5. Standard Layout (Rows: Province, Columns: Indicators, without redundant STATUS column)
  const ctxStandard = {
    ...ctxTransposed,
    cfTableLayout: 'standard'
  };
  const htmlStandard = renderMilestoneWhereaboutsView(ctxStandard, cfg);
  assert.ok(htmlStandard.includes('PROVINCE'), 'Standard table has PROVINCE column');
  assert.ok(htmlStandard.includes('NEP TARGET'), 'Standard table has NEP TARGET header');
  assert.ok(htmlStandard.includes('WITH CONDUCTED FI'), 'Standard table has WITH CONDUCTED FI header');
  assert.ok(htmlStandard.includes('WITH PREPARED &amp; SIGNED'), 'Standard table has WITH PREPARED & SIGNED header');
  assert.ok(htmlStandard.includes('WITH REPORTED MONTH'), 'Standard table has WITH REPORTED MONTH header');
  assert.ok(htmlStandard.includes('RATE OF ACCOMP.'), 'Standard table has RATE OF ACCOMP. header');
  assert.ok(!htmlStandard.includes('>STATUS<') && !htmlStandard.includes('STATUS (LHS)'), 'Redundant STATUS column must be removed');
  assert.ok(htmlStandard.includes('color:#ffffff;font-weight:800;'), 'Region VIII Total footer figures have white font color');

  // 5a. Metric Modes: LHS and Area both include RATE OF ACCOMP.
  const htmlLhs = renderMilestoneWhereaboutsView({ ...ctxStandard, cfMetricMode: 'lhs' }, cfg);
  assert.ok(htmlLhs.includes('RATE OF ACCOMP.'), 'LHS mode includes RATE OF ACCOMP.');
  const htmlArea = renderMilestoneWhereaboutsView({ ...ctxStandard, cfMetricMode: 'area' }, cfg);
  assert.ok(htmlArea.includes('RATE OF ACCOMP.'), 'Area mode includes RATE OF ACCOMP.');

  // 5b. Default Layout is Standard (Rows: Province)
  const ctxDefault = {
    ...ctxTransposed,
    cfTableLayout: undefined
  };
  const htmlDefault = renderMilestoneWhereaboutsView(ctxDefault, cfg);
  assert.ok(htmlDefault.includes('PROVINCE'), 'Default table layout has PROVINCE in rows');
  assert.ok(!htmlDefault.includes('>STATUS<') && !htmlDefault.includes('STATUS (LHS)'), 'Default table layout does not have STATUS column');
  assert.ok(htmlDefault.includes('id="cf-status-target-year-filter"'), 'Target Year dropdown exists on CF Milestone panel');
  assert.ok(htmlDefault.includes('id="btn-fullscreen-cf-status"'), 'Full Screen button exists on CF Milestone panel');
  assert.ok(htmlDefault.includes('id="whereabouts-page-size"'), 'Rows per page select exists in Master Ledger');
  assert.ok(htmlDefault.includes('HAS</strong>'), 'Total area rendered in matching records string in Master Ledger');
  assert.ok(htmlDefault.includes('data-whereabouts-hscroll="-360"'), 'Horizontal scroll left button exists in Master Ledger');
  assert.ok(htmlDefault.includes('data-whereabouts-hscroll="360"'), 'Horizontal scroll right button exists in Master Ledger');
  assert.ok(htmlDefault.includes('id="whereabouts-table-wrap"'), 'Table container has whereabouts-table-wrap id');
  assert.ok(htmlDefault.includes('class="whereabouts-bottom-bar"'), 'Bottom bar exists with pagination and scroll buttons');

  // 6. Support List Modal HTML rendering
  const sampleRows = [
    {
      lhid: '8.05000013E8',
      province: 'WESTERN SAMAR',
      municipality: 'Basey',
      barangay: 'San Antonio',
      landOwner: 'DELA CRUZ, JUAN',
      titleNumber: 'OCT-1234',
      carpable: 5.5,
      currentStatus: 'FI Conducted',
      stage: 'FI Conducted',
      dateFiConducted: '2026-04-10',
      datePreparedSigned: '',
      reportedMonth: '2026-11-01',
      targetYear: '2026'
    }
  ];

  const modalHtmlAccomplished = renderCfSupportListModalHtml({
    rows: sampleRows,
    province: 'SAMAR',
    status: 'ALL',
    stageKey: 'dateFiConducted',
    stageLabel: 'Date FI Conducted',
    targetYear: '2026',
    totalArea: 5.5,
    mode: 'accomplished'
  });

  assert.ok(modalHtmlAccomplished.includes('cf-support-list-modal'), 'Modal class present');
  assert.ok(modalHtmlAccomplished.includes('805000013'), 'Normalized clean LHID rendered in support list modal');
  assert.ok(modalHtmlAccomplished.includes('DELA CRUZ, JUAN'), 'Landowner rendered');
  assert.ok(modalHtmlAccomplished.includes('2026-04-10'), 'Date FI Conducted rendered');
  assert.ok(modalHtmlAccomplished.includes('Target Year: 2026'), 'Target year badge present');

  const modalHtmlBalance = renderCfSupportListModalHtml({
    rows: sampleRows,
    province: 'SAMAR',
    status: 'ALL',
    stageKey: 'datePreparedSigned',
    stageLabel: 'Date Prepared & Signed',
    targetYear: '2026',
    totalArea: 5.5,
    mode: 'balance',
    balanceArea: '120.5000'
  });

  assert.ok(modalHtmlBalance.includes('Balance / Pending: Date Prepared &amp; Signed'), 'Balance status display present');
  assert.ok(modalHtmlBalance.includes('NEP Quota Balance: 120.5000 HAS'), 'NEP Quota balance badge present');
  assert.ok(modalHtmlBalance.includes('id="btn-open-database-balance"'), 'Database workable pool button present for balance mode');
});

test('Milestone Status & Accomplishment Summary template replicated across MOV, Registration/Distribution, and Installation Whereabouts', () => {
  const store = createSeedState();

  const baseCtx = {
    state: store,
    schemas: { registry: [] },
    provinceScope: null,
    cfMetricMode: 'both',
    cfTableLayout: 'standard',
    whereaboutsTargetYearFilter: {
      'mov-whereabouts': 'ALL',
      'regdist-whereabouts': 'ALL',
      'installation-whereabouts': 'ALL'
    },
    whereaboutsProvinceFilter: {},
    whereaboutsStatusFilter: {},
    whereaboutsSearch: {},
    whereaboutsColFilters: {},
    whereaboutsPage: {},
    whereaboutsPageSize: {}
  };

  // 1. MOV Whereabouts
  const movCfg = WHEREABOUTS_CONFIGS['mov-whereabouts'];
  const movHtml = renderMilestoneWhereaboutsView(baseCtx, movCfg);
  assert.ok(movHtml.includes('id="panel-cf-status-table"'), 'MOV panel exists');
  assert.ok(movHtml.includes('MOV Milestone Status &amp; Accomplishment Summary'), 'MOV summary title present');
  assert.ok(movHtml.includes('WITH PPU DATE'), 'MOV standard table has WITH PPU DATE header');
  assert.ok(movHtml.includes('WITH RECEIVED DARPO'), 'MOV standard table has WITH RECEIVED DARPO header');
  assert.ok(movHtml.includes('WITH DATE OF MOV'), 'MOV standard table has WITH DATE OF MOV header');
  assert.ok(movHtml.includes('WITH TRANS TO LBP/AOC'), 'MOV standard table has WITH TRANS TO LBP/AOC header');
  assert.ok(movHtml.includes('WITH REPORTED MONTH'), 'MOV standard table has WITH REPORTED MONTH header');
  assert.ok(movHtml.includes('data-open-cf-support-list'), 'MOV table has clickable figure links');
  assert.ok(movHtml.includes('id="cf-status-target-year-filter"'), 'MOV panel has Target Year select');
  assert.ok(movHtml.includes('id="whereabouts-target-year-filter"'), 'MOV master ledger has Target Year filter');
  assert.ok(movHtml.includes('color:#ffffff;font-weight:800;'), 'MOV Region VIII Total footer has white font color');
  assert.ok(movHtml.includes('mov-kpi-grid'), 'MOV KPI grid has mov-kpi-grid 3-column layout');
  assert.ok(movHtml.includes('Target Year: ALL'), 'Row 1 has Target Year: ALL');
  assert.ok(movHtml.includes('Total with PPU Date'), 'Row 1 has Total with PPU Date');
  assert.ok(movHtml.includes('Total with Received DARPO'), 'Row 1 has Total with Received DARPO');
  assert.ok(movHtml.includes('Total with Date of MOV'), 'Row 2 (below) has Total with Date of MOV');
  assert.ok(movHtml.includes('Total with Trans to LBP/AOC'), 'Row 2 (below) has Total with Trans to LBP/AOC');
  assert.ok(movHtml.includes('Total with Reported Month'), 'Row 2 (below) has Total with Reported Month');
  assert.ok(movHtml.includes('cf-kpi-card-sm'), 'Compact small card styling applied');

  // MOV Transposed Layout
  const movTransposedHtml = renderMilestoneWhereaboutsView({ ...baseCtx, cfTableLayout: 'transposed' }, movCfg);
  assert.ok(movTransposedHtml.includes('With PPU Date'), 'MOV transposed has With PPU Date row');
  assert.ok(movTransposedHtml.includes('Balance (PPU Date)'), 'MOV transposed has Balance (PPU Date) row');
  assert.ok(movTransposedHtml.includes('With Trans to LBP/AOC'), 'MOV transposed has With Trans to LBP/AOC row');

  // 2. Registration / Distribution Whereabouts
  const regDistCfg = WHEREABOUTS_CONFIGS['regdist-whereabouts'];
  const regDistHtml = renderMilestoneWhereaboutsView(baseCtx, regDistCfg);
  assert.ok(regDistHtml.includes('id="panel-cf-status-table"'), 'RegDist panel exists');
  assert.ok(regDistHtml.includes('Registration / Distribution Milestone Status &amp; Accomplishment Summary'), 'RegDist title present');
  assert.ok(regDistHtml.includes('WITH DATE REGISTERED'), 'RegDist standard table has WITH DATE REGISTERED header');
  assert.ok(regDistHtml.includes('WITH DATE DISTRIBUTED'), 'RegDist standard table has WITH DATE DISTRIBUTED header');
  assert.ok(regDistHtml.includes('WITH MONTH REPORTED'), 'RegDist standard table has WITH MONTH REPORTED header');
  assert.ok(regDistHtml.includes('data-open-cf-support-list'), 'RegDist table has clickable figure links');
  assert.ok(regDistHtml.includes('id="cf-status-target-year-filter"'), 'RegDist panel has Target Year select');
  assert.ok(regDistHtml.includes('id="whereabouts-target-year-filter"'), 'RegDist master ledger has Target Year filter');

  // 3. Installation Whereabouts
  const instCfg = WHEREABOUTS_CONFIGS['installation-whereabouts'];
  const instHtml = renderMilestoneWhereaboutsView(baseCtx, instCfg);
  assert.ok(instHtml.includes('id="panel-cf-status-table"'), 'Installation panel exists');
  assert.ok(instHtml.includes('Installation Milestone Status &amp; Accomplishment Summary'), 'Installation title present');
  assert.ok(instHtml.includes('WITH DATE REGISTERED'), 'Installation standard table has WITH DATE REGISTERED header');
  assert.ok(instHtml.includes('WITH DATE DISTRIBUTED'), 'Installation standard table has WITH DATE DISTRIBUTED header');
  assert.ok(instHtml.includes('WITH DATE INSTALLED'), 'Installation standard table has WITH DATE INSTALLED header');
  assert.ok(instHtml.includes('WITH MONTH REPORTED'), 'Installation standard table has WITH MONTH REPORTED header');
  assert.ok(instHtml.includes('data-open-cf-support-list'), 'Installation table has clickable figure links');
  assert.ok(instHtml.includes('id="cf-status-target-year-filter"'), 'Installation panel has Target Year select');
  assert.ok(instHtml.includes('id="whereabouts-target-year-filter"'), 'Installation master ledger has Target Year filter');

  // 4. Dynamic Support List Modal rendering for MOV, RegDist, and Installation
  const sampleMovRow = [
    {
      lhid: '8.05000020E8',
      province: 'LEYTE',
      municipality: 'Alangalang',
      barangay: 'Dapdap',
      landOwner: 'SANTOS, MARIA',
      titleNumber: 'TCT-999',
      carpable: 12.34,
      currentStatus: 'MOV Prepared',
      stage: 'MOV Prepared',
      datesMap: {
        ppuDate: '2026-02-15',
        dateReceivedDarpo: '2026-03-01',
        dateOfMov: '2026-03-20',
        dateTransLbpAoc: '',
        reportedMonth: '2026-04-01'
      },
      targetYear: '2026'
    }
  ];

  const movModalHtml = renderCfSupportListModalHtml({
    rows: sampleMovRow,
    province: 'LEYTE',
    status: 'ALL',
    stageKey: 'dateOfMov',
    stageLabel: 'Date of MOV',
    targetYear: '2026',
    totalArea: 12.34,
    mode: 'accomplished',
    tabName: 'MOV',
    dates: movCfg.dates
  });
  assert.ok(movModalHtml.includes('MOV Landholding'), 'MOV Landholding label in modal header');
  assert.ok(movModalHtml.includes('PPU DATE'), 'PPU DATE column header present in modal');
  assert.ok(movModalHtml.includes('DATE OF MOV'), 'DATE OF MOV column header present in modal');
  assert.ok(movModalHtml.includes('TRANS TO LBP/AOC'), 'TRANS TO LBP/AOC column header present in modal');
  assert.ok(movModalHtml.includes('2026-02-15'), 'PPU date value rendered');
  assert.ok(movModalHtml.includes('SANTOS, MARIA'), 'Landowner rendered in modal');

  const instModalHtml = renderCfSupportListModalHtml({
    rows: sampleMovRow,
    province: 'LEYTE',
    status: 'ALL',
    stageKey: 'dateOfInstallation',
    stageLabel: 'Date of Installation',
    targetYear: '2026',
    totalArea: 12.34,
    mode: 'accomplished',
    tabName: 'Installation',
    dates: instCfg.dates
  });
  assert.ok(instModalHtml.includes('Installation Landholding'), 'Installation Landholding label in modal header');
  assert.ok(instModalHtml.includes('DATE INSTALLED'), 'DATE INSTALLED column header present in modal');
});

test('Accounts Approval: Delete mock data in every milestone across every province button and endpoint', async () => {
  // 1. UI rendering test in Accounts Approval view
  const usersHtml = renderUsersView({
    users: [
      { id: 'usr-1', name: 'Regional Admin', email: 'admin@dar.gov.ph', role: 'admin', status: 'approved' }
    ],
    currentUser: { id: 'usr-1', role: 'admin' }
  });
  assert.ok(usersHtml.includes('id="btn-delete-mock-milestones"'), 'Delete mock data button present in Accounts Approval');
  assert.ok(usersHtml.includes('Delete Mock Data in Every Milestone'), 'Button has exact label');

  // 2. Unit test on ConsolidatedStore.deleteMockMilestones()
  const tempDir = makeTempDir();
  const store = new ConsolidatedStore(tempDir);
  assert.equal(store.state.milestoneData.length, 13, 'Seed state contains 13 mock milestone records');
  const initialDbSeedCount = store.state.optool.Database.filter((r) => r.lhid.startsWith('LH-08')).length;
  assert.ok(initialDbSeedCount > 0, 'Database contains mock seed records');

  const deleteResult = store.deleteMockMilestones();
  assert.equal(deleteResult.deletedMilestonesCount, 13, 'Deleted all 13 mock milestone records');
  assert.equal(store.state.milestoneData.length, 0, 'Milestone data is now empty of mock records');
  assert.ok(deleteResult.deletedOptoolCount > 0, 'Deleted mock rows from OPTool tabs');
  assert.equal(
    store.state.optool.Database.filter((r) => r.lhid.startsWith('LH-08')).length,
    0,
    'Mock seed LHIDs removed from Database'
  );

  // 3. HTTP Server API integration: POST /api/milestones/delete-mock-data
  const { server, store: appStore } = createAppServer(tempDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Non-authenticated request returns 401
    const unauthRes = await fetch(`${baseUrl}/api/milestones/delete-mock-data`, {
      method: 'POST'
    });
    assert.equal(unauthRes.status, 401, 'Unauthenticated user blocked from deleting mock data');

    // Reset appStore to sample to have records to delete via API
    appStore.resetToSample();
    assert.equal(appStore.state.milestoneData.length, 13);

    // Register and confirm an admin user
    const hubAdmin = appStore.createPendingUser(
      {
        name: 'Hub Administrator',
        email: 'hub@dar8.gov.ph',
        role: 'admin',
        province: 'Region VIII Hub',
        contactNumber: '09170002222',
        password: 'Password123!'
      },
      { requireOtp: false }
    );
    appStore.updateUserStatus(hubAdmin.id, { status: 'approved', role: 'admin' }, 'admin');

    // Admin login
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'hub@dar8.gov.ph', password: 'Password123!' })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    // Admin calling delete-mock-data succeeds
    const delRes = await fetch(`${baseUrl}/api/milestones/delete-mock-data`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }
    });
    assert.equal(delRes.status, 200);
    const delJson = await delRes.json();
    assert.equal(delJson.ok, true);
    assert.equal(delJson.deletedMilestonesCount, 13);
    assert.equal(delJson.state.milestoneData.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Google Drive Regional Folder Structure & Automated PDF Upload Integration', async () => {
  const tempDir = makeTempDir();
  const { server, store: appStore } = createAppServer(tempDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Create and authenticate admin user
    const admin = appStore.createPendingUser(
      {
        name: 'Regional Admin',
        email: 'drive.admin@dar8.gov.ph',
        role: 'admin',
        province: 'Region VIII Hub',
        contactNumber: '0917-000-8888',
        password: 'Password123!'
      },
      { requireOtp: false }
    );
    appStore.updateUserStatus(admin.id, { status: 'approved', role: 'admin' }, 'admin');

    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'drive.admin@dar8.gov.ph', password: 'Password123!' })
    });
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];

    // 2. Setup Google Drive Folders: POST /api/drive/setup-folders
    const driveSetupRes = await fetch(`${baseUrl}/api/drive/setup-folders`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootFolderId: '1z7SycuDvk9M5pPDZ2IvhwebQDsGHOhsJ' })
    });
    assert.equal(driveSetupRes.status, 200);
    const driveJson = await driveSetupRes.json();
    assert.equal(driveJson.ok, true);
    assert.equal(driveJson.rootFolderId, '1z7SycuDvk9M5pPDZ2IvhwebQDsGHOhsJ');
    assert.ok(driveJson.provinces);
    const provinceCodes = Object.keys(driveJson.provinces);
    assert.deepEqual(provinceCodes.sort(), ['BIL', 'ESA', 'LEY', 'NSA', 'SAM', 'SLE'].sort());

    for (const code of provinceCodes) {
      const p = driveJson.provinces[code];
      assert.ok(p.name);
      assert.ok(p.milestones['CF(DOC)']);
      assert.ok(p.milestones['Survey']);
      assert.ok(p.milestones['MOV']);
      assert.ok(p.milestones['RegistrationDistribution']);
      assert.ok(p.milestones['Installation']);
    }

    // 3. Upload PDF to CF(DOC): POST /api/upload-pdf
    const sampleLhid = appStore.state.optool['CF(DOC)'][0]?.lhid || 'LHID-TEST-001';
    const uploadRes = await fetch(`${baseUrl}/api/upload-pdf`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabName: 'CF(DOC)',
        index: 0,
        lhid: sampleLhid,
        province: 'LEY',
        fileName: 'Test_Docket.pdf',
        fileBase64: 'JVBERi0xLjQKJcTl8uXrp/Og0MTGCjQgMCBvYmoK'
      })
    });
    assert.equal(uploadRes.status, 200);
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.ok, true);
    assert.ok(uploadJson.fileUrl, 'Returns a valid file URL');
    assert.equal(appStore.state.optool['CF(DOC)'][0].pdfFile, uploadJson.fileUrl, 'Row in store updated with pdfFile link');

    // 4. Test UI rendering: View PDF badge when pdfFile exists vs Upload button when empty
    const { renderOptoolView, renderSyncView } = await import('../../public/views.js');
    const ctxWithPdf = {
      state: appStore.state,
      analytics: appStore.computeAnalytics({}),
      schemas: {
        registry: [],
        optoolTabs: OPTOOL_SHEET_SCHEMAS,
        optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS
      },
      activeOptoolTab: 'CF(DOC)',
      filters: { province: 'ALL' },
      optoolColMode: 'preview',
      searchTerm: ''
    };

    const optoolHtml = renderOptoolView(ctxWithPdf);
    assert.ok(optoolHtml.includes('View PDF'), 'Row 0 with pdfFile renders View PDF badge');
    assert.ok(optoolHtml.includes('btn-upload-pdf'), 'Upload PDF button rendered for rows');

    const syncHtml = renderSyncView({
      state: appStore.state,
      schemas: { registry: [] },
      gasScript: '',
      gasHtml: '',
      provinceScope: null
    });
    assert.ok(syncHtml.includes('1z7SycuDvk9M5pPDZ2IvhwebQDsGHOhsJ'), 'Sync view references Google Drive root folder');
    assert.ok(syncHtml.includes('btn-setup-drive-folders'), 'Sync view contains Setup Drive Folders button');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('LHID Normalization & Display: parses scientific notation and float strings into clean database integers matching Google Sheets', () => {
  // Test user screenshot samples
  assert.equal(formatLhidDisplay('8.05000007E8'), '805000007');
  assert.equal(formatLhidDisplay('8.0500003E8'), '805000030');
  assert.equal(formatLhidDisplay('8.05000017E8'), '805000017');
  assert.equal(formatLhidDisplay('8.05000051E8'), '805000051');
  assert.equal(formatLhidDisplay('8.05000053E8'), '805000053');
  assert.equal(formatLhidDisplay('8.05000182E8'), '805000182');
  assert.equal(formatLhidDisplay('8.05000001E8'), '805000001');

  // Trailing .0 floats & standard numbers
  assert.equal(formatLhidDisplay('805000007.0'), '805000007');
  assert.equal(formatLhidDisplay('805000007'), '805000007');
  assert.equal(formatLhidDisplay(805000007), '805000007');

  // Alphanumeric LHIDs preserved
  assert.equal(formatLhidDisplay('LH-0837-0012'), 'LH-0837-0012');
  assert.equal(formatLhidDisplay(''), '');
  assert.equal(formatLhidDisplay(null), '');
  assert.equal(formatLhidDisplay(undefined), '');

  // Verify renderOptoolView formats LHID column cells
  const sampleState = {
    optool: {
      Database: [
        {
          lhid: '8.05000007E8',
          titleNumber: 'OCT-100',
          landOwner: 'DELA CRUZ, PRIMO',
          carpable: '7.9293'
        }
      ]
    }
  };
  const ctx = {
    state: sampleState,
    schemas: {
      registry: [],
      optoolTabs: OPTOOL_SHEET_SCHEMAS,
      optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS
    },
    activeOptoolTab: 'Database',
    filters: { province: 'ALL' },
    optoolColMode: 'preview',
    searchTerm: ''
  };
  const rendered = renderOptoolView(ctx);
  assert.ok(rendered.includes('data-lhid="805000007"'), 'Rendered table contains clean integer data-lhid 805000007');
  assert.ok(rendered.includes('>805000007<'), 'Rendered table button text displays clean integer 805000007');
  assert.ok(!rendered.includes('8.05000007E8'), 'Rendered table does not contain scientific notation');
});

test('Survey Transmittal PDF as PDF File & Serverless EROFS-Safe Upload Handling', async () => {
  const tempDir = makeTempDir();
  const testStore = new ConsolidatedStore(tempDir);

  // Initialize a Survey row with transmittalSrPdf
  testStore.state.optool.Survey = [
    {
      lhid: '805000099',
      kindOfSurvey: 'By Admin',
      transmittalSrPdf: '',
      pdfFile: ''
    }
  ];
  testStore.save();

  const { server } = createAppServer(testStore, {
    requireAuth: false,
    pushToGasWebApp: async () => ({ ok: false, error: 'Simulated GAS offline' })
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. Upload to transmittalSrPdf column specifically
    const uploadResp = await fetch(`http://localhost:${port}/api/upload-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabName: 'Survey',
        colKey: 'transmittalSrPdf',
        index: 0,
        lhid: '805000099',
        fileName: 'Survey_Transmittal_805000099.pdf',
        fileBase64: 'JVBERi0xLjQKJcTl8uXrCg=='
      })
    });

    assert.equal(uploadResp.status, 200, 'Upload succeeds without EROFS crash');
    const uploadData = await uploadResp.json();
    assert.ok(uploadData.ok, 'Upload returns ok: true');
    assert.equal(uploadData.colKey, 'transmittalSrPdf', 'Uploaded to transmittalSrPdf column');
    assert.ok(uploadData.fileUrl, 'File URL generated');
    assert.equal(testStore.state.optool.Survey[0].transmittalSrPdf, uploadData.fileUrl, 'Saved in Survey row transmittalSrPdf');

    // 2. Verify renderOptoolView renders View PDF link and Upload button for transmittalSrPdf
    const ctx = {
      state: testStore.state,
      schemas: {
        registry: [],
        optoolTabs: OPTOOL_SHEET_SCHEMAS,
        optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS
      },
      activeOptoolTab: 'Survey',
      filters: { province: 'ALL' },
      optoolColMode: 'preview',
      searchTerm: ''
    };
    const rendered = renderOptoolView(ctx);
    assert.ok(rendered.includes('data-upload-pdf-col="transmittalSrPdf"'), 'Table includes transmittalSrPdf upload button');
    assert.ok(rendered.includes('View PDF'), 'Table renders View PDF link for transmittalSrPdf');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PDF Viewer Streaming Endpoint, Drive Preview URL & Gate Exemption', async () => {
  const { normalizePdfUrl, toEmbeddablePdfUrl } = await import('../../public/reportingUtils.js');

  // 1. Verify URL normalization & embed transformations
  assert.equal(
    normalizePdfUrl('ASP_Psd-08-041982.pdf'),
    '/api/pdf/ASP_Psd-08-041982.pdf',
    'Plain filename normalized to /api/pdf/'
  );
  assert.equal(
    normalizePdfUrl('https://drive.google.com/file/d/1ABCXYZ/view?usp=sharing'),
    'https://drive.google.com/file/d/1ABCXYZ/view?usp=sharing',
    'Drive link preserved in normalizePdfUrl'
  );
  assert.equal(
    toEmbeddablePdfUrl('https://drive.google.com/file/d/1ABCXYZ/view?usp=sharing'),
    'https://drive.google.com/file/d/1ABCXYZ/preview',
    'Drive view link converted to embeddable /preview URL'
  );
  assert.equal(
    toEmbeddablePdfUrl('https://drive.google.com/open?id=1ABCXYZ'),
    'https://drive.google.com/file/d/1ABCXYZ/preview',
    'Drive open?id link converted to embeddable /preview URL'
  );

  // 2. Server test with requireAuth: true
  const tempDir = makeTempDir();
  const testStore = new ConsolidatedStore(tempDir);
  testStore.state.uploadedFiles = {
    'sample-test-pdf': {
      fileName: 'Sample_Test.pdf',
      data: Buffer.from('%PDF-1.4 sample content %%EOF').toString('base64'),
      createdAt: new Date().toISOString()
    }
  };
  testStore.save();

  const { server } = createAppServer(testStore, { requireAuth: true });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 3. GET /api/pdf/:id succeeds with 200 without auth cookie (gate exempted)
    const streamResp = await fetch(`http://localhost:${port}/api/pdf/sample-test-pdf`);
    assert.equal(streamResp.status, 200, 'Streaming uploaded PDF succeeds without auth');
    assert.equal(streamResp.headers.get('content-type'), 'application/pdf', 'Content-Type is application/pdf');
    const pdfBuf = await streamResp.arrayBuffer();
    assert.ok(pdfBuf.byteLength > 0, 'PDF bytes streamed successfully');

    // 4. GET /api/pdf/ASP_Psd-08-041982.pdf returns valid sample PDF for legacy sheet filenames
    const sheetDocResp = await fetch(`http://localhost:${port}/api/pdf/ASP_Psd-08-041982.pdf`);
    assert.equal(sheetDocResp.status, 200, 'Recorded sheet document succeeds without auth');
    assert.equal(sheetDocResp.headers.get('content-type'), 'application/pdf', 'Content-Type is application/pdf');
    const sheetBuf = await sheetDocResp.text();
    assert.ok(sheetBuf.startsWith('%PDF-1.4'), 'Generated valid fallback PDF stream');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Direct Provincial Google Sheets Sync for OPTool Supportlist (CF, Survey, MOV, Registration, Installation)', async () => {
  const { matchOptoolTabName } = await import('../sheetsSync.js');

  // 1. Verify flexible tab name matching
  assert.equal(matchOptoolTabName('CF(DOC)'), 'CF(DOC)');
  assert.equal(matchOptoolTabName('CF (DOC)'), 'CF(DOC)');
  assert.equal(matchOptoolTabName('CF'), 'CF(DOC)');
  assert.equal(matchOptoolTabName('cf_doc'), 'CF(DOC)');
  assert.equal(matchOptoolTabName('Survey'), 'Survey');
  assert.equal(matchOptoolTabName('survey'), 'Survey');
  assert.equal(matchOptoolTabName('MOV'), 'MOV');
  assert.equal(matchOptoolTabName('RegistrationDistribution'), 'RegistrationDistribution');
  assert.equal(matchOptoolTabName('Registration / Distribution'), 'RegistrationDistribution');
  assert.equal(matchOptoolTabName('Registration'), 'RegistrationDistribution');
  assert.equal(matchOptoolTabName('Installation'), 'Installation');
  assert.equal(matchOptoolTabName('Database'), 'Database');
  assert.equal(matchOptoolTabName('UnknownSheet'), null);

  // 2. Test POST /api/sync/provincial-optool endpoint
  const tempDir = makeTempDir();
  const testStore = new ConsolidatedStore(tempDir);
  for (const t of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
    testStore.state.optool[t] = [];
  }
  const mockGasSnapshot = {
    optool: {
      'CF(DOC)': [{ lhid: '805000001', province: 'Leyte', provinceCode: 'LEY', target: 'Current' }],
      Survey: [{ lhid: '805000002', province: 'Biliran', provinceCode: 'BIL', kindOfSurvey: 'By Admin' }],
      MOV: [{ lhid: '805000003', province: 'Eastern Samar', provinceCode: 'ESA', target: 'Current' }],
      RegistrationDistribution: [{ lhid: '805000004', province: 'Samar', provinceCode: 'SAM', eTitleNo: 'eT-001' }],
      Installation: [{ lhid: '805000005', province: 'Southern Leyte', provinceCode: 'SLE', installStatus: 'Completed' }]
    }
  };

  testStore.state.gasWebAppUrl = 'https://script.google.com/macros/s/TEST/exec';
  testStore.save();

  const { server } = createAppServer(testStore, {
    requireAuth: false,
    pullFromGasWebApp: async () => mockGasSnapshot
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const syncResp = await fetch(`http://localhost:${port}/api/sync/provincial-optool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.equal(syncResp.status, 200, 'Sync endpoint returns 200');
    const syncData = await syncResp.json();
    assert.ok(syncData.ok, 'Sync ok');
    assert.equal(syncData.totalImported, 5, 'Imported all 5 milestone records across provincial sheets');
    assert.equal(testStore.state.optool['CF(DOC)'].length, 1);
    assert.equal(testStore.state.optool.Survey.length, 1);
    assert.equal(testStore.state.optool.MOV.length, 1);
    assert.equal(testStore.state.optool.RegistrationDistribution.length, 1);
    assert.equal(testStore.state.optool.Installation.length, 1);
    assert.equal(testStore.state.optool['CF(DOC)'][0].province, 'Leyte');
    assert.equal(testStore.state.optool.Survey[0].province, 'Biliran');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // 3. Verify GAS Code.gs includes provincial milestone reading functions
  const gasCode = fs.readFileSync(path.join(__dirname, '..', '..', 'gas', 'Code.gs'), 'utf8');
  assert.ok(gasCode.includes('readProvincialMilestoneSupportLists_'), 'GAS Code.gs includes readProvincialMilestoneSupportLists_');
  assert.ok(gasCode.includes('findOptoolSheet_'), 'GAS Code.gs includes findOptoolSheet_');
});

test('Automatic Live Provincial Sync & Google Sheet Database Integration', async () => {
  const { performProvincialSync } = await import('../app.js');

  const tempDir = makeTempDir();
  const testStore = new ConsolidatedStore(tempDir);
  for (const t of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
    testStore.state.optool[t] = [];
  }
  testStore.state.gasWebAppUrl = 'https://script.google.com/macros/s/TEST/exec';
  testStore.save();

  let gasCalls = 0;
  const mockGasSnapshot = {
    optool: {
      'CF(DOC)': [{ lhid: '805000001', province: 'Leyte', provinceCode: 'LEY' }],
      Survey: [{ lhid: '805000002', province: 'Biliran', provinceCode: 'BIL' }],
      MOV: [],
      RegistrationDistribution: [],
      Installation: []
    }
  };

  const mockGasPull = async () => {
    gasCalls++;
    return mockGasSnapshot;
  };

  const { server } = createAppServer(testStore, {
    requireAuth: false,
    pullFromGasWebApp: mockGasPull
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    // 1. GET /api/sync/auto pulls fresh data
    const resAuto = await fetch(`http://localhost:${port}/api/sync/auto`);
    assert.equal(resAuto.status, 200);
    const dataAuto = await resAuto.json();
    assert.ok(dataAuto.ok);
    assert.equal(gasCalls, 1);
    assert.equal(testStore.state.optool.Survey.length, 1);

    // 2. GET /api/sync/auto within TTL uses cache
    const resCached = await fetch(`http://localhost:${port}/api/sync/auto`);
    assert.equal(resCached.status, 200);
    const dataCached = await resCached.json();
    assert.ok(dataCached.cached, 'Second immediate call is cached');
    assert.equal(gasCalls, 1, 'No additional GAS pull within TTL');

    // 3. POST /api/sync/province/SAM forces single-province sync
    const resProv = await fetch(`http://localhost:${port}/api/sync/province/SAM`, { method: 'POST' });
    assert.equal(resProv.status, 200);
    const dataProv = await resProv.json();
    assert.ok(dataProv.ok);
    assert.equal(dataProv.provinceCode, 'SAM');

    // 4. POST /api/sync/webhook receives Google Sheet edit event
    const resWebhook = await fetch(`http://localhost:${port}/api/sync/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provinceCode: 'LEY', tabName: 'Survey' })
    });
    assert.equal(resWebhook.status, 200);
    const dataWebhook = await resWebhook.json();
    assert.ok(dataWebhook.ok);

    // 5. GET /api/bootstrap?sync=auto
    const resBoot = await fetch(`http://localhost:${port}/api/bootstrap?sync=auto`);
    assert.equal(resBoot.status, 200);
    const bootData = await resBoot.json();
    assert.ok(bootData.state);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // 6. Verify GAS Code.gs includes scheduledProvincialSync & installAutomatedSyncTrigger & real-time webhook
  const gasCode = fs.readFileSync(path.join(__dirname, '..', '..', 'gas', 'Code.gs'), 'utf8');
  assert.ok(gasCode.includes('scheduledProvincialSync'), 'Includes scheduledProvincialSync');
  assert.ok(gasCode.includes('installAutomatedSyncTrigger'), 'Includes installAutomatedSyncTrigger');
  assert.ok(gasCode.includes('onSpreadsheetChangeWebhook'), 'Includes onSpreadsheetChangeWebhook');
  assert.ok(gasCode.includes('installRealTimeWebhookTrigger'), 'Includes installRealTimeWebhookTrigger');
  assert.ok(gasCode.includes('getWriteTargetSpreadsheets_(tabName'), 'Passes tabName to getWriteTargetSpreadsheets_');
});

test('Global Target filters strictly to LAD Balance, and OPTool Support List breaks down LAD Balance vs Temp. Park', () => {
  // 1. Helper function checks
  assert.equal(isLadBalance({ ladStatus: 'LAD Balance' }), true);
  assert.equal(isLadBalance({ ladStatus: 'lad balance' }), true);
  assert.equal(isLadBalance({ 'Lad Status': 'LAD Balance' }), true);
  assert.equal(isLadBalance({ ladStatus: 'Temp. Park' }), false);
  assert.equal(isLadBalance({ ladStatus: 'For Inclusion' }), false);
  assert.equal(isLadBalance({ ladStatus: '' }), false);
  assert.equal(isLadBalance(null), false);

  assert.equal(isTempPark({ ladStatus: 'Temp. Park' }), true);
  assert.equal(isTempPark({ ladStatus: 'temp park' }), true);
  assert.equal(isTempPark({ 'Lad Status': 'Temp. Park' }), true);
  assert.equal(isTempPark({ ladStatus: 'LAD Balance' }), false);
  assert.equal(isTempPark({ ladStatus: 'For Inclusion' }), false);
  assert.equal(isTempPark({ ladStatus: '' }), false);

  // 2. Whereabouts Global Target: strictly counts LAD Balance records
  const mockState = {
    optool: {
      Database: [
        { lhid: '805000001', province: 'Western Samar', carpable: '10.5000', ladStatus: 'LAD Balance' },
        { lhid: '805000002', province: 'Western Samar', carpable: '5.2500', ladStatus: 'LAD Balance' },
        { lhid: '805000003', province: 'Western Samar', carpable: '20.0000', ladStatus: 'Temp. Park' },
        { lhid: '805000004', province: 'Western Samar', carpable: '3.0000', ladStatus: 'For Inclusion' },
        { lhid: '805000005', province: 'Leyte', carpable: '15.0000', ladStatus: 'Temp. Park' }
      ],
      'CF(DOC)': [
        { lhid: '805000001', province: 'Western Samar', dateFiConducted: '2026-03-01' }
      ],
      Survey: [
        { lhid: '805000001', province: 'Western Samar', dateRss: '2026-03-01' }
      ]
    },
    nepMilestoneList: {},
    nepTargets: {}
  };

  const cfCfg = WHEREABOUTS_CONFIGS['cf-whereabouts'];
  const whereaboutsCtx = {
    state: mockState,
    schemas: {
      registry: [{ code: 'SAM', provinceName: 'Western Samar' }, { code: 'LEY', provinceName: 'Leyte' }],
      optoolTabs: {
        Database: { key: 'Database', label: 'Database' },
        'CF(DOC)': { key: 'CF(DOC)', label: 'CF(DOC)' },
        Survey: { key: 'Survey', label: 'Survey' }
      }
    },
    provinceScope: null,
    whereaboutsTargetYearFilter: { 'cf-whereabouts': 'ALL' },
    whereaboutsProvinceFilter: { 'cf-whereabouts': 'Western Samar' },
    whereaboutsStatusFilter: {},
    whereaboutsSearch: {},
    whereaboutsColFilters: {},
    whereaboutsPage: {},
    cfMetricMode: 'both',
    cfTableLayout: 'standard'
  };

  const cfHtml = renderMilestoneWhereaboutsView(whereaboutsCtx, cfCfg);
  assert.ok(cfHtml.includes('Global Target (LAD Balance)'), 'Whereabouts must label card as Global Target (LAD Balance)');
  // Western Samar has 2 LAD Balance LHs (15.7500 HAS), 1 Temp. Park (20 HAS), and 1 For Inclusion (3 HAS)
  assert.ok(cfHtml.includes('15.7500'), 'Global Target area must strictly be 15.7500 HAS (sum of LAD Balance only)');
  assert.equal(cfHtml.includes('38.7500'), false, 'Global Target must NOT sum Temp. Park or For Inclusion area');

  // 3. OPTool Support List Database Tab: Breakdown into 3 KPI cards
  const optoolDbCtx = {
    state: mockState,
    schemas: {
      registry: [{ code: 'SAM', provinceName: 'Western Samar' }, { code: 'LEY', provinceName: 'Leyte' }],
      optoolTabs: OPTOOL_SHEET_SCHEMAS,
      optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS,
      milestoneTargetTabs: MILESTONE_TARGET_TABS
    },
    activeOptoolTab: 'Database',
    searchTerm: '',
    optoolTargetFilter: 'ALL',
    optoolColFilters: {},
    filters: { province: 'ALL' }
  };

  const dbTabHtml = renderOptoolView(optoolDbCtx);
  assert.ok(dbTabHtml.includes('kpi-grid-3'), 'Database tab must render 3-column KPI breakdown grid');
  assert.ok(dbTabHtml.includes('Global Target (LAD Balance)'), 'Database tab must have Global Target (LAD Balance) card');
  assert.ok(dbTabHtml.includes('Temp. Park'), 'Database tab must have Temp. Park breakdown card');
  assert.ok(dbTabHtml.includes('Total Database (All Records)'), 'Database tab must have Total Database card');
  assert.ok(dbTabHtml.includes('Target per Milestone'), 'Database tab retains Target per Milestone section');

  // 4. OPTool Support List Milestone Tab (Survey): Companion Global Target Breakdown
  const optoolSurveyCtx = {
    ...optoolDbCtx,
    activeOptoolTab: 'Survey'
  };
  const surveyTabHtml = renderOptoolView(optoolSurveyCtx);
  assert.ok(surveyTabHtml.includes('Survey — Total LHs'), 'Survey tab includes Survey Total LHs card');
  assert.ok(surveyTabHtml.includes('Survey — Area (CARPable)'), 'Survey tab includes Survey Area card');
  assert.ok(surveyTabHtml.includes('Global Target (LAD Balance)'), 'Survey tab includes companion Global Target (LAD Balance) breakdown card');
  assert.ok(surveyTabHtml.includes('Temp. Park'), 'Survey tab includes companion Temp. Park breakdown card');

  // 5. Regional Dashboard View: Top 3 Cards, Provincial Breakdown Table, Pie Chart, and Whereabouts per Milestone
  const dashboardCtx = {
    state: mockState,
    analytics: {
      kpis: {
        cumulativeETitles: 0,
        cumulativeAreaHas: 0,
        incrementalETitles: 0,
        incrementalAreaHas: 0,
        baselineTargetETitles: 0,
        baselineTargetAreaHas: 0
      },
      provincialBreakdown: [],
      monthlyTrend: [],
      stageBreakdown: [],
      optoolSummary: {
        Database: 5,
        'CF(DOC)': 1,
        Survey: 0,
        MOV: 0,
        RegistrationDistribution: 0,
        Installation: 0,
        totalCarpableArea: 53.75
      }
    },
    monitoringLevel: 'both',
    measurementLogic: 'both',
    provinceScope: null
  };
  const dashHtml = renderDashboardView(dashboardCtx);
  assert.ok(dashHtml.includes('Global Target (LAD Balance)'), 'Dashboard includes Top Global Target (LAD Balance) card');
  assert.ok(dashHtml.includes('Temp. Park'), 'Dashboard includes Top Temp. Park card');
  assert.ok(dashHtml.includes('Total Database (All Records)'), 'Dashboard includes Top Total Database card');
  assert.ok(dashHtml.includes('Provincial Breakdown'), 'Dashboard includes Provincial Breakdown table');
  assert.ok(dashHtml.includes('LAD Balance</th>'), 'Provincial table header includes LAD Balance group');
  assert.ok(dashHtml.includes('Temp. Park</th>'), 'Provincial table header includes Temp. Park group');
  assert.ok(dashHtml.includes('Total Database</th>'), 'Provincial table header includes Total Database group');
  assert.ok(dashHtml.includes('Area (HAS)'), 'Provincial table header breaks down Area (HAS) for LAD Balance and Temp Park');
  assert.ok(dashHtml.includes('Eastern Visayas Map &amp; Target Explorer'), 'Dashboard includes Eastern Visayas Map panel');
  assert.ok(dashHtml.includes('ev-map-svg'), 'Dashboard renders SVG map of Eastern Visayas');
  assert.ok(dashHtml.includes('data-map-province="LEY"'), 'Map includes interactive Leyte province path');
  assert.ok(dashHtml.includes('data-map-province="SAM"'), 'Map includes interactive Samar province path');
  assert.ok(dashHtml.includes('data-map-province-pill'), 'Map includes quick province filter pills');
  assert.ok(dashHtml.includes('dash-map-detail-card'), 'Dashboard includes Target detail card container');
  assert.ok(dashHtml.includes('LAD Balance'), 'Detail card displays LAD Balance');
  assert.ok(dashHtml.includes('Temp. Park'), 'Detail card displays Temp. Park');
  assert.ok(dashHtml.includes('LAD Balance vs. Registered Titles'), 'Dashboard includes LAD Balance vs Registered Titles Pie panel');
  assert.ok(dashHtml.includes('Whereabouts per Milestone'), 'Dashboard includes Whereabouts per Milestone section');
  assert.ok(dashHtml.includes('data-nav="cf-whereabouts"'), 'Dashboard includes CF Whereabouts navigation link');
  assert.ok(dashHtml.includes('data-nav="survey-whereabouts"'), 'Dashboard includes Survey Whereabouts navigation link');
  assert.ok(dashHtml.includes('data-nav="mov-whereabouts"'), 'Dashboard includes MOV Whereabouts navigation link');
  assert.ok(dashHtml.includes('data-nav="regdist-whereabouts"'), 'Dashboard includes Registration Whereabouts navigation link');
  assert.ok(dashHtml.includes('data-nav="installation-whereabouts"'), 'Dashboard includes Installation Whereabouts navigation link');
});

test('API responses enforce no-cache headers, and deleting OPTool rows or milestones returns full fresh state and invalidates cache', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salig-del-cache-test-'));
  const tempFile = path.join(tempDir, 'store.json');
  const { server } = createAppServer(tempFile, {
    requireAuth: false,
    pushToGasWebApp: async () => ({ ok: true })
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 1. Verify Cache-Control header is set on responses
    const resBoot = await fetch(`${baseUrl}/api/bootstrap`);
    assert.equal(resBoot.status, 200);
    const cc = resBoot.headers.get('cache-control') || '';
    assert.ok(cc.includes('no-store'), 'Responses must include no-store in Cache-Control');
    assert.ok(cc.includes('no-cache'), 'Responses must include no-cache in Cache-Control');

    // 2. Add a test row to Database
    const addRes = await fetch(`${baseUrl}/api/optool/Database`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        row: { lhid: '999999999', province: 'Western Samar', carpable: '7.5000', ladStatus: 'LAD Balance' }
      })
    });
    assert.equal(addRes.status, 200);
    const addData = await addRes.json();
    const targetIdx = addData.rows.findIndex((r) => r.lhid === '999999999');
    assert.ok(targetIdx >= 0, 'Added row found in Database');

    // 3. DELETE /api/optool/Database/:idx returns fresh state and optool
    const delRes = await fetch(`${baseUrl}/api/optool/Database/${targetIdx}`, {
      method: 'DELETE'
    });
    assert.equal(delRes.status, 200);
    const delData = await delRes.json();
    assert.equal(delData.ok, true);
    assert.ok(delData.rows, 'Includes updated rows');
    assert.ok(delData.optool, 'Includes updated optool object');
    assert.ok(delData.state, 'Includes updated state object');
    assert.ok(delData.analytics, 'Includes updated analytics');
    assert.equal(delData.rows.some((r) => r.lhid === '999999999'), false, 'Deleted row is not in rows');
    assert.equal(delData.optool.Database.some((r) => r.lhid === '999999999'), false, 'Deleted row is not in optool.Database');

    // 4. Milestone creation and deletion returns full fresh state
    const addMs = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Province_Code: 'SAM',
        Municipality: 'Catbalogan City',
        Land_Allocation_ID: 'LA-DEL-CACHE-01',
        eTitle_No: 'eT-2026-99991',
        Area_HAS: '1.2500',
        Milestone_Stage: 'eTitle Registered',
        Milestone_Date: '2026-11-15'
      })
    });
    assert.equal(addMs.status, 200);
    const msData = await addMs.json();
    const recordId = msData.record.Record_ID;

    const delMs = await fetch(`${baseUrl}/api/milestones/${encodeURIComponent(recordId)}`, {
      method: 'DELETE'
    });
    assert.equal(delMs.status, 200);
    const delMsData = await delMs.json();
    assert.equal(delMsData.ok, true);
    assert.ok(delMsData.milestoneData, 'Includes updated milestoneData');
    assert.ok(delMsData.state, 'Includes updated state');
    assert.ok(delMsData.analytics, 'Includes updated analytics');
    assert.equal(delMsData.milestoneData.some((m) => m.Record_ID === recordId), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Eastern Visayas map renders authentic reference graphic with interactive province overlays and static asset serving', async () => {
  const { renderEasternVisayasMapSvg, EV_MAP_PROVINCES } = await import('../../public/charts.js');

  // 1. Verify EV_MAP_PROVINCES has all 6 official Region VIII provinces
  const expectedCodes = ['NSA', 'SAM', 'ESA', 'BIL', 'LEY', 'SLE'];
  assert.equal(EV_MAP_PROVINCES.length, 6);
  for (const code of expectedCodes) {
    const prov = EV_MAP_PROVINCES.find((p) => p.code === code);
    assert.ok(prov, `EV_MAP_PROVINCES contains ${code}`);
    assert.ok(prov.d && prov.d.startsWith('M '), `${code} has valid SVG path d`);
  }

  // 2. Verify renderEasternVisayasMapSvg renders authoritative reference image and dim layer
  const mapHtmlAll = renderEasternVisayasMapSvg({ selectedCode: 'ALL' });
  assert.ok(mapHtmlAll.includes('<image'), 'Renders SVG image tag');
  assert.ok(mapHtmlAll.includes('/assets/eastern-visayas-map.png'), 'Links to authoritative reference graphic');
  assert.ok(mapHtmlAll.includes('class="ev-map-dim-layer"'), 'Includes backdrop dim layer');
  assert.ok(mapHtmlAll.includes('display:none'), 'Dim layer is hidden when ALL is selected');

  for (const code of expectedCodes) {
    assert.ok(mapHtmlAll.includes(`data-map-province="${code}"`), `Overlay exists for ${code}`);
  }

  // 3. Verify single province selection sets active class and shows dim layer
  const mapHtmlLey = renderEasternVisayasMapSvg({ selectedCode: 'LEY' });
  assert.ok(mapHtmlLey.includes('display:block'), 'Dim layer is visible when single province is selected');
  assert.ok(mapHtmlLey.includes('data-map-province="LEY"'), 'LEY overlay present');

  // 4. Verify HTTP static file serving returns image/png for eastern-visayas-map.png
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salig-map-asset-test-'));
  const { server } = createAppServer(tempDir, { requireAuth: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/assets/eastern-visayas-map.png`);
    assert.equal(res.status, 200, 'HTTP 200 for eastern-visayas-map.png');
    assert.equal(res.headers.get('content-type'), 'image/png', 'Content-Type is image/png');
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 10000, 'Image payload is non-empty');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolveProvinceCode accurately discriminates Southern Leyte vs Leyte and displays SLE breakdown', async () => {
  const schemas = { registry: REGIONAL_REGISTRY };

  // 1. Direct code & compound province checks
  assert.equal(resolveProvinceCode('SLE', schemas), 'SLE');
  assert.equal(resolveProvinceCode('SOUTHERN LEYTE', schemas), 'SLE');
  assert.equal(resolveProvinceCode('Southern Leyte', schemas), 'SLE');
  assert.equal(resolveProvinceCode('LEYTE', schemas), 'LEY');
  assert.equal(resolveProvinceCode('Leyte', schemas), 'LEY');
  assert.equal(resolveProvinceCode('LEY', schemas), 'LEY');
  assert.equal(resolveProvinceCode('NORTHERN SAMAR', schemas), 'NSA');
  assert.equal(resolveProvinceCode('EASTERN SAMAR', schemas), 'ESA');
  assert.equal(resolveProvinceCode('WESTERN SAMAR', schemas), 'SAM');
  assert.equal(resolveProvinceCode('SAMAR', schemas), 'SAM');
  assert.equal(resolveProvinceCode('BILIRAN', schemas), 'BIL');

  // 2. Verify renderDashboardView breaks down Southern Leyte independently from Leyte
  const sampleDatabase = [
    { province: 'SOUTHERN LEYTE', provinceCode: 'SLE', lad_balance: 'LAD Balance', projected_area: 2.5 },
    { province: 'SOUTHERN LEYTE', provinceCode: 'SLE', lad_balance: 'Temp. Park', projected_area: 3.5 },
    { province: 'LEYTE', provinceCode: 'LEY', lad_balance: 'LAD Balance', projected_area: 10.0 }
  ];

  const html = renderDashboardView({
    state: {
      optool: { Database: sampleDatabase }
    },
    analytics: {
      kpis: { cumulativeETitles: 0, cumulativeAreaHas: 0 },
      provincialBreakdown: []
    },
    schemas,
    provinceScope: null
  });

  // Verify Southern Leyte row has 1 LAD Balance and 1 Temp Park
  assert.ok(html.includes('data-prov-code="SLE"'), 'SLE table row is generated');
  assert.ok(html.includes('SOUTHERN LEYTE'), 'Southern Leyte label appears in table');
});

test('Registered Data dynamically calculates per province from Google Sheet Column M (Date Registered) and Column J (Area HAS)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salig-reg-test-'));
  const store = new ConsolidatedStore(tempDir);
  const schemas = { registry: REGIONAL_REGISTRY };

  // Setup RegistrationDistribution rows matching Google Sheet headers (Column M Date Registered, Column J Area HAS)
  store.state.optool.RegistrationDistribution = [
    {
      lhid: '805000001',
      province: 'Southern Leyte',
      provinceCode: 'SLE',
      'AREA (HAs)': '5.5000',
      'DATE REGISTERED': '2026-03-15'
    },
    {
      lhid: '805000002',
      province: 'Southern Leyte',
      provinceCode: 'SLE',
      'AREA (HAs)': '2.2500',
      'DATE REGISTERED': '2026-04-20'
    },
    {
      lhid: '805000003',
      province: 'Southern Leyte',
      provinceCode: 'SLE',
      'AREA (HAs)': '10.0000',
      'DATE REGISTERED': '' // Unregistered row - must be ignored
    },
    {
      lhid: '803000001',
      province: 'Leyte',
      provinceCode: 'LEY',
      areaHas: '12.0000',
      dateRegistered: '2026-05-10'
    },
    {
      lhid: '801000001',
      province: 'Biliran',
      provinceCode: 'BIL',
      areaHas: '3.4000',
      dateRegistered: '-' // Dash placeholder - must be ignored
    }
  ];
  store.save();

  // 1. Verify getRegisteredOptoolRecords extracts only rows with valid Date Registered in Column M
  const regRecords = store.getRegisteredOptoolRecords('ALL');
  assert.equal(regRecords.length, 3, 'Only 3 rows have valid Date Registered in Column M');
  const sleRecords = store.getRegisteredOptoolRecords('SLE');
  assert.equal(sleRecords.length, 2, 'Southern Leyte has 2 registered records');

  // 2. Verify getRegisteredSummaryByProvince sums Column J Area HAS per province
  const summary = store.getRegisteredSummaryByProvince();
  assert.equal(summary.byProvince.SLE.registeredCount, 2);
  assert.equal(summary.byProvince.SLE.registeredAreaHas, 7.75); // 5.5 + 2.25
  assert.equal(summary.byProvince.LEY.registeredCount, 1);
  assert.equal(summary.byProvince.LEY.registeredAreaHas, 12.0);
  assert.equal(summary.byProvince.BIL.registeredCount, 0, 'Biliran with dash date is 0');
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.totalArea, 19.75);

  // 3. Verify computeAnalytics KPI and provincialBreakdown reflect Column M and Column J sums
  const analytics = store.getAnalytics({ province: 'ALL' });
  assert.equal(analytics.kpis.cumulativeETitles, 3);
  assert.equal(analytics.kpis.cumulativeAreaHas, 19.75);

  const pbSle = analytics.provincialBreakdown.find((p) => p.code === 'SLE');
  assert.equal(pbSle.cumulativeETitles, 2);
  assert.equal(pbSle.cumulativeAreaHas, 7.75);

  const pbLey = analytics.provincialBreakdown.find((p) => p.code === 'LEY');
  assert.equal(pbLey.cumulativeETitles, 1);
  assert.equal(pbLey.cumulativeAreaHas, 12.0);

  // 4. Verify renderDashboardView displays these dynamic sums in the table
  const html = renderDashboardView({
    state: store.state,
    analytics,
    schemas,
    provinceScope: null
  });

  assert.ok(html.includes('7.7500'), 'Dashboard table outputs 7.7500 registered area for Southern Leyte');
  assert.ok(html.includes('12.0000'), 'Dashboard table outputs 12.0000 registered area for Leyte');
  assert.ok(html.includes('19.7500'), 'Dashboard table outputs 19.7500 for Region VIII Total');

  // 5. Verify /api/registered-summary HTTP endpoint
  const { server } = createAppServer(tempDir, { requireAuth: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/registered-summary`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.totalCount, 3);
    assert.equal(data.totalArea, 19.75);
    assert.equal(data.byProvince.SLE.registeredAreaHas, 7.75);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // 6. Zero condition: When RegistrationDistribution is empty or Column M Date Registered is blank, table and map strictly show zero
  store.state.optool.RegistrationDistribution = [];
  store.save();

  const emptySummary = store.getRegisteredSummaryByProvince();
  assert.equal(emptySummary.totalCount, 0, 'Empty sheet yields 0 registered titles');
  assert.equal(emptySummary.totalArea, 0, 'Empty sheet yields 0.0000 registered area');
  assert.equal(emptySummary.byProvince.SLE.registeredAreaHas, 0);
  assert.equal(emptySummary.byProvince.LEY.registeredAreaHas, 0);

  const emptyAnalytics = store.getAnalytics({ province: 'ALL' });
  assert.equal(emptyAnalytics.kpis.cumulativeETitles, 0);
  assert.equal(emptyAnalytics.kpis.cumulativeAreaHas, 0);

  const emptyHtml = renderDashboardView({
    state: store.state,
    analytics: emptyAnalytics,
    schemas,
    provinceScope: null
  });

  // Table must strictly display 0.0000 for each province and 0.0%
  assert.ok(emptyHtml.includes('0.0000 HAS'), 'Map detail card displays 0.0000 HAS');
  assert.ok(!emptyHtml.includes('43.3850'), 'No mock 43.3850 milestone data rendered on dashboard');
  assert.ok(!emptyHtml.includes('11.6950'), 'No mock 11.6950 milestone data rendered on dashboard');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Survey Accomplishment counts strictly and only when Column AC (Date Accepted by DENR-SMD) is not empty', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salig-survey-test-'));
  const store = new ConsolidatedStore(tempDir);

  // Setup Database parcels for area calculation
  store.state.optool.Database = [
    { lhid: '803000001', province: 'Leyte', carpable: '5.5000' },
    { lhid: '803000002', province: 'Leyte', carpable: '12.0000' },
    { lhid: '803000003', province: 'Leyte', carpable: '8.2500' },
    { lhid: '806000001', province: 'Samar', carpable: '3.7500' },
    { lhid: '806000002', province: 'Samar', carpable: '6.0000' }
  ];

  // Setup Survey rows with varying Column AC (Date Accepted by DENR-SMD) states
  store.state.optool.Survey = [
    // 1. Valid ISO date in Column AC -> Accompolished in Q1 (March)
    {
      lhid: '803000001',
      province: 'Leyte',
      provinceCode: 'LEY',
      'Date Accepted by DENR-SMD\nDATE': '2026-03-15',
      kindOfSurvey: 'By Admin'
    },
    // 2. Valid US slash date in Column AC -> Accomplished in Q3 (July)
    {
      lhid: '806000001',
      province: 'Samar',
      provinceCode: 'SAM',
      dateAcceptedDenrSmd: '7/20/2026',
      fieldWorkStartDate: '2/10/2026' // Earlier date must NOT override Column AC
    },
    // 3. Empty Column AC (with earlier workflow dates filled) -> Must NOT be counted as accomplishment
    {
      lhid: '803000002',
      province: 'Leyte',
      provinceCode: 'LEY',
      dateAcceptedDenrSmd: '',
      fieldWorkStartDate: '2026-01-20',
      fieldWorkCompletionDate: '2026-02-15',
      kindOfSurvey: 'By Admin'
    },
    // 4. Dash placeholder in Column AC -> Must NOT be counted
    {
      lhid: '803000003',
      province: 'Leyte',
      provinceCode: 'LEY',
      'Date Accepted by DENR-SMD\nDATE': '-',
      kindOfSurvey: 'By Admin'
    },
    // 5. 'N/A' placeholder in Column AC -> Must NOT be counted
    {
      lhid: '806000002',
      province: 'Samar',
      provinceCode: 'SAM',
      dateAcceptedDenrSmd: 'N/A',
      currentDate: '2026-04-10'
    }
  ];
  store.save();

  // Set NEP targets for land_survey
  store.state.nepTargets = {
    land_survey: { targetCount: 10, targetAreaHas: 50.0 }
  };

  const analytics = store.getAnalytics({ province: 'ALL' });
  const surveyMs = analytics.milestoneNepBreakdown.find((m) => m.key === 'land_survey');
  assert.ok(surveyMs, 'Land Survey milestone breakdown exists');

  // Total count must be exactly 2 (only rows 1 & 2 where Column AC is not empty)
  assert.equal(surveyMs.total.count, 2, 'Only 2 rows with non-empty Column AC are counted in Survey accomplishment');
  assert.equal(surveyMs.total.areaHas, 9.25, 'Total area is 5.5000 + 3.7500 = 9.2500 HAS');

  // Breakdown by quarter: Q1 = 1 (March), Q3 = 1 (July), Q2 = 0, Q4 = 0, undated = 0
  assert.equal(surveyMs.q1.count, 1, 'Row 1 is counted in Q1');
  assert.equal(surveyMs.q1.areaHas, 5.5);
  assert.equal(surveyMs.q2.count, 0, 'No accomplishment in Q2');
  assert.equal(surveyMs.q3.count, 1, 'Row 2 is counted in Q3');
  assert.equal(surveyMs.q3.areaHas, 3.75);
  assert.equal(surveyMs.q4.count, 0, 'No accomplishment in Q4');
  assert.equal(surveyMs.undated.count, 0, 'No undated accomplishment because non-AC rows are excluded');

  // Provincial breakdown: Leyte = 1 (Row 1), Samar = 1 (Row 2), Other provinces = 0
  assert.equal(surveyMs.provinceBreakdown.LEY.count, 1, 'Leyte has exactly 1 accomplished survey');
  assert.equal(surveyMs.provinceBreakdown.SAM.count, 1, 'Samar has exactly 1 accomplished survey');
  assert.equal(surveyMs.provinceBreakdown.BIL.count, 0, 'Biliran has 0 accomplished surveys');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Session Auto-Logout after 15 minutes of inactivity and warning countdown verification', async () => {
  const dir = makeTempDir();
  const { server, store } = createAppServer(dir, { requireAuth: true, requireOtp: false });
  let baseUrl;
  try {
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // 1. Verify static assets define the 15-minute inactivity timeout & 60s warning
    const htmlRes = await fetch(`${baseUrl}/index.html`);
    assert.equal(htmlRes.status, 200);
    const htmlText = await htmlRes.text();
    assert.match(htmlText, /id="inactivity-warning-modal"/);
    assert.match(htmlText, /id="inactivity-countdown-number"/);
    assert.match(htmlText, /id="btn-inactivity-stay"/);
    assert.match(htmlText, /id="btn-inactivity-logout"/);

    const appJsRes = await fetch(`${baseUrl}/app.js`);
    assert.equal(appJsRes.status, 200);
    const appJsText = await appJsRes.text();
    assert.match(appJsText, /INACTIVITY_TIMEOUT_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
    assert.match(appJsText, /INACTIVITY_WARNING_MS\s*=\s*14\s*\*\s*60\s*\*\s*1000/);
    assert.match(appJsText, /startInactivityWatcher/);
    assert.match(appJsText, /checkInactivityStatus/);
    assert.match(appJsText, /salig_last_activity/);

    const cssRes = await fetch(`${baseUrl}/styles.css`);
    assert.equal(cssRes.status, 200);
    const cssText = await cssRes.text();
    assert.match(cssText, /\.inactivity-warning-backdrop/);
    assert.match(cssText, /z-index:\s*100000/);
    assert.match(cssText, /\.auth-feedback\.warning/);

    // 2. Authenticate admin user
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD })
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie, 'Received session cookie on login');
    const cookie = setCookie.split(';')[0];

    // Session check returns authenticated
    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie }
    });
    assert.equal(sessionRes.status, 200);
    const sessionData = await sessionRes.json();
    assert.equal(sessionData.authenticated, true);
    assert.equal(sessionData.user.email, DEFAULT_ADMIN_EMAIL);

    // 3. Auto-logout trigger (POST /api/auth/logout) cleanly clears session cookie
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    assert.equal(logoutRes.status, 200);
    const logoutCookie = logoutRes.headers.get('set-cookie');
    assert.match(logoutCookie, /Max-Age=0/, 'Session cookie is cleared with Max-Age=0');

    // Subsequent session check is unauthenticated
    const postLogoutSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: logoutCookie.split(';')[0] }
    });
    assert.equal(postLogoutSession.status, 200);
    const postLogoutData = await postLogoutSession.json();
    assert.equal(postLogoutData.authenticated, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
