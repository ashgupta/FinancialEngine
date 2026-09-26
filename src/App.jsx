import React, { useState, useMemo, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  ScatterChart, Scatter,
} from 'recharts';
import {
  TrendingUp, Shield, PiggyBank, Calculator, BarChart3, Target,
  ChevronRight, DollarSign, Percent, AlertTriangle, Sparkles,
  ArrowUpRight, Zap, Info, Check, Clock, Flame, Globe, Radio,
  ArrowDownRight, Layers, CandlestickChart, Upload, MessageCircle, Bot,
  Briefcase, FileText, Gauge, Activity, Radar, Scale, Landmark,
  CloudLightning, ChartPie,
} from 'lucide-react';
import { useMarketData } from './hooks/useMarketData';
import MarketsTab from './components/MarketsTab';
import FuturesTab from './components/FuturesTab';
import OptionsTab from './components/OptionsTab';
import SpreadFinderTab from './components/SpreadFinderTab';
import SocialPulseTab from './components/SocialPulseTab';
import InternationalInvestorCalc from './components/InternationalInvestorCalc';
import PortfolioTab from './components/PortfolioTab';
import AIChatTab from './components/AIChatTab';
import EarlyWithdrawalCalc from './components/EarlyWithdrawalCalc';
import K401PlanTab from './components/K401PlanTab';
import BrokeragePlanTab from './components/BrokeragePlanTab';
import Dell401kTab from './components/Dell401kTab';
import COTTab from './components/COTTab';
import MomentumTab from './components/MomentumTab';
import VolatilityTab from './components/VolatilityTab';
import SectorRotationTab from './components/SectorRotationTab';
import ProjectionsTab from './components/ProjectionsTab';
import PortfolioMergedTab from './components/PortfolioMergedTab';
import RetirementTab from './components/RetirementTab';
import BondMarketTab from './components/BondMarketTab';
import { runMonteCarlo } from './engine/monteCarlo';
import { getRecommendedAllocation, getEfficientFrontier, ASSET_CLASSES } from './engine/portfolio';
import { calculateFIRE, savingsRate as calcSavingsRate } from './engine/fire';
import { compareDebtStrategies } from './engine/debt';
import { getTaxStrategies, estimateFederalTax, marginalRate } from './engine/tax';
import { generateRecommendations } from './engine/recommendations';
import { WatchlistProvider } from './contexts/WatchlistContext';
import { PortfolioProvider } from './contexts/PortfolioContext.jsx';
import SectionTimestamp from './components/SectionTimestamp';
import WeeklyTrendView from './components/WeeklyTrendView';
import CrashRadarTab from './components/CrashRadarTab.jsx';
import CrashThesisTab from './components/CrashThesisTab.jsx';
import OptionsOpportunitiesTab from './components/OptionsOpportunitiesTab.jsx';
import CrashGauge from './components/CrashGauge.jsx';
import LeapsAnalyzerTab from './components/LeapsAnalyzerTab';
import { fetchOptionsChain } from './engine/marketData.js';
import { compareLeapsVsShares, pickStockReplacementStrike } from './engine/leapsAnalyzer.js';

// ─── Helpers ──────────────────────────────────────────────
const fmt = (n) => {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};

const pct = (n) => `${(n * 100).toFixed(1)}%`;

// ─── Section Card ─────────────────────────────────────────
function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-4 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color = 'text-brand-400' }) {
  return (
    <Card className="flex items-start gap-4">
      <div className={`p-3 rounded-xl bg-surface-800 ${color}`}>
        <Icon size={22} />
      </div>
      <div>
        <p className="text-surface-400 text-sm">{label}</p>
        <p className="text-2xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-surface-500 text-xs mt-1">{sub}</p>}
      </div>
    </Card>
  );
}

function SectionHeading({ icon: Icon, title, subtitle }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1">
        {Icon && <Icon size={20} className="text-brand-400" />}
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      {subtitle && <p className="text-surface-400 text-sm ml-8">{subtitle}</p>}
    </div>
  );
}

// ─── Dashboard Crash Widget ─────────────────────────────
function DashboardCrashWidget({ onClick }) {
  const [crash, setCrash] = useState(null);

  useEffect(() => {
    fetch('/crash/scan')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setCrash(d))
      .catch(() => {});
  }, []);

  if (!crash) return null;

  return (
    <div className="flex items-center gap-3">
      <CrashGauge
        score={crash.score}
        level={crash.level}
        label={crash.label}
        color={crash.color}
        variant="compact"
        onClick={onClick}
      />
      <div className="text-xs text-surface-500">
        <span className="text-surface-400 font-medium">Crash Radar</span> — tap to view full analysis
      </div>
    </div>
  );
}

// ─── Dashboard LEAPS Widget ─────────────────────────────
function DashboardLeapsWidget({ onClick }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const near = await fetchOptionsChain('SPY', null);
        if (!near?.expirations?.length) return;
        const longest = near.expirations[near.expirations.length - 1];
        const chain = await fetchOptionsChain('SPY', longest);
        if (!chain?.calls?.length || !chain.underlyingPrice) return;
        const dte = Math.round((longest * 1000 - Date.now()) / 86400000);
        const pick = pickStockReplacementStrike(chain.calls, chain.underlyingPrice, dte, 0.80, 0.043, 0.01);
        if (!pick) return;
        const res = compareLeapsVsShares({
          spot: chain.underlyingPrice, strike: pick.contract.strike, premium: pick.premium,
          dte, contracts: 1, riskFreeRate: 0.043, dividendYield: 0.01, freedCapitalYield: 0.05,
        });
        if (!cancelled) setData({ res, dte, strike: pick.contract.strike });
      } catch { /* non-blocking */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) return null;
  const { res, dte, strike } = data;
  const c = res.comparison;

  return (
    <Card className="hover:border-brand-500/40 transition-colors cursor-pointer" onClick={onClick}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center shrink-0">
            <Scale size={18} className="text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm">LEAPS Stock Replacement — SPY ${strike} Call</p>
            <p className="text-xs text-surface-500">{dte}d · IV {(res.impliedVol * 100).toFixed(1)}% · frees {fmt(c.capitalFreed)} vs shares</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-right shrink-0">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-surface-500">Capital Efficiency</p>
            <p className="text-lg font-bold text-brand-300">{(c.capitalEfficiency * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-surface-500">Vol Premium</p>
            <p className="text-lg font-bold text-purple-400">{(c.volatilityCostPct * 100).toFixed(1)}%</p>
          </div>
          <ChevronRight size={18} className="text-surface-600 hidden sm:block" />
        </div>
      </div>
    </Card>
  );
}

// ─── Tabs ─────────────────────────────────────────────────
const TABS = [
  { id: 'opportunities', label: 'Opportunities', icon: Target },
  { id: 'dell401k', label: 'Dell 401k', icon: PiggyBank },
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'markets', label: 'Live Markets', icon: Globe },
  { id: 'futures', label: 'Futures', icon: CandlestickChart },
  { id: 'cot', label: 'COT Report', icon: FileText },
  { id: 'momentum', label: 'Momentum', icon: Gauge },
  { id: 'sector', label: 'Sector Rotation', icon: BarChart3 },
  { id: 'volatility', label: 'Volatility', icon: Activity },
  { id: 'bonds', label: 'Bond Market', icon: Landmark },
  { id: 'crash', label: 'Crash Radar', icon: Radar },
  { id: 'thesis', label: 'Crash Thesis (Karsan)', icon: CloudLightning },
  { id: 'options', label: 'Options', icon: Layers },
  { id: 'spreads', label: 'Spread Finder', icon: Target },
  { id: 'leaps', label: 'LEAPS Analyzer', icon: Scale },
  { id: 'social', label: 'Social Pulse', icon: MessageCircle },
  { id: 'ai', label: 'Market Assistant', icon: Bot },
  { id: 'projections', label: 'Projections', icon: TrendingUp },
  { id: 'portfolio', label: 'Portfolio', icon: ChartPie },
  { id: 'tax', label: 'Tax Strategy', icon: DollarSign },
  { id: 'retirement', label: 'Retirement', icon: PiggyBank },
  { id: 'brokerplan', label: 'Brokerage Plan', icon: Briefcase },
];

// ─── Input Form ───────────────────────────────────────────
function InputField({ label, value, onChange, type = 'number', prefix, suffix, min, max, step }) {
  return (
    <div>
      <label className="block text-sm text-surface-400 mb-1.5">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">{prefix}</span>}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(type === 'number' ? +e.target.value : e.target.value)}
          min={min}
          max={max}
          step={step}
          className={`w-full bg-surface-800 border border-surface-700 rounded-lg py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition ${prefix ? 'pl-8' : 'pl-3'} ${suffix ? 'pr-8' : 'pr-3'}`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">{suffix}</span>}
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        className={`w-10 h-6 rounded-full transition-colors relative ${value ? 'bg-brand-500' : 'bg-surface-700'}`}
        onClick={() => onChange(!value)}
      >
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'left-5' : 'left-1'}`} />
      </div>
      <span className="text-sm text-surface-300">{label}</span>
    </label>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────
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

// ─── Main App ─────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState(() => {
    const hash = window.location.hash.replace('#', '').split('/')[0];
    return hash || 'dashboard';
  });

  // Sync tab <-> URL hash for shareable deep links (e.g. #markets/patterns)
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '').split('/')[0];
      if (h) setTab(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const currentHash = window.location.hash.replace('#', '').split('/')[0];
    if (currentHash !== tab) {
      window.history.replaceState(null, '', `#${tab}`);
    }
  }, [tab]);

  // Scroll to anchor when arriving at #markets/patterns
  useEffect(() => {
    if (window.location.hash.includes('/patterns')) {
      setTimeout(() => {
        document.getElementById('historical-patterns')?.scrollIntoView({ behavior: 'smooth' });
      }, 600);
    }
  }, [tab]);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);

  // Auto-adjust sidebar on orientation/resize change
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Inputs
  const [age, setAge] = useState(30);
  const [income, setIncome] = useState(120000);
  const [expenses, setExpenses] = useState(60000);
  const [currentSavings, setCurrentSavings] = useState(80000);
  const [annualSavings, setAnnualSavings] = useState(40000);
  const [riskTolerance, setRiskTolerance] = useState(7);
  const [horizon, setHorizon] = useState(30);
  const [filingStatus, setFilingStatus] = useState('single');
  const [has401k, setHas401k] = useState(true);
  const [hasHSA, setHasHSA] = useState(true);
  const [hasIRA, setHasIRA] = useState(true);
  const [hasEmergencyFund, setHasEmergencyFund] = useState(true);
  const [emergencyFundMonths, setEmergencyFundMonths] = useState(4);

  // Debts
  const [debts, setDebts] = useState([
    { name: 'Credit Card', balance: 5000, rate: 0.22, minimum: 150 },
    { name: 'Student Loan', balance: 25000, rate: 0.055, minimum: 300 },
    { name: 'Car Loan', balance: 15000, rate: 0.045, minimum: 350 },
  ]);
  const [extraDebtPayment, setExtraDebtPayment] = useState(500);
  const [useLiveData, setUseLiveData] = useState(true);

  // ─── IBKR Gateway Status ────────────────────────────────
  const [ibkrStatus, setIbkrStatus] = useState(null);
  const [ibkrReconnecting, setIbkrReconnecting] = useState(false);

  useEffect(() => {
    let mounted = true;
    const checkStatus = async () => {
      try {
        const resp = await fetch('/ibkr/status');
        if (resp.ok) {
          const data = await resp.json();
          if (mounted) setIbkrStatus(data);
        }
      } catch { /* ignore */ }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const reconnectIbkr = async () => {
    setIbkrReconnecting(true);
    try {
      const resp = await fetch('/ibkr/reconnect', { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        setIbkrStatus(await (await fetch('/ibkr/status')).json());
      }
    } catch { /* ignore */ }
    setIbkrReconnecting(false);
  };

  // ─── Live Market Data ───────────────────────────────────
  const { snapshot: marketSnapshot, loading: marketLoading, lastRefresh: marketLastRefresh, refresh: marketRefresh } = useMarketData();

  // ─── Derived computations ────────────────────────────────
  const portfolio = useMemo(() => getRecommendedAllocation(riskTolerance), [riskTolerance]);
  const frontier = useMemo(() => getEfficientFrontier(), []);

  // Override return/vol with live trailing data when available
  const livePortfolioMetrics = useMemo(() => {
    if (!useLiveData || !marketSnapshot?.etfs?.length) return null;
    const alloc = portfolio.allocation;
    let weightedReturn = 0;
    let totalWeight = 0;
    let hasData = false;
    for (const a of alloc) {
      const etf = marketSnapshot.etfs.find((e) => e.symbol === a.ticker);
      if (etf?.trailingReturn != null && etf?.trailingVol != null) {
        weightedReturn += a.weight * etf.trailingReturn;
        totalWeight += a.weight;
        hasData = true;
      }
    }
    if (!hasData) return null;
    // Weighted vol (simplified — ignores cross-correlations for live override)
    let weightedVol = 0;
    for (const a of alloc) {
      const etf = marketSnapshot.etfs.find((e) => e.symbol === a.ticker);
      if (etf?.trailingVol != null) {
        weightedVol += a.weight * etf.trailingVol;
      }
    }
    return { expectedReturn: weightedReturn, volatility: weightedVol };
  }, [useLiveData, marketSnapshot, portfolio.allocation]);

  const effectiveReturn = livePortfolioMetrics?.expectedReturn ?? portfolio.expectedReturn;
  const effectiveVol = livePortfolioMetrics?.volatility ?? portfolio.volatility;

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

  const taxStrategies = useMemo(() => getTaxStrategies(income, filingStatus, age, has401k, hasHSA, hasIRA), [income, filingStatus, age, has401k, hasHSA, hasIRA]);

  const recommendations = useMemo(() => generateRecommendations({
    age, income, expenses, savings: currentSavings, annualSavings, debts, riskTolerance,
    has401k, hasHSA, hasIRA, hasEmergencyFund, emergencyFundMonths, filingStatus,
  }), [age, income, expenses, currentSavings, annualSavings, debts, riskTolerance, has401k, hasHSA, hasIRA, hasEmergencyFund, emergencyFundMonths, filingStatus]);

  const savingsRatePct = calcSavingsRate(income, annualSavings);
  const fedTax = estimateFederalTax(income, filingStatus);
  const margRate = marginalRate(income, filingStatus);

  const mcData = useMemo(() => {
    return monteCarlo.percentiles.p50.map((_, i) => ({
      year: i,
      age: age + i,
      p10: monteCarlo.percentiles.p10[i],
      p25: monteCarlo.percentiles.p25[i],
      p50: monteCarlo.percentiles.p50[i],
      p75: monteCarlo.percentiles.p75[i],
      p90: monteCarlo.percentiles.p90[i],
      mean: monteCarlo.mean[i],
    }));
  }, [monteCarlo, age]);

  // ─── Live market ticker for dashboard ────────────────────
  const marketTicker = useMemo(() => {
    if (!marketSnapshot?.indices) return [];
    return marketSnapshot.indices.filter((i) => i.price != null).slice(0, 8);
  }, [marketSnapshot]);

  // ─── Render ──────────────────────────────────────────────
  const renderDashboard = () => (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-1">Financial Dashboard</h1>
        <p className="text-surface-400">Your wealth-building command center — all models updated in real time.</p>
      </div>

      {/* Live Market Ticker Strip */}
      {marketTicker.length > 0 && (
        <div className="space-y-2">
          <SectionTimestamp fetchedAt={marketLastRefresh} label="Market Data" loading={marketLoading} onRefresh={() => marketRefresh(true)} />
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2">
          {marketTicker.map((idx) => {
            const isUp = (idx.change ?? 0) >= 0;
            return (
              <div key={idx.symbol} className="flex items-center gap-2 bg-surface-800/60 rounded-lg px-3 py-2 border border-surface-700/30 shrink-0 min-w-[160px]">
                <span className="text-sm">{idx.flag}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-surface-300 truncate">{idx.name}</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold">{idx.price?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                    <span className={`text-xs font-medium flex items-center gap-0.5 ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isUp ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                      {idx.changePercent != null ? `${isUp ? '+' : ''}${idx.changePercent.toFixed(2)}%` : ''}
                    </span>
                  </div>
                  {idx.lastUpdated && <p className="text-[8px] text-surface-600 mt-0.5">{idx.lastUpdated}</p>}
                </div>
              </div>
            );
          })}
          <button onClick={() => setTab('markets')} className="flex items-center gap-1.5 bg-brand-500/10 text-brand-400 rounded-lg px-4 py-2 border border-brand-500/20 shrink-0 text-xs font-medium hover:bg-brand-500/20 transition">
            <Globe size={14} /> All Markets
          </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Net Invested" value={fmt(currentSavings)} sub="Current portfolio value" />
        <StatCard icon={TrendingUp} label="Projected (Median)" value={fmt(monteCarlo.percentiles.p50[horizon])} sub={`In ${horizon} years (real dollars)`} color="text-blue-400" />
        <StatCard icon={Flame} label="FIRE Age" value={fire.fireAge ? fire.fireAge : '—'} sub={fire.fireAge ? `FIRE number: ${fmt(fire.fireNumber)}` : 'Not on track yet'} color="text-orange-400" />
        <StatCard icon={Percent} label="Savings Rate" value={`${savingsRatePct}%`} sub={savingsRatePct >= 50 ? 'FIRE-track savings!' : savingsRatePct >= 20 ? 'Solid savings rate' : 'Room to improve'} color="text-emerald-400" />
      </div>

      {/* Crash Radar Widget */}
      <DashboardCrashWidget onClick={() => setTab('crash')} />

      {/* LEAPS Analyzer Widget */}
      <DashboardLeapsWidget onClick={() => setTab('leaps')} />

      {/* Mini Monte Carlo */}
      <Card>
        <SectionHeading icon={TrendingUp} title="Wealth Projection (Monte Carlo)" subtitle="2,000 simulations · inflation-adjusted · fan chart shows P10–P90 range" />
        <SectionTimestamp fetchedAt={marketLastRefresh} label="Projection Model" className="mb-4" />
        <div className="h-80">
          <ResponsiveContainer>
            <AreaChart data={mcData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <defs>
                <linearGradient id="fanOuter" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="fanInner" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="age" stroke="#64748b" tick={{ fontSize: 12 }} label={{ value: 'Age', position: 'insideBottom', offset: -2, fill: '#94a3b8' }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 12 }} tickFormatter={fmt} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="p10" stackId="fan" stroke="none" fill="url(#fanOuter)" name="P10" />
              <Area type="monotone" dataKey="p25" stackId="fan2" stroke="none" fill="url(#fanInner)" name="P25" />
              <Area type="monotone" dataKey="p75" stackId="fan3" stroke="none" fill="url(#fanInner)" name="P75" />
              <Area type="monotone" dataKey="p90" stackId="fan4" stroke="none" fill="url(#fanOuter)" name="P90" />
              <Line type="monotone" dataKey="p50" stroke="#3b82f6" strokeWidth={2.5} dot={false} name="Median" />
              <Line type="monotone" dataKey="mean" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Mean" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Action Plan (merged from separate tab) */}
      <Card>
        <SectionHeading icon={Target} title="Action Plan" subtitle="Personalized recommendations ranked by priority — adjust inputs in the sidebar to update" />
        <SectionTimestamp fetchedAt={new Date()} label="Recommendations" className="mb-4" />
        <div className="space-y-3">
          {recommendations.map((r, i) => (
            <div key={i} className="flex items-start gap-4 bg-surface-800/50 rounded-xl p-4 border border-surface-700/30 hover:border-brand-500/30 transition-colors">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-500/20 text-brand-400 font-bold text-sm shrink-0">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-surface-800 text-surface-400">{r.category}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.priority <= 2 ? 'bg-red-500/20 text-red-400' : r.priority <= 3 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-surface-700 text-surface-500'}`}>P{r.priority}</span>
                </div>
                <p className="font-semibold text-sm">{r.title}</p>
                <p className="text-surface-400 text-xs mt-0.5">{r.description}</p>
              </div>
            </div>
          ))}
        </div>
        <Card className="border-yellow-500/20 bg-yellow-500/5 mt-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-yellow-200/70 text-xs">Educational analysis only — not financial advice. Consult a qualified financial advisor before making investment decisions.</p>
          </div>
        </Card>
      </Card>

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol="SPY" title="SPY — 12-Week Market Trend" />
    </div>
  );


  const renderMarkets = () => (
    <MarketsTab
      snapshot={marketSnapshot}
      loading={marketLoading}
      lastRefresh={marketLastRefresh}
      onRefresh={() => marketRefresh(true)}
    />
  );

  const renderFutures = () => <FuturesTab />;
  const renderCot = () => <COTTab />;
  const renderMomentum = () => <MomentumTab />;
  const renderOptions = () => <OptionsTab />;
  const renderSpreads = () => <SpreadFinderTab />;
  const renderSocial = () => <SocialPulseTab />;
  const renderAi = () => <AIChatTab />;

  const renderProjections = () => (
    <ProjectionsTab
      age={age}
      income={income}
      expenses={expenses}
      currentSavings={currentSavings}
      annualSavings={annualSavings}
      horizon={horizon}
      effectiveReturn={effectiveReturn}
      effectiveVol={effectiveVol}
      livePortfolioMetrics={livePortfolioMetrics}
      debts={debts}
      extraDebtPayment={extraDebtPayment}
    />
  );

  const renderPortfolioMerged = () => (
    <PortfolioMergedTab
      riskTolerance={riskTolerance}
      marketSnapshot={marketSnapshot}
      useLiveData={useLiveData}
    />
  );

  const renderRetirement = () => (
    <RetirementTab
      riskTolerance={riskTolerance}
      currentSavings={currentSavings}
    />
  );

  const renderTax = () => (
    <div className="space-y-8">
      <SectionHeading icon={DollarSign} title="Tax Optimization" subtitle={`Filing: ${filingStatus} · Marginal rate: ${(margRate * 100).toFixed(0)}% · Est. federal tax: ${fmt(fedTax)}`} />
      <SectionTimestamp fetchedAt={new Date()} label="Tax Strategy" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={DollarSign} label="Estimated Federal Tax" value={fmt(fedTax)} sub={`Effective rate: ${((fedTax / income) * 100).toFixed(1)}%`} color="text-red-400" />
        <StatCard icon={Percent} label="Marginal Rate" value={`${(margRate * 100).toFixed(0)}%`} sub="Next dollar taxed at this rate" color="text-orange-400" />
        <StatCard icon={PiggyBank} label="Total Potential Savings" value={fmt(taxStrategies.reduce((s, t) => s + t.impact, 0))} sub="If all strategies implemented" color="text-emerald-400" />
      </div>

      <div className="space-y-4">
        {taxStrategies.map((s, i) => (
          <Card key={i}>
            <div className="flex items-start gap-4">
              <div className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase ${s.priority === 'high' ? 'bg-red-500/20 text-red-400' : s.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-surface-700 text-surface-400'}`}>{s.priority}</div>
              <div className="flex-1">
                <h3 className="font-semibold">{s.title}</h3>
                <p className="text-surface-400 text-sm mt-1">{s.description}</p>
              </div>
              {s.impact > 0 && (
                <div className="text-right shrink-0">
                  <p className="text-emerald-400 font-bold">{fmt(s.impact)}</p>
                  <p className="text-surface-500 text-xs">annual savings</p>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* International / Cross-border Investor Calculator */}
      <div id="international-investor" className="pt-4 border-t border-surface-800">
        <InternationalInvestorCalc />
      </div>

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol="SPY" title="SPY — 12-Week Market Trend" color="#22c55e" />
    </div>
  );

  const tabContent = {
    dashboard: renderDashboard,
    markets: renderMarkets,
    futures: renderFutures,
    cot: renderCot,
    momentum: renderMomentum,
    sector: () => <SectorRotationTab />,
    volatility: () => <VolatilityTab />,
    bonds: () => <BondMarketTab />,
    crash: () => <CrashRadarTab />,
    thesis: () => <CrashThesisTab />,
    options: renderOptions,
    opportunities: () => <OptionsOpportunitiesTab />,
    spreads: renderSpreads,
    social: renderSocial,
    ai: renderAi,
    projections: renderProjections,
    portfolio: renderPortfolioMerged,
    tax: renderTax,
    retirement: renderRetirement,
    brokerplan: () => <BrokeragePlanTab riskTolerance={riskTolerance} />,
    dell401k: () => <Dell401kTab />,
    leaps: () => <LeapsAnalyzerTab />,
  };

  return (
    <WatchlistProvider>
     <PortfolioProvider>
      <div className="min-h-screen bg-[#0a0a0a] text-gray-200 font-sans selection:bg-blue-500/30">
        {/* Mobile backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — fixed on all screens, offset by margin on desktop */}
      <aside className={`fixed top-0 left-0 h-screen z-40 bg-[#0f0f11] border-r border-surface-800 transition-transform duration-300 w-64 shrink-0 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="h-full overflow-y-auto">
          <div className="p-5 border-b border-surface-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
                <Zap size={18} className="text-white" />
              </div>
              <div>
                <h1 className="font-black text-lg leading-none">WealthEngine</h1>
                <p className="text-[10px] text-surface-500 uppercase tracking-widest">Analysis · Strategy · Action</p>
              </div>
            </div>
          </div>

          <nav className="p-3 border-b border-surface-800">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
              onClick={() => { setTab(id); if (window.innerWidth < 1024) setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all mb-0.5 ${tab === id ? 'bg-brand-500/15 text-brand-400 font-semibold' : 'text-surface-400 hover:bg-surface-800 hover:text-white'}`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Your Inputs</p>
          <InputField label="Age" value={age} onChange={setAge} min={18} max={85} />
          <InputField label="Annual Income" value={income} onChange={setIncome} prefix="$" />
          <InputField label="Annual Expenses" value={expenses} onChange={setExpenses} prefix="$" />
          <InputField label="Current Savings" value={currentSavings} onChange={setCurrentSavings} prefix="$" />
          <InputField label="Annual Savings" value={annualSavings} onChange={setAnnualSavings} prefix="$" />
          <InputField label="Investment Horizon" value={horizon} onChange={setHorizon} suffix="yrs" min={1} max={60} />

          <div>
            <label className="block text-sm text-surface-400 mb-1.5">Risk Tolerance: {riskTolerance}/10</label>
            <input type="range" min={1} max={10} value={riskTolerance} onChange={(e) => setRiskTolerance(+e.target.value)} className="w-full accent-brand-500" />
            <div className="flex justify-between text-xs text-surface-600 mt-0.5"><span>Conservative</span><span>Aggressive</span></div>
          </div>

          <div>
            <label className="block text-sm text-surface-400 mb-1.5">Filing Status</label>
            <select value={filingStatus} onChange={(e) => setFilingStatus(e.target.value)} className="w-full bg-surface-800 border border-surface-700 rounded-lg py-2.5 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50">
              <option value="single">Single</option>
              <option value="married">Married Filing Jointly</option>
            </select>
          </div>

          <InputField label="Extra Debt Payment" value={extraDebtPayment} onChange={setExtraDebtPayment} prefix="$" suffix="/mo" />
          <InputField label="Emergency Fund (months)" value={emergencyFundMonths} onChange={setEmergencyFundMonths} min={0} max={24} />

          <div className="space-y-3 pt-2">
            <Toggle label="Has 401(k)" value={has401k} onChange={setHas401k} />
            <Toggle label="Has HSA" value={hasHSA} onChange={setHasHSA} />
            <Toggle label="Has IRA" value={hasIRA} onChange={setHasIRA} />
            <Toggle label="Emergency Fund" value={hasEmergencyFund} onChange={setHasEmergencyFund} />
          </div>

          <div className="pt-4 border-t border-surface-800">
            <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3">Data Source</p>
            <Toggle label="Use live market data" value={useLiveData} onChange={setUseLiveData} />

            {/* IBKR Gateway Status */}
            {ibkrStatus && (
              <div className="mt-3 space-y-2">
                <div className={`flex items-center gap-1.5 text-xs ${ibkrStatus.provider === 'ibkr' ? 'text-emerald-400' : ibkrStatus.ibkr?.online ? 'text-yellow-400' : 'text-surface-500'}`}>
                  <span className={`w-2 h-2 rounded-full ${ibkrStatus.provider === 'ibkr' ? 'bg-emerald-400 animate-pulse' : ibkrStatus.ibkr?.online ? 'bg-yellow-400' : 'bg-surface-600'}`} />
                  <span>
                    {ibkrStatus.provider === 'ibkr' ? 'IBKR Live (real-time)' : ibkrStatus.ibkr?.online ? 'IBKR online · Yahoo fallback' : 'Yahoo Finance (delayed)'}
                  </span>
                </div>
                {ibkrStatus.ibkr?.online && !ibkrStatus.ibkr?.authenticated && (
                  <p className="text-xs text-yellow-400/70">IBKR gateway needs login at localhost:5010</p>
                )}
                <button
                  onClick={reconnectIbkr}
                  disabled={ibkrReconnecting}
                  className="text-xs text-brand-400 hover:text-brand-300 disabled:opacity-50 transition"
                >
                  {ibkrReconnecting ? 'Reconnecting...' : 'Reconnect IBKR'}
                </button>
              </div>
            )}

            {marketSnapshot?.isLive && useLiveData && (
              <div className="flex items-center gap-1.5 mt-2">
                <Radio size={10} className="text-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-400">Live · Updated {marketLastRefresh?.toLocaleTimeString()}</span>
              </div>
            )}
            {!marketSnapshot?.isLive && useLiveData && !marketLoading && (
              <p className="text-xs text-yellow-400 mt-2">Market data unavailable — using model defaults</p>
            )}
          </div>
        </div>
        </div>
      </aside>

      {/* Main content — margin-left to account for sidebar when open on desktop */}
      <div className={`transition-all duration-300 ${sidebarOpen ? 'lg:ml-64' : 'ml-0'}`}>
      <main className="min-h-screen overflow-y-auto">
        <header className="sticky top-0 z-20 bg-surface-950/90 backdrop-blur border-b border-surface-800 px-3 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 transition shrink-0" aria-label="Toggle menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {sidebarOpen ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></> : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>}
            </svg>
          </button>
          <span className="text-sm sm:text-base font-semibold text-surface-300 truncate">
            {TABS.find((t) => t.id === tab)?.label}
          </span>
          {marketSnapshot?.isLive && (
            <span className="flex items-center gap-1.5 ml-auto px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs">
              <Radio size={8} className="animate-pulse" /> Live
            </span>
          )}
          {ibkrStatus?.provider === 'ibkr' && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs" title="Real-time data from Interactive Brokers">
              IBKR
            </span>
          )}
          {ibkrStatus?.provider === 'yahoo' && ibkrStatus?.config === 'auto' && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/10 text-yellow-400 text-xs" title="IBKR unavailable — using Yahoo Finance (15-min delay)">
              Yahoo
            </span>
          )}
        </header>
        <div className="p-3 sm:p-6 lg:p-10 max-w-6xl mx-auto">
          <div key={tab}>{tabContent[tab]?.()}</div>
        </div>
      </main>
      </div>
      </div>
     </PortfolioProvider>
    </WatchlistProvider>
  );
}
