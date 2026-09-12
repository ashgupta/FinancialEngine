// Box-Muller transform for normal random variates
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Run a Monte Carlo simulation of portfolio growth with drawdown tracking.
 * @param {object} params
 * @param {number} params.initialWealth - Starting portfolio value
 * @param {number} params.annualContribution - Yearly contribution
 * @param {number} params.expectedReturn - Expected annual return (decimal, e.g. 0.07)
 * @param {number} params.volatility - Annual standard deviation (decimal, e.g. 0.15)
 * @param {number} params.years - Investment horizon
 * @param {number} params.simulations - Number of simulation paths (default 1000)
 * @param {number} params.inflationRate - Annual inflation rate (decimal, default 0.03)
 * @returns {{
 *   percentiles: {p10:number[], p25:number[], p50:number[], p75:number[], p90:number[]},
 *   mean:number[],
 *   finalValues:number[],
 *   drawdowns: {p10:number, p25:number, p50:number, p75:number, p90:number, worst:number},
 *   marRatios: {p10:number, p25:number, p50:number, p75:number, p90:number},
 *   ruinProb: number
 * }}
 */
export function runMonteCarlo({
  initialWealth,
  annualContribution,
  expectedReturn,
  volatility,
  years,
  simulations = 1000,
  inflationRate = 0.03,
}) {
  const paths = [];
  const finalValues = [];
  const maxDrawdowns = [];
  const pathMARs = [];
  let ruinCount = 0;

  for (let s = 0; s < simulations; s++) {
    const path = [initialWealth];
    let value = initialWealth;
    let peak = initialWealth;
    let maxDD = 0;

    for (let y = 1; y <= years; y++) {
      const r = expectedReturn + volatility * randn();
      value = value * (1 + r) + annualContribution;
      // Deflate by inflation to get real value
      const realValue = value / Math.pow(1 + inflationRate, y);
      const clamped = Math.max(0, realValue);
      path.push(clamped);

      // Track drawdown
      if (clamped > peak) peak = clamped;
      const dd = peak > 0 ? (clamped - peak) / peak : 0;
      if (dd < maxDD) maxDD = dd;
    }

    paths.push(path);
    finalValues.push(path[years]);

    // Track max drawdown for this path
    maxDrawdowns.push(maxDD);

    // MAR ratio for this path
    const finalVal = path[years];
    const pathCAGR = years > 0 ? Math.pow(finalVal / initialWealth, 1 / years) - 1 : 0;
    const pathMAR = Math.abs(maxDD) > 0 ? pathCAGR / Math.abs(maxDD) : 0;
    pathMARs.push(pathMAR);

    // Ruin: final value < 50% of initial (geometric destruction)
    if (finalVal < initialWealth * 0.5) ruinCount++;
  }

  // Compute percentiles per year
  const percentiles = { p10: [], p25: [], p50: [], p75: [], p90: [] };
  const mean = [];

  for (let y = 0; y <= years; y++) {
    const vals = paths.map((p) => p[y]).sort((a, b) => a - b);
    const n = vals.length;
    percentiles.p10.push(Math.round(vals[Math.floor(n * 0.1)]));
    percentiles.p25.push(Math.round(vals[Math.floor(n * 0.25)]));
    percentiles.p50.push(Math.round(vals[Math.floor(n * 0.5)]));
    percentiles.p75.push(Math.round(vals[Math.floor(n * 0.75)]));
    percentiles.p90.push(Math.round(vals[Math.floor(n * 0.9)]));
    mean.push(Math.round(vals.reduce((a, b) => a + b, 0) / n));
  }

  finalValues.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);
  pathMARs.sort((a, b) => a - b);

  const n = maxDrawdowns.length;
  const ddPct = (arr, p) => arr[Math.floor(n * p)];

  return {
    percentiles,
    mean,
    finalValues,
    drawdowns: {
      p10: ddPct(maxDrawdowns, 0.1),
      p25: ddPct(maxDrawdowns, 0.25),
      p50: ddPct(maxDrawdowns, 0.5),
      p75: ddPct(maxDrawdowns, 0.75),
      p90: ddPct(maxDrawdowns, 0.9),
      worst: maxDrawdowns[0],
    },
    marRatios: {
      p10: ddPct(pathMARs, 0.1),
      p25: ddPct(pathMARs, 0.25),
      p50: ddPct(pathMARs, 0.5),
      p75: ddPct(pathMARs, 0.75),
      p90: ddPct(pathMARs, 0.9),
    },
    ruinProb: ruinCount / simulations,
  };
}
