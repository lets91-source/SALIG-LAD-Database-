import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REGIONAL_REGISTRY,
  MILESTONE_TARGET_TABS,
  OPTOOL_SHEET_SCHEMAS,
  OPTOOL_PREVIEW_COLUMNS,
  inferProvinceCodeFromMunicipality,
  isChecklistChecked as isServerChecklistChecked
} from '../schema.js';
import { ConsolidatedStore, resolveDefaultDataDir } from '../store.js';
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
  LINKED_DB_PROFILE_FIELDS
} from '../../public/views.js';
import {
  TARGET_PERIOD_OPTIONS,
  formatCurrentMonthYear,
  getReportedMonthOptions,
  isReportedMonthKey,
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

  assert.equal(OPTOOL_SHEET_SCHEMAS.Database.length, 26);
  assert.equal(OPTOOL_SHEET_SCHEMAS['CF(DOC)'].length, 23);
  assert.equal(OPTOOL_SHEET_SCHEMAS.Survey.length, 43);
  assert.equal(OPTOOL_SHEET_SCHEMAS.MOV.length, 12);
  assert.equal(OPTOOL_SHEET_SCHEMAS.MOV.some((c) => c.key === 'currentStatus' || c.key === 'currentDate'), false);
  const ppuCol = OPTOOL_SHEET_SCHEMAS.MOV.find((c) => c.key === 'ppuReviewResult');
  assert.equal(ppuCol?.type, 'select');
  assert.deepEqual(ppuCol?.options, ['PASSED', 'FAILED']);
  assert.equal(OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.length, 21);
  const regReporting = OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.slice(-7);
  assert.deepEqual(
    regReporting.map((c) => c.key),
    ['noOfArbs', 'maleArbs', 'femaleArbs', 'noOfTitles', 'target', 'monthReported', 'remarks']
  );
  assert.ok(regReporting.every((c) => c.group === 'Reporting'));
  assert.equal(OPTOOL_SHEET_SCHEMAS.RegistrationDistribution.some((c) => c.key === 'gender'), false);
  assert.equal(OPTOOL_SHEET_SCHEMAS.Installation.length, 30);
  const instReporting = OPTOOL_SHEET_SCHEMAS.Installation.slice(-2);
  assert.deepEqual(
    instReporting.map((c) => c.key),
    ['target', 'monthReported']
  );
  assert.equal(instReporting[0].type, 'select');
  assert.deepEqual(instReporting[0].options, TARGET_PERIOD_OPTIONS);
  assert.equal(instReporting[1].type, 'select');
  assert.deepEqual(instReporting[1].options, getReportedMonthOptions());

  const surveyCols = OPTOOL_SHEET_SCHEMAS.Survey;
  const lastThreeKeys = surveyCols.slice(-3).map((c) => c.key);
  assert.deepEqual(lastThreeKeys, ['pdfFile', 'currentStatus', 'currentDate']);
  assert.equal(surveyCols.at(-2)?.group, 'Reporting');
  assert.equal(surveyCols.at(-2)?.type, 'text');
  assert.equal(surveyCols.at(-1)?.group, 'Reporting');
  assert.equal(surveyCols.at(-1)?.type, 'date');
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
  assert.equal(surveyChecklistCols.length, 15);
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
  assert.equal(cfChecklistCols.length, 16);
  assert.deepEqual(
    cfChecklistCols.map((c) => c.key),
    [
      'certificateOfTitle',
      'denrCertification',
      'taxDeclaration',
      'carperLadForm1And2',
      'carperLadForm3',
      'asp',
      'carperLadForm18',
      'carperLadForm20',
      'marpoCert',
      'firCarperLadForm46',
      'landUsePerFi',
      'copyOfAdvSp',
      'carperLadNo49',
      'carperLadNo37',
      'carperLadForm47',
      'approvedSubdivisionPlan'
    ]
  );
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
    'carpable'
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
    assert.equal(boot.schemas.optoolPreviewCols.Database.length, 12);
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
          carpable: '5.125'
        }
      })
    });
    assert.equal(optRes.status, 200);
    const optJson = await optRes.json();
    assert.equal(optJson.row.carpable, '5.1250');

    // Milestone Target routing from Database -> CF(DOC), Survey, MOV, RegistrationDistribution, Installation
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
      assert.ok(
        mtJson.optool[targetTab].some((r) => r.lhid === 'LH-0837-9999'),
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
    for (const staticPath of ['/', '/styles.css', '/app.js', '/views.js', '/charts.js', '/dar-logo.svg']) {
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
      { span: 10, label: 'Database Parcel Details' },
      { span: 6, label: 'DARPO Compliance' },
      { span: 18, label: 'DARRO Compliance' },
      { span: 1, label: 'DARPO Compliance' },
      { span: 7, label: 'DARRO Compliance' },
      { span: 1, label: 'DARPO Compliance' },
      { span: 3, label: 'DARRO Compliance' },
      { span: 6, label: 'Reporting' }
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
        milestoneTarget: 'Survey'
      }
    });
    assert.equal(saveRes.statusCode, 200);
    assert.equal(saveRes.body.gasPushResult?.ok, true);
    assert.ok(pushedPayloads.some((p) => p.payload.action === 'upsertOptoolRow' && p.payload.tabName === 'Database'));
    assert.ok(pushedPayloads.some((p) => p.payload.action === 'upsertOptoolRow' && p.payload.tabName === 'Survey'));

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

    // Land Survey: 1 in Q2 via currentDate
    store.upsertOptoolRow('Survey', { lhid: 'LH-Q2', currentDate: '2026-05-19' });

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
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
