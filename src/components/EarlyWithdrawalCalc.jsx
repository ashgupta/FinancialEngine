import React, { useState, useMemo } from 'react';
import { PiggyBank, AlertTriangle, TrendingDown, DollarSign, Calculator } from 'lucide-react';
import { calculate401kEarlyWithdrawal, proRateSalary } from '../engine/earlyWithdrawal';

const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(n);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

function Card({ children, className = '' }) {
  return (
    <div className={`bg-[#111114] border border-surface-800 rounded-xl p-5 ${className}`}>{children}</div>
  );
}

function Row({ label, value, tone = 'text-gray-200', sub }) {
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-surface-800/50 last:border-b-0">
      <span className="text-sm text-surface-400">{label}{sub && <span className="text-xs text-surface-600 ml-2">{sub}</span>}</span>
      <span className={`font-mono font-semibold ${tone}`}>{value}</span>
    </div>
  );
}

function NumberInput({ label, value, onChange, prefix, suffix, min = 0, max, step = 1, hint }) {
  return (
    <div>
      <label className="block text-xs font-medium text-surface-400 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(+e.target.value)}
          min={min} max={max} step={step}
          className={`w-full bg-surface-800 border border-surface-700 rounded-lg py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${prefix ? 'pl-8' : 'pl-3'} ${suffix ? 'pr-10' : 'pr-3'}`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 text-xs">{suffix}</span>}
      </div>
      {hint && <p className="text-[10px] text-surface-600 mt-1">{hint}</p>}
    </div>
  );
}

export default function EarlyWithdrawalCalc() {
  const [balance, setBalance] = useState(562000);
  const [rothPct, setRothPct] = useState(37);
  const [rothEarningsPct, setRothEarningsPct] = useState(40);
  const [age, setAge] = useState(45);
  const [annualSalary, setAnnualSalary] = useState(250000);
  const [ytdOverride, setYtdOverride] = useState(null);
  const [filingStatus, setFilingStatus] = useState('single');
  const [stateRatePct, setStateRatePct] = useState(0);

  const today = useMemo(() => new Date(), []);
  const computedYtd = useMemo(() => proRateSalary(annualSalary, today), [annualSalary, today]);
  const ytdSalary = ytdOverride ?? computedYtd;

  const result = useMemo(() => calculate401kEarlyWithdrawal({
    totalBalance: balance,
    rothPct,
    rothEarningsPct,
    age,
    ytdSalary,
    filingStatus,
    stateRate: stateRatePct / 100,
  }), [balance, rothPct, rothEarningsPct, age, ytdSalary, filingStatus, stateRatePct]);

  const { breakdown, federal, state, summary } = result;

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <div className="flex items-center gap-3 mb-1">
          <PiggyBank size={20} className="text-brand-400" />
          <h2 className="text-xl font-bold">401(k) Early Withdrawal Calculator</h2>
        </div>
        <p className="text-surface-400 text-sm ml-8">
          Estimate net proceeds after federal tax + 10% early withdrawal penalty (under 59½).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* INPUTS */}
        <Card className="lg:col-span-1 space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-surface-500 mb-2">
            <Calculator size={12} /> Inputs
          </div>

          <NumberInput label="Total 401(k) Balance" value={balance} onChange={setBalance} prefix="$" step={1000} />
          <NumberInput label="% in Roth 401(k)" value={rothPct} onChange={setRothPct} suffix="%" max={100} />
          <NumberInput
            label="Of Roth, % that is Earnings"
            value={rothEarningsPct} onChange={setRothEarningsPct} suffix="%" max={100}
            hint="Contributions come out tax/penalty-free; earnings are taxed + 10% penalty."
          />

          <div className="pt-2 border-t border-surface-800">
            <NumberInput label="Current Age" value={age} onChange={setAge} min={18} max={90} />
            <NumberInput
              label="Annual Salary" value={annualSalary} onChange={(v) => { setAnnualSalary(v); setYtdOverride(null); }}
              prefix="$" step={1000}
            />
            <NumberInput
              label={`YTD Salary Earned (auto: ${fmt(computedYtd)})`}
              value={ytdSalary}
              onChange={setYtdOverride}
              prefix="$" step={1000}
              hint={`Pro-rated through ${today.toLocaleDateString()}. Override if needed.`}
            />
          </div>

          <div className="pt-2 border-t border-surface-800">
            <label className="block text-xs font-medium text-surface-400 mb-1">Filing Status</label>
            <select
              value={filingStatus}
              onChange={(e) => setFilingStatus(e.target.value)}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            >
              <option value="single">Single</option>
              <option value="married">Married Filing Jointly</option>
            </select>
            <div className="mt-2">
              <NumberInput
                label="State Tax Rate" value={stateRatePct} onChange={setStateRatePct}
                suffix="%" step={0.1} max={15}
                hint="Approximate flat rate (CA ~10%, NY ~7%, TX/FL 0%)"
              />
            </div>
          </div>
        </Card>

        {/* HEADLINE RESULTS */}
        <Card className="lg:col-span-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-surface-500 mb-3">
            <DollarSign size={12} /> Net You Walk Away With
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="bg-surface-800/50 rounded-lg p-4">
              <p className="text-xs text-surface-500">Gross Withdrawal</p>
              <p className="text-xl font-bold text-gray-100">{fmt(summary.grossWithdrawal)}</p>
            </div>
            <div className="bg-red-500/10 rounded-lg p-4 border border-red-500/20">
              <p className="text-xs text-red-400">Total Deductions</p>
              <p className="text-xl font-bold text-red-300">−{fmt(summary.totalDeductions)}</p>
              <p className="text-[10px] text-red-400/60 mt-0.5">{pct(summary.effectiveRate)} effective</p>
            </div>
            <div className="bg-emerald-500/10 rounded-lg p-4 border border-emerald-500/20">
              <p className="text-xs text-emerald-400">Net Received</p>
              <p className="text-xl font-bold text-emerald-300">{fmt(summary.netReceived)}</p>
              <p className="text-[10px] text-emerald-400/60 mt-0.5">{pct(summary.netReceived / summary.grossWithdrawal)} of gross</p>
            </div>
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <h4 className="text-xs uppercase tracking-wider text-surface-500 mb-2">Balance Breakdown</h4>
              <Row label="Traditional 401(k)"      value={fmt(breakdown.tradBalance)} sub="100% taxable" />
              <Row label="Roth — Contributions"    value={fmt(breakdown.rothContrib)} tone="text-emerald-400" sub="tax & penalty free" />
              <Row label="Roth — Earnings"         value={fmt(breakdown.rothEarnings)} tone="text-yellow-400" sub="taxable + penalty" />
              <Row label="Total Taxable Portion"   value={fmt(breakdown.taxableFromWithdrawal)} tone="text-orange-400" />
            </div>
            <div>
              <h4 className="text-xs uppercase tracking-wider text-surface-500 mb-2">Tax & Penalty Detail</h4>
              <Row label="Incremental Federal Tax" value={`−${fmt(federal.incrementalFedTax)}`} tone="text-red-400" sub={`marg ${pct(federal.marginalRate)}`} />
              <Row label="10% Early Penalty"       value={`−${fmt(federal.penalty)}`} tone="text-red-400" sub={summary.isEarly ? '(under 59½)' : '(N/A)'} />
              <Row label="State Tax"               value={`−${fmt(state.stateTax)}`} tone="text-red-400" sub={`${(state.stateRate*100).toFixed(1)}%`} />
              <Row label="Mandatory Withholding"   value={fmt(federal.mandatoryWithholding)} tone="text-surface-500" sub="20% on traditional (refunded if over-withheld)" />
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-surface-800 text-xs text-surface-500 flex items-center gap-2">
            <TrendingDown size={12} className="text-surface-500" />
            <span>This withdrawal pushes your <strong className="text-surface-300">total income</strong> for the year to <strong className="text-surface-300">{fmt(summary.taxableIncomeForYear)}</strong> — marginal federal rate <strong className="text-surface-300">{pct(federal.marginalRate)}</strong>.</span>
          </div>
        </Card>
      </div>

      {/* Warnings */}
      <Card className="border-yellow-500/20 bg-yellow-500/5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-yellow-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-yellow-100/80 space-y-1.5">
            <p className="font-semibold text-yellow-300">Before you withdraw — consider alternatives</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li><strong>401(k) loan</strong> — borrow up to 50% (max $50k), no tax, no penalty, repay yourself with interest.</li>
              <li><strong>Rule of 55</strong> — if you separate from your employer in the year you turn 55+, the 10% penalty is waived on that employer's 401(k).</li>
              <li><strong>SEPP / 72(t)</strong> — substantially equal periodic payments avoid the penalty but lock you in for 5 years or until 59½.</li>
              <li><strong>Roll to IRA first</strong> — gives access to Roth contribution withdrawals (always tax/penalty-free) and other exceptions.</li>
              <li>This estimate ignores cross-state nuances, NIIT (3.8% on high earners), AMT, and FICA. <strong>Consult a CPA.</strong></li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
