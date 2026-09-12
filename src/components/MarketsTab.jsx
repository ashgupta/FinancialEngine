import React, { useState, useMemo, useEffect } from 'react';
import {
  ComposedChart, AreaChart, Area, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  Globe, RefreshCw, TrendingUp, TrendingDown, Activity, Clock,
  ArrowUpRight, ArrowDownRight, Radio, BarChart3,
} from 'lucide-react';
import { useHistoricalData } from '../hooks/useMarketData';
import { fetchHistory } from '../engine/marketData';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

function Timestamp({ time }) {
  if (!time) return null;
  return (
    <span className="text-[9px] text-surface-600 flex items-center gap-1 mt-1"><Clock size={8} />{time}</span>
  );
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
}

function MiniSparkline({ symbol, color = '#3b82f6' }) {
  const { data, loading } = useHistoricalData(symbol, '1mo', '1d');
  if (loading || !data?.closes?.length) return <div className="w-20 h-8" />;

  const closes = data.closes.filter((c) => c != null);
  const chartData = closes.slice(-20).map((c, i) => ({ i, v: c }));
  const isUp = closes[closes.length - 1] >= closes[0];

  return (
    <div className="w-20 h-8">
      <ResponsiveContainer>
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
              <stop offset="100%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={isUp ? '#22c55e' : '#ef4444'} strokeWidth={1.5} fill={`url(#spark-${symbol})`} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function IndexCard({ index }) {
  const isUp = (index.change ?? 0) >= 0;
  const priceStr = index.price != null ? index.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const changeStr = index.change != null ? `${isUp ? '+' : ''}${index.change.toFixed(2)}` : '';
  const pctStr = index.changePercent != null ? `${isUp ? '+' : ''}${index.changePercent.toFixed(2)}%` : '';

  return (
    <div className="bg-surface-800/60 rounded-xl p-4 border border-surface-700/30 hover:border-surface-600/50 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{index.flag}</span>
          <div>
            <p className="text-sm font-semibold text-surface-200">{index.name}</p>
            <p className="text-xs text-surface-500">{index.symbol}</p>
          </div>
        </div>
        <MiniSparkline symbol={index.symbol} />
      </div>
      <div className="flex items-end justify-between">
        <p className="text-xl font-bold">{priceStr}</p>
        <div className={`flex items-center gap-1 text-sm font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
          {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          <span>{changeStr}</span>
          <span className="text-xs opacity-70">({pctStr})</span>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${index.marketState === 'REGULAR' ? 'bg-emerald-400 animate-pulse' : index.marketState === 'PRE' || index.marketState === 'POST' ? 'bg-yellow-400' : 'bg-surface-600'}`} />
          <span className="text-[10px] text-surface-500 uppercase">{index.marketState === 'REGULAR' ? 'Live' : index.marketState === 'PRE' ? 'Pre-market' : index.marketState === 'POST' ? 'After-hours' : 'Closed'}</span>
        </div>
        {index.lastUpdated && (
          <span className="text-[9px] text-surface-600 flex items-center gap-1"><Clock size={8} />{index.lastUpdated}</span>
        )}
      </div>
    </div>
  );
}

function computeSMA(closes, period) {
  const sma = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    sma[i] = sum / period;
  }
  return sma;
}

function ETFDetailChart({ symbol }) {
  const [range, setRange] = useState('1y');
  const [showDMA, setShowDMA] = useState(true);
  const fetchRange = showDMA ? '5y' : range;
  const { data, loading } = useHistoricalData(symbol, fetchRange, '1d');

  const chartData = useMemo(() => {
    if (!data?.closes) return [];
    const closes = data.closes;
    const sma50 = computeSMA(closes, 50);
    const sma200 = computeSMA(closes, 200);
    const wma200 = computeSMA(closes, 1000); // 200 weeks × 5 trading days

    const volumes = data.volumes || [];
    const all = data.dates.map((d, i) => ({
      date: d,
      close: closes[i],
      sma50: sma50[i],
      sma200: sma200[i],
      wma200: wma200[i],
      volume: volumes[i] || 0,
    })).filter((d) => d.close != null);

    const rangeDays = { '1mo': 22, '3mo': 65, '6mo': 130, '1y': 252, '2y': 504, '5y': 1260 };
    const keep = rangeDays[range] || all.length;
    return all.slice(-keep);
  }, [data, range]);

  const isUp = chartData.length >= 2 && chartData[chartData.length - 1].close >= chartData[0].close;
  const color = isUp ? '#22c55e' : '#ef4444';
  const lastPoint = chartData[chartData.length - 1];
  const aboveDMA200 = lastPoint?.sma200 != null && lastPoint.close > lastPoint.sma200;
  const aboveWMA200 = lastPoint?.wma200 != null && lastPoint.close > lastPoint.wma200;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {['1mo', '3mo', '6mo', '1y', '5y'].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition ${range === r ? 'bg-brand-500/20 text-brand-400' : 'bg-surface-800 text-surface-400 hover:text-white'}`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowDMA(!showDMA)}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition border ${showDMA ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' : 'bg-surface-800 text-surface-500 border-transparent'}`}
        >
          DMA
        </button>
      </div>
      {showDMA && lastPoint?.sma200 != null && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-yellow-400 inline-block rounded" /> 50 DMA: <span className="font-semibold">${lastPoint.sma50?.toFixed(2)}</span></span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-fuchsia-400 inline-block rounded" /> 200 DMA: <span className="font-semibold">${lastPoint.sma200?.toFixed(2)}</span></span>
          {lastPoint.wma200 != null && <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-cyan-400 inline-block rounded" /> 200 WMA: <span className="font-semibold">${lastPoint.wma200?.toFixed(2)}</span></span>}
          <span className={`font-semibold ${aboveDMA200 ? 'text-emerald-400' : 'text-red-400'}`}>
            {aboveDMA200 ? '▲ Above' : '▼ Below'} 200 DMA
          </span>
          {lastPoint.wma200 != null && <span className={`font-semibold ${aboveWMA200 ? 'text-emerald-400' : 'text-red-400'}`}>
            {aboveWMA200 ? '▲ Above' : '▼ Below'} 200 WMA
          </span>}
        </div>
      )}
      <div className="h-72">
        {loading ? (
          <div className="h-full flex items-center justify-center text-surface-500">Loading chart...</div>
        ) : (
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <defs>
                <linearGradient id="etfGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
              <YAxis yAxisId="price" stroke="#64748b" tick={{ fontSize: 11 }} domain={['auto', 'auto']} tickFormatter={(v) => `$${v}`} />
              <YAxis yAxisId="vol" orientation="right" stroke="#334155" tick={{ fontSize: 9 }} tickFormatter={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : `${(v / 1e3).toFixed(0)}K`} domain={[0, (max) => max * 4]} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload;
                  return (
                    <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm shadow-xl">
                      <p className="text-surface-400 text-xs mb-1">{p.date}</p>
                      <p className="font-bold" style={{ color }}>Price: ${p.close?.toFixed(2)}</p>
                      {p.sma50 != null && <p className="text-yellow-400 text-xs">50 DMA: ${p.sma50.toFixed(2)}</p>}
                      {p.sma200 != null && <p className="text-fuchsia-400 text-xs">200 DMA: ${p.sma200.toFixed(2)}</p>}
                      {p.wma200 != null && <p className="text-cyan-400 text-xs">200 WMA: ${p.wma200.toFixed(2)}</p>}
                      <p className="text-surface-500 text-xs mt-1">Vol: {p.volume?.toLocaleString()}</p>
                    </div>
                  );
                }}
              />
              <Bar yAxisId="vol" dataKey="volume" fill="#64748b" opacity={0.2} name="Volume" />
              <Area yAxisId="price" type="monotone" dataKey="close" stroke={color} strokeWidth={2} fill="url(#etfGrad)" dot={false} name="Price" />
              {showDMA && <Line yAxisId="price" type="monotone" dataKey="sma50" stroke="#facc15" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="50 DMA" />}
              {showDMA && <Line yAxisId="price" type="monotone" dataKey="sma200" stroke="#d946ef" strokeWidth={1.5} dot={false} name="200 DMA" />}
              {showDMA && <Line yAxisId="price" type="monotone" dataKey="wma200" stroke="#22d3ee" strokeWidth={2} dot={false} name="200 WMA" />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─── Historical Pattern Matching ──────────────────────────
function pearsonCorr(x, y) {
  const n = x.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return (dx === 0 || dy === 0) ? 0 : num / Math.sqrt(dx * dy);
}

function HistoricalPatterns() {
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory('^GSPC', 'max', '1mo').then((d) => {
      setRawData(d);
      setLoading(false);
    });
  }, []);

  const analysis = useMemo(() => {
    if (!rawData?.closes?.length) return null;
    const valid = rawData.dates
      .map((d, i) => ({ date: d, close: rawData.closes[i] }))
      .filter((v) => v.close != null);
    const dates = valid.map((v) => v.date);
    const closes = valid.map((v) => v.close);

    // 7 years = 84 months
    const W = 84;
    const idx7y = Math.max(0, closes.length - W);
    const target = closes.slice(idx7y);
    const t0 = target[0];
    const targetNorm = target.map((v) => (v - t0) / t0);

    // Slide window
    const results = [];
    for (let i = 0; i < idx7y - W; i++) {
      const seg = closes.slice(i, i + W);
      if (!seg[0]) continue;
      const segNorm = seg.map((v) => (v - seg[0]) / seg[0]);
      results.push({ corr: pearsonCorr(targetNorm, segNorm), idx: i });
    }
    results.sort((a, b) => b.corr - a.corr);

    // Deduplicate (skip if within 36 months of a higher-ranked match)
    const top = [];
    for (const r of results) {
      if (top.every((k) => Math.abs(r.idx - k.idx) > 36)) top.push(r);
      if (top.length === 5) break;
    }

    // Build chart series for each match
    const matches = top.map(({ corr, idx }) => {
      const histStart = closes[idx];
      const series = [];
      // Map 7-year window + next 5 years (60 months) forward
      for (let i = 0; i < W + 60; i++) {
        const histIdx = idx + i;
        const point = { month: i };
        if (i < W) {
          point.current = (targetNorm[i] || 0) * 100;
        }
        if (histIdx < closes.length && closes[histIdx] != null) {
          point.historical = ((closes[histIdx] - histStart) / histStart) * 100;
        }
        series.push(point);
      }
      // Final 5-yr forward return
      const endIdx = idx + W;
      const fiveYrIdx = endIdx + 60;
      const oneYrRet = endIdx + 12 < closes.length ? ((closes[endIdx + 12] / closes[endIdx]) - 1) * 100 : null;
      const threeYrRet = endIdx + 36 < closes.length ? ((closes[endIdx + 36] / closes[endIdx]) - 1) * 100 : null;
      const fiveYrRet = fiveYrIdx < closes.length ? ((closes[fiveYrIdx] / closes[endIdx]) - 1) * 100 : null;

      return {
        corr,
        startDate: dates[idx],
        endDate: dates[idx + W - 1],
        series,
        oneYrRet,
        threeYrRet,
        fiveYrRet,
        currentReturn: targetNorm[targetNorm.length - 1] * 100,
      };
    });

    return { matches, currentRange: `${dates[idx7y]} → ${dates[dates.length - 1]}` };
  }, [rawData]);

  if (loading) {
    return (
      <Card>
        <h2 className="text-lg font-bold mb-2 flex items-center gap-2"><Activity size={18} className="text-brand-400" /> Historical Pattern Analysis</h2>
        <div className="h-32 flex items-center justify-center text-surface-500">Analyzing 100 years of S&P 500 data...</div>
      </Card>
    );
  }

  if (!analysis) return null;

  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2"><Activity size={18} className="text-brand-400" /> Historical Pattern Analysis</h2>
        <p className="text-xs text-surface-400 mt-1">
          Top 5 historical S&P 500 windows most similar to the last 7 years ({analysis.currentRange.slice(0, 10)} → today),
          extended 5 years forward to show what happened next.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {analysis.matches.map((m, idx) => {
          const isPositive = m.fiveYrRet != null && m.fiveYrRet > 0;
          return (
            <div key={idx} className="bg-surface-800/40 rounded-xl p-4 border border-surface-700/40">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-brand-400">#{idx + 1}</span>
                    <span className="text-sm font-semibold">{m.startDate.slice(0, 7)} → {m.endDate.slice(0, 7)}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs">
                    <span className="text-fuchsia-400">Correlation: <span className="font-bold">{m.corr.toFixed(3)}</span></span>
                  </div>
                </div>
                <div className="text-right text-xs">
                  {m.oneYrRet != null && <div>1Y: <span className={m.oneYrRet >= 0 ? 'text-emerald-400' : 'text-red-400'}>{m.oneYrRet >= 0 ? '+' : ''}{m.oneYrRet.toFixed(1)}%</span></div>}
                  {m.threeYrRet != null && <div>3Y: <span className={m.threeYrRet >= 0 ? 'text-emerald-400' : 'text-red-400'}>{m.threeYrRet >= 0 ? '+' : ''}{m.threeYrRet.toFixed(1)}%</span></div>}
                  {m.fiveYrRet != null && <div>5Y: <span className={isPositive ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{m.fiveYrRet >= 0 ? '+' : ''}{m.fiveYrRet.toFixed(1)}%</span></div>}
                </div>
              </div>
              <div className="h-44">
                <ResponsiveContainer>
                  <LineChart data={m.series} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="month"
                      stroke="#64748b"
                      tick={{ fontSize: 9 }}
                      ticks={[0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144]}
                      tickFormatter={(m) => `${(m / 12).toFixed(0)}y`}
                    />
                    <YAxis stroke="#64748b" tick={{ fontSize: 9 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload;
                        return (
                          <div className="bg-surface-900 border border-surface-700 rounded-lg px-2 py-1.5 text-xs shadow-xl">
                            <p className="text-surface-400">Year {(p.month / 12).toFixed(1)}</p>
                            {p.current != null && <p className="text-brand-400">Current: {p.current.toFixed(1)}%</p>}
                            {p.historical != null && <p className="text-fuchsia-400">Historical: {p.historical.toFixed(1)}%</p>}
                          </div>
                        );
                      }}
                    />
                    {/* Vertical line at year 7 (end of 7yr window) */}
                    <Line
                      type="monotone"
                      dataKey="historical"
                      stroke="#d946ef"
                      strokeWidth={1.5}
                      dot={false}
                      name="Historical (with 5yr forward)"
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="current"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                      name="Current 7yr"
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-between text-[10px] text-surface-500 mt-1">
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-emerald-400 inline-block" /> Current 7y</span>
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-fuchsia-400 inline-block" /> Historical (extended 5y →)</span>
                <span>Y7 = match end</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 p-3 rounded-lg bg-surface-800/40 border border-surface-700/40 text-xs text-surface-400">
        <strong className="text-surface-200">How to read:</strong> The green line is the current 7-year S&P 500 pattern (normalized to % from start).
        The purple line is the historical match — also normalized — extended 5 years past the match end (year 7+) to show what the market did next.
        Higher correlation = more similar shape.
      </div>
    </Card>
  );
}

export default function MarketsTab({ snapshot, loading, lastRefresh, onRefresh }) {
  const [selectedETF, setSelectedETF] = useState('SPY');
  const [regionFilter, setRegionFilter] = useState('All');

  const regions = ['All', 'US', 'Europe', 'Asia-Pacific', 'Americas'];
  const filteredIndices = snapshot?.indices?.filter(
    (i) => regionFilter === 'All' || i.region === regionFilter
  ) || [];

  const selectedETFData = snapshot?.etfs?.find((e) => e.symbol === selectedETF);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Globe size={24} className="text-brand-400" />
            <h1 className="text-2xl font-black tracking-tight">World Markets</h1>
            {snapshot?.isLive && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-medium">
                <Radio size={10} className="animate-pulse" /> Live Data
              </span>
            )}
          </div>
          <p className="text-surface-400 text-sm">Real-time data from global stock exchanges — auto-refreshes daily</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-surface-500">
          {lastRefresh && (
            <span className="flex items-center gap-1.5">
              <Clock size={13} />
              {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700 transition disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Section timestamp */}
      {lastRefresh && (
        <SectionTimestamp fetchedAt={lastRefresh} label="World Markets" loading={loading} onRefresh={onRefresh} />
      )}

      {/* Region filter */}
      <div className="flex gap-2">
        {regions.map((r) => (
          <button
            key={r}
            onClick={() => setRegionFilter(r)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${regionFilter === r ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30' : 'bg-surface-800 text-surface-400 hover:text-white border border-transparent'}`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* World Indices Grid */}
      {loading && !snapshot ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-surface-800/40 rounded-xl p-4 h-32 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredIndices.map((idx) => (
            <IndexCard key={idx.symbol} index={idx} />
          ))}
        </div>
      )}

      {/* Portfolio ETFs */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <BarChart3 size={20} className="text-brand-400" />
          <h2 className="text-xl font-bold">Portfolio ETF Tracker</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ETF List */}
          <Card className="lg:col-span-1 p-0 overflow-hidden">
            <div className="p-4 border-b border-surface-700/50">
              <p className="text-sm font-semibold text-surface-400">Your ETFs</p>
            </div>
            <div className="divide-y divide-surface-800">
              {(snapshot?.etfs || []).map((etf) => {
                const isUp = (etf.change ?? 0) >= 0;
                const isSelected = etf.symbol === selectedETF;
                return (
                  <button
                    key={etf.symbol}
                    onClick={() => setSelectedETF(etf.symbol)}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between transition ${isSelected ? 'bg-brand-500/10' : 'hover:bg-surface-800/50'}`}
                  >
                    <div>
                      <p className={`text-sm font-semibold ${isSelected ? 'text-brand-400' : 'text-surface-200'}`}>{etf.symbol}</p>
                      <p className="text-xs text-surface-500 truncate max-w-[140px]">{etf.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{etf.price != null ? `$${etf.price.toFixed(2)}` : '—'}</p>
                      <p className={`text-xs ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        {etf.changePercent != null ? `${isUp ? '+' : ''}${etf.changePercent.toFixed(2)}%` : ''}
                      </p>
                      <Timestamp time={etf.lastUpdated} />
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* ETF Detail */}
          <Card className="lg:col-span-2">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">{selectedETFData?.symbol || selectedETF}</h3>
                <p className="text-sm text-surface-400">{selectedETFData?.name || ''}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">
                  {selectedETFData?.price != null ? `$${selectedETFData.price.toFixed(2)}` : '—'}
                </p>
                {selectedETFData?.changePercent != null && (
                  <p className={`text-sm font-medium ${selectedETFData.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {selectedETFData.change >= 0 ? '+' : ''}{selectedETFData.change?.toFixed(2)} ({selectedETFData.change >= 0 ? '+' : ''}{selectedETFData.changePercent.toFixed(2)}%)
                  </p>
                )}
              </div>
            </div>

            <ETFDetailChart symbol={selectedETF} />

            {/* Trailing Metrics */}
            {selectedETFData?.trailingReturn != null && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                <div className="bg-surface-800 rounded-lg p-3 text-center">
                  <p className="text-xs text-surface-500">Trailing Return (1Y)</p>
                  <p className={`text-lg font-bold ${selectedETFData.trailingReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(selectedETFData.trailingReturn * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="bg-surface-800 rounded-lg p-3 text-center">
                  <p className="text-xs text-surface-500">Trailing Vol (1Y)</p>
                  <p className="text-lg font-bold text-orange-400">
                    {(selectedETFData.trailingVol * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="bg-surface-800 rounded-lg p-3 text-center">
                  <p className="text-xs text-surface-500">Sharpe Ratio</p>
                  <p className="text-lg font-bold text-blue-400">
                    {selectedETFData.trailingSharpe?.toFixed(3)}
                  </p>
                </div>
              </div>
            )}

            {/* 52-week range */}
            {selectedETFData?.fiftyTwoWeekLow != null && (
              <div className="mt-4">
                <p className="text-xs text-surface-500 mb-1">52-Week Range</p>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-surface-400">${selectedETFData.fiftyTwoWeekLow?.toFixed(2)}</span>
                  <div className="flex-1 bg-surface-800 rounded-full h-2 relative">
                    {(() => {
                      const low = selectedETFData.fiftyTwoWeekLow;
                      const high = selectedETFData.fiftyTwoWeekHigh;
                      const pct = high > low ? ((selectedETFData.price - low) / (high - low)) * 100 : 50;
                      return <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-brand-400 border-2 border-surface-900" style={{ left: `${Math.min(100, Math.max(0, pct))}%` }} />;
                    })()}
                  </div>
                  <span className="text-xs text-surface-400">${selectedETFData.fiftyTwoWeekHigh?.toFixed(2)}</span>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol={selectedETF} title={`${selectedETF} — 12-Week Trend`} />

      {/* Historical Pattern Analysis (S&P 500) */}
      <div id="historical-patterns">
        <HistoricalPatterns />
      </div>
    </div>
  );
}
