import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp, Shield, Target, Activity, Plus, Trash2, DollarSign, AlertTriangle,
  Sparkles, Layers, Zap,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea,
} from 'recharts';
import { buildBrokeragePlan } from '../engine/brokeragePlanner.js';
import { evaluateStrategy } from '../engine/strategyEvaluator.js';
import { useWatchlist } from '../contexts/WatchlistContext.jsx';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

const fmtUsd = (n) => n == null || !isFinite(n) ? '—' :
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtUsdSigned = (n) => n == null || !isFinite(n) ? '—' :
  (n >= 0 ? '+' : '') + fmtUsd(n);
const fmtPct = (n) => n == null ? '—' : `${(n * 100).toFixed(1)}%`;

function Card({ children, className = '', title, icon: Icon }) {
  return (
    <div className={`bg-[#111114] border border-surface-800 rounded-xl p-5 ${className}`}>
      {title && (
        <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
          {Icon && <Icon size={14} className="text-brand-400" />} {title}
        </h3>
      )}
      {children}
    </div>
  );
}

function FitBadge({ score }) {
  const color = score === 'high' ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' :
                score === 'medium' ? 'text-yellow-300 bg-yellow-500/10 border-yellow-500/30' :
                'text-red-300 bg-red-500/10 border-red-500/30';
  return <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${color}`}>{score}</span>;
}

// Read holdings from PortfolioTab storage if available
function loadHoldingsFromStorage() {
  try {
    const raw = localStorage.getItem('portfolio:v1');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

const INPUT_STORAGE = 'brokerage_inputs';

export default function BrokeragePlanTab({ riskTolerance = 7 }) {
  const { watchlist } = useWatchlist();

  const stored = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(INPUT_STORAGE) ?? '{}'); } catch { return {}; }
  }, []);

  const [manualAccountValue, setManualAccountValue] = useState(stored.accountValue ?? 250000);
  const [manualCash, setManualCash] = useState(stored.cash ?? 25000);
  const [risk, setRisk] = useState(riskTolerance);

  useEffect(() => {
    localStorage.setItem(INPUT_STORAGE, JSON.stringify({ accountValue: manualAccountValue, cash: manualCash }));
  }, [manualAccountValue, manualCash]);

  const holdingsCsv = loadHoldingsFromStorage();
  const hasHoldings = !!holdingsCsv?.csvText;

  // For now we just use manual values for sizing; integrating live holdings parsing here would require
  // re-running PortfolioTab's enrichment pipeline, which is out of scope for this engine.
  const accountValue = manualAccountValue;

  // Build plan (synchronous — no fetches; downstream UI can hook live data in later)
  const plan = useMemo(() => buildBrokeragePlan({
    riskTolerance: risk,
    accountValue,
    cashAvailable: manualCash,
    watchlist,
    socialStats: {},  // empty for now; SocialPulseTab maintains its own; could be lifted
    quotes: {},
    holdings: [],     // hookup later when we expose enriched holdings via shared state
  }), [risk, accountValue, manualCash, watchlist]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <TrendingUp size={20} className="text-brand-400" />
          <h2 className="text-xl font-bold">Brokerage Investment Plan</h2>
        </div>
        <p className="text-surface-400 text-sm ml-8">
          Tax-aware ETF core, hedge suggestions, watchlist picks, and option ideas — plus a strategy evaluator for any trade idea.
        </p>
      </div>

      <SectionTimestamp fetchedAt={new Date()} label="Brokerage Plan" />

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <label className="text-xs uppercase tracking-wider text-surface-500">Account Value</label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">$</span>
            <input type="number" value={manualAccountValue} onChange={(e) => setManualAccountValue(+e.target.value)}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg py-2 pl-7 pr-3 text-sm" />
          </div>
          {hasHoldings && (
            <p className="text-[10px] text-emerald-400 mt-1">✓ CSV holdings detected — upload via My Holdings tab</p>
          )}
        </Card>
        <Card>
          <label className="text-xs uppercase tracking-wider text-surface-500">Cash Available</label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">$</span>
            <input type="number" value={manualCash} onChange={(e) => setManualCash(+e.target.value)}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg py-2 pl-7 pr-3 text-sm" />
          </div>
        </Card>
        <Card>
          <label className="text-xs uppercase tracking-wider text-surface-500">Risk Tolerance: {risk}/10</label>
          <input type="range" min={1} max={10} value={risk} onChange={(e) => setRisk(+e.target.value)} className="w-full accent-brand-500 mt-1" />
          <div className="flex justify-between text-[10px] text-surface-600"><span>Conservative</span><span>Aggressive</span></div>
        </Card>
      </div>

      {/* === IDEA GENERATOR === */}
      <div>
        <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Sparkles size={14} className="text-brand-400" /> Idea Generator
        </h3>

        {/* Tax-aware Core */}
        <Card title="Tax-Aware ETF Core" icon={Layers} className="mb-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-surface-500 uppercase tracking-wider">
                <tr className="border-b border-surface-800">
                  <th className="text-left py-2">Asset Class</th>
                  <th className="text-left py-2">Ticker</th>
                  <th className="text-left py-2">Rationale</th>
                  <th className="text-right py-2">Weight</th>
                  <th className="text-right py-2">$ Allocation</th>
                </tr>
              </thead>
              <tbody>
                {plan.core.positions.map(p => (
                  <tr key={p.ticker} className="border-b border-surface-800/40">
                    <td className="py-2 text-surface-300">{p.assetClassName}</td>
                    <td className="py-2 font-mono text-brand-300">{p.ticker}</td>
                    <td className="py-2 text-xs text-surface-400">{p.rationale}</td>
                    <td className="py-2 text-right font-semibold">{fmtPct(p.weight)}</td>
                    <td className="py-2 text-right font-mono">{fmtUsd(p.dollars)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Hedges */}
        <Card title="Hedging Overlays" icon={Shield} className="mb-3">
          <div className="text-xs text-surface-500 mb-3">
            Total hedge budget: <span className="text-yellow-300 font-mono">{fmtUsd(plan.hedges.budgetDollars)}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {plan.hedges.hedges.map((h, i) => (
              <div key={i} className="border border-surface-800 rounded-lg p-3 bg-surface-900/30">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-sm text-gray-200">{h.title}</p>
                  <FitBadge score={h.fitScore} />
                </div>
                <p className="text-xs text-surface-400 mb-2">{h.description}</p>
                <div className="flex justify-between text-[11px]">
                  <span className="text-surface-500">Sizing: <span className="text-surface-300">{h.sizing}</span></span>
                  <span className="text-yellow-300 font-mono">{h.estimatedCost ? fmtUsd(h.estimatedCost) : 'free'}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Watchlist Picks */}
        <Card title={`Watchlist Picks (${watchlist.length} symbols)`} icon={Activity} className="mb-3">
          {watchlist.length === 0 ? (
            <p className="text-xs text-surface-500">Add symbols to your watchlist (Social Pulse tab) to see picks here.</p>
          ) : (
            <p className="text-xs text-surface-500">
              Real-time sentiment scoring requires you to visit <strong>Social Pulse</strong> first to populate the cache.
              Picks will appear here based on net sentiment + momentum once data is loaded.
              <br /><br />
              Current watchlist: {watchlist.slice(0, 10).map(w => w.symbol).join(', ')}{watchlist.length > 10 ? '…' : ''}
            </p>
          )}
        </Card>

        {/* Options Ideas */}
        <Card title="Options Strategy Ideas" icon={Target} className="mb-3">
          {plan.options.length === 0 ? (
            <p className="text-xs text-surface-500">
              Options ideas require either current holdings (for covered calls) or watchlist picks (for CSPs/spreads).
              Load Social Pulse data and/or upload holdings via the My Holdings tab.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {plan.options.map((o, i) => (
                <div key={i} className="border border-surface-800 rounded-lg p-3 bg-surface-900/30">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-semibold text-sm text-gray-200">{o.title}</p>
                    <FitBadge score={o.fitScore} />
                  </div>
                  <p className="text-xs text-surface-400 mb-2">{o.description}</p>
                  <p className="text-[11px] text-surface-500 italic">{o.reasoning}</p>
                  {o.estimatedIncome != null && (
                    <p className="text-[11px] text-emerald-300 mt-1 font-mono">Est. income: {fmtUsd(o.estimatedIncome)}</p>
                  )}
                  {o.maxRiskPerContract != null && (
                    <p className="text-[11px] text-red-300 mt-1 font-mono">Max risk/contract: {fmtUsd(o.maxRiskPerContract)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* === STRATEGY EVALUATOR === */}
      <div>
        <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Zap size={14} className="text-brand-400" /> Strategy Evaluator
        </h3>
        <StrategyEvaluatorPanel riskTolerance={risk} accountValue={accountValue} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Strategy Evaluator Panel
// ────────────────────────────────────────────────────────────
function makeLeg(overrides = {}) {
  return {
    kind: 'call', side: 'long', quantity: 1,
    strike: 100, premium: 2.50, iv: 0.30, dte: 30, entryPrice: 100,
    ...overrides,
  };
}

function StrategyEvaluatorPanel({ riskTolerance, accountValue }) {
  const [spotPrice, setSpotPrice] = useState(100);
  const [legs, setLegs] = useState([
    makeLeg({ kind: 'call', side: 'long',  strike: 105, premium: 2.50 }),
    makeLeg({ kind: 'call', side: 'short', strike: 110, premium: 1.00 }),
  ]);

  const updateLeg = (i, key, val) => setLegs(prev => prev.map((l, idx) => idx === i ? { ...l, [key]: val } : l));
  const addLeg = (kind = 'call') => setLegs(prev => [...prev, makeLeg({ kind })]);
  const removeLeg = (i) => setLegs(prev => prev.filter((_, idx) => idx !== i));

  const result = useMemo(() => evaluateStrategy({
    legs, spotPrice, riskTolerance, accountValue,
  }), [legs, spotPrice, riskTolerance, accountValue]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
      {/* Builder */}
      <Card title="Build Strategy" icon={Layers} className="lg:col-span-3">
        <div className="flex items-center gap-3 mb-3">
          <label className="text-xs text-surface-400">Underlying Spot:</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-surface-500 text-xs">$</span>
            <input type="number" value={spotPrice} onChange={(e) => setSpotPrice(+e.target.value)}
              className="w-24 bg-surface-800 border border-surface-700 rounded pl-6 pr-2 py-1 text-xs" step={0.01} />
          </div>
          <div className="flex gap-1 ml-auto">
            <button onClick={() => addLeg('stock')} className="text-[10px] px-2 py-1 bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30">+ Stock</button>
            <button onClick={() => addLeg('call')} className="text-[10px] px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded hover:bg-emerald-500/30">+ Call</button>
            <button onClick={() => addLeg('put')} className="text-[10px] px-2 py-1 bg-red-500/20 text-red-300 rounded hover:bg-red-500/30">+ Put</button>
          </div>
        </div>

        <div className="space-y-1.5">
          {legs.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-1.5 items-center text-xs">
              <select value={l.side} onChange={(e) => updateLeg(i, 'side', e.target.value)}
                className={`col-span-2 bg-surface-800 border rounded px-1.5 py-1 ${l.side === 'long' ? 'border-emerald-500/30 text-emerald-300' : 'border-red-500/30 text-red-300'}`}>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
              <select value={l.kind} onChange={(e) => updateLeg(i, 'kind', e.target.value)}
                className="col-span-2 bg-surface-800 border border-surface-700 rounded px-1.5 py-1">
                <option value="stock">Stock</option>
                <option value="call">Call</option>
                <option value="put">Put</option>
              </select>
              <input type="number" value={l.quantity} onChange={(e) => updateLeg(i, 'quantity', +e.target.value)}
                placeholder="Qty" className="col-span-1 bg-surface-800 border border-surface-700 rounded px-1.5 py-1" />
              {l.kind === 'stock' ? (
                <>
                  <input type="number" step={0.01} value={l.entryPrice} onChange={(e) => updateLeg(i, 'entryPrice', +e.target.value)}
                    placeholder="Entry" className="col-span-2 bg-surface-800 border border-surface-700 rounded px-1.5 py-1" />
                  <div className="col-span-4 text-surface-600 text-[10px] italic px-2">per-share cost basis</div>
                </>
              ) : (
                <>
                  <input type="number" step={0.5} value={l.strike} onChange={(e) => updateLeg(i, 'strike', +e.target.value)}
                    placeholder="Strike" className="col-span-2 bg-surface-800 border border-surface-700 rounded px-1.5 py-1" />
                  <input type="number" step={0.01} value={l.premium} onChange={(e) => updateLeg(i, 'premium', +e.target.value)}
                    placeholder="Premium" className="col-span-1 bg-surface-800 border border-surface-700 rounded px-1.5 py-1" />
                  <input type="number" step={0.01} value={l.iv} onChange={(e) => updateLeg(i, 'iv', +e.target.value)}
                    placeholder="IV" className="col-span-1 bg-surface-800 border border-surface-700 rounded px-1.5 py-1" title="IV (e.g. 0.30 = 30%)" />
                  <input type="number" value={l.dte} onChange={(e) => updateLeg(i, 'dte', +e.target.value)}
                    placeholder="DTE" className="col-span-1 bg-surface-800 border border-surface-700 rounded px-1.5 py-1" />
                </>
              )}
              <button onClick={() => removeLeg(i)} className="col-span-1 text-red-400 hover:text-red-300 flex justify-center"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>

        {/* Payoff chart */}
        {result.valid && result.payoffCurve.length > 0 && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wider text-surface-500 mb-2">Payoff at Expiry</p>
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={result.payoffCurve} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="price" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v.toFixed(0)}`} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0)} />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                    formatter={(v) => fmtUsdSigned(v)}
                    labelFormatter={(v) => `Price: $${v.toFixed(2)}`}
                  />
                  <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
                  <ReferenceLine x={spotPrice} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: 'Spot', fill: '#fbbf24', fontSize: 10 }} />
                  <Line type="monotone" dataKey="pnl" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Card>

      {/* Results */}
      <Card title="Evaluation" icon={Target} className="lg:col-span-2">
        {!result.valid ? (
          <p className="text-xs text-red-400">{result.error}</p>
        ) : (
          <div className="space-y-3">
            {/* Fit score */}
            <div className={`rounded-lg p-3 border ${
              result.fitColor === 'green'  ? 'bg-emerald-500/10 border-emerald-500/30' :
              result.fitColor === 'yellow' ? 'bg-yellow-500/10  border-yellow-500/30' :
                                              'bg-red-500/10     border-red-500/30'
            }`}>
              <p className="text-[10px] uppercase tracking-wider opacity-70">Fit Score</p>
              <p className="text-2xl font-bold">{result.fitScore}/100</p>
              <p className="text-[10px] opacity-70 mt-0.5">
                {result.fitColor === 'green' ? 'Strong fit for your profile' :
                 result.fitColor === 'yellow' ? 'Acceptable — review risk' :
                 'Misfit — too risky for your profile'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Net Cost" value={`${result.isDebit ? '-' : '+'}${fmtUsd(Math.abs(result.netCost))}`} tone={result.isDebit ? 'text-red-300' : 'text-emerald-300'} />
              <Stat label="Max Profit" value={fmtUsd(result.maxProfit)} tone="text-emerald-300" />
              <Stat label="Max Loss"   value={fmtUsd(result.maxLoss)}   tone="text-red-300" />
              <Stat label="PoP" value={result.probabilityOfProfit != null ? fmtPct(result.probabilityOfProfit) : '—'} tone="text-blue-300" />
            </div>

            {result.breakevens.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-surface-500">Breakevens</p>
                <p className="text-sm font-mono">{result.breakevens.map(b => `$${b.toFixed(2)}`).join('  ·  ')}</p>
              </div>
            )}

            <div>
              <p className="text-[10px] uppercase tracking-wider text-surface-500 mb-1">Greeks (aggregate)</p>
              <div className="grid grid-cols-4 gap-1.5 text-[11px] font-mono">
                <div className="bg-surface-800 rounded p-1.5 text-center"><span className="text-surface-500">Δ</span><br/>{result.greeks.delta}</div>
                <div className="bg-surface-800 rounded p-1.5 text-center"><span className="text-surface-500">Γ</span><br/>{result.greeks.gamma}</div>
                <div className="bg-surface-800 rounded p-1.5 text-center"><span className="text-surface-500">Θ</span><br/>{result.greeks.theta}</div>
                <div className="bg-surface-800 rounded p-1.5 text-center"><span className="text-surface-500">V</span><br/>{result.greeks.vega}</div>
              </div>
            </div>

            <div className="border-t border-surface-800 pt-3">
              <p className="text-[10px] uppercase tracking-wider text-surface-500">Position Sizing</p>
              {result.sizing.contracts != null ? (
                <>
                  <p className="text-sm">
                    <span className="text-brand-300 font-bold">{result.sizing.contracts}</span> contract(s) max
                  </p>
                  <p className="text-[11px] text-surface-400">
                    Dollars at risk: <span className="text-red-300 font-mono">{fmtUsd(result.sizing.dollarsAtRisk)}</span> / budget {fmtUsd(result.sizing.maxRiskBudget)}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-yellow-300">{result.sizing.note}</p>
              )}
              <p className="text-[10px] text-surface-600 mt-1">{result.sizing.note}</p>
            </div>
          </div>
        )}
      </Card>

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol="SPY" title="SPY — 12-Week Brokerage Benchmark Trend" color="#f59e0b" />
    </div>
  );
}

function Stat({ label, value, tone = 'text-gray-200' }) {
  return (
    <div className="bg-surface-800/50 rounded-lg p-2">
      <p className="text-[10px] text-surface-500 uppercase tracking-wider">{label}</p>
      <p className={`font-mono font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
