import React, { useState, useEffect } from 'react';
import { Radar, RefreshCw, AlertTriangle, Info, TrendingDown, Activity } from 'lucide-react';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';
import CrashGauge from './CrashGauge';

function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
}

const LEVEL_BADGE = {
  calm: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  watch: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  elevated: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  severe: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const FACTOR_ICONS = {
  vixLevel: Activity,
  termStructure: TrendingDown,
  spyVs200dma: Radar,
  breadth: TrendingDown,
  momentum: Activity,
  drawdown: TrendingDown,
  cotPositioning: Info,
};

export default function CrashRadarTab() {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/crash/scan${forceRefresh ? '?refresh=1' : ''}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setScan(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const score = scan?.score ?? 0;
  const level = scan?.level ?? 'calm';
  const label = scan?.label ?? 'Calm';
  const color = scan?.color ?? 'emerald';
  const factors = scan?.factors ?? [];
  const badgeClass = LEVEL_BADGE[level] || LEVEL_BADGE.calm;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Radar size={24} className="text-brand-400" />
            <h1 className="text-2xl font-black tracking-tight">Crash Radar</h1>
            {scan && !error && (
              <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${badgeClass}`}>
                <AlertTriangle size={10} /> {label}
              </span>
            )}
          </div>
          <p className="text-sm text-surface-400">
            Composite multi-factor market crash risk indicator
          </p>
        </div>
        {scan && (
          <SectionTimestamp
            fetchedAt={scan.asOf}
            label="Crash Scan"
            loading={loading}
            onRefresh={() => refresh(true)}
          />
        )}
      </div>

      {error && (
        <Card>
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle size={16} />
            <span className="text-sm">{error}</span>
          </div>
          <button
            onClick={() => refresh(true)}
            className="mt-3 px-4 py-2 rounded-lg bg-brand-500/20 text-brand-400 hover:bg-brand-500/30 text-sm font-medium transition"
          >
            Retry
          </button>
        </Card>
      )}

      {loading && !scan && (
        <Card>
          <div className="flex items-center gap-2 text-surface-400">
            <RefreshCw size={16} className="animate-spin" />
            <span className="text-sm">Analyzing market risk factors…</span>
          </div>
        </Card>
      )}

      {scan && !error && (
        <>
          {/* Gauge + Level */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1 flex items-center justify-center">
              <CrashGauge score={score} level={level} label={label} color={color} variant="full" />
            </Card>

            <Card className="lg:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <Info size={16} className="text-brand-400" />
                <h3 className="text-sm font-bold">What This Measures</h3>
              </div>
              <p className="text-xs text-surface-400 leading-relaxed mb-3">
                The Crash Radar blends <strong>7 independent risk factors</strong> into a single
                0–100 composite score. Each factor is normalized, weighted by its historical
                predictive value, and fully transparent — you can see exactly how much each
                contributes to the final score.
              </p>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-surface-500">0–25</span>
                  <span className="text-emerald-400 font-medium">Calm</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-surface-500">26–45</span>
                  <span className="text-blue-400 font-medium">Watch</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-surface-500">46–65</span>
                  <span className="text-yellow-400 font-medium">Elevated</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-surface-500">66–80</span>
                  <span className="text-orange-400 font-medium">High</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-surface-500">81–100</span>
                  <span className="text-red-400 font-medium">Severe</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Factor Breakdown Table */}
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Activity size={16} className="text-brand-400" />
              <h3 className="text-sm font-bold">Factor Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-surface-500 border-b border-surface-800">
                    <th className="text-left py-2 pr-4 font-medium">Factor</th>
                    <th className="text-right py-2 px-2 font-medium">Value</th>
                    <th className="text-right py-2 px-2 font-medium">Score</th>
                    <th className="text-right py-2 px-2 font-medium">Weight</th>
                    <th className="text-right py-2 px-2 font-medium">Contribution</th>
                    <th className="text-left py-2 pl-4 font-medium w-1/3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {factors.map((f) => {
                    const Icon = FACTOR_ICONS[f.key] || Info;
                    const scoreColor = f.score > 60 ? 'text-red-400' : f.score > 40 ? 'text-yellow-400' : f.score > 20 ? 'text-blue-400' : 'text-emerald-400';
                    return (
                      <tr key={f.key} className="border-b border-surface-800/50 hover:bg-surface-800/30">
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <Icon size={12} className="text-surface-500" />
                            <span className="font-medium text-surface-200">{f.label}</span>
                          </div>
                        </td>
                        <td className="text-right py-2.5 px-2 text-surface-400">
                          {f.value != null ? (
                            typeof f.value === 'number' ? f.value.toFixed(1) : String(f.value)
                          ) : '—'}
                        </td>
                        <td className={`text-right py-2.5 px-2 font-bold ${scoreColor}`}>
                          {f.score?.toFixed(0) ?? '—'}
                        </td>
                        <td className="text-right py-2.5 px-2 text-surface-500">
                          {(f.weight * 100).toFixed(0)}%
                        </td>
                        <td className="text-right py-2.5 px-2 text-surface-300 font-medium">
                          {f.contribution?.toFixed(1) ?? '—'}
                        </td>
                        <td className="py-2.5 pl-4 text-surface-500 text-[11px] leading-relaxed">
                          {f.note}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* SPY 12-week trend */}
          <Card>
            <WeeklyTrendView symbol="SPY" title="SPY 12-Week Trend" color="#3b82f6" />
          </Card>

          {/* Disclaimer */}
          <Card className="border-yellow-500/20 bg-yellow-500/5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-yellow-400 mb-1">Educational Disclaimer</h4>
                <p className="text-xs text-surface-400 leading-relaxed">
                  The Crash Radar is a research tool based on historical market data and technical
                  indicators. It is <strong>not a prediction</strong> of future market crashes.
                  No indicator can reliably forecast market panics. Use this as one input among
                  many in your risk management process. Past patterns do not guarantee future outcomes.
                </p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
