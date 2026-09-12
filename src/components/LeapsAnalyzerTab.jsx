import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Layers, TrendingUp, AlertTriangle, Info, Activity, Scale } from 'lucide-react';
import { BarChart, Bar, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { fetchOptionsChain } from '../engine/marketData.js';
import { compareLeapsVsShares, pickStockReplacementStrike, impliedVolCall, bsCallDelta, midPrice } from '../engine/leapsAnalyzer.js';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

const fmtUsd = (n) => n == null || Number.isNaN(n) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtUsd2 = (n) => n == null || Number.isNaN(n) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const fmtPct = (n) => n == null || Number.isNaN(n) ? '—' : `${(n * 100).toFixed(1)}%`;

function Card({ children, className = '' }) {
  return <div className={`bg-[#111114] border border-surface-800 rounded-xl p-5 ${className}`}>{children}</div>;
}

function NumInput({ label, value, onChange, step = 1, suffix, min }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-surface-500 mb-1">{label}</label>
      <div className="relative">
        <input
          type="number" value={value} step={step} min={min}
          onChange={(e) => onChange(e.target.value === '' ? '' : +e.target.value)}
          className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm"
        />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 text-xs">{suffix}</span>}
      </div>
    </div>
  );
}

function daysUntil(ts) {
  if (!ts) return null;
  return Math.round((ts * 1000 - Date.now()) / 86400000);
}

export default function LeapsAnalyzerTab() {
  const [symbol, setSymbol] = useState('SPY');
  const [symbolInput, setSymbolInput] = useState('SPY');
  const [expirations, setExpirations] = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState(null);
  const [chain, setChain] = useState(null);
  const [nearChain, setNearChain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  // Assumptions
  const [targetDelta, setTargetDelta] = useState(0.80);
  const [contracts, setContracts] = useState(1);
  const [riskFreeRate, setRiskFreeRate] = useState(4.3);
  const [dividendYield, setDividendYield] = useState(1.0);
  const [freedYield, setFreedYield] = useState(5.0);

  // Load expirations + nearest chain on symbol change
  const loadExpirations = useCallback(async (sym, force = false) => {
    setLoading(true);
    setError(null);
    try {
      const near = await fetchOptionsChain(sym, null, force);
      if (!near || !near.expirations || near.expirations.length === 0) {
        setError(`No options data available for ${sym}.`);
        setExpirations([]);
        setChain(null);
        setNearChain(null);
        setLoading(false);
        return;
      }
      setNearChain(near);
      setExpirations(near.expirations);
      // Default to the longest-dated expiry (most LEAPS-like)
      const longest = near.expirations[near.expirations.length - 1];
      setSelectedExpiry(longest);
    } catch (e) {
      setError(`Failed to load options for ${sym}.`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadExpirations(symbol); }, [symbol, loadExpirations]);

  // Load the selected expiry chain
  useEffect(() => {
    if (!selectedExpiry) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const c = await fetchOptionsChain(symbol, selectedExpiry);
        if (!cancelled) {
          setChain(c);
          setFetchedAt(new Date());
        }
      } catch {
        if (!cancelled) setError('Failed to load selected expiry chain.');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [symbol, selectedExpiry]);

  const dte = daysUntil(selectedExpiry);
  const r = riskFreeRate / 100;
  const q = dividendYield / 100;

  // Pick the target-delta strike and run the analysis
  const result = useMemo(() => {
    if (!chain || !chain.calls || chain.calls.length === 0 || !chain.underlyingPrice || dte == null) return null;
    const pick = pickStockReplacementStrike(chain.calls, chain.underlyingPrice, dte, targetDelta, r, q);
    if (!pick) return null;
    return compareLeapsVsShares({
      spot: chain.underlyingPrice,
      strike: pick.contract.strike,
      premium: pick.premium,
      dte,
      contracts: contracts || 1,
      riskFreeRate: r,
      dividendYield: q,
      freedCapitalYield: freedYield / 100,
    });
  }, [chain, dte, targetDelta, contracts, r, q, freedYield]);

  // Term structure: near-term ATM IV vs LEAPS IV
  const termStructure = useMemo(() => {
    if (!nearChain || !nearChain.calls || !nearChain.underlyingPrice) return null;
    const nearDte = daysUntil(nearChain.expirationDate);
    const spot = nearChain.underlyingPrice;
    // ATM call = strike closest to spot
    let atm = null;
    for (const c of nearChain.calls) {
      const d = Math.abs(c.strike - spot);
      if (!atm || d < atm.d) atm = { c, d };
    }
    let nearIv = null;
    if (atm) {
      nearIv = atm.c.impliedVolatility > 0
        ? atm.c.impliedVolatility
        : impliedVolCall(midPrice(atm.c), spot, atm.c.strike, Math.max(nearDte, 1) / 365, r, q);
    }
    const leapsIv = result?.impliedVol ?? null;
    return { nearDte, nearIv, leapsDte: dte, leapsIv };
  }, [nearChain, result, dte, r, q]);

  const chartData = useMemo(() => {
    if (!result) return [];
    return [
      { name: 'Intrinsic', value: +result.intrinsic.toFixed(2), fill: '#3b82f6' },
      { name: 'Interest Carry', value: +result.interestCarry.toFixed(2), fill: '#f59e0b' },
      { name: 'Dividend Drag', value: +(-result.dividendDrag).toFixed(2), fill: '#ef4444' },
      { name: 'Vol Premium', value: +result.volatilityPremium.toFixed(2), fill: '#8b5cf6' },
    ];
  }, [result]);

  const c = result?.comparison;
  const contango = termStructure && termStructure.nearIv != null && termStructure.leapsIv != null
    ? termStructure.leapsIv > termStructure.nearIv : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Layers size={20} className="text-brand-400" />
          <h2 className="text-xl font-bold">LEAPS Stock-Replacement Analyzer</h2>
        </div>
        <p className="text-surface-400 text-sm ml-8">
          Decomposes a deep-ITM LEAPS call into intrinsic, interest carry, dividend drag, and volatility premium — and compares it against holding the shares.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-surface-500 mb-1">Symbol</label>
            <form onSubmit={(e) => { e.preventDefault(); setSymbol(symbolInput.trim().toUpperCase()); }}>
              <input
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                className="w-28 bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm font-mono uppercase"
              />
            </form>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-surface-500 mb-1">Expiry</label>
            <select
              value={selectedExpiry ?? ''}
              onChange={(e) => setSelectedExpiry(+e.target.value)}
              className="bg-surface-800 border border-surface-700 rounded px-2 py-1.5 text-sm"
            >
              {expirations.map((exp) => {
                const d = daysUntil(exp);
                return <option key={exp} value={exp}>{new Date(exp * 1000).toLocaleDateString()} ({d}d)</option>;
              })}
            </select>
          </div>
          <div className="w-40">
            <label className="block text-[11px] uppercase tracking-wider text-surface-500 mb-1">Target Delta: {targetDelta.toFixed(2)}</label>
            <input type="range" min={0.50} max={0.95} step={0.05} value={targetDelta}
              onChange={(e) => setTargetDelta(+e.target.value)} className="w-full accent-brand-400" />
          </div>
          <NumInput label="Contracts" value={contracts} onChange={setContracts} min={1} />
          <NumInput label="Risk-Free" value={riskFreeRate} onChange={setRiskFreeRate} step={0.1} suffix="%" />
          <NumInput label="Div Yield" value={dividendYield} onChange={setDividendYield} step={0.1} suffix="%" />
          <NumInput label="Freed-Cash Yield" value={freedYield} onChange={setFreedYield} step={0.1} suffix="%" />
        </div>
        <div className="mt-3">
          <SectionTimestamp fetchedAt={fetchedAt} label={`${symbol} Options Chain`} loading={loading} onRefresh={() => loadExpirations(symbol, true)} />
        </div>
      </Card>

      {error && (
        <Card className="border-red-500/30">
          <div className="flex items-center gap-2 text-red-400 text-sm"><AlertTriangle size={16} /> {error}</div>
        </Card>
      )}

      {result && c && (
        <>
          {/* Selected contract summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <label className="text-[11px] uppercase tracking-wider text-surface-500">Selected LEAPS</label>
              <p className="text-lg font-bold text-brand-300 mt-1">{symbol} ${result.strike} Call</p>
              <p className="text-[11px] text-surface-500">{new Date(selectedExpiry * 1000).toLocaleDateString()} · {dte}d · {result.delta != null ? `${(result.delta * 100).toFixed(0)}Δ` : '—'}</p>
            </Card>
            <Card>
              <label className="text-[11px] uppercase tracking-wider text-surface-500">Premium</label>
              <p className="text-lg font-bold mt-1">{fmtUsd2(result.premium)}</p>
              <p className="text-[11px] text-surface-500">Spot {fmtUsd2(result.spot)}</p>
            </Card>
            <Card>
              <label className="text-[11px] uppercase tracking-wider text-surface-500">Implied Vol (this LEAPS)</label>
              <p className="text-lg font-bold text-purple-400 mt-1">{fmtPct(result.impliedVol)}</p>
              <p className="text-[11px] text-surface-500">Long-dated IV</p>
            </Card>
            <Card>
              <label className="text-[11px] uppercase tracking-wider text-surface-500">Break-Even (expiry)</label>
              <p className="text-lg font-bold mt-1">{fmtUsd2(result.breakeven)}</p>
              <p className="text-[11px] text-surface-500">{fmtPct((result.breakeven - result.spot) / result.spot)} above spot</p>
            </Card>
          </div>

          {/* Premium decomposition */}
          <Card>
            <h3 className="font-semibold mb-1 flex items-center gap-2"><Activity size={16} className="text-brand-400" /> Premium Decomposition (per share)</h3>
            <p className="text-[11px] text-surface-500 mb-3">
              Extrinsic value {fmtUsd2(result.extrinsic)} = interest carry {fmtUsd2(result.interestCarry)} − dividend drag {fmtUsd2(result.dividendDrag)} + volatility premium {fmtUsd2(result.volatilityPremium)}.
            </p>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                  <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v) => fmtUsd2(v)} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="#475569" />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Term-structure insight */}
          {termStructure && termStructure.nearIv != null && termStructure.leapsIv != null && (
            <Card className={contango ? 'border-yellow-500/20' : 'border-emerald-500/20'}>
              <h3 className="font-semibold mb-2 flex items-center gap-2"><TrendingUp size={16} className="text-brand-400" /> Volatility Term Structure</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-surface-500">Near-Term ATM IV</p>
                  <p className="text-2xl font-bold text-emerald-400">{fmtPct(termStructure.nearIv)}</p>
                  <p className="text-[11px] text-surface-500">~{termStructure.nearDte}d (VIX-like)</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-surface-500">LEAPS IV</p>
                  <p className="text-2xl font-bold text-purple-400">{fmtPct(termStructure.leapsIv)}</p>
                  <p className="text-[11px] text-surface-500">~{termStructure.leapsDte}d</p>
                </div>
              </div>
              <p className="text-xs text-surface-400 mt-3">
                {contango
                  ? `Term structure is in contango — long-dated IV (${fmtPct(termStructure.leapsIv)}) is above near-term IV (${fmtPct(termStructure.nearIv)}). A low spot VIX does NOT make this LEAPS cheap; you are paying elevated long-dated vol plus interest carry.`
                  : `Term structure is inverted — near-term IV exceeds long-dated IV, which can make LEAPS relatively attractive versus short-dated options.`}
              </p>
            </Card>
          )}

          {/* LEAPS vs Shares comparison */}
          <Card>
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Scale size={16} className="text-brand-400" /> LEAPS vs. {c.shares} Shares</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-surface-500 uppercase tracking-wider">
                  <tr className="border-b border-surface-800">
                    <th className="text-left py-2 pr-3">Metric</th>
                    <th className="text-right py-2 pr-3">{c.contracts} LEAPS Contract{c.contracts > 1 ? 's' : ''}</th>
                    <th className="text-right py-2 pr-3">{c.shares} Shares</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-b [&>tr]:border-surface-800/50">
                  <tr>
                    <td className="py-1.5 pr-3">Capital deployed</td>
                    <td className="py-1.5 pr-3 text-right font-semibold">{fmtUsd(c.leapsCapital)}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold">{fmtUsd(c.shareCapital)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3">Capital freed</td>
                    <td className="py-1.5 pr-3 text-right text-emerald-400 font-semibold">{fmtUsd(c.capitalFreed)}</td>
                    <td className="py-1.5 pr-3 text-right text-surface-600">—</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3">Capital efficiency</td>
                    <td className="py-1.5 pr-3 text-right">{fmtPct(c.capitalEfficiency)}</td>
                    <td className="py-1.5 pr-3 text-right">100%</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3">Share-equivalent exposure (delta)</td>
                    <td className="py-1.5 pr-3 text-right">{c.deltaExposure != null ? c.deltaExposure.toFixed(0) : '—'} sh</td>
                    <td className="py-1.5 pr-3 text-right">{c.shares} sh</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3">Max loss</td>
                    <td className="py-1.5 pr-3 text-right text-red-400 font-semibold">{fmtUsd(c.maxLoss)}</td>
                    <td className="py-1.5 pr-3 text-right text-red-400">{fmtUsd(c.shareCapital)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3">Income on freed cash (over life)</td>
                    <td className="py-1.5 pr-3 text-right text-emerald-400">+{fmtUsd(c.freedCapitalIncomeOverLife)}</td>
                    <td className="py-1.5 pr-3 text-right text-surface-600">—</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3">Dividends forgone (over life)</td>
                    <td className="py-1.5 pr-3 text-right text-red-400">−{fmtUsd(c.dividendsForgone)}</td>
                    <td className="py-1.5 pr-3 text-right text-surface-600">—</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3">Interest carry cost (over life)</td>
                    <td className="py-1.5 pr-3 text-right text-red-400">−{fmtUsd(c.financingCost)}</td>
                    <td className="py-1.5 pr-3 text-right text-surface-600">—</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 font-medium">Net carry cost (financing − freed-cash income)</td>
                    <td className={`py-1.5 pr-3 text-right font-semibold ${c.netCarryCost >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {c.netCarryCost >= 0 ? '−' : '+'}{fmtUsd(Math.abs(c.netCarryCost))}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-surface-600">—</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 font-medium">Volatility premium paid ("insurance")</td>
                    <td className="py-1.5 pr-3 text-right text-purple-400 font-semibold">{fmtUsd(c.volatilityCost)} ({fmtPct(c.volatilityCostPct)})</td>
                    <td className="py-1.5 pr-3 text-right text-surface-600">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-surface-500 mt-3 flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" />
              The LEAPS caps your downside at {fmtUsd(c.maxLoss)} (vs {fmtUsd(c.shareCapital)} of share exposure) and frees {fmtUsd(c.capitalFreed)} to earn yield. The real cost of that optionality is the <span className="text-purple-400">volatility premium ({fmtPct(c.volatilityCostPct)} of notional)</span> — the interest carry is largely offset by income on the freed cash.
            </p>
          </Card>

          {/* Trend view */}
          <WeeklyTrendView symbol={symbol} title={`${symbol} — 12-Week Price Trend`} color="#3b82f6" />
        </>
      )}

      {/* Disclaimer */}
      <Card className="border-yellow-500/20 bg-yellow-500/5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-yellow-200/70 text-xs">
            Educational analysis only — not financial advice. Option prices use the mid of bid/ask (or last) and Black-Scholes-Merton with your rate/dividend assumptions; live fills and IVs will differ. LEAPS carry expiration, assignment, and liquidity risks.
          </p>
        </div>
      </Card>
    </div>
  );
}
