import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, ReferenceLine,
} from 'recharts';
import {
  RefreshCw, Clock, Radio, ArrowUpRight, ArrowDownRight, Layers,
  Search, TrendingUp, Activity,
} from 'lucide-react';
import { fetchOptionsChain, OPTIONABLE_SYMBOLS } from '../engine/marketData';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
}

function OptionContractRow({ contract, type, underlyingPrice }) {
  const isUp = contract.change >= 0;
  const itm = contract.inTheMoney;
  return (
    <tr className={`border-b border-surface-800/30 text-xs ${itm ? (type === 'call' ? 'bg-emerald-500/5' : 'bg-red-500/5') : ''}`}>
      <td className="py-2 pl-3 font-mono text-surface-300">{contract.strike.toFixed(2)}</td>
      <td className="py-2 text-right font-semibold">{contract.lastPrice.toFixed(2)}</td>
      <td className={`py-2 text-right ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
        {isUp ? '+' : ''}{contract.change.toFixed(2)}
      </td>
      <td className="py-2 text-right text-surface-400">{contract.bid.toFixed(2)}</td>
      <td className="py-2 text-right text-surface-400">{contract.ask.toFixed(2)}</td>
      <td className="py-2 text-right text-surface-400">{(contract.impliedVolatility * 100).toFixed(1)}%</td>
      <td className="py-2 text-right text-surface-400">{contract.volume?.toLocaleString() || '—'}</td>
      <td className="py-2 pr-3 text-right text-surface-400">{contract.openInterest?.toLocaleString() || '—'}</td>
    </tr>
  );
}

function OpenInterestChart({ calls, puts, underlyingPrice }) {
  const data = useMemo(() => {
    const strikeMap = new Map();
    for (const c of calls) {
      strikeMap.set(c.strike, { strike: c.strike, callOI: c.openInterest, putOI: 0 });
    }
    for (const p of puts) {
      const existing = strikeMap.get(p.strike) || { strike: p.strike, callOI: 0, putOI: 0 };
      existing.putOI = p.openInterest;
      strikeMap.set(p.strike, existing);
    }
    return [...strikeMap.values()]
      .sort((a, b) => a.strike - b.strike)
      .filter((d) => d.strike >= underlyingPrice * 0.85 && d.strike <= underlyingPrice * 1.15);
  }, [calls, puts, underlyingPrice]);

  if (!data.length) return null;

  return (
    <Card>
      <h3 className="font-semibold mb-4 flex items-center gap-2"><Activity size={16} className="text-brand-400" /> Open Interest by Strike</h3>
      <div className="h-64">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="strike" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => v.toFixed(0)} />
            <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm shadow-xl">
                  <p className="font-semibold text-surface-300">Strike: ${d?.strike?.toFixed(2)}</p>
                  <p className="text-emerald-400">Call OI: {d?.callOI?.toLocaleString()}</p>
                  <p className="text-red-400">Put OI: {d?.putOI?.toLocaleString()}</p>
                </div>
              );
            }} />
            <ReferenceLine x={underlyingPrice} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: 'Spot', fill: '#fbbf24', fontSize: 10 }} />
            <Bar dataKey="callOI" fill="#22c55e" opacity={0.7} name="Call OI" />
            <Bar dataKey="putOI" fill="#ef4444" opacity={0.7} name="Put OI" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function IVSkewChart({ calls, puts, underlyingPrice }) {
  const data = useMemo(() => {
    const strikeMap = new Map();
    for (const c of calls) {
      if (c.impliedVolatility > 0) {
        strikeMap.set(c.strike, { strike: c.strike, callIV: +(c.impliedVolatility * 100).toFixed(1), putIV: 0 });
      }
    }
    for (const p of puts) {
      if (p.impliedVolatility > 0) {
        const existing = strikeMap.get(p.strike) || { strike: p.strike, callIV: 0, putIV: 0 };
        existing.putIV = +(p.impliedVolatility * 100).toFixed(1);
        strikeMap.set(p.strike, existing);
      }
    }
    return [...strikeMap.values()]
      .sort((a, b) => a.strike - b.strike)
      .filter((d) => d.strike >= underlyingPrice * 0.85 && d.strike <= underlyingPrice * 1.15);
  }, [calls, puts, underlyingPrice]);

  if (!data.length) return null;

  return (
    <Card>
      <h3 className="font-semibold mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-brand-400" /> Implied Volatility Skew</h3>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="strike" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => v.toFixed(0)} />
            <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm shadow-xl">
                  <p className="font-semibold text-surface-300">Strike: ${d?.strike?.toFixed(2)}</p>
                  <p className="text-emerald-400">Call IV: {d?.callIV}%</p>
                  <p className="text-red-400">Put IV: {d?.putIV}%</p>
                </div>
              );
            }} />
            <ReferenceLine x={underlyingPrice} stroke="#fbbf24" strokeDasharray="4 4" />
            <Bar dataKey="callIV" fill="#22c55e" opacity={0.6} name="Call IV" />
            <Bar dataKey="putIV" fill="#ef4444" opacity={0.6} name="Put IV" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export default function OptionsTab() {
  const [selectedSymbol, setSelectedSymbol] = useState('SPY');
  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [viewMode, setViewMode] = useState('calls'); // calls | puts | straddle
  const [searchQuery, setSearchQuery] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadChain = useCallback(async (symbol, expiry, forceRefresh = false) => {
    setLoading(true);
    try {
      const data = await fetchOptionsChain(symbol, expiry, forceRefresh);
      setChain(data);
      setLastRefresh(new Date());
      if (!expiry && data.expirations?.length > 0) {
        setSelectedExpiry(data.expirations[0]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChain(selectedSymbol, null);
  }, [selectedSymbol, loadChain]);

  useEffect(() => {
    if (selectedExpiry && chain?.expirationDate !== selectedExpiry) {
      loadChain(selectedSymbol, selectedExpiry);
    }
  }, [selectedExpiry, selectedSymbol, loadChain, chain?.expirationDate]);

  const filteredSymbols = useMemo(() => {
    if (!searchQuery) return OPTIONABLE_SYMBOLS;
    const q = searchQuery.toLowerCase();
    return OPTIONABLE_SYMBOLS.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [searchQuery]);

  const groupedSymbols = useMemo(() => {
    const groups = {};
    for (const s of filteredSymbols) {
      if (!groups[s.type]) groups[s.type] = [];
      groups[s.type].push(s);
    }
    return groups;
  }, [filteredSymbols]);

  const expiryDates = useMemo(() => {
    if (!chain?.expirations?.length) return [];
    return chain.expirations.slice(0, 12).map((ts) => ({
      ts,
      label: new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
      dte: Math.ceil((ts * 1000 - Date.now()) / 86400000),
    }));
  }, [chain?.expirations]);

  const totalCallOI = chain?.calls?.reduce((s, c) => s + (c.openInterest || 0), 0) || 0;
  const totalPutOI = chain?.puts?.reduce((s, c) => s + (c.openInterest || 0), 0) || 0;
  const pcRatio = totalCallOI > 0 ? (totalPutOI / totalCallOI).toFixed(2) : '—';

  const maxPain = useMemo(() => {
    if (!chain?.calls?.length || !chain?.puts?.length) return null;
    const strikes = [...new Set([...chain.calls.map((c) => c.strike), ...chain.puts.map((p) => p.strike)])].sort((a, b) => a - b);
    let minPain = Infinity;
    let painStrike = 0;
    for (const strike of strikes) {
      let pain = 0;
      for (const c of chain.calls) {
        if (strike > c.strike) pain += (strike - c.strike) * c.openInterest;
      }
      for (const p of chain.puts) {
        if (strike < p.strike) pain += (p.strike - strike) * p.openInterest;
      }
      if (pain < minPain) { minPain = pain; painStrike = strike; }
    }
    return painStrike;
  }, [chain]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Layers size={24} className="text-brand-400" />
            <h1 className="text-2xl font-black tracking-tight">Options Chain</h1>
            {chain?.underlyingPrice > 0 && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-medium">
                <Radio size={10} className="animate-pulse" /> Live
              </span>
            )}
          </div>
          <p className="text-surface-400 text-sm">Real-time options data for major indices, ETFs, commodities, and mega-caps</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-surface-500">
          {lastRefresh && <span className="flex items-center gap-1.5"><Clock size={13} />{lastRefresh.toLocaleTimeString()}</span>}
          <button onClick={() => loadChain(selectedSymbol, selectedExpiry, true)} disabled={loading} className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700 transition disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Section timestamp */}
      {chain && (
        <SectionTimestamp fetchedAt={lastRefresh} label="Options Chain" loading={loading} onRefresh={() => loadChain(selectedSymbol, selectedExpiry, true)} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Symbol selector */}
        <Card className="lg:col-span-1 p-0 overflow-hidden">
          <div className="p-3 border-b border-surface-700/50">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
              <input
                type="text"
                placeholder="Search symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface-800 border border-surface-700 rounded-lg py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
              />
            </div>
          </div>
          <div className="overflow-y-auto max-h-[500px] divide-y divide-surface-800/50">
            {Object.entries(groupedSymbols).map(([type, symbols]) => (
              <div key={type}>
                <p className="px-3 py-2 text-[10px] font-semibold text-surface-500 uppercase tracking-wider bg-surface-800/30">{type}</p>
                {symbols.map((s) => (
                  <button
                    key={s.symbol}
                    onClick={() => { setSelectedSymbol(s.symbol); setSelectedExpiry(null); }}
                    className={`w-full text-left px-3 py-2.5 flex items-center justify-between transition text-sm ${selectedSymbol === s.symbol ? 'bg-brand-500/10 text-brand-400' : 'hover:bg-surface-800/50 text-surface-300'}`}
                  >
                    <span className="font-semibold">{s.symbol}</span>
                    <span className="text-xs text-surface-500 truncate ml-2 max-w-[100px]">{s.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>

        {/* Chain content */}
        <div className="lg:col-span-3 space-y-6">
          {/* Underlying info */}
          <Card>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="text-xl font-bold">{chain?.underlyingName || selectedSymbol}</h2>
                <p className="text-surface-400 text-sm font-mono">{selectedSymbol}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-black">${chain?.underlyingPrice?.toFixed(2) || '—'}</p>
                {lastRefresh && (
                  <span className="text-[9px] text-surface-600 flex items-center justify-end gap-1 mt-1"><Clock size={8} />{lastRefresh.toLocaleString()}</span>
                )}
              </div>
              <div className="flex gap-6 text-center">
                <div>
                  <p className="text-xs text-surface-500">P/C Ratio</p>
                  <p className={`text-lg font-bold ${parseFloat(pcRatio) > 1 ? 'text-red-400' : 'text-emerald-400'}`}>{pcRatio}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-500">Max Pain</p>
                  <p className="text-lg font-bold text-yellow-400">${maxPain?.toFixed(0) || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-500">Call OI</p>
                  <p className="text-lg font-bold text-emerald-400">{totalCallOI.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-500">Put OI</p>
                  <p className="text-lg font-bold text-red-400">{totalPutOI.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Expiry selector */}
          {expiryDates.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {expiryDates.map((exp) => (
                <button
                  key={exp.ts}
                  onClick={() => setSelectedExpiry(exp.ts)}
                  className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition border ${selectedExpiry === exp.ts ? 'bg-brand-500/15 text-brand-400 border-brand-500/30' : 'bg-surface-800 text-surface-400 hover:text-white border-transparent'}`}
                >
                  <span>{exp.label}</span>
                  <span className="text-surface-600 ml-1.5">{exp.dte}d</span>
                </button>
              ))}
            </div>
          )}

          {/* View mode toggle */}
          <div className="flex gap-2">
            {[{ id: 'calls', label: 'Calls', color: 'text-emerald-400' }, { id: 'puts', label: 'Puts', color: 'text-red-400' }, { id: 'straddle', label: 'Both', color: 'text-blue-400' }].map(({ id, label, color }) => (
              <button
                key={id}
                onClick={() => setViewMode(id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${viewMode === id ? `bg-surface-800 ${color} border border-surface-600` : 'bg-surface-800/50 text-surface-500 hover:text-white border border-transparent'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Options chain table */}
          {loading && !chain ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-surface-800/40 rounded h-10 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {(viewMode === 'calls' || viewMode === 'straddle') && chain?.calls?.length > 0 && (
                <Card className="p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-surface-700/50 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <p className="text-sm font-semibold text-emerald-400">Calls</p>
                    <span className="text-xs text-surface-500 ml-auto">{chain.calls.length} contracts</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-surface-700 text-[10px] text-surface-500 uppercase tracking-wider">
                          <th className="py-2 pl-3 text-left font-medium">Strike</th>
                          <th className="py-2 text-right font-medium">Last</th>
                          <th className="py-2 text-right font-medium">Chg</th>
                          <th className="py-2 text-right font-medium">Bid</th>
                          <th className="py-2 text-right font-medium">Ask</th>
                          <th className="py-2 text-right font-medium">IV</th>
                          <th className="py-2 text-right font-medium">Volume</th>
                          <th className="py-2 pr-3 text-right font-medium">OI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chain.calls
                          .filter((c) => c.strike >= chain.underlyingPrice * 0.9 && c.strike <= chain.underlyingPrice * 1.1)
                          .map((c) => (
                            <OptionContractRow key={c.contractSymbol || c.strike} contract={c} type="call" underlyingPrice={chain.underlyingPrice} />
                          ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {(viewMode === 'puts' || viewMode === 'straddle') && chain?.puts?.length > 0 && (
                <Card className="p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-surface-700/50 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                    <p className="text-sm font-semibold text-red-400">Puts</p>
                    <span className="text-xs text-surface-500 ml-auto">{chain.puts.length} contracts</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-surface-700 text-[10px] text-surface-500 uppercase tracking-wider">
                          <th className="py-2 pl-3 text-left font-medium">Strike</th>
                          <th className="py-2 text-right font-medium">Last</th>
                          <th className="py-2 text-right font-medium">Chg</th>
                          <th className="py-2 text-right font-medium">Bid</th>
                          <th className="py-2 text-right font-medium">Ask</th>
                          <th className="py-2 text-right font-medium">IV</th>
                          <th className="py-2 text-right font-medium">Volume</th>
                          <th className="py-2 pr-3 text-right font-medium">OI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chain.puts
                          .filter((p) => p.strike >= chain.underlyingPrice * 0.9 && p.strike <= chain.underlyingPrice * 1.1)
                          .map((p) => (
                            <OptionContractRow key={p.contractSymbol || p.strike} contract={p} type="put" underlyingPrice={chain.underlyingPrice} />
                          ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* Charts */}
          {chain?.calls?.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <OpenInterestChart calls={chain.calls} puts={chain.puts} underlyingPrice={chain.underlyingPrice} />
              <IVSkewChart calls={chain.calls} puts={chain.puts} underlyingPrice={chain.underlyingPrice} />
            </div>
          )}
        </div>
      </div>

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol={selectedSymbol} title={`${selectedSymbol} — 12-Week Price Trend`} />
    </div>
  );
}
