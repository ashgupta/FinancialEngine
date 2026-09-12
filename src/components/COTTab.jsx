import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts';
import {
  RefreshCw, Clock, FileText, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, AlertTriangle, BarChart3,
  Coins, DollarSign, Fuel, Landmark, Wheat, Beef, History, GitCompare, Sparkles,
} from 'lucide-react';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
}

const CLASS_TABS = [
  { id: 'Equities',     label: 'Equities',     icon: BarChart3 },
  { id: 'FX',           label: 'FX',           icon: DollarSign },
  { id: 'Metals',       label: 'Metals',       icon: Coins },
  { id: 'Energy',       label: 'Energy',       icon: Fuel },
  { id: 'Rates',        label: 'Rates',        icon: Landmark },
  { id: 'Agriculture',  label: 'Agriculture',  icon: Wheat },
  { id: 'Livestock',    label: 'Livestock',    icon: Beef },
];

const STANCE_COLORS = {
  'heavily long': 'text-emerald-400 bg-emerald-500/10',
  'net long': 'text-emerald-400 bg-emerald-500/5',
  'neutral': 'text-surface-400 bg-surface-700/30',
  'net short': 'text-red-400 bg-red-500/5',
  'heavily short': 'text-red-400 bg-red-500/10',
};

function NetBar({ net, longPct, shortPct }) {
  // Horizontal diverging bar: longs to the right (green), shorts to the left (red)
  const max = Math.max(longPct, shortPct, 1);
  const longW = (longPct / max) * 50;
  const shortW = (shortPct / max) * 50;
  return (
    <div className="flex items-center gap-1 w-32">
      <div className="flex-1 flex justify-end">
        <div className="h-2 rounded-l-full bg-red-500/70" style={{ width: `${shortW}%` }} />
      </div>
      <div className="w-px h-3 bg-surface-600" />
      <div className="flex-1">
        <div className="h-2 rounded-r-full bg-emerald-500/70" style={{ width: `${longW}%` }} />
      </div>
    </div>
  );
}

function MarketRow({ m }) {
  const isLong = m.net >= 0;
  const deltaUp = m.weekDelta > 0;
  // Contextual delta coloring: green only if the delta reinforces the net
  // position direction. If net-short but delta is positive (covering shorts),
  // use yellow (neutral — less bearish but not bullish). If net-long but delta
  // is negative (unwinding longs), use yellow too.
  const deltaColor = (isLong && deltaUp) || (!isLong && !deltaUp)
    ? (deltaUp ? 'text-emerald-400' : 'text-red-400')   // reinforcing: more long or more short
    : 'text-yellow-400';                                  // counter-trend: covering or unwinding
  const deltaLabel = deltaUp
    ? (isLong ? 'adding longs' : 'covering shorts')
    : (isLong ? 'unwinding longs' : 'adding shorts');
  return (
    <tr className="border-b border-surface-800/50 hover:bg-surface-800/30 transition">
      <td className="py-2.5 pl-3">
        <p className="text-xs font-semibold text-surface-200">{m.display}</p>
        <p className="text-[10px] text-surface-500 font-mono">{m.symbol}</p>
      </td>
      <td className="py-2.5">
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${STANCE_COLORS[m.stance] || ''}`}>
          {m.stance}
        </span>
      </td>
      <td className="py-2.5 text-right">
        <span className={`text-xs font-bold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
          {isLong ? '+' : ''}{m.net.toLocaleString()}
        </span>
      </td>
      <td className="py-2.5">
        <NetBar net={m.net} longPct={m.longPct} shortPct={m.shortPct} />
      </td>
      <td className={`py-2.5 text-right text-xs font-medium ${deltaColor}`} title={deltaLabel}>
        <div className="flex items-center justify-end gap-0.5">
          {deltaUp ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
          <span>{deltaUp ? '+' : ''}{m.weekDelta.toLocaleString()}</span>
        </div>
        <div className="text-[9px] text-surface-600 mt-0.5">{deltaLabel}</div>
      </td>
      <td className="py-2.5 text-right text-xs text-surface-400">
        {m.longPct.toFixed(1)}% / {m.shortPct.toFixed(1)}%
      </td>
      <td className="py-2.5 pr-3 text-right text-xs text-surface-500">
        {m.oi.toLocaleString()}
        <span className={`ml-1 text-[10px] ${m.oiChange >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
          ({m.oiChange >= 0 ? '+' : ''}{m.oiChange.toLocaleString()})
        </span>
      </td>
    </tr>
  );
}

function TakeawayCard({ items, icon: Icon, color, title }) {
  if (!items?.length) return null;
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className={color} />
        <h3 className="text-sm font-bold">{title}</h3>
      </div>
      <ul className="space-y-2">
        {items.map((t, i) => (
          <li key={i} className="text-xs text-surface-300 flex gap-2">
            <span className="text-surface-600">•</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function COTTab() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [activeClass, setActiveClass] = useState('Equities');
  const [view, setView] = useState('current'); // 'current' | 'trend'
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [selectedTrendMarket, setSelectedTrendMarket] = useState(null);
  const [aiCommentary, setAiCommentary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiModel, setAiModel] = useState(null);

  const fetchAIModel = async () => {
    try {
      const res = await fetch('/ai/model');
      if (res.ok) {
        const data = await res.json();
        setAiModel(data);
      }
    } catch (e) { /* non-critical */ }
  };

  useEffect(() => { fetchAIModel(); }, []);

  const handleRefreshModel = async () => {
    try {
      const res = await fetch('/ai/model/refresh', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setAiModel(data);
      }
    } catch (e) { /* non-critical */ }
  };

  const fetchAICommentary = async (cotData, forceRefresh = false) => {
    setAiLoading(true);
    setAiError(null);
    try {
      const url = forceRefresh ? '/ai/commentary?refresh=1' : '/ai/commentary';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cot', data: cotData }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      setAiCommentary(result.commentary);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/cot/report?refresh=1');
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReport(data);
      setLastRefresh(new Date());
      // Fetch AI commentary after data loads (force refresh to get new analysis)
      fetchAICommentary(data, true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (forceRefresh = false) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/cot/history${forceRefresh ? '?refresh=1' : ''}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setHistory(data);
      // Auto-select the top mover for the chart
      if (data?.comparison?.topMovers?.length && !selectedTrendMarket) {
        setSelectedTrendMarket(data.comparison.topMovers[0].title);
      }
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Fetch history when switching to trend view (if not already loaded)
  useEffect(() => {
    if (view === 'trend' && !history && !historyLoading) {
      fetchHistory();
    }
  }, [view]);

  const classMarkets = useMemo(() => {
    if (!report?.byClass) return [];
    return report.byClass[activeClass] || [];
  }, [report, activeClass]);

  const classSummary = report?.takeaways?.classSummary || {};

  // Overall stats
  const stats = useMemo(() => {
    if (!report?.markets) return null;
    const ms = report.markets;
    const longCount = ms.filter((m) => m.net > 0).length;
    const shortCount = ms.filter((m) => m.net < 0).length;
    const biggestLong = [...ms].sort((a, b) => b.net - a.net)[0];
    const biggestShort = [...ms].sort((a, b) => a.net - b.net)[0];
    const biggestShift = [...ms].sort((a, b) => Math.abs(b.weekDelta) - Math.abs(a.weekDelta))[0];
    return { longCount, shortCount, biggestLong, biggestShort, biggestShift, total: ms.length };
  }, [report]);

  const fmtDate = (d) => {
    if (!d) return '—';
    // CFTC dates are MM/DD/YY
    return d;
  };

  // Trend view: time series chart data for selected market
  const trendChartData = useMemo(() => {
    if (!history?.timeSeries || !selectedTrendMarket) return [];
    const ts = history.timeSeries[selectedTrendMarket];
    if (!ts) return [];
    return ts.series.map((p) => ({ date: p.date, net: p.net, oi: p.oi }));
  }, [history, selectedTrendMarket]);

  const trendMarketMeta = useMemo(() => {
    if (!history?.timeSeries || !selectedTrendMarket) return null;
    return history.timeSeries[selectedTrendMarket];
  }, [history, selectedTrendMarket]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <FileText size={24} className="text-brand-400" />
            <h1 className="text-2xl font-black tracking-tight">COT Report</h1>
            {report && !error && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-500/15 text-brand-400 text-xs font-medium">
                As of {fmtDate(report.reportDate)}
              </span>
            )}
            {report?.stale && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-400 text-xs font-medium">
                <AlertTriangle size={10} /> Stale
              </span>
            )}
          </div>
          <p className="text-surface-400 text-sm">
            CFTC Commitments of Traders · Weekly speculator positioning across futures markets
          </p>
          {report?.prevDate && view === 'current' && (
            <p className="text-surface-500 text-xs mt-1">
              Week-over-week change vs {fmtDate(report.prevDate)} · Released ~Fri 3:30pm ET (Mon on holiday weeks)
            </p>
          )}
          {view === 'trend' && history?.dates?.length >= 2 && (
            <p className="text-surface-500 text-xs mt-1">
              {history.weeksCovered} weeks covered · {fmtDate(history.dates[0])} → {fmtDate(history.dates[history.dates.length - 1])}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-surface-500">
          {lastRefresh && (
            <span className="flex items-center gap-1.5"><Clock size={13} />{lastRefresh.toLocaleTimeString()}</span>
          )}
          <button onClick={view === 'trend' ? () => fetchHistory(true) : refresh} disabled={view === 'trend' ? historyLoading : loading} className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700 transition disabled:opacity-50">
            <RefreshCw size={16} className={(view === 'trend' ? historyLoading : loading) ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setView('current')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${view === 'current' ? 'bg-brand-500/15 text-brand-400 border-brand-500/30' : 'bg-surface-800/60 text-surface-400 hover:text-white border-transparent'}`}
        >
          <FileText size={15} /> Current Week
        </button>
        <button
          onClick={() => setView('trend')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${view === 'trend' ? 'bg-brand-500/15 text-brand-400 border-brand-500/30' : 'bg-surface-800/60 text-surface-400 hover:text-white border-transparent'}`}
        >
          <History size={15} /> 12-Week Trend
        </button>
      </div>

      {/* Error */}
      {error && view === 'current' && (
        <Card className="border-red-500/30">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle size={16} />
            <span className="text-sm font-medium">Failed to load COT report: {error}</span>
          </div>
          <p className="text-xs text-surface-500 mt-2">
            The CFTC site (cftc.gov) may be slow or temporarily unavailable. Try refreshing.
          </p>
        </Card>
      )}

      {historyError && view === 'trend' && (
        <Card className="border-red-500/30">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle size={16} />
            <span className="text-sm font-medium">Failed to load COT history: {historyError}</span>
          </div>
          <p className="text-xs text-surface-500 mt-2">
            Fetching 12 weeks of CFTC archives takes ~20s on first load. Try refreshing.
          </p>
        </Card>
      )}

      {/* Loading */}
      {loading && !report && view === 'current' && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface-800/40 rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      )}

      {historyLoading && view === 'trend' && (
        <Card>
          <div className="flex items-center gap-3 text-surface-400">
            <RefreshCw size={16} className="animate-spin text-brand-400" />
            <span className="text-sm">Fetching 12 weeks of CFTC archives (~20s on first load)...</span>
          </div>
        </Card>
      )}

      {/* ═══ Current Week View ═══ */}
      {view === 'current' && report && (
        <>
          <SectionTimestamp fetchedAt={report?.fetchedAt} label="COT Report" loading={loading} onRefresh={refresh} />
          {/* Summary stat cards */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card className="text-center">
                <p className="text-xs text-surface-500 mb-1">Net Long Markets</p>
                <p className="text-2xl font-bold text-emerald-400">{stats.longCount}</p>
                <p className="text-[10px] text-surface-600 mt-1">of {stats.total} tracked</p>
              </Card>
              <Card className="text-center">
                <p className="text-xs text-surface-500 mb-1">Net Short Markets</p>
                <p className="text-2xl font-bold text-red-400">{stats.shortCount}</p>
                <p className="text-[10px] text-surface-600 mt-1">of {stats.total} tracked</p>
              </Card>
              <Card className="text-center">
                <p className="text-xs text-surface-500 mb-1">Most Long</p>
                {stats.biggestLong ? (
                  <p className="text-sm font-bold text-emerald-400">{stats.biggestLong.display}</p>
                ) : <p className="text-sm text-surface-500">—</p>}
                {stats.biggestLong && (
                  <p className="text-[10px] text-surface-500 mt-0.5">+{stats.biggestLong.net.toLocaleString()}</p>
                )}
              </Card>
              <Card className="text-center">
                <p className="text-xs text-surface-500 mb-1">Most Short</p>
                {stats.biggestShort ? (
                  <p className="text-sm font-bold text-red-400">{stats.biggestShort.display}</p>
                ) : <p className="text-sm text-surface-500">—</p>}
                {stats.biggestShort && (
                  <p className="text-[10px] text-surface-500 mt-0.5">{stats.biggestShort.net.toLocaleString()}</p>
                )}
              </Card>
            </div>
          )}

          {/* Key takeaways */}
          {report.takeaways && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TakeawayCard items={report.takeaways.bullish} icon={TrendingUp} color="text-emerald-400" title="Bullish Positioning" />
              <TakeawayCard items={report.takeaways.bearish} icon={TrendingDown} color="text-red-400" title="Bearish Positioning" />
              <TakeawayCard items={report.takeaways.shifts} icon={AlertTriangle} color="text-yellow-400" title="Biggest Weekly Shifts" />
            </div>
          )}

          {/* AI Commentary */}
          {view === 'current' && (aiLoading || aiCommentary || aiError) && (
            <Card className="border-brand-500/20">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Sparkles size={16} className="text-brand-400" />
                <h3 className="text-sm font-bold text-brand-400">AI Analysis</h3>
                <span className="text-[10px] text-surface-600">
                  Powered by Groq · {aiModel?.displayName || aiModel?.model || 'Loading...'}
                </span>
                {aiModel?.lastCheckedAt && (
                  <span className="text-[10px] text-surface-700">
                    Model checked: {new Date(aiModel.lastCheckedAt).toLocaleDateString()}
                  </span>
                )}
                {aiModel?.needsRefresh && (
                  <button
                    onClick={handleRefreshModel}
                    className="flex items-center gap-1 text-[10px] text-yellow-400 hover:text-yellow-300 transition-colors"
                  >
                    <RefreshCw size={10} /> Refresh model
                  </button>
                )}
              </div>
              {aiLoading && (
                <div className="flex items-center gap-2 text-surface-400 text-sm">
                  <RefreshCw size={14} className="animate-spin text-brand-400" />
                  <span>Analyzing COT data...</span>
                </div>
              )}
              {aiError && (
                <p className="text-xs text-red-400">AI commentary unavailable: {aiError}</p>
              )}
              {aiCommentary && !aiLoading && (
                <div className="text-sm text-surface-300 leading-relaxed space-y-2">
                  {aiCommentary.split('\n').filter(l => l.trim()).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Asset class summary chips */}
          {report && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {CLASS_TABS.map(({ id, label, icon: Icon }) => {
                const summary = classSummary[id];
                const count = report.byClass[id]?.length || 0;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveClass(id)}
                    className={`text-left p-3 rounded-xl border transition ${activeClass === id ? 'bg-brand-500/15 border-brand-500/30' : 'bg-surface-800/40 border-transparent hover:bg-surface-800/70'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon size={12} className={activeClass === id ? 'text-brand-400' : 'text-surface-500'} />
                      <span className={`text-xs font-semibold ${activeClass === id ? 'text-brand-400' : 'text-surface-300'}`}>{label}</span>
                    </div>
                    <p className="text-[10px] text-surface-500 leading-tight">{summary || `${count} markets`}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Market table for active class */}
          {classMarkets.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-800">
                <h3 className="text-sm font-bold">{activeClass} — Speculator Positioning</h3>
                <p className="text-[11px] text-surface-500 mt-0.5">
                  Non-Commercial (large speculators) net positions · Wk delta vs prior report
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-700 text-surface-500 text-left text-xs uppercase tracking-wider">
                      <th className="py-2 pl-3 font-medium">Contract</th>
                      <th className="py-2 font-medium">Stance</th>
                      <th className="py-2 text-right font-medium">Net</th>
                      <th className="py-2 font-medium">Long / Short</th>
                      <th className="py-2 text-right font-medium">Wk Delta</th>
                      <th className="py-2 text-right font-medium">% L / S</th>
                      <th className="py-2 pr-3 text-right font-medium">OI (Δ)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classMarkets.map((m) => (
                      <MarketRow key={m.title} m={m} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ═══ 12-Week Trend View ═══ */}
      {view === 'trend' && history && !historyLoading && (
        <>
          <SectionTimestamp fetchedAt={history?.fetchedAt} label="COT History (12-Week)" loading={historyLoading} onRefresh={() => fetchHistory(true)} />
          {/* Stance flips highlight */}
          {history.comparison.flips.length > 0 && (
            <Card className="border-yellow-500/30 bg-yellow-500/5">
              <div className="flex items-center gap-2 mb-3">
                <GitCompare size={16} className="text-yellow-400" />
                <h3 className="text-sm font-bold text-yellow-400">Stance Flips ({history.comparison.flips.length})</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {history.comparison.flips.map((f) => (
                  <div key={f.title} className="bg-surface-800/50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-surface-200">{f.display}</p>
                    <div className="flex items-center gap-2 mt-1 text-[11px]">
                      <span className={f.pastNet > 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {f.pastNet > 0 ? 'Long' : 'Short'} {Math.abs(f.pastNet).toLocaleString()}
                      </span>
                      <ArrowUpRight size={10} className="text-surface-600 rotate-0" />
                      <span className={f.currentNet > 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {f.currentNet > 0 ? 'Long' : 'Short'} {Math.abs(f.currentNet).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Top movers table */}
          {history.comparison.topMovers.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-800">
                <h3 className="text-sm font-bold">Top 10 Positioning Changes ({history.comparison.weeksAgo} weeks)</h3>
                <p className="text-[11px] text-surface-500 mt-0.5">
                  Largest absolute shift in net Non-Commercial positions vs {fmtDate(history.dates[0])}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-700 text-surface-500 text-left text-xs uppercase tracking-wider">
                      <th className="py-2 pl-3 font-medium">Contract</th>
                      <th className="py-2 font-medium">Class</th>
                      <th className="py-2 text-right font-medium">{fmtDate(history.dates[0])} Net</th>
                      <th className="py-2 text-right font-medium">Current Net</th>
                      <th className="py-2 text-right font-medium">Δ Net</th>
                      <th className="py-2 text-right font-medium">% Change</th>
                      <th className="py-2 text-center font-medium">Flip?</th>
                      <th className="py-2 pr-3 text-right font-medium">Δ OI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.comparison.topMovers.map((c) => {
                      const deltaUp = c.netDelta > 0;
                      const isCurrentlyLong = c.currentNet >= 0;
                      const deltaColor = (isCurrentlyLong && deltaUp) || (!isCurrentlyLong && !deltaUp)
                        ? (deltaUp ? 'text-emerald-400' : 'text-red-400')
                        : 'text-yellow-400';
                      const deltaLabel = deltaUp
                        ? (isCurrentlyLong ? 'adding longs' : 'covering shorts')
                        : (isCurrentlyLong ? 'unwinding longs' : 'adding shorts');
                      return (
                        <tr
                          key={c.title}
                          className="border-b border-surface-800/50 hover:bg-surface-800/30 cursor-pointer transition"
                          onClick={() => setSelectedTrendMarket(c.title)}
                        >
                          <td className="py-2.5 pl-3">
                            <p className="text-xs font-semibold text-surface-200">{c.display}</p>
                            <p className="text-[10px] text-surface-500 font-mono">{c.symbol}</p>
                          </td>
                          <td className="py-2.5 text-[10px] text-surface-500">{c.assetClass}</td>
                          <td className={`py-2.5 text-right text-xs font-medium ${c.pastNet > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {c.pastNet > 0 ? '+' : ''}{c.pastNet.toLocaleString()}
                          </td>
                          <td className={`py-2.5 text-right text-xs font-medium ${c.currentNet > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {c.currentNet > 0 ? '+' : ''}{c.currentNet.toLocaleString()}
                          </td>
                          <td className={`py-2.5 text-right text-xs font-bold ${deltaColor}`} title={deltaLabel}>
                            <div className="flex items-center justify-end gap-0.5">
                              {deltaUp ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                              {deltaUp ? '+' : ''}{c.netDelta.toLocaleString()}
                            </div>
                            <div className="text-[9px] text-surface-600 mt-0.5">{deltaLabel}</div>
                          </td>
                          <td className={`py-2.5 text-right text-xs ${Math.abs(c.pctChange) > 50 ? 'font-bold' : ''} ${deltaUp ? 'text-emerald-400' : 'text-red-400'}`}>
                            {deltaUp ? '+' : ''}{c.pctChange.toFixed(1)}%
                          </td>
                          <td className="py-2.5 text-center">
                            {c.flipped ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-yellow-500/20 text-yellow-400">FLIP</span>
                            ) : (
                              <span className="text-surface-700">—</span>
                            )}
                          </td>
                          <td className={`py-2.5 pr-3 text-right text-[10px] ${c.oiDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {c.oiDelta >= 0 ? '+' : ''}{c.oiDelta.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Time series chart for selected market */}
          {trendChartData.length > 0 && trendMarketMeta && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold">{trendMarketMeta.display} — Net Positioning Trend</h3>
                  <p className="text-[11px] text-surface-500 mt-0.5">
                    {trendMarketMeta.assetClass} · Non-Commercial net over {trendChartData.length} weeks
                  </p>
                </div>
                <select
                  value={selectedTrendMarket || ''}
                  onChange={(e) => setSelectedTrendMarket(e.target.value)}
                  className="bg-surface-800 border border-surface-700 rounded-lg py-1.5 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                >
                  {Object.entries(history.timeSeries)
                    .sort(([, a], [, b]) => a.assetClass.localeCompare(b.assetClass) || a.display.localeCompare(b.display))
                    .map(([title, meta]) => (
                      <option key={title} value={title}>{meta.display} ({meta.assetClass})</option>
                    ))}
                </select>
              </div>
              <div className="h-64">
                <ResponsiveContainer>
                  <LineChart data={trendChartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(0, 5)} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm shadow-xl">
                            <p className="text-surface-400 text-xs">{label}</p>
                            <p className="font-bold" style={{ color: payload[0].value >= 0 ? '#22c55e' : '#ef4444' }}>
                              Net: {payload[0].value >= 0 ? '+' : ''}{payload[0].value?.toLocaleString()}
                            </p>
                            {payload[1] && (
                              <p className="text-surface-500 text-xs">OI: {payload[1].value?.toLocaleString()}</p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Line type="monotone" dataKey="net" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3 text-center">
                <div>
                  <p className="text-[10px] text-surface-500">12wk Ago</p>
                  <p className={`text-sm font-bold ${trendChartData[0]?.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {trendChartData[0]?.net >= 0 ? '+' : ''}{trendChartData[0]?.net?.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-surface-500">Current</p>
                  <p className={`text-sm font-bold ${trendChartData[trendChartData.length - 1]?.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {trendChartData[trendChartData.length - 1]?.net >= 0 ? '+' : ''}{trendChartData[trendChartData.length - 1]?.net?.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-surface-500">Δ {history.comparison.weeksAgo}wk</p>
                  <p className={`text-sm font-bold ${(trendChartData[trendChartData.length - 1]?.net - trendChartData[0]?.net) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(trendChartData[trendChartData.length - 1]?.net - trendChartData[0]?.net) >= 0 ? '+' : ''}
                    {(trendChartData[trendChartData.length - 1]?.net - trendChartData[0]?.net)?.toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Full comparison table by asset class */}
          {history.comparison.comparisons.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-800">
                <h3 className="text-sm font-bold">All Markets — {history.comparison.weeksAgo}-Week Comparison</h3>
                <p className="text-[11px] text-surface-500 mt-0.5">
                  Click any row to view its trend chart above
                </p>
              </div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-900">
                    <tr className="border-b border-surface-700 text-surface-500 text-left text-xs uppercase tracking-wider">
                      <th className="py-2 pl-3 font-medium">Contract</th>
                      <th className="py-2 font-medium">Class</th>
                      <th className="py-2 text-right font-medium">Past Net</th>
                      <th className="py-2 text-right font-medium">Current Net</th>
                      <th className="py-2 text-right font-medium">Δ</th>
                      <th className="py-2 text-right font-medium">%</th>
                      <th className="py-2 text-center font-medium">Flip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history.comparison.comparisons]
                      .sort((a, b) => a.assetClass.localeCompare(b.assetClass) || a.display.localeCompare(b.display))
                      .map((c) => {
                        const deltaUp = c.netDelta > 0;
                        return (
                          <tr
                            key={c.title}
                            className={`border-b border-surface-800/50 cursor-pointer transition ${selectedTrendMarket === c.title ? 'bg-brand-500/5' : 'hover:bg-surface-800/30'}`}
                            onClick={() => setSelectedTrendMarket(c.title)}
                          >
                            <td className="py-2 pl-3 text-xs font-semibold text-surface-200">{c.display}</td>
                            <td className="py-2 text-[10px] text-surface-500">{c.assetClass}</td>
                            <td className={`py-2 text-right text-xs ${c.pastNet > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {c.pastNet > 0 ? '+' : ''}{c.pastNet.toLocaleString()}
                            </td>
                            <td className={`py-2 text-right text-xs ${c.currentNet > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {c.currentNet > 0 ? '+' : ''}{c.currentNet.toLocaleString()}
                            </td>
                            <td className={`py-2 text-right text-xs font-medium ${deltaUp ? 'text-emerald-400' : 'text-red-400'}`}>
                              {deltaUp ? '+' : ''}{c.netDelta.toLocaleString()}
                            </td>
                            <td className={`py-2 text-right text-[10px] ${deltaUp ? 'text-emerald-400' : 'text-red-400'}`}>
                              {deltaUp ? '+' : ''}{c.pctChange.toFixed(0)}%
                            </td>
                            <td className="py-2 text-center">
                              {c.flipped ? <span className="text-[9px] font-bold text-yellow-400">FLIP</span> : <span className="text-surface-700">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* 12-Week Price Trend */}
      <WeeklyTrendView symbol="ES=F" title="S&P 500 Futures — 12-Week Price Trend" color="#f59e0b" />

      {/* Footer note */}
      {report && (
        <p className="text-[11px] text-surface-600 leading-relaxed">
          Source: CFTC Commitments of Traders (legacy short format, futures-only) ·
          Non-Commercial = large speculators/hedge funds · Commercial = hedgers/producers ·
          Net = NonComm Long − NonComm Short · Report covers Tuesday open interest, released Friday 3:30pm ET ·
          This is a snapshot of positioning, not a directional signal. Extreme positioning can mark inflections (contrarian) or persist.
        </p>
      )}
    </div>
  );
}
