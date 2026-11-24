import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search, RefreshCw, TrendingUp, TrendingDown, Target,
  Layers, Award, AlertTriangle, Info, Zap,
} from 'lucide-react';
import { fetchOptionsChain, OPTIONABLE_SYMBOLS } from '../engine/marketData.js';
import { analyzeSpreads, isLeaps, formatDTE, expiryCategory } from '../engine/spreadAnalyzer.js';
import { buildImpliedDistribution, distributionSummary, distributionCurve } from '../engine/impliedDistribution.js';
import ImpliedDistributionPanel from './ImpliedDistributionPanel';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

const EXPIRY_BUCKETS = [
  { id: 'weekly',    label: 'Weekly',    color: 'text-gray-300' },
  { id: 'monthly',   label: 'Monthly',   color: 'text-blue-300' },
  { id: 'quarterly', label: 'Quarterly', color: 'text-purple-300' },
  { id: 'leaps',     label: 'LEAPS',     color: 'text-amber-300' },
];

// ─── Constants ──────────────────────────────────────────────
const SPREAD_TYPES = [
  { id: 'bull_call', label: 'Bull Call',  flow: 'debit',  direction: 'bullish', desc: 'Buy lower, sell higher call. Pay debit. Bullish.' },
  { id: 'bear_put',  label: 'Bear Put',   flow: 'debit',  direction: 'bearish', desc: 'Buy higher, sell lower put. Pay debit. Bearish.' },
  { id: 'bull_put',  label: 'Bull Put',   flow: 'credit', direction: 'bullish', desc: 'Sell higher, buy lower put. Receive credit. Bullish.' },
  { id: 'bear_call', label: 'Bear Call',  flow: 'credit', direction: 'bearish', desc: 'Sell lower, buy higher call. Receive credit. Bearish.' },
];

const SORT_OPTIONS = [
  { id: 'composite', label: 'Composite Score',    desc: 'Blends EV, R/R, and liquidity' },
  { id: 'ev',        label: 'Expected Value',     desc: 'Payoff integrated over the options-implied distribution (≈0 = fairly priced)' },
  { id: 'rr',        label: 'Risk/Reward',        desc: 'maxProfit / maxLoss' },
  { id: 'pop',       label: 'Probability of Profit', desc: 'PoP at expiry under the options-implied distribution' },
  { id: 'cost',      label: 'Lowest Cost',        desc: 'Cheapest debit (or richest credit)' },
];

// ─── Format helpers ─────────────────────────────────────────
const fmtUsd = (v, digits = 0) =>
  v == null || !Number.isFinite(v) ? '—' :
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(v);
const fmtPct = (v, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`;
const fmtNum = (v, digits = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

// ─── Small UI primitives ────────────────────────────────────
function Card({ children, className = '' }) {
  return (
    <div className={`bg-gray-800/60 border border-gray-700 rounded-lg p-4 ${className}`}>
      {children}
    </div>
  );
}

function StatCard({ label, value, sublabel, color = 'text-gray-100' }) {
  return (
    <div className="bg-gray-800/40 border border-gray-700 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sublabel && <div className="text-xs text-gray-500 mt-0.5">{sublabel}</div>}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────
export default function SpreadFinderTab() {
  const [symbol, setSymbol] = useState('SPY');
  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [spreadType, setSpreadType] = useState('bull_call');
  const [maxRisk, setMaxRisk] = useState(500);
  const [maxWidth, setMaxWidth] = useState(20);
  const [minLiquidity, setMinLiquidity] = useState(10);
  const [sortBy, setSortBy] = useState('composite');
  const [dividendYield, setDividendYield] = useState(0);
  const [tradeableOnly, setTradeableOnly] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  // ── Load chain on symbol/expiry change ──────────────────
  const loadChain = useCallback(async (sym, exp, forceRefresh = false) => {
    setLoading(true);
    try {
      const data = await fetchOptionsChain(sym, exp, forceRefresh);
      setChain(data);
      setLastRefresh(new Date());
      if (!exp && data.expirations?.length > 0) {
        setSelectedExpiry(data.expirations[0]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChain(symbol, null);
  }, [symbol, loadChain]);

  useEffect(() => {
    if (selectedExpiry && chain && chain.expirationDate !== selectedExpiry) {
      loadChain(symbol, selectedExpiry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExpiry]);

  // ── Days to expiry ──────────────────────────────────────
  const daysToExpiry = useMemo(() => {
    if (!selectedExpiry) return 30;
    return Math.max(1, Math.ceil((selectedExpiry * 1000 - Date.now()) / 86_400_000));
  }, [selectedExpiry]);

  // ── Options-implied distribution for this expiry (Breeden–Litzenberger) ──
  const distribution = useMemo(() => {
    if (!chain?.underlyingPrice) return null;
    return buildImpliedDistribution({
      calls: chain.calls || [], puts: chain.puts || [], spot: chain.underlyingPrice,
      daysToExpiry, dividendYield: dividendYield / 100,
    });
  }, [chain, daysToExpiry, dividendYield]);
  const distSummary = useMemo(() => distributionSummary(distribution), [distribution]);
  const distCurve = useMemo(() => distributionCurve(distribution, 80), [distribution]);

  // ── Run the analyzer ────────────────────────────────────
  const candidates = useMemo(() => {
    if (!chain || !chain.underlyingPrice) return [];
    return analyzeSpreads({
      calls: chain.calls || [],
      puts: chain.puts || [],
      underlyingPrice: chain.underlyingPrice,
      daysToExpiry,
      spreadType,
      maxRiskPerContract: maxRisk,
      maxWidth,
      minLiquidity,
      dividendYield: dividendYield / 100,   // user enters 2.5 → 0.025
      distribution,
      // Quote-quality gate: drop stale/one-sided legs and spreads whose leg
      // bid/ask widths swamp the strike width (phantom mid-price spreads).
      ...(tradeableOnly ? { requireTwoSidedQuotes: true, maxLegSpreadToWidth: 0.35 } : {}),
    });
  }, [chain, daysToExpiry, spreadType, maxRisk, maxWidth, minLiquidity, dividendYield, tradeableOnly, distribution]);

  // ── Re-sort by user choice ──────────────────────────────
  const sortedCandidates = useMemo(() => {
    const sorted = [...candidates];
    const cmp = {
      composite: (a, b) => b.compositeScore - a.compositeScore,
      ev:        (a, b) => (b.expectedValue ?? -Infinity) - (a.expectedValue ?? -Infinity),
      rr:        (a, b) => b.riskReward - a.riskReward,
      pop:       (a, b) => (b.probabilityOfProfit ?? 0) - (a.probabilityOfProfit ?? 0),
      cost:      (a, b) => a.netCost - b.netCost,                     // lowest debit first
    }[sortBy];
    sorted.sort(cmp);
    return sorted;
  }, [candidates, sortBy]);

  const topPick = sortedCandidates[0] || null;
  const def = SPREAD_TYPES.find(s => s.id === spreadType);

  // ── Filter symbol search ────────────────────────────────
  const filteredSymbols = useMemo(() => {
    if (!searchQuery) return OPTIONABLE_SYMBOLS;
    const q = searchQuery.toLowerCase();
    return OPTIONABLE_SYMBOLS.filter(s =>
      s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Show ALL expirations (not just first 12) so users can reach LEAPS
  // out to 2-3 years. Group by category for navigation.
  const expiryGroups = useMemo(() => {
    if (!chain?.expirations?.length) return [];
    const all = chain.expirations.map(ts => {
      const dte = Math.ceil((ts * 1000 - Date.now()) / 86_400_000);
      return {
        ts,
        label: new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
        dte,
        dteLabel: formatDTE(dte),
        category: expiryCategory(dte),
        isLeaps: isLeaps(dte),
      };
    });
    // Group preserving order; only keep buckets that actually have expiries
    return EXPIRY_BUCKETS
      .map(b => ({ ...b, items: all.filter(e => e.category === b.id) }))
      .filter(b => b.items.length > 0);
  }, [chain?.expirations]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Target size={22} className="text-cyan-400" />
            <h1 className="text-2xl font-bold tracking-tight">Spread Finder</h1>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Live options chain → ranked vertical spreads by risk/reward, probability of profit, and expected value
          </p>
        </div>
        <button
          onClick={() => loadChain(symbol, selectedExpiry, true)}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-gray-200"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Section timestamp */}
      {chain && (
        <SectionTimestamp fetchedAt={lastRefresh} label="Spread Finder" loading={loading} onRefresh={() => loadChain(symbol, selectedExpiry, true)} />
      )}

      {/* Symbol picker + chain header */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Symbol list */}
        <Card className="lg:col-span-1 p-0 overflow-hidden">
          <div className="p-2 border-b border-gray-700">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>
          <div className="overflow-y-auto max-h-72 divide-y divide-gray-800/50">
            {filteredSymbols.map(s => (
              <button
                key={s.symbol}
                onClick={() => { setSymbol(s.symbol); setSelectedExpiry(null); }}
                className={`w-full text-left px-3 py-2 flex items-center justify-between text-xs transition ${
                  symbol === s.symbol ? 'bg-cyan-500/10 text-cyan-300' : 'hover:bg-gray-700/40 text-gray-300'
                }`}
              >
                <span className="font-semibold">{s.symbol}</span>
                <span className="text-gray-500 truncate ml-2 max-w-[100px]">{s.name}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Underlying summary */}
        <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Underlying"
            value={chain?.underlyingName || symbol}
            sublabel={symbol}
          />
          <StatCard
            label="Spot Price"
            value={chain?.underlyingPrice ? `$${chain.underlyingPrice.toFixed(2)}` : '—'}
          />
          <StatCard
            label="Days to Expiry"
            value={formatDTE(daysToExpiry)}
            sublabel={selectedExpiry ? new Date(selectedExpiry * 1000).toLocaleDateString() : '—'}
            color={isLeaps(daysToExpiry) ? 'text-amber-300' : 'text-gray-100'}
          />
          <StatCard
            label="Candidates"
            value={candidates.length}
            sublabel={`${chain?.calls?.length || 0}c / ${chain?.puts?.length || 0}p in chain`}
          />
        </div>
      </div>

      {/* Expiry picker — grouped by category, all expiries shown */}
      {expiryGroups.length > 0 && (
        <div className="space-y-2">
          {expiryGroups.map(group => (
            <div key={group.id} className="flex items-center gap-3">
              <div className={`text-[10px] uppercase tracking-wider font-semibold w-20 flex-shrink-0 ${group.color}`}>
                {group.label}
                <span className="text-gray-600 ml-1">{group.items.length}</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1">
                {group.items.map(exp => (
                  <button
                    key={exp.ts}
                    onClick={() => setSelectedExpiry(exp.ts)}
                    className={`shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium transition border ${
                      selectedExpiry === exp.ts
                        ? (exp.isLeaps
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                            : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40')
                        : 'bg-gray-800 text-gray-400 hover:text-white border-transparent'
                    }`}
                  >
                    <span>{exp.label}</span>
                    <span className="text-gray-500 ml-1.5">{exp.dteLabel}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Strategy + filter controls */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Spread type */}
          <div>
            <label className="block text-xs uppercase tracking-wider text-gray-500 mb-2">Spread Type</label>
            <div className="grid grid-cols-2 gap-2">
              {SPREAD_TYPES.map(s => {
                const active = spreadType === s.id;
                const isBull = s.direction === 'bullish';
                return (
                  <button
                    key={s.id}
                    onClick={() => setSpreadType(s.id)}
                    title={s.desc}
                    className={`px-2.5 py-2 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 ${
                      active
                        ? (isBull ? 'bg-green-500/15 text-green-300 border-green-500/40'
                                  : 'bg-red-500/15 text-red-300 border-red-500/40')
                        : 'bg-gray-900 text-gray-400 border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    {isBull ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    <span className="text-left">
                      <div>{s.label}</div>
                      <div className="text-[10px] text-gray-500 font-normal">{s.flow}</div>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Filters */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                Max Risk per Contract: <span className="text-gray-200">{fmtUsd(maxRisk)}</span>
                {isLeaps(daysToExpiry) && maxRisk < 2000 && (
                  <span className="ml-2 text-amber-400/80 text-[10px]">⚠ tight for LEAPS</span>
                )}
              </label>
              <input
                type="range" min={50} max={50000} step={50}
                value={maxRisk}
                onChange={(e) => setMaxRisk(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <div className="text-[10px] text-gray-500 mt-0.5">
                Slide right for LEAPS (long-dated options often cost $5K–$50K per contract)
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                Max Strike Width: <span className="text-gray-200">${maxWidth}</span>
              </label>
              <input
                type="range" min={1} max={100} step={1}
                value={maxWidth}
                onChange={(e) => setMaxWidth(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                Dividend Yield: <span className="text-gray-200">{dividendYield.toFixed(1)}%</span>
                {isLeaps(daysToExpiry) && (
                  <span className="ml-2 text-amber-400/80 text-[10px]">important for LEAPS</span>
                )}
              </label>
              <input
                type="range" min={0} max={10} step={0.1}
                value={dividendYield}
                onChange={(e) => setDividendYield(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <div className="text-[10px] text-gray-500 mt-0.5">
                Annual yield drags the risk-neutral forward price (mu = r − q). Matters for T ≥ 1y.
              </div>
            </div>
          </div>

          {/* Sort + liquidity */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">Rank by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                title={SORT_OPTIONS.find(s => s.id === sortBy)?.desc}
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                Min Liquidity per Leg: <span className="text-gray-200">{minLiquidity}</span>
              </label>
              <input
                type="range" min={0} max={1000} step={10}
                value={minLiquidity}
                onChange={(e) => setMinLiquidity(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
              <div className="text-[10px] text-gray-500 mt-0.5">volume + open interest, per leg</div>
              <label className="mt-3 flex items-start gap-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tradeableOnly}
                  onChange={(e) => setTradeableOnly(e.target.checked)}
                  className="mt-0.5 accent-cyan-500"
                />
                <span>
                  Tradeable quotes only
                  <span className="block text-[10px] text-gray-500">live bid &amp; ask on both legs; combined leg bid/ask ≤ 35% of strike width</span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </Card>

      {/* Top pick spotlight */}
      {topPick && (
        <Card className={`border-cyan-500/40 bg-gradient-to-br ${topPick.isLeaps ? 'from-amber-500/5' : 'from-cyan-500/5'} to-transparent`}>
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-cyan-400">
                <Award size={12} /> Top Pick · {SORT_OPTIONS.find(s => s.id === sortBy)?.label}
                {topPick.isLeaps && (
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-bold tracking-wider">
                    LEAPS
                  </span>
                )}
              </div>
              <div className="mt-1 text-lg font-semibold text-gray-100">
                {def?.label}: ${topPick.longLeg.strike.toFixed(0)} / ${topPick.shortLeg.strike.toFixed(0)}
              </div>
              <div className="text-xs text-gray-500">
                width ${topPick.width.toFixed(2)} · DTE {formatDTE(daysToExpiry)} ·
                composite score {topPick.compositeScore.toFixed(1)}/100
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-medium ${
              def?.flow === 'debit' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'
            }`}>
              {def?.flow === 'debit' ? 'Debit' : 'Credit'} {fmtUsd(Math.abs(topPick.netCostContract), 2)}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard
              label="Max Profit"
              value={fmtUsd(topPick.maxProfit)}
              color="text-green-300"
            />
            <StatCard
              label="Max Loss"
              value={fmtUsd(topPick.maxLoss)}
              color="text-red-300"
            />
            <StatCard
              label="Risk / Reward"
              value={`1 : ${topPick.riskReward.toFixed(2)}`}
              sublabel={topPick.riskReward >= 1 ? 'favourable' : 'asymmetric'}
              color={topPick.riskReward >= 1 ? 'text-green-300' : 'text-yellow-300'}
            />
            <StatCard
              label="Prob. of Profit"
              value={fmtPct(topPick.probabilityOfProfit)}
              sublabel={topPick.popMethod === 'implied'
                ? `options-implied · lognormal ${fmtPct(topPick.popLognormal, 0)}`
                : 'lognormal estimate'}
              color="text-blue-300"
            />
            <StatCard
              label="Expected Value"
              value={fmtUsd(topPick.expectedValue)}
              sublabel={topPick.probMaxLoss != null
                ? `P(max loss) ${fmtPct(topPick.probMaxLoss, 0)} · P(max profit) ${fmtPct(topPick.probMaxProfit, 0)}`
                : undefined}
              color={topPick.expectedValue > 0 ? 'text-green-300' : 'text-red-300'}
            />
          </div>

          <div className="mt-3 text-xs text-gray-400 flex items-center gap-1.5">
            <Info size={11} className="text-cyan-400" />
            Breakeven at expiry: <span className="font-mono text-gray-200">${topPick.breakeven.toFixed(2)}</span>
            <span className="text-gray-600">·</span>
            <span>
              {def?.direction === 'bullish' ? 'Profit if' : 'Profit if'} underlying ends{' '}
              {topPick.flow === 'debit' && def?.direction === 'bullish' ? 'above' : ''}
              {topPick.flow === 'debit' && def?.direction === 'bearish' ? 'below' : ''}
              {topPick.flow === 'credit' && def?.direction === 'bullish' ? 'above' : ''}
              {topPick.flow === 'credit' && def?.direction === 'bearish' ? 'below' : ''}
              {' '}<span className="font-mono text-gray-200">${topPick.breakeven.toFixed(2)}</span>
            </span>
          </div>
        </Card>
      )}

      {/* Options-implied distribution */}
      {chain?.underlyingPrice > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Target size={14} className="text-cyan-400" />
            <span className="text-sm font-semibold text-gray-200">What the market is pricing</span>
            <span className="text-xs text-gray-500">options-implied distribution for this expiry · drives PoP, EV and tail odds below</span>
          </div>
          <ImpliedDistributionPanel summary={distSummary} curve={distCurve} markers={topPick ? [topPick.breakeven] : []} />
        </Card>
      )}

      {/* Results table */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
          <Layers size={14} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-200">All Candidates</span>
          <span className="text-xs text-gray-500 ml-auto">
            {sortedCandidates.length} spreads · sorted by {SORT_OPTIONS.find(s => s.id === sortBy)?.label}
          </span>
        </div>
        {loading && !chain ? (
          <div className="p-6 text-center text-sm text-gray-500">Loading chain…</div>
        ) : sortedCandidates.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
            <AlertTriangle size={14} />
            No spreads match your filters. Try widening Max Risk, Max Width, or lowering Min Liquidity.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-900/50">
                <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-700">
                  <th className="py-2 pl-4 text-left font-medium">#</th>
                  <th className="py-2 text-left font-medium">Strikes</th>
                  <th className="py-2 text-right font-medium">Cost</th>
                  <th className="py-2 text-right font-medium">Max Profit</th>
                  <th className="py-2 text-right font-medium">Max Loss</th>
                  <th className="py-2 text-right font-medium">R/R</th>
                  <th className="py-2 text-right font-medium" title={distribution ? 'Options-implied probability of profit' : 'Lognormal estimate (implied distribution unavailable)'}>PoP{distribution ? ' (impl.)' : ''}</th>
                  <th className="py-2 text-right font-medium" title="Probability of finishing at max loss (options-implied)">P(max loss)</th>
                  <th className="py-2 text-right font-medium">EV</th>
                  <th className="py-2 text-right font-medium">BE</th>
                  <th className="py-2 text-right font-medium">Liq</th>
                  <th className="py-2 pr-4 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {sortedCandidates.slice(0, 50).map((c, i) => {
                  const isCredit = c.flow === 'credit';
                  return (
                    <tr key={`${c.longLeg.strike}-${c.shortLeg.strike}`} className="border-b border-gray-800/50 hover:bg-gray-700/20">
                      <td className="py-2 pl-4 text-gray-500 font-mono">{i + 1}</td>
                      <td className="py-2 font-mono text-gray-200">
                        ${c.longLeg.strike.toFixed(0)}/${c.shortLeg.strike.toFixed(0)}
                        <span className="text-gray-600 ml-1.5">w${c.width.toFixed(0)}</span>
                      </td>
                      <td className={`py-2 text-right font-mono ${isCredit ? 'text-green-300' : 'text-amber-300'}`}>
                        {isCredit ? '+' : ''}{fmtUsd(-c.netCostContract, 0)}
                      </td>
                      <td className="py-2 text-right font-mono text-green-300">{fmtUsd(c.maxProfit)}</td>
                      <td className="py-2 text-right font-mono text-red-300">{fmtUsd(c.maxLoss)}</td>
                      <td className="py-2 text-right font-mono text-gray-200">1:{c.riskReward.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono text-blue-300" title={c.popLognormal != null ? `lognormal ${fmtPct(c.popLognormal, 0)}` : undefined}>{fmtPct(c.probabilityOfProfit, 0)}</td>
                      <td className="py-2 text-right font-mono text-red-300/80">{fmtPct(c.probMaxLoss, 0)}</td>
                      <td className={`py-2 text-right font-mono ${(c.expectedValue ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                        {fmtUsd(c.expectedValue)}
                      </td>
                      <td className="py-2 text-right font-mono text-gray-400">${c.breakeven.toFixed(1)}</td>
                      <td className="py-2 text-right font-mono text-gray-500">{c.liquidityScore}</td>
                      <td className="py-2 pr-4 text-right">
                        <ScoreBar value={c.compositeScore} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sortedCandidates.length > 50 && (
              <div className="px-4 py-2 text-center text-xs text-gray-500 border-t border-gray-800">
                Showing top 50 of {sortedCandidates.length}. Tighten filters to narrow.
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Methodology footer */}
      <Card className="text-xs text-gray-400">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-cyan-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <div><span className="text-gray-300 font-semibold">Pricing:</span> mid of bid/ask, fallback to last. P&L is per contract (×100 share multiplier).</div>
            <div><span className="text-gray-300 font-semibold">PoP:</span> probability the underlying ends past breakeven at expiry under geometric Brownian motion using the short-leg's implied volatility. Risk-neutral drift mu = r − q (risk-free rate minus dividend yield). Approximation only.</div>
            <div><span className="text-gray-300 font-semibold">EV:</span> pop × maxProfit − (1 − pop) × maxLoss.</div>
            <div><span className="text-gray-300 font-semibold">Composite Score:</span> 50% EV-rank + 30% R/R-rank + 20% liquidity-rank, normalised 0–100 within the candidate set.</div>
            <div><span className="text-gray-300 font-semibold">LEAPS:</span> options with DTE ≥ 270 days are flagged. For multi-year horizons, set the dividend yield slider — a 3% yield over 3 years moves the implied forward price by ~9% which materially shifts PoP. Early-exercise risk on American-style ITM puts and deep-ITM calls just before ex-dividend is not modelled.</div>
            <div className="text-yellow-400/80 mt-1">⚠ For research only. Real fills may differ from mid; check assignment & early-exercise risk before trading.</div>
          </div>
        </div>
      </Card>

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol={symbol} title={`${symbol} — 12-Week Price Trend`} color="#06b6d4" />
    </div>
  );
}

// ─── Visual score bar ───────────────────────────────────────
function ScoreBar({ value }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="inline-flex items-center gap-1.5">
      <div className="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-gray-300 w-8 text-right">{pct.toFixed(0)}</span>
    </div>
  );
}
