/**
 * Market Crash Indicator — composite multi-factor risk model.
 *
 * Blends volatility, trend, breadth, momentum, drawdown, and positioning
 * signals into a single 0–100 "crash risk" score with a full factor
 * breakdown for transparency.
 *
 * Constitution Principle II: pure functions, no I/O, no DOM.
 * Constitution Principle IV: every factor is cited and explained.
 * Constitution Principle VII: drawdown-aware risk framing.
 *
 * Design rationale:
 *   No single indicator reliably predicts crashes. A composite score
 *   that combines volatility stress (VIX level + term structure), trend
 *   breakdown (SPY vs 200-DMA), breadth deterioration (sectors below
 *   200-DMA), momentum collapse, drawdown depth, and smart-money
 *   de-risking (COT) provides a more robust early-warning system.
 *   Each factor is normalized to 0–100 (higher = more risk) and
 *   weighted by its historical predictive value.
 *
 * Weights (sum to 1.0):
 *   VIX level & regime:        0.20  — the single most reliable fear gauge
 *   VIX term structure:        0.10  — backwardation = acute stress
 *   SPY vs 200-DMA:            0.20  — the trend line that matters most
 *   Sector breadth:            0.15  — broad weakness = systemic
 *   Momentum deterioration:    0.10  — negative momentum = trend rolling
 *   Drawdown from 52wk high:   0.15  — depth of decline already underway
 *   COT positioning shift:     0.10  — smart money de-risking
 */

// ─── Factor weights ──────────────────────────────────────

const WEIGHTS = {
  vixLevel: 0.20,
  termStructure: 0.10,
  spyVs200dma: 0.20,
  breadth: 0.15,
  momentum: 0.10,
  drawdown: 0.15,
  cotPositioning: 0.10,
};

// ─── Risk levels ─────────────────────────────────────────

const RISK_LEVELS = [
  { max: 25, level: 'calm',     color: 'emerald', label: 'Calm' },
  { max: 45, level: 'watch',    color: 'blue',    label: 'Watch' },
  { max: 65, level: 'elevated', color: 'yellow',  label: 'Elevated' },
  { max: 80, level: 'high',     color: 'orange',  label: 'High' },
  { max: Infinity, level: 'severe', color: 'red', label: 'Severe' },
];

function classifyLevel(score) {
  return RISK_LEVELS.find((r) => score <= r.max) || RISK_LEVELS[RISK_LEVELS.length - 1];
}

// ─── Normalization helpers ───────────────────────────────

/**
 * Linear clamp: maps a value from [srcMin, srcMax] to [0, 100].
 * Below srcMin → 0, above srcMax → 100.
 */
function linearClamp(value, srcMin, srcMax) {
  if (value == null || isNaN(value)) return null;
  const pct = (value - srcMin) / (srcMax - srcMin);
  return Math.max(0, Math.min(100, pct * 100));
}

/**
 * Inverse linear clamp: maps a value from [srcMin, srcMax] to [100, 0].
 * Below srcMin → 100, above srcMax → 0. Used for "below = bad" signals.
 */
function inverseClamp(value, srcMin, srcMax) {
  if (value == null || isNaN(value)) return null;
  const pct = (srcMax - value) / (srcMax - srcMin);
  return Math.max(0, Math.min(100, pct * 100));
}

// ─── Individual factor scorers ───────────────────────────

/**
 * VIX level factor.
 * VIX < 15 → 0 (no fear), VIX 15-20 → low, 20-30 → moderate,
 * 30-50 → high, > 50 → max risk.
 */
function scoreVixLevel(vixLevel) {
  if (vixLevel == null) return { value: null, score: 0, note: 'VIX data unavailable' };
  const score = linearClamp(vixLevel, 12, 50);
  let note;
  if (vixLevel < 15) note = `VIX at ${vixLevel.toFixed(1)} — low volatility, complacent`;
  else if (vixLevel < 20) note = `VIX at ${vixLevel.toFixed(1)} — normal range`;
  else if (vixLevel < 30) note = `VIX at ${vixLevel.toFixed(1)} — elevated, markets nervous`;
  else if (vixLevel < 50) note = `VIX at ${vixLevel.toFixed(1)} — high fear, stress regime`;
  else note = `VIX at ${vixLevel.toFixed(1)} — panic / crisis territory`;
  return { value: vixLevel, score: score ?? 0, note };
}

/**
 * VIX term structure factor.
 * Contango (VX1 > VIX) = normal → low risk.
 * Backwardation (VX1 < VIX) = stress → high risk.
 * Score based on how much VX1 is below VIX.
 */
function scoreTermStructure(termStructure) {
  if (!termStructure || termStructure.vix == null) {
    return { value: null, score: 0, note: 'Term structure unavailable' };
  }
  if (termStructure.vx1 == null) {
    return { value: null, score: 0, note: 'VX1 futures data unavailable' };
  }
  const spread = termStructure.vix - termStructure.vx1; // positive = backwardation
  if (spread <= 0) {
    return {
      value: spread,
      score: 5,
      note: `Contango (VX1 ${termStructure.vx1.toFixed(1)} > VIX ${termStructure.vix.toFixed(1)}) — normal, calming`,
    };
  }
  // Backwardation: 0-2 points = mild, 2-5 = moderate, >5 = severe
  const score = linearClamp(spread, 0, 5);
  return {
    value: spread,
    score: score ?? 0,
    note: `Backwardation (VX1 ${termStructure.vx1.toFixed(1)} < VIX ${termStructure.vix.toFixed(1)}) — hedging demand elevated, stress signal`,
  };
}

/**
 * SPY vs 200-DMA factor.
 * Price above 200-DMA → low risk; below → high risk.
 * Score based on % distance from 200-DMA.
 */
function scoreSpyVs200dma(spyAnalysis) {
  if (!spyAnalysis || spyAnalysis.sma200 == null || spyAnalysis.last == null) {
    return { value: null, score: 0, note: 'SPY 200-DMA data unavailable' };
  }
  const pctFrom200 = ((spyAnalysis.last - spyAnalysis.sma200) / spyAnalysis.sma200) * 100;
  // +10% above → 0; at 200-DMA → 50; -15% below → 100
  const score = inverseClamp(pctFrom200, -15, 10);
  let note;
  if (spyAnalysis.deathCross) {
    note = `SPY below 200-DMA by ${Math.abs(pctFrom200).toFixed(1)}% — death cross active, bearish trend`;
  } else if (pctFrom200 < 0) {
    note = `SPY below 200-DMA by ${Math.abs(pctFrom200).toFixed(1)}% — trend weakened`;
  } else if (pctFrom200 < 3) {
    note = `SPY only ${pctFrom200.toFixed(1)}% above 200-DMA — approaching support, vulnerable`;
  } else {
    note = `SPY ${pctFrom200.toFixed(1)}% above 200-DMA — trend intact`;
  }
  return { value: pctFrom200, score: score ?? 0, note };
}

/**
 * Sector breadth factor.
 * Measures the percentage of sector ETFs below their own 200-DMA.
 * More sectors below = broader weakness = higher risk.
 */
function scoreBreadth(sectorAssets) {
  if (!sectorAssets || !Array.isArray(sectorAssets) || sectorAssets.length === 0) {
    return { value: null, score: 0, note: 'Sector breadth data unavailable' };
  }
  const with200 = sectorAssets.filter((a) => a.timeSeries?.sma200 != null && a.timeSeries?.last != null);
  if (with200.length === 0) {
    return { value: null, score: 0, note: 'No sector 200-DMA data available' };
  }
  const belowCount = with200.filter((a) => a.timeSeries.last < a.timeSeries.sma200).length;
  const pctBelow = (belowCount / with200.length) * 100;
  const score = linearClamp(pctBelow, 0, 100);
  let note;
  if (pctBelow < 20) note = `${pctBelow.toFixed(0)}% of sectors below 200-DMA — broad strength`;
  else if (pctBelow < 50) note = `${pctBelow.toFixed(0)}% of sectors below 200-DMA — mixed breadth`;
  else if (pctBelow < 75) note = `${pctBelow.toFixed(0)}% of sectors below 200-DMA — broad weakness`;
  else note = `${pctBelow.toFixed(0)}% of sectors below 200-DMA — systemic breakdown`;
  return { value: pctBelow, score: score ?? 0, note };
}

/**
 * Momentum deterioration factor.
 * Looks at the average momentum score across the index/stock universe.
 * Strongly negative = trend rolling over = higher risk.
 */
function scoreMomentum(assets) {
  if (!assets || !Array.isArray(assets) || assets.length === 0) {
    return { value: null, score: 0, note: 'Momentum data unavailable' };
  }
  const withScores = assets.filter((a) => a.momentumScore != null);
  if (withScores.length === 0) {
    return { value: null, score: 0, note: 'No momentum scores available' };
  }
  const avgScore = withScores.reduce((s, a) => s + a.momentumScore, 0) / withScores.length;
  // +20 → 0, 0 → 50, -20 → 100
  const score = inverseClamp(avgScore, -20, 20);
  let note;
  if (avgScore > 10) note = `Avg momentum ${avgScore.toFixed(1)} — strong positive trend`;
  else if (avgScore > 0) note = `Avg momentum ${avgScore.toFixed(1)} — positive but moderating`;
  else if (avgScore > -10) note = `Avg momentum ${avgScore.toFixed(1)} — negative, trend weakening`;
  else note = `Avg momentum ${avgScore.toFixed(1)} — sharply negative, momentum collapse`;
  return { value: avgScore, score: score ?? 0, note };
}

/**
 * Drawdown from 52-week high factor.
 * Deeper drawdown = more risk of further decline (momentum of decline).
 */
function scoreDrawdown(spyAnalysis) {
  if (!spyAnalysis || spyAnalysis.range52w?.high52w == null || spyAnalysis.last == null) {
    return { value: null, score: 0, note: '52-week range data unavailable' };
  }
  const { high52w, low52w } = spyAnalysis.range52w;
  const drawdown = ((high52w - spyAnalysis.last) / high52w) * 100;
  // 0% drawdown → 0, 5% → low, 10% → moderate, 20% → high, 35%+ → max
  const score = linearClamp(drawdown, 0, 35);
  let note;
  if (drawdown < 5) note = `SPY ${drawdown.toFixed(1)}% from 52wk high — near highs, no stress`;
  else if (drawdown < 10) note = `SPY ${drawdown.toFixed(1)}% from 52wk high — minor pullback`;
  else if (drawdown < 20) note = `SPY ${drawdown.toFixed(1)}% from 52wk high — correction territory`;
  else note = `SPY ${drawdown.toFixed(1)}% from 52wk high — bear market territory`;
  return { value: drawdown, score: score ?? 0, note };
}

/**
 * COT positioning shift factor.
 * Looks at net positioning changes in equity index futures.
 * Large negative week-over-week shifts = smart money de-risking.
 */
function scoreCotPositioning(cotReport) {
  if (!cotReport || !cotReport.byClass) {
    return { value: null, score: 0, note: 'COT positioning data unavailable' };
  }
  const equityMarkets = cotReport.byClass['Equities'];
  if (!Array.isArray(equityMarkets) || equityMarkets.length === 0) {
    return { value: null, score: 0, note: 'No equity COT data in report' };
  }
  // Sum weekDelta across equity markets
  const totalDelta = equityMarkets.reduce((s, m) => s + (m.weekDelta || 0), 0);
  // Positive delta = adding longs = low risk
  // Negative delta = reducing longs / adding shorts = high risk
  // -50000 → 100, 0 → 50, +50000 → 0
  const score = inverseClamp(totalDelta, -50000, 50000);
  let note;
  if (totalDelta > 10000) note = `COT equity net +${totalDelta.toLocaleString()} — smart money adding longs`;
  else if (totalDelta > -10000) note = `COT equity net ${totalDelta.toLocaleString()} — positioning stable`;
  else if (totalDelta > -30000) note = `COT equity net ${totalDelta.toLocaleString()} — smart money reducing longs`;
  else note = `COT equity net ${totalDelta.toLocaleString()} — sharp de-risking by smart money`;
  return { value: totalDelta, score: score ?? 0, note };
}

// ─── Main composite function ─────────────────────────────

/**
 * Compute the composite crash risk indicator from all data sources.
 *
 * @param {object} inputs
 * @param {object} [inputs.volatility]     — /volatility/scan payload
 * @param {object} [inputs.momentumScan]   — /momentum/scan payload
 * @param {object} [inputs.sectorScan]     — /sector/scan payload
 * @param {object} [inputs.cotReport]      — /cot/report payload
 * @returns {{ score:number, level:string, color:string, label:string, factors:object[], asOf:string }}
 */
export function computeCrashIndicator(inputs = {}) {
  const { volatility, momentumScan, sectorScan, cotReport } = inputs;

  // Extract SPY analysis from momentum scan
  const spyAsset = momentumScan?.assets?.find((a) => a.symbol === 'SPY');
  const spyAnalysis = spyAsset?.timeSeries || null;

  // Score each factor
  const vixLevelF = scoreVixLevel(volatility?.vixLevel);
  const termStructureF = scoreTermStructure(volatility?.termStructure);
  const spyVs200F = scoreSpyVs200dma(spyAnalysis);
  const breadthF = scoreBreadth(momentumScan?.assets);
  const momentumF = scoreMomentum(momentumScan?.assets);
  const drawdownF = scoreDrawdown(spyAnalysis);
  const cotF = scoreCotPositioning(cotReport);

  const factors = [
    { key: 'vixLevel',       label: 'VIX Level & Regime',      ...vixLevelF,      weight: WEIGHTS.vixLevel },
    { key: 'termStructure',  label: 'VIX Term Structure',      ...termStructureF, weight: WEIGHTS.termStructure },
    { key: 'spyVs200dma',    label: 'SPY vs 200-DMA',          ...spyVs200F,      weight: WEIGHTS.spyVs200dma },
    { key: 'breadth',        label: 'Sector Breadth',          ...breadthF,       weight: WEIGHTS.breadth },
    { key: 'momentum',       label: 'Momentum Deterioration',  ...momentumF,      weight: WEIGHTS.momentum },
    { key: 'drawdown',       label: 'Drawdown from 52wk High', ...drawdownF,      weight: WEIGHTS.drawdown },
    { key: 'cotPositioning', label: 'COT Positioning Shift',   ...cotF,           weight: WEIGHTS.cotPositioning },
  ];

  // Compute weighted composite score
  let totalScore = 0;
  let totalWeight = 0;
  for (const f of factors) {
    if (f.score != null && !isNaN(f.score)) {
      totalScore += f.score * f.weight;
      totalWeight += f.weight;
    }
  }
  const score = totalWeight > 0 ? totalScore / totalWeight : 0;

  // Compute contribution per factor (how much each adds to the final score)
  for (const f of factors) {
    f.contribution = f.score != null && !isNaN(f.score)
      ? +((f.score * f.weight / (totalWeight || 1))).toFixed(1)
      : 0;
  }

  const levelInfo = classifyLevel(score);

  return {
    score: +score.toFixed(1),
    level: levelInfo.level,
    color: levelInfo.color,
    label: levelInfo.label,
    factors,
    asOf: new Date().toISOString(),
  };
}

export { RISK_LEVELS, WEIGHTS };
