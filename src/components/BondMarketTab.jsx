import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import {
  Landmark, TrendingUp, TrendingDown, DollarSign, Percent, Activity,
  AlertTriangle, Info, ArrowUpRight, ArrowDownRight, Coins, Bitcoin, Globe,
  Building2, Fuel, Scale,
} from 'lucide-react';
import { fetchQuotes, fetchHistory } from '../engine/marketData';
import SectionTimestamp from './SectionTimestamp';
import {
  NEGATIVE_YEARS, NEGATIVE_YEARS_NOTE, HEADLINE_STATS, CRASH_WINDOWS,
  BOND_RULE_THRESHOLDS, computeBondRule, BOND_RULE_2022_BACKTEST,
  estimateDurationPriceImpact, DURATION_LADDER, SETUP_REFERENCE,
  YIELD_TICKERS, normalizeYield,
} from '../engine/bondMarket';
import {
  CROSS_ASSET_UNIVERSE, CORRELATION_WINDOWS, computeReturns,
  buildCorrelationMatrix, findDivergences, trailingSlopePct, classifyRegime,
  REGIME_PLAYBOOK, PLAYBOOK_DISCLAIMER,
} from '../engine/correlations';

// ─── Shared UI helpers (mirrors App.jsx style) ─────────────────────────
function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-4 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

function SectionHeading({ icon: Icon, title, subtitle }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 mb-1">
        {Icon && <Icon size={20} className="text-brand-400" />}
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      {subtitle && <p className="text-surface-400 text-sm ml-8">{subtitle}</p>}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color = 'text-brand-400' }) {
  return (
    <Card className="flex items-start gap-4">
      {Icon && (
        <div className={`p-3 rounded-xl bg-surface-800 ${color}`}>
          <Icon size={20} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-surface-400 text-xs">{label}</p>
        <p className="text-xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-surface-500 text-xs mt-1">{sub}</p>}
      </div>
    </Card>
  );
}

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg px-4 py-3 shadow-xl text-sm">
      <p className="text-surface-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || p.stroke || p.fill }} className="font-medium">
          {p.name}: {formatter ? formatter(p.value) : typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </p>
      ))}
    </div>
  );
}

function fmtPct(v, digits = 1) {
  if (v == null || isNaN(v)) return '—';
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(digits)}%`;
}

// ─── Correlation heatmap cell coloring ──────────────────────────────────
function corrColor(v) {
  if (v == null) return 'bg-surface-800 text-surface-600';
  if (v >= 0.6) return 'bg-emerald-600/70 text-white';
  if (v >= 0.25) return 'bg-emerald-600/30 text-emerald-200';
  if (v >= -0.25) return 'bg-surface-700/50 text-surface-300';
  if (v >= -0.6) return 'bg-red-600/30 text-red-200';
  return 'bg-red-600/70 text-white';
}

const GROUP_ICONS = {
  bonds: Landmark, metals: Coins, currency: DollarSign, real_estate: Building2,
  equities: TrendingUp, commodities: Fuel, crypto: Bitcoin,
};

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════
export default function BondMarketTab() {
  // ─── Section A: Live duration ladder quotes ───────────────────────
  const [ladderQuotes, setLadderQuotes] = useState(null);
  const [ladderLoading, setLadderLoading] = useState(true);
  const [ladderRefresh, setLadderRefresh] = useState(null);

  // ─── Section B: Bond rule live signal ─────────────────────────────
  const [bondRule, setBondRule] = useState(null);
  const [bondRuleLoading, setBondRuleLoading] = useState(true);
  const [yieldSnapshot, setYieldSnapshot] = useState(null); // {irxNow, tnxNow, tyxNow}

  // ─── Section F: Cross-asset correlations ──────────────────────────
  const [corrData, setCorrData] = useState(null); // { matrices: {30d,90d,365d}, tickers }
  const [corrLoading, setCorrLoading] = useState(true);
  const [activeWindow, setActiveWindow] = useState('90d');
  const [regime, setRegime] = useState(null);

  // ── Fetch: Duration Ladder quotes ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLadderLoading(true);
      const tickers = DURATION_LADDER.map((d) => d.ticker);
      const quoteMap = await fetchQuotes(tickers);
      if (!cancelled) {
        setLadderQuotes(quoteMap);
        setLadderRefresh(new Date());
        setLadderLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch: Yields + Bond Rule ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBondRuleLoading(true);
      try {
        const [irxHist, tnxHist, tyxHist] = await Promise.all([
          fetchHistory(YIELD_TICKERS.threeMonth.symbol, '6mo', '1d'),
          fetchHistory(YIELD_TICKERS.tenYear.symbol, '6mo', '1d'),
          fetchHistory(YIELD_TICKERS.thirtyYear.symbol, '6mo', '1d'),
        ]);
        if (cancelled) return;

        const irxCloses = (irxHist.closes || []).filter((c) => c != null);
        const tnxCloses = (tnxHist.closes || []).filter((c) => c != null);
        const tyxCloses = (tyxHist.closes || []).filter((c) => c != null);

        const irxNow = normalizeYield('^IRX', irxCloses[irxCloses.length - 1]);
        const tnxNow = normalizeYield('^TNX', tnxCloses[tnxCloses.length - 1]);
        const tyxNow = normalizeYield('^TYX', tyxCloses[tyxCloses.length - 1]);

        // ~3 months ago ≈ 63 trading days back
        const idx3moAgo = Math.max(0, irxCloses.length - 1 - 63);
        const irx3moAgo = normalizeYield('^IRX', irxCloses[idx3moAgo]);

        setYieldSnapshot({ irxNow, tnxNow, tyxNow });
        setBondRule(computeBondRule({ irx3moNow: irxNow, irx3moAgo, tnx10yNow: tnxNow }));
      } catch (e) {
        console.error('Bond rule fetch failed:', e);
      } finally {
        if (!cancelled) setBondRuleLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch: Cross-asset correlations ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCorrLoading(true);
      try {
        const tickers = CROSS_ASSET_UNIVERSE.map((u) => u.ticker);
        const histories = await Promise.all(
          tickers.map((t) => fetchHistory(t, '1y', '1d'))
        );
        if (cancelled) return;

        const returnsByTicker = {};
        tickers.forEach((t, i) => {
          const closes = (histories[i].closes || []).filter((c) => c != null);
          returnsByTicker[t] = computeReturns(closes);
        });

        const matrices = {};
        for (const w of CORRELATION_WINDOWS) {
          matrices[w.id] = buildCorrelationMatrix(returnsByTicker, w.days);
        }

        setCorrData({ matrices, tickers });

        // Regime classification from SPY (equities proxy) + ^TNX yield slope
        const spyIdx = tickers.indexOf('SPY');
        const spyCloses = spyIdx >= 0 ? (histories[spyIdx].closes || []).filter((c) => c != null) : [];
        const equitySlopePct = trailingSlopePct(spyCloses, 90);

        const tnxHist = await fetchHistory('^TNX', '6mo', '1d');
        const tnxCloses = (tnxHist.closes || []).filter((c) => c != null).map((c) => normalizeYield('^TNX', c));
        const tradingDays90 = Math.round(90 * (252 / 365));
        const tnxSlice = tnxCloses.slice(-tradingDays90);
        const yieldSlopeBps = tnxSlice.length >= 2
          ? (tnxSlice[tnxSlice.length - 1] - tnxSlice[0]) * 100
          : null;

        if (!cancelled) {
          setRegime(classifyRegime({ yieldSlopeBps, equitySlopePct }));
        }
      } catch (e) {
        console.error('Correlation fetch failed:', e);
      } finally {
        if (!cancelled) setCorrLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Derived: duration ladder rows ──
  const ladderRows = useMemo(() => {
    if (!ladderQuotes) return [];
    return DURATION_LADDER.map((d) => {
      const q = ladderQuotes.get(d.ticker);
      return {
        ...d,
        price: q?.price ?? null,
        change: q?.change ?? null,
        changePercent: q?.changePercent ?? null,
      };
    });
  }, [ladderQuotes]);

  // ── Derived: 100-year down-year chart data ──
  const negativeYearsChart = useMemo(() =>
    NEGATIVE_YEARS.map((y) => ({
      year: y.year,
      'S&P 500': y.sp500,
      '3-Mo T-Bill': y.tbill3mo,
      '10-Yr Treasury': y.treasury10y,
    })), []);

  // ── Derived: divergences for current vs long window ──
  const divergences = useMemo(() => {
    if (!corrData) return [];
    return findDivergences(corrData.matrices['30d'], corrData.matrices['365d'], 0.4);
  }, [corrData]);

  const playbook = regime ? REGIME_PLAYBOOK[regime] : null;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-1 flex items-center gap-3">
          <Landmark className="text-brand-400" size={28} /> Bond Market Intelligence
        </h1>
        <p className="text-surface-400">
          Yield vs. price mechanics, a live duration ladder, 100 years of history, and cross-asset regime analysis.
        </p>
      </div>

      {/* ═══ Section A: Live Duration Ladder ═══ */}
      <div>
        <SectionHeading icon={Activity} title="Live Duration Ladder" subtitle="Short → long Treasury exposure, tracked live" />
        <SectionTimestamp fetchedAt={ladderRefresh} label="Duration Ladder" loading={ladderLoading} className="mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ladderRows.map((row) => {
            const isUp = (row.changePercent ?? 0) >= 0;
            return (
              <Card key={row.ticker} className="!p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm">{row.ticker}</span>
                  <span className="text-[10px] text-surface-500 uppercase tracking-wide">{row.approxDuration}yr dur.</span>
                </div>
                <p className="text-xs text-surface-400 mb-2">{row.label}</p>
                <div className="flex items-end justify-between">
                  <span className="text-lg font-bold">{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</span>
                  <span className={`text-xs font-medium flex items-center gap-0.5 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {row.changePercent != null ? `${fmtPct(row.changePercent)}` : '—'}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* ═══ Section B: Live Bond Rule Signal ═══ */}
      <div>
        <SectionHeading icon={Scale} title="The Bond Rule — Live Signal" subtitle="Yield-curve inversion + rate-momentum check, evaluated monthly per the source framework" />
        <SectionTimestamp fetchedAt={new Date()} label="Bond Rule" loading={bondRuleLoading} className="mb-4" />
        {bondRule && !bondRule.insufficientData ? (
          <Card className={`border-2 ${bondRule.recommendation === 'SGOV' ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-emerald-500/40 bg-emerald-500/5'}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-surface-500 mb-1">Current Recommendation</p>
                <p className={`text-2xl font-black ${bondRule.recommendation === 'SGOV' ? 'text-yellow-400' : 'text-emerald-400'}`}>
                  {bondRule.recommendation === 'SGOV' ? 'Shift to SGOV (short duration)' : 'Hold IEF (intermediate duration)'}
                </p>
              </div>
              <div className="flex gap-6">
                <div className="text-center">
                  <p className="text-[10px] uppercase text-surface-500 mb-0.5">Curve Signal</p>
                  <p className={`text-sm font-bold ${bondRule.curveSignal ? 'text-yellow-400' : 'text-surface-400'}`}>
                    {bondRule.curveSignal ? 'FIRED' : 'quiet'}
                  </p>
                  <p className="text-[10px] text-surface-500">{bondRule.curveSpreadBps?.toFixed(0)}bps spread</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] uppercase text-surface-500 mb-0.5">Momentum Signal</p>
                  <p className={`text-sm font-bold ${bondRule.momentumSignal ? 'text-yellow-400' : 'text-surface-400'}`}>
                    {bondRule.momentumSignal ? 'FIRED' : 'quiet'}
                  </p>
                  <p className="text-[10px] text-surface-500">{bondRule.momentumDeltaPct != null ? `${fmtPct(bondRule.momentumDeltaPct)} Δ3mo` : '—'}</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-surface-400 mt-4 pt-4 border-t border-surface-700/50">
              Rule: shift to short-term (SGOV) if EITHER the 3-mo yield exceeds the 10-yr yield by more than {BOND_RULE_THRESHOLDS.curveInversionBps}bps (inverted curve),
              OR the 3-mo yield has risen more than {BOND_RULE_THRESHOLDS.momentumThresholdPct}pp over the trailing 3 months. Both signals must be quiet to move back into intermediate duration.
              This is not a market-timing prediction — it reacts to conditions already underway. Educational framework only, not investment advice.
            </p>
          </Card>
        ) : (
          <Card><p className="text-surface-500 text-sm">Loading live yield data…</p></Card>
        )}

        {/* 2022 backtest illustration */}
        <Card className="mt-4">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Info size={14} className="text-brand-400" /> 2022 Backtest (Illustrative)</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-[10px] uppercase text-surface-500">Buy &amp; Hold IEF</p>
              <p className="text-lg font-bold text-red-400">{fmtPct(BOND_RULE_2022_BACKTEST.bareIefFullYearReturn)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-surface-500">Rule-Based Path</p>
              <p className="text-lg font-bold text-yellow-400">{fmtPct(BOND_RULE_2022_BACKTEST.ruleBasedFullYearReturn)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-surface-500">Difference</p>
              <p className="text-lg font-bold text-emerald-400">{fmtPct(BOND_RULE_2022_BACKTEST.differencePct)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-surface-500">Per $100k</p>
              <p className="text-lg font-bold text-emerald-400">${BOND_RULE_2022_BACKTEST.differenceDollarsPer100k.toLocaleString()}</p>
            </div>
          </div>
          <p className="text-xs text-surface-500 mt-3">{BOND_RULE_2022_BACKTEST.note}</p>
        </Card>
      </div>

      {/* ═══ Section C: Yield vs Price Explainer ═══ */}
      <div>
        <SectionHeading icon={Info} title="Why Bond Prices Fall When Yields Rise" subtitle="The mechanics behind duration, Fed policy, mortgages, and the dollar" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <h3 className="font-bold text-sm mb-2">The Inverse Relationship</h3>
            <p className="text-sm text-surface-400 leading-relaxed">
              A bond pays a fixed coupon. If new bonds are issued at higher yields, your older, lower-coupon bond
              becomes less attractive — so its price must fall until its effective yield matches the market. The
              longer the bond's duration, the bigger the price swing for the same change in yield.
            </p>
            <p className="text-sm text-surface-400 leading-relaxed mt-2">
              Rule of thumb: a fund with ~7 years of duration moves ~7% in price for every 1 percentage point
              change in yield (opposite direction). Example: IEF at ~7.5yr duration, TLT at ~16.5yr duration —
              TLT moves roughly 2x as much as IEF for the same yield change.
            </p>
          </Card>
          <Card>
            <h3 className="font-bold text-sm mb-2">Illustrative: Price Impact by Duration</h3>
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={DURATION_LADDER.map((d) => ({
                  ticker: d.ticker,
                  '+1pp yield rise': estimateDurationPriceImpact(d.approxDuration, 1),
                  '-1pp yield fall': estimateDurationPriceImpact(d.approxDuration, -1),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="ticker" stroke="#64748b" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<ChartTooltip formatter={(v) => `${v.toFixed(1)}%`} />} />
                  <ReferenceLine y={0} stroke="#64748b" />
                  <Bar dataKey="+1pp yield rise" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="-1pp yield fall" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <h3 className="font-bold text-sm mb-2">What It Means When the Fed Buys or Sells Bonds</h3>
            <p className="text-sm text-surface-400 leading-relaxed">
              <span className="font-semibold text-surface-200">QE (buying, "quantitative easing"):</span> The Fed
              creates reserves to buy Treasuries/MBS, pushing bond prices up and yields down — cheaper borrowing,
              a boost to risk assets, and typically a weaker dollar (more dollars in the system).
            </p>
            <p className="text-sm text-surface-400 leading-relaxed mt-2">
              <span className="font-semibold text-surface-200">QT (selling / letting bonds roll off, "quantitative tightening"):</span>{' '}
              Removes demand for bonds (or adds supply), pushing yields up and prices down — tighter financial
              conditions, and typically dollar-supportive as liquidity is withdrawn.
            </p>
          </Card>
          <Card>
            <h3 className="font-bold text-sm mb-2">10-Year Yield → Mortgages &amp; the Dollar</h3>
            <p className="text-sm text-surface-400 leading-relaxed">
              <span className="font-semibold text-surface-200">Mortgages:</span> 30-year fixed mortgage rates track
              the 10-year Treasury yield (plus a spread for credit/prepayment risk) far more closely than the Fed
              funds rate. When the 10-yr yield rises, mortgage rates rise within weeks — cooling housing demand.
            </p>
            <p className="text-sm text-surface-400 leading-relaxed mt-2">
              <span className="font-semibold text-surface-200">US Dollar:</span> Higher US yields (relative to other
              countries) attract foreign capital seeking yield, which tends to strengthen the dollar. Falling US
              yields relative to peers tends to weaken it — one reason the dollar and rate expectations are tightly linked.
            </p>
          </Card>
        </div>
      </div>

      {/* ═══ Section D: 100-Year History ═══ */}
      <div id="hundred-year-history">
        <SectionHeading icon={TrendingUp} title="100 Years of Bonds vs. Stocks" subtitle="Every negative S&P 500 calendar year (1928–2025) vs. 3-mo T-bills and 10-yr Treasuries" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard icon={TrendingUp} label="Down Stock Years" value={HEADLINE_STATS.negativeStockYears} sub={`of ${HEADLINE_STATS.totalYears} years`} />
          <StatCard icon={Landmark} label="Treasuries Positive" value={`${HEADLINE_STATS.treasuryPositiveInNegativeYears}/${HEADLINE_STATS.negativeStockYears}`} sub="in those down years" color="text-emerald-400" />
          <StatCard icon={AlertTriangle} label="Only Year Below -6%" value={HEADLINE_STATS.onlyYearBelowNegative6Pct} sub="for 10-yr Treasuries" color="text-red-400" />
          <StatCard icon={Percent} label="Bonds vs. Cash Win Rate" value={`${HEADLINE_STATS.bondsBeatCashCount}/${HEADLINE_STATS.negativeStockYears}`} sub="10-yr beat 3-mo bills" color="text-yellow-400" />
        </div>
        <Card>
          <div className="h-96">
            <ResponsiveContainer>
              <BarChart data={negativeYearsChart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="year" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<ChartTooltip formatter={(v) => `${v.toFixed(1)}%`} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <Bar dataKey="S&P 500" fill="#ef4444" radius={[2, 2, 0, 0]} />
                <Bar dataKey="3-Mo T-Bill" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                <Bar dataKey="10-Yr Treasury" fill="#22c55e" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-surface-500 mt-3">{NEGATIVE_YEARS_NOTE}</p>
        </Card>

        {/* Crash window deep-dives */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {CRASH_WINDOWS.map((w) => (
            <Card key={w.id}>
              <h3 className="font-bold text-sm mb-1">{w.label}</h3>
              <p className="text-[10px] text-surface-500 mb-3">{w.start} → {w.end}</p>
              <div className="flex gap-4 mb-3">
                <div>
                  <p className="text-[10px] uppercase text-surface-500">S&amp;P 500</p>
                  <p className="text-base font-bold text-red-400">{fmtPct(w.stockReturn, 0)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-surface-500">10-Yr Treasury</p>
                  <p className={`text-base font-bold ${w.treasury10yReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(w.treasury10yReturn, 0)}</p>
                </div>
                {w.tbillReturn != null && (
                  <div>
                    <p className="text-[10px] uppercase text-surface-500">T-Bills</p>
                    <p className="text-base font-bold text-blue-400">{fmtPct(w.tbillReturn, 0)}</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-surface-400 leading-relaxed">{w.narrative}</p>
              <p className="text-xs font-semibold text-brand-400 mt-2">→ {w.lesson}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* ═══ Section E: Today's Setup ═══ */}
      <div>
        <SectionHeading icon={DollarSign} title="Today's Setup" subtitle="Current yields vs. the 2022 starting point — the 'income cushion' framing" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard icon={Percent} label="3-Month T-Bill Yield" value={yieldSnapshot?.irxNow != null ? `${yieldSnapshot.irxNow.toFixed(2)}%` : '—'} color="text-blue-400" />
          <StatCard icon={Percent} label="10-Year Treasury Yield" value={yieldSnapshot?.tnxNow != null ? `${yieldSnapshot.tnxNow.toFixed(2)}%` : '—'}
            sub={yieldSnapshot?.tnxNow != null ? `vs. ${SETUP_REFERENCE.y2022EntryYield10y}% entering 2022` : undefined} color="text-emerald-400" />
          <StatCard icon={Percent} label="30-Year Treasury Yield" value={yieldSnapshot?.tyxNow != null ? `${yieldSnapshot.tyxNow.toFixed(2)}%` : '—'} color="text-purple-400" />
        </div>
        <Card className="mt-3">
          <p className="text-sm text-surface-400">{SETUP_REFERENCE.note}</p>
        </Card>
      </div>

      {/* ═══ Section F: Cross-Asset Correlations & Opportunity Screener ═══ */}
      <div>
        <SectionHeading icon={Globe} title="Cross-Asset Correlations & Regime Screener" subtitle="Bonds vs. gold, USD, real estate, world equities, commodities, oil & crypto" />
        <SectionTimestamp fetchedAt={new Date()} label="Correlation Matrix" loading={corrLoading} className="mb-4" />

        {/* Regime + Playbook */}
        {regime && playbook && (
          <Card className="mb-4 border-2 border-brand-500/30 bg-brand-500/5">
            <div className="flex items-center gap-2 mb-2">
              <Scale size={16} className="text-brand-400" />
              <p className="text-xs uppercase tracking-wider text-surface-500">Current Regime (90-day trailing)</p>
            </div>
            <p className="text-xl font-black text-brand-300 mb-1">{regime}</p>
            <p className="text-sm text-surface-400 mb-4">{playbook.summary}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-emerald-400 uppercase mb-1.5">Historically Favored</p>
                <ul className="space-y-1">
                  {playbook.favored.map((f, i) => (
                    <li key={i} className="text-xs text-surface-300 flex items-start gap-1.5">
                      <ArrowUpRight size={12} className="text-emerald-400 shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold text-red-400 uppercase mb-1.5">Historically Disfavored</p>
                <ul className="space-y-1">
                  {playbook.disfavored.map((f, i) => (
                    <li key={i} className="text-xs text-surface-300 flex items-start gap-1.5">
                      <ArrowDownRight size={12} className="text-red-400 shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-xs text-surface-500 mt-4 pt-3 border-t border-surface-700/50">{playbook.rationale}</p>
            <p className="text-[11px] text-yellow-500/80 mt-2 flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {PLAYBOOK_DISCLAIMER}
            </p>
          </Card>
        )}

        {/* Correlation heatmap */}
        <Card>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="font-bold text-sm">Rolling Correlation Matrix (daily returns)</h3>
            <div className="flex gap-1.5">
              {CORRELATION_WINDOWS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setActiveWindow(w.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${activeWindow === w.id ? 'bg-brand-500/20 text-brand-400' : 'bg-surface-800 text-surface-400 hover:text-white'}`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          {corrData ? (
            <div className="overflow-x-auto">
              <table className="text-[10px] border-collapse min-w-[700px]">
                <thead>
                  <tr>
                    <th className="p-1"></th>
                    {corrData.tickers.map((t) => (
                      <th key={t} className="p-1 text-surface-400 font-medium whitespace-nowrap">{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {corrData.tickers.map((ti, i) => (
                    <tr key={ti}>
                      <td className="p-1 text-surface-400 font-medium whitespace-nowrap pr-2">{ti}</td>
                      {corrData.tickers.map((tj, j) => {
                        const v = corrData.matrices[activeWindow].matrix[i][j];
                        return (
                          <td key={tj} className={`p-1.5 text-center font-medium ${corrColor(v)}`}>
                            {v != null ? v.toFixed(2) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-surface-500 text-sm">Loading correlation data…</p>
          )}
        </Card>

        {/* Divergence callouts */}
        {divergences.length > 0 && (
          <Card className="mt-4">
            <h3 className="font-bold text-sm mb-3 flex items-center gap-2">
              <AlertTriangle size={14} className="text-yellow-400" /> Structural Divergences (30-day vs. 1-year correlation)
            </h3>
            <div className="space-y-2">
              {divergences.slice(0, 8).map((d, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-surface-800/50 rounded-lg px-3 py-2">
                  <span className="font-medium">{d.a} ↔ {d.b}</span>
                  <span className="text-surface-400">
                    30d: <span className={d.shortCorr >= 0 ? 'text-emerald-400' : 'text-red-400'}>{d.shortCorr.toFixed(2)}</span>
                    {' '}vs 1yr: <span className={d.longCorr >= 0 ? 'text-emerald-400' : 'text-red-400'}>{d.longCorr.toFixed(2)}</span>
                    {' '}(Δ{d.delta > 0 ? '+' : ''}{d.delta.toFixed(2)})
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-surface-500 mt-3">
              Pairs where the recent relationship has shifted meaningfully from its longer-run norm — worth watching
              for either a reversion or a genuine regime change, not an automatic buy/sell signal.
            </p>
          </Card>
        )}
      </div>

      <Card className="border-yellow-500/20 bg-yellow-500/5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-yellow-200/70 text-xs">
            Educational analysis only — not financial advice. Historical data, regime classifications, and the bond
            rule signal are illustrative frameworks based on past patterns, which may not repeat. Consult a
            qualified financial advisor before making investment decisions.
          </p>
        </div>
      </Card>
    </div>
  );
}
