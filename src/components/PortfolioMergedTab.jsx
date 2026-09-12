import React, { useState, useMemo } from 'react';
import {
  PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { PieChart as PieIcon, Upload, TrendingUp } from 'lucide-react';
import { getRecommendedAllocation, getEfficientFrontier } from '../engine/portfolio';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';
import PortfolioTab from './PortfolioTab';

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const fmt = (n) => {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};

function Card({ children, className = '' }) {
  return <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>{children}</div>;
}

const SUB_VIEWS = [
  { id: 'allocation', label: 'Allocation', icon: PieIcon },
  { id: 'holdings', label: 'My Holdings', icon: Upload },
];

export default function PortfolioMergedTab({ riskTolerance, marketSnapshot, useLiveData }) {
  const [subView, setSubView] = useState('allocation');

  const portfolio = useMemo(() => getRecommendedAllocation(riskTolerance), [riskTolerance]);
  const frontier = useMemo(() => getEfficientFrontier(), []);

  const livePortfolioMetrics = useMemo(() => {
    if (!useLiveData || !marketSnapshot?.etfs?.length) return null;
    const alloc = portfolio.allocation;
    let weightedReturn = 0, totalWeight = 0, hasData = false;
    for (const a of alloc) {
      const etf = marketSnapshot.etfs.find((e) => e.symbol === a.ticker);
      if (etf?.trailingReturn != null && etf?.trailingVol != null) {
        weightedReturn += a.weight * etf.trailingReturn;
        totalWeight += a.weight;
        hasData = true;
      }
    }
    if (!hasData) return null;
    let weightedVol = 0;
    for (const a of alloc) {
      const etf = marketSnapshot.etfs.find((e) => e.symbol === a.ticker);
      if (etf?.trailingVol != null) weightedVol += a.weight * etf.trailingVol;
    }
    return { expectedReturn: weightedReturn, volatility: weightedVol };
  }, [useLiveData, marketSnapshot, portfolio.allocation]);

  // ─── Allocation View ──────────────────────────────────
  const renderAllocation = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2"><PieIcon size={20} className="text-brand-400" /> Portfolio Allocation</h2>
        <p className="text-surface-400 text-sm mt-1">
          Risk tolerance: {riskTolerance}/10 · Sharpe ratio: {portfolio.sharpe.toFixed(3)} · Mean-variance optimized{livePortfolioMetrics ? ' · Live trailing data active' : ''}
        </p>
      </div>

      <SectionTimestamp fetchedAt={new Date()} label="Portfolio Allocation" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="font-semibold mb-4">Recommended Allocation</h3>
          <div className="h-72 flex items-center justify-center">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={portfolio.allocation} dataKey="weight" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={110} paddingAngle={2} stroke="none">
                  {portfolio.allocation.map((a) => <Cell key={a.id} fill={a.color} />)}
                </Pie>
                <Tooltip formatter={(v) => pct(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            {portfolio.allocation.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="text-surface-300">{a.name}</span>
                <span className="ml-auto font-medium">{pct(a.weight)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-4">Efficient Frontier</h3>
          <div className="h-72">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="volatility" name="Volatility %" stroke="#64748b" tick={{ fontSize: 12 }} label={{ value: 'Volatility (%)', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 12 }} />
                <YAxis dataKey="expectedReturn" name="Return %" stroke="#64748b" tick={{ fontSize: 12 }} label={{ value: 'Return (%)', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-surface-800 border border-surface-700 rounded-lg px-4 py-3 shadow-xl text-sm">
                        <p className="text-brand-400 font-semibold">Risk Level {d.risk}</p>
                        <p className="text-surface-300">Return: {d.expectedReturn}%</p>
                        <p className="text-surface-300">Volatility: {d.volatility}%</p>
                        <p className="text-surface-300">Sharpe: {d.sharpe}</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={frontier} fill="#8b5cf6">
                  {frontier.map((f) => <Cell key={f.risk} fill={f.risk === riskTolerance ? '#22c55e' : '#8b5cf6'} r={f.risk === riskTolerance ? 8 : 5} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center text-sm">
            <div className="bg-surface-800 rounded-lg p-3">
              <p className="text-surface-500 text-xs">Expected Return</p>
              <p className="text-lg font-bold text-blue-400">{pct(portfolio.expectedReturn)}</p>
            </div>
            <div className="bg-surface-800 rounded-lg p-3">
              <p className="text-surface-500 text-xs">Volatility</p>
              <p className="text-lg font-bold text-orange-400">{pct(portfolio.volatility)}</p>
            </div>
            <div className="bg-surface-800 rounded-lg p-3">
              <p className="text-surface-500 text-xs">Sharpe Ratio</p>
              <p className="text-lg font-bold text-emerald-400">{portfolio.sharpe.toFixed(3)}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="font-semibold mb-3">Suggested ETFs</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700 text-surface-400 text-left">
                <th className="pb-2">Asset Class</th><th className="pb-2">ETF</th><th className="pb-2">Price</th><th className="pb-2">Weight</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.allocation.map((a) => {
                const etf = marketSnapshot?.etfs?.find((e) => e.symbol === a.ticker);
                return (
                  <tr key={a.id} className="border-b border-surface-800">
                    <td className="py-2.5">{a.name}</td>
                    <td className="py-2.5 font-mono text-brand-400">{a.ticker}</td>
                    <td className="py-2.5">{etf?.price ? `$${etf.price.toFixed(2)}` : '—'}</td>
                    <td className="py-2.5 font-medium">{pct(a.weight)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Sub-view tabs */}
      <div className="flex gap-2 flex-wrap">
        {SUB_VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSubView(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition border ${subView === id ? 'bg-brand-500/15 text-brand-400 border-brand-500/30' : 'bg-surface-800/60 text-surface-400 hover:text-white border-transparent'}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {subView === 'allocation' && renderAllocation()}
      {subView === 'holdings' && <PortfolioTab />}

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol="SPY" title="SPY — 12-Week Portfolio Benchmark Trend" />

      <p className="text-[11px] text-surface-600 leading-relaxed">
        Educational analysis only — not financial advice. Allocation models are based on historical data and mean-variance optimization. Past performance does not guarantee future results.
      </p>
    </div>
  );
}
