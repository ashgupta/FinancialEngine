/**
 * Real-time market data service using Yahoo Finance API (proxied via Vite).
 * Provides live quotes, historical price data, and computed trailing metrics.
 */

// ─── World Market Indices ─────────────────────────────────
export const WORLD_INDICES = [
  { symbol: '^GSPC',   name: 'S&P 500',       region: 'US',          flag: '🇺🇸' },
  { symbol: '^DJI',    name: 'Dow Jones',      region: 'US',          flag: '🇺🇸' },
  { symbol: '^IXIC',   name: 'NASDAQ',         region: 'US',          flag: '🇺🇸' },
  { symbol: '^RUT',    name: 'Russell 2000',   region: 'US',          flag: '🇺🇸' },
  { symbol: '^FTSE',   name: 'FTSE 100',       region: 'Europe',      flag: '🇬🇧' },
  { symbol: '^GDAXI',  name: 'DAX',            region: 'Europe',      flag: '🇩🇪' },
  { symbol: '^FCHI',   name: 'CAC 40',         region: 'Europe',      flag: '🇫🇷' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50', region: 'Europe',     flag: '🇪🇺' },
  { symbol: '^N225',   name: 'Nikkei 225',     region: 'Asia-Pacific', flag: '🇯🇵' },
  { symbol: '^HSI',    name: 'Hang Seng',      region: 'Asia-Pacific', flag: '🇭🇰' },
  { symbol: '000001.SS', name: 'Shanghai',     region: 'Asia-Pacific', flag: '🇨🇳' },
  { symbol: '^BSESN',  name: 'BSE Sensex',     region: 'Asia-Pacific', flag: '🇮🇳' },
  { symbol: '^KS11',   name: 'KOSPI',          region: 'Asia-Pacific', flag: '🇰🇷' },
  { symbol: '^AXJO',   name: 'ASX 200',        region: 'Asia-Pacific', flag: '🇦🇺' },
  { symbol: '^GSPTSE', name: 'TSX Composite',  region: 'Americas',     flag: '🇨🇦' },
  { symbol: '^BVSP',   name: 'Bovespa',        region: 'Americas',     flag: '🇧🇷' },
];

// ─── Portfolio ETFs ───────────────────────────────────────
export const PORTFOLIO_ETFS = [
  { symbol: 'SPY',   name: 'SPDR S&P 500 ETF',              assetClass: 'us_equity' },
  { symbol: 'VTI',   name: 'Vanguard Total Stock Market',   assetClass: 'us_equity' },
  { symbol: 'VXUS',  name: 'Vanguard Total International',  assetClass: 'intl_equity' },
  { symbol: 'BND',   name: 'Vanguard Total Bond',           assetClass: 'us_bonds' },
  { symbol: 'VNQ',   name: 'Vanguard Real Estate',          assetClass: 'real_estate' },
  { symbol: 'BNDX',  name: 'Vanguard Intl Bond',            assetClass: 'intl_bonds' },
  { symbol: 'GSG',   name: 'iShares S&P GSCI Commodity',    assetClass: 'commodities' },
  { symbol: 'VTIP',  name: 'Vanguard Short-Term TIPS',      assetClass: 'tips' },
  { symbol: 'SGOV',  name: 'iShares 0-3 Month Treasury',    assetClass: 'cash' },
  { symbol: 'QQQ',   name: 'Invesco QQQ Trust',             assetClass: 'benchmark' },
];

// ─── Index Futures ────────────────────────────────────────
export const INDEX_FUTURES = [
  { symbol: 'ES=F',  name: 'S&P 500 E-mini',      underlying: '^GSPC',  exchange: 'CME',   category: 'US Index',     flag: '🇺🇸' },
  { symbol: 'NQ=F',  name: 'NASDAQ 100 E-mini',   underlying: '^IXIC',  exchange: 'CME',   category: 'US Index',     flag: '🇺🇸' },
  { symbol: 'YM=F',  name: 'Dow E-mini',          underlying: '^DJI',   exchange: 'CBOT',  category: 'US Index',     flag: '🇺🇸' },
  { symbol: 'RTY=F', name: 'Russell 2000 E-mini',  underlying: '^RUT',  exchange: 'CME',   category: 'US Index',     flag: '🇺🇸' },
  { symbol: 'NKD=F', name: 'Nikkei 225',           underlying: '^N225', exchange: 'CME',   category: 'Asia Index',   flag: '🇯🇵' },
  { symbol: 'NIY=F', name: 'Nikkei 225 Yen',       underlying: '^N225', exchange: 'CME',   category: 'Asia Index',   flag: '🇯🇵' },
  { symbol: 'DAX=F', name: 'DAX',                   underlying: '^GDAXI', exchange: 'EUREX', category: 'Europe Index', flag: '��' },
  { symbol: '^VIX',  name: 'VIX Volatility',        underlying: '^VIX',   exchange: 'CBOE',  category: 'US Index',    flag: '🇺🇸' },
];

// ─── Commodity Futures ────────────────────────────────────
export const COMMODITY_FUTURES = [
  // Precious Metals
  { symbol: 'GC=F',  name: 'Gold',             unit: '$/oz',    exchange: 'COMEX', category: 'Precious Metals', color: '#FFD700' },
  { symbol: 'SI=F',  name: 'Silver',           unit: '$/oz',    exchange: 'COMEX', category: 'Precious Metals', color: '#C0C0C0' },
  { symbol: 'PL=F',  name: 'Platinum',         unit: '$/oz',    exchange: 'NYMEX', category: 'Precious Metals', color: '#E5E4E2' },
  { symbol: 'PA=F',  name: 'Palladium',        unit: '$/oz',    exchange: 'NYMEX', category: 'Precious Metals', color: '#CED0CE' },
  // Energy
  { symbol: 'CL=F',  name: 'Crude Oil WTI',    unit: '$/bbl',   exchange: 'NYMEX', category: 'Energy',          color: '#1a1a1a' },
  { symbol: 'BZ=F',  name: 'Brent Crude',      unit: '$/bbl',   exchange: 'ICE',   category: 'Energy',          color: '#333333' },
  { symbol: 'NG=F',  name: 'Natural Gas',      unit: '$/MMBtu', exchange: 'NYMEX', category: 'Energy',          color: '#60a5fa' },
  { symbol: 'RB=F',  name: 'RBOB Gasoline',    unit: '$/gal',   exchange: 'NYMEX', category: 'Energy',          color: '#f97316' },
  { symbol: 'HO=F',  name: 'Heating Oil',      unit: '$/gal',   exchange: 'NYMEX', category: 'Energy',          color: '#dc2626' },
  // Base Metals
  { symbol: 'HG=F',  name: 'Copper',           unit: '$/lb',    exchange: 'COMEX', category: 'Base Metals',     color: '#B87333' },
  // Agriculture
  { symbol: 'ZC=F',  name: 'Corn',             unit: '¢/bu',    exchange: 'CBOT',  category: 'Agriculture',     color: '#fbbf24' },
  { symbol: 'ZW=F',  name: 'Wheat',            unit: '¢/bu',    exchange: 'CBOT',  category: 'Agriculture',     color: '#d4a017' },
  { symbol: 'ZS=F',  name: 'Soybeans',         unit: '¢/bu',    exchange: 'CBOT',  category: 'Agriculture',     color: '#65a30d' },
  { symbol: 'KC=F',  name: 'Coffee',           unit: '¢/lb',    exchange: 'ICE',   category: 'Agriculture',     color: '#78350f' },
  { symbol: 'SB=F',  name: 'Sugar #11',        unit: '¢/lb',    exchange: 'ICE',   category: 'Agriculture',     color: '#fefce8' },
  { symbol: 'CC=F',  name: 'Cocoa',            unit: '$/ton',   exchange: 'ICE',   category: 'Agriculture',     color: '#451a03' },
  { symbol: 'CT=F',  name: 'Cotton #2',        unit: '¢/lb',    exchange: 'ICE',   category: 'Agriculture',     color: '#f5f5f4' },
  { symbol: 'OJ=F',  name: 'Orange Juice',     unit: '¢/lb',    exchange: 'ICE',   category: 'Agriculture',     color: '#fb923c' },
  // Livestock
  { symbol: 'LE=F',  name: 'Live Cattle',      unit: '¢/lb',    exchange: 'CME',   category: 'Livestock',       color: '#92400e' },
  { symbol: 'HE=F',  name: 'Lean Hogs',        unit: '¢/lb',    exchange: 'CME',   category: 'Livestock',       color: '#fca5a5' },
  // Lumber
  { symbol: 'LBS=F', name: 'Lumber',           unit: '$/MBF',   exchange: 'CME',   category: 'Materials',       color: '#a16207' },
];

// ─── Currency Futures ─────────────────────────────────────
export const CURRENCY_FUTURES = [
  { symbol: '6E=F',  name: 'Euro FX',          pair: 'EUR/USD', exchange: 'CME', flag: '🇪🇺' },
  { symbol: '6J=F',  name: 'Japanese Yen',     pair: 'USD/JPY', exchange: 'CME', flag: '🇯🇵' },
  { symbol: '6B=F',  name: 'British Pound',    pair: 'GBP/USD', exchange: 'CME', flag: '🇬🇧' },
  { symbol: '6A=F',  name: 'Australian Dollar', pair: 'AUD/USD', exchange: 'CME', flag: '🇦🇺' },
  { symbol: '6C=F',  name: 'Canadian Dollar',  pair: 'USD/CAD', exchange: 'CME', flag: '🇨🇦' },
  { symbol: '6S=F',  name: 'Swiss Franc',      pair: 'USD/CHF', exchange: 'CME', flag: '🇨🇭' },
  { symbol: '6N=F',  name: 'New Zealand Dollar', pair: 'NZD/USD', exchange: 'CME', flag: '🇳🇿' },
  { symbol: '6M=F',  name: 'Mexican Peso',     pair: 'USD/MXN', exchange: 'CME', flag: '🇲🇽' },
  { symbol: 'DX=F',  name: 'US Dollar Index',  pair: 'DXY',     exchange: 'ICE', flag: '🇺🇸' },
];

// ─── Bond / Interest Rate Futures ─────────────────────────
export const BOND_FUTURES = [
  { symbol: 'ZB=F',  name: '30-Year T-Bond',      duration: '30Y', exchange: 'CBOT' },
  { symbol: 'ZN=F',  name: '10-Year T-Note',      duration: '10Y', exchange: 'CBOT' },
  { symbol: 'ZF=F',  name: '5-Year T-Note',       duration: '5Y',  exchange: 'CBOT' },
  { symbol: 'ZT=F',  name: '2-Year T-Note',       duration: '2Y',  exchange: 'CBOT' },
  { symbol: 'ZQ=F',  name: '30-Day Fed Funds',    duration: '30D', exchange: 'CBOT' },
];

// ─── Symbols that support options chains ──────────────────
export const OPTIONABLE_SYMBOLS = [
  { symbol: 'SPY',  name: 'S&P 500 ETF',          type: 'Index ETF' },
  { symbol: 'QQQ',  name: 'NASDAQ 100 ETF',        type: 'Index ETF' },
  { symbol: 'IWM',  name: 'Russell 2000 ETF',      type: 'Index ETF' },
  { symbol: 'DIA',  name: 'Dow Jones ETF',         type: 'Index ETF' },
  { symbol: 'EFA',  name: 'MSCI EAFE ETF',         type: 'Intl ETF' },
  { symbol: 'EEM',  name: 'Emerging Markets ETF',   type: 'Intl ETF' },
  { symbol: 'GLD',  name: 'Gold ETF',              type: 'Commodity ETF' },
  { symbol: 'SLV',  name: 'Silver ETF',            type: 'Commodity ETF' },
  { symbol: 'USO',  name: 'Oil ETF',               type: 'Commodity ETF' },
  { symbol: 'TLT',  name: '20+ Year Treasury ETF',  type: 'Bond ETF' },
  { symbol: 'HYG',  name: 'High Yield Bond ETF',    type: 'Bond ETF' },
  { symbol: 'VIX',  name: 'Volatility Index',       type: 'Volatility' },
  { symbol: 'AAPL', name: 'Apple',                  type: 'Mega Cap' },
  { symbol: 'MSFT', name: 'Microsoft',              type: 'Mega Cap' },
  { symbol: 'NVDA', name: 'NVIDIA',                 type: 'Mega Cap' },
  { symbol: 'AMZN', name: 'Amazon',                 type: 'Mega Cap' },
  { symbol: 'GOOGL', name: 'Alphabet',              type: 'Mega Cap' },
  { symbol: 'TSLA', name: 'Tesla',                  type: 'Mega Cap' },
  { symbol: 'META', name: 'Meta Platforms',          type: 'Mega Cap' },
];

// ─── Fetch Helpers ────────────────────────────────────────
const CACHE = new Map();
const CACHE_TTL = 60_000; // 1 minute for quotes, longer for historical

function getCached(key, ttl = CACHE_TTL) {
  const entry = CACHE.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.data;
  return null;
}

function setCache(key, data) {
  CACHE.set(key, { data, ts: Date.now() });
}

/**
 * Fetch real-time quotes for multiple symbols via our Express API.
 * Uses yahoo-finance2 server-side for reliable batch fetching.
 * @param {string[]} symbols
 * @returns {Promise<Map<string, QuoteData>>}
 */
export async function fetchQuotes(symbols, forceRefresh = false) {
  const cacheKey = `quotes:${symbols.sort().join(',')}`;
  if (!forceRefresh) {
    const cached = getCached(cacheKey, 30_000);
    if (cached) return cached;
  }

  try {
    const url = `/yf/quote?symbols=${encodeURIComponent(symbols.join(','))}${forceRefresh ? '&refresh=1' : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Quote fetch failed: ${res.status}`);
    const json = await res.json();
    const quotes = new Map();
    for (const q of json.quotes || []) {
      q._source = 'Yahoo Finance';
      quotes.set(q.symbol, q);
    }
    setCache(cacheKey, quotes);
    return quotes;
  } catch (err) {
    console.error('fetchQuotes error:', err?.message || String(err));
    return new Map();
  }
}

/**
 * Fetch quotes from Google Finance (secondary / fallback source).
 * Slower (one request per symbol) and less detailed than Yahoo Finance.
 * @param {string[]} symbols
 * @returns {Promise<Map<string, QuoteData>>}
 */
export async function fetchQuotesGoogle(symbols) {
  const cacheKey = `gf:${symbols.sort().join(',')}`;
  const cached = getCached(cacheKey, 60_000); // 1-min cache (slower source)
  if (cached) return cached;

  try {
    const url = `/gf/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Finance fetch failed: ${res.status}`);
    const json = await res.json();
    const quotes = new Map();
    for (const q of json.quotes || []) {
      q._source = 'Google Finance';
      quotes.set(q.symbol, q);
    }
    setCache(cacheKey, quotes);
    return quotes;
  } catch (err) {
    console.error('fetchQuotesGoogle error:', err?.message || String(err));
    return new Map();
  }
}

/**
 * Fetch historical daily price data for a symbol.
 * @param {string} symbol
 * @param {string} range - e.g. '1y', '5y', '1mo', 'max'
 * @param {string} interval - e.g. '1d', '1wk', '1mo'
 * @returns {Promise<{dates:string[], closes:number[], highs:number[], lows:number[], opens:number[], volumes:number[]}>}
 */
export async function fetchHistory(symbol, range = '1y', interval = '1d', forceRefresh = false) {
  const cacheKey = `history:${symbol}:${range}:${interval}`;
  if (!forceRefresh) {
    const cached = getCached(cacheKey, 300_000); // 5-min cache for historical
    if (cached) return cached;
  }

  try {
    const url = `/yf/history/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}${forceRefresh ? '&refresh=1' : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    setCache(cacheKey, data);
    return data;
  } catch (err) {
    console.error(`fetchHistory(${symbol}) error:`, err?.message || String(err));
    return { dates: [], closes: [], highs: [], lows: [], opens: [], volumes: [] };
  }
}

// ─── Derived Metrics ──────────────────────────────────────

/**
 * Calculate trailing annualized return and volatility from daily close prices.
 */
export function computeTrailingMetrics(closes) {
  if (!closes || closes.length < 20) return { annualReturn: null, annualVol: null, sharpe: null };

  const validCloses = closes.filter((c) => c != null && c > 0);
  if (validCloses.length < 20) return { annualReturn: null, annualVol: null, sharpe: null };

  // Daily log returns
  const logReturns = [];
  for (let i = 1; i < validCloses.length; i++) {
    logReturns.push(Math.log(validCloses[i] / validCloses[i - 1]));
  }

  const n = logReturns.length;
  const meanDaily = logReturns.reduce((s, r) => s + r, 0) / n;
  const varDaily = logReturns.reduce((s, r) => s + (r - meanDaily) ** 2, 0) / (n - 1);
  const stdDaily = Math.sqrt(varDaily);

  const tradingDays = 252;
  const annualReturn = meanDaily * tradingDays;
  const annualVol = stdDaily * Math.sqrt(tradingDays);
  const sharpe = annualVol > 0 ? (annualReturn - 0.04) / annualVol : 0; // 4% risk-free proxy

  return {
    annualReturn: +annualReturn.toFixed(4),
    annualVol: +annualVol.toFixed(4),
    sharpe: +sharpe.toFixed(3),
    dailyReturns: logReturns,
  };
}

/**
 * Compute a correlation matrix from multiple series of daily returns.
 * @param {number[][]} returnSeries - array of arrays of daily returns (same length)
 * @returns {number[][]} correlation matrix
 */
export function computeCorrelationMatrix(returnSeries) {
  const n = returnSeries.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1;
        continue;
      }
      const a = returnSeries[i];
      const b = returnSeries[j];
      const len = Math.min(a.length, b.length);
      const meanA = a.slice(0, len).reduce((s, v) => s + v, 0) / len;
      const meanB = b.slice(0, len).reduce((s, v) => s + v, 0) / len;
      let cov = 0, varA = 0, varB = 0;
      for (let k = 0; k < len; k++) {
        const da = a[k] - meanA;
        const db = b[k] - meanB;
        cov += da * db;
        varA += da * da;
        varB += db * db;
      }
      const corr = (varA > 0 && varB > 0) ? cov / Math.sqrt(varA * varB) : 0;
      matrix[i][j] = +corr.toFixed(3);
      matrix[j][i] = +corr.toFixed(3);
    }
  }
  return matrix;
}

/**
 * Fetch an options chain for a symbol.
 * @param {string} symbol
 * @param {number|null} expiration - Unix timestamp for a specific expiry, or null for nearest
 * @returns {Promise<{expirations:number[], calls:object[], puts:object[], underlyingPrice:number}>}
 */
export async function fetchOptionsChain(symbol, expiration = null, forceRefresh = false) {
  const cacheKey = `options:${symbol}:${expiration || 'default'}`;
  if (!forceRefresh) {
    const cached = getCached(cacheKey, 60_000);
    if (cached) return cached;
  }

  try {
    let url = `/yf/options/${encodeURIComponent(symbol)}`;
    const params = [];
    if (expiration) params.push(`date=${expiration}`);
    if (forceRefresh) params.push('refresh=1');
    if (params.length) url += `?${params.join('&')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Options fetch failed: ${res.status}`);
    const data = await res.json();

    setCache(cacheKey, data);
    return data;
  } catch (err) {
    console.error(`fetchOptionsChain(${symbol}) error:`, err?.message || String(err));
    return { expirations: [], strikes: [], calls: [], puts: [], underlyingPrice: 0, underlyingName: symbol, expirationDate: 0 };
  }
}

/**
 * Fetch all futures quotes in one batch call.
 */
export async function fetchAllFutures(forceRefresh = false) {
  const allSymbols = [
    ...INDEX_FUTURES.map((f) => f.symbol),
    ...COMMODITY_FUTURES.map((f) => f.symbol),
    ...CURRENCY_FUTURES.map((f) => f.symbol),
    ...BOND_FUTURES.map((f) => f.symbol),
  ];

  const quotes = await fetchQuotes(allSymbols, forceRefresh);

  const enrich = (list) => list.map((item) => {
    const q = quotes.get(item.symbol);
    return {
      ...item,
      price: q?.price ?? null,
      change: q?.change ?? null,
      changePercent: q?.changePercent ?? null,
      open: q?.open ?? null,
      dayHigh: q?.dayHigh ?? null,
      dayLow: q?.dayLow ?? null,
      previousClose: q?.previousClose ?? null,
      volume: q?.volume ?? null,
      marketState: q?.marketState ?? 'UNKNOWN',
      lastUpdated: q?.regularMarketTime ?? '',
    };
  });

  return {
    indexFutures: enrich(INDEX_FUTURES),
    commodityFutures: enrich(COMMODITY_FUTURES),
    currencyFutures: enrich(CURRENCY_FUTURES),
    bondFutures: enrich(BOND_FUTURES),
    fetchedAt: new Date().toLocaleString(),
    isLive: [...quotes.values()].some((q) => q.price > 0),
  };
}

/**
 * Fetch all market data in one call — quotes + historical for portfolio ETFs.
 * Returns a comprehensive MarketSnapshot.
 */
export async function fetchMarketSnapshot(forceRefresh = false) {
  const allSymbols = [
    ...WORLD_INDICES.map((i) => i.symbol),
    ...PORTFOLIO_ETFS.map((e) => e.symbol),
  ];

  // Batch quotes (Yahoo allows up to ~50 at once)
  const quotes = await fetchQuotes(allSymbols, forceRefresh);

  // Fetch 1-year history for portfolio ETFs (for trailing metrics)
  const etfHistories = {};
  const historyPromises = PORTFOLIO_ETFS.map(async (etf) => {
    const history = await fetchHistory(etf.symbol, '1y', '1d', forceRefresh);
    const metrics = computeTrailingMetrics(history.closes);
    etfHistories[etf.symbol] = { history, metrics };
  });
  await Promise.all(historyPromises);

  // Build index data
  const indices = WORLD_INDICES.map((idx) => {
    const q = quotes.get(idx.symbol);
    return {
      ...idx,
      price: q?.price ?? null,
      change: q?.change ?? null,
      changePercent: q?.changePercent ?? null,
      marketState: q?.marketState ?? 'UNKNOWN',
      lastUpdated: q?.regularMarketTime ?? '',
    };
  });

  // Build ETF data with real metrics
  const etfs = PORTFOLIO_ETFS.map((etf) => {
    const q = quotes.get(etf.symbol);
    const h = etfHistories[etf.symbol];
    return {
      ...etf,
      price: q?.price ?? null,
      change: q?.change ?? null,
      changePercent: q?.changePercent ?? null,
      volume: q?.volume ?? null,
      fiftyTwoWeekHigh: q?.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: q?.fiftyTwoWeekLow ?? null,
      marketState: q?.marketState ?? 'UNKNOWN',
      lastUpdated: q?.regularMarketTime ?? '',
      trailingReturn: h?.metrics?.annualReturn ?? null,
      trailingVol: h?.metrics?.annualVol ?? null,
      trailingSharpe: h?.metrics?.sharpe ?? null,
      history: h?.history ?? null,
      dailyReturns: h?.metrics?.dailyReturns ?? null,
    };
  });

  return {
    indices,
    etfs,
    fetchedAt: new Date().toLocaleString(),
    isLive: indices.some((i) => i.price != null),
  };
}

/**
 * Fetch a sparkline (30-day hourly or 5-day intraday) for a symbol.
 */
export async function fetchSparkline(symbol) {
  return fetchHistory(symbol, '1mo', '1d');
}
