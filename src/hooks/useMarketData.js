import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchMarketSnapshot, fetchHistory } from '../engine/marketData';

/**
 * Hook that fetches and auto-refreshes market data.
 * @param {number} refreshInterval - ms between refreshes (default 24h)
 */
export function useMarketData(refreshInterval = 24 * 60 * 60_000) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);

  const refresh = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      const data = await fetchMarketSnapshot(forceRefresh);
      setSnapshot(data);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      console.error('Market data refresh failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, refreshInterval);
    return () => clearInterval(intervalRef.current);
  }, [refresh, refreshInterval]);

  return { snapshot, loading, error, lastRefresh, refresh };
}

/**
 * Hook to fetch historical data for a specific symbol.
 */
export function useHistoricalData(symbol, range = '1y', interval = '1d', forceRefresh = false) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    fetchHistory(symbol, range, interval, forceRefresh)
      .then(setData)
      .finally(() => setLoading(false));
  }, [symbol, range, interval, forceRefresh]);

  return { data, loading };
}
