import {
  esc,
  fmtArea,
  isChecklistChecked,
  getGroupVariantClass,
  LINKED_DB_PROFILE_FIELDS,
  renderDashboardView,
  renderMapDetailCardInner,
  renderProvTableDetailHtml,
  computeMilestoneWhereaboutsBreakdown,
  renderMilestoneWhereaboutsSectionHtml,
  renderMilestonesView,
  renderOptoolView,
  renderOptoolPartial,
  getColumnFilterValues,
  getColumnFilterLabel,
  renderSyncView,
  renderUsersView,
  renderNepView,
  renderAuditLogsView,
  renderTargetSummaryView,
  renderCfWhereaboutsView,
  renderSurveyWhereaboutsView,
  renderMovWhereaboutsView,
  renderRegDistWhereaboutsView,
  renderInstallationWhereaboutsView,
  renderLeaseholdView,
  renderLeaseholdModalHtml,
  generateLeaseholdCsv,
  getLeaseholdAreaTenanted,
  getLeaseholdTargetYear,
  matchesWhereaboutsTargetYear,
  matchProvinceName,
  resolveProvinceCode,
  getWhereaboutsColumnFilterValues,
  getWhereaboutsRowDisplayValue,
  renderSurveySupportListModalHtml,
  renderCfSupportListModalHtml,
  generateOptoolSupportListCsv,
  WHEREABOUTS_CONFIGS
} from './views.js';
import {
  formatCurrentMonthYear,
  formatReportedMonthWord,
  formatYearDisplay,
  formatLhidDisplay,
  getReportedMonthOptions,
  isReportedMonthKey,
  resolveTargetFromDatabaseRow,
  SURVEY_STATUS_STAGES,
  resolveSurveyCurrentStatus,
  resolveTotalArbsFromGenderCounts,
  normalizePdfUrl,
  toEmbeddablePdfUrl
} from './reportingUtils.js';

const appState = {
  view: 'dashboard',
  currentUser: null,
  provinceScope: null,
  dashboardMapProvince: 'ALL',
  dashboardRightPanelTab: 'map',
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
  surveyMetricMode: 'both', // 'both' | 'lhs' | 'area'
  surveyIndicatorTab: 'all', // 'all' (all 4 groups stacked) | 'group1' | 'group2' | 'group3' | 'group4'
  surveyMatrixMode: 'active', // 'active' (statuses with data) | 'all' (all 12 workflow stages)
  nepYearFilter: 'ALL', // 'ALL' | '2026' | '2025' | ...
  nepMilestoneFilter: 'overall', // 'overall' | 'cf_doc' | 'land_survey' | ...
  nepMilestoneTableFilter: 'ALL', // 'ALL' | 'cf_doc' | 'land_survey' | ...
  nepDisplayMode: 'table', // 'table' | 'cards'
  nepColVisibility: { lhs: true, area: true, arbs: true },
  nepShowMonths: false,
  nepExpandedQuarters: {},
  nepExpandedTargetSems: false,
  nepExpandedAccompSems: true,
  nepShowProvinces: false,
  nepExpandedMilestones: {},
  filters: {
    province: 'ALL',
    periodMonth: 'LATEST',
    batch: 'ALL',
    milestoneYear: '2027'
  },
  msSearch: '',
  optoolSearch: '',
  optoolTargetFilter: 'ALL',
  cfSurveyFilter: 'ALL',
  optoolColFilters: {},
  optoolPage: 1,
  optoolPageSize: 50,
  optoolColMode: 'preview',
  optoolColPage: 1,
  whereaboutsSearch: {},
  whereaboutsProvinceFilter: {},
  whereaboutsStatusFilter: {},
  whereaboutsTargetYearFilter: {},
  whereaboutsColFilters: {},
  whereaboutsShowGraph: {},
  whereaboutsGraphMode: {},
  whereaboutsPage: {},
  whereaboutsPageSize: {},
  cfMetricMode: 'both',
  cfTableLayout: 'standard',
  leaseholdSearch: '',
  leaseholdProvinceFilter: 'ALL',
  leaseholdStatusFilter: 'ALL',
  leaseholdTargetYearFilter: 'ALL',
  leaseholdPage: 1,
  leaseholdPageSize: 25
};

const AUTO_SYNC_MAX_AGE_MS = 10 * 1000;
const AUTO_SYNC_INTERVAL_MS = 20 * 1000;

let optoolSearchTimer = null;
let leaseholdSearchTimer = null;
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
    try {
      autoSyncAbortController.abort(new Error('Auto-sync cancelled'));
    } catch (_) {
      autoSyncAbortController.abort();
    }
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
  const activeTab = appState.view === 'optool' ? 'Database' : (appState.activeOptoolTab || 'Database');
  return {
    state: appState.state,
    schemas: appState.schemas,
    activeOptoolTab: activeTab,
    searchTerm: appState.optoolSearch,
    optoolTargetFilter: appState.optoolTargetFilter,
    cfSurveyFilter: appState.cfSurveyFilter,
    optoolColFilters: appState.optoolColFilters,
    optoolPage: appState.optoolPage,
    optoolPageSize: appState.optoolPageSize,
    optoolColMode: appState.optoolColMode,
    optoolColPage: appState.optoolColPage,
    filters: appState.filters,
    view: appState.view
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
  const allValues = values.map((v) => v.value);
  if (blankCount > 0) allValues.push('__BLANK__');

  let selectedSet = new Set();
  let hasActiveFilter = false;

  if (currentSpec) {
    if (Array.isArray(currentSpec.values) && currentSpec.values.length > 0) {
      selectedSet = new Set(currentSpec.values);
      hasActiveFilter = true;
    } else if (currentSpec.value && currentSpec.value !== 'ALL') {
      selectedSet = new Set([String(currentSpec.value)]);
      hasActiveFilter = true;
    }
  }

  // If no filter is active, Excel default is that all items are checked
  if (!hasActiveFilter) {
    selectedSet = new Set(allValues);
  }

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
        <span class="col-dd-summary-pill" id="col-dd-summary-pill">${selectedSet.size} of ${allValues.length}</span>
      </div>
      <input
        type="search"
        id="col-dd-search"
        class="col-dd-search"
        placeholder="${esc(searchPlaceholder)}"
        autocomplete="off"
      />
      <div class="col-dd-quick-actions">
        <button type="button" class="col-dd-link-btn" id="col-dd-select-all-btn">Select All</button>
        <span style="color:var(--border-strong)">•</span>
        <button type="button" class="col-dd-link-btn" id="col-dd-clear-all-btn">Clear All</button>
      </div>
    </div>
    <div class="col-dd-list" id="col-dd-list" role="listbox"></div>
    <div class="col-dd-meta" id="col-dd-meta"></div>
    <div class="col-dd-footer">
      <button type="button" class="btn btn-xs btn-secondary" id="col-dd-clear-btn" title="Clear filter (show all)">Clear</button>
      <div class="col-dd-footer-btns">
        <button type="button" class="btn btn-xs btn-outline" id="col-dd-cancel-btn">Cancel</button>
        <button type="button" class="btn btn-xs btn-primary" id="col-dd-apply-btn">OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(pop);

  const rect = triggerBtn.getBoundingClientRect();
  const popWidth = 290;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 12));
  const estimatedHeight = Math.min(380, window.innerHeight - 24);
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const openAbove = spaceBelow < 320 && spaceAbove > spaceBelow;

  pop.style.left = `${left}px`;
  if (openAbove) {
    const bottom = Math.max(8, window.innerHeight - rect.top + 4);
    pop.style.bottom = `${bottom}px`;
    pop.style.maxHeight = `${Math.min(estimatedHeight, rect.top - 16)}px`;
  } else {
    const top = Math.max(8, rect.bottom + 4);
    pop.style.top = `${top}px`;
    pop.style.maxHeight = `${Math.min(estimatedHeight, window.innerHeight - top - 12)}px`;
  }

  const listEl = pop.querySelector('#col-dd-list');
  const metaEl = pop.querySelector('#col-dd-meta');
  const searchEl = pop.querySelector('#col-dd-search');

  const applyFilter = (spec) => {
    if (
      !spec ||
      (spec.values && spec.values.length === 0) ||
      (spec.values && spec.values.length === allValues.length) ||
      !spec.value
    ) {
      delete appState.optoolColFilters[colKey];
    } else {
      appState.optoolColFilters[colKey] = spec;
    }
    appState.optoolPage = 1;
    updateOptoolRowsInPlace(container);
    closeColFilterPopover();
  };

  const updateSummaryPill = () => {
    const pill = pop.querySelector('#col-dd-summary-pill');
    if (pill) {
      if (allValues.length === 0) {
        pill.textContent = '0 options';
      } else if (selectedSet.size === allValues.length) {
        pill.textContent = `(All) ${allValues.length}`;
      } else if (selectedSet.size === 0) {
        pill.textContent = '0 selected';
      } else {
        pill.textContent = `${selectedSet.size} of ${allValues.length}`;
      }
    }
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
    const isAllChecked = allValues.length > 0 && selectedSet.size === allValues.length;
    const isSomeChecked = selectedSet.size > 0 && selectedSet.size < allValues.length;

    if (!q) {
      parts.push(`
        <div class="col-dd-item col-dd-select-all" role="option">
          <input type="checkbox" class="col-dd-check" id="col-dd-check-all" ${isAllChecked ? 'checked' : ''} />
          <span class="col-dd-val"><strong>(Select All)</strong></span>
          <span class="col-dd-count">${totalRows}</span>
        </div>
      `);
      if (blankCount > 0) {
        const isBlankChecked = selectedSet.has('__BLANK__');
        parts.push(`
          <div class="col-dd-item ${isBlankChecked ? 'selected' : ''}" role="option" aria-selected="${isBlankChecked ? 'true' : 'false'}" data-item-val="__BLANK__">
            <input type="checkbox" class="col-dd-check" data-dd-val="__BLANK__" ${isBlankChecked ? 'checked' : ''} />
            <span class="col-dd-val" title="${esc(blankLabel)}">${esc(blankLabel)}</span>
            <span class="col-dd-count">${blankCount}</span>
            <button type="button" class="col-dd-only-btn" data-only-val="__BLANK__" title="Select only ${esc(blankLabel)}">only</button>
          </div>
        `);
      }
    } else {
      const visibleVals = shown.map((v) => v.value);
      const allSearchChecked = visibleVals.length > 0 && visibleVals.every((v) => selectedSet.has(v));
      parts.push(`
        <div class="col-dd-item col-dd-select-all" role="option">
          <input type="checkbox" class="col-dd-check" id="col-dd-check-search-all" ${allSearchChecked ? 'checked' : ''} />
          <span class="col-dd-val"><strong>(Select All Search Results)</strong></span>
          <span class="col-dd-count">${filtered.length}</span>
        </div>
      `);
      if (col.type === 'checkbox' && blankCount > 0 && 'unchecked'.includes(qLower)) {
        const isBlankChecked = selectedSet.has('__BLANK__');
        parts.push(`
          <div class="col-dd-item ${isBlankChecked ? 'selected' : ''}" role="option" aria-selected="${isBlankChecked ? 'true' : 'false'}" data-item-val="__BLANK__">
            <input type="checkbox" class="col-dd-check" data-dd-val="__BLANK__" ${isBlankChecked ? 'checked' : ''} />
            <span class="col-dd-val" title="${esc(blankLabel)}">${esc(blankLabel)}</span>
            <span class="col-dd-count">${blankCount}</span>
            <button type="button" class="col-dd-only-btn" data-only-val="__BLANK__" title="Select only ${esc(blankLabel)}">only</button>
          </div>
        `);
      }
    }

    for (const item of shown) {
      const isChecked = selectedSet.has(item.value);
      parts.push(`
        <div class="col-dd-item ${isChecked ? 'selected' : ''}" role="option" aria-selected="${isChecked ? 'true' : 'false'}" data-item-val="${esc(item.value)}">
          <input type="checkbox" class="col-dd-check" data-dd-val="${esc(item.value)}" ${isChecked ? 'checked' : ''} />
          <span class="col-dd-val" title="${esc(item.value)}">${esc(item.value)}</span>
          <span class="col-dd-count">${item.count}</span>
          <button type="button" class="col-dd-only-btn" data-only-val="${esc(item.value)}" title="Select only ${esc(item.value)}">only</button>
        </div>
      `);
    }

    if (parts.length === 0 || (q && shown.length === 0)) {
      parts.push('<div class="col-dd-empty" style="padding:10px;font-size:12px;color:var(--text-muted)">No matching options</div>');
    }

    listEl.innerHTML = parts.join('');

    const checkAll = listEl.querySelector('#col-dd-check-all');
    if (checkAll) {
      checkAll.indeterminate = isSomeChecked;
    }

    metaEl.textContent =
      filtered.length > MAX_RENDERED
        ? `Showing ${MAX_RENDERED} of ${filtered.length} options — keep typing to narrow`
        : `${filtered.length} distinct value(s)`;
    updateSummaryPill();
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
      pop.querySelector('#col-dd-apply-btn')?.click();
    }
  });

  pop.querySelector('#col-dd-select-all-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    allValues.forEach((v) => selectedSet.add(v));
    renderList(searchEl.value);
  });

  pop.querySelector('#col-dd-clear-all-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    selectedSet.clear();
    renderList(searchEl.value);
  });

  listEl.addEventListener('click', (e) => {
    // 1. If clicked "only" button
    const onlyBtn = e.target.closest('.col-dd-only-btn');
    if (onlyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const val = onlyBtn.dataset.onlyVal;
      applyFilter({
        mode: 'multi',
        values: [val],
        value: val === '__BLANK__' ? (col.type === 'checkbox' ? '(Unchecked)' : '(Blank)') : val
      });
      return;
    }

    // 2. If clicked "Select All"
    const selectAllItem = e.target.closest('.col-dd-select-all');
    if (selectAllItem) {
      e.preventDefault();
      const isSearchAll = Boolean(selectAllItem.querySelector('#col-dd-check-search-all'));
      if (isSearchAll) {
        const visibleVals = lastFiltered.map((v) => v.value);
        const allVisibleChecked = visibleVals.length > 0 && visibleVals.every((v) => selectedSet.has(v));
        if (allVisibleChecked) {
          visibleVals.forEach((v) => selectedSet.delete(v));
        } else {
          visibleVals.forEach((v) => selectedSet.add(v));
        }
      } else {
        if (selectedSet.size === allValues.length) {
          selectedSet.clear();
        } else {
          allValues.forEach((v) => selectedSet.add(v));
        }
      }
      renderList(searchEl.value);
      return;
    }

    // 3. If clicked regular item row, text, or checkbox
    const itemEl = e.target.closest('.col-dd-item');
    if (!itemEl) return;
    const check = itemEl.querySelector('.col-dd-check');
    if (!check) return;
    const val = check.dataset.ddVal;
    if (val === undefined) return;

    if (e.target !== check) {
      check.checked = !check.checked;
    }

    if (check.checked) {
      selectedSet.add(val);
      itemEl.classList.add('selected');
      itemEl.setAttribute('aria-selected', 'true');
    } else {
      selectedSet.delete(val);
      itemEl.classList.remove('selected');
      itemEl.setAttribute('aria-selected', 'false');
    }

    const checkAll = listEl.querySelector('#col-dd-check-all');
    if (checkAll) {
      checkAll.checked = selectedSet.size === allValues.length;
      checkAll.indeterminate = selectedSet.size > 0 && selectedSet.size < allValues.length;
    }
    updateSummaryPill();
  });

  listEl.addEventListener('dblclick', (e) => {
    const itemEl = e.target.closest('.col-dd-item:not(.col-dd-select-all)');
    if (!itemEl) return;
    const check = itemEl.querySelector('.col-dd-check');
    if (!check) return;
    const val = check.dataset.ddVal;
    if (val === undefined) return;
    applyFilter({
      mode: 'multi',
      values: [val],
      value: val === '__BLANK__' ? (col.type === 'checkbox' ? '(Unchecked)' : '(Blank)') : val
    });
  });

  pop.querySelector('#col-dd-apply-btn')?.addEventListener('click', () => {
    if (selectedSet.size === 0 || selectedSet.size === allValues.length) {
      applyFilter(null);
    } else {
      const arr = Array.from(selectedSet);
      applyFilter({
        mode: 'multi',
        values: arr,
        value: arr.map((v) => (v === '__BLANK__' ? (col.type === 'checkbox' ? '(Unchecked)' : '(Blank)') : v)).join(', ')
      });
    }
  });

  pop.querySelector('#col-dd-clear-btn')?.addEventListener('click', () => {
    applyFilter(null);
  });

  pop.querySelector('#col-dd-cancel-btn')?.addEventListener('click', () => {
    closeColFilterPopover();
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
  stopInactivityWatcher();
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
  const navAuditBtn = document.getElementById('nav-audit-logs');
  const pendingPill = document.getElementById('nav-pending-users-count');
  const userCard = document.getElementById('sidebar-user-card');
  const userNameEl = document.getElementById('sidebar-user-name');
  const userMetaEl = document.getElementById('sidebar-user-meta');
  const logoutBtn = document.getElementById('btn-logout');
  const topbarAuthBar = document.getElementById('topbar-auth-bar');
  const topbarUserName = document.getElementById('topbar-user-name');
  const topbarUserRole = document.getElementById('topbar-user-role');

  navUsersBtn?.classList.toggle('hidden', !isAdmin);
  navAuditBtn?.classList.toggle('hidden', !isAdmin);
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
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 45000;
  const timeoutError = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. Please check your network or try again.`);
  const timer = setTimeout(() => {
    try {
      controller.abort(timeoutError);
    } catch (_) {
      controller.abort();
    }
  }, timeoutMs);
  try {
    const { timeoutMs: _t, signal: extSignal, ...fetchOpts } = options;
    const signal = extSignal || controller.signal;
    const resp = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal, ...fetchOpts });
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
  } catch (err) {
    const isAbort = err?.name === 'AbortError' || err?.name === 'TimeoutError' || String(err?.message || '').toLowerCase().includes('abort');
    if (isAbort) {
      const msg = String(err?.message || '');
      if (msg && !msg.toLowerCase().includes('abort') && !msg.toLowerCase().includes('without reason')) {
        throw new Error(msg);
      }
      throw new Error('The request timed out or was interrupted. The server may still be updating Google Sheets in the background.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function toast(message, isError = false) {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${isError ? 'error' : ''}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// =========================================================================
// Session Inactivity Watcher (Auto-Logout after 15 minutes of inactivity)
// =========================================================================
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes of inactivity
const INACTIVITY_WARNING_MS = 14 * 60 * 1000; // 14 minutes (60-second countdown warning)
const INACTIVITY_STORAGE_KEY = 'salig_last_activity';
const INACTIVITY_CHECK_INTERVAL_MS = 1000;    // Check every second for accurate countdown and prompt response

const getInactivityTimeoutMs = () =>
  (typeof window !== 'undefined' && Number(window.__SALIG_INACTIVITY_TIMEOUT_MS__)) ||
  INACTIVITY_TIMEOUT_MS;
const getInactivityWarningMs = () =>
  (typeof window !== 'undefined' && Number(window.__SALIG_INACTIVITY_WARNING_MS__)) ||
  INACTIVITY_WARNING_MS;

let inactivityCheckTimer = null;
let lastUserActivityTs = Date.now();
let lastThrottledRecordTs = 0;
let isInactivityWarningVisible = false;
let inactivityListenersAttached = false;

function recordUserActivity(fromRemote = false) {
  const now = Date.now();
  lastUserActivityTs = now;
  if (isInactivityWarningVisible) {
    closeInactivityWarningModal();
  }
  if (!fromRemote && now - lastThrottledRecordTs > 1500) {
    lastThrottledRecordTs = now;
    try {
      localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now));
    } catch (_) {}
  }
}

function handleUserActivityEvent(e) {
  if (!appState.currentUser) return;
  // If user explicitly clicked "Log Out Now", do not intercept with activity reset
  if (e?.target?.closest && e.target.closest('#btn-inactivity-logout')) return;
  recordUserActivity(false);
}

function attachInactivityEventListeners() {
  if (inactivityListenersAttached || typeof window === 'undefined') return;
  inactivityListenersAttached = true;

  const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click', 'wheel'];
  activityEvents.forEach((evt) => {
    window.addEventListener(evt, handleUserActivityEvent, { passive: true });
  });

  // Cross-tab synchronization
  window.addEventListener('storage', (e) => {
    if (e.key === INACTIVITY_STORAGE_KEY && e.newValue) {
      const remoteTs = Number(e.newValue);
      if (remoteTs > lastUserActivityTs) {
        lastUserActivityTs = remoteTs;
        if (isInactivityWarningVisible) {
          closeInactivityWarningModal();
        }
      }
    }
  });

  // When tab becomes visible again or gains focus, check elapsed idle time immediately
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && appState.currentUser) {
      checkInactivityStatus();
    }
  });
  window.addEventListener('focus', () => {
    if (appState.currentUser) {
      checkInactivityStatus();
    }
  });

  // Wire buttons inside warning modal
  document.getElementById('btn-inactivity-stay')?.addEventListener('click', () => {
    recordUserActivity(false);
    closeInactivityWarningModal();
    toast('Session active: Inactivity timer reset.');
  });
  document.getElementById('btn-inactivity-logout')?.addEventListener('click', () => {
    performLogout({ reason: 'manual' });
  });
}

function getLastKnownActivityTime() {
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(INACTIVITY_STORAGE_KEY) || 0);
  } catch (_) {}
  return Math.max(lastUserActivityTs, stored);
}

function checkInactivityStatus() {
  if (!appState.currentUser) return;
  const now = Date.now();
  const lastActive = getLastKnownActivityTime();
  const idleMs = now - lastActive;
  const timeoutMs = getInactivityTimeoutMs();
  const warningMs = getInactivityWarningMs();

  if (idleMs >= timeoutMs) {
    closeInactivityWarningModal();
    performLogout({ reason: 'inactivity' });
    return;
  }

  if (idleMs >= warningMs) {
    const remainingSeconds = Math.max(1, Math.ceil((timeoutMs - idleMs) / 1000));
    showInactivityWarningModal(remainingSeconds);
  } else if (isInactivityWarningVisible) {
    closeInactivityWarningModal();
  }
}

function showInactivityWarningModal(remainingSeconds) {
  if (!appState.currentUser) {
    closeInactivityWarningModal();
    return;
  }
  isInactivityWarningVisible = true;
  const modalEl = document.getElementById('inactivity-warning-modal');
  if (modalEl) {
    modalEl.classList.remove('hidden');
    const countEl = document.getElementById('inactivity-countdown-number');
    if (countEl) {
      countEl.textContent = `${remainingSeconds}s`;
      countEl.classList.toggle('urgent', remainingSeconds <= 15);
    }
  }
}

function closeInactivityWarningModal() {
  isInactivityWarningVisible = false;
  const modalEl = document.getElementById('inactivity-warning-modal');
  if (modalEl) {
    modalEl.classList.add('hidden');
  }
}

function startInactivityWatcher() {
  stopInactivityWatcher();
  attachInactivityEventListeners();
  const now = Date.now();
  lastUserActivityTs = now;
  try {
    localStorage.setItem(INACTIVITY_STORAGE_KEY, String(now));
  } catch (_) {}
  inactivityCheckTimer = setInterval(checkInactivityStatus, INACTIVITY_CHECK_INTERVAL_MS);
}

function stopInactivityWatcher() {
  if (inactivityCheckTimer) {
    clearInterval(inactivityCheckTimer);
    inactivityCheckTimer = null;
  }
  closeInactivityWarningModal();
}

/** Global user logout handler with support for clean manual and inactivity triggers. */
async function performLogout(options = {}) {
  const { reason = 'manual' } = options;
  stopAutoSync();
  stopInactivityWatcher();
  try {
    localStorage.removeItem(INACTIVITY_STORAGE_KEY);
  } catch (_) {}
  closeInactivityWarningModal();
  closeModal();

  try {
    if (reason === 'inactivity') {
      await api('/api/auth/logout', {
        method: 'POST',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(1200)
          : undefined
      }).catch(() => null);
    } else {
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
    }
  } finally {
    appState.usersList = [];
    appState.pendingUserCount = 0;
    appState.view = 'dashboard';
    const message =
      reason === 'inactivity'
        ? 'You have been automatically logged out after 15 minutes of inactivity.'
        : 'You have logged out cleanly.';
    const tone = reason === 'inactivity' ? 'warning' : 'info';
    showAuthScreen(message, tone, 'login');
    syncCurrentUserUi();
    hideLoadingOverlay(true);
  }
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
  const optoolCountEl = document.getElementById('nav-optool-count');
  if (optoolCountEl) optoolCountEl.textContent = (appState.state.optool?.Database || []).length;
  const cfCountEl = document.getElementById('nav-cf-count');
  if (cfCountEl) cfCountEl.textContent = (appState.state.optool?.['CF(DOC)'] || []).length;
  const surveyCountEl = document.getElementById('nav-survey-count');
  if (surveyCountEl) surveyCountEl.textContent = (appState.state.optool?.Survey || []).length;
  const movCountEl = document.getElementById('nav-mov-count');
  if (movCountEl) movCountEl.textContent = (appState.state.optool?.MOV || []).length;
  const regdistCountEl = document.getElementById('nav-regdist-count');
  if (regdistCountEl) regdistCountEl.textContent = (appState.state.optool?.RegistrationDistribution || []).length;
  const instCountEl = document.getElementById('nav-installation-count');
  if (instCountEl) instCountEl.textContent = (appState.state.optool?.Installation || []).length;
  const leaseholdCountEl = document.getElementById('nav-leasehold-count');
  if (leaseholdCountEl) leaseholdCountEl.textContent = (appState.state.leasehold || []).length;
}

function updateHeaderTitles() {
  const scopeLabel = appState.provinceScope
    ? `${appState.provinceScope.provinceName} (${appState.provinceScope.code})`
    : 'Region VIII';
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
      `${scopeLabel} Milestone_Data Ledger`,
      `Standardized ${scopeLabel} Schema • Auto-Index (PROV-YYYYMM-XXXX) • LGU Master List Validation`
    ],
    optool: [
      appState.provinceScope
        ? `Optool Support List(tagging of Target) — ${scopeLabel}`
        : 'Optool Support List(tagging of Target)',
      appState.provinceScope
        ? `SALIG (LAD Database) Support List • ${scopeLabel} Records Only`
        : 'SALIG (LAD Database) Master Support List • Tagging of Milestone Targets'
    ],
    'target-summary': [
      'Region VIII Target Summary',
      'Physical Accomplishment per Milestone vs Regional NEP Targets & Quarterly Performance (All Region VIII Provinces)'
    ],
    'cf-whereabouts': [
      `${scopeLabel} CF Whereabouts & Date Summary`,
      'Claim Folder (CF) Tracking • Date FI Conducted • Date Prepared & Signed • Reported Month'
    ],
    'survey-whereabouts': [
      `${scopeLabel} Survey Whereabouts & Milestone Tracking`,
      'Land Survey Tracking • Field Work Dates • SR Forwarded • DENR-SMD Acceptance • ASP Date • Reported Month'
    ],
    'mov-whereabouts': [
      `${scopeLabel} Land Valuation Whereabouts`,
      'Memorandum of Valuation Tracking • PPU Date • Received at DARPO • Date of MOV • Transmitted to LBP/AOC • Reported Month'
    ],
    'regdist-whereabouts': [
      `${scopeLabel} Registration & Distribution Whereabouts`,
      'EP CLOA Registration & Distribution Tracking • Date Registered • Date of Distribution • Month Reported'
    ],
    'installation-whereabouts': [
      `${scopeLabel} Installation Whereabouts & Milestone Tracking`,
      'Physical Installation Tracking • Date Registered • Date Distributed • Date of Installation • Month Reported'
    ],
    nep: [
      'Regional Hub NEP Targets & Sheet',
      'Province allocations (LHS, AREA, ARBs, Year) and Regional Milestone Targets'
    ],
    leasehold: [
      `${scopeLabel} Leasehold Operations & Ledger`,
      'Agricultural Leasehold Contracts & Records • Landholdings, Profiles & Tenurial Arrangements'
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
    nepExpandedAccompSems: appState.nepExpandedAccompSems !== undefined ? Boolean(appState.nepExpandedAccompSems) : true,
    nepShowProvinces: Boolean(appState.nepShowProvinces),
    nepExpandedMilestones: appState.nepExpandedMilestones || {},
    nepYearFilter: appState.nepYearFilter,
    nepMilestoneFilter: appState.nepMilestoneFilter || 'overall',
    nepMilestoneTableFilter: appState.nepMilestoneTableFilter || 'ALL',
    nepDisplayMode: appState.nepDisplayMode || 'table',
    nepColVisibility: appState.nepColVisibility || { lhs: true, area: true, arbs: true },
    filters: appState.filters,
    activeOptoolTab: appState.activeOptoolTab,
    dashboardMapProvince: appState.dashboardMapProvince || 'ALL',
    dashboardRightPanelTab: appState.dashboardRightPanelTab || 'map'
  };

  if (appState.view !== 'users') {
    stopUsersAutoPoll();
  }

  if (appState.view === 'dashboard') {
    container.innerHTML = renderDashboardView(ctx);
    bindDashboardViewEvents(container);
  } else if (appState.view === 'target-summary') {
    container.innerHTML = renderTargetSummaryView(ctx);
    bindDashboardViewEvents(container);
  } else if (appState.view === 'cf-whereabouts') {
    appState.activeOptoolTab = 'CF(DOC)';
    container.innerHTML = renderCfWhereaboutsView({
      ...ctx,
      activeOptoolTab: 'CF(DOC)',
      cfSurveyFilter: appState.cfSurveyFilter || 'ALL',
      searchTerm: appState.optoolSearch || '',
      optoolSearch: appState.optoolSearch || '',
      optoolColMode: appState.optoolColMode || 'preview',
      optoolPage: appState.optoolPage || 1,
      optoolPageSize: appState.optoolPageSize || 50,
      optoolColPage: appState.optoolColPage || 1,
      optoolColFilters: appState.optoolColFilters || {},
      whereaboutsSearch: appState.whereaboutsSearch,
      whereaboutsProvinceFilter: appState.whereaboutsProvinceFilter,
      whereaboutsStatusFilter: appState.whereaboutsStatusFilter,
      whereaboutsTargetYearFilter: appState.whereaboutsTargetYearFilter,
      whereaboutsColFilters: appState.whereaboutsColFilters,
      whereaboutsShowGraph: appState.whereaboutsShowGraph,
      whereaboutsGraphMode: appState.whereaboutsGraphMode,
      whereaboutsPage: appState.whereaboutsPage,
      whereaboutsPageSize: appState.whereaboutsPageSize,
      cfMetricMode: appState.cfMetricMode || 'both',
      cfTableLayout: appState.cfTableLayout || 'standard'
    });
    bindWhereaboutsEvents(container, 'cf-whereabouts');
  } else if (appState.view === 'survey-whereabouts') {
    appState.activeOptoolTab = 'Survey';
    container.innerHTML = renderSurveyWhereaboutsView({
      ...ctx,
      activeOptoolTab: 'Survey',
      searchTerm: appState.optoolSearch || '',
      optoolSearch: appState.optoolSearch || '',
      optoolColMode: appState.optoolColMode || 'preview',
      optoolPage: appState.optoolPage || 1,
      optoolPageSize: appState.optoolPageSize || 50,
      optoolColPage: appState.optoolColPage || 1,
      optoolColFilters: appState.optoolColFilters || {},
      whereaboutsSearch: appState.whereaboutsSearch,
      whereaboutsProvinceFilter: appState.whereaboutsProvinceFilter,
      whereaboutsStatusFilter: appState.whereaboutsStatusFilter,
      whereaboutsTargetYearFilter: appState.whereaboutsTargetYearFilter,
      whereaboutsColFilters: appState.whereaboutsColFilters,
      whereaboutsShowGraph: appState.whereaboutsShowGraph,
      whereaboutsGraphMode: appState.whereaboutsGraphMode,
      whereaboutsPage: appState.whereaboutsPage,
      whereaboutsPageSize: appState.whereaboutsPageSize,
      surveyMetricMode: appState.surveyMetricMode || 'both',
      surveyIndicatorTab: appState.surveyIndicatorTab || 'all',
      surveyMatrixMode: appState.surveyMatrixMode || 'active'
    });
    bindWhereaboutsEvents(container, 'survey-whereabouts');
  } else if (appState.view === 'mov-whereabouts') {
    appState.activeOptoolTab = 'MOV';
    container.innerHTML = renderMovWhereaboutsView({
      ...ctx,
      activeOptoolTab: 'MOV',
      searchTerm: appState.optoolSearch || '',
      optoolSearch: appState.optoolSearch || '',
      optoolColMode: appState.optoolColMode || 'preview',
      optoolPage: appState.optoolPage || 1,
      optoolPageSize: appState.optoolPageSize || 50,
      optoolColPage: appState.optoolColPage || 1,
      optoolColFilters: appState.optoolColFilters || {},
      whereaboutsSearch: appState.whereaboutsSearch,
      whereaboutsProvinceFilter: appState.whereaboutsProvinceFilter,
      whereaboutsStatusFilter: appState.whereaboutsStatusFilter,
      whereaboutsTargetYearFilter: appState.whereaboutsTargetYearFilter,
      whereaboutsColFilters: appState.whereaboutsColFilters,
      whereaboutsShowGraph: appState.whereaboutsShowGraph,
      whereaboutsGraphMode: appState.whereaboutsGraphMode,
      whereaboutsPage: appState.whereaboutsPage,
      whereaboutsPageSize: appState.whereaboutsPageSize,
      cfMetricMode: appState.whereaboutsMetricMode?.['mov-whereabouts'] || appState.cfMetricMode || 'both',
      cfTableLayout: appState.whereaboutsTableLayout?.['mov-whereabouts'] || appState.cfTableLayout || 'standard'
    });
    bindWhereaboutsEvents(container, 'mov-whereabouts');
  } else if (appState.view === 'regdist-whereabouts') {
    appState.activeOptoolTab = 'RegistrationDistribution';
    container.innerHTML = renderRegDistWhereaboutsView({
      ...ctx,
      activeOptoolTab: 'RegistrationDistribution',
      searchTerm: appState.optoolSearch || '',
      optoolSearch: appState.optoolSearch || '',
      optoolColMode: appState.optoolColMode || 'preview',
      optoolPage: appState.optoolPage || 1,
      optoolPageSize: appState.optoolPageSize || 50,
      optoolColPage: appState.optoolColPage || 1,
      optoolColFilters: appState.optoolColFilters || {},
      whereaboutsSearch: appState.whereaboutsSearch,
      whereaboutsProvinceFilter: appState.whereaboutsProvinceFilter,
      whereaboutsStatusFilter: appState.whereaboutsStatusFilter,
      whereaboutsTargetYearFilter: appState.whereaboutsTargetYearFilter,
      whereaboutsColFilters: appState.whereaboutsColFilters,
      whereaboutsShowGraph: appState.whereaboutsShowGraph,
      whereaboutsGraphMode: appState.whereaboutsGraphMode,
      whereaboutsPage: appState.whereaboutsPage,
      whereaboutsPageSize: appState.whereaboutsPageSize,
      cfMetricMode: appState.whereaboutsMetricMode?.['regdist-whereabouts'] || appState.cfMetricMode || 'both',
      cfTableLayout: appState.whereaboutsTableLayout?.['regdist-whereabouts'] || appState.cfTableLayout || 'standard'
    });
    bindWhereaboutsEvents(container, 'regdist-whereabouts');
  } else if (appState.view === 'installation-whereabouts') {
    appState.activeOptoolTab = 'Installation';
    container.innerHTML = renderInstallationWhereaboutsView({
      ...ctx,
      activeOptoolTab: 'Installation',
      searchTerm: appState.optoolSearch || '',
      optoolSearch: appState.optoolSearch || '',
      optoolColMode: appState.optoolColMode || 'preview',
      optoolPage: appState.optoolPage || 1,
      optoolPageSize: appState.optoolPageSize || 50,
      optoolColPage: appState.optoolColPage || 1,
      optoolColFilters: appState.optoolColFilters || {},
      whereaboutsSearch: appState.whereaboutsSearch,
      whereaboutsProvinceFilter: appState.whereaboutsProvinceFilter,
      whereaboutsStatusFilter: appState.whereaboutsStatusFilter,
      whereaboutsTargetYearFilter: appState.whereaboutsTargetYearFilter,
      whereaboutsColFilters: appState.whereaboutsColFilters,
      whereaboutsShowGraph: appState.whereaboutsShowGraph,
      whereaboutsGraphMode: appState.whereaboutsGraphMode,
      whereaboutsPage: appState.whereaboutsPage,
      whereaboutsPageSize: appState.whereaboutsPageSize,
      cfMetricMode: appState.whereaboutsMetricMode?.['installation-whereabouts'] || appState.cfMetricMode || 'both',
      cfTableLayout: appState.whereaboutsTableLayout?.['installation-whereabouts'] || appState.cfTableLayout || 'standard'
    });
    bindWhereaboutsEvents(container, 'installation-whereabouts');
  } else if (appState.view === 'leasehold') {
    container.innerHTML = renderLeaseholdView({
      ...ctx,
      leaseholdSearch: appState.leaseholdSearch,
      leaseholdProvinceFilter: appState.leaseholdProvinceFilter,
      leaseholdStatusFilter: appState.leaseholdStatusFilter,
      leaseholdTargetYearFilter: appState.leaseholdTargetYearFilter,
      leaseholdPage: appState.leaseholdPage || 1,
      leaseholdPageSize: appState.leaseholdPageSize || 25
    });
    bindLeaseholdEvents(container);
  } else if (appState.view === 'nep') {
    container.innerHTML = renderNepView(ctx);
    bindDashboardViewEvents(container);
  } else if (appState.view === 'milestones') {
    container.innerHTML = renderMilestonesView({ ...ctx, searchTerm: appState.msSearch });
    bindMilestonesViewEvents(container);
  } else if (appState.view === 'optool') {
    appState.activeOptoolTab = 'Database';
    container.innerHTML = renderOptoolView({
      ...ctx,
      ...getOptoolFilterContext(),
      view: 'optool',
      activeOptoolTab: 'Database'
    });
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
    startUsersAutoPoll();
  } else if (appState.view === 'audit-logs') {
    stopUsersAutoPoll();
    if (appState.currentUser?.role !== 'admin') {
      appState.view = 'dashboard';
      renderActiveView();
      return;
    }
    container.innerHTML = renderAuditLogsView({
      logs: appState.auditLogs || [],
      total: appState.auditLogsTotal || 0,
      filters: appState.auditLogsFilters || {},
      currentUser: appState.currentUser
    });
    bindAuditLogsEvents(container);
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
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetView = btn.dataset.nav;
      appState.view = targetView;
      if (appState.view === 'optool') {
        appState.activeOptoolTab = 'Database';
      }
      if (btn.dataset.navProvince) {
        const provCode = btn.dataset.navProvince;
        if (provCode === 'ALL') {
          appState.whereaboutsProvinceFilter[targetView] = 'ALL';
          if (appState.whereaboutsColFilters[targetView]) {
            delete appState.whereaboutsColFilters[targetView].province;
          }
        } else {
          const provNodes = appState.schemas?.registry?.filter((n) => n.role === 'Provincial Node') || [];
          const node = provNodes.find((p) => p.code === provCode);
          const provName = node ? node.provinceName : provCode;
          appState.whereaboutsProvinceFilter[targetView] = provName;
          if (!appState.whereaboutsColFilters[targetView]) {
            appState.whereaboutsColFilters[targetView] = {};
          }
          appState.whereaboutsColFilters[targetView].province = { mode: 'exact', value: provName };
        }
      }
      if (btn.dataset.navSurvey) {
        appState.cfSurveyFilter = btn.dataset.navSurvey;
      }
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
        if (res.state) {
          appState.state = res.state;
        } else if (res.milestoneData) {
          appState.state.milestoneData = res.milestoneData;
        }
        if (res.analytics) {
          appState.analytics = res.analytics;
        } else {
          await refreshAnalytics();
        }
        renderActiveView();
        toast(`Deleted ${id}${formatGasPushSuffix(res)}`);
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

  container.querySelector('#optool-cf-survey-filter')?.addEventListener('change', (e) => {
    appState.cfSurveyFilter = e.target.value;
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
    appState.cfSurveyFilter = 'ALL';
    appState.optoolPage = 1;
    renderActiveView();
  });

  bindOptoolPagerEvents(container);

  container.querySelector('#btn-optool-add')?.addEventListener('click', () => {
    const tab = appState.view === 'optool' ? 'Database' : (appState.activeOptoolTab || 'Database');
    openOptoolModal(tab, null, null);
  });

  container.querySelector('#btn-sync-provincial-optool')?.addEventListener('click', async () => {
    try {
      const res = await withLoading(
        'syncing',
        'Syncing from Provincial Google Sheets…',
        'Pulling CF(DOC), Survey, MOV, Registration, and Installation directly from all provincial sheets…',
        () => api('/api/sync/provincial-optool', { method: 'POST' })
      );
      if (res && res.state) {
        appState.state = { ...appState.state, ...res.state };
      }
      if (res && res.analytics) {
        appState.analytics = res.analytics;
      }
      toast(
        `Successfully synced ${res.totalImported || 0} records directly from Provincial Google Sheets!`
      );
      renderActiveView();
    } catch (err) {
      toast(`Sync failed: ${err.message}`, true);
    }
  });

  container.querySelector('#btn-optool-export-csv')?.addEventListener('click', () => {
    exportOptoolSupportlistCsv();
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
      const tabName = appState.view === 'optool' ? 'Database' : (appState.activeOptoolTab || 'Database');
      const row = appState.state.optool[tabName]?.[idx];
      if (row) openOptoolModal(tabName, row, idx);
      return;
    }

    const delBtn = e.target.closest('[data-del-optool]');
    if (delBtn) {
      const idx = Number(delBtn.dataset.delOptool);
      const tabName = appState.view === 'optool' ? 'Database' : (appState.activeOptoolTab || 'Database');
      if (!confirm(`Delete row #${idx + 1} from ${tabName}?`)) return;
      try {
        const res = await withLoading(
          'saving',
          'Deleting OPTool Record…',
          `Removing row from ${tabName} & syncing Google Sheet…`,
          () =>
            api(
              `/api/optool/${encodeURIComponent(tabName)}/${idx}`,
              { method: 'DELETE' }
            )
        );
        if (res.state) {
          appState.state = res.state;
        } else if (res.optool) {
          appState.state.optool = res.optool;
        } else if (res.rows) {
          appState.state.optool[tabName] = res.rows;
        }
        if (res.analytics) {
          appState.analytics = res.analytics;
        } else {
          await refreshAnalytics();
        }
        const remainingRows = appState.state.optool[tabName] || [];
        const pageSize = Number(appState.optoolPageSize) || 50;
        const maxPages = Math.max(1, Math.ceil(remainingRows.length / pageSize));
        if (appState.optoolPage > maxPages) {
          appState.optoolPage = maxPages;
        }
        renderActiveView();
        toast(`Deleted row from ${tabName}${formatGasPushSuffix(res)}`);
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
      const tabName = appState.view === 'optool' ? 'Database' : (appState.activeOptoolTab || 'Database');
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
      const tabName = appState.view === 'optool' ? 'Database' : (appState.activeOptoolTab || 'Database');
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

  container.querySelector('#btn-setup-drive-folders')?.addEventListener('click', async () => {
    try {
      const res = await withLoading(
        'saving',
        'Setting Up Google Drive Folders…',
        'Creating & verifying provincial and milestone folders in Google Drive…',
        () =>
          api('/api/drive/setup-folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rootFolderId: '1z7SycuDvk9M5pPDZ2IvhwebQDsGHOhsJ' })
          })
      );
      toast('Google Drive milestone folders verified & ready!');
      const summaryEl = document.getElementById('drive-folders-summary');
      if (summaryEl && res.provinces) {
        summaryEl.innerHTML = `
          <p style="margin:0 0 12px 0;font-size:13px;color:var(--text-muted)">
            Verified Root Storage: <a href="${esc(res.rootFolderUrl || 'https://drive.google.com/drive/folders/1z7SycuDvk9M5pPDZ2IvhwebQDsGHOhsJ')}" target="_blank" rel="noopener noreferrer" class="mono font-semibold">${esc(res.rootFolderId || '1z7SycuDvk9M5pPDZ2IvhwebQDsGHOhsJ')}</a>.
            All 6 provinces &amp; 5 milestone subfolders are confirmed active.
          </p>
          <div class="grid-3" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;">
            ${Object.values(res.provinces).map(p => `
              <div style="border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--surface);">
                <div style="font-weight:700;color:var(--dar-green-dark,#09341b);display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                  <span>📁</span> <a href="${esc(p.folderUrl)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;">${esc(p.name)} ↗</a>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;font-size:11px;">
                  ${Object.values(p.milestones || {}).map(m => `
                    <a href="${esc(m.folderUrl)}" target="_blank" rel="noopener noreferrer" class="badge badge-gray" style="text-decoration:none;" title="Open ${esc(m.name)} folder">${esc(m.name)} ↗</a>
                  `).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }
    } catch (err) {
      toast(err.message, true);
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

    // Automatically sync provincial milestone supportlists directly from each provincial Google Sheet
    try {
      const provRes = await api('/api/sync/provincial-optool', { method: 'POST', signal });
      if (provRes && provRes.ok) {
        if (provRes.state) appState.state = { ...appState.state, ...provRes.state };
        if (provRes.analytics) appState.analytics = provRes.analytics;
      }
    } catch (_) {}

    appState.state.dataSourceMode = 'live';
    updateNavCounts();
    updateStatusBanner();

    if (!quiet || !isUserActivelyEditing()) {
      await refreshAnalytics();
      if (!isUserActivelyEditing()) {
        renderActiveView();
      }
    }
    const synced = (res.results || []).filter((r) => r.status === 'synced').length;
    const restricted = (res.results || []).filter((r) => r.status === 'unauthorized').length;
    if (!quiet) {
      toast(`Checked 7 sheets: ${synced} reachable (${res.totalImported} rows imported), ${restricted} restricted (401).`);
    } else if (res.totalImported > 0) {
      toast(`Auto-synced ${res.totalImported} rows across ${synced}/7 Google Sheets`);
    }
  } catch (err) {
    const isAbort = err?.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('abort');
    if (!quiet && !isAbort) toast(err.message, true);
  } finally {
    autoSyncAbortController = null;
    if (!quiet) hideLoadingOverlay();
    isAutoSyncRunning = false;
  }
}

function maybeAutoSyncGoogleSheets(force = false) {
  if (!appState.currentUser) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const lastSyncMs = appState.state?.lastSyncAt ? Date.parse(appState.state.lastSyncAt) : 0;
  const isStale = force || !lastSyncMs || Number.isNaN(lastSyncMs) || Date.now() - lastSyncMs > AUTO_SYNC_MAX_AGE_MS;
  if (isStale) {
    syncAllNodes('merge', { quiet: true });
  }
}

let visibilityListenerAttached = false;
function startAutoSyncLoop() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !isUserActivelyEditing()) {
      syncAllNodes('merge', { quiet: true });
    }
  }, AUTO_SYNC_INTERVAL_MS);

  if (!visibilityListenerAttached && typeof document !== 'undefined') {
    visibilityListenerAttached = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !isUserActivelyEditing()) {
        maybeAutoSyncGoogleSheets();
      }
    });
  }
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
    const boot = await api(`/api/bootstrap?milestoneYear=${encodeURIComponent(appState.filters?.milestoneYear || '2027')}`);
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
  if (appState.view === 'dashboard' || appState.view === 'target-summary') {
    params.set('view', appState.view);
  }
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

function exportOptoolSupportlistCsv() {
  const currentTab = appState.view === 'optool' ? 'Database' : (appState.activeOptoolTab || 'Database');
  const { csvText, filename, rowCount } = generateOptoolSupportListCsv({
    state: appState.state,
    schemas: appState.schemas,
    activeOptoolTab: currentTab,
    searchTerm: appState.optoolSearch,
    optoolTargetFilter: appState.optoolTargetFilter,
    cfSurveyFilter: appState.cfSurveyFilter,
    optoolColFilters: appState.optoolColFilters,
    optoolPage: 1,
    optoolPageSize: 'ALL',
    optoolColMode: 'all',
    optoolColPage: 1,
    filters: appState.filters,
    provinceScope: appState.provinceScope
  });

  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast(`Exported ${rowCount} ${currentTab} supportlist record(s) to CSV`);
}

// Modals
function showModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title;
  const bodyEl = document.getElementById('modal-body');
  bodyEl.innerHTML = bodyHtml;
  bodyEl.classList.toggle('has-modal-form', Boolean(bodyEl.querySelector(':scope > .modal-form')));
  document.getElementById('modal-backdrop').classList.remove('hidden');
}

function showFormModal(title, { formId, contentHtml, bodyHtml, cancelId, submitLabel, extraActionsHtml }) {
  const modalContent = contentHtml !== undefined ? contentHtml : bodyHtml !== undefined ? bodyHtml : '';
  showModal(
    title,
    `
      <form id="${esc(formId)}" class="modal-form">
        <div class="modal-scroll">${modalContent}</div>
        <div class="form-actions">
          ${extraActionsHtml || ''}
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
      renderActiveView();
      toast(`Saved ${res.record.Record_ID}${formatGasPushSuffix(res)}`);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function findDatabaseRowByLhid(lhid) {
  const key = String(lhid ?? '').trim().toLowerCase();
  if (!key) return null;
  const cleanKey = formatLhidDisplay(lhid).toLowerCase();
  const dbRows = appState.state?.optool?.Database || [];
  return (
    dbRows.find((r) => {
      const rKey = String(r.lhid ?? '').trim().toLowerCase();
      const rClean = formatLhidDisplay(r.lhid).toLowerCase();
      return rKey === key || rClean === cleanKey || rKey === cleanKey || rClean === key;
    }) || null
  );
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
  // Rescue year mistakenly placed in pdfFile or any PDF-labeled field for Survey, MOV, CF(DOC), etc.
  if (existingRow && typeof existingRow === 'object') {
    for (const [k, v] of Object.entries(existingRow)) {
      if (typeof v === 'string' || typeof v === 'number') {
        const strV = String(v).trim();
        const ym = strV.replace(/\.0+$/, '').match(/^(20\d{2})$/);
        const kNorm = k.toLowerCase().replace(/[^a-z]/g, '');
        if (ym && (kNorm.includes('pdf') || kNorm.includes('transmittal') || kNorm === 'l')) {
          if (!existingRow.targetYear || String(existingRow.targetYear).trim() === '') {
            existingRow.targetYear = ym[1];
          }
          existingRow[k] = '';
        }
      }
    }
  }
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
      if (['targetYear', 'year', 'pipelineYear', 'reportYear'].includes(c.key)) {
        val = formatYearDisplay(val);
      }
      if (supportsAutoReportedMonth && isReportedMonthKey(c.key)) {
        if (String(val).trim() === '') {
          val = formatCurrentMonthYear();
        } else {
          val = formatReportedMonthWord(val) || val;
        }
      } else if (isReportedMonthKey(c.key) && val) {
        val = formatReportedMonthWord(val) || val;
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
        const isMonth = isReportedMonthKey(c.key);
        if (isMonth && val) {
          const wordVal = formatReportedMonthWord(val);
          if (wordVal) val = wordVal;
        }
        const opts = isMonth ? getReportedMonthOptions() : [...c.options];
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
      if (c.key === 'pdfFile' || c.key === 'transmittalSrPdf' || c.type === 'pdfFile' || (c.label && c.label.toLowerCase().includes('pdf'))) {
        const strVal = String(val ?? '').trim();
        const isYearString = /^(20\d{2})(\.0+)?$/.test(strVal);
        const isYearNum = typeof val === 'number' && val >= 2000 && val <= 2099;
        const effectiveVal = (isYearString || isYearNum) ? '' : val;
        const isPdfAttached = effectiveVal && typeof effectiveVal === 'string' && (effectiveVal.startsWith('http') || effectiveVal.startsWith('/api/pdf/') || effectiveVal.startsWith('/uploads/') || effectiveVal.startsWith('data:application/pdf') || effectiveVal.toLowerCase().endsWith('.pdf'));
        const isMarkedYes = effectiveVal === 'Yes' || effectiveVal === true || effectiveVal === 'true';
        const displayVal = isPdfAttached ? effectiveVal : (isMarkedYes ? '' : effectiveVal);
        return `
          ${groupHtml}
          <div class="${fieldClass}">
            <label for="opt-${esc(c.key)}" style="display:flex;align-items:center;justify-content:space-between;">
              <span>${esc(c.label)}</span>
              ${isMarkedYes && !isPdfAttached ? `<span class="badge badge-blue" style="font-size:11px;padding:1px 6px;">✔ Marked in Checklist</span>` : ''}
            </label>
            <div class="form-control-merged">
              <input id="opt-${esc(c.key)}" name="${esc(c.key)}" type="text" class="form-control-inner" value="${esc(displayVal)}" placeholder="https://drive.google.com/... or data:..." />
              <button type="button" class="btn-modal-upload-pdf" data-upload-pdf-tab="${esc(tabName)}" data-upload-pdf-idx="${isEdit ? rowIndex : -1}" data-upload-pdf-col="${esc(c.key)}" title="Upload PDF">
                📎 Upload PDF
              </button>
              ${isPdfAttached ? `<a href="${esc(normalizePdfUrl(effectiveVal))}" target="_blank" rel="noopener noreferrer" class="pdf-link-merged pdf-link" title="${esc(effectiveVal)}">📄 View</a>` : ''}
            </div>
          </div>${linkedAfterLhid}
        `;
      }
      if (c.key === 'targetYear' || c.key === 'year') {
        const yrVal = formatYearDisplay(val);
        return `
          ${groupHtml}
          <div class="${fieldClass}">
            <label for="opt-${esc(c.key)}">${esc(c.label)} (Enter Year)</label>
            <input
              id="opt-${esc(c.key)}"
              name="${esc(c.key)}"
              type="text"
              class="form-control"
              value="${esc(yrVal)}"
              placeholder="e.g. 2026"
            />
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

  const viewWorksheetBtnHtml = isEdit && existingRow?.lhid
    ? `<button type="button" class="btn btn-outline-secondary btn-sm" id="opt-switch-worksheet" style="margin-right:auto;">📊 Open in ${esc(tabName)} Worksheet</button>`
    : '';

  showFormModal(`${isEdit ? 'Edit' : 'Add'} ${tabName} Row`, {
    formId: 'optool-form',
    cancelId: 'opt-cancel',
    submitLabel: isEdit ? 'Save Changes' : 'Add Row',
    extraActionsHtml: viewWorksheetBtnHtml,
    contentHtml: `<div class="form-grid">${fieldsHtml}</div>`
  });

  document.getElementById('opt-switch-worksheet')?.addEventListener('click', () => {
    closeModal();
    appState.activeOptoolTab = tabName;
    if (existingRow?.lhid) {
      appState.optoolSearch = formatLhidDisplay(existingRow.lhid);
    }
    appState.optoolPage = 1;
    appState.optoolColPage = 1;
    appState.view = 'optool';
    renderActiveView();
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
      const targetYearInput = document.getElementById('opt-targetYear');
      if (targetYearInput) {
        if (!targetYearInput.value || !isEdit) {
          const rawYr = dbRow?.year || dbRow?.targetYear || targetYearInput.value || '';
          targetYearInput.value = formatYearDisplay(rawYr);
        } else {
          targetYearInput.value = formatYearDisplay(targetYearInput.value);
        }
      }
      if (tabName === 'MOV') {
        const lotInput = document.getElementById('opt-lotNumber');
        const subLotInput = document.getElementById('opt-subLotNumber');
        if (lotInput && (!lotInput.value || !isEdit) && dbRow?.lotNumber) {
          lotInput.value = dbRow.lotNumber;
        }
        if (subLotInput && (!subLotInput.value || !isEdit) && dbRow?.subLotNumber) {
          subLotInput.value = dbRow.subLotNumber;
        }
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
      } else if (c.type === 'pdfFile' || c.key === 'pdfFile' || c.key === 'transmittalSrPdf') {
        const inputVal = formData.get(c.key) ?? '';
        if (inputVal === '' && (existingRow?.[c.key] === 'Yes' || existingRow?.[c.key] === true)) {
          row[c.key] = 'Yes';
        } else {
          row[c.key] = inputVal;
        }
      } else {
        let v = formData.get(c.key) ?? '';
        if (['targetYear', 'year', 'pipelineYear', 'reportYear'].includes(c.key)) {
          v = formatYearDisplay(v);
        } else if (isReportedMonthKey(c.key)) {
          v = formatReportedMonthWord(v) || v;
        }
        row[c.key] = v;
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
      renderActiveView();
      toast(`Saved row in ${tabName}${formatGasPushSuffix(res)}`);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openLeaseholdModal(existingRow, rowIndex) {
  const isEdit = existingRow !== null && existingRow !== undefined;
  const ctx = {
    provinceScope: appState.provinceScope,
    currentUser: appState.currentUser,
    schemas: appState.schemas
  };

  showFormModal(`${isEdit ? 'Edit' : 'Encode'} Leasehold Record`, {
    formId: 'leasehold-form',
    cancelId: 'lh-cancel',
    submitLabel: isEdit ? 'Save Changes' : 'Encode Record',
    contentHtml: renderLeaseholdModalHtml(existingRow, rowIndex, ctx)
  });

  const formEl = document.getElementById('leasehold-form');
  document.getElementById('lh-cancel')?.addEventListener('click', closeModal);

  formEl?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(formEl);
    const row = {};
    for (const [key, value] of formData.entries()) {
      row[key] = String(value ?? '').trim();
    }
    const idx = rowIndex !== null && rowIndex !== undefined ? rowIndex : (row.index !== '' ? Number(row.index) : null);

    try {
      const res = await withLoading(
        'saving',
        `${isEdit ? 'Updating' : 'Encoding'} Leasehold Record…`,
        'Persisting 34-field agricultural leasehold data…',
        () =>
          api('/api/leasehold', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ row, index: idx })
          })
      );
      if (res.leasehold) {
        appState.state.leasehold = res.leasehold;
      } else if (res.rows) {
        appState.state.leasehold = res.rows;
      }
      closeModal();
      updateNavCounts();
      renderActiveView();
      if (res.gasPushResult && res.gasPushResult.ok === false) {
        toast(`Leasehold saved, but Google Sheet sync failed: ${res.gasPushResult.error || 'Check GAS deployment'}`, true);
      } else {
        toast(`Successfully encoded Leasehold record for ${row.leaseholderSurname || 'Tenant'}, ${row.leaseholderFirstname || ''} and synced to Google Sheet!`);
      }
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
      renderActiveView();
      toast('Updated Region VIII cumulative baseline targets');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function bindNavLinks(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetView = btn.dataset.nav;
      appState.view = targetView;
      if (appState.view === 'optool') {
        appState.activeOptoolTab = 'Database';
      }
      if (btn.dataset.navProvince) {
        const provCode = btn.dataset.navProvince;
        if (provCode === 'ALL') {
          appState.whereaboutsProvinceFilter[targetView] = 'ALL';
          if (appState.whereaboutsColFilters[targetView]) {
            delete appState.whereaboutsColFilters[targetView].province;
          }
        } else {
          const provNodes = appState.schemas?.registry?.filter((n) => n.role === 'Provincial Node') || [];
          const node = provNodes.find((p) => p.code === provCode);
          const provName = node ? node.provinceName : provCode;
          appState.whereaboutsProvinceFilter[targetView] = provName;
          if (!appState.whereaboutsColFilters[targetView]) {
            appState.whereaboutsColFilters[targetView] = {};
          }
          appState.whereaboutsColFilters[targetView].province = { mode: 'exact', value: provName };
        }
      }
      if (btn.dataset.navSurvey) {
        appState.cfSurveyFilter = btn.dataset.navSurvey;
      }
      renderActiveView();
    });
  });
}

function updateDashboardMapSelection(container, code) {
  appState.dashboardMapProvince = code;

  // 1. Update active class on SVG province groups & paths for 3D elevation
  container.querySelectorAll('.ev-map-group').forEach((grp) => {
    const isThisProv = grp.dataset.mapProvince === code;
    grp.classList.toggle('is-active', isThisProv);
    if (code !== 'ALL') {
      grp.style.opacity = isThisProv ? '1' : '0.72';
    } else {
      grp.style.opacity = '1';
    }
  });

  container.querySelectorAll('.ev-map-province').forEach((path) => {
    const isThisProv = path.dataset.mapProvince === code;
    path.classList.toggle('is-active', isThisProv);
  });

  // 1b. Update backdrop dim layer for map focus
  const dimLayer = container.querySelector('.ev-map-dim-layer');
  if (dimLayer) {
    dimLayer.style.display = (code && code !== 'ALL') ? 'block' : 'none';
  }

  // 2. Update active class on quick pills
  container.querySelectorAll('[data-map-province-pill]').forEach((pill) => {
    const isAct = pill.dataset.mapProvincePill === code || (!code && pill.dataset.mapProvincePill === 'ALL');
    pill.classList.toggle('active', isAct);
  });

  // 3. Update the Target Breakdown card details (clean, original design preserved)
  const cardEl = container.querySelector('#dash-map-detail-card');
  if (cardEl && typeof window !== 'undefined' && window.__DASHBOARD_PROV_DATA__) {
    const { rows, totals } = window.__DASHBOARD_PROV_DATA__;
    cardEl.innerHTML = renderMapDetailCardInner(code, rows, totals);
    bindNavLinks(cardEl);
  }

  // 4. Update the section directly below the Provincial Breakdown table
  const tableDetailEl = container.querySelector('#dash-prov-table-detail');
  if (tableDetailEl && typeof window !== 'undefined' && window.__DASHBOARD_PROV_DATA__) {
    const { rows, state, schemas } = window.__DASHBOARD_PROV_DATA__;
    const mb = computeMilestoneWhereaboutsBreakdown(state, schemas, code);
    tableDetailEl.innerHTML = renderProvTableDetailHtml({
      breakdown: mb,
      selectedCode: code,
      provRows: rows
    });
    bindNavLinks(tableDetailEl);
    tableDetailEl.querySelector('[data-dash-reset-prov]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      updateDashboardMapSelection(container, 'ALL');
    });
  }

  // 5. Update the Whereabouts per Milestone section dynamically
  const whereaboutsEl = container.querySelector('#dash-milestone-whereabouts-container');
  if (whereaboutsEl && typeof window !== 'undefined' && window.__DASHBOARD_PROV_DATA__) {
    const { rows, state, schemas } = window.__DASHBOARD_PROV_DATA__;
    const mb = computeMilestoneWhereaboutsBreakdown(state, schemas, code);
    whereaboutsEl.innerHTML = renderMilestoneWhereaboutsSectionHtml({
      breakdown: mb,
      selectedCode: code,
      provRows: rows
    });
    bindNavLinks(whereaboutsEl);
    whereaboutsEl.querySelector('[data-dash-reset-prov]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      updateDashboardMapSelection(container, 'ALL');
    });
  }

  // 5. Highlight the corresponding table row in Provincial Breakdown
  const table = container.querySelector('.prov-breakdown-table');
  if (table) {
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const trCode = tr.dataset.provCode;
      if (code === 'ALL' || !code) {
        tr.classList.remove('tr-highlighted');
      } else {
        tr.classList.toggle('tr-highlighted', trCode === code);
      }
    });
  }
}

function bindDashboardViewEvents(container) {
  bindNavLinks(container);
  container.querySelector('[data-dash-reset-prov]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    updateDashboardMapSelection(container, 'ALL');
  });

  // Eastern Visayas Map & Target Breakdown Events (Click to select, click again to unselect)
  container.querySelectorAll('[data-map-province]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = el.dataset.mapProvince;
      const targetCode = (appState.dashboardMapProvince === code && code !== 'ALL') ? 'ALL' : code;
      updateDashboardMapSelection(container, targetCode);
    });
  });

  container.querySelectorAll('[data-map-province-pill]').forEach((pill) => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = pill.dataset.mapProvincePill;
      const targetCode = (appState.dashboardMapProvince === code && code !== 'ALL') ? 'ALL' : code;
      updateDashboardMapSelection(container, targetCode);
    });
  });

  container.querySelectorAll('.prov-breakdown-table tbody tr[data-prov-code]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const code = tr.dataset.provCode;
      const targetCode = (appState.dashboardMapProvince === code && code !== 'ALL') ? 'ALL' : code;
      updateDashboardMapSelection(container, targetCode);
    });
  });

  container.querySelectorAll('[data-dash-right-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.dashboardRightPanelTab = btn.dataset.dashRightTab;
      renderActiveView();
    });
  });
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

  container.querySelector('#btn-toggle-nep-accomp-sems')?.addEventListener('click', () => {
    appState.nepExpandedAccompSems = !Boolean(appState.nepExpandedAccompSems);
    renderActiveView();
  });

  container.querySelectorAll('[data-toggle-accomp-sems]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      appState.nepExpandedAccompSems = !appState.nepExpandedAccompSems;
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
      const tabName = btn.dataset.editTab || btn.dataset.openOptoolTab;
      const lhid = btn.dataset.editLhid || btn.dataset.filterLhid || btn.dataset.lhid;
      const rawIdx = btn.dataset.editRowIndex;

      // When clicked from a table row (has editRowIndex or editLhid), DIRECT TO THE EDIT ACTION!
      if ((rawIdx !== undefined && rawIdx !== '') || lhid) {
        const tabRows = appState.state?.optool?.[tabName] || [];
        let idx = rawIdx !== undefined && rawIdx !== '' ? Number(rawIdx) : -1;
        let row = idx >= 0 && tabRows[idx] ? tabRows[idx] : null;

        if (!row && lhid) {
          const cleanLhid = formatLhidDisplay(lhid).toLowerCase();
          const foundIdx = tabRows.findIndex(
            (r) => formatLhidDisplay(r.lhid || r.LHID).toLowerCase() === cleanLhid
          );
          if (foundIdx >= 0) {
            idx = foundIdx;
            row = tabRows[foundIdx];
          }
        }

        if (row && idx >= 0) {
          appState.activeOptoolTab = tabName;
          if (lhid) {
            appState.optoolSearch = formatLhidDisplay(lhid);
          }
          if (tabName === 'Leasehold') {
            openLeaseholdModal(row, idx);
          } else {
            openOptoolModal(tabName, row, idx);
          }
          return;
        }
      }

      // Default behavior for general toolbar buttons: switch to OPTool tab
      appState.activeOptoolTab = tabName;
      appState.optoolPage = 1;
      appState.optoolColPage = 1;
      appState.view = 'optool';
      renderActiveView();
    });
  });

  container.querySelector('#btn-edit-nep-targets')?.addEventListener('click', openNepTargetsModal);
  container.querySelector('#btn-sync-hub-nep')?.addEventListener('click', syncHubNepSheet);
  container.querySelectorAll('#btn-clear-nep-targets-filter').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (appState.filters) {
        appState.filters.province = 'ALL';
        appState.filters.milestoneYear = 'ALL';
      }
      appState.nepMilestoneTableFilter = 'ALL';
      const provSelect = container.querySelector('#nep-province-filter');
      if (provSelect) provSelect.value = 'ALL';
      const msSelect = container.querySelector('#nep-milestone-table-filter');
      if (msSelect) msSelect.value = 'ALL';
      const yrSelect = container.querySelector('#nep-year-select');
      if (yrSelect) yrSelect.value = 'ALL';
      await refreshAnalytics();
      toast('NEP targets filters cleared (showing All Provinces, Milestones & Years)', 'info');
    });
  });
  container.querySelector('#btn-switch-to-active-nep-year')?.addEventListener('click', async (e) => {
    const yr = e.currentTarget?.dataset?.targetYear || '2027';
    appState.filters.milestoneYear = yr;
    const yearSelect = container.querySelector('#nep-year-select');
    if (yearSelect) yearSelect.value = yr;
    await refreshAnalytics();
  });
  bindProvincialAllocationTableEvents(container);
  container.querySelector('#nep-milestone-filter')?.addEventListener('change', (e) => {
    appState.nepMilestoneFilter = e.target.value;
    renderActiveView();
  });
  container.querySelector('#nep-year-filter')?.addEventListener('change', (e) => {
    appState.nepYearFilter = e.target.value;
    renderActiveView();
  });
  container.querySelectorAll('#btn-clear-nep-filters, .btn-clear-nep-filters').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.nepMilestoneFilter = 'overall';
      appState.nepYearFilter = 'ALL';
      if (appState.filters) {
        appState.filters.milestoneYear = 'ALL';
      }
      const msFilter = container.querySelector('#nep-milestone-filter');
      if (msFilter) msFilter.value = 'overall';
      const yrFilter = container.querySelector('#nep-year-filter');
      if (yrFilter) yrFilter.value = 'ALL';
      renderActiveView();
      toast('NEP filters cleared (showing Overall NEP across All Years)', 'info');
    });
  });
  container.querySelector('#btn-sync-nep-sheet')?.addEventListener('click', syncHubNepSheet);
}

function bindProvincialAllocationTableEvents(container) {
  container.querySelectorAll('#btn-edit-nep-sheet, #btn-card-edit-nep, .btn-card-edit-nep, #btn-add-nep-target, .btn-add-nep-target, .btn-add-nep-target-empty').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const ms = e.currentTarget?.dataset?.milestone || appState.nepMilestoneFilter || 'overall';
      const isAdd = btn.id === 'btn-add-nep-target' || btn.classList.contains('btn-add-nep-target') || btn.classList.contains('btn-add-nep-target-empty') || btn.id === 'btn-edit-nep-sheet';
      const yr = appState.nepYearFilter !== 'ALL' && appState.nepYearFilter ? Number(appState.nepYearFilter) : null;
      openNepSheetModal(null, ms, isAdd ? 'add' : 'edit', yr);
    });
  });
  container.querySelectorAll('.btn-edit-single-nep').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ms = btn.dataset.milestone || appState.nepMilestoneFilter || 'overall';
      const isAdd = btn.textContent.includes('Add');
      const yr = btn.dataset.year ? Number(btn.dataset.year) : null;
      openNepSheetModal(btn.dataset.prov, ms, isAdd ? 'add' : 'edit', yr);
    });
  });
  container.querySelectorAll('.btn-del-single-nep').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const prov = btn.dataset.prov;
      const ms = btn.dataset.milestone || 'overall';
      const yr = btn.dataset.year || '2026';
      if (!confirm(`Are you sure you want to delete the NEP target for ${prov} (Year: ${yr}, Milestone: ${ms})?`)) {
        return;
      }
      try {
        const res = await withLoading(
          'saving',
          'Deleting NEP Target…',
          `Removing NEP target for ${prov} (${yr}) and syncing with Google Sheet…`,
          () =>
            api('/api/nep-targets', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ year: yr, milestone: ms, provinceCode: prov })
            })
        );
        if (res.nepTargets) appState.state.nepTargets = res.nepTargets;
        if (res.nepMilestoneList) appState.state.nepMilestoneList = res.nepMilestoneList;
        if (res.nepProvinceList) appState.state.nepProvinceList = res.nepProvinceList;
        if (res.nepMilestoneListByYear) appState.state.nepMilestoneListByYear = res.nepMilestoneListByYear;
        if (res.nepProvinceListByYear) appState.state.nepProvinceListByYear = res.nepProvinceListByYear;
        if (res.analytics) appState.analytics = res.analytics;
        renderActiveView();
        toast(`Deleted NEP target for ${prov} (Year ${yr})`);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
  container.querySelectorAll('[data-nep-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.nepDisplayMode = btn.dataset.nepMode;
      renderActiveView();
    });
  });
  container.querySelectorAll('[data-toggle-nep-col]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const col = btn.dataset.toggleNepCol;
      if (!appState.nepColVisibility) {
        appState.nepColVisibility = { lhs: true, area: true, arbs: true };
      }
      appState.nepColVisibility[col] = !appState.nepColVisibility[col];
      if (!appState.nepColVisibility.lhs && !appState.nepColVisibility.area && !appState.nepColVisibility.arbs) {
        appState.nepColVisibility[col] = true;
        toast('At least one metric column must remain visible', true);
        return;
      }
      renderActiveView();
    });
  });
}

async function syncHubNepSheet() {
  try {
    const activeYear = appState.filters.milestoneYear || '2027';
    const res = await withLoading(
      'fetching',
      'Syncing Hub NEP Targets…',
      'Reading NEP target data (LHS, AREA, ARBs, Year) from Regional Hub Google Sheet…',
      () => api('/api/nep-sheet/sync?milestoneYear=' + encodeURIComponent(activeYear), { method: 'POST' })
    );
    appState.state.nepProvinceList = res.nepProvinceList;
    if (res.nepMilestoneList) appState.state.nepMilestoneList = res.nepMilestoneList;
    if (res.nepTargets) appState.state.nepTargets = res.nepTargets;
    if (res.nepMilestoneListByYear) appState.state.nepMilestoneListByYear = res.nepMilestoneListByYear;
    if (res.nepProvinceListByYear) appState.state.nepProvinceListByYear = res.nepProvinceListByYear;
    appState.analytics = res.analytics;
    renderActiveView();
    toast('Fetched Regional Hub NEP Targets (' + (activeYear === 'ALL' ? 'All Years' : activeYear) + ')');
  } catch (err) {
    toast(err.message, true);
  }
}

function openNepSheetModal(targetProv = null, initialMilestone = null, mode = 'add', targetYear = null) {
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
    { key: 'installation', label: 'Installation' },
    { key: 'leasehold', label: 'Leasehold' }
  ];

  let currentMilestone = initialMilestone || appState.nepMilestoneFilter || 'overall';
  if (!milestoneOptions.some((m) => m.key === currentMilestone)) {
    currentMilestone = 'overall';
  }

  const defaultYear = targetYear
    ? Number(targetYear)
    : (appState.nepYearFilter !== 'ALL' && appState.nepYearFilter
        ? Number(appState.nepYearFilter)
        : (appState.state?.nepProvinceList?.LEY?.year || 2026));

  // In-memory working copy for each milestone
  const localData = {};
  const yearProvMap = appState.state?.nepProvinceListByYear?.[defaultYear];
  const yearMsMap = appState.state?.nepMilestoneListByYear?.[defaultYear];

  localData.overall = yearProvMap
    ? JSON.parse(JSON.stringify(yearProvMap))
    : (mode === 'add' ? {} : JSON.parse(JSON.stringify(appState.state?.nepProvinceList || {})));

  for (const m of milestoneOptions) {
    if (m.key !== 'overall') {
      localData[m.key] = yearMsMap?.[m.key]
        ? JSON.parse(JSON.stringify(yearMsMap[m.key]))
        : (mode === 'add' ? {} : JSON.parse(JSON.stringify(appState.state?.nepMilestoneList?.[m.key] || {})));
    }
  }

  const getActiveMap = () => localData[currentMilestone] || {};

  const rowsHtml = provNodes
    .map((n) => {
      const activeMap = getActiveMap();
      const entry = activeMap[n.code] || { lhs: 0, area: 0, arbs: 0, year: defaultYear };
      const s1Lhs = entry.sem1Lhs !== undefined && entry.sem1Lhs !== null && entry.sem1Lhs !== ''
        ? entry.sem1Lhs
        : (entry.lhs > 0 ? Math.round(entry.lhs / 2) : 0);
      const s2Lhs = Math.max(0, (entry.lhs || 0) - s1Lhs);
      const s1Area = entry.sem1Area !== undefined && entry.sem1Area !== null && entry.sem1Area !== ''
        ? Number(entry.sem1Area)
        : Number(((entry.area || 0) / 2).toFixed(4));
      const s2Area = Math.max(0, Number(((entry.area || 0) - s1Area).toFixed(4)));
      const s1Arbs = entry.sem1Arbs !== undefined && entry.sem1Arbs !== null && entry.sem1Arbs !== ''
        ? entry.sem1Arbs
        : (entry.arbs > 0 ? Math.round(entry.arbs / 2) : 0);
      const s2Arbs = Math.max(0, (entry.arbs || 0) - s1Arbs);

      return `
        <tr>
          <td class="sticky-col-province"><strong>${esc(n.provinceName)}</strong><div class="nep-sub-metric">${esc(n.code)}</div></td>
          <td class="nep-modal-col-lhs">
            <input
              type="number"
              min="0"
              step="1"
              class="form-control num nep-sheet-input nep-input-lhs"
              data-prov="${esc(n.code)}"
              name="lhs_${esc(n.code)}"
              value="${esc(entry.lhs || 0)}"
            />
          </td>
          <td class="nep-modal-col-lhs">
            <input
              type="number"
              min="0"
              step="1"
              class="form-control num nep-sheet-input nep-input-s1-lhs"
              style="border-color:var(--dar-blue,#1d4ed8);background:#f0f7ff;"
              data-prov="${esc(n.code)}"
              name="s1_lhs_${esc(n.code)}"
              placeholder="1st Sem"
              title="1st Sem LHS Target"
              value="${esc(s1Lhs)}"
            />
          </td>
          <td class="nep-modal-col-lhs">
            <input
              type="number"
              class="form-control num nep-sheet-input form-control-readonly nep-input-s2-lhs"
              style="border-color:var(--dar-amber,#b45309);background:#fffbeb;font-weight:700;"
              data-prov="${esc(n.code)}"
              name="s2_lhs_${esc(n.code)}"
              readonly
              tabindex="-1"
              title="2nd Sem LHS Target (Auto: NEP - 1st Sem)"
              value="${esc(s2Lhs)}"
            />
          </td>
          <td class="nep-modal-col-area">
            <input
              type="number"
              min="0"
              step="0.0001"
              class="form-control num nep-sheet-input nep-input-area"
              data-prov="${esc(n.code)}"
              name="area_${esc(n.code)}"
              value="${esc((Number(entry.area) || 0).toFixed(4))}"
            />
          </td>
          <td class="nep-modal-col-area">
            <input
              type="number"
              min="0"
              step="0.0001"
              class="form-control num nep-sheet-input nep-input-s1-area"
              style="border-color:var(--dar-blue,#1d4ed8);background:#f0f7ff;"
              data-prov="${esc(n.code)}"
              name="s1_area_${esc(n.code)}"
              placeholder="1st Sem Area"
              title="1st Sem Area Target (HAS)"
              value="${esc(s1Area.toFixed(4))}"
            />
          </td>
          <td class="nep-modal-col-area">
            <input
              type="number"
              class="form-control num nep-sheet-input form-control-readonly nep-input-s2-area"
              style="border-color:var(--dar-amber,#b45309);background:#fffbeb;font-weight:700;"
              data-prov="${esc(n.code)}"
              name="s2_area_${esc(n.code)}"
              readonly
              tabindex="-1"
              title="2nd Sem Area Target (Auto: NEP - 1st Sem)"
              value="${esc(s2Area.toFixed(4))}"
            />
          </td>
          <td class="nep-modal-col-arbs">
            <input
              type="number"
              min="0"
              step="1"
              class="form-control num nep-sheet-input nep-input-arbs"
              data-prov="${esc(n.code)}"
              name="arbs_${esc(n.code)}"
              title="Total ARBs Target"
              value="${esc(entry.arbs || 0)}"
            />
          </td>
          <td class="nep-modal-col-arbs">
            <input
              type="number"
              min="0"
              step="1"
              class="form-control num nep-sheet-input nep-input-s1-arbs"
              style="border-color:var(--dar-blue,#1d4ed8);background:#f0f7ff;"
              data-prov="${esc(n.code)}"
              name="s1_arbs_${esc(n.code)}"
              placeholder="1st Sem"
              title="1st Sem ARBs Target"
              value="${esc(s1Arbs)}"
            />
          </td>
          <td class="nep-modal-col-arbs">
            <input
              type="number"
              class="form-control num nep-sheet-input form-control-readonly nep-input-s2-arbs"
              style="border-color:var(--dar-amber,#b45309);background:#fffbeb;font-weight:700;"
              data-prov="${esc(n.code)}"
              name="s2_arbs_${esc(n.code)}"
              readonly
              tabindex="-1"
              title="2nd Sem ARBs Target (Auto: Total ARBs − 1st Sem)"
              value="${esc(s2Arbs)}"
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

  const msObj = milestoneOptions.find((m) => m.key === currentMilestone);
  const milestoneTitle = msObj ? msObj.label : currentMilestone;
  const provObj = provNodes.find((n) => n.code === targetProv);
  const modalTitle = targetProv
    ? `${mode === 'add' ? 'Add' : 'Edit'} NEP Target — ${provObj ? provObj.provinceName : targetProv} (${milestoneTitle})`
    : `${mode === 'add' ? 'Add' : 'Allocate & Edit'} Regional Hub NEP Targets — ${milestoneTitle}`;

  showFormModal(modalTitle, {
    formId: 'nep-sheet-form',
    submitLabel: mode === 'add' ? '+ Add / Save NEP Targets' : 'Save & Push to Hub NEP Sheet',
    cancelId: 'nep-sheet-cancel',
    extraActionsHtml: `
      <button type="button" class="btn btn-secondary" id="btn-clear-nep-sheet" style="color:#dc2626;border-color:#fca5a5;margin-right:auto;font-weight:600;display:flex;align-items:center;gap:6px;">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
        <span>Clear Figures</span>
      </button>
    `,
    contentHtml: `
      <p style="margin:0 0 10px;font-size:12.5px;color:var(--text-muted)">
        ${mode === 'add' ? 'Add official NEP targets' : 'Enter or update NEP targets'} (<strong>Total NEP</strong>, <strong>1st Sem Target</strong>, automatic <strong>2nd Sem Target</strong> (<code>NEP − 1st Sem</code>) for <strong>LHS</strong>, <strong>AREA</strong>, and <strong>ARBs</strong>, plus <strong>Target Year</strong>) stored in the Regional Hub Google Sheet.
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

        <!-- Batch Year Updater & Column Toggles & Clear Button -->
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
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

          <!-- Column Toggles for LHS, AREA, ARBs -->
          <div style="display:flex;align-items:center;gap:5px;background:var(--surface);padding:3px 6px;border-radius:6px;border:1px solid var(--border);">
            <span style="font-size:11.5px;font-weight:700;color:var(--text-muted);margin-right:2px;">Columns:</span>
            <button type="button" class="btn btn-xs nep-modal-col-btn btn-primary" data-modal-col="lhs" title="Click to hide/show LHS">✓ LHS</button>
            <button type="button" class="btn btn-xs nep-modal-col-btn btn-primary" data-modal-col="area" title="Click to hide/show AREA">✓ AREA</button>
            <button type="button" class="btn btn-xs nep-modal-col-btn btn-primary" data-modal-col="arbs" title="Click to hide/show ARBs">✓ ARBs</button>
          </div>

          <button type="button" class="btn btn-secondary btn-sm" id="btn-clear-nep-sheet-top" title="Clear all figures in this form to 0" style="height:34px;color:#dc2626;border-color:#fca5a5;font-weight:600;display:flex;align-items:center;gap:5px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
            <span>Clear</span>
          </button>
        </div>
      </div>

      <div class="table-wrap nep-modal-table-wrap">
        <table class="nep-modal-table">
          <thead>
            <tr>
              <th rowspan="2" class="sticky-col-province" style="vertical-align:bottom;">Province</th>
              <th colspan="3" class="center nep-modal-col-lhs">LHS (Landholdings)</th>
              <th colspan="3" class="center nep-modal-col-area">AREA (HAS)</th>
              <th colspan="3" class="center nep-modal-col-arbs">ARBs (Beneficiaries)</th>
              <th rowspan="2" class="center" style="vertical-align:bottom;">Year</th>
            </tr>
            <tr>
              <th class="center nep-modal-col-lhs">NEP Total</th>
              <th class="center nep-modal-col-lhs nep-th-sem1">1st Sem</th>
              <th class="center nep-modal-col-lhs nep-th-sem2">2nd Sem (Auto)</th>
              <th class="center nep-modal-col-area">NEP Total</th>
              <th class="center nep-modal-col-area nep-th-sem1">1st Sem</th>
              <th class="center nep-modal-col-area nep-th-sem2">2nd Sem (Auto)</th>
              <th class="center nep-modal-col-arbs">NEP Total</th>
              <th class="center nep-modal-col-arbs nep-th-sem1">1st Sem</th>
              <th class="center nep-modal-col-arbs nep-th-sem2">2nd Sem (Auto)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr style="font-weight:700;background:var(--surface-alt, #f8faf9);border-top:2px solid var(--border);">
              <td class="sticky-col-province">Region VIII Total</td>
              <td class="center nep-modal-col-lhs" id="nep-sheet-total-lhs">0</td>
              <td class="center nep-modal-col-lhs" id="nep-sheet-total-s1-lhs" style="color:var(--dar-blue,#1d4ed8);">0</td>
              <td class="center nep-modal-col-lhs" id="nep-sheet-total-s2-lhs" style="color:var(--dar-amber,#b45309);">0</td>
              <td class="center nep-modal-col-area" id="nep-sheet-total-area">0.0000</td>
              <td class="center nep-modal-col-area" id="nep-sheet-total-s1-area" style="color:var(--dar-blue,#1d4ed8);">0.0000</td>
              <td class="center nep-modal-col-area" id="nep-sheet-total-s2-area" style="color:var(--dar-amber,#b45309);">0.0000</td>
              <td class="center nep-modal-col-arbs" id="nep-sheet-total-arbs">0</td>
              <td class="center nep-modal-col-arbs" id="nep-sheet-total-s1-arbs" style="color:var(--dar-blue,#1d4ed8);">0</td>
              <td class="center nep-modal-col-arbs" id="nep-sheet-total-s2-arbs" style="color:var(--dar-amber,#b45309);">0</td>
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
      const lhs = Math.max(0, Math.round(Number(form.elements[`lhs_${n.code}`]?.value) || 0));
      const s1Lhs = Math.max(0, Math.round(Number(form.elements[`s1_lhs_${n.code}`]?.value) || 0));
      const s2Lhs = Math.max(0, lhs - s1Lhs);
      const area = Math.max(0, Number((Number(form.elements[`area_${n.code}`]?.value) || 0).toFixed(4)));
      const s1Area = Math.max(0, Number((Number(form.elements[`s1_area_${n.code}`]?.value) || 0).toFixed(4)));
      const s2Area = Math.max(0, Number((area - s1Area).toFixed(4)));
      const arbs = Math.max(0, Math.round(Number(form.elements[`arbs_${n.code}`]?.value) || 0));
      const s1Arbs = Math.max(0, Math.round(Number(form.elements[`s1_arbs_${n.code}`]?.value) || 0));
      const s2Arbs = Math.max(0, arbs - s1Arbs);

      map[n.code] = {
        lhs,
        sem1Lhs: s1Lhs,
        sem2Lhs: s2Lhs,
        area,
        sem1Area: s1Area,
        sem2Area: s2Area,
        arbs,
        sem1Arbs: s1Arbs,
        sem2Arbs: s2Arbs,
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
      const s1Lhs = item.sem1Lhs !== undefined && item.sem1Lhs !== null && item.sem1Lhs !== ''
        ? item.sem1Lhs
        : (item.lhs > 0 ? Math.round(item.lhs / 2) : 0);
      const s2Lhs = Math.max(0, (item.lhs || 0) - s1Lhs);
      const s1Area = item.sem1Area !== undefined && item.sem1Area !== null && item.sem1Area !== ''
        ? Number(item.sem1Area)
        : Number(((item.area || 0) / 2).toFixed(4));
      const s2Area = Math.max(0, Number(((item.area || 0) - s1Area).toFixed(4)));
      const s1Arbs = item.sem1Arbs !== undefined && item.sem1Arbs !== null && item.sem1Arbs !== ''
        ? item.sem1Arbs
        : (item.arbs > 0 ? Math.round(item.arbs / 2) : 0);
      const s2Arbs = Math.max(0, (item.arbs || 0) - s1Arbs);

      if (form.elements[`lhs_${n.code}`]) form.elements[`lhs_${n.code}`].value = item.lhs || 0;
      if (form.elements[`s1_lhs_${n.code}`]) form.elements[`s1_lhs_${n.code}`].value = s1Lhs;
      if (form.elements[`s2_lhs_${n.code}`]) form.elements[`s2_lhs_${n.code}`].value = s2Lhs;
      if (form.elements[`area_${n.code}`]) form.elements[`area_${n.code}`].value = (Number(item.area) || 0).toFixed(4);
      if (form.elements[`s1_area_${n.code}`]) form.elements[`s1_area_${n.code}`].value = s1Area.toFixed(4);
      if (form.elements[`s2_area_${n.code}`]) form.elements[`s2_area_${n.code}`].value = s2Area.toFixed(4);
      if (form.elements[`arbs_${n.code}`]) form.elements[`arbs_${n.code}`].value = item.arbs || 0;
      if (form.elements[`s1_arbs_${n.code}`]) form.elements[`s1_arbs_${n.code}`].value = s1Arbs;
      if (form.elements[`s2_arbs_${n.code}`]) form.elements[`s2_arbs_${n.code}`].value = s2Arbs;
      if (form.elements[`year_${n.code}`]) form.elements[`year_${n.code}`].value = item.year || defaultYear;
    }
    updateModalTotals();
  };

  const updateModalTotals = () => {
    const form = document.getElementById('nep-sheet-form');
    if (!form) return;
    let lhsSum = 0;
    let s1LhsSum = 0;
    let s2LhsSum = 0;
    let areaSum = 0;
    let s1AreaSum = 0;
    let s2AreaSum = 0;
    let arbsSum = 0;
    let s1ArbsSum = 0;
    let s2ArbsSum = 0;
    for (const n of provNodes) {
      const lhs = Math.max(0, Math.round(Number(form.elements[`lhs_${n.code}`]?.value) || 0));
      const s1L = Math.max(0, Math.round(Number(form.elements[`s1_lhs_${n.code}`]?.value) || 0));
      const s2L = Math.max(0, lhs - s1L);
      const a = Math.max(0, Number(form.elements[`area_${n.code}`]?.value) || 0);
      const s1A = Math.max(0, Number(form.elements[`s1_area_${n.code}`]?.value) || 0);
      const s2A = Math.max(0, Number((a - s1A).toFixed(4)));
      const arb = Math.max(0, Math.round(Number(form.elements[`arbs_${n.code}`]?.value) || 0));
      const s1Arb = Math.max(0, Math.round(Number(form.elements[`s1_arbs_${n.code}`]?.value) || 0));
      const s2Arb = Math.max(0, arb - s1Arb);

      lhsSum += lhs;
      s1LhsSum += s1L;
      s2LhsSum += s2L;
      areaSum += a;
      s1AreaSum += s1A;
      s2AreaSum += s2A;
      arbsSum += arb;
      s1ArbsSum += s1Arb;
      s2ArbsSum += s2Arb;
    }
    const lhsEl = document.getElementById('nep-sheet-total-lhs');
    const s1LhsEl = document.getElementById('nep-sheet-total-s1-lhs');
    const s2LhsEl = document.getElementById('nep-sheet-total-s2-lhs');
    const areaEl = document.getElementById('nep-sheet-total-area');
    const s1AreaEl = document.getElementById('nep-sheet-total-s1-area');
    const s2AreaEl = document.getElementById('nep-sheet-total-s2-area');
    const arbsEl = document.getElementById('nep-sheet-total-arbs');
    const s1ArbsEl = document.getElementById('nep-sheet-total-s1-arbs');
    const s2ArbsEl = document.getElementById('nep-sheet-total-s2-arbs');
    if (lhsEl) lhsEl.textContent = lhsSum.toLocaleString('en-US');
    if (s1LhsEl) s1LhsEl.textContent = s1LhsSum.toLocaleString('en-US');
    if (s2LhsEl) s2LhsEl.textContent = s2LhsSum.toLocaleString('en-US');
    if (areaEl) areaEl.textContent = areaSum.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    if (s1AreaEl) s1AreaEl.textContent = s1AreaSum.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    if (s2AreaEl) s2AreaEl.textContent = s2AreaSum.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    if (arbsEl) arbsEl.textContent = arbsSum.toLocaleString('en-US');
    if (s1ArbsEl) s1ArbsEl.textContent = s1ArbsSum.toLocaleString('en-US');
    if (s2ArbsEl) s2ArbsEl.textContent = s2ArbsSum.toLocaleString('en-US');
  };

  const handleNepSheetLiveInput = (e) => {
    const form = document.getElementById('nep-sheet-form');
    if (!form || !e || !e.target) return;
    const prov = e.target.dataset.prov;
    if (prov) {
      const lhsInp = form.elements[`lhs_${prov}`];
      const s1LhsInp = form.elements[`s1_lhs_${prov}`];
      const s2LhsInp = form.elements[`s2_lhs_${prov}`];
      const areaInp = form.elements[`area_${prov}`];
      const s1AreaInp = form.elements[`s1_area_${prov}`];
      const s2AreaInp = form.elements[`s2_area_${prov}`];
      const arbsInp = form.elements[`arbs_${prov}`];
      const s1ArbsInp = form.elements[`s1_arbs_${prov}`];
      const s2ArbsInp = form.elements[`s2_arbs_${prov}`];

      if (lhsInp && s1LhsInp && s2LhsInp) {
        const totL = Math.max(0, Math.round(Number(lhsInp.value) || 0));
        const s1L = Math.max(0, Math.round(Number(s1LhsInp.value) || 0));
        s2LhsInp.value = Math.max(0, totL - s1L);
      }
      if (areaInp && s1AreaInp && s2AreaInp) {
        const totA = Math.max(0, Number(areaInp.value) || 0);
        const s1A = Math.max(0, Number(s1AreaInp.value) || 0);
        s2AreaInp.value = Math.max(0, Number((totA - s1A).toFixed(4))).toFixed(4);
      }
      if (arbsInp && s1ArbsInp && s2ArbsInp) {
        const totArb = Math.max(0, Math.round(Number(arbsInp.value) || 0));
        const s1Arb = Math.max(0, Math.round(Number(s1ArbsInp.value) || 0));
        s2ArbsInp.value = Math.max(0, totArb - s1Arb);
      }
    }
    updateModalTotals();
  };

  updateModalTotals();
  document.getElementById('nep-sheet-form')?.addEventListener('input', handleNepSheetLiveInput);

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

  const modalColState = {
    lhs: appState.nepColVisibility?.lhs ?? true,
    area: appState.nepColVisibility?.area ?? true,
    arbs: appState.nepColVisibility?.arbs ?? true
  };

  const applyModalColVisibility = () => {
    ['lhs', 'area', 'arbs'].forEach((col) => {
      const isVisible = modalColState[col];
      const btn = document.querySelector(`.nep-modal-col-btn[data-modal-col="${col}"]`);
      if (btn) {
        btn.className = `btn btn-xs nep-modal-col-btn ${isVisible ? 'btn-primary' : 'btn-secondary'}`;
        btn.textContent = isVisible ? `✓ ${col.toUpperCase()}` : `+ ${col.toUpperCase()}`;
      }
      document.querySelectorAll(`.nep-modal-col-${col}`).forEach((el) => {
        el.style.display = isVisible ? '' : 'none';
      });
    });
  };

  document.querySelectorAll('.nep-modal-col-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const col = btn.dataset.modalCol;
      modalColState[col] = !modalColState[col];
      if (!modalColState.lhs && !modalColState.area && !modalColState.arbs) {
        modalColState[col] = true;
        toast('At least one metric column must remain visible', true);
        return;
      }
      if (appState.nepColVisibility) {
        appState.nepColVisibility[col] = modalColState[col];
      }
      applyModalColVisibility();
    });
  });

  applyModalColVisibility();

  if (targetProv) {
    setTimeout(() => {
      const el =
        document.getElementById('nep-sheet-form')?.elements[`lhs_${targetProv}`] ||
        document.getElementById('nep-sheet-form')?.elements[`area_${targetProv}`];
      if (el) {
        el.focus();
        el.select();
      }
    }, 60);
  } else {
    setTimeout(() => {
      const firstProv = provNodes[0]?.code;
      if (firstProv) {
        const el =
          document.getElementById('nep-sheet-form')?.elements[`lhs_${firstProv}`] ||
          document.getElementById('nep-sheet-form')?.elements[`area_${firstProv}`];
        if (el) {
          el.focus();
          el.select();
        }
      }
    }, 60);
  }

  const handleClearFigures = () => {
    const form = document.getElementById('nep-sheet-form');
    if (!form) return;
    for (const n of provNodes) {
      if (form.elements[`lhs_${n.code}`]) form.elements[`lhs_${n.code}`].value = '0';
      if (form.elements[`s1_lhs_${n.code}`]) form.elements[`s1_lhs_${n.code}`].value = '0';
      if (form.elements[`s2_lhs_${n.code}`]) form.elements[`s2_lhs_${n.code}`].value = '0';
      if (form.elements[`area_${n.code}`]) form.elements[`area_${n.code}`].value = '0.0000';
      if (form.elements[`s1_area_${n.code}`]) form.elements[`s1_area_${n.code}`].value = '0.0000';
      if (form.elements[`s2_area_${n.code}`]) form.elements[`s2_area_${n.code}`].value = '0.0000';
      if (form.elements[`arbs_${n.code}`]) form.elements[`arbs_${n.code}`].value = '0';
      if (form.elements[`s1_arbs_${n.code}`]) form.elements[`s1_arbs_${n.code}`].value = '0';
      if (form.elements[`s2_arbs_${n.code}`]) form.elements[`s2_arbs_${n.code}`].value = '0';
    }
    updateModalTotals();
    localData[currentMilestone] = readCurrentFormInputs();
    toast(`Cleared target figures for ${milestoneTitle}`);
  };

  document.getElementById('btn-clear-nep-sheet')?.addEventListener('click', handleClearFigures);
  document.getElementById('btn-clear-nep-sheet-top')?.addEventListener('click', handleClearFigures);

  document.getElementById('nep-sheet-cancel')?.addEventListener('click', closeModal);
  document.getElementById('nep-sheet-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    localData[currentMilestone] = readCurrentFormInputs();
    const payload = localData[currentMilestone];
    const msObj = milestoneOptions.find((m) => m.key === currentMilestone);
    const milestoneTitle = msObj ? msObj.label : currentMilestone;
    const yearUsed = (payload && Object.values(payload)[0]?.year) || defaultYear;

    try {
      const res = await withLoading(
        'saving',
        'Saving NEP Sheet…',
        `Updating Regional Hub NEP tab for ${milestoneTitle} (Year ${yearUsed})…`,
        () =>
          api('/api/nep-sheet', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              milestone: currentMilestone,
              targetYear: yearUsed,
              nepProvinceList: payload,
              nepMilestoneList: { [currentMilestone]: payload }
            })
          })
      );
      appState.state.nepProvinceList = res.nepProvinceList;
      if (res.nepMilestoneList) appState.state.nepMilestoneList = res.nepMilestoneList;
      if (res.nepTargets) appState.state.nepTargets = res.nepTargets;
      if (res.nepMilestoneListByYear) appState.state.nepMilestoneListByYear = res.nepMilestoneListByYear;
      if (res.nepProvinceListByYear) appState.state.nepProvinceListByYear = res.nepProvinceListByYear;
      appState.analytics = res.analytics;
      appState.nepMilestoneFilter = currentMilestone;
      appState.nepYearFilter = String(yearUsed);
      if (appState.filters) appState.filters.milestoneYear = String(yearUsed);
      closeModal();
      renderActiveView();
      toast(
        res.gasSync?.ok
          ? `Saved & synced Regional Hub NEP Sheet (${milestoneTitle} - ${yearUsed})`
          : `Saved Regional NEP Sheet locally (${milestoneTitle} - ${yearUsed})`
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
  const selectedYear =
    appState.filters?.milestoneYear !== 'ALL' && appState.filters?.milestoneYear
      ? Number(appState.filters.milestoneYear)
      : 2027;
  const currentTargets = appState.state?.nepTargetsByYear?.[selectedYear] || appState.state?.nepTargets || {};

  const rowsHtml = milestones
    .map((m) => {
      const t = currentTargets[m.key] || { targetCount: 0, targetAreaHas: 0 };
      const s1c = t.sem1TargetCount !== undefined && t.sem1TargetCount !== null && t.sem1TargetCount !== ''
        ? t.sem1TargetCount
        : (t.targetCount > 0 ? Math.round(t.targetCount / 2) : 0);
      const s2c = Math.max(0, (t.targetCount || 0) - s1c);
      const s1a = t.sem1TargetAreaHas !== undefined && t.sem1TargetAreaHas !== null && t.sem1TargetAreaHas !== ''
        ? Number(t.sem1TargetAreaHas)
        : Number(((t.targetAreaHas || 0) / 2).toFixed(4));
      const s2a = Math.max(0, Number(((t.targetAreaHas || 0) - s1a).toFixed(4)));

      return `
        <tr>
          <td class="sticky-col-province"><strong>${esc(m.label)}</strong><div class="nep-sub-metric">${esc(m.sourceTab)}</div></td>
          <td>
            <input
              type="number"
              min="0"
              step="1"
              class="form-control num nep-target-c"
              data-ms="${esc(m.key)}"
              name="c_${esc(m.key)}"
              title="NEP Total LHs"
              value="${esc(t.targetCount || 0)}"
            />
          </td>
          <td>
            <input
              type="number"
              min="0"
              step="1"
              class="form-control num nep-target-s1c"
              data-ms="${esc(m.key)}"
              style="border-color:var(--dar-blue,#1d4ed8);background:#f0f7ff;"
              name="s1c_${esc(m.key)}"
              placeholder="1st Sem"
              title="1st Sem LHs Target"
              value="${esc(s1c)}"
            />
          </td>
          <td>
            <input
              type="number"
              class="form-control num form-control-readonly nep-target-s2c"
              data-ms="${esc(m.key)}"
              name="s2c_${esc(m.key)}"
              readonly
              tabindex="-1"
              style="border-color:var(--dar-amber,#b45309);background:#fffbeb;font-weight:700;"
              title="2nd Sem LHs Target (Auto: NEP − 1st Sem)"
              value="${esc(s2c)}"
            />
          </td>
          <td>
            <input
              type="number"
              min="0"
              step="0.0001"
              class="form-control num nep-target-a"
              data-ms="${esc(m.key)}"
              name="a_${esc(m.key)}"
              title="NEP Total Area (HAS)"
              value="${esc((Number(t.targetAreaHas) || 0).toFixed(4))}"
            />
          </td>
          <td>
            <input
              type="number"
              min="0"
              step="0.0001"
              class="form-control num nep-target-s1a"
              data-ms="${esc(m.key)}"
              style="border-color:var(--dar-blue,#1d4ed8);background:#f0f7ff;"
              name="s1a_${esc(m.key)}"
              placeholder="1st Sem Area"
              title="1st Sem Area Target (HAS)"
              value="${esc(s1a.toFixed(4))}"
            />
          </td>
          <td>
            <input
              type="number"
              class="form-control num form-control-readonly nep-target-s2a"
              data-ms="${esc(m.key)}"
              name="s2a_${esc(m.key)}"
              readonly
              tabindex="-1"
              style="border-color:var(--dar-amber,#b45309);background:#fffbeb;font-weight:700;"
              title="2nd Sem Area Target (Auto: NEP − 1st Sem)"
              value="${esc(s2a.toFixed(4))}"
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
    extraActionsHtml: `
      <button type="button" class="btn btn-secondary" id="btn-clear-nep-targets" style="color:#dc2626;border-color:#fca5a5;margin-right:auto;font-weight:600;display:flex;align-items:center;gap:6px;">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
        <span>Clear Figures</span>
      </button>
    `,
    bodyHtml: `
      <div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 12px;gap:8px;flex-wrap:wrap">
        <div>
          <p style="margin:0;font-size:12.5px;color:var(--text-muted)">
            Region VIII consolidated NEP Target per milestone. Enter <strong>1st Sem Target</strong> and <strong>2nd Sem Target</strong> will automatically compute as <code>NEP − 1st Sem Target</code>.
          </p>
          <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
            <label for="nep-modal-target-year" style="font-size:12px;font-weight:700;">Target Year:</label>
            <input type="number" min="2000" max="2099" id="nep-modal-target-year" name="targetYear" class="form-control form-control-sm" style="width:85px;font-weight:700;display:inline-block;" value="${esc(selectedYear)}" />
            <span class="badge badge-green" style="font-size:11px;">🟢 Direct Live Google Sheet Sync</span>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-fetch-hub-nep-modal" style="white-space:nowrap">
          Fetch from Regional Hub NEP
        </button>
      </div>
      <div class="table-wrap">
        <table class="nep-targets-table">
          <thead>
            <tr>
              <th rowspan="2" class="sticky-col-province" style="vertical-align:bottom;">Milestone</th>
              <th colspan="3" class="center">LHs</th>
              <th colspan="3" class="center">Area (HAS)</th>
            </tr>
            <tr>
              <th class="center">NEP Total</th>
              <th class="center nep-th-sem1">1st Sem</th>
              <th class="center nep-th-sem2">2nd Sem (Auto)</th>
              <th class="center">NEP Total</th>
              <th class="center nep-th-sem1">1st Sem</th>
              <th class="center nep-th-sem2">2nd Sem (Auto)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `
  });

  const nepTargetsForm = document.getElementById('nep-targets-form');
  nepTargetsForm?.addEventListener('input', (e) => {
    const ms = e.target.dataset.ms;
    if (!ms) return;
    const cInp = nepTargetsForm.elements[`c_${ms}`];
    const s1cInp = nepTargetsForm.elements[`s1c_${ms}`];
    const s2cInp = nepTargetsForm.elements[`s2c_${ms}`];
    const aInp = nepTargetsForm.elements[`a_${ms}`];
    const s1aInp = nepTargetsForm.elements[`s1a_${ms}`];
    const s2aInp = nepTargetsForm.elements[`s2a_${ms}`];

    if (cInp && s1cInp && s2cInp) {
      const c = Math.max(0, Math.round(Number(cInp.value) || 0));
      const s1c = Math.max(0, Math.round(Number(s1cInp.value) || 0));
      const s2c = Math.max(0, c - s1c);
      s2cInp.value = s2c;
    }
    if (aInp && s1aInp && s2aInp) {
      const a = Math.max(0, Number(aInp.value) || 0);
      const s1a = Math.max(0, Number(s1aInp.value) || 0);
      const s2a = Math.max(0, Number((a - s1a).toFixed(4)));
      s2aInp.value = s2a.toFixed(4);
    }
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
          const s1c = t.sem1TargetCount !== undefined && t.sem1TargetCount !== null && t.sem1TargetCount !== ''
            ? t.sem1TargetCount
            : (t.targetCount > 0 ? Math.round(t.targetCount / 2) : 0);
          const s2c = Math.max(0, (t.targetCount || 0) - s1c);
          const s1a = t.sem1TargetAreaHas !== undefined && t.sem1TargetAreaHas !== null && t.sem1TargetAreaHas !== ''
            ? Number(t.sem1TargetAreaHas)
            : Number(((t.targetAreaHas || 0) / 2).toFixed(4));
          const s2a = Math.max(0, Number(((t.targetAreaHas || 0) - s1a).toFixed(4)));

          const cInput = form.elements[`c_${m.key}`];
          const s1cInput = form.elements[`s1c_${m.key}`];
          const s2cInput = form.elements[`s2c_${m.key}`];
          const aInput = form.elements[`a_${m.key}`];
          const s1aInput = form.elements[`s1a_${m.key}`];
          const s2aInput = form.elements[`s2a_${m.key}`];

          if (cInput) cInput.value = t.targetCount || 0;
          if (s1cInput) s1cInput.value = s1c;
          if (s2cInput) s2cInput.value = s2c;
          if (aInput) aInput.value = (Number(t.targetAreaHas) || 0).toFixed(4);
          if (s1aInput) s1aInput.value = s1a.toFixed(4);
          if (s2aInput) s2aInput.value = s2a.toFixed(4);
        }
      }
      toast('Fetched NEP Targets from Regional Hub');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('btn-clear-nep-targets')?.addEventListener('click', () => {
    const form = document.getElementById('nep-targets-form');
    if (!form) return;
    for (const m of milestones) {
      if (form.elements[`c_${m.key}`]) form.elements[`c_${m.key}`].value = '0';
      if (form.elements[`s1c_${m.key}`]) form.elements[`s1c_${m.key}`].value = '0';
      if (form.elements[`s2c_${m.key}`]) form.elements[`s2c_${m.key}`].value = '0';
      if (form.elements[`a_${m.key}`]) form.elements[`a_${m.key}`].value = '0.0000';
      if (form.elements[`s1a_${m.key}`]) form.elements[`s1a_${m.key}`].value = '0.0000';
      if (form.elements[`s2a_${m.key}`]) form.elements[`s2a_${m.key}`].value = '0.0000';
    }
    toast('Cleared Regional NEP Targets');
  });

  document.getElementById('nep-cancel')?.addEventListener('click', closeModal);
  document.getElementById('nep-targets-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const yrInp = document.getElementById('nep-modal-target-year');
    const targetYear = Math.round(Number(yrInp?.value) || selectedYear || 2027);
    const payload = {};
    for (const m of milestones) {
      const c = Math.max(0, Number(fd.get(`c_${m.key}`)) || 0);
      const s1c = Math.max(0, Number(fd.get(`s1c_${m.key}`)) || 0);
      const s2c = Math.max(0, c - s1c);
      const a = Math.max(0, Number(fd.get(`a_${m.key}`)) || 0);
      const s1a = Math.max(0, Number(fd.get(`s1a_${m.key}`)) || 0);
      const s2a = Math.max(0, Number((a - s1a).toFixed(4)));

      payload[m.key] = {
        targetCount: c,
        sem1TargetCount: s1c,
        sem2TargetCount: s2c,
        targetAreaHas: a,
        sem1TargetAreaHas: s1a,
        sem2TargetAreaHas: s2a
      };
    }
    try {
      const res = await withLoading(
        'saving',
        'Saving Regional NEP Targets…',
        `Updating Regional NEP Targets for ${targetYear} directly to Live Google Sheet…`,
        () =>
          api('/api/nep-targets', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              year: targetYear,
              targets: payload
            })
          })
      );
      if (res.nepTargets) appState.state.nepTargets = res.nepTargets;
      if (res.nepMilestoneList) appState.state.nepMilestoneList = res.nepMilestoneList;
      if (res.nepProvinceList) appState.state.nepProvinceList = res.nepProvinceList;
      if (res.nepTargetsByYear) appState.state.nepTargetsByYear = res.nepTargetsByYear;
      if (res.nepMilestoneListByYear) appState.state.nepMilestoneListByYear = res.nepMilestoneListByYear;
      if (res.nepProvinceListByYear) appState.state.nepProvinceListByYear = res.nepProvinceListByYear;
      appState.filters.milestoneYear = String(targetYear);
      appState.analytics = res.analytics;
      closeModal();
      renderActiveView();
      toast(
        res.gasSync?.ok
          ? `Saved & synced Regional NEP Targets for ${targetYear} to Live Google Sheet`
          : `Saved Regional NEP Targets locally for ${targetYear}`
      );
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function openLandholdingDrawer(lhid) {
  const displayLhid = formatLhidDisplay(lhid);
  document.getElementById('drawer-title').textContent = `LHID: ${displayLhid}`;
  document.getElementById('drawer-body').innerHTML = '<div class="loading-box">Loading cross-tab parcel dossier…</div>';
  document.getElementById('drawer-backdrop').classList.remove('hidden');

  try {
    const data = await withLoading(
      'fetching',
      'Fetching Parcel Dossier…',
      `Loading cross-tab OPTool & Milestone details for ${displayLhid}…`,
      () => api(`/api/landholding/${encodeURIComponent(displayLhid)}`)
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
                    <div class="kv-val">${esc((c.key === 'lhid' || c.key === 'LHID') ? formatLhidDisplay(row[c.key]) : row[c.key])}</div>
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

    if (appState.currentUser?.role === 'admin' && Array.isArray(data.auditLogs) && data.auditLogs.length > 0) {
      blocks.push(`
        <div class="panel">
          <div class="panel-header" style="display:flex;align-items:center;justify-content:space-between;">
            <h3 class="panel-title">📜 User Edit & Revision History (${data.auditLogs.length})</h3>
            <span class="badge badge-teal" style="font-size:11px;">Tracked Updates</span>
          </div>
          <div class="panel-body">
            <div class="audit-history-timeline" style="display:flex;flex-direction:column;gap:10px;">
              ${data.auditLogs.map((log) => `
                <div class="card" style="padding:10px;border-left:4px solid var(--accent);background:var(--bg-subtle,#f8fafc);margin-bottom:6px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div>
                      <strong>${esc(log.user?.name || 'Staff')}</strong>
                      <span style="color:var(--text-muted);font-size:12px;"> (${esc(log.user?.email || '')})</span>
                      <span class="badge badge-gray" style="font-size:10px;margin-left:4px;">${esc(log.user?.province || '')}</span>
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);">${esc(new Date(log.timestamp).toLocaleString())}</div>
                  </div>
                  <div style="font-size:12px;margin-bottom:6px;">
                    <span class="badge ${log.action === 'create' ? 'badge-blue' : log.action === 'delete' ? 'badge-danger' : 'badge-green'}" style="font-size:10px;text-transform:uppercase;">${esc(log.action)}</span>
                    <strong style="margin-left:6px;">${esc(log.tabName)}</strong>
                  </div>
                  ${log.changes && log.changes.length > 0 ? `
                    <div style="overflow-x:auto;border-radius:4px;border:1px solid var(--border,#e2e8f0);">
                      <table class="table" style="width:100%;font-size:11px;margin:0;">
                        <thead>
                          <tr style="background:var(--bg-alt,#edf2f7);">
                            <th style="padding:4px 8px;">Field</th>
                            <th style="padding:4px 8px;color:#c53030;">Previous Value</th>
                            <th style="padding:4px 8px;color:#276749;">Current / Updated Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${log.changes.map((ch) => `
                            <tr>
                              <td style="padding:4px 8px;font-weight:600;">${esc(ch.label || ch.field)}</td>
                              <td style="padding:4px 8px;background:#fff5f5;color:#c53030;font-family:var(--font-mono);">${esc(ch.oldValue || '— (empty)')}</td>
                              <td style="padding:4px 8px;background:#f0fff4;color:#276749;font-weight:600;font-family:var(--font-mono);">${esc(ch.newValue || '— (empty)')}</td>
                            </tr>
                          `).join('')}
                        </tbody>
                      </table>
                    </div>
                  ` : `<div style="font-size:12px;color:var(--text-muted);">${esc(log.summary || 'Record modified')}</div>`}
                </div>
              `).join('')}
            </div>
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

let usersAutoPollTimer = null;

function startUsersAutoPoll() {
  if (usersAutoPollTimer) return;
  usersAutoPollTimer = setInterval(async () => {
    if (appState.view !== 'users') {
      stopUsersAutoPoll();
      return;
    }
    try {
      const prevPending = appState.pendingUserCount || 0;
      const prevCount = (appState.usersList || []).length;
      const data = await loadUsersDirectory(true);
      if (data && ((data.pendingCount ?? 0) !== prevPending || (data.users || []).length !== prevCount)) {
        renderActiveView();
      }
    } catch (_) {}
  }, 4000);
}

function stopUsersAutoPoll() {
  if (usersAutoPollTimer) {
    clearInterval(usersAutoPollTimer);
    usersAutoPollTimer = null;
  }
}

/** Fetch user registration list for Administrator confirmation management. */
async function loadUsersDirectory(silent = false) {
  const fetcher = () => api('/api/auth/users');
  const data = silent
    ? await fetcher()
    : await withLoading(
        'fetching',
        'Fetching User Accounts…',
        'Loading pending registrations and confirmed regional accounts…',
        fetcher
      );
  appState.usersList = data.users || [];
  appState.pendingUserCount = data.pendingCount || 0;
  syncCurrentUserUi();
  return data;
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

  container.querySelector('#btn-delete-mock-milestones')?.addEventListener('click', async () => {
    const confirmed = confirm(
      'Are you sure you want to delete all mock data across every milestone in every province?\n\n' +
      'This will remove all sample milestone records and mock OPTool rows across all Region VIII provinces.'
    );
    if (!confirmed) return;

    try {
      const res = await withLoading(
        'saving',
        'Deleting Mock Data…',
        'Removing mock milestone records across all Region VIII provinces…',
        () => api('/api/milestones/delete-mock-data', { method: 'POST' })
      );
      if (res.state) {
        appState.state = res.state;
      }
      if (res.analytics) {
        appState.analytics = res.analytics;
      }
      toast(
        `Deleted ${res.deletedMilestonesCount ?? 0} mock milestone records and ${res.deletedOptoolCount ?? 0} mock OPTool rows across all provinces.`
      );
      renderActiveView();
    } catch (err) {
      toast(err.message || 'Failed to delete mock data', true);
    }
  });

  container.querySelectorAll('[data-user-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.userId;
      const userEmail = btn.dataset.userEmail || '';
      const action = btn.dataset.userAction;
      const queryParam = userEmail ? `?email=${encodeURIComponent(userEmail)}` : '';
      if (action === 'delete') {
        const label = btn.dataset.userName || userEmail || userId;
        if (!confirm(`Permanently delete account "${label}"? This removes the user from SALIG and User_Accounts.`)) {
          return;
        }
        try {
          const res = await withLoading(
            'saving',
            'Deleting Account…',
            `Removing ${label} from SALIG & Regional Hub User_Accounts…`,
            () => api(`/api/auth/users/${encodeURIComponent(userId)}${queryParam}`, { method: 'DELETE' })
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
            api(`/api/auth/users/${encodeURIComponent(userId)}/status${queryParam}`, {
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

/** Fetch user edit audit logs with current filters. */
async function loadAuditLogs(filters = {}) {
  const merged = { ...(appState.auditLogsFilters || {}), ...filters };
  appState.auditLogsFilters = merged;
  const params = new URLSearchParams();
  if (merged.search) params.set('lhid', merged.search);
  if (merged.tabName && merged.tabName !== 'all') params.set('tabName', merged.tabName);
  if (merged.action && merged.action !== 'all') params.set('action', merged.action);
  if (merged.user) params.set('user', merged.user);
  params.set('limit', '100');

  const data = await withLoading(
    'fetching',
    'Fetching Log History…',
    'Loading user revisions and parcel edit audit trail…',
    () => api(`/api/audit-logs?${params.toString()}`)
  );
  if (data && data.ok) {
    appState.auditLogs = data.logs || [];
    appState.auditLogsTotal = data.total || 0;
  }
}

/** Attach event listeners for the User Revision Log History view. */
function bindAuditLogsEvents(container) {
  const searchInput = container.querySelector('#audit-filter-search');
  if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        await loadAuditLogs({ search: searchInput.value.trim() });
        renderActiveView();
      }, 300);
    });
  }

  const tabSelect = container.querySelector('#audit-filter-tab');
  if (tabSelect) {
    tabSelect.addEventListener('change', async () => {
      await loadAuditLogs({ tabName: tabSelect.value });
      renderActiveView();
    });
  }

  const actionSelect = container.querySelector('#audit-filter-action');
  if (actionSelect) {
    actionSelect.addEventListener('change', async () => {
      await loadAuditLogs({ action: actionSelect.value });
      renderActiveView();
    });
  }

  container.querySelector('#btn-clear-audit-filters')?.addEventListener('click', async () => {
    appState.auditLogsFilters = {};
    await loadAuditLogs({ search: '', tabName: 'all', action: 'all', user: '' });
    renderActiveView();
  });

  container.querySelector('#btn-refresh-audit-logs')?.addEventListener('click', async () => {
    try {
      await loadAuditLogs();
      renderActiveView();
      toast('Refreshed revision log history');
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.querySelectorAll('.btn-drawer-link').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openLandholdingDrawer(btn.dataset.lhid);
    });
  });
}

function exportLeaseholdCsv() {
  const rawRows = Array.isArray(appState.state?.leasehold) ? appState.state.leasehold : [];
  const effectiveScopeCode = appState.provinceScope?.code || null;
  const effectiveScopeName = appState.provinceScope?.provinceName || null;
  const q = String(appState.leaseholdSearch || '').trim().toLowerCase();

  const filtered = rawRows.filter((r) => {
    if (effectiveScopeCode) {
      const rowProv = String(r.provs || r.PROVS || r.province || '').trim().toLowerCase();
      const scopeLower = effectiveScopeName ? effectiveScopeName.toLowerCase() : '';
      const codeLower = effectiveScopeCode.toLowerCase();
      const matchesScope = rowProv.includes(codeLower) || (scopeLower && rowProv.includes(scopeLower));
      if (!matchesScope) {
        const rowMun = String(r.mun || r.MUN || r.municipality || '').trim();
        const munProv = resolveProvinceCode(rowMun);
        if (munProv !== effectiveScopeCode) return false;
      }
    }
    if (appState.leaseholdProvinceFilter !== 'ALL') {
      const filterLower = appState.leaseholdProvinceFilter.toLowerCase();
      const rProv = String(r.provs || r.PROVS || r.province || '').toLowerCase();
      if (!rProv.includes(filterLower)) return false;
    }
    if (appState.leaseholdStatusFilter !== 'ALL') {
      const rStatus = String(r.statusOfContract || '').trim().toLowerCase();
      if (rStatus !== appState.leaseholdStatusFilter.toLowerCase()) return false;
    }
    if (appState.leaseholdTargetYearFilter !== 'ALL') {
      const rYear = getLeaseholdTargetYear(r);
      if (rYear !== String(appState.leaseholdTargetYearFilter).trim()) return false;
    }
    if (q) {
      const searchable = [
        r.provs, r.mun, r.brgy,
        r.loSurname, r.loFirstname, r.loMi,
        r.titleNo, r.taxDecNo, r.surveyNo, r.lotNo,
        r.leaseholderSurname, r.leaseholderFirstname, r.leaseholderMi,
        r.newLesseeName, r.mainCrops, r.auxilliaryCrops,
        r.statusOfContract, getLeaseholdTargetYear(r), r.reportMonth, r.remarks
      ].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });

  const csvContent = generateLeaseholdCsv(filtered);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const provSuffix = effectiveScopeCode || (appState.leaseholdProvinceFilter !== 'ALL' ? appState.leaseholdProvinceFilter : 'Region8');
  a.href = url;
  a.download = `DAR_Region8_Leasehold_${provSuffix}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Exported ${filtered.length} Leasehold record(s) to CSV.`);
}

function bindLeaseholdEvents(container) {
  const searchInput = container.querySelector('#leasehold-search');
  searchInput?.addEventListener('input', (e) => {
    appState.leaseholdSearch = e.target.value;
    appState.leaseholdPage = 1;
    clearTimeout(leaseholdSearchTimer);
    leaseholdSearchTimer = setTimeout(() => renderActiveView(), 120);
  });

  container.querySelector('#leasehold-province-filter')?.addEventListener('change', (e) => {
    appState.leaseholdProvinceFilter = e.target.value;
    appState.leaseholdPage = 1;
    renderActiveView();
  });

  container.querySelector('#leasehold-status-filter')?.addEventListener('change', (e) => {
    appState.leaseholdStatusFilter = e.target.value;
    appState.leaseholdPage = 1;
    renderActiveView();
  });

  container.querySelector('#leasehold-year-filter')?.addEventListener('change', (e) => {
    appState.leaseholdTargetYearFilter = e.target.value;
    appState.leaseholdPage = 1;
    renderActiveView();
  });

  container.querySelector('#leasehold-page-size')?.addEventListener('change', (e) => {
    appState.leaseholdPageSize = e.target.value;
    appState.leaseholdPage = 1;
    renderActiveView();
  });

  const handlePrev = () => {
    if (appState.leaseholdPage > 1) {
      appState.leaseholdPage--;
      renderActiveView();
    }
  };
  const handleNext = () => {
    appState.leaseholdPage = (appState.leaseholdPage || 1) + 1;
    renderActiveView();
  };
  container.querySelector('#btn-leasehold-prev')?.addEventListener('click', handlePrev);
  container.querySelector('#btn-leasehold-bottom-prev')?.addEventListener('click', handlePrev);
  container.querySelector('#btn-leasehold-next')?.addEventListener('click', handleNext);
  container.querySelector('#btn-leasehold-bottom-next')?.addEventListener('click', handleNext);

  container.querySelector('#btn-leasehold-add')?.addEventListener('click', () => openLeaseholdModal(null, null));
  container.querySelector('#btn-leasehold-empty-add')?.addEventListener('click', () => openLeaseholdModal(null, null));

  container.querySelector('#btn-leasehold-sync-sheets')?.addEventListener('click', async () => {
    try {
      const res = await withLoading(
        'syncing',
        'Syncing Leasehold with Google Sheets…',
        'Synchronizing records with provincial Google Sheets…',
        () => api('/api/leasehold/sync-gas', { method: 'POST' })
      );
      if (res.leasehold) {
        appState.state.leasehold = res.leasehold;
      } else if (res.rows) {
        appState.state.leasehold = res.rows;
      }
      updateNavCounts();
      renderActiveView();
      toast(`Leasehold synchronized with Google Sheets! (${res.pushedCount || 0} local record(s) checked)`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.querySelector('#btn-leasehold-export-csv')?.addEventListener('click', () => {
    exportLeaseholdCsv();
  });

  container.querySelectorAll('[data-edit-leasehold]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rowId = btn.dataset.editLeasehold;
      const idx = btn.dataset.index !== undefined ? Number(btn.dataset.index) : null;
      const existing = (appState.state.leasehold || []).find((r) => r.id === rowId) ||
        (idx !== null ? (appState.state.leasehold || [])[idx] : null);
      if (existing) {
        openLeaseholdModal(existing, idx);
      }
    });
  });

  container.querySelectorAll('[data-del-leasehold]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (appState.currentUser?.role !== 'admin') {
        toast('Administrator access required to delete records. Users are permitted to encode only.', true);
        return;
      }
      const rowId = btn.dataset.delLeasehold;
      const idx = btn.dataset.index !== undefined ? Number(btn.dataset.index) : null;
      const existing = (appState.state.leasehold || []).find((r) => r.id === rowId) ||
        (idx !== null ? (appState.state.leasehold || [])[idx] : null);
      const lhName = existing ? `${existing.leaseholderSurname || ''}, ${existing.leaseholderFirstname || ''}`.trim() : 'record';
      if (!confirm(`Are you sure you want to delete this Leasehold record for "${lhName}"? This action cannot be undone.`)) {
        return;
      }
      try {
        const res = await withLoading(
          'saving',
          'Deleting Leasehold Record…',
          `Removing leasehold record ${lhName}…`,
          () => api(`/api/leasehold/${encodeURIComponent(rowId)}`, { method: 'DELETE' })
        );
        if (res.leasehold) {
          appState.state.leasehold = res.leasehold;
        } else if (res.rows) {
          appState.state.leasehold = res.rows;
        }
        updateNavCounts();
        renderActiveView();
        toast('Deleted Leasehold record.');
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  container.querySelector('#btn-leasehold-fullscreen')?.addEventListener('click', () => {
    togglePanelFullscreen('leasehold-panel');
  });

  bindProvincialAllocationTableEvents(container);
}

function getWhereaboutsFilterContext(viewKey) {
  return {
    state: appState.state,
    schemas: appState.schemas,
    provinceScope: appState.provinceScope,
    whereaboutsColFilters: appState.whereaboutsColFilters,
    whereaboutsProvinceFilter: appState.whereaboutsProvinceFilter,
    whereaboutsStatusFilter: appState.whereaboutsStatusFilter,
    whereaboutsTargetYearFilter: appState.whereaboutsTargetYearFilter,
    whereaboutsSearch: appState.whereaboutsSearch,
    whereaboutsPage: appState.whereaboutsPage
  };
}

function openWhereaboutsColFilterPopover(triggerBtn, colKey, viewKey, container) {
  const existingKey = document.getElementById('col-filter-popover')?.dataset.colKey;
  closeColFilterPopover();
  if (existingKey === `${viewKey}:${colKey}`) return; // Toggle closed on second click

  const filterCtx = getWhereaboutsFilterContext(viewKey);
  const { col, blankCount, totalRows, values } = getWhereaboutsColumnFilterValues(filterCtx, viewKey, colKey);
  if (!col) return;

  const activeColFilters = appState.whereaboutsColFilters[viewKey] || {};
  const currentSpec = activeColFilters[colKey];

  const allValues = values.map((v) => v.value);
  if (blankCount > 0) allValues.push('__BLANK__');

  let selectedSet = new Set();
  let hasActiveFilter = false;

  if (currentSpec) {
    if (Array.isArray(currentSpec.values) && currentSpec.values.length > 0) {
      selectedSet = new Set(currentSpec.values);
      hasActiveFilter = true;
    } else if (currentSpec.value && currentSpec.value !== 'ALL') {
      selectedSet = new Set([String(currentSpec.value)]);
      hasActiveFilter = true;
    }
  } else if (colKey === 'province' && appState.whereaboutsProvinceFilter[viewKey] && appState.whereaboutsProvinceFilter[viewKey] !== 'ALL') {
    selectedSet = new Set([appState.whereaboutsProvinceFilter[viewKey]]);
    hasActiveFilter = true;
  } else if (colKey === 'stage' && appState.whereaboutsStatusFilter[viewKey] && appState.whereaboutsStatusFilter[viewKey] !== 'ALL') {
    selectedSet = new Set([appState.whereaboutsStatusFilter[viewKey]]);
    hasActiveFilter = true;
  }

  // If no filter is active, Excel default is that all options are checked
  if (!hasActiveFilter) {
    selectedSet = new Set(allValues);
  }

  const pop = document.createElement('div');
  pop.id = 'col-filter-popover';
  pop.className = 'col-filter-popover';
  pop.dataset.colKey = `${viewKey}:${colKey}`;

  const searchPlaceholder = `Search ${col.label}…`;
  pop.innerHTML = `
    <div class="col-dd-head">
      <div class="col-dd-title">
        <span>Filter: ${esc(col.label)}</span>
        <span class="col-dd-summary-pill" id="col-dd-summary-pill">${selectedSet.size} of ${allValues.length}</span>
      </div>
      <input
        type="search"
        id="col-dd-search"
        class="col-dd-search"
        placeholder="${esc(searchPlaceholder)}"
        autocomplete="off"
      />
      <div class="col-dd-quick-actions">
        <button type="button" class="col-dd-link-btn" id="col-dd-select-all-btn">Select All</button>
        <span style="color:var(--border-strong)">•</span>
        <button type="button" class="col-dd-link-btn" id="col-dd-clear-all-btn">Clear All</button>
      </div>
    </div>
    <div class="col-dd-list" id="col-dd-list" role="listbox"></div>
    <div class="col-dd-meta" id="col-dd-meta"></div>
    <div class="col-dd-footer">
      <button type="button" class="btn btn-xs btn-secondary" id="col-dd-clear-btn" title="Clear filter (show all)">Clear</button>
      <div class="col-dd-footer-btns">
        <button type="button" class="btn btn-xs btn-outline" id="col-dd-cancel-btn">Cancel</button>
        <button type="button" class="btn btn-xs btn-primary" id="col-dd-apply-btn">OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(pop);

  const rect = triggerBtn.getBoundingClientRect();
  const popWidth = 290;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 12));
  const estimatedHeight = Math.min(380, window.innerHeight - 24);
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const openAbove = spaceBelow < 320 && spaceAbove > spaceBelow;

  pop.style.left = `${left}px`;
  if (openAbove) {
    const bottom = Math.max(8, window.innerHeight - rect.top + 4);
    pop.style.bottom = `${bottom}px`;
    pop.style.maxHeight = `${Math.min(estimatedHeight, rect.top - 16)}px`;
  } else {
    const top = Math.max(8, rect.bottom + 4);
    pop.style.top = `${top}px`;
    pop.style.maxHeight = `${Math.min(estimatedHeight, window.innerHeight - top - 12)}px`;
  }

  const listEl = pop.querySelector('#col-dd-list');
  const metaEl = pop.querySelector('#col-dd-meta');
  const searchEl = pop.querySelector('#col-dd-search');

  const applyWhereaboutsFilter = (spec) => {
    if (!appState.whereaboutsColFilters[viewKey]) {
      appState.whereaboutsColFilters[viewKey] = {};
    }
    if (
      !spec ||
      (spec.values && spec.values.length === 0) ||
      (spec.values && spec.values.length === allValues.length) ||
      spec.value === 'ALL'
    ) {
      delete appState.whereaboutsColFilters[viewKey][colKey];
      if (colKey === 'province') {
        appState.whereaboutsProvinceFilter[viewKey] = 'ALL';
      }
      if (colKey === 'stage') {
        appState.whereaboutsStatusFilter[viewKey] = 'ALL';
      }
    } else {
      appState.whereaboutsColFilters[viewKey][colKey] = spec;
      if (colKey === 'province') {
        appState.whereaboutsProvinceFilter[viewKey] =
          spec.values && spec.values.length === 1 ? spec.values[0] : (spec.value || 'ALL');
      }
      if (colKey === 'stage') {
        appState.whereaboutsStatusFilter[viewKey] =
          spec.values && spec.values.length === 1 ? spec.values[0] : (spec.value || 'ALL');
      }
    }
    appState.whereaboutsPage[viewKey] = 1;
    closeColFilterPopover();
    renderActiveView();
  };

  const updateSummaryPill = () => {
    const pill = pop.querySelector('#col-dd-summary-pill');
    if (pill) {
      if (allValues.length === 0) {
        pill.textContent = '0 options';
      } else if (selectedSet.size === allValues.length) {
        pill.textContent = `(All) ${allValues.length}`;
      } else if (selectedSet.size === 0) {
        pill.textContent = '0 selected';
      } else {
        pill.textContent = `${selectedSet.size} of ${allValues.length}`;
      }
    }
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

    const isAllChecked = allValues.length > 0 && selectedSet.size === allValues.length;
    const isSomeChecked = selectedSet.size > 0 && selectedSet.size < allValues.length;

    if (!q) {
      parts.push(`
        <div class="col-dd-item col-dd-select-all" role="option">
          <input type="checkbox" class="col-dd-check" id="col-dd-check-all" ${isAllChecked ? 'checked' : ''} />
          <span class="col-dd-val"><strong>(Select All)</strong></span>
          <span class="col-dd-count">${totalRows}</span>
        </div>
      `);
      if (blankCount > 0) {
        const isBlankChecked = selectedSet.has('__BLANK__');
        parts.push(`
          <div class="col-dd-item ${isBlankChecked ? 'selected' : ''}" role="option" aria-selected="${isBlankChecked ? 'true' : 'false'}" data-item-val="__BLANK__">
            <input type="checkbox" class="col-dd-check" data-dd-val="__BLANK__" ${isBlankChecked ? 'checked' : ''} />
            <span class="col-dd-val">(Blank / Pending)</span>
            <span class="col-dd-count">${blankCount}</span>
            <button type="button" class="col-dd-only-btn" data-only-val="__BLANK__" title="Select only (Blank)">only</button>
          </div>
        `);
      }
    } else {
      const visibleVals = shown.map((v) => v.value);
      const allSearchChecked = visibleVals.length > 0 && visibleVals.every((v) => selectedSet.has(v));
      parts.push(`
        <div class="col-dd-item col-dd-select-all" role="option">
          <input type="checkbox" class="col-dd-check" id="col-dd-check-search-all" ${allSearchChecked ? 'checked' : ''} />
          <span class="col-dd-val"><strong>(Select All Search Results)</strong></span>
          <span class="col-dd-count">${filtered.length}</span>
        </div>
      `);
    }

    for (const item of shown) {
      const isChecked = selectedSet.has(item.value);
      parts.push(`
        <div class="col-dd-item ${isChecked ? 'selected' : ''}" role="option" aria-selected="${isChecked ? 'true' : 'false'}" data-item-val="${esc(item.value)}">
          <input type="checkbox" class="col-dd-check" data-dd-val="${esc(item.value)}" ${isChecked ? 'checked' : ''} />
          <span class="col-dd-val" title="${esc(item.value)}">${esc(item.value)}</span>
          <span class="col-dd-count">${item.count}</span>
          <button type="button" class="col-dd-only-btn" data-only-val="${esc(item.value)}" title="Select only ${esc(item.value)}">only</button>
        </div>
      `);
    }

    if (filtered.length === 0) {
      parts.push('<div class="col-dd-empty" style="padding:10px;font-size:12px;color:var(--text-muted);">No matching options</div>');
    }

    listEl.innerHTML = parts.join('');

    const checkAll = listEl.querySelector('#col-dd-check-all');
    if (checkAll) {
      checkAll.indeterminate = isSomeChecked;
    }

    metaEl.textContent = `${values.length} distinct value(s)${
      shown.length < filtered.length ? ` · showing first ${shown.length}` : ''
    }`;
    updateSummaryPill();
  };

  renderList('');

  pop.querySelector('#col-dd-select-all-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    allValues.forEach((v) => selectedSet.add(v));
    renderList(searchEl.value);
  });

  pop.querySelector('#col-dd-clear-all-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    selectedSet.clear();
    renderList(searchEl.value);
  });

  listEl.addEventListener('click', (e) => {
    // 1. If clicked "only" button
    const onlyBtn = e.target.closest('.col-dd-only-btn');
    if (onlyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const val = onlyBtn.dataset.onlyVal;
      applyWhereaboutsFilter({
        mode: 'multi',
        values: [val],
        value: val === '__BLANK__' ? '(Blank)' : val
      });
      return;
    }

    // 2. If clicked "Select All"
    const selectAllItem = e.target.closest('.col-dd-select-all');
    if (selectAllItem) {
      e.preventDefault();
      const isSearchAll = Boolean(selectAllItem.querySelector('#col-dd-check-search-all'));
      if (isSearchAll) {
        const visibleVals = lastFiltered.map((v) => v.value);
        const allVisibleChecked = visibleVals.length > 0 && visibleVals.every((v) => selectedSet.has(v));
        if (allVisibleChecked) {
          visibleVals.forEach((v) => selectedSet.delete(v));
        } else {
          visibleVals.forEach((v) => selectedSet.add(v));
        }
      } else {
        if (selectedSet.size === allValues.length) {
          selectedSet.clear();
        } else {
          allValues.forEach((v) => selectedSet.add(v));
        }
      }
      renderList(searchEl.value);
      return;
    }

    // 3. If clicked regular item row, text, or checkbox
    const itemEl = e.target.closest('.col-dd-item');
    if (!itemEl) return;
    const check = itemEl.querySelector('.col-dd-check');
    if (!check) return;
    const val = check.dataset.ddVal;
    if (val === undefined) return;

    if (e.target !== check) {
      check.checked = !check.checked;
    }

    if (check.checked) {
      selectedSet.add(val);
      itemEl.classList.add('selected');
      itemEl.setAttribute('aria-selected', 'true');
    } else {
      selectedSet.delete(val);
      itemEl.classList.remove('selected');
      itemEl.setAttribute('aria-selected', 'false');
    }

    const checkAll = listEl.querySelector('#col-dd-check-all');
    if (checkAll) {
      checkAll.checked = selectedSet.size === allValues.length;
      checkAll.indeterminate = selectedSet.size > 0 && selectedSet.size < allValues.length;
    }
    updateSummaryPill();
  });

  listEl.addEventListener('dblclick', (e) => {
    const itemEl = e.target.closest('.col-dd-item:not(.col-dd-select-all)');
    if (!itemEl) return;
    const check = itemEl.querySelector('.col-dd-check');
    if (!check) return;
    const val = check.dataset.ddVal;
    if (val === undefined) return;
    applyWhereaboutsFilter({
      mode: 'multi',
      values: [val],
      value: val === '__BLANK__' ? '(Blank)' : val
    });
  });

  pop.querySelector('#col-dd-apply-btn')?.addEventListener('click', () => {
    if (selectedSet.size === 0 || selectedSet.size === allValues.length) {
      applyWhereaboutsFilter(null);
    } else {
      const arr = Array.from(selectedSet);
      applyWhereaboutsFilter({
        mode: 'multi',
        values: arr,
        value: arr.map((v) => (v === '__BLANK__' ? '(Blank)' : v)).join(', ')
      });
    }
  });

  pop.querySelector('#col-dd-clear-btn')?.addEventListener('click', () => {
    applyWhereaboutsFilter(null);
  });

  pop.querySelector('#col-dd-cancel-btn')?.addEventListener('click', () => {
    closeColFilterPopover();
  });

  searchEl.addEventListener('input', (e) => {
    renderList(e.target.value);
  });

  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      pop.querySelector('#col-dd-apply-btn')?.click();
    } else if (e.key === 'Escape') {
      closeColFilterPopover();
    }
  });

  const onDocClick = (e) => {
    if (!pop.contains(e.target) && !triggerBtn.contains(e.target)) {
      closeColFilterPopover();
    }
  };
  const onDocKey = (e) => {
    if (e.key === 'Escape') closeColFilterPopover();
  };

  setTimeout(() => {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKey);
    searchEl.focus();
  }, 10);

  closeColPopoverFn = () => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKey);
    pop.remove();
  };
}

function bindWhereaboutsEvents(container, viewKey) {
  const searchInput = container.querySelector('#whereabouts-search');
  searchInput?.addEventListener('input', (e) => {
    appState.whereaboutsSearch[viewKey] = e.target.value;
    appState.whereaboutsPage[viewKey] = 1;
    const pos = e.target.selectionStart;
    renderActiveView();
    const nextInput = document.getElementById('whereabouts-search');
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(pos, pos);
    }
  });

  container.querySelector('#whereabouts-province-filter')?.addEventListener('change', (e) => {
    const val = e.target.value;
    appState.whereaboutsProvinceFilter[viewKey] = val;
    if (!appState.whereaboutsColFilters[viewKey]) {
      appState.whereaboutsColFilters[viewKey] = {};
    }
    if (val === 'ALL') {
      delete appState.whereaboutsColFilters[viewKey].province;
    } else {
      appState.whereaboutsColFilters[viewKey].province = { mode: 'exact', value: val };
    }
    appState.whereaboutsPage[viewKey] = 1;
    renderActiveView();
  });

  container.querySelector('#whereabouts-status-filter')?.addEventListener('change', (e) => {
    const val = e.target.value;
    appState.whereaboutsStatusFilter[viewKey] = val;
    if (!appState.whereaboutsColFilters[viewKey]) {
      appState.whereaboutsColFilters[viewKey] = {};
    }
    if (val === 'ALL') {
      delete appState.whereaboutsColFilters[viewKey].stage;
    } else if (!val.startsWith('with_') && val !== 'all_complete' && val !== 'pending') {
      appState.whereaboutsColFilters[viewKey].stage = { mode: 'exact', value: val };
    }
    appState.whereaboutsPage[viewKey] = 1;
    renderActiveView();
  });

  container.querySelectorAll('.whereabouts-target-year-select, #whereabouts-target-year-filter').forEach((el) => {
    el.addEventListener('change', (e) => {
      appState.whereaboutsTargetYearFilter[viewKey] = e.target.value;
      appState.whereaboutsPage[viewKey] = 1;
      renderActiveView();
    });
  });

  container.querySelector('#cf-status-survey-filter')?.addEventListener('change', (e) => {
    appState.cfSurveyFilter = e.target.value;
    appState.whereaboutsPage[viewKey] = 1;
    renderActiveView();
  });

  container.querySelectorAll('[data-cf-survey-kpi]').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetVal = card.dataset.cfSurveyKpi;
      appState.cfSurveyFilter = (appState.cfSurveyFilter === targetVal) ? 'ALL' : targetVal;
      appState.whereaboutsPage[viewKey] = 1;
      renderActiveView();
    });
  });

  container.querySelector('#btn-survey-status-refresh')?.addEventListener('click', () => {
    renderActiveView();
  });

  container.querySelector('#btn-cf-status-refresh')?.addEventListener('click', () => {
    renderActiveView();
  });

  container.querySelectorAll('[data-cf-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!appState.whereaboutsMetricMode) appState.whereaboutsMetricMode = {};
      appState.whereaboutsMetricMode[viewKey] = btn.dataset.cfMetric;
      appState.cfMetricMode = btn.dataset.cfMetric;
      renderActiveView();
    });
  });

  container.querySelectorAll('[data-cf-layout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!appState.whereaboutsTableLayout) appState.whereaboutsTableLayout = {};
      appState.whereaboutsTableLayout[viewKey] = btn.dataset.cfLayout;
      appState.cfTableLayout = btn.dataset.cfLayout;
      renderActiveView();
    });
  });

  container.querySelectorAll('[data-survey-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.surveyMetricMode = btn.dataset.surveyMetric;
      renderActiveView();
    });
  });

  container.querySelectorAll('[data-survey-indicator-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.surveyIndicatorTab = btn.dataset.surveyIndicatorTab;
      renderActiveView();
    });
  });

  container.querySelectorAll('[data-survey-matrix-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.surveyMatrixMode = btn.dataset.surveyMatrixMode;
      renderActiveView();
    });
  });

  container.querySelectorAll('[data-survey-matrix-filter-status]').forEach((th) => {
    th.addEventListener('click', () => {
      const st = th.dataset.surveyMatrixFilterStatus;
      if (st) {
        if (appState.whereaboutsStatusFilter[viewKey] === st) {
          appState.whereaboutsStatusFilter[viewKey] = 'ALL';
        } else {
          appState.whereaboutsStatusFilter[viewKey] = st;
        }
        appState.whereaboutsPage[viewKey] = 1;
        renderActiveView();
      }
    });
  });

  container.querySelectorAll('[data-survey-filter-province]').forEach((el) => {
    el.addEventListener('click', () => {
      const pName = el.dataset.surveyFilterProvince;
      if (pName) {
        if (!appState.whereaboutsColFilters[viewKey]) {
          appState.whereaboutsColFilters[viewKey] = {};
        }
        const curProvSpec = appState.whereaboutsColFilters[viewKey].province;
        const isAlreadyFiltered = curProvSpec && Array.isArray(curProvSpec.values) && curProvSpec.values.includes(pName);
        if (isAlreadyFiltered) {
          delete appState.whereaboutsColFilters[viewKey].province;
          appState.whereaboutsProvinceFilter[viewKey] = 'ALL';
        } else {
          appState.whereaboutsColFilters[viewKey].province = { mode: 'exact', values: [pName] };
          appState.whereaboutsProvinceFilter[viewKey] = pName;
        }
        appState.whereaboutsPage[viewKey] = 1;
        renderActiveView();
      }
    });
  });

  container.querySelector('#btn-whereabouts-clear-all-filters')?.addEventListener('click', () => {
    appState.whereaboutsColFilters[viewKey] = {};
    appState.whereaboutsProvinceFilter[viewKey] = 'ALL';
    appState.whereaboutsStatusFilter[viewKey] = 'ALL';
    appState.whereaboutsTargetYearFilter[viewKey] = 'ALL';
    appState.cfSurveyFilter = 'ALL';
    appState.whereaboutsSearch[viewKey] = '';
    appState.whereaboutsPage[viewKey] = 1;
    closeColFilterPopover();
    renderActiveView();
  });

  // Attach column dropdown click listeners for table headers
  container.querySelectorAll('[data-whereabouts-col-dropdown]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openWhereaboutsColFilterPopover(btn, btn.dataset.whereaboutsColDropdown, viewKey, container);
    });
  });

  container.querySelector('#btn-whereabouts-toggle-graph')?.addEventListener('click', () => {
    appState.whereaboutsShowGraph[viewKey] = !appState.whereaboutsShowGraph[viewKey];
    renderActiveView();
  });

  container.querySelectorAll('[data-whereabouts-view-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.whereaboutsGraphMode[viewKey] = btn.dataset.whereaboutsViewMode;
      renderActiveView();
    });
  });

  container.querySelectorAll('[data-whereabouts-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.whereaboutsPage[viewKey] = Number(btn.dataset.whereaboutsPage) || 1;
      renderActiveView();
    });
  });

  container.querySelectorAll('.whereabouts-page-size-select, #whereabouts-page-size').forEach((el) => {
    el.addEventListener('change', (e) => {
      if (!appState.whereaboutsPageSize) appState.whereaboutsPageSize = {};
      appState.whereaboutsPageSize[viewKey] = e.target.value;
      appState.whereaboutsPage[viewKey] = 1;
      renderActiveView();
    });
  });

  container.querySelectorAll('[data-whereabouts-hscroll], [data-hscroll]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const delta = Number(btn.dataset.whereaboutsHscroll || btn.dataset.hscroll) || 0;
      const targetWrap =
        btn.closest('.panel')?.querySelector('#whereabouts-table-wrap, .whereabouts-table-wrap, .table-wrap') ||
        container.querySelector('#whereabouts-table-wrap');
      if (targetWrap) {
        targetWrap.scrollBy({ left: delta, behavior: 'smooth' });
      }
    });
  });

  container.querySelectorAll('[data-open-optool-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.editTab || btn.dataset.openOptoolTab;
      const lhid = btn.dataset.editLhid || btn.dataset.filterLhid || btn.dataset.lhid;
      const rawIdx = btn.dataset.editRowIndex;

      // When clicked from a table row (has editRowIndex or editLhid), DIRECT TO THE EDIT ACTION!
      if ((rawIdx !== undefined && rawIdx !== '') || lhid) {
        const tabRows = appState.state?.optool?.[tabName] || [];
        let idx = rawIdx !== undefined && rawIdx !== '' ? Number(rawIdx) : -1;
        let row = idx >= 0 && tabRows[idx] ? tabRows[idx] : null;

        if (!row && lhid) {
          const cleanLhid = formatLhidDisplay(lhid).toLowerCase();
          const foundIdx = tabRows.findIndex(
            (r) => formatLhidDisplay(r.lhid || r.LHID).toLowerCase() === cleanLhid
          );
          if (foundIdx >= 0) {
            idx = foundIdx;
            row = tabRows[foundIdx];
          }
        }

        if (row && idx >= 0) {
          appState.activeOptoolTab = tabName;
          if (lhid) {
            appState.optoolSearch = formatLhidDisplay(lhid);
          }
          if (tabName === 'Leasehold') {
            openLeaseholdModal(row, idx);
          } else {
            openOptoolModal(tabName, row, idx);
          }
          return;
        }
      }

      // Default behavior for general toolbar buttons: switch to OPTool tab
      appState.activeOptoolTab = tabName;
      appState.optoolPage = 1;
      appState.optoolColPage = 1;
      appState.view = 'optool';
      renderActiveView();
    });
  });

  container.querySelectorAll('[data-lhid]').forEach((btn) => {
    btn.addEventListener('click', () => openLandholdingDrawer(btn.dataset.lhid));
  });

  container.querySelectorAll('[data-open-survey-support-list]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const prov = btn.dataset.province || 'ALL';
      const st = btn.dataset.status || 'ALL';
      const stageKey = btn.dataset.stageKey || '';
      const stageLabel = btn.dataset.stageLabel || '';
      const mode = btn.dataset.mode || 'accomplished';
      const balanceArea = btn.dataset.balanceArea || '';
      openSurveySupportListModal({ province: prov, status: st, stageKey, stageLabel, mode, balanceArea });
    });
  });

  container.querySelectorAll('[data-open-cf-support-list]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const prov = btn.dataset.province || 'ALL';
      const st = btn.dataset.status || 'ALL';
      const stageKey = btn.dataset.stageKey || '';
      const stageLabel = btn.dataset.stageLabel || '';
      const mode = btn.dataset.mode || 'accomplished';
      const balanceArea = btn.dataset.balanceArea || '';
      const btnViewKey = btn.dataset.viewKey || viewKey;
      const btnTabName = btn.dataset.tabName || WHEREABOUTS_CONFIGS[btnViewKey]?.tabName || 'CF(DOC)';
      openCfSupportListModal({
        province: prov,
        status: st,
        stageKey,
        stageLabel,
        mode,
        balanceArea,
        viewKey: btnViewKey,
        tabName: btnTabName
      });
    });
  });

  container.querySelector('#btn-whereabouts-export-csv')?.addEventListener('click', () => {
    exportWhereaboutsCsv(viewKey);
  });

  bindProvincialAllocationTableEvents(container);

  const whereaboutsTabMap = {
    'cf-whereabouts': 'CF(DOC)',
    'survey-whereabouts': 'Survey',
    'mov-whereabouts': 'MOV',
    'regdist-whereabouts': 'RegistrationDistribution',
    'installation-whereabouts': 'Installation'
  };
  const matchedTab = whereaboutsTabMap[viewKey];
  if (matchedTab) {
    appState.activeOptoolTab = matchedTab;
    bindOptoolViewEvents(container);
  }
}

function exportWhereaboutsCsv(viewKey) {
  const cfg = WHEREABOUTS_CONFIGS[viewKey];
  if (!cfg) return;

  const rawRows = appState.state?.optool?.[cfg.tabName] || [];
  const dbRows = appState.state?.optool?.Database || [];
  const dbMap = new Map();
  for (const db of dbRows) {
    const k = String(db.lhid || '').trim().toLowerCase();
    if (k && !dbMap.has(k)) dbMap.set(k, db);
  }

  const enrichedRows = rawRows.map((row) => {
    const lhidKey = String(row.lhid || '').trim().toLowerCase();
    const db = dbMap.get(lhidKey) || {};
    const carpableNum = Number(db.totalArea || row.totalArea || db.carpable || row.carpable || row.areaHas || row.areaHas1 || row.areaHas2 || row.computedArea || 0) || 0;
    const provName = db.province || row.province || (appState.provinceScope ? appState.provinceScope.provinceName : 'Unknown');
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
    let stage = '';
    if (viewKey === 'survey-whereabouts') {
      const apStatus = String(row.currentStatus || '').trim();
      const derived = resolveSurveyCurrentStatus(row).currentStatus;
      stage = apStatus || derived || 'Pending Survey';
    } else {
      stage = cfg.resolveStage({ ...row, ...datesMap }).stage;
    }

    return {
      lhid: row.lhid || db.lhid || '—',
      province: provName,
      municipality: muniName,
      barangay: brgyName,
      titleNumber: titleNum,
      landOwner: landOwner,
      totalArea: carpableNum.toFixed(4),
      carpable: carpableNum.toFixed(4),
      areaHas: carpableNum.toFixed(4),
      currentStatus: row.currentStatus || stage,
      datesMap,
      isAllDatesPopulated,
      stage
    };
  });

  const searchVal = (appState.whereaboutsSearch?.[viewKey] || '').trim().toLowerCase();
  const provFilterVal = appState.whereaboutsProvinceFilter?.[viewKey] || 'ALL';
  const statusFilterVal = appState.whereaboutsStatusFilter?.[viewKey] || 'ALL';
  const targetYearVal = appState.whereaboutsTargetYearFilter?.[viewKey] || 'ALL';

  let rows = enrichedRows;
  if (provFilterVal && provFilterVal !== 'ALL') {
    const fNorm = provFilterVal.trim().toUpperCase();
    rows = rows.filter((r) => r.province.toUpperCase().includes(fNorm));
  }
  if (targetYearVal && targetYearVal !== 'ALL') {
    rows = rows.filter((r) => matchesWhereaboutsTargetYear(r, targetYearVal));
  }
  if (statusFilterVal !== 'ALL') {
    if (statusFilterVal === 'all_complete') {
      rows = rows.filter((r) => r.isAllDatesPopulated);
    } else if (statusFilterVal === 'pending') {
      rows = rows.filter((r) => !r.isAllDatesPopulated);
    } else if (statusFilterVal.startsWith('with_')) {
      const dKey = statusFilterVal.replace('with_', '');
      rows = rows.filter((r) => Boolean(r.datesMap[dKey]));
    } else {
      rows = rows.filter((r) => {
        const rowStatus = String(r.currentStatus || r.stage || '').trim().toLowerCase();
        const targetStatus = String(statusFilterVal).trim().toLowerCase();
        return rowStatus === targetStatus || rowStatus.includes(targetStatus);
      });
    }
  }
  if (searchVal) {
    rows = rows.filter((r) => {
      const dateText = Object.values(r.datesMap).join(' ');
      const hay = `${r.lhid} ${r.province} ${r.municipality} ${r.barangay} ${r.landOwner} ${r.titleNumber} ${dateText} ${r.stage}`.toLowerCase();
      return hay.includes(searchVal);
    });
  }

  const dateHeaders = cfg.dates.map((d) => d.label.replace(/\n/g, ' '));
  const headers = ['LHID', 'Province', 'Municipality', 'Barangay', 'TitleNumber', 'LandOwner', 'CARPable_HAS', ...dateHeaders, 'Whereabouts_Status'];
  const headerLine = headers.map((h) => `"${h}"`).join(',');
  const lines = rows.map((r) => {
    const dateVals = cfg.dates.map((d) => r.datesMap[d.key] || 'Pending');
    return [
      r.lhid,
      r.province,
      r.municipality,
      r.barangay,
      r.titleNumber,
      r.landOwner,
      r.carpable,
      ...dateVals,
      r.stage
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const blob = new Blob([[headerLine, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${cfg.tabName}_Whereabouts_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function getCfSupportRows(appState, tabName = 'CF(DOC)') {
  const rawRows = appState.state?.optool?.[tabName] || [];
  const dbRows = appState.state?.optool?.Database || [];
  const dbMap = new Map();
  for (const db of dbRows) {
    const k = String(db.lhid || '').trim().toLowerCase();
    if (k && !dbMap.has(k)) dbMap.set(k, db);
  }

  const cfgEntry = Object.values(WHEREABOUTS_CONFIGS).find((c) => c.tabName === tabName) || WHEREABOUTS_CONFIGS['cf-whereabouts'];

  return rawRows.map((row) => {
    const lhidKey = String(row.lhid || '').trim().toLowerCase();
    const db = dbMap.get(lhidKey) || {};
    const carpableNum = Number(db.totalArea || row.totalArea || db.carpable || row.carpable || row.areaHas || row.areaHas1 || row.areaHas2 || row.computedArea || 0) || 0;
    const provName = db.province || row.province || (appState.provinceScope ? appState.provinceScope.provinceName : 'Unknown');
    const muniName = db.municipality || row.municipality || '—';
    const brgyName = db.barangay || row.barangay || '—';
    const titleNum = db.titleNumber || row.titleNumber || row.rodTitleNo || row.titleOrTaxDecNo || '—';
    const landOwner = db.landOwner || row.landOwner || (row.loLastName ? `${row.loLastName}, ${row.loFirstName || ''}` : '') || row.arbName || '—';

    const stageObj = cfgEntry.resolveStage ? cfgEntry.resolveStage(row) : { stage: row.currentStatus || 'Pending' };
    const stage = stageObj.stage || row.currentStatus || 'Pending';

    const datesMap = {};
    if (Array.isArray(cfgEntry.dates)) {
      for (const d of cfgEntry.dates) {
        let rawVal = String(row[d.key] || row.datesMap?.[d.key] || '').trim();
        if (!rawVal && (tabName === 'MOV' || cfgEntry.tabName === 'MOV')) {
          if (d.key === 'ppuDate') {
            rawVal = String(row['PPU Date'] || row['PPU DATE'] || row['WITH PPU DATE'] || row.ppu || row.B || '').trim();
          } else if (d.key === 'dateReceivedDarpo') {
            rawVal = String(row['Date Received at DARPO'] || row['Date Received DARPO'] || row['Received DARPO'] || row['WITH RECEIVED DARPO'] || row['RECEIVED DARPO'] || row.date_received_darpo || row.D || '').trim();
          } else if (d.key === 'dateOfMov') {
            rawVal = String(row['Date of MOV'] || row['DATE OF MOV'] || row['WITH DATE OF MOV'] || row['MOV Date'] || row.date_of_mov || row.F || '').trim();
          } else if (d.key === 'dateTransLbpAoc') {
            rawVal = String(row['Date Trans to LBP/AOC'] || row['Date Transmitted to LBP/AOC'] || row['TRANS TO LBP/AOC'] || row['WITH TRANS TO LBP/AOC'] || row['Trans to LBP/AOC'] || row.date_trans_lbp_aoc || row.G || '').trim();
          } else if (d.key === 'reportedMonth') {
            rawVal = String(row['Reported Month'] || row['REPORTED MONTH'] || row['WITH REPORTED MONTH'] || row['Month Reported'] || row.monthReported || row.K || '').trim();
          }
        }
        datesMap[d.key] = rawVal;
      }
    }
    if (row.dateFiConducted) datesMap.dateFiConducted = row.dateFiConducted;
    if (row.datePreparedSigned) datesMap.datePreparedSigned = row.datePreparedSigned;
    if (row.reportedMonth) datesMap.reportedMonth = row.reportedMonth;

    let rowTargetYear = row.targetYear || row['Year Target'] || row['YEAR TARGET'] || row['Target Year'] || row['TARGET YEAR'] || row.year || '';
    if (!rowTargetYear && (tabName === 'MOV' || cfgEntry.tabName === 'MOV') && row.M) {
      rowTargetYear = row.M;
    }
    if (!rowTargetYear) {
      rowTargetYear = db.targetYear || db.year || '';
    }
    const ymTarget = String(rowTargetYear).trim().replace(/\.0$/, '').match(/\b(20\d{2})\b/);
    const resolvedTargetYear = ymTarget ? ymTarget[1] : String(rowTargetYear).trim();

    return {
      ...row,
      lhid: row.lhid || db.lhid || '—',
      province: provName,
      municipality: muniName,
      barangay: brgyName,
      titleNumber: titleNum,
      landOwner: landOwner,
      totalArea: carpableNum,
      carpable: carpableNum,
      areaHas: carpableNum,
      currentStatus: row.currentStatus || stage,
      stage,
      targetYear: formatYearDisplay(resolvedTargetYear),
      target: row.target || db.target || 'Current',
      surveyRequirement: row.surveyRequirement || db.surveyRequirement || '',
      datesMap
    };
  });
}

function openCfSupportListModal({
  province = 'ALL',
  status = 'ALL',
  stageKey = '',
  stageLabel = '',
  mode = 'accomplished',
  balanceArea = '',
  viewKey = 'cf-whereabouts',
  tabName = 'CF(DOC)'
}) {
  const cfg = WHEREABOUTS_CONFIGS[viewKey] || Object.values(WHEREABOUTS_CONFIGS).find((c) => c.tabName === tabName) || WHEREABOUTS_CONFIGS['cf-whereabouts'];
  const effectiveTabName = cfg.tabName || tabName || 'CF(DOC)';
  const allRows = getCfSupportRows(appState, effectiveTabName);
  const curYear = new Date().getFullYear();
  const targetYear = appState.whereaboutsTargetYearFilter?.[viewKey] || appState.whereaboutsTargetYearFilter?.['cf-whereabouts'] || 'ALL';
  const q = String(appState.whereaboutsSearch?.[viewKey] || appState.whereaboutsSearch?.['cf-whereabouts'] || '').trim().toLowerCase();
  const isBalanceMode = mode === 'balance' || mode === 'pending';
  const isTargetMode = mode === 'target';

  let matchedRows = [];

  if (isTargetMode) {
    const dbRows = appState.state?.optool?.Database || [];
    matchedRows = dbRows.filter((d) => {
      if (province && province !== 'ALL') {
        if (!matchProvinceName(d.province, province)) return false;
      }
      if (targetYear !== 'ALL') {
        if (!matchesWhereaboutsTargetYear(d, targetYear, curYear)) return false;
      }
      return true;
    }).map((d) => ({
      ...d,
      totalArea: Number(d.totalArea || d.carpable || d.areaHas || d.computedArea || 0) || 0,
      carpable: Number(d.totalArea || d.carpable || d.areaHas || d.computedArea || 0) || 0,
      stage: 'Target Pool',
      currentStatus: d.optoolStatus || d.currentStatusDescription || 'Workable Database Parcel',
      datesMap: {}
    }));

    const tagged = matchedRows.filter((r) => matchesMilestoneDatabaseTag(r, viewKey));
    if (tagged.length > 0) {
      matchedRows = tagged;
    }
  } else {
    matchedRows = allRows.filter((r) => {
      if (targetYear !== 'ALL') {
        if (!matchesWhereaboutsTargetYear(r, targetYear, curYear)) return false;
      }
      if (province && province !== 'ALL') {
        if (!matchProvinceName(r.province, province)) return false;
      }
      if (stageKey) {
        const rawDate = r[stageKey] || r.datesMap?.[stageKey] || '';
        let hasDate = isMilestoneDatePopulated(rawDate);
        if (hasDate && effectiveTabName === 'MOV' && stageKey === 'reportedMonth') {
          const repMonth = String(rawDate).trim();
          const ym = String(r.targetYear || '').trim().match(/\b(20\d{2})\b/);
          const rowTargetYear = ym ? Number(ym[1]) : (targetYear !== 'ALL' ? Number(targetYear) : null);
          if (rowTargetYear) {
            const wordMatch = repMonth.match(/\b([A-Za-z]+)\s*,?\s*(\d{4})\b/);
            if (wordMatch && Number(wordMatch[2]) !== rowTargetYear) {
              hasDate = false;
            }
          }
        }
        if (isBalanceMode) {
          if (hasDate) return false;
        } else {
          if (!hasDate) return false;
        }
      }
      if (q) {
        const hay = `${r.lhid} ${r.province} ${r.municipality} ${r.barangay} ${r.landOwner} ${r.titleNumber} ${r.stage} ${r.currentStatus}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  const totalArea = matchedRows.reduce((sum, r) => sum + (Number(r.carpable) || 0), 0);
  const provLabel = province === 'ALL' ? 'Region VIII' : province;
  let statusLabel = '';
  if (isTargetMode) {
    statusLabel = 'NEP Target Workable Pool';
  } else if (isBalanceMode) {
    statusLabel = stageLabel ? `Balance / Pending: ${stageLabel}` : 'Balance / Pending';
  } else {
    statusLabel = status === 'ALL' ? (stageLabel || (stageKey ? 'Accomplished Milestones' : `All ${effectiveTabName} Records`)) : status;
  }
  const modalTitle = `${effectiveTabName} Support List: ${provLabel} • ${statusLabel}`;

  const modalHtml = renderCfSupportListModalHtml({
    rows: matchedRows,
    province,
    status,
    stageKey,
    stageLabel,
    targetYear,
    totalArea,
    mode,
    balanceArea,
    tabName: effectiveTabName,
    dates: cfg.dates
  });

  showModal(modalTitle, modalHtml);
  bindSupportListModalEvents(matchedRows, {
    province,
    status,
    stageKey,
    targetYear,
    mode,
    balanceArea,
    viewKey,
    tabName: effectiveTabName,
    dates: cfg.dates
  });
}

function getSurveySupportRows(appState) {
  const rawRows = appState.state?.optool?.Survey || [];
  const dbRows = appState.state?.optool?.Database || [];
  const dbMap = new Map();
  for (const db of dbRows) {
    const k = String(db.lhid || '').trim().toLowerCase();
    if (k && !dbMap.has(k)) dbMap.set(k, db);
  }

  return rawRows.map((row) => {
    const lhidKey = String(row.lhid || '').trim().toLowerCase();
    const db = dbMap.get(lhidKey) || {};
    const carpableNum = Number(db.totalArea || row.totalArea || db.carpable || row.carpable || row.areaHas || row.areaHas1 || row.areaHas2 || row.computedArea || 0) || 0;
    const provName = db.province || row.province || (appState.provinceScope ? appState.provinceScope.provinceName : 'Unknown');
    const muniName = db.municipality || row.municipality || '—';
    const brgyName = db.barangay || row.barangay || '—';
    const titleNum = db.titleNumber || row.titleNumber || row.rodTitleNo || row.titleOrTaxDecNo || '—';
    const landOwner = db.landOwner || row.landOwner || (row.loLastName ? `${row.loLastName}, ${row.loFirstName || ''}` : '') || row.arbName || '—';

    const apStatus = String(row.currentStatus || '').trim();
    const derived = resolveSurveyCurrentStatus(row).currentStatus;
    const stage = apStatus || derived || 'Pending Survey';

    return {
      ...row,
      lhid: row.lhid || db.lhid || '—',
      province: provName,
      municipality: muniName,
      barangay: brgyName,
      titleNumber: titleNum,
      landOwner: landOwner,
      totalArea: carpableNum,
      carpable: carpableNum,
      areaHas: carpableNum,
      currentStatus: row.currentStatus || stage,
      stage,
      targetYear: formatYearDisplay(row.targetYear || db.year || db.targetYear || ''),
      target: row.target || db.target || 'Current',
      surveyRequirement: row.surveyRequirement || db.surveyRequirement || '',
      datesMap: { ...row }
    };
  });
}

function openSurveySupportListModal({
  province = 'ALL',
  status = 'ALL',
  stageKey = '',
  stageLabel = '',
  mode = 'accomplished',
  balanceArea = ''
}) {
  const allRows = getSurveySupportRows(appState);
  const curYear = new Date().getFullYear();
  const targetYear = appState.whereaboutsTargetYearFilter?.['survey-whereabouts'] || 'ALL';
  const q = String(appState.whereaboutsSearch?.['survey-whereabouts'] || '').trim().toLowerCase();
  const isBalanceMode = mode === 'balance' || mode === 'pending';

  const matchedRows = allRows.filter((r) => {
    if (targetYear !== 'ALL') {
      if (!matchesWhereaboutsTargetYear(r, targetYear, curYear)) return false;
    }
    if (province && province !== 'ALL') {
      if (!matchProvinceName(r.province, province)) return false;
    }
    if (status && status !== 'ALL') {
      const rowStatus = String(r.currentStatus || r.stage || '').trim().toLowerCase();
      const targetStatus = String(status).trim().toLowerCase();
      if (rowStatus !== targetStatus) {
        const cleanRow = rowStatus.replace(/^\d+[\s\-_.]+/, '').trim();
        const cleanTarget = targetStatus.replace(/^\d+[\s\-_.]+/, '').trim();
        if (cleanRow !== cleanTarget && !rowStatus.includes(targetStatus) && !targetStatus.includes(rowStatus)) {
          return false;
        }
      }
    }
    if (stageKey) {
      const hasDate = Boolean(String(r[stageKey] || r.datesMap?.[stageKey] || '').trim());
      if (isBalanceMode) {
        if (hasDate) return false;
      } else {
        if (!hasDate) return false;
      }
    }
    if (q) {
      const hay = `${r.lhid} ${r.province} ${r.municipality} ${r.barangay} ${r.landOwner} ${r.titleNumber} ${r.stage} ${r.currentStatus}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const totalArea = matchedRows.reduce((sum, r) => sum + r.carpable, 0);
  const provLabel = province === 'ALL' ? 'Region VIII' : province;
  let statusLabel = '';
  if (isBalanceMode) {
    statusLabel = stageLabel ? `Balance / Pending: ${stageLabel}` : 'Balance / Pending';
  } else {
    statusLabel = status === 'ALL' ? (stageLabel || (stageKey ? 'Accomplished Milestones' : 'All Current Statuses')) : status;
  }
  const modalTitle = `Support List: ${provLabel} • ${statusLabel}`;

  const modalHtml = renderSurveySupportListModalHtml({
    rows: matchedRows,
    province,
    status,
    stageKey,
    stageLabel,
    targetYear,
    totalArea,
    mode,
    balanceArea
  });

  showModal(modalTitle, modalHtml);
  bindSupportListModalEvents(matchedRows, { province, status, stageKey, targetYear, mode, balanceArea });
}

function bindSupportListModalEvents(allMatchedRows, { province, status, stageKey, targetYear, mode, balanceArea, viewKey, tabName, dates }) {
  const modalEl = document.getElementById('modal-body');
  if (!modalEl) return;

  const searchInput = modalEl.querySelector('#support-list-search');
  const countLabel = modalEl.querySelector('#support-list-count-label');
  const tbody = modalEl.querySelector('#support-list-table tbody');

  searchInput?.addEventListener('input', (e) => {
    const q = (e.target.value || '').trim().toLowerCase();
    const trs = tbody?.querySelectorAll('tr') || [];
    let visibleCount = 0;
    trs.forEach((tr) => {
      const text = tr.textContent.toLowerCase();
      const match = !q || text.includes(q);
      tr.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });
    if (countLabel) {
      countLabel.innerHTML = `Showing <strong>${visibleCount}</strong> of <strong>${allMatchedRows.length}</strong> records`;
    }
  });

  modalEl.querySelector('#btn-export-support-list-csv')?.addEventListener('click', () => {
    exportSupportListCsv(allMatchedRows, { province, status, targetYear, tabName, dates });
  });

  modalEl.querySelector('#btn-open-database-balance')?.addEventListener('click', (e) => {
    closeModal();
    const prov = e.currentTarget.dataset.province;
    appState.activeOptoolTab = 'Database';
    appState.view = 'optool';
    if (prov && prov !== 'ALL') {
      appState.optoolProvinceFilter = prov;
    }
    appState.optoolPage = 1;
    renderActiveView();
  });

  modalEl.querySelectorAll('[data-lhid]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openLandholdingDrawer(btn.dataset.lhid);
    });
  });

  modalEl.querySelectorAll('[data-open-optool-tab="Survey"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lhid = btn.dataset.filterLhid;
      closeModal();
      appState.activeOptoolTab = 'Survey';
      if (lhid) {
        appState.optoolSearch = lhid;
      }
      appState.optoolPage = 1;
      appState.optoolColPage = 1;
      appState.view = 'optool';
      renderActiveView();

      if (lhid) {
        const tabRows = appState.state?.optool?.Survey || [];
        const cleanLhid = formatLhidDisplay(lhid).toLowerCase();
        const foundIdx = tabRows.findIndex(
          (r) => formatLhidDisplay(r.lhid || r.LHID).toLowerCase() === cleanLhid
        );
        if (foundIdx >= 0) {
          openOptoolModal('Survey', tabRows[foundIdx], foundIdx);
        }
      }
    });
  });
}

function exportSupportListCsv(rows, { province, status, targetYear, tabName, dates }) {
  const isCf = rows.some((r) => r.dateFiConducted !== undefined || r.datePreparedSigned !== undefined || r.reportedMonth !== undefined || r.datesMap?.dateFiConducted !== undefined);
  const effectiveDates = Array.isArray(dates) && dates.length > 0 ? dates : null;

  let headers = [];
  if (effectiveDates) {
    headers = [
      '#',
      'LHID',
      'Province',
      'Municipality',
      'Barangay',
      'Landowner',
      'Title Number',
      'Total Area (HAS)',
      'Current Status',
      'Target Year',
      ...effectiveDates.map((d) => d.shortLabel || d.label || d.key)
    ];
  } else if (isCf) {
    headers = [
      '#',
      'LHID',
      'Province',
      'Municipality',
      'Barangay',
      'Landowner',
      'Title Number',
      'Total Area (HAS)',
      'Current Status',
      'Target Year',
      'Date FI Conducted',
      'Date Prepared & Signed',
      'Reported Month',
      'LHs (Needing/Not Needing Survey)'
    ];
  } else {
    headers = [
      '#',
      'LHID',
      'Province',
      'Municipality',
      'Barangay',
      'Landowner',
      'Title Number',
      'Total Area (HAS)',
      'Current Status',
      'Target Year',
      'Target',
      'Date RSS',
      'Field Work Start',
      'Field Work Completed',
      'ASP Date'
    ];
  }

  const escapeCsv = (val) => {
    const s = String(val ?? '');
    return `"${s.replace(/"/g, '""')}"`;
  };

  const csvLines = [headers.join(',')];
  rows.forEach((r, idx) => {
    if (effectiveDates) {
      csvLines.push(
        [
          idx + 1,
          escapeCsv(r.lhid),
          escapeCsv(r.province),
          escapeCsv(r.municipality),
          escapeCsv(r.barangay),
          escapeCsv(r.landOwner),
          escapeCsv(r.titleNumber),
          fmtArea(r.carpable),
          escapeCsv(r.currentStatus || r.stage || ''),
          escapeCsv(formatYearDisplay(r.targetYear || r.year || '')),
          ...effectiveDates.map((d) => {
            const rawVal = r.datesMap?.[d.key] || r[d.key] || '';
            const displayVal = d.key === 'reportedMonth' || d.key === 'monthReported' ? (formatReportedMonthWord(rawVal) || rawVal) : rawVal;
            return escapeCsv(displayVal);
          })
        ].join(',')
      );
    } else if (isCf) {
      csvLines.push(
        [
          idx + 1,
          escapeCsv(r.lhid),
          escapeCsv(r.province),
          escapeCsv(r.municipality),
          escapeCsv(r.barangay),
          escapeCsv(r.landOwner),
          escapeCsv(r.titleNumber),
          fmtArea(r.carpable),
          escapeCsv(r.currentStatus || r.stage || ''),
          escapeCsv(formatYearDisplay(r.targetYear || r.year || '')),
          escapeCsv(r.datesMap?.dateFiConducted || r.dateFiConducted || ''),
          escapeCsv(r.datesMap?.datePreparedSigned || r.datePreparedSigned || ''),
          escapeCsv(formatReportedMonthWord(r.datesMap?.reportedMonth || r.reportedMonth || '') || (r.datesMap?.reportedMonth || r.reportedMonth || '')),
          escapeCsv(r.surveyRequirement || '')
        ].join(',')
      );
    } else {
      csvLines.push(
        [
          idx + 1,
          escapeCsv(r.lhid),
          escapeCsv(r.province),
          escapeCsv(r.municipality),
          escapeCsv(r.barangay),
          escapeCsv(r.landOwner),
          escapeCsv(r.titleNumber),
          fmtArea(r.carpable),
          escapeCsv(r.currentStatus || r.stage || ''),
          escapeCsv(formatYearDisplay(r.targetYear || r.year || '')),
          escapeCsv(r.target || 'Current'),
          escapeCsv(r.datesMap?.dateRss || r.dateRss || ''),
          escapeCsv(r.datesMap?.fieldWorkStartDate || r.fieldWorkStartDate || ''),
          escapeCsv(r.datesMap?.fieldWorkCompletionDate || r.fieldWorkCompletionDate || ''),
          escapeCsv(r.datesMap?.aspDate || r.aspDate || '')
        ].join(',')
      );
    }
  });

  const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const provPart = (province || 'Region_VIII').replace(/\s+/g, '_');
  const statPart = (status || 'All').replace(/\s+/g, '_');
  a.download = `Support_List_${provPart}_${statPart}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Load regional workspace bootstrap data after authentication succeeds. */
async function bootAppSession(options = {}) {
  const isLogin = Boolean(options.syncOnLogin);
  let boot = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      boot = await withLoading(
        'fetching',
        isLogin
          ? 'Signing In & Loading Records…'
          : attempt > 1 ? `Connecting to Server (${attempt}/3)…` : 'Fetching Regional Data…',
        isLogin
          ? 'Loading Region VIII OPTool database, analytics, and session…'
          : 'Loading Region VIII OPTool database, analytics, and sync state…',
        () => api(`/api/bootstrap?sync=skip&milestoneYear=${encodeURIComponent(appState.filters?.milestoneYear || '2027')}`, { timeoutMs: 30000 })
      );
      if (boot && boot.state) break;
    } catch (err) {
      console.warn(`Initial bootstrap fetch attempt ${attempt} failed:`, err);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  if (!boot || !boot.state) {
    hideLoadingOverlay(true);
    toast('Unable to load workspace data from server. Please refresh or check connection.', true);
    const existingError = document.getElementById('boot-error-container');
    if (!existingError && document.body) {
      const errorDiv = document.createElement('div');
      errorDiv.id = 'boot-error-container';
      errorDiv.style.cssText = 'position:fixed;inset:0;background:#0d2818;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;z-index:99999;font-family:inherit;padding:24px;text-align:center;';
      errorDiv.innerHTML = `
        <div style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);padding:32px;border-radius:12px;max-width:480px;width:100%;box-shadow:0 12px 36px rgba(0,0,0,0.4);">
          <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
          <h2 style="margin:0 0 8px 0;font-size:20px;font-weight:700;">Connection Error</h2>
          <p style="margin:0 0 20px 0;font-size:14px;color:#cbd5e1;line-height:1.5;">Unable to load Region VIII workspace data from server. This can occur on serverless cold starts or temporary network interruption.</p>
          <button id="boot-retry-btn" style="background:#22c55e;color:#0d2818;font-weight:700;font-size:14px;padding:10px 24px;border:none;border-radius:6px;cursor:pointer;transition:background 0.2s;">
            Retry Connection ↻
          </button>
        </div>
      `;
      document.body.appendChild(errorDiv);
      document.getElementById('boot-retry-btn')?.addEventListener('click', () => {
        errorDiv.remove();
        bootAppSession(options);
      });
    }
    return;
  }

  const existingError = document.getElementById('boot-error-container');
  if (existingError) existingError.remove();

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

  // If user just logged in or if milestone tabs are empty, synchronize directly with Google Sheets before dismissing loading overlay
  const cfCount = (appState.state.optool?.['CF(DOC)'] || []).length;
  const surveyCount = (appState.state.optool?.Survey || []).length;
  const shouldSyncLive = isLogin || (cfCount === 0 && surveyCount === 0);

  if (shouldSyncLive) {
    try {
      const syncResult = await withLoading(
        'fetching',
        'Synchronizing Live data…',
        'Fetching live CF, Survey, and milestone records across provincial sheets…',
        () => api('/api/sync/provincial-optool', { method: 'POST', timeoutMs: 60000 })
      );
      if (syncResult && syncResult.ok) {
        if (syncResult.state) appState.state = { ...appState.state, ...syncResult.state };
        if (syncResult.analytics) appState.analytics = syncResult.analytics;
        appState.state.dataSourceMode = 'live';
      }
    } catch (syncErr) {
      console.warn('Initial live sync during login skipped/failed:', syncErr);
    }
  }

  showAppShell();
  renderActiveView();
  hideLoadingOverlay(true);
  stopAutoSync();
  autoSyncStartTimer = setTimeout(() => {
    if (appState.currentUser && !shouldSyncLive) maybeAutoSyncGoogleSheets(true);
  }, 300);
  startAutoSyncLoop();
  startInactivityWatcher();
}

/** Bind Sign In, Email OTP, Create Account, Password Toggles, and Log Out actions. */
function bindAuthEvents() {
  let otpCooldownTimer = null;
  let signupOtpStepActive = false;
  let currentSignupOtpToken = '';

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
      if (res.otpToken) {
        currentSignupOtpToken = res.otpToken;
        try {
          sessionStorage.setItem('salig_signup_otp_token', res.otpToken);
          localStorage.setItem('salig_signup_otp_token', res.otpToken);
        } catch (_) {}
      }
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
      if (err.message && /invalid email otp code/i.test(err.message)) {
        setAuthFeedback('Invalid Email OTP code. If you requested multiple codes, please enter the most recent one received or click Resend OTP.', 'error');
      } else {
        setAuthFeedback(err.message, 'error');
      }
      if (err.message && /already exists/i.test(err.message)) {
        setTimeout(() => {
          switchAuthTab('login');
          const loginEmailEl = document.getElementById('login-email');
          if (loginEmailEl) {
            loginEmailEl.value = email;
            document.getElementById('login-password')?.focus();
          }
        }, 2500);
      } else if (err.message && /wait (\d+)s/i.test(err.message)) {
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
      await bootAppSession({ syncOnLogin: true });
      toast(`Welcome back, ${res.user.name}`);
    } catch (err) {
      if (err.message && /invalid email otp code/i.test(err.message)) {
        setAuthFeedback('Invalid Email OTP code. If you requested multiple codes, please enter the most recent one received or click Resend OTP.', 'error');
      } else {
        setAuthFeedback(err.message, 'error');
      }
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
      const otpToken = currentSignupOtpToken || (function () {
        try {
          return sessionStorage.getItem('salig_signup_otp_token') || localStorage.getItem('salig_signup_otp_token') || '';
        } catch (_) { return ''; }
      })();
      const cleanOtp = String(otpCode || '').replace(/\s+/g, '').trim();
      const res = await withLoading(
        'saving',
        'Creating Account…',
        'Verifying Email OTP & submitting registration for Administrator confirmation…',
        () =>
          api('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, province, contactNumber, password, otpCode: cleanOtp, otpToken })
          })
      );
      document.getElementById('signup-form').reset();
      currentSignupOtpToken = '';
      try {
        sessionStorage.removeItem('salig_signup_otp_token');
        localStorage.removeItem('salig_signup_otp_token');
      } catch (_) {}
      setSignupOtpStep(false);
      document.getElementById('otp-preview-banner')?.classList.add('hidden');
      stopOtpCooldown();
      showAuthScreen(res.message, 'success', 'login');
      document.getElementById('login-email').value = email;
    } catch (err) {
      if (err.message && /invalid email otp code/i.test(err.message)) {
        setAuthFeedback('Invalid Email OTP code. If you requested multiple codes, please enter the most recent one received or click Resend OTP.', 'error');
      } else {
        setAuthFeedback(err.message, 'error');
      }
      if (err.message && /already exists/i.test(err.message)) {
        setTimeout(() => {
          switchAuthTab('login');
          const loginEmailEl = document.getElementById('login-email');
          if (loginEmailEl) {
            loginEmailEl.value = email;
            document.getElementById('login-password')?.focus();
          }
        }, 2500);
      }
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', () => performLogout({ reason: 'manual' }));
  document.getElementById('btn-topbar-logout')?.addEventListener('click', () => performLogout({ reason: 'manual' }));
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
      const timeoutMs = getInactivityTimeoutMs();
      const lastActive = Number(localStorage.getItem(INACTIVITY_STORAGE_KEY) || 0);
      if (session.authenticated && lastActive > 0 && Date.now() - lastActive >= timeoutMs) {
        try {
          localStorage.removeItem(INACTIVITY_STORAGE_KEY);
        } catch (_) {}
        await api('/api/auth/logout', { method: 'POST' }).catch(() => null);
        showAuthScreen('You have been automatically logged out after 15 minutes of inactivity.', 'warning', 'login');
        return;
      }
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

  const isMobileSidebar = () => window.matchMedia('(max-width: 1024px)').matches;
  const appShellEl = document.getElementById('app-shell');
  const sidebarEl = document.getElementById('sidebar');
  const sidebarBackdropEl = document.getElementById('sidebar-backdrop');
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
      if (sidebarBackdropEl) sidebarBackdropEl.classList.toggle('hidden', !isOpen);
      return;
    }
    if (sidebarBackdropEl) sidebarBackdropEl.classList.add('hidden');
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

  sidebarBackdropEl?.addEventListener('click', () => {
    sidebarEl?.classList.remove('open');
    syncSidebarToggleUi();
  });

  // Navigation
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      appState.view = btn.dataset.view;
      if (appState.view === 'optool') {
        appState.activeOptoolTab = 'Database';
      }
      sidebarEl?.classList.remove('open');
      syncSidebarToggleUi();
      if (appState.view === 'users') {
        try {
          await loadUsersDirectory();
        } catch (err) {
          toast(err.message, true);
        }
      } else if (appState.view === 'target-summary') {
        appState.filters.province = 'ALL';
        appState.nepShowProvinces = true;
        try {
          await refreshAnalytics();
        } catch (_) {}
      } else if (appState.view === 'audit-logs') {
        if (appState.currentUser?.role !== 'admin') {
          appState.view = 'dashboard';
          toast('Log History is for administrators only.', true);
          renderActiveView();
          return;
        }
        try {
          await loadAuditLogs();
        } catch (err) {
          toast(err.message, true);
        }
      } else if (appState.view === 'target-summary') {
        appState.filters.province = 'ALL';
        appState.nepShowProvinces = true;
        try {
          await refreshAnalytics();
        } catch (_) {}
      }
      maybeAutoSyncGoogleSheets();
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

  // Global PDF Upload Handler
  let pendingPdfUpload = null;
  let fileInput = document.getElementById('global-pdf-uploader');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'global-pdf-uploader';
    fileInput.accept = 'application/pdf';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
  }

  document.addEventListener('click', (e) => {
    const uploadBtn = e.target.closest('.btn-upload-pdf, [data-upload-pdf-tab], #btn-modal-upload-pdf, .btn-modal-upload-pdf');
    if (uploadBtn) {
      e.preventDefault();
      e.stopPropagation();
      const tabName = uploadBtn.dataset.uploadPdfTab || appState.activeOptoolTab || 'CF(DOC)';
      const colKey = uploadBtn.dataset.uploadPdfCol || 'pdfFile';
      const idx = uploadBtn.dataset.uploadPdfIdx !== undefined && uploadBtn.dataset.uploadPdfIdx !== '' ? Number(uploadBtn.dataset.uploadPdfIdx) : -1;
      const lhid = uploadBtn.dataset.uploadPdfLhid || '';
      const province = uploadBtn.dataset.uploadPdfProvince || '';
      const isModal = Boolean(uploadBtn.closest('.modal') || uploadBtn.id === 'btn-modal-upload-pdf' || uploadBtn.classList.contains('btn-modal-upload-pdf'));

      pendingPdfUpload = { tabName, colKey, idx, lhid, province, isModal };
      fileInput.value = '';
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !pendingPdfUpload) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      toast('Please select a valid PDF file (.pdf)', true);
      return;
    }

    const { tabName, colKey, idx, lhid, province, isModal } = pendingPdfUpload;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const fileBase64 = reader.result;
        const uploadRes = await withLoading(
          'saving',
          'Uploading PDF to Drive…',
          `Saving ${file.name} to Region VIII Google Drive…`,
          () =>
            api('/api/upload-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tabName,
                colKey: colKey || 'pdfFile',
                index: idx >= 0 ? idx : 0,
                lhid,
                province,
                fileName: file.name,
                fileBase64
              })
            })
        );

        toast(`PDF uploaded successfully: ${uploadRes.fileUrl ? (uploadRes.fileUrl.startsWith('http') ? 'Linked to Drive' : 'Attached PDF') : file.name}`);

        if (isModal) {
          const targetInput = document.getElementById(`opt-${colKey}`) || document.getElementById('opt-pdfFile');
          if (targetInput) {
            targetInput.value = uploadRes.fileUrl;
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            const parentDiv = targetInput.parentElement;
            if (parentDiv) {
              let viewLink = parentDiv.querySelector('.pdf-link');
              if (!viewLink) {
                viewLink = document.createElement('a');
                viewLink.className = parentDiv.classList.contains('form-control-merged')
                  ? 'pdf-link-merged pdf-link'
                  : 'btn btn-success btn-sm pdf-link';
                viewLink.target = '_blank';
                viewLink.rel = 'noopener noreferrer';
                if (!parentDiv.classList.contains('form-control-merged')) {
                  viewLink.style.cssText = 'white-space:nowrap;padding:4px 8px;font-size:12px;text-decoration:none;';
                }
                viewLink.innerHTML = '📄 View';
                parentDiv.appendChild(viewLink);
              }
              viewLink.href = normalizePdfUrl(uploadRes.fileUrl);
              viewLink.setAttribute('title', file.name || 'Uploaded PDF');
            }
          }
        }

        if (idx >= 0 && appState.state.optool?.[tabName]?.[idx]) {
          appState.state.optool[tabName][idx][colKey || 'pdfFile'] = uploadRes.fileUrl;
        }

        renderActiveView();
      } catch (err) {
        toast(`Upload failed: ${err.message}`, true);
      } finally {
        pendingPdfUpload = null;
        fileInput.value = '';
      }
    };
    reader.readAsDataURL(file);
  });

  // Global PDF Viewer Interceptor: Handles data URIs, blob URLs, Google Drive links & /api/pdf/ streams
  document.addEventListener('click', (e) => {
    const pdfLink = e.target.closest(
      '.pdf-link, a[data-pdf-url], a[href*=".pdf"], a[href^="data:application/pdf"], a[href*="/api/pdf/"], a[href*="/uploads/"], a[href*="drive.google.com"]'
    );
    if (pdfLink && !pdfLink.classList.contains('btn-close-pdf-modal') && !pdfLink.closest('.modal-header')) {
      const href = pdfLink.getAttribute('data-pdf-url') || pdfLink.getAttribute('href');
      if (href) {
        e.preventDefault();
        e.stopPropagation();
        openPdfViewer(href, pdfLink.getAttribute('title') || 'Attached PDF Document');
      }
    }
  });
}

function openPdfViewer(url, title = 'PDF Document') {
  if (!url) return;
  const rawUrl = String(url).trim();
  const normalizedUrl = normalizePdfUrl(rawUrl);

  // If it's a data URI, convert to a Blob URL
  if (normalizedUrl.startsWith('data:application/pdf')) {
    try {
      const parts = normalizedUrl.split(',');
      const byteString = atob(parts[1]);
      const len = byteString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      openPdfModal(blobUrl, title, blobUrl);
      return;
    } catch (err) {
      console.warn('Could not parse data URI as blob:', err);
    }
  }

  const isDrive = normalizedUrl.includes('drive.google.com');
  const embedUrl = isDrive ? toEmbeddablePdfUrl(normalizedUrl) : normalizedUrl;

  openPdfModal(embedUrl, title, normalizedUrl);
}

function openPdfModal(embedUrl, title = 'PDF Document', directUrl = '') {
  const existing = document.getElementById('pdf-viewer-modal');
  if (existing) existing.remove();

  const finalDirectUrl = directUrl || embedUrl;
  const downloadFileName = (title || 'document').toLowerCase().endsWith('.pdf')
    ? title
    : `${title || 'document'}.pdf`;

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'pdf-viewer-modal';
  modal.innerHTML = `
    <div class="modal-box" style="width:94vw;max-width:1150px;height:92vh;display:flex;flex-direction:column;padding:0;overflow:hidden;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.5);">
      <div class="modal-header" style="padding:10px 18px;background:var(--dar-green,#0f4d2a);color:#fff;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <h3 class="modal-title" style="color:#fff;font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px;margin:0;">
          <span>📄</span> ${esc(title)}
        </h3>
        <div style="display:flex;gap:8px;align-items:center;">
          <a href="${esc(finalDirectUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-xs" style="color:#fff;background:rgba(255,255,255,0.2);border:0;padding:5px 12px;font-size:12px;border-radius:4px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;" title="Open in separate browser window">
            <span>⧉</span> Open New Tab
          </a>
          <a href="${esc(finalDirectUrl)}" download="${esc(downloadFileName)}" class="btn btn-primary btn-xs" style="color:#fff;background:#2e7d32;border:0;padding:5px 12px;font-size:12px;border-radius:4px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;" title="Download file to your computer">
            <span>⬇</span> Download
          </a>
          <button type="button" class="btn btn-xs btn-close-pdf-modal" style="color:#fff;background:transparent;border:0;font-size:20px;cursor:pointer;line-height:1;margin-left:8px;padding:0 4px;" title="Close Viewer">
            ✕
          </button>
        </div>
      </div>
      <div style="flex:1;background:#2b2b2b;position:relative;display:flex;flex-direction:column;">
        <iframe src="${esc(embedUrl)}" style="width:100%;height:100%;border:0;flex:1;" allow="autoplay" title="${esc(title)}"></iframe>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.btn-close-pdf-modal')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

init();

