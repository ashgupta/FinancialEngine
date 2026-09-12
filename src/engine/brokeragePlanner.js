/**
 * Brokerage (taxable account) Investment Planner.
 *
 * Pure-function idea generator. Given the user's risk tolerance, total account
 * value, available cash, watchlist, and (optionally) current holdings,
 * produce concrete suggestions in 4 buckets:
 *
 *  1. Tax-aware ETF core allocation
 *  2. Hedge suggestions (sized to portfolio value)
 *  3. Stock picks from the watchlist (sentiment + momentum)
 *  4. Options ideas (covered calls / cash-secured puts / spreads)
 *
 * Returns plain data; the UI renders cards. No fetching, no DOM.
 */

import { getRecommendedAllocation } from './portfolio.js';

// Tax-aware ETF substitutions for TAXABLE accounts.
// Same risk profile as the standard menu but optimized for after-tax returns.
const TAX_AWARE_ETF_MAP = {
  us_equity:    { ticker: 'VTI',  name: 'Vanguard Total Stock Market',          rationale: 'Broad, low-turnover, qualified dividends' },
  intl_equity:  { ticker: 'VXUS', name: 'Vanguard Total International',         rationale: 'Foreign tax credit eligible' },
  us_bonds:     { ticker: 'VTEB', name: 'Vanguard Tax-Exempt Bond (Muni)',      rationale: 'Federal tax-free interest — beats VBTLX in taxable for high earners' },
  intl_bonds:   { ticker: 'BNDX', name: 'Vanguard Total International Bond',    rationale: 'Currency-hedged; place in IRA if room' },
  tips:         { ticker: 'SCHP', name: 'Schwab US TIPS ETF',                   rationale: 'Inflation hedge; ideally held in tax-advantaged' },
  real_estate:  { ticker: 'VNQ',  name: 'Vanguard Real Estate ETF',             rationale: 'Non-qualified divs — consider IRA if held large' },
  commodities:  { ticker: 'PDBC', name: 'Invesco Optimum Yield Commodity',      rationale: 'No K-1 form, simpler taxes than GSG' },
  cash:         { ticker: 'SGOV', name: 'iShares 0-3 Month Treasury',           rationale: 'State-tax-free yield' },
};

/**
 * Hedging budget as % of portfolio value, by risk tolerance.
 * Conservative profiles get more hedging.
 */
function hedgeBudgetPct(riskTolerance) {
  return Math.max(0.01, 0.08 - riskTolerance * 0.006); // ~7.4% @ risk 1 → ~2% @ risk 10
}

function cashBufferPct(riskTolerance) {
  return Math.max(0.02, 0.15 - riskTolerance * 0.012); // 13.8% @ risk 1 → 3% @ risk 10
}

/**
 * Build the tax-aware ETF core allocation.
 */
export function buildTaxAwareCore(riskTolerance, accountValue) {
  const model = getRecommendedAllocation(riskTolerance);
  const buffer = cashBufferPct(riskTolerance);
  const investable = 1 - buffer;

  const positions = model.allocation.map((a) => {
    const sub = TAX_AWARE_ETF_MAP[a.id] ?? { ticker: a.ticker, name: a.name, rationale: '' };
    const weight = a.weight * investable;
    return {
      assetClass: a.id,
      assetClassName: a.name,
      ticker: sub.ticker,
      name: sub.name,
      rationale: sub.rationale,
      weight,
      dollars: Math.round(weight * accountValue),
    };
  });

  // Merge cash buffer into existing cash position if model already allocates to cash,
  // otherwise append a standalone cash-buffer entry. Prevents duplicate SGOV keys.
  const existingCash = positions.find(p => p.assetClass === 'cash');
  if (existingCash) {
    existingCash.weight += buffer;
    existingCash.dollars = Math.round(existingCash.weight * accountValue);
    existingCash.rationale += ` + ${(buffer * 100).toFixed(0)}% tactical cash buffer.`;
  } else {
    positions.push({
      assetClass: 'cash',
      assetClassName: 'Cash Buffer',
      ticker: 'SGOV',
      name: 'Cash Buffer (T-bill ETF)',
      rationale: `Hedge against drawdown; ${(buffer * 100).toFixed(0)}% reserve for opportunities & emergencies`,
      weight: buffer,
      dollars: Math.round(buffer * accountValue),
    });
  }

  return {
    positions,
    expectedReturn: model.expectedReturn * investable,
    cashBufferPct: buffer,
  };
}

/**
 * Generate hedge suggestions sized to portfolio value.
 */
export function buildHedgeSuggestions(riskTolerance, accountValue, currentLongValue = 0) {
  const budget = hedgeBudgetPct(riskTolerance);
  const budgetDollars = Math.round(budget * accountValue);
  const longExposure = currentLongValue > 0 ? currentLongValue : accountValue * 0.7;

  const hedges = [];

  // 1. Broad portfolio put — 5% OTM SPY puts, 90 DTE
  hedges.push({
    type: 'protective_put',
    title: 'Broad Portfolio Put (SPY 5% OTM, ~90 DTE)',
    description: 'Buy SPY puts ~5% below current spot, 60–90 days out. Rolls quarterly. Caps drawdown beyond 5%.',
    sizing: `~${Math.round(longExposure * 0.01 / 100)} contracts (1 per $10k of equity exposure)`,
    estimatedCost: Math.round(longExposure * 0.012), // ~1.2% of exposure per quarter
    fitScore: riskTolerance <= 6 ? 'high' : 'medium',
  });

  // 2. VIX call hedge
  hedges.push({
    type: 'vix_hedge',
    title: 'VIX Call Hedge (tail-risk insurance)',
    description: 'Long VIX calls 25-30 strike, 60-90 DTE. Pays off violently in market stress.',
    sizing: `${Math.round(budgetDollars * 0.15 / 200)} contracts (assume ~$2/contract premium)`,
    estimatedCost: Math.round(budgetDollars * 0.15),
    fitScore: riskTolerance <= 5 ? 'high' : 'low',
  });

  // 3. Collar on largest concentrated position (if holdings provided)
  hedges.push({
    type: 'collar',
    title: 'Collar on Concentrated Positions',
    description: 'For any holding > 10% of portfolio: sell OTM call + buy OTM put. Zero-cost collar locks in a range.',
    sizing: 'Per-symbol, sized to position',
    estimatedCost: 0,
    fitScore: 'high',
  });

  // 4. Cash buffer is the simplest hedge
  hedges.push({
    type: 'cash_buffer',
    title: `Cash Buffer (${(cashBufferPct(riskTolerance) * 100).toFixed(0)}% of portfolio)`,
    description: 'T-bills (SGOV) earn ~5% with zero drawdown. Lets you BUY during corrections.',
    sizing: `$${Math.round(accountValue * cashBufferPct(riskTolerance)).toLocaleString()} target`,
    estimatedCost: 0,
    fitScore: 'high',
  });

  return { budgetDollars, hedges };
}

/**
 * Rank watchlist symbols by sentiment + recent return.
 * `watchlist` = [{symbol, name}, …]
 * `stats` = symbol → { netSentiment: number, postsPerHour: number, ... } from Social Pulse
 * `quotes` = symbol → { price, trailingReturn, trailingVol, ... }
 */
export function buildWatchlistPicks(watchlist, stats = {}, quotes = {}) {
  const picks = watchlist.map((w) => {
    const s = stats[w.symbol] ?? {};
    const q = quotes[w.symbol] ?? {};
    const sentiment = s.netSentiment ?? 0;
    const trail = q.trailingReturn ?? 0;
    const buzz = s.postsPerHour ?? 0;
    // Composite: 50% sentiment, 30% momentum, 20% buzz (capped)
    const score = sentiment * 0.5 + Math.tanh(trail) * 0.3 + Math.tanh(buzz / 5) * 0.2;
    return {
      symbol: w.symbol,
      name: w.name,
      price: q.price ?? null,
      sentiment,
      trailingReturn: trail,
      postsPerHour: buzz,
      score,
      verdict:
        score > 0.25 ? 'bullish' :
        score < -0.25 ? 'bearish' : 'neutral',
    };
  });

  return {
    bullish: picks.filter(p => p.verdict === 'bullish').sort((a, b) => b.score - a.score).slice(0, 5),
    bearish: picks.filter(p => p.verdict === 'bearish').sort((a, b) => a.score - b.score).slice(0, 5),
    neutral: picks.filter(p => p.verdict === 'neutral').slice(0, 5),
  };
}

/**
 * Generate options-strategy ideas based on current holdings + watchlist.
 * holdings = [{symbol, quantity, marketValue, classification: 'equity'|'etf'|'option'|...}]
 */
export function buildOptionsIdeas(holdings = [], bullishPicks = [], bearishPicks = [], riskTolerance = 5) {
  const ideas = [];

  // Covered calls on long stock/ETF positions ≥ 100 shares
  const callCandidates = holdings.filter(
    h => (h.classification === 'equity' || h.classification === 'etf') &&
         h.quantity >= 100 && h.marketValue > 0
  );
  for (const h of callCandidates.slice(0, 5)) {
    ideas.push({
      type: 'covered_call',
      title: `Covered Call on ${h.symbol}`,
      description: `Sell ${Math.floor(h.quantity / 100)} call(s) ~5-7% OTM, 30-45 DTE. Generates 0.5-1.5% monthly income; caps upside.`,
      symbol: h.symbol,
      estimatedIncome: Math.round(h.marketValue * 0.008), // ~0.8%/mo
      fitScore: riskTolerance <= 7 ? 'high' : 'medium',
      reasoning: 'You own the underlying — generates income with no new capital required.',
    });
  }

  // Cash-secured puts on bullish watchlist names you don't yet own
  const heldSymbols = new Set(holdings.map(h => h.symbol));
  for (const p of bullishPicks.slice(0, 3)) {
    if (heldSymbols.has(p.symbol)) continue;
    if (!p.price) continue;
    const strike = Math.round(p.price * 0.95);
    ideas.push({
      type: 'cash_secured_put',
      title: `Cash-Secured Put on ${p.symbol}`,
      description: `Sell ${strike}-strike put, 30-45 DTE. Either collect premium or buy ${p.symbol} at ~5% discount.`,
      symbol: p.symbol,
      strike,
      estimatedIncome: Math.round(p.price * 100 * 0.015), // ~1.5% of notional
      fitScore: 'high',
      reasoning: `Sentiment ${(p.sentiment * 100).toFixed(0)}, momentum trailing ${(p.trailingReturn * 100).toFixed(1)}% — willing to own at lower price.`,
    });
  }

  // Bull put spreads on strong bullish names
  for (const p of bullishPicks.slice(0, 2)) {
    if (!p.price) continue;
    const shortStrike = Math.round(p.price * 0.95);
    const longStrike = Math.round(p.price * 0.90);
    ideas.push({
      type: 'bull_put_spread',
      title: `Bull Put Spread on ${p.symbol}`,
      description: `Sell ${shortStrike}P / Buy ${longStrike}P, 30-45 DTE. Defined-risk bullish play.`,
      symbol: p.symbol,
      shortStrike, longStrike,
      maxRiskPerContract: (shortStrike - longStrike) * 100,
      fitScore: riskTolerance >= 6 ? 'high' : 'medium',
      reasoning: 'Defined-risk alternative to CSP — needs less capital.',
    });
  }

  // Bearish: bear call spreads on bearish picks
  for (const p of bearishPicks.slice(0, 2)) {
    if (!p.price) continue;
    const shortStrike = Math.round(p.price * 1.05);
    const longStrike = Math.round(p.price * 1.10);
    ideas.push({
      type: 'bear_call_spread',
      title: `Bear Call Spread on ${p.symbol}`,
      description: `Sell ${shortStrike}C / Buy ${longStrike}C, 30-45 DTE. Defined-risk bearish play.`,
      symbol: p.symbol,
      shortStrike, longStrike,
      maxRiskPerContract: (longStrike - shortStrike) * 100,
      fitScore: riskTolerance >= 6 ? 'medium' : 'low',
      reasoning: 'Negative sentiment + defined risk on upside.',
    });
  }

  return ideas;
}

/**
 * Top-level: build the complete brokerage plan.
 */
export function buildBrokeragePlan({
  riskTolerance,
  accountValue,
  cashAvailable = 0,
  watchlist = [],
  socialStats = {},
  quotes = {},
  holdings = [],
}) {
  const core   = buildTaxAwareCore(riskTolerance, accountValue);
  const hedges = buildHedgeSuggestions(riskTolerance, accountValue,
                  holdings.reduce((s, h) => s + (h.marketValue ?? 0), 0));
  const picks  = buildWatchlistPicks(watchlist, socialStats, quotes);
  const options = buildOptionsIdeas(holdings, picks.bullish, picks.bearish, riskTolerance);

  return { core, hedges, picks, options };
}
