import zlib from 'node:zlib';

// ============================================================================
// Pure Node.js Built-in ZIP + OpenXML (.xlsx) Reader & Writer
// Zero external dependencies — compatible with Excel & Google Sheets exports
// ============================================================================

function xmlEscape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(str) {
  return String(str ?? '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function colLettersToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx; // 1-based
}

function indexToColLetters(index) {
  let n = index; // 1-based
  let res = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    res = String.fromCharCode(65 + rem) + res;
    n = Math.floor((n - 1) / 26);
  }
  return res;
}

function excelSerialToIsoDate(serial) {
  const num = Number(serial);
  if (!Number.isFinite(num) || num < 1) return String(serial);
  // Excel epoch: 1899-12-30 (accounts for Excel's 1900 leap year bug)
  const utcMs = Date.UTC(1899, 11, 30) + Math.round(num * 86400000);
  return new Date(utcMs).toISOString().slice(0, 10);
}

export function readZipEntries(buffer) {
  // Find End of Central Directory record (0x06054b50)
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP/XLSX archive (EOCD signature not found)');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Corrupt ZIP Central Directory entry');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLen);

    cursor += 46 + nameLen + extraLen + commentLen;

    if (fileName.endsWith('/')) continue;

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid local header for ${fileName}`);
    }
    const lhNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const lhExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const compressedSlice = buffer.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) {
      data = compressedSlice;
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressedSlice);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${fileName}`);
    }

    entries.set(fileName.replace(/^\//, ''), data);
  }

  return entries;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [];
    for (const t of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
      parts.push(xmlUnescape(t[1]));
    }
    strings.push(parts.join(''));
  }
  return strings;
}

function parseDateStyleIndices(stylesXml) {
  const dateStyleSet = new Set();
  if (!stylesXml) return dateStyleSet;

  const customDateNumFmts = new Set([14, 15, 16, 17, 22]);
  for (const m of stylesXml.matchAll(/<numFmt[^>]+numFmtId="(\d+)"[^>]+formatCode="([^"]+)"/g)) {
    const id = Number(m[1]);
    const code = m[2].toLowerCase();
    if (/[ymd]/.test(code) && !/0\.0000/.test(code)) {
      customDateNumFmts.add(id);
    }
  }

  const cellXfsMatch = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (cellXfsMatch) {
    let idx = 0;
    for (const xf of cellXfsMatch[1].matchAll(/<xf\b([^>]*)\/?>/g)) {
      const numFmtMatch = xf[1].match(/numFmtId="(\d+)"/);
      if (numFmtMatch && customDateNumFmts.has(Number(numFmtMatch[1]))) {
        dateStyleSet.add(idx);
      }
      idx++;
    }
  }
  return dateStyleSet;
}

export function readXlsxWorkbook(buffer) {
  const entries = readZipEntries(buffer);
  const getText = (p) => (entries.has(p) ? entries.get(p).toString('utf8') : '');

  const sharedStrings = parseSharedStrings(getText('xl/sharedStrings.xml'));
  const dateStyles = parseDateStyleIndices(getText('xl/styles.xml'));
  const workbookXml = getText('xl/workbook.xml');
  const relsXml = getText('xl/_rels/workbook.xml.rels');

  const relMap = {};
  for (const m of relsXml.matchAll(/<Relationship\b([^>]+)\/?>/g)) {
    const idM = m[1].match(/Id="([^"]+)"/);
    const tgtM = m[1].match(/Target="([^"]+)"/);
    if (idM && tgtM) relMap[idM[1]] = tgtM[1];
  }

  const sheets = [];
  for (const m of workbookXml.matchAll(/<sheet\b([^>]+)\/?>/g)) {
    const nameM = m[1].match(/name="([^"]+)"/);
    const ridM = m[1].match(/r:id="([^"]+)"/);
    if (!nameM || !ridM) continue;
    const sheetName = xmlUnescape(nameM[1]);
    let target = relMap[ridM[1]] || '';
    target = target.replace(/^\//, '');
    if (!target.startsWith('xl/')) target = `xl/${target}`;

    const sheetXml = getText(target);
    const rows = [];
    if (sheetXml) {
      for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
        const rowNum = Number(rowMatch[1]);
        const rowValues = [];
        for (const cMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
          const attrs = cMatch[1];
          const body = cMatch[2];
          const refM = attrs.match(/r="([A-Z]+)\d+"/);
          if (!refM) continue;
          const colIdx = colLettersToIndex(refM[1]);
          const tM = attrs.match(/t="([^"]+)"/);
          const sM = attrs.match(/s="(\d+)"/);
          const cellType = tM ? tM[1] : 'n';
          const styleIdx = sM ? Number(sM[1]) : 0;

          let val = '';
          if (cellType === 'inlineStr') {
            const parts = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) =>
              xmlUnescape(t[1])
            );
            val = parts.join('');
          } else {
            const vM = body.match(/<v>([\s\S]*?)<\/v>/);
            if (vM) {
              const raw = xmlUnescape(vM[1]);
              if (cellType === 's') {
                val = sharedStrings[Number(raw)] ?? '';
              } else if (cellType === 'b') {
                val = raw === '1' ? 'TRUE' : 'FALSE';
              } else if (cellType === 'n' && dateStyles.has(styleIdx)) {
                val = excelSerialToIsoDate(raw);
              } else {
                val = raw;
              }
            }
          }
          rowValues[colIdx] = val;
        }
        rows.push({ rowNumber: rowNum, values: rowValues });
      }
    }
    sheets.push({ name: sheetName, rows });
  }

  return sheets;
}

function buildZipBuffer(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const { name, content } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const rawBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = zlib.deflateRawSync(rawBuf);
    const crc = zlib.crc32(rawBuf);

    // Local File Header (30 bytes + name)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 flag
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(rawBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localChunks.push(lh, nameBuf, compressed);

    // Central Directory Header (46 bytes + name)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc >>> 0, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(rawBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);

    centralChunks.push(cd, nameBuf);
    offset += lh.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

export function writeXlsxWorkbook(sheetsSpec) {
  // sheetsSpec: [{ name, headerStyle (1=emerald, 2=navy), colWidths: [], numberFormats: { colIdx1Based: '4dec' }, rows: [[...]] }]
  const files = [];

  const sheetEntries = sheetsSpec.map((s, idx) => ({
    name: s.name,
    sheetId: idx + 1,
    rId: `rId${idx + 1}`,
    file: `worksheets/sheet${idx + 1}.xml`,
    spec: s
  }));

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetEntries
    .map(
      (s) =>
        `<Override PartName="/xl/${s.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('\n  ')}
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheetEntries
      .map(
        (s) =>
          `<sheet name="${xmlEscape(s.name)}" sheetId="${s.sheetId}" r:id="${s.rId}"/>`
      )
      .join('\n    ')}
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetEntries
    .map(
      (s) =>
        `<Relationship Id="${s.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${s.file}"/>`
    )
    .join('\n  ')}
  <Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // Styles: 0=default, 1=emerald header, 2=navy header, 3=4-decimal numeric
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="0.0000"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF14532D"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;

  files.push(
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/styles.xml', content: stylesXml }
  );

  for (const s of sheetEntries) {
    const { rows, headerStyle = 1, colWidths = [], fourDecCols = new Set() } = s.spec;
    const colsXml = colWidths.length
      ? `<cols>${colWidths
          .map(
            (w, idx) =>
              `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`
          )
          .join('')}</cols>`
      : '';

    const rowsXml = rows
      .map((rowVals, rIdx) => {
        const rowNum = rIdx + 1;
        const isHeader = rIdx === 0;
        const cells = rowVals
          .map((val, cIdx) => {
            const colRef = `${indexToColLetters(cIdx + 1)}${rowNum}`;
            if (!isHeader && typeof val === 'number' && Number.isFinite(val)) {
              const styleAttr = fourDecCols.has(cIdx + 1) ? ' s="3"' : '';
              return `<c r="${colRef}" t="n"${styleAttr}><v>${val}</v></c>`;
            }
            const styleAttr = isHeader ? ` s="${headerStyle}"` : '';
            return `<c r="${colRef}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${xmlEscape(
              val
            )}</t></is></c>`;
          })
          .join('');
        const htAttr = isHeader ? ' ht="28" customHeight="1"' : '';
        return `<row r="${rowNum}"${htAttr}>${cells}</row>`;
      })
      .join('');

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  ${colsXml}
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;

    files.push({ name: `xl/${s.file}`, content: sheetXml });
  }

  return buildZipBuffer(files);
}

