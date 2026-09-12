import React from 'react';
import { Clock, RefreshCw } from 'lucide-react';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function formatTimestamp(ts) {
  if (!ts) return '—';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stalenessLabel(ts) {
  if (!ts) return 'unknown';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return 'unknown';
  const age = Date.now() - d.getTime();
  if (age < ONE_DAY_MS) return 'fresh';
  if (age < 2 * ONE_DAY_MS) return 'recent';
  return 'stale';
}

const STALENESS_STYLES = {
  fresh: 'text-emerald-400',
  recent: 'text-yellow-400',
  stale: 'text-red-400',
  unknown: 'text-surface-500',
};

/**
 * SectionTimestamp — visible timestamp badge for any data-driven section.
 * Constitution Principle XI: every section in every tab must display
 * when its data was last fetched, with staleness color-coding.
 *
 * @param {Date|string|null} fetchedAt - when the data was last fetched
 * @param {string} [label] - optional section label (e.g. "COT Report")
 * @param {boolean} [loading] - show spinner instead of refresh icon
 * @param {function} [onRefresh] - optional refresh handler
 * @param {string} [className] - extra classes
 */
export default function SectionTimestamp({ fetchedAt, label, loading, onRefresh, className = '' }) {
  const staleness = stalenessLabel(fetchedAt);
  const colorClass = STALENESS_STYLES[staleness];

  return (
    <div className={`flex items-center gap-2 text-xs ${colorClass} ${className}`}>
      <Clock size={11} className="shrink-0" />
      {label && <span className="font-medium text-surface-400">{label}:</span>}
      <span>Updated {formatTimestamp(fetchedAt)}</span>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={loading}
          className="ml-1 p-1 rounded hover:bg-surface-800 transition disabled:opacity-50"
          title="Refresh this section"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      )}
    </div>
  );
}
