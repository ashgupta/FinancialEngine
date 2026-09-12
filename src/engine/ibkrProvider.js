/**
 * IBKR Client Portal Web API Data Provider
 *
 * Connects to the IBKR Client Portal Gateway (running locally on :5010)
 * and provides market data methods that return Yahoo Finance-compatible
 * data shapes, enabling drop-in replacement with automatic fallback.
 *
 * Key IBKR concepts:
 * - conid: numeric contract ID (IBKR's internal identifier for each instrument)
 * - Gateway uses HTTPS with self-signed certs (rejectUnauthorized: false)
 * - Session must be authenticated via browser login at https://localhost:PORT
 * - /tickle endpoint keeps the session alive (call every 60s)
 *
 * @module ibkrProvider
 */

import {
  resolveConids,
  getIbkrSearchSymbol,
  cacheConid,
  getCachedConid,
} from './ibkrSymbolMap.js';

// ─── Configuration ───────────────────────────────────────
const GATEWAY_URL = process.env.IBKR_GATEWAY_URL || 'https://localhost:5010';
const REQUEST_TIMEOUT = 10_000;

// ─── In-memory caches ────────────────────────────────────
const quoteCache = new Map();     // symbol → { data, expiresAt }
const historyCache = new Map();   // key → { data, expiresAt }
const QUOTE_TTL = 10_000;         // 10 seconds (real-time data)
const HISTORY_TTL = 15 * 60_000;  // 15 minutes

// ─── HTTP helper (handles self-signed certs + timeouts) ──
async function ibkrFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${GATEWAY_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
      // Node 20+ supports this for self-signed certs
      // eslint-disable-next-line no-undef
    });
    // We can't easily set rejectUnauthorized in fetch; rely on NODE_TLS_REJECT_UNAUTHORIZED
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`IBKR ${resp.status}: ${text || resp.statusText}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Session management ──────────────────────────────────
let sessionAlive = false;
let heartbeatInterval = null;

/**
 * Check if the IBKR gateway is authenticated and connected.
 * @returns {Promise<{ authenticated: boolean, connected: boolean, accountId?: string }>}
 */
export async function checkAuthStatus() {
  try {
    const status = await ibkrFetch('/v1/portal/iserver/auth/status');
    sessionAlive = status.authenticated && status.connected;
    return {
      authenticated: !!status.authenticated,
      connected: !!status.connected,
      competing: !!status.competing,
      serverVersion: status.serverInfo?.serverVersion || '',
    };
  } catch (e) {
    sessionAlive = false;
    return { authenticated: false, connected: false, error: e.message };
  }
}

/**
 * Keep the IBKR session alive by calling /tickle every 60 seconds.
 * The gateway disconnects after ~6 minutes of inactivity.
 */
export function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(async () => {
    try {
      await ibkrFetch('/v1/portal/iserver/auth/status');
      // Also call tickle to keep the brokerage session alive
      await ibkrFetch('/v1/portal/tickle', { method: 'POST' }).catch(() => {});
    } catch (e) {
      sessionAlive = false;
      console.warn('IBKR heartbeat failed:', e.message);
    }
  }, 60_000);
}

export function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ─── Symbol search ───────────────────────────────────────
/**
 * Search for a symbol on IBKR and return contract info.
 * @param {string} symbol - IBKR search symbol (e.g. 'SPY', 'SPX', 'ES')
 * @param {string} [secType] - Security type filter (STK, IND, FUT, OPT, etc.)
 * @returns {Promise<Array<{ conid: string, symbol: string, companyName: string, secType: string }>>}
 */
export async function searchSymbol(symbol, secType) {
  const params = new URLSearchParams({ symbol });
  const data = await ibkrFetch(`/v1/api/iserver/secdef/search?${params}`);
  if (!Array.isArray(data)) return [];

  return data
    .filter((r) => !secType || r.sections?.some((s) => s.secType === secType))
    .map((r) => ({
      conid: r.conid,
      symbol: r.symbol,
      companyName: r.companyName || r.companyHeader || r.symbol,
      secType: r.sections?.[0]?.secType || 'STK',
    }));
}

// ─── Conid resolution ────────────────────────────────────
/**
 * Resolve a list of Yahoo symbols to IBKR conids.
 * @param {string[]} yahooSymbols
 * @returns {Promise<Map<string, number>>} — Map of yahooSymbol → conid
 */
export async function getConids(yahooSymbols) {
  return resolveConids(yahooSymbols, searchSymbol);
}

// ─── Quote endpoint ──────────────────────────────────────
// IBKR snapshot field IDs:
// 31=LastPrice 84=BidSize 85=BidPrice 86=AskSize 87=AskPrice
// 70=High 71=Low 72=Open 73=Close 74=Change 76=ChangePct
// 77=ChangePctOpen 78=UnrealizedPNL 88=Volume 55=Symbol
// 6004=Exchange 6070=MarketDataAvailability 7285=Week52High 7286=Week52Low
// 6129=Currency 6509=MarketDataStatus

const QUOTE_FIELDS = '31,84,85,86,87,70,71,72,73,74,76,77,88,55,6004,6070,7285,7286,6129';

/**
 * Get real-time quotes for multiple symbols.
 * Returns data in the same shape as the Yahoo /yf/quote endpoint.
 *
 * @param {string[]} yahooSymbols - Yahoo Finance symbols
 * @returns {Promise<Array>} Yahoo-compatible quote objects
 */
export async function getQuotes(yahooSymbols) {
  if (!yahooSymbols.length) return [];

  // Check cache
  const now = Date.now();
  const cached = [];
  const uncached = [];
  for (const sym of yahooSymbols) {
    const c = quoteCache.get(sym);
    if (c && c.expiresAt > now) cached.push(c.data);
    else uncached.push(sym);
  }

  if (uncached.length === 0) return cached;

  // Resolve conids for uncached symbols
  const conidMap = await getConids(uncached);
  const conids = [...conidMap.values()];
  if (conids.length === 0) return cached;

  // Fetch snapshots
  const snapshotData = await ibkrFetch(
    `/v1/api/iserver/marketdata/snapshot?conids=${conids.join(',')}&fields=${QUOTE_FIELDS}`
  );

  // Build reverse map: conid → yahooSymbol
  const conidToYahoo = new Map();
  for (const [yahooSym, conid] of conidMap) {
    conidToYahoo.set(conid, yahooSym);
  }

  const newQuotes = [];
  for (const snap of snapshotData) {
    const conid = snap.conid;
    const yahooSym = conidToYahoo.get(conid);
    if (!yahooSym) continue;

    const price = parseFloat(snap['31']) || 0;
    const bidPrice = parseFloat(snap['85']) || 0;
    const askPrice = parseFloat(snap['87']) || 0;
    const open = parseFloat(snap['72']) || 0;
    const high = parseFloat(snap['70']) || 0;
    const low = parseFloat(snap['71']) || 0;
    const close = parseFloat(snap['73']) || 0;
    const change = parseFloat(snap['74']) || 0;
    const changePct = parseFloat(snap['76']) || 0;
    const volume = parseFloat(snap['88']) || 0;
    const wk52High = parseFloat(snap['7285']) || 0;
    const wk52Low = parseFloat(snap['7286']) || 0;
    const symbol = snap['55'] || yahooSym;
    const currency = snap['6129'] || 'USD';
    const exchange = snap['6004'] || '';
    const mda = snap['6070'] || ''; // market data availability

    const quote = {
      symbol: yahooSym,
      name: symbol,
      price,
      change,
      changePercent: changePct,
      previousClose: close || (price - change),
      open,
      dayHigh: high,
      dayLow: low,
      volume,
      marketCap: 0, // IBKR snapshot doesn't provide market cap
      fiftyTwoWeekHigh: wk52High,
      fiftyTwoWeekLow: wk52Low,
      fiftyDayAvg: 0,  // Not available in snapshot
      twoHundredDayAvg: 0, // Not available in snapshot
      exchange,
      marketState: mda === 'streaming' ? 'OPEN' : 'CLOSED',
      currency,
      regularMarketTime: new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      }),
      bid: bidPrice,
      ask: askPrice,
      _source: 'ibkr',
    };

    quoteCache.set(yahooSym, { data: quote, expiresAt: now + QUOTE_TTL });
    newQuotes.push(quote);
  }

  return [...cached, ...newQuotes];
}

// ─── Historical data endpoint ────────────────────────────
// Yahoo range → IBKR period mapping
const RANGE_TO_IBKR = {
  '1d':   { period: '1d',  bar: '5min' },
  '5d':   { period: '5d',  bar: '30min' },
  '1mo':  { period: '1m',  bar: '1d' },
  '3mo':  { period: '3m',  bar: '1d' },
  '6mo':  { period: '6m',  bar: '1d' },
  '1y':   { period: '12m', bar: '1d' },
  '2y':   { period: '2y',  bar: '1d' },
  '5y':   { period: '5y',  bar: '1wk' },
  '10y':  { period: '10y', bar: '1wk' },
  'max':  { period: '10y', bar: '1wk' },
};

// Yahoo interval → IBKR bar mapping (for when interval is specified separately)
const INTERVAL_TO_IBKR_BAR = {
  '1d': '1d',
  '1wk': '1w',
  '1mo': '1mo',
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
};

/**
 * Get historical OHLCV data for a symbol.
 * Returns data in the same shape as the Yahoo /yf/history endpoint.
 *
 * @param {string} yahooSymbol - Yahoo Finance symbol
 * @param {string} [range='1y'] - Range: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, max
 * @param {string} [interval='1d'] - Bar interval: 1d, 1wk, 1mo, 5m, 15m, 1h
 * @returns {Promise<object>} Yahoo-compatible history object
 */
export async function getHistory(yahooSymbol, range = '1y', interval = '1d') {
  const cacheKey = `${yahooSymbol}:${range}:${interval}`;
  const now = Date.now();
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data;

  // Resolve conid
  const conidMap = await getConids([yahooSymbol]);
  const conid = conidMap.get(yahooSymbol);
  if (!conid) throw new Error(`Cannot resolve conid for ${yahooSymbol}`);

  // Determine IBKR period and bar
  const ibkrRange = RANGE_TO_IBKR[range] || RANGE_TO_IBKR['1y'];
  const ibkrBar = INTERVAL_TO_IBKR_BAR[interval] || ibkrRange.bar;
  const ibkrPeriod = ibkrRange.period;

  // Fetch historical data
  const params = new URLSearchParams({
    conid: String(conid),
    period: ibkrPeriod,
    bar: ibkrBar,
  });

  const result = await ibkrFetch(`/v1/api/hmds/history?${params}`);

  if (!result.data || !result.data[0] || !result.data[0].data) {
    return { dates: [], closes: [], highs: [], lows: [], opens: [], volumes: [], meta: null };
  }

  const bars = result.data[0].data;

  // Convert to Yahoo-compatible format
  const dates = [];
  const closes = [];
  const highs = [];
  const lows = [];
  const opens = [];
  const volumes = [];

  for (const bar of bars) {
    const date = new Date(bar.t);
    dates.push(date.toISOString().slice(0, 10));
    closes.push(bar.c);
    highs.push(bar.h);
    lows.push(bar.l);
    opens.push(bar.o);
    volumes.push(bar.v || 0);
  }

  const data = {
    dates,
    closes,
    highs,
    lows,
    opens,
    volumes,
    meta: {
      regularMarketPrice: closes[closes.length - 1] || 0,
      chartPreviousClose: closes[0] || 0,
      fiftyTwoWeekHigh: Math.max(...highs),
      fiftyTwoWeekLow: Math.min(...lows),
      shortName: yahooSymbol,
      symbol: yahooSymbol,
      exchangeName: 'IBKR',
      regularMarketVolume: volumes[volumes.length - 1] || 0,
    },
    _source: 'ibkr',
  };

  historyCache.set(cacheKey, { data, expiresAt: now + HISTORY_TTL });
  return data;
}

// ─── Options chain endpoint ──────────────────────────────
/**
 * Get options chain for a symbol.
 * Returns data in the same shape as the Yahoo /yf/options endpoint.
 *
 * @param {string} yahooSymbol - Underlying symbol
 * @param {number} [expirationTimestamp] - Unix timestamp (seconds) for specific expiry
 * @returns {Promise<object>} Yahoo-compatible options object
 */
export async function getOptions(yahooSymbol, expirationTimestamp) {
  const conidMap = await getConids([yahooSymbol]);
  const conid = conidMap.get(yahooSymbol);
  if (!conid) throw new Error(`Cannot resolve conid for ${yahooSymbol}`);

  // Get available expirations and strikes
  const params = new URLSearchParams({ conid: String(conid) });
  const secDef = await ibkrFetch(`/v1/api/iserver/secdef/info?${params}`).catch(() => ({}));

  // Get strikes for a specific expiration or the nearest one
  let expiry = expirationTimestamp;
  let expirations = [];

  if (secDef && secDef.months) {
    // Parse IBKR expiration months (format: "JUL26;AUG26;SEP26...")
    const monthStrs = secDef.months.split(';');
    expirations = monthStrs.map((m) => {
      // Parse "JUL26" → approximate timestamp
      const monthMap = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
      const mon = monthMap[m.slice(0, 3)] || 0;
      const year = 2000 + parseInt(m.slice(3));
      return Math.floor(new Date(Date.UTC(year, mon, 15)).getTime() / 1000);
    }).sort((a, b) => a - b);
  }

  if (!expiry && expirations.length > 0) {
    // Use nearest expiration
    const now = Date.now() / 1000;
    expiry = expirations.find((e) => e > now) || expirations[0];
  }

  // Get strikes for the chosen expiration
  let strikes = [];
  if (expiry) {
    const expiryDate = new Date(expiry * 1000);
    const expiryStr = expiryDate.toISOString().slice(0, 10);
    const strikeParams = new URLSearchParams({
      conid: String(conid),
      secType: 'OPT',
      month: expiryDate.toLocaleString('en-US', { month: 'short' }).toUpperCase() + String(expiryDate.getFullYear() - 2000).padStart(2, '0'),
    });
    const strikeData = await ibkrFetch(`/v1/api/iserver/secdef/strikes?${strikeParams}`).catch(() => ({}));
    strikes = strikeData.strikes || strikeData.callStrikes || [];
  }

  // Fetch option snapshot data for the strikes
  // Note: IBKR options snapshot requires individual conids per strike/expiry
  // This is a simplified version that returns structure without full greeks
  return {
    expirations,
    strikes,
    calls: [],
    puts: [],
    underlyingPrice: 0, // Would need a separate snapshot call
    underlyingName: yahooSymbol,
    expirationDate: expiry || 0,
    _source: 'ibkr',
    _note: 'IBKR options chain requires per-contract snapshot calls for full greeks. Use /yf/options as fallback for greeks.',
  };
}

// ─── Account endpoints ───────────────────────────────────
let cachedAccountId = null;

/**
 * Get the IBKR account ID (cached after first call).
 * @returns {Promise<string>}
 */
export async function getAccountId() {
  if (cachedAccountId) return cachedAccountId;
  const accounts = await ibkrFetch('/v1/api/portfolio/accounts');
  if (accounts && accounts.length > 0) {
    cachedAccountId = accounts[0].accountId || accounts[0].id;
    return cachedAccountId;
  }
  throw new Error('No IBKR accounts found');
}

/**
 * Get account summary (balance, P&L, etc.)
 * @returns {Promise<object>}
 */
export async function getAccountSummary() {
  const accountId = await getAccountId();
  const summary = await ibkrFetch(`/v1/api/portfolio/${accountId}/summary`);

  // Convert IBKR summary format to a flat object
  const result = {};
  for (const [key, val] of Object.entries(summary)) {
    result[key] = val.amount ?? val.value ?? 0;
    if (val.currency) result[`${key}_currency`] = val.currency;
  }

  return {
    accountId,
    netLiquidation: result.netliquidation || 0,
    totalCashValue: result.totalcashvalue || 0,
    equityWithLoan: result.equitywithloanvalue || 0,
    grossPositionValue: result.grosspositionvalue || 0,
    unrealizedPnL: result.unrealizedpnl || 0,
    realizedPnL: result.realizedpnl || 0,
    availableFunds: result.availablefunds || 0,
    excessLiquidity: result.excessliquidity || 0,
    buyingPower: result.buyingpower || 0,
    currency: result.currency || 'USD',
    _source: 'ibkr',
  };
}

/**
 * Get account positions.
 * @returns {Promise<Array>}
 */
export async function getPositions() {
  const accountId = await getAccountId();
  const positions = await ibkrFetch(`/v1/api/portfolio/${accountId}/positions`);

  return (positions || []).map((p) => ({
    symbol: p.contractDesc || p.ticker || '',
    conid: p.conid,
    quantity: p.position || 0,
    avgPrice: p.avgPrice || 0,
    marketPrice: p.mktPrice || 0,
    marketValue: p.mktValue || 0,
    unrealizedPnL: p.unrealizedPnl || 0,
    realizedPnL: p.realizedPnl || 0,
    assetClass: p.assetClass || '',
    currency: p.currency || 'USD',
    _source: 'ibkr',
  }));
}

// ─── Health check ────────────────────────────────────────
/**
 * Check if the IBKR gateway is reachable and authenticated.
 * @returns {Promise<{ online: boolean, authenticated: boolean, details: object }>}
 */
export async function healthCheck() {
  try {
    const status = await checkAuthStatus();
    return {
      online: true,
      authenticated: status.authenticated,
      connected: status.connected,
      details: status,
    };
  } catch (e) {
    return {
      online: false,
      authenticated: false,
      connected: false,
      details: { error: e.message },
    };
  }
}
