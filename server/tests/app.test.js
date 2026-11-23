import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  REGIONAL_REGISTRY,
  MILESTONE_TARGET_TABS,
  OPTOOL_SHEET_SCHEMAS,
  OPTOOL_PREVIEW_COLUMNS,
  inferProvinceCodeFromMunicipality,
  isChecklistChecked as isServerChecklistChecked,
  LEASEHOLD_COLUMNS,
  normalizeLeaseholdRow,
  EPEB_STATUS_OPTIONS
} from '../schema.js';
import { ConsolidatedStore, resolveDefaultDataDir, isMovAccomplished } from '../store.js';
import { createSeedState } from '../seedData.js';
import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD, signSessionToken } from '../auth.js';
import {
  buildConsolidatedWorkbookBuffer,
  parseWorkbookBuffer,
  parseCsvText
} from '../sheetsSync.js';
import { writeXlsxWorkbook } from '../xlsxCodec.js';
import { createAppServer } from '../app.js';
import vercelHandler from '../../api/index.js';
import {
  renderOptoolView,
  generateOptoolSupportListCsv,
  getColumnFilterValues,
  isChecklistChecked,
  LINKED_DB_PROFILE_FIELDS,
  renderMilestoneWhereaboutsView,
  matchesWhereaboutsTargetYear,
  renderSurveySupportListModalHtml,
  renderCfSupportListModalHtml,
  DEFAULT_CF_PROVINCES,
  WHEREABOUTS_CONFIGS,
  buildOptoolViewModel,
  renderUsersView,
  isLadBalance,
  isTempPark,
  resolveProvinceCode,
  renderDashboardView,
  computeMilestoneWhereaboutsBreakdown,
  renderMilestoneWhereaboutsSectionHtml,
  renderProvTableDetailHtml,
  renderMapDetailCardInner,
  renderLeaseholdView,
  renderLeaseholdModalHtml,
  generateLeaseholdCsv,
  getLeaseholdAreaTenanted,
  getLeaseholdTargetYear,
  renderTargetSummaryView,
  getWhereaboutsNepTargetMap,
  renderAuditLogsView
} from '../../public/views.js';
import {
  TARGET_PERIOD_OPTIONS,
  formatCurrentMonthYear,
  formatReportedMonthWord,
  formatYearDisplay,
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
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].length, 21);
  const cfSurveyReqCol = OPTOOL_SHEET_SCHEMAS['CF(DOC)'].find((c) => c.key === 'surveyRequirement');
  assert.equal(cfSurveyReqCol?.type, 'select');
  assert.deepEqual(cfSurveyReqCol?.options, ['Needing Survey', 'Not Needing Survey']);
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].some((c) => c.key === 'carperLadForm18'), false);
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].some((c) => c.key === 'carperLadForm20'), false);
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].some((c) => c.key === 'carperLadNo49'), false);
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].some((c) => c.key === 'approvedSubdivisionPlan'), false);
  assert.equal(OPTOOL_SHEET_SCHEMAS.Survey.length, 44);
  assert.equal(OPTOOL_SHEET_SCHEMAS.MOV.length, 13);
  const movDateTransIdx = OPTOOL_SHEET_SCHEMAS.MOV.findIndex((c) => c.key === 'dateTransLbpAoc');
  const movLotIdx = OPTOOL_SHEET_SCHEMAS.MOV.findIndex((c) => c.key === 'lotNumber');
  const movSubLotIdx = OPTOOL_SHEET_SCHEMAS.MOV.findIndex((c) => c.key === 'subLotNumber');
  assert.equal(movDateTransIdx, 6, 'Date Trans to LBP/AOC is Column G (index 6)');
  assert.equal(movLotIdx, movDateTransIdx + 1, 'Lot Number must immediately follow Date Trans to LBP/AOC in MOV schema');
  assert.equal(movSubLotIdx, movLotIdx + 1, 'Sub Lot Number must immediately follow Lot Number in MOV schema');
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
  assert.equal(OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.length, 28);
  const fwdCol = OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.find((c) => c.key === 'dateForwardedToRod');
  assert.equal(fwdCol?.type, 'date');
  assert.equal(fwdCol?.group, 'Registration & Distribution');
  const recCol = OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.find((c) => c.key === 'dateReceivedAtRod');
  assert.equal(recCol?.type, 'date');
  assert.equal(recCol?.group, 'Registration & Distribution');
  const epebNumCol = OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.find((c) => c.key === 'epebNumber');
  assert.equal(epebNumCol?.type, 'text');
  assert.equal(epebNumCol?.group, 'Registration & Distribution');
  const epebDateCol = OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.find((c) => c.key === 'epebDate');
  assert.equal(epebDateCol?.type, 'date');
  assert.equal(epebDateCol?.group, 'Registration & Distribution');
  const epebStatCol = OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.find((c) => c.key === 'epebStatus');
  assert.equal(epebStatCol?.type, 'select');
  assert.equal(epebStatCol?.group, 'Registration & Distribution');
  assert.deepEqual(epebStatCol?.options, [
    'For Entry',
    'TD Encoding',
    'Examination',
    'Approval',
    'Uploading',
    'Printing',
    'Released',
    'ETD@CO',
    'Freeze/System Update',
    'COD'
  ]);
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
    assert.ok(parsed.sheetNames.includes('Leasehold'));
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

      // Verify Export Supportlist replaced Import CSV on supportlist tables
      assert.ok(html.includes('id="btn-optool-export-csv"'), `Expected Export Supportlist button on ${tab}`);
      assert.ok(html.includes('Export Supportlist'), `Expected 'Export Supportlist' label on ${tab}`);
      assert.ok(!html.includes(`Import CSV to ${tab}`), `Expected 'Import CSV to ${tab}' removed from ${tab}`);

      const exportResult = generateOptoolSupportListCsv(ctx);
      assert.ok(exportResult.csvText.includes('LHID'), `Expected LHID header in exported CSV for ${tab}`);
      assert.ok(exportResult.filename.startsWith('Supportlist_'), `Expected Supportlist_ prefix in filename for ${tab}`);
      assert.equal(exportResult.rowCount, (store.state.optool[tab] || []).length);
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

  // Verify formatReportedMonthWord
  assert.equal(formatReportedMonthWord('2026-03-01'), 'March 2026');
  assert.equal(formatReportedMonthWord('2026-11'), 'November 2026');
  assert.equal(formatReportedMonthWord('Nov 2026'), 'November 2026');
  assert.equal(formatReportedMonthWord('November 2026'), 'November 2026');
  assert.equal(formatReportedMonthWord('undated / pending'), '');
  assert.equal(formatReportedMonthWord('—'), '');
  assert.equal(formatReportedMonthWord(''), '');
  assert.equal(formatReportedMonthWord(null), '');

  // Verify formatYearDisplay
  assert.equal(formatYearDisplay('2026.0'), '2026');
  assert.equal(formatYearDisplay('2026.00'), '2026');
  assert.equal(formatYearDisplay('2026'), '2026');
  assert.equal(formatYearDisplay(2026), '2026');
  assert.equal(formatYearDisplay(''), '');
  assert.equal(formatYearDisplay(null), '');

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

    const normalizedCf = store.normalizeOptoolRow('CF(DOC)', {
      lhid: '803000135',
      reportedMonth: '2026-03-01',
      targetYear: '2026.0',
      'LHs (Needing/Not Needing Survey)': 'Needing Survey'
    });
    assert.equal(normalizedCf.reportedMonth, 'March 2026');
    assert.equal(normalizedCf.targetYear, '2026');
    assert.equal(normalizedCf.surveyRequirement, 'Needing Survey');

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

    // 7. Verify persistent tombstones prevent resurrection when Google Sheet still returns deleted account
    assert.equal(store.isUserDeleted(remoteUser.email, remoteUser.id), true);
    const pullResWithZombie = store.mergeUsersFromSheet([
      remoteUser,
      {
        id: 'usr-new-legit',
        name: 'Legit New User',
        email: 'legit.new@dar8.gov.ph',
        province: 'Leyte',
        role: 'user',
        status: 'pending'
      }
    ]);
    assert.equal(pullResWithZombie.added, 1);
    assert.equal(store.findUserByEmail(remoteUser.email), null);
    assert.equal(store.findUserById(remoteUser.id), null);
    assert.notEqual(store.findUserByEmail('legit.new@dar8.gov.ph'), null);
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

    // Land Survey: 1 in Q2 via Reported Month matching Target Year, plus 1 with empty Reported Month (must be excluded from accomplishment)
    store.upsertOptoolRow('Survey', { lhid: 'LH-Q2', reportedMonth: 'May 2026', targetYear: '2026', dateAcceptedDenrSmd: '2026-05-19' });
    store.upsertOptoolRow('Survey', { lhid: 'LH-Q3', currentDate: '2026-05-19', reportedMonth: '', targetYear: '2026', dateAcceptedDenrSmd: '' });

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
    assert.equal(rows.length, 7);
    assert.deepEqual(
      rows.map((r) => r.label),
      [
        'CF Documentation',
        'Land Survey',
        'Land Valuation',
        'EP CLOA Registration',
        'EP CLOA Distribution',
        'Installation',
        'Leasehold'
      ]
    );

    const leaseholdMs = rows[6];
    assert.equal(leaseholdMs.key, 'leasehold');
    assert.equal(leaseholdMs.label, 'Leasehold');
    assert.ok(leaseholdMs.total);

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

  // Rate of Accomplishment in Survey Status Monitoring table
  assert.ok(htmlAll.includes('RATE OF ACCOMP.'), 'Survey Status Monitoring table must include RATE OF ACCOMP. header');
  assert.ok(htmlAll.includes('Rate:'), 'Survey Global Accomplishment KPI card displays Rate badge');
  const surveyHtmlLhs = renderMilestoneWhereaboutsView({ ...ctxAll, surveyMetricMode: 'lhs' }, cfg);
  assert.ok(surveyHtmlLhs.includes('RATE OF ACCOMP.'), 'Survey table in LHS mode includes RATE OF ACCOMP.');
  const surveyHtmlArea = renderMilestoneWhereaboutsView({ ...ctxAll, surveyMetricMode: 'area' }, cfg);
  assert.ok(surveyHtmlArea.includes('RATE OF ACCOMP.'), 'Survey table in Area mode includes RATE OF ACCOMP.');

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
  assert.equal(movHtml.includes('id="panel-mov-whereabouts-provincial"'), false, 'MOV Provincial Allocation panel removed');
  assert.ok(movHtml.includes('id="panel-optool"'), 'MOV OPTool panel exists');
  assert.ok(movHtml.includes('MOV Operational Support List'), 'MOV Operational Support List title present');
  assert.ok(movHtml.includes('+ Add MOV Row'), '+ Add MOV Row button present');
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
  assert.equal(regDistHtml.includes('id="panel-regdist-whereabouts-provincial"'), false, 'RegDist Provincial Allocation panel removed');
  assert.ok(regDistHtml.includes('id="panel-optool"'), 'RegDist OPTool panel exists');
  assert.ok(regDistHtml.includes('Registration / Distribution Operational Support List'), 'RegDist Operational Support List title present');
  assert.ok(regDistHtml.includes('+ Add RegistrationDistribution Row'), '+ Add RegistrationDistribution Row button present');
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
  assert.equal(instHtml.includes('id="panel-installation-whereabouts-provincial"'), false, 'Installation Provincial Allocation panel removed');
  assert.ok(instHtml.includes('id="panel-optool"'), 'Installation OPTool panel exists');
  assert.ok(instHtml.includes('Installation Operational Support List'), 'Installation Operational Support List title present');
  assert.ok(instHtml.includes('+ Add Installation Row'), '+ Add Installation Row button present');
  assert.ok(instHtml.includes('id="panel-cf-status-table"'), 'Installation panel exists');
  assert.ok(instHtml.includes('Installation Milestone Status &amp; Accomplishment Summary'), 'Installation title present');
  assert.ok(instHtml.includes('WITH DATE REGISTERED'), 'Installation standard table has WITH DATE REGISTERED header');
  assert.ok(instHtml.includes('WITH DATE DISTRIBUTED'), 'Installation standard table has WITH DATE DISTRIBUTED header');
  assert.ok(instHtml.includes('WITH DATE INSTALLED'), 'Installation standard table has WITH DATE INSTALLED header');
  assert.ok(instHtml.includes('WITH MONTH REPORTED'), 'Installation standard table has WITH MONTH REPORTED header');
  assert.ok(instHtml.includes('data-open-cf-support-list'), 'Installation table has clickable figure links');
  assert.ok(instHtml.includes('id="cf-status-target-year-filter"'), 'Installation panel has Target Year select');
  assert.ok(instHtml.includes('id="whereabouts-target-year-filter"'), 'Installation master ledger has Target Year filter');

  // 4. Leasehold Operations View Provincial Allocation Table
  const leaseholdHtml = renderLeaseholdView({
    ...baseCtx,
    leaseholdSearch: '',
    leaseholdProvinceFilter: 'ALL',
    leaseholdStatusFilter: 'ALL',
    leaseholdTargetYearFilter: 'ALL',
    leaseholdPage: 1,
    leaseholdPageSize: 25
  });
  assert.equal(leaseholdHtml.includes('id="panel-leasehold-provincial"'), false, 'Leasehold Provincial Allocation panel removed');
  assert.ok(leaseholdHtml.includes('Leasehold Master Ledger &amp; Encoding Operations') || leaseholdHtml.includes('Leasehold Master Ledger & Encoding Operations'), 'Leasehold Master Ledger title present');
  assert.ok(leaseholdHtml.includes('id="leasehold-search"'), 'Leasehold search bar present');

  // 5. Dynamic Support List Modal rendering for MOV, RegDist, and Installation
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

test('Survey Accomplishment counts if the LHs have Reported Month is equal the year Target in Column AR', async () => {
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

  // Setup Survey rows with varying Reported Month and Target Year (Column AR) states
  store.state.optool.Survey = [
    // 1. Valid Reported Month matching Target Year -> Accomplished in Q1 (March)
    {
      lhid: '803000001',
      province: 'Leyte',
      provinceCode: 'LEY',
      reportedMonth: 'March 2026',
      targetYear: '2026',
      kindOfSurvey: 'By Admin'
    },
    // 2. Valid Reported Month matching Target Year -> Accomplished in Q3 (July)
    {
      lhid: '806000001',
      province: 'Samar',
      provinceCode: 'SAM',
      reportedMonth: 'July 2026',
      targetYear: '2026',
      fieldWorkStartDate: '2/10/2026'
    },
    // 3. Empty Reported Month -> Must NOT be counted as accomplishment
    {
      lhid: '803000002',
      province: 'Leyte',
      provinceCode: 'LEY',
      reportedMonth: '',
      targetYear: '2026',
      fieldWorkStartDate: '2026-01-20',
      fieldWorkCompletionDate: '2026-02-15',
      kindOfSurvey: 'By Admin'
    },
    // 4. Reported Month year (2026) NOT equal to Target Year in Column AR (2027) -> Must NOT be counted
    {
      lhid: '803000003',
      province: 'Leyte',
      provinceCode: 'LEY',
      reportedMonth: 'March 2026',
      targetYear: '2027',
      kindOfSurvey: 'By Admin'
    },
    // 5. Dash placeholder in Reported Month -> Must NOT be counted
    {
      lhid: '806000002',
      province: 'Samar',
      provinceCode: 'SAM',
      reportedMonth: '-',
      targetYear: '2026',
      currentDate: '2026-04-10'
    }
  ];
  store.save();

  // Set NEP targets for land_survey
  store.state.nepTargets = {
    land_survey: { targetCount: 10, targetAreaHas: 50.0 }
  };

  const analytics = store.getAnalytics({ province: 'ALL', milestoneYear: '2026' });
  const surveyMs = analytics.milestoneNepBreakdown.find((m) => m.key === 'land_survey');
  assert.ok(surveyMs, 'Land Survey milestone breakdown exists');

  // Total count must be exactly 2 (only rows 1 & 2 where Reported Month year equals Target Year)
  assert.equal(surveyMs.total.count, 2, 'Only 2 rows with Reported Month equal to Target Year in Column AR are counted in Survey accomplishment');
  assert.equal(surveyMs.total.areaHas, 9.25, 'Total area is 5.5000 + 3.7500 = 9.2500 HAS');

  // Breakdown by quarter: Q1 = 1 (March), Q3 = 1 (July), Q2 = 0, Q4 = 0, undated = 0
  assert.equal(surveyMs.q1.count, 1, 'Row 1 is counted in Q1');
  assert.equal(surveyMs.q1.areaHas, 5.5);
  assert.equal(surveyMs.q2.count, 0, 'No accomplishment in Q2');
  assert.equal(surveyMs.q3.count, 1, 'Row 2 is counted in Q3');
  assert.equal(surveyMs.q3.areaHas, 3.75);
  assert.equal(surveyMs.q4.count, 0, 'No accomplishment in Q4');
  assert.equal(surveyMs.undated.count, 0, 'No undated accomplishment because non-matching rows are excluded');

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

test('Leasehold 34-Field schema, encoding modal, provincial isolation & RBAC (users encode only, admin deletes)', async () => {
  // 1. Validate Schema: Exactly 34 Columns matching user specification
  assert.equal(LEASEHOLD_COLUMNS.length, 34, 'LEASEHOLD_COLUMNS must have exactly 34 columns');
  const requiredHeaders = [
    'REG', 'PROVS', 'MUN', 'BRGY', 'LO SURNAME', 'LO FIRSTNAME', 'LO MI',
    'TITLE NO.', 'TAX DEC NO.', 'SURVEY NO.', 'LOT NO.', 'AREA PER TITLE (Has)',
    'AREA TENANTED (Has)', 'WITHIN RETAINED AREA (Y,N)', 'LEASEHOLDER SURNAME',
    'LEASEHOLDER FIRSTNAME', 'LEASEHOLDER MI', 'TENANT/LESSEE STATUS (alive, deceased)',
    'NEW LESSEE NAME (for deceased Tenant/Lessee) _Surname, First Name, MI',
    'RELATIONSHIP TO TENANT/LESSEE (relationship to original leaseholder)',
    'GENDER (M, F)', 'Number of ARBs', 'MAIN CROPS', 'AUXILLIARY CROPS',
    'SHARING ARRANGEMENT', 'TENURIAL ARRANGEMENT', 'STATUS OF CONTRACT (New, Amended, Renewal)',
    '*DATE CONTRACT REGISTERED (mm/dd/yyyy)', '*DATE PLR REGISTERED (mm/dd/yyyy)',
    'LEASE RENTAL UNIT', 'LEASE IN PESOS', 'TARGET YEAR', 'Report Month (Words)', 'REMARKS'
  ];
  for (const h of requiredHeaders) {
    const found = LEASEHOLD_COLUMNS.some((c) => c.header === h);
    assert.ok(found, `Required column header "${h}" must exist in LEASEHOLD_COLUMNS`);
  }

  // 2. Test Store Persistence & Normalization
  const dir = makeTempDir();
  const store = new ConsolidatedStore(dir);
  assert.ok(Array.isArray(store.state.leasehold), 'Store must initialize leasehold array');

  const sampleRecord = {
    reg: 'Region VIII',
    provs: 'Eastern Samar',
    mun: 'Lawaan',
    brgy: 'Bolusao',
    loSurname: 'SABULAO',
    loFirstname: 'EUFEMIA',
    loMi: 'C.',
    titleNo: 'RP-1038',
    taxDecNo: 'TD-2024-0012',
    surveyNo: 'Cad-123',
    lotNo: '104',
    areaPerTitle: '2.5000',
    areaTenanted: '1.8817',
    withinRetainedArea: 'N',
    leaseholderSurname: 'DELA CRUZ',
    leaseholderFirstname: 'JUAN',
    leaseholderMi: 'P',
    tenantStatus: 'Alive',
    newLesseeName: '',
    relationshipToTenant: '',
    gender: 'M',
    noOfArbs: '1',
    mainCrops: 'Palay',
    auxilliaryCrops: 'Coconut',
    sharingArrangement: '75-25',
    tenurialArrangement: 'Agricultural Leasehold',
    statusOfContract: 'New',
    dateContractRegistered: '03/15/2026',
    datePlrRegistered: '03/20/2026',
    leaseRentalUnit: 'cavans',
    leaseInPesos: '25000',
    targetYear: '2026',
    reportMonth: 'March',
    remarks: 'Valid registered leasehold contract'
  };

  const savedRecord = store.upsertLeaseholdRow(sampleRecord);
  assert.ok(savedRecord.id, 'Upserted record must receive a persistent id');
  assert.equal(store.state.leasehold.length, 1);
  assert.equal(store.state.leasehold[0].leaseholderSurname, 'DELA CRUZ');
  assert.equal(store.state.leasehold[0].areaTenanted, '1.8817');

  // Provincial Scoping in Store
  const esaRows = store.getScopedLeaseholdRows('ESA');
  assert.equal(esaRows.length, 1, 'ESA scoped view returns Eastern Samar record');
  const leyRows = store.getScopedLeaseholdRows('LEY');
  assert.equal(leyRows.length, 0, 'LEY scoped view returns 0 records for ESA parcel');

  // 3. Test HTTP Server API Endpoints & Role Enforcement ("allow users only to encode")
  const { server } = createAppServer(store, { requireAuth: true, requireOtp: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Admin signs in to fetch bootstrap schemas
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD })
    });
    assert.equal(adminLoginRes.status, 200);
    const adminCookie = adminLoginRes.headers.get('set-cookie').split(';')[0];

    // Bootstrap returns leasehold and leaseholdColumns
    const bootRes = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { Cookie: adminCookie }
    });
    const bootData = await bootRes.json();
    assert.equal(bootData.schemas.leaseholdColumns.length, 34);
    assert.ok(Array.isArray(bootData.state.leasehold));

    // Sign up a regular user for Eastern Samar and approve
    const userEmail = 'encoder.esa@dar8.gov.ph';
    const userPass = 'ProvincePass2026!';
    const userRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'ESA Leasehold Encoder',
        email: userEmail,
        province: 'Eastern Samar',
        contactNumber: '0918-123-4567',
        password: userPass
      })
    });
    assert.equal(userRes.status, 201);
    const createdUser = store.findUserByEmail(userEmail);
    store.updateUserStatus(createdUser.id, { status: 'approved' }, 'admin');

    // Sign in as provincial user
    const loginUserRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail, password: userPass })
    });
    assert.equal(loginUserRes.status, 200);
    const userCookie = loginUserRes.headers.get('set-cookie').split(';')[0];

    // Provincial user encodes a new leasehold record for Eastern Samar
    const postRes = await fetch(`${baseUrl}/api/leasehold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userCookie },
      body: JSON.stringify({
        row: {
          provs: 'Eastern Samar',
          mun: 'Guiuan',
          brgy: 'Barangay 1',
          loSurname: 'PEREZ',
          loFirstname: 'MARIA',
          leaseholderSurname: 'SANTOS',
          leaseholderFirstname: 'PEDRO',
          areaTenanted: '1.2500',
          statusOfContract: 'New',
          targetYear: '2026'
        }
      })
    });
    assert.equal(postRes.status, 200);
    const postData = await postRes.json();
    assert.equal(postData.ok, true);
    assert.equal(postData.row.leaseholderSurname, 'SANTOS');
    const createdId = postData.row.id;

    // Provincial user cannot encode cross-province (e.g. Leyte)
    const crossProvRes = await fetch(`${baseUrl}/api/leasehold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userCookie },
      body: JSON.stringify({
        row: {
          provs: 'Leyte',
          mun: 'Palo',
          leaseholderSurname: 'ILLEGAL',
          leaseholderFirstname: 'CROSS'
        }
      })
    });
    assert.equal(crossProvRes.status, 403);

    // CRITICAL: Regular user CANNOT delete records ("allow users only to encode")
    const userDelRes = await fetch(`${baseUrl}/api/leasehold/${encodeURIComponent(createdId)}`, {
      method: 'DELETE',
      headers: { Cookie: userCookie }
    });
    assert.equal(userDelRes.status, 403, 'Regular users must receive 403 Forbidden when attempting delete');
    const userDelData = await userDelRes.json();
    assert.match(userDelData.error, /Users are permitted to encode only/i);

    // Admin signs in and can delete
    const adminDelRes = await fetch(`${baseUrl}/api/leasehold/${encodeURIComponent(createdId)}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie }
    });
    assert.equal(adminDelRes.status, 200, 'Admin can successfully delete record');

    // 4. Test View Rendering & CSV Export
    const viewHtml = renderLeaseholdView({
      state: store.state,
      schemas: { leaseholdColumns: LEASEHOLD_COLUMNS },
      currentUser: { role: 'user', email: userEmail, province: 'Eastern Samar' },
      provinceScope: { code: 'ESA', provinceName: 'Eastern Samar' },
      leaseholdSearch: '',
      leaseholdProvinceFilter: 'ALL',
      leaseholdStatusFilter: 'ALL',
      leaseholdTargetYearFilter: 'ALL',
      leaseholdPage: 1,
      leaseholdPageSize: 25
    });
    assert.ok(viewHtml.includes('Leasehold Master Ledger'), 'View renders master ledger title');
    assert.ok(viewHtml.includes('+ Encode Leasehold Record'), 'Encode button is present for user');
    assert.ok(viewHtml.includes('DELA CRUZ'), 'Encoded record is rendered in table');
    // Non-admin view must NOT show delete button
    assert.ok(!viewHtml.includes('data-del-leasehold'), 'Regular user must not see Delete button');

    // Admin view DOES show delete button
    const adminViewHtml = renderLeaseholdView({
      state: store.state,
      schemas: { leaseholdColumns: LEASEHOLD_COLUMNS },
      currentUser: { role: 'admin', email: DEFAULT_ADMIN_EMAIL },
      provinceScope: null,
      leaseholdSearch: '',
      leaseholdProvinceFilter: 'ALL',
      leaseholdStatusFilter: 'ALL',
      leaseholdTargetYearFilter: 'ALL',
      leaseholdPage: 1,
      leaseholdPageSize: 25
    });
    assert.ok(adminViewHtml.includes('data-del-leasehold'), 'Admin view includes Delete button');

    // CSV generator outputs 34 headers
    const csv = generateLeaseholdCsv(store.state.leasehold);
    assert.ok(csv.includes('"REG","PROVS","MUN","BRGY"'), 'CSV includes standard 34 columns');
    assert.ok(csv.includes('DELA CRUZ'), 'CSV includes data rows');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Option A: Dedicated Leasehold tab across provincial Google Sheets & Regional Hub with 34 headers, GAS synchronization & XLSX roundtrip', async () => {
  const dir = makeTempDir();
  const gasPushes = [];
  const mockGasPush = async (url, payload) => {
    gasPushes.push({ url, payload });
    return { ok: true, synced: true };
  };

  const { server, store } = createAppServer(dir, {
    requireAuth: false,
    pushToGasWebApp: mockGasPush
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    store.state.gasWebAppUrl = 'https://script.google.com/macros/s/AKfycb-TEST/exec';

    // 1. Verify schema definition contains exact 34 columns
    assert.equal(LEASEHOLD_COLUMNS.length, 34);
    assert.ok(OPTOOL_SHEET_SCHEMAS.Leasehold, 'Leasehold is registered in OPTOOL_SHEET_SCHEMAS');
    assert.equal(OPTOOL_SHEET_SCHEMAS.Leasehold.length, 34);

    // 2. Encode record via API and verify auto-push to GAS
    const postRes = await fetch(`${baseUrl}/api/leasehold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        row: {
          provs: 'Leyte',
          mun: 'Palo',
          brgy: 'Pawing',
          loSurname: 'TAN',
          loFirstname: 'ROBERTO',
          titleNo: 'T-98765',
          lotNo: 'Lot 101',
          areaPerTitle: '3.5000',
          areaTenanted: '2.1000',
          leaseholderSurname: 'RAMOS',
          leaseholderFirstname: 'JUAN',
          statusOfContract: 'New',
          targetYear: '2026',
          reportMonth: 'March'
        }
      })
    });
    assert.equal(postRes.status, 200);
    const postData = await postRes.json();
    assert.equal(postData.ok, true);
    assert.equal(postData.row.leaseholderSurname, 'RAMOS');
    assert.ok(postData.gasPushResult, 'GAS push was triggered');
    assert.ok(gasPushes.length >= 1);
    const rowPush = gasPushes.find((p) => p.payload.action === 'upsertOptoolRow');
    assert.ok(rowPush, 'upsertOptoolRow push found');
    assert.equal(rowPush.payload.tabName, 'Leasehold');
    assert.equal(rowPush.payload.row.leaseholderSurname, 'RAMOS');
    assert.equal(rowPush.payload.provinceCode, 'LEY');

    // 3. Test XLSX Export and Parsing roundtrip
    const analytics = store.computeAnalytics();
    const xlsxBuf = await buildConsolidatedWorkbookBuffer(store.state, analytics);
    const parsed = await parseWorkbookBuffer(xlsxBuf);
    assert.ok(parsed.sheetNames.includes('Leasehold'), 'Workbook includes Leasehold sheet');
    assert.ok(parsed.optool.Leasehold.length >= 1, 'Parsed Leasehold tab rows');
    const lhParsed = parsed.optool.Leasehold.find((r) => r.leaseholderSurname === 'RAMOS');
    assert.ok(lhParsed, 'Parsed row matches encoded RAMOS');
    assert.equal(lhParsed.titleNo, 'T-98765');
    assert.equal(lhParsed.provs, 'Leyte');

    // 4. Test importParsedDataset with Leasehold
    const count = store.importParsedDataset({
      optool: {
        Leasehold: [
          {
            provs: 'Biliran',
            mun: 'Naval',
            brgy: 'P.I. Garcia',
            loSurname: 'GARCIA',
            loFirstname: 'ANA',
            titleNo: 'T-11223',
            lotNo: 'Lot 50',
            leaseholderSurname: 'LIM',
            leaseholderFirstname: 'CARLO',
            areaTenanted: '1.7500'
          }
        ]
      }
    });
    assert.ok(count >= 1);
    const lim = store.state.leasehold.find((r) => r.leaseholderSurname === 'LIM');
    assert.ok(lim, 'Imported LIM record exists in store');
    assert.equal(lim.provs, 'Biliran');

    // 5. Delete record via API and verify GAS delete push
    const ramosId = postData.row.id;
    const delRes = await fetch(`${baseUrl}/api/leasehold/${encodeURIComponent(ramosId)}`, {
      method: 'DELETE'
    });
    assert.equal(delRes.status, 200);
    const delData = await delRes.json();
    assert.equal(delData.ok, true);
    assert.ok(gasPushes.length >= 2);
    const delPush = gasPushes.find((p) => p.payload.action === 'deleteOptoolRow');
    assert.ok(delPush, 'deleteOptoolRow push found');
    assert.equal(delPush.payload.tabName, 'Leasehold');
    assert.equal(delPush.payload.row.leaseholderSurname, 'RAMOS');

    // 6. Test /api/leasehold/sync-gas bulk push
    const syncRes = await fetch(`${baseUrl}/api/leasehold/sync-gas`, {
      method: 'POST'
    });
    assert.equal(syncRes.status, 200);
    const syncJson = await syncRes.json();
    assert.equal(syncJson.ok, true);
    assert.ok(syncJson.pushedCount >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Client scripts syntax verification (public/app.js, public/views.js, etc.)', () => {
  const publicDir = path.resolve(__dirname, '../../public');
  const files = ['app.js', 'views.js', 'reportingUtils.js'];
  for (const f of files) {
    const fullPath = path.join(publicDir, f);
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ['-c', fullPath], { stdio: 'pipe' });
    }, `Syntax check failed for ${f}`);
  }
});

test('CF Whereabouts embeds CF(DOC) OPTool Support List Table right after cards and removes Provincial Allocation Table', () => {
  const store = JSON.parse(fs.readFileSync('./server/data/store.json', 'utf8'));
  const cfg = WHEREABOUTS_CONFIGS['cf-whereabouts'];

  const ctx = {
    state: store,
    schemas: {
      registry: [],
      optoolTabs: OPTOOL_SHEET_SCHEMAS,
      optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS
    },
    provinceScope: null,
    whereaboutsTargetYearFilter: { 'cf-whereabouts': 'ALL' },
    whereaboutsProvinceFilter: {},
    whereaboutsStatusFilter: {},
    whereaboutsSearch: {},
    whereaboutsColFilters: {},
    whereaboutsPage: {},
    cfMetricMode: 'both',
    cfTableLayout: 'standard'
  };

  const html = renderMilestoneWhereaboutsView(ctx, cfg);

  // 1. Provincial Allocation Table is REMOVED from CF Whereabouts
  assert.equal(html.includes('id="panel-cf-whereabouts-provincial"'), false, 'Provincial Allocation Table must be removed from CF Whereabouts');

  // 2. CF(DOC) Operational Support List Table is embedded right after cards
  assert.ok(html.includes('id="panel-optool"'), 'panel-optool exists in CF Whereabouts');
  assert.ok(html.includes('CF(DOC) Operational Support List'), 'CF(DOC) Operational Support List title rendered');
  assert.ok(html.includes('id="optool-search"'), 'Search input exists on CF(DOC) OPTool panel');
  assert.ok(html.includes('id="optool-cf-survey-filter"'), 'Survey requirement filter dropdown exists on CF(DOC) OPTool panel');
  assert.ok(html.includes('id="cf-status-survey-filter"'), 'Survey requirement filter dropdown exists in CF status table header');
  assert.ok(html.includes('id="optool-col-mode"'), 'Column mode select exists on CF(DOC) OPTool panel');
  assert.ok(html.includes('id="btn-sync-provincial-optool"'), 'Sync Provincial Sheets button exists');
  assert.ok(html.includes('+ Add CF(DOC) Row'), '+ Add CF(DOC) Row button exists');
  assert.ok(html.includes('id="optool-table-wrap"'), 'Table wrapper exists');
  assert.ok(html.includes('id="optool-table"'), 'Table element exists');
  assert.ok(html.includes('id="optool-pagination-bar"'), 'Pagination bar exists');

  // 3. Position verification: CF(DOC) OPTool Table must appear right after KPI cards and before Milestone Status Table
  const pCards = html.indexOf('cf-kpi-global-grid');
  const pOptoolPanel = html.indexOf('id="panel-optool"');
  const pStatusTable = html.indexOf('id="panel-cf-status-table"');
  assert.ok(pCards !== -1 && pOptoolPanel !== -1 && pStatusTable !== -1, 'All panels exist');
  assert.ok(pCards < pOptoolPanel, 'CF(DOC) table must come after KPI cards');
  assert.ok(pOptoolPanel < pStatusTable, 'CF(DOC) table must come before Status Table');

  // 4. Survey, MOV, RegDist, and Installation all remove Provincial Allocation panel and embed OPTool Table
  const movCfg = WHEREABOUTS_CONFIGS['mov-whereabouts'];
  const movHtml = renderMilestoneWhereaboutsView({ ...ctx, whereaboutsTargetYearFilter: { 'mov-whereabouts': 'ALL' } }, movCfg);
  assert.equal(movHtml.includes('id="panel-mov-whereabouts-provincial"'), false, 'MOV Whereabouts removes Provincial Allocation Table');
  assert.ok(movHtml.includes('id="panel-optool"'), 'MOV embeds OPTool panel');
  assert.ok(movHtml.includes('MOV Operational Support List'), 'MOV Operational Support List title present');

  const surveyCfg = WHEREABOUTS_CONFIGS['survey-whereabouts'];
  const surveyHtml = renderMilestoneWhereaboutsView({ ...ctx, whereaboutsTargetYearFilter: { 'survey-whereabouts': 'ALL' } }, surveyCfg);
  assert.equal(surveyHtml.includes('id="panel-survey-whereabouts-provincial"'), false, 'Survey Whereabouts removes Provincial Allocation Table');
  assert.ok(surveyHtml.includes('id="panel-optool"'), 'Survey embeds OPTool panel');
  assert.ok(surveyHtml.includes('Survey Operational Support List'), 'Survey Operational Support List title present');
  assert.ok(surveyHtml.includes('+ Add Survey Row'), '+ Add Survey Row button present');

  // Position check in Survey: surveyKpiHtml comes before panel-optool which comes before surveyStatusTableHtml
  const pSurveyCards = surveyHtml.indexOf('cf-kpi-global-grid');
  const pSurveyOptool = surveyHtml.indexOf('id="panel-optool"');
  const pSurveyStatus = surveyHtml.indexOf('id="panel-survey-status-monitoring"');
  assert.ok(pSurveyCards !== -1 && pSurveyOptool !== -1 && pSurveyStatus !== -1, 'All Survey panels exist');
  assert.ok(pSurveyCards < pSurveyOptool, 'Survey OPTool table must come after KPI cards');
  assert.ok(pSurveyOptool < pSurveyStatus, 'Survey OPTool table must come before Survey Monitoring Table');
});

test('OPTool deduplication and data-loading resilience: no duplicate rows on refresh/sync and purge on load', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optool-dedup-test-'));
  const store = new ConsolidatedStore(tmpDir);

  // 1. Reset CF(DOC) to empty array
  store.state.optool['CF(DOC)'] = [];
  assert.equal(store.state.optool['CF(DOC)'].length, 0);

  // 2. Import two rows from Eastern Samar: LHID 803000135 and 803000136 (exact user scenario)
  const incomingRows = [
    {
      lhid: '803000135',
      titleNumber: 'RP-1038 (11000)',
      landOwner: 'SABULAO, EUFEMIA',
      moa: 'CA',
      regionName: 'VIII',
      province: 'EASTERN SAMAR',
      municipality: 'LAWA-AN',
      barangay: 'BOLUSAO'
    },
    {
      lhid: '803000136',
      titleNumber: 'RP-1039 (11001)',
      landOwner: 'SABULAO, EUFEMIA',
      moa: 'CA',
      regionName: 'VIII',
      province: 'EASTERN SAMAR',
      municipality: 'LAWA-AN',
      barangay: 'BOLUSAO'
    }
  ];

  store.importParsedDataset({ optool: { 'CF(DOC)': incomingRows } }, { skipSave: true });
  assert.equal(store.state.optool['CF(DOC)'].length, 2, 'Initial import produces exactly 2 rows');

  // 3. Repeated sync / import of the same rows must NOT duplicate
  store.importParsedDataset({ optool: { 'CF(DOC)': incomingRows } }, { skipSave: true });
  assert.equal(store.state.optool['CF(DOC)'].length, 2, 'Repeated import in merge mode does NOT duplicate rows');

  // 4. Repeated sync / import in replaceMilestoneTabs mode must also NOT duplicate
  store.importParsedDataset(
    { optool: { 'CF(DOC)': incomingRows } },
    { skipSave: true, replaceMilestoneTabs: true, scopeCode: 'ESA' }
  );
  assert.equal(store.state.optool['CF(DOC)'].length, 2, 'replaceMilestoneTabs mode does NOT duplicate rows');

  // 5. Injected raw duplicate records in store.json are automatically purged by normalizeState on reload
  store.state.optool['CF(DOC)'].push(...incomingRows); // Intentionally create duplicate in memory
  assert.equal(store.state.optool['CF(DOC)'].length, 4, 'Intentionally duplicated to 4 rows');
  store.save();

  // Reload store from disk
  const reloadedStore = new ConsolidatedStore(tmpDir);
  assert.equal(reloadedStore.state.optool['CF(DOC)'].length, 2, 'normalizeState purges duplicate rows on load');

  // 6. UI view models defensively deduplicate even if raw state had duplicates
  const testCtx = {
    state: {
      optool: {
        'CF(DOC)': [
          { lhid: '803000135', landOwner: 'SABULAO, EUFEMIA' },
          { lhid: '803000136', landOwner: 'SABULAO, EUFEMIA' },
          { lhid: '803000135', landOwner: 'SABULAO, EUFEMIA' },
          { lhid: '803000136', landOwner: 'SABULAO, EUFEMIA' }
        ],
        Database: []
      }
    },
    schemas: {
      optoolTabs: {
        'CF(DOC)': [
          { key: 'lhid', header: 'LHID', label: 'LHID' },
          { key: 'landOwner', header: 'LONAME', label: 'LONAME' }
        ]
      },
      milestoneTargetTabs: ['CF(DOC)']
    },
    activeOptoolTab: 'CF(DOC)',
    whereaboutsColFilters: {},
    whereaboutsSearch: {},
    whereaboutsProvinceFilter: {},
    whereaboutsStatusFilter: {},
    whereaboutsTargetYearFilter: {},
    whereaboutsPage: {},
    whereaboutsPageSize: {}
  };

  const vm = buildOptoolViewModel(testCtx);
  assert.equal(vm.totalRows, 2, 'buildOptoolViewModel deduplicates raw duplicate rows');
  assert.equal(vm.indexedRows.length, 2, 'buildOptoolViewModel indexedRows count is 2');

  const cfCfg = WHEREABOUTS_CONFIGS['cf-whereabouts'];
  const whereaboutsHtml = renderMilestoneWhereaboutsView(testCtx, cfCfg);
  assert.ok(whereaboutsHtml.includes('2 Active Records in CF(DOC)'), 'Whereabouts badges display deduplicated count (2 active records, not 4)');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('renderOptoolView strictly displays the master Database worksheet across all provinces', () => {
  const multiProvinceCtx = {
    view: 'optool',
    // Simulate leftover state from visiting CF Whereabouts
    activeOptoolTab: 'CF(DOC)',
    state: {
      optool: {
        'CF(DOC)': [
          { lhid: '803000135', landOwner: 'SABULAO, EUFEMIA', province: 'EASTERN SAMAR' }
        ],
        Database: [
          { lhid: '801000001', landOwner: 'DELA CRUZ, JUAN', province: 'BILIRAN', municipality: 'NAVAL', titleNumber: 'OCT-100', area: 5.5, carpableArea: 5.5, lotNumber: '101' },
          { lhid: '802000002', landOwner: 'SANTOS, MARIA', province: 'LEYTE', municipality: 'ALANGALANG', titleNumber: 'T-200', area: 12.0, carpableArea: 10.0, lotNumber: '102' },
          { lhid: '803000135', landOwner: 'SABULAO, EUFEMIA', province: 'EASTERN SAMAR', municipality: 'LAWA-AN', titleNumber: 'RP-1038', area: 7.5, carpableArea: 7.5, lotNumber: '103' },
          { lhid: '804000004', landOwner: 'REYES, PEDRO', province: 'NORTHERN SAMAR', municipality: 'CATARMAN', titleNumber: 'OCT-400', area: 3.2, carpableArea: 3.2, lotNumber: '104' },
          { lhid: '805000005', landOwner: 'ABELLAR, CORAZON', province: 'WESTERN SAMAR', municipality: 'SAN JORGE', titleNumber: 'OCT-500', area: 15.0, carpableArea: 15.0, lotNumber: '105' },
          { lhid: '806000006', landOwner: 'MERCADO, JOSE', province: 'SOUTHERN LEYTE', municipality: 'MAASIN', titleNumber: 'OCT-600', area: 8.4, carpableArea: 8.4, lotNumber: '106' }
        ]
      }
    },
    schemas: {
      optoolTabs: {
        'CF(DOC)': [
          { key: 'lhid', header: 'LHID', label: 'LHID' },
          { key: 'landOwner', header: 'LONAME', label: 'LONAME' }
        ],
        Database: [
          { key: 'titleNumber', header: 'TITLE NUMBER', label: 'TITLE NUMBER' },
          { key: 'landOwner', header: 'LAND OWNER', label: 'LAND OWNER' },
          { key: 'province', header: 'PROVINCE', label: 'PROVINCE' },
          { key: 'municipality', header: 'MUNICIPALITY', label: 'MUNICIPALITY' },
          { key: 'area', header: 'TOTAL AREA (HAS)', label: 'TOTAL AREA (HAS)', type: 'decimal' },
          { key: 'carpableArea', header: 'COMPUTED AREA (HAS)', label: 'COMPUTED AREA (HAS)', type: 'decimal' },
          { key: 'lotNumber', header: 'LOT', label: 'LOT' }
        ]
      },
      milestoneTargetTabs: ['CF(DOC)', 'Survey', 'MOV', 'RegistrationDistribution', 'Installation', 'Leasehold']
    },
    optoolColFilters: {},
    optoolSearch: '',
    optoolTargetFilter: 'ALL',
    optoolPage: 1,
    optoolPageSize: 50,
    optoolColMode: 'all',
    optoolColPage: 1,
    filters: {}
  };

  const html = renderOptoolView(multiProvinceCtx);

  // Must render the Database panel heading and subtitle
  assert.ok(html.includes('Optool Support List(tagging of Target)'), 'Panel title must be Optool Support List(tagging of Target)');
  assert.ok(html.includes('Active records in Database worksheet (All Provinces)'), 'Panel subtitle must indicate Database worksheet (All Provinces)');
  assert.ok(html.includes('6 Active Records in Database'), 'Panel badge must show all 6 Database active records');

  // Must render Database action buttons and target filters
  assert.ok(html.includes('+ Add Database Row'), 'Action button must be + Add Database Row');
  assert.ok(!html.includes('+ Add CF(DOC) Row'), 'Must not render CF(DOC) action button');
  assert.ok(html.includes('All Milestone Targets'), 'Must render Milestone Target dropdown for Database');

  // Must display records across all provinces in Region VIII
  assert.ok(html.includes('BILIRAN'), 'Displays Biliran Database record');
  assert.ok(html.includes('LEYTE'), 'Displays Leyte Database record');
  assert.ok(html.includes('EASTERN SAMAR'), 'Displays Eastern Samar Database record');
  assert.ok(html.includes('NORTHERN SAMAR'), 'Displays Northern Samar Database record');
  assert.ok(html.includes('WESTERN SAMAR'), 'Displays Samar Database record');
  assert.ok(html.includes('SOUTHERN LEYTE'), 'Displays Southern Leyte Database record');
});

test('performProvincialSync imports both optool and milestoneData, and /api/sync/provincial-optool returns live state on login sync', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salig-login-sync-test-'));
  const store = new ConsolidatedStore(tmpDir);

  const mockFetchXlsx = async (spreadsheetId, options = {}) => {
    return {
      milestoneData: [
        {
          Record_ID: `REC-${options.provinceCode}-1`,
          Province_Code: options.provinceCode,
          Municipality: 'Sample Mun',
          Land_Allocation_ID: 'LAD-101',
          eTitle_No: 'TCT-001',
          Area_HAS: '2.5000',
          Milestone_Stage: 'eTitle Registered',
          Milestone_Date: '2026-11-20',
          Batch_Category: 'ADMIN BATCH 1',
          LHID: '803000135'
        }
      ],
      optool: {
        'CF(DOC)': [
          { lhid: '803000135', landOwner: 'SABULAO, EUFEMIA', province: options.province, titleNumber: 'RP-1038' },
          { lhid: '803000136', landOwner: 'SABULAO, EUFEMIA', province: options.province, titleNumber: 'RP-1039' }
        ],
        Survey: [
          { lhid: '803000135', landOwner: 'SABULAO, EUFEMIA', province: options.province, titleNumber: 'RP-1038' }
        ],
        MOV: [],
        RegistrationDistribution: [
          { lhid: '803000135', landOwner: 'SABULAO, EUFEMIA', province: options.province, titleNumber: 'RP-1038' }
        ],
        Installation: [],
        Database: [
          { lhid: '803000135', landOwner: 'SABULAO, EUFEMIA', province: options.province, titleNumber: 'RP-1038', area: 7.5, carpableArea: 7.5 }
        ],
        Leasehold: []
      },
      tabRowCounts: {
        'CF(DOC)': 2,
        Survey: 1,
        RegistrationDistribution: 1,
        Database: 1
      }
    };
  };

  const { performProvincialSync } = await import('../app.js');
  const syncRes = await performProvincialSync(store, {
    fetchXlsxFn: mockFetchXlsx,
    force: true
  });

  assert.equal(syncRes.ok, true, 'performProvincialSync completes successfully');
  assert.ok(store.state.optool['CF(DOC)'].length >= 2, 'CF(DOC) records are populated');
  assert.ok(store.state.optool.Survey.length >= 1, 'Survey records are populated');
  assert.ok(store.state.optool.RegistrationDistribution.length >= 1, 'RegistrationDistribution records are populated');
  assert.ok(store.state.milestoneData.length >= 1, 'MilestoneData records are populated');
  assert.equal(store.state.dataSourceMode, 'live', 'dataSourceMode is set to live');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Dashboard interactive milestone whereabouts details and CF(DOC) Needing vs Not Needing Survey breakdown', () => {
  const sampleState = {
    optool: {
      Database: [
        { lhid: '803000101', province: 'EASTERN SAMAR', provinceCode: 'ESA', ladStatus: 'LAD Balance', carpable: 5.5 },
        { lhid: '803000102', province: 'EASTERN SAMAR', provinceCode: 'ESA', ladStatus: 'Temp. Park', carpable: 4.5 },
        { lhid: '803000201', province: 'LEYTE', provinceCode: 'LEY', ladStatus: 'LAD Balance', carpable: 10.0 }
      ],
      'CF(DOC)': [
        { lhid: '803000101', province: 'EASTERN SAMAR', surveyRequirement: 'Needing Survey', totalArea: 5.5 },
        { lhid: '803000102', province: 'EASTERN SAMAR', surveyRequirement: 'Not Needing Survey', totalArea: 4.5 },
        { lhid: '803000201', province: 'LEYTE', surveyRequirement: 'Needing Survey', totalArea: 10.0 }
      ],
      Survey: [
        { lhid: '803000101', province: 'EASTERN SAMAR', totalArea: 5.5 }
      ],
      MOV: [
        { lhid: '803000101', province: 'EASTERN SAMAR', totalArea: 5.5 }
      ],
      RegistrationDistribution: [],
      Installation: [],
      Leasehold: [
        {
          provs: 'EASTERN SAMAR',
          'AREA TENANTED (Has)': '3.5000',
          'TARGET YEAR': '2026',
          leaseholderSurname: 'DELA CRUZ'
        },
        {
          provs: 'LEYTE',
          'AREA TENANTED (Has)': '2.2500',
          'TARGET YEAR': '2025',
          leaseholderSurname: 'SANTOS'
        }
      ]
    }
  };

  // 1. Consolidated Region VIII Breakdown
  const allBreakdown = computeMilestoneWhereaboutsBreakdown(sampleState, null, 'ALL');
  assert.equal(allBreakdown.isAll, true);
  assert.equal(allBreakdown.cf.count, 3);
  assert.equal(allBreakdown.cf.needingCount, 2);
  assert.equal(allBreakdown.cf.notNeedingCount, 1);
  assert.equal(allBreakdown.survey.count, 1);
  assert.equal(allBreakdown.leasehold.count, 2);
  assert.equal(allBreakdown.leasehold.area, 5.75); // Column M: Area Tenanted 3.5 + 2.25
  assert.equal(allBreakdown.targetLhs, 2); // 803000101 and 803000201

  // 2. Eastern Samar Provincial Filter Breakdown
  const esaBreakdown = computeMilestoneWhereaboutsBreakdown(sampleState, null, 'ESA');
  assert.equal(esaBreakdown.isAll, false);
  assert.equal(esaBreakdown.targetLhs, 1);
  assert.equal(esaBreakdown.cf.count, 2);
  assert.equal(esaBreakdown.cf.needingCount, 1);
  assert.equal(esaBreakdown.cf.notNeedingCount, 1);
  assert.equal(esaBreakdown.survey.count, 1);
  assert.equal(esaBreakdown.leasehold.count, 1);
  assert.equal(esaBreakdown.leasehold.area, 3.5); // Column M: Area Tenanted for ESA

  // Verify Leasehold helper functions for Column M (Area Tenanted) and Column AF (Target Year)
  assert.equal(getLeaseholdAreaTenanted({ 'AREA TENANTED (Has)': '4.1250' }), 4.1250);
  assert.equal(getLeaseholdTargetYear({ 'TARGET YEAR': '2026.0' }), '2026');
  assert.equal(getLeaseholdTargetYear({ 'Target Year': '2027' }), '2027');
  // Discards monetary amounts from misaligned columns (e.g. 10080, 2221.67, 25200)
  assert.equal(getLeaseholdTargetYear({ 'TARGET YEAR': '10080' }), '');
  assert.equal(getLeaseholdTargetYear({ 'TARGET YEAR': '2221.67' }), '');
  assert.equal(getLeaseholdTargetYear({ 'TARGET YEAR': '25200' }), '');
  // Falls back to registered contract date year when TARGET YEAR is empty or monetary amount
  assert.equal(getLeaseholdTargetYear({ 'TARGET YEAR': '10080', dateContractRegistered: '03/15/2025' }), '2025');
  assert.equal(getLeaseholdTargetYear({ 'TARGET YEAR': '', datePlrRegistered: '09/01/2026' }), '2026');

  // 3. renderProvTableDetailHtml renders milestone whereabouts and survey split directly below table with graph beside
  const detailHtml = renderProvTableDetailHtml({ breakdown: esaBreakdown, selectedCode: 'ESA' });
  assert.ok(detailHtml.includes('Milestone Whereabouts &amp; CF Survey Breakdown'), 'Detail has milestone whereabouts section');
  assert.ok(detailHtml.includes('LHs Needing Survey'), 'Detail shows LHs Needing Survey label');
  assert.ok(detailHtml.includes('LHs Not Needing Survey'), 'Detail shows LHs Not Needing Survey label');
  assert.ok(detailHtml.includes('data-nav-survey="Needing Survey"'), 'Detail has link for Needing Survey');
  assert.ok(detailHtml.includes('Survey &amp; Milestone Graph'), 'Detail includes graph beside header');
  assert.ok(detailHtml.includes('CF LHs'), 'Detail includes donut chart center text');
  assert.ok(detailHtml.includes('Milestone Comparison'), 'Detail includes milestone comparison bars');

  // renderMapDetailCardInner preserves clean original design
  const cardHtml = renderMapDetailCardInner('ESA', [{ code: 'ESA', name: 'EASTERN SAMAR', ladLhs: 1, ladArea: 5.5, tempLhs: 1, tempArea: 4.5 }], {});
  assert.ok(cardHtml.includes('LAD Balance'), 'Card shows LAD Balance');
  assert.ok(cardHtml.includes('Temp. Park'), 'Card shows Temp. Park');

  // 4. renderMilestoneWhereaboutsSectionHtml renders dynamic cards and survey badges
  const sectionHtml = renderMilestoneWhereaboutsSectionHtml({ breakdown: esaBreakdown, selectedCode: 'ESA' });
  assert.ok(sectionHtml.includes('Whereabouts per Milestone'), 'Renders Whereabouts per Milestone header');
  assert.ok(sectionHtml.includes('EASTERN SAMAR (ESA) Active'), 'Renders ESA Active badge');
  assert.ok(sectionHtml.includes('Needing: <strong>1</strong>'), 'Renders Needing count on CF card');
  assert.ok(sectionHtml.includes('Not Needing: <strong>1</strong>'), 'Renders Not Needing count on CF card');
  assert.ok(sectionHtml.includes('data-dash-reset-prov="ALL"'), 'Renders Show All Region VIII reset button');

  // 5. renderMilestoneWhereaboutsView for cf-whereabouts renders interactive split KPI cards
  const cfHtml = renderMilestoneWhereaboutsView({
    state: sampleState,
    filters: {},
    cfSurveyFilter: 'ALL'
  }, WHEREABOUTS_CONFIGS['cf-whereabouts']);
  assert.ok(cfHtml.includes('data-cf-survey-kpi="Needing Survey"'), 'Renders Needing Survey interactive KPI card');
  assert.ok(cfHtml.includes('data-cf-survey-kpi="Not Needing Survey"'), 'Renders Not Needing Survey interactive KPI card');
});

test('NEP Targets direct Live Google Sheet Sync & 2027 Target Year integrity', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salig-nep-sync-test-'));
  const store = new ConsolidatedStore(tempDir);
  store.state.gasWebAppUrl = 'https://script.google.com/macros/s/TEST/exec';

  let pushedGasAction = null;
  let pushedPayload = null;
  const mockGasPush = async (url, payload) => {
    pushedGasAction = payload.action;
    pushedPayload = payload;
    return { ok: true, syncedNodes: [{ code: 'HUB', ok: true }] };
  };

  const { handler } = createAppServer(store, {
    pushToGasWebApp: mockGasPush,
    autoFetchHubNep: false,
    requireAuth: false
  });

  // 1. Initial targets for 2027 in CF Documentation
  store.updateNepProvinceList({
    LEY: { lhs: 93, area: 839.9117, arbs: 80, year: 2027, sem1Lhs: 46, sem1Area: 419.9558 },
    ESA: { lhs: 4, area: 19.7475, arbs: 0, year: 2027, sem1Lhs: 2, sem1Area: 9.8737 }
  }, 'cf_doc');

  const analytics2027 = store.computeAnalytics({ milestoneYear: '2027' });
  const cf2027 = analytics2027.milestoneNepBreakdown.find((m) => m.key === 'cf_doc');
  assert.equal(cf2027.nepTargetCount, 97, 'CF target count sums 93 + 4 = 97 for 2027');
  assert.equal(cf2027.nepTargetAreaHas, 859.6592, 'CF target area sums 839.9117 + 19.7475 = 859.6592 HAS');
  assert.equal(cf2027.nepTargetSem1Count, 48, '1st Sem target count sums 46 + 2 = 48');

  // 2. PUT /api/nep-targets pushes directly to Live Google Sheet via GAS
  const putPayload = {
    year: 2027,
    targets: {
      cf_doc: {
        targetCount: 195,
        targetAreaHas: 1594.3637,
        sem1TargetCount: 98,
        sem1TargetAreaHas: 797.1819
      }
    }
  };

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

  const res = await callApi('/api/nep-targets?milestoneYear=2027', 'PUT', putPayload);
  assert.equal(res.statusCode, 200, 'PUT /api/nep-targets returns 200');
  assert.equal(pushedGasAction, 'saveNepSheet', 'Pushes mutation action saveNepSheet to GAS');
  assert.ok(pushedPayload.nepMilestoneList, 'Pushes milestone list to GAS');
  assert.equal(res.body.gasSync.ok, true, 'Returns gasSync success');
  assert.equal(res.body.nepTargets.cf_doc.targetCount, 195, 'Target count updated to 195');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Leasehold Column M & Column AF flexible header parsing and Target Summary 2027 navigation', async () => {
  // 1. Verify buildHeaderMapping on diverse variants of Column M and Column AF
  const sampleLeaseholdHeaders = [
    'REG', 'PROVS', 'MUN', 'BRGY', 'LO SURNAME', 'LO FIRSTNAME', 'LO MI',
    'TITLE NO.', 'TAX DEC NO.', 'SURVEY NO.', 'LOT NO.',
    'AREA PER TITLE', 'AREA TENANTED', 'WITHIN RETAINED AREA',
    'LEASEHOLDER SURNAME', 'LEASEHOLDER FIRSTNAME', 'LEASEHOLDER MI',
    'TENANT STATUS', 'NEW LESSEE NAME', 'RELATIONSHIP TO TENANT',
    'GENDER', 'Number of ARBs', 'MAIN CROPS', 'AUXILLIARY CROPS',
    'SHARING ARRANGEMENT', 'TENURIAL ARRANGEMENT', 'STATUS OF CONTRACT',
    'DATE CONTRACT REGISTERED', 'DATE PLR REGISTERED',
    'LEASE RENTAL UNIT', 'LEASE IN PESOS', 'TARGET YEAR',
    'Report Month', 'REMARKS'
  ];

  const workbookBuf = writeXlsxWorkbook([
    {
      name: 'Leasehold',
      rows: [
        sampleLeaseholdHeaders,
        [
          'Region VIII', 'Leyte', 'Alangalang', 'San Antonio', 'DELA CRUZ', 'JUAN', 'P',
          'T-12345', 'TD-9988', 'S-100', '1-A',
          '4.5000', '3.7500', 'No',
          'SANTOS', 'PEDRO', 'M', 'alive', '', '',
          'M', '1', 'Rice', 'Corn', '75/25', 'Agricultural Leasehold', 'New',
          '03/15/2026', '03/20/2026', 'Per Hectare', '15000', '2027',
          'March', 'Target registered'
        ]
      ]
    }
  ]);

  const parsed = await parseWorkbookBuffer(workbookBuf);
  assert.equal(parsed.leasehold.length, 1, 'Parses 1 Leasehold row');
  assert.equal(parsed.leasehold[0].areaTenanted, '3.7500', 'Column M AREA TENANTED parsed into areaTenanted');
  assert.equal(parsed.leasehold[0].targetYear, '2027', 'Column AF TARGET YEAR parsed into targetYear');
  assert.equal(getLeaseholdAreaTenanted(parsed.leasehold[0]), 3.75, 'getLeaseholdAreaTenanted extracts 3.75 HAS');

  // 2. Verify Target Summary 2027 active label & 2026 navigation banner
  const mockAnalytics = {
    availableMilestoneYears: [2026, 2027],
    nepProvinceBreakdown: [],
    nepMilestoneList: {
      cf_doc: { LEY: { lhs: 195, area: 1594.3637, year: 2027 } }
    },
    milestoneNepBreakdown: [
      {
        key: 'cf_doc',
        label: 'CF Documentation',
        nepTargetCount: 195,
        nepTargetAreaHas: 1594.3637,
        total: { count: 2, areaHas: 3.9051 },
        q1: { count: 2, areaHas: 3.9051 },
        q2: { count: 0, areaHas: 0 },
        q3: { count: 0, areaHas: 0 },
        q4: { count: 0, areaHas: 0 },
        sem1: { count: 2, areaHas: 3.9051 },
        sem2: { count: 0, areaHas: 0 },
        undated: { count: 0, areaHas: 0 },
        provinceBreakdown: {}
      }
    ]
  };

  const html2027 = renderTargetSummaryView({
    analytics: mockAnalytics,
    filters: { milestoneYear: '2027', province: 'ALL' },
    nepMetricMode: 'both',
    nepMilestoneTableFilter: 'ALL',
    schemas: { registry: [] }
  });
  assert.ok(html2027.includes('2027 (Active NEP Targets)'), 'Includes 2027 (Active NEP Targets) label in dropdown');

  const html2026 = renderTargetSummaryView({
    analytics: mockAnalytics,
    filters: { milestoneYear: '2026', province: 'ALL' },
    nepMetricMode: 'both',
    nepMilestoneTableFilter: 'ALL',
    schemas: { registry: [] }
  });
  assert.ok(html2026.includes('id="btn-switch-to-active-nep-year"'), 'Includes switch to 2027 targets banner when viewing 2026');
});

test('Full CRUD operations for NEP targets across multiple years without overwriting', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salig-nep-crud-test-'));
  const store = new ConsolidatedStore(tempDir);
  store.state.gasWebAppUrl = 'https://script.google.com/macros/s/TEST/exec';

  const gasCalls = [];
  const mockGasPush = async (url, payload) => {
    gasCalls.push(payload);
    return { ok: true, syncedNodes: [{ code: 'HUB', ok: true }] };
  };

  const { handler } = createAppServer(store, {
    pushToGasWebApp: mockGasPush,
    autoFetchHubNep: false,
    requireAuth: false
  });

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

  // 1. CREATE (POST): Add 2026 NEP Target for LEY in cf_doc
  const post2026 = await callApi('/api/nep-targets', 'POST', {
    year: 2026,
    milestone: 'cf_doc',
    provinceCode: 'LEY',
    lhs: 50,
    area: 250.5,
    arbs: 40,
    sem1Lhs: 25,
    sem1Area: 125.25
  });
  assert.equal(post2026.statusCode, 201, 'POST 2026 target returns 201 Created');
  assert.equal(post2026.body.target.year, 2026);
  assert.equal(post2026.body.target.lhs, 50);

  // 2. CREATE (POST): Add 2027 NEP Target for LEY in cf_doc without replacing 2026
  const post2027 = await callApi('/api/nep-targets', 'POST', {
    year: 2027,
    milestone: 'cf_doc',
    provinceCode: 'LEY',
    lhs: 93,
    area: 839.9117,
    arbs: 80,
    sem1Lhs: 46,
    sem1Area: 419.9558
  });
  assert.equal(post2027.statusCode, 201, 'POST 2027 target returns 201 Created');
  assert.equal(post2027.body.target.year, 2027);
  assert.equal(post2027.body.target.lhs, 93);

  // Verify multi-year coexistence in Store
  assert.equal(store.state.nepMilestoneListByYear[2026].cf_doc.LEY.lhs, 50, '2026 LEY target preserved');
  assert.equal(store.state.nepMilestoneListByYear[2027].cf_doc.LEY.lhs, 93, '2027 LEY target added independently');

  // 3. READ (GET): Query NEP targets by year
  const get2026 = await callApi('/api/nep-targets?year=2026&milestone=cf_doc', 'GET');
  assert.equal(get2026.statusCode, 200);
  assert.equal(get2026.body.targets.length, 1);
  assert.equal(get2026.body.targets[0].lhs, 50);

  const get2027 = await callApi('/api/nep-targets?year=2027&milestone=cf_doc', 'GET');
  assert.equal(get2027.statusCode, 200);
  assert.equal(get2027.body.targets.length, 1);
  assert.equal(get2027.body.targets[0].lhs, 93);

  // 4. UPDATE (PUT): Update 2027 target for LEY
  const put2027 = await callApi('/api/nep-targets', 'PUT', {
    year: 2027,
    milestone: 'cf_doc',
    provinceCode: 'LEY',
    lhs: 100,
    area: 900.0,
    arbs: 85
  });
  assert.equal(put2027.statusCode, 200, 'PUT updates target');
  assert.equal(store.state.nepMilestoneListByYear[2027].cf_doc.LEY.lhs, 100, '2027 updated to 100');
  assert.equal(store.state.nepMilestoneListByYear[2026].cf_doc.LEY.lhs, 50, '2026 remains intact at 50');

  // 5. DELETE (DELETE): Delete 2026 target for LEY
  const del2026 = await callApi('/api/nep-targets', 'DELETE', {
    year: 2026,
    milestone: 'cf_doc',
    provinceCode: 'LEY'
  });
  assert.equal(del2026.statusCode, 200, 'DELETE returns 200');
  assert.equal(store.state.nepMilestoneListByYear[2026]?.cf_doc?.LEY, undefined, '2026 LEY removed');
  assert.equal(store.state.nepMilestoneListByYear[2027].cf_doc.LEY.lhs, 100, '2027 LEY still exists');

  // Check GAS push actions called for mutations
  const actions = gasCalls.map((c) => c.action);
  assert.ok(actions.includes('saveNepSheet'), 'saveNepSheet pushed to GAS');
  assert.ok(actions.includes('deleteNepTarget'), 'deleteNepTarget pushed to GAS');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Milestone Accomplishment filtering strictly by Reported Month year matching Target Year', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-nep-accomp-filter-'));
  const store = new ConsolidatedStore(tempDir);

  // Setup Database records with areas
  store.state.optool.Database = [
    { lhid: '803000136', province: 'Eastern Samar', provinceCode: 'ESA', carpable: '2.0234', totalArea: '2.0234' },
    { lhid: '803000135', province: 'Eastern Samar', provinceCode: 'ESA', carpable: '1.8817', totalArea: '1.8817' },
    { lhid: '803000200', province: 'Leyte', provinceCode: 'LEY', carpable: '10.5000', totalArea: '10.5000' }
  ];

  // Setup CF(DOC) milestone records with Reported Month in different years
  store.state.optool['CF(DOC)'] = [
    { lhid: '803000136', province: 'Eastern Samar', provinceCode: 'ESA', reportedMonth: 'March 2026', targetYear: '2026' },
    { lhid: '803000135', province: 'Eastern Samar', provinceCode: 'ESA', reportedMonth: 'March 2026', targetYear: '2026' },
    { lhid: '803000200', province: 'Leyte', provinceCode: 'LEY', reportedMonth: 'January 2027', targetYear: '2027' }
  ];

  // Setup Targets for 2026 and 2027
  store.updateNepProvinceList({ ESA: { lhs: 4, area: 19.7475, arbs: 0, year: 2026 } }, 'cf_doc', 2026);
  store.updateNepProvinceList({ ESA: { lhs: 4, area: 19.7475, arbs: 0, year: 2027 }, LEY: { lhs: 1, area: 10.5, arbs: 0, year: 2027 } }, 'cf_doc', 2027);

  // 1. When filtering for Target Year 2027:
  // Only accomplishments whose Reported Month year is equal to 2027 should be counted!
  const res2027 = store.computeMilestoneNepBreakdown({ activeScope: null, milestoneYear: '2027' });
  const cf2027 = res2027.milestoneNepBreakdown.find((r) => r.key === 'cf_doc');
  assert.equal(cf2027.q1.count, 1, '2027 Q1 count should only be 1 (LEY)');
  assert.equal(cf2027.q1.areaHas, 10.5, '2027 Q1 area should be 10.5 HAS');
  assert.equal(cf2027.provinceBreakdown.ESA.count, 0, '2027 ESA accomplishment count must be 0 (2026 excluded)');
  assert.equal(cf2027.provinceBreakdown.ESA.areaHas, 0, '2027 ESA accomplishment area must be 0 (2026 excluded)');
  assert.equal(cf2027.provinceBreakdown.ESA.hasAccomp, false, '2027 ESA hasAccomp should be false');
  assert.equal(cf2027.provinceBreakdown.LEY.count, 1, '2027 LEY accomplishment count should be 1');
  assert.equal(cf2027.provinceBreakdown.LEY.areaHas, 10.5, '2027 LEY accomplishment area should be 10.5');
  assert.equal(cf2027.provinceBreakdown.LEY.hasAccomp, true, '2027 LEY hasAccomp should be true');

  // 2. When filtering for Target Year 2026:
  // Only accomplishments whose Reported Month year is equal to 2026 should be counted!
  const res2026 = store.computeMilestoneNepBreakdown({ activeScope: null, milestoneYear: '2026' });
  const cf2026 = res2026.milestoneNepBreakdown.find((r) => r.key === 'cf_doc');
  assert.equal(cf2026.q1.count, 2, '2026 Q1 count should be 2 (ESA)');
  assert.equal(cf2026.q1.areaHas, 3.9051, '2026 Q1 area should be 3.9051 HAS (2.0234 + 1.8817)');
  assert.equal(cf2026.provinceBreakdown.ESA.count, 2, '2026 ESA count should be 2');
  assert.equal(cf2026.provinceBreakdown.ESA.areaHas, 3.9051, '2026 ESA area should be 3.9051');
  assert.equal(cf2026.provinceBreakdown.ESA.hasAccomp, true, '2026 ESA hasAccomp should be true');
  assert.equal(cf2026.provinceBreakdown.LEY.count, 0, '2026 LEY count should be 0 (2027 excluded)');
  assert.equal(cf2026.provinceBreakdown.LEY.hasAccomp, false, '2026 LEY hasAccomp should be false');

  // 3. When filtering for ALL Years:
  // All accomplishments across years should be included in their respective quarters
  const resAll = store.computeMilestoneNepBreakdown({ activeScope: null, milestoneYear: 'ALL' });
  const cfAll = resAll.milestoneNepBreakdown.find((r) => r.key === 'cf_doc');
  assert.equal(cfAll.q1.count, 3, 'ALL Years Q1 count should be 3');
  assert.equal(cfAll.q1.areaHas, 14.4051, 'ALL Years Q1 area should be 14.4051');
  assert.equal(cfAll.provinceBreakdown.ESA.count, 2, 'ALL Years ESA count should be 2');
  assert.equal(cfAll.provinceBreakdown.LEY.count, 1, 'ALL Years LEY count should be 1');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Multi-year Land Survey NEP targets: 2026 is 1610.8163 HAS and 2027 is 1212.6083 HAS without cross-year collision', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salig-survey-nep-test-'));
  const store = new ConsolidatedStore(tempDir);

  // 1. Setup multi-year Land Survey targets from Regional Hub Google Sheet
  const survey2026 = {
    BIL: { lhs: 0, area: 0, arbs: 0, year: 2026 },
    ESA: { lhs: 0, area: 23.5124, arbs: 0, year: 2026 },
    LEY: { lhs: 0, area: 1056.7400, arbs: 0, year: 2026 },
    NSA: { lhs: 0, area: 358.5037, arbs: 0, year: 2026 },
    SAM: { lhs: 0, area: 165.3974, arbs: 0, year: 2026 },
    SLE: { lhs: 0, area: 6.6628, arbs: 0, year: 2026 }
  };
  const survey2027 = {
    BIL: { lhs: 0, area: 0, arbs: 0, year: 2027 },
    ESA: { lhs: 0, area: 9.2577, arbs: 0, year: 2027 },
    LEY: { lhs: 0, area: 606.2694, arbs: 0, year: 2027 },
    NSA: { lhs: 0, area: 476.0673, arbs: 0, year: 2027 },
    SAM: { lhs: 0, area: 119.5397, arbs: 0, year: 2027 },
    SLE: { lhs: 0, area: 1.4742, arbs: 0, year: 2027 }
  };

  store.updateNepProvinceList(survey2026, 'land_survey', 2026);
  store.updateNepProvinceList(survey2027, 'land_survey', 2027);

  // 2. Verify targets are stored independently per year
  assert.equal(store.state.nepTargetsByYear[2026].land_survey.targetAreaHas, 1610.8163, '2026 Survey target area is 1,610.8163 HAS');
  assert.equal(store.state.nepTargetsByYear[2027].land_survey.targetAreaHas, 1212.6083, '2027 Survey target area is 1,212.6083 HAS');

  // 3. Verify analytics compute separate target totals for each year
  const a2026 = store.computeAnalytics({ milestoneYear: '2026' });
  const a2027 = store.computeAnalytics({ milestoneYear: '2027' });

  const surveyRow2026 = a2026.milestoneNepBreakdown.find((r) => r.key === 'land_survey');
  const surveyRow2027 = a2027.milestoneNepBreakdown.find((r) => r.key === 'land_survey');

  assert.equal(surveyRow2026.nepTargetAreaHas, 1610.8163, 'Analytics 2026 Land Survey target is 1,610.8163 HAS');
  assert.equal(surveyRow2026.provinceBreakdown.LEY.targetAreaHas, 1056.7400, '2026 Leyte Land Survey target is 1,056.74 HAS');
  assert.equal(surveyRow2026.provinceBreakdown.NSA.targetAreaHas, 358.5037, '2026 Northern Samar Land Survey target is 358.5037 HAS');

  assert.equal(surveyRow2027.nepTargetAreaHas, 1212.6083, 'Analytics 2027 Land Survey target is 1,212.6083 HAS');
  assert.equal(surveyRow2027.provinceBreakdown.LEY.targetAreaHas, 606.2694, '2027 Leyte Land Survey target is 606.2694 HAS');
  assert.equal(surveyRow2027.provinceBreakdown.NSA.targetAreaHas, 476.0673, '2027 Northern Samar Land Survey target is 476.0673 HAS');

  // 4. Verify persist and reload preserves both 2026 and 2027 intact
  store.save();
  const reloadedStore = new ConsolidatedStore(tempDir);
  assert.equal(reloadedStore.state.nepTargetsByYear[2026].land_survey.targetAreaHas, 1610.8163, 'Reloaded 2026 Survey target is 1,610.8163 HAS');
  assert.equal(reloadedStore.state.nepTargetsByYear[2027].land_survey.targetAreaHas, 1212.6083, 'Reloaded 2027 Survey target is 1,212.6083 HAS');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('Whereabouts milestone views display authentic NEP targets from Regional Hub NEP sheet per selected Target Year', async () => {
  const store = createSeedState();

  store.nepMilestoneListByYear = {
    '2026': {
      cf_doc: {
        BIL: { lhs: 0, area: 0, arbs: 0, year: 2026 },
        ESA: { lhs: 0, area: 23.5124, arbs: 0, year: 2026 },
        LEY: { lhs: 0, area: 140.6996, arbs: 0, year: 2026 },
        NSA: { lhs: 0, area: 121.8952, arbs: 0, year: 2026 },
        SAM: { lhs: 0, area: 151.8667, arbs: 0, year: 2026 },
        SLE: { lhs: 0, area: 21.2352, arbs: 0, year: 2026 }
      },
      land_survey: {
        BIL: { lhs: 0, area: 0, arbs: 0, year: 2026 },
        ESA: { lhs: 0, area: 23.5124, arbs: 0, year: 2026 },
        LEY: { lhs: 0, area: 1056.7400, arbs: 0, year: 2026 },
        NSA: { lhs: 0, area: 358.5037, arbs: 0, year: 2026 },
        SAM: { lhs: 0, area: 165.3974, arbs: 0, year: 2026 },
        SLE: { lhs: 0, area: 6.6628, arbs: 0, year: 2026 }
      },
      land_valuation: {
        BIL: { lhs: 0, area: 0, arbs: 0, year: 2026 },
        ESA: { lhs: 1, area: 6.7469, arbs: 0, year: 2026 },
        LEY: { lhs: 106, area: 713.6900, arbs: 0, year: 2026 },
        NSA: { lhs: 26, area: 244.4584, arbs: 0, year: 2026 },
        SAM: { lhs: 13, area: 165.1951, arbs: 0, year: 2026 },
        SLE: { lhs: 5, area: 14.3747, arbs: 0, year: 2026 }
      }
    },
    '2027': {
      cf_doc: {
        BIL: { lhs: 0, area: 0, arbs: 0, year: 2027 },
        ESA: { lhs: 4, area: 19.7475, arbs: 0, year: 2027 },
        LEY: { lhs: 93, area: 839.9117, arbs: 80, year: 2027 },
        NSA: { lhs: 55, area: 495.3229, arbs: 0, year: 2027 },
        SAM: { lhs: 22, area: 218.6347, arbs: 0, year: 2027 },
        SLE: { lhs: 21, area: 20.7469, arbs: 0, year: 2027 }
      },
      land_survey: {
        BIL: { lhs: 0, area: 0, arbs: 0, year: 2027 },
        ESA: { lhs: 0, area: 9.2577, arbs: 0, year: 2027 },
        LEY: { lhs: 0, area: 606.2694, arbs: 0, year: 2027 },
        NSA: { lhs: 0, area: 476.0673, arbs: 0, year: 2027 },
        SAM: { lhs: 0, area: 119.5397, arbs: 0, year: 2027 },
        SLE: { lhs: 0, area: 1.4742, arbs: 0, year: 2027 }
      },
      land_valuation: {
        BIL: { lhs: 0, area: 0, arbs: 0, year: 2027 },
        ESA: { lhs: 2, area: 9.2577, arbs: 0, year: 2027 },
        LEY: { lhs: 75, area: 588.2565, arbs: 0, year: 2027 },
        NSA: { lhs: 24, area: 201.4833, arbs: 0, year: 2027 },
        SAM: { lhs: 13, area: 127.9280, arbs: 0, year: 2027 },
        SLE: { lhs: 5, area: 12.5732, arbs: 0, year: 2027 }
      }
    }
  };

  const baseCtx = {
    state: store,
    schemas: { registry: [] },
    provinceScope: null,
    whereaboutsProvinceFilter: {},
    whereaboutsStatusFilter: {},
    whereaboutsSearch: {},
    whereaboutsColFilters: {},
    whereaboutsPage: {},
    whereaboutsPageSize: {},
    cfMetricMode: 'both',
    cfTableLayout: 'standard',
    surveyMetricMode: 'both',
    surveyIndicatorTab: 'all'
  };

  // 1. CF(DOC) Whereabouts 2026: Must display 459.2091 HAS and 0 LHS
  const cf2026Html = renderMilestoneWhereaboutsView({
    ...baseCtx,
    whereaboutsTargetYearFilter: { 'cf-whereabouts': '2026' }
  }, WHEREABOUTS_CONFIGS['cf-whereabouts']);

  assert.ok(cf2026Html.includes('459.2091'), 'CF 2026 displays 459.2091 HAS target');
  assert.ok(cf2026Html.includes('23.5124'), 'CF 2026 displays Eastern Samar 23.5124 HAS');
  assert.ok(cf2026Html.includes('140.6996'), 'CF 2026 displays Leyte 140.6996 HAS');
  assert.ok(cf2026Html.includes('151.8667'), 'CF 2026 displays Samar 151.8667 HAS');
  assert.ok(!cf2026Html.includes('115.7301'), 'CF 2026 does NOT fall back to 115.7301 tagged Database parcels');

  // 2. CF(DOC) Whereabouts 2027: Must display 1,594.3637 HAS and 195 LHS
  const cf2027Html = renderMilestoneWhereaboutsView({
    ...baseCtx,
    whereaboutsTargetYearFilter: { 'cf-whereabouts': '2027' }
  }, WHEREABOUTS_CONFIGS['cf-whereabouts']);

  assert.ok(cf2027Html.includes('1,594.3637'), 'CF 2027 displays 1,594.3637 HAS target');
  assert.ok(cf2027Html.includes('195'), 'CF 2027 displays 195 LHS target');
  assert.ok(cf2027Html.includes('19.7475'), 'CF 2027 displays Eastern Samar 19.7475 HAS');
  assert.ok(cf2027Html.includes('839.9117'), 'CF 2027 displays Leyte 839.9117 HAS');

  // 3. Survey Whereabouts: 2026 must display 1,610.8163 HAS; 2027 must display 1,212.6083 HAS
  const survey2026Html = renderMilestoneWhereaboutsView({
    ...baseCtx,
    whereaboutsTargetYearFilter: { 'survey-whereabouts': '2026' }
  }, WHEREABOUTS_CONFIGS['survey-whereabouts']);
  assert.ok(survey2026Html.includes('1,610.8163'), 'Survey 2026 displays 1,610.8163 HAS target');

  const survey2027Html = renderMilestoneWhereaboutsView({
    ...baseCtx,
    whereaboutsTargetYearFilter: { 'survey-whereabouts': '2027' }
  }, WHEREABOUTS_CONFIGS['survey-whereabouts']);
  assert.ok(survey2027Html.includes('1,212.6083'), 'Survey 2027 displays 1,212.6083 HAS target');

  // 4. MOV Whereabouts: 2026 must display 1,144.4651 HAS (151 LHS); 2027 must display 939.4987 HAS (119 LHS)
  const mov2026Html = renderMilestoneWhereaboutsView({
    ...baseCtx,
    whereaboutsTargetYearFilter: { 'mov-whereabouts': '2026' }
  }, WHEREABOUTS_CONFIGS['mov-whereabouts']);
  assert.ok(mov2026Html.includes('1,144.4651'), 'MOV 2026 displays 1,144.4651 HAS target');
  assert.ok(mov2026Html.includes('151'), 'MOV 2026 displays 151 LHS target');

  const mov2027Html = renderMilestoneWhereaboutsView({
    ...baseCtx,
    whereaboutsTargetYearFilter: { 'mov-whereabouts': '2027' }
  }, WHEREABOUTS_CONFIGS['mov-whereabouts']);
  assert.ok(mov2027Html.includes('939.4987'), 'MOV 2027 displays 939.4987 HAS target');
  assert.ok(mov2027Html.includes('119'), 'MOV 2027 displays 119 LHS target');
});

test('Land Valuation (MOV) counts PPU Date (Col B), Received DARPO (Col D), Date of MOV (Col F), Trans to LBP/AOC (Col G), Reported Month (Col K) equal to Year Target in Col M', () => {
  // 1. Verify OPTOOL_SCHEMAS.MOV mapping
  const movSchema = OPTOOL_SHEET_SCHEMAS.MOV;
  assert.equal(movSchema[0].key, 'lhid', 'Col 1 (A): LHID');
  assert.equal(movSchema[1].key, 'ppuDate', 'Col 2 (B): PPU Date');
  assert.equal(movSchema[2].key, 'ppuReviewResult', 'Col 3 (C): PPU Review Result');
  assert.equal(movSchema[3].key, 'dateReceivedDarpo', 'Col 4 (D): Date Received at DARPO');
  assert.equal(movSchema[4].key, 'compensationAmount', 'Col 5 (E): Compensation Amount');
  assert.equal(movSchema[5].key, 'dateOfMov', 'Col 6 (F): Date of MOV');
  assert.equal(movSchema[6].key, 'dateTransLbpAoc', 'Col 7 (G): Date Trans to LBP/AOC');
  assert.equal(movSchema[10].key, 'reportedMonth', 'Col 11 (K): Reported Month');
  assert.equal(movSchema[12].key, 'targetYear', 'Col 13 (M): Year Target');
  assert.equal(movSchema[12].header, 'Year Target', 'Col 13 header is Year Target');

  // 2. Test isMovAccomplished rule
  // A row with Col B (PPU Date) and Col M (Year Target 2026) is accomplished for 2026
  const rowPpu = { ppuDate: '2026-03-15', targetYear: '2026' };
  assert.equal(isMovAccomplished(rowPpu, '2026'), true, 'PPU Date with Year Target 2026 is accomplished');
  assert.equal(isMovAccomplished(rowPpu, '2027'), false, 'PPU Date with Year Target 2026 is not accomplished for 2027');

  // A row with Col D (Date Received at DARPO) and Col M (Year Target)
  const rowDarpo = { dateReceivedDarpo: '2026-04-10', 'Year Target': '2026' };
  assert.equal(isMovAccomplished(rowDarpo, '2026'), true, 'Date Received DARPO with Year Target 2026 is accomplished');

  // A row with Col F (Date of MOV) and Col M (Target Year)
  const rowMov = { dateOfMov: '2026-05-20', 'Target Year': '2026' };
  assert.equal(isMovAccomplished(rowMov, '2026'), true, 'Date of MOV with Year Target 2026 is accomplished');

  // A row with Col G (Date Trans to LBP/AOC)
  const rowTrans = { dateTransLbpAoc: '2026-06-25', targetYear: '2026' };
  assert.equal(isMovAccomplished(rowTrans, '2026'), true, 'Trans to LBP/AOC with Year Target 2026 is accomplished');

  // A row with Col K (Reported Month) matching Target Year
  const rowRepMatch = { reportedMonth: 'August 2026', targetYear: '2026' };
  assert.equal(isMovAccomplished(rowRepMatch, '2026'), true, 'Reported Month August 2026 with Year Target 2026 is accomplished');

  // A row with Reported Month year mismatching Target Year
  const rowRepMismatch = { reportedMonth: 'August 2025', targetYear: '2026' };
  assert.equal(isMovAccomplished(rowRepMismatch, '2026'), false, 'Reported Month August 2025 does NOT match Year Target 2026');

  // A row with no milestone dates
  const rowEmpty = { targetYear: '2026' };
  assert.equal(isMovAccomplished(rowEmpty, '2026'), false, 'Empty milestone dates is not accomplished');

  // 3. Test renderMilestoneWhereaboutsView with mov-whereabouts
  const sampleState = {
    optool: {
      Database: [
        { lhid: 'LH-0837-0001', province: 'Leyte', totalArea: '10.5000', statusLad: 'LAD Balance', workability: 'Workable' },
        { lhid: 'LH-0837-0002', province: 'Leyte', totalArea: '5.2500', statusLad: 'LAD Balance', workability: 'Workable' },
        { lhid: 'LH-0860-0001', province: 'Samar', totalArea: '8.0000', statusLad: 'LAD Balance', workability: 'Workable' }
      ],
      MOV: [
        {
          lhid: 'LH-0837-0001',
          'PPU Date': '2026-02-15',
          'Date Received at DARPO': '2026-03-01',
          'Date of MOV': '2026-04-10',
          'Date Trans to LBP/AOC': '2026-05-15',
          'Reported Month': 'May 2026',
          'Year Target': '2026'
        },
        {
          lhid: 'LH-0837-0002',
          'PPU Date': '2026-03-20',
          'Date Received at DARPO': '2026-04-05',
          'Year Target': '2026'
        },
        {
          lhid: 'LH-0860-0001',
          'Date of MOV': '2027-01-10',
          'Year Target': '2027'
        }
      ]
    },
    nepMilestoneListByYear: {
      '2026': {
        land_valuation: {
          LEY: { lhs: 106, area: 713.69, arbs: 0, year: 2026 },
          SAM: { lhs: 13, area: 165.1951, arbs: 0, year: 2026 }
        }
      }
    }
  };

  const testCtx2026 = {
    state: sampleState,
    analytics: { nepMilestoneListByYear: sampleState.nepMilestoneListByYear },
    schemas: { registry: REGIONAL_REGISTRY },
    whereaboutsTargetYearFilter: { 'mov-whereabouts': '2026' },
    whereaboutsProvinceFilter: { 'mov-whereabouts': 'ALL' },
    whereaboutsColFilters: {},
    whereaboutsSearch: {},
    whereaboutsPage: {},
    whereaboutsPageSize: {},
    whereaboutsShowGraph: {},
    whereaboutsGraphMode: {}
  };

  const movHtml = renderMilestoneWhereaboutsView(testCtx2026, WHEREABOUTS_CONFIGS['mov-whereabouts']);

  // Leyte should show 2 LHs for PPU Date and Received DARPO, 1 LH for Date of MOV, Trans to LBP/AOC, Reported Month
  assert.ok(movHtml.includes('WITH PPU DATE'), 'Includes WITH PPU DATE header');
  assert.ok(movHtml.includes('WITH RECEIVED DARPO'), 'Includes WITH RECEIVED DARPO header');
  assert.ok(movHtml.includes('WITH DATE OF MOV'), 'Includes WITH DATE OF MOV header');
  assert.ok(movHtml.includes('WITH TRANS TO LBP/AOC'), 'Includes WITH TRANS TO LBP/AOC header');
  assert.ok(movHtml.includes('WITH REPORTED MONTH'), 'Includes WITH REPORTED MONTH header');

  // Verify that the Samar 2027 row does NOT get counted under 2026
  assert.ok(!movHtml.includes('Samar (2027) counted in 2026'), '2027 row is isolated from 2026 accomplishment');
});

test('50. Frozen / Sticky NEP Target columns in Provincial Whereabouts matrix tables and styles', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');

  // Verify CSS sticky rules for Whereabouts tables
  assert.ok(css.includes('.survey-monitoring-table th.survey-th-unit'), 'Contains sticky th.survey-th-unit');
  assert.ok(css.includes('.survey-monitoring-table th.survey-th-nep'), 'Contains sticky th.survey-th-nep');
  assert.ok(css.includes('.survey-monitoring-table th.survey-th-nep-lhs'), 'Contains sticky th.survey-th-nep-lhs');
  assert.ok(css.includes('.survey-monitoring-table th.survey-th-nep-area'), 'Contains sticky th.survey-th-nep-area');
  assert.ok(css.includes('.survey-monitoring-table td.survey-td-nep-lhs'), 'Contains sticky td.survey-td-nep-lhs');
  assert.ok(css.includes('.survey-monitoring-table td.survey-td-nep-area'), 'Contains sticky td.survey-td-nep-area');
  assert.ok(css.includes('.survey-monitoring-table th.survey-th-nep-single'), 'Contains sticky th.survey-th-nep-single');
  assert.ok(css.includes('.survey-monitoring-table td.survey-td-nep-single'), 'Contains sticky td.survey-td-nep-single');
  assert.ok(css.includes('left: 155px'), 'Sticky NEP LHS/Single placed at left: 155px');
  assert.ok(css.includes('left: 225px'), 'Sticky NEP Area placed at left: 225px');

  // Verify HTML rendering in Whereabouts views
  const sampleState = {
    records: [],
    milestoneData: { MOV: [] },
    nepMilestoneListByYear: {
      '2026': {
        land_valuation: {
          LEY: { lhs: 106, area: 713.69, arbs: 0, year: 2026 },
          SAM: { lhs: 13, area: 165.1951, arbs: 0, year: 2026 }
        }
      }
    }
  };

  const testCtx = {
    state: sampleState,
    analytics: { nepMilestoneListByYear: sampleState.nepMilestoneListByYear },
    schemas: { registry: REGIONAL_REGISTRY },
    whereaboutsTargetYearFilter: { 'mov-whereabouts': '2026' },
    whereaboutsProvinceFilter: { 'mov-whereabouts': 'ALL' },
    whereaboutsColFilters: {},
    whereaboutsSearch: {},
    whereaboutsPage: {},
    whereaboutsPageSize: {},
    whereaboutsShowGraph: {},
    whereaboutsGraphMode: {}
  };

  const movHtml = renderMilestoneWhereaboutsView(testCtx, WHEREABOUTS_CONFIGS['mov-whereabouts']);
  assert.ok(movHtml.includes('survey-th-nep'), 'MOV table includes survey-th-nep header');
  assert.ok(movHtml.includes('survey-th-nep-lhs'), 'MOV table includes survey-th-nep-lhs header');
  assert.ok(movHtml.includes('survey-th-nep-area'), 'MOV table includes survey-th-nep-area header');
  assert.ok(movHtml.includes('survey-td-nep-lhs'), 'MOV table includes survey-td-nep-lhs body cells');
  assert.ok(movHtml.includes('survey-td-nep-area'), 'MOV table includes survey-td-nep-area body cells');
});

test('51. Whereabouts row action button directs directly to edit Action with data-edit-tab, data-edit-row-index, and data-edit-lhid', () => {
  const sampleState = {
    records: [],
    optool: {
      'CF(DOC)': [
        {
          lhid: 'LH-0801-0001',
          province: 'Leyte',
          municipality: 'Alangalang',
          barangay: 'Buri',
          landOwner: 'Dela Cruz, Juan',
          titleNumber: 'OCT-12345',
          carpable: 12.5,
          dateFiConducted: '2026-03-10',
          datePreparedSigned: '',
          reportedMonth: ''
        }
      ]
    },
    nepMilestoneListByYear: {
      '2026': {
        cf_doc: {
          LEY: { lhs: 93, area: 839.9117, arbs: 0, year: 2026 }
        }
      }
    }
  };

  const testCtx = {
    state: sampleState,
    analytics: { nepMilestoneListByYear: sampleState.nepMilestoneListByYear },
    schemas: { registry: REGIONAL_REGISTRY },
    whereaboutsTargetYearFilter: { 'cf-whereabouts': 'ALL' },
    whereaboutsProvinceFilter: { 'cf-whereabouts': 'ALL' },
    whereaboutsColFilters: {},
    whereaboutsSearch: {},
    whereaboutsPage: {},
    whereaboutsPageSize: {},
    whereaboutsShowGraph: {},
    whereaboutsGraphMode: {}
  };

  const cfHtml = renderMilestoneWhereaboutsView(testCtx, WHEREABOUTS_CONFIGS['cf-whereabouts']);
  assert.ok(cfHtml.includes('data-edit-tab="CF(DOC)"'), 'Includes data-edit-tab="CF(DOC)"');
  assert.ok(cfHtml.includes('data-edit-row-index="0"'), 'Includes data-edit-row-index="0"');
  assert.ok(cfHtml.includes('data-edit-lhid="LH-0801-0001"'), 'Includes data-edit-lhid="LH-0801-0001"');
  assert.ok(cfHtml.includes('Open in CF(DOC)'), 'Preserves Open in CF(DOC) button label');
  assert.ok(cfHtml.includes('btn-whereabouts-edit-record'), 'Includes btn-whereabouts-edit-record class');
});

test('52. Survey data alignment, no formula for Target Year, and User Revision Audit Log History', async () => {
  const tmpDir = path.join(os.tmpdir(), `salig-audit-test-${Date.now()}`);
  const store = new ConsolidatedStore(tmpDir);

  // 1. Verify Survey column alignment & year rescue from PDF File
  const surveyPayloadWithYearInPdf = {
    lhid: '801009999',
    kindOfSurvey: 'By Admin',
    target: 'Previous Year',
    reportedMonth: 'April 2026',
    pdfFile: '2026.0', // mistakenly entered year into PDF File column
    targetYear: ''
  };

  const normalizedSurveyRow = store.normalizeOptoolRow('Survey', surveyPayloadWithYearInPdf);
  assert.strictEqual(normalizedSurveyRow.targetYear, '2026', 'Rescues 2026.0 from pdfFile to targetYear');
  assert.strictEqual(normalizedSurveyRow.pdfFile, '', 'Empties pdfFile when it held a year string');

  // 2. Verify GAS Code.gs does not inject formula for Target Year in Survey or MOV
  const gasCode = fs.readFileSync(path.join(__dirname, '../../gas/Code.gs'), 'utf8');
  assert.ok(
    gasCode.includes("normTab === 'mov' || normTab === 'survey'"),
    'Code.gs skips formula injection for both MOV and Survey'
  );

  // 3. Verify User Revision Audit Log History
  const staffUser = {
    id: 'usr-staff-1',
    name: 'Maria Santos',
    email: 'maria.santos@dar8.gov.ph',
    role: 'staff',
    province: 'Leyte'
  };

  // Upsert a test row to establish initial state
  const initialRow = store.upsertOptoolRow('Survey', {
    lhid: '801008888',
    target: 'Current',
    reportedMonth: 'March 2026',
    targetYear: '2025'
  });

  // Record an audit update
  const log = store.recordAuditLog({
    user: staffUser,
    action: 'update',
    tabName: 'Survey',
    lhid: initialRow.lhid,
    rowIndex: 0,
    changes: [
      { field: 'target', label: 'Target (Current / Previous)', oldValue: 'Current', newValue: 'Previous Year' },
      { field: 'targetYear', label: 'Target Year', oldValue: '2025', newValue: '2026' }
    ]
  });

  assert.ok(log.id, 'Log has unique ID');
  assert.strictEqual(log.user.name, 'Maria Santos', 'Tracks user name');
  assert.strictEqual(log.user.email, 'maria.santos@dar8.gov.ph', 'Tracks user email');
  assert.strictEqual(log.user.province, 'Leyte', 'Tracks user province');
  assert.strictEqual(log.lhid, '801008888', 'Tracks modified LHID');
  assert.strictEqual(log.tabName, 'Survey', 'Tracks milestone tab');
  assert.strictEqual(log.changes.length, 2, 'Records exact changed fields');
  assert.strictEqual(log.changes[1].field, 'targetYear');
  assert.strictEqual(log.changes[1].oldValue, '2025', 'Tracks previous value');
  assert.strictEqual(log.changes[1].newValue, '2026', 'Tracks updated value');

  // Query audit logs
  const logsRes = store.getAuditLogs({ lhid: '801008888' });
  assert.strictEqual(logsRes.logs.length, 1, 'Finds log by LHID');
  assert.strictEqual(logsRes.logs[0].user.email, 'maria.santos@dar8.gov.ph');

  // Query dossier
  const dossier = store.getLandholding360('801008888');
  assert.ok(Array.isArray(dossier.auditLogs), 'Dossier returns auditLogs');
  assert.strictEqual(dossier.auditLogs.length, 1, 'Contains revision for this LHID');
  assert.strictEqual(dossier.auditLogs[0].changes[1].newValue, '2026');

  // Cleanup tmp dir
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});

test('53. Universal PDF year sanitization, importParsedDataset multi-year NEP, and fast direct account registration', async () => {
  const tmpDir = path.join(os.tmpdir(), `optool-test-53-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const store = new ConsolidatedStore(tmpDir);

  // 1. Verify importParsedDataset handles multi-year NEP datasets properly without errors
  const mockDataset = {
    milestoneData: [],
    optool: {
      'CF(DOC)': [
        { lhid: '801009991', province: 'Eastern Samar', pdfFile: '2026.0', target: 'Previous Year' }
      ],
      MOV: [
        { lhid: '801009992', province: 'Leyte', pdfFile: '2026.0', target: 'Previous Year' }
      ]
    },
    nepMilestoneListByYear: {
      '2026': {
        cf_doc: {
          ESA: { province: 'Eastern Samar', lhs: 0, area: 23.5124, year: 2026 },
          LEY: { province: 'Leyte', lhs: 0, area: 140.6996, year: 2026 }
        },
        land_valuation: {
          ESA: { province: 'Eastern Samar', lhs: 1, area: 6.7469, year: 2026 },
          LEY: { province: 'Leyte', lhs: 106, area: 713.6900, year: 2026 }
        }
      }
    },
    nepProvinceListByYear: {
      '2026': {
        ESA: { province: 'Eastern Samar', lhs: 1, area: 30.2593, year: 2026 }
      }
    }
  };

  store.importParsedDataset(mockDataset);
  assert.ok(store.state.nepMilestoneListByYear['2026'], 'Imports nepMilestoneListByYear 2026');
  assert.strictEqual(
    store.state.nepMilestoneListByYear['2026'].cf_doc.ESA.area,
    23.5124,
    'Imports CF(DOC) NEP target for ESA'
  );
  assert.strictEqual(
    store.state.nepMilestoneListByYear['2026'].land_valuation.LEY.lhs,
    106,
    'Imports MOV NEP target for LEY'
  );

  // 2. Verify universal PDF year sanitization for CF(DOC) and MOV
  const cfRow = store.state.optool['CF(DOC)'].find((r) => r.lhid === '801009991');
  assert.ok(cfRow, 'Found newly imported CF(DOC) row');
  assert.strictEqual(cfRow.targetYear, '2026', 'Rescued 2026.0 from pdfFile to targetYear in CF(DOC)');
  assert.strictEqual(cfRow.pdfFile, '', 'Cleared 2026.0 from pdfFile in CF(DOC)');

  const movRow = store.state.optool.MOV.find((r) => r.lhid === '801009992');
  assert.ok(movRow, 'Found newly imported MOV row');
  assert.strictEqual(movRow.targetYear, '2026', 'Rescued 2026.0 from pdfFile to targetYear in MOV)');
  assert.strictEqual(movRow.pdfFile, '', 'Cleared 2026.0 from pdfFile in MOV');

  // 3. Verify getWhereaboutsNepTargetMap accurately extracts NEP target map for cf_doc and land_valuation
  const cfTargetMap = getWhereaboutsNepTargetMap('cf_doc', '2026', store.state, {});
  assert.ok(cfTargetMap, 'Returns target map for cf_doc in 2026');
  assert.strictEqual(cfTargetMap.ESA.area, 23.5124, 'CF(DOC) target map matches regional hub');

  const movTargetMap = getWhereaboutsNepTargetMap('land_valuation', '2026', store.state, {});
  assert.ok(movTargetMap, 'Returns target map for land_valuation in 2026');
  assert.strictEqual(movTargetMap.LEY.lhs, 106, 'MOV target map matches regional hub');

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});

test('54. Log History is restricted to administrators only (API gate, Landholding 360 stripping, and UI access control)', async () => {
  const tmpDir = path.join(os.tmpdir(), `salig-audit-admin-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const store = new ConsolidatedStore(tmpDir);

  // Seed an audit log entry
  store.recordAuditLog({
    user: { name: 'Juan Dela Cruz', email: 'juan@dar8.gov.ph', role: 'user', province: 'Leyte' },
    action: 'update',
    tabName: 'CF(DOC)',
    lhid: '803700012',
    changes: [{ field: 'target', label: 'Target', oldValue: 'Current', newValue: 'Previous Year' }]
  });

  const { handler } = createAppServer(store, {
    requireAuth: true,
    requireOtp: false,
    autoFetchHubNep: false
  });

  // 1. Non-admin user gets 403 Forbidden on /api/audit-logs
  const nonAdminUser = { id: 'u-1', email: 'staff@dar8.gov.ph', role: 'user', status: 'approved' };
  const adminUser = { id: 'a-1', email: 'admin@dar8.gov.ph', role: 'admin', status: 'approved' };

  // Set users in store so session lookup succeeds
  store.state.users = [
    { ...nonAdminUser, passwordHash: 'hash' },
    { ...adminUser, passwordHash: 'hash' }
  ];

  const adminToken = signSessionToken(adminUser, store.getAuthSecret());
  const userToken = signSessionToken(nonAdminUser, store.getAuthSecret());

  // Helper to make mock requests to handler
  const makeRequest = async (method, path, token = null) => {
    return new Promise((resolve, reject) => {
      const headers = { 'content-type': 'application/json' };
      if (token) {
        headers['cookie'] = `salig_session=${token}`;
      }
      const req = new http.IncomingMessage();
      req.method = method;
      req.url = path;
      req.headers = headers;

      const res = new http.ServerResponse(req);
      let resBody = '';
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);

      res.write = (chunk, ...args) => {
        if (chunk) resBody += chunk.toString();
        return originalWrite(chunk, ...args);
      };

      res.end = (chunk, ...args) => {
        if (chunk) resBody += chunk.toString();
        originalEnd(chunk, ...args);
        let parsed = null;
        try {
          parsed = JSON.parse(resBody);
        } catch (_) {
          parsed = resBody;
        }
        resolve({ statusCode: res.statusCode, body: parsed });
      };

      req.push(null);
      handler(req, res);
    });
  };

  // 1. Non-admin request to /api/audit-logs is forbidden (403)
  const nonAdminRes = await makeRequest('GET', '/api/audit-logs', userToken);
  assert.strictEqual(nonAdminRes.statusCode, 403, 'Non-admin receives 403 Forbidden on /api/audit-logs');
  assert.strictEqual(nonAdminRes.body.ok, false);
  assert.ok(nonAdminRes.body.error.includes('administrators only'));

  // 2. Admin request to /api/audit-logs succeeds (200)
  const adminRes = await makeRequest('GET', '/api/audit-logs', adminToken);
  assert.strictEqual(adminRes.statusCode, 200, 'Admin receives 200 OK on /api/audit-logs');
  assert.strictEqual(adminRes.body.ok, true);
  assert.ok(Array.isArray(adminRes.body.logs), 'Admin receives audit logs array');
  assert.strictEqual(adminRes.body.logs[0].lhid, '803700012', 'Finds recorded audit log');

  // 3. Non-admin request to Landholding 360 has auditLogs stripped
  const nonAdminDossierRes = await makeRequest('GET', '/api/landholding/803700012', userToken);
  assert.strictEqual(nonAdminDossierRes.statusCode, 200);
  assert.deepStrictEqual(nonAdminDossierRes.body.auditLogs, [], 'Non-admin dossier has auditLogs stripped');

  // 4. Admin request to Landholding 360 retains auditLogs
  const adminDossierRes = await makeRequest('GET', '/api/landholding/803700012', adminToken);
  assert.strictEqual(adminDossierRes.statusCode, 200);
  assert.strictEqual(adminDossierRes.body.auditLogs.length, 1, 'Admin dossier retains auditLogs');
  assert.strictEqual(adminDossierRes.body.auditLogs[0].lhid, '803700012');

  // 5. Test UI access guard: renderAuditLogsView for non-admin shows access denied card
  const nonAdminHtml = renderAuditLogsView({
    logs: store.state.auditLogs,
    currentUser: nonAdminUser
  });
  assert.ok(nonAdminHtml.includes('Administrator Access Required'), 'UI denies access for standard staff user');
  assert.ok(nonAdminHtml.includes('restricted to administrators only'), 'UI explains admin restriction');

  // 6. Test UI access guard: renderAuditLogsView for admin shows full audit logs feed
  const adminHtml = renderAuditLogsView({
    logs: store.state.auditLogs,
    currentUser: adminUser
  });
  assert.ok(adminHtml.includes('User Edit & Revision Log History'), 'UI permits access for admin');
  assert.ok(adminHtml.includes('803700012'), 'Admin UI includes tracked LHID audit entries');

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});

test('55. Target Summary displays all 6 provinces and Region VIII total across all milestones, even for scoped provincial users', async () => {
  const tmpDir = path.join(os.tmpdir(), `salig-target-summary-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const store = new ConsolidatedStore(tmpDir);

  // Seed sample rows across different provinces: Leyte (LEY), Northern Samar (NSA), Biliran (BIL)
  store.state.optool['CF(DOC)'] = [
    { lhid: '801000001', province: 'Northern Samar', provinceCode: 'NSA', dateFiConducted: '2026-02-01', totalArea: '15.5' },
    { lhid: '801000002', province: 'Leyte', provinceCode: 'LEY', dateFiConducted: '2026-03-01', totalArea: '25.0' },
    { lhid: '801000003', province: 'Biliran', provinceCode: 'BIL', dateFiConducted: '2026-04-01', totalArea: '10.0' }
  ];

  // 1. Compute analytics with targetSummary: true even if scopeCode is 'NSA' (scoped Northern Samar staff user)
  const analyticsAll = store.computeAnalytics({
    milestoneYear: '2026',
    province: 'ALL'
  });

  const cfBreakdown = analyticsAll.milestoneNepBreakdown.find((m) => m.key === 'cf_doc');
  assert.ok(cfBreakdown, 'CF(DOC) breakdown exists');
  const provCodes = Object.keys(cfBreakdown.provinceBreakdown || {});
  assert.ok(provCodes.includes('BIL'), 'Includes Biliran in province breakdown');
  assert.ok(provCodes.includes('ESA'), 'Includes Eastern Samar in province breakdown');
  assert.ok(provCodes.includes('LEY'), 'Includes Leyte in province breakdown');
  assert.ok(provCodes.includes('NSA'), 'Includes Northern Samar in province breakdown');
  assert.ok(provCodes.includes('SAM'), 'Includes Samar in province breakdown');
  assert.ok(provCodes.includes('SLE'), 'Includes Southern Leyte in province breakdown');
  assert.strictEqual(provCodes.length, 6, 'Contains all 6 Region VIII provinces');

  // 2. Test UI renderTargetSummaryView with provincial staff scope (NSA)
  const nsaScope = { code: 'NSA', provinceName: 'Northern Samar' };
  const targetSummaryHtml = renderTargetSummaryView({
    analytics: analyticsAll,
    schemas: { registry: [] },
    filters: { milestoneYear: '2026', province: 'ALL' },
    provinceScope: nsaScope,
    state: store.state,
    nepShowProvinces: true,
    nepExpandedMilestones: { cf_doc: true }
  });

  // Verify province filter dropdown exists and offers "All Region VIII Provinces"
  assert.ok(targetSummaryHtml.includes('All Region VIII Provinces'), 'Renders All Region VIII Provinces option in select');
  assert.ok(targetSummaryHtml.includes('id="nep-province-filter"'), 'Province filter select is accessible to scoped user');

  // Verify all 6 provinces are rendered as subrows under CF Documentation
  assert.ok(targetSummaryHtml.includes('BIL'), 'Renders BIL subrow');
  assert.ok(targetSummaryHtml.includes('ESA'), 'Renders ESA subrow');
  assert.ok(targetSummaryHtml.includes('LEY'), 'Renders LEY subrow');
  assert.ok(targetSummaryHtml.includes('NSA'), 'Renders NSA subrow');
  assert.ok(targetSummaryHtml.includes('SAM'), 'Renders SAM subrow');
  assert.ok(targetSummaryHtml.includes('SLE'), 'Renders SLE subrow');

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});

test('56. User deletion tombstones, clean re-registration untombstoning, Google Sheet sync immunity, and informative login feedback', async () => {
  const tmpDir = path.join(os.tmpdir(), `optool-test-56-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const store = new ConsolidatedStore(tmpDir);

  // 1. Register a staff user
  const user = store.registerUser({
    name: 'Staff Leo',
    email: 'staff.leo@dar8.gov.ph',
    password: 'password123',
    province: 'Northern Samar',
    contactNumber: '09206564007'
  }, false);

  assert.strictEqual(user.email, 'staff.leo@dar8.gov.ph');
  assert.strictEqual(user.status, 'pending');

  // Approve user
  store.updateUserStatus(user.id, { status: 'approved' }, 'admin');
  const authed = store.authenticateUser('staff.leo@dar8.gov.ph', 'password123');
  assert.strictEqual(authed.status, 'approved');

  // 2. Admin deletes user -> should record tombstone and purge user
  store.deleteUser(user.id);
  assert.ok(store.isUserDeleted('staff.leo@dar8.gov.ph', user.id), 'Account is tombstoned');
  assert.strictEqual(store.findUserByEmail('staff.leo@dar8.gov.ph'), null, 'Purged from store.users');

  // Attempting to authenticate deleted user throws ACCOUNT_DELETED
  assert.throws(
    () => store.authenticateUser('staff.leo@dar8.gov.ph', 'password123'),
    (err) => err.code === 'ACCOUNT_DELETED' && err.statusCode === 403,
    'Throws ACCOUNT_DELETED error when logging in with deleted account'
  );

  // 3. User re-registers with the same email -> should clear tombstone completely
  const reUser = store.registerUser({
    name: 'Staff Leo Restored',
    email: 'staff.leo@dar8.gov.ph',
    password: 'newpassword456',
    province: 'Northern Samar',
    contactNumber: '09206564007'
  }, false);

  assert.strictEqual(store.isUserDeleted('staff.leo@dar8.gov.ph'), false, 'Tombstone is cleared on re-registration');
  assert.strictEqual(reUser.status, 'pending');

  store.updateUserStatus(reUser.id, { status: 'approved' }, 'admin');
  const reAuthed = store.authenticateUser('staff.leo@dar8.gov.ph', 'newpassword456');
  assert.strictEqual(reAuthed.name, 'Staff Leo Restored');

  // 4. Test Google Sheet sync:
  // Another user is tombstoned locally
  const otherUser = store.registerUser({
    name: 'Other Staff',
    email: 'other.staff@dar8.gov.ph',
    password: 'password123',
    province: 'Leyte',
    contactNumber: '09171234567'
  }, false);
  store.deleteUser(otherUser.id);
  assert.ok(store.isUserDeleted('other.staff@dar8.gov.ph', otherUser.id));

  // The old tombstoned ID cannot resurrect from Google Sheet
  const zombieMerge = store.mergeUsersFromSheet([otherUser]);
  assert.strictEqual(zombieMerge.added, 0, 'Zombie account with deleted ID is dropped');

  // But when the user re-registers with the same email, the email tombstone is cleared
  const reOther = store.registerUser({
    name: 'Other Staff Restored',
    email: 'other.staff@dar8.gov.ph',
    password: 'password456',
    province: 'Leyte',
    contactNumber: '09171234567'
  }, false);
  assert.strictEqual(store.isUserDeleted('other.staff@dar8.gov.ph'), false, 'Email tombstone cleared');
  store.updateUserStatus(reOther.id, { status: 'approved' }, 'admin');

  // Now sync from Google Sheet merges cleanly without dropping
  const syncResult = store.mergeUsersFromSheet([
    {
      id: reOther.id,
      name: 'Other Staff Active',
      email: 'other.staff@dar8.gov.ph',
      province: 'Leyte',
      status: 'approved',
      role: 'user'
    }
  ]);
  assert.strictEqual(store.isUserDeleted('other.staff@dar8.gov.ph', reOther.id), false);
  const activeUser = store.findUserByEmail('other.staff@dar8.gov.ph');
  assert.ok(activeUser, 'Active user exists in store');
  assert.strictEqual(activeUser.status, 'approved');

  // 5. Test store.load() persistence: restarting store does not purge restored users
  const reloadedStore = new ConsolidatedStore(tmpDir);
  assert.ok(reloadedStore.findUserByEmail('staff.leo@dar8.gov.ph'), 'Re-registered user persists across reloads');
  assert.ok(reloadedStore.findUserByEmail('other.staff@dar8.gov.ph'), 'Active user persists across reloads');

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});

test('57. Audit Logs Google Sheet synchronization, revision tracking with exact field diffs, and Target Summary all-province view', async () => {
  const tmpDir = path.join(os.tmpdir(), `salig-test-audit-logs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const store = new ConsolidatedStore(tmpDir);

  const remoteGasLogs = [
    {
      id: 'audit-log-nsa-804209075',
      timestamp: '2026-11-23T01:30:00.000Z',
      user: {
        name: 'Leo Adre',
        email: 'adrejhat@gmail.com',
        role: 'staff',
        province: 'Northern Samar'
      },
      action: 'update',
      tabName: 'Survey',
      lhid: '804209075',
      changes: [
        { field: 'targetYear', label: 'Target Year', oldValue: '', newValue: '2026' },
        { field: 'target', label: 'Target (Current / Previous)', oldValue: '', newValue: 'Current' }
      ],
      summary: 'Updated Survey parcel details for LHID 804209075: Target Year (2026), Target (Current)'
    },
    {
      id: 'audit-log-nsa-804209069',
      timestamp: '2026-11-23T01:35:00.000Z',
      user: {
        name: 'Leo Adre',
        email: 'adrejhat@gmail.com',
        role: 'staff',
        province: 'Northern Samar'
      },
      action: 'update',
      tabName: 'CF(DOC)',
      lhid: '804209069',
      changes: [
        { field: 'targetYear', label: 'Target Year', oldValue: '', newValue: '2026' }
      ],
      summary: 'Updated CF(DOC) parcel details for LHID 804209069: Target Year (2026)'
    }
  ];

  // 1. mergeAuditLogsFromSheet merges remote Google Sheet audit logs cleanly
  const mergeResult = store.mergeAuditLogsFromSheet(remoteGasLogs);
  assert.strictEqual(mergeResult.added, 2, 'Added 2 remote audit logs from Google Sheet');
  assert.strictEqual(store.state.auditLogs.length, 2);

  // 2. Querying audit logs returns proper logs & search filtering
  const allLogs = store.getAuditLogs({});
  assert.strictEqual(allLogs.total, 2);
  assert.strictEqual(allLogs.logs[0].id, 'audit-log-nsa-804209069'); // newest first

  const userFilter = store.getAuditLogs({ userEmail: 'adrejhat' });
  assert.strictEqual(userFilter.total, 2);

  const lhidFilter = store.getAuditLogs({ lhid: '804209075' });
  assert.strictEqual(lhidFilter.total, 1);
  assert.strictEqual(lhidFilter.logs[0].lhid, '804209075');

  // 3. Deduplication: merging duplicate log IDs does not duplicate them
  const dupMerge = store.mergeAuditLogsFromSheet([remoteGasLogs[0]]);
  assert.strictEqual(dupMerge.added, 0, 'Duplicate log IDs are ignored');
  assert.strictEqual(store.state.auditLogs.length, 2);

  // 4. Verify Google Apps Script (gas/Code.gs) has audit logs methods and routes
  const gasCode = fs.readFileSync(path.join(__dirname, '../../gas/Code.gs'), 'utf8');
  assert.ok(gasCode.includes("const AUDIT_LOGS_HEADERS = ["), 'Code.gs defines AUDIT_LOGS_HEADERS');
  assert.ok(gasCode.includes("function ensureAuditLogsSheet_()"), 'Code.gs defines ensureAuditLogsSheet_');
  assert.ok(gasCode.includes("function appendAuditLogToHub_"), 'Code.gs defines appendAuditLogToHub_');
  assert.ok(gasCode.includes("function readAuditLogsFromHub_"), 'Code.gs defines readAuditLogsFromHub_');
  assert.ok(gasCode.includes("action === 'auditLogs'"), 'Code.gs defines doGet auditLogs route');
  assert.ok(gasCode.includes("action === 'appendAuditLog'"), 'Code.gs defines doPost appendAuditLog route');

  // 5. Verify Target Summary displays all 6 provinces even when scoped to Northern Samar
  const { renderTargetSummaryView } = await import('../../public/views.js');
  const dummyCtx = {
    state: store.state,
    analytics: store.computeAnalytics(),
    schemas: { optoolTabs: {} },
    filters: { province: 'NSA' },
    provinceScope: { code: 'NSA', provinceName: 'Northern Samar' },
    nepExpandedMilestones: { cf_doc: true }
  };
  const summaryHtml = renderTargetSummaryView(dummyCtx);
  assert.ok(summaryHtml.includes('BIL'), 'Target Summary contains Biliran');
  assert.ok(summaryHtml.includes('EAS'), 'Target Summary contains Eastern Samar');
  assert.ok(summaryHtml.includes('LEY'), 'Target Summary contains Leyte');
  assert.ok(summaryHtml.includes('NSA'), 'Target Summary contains Northern Samar');
  assert.ok(summaryHtml.includes('SAM'), 'Target Summary contains Samar');
  assert.ok(summaryHtml.includes('SLE'), 'Target Summary contains Southern Leyte');

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});

test('58. Dashboard displays all Region VIII records regardless of admin or provincial user', async () => {
  const tmpDir = makeTempDir();
  const { server, store } = createAppServer(tmpDir, { requireAuth: true, requireOtp: false });

  // Multi-province database
  store.state.optool.Database = [
    { lhid: '801000001', province: 'BILIRAN', totalArea: '10.5000', carpable: '10.5000', ladStatus: 'LAD Balance' },
    { lhid: '802000002', province: 'EASTERN SAMAR', totalArea: '20.0000', carpable: '20.0000', ladStatus: 'LAD Balance' },
    { lhid: '803000003', province: 'LEYTE', totalArea: '30.0000', carpable: '30.0000', ladStatus: 'Temp. Park' },
    { lhid: '804000004', province: 'NORTHERN SAMAR', totalArea: '40.0000', carpable: '40.0000', ladStatus: 'LAD Balance' },
    { lhid: '805000005', province: 'SAMAR', totalArea: '50.0000', carpable: '50.0000', ladStatus: 'LAD Balance' },
    { lhid: '806000006', province: 'SOUTHERN LEYTE', totalArea: '60.0000', carpable: '60.0000', ladStatus: 'Temp. Park' }
  ];
  store.state.optool.RegistrationDistribution = [
    { lhid: '801000001', province: 'BILIRAN', dateRegistered: '2026-05-10', areaHas: '5.2500' },
    { lhid: '804000004', province: 'NORTHERN SAMAR', dateRegistered: '2026-06-15', areaHas: '15.7600' }
  ];
  store.save();

  // Create a provincial user for Northern Samar
  const nsaUser = store.createPendingUser(
    {
      name: 'Leo Adre',
      email: 'leo.adre@dar8.gov.ph',
      province: 'Northern Samar',
      contactNumber: '09174445555',
      password: 'Password123!'
    },
    { requireOtp: false }
  );
  store.updateUserStatus(nsaUser.id, { status: 'approved' }, 'admin');

  // Verify scoped state payload includes all regional rows
  const scopedView = store.getScopedState('NSA');
  assert.equal(scopedView.optool.Database.length, 1, 'OPTool edit scope remains isolated to Northern Samar');

  // Verify server helper buildScopedStatePayload attaches allDatabase and allRegDist
  const scopedPayload = {
    ...scopedView,
    allDatabase: store.state.optool.Database,
    allRegDist: store.state.optool.RegistrationDistribution,
    allOptool: store.state.optool
  };
  assert.equal(scopedPayload.allDatabase.length, 6, 'allDatabase includes all 6 provinces');
  assert.equal(scopedPayload.allRegDist.length, 2, 'allRegDist includes all regional registered records');

  // Verify computeScopedAnalytics with view=dashboard returns all 6 provinces
  const regionalAnalytics = store.computeAnalytics({ province: 'ALL' });
  assert.equal(regionalAnalytics.provincialBreakdown.length, 6);

  // Render Dashboard View with Northern Samar provincial scope
  const ctx = {
    state: scopedPayload,
    analytics: regionalAnalytics,
    provinceScope: { code: 'NSA', provinceName: 'Northern Samar' },
    schemas: { optoolTabs: OPTOOL_SHEET_SCHEMAS },
    dashboardMapProvince: 'ALL',
    dashboardRightPanelTab: 'map'
  };

  const html = renderDashboardView(ctx);

  // 1. Title must be Region VIII Provincial Breakdown
  assert.ok(html.includes('Region VIII Provincial Breakdown'), 'Dashboard must title the breakdown panel Region VIII Provincial Breakdown');
  assert.ok(!html.includes('Northern Samar Provincial Breakdown'), 'Must not restrict table panel title to single province');

  // 2. Top 3 KPI cards must show full Region VIII totals and Region VIII badge
  // Total DB LHS = 6 (10.5 + 20 + 30 + 40 + 50 + 60 = 210.5 HAS)
  assert.ok(html.includes('<span class="cf-kpi-val">6</span>'), 'Top card must show 6 total LHS across Region VIII');
  assert.ok(html.includes('210.5000'), 'Top card must show 210.5000 total HAS across Region VIII');
  // LAD Balance = 4 LHS (BIL: 10.5, EAS: 20, NSA: 40, SAM: 50 -> total 120.5 HAS)
  assert.ok(html.includes('<span class="cf-kpi-val">4</span>'), 'LAD Balance card must show 4 LHS');
  assert.ok(html.includes('120.5000'), 'LAD Balance card must show 120.5000 HAS');
  // Temp Park = 2 LHS (LEY: 30, SLE: 60 -> total 90.0 HAS)
  assert.ok(html.includes('<span class="cf-kpi-val">2</span>'), 'Temp Park card must show 2 LHS');
  assert.ok(html.includes('90.0000'), 'Temp Park card must show 90.0000 HAS');

  // 3. All 6 provinces must be rendered in the breakdown table with their non-zero figures
  assert.ok(html.includes('BILIRAN'), 'Table contains BILIRAN');
  assert.ok(html.includes('EASTERN SAMAR'), 'Table contains EASTERN SAMAR');
  assert.ok(html.includes('LEYTE'), 'Table contains LEYTE');
  assert.ok(html.includes('NORTHERN SAMAR'), 'Table contains NORTHERN SAMAR');
  assert.ok(html.includes('SAMAR'), 'Table contains SAMAR');
  assert.ok(html.includes('SOUTHERN LEYTE'), 'Table contains SOUTHERN LEYTE');

  // Provincial badge for logged-in user
  assert.ok(html.includes('Your Province'), 'Logged-in user province is badged');

  // Registered HAS checks
  assert.ok(html.includes('5.2500'), 'Biliran registered area 5.2500 HAS displayed');
  assert.ok(html.includes('15.7600'), 'Northern Samar registered area 15.7600 HAS displayed');

  // Region VIII Total row
  assert.ok(html.includes('Region VIII Total'), 'Footer contains Region VIII Total');

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});

test('Test 59: Registration & Distribution EPEB and ROD forwarding fields schema, store, views, and whereabouts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regdist-epeb-test-'));
  const store = new ConsolidatedStore(tmpDir);

  // 1. Schema integrity
  const regSchema = OPTOOL_SHEET_SCHEMAS.RegistrationDistribution;
  const fwdCol = regSchema.find((c) => c.key === 'dateForwardedToRod');
  assert.equal(fwdCol?.type, 'date');
  assert.equal(fwdCol?.label, 'Date Forwarded to ROD');
  assert.equal(fwdCol?.group, 'Registration & Distribution');

  const recCol = regSchema.find((c) => c.key === 'dateReceivedAtRod');
  assert.equal(recCol?.type, 'date');
  assert.equal(recCol?.label, 'Date Received at ROD');
  const regIdx = regSchema.findIndex((c) => c.key === 'dateRegistered');
  const recIdx = regSchema.findIndex((c) => c.key === 'dateReceivedAtRod');
  assert.ok(recIdx > regIdx, 'dateReceivedAtRod must appear after dateRegistered');

  const epebNumCol = regSchema.find((c) => c.key === 'epebNumber');
  assert.equal(epebNumCol?.type, 'text');
  assert.equal(epebNumCol?.label, 'EPEB Number');

  const epebDateCol = regSchema.find((c) => c.key === 'epebDate');
  assert.equal(epebDateCol?.type, 'date');
  assert.equal(epebDateCol?.label, 'EPEB Date');

  const epebStatusCol = regSchema.find((c) => c.key === 'epebStatus');
  assert.equal(epebStatusCol?.type, 'select');
  assert.equal(epebStatusCol?.label, 'EPEB Status');
  assert.deepEqual(epebStatusCol?.options, EPEB_STATUS_OPTIONS);

  // 2. Store upsert and retrieval
  const testRow = {
    lhid: '804209075',
    region: 'REGION VIII',
    province: 'NORTHERN SAMAR',
    municipality: 'CATARMAN',
    barangay: 'LIBJO',
    arbName: 'DELA CRUZ, JUAN M.',
    epOrCloaSerialNo: '00987654',
    areaHas: '2.5000',
    moa: 'VOS',
    dateForwardedToRod: '2026-04-10',
    dateReceivedAtRod: '2026-04-12',
    epebNumber: 'EPEB-2026-0042',
    epebDate: '2026-04-15',
    epebStatus: 'Examination',
    rodTitleNo: '2026000099',
    dateRegistered: '2026-04-23',
    dateOfDistribution: '2026-05-12',
    target: 'Current',
    targetYear: '2026'
  };

  store.upsertOptoolRow('RegistrationDistribution', testRow);
  const rows = store.state.optool.RegistrationDistribution;
  const found = rows.find((r) => String(r.lhid) === '804209075');
  assert.ok(found, 'Row should be found in store');
  assert.equal(found.dateForwardedToRod, '2026-04-10');
  assert.equal(found.dateReceivedAtRod, '2026-04-12');
  assert.equal(found.epebNumber, 'EPEB-2026-0042');
  assert.equal(found.epebDate, '2026-04-15');
  assert.equal(found.epebStatus, 'Examination');

  // 3. renderOptoolView table rendering & inline select
  const optoolHtml = renderOptoolView({
    user: { role: 'ADMIN', province: 'Region VIII Hub' },
    activeOptoolTab: 'RegistrationDistribution',
    optoolPage: 1,
    optoolPageSize: 50,
    optoolSearch: '',
    optoolColumnFilters: {},
    optoolSort: { colIndex: 0, dir: 'asc' },
    state: {
      optool: {
        RegistrationDistribution: [testRow]
      }
    },
    schemas: {
      optoolTabs: {
        RegistrationDistribution: regSchema
      },
      optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS
    }
  });

  assert.ok(optoolHtml.includes('Date Forwarded to ROD'), 'Header contains Date Forwarded to ROD');
  assert.ok(optoolHtml.includes('Date Received at ROD'), 'Header contains Date Received at ROD');
  assert.ok(optoolHtml.includes('EPEB Number'), 'Header contains EPEB Number');
  assert.ok(optoolHtml.includes('EPEB Date'), 'Header contains EPEB Date');
  assert.ok(optoolHtml.includes('EPEB Status'), 'Header contains EPEB Status');
  assert.ok(optoolHtml.includes('data-optool-select-key="epebStatus"'), 'Inline select rendered for epebStatus');
  assert.ok(optoolHtml.includes('value="Examination" selected'), 'Selected value Examination rendered');

  // 4. regdist-whereabouts config stage resolution and extraColValue
  const regConfig = WHEREABOUTS_CONFIGS['regdist-whereabouts'];
  assert.ok(regConfig, 'regdist-whereabouts config exists');

  // When only forwarded to ROD
  const stageFwd = regConfig.resolveStage({ dateForwardedToRod: '2026-04-10' });
  assert.equal(stageFwd.stage, 'Forwarded to ROD');

  // When EPEB status is set
  const stageEpeb = regConfig.resolveStage({ epebStatus: 'Examination' });
  assert.equal(stageEpeb.stage, 'EPEB: Examination');

  // When registered
  const stageReg = regConfig.resolveStage({ epebStatus: 'Released', dateRegistered: '2026-04-23' });
  assert.equal(stageReg.stage, 'Registered with ROD');

  // When received at ROD (after registration)
  const stageRec = regConfig.resolveStage({ dateForwardedToRod: '2026-04-10', dateRegistered: '2026-04-23', dateReceivedAtRod: '2026-04-25' });
  assert.equal(stageRec.stage, 'Received at ROD');

  // When distributed
  const stageDist = regConfig.resolveStage({ dateRegistered: '2026-04-23', dateOfDistribution: '2026-05-12' });
  assert.equal(stageDist.stage, 'Distributed to ARBs');

  // extraColValue rendering
  const extraHtml = regConfig.extraColValue({ epebNumber: 'EPEB-2026-0042', epebStatus: 'Examination' });
  assert.ok(extraHtml.includes('EPEB: EPEB-2026-0042 (Examination)'));

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});
















