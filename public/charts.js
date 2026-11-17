function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderTrendChartSvg(trend, { monitoringLevel, measurementLogic }) {
  if (!trend || trend.length === 0) {
    return '<div class="loading-box">No monthly milestone records match the current filter.</div>';
  }

  const width = 620;
  const height = 250;
  const pad = { top: 24, right: 54, bottom: 38, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const useArea = monitoringLevel === 'area';
  const showInc = measurementLogic === 'both' || measurementLogic === 'incremental';
  const showCum = measurementLogic === 'both' || measurementLogic === 'cumulative';

  const incValues = trend.map((d) => (useArea ? d.incrementalAreaHas : d.incrementalETitles));
  const cumValues = trend.map((d) => (useArea ? d.cumulativeAreaHas : d.cumulativeETitles));

  const maxInc = Math.max(1, ...incValues);
  const maxCum = Math.max(1, ...cumValues);
  const primaryMax = showCum ? maxCum * 1.15 : maxInc * 1.2;

  const stepX = plotW / Math.max(1, trend.length);
  const barW = Math.min(34, stepX * 0.48);

  const yPos = (val, maxVal) => pad.top + plotH - (val / maxVal) * plotH;

  // Gridlines
  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((frac) => {
      const y = pad.top + plotH * (1 - frac);
      const labelVal = primaryMax * frac;
      const fmt = useArea ? labelVal.toFixed(1) : Math.round(labelVal);
      return `
        <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e6ece8" stroke-dasharray="3,3" />
        <text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#64748b">${fmt}</text>
      `;
    })
    .join('');

  // Incremental bars
  const bars = showInc
    ? trend
        .map((d, idx) => {
          const val = useArea ? d.incrementalAreaHas : d.incrementalETitles;
          const x = pad.left + idx * stepX + (stepX - barW) / 2;
          const y = yPos(val, showCum ? primaryMax : maxInc * 1.15);
          const h = Math.max(2, pad.top + plotH - y);
          const label = useArea
            ? `${val.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} HAS`
            : `${val.toLocaleString('en-US')} eTitle(s)`;
          return `
            <g>
              <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="#86efac" stroke="#16a34a" stroke-width="1">
                <title>${esc(d.month)} Incremental: ${esc(label)}</title>
              </rect>
            </g>
          `;
        })
        .join('')
    : '';

  // Cumulative line + points
  let linePath = '';
  let points = '';
  if (showCum) {
    const coords = trend.map((d, idx) => {
      const val = useArea ? d.cumulativeAreaHas : d.cumulativeETitles;
      const x = pad.left + idx * stepX + stepX / 2;
      const y = yPos(val, primaryMax);
      return { x, y, val, d };
    });
    linePath = `
      <polyline fill="none" stroke="#0f4c29" stroke-width="2.5" points="${coords
        .map((c) => `${c.x},${c.y}`)
        .join(' ')}" />
    `;
    points = coords
      .map((c) => {
        const label = useArea
          ? `${c.val.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} HAS`
          : `${c.val.toLocaleString('en-US')} eTitles`;
        return `
          <circle cx="${c.x}" cy="${c.y}" r="4.2" fill="#0f4c29" stroke="#ffffff" stroke-width="1.5">
            <title>${esc(c.d.month)} Cumulative: ${esc(label)}</title>
          </circle>
          <text x="${c.x}" y="${c.y - 9}" text-anchor="middle" font-size="10" font-weight="700" fill="#0f4c29">
            ${useArea ? c.val.toFixed(2) : c.val}
          </text>
        `;
      })
      .join('');
  }

  const xLabels = trend
    .map((d, idx) => {
      const x = pad.left + idx * stepX + stepX / 2;
      return `<text x="${x}" y="${height - 14}" text-anchor="middle" font-size="10.5" fill="#475569">${esc(
        d.month
      )}</text>`;
    })
    .join('');

  return `
    <div class="chart-legend">
      ${
        showInc
          ? `<span class="legend-item"><span class="legend-dot" style="background:#86efac;border:1px solid #16a34a"></span>Incremental (${useArea ? 'Area HAS' : 'eTitles'})</span>`
          : ''
      }
      ${
        showCum
          ? `<span class="legend-item"><span class="legend-dot" style="background:#0f4c29"></span>Cumulative (${useArea ? 'Area HAS' : 'eTitles'})</span>`
          : ''
      }
      ${
        monitoringLevel === 'both'
          ? '<span class="legend-item" style="margin-left:auto;color:#64748b">Showing eTitle count; switch Monitoring Level above to inspect HAS curve</span>'
          : ''
      }
    </div>
    <svg viewBox="0 0 ${width} ${height}" width="100%" style="max-height:260px;display:block">
      ${gridLines}
      <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${width - pad.right}" y2="${pad.top + plotH}" stroke="#cbd5e1" />
      ${bars}
      ${linePath}
      ${points}
      ${xLabels}
    </svg>
  `;
}

export function renderProvincialComparisonSvg(provinces, { monitoringLevel }) {
  if (!provinces || provinces.length === 0) {
    return '<div class="loading-box">No provincial records available.</div>';
  }

  const useArea = monitoringLevel === 'area';
  const width = 620;
  const rowH = 38;
  const pad = { top: 14, right: 24, bottom: 20, left: 132 };
  const height = pad.top + pad.bottom + provinces.length * rowH;
  const barAreaW = width - pad.left - pad.right;

  const maxVal = Math.max(
    1,
    ...provinces.map((p) =>
      useArea
        ? Math.max(p.baselineTargetAreaHas, p.cumulativeAreaHas)
        : Math.max(p.baselineTargetETitles, p.cumulativeETitles)
    )
  );

  const rows = provinces
    .map((p, idx) => {
      const y = pad.top + idx * rowH;
      const target = useArea ? p.baselineTargetAreaHas : p.baselineTargetETitles;
      const cum = useArea ? p.cumulativeAreaHas : p.cumulativeETitles;
      const targetW = Math.max(2, (target / maxVal) * barAreaW);
      const cumW = Math.max(2, (cum / maxVal) * barAreaW);
      const pct = target > 0 ? ((cum / target) * 100).toFixed(1) : '0.0';
      const valText = useArea ? `${cum.toFixed(2)} / ${target.toFixed(0)} HAS` : `${cum} / ${target}`;

      return `
        <g>
          <text x="${pad.left - 10}" y="${y + 18}" text-anchor="end" font-size="11.5" font-weight="600" fill="#1e293b">
            ${esc(p.code)} • ${esc(p.provinceName.replace(' (Western Samar)', ''))}
          </text>
          <rect x="${pad.left}" y="${y + 6}" width="${targetW}" height="10" rx="3" fill="#e2e8f0">
            <title>${esc(p.jurisdiction)} Baseline Target: ${esc(valText)}</title>
          </rect>
          <rect x="${pad.left}" y="${y + 18}" width="${cumW}" height="10" rx="3" fill="#15803d">
            <title>${esc(p.jurisdiction)} Cumulative: ${esc(valText)} (${pct}%)</title>
          </rect>
          <text x="${Math.min(width - 4, pad.left + Math.max(targetW, cumW) + 6)}" y="${y + 24}" font-size="10.5" fill="#475569">
            ${pct}%
          </text>
        </g>
      `;
    })
    .join('');

  return `
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot" style="background:#e2e8f0"></span>Cumulative Baseline Target</span>
      <span class="legend-item"><span class="legend-dot" style="background:#15803d"></span>Cumulative Accomplishment (${useArea ? 'Area HAS' : 'eTitles'})</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" width="100%" style="max-height:270px;display:block">
      ${rows}
    </svg>
  `;
}

export function renderWhereaboutsProvincialGraphSvg(provSummaryList, cfg = {}) {
  if (!provSummaryList || provSummaryList.length === 0) {
    return '<div class="loading-box" style="padding:24px;text-align:center;color:var(--text-muted)">No provincial records available.</div>';
  }

  const width = 620;
  const rowH = 46;
  const pad = { top: 16, right: 110, bottom: 22, left: 130 };
  const height = pad.top + pad.bottom + provSummaryList.length * rowH;
  const barAreaW = width - pad.left - pad.right;

  const maxVal = Math.max(1, ...provSummaryList.map((p) => p.total || 0));

  // Vertical dashed grid lines
  const gridTicks = [0, 0.25, 0.5, 0.75, 1];
  const gridLines = gridTicks.map((frac) => {
    const x = pad.left + frac * barAreaW;
    const tickVal = Math.round(maxVal * frac);
    return `
      <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${height - pad.bottom}" stroke="#e2e8f0" stroke-dasharray="2,2" />
      <text x="${x}" y="${height - 6}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#94a3b8">${tickVal}</text>
    `;
  }).join('');

  const rows = provSummaryList.map((p, idx) => {
    const y = pad.top + idx * rowH;
    const hasData = p.total > 0;
    const totalW = Math.max(hasData ? 6 : 2, (p.total / maxVal) * barAreaW);

    const fi = p.dateCounts?.dateFiConducted || 0;
    const prep = p.dateCounts?.datePreparedSigned || 0;

    const fiW = Math.max(0, (fi / maxVal) * barAreaW);
    const prepW = Math.max(0, (prep / maxVal) * barAreaW);

    return `
      <g class="chart-prov-item">
        <!-- Province label -->
        <text x="${pad.left - 10}" y="${y + 18}" text-anchor="end" font-size="11.5" font-weight="700" fill="#0f172a">
          ${esc(p.code)} • ${esc(p.name.replace(' (Western Samar)', ''))}
        </text>

        <!-- Track Background -->
        <rect x="${pad.left}" y="${y + 4}" width="${barAreaW}" height="18" rx="4" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1" />

        <!-- Total Parcels Bar -->
        <rect x="${pad.left}" y="${y + 4}" width="${totalW}" height="18" rx="4" fill="#0a361d" opacity="${hasData ? '0.92' : '0.15'}">
          <title>${esc(p.name)}: ${p.total} Parcels (${Number(p.area || 0).toFixed(4)} HAS)</title>
        </rect>

        <!-- Milestone Progress Indicators (FI & Prepared) -->
        ${fiW > 0 ? `
          <rect x="${pad.left}" y="${y + 24}" width="${fiW}" height="5" rx="1.5" fill="#16a34a">
            <title>${esc(p.name)} FI Conducted: ${fi} Parcels</title>
          </rect>
        ` : ''}

        ${prepW > 0 ? `
          <rect x="${pad.left}" y="${y + 31}" width="${prepW}" height="5" rx="1.5" fill="#2563eb">
            <title>${esc(p.name)} Prepared & Signed: ${prep} Parcels</title>
          </rect>
        ` : ''}

        <!-- Metric text on right of bar -->
        <text x="${pad.left + Math.max(totalW, Math.max(fiW, prepW)) + 8}" y="${y + 17}" font-size="11.5" font-weight="700" fill="#0f172a">
          ${p.total} <tspan font-size="10" font-weight="500" fill="#64748b">(${Number(p.area || 0).toFixed(2)} HAS)</tspan>
        </text>
      </g>
    `;
  }).join('');

  return `
    <div class="chart-legend" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:8px 12px;background:var(--bg-light,#f8fafc);border-radius:6px;margin-bottom:12px;font-size:11.5px;font-weight:700;">
      <span class="legend-item" style="display:inline-flex;align-items:center;gap:5px;">
        <span class="legend-dot" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#0a361d;"></span>
        Total Parcels
      </span>
      <span class="legend-item" style="display:inline-flex;align-items:center;gap:5px;">
        <span class="legend-dot" style="display:inline-block;width:12px;height:6px;border-radius:2px;background:#16a34a;"></span>
        FI Conducted
      </span>
      <span class="legend-item" style="display:inline-flex;align-items:center;gap:5px;">
        <span class="legend-dot" style="display:inline-block;width:12px;height:6px;border-radius:2px;background:#2563eb;"></span>
        Prepared &amp; Signed
      </span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" width="100%" style="max-height:300px;display:block;">
      ${gridLines}
      ${rows}
    </svg>
  `;
}

export function renderWhereaboutsMonthlyGraphSvg(monthSummaryList, cfg = {}) {
  if (!monthSummaryList || monthSummaryList.length === 0) {
    return '<div class="loading-box" style="padding:24px;text-align:center;color:var(--text-muted)">No monthly records available.</div>';
  }

  const width = 620;
  const height = 260;
  const pad = { top: 32, right: 30, bottom: 42, left: 45 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxVal = Math.max(1, ...monthSummaryList.map((m) => m.total || 0));

  const stepX = plotW / Math.max(1, monthSummaryList.length);
  const barW = Math.min(54, stepX * 0.55);

  const yPos = (val, max) => pad.top + plotH - (val / max) * plotH;

  // Horizontal gridlines
  const gridTicks = [0, 0.25, 0.5, 0.75, 1];
  const gridLines = gridTicks.map((frac) => {
    const y = pad.top + plotH * (1 - frac);
    const tickVal = Math.round(maxVal * frac);
    return `
      <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="2,2" />
      <text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" font-weight="600" fill="#94a3b8">${tickVal}</text>
    `;
  }).join('');

  // Bars
  const bars = monthSummaryList.map((m, idx) => {
    const x = pad.left + idx * stepX + (stepX - barW) / 2;
    const y = yPos(m.total, maxVal * 1.15);
    const h = Math.max(4, pad.top + plotH - y);
    const isUndated = m.label.includes('Undated');

    return `
      <g class="chart-month-col">
        <!-- Main Column Bar -->
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="5" fill="${isUndated ? '#64748b' : '#0a361d'}" opacity="0.92">
          <title>${esc(m.label)}: ${m.total} Parcels (${Number(m.area || 0).toFixed(4)} HAS)</title>
        </rect>

        <!-- Count Label above bar -->
        <text x="${x + barW / 2}" y="${y - 8}" text-anchor="middle" font-size="12" font-weight="800" fill="#0f172a">
          ${m.total}
        </text>

        <!-- Area Sub-label inside bar -->
        ${h > 24 ? `
          <text x="${x + barW / 2}" y="${y + 16}" text-anchor="middle" font-size="9" font-weight="700" fill="#ffffff" opacity="0.95">
            ${Number(m.area || 0).toFixed(1)} HAS
          </text>
        ` : ''}

        <!-- X Axis Label -->
        <text x="${x + barW / 2}" y="${height - 12}" text-anchor="middle" font-size="11" font-weight="700" fill="#334155">
          ${esc(m.label.replace(' 2026', "'26"))}
        </text>
      </g>
    `;
  }).join('');

  return `
    <div class="chart-legend" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:8px 12px;background:var(--bg-light,#f8fafc);border-radius:6px;margin-bottom:12px;font-size:11.5px;font-weight:700;">
      <span class="legend-item" style="display:inline-flex;align-items:center;gap:5px;">
        <span class="legend-dot" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#0a361d;"></span>
        Active Monthly Reporting Cycles
      </span>
      <span class="legend-item" style="display:inline-flex;align-items:center;gap:5px;">
        <span class="legend-dot" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#64748b;"></span>
        Undated / Pending Cycles
      </span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" width="100%" style="max-height:280px;display:block;">
      ${gridLines}
      <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${width - pad.right}" y2="${pad.top + plotH}" stroke="#cbd5e1" stroke-width="1.5" />
      ${bars}
    </svg>
  `;
}

function fmtAreaVal(val) {
  const n = Number(val || 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

export function renderLadBalanceVsRegisteredPieSvg({
  ladArea = 0,
  registeredArea = 0,
  tempArea = 0,
  ladLhs = 0,
  registeredLhs = 0,
  tempLhs = 0
} = {}) {
  const lad = Math.max(0, Number(ladArea) || 0);
  const reg = Math.max(0, Number(registeredArea) || 0);
  const temp = Math.max(0, Number(tempArea) || 0);
  const total = lad + reg + temp;

  const cx = 110;
  const cy = 125;
  const r = 85;
  const r0 = 48;

  const slices = [
    { label: 'LAD Balance', value: lad, color: '#15803d', count: ladLhs, unit: 'LHs' },
    { label: 'Registered Titles', value: reg, color: '#1e40af', count: registeredLhs, unit: 'Titles' },
    { label: 'Temp. Park', value: temp, color: '#b45309', count: tempLhs, unit: 'LHs' }
  ];

  let paths = '';
  if (total <= 0) {
    paths = `
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#e2e8f0" />
      <circle cx="${cx}" cy="${cy}" r="${r0}" fill="#ffffff" />
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#94a3b8">No Data</text>
    `;
  } else {
    let curAngle = -Math.PI / 2;
    paths = slices
      .map((s) => {
        if (s.value <= 0) return '';
        const fraction = s.value / total;
        if (fraction >= 0.9999) {
          return `
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}" />
            <circle cx="${cx}" cy="${cy}" r="${r0}" fill="#ffffff" />
          `;
        }
        const angle = fraction * 2 * Math.PI;
        const endAngle = curAngle + angle;
        const x1 = cx + r * Math.cos(curAngle);
        const y1 = cy + r * Math.sin(curAngle);
        const x2 = cx + r * Math.cos(endAngle);
        const y2 = cy + r * Math.sin(endAngle);
        const x3 = cx + r0 * Math.cos(endAngle);
        const y3 = cy + r0 * Math.sin(endAngle);
        const x4 = cx + r0 * Math.cos(curAngle);
        const y4 = cy + r0 * Math.sin(curAngle);
        const large = angle > Math.PI ? 1 : 0;
        const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${r0} ${r0} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
        curAngle = endAngle;
        const pctText = (fraction * 100).toFixed(1);
        return `
          <path d="${d}" fill="${s.color}" stroke="#ffffff" stroke-width="2">
            <title>${esc(s.label)}: ${fmtAreaVal(s.value)} HAS (${pctText}%)</title>
          </path>
        `;
      })
      .join('');
  }

  const ladPool = lad + reg;
  const pctRegistered = ladPool > 0 ? ((reg / ladPool) * 100).toFixed(1) : '0.0';

  const legendItems = slices.map((s) => {
    const pctOfTotal = total > 0 ? ((s.value / total) * 100).toFixed(1) : '0.0';
    return `
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;font-size:12px;">
        <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${s.color};margin-top:2px;flex-shrink:0;"></span>
        <div style="min-width:0;line-height:1.25;">
          <div style="font-weight:700;color:#1e293b;">${esc(s.label)}</div>
          <div style="color:#64748b;font-size:11px;">
            <strong style="color:${s.color};">${fmtAreaVal(s.value)} HAS</strong> (${pctOfTotal}%)
          </div>
          <div style="color:#94a3b8;font-size:10.5px;">${Number(s.count || 0).toLocaleString()} ${esc(s.unit)}</div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-height:220px;">
      <div style="flex:1;min-width:210px;display:flex;justify-content:center;position:relative;">
        <svg viewBox="0 0 220 250" width="220" height="250" style="display:block;">
          ${paths}
          <text x="${cx}" y="${cy - 3}" text-anchor="middle" font-size="16" font-weight="800" fill="#0f4c29">${pctRegistered}%</text>
          <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#64748b" text-transform="uppercase">Attained</text>
        </svg>
      </div>
      <div style="flex:1.1;min-width:180px;padding:6px 0;">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">Portfolio Distribution</div>
        ${legendItems}
      </div>
    </div>
  `;
}

const MASBATE_PATH = 'M 0 0 L 10 0 L 7 1 L 7 11 L 2 13 L 2 25 L 0 25 L 0 1 Z';
const BOHOL_PATH = 'M 21 344 L 24 346 L 31 344 L 34 349 L 37 349 L 37 346 L 39 346 L 41 349 L 40 352 L 43 352 L 52 359 L 55 357 L 58 358 L 58 350 L 65 350 L 66 347 L 70 346 L 70 348 L 67 349 L 69 352 L 68 357 L 66 354 L 62 354 L 62 362 L 64 363 L 63 367 L 65 367 L 64 371 L 62 371 L 62 378 L 65 378 L 65 380 L 63 384 L 57 386 L 57 388 L 67 391 L 67 395 L 0 395 L 0 357 L 7 353 L 9 346 L 13 347 L 16 345 L 21 345 Z';
const DINAGAT_PATH = 'M 203 303 L 205 303 L 209 313 L 208 321 L 205 324 L 205 335 L 207 335 L 209 341 L 205 341 L 205 343 L 212 345 L 209 346 L 211 348 L 207 349 L 208 351 L 212 348 L 211 351 L 208 351 L 211 355 L 211 362 L 209 365 L 209 372 L 207 372 L 208 377 L 213 379 L 212 385 L 210 385 L 207 390 L 199 390 L 201 395 L 198 395 L 198 393 L 189 395 L 189 392 L 192 392 L 191 394 L 193 392 L 197 392 L 197 378 L 200 378 L 201 380 L 202 378 L 205 378 L 205 376 L 202 375 L 198 369 L 195 369 L 195 362 L 198 360 L 197 356 L 190 356 L 190 358 L 187 358 L 186 353 L 181 351 L 181 345 L 186 344 L 186 339 L 185 341 L 180 341 L 180 335 L 184 335 L 185 338 L 186 335 L 188 335 L 188 323 L 193 323 L 192 315 L 194 315 L 195 318 L 199 317 L 199 311 L 201 305 L 203 304 Z';

export const EV_MAP_PROVINCES = [
  {
    code: 'NSA',
    name: 'Northern Samar',
    d: 'M 122 20 L 133 22 L 134 24 L 140 22 L 147 29 L 151 30 L 153 36 L 157 37 L 157 42 L 160 44 L 159 50 L 157 50 L 157 59 L 163 59 L 166 61 L 166 79 L 49 79 L 40 72 L 40 68 L 38 67 L 38 64 L 36 64 L 37 60 L 35 59 L 34 54 L 35 47 L 32 47 L 32 41 L 30 40 L 30 37 L 27 36 L 27 29 L 25 28 L 25 23 L 27 22 L 31 25 L 31 27 L 37 27 L 37 25 L 41 24 L 44 27 L 46 27 L 46 25 L 50 28 L 54 27 L 56 30 L 65 29 L 70 31 L 82 31 L 88 30 L 92 27 L 100 29 L 106 24 L 111 25 L 113 22 L 114 25 L 121 25 L 122 21 Z',
    labelX: 96,
    labelY: 50,
    gradId: 'grad-nsa',
    stroke: '#f472b6'
  },
  {
    code: 'SAM',
    name: 'Samar',
    d: 'M 70 79 L 100 79 L 101 82 L 103 82 L 104 79 L 135 79 L 135 100 L 146 101 L 152 115 L 155 118 L 156 142 L 151 144 L 148 148 L 148 161 L 150 165 L 150 174 L 158 177 L 159 179 L 153 190 L 154 216 L 151 217 L 151 220 L 148 220 L 146 211 L 146 150 L 120 150 L 118 142 L 121 141 L 124 135 L 127 134 L 126 130 L 121 127 L 110 132 L 106 131 L 103 124 L 101 124 L 98 119 L 95 119 L 93 114 L 96 114 L 96 111 L 91 110 L 88 112 L 88 107 L 85 107 L 84 102 L 82 101 L 83 97 L 79 97 L 74 92 L 70 91 L 70 80 Z',
    labelX: 122,
    labelY: 118,
    gradId: 'grad-sam',
    stroke: '#4ade80'
  },
  {
    code: 'ESA',
    name: 'Eastern Samar',
    d: 'M 166 61 L 177 62 L 178 65 L 183 67 L 183 70 L 188 73 L 188 75 L 185 74 L 183 76 L 179 76 L 180 80 L 177 81 L 178 85 L 183 85 L 183 89 L 187 91 L 176 104 L 175 112 L 177 122 L 181 123 L 182 128 L 176 128 L 174 132 L 180 131 L 181 133 L 185 133 L 185 135 L 183 135 L 183 141 L 179 143 L 179 145 L 182 146 L 182 148 L 183 146 L 187 146 L 187 150 L 189 146 L 192 146 L 193 151 L 194 146 L 200 146 L 200 151 L 202 152 L 181 152 L 181 161 L 185 164 L 185 166 L 187 166 L 186 173 L 189 172 L 191 178 L 198 181 L 199 184 L 202 184 L 203 186 L 201 190 L 199 190 L 199 193 L 194 194 L 191 198 L 189 207 L 198 209 L 201 207 L 200 203 L 198 202 L 207 206 L 212 218 L 214 218 L 216 223 L 219 225 L 219 229 L 222 229 L 225 233 L 223 234 L 221 230 L 218 231 L 213 227 L 213 224 L 210 223 L 211 218 L 207 216 L 207 213 L 199 217 L 195 217 L 195 213 L 189 212 L 187 218 L 188 221 L 186 221 L 182 216 L 179 216 L 176 221 L 173 221 L 173 218 L 170 218 L 169 220 L 168 216 L 162 217 L 159 213 L 155 214 L 154 216 L 153 190 L 159 179 L 158 177 L 150 174 L 148 148 L 151 144 L 156 142 L 155 118 L 152 115 L 146 101 L 135 100 L 135 79 L 166 79 L 166 62 Z',
    labelX: 180,
    labelY: 142,
    gradId: 'grad-esa',
    stroke: '#fb7185'
  },
  {
    code: 'BIL',
    name: 'Biliran',
    d: 'M 42 139 L 51 139 L 55 142 L 59 142 L 62 150 L 63 146 L 66 146 L 67 148 L 70 146 L 70 154 L 67 154 L 66 150 L 64 154 L 65 158 L 70 160 L 68 167 L 66 169 L 54 169 L 52 171 L 47 167 L 45 161 L 42 161 L 41 154 L 35 154 L 35 146 L 37 146 L 35 142 L 42 140 Z',
    labelX: 49,
    labelY: 156,
    gradId: 'grad-bil',
    stroke: '#f43f5e'
  },
  {
    code: 'LEY',
    name: 'Leyte',
    d: 'M 30 158 L 35 162 L 35 179 L 48 179 L 50 182 L 52 182 L 52 179 L 59 179 L 61 188 L 65 192 L 69 191 L 72 194 L 80 193 L 84 189 L 89 188 L 92 183 L 95 183 L 96 175 L 103 177 L 105 174 L 106 178 L 110 178 L 111 176 L 117 178 L 117 183 L 115 183 L 115 196 L 121 199 L 120 203 L 123 204 L 121 212 L 125 223 L 125 238 L 120 253 L 121 265 L 126 271 L 134 272 L 135 278 L 137 279 L 115 280 L 115 295 L 112 295 L 110 306 L 106 312 L 107 330 L 93 330 L 94 321 L 85 312 L 85 300 L 89 299 L 91 295 L 91 283 L 95 279 L 93 263 L 90 260 L 89 254 L 84 252 L 82 249 L 80 240 L 75 239 L 75 237 L 72 236 L 68 230 L 64 230 L 64 232 L 60 235 L 61 243 L 55 251 L 53 251 L 51 247 L 46 247 L 47 242 L 44 241 L 43 243 L 39 243 L 39 240 L 41 240 L 43 235 L 42 228 L 40 228 L 41 226 L 39 225 L 39 222 L 42 219 L 42 212 L 40 210 L 40 202 L 42 202 L 42 200 L 39 198 L 41 193 L 39 192 L 37 194 L 37 192 L 34 191 L 34 184 L 37 184 L 36 182 L 32 182 L 34 178 L 31 178 L 27 167 L 27 161 L 30 159 Z',
    labelX: 92,
    labelY: 228,
    gradId: 'grad-ley',
    stroke: '#eab308'
  },
  {
    code: 'SLE',
    name: 'Southern Leyte',
    d: 'M 115 280 L 139 280 L 140 284 L 144 286 L 144 290 L 141 293 L 141 298 L 143 298 L 144 301 L 144 311 L 149 315 L 162 314 L 163 321 L 164 314 L 166 314 L 166 322 L 161 322 L 160 320 L 159 322 L 154 322 L 155 326 L 158 326 L 158 328 L 155 328 L 158 329 L 158 331 L 155 331 L 155 333 L 158 334 L 152 334 L 151 330 L 150 334 L 148 334 L 148 330 L 144 330 L 144 334 L 141 334 L 140 328 L 136 328 L 139 329 L 136 331 L 136 333 L 139 333 L 137 334 L 138 340 L 136 340 L 132 334 L 127 334 L 127 327 L 129 326 L 127 325 L 127 322 L 116 322 L 118 325 L 117 338 L 118 342 L 120 343 L 121 352 L 123 353 L 123 360 L 118 359 L 113 353 L 109 353 L 109 349 L 106 347 L 92 346 L 89 343 L 91 330 L 107 330 L 106 312 L 110 306 L 112 295 L 115 295 L 115 281 Z',
    labelX: 135,
    labelY: 322,
    gradId: 'grad-sle',
    stroke: '#c084fc'
  }
];

export function renderEasternVisayasMapSvg({ provRows = [], selectedCode = 'ALL' } = {}) {
  const isAll = !selectedCode || selectedCode === 'ALL';

  // Interactive 3D SVG Provinces
  const provinceSvgElements = EV_MAP_PROVINCES.map((p) => {
    const isSelected = selectedCode === p.code;
    const provData = (provRows || []).find((r) => r.code === p.code) || {};
    const ladLhs = provData.ladLhs || 0;
    const ladArea = provData.ladArea ? provData.ladArea.toFixed(2) : '0.00';
    const tempLhs = provData.tempLhs || 0;
    const tooltipText = `${p.name} (${p.code})\nLAD Balance: ${ladLhs.toLocaleString()} LHs (${ladArea} HAS)\nTemp. Park: ${tempLhs.toLocaleString()} LHs\nClick to select / unselect`;

    // Multiline labels where appropriate
    let labelText = esc(p.name.toUpperCase());
    if (p.code === 'ESA') {
      labelText = `<tspan x="${p.labelX}" dy="-4">EASTERN</tspan><tspan x="${p.labelX}" dy="10">SAMAR</tspan>`;
    } else if (p.code === 'SLE') {
      labelText = `<tspan x="${p.labelX}" dy="-4">SOUTHERN</tspan><tspan x="${p.labelX}" dy="9">LEYTE</tspan>`;
    }

    const opacity = isAll || isSelected ? '1' : '0.72';

    return `
      <g
        class="ev-map-group ev-province-3d ${isSelected ? 'is-active' : ''}"
        data-map-province="${p.code}"
        tabindex="0"
        role="button"
        aria-label="${esc(p.name)}"
        style="opacity:${opacity};"
      >
        <path
          class="ev-map-province ${isSelected ? 'is-active' : ''}"
          data-map-province="${p.code}"
          d="${p.d}"
          fill="url(#${p.gradId})"
          stroke="${p.stroke}"
          stroke-width="1.3"
        >
          <title>${esc(tooltipText)}</title>
        </path>
        <text
          x="${p.labelX}"
          y="${p.labelY}"
          class="ev-map-text-3d"
          text-anchor="middle"
          font-size="${p.code === 'BIL' ? '7.5' : p.code === 'LEY' ? '9.5' : '8.5'}"
        >${labelText}</text>
      </g>
    `;
  }).join('');

  return `
    <div class="ev-map-wrap">
      <svg viewBox="0 0 256 395" class="ev-map-svg" aria-label="Eastern Visayas Region VIII 3D HD Map">
        <defs>
          <!-- 3D Island Relief Shadows -->
          <filter id="island-shadow-3d" x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="2" dy="4" stdDeviation="2.5" flood-color="#0f2942" flood-opacity="0.45" />
          </filter>

          <!-- Authentic 3D Pastel Gradients -->
          <linearGradient id="grad-nsa" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fae8ff" />
            <stop offset="100%" stop-color="#eed4ea" />
          </linearGradient>
          <linearGradient id="grad-sam" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#dcfce7" />
            <stop offset="100%" stop-color="#c6f6d5" />
          </linearGradient>
          <linearGradient id="grad-esa" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fee2e2" />
            <stop offset="100%" stop-color="#fed7aa" />
          </linearGradient>
          <linearGradient id="grad-bil" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fed7aa" />
            <stop offset="100%" stop-color="#fecdd3" />
          </linearGradient>
          <linearGradient id="grad-ley" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fffde7" />
            <stop offset="100%" stop-color="#fef9c3" />
          </linearGradient>
          <linearGradient id="grad-sle" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#f3e8ff" />
            <stop offset="100%" stop-color="#eed4ea" />
          </linearGradient>
          <linearGradient id="grad-ext" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fed7aa" />
            <stop offset="100%" stop-color="#fde68a" />
          </linearGradient>
        </defs>

        <!-- Nautical Bathymetry / Shimmer Waves -->
        <path d="M 0 50 Q 80 40 160 55 T 256 45" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />
        <path d="M 0 120 Q 90 135 180 115 T 256 125" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.5" />
        <path d="M 0 260 Q 100 240 200 270 T 256 255" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.5" />

        <!-- Reference Base Overlay Texture (Subtle Geographic Underlay) -->
        <image
          href="/assets/eastern-visayas-map.png"
          xlink:href="/assets/eastern-visayas-map.png"
          x="0"
          y="0"
          width="256"
          height="395"
          preserveAspectRatio="xMidYMid meet"
          class="ev-map-base-ref"
          style="opacity:0.15;mix-blend-mode:overlay;pointer-events:none;"
        />

        <!-- Neighboring Reference Landmasses (Masbate, Bohol, Dinagat) -->
        <g opacity="0.68" filter="url(#island-shadow-3d)">
          <path d="${MASBATE_PATH}" fill="url(#grad-ext)" stroke="#f59e0b" stroke-width="0.8" />
          <path d="${BOHOL_PATH}" fill="url(#grad-ext)" stroke="#f59e0b" stroke-width="0.8" />
          <path d="${DINAGAT_PATH}" fill="url(#grad-ext)" stroke="#f59e0b" stroke-width="0.8" />
        </g>
        <text x="8" y="112" font-size="7" font-weight="700" fill="rgba(30,41,59,0.55)" letter-spacing="0.05em">MASBATE</text>
        <text x="25" y="375" font-size="7" font-weight="700" fill="rgba(30,41,59,0.55)" letter-spacing="0.05em">BOHOL</text>
        <text x="210" y="340" font-size="6.5" font-weight="700" fill="rgba(30,41,59,0.55)" letter-spacing="0.04em">DINAGAT</text>

        <!-- Italic Geographic Nautical Labels in Crisp White -->
        <g font-style="italic" fill="#ffffff" opacity="0.85" font-size="8" text-anchor="middle" font-weight="600">
          <text x="210" y="32" font-size="11" font-weight="700">Philippine<tspan x="210" dy="12">Sea</tspan></text>
          <text x="36" y="24" transform="rotate(-35 36 24)" font-size="6.5">San Bernardino Strait</text>
          <text x="75" y="115" font-size="7.5">Samar<tspan x="75" dy="9">Sea</tspan></text>
          <text x="80" y="172" font-size="6.5">Carigara Bay</text>
          <text x="72" y="245" font-size="6.5">Ormoc Bay</text>
          <text x="50" y="305" font-size="7.5">Camotes<tspan x="50" dy="9">Sea</tspan></text>
          <text x="165" y="245" font-size="8.5">Leyte<tspan x="165" dy="10">Gulf</tspan></text>
          <text x="110" y="390" font-size="7.5">Bohol Sea</text>
          <text x="215" y="390" font-size="6.5">Surigao Strait</text>
        </g>

        <!-- 3D Extruded Island Relief Base -->
        <g filter="url(#island-shadow-3d)">
          ${EV_MAP_PROVINCES.map((p) => `<path d="${p.d}" fill="url(#${p.gradId})" stroke="${p.stroke}" stroke-width="1.2" />`).join('')}
        </g>

        <!-- Backdrop Focus Dim Layer -->
        <rect
          class="ev-map-dim-layer"
          x="0"
          y="0"
          width="256"
          height="395"
          fill="rgba(15, 23, 42, 0.32)"
          style="display:${isAll ? 'none' : 'block'};pointer-events:none;transition:opacity 0.25s ease;"
        />

        <!-- Interactive 3D Ultra-HD Provinces Layer -->
        ${provinceSvgElements}

        <!-- 3D Nautical Compass Rose -->
        <g transform="translate(225, 80) scale(0.65)" opacity="0.8" pointer-events="none">
          <circle cx="0" cy="0" r="16" fill="rgba(255,255,255,0.25)" stroke="#ffffff" stroke-width="0.8" />
          <polygon points="0,-15 3.5,-2 0,0" fill="#ef4444" />
          <polygon points="0,-15 -3.5,-2 0,0" fill="#b91c1c" />
          <polygon points="0,15 3.5,2 0,0" fill="#ffffff" />
          <polygon points="0,15 -3.5,2 0,0" fill="#cbd5e1" />
          <polygon points="15,0 2,3.5 0,0" fill="#ffffff" />
          <polygon points="15,0 2,-3.5 0,0" fill="#cbd5e1" />
          <polygon points="-15,0 -2,3.5 0,0" fill="#ffffff" />
          <polygon points="-15,0 -2,-3.5 0,0" fill="#cbd5e1" />
          <text x="0" y="-18" font-size="7" font-weight="800" fill="#ffffff" text-anchor="middle">N</text>
        </g>
      </svg>
    </div>
  `;
}


