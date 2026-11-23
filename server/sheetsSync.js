import {
  OPTOOL_SHEET_SCHEMAS,
  MILESTONE_DATA_COLUMNS,
  LEASEHOLD_COLUMNS,
  normalizeLeaseholdRow,
  PROVINCE_CODES,
  REGIONAL_REGISTRY,
  normalizeNepProvinceList,
  inferProvinceCodeFromMunicipality,
  inferProvinceCodeFromText,
  formatArea4,
  normalizeChecklistValue
} from './schema.js';
import {
  formatLhidDisplay,
  formatReportedMonthWord,
  formatYearDisplay
} from '../public/reportingUtils.js';
import { readXlsxWorkbook, writeXlsxWorkbook } from './xlsxCodec.js';

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Flexible matcher for OPTool worksheet names supporting spacing, punctuation,
 * and common naming variations across provincial spreadsheets.
 */
export function matchOptoolTabName(rawName) {
  if (!rawName) return null;
  const str = String(rawName).trim();
  const clean = str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  for (const tab of Object.keys(OPTOOL_SHEET_SCHEMAS)) {
    if (tab.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === clean) {
      return tab;
    }
  }

  if (clean === 'cf' || clean === 'cfdoc') return 'CF(DOC)';
  if (clean === 'survey' || clean === 'asp') return 'Survey';
  if (clean === 'mov') return 'MOV';
  if (
    clean === 'registration' ||
    clean === 'distribution' ||
    clean === 'regdist' ||
    clean === 'regdistribution' ||
    clean === 'registrationdistribution'
  ) {
    return 'RegistrationDistribution';
  }
  if (clean === 'installation' || clean === 'inst') return 'Installation';
  if (clean === 'database' || clean.includes('database') || clean === 'db') return 'Database';
  if (clean === 'leasehold' || clean === 'leaseholl' || clean === 'lease' || clean.includes('leasehold')) {
    return 'Leasehold';
  }

  return null;
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
      const cleanNorm = norm.replace(/[^a-z0-9]/g, '');
      matchedIdx = schemaCols.findIndex(
        (col, idx) => {
          if (usedSchemaIndices.has(idx)) return false;
          const cleanHeader = normalizeHeader(col.header).replace(/[^a-z0-9]/g, '');
          const cleanLabel = normalizeHeader(col.label).replace(/[^a-z0-9]/g, '');
          const cleanKey = normalizeHeader(col.key).replace(/[^a-z0-9]/g, '');

          if (cleanNorm === cleanHeader || cleanNorm === cleanLabel || cleanNorm === cleanKey) return true;

          return (
            (col.key === 'dateForwardedToRod' && (cleanNorm.includes('forwardedtorod') || cleanNorm.includes('forwardedrod') || cleanNorm.includes('dateforwarded'))) ||
            (col.key === 'dateReceivedAtRod' && (cleanNorm.includes('receivedatrod') || cleanNorm.includes('receivedrod') || cleanNorm.includes('datereceivedatrod') || cleanNorm.includes('datereceivedrod'))) ||
            (col.key === 'epebNumber' && (cleanNorm.includes('epebno') || cleanNorm.includes('epebnum') || cleanNorm.includes('epeb#') || cleanNorm.includes('epebnumber'))) ||
            (col.key === 'epebDate' && cleanNorm.includes('epebdate')) ||
            (col.key === 'epebStatus' && cleanNorm.includes('epebstatus')) ||
            (col.key === 'ladStatus' && (norm === 'lad' || norm === 'ladcolumn' || norm === 'ladstatus')) ||
            (col.key === 'workability' && norm === 'workability') ||
            (col.key === 'carperLadForm42' && (norm.includes('form42') || norm.includes('form47'))) ||
            (col.key === 'pdfFile' && (norm.includes('form46') || norm.includes('pdffile') || norm === 'pdf')) ||
            (col.key === 'certificateOfTitle' && (norm.includes('certificateoftitle') || cleanNorm.includes('certtitle'))) ||
            (col.key === 'taxDeclaration' && (norm.includes('taxdeclaration') || cleanNorm.includes('taxdec'))) ||
            (col.key === 'carperLadForm1And2' && (norm.includes('form12') || norm.includes('form1and2') || norm.includes('form1&2'))) ||
            (col.key === 'carperLadForm3' && norm.includes('form3')) ||
            (col.key === 'landUsePerFi' && norm.includes('landuse')) ||
            (col.key === 'subLotNumber' && (norm.includes('sublot') || norm.includes('sub lot') || norm.includes('sub-lot'))) ||
            (col.key === 'lotNumber' && (norm === 'lot' || norm === 'lot number' || norm === 'lotnumber' || norm === 'lot no.' || norm === 'lot no' || norm === 'lotno' || cleanNorm === 'lotno')) ||
            (col.key === 'provs' && (norm === 'province' || norm === 'prov' || norm === 'provs' || cleanNorm === 'province')) ||
            (col.key === 'mun' && (norm === 'municipality' || norm === 'muni' || norm === 'mun' || cleanNorm === 'municipality')) ||
            (col.key === 'brgy' && (norm === 'barangay' || norm === 'brgy' || cleanNorm === 'barangay')) ||
            (col.key === 'dateContractRegistered' && (cleanNorm.includes('contractregistered') || cleanNorm.includes('contractreg'))) ||
            (col.key === 'datePlrRegistered' && (cleanNorm.includes('plrregistered') || cleanNorm.includes('plrreg'))) ||
            (col.key === 'areaPerTitle' && (cleanNorm.includes('areapertitle') || cleanNorm === 'areatitle' || (cleanNorm.includes('area') && cleanNorm.includes('title')))) ||
            (col.key === 'areaTenanted' && (cleanNorm.includes('tenanted') || cleanNorm.includes('areatenanted') || cleanNorm === 'tenantedarea' || (cleanNorm.includes('area') && cleanNorm.includes('tenant')))) ||
            (col.key === 'withinRetainedArea' && cleanNorm.includes('retainedarea')) ||
            (col.key === 'tenantStatus' && (cleanNorm.includes('tenantstatus') || cleanNorm.includes('lesseestatus'))) ||
            (col.key === 'newLesseeName' && (cleanNorm.includes('newlessee') || cleanNorm.includes('newlesseename'))) ||
            (col.key === 'relationshipToTenant' && cleanNorm.includes('relationshipto')) ||
            (col.key === 'gender' && (norm === 'gender' || norm === 'gendermf' || norm === 'sex' || cleanNorm === 'gender')) ||
            (col.key === 'noOfArbs' && (cleanNorm.includes('numberofarbs') || cleanNorm.includes('noofarbs') || cleanNorm === 'arbs' || cleanNorm === 'arbtotal')) ||
            (col.key === 'surveyRequirement' && (cleanNorm.includes('needing') || cleanNorm.includes('surveyrequirement') || cleanNorm.includes('surveystatus') || norm === 'lhs' || norm === 'lh')) ||
            (col.key === 'leaseRentalUnit' && (cleanNorm.includes('rentalunit') || cleanNorm.includes('leaserental'))) ||
            (col.key === 'leaseInPesos' && (cleanNorm.includes('leaseinpesos') || cleanNorm.includes('rentalpesos') || cleanNorm === 'pesos')) ||
            (col.key === 'ppuDate' && (norm === 'ppu' || norm.includes('ppudate') || cleanNorm.includes('withppudate'))) ||
            (col.key === 'dateReceivedDarpo' && (cleanNorm.includes('datereceivedatdarpo') || cleanNorm.includes('receiveddarpo') || cleanNorm.includes('receivedatdarpo') || cleanNorm.includes('withreceiveddarpo'))) ||
            (col.key === 'dateOfMov' && (cleanNorm.includes('dateofmov') || cleanNorm === 'movdate' || cleanNorm.includes('withdateofmov'))) ||
            (col.key === 'dateTransLbpAoc' && (cleanNorm.includes('translbpaoc') || cleanNorm.includes('transmittedtolbp') || cleanNorm.includes('transmittedlbpaoc') || cleanNorm.includes('withtranslbpaoc') || cleanNorm.includes('withtrans'))) ||
            (col.key === 'targetYear' && (cleanNorm.includes('targetyear') || cleanNorm.includes('yeartarget') || cleanNorm === 'targetyr' || (cleanNorm.includes('target') && cleanNorm.includes('year')))) ||
            (col.key === 'reportMonth' && (norm === 'reportmonth' || cleanNorm.includes('reportmonth') || cleanNorm.includes('monthreported'))) ||
            (col.key === 'reportedMonth' && (cleanNorm.includes('reportedmonth') || cleanNorm.includes('monthreported') || cleanNorm.includes('withreportedmonth')))
          );
        }
      );
    }

    // Positional fallback for standard Leasehold schema (34 columns: Col M = idx 13 (0-based 12), Col AF = idx 32 (0-based 31))
    if (matchedIdx < 0 && schemaCols.length === 34) {
      if (colIdx === 12 && !usedSchemaIndices.has(11) && schemaCols[11]?.key === 'areaPerTitle') {
        matchedIdx = 11;
      } else if (colIdx === 13 && !usedSchemaIndices.has(12) && schemaCols[12]?.key === 'areaTenanted') {
        matchedIdx = 12;
      } else if (colIdx === 31 && !usedSchemaIndices.has(30) && schemaCols[30]?.key === 'leaseInPesos') {
        matchedIdx = 30;
      } else if (colIdx === 32 && !usedSchemaIndices.has(31) && schemaCols[31]?.key === 'targetYear') {
        matchedIdx = 31;
      }
    }

    if (matchedIdx >= 0) {
      usedSchemaIndices.add(matchedIdx);
      colIndexToField.set(colIdx, schemaCols[matchedIdx]);
    }
  }

  return colIndexToField;
}

export async function parseWorkbookBuffer(buffer, options = {}) {
  const worksheets = readXlsxWorkbook(buffer);

  const result = {
    sheetNames: worksheets.map((ws) => ws.name),
    tabRowCounts: {},
    milestoneData: [],
    optool: {},
    leasehold: [],
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
          LHID: formatLhidDisplay(record.LHID || '')
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
        const yr = Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2099 ? parsedYear : new Date().getFullYear();
        const entry = {
          lhs: Math.max(0, Math.round(Number(String(rec.lhs ?? 0).replace(/,/g, '')) || 0)),
          area: Number((Number(String(rec.area ?? 0).replace(/,/g, '')) || 0).toFixed(4)),
          arbs: Math.max(0, Math.round(Number(String(rec.arbs ?? 0).replace(/,/g, '')) || 0)),
          year: yr
        };

        if (!result.nepMilestoneListByYear) result.nepMilestoneListByYear = {};
        if (!result.nepProvinceListByYear) result.nepProvinceListByYear = {};
        if (!result.nepMilestoneListByYear[yr]) result.nepMilestoneListByYear[yr] = {};
        if (!result.nepProvinceListByYear[yr]) result.nepProvinceListByYear[yr] = {};

        if (!msKey || msKey === 'overall') {
          parsedNep[code] = entry;
          result.nepProvinceListByYear[yr][code] = entry;
        } else {
          if (!parsedMilestoneNep[msKey]) parsedMilestoneNep[msKey] = {};
          parsedMilestoneNep[msKey][code] = entry;
          if (!result.nepMilestoneListByYear[yr][msKey]) result.nepMilestoneListByYear[yr][msKey] = {};
          result.nepMilestoneListByYear[yr][msKey][code] = entry;
        }
      }
      result.nepProvinceList = parsedNep;
      if (Object.keys(parsedMilestoneNep).length > 0) {
        result.nepMilestoneList = parsedMilestoneNep;
      }
      result.tabRowCounts[name] = rowCount;
      continue;
    }

    const matchedOptoolTab = matchOptoolTabName(name);

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
          if (colDef.key === 'lhid' || colDef.key === 'LHID') {
            val = formatLhidDisplay(val);
          } else if (colDef.type === 'decimal' && val !== '') {
            const num = Number(val);
            if (Number.isFinite(num)) val = num.toFixed(4);
          } else if (colDef.type === 'checkbox') {
            val = normalizeChecklistValue(val);
          } else if (colDef.type === 'pdfFile') {
            if (val === 'Yes' || val === 'true' || val === 'TRUE' || val === true) {
              val = 'Yes';
            } else if (val === 'false' || val === 'FALSE' || val === false) {
              val = '';
            }
          } else if (['targetYear', 'year', 'pipelineYear', 'reportYear'].includes(colDef.key)) {
            val = formatYearDisplay(val);
          } else if (colDef.key === 'reportedMonth' || colDef.key === 'monthReported') {
            val = formatReportedMonthWord(val) || val;
          }
          if (val !== '') nonEmptyCount++;
          record[colDef.key] = val;
        }

        // Positional rescue for Leasehold: Column M (13th column) for Area Tenanted, Column AF (32nd column) for Target Year
        if (matchedOptoolTab === 'Leasehold') {
          if ((record.areaTenanted === undefined || record.areaTenanted === '' || record.areaTenanted === '0.0000') && row.values[13] !== undefined && String(row.values[13]).trim() !== '') {
            record.areaTenanted = String(row.values[13]).trim();
          }
          if ((record.targetYear === undefined || record.targetYear === '') && row.values[32] !== undefined && String(row.values[32]).trim() !== '') {
            record.targetYear = String(row.values[32]).trim();
          }
        }

        // Positional rescue for Land Valuation (MOV):
        // Col B (1-based 2): PPU Date
        // Col D (1-based 4): Date Received at DARPO
        // Col F (1-based 6): Date of MOV
        // Col G (1-based 7): Date Trans to LBP/AOC
        // Col K (1-based 11): Reported Month
        // Col M (1-based 13): Year Target
        if (matchedOptoolTab === 'MOV') {
          if (!record.ppuDate && row.values[2] !== undefined && String(row.values[2]).trim() !== '') {
            record.ppuDate = String(row.values[2]).trim();
          }
          if (!record.dateReceivedDarpo && row.values[4] !== undefined && String(row.values[4]).trim() !== '') {
            record.dateReceivedDarpo = String(row.values[4]).trim();
          }
          if (!record.dateOfMov && row.values[6] !== undefined && String(row.values[6]).trim() !== '') {
            record.dateOfMov = String(row.values[6]).trim();
          }
          if (!record.dateTransLbpAoc && row.values[7] !== undefined && String(row.values[7]).trim() !== '') {
            record.dateTransLbpAoc = String(row.values[7]).trim();
          }
          if (!record.reportedMonth && row.values[11] !== undefined && String(row.values[11]).trim() !== '') {
            record.reportedMonth = formatReportedMonthWord(String(row.values[11]).trim()) || String(row.values[11]).trim();
          }
          if (!record.targetYear && row.values[13] !== undefined && String(row.values[13]).trim() !== '') {
            record.targetYear = formatYearDisplay(String(row.values[13]).trim());
          }
          if (record.targetYear) {
            const ym = String(record.targetYear).trim().replace(/\.0$/, '').match(/\b(20\d{2})\b/);
            if (ym) record.targetYear = ym[1];
          }
        }

        // Universal rescue for any tab: if pdfFile or any PDF-labeled field contains a year (e.g. 2026.0 or 2026), rescue it to targetYear
        if (record.pdfFile) {
          const ym = String(record.pdfFile).trim().replace(/\.0+$/, '').match(/^(20\d{2})$/);
          if (ym) {
            if (!record.targetYear) record.targetYear = ym[1];
            record.pdfFile = '';
          }
        }
        for (const [k, v] of Object.entries(record)) {
          if (v && (k.toLowerCase().includes('pdf') || k.toLowerCase().includes('transmittal'))) {
            const ym = String(v).trim().replace(/\.0+$/, '').match(/^(20\d{2})$/);
            if (ym) {
              if (!record.targetYear) record.targetYear = ym[1];
              record[k] = '';
            }
          }
        }

        // Positional & value rescue for Survey:
        // Col AM (1-based 39, idx 38): TARGET (Current/Previous)
        // Col AN (1-based 40, idx 39): Reported Month
        // Col AO (1-based 41, idx 40): PDF File
        // Col AP (1-based 42, idx 41): Current Status
        // Col AQ (1-based 43, idx 42): Current Date
        // Col AR (1-based 44, idx 43): Target Year
        if (matchedOptoolTab === 'Survey') {
          // If pdfFile contains a year (e.g. 2026.0 or 2026), it was entered in the wrong column
          if (record.pdfFile) {
            const ym = String(record.pdfFile).trim().replace(/\.0$/, '').match(/^(20\d{2})$/);
            if (ym) {
              if (!record.targetYear) record.targetYear = ym[1];
              record.pdfFile = '';
            }
          }
          // Positional check from Column AR (1-based 44 / idx 43) for Target Year
          if (!record.targetYear && row.values[43] !== undefined && String(row.values[43]).trim() !== '') {
            const ym = String(row.values[43]).trim().replace(/\.0$/, '').match(/\b(20\d{2})\b/);
            if (ym) record.targetYear = ym[1];
          }
          // Clean targetYear formatting
          if (record.targetYear) {
            const ym = String(record.targetYear).trim().replace(/\.0$/, '').match(/\b(20\d{2})\b/);
            if (ym) record.targetYear = ym[1];
          }
          // Positional check for Reported Month (Column AN, idx 39)
          if (!record.reportedMonth && row.values[39] !== undefined && String(row.values[39]).trim() !== '') {
            record.reportedMonth = formatReportedMonthWord(String(row.values[39]).trim()) || String(row.values[39]).trim();
          }
        }
        if (nonEmptyCount === 0) continue;
        const rawLhid = String(record.lhid || record.LHID || '').trim();
        const isInvalidHeaderLhid = !rawLhid || /^(date|\(with\/out\)|if applicable|\(sr returned|lhid|with|pending)/i.test(rawLhid);
        if (matchedOptoolTab !== 'Leasehold' && isInvalidHeaderLhid) continue;
        if (
          matchedOptoolTab === 'Leasehold' &&
          !record.leaseholderSurname &&
          !record.loSurname &&
          !record.titleNo &&
          !record.lotNo
        ) {
          continue;
        }
        if (options.province && !record.province && matchedOptoolTab !== 'Leasehold') {
          record.province = options.province;
        }
        if (options.province && !record.provs && matchedOptoolTab === 'Leasehold') {
          record.provs = options.province;
        }
        if (options.provinceCode && !record.provinceCode) {
          record.provinceCode = options.provinceCode;
        }
        rowCount++;
        if (matchedOptoolTab === 'Leasehold') {
          const norm = normalizeLeaseholdRow(record);
          result.optool[matchedOptoolTab].push(norm);
          if (!result.leasehold) result.leasehold = [];
          result.leasehold.push(norm);
        } else {
          result.optool[matchedOptoolTab].push(record);
        }
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
      if (colDef.key === 'lhid' || colDef.key === 'LHID') {
        obj[colDef.key] = formatLhidDisplay(raw);
      } else if (colDef.type === 'decimal' && raw) {
        obj[colDef.key] = formatArea4(raw);
      } else if (colDef.type === 'checkbox') {
        obj[colDef.key] = normalizeChecklistValue(raw);
      } else if (colDef.type === 'pdfFile') {
        if (raw === 'Yes' || raw === 'true' || raw === 'TRUE' || raw === true) {
          obj[colDef.key] = 'Yes';
        } else if (raw === 'false' || raw === 'FALSE' || raw === false) {
          obj[colDef.key] = '';
        } else {
          obj[colDef.key] = raw;
        }
      } else if (['targetYear', 'year', 'pipelineYear', 'reportYear'].includes(colDef.key)) {
        obj[colDef.key] = formatYearDisplay(raw);
      } else if (colDef.key === 'reportedMonth' || colDef.key === 'monthReported') {
        obj[colDef.key] = formatReportedMonthWord(raw) || raw;
      } else {
        obj[colDef.key] = raw;
      }
    }
    if (targetTab !== 'Milestone_Data' && !obj.lhid && !obj.LHID) continue;
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

export async function fetchGoogleSheetXlsx(spreadsheetId, options = {}) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=xlsx`;
  const timeoutMs = options.timeoutMs || 30000;
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  const resp = await fetch(url, { redirect: 'follow', signal });
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
  return await parseWorkbookBuffer(buffer, options);
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

  // 2. NEP Province Sheet (LHS, AREA, ARBs, Year, Milestone)
  const nepSheet = normalizeNepProvinceList(state.nepProvinceList);
  const provNodes = REGIONAL_REGISTRY.filter((n) => n.role === 'Provincial Node');
  const defaultNepYear = new Date().getFullYear();
  const nepRows = [
    ['Province_Code', 'Province', 'LHS', 'AREA', 'ARBs', 'Year', 'Milestone']
  ];
  for (const n of provNodes) {
    const entry = nepSheet[n.code] || { lhs: 0, area: 0, arbs: 0, year: defaultNepYear };
    nepRows.push([
      n.code,
      n.provinceName,
      entry.lhs,
      Number(entry.area.toFixed(4)),
      entry.arbs,
      entry.year || defaultNepYear,
      'overall'
    ]);
  }
  nepRows.push([
    'TOTAL',
    'Region VIII Total',
    provNodes.reduce((s, n) => s + (nepSheet[n.code]?.lhs || 0), 0),
    Number(provNodes.reduce((s, n) => s + (nepSheet[n.code]?.area || 0), 0).toFixed(4)),
    provNodes.reduce((s, n) => s + (nepSheet[n.code]?.arbs || 0), 0),
    '-',
    '-'
  ]);

  if (state.nepMilestoneListByYear) {
    for (const [yr, msMap] of Object.entries(state.nepMilestoneListByYear)) {
      for (const [msKey, pMap] of Object.entries(msMap || {})) {
        for (const n of provNodes) {
          const entry = pMap?.[n.code];
          if (entry) {
            nepRows.push([
              n.code,
              n.provinceName,
              entry.lhs || 0,
              Number((Number(entry.area) || 0).toFixed(4)),
              entry.arbs || 0,
              Number(yr),
              msKey
            ]);
          }
        }
      }
    }
  }
  sheetsSpec.push({
    name: 'NEP',
    headerStyle: 1,
    colWidths: [16, 22, 16, 18, 16, 14, 20],
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

  // 3. All Exact OPTool Tabs (including Leasehold)
  for (const [tabName, schemaCols] of Object.entries(OPTOOL_SHEET_SCHEMAS)) {
    const fourDecCols = new Set();
    schemaCols.forEach((c, idx) => {
      if (c.type === 'decimal') fourDecCols.add(idx + 1);
    });
    const tabSource =
      tabName === 'Leasehold'
        ? (Array.isArray(state.leasehold) && state.leasehold.length > 0 ? state.leasehold : state.optool?.Leasehold) || []
        : state.optool[tabName] || [];
    const rows = [
      schemaCols.map((c) => c.header),
      ...tabSource.map((r) =>
        schemaCols.map((c) => {
          const raw = r[c.key] ?? r[c.header] ?? '';
          if (c.type === 'decimal' && raw !== '' && raw !== undefined) {
            const num = Number(raw);
            return Number.isFinite(num) ? num : raw;
          }
          return raw;
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
async function fetchGasAction(gasUrl, action, timeoutMs = 35000) {
  const sep = gasUrl.includes('?') ? '&' : '?';
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  let resp;
  try {
    resp = await fetch(`${gasUrl}${sep}action=${encodeURIComponent(action)}`, {
      redirect: 'follow',
      signal
    });
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || String(err?.message || '').toLowerCase().includes('abort')) {
      throw new Error(`Google Apps Script action "${action}" timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw err;
  }
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

/** Pull Audit_Logs list from the deployed Regional Hub GAS Web App. */
export async function pullAuditLogsFromGasWebApp(gasUrl) {
  return fetchGasAction(gasUrl, 'auditLogs');
}

/** Append a single audit log entry into the Regional Hub Audit_Logs tab. */
export async function pushAuditLogToGasWebApp(gasUrl, entry, timeoutMs = 25000) {
  return pushToGasWebApp(gasUrl, { action: 'appendAuditLog', entry }, timeoutMs);
}

/** Pull the Regional Hub NEP Sheet per-province totals (?action=nep). */
export async function pullNepFromGasWebApp(gasUrl) {
  return fetchGasAction(gasUrl, 'nep');
}

export async function pushToGasWebApp(gasUrl, payload, timeoutMs = 45000) {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  let resp;
  try {
    resp = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal
    });
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || String(err?.message || '').toLowerCase().includes('abort')) {
      throw new Error(`Google Apps Script update timed out after ${Math.round(timeoutMs / 1000)}s. Changes may still be saving in the Google Sheet in the background.`);
    }
    throw err;
  }
  if (!resp.ok) {
    throw new Error(`GAS Web App POST returned HTTP ${resp.status}`);
  }
  return await resp.json();
}
