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
import { ConsolidatedStore } from '../store.js';
import {
  buildConsolidatedWorkbookBuffer,
  parseWorkbookBuffer,
  parseCsvText
} from '../sheetsSync.js';
import { createAppServer } from '../app.js';
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
  const { server } = createAppServer(dir);
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
