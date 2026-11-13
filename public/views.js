import { renderTrendChartSvg, renderProvincialComparisonSvg } from './charts.js';
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
      ? `<div class="nep-sub-metric">${Number(rateAreaPct || 0).toFixed(2)}% HAS</div>`
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
  const totalQuarterCols = quartersConfig.reduce((acc, q) => acc + (isQExpanded(q.q) ? 4 : 1), 0);
  const totalTableCols = totalQuarterCols + 5;

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
          <button type="button" class="btn btn-sm ${nepShowProvinces ? 'btn-primary' : 'btn-secondary'}" id="btn-toggle-nep-provinces" title="Show or hide provincial breakdown rows for all milestones">
            <span class="fs-icon">${nepShowProvinces ? '−' : '+'}</span> <span>${nepShowProvinces ? 'Hide All Provinces' : 'Show All Provinces'}</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-sync-hub-nep" title="Fetch live NEP target data from Regional Hub Google Sheet">
            Fetch Hub NEP Targets
          </button>
          ${
            canEditNepTargets
              ? `<button type="button" class="btn btn-primary btn-sm" id="btn-edit-nep-targets">Regional NEP Target List</button>`
              : ''
          }
          <button type="button" class="btn btn-secondary btn-sm btn-fullscreen" id="btn-fullscreen-nep" title="Full Screen Report / Table">
            <span class="fs-icon">⛶</span> <span class="fs-label">Full Screen</span>
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="nep-milestone-table">
          <thead>
            ${
              !hasAnyMonthExpanded
                ? `
            <tr>
              <th rowspan="2" class="nep-th-milestone-col">
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
              <th rowspan="2" class="right">NEP Target</th>
              <th colspan="4" class="center nep-quarter-group">Accomp. per Quarter</th>
              <th rowspan="2" class="right">Total</th>
              <th rowspan="2" class="right">Rate of Accomp.</th>
              <th rowspan="2" class="right">Variance</th>
            </tr>
            <tr>
              <th class="right nep-q-col-header" data-toggle-q="1" title="Click to show months for Q1">Q1 <span class="q-toggle-pill">+</span></th>
              <th class="right nep-q-col-header" data-toggle-q="2" title="Click to show months for Q2">Q2 <span class="q-toggle-pill">+</span></th>
              <th class="right nep-q-col-header" data-toggle-q="3" title="Click to show months for Q3">Q3 <span class="q-toggle-pill">+</span></th>
              <th class="right nep-q-col-header" data-toggle-q="4" title="Click to show months for Q4">Q4 <span class="q-toggle-pill">+</span></th>
            </tr>
            `
                : `
            <tr>
              <th rowspan="3" class="nep-th-milestone-col">
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
              <th rowspan="3" class="right">NEP Target</th>
              <th colspan="${totalQuarterCols}" class="center nep-quarter-group">Accomp. per Quarter &amp; Monthly</th>
              <th rowspan="3" class="right">Total</th>
              <th rowspan="3" class="right">Rate of Accomp.</th>
              <th rowspan="3" class="right">Variance</th>
            </tr>
            <tr>
              ${quartersConfig
                .map((q) => {
                  if (isQExpanded(q.q)) {
                    return `<th colspan="4" class="center nep-quarter-group nep-q-header expanded" data-toggle-q="${q.q}" title="Click to hide Q${q.q} months">Q${q.q} <span class="q-toggle-pill">Hide Months ▴</span></th>`;
                  }
                  return `<th rowspan="2" class="right nep-quarter-group nep-q-header collapsed" data-toggle-q="${q.q}" title="Click to show Q${q.q} months">Q${q.q} <span class="q-toggle-pill">+ Months ▾</span></th>`;
                })
                .join('')}
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
                <td>
                  <button
                    type="button"
                    class="nep-milestone-link"
                    data-open-optool-tab="${esc(r.sourceTab)}"
                    title="Open ${esc(r.label)} in Optool Supportlist"
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
                <td class="right">${formatNepMetricCell(r.nepTargetCount, r.nepTargetAreaHas, nepMetricMode)}</td>
                ${quartersConfig
                  .map((q) => {
                    const qData = r[`q${q.q}`] || { count: 0, areaHas: 0 };
                    if (!isQExpanded(q.q)) {
                      return `<td class="right">${formatNepMetricCell(qData.count, qData.areaHas, nepMetricMode)}</td>`;
                    }
                    const m1 = r.months?.[q.months[0].num] || { count: 0, areaHas: 0 };
                    const m2 = r.months?.[q.months[1].num] || { count: 0, areaHas: 0 };
                    const m3 = r.months?.[q.months[2].num] || { count: 0, areaHas: 0 };
                    return `
                      <td class="right nep-month-cell">${formatNepMetricCell(m1.count, m1.areaHas, nepMetricMode)}</td>
                      <td class="right nep-month-cell">${formatNepMetricCell(m2.count, m2.areaHas, nepMetricMode)}</td>
                      <td class="right nep-month-cell">${formatNepMetricCell(m3.count, m3.areaHas, nepMetricMode)}</td>
                      <td class="right nep-q-total-cell">${formatNepMetricCell(qData.count, qData.areaHas, nepMetricMode)}</td>
                    `;
                  })
                  .join('')}
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
                  <td class="nep-prov-subcell">
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
                  <td class="right">${formatNepMetricCell(pd.targetCount, pd.targetAreaHas, nepMetricMode)}</td>
                  ${quartersConfig
                    .map((q) => {
                      const qData = pd[`q${q.q}`] || { count: 0, areaHas: 0 };
                      if (!isQExpanded(q.q)) {
                        return `<td class="right">${formatNepMetricCell(qData.count, qData.areaHas, nepMetricMode)}</td>`;
                      }
                      const m1 = pd.months?.[q.months[0].num] || { count: 0, areaHas: 0 };
                      const m2 = pd.months?.[q.months[1].num] || { count: 0, areaHas: 0 };
                      const m3 = pd.months?.[q.months[2].num] || { count: 0, areaHas: 0 };
                      return `
                        <td class="right nep-month-cell">${formatNepMetricCell(m1.count, m1.areaHas, nepMetricMode)}</td>
                        <td class="right nep-month-cell">${formatNepMetricCell(m2.count, m2.areaHas, nepMetricMode)}</td>
                        <td class="right nep-month-cell">${formatNepMetricCell(m3.count, m3.areaHas, nepMetricMode)}</td>
                        <td class="right nep-q-total-cell">${formatNepMetricCell(qData.count, qData.areaHas, nepMetricMode)}</td>
                      `;
                    })
                    .join('')}
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
        area: item.area || 0,
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
              <th>Province</th>
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
                <td>
                  <strong>${esc(r.provinceName)}</strong>
                  <div class="nep-sub-metric">${esc(r.code)}</div>
                </td>
                <td class="right">${(Number(r.lhs) || 0).toLocaleString('en-US')}</td>
                <td class="right">${fmtArea(r.area || 0)}</td>
                <td class="right">${(Number(r.arbs) || 0).toLocaleString('en-US')}</td>
                <td class="center"><span class="badge badge-gray">${esc(String(r.year || 2026))}</span></td>
              </tr>
            `
              )
              .join('')}
            ${
              rows.length > 1
                ? `
              <tr style="font-weight:700;background:var(--surface-alt, #f8faf9);">
                <td>Region VIII Total</td>
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
  const { analytics, currentUser, provinceScope, nepYearFilter = '2026', nepMilestoneFilter = 'overall', nepDisplayMode = 'table', schemas } = ctx;
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
        area: item.area || 0,
        arbs: item.arbs || 0,
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

  const activeFilter = String(nepYearFilter || '2026');
  const filteredRows =
    activeFilter === 'ALL'
      ? rawRows
      : rawRows.filter((r) => String(r.year || 2026) === activeFilter);

  const totals = {
    lhs: filteredRows.reduce((s, r) => s + (Number(r.lhs) || 0), 0),
    area: Number(filteredRows.reduce((s, r) => s + (Number(r.area) || 0), 0).toFixed(4)),
    arbs: filteredRows.reduce((s, r) => s + (Number(r.arbs) || 0), 0)
  };

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
                <div class="nep-stat-box">
                  <span class="nep-stat-label">LHS</span>
                  <span class="nep-stat-val">${(Number(r.lhs) || 0).toLocaleString('en-US')}</span>
                </div>
                <div class="nep-stat-box">
                  <span class="nep-stat-label">AREA (HAS)</span>
                  <span class="nep-stat-val">${fmtArea(r.area || 0)}</span>
                </div>
                <div class="nep-stat-box">
                  <span class="nep-stat-label">ARBs</span>
                  <span class="nep-stat-val">${(Number(r.arbs) || 0).toLocaleString('en-US')}</span>
                </div>
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
        <div class="table-wrap">
          <table class="nep-sheet-table">
            <thead>
              <tr>
                <th style="min-width:180px;">Province</th>
                <th class="right" style="width:130px;">LHS</th>
                <th class="right" style="width:160px;">AREA (HAS)</th>
                <th class="right" style="width:130px;">ARBs</th>
                <th class="center" style="width:120px;">Target Year</th>
                ${canEditNep ? '<th class="center" style="width:130px;">Action</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${filteredRows
                .map(
                  (r) => `
                <tr>
                  <td>
                    <strong>${esc(r.provinceName)}</strong>
                    <div class="nep-sub-metric">${esc(r.code)}</div>
                  </td>
                  <td class="right" style="font-weight:600;">${(Number(r.lhs) || 0).toLocaleString('en-US')}</td>
                  <td class="right" style="font-weight:700;color:var(--dar-green-dark);">${fmtArea(r.area || 0)}</td>
                  <td class="right" style="font-weight:600;">${(Number(r.arbs) || 0).toLocaleString('en-US')}</td>
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
                  <td>Region VIII Total</td>
                  <td class="right">${(Number(totals.lhs) || 0).toLocaleString('en-US')}</td>
                  <td class="right" style="color:var(--dar-green-dark);">${fmtArea(totals.area || 0)}</td>
                  <td class="right">${(Number(totals.arbs) || 0).toLocaleString('en-US')}</td>
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

    ${renderMilestoneNepSection(ctx)}

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
        <button class="btn btn-secondary btn-sm" data-nav="optool">Open Optool Supportlist</button>
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

function normalizeFilterSpec(filterSpec) {
  if (filterSpec === null || filterSpec === undefined) return { mode: 'auto', value: '' };
  if (typeof filterSpec === 'object') {
    return {
      mode: filterSpec.mode || 'auto',
      value: String(filterSpec.value ?? '').trim()
    };
  }
  return { mode: 'auto', value: String(filterSpec).trim() };
}

export function getColumnFilterLabel(filterSpec, colType = 'text') {
  const { mode, value } = normalizeFilterSpec(filterSpec);
  if (!value) return 'All';
  if (value === BLANK_FILTER_TOKEN) return colType === 'checkbox' ? '(Unchecked)' : '(Blank)';
  return mode === 'contains' ? `~ ${value}` : value;
}

function matchesColumnFilter(cellValue, filterSpec, colType) {
  const { mode, value: q } = normalizeFilterSpec(filterSpec);
  if (!q) return true;

  if (colType === 'checkbox') {
    const checked = isChecklistChecked(cellValue);
    if (q === BLANK_FILTER_TOKEN) return !checked;
    const qLower = q.toLowerCase();
    if (mode === 'exact') {
      if (qLower === 'checked' || qLower === 'yes' || qLower === 'true' || qLower === '1') return checked;
      if (qLower === 'unchecked' || qLower === 'no' || qLower === 'false' || qLower === '0') return !checked;
      return (checked ? 'checked' : 'unchecked') === qLower;
    }
    const hay = checked ? 'checked yes true' : 'unchecked no false blank';
    return hay.includes(qLower);
  }

  const raw = String(cellValue ?? '').trim();

  if (q === BLANK_FILTER_TOKEN) return raw === '';
  if (mode === 'exact') return raw.toLowerCase() === q.toLowerCase();

  // Support optional numeric comparisons (>10, >=5, <20, <=5) on decimal/integer columns
  if (colType === 'decimal' || colType === 'integer') {
    const numMatch = q.match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
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

  return raw.toLowerCase().includes(q.toLowerCase());
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

