import React, { createContext, useContext, useState, useEffect } from 'react';
import { OPTIONABLE_SYMBOLS } from '../engine/marketData.js';

const STORAGE_KEY = 'windsurf_watchlists_v2';

const DEFAULT_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.', group: 'Tech' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', group: 'Tech' },
  { symbol: 'TSLA', name: 'Tesla Inc.', group: 'Tech' },
  { symbol: 'SPY', name: 'SPDR S&P 500', group: 'Index' },
  { symbol: 'QQQ', name: 'Invesco QQQ', group: 'Index' },
  { symbol: 'PLTR', name: 'Palantir Technologies Inc.', group: 'Tech' },
];

// Imported from Fidelity_Investment_Watchlist_general_Jul-25-2026.csv (43 tickers).
// BRK/B -> BRK-B and SPX -> ^GSPC normalised to Yahoo Finance symbol format.
const FIDELITY_WATCHLIST_JUL2026 = [
  { symbol: 'ORCL', name: 'Oracle', group: 'Stock' },
  { symbol: 'UBER', name: 'Uber Technologies', group: 'Stock' },
  { symbol: 'WHR', name: 'Whirlpool', group: 'Stock' },
  { symbol: 'TSLA', name: 'Tesla', group: 'Stock' },
  { symbol: 'NFLX', name: 'Netflix', group: 'Stock' },
  { symbol: 'CRWV', name: 'CoreWeave', group: 'Stock' },
  { symbol: 'CRM', name: 'Salesforce', group: 'Stock' },
  { symbol: 'NOW', name: 'ServiceNow', group: 'Stock' },
  { symbol: 'SQQQ', name: 'ProShares UltraPro Short QQQ', group: 'ETF' },
  { symbol: 'KWEB', name: 'KraneShares CSI China Internet ETF', group: 'ETF' },
  { symbol: 'MSFT', name: 'Microsoft', group: 'Stock' },
  { symbol: 'PLTR', name: 'Palantir Technologies', group: 'Stock' },
  { symbol: 'BABA', name: 'Alibaba Group Holding', group: 'Stock' },
  { symbol: 'SMCI', name: 'Super Micro Computer', group: 'Stock' },
  { symbol: 'SLV', name: 'iShares Silver Trust', group: 'ETF' },
  { symbol: 'SIVR', name: 'abrdn Physical Silver Shares ETF', group: 'ETF' },
  { symbol: 'META', name: 'Meta Platforms', group: 'Stock' },
  { symbol: 'MELI', name: 'MercadoLibre', group: 'Stock' },
  { symbol: 'FXI', name: 'iShares China Large-Cap ETF', group: 'ETF' },
  { symbol: 'HOOD', name: 'Robinhood Markets', group: 'Stock' },
  { symbol: 'WMT', name: 'Walmart', group: 'Stock' },
  { symbol: 'NVO', name: 'Novo Nordisk', group: 'Stock' },
  { symbol: 'AMZN', name: 'Amazon', group: 'Stock' },
  { symbol: 'ARM', name: 'Arm Holdings', group: 'Stock' },
  { symbol: 'JD', name: 'JD.com', group: 'Stock' },
  { symbol: 'AVGO', name: 'Broadcom', group: 'Stock' },
  { symbol: 'MRVL', name: 'Marvell Technology', group: 'Stock' },
  { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ', group: 'ETF' },
  { symbol: 'NVDA', name: 'NVIDIA', group: 'Stock' },
  { symbol: 'INTC', name: 'Intel', group: 'Stock' },
  { symbol: 'GOOG', name: 'Alphabet Class C', group: 'Stock' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway Class B', group: 'Stock' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', group: 'ETF' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing', group: 'Stock' },
  { symbol: 'CRWD', name: 'CrowdStrike Holdings', group: 'Stock' },
  { symbol: 'UPS', name: 'United Parcel Service', group: 'Stock' },
  { symbol: 'ASML', name: 'ASML Holding', group: 'Stock' },
  { symbol: 'UNH', name: 'UnitedHealth Group', group: 'Stock' },
  { symbol: 'XLE', name: 'Energy Select Sector SPDR', group: 'ETF' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', group: 'ETF' },
  { symbol: '^GSPC', name: 'S&P 500 Index', group: 'Index' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', group: 'Stock' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', group: 'ETF' },
];

// Shape: { lists: { [name]: Symbol[] }, active: string }
function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);

    // Migrate old single watchlist if present
    const old = localStorage.getItem('windsurf_global_watchlist') ||
                localStorage.getItem('windsurf_social_watchlist');
    if (old) {
      const parsed = JSON.parse(old);
      return { lists: { 'My Watchlist': parsed }, active: 'My Watchlist' };
    }
  } catch { /* ignore */ }
  return { lists: { 'My Watchlist': DEFAULT_SYMBOLS }, active: 'My Watchlist' };
}

const FIDELITY_SEED_KEY = 'windsurf_fidelity_watchlist_seeded_v1';

const WatchlistContext = createContext();

export function WatchlistProvider({ children }) {
  const [state, setState] = useState(loadState);

  // Persist on every change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  // One-time seed: create/merge a "Fidelity Watchlist" list from the imported
  // CSV and make it active, so Options Opportunities + Social Pulse (both of
  // which derive their universe from the active watchlist) evaluate these
  // tickers immediately without any manual re-import.
  useEffect(() => {
    try {
      if (localStorage.getItem(FIDELITY_SEED_KEY)) return;
      setState(prev => {
        const existing = prev.lists['Fidelity Watchlist'] ?? [];
        const seen = new Set(existing.map(w => w.symbol));
        const merged = [...existing];
        for (const s of FIDELITY_WATCHLIST_JUL2026) {
          if (!seen.has(s.symbol)) {
            seen.add(s.symbol);
            merged.push(s);
          }
        }
        return {
          lists: { ...prev.lists, 'Fidelity Watchlist': merged },
          active: 'Fidelity Watchlist',
        };
      });
      localStorage.setItem(FIDELITY_SEED_KEY, '1');
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived helpers ───────────────────────────────
  const watchlist = state.lists[state.active] ?? [];
  const listNames = Object.keys(state.lists);

  // ── List-level operations ─────────────────────────
  const createList = (name) => {
    const trimmed = name.trim();
    if (!trimmed || state.lists[trimmed]) return false;
    setState(prev => ({
      lists: { ...prev.lists, [trimmed]: [] },
      active: trimmed,
    }));
    return true;
  };

  const renameList = (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || state.lists[trimmed] || oldName === trimmed) return false;
    setState(prev => {
      const { [oldName]: symbols, ...rest } = prev.lists;
      return {
        lists: { ...rest, [trimmed]: symbols },
        active: prev.active === oldName ? trimmed : prev.active,
      };
    });
    return true;
  };

  const deleteList = (name) => {
    if (listNames.length <= 1) return false; // keep at least one
    setState(prev => {
      const { [name]: _, ...rest } = prev.lists;
      const newActive = prev.active === name ? Object.keys(rest)[0] : prev.active;
      return { lists: rest, active: newActive };
    });
    return true;
  };

  const setActiveList = (name) => {
    if (!state.lists[name]) return;
    setState(prev => ({ ...prev, active: name }));
  };

  // ── Symbol-level operations ───────────────────────
  const addSymbol = (sym, listName) => {
    const upperSym = sym.trim().toUpperCase();
    if (!upperSym || !/^[A-Z0-9.\-]{1,10}$/.test(upperSym)) return false;
    const target = listName ?? state.active;
    setState(prev => {
      const current = prev.lists[target] ?? [];
      if (current.some(w => w.symbol === upperSym)) return prev;
      const known = OPTIONABLE_SYMBOLS.find(o => o.symbol === upperSym);
      return {
        ...prev,
        lists: {
          ...prev.lists,
          [target]: [...current, { symbol: upperSym, name: known?.name || upperSym, group: 'Custom' }],
        },
      };
    });
    return true;
  };

  const removeSymbol = (sym, listName) => {
    const target = listName ?? state.active;
    setState(prev => ({
      ...prev,
      lists: {
        ...prev.lists,
        [target]: (prev.lists[target] ?? []).filter(w => w.symbol !== sym),
      },
    }));
  };

  const value = {
    // Active list
    watchlist,
    activeList: state.active,
    listNames,
    allLists: state.lists,
    // List ops
    createList,
    renameList,
    deleteList,
    setActiveList,
    // Symbol ops (operate on active list by default)
    addSymbol,
    removeSymbol,
  };

  return (
    <WatchlistContext.Provider value={value}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  const context = useContext(WatchlistContext);
  if (!context) throw new Error('useWatchlist must be used within a WatchlistProvider');
  return context;
}
