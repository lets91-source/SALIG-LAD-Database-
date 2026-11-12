import {
  esc,
  fmtArea,
  isChecklistChecked,
  getGroupVariantClass,
  LINKED_DB_PROFILE_FIELDS,
  renderDashboardView,
  renderMilestonesView,
  renderOptoolView,
  renderOptoolPartial,
  getColumnFilterValues,
  getColumnFilterLabel,
  renderSyncView
} from './views.js';
import {
  formatCurrentMonthYear,
  getReportedMonthOptions,
  isReportedMonthKey,
  resolveTargetFromDatabaseRow,
  SURVEY_STATUS_STAGES,
  resolveSurveyCurrentStatus,
  resolveTotalArbsFromGenderCounts
} from './reportingUtils.js';

const appState = {
  view: 'dashboard',
  schemas: null,
  state: null,
  analytics: null,
  gasScript: '',
  gasHtml: '',
  activeOptoolTab: 'Database',
  monitoringLevel: 'both', // 'both' | 'etitles' | 'area'
  measurementLogic: 'both', // 'both' | 'incremental' | 'cumulative'
  filters: {
    province: 'ALL',
    periodMonth: 'LATEST',
    batch: 'ALL'
  },
  msSearch: '',
  optoolSearch: '',
  optoolTargetFilter: 'ALL',
  optoolColFilters: {},
  optoolPage: 1,
  optoolPageSize: 50,
  optoolColMode: 'preview',
  optoolColPage: 1
};

const AUTO_SYNC_MAX_AGE_MS = 2 * 60 * 1000;
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

let optoolSearchTimer = null;
let closeColPopoverFn = null;
let isAutoSyncRunning = false;
let autoSyncTimer = null;

function formatGasPushSuffix(res) {
  if (!res?.gasPushResult) return '';
  if (res.gasPushResult.ok) return ' & synced to Google Sheet';
  return ` (Google Sheet push warning: ${res.gasPushResult.error || 'failed'})`;
}

function closeColFilterPopover() {
  if (closeColPopoverFn) {
    closeColPopoverFn();
    closeColPopoverFn = null;
  }
}

function getOptoolFilterContext() {
  return {
    state: appState.state,
    schemas: appState.schemas,
    activeOptoolTab: appState.activeOptoolTab,
    searchTerm: appState.optoolSearch,
    optoolTargetFilter: appState.optoolTargetFilter,
    optoolColFilters: appState.optoolColFilters,
    optoolPage: appState.optoolPage,
    optoolPageSize: appState.optoolPageSize,
    optoolColMode: appState.optoolColMode,
    optoolColPage: appState.optoolColPage,
    filters: appState.filters
  };
}

function openColFilterPopover(triggerBtn, colKey, container) {
  const existingKey = document.getElementById('col-filter-popover')?.dataset.colKey;
  closeColFilterPopover();
  if (existingKey === colKey) return; // Toggle closed on second click

  const ctx = getOptoolFilterContext();
  const { col, blankCount, totalRows, values } = getColumnFilterValues(ctx, colKey);
  if (!col) return;

  const currentSpec = appState.optoolColFilters[colKey];
  const currentVal =
    typeof currentSpec === 'object' && currentSpec !== null
      ? String(currentSpec.value ?? '')
      : String(currentSpec ?? '');

  const pop = document.createElement('div');
  pop.id = 'col-filter-popover';
  pop.className = 'col-filter-popover';
  pop.dataset.colKey = colKey;
  const searchPlaceholder =
    col.type === 'decimal' ? `Search ${col.label} or >10…` : `Search ${col.label}…`;

  pop.innerHTML = `
    <div class="col-dd-head">
      <div class="col-dd-title">
        <span>Filter: ${esc(col.label)}</span>
        <span>${values.length} option(s)</span>
      </div>
      <input
        type="search"
        id="col-dd-search"
        class="col-dd-search"
        placeholder="${esc(searchPlaceholder)}"
        autocomplete="off"
      />
    </div>
    <div class="col-dd-list" id="col-dd-list" role="listbox"></div>
    <div class="col-dd-meta" id="col-dd-meta"></div>
  `;

  document.body.appendChild(pop);

  const rect = triggerBtn.getBoundingClientRect();
  const popWidth = pop.offsetWidth || 260;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 12));
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const openAbove = spaceBelow < 220 && rect.top > spaceBelow;
  pop.style.left = `${left}px`;
  if (openAbove) {
    pop.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    pop.style.top = `${rect.bottom + 4}px`;
  }

  const listEl = pop.querySelector('#col-dd-list');
  const metaEl = pop.querySelector('#col-dd-meta');
  const searchEl = pop.querySelector('#col-dd-search');

  const applyFilter = (spec) => {
    if (!spec || !spec.value) {
      delete appState.optoolColFilters[colKey];
    } else {
      appState.optoolColFilters[colKey] = spec;
    }
    appState.optoolPage = 1;
    updateOptoolRowsInPlace(container);
    closeColFilterPopover();
  };

  let lastFiltered = values;
  const renderList = (queryText = '') => {
    const q = queryText.trim();
    const qLower = q.toLowerCase();
    const filtered = q ? values.filter((v) => v.value.toLowerCase().includes(qLower)) : values;
    lastFiltered = filtered;

    const MAX_RENDERED = 200;
    const shown = filtered.slice(0, MAX_RENDERED);
    const parts = [];

    const blankLabel = col.type === 'checkbox' ? '(Unchecked)' : '(Blank)';
    if (!q) {
      parts.push(`
        <button type="button" class="col-dd-item ${!currentVal ? 'selected' : ''}" data-dd-mode="clear" data-dd-val="">
          <span class="col-dd-val">(All)</span>
          <span class="col-dd-count">${totalRows}</span>
        </button>
      `);
      if (blankCount > 0) {
        parts.push(`
          <button type="button" class="col-dd-item ${currentVal === '__BLANK__' ? 'selected' : ''}" data-dd-mode="exact" data-dd-val="__BLANK__">
            <span class="col-dd-val">${blankLabel}</span>
            <span class="col-dd-count">${blankCount}</span>
          </button>
        `);
      }
    } else {
      const hintMode =
        col.type === 'decimal' && /^(>=|<=|>|<|=)\s*-?\d/.test(q) ? q : `Contains "${q}"`;
      parts.push(`
        <button type="button" class="col-dd-item contains-opt" data-dd-mode="contains" data-dd-val="${esc(q)}">
          <span class="col-dd-val">${esc(hintMode)}</span>
          <span class="col-dd-count">Enter</span>
        </button>
      `);
      if (col.type === 'checkbox' && blankCount > 0 && 'unchecked'.includes(qLower)) {
        parts.push(`
          <button type="button" class="col-dd-item ${currentVal === '__BLANK__' ? 'selected' : ''}" data-dd-mode="exact" data-dd-val="__BLANK__">
            <span class="col-dd-val">${blankLabel}</span>
            <span class="col-dd-count">${blankCount}</span>
          </button>
        `);
      }
    }

    for (const item of shown) {
      const isSelected = currentVal && currentVal.toLowerCase() === item.value.toLowerCase();
      parts.push(`
        <button type="button" class="col-dd-item ${isSelected ? 'selected' : ''}" data-dd-mode="exact" data-dd-val="${esc(item.value)}">
          <span class="col-dd-val" title="${esc(item.value)}">${esc(item.value)}</span>
          <span class="col-dd-count">${item.count}</span>
        </button>
      `);
    }

    if (parts.length === 0 || (q && shown.length === 0)) {
      parts.push('<div style="padding:10px;font-size:12px;color:var(--text-muted)">No exact option match — click above to filter by text.</div>');
    }

    listEl.innerHTML = parts.join('');
    metaEl.textContent =
      filtered.length > MAX_RENDERED
        ? `Showing ${MAX_RENDERED} of ${filtered.length} options — keep typing to narrow`
        : `${filtered.length} distinct value(s)`;
  };

  renderList('');
  searchEl.focus();

  searchEl.addEventListener('input', (e) => renderList(e.target.value));
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeColFilterPopover();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = searchEl.value.trim();
      if (!q) {
        applyFilter(null);
      } else if (lastFiltered.length === 1) {
        applyFilter({ mode: 'exact', value: lastFiltered[0].value });
      } else {
        applyFilter({ mode: 'contains', value: q });
      }
    }
  });

  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('[data-dd-mode]');
    if (!item) return;
    const mode = item.dataset.ddMode;
    const val = item.dataset.ddVal || '';
    if (mode === 'clear' || !val) {
      applyFilter(null);
    } else {
      applyFilter({ mode, value: val });
    }
  });

  const onDocMouseDown = (e) => {
    if (!pop.contains(e.target) && !triggerBtn.contains(e.target)) {
      closeColFilterPopover();
    }
  };
  const wrap = container.querySelector('#optool-table-wrap');
  const onScrollClose = () => closeColFilterPopover();
  document.addEventListener('mousedown', onDocMouseDown);
  wrap?.addEventListener('scroll', onScrollClose, { passive: true });

  closeColPopoverFn = () => {
    document.removeEventListener('mousedown', onDocMouseDown);
    wrap?.removeEventListener('scroll', onScrollClose);
    pop.remove();
  };
}

async function api(path, options = {}) {
  const resp = await fetch(path, options);
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp;
}

function toast(message, isError = false) {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${isError ? 'error' : ''}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function renderStatusBanner() {
  const banner = document.getElementById('status-banner');
  const mode = appState.state.dataSourceMode || 'sample';
  const badge = document.getElementById('sidebar-mode-badge');
  const snap = appState.state.liveHubSnapshot || {};

  const modeLabel =
    mode === 'live'
      ? 'Live Google Sheet'
      : mode === 'merged'
      ? 'Merged (Sheet + Local)'
      : 'Sample Staging';

  if (badge) badge.textContent = modeLabel;
  if (!banner) return;

  const liveInfo = snap.checkedAt
    ? snap.reachable
      ? `Live Hub Sheet verified (${Object.keys(snap.tabRowCounts || {}).length} tabs, ${Object.values(
          snap.tabRowCounts || {}
        ).reduce((a, b) => a + Number(b || 0), 0)} live rows).`
      : `Live Hub probe error: ${snap.error}`
    : 'Regional Hub Google Sheet (1jTVJ...qb0Lw) ready for live sync.';

  if (mode === 'sample') {
    banner.className = 'status-banner sample';
    banner.innerHTML = `
      <div class="status-banner-left">
        <span class="badge badge-amber">SAMPLE STAGING MODE</span>
        <span>Showing realistic Region VIII baseline &amp; sample data. ${esc(liveInfo)}</span>
      </div>
      <div class="status-banner-actions">
        <button class="btn btn-secondary btn-sm" id="banner-sync-btn">Sync Live Sheet</button>
        <button class="btn btn-secondary btn-sm" id="banner-clear-btn">Use Empty Live Mode</button>
      </div>
    `;
  } else {
    banner.className = 'status-banner live';
    banner.innerHTML = `
      <div class="status-banner-left">
        <span class="badge badge-green">${esc(modeLabel.toUpperCase())}</span>
        <span>${esc(liveInfo)}</span>
      </div>
      <div class="status-banner-actions">
        <button class="btn btn-secondary btn-sm" id="banner-sync-btn">Refresh Live Sheet</button>
        <button class="btn btn-secondary btn-sm" id="banner-sample-btn">Load Sample Data</button>
      </div>
    `;
  }

  document.getElementById('banner-sync-btn')?.addEventListener('click', () => syncRegionalHub('merge'));
  document.getElementById('banner-clear-btn')?.addEventListener('click', clearToEmptyWorkspace);
  document.getElementById('banner-sample-btn')?.addEventListener('click', resetSampleWorkspace);
}

function updateNavCounts() {
  const msCountEl = document.getElementById('nav-ms-count');
  if (msCountEl) msCountEl.textContent = appState.state.milestoneData.length;
  const totalOptool = Object.values(appState.state.optool).reduce(
    (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
    0
  );
  const optoolCountEl = document.getElementById('nav-optool-count');
  if (optoolCountEl) optoolCountEl.textContent = totalOptool;
}

function updateHeaderTitles() {
  const titles = {
    dashboard: [
      'Region VIII Consolidated Dashboard',
      `Monitoring Level: ${
        appState.monitoringLevel === 'both'
          ? 'Both (eTitles & Area in HAS)'
          : appState.monitoringLevel === 'etitles'
          ? 'eTitles Only'
          : 'Area in HAS (4 dec)'
      } • Measurement Logic: ${
        appState.measurementLogic === 'both'
          ? 'Both (Incremental & Cumulative)'
          : appState.measurementLogic === 'incremental'
          ? 'Incremental Only'
          : 'Cumulative Baseline Only'
      }`
    ],
    milestones: [
      'Milestone_Data Transaction Ledger',
      'Standardized Region VIII Schema • Auto-Index (PROV-YYYYMM-XXXX) • LGU Master List Validation'
    ],
    optool: [
      'SALIG',
      'Smart Analytics & Logical Information Generator'
    ],
    sync: [
      'Google Sheets Registry & GAS ETL Hub',
      'Central Hub + 6 Provincial Nodes • Automated Google Apps Script ETL Pipeline & Workbook Import/Export'
    ]
  };
  const [title, sub] = titles[appState.view] || titles.dashboard;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = sub;

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === appState.view);
  });
}

function renderActiveView() {
  closeColFilterPopover();
  updateNavCounts();
  updateHeaderTitles();
  renderStatusBanner();

  const container = document.getElementById('view-container');
  const ctx = {
    state: appState.state,
    schemas: appState.schemas,
    analytics: appState.analytics,
    gasScript: appState.gasScript,
    gasHtml: appState.gasHtml,
    monitoringLevel: appState.monitoringLevel,
    measurementLogic: appState.measurementLogic,
    filters: appState.filters,
    activeOptoolTab: appState.activeOptoolTab
  };

  if (appState.view === 'dashboard') {
    container.innerHTML = renderDashboardView(ctx);
  } else if (appState.view === 'milestones') {
    container.innerHTML = renderMilestonesView({ ...ctx, searchTerm: appState.msSearch });
    bindMilestonesViewEvents(container);
  } else if (appState.view === 'optool') {
    container.innerHTML = renderOptoolView({ ...ctx, ...getOptoolFilterContext() });
    bindOptoolViewEvents(container);
  } else if (appState.view === 'sync') {
    container.innerHTML = renderSyncView(ctx);
    bindSyncViewEvents(container);
  }

  // Bind shared cross-view navigation, empty-state actions, and LHID 360 drawer triggers
  container.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.view = btn.dataset.nav;
      renderActiveView();
    });
  });
  container.querySelectorAll('[data-action="sync-all"]').forEach((btn) => {
    btn.addEventListener('click', () => syncAllNodes('merge'));
  });
  container.querySelectorAll('[data-action="load-sample"]').forEach((btn) => {
    btn.addEventListener('click', resetSampleWorkspace);
  });
  container.querySelectorAll('[data-lhid]').forEach((btn) => {
    btn.addEventListener('click', () => openLandholdingDrawer(btn.dataset.lhid));
  });
}

function bindMilestonesViewEvents(container) {
  const searchInput = container.querySelector('#ms-search');
  searchInput?.addEventListener('input', (e) => {
    appState.msSearch = e.target.value;
    const pos = e.target.selectionStart;
    renderActiveView();
    const nextInput = document.getElementById('ms-search');
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(pos, pos);
    }
  });

  container.querySelector('#btn-ms-add')?.addEventListener('click', () => openMilestoneModal(null));
  container.querySelector('#btn-ms-export-csv')?.addEventListener('click', exportMilestoneCsv);

  container.querySelector('#ms-csv-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const csvText = await file.text();
      const res = await api('/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, targetTab: 'Milestone_Data', filename: file.name })
      });
      appState.state.milestoneData = res.milestoneData;
      appState.state.syncLogs = res.syncLogs;
      await refreshAnalytics();
      toast(`Imported ${res.importedRows} Milestone_Data row(s) from ${file.name}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.querySelectorAll('[data-edit-ms]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rec = appState.state.milestoneData.find((r) => r.Record_ID === btn.dataset.editMs);
      if (rec) openMilestoneModal(rec);
    });
  });

  container.querySelectorAll('[data-del-ms]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delMs;
      if (!confirm(`Delete Milestone_Data record ${id}?`)) return;
      try {
        const res = await api(`/api/milestones/${encodeURIComponent(id)}`, { method: 'DELETE' });
        appState.state.milestoneData = res.milestoneData;
        await refreshAnalytics();
        toast(`Deleted ${id}`);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

function bindOptoolPagerEvents(container) {
  const wrap = container.querySelector('#optool-table-wrap');
  const pager = container.querySelector('#optool-pagination-bar');
  if (!pager) return;

  pager.querySelector('#optool-page-size')?.addEventListener('change', (e) => {
    appState.optoolPageSize = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value) || 50;
    appState.optoolPage = 1;
    updateOptoolRowsInPlace(container);
    if (wrap) wrap.scrollTop = 0;
  });

  pager.querySelectorAll('[data-optool-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.optoolPage = Number(btn.dataset.optoolPage) || 1;
      updateOptoolRowsInPlace(container);
      if (wrap) wrap.scrollTop = 0;
    });
  });

  pager.querySelectorAll('[data-optool-col-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.optoolColPage = Number(btn.dataset.optoolColPage) || 1;
      renderActiveView();
    });
  });

  if (wrap) {
    pager.querySelectorAll('[data-hscroll]').forEach((btn) => {
      btn.addEventListener('click', () => {
        wrap.scrollBy({ left: Number(btn.dataset.hscroll) || 0, behavior: 'smooth' });
      });
    });
  }
}

function updateOptoolRowsInPlace(container) {
  const ctx = getOptoolFilterContext();
  const { kpiCardsHtml, tbodyHtml, paginationHtml, badgeText, hasAnyFilter } = renderOptoolPartial(ctx);
  const kpiCards = container.querySelector('#optool-kpi-cards');
  const tbody = container.querySelector('#optool-tbody');
  const pager = container.querySelector('#optool-pagination-bar');
  const badge = container.querySelector('#optool-count-badge');
  const clearBtn = container.querySelector('#btn-clear-col-filters');
  if (kpiCards) kpiCards.innerHTML = kpiCardsHtml;
  if (tbody) tbody.innerHTML = tbodyHtml;
  if (pager) {
    pager.innerHTML = paginationHtml;
    bindOptoolPagerEvents(container);
  }
  if (badge) badge.textContent = badgeText;
  if (clearBtn) clearBtn.disabled = !hasAnyFilter;
  container.querySelectorAll('#optool-thead [data-col-dropdown]').forEach((btn) => {
    const key = btn.dataset.colDropdown;
    const colLabel = btn.dataset.colLabel || '';
    const colType = btn.dataset.colType || 'text';
    const label = getColumnFilterLabel(appState.optoolColFilters[key], colType);
    const isActive = label !== 'All';
    btn.classList.toggle('active-filter', isActive);
    btn.title = isActive ? `${colLabel}: ${label}` : `Filter ${colLabel}`;
    const txtEl = btn.querySelector('.col-filter-btn-text');
    if (txtEl) {
      txtEl.textContent = isActive ? label : '';
      txtEl.hidden = !isActive;
    }
  });
  tbody?.querySelectorAll('[data-lhid]').forEach((btn) => {
    btn.addEventListener('click', () => openLandholdingDrawer(btn.dataset.lhid));
  });
}

async function commitOptoolInlineField(container, { tabName, idx, colKey, nextVal, onRollback }) {
  const existing = appState.state.optool[tabName]?.[idx];
  if (!existing || !colKey) return null;
  const updatedRow = { ...existing, [colKey]: nextVal };
  try {
    const res = await api(`/api/optool/${encodeURIComponent(tabName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row: updatedRow, index: idx })
    });
    if (res.optool) {
      appState.state.optool = res.optool;
    } else {
      appState.state.optool[tabName] = res.rows;
    }
    appState.analytics = res.analytics;
    if (appState.optoolColFilters[colKey] || appState.optoolSearch) {
      updateOptoolRowsInPlace(container);
    }
    const schemaCol = (appState.schemas.optoolTabs[tabName] || []).find((c) => c.key === colKey);
    return schemaCol?.label || colKey;
  } catch (err) {
    onRollback?.();
    toast(err.message, true);
    return null;
  }
}

function bindOptoolViewEvents(container) {
  container.querySelectorAll('[data-optool-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.activeOptoolTab = btn.dataset.optoolTab;
      appState.optoolSearch = '';
      appState.optoolColFilters = {};
      appState.optoolPage = 1;
      appState.optoolColPage = 1;
      renderActiveView();
    });
  });

  const searchInput = container.querySelector('#optool-search');
  searchInput?.addEventListener('input', (e) => {
    appState.optoolSearch = e.target.value;
    appState.optoolPage = 1;
    clearTimeout(optoolSearchTimer);
    optoolSearchTimer = setTimeout(() => updateOptoolRowsInPlace(container), 120);
  });

  container.querySelector('#optool-kpi-cards')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-kpi-target]');
    if (!card) return;
    const target = card.dataset.kpiTarget || '';
    appState.optoolTargetFilter = appState.optoolTargetFilter === target ? 'ALL' : target;
    appState.optoolPage = 1;
    const targetSel = container.querySelector('#optool-target-filter');
    if (targetSel) targetSel.value = appState.optoolTargetFilter;
    updateOptoolRowsInPlace(container);
  });

  container.querySelector('#optool-target-filter')?.addEventListener('change', (e) => {
    appState.optoolTargetFilter = e.target.value;
    appState.optoolPage = 1;
    updateOptoolRowsInPlace(container);
  });

  container.querySelector('#optool-col-mode')?.addEventListener('change', (e) => {
    appState.optoolColMode = e.target.value;
    appState.optoolColPage = 1;
    renderActiveView();
  });

  // Searchable dropdown filter triggers on every table header column
  const thead = container.querySelector('#optool-thead');
  thead?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-col-dropdown]');
    if (!btn) return;
    openColFilterPopover(btn, btn.dataset.colDropdown, container);
  });

  container.querySelector('#btn-clear-col-filters')?.addEventListener('click', () => {
    appState.optoolColFilters = {};
    appState.optoolSearch = '';
    appState.optoolTargetFilter = 'ALL';
    appState.optoolPage = 1;
    renderActiveView();
  });

  bindOptoolPagerEvents(container);

  container.querySelector('#btn-optool-add')?.addEventListener('click', () => {
    openOptoolModal(appState.activeOptoolTab, null, null);
  });

  container.querySelector('#optool-csv-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const csvText = await file.text();
      const res = await api('/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvText,
          targetTab: appState.activeOptoolTab,
          filename: file.name
        })
      });
      appState.state.optool = res.optool;
      appState.state.syncLogs = res.syncLogs;
      await refreshAnalytics();
      toast(`Imported ${res.importedRows} row(s) into ${appState.activeOptoolTab}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  const tbody = container.querySelector('#optool-tbody');
  tbody?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-optool]');
    if (editBtn) {
      const idx = Number(editBtn.dataset.editOptool);
      const row = appState.state.optool[appState.activeOptoolTab][idx];
      if (row) openOptoolModal(appState.activeOptoolTab, row, idx);
      return;
    }

    const delBtn = e.target.closest('[data-del-optool]');
    if (delBtn) {
      const idx = Number(delBtn.dataset.delOptool);
      if (!confirm(`Delete row #${idx + 1} from ${appState.activeOptoolTab}?`)) return;
      try {
        const res = await api(
          `/api/optool/${encodeURIComponent(appState.activeOptoolTab)}/${idx}`,
          { method: 'DELETE' }
        );
        appState.state.optool[appState.activeOptoolTab] = res.rows;
        await refreshAnalytics();
        toast(`Deleted row from ${appState.activeOptoolTab}`);
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  tbody?.addEventListener('change', async (e) => {
    const checkEl = e.target.closest('[data-optool-check-idx]');
    if (checkEl) {
      const idx = Number(checkEl.dataset.optoolCheckIdx);
      const colKey = checkEl.dataset.optoolCheckKey;
      const tabName = appState.activeOptoolTab;
      const prevVal = appState.state.optool[tabName]?.[idx]?.[colKey] ?? '';
      const nextChecked = checkEl.checked;
      checkEl.disabled = true;
      const label = await commitOptoolInlineField(container, {
        tabName,
        idx,
        colKey,
        nextVal: nextChecked ? 'Yes' : '',
        onRollback: () => {
          checkEl.checked = isChecklistChecked(prevVal);
        }
      });
      checkEl.disabled = false;
      if (label) {
        checkEl.title = `${label}: ${nextChecked ? 'Checked' : 'Unchecked'}`;
        toast(`${label}: ${nextChecked ? 'Checked' : 'Unchecked'}`);
      }
      return;
    }

    const selectEl = e.target.closest('[data-optool-select-idx]');
    if (selectEl) {
      const idx = Number(selectEl.dataset.optoolSelectIdx);
      const colKey = selectEl.dataset.optoolSelectKey;
      const tabName = appState.activeOptoolTab;
      const prevVal = appState.state.optool[tabName]?.[idx]?.[colKey] ?? '';
      const nextVal = selectEl.value;
      selectEl.classList.toggle('has-value', Boolean(nextVal));
      selectEl.disabled = true;
      const label = await commitOptoolInlineField(container, {
        tabName,
        idx,
        colKey,
        nextVal,
        onRollback: () => {
          selectEl.value = prevVal;
          selectEl.classList.toggle('has-value', Boolean(prevVal));
        }
      });
      selectEl.disabled = false;
      if (label) {
        toast(`${label}: ${nextVal || '(Cleared)'}`);
      }
      return;
    }

    const targetSel = e.target.closest('[data-milestone-target]');
    if (!targetSel) return;
    const idx = Number(targetSel.dataset.milestoneTarget);
    const milestoneTarget = targetSel.value;
    const scrollY = window.scrollY;
    const tableWrap = document.getElementById('optool-table-wrap');
    const wrapScrollTop = tableWrap ? tableWrap.scrollTop : 0;
    const wrapScrollLeft = tableWrap ? tableWrap.scrollLeft : 0;
    targetSel.disabled = true;
    try {
      const res = await api('/api/optool/Database/milestone-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: idx, milestoneTarget })
      });
      appState.state.optool = res.optool;
      appState.analytics = res.analytics;
      renderActiveView();
      window.scrollTo(0, scrollY);
      const nextWrap = document.getElementById('optool-table-wrap');
      if (nextWrap) {
        nextWrap.scrollTop = wrapScrollTop;
        nextWrap.scrollLeft = wrapScrollLeft;
      }
      if (milestoneTarget) {
        toast(
          (res.createdInTab
            ? `Milestone Target set to ${milestoneTarget} (added to ${milestoneTarget} tab)`
            : `Milestone Target set to ${milestoneTarget}`) + formatGasPushSuffix(res)
        );
      } else {
        toast(`Cleared Milestone Target for ${res.row.lhid || `row #${idx + 1}`}${formatGasPushSuffix(res)}`);
      }
    } catch (err) {
      targetSel.disabled = false;
      toast(err.message, true);
    }
  });
}

function bindSyncViewEvents(container) {
  container.querySelector('#btn-sync-probe')?.addEventListener('click', () => syncRegionalHub('probe'));
  container.querySelector('#btn-sync-pull-hub')?.addEventListener('click', () => syncRegionalHub('merge'));
  container.querySelector('#btn-sync-all-nodes')?.addEventListener('click', () => syncAllNodes('merge'));

  container.querySelectorAll('[data-sync-node]').forEach((btn) => {
    btn.addEventListener('click', () =>
      syncGoogleSheetNode(btn.dataset.syncNode, btn.dataset.syncLabel, 'merge')
    );
  });

  container.querySelector('#xlsx-file-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mode = document.getElementById('xlsx-import-mode')?.value || 'merge';
    try {
      const buf = await file.arrayBuffer();
      const res = await api(`/api/import/xlsx?mode=${encodeURIComponent(mode)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': file.name
        },
        body: buf
      });
      appState.state.dataSourceMode = res.dataSourceMode;
      appState.state.milestoneData = res.milestoneData;
      appState.state.optool = res.optool;
      appState.state.syncLogs = res.syncLogs;
      await refreshAnalytics();
      toast(`Imported ${res.importedRows} rows from ${file.name}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.querySelector('#btn-reset-sample')?.addEventListener('click', resetSampleWorkspace);
  container.querySelector('#btn-clear-workspace')?.addEventListener('click', clearToEmptyWorkspace);

  container.querySelector('#btn-save-gas-url')?.addEventListener('click', async () => {
    const gasWebAppUrl = document.getElementById('gas-url-input').value.trim();
    try {
      const res = await api('/api/sync/gas-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gasWebAppUrl, action: 'save' })
      });
      appState.state.gasWebAppUrl = res.gasWebAppUrl;
      appState.state.syncLogs = res.syncLogs;
      renderActiveView();
      toast('Saved GAS Web App URL');
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.querySelector('#btn-pull-gas-url')?.addEventListener('click', async () => {
    const gasWebAppUrl = document.getElementById('gas-url-input').value.trim();
    if (!gasWebAppUrl) return toast('Enter a deployed GAS Web App URL first', true);
    try {
      const res = await api('/api/sync/gas-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gasWebAppUrl, action: 'pull' })
      });
      appState.state.gasWebAppUrl = res.gasWebAppUrl;
      appState.state.dataSourceMode = 'live';
      appState.state.milestoneData = res.milestoneData;
      appState.state.optool = res.optool;
      appState.state.syncLogs = res.syncLogs;
      await refreshAnalytics();
      toast(`Pulled ${res.importedRows} records via GAS Web App`);
    } catch (err) {
      toast(err.message, true);
      renderActiveView();
    }
  });

  container.querySelector('#btn-copy-gas')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(appState.gasScript || '');
      toast('Copied gas/Code.gs to clipboard');
    } catch {
      toast('Clipboard permission unavailable — select and copy from the code panel.', true);
    }
  });

  container.querySelector('#btn-copy-gas-html')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(appState.gasHtml || '');
      toast('Copied gas/Index.html to clipboard');
    } catch {
      toast('Clipboard permission unavailable — select and copy from the code panel.', true);
    }
  });
}

function isUserActivelyEditing() {
  const modalOpen = !document.getElementById('modal-backdrop')?.classList.contains('hidden');
  const activeInTable = Boolean(document.activeElement?.closest('[data-optool-table]'));
  return modalOpen || activeInTable;
}

async function syncAllNodes(mode = 'merge', options = {}) {
  const { quiet = false } = options;
  if (isAutoSyncRunning) return;
  isAutoSyncRunning = true;
  if (!quiet) {
    toast('Checking & syncing Regional Hub + all 6 provincial Google Sheets…');
  }
  try {
    const res = await api('/api/sync/all-nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    appState.state = { ...appState.state, ...res.state };
    if (!quiet || !isUserActivelyEditing()) {
      await refreshAnalytics();
    }
    const synced = (res.results || []).filter((r) => r.status === 'synced').length;
    const restricted = (res.results || []).filter((r) => r.status === 'unauthorized').length;
    if (!quiet) {
      toast(`Checked 7 sheets: ${synced} reachable (${res.totalImported} rows imported), ${restricted} restricted (401).`);
    } else if (res.totalImported > 0) {
      toast(`Auto-synced ${res.totalImported} rows across ${synced}/7 Google Sheets`);
    }
  } catch (err) {
    if (!quiet) toast(err.message, true);
  } finally {
    isAutoSyncRunning = false;
  }
}

function maybeAutoSyncGoogleSheets() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const lastSyncMs = appState.state?.lastSyncAt ? Date.parse(appState.state.lastSyncAt) : 0;
  const isStale = !lastSyncMs || Number.isNaN(lastSyncMs) || Date.now() - lastSyncMs > AUTO_SYNC_MAX_AGE_MS;
  if (isStale) {
    syncAllNodes('merge', { quiet: true });
  }
}

function startAutoSyncLoop() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !isUserActivelyEditing()) {
      syncAllNodes('merge', { quiet: true });
    }
  }, AUTO_SYNC_INTERVAL_MS);
}

async function syncRegionalHub(mode = 'merge') {
  const hub = appState.schemas.registry[0];
  await syncGoogleSheetNode(hub.spreadsheetId, hub.jurisdiction, mode);
}

async function syncGoogleSheetNode(spreadsheetId, label, mode = 'merge') {
  toast(`Connecting to ${label}…`);
  try {
    const res = await api('/api/sync/google-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spreadsheetId, label, mode })
    });
    appState.state = { ...appState.state, ...res.state };
    await refreshAnalytics();
    if (res.importedRows > 0) {
      toast(`Synced ${res.importedRows} rows from ${label}`);
    } else {
      toast(`Connected to ${label} (${res.sheetNames.length} tabs verified; 0 populated rows in sheet)`);
    }
  } catch (err) {
    toast(err.message, true);
    const boot = await api('/api/bootstrap');
    appState.state = boot.state;
    renderActiveView();
  }
}

async function resetSampleWorkspace() {
  const res = await api('/api/workspace/reset-sample', { method: 'POST' });
  appState.state = res.state;
  appState.analytics = res.analytics;
  renderActiveView();
  toast('Restored Region VIII sample staging data');
}

async function clearToEmptyWorkspace() {
  if (!confirm('Clear sample staging records and keep an empty live workspace?')) return;
  const res = await api('/api/workspace/clear', { method: 'POST' });
  appState.state = res.state;
  appState.analytics = res.analytics;
  renderActiveView();
  toast('Cleared workspace to empty live mode');
}

async function refreshAnalytics() {
  const params = new URLSearchParams(appState.filters);
  appState.analytics = await api(`/api/analytics?${params.toString()}`);
  renderActiveView();
}

function exportMilestoneCsv() {
  const cols = appState.schemas.milestoneColumns;
  const header = cols.map((c) => `"${c.header}"`).join(',');
  const lines = appState.state.milestoneData.map((r) =>
    cols
      .map((c) => {
        const val = c.key === 'Area_HAS' ? fmtArea(r[c.key]) : r[c.key] ?? '';
        return `"${String(val).replace(/"/g, '""')}"`;
      })
      .join(',')
  );
  const blob = new Blob([[header, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Region8_Milestone_Data_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// Modals
function showModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  const bodyEl = document.getElementById('modal-body');
  bodyEl.innerHTML = bodyHtml;
  bodyEl.classList.toggle('has-modal-form', Boolean(bodyEl.querySelector(':scope > .modal-form')));
  document.getElementById('modal-backdrop').classList.remove('hidden');
}

function showFormModal(title, { formId, contentHtml, cancelId, submitLabel }) {
  showModal(
    title,
    `
      <form id="${esc(formId)}" class="modal-form">
        <div class="modal-scroll">${contentHtml}</div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="${esc(cancelId)}">Cancel</button>
          <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
        </div>
      </form>
    `
  );
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
}

async function openMilestoneModal(existing) {
  const isEdit = Boolean(existing);
  const defaultProv =
    existing?.Province_Code ||
    (appState.filters.province !== 'ALL' ? appState.filters.province : 'LEY');
  const defaultDate = existing?.Milestone_Date || new Date().toISOString().slice(0, 10);

  let initialRecordId = existing?.Record_ID || '';
  if (!initialRecordId) {
    const next = await api(
      `/api/milestones/next-id?provinceCode=${encodeURIComponent(defaultProv)}&milestoneDate=${encodeURIComponent(defaultDate)}`
    );
    initialRecordId = next.recordId;
  }

  const provNodes = appState.schemas.registry.filter((r) => r.role === 'Provincial Node');

  showFormModal(isEdit ? `Edit Milestone ${existing.Record_ID}` : 'New Milestone_Data Transaction', {
    formId: 'ms-form',
    cancelId: 'ms-cancel',
    submitLabel: isEdit ? 'Update Record' : 'Save Milestone Record',
    contentHtml: `
        <div class="form-grid">
          <div class="form-field">
            <label for="f-prov">Province Node</label>
            <select id="f-prov" class="form-control">
              ${provNodes
                .map(
                  (p) =>
                    `<option value="${esc(p.code)}" ${p.code === defaultProv ? 'selected' : ''}>${esc(
                      p.jurisdiction
                    )} (${esc(p.code)})</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="f-recid">Record_ID (Auto Index PROV-YYYYMM-XXXX)</label>
            <input id="f-recid" class="form-control mono" required value="${esc(initialRecordId)}" ${
      isEdit ? 'readonly' : ''
    } />
          </div>
          <div class="form-field">
            <label for="f-muni">Municipality (LGU Master List)</label>
            <select id="f-muni" class="form-control" required></select>
          </div>
          <div class="form-field">
            <label for="f-date">Milestone_Date (YYYY-MM-DD)</label>
            <input id="f-date" type="date" class="form-control" required value="${esc(defaultDate)}" />
          </div>
          <div class="form-field">
            <label for="f-laid">Land_Allocation_ID (SPLIT Official ID)</label>
            <input id="f-laid" class="form-control mono" required placeholder="LA-08-37-0012" value="${esc(
              existing?.Land_Allocation_ID || ''
            )}" />
          </div>
          <div class="form-field">
            <label for="f-etitle">eTitle_No (Generated eTitle)</label>
            <input id="f-etitle" class="form-control mono" required placeholder="eT-2026-00891" value="${esc(
              existing?.eTitle_No || ''
            )}" />
          </div>
          <div class="form-field">
            <label for="f-area">Area_HAS (4 Decimal Places)</label>
            <input id="f-area" type="number" step="0.0001" min="0" class="form-control mono" required placeholder="2.4500" value="${esc(
              existing?.Area_HAS || ''
            )}" />
          </div>
          <div class="form-field">
            <label for="f-stage">Milestone_Stage</label>
            <select id="f-stage" class="form-control" required>
              ${appState.schemas.milestoneStages
                .map(
                  (s) =>
                    `<option value="${esc(s)}" ${
                      (existing?.Milestone_Stage || 'eTitle Registered') === s ? 'selected' : ''
                    }>${esc(s)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="f-batch">Batch_Category</label>
            <select id="f-batch" class="form-control" required>
              ${appState.schemas.batchCategories
                .map(
                  (b) =>
                    `<option value="${esc(b)}" ${
                      (existing?.Batch_Category || 'ADMIN BATCH 1') === b ? 'selected' : ''
                    }>${esc(b)}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="f-lhid">Linked OPTool LHID (Optional)</label>
            <input id="f-lhid" class="form-control mono" placeholder="LH-0837-0012" value="${esc(
              existing?.LHID || ''
            )}" />
          </div>
          ${
            appState.state.gasWebAppUrl
              ? `
            <div class="form-field full">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="f-push-gas" checked />
                <span>Also push live to Regional Google Sheet via GAS Web App</span>
              </label>
            </div>
          `
              : ''
          }
        </div>
      `
  });

  const provEl = document.getElementById('f-prov');
  const muniEl = document.getElementById('f-muni');
  const dateEl = document.getElementById('f-date');
  const recIdEl = document.getElementById('f-recid');

  const fillMunis = (provCode, selectedMuni) => {
    const list = appState.schemas.lguMasterList[provCode] || [];
    muniEl.innerHTML = list
      .map((m) => `<option value="${esc(m)}" ${m === selectedMuni ? 'selected' : ''}>${esc(m)}</option>`)
      .join('');
  };

  fillMunis(defaultProv, existing?.Municipality || '');

  const refreshNextId = async () => {
    if (isEdit) return;
    const next = await api(
      `/api/milestones/next-id?provinceCode=${encodeURIComponent(provEl.value)}&milestoneDate=${encodeURIComponent(dateEl.value)}`
    );
    recIdEl.value = next.recordId;
  };

  provEl.addEventListener('change', () => {
    fillMunis(provEl.value, '');
    refreshNextId();
  });
  dateEl.addEventListener('change', refreshNextId);
  document.getElementById('ms-cancel').addEventListener('click', closeModal);

  document.getElementById('ms-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = {
        Record_ID: recIdEl.value.trim(),
        Province_Code: provEl.value,
        Municipality: muniEl.value,
        Land_Allocation_ID: document.getElementById('f-laid').value.trim(),
        eTitle_No: document.getElementById('f-etitle').value.trim(),
        Area_HAS: document.getElementById('f-area').value,
        Milestone_Stage: document.getElementById('f-stage').value,
        Milestone_Date: dateEl.value,
        Batch_Category: document.getElementById('f-batch').value,
        LHID: document.getElementById('f-lhid').value.trim(),
        pushToGas: Boolean(document.getElementById('f-push-gas')?.checked)
      };
      const res = await api('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      appState.state.milestoneData = res.milestoneData;
      closeModal();
      await refreshAnalytics();
      toast(`Saved ${res.record.Record_ID}${formatGasPushSuffix(res)}`);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function findDatabaseRowByLhid(lhid) {
  const key = String(lhid ?? '').trim().toLowerCase();
  if (!key) return null;
  const dbRows = appState.state?.optool?.Database || [];
  return dbRows.find((r) => String(r.lhid ?? '').trim().toLowerCase() === key) || null;
}

/**
 * Sync Survey Current Status and Current Date from workflow stage date inputs
 * until the user manually overrides either field.
 */
function attachSurveyCurrentStatusListeners(formEl, existingRow, derivedSurveyStatus) {
  const statusEl = formEl?.querySelector('#opt-currentStatus');
  const dateEl = formEl?.querySelector('#opt-currentDate');
  if (!statusEl || !dateEl) return;

  const initialStatus = String(existingRow?.currentStatus ?? '').trim();
  const initialDate = String(existingRow?.currentDate ?? '').trim();
  let statusManual = Boolean(initialStatus && initialStatus !== (derivedSurveyStatus?.currentStatus || ''));
  let dateManual = Boolean(initialDate && initialDate !== (derivedSurveyStatus?.currentDate || ''));

  const onStatusEdit = () => {
    statusManual = statusEl.value.trim() !== '';
  };
  const onDateEdit = () => {
    dateManual = dateEl.value.trim() !== '';
  };
  for (const evt of ['input', 'change']) {
    statusEl.addEventListener(evt, onStatusEdit);
    dateEl.addEventListener(evt, onDateEdit);
  }

  const syncFromStages = () => {
    const stageValues = {};
    for (const stage of SURVEY_STATUS_STAGES) {
      const stageInput = formEl.querySelector(`#opt-${stage.key}`);
      if (stageInput) stageValues[stage.key] = stageInput.value;
    }
    const next = resolveSurveyCurrentStatus(stageValues);
    if (!statusManual) statusEl.value = next.currentStatus;
    if (!dateManual) dateEl.value = next.currentDate;
  };

  for (const stage of SURVEY_STATUS_STAGES) {
    const stageInput = formEl.querySelector(`#opt-${stage.key}`);
    if (!stageInput) continue;
    stageInput.addEventListener('input', syncFromStages);
    stageInput.addEventListener('change', syncFromStages);
  }
}

/**
 * Auto-sum Total Number of ARB from Male and Female counts in RegistrationDistribution
 * until the user manually overrides the total field.
 */
function attachRegistrationArbCountListeners(formEl, existingRow) {
  const totalEl = formEl?.querySelector('#opt-noOfArbs');
  const maleEl = formEl?.querySelector('#opt-maleArbs');
  const femaleEl = formEl?.querySelector('#opt-femaleArbs');
  if (!totalEl || !maleEl || !femaleEl) return;

  const initialTotal = String(existingRow?.noOfArbs ?? '').trim();
  const derivedInitial = resolveTotalArbsFromGenderCounts(existingRow?.maleArbs, existingRow?.femaleArbs);
  let totalManual = Boolean(initialTotal && initialTotal !== derivedInitial);

  const onTotalEdit = () => {
    totalManual = totalEl.value.trim() !== '';
  };
  for (const evt of ['input', 'change']) {
    totalEl.addEventListener(evt, onTotalEdit);
  }

  const syncTotal = () => {
    if (totalManual) return;
    totalEl.value = resolveTotalArbsFromGenderCounts(maleEl.value, femaleEl.value);
  };

  for (const el of [maleEl, femaleEl]) {
    el.addEventListener('input', syncTotal);
    el.addEventListener('change', syncTotal);
  }
}

function openOptoolModal(tabName, existingRow, rowIndex) {
  const schemaCols = appState.schemas.optoolTabs[tabName] || [];
  const isEdit = existingRow !== null;
  const supportsAutoTarget = ['CF(DOC)', 'Survey', 'MOV', 'RegistrationDistribution', 'Installation'].includes(tabName);
  const supportsAutoReportedMonth = ['CF(DOC)', 'Survey', 'MOV', 'RegistrationDistribution', 'Installation'].includes(tabName);
  const hasExplicitTarget = String(existingRow?.target ?? '').trim() !== '';
  const derivedSurveyStatus = tabName === 'Survey' ? resolveSurveyCurrentStatus(existingRow) : null;
  const initialDbRow = existingRow?.lhid ? findDatabaseRowByLhid(existingRow.lhid) : null;
  const checkboxCols = schemaCols.filter((c) => c.type === 'checkbox');
  const initialCheckedCount = checkboxCols.filter((c) => isChecklistChecked(existingRow?.[c.key])).length;

  const checklistActionsHtml = `
    <span class="checklist-bulk-actions">
      <button type="button" class="link-btn" data-checklist-bulk="all">Check All</button>
      <span aria-hidden="true">•</span>
      <button type="button" class="link-btn" data-checklist-bulk="none">Clear All</button>
    </span>
  `;

  // Group fields cleanly by section name (combining CF(DOC) checklists into Document Checklist; keeping Survey checklists inside DARRO)
  let lastGroup = '';
  let emittedChecklistBar = false;
  const fieldsHtml = schemaCols
    .map((c) => {
      const isCfChecklistOnly = tabName === 'CF(DOC)' && c.type === 'checkbox';
      const effectiveGroup = isCfChecklistOnly ? 'Document Checklist' : c.group;
      let groupHtml = '';
      if (effectiveGroup && effectiveGroup !== lastGroup) {
        lastGroup = effectiveGroup;
        if (isCfChecklistOnly) {
          emittedChecklistBar = true;
          groupHtml = `
            <div class="form-section-title form-section-checklist">
              <span>${esc(effectiveGroup)} (<span id="opt-checklist-counter">${initialCheckedCount}</span> / ${checkboxCols.length} Checked)</span>
              ${checklistActionsHtml}
            </div>
          `;
        } else {
          groupHtml = `<div class="form-section-title ${getGroupVariantClass(effectiveGroup)}">${esc(effectiveGroup)}</div>`;
        }
      }
      if (c.type === 'checkbox' && !emittedChecklistBar) {
        emittedChecklistBar = true;
        groupHtml += `
          <div class="checklist-inline-bar">
            <span>Checklist (<span id="opt-checklist-counter">${initialCheckedCount}</span> / ${checkboxCols.length} Checked)</span>
            ${checklistActionsHtml}
          </div>
        `;
      }
      let val = existingRow?.[c.key] ?? '';
      if (supportsAutoReportedMonth && isReportedMonthKey(c.key) && String(val).trim() === '') {
        val = formatCurrentMonthYear();
      }
      if (supportsAutoTarget && c.key === 'target' && !hasExplicitTarget) {
        val = resolveTargetFromDatabaseRow(initialDbRow);
      }
      if (tabName === 'RegistrationDistribution' && c.key === 'noOfArbs' && String(val).trim() === '') {
        val = resolveTotalArbsFromGenderCounts(existingRow?.maleArbs, existingRow?.femaleArbs);
      }
      if (derivedSurveyStatus) {
        if (c.key === 'currentStatus' && String(val).trim() === '' && derivedSurveyStatus.currentStatus) {
          val = derivedSurveyStatus.currentStatus;
        }
        if (c.key === 'currentDate' && String(val).trim() === '' && derivedSurveyStatus.currentDate) {
          val = derivedSurveyStatus.currentDate;
        }
      }
      let linkedAfterLhid = '';
      if (tabName !== 'Database' && c.key === 'lhid') {
        lastGroup = '__AFTER_LINKED_DB__';
        linkedAfterLhid = `
          <div class="form-section-title">Database Parcel Details (Linked by LHID)</div>
          ${LINKED_DB_PROFILE_FIELDS.map(
            (f) => `
            <div class="form-field">
              <label for="opt-db-${esc(f.key)}">${esc(f.label)}</label>
              <input
                id="opt-db-${esc(f.key)}"
                type="text"
                readonly
                class="form-control form-control-readonly"
                data-linked-db-field="${esc(f.key)}"
                value=""
                placeholder="—"
              />
            </div>
          `
          ).join('')}
        `;
      }
      if (c.type === 'checkbox') {
        const checked = isChecklistChecked(val);
        return `
          ${groupHtml}
          <label class="checklist-field ${checked ? 'is-checked' : ''}" for="opt-${esc(c.key)}">
            <input id="opt-${esc(c.key)}" name="${esc(c.key)}" type="checkbox" class="checklist-input" ${
              checked ? 'checked' : ''
            } />
            <span class="checklist-label">${esc(c.label)}</span>
          </label>${linkedAfterLhid}
        `;
      }
      const fieldClass = c.fullWidth ? 'form-field full' : 'form-field';
      if (c.type === 'select' && Array.isArray(c.options)) {
        const opts = isReportedMonthKey(c.key) ? getReportedMonthOptions() : [...c.options];
        if (val && !opts.includes(val)) opts.push(val);
        return `
          ${groupHtml}
          <div class="${fieldClass}">
            <label for="opt-${esc(c.key)}">${esc(c.label)}</label>
            <select id="opt-${esc(c.key)}" name="${esc(c.key)}" class="form-control">
              <option value="">-- Select --</option>
              ${opts
                .map((opt) => `<option value="${esc(opt)}" ${val === opt ? 'selected' : ''}>${esc(opt)}</option>`)
                .join('')}
            </select>
          </div>${linkedAfterLhid}
        `;
      }
      const inputType = c.type === 'decimal' ? 'number' : c.type === 'date' ? 'date' : 'text';
      const extraAttr = c.type === 'decimal' ? 'step="0.0001"' : '';
      return `
        ${groupHtml}
        <div class="${fieldClass}">
          <label for="opt-${esc(c.key)}">${esc(c.label)}</label>
          <input id="opt-${esc(c.key)}" name="${esc(c.key)}" type="${inputType}" ${extraAttr} class="form-control" value="${esc(
        val
      )}" />
        </div>${linkedAfterLhid}
      `;
    })
    .join('');

  showFormModal(`${isEdit ? 'Edit' : 'Add'} ${tabName} Row`, {
    formId: 'optool-form',
    cancelId: 'opt-cancel',
    submitLabel: isEdit ? 'Save Changes' : 'Add Row',
    contentHtml: `<div class="form-grid">${fieldsHtml}</div>`
  });

  if (tabName !== 'Database') {
    const targetSelectEl = supportsAutoTarget ? document.getElementById('opt-target') : null;
    let targetManuallyEdited = hasExplicitTarget;
    targetSelectEl?.addEventListener('change', () => {
      targetManuallyEdited = true;
    });

    const populateLinkedDbFields = (lhidVal) => {
      const dbRow = findDatabaseRowByLhid(lhidVal);
      for (const f of LINKED_DB_PROFILE_FIELDS) {
        const el = document.getElementById(`opt-db-${f.key}`);
        if (!el) continue;
        const rawVal = dbRow?.[f.key] ?? '';
        el.value = rawVal === '' ? '' : f.isArea ? fmtArea(rawVal) : String(rawVal);
      }
      if (targetSelectEl && !targetManuallyEdited) {
        targetSelectEl.value = resolveTargetFromDatabaseRow(dbRow);
      }
    };
    populateLinkedDbFields(existingRow?.lhid ?? '');
    document.getElementById('opt-lhid')?.addEventListener('input', (e) => {
      populateLinkedDbFields(e.target.value);
    });
  }

  const formEl = document.getElementById('optool-form');
  if (tabName === 'Survey') {
    attachSurveyCurrentStatusListeners(formEl, existingRow, derivedSurveyStatus);
  }
  if (tabName === 'RegistrationDistribution') {
    attachRegistrationArbCountListeners(formEl, existingRow);
  }
  if (checkboxCols.length > 0) {
    const syncChecklistUi = () => {
      let count = 0;
      formEl.querySelectorAll('.checklist-input').forEach((input) => {
        input.closest('.checklist-field')?.classList.toggle('is-checked', input.checked);
        if (input.checked) count++;
      });
      const counterEl = document.getElementById('opt-checklist-counter');
      if (counterEl) counterEl.textContent = String(count);
    };
    formEl.addEventListener('change', (e) => {
      if (e.target.classList?.contains('checklist-input')) syncChecklistUi();
    });
    formEl.querySelectorAll('[data-checklist-bulk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.checklistBulk === 'all';
        formEl.querySelectorAll('.checklist-input').forEach((input) => {
          input.checked = next;
        });
        syncChecklistUi();
      });
    });
  }

  document.getElementById('opt-cancel').addEventListener('click', closeModal);
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const row = {};
    for (const c of schemaCols) {
      if (c.type === 'checkbox') {
        const checkInput = document.getElementById(`opt-${c.key}`);
        row[c.key] = checkInput && checkInput.checked ? 'Yes' : '';
      } else {
        row[c.key] = formData.get(c.key) ?? '';
      }
    }
    try {
      const res = await api(`/api/optool/${encodeURIComponent(tabName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row, index: rowIndex })
      });
      if (res.optool) {
        appState.state.optool = res.optool;
      } else {
        appState.state.optool[tabName] = res.rows;
      }
      closeModal();
      await refreshAnalytics();
      toast(`Saved row in ${tabName}${formatGasPushSuffix(res)}`);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openBaselinesModal() {
  const provNodes = appState.schemas.registry.filter((r) => r.role === 'Provincial Node');
  const baselines = appState.state.baselines;

  showFormModal('Region VIII Cumulative Baseline Targets', {
    formId: 'baselines-form',
    cancelId: 'base-cancel',
    submitLabel: 'Save Baseline Targets',
    contentHtml: `
        <p style="margin-top:0;color:var(--text-muted);font-size:13px">
          Configure cumulative baseline targets (eTitles &amp; Area in HAS) per provincial node for Regional Dashboard attainment calculations.
        </p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Province</th>
                <th>Target eTitles</th>
                <th>Target Area (HAS)</th>
              </tr>
            </thead>
            <tbody>
              ${provNodes
                .map((p) => {
                  const b = baselines[p.code] || { targetETitles: 0, targetAreaHas: 0 };
                  return `
                    <tr>
                      <td><strong>${esc(p.jurisdiction)}</strong> (${esc(p.code)})</td>
                      <td><input type="number" min="0" class="form-control num" name="t_${esc(p.code)}" value="${esc(
                    b.targetETitles
                  )}" /></td>
                      <td><input type="number" min="0" step="0.0001" class="form-control num" name="a_${esc(
                        p.code
                      )}" value="${esc(fmtArea(b.targetAreaHas))}" /></td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `
  });

  document.getElementById('base-cancel').addEventListener('click', closeModal);
  document.getElementById('baselines-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const p of provNodes) {
      payload[p.code] = {
        targetETitles: Number(fd.get(`t_${p.code}`)) || 0,
        targetAreaHas: Number(fd.get(`a_${p.code}`)) || 0
      };
    }
    try {
      const res = await api('/api/baselines', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      appState.state.baselines = res.baselines;
      closeModal();
      await refreshAnalytics();
      toast('Updated Region VIII cumulative baseline targets');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function openLandholdingDrawer(lhid) {
  document.getElementById('drawer-title').textContent = `LHID: ${lhid}`;
  document.getElementById('drawer-body').innerHTML = '<div class="loading-box">Loading cross-tab parcel dossier…</div>';
  document.getElementById('drawer-backdrop').classList.remove('hidden');

  try {
    const data = await api(`/api/landholding/${encodeURIComponent(lhid)}`);
    const blocks = [];

    if (data.milestones.length > 0) {
      blocks.push(`
        <div class="panel">
          <div class="panel-header"><h3 class="panel-title">Linked Milestone_Data (${data.milestones.length})</h3></div>
          <div class="panel-body">
            ${data.milestones
              .map(
                (m) => `
              <div style="padding:8px 0;border-bottom:1px solid var(--border)">
                <strong class="mono">${esc(m.Record_ID)}</strong> • ${esc(m.Milestone_Stage)} •
                <span class="mono">${esc(m.eTitle_No)}</span> • <strong>${fmtArea(m.Area_HAS)} HAS</strong> (${esc(
                  m.Milestone_Date
                )})
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `);
    }

    for (const [tabName, rows] of Object.entries(data.tabs)) {
      if (!rows || rows.length === 0) continue;
      const schema = appState.schemas.optoolTabs[tabName] || [];
      blocks.push(`
        <div class="panel">
          <div class="panel-header"><h3 class="panel-title">OPTool Tab: ${esc(tabName)} (${rows.length})</h3></div>
          <div class="panel-body">
            ${rows
              .map(
                (row) => `
              <div class="kv-grid">
                ${schema
                  .filter((c) => row[c.key] !== undefined && row[c.key] !== '')
                  .map(
                    (c) => `
                  <div class="kv-item">
                    <div class="kv-key">${esc(c.label)}</div>
                    <div class="kv-val">${esc(row[c.key])}</div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            `
              )
              .join('<hr style="margin:12px 0;border:0;border-top:1px solid var(--border)" />')}
          </div>
        </div>
      `);
    }

    document.getElementById('drawer-body').innerHTML =
      blocks.length > 0
        ? blocks.join('')
        : '<div class="loading-box">No linked OPTool or Milestone records found for this LHID yet.</div>';
  } catch (err) {
    document.getElementById('drawer-body').innerHTML = `<div class="loading-box">${esc(err.message)}</div>`;
  }
}

async function init() {
  try {
    const boot = await api('/api/bootstrap');
    appState.schemas = boot.schemas;
    appState.state = boot.state;
    appState.analytics = boot.analytics;
    appState.gasScript = boot.gasScript;
    appState.gasHtml = boot.gasHtml || '';

    renderActiveView();
    maybeAutoSyncGoogleSheets();
    startAutoSyncLoop();
  } catch (err) {
    document.getElementById('view-container').innerHTML = `<div class="loading-box">Failed to load hub: ${esc(
      err.message
    )}</div>`;
  }

  const isMobileSidebar = () => window.matchMedia('(max-width: 860px)').matches;
  const appShellEl = document.getElementById('app-shell');
  const sidebarEl = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('btn-sidebar-toggle');
  const toggleLabelEl = document.getElementById('sidebar-toggle-label');

  const syncSidebarToggleUi = () => {
    if (!toggleBtn || !appShellEl || !sidebarEl) return;
    if (isMobileSidebar()) {
      const isOpen = sidebarEl.classList.contains('open');
      const label = isOpen ? 'Hide Menu' : 'Menu';
      toggleBtn.setAttribute('aria-expanded', String(isOpen));
      toggleBtn.setAttribute('aria-label', label);
      toggleBtn.title = label;
      toggleBtn.classList.toggle('is-collapsed', !isOpen);
      if (toggleLabelEl) toggleLabelEl.textContent = label;
      return;
    }
    const isCollapsed = appShellEl.classList.contains('sidebar-collapsed');
    const label = isCollapsed ? 'Show Sidebar' : 'Hide Sidebar';
    toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.title = label;
    toggleBtn.classList.toggle('is-collapsed', isCollapsed);
    if (toggleLabelEl) toggleLabelEl.textContent = label;
  };

  try {
    if (localStorage.getItem('salig_sidebar_hidden') === '1') {
      appShellEl?.classList.add('sidebar-collapsed');
    }
  } catch {
    // Ignore storage access errors
  }
  syncSidebarToggleUi();

  // Navigation
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.view = btn.dataset.view;
      sidebarEl?.classList.remove('open');
      syncSidebarToggleUi();
      renderActiveView();
    });
  });

  toggleBtn?.addEventListener('click', () => {
    if (isMobileSidebar()) {
      sidebarEl?.classList.toggle('open');
    } else if (appShellEl) {
      const collapsed = appShellEl.classList.toggle('sidebar-collapsed');
      try {
        localStorage.setItem('salig_sidebar_hidden', collapsed ? '1' : '0');
      } catch {
        // Ignore storage access errors
      }
    }
    syncSidebarToggleUi();
  });

  window.addEventListener('resize', syncSidebarToggleUi);

  // Topbar & Sidebar global actions
  document.getElementById('btn-print-report')?.addEventListener('click', () => window.print());
  document.getElementById('btn-new-milestone')?.addEventListener('click', () => openMilestoneModal(null));
  document.getElementById('btn-edit-baselines')?.addEventListener('click', openBaselinesModal);
  document.getElementById('btn-sidebar-sync')?.addEventListener('click', () => syncRegionalHub('merge'));
  document.getElementById('btn-export-xlsx')?.addEventListener('click', () => {
    const params = new URLSearchParams(appState.filters);
    window.location.href = `/api/export/xlsx?${params.toString()}`;
  });

  // Modal & Drawer close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });

  document.getElementById('drawer-close').addEventListener('click', () => {
    document.getElementById('drawer-backdrop').classList.add('hidden');
  });
  document.getElementById('drawer-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'drawer-backdrop') {
      document.getElementById('drawer-backdrop').classList.add('hidden');
    }
  });
}

init();

