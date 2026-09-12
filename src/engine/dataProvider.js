/**
 * Data Provider Abstraction Layer
 *
 * Provides a unified interface for fetching market data from either
 * IBKR (primary, real-time) or Yahoo Finance (fallback, delayed).
 *
 * The provider is selected based on:
 * 1. DATA_PROVIDER env var: "auto" | "ibkr" | "yahoo"
 * 2. IBKR gateway health check (in "auto" mode)
 * 3. Runtime fallback (IBKR call fails → retry with Yahoo)
 *
 * All methods return Yahoo Finance-compatible data shapes so the
 * existing frontend code works without changes.
 *
 * @module dataProvider
 */

import YahooFinance from 'yahoo-finance2';
import * as ibkr from './ibkrProvider.js';

const yahooFinance = new YahooFinance();

let currentProvider = null; // 'ibkr' | 'yahoo'
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 30_000; // re-check every 30s

function getDataProviderConfig() {
  return (process.env.DATA_PROVIDER || 'auto').toLowerCase();
}

// ─── Provider selection ──────────────────────────────────
/**
 * Determine which provider to use based on config and gateway health.
 * @returns {Promise<'ibkr' | 'yahoo'>}
 */
async function selectProvider() {
  const DATA_PROVIDER = getDataProviderConfig();
  if (DATA_PROVIDER === 'yahoo') return 'yahoo';
  if (DATA_PROVIDER === 'ibkr') return 'ibkr'; // trust the user, don't auto-fallback

  // Auto mode: check IBKR health, fall back to Yahoo if down
  const now = Date.now();
  if (currentProvider && now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return currentProvider;
  }

  lastHealthCheck = now;
  const health = await ibkr.healthCheck();

  if (health.online && health.authenticated) {
    if (currentProvider !== 'ibkr') {
      console.log('[DataProvider] Switching to IBKR (real-time data)');
      ibkr.startHeartbeat();
    }
    currentProvider = 'ibkr';
  } else {
    if (currentProvider === 'ibkr') {
      console.log('[DataProvider] IBKR unavailable, falling back to Yahoo Finance');
    }
    currentProvider = 'yahoo';
    ibkr.stopHeartbeat();
  }

  return currentProvider;
}

/**
 * Get the current active provider name.
 * @returns {Promise<'ibkr' | 'yahoo'>}
 */
export async function getActiveProvider() {
  return selectProvider();
}

/**
 * Force a health check and return the current status.
 * @returns {Promise<object>}
 */
export async function getStatus() {
  const ibkrHealth = await ibkr.healthCheck();
  const config = getDataProviderConfig();
  const provider = config === 'yahoo' ? 'yahoo' :
                   config === 'ibkr' ? 'ibkr' :
                   (ibkrHealth.online && ibkrHealth.authenticated ? 'ibkr' : 'yahoo');

  return {
    provider,
    config,
    ibkr: ibkrHealth,
    timestamp: Date.now(),
  };
}

// ─── Yahoo Finance helpers (mirror existing server.js logic) ──
async function yahooGetQuotes(symbols) {
  const results = await yahooFinance.quote(symbols, {}, { validateResult: false });
  const quotes = (Array.isArray(results) ? results : [results]).map((q) => ({
    symbol: q.symbol,
    name: q.shortName || q.longName || q.symbol,
    price: q.regularMarketPrice ?? 0,
    change: q.regularMarketChange ?? 0,
    changePercent: q.regularMarketChangePercent ?? 0,
    previousClose: q.regularMarketPreviousClose ?? 0,
    open: q.regularMarketOpen ?? 0,
    dayHigh: q.regularMarketDayHigh ?? 0,
    dayLow: q.regularMarketDayLow ?? 0,
    volume: q.regularMarketVolume ?? 0,
    marketCap: q.marketCap ?? 0,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? 0,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? 0,
    fiftyDayAvg: q.fiftyDayAverage ?? 0,
    twoHundredDayAvg: q.twoHundredDayAverage ?? 0,
    exchange: q.exchange || '',
    marketState: q.marketState || 'CLOSED',
    currency: q.currency || 'USD',
    regularMarketTime: q.regularMarketTime
      ? new Date(q.regularMarketTime).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
        })
      : '',
    _source: 'yahoo',
  }));
  return quotes;
}

async function yahooGetHistory(symbol, range = '1y', interval = '1d') {
  const rangeMap = { '1d': 1, '5d': 5, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825, '10y': 3650, 'max': 36500 };
  const days = rangeMap[range] || 365;
  const period1 = new Date(Date.now() - days * 86400000);

  const result = await yahooFinance.chart(symbol, { period1, interval }, { validateResult: false });
  const quotes = result.quotes || [];

  return {
    dates: quotes.map((q) => q.date.toISOString().slice(0, 10)),
    closes: quotes.map((q) => q.close),
    highs: quotes.map((q) => q.high),
    lows: quotes.map((q) => q.low),
    opens: quotes.map((q) => q.open),
    volumes: quotes.map((q) => q.volume),
    meta: result.meta ? {
      regularMarketPrice: result.meta.regularMarketPrice,
      chartPreviousClose: result.meta.chartPreviousClose,
      fiftyTwoWeekHigh: result.meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: result.meta.fiftyTwoWeekLow,
      shortName: result.meta.shortName,
      symbol: result.meta.symbol,
      exchangeName: result.meta.exchangeName,
      regularMarketVolume: result.meta.regularMarketVolume,
    } : null,
    _source: 'yahoo',
  };
}

async function yahooGetOptions(symbol, date) {
  const opts = {};
  if (date) opts.date = new Date(parseInt(date) * 1000);
  const result = await yahooFinance.options(symbol, opts, { validateResult: false });

  const mapContract = (c) => ({
    strike: c.strike,
    lastPrice: c.lastPrice ?? 0,
    bid: c.bid ?? 0,
    ask: c.ask ?? 0,
    change: c.change ?? 0,
    changePercent: c.percentChange ?? 0,
    volume: c.volume ?? 0,
    openInterest: c.openInterest ?? 0,
    impliedVolatility: c.impliedVolatility ?? 0,
    inTheMoney: c.inTheMoney ?? false,
    contractSymbol: c.contractSymbol || '',
    expiration: c.expiration ? Math.floor(new Date(c.expiration).getTime() / 1000) : 0,
  });

  return {
    expirations: (result.expirationDates || []).map((d) => Math.floor(new Date(d).getTime() / 1000)),
    strikes: result.strikes || [],
    calls: (result.options?.[0]?.calls || []).map(mapContract),
    puts: (result.options?.[0]?.puts || []).map(mapContract),
    underlyingPrice: result.quote?.regularMarketPrice ?? 0,
    underlyingName: result.quote?.shortName || symbol,
    expirationDate: result.options?.[0]?.expirationDate
      ? Math.floor(new Date(result.options[0].expirationDate).getTime() / 1000)
      : 0,
    _source: 'yahoo',
  };
}

// ─── Unified API (with fallback) ─────────────────────────

/**
 * Get quotes for multiple symbols.
 * Tries IBKR first, falls back to Yahoo on error.
 * @param {string[]} symbols
 * @returns {Promise<{ quotes: Array, provider: string }>}
 */
export async function getQuotes(symbols) {
  if (!symbols.length) return { quotes: [], provider: 'none' };

  const provider = await selectProvider();

  if (provider === 'ibkr') {
    try {
      const quotes = await ibkr.getQuotes(symbols);
      if (quotes.length > 0) return { quotes, provider: 'ibkr' };
      // IBKR returned nothing — fall through to Yahoo
    } catch (e) {
      console.warn('[DataProvider] IBKR quotes failed, falling back to Yahoo:', e.message);
    }
  }

  // Yahoo fallback
  try {
    const quotes = await yahooGetQuotes(symbols);
    return { quotes, provider: 'yahoo' };
  } catch (e) {
    console.error('[DataProvider] Yahoo quotes also failed:', e.message);
    return { quotes: [], provider: 'none', error: e.message };
  }
}

/**
 * Get historical data for a symbol.
 * Tries IBKR first, falls back to Yahoo on error.
 * @param {string} symbol
 * @param {string} range
 * @param {string} interval
 * @returns {Promise<{ data: object, provider: string }>}
 */
export async function getHistory(symbol, range = '1y', interval = '1d') {
  const provider = await selectProvider();

  if (provider === 'ibkr') {
    try {
      const data = await ibkr.getHistory(symbol, range, interval);
      if (data.dates && data.dates.length > 0) return { data, provider: 'ibkr' };
    } catch (e) {
      console.warn(`[DataProvider] IBKR history failed for ${symbol}, falling back to Yahoo:`, e.message);
    }
  }

  // Yahoo fallback
  try {
    const data = await yahooGetHistory(symbol, range, interval);
    return { data, provider: 'yahoo' };
  } catch (e) {
    console.error(`[DataProvider] Yahoo history also failed for ${symbol}:`, e.message);
    return {
      data: { dates: [], closes: [], highs: [], lows: [], opens: [], volumes: [], meta: null },
      provider: 'none',
      error: e.message,
    };
  }
}

/**
 * Get options chain for a symbol.
 * Tries IBKR first, falls back to Yahoo on error.
 * @param {string} symbol
 * @param {number} [expirationTimestamp]
 * @returns {Promise<{ data: object, provider: string }>}
 */
export async function getOptions(symbol, expirationTimestamp) {
  const provider = await selectProvider();

  if (provider === 'ibkr') {
    try {
      const data = await ibkr.getOptions(symbol, expirationTimestamp);
      // IBKR options may not have full greeks — fall back to Yahoo if calls/puts are empty
      if (data.calls && data.calls.length > 0) return { data, provider: 'ibkr' };
    } catch (e) {
      console.warn(`[DataProvider] IBKR options failed for ${symbol}, falling back to Yahoo:`, e.message);
    }
  }

  // Yahoo fallback
  try {
    const data = await yahooGetOptions(symbol, expirationTimestamp);
    return { data, provider: 'yahoo' };
  } catch (e) {
    console.error(`[DataProvider] Yahoo options also failed for ${symbol}:`, e.message);
    return {
      data: { expirations: [], strikes: [], calls: [], puts: [], underlyingPrice: 0, underlyingName: symbol, expirationDate: 0 },
      provider: 'none',
      error: e.message,
    };
  }
}
