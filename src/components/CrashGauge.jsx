import React from 'react';
import { ShieldAlert, ShieldCheck, Shield, AlertTriangle, ShieldX } from 'lucide-react';

const LEVEL_ICONS = {
  calm: ShieldCheck,
  watch: Shield,
  elevated: AlertTriangle,
  high: ShieldAlert,
  severe: ShieldX,
};

const LEVEL_COLORS = {
  calm: '#10b981',
  watch: '#3b82f6',
  elevated: '#eab308',
  high: '#f97316',
  severe: '#ef4444',
};

/**
 * CrashGauge — reusable radial risk gauge for the Crash Radar tab
 * and the Dashboard widget.
 *
 * @param {number} score - 0-100 crash risk score
 * @param {string} level - 'calm' | 'watch' | 'elevated' | 'high' | 'severe'
 * @param {string} label - display label
 * @param {string} color - color name
 * @param {'full'|'compact'} [variant='full'] - full for tab, compact for dashboard
 * @param {function} [onClick] - click handler (dashboard widget links to tab)
 */
export default function CrashGauge({ score = 0, level = 'calm', label = 'Calm', color = 'emerald', variant = 'full', onClick }) {
  const Icon = LEVEL_ICONS[level] || Shield;
  const strokeColor = LEVEL_COLORS[level] || LEVEL_COLORS.calm;

  // SVG radial gauge
  const radius = variant === 'compact' ? 28 : 52;
  const strokeWidth = variant === 'compact' ? 6 : 10;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (score / 100) * circumference;

  if (variant === 'compact') {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-2 p-2 rounded-lg bg-surface-900 border border-surface-800 hover:border-surface-700 transition group"
        title={`Crash Risk: ${score}/100 — ${label}`}
      >
        <div className="relative" style={{ width: 64, height: 64 }}>
          <svg width="64" height="64" className="-rotate-90">
            <circle cx="32" cy="32" r={radius} fill="none" stroke="#1e293b" strokeWidth={strokeWidth} />
            <circle
              cx="32" cy="32" r={radius} fill="none" stroke={strokeColor}
              strokeWidth={strokeWidth} strokeDasharray={circumference}
              strokeDashoffset={dashOffset} strokeLinecap="round"
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon size={18} style={{ color: strokeColor }} />
          </div>
        </div>
        <div className="text-left">
          <div className="text-[10px] text-surface-500 uppercase tracking-wider">Crash Risk</div>
          <div className="text-lg font-bold" style={{ color: strokeColor }}>{score}</div>
          <div className="text-[10px] text-surface-400">{label}</div>
        </div>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-6">
      <div className="relative" style={{ width: 140, height: 140 }}>
        <svg width="140" height="140" className="-rotate-90">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="#1e293b" strokeWidth={strokeWidth} />
          <circle
            cx="70" cy="70" r={radius} fill="none" stroke={strokeColor}
            strokeWidth={strokeWidth} strokeDasharray={circumference}
            strokeDashoffset={dashOffset} strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon size={28} style={{ color: strokeColor }} />
          <div className="text-3xl font-bold mt-1" style={{ color: strokeColor }}>{score}</div>
          <div className="text-xs text-surface-500">/ 100</div>
        </div>
      </div>
      <div className="mt-3 text-center">
        <div className="text-lg font-semibold" style={{ color: strokeColor }}>{label}</div>
        <div className="text-xs text-surface-500 mt-0.5">Crash Risk Level</div>
      </div>
    </div>
  );
}
