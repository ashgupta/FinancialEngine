/**
 * Strategy Evaluator.
 *
 * Given a user-built multi-leg strategy (stock + option legs), compute:
 *   - Max profit / max loss / breakeven(s)
 *   - Net debit/credit
 *   - Probability of profit (Black-Scholes lognormal)
 *   - Greeks summary (delta, theta, vega, gamma — approximate)
 *   - Position-sizing recommendation (% of account based on risk tolerance)
 *   - Fit-to-risk-profile score (0–100)
 *
 * Leg shape:
 *   {
 *     kind:        'stock' | 'call' | 'put',
 *     side:        'long' | 'short',
 *     quantity:    number,       // shares for stock, contracts for options (×100 mult)
 *     strike?:     number,       // options only
 *     premium?:    number,       // options only — price per share
 *     entryPrice?: number,       // stock only
 *     iv?:         number,       // implied volatility, decimal (e.g. 0.30)
 *     dte?:        number,       // days to expiry, options only
 *   }
 */

import { probPayoffPositive, expectedPayoff } from './impliedDistribution.js';

// ── Math helpers ────────────────────────────────────────────
function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741,
        a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5*t + a4)*t + a3)*t + a2)*t + a1)*t * Math.exp(-x*x);
  return sign * y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.sqrt(2)));
const normPdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** Lognormal probability that price at expiry is ≥ K, given S, sigma, T years */
function probAbove(S, K, sigma, T, r = 0.04) {
  if (T <= 0 || sigma <= 0) return S >= K ? 1 : 0;
  const d2 = (Math.log(S / K) + (r - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normCdf(d2);
}

// ── Payoff math ─────────────────────────────────────────────
function legPayoff(leg, priceAtExpiry) {
  const sign = leg.side === 'long' ? 1 : -1;
  const qty = leg.quantity;
  if (leg.kind === 'stock') {
    return sign * qty * (priceAtExpiry - (leg.entryPrice ?? 0));
  }
  const intrinsic = leg.kind === 'call'
    ? Math.max(0, priceAtExpiry - leg.strike)
    : Math.max(0, leg.strike - priceAtExpiry);
  const premium = leg.premium ?? 0;
  // P/L per contract = (intrinsic - premium) * 100 * sign
  return sign * qty * 100 * (intrinsic - premium);
}

function totalPayoffAt(legs, price) {
  return legs.reduce((s, l) => s + legPayoff(l, price), 0);
}

/** Net debit (positive) or credit (negative) to open the strategy. */
function netDebit(legs) {
  let total = 0;
  for (const l of legs) {
    if (l.kind === 'stock') {
      total += (l.side === 'long' ? 1 : -1) * l.quantity * (l.entryPrice ?? 0);
    } else {
      total += (l.side === 'long' ? 1 : -1) * l.quantity * 100 * (l.premium ?? 0);
    }
  }
  return total;
}

// ── Black-Scholes Greeks (option only) ──────────────────────
function bsGreeks(leg, spotPrice) {
  if (leg.kind === 'stock') {
    return { delta: leg.side === 'long' ? leg.quantity : -leg.quantity, gamma: 0, theta: 0, vega: 0 };
  }
  const S = spotPrice, K = leg.strike, sigma = leg.iv ?? 0.30,
        T = Math.max(1/365, (leg.dte ?? 30) / 365), r = 0.04;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const sign = leg.side === 'long' ? 1 : -1;
  const mult = sign * leg.quantity * 100;

  const callDelta = normCdf(d1);
  const putDelta  = callDelta - 1;
  const delta = (leg.kind === 'call' ? callDelta : putDelta) * mult;
  const gamma = (normPdf(d1) / (S * sigma * Math.sqrt(T))) * mult;
  const vega  = (S * normPdf(d1) * Math.sqrt(T) / 100) * mult; // per 1 vol point
  const callTheta = -(S * normPdf(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normCdf(d2);
  const putTheta  = -(S * normPdf(d1) * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * normCdf(-d2);
  const theta = ((leg.kind === 'call' ? callTheta : putTheta) / 365) * mult;
  return { delta, gamma, theta, vega };
}

// ── Find max/min over a price grid ──────────────────────────
function findExtremesAndBreakevens(legs, spotPrice) {
  const strikes = legs.filter(l => l.kind !== 'stock').map(l => l.strike);
  const center = spotPrice ?? (strikes.length ? strikes.reduce((a, b) => a + b, 0) / strikes.length : 100);
  const minPrice = 0;
  const maxPrice = center * 3;
  const steps = 600;
  const dx = (maxPrice - minPrice) / steps;

  let maxProfit = -Infinity, maxLoss = Infinity;
  let priceAtMax = null, priceAtMin = null;
  const breakevens = [];
  let prevSign = null, prevPL = null, prevX = null;

  for (let i = 0; i <= steps; i++) {
    const x = minPrice + i * dx;
    const pl = totalPayoffAt(legs, x);
    if (pl > maxProfit) { maxProfit = pl; priceAtMax = x; }
    if (pl < maxLoss)   { maxLoss = pl; priceAtMin = x; }
    if (prevSign !== null && prevPL !== null && Math.sign(pl) !== prevSign && Math.sign(pl) !== 0) {
      // linear-interp breakeven between prevX and x
      const t = -prevPL / (pl - prevPL);
      breakevens.push(prevX + t * dx);
    }
    if (pl !== 0) prevSign = Math.sign(pl);
    prevPL = pl;
    prevX = x;
  }

  // Distinguish unbounded vs bounded
  const upperPL = totalPayoffAt(legs, maxPrice);
  const lowerPL = totalPayoffAt(legs, minPrice);
  const isUpperUnbounded = upperPL > maxProfit * 0.95 && upperPL > 0;
  const isLowerUnbounded = lowerPL > maxProfit * 0.95 && lowerPL > 0;
  const isLossUnbounded = upperPL < maxLoss * 0.95 || lowerPL < maxLoss * 0.95;

  return {
    maxProfit: isUpperUnbounded || isLowerUnbounded ? Infinity : maxProfit,
    maxLoss: isLossUnbounded ? -Infinity : maxLoss,
    priceAtMaxProfit: priceAtMax,
    priceAtMaxLoss: priceAtMin,
    breakevens: [...new Set(breakevens.map(b => +b.toFixed(2)))],
  };
}

// ── Probability of profit ───────────────────────────────────
function probabilityOfProfit(legs, spotPrice) {
  // Use shortest-dated option's IV / DTE as proxy
  const optLegs = legs.filter(l => l.kind !== 'stock');
  if (!optLegs.length || !spotPrice) return null;
  const shortest = [...optLegs].sort((a, b) => (a.dte ?? 9999) - (b.dte ?? 9999))[0];
  const sigma = shortest.iv ?? 0.30;
  const T = Math.max(1/365, (shortest.dte ?? 30) / 365);

  // Monte Carlo over expiry-price distribution
  const N = 5000;
  const r = 0.04;
  let wins = 0;
  for (let i = 0; i < N; i++) {
    // Box-Muller for std normal
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random();
    while (u2 === 0) u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const ST = spotPrice * Math.exp((r - 0.5 * sigma * sigma) * T + sigma * Math.sqrt(T) * z);
    if (totalPayoffAt(legs, ST) > 0) wins++;
  }
  return wins / N;
}

// ── Position sizing & fit score ─────────────────────────────
function maxRiskPctOfAccount(riskTolerance) {
  // Risk 1 → 0.5% per trade ; Risk 10 → 5% per trade
  return 0.005 + (riskTolerance - 1) * 0.005;
}

function fitScore({ legs, maxLoss, maxProfit, pop, riskTolerance, accountValue }) {
  let score = 50;
  // Defined-risk strategies score better at all risk levels
  if (maxLoss !== -Infinity) score += 15;
  if (maxLoss === -Infinity) score -= 30; // naked short = bad
  // PoP
  if (pop != null) {
    if (pop > 0.65) score += 15;
    else if (pop > 0.50) score += 5;
    else if (pop < 0.35) score -= 15;
  }
  // Risk vs account size
  if (accountValue > 0 && maxLoss !== -Infinity) {
    const lossPct = Math.abs(maxLoss) / accountValue;
    const limit = maxRiskPctOfAccount(riskTolerance);
    if (lossPct > limit * 2)      score -= 25;
    else if (lossPct > limit)     score -= 10;
    else if (lossPct < limit / 2) score += 5;
  }
  // R:R ratio
  if (maxProfit !== Infinity && maxLoss !== -Infinity && maxLoss < 0) {
    const rr = maxProfit / Math.abs(maxLoss);
    if (rr > 2) score += 10;
    else if (rr < 0.5) score -= 10;
  }
  return Math.max(0, Math.min(100, score));
}

function sizingRecommendation({ maxLoss, riskTolerance, accountValue }) {
  if (accountValue <= 0 || maxLoss === -Infinity || maxLoss === 0) {
    return { contracts: null, dollarsAtRisk: null, note: 'Cannot size — undefined risk or no account value.' };
  }
  const maxRiskDollars = accountValue * maxRiskPctOfAccount(riskTolerance);
  // Single-contract loss equivalent
  const lossPerUnit = Math.abs(maxLoss);
  const units = lossPerUnit > 0 ? Math.floor(maxRiskDollars / lossPerUnit) : 0;
  return {
    contracts: units,
    dollarsAtRisk: Math.round(units * lossPerUnit),
    maxRiskBudget: Math.round(maxRiskDollars),
    note: `At your risk tolerance ${riskTolerance}/10, allocate up to ${(maxRiskPctOfAccount(riskTolerance) * 100).toFixed(1)}% per trade.`,
  };
}

// ── Public entry point ──────────────────────────────────────
/**
 * @param {Object} params
 * @param {Array} params.legs - strategy legs
 * @param {number} params.spotPrice - current underlying price
 * @param {number} params.riskTolerance - 1–10
 * @param {number} params.accountValue
 * @param {object|null} [params.distribution]  options-implied distribution for the
 *   shortest leg's expiry (impliedDistribution.buildImpliedDistribution). When
 *   supplied, PoP and expected value are integrated over that density instead
 *   of the single-vol lognormal Monte Carlo.
 */
export function evaluateStrategy({ legs, spotPrice, riskTolerance = 5, accountValue = 0, distribution = null }) {
  if (!Array.isArray(legs) || legs.length === 0) {
    return { valid: false, error: 'No legs supplied.' };
  }

  const netCost = netDebit(legs); // positive = debit, negative = credit
  const extremes = findExtremesAndBreakevens(legs, spotPrice);
  const greeks = legs.reduce((acc, l) => {
    const g = bsGreeks(l, spotPrice);
    acc.delta += g.delta; acc.gamma += g.gamma; acc.theta += g.theta; acc.vega += g.vega;
    return acc;
  }, { delta: 0, gamma: 0, theta: 0, vega: 0 });

  const dist = distribution?.grid?.length ? distribution : null;
  const payoff = (S) => totalPayoffAt(legs, S);
  const pop = dist ? probPayoffPositive(dist, payoff) : probabilityOfProfit(legs, spotPrice);
  const expectedValue = dist ? expectedPayoff(dist, payoff) : null;
  const fit = fitScore({
    legs, maxLoss: extremes.maxLoss, maxProfit: extremes.maxProfit,
    pop, riskTolerance, accountValue,
  });
  const sizing = sizingRecommendation({
    maxLoss: extremes.maxLoss, riskTolerance, accountValue,
  });

  // Generate payoff curve points for plotting
  const center = spotPrice ?? 100;
  const payoffCurve = [];
  for (let i = 0; i <= 100; i++) {
    const x = center * 0.5 + (center * 1.0) * (i / 100);
    payoffCurve.push({ price: +x.toFixed(2), pnl: +totalPayoffAt(legs, x).toFixed(2) });
  }

  return {
    valid: true,
    netCost,
    isDebit: netCost > 0,
    maxProfit: extremes.maxProfit,
    maxLoss: extremes.maxLoss,
    breakevens: extremes.breakevens,
    probabilityOfProfit: pop,
    popMethod: dist ? 'implied' : 'lognormal',
    expectedValue,
    distributionShape: dist?.shape ?? null,
    greeks: {
      delta: +greeks.delta.toFixed(2),
      gamma: +greeks.gamma.toFixed(4),
      theta: +greeks.theta.toFixed(2),
      vega:  +greeks.vega.toFixed(2),
    },
    fitScore: fit,
    fitColor: fit >= 70 ? 'green' : fit >= 45 ? 'yellow' : 'red',
    sizing,
    payoffCurve,
  };
}
