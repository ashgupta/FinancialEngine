import React, { useState, useEffect, useMemo } from 'react';
import {
  Briefcase, Plus, Trash2, RotateCcw, AlertTriangle, Info, TrendingUp, PieChart as PieIcon,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { DELL_K401_FUNDS, ASSET_CLASS_OPTIONS, ASSET_CLASS_LABELS } from '../engine/fundUniverse.js';
import { buildK401Allocation } from '../engine/k401Planner.js';

const STORAGE_KEY = 'k401_fund_menu';
const CLASS_COLORS = {
  us_equity:   '#3b82f6', intl_equity: '#8b5cf6', us_bonds:    '#22c55e',
  intl_bonds:  '#06b6d4', tips:        '#14b8a6', real_estate: '#f59e0b',
  commodities: '#ef4444', cash:        '#94a3b8',
};

const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;
const fmtUsd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtBps = (n) => `${(n * 10000).toFixed(1)} bps`;

function loadMenu() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DELL_K401_FUNDS;
}

function saveMenu(menu) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(menu)); } catch { /* ignore */ }
}

function Card({ children, className = '' }) {
  return <div className={`bg-[#111114] border border-surface-800 rounded-xl p-5 ${className}`}>{children}</div>;
}

export default function K401PlanTab({ riskTolerance = 7, accountValue = 574000 }) {
  const [menu, setMenu] = useState(loadMenu);
  const [accountVal, setAccountVal] = useState(accountValue);
  const [risk, setRisk] = useState(riskTolerance);

  useEffect(() => { saveMenu(menu); }, [menu]);

  const plan = useMemo(() => buildK401Allocation(menu, risk), [menu, risk]);

  const addFund = () => setMenu(prev => [
    ...prev,
    { id: `custom_${Date.now()}`, ticker: '', name: '', assetClass: 'us_equity', expenseRatio: 0.001 },
  ]);

  const updateFund = (idx, key, val) => {
    setMenu(prev => prev.map((f, i) => i === idx ? { ...f, [key]: val } : f));
  };

  const removeFund = (idx) => setMenu(prev => prev.filter((_, i) => i !== idx));
  const resetDefaults = () => { if (confirm('Reset to default fund menu? Your customizations will be lost.')) setMenu(DELL_K401_FUNDS); };

  // Pie data
  const pieData = plan.allocation.map(a => ({
    name: a.ticker, value: a.weight, color: CLASS_COLORS[a.assetClass] ?? '#6b7280', fund: a,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Briefcase size={20} className="text-brand-400" />
          <h2 className="text-xl font-bold">401(k) Investment Plan</h2>
        </div>
        <p className="text-surface-400 text-sm ml-8">
          Edit your plan's fund menu below, set risk tolerance, and get a recommended allocation across YOUR available funds — lowest-cost per asset class.
        </p>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <label className="text-xs uppercase tracking-wider text-surface-500">Account Value</label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">$</span>
            <input
              type="number"
              value={accountVal}
              onChange={(e) => setAccountVal(+e.target.value)}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg py-2 pl-7 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            />
          </div>
        </Card>
        <Card>
          <label className="text-xs uppercase tracking-wider text-surface-500">Risk Tolerance: {risk}/10</label>
          <input type="range" min={1} max={10} value={risk} onChange={(e) => setRisk(+e.target.value)} className="w-full accent-brand-500 mt-1" />
          <div className="flex justify-between text-[10px] text-surface-600"><span>Conservative</span><span>Aggressive</span></div>
        </Card>
        <Card>
          <label className="text-xs uppercase tracking-wider text-surface-500">Weighted Expense Ratio</label>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{fmtBps(plan.weightedExpenseRatio)}</p>
          <p className="text-[10px] text-surface-600">Annual drag: {fmtUsd(plan.weightedExpenseRatio * accountVal)}</p>
        </Card>
      </div>

      {/* Substitution / missing-class warnings */}
      {(plan.substitutions.length > 0 || plan.missingClasses.length > 0) && (
        <Card className="border-yellow-500/20 bg-yellow-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-yellow-400 mt-0.5" />
            <div className="text-xs text-yellow-100/80">
              {plan.substitutions.length > 0 && (
                <p>
                  <strong>Substitutions:</strong>{' '}
                  {plan.substitutions.map(s => `${ASSET_CLASS_LABELS[s.from]} → ${ASSET_CLASS_LABELS[s.to]} (${fmtPct(s.weight)})`).join(', ')}
                </p>
              )}
              {plan.missingClasses.length > 0 && (
                <p className="mt-1">
                  <strong>Missing from menu (weight redistributed):</strong>{' '}
                  {plan.missingClasses.map(c => ASSET_CLASS_LABELS[c]).join(', ')}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Allocation pie + recommendation table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold mb-3 flex items-center gap-2"><PieIcon size={16} className="text-brand-400" /> Recommended Allocation</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtPct(v)} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-3 flex items-center gap-2"><TrendingUp size={16} className="text-brand-400" /> Buy Orders</h3>
          <div className="space-y-2">
            {plan.allocation.map(a => (
              <div key={a.ticker} className="flex justify-between items-center py-1.5 border-b border-surface-800/50 last:border-b-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CLASS_COLORS[a.assetClass] }} />
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-brand-300">{a.ticker}</p>
                    <p className="text-[10px] text-surface-500 truncate">{a.name}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm">{fmtPct(a.weight)}</p>
                  <p className="text-[10px] text-surface-500">{fmtUsd(a.weight * accountVal)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Fund menu editor */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Briefcase size={16} className="text-brand-400" /> Your 401(k) Fund Menu ({menu.length})
          </h3>
          <div className="flex gap-2">
            <button onClick={addFund} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-300 rounded hover:bg-cyan-500/30">
              <Plus size={12} /> Add Fund
            </button>
            <button onClick={resetDefaults} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-surface-700 text-surface-300 rounded hover:bg-surface-600">
              <RotateCcw size={12} /> Reset Defaults
            </button>
          </div>
        </div>

        <div className="text-[10px] text-surface-500 flex items-center gap-1 mb-2">
          <Info size={10} /> Edit ticker, name, asset class, and expense ratio (as decimal — e.g. 0.0004 = 4 bps).
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-surface-500 uppercase tracking-wider">
              <tr className="border-b border-surface-800">
                <th className="text-left py-2 pr-3">Ticker</th>
                <th className="text-left py-2 pr-3">Name</th>
                <th className="text-left py-2 pr-3">Asset Class</th>
                <th className="text-right py-2 pr-3">Expense</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {menu.map((f, i) => (
                <tr key={f.id ?? i} className="border-b border-surface-800/50">
                  <td className="py-1.5 pr-3">
                    <input value={f.ticker} onChange={(e) => updateFund(i, 'ticker', e.target.value.toUpperCase())}
                      className="w-24 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono" />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input value={f.name} onChange={(e) => updateFund(i, 'name', e.target.value)}
                      className="w-full bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs" />
                  </td>
                  <td className="py-1.5 pr-3">
                    <select value={f.assetClass} onChange={(e) => updateFund(i, 'assetClass', e.target.value)}
                      className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs">
                      {ASSET_CLASS_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <input type="number" step={0.0001} value={f.expenseRatio} onChange={(e) => updateFund(i, 'expenseRatio', +e.target.value)}
                      className="w-20 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-right" />
                  </td>
                  <td className="py-1.5">
                    <button onClick={() => removeFund(i)} className="text-red-400 hover:text-red-300" title="Remove">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
