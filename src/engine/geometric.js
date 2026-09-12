/**
 * Geometric Wealth Engine
 * Implements the principles from "The Geometry of Wealth" series:
 * - MAR Ratio (CAGR / Max Drawdown) — the correct measure of geometric efficiency
 * - Volatility Tax (Arithmetic – Geometric return)
 * - Recovery Cost (convex relationship between drawdown depth and required recovery)
 * - Skewness & best/worst asymmetry
 * - Crisis Alpha contribution analysis
 *
 * Constitution Principle II: pure functions, no I/O, no DOM.
 */

/**
 * Compute Compound Annual Growth Rate from a series of periodic returns.
 * @param {number[]} returns - decimal returns (e.g., 0.05 = 5%)
 * @param {number} periodsPerYear - 12 for monthly, 1 for annual
 * @returns {number} annualised CAGR
 */
export function cagr(returns, periodsPerYear = 12) {
  if (!returns || returns.length === 0) return 0;
  const cumulative = returns.reduce((prod, r) => prod * (1 + r), 1);
  const years = returns.length / periodsPerYear;
  if (years <= 0) return 0;
  return Math.pow(cumulative, 1 / years) - 1;
}

/**
 * Arithmetic mean annualised return.
 * @param {number[]} returns
 * @param {number} periodsPerYear
 * @returns {number}
 */
export function arithmeticReturn(returns, periodsPerYear = 12) {
  if (!returns || returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  return mean * periodsPerYear;
}

/**
 * Annualised volatility (standard deviation).
 * @param {number[]} returns
 * @param {number} periodsPerYear
 * @returns {number}
 */
export function annualisedVolatility(returns, periodsPerYear = 12) {
  if (!returns || returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

/**
 * Volatility Tax = Arithmetic Return – CAGR
 * The geometric drag imposed by variance on compounding.
 * Formula: CAGR ≈ ArithReturn – ½σ² (approximation; this computes exact difference)
 * @param {number[]} returns
 * @param {number} periodsPerYear
 * @returns {{ cagr: number, arith: number, tax: number, taxPct: number }}
 */
export function volatilityTax(returns, periodsPerYear = 12) {
  const c = cagr(returns, periodsPerYear);
  const a = arithmeticReturn(returns, periodsPerYear);
  const tax = a - c;
  return {
    cagr: c,
    arith: a,
    tax,
    taxPct: a !== 0 ? (tax / Math.abs(a)) * 100 : 0,
  };
}

/**
 * Maximum Drawdown from cumulative return series.
 * @param {number[]} returns - periodic decimal returns
 * @returns {{ maxDrawdown: number, peakIndex: number, troughIndex: number }}
 */
export function maxDrawdown(returns) {
  if (!returns || returns.length === 0) return { maxDrawdown: 0, peakIndex: -1, troughIndex: -1 };
  let peak = 1;
  let maxDD = 0;
  let peakIdx = 0;
  let troughIdx = 0;
  let currentPeakIdx = 0;
  let cumulative = 1;

  for (let i = 0; i < returns.length; i++) {
    cumulative *= (1 + returns[i]);
    if (cumulative > peak) {
      peak = cumulative;
      currentPeakIdx = i;
    }
    const dd = (cumulative - peak) / peak;
    if (dd < maxDD) {
      maxDD = dd;
      peakIdx = currentPeakIdx;
      troughIdx = i;
    }
  }
  return { maxDrawdown: maxDD, peakIndex: peakIdx, troughIndex: troughIdx };
}

/**
 * MAR Ratio = CAGR / |Max Drawdown|
 * The primary geometric efficiency metric.
 * @param {number[]} returns
 * @param {number} periodsPerYear
 * @returns {{ mar: number, cagr: number, maxDD: number }}
 */
export function marRatio(returns, periodsPerYear = 12) {
  const c = cagr(returns, periodsPerYear);
  const { maxDrawdown: dd } = maxDrawdown(returns);
  const absDD = Math.abs(dd);
  return {
    mar: absDD > 0 ? c / absDD : 0,
    cagr: c,
    maxDD: dd,
  };
}

/**
 * Recovery cost: how much gain is needed to recover from a drawdown.
 * Recovery = 1/(1 - loss) - 1
 * @param {number} drawdownPct - decimal (e.g., 0.50 = 50% loss)
 * @returns {{ recoveryNeeded: number, yearsAt8Pct: number }}
 */
export function recoveryCost(drawdownPct) {
  const absDD = Math.abs(drawdownPct);
  const recovery = absDD >= 1 ? Infinity : (1 / (1 - absDD)) - 1;
  const yearsAt8 = Math.log(1 + recovery) / Math.log(1.08);
  return {
    recoveryNeeded: recovery,
    yearsAt8Pct: Math.round(yearsAt8 * 10) / 10,
  };
}

/**
 * Skewness of return series (third standardised moment).
 * @param {number[]} returns
 * @returns {number}
 */
export function skewness(returns) {
  if (!returns || returns.length < 3) return 0;
  const n = returns.length;
  const mean = returns.reduce((s, r) => s + r, 0) / n;
  const m2 = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
  const m3 = returns.reduce((s, r) => s + (r - mean) ** 3, 0) / n;
  if (m2 === 0) return 0;
  return m3 / Math.pow(m2, 1.5);
}

/**
 * Best-to-worst month ratio.
 * Ratio > 1 means right tail extends further than left (positive skew).
 * @param {number[]} returns
 * @returns {{ best: number, worst: number, ratio: number }}
 */
export function bestWorstRatio(returns) {
  if (!returns || returns.length === 0) return { best: 0, worst: 0, ratio: 0 };
  const best = Math.max(...returns);
  const worst = Math.min(...returns);
  return {
    best,
    worst,
    ratio: worst !== 0 ? Math.abs(best / worst) : Infinity,
  };
}

/**
 * Win/loss size ratio.
 * Ratio > 1 means average wins are larger than average losses.
 * @param {number[]} returns
 * @returns {{ avgWin: number, avgLoss: number, ratio: number, winRate: number }}
 */
export function winLossRatio(returns) {
  if (!returns || returns.length === 0) return { avgWin: 0, avgLoss: 0, ratio: 0, winRate: 0 };
  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r < 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r, 0) / losses.length) : 0;
  return {
    avgWin,
    avgLoss,
    ratio: avgLoss > 0 ? avgWin / avgLoss : Infinity,
    winRate: returns.length > 0 ? wins.length / returns.length : 0,
  };
}

/**
 * Sharpe Ratio (for comparison — the industry standard that MAR improves upon).
 * @param {number[]} returns
 * @param {number} riskFreeRate - annual decimal
 * @param {number} periodsPerYear
 * @returns {number}
 */
export function sharpeRatio(returns, riskFreeRate = 0.02, periodsPerYear = 12) {
  const c = cagr(returns, periodsPerYear);
  const vol = annualisedVolatility(returns, periodsPerYear);
  if (vol === 0) return 0;
  return (c - riskFreeRate) / vol;
}

/**
 * Sortino Ratio (downside deviation only).
 * @param {number[]} returns
 * @param {number} riskFreeRate
 * @param {number} periodsPerYear
 * @returns {number}
 */
export function sortinoRatio(returns, riskFreeRate = 0.02, periodsPerYear = 12) {
  const c = cagr(returns, periodsPerYear);
  const rfPeriod = riskFreeRate / periodsPerYear;
  const downside = returns.filter(r => r < rfPeriod);
  if (downside.length === 0) return Infinity;
  const meanDown = downside.reduce((s, r) => s + (r - rfPeriod) ** 2, 0) / returns.length;
  const downDev = Math.sqrt(meanDown) * Math.sqrt(periodsPerYear);
  if (downDev === 0) return 0;
  return (c - riskFreeRate) / downDev;
}

/**
 * Crisis alpha: returns during specified crisis periods vs non-crisis.
 * @param {number[]} returns
 * @param {number[]} crisisIndices - indices of crisis months
 * @returns {{ crisisCagr: number, nonCrisisCagr: number, crisisPctOfTerminal: number }}
 */
export function crisisAlpha(returns, crisisIndices, periodsPerYear = 12) {
  if (!returns || returns.length === 0) return { crisisCagr: 0, nonCrisisCagr: 0, crisisPctOfTerminal: 0 };

  const crisisRets = crisisIndices.map(i => returns[i]).filter(r => r !== undefined);
  const nonCrisisRets = returns.filter((_, i) => !crisisIndices.includes(i));

  const crisisC = cagr(crisisRets, periodsPerYear);
  const nonCrisisC = cagr(nonCrisisRets, periodsPerYear);

  // What % of terminal wealth came from crisis months?
  const fullCumulative = returns.reduce((p, r) => p * (1 + r), 1);
  const nonCrisisCumulative = nonCrisisRets.reduce((p, r) => p * (1 + r), 1);
  const crisisPct = fullCumulative > 0
    ? (1 - nonCrisisCumulative / fullCumulative) * 100
    : 0;

  return { crisisCagr: crisisC, nonCrisisCagr: nonCrisisC, crisisPctOfTerminal: crisisPct };
}

/**
 * Geometric Efficient Frontier blend analysis.
 * Given two return series, compute blended portfolio metrics at each weight increment.
 * @param {number[]} seriesA - returns for asset A (e.g., S&P 500)
 * @param {number[]} seriesB - returns for asset B (e.g., TF Index)
 * @param {number} step - allocation step size (default 0.10 = 10%)
 * @returns {Array<{ weightA: number, weightB: number, cagr: number, maxDD: number, mar: number, skew: number }>}
 */
export function geometricFrontier(seriesA, seriesB, step = 0.10) {
  if (!seriesA || !seriesB || seriesA.length !== seriesB.length) return [];
  const points = [];
  for (let w = 0; w <= 1.0001; w += step) {
    const blendReturns = seriesA.map((rA, i) => w * rA + (1 - w) * seriesB[i]);
    const { mar, cagr: c, maxDD: dd } = marRatio(blendReturns);
    const sk = skewness(blendReturns);
    points.push({
      weightA: Math.round(w * 100),
      weightB: Math.round((1 - w) * 100),
      cagr: c,
      maxDD: dd,
      mar,
      skew: sk,
    });
  }
  return points;
}

/**
 * Compute the percentage of terminal wealth contributed by the top N% of months.
 * @param {number[]} returns
 * @param {number} topPct - e.g., 10 for top 10%
 * @returns {{ pctOfWealth: number, monthCount: number }}
 */
export function rightTailContribution(returns, topPct = 10) {
  if (!returns || returns.length === 0) return { pctOfWealth: 0, monthCount: 0 };
  const n = Math.max(1, Math.round(returns.length * topPct / 100));
  const sorted = [...returns].sort((a, b) => b - a);
  const topIndices = [];
  const topValues = new Set(sorted.slice(0, n));

  // Find indices of top months (handle duplicates)
  const used = new Set();
  for (let i = 0; i < returns.length && topIndices.length < n; i++) {
    if (topValues.has(returns[i]) && !used.has(i)) {
      topIndices.push(i);
      used.add(i);
    }
  }

  const fullCumulative = returns.reduce((p, r) => p * (1 + r), 1);
  const withoutTop = returns.map((r, i) => topIndices.includes(i) ? 0 : r);
  const withoutCumulative = withoutTop.reduce((p, r) => p * (1 + r), 1);
  const pctOfWealth = fullCumulative > 0
    ? (1 - withoutCumulative / fullCumulative) * 100
    : 0;

  return { pctOfWealth, monthCount: n };
}

/**
 * Geometric Health Score (0–100).
 * Combines MAR ratio, positive skew, and drawdown containment into a single score.
 * @param {number[]} returns
 * @returns {{ score: number, grade: string, mar: number, skew: number, maxDD: number, tax: number }}
 */
export function geometricHealth(returns) {
  const { mar, maxDD } = marRatio(returns);
  const sk = skewness(returns);
  const { tax } = volatilityTax(returns);
  const { ratio: wlRatio } = winLossRatio(returns);

  // Score components (each 0–33.3):
  // 1. MAR score: MAR of 0.35+ = full marks
  const marScore = Math.min(33.3, (mar / 0.35) * 33.3);
  // 2. Skew score: positive skew = full marks, negative = penalty
  const skewScore = Math.min(33.3, Math.max(0, (sk + 0.5) / 1.0 * 33.3));
  // 3. Win/loss ratio score: >1.0 = full marks
  const wlScore = Math.min(33.4, (wlRatio / 1.2) * 33.4);

  const score = Math.round(Math.min(100, marScore + skewScore + wlScore));

  let grade;
  if (score >= 80) grade = 'A — Geometrically Excellent';
  else if (score >= 65) grade = 'B — Geometrically Strong';
  else if (score >= 50) grade = 'C — Geometrically Adequate';
  else if (score >= 35) grade = 'D — Geometrically Weak';
  else grade = 'F — Geometrically Dangerous';

  return { score, grade, mar, skew, maxDD, tax };
}

/**
 * Estimate terminal wealth impact of a drawdown.
 * Given a portfolio, what does a drawdown of X% cost in terminal wealth?
 * @param {number} initialCapital
 * @param {number} annualReturn - expected annual return (decimal)
 * @param {number} drawdownPct - decimal (e.g., 0.50)
 * @param {number} recoveryYears - years to recover (if null, computed from recovery formula)
 * @param {number} totalYears - total investment horizon
 * @returns {{ withDD: number, withoutDD: number, destroyedPct: number }}
 */
export function drawdownImpact(initialCapital, annualReturn, drawdownPct, recoveryYears = null, totalYears = 26) {
  const absDD = Math.abs(drawdownPct);
  const recovery = recoveryYears ?? recoveryCost(absDD).yearsAt8Pct;
  const compoundingYears = totalYears - recovery;

  // Portfolio that suffers the drawdown
  const postDDCapital = initialCapital * (1 - absDD);
  const withDD = postDDCapital * Math.pow(1 + annualReturn, compoundingYears);

  // Portfolio that avoids the drawdown entirely
  const withoutDD = initialCapital * Math.pow(1 + annualReturn, totalYears);

  const destroyedPct = withoutDD > 0 ? (1 - withDD / withoutDD) * 100 : 0;

  return { withDD, withoutDD, destroyedPct };
}
