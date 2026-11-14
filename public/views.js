import {
  renderTrendChartSvg,
  renderProvincialComparisonSvg,
  renderWhereaboutsProvincialGraphSvg,
  renderWhereaboutsMonthlyGraphSvg
} from './charts.js';
import { getReportedMonthOptions, isReportedMonthKey } from './reportingUtils.js';

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseNumericValue(val) {
  const cleaned = typeof val === 'string' ? val.replace(/,/g, '').trim() : val;
  if (cleaned === '' || cleaned === null || cleaned === undefined) return NaN;
  return Number(cleaned);
}

export function fmtArea(val) {
  const num = parseNumericValue(val);
  if (!Number.isFinite(num)) return '0.0000';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  });
}

function stageBadgeClass(stage) {
  const s = String(stage || '').toLowerCase();
  if (s.includes('installed')) return 'badge-green';
  if (s.includes('distributed')) return 'badge-green';
  if (s.includes('registered')) return 'badge-blue';
  if (s.includes('generated') || s.includes('approved')) return 'badge-amber';
  return 'badge-gray';
}

function formatMetricsCell(eTitles, areaHas, monitoringLevel) {
  if (monitoringLevel === 'etitles') {
    return `<span class="num"><strong>${eTitles}</strong></span>`;
  }
  if (monitoringLevel === 'area') {
    return `<span class="num"><strong>${fmtArea(areaHas)}</strong> <small class="muted">HAS</small></span>`;
  }
  return `<div class="num"><strong>${eTitles}</strong> eTitles</div><div class="num" style="font-size:11.5px;color:#52665a">${fmtArea(areaHas)} HAS</div>`;
}

/**
 * Render an inline callout when both Milestone_Data and OPTool tabs have zero loaded rows,
 * surfacing live sync diagnostics (e.g., 0-row Regional Hub or HTTP 401 provincial sheets)
 * alongside immediate recovery actions.
 */
function renderEmptyWorkspaceCallout(state) {
  if (!state) return '';
  const msCount = (state.milestoneData || []).length;
  const optoolCount = Object.values(state.optool || {}).reduce(
    (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
    0
  );
  if (msCount > 0 || optoolCount > 0) return '';

  const nodeStatuses = Object.values(state.nodeStatuses || {});
  const unauthorizedNodes = nodeStatuses.filter((n) => n && n.status === 'unauthorized');
  const snap = state.liveHubSnapshot || {};
  const hubTabCount = Object.keys(snap.tabRowCounts || {}).length;

  const diagParts = [];
  if (snap.reachable) {
    diagParts.push(
      `Regional Hub Google Sheet (${hubTabCount || 6} tabs) is reachable but currently contains <strong>0 populated data rows</strong>.`
    );
  }
  if (unauthorizedNodes.length > 0) {
    const codes = unauthorizedNodes.map((n) => esc(n.code)).join(', ');
    diagParts.push(
      `<strong>${unauthorizedNodes.length}</strong> provincial sheet(s) (<code>${codes}</code>) returned <strong>HTTP 401 Unauthorized</strong> because they are not shared publicly and no GAS Web App URL is configured.`
    );
  }
  if (diagParts.length === 0) {
    diagParts.push('Workspace is currently empty (0 consolidated rows loaded).');
  }

  return `
    <div class="panel" style="border-color:#f59e0b;background:#fffbeb">
      <div class="panel-header" style="background:rgba(245,158,11,0.1);border-bottom-color:#fde68a">
        <div>
          <h3 class="panel-title" style="color:#92400e">No Consolidated Data Loaded Yet</h3>
          <p class="panel-subtitle" style="color:#78350f">${diagParts.join(' ')}</p>
        </div>
        <span class="badge badge-amber">0 ROWS LOADED</span>
      </div>
      <div class="panel-body" style="display:flex;flex-direction:column;gap:10px;font-size:12.5px;color:#451a03">
        <div>
          <strong>To populate live Region VIII provincial data:</strong>
          <ul style="margin:6px 0 0 18px;padding:0;line-height:1.55">
            <li>Share the active provincial Google Sheets as <em>"Anyone with the link → Viewer"</em>, then click <strong>Retry Sync All 7 Sheets</strong>; OR</li>
            <li>While signed into Google, download <code>.xlsx</code> from each provincial sheet and upload it in <strong>Google Sheets &amp; GAS ETL</strong> (Merge mode); OR</li>
            <li>Deploy <code>gas/Code.gs</code> inside the Regional Hub Google Sheet using the owner DAR Google account and paste its Web App <code>/exec</code> URL.</li>
          </ul>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary btn-sm" data-nav="sync">Open Google Sheets &amp; GAS ETL</button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="sync-all">Retry Sync All 7 Sheets</button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="load-sample">Load Sample Staging Data</button>
        </div>
      </div>
    </div>
  `;
}

function formatSignedCount(val) {
  const num = Number(val) || 0;
  return num > 0 ? `+${num.toLocaleString('en-US')}` : num.toLocaleString('en-US');
}

function formatSignedArea(val) {
  const num = Number(val) || 0;
  return num > 0 ? `+${fmtArea(num)}` : num < 0 ? `-${fmtArea(Math.abs(num))}` : fmtArea(0);
}

function formatNepMetricCell(count, areaHas, mode = 'both') {
  const safeCount = (Number(count) || 0).toLocaleString('en-US');
  const safeArea = fmtArea(areaHas);
  if (mode === 'count') {
    return `<span class="num"><strong>${safeCount}</strong></span>`;
  }
  if (mode === 'area') {
    return `<span class="num"><strong>${safeArea}</strong> <small class="muted">HAS</small></span>`;
  }
  return `<div class="num"><strong>${safeCount}</strong></div><div class="nep-sub-metric">${safeArea} HAS</div>`;
}

function formatNepRateCell(rateCountPct, rateAreaPct, mode = 'both') {
  const primary = mode === 'area' ? rateAreaPct : rateCountPct;
  const tone =
    primary >= 100 ? 'badge-green' : primary >= 50 ? 'badge-blue' : primary > 0 ? 'badge-amber' : 'badge-gray';
  const sub =
    mode === 'both'
      ? `<div class="nep-sub-metric">${Number(rateAreaPct || 0).toFixed(2)}%</div>`
      : '';
  return `<span class="badge ${tone} num">${Number(primary || 0).toFixed(2)}%</span>${sub}`;
}

function formatNepVarianceCell(varianceCount, varianceAreaHas, mode = 'both') {
  const primary = mode === 'area' ? varianceAreaHas : varianceCount;
  const cls = primary >= 0 ? 'variance-pos' : 'variance-neg';
  if (mode === 'count') {
    return `<span class="num ${cls}">${formatSignedCount(varianceCount)}</span>`;
  }
  if (mode === 'area') {
    return `<span class="num ${cls}">${formatSignedArea(varianceAreaHas)} HAS</span>`;
  }
  const areaCls = varianceAreaHas >= 0 ? 'variance-pos' : 'variance-neg';
  return `
    <div class="num ${cls}">${formatSignedCount(varianceCount)}</div>
    <div class="nep-sub-metric ${areaCls}">${formatSignedArea(varianceAreaHas)} HAS</div>
  `;
}

function renderMilestoneNepSection(ctx) {
  const {
    analytics,
    schemas,
    filters = {},
    provinceScope,
    nepMetricMode = 'both',
    nepShowMonths = false,
    nepExpandedQuarters = {},
    nepExpandedTargetSems = false,
    nepExpandedAccompSems = true,
    nepShowProvinces = false,
    nepExpandedMilestones = {},
    nepMilestoneTableFilter = 'ALL'
  } = ctx;
  const rows = analytics.milestoneNepBreakdown || [];
  const milestoneTableOptions = [
    { key: 'ALL', label: 'All Milestones' },
    { key: 'cf_doc', label: 'CF Documentation' },
    { key: 'land_survey', label: 'Land Survey' },
    { key: 'land_valuation', label: 'Land Valuation' },
    { key: 'ep_cloa_registration', label: 'EP CLOA Registration' },
    { key: 'ep_cloa_distribution', label: 'EP CLOA Distribution' },
    { key: 'installation', label: 'Installation' }
  ];
  const activeMilestoneTable = nepMilestoneTableFilter || 'ALL';
  const displayRows = activeMilestoneTable === 'ALL'
    ? rows
    : rows.filter((r) => r.key === activeMilestoneTable);
  const yearsSet = new Set(analytics.availableMilestoneYears || []);
  yearsSet.add(new Date().getFullYear());
  for (const r of analytics.nepProvinceBreakdown || []) {
    const yr = Math.round(Number(r?.year) || 0);
    if (yr >= 2000 && yr <= 2099) yearsSet.add(yr);
  }
  for (const msMap of Object.values(analytics.nepMilestoneList || {})) {
    if (msMap && typeof msMap === 'object') {
      for (const r of Object.values(msMap)) {
        const yr = Math.round(Number(r?.year) || 0);
        if (yr >= 2000 && yr <= 2099) yearsSet.add(yr);
      }
    }
  }
  const years = Array.from(yearsSet).sort((a, b) => b - a);
  const activeYear = filters.milestoneYear || 'ALL';
  const activeProvince = filters.province || 'ALL';
  const provNodes = (schemas?.registry || []).filter((n) => n.role === 'Provincial Node');
  const canEditNepTargets = !provinceScope;

  const quartersConfig = [
    {
      q: 1,
      label: 'Q1',
      months: [
        { num: 1, label: 'Jan' },
        { num: 2, label: 'Feb' },
        { num: 3, label: 'Mar' }
      ]
    },
    {
      q: 2,
      label: 'Q2',
      months: [
        { num: 4, label: 'Apr' },
        { num: 5, label: 'May' },
        { num: 6, label: 'Jun' }
      ]
    },
    {
      q: 3,
      label: 'Q3',
      months: [
        { num: 7, label: 'Jul' },
        { num: 8, label: 'Aug' },
        { num: 9, label: 'Sep' }
      ]
    },
    {
      q: 4,
      label: 'Q4',
      months: [
        { num: 10, label: 'Oct' },
        { num: 11, label: 'Nov' },
        { num: 12, label: 'Dec' }
      ]
    }
  ];

  const isQExpanded = (qNum) => nepShowMonths || Boolean(nepExpandedQuarters[qNum]);
  const hasAnyMonthExpanded = quartersConfig.some((q) => isQExpanded(q.q));
  const q1Cols = isQExpanded(1) ? 4 : 1;
  const q2Cols = isQExpanded(2) ? 4 : 1;
  const q3Cols = isQExpanded(3) ? 4 : 1;
  const q4Cols = isQExpanded(4) ? 4 : 1;
  const totalQuarterCols = q1Cols + q2Cols + q3Cols + q4Cols;
  const targetCols = nepExpandedTargetSems ? 3 : 1;
  const accompSemCols = nepExpandedAccompSems ? 2 : 0;
  const totalAccompCols = totalQuarterCols + accompSemCols;
  const totalTableCols = 1 + targetCols + totalAccompCols + 3;

  const formatNepTargetSmall = (count, areaHas, mode = 'both') => {
    const c = Math.round(count || 0);
    const a = Number(areaHas || 0).toFixed(4);
    if (mode === 'area') return `${a} HAS`;
    if (mode === 'count') return `${c.toLocaleString('en-US')}`;
    return `${c.toLocaleString('en-US')} / ${a} HAS`;
  };

  const renderTargetCells = (dataObj) => {
    const tCount = dataObj.targetCount ?? dataObj.nepTargetCount ?? 0;
    const tArea = dataObj.targetAreaHas ?? dataObj.nepTargetAreaHas ?? 0;
    const s1Count = dataObj.sem1?.targetCount ?? (tCount > 0 ? tCount / 2 : 0);
    const s1Area = dataObj.sem1?.targetAreaHas ?? (tArea > 0 ? tArea / 2 : 0);
    const s2Count = dataObj.sem2?.targetCount ?? Math.max(0, tCount - s1Count);
    const s2Area = dataObj.sem2?.targetAreaHas ?? Math.max(0, Number((tArea - s1Area).toFixed(4)));

    if (!nepExpandedTargetSems) {
      return `
        <td class="right nep-target-cell">
          <div class="nep-target-main">${formatNepMetricCell(tCount, tArea, nepMetricMode)}</div>
          <div class="nep-target-sem-breakdown" title="1st Sem Target: ${formatNepTargetSmall(s1Count, s1Area, 'both')} | 2nd Sem Target (Auto: NEP − 1st Sem): ${formatNepTargetSmall(s2Count, s2Area, 'both')}">
            <span class="nep-target-sem-tag sem1">1st Sem: ${formatNepTargetSmall(s1Count, s1Area, nepMetricMode)}</span>
            <span class="nep-target-sem-tag sem2">2nd Sem: ${formatNepTargetSmall(s2Count, s2Area, nepMetricMode)}</span>
          </div>
        </td>
      `;
    }

    return `
      <td class="right nep-target-sem-cell nep-sem1-target-cell" title="1st Semester NEP Target">
        ${formatNepMetricCell(s1Count, s1Area, nepMetricMode)}
      </td>
      <td class="right nep-target-sem-cell nep-sem2-target-cell" title="2nd Semester NEP Target (Auto: NEP − 1st Sem)">
        ${formatNepMetricCell(s2Count, s2Area, nepMetricMode)}
      </td>
      <td class="right nep-target-annual-cell font-semibold" title="Full Year NEP Target">
        ${formatNepMetricCell(tCount, tArea, nepMetricMode)}
      </td>
    `;
  };

  const renderQuarterCells = (dataObj, qNum) => {
    const qData = dataObj[`q${qNum}`] || { count: 0, areaHas: 0 };
    if (!isQExpanded(qNum)) {
      return `<td class="right">${formatNepMetricCell(qData.count, qData.areaHas, nepMetricMode)}</td>`;
    }
    const qCfg = quartersConfig.find((q) => q.q === qNum);
    const m1 = dataObj.months?.[qCfg.months[0].num] || { count: 0, areaHas: 0 };
    const m2 = dataObj.months?.[qCfg.months[1].num] || { count: 0, areaHas: 0 };
    const m3 = dataObj.months?.[qCfg.months[2].num] || { count: 0, areaHas: 0 };
    return `
      <td class="right nep-month-cell">${formatNepMetricCell(m1.count, m1.areaHas, nepMetricMode)}</td>
      <td class="right nep-month-cell">${formatNepMetricCell(m2.count, m2.areaHas, nepMetricMode)}</td>
      <td class="right nep-month-cell">${formatNepMetricCell(m3.count, m3.areaHas, nepMetricMode)}</td>
      <td class="right nep-q-total-cell">${formatNepMetricCell(qData.count, qData.areaHas, nepMetricMode)}</td>
    `;
  };

  const renderSemAccompCell = (dataObj, semNum) => {
    let semData = semNum === 1 ? dataObj.sem1 : dataObj.sem2;
    if (!semData) {
      const qA = semNum === 1 ? dataObj.q1 : dataObj.q3;
      const qB = semNum === 1 ? dataObj.q2 : dataObj.q4;
      const c = (qA?.count || 0) + (qB?.count || 0);
      const a = Number(((qA?.areaHas || 0) + (qB?.areaHas || 0)).toFixed(4));
      semData = { count: c, areaHas: a, rateAreaPct: 0, rateCountPct: 0 };
    }

    const c = semData.count || 0;
    const a = semData.areaHas || 0;
    const tc = semData.targetCount ?? (semNum === 1 ? dataObj.targetSem1Count : dataObj.targetSem2Count) ?? 0;
    const ta = semData.targetAreaHas ?? (semNum === 1 ? dataObj.targetSem1AreaHas : dataObj.targetSem2AreaHas) ?? 0;
    const rateVal = nepMetricMode === 'count'
      ? (tc > 0 ? (semData.rateCountPct ?? Number(((c / tc) * 100).toFixed(2))) : null)
      : (ta > 0 ? (semData.rateAreaPct ?? Number(((a / ta) * 100).toFixed(2))) : (tc > 0 ? (semData.rateCountPct ?? Number(((c / tc) * 100).toFixed(2))) : null));

    const cls = semNum === 1 ? 'nep-sem1-cell' : 'nep-sem2-cell';
    const tagCls = semNum === 1 ? 'sem1' : 'sem2';
    const semName = semNum === 1 ? '1st Sem' : '2nd Sem';

    return `
      <td class="right nep-sem-cell ${cls}" title="${semName} Accomp (Q${semNum === 1 ? '1+Q2' : '3+Q4'}): ${formatNepTargetSmall(c, a, 'both')}${rateVal !== null ? ` (${rateVal}% of ${semName} Target)` : ''}">
        <div class="nep-sem-main font-semibold">${formatNepMetricCell(c, a, nepMetricMode)}</div>
        <div class="nep-sem-sub" style="font-size:10.5px;display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:2px;">
          <span class="nep-target-sem-tag ${tagCls}" style="font-size:9px;padding:0 3px;border-radius:2px;font-weight:700;">${semName}</span>
          ${rateVal !== null ? `<span style="font-weight:700;color:${semNum === 1 ? 'var(--dar-blue,#1d4ed8)' : 'var(--dar-amber,#b45309)'};">${rateVal}%</span>` : ''}
        </div>
      </td>
    `;
  };

  return `
    <div class="panel" id="panel-milestone-nep">
      <div class="panel-header nep-panel-header">
        <div>
          <h3 class="panel-title">Physical Accomplishment per Milestone (NEP Target &amp; Quarterly)</h3>
          <p class="panel-subtitle">
            CF Documentation, Land Survey, Land Valuation, EP CLOA Registration, EP CLOA Distribution &amp; Installation • Regional NEP Target List
          </p>
        </div>
        <div class="nep-header-controls">
          <div class="nep-metric-pills" role="group" aria-label="Milestone Metric Display">
            <button type="button" class="btn btn-sm ${nepMetricMode === 'both' ? 'btn-primary' : 'btn-secondary'}" data-nep-metric="both">Both</button>
            <button type="button" class="btn btn-sm ${nepMetricMode === 'count' ? 'btn-primary' : 'btn-secondary'}" data-nep-metric="count">Lots / eTitles</button>
            <button type="button" class="btn btn-sm ${nepMetricMode === 'area' ? 'btn-primary' : 'btn-secondary'}" data-nep-metric="area">Area (HAS)</button>
          </div>
          ${
            !provinceScope
              ? `
            <select class="form-control nep-filter-select" id="nep-province-filter" aria-label="Filter Milestones by Province">
              <option value="ALL" ${activeProvince === 'ALL' ? 'selected' : ''}>All Region VIII Provinces</option>
              ${provNodes
                .map(
                  (p) =>
                    `<option value="${esc(p.code)}" ${activeProvince === p.code ? 'selected' : ''}>${esc(p.provinceName)} (${esc(p.code)})</option>`
                )
                .join('')}
            </select>
          `
              : `<span class="badge badge-green">${esc(provinceScope.provinceName)} (${esc(provinceScope.code)})</span>`
          }
          <select class="form-control nep-filter-select" id="nep-milestone-table-filter" aria-label="Filter by Milestone">
            ${milestoneTableOptions
              .map(
                (m) =>
                  `<option value="${esc(m.key)}" ${activeMilestoneTable === m.key ? 'selected' : ''}>${esc(m.label)}</option>`
              )
              .join('')}
          </select>
          <select class="form-control nep-filter-select" id="nep-year-select" aria-label="Filter Milestones by Year">
            <option value="ALL" ${activeYear === 'ALL' ? 'selected' : ''}>All Years</option>
            ${years
              .map(
                (y) =>
                  `<option value="${esc(String(y))}" ${String(activeYear) === String(y) ? 'selected' : ''}>${esc(String(y))}</option>`
              )
              .join('')}
          </select>
          <button type="button" class="btn btn-sm ${hasAnyMonthExpanded ? 'btn-primary' : 'btn-secondary'}" id="btn-toggle-nep-months" title="Toggle monthly accomplishment in each quarter">
            <span class="fs-icon">📅</span> <span>${hasAnyMonthExpanded ? 'Hide Monthly' : 'Monthly Accomp.'}</span>
          </button>
          <button type="button" class="btn btn-sm ${nepExpandedTargetSems ? 'btn-primary' : 'btn-secondary'}" id="btn-toggle-nep-target-sems" title="Toggle 1st Sem &amp; 2nd Sem Target columns">
            <span class="fs-icon">🎯</span> <span>${nepExpandedTargetSems ? 'Hide Target Sems' : '1st &amp; 2nd Target'}</span>
          </button>
          <button type="button" class="btn btn-sm ${nepExpandedAccompSems ? 'btn-primary' : 'btn-secondary'}" id="btn-toggle-nep-accomp-sems" title="Toggle 1st Sem &amp; 2nd Sem Accomplishment columns">
            <span class="fs-icon">📊</span> <span>${nepExpandedAccompSems ? 'Hide Sem Accomp' : 'Semester Accomp'}</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm btn-fullscreen" id="btn-fullscreen-nep" title="Full Screen Report / Table">
            <span class="fs-icon">⛶</span> <span class="fs-label">Full Screen</span>
          </button>
        </div>
      </div>
      <div class="table-wrap nep-milestone-table-wrap" id="nep-milestone-table-wrap">
        <table class="nep-milestone-table">
          <thead>
            ${
              !hasAnyMonthExpanded
                ? `
            <tr>
              <th rowspan="2" class="nep-th-milestone-col sticky-col-province">
                <div class="nep-th-milestone-flex">
                  <span>Milestone</span>
                  <select class="form-control nep-th-milestone-select" id="nep-th-milestone-filter" title="Filter by Milestone" aria-label="Filter by Milestone">
                    ${milestoneTableOptions
                      .map(
                        (m) =>
                          `<option value="${esc(m.key)}" ${activeMilestoneTable === m.key ? 'selected' : ''}>${esc(m.label)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
              </th>
              ${
                !nepExpandedTargetSems
                  ? `<th rowspan="2" class="right nep-target-header" data-toggle-target-sems title="Click to show 1st &amp; 2nd Sem Target columns">NEP Target <span class="q-toggle-pill">+</span></th>`
                  : `<th colspan="3" class="center nep-target-group-header" data-toggle-target-sems title="Click to collapse Target columns">NEP Target <span class="q-toggle-pill">Hide Sems ▴</span></th>`
              }
              <th colspan="${4 + (nepExpandedAccompSems ? 2 : 0)}" class="center nep-quarter-group" data-toggle-accomp-sems title="Click to toggle Semester Accomplishment columns" style="cursor:pointer;">
                Accomp. per Quarter ${nepExpandedAccompSems ? '&amp; Semester' : ''} <span class="q-toggle-pill">${nepExpandedAccompSems ? 'Hide Sems ▴' : '+ Sems'}</span>
              </th>
              <th rowspan="2" class="right">Total</th>
              <th rowspan="2" class="right">Rate of Accomp.</th>
              <th rowspan="2" class="right">Variance</th>
            </tr>
            <tr>
              ${
                nepExpandedTargetSems
                  ? `
                <th class="center nep-target-sem-th" title="1st Semester NEP Target">1st Sem Target</th>
                <th class="center nep-target-sem-th" title="2nd Semester NEP Target (Auto: NEP − 1st Sem)">2nd Sem Target</th>
                <th class="center nep-target-annual-th" title="Full Year NEP Target">Annual Target</th>
              `
                  : ''
              }
              <th class="right nep-q-col-header" data-toggle-q="1" title="Click to show months for Q1">Q1 <span class="q-toggle-pill">+</span></th>
              <th class="right nep-q-col-header" data-toggle-q="2" title="Click to show months for Q2">Q2 <span class="q-toggle-pill">+</span></th>
              ${nepExpandedAccompSems ? `<th class="center nep-sem-accomp-th nep-sem1-accomp-th" title="1st Semester Accomplishment (Q1 + Q2)">1st Sem Accomp</th>` : ''}
              <th class="right nep-q-col-header" data-toggle-q="3" title="Click to show months for Q3">Q3 <span class="q-toggle-pill">+</span></th>
              <th class="right nep-q-col-header" data-toggle-q="4" title="Click to show months for Q4">Q4 <span class="q-toggle-pill">+</span></th>
              ${nepExpandedAccompSems ? `<th class="center nep-sem-accomp-th nep-sem2-accomp-th" title="2nd Semester Accomplishment (Q3 + Q4)">2nd Sem Accomp</th>` : ''}
            </tr>
            `
                : `
            <tr>
              <th rowspan="3" class="nep-th-milestone-col sticky-col-province">
                <div class="nep-th-milestone-flex">
                  <span>Milestone</span>
                  <select class="form-control nep-th-milestone-select" id="nep-th-milestone-filter-m" title="Filter by Milestone" aria-label="Filter by Milestone">
                    ${milestoneTableOptions
                      .map(
                        (m) =>
                          `<option value="${esc(m.key)}" ${activeMilestoneTable === m.key ? 'selected' : ''}>${esc(m.label)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
              </th>
              ${
                !nepExpandedTargetSems
                  ? `<th rowspan="3" class="right nep-target-header" data-toggle-target-sems title="Click to show 1st &amp; 2nd Sem Target columns">NEP Target <span class="q-toggle-pill">+</span></th>`
                  : `<th colspan="3" class="center nep-target-group-header" data-toggle-target-sems title="Click to collapse Target columns">NEP Target <span class="q-toggle-pill">Hide Sems ▴</span></th>`
              }
              <th colspan="${totalQuarterCols + (nepExpandedAccompSems ? 2 : 0)}" class="center nep-quarter-group" data-toggle-accomp-sems title="Click to toggle Semester Accomplishment columns" style="cursor:pointer;">
                Accomp. per Quarter, Monthly &amp; Semester <span class="q-toggle-pill">${nepExpandedAccompSems ? 'Hide Sems ▴' : '+ Sems'}</span>
              </th>
              <th rowspan="3" class="right">Total</th>
              <th rowspan="3" class="right">Rate of Accomp.</th>
              <th rowspan="3" class="right">Variance</th>
            </tr>
            <tr>
              ${
                nepExpandedTargetSems
                  ? `
                <th class="center nep-target-sem-th" rowspan="2" title="1st Semester NEP Target">1st Sem Target</th>
                <th class="center nep-target-sem-th" rowspan="2" title="2nd Semester NEP Target (Auto: NEP − 1st Sem)">2nd Sem Target</th>
                <th class="center nep-target-annual-th" rowspan="2" title="Full Year NEP Target">Annual Target</th>
              `
                  : ''
              }
              ${quartersConfig
                .slice(0, 2)
                .map((q) => {
                  if (isQExpanded(q.q)) {
                    return `<th colspan="4" class="center nep-quarter-group nep-q-header expanded" data-toggle-q="${q.q}" title="Click to hide Q${q.q} months">Q${q.q} <span class="q-toggle-pill">Hide Months ▴</span></th>`;
                  }
                  return `<th rowspan="2" class="right nep-quarter-group nep-q-header collapsed" data-toggle-q="${q.q}" title="Click to show Q${q.q} months">Q${q.q} <span class="q-toggle-pill">+ Months ▾</span></th>`;
                })
                .join('')}
              ${nepExpandedAccompSems ? `<th rowspan="2" class="center nep-sem-accomp-th nep-sem1-accomp-th" title="1st Semester Accomplishment (Q1 + Q2)">1st Sem Accomp</th>` : ''}
              ${quartersConfig
                .slice(2, 4)
                .map((q) => {
                  if (isQExpanded(q.q)) {
                    return `<th colspan="4" class="center nep-quarter-group nep-q-header expanded" data-toggle-q="${q.q}" title="Click to hide Q${q.q} months">Q${q.q} <span class="q-toggle-pill">Hide Months ▴</span></th>`;
                  }
                  return `<th rowspan="2" class="right nep-quarter-group nep-q-header collapsed" data-toggle-q="${q.q}" title="Click to show Q${q.q} months">Q${q.q} <span class="q-toggle-pill">+ Months ▾</span></th>`;
                })
                .join('')}
              ${nepExpandedAccompSems ? `<th rowspan="2" class="center nep-sem-accomp-th nep-sem2-accomp-th" title="2nd Semester Accomplishment (Q3 + Q4)">2nd Sem Accomp</th>` : ''}
            </tr>
            <tr>
              ${quartersConfig
                .map((q) => {
                  if (!isQExpanded(q.q)) return '';
                  return `
                    <th class="right nep-month-header">${q.months[0].label}</th>
                    <th class="right nep-month-header">${q.months[1].label}</th>
                    <th class="right nep-month-header">${q.months[2].label}</th>
                    <th class="right nep-q-subtotal-header">Q${q.q} Total</th>
                  `;
                })
                .join('')}
            </tr>
            `
            }
          </thead>
          <tbody>
            ${displayRows
              .map((r) => {
                const isMsExpanded = nepShowProvinces
                  ? nepExpandedMilestones[r.key] !== false
                  : Boolean(nepExpandedMilestones[r.key]);
                let provEntries = Object.values(r.provinceBreakdown || {});
                if (activeProvince !== 'ALL') {
                  provEntries = provEntries.filter((p) => p.code === activeProvince);
                }
                const zeroList = (r.zeroAccompProvinces || []).filter((c) => activeProvince === 'ALL' || c === activeProvince);

                return `
              <tr class="nep-milestone-main-row ${isMsExpanded ? 'nep-expanded-row' : ''}">
                <td class="sticky-col-province">
                  <button
                    type="button"
                    class="nep-milestone-link"
                    data-open-optool-tab="${esc(r.sourceTab)}"
                    title="Open ${esc(r.label)} in Optool Support List"
                  >
                    ${esc(r.label)}
                  </button>
                  <div class="nep-sub-metric">${esc(r.sourceTab)}</div>
                  <div class="nep-prov-toggle-wrap">
                    <button
                      type="button"
                      class="btn btn-xs nep-prov-toggle-btn ${isMsExpanded ? 'expanded' : 'collapsed'}"
                      data-toggle-prov-milestone="${esc(r.key)}"
                      title="${isMsExpanded ? 'Click (-) to hide provinces for ' + esc(r.label) : 'Click (+) to show provinces for ' + esc(r.label)}"
                      aria-label="${isMsExpanded ? 'Hide provinces for ' + esc(r.label) : 'Show provinces for ' + esc(r.label)}"
                    >
                      <span class="prov-sign-box">${isMsExpanded ? '−' : '+'}</span>
                      <span class="prov-btn-label">${isMsExpanded ? 'Hide Provinces' : 'Provinces'}</span>
                    </button>
                  </div>
                </td>
                ${renderTargetCells(r)}
                ${renderQuarterCells(r, 1)}
                ${renderQuarterCells(r, 2)}
                ${nepExpandedAccompSems ? renderSemAccompCell(r, 1) : ''}
                ${renderQuarterCells(r, 3)}
                ${renderQuarterCells(r, 4)}
                ${nepExpandedAccompSems ? renderSemAccompCell(r, 2) : ''}
                <td class="right">
                  ${formatNepMetricCell(r.total.count, r.total.areaHas, nepMetricMode)}
                  ${
                    r.undated?.count > 0
                      ? `<div class="nep-undated-note" title="Records without a reported month or completion date">${r.undated.count.toLocaleString('en-US')} undated</div>`
                      : ''
                  }
                </td>
                <td class="right">${formatNepRateCell(r.rateCountPct, r.rateAreaPct, nepMetricMode)}</td>
                <td class="right">${formatNepVarianceCell(r.varianceCount, r.varianceAreaHas, nepMetricMode)}</td>
              </tr>
              ${
                isMsExpanded
                  ? `
                ${provEntries
                  .map(
                    (pd) => `
                <tr class="nep-prov-subrow ${pd.hasAccomp ? 'has-accomp' : 'no-accomp'}">
                  <td class="nep-prov-subcell sticky-col-province">
                    <div class="nep-prov-indent">
                      <span class="nep-prov-tree">└─</span>
                      <strong class="nep-prov-code-tag">${esc(pd.code)}</strong>
                      <span class="nep-prov-name-text">${esc(pd.name)}</span>
                      ${
                        pd.hasAccomp
                          ? `<span class="badge badge-green badge-xs">Active</span>`
                          : `<span class="badge badge-danger badge-xs nep-zero-status">No Accomp (0)</span>`
                      }
                    </div>
                  </td>
                  ${renderTargetCells(pd)}
                  ${renderQuarterCells(pd, 1)}
                  ${renderQuarterCells(pd, 2)}
                  ${nepExpandedAccompSems ? renderSemAccompCell(pd, 1) : ''}
                  ${renderQuarterCells(pd, 3)}
                  ${renderQuarterCells(pd, 4)}
                  ${nepExpandedAccompSems ? renderSemAccompCell(pd, 2) : ''}
                  <td class="right font-semibold">${formatNepMetricCell(pd.count, pd.areaHas, nepMetricMode)}</td>
                  <td class="right">${formatNepRateCell(pd.rateCountPct, pd.rateAreaPct, nepMetricMode)}</td>
                  <td class="right">${formatNepVarianceCell(pd.varianceCount, pd.varianceAreaHas, nepMetricMode)}</td>
                </tr>
              `
                  )
                  .join('')}
                <tr class="nep-prov-subrow-footer">
                  <td colspan="${totalTableCols}" class="nep-prov-footer-cell">
                    <button
                      type="button"
                      class="btn btn-xs nep-prov-footer-btn"
                      data-toggle-prov-milestone="${esc(r.key)}"
                      title="Hide provinces for ${esc(r.label)}"
                    >
                      <span class="prov-sign-box">−</span> <span>Hide ${esc(r.label)} Provinces</span>
                    </button>
                  </td>
                </tr>
              `
                  : ''
              }
            `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderProvincialNepSheetSection(ctx) {
  const { analytics, schemas, provinceScope, currentUser, nepMilestoneFilter = 'overall' } = ctx;
  const activeMilestone = String(nepMilestoneFilter || 'overall');
  const milestoneOptions = schemas?.nepMilestoneOptions || [
    { key: 'overall', label: 'Overall NEP (All Milestones)' },
    { key: 'cf_doc', label: 'CF Documentation' },
    { key: 'land_survey', label: 'Land Survey' },
    { key: 'land_valuation', label: 'Land Valuation' },
    { key: 'ep_cloa_registration', label: 'EP CLOA Registration' },
    { key: 'ep_cloa_distribution', label: 'EP CLOA Distribution' },
    { key: 'installation', label: 'Installation' }
  ];
  const activeMilestoneObj = milestoneOptions.find((m) => m.key === activeMilestone) || milestoneOptions[0];
  const milestoneLabel = activeMilestoneObj.label;

  const provNodes = (schemas?.registry || []).filter((n) => n.role === 'Provincial Node');
  let rows = [];
  if (activeMilestone === 'overall') {
    rows = analytics.nepProvinceBreakdown || [];
  } else {
    const msMap = (analytics.nepMilestoneList && analytics.nepMilestoneList[activeMilestone]) || {};
    rows = provNodes.map((n) => {
      const item = msMap[n.code] || { lhs: 0, area: 0, arbs: 0, year: 2026 };
      return {
        code: n.code,
        jurisdiction: n.jurisdiction,
        provinceName: n.provinceName,
        lhs: item.lhs || 0,
        sem1Lhs: item.sem1Lhs,
        sem2Lhs: item.sem2Lhs,
        area: item.area || 0,
        sem1Area: item.sem1Area,
        sem2Area: item.sem2Area,
        arbs: item.arbs || 0,
        year: item.year || 2026
      };
    });
  }
  if (provinceScope) {
    rows = rows.filter((r) => r.code === provinceScope.code);
  }

  const totals = {
    lhs: rows.reduce((s, r) => s + (Number(r.lhs) || 0), 0),
    area: Number(rows.reduce((s, r) => s + (Number(r.area) || 0), 0).toFixed(4)),
    arbs: rows.reduce((s, r) => s + (Number(r.arbs) || 0), 0)
  };
  const hubUrl = (schemas?.registry || []).find((n) => n.code === 'HUB')?.url || '';
  const canEditNepSheet = currentUser ? currentUser.role === 'admin' : !provinceScope;

  return `
    <div class="panel" style="margin-bottom: 18px;">
      <div class="panel-header">
        <div>
          <h3 class="panel-title">Regional Hub NEP Sheet — ${esc(milestoneLabel)} (Per Province)</h3>
          <p class="panel-subtitle">${
            provinceScope
              ? `Provincial NEP Sheet allocation for ${esc(provinceScope.provinceName)} (${esc(milestoneLabel)}) (read-only)`
              : `Region VIII Hub NEP tab — LHS, AREA (HAS), ARBs, and Year for ${esc(milestoneLabel)} across all 6 provinces`
          }</p>
        </div>
        <div class="panel-actions">
          ${
            hubUrl
              ? `<a href="${esc(hubUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Open NEP Sheet ↗</a>`
              : ''
          }
          ${
            canEditNepSheet
              ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-sync-nep-sheet">Sync Hub NEP Sheet</button>
                 <button type="button" class="btn btn-primary btn-sm" id="btn-edit-nep-sheet" data-milestone="${esc(activeMilestone)}">Edit NEP Sheet</button>`
              : ''
          }
        </div>
      </div>
      <div class="table-wrap">
        <table class="nep-sheet-table">
          <thead>
            <tr>
              <th class="sticky-col-province">Province</th>
              <th class="right">LHS</th>
              <th class="right">AREA (HAS)</th>
              <th class="right">ARBs</th>
              <th class="center">Year</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r) => `
              <tr>
                <td class="sticky-col-province">
                  <strong>${esc(r.provinceName)}</strong>
                  <div class="nep-sub-metric">${esc(r.code)}</div>
                </td>
                <td class="right">
                  <div>${(Number(r.lhs) || 0).toLocaleString('en-US')}</div>
                  ${r.sem1Lhs !== undefined ? `<div class="nep-sub-metric" style="font-size:11px;color:var(--text-muted);">1st: ${r.sem1Lhs} • 2nd: ${r.sem2Lhs ?? Math.max(0, (r.lhs || 0) - r.sem1Lhs)}</div>` : ''}
                </td>
                <td class="right">
                  <div>${fmtArea(r.area || 0)}</div>
                  ${r.sem1Area !== undefined ? `<div class="nep-sub-metric" style="font-size:11px;color:var(--text-muted);font-weight:normal;">1st: ${fmtArea(r.sem1Area)} • 2nd: ${fmtArea(r.sem2Area ?? Math.max(0, (r.area || 0) - r.sem1Area))}</div>` : ''}
                </td>
                <td class="right">
                  <div>${(Number(r.arbs) || 0).toLocaleString('en-US')}</div>
                  ${r.sem1Arbs !== undefined ? `<div class="nep-sub-metric" style="font-size:11px;color:var(--text-muted);">1st: ${r.sem1Arbs} • 2nd: ${r.sem2Arbs ?? Math.max(0, (r.arbs || 0) - r.sem1Arbs)}</div>` : ''}
                </td>
                <td class="center"><span class="badge badge-gray">${esc(String(r.year || 2026))}</span></td>
              </tr>
            `
              )
              .join('')}
            ${
              rows.length > 1
                ? `
              <tr style="font-weight:700;background:var(--surface-alt, #f8faf9);">
                <td class="sticky-col-province">Region VIII Total</td>
                <td class="right">${(Number(totals.lhs) || 0).toLocaleString('en-US')}</td>
                <td class="right">${fmtArea(totals.area || 0)}</td>
                <td class="right">${(Number(totals.arbs) || 0).toLocaleString('en-US')}</td>
                <td class="center">-</td>
              </tr>
            `
                : ''
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderNepView(ctx) {
  const { analytics, currentUser, provinceScope, nepYearFilter = 'ALL', nepMilestoneFilter = 'overall', nepDisplayMode = 'table', nepColVisibility = { lhs: true, area: true, arbs: true }, schemas } = ctx;
  const activeMilestone = String(nepMilestoneFilter || 'overall');
  const milestoneOptions = schemas?.nepMilestoneOptions || [
    { key: 'overall', label: 'Overall NEP (All Milestones)' },
    { key: 'cf_doc', label: 'CF Documentation' },
    { key: 'land_survey', label: 'Land Survey' },
    { key: 'land_valuation', label: 'Land Valuation' },
    { key: 'ep_cloa_registration', label: 'EP CLOA Registration' },
    { key: 'ep_cloa_distribution', label: 'EP CLOA Distribution' },
    { key: 'installation', label: 'Installation' }
  ];
  const activeMilestoneObj = milestoneOptions.find((m) => m.key === activeMilestone) || milestoneOptions[0];
  const milestoneLabel = activeMilestoneObj.label;

  const provNodes = (schemas?.registry || []).filter((n) => n.role === 'Provincial Node');
  let rawRows = [];
  if (activeMilestone === 'overall') {
    rawRows = analytics.nepProvinceBreakdown || [];
  } else {
    const msMap = (analytics.nepMilestoneList && analytics.nepMilestoneList[activeMilestone]) || {};
    rawRows = provNodes.map((n) => {
      const item = msMap[n.code] || { lhs: 0, area: 0, arbs: 0, year: 2026 };
      return {
        code: n.code,
        jurisdiction: n.jurisdiction,
        provinceName: n.provinceName,
        lhs: item.lhs || 0,
        sem1Lhs: item.sem1Lhs,
        sem2Lhs: item.sem2Lhs,
        area: item.area || 0,
        sem1Area: item.sem1Area,
        sem2Area: item.sem2Area,
        arbs: item.arbs || 0,
        sem1Arbs: item.sem1Arbs,
        sem2Arbs: item.sem2Arbs,
        year: item.year || 2026
      };
    });
  }
  if (provinceScope) {
    rawRows = rawRows.filter((r) => r.code === provinceScope.code);
  }

  const hubUrl = (schemas?.registry || []).find((n) => n.code === 'HUB')?.url || '';
  const canEditNep = currentUser ? currentUser.role === 'admin' : !provinceScope;

  const availableYearsSet = new Set(rawRows.map((r) => r.year).filter(Boolean));
  availableYearsSet.add(new Date().getFullYear());
  for (const r of analytics.nepProvinceBreakdown || []) {
    const yr = Math.round(Number(r?.year) || 0);
    if (yr >= 2000 && yr <= 2099) availableYearsSet.add(yr);
  }
  for (const msMap of Object.values(analytics.nepMilestoneList || {})) {
    if (msMap && typeof msMap === 'object') {
      for (const r of Object.values(msMap)) {
        const yr = Math.round(Number(r?.year) || 0);
        if (yr >= 2000 && yr <= 2099) availableYearsSet.add(yr);
      }
    }
  }
  for (const yr of analytics.availableMilestoneYears || []) {
    if (yr >= 2000 && yr <= 2099) availableYearsSet.add(yr);
  }
  const availableYears = Array.from(availableYearsSet).sort((a, b) => b - a);

  const activeFilter = String(nepYearFilter || 'ALL');
  let filteredRows =
    activeFilter === 'ALL'
      ? rawRows
      : rawRows.filter((r) => String(r.year || 2026) === activeFilter);

  // If year filter resulted in 0 rows but rawRows has data, fallback to rawRows so the table is never empty/hidden
  if (filteredRows.length === 0 && rawRows.length > 0) {
    filteredRows = rawRows;
  }

  const totals = {
    lhs: filteredRows.reduce((s, r) => s + (Number(r.lhs) || 0), 0),
    area: Number(filteredRows.reduce((s, r) => s + (Number(r.area) || 0), 0).toFixed(4)),
    arbs: filteredRows.reduce((s, r) => s + (Number(r.arbs) || 0), 0)
  };

  const visibleColCount = 1 + (nepColVisibility.lhs ? 1 : 0) + (nepColVisibility.area ? 1 : 0) + (nepColVisibility.arbs ? 1 : 0) + 1 + (canEditNep ? 1 : 0);

  const yearText = activeFilter === 'ALL' ? (availableYears.join(', ') || 'All Years') : activeFilter;

  return `
    <!-- Top Filter & Action Toolbar -->
    <div class="panel" style="margin-bottom: 18px; padding: 12px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <!-- Milestone Selector Filter -->
          <div style="display:flex;align-items:center;gap:8px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--dar-green);"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span style="font-weight:700;font-size:13px;color:var(--text);">Milestone:</span>
            <select class="form-control nep-filter-select" id="nep-milestone-filter" aria-label="Select NEP Milestone" style="font-weight:700;min-width:210px;">
              ${milestoneOptions
                .map(
                  (m) => `<option value="${esc(m.key)}" ${activeMilestone === m.key ? 'selected' : ''}>${esc(m.label)}</option>`
                )
                .join('')}
            </select>
          </div>

          <!-- Target Year Filter -->
          <div style="display:flex;align-items:center;gap:8px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--dar-green);"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span style="font-weight:700;font-size:13px;color:var(--text);">Target Year:</span>
            <select class="form-control nep-filter-select" id="nep-year-filter" aria-label="Filter NEP by Year" style="font-weight:700;">
              <option value="ALL" ${activeFilter === 'ALL' ? 'selected' : ''}>All Years</option>
              ${availableYears
                .map(
                  (y) => `<option value="${y}" ${String(activeFilter) === String(y) ? 'selected' : ''}>Year ${y}</option>`
                )
                .join('')}
            </select>
          </div>
          <span class="badge badge-green">${filteredRows.length} ${filteredRows.length === 1 ? 'Province' : 'Provinces'} Shown</span>
          <span class="badge badge-blue">${esc(milestoneLabel)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${hubUrl ? `<a href="${esc(hubUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Open NEP Sheet ↗</a>` : ''}
          <button type="button" class="btn btn-secondary btn-sm" id="btn-sync-nep-sheet">Sync Hub NEP Sheet</button>
          ${
            canEditNep
              ? `<button type="button" class="btn btn-primary btn-sm" id="btn-edit-nep-sheet" data-milestone="${esc(activeMilestone)}">
                   <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:5px;vertical-align:-2px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                   Put NEP Data / Edit Figures
                 </button>`
              : ''
          }
        </div>
      </div>
    </div>

    <!-- Top NEP Summary KPIs (Clean Grid-4 Cards) -->
    <section class="grid-4" style="margin-bottom: 22px;">
      <div class="kpi-card">
        <div class="kpi-label">NEP Total Landholdings</div>
        <div class="kpi-primary">${(totals.lhs || 0).toLocaleString('en-US')} LHS</div>
        <div class="kpi-secondary">${esc(milestoneLabel)}</div>
        <div class="kpi-meta">Allocated across 6 provinces (${esc(yearText)})</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">NEP Total Area</div>
        <div class="kpi-primary">${fmtArea(totals.area || 0)} HAS</div>
        <div class="kpi-secondary">CARPable Hectares</div>
        <div class="kpi-meta">${esc(milestoneLabel)} (${esc(yearText)})</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">NEP Total ARBs</div>
        <div class="kpi-primary">${(totals.arbs || 0).toLocaleString('en-US')} ARBs</div>
        <div class="kpi-secondary">Target Beneficiaries</div>
        <div class="kpi-meta">${esc(milestoneLabel)} (${esc(yearText)})</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Selected Milestone &amp; Year</div>
        <div class="kpi-primary" style="font-size:18px;line-height:1.3;">${esc(milestoneLabel)}</div>
        <div class="kpi-secondary">Target Year: <strong>${esc(yearText)}</strong></div>
        <div class="kpi-meta">${canEditNep ? 'Click "Put NEP Data" to modify' : 'Read-only access'}</div>
      </div>
    </section>

    <!-- Provincial Allocation Section (Table View by Default with View Switcher) -->
    <div class="panel" id="panel-nep-provincial" style="margin-bottom: 22px;">
      <div class="panel-header" style="flex-wrap:wrap;gap:12px;">
        <div>
          <h3 class="panel-title">${nepDisplayMode === 'cards' ? 'Provincial Allocation Cards' : 'Provincial Allocation Table'}</h3>
          <p class="panel-subtitle">Per-province breakdown displaying LHS, AREA (HAS), ARBs, and Target Year for <strong>${esc(milestoneLabel)}</strong></p>
        </div>
        <div class="panel-actions" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <!-- View Switcher Pills -->
          <div class="nep-metric-pills" role="group" aria-label="Provincial Allocation View Mode">
            <button type="button" class="btn btn-sm ${nepDisplayMode !== 'cards' ? 'btn-primary' : 'btn-secondary'}" data-nep-mode="table" title="Table View">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:-2px;"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
              Table View
            </button>
            <button type="button" class="btn btn-sm ${nepDisplayMode === 'cards' ? 'btn-primary' : 'btn-secondary'}" data-nep-mode="cards" title="Card View">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:-2px;"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              Card View
            </button>
          </div>

          <!-- Column Hide / Unhide Pills for LHS, AREA, ARBs -->
          <div class="nep-metric-pills nep-column-toggles" role="group" aria-label="Toggle Metric Columns" style="display:flex;align-items:center;gap:4px;background:var(--surface);padding:3px 6px;border-radius:6px;border:1px solid var(--border);">
            <span style="font-size:11.5px;font-weight:700;color:var(--text-muted);margin-right:2px;">Columns:</span>
            <button type="button" class="btn btn-xs ${nepColVisibility.lhs ? 'btn-primary' : 'btn-secondary'}" data-toggle-nep-col="lhs" title="${nepColVisibility.lhs ? 'Click to hide LHS' : 'Click to show LHS'}">
              ${nepColVisibility.lhs ? '✓ LHS' : '+ LHS'}
            </button>
            <button type="button" class="btn btn-xs ${nepColVisibility.area ? 'btn-primary' : 'btn-secondary'}" data-toggle-nep-col="area" title="${nepColVisibility.area ? 'Click to hide AREA' : 'Click to show AREA'}">
              ${nepColVisibility.area ? '✓ AREA' : '+ AREA'}
            </button>
            <button type="button" class="btn btn-xs ${nepColVisibility.arbs ? 'btn-primary' : 'btn-secondary'}" data-toggle-nep-col="arbs" title="${nepColVisibility.arbs ? 'Click to hide ARBs' : 'Click to show ARBs'}">
              ${nepColVisibility.arbs ? '✓ ARBs' : '+ ARBs'}
            </button>
          </div>

          ${
            canEditNep
              ? `<button type="button" class="btn btn-primary btn-sm" id="btn-card-edit-nep" data-milestone="${esc(activeMilestone)}" style="font-weight:600;">
                   <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:5px;vertical-align:-2px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                   Put Data / Edit Figures
                 </button>`
              : ''
          }
          <button type="button" class="btn btn-secondary btn-sm btn-fullscreen" id="btn-fullscreen-nep-view" title="Full Screen Table">
            <span class="fs-icon">⛶</span> <span class="fs-label">Full Screen</span>
          </button>
        </div>
      </div>

      ${
        nepDisplayMode === 'cards'
          ? `
        <div class="grid-3 nep-province-cards-grid" style="padding:16px;">
          ${filteredRows
            .map(
              (r) => `
            <div class="nep-province-card">
              <div class="nep-province-card-header">
                <div class="nep-province-name">${esc(r.provinceName)}</div>
                <span class="nep-province-code">${esc(r.code)}</span>
              </div>
              <div class="nep-stats-row">
                ${nepColVisibility.lhs ? `
                <div class="nep-stat-box">
                  <span class="nep-stat-label">LHS</span>
                  <span class="nep-stat-val">${(Number(r.lhs) || 0).toLocaleString('en-US')}</span>
                  ${r.sem1Lhs !== undefined ? `<span style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">1st: ${r.sem1Lhs} • 2nd: ${r.sem2Lhs ?? Math.max(0, (r.lhs || 0) - r.sem1Lhs)}</span>` : ''}
                </div>` : ''}
                ${nepColVisibility.area ? `
                <div class="nep-stat-box">
                  <span class="nep-stat-label">AREA (HAS)</span>
                  <span class="nep-stat-val">${fmtArea(r.area || 0)}</span>
                  ${r.sem1Area !== undefined ? `<span style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">1st: ${fmtArea(r.sem1Area)} • 2nd: ${fmtArea(r.sem2Area ?? Math.max(0, (r.area || 0) - r.sem1Area))}</span>` : ''}
                </div>` : ''}
                ${nepColVisibility.arbs ? `
                <div class="nep-stat-box">
                  <span class="nep-stat-label">ARBs</span>
                  <span class="nep-stat-val">${(Number(r.arbs) || 0).toLocaleString('en-US')}</span>
                  ${r.sem1Arbs !== undefined ? `<span style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">1st: ${r.sem1Arbs} • 2nd: ${r.sem2Arbs ?? Math.max(0, (r.arbs || 0) - r.sem1Arbs)}</span>` : ''}
                </div>` : ''}
              </div>
              <div class="nep-card-footer">
                <span>Target Year: <strong>${esc(String(r.year || 2026))}</strong></span>
                ${
                  canEditNep
                    ? `<button type="button" class="btn btn-ghost btn-sm btn-edit-single-nep" data-prov="${esc(r.code)}" data-milestone="${esc(activeMilestone)}" style="padding:2px 8px;font-size:11.5px;color:var(--dar-green-dark);font-weight:700;">Edit Figure ↗</button>`
                    : '<span class="badge badge-gray">Read-Only</span>'
                }
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `
          : `
        <div class="table-wrap nep-prov-table-wrap">
          <table class="nep-sheet-table">
            <thead>
              <tr>
                <th class="sticky-col-province" style="min-width:180px;">Province</th>
                ${nepColVisibility.lhs ? '<th class="right" style="width:130px;">LHS</th>' : ''}
                ${nepColVisibility.area ? '<th class="right" style="width:160px;">AREA (HAS)</th>' : ''}
                ${nepColVisibility.arbs ? '<th class="right" style="width:130px;">ARBs</th>' : ''}
                <th class="center" style="width:120px;">Target Year</th>
                ${canEditNep ? '<th class="center" style="width:130px;">Action</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${filteredRows.length === 0 ? `
                <tr>
                  <td colspan="${visibleColCount}" class="center" style="padding:28px 16px;color:var(--text-muted);">
                    No provincial records found. Click <strong>Put Data / Edit Figures</strong> to set targets.
                  </td>
                </tr>
              ` : filteredRows
                .map(
                  (r) => `
                <tr>
                  <td class="sticky-col-province">
                    <strong>${esc(r.provinceName)}</strong>
                    <div class="nep-sub-metric">${esc(r.code)}</div>
                  </td>
                  ${nepColVisibility.lhs ? `
                  <td class="right" style="font-weight:600;">
                    <div>${(Number(r.lhs) || 0).toLocaleString('en-US')}</div>
                    ${r.sem1Lhs !== undefined ? `<div class="nep-sub-metric" style="font-size:11px;color:var(--text-muted);">1st: ${r.sem1Lhs} • 2nd: ${r.sem2Lhs ?? Math.max(0, (r.lhs || 0) - r.sem1Lhs)}</div>` : ''}
                  </td>` : ''}
                  ${nepColVisibility.area ? `
                  <td class="right" style="font-weight:700;color:var(--dar-green-dark);">
                    <div>${fmtArea(r.area || 0)}</div>
                    ${r.sem1Area !== undefined ? `<div class="nep-sub-metric" style="font-size:11px;color:var(--text-muted);font-weight:normal;">1st: ${fmtArea(r.sem1Area)} • 2nd: ${fmtArea(r.sem2Area ?? Math.max(0, (r.area || 0) - r.sem1Area))}</div>` : ''}
                  </td>` : ''}
                  ${nepColVisibility.arbs ? `
                  <td class="right" style="font-weight:600;">
                    <div>${(Number(r.arbs) || 0).toLocaleString('en-US')}</div>
                    ${r.sem1Arbs !== undefined ? `<div class="nep-sub-metric" style="font-size:11px;color:var(--text-muted);">1st: ${r.sem1Arbs} • 2nd: ${r.sem2Arbs ?? Math.max(0, (r.arbs || 0) - r.sem1Arbs)}</div>` : ''}
                  </td>` : ''}
                  <td class="center"><span class="badge badge-gray" style="font-weight:700;">${esc(String(r.year || 2026))}</span></td>
                  ${
                    canEditNep
                      ? `<td class="center">
                           <button type="button" class="btn btn-ghost btn-sm btn-edit-single-nep" data-prov="${esc(r.code)}" data-milestone="${esc(activeMilestone)}" style="padding:3px 10px;font-size:12px;color:var(--dar-green-dark);font-weight:700;">
                             Edit Figure ↗
                           </button>
                         </td>`
                      : ''
                  }
                </tr>
              `
                )
                .join('')}
              ${
                filteredRows.length > 1
                  ? `
                <tr style="font-weight:700;background:var(--surface-alt, #f8faf9);border-top:2px solid var(--border);">
                  <td class="sticky-col-province">Region VIII Total</td>
                  ${nepColVisibility.lhs ? `<td class="right">${(Number(totals.lhs) || 0).toLocaleString('en-US')}</td>` : ''}
                  ${nepColVisibility.area ? `<td class="right" style="color:var(--dar-green-dark);">${fmtArea(totals.area || 0)}</td>` : ''}
                  ${nepColVisibility.arbs ? `<td class="right">${(Number(totals.arbs) || 0).toLocaleString('en-US')}</td>` : ''}
                  <td class="center"><span class="badge badge-green" style="font-weight:700;">${esc(yearText)}</span></td>
                  ${canEditNep ? '<td class="center">-</td>' : ''}
                </tr>
              `
                  : ''
              }
            </tbody>
          </table>
        </div>
      `
      }
    </div>

    <!-- Regional List — Per-Milestone NEP Targets -->
    ${renderMilestoneNepSection(ctx)}
  `;
}

export function renderTargetSummaryView(ctx) {
  return `
    ${renderEmptyWorkspaceCallout(ctx.state)}
    ${renderMilestoneNepSection(ctx)}
  `;
}

function formatReportedMonthDisplay(val) {
  if (!val || !String(val).trim()) return '—';
  const s = String(val).trim();
  const match = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (match) {
    const yr = match[1];
    const mo = parseInt(match[2], 10) - 1;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (mo >= 0 && mo < 12) return `${months[mo]} ${yr}`;
  }
  return s;
}

export const WHEREABOUTS_CONFIGS = {
  'cf-whereabouts': {
    tabName: 'CF(DOC)',
    viewKey: 'cf-whereabouts',
    badgeIcon: '📄',
    title: 'CF Whereabouts & Date Summary',
    subtitle: 'Claim Folder (CF) Tracking • Date FI Conducted • Date Prepared & Signed • Reported Month',
    openTabName: 'CF(DOC)',
    dates: [
      { key: 'dateFiConducted', label: 'DATE FI CONDUCTED', shortLabel: 'FI Conducted', badgeClass: 'badge-green', icon: '✔' },
      { key: 'datePreparedSigned', label: 'DATE PREPARED & SIGNED', shortLabel: 'Prepared & Signed', badgeClass: 'badge-blue', icon: '✔' },
      { key: 'reportedMonth', label: 'REPORTED MONTH', shortLabel: 'Reported Month', badgeClass: 'badge-amber', isMonth: true }
    ],
    resolveStage: (row) => {
      const hasFi = Boolean(row.dateFiConducted);
      const hasPrep = Boolean(row.datePreparedSigned);
      const hasMonth = Boolean(row.reportedMonth);
      if (hasFi && hasPrep && hasMonth) return { stage: 'Completed & Reported', badge: 'badge-green' };
      if (hasPrep) return { stage: 'Prepared & Signed', badge: 'badge-blue' };
      if (hasFi) return { stage: 'FI Conducted', badge: 'badge-amber' };
      if (hasMonth) return { stage: 'Reported (Pending Dates)', badge: 'badge-purple' };
      return { stage: 'Pending FI', badge: 'badge-gray' };
    },
    extraColHeader: 'Target',
    extraColValue: (r) => `<span class="badge ${r.target === 'Current' ? 'badge-blue' : 'badge-gray'}">${esc(r.target || 'Current')}</span>`
  },
  'survey-whereabouts': {
    tabName: 'Survey',
    viewKey: 'survey-whereabouts',
    badgeIcon: '📐',
    title: 'Survey Whereabouts & Date Summary',
    subtitle: 'Land Survey Milestone Tracking • Field Work Dates • SR Forwarded • DENR-SMD Acceptance • ASP Date • Reported Month',
    openTabName: 'Survey',
    dates: [
      { key: 'dateRss', label: 'DATE RSS', shortLabel: 'With RSS', badgeClass: 'badge-blue', icon: '✔' },
      { key: 'fieldWorkStartDate', label: 'FIELD WORK STARTED', shortLabel: 'Ongoing FW', badgeClass: 'badge-purple', icon: '✔' },
      { key: 'fieldWorkCompletionDate', label: 'FIELD WORK COMPLETED', shortLabel: 'FW Completed', badgeClass: 'badge-green', icon: '✔' },
      { key: 'finalizedSrDate', label: 'FINALIZED SR', shortLabel: 'Finalized SR', badgeClass: 'badge-blue', icon: '✔' },
      { key: 'srForwardedToDarro', label: 'SR FORWARDED TO DARRO', shortLabel: 'SR to DARRO', badgeClass: 'badge-purple', icon: '✔' },
      { key: 'srAcceptedByDarro', label: 'SR ACCEPTED BY DARRO', shortLabel: 'SR Accepted DARRO', badgeClass: 'badge-green', icon: '✔' },
      { key: 'srReturnedDarroToDarpoDate', label: 'SR RETURNED DARRO TO DARPO', shortLabel: 'Returned DARRO->DARPO', badgeClass: 'badge-amber', icon: '↩' },
      { key: 'srResubmittedDarroDate', label: 'SR RE-SUBMITTED TO DARRO', shortLabel: 'Re-submitted DARRO', badgeClass: 'badge-blue', icon: '✔' },
      { key: 'dateAcceptedDenrSmd', label: 'ACCEPTED BY DENR-SMD', shortLabel: 'Accepted DENR-SMD', badgeClass: 'badge-purple', icon: '✔' },
      { key: 'srReturnedDenrToDarroDate', label: 'SR RETURNED DENR TO DARRO', shortLabel: 'Returned DENR->DARRO', badgeClass: 'badge-amber', icon: '↩' },
      { key: 'aspDate', label: 'ASP DATE', shortLabel: 'ASP Date', badgeClass: 'badge-green', icon: '✔', isKeyMilestone: true },
      { key: 'reportedMonth', label: 'REPORTED MONTH', shortLabel: 'Reported Month', badgeClass: 'badge-amber', isMonth: true }
    ],
    resolveStage: (row) => {
      if (row.aspDate) return { stage: 'ASP Approved', badge: 'badge-green' };
      if (row.srReturnedDenrToDarroDate) return { stage: 'Returned by DENR-SMD', badge: 'badge-amber' };
      if (row.dateAcceptedDenrSmd) return { stage: 'Accepted by DENR-SMD', badge: 'badge-purple' };
      if (row.srTransmittedDenrSmdDate) return { stage: 'Transmitted to DENR-SMD', badge: 'badge-blue' };
      if (row.srResubmittedDarroDate) return { stage: 'Re-submitted to DARRO', badge: 'badge-blue' };
      if (row.srReturnedDarroToDarpoDate) return { stage: 'Returned to DARPO', badge: 'badge-amber' };
      if (row.srAcceptedByDarro) return { stage: 'SR Accepted by DARRO', badge: 'badge-green' };
      if (row.srForwardedToDarro) return { stage: 'SR Forwarded to DARRO', badge: 'badge-purple' };
      if (row.finalizedSrDate) return { stage: 'Finalized SR', badge: 'badge-blue' };
      if (row.fieldWorkCompletionDate) return { stage: 'Field Work Completed', badge: 'badge-green' };
      if (row.fieldWorkStartDate) return { stage: 'Ongoing Field Work', badge: 'badge-amber' };
      if (row.dateRss) return { stage: 'With RSS', badge: 'badge-blue' };
      if (row.reportedMonth) return { stage: 'Reported (Pending Dates)', badge: 'badge-purple' };
      return { stage: 'Pending Survey', badge: 'badge-gray' };
    },
    extraColHeader: 'Survey Details',
    extraColValue: (r) => `<span class="badge badge-gray">${esc(r.aspNo ? `ASP: ${r.aspNo}` : (r.kindOfSurvey || '—'))}</span>`
  },
  'mov-whereabouts': {
    tabName: 'MOV',
    viewKey: 'mov-whereabouts',
    badgeIcon: '💰',
    title: 'MOV (Land Valuation) Whereabouts & Date Summary',
    subtitle: 'Memorandum of Valuation Tracking • PPU Date • Received at DARPO • Date of MOV • Transmitted to LBP/AOC • Reported Month',
    openTabName: 'MOV',
    dates: [
      { key: 'ppuDate', label: 'PPU DATE', shortLabel: 'PPU Date', badgeClass: 'badge-purple', icon: '✔' },
      { key: 'dateReceivedDarpo', label: 'RECEIVED DARPO', shortLabel: 'Received DARPO', badgeClass: 'badge-blue', icon: '✔' },
      { key: 'dateOfMov', label: 'DATE OF MOV', shortLabel: 'Date of MOV', badgeClass: 'badge-amber', icon: '✔' },
      { key: 'dateTransLbpAoc', label: 'TRANS TO LBP/AOC', shortLabel: 'Trans to LBP/AOC', badgeClass: 'badge-green', icon: '✔', isKeyMilestone: true },
      { key: 'reportedMonth', label: 'REPORTED MONTH', shortLabel: 'Reported Month', badgeClass: 'badge-amber', isMonth: true }
    ],
    resolveStage: (row) => {
      if (row.dateTransLbpAoc) return { stage: 'Transmitted to LBP/AOC', badge: 'badge-green' };
      if (row.dateOfMov) return { stage: 'MOV Issued', badge: 'badge-blue' };
      if (row.dateReceivedDarpo) return { stage: 'Received at DARPO', badge: 'badge-purple' };
      if (row.ppuDate) return { stage: 'PPU Reviewed', badge: 'badge-amber' };
      return { stage: 'Pending Valuation', badge: 'badge-gray' };
    },
    extraColHeader: 'Claim / Comp.',
    extraColValue: (r) => `<span class="badge badge-gray">${esc(r.lbpClaimNumber ? `Claim: ${r.lbpClaimNumber}` : (r.compensationAmount ? `₱${r.compensationAmount}` : '—'))}</span>`
  },
  'regdist-whereabouts': {
    tabName: 'RegistrationDistribution',
    viewKey: 'regdist-whereabouts',
    badgeIcon: '📜',
    title: 'Registration & Distribution Whereabouts & Date Summary',
    subtitle: 'EP CLOA Registration & Distribution Tracking • Date Registered • Date of Distribution • Month Reported',
    openTabName: 'RegistrationDistribution',
    dates: [
      { key: 'dateRegistered', label: 'DATE REGISTERED', shortLabel: 'Date Registered', badgeClass: 'badge-blue', icon: '✔' },
      { key: 'dateOfDistribution', label: 'DATE OF DISTRIBUTION', shortLabel: 'Date Distributed', badgeClass: 'badge-green', icon: '✔', isKeyMilestone: true },
      { key: 'monthReported', label: 'MONTH REPORTED', shortLabel: 'Month Reported', badgeClass: 'badge-amber', isMonth: true }
    ],
    resolveStage: (row) => {
      if (row.dateOfDistribution) return { stage: 'Distributed to ARBs', badge: 'badge-green' };
      if (row.dateRegistered) return { stage: 'Registered with ROD', badge: 'badge-blue' };
      if (row.monthReported) return { stage: 'Reported (Pending Reg)', badge: 'badge-amber' };
      return { stage: 'Pending Registration', badge: 'badge-gray' };
    },
    extraColHeader: 'Titles / ARBs',
    extraColValue: (r) => `<span class="badge badge-gray">${esc(`${r.noOfTitles || 0} Titles • ${r.noOfArbs || 0} ARBs`)}</span>`
  },
  'installation-whereabouts': {
    tabName: 'Installation',
    viewKey: 'installation-whereabouts',
    badgeIcon: '🌱',
    title: 'Installation Whereabouts & Date Summary',
    subtitle: 'Physical Installation Tracking • Date Registered • Date Distributed • Date of Installation • Month Reported',
    openTabName: 'Installation',
    dates: [
      { key: 'dateRegistered', label: 'DATE REGISTERED', shortLabel: 'Date Registered', badgeClass: 'badge-blue', icon: '✔' },
      { key: 'dateDistributed', label: 'DATE DISTRIBUTED', shortLabel: 'Date Distributed', badgeClass: 'badge-purple', icon: '✔' },
      { key: 'dateOfInstallation', label: 'DATE OF INSTALLATION', shortLabel: 'Date Installed', badgeClass: 'badge-green', icon: '✔', isKeyMilestone: true },
      { key: 'monthReported', label: 'MONTH REPORTED', shortLabel: 'Month Reported', badgeClass: 'badge-amber', isMonth: true }
    ],
    resolveStage: (row) => {
      const isInst = String(row.installedStatus || '').trim().toLowerCase() === 'yes' || Boolean(row.dateOfInstallation);
      if (isInst) return { stage: 'Installed on Land', badge: 'badge-green' };
      if (row.dateDistributed) return { stage: 'Distributed', badge: 'badge-purple' };
      if (row.dateRegistered) return { stage: 'Registered', badge: 'badge-blue' };
      return { stage: 'Pending Installation', badge: 'badge-gray' };
    },
    extraColHeader: 'Installed Status',
    extraColValue: (r) => `<span class="badge ${String(r.installedStatus || '').toLowerCase() === 'yes' ? 'badge-green' : 'badge-gray'}">${esc(r.installedStatus ? `Installed: ${r.installedStatus}` : `${r.noOfArbs || 0} ARBs`)}</span>`
  }
};

export const DEFAULT_SURVEY_STATUS_BENCHMARKS = [
  { code: 'BIL', name: 'BILIRAN', targetLhs: 71, targetArea: 189.3293, rssLhs: 70, rssArea: 185.4073, ongoingLhs: 61, ongoingArea: 163.6834, completedLhs: 61, completedArea: 163.6834 },
  { code: 'ESA', name: 'EASTERN SAMAR', targetLhs: 11, targetArea: 1081.0901, rssLhs: 9, rssArea: 422.4387, ongoingLhs: 7, ongoingArea: 393.6630, completedLhs: 7, completedArea: 393.6630 },
  { code: 'LEY', name: 'LEYTE', targetLhs: 882, targetArea: 8290.8248, rssLhs: 299, rssArea: 3030.3574, ongoingLhs: 298, ongoingArea: 2905.6177, completedLhs: 299, completedArea: 2907.8833 },
  { code: 'NSA', name: 'NORTHERN SAMAR', targetLhs: 14, targetArea: 311.7347, rssLhs: 11, rssArea: 273.9706, ongoingLhs: 7, ongoingArea: 224.5231, completedLhs: 4, completedArea: 50.1193 },
  { code: 'SAM', name: 'SAMAR', targetLhs: 38, targetArea: 10627.7120, rssLhs: 26, rssArea: 8551.3883, ongoingLhs: 25, ongoingArea: 7658.3322, completedLhs: 24, completedArea: 6443.2368 },
  { code: 'SLE', name: 'SOUTHERN LEYTE', targetLhs: 60, targetArea: 399.4011, rssLhs: 49, rssArea: 328.9620, ongoingLhs: 28, ongoingArea: 141.2464, completedLhs: 42, completedArea: 242.4080 }
];

export function matchesWhereaboutsTargetYear(r, selectedYear, currentYear = new Date().getFullYear()) {
  if (!selectedYear || selectedYear === 'ALL') return true;
  const s = String(selectedYear).trim().toLowerCase();
  const rYear = String(r.targetYear || r.year || '').trim().toLowerCase();
  if (rYear && (rYear === s || rYear.startsWith(s))) return true;
  const rTarget = String(r.target || '').trim().toLowerCase();
  if (rTarget === s) return true;
  if (s === String(currentYear)) {
    if (rTarget === 'current' || rTarget === 'current year') return true;
  }
  if (s.includes('prev') || s === 'previous year') {
    if (rTarget.includes('prev')) return true;
  }
  const dates = [r.dateFiConducted, r.datePreparedSigned, r.reportedMonth, ...(r.datesMap ? Object.values(r.datesMap) : [])].filter(Boolean);
  for (const dt of dates) {
    if (String(dt || '').toLowerCase().includes(s)) return true;
  }
  return false;
}

export function matchProvinceName(rowProv, targetProv) {
  const p = String(rowProv || '').trim().toUpperCase();
  const t = String(targetProv || '').trim().toUpperCase();
  if (!p || !t || t === 'ALL') return true;
  if (p === t) return true;

  const isTargetSouthern = t.includes('SOUTHERN') || t === 'SLE';
  const isTargetNorthern = t.includes('NORTHERN') || t === 'NSA';
  const isTargetEastern = t.includes('EASTERN') || t === 'ESA';
  const isTargetWesternOrSamar = (t.includes('WESTERN') || t.includes('SAMAR')) && !isTargetNorthern && !isTargetEastern;
  const isTargetLeyte = t.includes('LEYTE') && !isTargetSouthern;
  const isTargetBiliran = t.includes('BILIRAN') || t === 'BIL';

  const isRowSouthern = p.includes('SOUTHERN') || p === 'SLE';
  const isRowNorthern = p.includes('NORTHERN') || p === 'NSA';
  const isRowEastern = p.includes('EASTERN') || p === 'ESA';
  const isRowWesternOrSamar = (p.includes('WESTERN') || p.includes('SAMAR')) && !isRowNorthern && !isRowEastern;
  const isRowLeyte = p.includes('LEYTE') && !isRowSouthern;
  const isRowBiliran = p.includes('BILIRAN') || p === 'BIL';

  if (isTargetSouthern) return isRowSouthern;
  if (isTargetLeyte) return isRowLeyte;
  if (isTargetNorthern) return isRowNorthern;
  if (isTargetEastern) return isRowEastern;
  if (isTargetWesternOrSamar) return isRowWesternOrSamar;
  if (isTargetBiliran) return isRowBiliran;

  return p.includes(t) || t.includes(p);
}

export function resolveProvinceCode(provNameOrCode, schemas) {
  if (!provNameOrCode || provNameOrCode === 'ALL') return null;
  const pUpper = String(provNameOrCode).trim().toUpperCase();
  const provNodes = (schemas?.registry || []).filter((n) => n.role === 'Provincial Node');
  for (const n of provNodes) {
    if (n.code.toUpperCase() === pUpper) return n.code;
    const nName = n.provinceName.toUpperCase();
    if (pUpper === nName || pUpper.includes(nName) || nName.includes(pUpper)) {
      return n.code;
    }
  }
  if (pUpper.includes('SOUTHERN LEYTE') || pUpper.includes('SLE')) return 'SLE';
  if (pUpper.includes('LEYTE')) return 'LEY';
  if (pUpper.includes('BILIRAN') || pUpper.includes('BIL')) return 'BIL';
  if (pUpper.includes('EASTERN') || pUpper.includes('ESA')) return 'ESA';
  if (pUpper.includes('NORTHERN') || pUpper.includes('NSA')) return 'NSA';
  if (pUpper.includes('SAMAR') || pUpper.includes('SAM') || pUpper.includes('WSAM')) return 'SAM';
  return null;
}

export function getWhereaboutsRowDisplayValue(row, colKey, cfg) {
  if (!row) return '';
  if (colKey === 'province') return row.province || 'Unknown';
  if (colKey === 'municipality') return row.municipality || '—';
  if (colKey === 'barangay') return row.barangay || '—';
  if (colKey === 'landOwner') return row.landOwner || '—';
  if (colKey === 'titleNumber') return row.titleNumber || '—';
  if (colKey === 'lhid') return row.lhid || '—';
  if (colKey === 'target') return row.target || 'Current';
  if (colKey === 'stage') return row.stage || '—';
  if (row.datesMap && colKey in row.datesMap) {
    const raw = row.datesMap[colKey];
    if (raw && cfg?.dates?.find((d) => d.key === colKey)?.isMonth) {
      return formatReportedMonthDisplay(raw);
    }
    return raw || '';
  }
  return String(row[colKey] || '');
}

export function canonicalizeProvinceName(prov, schemas) {
  const p = String(prov || '').trim();
  if (!p) return '';
  const provNodes = (schemas?.registry || []).filter((n) => n.role === 'Provincial Node');
  for (const node of provNodes) {
    if (matchProvinceName(p, node.provinceName)) {
      return node.provinceName;
    }
  }
  return p;
}

export function getWhereaboutsColFilterLabel(filterSpec, fallback = '') {
  if (!filterSpec) return fallback;
  if (Array.isArray(filterSpec.values)) {
    const valid = filterSpec.values.filter((v) => v && v !== 'ALL');
    if (valid.length === 0) return fallback;
    if (valid.length === 1) return valid[0] === '__BLANK__' ? '(Blank)' : valid[0];
    if (valid.length === 2) return valid.map((v) => (v === '__BLANK__' ? '(Blank)' : v)).join(', ');
    return `${valid.length} selected`;
  }
  const val = String(filterSpec.value ?? '').trim();
  if (!val || val === 'ALL') return fallback;
  if (val === '__BLANK__') return '(Blank)';
  return val;
}

export function matchesWhereaboutsColFilter(row, colKey, spec, cfg) {
  if (!spec) return true;
  if (Array.isArray(spec.values)) {
    if (spec.values.length === 0) return true;
    return spec.values.some((v) => matchesSingleWhereaboutsColVal(row, colKey, v, spec.mode || 'exact', cfg));
  }
  if (!spec.value || spec.value === 'ALL') return true;
  return matchesSingleWhereaboutsColVal(row, colKey, spec.value, spec.mode || 'exact', cfg);
}

function matchesSingleWhereaboutsColVal(row, colKey, val, mode = 'exact', cfg) {
  const v = String(val ?? '').trim();
  if (!v || v === 'ALL') return true;
  const rawCell = getWhereaboutsRowDisplayValue(row, colKey, cfg);
  const cellVal = String(rawCell ?? '').trim();

  if (v === '__BLANK__') {
    return !cellVal || cellVal === '—' || cellVal === 'Undated / Pending';
  }

  if (colKey === 'province') {
    return matchProvinceName(cellVal, v);
  }

  if (colKey === 'landOwner') {
    const combined = `${row.landOwner || ''} ${row.titleNumber || ''}`.toLowerCase();
    return combined.includes(v.toLowerCase());
  }

  if (mode === 'exact') {
    return cellVal.toLowerCase() === v.toLowerCase();
  }
  return cellVal.toLowerCase().includes(v.toLowerCase());
}

export function getWhereaboutsColumnFilterValues(ctx, viewKey, colKey) {
  const cfg = WHEREABOUTS_CONFIGS[viewKey];
  if (!cfg) return { col: null, blankCount: 0, totalRows: 0, values: [] };

  const {
    state,
    schemas,
    provinceScope,
    whereaboutsColFilters = {},
    whereaboutsProvinceFilter = {},
    whereaboutsStatusFilter = {},
    whereaboutsTargetYearFilter = {},
    whereaboutsSearch = {}
  } = ctx;

  const rawRows = (state?.optool?.[cfg.tabName] || []).map((r, i) => ({ ...r, __originalIndex: i }));
  const dbRows = state?.optool?.Database || [];
  const dbMap = new Map();
  for (const db of dbRows) {
    const k = String(db.lhid || '').trim().toLowerCase();
    if (k && !dbMap.has(k)) dbMap.set(k, db);
  }

  const enrichedRows = rawRows.map((row) => {
    const lhidKey = String(row.lhid || '').trim().toLowerCase();
    const db = dbMap.get(lhidKey) || {};
    const carpableNum = parseNumericValue(db.carpable || row.carpable || row.areaHas || row.areaHas1 || row.areaHas2 || row.computedArea || 0);
    const provName = db.province || row.province || (provinceScope ? provinceScope.provinceName : 'Unknown');
    const muniName = db.municipality || row.municipality || '—';
    const brgyName = db.barangay || row.barangay || '—';
    const titleNum = db.titleNumber || row.titleNumber || row.rodTitleNo || row.titleOrTaxDecNo || '—';
    const landOwner = db.landOwner || row.landOwner || (row.loLastName ? `${row.loLastName}, ${row.loFirstName || ''}` : '') || row.arbName || '—';

    const datesMap = {};
    let populatedDatesCount = 0;
    for (const d of cfg.dates) {
      const rawVal = String(row[d.key] || '').trim();
      datesMap[d.key] = rawVal;
      if (rawVal) populatedDatesCount++;
    }
    const isAllDatesPopulated = populatedDatesCount === cfg.dates.length;
    const { stage, badge: stageBadge } = cfg.resolveStage({ ...row, ...datesMap });

    return {
      ...row,
      lhid: row.lhid || db.lhid || '—',
      province: provName,
      municipality: muniName,
      barangay: brgyName,
      titleNumber: titleNum,
      landOwner: landOwner,
      carpable: carpableNum,
      datesMap,
      populatedDatesCount,
      isAllDatesPopulated,
      stage,
      stageBadge
    };
  });

  const activeColFilters = { ...(whereaboutsColFilters[viewKey] || {}) };
  delete activeColFilters[colKey];

  const curYear = new Date().getFullYear();
  const searchVal = whereaboutsSearch[viewKey] || '';
  const provFilterSpec = colKey === 'province' ? null : activeColFilters.province;
  const provFilterVal = provFilterSpec?.value || whereaboutsProvinceFilter[viewKey] || 'ALL';
  let selectedProvs = [];
  if (provFilterSpec && Array.isArray(provFilterSpec.values) && provFilterSpec.values.length > 0) {
    selectedProvs = provFilterSpec.values.filter((v) => v && v !== 'ALL');
  } else if (provFilterVal && provFilterVal !== 'ALL') {
    selectedProvs = [provFilterVal];
  }
  const statusFilterVal = colKey === 'stage' ? 'ALL' : (activeColFilters.stage?.value || whereaboutsStatusFilter[viewKey] || 'ALL');
  const targetYearFilterVal = whereaboutsTargetYearFilter[viewKey] || 'ALL';

  let matching = enrichedRows.filter((r) => {
    if (provinceScope && r.province && !r.province.toUpperCase().includes(provinceScope.code)) {
      const pNorm = r.province.toUpperCase();
      if (!pNorm.includes(provinceScope.provinceName.toUpperCase())) return false;
    }
    if (selectedProvs.length > 0) {
      if (!selectedProvs.some((p) => matchProvinceName(r.province, p))) return false;
    }
    if (viewKey === 'cf-whereabouts' && targetYearFilterVal !== 'ALL') {
      if (!matchesWhereaboutsTargetYear(r, targetYearFilterVal, curYear)) return false;
    }
    for (const [k, spec] of Object.entries(activeColFilters)) {
      if (k === colKey || k === 'province') continue;
      if (!matchesWhereaboutsColFilter(r, k, spec, cfg)) return false;
    }
    if (statusFilterVal !== 'ALL') {
      if (statusFilterVal === 'all_complete' && !r.isAllDatesPopulated) return false;
      if (statusFilterVal === 'pending' && r.isAllDatesPopulated) return false;
      if (statusFilterVal.startsWith('with_')) {
        const dKey = statusFilterVal.replace('with_', '');
        if (!r.datesMap[dKey]) return false;
      }
    }
    if (searchVal) {
      const dateText = Object.values(r.datesMap).join(' ');
      const hay = `${r.lhid} ${r.province} ${r.municipality} ${r.barangay} ${r.landOwner} ${r.titleNumber} ${dateText} ${r.stage}`.toLowerCase();
      if (!hay.includes(searchVal.toLowerCase())) return false;
    }
    return true;
  });

  let colLabel = colKey;
  let colType = 'text';
  if (colKey === 'province') colLabel = 'Province';
  else if (colKey === 'municipality') colLabel = 'Municipality';
  else if (colKey === 'landOwner') colLabel = 'Landowner / Title';
  else if (colKey === 'lhid') colLabel = 'LHID';
  else if (colKey === 'target') colLabel = cfg.extraColHeader || 'Target';
  else if (colKey === 'stage') colLabel = 'Whereabouts Status';
  else {
    const dObj = cfg.dates.find((d) => d.key === colKey);
    if (dObj) {
      colLabel = dObj.label;
      colType = dObj.isMonth ? 'month' : 'date';
    }
  }

  const counts = new Map();
  let blankCount = 0;

  for (const r of matching) {
    let rawVal = '';
    if (colKey === 'province') {
      rawVal = canonicalizeProvinceName(r.province, schemas);
    } else if (colKey === 'municipality') {
      rawVal = r.municipality;
    } else if (colKey === 'landOwner') {
      rawVal = r.landOwner;
    } else if (colKey === 'lhid') {
      rawVal = r.lhid;
    } else if (colKey === 'target') {
      rawVal = r.target || 'Current';
    } else if (colKey === 'stage') {
      rawVal = r.stage;
    } else if (r.datesMap && colKey in r.datesMap) {
      rawVal = r.datesMap[colKey];
      if (rawVal && cfg.dates.find((d) => d.key === colKey)?.isMonth) {
        rawVal = formatReportedMonthDisplay(rawVal);
      }
    } else {
      rawVal = String(r[colKey] || '');
    }

    const val = String(rawVal ?? '').trim();
    if (!val || val === '—' || val === 'Undated / Pending') {
      blankCount++;
    } else {
      counts.set(val, (counts.get(val) || 0) + 1);
    }
  }

  if (colKey === 'province') {
    const provNodes = (schemas?.registry || []).filter((n) => n.role === 'Provincial Node');
    for (const p of provNodes) {
      if (!counts.has(p.provinceName)) {
        counts.set(p.provinceName, 0);
      }
    }
  }

  const values = Array.from(counts.entries())
    .sort((a, b) => {
      if (a[1] > 0 && b[1] === 0) return -1;
      if (a[1] === 0 && b[1] > 0) return 1;
      return a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' });
    })
    .map(([value, count]) => ({ value, count }));

  return {
    col: { key: colKey, label: colLabel, type: colType },
    blankCount,
    totalRows: matching.length,
    values
  };
}

export function renderMilestoneWhereaboutsView(ctx, cfg) {
  const {
    state,
    schemas,
    provinceScope,
    whereaboutsSearch = {},
    whereaboutsProvinceFilter = {},
    whereaboutsStatusFilter = {},
    whereaboutsTargetYearFilter = {},
    whereaboutsColFilters = {},
    whereaboutsShowGraph = {},
    whereaboutsGraphMode = {},
    whereaboutsPage = {},
    surveyMetricMode = 'both',
    surveyIndicatorTab = 'all'
  } = ctx;

  const viewKey = cfg.viewKey;
  const activeColFilters = whereaboutsColFilters[viewKey] || {};
  const searchVal = whereaboutsSearch[viewKey] || '';
  const provFilterVal = activeColFilters.province?.value || whereaboutsProvinceFilter[viewKey] || 'ALL';
  const statusFilterVal = activeColFilters.stage?.value || whereaboutsStatusFilter[viewKey] || 'ALL';
  const pageVal = whereaboutsPage[viewKey] || 1;
  const targetYearFilterVal = whereaboutsTargetYearFilter[viewKey] || 'ALL';
  const isCfWhereabouts = viewKey === 'cf-whereabouts';
  const isSurveyWhereabouts = viewKey === 'survey-whereabouts';
  const showGraphVal = isCfWhereabouts || isSurveyWhereabouts
    ? Boolean(whereaboutsShowGraph[viewKey])
    : whereaboutsShowGraph[viewKey] !== false;
  const graphMode = whereaboutsGraphMode[viewKey] || 'graph';

  const rawRows = (state?.optool?.[cfg.tabName] || []).map((r, originalIndex) => ({
    ...r,
    __originalIndex: originalIndex
  }));
  const dbRows = state?.optool?.Database || [];
  const dbMap = new Map();
  for (const db of dbRows) {
    const k = String(db.lhid || '').trim().toLowerCase();
    if (k && !dbMap.has(k)) dbMap.set(k, db);
  }

  // Enrich each row with Database parcel attributes
  const enrichedRows = rawRows.map((row) => {
    const lhidKey = String(row.lhid || '').trim().toLowerCase();
    const db = dbMap.get(lhidKey) || {};
    const carpableNum = parseNumericValue(db.carpable || row.carpable || row.areaHas || row.areaHas1 || row.areaHas2 || row.computedArea || 0);
    const provName = db.province || row.province || (provinceScope ? provinceScope.provinceName : 'Unknown');
    const muniName = db.municipality || row.municipality || '—';
    const brgyName = db.barangay || row.barangay || '—';
    const titleNum = db.titleNumber || row.titleNumber || row.rodTitleNo || row.titleOrTaxDecNo || '—';
    const landOwner = db.landOwner || row.landOwner || (row.loLastName ? `${row.loLastName}, ${row.loFirstName || ''}` : '') || row.arbName || '—';

    // Dates map
    const datesMap = {};
    let populatedDatesCount = 0;
    for (const d of cfg.dates) {
      const rawVal = String(row[d.key] || '').trim();
      datesMap[d.key] = rawVal;
      if (rawVal) populatedDatesCount++;
    }
    const isAllDatesPopulated = populatedDatesCount === cfg.dates.length;
    const { stage, badge: stageBadge } = cfg.resolveStage({ ...row, ...datesMap });

    return {
      ...row,
      lhid: row.lhid || db.lhid || '—',
      province: provName,
      municipality: muniName,
      barangay: brgyName,
      titleNumber: titleNum,
      landOwner: landOwner,
      carpable: carpableNum,
      datesMap,
      populatedDatesCount,
      isAllDatesPopulated,
      stage,
      stageBadge
    };
  });

  const totalCount = enrichedRows.length;
  const totalArea = enrichedRows.reduce((sum, r) => sum + r.carpable, 0);
  const pct = (part, whole) => (whole > 0 ? ((part / whole) * 100).toFixed(1) : '0.0');

  // Filter scope rows by active province, search, status, and column filters
  const curYear = new Date().getFullYear();
  let scopeRows = enrichedRows;

  // 1. Province filter (from column dropdown or toolbar)
  const provFilterSpec = activeColFilters.province;
  let selectedProvs = [];
  if (provFilterSpec && Array.isArray(provFilterSpec.values) && provFilterSpec.values.length > 0) {
    selectedProvs = provFilterSpec.values.filter((v) => v && v !== 'ALL');
  } else if (provFilterVal && provFilterVal !== 'ALL') {
    selectedProvs = [provFilterVal];
  }

  if (selectedProvs.length > 0) {
    scopeRows = scopeRows.filter((r) => selectedProvs.some((p) => matchProvinceName(r.province, p)));
  }

  // 2. Additional column filters (municipality, landowner, dates, target, stage, lhid)
  for (const [k, spec] of Object.entries(activeColFilters)) {
    if (k === 'province') continue; // Handled above
    scopeRows = scopeRows.filter((r) => matchesWhereaboutsColFilter(r, k, spec, cfg));
  }

  // 3. Status filter (if set from toolbar and not overridden by column filter)
  if (statusFilterVal !== 'ALL' && !activeColFilters.stage) {
    if (statusFilterVal === 'all_complete') {
      scopeRows = scopeRows.filter((r) => r.isAllDatesPopulated);
    } else if (statusFilterVal === 'pending') {
      scopeRows = scopeRows.filter((r) => !r.isAllDatesPopulated);
    } else if (statusFilterVal.startsWith('with_')) {
      const dKey = statusFilterVal.replace('with_', '');
      scopeRows = scopeRows.filter((r) => Boolean(r.datesMap[dKey]));
    }
  }

  // 4. Search query
  const q = (searchVal || '').trim().toLowerCase();
  if (q) {
    scopeRows = scopeRows.filter((r) => {
      const dateText = Object.values(r.datesMap).join(' ');
      const hay = `${r.lhid} ${r.province} ${r.municipality} ${r.barangay} ${r.landOwner} ${r.titleNumber} ${dateText} ${r.stage}`.toLowerCase();
      return hay.includes(q);
    });
  }

  // Scope summary metrics (Filtered by Province & Column Filters!)
  const scopeCount = scopeRows.length;
  const scopeArea = scopeRows.reduce((s, r) => s + r.carpable, 0);
  const scopeDateMetrics = cfg.dates.map((d) => {
    const matched = scopeRows.filter((r) => Boolean(r.datesMap[d.key]));
    return {
      ...d,
      count: matched.length,
      area: matched.reduce((s, r) => s + r.carpable, 0),
      rate: pct(matched.length, scopeCount)
    };
  });
  const scopeAllCompleteRows = scopeRows.filter((r) => r.isAllDatesPopulated);
  const scopeAllCompleteCount = scopeAllCompleteRows.length;
  const scopeAllCompleteArea = scopeAllCompleteRows.reduce((s, r) => s + r.carpable, 0);
  const scopePendingCount = scopeCount - scopeAllCompleteCount;

  // Compute summary count & area for each configured date across all enrichedRows (for matrix)
  const dateMetrics = cfg.dates.map((d) => {
    const matched = enrichedRows.filter((r) => Boolean(r.datesMap[d.key]));
    return {
      ...d,
      count: matched.length,
      area: matched.reduce((s, r) => s + r.carpable, 0),
      rate: pct(matched.length, totalCount)
    };
  });

  const allCompleteRows = enrichedRows.filter((r) => r.isAllDatesPopulated);
  const allCompleteCount = allCompleteRows.length;
  const allCompleteArea = allCompleteRows.reduce((s, r) => s + r.carpable, 0);
  const pendingCount = totalCount - allCompleteCount;

  // Provincial Summary Matrix
  const provNodes = (schemas?.registry || []).filter((n) => n.role === 'Provincial Node');
  const provMap = new Map();
  for (const n of provNodes) {
    provMap.set(n.provinceName.toUpperCase(), {
      name: n.provinceName,
      code: n.code,
      total: 0,
      area: 0,
      dateCounts: {},
      completeCount: 0
    });
  }

  for (const r of enrichedRows) {
    const pKey = String(r.province || '').trim().toUpperCase();
    let pObj = provMap.get(pKey);
    if (!pObj) {
      for (const [k, v] of provMap.entries()) {
        if (pKey.includes(k) || k.includes(pKey)) {
          pObj = v;
          break;
        }
      }
    }
    if (!pObj) {
      pObj = {
        name: r.province || 'Other',
        code: 'OTHER',
        total: 0,
        area: 0,
        dateCounts: {},
        completeCount: 0
      };
      provMap.set(pKey, pObj);
    }
    pObj.total += 1;
    pObj.area += r.carpable;
    for (const d of cfg.dates) {
      if (r.datesMap[d.key]) {
        pObj.dateCounts[d.key] = (pObj.dateCounts[d.key] || 0) + 1;
      }
    }
    if (r.isAllDatesPopulated) pObj.completeCount += 1;
  }
  const provSummaryList = Array.from(provMap.values()).filter(
    (p) => !provinceScope || p.code === provinceScope.code
  );

  // Reported Month Summary Matrix
  const monthKeyObj = cfg.dates.find((d) => d.isMonth) || { key: 'reportedMonth' };
  const monthMap = new Map();
  for (const r of enrichedRows) {
    const rawM = r[monthKeyObj.key] || r.reportedMonth || r.monthReported || '';
    const mLabel = rawM ? formatReportedMonthDisplay(rawM) : 'Undated / Pending';
    if (!monthMap.has(mLabel)) {
      monthMap.set(mLabel, { label: mLabel, total: 0, area: 0, completeCount: 0 });
    }
    const mObj = monthMap.get(mLabel);
    mObj.total += 1;
    mObj.area += r.carpable;
    if (r.isAllDatesPopulated) mObj.completeCount += 1;
  }
  const monthSummaryList = Array.from(monthMap.values()).sort((a, b) => {
    if (a.label === 'Undated / Pending') return 1;
    if (b.label === 'Undated / Pending') return -1;
    return b.total - a.total;
  });

  // Table rows: filter scopeRows by target year (for CF and Survey Whereabouts)
  let filteredRows = scopeRows;
  if ((isCfWhereabouts || isSurveyWhereabouts) && targetYearFilterVal !== 'ALL') {
    filteredRows = filteredRows.filter((r) => matchesWhereaboutsTargetYear(r, targetYearFilterVal, curYear));
  }

  // Pagination
  const pageSize = 50;
  const totalFiltered = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(Math.max(1, Number(pageVal) || 1), totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Top KPI Cards for CF Whereabouts (Dynamically filtered by Province & Column Filters!)
  let cfKpiHtml = '';
  if (isCfWhereabouts) {
    // 1. Available Target Years
    const targetYearSet = new Set();
    targetYearSet.add(String(curYear));
    targetYearSet.add(String(curYear - 1));
    for (const pData of Object.values(state?.nepMilestoneList?.cf_doc || {})) {
      if (pData?.year) targetYearSet.add(String(pData.year));
    }
    for (const r of enrichedRows) {
      if (r.targetYear) targetYearSet.add(String(r.targetYear));
      if (r.target) targetYearSet.add(String(r.target));
      for (const dt of Object.values(r.datesMap)) {
        const m = String(dt || '').match(/\b(20\d{2})\b/);
        if (m) targetYearSet.add(m[1]);
      }
    }
    const numYears = Array.from(targetYearSet)
      .filter((y) => /^\d{4}$/.test(y))
      .sort((a, b) => Number(b) - Number(a));
    const otherYears = Array.from(targetYearSet)
      .filter((y) => !/^\d{4}$/.test(y))
      .sort();
    const allTargetYears = ['ALL', ...numYears, ...otherYears];

    // 2. Global Target: based on the Database worksheet per province
    let dbScopeRows = dbRows;
    if (provinceScope) {
      dbScopeRows = dbScopeRows.filter((r) => matchProvinceName(r.province, provinceScope.provinceName));
    }
    if (selectedProvs.length > 0) {
      dbScopeRows = dbScopeRows.filter((r) => selectedProvs.some((p) => matchProvinceName(r.province, p)));
    }

    let globalTargetLhs = dbScopeRows.length;
    let globalTargetArea = dbScopeRows.reduce((sum, r) => {
      return sum + parseNumericValue(r.carpable || r.areaHas || r.computedArea || 0);
    }, 0);

    // Fallback to nepMilestoneList / nepTargets if Database worksheet has no records
    const targetProvCodes = selectedProvs.map((p) => resolveProvinceCode(p, schemas)).filter(Boolean);
    const msMap = state?.nepMilestoneList?.cf_doc || {};
    if (globalTargetLhs === 0 && globalTargetArea === 0) {
      if (targetProvCodes.length > 0) {
        for (const pCode of targetProvCodes) {
          const pData = msMap[pCode];
          globalTargetLhs += Math.max(0, Math.round(Number(pData?.lhs) || 0));
          globalTargetArea += Math.max(0, Number(pData?.area) || 0);
        }
      } else {
        for (const [pCode, pData] of Object.entries(msMap)) {
          if (provinceScope && pCode !== provinceScope.code) continue;
          globalTargetLhs += Math.max(0, Math.round(Number(pData?.lhs) || 0));
          globalTargetArea += Math.max(0, Number(pData?.area) || 0);
        }
        if (globalTargetLhs === 0 && globalTargetArea === 0) {
          const regTarget = state?.nepTargets?.cf_doc || {};
          globalTargetLhs = Math.max(0, Math.round(Number(regTarget.targetCount) || 0));
          globalTargetArea = Math.max(0, Number(regTarget.targetAreaHas) || 0);
        }
      }
    }

    let targetBadgeText = '';
    if (selectedProvs.length === 1) {
      targetBadgeText = selectedProvs[0];
    } else if (selectedProvs.length > 1) {
      targetBadgeText = selectedProvs.length <= 2 ? selectedProvs.join(', ') : `${selectedProvs.length} Provinces`;
    } else {
      targetBadgeText = provinceScope ? provinceScope.provinceName : 'Region VIII';
    }

    // 3. Global Accomplishment (Dynamic based on filtered scopeRows!)
    const globalAccompLhs = scopeCount;
    const globalAccompArea = scopeArea;
    const accompBadgeText = targetBadgeText;

    // 4. Selected Year Target (Dynamic based on selected province & year)
    let selectedYearTargetLhs = 0;
    let selectedYearTargetArea = 0;
    if (targetProvCodes.length > 0) {
      for (const pCode of targetProvCodes) {
        const pData = msMap[pCode];
        const pYear = String(pData?.year || curYear);
        if (targetYearFilterVal === 'ALL' || pYear === String(targetYearFilterVal)) {
          selectedYearTargetLhs += Math.max(0, Math.round(Number(pData?.lhs) || 0));
          selectedYearTargetArea += Math.max(0, Number(pData?.area) || 0);
        }
      }
    } else {
      for (const [pCode, pData] of Object.entries(msMap)) {
        if (provinceScope && pCode !== provinceScope.code) continue;
        const pYear = String(pData?.year || curYear);
        if (targetYearFilterVal === 'ALL' || pYear === String(targetYearFilterVal)) {
          selectedYearTargetLhs += Math.max(0, Math.round(Number(pData?.lhs) || 0));
          selectedYearTargetArea += Math.max(0, Number(pData?.area) || 0);
        }
      }
    }

    // If no milestone target entered in nepMilestoneList for this year/province, fallback to Database target
    if (selectedYearTargetLhs === 0 && selectedYearTargetArea === 0) {
      if (targetYearFilterVal === 'ALL' || targetYearFilterVal === String(curYear)) {
        selectedYearTargetLhs = globalTargetLhs;
        selectedYearTargetArea = globalTargetArea;
      } else {
        const yearDbRows = dbScopeRows.filter((r) => matchesWhereaboutsTargetYear(r, targetYearFilterVal, curYear));
        selectedYearTargetLhs = yearDbRows.length;
        selectedYearTargetArea = yearDbRows.reduce((sum, r) => sum + parseNumericValue(r.carpable || r.areaHas || r.computedArea || 0), 0);
        if (selectedYearTargetLhs === 0 && selectedYearTargetArea === 0) {
          selectedYearTargetLhs = globalTargetLhs;
          selectedYearTargetArea = globalTargetArea;
        }
      }
    }

    // 5. Selected Year Actual Milestones (FI, Prepared & Signed, Reported Month)
    // Filtered by both Target Year AND the active scope (Province, Municipality, etc.)!
    const yearMatchingRows = scopeRows.filter((r) => matchesWhereaboutsTargetYear(r, targetYearFilterVal, curYear));
    const fiRows = yearMatchingRows.filter((r) => Boolean(r.datesMap.dateFiConducted));
    const prepRows = yearMatchingRows.filter((r) => Boolean(r.datesMap.datePreparedSigned));
    const repRows = yearMatchingRows.filter((r) => Boolean(r.datesMap.reportedMonth));

    const fiLhs = fiRows.length;
    const fiArea = fiRows.reduce((s, r) => s + r.carpable, 0);
    const prepLhs = prepRows.length;
    const prepArea = prepRows.reduce((s, r) => s + r.carpable, 0);
    const repLhs = repRows.length;
    const repArea = repRows.reduce((s, r) => s + r.carpable, 0);

    cfKpiHtml = `
      <!-- Row 1: Global Target & Global Accomplishment -->
      <section class="cf-kpi-global-grid">
        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Global Target</span>
            <span class="cf-kpi-badge">${esc(targetBadgeText)}</span>
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${globalTargetLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(globalTargetArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>

        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Global Accomplishment</span>
            <span class="cf-kpi-badge">${esc(accompBadgeText)}</span>
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${globalAccompLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(globalAccompArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>
      </section>

      <!-- Row 2: Target Year Dropdown Filter -->
      <div class="cf-target-year-bar">
        <label for="whereabouts-target-year-filter" class="cf-target-year-label">Target year:</label>
        <select id="whereabouts-target-year-filter" class="cf-target-year-select" aria-label="Select Target Year">
          ${allTargetYears
            .map(
              (yr) =>
                `<option value="${esc(yr)}" ${String(targetYearFilterVal) === String(yr) ? 'selected' : ''}>${esc(yr)}</option>`
            )
            .join('')}
        </select>
      </div>

      <!-- Row 3: 4 Target Year Filtered Cards -->
      <section class="cf-kpi-year-grid">
        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Target Year: ${esc(targetYearFilterVal)}</span>
            ${targetBadgeText ? `<span class="cf-kpi-badge">${esc(targetBadgeText)}</span>` : ''}
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${selectedYearTargetLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(selectedYearTargetArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>

        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Total with Conducted FI</span>
            ${targetBadgeText ? `<span class="cf-kpi-badge">${esc(targetBadgeText)}</span>` : ''}
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${fiLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(fiArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>

        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Total with Prepared &amp; Signed</span>
            ${targetBadgeText ? `<span class="cf-kpi-badge">${esc(targetBadgeText)}</span>` : ''}
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${prepLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(prepArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>

        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Total with Reported Month</span>
            ${targetBadgeText ? `<span class="cf-kpi-badge">${esc(targetBadgeText)}</span>` : ''}
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${repLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(repArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  // Top KPI Cards and Monitoring Table for Survey Whereabouts
  let surveyKpiHtml = '';
  let surveyStatusTableHtml = '';
  if (isSurveyWhereabouts) {
    // 1. Available Target Years
    const targetYearSet = new Set();
    targetYearSet.add(String(curYear));
    targetYearSet.add(String(curYear - 1));
    for (const pData of Object.values(state?.nepMilestoneList?.survey || {})) {
      if (pData?.year) targetYearSet.add(String(pData.year));
    }
    for (const r of enrichedRows) {
      if (r.targetYear) targetYearSet.add(String(r.targetYear));
      if (r.target) targetYearSet.add(String(r.target));
      for (const dt of Object.values(r.datesMap)) {
        const m = String(dt || '').match(/\b(20\d{2})\b/);
        if (m) targetYearSet.add(m[1]);
      }
    }
    const numYears = Array.from(targetYearSet)
      .filter((y) => /^\d{4}$/.test(y))
      .sort((a, b) => Number(b) - Number(a));
    const otherYears = Array.from(targetYearSet)
      .filter((y) => !/^\d{4}$/.test(y))
      .sort();
    const allTargetYears = ['ALL', ...numYears, ...otherYears];

    // 2. Stage definitions and table calculations based on DEFAULT_SURVEY_STATUS_BENCHMARKS
    const SURVEY_GROUPS = [
      {
        id: 'group1',
        name: '1st Group',
        title: '1st Group: With RSS • Ongoing Field Work • Field Work Completed',
        stages: [
          { key: 'rss', label: 'With RSS', dKey: 'dateRss', benchLhsKey: 'rssLhs', benchAreaKey: 'rssArea' },
          { key: 'ongoing', label: 'ONGOING FIELD WORK', dKey: 'fieldWorkStartDate', benchLhsKey: 'ongoingLhs', benchAreaKey: 'ongoingArea' },
          { key: 'completed', label: 'FIELD WORK COMPLETED', dKey: 'fieldWorkCompletionDate', benchLhsKey: 'completedLhs', benchAreaKey: 'completedArea' }
        ]
      },
      {
        id: 'group2',
        name: '2nd Group',
        title: '2nd Group: Finalized SR • SR Forwarded to DARRO • SR Accepted by DARRO',
        stages: [
          { key: 'finalizedSr', label: 'FINALIZED SR', dKey: 'finalizedSrDate' },
          { key: 'srForwarded', label: 'SR FORWARDED TO DARRO', dKey: 'srForwardedToDarro' },
          { key: 'srAcceptedDarro', label: 'SR ACCEPTED BY DARRO', dKey: 'srAcceptedByDarro' }
        ]
      },
      {
        id: 'group3',
        name: '3rd Group',
        title: '3rd Group: Survey Returns Returned DARRO to DARPO • SR Re-submitted to DARRO • Accepted by DENR-SMD',
        stages: [
          { key: 'srReturnedDarro', label: 'SURVEY RETURNS RETURNED DARRO TO DARPO', dKey: 'srReturnedDarroToDarpoDate' },
          { key: 'srResubmitted', label: 'SR RE-SUBMITTED TO DARRO', dKey: 'srResubmittedDarroDate' },
          { key: 'acceptedDenr', label: 'ACCEPTED BY DENR-SMD', dKey: 'dateAcceptedDenrSmd' }
        ]
      },
      {
        id: 'group4',
        name: '4th Group',
        title: '4th Group: SR Returned by DENR-SMD to DARRO • ASP Date',
        stages: [
          { key: 'srReturnedDenr', label: 'SR RETURNED BY DENR-SMD TO DARRO', dKey: 'srReturnedDenrToDarroDate' },
          { key: 'asp', label: 'ASP DATE', dKey: 'aspDate' }
        ]
      }
    ];

    const ALL_SURVEY_STAGES = SURVEY_GROUPS.flatMap((g) => g.stages);
    const activeGroups =
      surveyIndicatorTab === 'all' || !surveyIndicatorTab
        ? SURVEY_GROUPS
        : SURVEY_GROUPS.filter(
            (g) =>
              g.id === surveyIndicatorTab ||
              g.name.toLowerCase().replace(/\s+/g, '') === String(surveyIndicatorTab).toLowerCase().replace(/\s+/g, '')
          );
    const groupsToRender = activeGroups.length > 0 ? activeGroups : SURVEY_GROUPS;

    const surveyTableRows = DEFAULT_SURVEY_STATUS_BENCHMARKS.map((b) => {
      const nepOverride = state?.nepMilestoneList?.survey?.[b.code];
      const targetLhs = nepOverride?.lhs != null && nepOverride?.lhs !== '' ? Number(nepOverride.lhs) : b.targetLhs;
      const targetArea = nepOverride?.area != null && nepOverride?.area !== '' ? Number(nepOverride.area) : b.targetArea;

      const provRows = enrichedRows.filter((r) => matchProvinceName(r.province, b.name) || matchProvinceName(r.province, b.code));
      const stages = {};

      for (const st of ALL_SURVEY_STAGES) {
        const liveRows = provRows.filter((r) => Boolean(r.datesMap?.[st.dKey]) || Boolean(r[st.dKey]));
        const liveLhs = liveRows.length;
        const liveArea = liveRows.reduce((s, r) => s + r.carpable, 0);

        const benchLhs = st.benchLhsKey ? (b[st.benchLhsKey] || 0) : 0;
        const benchArea = st.benchAreaKey ? (b[st.benchAreaKey] || 0) : 0;

        const lhs = liveLhs > benchLhs ? liveLhs : benchLhs;
        const area = liveArea > benchArea ? liveArea : benchArea;

        const balLhs = Math.max(0, targetLhs - lhs);
        const balArea = Math.max(0, targetArea - area);

        stages[st.key] = { lhs, area, balLhs, balArea };
      }

      const isActive = selectedProvs.some((p) => matchProvinceName(b.name, p) || matchProvinceName(b.code, p));

      return {
        ...b,
        targetLhs,
        targetArea,
        stages,
        isActive
      };
    });

    const surveyTotals = {
      targetLhs: surveyTableRows.reduce((s, r) => s + r.targetLhs, 0),
      targetArea: surveyTableRows.reduce((s, r) => s + r.targetArea, 0),
      stages: {}
    };

    for (const st of ALL_SURVEY_STAGES) {
      surveyTotals.stages[st.key] = {
        lhs: surveyTableRows.reduce((s, r) => s + r.stages[st.key].lhs, 0),
        area: surveyTableRows.reduce((s, r) => s + r.stages[st.key].area, 0),
        balLhs: surveyTableRows.reduce((s, r) => s + r.stages[st.key].balLhs, 0),
        balArea: surveyTableRows.reduce((s, r) => s + r.stages[st.key].balArea, 0)
      };
    }

    let targetBadgeText = '';
    if (selectedProvs.length === 1) {
      targetBadgeText = selectedProvs[0];
    } else if (selectedProvs.length > 1) {
      targetBadgeText = selectedProvs.length <= 2 ? selectedProvs.join(', ') : `${selectedProvs.length} Provinces`;
    } else {
      targetBadgeText = provinceScope ? provinceScope.provinceName : 'Region VIII';
    }

    const activeBenchmarkRows = selectedProvs.length > 0
      ? surveyTableRows.filter((r) => r.isActive)
      : surveyTableRows;

    const surveyGlobalTargetLhs = activeBenchmarkRows.reduce((s, r) => s + r.targetLhs, 0);
    const surveyGlobalTargetArea = activeBenchmarkRows.reduce((s, r) => s + r.targetArea, 0);

    const surveyGlobalAccompLhs = activeBenchmarkRows.reduce((s, r) => s + r.stages.completed.lhs, 0);
    const surveyGlobalAccompArea = activeBenchmarkRows.reduce((s, r) => s + r.stages.completed.area, 0);

    const surveyTargetYearLhs = surveyGlobalTargetLhs;
    const surveyTargetYearArea = surveyGlobalTargetArea;

    const surveyRssLhs = activeBenchmarkRows.reduce((s, r) => s + r.stages.rss.lhs, 0);
    const surveyRssArea = activeBenchmarkRows.reduce((s, r) => s + r.stages.rss.area, 0);

    const surveyCompletedLhs = surveyGlobalAccompLhs;
    const surveyCompletedArea = surveyGlobalAccompArea;

    // LMS landholdings
    const lmsRows = scopeRows.filter((r) => {
      return Boolean(
        r.datesMap?.dateAcceptedDenrSmd ||
        r.datesMap?.srReturnedDenrToDarroDate ||
        r.datesMap?.aspDate ||
        r.datesMap?.srTransmittedDenrSmdDate ||
        r.dateAcceptedDenrSmd ||
        r.srReturnedDenrToDarroDate ||
        r.aspDate ||
        r.srTransmittedDenrSmdDate ||
        (r.stage && r.stage.toLowerCase().includes('denr')) ||
        (r.stage && r.stage.toLowerCase().includes('asp'))
      );
    });
    const surveyAtLmsLhs = lmsRows.length;
    const surveyAtLmsArea = lmsRows.reduce((s, r) => s + r.carpable, 0);

    const now = new Date();
    const curDateFormatted =
      now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) +
      ' | ' +
      now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    surveyKpiHtml = `
      <!-- Row 1: Global Target & Global Accomplishment -->
      <section class="cf-kpi-global-grid">
        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Global Target</span>
            <span class="cf-kpi-badge">${esc(targetBadgeText)}</span>
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${surveyGlobalTargetLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(surveyGlobalTargetArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>

        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Global Accomplishment</span>
            <span class="cf-kpi-badge">${esc(targetBadgeText)}</span>
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${surveyGlobalAccompLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(surveyGlobalAccompArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>
      </section>

      <!-- Row 2: Target Year Dropdown Filter -->
      <div class="cf-target-year-bar">
        <label for="whereabouts-target-year-filter" class="cf-target-year-label">Target year:</label>
        <select id="whereabouts-target-year-filter" class="cf-target-year-select whereabouts-target-year-select" aria-label="Select Target Year">
          ${allTargetYears
            .map(
              (yr) =>
                `<option value="${esc(yr)}" ${String(targetYearFilterVal) === String(yr) ? 'selected' : ''}>${esc(yr)}</option>`
            )
            .join('')}
        </select>
      </div>

      <!-- Row 3: 4 Filtered Cards -->
      <section class="cf-kpi-year-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Target Year: ${esc(targetYearFilterVal === 'ALL' ? curYear : targetYearFilterVal)}</span>
            ${targetBadgeText ? `<span class="cf-kpi-badge">${esc(targetBadgeText)}</span>` : ''}
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${surveyTargetYearLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(surveyTargetYearArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>

        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Total With RSS</span>
            ${targetBadgeText ? `<span class="cf-kpi-badge">${esc(targetBadgeText)}</span>` : ''}
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${surveyRssLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(surveyRssArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>

        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Total Field Work Completed</span>
            ${targetBadgeText ? `<span class="cf-kpi-badge">${esc(targetBadgeText)}</span>` : ''}
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${surveyCompletedLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(surveyCompletedArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>

        <div class="cf-kpi-card">
          <div class="cf-kpi-header">
            <span class="cf-kpi-title">Total AT LMS</span>
            ${targetBadgeText ? `<span class="cf-kpi-badge">${esc(targetBadgeText)}</span>` : ''}
          </div>
          <div class="cf-kpi-body">
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">LHs</span>
              <span class="cf-kpi-val">${surveyAtLmsLhs.toLocaleString()}</span>
            </div>
            <div class="cf-kpi-stat">
              <span class="cf-kpi-label">Area</span>
              <span class="cf-kpi-val area">${fmtArea(surveyAtLmsArea)}<span class="cf-kpi-unit">HAS</span></span>
            </div>
          </div>
        </div>
      </section>
    `;

    function renderGroupThead(stages, metricMode) {
      if (metricMode === 'lhs') {
        return `
          <tr class="survey-th-l1">
            <th rowspan="2" class="survey-th-unit">OPERATING UNIT</th>
            <th rowspan="2" class="survey-th-nep right">TARGET (LHS)<br><span style="font-size:10px;font-weight:600;opacity:0.85;">BASE ON SUPPORT LIST</span></th>
            ${stages.map((st) => `<th colspan="2" class="survey-th-stage center">${esc(st.label)}</th>`).join('')}
          </tr>
          <tr class="survey-th-l2">
            ${stages.map(() => `
              <th class="right">ACCOMPLISHMENT</th>
              <th class="right">BALANCE</th>
            `).join('')}
          </tr>
        `;
      }
      if (metricMode === 'area') {
        return `
          <tr class="survey-th-l1">
            <th rowspan="2" class="survey-th-unit">OPERATING UNIT</th>
            <th rowspan="2" class="survey-th-nep right">TARGET AREA (HAS)<br><span style="font-size:10px;font-weight:600;opacity:0.85;">BASE ON SUPPORT LIST</span></th>
            ${stages.map((st) => `<th colspan="2" class="survey-th-stage center">${esc(st.label)}</th>`).join('')}
          </tr>
          <tr class="survey-th-l2">
            ${stages.map(() => `
              <th class="right">ACCOMPLISHMENT (HAS)</th>
              <th class="right">BALANCE (HAS)</th>
            `).join('')}
          </tr>
        `;
      }
      // Default: 'both'
      return `
        <tr class="survey-th-l1">
          <th rowspan="3" class="survey-th-unit">OPERATING UNIT</th>
          <th colspan="2" class="survey-th-nep center">TARGET<br><span style="font-size:10px;font-weight:600;opacity:0.85;">BASE ON SUPPORT LIST</span></th>
          ${stages.map((st) => `<th colspan="4" class="survey-th-stage center">${esc(st.label)}</th>`).join('')}
        </tr>
        <tr class="survey-th-l2">
          <th rowspan="2" class="right">LHS</th>
          <th rowspan="2" class="right">AREA(HAS)</th>
          ${stages.map(() => `
            <th colspan="2" class="center">ACCOMPLISHMENT</th>
            <th colspan="2" class="center">BALANCE</th>
          `).join('')}
        </tr>
        <tr class="survey-th-l3">
          ${stages.map(() => `
            <th class="right">LHS</th>
            <th class="right">AREA(HAS)</th>
            <th class="right">LHS</th>
            <th class="right">AREA(HAS)</th>
          `).join('')}
        </tr>
      `;
    }

    function renderGroupRowCells(r, stages, metricMode) {
      if (metricMode === 'lhs') {
        return `
          <td class="survey-td-unit font-bold">${esc(r.name)}</td>
          <td class="right">${r.targetLhs.toLocaleString()}</td>
          ${stages.map((st) => {
            const s = r.stages[st.key];
            return `
              <td class="right">${s.lhs.toLocaleString()}</td>
              <td class="right">${s.balLhs.toLocaleString()}</td>
            `;
          }).join('')}
        `;
      }
      if (metricMode === 'area') {
        return `
          <td class="survey-td-unit font-bold">${esc(r.name)}</td>
          <td class="right">${fmtArea(r.targetArea)}</td>
          ${stages.map((st) => {
            const s = r.stages[st.key];
            return `
              <td class="right">${fmtArea(s.area)}</td>
              <td class="right">${fmtArea(s.balArea)}</td>
            `;
          }).join('')}
        `;
      }
      // Both:
      return `
        <td class="survey-td-unit font-bold">${esc(r.name)}</td>
        <td class="right">${r.targetLhs.toLocaleString()}</td>
        <td class="right">${fmtArea(r.targetArea)}</td>
        ${stages.map((st) => {
          const s = r.stages[st.key];
          return `
            <td class="right">${s.lhs.toLocaleString()}</td>
            <td class="right">${fmtArea(s.area)}</td>
            <td class="right">${s.balLhs.toLocaleString()}</td>
            <td class="right">${fmtArea(s.balArea)}</td>
          `;
        }).join('')}
      `;
    }

    function renderGroupTotalCells(totals, stages, metricMode) {
      if (metricMode === 'lhs') {
        return `
          <td class="survey-td-unit">REGION VIII</td>
          <td class="right">${totals.targetLhs.toLocaleString()}</td>
          ${stages.map((st) => {
            const s = totals.stages[st.key];
            return `
              <td class="right">${s.lhs.toLocaleString()}</td>
              <td class="right">${s.balLhs.toLocaleString()}</td>
            `;
          }).join('')}
        `;
      }
      if (metricMode === 'area') {
        return `
          <td class="survey-td-unit">REGION VIII</td>
          <td class="right">${fmtArea(totals.targetArea)}</td>
          ${stages.map((st) => {
            const s = totals.stages[st.key];
            return `
              <td class="right">${fmtArea(s.area)}</td>
              <td class="right">${fmtArea(s.balArea)}</td>
            `;
          }).join('')}
        `;
      }
      // Both:
      return `
        <td class="survey-td-unit">REGION VIII</td>
        <td class="right">${totals.targetLhs.toLocaleString()}</td>
        <td class="right">${fmtArea(totals.targetArea)}</td>
        ${stages.map((st) => {
          const s = totals.stages[st.key];
          return `
            <td class="right">${s.lhs.toLocaleString()}</td>
            <td class="right">${fmtArea(s.area)}</td>
            <td class="right">${s.balLhs.toLocaleString()}</td>
            <td class="right">${fmtArea(s.balArea)}</td>
          `;
        }).join('')}
      `;
    }

    surveyStatusTableHtml = `
      <!-- DAR Survey Status Monitoring Tables Grouped -->
      <div class="panel survey-status-panel" id="panel-survey-status-monitoring" style="margin-bottom: 20px;">
        <div class="survey-monitoring-header">
          <div class="survey-monitoring-brand">
            <div class="survey-dar-emblem">
              <svg width="34" height="34" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="18" fill="#15803d" />
                <circle cx="20" cy="20" r="14" fill="#facc15" />
                <path d="M20 14 C14 14 11 23 11 27 C15 27 20 24 20 19 Z" fill="#166534" />
                <path d="M20 14 C26 14 29 23 29 27 C25 27 20 24 20 19 Z" fill="#15803d" />
                <path d="M20 16 L20 28" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </div>
            <div class="survey-brand-info">
              <h3 class="survey-status-heading">Survey status</h3>
              <p class="survey-status-subheading">Region VIII - Monitoring &amp; accomplishment per indicator group</p>
            </div>
          </div>
          <div class="survey-monitoring-asof">
            As of ${curDateFormatted}
          </div>
          <div class="survey-monitoring-controls">
            <!-- 3 Metric Indicator Buttons -->
            <div class="btn-group" role="group" aria-label="Survey Metric Selector">
              <button type="button" class="btn btn-sm ${surveyMetricMode === 'both' ? 'btn-primary' : 'btn-secondary'}" data-survey-metric="both" title="Display Both LHS and Area (HAS)">Both</button>
              <button type="button" class="btn btn-sm ${surveyMetricMode === 'lhs' ? 'btn-primary' : 'btn-secondary'}" data-survey-metric="lhs" title="Display LHS Only">LHS</button>
              <button type="button" class="btn btn-sm ${surveyMetricMode === 'area' ? 'btn-primary' : 'btn-secondary'}" data-survey-metric="area" title="Display Area (HAS) Only">Area (HAS)</button>
            </div>

            <!-- Group Selector Tabs: All Groups | 1st Group | 2nd Group | 3rd Group | 4th Group -->
            <div class="btn-group" role="group" aria-label="Survey Indicator Groups">
              <button type="button" class="btn btn-sm ${surveyIndicatorTab === 'all' ? 'btn-primary' : 'btn-secondary'}" data-survey-indicator-tab="all" title="Show All 4 Indicator Groups Stacked">All Groups</button>
              <button type="button" class="btn btn-sm ${surveyIndicatorTab === 'group1' ? 'btn-primary' : 'btn-secondary'}" data-survey-indicator-tab="group1" title="1st Group: With RSS, Ongoing Field Work, Field Work Completed">1st Group</button>
              <button type="button" class="btn btn-sm ${surveyIndicatorTab === 'group2' ? 'btn-primary' : 'btn-secondary'}" data-survey-indicator-tab="group2" title="2nd Group: Finalized SR, SR Forwarded to DARRO, SR Accepted by DARRO">2nd Group</button>
              <button type="button" class="btn btn-sm ${surveyIndicatorTab === 'group3' ? 'btn-primary' : 'btn-secondary'}" data-survey-indicator-tab="group3" title="3rd Group: Returns DARRO->DARPO, Re-submitted to DARRO, Accepted DENR-SMD">3rd Group</button>
              <button type="button" class="btn btn-sm ${surveyIndicatorTab === 'group4' ? 'btn-primary' : 'btn-secondary'}" data-survey-indicator-tab="group4" title="4th Group: Returns DENR->DARRO, ASP Date">4th Group</button>
            </div>

            <select class="form-control whereabouts-target-year-select survey-target-year-select" aria-label="Select Target Year">
              <option value="ALL">Target Year</option>
              ${allTargetYears.filter((y) => y !== 'ALL').map((y) => `<option value="${esc(y)}" ${String(targetYearFilterVal) === String(y) ? 'selected' : ''}>Target Year: ${esc(y)}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-sm btn-outline-success btn-survey-refresh" id="btn-survey-status-refresh" title="Refresh DAR Survey Status">
              <span class="refresh-icon">🔄</span> Refresh
            </button>
          </div>
        </div>

        <div class="survey-monitoring-body" style="padding: 16px;">
          ${groupsToRender
            .map(
              (group, gIdx) => `
            <div class="survey-group-card" id="survey-group-${esc(group.id)}" style="margin-bottom: ${gIdx === groupsToRender.length - 1 ? '0' : '20px'};">
              <div class="survey-group-titlebar" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #0f4d2a; color: #ffffff; border-radius: 8px 8px 0 0; font-weight: 700; font-size: 13px; letter-spacing: 0.02em;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="badge" style="background: rgba(255,255,255,0.22); color: #ffffff; font-weight: 800; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${esc(group.name)}</span>
                  <span>${esc(group.title)}</span>
                </div>
                <span style="font-size: 11.5px; opacity: 0.85; font-weight: 500;">${group.stages.length} Indicator${group.stages.length > 1 ? 's' : ''}</span>
              </div>
              <div class="table-wrap survey-table-wrap" style="border: 1px solid #166534; border-top: none; border-radius: 0 0 8px 8px; overflow-x: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
                <table class="survey-monitoring-table" style="margin-bottom: 0;">
                  <thead>
                    ${renderGroupThead(group.stages, surveyMetricMode)}
                  </thead>
                  <tbody>
                    ${surveyTableRows
                      .map(
                        (r) => `
                      <tr class="${r.isActive ? 'survey-row-active' : ''}" data-survey-filter-province="${esc(r.name)}" style="cursor:pointer;" title="Click to filter by ${esc(r.name)}">
                        ${renderGroupRowCells(r, group.stages, surveyMetricMode)}
                      </tr>
                    `
                      )
                      .join('')}
                  </tbody>
                  <tfoot>
                    <tr class="survey-tf-total">
                      ${renderGroupTotalCells(surveyTotals, group.stages, surveyMetricMode)}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  const standardKpiHtml = `
    <!-- KPI Grid -->
    <section class="kpi-grid">
      <div class="kpi-card highlight">
        <div class="kpi-label">Total ${esc(cfg.tabName)} Parcels</div>
        <div class="kpi-primary">${scopeCount.toLocaleString()} Parcels</div>
        <div class="kpi-secondary">${fmtArea(scopeArea)} CARPable HAS</div>
        <div class="kpi-meta">Active records in ${esc(cfg.tabName)}${provFilterVal !== 'ALL' ? ` (${esc(provFilterVal)})` : ''}</div>
      </div>

      ${scopeDateMetrics
        .map(
          (d) => `
        <div class="kpi-card ${d.badgeClass.replace('badge-', '')}">
          <div class="kpi-label">${esc(d.shortLabel)}</div>
          <div class="kpi-primary">${d.count.toLocaleString()} Parcels</div>
          <div class="kpi-secondary">${fmtArea(d.area)} HAS (${d.rate}%)</div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${d.rate}%;"></div>
          </div>
          <div class="kpi-meta">${esc(d.label)} completed</div>
        </div>
      `
        )
        .join('')}

      <div class="kpi-card">
        <div class="kpi-label">All Milestone Dates Complete</div>
        <div class="kpi-primary">${scopeAllCompleteCount.toLocaleString()} Parcels</div>
        <div class="kpi-secondary">${fmtArea(scopeAllCompleteArea)} HAS (${pct(scopeAllCompleteCount, scopeCount)}%)</div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct(scopeAllCompleteCount, scopeCount)}%;"></div>
        </div>
        <div class="kpi-meta">${scopePendingCount} Parcels with pending dates</div>
      </div>
    </section>
  `;

  const hasAnyActiveFilter =
    provFilterVal !== 'ALL' ||
    ((isCfWhereabouts || isSurveyWhereabouts) && targetYearFilterVal !== 'ALL') ||
    statusFilterVal !== 'ALL' ||
    Boolean(q) ||
    Object.values(activeColFilters).some((s) => s && s.value && s.value !== 'ALL');

  const whereaboutsControlsHtml = `
    <div class="nep-header-controls">
      <input
        type="search"
        class="form-control"
        id="whereabouts-search"
        placeholder="Search LHID, Landowner, Title, LGU…"
        value="${esc(searchVal)}"
        style="min-width:210px;font-size:13px;"
      />
      ${
        !provinceScope
          ? `
        <select class="form-control nep-filter-select" id="whereabouts-province-filter" aria-label="Filter by Province">
          <option value="ALL" ${provFilterVal === 'ALL' ? 'selected' : ''}>All Region VIII Provinces</option>
          ${provNodes
            .map(
              (p) =>
                `<option value="${esc(p.provinceName)}" ${provFilterVal.toUpperCase() === p.provinceName.toUpperCase() ? 'selected' : ''}>${esc(p.provinceName)} (${esc(p.code)})</option>`
            )
            .join('')}
        </select>
      `
          : `<span class="badge badge-green">${esc(provinceScope.provinceName)} (${esc(provinceScope.code)})</span>`
      }
      <select class="form-control nep-filter-select" id="whereabouts-status-filter" aria-label="Filter by Date Status">
        <option value="ALL" ${statusFilterVal === 'ALL' ? 'selected' : ''}>All Records (${totalCount})</option>
        ${cfg.dates
          .map((d) => {
            const matchCount = enrichedRows.filter((r) => Boolean(r.datesMap[d.key])).length;
            return `<option value="with_${esc(d.key)}" ${statusFilterVal === `with_${d.key}` ? 'selected' : ''}>With ${esc(d.shortLabel)} (${matchCount})</option>`;
          })
          .join('')}
        <option value="all_complete" ${statusFilterVal === 'all_complete' ? 'selected' : ''}>All Dates Complete (${allCompleteCount})</option>
        <option value="pending" ${statusFilterVal === 'pending' ? 'selected' : ''}>Pending Dates (${pendingCount})</option>
      </select>
      <button type="button" class="btn btn-secondary btn-sm" id="btn-whereabouts-export-csv" title="Export this list to CSV">
        ⬇ Export CSV
      </button>
      <button type="button" class="btn btn-primary btn-sm" data-open-optool-tab="${esc(cfg.openTabName)}" title="Switch to Optool ${esc(cfg.openTabName)} worksheet">
        Open in ${esc(cfg.openTabName)}
      </button>
      <button type="button" class="btn btn-secondary btn-sm btn-fullscreen" id="btn-fullscreen-whereabouts" title="Full Screen Report / Table">
        <span class="fs-icon">⛶</span> <span class="fs-label">Full Screen</span>
      </button>
      <button type="button" class="btn ${showGraphVal ? 'btn-primary active' : 'btn-secondary'} btn-sm btn-graph-toggle" id="btn-whereabouts-toggle-graph" title="Toggle Provincial &amp; Monthly Summary Matrices">
        <span class="icon">📊</span> <span class="label">Graph</span>
      </button>
    </div>
  `;

  return `
    ${renderEmptyWorkspaceCallout(state)}

    ${isCfWhereabouts ? cfKpiHtml : isSurveyWhereabouts ? surveyKpiHtml : standardKpiHtml}

    ${isSurveyWhereabouts ? `
      <div class="panel whereabouts-toolbar-panel" style="padding:10px 16px;margin-bottom:16px;background:#ffffff;">
        ${whereaboutsControlsHtml}
      </div>
    ` : ''}

    ${isSurveyWhereabouts ? surveyStatusTableHtml : ''}

    <!-- Provincial & Monthly Summary Matrices / Graphs -->
    <div id="whereabouts-graph-container" style="display: ${showGraphVal ? 'block' : 'none'}; margin-bottom: 18px;">
    <section class="grid-2">
      <!-- Panel 1: Provincial Summary Matrix / Graph -->
      <div class="panel">
        <div class="panel-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <h3 class="panel-title">${esc(cfg.tabName)} Whereabouts by Province ${graphMode === 'graph' ? '(Graph)' : ''}</h3>
            <p class="panel-subtitle">Regional breakdown of ${esc(cfg.dates.map((d) => d.shortLabel).join(', '))}</p>
          </div>
          <div class="btn-group" role="group" aria-label="Toggle Graph or Table view for Province">
            <button type="button" class="btn btn-xs ${graphMode === 'graph' ? 'btn-primary' : 'btn-secondary'}" data-whereabouts-view-mode="graph" title="Show visual comparison graph">📊 Graph</button>
            <button type="button" class="btn btn-xs ${graphMode === 'table' ? 'btn-primary' : 'btn-secondary'}" data-whereabouts-view-mode="table" title="Show data table">▦ Table</button>
          </div>
        </div>
        <div class="panel-body" style="padding:14px 16px;">
          ${
            graphMode === 'graph'
              ? renderWhereaboutsProvincialGraphSvg(provSummaryList, cfg)
              : `
            <div class="table-wrap">
              <table class="nep-milestone-table">
                <thead>
                  <tr>
                    <th>Province</th>
                    <th class="right">Total</th>
                    <th class="right">Area (HAS)</th>
                    ${cfg.dates.map((d) => `<th class="right">${esc(d.shortLabel)}</th>`).join('')}
                    <th class="right">Complete</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    provSummaryList.length === 0
                      ? `<tr><td colspan="${4 + cfg.dates.length}" class="text-center" style="padding:16px;color:var(--text-muted)">No provincial records found</td></tr>`
                      : provSummaryList
                          .map(
                            (p) => `
                        <tr>
                          <td style="font-weight:700;">
                            <span class="badge badge-gray" style="margin-right:6px;">${esc(p.code)}</span>
                            ${esc(p.name)}
                          </td>
                          <td class="right"><strong>${p.total}</strong></td>
                          <td class="right">${fmtArea(p.area)} HAS</td>
                          ${cfg.dates
                            .map((d) => {
                              const cnt = p.dateCounts[d.key] || 0;
                              return `<td class="right">${cnt > 0 ? `<span class="badge ${d.badgeClass}">${cnt}</span>` : `<span style="color:var(--text-muted)">0</span>`}</td>`;
                            })
                            .join('')}
                          <td class="right">
                            <span class="badge ${p.completeCount === p.total && p.total > 0 ? 'badge-green' : 'badge-gray'}">
                              ${p.completeCount} (${pct(p.completeCount, p.total)}%)
                            </span>
                          </td>
                        </tr>
                      `
                          )
                          .join('')
                  }
                </tbody>
                <tfoot>
                  <tr style="font-weight:700;background:var(--bg-light);border-top:2px solid var(--border);">
                    <td>Region VIII Total</td>
                    <td class="right">${totalCount}</td>
                    <td class="right">${fmtArea(totalArea)} HAS</td>
                    ${dateMetrics.map((d) => `<td class="right"><span class="badge ${d.badgeClass}">${d.count}</span></td>`).join('')}
                    <td class="right"><span class="badge badge-green">${allCompleteCount} (${pct(allCompleteCount, totalCount)}%)</span></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          `
          }
        </div>
      </div>

      <!-- Panel 2: Monthly / Timeline Summary Matrix / Graph -->
      <div class="panel">
        <div class="panel-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <h3 class="panel-title">${esc(cfg.tabName)} Summary by Reporting Month ${graphMode === 'graph' ? '(Graph)' : ''}</h3>
            <p class="panel-subtitle">Distribution of landholdings across monthly reporting cycles</p>
          </div>
          <div class="btn-group" role="group" aria-label="Toggle Graph or Table view for Month">
            <button type="button" class="btn btn-xs ${graphMode === 'graph' ? 'btn-primary' : 'btn-secondary'}" data-whereabouts-view-mode="graph" title="Show visual trend graph">📊 Graph</button>
            <button type="button" class="btn btn-xs ${graphMode === 'table' ? 'btn-primary' : 'btn-secondary'}" data-whereabouts-view-mode="table" title="Show data table">▦ Table</button>
          </div>
        </div>
        <div class="panel-body" style="padding:14px 16px;">
          ${
            graphMode === 'graph'
              ? renderWhereaboutsMonthlyGraphSvg(monthSummaryList, cfg)
              : `
            <div class="table-wrap">
              <table class="nep-milestone-table">
                <thead>
                  <tr>
                    <th>Reporting Month</th>
                    <th class="right">Parcels</th>
                    <th class="right">Area (HAS)</th>
                    <th class="right">Dates Populated</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    monthSummaryList.length === 0
                      ? `<tr><td colspan="4" class="text-center" style="padding:16px;color:var(--text-muted)">No monthly records</td></tr>`
                      : monthSummaryList
                          .map(
                            (m) => `
                        <tr>
                          <td style="font-weight:700;">
                            <span class="badge ${m.label.includes('Undated') ? 'badge-gray' : 'badge-amber'}">
                              ${esc(m.label)}
                            </span>
                          </td>
                          <td class="right"><strong>${m.total}</strong></td>
                          <td class="right">${fmtArea(m.area)} HAS</td>
                          <td class="right"><span class="badge ${m.completeCount > 0 ? 'badge-green' : 'badge-gray'}">${m.completeCount} (${pct(m.completeCount, m.total)}%)</span></td>
                        </tr>
                      `
                          )
                          .join('')
                  }
                </tbody>
                <tfoot>
                  <tr style="font-weight:700;background:var(--bg-light);border-top:2px solid var(--border);">
                    <td>Total Monthly Cycles</td>
                    <td class="right">${totalCount}</td>
                    <td class="right">${fmtArea(totalArea)} HAS</td>
                    <td class="right">${allCompleteCount}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          `
          }
        </div>
      </div>
    </section>
    </div>

    ${
      !isSurveyWhereabouts
        ? `
    <!-- Master Ledger Panel -->
    <div class="panel" id="panel-whereabouts-master">
      <div class="panel-header nep-panel-header">
        <div>
          <h3 class="panel-title">${esc(cfg.tabName)} Whereabouts Master Ledger</h3>
          <p class="panel-subtitle">Individual landholdings showing ${esc(cfg.dates.map((d) => d.label).join(' • '))}</p>
        </div>
        ${whereaboutsControlsHtml}
      </div>

      <div style="padding:8px 16px;background:var(--bg-light);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12.5px;">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
          <span>Showing <strong>${pagedRows.length}</strong> of <strong>${totalFiltered}</strong> matching ${esc(cfg.tabName)} records</span>
          ${(isCfWhereabouts || isSurveyWhereabouts) && targetYearFilterVal !== 'ALL' ? `<span class="badge badge-gray">Target Year: ${esc(targetYearFilterVal)}</span>` : ''}
          ${provFilterVal !== 'ALL' ? `<span class="badge badge-green">Province: ${esc(provFilterVal)}</span>` : ''}
          ${Object.entries(activeColFilters)
            .map(([k, s]) => {
              if (k === 'province' || !s || !s.value || s.value === 'ALL') return '';
              return `<span class="badge badge-blue">${esc(k)}: ${esc(s.value)}</span>`;
            })
            .join(' ')}
          ${statusFilterVal !== 'ALL' && !activeColFilters.stage ? `<span class="badge badge-amber">Filter: ${esc(statusFilterVal)}</span>` : ''}
          ${q ? `<span class="badge badge-gray">Search: "${esc(q)}"</span>` : ''}
          ${
            hasAnyActiveFilter
              ? `
            <button type="button" class="btn btn-secondary btn-xs" id="btn-whereabouts-clear-all-filters" style="font-size:11.5px;padding:2px 8px;margin-left:4px;" title="Reset all column and toolbar filters">
              ✕ Clear Filters
            </button>
          `
              : ''
          }
        </div>
        ${
          totalPages > 1
            ? `
          <div style="display:flex;align-items:center;gap:6px;">
            <button type="button" class="btn btn-secondary btn-xs" data-whereabouts-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>« Prev</button>
            <span style="font-weight:600;">Page ${currentPage} of ${totalPages}</span>
            <button type="button" class="btn btn-secondary btn-xs" data-whereabouts-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>Next »</button>
          </div>
        `
            : ''
        }
      </div>

      <div class="table-wrap">
        <table class="nep-milestone-table">
          <thead>
            <tr>
              <th style="width:36px;" class="center">#</th>
              ${(() => {
                const lhidLabel = getWhereaboutsColFilterLabel(activeColFilters.lhid);
                const provLabel = getWhereaboutsColFilterLabel(
                  activeColFilters.province,
                  selectedProvs.length > 0
                    ? (selectedProvs.length <= 2 ? selectedProvs.join(', ') : `${selectedProvs.length} selected`)
                    : ''
                );
                const muniLabel = getWhereaboutsColFilterLabel(activeColFilters.municipality);
                const loLabel = getWhereaboutsColFilterLabel(activeColFilters.landOwner);
                const targetColLabel = getWhereaboutsColFilterLabel(activeColFilters.target);
                const stageLabel = getWhereaboutsColFilterLabel(
                  activeColFilters.stage,
                  statusFilterVal !== 'ALL' && !statusFilterVal.startsWith('with_') && statusFilterVal !== 'all_complete' && statusFilterVal !== 'pending'
                    ? statusFilterVal
                    : ''
                );
                return `
              <th>
                <button
                  type="button"
                  class="col-filter-btn ${lhidLabel ? 'active-filter' : ''}"
                  data-whereabouts-col-dropdown="lhid"
                  data-col-label="LHID"
                  aria-haspopup="listbox"
                  aria-label="Filter LHID"
                  title="${lhidLabel ? `LHID: ${esc(lhidLabel)}` : 'Filter LHID'}"
                >
                  <span class="col-filter-col-title">LHID</span>
                  <span class="col-filter-btn-text" ${lhidLabel ? '' : 'hidden'}>${lhidLabel ? esc(lhidLabel) : ''}</span>
                  <span class="col-filter-caret">▾</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  class="col-filter-btn ${provLabel ? 'active-filter' : ''}"
                  data-whereabouts-col-dropdown="province"
                  data-col-label="Province"
                  aria-haspopup="listbox"
                  aria-label="Filter Province"
                  title="${provLabel ? `Province: ${esc(provLabel)}` : 'Filter Province'}"
                >
                  <span class="col-filter-col-title">PROVINCE</span>
                  <span class="col-filter-btn-text" ${provLabel ? '' : 'hidden'}>${provLabel ? esc(provLabel) : ''}</span>
                  <span class="col-filter-caret">▾</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  class="col-filter-btn ${muniLabel ? 'active-filter' : ''}"
                  data-whereabouts-col-dropdown="municipality"
                  data-col-label="Municipality"
                  aria-haspopup="listbox"
                  aria-label="Filter Municipality"
                  title="${muniLabel ? `Municipality: ${esc(muniLabel)}` : 'Filter Municipality'}"
                >
                  <span class="col-filter-col-title">MUNICIPALITY</span>
                  <span class="col-filter-btn-text" ${muniLabel ? '' : 'hidden'}>${muniLabel ? esc(muniLabel) : ''}</span>
                  <span class="col-filter-caret">▾</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  class="col-filter-btn ${loLabel ? 'active-filter' : ''}"
                  data-whereabouts-col-dropdown="landOwner"
                  data-col-label="Landowner / Title"
                  aria-haspopup="listbox"
                  aria-label="Filter Landowner / Title"
                  title="${loLabel ? `Landowner: ${esc(loLabel)}` : 'Filter Landowner / Title'}"
                >
                  <span class="col-filter-col-title">LANDOWNER / TITLE</span>
                  <span class="col-filter-btn-text" ${loLabel ? '' : 'hidden'}>${loLabel ? esc(loLabel) : ''}</span>
                  <span class="col-filter-caret">▾</span>
                </button>
              </th>
              <th class="right">CARPable Area</th>
              ${cfg.dates
                .map((d) => {
                  const dLabel = getWhereaboutsColFilterLabel(activeColFilters[d.key]);
                  return `
                    <th>
                      <button
                        type="button"
                        class="col-filter-btn ${dLabel ? 'active-filter' : ''}"
                        data-whereabouts-col-dropdown="${esc(d.key)}"
                        data-col-label="${esc(d.label)}"
                        aria-haspopup="listbox"
                        aria-label="Filter ${esc(d.label)}"
                        title="${dLabel ? `${esc(d.label)}: ${esc(dLabel)}` : `Filter ${esc(d.label)}`}"
                      >
                        <span class="col-filter-col-title">${esc(d.label)}</span>
                        <span class="col-filter-btn-text" ${dLabel ? '' : 'hidden'}>${dLabel ? esc(dLabel) : ''}</span>
                        <span class="col-filter-caret">▾</span>
                      </button>
                    </th>
                  `;
                })
                .join('')}
              ${
                cfg.extraColHeader
                  ? `
                <th>
                  <button
                    type="button"
                    class="col-filter-btn ${targetColLabel ? 'active-filter' : ''}"
                    data-whereabouts-col-dropdown="target"
                    data-col-label="${esc(cfg.extraColHeader)}"
                    aria-haspopup="listbox"
                    aria-label="Filter ${esc(cfg.extraColHeader)}"
                    title="${targetColLabel ? `${esc(cfg.extraColHeader)}: ${esc(targetColLabel)}` : `Filter ${esc(cfg.extraColHeader)}`}"
                  >
                    <span class="col-filter-col-title">${esc(cfg.extraColHeader.toUpperCase())}</span>
                    <span class="col-filter-btn-text" ${targetColLabel ? '' : 'hidden'}>${targetColLabel ? esc(targetColLabel) : ''}</span>
                    <span class="col-filter-caret">▾</span>
                  </button>
                </th>
              `
                  : ''
              }
              <th>
                <button
                  type="button"
                  class="col-filter-btn ${stageLabel ? 'active-filter' : ''}"
                  data-whereabouts-col-dropdown="stage"
                  data-col-label="Whereabouts Status"
                  aria-haspopup="listbox"
                  aria-label="Filter Whereabouts Status"
                  title="${stageLabel ? `Status: ${esc(stageLabel)}` : 'Filter Whereabouts Status'}"
                >
                  <span class="col-filter-col-title">WHEREABOUTS STATUS</span>
                  <span class="col-filter-btn-text" ${stageLabel ? '' : 'hidden'}>${stageLabel ? esc(stageLabel) : ''}</span>
                  <span class="col-filter-caret">▾</span>
                </button>
              </th>
                `;
              })()}
              <th class="right" style="width:110px;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${
              pagedRows.length === 0
                ? `
              <tr>
                <td colspan="${8 + cfg.dates.length}" class="text-center" style="padding:28px 14px;color:var(--text-muted);">
                  <div style="font-size:15px;font-weight:700;margin-bottom:4px;">No ${esc(cfg.tabName)} records match the selected filters</div>
                  <div style="font-size:12px;">Try clearing search or changing the province / date status filters.</div>
                </td>
              </tr>
            `
                : pagedRows
                    .map((r, idx) => {
                      const rowNum = (currentPage - 1) * pageSize + idx + 1;
                      return `
                  <tr>
                    <td class="text-muted" style="font-size:11px;">${rowNum}</td>
                    <td>
                      <button
                        type="button"
                        class="link-btn lhid-chip"
                        data-lhid="${esc(r.lhid)}"
                        title="Click to view Landholding Profile &amp; Milestones"
                      >
                        ${esc(r.lhid)}
                      </button>
                    </td>
                    <td>
                      <span class="badge badge-gray" style="font-weight:600;">${esc(r.province)}</span>
                    </td>
                    <td style="font-size:12px;">
                      <div><strong>${esc(r.municipality)}</strong></div>
                      <div class="text-muted">${esc(r.barangay)}</div>
                    </td>
                    <td style="font-size:12px;">
                      <div><strong>${esc(r.landOwner)}</strong></div>
                      <div class="text-muted">Title: ${esc(r.titleNumber)}</div>
                    </td>
                    <td class="right" style="font-weight:600;font-variant-numeric:tabular-nums;">
                      ${fmtArea(r.carpable)} <span style="font-size:10.5px;color:var(--text-muted)">HAS</span>
                    </td>
                    ${cfg.dates
                      .map((d) => {
                        const val = r.datesMap[d.key];
                        if (!val) {
                          return `<td><span class="badge badge-gray" style="opacity:0.75;">Pending</span></td>`;
                        }
                        const displayVal = d.isMonth ? formatReportedMonthDisplay(val) : val;
                        return `<td><span class="badge ${d.badgeClass}" style="font-weight:700;"><span style="margin-right:3px;">${d.icon || ''}</span>${esc(displayVal)}</span></td>`;
                      })
                      .join('')}
                    ${cfg.extraColValue ? `<td style="font-size:11.5px;">${cfg.extraColValue(r)}</td>` : ''}
                    <td>
                      <span class="badge ${esc(r.stageBadge)}" style="font-weight:700;">${esc(r.stage)}</span>
                    </td>
                    <td class="right">
                      <button
                        type="button"
                        class="btn btn-secondary btn-xs"
                        data-open-optool-tab="${esc(cfg.openTabName)}"
                        title="Open in Optool ${esc(cfg.openTabName)} worksheet"
                      >
                        Open in ${esc(cfg.openTabName)}
                      </button>
                    </td>
                  </tr>
                `;
                    })
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>
    `
        : ''
    }
  `;
}

export function renderCfWhereaboutsView(ctx) {
  return renderMilestoneWhereaboutsView(ctx, WHEREABOUTS_CONFIGS['cf-whereabouts']);
}

export function renderSurveyWhereaboutsView(ctx) {
  return renderMilestoneWhereaboutsView(ctx, WHEREABOUTS_CONFIGS['survey-whereabouts']);
}

export function renderMovWhereaboutsView(ctx) {
  return renderMilestoneWhereaboutsView(ctx, WHEREABOUTS_CONFIGS['mov-whereabouts']);
}

export function renderRegDistWhereaboutsView(ctx) {
  return renderMilestoneWhereaboutsView(ctx, WHEREABOUTS_CONFIGS['regdist-whereabouts']);
}

export function renderInstallationWhereaboutsView(ctx) {
  return renderMilestoneWhereaboutsView(ctx, WHEREABOUTS_CONFIGS['installation-whereabouts']);
}

export function renderDashboardView(ctx) {
  const { state, analytics, monitoringLevel, measurementLogic, provinceScope } = ctx;
  const { kpis, provincialBreakdown, monthlyTrend, stageBreakdown, optoolSummary } = analytics;

  const showInc = measurementLogic === 'both' || measurementLogic === 'incremental';
  const showCum = measurementLogic === 'both' || measurementLogic === 'cumulative';

  const formatKpiMain = (titles, area) => {
    if (monitoringLevel === 'etitles') return `${titles.toLocaleString()} eTitles`;
    if (monitoringLevel === 'area') return `${fmtArea(area)} HAS`;
    return `${titles.toLocaleString()} eTitles`;
  };

  const formatKpiSub = (titles, area) => {
    if (monitoringLevel === 'etitles') return 'Monitoring Level: eTitles Only';
    if (monitoringLevel === 'area') return 'Monitoring Level: Area in Hectares (4 dec)';
    return `${fmtArea(area)} HAS`;
  };

  const maxStageCount = Math.max(1, ...stageBreakdown.map((s) => s.count));

  return `
    ${renderEmptyWorkspaceCallout(state)}

    <!-- KPI Grid -->
    <section class="kpi-grid">
      ${
        showCum
          ? `
        <div class="kpi-card highlight">
          <div class="kpi-label">Cumulative Accomplishment</div>
          <div class="kpi-primary">${formatKpiMain(kpis.cumulativeETitles, kpis.cumulativeAreaHas)}</div>
          <div class="kpi-secondary">${formatKpiSub(kpis.cumulativeETitles, kpis.cumulativeAreaHas)}</div>
          <div class="kpi-meta">Through period: <strong>${esc(analytics.activeMonth)}</strong></div>
        </div>
      `
          : ''
      }

      ${
        showInc
          ? `
        <div class="kpi-card blue">
          <div class="kpi-label">Incremental Output (${esc(analytics.incrementalTargetMonth || 'Period')})</div>
          <div class="kpi-primary">${formatKpiMain(kpis.incrementalETitles, kpis.incrementalAreaHas)}</div>
          <div class="kpi-secondary" style="color:var(--dar-blue)">${formatKpiSub(kpis.incrementalETitles, kpis.incrementalAreaHas)}</div>
          <div class="kpi-meta">New transactions in selected reporting month</div>
        </div>
      `
          : ''
      }

      <div class="kpi-card amber">
        <div class="kpi-label">Cumulative Baseline Target</div>
        <div class="kpi-primary">${formatKpiMain(kpis.baselineTargetETitles, kpis.baselineTargetAreaHas)}</div>
        <div class="kpi-secondary" style="color:var(--dar-amber)">${formatKpiSub(kpis.baselineTargetETitles, kpis.baselineTargetAreaHas)}</div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${Math.min(
            100,
            monitoringLevel === 'area' ? kpis.areaCompletionPct : kpis.eTitlesCompletionPct
          )}%"></div>
        </div>
        <div class="kpi-meta">${kpis.eTitlesCompletionPct}% eTitles • ${kpis.areaCompletionPct}% Area attained</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">OPTool Master Landholdings</div>
        <div class="kpi-primary">${optoolSummary.Database.toLocaleString()} Parcels</div>
        <div class="kpi-secondary">${fmtArea(optoolSummary.totalCarpableArea)} CARPable HAS</div>
        <div class="kpi-meta">
          CF: ${optoolSummary['CF(DOC)']} • Survey: ${optoolSummary.Survey} • MOV: ${optoolSummary.MOV} • Reg/Dist: ${optoolSummary.RegistrationDistribution} • Inst: ${optoolSummary.Installation}
        </div>
      </div>
    </section>

    ${renderProvincialNepSheetSection(ctx)}

    <!-- Charts Row -->
    <section class="grid-2">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">Monthly Incremental vs. Cumulative Trajectory</h3>
            <p class="panel-subtitle">${
              provinceScope
                ? `${esc(provinceScope.provinceName)} (${esc(provinceScope.code)}) provincial ledger`
                : 'Aggregated across active Region VIII provincial ledgers'
            }</p>
          </div>
        </div>
        <div class="panel-body chart-box">
          ${renderTrendChartSvg(monthlyTrend, { monitoringLevel, measurementLogic })}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">Provincial Baseline vs. Accomplishment</h3>
            <p class="panel-subtitle">${
              provinceScope
                ? `Cumulative performance for ${esc(provinceScope.provinceName)} (${esc(provinceScope.code)})`
                : 'Cumulative performance across the 6 DAR Region VIII nodes'
            }</p>
          </div>
        </div>
        <div class="panel-body chart-box">
          ${renderProvincialComparisonSvg(provincialBreakdown, { monitoringLevel })}
        </div>
      </div>
    </section>

    <!-- Provincial Consolidation Table & Stage Funnel -->
    <section class="grid-2" style="grid-template-columns: 1.55fr 1fr;">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">${
              provinceScope
                ? `${esc(provinceScope.provinceName)} Consolidation Matrix`
                : 'Region VIII Provincial Consolidation Matrix'
            }</h3>
            <p class="panel-subtitle">${
              provinceScope
                ? `Real-time metrics for ${esc(provinceScope.provinceName)} (${esc(provinceScope.code)})`
                : 'Real-time aggregation from the 6 provincial Google Sheet nodes'
            }</p>
          </div>
          <button class="btn btn-secondary btn-sm" data-nav="sync">View Node Registry</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Province / Node</th>
                <th class="right">Baseline Target</th>
                ${showInc ? `<th class="right">Incremental (${esc(analytics.incrementalTargetMonth || '-')})</th>` : ''}
                ${showCum ? '<th class="right">Cumulative</th>' : ''}
                <th class="right">% Attained</th>
                <th class="right">OPTool Rows</th>
              </tr>
            </thead>
            <tbody>
              ${provincialBreakdown
                .map(
                  (p) => `
                <tr>
                  <td>
                    <div style="font-weight:700">${esc(p.jurisdiction)}</div>
                    <div class="mono" style="font-size:11px;color:var(--text-muted)">${esc(p.code)}</div>
                  </td>
                  <td class="right">${formatMetricsCell(p.baselineTargetETitles, p.baselineTargetAreaHas, monitoringLevel)}</td>
                  ${
                    showInc
                      ? `<td class="right">${formatMetricsCell(p.incrementalETitles, p.incrementalAreaHas, monitoringLevel)}</td>`
                      : ''
                  }
                  ${
                    showCum
                      ? `<td class="right">${formatMetricsCell(p.cumulativeETitles, p.cumulativeAreaHas, monitoringLevel)}</td>`
                      : ''
                  }
                  <td class="right num">
                    <span class="badge ${p.completionPctETitles >= 50 ? 'badge-green' : 'badge-amber'}">
                      ${monitoringLevel === 'area' ? p.completionPctArea : p.completionPctETitles}%
                    </span>
                  </td>
                  <td class="right num">
                    <span class="badge badge-gray">DB: ${p.optoolCounts.Database}</span>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">Workflow Milestone Stage Breakdown</h3>
            <p class="panel-subtitle">Cumulative eTitle &amp; Hectare distribution by stage</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="funnel-list">
            ${stageBreakdown
              .map((s) => {
                const pct = Math.round((s.count / maxStageCount) * 100);
                return `
                  <div class="funnel-row">
                    <div class="funnel-row-top">
                      <span style="font-weight:600">${esc(s.stage)}</span>
                      <span class="num" style="color:var(--text-muted)">
                        <strong>${s.count}</strong> eTitles • ${fmtArea(s.areaHas)} HAS
                      </span>
                    </div>
                    <div class="progress-track">
                      <div class="progress-fill" style="width:${pct}%"></div>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      </div>
    </section>

    <!-- OPTool Database per Province Summary -->
    <div class="panel">
      <div class="panel-header">
        <div>
          <h3 class="panel-title">OPTool Database Landholdings per Province</h3>
          <p class="panel-subtitle">
            Consolidated landholding areas (Total Area, ComputedArea, CARPable) •
            CF(DOC): <strong>${optoolSummary['CF(DOC)']}</strong> •
            Survey: <strong>${optoolSummary.Survey}</strong> •
            MOV: <strong>${optoolSummary.MOV}</strong> •
            RegistrationDistribution: <strong>${optoolSummary.RegistrationDistribution}</strong> •
            Installation: <strong>${optoolSummary.Installation}</strong>
          </p>
        </div>
        <button class="btn btn-secondary btn-sm" data-nav="optool">Open Optool Support List</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Province</th>
              <th class="right">Parcels (LHIDs)</th>
              <th class="right">Total Area (HAS)</th>
              <th class="right">ComputedArea (HAS)</th>
              <th class="right">CARPable (HAS)</th>
              <th class="right">Distributed Area (HAS)</th>
            </tr>
          </thead>
          <tbody>
            ${(analytics.databaseByProvince || [])
              .map(
                (p) => `
              <tr>
                <td><strong>${esc(p.jurisdiction)}</strong> <span class="mono" style="font-size:11px;color:var(--text-muted)">(${esc(p.code)})</span></td>
                <td class="right num"><strong>${p.parcelCount}</strong></td>
                <td class="right mono num">${fmtArea(p.totalArea)}</td>
                <td class="right mono num">${fmtArea(p.computedArea)}</td>
                <td class="right mono num">${fmtArea(p.carpableArea)}</td>
                <td class="right mono num">${fmtArea(p.distributedArea)}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function renderMilestonesView(ctx) {
  const { state, schemas, filters, searchTerm } = ctx;
  const q = (searchTerm || '').trim().toLowerCase();

  const rows = state.milestoneData.filter((r) => {
    if (filters.province !== 'ALL' && r.Province_Code !== filters.province) return false;
    if (filters.batch !== 'ALL' && r.Batch_Category !== filters.batch) return false;
    if (filters.periodMonth !== 'LATEST' && filters.periodMonth !== 'ALL') {
      if (!String(r.Milestone_Date || '').startsWith(filters.periodMonth)) return false;
    }
    if (q) {
      const hay = Object.values(r).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const totalArea = rows.reduce((s, r) => s + (Number(r.Area_HAS) || 0), 0);

  return `
    ${renderEmptyWorkspaceCallout(state)}
    <div class="panel">
      <div class="toolbar">
        <div class="toolbar-left">
          <input
            type="search"
            class="search-input"
            id="ms-search"
            placeholder="Search Record_ID, Municipality, LA ID, eTitle, LHID…"
            value="${esc(searchTerm)}"
          />
          <span class="badge badge-green num">${rows.length} record(s)</span>
          <span class="badge badge-blue num">${fmtArea(totalArea)} HAS</span>
        </div>
        <div class="toolbar-left">
          <label class="btn btn-secondary btn-sm" style="margin:0">
            Import CSV
            <input type="file" accept=".csv" id="ms-csv-upload" class="hidden" />
          </label>
          <button class="btn btn-secondary btn-sm" id="btn-ms-export-csv">Export CSV</button>
          <button class="btn btn-primary btn-sm" id="btn-ms-add">+ Add Milestone Entry</button>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Record_ID</th>
              <th>Prov</th>
              <th>Municipality</th>
              <th>Land_Allocation_ID</th>
              <th>eTitle_No</th>
              <th class="right">Area_HAS</th>
              <th>Milestone_Stage</th>
              <th>Milestone_Date</th>
              <th>Batch_Category</th>
              <th>LHID</th>
              <th class="center col-actions-sticky">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length === 0
                ? `<tr><td colspan="11" style="text-align:center;padding:28px;color:var(--text-muted)">No matching records in Milestone_Data ledger. Click <strong>+ Add Milestone Entry</strong> or sync/import from Google Sheets.</td></tr>`
                : rows
                    .map(
                      (r) => `
                  <tr>
                    <td class="mono" style="font-weight:700">${esc(r.Record_ID)}</td>
                    <td><span class="badge badge-gray">${esc(r.Province_Code)}</span></td>
                    <td>${esc(r.Municipality)}</td>
                    <td class="mono">${esc(r.Land_Allocation_ID)}</td>
                    <td class="mono" style="font-weight:600">${esc(r.eTitle_No)}</td>
                    <td class="right mono num">${fmtArea(r.Area_HAS)}</td>
                    <td><span class="badge ${stageBadgeClass(r.Milestone_Stage)}">${esc(r.Milestone_Stage)}</span></td>
                    <td class="mono">${esc(r.Milestone_Date)}</td>
                    <td><span class="badge badge-gray">${esc(r.Batch_Category)}</span></td>
                    <td>
                      ${
                        r.LHID
                          ? `<button type="button" class="link-btn" data-lhid="${esc(r.LHID)}">${esc(r.LHID)}</button>`
                          : '<span style="color:var(--text-light)">—</span>'
                      }
                    </td>
                    <td class="center col-actions-sticky" style="white-space:nowrap">
                      <button class="btn btn-secondary btn-sm" data-edit-ms="${esc(r.Record_ID)}">Edit</button>
                      <button class="btn btn-danger btn-sm" data-del-ms="${esc(r.Record_ID)}">Delete</button>
                    </td>
                  </tr>
                `
                    )
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h3 class="panel-title">Standardized Schema Reference (Milestone_Data)</h3>
          <p class="panel-subtitle">Matches Section 3 of the SPLIT Region VIII Technical Implementation Guide</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Field Name</th>
              <th>Data Type</th>
              <th>Validation / Rule</th>
            </tr>
          </thead>
          <tbody>
            ${schemas.milestoneColumns
              .map(
                (c) => `
              <tr>
                <td class="mono" style="font-weight:700">${esc(c.header)}</td>
                <td>${esc(c.type)}</td>
                <td>${
                  c.key === 'Record_ID'
                    ? 'Auto Index (PROV-YYYYMM-XXXX)'
                    : c.key === 'Municipality'
                    ? 'Region VIII LGU Master List Dropdown'
                    : c.key === 'Area_HAS'
                    ? 'Decimal (4 decimal places)'
                    : c.key === 'Milestone_Date'
                    ? 'YYYY-MM-DD ISO Standard'
                    : esc(c.label)
                }</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function buildPageList(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = [1];
  const left = Math.max(2, currentPage - 1);
  const right = Math.min(totalPages - 1, currentPage + 1);
  if (left > 2) pages.push('...');
  for (let p = left; p <= right; p++) pages.push(p);
  if (right < totalPages - 1) pages.push('...');
  pages.push(totalPages);
  return pages;
}

const BLANK_FILTER_TOKEN = '__BLANK__';

const UNCHECKED_CHECKLIST_VALUES = new Set([
  '',
  'false',
  '0',
  'no',
  'n',
  'unchecked',
  'uncheck',
  'none',
  'null',
  'undefined',
  'n/a',
  'na',
  'ut',
  'untitled',
  'without',
  'w/out',
  'w/o',
  'out',
  'not applicable',
  '-',
  '—',
  '[]'
]);

export function isChecklistChecked(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return !UNCHECKED_CHECKLIST_VALUES.has(String(value).trim().toLowerCase());
}

export function normalizeFilterSpec(filterSpec) {
  if (filterSpec === null || filterSpec === undefined) return { mode: 'auto', value: '', values: [] };
  if (typeof filterSpec === 'object') {
    const values = Array.isArray(filterSpec.values) ? filterSpec.values : [];
    let value = String(filterSpec.value ?? '').trim();
    if (!value && values.length > 0) {
      value = values.join(', ');
    }
    return {
      mode: filterSpec.mode || (values.length > 0 ? 'multi' : 'auto'),
      value,
      values
    };
  }
  return { mode: 'auto', value: String(filterSpec).trim(), values: [] };
}

export function getColumnFilterLabel(filterSpec, colType = 'text') {
  const spec = normalizeFilterSpec(filterSpec);
  if (spec.values && spec.values.length > 0) {
    const valid = spec.values.filter((v) => v !== '' && v !== 'ALL');
    if (valid.length === 0) return 'All';
    if (valid.length === 1) {
      const v = valid[0];
      return v === BLANK_FILTER_TOKEN || v === '__BLANK__' ? (colType === 'checkbox' ? '(Unchecked)' : '(Blank)') : v;
    }
    if (valid.length === 2) {
      return valid.map((v) => (v === BLANK_FILTER_TOKEN || v === '__BLANK__' ? '(Blank)' : v)).join(', ');
    }
    return `${valid.length} selected`;
  }
  const { mode, value } = spec;
  if (!value) return 'All';
  if (value === BLANK_FILTER_TOKEN || value === '__BLANK__') return colType === 'checkbox' ? '(Unchecked)' : '(Blank)';
  return mode === 'contains' ? `~ ${value}` : value;
}

function matchesColumnFilter(cellValue, filterSpec, colType) {
  const spec = normalizeFilterSpec(filterSpec);
  if (spec.values && spec.values.length > 0) {
    return spec.values.some((v) => matchesSingleOptoolColVal(cellValue, v, spec.mode || 'exact', colType));
  }
  if (!spec.value) return true;
  return matchesSingleOptoolColVal(cellValue, spec.value, spec.mode, colType);
}

function matchesSingleOptoolColVal(cellValue, q, mode, colType) {
  if (colType === 'checkbox') {
    const checked = isChecklistChecked(cellValue);
    if (q === BLANK_FILTER_TOKEN || q === '__BLANK__') return !checked;
    const qLower = String(q).toLowerCase();
    if (mode === 'exact') {
      if (qLower === 'checked' || qLower === 'yes' || qLower === 'true' || qLower === '1') return checked;
      if (qLower === 'unchecked' || qLower === 'no' || qLower === 'false' || qLower === '0') return !checked;
      return (checked ? 'checked' : 'unchecked') === qLower;
    }
    const hay = checked ? 'checked yes true' : 'unchecked no false blank';
    return hay.includes(qLower);
  }

  const raw = String(cellValue ?? '').trim();

  if (q === BLANK_FILTER_TOKEN || q === '__BLANK__') return raw === '';
  if (mode === 'exact') return raw.toLowerCase() === String(q).toLowerCase();

  // Support optional numeric comparisons (>10, >=5, <20, <=5) on decimal/integer columns
  if (colType === 'decimal' || colType === 'integer') {
    const numMatch = String(q).match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
    if (numMatch) {
      const numVal = Number(raw);
      const targetNum = Number(numMatch[2]);
      if (!Number.isFinite(numVal) || raw === '') return false;
      const op = numMatch[1];
      if (op === '>') return numVal > targetNum;
      if (op === '>=') return numVal >= targetNum;
      if (op === '<') return numVal < targetNum;
      if (op === '<=') return numVal <= targetNum;
      return numVal === targetNum;
    }
  }

  return raw.toLowerCase().includes(String(q).toLowerCase());
}

export const LINKED_DB_PROFILE_FIELDS = [
  { key: 'titleNumber', label: 'TitleNumber', type: 'text' },
  { key: 'landOwner', label: 'LOName', type: 'text' },
  { key: 'moa', label: 'MOA', type: 'text' },
  { key: 'regionName', label: 'RegionName', type: 'text' },
  { key: 'province', label: 'ProvinceName', type: 'text' },
  { key: 'municipality', label: 'MCDName', type: 'text' },
  { key: 'barangay', label: 'BarangayName', type: 'text' },
  { key: 'surveyNumber', label: 'SurveyNumber', type: 'text' },
  { key: 'lotNumber', label: 'LotNumber', type: 'text' },
  { key: 'carpable', label: 'CARPable', type: 'decimal', isArea: true }
];

const LINKED_DB_TABLE_TABS = new Set(['CF(DOC)', 'Survey', 'MOV', 'RegistrationDistribution']);
const LINKED_DB_TABLE_COLUMNS = LINKED_DB_PROFILE_FIELDS.map((f) => ({
  key: `__db_${f.key}`,
  dbKey: f.key,
  label: f.label,
  type: f.type,
  linkedFromDb: true
}));

export function getGroupVariantClass(groupName) {
  const norm = String(groupName || '').trim().toLowerCase();
  if (norm === 'darpo compliance') return 'group-darpo-compliance';
  if (norm === 'darpo') return 'group-darpo';
  if (norm === 'darro compliance' || norm === 'darro') return 'group-darro';
  if (norm === 'database parcel details' || norm === 'database parcel details (linked by lhid)') {
    return 'group-linked';
  }
  if (norm === 'reporting') return 'group-reporting';
  return 'group-neutral';
}

function buildOptoolGroupSpans(displayCols, showMoreCol) {
  const spans = [];
  for (const col of displayCols) {
    const label = col.linkedFromDb ? 'Database Parcel Details' : col.group || 'General';
    const last = spans[spans.length - 1];
    if (last && last.label === label) {
      last.span++;
    } else {
      spans.push({ label, span: 1, variant: getGroupVariantClass(label) });
    }
  }
  if (showMoreCol) {
    spans.push({ label: 'Other', span: 1, variant: 'group-neutral' });
  }
  return spans;
}

function buildDbByLhidMap(state) {
  const dbRows = state?.optool?.Database || [];
  const dbByLhid = new Map();
  let dbTotalCarpableArea = 0;
  for (const r of dbRows) {
    dbTotalCarpableArea += parseNumericValue(r.carpable) || 0;
    const lhidKey = String(r.lhid || '').trim().toLowerCase();
    if (lhidKey && !dbByLhid.has(lhidKey)) {
      dbByLhid.set(lhidKey, r);
    }
  }
  return { dbRows, dbByLhid, dbTotalCarpableArea };
}

function insertLinkedColsAfterLhid(baseCols) {
  const lhidIdx = baseCols.findIndex((c) => c.key === 'lhid');
  if (lhidIdx < 0) return [...LINKED_DB_TABLE_COLUMNS, ...baseCols];
  return [
    ...baseCols.slice(0, lhidIdx + 1),
    ...LINKED_DB_TABLE_COLUMNS,
    ...baseCols.slice(lhidIdx + 1)
  ];
}

function getOptoolTableColumns(schemas, tabName) {
  const rawCols = schemas.optoolTabs[tabName] || [];
  const previewKeys = schemas.optoolPreviewCols?.[tabName];
  const rawPreviewCols = previewKeys
    ? previewKeys.map((k) => rawCols.find((c) => c.key === k)).filter(Boolean)
    : rawCols.slice(0, 10);

  if (!LINKED_DB_TABLE_TABS.has(tabName)) {
    return { cols: rawCols, previewCols: rawPreviewCols };
  }
  return {
    cols: insertLinkedColsAfterLhid(rawCols),
    previewCols: insertLinkedColsAfterLhid(rawPreviewCols)
  };
}

function getOptoolCellValue(row, col, dbByLhid) {
  if (col?.dbKey) {
    const lhidKey = String(row?.lhid || '').trim().toLowerCase();
    const dbRow = lhidKey ? dbByLhid.get(lhidKey) : null;
    return dbRow?.[col.dbKey] ?? '';
  }
  return row?.[col?.key] ?? '';
}

function filterOptoolRows(rows, ctx, skipColKey = null, dbByLhidOverride = null) {
  const {
    state,
    schemas,
    activeOptoolTab,
    searchTerm,
    optoolTargetFilter = 'ALL',
    optoolColFilters = {},
    filters
  } = ctx;

  const tabNames = Object.keys(schemas.optoolTabs);
  const currentTab = tabNames.includes(activeOptoolTab) ? activeOptoolTab : tabNames[0];
  const { cols } = getOptoolTableColumns(schemas, currentTab);
  const colByKey = new Map(cols.map((c) => [c.key, c]));
  const dbByLhid = dbByLhidOverride || buildDbByLhidMap(state).dbByLhid;
  const includeLinkedSearch = LINKED_DB_TABLE_TABS.has(currentTab);
  const activeColEntries = Object.entries(optoolColFilters || {}).filter(
    ([key, val]) => key !== skipColKey && normalizeFilterSpec(val).value !== ''
  );

  const q = (searchTerm || '').trim().toLowerCase();
  const targetFilter = String(optoolTargetFilter || 'ALL');
  const codeMap = {
    BIL: 'biliran',
    ESA: 'eastern samar',
    LEY: 'leyte',
    NSA: 'northern samar',
    SAM: 'samar',
    SLE: 'southern leyte'
  };

  return rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => {
      if (filters.province !== 'ALL' && row.province !== undefined && row.province !== '') {
        const provText = String(row.province).toLowerCase();
        const target = codeMap[filters.province];
        if (filters.province === 'LEY' && provText.includes('southern')) return false;
        if (filters.province === 'SAM' && (provText.includes('eastern') || provText.includes('northern'))) return false;
        if (target && !provText.includes(target)) return false;
      }
      if (currentTab === 'Database' && targetFilter !== 'ALL') {
        const rowTarget = String(row.milestoneTarget || '').trim();
        if (targetFilter === 'ASSIGNED' && !rowTarget) return false;
        if (targetFilter === 'UNASSIGNED' && rowTarget) return false;
        if (
          targetFilter !== 'ASSIGNED' &&
          targetFilter !== 'UNASSIGNED' &&
          rowTarget.toLowerCase() !== targetFilter.toLowerCase()
        ) {
          return false;
        }
      }
      for (const [colKey, filterSpec] of activeColEntries) {
        const col = colByKey.get(colKey);
        const cellVal = getOptoolCellValue(row, col, dbByLhid);
        if (!matchesColumnFilter(cellVal, filterSpec, col?.type)) {
          return false;
        }
      }
      if (q) {
        let hay = Object.values(row).join(' ');
        if (includeLinkedSearch) {
          const lhidKey = String(row.lhid || '').trim().toLowerCase();
          const dbRow = lhidKey ? dbByLhid.get(lhidKey) : null;
          if (dbRow) {
            hay +=
              ' ' +
              LINKED_DB_PROFILE_FIELDS.map((f) => dbRow[f.key] ?? '').join(' ');
          }
        }
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
}

export function getColumnFilterValues(ctx, colKey) {
  const { state, schemas, activeOptoolTab } = ctx;
  const tabNames = Object.keys(schemas.optoolTabs);
  const currentTab = tabNames.includes(activeOptoolTab) ? activeOptoolTab : tabNames[0];
  const { cols } = getOptoolTableColumns(schemas, currentTab);
  const col = cols.find((c) => c.key === colKey);
  const allRows = state.optool[currentTab] || [];
  const { dbByLhid } = buildDbByLhidMap(state);
  const matching = filterOptoolRows(allRows, ctx, colKey, dbByLhid);

  const counts = new Map();
  let blankCount = 0;
  for (const { row } of matching) {
    const rawCell = getOptoolCellValue(row, col, dbByLhid);
    if (col?.type === 'checkbox') {
      if (isChecklistChecked(rawCell)) {
        counts.set('Checked', (counts.get('Checked') || 0) + 1);
      } else {
        blankCount++;
      }
      continue;
    }
    const val = String(rawCell ?? '').trim();
    if (!val) {
      blankCount++;
    } else {
      counts.set(val, (counts.get(val) || 0) + 1);
    }
  }

  const values = Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
    .map(([value, count]) => ({ value, count }));

  return { col, blankCount, totalRows: matching.length, values };
}

function buildOptoolViewModel(ctx) {
  const {
    state,
    schemas,
    activeOptoolTab,
    searchTerm,
    optoolTargetFilter = 'ALL',
    optoolColFilters = {},
    optoolPage = 1,
    optoolPageSize = 50,
    optoolColMode = 'preview',
    optoolColPage = 1
  } = ctx;

  const tabNames = Object.keys(schemas.optoolTabs);
  const currentTab = tabNames.includes(activeOptoolTab) ? activeOptoolTab : tabNames[0];
  const { cols, previewCols } = getOptoolTableColumns(schemas, currentTab);
  const allRows = state.optool[currentTab] || [];
  const targetTabs = schemas.milestoneTargetTabs || [
    'CF(DOC)',
    'Survey',
    'MOV',
    'RegistrationDistribution',
    'Installation'
  ];

  const anchorCol = cols[0]?.key === 'lhid' ? cols[0] : null;
  const extraCols = anchorCol ? cols.slice(1) : cols;
  const colPageSize = 7;
  const totalColPages = Math.max(1, Math.ceil(extraCols.length / colPageSize));
  const safeColPage = Math.min(Math.max(1, Number(optoolColPage) || 1), totalColPages);

  let displayCols = previewCols;
  if (optoolColMode === 'all') {
    displayCols = cols;
  } else if (optoolColMode === 'paged') {
    const cStart = (safeColPage - 1) * colPageSize;
    const slice = extraCols.slice(cStart, cStart + colPageSize);
    displayCols = anchorCol ? [anchorCol, ...slice] : slice;
  }

  const activeColEntries = Object.entries(optoolColFilters || {}).filter(
    ([, val]) => normalizeFilterSpec(val).value !== ''
  );

  const { dbRows, dbByLhid, dbTotalCarpableArea } = buildDbByLhidMap(state);
  const q = (searchTerm || '').trim();
  const targetFilter = String(optoolTargetFilter || 'ALL');
  const indexedRows = filterOptoolRows(allRows, ctx, null, dbByLhid);

  // Vertical (row) pagination
  const totalRows = indexedRows.length;
  const isShowAllRows = String(optoolPageSize) === 'ALL';
  const rowPageSize = isShowAllRows ? Math.max(1, totalRows) : Math.max(1, Number(optoolPageSize) || 50);
  const totalRowPages = isShowAllRows ? 1 : Math.max(1, Math.ceil(totalRows / rowPageSize));
  const safeRowPage = Math.min(Math.max(1, Number(optoolPage) || 1), totalRowPages);
  const rowStartIdx = (safeRowPage - 1) * rowPageSize;
  const pagedRows = isShowAllRows ? indexedRows : indexedRows.slice(rowStartIdx, rowStartIdx + rowPageSize);
  const showingFrom = totalRows === 0 ? 0 : rowStartIdx + 1;
  const showingTo = Math.min(totalRows, rowStartIdx + pagedRows.length);

  const showMoreCol = optoolColMode !== 'all' && displayCols.length < cols.length;
  const hiddenColsCount = Math.max(0, cols.length - displayCols.length);
  const totalColSpan = displayCols.length + (showMoreCol ? 1 : 0) + 1;
  const hasAnyFilter = activeColEntries.length > 0 || Boolean(q) || targetFilter !== 'ALL';
  const isFilteredScope =
    hasAnyFilter || String(ctx.filters?.province || 'ALL') !== 'ALL' || totalRows !== allRows.length;

  const tabAllStats = sumOptoolCarpableMetrics(allRows, dbByLhid, currentTab);
  const filteredRowsOnly = indexedRows.map((entry) => entry.row);
  const tabFilteredStats = sumOptoolCarpableMetrics(filteredRowsOnly, dbByLhid, currentTab);

  let dbFilteredAssignedCount = 0;
  const dbTargetStats = {};
  for (const t of targetTabs) {
    dbTargetStats[t] = { lhs: 0, carpableArea: 0 };
  }
  if (currentTab === 'Database') {
    for (const row of filteredRowsOnly) {
      if (String(row.milestoneTarget || '').trim() !== '') {
        dbFilteredAssignedCount++;
      }
    }
    const targetScopedRows = filterOptoolRows(allRows, { ...ctx, optoolTargetFilter: 'ALL' }, 'milestoneTarget', dbByLhid);
    const targetLookup = new Map(targetTabs.map((t) => [t.toLowerCase(), t]));
    for (const { row } of targetScopedRows) {
      const canonical = targetLookup.get(String(row.milestoneTarget || '').trim().toLowerCase());
      if (canonical) {
        dbTargetStats[canonical].lhs++;
        dbTargetStats[canonical].carpableArea += Number(row.carpable) || 0;
      }
    }
  }

  return {
    tabNames,
    currentTab,
    cols,
    previewCols,
    displayCols,
    dbByLhid,
    targetTabs,
    targetFilter,
    optoolColFilters: optoolColFilters || {},
    hasAnyFilter,
    isFilteredScope,
    dbAllRowsCount: dbRows.length,
    dbTotalCarpableArea,
    dbFilteredAssignedCount,
    dbTargetStats,
    tabAllStats,
    tabFilteredStats,
    indexedRows,
    pagedRows,
    totalRows,
    isShowAllRows,
    optoolPageSize,
    totalRowPages,
    safeRowPage,
    showingFrom,
    showingTo,
    pageButtons: buildPageList(safeRowPage, totalRowPages),
    optoolColMode,
    safeColPage,
    totalColPages,
    showMoreCol,
    hiddenColsCount,
    totalColSpan
  };
}

function sumOptoolCarpableMetrics(rows, dbByLhid, currentTab) {
  const isDb = currentTab === 'Database';
  const seenLhids = new Set();
  let carpableArea = 0;
  let matchedCount = 0;
  let totalArbs = 0;
  let totalTitles = 0;
  let totalCompensation = 0;

  for (const row of rows) {
    if (isDb) {
      carpableArea += parseNumericValue(row.carpable) || 0;
    } else {
      const lhidKey = String(row.lhid || '').trim().toLowerCase();
      const dbRow = lhidKey ? dbByLhid.get(lhidKey) : null;
      if (dbRow) matchedCount++;
      if (!lhidKey || !seenLhids.has(lhidKey)) {
        if (lhidKey) seenLhids.add(lhidKey);
        if (dbRow) carpableArea += parseNumericValue(dbRow.carpable) || 0;
      }
      totalArbs += parseNumericValue(row.noOfArbs) || 0;
      totalTitles += parseNumericValue(row.noOfTitles) || 0;
      totalCompensation += parseNumericValue(row.compensationAmount) || 0;
    }
  }

  return {
    count: rows.length,
    carpableArea,
    matchedCount,
    totalArbs,
    totalTitles,
    totalCompensation
  };
}

const TARGET_CARD_META = {
  'CF(DOC)': { label: 'CF(DOC)', variantClass: 'highlight' },
  Survey: { label: 'Survey', variantClass: 'blue' },
  MOV: { label: 'MOV', variantClass: 'amber' },
  RegistrationDistribution: { label: 'Registration / Distribution', variantClass: 'teal' },
  Installation: { label: 'Installation', variantClass: 'highlight' }
};

function renderOptoolKpiCardsHtml(vm) {
  const {
    currentTab,
    totalRows,
    dbAllRowsCount,
    dbTotalCarpableArea,
    dbFilteredAssignedCount,
    dbTargetStats,
    tabAllStats,
    tabFilteredStats,
    targetTabs,
    targetFilter,
    isFilteredScope
  } = vm;

  if (currentTab !== 'Database') {
    const meta = TARGET_CARD_META[currentTab] || { label: currentTab, variantClass: 'highlight' };
    const pctTabLhs = tabAllStats.count > 0 ? ((totalRows / tabAllStats.count) * 100).toFixed(1) : '0.0';
    const pctTabArea =
      tabAllStats.carpableArea > 0
        ? ((tabFilteredStats.carpableArea / tabAllStats.carpableArea) * 100).toFixed(1)
        : '0.0';
    const pctDbLhs = dbAllRowsCount > 0 ? ((totalRows / dbAllRowsCount) * 100).toFixed(1) : '0.0';
    const pctDbArea =
      dbTotalCarpableArea > 0 ? ((tabFilteredStats.carpableArea / dbTotalCarpableArea) * 100).toFixed(1) : '0.0';

    let lhsMeta = isFilteredScope ? `Filtered ${meta.label} landholdings` : `Active records in ${meta.label} tab`;
    if (currentTab === 'MOV') {
      lhsMeta = `Total Compensation: PHP ${tabFilteredStats.totalCompensation.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;
    } else if (currentTab === 'RegistrationDistribution' || currentTab === 'Installation') {
      lhsMeta = `${tabFilteredStats.totalArbs.toLocaleString()} ARBs • ${tabFilteredStats.totalTitles.toLocaleString()} Titles`;
    }

    return `
      <section class="kpi-grid kpi-grid-2">
        <div class="kpi-card ${meta.variantClass}">
          <div class="kpi-label">${esc(meta.label)} — Total LHs</div>
          <div class="kpi-primary num">${totalRows.toLocaleString()} LHs</div>
          <div class="kpi-secondary num">
            ${
              isFilteredScope
                ? `of ${tabAllStats.count.toLocaleString()} ${esc(meta.label)} LHs (${pctTabLhs}%)`
                : `${pctDbLhs}% of ${dbAllRowsCount.toLocaleString()} Database LHs`
            }
          </div>
          <div class="kpi-meta">${lhsMeta}</div>
        </div>
        <div class="kpi-card blue">
          <div class="kpi-label">${esc(meta.label)} — Area (CARPable)</div>
          <div class="kpi-primary num">${fmtArea(tabFilteredStats.carpableArea)} HAS</div>
          <div class="kpi-secondary num" style="color:var(--dar-blue)">
            ${
              isFilteredScope
                ? `of ${fmtArea(tabAllStats.carpableArea)} HAS ${esc(meta.label)} CARPable (${pctTabArea}%)`
                : `${pctDbArea}% of ${fmtArea(dbTotalCarpableArea)} HAS Database CARPable`
            }
          </div>
          <div class="kpi-meta">CARPable matched from Database by LHID (${tabFilteredStats.matchedCount}/${tabFilteredStats.count} row(s))</div>
        </div>
      </section>
    `;
  }

  const pctLhs = dbAllRowsCount > 0 ? ((totalRows / dbAllRowsCount) * 100).toFixed(1) : '0.0';
  const pctArea =
    dbTotalCarpableArea > 0 ? ((tabFilteredStats.carpableArea / dbTotalCarpableArea) * 100).toFixed(1) : '0.0';

  const summaryRowHtml = `
    <section class="kpi-grid kpi-grid-2">
      <div class="kpi-card highlight">
        <div class="kpi-label">Total LHs</div>
        <div class="kpi-primary num">${totalRows.toLocaleString()} LHs</div>
        <div class="kpi-secondary num">
          ${
            isFilteredScope
              ? `of ${dbAllRowsCount.toLocaleString()} total LHs (${pctLhs}%)`
              : `${dbFilteredAssignedCount.toLocaleString()} assigned to Milestone Target`
          }
        </div>
        <div class="kpi-meta">${isFilteredScope ? 'Filtered Database landholdings' : 'Active Database master landholdings'}</div>
      </div>
      <div class="kpi-card blue">
        <div class="kpi-label">Area (CARPable)</div>
        <div class="kpi-primary num">${fmtArea(tabFilteredStats.carpableArea)} HAS</div>
        <div class="kpi-secondary num" style="color:var(--dar-blue)">
          ${
            isFilteredScope
              ? `of ${fmtArea(dbTotalCarpableArea)} HAS total CARPable (${pctArea}%)`
              : `Sum of CARPable column across ${dbAllRowsCount.toLocaleString()} LH(s)`
          }
        </div>
        <div class="kpi-meta">CARPable area total in hectares (4-decimal precision)</div>
      </div>
    </section>
  `;

  const targetsRowHtml = `
    <section class="kpi-targets-section" aria-labelledby="kpi-targets-heading">
      <div class="kpi-section-header">
        <h3 id="kpi-targets-heading" class="kpi-section-title">Target per Milestone</h3>
        <span class="kpi-section-hint">${targetFilter ? `Filtered: ${esc((TARGET_CARD_META[targetFilter] || { label: targetFilter }).label)} • Click active card to clear` : 'Click a card to filter Database by Target'}</span>
      </div>
      <div class="kpi-grid kpi-grid-targets" aria-label="Milestone Target summary cards">
        ${targetTabs
          .map((t) => {
            const stat = dbTargetStats[t] || { lhs: 0, carpableArea: 0 };
            const meta = TARGET_CARD_META[t] || { label: t, variantClass: 'highlight' };
            const isSelected = targetFilter.toLowerCase() === t.toLowerCase();
            return `
              <button
                type="button"
                class="kpi-card kpi-target-card ${meta.variantClass} ${isSelected ? 'active-target-card' : ''}"
                data-kpi-target="${esc(t)}"
                title="${isSelected ? `Showing ${meta.label} — click to clear target filter` : `Filter Database by ${meta.label}`}"
              >
                <div class="kpi-label">${esc(meta.label)}</div>
                <div class="kpi-primary num">${stat.lhs.toLocaleString()} LHs</div>
                <div class="kpi-secondary num">${fmtArea(stat.carpableArea)} HAS</div>
                <div class="kpi-meta">${isSelected ? 'Active target filter (click to clear)' : 'Target CARPable • Click to filter'}</div>
              </button>
            `;
          })
          .join('')}
      </div>
    </section>
  `;

  return `${summaryRowHtml}${targetsRowHtml}`;
}

function renderOptoolBodyRowsHtml(vm) {
  const { currentTab, pagedRows, displayCols, targetTabs, showMoreCol, hiddenColsCount, totalColSpan, dbByLhid } = vm;
  if (pagedRows.length === 0) {
    return `<tr><td colspan="${totalColSpan}" style="text-align:center;padding:28px;color:var(--text-muted)">No matching rows in <strong>${esc(currentTab)}</strong>. Adjust filters or click <strong>+ Add ${esc(currentTab)} Row</strong>.</td></tr>`;
  }
  return pagedRows
    .map(({ row, idx }) => {
      const rowTarget = String(row.milestoneTarget || '').trim();
      const targetSelectHtml =
        currentTab === 'Database'
          ? `<select class="target-action-select ${rowTarget ? 'has-target' : ''}" data-milestone-target="${idx}" aria-label="Select Milestone Target" title="Select Milestone Target"><option value="">Milestone Target…</option>${targetTabs
              .map(
                (t) =>
                  `<option value="${esc(t)}" ${
                    rowTarget.toLowerCase() === t.toLowerCase() ? 'selected' : ''
                  }>${esc(t)}</option>`
              )
              .join('')}</select>`
          : '';
      return `
        <tr>
          ${displayCols
            .map((c) => {
              const val = getOptoolCellValue(row, c, dbByLhid);
              const linkedCls = c.linkedFromDb ? 'cell-linked-db' : '';
              if (c.key === 'lhid' && val) {
                return `<td><button type="button" class="link-btn" data-lhid="${esc(val)}">${esc(val)}</button></td>`;
              }
              if (c.type === 'checkbox') {
                const checked = isChecklistChecked(val);
                return `<td class="cell-check"><input type="checkbox" class="table-check-input" data-optool-check-idx="${idx}" data-optool-check-key="${esc(
                  c.key
                )}" ${checked ? 'checked' : ''} aria-label="${esc(c.label)} for ${esc(
                  row.lhid || `row ${idx + 1}`
                )}" title="${esc(c.label)}: ${checked ? 'Checked' : 'Unchecked'}" /></td>`;
              }
              if (
                c.type === 'select' &&
                Array.isArray(c.options) &&
                !(currentTab === 'Database' && c.key === 'milestoneTarget')
              ) {
                const opts = isReportedMonthKey(c.key) ? getReportedMonthOptions() : [...c.options];
                if (val && !opts.includes(val)) opts.push(val);
                return `<td><select class="table-cell-select ${val ? 'has-value' : ''}" data-optool-select-idx="${idx}" data-optool-select-key="${esc(
                  c.key
                )}" aria-label="${esc(c.label)} for ${esc(row.lhid || `row ${idx + 1}`)}"><option value="">-- Select --</option>${opts
                  .map((opt) => `<option value="${esc(opt)}" ${val === opt ? 'selected' : ''}>${esc(opt)}</option>`)
                  .join('')}</select></td>`;
              }
              if (c.type === 'decimal' && val !== '') {
                return `<td class="${linkedCls ? `${linkedCls} ` : ''}mono num">${fmtArea(val)}</td>`;
              }
              return `<td${linkedCls ? ` class="${linkedCls}"` : ''}>${esc(val || '—')}</td>`;
            })
            .join('')}
          ${
            showMoreCol
              ? `<td><span class="badge badge-gray">+${hiddenColsCount} cols</span></td>`
              : ''
          }
          <td class="center col-actions-sticky" style="white-space:nowrap">
            ${targetSelectHtml}<button class="btn btn-secondary btn-sm" data-edit-optool="${idx}">Edit / View All</button>
            <button class="btn btn-danger btn-sm" data-del-optool="${idx}">Delete</button>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderOptoolPaginationHtml(vm) {
  const {
    showingFrom,
    showingTo,
    totalRows,
    optoolPageSize,
    isShowAllRows,
    optoolColMode,
    safeColPage,
    totalColPages,
    pageButtons,
    safeRowPage,
    totalRowPages
  } = vm;
  return `
    <div class="pagination-group">
      <span class="num" style="color:var(--text-muted)">
        Showing <strong>${showingFrom.toLocaleString()}–${showingTo.toLocaleString()}</strong> of <strong>${totalRows.toLocaleString()}</strong>
      </span>
      <label for="optool-page-size" style="color:var(--text-muted);margin-left:6px">Rows:</label>
      <select id="optool-page-size" class="toolbar-select" style="height:28px;font-size:12px" aria-label="Rows per page">
        <option value="25" ${String(optoolPageSize) === '25' ? 'selected' : ''}>25</option>
        <option value="50" ${String(optoolPageSize) === '50' ? 'selected' : ''}>50</option>
        <option value="100" ${String(optoolPageSize) === '100' ? 'selected' : ''}>100</option>
        <option value="250" ${String(optoolPageSize) === '250' ? 'selected' : ''}>250</option>
        <option value="ALL" ${isShowAllRows ? 'selected' : ''}>All</option>
      </select>
      <button type="button" class="page-btn" data-hscroll="-360" title="Scroll table left">◀ Left</button>
      <button type="button" class="page-btn" data-hscroll="360" title="Scroll table right">Right ▶</button>
      ${
        optoolColMode === 'paged'
          ? `
        <span class="page-ellipsis">|</span>
        <button type="button" class="page-btn" data-optool-col-page="${safeColPage - 1}" ${safeColPage <= 1 ? 'disabled' : ''}>◀ Cols</button>
        <span class="num" style="font-weight:600">Cols ${safeColPage}/${totalColPages}</span>
        <button type="button" class="page-btn" data-optool-col-page="${safeColPage + 1}" ${safeColPage >= totalColPages ? 'disabled' : ''}>Cols ▶</button>
      `
          : ''
      }
    </div>

    <div class="pagination-group" aria-label="Row pagination">
      <button type="button" class="page-btn" data-optool-page="1" ${safeRowPage <= 1 ? 'disabled' : ''} title="First page">⟪</button>
      <button type="button" class="page-btn" data-optool-page="${safeRowPage - 1}" ${safeRowPage <= 1 ? 'disabled' : ''}>‹ Prev</button>
      ${pageButtons
        .map((p) =>
          p === '...'
            ? '<span class="page-ellipsis">…</span>'
            : `<button type="button" class="page-btn ${p === safeRowPage ? 'active' : ''}" data-optool-page="${p}">${p}</button>`
        )
        .join('')}
      <button type="button" class="page-btn" data-optool-page="${safeRowPage + 1}" ${safeRowPage >= totalRowPages ? 'disabled' : ''}>Next ›</button>
      <button type="button" class="page-btn" data-optool-page="${totalRowPages}" ${safeRowPage >= totalRowPages ? 'disabled' : ''} title="Last page">⟫</button>
    </div>
  `;
}

export function renderOptoolPartial(ctx) {
  const vm = buildOptoolViewModel(ctx);
  return {
    kpiCardsHtml: renderOptoolKpiCardsHtml(vm),
    tbodyHtml: renderOptoolBodyRowsHtml(vm),
    paginationHtml: renderOptoolPaginationHtml(vm),
    badgeText: `${vm.indexedRows.length} row(s) • ${vm.displayCols.length}/${vm.cols.length} cols`,
    hasAnyFilter: vm.hasAnyFilter
  };
}

export function renderOptoolView(ctx) {
  const { state, searchTerm } = ctx;
  const vm = buildOptoolViewModel(ctx);
  const {
    tabNames,
    currentTab,
    cols,
    previewCols,
    displayCols,
    targetTabs,
    targetFilter,
    optoolColFilters,
    hasAnyFilter,
    indexedRows,
    optoolColMode,
    showMoreCol
  } = vm;

  const hasGroupHeader = currentTab === 'Survey';
  const groupSpans = hasGroupHeader ? buildOptoolGroupSpans(displayCols, showMoreCol) : [];

  return `
    ${renderEmptyWorkspaceCallout(state)}
    <div class="optool-kpi-stack" id="optool-kpi-cards">${renderOptoolKpiCardsHtml(vm)}</div>
    <div class="panel" id="panel-optool">
      <div class="tab-strip">
        ${tabNames
          .map(
            (t) => `
          <button type="button" class="tab-btn ${t === currentTab ? 'active' : ''}" data-optool-tab="${esc(t)}">
            <span>${esc(t)}</span>
            <span class="tab-count">${(state.optool[t] || []).length}</span>
          </button>
        `
          )
          .join('')}
      </div>

      <div class="toolbar">
        <div class="toolbar-left">
          <input
            type="search"
            class="search-input"
            id="optool-search"
            placeholder="Search LHID, Title, Landowner, Municipality…"
            value="${esc(searchTerm)}"
          />
          ${
            currentTab === 'Database'
              ? `
            <select id="optool-target-filter" class="toolbar-select" aria-label="Filter by Milestone Target">
              <option value="ALL" ${targetFilter === 'ALL' ? 'selected' : ''}>All Milestone Targets</option>
              <option value="ASSIGNED" ${targetFilter === 'ASSIGNED' ? 'selected' : ''}>Assigned Only</option>
              <option value="UNASSIGNED" ${targetFilter === 'UNASSIGNED' ? 'selected' : ''}>Unassigned</option>
              ${targetTabs
                .map(
                  (t) => `<option value="${esc(t)}" ${targetFilter === t ? 'selected' : ''}>${esc(t)}</option>`
                )
                .join('')}
            </select>
          `
              : ''
          }
          <select id="optool-col-mode" class="toolbar-select" aria-label="Horizontal column mode">
            <option value="preview" ${optoolColMode === 'preview' ? 'selected' : ''}>Key Columns (${previewCols.length})</option>
            <option value="paged" ${optoolColMode === 'paged' ? 'selected' : ''}>Horizontal Col Pages (${cols.length})</option>
            <option value="all" ${optoolColMode === 'all' ? 'selected' : ''}>All Columns (${cols.length})</option>
          </select>
          <span class="badge badge-blue num" id="optool-count-badge">${indexedRows.length} row(s) • ${displayCols.length}/${cols.length} cols</span>
          <button type="button" class="page-btn" id="btn-clear-col-filters" ${hasAnyFilter ? '' : 'disabled'} title="Clear all table filters">
            Clear Filters
          </button>
        </div>
        <div class="toolbar-left">
          <label class="btn btn-secondary btn-sm" style="margin:0">
            Import CSV to ${esc(currentTab)}
            <input type="file" accept=".csv" id="optool-csv-upload" class="hidden" />
          </label>
          <button class="btn btn-primary btn-sm" id="btn-optool-add">+ Add ${esc(currentTab)} Row</button>
          <button type="button" class="btn btn-secondary btn-sm btn-fullscreen" id="btn-fullscreen-optool" title="Full Screen Table">
            <span class="fs-icon">⛶</span> <span class="fs-label">Full Screen</span>
          </button>
        </div>
      </div>

      <div class="table-wrap table-scroll-xy" id="optool-table-wrap">
        <table id="optool-table"${hasGroupHeader ? ' class="has-col-groups"' : ''}>
          <thead id="optool-thead">
            ${
              hasGroupHeader
                ? `
            <tr class="optool-head-groups">
              ${groupSpans
                .map((g) => `<th colspan="${g.span}" class="col-group-th ${g.variant}">${esc(g.label)}</th>`)
                .join('')}
              <th rowspan="2" class="center col-actions-sticky optool-actions-rowspan">Actions</th>
            </tr>
            `
                : ''
            }
            <tr class="optool-head-titles">
              ${displayCols
                .map((c) => {
                  const spec = optoolColFilters[c.key];
                  const label = getColumnFilterLabel(spec, c.type);
                  const isActive = label !== 'All';
                  return `
                    <th${c.linkedFromDb ? ' class="th-linked-db"' : ''}>
                      <button
                        type="button"
                        class="col-filter-btn ${isActive ? 'active-filter' : ''}"
                        data-col-dropdown="${esc(c.key)}"
                        data-col-label="${esc(c.label)}"
                        data-col-type="${esc(c.type || 'text')}"
                        aria-haspopup="listbox"
                        aria-label="Filter ${esc(c.label)}"
                        title="${isActive ? `${esc(c.label)}: ${esc(label)}` : `Filter ${esc(c.label)}`}${
                          c.linkedFromDb ? ' (Database linked by LHID)' : ''
                        }"
                      >
                        <span class="col-filter-col-title">${esc(c.label)}</span>
                        <span class="col-filter-btn-text" ${isActive ? '' : 'hidden'}>${isActive ? esc(label) : ''}</span>
                        <span class="col-filter-caret">▾</span>
                      </button>
                    </th>
                  `;
                })
                .join('')}
              ${showMoreCol ? '<th>More Fields</th>' : ''}
              ${hasGroupHeader ? '' : '<th class="center col-actions-sticky">Actions</th>'}
            </tr>
          </thead>
          <tbody id="optool-tbody">
            ${renderOptoolBodyRowsHtml(vm)}
          </tbody>
        </table>
      </div>

      <div class="pagination-bar" id="optool-pagination-bar">
        ${renderOptoolPaginationHtml(vm)}
      </div>
    </div>
  `;
}

export function renderSyncView(ctx) {
  const { state, schemas, gasScript, gasHtml, provinceScope } = ctx;
  const snap = state.liveHubSnapshot || {};
  const nodeStatuses = state.nodeStatuses || {};
  const isScoped = Boolean(provinceScope?.code);

  return `
    <!-- Section 1: Regional Google Sheets Data Source Repository -->
    <div class="panel">
      <div class="panel-header">
        <div>
          <h3 class="panel-title">1. ${
            isScoped
              ? `${esc(provinceScope.provinceName)} Google Sheet Node`
              : 'Regional Google Sheets Data Source Repository'
          }</h3>
          <p class="panel-subtitle">${
            isScoped
              ? `Assigned Provincial Ledger: ${esc(provinceScope.provinceName)} (${esc(provinceScope.code)})`
              : 'Central Aggregator Hub + 6 Provincial Nodes (DAR Region VIII Active Registry)'
          }</p>
        </div>
        <div class="toolbar-left">
          ${
            isScoped
              ? ''
              : `
                <button class="btn btn-secondary btn-sm" id="btn-sync-probe">Verify Live Hub Connection</button>
                <button class="btn btn-secondary btn-sm" id="btn-sync-pull-hub">Sync &amp; Merge Live Hub Sheet</button>
              `
          }
          <button class="btn btn-primary btn-sm" id="btn-sync-all-nodes">${
            isScoped
              ? `Sync ${esc(provinceScope.provinceName)} Sheet`
              : 'Sync All 7 Google Sheets'
          }</button>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Jurisdiction / Office</th>
              <th>Role</th>
              <th>Google Sheet ID</th>
              <th>Live Status</th>
              <th class="center col-actions-sticky">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${schemas.registry
              .map((node) => {
                const isHub = node.role === 'Central Aggregator';
                const ns = nodeStatuses[node.code];
                let statusBadge = '';
                if (ns) {
                  if (ns.status === 'synced') {
                    statusBadge = `<span class="badge badge-green">Synced (${ns.importedRows} rows)</span>`;
                  } else if (ns.status === 'unauthorized') {
                    statusBadge = '<span class="badge badge-amber">401 Restricted (Share Link or GAS)</span>';
                  } else {
                    statusBadge = '<span class="badge badge-red">Connection Error</span>';
                  }
                } else {
                  statusBadge = isHub
                    ? snap.reachable === true
                      ? '<span class="badge badge-green">Public XLSX Reachable</span>'
                      : snap.reachable === false
                      ? '<span class="badge badge-red">Connection Error</span>'
                      : '<span class="badge badge-gray">Not Checked Yet</span>'
                    : '<span class="badge badge-amber">DAR Private / GAS ETL Node</span>';
                }

                return `
                  <tr>
                    <td class="mono" style="font-weight:800">${esc(node.code)}</td>
                    <td style="font-weight:600">${esc(node.jurisdiction)}</td>
                    <td>
                      <span class="badge ${isHub ? 'badge-blue' : 'badge-gray'}">${esc(node.role)}</span>
                    </td>
                    <td class="mono" style="font-size:11.5px">${esc(node.spreadsheetId)}</td>
                    <td>${statusBadge}</td>
                    <td class="center col-actions-sticky" style="white-space:nowrap">
                      <button class="btn btn-secondary btn-sm" data-sync-node="${esc(node.spreadsheetId)}" data-sync-label="${esc(node.jurisdiction)}">
                        Test / Pull
                      </button>
                      <a class="btn btn-secondary btn-sm" href="${esc(node.url)}" target="_blank" rel="noopener noreferrer">
                        Open Sheet ↗
                      </a>
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
      ${
        snap.checkedAt
          ? `
        <div class="panel-body" style="border-top:1px solid var(--border);background:var(--surface-alt)">
          <strong>Last Live Regional Hub Probe (${esc(new Date(snap.checkedAt).toLocaleString())}):</strong>
          ${
            snap.reachable
              ? `Detected tabs: ${Object.entries(snap.tabRowCounts || {})
                  .map(([tab, cnt]) => `<span class="badge badge-blue" style="margin-left:6px">${esc(tab)}: ${cnt} rows</span>`)
                  .join('')}`
              : `<span class="badge badge-red">${esc(snap.error)}</span>`
          }
        </div>
      `
          : ''
      }
    </div>

    <!-- Section 2: Workbook Import & GAS Web App Endpoint -->
    <section class="grid-2">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">Import Provincial / Regional Workbook (.XLSX)</h3>
            <p class="panel-subtitle">Consolidate exported Google Sheets directly into the Hub</p>
          </div>
        </div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:12px">
          <p style="margin:0;color:var(--text-muted);font-size:13px">
            Upload any <code>.xlsx</code> export from the Regional Hub or the 6 Provincial Nodes.
            Automatically recognizes <strong>Milestone_Data</strong> and all 6 OPTool tabs
            (<code>Database</code>, <code>CF(DOC)</code>, <code>Survey</code>, <code>MOV</code>, <code>RegistrationDistribution</code>, <code>Installation</code>).
          </p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <select id="xlsx-import-mode" class="form-control" style="max-width:240px">
              <option value="merge">Merge / Upsert with Existing Data</option>
              ${isScoped ? '' : '<option value="replace">Replace All Data with Workbook</option>'}
            </select>
            <label class="btn btn-primary btn-sm" style="margin:0">
              Upload .XLSX Workbook
              <input type="file" accept=".xlsx" id="xlsx-file-upload" class="hidden" />
            </label>
          </div>
          ${
            isScoped
              ? `<p style="margin:0;font-size:12px;color:var(--text-muted)">Imports are automatically filtered to <strong>${esc(
                  provinceScope.provinceName
                )} (${esc(provinceScope.code)})</strong> records.</p>`
              : `
                <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;gap:8px;flex-wrap:wrap">
                  <button class="btn btn-secondary btn-sm" id="btn-reset-sample">Restore Sample Staging Data</button>
                  <button class="btn btn-danger btn-sm" id="btn-clear-workspace">Clear to Empty Live Workspace</button>
                </div>
              `
          }
        </div>
      </div>

      ${
        isScoped
          ? ''
          : `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">Google Apps Script (GAS) Two-Way Web App Bridge</h3>
            <p class="panel-subtitle">Connect private provincial &amp; hub sheets for live read/write sync</p>
          </div>
        </div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:10px">
          <label for="gas-url-input" style="font-size:12px;font-weight:700;color:var(--text-muted)">Deployed GAS Web App URL (<code>/exec</code>)</label>
          <input
            type="url"
            id="gas-url-input"
            class="form-control mono"
            placeholder="https://script.google.com/macros/s/.../exec"
            value="${esc(state.gasWebAppUrl || '')}"
          />
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" id="btn-save-gas-url">Save Endpoint</button>
            <button class="btn btn-primary btn-sm" id="btn-pull-gas-url">Pull Snapshot via GAS</button>
            <button class="btn btn-secondary btn-sm" id="btn-sync-gas-headers">Sync Column Headers to Google Sheets</button>
          </div>
          <p style="margin:0;font-size:12px;color:var(--text-muted)">
            When configured (or set via Vercel <code>GAS_WEB_APP_URL</code> env var), edits across all <strong>6 OPTool tabs</strong>, <strong>Milestone_Data</strong>, and <strong>Regional_Baselines</strong> automatically push live to your Google Sheet, while active spreadsheets auto-sync in the background.
          </p>
        </div>
      </div>
      `
      }
    </section>

    ${
      isScoped
        ? ''
        : `
    <!-- Section 3: Ready-to-Deploy GAS ETL Pipeline Code -->
    <div class="panel">
      <div class="panel-header">
        <div>
          <h3 class="panel-title">2. Automated Google Apps Script (GAS) ETL Pipeline (<code>gas/Code.gs</code>)</h3>
          <p class="panel-subtitle">Extracts all 6 provincial sub-ledgers, normalizes Area (4-dec) &amp; Record_IDs, and loads into Regional Hub</p>
        </div>
        <div class="toolbar-left">
          <button class="btn btn-primary btn-sm" id="btn-copy-gas">Copy Code.gs</button>
        </div>
      </div>
      <div class="panel-body">
        <pre class="code-pre">${esc(gasScript)}</pre>
      </div>
    </div>

    <!-- Section 3b: Optional Hosted GAS Web App UI -->
    <div class="panel">
      <div class="panel-header">
        <div>
          <h3 class="panel-title">3. Standalone GAS Web App Frontend (<code>gas/Index.html</code>)</h3>
          <p class="panel-subtitle">Paste as "Index" HTML file inside Google Apps Script to host the UI directly on script.google.com</p>
        </div>
        <div class="toolbar-left">
          <button class="btn btn-secondary btn-sm" id="btn-copy-gas-html">Copy Index.html</button>
        </div>
      </div>
      <div class="panel-body">
        <pre class="code-pre" style="max-height:240px">${esc(gasHtml || '')}</pre>
      </div>
    </div>
    `
    }

    <!-- Section 4: Sync & Consolidation Audit Log -->
    <div class="panel">
      <div class="panel-header">
        <div>
          <h3 class="panel-title">ETL &amp; Consolidation Sync Activity Log</h3>
          <p class="panel-subtitle">Recent Google Sheet probes, imports, and GAS events</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Source</th>
              <th>Status</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            ${(state.syncLogs || [])
              .map(
                (log) => `
              <tr>
                <td class="mono" style="white-space:nowrap;font-size:11.5px">${esc(new Date(log.timestamp).toLocaleString())}</td>
                <td style="font-weight:600">${esc(log.source)}</td>
                <td>
                  <span class="badge ${
                    log.status === 'success'
                      ? 'badge-green'
                      : log.status === 'error'
                      ? 'badge-red'
                      : 'badge-blue'
                  }">${esc(log.status.toUpperCase())}</span>
                </td>
                <td>${esc(log.message)}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/** Render Administrator Account Confirmation & User Directory view. */
export function renderUsersView({ users = [], currentUser = null }) {
  const pendingCount = users.filter((u) => u.status === 'pending').length;
  const approvedCount = users.filter((u) => u.status === 'approved').length;
  const rejectedCount = users.filter((u) => u.status === 'rejected').length;

  const statusBadge = (status) => {
    if (status === 'approved') return '<span class="badge badge-green">CONFIRMED</span>';
    if (status === 'rejected') return '<span class="badge badge-red">DECLINED</span>';
    return '<span class="badge badge-amber">PENDING CONFIRMATION</span>';
  };

  return `
    <div class="view-header">
      <div>
        <h2>Account Confirmations &amp; User Access</h2>
        <p class="view-subtitle">Confirm pending Sign-Up registrations before provincial users can access SALIG</p>
      </div>
      <div class="view-header-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="btn-sync-users-sheet">Sync User_Accounts with Regional Sheet</button>
        <button class="btn btn-secondary btn-sm" id="btn-refresh-users">↻ Refresh Accounts</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Pending Confirmation</div>
        <div class="kpi-value" style="color: var(--amber)">${pendingCount}</div>
        <div class="kpi-sub">Awaiting administrator approval</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Confirmed Users</div>
        <div class="kpi-value" style="color: var(--accent)">${approvedCount}</div>
        <div class="kpi-sub">Active Region VIII accounts</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Declined Accounts</div>
        <div class="kpi-value">${rejectedCount}</div>
        <div class="kpi-sub">Rejected registrations</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Registered</div>
        <div class="kpi-value">${users.length}</div>
        <div class="kpi-sub">All regional accounts</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h3 class="panel-title">Registered Accounts (${users.length})</h3>
          <p class="panel-subtitle">Pending registrations appear first so Administrators can verify provincial details and confirm access</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Full Name</th>
              <th>Email</th>
              <th>Province</th>
              <th>Contact Number</th>
              <th>Role</th>
              <th>Status</th>
              <th>Requested</th>
              <th style="text-align:right">Administrator Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              users.length === 0
                ? '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">No user accounts found.</td></tr>'
                : users
                    .map((u) => {
                      const isSelf = currentUser && currentUser.id === u.id;
                      const createdText = u.createdAt
                        ? new Date(u.createdAt).toLocaleString()
                        : '—';
                      return `
                        <tr>
                          <td>
                            <strong>${esc(u.name)}</strong>
                            ${isSelf ? '<span class="badge badge-blue" style="margin-left:6px">YOU</span>' : ''}
                          </td>
                          <td class="mono" style="font-size:12px">${esc(u.email)}</td>
                          <td>${esc(u.province || '—')}</td>
                          <td class="mono" style="font-size:12px">${esc(u.contactNumber || '—')}</td>
                          <td>
                            <span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}">${esc(String(u.role || 'user').toUpperCase())}</span>
                          </td>
                          <td>${statusBadge(u.status)}</td>
                          <td class="mono" style="font-size:11.5px;white-space:nowrap">${esc(createdText)}</td>
                          <td style="text-align:right;white-space:nowrap">
                            ${
                              u.status !== 'approved'
                                ? `<button class="btn btn-primary btn-sm" data-user-action="approve" data-user-id="${esc(u.id)}">✓ Confirm</button>`
                                : ''
                            }
                            ${
                              u.status !== 'rejected' && !isSelf
                                ? `<button class="btn btn-danger btn-sm" style="margin-left:4px" data-user-action="reject" data-user-id="${esc(u.id)}">Decline</button>`
                                : ''
                            }
                            ${
                              u.status === 'approved' && !isSelf
                                ? `<button class="btn btn-secondary btn-sm" style="margin-left:4px" data-user-action="${
                                    u.role === 'admin' ? 'demote' : 'promote'
                                  }" data-user-id="${esc(u.id)}">${
                                    u.role === 'admin' ? 'Set User' : 'Make Admin'
                                  }</button>`
                                : ''
                            }
                            ${
                              !isSelf
                                ? `<button class="btn btn-danger btn-sm" style="margin-left:4px" data-user-action="delete" data-user-id="${esc(
                                    u.id
                                  )}" data-user-name="${esc(u.name || u.email)}">Delete</button>`
                                : ''
                            }
                          </td>
                        </tr>
                      `;
                    })
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

