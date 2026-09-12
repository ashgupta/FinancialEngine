import React, { useState, useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import {
  TrendingUp, Flame, Calculator, Target, AlertTriangle, Sparkles,
  Zap, PiggyBank, DollarSign, Percent, Clock, BarChart3,
} from 'lucide-react';
import { runMonteCarlo } from '../engine/monteCarlo';
import { calculateFIRE, savingsRate as calcSavingsRate } from '../engine/fire';
import { compareDebtStrategies } from '../engine/debt';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

const fmt = (n) => {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};
const pct = (n) => `${(n * 100).toFixed(1)}%`;

function Card({ children, className = '' }) {
  return <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-6 ${className}`}>{children}</div>;
}

function StatCard({ label, value, sub, icon: Icon, color = 'text-brand-400' }) {
  return (
    <Card className="flex items-start gap-4">
      <div className={`p-3 rounded-xl bg-surface-800 ${color}`}><Icon size={22} /></div>
      <div>
        <p className="text-surface-400 text-sm">{label}</p>
        <p className="text-2xl font-bold mt-0.5">{value}</p>
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
        <p key={i} style={{ color: p.color || p.stroke }} className="font-medium">
          {p.name}: {formatter ? formatter(p.value) : typeof p.value === 'number' ? fmt(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

const SUB_VIEWS = [
  { id: 'montecarlo', label: 'Monte Carlo', icon: TrendingUp },
  { id: 'fire', label: 'FIRE', icon: Flame },
  { id: 'debt', label: 'Debt Payoff', icon: Calculator },
];

export default function ProjectionsTab({
  age, income, expenses, currentSavings, annualSavings, horizon,
  effectiveReturn, effectiveVol, livePortfolioMetrics,
  debts, extraDebtPayment,
}) {
  const [subView, setSubView] = useState('montecarlo');

  const monteCarlo = useMemo(() => runMonteCarlo({
    initialWealth: currentSavings,
    annualContribution: annualSavings,
    expectedReturn: effectiveReturn,
    volatility: effectiveVol,
    years: horizon,
    simulations: 2000,
  }), [currentSavings, annualSavings, effectiveReturn, effectiveVol, horizon]);

  const fire = useMemo(() => calculateFIRE({
    currentAge: age,
    annualExpenses: expenses,
    currentSavings,
    annualSavings,
    realReturn: effectiveReturn,
  }), [age, expenses, currentSavings, annualSavings, effectiveReturn]);

  const debtComparison = useMemo(() => compareDebtStrategies(debts, extraDebtPayment), [debts, extraDebtPayment]);
  const savingsRatePct = calcSavingsRate(income, annualSavings);

  const mcData = useMemo(() => {
    return monteCarlo.percentiles.p50.map((_, i) => ({
      year: i, age: age + i,
      p10: monteCarlo.percentiles.p10[i],
      p25: monteCarlo.percentiles.p25[i],
      p50: monteCarlo.percentiles.p50[i],
      p75: monteCarlo.percentiles.p75[i],
      p90: monteCarlo.percentiles.p90[i],
      mean: monteCarlo.mean[i],
    }));
  }, [monteCarlo, age]);

  // ─── Monte Carlo View ─────────────────────────────────
  const renderMonteCarlo = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2"><TrendingUp size={20} className="text-brand-400" /> Monte Carlo Wealth Projection</h2>
        <p className="text-surface-400 text-sm mt-1">
          {2000} simulations · Expected return: {pct(effectiveReturn)} · Volatility: {pct(effectiveVol)} · Inflation-adjusted{livePortfolioMetrics ? ' · Using live market data' : ''}
        </p>
        {livePortfolioMetrics && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-medium mt-2">
            <Zap size={10} className="animate-pulse" /> Powered by live 1-year trailing data
          </span>
        )}
      </div>

      <SectionTimestamp fetchedAt={new Date()} label="Monte Carlo Projection" />

      <Card>
        <div className="h-96">
          <ResponsiveContainer>
            <AreaChart data={mcData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <defs>
                <linearGradient id="fan2Outer" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="fan2Inner" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="age" stroke="#64748b" tick={{ fontSize: 12 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 12 }} tickFormatter={fmt} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Area type="monotone" dataKey="p10" stroke="#8b5cf650" fill="url(#fan2Outer)" name="10th %ile" />
              <Area type="monotone" dataKey="p25" stroke="#8b5cf680" fill="url(#fan2Inner)" name="25th %ile" />
              <Area type="monotone" dataKey="p75" stroke="#8b5cf680" fill="url(#fan2Inner)" name="75th %ile" />
              <Area type="monotone" dataKey="p90" stroke="#8b5cf650" fill="url(#fan2Outer)" name="90th %ile" />
              <Line type="monotone" dataKey="p50" stroke="#8b5cf6" strokeWidth={3} dot={false} name="Median" />
              <Line type="monotone" dataKey="mean" stroke="#22c55e" strokeWidth={2} strokeDasharray="6 3" dot={false} name="Mean" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={AlertTriangle} label="Worst Case (P10)" value={fmt(monteCarlo.percentiles.p10[horizon])} sub="Bottom 10% outcome" color="text-red-400" />
        <StatCard icon={TrendingUp} label="Median (P50)" value={fmt(monteCarlo.percentiles.p50[horizon])} sub="Most likely outcome" color="text-blue-400" />
        <StatCard icon={Sparkles} label="Best Case (P90)" value={fmt(monteCarlo.percentiles.p90[horizon])} sub="Top 10% outcome" color="text-purple-400" />
      </div>

      <Card>
        <h3 className="font-semibold mb-3">Outcome Distribution at Year {horizon}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 text-center text-sm">
          {[['P10', monteCarlo.percentiles.p10[horizon], 'text-red-400'],
            ['P25', monteCarlo.percentiles.p25[horizon], 'text-orange-400'],
            ['P50', monteCarlo.percentiles.p50[horizon], 'text-blue-400'],
            ['P75', monteCarlo.percentiles.p75[horizon], 'text-emerald-400'],
            ['P90', monteCarlo.percentiles.p90[horizon], 'text-purple-400']].map(([label, val, color]) => (
            <div key={label} className="bg-surface-800 rounded-xl p-4">
              <p className="text-surface-500 text-xs">{label}</p>
              <p className={`text-lg font-bold ${color}`}>{fmt(val)}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  // ─── FIRE View ────────────────────────────────────────
  const renderFIRE = () => {
    const fireData = fire.yearByYear;
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Flame size={20} className="text-orange-400" /> FIRE Analysis</h2>
          <p className="text-surface-400 text-sm mt-1">Financial Independence, Retire Early — based on 4% safe withdrawal rate (Trinity Study)</p>
        </div>

        <SectionTimestamp fetchedAt={new Date()} label="FIRE Analysis" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Target} label="FIRE Number" value={fmt(fire.fireNumber)} sub={`${expenses.toLocaleString()}/yr ÷ 4%`} color="text-orange-400" />
          <StatCard icon={Flame} label="FIRE Age" value={fire.fireAge ?? '—'} sub={fire.fireAge ? `In ${fire.fireAge - age} years` : 'Adjust inputs'} color="text-red-400" />
          <StatCard icon={Clock} label="Coast FIRE Age" value={fire.coastFireAge ?? '—'} sub={fire.coastFireAge ? `Need ${fmt(fire.coastFireNumber)} by then` : '—'} color="text-cyan-400" />
          <StatCard icon={Percent} label="Savings Rate" value={`${savingsRatePct}%`} sub={savingsRatePct >= 50 ? 'Aggressive FIRE pace' : 'Increase for earlier FIRE'} color="text-emerald-400" />
        </div>

        <Card>
          <h3 className="font-semibold mb-4">Path to Financial Independence</h3>
          <div className="h-80">
            <ResponsiveContainer>
              <AreaChart data={fireData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <defs>
                  <linearGradient id="fireGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="age" stroke="#64748b" tick={{ fontSize: 12 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 12 }} tickFormatter={fmt} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="balance" stroke="#f97316" strokeWidth={2.5} fill="url(#fireGrad)" name="Portfolio" />
                <Line type="monotone" dataKey="fireNumber" stroke="#ef4444" strokeWidth={2} strokeDasharray="8 4" dot={false} name="FIRE Number" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-3">FIRE Progress</h3>
          <div className="w-full bg-surface-800 rounded-full h-6 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-red-500 transition-all duration-700 flex items-center justify-end pr-2"
              style={{ width: `${Math.min(100, (currentSavings / fire.fireNumber) * 100)}%` }}
            >
              <span className="text-xs font-bold">{((currentSavings / fire.fireNumber) * 100).toFixed(1)}%</span>
            </div>
          </div>
          <p className="text-surface-400 text-sm mt-2">{fmt(currentSavings)} of {fmt(fire.fireNumber)} FIRE number reached</p>
        </Card>
      </div>
    );
  };

  // ─── Debt View ────────────────────────────────────────
  const renderDebt = () => {
    const savingsVsAvalanche = debtComparison.snowball.totalInterest - debtComparison.avalanche.totalInterest;
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Calculator size={20} className="text-brand-400" /> Debt Payoff Optimizer</h2>
          <p className="text-surface-400 text-sm mt-1">Avalanche (highest rate first) vs Snowball (smallest balance first)</p>
        </div>

        <SectionTimestamp fetchedAt={new Date()} label="Debt Payoff" />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={Zap} label="Avalanche" value={`${debtComparison.avalanche.months} mo`} sub={`Total interest: ${fmt(debtComparison.avalanche.totalInterest)}`} color="text-blue-400" />
          <StatCard icon={PiggyBank} label="Snowball" value={`${debtComparison.snowball.months} mo`} sub={`Total interest: ${fmt(debtComparison.snowball.totalInterest)}`} color="text-purple-400" />
          <StatCard icon={DollarSign} label="Avalanche Saves" value={fmt(savingsVsAvalanche)} sub="Less interest paid" color="text-emerald-400" />
        </div>

        <Card>
          <h3 className="font-semibold mb-4">Debt Payoff Timeline</h3>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#64748b" tick={{ fontSize: 12 }} type="number" domain={[0, 'auto']} label={{ value: 'Months', position: 'insideBottom', offset: -2, fill: '#94a3b8' }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 12 }} tickFormatter={fmt} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line data={debtComparison.avalanche.schedule} type="monotone" dataKey="totalRemaining" stroke="#3b82f6" strokeWidth={2} dot={false} name="Avalanche" />
                <Line data={debtComparison.snowball.schedule} type="monotone" dataKey="totalRemaining" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Snowball" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-3">Your Debts</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-700 text-surface-400 text-left">
                  <th className="pb-2">Name</th><th className="pb-2">Balance</th><th className="pb-2">APR</th><th className="pb-2">Minimum</th>
                </tr>
              </thead>
              <tbody>
                {debts.map((d, i) => (
                  <tr key={i} className="border-b border-surface-800">
                    <td className="py-2.5">{d.name}</td>
                    <td className="py-2.5">{fmt(d.balance)}</td>
                    <td className="py-2.5 text-red-400">{(d.rate * 100).toFixed(1)}%</td>
                    <td className="py-2.5">{fmt(d.minimum)}/mo</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-surface-500 text-xs mt-3">Extra monthly payment: {fmt(extraDebtPayment)}/mo — adjust in the sidebar.</p>
        </Card>
      </div>
    );
  };

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

      {subView === 'montecarlo' && renderMonteCarlo()}
      {subView === 'fire' && renderFIRE()}
      {subView === 'debt' && renderDebt()}

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol="SPY" title="SPY — 12-Week Market Trend" color="#8b5cf6" />

      <p className="text-[11px] text-surface-600 leading-relaxed">
        Educational projections only — not financial advice. Monte Carlo simulations are based on historical averages and mathematical models. Past performance does not guarantee future results.
      </p>
    </div>
  );
}
