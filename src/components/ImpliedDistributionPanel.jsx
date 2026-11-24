import React from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';

const SHAPE_STYLE = {
  'left-tail': 'bg-red-500/15 text-red-300 border-red-500/30',
  lottery: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'right-tail': 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  narrow: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  normal: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  unknown: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`);
const usd = (v) => (v == null || !Number.isFinite(v) ? '—' : `$${v.toLocaleString(undefined, { maximumFractionDigits: v < 100 ? 2 : 0 })}`);

/** Small pill describing the distribution shape. */
export function ShapeBadge({ shape, className = '' }) {
  if (!shape) return null;
  return (
    <span
      title={shape.description}
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold ${SHAPE_STYLE[shape.key] || SHAPE_STYLE.unknown} ${className}`}
    >
      {shape.label}
    </span>
  );
}

/**
 * Options-implied (Breeden–Litzenberger) distribution: density vs a
 * lognormal at the ATM vol, tail odds and 90% range.
 *
 * @param {object} props
 * @param {object} props.summary   distributionSummary() output
 * @param {object[]} [props.curve] distributionCurve() output
 * @param {number[]} [props.markers] prices to mark (e.g. breakevens)
 * @param {boolean} [props.compact]
 */
export default function ImpliedDistributionPanel({ summary, curve = [], markers = [], compact = false }) {
  if (!summary) {
    return (
      <div className="text-xs text-gray-500">
        Implied distribution unavailable — too few two-sided quotes on this expiry. Probabilities fall back to a lognormal estimate.
      </div>
    );
  }
  const { spot, tails, range90, shape, atmIv, daysToExpiry, strikesUsed, quality } = summary;
  const rows = [
    { label: '≤ −30%', i: tails.implied.down30, n: tails.lognormal.down30 },
    { label: '≤ −20%', i: tails.implied.down20, n: tails.lognormal.down20 },
    { label: '≥ +20%', i: tails.implied.up20, n: tails.lognormal.up20 },
    { label: '≥ +30%', i: tails.implied.up30, n: tails.lognormal.up30 },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
        <ShapeBadge shape={shape} />
        <span>ATM vol {pct(atmIv)}</span>
        <span>· {Math.round(daysToExpiry)}d</span>
        <span>· 90% range {usd(range90[0])} – {usd(range90[1])}</span>
        <span className="text-gray-600">· {strikesUsed} strikes ({quality})</span>
      </div>

      {!compact && curve.length > 0 && (
        <div className="h-44" aria-label="Options-implied probability density versus lognormal">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="price" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10, fill: '#9ca3af' }} tickFormatter={(v) => `$${Math.round(v)}`} />
              <YAxis hide />
              <Tooltip
                formatter={(v, name) => [v.toExponential(2), name]}
                labelFormatter={(v) => `$${Number(v).toFixed(2)}`}
                contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 11 }}
              />
              <Area type="monotone" dataKey="implied" name="Options-implied" stroke="#60a5fa" fill="#3b82f633" strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="lognormal" name="Lognormal (ATM vol)" stroke="#9ca3af" strokeDasharray="5 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <ReferenceLine x={spot} stroke="#e5e7eb" strokeDasharray="3 3" label={{ value: 'Spot', fill: '#e5e7eb', fontSize: 10, position: 'top' }} />
              {markers.filter(Number.isFinite).map((m) => (
                <ReferenceLine key={m} x={m} stroke="#fbbf24" strokeDasharray="4 3" label={{ value: `BE $${m.toFixed(2)}`, fill: '#fbbf24', fontSize: 10, position: 'insideTopRight' }} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-gray-500">
            <th className="text-left font-medium py-1">Move by expiry</th>
            <th className="text-right font-medium py-1">Options-implied</th>
            <th className="text-right font-medium py-1">Normal curve</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-gray-800">
              <td className="py-1 text-gray-300">{r.label}</td>
              <td className={`py-1 text-right font-mono ${r.i > r.n * 1.25 ? 'text-amber-300' : 'text-gray-200'}`}>{pct(r.i)}</td>
              <td className="py-1 text-right font-mono text-gray-500">{pct(r.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-gray-600 leading-relaxed">
        {shape.description} Risk-neutral probabilities from the option chain (Breeden–Litzenberger) — prices, not forecasts; crash odds include an insurance premium. Educational only.
      </p>
    </div>
  );
}
