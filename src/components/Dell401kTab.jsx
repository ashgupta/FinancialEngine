import React, { useState, useMemo, useEffect } from 'react';
import { Briefcase, TrendingUp, TrendingDown, PieChart as PieIcon, DollarSign, Activity } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { DELL_K401_FUNDS, DELL_ETF_PROXY_MAP, ASSET_CLASS_LABELS } from '../engine/fundUniverse.js';
import { fetchHistory } from '../engine/marketData.js';
import WeeklyTrendView from './WeeklyTrendView';

const CLASS_COLORS = {
  us_equity:   '#3b82f6', intl_equity: '#8b5cf6', us_bonds:    '#22c55e',
  intl_bonds:  '#06b6d4', tips:        '#14b8a6', real_estate: '#f59e0b',
  commodities: '#ef4444', cash:        '#94a3b8',
};

const fmtUsd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
const fmtUsd2 = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0);
const fmtPct = (n) => `${(n * 100).toFixed(2)}%`;
const fmtBps = (n) => `${(n * 10000).toFixed(1)} bps`;

function Card({ children, className = '' }) {
  return <div className={`bg-[#111114] border border-surface-800 rounded-xl p-5 ${className}`}>{children}</div>;
}

export default function Dell401kTab() {
  const [funds] = useState(DELL_K401_FUNDS);
  const [weeklyData, setWeeklyData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const heldFunds = useMemo(() => funds.filter(f => f.currentBalance > 0), [funds]);
  const totalBalance = useMemo(() => heldFunds.reduce((s, f) => s + (f.currentBalance || 0), 0), [heldFunds]);

  const pieData = heldFunds.map(f => ({
    name: f.ticker, value: f.currentBalance, color: CLASS_COLORS[f.assetClass] ?? '#6b7280', fund: f,
  }));

  const totalExpenseDrag = useMemo(() =>
    heldFunds.reduce((s, f) => s + (f.currentBalance || 0) * f.expenseRatio, 0),
    [heldFunds]
  );

  const weightedExpenseRatio = totalBalance > 0 ? totalExpenseDrag / totalBalance : 0;

  // Group by asset class for summary
  const byClass = useMemo(() => {
    const map = {};
    for (const f of funds) {
      if (!map[f.assetClass]) map[f.assetClass] = { label: ASSET_CLASS_LABELS[f.assetClass] ?? f.assetClass, funds: [], balance: 0 };
      map[f.assetClass].funds.push(f);
      map[f.assetClass].balance += f.currentBalance || 0;
    }
    return Object.values(map).sort((a, b) => b.balance - a.balance);
  }, [funds]);

  // Fetch weekly history for each held fund's ETF proxy
  useEffect(() => {
    let cancelled = false;
    async function loadWeekly() {
      setLoading(true);
      setError(null);
      const proxies = {};
      for (const f of heldFunds) {
        const etf = DELL_ETF_PROXY_MAP[f.id];
        if (!etf) continue;
        if (proxies[etf]) continue; // already fetching
        try {
          const resp = await fetchHistory(etf, '3mo', '1wk');
          if (resp && resp.closes && resp.closes.length >= 2) {
            proxies[etf] = {
              closes: resp.closes,
              dates: resp.dates,
              fetchedAt: resp.fetchedAt || new Date().toISOString(),
            };
          }
        } catch (e) {
          // per-fund error, continue
        }
      }
      if (!cancelled) {
        setWeeklyData(proxies);
        setLoading(false);
      }
    }
    loadWeekly();
    return () => { cancelled = true; };
  }, []);

  // Compute weekly change per held fund
  const fundWeeklyChanges = useMemo(() => {
    const results = [];
    for (const f of heldFunds) {
      const etf = DELL_ETF_PROXY_MAP[f.id];
      const data = etf ? weeklyData[etf] : null;
      if (!data || data.closes.length < 2) {
        results.push({ fund: f, etf, weeklyChange: null, twelveWkChange: null, lastPrice: null, estChange: null });
        continue;
      }
      const closes = data.closes;
      const last = closes[closes.length - 1];
      const prev = closes[closes.length - 2];
      const weeklyChange = prev > 0 ? (last - prev) / prev : 0;
      const twelveWkAgo = closes.length >= 12 ? closes[closes.length - 13] : closes[0];
      const twelveWkChange = twelveWkAgo > 0 ? (last - twelveWkAgo) / twelveWkAgo : 0;
      const estChange = (f.currentBalance || 0) * weeklyChange;
      results.push({ fund: f, etf, weeklyChange, twelveWkChange, lastPrice: last, estChange });
    }
    return results;
  }, [heldFunds, weeklyData]);

  const totalEstChange = useMemo(() =>
    fundWeeklyChanges.reduce((s, r) => s + (r.estChange || 0), 0),
    [fundWeeklyChanges]
  );

  const totalEstPct = totalBalance > 0 ? totalEstChange / totalBalance : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Briefcase size={20} className="text-brand-400" />
          <h2 className="text-xl font-bold">Dell 401(k) — Fidelity NetBenefits</h2>
        </div>
        <p className="text-surface-400 text-sm ml-8">
          Your Dell Technologies 401(k) plan menu, current holdings, and weekly price-change tracking via underlying ETFs.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <label className="text-xs uppercase tracking-wider text-surface-500">Total Balance</label>
          <p className="text-2xl font-bold text-brand-300 mt-1">{fmtUsd(totalBalance)}</p>
        </Card>
        <Card>
          <label className="text-xs uppercase tracking-wider text-surface-500">Funds Held</label>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{heldFunds.length}</p>
          <p className="text-[10px] text-surface-600">of {funds.length} available</p>
        </Card>
        <Card>
          <label className="text-xs uppercase tracking-wider text-surface-500">Weighted Expense Ratio</label>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{fmtBps(weightedExpenseRatio)}</p>
        </Card>
        <Card>
          <label className="text-xs uppercase tracking-wider text-surface-500">Annual Fee Drag</label>
          <p className="text-2xl font-bold text-red-400 mt-1">{fmtUsd(totalExpenseDrag)}</p>
          <p className="text-[10px] text-surface-600">/year at current balances</p>
        </Card>
      </div>

      {/* Weekly change summary */}
      <Card className={totalEstChange >= 0 ? 'border-emerald-500/20' : 'border-red-500/20'}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity size={18} className={totalEstChange >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            <div>
              <h3 className="font-semibold">Weekly Portfolio Change (ETF Proxy)</h3>
              <p className="text-[10px] text-surface-500 mt-0.5">
                Estimated based on underlying ETF weekly price movements. Not actual fund NAV.
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-2xl font-bold ${totalEstChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalEstChange >= 0 ? '+' : ''}{fmtUsd(totalEstChange)}
            </p>
            <p className={`text-sm ${totalEstPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalEstPct >= 0 ? '+' : ''}{fmtPct(totalEstPct)}
            </p>
          </div>
        </div>
        {loading && <p className="text-xs text-surface-500 mt-2">Loading weekly data…</p>}
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </Card>

      {/* Pie + Current Holdings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold mb-3 flex items-center gap-2"><PieIcon size={16} className="text-brand-400" /> Current Allocation</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtUsd(v)} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-3 flex items-center gap-2"><DollarSign size={16} className="text-brand-400" /> Current Holdings with Weekly Tracking</h3>
          <div className="space-y-2">
            {fundWeeklyChanges.map(({ fund: f, etf, weeklyChange, twelveWkChange, lastPrice, estChange }) => {
              const pct = totalBalance > 0 ? f.currentBalance / totalBalance : 0;
              const hasData = weeklyChange !== null;
              return (
                <div key={f.id} className="flex justify-between items-center py-1.5 border-b border-surface-800/50 last:border-b-0">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CLASS_COLORS[f.assetClass] }} />
                    <div className="min-w-0">
                      <p className="font-mono text-sm text-brand-300">{f.ticker} <span className="text-surface-600 text-[10px]">→ {etf || 'N/A'}</span></p>
                      <p className="text-[10px] text-surface-500 truncate">{f.name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">{fmtUsd(f.currentBalance)}</p>
                    <div className="flex items-center gap-2 justify-end">
                      {hasData ? (
                        <>
                          <span className={`text-[10px] flex items-center gap-0.5 ${weeklyChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {weeklyChange >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            {weeklyChange >= 0 ? '+' : ''}{fmtPct(weeklyChange)}
                          </span>
                          <span className={`text-[10px] ${estChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {estChange >= 0 ? '+' : ''}{fmtUsd(estChange)}
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-surface-600">{loading ? '…' : 'N/A'}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Weekly price detail table */}
      <Card>
        <h3 className="font-semibold mb-3 flex items-center gap-2"><TrendingUp size={16} className="text-brand-400" /> Weekly Price Tracking (ETF Proxies)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-surface-500 uppercase tracking-wider">
              <tr className="border-b border-surface-800">
                <th className="text-left py-2 pr-3">Fund</th>
                <th className="text-left py-2 pr-3">ETF Proxy</th>
                <th className="text-right py-2 pr-3">ETF Price</th>
                <th className="text-right py-2 pr-3">Weekly Δ</th>
                <th className="text-right py-2 pr-3">12-Wk Δ</th>
                <th className="text-right py-2 pr-3">Balance</th>
                <th className="text-right py-2 pr-3">Est. $ Change</th>
              </tr>
            </thead>
            <tbody>
              {fundWeeklyChanges.map(({ fund: f, etf, weeklyChange, twelveWkChange, lastPrice, estChange }) => {
                const hasData = weeklyChange !== null;
                return (
                  <tr key={f.id} className="border-b border-surface-800/50">
                    <td className="py-1.5 pr-3 font-mono text-xs text-brand-300">{f.ticker}</td>
                    <td className="py-1.5 pr-3 text-xs">{etf || '—'}</td>
                    <td className="py-1.5 pr-3 text-right text-xs">{hasData ? fmtUsd2(lastPrice) : '—'}</td>
                    <td className={`py-1.5 pr-3 text-right text-xs ${hasData ? (weeklyChange >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-surface-600'}`}>
                      {hasData ? `${weeklyChange >= 0 ? '+' : ''}${fmtPct(weeklyChange)}` : '—'}
                    </td>
                    <td className={`py-1.5 pr-3 text-right text-xs ${hasData ? (twelveWkChange >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-surface-600'}`}>
                      {hasData ? `${twelveWkChange >= 0 ? '+' : ''}${fmtPct(twelveWkChange)}` : '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-xs font-semibold">{fmtUsd(f.currentBalance)}</td>
                    <td className={`py-1.5 pr-3 text-right text-xs font-semibold ${hasData ? (estChange >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-surface-600'}`}>
                      {hasData ? `${estChange >= 0 ? '+' : ''}${fmtUsd(estChange)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {totalEstChange !== 0 && (
              <tfoot>
                <tr className="border-t border-surface-700">
                  <td colSpan={6} className="py-2 pr-3 text-right text-xs font-bold text-surface-400">Total Estimated Change</td>
                  <td className={`py-2 pr-3 text-right text-xs font-bold ${totalEstChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalEstChange >= 0 ? '+' : ''}{fmtUsd(totalEstChange)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* 12-week trend view (SPY benchmark) */}
      <WeeklyTrendView symbol="SPY" title="SPY — 12-Week S&P 500 Benchmark Trend" color="#3b82f6" />

      {/* Full fund menu by asset class */}
      <Card>
        <h3 className="font-semibold mb-3 flex items-center gap-2"><TrendingUp size={16} className="text-brand-400" /> Full Plan Menu ({funds.length} funds)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-surface-500 uppercase tracking-wider">
              <tr className="border-b border-surface-800">
                <th className="text-left py-2 pr-3">Ticker</th>
                <th className="text-left py-2 pr-3">Fund Name</th>
                <th className="text-left py-2 pr-3">Asset Class</th>
                <th className="text-right py-2 pr-3">Expense</th>
                <th className="text-right py-2 pr-3">Balance</th>
                <th className="text-right py-2 pr-3">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {byClass.map(group => (
                <React.Fragment key={group.label}>
                  {group.funds.map((f, i) => {
                    const pct = totalBalance > 0 ? (f.currentBalance || 0) / totalBalance : 0;
                    const isHeld = f.currentBalance > 0;
                    return (
                      <tr key={f.id ?? i} className={`border-b border-surface-800/50 ${isHeld ? '' : 'opacity-50'}`}>
                        <td className="py-1.5 pr-3 font-mono text-xs text-brand-300">{f.ticker}</td>
                        <td className="py-1.5 pr-3 text-xs">{f.name}</td>
                        <td className="py-1.5 pr-3 text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: CLASS_COLORS[f.assetClass] }} />
                            {group.label}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-right text-xs">{fmtBps(f.expenseRatio)}</td>
                        <td className="py-1.5 pr-3 text-right text-xs font-semibold">{isHeld ? fmtUsd(f.currentBalance) : '—'}</td>
                        <td className="py-1.5 pr-3 text-right text-xs text-surface-500">{isHeld ? fmtPct(pct) : '—'}</td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

