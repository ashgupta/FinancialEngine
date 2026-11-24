import React, { useState, useEffect, useRef } from 'react';
import {
  CloudLightning, RefreshCw, AlertTriangle, Info, Hourglass, CheckCircle2,
  XCircle, MinusCircle, ShieldAlert, Coins, ExternalLink, TrendingUp, Layers, Flag, Crosshair,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import SectionTimestamp from './SectionTimestamp';
import WeeklyTrendView from './WeeklyTrendView';

function Card({ children, className = '' }) {
  return (
    <div className={`bg-surface-900/60 backdrop-blur border border-surface-700/50 rounded-2xl p-4 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

function Heading({ icon: Icon, title, sub }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={16} className="text-brand-400" />
      <h3 className="text-sm font-bold">{title}</h3>
      {sub && <span className="text-[11px] text-surface-500">{sub}</span>}
    </div>
  );
}

const TONE = {
  blue: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  yellow: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  orange: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

const STATUS = {
  supports: { icon: CheckCircle2, cls: 'text-emerald-400', text: 'Supports' },
  neutral: { icon: MinusCircle, cls: 'text-surface-400', text: 'Neutral' },
  against: { icon: XCircle, cls: 'text-red-400', text: 'Against' },
};

const ALERT_STYLE = {
  critical: 'bg-red-500/10 border-red-500/40 text-red-300',
  warning: 'bg-orange-500/10 border-orange-500/40 text-orange-300',
  info: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
};

const TRADE_COLORS = { calendar: '#3b82f6', diagonal: '#a855f7', putSpread: '#f59e0b', killSwitchPut: '#ef4444', symFly: '#22d3ee', bwbFly: '#f472b6' };

const money = (v) => (v == null || isNaN(v) ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const signedMoney = (v) => (v == null || isNaN(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const pct = (v, d = 1) => (v == null || isNaN(v) ? '—' : `${(v * 100).toFixed(d)}%`);
const movePct = (m) => `${m > 0 ? '+' : ''}${(m * 100).toFixed(0)}%`;

function NumberInput({ label, value, onChange, prefix, suffix, step = 1, min, max }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-surface-400 mb-1">{label}</span>
      <div className="relative">
        {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-xs">{prefix}</span>}
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(+e.target.value)}
          className={`w-full bg-surface-800 border border-surface-700 rounded-lg py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${prefix ? 'pl-6' : 'pl-2.5'} ${suffix ? 'pr-7' : 'pr-2.5'}`}
        />
        {suffix && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-500 text-xs">{suffix}</span>}
      </div>
    </label>
  );
}

// ─── Trade card ─────────────────────────────────────────

function TradeCard({ t }) {
  const crashLoser = t.pnlAtMinus20 != null && t.pnlAtMinus20 < 0;
  return (
    <div className="rounded-xl border border-surface-700/60 bg-surface-900/40 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TRADE_COLORS[t.key] }} aria-hidden />
            <h4 className="font-bold text-sm text-surface-100">{t.name}</h4>
          </div>
          <p className="text-[11px] text-surface-500 mt-0.5">{t.tagline}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-surface-500">Cost / contract</p>
          <p className="text-lg font-bold text-surface-100">{money(t.costPerContract)}</p>
        </div>
      </div>

      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-surface-500 border-b border-surface-800">
            <th className="text-left py-1 font-medium">Leg</th>
            <th className="text-left py-1 font-medium">Expiry</th>
            <th className="text-right py-1 font-medium">Bid / Ask</th>
            <th className="text-right py-1 font-medium">Mid</th>
            <th className="text-right py-1 font-medium">IV</th>
          </tr>
        </thead>
        <tbody>
          {t.legs.map((l, i) => (
            <tr key={i} className="border-b border-surface-800/50">
              <td className="py-1">
                <span className={l.action === 'BUY' ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{l.action}</span>
                {' '}${l.strike} put{l.qty > 1 ? ` ×${l.qty}` : ''}
              </td>
              <td className="py-1 text-surface-400">{l.expiryLabel} <span className="text-surface-600">({l.dte}d)</span></td>
              <td className="py-1 text-right text-surface-500">{l.bid.toFixed(2)} / {l.ask.toFixed(2)}</td>
              <td className="py-1 text-right text-surface-300">{l.mid.toFixed(2)}</td>
              <td className="py-1 text-right text-surface-400">{pct(l.iv)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div>
          <p className="text-surface-500">Suggested</p>
          <p className="font-semibold text-surface-200">{t.suggestedContracts} × <span className="text-surface-500 font-normal">of {money(t.allocated)}</span></p>
        </div>
        <div>
          <p className="text-surface-500">P&amp;L flat</p>
          <p className={`font-semibold ${t.pnlFlat >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signedMoney(t.pnlFlat)}</p>
        </div>
        <div>
          <p className="text-surface-500">P&amp;L at −20%</p>
          <p className={`font-semibold ${t.pnlAtMinus20 >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signedMoney(t.pnlAtMinus20)}</p>
        </div>
        <div>
          <p className="text-surface-500">P&amp;L at −30%</p>
          <p className={`font-semibold ${t.pnlAtMinus30 >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signedMoney(t.pnlAtMinus30)}</p>
        </div>
      </div>

      {t.breakevens && (
        <p className="text-[11px] text-surface-400">
          Profit zone at expiry: <span className="text-surface-200 font-medium">${t.breakevens.lower != null ? t.breakevens.lower.toLocaleString() : `≤ ${t.lowerStrike.toLocaleString()} (floor ${money(t.tailFloor)})`} – ${t.breakevens.upper.toLocaleString()}</span>
          <span className="text-surface-500"> · starts paying below −{(t.breakevens.entryDecline * 100).toFixed(1)}%</span>
          {t.netDebitExec != null && <span className="text-surface-500"> · executable ≈ {money(t.netDebitExec * 100)}</span>}
        </p>
      )}

      {t.ivEdge != null && (
        <p className="text-[11px] text-surface-400">
          IV edge (short − long): <span className={t.ivEdge > 0 ? 'text-emerald-400 font-medium' : 'text-surface-300'}>{t.ivEdge > 0 ? '+' : ''}{(t.ivEdge * 100).toFixed(1)} vol pts</span>
          {t.ivEdge > 0 ? ' — you sell richer vol than you buy' : ' — no skew edge at these strikes'}
        </p>
      )}

      {crashLoser && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-[11px] text-yellow-200">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>Not a crash payoff on its own: a fast drop straight through the strike before the front leg expires puts both legs deep ITM and the spread loses. Pair it with the diagonal, put spread or kill-switch put.</span>
        </div>
      )}

      <div className="rounded-lg bg-surface-900/60 border border-surface-800 p-3 space-y-1.5 text-[11px] text-surface-400 leading-relaxed">
        <p><span className="text-surface-500">Why it fits Karsan: </span>{t.karsanFit}</p>
        <p><span className="text-surface-500">Payoff: </span>{t.maxProfitNote}</p>
        <p className="text-surface-500 pt-1">Management</p>
        <ul className="list-disc pl-4 space-y-0.5">
          {t.management.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
        <p className="text-surface-500 pt-1">Risks</p>
        <ul className="list-disc pl-4 space-y-0.5">
          {t.risks.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>
    </div>
  );
}

// ─── Main tab ───────────────────────────────────────────

const UNDERLYING_KEY = 'crashThesisUnderlying';
const UNDERLYING_CHOICES = [
  { key: 'spy', label: 'SPY', hint: 'ETF · American · share-settled' },
  { key: 'xsp', label: 'XSP', hint: 'Mini-index · European · cash · §1256' },
  { key: 'spx', label: 'SPX', hint: 'Index · European · cash · §1256 · ~10× size' },
];

export default function CrashThesisTab() {
  const [portfolio, setPortfolio] = useState(500000);
  const [budgetPct, setBudgetPct] = useState(2);
  const [equityPct, setEquityPct] = useState(80);
  const [underlying, setUnderlying] = useState(() => {
    const saved = localStorage.getItem(UNDERLYING_KEY);
    return UNDERLYING_CHOICES.some((c) => c.key === saved) ? saved : 'spy';
  });
  const [flyTarget, setFlyTarget] = useState(() => {
    const saved = Number(localStorage.getItem('crashThesisFlyTarget'));
    return Number.isFinite(saved) && saved >= 5 && saved <= 50 ? saved : 20;
  });
  const [flyExpiry, setFlyExpiry] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const firstLoad = useRef(true);

  const load = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        portfolio: String(portfolio),
        budget: String(budgetPct / 100),
        equity: String(equityPct / 100),
        underlying,
        flyTarget: String(flyTarget / 100),
      });
      if (flyExpiry) qs.set('flyExpiry', flyExpiry);
      if (forceRefresh) qs.set('refresh', '1');
      const res = await fetch(`/thesis/karsan?${qs}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData(j);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const pickUnderlying = (key) => {
    setUnderlying(key);
    try { localStorage.setItem(UNDERLYING_KEY, key); } catch { /* ignore */ }
  };

  const changeFlyTarget = (v) => {
    setFlyTarget(v);
    try { localStorage.setItem('crashThesisFlyTarget', String(v)); } catch { /* ignore */ }
  };

  // Initial load, then debounced re-sizing (server re-runs the pure engine on cached market data)
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      load();
      return undefined;
    }
    const id = setTimeout(() => load(), 400);
    return () => clearTimeout(id);
  }, [portfolio, budgetPct, equityPct, underlying, flyTarget, flyExpiry]);

  const phase = data?.phase;
  const uLabel = data?.underlying?.label || 'SPY';
  const uNote = data?.underlying?.note || UNDERLYING_CHOICES.find((c) => c.key === underlying)?.hint;
  const chartData = data?.trades?.length
    ? data.trades[0].scenarios.map((s, i) => {
        const row = { move: movePct(s.move) };
        for (const t of data.trades) row[t.key] = t.scenarios[i]?.pnl ?? null;
        return row;
      })
    : [];
  const termData = (data?.termIv || []).map((t) => ({
    expiry: t.expiryLabel.slice(2),
    atm: t.atmIv != null ? +(t.atmIv * 100).toFixed(1) : null,
    p95: t.iv95 != null ? +(t.iv95 * 100).toFixed(1) : null,
    p90: t.iv90 != null ? +(t.iv90 * 100).toFixed(1) : null,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <CloudLightning size={24} className="text-brand-400" />
            <h1 className="text-2xl font-black tracking-tight">Crash Thesis</h1>
            {phase && (
              <span className={`px-2.5 py-1 rounded-full border text-xs font-medium ${TONE[phase.tone] || TONE.blue}`}>
                {phase.label}
              </span>
            )}
          </div>
          <p className="text-sm text-surface-400">
            Cem Karsan&apos;s post-midterm drawdown → V-bottom playbook, tested against live data
          </p>
        </div>
        {data && (
          <SectionTimestamp fetchedAt={data.fetchedAt} label="Thesis data" loading={loading} onRefresh={() => load(true)} />
        )}
      </div>

      {error && (
        <Card>
          <div className="flex items-center gap-2 text-red-400"><AlertTriangle size={16} /><span className="text-sm">{error}</span></div>
          <button onClick={() => load(true)} className="mt-3 px-4 py-2 rounded-lg bg-brand-500/20 text-brand-400 hover:bg-brand-500/30 text-sm font-medium transition">Retry</button>
        </Card>
      )}

      {loading && !data && (
        <Card>
          <div className="flex items-center gap-2 text-surface-400"><RefreshCw size={16} className="animate-spin" /><span className="text-sm">Pricing {uLabel} calendars and checking the thesis against live data…</span></div>
        </Card>
      )}

      {data && (
        <>
          {/* Headline + source */}
          <Card className="border-brand-500/30">
            <p className="text-sm text-surface-200 leading-relaxed">{data.headline}</p>
            <a href={data.thesis.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300">
              Source: {data.thesis.speaker} interview <ExternalLink size={11} />
            </a>
          </Card>

          {/* Live alerts */}
          {data.alerts?.length > 0 && (
            <div className="space-y-2" role="status" aria-live="polite">
              {data.alerts.map((a) => (
                <div key={a.key} className={`flex items-start gap-2 rounded-xl border px-4 py-3 ${ALERT_STYLE[a.severity] || ALERT_STYLE.info}`}>
                  <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{a.title}</p>
                    <p className="text-xs opacity-90">{a.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pillars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {data.thesis.pillars.map((p) => (
              <Card key={p.key} className="!p-4">
                <p className="text-xs font-bold text-surface-200 mb-1">{p.title}</p>
                <p className="text-[11px] text-surface-400 leading-relaxed">{p.text}</p>
              </Card>
            ))}
          </div>

          {/* Timeline */}
          <Card>
            <Heading icon={Hourglass} title="Thesis Timeline" sub={phase.action} />
            <div className="grid grid-cols-3 gap-3 mb-4 text-center">
              <div>
                <p className="text-2xl font-black text-surface-100">{phase.daysToMidterms > 0 ? phase.daysToMidterms : '—'}</p>
                <p className="text-[11px] text-surface-500">days to midterms</p>
              </div>
              <div>
                <p className={`text-2xl font-black ${phase.daysToKillSwitch < 45 ? 'text-yellow-400' : 'text-surface-100'}`}>{phase.daysToKillSwitch >= 0 ? phase.daysToKillSwitch : 'passed'}</p>
                <p className="text-[11px] text-surface-500">days to kill switch</p>
              </div>
              <div>
                <p className="text-2xl font-black text-surface-100">{phase.drawdownPct != null ? pct(phase.drawdownPct) : '—'}</p>
                <p className="text-[11px] text-surface-500">SPY off 52-wk high (needs 20–40%)</p>
              </div>
            </div>
            <div className="relative h-2 rounded-full bg-surface-800 overflow-hidden" role="progressbar" aria-valuenow={phase.windowProgressPct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress through the thesis window">
              <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-yellow-500 to-red-500" style={{ width: `${phase.windowProgressPct}%` }} />
            </div>
            <p className="text-[10px] text-surface-500 mt-1">Window progress (midterms → kill switch): {phase.windowProgressPct.toFixed(0)}%</p>
            <ol className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2">
              {phase.milestones.map((m) => (
                <li key={m.key} className="flex items-start gap-2 text-[11px]">
                  <Flag size={12} className="text-brand-400 shrink-0 mt-0.5" />
                  <span><span className="text-surface-200 font-medium">{m.date}</span><br /><span className="text-surface-500">{m.label}</span></span>
                </li>
              ))}
            </ol>
          </Card>

          {/* Scorecard */}
          <Card>
            <Heading icon={CheckCircle2} title="Is the data confirming it?" sub={data.scorecard.verdict} />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-surface-500 border-b border-surface-800">
                    <th className="text-left py-2 pr-3 font-medium">Condition</th>
                    <th className="text-left py-2 px-2 font-medium">Status</th>
                    <th className="text-left py-2 pl-3 font-medium">Live reading</th>
                  </tr>
                </thead>
                <tbody>
                  {data.scorecard.checks.map((c) => {
                    const s = STATUS[c.status] || STATUS.neutral;
                    const Icon = s.icon;
                    return (
                      <tr key={c.key} className="border-b border-surface-800/50">
                        <td className="py-2 pr-3 text-surface-200 font-medium">{c.label}</td>
                        <td className={`py-2 px-2 ${s.cls}`}><span className="inline-flex items-center gap-1"><Icon size={12} />{s.text}</span></td>
                        <td className="py-2 pl-3 text-surface-400 text-[11px]">{c.detail}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-surface-600 mt-2">Cheap vol and put skew are entry conditions (good time to build the calendar); trend, breadth, curve, COT, credit (HYG/IEF) and the composite are confirmation signals.</p>
          </Card>

          {/* Market-implied crash odds (Breeden–Litzenberger) */}
          {data.impliedCrashOdds && (
            <Card>
              <Heading icon={Crosshair} title="What options price for the drawdown" sub={`${uLabel} chain · ${data.impliedCrashOdds.expiryLabel} (${data.impliedCrashOdds.dte}d)`} />
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-surface-500 border-b border-surface-800">
                    <th className="text-left py-2 pr-3 font-medium">Decline by expiry</th>
                    <th className="text-right py-2 px-2 font-medium">Options-implied</th>
                    <th className="text-right py-2 pl-3 font-medium">Normal curve</th>
                  </tr>
                </thead>
                <tbody>
                  {data.impliedCrashOdds.rows.map((r) => (
                    <tr key={r.decline} className="border-b border-surface-800/50">
                      <td className="py-2 pr-3 text-surface-200">≤ −{(r.decline * 100).toFixed(0)}%</td>
                      <td className="py-2 px-2 text-right font-mono text-orange-300">{pct(r.implied)}</td>
                      <td className="py-2 pl-3 text-right font-mono text-surface-500">{pct(r.lognormal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-surface-600 mt-2">{data.impliedCrashOdds.note}</p>
            </Card>
          )}

          {/* Sizing inputs */}
          <Card>
            <Heading icon={Coins} title="Hedge Sizing" sub={`Budget ${money(data.sizing.budget)} · spot ${uLabel} ${data.spot ? `$${data.spot.toFixed(2)}` : '—'}`} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <NumberInput label="Portfolio value" value={portfolio} onChange={setPortfolio} prefix="$" step={10000} min={1000} />
              <NumberInput label="Hedge budget (% of portfolio)" value={budgetPct} onChange={setBudgetPct} suffix="%" step={0.5} min={0} max={10} />
              <NumberInput label="Equity exposure" value={equityPct} onChange={setEquityPct} suffix="%" step={5} min={0} max={150} />
            </div>
            <div className="mt-3">
              <span className="block text-[11px] text-surface-400 mb-1">Options underlying</span>
              <div className="inline-flex rounded-lg border border-surface-700 overflow-hidden" role="group" aria-label="Options underlying">
                {UNDERLYING_CHOICES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => pickUnderlying(c.key)}
                    aria-pressed={underlying === c.key}
                    title={c.hint}
                    className={`px-3 py-2 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${underlying === c.key ? 'bg-brand-500/20 text-brand-300' : 'bg-surface-800 text-surface-400 hover:text-surface-200'}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {uNote && <p className="text-[10px] text-surface-500 mt-1.5">{uNote}</p>}
            </div>
            <p className="text-[10px] text-surface-600 mt-2">Budget split: 40% calendar · 25% diagonal · 25% put spread · 10% kill-switch put. Contracts are rounded down so spend never exceeds the budget.</p>
          </Card>

          {/* Trades */}
          <div>
            <Heading icon={Layers} title={`Karsan-style structures (live ${uLabel} quotes)`} sub={data.horizon?.date ? `P&L evaluated at ${data.horizon.date} (front-leg expiry)` : ''} />
            {data.trades.length === 0 ? (
              <Card><p className="text-xs text-surface-500">No structures could be priced right now. {data.unavailable.join(' · ')}</p></Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.trades.map((t) => <TradeCard key={t.key} t={t} />)}
              </div>
            )}
            {data.unavailable.length > 0 && data.trades.length > 0 && (
              <p className="text-[10px] text-surface-600 mt-2">Not priced: {data.unavailable.join(' · ')}</p>
            )}
          </div>

          {/* Crash-target butterfly */}
          {data.butterflies && (
            <Card>
              <Heading
                icon={Crosshair}
                title={`Crash-target butterfly (live ${uLabel} quotes)`}
                sub={data.butterflies.expiryLabel ? `Expiry ${data.butterflies.expiryLabel} · target −${((data.butterflies.targetDecline || 0) * 100).toFixed(0)}% ≈ $${Number(data.butterflies.targetPrice).toLocaleString()}` : ''}
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <NumberInput label="Target decline" value={flyTarget} onChange={changeFlyTarget} suffix="%" step={5} min={5} max={50} />
                <label className="block">
                  <span className="block text-[11px] text-surface-400 mb-1">Expiry</span>
                  <select
                    value={flyExpiry}
                    onChange={(e) => setFlyExpiry(e.target.value)}
                    className="w-full bg-surface-800 border border-surface-700 rounded-lg py-2 pl-2.5 pr-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
                  >
                    <option value="">Auto (post-midterm cycle)</option>
                    {(data.butterflies.availableExpiries || []).map((e) => (
                      <option key={e.ts} value={e.ts}>{e.label} ({e.dte}d)</option>
                    ))}
                  </select>
                </label>
              </div>
              {data.butterflies.variants?.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {data.butterflies.variants.map((t) => <TradeCard key={t.key} t={t} />)}
                </div>
              ) : (
                <p className="text-xs text-surface-500">No butterfly could be priced at this target. {data.butterflies.unavailable?.join(' · ')}</p>
              )}
              <p className="text-[10px] text-surface-600 mt-3">
                A butterfly is a spot-target trade — net short vega, no kill switch, payoff only at expiry. Unlike the calendar it
                does <span className="text-surface-400">not</span> benefit from IV expansion alone; the index must land in the profit zone.
                Cost shown at mid; the executable line is the conservative fill estimate.
              </p>
            </Card>
          )}

          {/* Scenario chart */}
          {chartData.length > 0 && (
            <Card>
              <Heading icon={TrendingUp} title="Scenario P&L per contract" sub={`${uLabel} move by ${data.horizon?.date || 'front expiry'}, with vol rising as ${uLabel} falls`} />
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="move" stroke="#64748b" tick={{ fontSize: 11 }} label={{ value: `${uLabel} move`, position: 'insideBottom', offset: -2, fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 12 }} formatter={(v, name) => [signedMoney(v), data.trades.find((t) => t.key === name)?.name || name]} />
                    <Legend formatter={(name) => data.trades.find((t) => t.key === name)?.name || name} wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0} stroke="#64748b" />
                    {data.trades.map((t) => (
                      <Line key={t.key} type="monotone" dataKey={t.key} stroke={TRADE_COLORS[t.key]} strokeWidth={2} dot={{ r: 2 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* Portfolio impact */}
          <Card>
            <Heading icon={ShieldAlert} title="Portfolio impact (Principle VII drawdown guard)" />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-surface-500 border-b border-surface-800">
                    <th className="text-left py-2 font-medium">{uLabel} move</th>
                    <th className="text-right py-2 font-medium">Unhedged</th>
                    <th className="text-right py-2 font-medium">Hedge P&amp;L</th>
                    <th className="text-right py-2 font-medium">Hedged</th>
                    <th className="text-right py-2 font-medium">Hedged %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.portfolioImpact.map((r) => (
                    <tr key={r.move} className="border-b border-surface-800/50">
                      <td className="py-1.5 text-surface-300">{movePct(r.move)}</td>
                      <td className={`py-1.5 text-right ${r.unhedged < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{signedMoney(r.unhedged)}{r.flagUnhedged && <span className="ml-1 text-red-400" title="Drawdown > 15%">⚠</span>}</td>
                      <td className={`py-1.5 text-right ${r.hedgePnl < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{signedMoney(r.hedgePnl)}</td>
                      <td className={`py-1.5 text-right font-medium ${r.hedged < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{signedMoney(r.hedged)}</td>
                      <td className="py-1.5 text-right text-surface-300">
                        {pct(r.hedgedPct)}
                        {r.flagHedged && <span className="ml-1 inline-flex items-center gap-0.5 text-red-400"><ShieldAlert size={10} />&gt;15%</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`mt-3 flex items-start gap-2 text-[11px] ${data.guard.flag ? 'text-yellow-300' : 'text-emerald-300'}`}>
              <ShieldAlert size={12} className="shrink-0 mt-0.5" />
              <span>{data.guard.note} Total premium {money(data.guard.totalPremium)} ({pct(data.guard.premiumPctOfPortfolio, 2)} of portfolio){data.guard.premiumFlag ? ' — above the 3% soft cap.' : '.'}</span>
            </div>
          </Card>

          {/* V-bottom + debasement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <Heading icon={TrendingUp} title="V-bottom flip plan" sub={`Status: ${data.vBottom.status}`} />
              <ul className="space-y-2 mb-4">
                {data.vBottom.triggers.map((t) => {
                  const Icon = t.met === true ? CheckCircle2 : t.met === false ? XCircle : Info;
                  const cls = t.met === true ? 'text-emerald-400' : t.met === false ? 'text-surface-500' : 'text-blue-400';
                  return (
                    <li key={t.key} className="flex items-start gap-2 text-[11px]">
                      <Icon size={13} className={`${cls} shrink-0 mt-0.5`} />
                      <span>
                        <span className="text-surface-200">{t.label}</span>
                        <span className="text-surface-500"> — {t.met === true ? 'met' : t.met === false ? 'not met' : 'manual'} · {t.detail}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-surface-500 mb-1">When triggered:</p>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-surface-400">
                {data.vBottom.actions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
              <a href="#leaps" className="mt-3 inline-block text-xs text-brand-400 hover:text-brand-300">Open LEAPS Analyzer →</a>
            </Card>

            <Card>
              <Heading icon={Coins} title="Debasement trade" sub={data.debasement.verdict} />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-surface-500 border-b border-surface-800">
                      <th className="text-left py-1.5 font-medium">Asset</th>
                      <th className="text-right py-1.5 font-medium">Price</th>
                      <th className="text-right py-1.5 font-medium">vs 200-DMA</th>
                      <th className="text-right py-1.5 font-medium">6M</th>
                      <th className="text-right py-1.5 font-medium">12M</th>
                      <th className="text-right py-1.5 font-medium">Confirms?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.debasement.rows.map((r) => (
                      <tr key={r.symbol} className="border-b border-surface-800/50">
                        <td className="py-1.5"><span className="font-semibold text-surface-200">{r.symbol}</span> <span className="text-surface-500 text-[10px]">{r.role}</span></td>
                        <td className="py-1.5 text-right text-surface-300">{r.last != null ? `$${r.last.toFixed(2)}` : '—'}</td>
                        <td className="py-1.5 text-right text-surface-400">{r.aboveSMA200 == null ? '—' : r.aboveSMA200 ? 'Above' : 'Below'}</td>
                        <td className={`py-1.5 text-right ${r.roc6m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{r.roc6m != null ? `${r.roc6m >= 0 ? '+' : ''}${r.roc6m.toFixed(1)}%` : '—'}</td>
                        <td className={`py-1.5 text-right ${r.roc12m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{r.roc12m != null ? `${r.roc12m >= 0 ? '+' : ''}${r.roc12m.toFixed(1)}%` : '—'}</td>
                        <td className="py-1.5 text-right">
                          {r.confirming
                            ? <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 size={11} />Yes</span>
                            : <span className="inline-flex items-center gap-1 text-surface-500"><XCircle size={11} />No</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-surface-400 mt-3">
                {data.debasement.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </Card>
          </div>

          {/* IV term structure */}
          {termData.length > 1 && (
            <Card>
              <Heading icon={Layers} title={`${uLabel} put IV term structure`} sub="Near-dated OTM puts carry more IV than June — the edge a calendar/diagonal sells" />
              <div className="h-60">
                <ResponsiveContainer>
                  <LineChart data={termData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="expiry" stroke="#64748b" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 12 }} formatter={(v) => `${v}%`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="atm" name="ATM put IV" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="p95" name="95% put IV" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="p90" name="90% put IV" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <WeeklyTrendView symbol="SPY" title="SPY — 12-Week Trend" color="#3b82f6" />

          <p className="text-[10px] text-surface-600 leading-relaxed">
            {data.assumptions.note} Risk-free {pct(data.assumptions.riskFree)} · dividend yield {pct(data.assumptions.dividendYield)}. Source: {data.source}.
          </p>

          {/* Disclaimer */}
          <Card className="border-yellow-500/20 bg-yellow-500/5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-yellow-400 mb-1">Educational Disclaimer</h4>
                <p className="text-xs text-surface-400 leading-relaxed">
                  This tab models one strategist&apos;s publicly stated market view so you can study it; it is <strong>not a forecast</strong> and
                  <strong> not financial advice</strong>. The timing of a crash is highly uncertain. Options can lose 100% of the premium,
                  short legs carry assignment risk, and scenario P&amp;L is a Black-Scholes approximation. Consult a licensed advisor before trading.
                </p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
