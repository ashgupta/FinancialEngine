/**
 * Vertical option-spread analyzer.
 *
 * Given a fetched options chain, enumerates every viable two-strike vertical
 * spread of a chosen type, computes its risk/reward profile, and ranks the
 * candidates so the user can see the "best price to buy" — defined by their
 * chosen objective (max risk-reward, max probability of profit, or max
 * expected value).
 *
 * Constitution Principle II: pure functions, no React, no I/O, no DOM.
 *
 * Supported spread types
 *   bull_call  (debit)   long lower-strike call  + short higher-strike call
 *   bear_call  (credit)  short lower-strike call + long  higher-strike call
 *   bull_put   (credit)  short higher-strike put + long  lower-strike put
 *   bear_put   (debit)   long  higher-strike put + short lower-strike put
 *
 * Pricing convention:
 *   - Mid-price ((bid + ask) / 2) is used as the reference fill. Falls back
 *     to lastPrice if bid/ask are zero.
 *   - All P&L numbers are quoted in dollars per contract (× 100 multiplier).
 *
 * Probability of profit:
 *   - Estimated via Black-Scholes-style geometric Brownian motion under the
 *     risk-neutral measure with the short-leg's implied volatility.
 *   - Drift adjusted for dividend yield (cost of carry): mu = r - q.
 *     This matters meaningfully for LEAPS (T >= 1y) on dividend-paying
 *     names — a 2.5% annual yield over 3 years shifts the forward price
 *     by ~7.5% which materially changes break-even probabilities.
 *   - Returns the probability that the underlying ends past the spread's
 *     break-even price at expiry.
 *   - This is an approximation; real PoP depends on the full risk-neutral
 *     distribution, time-varying dividends, and early-exercise risk for
 *     American-style options. Use as a relative ranking signal, not a
 *     guarantee.
 *   - PREFERRED: pass `distribution` (impliedDistribution.buildImpliedDistribution
 *     for the same expiry). PoP, expected value and the probabilities of max
 *     profit / max loss are then integrated over the options-implied
 *     (Breeden–Litzenberger) density, which carries the chain's skew and fat
 *     tails. The lognormal figure is kept as `popLognormal` for comparison.
 *     Under the implied density a fairly priced spread has EV ≈ 0 — a large
 *     positive EV means the spread is cheap relative to the rest of the chain.
 *
 * LEAPS support:
 *   - The analyzer is time-horizon agnostic — daysToExpiry can be any
 *     positive number. For LEAPS (T >= ~365d) the dividend-adjusted drift
 *     becomes important; pass dividendYield to enable that adjustment.
 *   - See isLeaps() and formatDTE() helpers for UI categorisation.
 */

import { probPayoffPositive, expectedPayoff } from './impliedDistribution.js';

// ── Math helpers ──────────────────────────────────────────────────────────

/**
 * Standard normal CDF via Abramowitz & Stegun 26.2.17 approximation.
 * Max error: ~1.5e-7.
 */
function normalCdf(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}

/**
 * Probability that S_T crosses a target price under GBM.
 * @param {number} spot
 * @param {number} target  Break-even price
 * @param {number} sigma   Annualised IV (e.g. 0.30 for 30%)
 * @param {number} T       Time in years (days/365)
 * @param {'above'|'below'} direction
 * @param {number} r       Risk-free rate (annualised)
 * @returns {number}       Probability ∈ [0,1]
 */
function probabilityCrosses(spot, target, sigma, T, direction, r = 0.045, q = 0) {
  if (sigma <= 0 || T <= 0 || spot <= 0 || target <= 0) return null;
  // Dividend-adjusted drift under the risk-neutral measure: mu = r - q.
  // For 30d options this is ~0; for 2y LEAPS on a 3%-yield stock,
  // q*T = 0.06 shifts d by a measurable amount.
  const drift = (r - q - 0.5 * sigma * sigma) * T;
  const stdev = sigma * Math.sqrt(T);
  if (stdev === 0) return null;
  const d = (Math.log(spot / target) + drift) / stdev;
  return direction === 'above' ? normalCdf(d) : normalCdf(-d);
}

/**
 * Conventional LEAPS classifier. Industry convention: any option with
 * at least ~9 months to expiry is commonly traded as a LEAPS. We use
 * 270 days as the threshold (≈9 months) since CBOE historically
 * issues LEAPS in January with up to 39 months of life.
 * @param {number} daysToExpiry
 * @returns {boolean}
 */
export function isLeaps(daysToExpiry) {
  return daysToExpiry >= 270;
}

/**
 * Human-friendly DTE label. Short-dated stays in days; >= 1 year shows
 * years with one decimal so 760d → "2.1y".
 * @param {number} daysToExpiry
 * @returns {string}
 */
export function formatDTE(daysToExpiry) {
  if (!Number.isFinite(daysToExpiry) || daysToExpiry < 0) return '—';
  if (daysToExpiry < 365) return `${Math.round(daysToExpiry)}d`;
  const years = daysToExpiry / 365;
  return `${years.toFixed(1)}y`;
}

/**
 * Categorise an expiry for UI grouping.
 * @param {number} daysToExpiry
 * @returns {'weekly'|'monthly'|'quarterly'|'leaps'}
 */
export function expiryCategory(daysToExpiry) {
  if (daysToExpiry <= 14)  return 'weekly';
  if (daysToExpiry <= 60)  return 'monthly';
  if (daysToExpiry < 270)  return 'quarterly';
  return 'leaps';
}

const MAX_DIST_DTE_MISMATCH = 3; // days — a distribution from another expiry is not used
const TAIL_EPS = 1e-6;            // $/share tolerance when testing "at max profit/loss"

const midPrice = (c) => {
  const bid = c.bid ?? 0;
  const ask = c.ask ?? 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return c.lastPrice ?? 0;
};

const liquidityScore = (c) => (c.volume ?? 0) + (c.openInterest ?? 0);

const hasTwoSidedQuote = (c) => (c.bid ?? 0) > 0 && (c.ask ?? 0) > 0 && c.ask >= c.bid;

/** Bid/ask width of a contract; 0 when no two-sided quote (cannot measure). */
const quoteWidth = (c) => (hasTwoSidedQuote(c) ? c.ask - c.bid : 0);

// ── Strategy definitions ──────────────────────────────────────────────────

/**
 * Each definition describes how to:
 *  - select the leg array (calls vs puts)
 *  - identify which strike is "long" vs "short"
 *  - compute net cost and break-even
 *  - decide direction for probability calc (above / below break-even)
 */
const STRATEGY_DEFS = {
  bull_call: {
    label: 'Bull Call Spread',
    flow: 'debit',
    legType: 'call',
    direction: 'bullish',
    /**
     * @param {Contract} lo  lower-strike call
     * @param {Contract} hi  higher-strike call
     */
    pricing(lo, hi) {
      const debit = midPrice(lo) - midPrice(hi);          // long lo, short hi
      const width = hi.strike - lo.strike;
      return {
        netCost: debit,                                    // positive = paid
        maxProfitPerShare: width - debit,
        maxLossPerShare: debit,
        breakeven: lo.strike + debit,
        longLeg: lo, shortLeg: hi,
        popDirection: 'above',
      };
    },
  },
  bear_put: {
    label: 'Bear Put Spread',
    flow: 'debit',
    legType: 'put',
    direction: 'bearish',
    pricing(lo, hi) {
      const debit = midPrice(hi) - midPrice(lo);          // long hi, short lo
      const width = hi.strike - lo.strike;
      return {
        netCost: debit,
        maxProfitPerShare: width - debit,
        maxLossPerShare: debit,
        breakeven: hi.strike - debit,
        longLeg: hi, shortLeg: lo,
        popDirection: 'below',
      };
    },
  },
  bull_put: {
    label: 'Bull Put Spread',
    flow: 'credit',
    legType: 'put',
    direction: 'bullish',
    pricing(lo, hi) {
      const credit = midPrice(hi) - midPrice(lo);         // short hi, long lo
      const width = hi.strike - lo.strike;
      return {
        netCost: -credit,                                  // negative = received
        maxProfitPerShare: credit,
        maxLossPerShare: width - credit,
        breakeven: hi.strike - credit,
        longLeg: lo, shortLeg: hi,
        popDirection: 'above',
      };
    },
  },
  bear_call: {
    label: 'Bear Call Spread',
    flow: 'credit',
    legType: 'call',
    direction: 'bearish',
    pricing(lo, hi) {
      const credit = midPrice(lo) - midPrice(hi);         // short lo, long hi
      const width = hi.strike - lo.strike;
      return {
        netCost: -credit,
        maxProfitPerShare: credit,
        maxLossPerShare: width - credit,
        breakeven: lo.strike + credit,
        longLeg: hi, shortLeg: lo,
        popDirection: 'below',
      };
    },
  },
};

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * @typedef {Object} SpreadCandidate
 * @property {string} type                 e.g. 'bull_call'
 * @property {string} label
 * @property {'debit'|'credit'} flow
 * @property {Contract} longLeg
 * @property {Contract} shortLeg
 * @property {number} width                strike width in $
 * @property {number} netCost              per-share, signed (+ debit, - credit)
 * @property {number} netCostContract      per contract (× 100)
 * @property {number} maxProfit            $ per contract
 * @property {number} maxLoss              $ per contract (positive number)
 * @property {number} breakeven            underlying price at expiry
 * @property {number} riskReward           maxProfit / maxLoss
 * @property {number|null} probabilityOfProfit ∈ [0,1] or null
 * @property {number|null} expectedValue   $ per contract
 * @property {number} liquidityScore       min(vol+OI) across both legs
 * @property {number} compositeScore       0..100 normalised ranking score
 *
 * @typedef {Object} AnalyzeParams
 * @property {Contract[]} calls
 * @property {Contract[]} puts
 * @property {number} underlyingPrice
 * @property {number} daysToExpiry
 * @property {keyof STRATEGY_DEFS} spreadType
 * @property {number} [maxRiskPerContract=Infinity] cap by max-loss in $
 * @property {number} [maxWidth=Infinity]            cap by strike width
 * @property {number} [minWidth=0]                   floor by strike width (e.g. 100 = require >=100-point-wide spreads)
 * @property {number} [minLiquidity=0]               min vol+OI per leg
 * @property {number} [maxMoneynessDist=Infinity]    max |strike - underlying| / underlying as fraction (e.g. 0.15 = ±15%)
 * @property {number} [minReturnOnCapital=0]          reject spreads whose maxProfit/maxLoss is below this (e.g. 3 = require 3:1)
 * @property {number} [minProbabilityOfProfit=0]      reject spreads with PoP below this (e.g. 0.30 = 30%)
 * @property {number} [maxBreakevenMoveRatio=Infinity] reject spreads whose breakeven move exceeds this multiple of the IV-implied expected move (e.g. 1.0 = breakeven must be within 1σ)
 * @property {boolean} [requireOtmShort=false]        credit spreads only: reject when the short strike is in-the-money (bull put short ≥ spot, bear call short ≤ spot). ITM "credit" spreads are directional bets, not income trades.
 * @property {boolean} [requireTwoSidedQuotes=false]  reject legs without a live bid AND ask (stale lastPrice fallbacks produce phantom prices, esp. on LEAPS)
 * @property {number} [maxLegSpreadToWidth=Infinity]  reject when (ask−bid of long leg + ask−bid of short leg) / strike width exceeds this — the mid-price is noise when quotes are wider than the spread itself
 * @property {number} [riskFreeRate=0.045]
 * @property {number} [dividendYield=0]               annualised, used for forward-price drift in PoP calc (LEAPS-relevant)
 * @property {object|null} [distribution=null]       options-implied distribution for THIS expiry (see impliedDistribution.js); ignored if its DTE differs by > 3 days
 *
 * @param {AnalyzeParams} params
 * @returns {SpreadCandidate[]}            sorted by compositeScore desc
 */
export function analyzeSpreads(params) {
  const {
    calls = [],
    puts = [],
    underlyingPrice,
    daysToExpiry,
    spreadType,
    maxRiskPerContract = Infinity,
    maxWidth = Infinity,
    minWidth = 0,
    minLiquidity = 0,
    maxMoneynessDist = Infinity,
    minReturnOnCapital = 0,
    minProbabilityOfProfit = 0,
    maxBreakevenMoveRatio = Infinity,
    requireOtmShort = false,
    requireTwoSidedQuotes = false,
    maxLegSpreadToWidth = Infinity,
    riskFreeRate = 0.045,
    dividendYield = 0,
    distribution = null,
  } = params;

  const def = STRATEGY_DEFS[spreadType];
  if (!def) throw new Error(`Unknown spread type: ${spreadType}`);
  if (!underlyingPrice || underlyingPrice <= 0) return [];

  const legs = (def.legType === 'call' ? calls : puts)
    .filter(c => c.strike > 0 && (midPrice(c) > 0 || c.lastPrice > 0))
    .filter(c => !requireTwoSidedQuotes || hasTwoSidedQuote(c))
    .filter(c => maxMoneynessDist === Infinity || Math.abs(c.strike - underlyingPrice) / underlyingPrice <= maxMoneynessDist)
    .sort((a, b) => a.strike - b.strike);

  if (legs.length < 2) return [];

  const T = Math.max(daysToExpiry, 0) / 365;
  const candidates = [];
  const dist = distribution?.grid?.length && Math.abs((distribution.daysToExpiry ?? -Infinity) - daysToExpiry) <= MAX_DIST_DTE_MISMATCH
    ? distribution : null;
  const intrinsic = (c, S) => (def.legType === 'call' ? Math.max(0, S - c.strike) : Math.max(0, c.strike - S));

  // Compute average IV from legs that have a non-zero IV, for fallback use.
  // Yahoo Finance often returns impliedVolatility: 0 for illiquid strikes,
  // which would make PoP return null and filter out valid spreads.
  const ivs = legs.map((c) => c.impliedVolatility).filter((v) => v > 0);
  const avgLegIV = ivs.length > 0 ? ivs.reduce((s, v) => s + v, 0) / ivs.length : 0.3;

  // Enumerate every (lo, hi) pair where hi.strike > lo.strike
  for (let i = 0; i < legs.length - 1; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const lo = legs[i];
      const hi = legs[j];
      const width = hi.strike - lo.strike;
      if (width <= 0 || width > maxWidth || width < minWidth) continue;

      const liqLong = liquidityScore(lo);
      const liqShort = liquidityScore(hi);
      if (liqLong < minLiquidity || liqShort < minLiquidity) continue;

      let pricing;
      try { pricing = def.pricing(lo, hi); } catch { continue; }

      const { netCost, maxProfitPerShare, maxLossPerShare, breakeven,
              longLeg, shortLeg, popDirection } = pricing;

      // Filter degenerate / arbitrage candidates
      if (maxProfitPerShare <= 0 || maxLossPerShare <= 0) continue;

      if (requireOtmShort && def.flow === 'credit') {
        const shortItm = def.legType === 'put'
          ? shortLeg.strike >= underlyingPrice
          : shortLeg.strike <= underlyingPrice;
        if (shortItm) continue;
      }

      // Quote quality: when the combined bid/ask width of both legs is a large
      // fraction of the strike width, the mid-price difference is noise and
      // the spread cannot actually be filled near the quoted net cost.
      const legSpreadSum = quoteWidth(lo) + quoteWidth(hi);
      const legSpreadToWidth = legSpreadSum / width;
      if (legSpreadToWidth > maxLegSpreadToWidth) continue;

      // Natural (executable) price: buy at the ask, sell at the bid.
      const naturalNetCost = hasTwoSidedQuote(lo) && hasTwoSidedQuote(hi)
        ? (def.flow === 'debit'
          ? longLeg.ask - shortLeg.bid
          : -(shortLeg.bid - longLeg.ask))
        : null;
      // A debit spread whose natural cost ≥ width (or a credit spread whose
      // natural credit ≤ 0) can never be profitable at executable prices.
      if (requireTwoSidedQuotes && naturalNetCost != null) {
        if (def.flow === 'debit' && naturalNetCost >= width) continue;
        if (def.flow === 'credit' && naturalNetCost >= 0) continue;
      }

      const maxProfit = maxProfitPerShare * 100;
      const maxLoss   = maxLossPerShare * 100;
      if (maxLoss > maxRiskPerContract) continue;

      // Return on capital: max profit relative to capital at risk (max loss).
      // For both debit and credit verticals, maxLoss is the capital at risk.
      const returnOnCapital = maxProfit / maxLoss;
      if (returnOnCapital < minReturnOnCapital) continue;

      // Probability of profit using short-leg IV (most relevant for credit;
      // for debit spreads we use the same — long-leg IV is also reasonable).
      const sigma = (shortLeg.impliedVolatility > 0 ? shortLeg.impliedVolatility : null) ?? avgLegIV;
      const popLognormal = probabilityCrosses(
        underlyingPrice, breakeven, sigma, T, popDirection, riskFreeRate, dividendYield
      );
      // Options-implied distribution (preferred): integrate the expiry payoff.
      const payoff = (S) => intrinsic(longLeg, S) - intrinsic(shortLeg, S) - netCost;
      const popImplied = dist ? probPayoffPositive(dist, payoff) : null;
      const pop = popImplied ?? popLognormal;

      if (minProbabilityOfProfit > 0 && (pop == null || pop < minProbabilityOfProfit)) continue;

      // Breakeven-move feasibility: how far the underlying must travel to the
      // breakeven, vs the IV-implied 1σ expected move over the option's life.
      const breakevenMovePct = Math.abs(breakeven - underlyingPrice) / underlyingPrice;
      const expectedMovePct = sigma > 0 && T > 0 ? sigma * Math.sqrt(T) : null;
      const breakevenMoveRatio = expectedMovePct && expectedMovePct > 0
        ? breakevenMovePct / expectedMovePct
        : null;
      if (Number.isFinite(maxBreakevenMoveRatio) && breakevenMoveRatio != null
          && breakevenMoveRatio > maxBreakevenMoveRatio) continue;

      // EV: implied density integrates the full payoff; lognormal uses the
      // binary win/lose approximation.
      const ev = popImplied != null
        ? expectedPayoff(dist, payoff) * 100
        : pop != null ? pop * maxProfit - (1 - pop) * maxLoss : null;
      const probMaxProfit = dist ? probPayoffPositive(dist, (S) => payoff(S) - maxProfitPerShare + TAIL_EPS) : null;
      const probMaxLoss = dist ? probPayoffPositive(dist, (S) => -maxLossPerShare + TAIL_EPS - payoff(S)) : null;

      candidates.push({
        type: spreadType,
        label: def.label,
        flow: def.flow,
        longLeg, shortLeg,
        width,
        netCost,
        netCostContract: netCost * 100,
        naturalNetCost,
        legSpreadToWidth,
        maxProfit,
        maxLoss,
        breakeven,
        riskReward: returnOnCapital,
        returnOnCapital,
        breakevenMovePct,
        expectedMovePct,
        breakevenMoveRatio,
        probabilityOfProfit: pop,
        popMethod: popImplied != null ? 'implied' : 'lognormal',
        popLognormal,
        probMaxProfit,
        probMaxLoss,
        expectedValue: ev,
        liquidityScore: Math.min(liqLong, liqShort),
        daysToExpiry,
        isLeaps: isLeaps(daysToExpiry),
        compositeScore: 0,  // filled below
      });
    }
  }

  if (candidates.length === 0) return [];

  // Composite score: blend of expected-value rank, R/R, PoP, and liquidity.
  // Each component normalised 0..1 across the candidate set so the score is
  // comparable within this analysis (not across symbols/expiries).
  const evValues  = candidates.map(c => c.expectedValue ?? -Infinity);
  const rrValues  = candidates.map(c => c.riskReward);
  const rocValues = candidates.map(c => c.returnOnCapital);
  const popValues = candidates.map(c => c.probabilityOfProfit ?? 0);
  const liqValues = candidates.map(c => c.liquidityScore);

  const norm = (v, arr) => {
    const lo = Math.min(...arr.filter(Number.isFinite));
    const hi = Math.max(...arr.filter(Number.isFinite));
    if (hi === lo) return 0.5;
    if (!Number.isFinite(v)) return 0;
    return (v - lo) / (hi - lo);
  };

  for (const c of candidates) {
    const evN  = norm(c.expectedValue ?? -Infinity, evValues);
    const rrN  = norm(c.riskReward, rrValues);
    const rocN = norm(c.returnOnCapital, rocValues);
    const popN = norm(c.probabilityOfProfit ?? 0, popValues);
    const liqN = norm(c.liquidityScore, liqValues);
    // Weighted (cost-efficiency aware): RoC 25%, PoP 25%, EV 20%, R/R 15%, Liquidity 15%.
    // Return-on-capital rewards low-cost, capital-efficient spreads.
    c.compositeScore = (0.25 * rocN + 0.25 * popN + 0.20 * evN + 0.15 * rrN + 0.15 * liqN) * 100;
  }

  candidates.sort((a, b) => b.compositeScore - a.compositeScore);
  return candidates;
}

// Re-exports for testing
export const _internal = { normalCdf, probabilityCrosses, midPrice, hasTwoSidedQuote, quoteWidth, STRATEGY_DEFS };
