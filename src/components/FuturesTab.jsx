import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  RefreshCw, TrendingUp, TrendingDown, Clock, Radio,
  ArrowUpRight, ArrowDownRight, BarChart3, Landmark, Wheat, Coins,
  DollarSign, Fuel,
} from 'lucide-react';
import { fetchAllFutures, fetchHistory } from '../engine/marketData';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
}

const CATEGORY_TABS = [
  { id: 'index',     label: 'Index Futures',    icon: BarChart3 },
  { id: 'commodity', label: 'Commodities',      icon: Fuel },
  { id: 'currency',  label: 'Currencies',       icon: DollarSign },
  { id: 'bonds',     label: 'Bonds & Rates',    icon: Landmark },
];

const COMMODITY_CATEGORIES = ['All', 'Precious Metals', 'Energy', 'Base Metals', 'Agriculture', 'Livestock', 'Materials'];

function FuturesMiniChart({ symbol }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetchHistory(symbol, '3mo', '1d').then(setData);
  }, [symbol]);

  if (!data?.closes?.length) return <div className="w-16 h-8" />;
  const closes = data.closes.filter((c) => c != null);
  const chartData = closes.slice(-30).map((c, i) => ({ i, v: c }));
  const isUp = closes[closes.length - 1] >= closes[0];

  return (
    <div className="w-16 h-8">
      <ResponsiveContainer>
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={`fmc-${symbol.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0.25} />
              <stop offset="100%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={isUp ? '#22c55e' : '#ef4444'} strokeWidth={1.5} fill={`url(#fmc-${symbol.replace(/[^a-zA-Z0-9]/g, '')})`} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function FutureDetailChart({ symbol, name }) {
  const [range, setRange] = useState('3mo');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchHistory(symbol, range, range === '5y' ? '1wk' : '1d')
      .then(setData)
      .finally(() => setLoading(false));
  }, [symbol, range]);

  const chartData = useMemo(() => {
    if (!data?.closes) return [];
    return data.dates.map((d, i) => ({ date: d, close: data.closes[i] })).filter((d) => d.close != null);
  }, [data]);

  const isUp = chartData.length >= 2 && chartData[chartData.length - 1].close >= chartData[0].close;
  const color = isUp ? '#22c55e' : '#ef4444';

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">{name} <span className="text-surface-500 text-sm font-mono">({symbol})</span></h3>
        <div className="flex gap-1.5">
          {['1mo', '3mo', '6mo', '1y', '5y'].map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`px-2.5 py-1 rounded text-xs font-medium transition ${range === r ? 'bg-brand-500/20 text-brand-400' : 'bg-surface-800 text-surface-500 hover:text-white'}`}>{r.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div className="h-56">
        {loading ? (
          <div className="h-full flex items-center justify-center text-surface-500 text-sm">Loading...</div>
        ) : (
          <ResponsiveContainer>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <defs>
                <linearGradient id="futDetailGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm shadow-xl">
                    <p className="text-surface-400 text-xs">{payload[0].payload.date}</p>
                    <p className="font-bold" style={{ color }}>{payload[0].value?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                );
              }} />
              <Area type="monotone" dataKey="close" stroke={color} strokeWidth={2} fill="url(#futDetailGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function FuturesRow({ item, isSelected, onSelect }) {
  const isUp = (item.change ?? 0) >= 0;
  return (
    <tr
      className={`border-b border-surface-800/50 cursor-pointer transition ${isSelected ? 'bg-brand-500/5' : 'hover:bg-surface-800/30'}`}
      onClick={() => onSelect(item.symbol)}
    >
      <td className="py-2 pl-3">
        <div className="flex items-center gap-1.5">
          {item.flag && <span className="text-xs">{item.flag}</span>}
          <div>
            <p className="text-xs font-semibold text-surface-200">{item.name}</p>
            <p className="text-[10px] text-surface-500 font-mono">{item.symbol}</p>
          </div>
        </div>
      </td>
      <td className="py-2 text-[10px] text-surface-500">{item.exchange}</td>
      <td className="py-3">
        <FuturesMiniChart symbol={item.symbol} />
      </td>
      <td className="py-2 text-right font-semibold text-xs">
        {item.price != null ? item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
      </td>
      <td className={`py-2 text-right text-xs font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
        <div className="flex items-center justify-end gap-0.5">
          {isUp ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
          <span>{item.change != null ? `${isUp ? '+' : ''}${item.change.toFixed(2)}` : '—'}</span>
        </div>
      </td>
      <td className={`py-2 text-right text-xs font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
        {item.changePercent != null ? `${isUp ? '+' : ''}${item.changePercent.toFixed(2)}%` : '—'}
      </td>
      <td className="py-2 pr-3 text-right">
        {item.lastUpdated && (
          <span className="text-[8px] text-surface-600 whitespace-nowrap"><Clock size={7} className="inline mr-0.5" />{item.lastUpdated}</span>
        )}
      </td>
    </tr>
  );
}

export default function FuturesTab() {
  const [futuresData, setFuturesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [category, setCategory] = useState('index');
  const [commoditySub, setCommoditySub] = useState('All');
  const [selectedSymbol, setSelectedSymbol] = useState('ES=F');

  const refresh = async (forceRefresh = true) => {
    setLoading(true);
    try {
      const data = await fetchAllFutures(forceRefresh);
      setFuturesData(data);
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 24 * 60 * 60_000);
    return () => clearInterval(interval);
  }, []);

  const currentList = useMemo(() => {
    if (!futuresData) return [];
    switch (category) {
      case 'index': return futuresData.indexFutures;
      case 'commodity': {
        const all = futuresData.commodityFutures;
        return commoditySub === 'All' ? all : all.filter((f) => f.category === commoditySub);
      }
      case 'currency': return futuresData.currencyFutures;
      case 'bonds': return futuresData.bondFutures;
      default: return [];
    }
  }, [futuresData, category, commoditySub]);

  const selectedItem = currentList.find((f) => f.symbol === selectedSymbol) || currentList[0];

  useEffect(() => {
    if (currentList.length && !currentList.find((f) => f.symbol === selectedSymbol)) {
      setSelectedSymbol(currentList[0].symbol);
    }
  }, [currentList, selectedSymbol]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <TrendingUp size={24} className="text-brand-400" />
            <h1 className="text-2xl font-black tracking-tight">Futures Markets</h1>
            {futuresData?.isLive && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-medium">
                <Radio size={10} className="animate-pulse" /> Live
              </span>
            )}
          </div>
          <p className="text-surface-400 text-sm">Real-time futures across indices, commodities, currencies, and bonds</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-surface-500">
          {lastRefresh && (
            <span className="flex items-center gap-1.5"><Clock size={13} />{lastRefresh.toLocaleTimeString()}</span>
          )}
          <button onClick={refresh} disabled={loading} className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700 transition disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Section timestamp */}
      {futuresData && (
        <SectionTimestamp fetchedAt={lastRefresh} label="Futures Data" loading={loading} onRefresh={() => refresh(true)} />
      )}

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol={selectedSymbol} title={`${selectedSymbol} — 12-Week Trend`} />

      {/* Category tabs */}
      <div className="flex gap-2">
        {CATEGORY_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { setCategory(id); setCommoditySub('All'); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${category === id ? 'bg-brand-500/15 text-brand-400 border-brand-500/30' : 'bg-surface-800/60 text-surface-400 hover:text-white border-transparent'}`}
          >
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* Commodity sub-filter */}
      {category === 'commodity' && (
        <div className="flex gap-2 flex-wrap">
          {COMMODITY_CATEGORIES.map((sub) => (
            <button
              key={sub}
              onClick={() => setCommoditySub(sub)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${commoditySub === sub ? 'bg-brand-500/20 text-brand-400' : 'bg-surface-800 text-surface-500 hover:text-white'}`}
            >
              {sub}
            </button>
          ))}
        </div>
      )}

      {/* Futures Table */}
      {loading && !futuresData ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface-800/40 rounded-xl h-16 animate-pulse" />
          ))}
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-surface-500 text-left text-xs uppercase tracking-wider">
                  <th className="py-2 pl-3 font-medium">Contract</th>
                  <th className="py-2 font-medium">Exch</th>
                  <th className="py-2 font-medium">30D</th>
                  <th className="py-2 text-right font-medium">Price</th>
                  <th className="py-2 text-right font-medium">Chg</th>
                  <th className="py-2 text-right font-medium">%Chg</th>
                  <th className="py-2 pr-3 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {currentList.map((item) => (
                  <FuturesRow
                    key={item.symbol}
                    item={item}
                    isSelected={item.symbol === selectedSymbol}
                    onSelect={setSelectedSymbol}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Detail chart for selected future */}
      {selectedItem && (
        <FutureDetailChart symbol={selectedItem.symbol} name={selectedItem.name} />
      )}

      {/* Summary stats for the category */}
      {currentList.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">Gainers</p>
            <p className="text-2xl font-bold text-emerald-400">{currentList.filter((f) => (f.change ?? 0) > 0).length}</p>
          </Card>
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">Losers</p>
            <p className="text-2xl font-bold text-red-400">{currentList.filter((f) => (f.change ?? 0) < 0).length}</p>
          </Card>
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">Biggest Gainer</p>
            {(() => {
              const best = [...currentList].filter((f) => f.changePercent != null).sort((a, b) => b.changePercent - a.changePercent)[0];
              return best ? <p className="text-sm font-bold text-emerald-400">{best.name} <span className="text-xs">+{best.changePercent?.toFixed(2)}%</span></p> : <p className="text-sm text-surface-500">—</p>;
            })()}
          </Card>
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">Biggest Loser</p>
            {(() => {
              const worst = [...currentList].filter((f) => f.changePercent != null).sort((a, b) => a.changePercent - b.changePercent)[0];
              return worst ? <p className="text-sm font-bold text-red-400">{worst.name} <span className="text-xs">{worst.changePercent?.toFixed(2)}%</span></p> : <p className="text-sm text-surface-500">—</p>;
            })()}
          </Card>
        </div>
      )}
    </div>
  );
}
