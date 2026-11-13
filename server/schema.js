import {
  TARGET_PERIOD_OPTIONS,
  getReportedMonthOptions
} from '../public/reportingUtils.js';

export { TARGET_PERIOD_OPTIONS, getReportedMonthOptions };

export const REGIONAL_REGISTRY = [
  {
    code: 'HUB',
    jurisdiction: 'Regional Account (Hub)',
    provinceName: 'Region VIII Consolidated',
    role: 'Central Aggregator',
    spreadsheetId: '1jTVJSQlUcWyZFxm6Pxqj9L62q9NtLyhUy1ifYqqb0Lw',
    url: 'https://docs.google.com/spreadsheets/d/1jTVJSQlUcWyZFxm6Pxqj9L62q9NtLyhUy1ifYqqb0Lw/edit?usp=sharing',
    exportUrl: 'https://docs.google.com/spreadsheets/d/1jTVJSQlUcWyZFxm6Pxqj9L62q9NtLyhUy1ifYqqb0Lw/export?format=xlsx'
  },
  {
    code: 'BIL',
    jurisdiction: 'Biliran Province',
    provinceName: 'Biliran',
    role: 'Provincial Node',
    spreadsheetId: '1MoHaQxhcCqXpMRAEUfLEBkXAgWfWRQxCZpJrjXDE-kk',
    url: 'https://docs.google.com/spreadsheets/d/1MoHaQxhcCqXpMRAEUfLEBkXAgWfWRQxCZpJrjXDE-kk/edit',
    exportUrl: 'https://docs.google.com/spreadsheets/d/1MoHaQxhcCqXpMRAEUfLEBkXAgWfWRQxCZpJrjXDE-kk/export?format=xlsx'
  },
  {
    code: 'ESA',
    jurisdiction: 'Eastern Samar',
    provinceName: 'Eastern Samar',
    role: 'Provincial Node',
    spreadsheetId: '1RvpxOHrZQRKn-0gwnkIo5aLYP74TaO6d_GVIEVmjmcE',
    url: 'https://docs.google.com/spreadsheets/d/1RvpxOHrZQRKn-0gwnkIo5aLYP74TaO6d_GVIEVmjmcE/edit',
    exportUrl: 'https://docs.google.com/spreadsheets/d/1RvpxOHrZQRKn-0gwnkIo5aLYP74TaO6d_GVIEVmjmcE/export?format=xlsx'
  },
  {
    code: 'LEY',
    jurisdiction: 'Leyte',
    provinceName: 'Leyte',
    role: 'Provincial Node',
    spreadsheetId: '1gmHmA8FxFbGCO9hFXxsVn1n8WEwYeywFy8WmsIfUawQ',
    url: 'https://docs.google.com/spreadsheets/d/1gmHmA8FxFbGCO9hFXxsVn1n8WEwYeywFy8WmsIfUawQ/edit',
    exportUrl: 'https://docs.google.com/spreadsheets/d/1gmHmA8FxFbGCO9hFXxsVn1n8WEwYeywFy8WmsIfUawQ/export?format=xlsx'
  },
  {
    code: 'NSA',
    jurisdiction: 'Northern Samar',
    provinceName: 'Northern Samar',
    role: 'Provincial Node',
    spreadsheetId: '1d5xywDNJxYTEZNtwtAQjTo35eucrMlaVI10LOZ3rfd8',
    url: 'https://docs.google.com/spreadsheets/d/1d5xywDNJxYTEZNtwtAQjTo35eucrMlaVI10LOZ3rfd8/edit',
    exportUrl: 'https://docs.google.com/spreadsheets/d/1d5xywDNJxYTEZNtwtAQjTo35eucrMlaVI10LOZ3rfd8/export?format=xlsx'
  },
  {
    code: 'SAM',
    jurisdiction: 'Samar (Western Samar)',
    provinceName: 'Samar (Western Samar)',
    role: 'Provincial Node',
    spreadsheetId: '1cHhfvsVhTBKi_QuU6H2oiHfS1qiQqDFEh5ZJcOBpPYQ',
    url: 'https://docs.google.com/spreadsheets/d/1cHhfvsVhTBKi_QuU6H2oiHfS1qiQqDFEh5ZJcOBpPYQ/edit',
    exportUrl: 'https://docs.google.com/spreadsheets/d/1cHhfvsVhTBKi_QuU6H2oiHfS1qiQqDFEh5ZJcOBpPYQ/export?format=xlsx'
  },
  {
    code: 'SLE',
    jurisdiction: 'Southern Leyte',
    provinceName: 'Southern Leyte',
    role: 'Provincial Node',
    spreadsheetId: '1joqlZK0VkFk-tUJnlwIebIa3vknh5fThcfZC6Yb7I8E',
    url: 'https://docs.google.com/spreadsheets/d/1joqlZK0VkFk-tUJnlwIebIa3vknh5fThcfZC6Yb7I8E/edit',
    exportUrl: 'https://docs.google.com/spreadsheets/d/1joqlZK0VkFk-tUJnlwIebIa3vknh5fThcfZC6Yb7I8E/export?format=xlsx'
  }
];

export const PROVINCE_CODES = ['BIL', 'ESA', 'LEY', 'NSA', 'SAM', 'SLE'];

export const LGU_MASTER_LIST = {
  BIL: [
    'Almeria', 'Biliran', 'Cabucgayan', 'Caibiran', 'Culaba', 'Kawayan', 'Maripipi', 'Naval'
  ],
  ESA: [
    'Arteche', 'Balangiga', 'Balangkayan', 'Borongan City', 'Can-avid', 'Dolores',
    'General MacArthur', 'Giporlos', 'Guiuan', 'Hernani', 'Jipapad', 'Lawaan',
    'Llorente', 'Maslog', 'Maydolong', 'Mercedes', 'Oras', 'Quinapondan',
    'Salcedo', 'San Julian', 'San Policarpo', 'Sulat', 'Taft'
  ],
  LEY: [
    'Abuyog', 'Alangalang', 'Albuera', 'Babatngon', 'Barugo', 'Bato', 'Baybay City',
    'Burauen', 'Calubian', 'Capoocan', 'Carigara', 'Dagami', 'Dulag', 'Hilongos',
    'Hindang', 'Inopacan', 'Isabel', 'Jaro', 'Javier', 'Julita', 'Kananga', 'La Paz',
    'Leyte', 'MacArthur', 'Mahaplag', 'Matag-ob', 'Matalom', 'Mayorga', 'Merida',
    'Ormoc City', 'Palo', 'Palompon', 'Pastrana', 'San Isidro', 'San Miguel',
    'Santa Fe', 'Tabango', 'Tabontabon', 'Tacloban City', 'Tanauan', 'Tolosa',
    'Tunga', 'Villaba'
  ],
  NSA: [
    'Allen', 'Biri', 'Bobon', 'Capul', 'Catarman', 'Catubig', 'Gamay', 'Laoang',
    'Lapinig', 'Las Navas', 'Lavezares', 'Lope de Vega', 'Mapanas', 'Mondragon',
    'Palapag', 'Pambujan', 'Rosario', 'San Antonio', 'San Isidro', 'San Jose',
    'San Roque', 'San Vicente', 'Silvino Lobos', 'Victoria'
  ],
  SAM: [
    'Almagro', 'Basey', 'Calbayog City', 'Calbiga', 'Catbalogan City', 'Daram',
    'Gandara', 'Hinabangan', 'Jiabong', 'Marabut', 'Matuguinao', 'Motiong',
    'Pagsanghan', 'Paranas', 'Pinabacdao', 'San Jorge', 'San Jose de Buan',
    'San Sebastian', 'Santa Margarita', 'Santa Rita', 'Santo Niño', 'Tagapul-an',
    'Talalora', 'Tarangnan', 'Villareal', 'Zumarraga'
  ],
  SLE: [
    'Anahawan', 'Bontoc', 'Hinunangan', 'Hinundayan', 'Libagon', 'Liloan',
    'Limasawa', 'Maasin City', 'Macrohon', 'Malitbog', 'Padre Burgos', 'Pintuyan',
    'Saint Bernard', 'San Francisco', 'San Juan', 'San Ricardo', 'Silago',
    'Sogod', 'Tomas Oppus'
  ]
};

export const MILESTONE_STAGES = [
  'CF / Field Investigation Completed',
  'Survey Returns Submitted (DARPO/DARRO)',
  'ASP Approved (DENR-SMD)',
  'MOV Transmitted to LBP/AOC',
  'eTitle Generated',
  'eTitle Registered',
  'eTitle Distributed to ARB',
  'ARB Installed'
];

export const BATCH_CATEGORIES = [
  'ADMIN BATCH 1',
  'ADMIN BATCH 2',
  'ADMIN BATCH 3',
  'SPLIT PIPELINE 2026',
  'CARRYOVER BASELINE',
  'REDOC & DNYD'
];

export const MILESTONE_TARGET_TABS = [
  'CF(DOC)',
  'Survey',
  'MOV',
  'RegistrationDistribution',
  'Installation'
];

export const DASHBOARD_MILESTONES = [
  { key: 'cf_doc', label: 'CF Documentation', sourceTab: 'CF(DOC)' },
  { key: 'land_survey', label: 'Land Survey', sourceTab: 'Survey' },
  { key: 'land_valuation', label: 'Land Valuation', sourceTab: 'MOV' },
  { key: 'ep_cloa_registration', label: 'EP CLOA Registration', sourceTab: 'RegistrationDistribution' },
  { key: 'ep_cloa_distribution', label: 'EP CLOA Distribution', sourceTab: 'RegistrationDistribution' },
  { key: 'installation', label: 'Installation', sourceTab: 'Installation' }
];

/** Create or normalize the Regional List of per-milestone NEP Targets. */
export function normalizeNepTargets(raw = {}) {
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  const hasFlatKeys = DASHBOARD_MILESTONES.some(
    (m) => src[m.key] && typeof src[m.key] === 'object'
  );

  for (const m of DASHBOARD_MILESTONES) {
    if (hasFlatKeys) {
      const item = src[m.key] && typeof src[m.key] === 'object' ? src[m.key] : {};
      out[m.key] = {
        targetCount: Math.max(0, Number(item.targetCount) || 0),
        targetAreaHas: Math.max(0, Number((Number(item.targetAreaHas) || 0).toFixed(4)))
      };
    } else {
      // Migrate legacy per-province shape by summing provinces into the Regional List
      let sumCount = 0;
      let sumArea = 0;
      for (const code of PROVINCE_CODES) {
        const item = src[code]?.[m.key];
        if (item && typeof item === 'object') {
          sumCount += Math.max(0, Number(item.targetCount) || 0);
          sumArea += Math.max(0, Number(item.targetAreaHas) || 0);
        }
      }
      out[m.key] = {
        targetCount: sumCount,
        targetAreaHas: Number(sumArea.toFixed(4))
      };
    }
  }
  return out;
}

/** Create or normalize per-province Regional Hub NEP Sheet entries (LHS, AREA, ARBs). */
export function normalizeNepProvinceList(raw = {}) {
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const code of PROVINCE_CODES) {
    const item = src[code] && typeof src[code] === 'object' ? src[code] : {};
    out[code] = {
      lhs: Math.max(0, Math.round(Number(item.lhs) || 0)),
      area: Math.max(0, Number((Number(item.area) || 0).toFixed(4))),
      arbs: Math.max(0, Math.round(Number(item.arbs) || 0))
    };
  }
  return out;
}

// Milestone_Data schema from SPLIT Milestone Monitoring System Technical Spec
export const MILESTONE_DATA_COLUMNS = [
  { key: 'Record_ID', header: 'Record_ID', label: 'Record ID', type: 'text', required: true },
  { key: 'Province_Code', header: 'Province_Code', label: 'Province Code', type: 'select', options: PROVINCE_CODES },
  { key: 'Municipality', header: 'Municipality', label: 'Municipality', type: 'text', required: true },
  { key: 'Land_Allocation_ID', header: 'Land_Allocation_ID', label: 'Land Allocation ID', type: 'text', required: true },
  { key: 'eTitle_No', header: 'eTitle_No', label: 'eTitle No.', type: 'text', required: true },
  { key: 'Area_HAS', header: 'Area_HAS', label: 'Area (HAS)', type: 'decimal', required: true },
  { key: 'Milestone_Stage', header: 'Milestone_Stage', label: 'Milestone Stage', type: 'select', options: MILESTONE_STAGES, required: true },
  { key: 'Milestone_Date', header: 'Milestone_Date', label: 'Milestone Date', type: 'date', required: true },
  { key: 'Batch_Category', header: 'Batch_Category', label: 'Batch Category', type: 'select', options: BATCH_CATEGORIES, required: true },
  { key: 'LHID', header: 'LHID', label: 'Linked LHID (Optional)', type: 'text' }
];

// Exact 6 tabs and exact headers from the Regional Account (Hub) Google Sheet
export const OPTOOL_SHEET_SCHEMAS = {
  Database: [
    { key: 'lhid', header: 'LHID', label: 'LHID', group: 'Identification', type: 'text' },
    { key: 'titleNumber', header: 'Title Number', label: 'Title Number', group: 'Identification', type: 'text' },
    { key: 'landOwner', header: 'Land Owner', label: 'Land Owner', group: 'Identification', type: 'text' },
    { key: 'moa', header: 'MOA', label: 'MOA', group: 'Identification', type: 'text' },
    { key: 'phase', header: 'Phase', label: 'Phase', group: 'Identification', type: 'text' },
    { key: 'regionName', header: 'RegionName', label: 'Region Name', group: 'Location', type: 'text' },
    { key: 'province', header: 'Province', label: 'Province', group: 'Location', type: 'text' },
    { key: 'municipality', header: 'Municipality', label: 'Municipality', group: 'Location', type: 'text' },
    { key: 'barangay', header: 'Barangay', label: 'Barangay', group: 'Location', type: 'text' },
    { key: 'surveyStatus', header: 'SurveyStatus', label: 'Survey Status', group: 'Status & Pipeline', type: 'text' },
    { key: 'targetYear', header: 'TargetYear', label: 'Target Year', group: 'Status & Pipeline', type: 'text' },
    { key: 'pipelineYear', header: 'PipelineYear', label: 'Pipeline Year', group: 'Status & Pipeline', type: 'text' },
    { key: 'problematic', header: 'problematic', label: 'Problematic', group: 'Status & Pipeline', type: 'text' },
    { key: 'totalArea', header: 'Total Area', label: 'Total Area (HAS)', group: 'Area Breakdown', type: 'decimal' },
    { key: 'computedArea', header: 'ComputedArea', label: 'Computed Area (HAS)', group: 'Area Breakdown', type: 'decimal' },
    { key: 'distributedArea', header: 'DistributedArea', label: 'Distributed Area (HAS)', group: 'Area Breakdown', type: 'decimal' },
    { key: 'surveyNumber', header: 'SurveyNumber', label: 'Survey Number', group: 'Parcel Details', type: 'text' },
    { key: 'lotNumber', header: 'LotNumber', label: 'Lot Number', group: 'Parcel Details', type: 'text' },
    { key: 'carpable', header: 'CARPable', label: 'CARPable Area', group: 'Area Breakdown', type: 'decimal' },
    { key: 'nonCarpable', header: 'NONCARPable', label: 'NON-CARPable Area', group: 'Area Breakdown', type: 'decimal' },
    { key: 'optoolStatus', header: 'Optool Status', label: 'Optool Status', group: 'Status & Pipeline', type: 'text' },
    { key: 'currentStatusDesc', header: 'CurrentStatusDesc', label: 'Current Status Description', group: 'Status & Pipeline', type: 'text' },
    { key: 'newLandSize', header: 'NewLandSize', label: 'New Land Size', group: 'Parcel Details', type: 'text' },
    { key: 'ladStatus', header: 'Lad Status', label: 'LAD Status', group: 'Status & Pipeline', type: 'text' },
    { key: 'milestoneTarget', header: 'Milestone Target', label: 'Milestone Target', group: 'Status & Pipeline', type: 'select', options: MILESTONE_TARGET_TABS },
    { key: 'year', header: 'Year', label: 'Year', group: 'Status & Pipeline', type: 'text' }
  ],
  'CF(DOC)': [
    { key: 'lhid', header: 'LHID', label: 'LHID', group: 'Identification', type: 'text' },
    { key: 'certificateOfTitle', header: 'Certificate of TItle', label: 'Certificate of Title', group: 'Legal & Land Docs', type: 'checkbox' },
    { key: 'denrCertification', header: 'DENR Certification', label: 'DENR Certification', group: 'Legal & Land Docs', type: 'checkbox' },
    { key: 'taxDeclaration', header: 'Tax Declaration', label: 'Tax Declaration', group: 'Legal & Land Docs', type: 'checkbox' },
    { key: 'carperLadForm1And2', header: 'Carper Lad Form 1&2', label: 'CARPER LAD Form 1 & 2', group: 'CARPER Forms', type: 'checkbox' },
    { key: 'carperLadForm3', header: 'Carper Lad Form 3', label: 'CARPER LAD Form 3', group: 'CARPER Forms', type: 'checkbox' },
    { key: 'asp', header: 'ASP', label: 'ASP', group: 'Technical Plans', type: 'checkbox' },
    { key: 'carperLadForm18', header: 'Carper Lad form 18', label: 'CARPER LAD Form 18', group: 'CARPER Forms', type: 'checkbox' },
    { key: 'carperLadForm20', header: 'Carper LAD form 20', label: 'CARPER LAD Form 20', group: 'CARPER Forms', type: 'checkbox' },
    { key: 'marpoCert', header: 'MARPO Cert.', label: 'MARPO Certification', group: 'Legal & Land Docs', type: 'checkbox' },
    { key: 'firCarperLadForm46', header: 'FIR Carper LAD Form 46', label: 'FIR CARPER LAD Form 46', group: 'CARPER Forms', type: 'checkbox' },
    { key: 'landUsePerFi', header: 'Land use per FI', label: 'Land Use per FI', group: 'Field Investigation', type: 'checkbox' },
    { key: 'copyOfAdvSp', header: 'Copy of the AdvSP', label: 'Copy of AdvSP', group: 'Technical Plans', type: 'checkbox' },
    { key: 'carperLadNo49', header: 'Carper LAD No. 49', label: 'CARPER LAD No. 49', group: 'CARPER Forms', type: 'checkbox' },
    { key: 'carperLadNo37', header: 'Carper LAD No. 37/oathe of ARB', label: 'CARPER LAD No. 37 / Oath of ARB', group: 'CARPER Forms', type: 'checkbox' },
    { key: 'carperLadForm47', header: 'Carper LAD form 47', label: 'CARPER LAD Form 47', group: 'CARPER Forms', type: 'checkbox' },
    { key: 'approvedSubdivisionPlan', header: 'Approved Subdivision/Segregation Plan', label: 'Approved Subdivision/Segregation Plan', group: 'Technical Plans', type: 'checkbox' },
    { key: 'dateFiConducted', header: 'DATE FI CONDUCTED', label: 'Date FI Conducted', group: 'Dates & Reporting', type: 'date' },
    { key: 'datePreparedSigned', header: 'DATE PREPARED & SIGNED', label: 'Date Prepared & Signed', group: 'Dates & Reporting', type: 'date' },
    { key: 'target', header: 'TARGET\n (Current/ Previous)', label: 'Target (Current / Previous)', group: 'Dates & Reporting', type: 'select', options: TARGET_PERIOD_OPTIONS },
    { key: 'reportedMonth', header: 'Reported Month', label: 'Reported Month', group: 'Dates & Reporting', type: 'select', options: getReportedMonthOptions() },
    { key: 'remarks', header: 'REMARKS', label: 'Remarks', group: 'Dates & Reporting', type: 'text' },
    { key: 'pdfFile', header: 'PDF File', label: 'PDF File Link', group: 'Dates & Reporting', type: 'text' }
  ],
  Survey: [
    { key: 'lhid', header: 'LHID', label: 'LHID', group: 'Identification', type: 'text' },
    {
      key: 'kindOfSurvey',
      header: 'Kind of Survey',
      label: 'Kind of Survey',
      group: 'DARPO Compliance',
      type: 'select',
      options: ['By Admin', 'By Contract']
    },
    { key: 'dateRss', header: 'Date RSS', label: 'Date RSS', group: 'DARPO Compliance', type: 'date' },
    { key: 'fieldWorkStartDate', header: 'Field Work Start Date', label: 'Field Work Start Date', group: 'DARPO Compliance', type: 'date' },
    { key: 'fieldWorkCompletionDate', header: 'Field Work Completion Date', label: 'Field Work Completion Date', group: 'DARPO Compliance', type: 'date' },
    { key: 'finalizedSrDate', header: 'Finalized Survey Return \nDate', label: 'Finalized Survey Return Date', group: 'DARPO Compliance', type: 'date' },
    { key: 'srForwardedToDarro', header: 'SR Forwarded to DARRO', label: 'SR Forwarded to DARRO', group: 'DARPO Compliance', type: 'date' },
    { key: 'srAcceptedByDarro', header: 'SR Accepted by DARRO', label: 'SR Accepted by DARRO', group: 'DARRO Compliance', type: 'date' },
    { key: 'plan', header: 'Plan\n(With/Out)', label: 'Plan (With/Out)', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'fieldNotes', header: 'Field Notes W/Cover\n(With/Out)', label: 'Field Notes w/ Cover', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'traverseComputation', header: 'Traverse Computation\n(With/Out)', label: 'Traverse Computation', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'lotDataComputation', header: 'Lot Data Computation\n(With/Out)', label: 'Lot Data Computation', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'dlsdFile', header: 'DLSD File', label: 'DLSD File', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'transmittalSrPdf', header: 'Transmittal of Survey Returned PDF File\n(With/Out)', label: 'Transmittal PDF (With/Out)', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'refBoundaryComp', header: 'Reference Boundary Computation\n(With/Out)', label: 'Reference Boundary Comp.', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'noticeOfCoverage', header: 'Notice of Coverage\n(With/Out)', label: 'Notice of Coverage', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'taxDeclaration', header: 'Tax Declaration\n(With/Out)', label: 'Tax Declaration', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'certifiedCopyTitle', header: 'Certified Copy of Title\n(With/Out)', label: 'Certified Copy of Title', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'marpoCert', header: 'MARPO Certification', label: 'MARPO Certification', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'surveyAuthority', header: 'Survey Authority\nIF APPLICABLE', label: 'Survey Authority (If Applicable)', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'cenroCert', header: 'CENRO Certification\nIF APPLICABLE', label: 'CENRO Cert. (If Applicable)', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'orderOfCancellation', header: 'Order of Cancellation\nIF APPLICABLE \n', label: 'Order of Cancellation', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'orderOfCorrection', header: 'Order of Correction\nIF APPLICABLE', label: 'Order of Correction', group: 'DARRO Compliance', type: 'checkbox' },
    { key: 'remarksDarroToDarpo', header: 'Remarks\n(SR Returned by DARRO to DARPO', label: 'Remarks (DARRO -> DARPO)', group: 'DARRO Compliance', type: 'text', fullWidth: true },
    { key: 'srReturnedDarroToDarpoDate', header: 'Survey Returns Returned DARRO to DARPO\nDATE', label: 'SR Returned DARRO -> DARPO Date', group: 'DARRO Compliance', type: 'date' },
    { key: 'srResubmittedDarroDate', header: 'Sruvey Returns Re-Submitted to DARRO\nDATE', label: 'SR Re-submitted to DARRO Date', group: 'DARPO Compliance', type: 'date' },
    { key: 'srTransmittedDenrSmdDate', header: 'Surver Returns Trasmitted to DENR-SMD DATE', label: 'SR Transmitted to DENR-SMD Date', group: 'DARRO Compliance', type: 'date' },
    { key: 'transactionNumber', header: 'Transaction Number', label: 'DENR Transaction Number', group: 'DARRO Compliance', type: 'text' },
    { key: 'dateAcceptedDenrSmd', header: 'Date Accepted by DENR-SMD\nDATE', label: 'Date Accepted by DENR-SMD', group: 'DARRO Compliance', type: 'date' },
    { key: 'withSubmittedDlsd', header: 'With Submitted DLSD', label: 'With Submitted DLSD', group: 'DARRO Compliance', type: 'text' },
    { key: 'srReturnedDenrToDarroDate', header: 'SR Returned by DENR-SMD to DARRO\nDATE', label: 'SR Returned DENR-SMD -> DARRO Date', group: 'DARRO Compliance', type: 'date' },
    { key: 'srReturnedDenrDarroToDarpoDate', header: 'SR Returned DENR-SMD -> DARRO - DARPO', label: 'SR Returned DENR-SMD -> DARRO - DARPO', group: 'DARRO Compliance', type: 'date' },
    { key: 'remarksReturnedDenr', header: 'Remarks\n(Returned SRs from DENR)', label: 'Remarks (Returned from DENR)', group: 'DARRO Compliance', type: 'text', fullWidth: true },
    { key: 'srReturnedDarpoToDarroDate', header: 'SR Returned by DARPO to DARRO\nDATE', label: 'SR Returned DARPO -> DARRO Date', group: 'DARPO Compliance', type: 'date' },
    { key: 'darroResubmittedDenrDate', header: 'DARRO Re-submitted survey to DENR-SMD\nDATE', label: 'DARRO Re-submitted to DENR-SMD', group: 'DARRO Compliance', type: 'date' },
    { key: 'aspDate', header: 'ASP Date', label: 'ASP Approval Date', group: 'DARRO Compliance', type: 'date' },
    { key: 'aspNo', header: 'ASP No.', label: 'ASP Number', group: 'DARRO Compliance', type: 'text' },
    { key: 'receivedBy', header: 'Received By', label: 'Received By', group: 'Reporting', type: 'text' },
    { key: 'target', header: 'TARGET\n (Current/ Previous)', label: 'Target (Current / Previous)', group: 'Reporting', type: 'select', options: TARGET_PERIOD_OPTIONS },
    { key: 'reportedMonth', header: 'Reported Month', label: 'Reported Month', group: 'Reporting', type: 'select', options: getReportedMonthOptions() },
    { key: 'pdfFile', header: 'PDF File', label: 'PDF File Link', group: 'Reporting', type: 'text' },
    { key: 'currentStatus', header: 'Current Status', label: 'Current Status', group: 'Reporting', type: 'text' },
    { key: 'currentDate', header: 'Current Date', label: 'Current Date', group: 'Reporting', type: 'date' }
  ],
  MOV: [
    { key: 'lhid', header: 'LHID', label: 'LHID', group: 'Valuation & PPU', type: 'text' },
    { key: 'ppuDate', header: 'PPU Date', label: 'PPU Date', group: 'Valuation & PPU', type: 'date' },
    {
      key: 'ppuReviewResult',
      header: 'PPU Review Result\n(PASSED/FAILED)',
      label: 'PPU Review Result',
      group: 'Valuation & PPU',
      type: 'select',
      options: ['PASSED', 'FAILED']
    },
    { key: 'dateReceivedDarpo', header: 'Date Received at DARPO', label: 'Date Received at DARPO', group: 'Valuation & PPU', type: 'date' },
    { key: 'compensationAmount', header: 'Compensation Amount', label: 'Compensation Amount (PHP)', group: 'Compensation & LBP', type: 'decimal' },
    { key: 'dateOfMov', header: 'Date of MOV', label: 'Date of MOV', group: 'Compensation & LBP', type: 'date' },
    { key: 'dateTransLbpAoc', header: 'Date Trans to LBP/AOC', label: 'Date Transmitted to LBP/AOC', group: 'Compensation & LBP', type: 'date' },
    { key: 'lbpClaimNumber', header: 'LBP Claim Number', label: 'LBP Claim Number', group: 'Compensation & LBP', type: 'text' },
    { key: 'aocNumber', header: 'AOC Number', label: 'AOC Number', group: 'Compensation & LBP', type: 'text' },
    { key: 'target', header: 'TARGET\n (Current/ Previous)', label: 'Target (Current / Previous)', group: 'Reporting', type: 'select', options: TARGET_PERIOD_OPTIONS },
    { key: 'reportedMonth', header: 'Reported Month', label: 'Reported Month', group: 'Reporting', type: 'select', options: getReportedMonthOptions() },
    { key: 'pdfFile', header: 'PDF File', label: 'PDF File Link', group: 'Reporting', type: 'text' }
  ],
  RegistrationDistribution: [
    { key: 'lhid', header: 'LHID/ Sequence No.', label: 'LHID / Sequence No.', group: 'Identification', type: 'text' },
    { key: 'originSource', header: 'Origin/\nSource:\n(New Land, REDOC & DNYD)', label: 'Origin / Source', group: 'Identification', type: 'text' },
    { key: 'cloaType', header: 'CLOA TYPE (EP/CLOA OR COLLECTIVE)', label: 'CLOA Type', group: 'Identification', type: 'text' },
    { key: 'region', header: 'REGION', label: 'Region', group: 'Location', type: 'text' },
    { key: 'province', header: 'PROVINCE', label: 'Province', group: 'Location', type: 'text' },
    { key: 'municipality', header: 'MUNICIPALITY', label: 'Municipality', group: 'Location', type: 'text' },
    { key: 'barangay', header: 'BARANGAY', label: 'Barangay', group: 'Location', type: 'text' },
    { key: 'arbName', header: 'NAME OF ARB (LN, FN, MI)', label: 'Name of ARB (LN, FN, MI)', group: 'ARB & Title Details', type: 'text' },
    { key: 'epOrCloaSerialNo', header: 'EP or CLOA \nSERIAL No.', label: 'EP or CLOA Serial No.', group: 'ARB & Title Details', type: 'text' },
    { key: 'areaHas', header: 'AREA\n(HAs)', label: 'Area (HAS)', group: 'ARB & Title Details', type: 'decimal' },
    { key: 'moa', header: 'MOA', label: 'MOA', group: 'ARB & Title Details', type: 'text' },
    { key: 'rodTitleNo', header: 'ROD TITLE NO.', label: 'ROD Title No.', group: 'Registration & Distribution', type: 'text' },
    { key: 'dateRegistered', header: 'DATE REGISTERED', label: 'Date Registered', group: 'Registration & Distribution', type: 'date' },
    { key: 'dateOfDistribution', header: 'DATE OF DISTRIBUTION (mm/dd/yyyy)', label: 'Date of Distribution', group: 'Registration & Distribution', type: 'text' },
    { key: 'noOfArbs', header: 'Total Number of ARB', label: 'Total Number of ARB', group: 'Reporting', type: 'integer' },
    { key: 'maleArbs', header: 'Male', label: 'Male', group: 'Reporting', type: 'integer' },
    { key: 'femaleArbs', header: 'Female', label: 'Female', group: 'Reporting', type: 'integer' },
    { key: 'noOfTitles', header: 'NO. OF TITLES', label: 'No. of Titles', group: 'Reporting', type: 'integer' },
    { key: 'target', header: 'TARGET YEAR\n (Current/ Previous)', label: 'Target Year', group: 'Reporting', type: 'select', options: TARGET_PERIOD_OPTIONS },
    { key: 'monthReported', header: 'MONTH REPORTED', label: 'Month Reported', group: 'Reporting', type: 'select', options: getReportedMonthOptions() },
    { key: 'remarks', header: 'REMARKS', label: 'Remarks', group: 'Reporting', type: 'text' }
  ],
  Installation: [
    { key: 'lhid', header: 'LHID \n (From OPTool, \n if New Land)', label: 'LHID (From OPTool)', group: 'Location & Cross-Ref', type: 'text' },
    { key: 'region', header: 'REGION', label: 'Region', group: 'Location & Cross-Ref', type: 'text' },
    { key: 'province', header: 'PROVINCE', label: 'Province', group: 'Location & Cross-Ref', type: 'text' },
    { key: 'municipality', header: 'MUNICIPALITY', label: 'Municipality', group: 'Location & Cross-Ref', type: 'text' },
    { key: 'barangay', header: 'BARANGAY', label: 'Barangay', group: 'Location & Cross-Ref', type: 'text' },
    { key: 'loLastName', header: 'LAST NAME', label: 'Landowner Last Name', group: 'Landholding / Original Title', type: 'text' },
    { key: 'loFirstName', header: 'FIRST NAME', label: 'Landowner First Name', group: 'Landholding / Original Title', type: 'text' },
    { key: 'loMiddleName', header: 'MIDDLE NAME', label: 'Landowner Middle Name', group: 'Landholding / Original Title', type: 'text' },
    { key: 'titleOrTaxDecNo', header: 'TITLE NO. OR TAX DEC. NO.', label: 'Title No. or Tax Dec. No.', group: 'Landholding / Original Title', type: 'text' },
    { key: 'lotNo', header: 'LOT No.', label: 'Lot No.', group: 'Landholding / Original Title', type: 'text' },
    { key: 'areaHas1', header: 'AREA (Has.)', label: 'Landholding Area (HAS)', group: 'Landholding / Original Title', type: 'decimal' },
    { key: 'arbLastName', header: 'LAST NAME', label: 'ARB Last Name', group: 'Installed ARB & eTitle', type: 'text' },
    { key: 'arbFirstName', header: 'FIRST NAME', label: 'ARB First Name', group: 'Installed ARB & eTitle', type: 'text' },
    { key: 'arbMiddleName', header: 'MIDDLE NAME', label: 'ARB Middle Name', group: 'Installed ARB & eTitle', type: 'text' },
    { key: 'gender', header: 'GENDER (M/F)', label: 'Gender (M/F)', group: 'Installed ARB & eTitle', type: 'text' },
    { key: 'rodTitleNo', header: 'ROD TITLE No.', label: 'ROD Title No.', group: 'Installed ARB & eTitle', type: 'text' },
    { key: 'epOrCloaSerialNo', header: 'EP OR CLOA \n SERIAL No.', label: 'EP or CLOA Serial No.', group: 'Installed ARB & eTitle', type: 'text' },
    { key: 'surveyNo', header: 'SURVEY No.', label: 'Survey No.', group: 'Installed ARB & eTitle', type: 'text' },
    { key: 'lotNo2', header: 'LOT No.2', label: 'Lot No. 2', group: 'Installed ARB & eTitle', type: 'text' },
    { key: 'areaHas2', header: 'AREA\n (HAs) 2', label: 'Installed Area (HAS)', group: 'Installed ARB & eTitle', type: 'decimal' },
    { key: 'dateRegistered', header: 'DATE REGISTERED', label: 'Date Registered', group: 'Dates & Accomplishment', type: 'date' },
    { key: 'dateDistributed', header: 'DATE DISTRIBUTED', label: 'Date Distributed', group: 'Dates & Accomplishment', type: 'date' },
    { key: 'dateOfInstallation', header: 'DATE OF INSTALLATION (mm/dd/yyyy)', label: 'Date of Installation', group: 'Dates & Accomplishment', type: 'text' },
    { key: 'installedStatus', header: 'REMARKS (Installed - Yes/No)', label: 'Installed (Yes/No)', group: 'Dates & Accomplishment', type: 'text' },
    { key: 'noOfArbs', header: 'No. OF ARBs', label: 'No. of ARBs', group: 'Dates & Accomplishment', type: 'integer' },
    { key: 'noOfTitles', header: 'No. OF TITLES', label: 'No. of Titles', group: 'Dates & Accomplishment', type: 'integer' },
    { key: 'remarks', header: 'REMARKS', label: 'Remarks', group: 'Dates & Accomplishment', type: 'text' },
    { key: 'yearAccomp', header: 'YEAR ACCOMP', label: 'Year Accomplished', group: 'Dates & Accomplishment', type: 'text' },
    { key: 'target', header: 'TARGET YEAR\n (Current/ Previous)', label: 'Target Year', group: 'Dates & Accomplishment', type: 'select', options: TARGET_PERIOD_OPTIONS },
    { key: 'monthReported', header: 'MONTH REPORTED', label: 'Month Reported', group: 'Dates & Accomplishment', type: 'select', options: getReportedMonthOptions() }
  ]
};

export const OPTOOL_PREVIEW_COLUMNS = {
  Database: [
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
  ],
  'CF(DOC)': [
    'lhid',
    'certificateOfTitle',
    'denrCertification',
    'taxDeclaration',
    'asp',
    'marpoCert',
    'approvedSubdivisionPlan',
    'dateFiConducted',
    'datePreparedSigned',
    'target',
    'reportedMonth',
    'remarks'
  ],
  Survey: [
    'lhid',
    'kindOfSurvey',
    'dateRss',
    'fieldWorkStartDate',
    'fieldWorkCompletionDate',
    'finalizedSrDate',
    'srForwardedToDarro',
    'srAcceptedByDarro',
    'srTransmittedDenrSmdDate',
    'transactionNumber',
    'dateAcceptedDenrSmd',
    'aspDate',
    'aspNo',
    'reportedMonth'
  ],
  MOV: [
    'lhid',
    'ppuDate',
    'ppuReviewResult',
    'dateReceivedDarpo',
    'compensationAmount',
    'dateOfMov',
    'dateTransLbpAoc',
    'lbpClaimNumber',
    'aocNumber',
    'reportedMonth'
  ],
  RegistrationDistribution: [
    'lhid',
    'originSource',
    'cloaType',
    'province',
    'municipality',
    'barangay',
    'arbName',
    'epOrCloaSerialNo',
    'areaHas',
    'rodTitleNo',
    'dateRegistered',
    'dateOfDistribution',
    'noOfArbs',
    'maleArbs',
    'femaleArbs',
    'noOfTitles',
    'target',
    'monthReported',
    'remarks'
  ],
  Installation: [
    'lhid',
    'province',
    'municipality',
    'barangay',
    'loLastName',
    'arbLastName',
    'arbFirstName',
    'epOrCloaSerialNo',
    'rodTitleNo',
    'areaHas2',
    'dateOfInstallation',
    'installedStatus',
    'noOfArbs',
    'noOfTitles',
    'yearAccomp',
    'target',
    'monthReported'
  ]
};

export function inferProvinceCodeFromText(text) {
  if (!text) return '';
  const clean = String(text).trim().toLowerCase();
  if (clean.startsWith('bil')) return 'BIL';
  if (clean.includes('eastern samar') || clean.startsWith('esa')) return 'ESA';
  if (clean.includes('northern samar') || clean.startsWith('nsa')) return 'NSA';
  if (clean.includes('southern leyte') || clean.startsWith('sle')) return 'SLE';
  if (clean.includes('samar') || clean.startsWith('sam')) return 'SAM';
  if (clean.includes('leyte') || clean.startsWith('ley')) return 'LEY';
  return '';
}

export function inferProvinceCodeFromMunicipality(municipality) {
  if (!municipality) return '';
  const target = String(municipality).trim().toLowerCase();
  for (const [code, lgus] of Object.entries(LGU_MASTER_LIST)) {
    if (lgus.some((l) => l.toLowerCase() === target)) {
      return code;
    }
  }
  return '';
}

export function formatArea4(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(4) : '0.0000';
}

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

/**
 * Determine whether a checklist field value represents a checked state.
 */
export function isChecklistChecked(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return !UNCHECKED_CHECKLIST_VALUES.has(String(value).trim().toLowerCase());
}

/**
 * Normalize checklist field values to canonical 'Yes' (checked) or '' (unchecked).
 */
export function normalizeChecklistValue(value) {
  return isChecklistChecked(value) ? 'Yes' : '';
}

