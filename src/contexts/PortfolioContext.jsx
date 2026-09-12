import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { parseCsv } from '../engine/portfolioParser.js';
import { enrich } from '../engine/portfolioMetrics.js';

const STORAGE_KEY = 'portfolio:v1';

const PortfolioContext = createContext(null);

/**
 * PortfolioContext — lightweight provider that reads/parses localStorage['portfolio:v1'],
 * exposes enriched holdings, underlyings, and a heldSet for downstream consumers.
 *
 * Constitution Principle II: parsing logic lives in pure engines; this context
 * only handles storage I/O and React state.
 */
export function PortfolioProvider({ children }) {
  const [rawCsv, setRawCsv] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setRawCsv(stored);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // Re-parse when rawCsv changes
  useEffect(() => {
    if (!rawCsv) {
      setMetrics(null);
      return;
    }
    try {
      const parsed = parseCsv(rawCsv);
      if (parsed.positions.length > 0) {
        // Enrich with live prices (best-effort; quotes may be null offline)
        const enriched = enrich(parsed.positions, null);
        setMetrics(enriched);
      } else {
        setMetrics(null);
      }
    } catch {
      setMetrics(null);
    }
  }, [rawCsv]);

  // Derived values
  const holdings = useMemo(() => metrics?.positions || [], [metrics]);

  const underlyings = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const p of holdings) {
      const sym = p.underlying || p.symbol;
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        result.push({ symbol: sym, name: p.name || sym });
      }
    }
    return result;
  }, [holdings]);

  const heldSet = useMemo(() => {
    return new Set(underlyings.map((u) => u.symbol));
  }, [underlyings]);

  const value = useMemo(() => ({
    holdings,
    underlyings,
    heldSet,
    hasPortfolio: holdings.length > 0,
    loading,
    refresh: () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        setRawCsv(stored);
      } catch { /* ignore */ }
    },
  }), [holdings, underlyings, heldSet, loading]);

  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}

/**
 * Hook to access portfolio data from any component.
 * Returns { holdings, underlyings, heldSet, hasPortfolio, loading, refresh }
 */
export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    // Return safe defaults if used outside provider
    return {
      holdings: [],
      underlyings: [],
      heldSet: new Set(),
      hasPortfolio: false,
      loading: false,
      refresh: () => {},
    };
  }
  return ctx;
}

export default PortfolioContext;
