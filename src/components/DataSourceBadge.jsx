import React from 'react';
import { Clock, CheckCircle, AlertTriangle } from 'lucide-react';

/**
 * DataSourceBadge — inline provenance indicator.
 * Constitution Principle VIII: every data-driven view must display source +
 * fetchedAt with staleness color coding.
 *
 * TODO(FRESHNESS-UI): migrate to a shared component once spec for provenance
 * infrastructure ships.
 *
 * Staleness thresholds (equity quotes):
 *   fresh  < 5 min   green
 *   recent < 30 min  yellow
 *   stale  ≥ 30 min  red
 */

const FRESH_MS = 5 * 60 * 1000;
const RECENT_MS = 30 * 60 * 1000;

function staleness(fetchedAt) {
  if (!fetchedAt) return 'unknown';
  const age = Date.now() - new Date(fetchedAt).getTime();
  if (age < FRESH_MS) return 'fresh';
  if (age < RECENT_MS) return 'recent';
  return 'stale';
}

function formatAge(fetchedAt) {
  if (!fetchedAt) return 'unknown time';
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

const CONFIG = {
  fresh:   { color: 'text-green-400',  icon: CheckCircle,    label: 'Fresh' },
  recent:  { color: 'text-yellow-400', icon: Clock,          label: 'Recent' },
  stale:   { color: 'text-red-400',    icon: AlertTriangle,  label: 'Stale' },
  unknown: { color: 'text-gray-400',   icon: Clock,          label: 'Unknown' },
};

export default function DataSourceBadge({ source, fetchedAt, className = '' }) {
  const status = staleness(fetchedAt);
  const { color, icon: Icon, label } = CONFIG[status];
  const age = formatAge(fetchedAt);
  const src = source || 'Unknown source';

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${color} ${className}`}
      title={`${src} · fetched ${fetchedAt ? new Date(fetchedAt).toUTCString() : 'unknown'}`}
      aria-label={`Data source: ${src}, ${label.toLowerCase()}, fetched ${age}`}
    >
      <Icon size={11} aria-hidden="true" />
      <span>{src}</span>
      <span className="opacity-60">· {age}</span>
    </span>
  );
}
