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

export const EV_MAP_PROVINCES = [
  {
    code: 'NSA',
    name: 'Northern Samar',
    d: 'M 88 82 C 102 54, 134 38, 175 32 C 218 30, 260 38, 292 52 C 308 60, 318 70, 318 82 C 316 95, 308 108, 296 118 C 275 118, 250 114, 225 112 C 192 110, 162 112, 132 116 C 110 112, 94 98, 88 82 Z',
    labelX: 195,
    labelY: 74,
    subX: 195,
    subY: 86,
    color: '#15803d'
  },
  {
    code: 'SAM',
    name: 'Samar',
    d: 'M 132 116 C 162 112, 192 110, 225 112 C 235 142, 240 178, 244 212 C 248 228, 260 236, 270 240 C 246 248, 222 240, 194 232 C 176 216, 162 192, 150 168 C 136 142, 130 128, 132 116 Z',
    labelX: 188,
    labelY: 172,
    subX: 188,
    subY: 184,
    color: '#166534'
  },
  {
    code: 'ESA',
    name: 'Eastern Samar',
    d: 'M 225 112 C 250 114, 275 118, 296 118 C 308 108, 316 95, 318 82 C 324 114, 322 148, 328 185 C 334 222, 350 258, 370 295 C 378 312, 372 318, 360 306 C 340 274, 318 246, 270 240 C 260 236, 248 228, 244 212 C 240 178, 235 142, 225 112 Z',
    labelX: 295,
    labelY: 190,
    subX: 295,
    subY: 202,
    color: '#14532d'
  },
  {
    code: 'BIL',
    name: 'Biliran',
    d: 'M 108 182 C 122 174, 134 180, 132 194 C 130 208, 115 214, 105 206 C 98 198, 100 188, 108 182 Z',
    labelX: 118,
    labelY: 195,
    subX: 118,
    subY: 205,
    color: '#0f766e'
  },
  {
    code: 'LEY',
    name: 'Leyte',
    d: 'M 82 242 C 86 228, 108 216, 134 214 C 158 220, 188 226, 212 232 C 222 238, 224 258, 220 282 C 216 312, 210 336, 202 348 C 194 352, 188 353, 184 354 C 168 346, 156 322, 145 290 C 122 270, 94 260, 82 242 Z',
    labelX: 160,
    labelY: 278,
    subX: 160,
    subY: 290,
    color: '#166534'
  },
  {
    code: 'SLE',
    name: 'Southern Leyte',
    d: 'M 184 354 C 188 353, 194 352, 202 348 C 216 358, 228 374, 234 394 C 236 418, 228 430, 218 432 C 208 416, 202 396, 196 376 C 188 386, 180 404, 174 382 C 176 372, 180 362, 184 354 Z',
    labelX: 208,
    labelY: 395,
    subX: 208,
    subY: 406,
    color: '#15803d'
  }
];

export function renderEasternVisayasMapSvg({ provRows = [], selectedCode = 'ALL' } = {}) {
  const isAll = !selectedCode || selectedCode === 'ALL';

  const provinceSvgElements = EV_MAP_PROVINCES.map((p) => {
    const isSelected = selectedCode === p.code;
    const provData = (provRows || []).find((r) => r.code === p.code) || {};
    const ladLhs = provData.ladLhs || 0;
    const ladArea = provData.ladArea ? provData.ladArea.toFixed(2) : '0.00';
    const tempLhs = provData.tempLhs || 0;
    const tooltipText = `${p.name} (${p.code})&#10;LAD Balance: ${ladLhs.toLocaleString()} LHs (${ladArea} HAS)&#10;Temp. Park: ${tempLhs.toLocaleString()} LHs&#10;Click to view breakdown`;

    const opacity = isAll || isSelected ? '1' : '0.62';

    return `
      <g class="ev-map-group" data-map-province="${p.code}" style="cursor:pointer;" tabindex="0" role="button" aria-label="${esc(p.name)}">
        <path
          class="ev-map-province ${isSelected ? 'is-active' : ''}"
          data-map-province="${p.code}"
          d="${p.d}"
          fill="${p.color}"
          style="opacity:${opacity};"
        >
          <title>${tooltipText}</title>
        </path>
        <text x="${p.labelX}" y="${p.labelY}" class="ev-map-label">${esc(p.code)}</text>
        <text x="${p.subX}" y="${p.subY}" class="ev-map-sublabel" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,0.92)" font-weight="700">${esc(p.name)}</text>
      </g>
    `;
  }).join('');

  return `
    <div class="ev-map-wrap">
      <svg viewBox="0 0 380 450" class="ev-map-svg" aria-label="Eastern Visayas Region VIII Map">
        <defs>
          <filter id="ev-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <!-- Subtle Geographic Water Labels -->
        <text x="14" y="24" font-size="11" font-weight="800" fill="#064e3b" letter-spacing="0.06em">REGION VIII</text>
        <text x="14" y="37" font-size="8.5" font-weight="600" fill="#64748b">Eastern Visayas</text>

        <text x="24" y="155" class="ev-map-water-label">Samar Sea</text>
        <text x="240" y="280" class="ev-map-water-label">Leyte Gulf</text>
        <text x="20" y="375" class="ev-map-water-label">Camotes Sea</text>
        <text x="235" y="440" class="ev-map-water-label">Surigao Strait</text>

        <!-- Province Shapes & Labels -->
        ${provinceSvgElements}
      </svg>
    </div>
  `;
}


