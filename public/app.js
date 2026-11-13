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
  renderSyncView,
  renderUsersView,
  renderNepView,
  renderTargetSummaryView,
  renderCfWhereaboutsView
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
  currentUser: null,
  provinceScope: null,
  usersList: [],
  pendingUserCount: 0,
  schemas: null,
  state: null,
  analytics: null,
  gasScript: '',
  gasHtml: '',
  activeOptoolTab: 'Database',
  monitoringLevel: 'both', // 'both' | 'etitles' | 'area'
  measurementLogic: 'both', // 'both' | 'incremental' | 'cumulative'
  nepMetricMode: 'both', // 'both' | 'count' | 'area'
  nepYearFilter: '2026', // 'ALL' | '2026' | '2025' | ...
  nepMilestoneFilter: 'overall', // 'overall' | 'cf_doc' | 'land_survey' | ...
  nepMilestoneTableFilter: 'ALL', // 'ALL' | 'cf_doc' | 'land_survey' | ...
  nepDisplayMode: 'table', // 'table' | 'cards'
  nepShowMonths: false,
  nepExpandedQuarters: {},
  nepExpandedTargetSems: false,
  nepShowProvinces: false,
  nepExpandedMilestones: {},
  filters: {
    province: 'ALL',
    periodMonth: 'LATEST',
    batch: 'ALL',
    milestoneYear: 'ALL'
  },
  msSearch: '',
  optoolSearch: '',
  optoolTargetFilter: 'ALL',
  optoolColFilters: {},
  optoolPage: 1,
  optoolPageSize: 50,
  optoolColMode: 'preview',
  optoolColPage: 1,
  cfSearch: '',
  cfProvinceFilter: 'ALL',
  cfDateStatusFilter: 'ALL',
  cfPage: 1
};

const AUTO_SYNC_MAX_AGE_MS = 2 * 60 * 1000;
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

let optoolSearchTimer = null;
let closeColPopoverFn = null;
let isAutoSyncRunning = false;
let autoSyncTimer = null;
let autoSyncStartTimer = null;
let autoSyncAbortController = null;

function stopAutoSync() {
  if (autoSyncStartTimer) {
    clearTimeout(autoSyncStartTimer);
    autoSyncStartTimer = null;
  }
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (autoSyncAbortController) {
    autoSyncAbortController.abort();
    autoSyncAbortController = null;
  }
}

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

let activeLoadingCount = 0;

/** Display the full-screen loading overlay for fetching or saving operations. */
function showLoadingOverlay(mode = 'fetching', title = 'Loading Data…', subtitle = 'Please wait…') {
  activeLoadingCount += 1;
  const overlay = document.getElementById('loading-overlay');
  const badge = document.getElementById('loading-badge');
  const titleEl = document.getElementById('loading-title');
  const subEl = document.getElementById('loading-subtitle');
  if (badge) {
    badge.textContent = mode === 'saving' ? 'SAVING DATA' : 'FETCHING DATA';
    badge.classList.toggle('saving', mode === 'saving');
  }
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle;
  overlay?.classList.remove('hidden');
}

/** Hide the full-screen loading overlay once all tracked async actions settle. */
function hideLoadingOverlay(force = false) {
  activeLoadingCount = force ? 0 : Math.max(0, activeLoadingCount - 1);
  if (activeLoadingCount === 0) {
    document.getElementById('loading-overlay')?.classList.add('hidden');
  }
}

/** Wrap an async operation in the dedicated fetching/saving loading overlay. */
async function withLoading(mode, title, subtitle, fn) {
  showLoadingOverlay(mode, title, subtitle);
  try {
    return await fn();
  } finally {
    hideLoadingOverlay();
  }
}

function setAuthFeedback(message = '', tone = 'info') {
  const el = document.getElementById('auth-feedback');
  if (!el) return;
  if (!message) {
    el.textContent = '';
    el.className = 'auth-feedback hidden';
    return;
  }
  el.textContent = message;
  el.className = `auth-feedback ${tone}`;
}

function switchAuthTab(tabName = 'login') {
  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.authTab === tabName);
  });
  document.getElementById('login-form')?.classList.toggle('hidden', tabName !== 'login');
  document.getElementById('signup-form')?.classList.toggle('hidden', tabName !== 'signup');
  const titleEl = document.getElementById('auth-form-title');
  const subEl = document.getElementById('auth-form-subtitle');
  if (titleEl && subEl) {
    if (tabName === 'signup') {
      titleEl.textContent = 'Create SALIG Account';
      subEl.textContent = 'Verify your email address via OTP before Administrator confirmation';
    } else {
      titleEl.textContent = 'Welcome Back';
      subEl.textContent = 'Sign in with your confirmed Region VIII account';
    }
  }
}

function showAuthScreen(message = '', tone = 'info', tab = 'login') {
  appState.currentUser = null;
  appState.provinceScope = null;
  appState.filters.province = 'ALL';
  document.getElementById('app-shell')?.classList.add('hidden');
  document.getElementById('auth-screen')?.classList.remove('hidden');
  switchAuthTab(tab);
  setAuthFeedback(message, tone);
}

function syncCurrentUserUi() {
  const user = appState.currentUser;
  const isAdmin = user?.role === 'admin';
  const navUsersBtn = document.getElementById('nav-user-approvals');
  const pendingPill = document.getElementById('nav-pending-users-count');
  const userCard = document.getElementById('sidebar-user-card');
  const userNameEl = document.getElementById('sidebar-user-name');
  const userMetaEl = document.getElementById('sidebar-user-meta');
  const logoutBtn = document.getElementById('btn-logout');
  const topbarAuthBar = document.getElementById('topbar-auth-bar');
  const topbarUserName = document.getElementById('topbar-user-name');
  const topbarUserRole = document.getElementById('topbar-user-role');

  navUsersBtn?.classList.toggle('hidden', !isAdmin);
  if (pendingPill) {
    pendingPill.textContent = String(appState.pendingUserCount || 0);
  }
  if (user) {
    userCard?.classList.remove('hidden');
    logoutBtn?.classList.remove('hidden');
    topbarAuthBar?.classList.remove('hidden');
    if (userNameEl) userNameEl.textContent = user.name || user.email;
    if (userMetaEl) {
      userMetaEl.textContent = `${user.role === 'admin' ? 'Admin' : 'User'} • ${user.province || 'Region VIII'}`;
    }
    if (topbarUserName) topbarUserName.textContent = user.name || user.email;
    if (topbarUserRole) {
      topbarUserRole.textContent = appState.provinceScope
        ? `${appState.provinceScope.provinceName} (${appState.provinceScope.code})`
        : user.role === 'admin'
        ? 'Admin'
        : 'Region VIII Hub';
    }
    const sidebarSyncBtn = document.getElementById('btn-sidebar-sync');
    if (sidebarSyncBtn) {
      sidebarSyncBtn.textContent = appState.provinceScope
        ? `Sync ${appState.provinceScope.provinceName} Sheet`
        : 'Sync Regional Sheet';
    }
  } else {
    userCard?.classList.add('hidden');
    logoutBtn?.classList.add('hidden');
    topbarAuthBar?.classList.add('hidden');
  }
}

function showAppShell() {
  document.getElementById('auth-screen')?.classList.add('hidden');
  document.getElementById('app-shell')?.classList.remove('hidden');
  syncCurrentUserUi();
}

async function api(path, options = {}) {
  const resp = await fetch(path, { credentials: 'same-origin', ...options });
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await resp.json();
    if (!resp.ok) {
      if (resp.status === 401 && !String(path).startsWith('/api/auth/')) {
        showAuthScreen('Your session has expired. Please sign in again.', 'info', 'login');
      }
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    return data;
  }
  if (!resp.ok) {
    if (resp.status === 401 && !String(path).startsWith('/api/auth/')) {
      showAuthScreen('Your session has expired. Please sign in again.', 'info', 'login');
    }
    throw new Error(`HTTP ${resp.status}`);
  }
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
        <span>Showing realistic ${
          appState.provinceScope
            ? `${esc(appState.provinceScope.provinceName)} (${esc(appState.provinceScope.code)})`
            : 'Region VIII'
        } baseline &amp; sample data. ${esc(liveInfo)}</span>
      </div>
      ${
        appState.provinceScope
          ? ''
          : `
      <div class="status-banner-actions">
        <button class="btn btn-secondary btn-sm" id="banner-sync-btn">Sync Live Sheet</button>
        <button class="btn btn-secondary btn-sm" id="banner-clear-btn">Use Empty Live Mode</button>
      </div>
      `
      }
    `;
  } else {
    banner.className = 'status-banner live';
    banner.innerHTML = `
      <div class="status-banner-left">
        <span class="badge badge-green">${esc(modeLabel.toUpperCase())}</span>
        <span>${esc(liveInfo)}</span>
      </div>
      ${
        appState.provinceScope
          ? ''
          : `
      <div class="status-banner-actions">
        <button class="btn btn-secondary btn-sm" id="banner-sync-btn">Refresh Live Sheet</button>
        <button class="btn btn-secondary btn-sm" id="banner-sample-btn">Load Sample Data</button>
      </div>
      `
      }
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
  const cfCountEl = document.getElementById('nav-cf-count');
  if (cfCountEl) cfCountEl.textContent = (appState.state.optool?.['CF(DOC)'] || []).length;
}

function updateHeaderTitles() {
  const scopeLabel = appState.provinceScope
    ? `${appState.provinceScope.provinceName} (${appState.provinceScope.code})`
    : 'Region VIII';
  const titles = {
    dashboard: [
      `${scopeLabel} ${appState.provinceScope ? 'Dashboard' : 'Consolidated Dashboard'}`,
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
      `${scopeLabel} Milestone_Data Ledger`,
      `Standardized ${scopeLabel} Schema • Auto-Index (PROV-YYYYMM-XXXX) • LGU Master List Validation`
    ],
    optool: [
      appState.provinceScope ? `SALIG — ${scopeLabel}` : 'SALIG',
      appState.provinceScope
        ? `Smart Analytics & Logical Information Generator • ${scopeLabel} Records Only`
        : 'Smart Analytics & Logical Information Generator'
    ],
    'target-summary': [
      `${scopeLabel} Target Summary`,
      'Physical Accomplishment per Milestone vs Regional NEP Targets & Quarterly Performance'
    ],
    'cf-whereabouts': [
      `${scopeLabel} CF Whereabouts & Date Summary`,
      'Claim Folder (CF) Tracking • Date FI Conducted • Date Prepared & Signed • Reported Month'
    ],
    nep: [
      'Regional Hub NEP Targets & Sheet',
      'Province allocations (LHS, AREA, ARBs, Year) and Regional Milestone Targets'
    ],
    sync: [
      appState.provinceScope ? `${scopeLabel} Google Sheet Sync` : 'Google Sheets Registry & GAS ETL Hub',
      appState.provinceScope
        ? `Assigned Provincial Node (${scopeLabel}) & Workbook Merge Import`
        : 'Central Hub + 6 Provincial Nodes • Automated Google Apps Script ETL Pipeline & Workbook Import/Export'
    ],
    users: [
      'Administrator Account Approvals',
      'Review and confirm Sign-Up accounts (Name, Email, Province, Contact Number)'
    ]
  };
  const [title, sub] = titles[appState.view] || titles.dashboard;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = sub;

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === appState.view);
  });
}

let activeFullscreenPanelId = null;

function toggleFullScreen(panel, btn) {
  if (!panel) return;
  const panelId = panel.id || (panel.id = 'panel-fs-' + Math.random().toString(36).slice(2, 8));
  const isFs = panel.classList.contains('is-fullscreen') || appState.activeFullscreenPanelId === panelId;

  if (!isFs) {
    appState.activeFullscreenPanelId = panelId;
    activeFullscreenPanelId = panelId;
    panel.classList.add('is-fullscreen');
    document.body.classList.add('has-fullscreen-panel');
    updateFsBtn(btn, true);
  } else {
    appState.activeFullscreenPanelId = null;
    activeFullscreenPanelId = null;
    panel.classList.remove('is-fullscreen');
    document.body.classList.remove('has-fullscreen-panel');
    updateFsBtn(btn, false);
  }
}

function updateFsBtn(btn, isFs) {
  if (!btn) return;
  const icon = btn.querySelector('.fs-icon');
  const label = btn.querySelector('.fs-label');
  if (isFs) {
    if (icon) icon.textContent = '⤢';
    if (label) label.textContent = 'Exit Full Screen';
    btn.title = 'Exit Full Screen (Esc)';
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-secondary');
  } else {
    if (icon) icon.textContent = '⛶';
    if (label) label.textContent = 'Full Screen';
    btn.title = 'Full Screen Report / Table';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
  }
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
    provinceScope: appState.provinceScope,
    currentUser: appState.currentUser,
    monitoringLevel: appState.monitoringLevel,
    measurementLogic: appState.measurementLogic,
    nepMetricMode: appState.nepMetricMode,
    nepShowMonths: Boolean(appState.nepShowMonths),
    nepExpandedQuarters: appState.nepExpandedQuarters || {},
    nepExpandedTargetSems: Boolean(appState.nepExpandedTargetSems),
    nepShowProvinces: Boolean(appState.nepShowProvinces),
    nepExpandedMilestones: appState.nepExpandedMilestones || {},
    nepYearFilter: appState.nepYearFilter,
    nepMilestoneFilter: appState.nepMilestoneFilter || 'overall',
    nepMilestoneTableFilter: appState.nepMilestoneTableFilter || 'ALL',
    nepDisplayMode: appState.nepDisplayMode || 'table',
    filters: appState.filters,
    activeOptoolTab: appState.activeOptoolTab
  };

  if (appState.view === 'dashboard') {
    container.innerHTML = renderDashboardView(ctx);
    bindDashboardViewEvents(container);
  } else if (appState.view === 'target-summary') {
    container.innerHTML = renderTargetSummaryView(ctx);
    bindDashboardViewEvents(container);
  } else if (appState.view === 'cf-whereabouts') {
    container.innerHTML = renderCfWhereaboutsView({
      ...ctx,
      cfSearch: appState.cfSearch || '',
      cfProvinceFilter: appState.cfProvinceFilter || 'ALL',
      cfDateStatusFilter: appState.cfDateStatusFilter || 'ALL',
      cfPage: appState.cfPage || 1
    });
    bindCfWhereaboutsEvents(container);
  } else if (appState.view === 'nep') {
    container.innerHTML = renderNepView(ctx);
    bindDashboardViewEvents(container);
  } else if (appState.view === 'milestones') {
    container.innerHTML = renderMilestonesView({ ...ctx, searchTerm: appState.msSearch });
    bindMilestonesViewEvents(container);
  } else if (appState.view === 'optool') {
    container.innerHTML = renderOptoolView({ ...ctx, ...getOptoolFilterContext() });
    bindOptoolViewEvents(container);
  } else if (appState.view === 'sync') {
    container.innerHTML = renderSyncView(ctx);
    bindSyncViewEvents(container);
  } else if (appState.view === 'users') {
    container.innerHTML = renderUsersView({
      users: appState.usersList,
      currentUser: appState.currentUser
    });
    bindUsersViewEvents(container);
  }

  // Restore fullscreen state if a panel was full screen before re-rendering
  const fsId = appState.activeFullscreenPanelId || activeFullscreenPanelId;
  if (fsId) {
    const existing = document.getElementById(fsId);
    if (existing) {
      existing.classList.add('is-fullscreen');
      document.body.classList.add('has-fullscreen-panel');
      const btn = existing.querySelector('.btn-fullscreen');
      if (btn) updateFsBtn(btn, true);
    }
  }

  container.querySelectorAll('.btn-fullscreen').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = btn.closest('.panel');
      if (panel) toggleFullScreen(panel, btn);
    });
  });

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
      const res = await withLoading(
        'saving',
        'Saving Imported CSV…',
        `Importing Milestone_Data rows from ${file.name}…`,
        async () => {
          const csvText = await file.text();
          return api('/api/import/csv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csvText, targetTab: 'Milestone_Data', filename: file.name })
          });
        }
      );
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
        const res = await withLoading(
          'saving',
          'Deleting Milestone Record…',
          `Removing ${id} & syncing Regional Google Sheet…`,
          () => api(`/api/milestones/${encodeURIComponent(id)}`, { method: 'DELETE' })
        );
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
    const res = await withLoading(
      'saving',
      'Saving Field Update…',
      `Updating ${tabName} row & syncing with Google Sheets…`,
      () =>
        api(`/api/optool/${encodeURIComponent(tabName)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row: updatedRow, index: idx })
        })
    );
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
      const res = await withLoading(
        'saving',
        `Saving ${appState.activeOptoolTab} CSV…`,
        `Importing rows from ${file.name}…`,
        async () => {
          const csvText = await file.text();
          return api('/api/import/csv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              csvText,
              targetTab: appState.activeOptoolTab,
              filename: file.name
            })
          });
        }
      );
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
        const res = await withLoading(
          'saving',
          'Deleting OPTool Record…',
          `Removing row from ${appState.activeOptoolTab} & syncing Google Sheet…`,
          () =>
            api(
              `/api/optool/${encodeURIComponent(appState.activeOptoolTab)}/${idx}`,
              { method: 'DELETE' }
            )
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
      const res = await withLoading(
        'saving',
        'Saving Milestone Target…',
        'Routing parcel & updating Regional Google Sheet…',
        () =>
          api('/api/optool/Database/milestone-target', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: idx, milestoneTarget })
          })
      );
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
      const res = await withLoading(
        'saving',
        'Saving Imported Workbook…',
        `Parsing and storing rows from ${file.name}…`,
        async () => {
          const buf = await file.arrayBuffer();
          return api(`/api/import/xlsx?mode=${encodeURIComponent(mode)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-Filename': file.name
            },
            body: buf
          });
        }
      );
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
      const res = await withLoading(
        'saving',
        'Saving GAS Web App URL…',
        'Updating live endpoint configuration…',
        () =>
          api('/api/sync/gas-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gasWebAppUrl, action: 'save' })
          })
      );
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
      const res = await withLoading(
        'fetching',
        'Fetching Snapshot via GAS…',
        'Pulling regional records from Google Apps Script endpoint…',
        () =>
          api('/api/sync/gas-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gasWebAppUrl, action: 'pull' })
          })
      );
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

  container.querySelector('#btn-sync-gas-headers')?.addEventListener('click', async () => {
    const gasWebAppUrl = document.getElementById('gas-url-input').value.trim();
    if (!gasWebAppUrl) return toast('Enter a deployed GAS Web App URL first', true);
    toast('Syncing updated SALIG column headers across Google Sheets…');
    try {
      const res = await withLoading(
        'saving',
        'Saving Sheet Column Headers…',
        'Updating schema columns across Google Sheets via GAS…',
        () =>
          api('/api/sync/gas-headers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gasWebAppUrl })
          })
      );
      appState.state.syncLogs = res.syncLogs;
      renderActiveView();
      const syncedCount = (res.results || []).filter((r) => r.status === 'synced').length;
      toast(`Synced SALIG column headers on ${syncedCount} Google Sheet(s)`);
    } catch (err) {
      toast(err.message, true);
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
    showLoadingOverlay(
      'fetching',
      'Fetching All 7 Google Sheets…',
      'Checking Regional Hub & 6 provincial nodes for updates…'
    );
    toast('Checking & syncing Regional Hub + all 6 provincial Google Sheets…');
  }
  try {
    let signal;
    if (quiet) {
      autoSyncAbortController = new AbortController();
      signal = autoSyncAbortController.signal;
    }
    const res = await api('/api/sync/all-nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
      signal
    });
    if (!appState.currentUser) return;
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
    if (!quiet && err?.name !== 'AbortError') toast(err.message, true);
  } finally {
    autoSyncAbortController = null;
    if (!quiet) hideLoadingOverlay();
    isAutoSyncRunning = false;
  }
}

function maybeAutoSyncGoogleSheets() {
  if (!appState.currentUser) return;
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
    const res = await withLoading(
      'fetching',
      'Fetching Google Sheet Data…',
      `Connecting to ${label} & loading records…`,
      () =>
        api('/api/sync/google-sheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spreadsheetId, label, mode })
        })
    );
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
  const res = await withLoading(
    'saving',
    'Loading Sample Workspace…',
    'Restoring Region VIII sample staging data…',
    () => api('/api/workspace/reset-sample', { method: 'POST' })
  );
  appState.state = res.state;
  appState.analytics = res.analytics;
  renderActiveView();
  toast('Restored Region VIII sample staging data');
}

async function clearToEmptyWorkspace() {
  if (!confirm('Clear sample staging records and keep an empty live workspace?')) return;
  const res = await withLoading(
    'saving',
    'Clearing Workspace…',
    'Switching workspace to empty live mode…',
    () => api('/api/workspace/clear', { method: 'POST' })
  );
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
        const val = c.key === 'Area_HAS' ? (Number(r[c.key]) || 0).toFixed(4) : r[c.key] ?? '';
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

function showFormModal(title, { formId, contentHtml, bodyHtml, cancelId, submitLabel }) {
  const modalContent = contentHtml !== undefined ? contentHtml : bodyHtml !== undefined ? bodyHtml : '';
  showModal(
    title,
    `
      <form id="${esc(formId)}" class="modal-form">
        <div class="modal-scroll">${modalContent}</div>
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
  const scopeCode = appState.provinceScope?.code || null;
  const defaultProv =
    scopeCode ||
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
            <select id="f-prov" class="form-control" ${scopeCode ? 'disabled' : ''}>
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
      const res = await withLoading(
        'saving',
        'Saving Milestone Record…',
        `Saving ${payload.Record_ID || 'milestone'} & syncing Google Sheet…`,
        () =>
          api('/api/milestones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
      );
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
      const lockedProvince = appState.provinceScope?.provinceName;
      if (lockedProvince && c.key === 'province') {
        return `
          ${groupHtml}
          <div class="${fieldClass}">
            <label for="opt-${esc(c.key)}">${esc(c.label)} (Scoped)</label>
            <input id="opt-${esc(c.key)}" name="${esc(c.key)}" type="text" readonly class="form-control form-control-readonly" value="${esc(
          lockedProvince
        )}" />
          </div>${linkedAfterLhid}
        `;
      }
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
      const res = await withLoading(
        'saving',
        `Saving ${tabName} Record…`,
        'Persisting parcel details & pushing update to Regional Google Sheet…',
        () =>
          api(`/api/optool/${encodeURIComponent(tabName)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ row, index: rowIndex })
          })
      );
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
                      )}" value="${esc((Number(b.targetAreaHas) || 0).toFixed(4))}" /></td>
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
      const res = await withLoading(
        'saving',
        'Saving Baseline Targets…',
        'Updating Region VIII cumulative baseline targets…',
        () =>
          api('/api/baselines', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
      );
      appState.state.baselines = res.baselines;
      closeModal();
      await refreshAnalytics();
      toast('Updated Region VIII cumulative baseline targets');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function bindDashboardViewEvents(container) {
  container.querySelectorAll('[data-nep-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.nepMetricMode = btn.dataset.nepMetric;
      renderActiveView();
    });
  });

  container.querySelector('#nep-province-filter')?.addEventListener('change', async (e) => {
    appState.filters.province = e.target.value;
    await refreshAnalytics();
  });

  container.querySelector('#nep-year-select')?.addEventListener('change', async (e) => {
    appState.filters.milestoneYear = e.target.value;
    await refreshAnalytics();
  });

  const handleMilestoneTableFilter = (val) => {
    appState.nepMilestoneTableFilter = val;
    renderActiveView();
  };
  container.querySelector('#nep-milestone-table-filter')?.addEventListener('change', (e) => {
    handleMilestoneTableFilter(e.target.value);
  });
  container.querySelector('#nep-th-milestone-filter')?.addEventListener('change', (e) => {
    handleMilestoneTableFilter(e.target.value);
  });
  container.querySelector('#nep-th-milestone-filter-m')?.addEventListener('change', (e) => {
    handleMilestoneTableFilter(e.target.value);
  });

  container.querySelector('#btn-toggle-nep-months')?.addEventListener('click', () => {
    const willShow = !appState.nepShowMonths;
    appState.nepShowMonths = willShow;
    appState.nepExpandedQuarters = { 1: willShow, 2: willShow, 3: willShow, 4: willShow };
    renderActiveView();
  });

  container.querySelector('#btn-toggle-nep-target-sems')?.addEventListener('click', () => {
    appState.nepExpandedTargetSems = !Boolean(appState.nepExpandedTargetSems);
    renderActiveView();
  });

  container.querySelectorAll('[data-toggle-target-sems]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      appState.nepExpandedTargetSems = !appState.nepExpandedTargetSems;
      renderActiveView();
    });
  });

  container.querySelector('#btn-toggle-nep-provinces')?.addEventListener('click', () => {
    appState.nepShowProvinces = !appState.nepShowProvinces;
    appState.nepExpandedMilestones = {};
    renderActiveView();
  });

  container.querySelectorAll('[data-toggle-prov-milestone]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.toggleProvMilestone;
      if (!appState.nepExpandedMilestones) appState.nepExpandedMilestones = {};
      const currentlyExpanded = appState.nepShowProvinces
        ? appState.nepExpandedMilestones[key] !== false
        : Boolean(appState.nepExpandedMilestones[key]);
      appState.nepExpandedMilestones[key] = !currentlyExpanded;
      renderActiveView();
    });
  });

  container.querySelectorAll('[data-toggle-q]').forEach((th) => {
    th.addEventListener('click', (e) => {
      e.stopPropagation();
      const q = Number(th.dataset.toggleQ);
      if (q >= 1 && q <= 4) {
        if (!appState.nepExpandedQuarters) {
          appState.nepExpandedQuarters = {
            1: Boolean(appState.nepShowMonths),
            2: Boolean(appState.nepShowMonths),
            3: Boolean(appState.nepShowMonths),
            4: Boolean(appState.nepShowMonths)
          };
        }
        appState.nepExpandedQuarters[q] = !appState.nepExpandedQuarters[q];
        const allExp = [1, 2, 3, 4].every((i) => Boolean(appState.nepExpandedQuarters[i]));
        appState.nepShowMonths = allExp;
        renderActiveView();
      }
    });
  });

  container.querySelectorAll('[data-open-optool-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.activeOptoolTab = btn.dataset.openOptoolTab;
      appState.optoolPage = 1;
      appState.optoolColPage = 1;
      appState.view = 'optool';
      renderActiveView();
    });
  });

  container.querySelector('#btn-edit-nep-targets')?.addEventListener('click', openNepTargetsModal);
  container.querySelector('#btn-sync-hub-nep')?.addEventListener('click', syncHubNepSheet);
  container.querySelector('#btn-edit-nep-sheet')?.addEventListener('click', (e) => {
    const ms = e.currentTarget?.dataset?.milestone || appState.nepMilestoneFilter || 'overall';
    openNepSheetModal(null, ms);
  });
  container.querySelector('#btn-card-edit-nep')?.addEventListener('click', (e) => {
    const ms = e.currentTarget?.dataset?.milestone || appState.nepMilestoneFilter || 'overall';
    openNepSheetModal(null, ms);
  });
  container.querySelectorAll('.btn-edit-single-nep').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ms = btn.dataset.milestone || appState.nepMilestoneFilter || 'overall';
      openNepSheetModal(btn.dataset.prov, ms);
    });
  });
  container.querySelector('#nep-milestone-filter')?.addEventListener('change', (e) => {
    appState.nepMilestoneFilter = e.target.value;
    renderActiveView();
  });
  container.querySelector('#nep-year-filter')?.addEventListener('change', (e) => {
    appState.nepYearFilter = e.target.value;
    renderActiveView();
  });
  container.querySelectorAll('[data-nep-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.nepDisplayMode = btn.dataset.nepMode;
      renderActiveView();
    });
  });
  container.querySelector('#btn-sync-nep-sheet')?.addEventListener('click', syncHubNepSheet);
}

async function syncHubNepSheet() {
  try {
    const res = await withLoading(
      'fetching',
      'Syncing Hub NEP Targets…',
      'Reading NEP target data (LHS, AREA, ARBs, Year) from Regional Hub Google Sheet…',
      () => api('/api/nep-sheet/sync', { method: 'POST' })
    );
    appState.state.nepProvinceList = res.nepProvinceList;
    if (res.nepMilestoneList) appState.state.nepMilestoneList = res.nepMilestoneList;
    if (res.nepTargets) appState.state.nepTargets = res.nepTargets;
    appState.analytics = res.analytics;
    renderActiveView();
    toast('Fetched Regional Hub NEP Targets');
  } catch (err) {
    toast(err.message, true);
  }
}

function openNepSheetModal(targetProv = null, initialMilestone = null) {
  const isAdmin = appState.currentUser ? appState.currentUser.role === 'admin' : !appState.provinceScope;
  if (!isAdmin) {
    toast('Only Administrator accounts can edit the Regional Hub NEP Sheet.', true);
    return;
  }
  const provNodes = (appState.schemas?.registry || []).filter((n) => n.role === 'Provincial Node');
  const milestoneOptions = appState.schemas?.nepMilestoneOptions || [
    { key: 'overall', label: 'Overall NEP (All Milestones)' },
    { key: 'cf_doc', label: 'CF Documentation' },
    { key: 'land_survey', label: 'Land Survey' },
    { key: 'land_valuation', label: 'Land Valuation' },
    { key: 'ep_cloa_registration', label: 'EP CLOA Registration' },
    { key: 'ep_cloa_distribution', label: 'EP CLOA Distribution' },
    { key: 'installation', label: 'Installation' }
  ];

  let currentMilestone = initialMilestone || appState.nepMilestoneFilter || 'overall';
  if (!milestoneOptions.some((m) => m.key === currentMilestone)) {
    currentMilestone = 'overall';
  }

  // In-memory working copy for each milestone
  const localData = {};
  localData.overall = JSON.parse(JSON.stringify(appState.state?.nepProvinceList || {}));
  for (const m of milestoneOptions) {
    if (m.key !== 'overall') {
      localData[m.key] = JSON.parse(JSON.stringify(appState.state?.nepMilestoneList?.[m.key] || {}));
    }
  }

  const defaultYear =
    appState.nepYearFilter !== 'ALL' && appState.nepYearFilter
      ? Number(appState.nepYearFilter)
      : appState.state?.nepProvinceList?.LEY?.year || 2026;

  const getActiveMap = () => localData[currentMilestone] || {};

  const rowsHtml = provNodes
    .map((n) => {
      const activeMap = getActiveMap();
      const entry = activeMap[n.code] || { lhs: 0, area: 0, arbs: 0, year: defaultYear };
      return `
        <tr>
          <td><strong>${esc(n.provinceName)}</strong><div class="nep-sub-metric">${esc(n.code)}</div></td>
          <td>
            <input
              type="number"
              min="0"
              step="1"
              class="form-control num nep-sheet-input"
              data-nep-col="lhs"
              name="lhs_${esc(n.code)}"
              value="${esc(entry.lhs || 0)}"
            />
          </td>
          <td>
            <input
              type="number"
              min="0"
              step="0.0001"
              class="form-control num nep-sheet-input"
              data-nep-col="area"
              name="area_${esc(n.code)}"
              value="${esc((Number(entry.area) || 0).toFixed(4))}"
            />
          </td>
          <td>
            <input
              type="number"
              min="0"
              step="1"
              class="form-control num nep-sheet-input"
              data-nep-col="arbs"
              name="arbs_${esc(n.code)}"
              value="${esc(entry.arbs || 0)}"
            />
          </td>
          <td>
            <input
              type="number"
              min="2000"
              max="2099"
              step="1"
              class="form-control num nep-sheet-input"
              data-nep-col="year"
              name="year_${esc(n.code)}"
              value="${esc(entry.year || defaultYear)}"
            />
          </td>
        </tr>
      `;
    })
    .join('');

  showFormModal('Regional Hub NEP Sheet — Put Data / Allocation', {
    formId: 'nep-sheet-form',
    submitLabel: 'Save & Push to Hub NEP Sheet',
    cancelId: 'nep-sheet-cancel',
    contentHtml: `
      <p style="margin:0 0 10px;font-size:12.5px;color:var(--text-muted)">
        Enter or update NEP targets (<strong>LHS</strong>, <strong>AREA</strong>, <strong>ARBs</strong>, and <strong>Year</strong>) stored in the Regional Hub Google Sheet. Only Administrators can edit.
      </p>

      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px;background:var(--surface-alt, #f8faf9);padding:10px 14px;border-radius:8px;border:1px solid var(--border);">
        <!-- Milestone Selector -->
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <label for="nep-modal-milestone" style="font-weight:700;font-size:13px;color:var(--text);margin:0;display:flex;align-items:center;gap:6px;">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--dar-green);"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            Select Milestone:
          </label>
          <select id="nep-modal-milestone" class="form-control" style="font-weight:700;height:34px;min-width:240px;border-color:var(--dar-green);">
            ${milestoneOptions
              .map(
                (m) => `<option value="${esc(m.key)}" ${currentMilestone === m.key ? 'selected' : ''}>${esc(m.label)}</option>`
              )
              .join('')}
          </select>
          <span id="nep-modal-ms-badge" class="badge badge-green" style="font-weight:700;">
            ${esc(milestoneOptions.find((m) => m.key === currentMilestone)?.label || 'Overall NEP')}
          </span>
        </div>

        <!-- Batch Year Updater -->
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;font-weight:600;color:var(--text-muted);">Apply Year:</span>
          <input
            type="number"
            id="nep-global-year-input"
            class="form-control"
            style="width:85px;height:34px;font-weight:700;text-align:center;"
            min="2000"
            max="2099"
            step="1"
            value="${defaultYear}"
          />
          <button type="button" class="btn btn-secondary btn-sm" id="btn-apply-global-year" style="height:34px;">Apply Year</button>
        </div>
      </div>

      <div class="table-wrap">
        <table>
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
            ${rowsHtml}
            <tr style="font-weight:700;background:var(--surface-alt, #f8faf9);">
              <td>Region VIII Total</td>
              <td class="right" id="nep-sheet-total-lhs">0</td>
              <td class="right" id="nep-sheet-total-area">0.0000</td>
              <td class="right" id="nep-sheet-total-arbs">0</td>
              <td class="center">-</td>
            </tr>
          </tbody>
        </table>
      </div>
    `
  });

  const readCurrentFormInputs = () => {
    const form = document.getElementById('nep-sheet-form');
    if (!form) return {};
    const map = {};
    for (const n of provNodes) {
      map[n.code] = {
        lhs: Math.max(0, Math.round(Number(form.elements[`lhs_${n.code}`]?.value) || 0)),
        area: Math.max(0, Number((Number(form.elements[`area_${n.code}`]?.value) || 0).toFixed(4))),
        arbs: Math.max(0, Math.round(Number(form.elements[`arbs_${n.code}`]?.value) || 0)),
        year: Math.max(2000, Math.min(2099, Math.round(Number(form.elements[`year_${n.code}`]?.value) || defaultYear)))
      };
    }
    return map;
  };

  const populateFormWithData = (dataMap) => {
    const form = document.getElementById('nep-sheet-form');
    if (!form) return;
    for (const n of provNodes) {
      const item = dataMap[n.code] || { lhs: 0, area: 0, arbs: 0, year: defaultYear };
      if (form.elements[`lhs_${n.code}`]) form.elements[`lhs_${n.code}`].value = item.lhs || 0;
      if (form.elements[`area_${n.code}`]) form.elements[`area_${n.code}`].value = (Number(item.area) || 0).toFixed(4);
      if (form.elements[`arbs_${n.code}`]) form.elements[`arbs_${n.code}`].value = item.arbs || 0;
      if (form.elements[`year_${n.code}`]) form.elements[`year_${n.code}`].value = item.year || defaultYear;
    }
    updateModalTotals();
  };

  const updateModalTotals = () => {
    const form = document.getElementById('nep-sheet-form');
    if (!form) return;
    let lhsSum = 0;
    let areaSum = 0;
    let arbsSum = 0;
    for (const n of provNodes) {
      lhsSum += Math.max(0, Math.round(Number(form.elements[`lhs_${n.code}`]?.value) || 0));
      areaSum += Math.max(0, Number(form.elements[`area_${n.code}`]?.value) || 0);
      arbsSum += Math.max(0, Math.round(Number(form.elements[`arbs_${n.code}`]?.value) || 0));
    }
    const lhsEl = document.getElementById('nep-sheet-total-lhs');
    const areaEl = document.getElementById('nep-sheet-total-area');
    const arbsEl = document.getElementById('nep-sheet-total-arbs');
    if (lhsEl) lhsEl.textContent = lhsSum.toLocaleString('en-US');
    if (areaEl) areaEl.textContent = areaSum.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    if (arbsEl) arbsEl.textContent = arbsSum.toLocaleString('en-US');
  };

  updateModalTotals();
  document.getElementById('nep-sheet-form')?.addEventListener('input', updateModalTotals);

  document.getElementById('nep-modal-milestone')?.addEventListener('change', (e) => {
    // 1. Stash current form inputs into localData
    localData[currentMilestone] = readCurrentFormInputs();
    // 2. Switch milestone
    currentMilestone = e.target.value;
    const msObj = milestoneOptions.find((m) => m.key === currentMilestone);
    const badge = document.getElementById('nep-modal-ms-badge');
    if (badge) badge.textContent = msObj?.label || currentMilestone;
    // 3. Populate form with selected milestone's data
    populateFormWithData(localData[currentMilestone] || {});
  });

  document.getElementById('btn-apply-global-year')?.addEventListener('click', () => {
    const yr = Number(document.getElementById('nep-global-year-input')?.value) || 2026;
    for (const n of provNodes) {
      const inp = document.getElementById('nep-sheet-form')?.elements[`year_${n.code}`];
      if (inp) inp.value = yr;
    }
  });

  if (targetProv) {
    setTimeout(() => {
      const el = document.getElementById('nep-sheet-form')?.elements[`lhs_${targetProv}`];
      if (el) {
        el.focus();
        el.select();
      }
    }, 60);
  }

  document.getElementById('nep-sheet-cancel')?.addEventListener('click', closeModal);
  document.getElementById('nep-sheet-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    localData[currentMilestone] = readCurrentFormInputs();
    const payload = localData[currentMilestone];
    const msObj = milestoneOptions.find((m) => m.key === currentMilestone);
    const milestoneTitle = msObj ? msObj.label : currentMilestone;

    try {
      const res = await withLoading(
        'saving',
        'Saving NEP Sheet…',
        `Updating Regional Hub NEP tab for ${milestoneTitle} (LHS, AREA, ARBs, Year)…`,
        () =>
          api('/api/nep-sheet', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              milestone: currentMilestone,
              nepProvinceList: payload,
              nepMilestoneList: localData
            })
          })
      );
      appState.state.nepProvinceList = res.nepProvinceList;
      if (res.nepMilestoneList) appState.state.nepMilestoneList = res.nepMilestoneList;
      if (res.nepTargets) appState.state.nepTargets = res.nepTargets;
      appState.analytics = res.analytics;
      appState.nepMilestoneFilter = currentMilestone;
      closeModal();
      renderActiveView();
      toast(
        res.gasSync?.ok
          ? `Saved & synced Regional Hub NEP Sheet (${milestoneTitle})`
          : `Saved Regional NEP Sheet locally (${milestoneTitle})`
      );
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openNepTargetsModal() {
  if (appState.provinceScope) {
    toast('Only Regional Accounts can edit the Regional NEP Target List.', true);
    return;
  }
  const milestones = appState.schemas?.dashboardMilestones || [];
  const currentTargets = appState.state?.nepTargets || {};

  const rowsHtml = milestones
    .map((m) => {
      const t = currentTargets[m.key] || { targetCount: 0, targetAreaHas: 0 };
      return `
        <tr>
          <td><strong>${esc(m.label)}</strong><div class="nep-sub-metric">${esc(m.sourceTab)}</div></td>
          <td>
            <input
              type="number"
              min="0"
              step="1"
              class="form-control num"
              name="c_${esc(m.key)}"
              value="${esc(t.targetCount || 0)}"
            />
          </td>
          <td>
            <input
              type="number"
              min="0"
              step="0.0001"
              class="form-control num"
              name="a_${esc(m.key)}"
              value="${esc((Number(t.targetAreaHas) || 0).toFixed(4))}"
            />
          </td>
        </tr>
      `;
    })
    .join('');

  showFormModal('Regional List — NEP Targets', {
    formId: 'nep-targets-form',
    submitLabel: 'Save Regional NEP Targets',
    cancelId: 'nep-cancel',
    bodyHtml: `
      <div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 12px;gap:8px">
        <p style="margin:0;font-size:12.5px;color:var(--text-muted)">
          Region VIII consolidated NEP Target per milestone. Only Regional Accounts can edit this list.
        </p>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-fetch-hub-nep-modal" style="white-space:nowrap">
          Fetch from Regional Hub NEP
        </button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Milestone</th>
              <th class="right">NEP Target (Lots / eTitles)</th>
              <th class="right">NEP Target Area (HAS)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `
  });

  document.getElementById('btn-fetch-hub-nep-modal')?.addEventListener('click', async () => {
    try {
      const res = await withLoading(
        'fetching',
        'Fetching Hub NEP Targets…',
        'Reading live NEP targets from Regional Hub Google Sheet…',
        () => api('/api/nep-sheet/sync', { method: 'POST' })
      );
      appState.state.nepProvinceList = res.nepProvinceList;
      if (res.nepMilestoneList) appState.state.nepMilestoneList = res.nepMilestoneList;
      if (res.nepTargets) appState.state.nepTargets = res.nepTargets;
      appState.analytics = res.analytics;
      const form = document.getElementById('nep-targets-form');
      if (form) {
        for (const m of milestones) {
          const t = res.nepTargets?.[m.key] || { targetCount: 0, targetAreaHas: 0 };
          const cInput = form.elements[`c_${m.key}`];
          const aInput = form.elements[`a_${m.key}`];
          if (cInput) cInput.value = t.targetCount || 0;
          if (aInput) aInput.value = (Number(t.targetAreaHas) || 0).toFixed(4);
        }
      }
      toast('Fetched NEP Targets from Regional Hub');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('nep-cancel')?.addEventListener('click', closeModal);
  document.getElementById('nep-targets-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const m of milestones) {
      payload[m.key] = {
        targetCount: Math.max(0, Number(fd.get(`c_${m.key}`)) || 0),
        targetAreaHas: Math.max(0, Number(fd.get(`a_${m.key}`)) || 0)
      };
    }
    try {
      const res = await withLoading(
        'saving',
        'Saving Regional NEP Targets…',
        'Updating Region VIII Regional NEP Target List…',
        () =>
          api('/api/nep-targets', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
      );
      appState.state.nepTargets = res.nepTargets;
      appState.analytics = res.analytics;
      closeModal();
      renderActiveView();
      toast('Updated Regional NEP Target List');
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
    const data = await withLoading(
      'fetching',
      'Fetching Parcel Dossier…',
      `Loading cross-tab OPTool & Milestone details for ${lhid}…`,
      () => api(`/api/landholding/${encodeURIComponent(lhid)}`)
    );
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

/** Fetch user registration list for Administrator confirmation management. */
async function loadUsersDirectory() {
  const data = await withLoading(
    'fetching',
    'Fetching User Accounts…',
    'Loading pending registrations and confirmed regional accounts…',
    () => api('/api/auth/users')
  );
  appState.usersList = data.users || [];
  appState.pendingUserCount = data.pendingCount || 0;
  syncCurrentUserUi();
}

/** Attach Administrator Account Confirmation view actions. */
function bindUsersViewEvents(container) {
  container.querySelector('#btn-refresh-users')?.addEventListener('click', async () => {
    try {
      await loadUsersDirectory();
      renderActiveView();
      toast('Refreshed account approvals list');
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.querySelector('#btn-sync-users-sheet')?.addEventListener('click', async () => {
    try {
      const res = await withLoading(
        'saving',
        'Syncing User_Accounts Sheet…',
        'Synchronizing user accounts with Regional Account Hub Google Sheet…',
        () => api('/api/auth/users/sync-sheet', { method: 'POST' })
      );
      appState.usersList = res.users || [];
      appState.pendingUserCount = res.pendingCount || 0;
      syncCurrentUserUi();
      renderActiveView();
      toast(`Synced ${res.synced || appState.usersList.length} account(s) with Regional Google Sheet`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.querySelectorAll('[data-user-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.userId;
      const action = btn.dataset.userAction;
      if (action === 'delete') {
        const label = btn.dataset.userName || userId;
        if (!confirm(`Permanently delete account "${label}"? This removes the user from SALIG and User_Accounts.`)) {
          return;
        }
        try {
          const res = await withLoading(
            'saving',
            'Deleting Account…',
            `Removing ${label} from SALIG & Regional Hub User_Accounts…`,
            () => api(`/api/auth/users/${encodeURIComponent(userId)}`, { method: 'DELETE' })
          );
          appState.usersList = res.users || [];
          appState.pendingUserCount = res.pendingCount || 0;
          syncCurrentUserUi();
          renderActiveView();
          toast(`Deleted account for ${label}${formatGasPushSuffix(res)}`);
        } catch (err) {
          toast(err.message, true);
        }
        return;
      }
      const payload =
        action === 'approve'
          ? { status: 'approved' }
          : action === 'reject'
          ? { status: 'rejected' }
          : action === 'promote'
          ? { role: 'admin' }
          : { role: 'user' };
      try {
        const res = await withLoading(
          'saving',
          'Saving Account Confirmation…',
          'Updating user approval status and permissions…',
          () =>
            api(`/api/auth/users/${encodeURIComponent(userId)}/status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
        );
        appState.usersList = res.users || [];
        appState.pendingUserCount = res.pendingCount || 0;
        syncCurrentUserUi();
        renderActiveView();
        toast(
          (action === 'approve'
            ? `Confirmed account for ${res.user.name}`
            : action === 'reject'
            ? `Declined account for ${res.user.name}`
            : `Updated role for ${res.user.name} (${res.user.role})`) + formatGasPushSuffix(res)
        );
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

function bindCfWhereaboutsEvents(container) {
  const searchInput = container.querySelector('#cf-search');
  searchInput?.addEventListener('input', (e) => {
    appState.cfSearch = e.target.value;
    appState.cfPage = 1;
    const pos = e.target.selectionStart;
    renderActiveView();
    const nextInput = document.getElementById('cf-search');
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(pos, pos);
    }
  });

  container.querySelector('#cf-province-filter')?.addEventListener('change', (e) => {
    appState.cfProvinceFilter = e.target.value;
    appState.cfPage = 1;
    renderActiveView();
  });

  container.querySelector('#cf-status-filter')?.addEventListener('change', (e) => {
    appState.cfDateStatusFilter = e.target.value;
    appState.cfPage = 1;
    renderActiveView();
  });

  container.querySelectorAll('[data-cf-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.cfPage = Number(btn.dataset.cfPage) || 1;
      renderActiveView();
    });
  });

  container.querySelectorAll('[data-open-cf-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.activeOptoolTab = 'CF(DOC)';
      appState.optoolPage = 1;
      appState.optoolColPage = 1;
      appState.view = 'optool';
      renderActiveView();
    });
  });

  container.querySelector('#btn-cf-export-csv')?.addEventListener('click', () => {
    exportCfWhereaboutsCsv();
  });
}

function exportCfWhereaboutsCsv() {
  const rawCfRows = appState.state?.optool?.['CF(DOC)'] || [];
  const dbRows = appState.state?.optool?.Database || [];
  const dbMap = new Map();
  for (const db of dbRows) {
    const k = String(db.lhid || '').trim().toLowerCase();
    if (k && !dbMap.has(k)) dbMap.set(k, db);
  }

  const enrichedRows = rawCfRows.map((cf) => {
    const lhidKey = String(cf.lhid || '').trim().toLowerCase();
    const db = dbMap.get(lhidKey) || {};
    const carpableNum = Number(db.carpable || cf.carpable || cf.carpableArea || 0) || 0;
    const dateFi = String(cf.dateFiConducted || '').trim();
    const datePrep = String(cf.datePreparedSigned || '').trim();
    const monthRep = String(cf.reportedMonth || '').trim();
    const provName = db.province || cf.province || (appState.provinceScope ? appState.provinceScope.provinceName : 'Unknown');
    const muniName = db.municipality || cf.municipality || '—';
    const brgyName = db.barangay || cf.barangay || '—';
    const titleNum = db.titleNumber || cf.titleNumber || '—';
    const landOwner = db.landOwner || cf.landOwner || '—';
    const targetPeriod = cf.target || db.targetYear || 'Current';

    const hasFi = Boolean(dateFi);
    const hasPrep = Boolean(datePrep);
    const hasMonth = Boolean(monthRep);
    const isComplete = hasFi && hasPrep && hasMonth;

    let stage = 'Pending FI';
    if (isComplete) stage = 'Completed & Reported';
    else if (hasPrep) stage = 'Prepared & Signed';
    else if (hasFi) stage = 'FI Conducted';
    else if (hasMonth) stage = 'Reported (Pending Dates)';

    return {
      lhid: cf.lhid || db.lhid || '—',
      province: provName,
      municipality: muniName,
      barangay: brgyName,
      titleNumber: titleNum,
      landOwner: landOwner,
      carpable: carpableNum.toFixed(4),
      dateFiConducted: dateFi || 'Pending',
      datePreparedSigned: datePrep || 'Pending',
      reportedMonth: monthRep || '—',
      target: targetPeriod,
      stage
    };
  });

  let rows = enrichedRows;
  if (appState.cfProvinceFilter && appState.cfProvinceFilter !== 'ALL') {
    const fNorm = appState.cfProvinceFilter.trim().toUpperCase();
    rows = rows.filter((r) => r.province.toUpperCase().includes(fNorm));
  }
  if (appState.cfDateStatusFilter === 'with_fi') {
    rows = rows.filter((r) => r.dateFiConducted !== 'Pending');
  } else if (appState.cfDateStatusFilter === 'with_prep') {
    rows = rows.filter((r) => r.datePreparedSigned !== 'Pending');
  } else if (appState.cfDateStatusFilter === 'with_month') {
    rows = rows.filter((r) => r.reportedMonth !== '—');
  } else if (appState.cfDateStatusFilter === 'all_complete') {
    rows = rows.filter((r) => r.stage === 'Completed & Reported');
  } else if (appState.cfDateStatusFilter === 'pending') {
    rows = rows.filter((r) => r.stage !== 'Completed & Reported');
  }
  const q = (appState.cfSearch || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      `${r.lhid} ${r.province} ${r.municipality} ${r.barangay} ${r.landOwner} ${r.titleNumber} ${r.dateFiConducted} ${r.datePreparedSigned} ${r.reportedMonth}`
        .toLowerCase()
        .includes(q)
    );
  }

  const headers = [
    'LHID',
    'Province',
    'Municipality',
    'Barangay',
    'TitleNumber',
    'LandOwner',
    'CARPable_HAS',
    'Date_FI_Conducted',
    'Date_Prepared_Signed',
    'Reported_Month',
    'Target_Period',
    'Whereabouts_Status'
  ];
  const headerLine = headers.map((h) => `"${h}"`).join(',');
  const lines = rows.map((r) =>
    [
      r.lhid,
      r.province,
      r.municipality,
      r.barangay,
      r.titleNumber,
      r.landOwner,
      r.carpable,
      r.dateFiConducted,
      r.datePreparedSigned,
      r.reportedMonth,
      r.target,
      r.stage
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );

  const blob = new Blob([[headerLine, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `CF_Whereabouts_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/** Load regional workspace bootstrap data after authentication succeeds. */
async function bootAppSession() {
  const boot = await withLoading(
    'fetching',
    'Fetching Regional Data…',
    'Loading Region VIII OPTool database, analytics, and sync state…',
    () => api('/api/bootstrap')
  );
  appState.currentUser = boot.currentUser || appState.currentUser;
  appState.provinceScope = boot.provinceScope || null;
  appState.filters.province = appState.provinceScope?.code || 'ALL';
  appState.pendingUserCount = boot.pendingUserCount || 0;
  appState.schemas = boot.schemas;
  appState.state = boot.state;
  appState.analytics = boot.analytics;
  appState.gasScript = boot.gasScript;
  appState.gasHtml = boot.gasHtml || '';
  if (appState.view === 'users' && appState.currentUser?.role !== 'admin') {
    appState.view = 'dashboard';
  }
  showAppShell();
  renderActiveView();
  stopAutoSync();
  autoSyncStartTimer = setTimeout(() => {
    if (appState.currentUser) maybeAutoSyncGoogleSheets();
  }, 2000);
  startAutoSyncLoop();
}

/** Bind Sign In, Email OTP, Create Account, Password Toggles, and Log Out actions. */
function bindAuthEvents() {
  let otpCooldownTimer = null;
  let signupOtpStepActive = false;

  const stopOtpCooldown = () => {
    if (otpCooldownTimer) {
      clearInterval(otpCooldownTimer);
      otpCooldownTimer = null;
    }
    const sendBtn = document.getElementById('btn-send-otp');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Resend OTP';
    }
  };

  const startOtpCooldown = (seconds = 30) => {
    stopOtpCooldown();
    const sendBtn = document.getElementById('btn-send-otp');
    if (!sendBtn) return;
    let remaining = Math.max(1, Number(seconds) || 30);
    sendBtn.disabled = true;
    sendBtn.textContent = `Resend (${remaining}s)`;
    otpCooldownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        stopOtpCooldown();
      } else {
        sendBtn.textContent = `Resend (${remaining}s)`;
      }
    }, 1000);
  };

  const setSignupOtpStep = (active, email = '') => {
    signupOtpStepActive = Boolean(active);
    const detailsStep = document.getElementById('signup-details-step');
    const otpBox = document.getElementById('otp-verification-box');
    const targetEmailEl = document.getElementById('otp-target-email');
    const otpInput = document.getElementById('signup-otp');
    const submitBtn = document.getElementById('btn-signup-submit');
    const titleEl = document.getElementById('auth-form-title');
    const subEl = document.getElementById('auth-form-subtitle');

    detailsStep?.classList.toggle('hidden', signupOtpStepActive);
    otpBox?.classList.toggle('hidden', !signupOtpStepActive);
    if (targetEmailEl && email) {
      targetEmailEl.textContent = email;
    }
    if (otpInput) {
      otpInput.required = signupOtpStepActive;
      if (!signupOtpStepActive) otpInput.value = '';
    }
    if (submitBtn) {
      submitBtn.textContent = signupOtpStepActive ? 'Verify OTP & Complete Account' : 'Create Account';
    }
    if (titleEl && subEl && document.querySelector('[data-auth-tab="signup"]')?.classList.contains('active')) {
      titleEl.textContent = signupOtpStepActive ? 'Verify Your Email' : 'Create SALIG Account';
      subEl.textContent = signupOtpStepActive
        ? 'Enter the 6-digit OTP sent to your email address'
        : 'Fill in your details and click Create Account to receive an Email OTP';
    }
  };

  const requestSignupOtp = async (email, name) => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthFeedback('Please enter a valid Email address before continuing.', 'error');
      document.getElementById('signup-email')?.focus();
      return false;
    }
    setAuthFeedback('');
    try {
      const res = await withLoading(
        'saving',
        'Sending Verification OTP…',
        `Sending a 6-digit verification code to ${email}…`,
        () =>
          api('/api/auth/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name })
          })
      );
      setSignupOtpStep(true, email);
      const previewEl = document.getElementById('otp-preview-banner');
      if (previewEl) {
        if (res.previewOtp) {
          previewEl.classList.remove('hidden');
          const reasonNote = res.reason ? ` (${esc(res.reason)})` : '';
          previewEl.innerHTML = `Staging OTP Preview Code: <strong class="mono">${esc(res.previewOtp)}</strong>${reasonNote}`;
        } else {
          previewEl.classList.add('hidden');
          previewEl.textContent = '';
        }
      }
      setAuthFeedback(res.message, res.deliveryMode === 'email' ? 'success' : 'info');
      startOtpCooldown(res.cooldownSeconds || 30);
      document.getElementById('signup-otp')?.focus();
      return true;
    } catch (err) {
      setAuthFeedback(err.message, 'error');
      if (err.message && /wait (\d+)s/i.test(err.message)) {
        const m = err.message.match(/wait (\d+)s/i);
        if (m) {
          setSignupOtpStep(true, email);
          startOtpCooldown(Number(m[1]));
        }
      }
      return false;
    }
  };

  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchAuthTab(btn.dataset.authTab);
      if (btn.dataset.authTab === 'signup') {
        setSignupOtpStep(signupOtpStepActive);
      }
      setAuthFeedback('');
    });
  });

  document.querySelectorAll('[data-toggle-pw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePw);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
    });
  });

  document.getElementById('btn-signup-back')?.addEventListener('click', () => {
    setSignupOtpStep(false);
    setAuthFeedback('');
  });

  document.getElementById('btn-send-otp')?.addEventListener('click', async () => {
    const email = document.getElementById('signup-email').value.trim();
    const name = document.getElementById('signup-name').value.trim();
    await requestSignupOtp(email, name);
  });

  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    setAuthFeedback('');
    try {
      const res = await withLoading(
        'saving',
        'Signing In…',
        'Verifying credentials & Administrator confirmation…',
        () =>
          api('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
          })
      );
      appState.currentUser = res.user;
      document.getElementById('login-password').value = '';
      await bootAppSession();
      toast(`Welcome back, ${res.user.name}`);
    } catch (err) {
      setAuthFeedback(err.message, 'error');
    }
  });

  document.getElementById('signup-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const otpCode = document.getElementById('signup-otp').value.trim();
    const province = document.getElementById('signup-province').value;
    const contactNumber = document.getElementById('signup-contact').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm').value;

    if (password !== confirmPassword) {
      if (signupOtpStepActive) setSignupOtpStep(false);
      setAuthFeedback('Password and Confirm Password do not match.', 'error');
      return;
    }

    if (!signupOtpStepActive) {
      await requestSignupOtp(email, name);
      return;
    }

    if (!/^\d{6}$/.test(otpCode)) {
      setAuthFeedback('Enter the 6-digit Email OTP code sent to your email address.', 'error');
      document.getElementById('signup-otp')?.focus();
      return;
    }

    setAuthFeedback('');
    try {
      const res = await withLoading(
        'saving',
        'Creating Account…',
        'Verifying Email OTP & submitting registration for Administrator confirmation…',
        () =>
          api('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, province, contactNumber, password, otpCode })
          })
      );
      document.getElementById('signup-form').reset();
      setSignupOtpStep(false);
      document.getElementById('otp-preview-banner')?.classList.add('hidden');
      stopOtpCooldown();
      showAuthScreen(res.message, 'success', 'login');
      document.getElementById('login-email').value = email;
    } catch (err) {
      setAuthFeedback(err.message, 'error');
    }
  });

  const performLogout = async () => {
    stopAutoSync();
    try {
      await withLoading(
        'saving',
        'Logging Out…',
        'Closing active SALIG session…',
        () =>
          Promise.all([
            api('/api/auth/logout', {
              method: 'POST',
              signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
                ? AbortSignal.timeout(1200)
                : undefined
            }).catch(() => null),
            new Promise((resolve) => setTimeout(resolve, 600))
          ])
      );
    } finally {
      appState.usersList = [];
      appState.pendingUserCount = 0;
      appState.view = 'dashboard';
      showAuthScreen('You have logged out cleanly.', 'info', 'login');
      syncCurrentUserUi();
      hideLoadingOverlay(true);
    }
  };

  document.getElementById('btn-logout')?.addEventListener('click', performLogout);
  document.getElementById('btn-topbar-logout')?.addEventListener('click', performLogout);
}

function updateTopbarClock() {
  const dateEl = document.getElementById('topbar-date');
  const timeEl = document.getElementById('topbar-time');
  if (!dateEl && !timeEl) return;
  const now = new Date();
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }
}

async function init() {
  updateTopbarClock();
  setInterval(updateTopbarClock, 1000);
  bindAuthEvents();
  try {
    const session = await withLoading(
      'fetching',
      'Loading SALIG (LAD DATABASE)…',
      'Checking active authentication session…',
      () => api('/api/auth/session')
    );
    if (session.authenticated || session.requireAuth === false) {
      appState.currentUser = session.user || { name: 'Local Operator', role: 'admin', province: 'Region VIII Hub' };
      await bootAppSession();
    } else {
      showAuthScreen('');
    }
  } catch (err) {
    showAuthScreen(`Unable to check session: ${err.message}`, 'error', 'login');
  } finally {
    hideLoadingOverlay(true);
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
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      appState.view = btn.dataset.view;
      sidebarEl?.classList.remove('open');
      syncSidebarToggleUi();
      if (appState.view === 'users') {
        try {
          await loadUsersDirectory();
        } catch (err) {
          toast(err.message, true);
        }
      }
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

  // Global Esc key listener for modal, drawer, or full screen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-backdrop');
      if (modal && !modal.classList.contains('hidden')) {
        closeModal();
        e.stopPropagation();
        return;
      }
      const drawer = document.getElementById('drawer-backdrop');
      if (drawer && !drawer.classList.contains('hidden')) {
        drawer.classList.add('hidden');
        e.stopPropagation();
        return;
      }
      const fsId = appState.activeFullscreenPanelId || activeFullscreenPanelId;
      if (fsId) {
        const p = document.getElementById(fsId);
        if (p) {
          p.classList.remove('is-fullscreen');
          const btn = p.querySelector('.btn-fullscreen');
          if (btn) updateFsBtn(btn, false);
        }
        document.body.classList.remove('has-fullscreen-panel');
        appState.activeFullscreenPanelId = null;
        activeFullscreenPanelId = null;
      }
    }
  });
}

init();

