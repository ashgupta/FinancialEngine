import React, { useState, useEffect, useMemo } from 'react';
import {
  Target, RefreshCw, AlertTriangle, TrendingUp, TrendingDown,
  Info, Layers, Clock, ChevronRight, BadgeCheck, ShieldAlert,
} from 'lucide-react';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';
import { useWatchlist } from '../contexts/WatchlistContext.jsx';
import { usePortfolio } from '../contexts/PortfolioContext.jsx';

function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
}

const DIRECTION_STYLES = {
  bullish: { icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  bearish: { icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  neutral: { icon: Info, color: 'text-surface-400', bg: 'bg-surface-700/30', border: 'border-surface-700/50' },
};

const BAND_STYLES = {
  short: { color: 'text-blue-400', border: 'border-blue-500/30', bg: 'bg-blue-500/5' },
  medium: { color: 'text-purple-400', border: 'border-purple-500/30', bg: 'bg-purple-500/5' },
  leaps: { color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/5' },
};

function fmtPrice(v) {
  if (v == null || isNaN(v)) return '—';
  return `$${v.toFixed(2)}`;
}

function fmtMoney(v) {
  if (v == null || isNaN(v)) return '—';
  if (v === Infinity) return '∞';
  return `$${v.toFixed(0)}`;
}

/** Signed net cost: debits as "$X", credits as "+$X cr". */
function fmtNetCost(v) {
  if (v == null || isNaN(v)) return '—';
  return v < 0 ? `+$${Math.abs(v).toFixed(0)} cr` : `$${v.toFixed(0)}`;
}

const REGIME_STYLES = {
  calm: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
  watch: 'border-blue-500/30 bg-blue-500/5 text-blue-300',
  elevated: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-300',
  high: 'border-orange-500/30 bg-orange-500/5 text-orange-300',
  severe: 'border-red-500/30 bg-red-500/5 text-red-300',
};

function fmtPct(v) {
  if (v == null || isNaN(v)) return '—';
  return `${(v * 100).toFixed(0)}%`;
}

function fmtDTE(v) {
  if (v == null || isNaN(v)) return '—';
  return `${v}d`;
}

// ─── Recommendation Card ─────────────────────────────────

function RecCard({ rec, rank }) {
  const dir = DIRECTION_STYLES[rec.direction] || DIRECTION_STYLES.neutral;
  const DirIcon = dir.icon;
  const isHeld = rec.isHeld;
  const drawdownFlag = rec.drawdownFlag;

  return (
    <div className={`rounded-xl border p-4 ${dir.border} ${dir.bg} hover:border-surface-600 transition`}>
      {/* Header row */}
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-surface-800 text-xs font-bold text-surface-300">
            {rank}
          </span>
          <span className="font-bold text-sm text-surface-100">{rec.symbol}</span>
          {isHeld && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-brand-500/15 text-brand-400 border border-brand-500/30">
              <BadgeCheck size={9} /> Held
            </span>
          )}
          <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${dir.bg} ${dir.color} ${dir.border} border`}>
            <DirIcon size={9} /> {rec.direction}
          </span>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium text-surface-300">{rec.strategy}</div>
          <div className="text-[10px] text-surface-500">{fmtDTE(rec.dte)} to expiry</div>
        </div>
      </div>

      {/* Legs */}
      <div className="mb-3 space-y-1">
        {rec.legs.map((leg, i) => (
          <div key={i} className="flex items-center justify-between text-[11px] text-surface-400">
            <span>
              <span className={leg.action === 'BUY' ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
                {leg.action}
              </span>
              {' '}{leg.type} ${leg.strike}
            </span>
            <span className="text-surface-500">{fmtPrice(leg.price)}</span>
          </div>
        ))}
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 text-[11px]">
        <div>
          <div className="text-surface-500">{rec.netCost < 0 ? 'Credit (mid)' : 'Cost (mid)'}</div>
          <div className="text-surface-200 font-medium">{fmtNetCost(rec.netCost)}</div>
          {rec.naturalCost != null && (
            <div className="text-[10px] text-surface-500" title="Executable price: buy at the ask, sell at the bid">
              natural {fmtNetCost(rec.naturalCost)}
            </div>
          )}
        </div>
        <div>
          <div className="text-surface-500">Max Profit</div>
          <div className="text-emerald-400 font-medium">{fmtMoney(rec.maxProfit)}</div>
        </div>
        <div>
          <div className="text-surface-500">Max Loss</div>
          <div className={`font-medium ${drawdownFlag ? 'text-red-400' : 'text-surface-200'}`}>
            {fmtMoney(rec.maxLoss)}
            {drawdownFlag && <ShieldAlert size={10} className="inline ml-1" />}
          </div>
        </div>
        <div>
          <div className="text-surface-500">PoP</div>
          <div className="text-surface-200 font-medium">{fmtPct(rec.probabilityOfProfit)}</div>
        </div>
        <div>
          <div className="text-surface-500">RoC</div>
          <div className={`font-medium ${rec.returnOnCapital >= 3 ? 'text-emerald-400' : 'text-surface-200'}`}>
            {rec.returnOnCapital != null ? `${rec.returnOnCapital.toFixed(rec.returnOnCapital < 1 ? 2 : 1)}×` : '—'}
          </div>
        </div>
      </div>

      {rec.regimeNote && (
        <div className="mb-3 flex items-center gap-1.5 text-[10px] text-yellow-300">
          <AlertTriangle size={10} />
          <span>{rec.regimeNote}</span>
        </div>
      )}

      {/* Why this pick */}
      <div className="rounded-lg bg-surface-900/50 border border-surface-800 p-3 space-y-1.5">
        <div className="text-[10px] font-bold text-surface-500 uppercase tracking-wider mb-1">Why This Pick</div>
        <div className="text-[11px] text-surface-400 leading-relaxed">
          <span className="text-surface-500">Signal: </span>{rec.why.signalSummary}
        </div>
        <div className="text-[11px] text-surface-400 leading-relaxed">
          <span className="text-surface-500">Strike: </span>{rec.why.strikeReason}
        </div>
        <div className="text-[11px] text-surface-400 leading-relaxed">
          <span className="text-surface-500">Horizon: </span>{rec.why.horizonReason}
        </div>
        <div className="text-[11px] text-surface-400 leading-relaxed">
          <span className="text-surface-500">Risk: </span>{rec.why.riskNote}
        </div>
      </div>

      {/* Drawdown flag */}
      {drawdownFlag && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-400">
          <ShieldAlert size={10} />
          <span>Max loss exceeds {rec.lossPctOfAllocation?.toFixed(0)}% of trade allocation (Principle VII guard)</span>
        </div>
      )}
    </div>
  );
}

// ─── Band Section ────────────────────────────────────────

function BandSection({ bandData }) {
  const style = BAND_STYLES[bandData.band] || BAND_STYLES.short;
  const recs = bandData.recommendations || [];

  return (
    <div className={`rounded-2xl border ${style.border} ${style.bg} p-5`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock size={16} className={style.color} />
          <h3 className={`text-sm font-bold ${style.color}`}>{bandData.label}</h3>
          <span className="text-[10px] text-surface-500">{bandData.description}</span>
        </div>
        <span className="text-xs text-surface-500">{recs.length}/5 picks</span>
      </div>

      {recs.length === 0 ? (
        <div className="text-center py-8 text-surface-500 text-xs">
          No setups cleared the quality gates in this band (debit: RoC ≥ 3× &amp; PoP ≥ 30%; credit: OTM, ≥ 20% of width &amp; PoP ≥ 55%; tradeable quotes).
          <div className="mt-1 text-[10px] text-surface-600">
            We don&apos;t pad with low-quality trades — check back as conditions shift.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {recs.map((rec, i) => (
            <RecCard key={`${rec.symbol}-${i}`} rec={rec} rank={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

export default function OptionsOpportunitiesTab() {
  const { watchlist } = useWatchlist();
  const { underlyings, heldSet } = usePortfolio();
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Build universe from watchlist + portfolio
  const universeSymbols = useMemo(() => {
    const symbols = new Set();
    for (const w of watchlist) symbols.add(w.symbol);
    for (const u of underlyings) symbols.add(u.symbol);
    return [...symbols];
  }, [watchlist, underlyings]);

  const refresh = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/options/opportunities${forceRefresh ? '?refresh=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: universeSymbols,
          heldSymbols: [...heldSet],
          allocationPerTrade: 10000,
        }),
      });
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

  useEffect(() => { refresh(); }, [universeSymbols.join(',')]);

  const bands = scan?.bands || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Target size={24} className="text-brand-400" />
            <h1 className="text-2xl font-black tracking-tight">Options Opportunities</h1>
          </div>
          <p className="text-sm text-surface-400">
            Defined-risk spreads only — debit spreads clear RoC ≥ 3× &amp; PoP ≥ 30%; credit spreads must be out-of-the-money with ≥ 20% credit &amp; PoP ≥ 55%
          </p>
        </div>
        {scan && (
          <SectionTimestamp
            fetchedAt={scan.asOf}
            label="Opportunities"
            loading={loading}
            onRefresh={() => refresh(true)}
          />
        )}
      </div>

      {/* Universe summary */}
      <Card>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-brand-400" />
            <span className="text-surface-400">Scanning:</span>
            <span className="font-medium text-surface-200">
              {universeSymbols.length} from portfolio + watchlist
            </span>
          </div>
          <span className="text-surface-600">+</span>
          <span className="text-surface-400">curated liquid names (mega-caps, ETFs)</span>
          {scan?.universeSize && (
            <span className="text-surface-500">→ {scan.universeSize} total</span>
          )}
        </div>
      </Card>

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
            <span className="text-sm">Scanning universe for opportunities…</span>
          </div>
        </Card>
      )}

      {scan && !error && (
        <>
          {/* Crash regime overlay */}
          {scan.regime && (
            <div className={`rounded-xl border px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center gap-2 justify-between ${REGIME_STYLES[scan.regime.level] || REGIME_STYLES.calm}`}>
              <div className="flex items-start gap-2">
                <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                <span>{scan.regime.note}</span>
              </div>
              <a href="#thesis" className="flex items-center gap-1 font-medium underline-offset-2 hover:underline shrink-0">
                Crash Thesis hedges <ChevronRight size={12} />
              </a>
            </div>
          )}

          {/* Three band sections */}
          {bands.map((band) => (
            <BandSection key={band.band} bandData={band} />
          ))}

          {/* SPY trend */}
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
                  These recommendations are generated by a quantitative engine based on momentum,
                  volume, and 200-DMA signals. They are <strong>not financial advice</strong>.
                  Options involve significant risk and may result in total loss of premium.
                  Always conduct your own due diligence, understand the mechanics of each strategy,
                  and consult a licensed financial advisor before trading.
                </p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
