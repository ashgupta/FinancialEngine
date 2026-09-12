import React, { useState, useEffect } from 'react';
import {
  RefreshCw, TrendingUp, TrendingDown, Activity, ArrowUp, ArrowDown,
  MinusCircle, AlertTriangle, Layers, BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
}

const REGIME_STYLES = {
  'risk-on': {
    label: 'Risk-On',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15 border-emerald-500/30',
    icon: TrendingUp,
  },
  'risk-off': {
    label: 'Risk-Off',
    color: 'text-red-400',
    bg: 'bg-red-500/15 border-red-500/30',
    icon: TrendingDown,
  },
  'mixed': {
    label: 'Mixed',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/15 border-yellow-500/30',
    icon: MinusCircle,
  },
};

const TREND_ICONS = {
  accelerating: { icon: ArrowUp, color: 'text-emerald-400' },
  decelerating: { icon: ArrowDown, color: 'text-red-400' },
  steady: { icon: MinusCircle, color: 'text-surface-400' },
};

const VSSPY_COLORS = {
  outperforming: 'text-emerald-400',
  underperforming: 'text-red-400',
  'in line': 'text-surface-400',
};

function fmtPct(v, withSign = true) {
  if (v == null) return '—';
  const s = withSign && v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

function fmtRs(v) {
  if (v == null) return '—';
  return v.toFixed(2);
}

export default function SectorRotationTab() {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchScan = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/sector/scan${forceRefresh ? '?refresh=1' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setScan(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScan();
  }, []);

  const regime = scan?.regime || 'mixed';
  const regimeStyle = REGIME_STYLES[regime] || REGIME_STYLES.mixed;
  const RegimeIcon = regimeStyle.icon;

  const chartData = (scan?.ranked || []).map((r) => ({
    symbol: r.symbol,
    rsScore: r.rsScore ?? 0,
    sector: r.sector,
  }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Layers size={20} className="text-brand-400" />
          <h2 className="text-lg font-bold">Sector Rotation Matrix</h2>
        </div>
        <button
          onClick={fetchScan}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-800/60 text-surface-300 hover:text-white text-sm transition border border-surface-700/50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Section timestamp */}
      {scan && !error && (
        <SectionTimestamp fetchedAt={scan?.fetchedAt} label="Sector Rotation" loading={loading} onRefresh={() => fetchScan(true)} />
      )}

      {/* Error */}
      {error && !loading && (
        <Card className="border-red-500/30">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle size={16} />
            <span className="text-sm font-medium">Failed to load sector rotation: {error}</span>
          </div>
        </Card>
      )}

      {/* Loading */}
      {loading && !scan && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface-800/40 rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      )}

      {scan && !loading && (
        <>
          {/* Regime badge + rotation signal */}
          <Card>
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold border ${regimeStyle.bg} ${regimeStyle.color}`}>
                <RegimeIcon size={14} />
                {regimeStyle.label}
              </span>
              {scan.cached && (
                <span className="text-[10px] text-surface-600">(cached)</span>
              )}
            </div>
            <p className="text-sm text-surface-300 leading-relaxed">{scan.rotationSignal}</p>
          </Card>

          {/* Leading vs Trailing cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-emerald-400">Leading Sectors</h3>
              </div>
              <div className="space-y-2">
                {(scan.leading || []).map((s) => (
                  <div key={s.symbol} className="flex items-center justify-between bg-surface-800/40 rounded-lg p-2.5">
                    <div>
                      <p className="text-xs font-semibold text-surface-200">{s.symbol}</p>
                      <p className="text-[10px] text-surface-500">{s.sector}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-emerald-400">{fmtRs(s.rsScore)}</p>
                      <p className="text-[10px] text-surface-500">{fmtPct(s.roc3m)}</p>
                    </div>
                  </div>
                ))}
                {(!scan.leading || scan.leading.length === 0) && (
                  <p className="text-xs text-surface-600 italic">No data</p>
                )}
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown size={16} className="text-red-400" />
                <h3 className="text-sm font-bold text-red-400">Trailing Sectors</h3>
              </div>
              <div className="space-y-2">
                {(scan.trailing || []).map((s) => (
                  <div key={s.symbol} className="flex items-center justify-between bg-surface-800/40 rounded-lg p-2.5">
                    <div>
                      <p className="text-xs font-semibold text-surface-200">{s.symbol}</p>
                      <p className="text-[10px] text-surface-500">{s.sector}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-red-400">{fmtRs(s.rsScore)}</p>
                      <p className="text-[10px] text-surface-500">{fmtPct(s.roc3m)}</p>
                    </div>
                  </div>
                ))}
                {(!scan.trailing || scan.trailing.length === 0) && (
                  <p className="text-xs text-surface-600 italic">No data</p>
                )}
              </div>
            </Card>
          </div>

          {/* RS Score bar chart */}
          {chartData.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 size={16} className="text-brand-400" />
                <h3 className="text-sm font-bold">Relative Strength vs SPY (diverging from 0)</h3>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="symbol"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      axisLine={{ stroke: '#334155' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      axisLine={{ stroke: '#334155' }}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      labelStyle={{ color: '#e2e8f0' }}
                      formatter={(value, name, props) => {
                        if (name === 'rsScore') {
                          const sector = props?.payload?.sector || '';
                          return [fmtRs(value), `RS · ${sector}`];
                        }
                        return [value, name];
                      }}
                    />
                    <Bar dataKey="rsScore" radius={[3, 3, 0, 0]}>
                      {chartData.map((entry, idx) => (
                        <Cell
                          key={`cell-${idx}`}
                          fill={entry.rsScore >= 0 ? '#10b981' : '#ef4444'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* Ranked table */}
          {(scan.ranked || []).length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-800">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-brand-400" />
                  <h3 className="text-sm font-bold">Sector Relative Strength Ranking</h3>
                </div>
                <p className="text-[11px] text-surface-500 mt-0.5">
                  RS score = sector ROC / SPY ROC across 1M/3M/6M/12M lookbacks
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-700 text-surface-500 text-left text-xs uppercase tracking-wider">
                      <th className="py-2 pl-3 font-medium">Sector</th>
                      <th className="py-2 text-right font-medium">RS Score</th>
                      <th className="py-2 text-right font-medium">1M ROC</th>
                      <th className="py-2 text-right font-medium">3M ROC</th>
                      <th className="py-2 text-right font-medium">6M ROC</th>
                      <th className="py-2 text-right font-medium">12M ROC</th>
                      <th className="py-2 text-center font-medium">Trend</th>
                      <th className="py-2 pr-3 text-right font-medium">vs SPY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(scan.ranked || []).map((r) => {
                      const TrendIcon = TREND_ICONS[r.trend]?.icon || MinusCircle;
                      const trendColor = TREND_ICONS[r.trend]?.color || 'text-surface-400';
                      const vsSpyColor = VSSPY_COLORS[r.vsSpy] || 'text-surface-400';
                      const rsColor = r.rsScore > 1 ? 'text-emerald-400' : r.rsScore < 1 ? 'text-red-400' : 'text-surface-400';
                      return (
                        <tr key={r.symbol} className="border-b border-surface-800/50 hover:bg-surface-800/30 transition">
                          <td className="py-2.5 pl-3">
                            <p className="text-xs font-semibold text-surface-200">{r.symbol}</p>
                            <p className="text-[10px] text-surface-500">{r.sector}</p>
                          </td>
                          <td className={`py-2.5 text-right text-xs font-bold ${rsColor}`}>{fmtRs(r.rsScore)}</td>
                          <td className="py-2.5 text-right text-xs text-surface-400">{fmtPct(r.roc1m)}</td>
                          <td className="py-2.5 text-right text-xs text-surface-400">{fmtPct(r.roc3m)}</td>
                          <td className="py-2.5 text-right text-xs text-surface-400">{fmtPct(r.roc6m)}</td>
                          <td className="py-2.5 text-right text-xs text-surface-400">{fmtPct(r.roc12m)}</td>
                          <td className="py-2.5 text-center">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${trendColor}`}>
                              <TrendIcon size={12} />
                              {r.trend}
                            </span>
                          </td>
                          <td className={`py-2.5 pr-3 text-right text-[10px] font-medium ${vsSpyColor}`}>
                            {r.vsSpy}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* 12-Week Trend View */}
          <WeeklyTrendView symbol="XLK" title="Technology Sector (XLK) — 12-Week Trend" color="#3b82f6" />

          {/* Footer */}
          <p className="text-[11px] text-surface-600 leading-relaxed">
            Source: Yahoo Finance (daily closes, ~13 months) ·
            RS Score = sector ROC / SPY ROC (weighted 1M/3M/6M/12M) ·
            Regime: cyclical sectors leading = risk-on, defensive sectors leading = risk-off ·
            Educational only — not financial advice.
          </p>
        </>
      )}
    </div>
  );
}
