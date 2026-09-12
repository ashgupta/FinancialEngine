/**
 * Modern Portfolio Theory — Mean-Variance Optimization
 * Provides model portfolios along the efficient frontier and recommends
 * an allocation based on user risk tolerance.
 */

// Asset class definitions with historical return/risk estimates (annualized, real)
export const ASSET_CLASSES = [
  { id: 'us_equity',      name: 'US Equities',           ticker: 'VTI',  expectedReturn: 0.07,  volatility: 0.155, color: '#3b82f6' },
  { id: 'intl_equity',    name: 'Int\'l Equities',       ticker: 'VXUS', expectedReturn: 0.065, volatility: 0.165, color: '#8b5cf6' },
  { id: 'us_bonds',       name: 'US Bonds',              ticker: 'BND',  expectedReturn: 0.025, volatility: 0.035, color: '#22c55e' },
  { id: 'real_estate',    name: 'REITs',                 ticker: 'VNQ',  expectedReturn: 0.055, volatility: 0.18,  color: '#f59e0b' },
  { id: 'intl_bonds',     name: 'Int\'l Bonds',          ticker: 'BNDX', expectedReturn: 0.02,  volatility: 0.04,  color: '#06b6d4' },
  { id: 'commodities',    name: 'Commodities',           ticker: 'GSG',  expectedReturn: 0.03,  volatility: 0.20,  color: '#ef4444' },
  { id: 'managed_futures',name: 'Managed Futures (TF)',   ticker: 'DBMF', expectedReturn: 0.075, volatility: 0.145, color: '#f97316',
    note: 'Trend Following / CTA — crisis alpha, positive skew, negative equity correlation' },
  { id: 'tips',           name: 'TIPS',                  ticker: 'VTIP', expectedReturn: 0.02,  volatility: 0.045, color: '#14b8a6' },
  { id: 'cash',           name: 'Cash / Money Market',   ticker: 'VMFXX',expectedReturn: 0.01,  volatility: 0.005, color: '#94a3b8' },
];

// Simplified correlation matrix (symmetric, same order as ASSET_CLASSES)
const CORR = [
//  USEq   IntEq  USBnd  REIT   IntBnd  Comm  MgdFut TIPS  Cash
  [ 1.00,  0.80,  -0.05, 0.60,  0.00,   0.15, -0.10, 0.05, 0.00], // US Eq
  [ 0.80,  1.00,  -0.03, 0.55,  0.05,   0.20, -0.08, 0.05, 0.00], // Intl Eq
  [-0.05, -0.03,   1.00, 0.15,  0.70,   0.00,  0.05, 0.80, 0.10], // US Bonds
  [ 0.60,  0.55,   0.15, 1.00,  0.10,   0.25, -0.05, 0.15, 0.00], // REITs
  [ 0.00,  0.05,   0.70, 0.10,  1.00,   0.05,  0.05, 0.65, 0.10], // Intl Bonds
  [ 0.15,  0.20,   0.00, 0.25,  0.05,   1.00,  0.10, 0.20, 0.00], // Commodities
  [-0.10, -0.08,   0.05,-0.05,  0.05,   0.10,  1.00, 0.05, 0.00], // Managed Futures
  [ 0.05,  0.05,   0.80, 0.15,  0.65,   0.20,  0.05, 1.00, 0.10], // TIPS
  [ 0.00,  0.00,   0.10, 0.00,  0.10,   0.00,  0.00, 0.10, 1.00], // Cash
];

function portfolioReturn(weights) {
  return weights.reduce((sum, w, i) => sum + w * ASSET_CLASSES[i].expectedReturn, 0);
}

function portfolioVolatility(weights) {
  const n = weights.length;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      variance += weights[i] * weights[j] * ASSET_CLASSES[i].volatility * ASSET_CLASSES[j].volatility * CORR[i][j];
    }
  }
  return Math.sqrt(variance);
}

function sharpeRatio(weights, riskFreeRate = 0.01) {
  const ret = portfolioReturn(weights);
  const vol = portfolioVolatility(weights);
  return vol === 0 ? 0 : (ret - riskFreeRate) / vol;
}

/**
 * MAR Ratio = CAGR / |Max Drawdown|
 * Estimates max drawdown from volatility (rough approximation for forward-looking use).
 * For historical series, use geometric.marRatio() instead.
 */
function marRatio(weights) {
  const ret = portfolioReturn(weights);
  const vol = portfolioVolatility(weights);
  // Approximate max DD from volatility: ~2x annual vol for diversified portfolios
  const estMaxDD = Math.min(0.95, vol * 2.2);
  return estMaxDD > 0 ? ret / estMaxDD : 0;
}

/**
 * Volatility Tax estimate: ½σ²
 */
function volatilityTaxEstimate(weights) {
  const vol = portfolioVolatility(weights);
  return 0.5 * vol * vol;
}

/**
 * Risk tolerance: 1 (very conservative) to 10 (very aggressive)
 * Returns an allocation object.
 */
export function getRecommendedAllocation(riskTolerance) {
  // Pre-built model portfolios mapped to risk levels 1–10
  // Order: US Eq, Intl Eq, US Bonds, REITs, Intl Bonds, Commodities, Managed Futures, TIPS, Cash
  const models = {
    1:  [0.05, 0.00, 0.35, 0.00, 0.10, 0.00, 0.15, 0.15, 0.20],
    2:  [0.10, 0.05, 0.30, 0.00, 0.10, 0.00, 0.15, 0.15, 0.15],
    3:  [0.15, 0.10, 0.25, 0.05, 0.10, 0.00, 0.15, 0.10, 0.10],
    4:  [0.20, 0.10, 0.25, 0.05, 0.10, 0.05, 0.15, 0.05, 0.05],
    5:  [0.25, 0.15, 0.20, 0.05, 0.05, 0.05, 0.15, 0.05, 0.05],
    6:  [0.30, 0.15, 0.15, 0.10, 0.05, 0.05, 0.15, 0.05, 0.00],
    7:  [0.35, 0.20, 0.10, 0.10, 0.05, 0.05, 0.10, 0.05, 0.00],
    8:  [0.40, 0.20, 0.05, 0.10, 0.05, 0.05, 0.10, 0.05, 0.00],
    9:  [0.45, 0.25, 0.00, 0.10, 0.00, 0.05, 0.10, 0.05, 0.00],
    10: [0.50, 0.25, 0.00, 0.10, 0.00, 0.05, 0.10, 0.00, 0.00],
  };

  const weights = models[riskTolerance] || models[5];
  const ret = portfolioReturn(weights);
  const vol = portfolioVolatility(weights);
  const sharpe = sharpeRatio(weights);
  const mar = marRatio(weights);
  const volTax = volatilityTaxEstimate(weights);
  const geometricReturn = ret - volTax;

  const allocation = weights.map((w, i) => ({
    ...ASSET_CLASSES[i],
    weight: w,
  })).filter((a) => a.weight > 0);

  return { allocation, expectedReturn: ret, volatility: vol, sharpe, mar, volatilityTax: volTax, geometricReturn };
}

/**
 * Generate efficient frontier points.
 */
export function getEfficientFrontier() {
  const points = [];
  for (let risk = 1; risk <= 10; risk++) {
    const { expectedReturn, volatility, sharpe, mar, volatilityTax, geometricReturn } = getRecommendedAllocation(risk);
    points.push({
      risk,
      expectedReturn: +(expectedReturn * 100).toFixed(2),
      volatility: +(volatility * 100).toFixed(2),
      sharpe: +sharpe.toFixed(3),
      mar: +mar.toFixed(3),
      volatilityTax: +(volatilityTax * 100).toFixed(2),
      geometricReturn: +(geometricReturn * 100).toFixed(2),
    });
  }
  return points;
}
