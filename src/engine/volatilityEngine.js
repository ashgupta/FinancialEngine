/**
 * Volatility Engine
 *
 * Analyzes the VIX, realized volatility of SPY, the VIX futures term
 * structure (VX1 / VX2), and the volatility-of-volatility to produce a
 * unified volatility dashboard.
 *
 * Key concepts (per the trading transcript):
 *   - Realized volatility: annualized std of daily returns * sqrt(252) * 100
 *   - Vol risk premium: VIX (implied) minus realized vol of SPY.
 *     High premium  → options are expensive → sell vol.
 *     Low / negative premium → options are cheap → buy vol.
 *   - Term structure: contango (VX1 > VIX) is normal/calming;
 *     backwardation (VX1 < VIX) signals stress / hedging demand.
 *   - Vol-of-vol: realized volatility of the VIX itself — how jumpy fear is.
 *
 * Constitution Principle II: pure functions, no I/O, no DOM.
 * Data source: Yahoo Finance via fetchHistory (closes).
 */

// ─── Regime metadata ─────────────────────────────────────

const VOL_REGIMES = {
  low:      { label: 'Low',      color: 'emerald', threshold: [0, 15] },
  normal:   { label: 'Normal',   color: 'blue',    threshold: [15, 20] },
  elevated: { label: 'Elevated', color: 'yellow',  threshold: [20, 30] },
  high:     { label: 'High',     color: 'orange',  threshold: [30, 50] },
  crisis:   { label: 'Crisis',   color: 'red',     threshold: [50, Infinity] },
};

// ─── Helpers ────────────────────────────────────────────

/**
 * Rate of Change: percentage change over N periods.
 * (Same implementation as momentumEngine.rateOfChange — kept here so the
 * volatility engine is self-contained and has no cross-engine deps.)
 * @param {number[]} values
 * @param {number} period - number of bars to look back
 * @returns {number|null} ROC as percentage (e.g., 5.2 = +5.2%)
 */
export function rateOfChange(values, period) {
  if (!values || values.length <= period) return null;
  const past = values[values.length - 1 - period];
  if (!past || past === 0) return null;
  return ((values[values.length - 1] - past) / past) * 100;
}

/**
 * Standard deviation of a sample (population std by default; pass
 * sample=true for sample std with Bessel's correction).
 * @param {number[]} arr
 * @param {boolean} [sample=false]
 * @returns {number}
 */
function std(arr, sample = false) {
  if (!arr || arr.length === 0) return 0;
  const n = arr.length;
  const mean = arr.reduce((s, v) => s + v, 0) / n;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (sample ? (n - 1) : n);
  return Math.sqrt(variance);
}

/**
 * Daily log returns from a close-price series.
 * @param {number[]} closes
 * @returns {number[]} returns (length = closes.length - 1)
 */
function dailyReturns(closes) {
  if (!closes || closes.length < 2) return [];
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (!prev || prev === 0) continue;
    out.push(Math.log(closes[i] / prev));
  }
  return out;
}

// ─── Core functions ─────────────────────────────────────

/**
 * Compute annualized realized volatility from daily closes.
 * std(daily returns) * sqrt(252) * 100  → percentage.
 * @param {number[]} closes - daily close prices
 * @param {number} [period=20] - lookback window (trailing)
 * @returns {number|null} realized vol as a percentage (e.g., 15.3 = 15.3%), or null
 */
export function computeRealizedVolatility(closes, period = 20) {
  if (!closes || closes.length < period + 1 || period <= 0) return null;
  const slice = closes.slice(-(period + 1));
  const rets = dailyReturns(slice);
  if (rets.length < 2) return null;
  const sd = std(rets);
  return sd * Math.sqrt(252) * 100;
}

/**
 * Classify the VIX level into a volatility regime.
 * @param {number} vixLevel
 * @returns {'low'|'normal'|'elevated'|'high'|'crisis'}
 */
export function computeVolRegime(vixLevel) {
  if (vixLevel == null || typeof vixLevel !== 'number' || isNaN(vixLevel)) return 'normal';
  if (vixLevel < 15) return 'low';
  if (vixLevel < 20) return 'normal';
  if (vixLevel < 30) return 'elevated';
  if (vixLevel < 50) return 'high';
  return 'crisis';
}

/**
 * Compute the VIX futures term structure from VIX, VX1 (front month),
 * and VX2 (second month) close series.
 * @param {{closes:number[]}} vixData
 * @param {{closes:number[]}} [vx1Data]
 * @param {{closes:number[]}} [vx2Data]
 * @returns {{vix:number|null, vx1:number|null, vx2:number|null, contango:boolean, backwardation:boolean, spread:number|null, slope:number|null, label:string}|null}
 */
export function computeVixTermStructure(vixData, vx1Data, vx2Data) {
  const vix = vixData?.closes?.length ? vixData.closes[vixData.closes.length - 1] : null;
  const vx1 = vx1Data?.closes?.length ? vx1Data.closes[vx1Data.closes.length - 1] : null;
  const vx2 = vx2Data?.closes?.length ? vx2Data.closes[vx2Data.closes.length - 1] : null;

  if (vix == null) return null;

  // If no VX1 available at all, we can still report the VIX level but no structure
  if (vx1 == null) {
    return {
      vix,
      vx1: null,
      vx2: null,
      contango: false,
      backwardation: false,
      spread: null,
      slope: null,
      label: 'Unavailable',
    };
  }

  const spread = vx1 - vix;
  const contango = vx1 > vix;
  const backwardation = vx1 < vix;
  const slope = vx2 != null && vx2 !== 0 ? (vx2 - vix) / vx2 : null;

  let label;
  if (contango) {
    label = vx2 != null && vx2 > vx1 ? 'Contango (normal)' : 'Contango (flat)';
  } else if (backwardation) {
    label = 'Backwardation (stress)';
  } else {
    label = 'Flat';
  }

  return { vix, vx1, vx2, contango, backwardation, spread, slope, label };
}

/**
 * Term structure from the CBOE constant-maturity VIX index family. Yahoo does
 * not publish continuous VIX futures (^VX1/^VX2 return no data), but it does
 * publish ^VIX9D (9-day), ^VIX3M (93-day) and ^VIX6M (6-month) — the same
 * curve CBOE uses for its VIX/VIX3M ratio. VIX3M plays the role of the
 * "forward" point: VIX3M > VIX = contango (normal); VIX > VIX3M =
 * backwardation (stress). Source: CBOE VIX index methodology
 * (https://www.cboe.com/tradable_products/vix/).
 *
 * @param {number|null} vix
 * @param {{vix9d?:number|null, vix3m?:number|null, vix6m?:number|null}} curve
 * @returns {object|null} same shape as computeVixTermStructure plus
 *   { vix9d, vix3m, vix6m, ratio, source:'cboe-index' }
 */
export function computeVixIndexCurve(vix, curve = {}) {
  if (vix == null || isNaN(vix)) return null;
  const vix9d = curve.vix9d ?? null;
  const vix3m = curve.vix3m ?? null;
  const vix6m = curve.vix6m ?? null;
  if (vix3m == null || isNaN(vix3m) || vix3m <= 0) return null;

  const spread = vix3m - vix;
  const contango = vix3m > vix;
  const backwardation = vix3m < vix;
  const slope = vix6m != null && vix6m > 0 ? (vix6m - vix) / vix6m : null;
  const ratio = vix / vix3m;

  let label;
  if (backwardation) label = 'Backwardation (stress)';
  else if (contango) label = vix6m != null && vix6m >= vix3m ? 'Contango (normal)' : 'Contango (flat)';
  else label = 'Flat';

  return {
    vix, vx1: null, vx2: null, vix9d, vix3m, vix6m,
    contango, backwardation, spread, slope, ratio, label,
    source: 'cboe-index',
  };
}

/**
 * Compute the realized volatility of the VIX itself ("vol of vol").
 * Same math as computeRealizedVolatility but applied to VIX closes.
 * @param {number[]} closes - VIX daily closes
 * @param {number} [period=20]
 * @returns {number|null} vol-of-vol as a percentage, or null
 */
export function computeVolOfVol(closes, period = 20) {
  return computeRealizedVolatility(closes, period);
}

// ─── Main analysis ──────────────────────────────────────

/**
 * Combine all volatility metrics into a single dashboard payload.
 *
 * @param {{closes:number[], dates?:string[]}} vixHistory  - VIX daily history
 * @param {{closes:number[], dates?:string[]}} spyHistory  - SPY daily history
 * @param {{closes:number[], dates?:string[]}} [vx1History] - VIX front-month futures
 * @param {{closes:number[], dates?:string[]}} [vx2History] - VIX second-month futures
 * @param {{vix9d?:{closes:number[]}, vix3m?:{closes:number[]}, vix6m?:{closes:number[]}}} [curveHistories]
 *   CBOE constant-maturity VIX indices; used when futures are unavailable
 * @returns {object} analysis payload
 */
export function analyzeVolatility(vixHistory, spyHistory, vx1History, vx2History, curveHistories = {}) {
  // Filter out null/undefined closes (e.g., current trading day with no close yet)
  const filterValid = (history) => {
    if (!history?.closes) return { closes: [], dates: [] };
    const closes = [], dates = [];
    for (let i = 0; i < history.closes.length; i++) {
      if (history.closes[i] != null && !isNaN(history.closes[i])) {
        closes.push(history.closes[i]);
        dates.push(history.dates?.[i] || `Day ${i + 1}`);
      }
    }
    return { closes, dates };
  };

  const vix = filterValid(vixHistory);
  const spy = filterValid(spyHistory);
  const vixCloses = vix.closes;
  const spyCloses = spy.closes;
  const vixDates = vix.dates;
  const spyDates = spy.dates;

  const vixLevel = vixCloses.length ? vixCloses[vixCloses.length - 1] : null;
  const volRegime = computeVolRegime(vixLevel);
  const regimeColor = VOL_REGIMES[volRegime]?.color || 'blue';

  const realizedVolSPY = computeRealizedVolatility(spyCloses, 20);
  const volOfVol = computeVolOfVol(vixCloses, 20);

  // Vol risk premium = implied (VIX) - realized (SPY)
  const volRiskPremium = vixLevel != null && realizedVolSPY != null
    ? vixLevel - realizedVolSPY
    : null;

  // Signal from the risk premium
  let signal = 'neutral';
  if (volRiskPremium != null) {
    if (volRiskPremium > 5) signal = 'sell vol';
    else if (volRiskPremium < -5) signal = 'buy vol';
  }

  // Term structure (optional) — filter nulls from VX data too
  const vx1 = filterValid(vx1History);
  const vx2 = filterValid(vx2History);
  const lastOf = (h) => {
    const c = filterValid(h).closes;
    return c.length ? c[c.length - 1] : null;
  };
  const futuresStructure = vx1.closes.length
    ? computeVixTermStructure({ closes: vixCloses }, vx1, vx2)
    : null;
  const indexCurve = computeVixIndexCurve(vixLevel, {
    vix9d: lastOf(curveHistories.vix9d),
    vix3m: lastOf(curveHistories.vix3m),
    vix6m: lastOf(curveHistories.vix6m),
  });
  // Prefer real futures when present; otherwise use the CBOE index curve.
  const termStructure = futuresStructure || indexCurve
    || ((vx1.closes.length || vx2.closes.length)
      ? computeVixTermStructure({ closes: vixCloses }, vx1, vx2)
      : null);

  // Human-readable description
  const description = buildDescription({
    vixLevel, volRegime, realizedVolSPY, volRiskPremium, volOfVol, termStructure, signal,
  });

  // 6-month VIX series for charting (last ~126 trading days)
  const chartLookback = 126;
  const vixChart = vixCloses.length > chartLookback
    ? vixCloses.slice(-chartLookback)
    : vixCloses.slice();
  const vixChartDates = vixDates.length > chartLookback
    ? vixDates.slice(-chartLookback)
    : vixDates.slice();
  const chart = vixChart.map((v, i) => ({
    date: vixChartDates[i] || `Day ${i + 1}`,
    vix: v,
  }));

  return {
    vixLevel,
    volRegime,
    regimeColor,
    realizedVolSPY,
    volRiskPremium,
    termStructure,
    volOfVol,
    signal,
    description,
    chart,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Build a human-readable summary of the volatility state.
 */
function buildDescription({
  vixLevel, volRegime, realizedVolSPY, volRiskPremium, volOfVol, termStructure, signal,
}) {
  if (vixLevel == null) {
    return 'No VIX data available.';
  }
  const parts = [];

  parts.push(`VIX is at ${vixLevel.toFixed(2)} (${volRegime} regime).`);

  if (realizedVolSPY != null) {
    parts.push(`SPY 20-day realized vol is ${realizedVolSPY.toFixed(1)}%.`);
  }

  if (volRiskPremium != null) {
    const premiumStr = volRiskPremium >= 0
      ? `+${volRiskPremium.toFixed(1)}`
      : volRiskPremium.toFixed(1);
    if (volRiskPremium > 5) {
      parts.push(`Vol risk premium is ${premiumStr}pts — options are expensive, favor selling vol.`);
    } else if (volRiskPremium < -5) {
      parts.push(`Vol risk premium is ${premiumStr}pts — options are cheap, favor buying vol.`);
    } else {
      parts.push(`Vol risk premium is ${premiumStr}pts — near fair value.`);
    }
  }

  if (termStructure && termStructure.source === 'cboe-index') {
    const r = termStructure.ratio;
    if (termStructure.backwardation) {
      parts.push(`VIX curve is inverted (VIX3M ${termStructure.vix3m.toFixed(2)} < VIX, ratio ${r.toFixed(2)}) — hedging demand elevated, stress signal.`);
    } else if (termStructure.contango) {
      parts.push(`VIX curve is in contango (VIX3M ${termStructure.vix3m.toFixed(2)} > VIX, ratio ${r.toFixed(2)}) — normal, calming; long-dated vol costs more than spot.`);
    }
  } else if (termStructure && termStructure.label !== 'Unavailable') {
    if (termStructure.backwardation) {
      parts.push(`Term structure is in backwardation (VX1 ${termStructure.vx1?.toFixed(2)} < VIX) — hedging demand elevated, stress signal.`);
    } else if (termStructure.contango) {
      parts.push(`Term structure is in contango (VX1 ${termStructure.vx1?.toFixed(2)} > VIX) — normal, calming.`);
    }
  }

  if (volOfVol != null) {
    parts.push(`Vol-of-vol is ${volOfVol.toFixed(1)}% — VIX itself is ${volOfVol > 80 ? 'jumpy' : 'relatively stable'}.`);
  }

  parts.push(`Signal: ${signal}.`);

  return parts.join(' ');
}
