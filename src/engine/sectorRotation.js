/**
 * Sector Rotation Matrix
 *
 * Ranks the 11 S&P sector ETFs by relative strength vs SPY across multiple
 * lookbacks, classifies the market regime (risk-on / risk-off / mixed), and
 * describes what's rotating.
 *
 * Constitution Principle II: pure functions, no I/O, no DOM.
 * Data source: Yahoo Finance via fetchHistory (closes).
 */

// ─── Sector Universe ────────────────────────────────────

export const SECTOR_ETFS = [
  { symbol: 'XLK', name: 'Technology Select Sector SPDR', sector: 'Technology' },
  { symbol: 'XLF', name: 'Financial Select Sector SPDR', sector: 'Financials' },
  { symbol: 'XLE', name: 'Energy Select Sector SPDR', sector: 'Energy' },
  { symbol: 'XLV', name: 'Health Care Select Sector SPDR', sector: 'Health Care' },
  { symbol: 'XLI', name: 'Industrial Select Sector SPDR', sector: 'Industrials' },
  { symbol: 'XLY', name: 'Consumer Discretionary Select Sector SPDR', sector: 'Consumer Discretionary' },
  { symbol: 'XLP', name: 'Consumer Staples Select Sector SPDR', sector: 'Consumer Staples' },
  { symbol: 'XLU', name: 'Utilities Select Sector SPDR', sector: 'Utilities' },
  { symbol: 'XLB', name: 'Materials Select Sector SPDR', sector: 'Materials' },
  { symbol: 'XLRE', name: 'Real Estate Select Sector SPDR', sector: 'Real Estate' },
  { symbol: 'XLC', name: 'Communication Services Select Sector SPDR', sector: 'Communication Services' },
];

// Cyclical sectors tend to outperform during risk-on environments.
const CYCLICAL_SECTORS = new Set([
  'XLK', 'XLF', 'XLY', 'XLI', 'XLE', 'XLB', 'XLC',
]);

// Defensive sectors tend to outperform during risk-off environments.
const DEFENSIVE_SECTORS = new Set([
  'XLV', 'XLP', 'XLU', 'XLRE',
]);

// ─── Technical Indicators (pure) ─────────────────────────

/**
 * Rate of Change: percentage change over N periods.
 * @param {number[]} values
 * @param {number} period - number of bars to look back
 * @returns {number|null} ROC as percentage (e.g., 5.2 = +5.2%)
 */
export function rateOfChange(values, period) {
  if (!values || values.length <= period || period <= 0) return null;
  const past = values[values.length - 1 - period];
  if (past == null || past === 0) return null;
  return ((values[values.length - 1] - past) / past) * 100;
}

// ─── Sector Rotation ─────────────────────────────────────

/**
 * Compute the sector rotation matrix.
 *
 * @param {{symbol:string, name:string, sector:string, history:{closes:number[]}}[]} sectorsData
 * @param {{closes:number[]}} spyData - SPY history
 * @returns {{
 *   ranked: Array,
 *   leading: Array,
 *   trailing: Array,
 *   regime: 'risk-on'|'risk-off'|'mixed',
 *   rotationSignal: string,
 * }}
 */
export function computeSectorRotation(sectorsData, spyData) {
  if (!sectorsData || sectorsData.length === 0 || !spyData || !spyData.closes || spyData.closes.length === 0) {
    return {
      ranked: [],
      leading: [],
      trailing: [],
      regime: 'mixed',
      rotationSignal: 'No data available.',
    };
  }

  const spyCloses = spyData.closes;
  const spyRoc1m = rateOfChange(spyCloses, 21);
  const spyRoc3m = rateOfChange(spyCloses, 63);
  const spyRoc6m = rateOfChange(spyCloses, 126);
  const spyRoc12m = rateOfChange(spyCloses, 252);

  // Relative strength = sector ROC / SPY ROC (guard against divide-by-zero)
  const rs = (sectorRoc, spyRoc) => {
    if (sectorRoc == null || spyRoc == null) return null;
    if (spyRoc === 0) return sectorRoc > 0 ? sectorRoc : 0;
    return sectorRoc / spyRoc;
  };

  const ranked = sectorsData
    .map((s) => {
      const closes = s.history?.closes || [];
      const roc1m = rateOfChange(closes, 21);
      const roc3m = rateOfChange(closes, 63);
      const roc6m = rateOfChange(closes, 126);
      const roc12m = rateOfChange(closes, 252);

      const rs1m = rs(roc1m, spyRoc1m);
      const rs3m = rs(roc3m, spyRoc3m);
      const rs6m = rs(roc6m, spyRoc6m);
      const rs12m = rs(roc12m, spyRoc12m);

      // Composite RS score: weighted blend of the four lookbacks
      const parts = [
        { v: rs1m, w: 0.15 },
        { v: rs3m, w: 0.30 },
        { v: rs6m, w: 0.30 },
        { v: rs12m, w: 0.25 },
      ].filter((p) => p.v != null);
      const totalW = parts.reduce((sum, p) => sum + p.w, 0);
      const rsScore = totalW > 0
        ? parts.reduce((sum, p) => sum + p.v * (p.w / totalW), 0)
        : null;

      // Trend: compare 1m ROC vs 3m ROC (accelerating / decelerating / steady)
      let trend = 'steady';
      if (roc1m != null && roc3m != null) {
        if (roc1m > roc3m * 1.1) trend = 'accelerating';
        else if (roc1m < roc3m * 0.9) trend = 'decelerating';
      }

      // vs SPY: 3m relative strength sign
      let vsSpy = 'in line';
      if (rs3m != null) {
        if (rs3m > 1.05) vsSpy = 'outperforming';
        else if (rs3m < 0.95) vsSpy = 'underperforming';
      }

      return {
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        rsScore,
        roc1m,
        roc3m,
        roc6m,
        roc12m,
        trend,
        vsSpy,
      };
    })
    .filter((r) => r.rsScore != null)
    .sort((a, b) => (b.rsScore ?? -Infinity) - (a.rsScore ?? -Infinity));

  if (ranked.length === 0) {
    return {
      ranked: [],
      leading: [],
      trailing: [],
      regime: 'mixed',
      rotationSignal: 'Insufficient data to compute rotation.',
    };
  }

  const leading = ranked.slice(0, Math.min(3, ranked.length));
  const trailing = ranked.slice(-Math.min(3, ranked.length)).reverse();

  // Regime classification: compare average RS of cyclical vs defensive groups
  // across the full ranking. Also weight by top-3 composition. This is more
  // robust than a pure top-3 count (which can't produce 'mixed' when every
  // sector is classified) and handles negative-SPY environments better.
  const cyclicalRs = ranked
    .filter((r) => CYCLICAL_SECTORS.has(r.symbol))
    .map((r) => r.rsScore)
    .filter((v) => v != null);
  const defensiveRs = ranked
    .filter((r) => DEFENSIVE_SECTORS.has(r.symbol))
    .map((r) => r.rsScore)
    .filter((v) => v != null);
  const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const cyclicalAvg = avg(cyclicalRs);
  const defensiveAvg = avg(defensiveRs);

  let regime = 'mixed';
  if (cyclicalAvg != null && defensiveAvg != null) {
    const diff = cyclicalAvg - defensiveAvg;
    // Require a meaningful spread to declare a regime
    const threshold = 0.15;
    if (diff > threshold) regime = 'risk-on';
    else if (diff < -threshold) regime = 'risk-off';
  }

  // Rotation signal description
  const leadNames = leading.map((l) => l.sector).join(', ');
  const trailNames = trailing.map((t) => t.sector).join(', ');
  let rotationSignal;
  if (regime === 'risk-on') {
    rotationSignal = `Cyclical sectors (${leadNames}) are leading — risk-on rotation. Defensive sectors (${trailNames}) are lagging.`;
  } else if (regime === 'risk-off') {
    rotationSignal = `Defensive sectors (${leadNames}) are leading — risk-off rotation. Cyclical sectors (${trailNames}) are lagging.`;
  } else {
    rotationSignal = `Mixed rotation: leading (${leadNames}) vs lagging (${trailNames}). No clear cyclical/defensive tilt.`;
  }

  return {
    ranked,
    leading,
    trailing,
    regime,
    rotationSignal,
  };
}
