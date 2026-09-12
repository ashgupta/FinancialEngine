/**
 * LEAPS Analyzer — pure engine.
 *
 * Decomposes the price of a (typically deep-ITM) LEAPS call into its
 * economic components so a user can see WHY a long-dated option costs what
 * it does — and specifically why a low spot VIX does NOT make LEAPS cheap.
 *
 * A deep-ITM European call can be approximated as:
 *
 *   C  =  S·e^(-qT)·N(d1)  -  K·e^(-rT)·N(d2)
 *
 * For a deep-ITM call (N(d1) ≈ N(d2) ≈ 1) this collapses to:
 *
 *   C  ≈  (S - K)                 // intrinsic
 *        + K·(1 - e^(-rT))        // interest carry  (you defer paying K)
 *        - S·(1 - e^(-qT))        // dividend drag   (dividends you forgo)
 *        + volatilityPremium      // residual optionality value
 *
 * So the "extrinsic" (time) value of a LEAPS is mostly a RATE story
 * (interest carry) plus a modest VOLATILITY story — not the 30-day VIX.
 *
 * Formula source: Black-Scholes-Merton (1973) with continuous dividend
 * yield q. Reference: Hull, "Options, Futures, and Other Derivatives",
 * 10th ed., Ch. 15-17.
 *
 * All monetary outputs are PER SHARE unless a field name says otherwise.
 * A standard US equity option contract controls 100 shares.
 */

const CONTRACT_MULTIPLIER = 100;

// ── Math helpers ────────────────────────────────────────────
function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.sqrt(2)));

/**
 * Black-Scholes-Merton price of a European call with continuous dividend yield.
 * @returns {number} call price per share
 */
export function bsCallPrice(S, K, T, r, q, sigma) {
  if (!(S > 0) || !(K > 0)) return NaN;
  if (T <= 0) return Math.max(0, S - K);
  if (sigma <= 0) return Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T));
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

/**
 * Black-Scholes-Merton delta of a European call with continuous dividend yield.
 * @returns {number} delta in [0, 1]
 */
export function bsCallDelta(S, K, T, r, q, sigma) {
  if (!(S > 0) || !(K > 0)) return NaN;
  if (T <= 0) return S > K ? 1 : 0;
  if (sigma <= 0) return S * Math.exp(-q * T) > K * Math.exp(-r * T) ? 1 : 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  return Math.exp(-q * T) * normCdf(d1);
}

/**
 * Back-solve the implied volatility of a call from its market price via
 * bisection. Returns null if the price is outside no-arbitrage bounds.
 * @returns {number|null} implied volatility (decimal) or null
 */
export function impliedVolCall(marketPrice, S, K, T, r, q) {
  if (!(marketPrice > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;
  const intrinsicPV = Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T));
  const upperBound = S * Math.exp(-q * T); // price at sigma → ∞
  if (marketPrice < intrinsicPV - 1e-6 || marketPrice > upperBound + 1e-6) return null;

  let lo = 1e-4, hi = 5.0;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const price = bsCallPrice(S, K, T, r, q, mid);
    if (Math.abs(price - marketPrice) < 1e-6) return mid;
    if (price > marketPrice) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * @typedef {Object} LeapsAnalysis
 * @property {number} spot
 * @property {number} strike
 * @property {number} premium            per-share option price
 * @property {number} dte                days to expiry
 * @property {number} years              dte / 365
 * @property {number} riskFreeRate
 * @property {number} dividendYield
 * @property {number} intrinsic          per-share intrinsic value
 * @property {number} extrinsic          per-share time value (premium - intrinsic)
 * @property {number} interestCarry      per-share benefit of deferring the strike
 * @property {number} dividendDrag       per-share dividends forgone (negative contribution)
 * @property {number} netCarry           interestCarry - dividendDrag
 * @property {number} volatilityPremium  extrinsic - netCarry (residual, optionality)
 * @property {number|null} impliedVol    back-solved IV of this contract
 * @property {number|null} delta         BS delta at the implied vol
 * @property {number} moneyness          strike / spot
 * @property {number} breakeven          strike + premium (at expiry)
 */

/**
 * Decompose a LEAPS call price into intrinsic / carry / dividend / vol components.
 * @param {Object} p
 * @param {number} p.spot           underlying price
 * @param {number} p.strike         option strike
 * @param {number} p.premium        option price per share (mid)
 * @param {number} p.dte            days to expiry
 * @param {number} [p.riskFreeRate] annualized, decimal (default 0.043)
 * @param {number} [p.dividendYield] annualized, decimal (default 0)
 * @returns {LeapsAnalysis}
 */
export function analyzeLeapsCall({ spot, strike, premium, dte, riskFreeRate = 0.043, dividendYield = 0 }) {
  const S = spot, K = strike;
  const T = Math.max(dte, 0) / 365;
  const r = riskFreeRate, q = dividendYield;

  const intrinsic = Math.max(0, S - K);
  const extrinsic = premium - intrinsic;
  const interestCarry = K * (1 - Math.exp(-r * T));
  const dividendDrag = S * (1 - Math.exp(-q * T));
  const netCarry = interestCarry - dividendDrag;
  const volatilityPremium = extrinsic - netCarry;

  const impliedVol = impliedVolCall(premium, S, K, T, r, q);
  const delta = impliedVol != null ? bsCallDelta(S, K, T, r, q, impliedVol) : null;

  return {
    spot: S, strike: K, premium, dte, years: T,
    riskFreeRate: r, dividendYield: q,
    intrinsic, extrinsic, interestCarry, dividendDrag, netCarry, volatilityPremium,
    impliedVol, delta,
    moneyness: S > 0 ? K / S : NaN,
    breakeven: K + premium,
  };
}

/**
 * @typedef {Object} LeapsVsShares
 * @property {number} contracts
 * @property {number} shares                     contracts × 100
 * @property {number} shareCapital               capital to buy the equivalent shares
 * @property {number} leapsCapital               capital to buy the LEAPS
 * @property {number} capitalFreed               shareCapital - leapsCapital
 * @property {number} capitalEfficiency          leapsCapital / shareCapital
 * @property {number} maxLoss                     total premium at risk (LEAPS)
 * @property {number} freedCapitalIncome          annual income on freed capital
 * @property {number} freedCapitalIncomeOverLife  income over the option's life
 * @property {number} dividendsForgone            total dividends forgone over life
 * @property {number} financingCost               total interest carry cost over life
 * @property {number} netCarryCost                financingCost - freedCapitalIncomeOverLife
 * @property {number} volatilityCost              total vol premium paid (the "insurance")
 * @property {number} volatilityCostPct           volatilityCost / shareCapital
 * @property {number} deltaExposure               share-equivalent exposure of the LEAPS
 * @property {number} breakeven                   underlying price to break even at expiry
 */

/**
 * Compare a LEAPS stock-replacement against holding the equivalent shares.
 * @param {Object} p
 * @param {number} p.spot
 * @param {number} p.strike
 * @param {number} p.premium        per-share option price
 * @param {number} p.dte
 * @param {number} [p.contracts]    number of contracts (default 1)
 * @param {number} [p.riskFreeRate]
 * @param {number} [p.dividendYield]
 * @param {number} [p.freedCapitalYield] yield earned on freed capital (default = riskFreeRate)
 * @returns {LeapsAnalysis & { comparison: LeapsVsShares }}
 */
export function compareLeapsVsShares({
  spot, strike, premium, dte, contracts = 1,
  riskFreeRate = 0.043, dividendYield = 0, freedCapitalYield,
}) {
  const analysis = analyzeLeapsCall({ spot, strike, premium, dte, riskFreeRate, dividendYield });
  const yieldOnCash = freedCapitalYield != null ? freedCapitalYield : riskFreeRate;
  const T = analysis.years;

  const shares = contracts * CONTRACT_MULTIPLIER;
  const shareCapital = shares * spot;
  const leapsCapital = contracts * premium * CONTRACT_MULTIPLIER;
  const capitalFreed = shareCapital - leapsCapital;
  const capitalEfficiency = shareCapital > 0 ? leapsCapital / shareCapital : NaN;

  const maxLoss = leapsCapital;
  const freedCapitalIncome = capitalFreed * yieldOnCash;
  const freedCapitalIncomeOverLife = freedCapitalIncome * T;
  const dividendsForgone = analysis.dividendDrag * shares;
  const financingCost = analysis.interestCarry * shares;
  const netCarryCost = financingCost - freedCapitalIncomeOverLife;
  const volatilityCost = analysis.volatilityPremium * shares;
  const volatilityCostPct = shareCapital > 0 ? volatilityCost / shareCapital : NaN;
  const deltaExposure = analysis.delta != null ? analysis.delta * shares : null;

  return {
    ...analysis,
    comparison: {
      contracts, shares, shareCapital, leapsCapital, capitalFreed, capitalEfficiency,
      maxLoss, freedCapitalIncome, freedCapitalIncomeOverLife,
      dividendsForgone, financingCost, netCarryCost,
      volatilityCost, volatilityCostPct, deltaExposure,
      breakeven: analysis.breakeven,
    },
  };
}

/**
 * From an options chain, pick the ITM call whose BS delta is closest to a
 * target (e.g. 0.80 for stock replacement).
 * @param {Object[]} calls   chain calls with { strike, bid, ask, lastPrice, impliedVolatility }
 * @param {number} spot
 * @param {number} dte
 * @param {number} [targetDelta]
 * @param {number} [riskFreeRate]
 * @param {number} [dividendYield]
 * @returns {{ contract:object, premium:number, delta:number }|null}
 */
export function pickStockReplacementStrike(calls, spot, dte, targetDelta = 0.80, riskFreeRate = 0.043, dividendYield = 0) {
  if (!Array.isArray(calls) || calls.length === 0 || !(spot > 0)) return null;
  const T = Math.max(dte, 1) / 365;
  let best = null;
  for (const c of calls) {
    const premium = midPrice(c);
    if (!(premium > 0) || !(c.strike > 0)) continue;
    const iv = c.impliedVolatility > 0 ? c.impliedVolatility : impliedVolCall(premium, spot, c.strike, T, riskFreeRate, dividendYield);
    if (iv == null || !(iv > 0)) continue;
    const delta = bsCallDelta(spot, c.strike, T, riskFreeRate, dividendYield, iv);
    if (delta == null || Number.isNaN(delta)) continue;
    const fit = Math.abs(delta - targetDelta);
    if (!best || fit < best.fit) best = { contract: c, premium, delta, fit };
  }
  if (!best) return null;
  return { contract: best.contract, premium: best.premium, delta: best.delta };
}

/** Mid price helper; falls back to last price. */
export function midPrice(c) {
  if (!c) return 0;
  if (c.bid > 0 && c.ask > 0) return (c.bid + c.ask) / 2;
  return c.lastPrice || 0;
}

export { CONTRACT_MULTIPLIER };
