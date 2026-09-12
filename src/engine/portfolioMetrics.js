/**
 * portfolioMetrics.js
 * Pure engine: EnrichedPosition[] → PortfolioMetrics
 *
 * Constitution Principle II: no React, no DOM, no I/O.
 * Constitution Principle VIII: never fabricates prices; missing data is
 *   represented as null, not guessed.
 * Constitution Principle VII: maxDrawdown helper used for drawdown check.
 */

/**
 * @typedef {import('./portfolioParser.js').Position} Position
 *
 * @typedef {Object} Quote
 * @property {number}      price
 * @property {number|null} previousClose
 * @property {number|null} dividendYield  - annual yield as decimal (0.015 = 1.5%)
 * @property {string|null} quoteType      - 'ETF', 'EQUITY', etc.
 * @property {string}      fetchedAt      - ISO 8601 UTC
 * @property {string}      source         - e.g. 'Yahoo Finance'
 *
 * @typedef {Object} EnrichedPosition
 * @property {string}  symbol
 * @property {number}  quantity
 * @property {number|null} costBasis
 * @property {string}  description
 * @property {string}  account
 * @property {'equity'|'etf'|'bond'|'reit'|'cash'|'unknown'} classification
 * @property {boolean} isUsSitus
 * @property {number|null} currentPrice
 * @property {number|null} currentValue
 * @property {number|null} unrealizedGain
 * @property {number|null} dayChangePct
 * @property {number|null} dividendYield
 * @property {number}  allocationPct      - 0–100, set after full enrichment
 * @property {boolean} priceAvailable
 * @property {string|null} fetchedAt
 * @property {string|null} source
 *
 * @typedef {Object} AllocationBreakdown
 * @property {number} equity
 * @property {number} etf
 * @property {number} bond
 * @property {number} reit
 * @property {number} cash
 * @property {number} option
 * @property {number} unknown
 *
 * @typedef {Object} ConcentrationRisk
 * @property {{ symbol: string, pct: number }[]} top5
 * @property {string[]} exceeds20pct   - symbols with >20% concentration
 *
 * @typedef {Object} UsSitusBreakdown
 * @property {number} usSitusValue
 * @property {number} nonUsSitusValue
 * @property {number} usSitusPct
 * @property {number} nraEstateTaxExposure  - max exposure above $60K NRA exemption
 *
 * @typedef {Object} OptionSummary
 * @property {number}  totalContracts
 * @property {number}  callCount      number of call positions
 * @property {number}  putCount       number of put positions
 * @property {Record<string, { calls:number, puts:number, contracts:number }>} byUnderlying
 *
 * @typedef {Object} PortfolioMetrics
 * @property {EnrichedPosition[]} positions
 * @property {number}              totalValue
 * @property {number|null}         totalUnrealizedGain
 * @property {number|null}         totalDayChange
 * @property {number|null}         weightedDividendYield  - decimal
 * @property {AllocationBreakdown} allocation
 * @property {ConcentrationRisk}   concentration
 * @property {UsSitusBreakdown}    usSitus
 * @property {OptionSummary}       optionSummary
 * @property {number}              maxDrawdownPct         - 0 in v1 (requires historical series)
 * @property {boolean}             drawdownWarning        - true if maxDrawdownPct > 0.15
 */

const NRA_ESTATE_EXEMPTION = 60_000; // IRC §2104 / §2106; Source: IRS Pub 559 (2024)

/**
 * Enrich raw positions with live quote data.
 * @param {Position[]} positions
 * @param {Record<string, Quote>} quotes  - keyed by symbol (uppercase)
 * @returns {EnrichedPosition[]}
 */
export function enrich(positions, quotes) {
  if (!Array.isArray(positions)) return [];
  if (!quotes || typeof quotes !== 'object') quotes = {};

  const enriched = positions.map(pos => {
    const quote = quotes[pos.symbol] || null;
    const priceAvailable = quote !== null && typeof quote.price === 'number' && !isNaN(quote.price);

    const currentPrice = priceAvailable ? quote.price : null;
    const currentValue = priceAvailable ? pos.quantity * quote.price : null;

    let unrealizedGain = null;
    if (currentValue !== null && pos.costBasis !== null) {
      unrealizedGain = currentValue - pos.costBasis;
    }

    let dayChangePct = null;
    if (priceAvailable && quote.previousClose != null && quote.previousClose !== 0) {
      dayChangePct = (quote.price - quote.previousClose) / quote.previousClose;
    }

    const dividendYield = priceAvailable ? (quote.dividendYield ?? null) : null;

    return {
      ...pos,
      currentPrice,
      currentValue,
      unrealizedGain,
      dayChangePct,
      dividendYield,
      allocationPct: 0,
      priceAvailable,
      fetchedAt: quote?.fetchedAt ?? null,
      source: quote?.source ?? null,
    };
  });

  const totalValue = enriched.reduce((s, p) => s + (p.currentValue ?? 0), 0);

  return enriched.map(p => ({
    ...p,
    allocationPct: totalValue > 0 && p.currentValue != null
      ? (p.currentValue / totalValue) * 100
      : 0,
  }));
}

/**
 * Compute aggregate portfolio metrics from enriched positions.
 * @param {EnrichedPosition[]} positions
 * @returns {PortfolioMetrics}
 */
export function computeMetrics(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return {
      positions: [],
      totalValue: 0,
      totalUnrealizedGain: null,
      totalDayChange: null,
      weightedDividendYield: null,
      allocation: { equity: 0, etf: 0, bond: 0, reit: 0, cash: 0, option: 0, unknown: 0 },
      concentration: { top5: [], exceeds20pct: [] },
      usSitus: { usSitusValue: 0, nonUsSitusValue: 0, usSitusPct: 0, nraEstateTaxExposure: 0 },
      optionSummary: { totalContracts: 0, callCount: 0, putCount: 0, byUnderlying: {} },
      maxDrawdownPct: 0,
      drawdownWarning: false,
    };
  }

  const totalValue = positions.reduce((s, p) => s + (p.currentValue ?? 0), 0);

  let totalUnrealizedGain = null;
  let hasAnyGain = false;
  let gainSum = 0;
  for (const p of positions) {
    if (p.unrealizedGain !== null) {
      gainSum += p.unrealizedGain;
      hasAnyGain = true;
    }
  }
  if (hasAnyGain) totalUnrealizedGain = gainSum;

  let totalDayChange = null;
  let hasDayChange = false;
  let dayChangeSum = 0;
  for (const p of positions) {
    if (p.dayChangePct !== null && p.currentValue !== null) {
      const prevValue = p.currentValue / (1 + p.dayChangePct);
      dayChangeSum += p.currentValue - prevValue;
      hasDayChange = true;
    }
  }
  if (hasDayChange) totalDayChange = dayChangeSum;

  let weightedDividendYield = null;
  let yieldWeightSum = 0;
  let yieldHasData = false;
  for (const p of positions) {
    if (p.dividendYield !== null && p.currentValue !== null && p.currentValue > 0) {
      yieldWeightSum += p.dividendYield * p.currentValue;
      yieldHasData = true;
    }
  }
  if (yieldHasData && totalValue > 0) {
    weightedDividendYield = yieldWeightSum / totalValue;
  }

  const allocation = { equity: 0, etf: 0, bond: 0, reit: 0, cash: 0, option: 0, unknown: 0 };
  for (const p of positions) {
    const cls = p.classification || 'unknown';
    if (allocation[cls] !== undefined) {
      allocation[cls] += p.allocationPct;
    }
  }

  const sorted = [...positions]
    .filter(p => p.currentValue != null)
    .sort((a, b) => (b.currentValue ?? 0) - (a.currentValue ?? 0));
  const top5 = sorted.slice(0, 5).map(p => ({
    symbol: p.symbol,
    pct: totalValue > 0 ? (p.currentValue / totalValue) * 100 : 0,
  }));
  const exceeds20pct = top5.filter(p => p.pct > 20).map(p => p.symbol);
  const concentration = { top5, exceeds20pct };

  let usSitusValue = 0;
  let nonUsSitusValue = 0;
  for (const p of positions) {
    const val = p.currentValue ?? 0;
    if (p.isUsSitus) usSitusValue += val;
    else nonUsSitusValue += val;
  }
  const usSitusPct = totalValue > 0 ? (usSitusValue / totalValue) * 100 : 0;
  const nraEstateTaxExposure = Math.max(0, usSitusValue - NRA_ESTATE_EXEMPTION);
  const usSitus = { usSitusValue, nonUsSitusValue, usSitusPct, nraEstateTaxExposure };

  // Option summary
  const optionPositions = positions.filter(p => p.classification === 'option');
  const optionSummary = {
    totalContracts: optionPositions.reduce((s, p) => s + p.quantity, 0),
    callCount: optionPositions.filter(p => p.optionType === 'call').length,
    putCount:  optionPositions.filter(p => p.optionType === 'put').length,
    byUnderlying: {},
  };
  for (const p of optionPositions) {
    const ul = p.underlying || 'Unknown';
    if (!optionSummary.byUnderlying[ul])
      optionSummary.byUnderlying[ul] = { calls: 0, puts: 0, contracts: 0 };
    optionSummary.byUnderlying[ul].contracts += p.quantity;
    if (p.optionType === 'call') optionSummary.byUnderlying[ul].calls++;
    else if (p.optionType === 'put') optionSummary.byUnderlying[ul].puts++;
  }

  return {
    positions,
    totalValue,
    totalUnrealizedGain,
    totalDayChange,
    weightedDividendYield,
    allocation,
    concentration,
    usSitus,
    optionSummary,
    maxDrawdownPct: 0,
    drawdownWarning: false,
  };
}
