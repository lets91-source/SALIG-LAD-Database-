import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  REGIONAL_REGISTRY,
  PROVINCE_CODES,
  LGU_MASTER_LIST,
  MILESTONE_STAGES,
  BATCH_CATEGORIES,
  MILESTONE_TARGET_TABS,
  DASHBOARD_MILESTONES,
  MILESTONE_DATA_COLUMNS,
  OPTOOL_SHEET_SCHEMAS,
  OPTOOL_PREVIEW_COLUMNS,
  inferProvinceCodeFromText,
  inferProvinceCodeFromMunicipality
} from './schema.js';
import { ConsolidatedStore } from './store.js';
import {
  SESSION_COOKIE_NAME,
  DEFAULT_SESSION_TTL_MS,
  USER_PROVINCE_OPTIONS,
  signSessionToken,
  verifySessionToken,
  parseCookies,
  toPublicUser,
  resolveUserProvinceScope
} from './auth.js';
import {
  fetchGoogleSheetXlsx,
  parseWorkbookBuffer,
  parseCsvText,
  buildConsolidatedWorkbookBuffer,
  pullFromGasWebApp,
  pullUsersFromGasWebApp,
  pullNepFromGasWebApp,
  pushToGasWebApp
} from './sheetsSync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function readGasSource() {
  const gasPath = path.join(ROOT_DIR, 'gas', 'Code.gs');
  return fs.existsSync(gasPath) ? fs.readFileSync(gasPath, 'utf8') : '';
}

function readGasHtmlSource() {
  const htmlPath = path.join(ROOT_DIR, 'gas', 'Index.html');
  return fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Filename',
    ...extraHeaders
  });
  res.end(body);
}

/** Build an HttpOnly Set-Cookie header string for the SALIG session token. */
function buildSessionCookie(req, token, maxAgeSeconds) {
  const isSecure =
    String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https' ||
    Boolean(req.socket?.encrypted);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

/** Resolve the currently signed-in and admin-approved user from request cookies. */
function resolveSessionUser(req, store) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const payload = verifySessionToken(token, store.getAuthSecret());
  if (!payload) return null;
  const user = store.findUserById(payload.id);
  if (!user || user.status !== 'approved') return null;
  return user;
}

async function readRequestBuffer(req, maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error('Payload exceeds maximum 25MB limit');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  const buf = await readRequestBuffer(req, 15 * 1024 * 1024);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

function getOptoolHeadersSpec(tabName) {
  return (OPTOOL_SHEET_SCHEMAS[tabName] || []).map((c) => ({
    key: c.key,
    header: c.header,
    type: c.type
  }));
}

/**
 * Automatically mirror local store mutations back to the configured GAS Web App endpoint.
 */
async function pushMutationToGas(store, payload, summaryLabel, pushFn = pushToGasWebApp) {
  const gasUrl = String(store.state.gasWebAppUrl || '').trim();
  if (!gasUrl) return null;
  try {
    const result = await pushFn(gasUrl, payload);
    store.addSyncLog('GAS Web App Auto-Push', 'success', summaryLabel);
    store.save();
    return { ok: true, ...result };
  } catch (err) {
    store.addSyncLog('GAS Web App Auto-Push', 'error', `${summaryLabel} failed: ${err.message}`);
    store.save();
    return { ok: false, error: err.message };
  }
}

function inferOptoolRowProvinceCode(store, row) {
  const lhid = String(row?.lhid || '').trim().toLowerCase();
  const dbRow = lhid
    ? (store.state.optool?.Database || []).find((r) => String(r.lhid || '').trim().toLowerCase() === lhid)
    : null;
  return (
    inferProvinceCodeFromText(row?.province) ||
    inferProvinceCodeFromText(dbRow?.province) ||
    inferProvinceCodeFromMunicipality(row?.municipality || dbRow?.municipality) ||
    inferProvinceCodeFromText(row?.lhid) ||
    ''
  );
}

function computeScopedAnalytics(store, query, scopeCode) {
  return store.computeAnalytics({
    ...query,
    province: scopeCode || query.province,
    restrictToProvince: Boolean(scopeCode)
  });
}

function buildScopedStatePayload(store, scopeCode, includeStaticConfig = true) {
  const view = store.getScopedState(scopeCode);
  const payload = {
    dataSourceMode: view.dataSourceMode,
    lastSyncAt: view.lastSyncAt,
    liveHubSnapshot: view.liveHubSnapshot,
    nodeStatuses: view.nodeStatuses || {},
    syncLogs: view.syncLogs,
    milestoneData: view.milestoneData,
    optool: view.optool
  };
  if (includeStaticConfig) {
    payload.gasWebAppUrl = view.gasWebAppUrl;
    payload.baselines = view.baselines;
    payload.nepTargets = view.nepTargets;
    payload.nepProvinceList = view.nepProvinceList;
  }
  return payload;
}

function filterParsedDatasetByScope(store, parsed, scopeCode) {
  if (!scopeCode) return parsed;
  const dbMap = store.buildDbLhidProvinceMap();
  for (const r of parsed.optool?.Database || []) {
    const lhidKey = String(r.lhid || '').trim().toLowerCase();
    const code = store.getOptoolRowProvinceCode('Database', r, dbMap);
    if (lhidKey && code && !dbMap.has(lhidKey)) {
      dbMap.set(lhidKey, code);
    }
  }
  const scopedMilestones = (parsed.milestoneData || []).filter(
    (m) => store.getMilestoneProvinceCode(m) === scopeCode
  );
  const scopedOptool = {};
  const tabRowCounts = { Milestone_Data: scopedMilestones.length };
  for (const tabName of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
    const rows = (parsed.optool?.[tabName] || []).filter(
      (r) => store.getOptoolRowProvinceCode(tabName, r, dbMap) === scopeCode
    );
    scopedOptool[tabName] = rows;
    tabRowCounts[tabName] = rows.length;
  }
  return {
    ...parsed,
    milestoneData: scopedMilestones,
    optool: scopedOptool,
    nepProvinceList: null,
    tabRowCounts
  };
}

async function pushRoutedTargetRow(store, targetTab, lhid, gasPushFn) {
  if (!targetTab) return null;
  const lhidKey = String(lhid || '').trim().toLowerCase();
  const targetRow = (store.state.optool[targetTab] || []).find(
    (r) => String(r.lhid || '').trim().toLowerCase() === lhidKey
  );
  if (!targetRow) return null;
  return pushMutationToGas(
    store,
    {
      action: 'upsertOptoolRow',
      tabName: targetTab,
      headers: getOptoolHeadersSpec(targetTab),
      row: targetRow,
      provinceCode: inferOptoolRowProvinceCode(store, targetRow)
    },
    `Routed ${targetRow.lhid || 'parcel'} into Google Sheet tab ${targetTab}.`,
    gasPushFn
  );
}

/**
 * Dispatch a 6-digit registration OTP email using Resend, GAS MailApp, or custom webhook/sender.
 */
async function sendOtpEmailNotification(
  store,
  { email, name, otp, expiresInMinutes },
  { customSender, gasPushFn } = {}
) {
  const safeName = String(name || 'SALIG Applicant').trim() || 'SALIG Applicant';
  if (typeof customSender === 'function') {
    await customSender({ email, name: safeName, otp, expiresInMinutes });
    return { sent: true, channel: 'custom' };
  }

  const errors = [];

  if (process.env.RESEND_API_KEY) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.SALIG_MAIL_FROM || 'SALIG Region VIII <onboarding@resend.dev>',
          to: [email],
          subject: 'SALIG (LAD DATABASE) — Email Verification OTP Code',
          text: `Your 6-digit SALIG verification OTP code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #dce5df;border-radius:12px;"><div style="font-size:12px;font-weight:700;color:#0f4c29;text-transform:uppercase;">Department of Agrarian Reform — Region VIII</div><h2 style="margin:6px 0 12px;color:#132018;">SALIG Email Verification</h2><p>Your 6-digit OTP verification code is:</p><div style="margin:18px 0;padding:16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;text-align:center;"><span style="font-size:30px;font-weight:800;letter-spacing:0.3em;color:#0a361d;font-family:monospace;">${otp}</span></div><p style="font-size:12.5px;color:#54655a;">Valid for ${expiresInMinutes} minutes.</p></div>`
        })
      });
      if (resp.ok) {
        return { sent: true, channel: 'resend' };
      }
      errors.push(`Resend HTTP ${resp.status}`);
    } catch (err) {
      errors.push(`Resend: ${err.message}`);
    }
  }

  if (store.state.gasWebAppUrl) {
    try {
      const gasRes = await gasPushFn(store.state.gasWebAppUrl, {
        action: 'sendOtpEmail',
        email,
        name: safeName,
        otp,
        expiresInMinutes
      });
      if (gasRes && gasRes.ok !== false && !String(gasRes.error || '').toLowerCase().includes('unsupported')) {
        return { sent: true, channel: 'gas-mail' };
      }
      if (gasRes?.error) errors.push(`GAS: ${gasRes.error}`);
    } catch (err) {
      errors.push(`GAS: ${err.message}`);
    }
  }

  if (process.env.SALIG_OTP_WEBHOOK_URL) {
    try {
      const resp = await fetch(process.env.SALIG_OTP_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: safeName, otp, expiresInMinutes })
      });
      if (resp.ok) {
        return { sent: true, channel: 'webhook' };
      }
      errors.push(`Webhook HTTP ${resp.status}`);
    } catch (err) {
      errors.push(`Webhook: ${err.message}`);
    }
  }

  if (process.env.SALIG_REQUIRE_LIVE_EMAIL === 'true') {
    const err = new Error(
      `Unable to send verification email (${errors.join('; ') || 'no mail provider configured'}). Redeploy gas/Code.gs or configure RESEND_API_KEY.`
    );
    err.statusCode = 502;
    throw err;
  }

  return { sent: false, channel: 'preview', previewOtp: otp, reason: errors.join('; ') };
}

async function pullUsersFromGasIfConfigured(store, pullUsersFn = pullUsersFromGasWebApp) {
  const gasUrl = String(store.state.gasWebAppUrl || '').trim();
  if (!gasUrl) return { ok: false, skipped: true };
  try {
    const res = await pullUsersFn(gasUrl);
    if (Array.isArray(res?.users)) {
      const merged = store.mergeUsersFromSheet(res.users);
      return { ok: true, ...merged };
    }
    return { ok: false, skipped: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function createAppServer(dataDir, options = {}) {
  const store = new ConsolidatedStore(dataDir);
  const gasPushFn = options.pushToGasWebApp || pushToGasWebApp;
  const gasPullFn = options.pullFromGasWebApp || pullFromGasWebApp;
  const gasPullUsersFn = options.pullUsersFromGasWebApp || pullUsersFromGasWebApp;
  const gasPullNepFn = options.pullNepFromGasWebApp || pullNepFromGasWebApp;
  const requireAuth = options.requireAuth !== false;
  const customOtpSender = options.sendOtpEmail;

  const handler = async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Filename'
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const query = Object.fromEntries(parsedUrl.searchParams.entries());

    try {
      // Public API Routes
      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
      }

      const sessionUser = resolveSessionUser(req, store);

      if (req.method === 'GET' && pathname === '/api/auth/session') {
        return sendJson(res, 200, {
          authenticated: Boolean(sessionUser),
          requireAuth,
          user: toPublicUser(sessionUser),
          provinces: USER_PROVINCE_OPTIONS
        });
      }

      if (req.method === 'POST' && pathname === '/api/auth/send-otp') {
        try {
          const body = await readJsonBody(req);
          const issued = store.issueSignupOtp(body.email, {
            bypassCooldown: Boolean(options.bypassOtpCooldown)
          });
          const delivery = await sendOtpEmailNotification(
            store,
            {
              email: issued.email,
              name: body.name,
              otp: issued.code,
              expiresInMinutes: issued.expiresInMinutes
            },
            { customSender: customOtpSender, gasPushFn }
          );
          return sendJson(res, 200, {
            ok: true,
            email: issued.email,
            expiresInMinutes: issued.expiresInMinutes,
            cooldownSeconds: issued.cooldownSeconds,
            deliveryMode: delivery.sent ? 'email' : 'preview',
            channel: delivery.channel,
            ...(delivery.sent ? {} : { previewOtp: delivery.previewOtp, reason: delivery.reason || '' }),
            message: delivery.sent
              ? `Verification OTP sent to ${issued.email}. Please check your inbox (expires in ${issued.expiresInMinutes} mins).`
              : `Email relay is not active on the deployed GAS URL yet — use the preview OTP below or redeploy updated gas/Code.gs to email ${issued.email}.`
          });
        } catch (err) {
          return sendJson(res, err.statusCode || 400, {
            error: err.message,
            retryAfterSeconds: err.retryAfterSeconds
          });
        }
      }

      if (req.method === 'POST' && pathname === '/api/auth/signup') {
        try {
          const body = await readJsonBody(req);
          await pullUsersFromGasIfConfigured(store, gasPullUsersFn);
          const created = store.createPendingUser(body, {
            requireOtp: options.requireOtp !== false
          });
          const fullRecord = store.findUserByEmail(created.email);
          const gasPushResult = fullRecord
            ? await pushMutationToGas(
                store,
                { action: 'upsertUserAccount', user: fullRecord },
                `Synced registration (${created.email}) to Regional Hub User_Accounts tab.`,
                gasPushFn
              )
            : null;
          return sendJson(res, 201, {
            ok: true,
            pending: true,
            gasPushResult,
            message:
              'Account created! An Administrator must confirm your registration before you can sign in.',
            user: created
          });
        } catch (err) {
          return sendJson(res, err.statusCode || 400, { error: err.message });
        }
      }

      if (req.method === 'POST' && pathname === '/api/auth/login') {
        try {
          const body = await readJsonBody(req);
          await pullUsersFromGasIfConfigured(store, gasPullUsersFn);
          const user = store.authenticateUser(body.email, body.password);
          const token = signSessionToken(
            { id: user.id, email: user.email, role: user.role },
            store.getAuthSecret(),
            DEFAULT_SESSION_TTL_MS
          );
          return sendJson(
            res,
            200,
            { ok: true, user },
            { 'Set-Cookie': buildSessionCookie(req, token, Math.floor(DEFAULT_SESSION_TTL_MS / 1000)) }
          );
        } catch (err) {
          return sendJson(res, err.statusCode || 401, {
            error: err.message,
            code: err.code || undefined
          });
        }
      }

      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        return sendJson(
          res,
          200,
          { ok: true },
          { 'Set-Cookie': buildSessionCookie(req, '', 0) }
        );
      }

      // Protected API Gate
      if (pathname.startsWith('/api/') && requireAuth && !sessionUser) {
        return sendJson(res, 401, { error: 'Authentication required. Please sign in.' });
      }

      const provinceScope = requireAuth ? resolveUserProvinceScope(sessionUser) : null;
      const scopeCode = provinceScope?.code || null;

      if (req.method === 'GET' && pathname === '/api/auth/users') {
        if (requireAuth && sessionUser?.role !== 'admin') {
          return sendJson(res, 403, { error: 'Administrator access required.' });
        }
        await pullUsersFromGasIfConfigured(store, gasPullUsersFn);
        return sendJson(res, 200, {
          users: store.listPublicUsers(),
          pendingCount: store.getPendingUserCount()
        });
      }

      if (req.method === 'POST' && pathname === '/api/auth/users/sync-sheet') {
        if (requireAuth && sessionUser?.role !== 'admin') {
          return sendJson(res, 403, { error: 'Administrator access required.' });
        }
        const gasUrl = String(store.state.gasWebAppUrl || '').trim();
        if (!gasUrl) {
          return sendJson(res, 400, { error: 'Configured GAS Web App URL is required to sync User_Accounts.' });
        }
        await pullUsersFromGasIfConfigured(store, gasPullUsersFn);
        const gasPushResult = await pushMutationToGas(
          store,
          { action: 'syncUserAccounts', users: store.state.users },
          `Synchronized ${store.state.users.length} account(s) with Regional Hub User_Accounts tab.`,
          gasPushFn
        );
        if (Array.isArray(gasPushResult?.users)) {
          store.mergeUsersFromSheet(gasPushResult.users);
        }
        return sendJson(res, gasPushResult?.ok === false ? 502 : 200, {
          ok: gasPushResult?.ok !== false,
          error: gasPushResult?.ok === false ? gasPushResult.error : undefined,
          synced: gasPushResult?.synced ?? store.state.users.length,
          users: store.listPublicUsers(),
          pendingCount: store.getPendingUserCount(),
          gasPushResult
        });
      }

      if (req.method === 'POST' && pathname.startsWith('/api/auth/users/') && pathname.endsWith('/status')) {
        if (requireAuth && sessionUser?.role !== 'admin') {
          return sendJson(res, 403, { error: 'Administrator access required.' });
        }
        const rawId = pathname.slice('/api/auth/users/'.length, -'/status'.length);
        const userId = decodeURIComponent(rawId);
        try {
          const body = await readJsonBody(req);
          const user = store.updateUserStatus(userId, body, sessionUser || 'admin');
          const fullRecord = store.findUserById(user.id);
          const gasPushResult = fullRecord
            ? await pushMutationToGas(
                store,
                { action: 'upsertUserAccount', user: fullRecord },
                `Updated User_Accounts status (${user.email}: ${user.status}/${user.role}) in Regional Hub Google Sheet.`,
                gasPushFn
              )
            : null;
          return sendJson(res, 200, {
            ok: true,
            user,
            gasPushResult,
            users: store.listPublicUsers(),
            pendingCount: store.getPendingUserCount()
          });
        } catch (err) {
          return sendJson(res, err.statusCode || 400, { error: err.message });
        }
      }

      if (req.method === 'DELETE' && pathname.startsWith('/api/auth/users/')) {
        if (requireAuth && sessionUser?.role !== 'admin') {
          return sendJson(res, 403, { error: 'Administrator access required.' });
        }
        const rawId = pathname.slice('/api/auth/users/'.length);
        const userId = decodeURIComponent(rawId);
        try {
          const deletedUser = store.deleteUserAccount(userId, sessionUser);
          const gasPushResult = await pushMutationToGas(
            store,
            { action: 'deleteUserAccount', userId: deletedUser.id, email: deletedUser.email },
            `Deleted User_Accounts entry (${deletedUser.email}) from Regional Hub Google Sheet.`,
            gasPushFn
          );
          return sendJson(res, 200, {
            ok: true,
            deletedUser,
            gasPushResult,
            users: store.listPublicUsers(),
            pendingCount: store.getPendingUserCount()
          });
        } catch (err) {
          return sendJson(res, err.statusCode || 400, { error: err.message });
        }
      }

      if (req.method === 'GET' && pathname === '/api/bootstrap') {
        const analytics = computeScopedAnalytics(store, query, scopeCode);
        const scopedRegistry = scopeCode
          ? REGIONAL_REGISTRY.filter((n) => n.code === scopeCode)
          : REGIONAL_REGISTRY;
        return sendJson(res, 200, {
          currentUser: toPublicUser(sessionUser),
          provinceScope,
          pendingUserCount: !requireAuth || sessionUser?.role === 'admin'
            ? store.getPendingUserCount()
            : 0,
          schemas: {
            registry: scopedRegistry,
            provinceCodes: scopeCode ? [scopeCode] : PROVINCE_CODES,
            lguMasterList: LGU_MASTER_LIST,
            milestoneStages: MILESTONE_STAGES,
            batchCategories: BATCH_CATEGORIES,
            milestoneTargetTabs: MILESTONE_TARGET_TABS,
            dashboardMilestones: DASHBOARD_MILESTONES,
            milestoneColumns: MILESTONE_DATA_COLUMNS,
            optoolTabs: OPTOOL_SHEET_SCHEMAS,
            optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS
          },
          state: buildScopedStatePayload(store, scopeCode, true),
          analytics,
          gasScript: readGasSource(),
          gasHtml: readGasHtmlSource()
        });
      }

      if (req.method === 'GET' && pathname === '/api/analytics') {
        return sendJson(res, 200, computeScopedAnalytics(store, query, scopeCode));
      }

      if (req.method === 'GET' && pathname === '/api/milestones/next-id') {
        const recordId = store.generateNextRecordId(
          scopeCode || query.provinceCode || 'LEY',
          query.milestoneDate || ''
        );
        return sendJson(res, 200, { recordId });
      }

      if (req.method === 'POST' && pathname === '/api/milestones') {
        const body = await readJsonBody(req);
        if (scopeCode) {
          const requestedProv = String(body.Province_Code || '').trim().toUpperCase();
          if (requestedProv && PROVINCE_CODES.includes(requestedProv) && requestedProv !== scopeCode) {
            return sendJson(res, 403, {
              error: `Access restricted to ${provinceScope.provinceName} (${scopeCode}) records only.`
            });
          }
          if (body.Record_ID) {
            const existing = store.state.milestoneData.find((r) => r.Record_ID === body.Record_ID);
            if (existing && store.getMilestoneProvinceCode(existing) !== scopeCode) {
              return sendJson(res, 403, {
                error: `Access restricted to ${provinceScope.provinceName} (${scopeCode}) records only.`
              });
            }
          }
        }
        const payload = scopeCode ? { ...body, Province_Code: scopeCode } : body;
        const saved = store.upsertMilestone(payload);
        const gasPushResult =
          body.pushToGas !== false
            ? await pushMutationToGas(
                store,
                { action: 'upsertMilestone', record: saved },
                `Pushed ${saved.Record_ID} to Regional Google Sheet.`,
                gasPushFn
              )
            : null;
        return sendJson(res, 200, {
          record: saved,
          gasPushResult,
          milestoneData: store.getScopedState(scopeCode).milestoneData,
          analytics: computeScopedAnalytics(store, query, scopeCode)
        });
      }

      if (req.method === 'DELETE' && pathname.startsWith('/api/milestones/')) {
        const recordId = decodeURIComponent(pathname.slice('/api/milestones/'.length));
        const existing = store.state.milestoneData.find((r) => r.Record_ID === recordId);
        if (!existing) return sendJson(res, 404, { error: 'Record not found' });
        if (scopeCode && store.getMilestoneProvinceCode(existing) !== scopeCode) {
          return sendJson(res, 403, {
            error: `Access restricted to ${provinceScope.provinceName} (${scopeCode}) records only.`
          });
        }
        const ok = store.deleteMilestone(recordId);
        if (!ok) return sendJson(res, 404, { error: 'Record not found' });
        const gasPushResult = await pushMutationToGas(
          store,
          { action: 'deleteMilestone', recordId },
          `Deleted milestone ${recordId} from Regional Google Sheet.`,
          gasPushFn
        );
        return sendJson(res, 200, {
          ok: true,
          gasPushResult,
          milestoneData: store.getScopedState(scopeCode).milestoneData,
          analytics: computeScopedAnalytics(store, query, scopeCode)
        });
      }

      if (pathname.startsWith('/api/optool/')) {
        const rest = pathname.slice('/api/optool/'.length);
        const parts = rest.split('/');
        const tabName = decodeURIComponent(parts[0] || '');

        if (!OPTOOL_SHEET_SCHEMAS[tabName]) {
          return sendJson(res, 404, { error: `Unknown OPTool tab: ${tabName}` });
        }

        if (req.method === 'GET' && parts.length === 1) {
          return sendJson(res, 200, {
            tabName,
            rows: store.getScopedOptoolTabRows(tabName, scopeCode)
          });
        }

        if (req.method === 'POST' && tabName === 'Database' && parts[1] === 'milestone-target') {
          const body = await readJsonBody(req);
          const clientIdx = Number(body.index);
          const globalIdx = store.getOptoolGlobalIndex('Database', clientIdx, scopeCode);
          if (globalIdx < 0) {
            return sendJson(res, 404, { error: 'Database row not found' });
          }
          try {
            const result = store.setDatabaseMilestoneTarget(globalIdx, body.milestoneTarget ?? '');
            const gasPushResult = await pushMutationToGas(
              store,
              {
                action: 'upsertOptoolRow',
                tabName: 'Database',
                headers: getOptoolHeadersSpec('Database'),
                row: result.row,
                prevRow: result.row,
                provinceCode: inferOptoolRowProvinceCode(store, result.row)
              },
              `Updated Database Milestone Target (${result.row.lhid || `row #${globalIdx + 1}`}) in Google Sheet.`,
              gasPushFn
            );
            if (result.createdInTab && result.targetTab) {
              await pushRoutedTargetRow(store, result.targetTab, result.row.lhid, gasPushFn);
            }
            const scopedState = store.getScopedState(scopeCode);
            return sendJson(res, 200, {
              ok: true,
              ...result,
              gasPushResult,
              rows: scopedState.optool.Database,
              optool: scopedState.optool,
              analytics: computeScopedAnalytics(store, query, scopeCode)
            });
          } catch (err) {
            return sendJson(res, 400, { error: err.message });
          }
        }

        if (req.method === 'POST' && parts.length === 1) {
          const body = await readJsonBody(req);
          const clientIdx = body.index !== undefined && body.index !== null ? Number(body.index) : null;
          let globalIdx = null;
          if (clientIdx !== null) {
            globalIdx = store.getOptoolGlobalIndex(tabName, clientIdx, scopeCode);
            if (scopeCode && globalIdx < 0) {
              return sendJson(res, 404, { error: 'OPTool row not found in your province scope' });
            }
          }

          const rowPayload = { ...(body.row || body) };
          if (scopeCode) {
            if (
              rowPayload.province &&
              inferProvinceCodeFromText(rowPayload.province) &&
              inferProvinceCodeFromText(rowPayload.province) !== scopeCode
            ) {
              return sendJson(res, 403, {
                error: `Access restricted to ${provinceScope.provinceName} (${scopeCode}) records only.`
              });
            }
            const tabHasProv = ['Database', 'RegistrationDistribution', 'Installation'].includes(tabName);
            if (tabHasProv) {
              rowPayload.province = provinceScope.provinceName;
            }
            const resolvedProv = store.getOptoolRowProvinceCode(tabName, rowPayload);
            if (resolvedProv && resolvedProv !== scopeCode) {
              return sendJson(res, 403, {
                error: `Access restricted to ${provinceScope.provinceName} (${scopeCode}) records only.`
              });
            }
            if (!tabHasProv && !resolvedProv) {
              return sendJson(res, 403, {
                error: `${tabName} entries must reference a ${provinceScope.provinceName} (${scopeCode}) Database LHID.`
              });
            }
          }

          const prevRow =
            globalIdx !== null && Number.isInteger(globalIdx) && globalIdx >= 0
              ? store.state.optool[tabName]?.[globalIdx] || null
              : null;
          const saved = store.upsertOptoolRow(tabName, rowPayload, globalIdx);
          const createdInTab =
            tabName === 'Database' && MILESTONE_TARGET_TABS.includes(saved.milestoneTarget)
              ? store.syncDatabaseRowToTargetTab(saved)
              : false;
          const gasPushResult = await pushMutationToGas(
            store,
            {
              action: 'upsertOptoolRow',
              tabName,
              headers: getOptoolHeadersSpec(tabName),
              row: saved,
              prevRow,
              provinceCode: inferOptoolRowProvinceCode(store, saved)
            },
            `Saved ${tabName} row (${saved.lhid || 'record'}) to Regional Google Sheet.`,
            gasPushFn
          );
          if (createdInTab && saved.milestoneTarget) {
            await pushRoutedTargetRow(store, saved.milestoneTarget, saved.lhid, gasPushFn);
          }
          const scopedState = store.getScopedState(scopeCode);
          return sendJson(res, 200, {
            row: saved,
            gasPushResult,
            rows: scopedState.optool[tabName],
            optool: scopedState.optool,
            analytics: computeScopedAnalytics(store, query, scopeCode)
          });
        }

        if (req.method === 'DELETE' && parts.length === 2) {
          const clientIdx = Number(parts[1]);
          const globalIdx = store.getOptoolGlobalIndex(tabName, clientIdx, scopeCode);
          const deletedRow = globalIdx >= 0 ? store.state.optool[tabName]?.[globalIdx] || null : null;
          const ok = globalIdx >= 0 ? store.deleteOptoolRow(tabName, globalIdx) : false;
          if (!ok) return sendJson(res, 404, { error: 'OPTool row not found' });
          const gasPushResult = deletedRow
            ? await pushMutationToGas(
                store,
                {
                  action: 'deleteOptoolRow',
                  tabName,
                  headers: getOptoolHeadersSpec(tabName),
                  row: deletedRow,
                  provinceCode: inferOptoolRowProvinceCode(store, deletedRow)
                },
                `Deleted ${tabName} row (${deletedRow.lhid || `#${globalIdx + 1}`}) from Regional Google Sheet.`,
                gasPushFn
              )
            : null;
          return sendJson(res, 200, {
            ok: true,
            gasPushResult,
            rows: store.getScopedOptoolTabRows(tabName, scopeCode),
            analytics: computeScopedAnalytics(store, query, scopeCode)
          });
        }
      }

      if (req.method === 'GET' && pathname.startsWith('/api/landholding/')) {
        const lhid = decodeURIComponent(pathname.slice('/api/landholding/'.length));
        const dossier = store.getLandholding360(lhid);
        return sendJson(res, 200, store.filterLandholding360ByScope(dossier, scopeCode));
      }

      if (req.method === 'PUT' && pathname === '/api/baselines') {
        if (scopeCode) {
          return sendJson(res, 403, { error: 'Regional Administrator or Hub access required to edit baselines.' });
        }
        const body = await readJsonBody(req);
        const baselines = store.updateBaselines(body);
        const gasPushResult = await pushMutationToGas(
          store,
          { action: 'saveBaselines', baselines },
          'Updated Regional Baselines in Google Sheet.',
          gasPushFn
        );
        return sendJson(res, 200, { baselines, gasPushResult, analytics: computeScopedAnalytics(store, query, scopeCode) });
      }

      if (req.method === 'PUT' && pathname === '/api/nep-targets') {
        if (scopeCode) {
          return sendJson(res, 403, { error: 'Only Regional Accounts can edit the Regional NEP Target List.' });
        }
        const body = await readJsonBody(req);
        const nepTargets = store.updateNepTargets(body);
        return sendJson(res, 200, {
          nepTargets,
          analytics: computeScopedAnalytics(store, query, scopeCode)
        });
      }

      if (req.method === 'PUT' && pathname === '/api/nep-sheet') {
        if (scopeCode) {
          return sendJson(res, 403, { error: 'Only Regional Accounts can edit the Regional Hub NEP Sheet.' });
        }
        const body = await readJsonBody(req);
        const nepProvinceList = store.updateNepProvinceList(body);
        const gasSync = await pushMutationToGas(
          store,
          { action: 'saveNepSheet', nepProvinceList },
          'Updated Regional Hub NEP Sheet (LHS, AREA, ARBs per province).',
          gasPushFn
        );
        return sendJson(res, 200, {
          ok: true,
          nepProvinceList,
          gasSync,
          analytics: computeScopedAnalytics(store, query, scopeCode)
        });
      }

      if (req.method === 'POST' && pathname === '/api/nep-sheet/sync') {
        if (scopeCode) {
          return sendJson(res, 403, { error: 'Only Regional Accounts can sync the Regional Hub NEP Sheet.' });
        }
        const gasUrl = String(store.state.gasWebAppUrl || '').trim();
        if (!gasUrl) {
          return sendJson(res, 400, { error: 'Configure the GAS Web App URL first under Google Sheets & GAS ETL.' });
        }
        let remote = await gasPullNepFn(gasUrl);
        if (!remote?.nepProvinceList) {
          remote = await gasPushFn(gasUrl, {
            action: 'initNepSheet',
            nepProvinceList: store.state.nepProvinceList
          });
        }
        if (!remote?.ok || !remote?.nepProvinceList) {
          return sendJson(res, 502, {
            error: remote?.error || 'GAS Web App did not return a valid NEP Sheet payload.'
          });
        }
        const nepProvinceList = store.updateNepProvinceList(remote.nepProvinceList);
        store.addSyncLog('Hub NEP Sheet Sync', 'success', 'Synced Regional Hub NEP sheet (LHS, AREA, ARBs).');
        store.save();
        return sendJson(res, 200, {
          ok: true,
          nepProvinceList,
          analytics: computeScopedAnalytics(store, query, scopeCode)
        });
      }

      if (req.method === 'POST' && pathname === '/api/sync/google-sheet') {
        const body = await readJsonBody(req);
        const {
          spreadsheetId = REGIONAL_REGISTRY[0].spreadsheetId,
          mode = 'merge',
          label = 'Regional Account (Hub)'
        } = body;

        const matchedNode = REGIONAL_REGISTRY.find((n) => n.spreadsheetId === spreadsheetId);
        if (scopeCode) {
          if (!matchedNode || matchedNode.code !== scopeCode) {
            return sendJson(res, 403, {
              error: `Provincial accounts can only sync their own ${provinceScope.provinceName} (${scopeCode}) Google Sheet node.`
            });
          }
          if (mode === 'replace') {
            return sendJson(res, 403, {
              error: 'Provincial accounts cannot replace the consolidated regional store; use merge mode.'
            });
          }
        }

        try {
          const rawParsed = await fetchGoogleSheetXlsx(spreadsheetId);
          const parsed = filterParsedDatasetByScope(store, rawParsed, scopeCode);
          const totalImportedRows =
            parsed.milestoneData.length +
            Object.values(parsed.optool).reduce((acc, arr) => acc + arr.length, 0);

          if (!store.state.nodeStatuses) store.state.nodeStatuses = {};
          if (matchedNode) {
            store.state.nodeStatuses[matchedNode.code] = {
              code: matchedNode.code,
              jurisdiction: matchedNode.jurisdiction,
              status: 'synced',
              importedRows: totalImportedRows,
              tabRowCounts: parsed.tabRowCounts,
              checkedAt: new Date().toISOString()
            };
          }

          if (spreadsheetId === REGIONAL_REGISTRY[0].spreadsheetId) {
            store.state.liveHubSnapshot = {
              checkedAt: new Date().toISOString(),
              reachable: true,
              sheetNames: parsed.sheetNames,
              tabRowCounts: parsed.tabRowCounts
            };
          }

          if (mode === 'replace') {
            store.state.milestoneData = [];
            for (const t of Object.keys(OPTOOL_SHEET_SCHEMAS)) store.state.optool[t] = [];
            store.state.dataSourceMode = 'live';
          } else if (mode === 'merge' && totalImportedRows > 0) {
            store.state.dataSourceMode = store.state.dataSourceMode === 'sample' ? 'merged' : 'live';
          }

          if (mode !== 'probe' && totalImportedRows > 0) {
            store.importParsedDataset(parsed, { skipSave: true });
          }

          store.state.lastSyncAt = new Date().toISOString();
          store.addSyncLog(
            `Google Sheet Sync (${label})`,
            'success',
            totalImportedRows > 0
              ? `Connected & synced ${totalImportedRows} rows across ${parsed.sheetNames.length} tabs.`
              : `Connected to Google Sheet (${parsed.sheetNames.join(', ')}). Schema verified — 0 populated data rows found in sheet.`,
            parsed.tabRowCounts
          );
          store.save();

          return sendJson(res, 200, {
            ok: true,
            sheetNames: parsed.sheetNames,
            tabRowCounts: parsed.tabRowCounts,
            importedRows: totalImportedRows,
            state: buildScopedStatePayload(store, scopeCode, false),
            analytics: computeScopedAnalytics(store, query, scopeCode)
          });
        } catch (err) {
          if (!store.state.nodeStatuses) store.state.nodeStatuses = {};
          if (matchedNode) {
            const isAuth = String(err.message || '').includes('401') || String(err.message || '').includes('403');
            store.state.nodeStatuses[matchedNode.code] = {
              code: matchedNode.code,
              jurisdiction: matchedNode.jurisdiction,
              status: isAuth ? 'unauthorized' : 'error',
              importedRows: 0,
              error: err.message,
              checkedAt: new Date().toISOString()
            };
          }
          if (spreadsheetId === REGIONAL_REGISTRY[0].spreadsheetId) {
            store.state.liveHubSnapshot = {
              checkedAt: new Date().toISOString(),
              reachable: false,
              error: err.message,
              tabRowCounts: {}
            };
          }
          store.addSyncLog(`Google Sheet Sync (${label})`, 'error', err.message);
          store.save();
          return sendJson(res, 502, {
            ok: false,
            error: err.message,
            syncLogs: store.state.syncLogs,
            nodeStatuses: store.getScopedState(scopeCode).nodeStatuses,
            liveHubSnapshot: store.state.liveHubSnapshot
          });
        }
      }

      if (req.method === 'POST' && pathname === '/api/sync/all-nodes') {
        const body = await readJsonBody(req);
        const mode = body.mode || 'merge';
        if (scopeCode && mode === 'replace') {
          return sendJson(res, 403, {
            error: 'Provincial accounts cannot replace the consolidated regional store; use merge mode.'
          });
        }
        if (mode === 'replace') {
          store.state.milestoneData = [];
          for (const t of Object.keys(OPTOOL_SHEET_SCHEMAS)) store.state.optool[t] = [];
          store.state.dataSourceMode = 'live';
        }
        if (!store.state.nodeStatuses) store.state.nodeStatuses = {};

        const results = [];
        let totalImported = 0;
        const nodesToSync = scopeCode
          ? REGIONAL_REGISTRY.filter((n) => n.code === scopeCode)
          : REGIONAL_REGISTRY;

        for (const node of nodesToSync) {
          try {
            const rawParsed = await fetchGoogleSheetXlsx(node.spreadsheetId);
            const parsed = filterParsedDatasetByScope(store, rawParsed, scopeCode);
            const rowCount =
              parsed.milestoneData.length +
              Object.values(parsed.optool).reduce((acc, arr) => acc + arr.length, 0);

            const hasNep = Boolean(!scopeCode && parsed.nepProvinceList);
            if (rowCount > 0 || hasNep) {
              store.importParsedDataset(
                {
                  milestoneData: parsed.milestoneData,
                  optool: parsed.optool,
                  nepProvinceList: !scopeCode ? parsed.nepProvinceList : null
                },
                { skipSave: true }
              );
              if (rowCount > 0 && store.state.dataSourceMode === 'sample') {
                store.state.dataSourceMode = 'merged';
              }
            }

            if (node.code === 'HUB') {
              store.state.liveHubSnapshot = {
                checkedAt: new Date().toISOString(),
                reachable: true,
                sheetNames: parsed.sheetNames,
                tabRowCounts: parsed.tabRowCounts
              };
            }

            const statusObj = {
              code: node.code,
              jurisdiction: node.jurisdiction,
              status: 'synced',
              importedRows: rowCount,
              tabRowCounts: parsed.tabRowCounts,
              checkedAt: new Date().toISOString()
            };
            store.state.nodeStatuses[node.code] = statusObj;
            results.push(statusObj);
            totalImported += rowCount;
          } catch (err) {
            const isAuth = String(err.message || '').includes('401') || String(err.message || '').includes('403');
            const statusObj = {
              code: node.code,
              jurisdiction: node.jurisdiction,
              status: isAuth ? 'unauthorized' : 'error',
              importedRows: 0,
              error: err.message,
              checkedAt: new Date().toISOString()
            };
            store.state.nodeStatuses[node.code] = statusObj;
            results.push(statusObj);
          }
        }

        store.state.lastSyncAt = new Date().toISOString();
        const syncedCount = results.filter((r) => r.status === 'synced').length;
        const authCount = results.filter((r) => r.status === 'unauthorized').length;
        store.addSyncLog(
          'Multi-Node Registry Sync',
          totalImported > 0 ? 'success' : 'info',
          `Checked ${results.length} sheets: ${syncedCount} reachable (${totalImported} rows imported), ${authCount} private/unauthorized (requires link sharing or GAS ETL).`,
          results
        );
        store.save();

        return sendJson(res, 200, {
          ok: true,
          results,
          totalImported,
          state: buildScopedStatePayload(store, scopeCode, false),
          analytics: computeScopedAnalytics(store, query, scopeCode)
        });
      }

      if (req.method === 'POST' && pathname === '/api/sync/gas-config') {
        if (scopeCode) {
          return sendJson(res, 403, { error: 'Regional Administrator or Hub access required for GAS Web App configuration.' });
        }
        const body = await readJsonBody(req);
        const { gasWebAppUrl = '', action = 'save' } = body;
        store.state.gasWebAppUrl = String(gasWebAppUrl).trim();

        if (action === 'pull' && store.state.gasWebAppUrl) {
          try {
            const snapshot = await gasPullFn(store.state.gasWebAppUrl);
            const count = store.importParsedDataset(
              {
                milestoneData: snapshot.milestoneData,
                optool: snapshot.optool,
                nepProvinceList: snapshot.nepProvinceList || null
              },
              { skipSave: true }
            );
            if (Array.isArray(snapshot.users)) {
              store.mergeUsersFromSheet(snapshot.users);
            }
            store.state.lastSyncAt = new Date().toISOString();
            store.state.dataSourceMode = 'live';
            store.addSyncLog('GAS Web App Pull', 'success', `Pulled ${count} records from GAS Web App.`);
            store.save();
            return sendJson(res, 200, {
              ok: true,
              importedRows: count,
              gasWebAppUrl: store.state.gasWebAppUrl,
              syncLogs: store.state.syncLogs,
              milestoneData: store.state.milestoneData,
              optool: store.state.optool,
              nepProvinceList: store.state.nepProvinceList,
              analytics: store.computeAnalytics(query)
            });
          } catch (err) {
            store.addSyncLog('GAS Web App Pull', 'error', err.message);
            store.save();
            return sendJson(res, 502, { ok: false, error: err.message, syncLogs: store.state.syncLogs });
          }
        }

        store.addSyncLog(
          'GAS Config',
          'info',
          store.state.gasWebAppUrl ? 'Saved GAS Web App endpoint.' : 'Cleared GAS Web App endpoint.'
        );
        store.save();
        return sendJson(res, 200, {
          ok: true,
          gasWebAppUrl: store.state.gasWebAppUrl,
          syncLogs: store.state.syncLogs
        });
      }

      if (req.method === 'POST' && pathname === '/api/sync/gas-headers') {
        if (scopeCode) {
          return sendJson(res, 403, { error: 'Regional Administrator or Hub access required to push GAS headers.' });
        }
        const body = await readJsonBody(req);
        const gasUrl = String(body.gasWebAppUrl || store.state.gasWebAppUrl || '').trim();
        if (!gasUrl) {
          return sendJson(res, 400, { ok: false, error: 'Configured GAS Web App URL is required.' });
        }
        try {
          const result = await gasPushFn(gasUrl, { action: 'syncOptoolHeaders' });
          const syncedSheets = (result.results || []).filter((r) => r.status === 'synced').length;
          store.addSyncLog(
            'GAS Header Sync',
            'success',
            `Synchronized SALIG column headers across ${syncedSheets} Google Sheet(s).`,
            result.results
          );
          store.save();
          return sendJson(res, 200, { ok: true, ...result, syncLogs: store.state.syncLogs });
        } catch (err) {
          store.addSyncLog('GAS Header Sync', 'error', err.message);
          store.save();
          return sendJson(res, 502, { ok: false, error: err.message, syncLogs: store.state.syncLogs });
        }
      }

      if (req.method === 'POST' && pathname === '/api/import/xlsx') {
        const buf = await readRequestBuffer(req);
        const mode = query.mode || 'merge';
        if (scopeCode && mode === 'replace') {
          return sendJson(res, 403, {
            error: 'Provincial accounts cannot replace the consolidated regional store; use merge mode.'
          });
        }
        const filename = req.headers['x-filename'] || 'uploaded.xlsx';
        const rawParsed = await parseWorkbookBuffer(buf);
        const parsed = filterParsedDatasetByScope(store, rawParsed, scopeCode);
        const total =
          parsed.milestoneData.length +
          Object.values(parsed.optool).reduce((acc, arr) => acc + arr.length, 0);

        if (mode === 'replace') {
          store.state.milestoneData = [];
          for (const t of Object.keys(OPTOOL_SHEET_SCHEMAS)) store.state.optool[t] = [];
          store.state.dataSourceMode = 'live';
        } else if (total > 0 && store.state.dataSourceMode === 'sample') {
          store.state.dataSourceMode = 'merged';
        }

        store.importParsedDataset(parsed, { skipSave: true });

        store.state.lastSyncAt = new Date().toISOString();
        store.addSyncLog(
          `XLSX Import (${filename})`,
          'success',
          `Imported ${total} records from ${parsed.sheetNames.length} worksheet(s).`,
          parsed.tabRowCounts
        );
        store.save();

        const scopedState = store.getScopedState(scopeCode);
        return sendJson(res, 200, {
          ok: true,
          importedRows: total,
          tabRowCounts: parsed.tabRowCounts,
          dataSourceMode: store.state.dataSourceMode,
          syncLogs: store.state.syncLogs,
          milestoneData: scopedState.milestoneData,
          optool: scopedState.optool,
          analytics: computeScopedAnalytics(store, query, scopeCode)
        });
      }

      if (req.method === 'POST' && pathname === '/api/import/csv') {
        const body = await readJsonBody(req);
        const { csvText = '', targetTab = 'Milestone_Data', filename = 'import.csv' } = body;
        const rawRows = parseCsvText(csvText, targetTab);
        let rows = rawRows;
        if (targetTab === 'Milestone_Data') {
          const parsed = filterParsedDatasetByScope(store, { milestoneData: rawRows, optool: {} }, scopeCode);
          rows = parsed.milestoneData;
          store.importParsedDataset({ milestoneData: rows }, { skipSave: true });
        } else if (OPTOOL_SHEET_SCHEMAS[targetTab]) {
          const parsed = filterParsedDatasetByScope(
            store,
            { milestoneData: [], optool: { [targetTab]: rawRows } },
            scopeCode
          );
          rows = parsed.optool[targetTab] || [];
          store.importParsedDataset({ optool: { [targetTab]: rows } }, { skipSave: true });
        } else {
          return sendJson(res, 400, { error: `Unsupported targetTab: ${targetTab}` });
        }
        store.addSyncLog(`CSV Import (${filename})`, 'success', `Imported ${rows.length} rows into ${targetTab}.`);
        store.save();
        const scopedState = store.getScopedState(scopeCode);
        return sendJson(res, 200, {
          ok: true,
          importedRows: rows.length,
          syncLogs: store.state.syncLogs,
          milestoneData: scopedState.milestoneData,
          optool: scopedState.optool,
          analytics: computeScopedAnalytics(store, query, scopeCode)
        });
      }

      if (req.method === 'GET' && pathname === '/api/export/xlsx') {
        const analytics = computeScopedAnalytics(store, query, scopeCode);
        const scopedState = store.getScopedState(scopeCode);
        const buffer = await buildConsolidatedWorkbookBuffer(scopedState, analytics);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="DAR_Region8_SPLIT_Consolidated_${new Date()
            .toISOString()
            .slice(0, 10)}.xlsx"`,
          'Content-Length': buffer.length
        });
        res.end(buffer);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/workspace/reset-sample') {
        if (scopeCode) {
          return sendJson(res, 403, { error: 'Regional Administrator or Hub access required to reset workspace data.' });
        }
        store.resetToSample();
        return sendJson(res, 200, {
          ok: true,
          state: store.state,
          analytics: store.computeAnalytics(query)
        });
      }

      if (req.method === 'POST' && pathname === '/api/workspace/clear') {
        if (scopeCode) {
          return sendJson(res, 403, { error: 'Regional Administrator or Hub access required to clear workspace data.' });
        }
        store.clearToEmptyLive();
        return sendJson(res, 200, {
          ok: true,
          state: store.state,
          analytics: store.computeAnalytics(query)
        });
      }

      if (pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: `API route not found: ${pathname}` });
      }

      // Static Frontend Serving
      const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const resolved = path.resolve(PUBLIC_DIR, relPath);
      if (!resolved.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      let filePath = resolved;
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(PUBLIC_DIR, 'index.html');
      }

      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  };

  const server = http.createServer(handler);
  return { server, store, handler };
}
