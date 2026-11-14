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


