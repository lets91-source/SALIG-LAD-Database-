import {
  OPTOOL_SHEET_SCHEMAS,
  MILESTONE_DATA_COLUMNS,
  PROVINCE_CODES,
  REGIONAL_REGISTRY,
  normalizeNepProvinceList,
  inferProvinceCodeFromMunicipality,
  inferProvinceCodeFromText,
  formatArea4,
  normalizeChecklistValue
} from './schema.js';
import { readXlsxWorkbook, writeXlsxWorkbook } from './xlsxCodec.js';

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildHeaderMapping(headerRowValues, schemaCols) {
  const usedSchemaIndices = new Set();
  const colIndexToField = new Map();

  for (let colIdx = 1; colIdx < headerRowValues.length; colIdx++) {
    const rawHeader = String(headerRowValues[colIdx] ?? '').trim();
    const norm = normalizeHeader(rawHeader);
    if (!norm) continue;

    let matchedIdx = schemaCols.findIndex(
      (col, idx) => !usedSchemaIndices.has(idx) && normalizeHeader(col.header) === norm
    );

    if (matchedIdx < 0) {
      matchedIdx = schemaCols.findIndex(
        (col, idx) =>
          !usedSchemaIndices.has(idx) &&
          (normalizeHeader(col.label) === norm ||
            normalizeHeader(col.key) === norm ||
            (col.key === 'ladStatus' && (norm === 'lad' || norm === 'ladcolumn' || norm === 'ladstatus')) ||
            (col.key === 'workability' && norm === 'workability'))
      );
    }

    if (matchedIdx >= 0) {
      usedSchemaIndices.add(matchedIdx);
      colIndexToField.set(colIdx, schemaCols[matchedIdx]);
    }
  }

  return colIndexToField;
}

export async function parseWorkbookBuffer(buffer) {
  const worksheets = readXlsxWorkbook(buffer);

  const result = {
    sheetNames: worksheets.map((ws) => ws.name),
    tabRowCounts: {},
    milestoneData: [],
    optool: {},
    nepProvinceList: null,
    nepMilestoneList: null
  };

  for (const tabName of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
    result.optool[tabName] = [];
  }

  for (const ws of worksheets) {
    const name = ws.name.trim();
    const headerRowObj = ws.rows.find((r) => r.rowNumber === 1) || ws.rows[0];
    if (!headerRowObj) {
      result.tabRowCounts[name] = 0;
      continue;
    }
    const headerValues = headerRowObj.values || [];
    const dataRows = ws.rows.filter((r) => r.rowNumber > headerRowObj.rowNumber);

    if (normalizeHeader(name) === 'milestone_data' || normalizeHeader(name) === 'milestone data') {
      const mapping = buildHeaderMapping(headerValues, MILESTONE_DATA_COLUMNS);
      let rowCount = 0;
      for (const row of dataRows) {
        const record = {};
        let hasData = false;
        for (const [colIdx, colDef] of mapping.entries()) {
          const val = String(row.values[colIdx] ?? '').trim();
          if (val !== '') hasData = true;
          record[colDef.key] = val;
        }
        if (!hasData) continue;
        rowCount++;
        const provCode =
          record.Province_Code ||
          inferProvinceCodeFromMunicipality(record.Municipality) ||
          inferProvinceCodeFromText(record.Record_ID) ||
          'LEY';
        result.milestoneData.push({
          Record_ID: record.Record_ID || '',
          Province_Code: provCode,
          Municipality: record.Municipality || '',
          Land_Allocation_ID: record.Land_Allocation_ID || '',
          eTitle_No: record.eTitle_No || '',
          Area_HAS: formatArea4(record.Area_HAS),
          Milestone_Stage: record.Milestone_Stage || 'eTitle Registered',
          Milestone_Date: record.Milestone_Date || new Date().toISOString().slice(0, 10),
          Batch_Category: record.Batch_Category || 'ADMIN BATCH 1',
          LHID: record.LHID || ''
        });
      }
      result.tabRowCounts[name] = rowCount;
      continue;
    }

    if (normalizeHeader(name) === 'nep') {
      const nepColumns = [
        { key: 'code', header: 'Province_Code', label: 'Province Code' },
        { key: 'provinceName', header: 'Province', label: 'Province Name' },
        { key: 'lhs', header: 'LHS', label: 'Landholdings' },
        { key: 'area', header: 'AREA', label: 'Area (HAS)' },
        { key: 'arbs', header: 'ARBs', label: 'Beneficiaries' },
        { key: 'year', header: 'Year', label: 'Target Year' },
        { key: 'milestone', header: 'Milestone', label: 'Milestone Key' }
      ];
      const mapping = buildHeaderMapping(headerValues, nepColumns);
      const parsedNep = {};
      const parsedMilestoneNep = {};
      let rowCount = 0;
      for (const row of dataRows) {
        const rec = {};
        let hasData = false;
        for (const [colIdx, colDef] of mapping.entries()) {
          const rawVal = row.values[colIdx];
          if (String(rawVal ?? '').trim() !== '') hasData = true;
          rec[colDef.key] = rawVal;
        }
        if (!hasData) continue;
        const rawCode = String(rec.code || '').trim().toUpperCase();
        const rawProv = String(rec.provinceName || '').trim().toLowerCase();
        if (rawCode === 'TOTAL' || rawProv.includes('total')) continue;
        let code = PROVINCE_CODES.includes(rawCode) ? rawCode : null;
        if (!code && rawProv) {
          const matchedNode = REGIONAL_REGISTRY.find(
            (n) =>
              n.role === 'Provincial Node' &&
              (n.provinceName.toLowerCase() === rawProv ||
                n.jurisdiction.toLowerCase().includes(rawProv))
          );
          if (matchedNode) code = matchedNode.code;
        }
        if (!code) continue;
        rowCount++;
        const parsedYear = parseInt(String(rec.year ?? '').replace(/,/g, ''), 10);
        const msKey = String(rec.milestone || '').trim().toLowerCase();
        const entry = {
          lhs: Math.max(0, Math.round(Number(String(rec.lhs ?? 0).replace(/,/g, '')) || 0)),
          area: Number((Number(String(rec.area ?? 0).replace(/,/g, '')) || 0).toFixed(4)),
          arbs: Math.max(0, Math.round(Number(String(rec.arbs ?? 0).replace(/,/g, '')) || 0)),
          year: Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2099 ? parsedYear : new Date().getFullYear()
        };
        if (!msKey || msKey === 'overall') {
          parsedNep[code] = entry;
        } else {
          if (!parsedMilestoneNep[msKey]) parsedMilestoneNep[msKey] = {};
          parsedMilestoneNep[msKey][code] = entry;
        }
      }
      result.nepProvinceList = parsedNep;
      if (Object.keys(parsedMilestoneNep).length > 0) {
        result.nepMilestoneList = parsedMilestoneNep;
      }
      result.tabRowCounts[name] = rowCount;
      continue;
    }

    const matchedOptoolTab = Object.keys(OPTOOL_SHEET_SCHEMAS).find(
      (t) => normalizeHeader(t) === normalizeHeader(name)
    );

    if (matchedOptoolTab) {
      const schemaCols = OPTOOL_SHEET_SCHEMAS[matchedOptoolTab];
      const mapping = buildHeaderMapping(headerValues, schemaCols);
      let rowCount = 0;
      for (const row of dataRows) {
        const record = {};
        for (const col of schemaCols) record[col.key] = '';
        let nonEmptyCount = 0;
        for (const [colIdx, colDef] of mapping.entries()) {
          let val = String(row.values[colIdx] ?? '').trim();
          if (colDef.type === 'decimal' && val !== '') {
            const num = Number(val);
            if (Number.isFinite(num)) val = num.toFixed(4);
          } else if (colDef.type === 'checkbox') {
            val = normalizeChecklistValue(val);
          }
          if (val !== '') nonEmptyCount++;
          record[colDef.key] = val;
        }
        if (nonEmptyCount === 0) continue;
        rowCount++;
        result.optool[matchedOptoolTab].push(record);
      }
      result.tabRowCounts[matchedOptoolTab] = rowCount;
    } else {
      const nonEmptyRows = dataRows.filter((r) =>
        r.values.some((v) => String(v ?? '').trim() !== '')
      );
      result.tabRowCounts[name] = nonEmptyRows.length;
    }
  }

  return result;
}

export function parseCsvText(csvText, targetTab = 'Milestone_Data') {
  const lines = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(current);
      current = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(current);
      lines.push(row);
      row = [];
      current = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(current);
      lines.push(row);
      row = [];
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    lines.push(row);
  }

  if (lines.length < 2) return [];
  const headerValues = [null, ...lines[0]];
  const schemaCols =
    targetTab === 'Milestone_Data'
      ? MILESTONE_DATA_COLUMNS
      : OPTOOL_SHEET_SCHEMAS[targetTab] || [];

  const mapping = buildHeaderMapping(headerValues, schemaCols);
  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const vals = lines[r];
    if (!vals.some((v) => String(v || '').trim() !== '')) continue;
    const obj = {};
    for (const col of schemaCols) obj[col.key] = '';
    for (const [colIdx, colDef] of mapping.entries()) {
      const raw = String(vals[colIdx - 1] ?? '').trim();
      if (colDef.type === 'decimal' && raw) {
        obj[colDef.key] = formatArea4(raw);
      } else if (colDef.type === 'checkbox') {
        obj[colDef.key] = normalizeChecklistValue(raw);
      } else {
        obj[colDef.key] = raw;
      }
    }
    if (targetTab === 'Milestone_Data' && !obj.Province_Code) {
      obj.Province_Code =
        inferProvinceCodeFromMunicipality(obj.Municipality) ||
        inferProvinceCodeFromText(obj.Record_ID) ||
        'LEY';
    }
    rows.push(obj);
  }
  return rows;
}

export async function fetchGoogleSheetXlsx(spreadsheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=xlsx`;
  const resp = await fetch(url, { redirect: 'follow' });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(
      `HTTP ${resp.status} Unauthorized — This Google Sheet requires authenticated DAR Google account access or a deployed GAS Web App endpoint.`
    );
  }
  if (!resp.ok) {
    throw new Error(`Google Sheets returned HTTP ${resp.status} ${resp.statusText}`);
  }
  const arrayBuf = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error(
      'Received non-XLSX response (Google sign-in redirect). Ensure link sharing is set to "Anyone with the link can view" or use GAS Web App Sync.'
    );
  }
  return await parseWorkbookBuffer(buffer);
}

export async function buildConsolidatedWorkbookBuffer(state, analytics) {
  const sheetsSpec = [];

  // 1. Regional Summary Sheet
  const summaryRows = [
    [
      'Province Code',
      'Jurisdiction / Office',
      'Baseline Target (eTitles)',
      'Baseline Target (HAS)',
      'Incremental (eTitles)',
      'Incremental (HAS)',
      'Cumulative (eTitles)',
      'Cumulative (HAS)',
      'eTitle Completion (%)',
      'Area Completion (%)',
      'Google Sheet ID'
    ],
    ...analytics.provincialBreakdown.map((p) => [
      p.code,
      p.jurisdiction,
      p.baselineTargetETitles,
      Number(p.baselineTargetAreaHas.toFixed(4)),
      p.incrementalETitles,
      Number(p.incrementalAreaHas.toFixed(4)),
      p.cumulativeETitles,
      Number(p.cumulativeAreaHas.toFixed(4)),
      p.completionPctETitles,
      p.completionPctArea,
      p.spreadsheetId
    ])
  ];
  sheetsSpec.push({
    name: 'Regional_Summary',
    headerStyle: 1,
    colWidths: [14, 26, 20, 20, 18, 18, 18, 18, 18, 18, 48],
    fourDecCols: new Set([4, 6, 8]),
    rows: summaryRows
  });

  // 2. NEP Province Sheet (LHS, AREA, ARBs, Year)
  const nepSheet = normalizeNepProvinceList(state.nepProvinceList);
  const provNodes = REGIONAL_REGISTRY.filter((n) => n.role === 'Provincial Node');
  const defaultNepYear = new Date().getFullYear();
  const nepRows = [
    ['Province_Code', 'Province', 'LHS', 'AREA', 'ARBs', 'Year'],
    ...provNodes.map((n) => {
      const entry = nepSheet[n.code] || { lhs: 0, area: 0, arbs: 0, year: defaultNepYear };
      return [
        n.code,
        n.provinceName,
        entry.lhs,
        Number(entry.area.toFixed(4)),
        entry.arbs,
        entry.year || defaultNepYear
      ];
    }),
    [
      'TOTAL',
      'Region VIII Total',
      provNodes.reduce((s, n) => s + (nepSheet[n.code]?.lhs || 0), 0),
      Number(provNodes.reduce((s, n) => s + (nepSheet[n.code]?.area || 0), 0).toFixed(4)),
      provNodes.reduce((s, n) => s + (nepSheet[n.code]?.arbs || 0), 0),
      '-'
    ]
  ];
  sheetsSpec.push({
    name: 'NEP',
    headerStyle: 1,
    colWidths: [16, 22, 16, 18, 16, 14],
    fourDecCols: new Set([4]),
    rows: nepRows
  });

  // 3. Milestone_Data Sheet
  const msRows = [
    MILESTONE_DATA_COLUMNS.map((c) => c.header),
    ...state.milestoneData.map((rec) =>
      MILESTONE_DATA_COLUMNS.map((c) => {
        if (c.key === 'Area_HAS') return Number(rec.Area_HAS) || 0;
        return rec[c.key] ?? '';
      })
    )
  ];
  sheetsSpec.push({
    name: 'Milestone_Data',
    headerStyle: 1,
    colWidths: MILESTONE_DATA_COLUMNS.map(() => 22),
    fourDecCols: new Set([6]),
    rows: msRows
  });

  // 3. All 6 Exact OPTool Tabs
  for (const [tabName, schemaCols] of Object.entries(OPTOOL_SHEET_SCHEMAS)) {
    const fourDecCols = new Set();
    schemaCols.forEach((c, idx) => {
      if (c.type === 'decimal') fourDecCols.add(idx + 1);
    });
    const rows = [
      schemaCols.map((c) => c.header),
      ...(state.optool[tabName] || []).map((r) =>
        schemaCols.map((c) => {
          if (c.type === 'decimal' && r[c.key] !== '' && r[c.key] !== undefined) {
            const num = Number(r[c.key]);
            return Number.isFinite(num) ? num : r[c.key];
          }
          return r[c.key] ?? '';
        })
      )
    ];
    sheetsSpec.push({
      name: tabName,
      headerStyle: 2,
      colWidths: schemaCols.map(() => 20),
      fourDecCols,
      rows
    });
  }

  return writeXlsxWorkbook(sheetsSpec);
}

/** Execute a GET query against a deployed GAS Web App action endpoint. */
async function fetchGasAction(gasUrl, action) {
  const sep = gasUrl.includes('?') ? '&' : '?';
  const resp = await fetch(`${gasUrl}${sep}action=${encodeURIComponent(action)}`, {
    redirect: 'follow'
  });
  if (!resp.ok) {
    throw new Error(`GAS Web App returned HTTP ${resp.status}`);
  }
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    const preview = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(`GAS Web App returned non-JSON response: ${preview || 'HTML error page'}`);
  }
}

export async function pullFromGasWebApp(gasUrl) {
  return fetchGasAction(gasUrl, 'snapshot');
}

/** Pull User_Accounts list from the deployed Regional Hub GAS Web App. */
export async function pullUsersFromGasWebApp(gasUrl) {
  return fetchGasAction(gasUrl, 'users');
}

/** Pull the Regional Hub NEP Sheet per-province totals (?action=nep). */
export async function pullNepFromGasWebApp(gasUrl) {
  return fetchGasAction(gasUrl, 'nep');
}

export async function pushToGasWebApp(gasUrl, payload) {
  const resp = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  if (!resp.ok) {
    throw new Error(`GAS Web App POST returned HTTP ${resp.status}`);
  }
  return await resp.json();
}
