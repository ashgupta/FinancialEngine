/**
 * Options Opportunities Engine — scans a universe of underlyings and
 * produces ranked option recommendations across three horizon bands.
 *
 * Constitution Principle II: pure functions, no I/O, no DOM.
 * Constitution Principle IV: every recommendation has a structured rationale.
 * Constitution Principle VII: drawdown guard flags oversized risk.
 *
 * Three horizon bands:
 *   short-term:  DTE ≤ 365   (≤ 1 year)
 *   medium-term: 365 < DTE ≤ 730  (1–2 years)
 *   LEAPS:       DTE > 730   (> 2 years)
 *
 * Strategy selection (SPREAD-FIRST, low-cost, capital-efficient):
 *   Every recommendation is a DEFINED-RISK spread. Naked long calls/puts are
 *   never recommended. Gates differ by cash-flow because the payoff shapes do:
 *     - DEBIT spreads (bull call / bear put / PMCC): maxProfit >= 3x capital
 *       at risk AND PoP >= 30%.
 *     - CREDIT spreads (bull put / bear call): the short strike MUST be
 *       out-of-the-money, credit >= 20% of width (RoC >= 0.25) AND PoP >= 55%.
 *       A credit spread that clears a 3x RoC floor is necessarily deep ITM —
 *       i.e. a directional bet mislabeled as "income" — so the debit gate is
 *       never applied to credit structures.
 *   Quote-quality gate (all structures): both legs need a live two-sided
 *   quote, combined leg bid/ask width <= 35% of strike width, and the natural
 *   (ask/bid) price must still leave a profit. This rejects phantom spreads
 *   priced off stale or very wide LEAPS quotes.
 *   Short & Medium: signal-driven, IV-aware
 *     - Bullish  → bull call debit spread (low IV) / bull put credit (high IV)
 *     - Bearish  → bear put debit spread (low IV) / bear call credit (high IV)
 *   LEAPS: bullish only
 *     - Bull call debit spread (default) + Poor Man's Covered Call diagonal
 *     - Bull call spreads on LEAPS must be >= 100 points wide (see
 *       LEAPS_MIN_CALL_SPREAD_WIDTH) — narrow spreads on a 2+ year expiry
 *       have poor dollar-return potential relative to the time commitment.
 *
 * Because RoC >= 3x forces cheap, out-of-the-money debit spreads, a band may
 * return FEWER than 5 picks (or none). We never pad with low-quality trades.
 *
 * Every recommendation has a `why` object with:
 *   signalSummary, strikeReason, horizonReason, riskNote
 */

import { analyzeAsset } from './momentumEngine.js';
import { analyzeSpreads } from './spreadAnalyzer.js';
import { bsCallDelta, bsCallPrice } from './leapsAnalyzer.js';

// ─── Constants ───────────────────────────────────────────

const BANDS = {
  short: { label: 'Short-term', dteMin: 0, dteMax: 365, description: 'Expiries ≤ 1 year — swing trades and tactical hedges' },
  medium: { label: 'Medium-term', dteMin: 366, dteMax: 730, description: 'Expiries 1–2 years — structural views with time' },
  leaps: { label: 'LEAPS', dteMin: 731, dteMax: Infinity, description: 'Expiries > 2 years — leveraged long-term investing' },
};

const MAX_RECS_PER_BAND = 5;
const DRAWDOWN_GUARD_PCT = 15; // flag if maxLoss > 15% of allocation

// Capital-efficiency gate applied to EVERY recommendation.
const MIN_RETURN_ON_CAPITAL = 3.0; // maxProfit must be >= 3x capital at risk
const MIN_POP = 0.30;              // reject the lowest-probability lottery tickets
const HIGH_IV_THRESHOLD = 0.40;    // avg chain IV above this favors credit structures

// Credit (income) spread gates — see header. 20% credit-to-width is the
// conventional floor for OTM verticals; below it, commissions and a single
// adverse move dominate the trade.
const MIN_CREDIT_RETURN_ON_CAPITAL = 0.25; // credit / (width − credit) ⇔ credit ≥ 20% of width
const MIN_CREDIT_POP = 0.55;

// Quote-quality gate shared by every structure.
const QUOTE_GATES = { requireTwoSidedQuotes: true, maxLegSpreadToWidth: 0.35 };
const MAX_LEG_QUOTE_SPREAD_PCT = 0.15; // single-leg (PMCC) max (ask−bid)/mid

// LEAPS bull call spreads prefer wide, stock-replacement-style spreads. We
// start by requiring a 100-point minimum width and step down gradually if no
// candidates pass all gates (RoC, PoP, liquidity). Among candidates that pass,
// the widest spread is preferred.
const LEAPS_MIN_CALL_SPREAD_WIDTH = 100;
const LEAPS_WIDTH_STEPS = [100, 75, 50, 25, 0];

// ─── Curated liquid universe ─────────────────────────────

export const CURATED_LIQUID = [
  { symbol: 'SPY', name: 'SPDR S&P 500' },
  { symbol: 'QQQ', name: 'Invesco QQQ' },
  { symbol: 'IWM', name: 'iShares Russell 2000' },
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'JPM', name: 'JPMorgan' },
  { symbol: 'DIA', name: 'SPDR Dow Jones' },
];

// ─── Helpers ─────────────────────────────────────────────

function daysToExpiration(expirationTimestamp) {
  if (!expirationTimestamp) return null;
  const ms = expirationTimestamp * 1000 - Date.now();
  return Math.round(ms / 86400000);
}

function classifyBand(dte) {
  if (dte == null) return null;
  if (dte <= BANDS.short.dteMax) return 'short';
  if (dte <= BANDS.medium.dteMax) return 'medium';
  return 'leaps';
}

/**
 * Determine the signal direction from momentum analysis.
 * Returns 'bullish', 'bearish', or 'neutral'.
 */
function getDirection(asset) {
  const signal = asset.signal || 'neutral';
  if (signal.includes('bullish')) return 'bullish';
  if (signal.includes('bearish')) return 'bearish';
  return 'neutral';
}

/**
 * Compute an opportunity score (0-100) from the momentum analysis.
 * Blends momentum score, volume confirmation, and 200-DMA position.
 */
function computeOpportunityScore(asset) {
  const ts = asset.timeSeries || {};
  const vol = asset.volume || {};

  let score = 0;
  let components = 0;

  // Momentum score (−20 to +20 → 0 to 100)
  if (asset.momentumScore != null) {
    score += Math.max(0, Math.min(100, ((asset.momentumScore + 20) / 40) * 100));
    components++;
  }

  // Volume confirmation
  if (vol.confirmation) {
    if (vol.confirmation.includes('bullish')) { score += 70; components++; }
    else if (vol.confirmation.includes('bearish')) { score += 60; components++; }
    else { score += 40; components++; }
  }

  // 200-DMA position
  if (ts.aboveSMA200 != null) {
    score += ts.aboveSMA200 ? 75 : 30;
    components++;
  }

  // Breakout bonus
  if (ts.breakout && ts.breakout !== 'none') {
    score += 10;
  }

  return components > 0 ? score / Math.max(components, 1) : 0;
}

/**
 * Compute a band-adjusted opportunity score.
 * Same base score as computeOpportunityScore, but with band-specific
 * adjustments so the same symbol isn't ranked identically across bands.
 *
 * Short: rewards high momentum + volume (tactical timing)
 * Medium: rewards trend alignment (MA stack) + moderate momentum
 * LEAPS: rewards structural bullishness (above 200-DMA, bullish MA stack)
 */
function computeBandAdjustedScore(asset, band) {
  const base = computeOpportunityScore(asset);
  const ts = asset.timeSeries || {};
  const vol = asset.volume || {};

  let adj = 0;

  if (band === 'short') {
    // Short-term: reward strong momentum + volume confirmation
    if (asset.momentumScore != null) {
      adj += (Math.abs(asset.momentumScore) > 10 ? 5 : 0);
    }
    if (vol.confirmation && vol.confirmation.includes('strong')) adj += 3;
    if (ts.rsi14 != null && ts.rsi14 > 60 && ts.rsi14 < 75) adj += 2; // momentum without overbought
  } else if (band === 'medium') {
    // Medium: reward trend alignment + steady momentum
    if (ts.maStack === 'bullish') adj += 4;
    if (ts.aboveSMA200) adj += 3;
    if (asset.momentumScore != null && Math.abs(asset.momentumScore) > 5 && Math.abs(asset.momentumScore) < 20) adj += 2;
  } else if (band === 'leaps') {
    // LEAPS: reward structural bullishness above all
    if (ts.aboveSMA200) adj += 6;
    if (ts.maStack === 'bullish') adj += 4;
    if (ts.roc12m != null && ts.roc12m > 10) adj += 3; // proven 12-month uptrend
  }

  return Math.max(0, Math.min(100, base + adj));
}

/**
 * Pick the best expiry from available expirations for a given band.
 * Returns the expiration timestamp closest to the band's sweet spot.
 */
function pickExpiry(expirations, band) {
  if (!expirations || expirations.length === 0) return null;
  const bandDef = BANDS[band];
  const inBand = expirations.filter((exp) => {
    const dte = daysToExpiration(exp);
    return dte != null && dte >= bandDef.dteMin && dte <= bandDef.dteMax;
  });
  if (inBand.length === 0) return null;

  // Sweet spots: short → ~60-90 DTE, medium → ~500 DTE, leaps → ~800+ DTE
  const sweetSpots = { short: 75, medium: 500, leaps: 900 };
  const target = sweetSpots[band];
  return inBand.reduce((best, exp) => {
    const dte = daysToExpiration(exp);
    const bestDte = daysToExpiration(best);
    return Math.abs(dte - target) < Math.abs(bestDte - target) ? exp : best;
  });
}

/**
 * Delta of a contract using the shared Black-Scholes-Merton engine.
 * Puts derived from call delta via parity (q≈0): putDelta = callDelta − 1.
 */
function estimateDelta(contract, underlyingPrice, daysToExp, isCall = true) {
  if (!contract || !underlyingPrice) return null;
  const iv = contract.impliedVolatility > 0 ? contract.impliedVolatility : 0.3;
  const T = Math.max(daysToExp, 1) / 365;
  const callDelta = bsCallDelta(underlyingPrice, contract.strike, T, 0.045, 0, iv);
  if (callDelta == null || Number.isNaN(callDelta)) return null;
  return isCall ? callDelta : callDelta - 1;
}

/** Average implied volatility across a chain's calls (0 if unavailable). */
function avgChainIV(chain) {
  const calls = chain?.calls || [];
  if (calls.length === 0) return 0;
  const ivs = calls.map((c) => c.impliedVolatility).filter((v) => v > 0);
  return ivs.length > 0 ? ivs.reduce((s, v) => s + v, 0) / ivs.length : 0.3;
}

/** Mid price of a contract, falling back to lastPrice. */
function contractMid(c) {
  if (c.bid > 0 && c.ask > 0) return (c.bid + c.ask) / 2;
  return c.lastPrice || 0;
}

/** True when a contract has a live, reasonably tight two-sided quote. */
function hasTradeableQuote(c) {
  if (!(c.bid > 0 && c.ask > 0 && c.ask >= c.bid)) return false;
  const mid = (c.bid + c.ask) / 2;
  return (c.ask - c.bid) / mid <= MAX_LEG_QUOTE_SPREAD_PCT;
}

/** Pick the call from a list whose BS delta is closest to a target. */
function pickCallByDelta(calls, spot, dte, targetDelta) {
  let best = null;
  for (const c of calls) {
    if (!hasTradeableQuote(c)) continue;
    const mid = contractMid(c);
    if (mid <= 0 || !(c.strike > 0)) continue;
    const delta = estimateDelta(c, spot, dte, true) ?? 0;
    const fit = Math.abs(delta - targetDelta);
    if (!best || fit < best.fit) best = { c, mid, delta, fit };
  }
  return best;
}

// ─── Strategy builders ───────────────────────────────────

/**
 * Build a long call or long put recommendation.
 */
function buildDirectionalBuy(asset, chain, band, direction) {
  const { calls = [], puts = [], underlyingPrice } = chain;
  const dte = daysToExpiration(chain.expirationDate);
  if (!underlyingPrice || dte == null) return null;

  const isBullish = direction === 'bullish';
  const legs = isBullish ? calls : puts;
  if (legs.length === 0) return null;

  // For LEAPS: prioritize deep ITM (0.70-0.80 delta)
  // For short/medium: ATM to slightly ITM
  let bestLeg = null;
  let bestScore = -1;

  for (const leg of legs) {
    if (leg.bid <= 0 && leg.ask <= 0 && leg.lastPrice <= 0) continue;
    const delta = Math.abs(estimateDelta(leg, underlyingPrice, dte, isBullish) || 0);
    let targetDelta;
    if (band === 'leaps') {
      targetDelta = 0.75; // deep ITM stock replacement
    } else {
      targetDelta = 0.50; // ATM
    }
    const deltaFit = 1 - Math.min(1, Math.abs(delta - targetDelta) / 0.3);
    const liquidity = (leg.volume || 0) + (leg.openInterest || 0);
    const liqScore = Math.min(1, liquidity / 1000);
    const score = deltaFit * 0.6 + liqScore * 0.4;
    if (score > bestScore) {
      bestScore = score;
      bestLeg = leg;
    }
  }

  if (!bestLeg) return null;

  const mid = (bestLeg.bid > 0 && bestLeg.ask > 0)
    ? (bestLeg.bid + bestLeg.ask) / 2
    : bestLeg.lastPrice || 0;
  if (mid <= 0) return null;

  const maxLoss = mid * 100; // per contract
  const delta = estimateDelta(bestLeg, underlyingPrice, dte, isBullish);
  const strategyType = isBullish ? 'Long Call' : 'Long Put';

  return {
    symbol: asset.symbol,
    name: asset.name,
    direction,
    band,
    strategy: strategyType,
    strategyType: isBullish ? 'long_call' : 'long_put',
    legs: [{
      action: 'BUY',
      type: isBullish ? 'CALL' : 'PUT',
      strike: bestLeg.strike,
      expiry: chain.expirationDate,
      price: mid,
      iv: bestLeg.impliedVolatility,
      delta,
      volume: bestLeg.volume,
      openInterest: bestLeg.openInterest,
    }],
    underlyingPrice,
    netCost: mid * 100,
    maxProfit: Infinity, // undefined for naked longs
    maxLoss,
    breakeven: isBullish ? bestLeg.strike + mid : bestLeg.strike - mid,
    probabilityOfProfit: delta != null ? Math.abs(delta) : null,
    dte,
    opportunityScore: computeBandAdjustedScore(asset, band),
    drawdownFlag: false, // checked later with allocation
    why: {
      signalSummary: buildSignalSummary(asset, direction),
      strikeReason: band === 'leaps'
        ? `Deep ITM strike $${bestLeg.strike} (~${(Math.abs(delta || 0) * 100).toFixed(0)}Δ) for stock-replacement leverage with high intrinsic value`
        : `${isBullish ? 'ATM/slightly-ITM' : 'ATM/slightly-ITM'} strike $${bestLeg.strike} balances cost and delta exposure`,
      horizonReason: buildHorizonReason(asset, band, direction),
      riskNote: `Max loss $${maxLoss.toFixed(0)} (100% of premium). ${band === 'leaps' ? 'LEAPS have lower theta decay rate but require multi-year thesis.' : 'Time decay accelerates in last 60 days.'}`,
    },
  };
}

/**
 * Build a bull call spread or bear put spread recommendation.
 */
function buildDebitSpread(asset, chain, band, direction) {
  const { underlyingPrice, expirationDate } = chain;
  const dte = daysToExpiration(expirationDate);
  if (!underlyingPrice || dte == null) return null;

  const spreadType = direction === 'bullish' ? 'bull_call' : 'bear_put';
  // Moneyness filter: short ±15%, medium ±25%, LEAPS ±35% (wider room for OTM
  // debit spreads that satisfy the high return-on-capital floor).
  const maxMoneynessDist = band === 'leaps' ? 0.35 : band === 'medium' ? 0.25 : 0.15;
  // Scale maxWidth relative to underlying price so spreads on high-priced
  // names like SPY (~$750) aren't impossibly narrow. 3% of spot for debit.
  const pctMaxWidth = band === 'leaps' ? 0.06 : 0.03;
  const scaledMaxWidth = Math.max(15, Math.round(underlyingPrice * pctMaxWidth));

  // Rule: LEAPS bull call spreads start with a 100-point minimum width and
  // step down gradually (75, 50, 25, 0) until candidates pass all gates. This
  // ensures we always prefer the widest viable spread but still find a trade
  // when the chain doesn't support 100-point widths.
  const isLeapsBullCall = band === 'leaps' && spreadType === 'bull_call';
  const maxWidth = isLeapsBullCall ? Infinity : scaledMaxWidth;

  let candidates = [];
  let appliedMinWidth = 0;
  if (isLeapsBullCall) {
    for (const stepMin of LEAPS_WIDTH_STEPS) {
      candidates = analyzeSpreads({
        calls: chain.calls || [],
        puts: chain.puts || [],
        underlyingPrice,
        daysToExpiry: dte,
        spreadType,
        minLiquidity: 20,
        maxWidth,
        minWidth: stepMin,
        maxMoneynessDist,
        minReturnOnCapital: MIN_RETURN_ON_CAPITAL,
        minProbabilityOfProfit: MIN_POP,
        ...QUOTE_GATES,
      });
      if (candidates.length > 0) {
        appliedMinWidth = stepMin;
        break;
      }
    }
  } else {
    candidates = analyzeSpreads({
      calls: chain.calls || [],
      puts: chain.puts || [],
      underlyingPrice,
      daysToExpiry: dte,
      spreadType,
      minLiquidity: 20,
      maxWidth,
      minWidth: 0,
      maxMoneynessDist,
      minReturnOnCapital: MIN_RETURN_ON_CAPITAL,
      minProbabilityOfProfit: MIN_POP,
      ...QUOTE_GATES,
    });
  }

  if (candidates.length === 0) return null;

  // For LEAPS bull call spreads, prefer the widest spread among candidates
  // that passed all gates (widest = best dollar-return potential). Use
  // compositeScore as a tiebreaker for equal widths.
  if (isLeapsBullCall) {
    candidates.sort((a, b) => {
      if (b.width !== a.width) return b.width - a.width;
      return b.compositeScore - a.compositeScore;
    });
  }
  const best = candidates[0];

  return {
    symbol: asset.symbol,
    name: asset.name,
    direction,
    band,
    strategy: best.label,
    strategyType: spreadType,
    legs: [
      { action: 'BUY', type: spreadType === 'bull_call' ? 'CALL' : 'PUT', strike: best.longLeg.strike, expiry: expirationDate, price: (best.longLeg.bid + best.longLeg.ask) / 2 || best.longLeg.lastPrice },
      { action: 'SELL', type: spreadType === 'bull_call' ? 'CALL' : 'PUT', strike: best.shortLeg.strike, expiry: expirationDate, price: (best.shortLeg.bid + best.shortLeg.ask) / 2 || best.shortLeg.lastPrice },
    ],
    underlyingPrice,
    netCost: best.netCostContract,
    naturalCost: best.naturalNetCost != null ? best.naturalNetCost * 100 : null,
    maxProfit: best.maxProfit,
    maxLoss: best.maxLoss,
    breakeven: best.breakeven,
    probabilityOfProfit: best.probabilityOfProfit,
    riskReward: best.riskReward,
    returnOnCapital: best.returnOnCapital,
    breakevenMovePct: best.breakevenMovePct,
    dte,
    opportunityScore: computeBandAdjustedScore(asset, band),
    drawdownFlag: false,
    why: {
      signalSummary: buildSignalSummary(asset, direction),
      strikeReason: `${best.longLeg.strike}/${best.shortLeg.strike} spread — width $${best.width}${isLeapsBullCall ? ` (widest viable ≥${appliedMinWidth}pt LEAPS floor)` : ''}, net debit $${best.netCost.toFixed(2)} (≤25% of width for ${best.returnOnCapital.toFixed(1)}× return-on-capital)`,
      horizonReason: buildHorizonReason(asset, band, direction),
      riskNote: `Capital at risk $${best.maxLoss.toFixed(0)}, max profit $${best.maxProfit.toFixed(0)} (${best.returnOnCapital.toFixed(1)}× RoC), PoP ${best.probabilityOfProfit != null ? (best.probabilityOfProfit * 100).toFixed(0) + '%' : 'N/A'}. Breakeven needs a ${(best.breakevenMovePct * 100).toFixed(1)}% move.`,
    },
  };
}

/**
 * Build an income strategy (credit spread) for range-bound/high-IV names.
 */
function buildIncomeSpread(asset, chain, band, direction) {
  const { underlyingPrice, expirationDate } = chain;
  const dte = daysToExpiration(expirationDate);
  if (!underlyingPrice || dte == null) return null;

  // Bull put spread for bullish/neutral, bear call spread for bearish/neutral
  const spreadType = direction === 'bearish' ? 'bear_call' : 'bull_put';
  // Moneyness filter: short ±10%, medium ±20%, LEAPS ±30%
  const maxMoneynessDist = band === 'leaps' ? 0.30 : band === 'medium' ? 0.20 : 0.10;
  // Scale maxWidth relative to underlying price. 2% of spot for credit.
  const pctMaxWidth = band === 'leaps' ? 0.04 : 0.02;
  const scaledMaxWidth = Math.max(10, Math.round(underlyingPrice * pctMaxWidth));
  const candidates = analyzeSpreads({
    calls: chain.calls || [],
    puts: chain.puts || [],
    underlyingPrice,
    daysToExpiry: dte,
    spreadType,
    minLiquidity: 20,
    maxWidth: scaledMaxWidth,
    maxMoneynessDist,
    requireOtmShort: true,
    minReturnOnCapital: MIN_CREDIT_RETURN_ON_CAPITAL,
    minProbabilityOfProfit: MIN_CREDIT_POP,
    ...QUOTE_GATES,
  });

  if (candidates.length === 0) return null;
  const best = candidates[0];

  const incomeDirection = spreadType === 'bull_put' ? 'bullish' : 'bearish';
  const credit = Math.abs(best.netCost);
  const otmPct = Math.abs(best.shortLeg.strike - underlyingPrice) / underlyingPrice;

  return {
    symbol: asset.symbol,
    name: asset.name,
    direction: incomeDirection,
    band,
    strategy: best.label,
    strategyType: spreadType,
    legs: [
      { action: 'SELL', type: spreadType === 'bull_put' ? 'PUT' : 'CALL', strike: best.shortLeg.strike, expiry: expirationDate, price: (best.shortLeg.bid + best.shortLeg.ask) / 2 || best.shortLeg.lastPrice },
      { action: 'BUY', type: spreadType === 'bull_put' ? 'PUT' : 'CALL', strike: best.longLeg.strike, expiry: expirationDate, price: (best.longLeg.bid + best.longLeg.ask) / 2 || best.longLeg.lastPrice },
    ],
    underlyingPrice,
    netCost: best.netCostContract, // negative = credit received
    naturalCost: best.naturalNetCost != null ? best.naturalNetCost * 100 : null,
    maxProfit: best.maxProfit,
    maxLoss: best.maxLoss,
    breakeven: best.breakeven,
    probabilityOfProfit: best.probabilityOfProfit,
    riskReward: best.riskReward,
    returnOnCapital: best.returnOnCapital,
    breakevenMovePct: best.breakevenMovePct,
    dte,
    opportunityScore: computeBandAdjustedScore(asset, band),
    drawdownFlag: false,
    why: {
      signalSummary: buildSignalSummary(asset, incomeDirection) + ' (income play)',
      strikeReason: `Sell $${best.shortLeg.strike} / buy $${best.longLeg.strike} ${spreadType === 'bull_put' ? 'puts' : 'calls'} — short strike ${(otmPct * 100).toFixed(1)}% out-of-the-money (${spreadType === 'bull_put' ? 'below' : 'above'} spot $${underlyingPrice.toFixed(2)}), credit $${credit.toFixed(2)} = ${((credit / best.width) * 100).toFixed(0)}% of the $${best.width} width`,
      horizonReason: buildHorizonReason(asset, band, incomeDirection) + ' Income spreads benefit from theta decay; profit if the underlying stays on the right side of the short strike.',
      riskNote: `Max loss $${best.maxLoss.toFixed(0)}, max profit $${best.maxProfit.toFixed(0)} (${(best.returnOnCapital * 100).toFixed(0)}% on risk), PoP ${best.probabilityOfProfit != null ? (best.probabilityOfProfit * 100).toFixed(0) + '%' : 'N/A'}. Income trades win often but lose more per loss — size small.`,
    },
  };
}

// ─── Rationale builders ──────────────────────────────────

function buildSignalSummary(asset, direction) {
  const ts = asset.timeSeries || {};
  const vol = asset.volume || {};
  const parts = [];

  parts.push(`Momentum: ${asset.signal || 'neutral'} (score ${asset.momentumScore?.toFixed(1) ?? 'N/A'})`);
  if (ts.aboveSMA200 != null) parts.push(ts.aboveSMA200 ? 'Above 200-DMA' : 'Below 200-DMA');
  if (ts.maStack) parts.push(`MA stack: ${ts.maStack}`);
  if (vol.confirmation) parts.push(`Volume: ${vol.confirmation}`);
  if (ts.breakout && ts.breakout !== 'none') parts.push(`Breakout: ${ts.breakout}`);
  if (ts.rsi14 != null) parts.push(`RSI: ${ts.rsi14.toFixed(0)}`);

  return parts.join(', ');
}

function buildHorizonReason(asset, band, direction) {
  const bandDef = BANDS[band];
  if (band === 'leaps') {
    return `${bandDef.label} (>2yr expiry): leveraged long-term bullish thesis on ${asset.symbol}. Deep ITM calls provide stock-like delta with less capital, amplifying returns on a multi-year upward move.`;
  } else if (band === 'medium') {
    return `${bandDef.label} (1-2yr expiry): structural view allowing time for thesis to play out. Lower theta decay rate than short-term, good for medium-conviction directional bets.`;
  } else {
    return `${bandDef.label} (≤1yr expiry): tactical entry aligned with current momentum. Higher gamma but faster theta — suited for swing-trade timing.`;
  }
}

/**
 * Build a Poor Man's Covered Call (diagonal): long deep-ITM LEAPS call +
 * short OTM near-term call. A low-cost stock-replacement that reduces net
 * debit vs a naked LEAPS. Subject to the same RoC/PoP gate as every rec.
 *
 * Single-cycle max profit is approximated at the short strike at short
 * expiry: the long call is valued via Black-Scholes at its remaining life,
 * the short expires worthless. This is the covered-call-style capped upside.
 *
 * @param {object} asset
 * @param {object} longChain  LEAPS-band chain (long leg)
 * @param {object} shortChain short-dated chain (short leg)
 */
function buildPMCC(asset, longChain, shortChain) {
  const spot = longChain?.underlyingPrice;
  if (!spot || !shortChain) return null;
  const longDte = daysToExpiration(longChain.expirationDate);
  const shortDte = daysToExpiration(shortChain.expirationDate);
  if (longDte == null || shortDte == null || shortDte >= longDte) return null;

  // Long: deep-ITM (~0.80 delta) call for stock-like exposure.
  const longPick = pickCallByDelta(longChain.calls || [], spot, longDte, 0.80);
  if (!longPick || longPick.c.strike >= spot) return null;

  // Short: OTM call above spot and above the long strike (~0.30 delta).
  const shortCandidates = (shortChain.calls || []).filter(
    (c) => c.strike > spot && c.strike > longPick.c.strike
  );
  const shortPick = pickCallByDelta(shortCandidates, spot, shortDte, 0.30);
  if (!shortPick) return null;

  const netDebit = longPick.mid - shortPick.mid;
  if (netDebit <= 0) return null;
  const capitalAtRisk = netDebit * 100;

  // Value the long at the short expiry, evaluated at the short strike.
  const ivLong = longPick.c.impliedVolatility > 0 ? longPick.c.impliedVolatility : 0.3;
  const remainingT = Math.max(longDte - shortDte, 1) / 365;
  const longValAtShortExp = bsCallPrice(shortPick.c.strike, longPick.c.strike, remainingT, 0.045, 0, ivLong);
  const maxProfit = (longValAtShortExp - longPick.mid + shortPick.mid) * 100;
  if (maxProfit <= 0) return null;

  const returnOnCapital = maxProfit / capitalAtRisk;
  if (returnOnCapital < MIN_RETURN_ON_CAPITAL) return null;

  const breakeven = longPick.c.strike + netDebit;
  const breakevenMovePct = Math.abs(breakeven - spot) / spot;
  // PoP proxy: risk-neutral P(S > breakeven) at short expiry ≈ delta at breakeven.
  const pop = bsCallDelta(spot, breakeven, Math.max(shortDte, 1) / 365, 0.045, 0, ivLong);
  if (pop == null || pop < MIN_POP) return null;

  return {
    symbol: asset.symbol,
    name: asset.name,
    direction: 'bullish',
    band: 'leaps',
    strategy: "Poor Man's Covered Call",
    strategyType: 'pmcc',
    legs: [
      { action: 'BUY', type: 'CALL', strike: longPick.c.strike, expiry: longChain.expirationDate, price: longPick.mid, delta: longPick.delta },
      { action: 'SELL', type: 'CALL', strike: shortPick.c.strike, expiry: shortChain.expirationDate, price: shortPick.mid, delta: shortPick.delta },
    ],
    underlyingPrice: spot,
    netCost: capitalAtRisk,
    maxProfit,
    maxLoss: capitalAtRisk,
    breakeven,
    probabilityOfProfit: pop,
    riskReward: returnOnCapital,
    returnOnCapital,
    breakevenMovePct,
    dte: longDte,
    opportunityScore: computeBandAdjustedScore(asset, 'leaps'),
    drawdownFlag: false,
    why: {
      signalSummary: buildSignalSummary(asset, 'bullish') + ' (diagonal / PMCC)',
      strikeReason: `Long ${longPick.c.strike} LEAPS (~${(longPick.delta * 100).toFixed(0)}Δ) financed by short ${shortPick.c.strike} call — net debit $${netDebit.toFixed(2)} vs a naked LEAPS.`,
      horizonReason: `${BANDS.leaps.label}: capital-efficient stock replacement. The short call reduces cost basis; roll it each cycle. Long leg has ${longDte}d of life.`,
      riskNote: `Capital at risk $${capitalAtRisk.toFixed(0)}, single-cycle max profit $${maxProfit.toFixed(0)} (${returnOnCapital.toFixed(1)}× RoC), PoP ${(pop * 100).toFixed(0)}%. Assignment/early-exercise risk on the short call.`,
    },
  };
}

// ─── Strategy selection per band ─────────────────────────

/**
 * Select the best strategy for a given asset, chain, and band.
 *
 * SPREAD-FIRST: every recommendation is a defined-risk spread that must
 * clear the RoC ≥ 3× and PoP ≥ 30% gates enforced inside the builders.
 * Naked long calls/puts are never returned.
 *
 * IV-aware routing:
 *   - Low IV  (avgIV ≤ HIGH_IV_THRESHOLD) → debit spreads (cheaper)
 *   - High IV (avgIV >  HIGH_IV_THRESHOLD) → credit spreads (sell premium)
 *
 * LEAPS: bullish only — bull call debit spread (default) + PMCC diagonal
 *   when a short-dated chain is available.
 *
 * @param {object} asset
 * @param {object} chain       option chain for the target band
 * @param {string} band        'short' | 'medium' | 'leaps'
 * @param {Set<string>} heldSet
 * @param {object} [shortChain]  short-dated chain for PMCC (LEAPS only)
 * @returns {object|null}
 */
function selectStrategy(asset, chain, band, heldSet, shortChain) {
  const direction = getDirection(asset);
  const isHeld = heldSet?.has(asset.symbol) ?? false;
  const iv = avgChainIV(chain);
  const isHighIV = iv > HIGH_IV_THRESHOLD;

  let rec = null;

  if (band === 'leaps') {
    // LEAPS: bullish only — bull call spread (default) + PMCC diagonal
    if (direction === 'bullish' || direction === 'neutral') {
      // Try PMCC first if we have a short-dated chain
      if (shortChain) {
        rec = buildPMCC(asset, chain, shortChain);
      }
      // Fall back to bull call debit spread
      if (!rec) {
        rec = buildDebitSpread(asset, chain, band, 'bullish');
      }
    }
  } else {
    // Short & Medium: IV-aware, spread-first
    if (direction === 'bullish') {
      if (isHighIV) {
        // High IV → sell premium: bull put credit spread
        rec = buildIncomeSpread(asset, chain, band, 'bullish')
          || buildDebitSpread(asset, chain, band, 'bullish');
      } else {
        // Low IV → buy premium: bull call debit spread
        rec = buildDebitSpread(asset, chain, band, 'bullish')
          || buildIncomeSpread(asset, chain, band, 'bullish');
      }
    } else if (direction === 'bearish') {
      if (isHighIV) {
        // High IV → sell premium: bear call credit spread
        rec = buildIncomeSpread(asset, chain, band, 'bearish')
          || buildDebitSpread(asset, chain, band, 'bearish');
      } else {
        // Low IV → buy premium: bear put debit spread
        rec = buildDebitSpread(asset, chain, band, 'bearish')
          || buildIncomeSpread(asset, chain, band, 'bearish');
      }
    } else {
      // Neutral / range-bound → income spread both directions
      rec = buildIncomeSpread(asset, chain, band, 'bullish')
        || buildIncomeSpread(asset, chain, band, 'bearish')
        || buildDebitSpread(asset, chain, band, 'bullish');
    }
  }

  if (rec) {
    rec.isHeld = isHeld;
    rec.opportunityScore = computeBandAdjustedScore(asset, band);
  }

  return rec;
}

// ─── Crash-regime overlay ────────────────────────────────

// Score multipliers keyed by Crash Radar level. Directional bullish exposure
// is de-rated as systemic risk rises; bearish setups get a modest lift.
// Calm/watch leave rankings untouched so the overlay only bites when the
// composite risk model (crashIndicator.js) actually flags stress.
const REGIME_MULTIPLIERS = {
  calm:     { bullish: 1.00, bearish: 1.00 },
  watch:    { bullish: 1.00, bearish: 1.00 },
  elevated: { bullish: 0.85, bearish: 1.10 },
  high:     { bullish: 0.70, bearish: 1.20 },
  severe:   { bullish: 0.50, bearish: 1.25 },
};

/**
 * Summarize the crash regime for the UI and return per-direction multipliers.
 * @param {{score:number, level:string, label?:string}|null} crashRisk
 */
function buildRegime(crashRisk) {
  if (!crashRisk || crashRisk.score == null || !REGIME_MULTIPLIERS[crashRisk.level]) return null;
  const { score, level } = crashRisk;
  const label = crashRisk.label || level;
  const stressed = ['elevated', 'high', 'severe'].includes(level);
  let note;
  if (stressed) {
    note = `Crash Radar ${label} (${score.toFixed(0)}/100): bullish setups are de-rated ×${REGIME_MULTIPLIERS[level].bullish.toFixed(2)} and bearish setups lifted. Consider pairing any new long exposure with a hedge.`;
  } else if (level === 'watch') {
    note = `Crash Radar Watch (${score.toFixed(0)}/100): rankings unchanged, but review hedges before adding leverage.`;
  } else {
    note = `Crash Radar Calm (${score.toFixed(0)}/100): no regime adjustment applied.`;
  }
  return {
    score,
    level,
    label,
    stressed,
    multipliers: REGIME_MULTIPLIERS[level],
    note,
    hedgeHint: 'See the Crash Thesis tab for volatility calendars, put diagonals, and a kill-switch hedge.',
  };
}

function applyRegime(rec, regime) {
  if (!regime) return rec;
  const mult = regime.multipliers[rec.direction] ?? 1;
  if (mult !== 1) {
    rec.opportunityScore = Math.max(0, Math.min(100, rec.opportunityScore * mult));
    rec.regimeNote = `${rec.direction === 'bullish' ? 'De-rated' : 'Boosted'} ×${mult.toFixed(2)} for Crash Radar ${regime.label}.`;
  }
  return rec;
}

// ─── Main entry point ────────────────────────────────────

/**
 * Build options opportunities from analyzed assets and their option chains.
 *
 * @param {object} params
 * @param {{symbol:string, name:string, history:object}[]} params.universe  — assets to scan
 * @param {Map<string, {expirations:number[], calls:object[], puts:object[], underlyingPrice:number, expirationDate:number}>} params.chains — option chains by symbol (nearest expiry)
 * @param {Map<string, Map<string, object>>} [params.chainsByBand] — chains keyed by symbol→band→chain
 * @param {Set<string>} [params.heldSet] — symbols the user holds
 * @param {number} [params.allocationPerTrade] — $ allocated per trade (for drawdown guard)
 * @param {{score:number, level:string, label?:string}} [params.crashRisk] — Crash Radar result; de-rates bullish picks in stressed regimes
 * @returns {{ bands: object[], regime: object|null, asOf: string }}
 */
export function buildOptionsOpportunities(params = {}) {
  const { universe = [], chains = new Map(), chainsByBand, heldSet, allocationPerTrade = 10000, crashRisk = null } = params;
  const regime = buildRegime(crashRisk);

  // Analyze each asset's momentum
  const analyzed = universe.map((a) => {
    const asset = analyzeAsset(a.history, { symbol: a.symbol, name: a.name });
    return asset;
  }).filter((a) => !a.insufficientData);

  // Build recommendations per band
  const bandResults = {};

  for (const bandKey of ['short', 'medium', 'leaps']) {
    const bandDef = BANDS[bandKey];
    const recs = [];

    for (const asset of analyzed) {
      // Prefer band-specific chain if available, fall back to generic chain
      const chain = (chainsByBand?.get(asset.symbol)?.get(bandKey)) || chains.get(asset.symbol);
      if (!chain) continue;

      // Pick the best expiry for this band
      const bestExpiry = pickExpiry(chain.expirations, bandKey);
      if (!bestExpiry) continue;

      const dte = daysToExpiration(bestExpiry);
      if (dte == null) continue;

      // Use the chain if its expiration matches, otherwise skip (server will fetch correct one)
      if (chain.expirationDate !== bestExpiry) continue;

      // For LEAPS, also grab a short-dated chain for PMCC diagonal
      let shortChain = null;
      if (bandKey === 'leaps') {
        shortChain = (chainsByBand?.get(asset.symbol)?.get('short')) || chains.get(asset.symbol);
        // Ensure short chain is actually shorter-dated than the LEAPS chain
        const shortDte = shortChain ? daysToExpiration(shortChain.expirationDate) : null;
        const leapsDte = daysToExpiration(chain.expirationDate);
        if (shortDte == null || (leapsDte != null && shortDte >= leapsDte)) {
          shortChain = null;
        }
      }

      const rec = selectStrategy(asset, chain, bandKey, heldSet, shortChain);
      if (rec) {
        applyRegime(rec, regime);
        // Drawdown guard check
        if (allocationPerTrade > 0 && rec.maxLoss > 0) {
          const lossPct = (rec.maxLoss / allocationPerTrade) * 100;
          rec.drawdownFlag = lossPct > DRAWDOWN_GUARD_PCT;
          rec.lossPctOfAllocation = +lossPct.toFixed(1);
        }
        recs.push(rec);
      }
    }

    // Sort by opportunity score (desc), then by PoP (desc)
    recs.sort((a, b) => {
      if (b.opportunityScore !== a.opportunityScore) {
        return b.opportunityScore - a.opportunityScore;
      }
      const popA = a.probabilityOfProfit ?? 0;
      const popB = b.probabilityOfProfit ?? 0;
      return popB - popA;
    });

    bandResults[bandKey] = recs.slice(0, MAX_RECS_PER_BAND);
  }

  return {
    bands: [
      { band: 'short', ...BANDS.short, recommendations: bandResults.short || [] },
      { band: 'medium', ...BANDS.medium, recommendations: bandResults.medium || [] },
      { band: 'leaps', ...BANDS.leaps, recommendations: bandResults.leaps || [] },
    ],
    regime,
    asOf: new Date().toISOString(),
  };
}

export { BANDS, daysToExpiration, classifyBand, computeOpportunityScore, computeBandAdjustedScore, getDirection };

// Expose internals for unit testing
export const _internal = {
  selectStrategy,
  buildPMCC,
  buildDebitSpread,
  buildIncomeSpread,
  buildDirectionalBuy,
  avgChainIV,
  pickCallByDelta,
  estimateDelta,
  hasTradeableQuote,
  buildRegime,
  REGIME_MULTIPLIERS,
  MIN_RETURN_ON_CAPITAL,
  MIN_POP,
  MIN_CREDIT_RETURN_ON_CAPITAL,
  MIN_CREDIT_POP,
  HIGH_IV_THRESHOLD,
};
