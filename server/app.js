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
  MILESTONE_DATA_COLUMNS,
  OPTOOL_SHEET_SCHEMAS,
  OPTOOL_PREVIEW_COLUMNS
} from './schema.js';
import { ConsolidatedStore } from './store.js';
import {
  fetchGoogleSheetXlsx,
  parseWorkbookBuffer,
  parseCsvText,
  buildConsolidatedWorkbookBuffer,
  pullFromGasWebApp,
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

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Filename'
  });
  res.end(body);
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

export function createAppServer(dataDir) {
  const store = new ConsolidatedStore(dataDir);

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
      // API Routes
      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
      }

      if (req.method === 'GET' && pathname === '/api/bootstrap') {
        const analytics = store.computeAnalytics(query);
        return sendJson(res, 200, {
          schemas: {
            registry: REGIONAL_REGISTRY,
            provinceCodes: PROVINCE_CODES,
            lguMasterList: LGU_MASTER_LIST,
            milestoneStages: MILESTONE_STAGES,
            batchCategories: BATCH_CATEGORIES,
            milestoneTargetTabs: MILESTONE_TARGET_TABS,
            milestoneColumns: MILESTONE_DATA_COLUMNS,
            optoolTabs: OPTOOL_SHEET_SCHEMAS,
            optoolPreviewCols: OPTOOL_PREVIEW_COLUMNS
          },
          state: {
            dataSourceMode: store.state.dataSourceMode,
            gasWebAppUrl: store.state.gasWebAppUrl,
            lastSyncAt: store.state.lastSyncAt,
            liveHubSnapshot: store.state.liveHubSnapshot,
            nodeStatuses: store.state.nodeStatuses || {},
            syncLogs: store.state.syncLogs,
            baselines: store.state.baselines,
            milestoneData: store.state.milestoneData,
            optool: store.state.optool
          },
          analytics,
          gasScript: readGasSource(),
          gasHtml: readGasHtmlSource()
        });
      }

      if (req.method === 'GET' && pathname === '/api/analytics') {
        return sendJson(res, 200, store.computeAnalytics(query));
      }

      if (req.method === 'GET' && pathname === '/api/milestones/next-id') {
        const recordId = store.generateNextRecordId(
          query.provinceCode || 'LEY',
          query.milestoneDate || ''
        );
        return sendJson(res, 200, { recordId });
      }

      if (req.method === 'POST' && pathname === '/api/milestones') {
        const body = await readJsonBody(req);
        const saved = store.upsertMilestone(body);
        let gasPushResult = null;
        if (body.pushToGas && store.state.gasWebAppUrl) {
          try {
            gasPushResult = await pushToGasWebApp(store.state.gasWebAppUrl, {
              action: 'upsertMilestone',
              record: saved
            });
            store.addSyncLog(
              'GAS Web App Push',
              'success',
              `Pushed ${saved.Record_ID} to Regional Google Sheet.`
            );
            store.save();
          } catch (err) {
            gasPushResult = { ok: false, error: err.message };
            store.addSyncLog(
              'GAS Web App Push',
              'error',
              `Saved locally; GAS push failed: ${err.message}`
            );
            store.save();
          }
        }
        return sendJson(res, 200, {
          record: saved,
          gasPushResult,
          milestoneData: store.state.milestoneData,
          analytics: store.computeAnalytics(query)
        });
      }

      if (req.method === 'DELETE' && pathname.startsWith('/api/milestones/')) {
        const recordId = decodeURIComponent(pathname.slice('/api/milestones/'.length));
        const ok = store.deleteMilestone(recordId);
        if (!ok) return sendJson(res, 404, { error: 'Record not found' });
        return sendJson(res, 200, {
          ok: true,
          milestoneData: store.state.milestoneData,
          analytics: store.computeAnalytics(query)
        });
      }

      if (pathname.startsWith('/api/optool/')) {
        const rest = pathname.slice('/api/optool/'.length);
        const parts = rest.split('/');
        const tabName = decodeURIComponent(parts[0] || '');

        if (req.method === 'POST' && tabName === 'Database' && parts[1] === 'milestone-target') {
          const body = await readJsonBody(req);
          const idx = Number(body.index);
          try {
            const result = store.setDatabaseMilestoneTarget(idx, body.milestoneTarget ?? '');
            return sendJson(res, 200, {
              ok: true,
              ...result,
              rows: store.state.optool.Database,
              optool: store.state.optool,
              analytics: store.computeAnalytics(query)
            });
          } catch (err) {
            return sendJson(res, 400, { error: err.message });
          }
        }

        if (req.method === 'POST' && parts.length === 1) {
          const body = await readJsonBody(req);
          const saved = store.upsertOptoolRow(tabName, body.row || body, body.index ?? null);
          if (tabName === 'Database' && MILESTONE_TARGET_TABS.includes(saved.milestoneTarget)) {
            store.syncDatabaseRowToTargetTab(saved);
          }
          return sendJson(res, 200, {
            row: saved,
            rows: store.state.optool[tabName],
            optool: store.state.optool,
            analytics: store.computeAnalytics(query)
          });
        }

        if (req.method === 'DELETE' && parts.length === 2) {
          const idx = Number(parts[1]);
          const ok = store.deleteOptoolRow(tabName, idx);
          if (!ok) return sendJson(res, 404, { error: 'OPTool row not found' });
          return sendJson(res, 200, {
            ok: true,
            rows: store.state.optool[tabName],
            analytics: store.computeAnalytics(query)
          });
        }
      }

      if (req.method === 'GET' && pathname.startsWith('/api/landholding/')) {
        const lhid = decodeURIComponent(pathname.slice('/api/landholding/'.length));
        return sendJson(res, 200, store.getLandholding360(lhid));
      }

      if (req.method === 'PUT' && pathname === '/api/baselines') {
        const body = await readJsonBody(req);
        const baselines = store.updateBaselines(body);
        return sendJson(res, 200, { baselines, analytics: store.computeAnalytics(query) });
      }

      if (req.method === 'POST' && pathname === '/api/sync/google-sheet') {
        const body = await readJsonBody(req);
        const {
          spreadsheetId = REGIONAL_REGISTRY[0].spreadsheetId,
          mode = 'merge',
          label = 'Regional Account (Hub)'
        } = body;

        try {
          const parsed = await fetchGoogleSheetXlsx(spreadsheetId);
          const totalImportedRows =
            parsed.milestoneData.length +
            Object.values(parsed.optool).reduce((acc, arr) => acc + arr.length, 0);

          const matchedNode = REGIONAL_REGISTRY.find((n) => n.spreadsheetId === spreadsheetId);
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
            for (const ms of parsed.milestoneData) store.upsertMilestone(ms);
            for (const [tabName, rows] of Object.entries(parsed.optool)) {
              for (const row of rows) store.upsertOptoolRow(tabName, row);
            }
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
            state: {
              dataSourceMode: store.state.dataSourceMode,
              lastSyncAt: store.state.lastSyncAt,
              liveHubSnapshot: store.state.liveHubSnapshot,
              nodeStatuses: store.state.nodeStatuses,
              syncLogs: store.state.syncLogs,
              milestoneData: store.state.milestoneData,
              optool: store.state.optool
            },
            analytics: store.computeAnalytics(query)
          });
        } catch (err) {
          const matchedNode = REGIONAL_REGISTRY.find((n) => n.spreadsheetId === spreadsheetId);
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
            nodeStatuses: store.state.nodeStatuses,
            liveHubSnapshot: store.state.liveHubSnapshot
          });
        }
      }

      if (req.method === 'POST' && pathname === '/api/sync/all-nodes') {
        const body = await readJsonBody(req);
        const mode = body.mode || 'merge';
        if (mode === 'replace') {
          store.state.milestoneData = [];
          for (const t of Object.keys(OPTOOL_SHEET_SCHEMAS)) store.state.optool[t] = [];
          store.state.dataSourceMode = 'live';
        }
        if (!store.state.nodeStatuses) store.state.nodeStatuses = {};

        const results = [];
        let totalImported = 0;

        for (const node of REGIONAL_REGISTRY) {
          try {
            const parsed = await fetchGoogleSheetXlsx(node.spreadsheetId);
            const rowCount =
              parsed.milestoneData.length +
              Object.values(parsed.optool).reduce((acc, arr) => acc + arr.length, 0);

            if (rowCount > 0) {
              for (const ms of parsed.milestoneData) store.upsertMilestone(ms);
              for (const [tabName, rows] of Object.entries(parsed.optool)) {
                for (const row of rows) store.upsertOptoolRow(tabName, row);
              }
              if (store.state.dataSourceMode === 'sample') {
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
          state: {
            dataSourceMode: store.state.dataSourceMode,
            lastSyncAt: store.state.lastSyncAt,
            liveHubSnapshot: store.state.liveHubSnapshot,
            nodeStatuses: store.state.nodeStatuses,
            syncLogs: store.state.syncLogs,
            milestoneData: store.state.milestoneData,
            optool: store.state.optool
          },
          analytics: store.computeAnalytics(query)
        });
      }

      if (req.method === 'POST' && pathname === '/api/sync/gas-config') {
        const body = await readJsonBody(req);
        const { gasWebAppUrl = '', action = 'save' } = body;
        store.state.gasWebAppUrl = String(gasWebAppUrl).trim();

        if (action === 'pull' && store.state.gasWebAppUrl) {
          try {
            const snapshot = await pullFromGasWebApp(store.state.gasWebAppUrl);
            let count = 0;
            if (Array.isArray(snapshot.milestoneData)) {
              for (const r of snapshot.milestoneData) {
                store.upsertMilestone(r);
                count++;
              }
            }
            if (snapshot.optool && typeof snapshot.optool === 'object') {
              for (const [tabName, rows] of Object.entries(snapshot.optool)) {
                if (Array.isArray(rows) && OPTOOL_SHEET_SCHEMAS[tabName]) {
                  for (const r of rows) {
                    store.upsertOptoolRow(tabName, r);
                    count++;
                  }
                }
              }
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

      if (req.method === 'POST' && pathname === '/api/import/xlsx') {
        const buf = await readRequestBuffer(req);
        const mode = query.mode || 'merge';
        const filename = req.headers['x-filename'] || 'uploaded.xlsx';
        const parsed = await parseWorkbookBuffer(buf);
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

        for (const ms of parsed.milestoneData) store.upsertMilestone(ms);
        for (const [tabName, rows] of Object.entries(parsed.optool)) {
          for (const row of rows) store.upsertOptoolRow(tabName, row);
        }

        store.state.lastSyncAt = new Date().toISOString();
        store.addSyncLog(
          `XLSX Import (${filename})`,
          'success',
          `Imported ${total} records from ${parsed.sheetNames.length} worksheet(s).`,
          parsed.tabRowCounts
        );
        store.save();

        return sendJson(res, 200, {
          ok: true,
          importedRows: total,
          tabRowCounts: parsed.tabRowCounts,
          dataSourceMode: store.state.dataSourceMode,
          syncLogs: store.state.syncLogs,
          milestoneData: store.state.milestoneData,
          optool: store.state.optool,
          analytics: store.computeAnalytics(query)
        });
      }

      if (req.method === 'POST' && pathname === '/api/import/csv') {
        const body = await readJsonBody(req);
        const { csvText = '', targetTab = 'Milestone_Data', filename = 'import.csv' } = body;
        const rows = parseCsvText(csvText, targetTab);
        if (targetTab === 'Milestone_Data') {
          for (const r of rows) store.upsertMilestone(r);
        } else if (OPTOOL_SHEET_SCHEMAS[targetTab]) {
          for (const r of rows) store.upsertOptoolRow(targetTab, r);
        } else {
          return sendJson(res, 400, { error: `Unsupported targetTab: ${targetTab}` });
        }
        store.addSyncLog(`CSV Import (${filename})`, 'success', `Imported ${rows.length} rows into ${targetTab}.`);
        store.save();
        return sendJson(res, 200, {
          ok: true,
          importedRows: rows.length,
          syncLogs: store.state.syncLogs,
          milestoneData: store.state.milestoneData,
          optool: store.state.optool,
          analytics: store.computeAnalytics(query)
        });
      }

      if (req.method === 'GET' && pathname === '/api/export/xlsx') {
        const analytics = store.computeAnalytics(query);
        const buffer = await buildConsolidatedWorkbookBuffer(store.state, analytics);
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
        store.resetToSample();
        return sendJson(res, 200, {
          ok: true,
          state: store.state,
          analytics: store.computeAnalytics(query)
        });
      }

      if (req.method === 'POST' && pathname === '/api/workspace/clear') {
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
  return { server, store };
}
