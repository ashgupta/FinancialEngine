import React, { useState, useEffect } from 'react';
import {
  RefreshCw, Clock, Activity, Gauge, TrendingUp, TrendingDown,
  AlertTriangle, Zap, BarChart3, Flame,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
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

// Regime badge colors (Tailwind classes keyed by regime color name)
const REGIME_BADGE = {
  emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  blue:    'bg-blue-500/15 text-blue-400 border-blue-500/30',
  yellow:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  orange:  'bg-orange-500/15 text-orange-400 border-orange-500/30',
  red:     'bg-red-500/15 text-red-400 border-red-500/30',
};

const SIGNAL_STYLES = {
  'sell vol':  { icon: TrendingDown, color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     label: 'Sell Vol' },
  'buy vol':   { icon: TrendingUp,   color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Buy Vol' },
  'neutral':   { icon: Gauge,        color: 'text-surface-400', bg: 'bg-surface-700/30', border: 'border-surface-700/50', label: 'Neutral' },
};

function fmt(v, digits = 2) {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(digits);
}

function fmtPct(v, withSign = true) {
  if (v == null || isNaN(v)) return '—';
  const s = withSign && v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)}`;
}

// ─── Vol Risk Premium Gauge ─────────────────────────────
function PremiumGauge({ vix, realized, premium }) {
  // Gauge ranges from -20 to +20; clamp premium into that band
  const min = -20, max = 20;
  const clamped = Math.max(min, Math.min(max, premium ?? 0));
  const pct = ((clamped - min) / (max - min)) * 100; // 0..100
  const isSell = (premium ?? 0) > 5;
  const isBuy = (premium ?? 0) < -5;
  const barColor = isSell ? 'bg-red-400' : isBuy ? 'bg-emerald-400' : 'bg-brand-400';

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <Gauge size={16} className="text-brand-400" />
        <h3 className="text-sm font-bold">Vol Risk Premium</h3>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <div className="text-center">
            <p className="text-surface-500 mb-0.5">VIX (Implied)</p>
            <p className="text-lg font-bold text-brand-400">{fmt(vix)}</p>
          </div>
          <div className="text-center px-3">
            <p className="text-surface-500 mb-0.5">Premium</p>
            <p className={`text-lg font-bold ${isSell ? 'text-red-400' : isBuy ? 'text-emerald-400' : 'text-surface-300'}`}>
              {fmtPct(premium)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-surface-500 mb-0.5">SPY (Realized)</p>
            <p className="text-lg font-bold text-surface-200">{fmt(realized, 1)}</p>
          </div>
        </div>

        {/* Gauge bar */}
        <div className="relative h-3 rounded-full bg-surface-800 overflow-hidden">
          {/* center mark */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-surface-600 z-10" />
          {/* buy zone */}
          <div className="absolute top-0 bottom-0 left-0 w-1/4 bg-emerald-500/10" />
          {/* sell zone */}
          <div className="absolute top-0 bottom-0 right-0 w-1/4 bg-red-500/10" />
          {/* fill */}
          <div
            className={`absolute top-0 bottom-0 ${barColor} transition-all`}
            style={{
              left: premium != null && premium < 0 ? `${pct}%` : '50%',
              right: premium != null && premium >= 0 ? `${100 - pct}%` : '50%',
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-surface-600">
          <span className="text-emerald-500/70">Buy vol (&lt;-5)</span>
          <span>Fair value</span>
          <span className="text-red-500/70">Sell vol (&gt;+5)</span>
        </div>
      </div>
    </Card>
  );
}

// ─── Term Structure Card ────────────────────────────────
function TermStructureCard({ ts }) {
  if (!ts || ts.label === 'Unavailable') {
    return (
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={16} className="text-brand-400" />
          <h3 className="text-sm font-bold">VIX Term Structure</h3>
        </div>
        <p className="text-xs text-surface-500">VIX curve data unavailable.</p>
      </Card>
    );
  }

  const isContango = ts.contango;
  const isBackwardation = ts.backwardation;
  const accent = isBackwardation ? 'text-red-400' : isContango ? 'text-emerald-400' : 'text-surface-400';
  const isIndexCurve = ts.source === 'cboe-index';
  const points = isIndexCurve
    ? [
        { label: 'VIX9D', value: ts.vix9d, cls: 'text-surface-300' },
        { label: 'VIX (30d)', value: ts.vix, cls: 'text-surface-200' },
        { label: 'VIX3M', value: ts.vix3m, cls: accent },
        { label: 'VIX6M', value: ts.vix6m, cls: 'text-surface-300' },
      ]
    : [
        { label: 'VIX (Spot)', value: ts.vix, cls: 'text-surface-200' },
        { label: 'VX1 (Front)', value: ts.vx1, cls: accent },
        { label: 'VX2 (2nd)', value: ts.vx2, cls: 'text-surface-300' },
      ];

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 size={16} className="text-brand-400" />
        <h3 className="text-sm font-bold">VIX Term Structure</h3>
        {isIndexCurve && <span className="text-[10px] text-surface-500">CBOE constant-maturity indices</span>}
      </div>

      <div className="flex items-end justify-between gap-2 mb-4">
        {points.map((pt) => (
          <div key={pt.label} className="text-center flex-1">
            <p className="text-[10px] text-surface-500 mb-1">{pt.label}</p>
            <p className={`text-xl font-bold ${pt.cls}`}>{fmt(pt.value)}</p>
          </div>
        ))}
      </div>

      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${isBackwardation ? 'bg-red-500/10' : isContango ? 'bg-emerald-500/10' : 'bg-surface-800/40'}`}>
        {isBackwardation ? <AlertTriangle size={14} className="text-red-400" /> : isContango ? <TrendingUp size={14} className="text-emerald-400" /> : <Gauge size={14} className="text-surface-400" />}
        <span className={`text-xs font-medium ${accent}`}>{ts.label}</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between">
          <span className="text-surface-500">{isIndexCurve ? 'Spread (VIX3M−VIX)' : 'Spread (VX1−VIX)'}</span>
          <span className={accent}>{fmtPct(ts.spread)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-surface-500">{isIndexCurve ? 'VIX / VIX3M' : 'Slope'}</span>
          <span className="text-surface-300">
            {isIndexCurve
              ? fmt(ts.ratio, 2)
              : ts.slope != null ? fmt(ts.slope * 100, 1) + '%' : '—'}
          </span>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-surface-600 leading-relaxed">
        {isBackwardation
          ? `Backwardation: the ${isIndexCurve ? '3-month VIX trades below spot VIX (ratio > 1)' : 'front-month future trades below spot VIX'}. Hedging demand is elevated — often a stress or capitulation signal.`
          : isContango
            ? `Contango: the ${isIndexCurve ? '3-month VIX is above spot VIX (ratio < 1)' : 'front-month future is above spot VIX'}. Normal state — the market expects vol to drift higher over time; long-dated vega costs more than spot VIX suggests.`
            : 'Flat: the curve is roughly in line with spot VIX.'}
      </p>
    </Card>
  );
}

// ─── Signal Card ────────────────────────────────────────
function SignalCard({ signal }) {
  const style = SIGNAL_STYLES[signal] || SIGNAL_STYLES['neutral'];
  const Icon = style.icon;
  return (
    <Card className={`${style.bg} ${style.border} border`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={style.color} />
        <h3 className="text-sm font-bold text-surface-200">Vol Signal</h3>
      </div>
      <p className={`text-2xl font-black ${style.color}`}>{style.label}</p>
      <p className="mt-1 text-[11px] text-surface-500 leading-relaxed">
        {signal === 'sell vol'
          ? 'Implied vol is rich vs realized — options are expensive. Favor selling premium / short-vol strategies.'
          : signal === 'buy vol'
            ? 'Implied vol is cheap vs realized — options are underpriced. Favor buying premium / long-vol or tail hedges.'
            : 'Implied and realized vol are near fair value. No strong edge in buying or selling premium.'}
      </p>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────
export default function VolatilityTab() {
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/volatility/scan${forceRefresh ? '?refresh=1' : ''}`);
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

  const vix = scan?.vixLevel ?? null;
  const regime = scan?.volRegime ?? 'normal';
  const regimeColor = scan?.regimeColor ?? 'blue';
  const badgeClass = REGIME_BADGE[regimeColor] || REGIME_BADGE.blue;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Activity size={24} className="text-brand-400" />
            <h1 className="text-2xl font-black tracking-tight">Volatility Dashboard</h1>
            {scan && !error && (
              <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${badgeClass}`}>
                <Flame size={10} /> {regime}
              </span>
            )}
            {scan?.stale && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-400 text-xs font-medium">
                <AlertTriangle size={10} /> Stale
              </span>
            )}
          </div>
          <p className="text-surface-400 text-sm">
            VIX, realized vol, vol risk premium, and the futures term structure
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
        <SectionTimestamp fetchedAt={scan?.fetchedAt} label="Volatility Scan" loading={loading} onRefresh={() => refresh(true)} />
      )}

      {/* Error */}
      {error && (
        <Card className="border-red-500/30">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle size={16} />
            <span className="text-sm font-medium">Failed to load volatility scan: {error}</span>
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

      {/* VIX level + regime */}
      {scan && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">VIX Level</p>
            <p className="text-3xl font-black text-brand-400">{fmt(vix)}</p>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium border ${badgeClass}`}>
              {regime}
            </span>
          </Card>
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">SPY Realized Vol</p>
            <p className="text-3xl font-black text-surface-200">{fmt(scan.realizedVolSPY, 1)}<span className="text-base text-surface-500">%</span></p>
            <p className="text-[10px] text-surface-600 mt-1">20-day annualized</p>
          </Card>
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">Vol Risk Premium</p>
            <p className={`text-3xl font-black ${(scan.volRiskPremium ?? 0) > 5 ? 'text-red-400' : (scan.volRiskPremium ?? 0) < -5 ? 'text-emerald-400' : 'text-surface-300'}`}>
              {fmtPct(scan.volRiskPremium)}
            </p>
            <p className="text-[10px] text-surface-600 mt-1">VIX − Realized</p>
          </Card>
          <Card className="text-center">
            <p className="text-xs text-surface-500 mb-1">Vol of Vol</p>
            <p className="text-3xl font-black text-surface-200">{fmt(scan.volOfVol, 1)}<span className="text-base text-surface-500">%</span></p>
            <p className="text-[10px] text-surface-600 mt-1">VIX realized vol</p>
          </Card>
        </div>
      )}

      {/* Signal + Premium gauge + Term structure */}
      {scan && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SignalCard signal={scan.signal} />
          <PremiumGauge vix={vix} realized={scan.realizedVolSPY} premium={scan.volRiskPremium} />
          <TermStructureCard ts={scan.termStructure} />
        </div>
      )}

      {/* 6-month VIX chart */}
      {scan && !loading && scan.chart?.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={16} className="text-brand-400" />
            <h3 className="text-sm font-bold">VIX — 6 Month Chart</h3>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={scan.chart} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
                minTickGap={30}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#60a5fa' }}
              />
              <ReferenceLine y={20} stroke="#facc15" strokeDasharray="4 4" strokeOpacity={0.4} />
              <ReferenceLine y={30} stroke="#fb923c" strokeDasharray="4 4" strokeOpacity={0.4} />
              <Line
                type="monotone"
                dataKey="vix"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
                name="VIX"
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-surface-600">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-brand-400" /> VIX</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-yellow-400/60" /> 20 (elevated)</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-orange-400/60" /> 30 (high)</span>
          </div>
        </Card>
      )}

      {/* Description */}
      {scan && !loading && scan.description && (
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <Zap size={16} className="text-brand-400" />
            <h3 className="text-sm font-bold">Summary</h3>
          </div>
          <p className="text-sm text-surface-300 leading-relaxed">{scan.description}</p>
        </Card>
      )}

      {/* 12-Week Trend View */}
      {scan && !error && (
        <WeeklyTrendView symbol="^VIX" title="VIX — 12-Week Volatility Trend" color="#ef4444" />
      )}

      {/* Footer */}
      {scan && !loading && (
        <p className="text-[11px] text-surface-600 leading-relaxed">
          Source: Yahoo Finance (^VIX, ^VIX9D, ^VIX3M, ^VIX6M, SPY daily closes, ~6 months) ·
          Realized vol = std of daily log returns × √252 × 100 ·
          Vol risk premium = VIX − SPY realized vol (high → options expensive, sell vol; low → cheap, buy vol) ·
          Term structure: contango (VIX3M &gt; VIX) = normal; backwardation (VIX3M &lt; VIX) = stress ·
          Educational only — not financial advice. Volatility trading involves significant risk.
        </p>
      )}
    </div>
  );
}
