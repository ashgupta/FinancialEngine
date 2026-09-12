import React, { useState } from 'react';
import { Briefcase, PiggyBank } from 'lucide-react';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';
import EarlyWithdrawalCalc from './EarlyWithdrawalCalc';
import K401PlanTab from './K401PlanTab';

const SUB_VIEWS = [
  { id: 'plan', label: '401(k) Plan', icon: Briefcase },
  { id: 'withdrawal', label: 'Early Withdrawal', icon: PiggyBank },
];

export default function RetirementTab({ riskTolerance, currentSavings }) {
  const [subView, setSubView] = useState('plan');

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

      <SectionTimestamp fetchedAt={new Date()} label="Retirement Planning" />

      {subView === 'plan' && <K401PlanTab riskTolerance={riskTolerance} accountValue={currentSavings} />}
      {subView === 'withdrawal' && <EarlyWithdrawalCalc />}

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol="VTI" title="VTI — 12-Week Retirement Portfolio Trend" color="#22c55e" />

      <p className="text-[11px] text-surface-600 leading-relaxed">
        Educational analysis only — not financial advice. 401(k) rules have tax implications and early withdrawal penalties. Consult a qualified financial advisor or tax professional before making retirement account decisions.
      </p>
    </div>
  );
}
