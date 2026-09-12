import React, { useState, useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { Globe2, AlertTriangle, TrendingUp, Shield, Info } from 'lucide-react';
import SectionTimestamp from './SectionTimestamp';

const fmt = (n) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`;
const fmtK = (n) => {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
};

function NumInput({ label, value, onChange, prefix = '', suffix = '', step = 1, min = 0 }) {
  return (
    <div>
      <label className="block text-xs text-surface-400 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          step={step}
          min={min}
          className={`w-full bg-surface-900 border border-surface-700 rounded-lg py-2 ${prefix ? 'pl-7' : 'pl-3'} ${suffix ? 'pr-10' : 'pr-3'} text-sm focus:border-brand-500 focus:outline-none`}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 text-sm">{suffix}</span>}
      </div>
    </div>
  );
}

export default function InternationalInvestorCalc() {
  // Inputs
  const [startBalance, setStartBalance] = useState(547000);
  const [annualContrib, setAnnualContrib] = useState(50000);
  const [years, setYears] = useState(20);
  const [expectedReturn, setExpectedReturn] = useState(8); // %
  const [dividendYield, setDividendYield] = useState(1.5); // %
  const [usWithholding, setUsWithholding] = useState(25); // % - India treaty rate
  const [irishWithholding] = useState(15); // fixed by treaty
  const [estateScenario, setEstateScenario] = useState('nra'); // 'nra' | 'citizen'

  const projection = useMemo(() => {
    const r = expectedReturn / 100;
    const dy = dividendYield / 100;
    const usW = usWithholding / 100;
    const irW = irishWithholding / 100;

    // Price-only return (what's left of total return after dividends)
    const priceReturn = r - dy;

    let usBal = startBalance;
    let irBal = startBalance;
    const series = [];

    for (let y = 0; y <= years; y++) {
      series.push({
        year: y,
        us: Math.round(usBal),
        irish: Math.round(irBal),
        diff: Math.round(irBal - usBal),
      });
      // Apply growth: price growth + dividends net of withholding (reinvested)
      const usDiv = usBal * dy * (1 - usW);
      const irDiv = irBal * dy * (1 - irW);
      usBal = usBal * (1 + priceReturn) + usDiv + annualContrib;
      irBal = irBal * (1 + priceReturn) + irDiv + annualContrib;
    }

    const final = series[series.length - 1];
    return { series, final };
  }, [startBalance, annualContrib, years, expectedReturn, dividendYield, usWithholding, irishWithholding]);

  // Annual dividend cost difference (year 1)
  const annualDivLoss = startBalance * (dividendYield / 100) * ((usWithholding - irishWithholding) / 100);

  // Estate tax exposure scenarios
  const estateExposure = useMemo(() => {
    const finalBal = projection.final.us;
    const NRA_EXEMPTION = 60000;
    const CITIZEN_EXEMPTION = 13_990_000;
    const TOP_RATE = 0.40;

    const exemption = estateScenario === 'nra' ? NRA_EXEMPTION : CITIZEN_EXEMPTION;
    const taxable = Math.max(0, finalBal - exemption);
    // Simplified: top-rate calc (real is graduated 18-40%)
    const tax = taxable * TOP_RATE;
    return { exemption, taxable, tax, finalBal };
  }, [projection, estateScenario]);

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-indigo-500/10 to-fuchsia-500/10 border border-indigo-500/20 rounded-2xl p-5">
        <div className="flex items-start gap-3 mb-4">
          <Globe2 size={22} className="text-indigo-400 shrink-0 mt-1" />
          <div>
            <h2 className="text-lg font-bold">International Investor Calculator</h2>
            <p className="text-xs text-surface-400 mt-1">
              Compare US-domiciled vs Irish-domiciled ETF strategy for a non-US-resident.
              Models long-term cost of dividend withholding + US estate tax exposure.
            </p>
          </div>
        </div>

        <SectionTimestamp fetchedAt={new Date()} label="International Investor" />

        {/* Inputs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-2">
          <NumInput label="Starting Balance" value={startBalance} onChange={setStartBalance} prefix="$" step={10000} />
          <NumInput label="Annual Contribution" value={annualContrib} onChange={setAnnualContrib} prefix="$" step={5000} />
          <NumInput label="Years" value={years} onChange={setYears} suffix="yr" step={1} min={1} />
          <NumInput label="Expected Return" value={expectedReturn} onChange={setExpectedReturn} suffix="%" step={0.5} />
          <NumInput label="Dividend Yield" value={dividendYield} onChange={setDividendYield} suffix="%" step={0.1} />
          <NumInput label="US Withholding (NRA)" value={usWithholding} onChange={setUsWithholding} suffix="%" step={1} />
          <div>
            <label className="block text-xs text-surface-400 mb-1">Irish Withholding</label>
            <div className="bg-surface-900 border border-surface-700 rounded-lg py-2 px-3 text-sm text-surface-300">
              {irishWithholding}% <span className="text-surface-500 text-xs">(fixed by treaty)</span>
            </div>
          </div>
          <div>
            <label className="block text-xs text-surface-400 mb-1">Your US Status</label>
            <select
              value={estateScenario}
              onChange={(e) => setEstateScenario(e.target.value)}
              className="w-full bg-surface-900 border border-surface-700 rounded-lg py-2 px-3 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="nra">Non-Resident Alien</option>
              <option value="citizen">US Citizen / Domiciliary</option>
            </select>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-800/40 border border-surface-700/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-red-400" />
            <span className="text-xs text-surface-400 uppercase tracking-wide">Year-1 Dividend Tax Drag</span>
          </div>
          <p className="text-2xl font-bold text-red-400">{fmt(annualDivLoss)}</p>
          <p className="text-xs text-surface-500 mt-1">extra paid annually with US-domiciled funds</p>
        </div>

        <div className="bg-surface-800/40 border border-surface-700/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={16} className="text-emerald-400" />
            <span className="text-xs text-surface-400 uppercase tracking-wide">{years}-Year Wealth Difference</span>
          </div>
          <p className="text-2xl font-bold text-emerald-400">+{fmtK(projection.final.diff)}</p>
          <p className="text-xs text-surface-500 mt-1">
            extra ending balance with Irish-domiciled
            ({((projection.final.diff / projection.final.us) * 100).toFixed(1)}% more)
          </p>
        </div>

        <div className={`bg-surface-800/40 border rounded-xl p-4 ${estateScenario === 'nra' ? 'border-red-500/30' : 'border-surface-700/40'}`}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className={estateScenario === 'nra' ? 'text-red-400' : 'text-surface-500'} />
            <span className="text-xs text-surface-400 uppercase tracking-wide">Est. US Estate Tax @ Y{years}</span>
          </div>
          <p className={`text-2xl font-bold ${estateScenario === 'nra' ? 'text-red-400' : 'text-surface-400'}`}>
            {fmtK(estateExposure.tax)}
          </p>
          <p className="text-xs text-surface-500 mt-1">
            on ${fmtK(estateExposure.taxable)} above ${fmtK(estateExposure.exemption)} exemption
          </p>
        </div>
      </div>

      {/* Wealth comparison chart */}
      <div className="bg-surface-800/40 border border-surface-700/40 rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3">Wealth Trajectory: US vs Irish-domiciled</h3>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={projection.series} margin={{ top: 5, right: 15, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="year" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => `Y${v}`} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtK(v)} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload;
                  return (
                    <div className="bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                      <p className="text-surface-400 mb-1">Year {p.year}</p>
                      <p className="text-red-400">US-domiciled: {fmt(p.us)}</p>
                      <p className="text-emerald-400">Irish-domiciled: {fmt(p.irish)}</p>
                      <p className="text-fuchsia-400 mt-1 font-semibold">Difference: +{fmt(p.diff)}</p>
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="us" stroke="#ef4444" strokeWidth={2} dot={false} name="US-domiciled (SPY)" />
              <Line type="monotone" dataKey="irish" stroke="#10b981" strokeWidth={2} dot={false} name="Irish-domiciled (CSPX)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cumulative cost chart */}
      <div className="bg-surface-800/40 border border-surface-700/40 rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3">Cumulative Cost of Choosing US-domiciled (lost wealth)</h3>
        <div className="h-48">
          <ResponsiveContainer>
            <AreaChart data={projection.series} margin={{ top: 5, right: 15, bottom: 5, left: 5 }}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="year" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => `Y${v}`} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtK(v)} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-surface-900 border border-surface-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                      <p className="text-surface-400">Year {payload[0].payload.year}</p>
                      <p className="text-red-400 font-semibold">Lost: {fmt(payload[0].payload.diff)}</p>
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="diff" stroke="#ef4444" fill="url(#costGrad)" strokeWidth={2} name="Wealth Gap" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Estate tax warning panel */}
      {estateScenario === 'nra' && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-red-300">⚠️ US Estate Tax Risk for Non-Resident Aliens</p>
              <p className="text-surface-300 text-xs mt-2">
                As an NRA, your US-situs assets (US stocks, US ETFs, US real estate) face a <strong>$60K exemption</strong> with no US-India estate tax treaty.
                At your projected Year {years} balance of <strong>{fmt(estateExposure.finalBal)}</strong>, your heirs could owe <strong className="text-red-400">{fmt(estateExposure.tax)}</strong> in US estate tax.
              </p>
              <p className="text-surface-400 text-xs mt-2">
                <strong>Mitigations:</strong> Hold Irish-domiciled ETFs (not US-situs), use foreign holding structures,
                term life insurance to cover residual exposure, or maintain US citizenship.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Reference table */}
      <div className="bg-surface-800/40 border border-surface-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info size={14} className="text-brand-400" />
          <h3 className="text-sm font-semibold">Common Irish-Domiciled Equivalents</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-surface-500 uppercase">
              <tr className="border-b border-surface-700/50">
                <th className="text-left py-2 px-2 font-medium">Tracks</th>
                <th className="text-left py-2 px-2 font-medium">US-domiciled</th>
                <th className="text-left py-2 px-2 font-medium">Irish-domiciled (UCITS)</th>
                <th className="text-left py-2 px-2 font-medium">Listing</th>
              </tr>
            </thead>
            <tbody className="text-surface-300">
              {[
                ['S&P 500', 'SPY / VOO / IVV', 'CSPX (acc) / VUSA (dist)', 'LSE'],
                ['Nasdaq 100', 'QQQ', 'CNDX (acc)', 'LSE'],
                ['Total World', 'VT', 'VWRA (acc) / VWRD (dist)', 'LSE'],
                ['Developed Mkts', 'EFA / VEA', 'IWDA / SWDA (acc)', 'LSE'],
                ['Emerging Mkts', 'VWO / EEM', 'EMIM (acc)', 'LSE'],
                ['Global Bonds', 'AGG / BNDX', 'AGGG (dist)', 'LSE'],
                ['US Treasuries', 'GOVT / VGIT', 'IDTM / IBTM', 'LSE'],
              ].map(([tracks, us, ir, exch], i) => (
                <tr key={i} className="border-b border-surface-700/30">
                  <td className="py-2 px-2">{tracks}</td>
                  <td className="py-2 px-2 text-red-400">{us}</td>
                  <td className="py-2 px-2 text-emerald-400 font-medium">{ir}</td>
                  <td className="py-2 px-2 text-surface-500">{exch}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-surface-500 mt-3">
          <strong className="text-surface-400">acc</strong> = accumulating (auto-reinvests dividends, most tax-efficient).{' '}
          <strong className="text-surface-400">dist</strong> = distributing.
          Buy through Interactive Brokers (IBKR India), Saxo, or DEGIRO. Most listed on London Stock Exchange in USD.
        </p>
      </div>

      <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 text-xs text-yellow-200/80">
        <strong className="text-yellow-300">Disclaimer:</strong> Educational projection only. Assumes static withholding rates,
        ignores expense ratios, fund-specific tracking error, currency effects, and changes in tax law.
        Estate tax calculation uses simplified 40% top rate (real is graduated 18–40%).
        Consult a US-India cross-border tax advisor before acting.
      </div>
    </div>
  );
}
