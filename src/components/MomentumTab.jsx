import React, { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw, Clock, TrendingUp, TrendingDown, Activity, Gauge,
  BarChart3, Layers, Volume2, Zap, ArrowUpRight, ArrowDownRight,
  AlertTriangle, Target, Sparkles,
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

const SUB_VIEWS = [
  { id: 'tsm',       label: 'Time Series',    icon: TrendingUp },
  { id: 'cross',     label: 'Cross-Sectional', icon: BarChart3 },
  { id: 'factor',    label: 'Factor Rotation', icon: Layers },
  { id: 'volume',    label: 'Volume Analysis', icon: Volume2 },
];

const SIGNAL_COLORS = {
  'strong bullish': 'text-emerald-400 bg-emerald-500/15',
  'bullish': 'text-emerald-400 bg-emerald-500/5',
  'neutral': 'text-surface-400 bg-surface-700/30',
  'bearish': 'text-red-400 bg-red-500/5',
  'strong bearish': 'text-red-400 bg-red-500/15',
};

const MA_STACK_COLORS = {
  'bullish': 'text-emerald-400',
  'bearish': 'text-red-400',
  'mixed': 'text-surface-400',
};

function fmtPct(v, withSign = true) {
  if (v == null) return '—';
  const s = withSign && v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

function fmtNum(v) {
  if (v == null) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtVol(v) {
  if (v == null) return '—';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

// ─── Time Series Momentum View ──────────────────────────
function TSMAssetRow({ a }) {
  const ts = a.timeSeries;
  if (!ts || ts.insufficientData) {
    return (
      <tr className="border-b border-surface-800/50">
        <td className="py-2.5 pl-3 text-xs text-surface-500">{a.symbol}</td>
        <td colSpan={8} className="py-2.5 text-xs text-surface-600 italic">Insufficient data</td>
      </tr>
    );
  }
  const scoreUp = (ts.momentumScore ?? 0) > 0;
  return (
    <tr className="border-b border-surface-800/50 hover:bg-surface-800/30 transition">
      <td className="py-2.5 pl-3">
        <p className="text-xs font-semibold text-surface-200">{a.symbol}</p>
        <p className="text-[10px] text-surface-500">{a.name}</p>
      </td>
      <td className="py-2.5">
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${SIGNAL_COLORS[ts.signal] || ''}`}>
          {ts.signal}
        </span>
      </td>
      <td className={`py-2.5 text-right text-xs font-bold ${scoreUp ? 'text-emerald-400' : 'text-red-400'}`}>
        {fmtPct(ts.momentumScore)}
      </td>
      <td className="py-2.5 text-right text-xs text-surface-400">{fmtPct(ts.roc1m)}</td>
      <td className="py-2.5 text-right text-xs text-surface-400">{fmtPct(ts.roc3m)}</td>
      <td className="py-2.5 text-right text-xs text-surface-400">{fmtPct(ts.roc6m)}</td>
      <td className="py-2.5 text-right text-xs text-surface-400">{fmtPct(ts.roc12m)}</td>
      <td className={`py-2.5 text-center text-[10px] font-medium ${MA_STACK_COLORS[ts.maStack] || 'text-surface-500'}`}>
        {ts.maStack}
      </td>
      <td className="py-2.5 pr-3 text-right">
        {ts.rsi14 != null ? (
          <span className={`text-xs font-medium ${ts.rsi14 > 70 ? 'text-red-400' : ts.rsi14 < 30 ? 'text-emerald-400' : 'text-surface-400'}`}>
            {ts.rsi14.toFixed(0)}
          </span>
        ) : <span className="text-surface-600">—</span>}
      </td>
    </tr>
  );
}

function TimeSeriesView({ assets }) {
  const sorted = useMemo(() => {
    return [...assets].sort((a, b) => (b.momentumScore ?? -Infinity) - (a.momentumScore ?? -Infinity));
  }, [assets]);

  // Breakout signals
  const breakouts = useMemo(() => {
    const highs = assets.filter((a) => a.timeSeries?.breakout === '52w-high' || a.timeSeries?.breakout === 'upper-band');
    const lows = assets.filter((a) => a.timeSeries?.breakout === '52w-low' || a.timeSeries?.breakout === 'lower-band');
    return { highs, lows };
  }, [assets]);

  return (
    <div className="space-y-4">
      {/* Breakout signals */}
      {(breakouts.highs.length > 0 || breakouts.lows.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {breakouts.highs.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <Zap size={16} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-emerald-400">Breakout Signals ({breakouts.highs.length})</h3>
              </div>
              <div className="space-y-1.5">
                {breakouts.highs.map((a) => (
                  <div key={a.symbol} className="flex items-center justify-between text-xs">
                    <span className="text-surface-200 font-medium">{a.symbol}</span>
                    <span className="text-surface-500">{a.timeSeries.breakout}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {breakouts.lows.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-red-400" />
                <h3 className="text-sm font-bold text-red-400">Breakdown Signals ({breakouts.lows.length})</h3>
              </div>
              <div className="space-y-1.5">
                {breakouts.lows.map((a) => (
                  <div key={a.symbol} className="flex items-center justify-between text-xs">
                    <span className="text-surface-200 font-medium">{a.symbol}</span>
                    <span className="text-surface-500">{a.timeSeries.breakout}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Full table */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-800">
          <h3 className="text-sm font-bold">Time Series Momentum — All Assets</h3>
          <p className="text-[11px] text-surface-500 mt-0.5">
            Each asset's own trend: MA crossovers, rate of change, RSI, breakout status
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700 text-surface-500 text-left text-xs uppercase tracking-wider">
                <th className="py-2 pl-3 font-medium">Asset</th>
                <th className="py-2 font-medium">Signal</th>
                <th className="py-2 text-right font-medium">Mom Score</th>
                <th className="py-2 text-right font-medium">1M ROC</th>
                <th className="py-2 text-right font-medium">3M ROC</th>
                <th className="py-2 text-right font-medium">6M ROC</th>
                <th className="py-2 text-right font-medium">12M ROC</th>
                <th className="py-2 text-center font-medium">MA Stack</th>
                <th className="py-2 pr-3 text-right font-medium">RSI</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => <TSMAssetRow key={a.symbol} a={a} />)}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Cross-Sectional Momentum View ──────────────────────
function CrossSectionalView({ crossSectional }) {
  if (!crossSectional?.ranked?.length) {
    return <Card><p className="text-sm text-surface-500">No cross-sectional data available.</p></Card>;
  }
  const { ranked, leaders, laggards, medianScore } = crossSectional;

  return (
    <div className="space-y-4">
      {/* Leaders vs Laggards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-emerald-400" />
            <h3 className="text-sm font-bold text-emerald-400">Top Performers (Leaders)</h3>
          </div>
          <div className="space-y-2">
            {leaders.map((a, i) => (
              <div key={a.symbol} className="flex items-center justify-between bg-surface-800/40 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-emerald-400">#{i + 1}</span>
                  <div>
                    <p className="text-xs font-semibold text-surface-200">{a.symbol}</p>
                    <p className="text-[10px] text-surface-500">{a.name}</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-emerald-400">{fmtPct(a.momentumScore)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown size={16} className="text-red-400" />
            <h3 className="text-sm font-bold text-red-400">Bottom Performers (Laggards)</h3>
          </div>
          <div className="space-y-2">
            {laggards.map((a, i) => (
              <div key={a.symbol} className="flex items-center justify-between bg-surface-800/40 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-red-400">#{ranked.length - laggards.length + i + 1}</span>
                  <div>
                    <p className="text-xs font-semibold text-surface-200">{a.symbol}</p>
                    <p className="text-[10px] text-surface-500">{a.name}</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-red-400">{fmtPct(a.momentumScore)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Full ranking */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-800">
          <h3 className="text-sm font-bold">Cross-Sectional Ranking</h3>
          <p className="text-[11px] text-surface-500 mt-0.5">
            All assets ranked by momentum score · Median: {fmtPct(medianScore)}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700 text-surface-500 text-left text-xs uppercase tracking-wider">
                <th className="py-2 pl-3 font-medium">Rank</th>
                <th className="py-2 font-medium">Asset</th>
                <th className="py-2 text-right font-medium">Mom Score</th>
                <th className="py-2 text-right font-medium">3M ROC</th>
                <th className="py-2 text-right font-medium">6M ROC</th>
                <th className="py-2 text-right font-medium">Percentile</th>
                <th className="py-2 pr-3 font-medium">Bar</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((a) => {
                const score = a.momentumScore ?? 0;
                const maxAbs = Math.max(...ranked.map((r) => Math.abs(r.momentumScore ?? 0)), 1);
                const barWidth = (Math.abs(score) / maxAbs) * 100;
                const isLeader = score > 0;
                return (
                  <tr key={a.symbol} className="border-b border-surface-800/50 hover:bg-surface-800/30 transition">
                    <td className="py-2.5 pl-3 text-xs font-bold text-surface-400">#{a.csRank}</td>
                    <td className="py-2.5">
                      <p className="text-xs font-semibold text-surface-200">{a.symbol}</p>
                      <p className="text-[10px] text-surface-500">{a.name}</p>
                    </td>
                    <td className={`py-2.5 text-right text-xs font-bold ${isLeader ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtPct(score)}
                    </td>
                    <td className="py-2.5 text-right text-xs text-surface-400">{fmtPct(a.roc3m)}</td>
                    <td className="py-2.5 text-right text-xs text-surface-400">{fmtPct(a.roc6m)}</td>
                    <td className="py-2.5 text-right text-xs text-surface-400">{a.percentile?.toFixed(0)}%</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1 w-24">
                        {!isLeader && (
                          <div className="flex-1 flex justify-end">
                            <div className="h-2 rounded-l-full bg-red-500/60" style={{ width: `${barWidth / 2}%` }} />
                          </div>
                        )}
                        <div className="w-px h-3 bg-surface-600" />
                        {isLeader && (
                          <div className="flex-1">
                            <div className="h-2 rounded-r-full bg-emerald-500/60" style={{ width: `${barWidth / 2}%` }} />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Factor Rotation View ───────────────────────────────
function FactorRotationView({ factorMomentum }) {
  if (!factorMomentum?.ranked?.length) {
    return <Card><p className="text-sm text-surface-500">No factor data available.</p></Card>;
  }
  const { ranked, leading, trailing } = factorMomentum;

  return (
    <div className="space-y-4">
      {/* Leading / trailing summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="text-center">
          <p className="text-xs text-surface-500 mb-1">Leading Factor</p>
          <p className="text-xl font-bold text-emerald-400">{leading || '—'}</p>
        </Card>
        <Card className="text-center">
          <p className="text-xs text-surface-500 mb-1">Trailing Factor</p>
          <p className="text-xl font-bold text-red-400">{trailing || '—'}</p>
        </Card>
      </div>

      {/* Factor ranking */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-800">
          <h3 className="text-sm font-bold">Factor Rotation — Which Factors Are Working Now</h3>
          <p className="text-[11px] text-surface-500 mt-0.5">
            Factor ETFs ranked by 3-month ROC · Rotate into leading factors, out of trailing
          </p>
        </div>
        <div className="p-4 space-y-3">
          {ranked.map((f, i) => {
            const score = f.roc3m ?? 0;
            const maxAbs = Math.max(...ranked.map((r) => Math.abs(r.roc3m ?? 0)), 1);
            const barWidth = (Math.abs(score) / maxAbs) * 100;
            const isLeader = score > 0;
            return (
              <div key={f.symbol} className="flex items-center gap-3">
                <span className="text-xs font-bold text-surface-400 w-6">#{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-xs font-semibold text-surface-200">{f.factor}</span>
                      <span className="text-[10px] text-surface-500 ml-2">{f.symbol}</span>
                    </div>
                    <span className={`text-xs font-bold ${isLeader ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtPct(f.roc3m)} (3M) · {fmtPct(f.roc1m)} (1M)
                    </span>
                  </div>
                  <div className="h-2.5 bg-surface-800 rounded-full overflow-hidden relative">
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-surface-600" />
                    {isLeader ? (
                      <div className="absolute left-1/2 top-0 bottom-0 bg-emerald-500/60 rounded-r-full" style={{ width: `${barWidth / 2}%` }} />
                    ) : (
                      <div className="absolute right-1/2 top-0 bottom-0 bg-red-500/60 rounded-l-full" style={{ width: `${barWidth / 2}%` }} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ─── Volume Analysis View ───────────────────────────────
function VolumeAnalysisView({ assets }) {
  const withVol = assets.filter((a) => a.volume && !a.volume.insufficientData);

  // Sort by volume confirmation strength
  const sorted = useMemo(() => {
    const order = { 'strong bullish': 4, 'bullish': 3, 'neutral': 2, 'bearish': 1, 'strong bearish': 0 };
    return [...withVol].sort((a, b) => (order[b.volume.confirmation] ?? 2) - (order[a.volume.confirmation] ?? 2));
  }, [withVol]);

  // Spikes
  const spikeAssets = withVol.filter((a) => a.volume.spikes?.length > 0);

  return (
    <div className="space-y-4">
      {/* Volume spikes */}
      {spikeAssets.length > 0 && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={16} className="text-yellow-400" />
            <h3 className="text-sm font-bold text-yellow-400">Volume Spikes ({spikeAssets.length} assets)</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {spikeAssets.map((a) => (
              <div key={a.symbol} className="bg-surface-800/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-surface-200">{a.symbol}</p>
                  <span className="text-[10px] text-surface-500">{a.name}</span>
                </div>
                {a.volume.spikes.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px] mt-1">
                    <span className={s.priceUp ? 'text-emerald-400' : 'text-red-400'}>
                      {s.priceUp ? '↑' : '↓'} {s.ratio}x avg vol
                    </span>
                    <span className="text-surface-500">{s.interpretation}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Volume table */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-800">
          <h3 className="text-sm font-bold">Volume-Price Analysis</h3>
          <p className="text-[11px] text-surface-500 mt-0.5">
            Volume confirmation: rising volume on up days = bullish · OBV trend = accumulation/distribution
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700 text-surface-500 text-left text-xs uppercase tracking-wider">
                <th className="py-2 pl-3 font-medium">Asset</th>
                <th className="py-2 font-medium">Confirmation</th>
                <th className="py-2 text-right font-medium">Up Vol %</th>
                <th className="py-2 text-right font-medium">Vol vs Avg</th>
                <th className="py-2 text-right font-medium">Vol Trend</th>
                <th className="py-2 font-medium">OBV Trend</th>
                <th className="py-2 text-right font-medium">Last Vol</th>
                <th className="py-2 pr-3 text-center font-medium">Spikes</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const v = a.volume;
                const confColor = v.confirmation.includes('bullish') ? 'text-emerald-400 bg-emerald-500/10'
                  : v.confirmation.includes('bearish') ? 'text-red-400 bg-red-500/10'
                  : 'text-surface-400 bg-surface-700/30';
                return (
                  <tr key={a.symbol} className="border-b border-surface-800/50 hover:bg-surface-800/30 transition">
                    <td className="py-2.5 pl-3">
                      <p className="text-xs font-semibold text-surface-200">{a.symbol}</p>
                      <p className="text-[10px] text-surface-500">{a.name}</p>
                    </td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${confColor}`}>
                        {v.confirmation}
                      </span>
                    </td>
                    <td className={`py-2.5 text-right text-xs font-medium ${v.upVolPct > 55 ? 'text-emerald-400' : v.upVolPct < 45 ? 'text-red-400' : 'text-surface-400'}`}>
                      {v.upVolPct.toFixed(1)}%
                    </td>
                    <td className={`py-2.5 text-right text-xs ${v.volRatio > 1.5 ? 'text-yellow-400 font-bold' : 'text-surface-400'}`}>
                      {v.volRatio ? v.volRatio + 'x' : '—'}
                    </td>
                    <td className={`py-2.5 text-right text-xs ${v.volTrend > 20 ? 'text-emerald-400' : v.volTrend < -20 ? 'text-red-400' : 'text-surface-400'}`}>
                      {fmtPct(v.volTrend)}
                    </td>
                    <td className={`py-2.5 text-xs ${v.obvTrend.includes('rising') ? 'text-emerald-400' : v.obvTrend.includes('falling') ? 'text-red-400' : 'text-surface-400'}`}>
                      {v.obvTrend}
                    </td>
                    <td className="py-2.5 text-right text-xs text-surface-400">{fmtVol(v.lastVol)}</td>
                    <td className="py-2.5 pr-3 text-center">
                      {v.spikes?.length > 0 ? (
                        <span className="text-yellow-400 text-xs font-bold">{v.spikes.length}</span>
                      ) : <span className="text-surface-700">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────
export default function MomentumTab() {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeView, setActiveView] = useState('tsm');
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

  const fetchAICommentary = async (scanData) => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/ai/commentary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'momentum', data: scanData }),
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

  const refresh = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/momentum/scan${forceRefresh ? '?refresh=1' : ''}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setScan(data);
      // Fetch AI commentary after scan loads
      fetchAICommentary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const validAssets = scan?.assets?.filter((a) => !a.insufficientData) || [];
  const bullCount = validAssets.filter((a) => a.signal?.includes('bullish')).length;
  const bearCount = validAssets.filter((a) => a.signal?.includes('bearish')).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Gauge size={24} className="text-brand-400" />
            <h1 className="text-2xl font-black tracking-tight">Momentum & Volume</h1>
            {scan && !error && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-500/15 text-brand-400 text-xs font-medium">
                {validAssets.length} assets scanned
              </span>
            )}
            {scan?.stale && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-400 text-xs font-medium">
                <AlertTriangle size={10} /> Stale
              </span>
            )}
          </div>
          <p className="text-surface-400 text-sm">
            Three kinds of momentum (time series, cross-sectional, factor) + volume-price confirmation
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-surface-500">
          {scan?.fetchedAt && (
            <span className="flex items-center gap-1.5"><Clock size={13} />{new Date(scan.fetchedAt).toLocaleTimeString()}</span>
          )}
          <button onClick={refresh} disabled={loading} className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700 transition disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Section timestamp */}
      {scan && !error && (
        <SectionTimestamp fetchedAt={scan?.fetchedAt} label="Momentum Scan" loading={loading} onRefresh={() => refresh(true)} />
      )}

      {/* Error */}
      {error && (
        <Card className="border-red-500/30">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle size={16} />
            <span className="text-sm font-medium">Failed to load momentum scan: {error}</span>
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

      {/* Summary stats */}
      {scan && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">Bullish Signals</p>
            <p className="text-2xl font-bold text-emerald-400">{bullCount}</p>
          </Card>
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">Bearish Signals</p>
            <p className="text-2xl font-bold text-red-400">{bearCount}</p>
          </Card>
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">Vol Confirmed</p>
            <p className="text-2xl font-bold text-emerald-400">{scan.volumeSummary?.confirmed || 0}</p>
          </Card>
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">Leading Factor</p>
            <p className="text-sm font-bold text-brand-400">{scan.factorMomentum?.leading || '—'}</p>
          </Card>
        </div>
      )}

      {/* AI Commentary */}
      {scan && !loading && (aiLoading || aiCommentary || aiError) && (
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
              <span>Analyzing momentum data...</span>
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

      {/* Sub-view tabs */}
      {scan && !loading && (
        <div className="flex gap-2 flex-wrap">
          {SUB_VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition border ${activeView === id ? 'bg-brand-500/15 text-brand-400 border-brand-500/30' : 'bg-surface-800/60 text-surface-400 hover:text-white border-transparent'}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      )}

      {/* Active view */}
      {scan && !loading && activeView === 'tsm' && <TimeSeriesView assets={validAssets} />}
      {scan && !loading && activeView === 'cross' && <CrossSectionalView crossSectional={scan.crossSectional} />}
      {scan && !loading && activeView === 'factor' && <FactorRotationView factorMomentum={scan.factorMomentum} />}
      {scan && !loading && activeView === 'volume' && <VolumeAnalysisView assets={validAssets} />}

      {/* 12-Week Trend View */}
      {scan && !error && (
        <WeeklyTrendView symbol="SPY" title="SPY — 12-Week Momentum Trend" color="#8b5cf6" />
      )}

      {/* Footer */}
      {scan && !loading && (
        <p className="text-[11px] text-surface-600 leading-relaxed">
          Source: Yahoo Finance (daily OHLCV, ~13 months) ·
          Time Series Momentum = asset's own trend (MA crossovers, ROC, RSI, Bollinger breakouts) ·
          Cross-Sectional = rank all assets by momentum, buy leaders / sell laggards ·
          Factor Momentum = which factor ETFs are leading now (rotate into winning factors) ·
          Volume Analysis = volume-price confirmation, OBV trend, spike detection (capitulation/absorption) ·
          Educational only — not financial advice. Momentum strategies require strict risk control and stop losses.
        </p>
      )}
    </div>
  );
}
