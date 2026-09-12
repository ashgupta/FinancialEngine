/**
 * IBKR Symbol Mapping — resolves Yahoo Finance symbols to IBKR contract IDs (conids).
 *
 * IBKR uses numeric contract IDs (conids) instead of ticker symbols.
 * This module maintains a static mapping for known symbols and a runtime
 * cache for dynamically resolved conids.
 *
 * The IBKR Client Portal Gateway must be running for dynamic resolution.
 */

// ─── Static symbol overrides ─────────────────────────────
// Yahoo uses ^-prefixed symbols for indices and =F for futures.
// IBKR uses different naming for search purposes.
const YAHOO_TO_IBKR_SEARCH = {
  // Indices — Yahoo uses ^ prefix, IBKR search uses different names
  '^GSPC': { symbol: 'SPX', secType: 'IND' },
  '^IXIC': { symbol: 'COMP', secType: 'IND' },
  '^DJI':  { symbol: 'DJI', secType: 'IND' },
  '^RUT':  { symbol: 'RUT', secType: 'IND' },
  '^VIX':  { symbol: 'VIX', secType: 'IND' },
  '^TNX':  { symbol: 'TNX', secType: 'IND' },   // 10-year treasury yield
  '^TYX':  { symbol: 'TYX', secType: 'IND' },   // 30-year treasury yield
  '^FVX':  { symbol: 'FVX', secType: 'IND' },   // 5-year treasury yield
  '^IRX':  { symbol: 'IRX', secType: 'IND' },   // 13-week treasury yield
  // Futures — Yahoo uses =F, IBKR uses the root symbol
  'ES=F':  { symbol: 'ES', secType: 'FUT', exchange: 'CME' },
  'NQ=F':  { symbol: 'NQ', secType: 'FUT', exchange: 'CME' },
  'YM=F':  { symbol: 'YM', secType: 'FUT', exchange: 'CBOT' },
  'RTY=F': { symbol: 'RTY', secType: 'FUT', exchange: 'CME' },
  'CL=F':  { symbol: 'CL', secType: 'FUT', exchange: 'NYMEX' },
  'GC=F':  { symbol: 'GC', secType: 'FUT', exchange: 'COMEX' },
  'SI=F':  { symbol: 'SI', secType: 'FUT', exchange: 'COMEX' },
  'HG=F':  { symbol: 'HG', secType: 'FUT', exchange: 'COMEX' },
  'NG=F':  { symbol: 'NG', secType: 'FUT', exchange: 'NYMEX' },
  'ZB=F':  { symbol: 'ZB', secType: 'FUT', exchange: 'CBOT' },
  'ZN=F':  { symbol: 'ZN', secType: 'FUT', exchange: 'CBOT' },
  'ZC=F':  { symbol: 'ZC', secType: 'FUT', exchange: 'CBOT' },
  'ZS=F':  { symbol: 'ZS', secType: 'FUT', exchange: 'CBOT' },
  'ZW=F':  { symbol: 'ZW', secType: 'FUT', exchange: 'CBOT' },
  'KC=F':  { symbol: 'KC', secType: 'FUT', exchange: 'ICE' },
  'CT=F':  { symbol: 'CT', secType: 'FUT', exchange: 'ICE' },
  'CC=F':  { symbol: 'CC', secType: 'FUT', exchange: 'ICE' },
  'SB=F':  { symbol: 'SB', secType: 'FUT', exchange: 'ICE' },
  // Stocks with special Yahoo formatting
  'BRK-B': { symbol: 'BRK B', secType: 'STK' },
  'BRK-A': { symbol: 'BRK A', secType: 'STK' },
};

// ─── Known conids for common symbols (avoids a search round-trip) ──
const KNOWN_CONIDS = {
  // ETFs
  'SPY': 756733,
  'QQQ': 320227,
  'IWM': 37256292,
  'DIA': 82630932,
  // Sector ETFs
  'XLK': 73901769,
  'XLF': 73901761,
  'XLE': 73901758,
  'XLV': 73901770,
  'XLI': 73901764,
  'XLY': 73901772,
  'XLP': 73901765,
  'XLB': 73901756,
  'XLU': 73901768,
  'XLRE': 262687454,
  'XLC': 262687451,
  // Factor ETFs
  'MTUM': 121662858,
  'VLUE': 121662863,
  'QUAL': 121662854,
  'SIZE': 121662861,
  'USMV': 121662862,
  'SPYG': 121662860,
  'SPYV': 121662859,
  // Popular stocks
  'AAPL': 265598,
  'MSFT': 272093,
  'NVDA': 81745932,
  'AMZN': 3691937,
  'GOOGL': 208977817,
  'META': 221223761,
  'TSLA': 119494329,
  'JPM': 8215,
  // Indices (these may need special handling)
  '^GSPC': 756733,   // SPX uses same conid as SPY for data purposes
  '^VIX': 13455763,  // VIX index
};

// ─── Runtime conid cache ────────────────────────────────
const conidCache = new Map(Object.entries(KNOWN_CONIDS));

/**
 * Get the IBKR search symbol for a Yahoo symbol.
 * @param {string} yahooSymbol - Yahoo Finance symbol (e.g. ^GSPC, ES=F, AAPL)
 * @returns {{ symbol: string, secType?: string, exchange?: string } | null}
 */
export function getIbkrSearchSymbol(yahooSymbol) {
  if (YAHOO_TO_IBKR_SEARCH[yahooSymbol]) return YAHOO_TO_IBKR_SEARCH[yahooSymbol];
  // For regular stocks/ETFs, the symbol is the same (strip Yahoo suffixes)
  return { symbol: yahooSymbol.replace(/-/g, ' '), secType: 'STK' };
}

/**
 * Get a cached conid for a symbol.
 * @param {string} symbol - Yahoo or IBKR symbol
 * @returns {number | null}
 */
export function getCachedConid(symbol) {
  return conidCache.get(symbol) || null;
}

/**
 * Cache a conid for future lookups.
 * @param {string} symbol
 * @param {number} conid
 */
export function cacheConid(symbol, conid) {
  conidCache.set(symbol, conid);
}

/**
 * Resolve a Yahoo symbol to an IBKR conid via the gateway search API.
 * Uses cache first, falls back to a live search.
 *
 * @param {string} yahooSymbol - Yahoo Finance symbol
 * @param {function} searchFn - async (ibkrSymbol) => [{ conid, ... }] — calls IBKR search API
 * @returns {Promise<number | null>}
 */
export async function resolveConid(yahooSymbol, searchFn) {
  // Check cache first
  const cached = getCachedConid(yahooSymbol);
  if (cached) return cached;

  const ibkrSearch = getIbkrSearchSymbol(yahooSymbol);
  if (!ibkrSearch) return null;

  try {
    const results = await searchFn(ibkrSearch.symbol, ibkrSearch.secType);
    if (results && results.length > 0) {
      const conid = parseInt(results[0].conid, 10);
      if (conid) {
        cacheConid(yahooSymbol, conid);
        return conid;
      }
    }
  } catch (e) {
    console.warn(`Conid resolution failed for ${yahooSymbol}:`, e.message);
  }

  return null;
}

/**
 * Batch resolve multiple Yahoo symbols to conids.
 * @param {string[]} yahooSymbols
 * @param {function} searchFn
 * @returns {Promise<Map<string, number>>} — Map of yahooSymbol → conid
 */
export async function resolveConids(yahooSymbols, searchFn) {
  const result = new Map();
  const uncached = [];

  for (const sym of yahooSymbols) {
    const cached = getCachedConid(sym);
    if (cached) {
      result.set(sym, cached);
    } else {
      uncached.push(sym);
    }
  }

  // Resolve uncached in parallel (IBKR can handle concurrent searches)
  if (uncached.length > 0) {
    const resolved = await Promise.all(
      uncached.map(async (sym) => {
        const conid = await resolveConid(sym, searchFn);
        return [sym, conid];
      })
    );
    for (const [sym, conid] of resolved) {
      if (conid) result.set(sym, conid);
    }
  }

  return result;
}

/**
 * Get all known conids (for debugging / inspection).
 */
export function getAllKnownConids() {
  return new Map(conidCache);
}
