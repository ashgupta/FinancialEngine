import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, BarChart3, Calendar } from 'lucide-react';
import SectionTimestamp from './SectionTimestamp';

const fmtPct = (v) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const fmtPrice = (v) => v == null ? '—' : `$${v.toFixed(2)}`;

/**
 * WeeklyTrendView — displays a 12-week price trend chart for a given symbol.
 * Constitution Principle XII: every tab/section must include a 12-week trend view.
 *
 * @param {string} symbol - ticker symbol to fetch history for
 * @param {string} [title] - optional custom title
 * @param {string} [color] - chart line color (default brand blue)
 * @param {'area'|'line'|'bar'} [chartType] - chart type (default 'area')
 * @param {boolean} [showChangeBar] - show weekly % change as a bar chart below
 * @param {string} [className] - extra classes
 */
export default function WeeklyTrendView({
  symbol,
  title,
  color = '#3b82f6',
  chartType = 'area',
  showChangeBar = true,
  className = '',
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  const fetchTrend = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/yf/history/${encodeURIComponent(symbol)}?range=3mo&interval=1wk${forceRefresh ? '&refresh=1' : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setFetchedAt(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrend();
  }, [symbol]);

  // Take last 12 weeks of data
  const chartData = useMemo(() => {
    if (!data?.dates?.length) return [];
    const start = Math.max(0, data.dates.length - 12);
    const slices = [];
    for (let i = start; i < data.dates.length; i++) {
      const prevClose = i > 0 ? data.closes[i - 1] : data.closes[i];
      const weeklyChange = prevClose ? ((data.closes[i] - prevClose) / prevClose) * 100 : 0;
      slices.push({
        date: data.dates[i],
        close: data.closes[i],
        volume: data.volumes?.[i] ?? null,
        change: weeklyChange,
        label: new Date(data.dates[i]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      });
    }
    return slices;
  }, [data]);

  const overallChange = useMemo(() => {
    if (chartData.length < 2) return null;
    const first = chartData[0].close;
    const last = chartData[chartData.length - 1].close;
    return first ? ((last - first) / first) * 100 : null;
  }, [chartData]);

  const isUp = (overallChange ?? 0) >= 0;

  if (loading && !data) {
    return (
      <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={16} className="text-brand-400" />
          <h3 className="font-semibold">{title || `${symbol} — 12-Week Trend`}</h3>
        </div>
        <div className="h-48 flex items-center justify-center text-surface-500 text-sm">
          Loading 12-week trend data…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={16} className="text-brand-400" />
          <h3 className="font-semibold">{title || `${symbol} — 12-Week Trend`}</h3>
        </div>
        <div className="h-48 flex items-center justify-center text-red-400 text-sm">
          Failed to load trend data: {error}
        </div>
      </div>
    );
  }

  if (!chartData.length) return null;

  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-brand-400" />
          <h3 className="font-semibold">{title || `${symbol} — 12-Week Trend`}</h3>
          {overallChange != null && (
            <span className={`flex items-center gap-1 text-sm font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {fmtPct(overallChange)}
            </span>
          )}
        </div>
      </div>

      <SectionTimestamp fetchedAt={fetchedAt} label="Trend Data" loading={loading} onRefresh={() => fetchTrend(true)} className="mb-3" />

      {/* Main price chart */}
      <div className="h-48 mb-4">
        <ResponsiveContainer>
          {chartType === 'line' ? (
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 shadow-xl text-xs">
                      <p className="text-surface-400 mb-1">{label}</p>
                      <p style={{ color }} className="font-medium">Close: {fmtPrice(payload[0].value)}</p>
                      {payload[0].payload.change != null && (
                        <p className={payload[0].payload.change >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          Weekly: {fmtPct(payload[0].payload.change)}
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Line dataKey="close" stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          ) : chartType === 'bar' ? (
            <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 shadow-xl text-xs">
                      <p className="text-surface-400 mb-1">{label}</p>
                      <p style={{ color }} className="font-medium">Close: {fmtPrice(payload[0].value)}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="close" fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <defs>
                <linearGradient id={`trendGradient-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 shadow-xl text-xs">
                      <p className="text-surface-400 mb-1">{label}</p>
                      <p style={{ color }} className="font-medium">Close: {fmtPrice(payload[0].value)}</p>
                      {payload[0].payload.change != null && (
                        <p className={payload[0].payload.change >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          Weekly: {fmtPct(payload[0].payload.change)}
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Area dataKey="close" stroke={color} strokeWidth={2} fill={`url(#trendGradient-${symbol})`} />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Weekly change bar chart */}
      {showChangeBar && (
        <div className="h-24">
          <p className="text-xs text-surface-500 mb-1">Weekly % Change</p>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
              <ReferenceLine y={0} stroke="#64748b" />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const v = payload[0].value;
                  return (
                    <div className="bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 shadow-xl text-xs">
                      <p className="text-surface-400 mb-1">{label}</p>
                      <p className={v >= 0 ? 'text-emerald-400' : 'text-red-400'}>Change: {fmtPct(v)}</p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="change" radius={[2, 2, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.change >= 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
